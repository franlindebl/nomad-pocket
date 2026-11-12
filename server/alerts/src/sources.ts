// Fetching the official sources from the server (the app's src/features/alerts/sources.ts, without Expo): conditional
// requests where the source honours them, AEMET's bundle only when the RSS points at a new one. Each fetcher gets the
// previous state and returns the new one, or `null` when nothing changed.
import { createHash } from 'node:crypto';

import { alertsOfAemetBundle, parseAemetRss, parseEmsc, parseGdacs, parseUsgs, xmlFilesOfTarGz, type Alert } from './core.ts';

export type SourceState = {
  fetchedAt: number;
  alerts: Alert[];
  lastModified?: string;
  bundleUrl?: string;
  /** Hash of what matters in `alerts` (ids, levels, ends): a refetch with the same hash changed nothing. */
  hash: string;
  error?: string;
};

export type PolledSource = 'aemet' | 'usgs' | 'emsc' | 'gdacs';

const URLS = {
  aemet: 'https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAE_RSS.xml',
  usgs: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
  emsc: 'https://www.seismicportal.eu/fdsnws/event/1/query',
  gdacs: 'https://www.gdacs.org/xml/rss_24h.xml',
};

const UA = 'NomadPocketAlerts/1.0 (+https://github.com/franlindebl/nomad-pocket)';
const TIMEOUT_MS = 20_000;

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status !== 304 && !res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const since = (prev: SourceState | undefined): Record<string, string> =>
  prev?.lastModified && !prev.error ? { 'If-Modified-Since': prev.lastModified } : {};

export function hashOf(alerts: Alert[]): string {
  const lines = alerts.map((a) => `${a.id}|${a.level}|${a.msgType}|${a.expires ?? ''}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('base64url').slice(0, 22);
}

const state = (now: number, alerts: Alert[], extra: Partial<SourceState> = {}): SourceState => ({ fetchedAt: now, alerts, hash: hashOf(alerts), ...extra });

async function aemet(prev: SourceState | undefined, now: number): Promise<SourceState | null> {
  const res = await get(URLS.aemet, since(prev));
  if (res.status === 304 && prev) return null;
  const rss = parseAemetRss(await res.text());
  if (!rss.bundleUrl) throw new Error('AEMET feed without a bundle');
  const lastModified = res.headers.get('Last-Modified') ?? undefined;
  if (prev && !prev.error && prev.bundleUrl === rss.bundleUrl) return null;
  const bundle = await get(rss.bundleUrl);
  const alerts = alertsOfAemetBundle(xmlFilesOfTarGz(new Uint8Array(await bundle.arrayBuffer())));
  return state(now, alerts, { lastModified, bundleUrl: rss.bundleUrl });
}

async function usgs(prev: SourceState | undefined, now: number): Promise<SourceState | null> {
  const res = await get(URLS.usgs, since(prev));
  if (res.status === 304 && prev) return null;
  return state(now, parseUsgs(await res.json()), { lastModified: res.headers.get('Last-Modified') ?? undefined });
}

async function emsc(_prev: SourceState | undefined, now: number): Promise<SourceState | null> {
  const start = new Date(now - 24 * 3600_000).toISOString().slice(0, 19);
  const res = await get(`${URLS.emsc}?format=json&minmag=4.5&limit=100&start=${start}`);
  // FDSN answers 204 when nothing matches.
  return state(now, res.status === 204 ? [] : parseEmsc(await res.json()));
}

async function gdacs(prev: SourceState | undefined, now: number): Promise<SourceState | null> {
  const res = await get(URLS.gdacs, since(prev));
  if (res.status === 304 && prev) return null;
  return state(now, parseGdacs(await res.text()), { lastModified: res.headers.get('Last-Modified') ?? undefined });
}

export const FETCHERS: Record<PolledSource, (prev: SourceState | undefined, now: number) => Promise<SourceState | null>> = { aemet, usgs, emsc, gdacs };
