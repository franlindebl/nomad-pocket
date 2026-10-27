/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bestModel, GGUF_MODELS, modelFit, modelRank, ramGB, recommendModel, SYSTEM_MODEL_ID } from './models.ts';

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

test('modelRank puts the system model between Qwen3.5 2B and 4B', () => {
  assert.ok(modelRank('qwen3.5-4b-q4km') > modelRank(SYSTEM_MODEL_ID));
  assert.ok(modelRank(SYSTEM_MODEL_ID) > modelRank('qwen3.5-2b-q4km'));
  assert.ok(modelRank('qwen3.5-2b-q4km') > modelRank('qwen3.5-0.8b-q4km'));
  assert.equal(modelRank(null), 0);
  assert.equal(modelRank('unknown'), 0);
});

test('bestModel picks the most capable, the first one on a tie', () => {
  assert.equal(bestModel([]), null);
  assert.equal(bestModel(['qwen3.5-0.8b-q4km', SYSTEM_MODEL_ID, 'qwen3.5-4b-q4km']), 'qwen3.5-4b-q4km');
  assert.equal(bestModel([SYSTEM_MODEL_ID, 'gemma-4-e2b-q4km']), SYSTEM_MODEL_ID);
});
