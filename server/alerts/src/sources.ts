// Fetching the official sources from the server (the app's src/features/alerts/sources.ts, without Expo): conditional
// requests where the source honours them, AEMET's bundle only when the RSS points at a new one. Each fetcher gets the
// previous state and returns the new one, or `null` when nothing changed.
//
// State keys: 'aemet', 'usgs', 'emsc', 'gdacs' (always polled), 'nws' (the whole US, while a US phone is registered)
// and 'meteoalarm-<country>' (one feed per country, while a phone there is registered; at most every few minutes:
// the feeds answer neither If-Modified-Since nor ETag, and MeteoAlarm's terms ask for under 5 min of delay on average).
import { createHash } from 'node:crypto';

import {
  alertOfCap,
  alertsOfAemetBundle,
  parseAemetRss,
  parseCap,
  parseEmsc,
  parseGdacs,
  parseMeteoalarmAtom,
  parseNws,
  parseUsgs,
  xmlFilesOfTarGz,
  type Alert,
} from './core.ts';
import { METEOALARM_FEEDS } from './match.ts';

export type SourceState = {
  fetchedAt: number;
  alerts: Alert[];
  lastModified?: string;
  bundleUrl?: string;
  /** Hash of what matters in `alerts` (ids, levels, ends): a refetch with the same hash changed nothing. */
  hash: string;
  error?: string;
};

export type Fetcher = (prev: SourceState | undefined, now: number) => Promise<SourceState | null>;

const URLS = {
  aemet: 'https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAE_RSS.xml',
  usgs: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
  emsc: 'https://www.seismicportal.eu/fdsnws/event/1/query',
  gdacs: 'https://www.gdacs.org/xml/rss_24h.xml',
  nws: 'https://api.weather.gov/alerts/active?status=actual',
  meteoalarm: 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-',
};

/** How often one MeteoAlarm country's feed is read (avg delay ~1.5 min, never over ~3; the terms ask < 5 and ≤ 10). */
export const METEOALARM_EVERY_MS = 3 * 60_000;

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
  const lines = alerts.map((a) => `${a.id}|${a.level}|${a.msgType}|${a.expires ?? ''}|${(a.codes ?? a.zones ?? []).length}`).sort();
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

/**
 * Every active US alert (~400, 1.8 MB; its ETag isn't honoured): the server matches them by zone, so no position is
 * ever sent. NWS asks for a User-Agent naming the app and at most one request every 30 s.
 */
async function nws(_prev: SourceState | undefined, now: number): Promise<SourceState | null> {
  const res = await get(URLS.nws, { Accept: 'application/geo+json' });
  // Only what can notify is kept (yellow and up; parseNws drops the rest), and only the fields the server uses.
  return state(now, parseNws(await res.json()));
}

function meteoalarm(country: string): Fetcher {
  return async (_prev, now) => {
    const res = await get(URLS.meteoalarm + METEOALARM_FEEDS[country]);
    return state(now, parseMeteoalarmAtom(await res.text()));
  };
}

export const ALWAYS = ['aemet', 'usgs', 'emsc', 'gdacs'] as const;

/** The fetcher of a state key, or undefined for an unknown key. */
export function fetcherOf(key: string): Fetcher | undefined {
  if (key.startsWith('meteoalarm-')) {
    const country = key.slice('meteoalarm-'.length);
    return METEOALARM_FEEDS[country] ? meteoalarm(country) : undefined;
  }
  return ({ aemet, usgs, emsc, gdacs, nws } as Record<string, Fetcher>)[key];
}

/** The state keys a registration in `country` needs. */
export function keysFor(country: string | null): string[] {
  const keys: string[] = [...ALWAYS];
  if (country === 'us') keys.push('nws');
  if (country && METEOALARM_FEEDS[country]) keys.push(`meteoalarm-${country}`);
  return keys;
}

// ---------------------------------------------------------------------------
// MeteoAlarm details

type Details = Pick<Alert, 'texts' | 'original' | 'issuer'> & { url?: string; hazard?: Alert['hazard'] };
const details = new Map<string, Details>();

export const hasDetails = (id: string): boolean => details.has(id);

/**
 * A MeteoAlarm warning with its CAP's texts (national language + English) and issuing service, which the Atom feed
 * leaves out; cached by id. Without a CAP (or when it fails) the Atom's own words stand.
 */
export async function withDetails(a: Alert & { capUrl?: string | null }): Promise<Alert> {
  if (a.source !== 'meteoalarm' || !a.capUrl) return a;
  let d = details.get(a.id);
  if (!d) {
    try {
      const cap = parseCap(await (await get(a.capUrl)).text());
      const full = cap && alertOfCap(cap, 'meteoalarm');
      if (!full) return a;
      // The CAP's awareness_type names the hazard exactly; the Atom only has an English event name to guess from.
      d = {
        texts: full.texts,
        original: full.original,
        ...(full.issuer ? { issuer: full.issuer } : {}),
        ...(full.url ? { url: full.url } : {}),
        ...(full.hazard !== 'other' ? { hazard: full.hazard } : {}),
      };
      if (details.size > 5000) details.clear();
      details.set(a.id, d);
    } catch {
      return a;
    }
  }
  return { ...a, ...d };
}
