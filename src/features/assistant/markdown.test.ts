/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseInline, parseMarkdown, toPlainText } from './markdown.ts';

test('inline bold, italics, code and citations', () => {
  assert.deepEqual(parseInline('Hierve **el agua** *un minuto* con `x` [1][2, 3].'), [
    { type: 'text', text: 'Hierve ' },
    { type: 'bold', children: [{ type: 'text', text: 'el agua' }] },
    { type: 'text', text: ' ' },
    { type: 'italic', children: [{ type: 'text', text: 'un minuto' }] },
    { type: 'text', text: ' con ' },
    { type: 'code', text: 'x' },
    { type: 'text', text: ' ' },
    { type: 'cite', n: 1 },
    { type: 'cite', n: 2 },
    { type: 'cite', n: 3 },
    { type: 'text', text: '.' },
  ]);
});

test('snake_case is not italic; unclosed bold marker is hidden', () => {
  assert.deepEqual(parseInline('snake_case_word'), [{ type: 'text', text: 'snake_case_word' }]);
  assert.deepEqual(parseInline('Esto es **impor'), [{ type: 'text', text: 'Esto es impor' }]);
  assert.deepEqual(parseInline('[nota]'), [{ type: 'text', text: '[nota]' }]);
});

test('blocks: headings, lists, code, paragraphs', () => {
  const md = ['## Pasos', '', '1. Filtra el agua', '2. Hiérvela', '', '- uno', '- dos', '  sigue', '', '```', 'code();', '```', 'Fin del', 'párrafo.'].join('\n');
  const blocks = parseMarkdown(md);
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['heading', 'list', 'list', 'code', 'paragraph'],
  );
  const ordered = blocks[1] as Extract<(typeof blocks)[number], { type: 'list' }>;
  assert.equal(ordered.ordered, true);
  assert.equal(ordered.items.length, 2);
  const bullets = blocks[2] as Extract<(typeof blocks)[number], { type: 'list' }>;
  assert.deepEqual(bullets.items[1], [{ type: 'text', text: 'dos sigue' }]);
  assert.deepEqual((blocks[3] as { text: string }).text, 'code();');
  assert.deepEqual((blocks[4] as { children: unknown }).children, [{ type: 'text', text: 'Fin del párrafo.' }]);
});

test('unterminated code fence while streaming', () => {
  const blocks = parseMarkdown('Mira:\n```js\nconst a = 1;');
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['paragraph', 'code'],
  );
});

test('toPlainText strips syntax and citation markers', () => {
  const md = '## Agua\n\nHierve **el agua** un minuto [1].\n\n- Uno [1, 2]\n- Dos\n\n1. A\n2. B\n\n```\nx = 1\n```';
  assert.equal(toPlainText(md), 'Agua\n\nHierve el agua un minuto.\n\n• Uno\n• Dos\n\n1. A\n2. B\n\nx = 1');
});
