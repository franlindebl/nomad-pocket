import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fileKind, fileLabel, filterCollection, parseCollection } from './collection.ts';

// Shape of zimgit-water_en_2024-08's database.js (Python repr from nautilus).
const WATER = `var DATABASE = [
{'_id': '00000', 'ti': 'Distillation For Home Water Treatment', 'dsc': 'For people with a water quality problem ', 'aut': 'Michigan State University', 'fp': ['Water (1).pdf']},
{'_id': '00001', 'ti': 'Purifying Water During an Emergency', 'dsc': 'The treatments described work only to remove bacteria or viruses from water', 'aut': 'Washington State Dept of Health', 'fp': ['Water (2).pdf']},
];
`;

test('reads a nautilus database', () => {
  const docs = parseCollection(WATER);
  assert.deepEqual(docs?.[0], {
    id: '00000',
    title: 'Distillation For Home Water Treatment',
    author: 'Michigan State University',
    description: 'For people with a water quality problem',
    files: ['files/Water (1).pdf'],
  });
  assert.equal(docs?.length, 2);
});

test('handles Python repr quoting and escapes', () => {
  const js = `var DATABASE = [
    {"_id": "1", "ti": "Women's health", 'aut': 'Klein, Miller, and Thomson', 'dsc': 'Care for pregnancy, birth, and women\\'s health', 'fp': ['a.pdf', 'b.pdf']},
    {'_id': '2', 'ti': 'Caf\\xe9 \\u00e9t\\u00e9', 'dsc': None, 'aut': '', 'fp': ['c.mp4'], 'extra': [1, 2.5, True]},
  ];`;
  const docs = parseCollection(js);
  assert.equal(docs?.[0].title, "Women's health");
  assert.equal(docs?.[0].description, "Care for pregnancy, birth, and women's health");
  assert.deepEqual(docs?.[0].files, ['files/a.pdf', 'files/b.pdf']);
  assert.equal(docs?.[1].title, 'Café été');
  assert.equal(docs?.[1].description, '');
});

test('skips documents without files and falls back to the file name', () => {
  const docs = parseCollection(`DATABASE = [{'ti': 'Empty', 'fp': []}, {'_id': 'x', 'fp': ['Knots.pdf']}]`);
  assert.deepEqual(docs, [{ id: 'x', title: 'Knots.pdf', author: '', description: '', files: ['files/Knots.pdf'] }]);
});

test('anything else is not a collection', () => {
  assert.equal(parseCollection('var other = [1, 2];'), null);
  assert.equal(parseCollection("var DATABASE = [{'ti': 'broken"), null);
  assert.equal(parseCollection('var DATABASE = [];'), null);
});

test('filters on every word, ignoring case and accents', () => {
  const docs = parseCollection(WATER) ?? [];
  assert.equal(filterCollection(docs, '').length, 2);
  assert.deepEqual(
    filterCollection(docs, 'michigan WATER').map((d) => d.id),
    ['00000'],
  );
  assert.deepEqual(
    filterCollection(docs, 'purifying emergencý').map((d) => d.id),
    ['00001'],
  );
  assert.equal(filterCollection(docs, 'knots').length, 0);
});

test('file kinds and labels', () => {
  assert.equal(fileKind('files/Water (1).PDF'), 'pdf');
  assert.equal(fileKind('files/a.webm'), 'video');
  assert.equal(fileKind('files/a.mp3'), 'audio');
  assert.equal(fileKind('files/a.epub'), 'other');
  assert.equal(fileLabel('files/Water (1).pdf'), 'Water (1).pdf');
});
