/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BM25,
  buildRagUserMessage,
  buildSearchQueries,
  chunkText,
  citedNumbers,
  detectLanguage,
  extractKeywords,
  isHealthQuestion,
  normalize,
  packContext,
  rankChunks,
  stem,
  stripThinking,
  systemPrompt,
  tokenize,
  trimHistory,
  type Chunk,
  type SourceRef,
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
    assert.ok(qs.length <= 3);
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
    assert.match(msg, /^Fuentes:/);
    assert.match(msg, /\[1\] Quemadura/);
    assert.match(msg, /Pregunta: ¿Cómo curo una quemadura\?/);
    const none = buildRagUserMessage('What is X?', [], 'en');
    assert.match(none, /found no relevant articles/);
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
    assert.match(systemPrompt('es', false, true), /no consejo médico/);
    assert.doesNotMatch(systemPrompt('es', false, false), /consejo médico/);
    assert.match(systemPrompt('en', true), /\[1\]/);
  });
});
