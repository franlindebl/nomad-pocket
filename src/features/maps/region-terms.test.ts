import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aliasMatches } from './region-terms.ts';

test('common names and codes find their country', () => {
  assert.ok(aliasMatches('us', 'eeuu'));
  assert.ok(aliasMatches('us', 'usa'));
  assert.ok(aliasMatches('us', 'ee. uu.'));
  assert.ok(aliasMatches('gb', 'uk'));
  assert.ok(aliasMatches('gb', 'inglaterra'));
  assert.ok(aliasMatches('gb', 'gran bretana'));
  assert.ok(aliasMatches('nl', 'holanda'));
  assert.ok(aliasMatches('de', 'deu'));
});

test('no false hits', () => {
  assert.ok(!aliasMatches('fr', 'usa'));
  assert.ok(!aliasMatches('us', ''));
  assert.ok(!aliasMatches('nl', 'ho'));
});
