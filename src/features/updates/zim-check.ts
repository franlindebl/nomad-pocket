// Newer editions of the installed ZIM archives (docs/CONTENT_UPDATES_PLAN.md): Kiwix's OPDS
// catalog asked about each archive by name, at most once a week (or when the person asks), and
// the answers kept in kv so the app knows about them offline.
import * as Network from 'expo-network';
import { create } from 'zustand';

import Storage from '@/db/kv';
import { getResource, isHiddenHealthBook } from '@/features/catalog';
import { resolveLatest } from '@/features/catalog/opds';
import { listItems, type InstalledItem } from '@/features/content/items';
import { HEALTH_FEATURES } from '@/lib/health';

import { checkDue } from './updates-core';

const KEY = 'updates.zim';
/** Archives asked about at once (one or two small OPDS requests each). */
const CONCURRENCY = 3;
const TIMEOUT_MS = 15_000;

export type ZimEdition = { name: string; version: string; url: string; sizeBytes: number };

type Saved = { checkedAt: number | null; latest: Record<string, ZimEdition> };

type State = Saved & { checking: boolean };

function load(): Saved {
  try {
    const raw = JSON.parse(Storage.getItemSync(KEY) ?? 'null') as Saved | null;
    if (raw && typeof raw === 'object' && raw.latest && typeof raw.latest === 'object') return { checkedAt: raw.checkedAt ?? null, latest: raw.latest };
  } catch {
    // a broken entry: check again
  }
  return { checkedAt: null, latest: {} };
}

export const useZimEditions = create<State>(() => ({ ...load(), checking: false }));

/**
 * The Kiwix name an archive is published under ("wikipedia_es_top_mini"), or null: imported files
 * Kiwix doesn't know (their id is a uuid), and health archives in builds without health features.
 */
export function kiwixNameOf(item: InstalledItem): string | null {
  if (item.kind !== 'zim') return null;
  const id = item.catalogId ?? item.id;
  // Ids of unknown imports are the archive's uuid (or "<name>_<uuid prefix>" when the name was taken).
  if (!/^[a-z0-9][\w.-]*_[\w.-]+$/i.test(id) || /_[0-9a-f]{8}$/.test(id)) return null;
  const name = getResource(id)?.kiwixName ?? id;
  if (!HEALTH_FEATURES && (isHiddenHealthBook(name) || item.meta.medical === true)) return null;
  return name;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks Kiwix for the newest edition of every installed archive. `force`: even if the last
 * check is recent. Offline, or when every request fails, the previous answers stay.
 */
export async function checkZimEditions(force = false): Promise<void> {
  const state = useZimEditions.getState();
  if (state.checking || (!force && !checkDue(state.checkedAt, Date.now()))) return;
  const net = await Network.getNetworkStateAsync().catch(() => null);
  if (!net || net.isConnected === false || net.isInternetReachable === false) return;
  const items = listItems('zim').filter((i) => kiwixNameOf(i));
  useZimEditions.setState({ checking: true });
  const latest: Record<string, ZimEdition> = {};
  let answered = 0;
  try {
    const queue = [...items];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const name = kiwixNameOf(item)!;
        try {
          const entry = await withTimeout(resolveLatest(name), TIMEOUT_MS);
          answered++;
          if (entry?.url && entry.version) latest[item.id] = { name, version: entry.version, url: entry.url, sizeBytes: entry.sizeBytes };
        } catch (e) {
          console.warn('[updates] cannot check', name, e);
          // Keep what an earlier check found for it.
          const before = useZimEditions.getState().latest[item.id];
          if (before) latest[item.id] = before;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    const next: Saved = { checkedAt: answered || !items.length ? Date.now() : useZimEditions.getState().checkedAt, latest };
    if (answered || !items.length) Storage.setItemSync(KEY, JSON.stringify(next));
    useZimEditions.setState({ ...(answered || !items.length ? next : {}), checking: false });
  }
}
