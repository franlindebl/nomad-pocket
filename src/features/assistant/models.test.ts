/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GGUF_MODELS, modelFit, ramGB, recommendModel } from './models.ts';

test('catalog entries are consistent', () => {
  const ids = new Set<string>();
  for (const m of GGUF_MODELS) {
    assert.ok(!ids.has(m.id), `duplicate id ${m.id}`);
    ids.add(m.id);
    assert.ok(m.url.startsWith('https://huggingface.co/'));
    assert.ok(m.url.endsWith(`/${m.filename}`), `${m.id} url/filename mismatch`);
    assert.match(m.url, /\/resolve\/[0-9a-f]{40}\//, `${m.id} must be pinned to a commit`);
    assert.ok(m.sizeBytes > 100e6);
  }
});

test('ramGB rounds the OS reading to half gigabytes', () => {
  assert.equal(ramGB(null), null);
  assert.equal(ramGB(7.6 * 1024 ** 3), 7.5);
  assert.equal(ramGB(5.8 * 1024 ** 3), 6);
});

test('recommendModel picks the largest comfortable Qwen model', () => {
  assert.equal(recommendModel(3).id, 'qwen3.5-0.8b-q4km');
  assert.equal(recommendModel(3.5).id, 'qwen3.5-0.8b-q4km');
  assert.equal(recommendModel(5.5).id, 'qwen3.5-2b-q4km');
  assert.equal(recommendModel(7.5).id, 'qwen3.5-4b-q4km');
  assert.equal(recommendModel(12).id, 'qwen3.5-4b-q4km');
  assert.equal(recommendModel(null).id, 'qwen3.5-2b-q4km');
});

test('modelFit flags models that need more RAM', () => {
  const gemma = GGUF_MODELS.find((m) => m.family === 'gemma')!;
  assert.equal(modelFit(gemma, 4), 'tooBig');
  assert.equal(modelFit(gemma, 7.5), 'tight');
  assert.equal(modelFit(gemma, 12), 'good');
  assert.equal(modelFit(gemma, null), 'good');
});
