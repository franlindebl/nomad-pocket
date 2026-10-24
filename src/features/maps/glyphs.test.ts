/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emptyGlyphRange, glyphRanges } from './glyphs.ts';

test('glyphRanges covers the BMP in 256-code-point ranges', () => {
  const r = glyphRanges();
  assert.equal(r.length, 256);
  assert.equal(r[0], '0-255');
  assert.equal(r[6], '1536-1791');
  assert.equal(r[255], '65280-65535');
});

test('emptyGlyphRange encodes glyphs { stacks { name, range } }', () => {
  const bytes = emptyGlyphRange('Noto Sans Regular', '1536-1791');
  const name = new TextEncoder().encode('Noto Sans Regular');
  const range = new TextEncoder().encode('1536-1791');
  const inner = [0x0a, name.length, ...name, 0x12, range.length, ...range];
  assert.deepEqual([...bytes], [0x0a, inner.length, ...inner]);
});
