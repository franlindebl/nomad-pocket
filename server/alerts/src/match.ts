// Which alerts reach which registration, and what each push says (docs/ALERTS_PLAN.md, phase 2). Pure: the poll
// feeds it the current alerts and a registration; the tests feed it the app's fixtures. The notify policy is the
// app's own `decide` with the registration's record, so a raise notifies again and a re-issue doesn't, as on the
// phone. Drawn areas match by the cell's points, quakes by distance, GDACS by country, and NWS and MeteoAlarm by the
// zones worked out for the cell when it registered (zones.ts).
import {
  PUSH_CELL,
  alertSubtitle,
  cellOf,
  alertTitle,
  covers,
  inPolygons,
  current,
  decide,
  formatWhen,
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
export const CELL = PUSH_CELL;

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
  /** Zones of the cell (zones.ts): MeteoAlarm EMMA_IDs, NWS "forecast/TXZ213"-style keys. */
  zones?: string[];
  /**
   * When the phone registered here (new, or moved). Alerts of the sources the phone checks itself, issued before
   * that, are recorded without a push: its own check had just shown them.
   */
  seededAt?: number;
  lang: string;
  timeZone?: string;
  prefs: Prefs;
  notified: Notified;
};

/** Sources the server watches. */
export const SERVER_SOURCES: SourceId[] = ['aemet', 'nws', 'usgs', 'emsc', 'gdacs', 'meteoalarm'];

/**
 * MeteoAlarm countries the server reads (ISO alpha-2 → the feed's name). Every entry of these feeds names an EMMA_ID
 * region (zones table) or draws its area (checked 2026-11-12). Spain is left to AEMET; the UK, Switzerland and Israel
 * publish nothing there any more (empty feeds, their regions removed from the geocodes).
 */
export const METEOALARM_FEEDS: Record<string, string> = {
  ad: 'andorra',
  at: 'austria',
  ba: 'bosnia-herzegovina',
  be: 'belgium',
  bg: 'bulgaria',
  cy: 'cyprus',
  cz: 'czechia',
  de: 'germany',
  dk: 'denmark',
  ee: 'estonia',
  fi: 'finland',
  fr: 'france',
  gr: 'greece',
  hr: 'croatia',
  hu: 'hungary',
  ie: 'ireland',
  is: 'iceland',
  it: 'italy',
  lt: 'lithuania',
  lu: 'luxembourg',
  lv: 'latvia',
  md: 'moldova',
  me: 'montenegro',
  mk: 'republic-of-north-macedonia',
  mt: 'malta',
  nl: 'netherlands',
  no: 'norway',
  pl: 'poland',
  pt: 'portugal',
  ro: 'romania',
  rs: 'serbia',
  se: 'sweden',
  si: 'slovenia',
  sk: 'slovakia',
  ua: 'ukraine',
};

/** Sources the phone also checks by itself (the app's sourcesFor); MeteoAlarm reaches it only through the server. */
const PHONE_CHECKS = (country: string | null) => sourcesFor(country);

/**
 * The sources whose alerts the server pushes to a registration in `country` (the app skips its own notification
 * for these). In a MeteoAlarm country, MeteoAlarm takes the weather slot from GDACS, which the phone keeps checking.
 */
export function pushedSources(country: string | null): SourceId[] {
  const own = PHONE_CHECKS(country).filter((s) => SERVER_SOURCES.includes(s));
  return country && METEOALARM_FEEDS[country] ? ['meteoalarm', ...own.filter((s) => s !== 'gdacs')] : own;
}

/** The app computes the same cell (alerts-core `cellOf`); the server snaps again whatever it is sent. */
export const snapCell = cellOf;

const centre = (c: LatLon): LatLon => ({ lat: c.lat + CELL / 2, lon: c.lon + CELL / 2 });

/**
 * Whether an alert covers the cell. A drawn area counts when it holds the cell's centre or a corner (a cell on a
 * border gets both sides' warnings: better one too many than a missed one); quakes measure from the centre. NWS:
 * its drawn area when it has one (storm-based warnings are drawn tighter than their counties), else its zones;
 * MeteoAlarm: its EMMA zones, or its drawn area.
 */
export function coversCell(a: Alert, r: Pick<Registration, 'cell' | 'country' | 'zones'>): boolean {
  const mid = centre(r.cell);
  const zones = r.zones ?? [];
  const drawn = () => {
    const { lat, lon } = r.cell;
    const points = [mid, { lat, lon }, { lat: lat + CELL, lon }, { lat, lon: lon + CELL }, { lat: lat + CELL, lon: lon + CELL }];
    return points.some((pos) => inPolygons(a.polygons!, pos));
  };
  if (a.source === 'nws') return a.polygons?.length ? drawn() : !!a.zones?.some((z) => zones.includes(z));
  if (a.source === 'meteoalarm') return !!a.codes?.some((c) => zones.includes(c)) || (!!a.polygons?.length && drawn());
  if (!a.polygons?.length || a.kind === 'quake') return covers(a, { pos: mid, country: r.country });
  return drawn();
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

/** A long list of places (an NWS alert names every county) cut to its first few for a notification. */
function shortArea(a: Alert): Alert {
  if (a.area.length <= 90) return a;
  const parts = a.area.split(/[;,]\s*/).filter(Boolean);
  return { ...a, area: `${parts.slice(0, 3).join(', ')}…` };
}

/** "EUMETNET – MeteoAlarm" when a warning's CAP hasn't said which national service issued it. */
export const METEOALARM_CREDIT = 'EUMETNET – MeteoAlarm';

/**
 * What to push now and the registration's new record. Alerts the phone's own check had already shown when it
 * registered (`seededAt`) are recorded without a push.
 */
export function plan(all: Alert[], r: Registration, now: number): { pushes: Push[]; notified: Notified } {
  const { notify: due, notified } = decide(matching(all, r, now), r.notified, { now, minLevel: r.prefs.minLevel });
  const phone = PHONE_CHECKS(r.country);
  const shown = (a: Alert) => r.seededAt !== undefined && phone.includes(a.source) && (a.sent ?? 0) <= r.seededAt;
  const notify = due.filter((a) => !shown(a));
  if (!notify.length) return { pushes: [], notified };
  const w = wordsFor(r.lang, r.timeZone);
  const pos = centre(r.cell);
  // MeteoAlarm's terms: the national service that issued it and the time of issue go wherever the warning does.
  const bodyOf = (a: Alert) => {
    const line = alertSubtitle(w, shortArea(a), pos, now);
    if (a.source !== 'meteoalarm') return line;
    const when = a.sent !== null ? formatWhen(w, a.sent, now) : '—';
    return `${line}\n${w.t('alerts:detail.issued', { source: a.issuer || METEOALARM_CREDIT, when })}`;
  };
  const each = notify.length > MAX_EACH + 1 ? notify.slice(0, MAX_EACH) : notify;
  const pushes: Push[] = each.map((a) => ({
    title: alertTitle(w, a),
    body: bodyOf(a),
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
