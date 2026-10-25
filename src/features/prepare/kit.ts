// Emergency kit: the item template, the household supply maths and expiry months.
// Pure (no React Native, no `@/` aliases) so `node --test` can load it.
//
// Quantities follow Ready.gov and Spain's Protección Civil: about 4 L of water per
// person and day (2 L to drink, the rest to cook and wash), food that needs no cooking,
// and at least 3 days (72 h, the EU preparedness recommendation) of everything.

export type Household = { adults: number; children: number; pets: number; days: number };

export const DAY_OPTIONS = [3, 7, 14] as const;
export const DEFAULT_HOUSEHOLD: Household = { adults: 2, children: 0, pets: 0, days: 3 };
export const HOUSEHOLD_MAX = 20;

export const WATER_L_PER_PERSON_DAY = 4;
export const WATER_L_PER_PET_DAY = 1;
export const KCAL_ADULT_DAY = 2000;
export const KCAL_CHILD_DAY = 1400;
/** Prescriptions: a month in hand, whatever the kit's horizon. */
export const MEDICATION_MIN_DAYS = 30;

export type Supplies = { people: number; waterLiters: number; foodKcal: number; medicationDays: number };

export function supplies(h: Household): Supplies {
  const people = h.adults + h.children;
  return {
    people,
    waterLiters: Math.ceil((people * WATER_L_PER_PERSON_DAY + h.pets * WATER_L_PER_PET_DAY) * h.days),
    foodKcal: (h.adults * KCAL_ADULT_DAY + h.children * KCAL_CHILD_DAY) * h.days,
    medicationDays: Math.max(h.days, MEDICATION_MIN_DAYS),
  };
}

export type KitCategory = 'water' | 'food' | 'light' | 'comms' | 'health' | 'documents' | 'tools' | 'family';

export const KIT_CATEGORIES: KitCategory[] = ['water', 'food', 'light', 'comms', 'health', 'documents', 'tools', 'family'];

export type KitItemDef = {
  /** Stable: it keys the user's checks and expiry dates. Never rename one. */
  id: string;
  category: KitCategory;
  /** Usually has an expiry date worth tracking. */
  perishable?: boolean;
  /** Which computed quantity its subtitle shows. */
  quantity?: 'water' | 'food' | 'medication';
  /** Only listed when the household has children / pets. */
  when?: 'children' | 'pets';
};

export const KIT: KitItemDef[] = [
  { id: 'water', category: 'water', perishable: true, quantity: 'water' },
  { id: 'waterPurification', category: 'water', perishable: true },
  { id: 'food', category: 'food', perishable: true, quantity: 'food' },
  { id: 'canOpener', category: 'food' },
  { id: 'stove', category: 'food' },
  { id: 'flashlight', category: 'light' },
  { id: 'batteries', category: 'light', perishable: true },
  { id: 'powerBank', category: 'light' },
  { id: 'candles', category: 'light' },
  { id: 'radio', category: 'comms' },
  { id: 'whistle', category: 'comms' },
  { id: 'printedPlan', category: 'comms' },
  { id: 'firstAid', category: 'health', perishable: true },
  { id: 'medication', category: 'health', perishable: true, quantity: 'medication' },
  { id: 'painRelief', category: 'health', perishable: true },
  { id: 'hygiene', category: 'health' },
  { id: 'masks', category: 'health' },
  { id: 'cash', category: 'documents' },
  { id: 'documentCopies', category: 'documents' },
  { id: 'spareKeys', category: 'documents' },
  { id: 'multitool', category: 'tools' },
  { id: 'lighter', category: 'tools' },
  { id: 'blanket', category: 'tools' },
  { id: 'clothes', category: 'tools' },
  { id: 'tape', category: 'tools' },
  { id: 'kidsFood', category: 'family', perishable: true, when: 'children' },
  { id: 'kidsEntertainment', category: 'family', when: 'children' },
  { id: 'babySupplies', category: 'family', when: 'children' },
  { id: 'petSupplies', category: 'family', perishable: true, when: 'pets' },
];

/** The template items that apply to this household. */
export function kitFor(h: Household): KitItemDef[] {
  return KIT.filter((i) => !i.when || (i.when === 'children' ? h.children > 0 : h.pets > 0));
}

// ── Expiry months ("YYYY-MM"; an item is good until the end of that month) ──

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value);
}

function index(month: string): number {
  const [, y, m] = MONTH_RE.exec(month) ?? [];
  if (!y) throw new Error(`Bad month: ${month}`);
  return Number(y) * 12 + Number(m) - 1;
}

function fromIndex(i: number): string {
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

export function monthOf(date: Date): string {
  return fromIndex(date.getFullYear() * 12 + date.getMonth());
}

export function addMonths(month: string, n: number): string {
  return fromIndex(index(month) + n);
}

/** Whole months from `now`'s month to `month` (negative when it is in the past). */
export function monthsUntil(month: string, now: Date): number {
  return index(month) - index(monthOf(now));
}

export type ExpiryStatus = 'expired' | 'soon' | 'ok';

/** `soon`: expires this month or the next one, time to replace it. */
export function expiryStatus(month: string, now: Date): ExpiryStatus {
  const left = monthsUntil(month, now);
  return left < 0 ? 'expired' : left <= 1 ? 'soon' : 'ok';
}

/**
 * When to remind: 10:00 on the 1st of the month before expiry, so there is a month to
 * replace it. Null when that moment has passed (the kit screen shows the status instead).
 */
export function reminderDate(month: string, now: Date): Date | null {
  const i = index(month) - 1;
  const at = new Date(Math.floor(i / 12), i % 12, 1, 10, 0, 0);
  return at.getTime() > now.getTime() ? at : null;
}

/** "junio de 2027" / "June 2027". */
export function formatMonth(month: string, locale: string): string {
  const i = index(month);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(Math.floor(i / 12), i % 12, 15));
}
