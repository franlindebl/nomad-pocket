import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fold, searchCatalog } from './search-core.ts';

const r = (id: string, title: string, description: string) => ({ id, title: { es: title, en: title }, description: { es: description, en: description } });
const resources = [
  r('hundred', 'Hundred Rabbits', 'Vivir en un barco: energía, agua y comida'),
  r('water', 'Tratamiento del agua', 'Potabilizar agua con filtros, lejía o calor'),
  r('ted', 'TED: agua', 'Charlas sobre el agua'),
  r('knots', 'Biblioteca de nudos', 'Cómo hacer cada nudo'),
];

test('fold drops accents and case', () => {
  assert.equal(fold('Energía ÁGUA'), 'energia agua');
});

test('title matches first, then description matches, in catalog order', () => {
  assert.deepEqual(
    searchCatalog(resources, 'agua', 'es').map((x) => x.id),
    ['water', 'ted', 'hundred'],
  );
});

test('every word must match the start of a word', () => {
  assert.deepEqual(
    searchCatalog(resources, 'potab agu', 'es').map((x) => x.id),
    ['water'],
  );
  assert.deepEqual(searchCatalog(resources, 'gua', 'es'), []);
});

test('accents in the query or the text do not matter', () => {
  assert.deepEqual(
    searchCatalog(resources, 'energia', 'es').map((x) => x.id),
    ['hundred'],
  );
  assert.deepEqual(
    searchCatalog(resources, 'CÓMO', 'es').map((x) => x.id),
    ['knots'],
  );
});

test('empty query and the limit', () => {
  assert.deepEqual(searchCatalog(resources, '  ', 'es'), []);
  assert.equal(searchCatalog(resources, 'agua', 'es', 2).length, 2);
});
