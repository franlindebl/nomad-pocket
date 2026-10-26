// The user's emergency plan and kit, persisted as one JSON document in the kv-store
// (key `prepare`). A handful of small lists: no SQL tables needed. Side effects that
// go with some edits (expiry reminders) live in reminders.ts.
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_HOUSEHOLD, HOUSEHOLD_MAX, type Household } from './kit';
import type { EntryKind, EntryOf, KitEntry, MeetingPoint, MeetingSlot, PrepareData } from './types';

const EMPTY: PrepareData = {
  contacts: [],
  numbers: [],
  people: [],
  meeting: { primary: null, secondary: null },
  homeNotes: '',
  household: DEFAULT_HOUSEHOLD,
  kit: {},
  custom: [],
};

export const EMPTY_KIT_ENTRY: KitEntry = { have: false, expires: null, note: '', reminderId: null };

const LIST = { contact: 'contacts', number: 'numbers', person: 'people' } as const satisfies Record<EntryKind, keyof PrepareData>;

type Actions = {
  saveEntry: <K extends EntryKind>(kind: K, entry: EntryOf<K>) => void;
  removeEntry: (kind: EntryKind, id: string) => void;
  setMeeting: (slot: MeetingSlot, point: MeetingPoint | null) => void;
  setHomeNotes: (notes: string) => void;
  setHousehold: (patch: Partial<Household>) => void;
  setKitEntry: (id: string, patch: Partial<KitEntry>) => void;
  addCustom: (id: string, name: string) => void;
  renameCustom: (id: string, name: string) => void;
  removeCustom: (id: string) => void;
  reset: () => void;
};

const clamp = (n: number) => Math.max(0, Math.min(HOUSEHOLD_MAX, Math.round(n)));

export const usePrepare = create<PrepareData & Actions>()(
  persist(
    (set) => ({
      ...EMPTY,
      saveEntry: (kind, entry) =>
        set((s) => {
          const list = s[LIST[kind]] as EntryOf<typeof kind>[];
          const exists = list.some((e) => e.id === entry.id);
          return { [LIST[kind]]: exists ? list.map((e) => (e.id === entry.id ? entry : e)) : [...list, entry] };
        }),
      removeEntry: (kind, id) => set((s) => ({ [LIST[kind]]: (s[LIST[kind]] as { id: string }[]).filter((e) => e.id !== id) })),
      setMeeting: (slot, point) => set((s) => ({ meeting: { ...s.meeting, [slot]: point } })),
      setHomeNotes: (homeNotes) => set({ homeNotes }),
      setHousehold: (patch) =>
        set((s) => {
          const next = { ...s.household, ...patch };
          // At least one person: the maths is per person.
          return {
            household: { ...next, adults: Math.max(1, clamp(next.adults)), children: clamp(next.children), pets: clamp(next.pets) },
          };
        }),
      setKitEntry: (id, patch) => set((s) => ({ kit: { ...s.kit, [id]: { ...EMPTY_KIT_ENTRY, ...s.kit[id], ...patch } } })),
      addCustom: (id, name) => set((s) => ({ custom: [...s.custom, { id, name }] })),
      renameCustom: (id, name) => set((s) => ({ custom: s.custom.map((c) => (c.id === id ? { ...c, name } : c)) })),
      removeCustom: (id) =>
        set((s) => {
          const kit = { ...s.kit };
          delete kit[id];
          return { custom: s.custom.filter((c) => c.id !== id), kit };
        }),
      reset: () => set(EMPTY),
    }),
    {
      name: 'prepare',
      version: 1,
      storage: createJSONStorage(() => Storage),
      partialize: ({ contacts, numbers, people, meeting, homeNotes, household, kit, custom }) => ({
        contacts,
        numbers,
        people,
        meeting,
        homeNotes,
        household,
        kit,
        custom,
      }),
    },
  ),
);

export function getKitEntry(id: string): KitEntry {
  // Ids come from route params too: `constructor` must not find Object's.
  const { kit } = usePrepare.getState();
  return Object.hasOwn(kit, id) ? kit[id] : EMPTY_KIT_ENTRY;
}
