// Which alerts reach which registration, and what each push says (docs/ALERTS_PLAN.md, phase 2). Pure: the poll
// feeds it the current alerts and a registration; the tests feed it the app's fixtures. The notify policy is the
// app's own `decide` with the registration's record, so a raise notifies again and a re-issue doesn't, as on the
// phone.
import {
  alertSubtitle,
  alertTitle,
  covers,
  current,
  decide,
  mergeQuakes,
  sourcesFor,
  timeSensitive,
  wordsFor,
  type Alert,
  type LatLon,
  type Level,
  type Notified,
  type SourceId,
} from './core.ts';

/** Grid of the cell a phone registers with (~11 × 8 km in Spain): never its coordinates. */
export const CELL = 0.1;

export type Prefs = { minLevel: Level; quakes: boolean };

export type Registration = {
  platform: 'ios' | 'android';
  token: string;
  /** APNs environment (iOS only). */
  env?: 'sandbox' | 'production';
  /** South-west corner of the 0.1° cell. */
  cell: LatLon;
  /** ISO 3166-1 alpha-2, lower case, of the cell (the phone knows it); picks the weather source. */
  country: string | null;
  lang: string;
  timeZone?: string;
  prefs: Prefs;
  notified: Notified;
};

/** Sources the server watches; NWS answers per point, so US weather stays with the phone's own check for now. */
export const SERVER_SOURCES: SourceId[] = ['aemet', 'usgs', 'emsc', 'gdacs'];

/** The sources whose alerts the server pushes to a registration in `country` (the app skips its own notification for these). */
export const pushedSources = (country: string | null): SourceId[] => sourcesFor(country).filter((s) => SERVER_SOURCES.includes(s));

export function snapCell(p: LatLon): LatLon {
  const f = (v: number) => Math.round(Math.floor(v / CELL + 1e-9) * CELL * 10) / 10;
  return { lat: f(p.lat), lon: f(p.lon) };
}

const centre = (c: LatLon): LatLon => ({ lat: c.lat + CELL / 2, lon: c.lon + CELL / 2 });

/**
 * Whether an alert covers the cell. A drawn area counts when it holds the cell's centre or a corner (a cell on a
 * border gets both sides' warnings: better one too many than a missed one); quakes measure from the centre.
 */
export function coversCell(a: Alert, r: Pick<Registration, 'cell' | 'country'>): boolean {
  const mid = centre(r.cell);
  if (!a.polygons?.length || a.kind === 'quake') return covers(a, { pos: mid, country: r.country });
  const { lat, lon } = r.cell;
  const points = [mid, { lat, lon }, { lat: lat + CELL, lon }, { lat, lon: lon + CELL }, { lat: lat + CELL, lon: lon + CELL }];
  return points.some((pos) => covers(a, { pos, country: r.country }));
}

const isQuake = (a: Alert) => a.kind === 'quake' && a.source !== 'gdacs';

/** The current alerts of the registration's sources that cover its cell (USGS and EMSC quakes merged). */
export function matching(all: Alert[], r: Registration, now: number): Alert[] {
  const sources = pushedSources(r.country);
  const live = current(
    all.filter((a) => sources.includes(a.source)),
    now,
  ).filter((a) => r.prefs.quakes || !isQuake(a));
  const merged = [...live.filter((a) => !isQuake(a)), ...mergeQuakes(live.filter(isQuake))];
  return merged.filter((a) => coversCell(a, r));
}

export type Push = {
  title: string;
  body: string;
  /** Route param the app opens (source:id); none for the "n more" summary. */
  key?: string;
  /** Same warning, same notification: a raise replaces the earlier one. */
  collapseId: string;
  timeSensitive: boolean;
  /** Epoch ms after which delivering it makes no sense. */
  expires: number;
};

const MAX_EACH = 3;
const HOUR = 3600_000;

/** What to push now and the registration's new record. `seed`: record what covers it without pushing (a new phone, whose own check just showed them). */
export function plan(all: Alert[], r: Registration, now: number, seed = false): { pushes: Push[]; notified: Notified } {
  const { notify, notified } = decide(matching(all, r, now), r.notified, { now, minLevel: r.prefs.minLevel });
  if (seed || !notify.length) return { pushes: [], notified };
  const w = wordsFor(r.lang, r.timeZone);
  const pos = centre(r.cell);
  const each = notify.length > MAX_EACH + 1 ? notify.slice(0, MAX_EACH) : notify;
  const pushes: Push[] = each.map((a) => ({
    title: alertTitle(w, a),
    body: alertSubtitle(w, a, pos, now),
    key: `${a.source}:${a.id}`,
    collapseId: `alert:${a.topic || `${a.source}:${a.id}`}`,
    timeSensitive: timeSensitive(a),
    expires: Math.max(now + HOUR, Math.min(a.expires ?? now + 6 * HOUR, now + 24 * HOUR)),
  }));
  const rest = notify.slice(each.length);
  if (rest.length) {
    pushes.push({
      title: w.t('alerts:notifyMore', { count: rest.length }),
      body: w.t('alerts:notifyMoreBody'),
      collapseId: 'alert:more',
      timeSensitive: rest.some(timeSensitive),
      expires: now + 6 * HOUR,
    });
  }
  return { pushes, notified };
}
