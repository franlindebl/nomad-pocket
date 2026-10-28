// The family plan as passages for the assistant: "where do we meet?", "what is Lucas allergic
// to?" or "where is the gas valve?" are answered from what the user wrote, like any library
// source. The labels carry the words people ask with ("allergic", "dónde quedamos"), since
// ranking is by shared words, but no topic words ("water", "gas"): every water question would
// cite the home notes. Everything stays on the device: the passages only go into the
// prompt of an on-device model. Pure, no `@/` imports (passages.test.ts).
import type { PrepareData } from './types.ts';

/** Item id of plan sources in assistant answers: the chip opens the plan, not the reader. */
export const PLAN_SOURCE = 'prepare:plan';

export type PlanPassage = { section: string; title: string; text: string };

type Lang = 'es' | 'en';

const L = {
  es: {
    plan: 'Plan familiar',
    meeting: ['Puntos de encuentro', 'Puntos de encuentro (dónde quedamos o nos reunimos si no hay cobertura ni teléfono)'],
    primary: 'Principal',
    secondary: 'Alternativo',
    contacts: ['Contactos', 'Contactos de emergencia (teléfonos de la familia, amigos y vecinos)'],
    people: 'Salud',
    person: (name: string) => `Salud de ${name}`,
    medications: 'Medicación (medicinas, pastillas)',
    allergies: 'Alergias (alérgico, alérgica)',
    bloodType: 'Grupo sanguíneo (sangre)',
    note: 'Nota',
    numbers: ['Números importantes', 'Números importantes (seguros, banco, pólizas, referencias)'],
    home: ['Notas de casa', 'Notas de casa (llaves de paso, garaje, cerraduras, edificio)'],
  },
  en: {
    plan: 'Family plan',
    meeting: ['Meeting points', 'Meeting points (where we meet or gather if phones are down)'],
    primary: 'Main',
    secondary: 'Backup',
    contacts: ['Contacts', 'Emergency contacts (phone numbers of family, friends and neighbours)'],
    people: 'Health',
    person: (name: string) => `Health of ${name}`,
    medications: 'Medication (medicines, pills)',
    allergies: 'Allergies (allergic)',
    bloodType: 'Blood type (blood group)',
    note: 'Note',
    numbers: ['Important numbers', 'Important numbers (insurance, bank, policies, references)'],
    home: ['Home notes', 'Home notes (shut-off valves, garage, locks, building)'],
  },
} as const;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const sentence = (s: string) => (/[.!?…:]$/.test(s) ? s : `${s}.`);

/** The non-empty parts of the plan, one passage per section (one per person for health). */
export function planPassages(data: PrepareData, lang: Lang): PlanPassage[] {
  const l = L[lang];
  const out: PlanPassage[] = [];
  const add = (section: string, heading: string, body: string[]) => {
    const parts = body.map(clean).filter(Boolean);
    if (parts.length) out.push({ section, title: `${l.plan} · ${heading}`, text: parts.join(' ') });
  };

  const meeting = (label: string, p: PrepareData['meeting']['primary']) =>
    p && clean(p.place) ? `${label}: ${sentence(clean(p.place))}${clean(p.details) ? ` ${sentence(clean(p.details))}` : ''}` : '';
  const meetings = [meeting(l.primary, data.meeting.primary), meeting(l.secondary, data.meeting.secondary)].filter(Boolean);
  if (meetings.length) add('meeting', l.meeting[0], [`${l.meeting[1]}:`, ...meetings]);

  const contacts = data.contacts
    .filter((c) => clean(c.name) || clean(c.phone))
    .map((c) => sentence(`${clean(c.name)}${clean(c.relation) ? ` (${clean(c.relation)})` : ''}${clean(c.phone) ? `: ${clean(c.phone)}` : ''}${clean(c.note) ? `, ${clean(c.note)}` : ''}`));
  if (contacts.length) add('contacts', l.contacts[0], [`${l.contacts[1]}:`, ...contacts]);

  for (const p of data.people) {
    const name = clean(p.name);
    const facts = [
      clean(p.medications) && `${l.medications}: ${sentence(clean(p.medications))}`,
      clean(p.allergies) && `${l.allergies}: ${sentence(clean(p.allergies))}`,
      clean(p.bloodType) && `${l.bloodType}: ${sentence(clean(p.bloodType))}`,
      clean(p.note) && `${l.note}: ${sentence(clean(p.note))}`,
    ].filter(Boolean) as string[];
    if (name && facts.length) add(`person:${p.id}`, `${l.people} · ${name}`, [`${l.person(name)}:`, ...facts]);
  }

  const numbers = data.numbers
    .filter((n) => clean(n.label) || clean(n.value))
    .map((n) => sentence(`${clean(n.label)}${clean(n.value) ? `: ${clean(n.value)}` : ''}${clean(n.note) ? `, ${clean(n.note)}` : ''}`));
  if (numbers.length) add('numbers', l.numbers[0], [`${l.numbers[1]}:`, ...numbers]);

  if (clean(data.homeNotes)) add('home', l.home[0], [`${l.home[1]}:`, data.homeNotes]);
  return out;
}
