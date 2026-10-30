import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { healthResourceIds, isHealthResource, withoutHealth } from './health-core.ts';
import type { Catalog } from './types.ts';

const full = JSON.parse(readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8')) as Catalog;
const lean = withoutHealth(full);

test('no medical archive, medicine category or health subject is left', () => {
  assert.ok(Object.values(lean.resources).every((r) => !isHealthResource(r)));
  assert.equal(lean.resources['wikipedia_es_medicine_nopic'], undefined);
  assert.equal(lean.resources['zimgit-post-disaster_en'], undefined);
  assert.ok(!lean.categories.some((c) => c.slug === 'medicine'));
  assert.ok(!lean.courseSubjects.some((s) => s.slug === 'health'));
});

test('every id the lean catalog points at exists in it', () => {
  for (const c of lean.categories)
    for (const t of c.tiers) for (const id of t.resources) assert.ok(lean.resources[id], `${c.slug}/${t.slug}: ${id}`);
  for (const id of lean.courses) assert.ok(lean.resources[id], id);
  for (const o of [...lean.wikipedia.es, ...lean.wikipedia.en]) assert.ok(lean.resources[o.resourceId], o.resourceId);
});

test('the rest of the catalog is untouched', () => {
  const dropped = healthResourceIds(full);
  assert.equal(Object.keys(lean.resources).length, Object.keys(full.resources).length - dropped.size);
  assert.ok(lean.resources['ready.gov_es_all'] && lean.resources['zimgit-water_en']);
  assert.ok(lean.wikipedia.es.length === full.wikipedia.es.length && lean.wikipedia.en.length === full.wikipedia.en.length);
  assert.equal(lean.categories.length, full.categories.length - 1);
});
