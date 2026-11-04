import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { withoutHealth } from '../catalog/health-core.ts';
import type { Catalog } from '../catalog/types.ts';
import { essentialResources, WIKIPEDIA_LADDER } from './kit-core.ts';

const catalog = JSON.parse(readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8')) as Catalog;
const ids = (c: Catalog, langs: string[], primary: string) => essentialResources(c, langs, primary).map((r) => r.id);

test("the kit is every collection's essential level, Computing none", () => {
  const kit = new Set(ids(catalog, ['es', 'en'], 'es'));
  for (const c of catalog.categories) {
    const tier = c.tiers.find((t) => t.recommended);
    if (c.slug === 'computing') assert.equal(tier, undefined);
    else assert.ok(tier && tier.resources.some((id) => kit.has(id)), c.slug);
  }
  for (const id of ['freecodecamp_es_all', 'devdocs_en_python', 'canadian-prepper_en_winterprepping', 'ted_mul_gardening', 'wwwnc.cdc.gov_en_all']) {
    assert.ok(!kit.has(id), id);
  }
  for (const id of ['zimgit-post-disaster_en', 'wikibooks_es_all_nopic', 'mechanics.stackexchange.com_en_all', 'gardenology_en_all']) assert.ok(kit.has(id), id);
});

test('with health features, the post-disaster library stands in for the four zimgit ones it carries', () => {
  const kit = ids(catalog, ['es', 'en'], 'es');
  for (const id of ['zimgit-medicine_en', 'zimgit-water_en', 'zimgit-knots_en', 'zimgit-food-preparation_en']) assert.ok(!kit.includes(id), id);
});

test('without health features (Android), no medicine and the water, knots and food libraries come back', () => {
  const kit = ids(withoutHealth(catalog), ['es', 'en'], 'es');
  for (const id of ['zimgit-post-disaster_en', 'zimgit-medicine_en', 'wikipedia_es_medicine_nopic', 'nhs.uk_en_medicines']) assert.ok(!kit.includes(id), id);
  for (const id of ['zimgit-water_en', 'zimgit-knots_en', 'zimgit-food-preparation_en', 'scoutwiki.org_es_all_maxi']) assert.ok(kit.includes(id), id);
});

test('one language of the same work: Spanish next to Spanish, English for English readers', () => {
  const es = ids(catalog, ['es', 'en'], 'es');
  assert.ok(es.includes('vikidia_es_all_nopic') && !es.includes('vikidia_en_all_nopic'));
  assert.ok(es.includes('wikivoyage_es_all_nopic') && !es.includes('wikivoyage_en_all_nopic'));
  const en = ids(catalog, ['en'], 'en');
  assert.ok(en.includes('vikidia_en_all_nopic') && en.includes('wikivoyage_en_all_nopic'));
  assert.ok(!en.some((id) => catalog.resources[id].language === 'es'));
});

test('the kit stays light', () => {
  const mb = (langs: string[], primary: string, c = catalog) => essentialResources(c, langs, primary).reduce((s, r) => s + r.sizeMB, 0);
  assert.ok(mb(['es', 'en'], 'es') < 2500, `es ${mb(['es', 'en'], 'es')} MB`);
  assert.ok(mb(['en'], 'en') < 2500, `en ${mb(['en'], 'en')} MB`);
  for (const r of essentialResources(catalog, ['es', 'en'], 'es')) assert.ok(r.sizeMB <= 700, r.id);
});

test('the Wikipedia ladder proposes the top articles, not the whole encyclopedia', () => {
  assert.deepEqual(WIKIPEDIA_LADDER.map((s) => s.id), ['top-nopic', 'top-mini']);
  for (const step of WIKIPEDIA_LADDER) assert.ok(catalog.wikipedia.es.some((o) => o.id === step.id) && catalog.wikipedia.en.some((o) => o.id === step.id));
});
