/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cardNotes, GuideIndex, provenance, sourceCards, visibleCards, cardAnswer, vitalCard, type GuideCard, type GuideText } from './guide-core.ts';

const text = (title: string, keywords: string[], body: string, extra: Partial<GuideText> = {}): GuideText => ({
  title,
  kind: 'excerpt',
  sources: [{ agency: 'CDC', title: 'Page', url: 'https://www.cdc.gov/x', date: '2026' }],
  licence: 'Public domain',
  keywords,
  body,
  ...extra,
});

const NUMBERS: Record<string, string> = { 'cpr-adult': '1.1', choking: '1.3', 'choking-infant': '1.4', 'recovery-position': '1.7', 'water-bleach': '3.2', 'toilets-no-water': '11.5' };

const card = (id: string, vital: boolean, health: boolean, es: GuideText, en: GuideText, see: string[] = []): GuideCard => ({
  id,
  number: NUMBERS[id],
  section: 1,
  vital,
  health,
  see,
  es,
  en,
});

const CARDS = [
  card(
    'cpr-adult',
    true,
    true,
    text('RCP en adultos', ['rcp', 'no respira', 'parada cardiaca', 'inconsciente', 'se ha desmayado', 'masaje cardiaco'], 'Llame al 911. Empuje fuerte y rápido en el centro del pecho.'),
    text('CPR for adults', ['cpr', 'not breathing', 'cardiac arrest', 'unconscious'], 'Call 911. Push hard and fast in the center of the chest.'),
  ),
  card(
    'choking',
    true,
    true,
    text('Atragantamiento en adultos y niños', ['atragantamiento', 'atragantado', 'se ahoga con comida', 'no puede respirar'], 'Dé cinco golpes en la espalda.'),
    text('Choking in adults and children', ['choking', 'food stuck'], 'Give five back blows.'),
    ['choking-infant'],
  ),
  card(
    'choking-infant',
    true,
    true,
    text('Atragantamiento en bebés (menores de 1 año)', ['bebé atragantado', 'bebé se atraganta', 'atragantamiento bebé', 'lactante'], 'Pon al bebé boca abajo sobre tu antebrazo.', {
      kind: 'own',
      basis: 'ERC 2025',
    }),
    text('Choking in babies', ['baby choking', 'infant choking'], 'Lay the baby face down along your forearm.', { kind: 'own', basis: 'ERC 2025' }),
  ),
  card(
    'recovery-position',
    true,
    true,
    text('Posición lateral de seguridad', ['posición lateral', 'inconsciente pero respira', 'desmayado', 'se ha desmayado'], 'Si la persona respira, póngala de lado.'),
    text('Recovery position', ['recovery position', 'passed out', 'unconscious but breathing'], 'If the person is breathing, roll them onto their side.'),
  ),
  card(
    'water-bleach',
    true,
    false,
    text('Desinfectar agua con lejía', ['lejía', 'potabilizar agua', 'cloro', 'agua potable'], 'Añada 8 gotas por galón.', { note: 'En España la lejía va del 3,5 al 6 %.' }),
    text('Disinfecting water with bleach', ['bleach', 'drinking water', 'chlorine'], 'Add 8 drops per gallon.'),
  ),
  card(
    'toilets-no-water',
    false,
    false,
    text('Váter sin agua', ['cisterna', 'inodoro', 'cubo', 'aseo sin agua'], 'Usa un cubo con una bolsa.'),
    text('Toilets without water', ['toilet', 'bucket'], 'Use a bucket with a bag.'),
  ),
];

describe('guide search', () => {
  const es = new GuideIndex(CARDS, 'es');
  const en = new GuideIndex(CARDS, 'en');

  test('a vital question gets its card', () => {
    assert.equal(vitalCard(es, '¿Cómo se hace la RCP?')?.id, 'cpr-adult');
    assert.equal(vitalCard(es, 'Mi padre está inconsciente y no respira, ¿qué hago?')?.id, 'cpr-adult');
    assert.equal(vitalCard(en, 'my friend is choking on food')?.id, 'choking');
    assert.equal(vitalCard(es, '¿Cuánta lejía para potabilizar agua?')?.id, 'water-bleach');
  });

  test('a negation stays with its word: not breathing is CPR, not the recovery position', () => {
    assert.equal(vitalCard(es, 'Mi padre se ha desmayado y no respira')?.id, 'cpr-adult');
    assert.equal(vitalCard(es, 'Se ha desmayado pero respira')?.id, 'recovery-position');
  });

  test('the general card goes before a specific one the question does not name', () => {
    assert.equal(vitalCard(es, 'atragantamiento')?.id, 'choking');
    assert.equal(vitalCard(es, 'mi bebé se atraganta')?.id, 'choking-infant');
  });

  test('who it happens to and how people ask are not the topic', () => {
    assert.equal(vitalCard(es, 'Primeros auxilios: mi amiga no respira y no llega la ambulancia')?.id, 'cpr-adult');
  });

  test('a question that only touches a vital card answers with the model', () => {
    assert.equal(vitalCard(es, 'Estamos sin luz, la nevera no enfría y tengo fiebre: ¿qué hago con la comida y el agua?'), null);
    assert.equal(vitalCard(es, '¿Cómo hago fuego sin mechero?'), null);
    // "potabilizar" is a keyword, but the card never says "filtro".
    assert.equal(vitalCard(es, '¿Cómo fabrico un filtro para potabilizar agua?'), null);
  });

  test('a non-vital card never answers alone', () => {
    assert.equal(vitalCard(es, 'no tengo agua en la cisterna del inodoro'), null);
    assert.deepEqual(
      sourceCards(es, 'no tengo agua en la cisterna del inodoro').map((c) => c.id),
      ['toilets-no-water'],
    );
  });

  test('a follow-up is matched with the earlier question', () => {
    const history = [
      { role: 'user' as const, content: 'Se está atragantando con comida' },
      { role: 'assistant' as const, content: '…' },
    ];
    assert.equal(vitalCard(es, '¿Y si es un bebé?', history)?.id, 'choking-infant');
  });

  test('health cards are hidden without health features', () => {
    const ids = visibleCards(CARDS, false).map((c) => c.id);
    assert.deepEqual(ids, ['water-bleach', 'toilets-no-water']);
    assert.equal(vitalCard(new GuideIndex(visibleCards(CARDS, false), 'es'), '¿Cómo se hace la RCP?'), null);
  });
});

describe('guide answers', () => {
  test('provenance says what kind of text it is', () => {
    assert.equal(provenance(CARDS[0].es, 'es'), 'Fragmento de CDC, «Page» (2026).');
    assert.equal(provenance(CARDS[0].en, 'en'), 'Excerpt from CDC, “Page” (2026).');
    assert.equal(provenance(CARDS[2].es, 'es'), 'Redactado por Nomad Pocket según ERC 2025.');
  });

  test('notes point 911 to the local number and add the card note', () => {
    assert.deepEqual(cardNotes(CARDS[0], 'es', '112'), ['Donde el texto dice 911, llama al 112.']);
    assert.deepEqual(cardNotes(CARDS[0], 'en', '911'), ['Emergency number: 911.']);
    assert.deepEqual(cardNotes(CARDS[4], 'es', '112'), ['Número de emergencias: 112.', 'En España la lejía va del 3,5 al 6 %.']);
    assert.deepEqual(cardNotes(CARDS[5], 'es', '112'), []);
  });

  test('a vital answer is the card unchanged, cited as source 1', () => {
    const a = cardAnswer(CARDS[0], 'es', '112');
    assert.ok(a.startsWith('**Guía de emergencias: RCP en adultos**\n\n'));
    assert.ok(a.includes('\n\nLlame al 911. Empuje fuerte y rápido en el centro del pecho.\n\n'));
    assert.ok(a.includes('> Donde el texto dice 911, llama al 112.'));
    assert.ok(a.endsWith('*Fragmento de CDC, «Page» (2026).* [1]'));
  });
});
