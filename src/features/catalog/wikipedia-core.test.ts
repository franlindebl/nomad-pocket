import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { Catalog } from './types.ts';
import { coveringWikipedia, wikipediaIncludes } from './wikipedia-core.ts';

const catalog = JSON.parse(readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8')) as Catalog;

test('wider and deeper variants hold the smaller ones', () => {
  assert.ok(wikipediaIncludes('all-nopic', 'top-mini'));
  assert.ok(wikipediaIncludes('all-nopic', 'top-nopic'));
  assert.ok(wikipediaIncludes('all-nopic', 'all-mini'));
  assert.ok(wikipediaIncludes('all-maxi', 'all-nopic'));
  assert.ok(wikipediaIncludes('all-mini', 'top-mini'));
  assert.ok(wikipediaIncludes('top-nopic', 'top-mini'));
});

test('neither of two crossed variants holds the other, nor one itself', () => {
  assert.ok(!wikipediaIncludes('all-mini', 'top-nopic'));
  assert.ok(!wikipediaIncludes('top-nopic', 'all-mini'));
  assert.ok(!wikipediaIncludes('top-mini', 'all-nopic'));
  assert.ok(!wikipediaIncludes('all-nopic', 'all-maxi'));
  assert.ok(!wikipediaIncludes('all-nopic', 'all-nopic'));
  assert.ok(!wikipediaIncludes('all-nopic', 'something-else'));
});

test('every catalog option id is one the ranking knows', () => {
  for (const o of [...catalog.wikipedia.es, ...catalog.wikipedia.en]) assert.ok(/^(top|all)-(mini|nopic|maxi)$/.test(o.id), o.id);
});

test('names the smallest installed variant that holds a resource, in its own language', () => {
  const installed = new Set(['wikipedia_es_all_nopic', 'wikipedia_es_all_maxi']);
  const has = (id: string) => installed.has(id);
  assert.equal(coveringWikipedia(catalog.wikipedia, 'wikipedia_es_top_mini', has)?.id, 'all-nopic');
  assert.equal(coveringWikipedia(catalog.wikipedia, 'wikipedia_es_all_nopic', has)?.id, 'all-maxi');
  assert.equal(coveringWikipedia(catalog.wikipedia, 'wikipedia_es_all_maxi', has), undefined);
  assert.equal(coveringWikipedia(catalog.wikipedia, 'wikipedia_en_top_mini', has), undefined);
  assert.equal(coveringWikipedia(catalog.wikipedia, 'wikivoyage_es_all_maxi', has), undefined);
});
