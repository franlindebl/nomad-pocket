// The rules of the official alerts feature (docs/ALERTS_PLAN.md, "Decisions for both phases"): the normalised
// Alert every source becomes, warning levels, which alerts cover the person's position, the earthquake distance
// rule and the USGS/EMSC merge, and the notify policy (new or raised → notify; plain updates, repeats and cancels
// → don't). Phase 2's server reuses this file, so it must stay free of app imports.
// Pure (no app imports) so node --test can load it.

export type SourceId = 'aemet' | 'meteoalarm' | 'nws' | 'usgs' | 'emsc' | 'gdacs';
export type Level = 'yellow' | 'orange' | 'red';
export type Kind = 'weather' | 'quake' | 'tsunami' | 'disaster';
/** What the warning is about; picks the guide card and the icon. */
export type Hazard =
  | 'rain'
  | 'wind'
  | 'storm'
  | 'snow'
  | 'heat'
  | 'cold'
  | 'coastal'
  | 'fog'
  | 'dust'
  | 'avalanche'
  | 'flood'
  | 'tornado'
  | 'cyclone'
  | 'fire'
  | 'quake'
  | 'tsunami'
  | 'volcano'
  | 'drought'
  | 'other';

/** The source's own words in one language. Never rewritten (AEMET: "no desnaturalizar"). */
export type AlertText = { event: string; headline: string; description: string; instruction: string };

export type LatLon = { lat: number; lon: number };

export type Alert = {
  /** Unique within its source (CAP identifier, USGS/EMSC event id, GDACS guid). */
  id: string;
  source: SourceId;
  kind: Kind;
  hazard: Hazard;
  level: Level;
  msgType: 'alert' | 'update' | 'cancel';
  /** Earlier ids this one updates or cancels; for a merged earthquake, the other source's id. */
  references: string[];
  /**
   * The same warning across re-issues even when a reference was missed: source + zone(s) + phenomenon (AEMET,
   * MeteoAlarm) or the VTEC event (NWS). '' when the source has nothing stable.
   */
  topic: string;
  sent: number | null;
  onset: number | null;
  expires: number | null;
  /** Place as the source names it ("Campo de Cartagena y Mazarrón", "Calcasieu, LA", "south of the Fiji Islands"). */
  area: string;
  /** By two-letter language: the CAP's es / en blocks, or the one language a source publishes. */
  texts: Record<string, AlertText>;
  /** Language of the source's original text. */
  original: string;
  /** Rings as flat [lon, lat…] arrays, when the source draws the area. */
  polygons?: number[][];
  /** Zone codes (MeteoAlarm EMMA_ID, NWS UGC, AEMET zone). */
  codes?: string[];
  /** ISO 3166-1 alpha-2 countries, lower case (GDACS). */
  countries?: string[];
  /** Epicentre or event centre. */
  point?: LatLon;
  mag?: number;
  depthKm?: number;
  /** The source's page for this alert. */
  url?: string;
};

// ---------------------------------------------------------------------------
// Levels

const RANK: Record<Level, number> = { yellow: 1, orange: 2, red: 3 };

export const levelRank = (l: Level | null | undefined): number => (l ? RANK[l] : 0);

export function maxLevel(a: Level | null | undefined, b: Level | null | undefined): Level | null {
  return levelRank(a) >= levelRank(b) ? (a ?? null) : (b ?? null);
}

/** CAP severity, the generic fallback (NWS has nothing else). Unknown → null. */
export function levelOfSeverity(severity: string): Level | null {
  switch (severity.trim().toLowerCase()) {
    case 'extreme':
      return 'red';
    case 'severe':
      return 'orange';
    case 'moderate':
    case 'minor':
      return 'yellow';
    default:
      return null;
  }
}

/**
 * Level of a CAP `<info>`: AEMET's "AEMET-Meteoalerta nivel" (amarillo/naranja/rojo; verde = no warning),
 * MeteoAlarm's "awareness_level" ("2; yellow; Moderate"; 1 = green = none), else the severity.
 */
export function levelOfCap(parameters: Record<string, string>, severity: string): Level | null {
  const nivel = parameters['AEMET-Meteoalerta nivel']?.trim().toLowerCase();
  if (nivel !== undefined) return nivel === 'rojo' ? 'red' : nivel === 'naranja' ? 'orange' : nivel === 'amarillo' ? 'yellow' : null;
  const awareness = parameters['awareness_level'];
  if (awareness !== undefined) {
    const n = parseInt(awareness, 10);
    const word = awareness.toLowerCase();
    if (n === 4 || word.includes('red')) return 'red';
    if (n === 3 || word.includes('orange')) return 'orange';
    if (n === 2 || word.includes('yellow')) return 'yellow';
    return null;
  }
  return levelOfSeverity(severity);
}

/** GDACS alertlevel Green/Orange/Red: only Orange and Red count. */
export function levelOfGdacs(alertlevel: string): Level | null {
  const l = alertlevel.trim().toLowerCase();
  return l === 'red' ? 'red' : l === 'orange' ? 'orange' : null;
}

// ---------------------------------------------------------------------------
// Hazards

const AEMET_HAZARD: Record<string, Hazard> = {
  PR: 'rain',
  VI: 'wind',
  GA: 'wind',
  TO: 'storm',
  NE: 'snow',
  AT: 'heat',
  BT: 'cold',
  CO: 'coastal',
  RI: 'coastal',
  NI: 'fog',
  VS: 'dust',
  AL: 'avalanche',
  DH: 'flood',
};

/** AEMET "AEMET-Meteoalerta fenomeno" ("PR;Lluvias"). */
export function hazardOfAemet(fenomeno: string): Hazard {
  return AEMET_HAZARD[fenomeno.split(';')[0].trim().toUpperCase()] ?? 'other';
}

const METEOALARM_HAZARD: Record<number, Hazard> = {
  1: 'wind',
  2: 'snow',
  3: 'storm',
  4: 'fog',
  5: 'heat',
  6: 'cold',
  7: 'coastal',
  8: 'fire',
  9: 'avalanche',
  10: 'rain',
  12: 'flood',
  13: 'flood',
};

/** MeteoAlarm "awareness_type" ("10; Rain"). */
export function hazardOfMeteoalarm(awarenessType: string): Hazard {
  return METEOALARM_HAZARD[parseInt(awarenessType, 10)] ?? 'other';
}

const EVENT_HAZARD: [RegExp, Hazard][] = [
  [/tsunami/i, 'tsunami'],
  [/tornado/i, 'tornado'],
  [/hurricane|typhoon|tropical (storm|cyclone|depression)|storm surge/i, 'cyclone'],
  [/earthquake/i, 'quake'],
  [/volcan|ash ?fall/i, 'volcano'],
  [/avalanche/i, 'avalanche'],
  [/flood/i, 'flood'],
  [/fire|red flag/i, 'fire'],
  [/heat/i, 'heat'],
  [/winter|snow|blizzard|ice storm|sleet/i, 'snow'],
  [/freez|frost|cold|chill/i, 'cold'],
  [/thunderstorm|lightning/i, 'storm'],
  [/dust|sand/i, 'dust'],
  [/fog|smoke/i, 'fog'],
  [/surf|coastal|rip current|marine|gale|seas|beach/i, 'coastal'],
  [/wind/i, 'wind'],
  [/rain/i, 'rain'],
  [/drought/i, 'drought'],
];

/** From an English event name (NWS "Flood Warning", "Tornado Watch"…). */
export function hazardOfEvent(event: string): Hazard {
  for (const [re, h] of EVENT_HAZARD) if (re.test(event)) return h;
  return 'other';
}

const GDACS_HAZARD: Record<string, Hazard> = {
  EQ: 'quake',
  TC: 'cyclone',
  FL: 'flood',
  VO: 'volcano',
  WF: 'fire',
  DR: 'drought',
  TS: 'tsunami',
};

export const hazardOfGdacs = (eventtype: string): Hazard => GDACS_HAZARD[eventtype.trim().toUpperCase()] ?? 'other';

// ---------------------------------------------------------------------------
// Geometry

const EARTH_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Even-odd test on one flat [lon, lat…] ring. */
export function inRing(ring: readonly number[], lat: number, lon: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const yi = ring[i + 1];
    const yj = ring[j + 1];
    if (yi > lat !== yj > lat && lon < ((ring[j] - ring[i]) * (lat - yi)) / (yj - yi) + ring[i]) inside = !inside;
  }
  return inside;
}

/** Inside any of the rings (CAP draws each `<polygon>` as its own area, no holes). */
export const inPolygons = (rings: readonly (readonly number[])[], p: LatLon): boolean => rings.some((r) => inRing(r, p.lat, p.lon));

/** A position snapped to a grid of `step` degrees (0.001 ≈ 100 m kept on the device; 0.05 ≈ 5 km sent to NWS). */
export function snap(p: LatLon, step: number): LatLon {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  const r = (v: number) => Number((Math.round(v / step) * step).toFixed(decimals));
  return { lat: r(p.lat), lon: r(p.lon) };
}

// ---------------------------------------------------------------------------
// Earthquakes

export type QuakeRule = { nearMag: number; nearKm: number; farMag: number; farKm: number };

/** Owner's defaults: M ≥ 4.5 within 100 km, or M ≥ 6 within 500 km. */
export const QUAKE_RULE: QuakeRule = { nearMag: 4.5, nearKm: 100, farMag: 6, farKm: 500 };

export function quakeMatters(q: Pick<Alert, 'mag' | 'point'>, pos: LatLon, rule: QuakeRule = QUAKE_RULE): boolean {
  if (q.mag === undefined || !q.point) return false;
  const km = distanceKm(q.point, pos);
  return (q.mag >= rule.nearMag && km <= rule.nearKm) || (q.mag >= rule.farMag && km <= rule.farKm);
}

/** M ≥ 6 is red (time-sensitive); anything smaller that passes the rule is orange. */
export const quakeLevel = (mag: number): Level => (mag >= 6 ? 'red' : 'orange');

const SAME_QUAKE_MS = 60_000;
const SAME_QUAKE_KM = 100;

export function sameQuake(a: Alert, b: Alert): boolean {
  if (a.sent === null || b.sent === null || !a.point || !b.point) return false;
  return Math.abs(a.sent - b.sent) <= SAME_QUAKE_MS && distanceKm(a.point, b.point) < SAME_QUAKE_KM;
}

/**
 * USGS and EMSC report many of the same events (EMSC is often first around Europe). One event becomes one alert:
 * the higher magnitude's (ties: the earlier report in `quakes`), with the other ids as references so a quake
 * notified under one source's id is recognised under the other's later.
 */
export function mergeQuakes(quakes: Alert[]): Alert[] {
  const out: Alert[] = [];
  for (const q of quakes) {
    const i = out.findIndex((o) => sameQuake(o, q));
    if (i === -1) {
      out.push(q);
      continue;
    }
    const o = out[i];
    const [keep, other] = (q.mag ?? 0) > (o.mag ?? 0) ? [q, o] : [o, q];
    const refs = new Set([...keep.references, ...other.references, other.id]);
    refs.delete(keep.id);
    out[i] = { ...keep, references: [...refs] };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Which alerts are current and which cover the person

/**
 * The current state of a set of alerts from one check: past `expires` dropped, cancels dropped along with what they
 * cancel, and any alert another one updates dropped (the newest message stands).
 */
export function current(alerts: Alert[], now: number): Alert[] {
  const replaced = new Set<string>();
  for (const a of alerts) for (const r of a.references) if (a.kind !== 'quake') replaced.add(`${a.source}:${r}`);
  return alerts.filter((a) => a.msgType !== 'cancel' && !replaced.has(`${a.source}:${a.id}`) && (a.expires === null || a.expires > now));
}

export type Place = {
  /** Last known position (rounded); null when the app never had a fix. */
  pos: LatLon | null;
  /** Country id (ISO 3166-1 alpha-2, lower case) of the position, else the person's chosen country. */
  country: string | null;
  /** MeteoAlarm EMMA_IDs chosen or found for the position. */
  codes?: string[];
};

/**
 * Whether an alert covers the person. NWS answers are already for the person's point (`?point=`); quakes follow the
 * distance rule; drawn areas need the position inside; GDACS goes by country; MeteoAlarm by zone code.
 */
export function covers(a: Alert, place: Place, rule: QuakeRule = QUAKE_RULE): boolean {
  if (a.source === 'nws') return true;
  if (a.kind === 'quake' && a.source !== 'gdacs') return place.pos !== null && quakeMatters(a, place.pos, rule);
  if (a.polygons?.length) return place.pos !== null && inPolygons(a.polygons, place.pos);
  if (a.countries?.length) return place.country !== null && a.countries.includes(place.country);
  if (a.codes?.length && place.codes?.length) return a.codes.some((c) => place.codes!.includes(c));
  return false;
}

const isQuake = (a: Alert) => a.kind === 'quake' && a.source !== 'gdacs';

/**
 * What the alerts list shows: the current alerts that cover the person (USGS/EMSC quakes merged), most serious
 * first. Without any position: the orange and red warnings of the national source and GDACS for the country
 * (`nearby: false`; these are never notified, since nothing says they are where the person is).
 */
export function visible(all: Alert[], place: Place, now: number, rule: QuakeRule = QUAKE_RULE): { alerts: Alert[]; nearby: boolean } {
  const live = current(all, now);
  if (!place.pos) {
    const country = live.filter(
      (a) => !isQuake(a) && levelRank(a.level) >= RANK.orange && (a.source !== 'gdacs' || covers(a, place, rule)),
    );
    return { alerts: country.sort(byUrgency), nearby: false };
  }
  const merged = [...live.filter((a) => !isQuake(a)), ...mergeQuakes(live.filter(isQuake))];
  return { alerts: merged.filter((a) => covers(a, place, rule)).sort(byUrgency), nearby: true };
}

/** Most serious first, then the soonest to start. */
export function byUrgency(a: Alert, b: Alert): number {
  return levelRank(b.level) - levelRank(a.level) || (a.onset ?? a.sent ?? 0) - (b.onset ?? b.sent ?? 0);
}

// ---------------------------------------------------------------------------
// Notify policy

/** What was notified, by alert id: kept across checks and restarts (kv `alerts.notified`). */
export type Notified = Record<string, { level: Level; topic: string; until: number }>;

export type NotifyOptions = {
  now: number;
  /** Lowest weather level that notifies (owner's default: orange). */
  minLevel?: Level;
  /** Earthquakes older than this are listed but not notified (they already happened; a late check shouldn't ring). */
  quakeMaxAgeMs?: number;
};

const DAY = 24 * 3600_000;
const QUAKE_MAX_AGE = 6 * 3600_000;
/** Records stay this long past their alert's end, so a late re-issue still finds them. */
const KEEP_AFTER = 2 * DAY;

/**
 * Which of the covering, current alerts to notify, and the updated record. An alert notifies when it reaches
 * `minLevel` and is above the level already notified for it: by its own id, an id it references, or its topic while
 * the earlier one was still in force. So a new warning notifies, a raise (orange → red) notifies again, and plain
 * updates, re-issues and restarts don't.
 */
export function decide(alerts: Alert[], notified: Notified, opts: NotifyOptions): { notify: Alert[]; notified: Notified } {
  const { now } = opts;
  const min = levelRank(opts.minLevel ?? 'orange');
  const next: Notified = {};
  for (const [id, r] of Object.entries(notified)) if (r.until + KEEP_AFTER > now) next[id] = r;
  const notify: Alert[] = [];
  for (const a of alerts) {
    const keys = [a.id, ...a.references];
    const start = a.onset ?? a.sent ?? now;
    let prev: Level | null = null;
    for (const [id, r] of Object.entries(next)) {
      if (keys.includes(id) || (a.topic !== '' && r.topic === a.topic && r.until >= start)) prev = maxLevel(prev, r.level);
    }
    const old = a.kind === 'quake' && a.sent !== null && now - a.sent > (opts.quakeMaxAgeMs ?? QUAKE_MAX_AGE);
    if (levelRank(a.level) >= min && levelRank(a.level) > levelRank(prev) && !old) notify.push(a);
    next[a.id] = { level: maxLevel(a.level, prev) ?? a.level, topic: a.topic, until: a.expires ?? (a.sent ?? now) + DAY };
  }
  return { notify: notify.sort(byUrgency), notified: next };
}

/** iOS interruption level: red and tsunamis break through Focus (Time Sensitive); the rest are plain `active`. */
export const timeSensitive = (a: Alert): boolean => a.level === 'red' || a.kind === 'tsunami';

// ---------------------------------------------------------------------------
// Sources and languages

/**
 * Sources for a country: Spain → AEMET (its bundle covers Canarias too), USA → NWS, elsewhere GDACS until
 * MeteoAlarm's terms and geometries are sorted (phase 1, task 9). Earthquakes everywhere.
 */
export function sourcesFor(country: string | null): SourceId[] {
  const weather: SourceId = country === 'es' ? 'aemet' : country === 'us' ? 'nws' : 'gdacs';
  return [weather, 'usgs', 'emsc'];
}

/** "es-ES" → "es". */
export const lang2 = (language: string): string => language.trim().slice(0, 2).toLowerCase() || 'en';

/** The text in the app's language, else English, else the original. */
export function textFor(a: Alert, lang: string): AlertText {
  return (
    a.texts[lang] ??
    a.texts.en ??
    a.texts[a.original] ??
    Object.values(a.texts)[0] ?? { event: '', headline: '', description: '', instruction: '' }
  );
}

// ISO 3166-1 alpha-3 + alpha-2, five letters per country (GDACS gives alpha-3; the app's country ids are alpha-2).
// From the ISO 3166 list at github.com/lukes/ISO-3166-Countries-with-Regional-Codes (2026-11-05).
const ISO3_ISO2 =
  'AFGAFALAAXALBALDZADZASMASANDADAGOAOAIAAIATAAQATGAGARGARARMAMABWAWAUSAUAUTATAZEAZBHSBSBHRBHBGDBDBRBBBBLRBYBELBEBLZBZBENBJBMUBMBTNBT' +
  'BOLBOBESBQBIHBABWABWBVTBVBRABRIOTIOBRNBNBGRBGBFABFBDIBICPVCVKHMKHCMRCMCANCACYMKYCAFCFTCDTDCHLCLCHNCNCXRCXCCKCCCOLCOCOMKMCOGCGCODCD' +
  'COKCKCRICRCIVCIHRVHRCUBCUCUWCWCYPCYCZECZDNKDKDJIDJDMADMDOMDOECUECEGYEGSLVSVGNQGQERIERESTEESWZSZETHETFLKFKFROFOFJIFJFINFIFRAFRGUFGF' +
  'PYFPFATFTFGABGAGMBGMGEOGEDEUDEGHAGHGIBGIGRCGRGRLGLGRDGDGLPGPGUMGUGTMGTGGYGGGINGNGNBGWGUYGYHTIHTHMDHMVATVAHNDHNHKGHKHUNHUISLISINDIN' +
  'IDNIDIRNIRIRQIQIRLIEIMNIMISRILITAITJAMJMJPNJPJEYJEJORJOKAZKZKENKEKIRKIPRKKPKORKRKWTKWKGZKGLAOLALVALVLBNLBLSOLSLBRLRLBYLYLIELILTULT' +
  'LUXLUMACMOMDGMGMWIMWMYSMYMDVMVMLIMLMLTMTMHLMHMTQMQMRTMRMUSMUMYTYTMEXMXFSMFMMDAMDMCOMCMNGMNMNEMEMSRMSMARMAMOZMZMMRMMNAMNANRUNRNPLNP' +
  'NLDNLNCLNCNZLNZNICNINERNENGANGNIUNUNFKNFMKDMKMNPMPNORNOOMNOMPAKPKPLWPWPSEPSPANPAPNGPGPRYPYPERPEPHLPHPCNPNPOLPLPRTPTPRIPRQATQAREURE' +
  'ROURORUSRURWARWBLMBLSHNSHKNAKNLCALCMAFMFSPMPMVCTVCWSMWSSMRSMSTPSTSAUSASENSNSRBRSSYCSCSLESLSGPSGSXMSXSVKSKSVNSISLBSBSOMSOZAFZASGSGS' +
  'SSDSSESPESLKALKSDNSDSURSRSJMSJSWESECHECHSYRSYTWNTWTJKTJTZATZTHATHTLSTLTGOTGTKLTKTONTOTTOTTTUNTNTURTRTKMTMTCATCTUVTVUGAUGUKRUAAREAE' +
  'GBRGBUSAUSUMIUMURYUYUZBUZVUTVUVENVEVNMVNVGBVGVIRVIWLFWFESHEHYEMYEZMBZMZWEZW';

let iso3Map: Map<string, string> | null = null;

/** "ESP" → "es"; unknown → null. Kosovo's user-assigned "XKX" → "xk". */
export function iso2Of(iso3: string): string | null {
  if (!iso3Map) {
    iso3Map = new Map([['XKX', 'xk']]);
    for (let i = 0; i < ISO3_ISO2.length; i += 5) iso3Map.set(ISO3_ISO2.slice(i, i + 3), ISO3_ISO2.slice(i + 3, i + 5).toLowerCase());
  }
  return iso3Map.get(iso3.trim().toUpperCase()) ?? null;
}
