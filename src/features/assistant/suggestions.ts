// Questions the assistant's empty screen suggests, a few at a time, rotating. Each one is known to land on its
// emergency guide card (suggestions.test.ts runs them through the guide's search in both languages): a vital
// one is answered with the card word for word, even with no model; the others give the model that card as its
// first source. Texts live in the `assistant` namespace (`suggestions.<key>`).
// No `@/` imports: unit tests load this file directly.

export type Suggestion = {
  key: string;
  /** The guide card it lands on (hidden on Android when it's about health: the suggestion goes with it). */
  card: string;
  /** Answered with the card itself, no model needed. */
  vital: boolean;
  /** Offered only where this is the emergency number (the 112 card is about Spain and Europe, not the US's 911). */
  number?: string;
};

export const SUGGESTIONS: Suggestion[] = [
  { key: 'cpr', card: 'cpr-adult', vital: true },
  { key: 'choking', card: 'choking', vital: true },
  { key: 'bleeding', card: 'bleeding', vital: true },
  { key: 'burn', card: 'burns', vital: true },
  { key: 'waterBleach', card: 'water-bleach', vital: true },
  { key: 'gasLeak', card: 'gas-leak', vital: true },
  { key: 'earthquake', card: 'earthquake', vital: true },
  { key: 'houseFire', card: 'house-fire', vital: true },
  { key: 'oilFire', card: 'kitchen-oil-fire', vital: true },
  { key: 'heatStroke', card: 'heat-stroke', vital: true },
  { key: 'generator', card: 'generators', vital: true },
  { key: 'call112', card: 'calling-112', vital: true, number: '112' },
  { key: 'lostChild', card: 'lost-child', vital: true },
  { key: 'carbonMonoxide', card: 'carbon-monoxide', vital: true },
  { key: 'fridge', card: 'fridge-outage', vital: false },
  { key: 'phone', card: 'charging-without-mains', vital: false },
  { key: 'kit', card: 'emergency-kit', vital: false },
  { key: 'fire', card: 'making-fire', vital: false },
  { key: 'knot', card: 'knots', vital: false },
  { key: 'compass', card: 'direction-no-compass', vital: false },
  { key: 'toilet', card: 'toilets-no-water', vital: false },
  { key: 'warmHome', card: 'staying-warm-cold-home', vital: false },
  { key: 'water', card: 'boiling-water', vital: false },
];

/** The suggestions this screen can offer: cards this build shows, only vital ones without a model, none about another number. */
export function availableSuggestions(hasCard: (id: string) => boolean, modelReady: boolean, emergencyNumber: string): Suggestion[] {
  return SUGGESTIONS.filter((s) => hasCard(s.card) && (modelReady || s.vital) && (!s.number || s.number === emergencyNumber));
}

/** A shuffled copy (Fisher–Yates), so each visit starts with different questions. */
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type Rotation = { shown: string[]; cursor: number; turn: number };

/** The first `slots` questions of the pool on screen; the rest wait their turn. */
export function startRotation(pool: string[], slots: number): Rotation {
  return { shown: pool.slice(0, slots), cursor: slots, turn: 0 };
}

/**
 * One step: the next question of the pool not already on screen takes slot `order[turn]` (across the grid, so
 * neighbours don't change one after the other). The pool wraps around.
 */
export function rotate(r: Rotation, pool: string[], order: number[]): Rotation {
  if (pool.length <= r.shown.length) return r;
  let i = r.cursor;
  while (r.shown.includes(pool[i % pool.length])) i++;
  const shown = [...r.shown];
  shown[order[r.turn % order.length]] = pool[i % pool.length];
  return { shown, cursor: (i + 1) % pool.length, turn: r.turn + 1 };
}
