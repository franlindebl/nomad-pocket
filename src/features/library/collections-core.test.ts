import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCollectionIndex, collectionCount, collectionOf, COURSES, OTHER, WIKIPEDIA } from './collections-core.ts';

const catalog = {
  categories: [
    { slug: 'computing', tiers: [{ resources: ['devdocs_en_node', 'wikipedia_es_computer_nopic'] }] },
    { slug: 'medicine', tiers: [{ resources: ['nhs.uk_en_medicines'] }, { resources: ['shared_book'] }] },
    { slug: 'survival', tiers: [{ resources: ['zimgit-water_en', 'shared_book'] }] },
  ],
  resources: {
    devdocs_en_node: { category: 'computing' },
    wikipedia_es_computer_nopic: { category: 'computing' },
    'nhs.uk_en_medicines': { category: 'medicine' },
    'zimgit-water_en': { category: 'survival' },
    shared_book: { category: 'survival' },
    wikipedia_es_top_mini: { category: 'reference' },
  },
};
const index = buildCollectionIndex(catalog, ['medicine', 'survival', 'computing']);
const item = (id: string, extra: Partial<{ catalogId: string | null; category: string | null; isCourse: boolean }> = {}) => ({
  id,
  catalogId: id,
  category: null,
  isCourse: false,
  ...extra,
});

test('catalog archives go to the category whose tiers list them', () => {
  assert.equal(collectionOf(item('devdocs_en_node'), index), 'computing');
  assert.equal(collectionOf(item('nhs.uk_en_medicines'), index), 'medicine');
});

test('a resource in two categories goes to the first one in display order', () => {
  assert.equal(collectionOf(item('shared_book'), index), 'medicine');
});

test('topical Wikipedias stay in their category; whole ones go to Wikipedia', () => {
  assert.equal(collectionOf(item('wikipedia_es_computer_nopic'), index), 'computing');
  assert.equal(collectionOf(item('wikipedia_es_top_mini'), index), WIKIPEDIA);
  // Not in the catalog (the E2E fixture, an import): recognised by its Kiwix name.
  assert.equal(collectionOf(item('wikipedia_en_100_mini', { catalogId: null }), index), WIKIPEDIA);
  assert.equal(collectionOf(item('wikipedia_fr_all_maxi', { catalogId: null }), index), WIKIPEDIA);
  assert.equal(collectionOf(item('wikipedia_en_medicine_maxi', { catalogId: null }), index), OTHER);
});

test('a second copy of a catalog archive is filed by its catalog id', () => {
  assert.equal(collectionOf(item('devdocs_en_node_1a2b3c4d', { catalogId: 'devdocs_en_node' }), index), 'computing');
});

test('courses, known categories and the rest', () => {
  assert.equal(collectionOf(item('freecodecamp_es_all', { isCourse: true }), index), COURSES);
  assert.equal(collectionOf(item('some_kiwix_book', { catalogId: null, category: 'survival' }), index), 'survival');
  assert.equal(collectionOf(item('some_kiwix_book', { catalogId: null, category: 'gaming' }), index), OTHER);
  assert.equal(collectionOf(item('a1b2-uuid', { catalogId: null }), index), OTHER);
});

test('count: catalog resources plus extra archives filed in the collection', () => {
  const none = () => false;
  assert.deepEqual(collectionCount(['a', 'b', 'c'], [], [], none), { have: 0, total: 3 });
  const installed = new Set(['a', 'c']);
  assert.deepEqual(collectionCount(['a', 'b', 'c'], [], ['a', 'c'], (id) => installed.has(id)), { have: 2, total: 3 });
  assert.deepEqual(collectionCount(['a', 'b'], [], ['a', null, 'imported'], (id) => id === 'a'), { have: 3, total: 4 });
});

test('a resource filed in another collection, or held by a bigger edition, still counts', () => {
  // freeCodeCamp is filed under Courses, but Computing lists it too; "top" is inside the installed "all".
  const has = (id: string) => ['freecodecamp_es_all', 'wiki_all'].includes(id) || id === 'wiki_top';
  assert.deepEqual(collectionCount(['freecodecamp_es_all', 'devdocs'], [], [], has), { have: 1, total: 2 });
  assert.deepEqual(collectionCount(['wiki_top', 'wiki_all', 'wiki_maxi'], [], ['wiki_all'], has), { have: 2, total: 3 });
});

test('the same work in another language neither counts nor adds to the total when installed', () => {
  const has = (id: string) => id === 'ifixit_en';
  assert.deepEqual(collectionCount(['ifixit_es', 'stack_en'], ['ifixit_en'], ['ifixit_en'], has), { have: 0, total: 2 });
});
