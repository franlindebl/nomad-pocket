/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BM25,
  buildConversationQueries,
  buildRagUserMessage,
  buildRouterPrompt,
  buildSearchQueries,
  buildToolResult,
  chunkText,
  citedNumbers,
  detectLanguage,
  extractKeywords,
  followUpTopic,
  guessIntent,
  isHealthQuestion,
  normalize,
  packContext,
  parseToolQuery,
  rankChunks,
  relevantChunks,
  SEARCH_TOOL_NAME,
  searchToolSpec,
  splitSentences,
  stem,
  stripThinking,
  systemPrompt,
  tokenize,
  trimHistory,
  type Chunk,
  type SourceRef,
  type Turn,
} from './rag-core.ts';

describe('tokenizer', () => {
  test('normalize strips accents and lowercases', () => {
    assert.equal(normalize('Canción ÁRBOL Pingüino'), 'cancion arbol pinguino');
  });

  test('tokenize removes stopwords in both languages and stems', () => {
    assert.deepEqual(tokenize('¿Cómo se purifica el agua de un río?'), ['purific', 'agu', 'rio']);
    assert.deepEqual(tokenize('How do I treat the burns?'), ['treat', 'burn']);
  });

  test('stem conflates singular/plural and gender', () => {
    assert.equal(stem('quemaduras'), stem('quemadura'));
    assert.equal(stem('herido'), stem('herida'));
    assert.equal(stem('hospitales'), stem('hospital'));
    assert.equal(stem('luces'), 'luz');
    assert.equal(stem('boiling'), 'boil');
    assert.equal(stem('boils'), 'boil');
    assert.equal(stem('class'), 'class');
    assert.equal(stem('classes'), 'class');
    assert.equal(stem('purificaciones'), stem('purificación'.normalize('NFD').replace(/\p{M}/gu, '')));
    assert.equal(stem('sol'), 'sol');
    assert.equal(stem('2024'), '2024');
  });

  test('detectLanguage', () => {
    assert.equal(detectLanguage('¿Qué hago si me pica una serpiente?'), 'es');
    assert.equal(detectLanguage('como hacer fuego sin cerillas'), 'es');
    assert.equal(detectLanguage('What should I do after a snake bite?'), 'en');
    assert.equal(detectLanguage('xyz', 'es'), 'es');
  });
});

describe('search queries', () => {
  test('extractKeywords keeps original spelling and drops stopwords', () => {
    assert.deepEqual(extractKeywords('¿Cómo potabilizo el agua de lluvia?'), ['potabilizo', 'agua', 'lluvia']);
  });

  test('buildSearchQueries goes from specific to broad', () => {
    const qs = buildSearchQueries('¿Cuáles son los síntomas de la hipotermia en niños pequeños?');
    assert.equal(qs[0], 'síntomas hipotermia niños pequeños');
    assert.ok(qs.includes('hipotermia'));
    assert.ok(qs.length <= 4);
  });

  test('buildSearchQueries survives a word the library lacks', () => {
    assert.deepEqual(buildSearchQueries('Michael Jackson fallecimiento'), [
      'michael jackson fallecimiento',
      'michael jackson',
      'michael fallecimiento',
      'fallecimiento',
    ]);
  });

  test('buildSearchQueries falls back to the raw question', () => {
    assert.deepEqual(buildSearchQueries('¿y eso?'), ['¿y eso?']);
    assert.deepEqual(buildSearchQueries('   '), []);
  });
});

describe('chunking', () => {
  const para = (n: number) => `Frase número ${n} con algo de contenido para rellenar el texto.`;

  test('short text is one chunk', () => {
    assert.deepEqual(chunkText('Hola mundo.'), ['Hola mundo.']);
    assert.deepEqual(chunkText('   '), []);
  });

  test('long text is split on sentence boundaries within size', () => {
    const text = Array.from({ length: 40 }, (_, i) => para(i)).join(' ');
    const chunks = chunkText(text, 300, 80);
    assert.ok(chunks.length > 5);
    for (const c of chunks) {
      assert.ok(c.length <= 300, `chunk too long: ${c.length}`);
      assert.match(c, /\.$/);
    }
    // Every sentence survives.
    for (let i = 0; i < 40; i++) assert.ok(chunks.some((c) => c.includes(`número ${i} `)));
  });

  test('consecutive chunks overlap', () => {
    const text = Array.from({ length: 20 }, (_, i) => para(i)).join('\n');
    const chunks = chunkText(text, 200, 70);
    const lastSentence = chunks[0].split('. ').pop()!;
    assert.ok(chunks[1].startsWith(lastSentence.replace(/\.$/, '')), 'second chunk starts with overlap');
  });

  test('a giant sentence is hard-split', () => {
    const chunks = chunkText('a'.repeat(1000), 300, 50);
    assert.ok(chunks.length >= 4);
    for (const c of chunks) assert.ok(c.length <= 300);
  });
});

describe('BM25', () => {
  test('ranks documents with rare matching terms higher', () => {
    const idx = new BM25<string>();
    idx.add('water', tokenize('El agua potable se obtiene hirviendo el agua durante un minuto.'));
    idx.add('fire', tokenize('Para hacer fuego necesitas yesca, leña y una chispa.'));
    idx.add('mixed', tokenize('El fuego sirve para hervir agua y cocinar.'));
    const res = idx.search(tokenize('¿Cómo hago agua potable?'));
    assert.equal(res[0].item, 'water');
    assert.ok(res.every((r) => r.item !== 'fire'));
  });

  test('returns nothing for an empty index or no overlap', () => {
    assert.deepEqual(new BM25<string>().search(['x']), []);
    const idx = new BM25<string>();
    idx.add('a', ['uno', 'dos']);
    assert.deepEqual(idx.search(['tres']), []);
  });

  test('length normalization prefers the focused document', () => {
    const idx = new BM25<string>();
    idx.add('short', ['vendaj', 'herid']);
    idx.add('long', ['vendaj', ...Array.from({ length: 60 }, (_, i) => `relleno${i}`)]);
    const res = idx.search(['vendaj']);
    assert.equal(res[0].item, 'short');
  });

  test('rankChunks uses the title and boosts leads', () => {
    const chunks: Chunk[] = [
      { sourceKey: 'a', title: 'Hipotermia', text: 'Es un descenso peligroso de la temperatura corporal.', index: 0 },
      { sourceKey: 'b', title: 'Cocina', text: 'Recetas de cocina con temperatura alta.', index: 0 },
      { sourceKey: 'a', title: 'Hipotermia', text: 'Tratamiento: abrigar a la persona y darle bebidas calientes.', index: 3 },
    ];
    const ranked = rankChunks('¿Qué es la hipotermia?', chunks);
    assert.equal(ranked[0].item.sourceKey, 'a');
    assert.equal(ranked[0].item.index, 0);
  });

  test('rankChunks prefers the article whose title the question names', () => {
    const chunks: Chunk[] = [
      { sourceKey: 'g', title: 'Gliceraldehído', text: 'Producto intermedio de la fotosíntesis y la glucólisis, presente en la fotosíntesis.', index: 0, hitRank: 0 },
      { sourceKey: 'f', title: 'Fotosíntesis', text: 'Proceso por el que las plantas convierten la luz en energía química.', index: 0, hitRank: 2 },
    ];
    const ranked = rankChunks('Explícame la fotosíntesis de forma sencilla', chunks);
    assert.equal(ranked[0].item.sourceKey, 'f');
  });
});

describe('context packing', () => {
  const refs: Record<string, SourceRef> = {
    a: { itemId: 'wiki', path: 'A/Agua', title: 'Agua' },
    b: { itemId: 'wiki', path: 'A/Fuego', title: 'Fuego' },
    c: { itemId: 'med', path: 'A/Quemadura', title: 'Quemadura' },
  };
  const chunk = (sourceKey: string, index: number, len = 100): Chunk => ({ sourceKey, title: refs[sourceKey].title, text: `${sourceKey}${index} `.padEnd(len, 'x'), index });
  const scored = (c: Chunk, score: number) => ({ item: c, score });

  test('numbers sources by best chunk and keeps article order of passages', () => {
    const ranked = [scored(chunk('b', 2), 9), scored(chunk('a', 1), 8), scored(chunk('b', 0), 7)];
    const packed = packContext(ranked, (k) => refs[k], 10_000);
    assert.deepEqual(
      packed.sources.map((s) => [s.n, s.title]),
      [
        [1, 'Fuego'],
        [2, 'Agua'],
      ],
    );
    assert.ok(packed.sources[0].passages[0].startsWith('b0'));
    assert.ok(packed.sources[0].passages[1].startsWith('b2'));
  });

  test('respects the character budget', () => {
    const ranked = [scored(chunk('a', 0, 400), 9), scored(chunk('b', 0, 400), 8), scored(chunk('c', 0, 150), 7)];
    const packed = packContext(ranked, (k) => refs[k], 600);
    assert.ok(packed.used <= 600);
    assert.deepEqual(
      packed.sources.map((s) => s.title),
      ['Agua', 'Quemadura'],
    );
  });

  test('caps passages per source and skips unknown sources', () => {
    const ranked = [0, 1, 2, 3, 4].map((i) => scored(chunk('a', i), 10 - i));
    ranked.push(scored({ sourceKey: 'zzz', title: 'Ghost', text: 'boo', index: 0 }, 20));
    const packed = packContext(ranked, (k) => refs[k], 10_000, 2);
    assert.equal(packed.sources.length, 1);
    assert.equal(packed.sources[0].passages.length, 2);
  });

  test('buildRagUserMessage numbers sources and handles no hits', () => {
    const packed = packContext([scored(chunk('c', 0, 40), 1)], (k) => refs[k], 1000);
    const msg = buildRagUserMessage('¿Cómo curo una quemadura?', packed.sources, 'es');
    assert.match(msg, /^Pregunta: ¿Cómo curo una quemadura\?/);
    assert.match(msg, /Fuentes de la biblioteca:/);
    assert.match(msg, /\[1\] Quemadura/);
    assert.match(msg, /Pregunta: ¿Cómo curo una quemadura\?/);
    const none = buildRagUserMessage('What is X?', [], 'en');
    assert.match(none, /no articles about this/);
    assert.match(none, /Question: What is X\?/);
  });
});

describe('answers and history', () => {
  test('citedNumbers parses single, lists and ranges', () => {
    assert.deepEqual(citedNumbers('Hierve el agua [2]. También [1, 3] y [2-4].'), [1, 2, 3, 4]);
    assert.deepEqual(citedNumbers('Sin citas.'), []);
  });

  test('stripThinking removes reasoning blocks, closed or not', () => {
    assert.equal(stripThinking('<think>hmm</think>\nHola'), 'Hola');
    assert.equal(stripThinking('<think>todavía pensando'), '');
  });

  test('trimHistory keeps recent whole turns and starts with the user', () => {
    const turns = [
      { role: 'user' as const, content: 'a'.repeat(50) },
      { role: 'assistant' as const, content: 'b'.repeat(50) },
      { role: 'user' as const, content: 'c'.repeat(50) },
      { role: 'assistant' as const, content: 'd'.repeat(50) },
    ];
    assert.deepEqual(
      trimHistory(turns, 140).map((t) => t.content[0]),
      ['c', 'd'],
    );
    assert.deepEqual(
      trimHistory(turns, 80).map((t) => t.content[0]),
      [],
    );
    assert.equal(trimHistory(turns, 10_000).length, 4);
  });
});

describe('system prompt', () => {
  test('health note only for health questions', () => {
    assert.equal(isHealthQuestion('Primeros auxilios para una quemadura leve'), true);
    assert.equal(isHealthQuestion('What should I do after a snake bite?'), true);
    assert.equal(isHealthQuestion('Explícame la fotosíntesis'), false);
    assert.equal(isHealthQuestion('An interesting fact about Spain'), false);
    assert.match(systemPrompt('es', 'chat', { health: true }), /no consejo médico/);
    assert.doesNotMatch(systemPrompt('es', 'chat'), /consejo médico/);
    assert.match(systemPrompt('en', 'sources'), /\[1\]/);
  });

  test('modes: chat talks naturally, tools explains when to search', () => {
    const chat = systemPrompt('es', 'chat', { library: true });
    assert.match(chat, /natural/);
    assert.match(chat, /biblioteca/);
    assert.doesNotMatch(systemPrompt('es', 'chat'), /biblioteca/);
    assert.doesNotMatch(chat, /\[1\]/);
    const tools = systemPrompt('en', 'tools');
    assert.match(tools, /search_library/);
    assert.match(tools, /follow-up/);
    assert.match(tools, /\[1\]/);
  });
});

describe('chat or search', () => {
  const H: Turn[] = [
    { role: 'user', content: '¿Qué es la hipotermia?' },
    { role: 'assistant', content: 'Una bajada peligrosa de la temperatura corporal [1].' },
  ];

  test('small talk is chat', () => {
    for (const m of ['hola', '¡Buenas! ¿Qué tal estás?', 'Hola, buenos días', 'gracias!', 'muchas gracias', 'vale, perfecto', 'ok', 'jajaja', 'adiós, hasta luego', '¿Quién eres?', '¿Qué puedes hacer?', 'cuéntame un chiste', 'Hi there!', 'thanks a lot', 'How are you?', 'What can you do?', '👍', '']) {
      assert.equal(guessIntent(m), 'chat', m);
    }
  });

  test('questions are search, also when they start with a greeting', () => {
    for (const m of ['¿Quién fue Michael Jackson?', '¿Cómo purifico agua en el campo?', 'hola, ¿cómo se cura una quemadura?', '¿Cuál es la capital de Australia?', 'What is photosynthesis?', 'fotosíntesis', 'cuéntame sobre Roma', 'Can you help me with burns?']) {
      assert.equal(guessIntent(m), 'search', m);
    }
  });

  test('requests about the previous answer are chat, only in a conversation', () => {
    for (const m of [
      'resúmelo',
      'explícamelo más simple',
      'más corto, por favor',
      'otra vez',
      'tradúcelo al inglés',
      'dame más detalles',
      'hazlo en una tabla',
      'sigue',
      'make it shorter',
      'explain it again',
      'put it in a list',
      'reword it',
    ]) {
      assert.equal(guessIntent(m, H), 'chat', m);
    }
    assert.equal(guessIntent('¿y cómo se trata?', H), 'search');
    assert.equal(guessIntent('resúmelo'), 'search');
  });

  test('one-word follow-ups that only start like a rewrite request are searched', () => {
    for (const m of ['What about itching?', '¿Y moretones?', '¿Cortaduras?', 'Tablets?', 'Lessons?', 'Italy?', 'Listeria?', 'Longitude?', 'Makeup?']) {
      assert.equal(guessIntent(m, H), 'search', m);
    }
  });

  test('followUpTopic fills in the topic a follow-up leaves out', () => {
    assert.deepEqual(followUpTopic('¿y cómo se trata?', H), ['hipotermia']);
    assert.deepEqual(followUpTopic('¿Y en niños es distinto?', H), ['hipotermia']);
    assert.deepEqual(followUpTopic('¿Cuáles son los síntomas?', H), ['hipotermia']);
    assert.deepEqual(followUpTopic('¿Qué es la fotosíntesis?', H), []);
    assert.deepEqual(followUpTopic('¿Quién fue Michael Jackson?', H), []);
    assert.deepEqual(followUpTopic('¿y cómo se trata?', []), []);
  });

  test('a pronoun carries the topic over only when the question names almost nothing itself', () => {
    const burn: Turn[] = [
      { role: 'user', content: 'How do I treat a burn?' },
      { role: 'assistant', content: 'Cool it under running water [1].' },
    ];
    assert.deepEqual(followUpTopic('Is it safe to drink rain water?', burn), []);
    assert.deepEqual(followUpTopic('Is it possible to start a fire with a battery?', burn), []);
    assert.deepEqual(followUpTopic('Can they hear ultrasound?', burn), []);
    assert.deepEqual(followUpTopic('Is it contagious?', burn), ['treat', 'burn']);
    assert.deepEqual(followUpTopic('Does it scar?', burn), ['treat', 'burn']);
    assert.deepEqual(followUpTopic('And in children?', burn), ['treat', 'burn']);
    assert.deepEqual(followUpTopic('¿Eso es peligroso?', H), ['hipotermia']);
    assert.deepEqual(followUpTopic('¿Se puede curar esto en casa?', H), ['hipotermia']);
    assert.deepEqual(followUpTopic('¿Esto sirve para hacer fuego con pilas?', H), []);
    assert.deepEqual(buildConversationQueries('Is it safe to drink rain water?', burn), buildSearchQueries('Is it safe to drink rain water?'));
  });

  test('buildConversationQueries searches the combined topic first', () => {
    assert.deepEqual(buildConversationQueries('¿y cómo se trata?', H), ['hipotermia trata', 'hipotermia', 'trata']);
    assert.ok(buildConversationQueries('¿Y en niños es distinto?', H).includes('hipotermia niños'));
    assert.deepEqual(buildConversationQueries('¿Qué es la fotosíntesis?', H), buildSearchQueries('¿Qué es la fotosíntesis?'));
    assert.deepEqual(buildConversationQueries('¿y eso?', H), ['hipotermia']);
  });

  test('buildConversationQueries also searches a follow-up on its own', () => {
    // "y" makes it a follow-up, but it names its own topic: a wrong guess must not sink the search.
    const qs = buildConversationQueries('¿Y si me quemo con aceite hirviendo?', H);
    assert.equal(qs[0], 'hipotermia quemo aceite hirviendo');
    assert.ok(qs.includes('quemo aceite hirviendo'), qs.join(' | '));
    assert.equal(qs.length, 4);
  });

  test('router prompt carries recent turns, shortened', () => {
    assert.equal(buildRouterPrompt('hola', []), 'Latest user message: hola');
    const p = buildRouterPrompt('¿y cómo se trata?', [...H, { role: 'user', content: 'x'.repeat(500) }]);
    assert.match(p, /^Conversation:\nUser: ¿Qué es la hipotermia\?\nAssistant: Una bajada/);
    assert.match(p, /Latest user message: ¿y cómo se trata\?$/);
    assert.ok(!p.includes('x'.repeat(301)));
  });
});

describe('relevance', () => {
  const c = (title: string, text: string): Chunk => ({ sourceKey: title, title, text, index: 0 });
  const s = (item: Chunk) => ({ item, score: 1 });

  test('drops chunks that share too few terms with the question', () => {
    const ranked = [s(c('Fuego', 'El fuego es la oxidación rápida de un material combustible.')), s(c('Leña', 'Para encender leña mojada usa yesca seca y ramitas finas; el fuego prende mejor.'))];
    // enciend, fueg, mojad: 2 of 3 needed; "Fuego" only mentions fire.
    assert.deepEqual(
      relevantChunks('¿Cómo enciendo fuego si todo está mojado?', ranked).map((r) => r.item.title),
      ['Leña'],
    );
    assert.deepEqual(
      relevantChunks('¿Cómo se apaga un fuego de aceite en la cocina?', ranked).map((r) => r.item.title),
      [],
    );
  });

  test('one or two terms need a single match, the title counts', () => {
    const ranked = [s(c('Michael Jackson', 'Cantante estadounidense.')), s(c('Otro', 'Nada que ver.'))];
    assert.deepEqual(
      relevantChunks('¿Quién fue Michael Jackson?', ranked).map((r) => r.item.title),
      ['Michael Jackson'],
    );
  });
});

describe('tool calls', () => {
  test('searchToolSpec describes search_library with a query', () => {
    const spec = searchToolSpec('es');
    assert.equal(spec.function.name, SEARCH_TOOL_NAME);
    assert.deepEqual(spec.function.parameters.required, ['query']);
  });

  test('parseToolQuery reads JSON arguments, bare strings and junk', () => {
    assert.equal(parseToolQuery('{"query":"tratamiento hipotermia"}'), 'tratamiento hipotermia');
    assert.equal(parseToolQuery('"Michael Jackson"'), 'Michael Jackson');
    assert.equal(parseToolQuery('capital de Australia'), 'capital de Australia');
    assert.equal(parseToolQuery('{"q":1}'), '{"q":1}');
    assert.equal(parseToolQuery(undefined), '');
  });

  test('buildToolResult numbers sources or explains there are none', () => {
    const sources = [{ itemId: 'w', path: 'A/X', title: 'Hipotermia', n: 1, passages: ['Temperatura por debajo de 35 °C.'] }];
    assert.match(buildToolResult(sources, 'es'), /^\[1\] Hipotermia\nTemperatura/);
    assert.match(buildToolResult(sources, 'es'), /Cita cada dato/);
    assert.match(buildToolResult([], 'en'), /No results/);
  });
});

test('splitSentences keeps decimals and Spanish opening marks', () => {
  assert.deepEqual(splitSentences('La dosis es 0.5 mg/kg. ¿Y si la fiebre supera 39.5 °C? ¡Acude al médico!'), [
    'La dosis es 0.5 mg/kg.',
    '¿Y si la fiebre supera 39.5 °C?',
    '¡Acude al médico!',
  ]);
});

test('citedNumbers expands ranges', () => {
  assert.deepEqual(citedNumbers('Ver [1-3] y [5, 7].'), [1, 2, 3, 5, 7]);
});
