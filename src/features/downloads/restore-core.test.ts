import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startupRowAction, type RowFacts } from './restore-core.ts';

const base: RowFacts = { status: 'queued', segmented: false, destExists: false, partExists: false, chunksExist: false };
const act = (o: Partial<RowFacts>) => startupRowAction({ ...base, ...o });

test('restored phone: a segmented download without its .part is lost, whatever its status', () => {
  for (const status of ['queued', 'running', 'paused']) assert.equal(act({ status, segmented: true }), 'lost');
});

test('relaunch after a kill: segmented downloads with their .part or ranges resume', () => {
  for (const status of ['queued', 'running', 'paused']) {
    assert.equal(act({ status, segmented: true, partExists: true }), 'keep');
    assert.equal(act({ status, segmented: true, chunksExist: true }), 'keep');
  }
});

test('a queued download that never started, and single transfers, are untouched', () => {
  assert.equal(act({ status: 'queued' }), 'keep');
  assert.equal(act({ status: 'running' }), 'keep');
  assert.equal(act({ status: 'paused' }), 'keep');
});

test('processing: finished file in place or still a .part finalises; nothing left is lost', () => {
  assert.equal(act({ status: 'processing', destExists: true }), 'keep');
  assert.equal(act({ status: 'processing', partExists: true }), 'keep');
  assert.equal(act({ status: 'processing' }), 'lost');
});

test('failed rows stay failed rows', () => {
  assert.equal(act({ status: 'failed', segmented: true }), 'keep');
});
