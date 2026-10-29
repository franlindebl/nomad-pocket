import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clipAnswer, reportMailto, REPORT_EMAIL } from './report-core.ts';

test('clipAnswer keeps short answers and cuts long ones', () => {
  assert.equal(clipAnswer('  Hola  '), 'Hola');
  assert.equal(clipAnswer('abcdef', 3), 'abc…');
});

test('reportMailto encodes subject and body', () => {
  const url = reportMailto('Respuesta & más', 'línea 1\nlínea 2?');
  assert.ok(url.startsWith(`mailto:${REPORT_EMAIL}?subject=`));
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  assert.equal(params.get('subject'), 'Respuesta & más');
  assert.equal(params.get('body'), 'línea 1\nlínea 2?');
});
