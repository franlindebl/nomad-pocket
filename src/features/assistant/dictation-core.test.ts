/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dictationLocale, joinDictation } from './dictation-core.ts';

test('dictationLocale follows the phone region for the app language', () => {
  assert.equal(dictationLocale('es', ['es-MX', 'en-US']), 'es-MX');
  assert.equal(dictationLocale('es', ['en-GB']), 'es-ES');
  assert.equal(dictationLocale('en', ['es-ES', 'en-GB']), 'en-GB');
  assert.equal(dictationLocale('en', ['en']), 'en-US');
  assert.equal(dictationLocale('es', ['es_AR']), 'es-AR');
});

test('dictationLocale picks a supported locale when the list is known', () => {
  assert.equal(dictationLocale('es', ['es-AR'], ['es-ES', 'es-MX', 'en-US']), 'es-ES');
  assert.equal(dictationLocale('es', ['es-MX'], ['es-ES', 'es-MX']), 'es-MX');
  assert.equal(dictationLocale('es', [], ['es-US', 'en-US']), 'es-US');
  assert.equal(dictationLocale('es', ['es-MX'], ['en-US']), 'es-MX');
});

test('joinDictation appends what is said to what was typed', () => {
  assert.equal(joinDictation('', ' hola '), 'hola');
  assert.equal(joinDictation('¿Cómo', 'enciendo fuego?'), '¿Cómo enciendo fuego?');
  assert.equal(joinDictation('Hola ', 'qué tal'), 'Hola qué tal');
  assert.equal(joinDictation('Hola', ''), 'Hola');
  assert.equal(joinDictation('  ', 'hola'), 'hola');
});
