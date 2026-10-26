import assert from 'node:assert/strict';
import { test } from 'node:test';

import { looksMedical } from './medical.ts';

test('Kiwix tags and category mark medical archives', () => {
  assert.equal(looksMedical({ tags: ['medical', 'nopic'] }), true);
  assert.equal(looksMedical({ tags: ['Medicine'] }), true);
  assert.equal(looksMedical({ category: 'medicine' }), true);
  assert.equal(looksMedical({ category: ' Medicine ' }), true);
  assert.equal(looksMedical({ category: 'other', tags: ['nopic', 'wikipedia'] }), false);
});

test('book names count by whole words', () => {
  for (const name of [
    'wikipedia_fr_medicine_maxi',
    'wikipedia_en_medicine_nopic_2026-09',
    'mdwiki_en_all',
    'wikem_en_all',
    'librepathology_en_all_maxi',
    'nhs.uk_en_medicines',
    'medlineplus.gov_es_all',
    'wwwnc.cdc.gov_en_all',
    'zimgit-medicine_en',
    'MEDICINA basica',
  ]) {
    assert.equal(looksMedical({ names: [name] }), true, name);
  }
  // A word inside another word is not a match.
  for (const name of ['wikipedia_en_all_maxi', 'medicinal_plants_es', 'mediciones_es', 'cdcs_en', 'unhsr_en', 'gutenberg_es_all']) {
    assert.equal(looksMedical({ names: [name] }), false, name);
  }
});

test('missing or empty hints are not medical', () => {
  assert.equal(looksMedical({}), false);
  assert.equal(looksMedical({ names: [null, undefined, ''], category: null, tags: [] }), false);
});

test('any one hint is enough', () => {
  assert.equal(looksMedical({ names: ['wikipedia_en_all'], category: 'wikipedia', tags: ['medical'] }), true);
  assert.equal(looksMedical({ names: ['x_en', 'wikem_en_all'] }), true);
});
