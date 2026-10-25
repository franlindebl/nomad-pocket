// Shapes of the emergency plan and kit the user fills in. Everything stays on the device
// (kv-store key `prepare`, see store.ts); the only way out is a PDF the user shares.
import type { Household } from './kit.ts';

export type Contact = { id: string; name: string; relation: string; phone: string; note: string };
export type ImportantNumber = { id: string; label: string; value: string; note: string };
export type Person = { id: string; name: string; medications: string; allergies: string; bloodType: string; note: string };

/** The editable lists of the plan, all edited by the same form (entry.tsx). */
export type EntryKind = 'contact' | 'number' | 'person';
export type EntryOf<K extends EntryKind> = K extends 'contact' ? Contact : K extends 'number' ? ImportantNumber : Person;

export type MeetingSlot = 'primary' | 'secondary';
/** Where to meet if phones are down. `markerId` links a map pin; lat/lon are copied so
 *  the plan keeps the place if the pin is deleted. */
export type MeetingPoint = { place: string; details: string; markerId: number | null; lat: number | null; lon: number | null };

export type KitEntry = { have: boolean; expires: string | null; note: string; reminderId: string | null };
export type CustomItem = { id: string; name: string };

export type PrepareData = {
  contacts: Contact[];
  numbers: ImportantNumber[];
  people: Person[];
  meeting: Record<MeetingSlot, MeetingPoint | null>;
  homeNotes: string;
  household: Household;
  /** By kit item id (template ids from kit.ts, or a CustomItem id). */
  kit: Record<string, KitEntry>;
  custom: CustomItem[];
};
