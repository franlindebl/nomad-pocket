/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { GuideIndex, sourceCards, vitalCard, type GuideCard } from '../guide/guide-core.ts';
import { guessIntent } from './rag-core.ts';
import { availableSuggestions, rotate, shuffled, startRotation, SUGGESTIONS } from './suggestions.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const cards: GuideCard[] = read('../../data/guide.json').cards;
const byId = new Map(cards.map((c) => [c.id, c]));

test('every suggestion lands on its card, in both languages', () => {
  for (const lang of ['es', 'en'] as const) {
    const texts = read(`../../i18n/locales/${lang}/assistant.json`).suggestions;
    const index = new GuideIndex(cards, lang);
    for (const s of SUGGESTIONS) {
      const q = texts[s.key];
      assert.ok(q, `${lang}: suggestions.${s.key} missing`);
      assert.equal(byId.get(s.card)?.vital, s.vital, `${s.key}: vital flag differs from the card's`);
      if (s.vital) {
        assert.equal(guessIntent(q, []), 'search', q);
        assert.equal(vitalCard(index, q)?.id, s.card, q);
      } else {
        assert.equal(vitalCard(index, q), null, q);
        assert.ok(sourceCards(index, q).some((c) => c.id === s.card), q);
      }
    }
  }
});

test('without a model only vital suggestions, and none whose card is hidden', () => {
  const all = availableSuggestions(() => true, true);
  assert.equal(all.length, SUGGESTIONS.length);
  assert.ok(availableSuggestions(() => true, false).every((s) => s.vital));
  const noHealth = availableSuggestions((id) => !byId.get(id)?.health, true);
  assert.ok(noHealth.length >= 8, 'enough left on Android');
  assert.ok(noHealth.every((s) => !byId.get(s.card)!.health));
});

test('shuffled keeps every item', () => {
  let n = 0;
  const out = shuffled([1, 2, 3, 4, 5], () => (n++ % 3) / 3);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
});

test('rotation changes one slot at a time, never showing a question twice', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f'];
  let r = startRotation(pool, 4);
  assert.deepEqual(r.shown, ['a', 'b', 'c', 'd']);
  r = rotate(r, pool, [0, 3, 1, 2]);
  assert.deepEqual(r.shown, ['e', 'b', 'c', 'd']);
  r = rotate(r, pool, [0, 3, 1, 2]);
  assert.deepEqual(r.shown, ['e', 'b', 'c', 'f']);
  r = rotate(r, pool, [0, 3, 1, 2]);
  assert.deepEqual(r.shown, ['e', 'a', 'c', 'f']);
  for (let i = 0; i < 20; i++) {
    r = rotate(r, pool, [0, 3, 1, 2]);
    assert.equal(new Set(r.shown).size, 4);
  }
  const small = startRotation(['a', 'b'], 4);
  assert.equal(rotate(small, ['a', 'b'], [0]), small);
});
