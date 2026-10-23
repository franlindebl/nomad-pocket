import * as Network from 'expo-network';

import rawCatalog from '@/data/catalog.json';
import i18n from '@/i18n';
import { enqueueDownload, type DownloadRecord } from '@/features/downloads/manager';
import { useSettings } from '@/stores/settings';

import { resolveLatest } from './opds';
import type { Catalog, CatalogCategory, CatalogResource, CatalogTier, Localized } from './types';

export * from './types';

export const catalog = rawCatalog as unknown as Catalog;

export function loc(value: Localized | string | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return i18n.language === 'es' ? value.es : value.en;
}

export function getResource(id: string): CatalogResource | undefined {
  return catalog.resources[id];
}

export function getCategory(slug: string): CatalogCategory | undefined {
  return catalog.categories.find((c) => c.slug === slug);
}

/** A resource is visible when its language is one of the user's content languages. */
export function matchesLanguages(r: CatalogResource, langs: string[]): boolean {
  return r.language === 'mul' || langs.includes(r.language);
}

/** Resources of a tier including the tiers it builds on (cumulative), filtered by language. */
export function tierResources(category: CatalogCategory, tier: CatalogTier, langs: string[]): CatalogResource[] {
  const seen = new Set<string>();
  const out: CatalogResource[] = [];
  const visit = (t: CatalogTier | undefined) => {
    if (!t) return;
    if (t.includesTier) visit(category.tiers.find((x) => x.slug === t.includesTier));
    for (const id of t.resources) {
      const r = catalog.resources[id];
      if (r && !seen.has(id) && matchesLanguages(r, langs)) {
        seen.add(id);
        out.push(r);
      }
    }
  };
  visit(tier);
  return out;
}

/** Only the resources a tier adds on top of the tier it includes. */
export function tierOwnResources(tier: CatalogTier, langs: string[]): CatalogResource[] {
  return tier.resources.map((id) => catalog.resources[id]).filter((r): r is CatalogResource => !!r && matchesLanguages(r, langs));
}

export function sumMB(resources: CatalogResource[]): number {
  return resources.reduce((s, r) => s + r.sizeMB, 0);
}

export function courseResources(langs: string[]): CatalogResource[] {
  return catalog.courses.map((id) => catalog.resources[id]).filter((r): r is CatalogResource => !!r && matchesLanguages(r, langs));
}

export class WifiRequiredError extends Error {
  constructor() {
    super('WIFI_REQUIRED');
  }
}

export class OfflineError extends Error {
  constructor() {
    super('OFFLINE');
  }
}

async function checkNetwork() {
  const state = await Network.getNetworkStateAsync();
  if (state.isConnected === false || state.isInternetReachable === false) throw new OfflineError();
  if (useSettings.getState().wifiOnly && state.type === Network.NetworkStateType.CELLULAR) throw new WifiRequiredError();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/**
 * Queue a catalog ZIM for download. Uses the newest version from the Kiwix OPDS
 * catalog when reachable, else the pinned URL.
 */
export async function downloadResource(r: CatalogResource): Promise<DownloadRecord> {
  await checkNetwork();
  let url = r.url;
  let bytes = r.sizeMB * 1e6;
  let version = r.version;
  try {
    const latest = await withTimeout(resolveLatest(r.kiwixName ?? r.id), 5000);
    if (latest?.url) {
      url = latest.url;
      bytes = latest.sizeBytes || bytes;
      version = latest.version || version;
    }
  } catch {
    // keep pinned URL
  }
  const filename = decodeURIComponent(url.split('/').pop() ?? `${r.id}.zim`);
  return enqueueDownload({
    id: r.id,
    kind: 'zim',
    title: loc(r.title),
    url,
    filename,
    expectedBytes: bytes,
    meta: {
      catalogId: r.id,
      title: loc(r.title),
      description: loc(r.description),
      language: r.language,
      category: r.category,
      isCourse: !!r.isCourse,
      subject: r.subject ?? null,
      medical: !!r.medical,
      version,
      sourceUrl: url,
    },
  });
}
