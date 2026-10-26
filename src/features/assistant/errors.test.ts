/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { errorFor, isErrorKey } from './errors.ts';

const coded = (code: string, message: string) => Object.assign(new Error(message), { code });

test('known system-model codes map to translated keys', () => {
  assert.equal(errorFor(coded('ERR_GUARDRAIL', 'The system model declined to answer this request')), 'declined');
  assert.equal(errorFor(coded('ERR_CONTEXT', 'The conversation is too long for the system model')), 'tooLong');
  assert.equal(errorFor(coded('ERR_BUSY', 'busy')), 'busy');
  for (const code of ['ERR_UNAVAILABLE', 'ERR_LANGUAGE', 'ERR_ASSETS', 'ERR_RATE_LIMITED', 'ERR_UNSUPPORTED']) {
    assert.ok(isErrorKey(errorFor(coded(code, 'x'))), code);
  }
});

test('anything else keeps its own message', () => {
  assert.equal(errorFor(coded('ERR_GENERATE', 'decodingFailure')), 'decodingFailure');
  assert.equal(errorFor(new TypeError("Cannot read property 'completion' of null")), "Cannot read property 'completion' of null");
  assert.equal(errorFor('plain'), 'plain');
  assert.equal(errorFor(null), 'null');
  assert.equal(isErrorKey('decodingFailure'), false);
  assert.equal(isErrorKey('noModel'), true);
});
