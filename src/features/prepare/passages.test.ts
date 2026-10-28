/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rankChunks, relevantChunks, type Chunk } from '../assistant/rag-core.ts';

import { planPassages } from './passages.ts';
import type { PrepareData } from './types.ts';

const DATA: PrepareData = {
  contacts: [
    { id: 'c1', name: 'Ana López', relation: 'Hermana', phone: '600 123 456', note: 'Vive en Getafe' },
    { id: 'c2', name: ' ', relation: '', phone: '', note: '' },
  ],
  numbers: [{ id: 'n1', label: 'Seguro del hogar', value: 'Póliza 1234567', note: '' }],
  people: [
    { id: 'p1', name: 'Lucas', medications: 'Ventolin', allergies: 'Penicilina', bloodType: 'A+', note: '' },
    { id: 'p2', name: 'Marta', medications: '', allergies: '', bloodType: '', note: '' },
  ],
  meeting: {
    primary: { place: 'Puerta del colegio', details: 'A las 18:00, esperar una hora', markerId: null, lat: null, lon: null },
    secondary: null,
  },
  homeNotes: 'La llave de paso del gas está bajo el fregadero',
  household: { adults: 2, children: 1, pets: 0, days: 3 },
  kit: {},
  custom: [],
};

test('planPassages: one passage per filled section, people with facts only', () => {
  const out = planPassages(DATA, 'es');
  assert.deepEqual(
    out.map((p) => p.section),
    ['meeting', 'contacts', 'person:p1', 'numbers', 'home'],
  );
  const meeting = out[0];
  assert.equal(meeting.title, 'Plan familiar · Puntos de encuentro');
  assert.match(meeting.text, /Principal: Puerta del colegio\. A las 18:00, esperar una hora\./);
  assert.match(out[1].text, /Ana López \(Hermana\): 600 123 456, Vive en Getafe\./);
  assert.equal(out[1].text.match(/\./g)?.length, 1, 'the empty contact adds nothing');
  assert.match(out[2].text, /Alergias \(alérgico, alérgica\): Penicilina\./);
});

test('an empty plan gives nothing', () => {
  const empty: PrepareData = { ...DATA, contacts: [], numbers: [], people: [], meeting: { primary: null, secondary: null }, homeNotes: ' ' };
  assert.deepEqual(planPassages(empty, 'en'), []);
});

test('the plan passage wins for the questions it answers', () => {
  const chunks: Chunk[] = [
    ...planPassages(DATA, 'en').map((p, i) => ({ sourceKey: p.section, title: p.title, text: p.text, index: 0, hitRank: i })),
    { sourceKey: 'wiki', title: 'Penicillin', text: 'Penicillin is a group of antibiotics. Allergic reactions to penicillin occur in up to 10% of people.', index: 0 },
    { sourceKey: 'gas', title: 'Natural gas', text: 'Natural gas is a fossil fuel. A gas leak should be reported; shut off the valve.', index: 0 },
  ];
  const ranked = (q: string) => relevantChunks(q, rankChunks(q, chunks, 5)).map((s) => s.item.sourceKey);
  assert.equal(ranked('What is Lucas allergic to?')[0], 'person:p1');
  assert.equal(ranked('Where do we meet if phones are down?')[0], 'meeting');
  assert.equal(ranked("What is Ana's phone number?")[0], 'contacts');
  // The library's article may come first; the user's own note is there too.
  assert.ok(ranked('Where is the gas shut-off valve?').slice(0, 2).includes('home'));
  // A plain topic question doesn't drag the plan in.
  assert.ok(!ranked('How do I purify water?').includes('home'));
});

test('Spanish questions find the Spanish plan', () => {
  const chunks: Chunk[] = [
    ...planPassages(DATA, 'es').map((p) => ({ sourceKey: p.section, title: p.title, text: p.text, index: 0 })),
    { sourceKey: 'wiki', title: 'Encuentro', text: 'Un encuentro es una reunión de personas en un lugar.', index: 0 },
  ];
  const top = (q: string) => relevantChunks(q, rankChunks(q, chunks, 5))[0]?.item.sourceKey;
  assert.equal(top('¿Dónde quedamos si no nos localizamos?'), 'meeting');
  assert.equal(top('¿Cuál es nuestro punto de encuentro?'), 'meeting');
  assert.equal(top('¿A qué es alérgico Lucas?'), 'person:p1');
  assert.equal(top('¿Qué grupo sanguíneo tiene Lucas?'), 'person:p1');
  assert.equal(top('¿Cuál es el teléfono de Ana?'), 'contacts');
});
