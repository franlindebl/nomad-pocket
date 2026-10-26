// zustand `persist` storage on the app's kv-store (db/kv.ts), read synchronously.
// With expo-sqlite's own kv-store the first open migrated inside a transaction and its async
// and sync APIs shared one connection: on a fresh install an async open yielded mid-transaction,
// a sync read failed ("cannot start a transaction within a transaction") and the settings
// hydration hung, so the setup wizard never showed. db/kv.ts opens synchronously; reading
// synchronously also means the stores are hydrated when they are created. Writes stay async.
import { createJSONStorage } from 'zustand/middleware';

import Storage from '@/db/kv';

export function kvStorage<S>() {
  return createJSONStorage<S>(() => ({
    getItem: (name) => Storage.getItemSync(name),
    setItem: (name, value) => Storage.setItem(name, value),
    removeItem: (name) => Storage.removeItem(name),
  }));
}
