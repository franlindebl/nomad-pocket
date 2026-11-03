import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { coveringResource, editionIncludes, heldBy, otherLanguageIds, withoutHeld } from './editions-core.ts';
import type { Catalog, CatalogResource } from './types.ts';

const catalog = JSON.parse(readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8')) as Catalog;

test('wider and deeper editions of a book hold the smaller ones', () => {
  assert.ok(editionIncludes('wikipedia_es_all_nopic', 'wikipedia_es_top_mini'));
  assert.ok(editionIncludes('wikipedia_es_all_nopic', 'wikipedia_es_top_nopic'));
  assert.ok(editionIncludes('wikipedia_es_all_nopic', 'wikipedia_es_all_mini'));
  assert.ok(editionIncludes('wikipedia_es_all_maxi', 'wikipedia_es_all_nopic'));
  assert.ok(editionIncludes('wikipedia_es_top_nopic', 'wikipedia_es_top_mini'));
  assert.ok(editionIncludes('wikibooks_es_all_maxi', 'wikibooks_es_all_nopic'));
});

test('crossed editions, other books, other languages and topical Wikipedias hold nothing', () => {
  assert.ok(!editionIncludes('wikipedia_es_all_mini', 'wikipedia_es_top_nopic'));
  assert.ok(!editionIncludes('wikipedia_es_top_nopic', 'wikipedia_es_all_mini'));
  assert.ok(!editionIncludes('wikipedia_es_all_nopic', 'wikipedia_es_all_maxi'));
  assert.ok(!editionIncludes('wikipedia_es_all_nopic', 'wikipedia_es_all_nopic'));
  assert.ok(!editionIncludes('wikipedia_en_all_maxi', 'wikipedia_es_top_mini'));
  assert.ok(!editionIncludes('wikipedia_es_all_maxi', 'wikibooks_es_all_nopic'));
  assert.ok(!editionIncludes('wikipedia_es_all_maxi', 'wikipedia_es_medicine_nopic'));
  assert.ok(!editionIncludes('ifixit_es_all', 'ifixit_es_all'));
});

test('every Wikipedia option is an edition the ranking knows', () => {
  for (const o of [...catalog.wikipedia.es, ...catalog.wikipedia.en]) {
    assert.ok(/_(top|all)_(mini|nopic|maxi)$/.test(o.resourceId), o.resourceId);
  }
});

test('names the smallest installed edition that holds a resource', () => {
  const installed = new Set(['wikipedia_es_all_nopic', 'wikipedia_es_all_maxi']);
  const has = (id: string) => installed.has(id);
  assert.equal(coveringResource(catalog.resources, 'wikipedia_es_top_mini', has)?.id, 'wikipedia_es_all_nopic');
  assert.equal(coveringResource(catalog.resources, 'wikipedia_es_all_nopic', has)?.id, 'wikipedia_es_all_maxi');
  assert.equal(coveringResource(catalog.resources, 'wikipedia_es_all_maxi', has), undefined);
  assert.equal(coveringResource(catalog.resources, 'wikipedia_en_top_mini', has), undefined);
});

test('lists what a new download made redundant', () => {
  const installed = ['wikipedia_es_top_mini', 'wikipedia_es_top_nopic', 'wikipedia_en_top_mini', 'ifixit_es_all'];
  assert.deepEqual(heldBy('wikipedia_es_all_nopic', installed), ['wikipedia_es_top_mini', 'wikipedia_es_top_nopic']);
  assert.deepEqual(heldBy('wikipedia_es_top_mini', installed), []);
});

const r = (id: string, language: string, sameAs?: string) => ({ id, language, sameAs });

test('the same work in another language is "other" only next to its counterpart in the app language', () => {
  const visible = [r('ifixit_es', 'es', 'ifixit'), r('ifixit_en', 'en', 'ifixit'), r('prepper_en', 'en'), r('ted_mul', 'mul', 'ted')];
  assert.deepEqual([...otherLanguageIds(visible, 'es')], ['ifixit_en']);
  assert.deepEqual([...otherLanguageIds(visible, 'en')], ['ifixit_es']);
  // Spanish content hidden: the English one is the only iFixit, so it counts.
  assert.deepEqual([...otherLanguageIds([r('ifixit_en', 'en', 'ifixit'), r('prepper_en', 'en')], 'es')], []);
});

test('with the whole catalog in Spanish and English, the English counterparts go under other languages', () => {
  const visible = Object.values(catalog.resources) as CatalogResource[];
  const other = otherLanguageIds(visible, 'es');
  for (const id of ['wikipedia_en_all_nopic', 'ifixit_en_all', 'wikibooks_en_all_nopic', 'medlineplus.gov_en_all', 'wikiversity_en_all_nopic']) {
    assert.ok(other.has(id), id);
  }
  for (const id of ['wikipedia_es_all_nopic', 'zimgit-water_en', 'ted_mul_water', 'libretexts.org_en_math']) assert.ok(!other.has(id), id);
});

test('a pack drops the editions another one in it holds', () => {
  const pack = [{ id: 'wikibooks_es_all_nopic' }, { id: 'wikibooks_es_all_maxi' }, { id: 'ifixit_es_all' }];
  assert.deepEqual(
    withoutHeld(pack).map((r) => r.id),
    ['wikibooks_es_all_maxi', 'ifixit_es_all'],
  );
});
