// Fetching each official source (docs/ALERTS_PLAN.md, "Sources"): timeouts, a User-Agent naming the app (NWS asks
// for one), `If-Modified-Since` where the server honours it, and AEMET's bundle downloaded only when its URL changes.
// Each fetcher returns the source's new cache entry, or throws; check.ts keeps the old entry on a failure.
// E2E builds point every source at a local stand-in (EXPO_PUBLIC_ALERTS_URL, scripts/e2e-alerts-feed.py).
import Constants from 'expo-constants';

import { snap, type LatLon } from './alerts-core';
import { alertsOfAemetBundle, parseAemetRss, parseEmsc, parseGdacs, parseNws, parseUsgs } from './feeds-core';
import type { SourceCache } from './state';
import { xmlFilesOfTarGz } from './tar-core';

const LOCAL = process.env.EXPO_PUBLIC_ALERTS_URL?.replace(/\/$/, '');

export const URLS = {
  aemet: LOCAL ? `${LOCAL}/aemet/rss.xml` : 'https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAE_RSS.xml',
  nws: LOCAL ? `${LOCAL}/nws/alerts/active` : 'https://api.weather.gov/alerts/active',
  usgs: LOCAL ? `${LOCAL}/usgs/4.5_day.geojson` : 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
  emsc: LOCAL ? `${LOCAL}/emsc/query` : 'https://www.seismicportal.eu/fdsnws/event/1/query',
  gdacs: LOCAL ? `${LOCAL}/gdacs/rss_24h.xml` : 'https://www.gdacs.org/xml/rss_24h.xml',
};

const TIMEOUT_MS = 20_000;
/** NWS gets the position snapped to this grid (~5 km): the only time a position, approximate, leaves the phone. */
export const NWS_GRID = 0.05;

const userAgent = () => `NomadPocket/${Constants.expoConfig?.version ?? '0'} (github.com/franlindebl/nomad-pocket)`;

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': userAgent(), ...headers }, signal: controller.signal });
    if (res.status !== 304 && !res.ok) throw new HttpError(res.status);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

const since = (prev: SourceCache | undefined): Record<string, string> =>
  prev?.lastModified && !prev.error ? { 'If-Modified-Since': prev.lastModified } : {};

const unchanged = (prev: SourceCache, now: number): SourceCache => ({ ...prev, fetchedAt: now, error: undefined });

/**
 * AEMET: the RSS (24 KB, 304 when unchanged), then the bundle of every CAP in force (~115 KB) only when the RSS
 * points at a new one. The bundle covers the Península, Baleares, Ceuta, Melilla and Canarias.
 */
async function aemet(prev: SourceCache | undefined, now: number): Promise<SourceCache> {
  const res = await get(URLS.aemet, since(prev));
  if (res.status === 304 && prev) return unchanged(prev, now);
  const rss = parseAemetRss(await res.text());
  if (!rss.bundleUrl) throw new Error('AEMET feed without a bundle');
  const lastModified = res.headers.get('Last-Modified') ?? undefined;
  if (prev && !prev.error && prev.bundleUrl === rss.bundleUrl) return { ...unchanged(prev, now), lastModified };
  const bundle = await get(rss.bundleUrl);
  const alerts = alertsOfAemetBundle(xmlFilesOfTarGz(new Uint8Array(await bundle.arrayBuffer())));
  return { fetchedAt: now, alerts, lastModified, bundleUrl: rss.bundleUrl };
}

/** NWS answers for a point; without a position there is nothing to ask. */
async function nws(prev: SourceCache | undefined, now: number, pos: LatLon | null): Promise<SourceCache> {
  if (!pos) return { fetchedAt: now, alerts: [] };
  const p = snap(pos, NWS_GRID);
  const point = `${p.lat},${p.lon}`;
  const res = await get(`${URLS.nws}?point=${point}`, { Accept: 'application/geo+json' });
  return { fetchedAt: now, alerts: parseNws(await res.json()), point };
}

async function usgs(prev: SourceCache | undefined, now: number): Promise<SourceCache> {
  const res = await get(URLS.usgs, since(prev));
  if (res.status === 304 && prev) return unchanged(prev, now);
  return { fetchedAt: now, alerts: parseUsgs(await res.json()), lastModified: res.headers.get('Last-Modified') ?? undefined };
}

async function emsc(prev: SourceCache | undefined, now: number): Promise<SourceCache> {
  const start = new Date(now - 24 * 3600_000).toISOString().slice(0, 19);
  const res = await get(`${URLS.emsc}?format=json&minmag=4.5&limit=100&start=${start}`);
  // FDSN answers 204 when nothing matches.
  if (res.status === 204) return { fetchedAt: now, alerts: [] };
  return { fetchedAt: now, alerts: parseEmsc(await res.json()) };
}

async function gdacs(prev: SourceCache | undefined, now: number): Promise<SourceCache> {
  const res = await get(URLS.gdacs, since(prev));
  if (res.status === 304 && prev) return unchanged(prev, now);
  return { fetchedAt: now, alerts: parseGdacs(await res.text()), lastModified: res.headers.get('Last-Modified') ?? undefined };
}

export type FetchedSource = 'aemet' | 'nws' | 'usgs' | 'emsc' | 'gdacs';
type Fetcher = (prev: SourceCache | undefined, now: number, pos: LatLon | null) => Promise<SourceCache>;

export const FETCHERS: Record<FetchedSource, Fetcher> = { aemet, nws, usgs, emsc, gdacs };
