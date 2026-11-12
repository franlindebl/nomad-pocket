// Each official feed → the normalised Alert (alerts-core). Formats as measured on 2026-11-04 (fixtures/ and
// docs/ALERTS_PLAN.md, "Sources"): AEMET's RSS (its first item is the .tar.gz of every CAP in force) and CAP
// files, MeteoAlarm's Atom + CAP, NWS's GeoJSON (`/alerts/active?point=`), USGS's and EMSC's GeoJSON, GDACS's RSS.
// Parsers never throw on a malformed item: they skip it, so one bad entry can't hide the rest.
// Pure (no app imports) so node --test can load it.

import {
  hazardOfAemet,
  hazardOfEvent,
  hazardOfGdacs,
  hazardOfMeteoalarm,
  iso2Of,
  lang2,
  levelOfCap,
  levelOfGdacs,
  levelOfSeverity,
  maxLevel,
  quakeLevel,
  type Alert,
  type AlertText,
  type Kind,
  type SourceId,
} from './alerts-core.ts';
import { attrs, blocks, parseCap, parsePolygon, parseTime, text, xmlText, type CapAlert, type CapInfo } from './cap-core.ts';

const msgTypeOf = (s: string): Alert['msgType'] => {
  const t = s.trim().toLowerCase();
  return t === 'cancel' ? 'cancel' : t === 'update' ? 'update' : 'alert';
};

const textOf = (i: CapInfo): AlertText => ({
  event: i.event,
  headline: i.headline,
  description: i.description,
  instruction: i.instruction,
});

/** The CAP's blocks by two-letter language; the first block is the original. */
function textsOf(infos: CapInfo[]): { texts: Record<string, AlertText>; original: string } {
  const texts: Record<string, AlertText> = {};
  for (const i of infos) texts[lang2(i.language)] ??= textOf(i);
  return { texts, original: lang2(infos[0]?.language ?? 'en') };
}

// ---------------------------------------------------------------------------
// AEMET

export type AemetRss = {
  /** The .tar.gz of every CAP in force (the RSS's first item), or null if the feed changed shape. */
  bundleUrl: string | null;
  /** The feed's build time, epoch ms. */
  updated: number | null;
  /** Individual CAP links (one per warning not green), for a fallback or a check. */
  caps: string[];
};

export function parseAemetRss(xml: string): AemetRss {
  const links = blocks(xml, 'item').map((i) => text(i, 'link'));
  return {
    bundleUrl: links.find((l) => /\.tar\.gz$/i.test(l)) ?? null,
    updated: parseTime(text(xml, 'lastBuildDate') || text(xml, 'pubDate')),
    caps: links.filter((l) => /\.xml$/i.test(l)),
  };
}

const AEMET_ZONE = 'AEMET-Meteoalerta zona';
const AEMET_FENOMENO = 'AEMET-Meteoalerta fenomeno';

/** One CAP document → an Alert, from any CAP source; null when it isn't a warning (AEMET green, MeteoAlarm green, a test). */
export function alertOfCap(cap: CapAlert, source: SourceId): Alert | null {
  if (cap.status.toLowerCase() !== 'actual' || cap.infos.length === 0) return null;
  const info = cap.infos[0];
  const level = levelOfCap(info.parameters, info.severity);
  const msgType = msgTypeOf(cap.msgType);
  if (!level && msgType !== 'cancel') return null;
  const en = cap.infos.find((i) => lang2(i.language) === 'en') ?? info;
  const areas = info.areas;
  const zones = areas.flatMap((a) => a.geocodes[AEMET_ZONE] ?? a.geocodes['EMMA_ID'] ?? a.geocodes['UGC'] ?? []);
  const fenomeno = info.eventCodes[AEMET_FENOMENO];
  const awareness = info.parameters['awareness_type'];
  const hazard = fenomeno ? hazardOfAemet(fenomeno) : awareness ? hazardOfMeteoalarm(awareness) : hazardOfEvent(en.event);
  // AEMET splits one phenomenon by measure (rain: P1 one-hour, P2 twelve-hour accumulation), each its own warning.
  const measure = info.parameters['AEMET-Meteoalerta parametro']?.split(';')[0];
  const phenomenon = fenomeno ? [fenomeno.split(';')[0], measure].filter(Boolean).join('.') : hazard;
  const polygons = areas.flatMap((a) => a.polygons);
  return {
    id: cap.identifier,
    source,
    kind: hazard === 'tsunami' ? 'tsunami' : 'weather',
    hazard,
    level: level ?? 'yellow',
    msgType,
    references: cap.references,
    topic: zones.length ? `${source}:${[...zones].sort().join('+')}:${phenomenon}` : '',
    sent: cap.sent,
    onset: info.onset ?? info.effective,
    expires: info.expires,
    area: areas
      .map((a) => a.desc)
      .filter(Boolean)
      .join(', '),
    ...textsOf(cap.infos),
    ...(polygons.length ? { polygons } : {}),
    ...(zones.length ? { codes: zones } : {}),
    ...(info.web ? { url: info.web } : {}),
    ...(info.senderName ? { issuer: info.senderName } : {}),
  };
}

const GREEN = /AEMET-Meteoalerta nivel<\/valueName>\s*<value>verde</;

/** The CAP files of AEMET's bundle (`xmlFilesOfTarGz` output) → warnings, green ones dropped. */
export function alertsOfAemetBundle(files: { xml: string }[]): Alert[] {
  const out: Alert[] = [];
  for (const f of files) {
    // Green files are most of the bundle's bytes (one per region and phenomenon, every zone drawn): skip them unread.
    if (GREEN.test(f.xml)) continue;
    const cap = parseCap(f.xml);
    const a = cap && alertOfCap(cap, 'aemet');
    if (a) out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// MeteoAlarm

/**
 * MeteoAlarm's Atom: one entry per area × warning, English event only. Each entry names its area by an EMMA_ID
 * region (a `geocode`, or only in its link to meteoalarm.org: France, Bulgaria, Romania give NUTS codes as the
 * geocode) or draws it (`cap:polygon`: Norway, Sweden, Estonia, Slovenia, Ukraine…). Entries of the same CAP (one
 * warning over several areas) become one alert with every zone and polygon. The full texts are in the CAP the entry
 * links to (`capUrl`), fetched for the warnings that cover someone.
 */
export function parseMeteoalarmAtom(xml: string): (Alert & { capUrl: string | null })[] {
  const byId = new Map<string, Alert & { capUrl: string | null }>();
  for (const e of blocks(xml, 'entry')) {
    const id = text(e, 'cap:identifier');
    const title = text(e, 'title');
    const colour = /^(yellow|orange|red)\b/i.exec(title)?.[1]?.toLowerCase();
    const level = (colour as Alert['level'] | undefined) ?? levelOfSeverity(text(e, 'cap:severity'));
    if (!id || !level) continue;
    const linked = [...e.matchAll(/geocode=EMMA_ID:([A-Z0-9]+)/g)].map((m) => m[1]);
    const coded = blocks(e, 'cap:geocode')
      .filter((g) => text(g, 'valueName') === 'EMMA_ID')
      .map((g) => text(g, 'value'));
    const codes = [...new Set([...coded, ...linked])];
    const polygons = blocks(e, 'cap:polygon')
      .map((p) => parsePolygon(xmlText(p)))
      .filter((p): p is number[] => p !== null);
    const area = text(e, 'cap:areaDesc');
    const seen = byId.get(id);
    if (seen) {
      seen.codes = [...new Set([...(seen.codes ?? []), ...codes])];
      if (polygons.length) seen.polygons = [...(seen.polygons ?? []), ...polygons];
      if (!seen.codes.length) delete seen.codes;
      if (area && !seen.area.split(', ').includes(area)) seen.area = seen.area ? `${seen.area}, ${area}` : area;
      seen.level = maxLevel(seen.level, level) ?? level;
      continue;
    }
    const event = text(e, 'cap:event');
    byId.set(id, {
      id,
      source: 'meteoalarm',
      kind: 'weather',
      hazard: hazardOfEvent(event),
      level,
      msgType: msgTypeOf(text(e, 'cap:message_type')),
      references: [],
      topic: '',
      sent: parseTime(text(e, 'cap:sent')),
      onset: parseTime(text(e, 'cap:onset')) ?? parseTime(text(e, 'cap:effective')),
      expires: parseTime(text(e, 'cap:expires')),
      area,
      texts: { en: { event, headline: title, description: '', instruction: '' } },
      original: 'en',
      ...(codes.length ? { codes } : {}),
      ...(polygons.length ? { polygons } : {}),
      capUrl: attrs(e, 'link', (a) => a.type === 'application/cap+xml')?.href ?? null,
    });
  }
  const out = [...byId.values()];
  // Same key as alertOfCap gives the entry's CAP: zone(s) + hazard (the event name changes with the level).
  for (const a of out) a.topic = a.codes?.length ? `meteoalarm:${[...a.codes].sort().join('+')}:${a.hazard}` : '';
  return out;
}

// ---------------------------------------------------------------------------
// NWS (api.weather.gov)

type Json = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});

/** GeoJSON Polygon / MultiPolygon → flat [lon, lat…] rings (outer rings only; NWS draws no holes). */
function ringsOfGeometry(g: unknown): number[][] {
  const geom = obj(g);
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? arr(geom.coordinates) : [];
  const out: number[][] = [];
  for (const p of polys) {
    const outer = arr(arr(p)[0]);
    const ring = outer.flatMap((pt) => {
      const [lon, lat] = arr(pt);
      return typeof lon === 'number' && typeof lat === 'number' ? [lon, lat] : [];
    });
    if (ring.length >= 8) out.push(ring);
  }
  return out;
}

/** "/O.EXT.KLCH.FL.W.0047.000000T0000Z-261107T1200Z/" → "KLCH.FL.W.0047" (office, phenomenon, significance, event number). */
export function vtecEvent(vtec: string): string {
  const m = /^\/?[OTEX]\.[A-Z]{3}\.([A-Z]{4})\.([A-Z]{2})\.([A-Z])\.(\d{4})\./.exec(vtec.trim());
  return m ? `${m[1]}.${m[2]}.${m[3]}.${m[4]}` : '';
}

/** `/alerts/active?point=…` (GeoJSON FeatureCollection). Every alert in it already covers the point asked for. */
export function parseNws(json: unknown): Alert[] {
  const out: Alert[] = [];
  for (const f of arr(obj(json).features)) {
    const p = obj(obj(f).properties);
    const id = str(p.id);
    if (!id || str(p.status) !== 'Actual') continue;
    const event = str(p.event);
    const hazard = hazardOfEvent(event);
    const level = levelOfSeverity(str(p.severity));
    if (!level) continue;
    const references = arr(p.references)
      .map((r) => str(obj(r).identifier))
      .filter(Boolean);
    const vtec = str(arr(obj(p.parameters).VTEC)[0]);
    const tracked = vtecEvent(vtec);
    const ugc = arr(obj(p.geocode).UGC).map(str).filter(Boolean);
    const zones = arr(p.affectedZones)
      .map((u) => /\/zones\/(\w+)\/(\w+)$/.exec(str(u)))
      .flatMap((m) => (m ? [`${m[1]}/${m[2]}`] : []));
    const rings = ringsOfGeometry(obj(f).geometry);
    const language = lang2(str(p.language) || 'en-US');
    out.push({
      id,
      source: 'nws',
      kind: hazard === 'tsunami' ? 'tsunami' : 'weather',
      hazard,
      level,
      msgType: msgTypeOf(str(p.messageType)),
      references,
      topic: tracked ? `nws:${tracked}` : '',
      sent: parseTime(str(p.sent)),
      onset: parseTime(str(p.onset)) ?? parseTime(str(p.effective)),
      // "ends" is when the hazard ends; "expires" when this message stops being current (NWS re-issues before it).
      expires: parseTime(str(p.ends)) ?? parseTime(str(p.expires)),
      area: str(p.areaDesc),
      texts: { [language]: { event, headline: str(p.headline), description: str(p.description), instruction: str(p.instruction) } },
      original: language,
      ...(rings.length ? { polygons: rings } : {}),
      ...(ugc.length ? { codes: ugc } : {}),
      ...(zones.length ? { zones } : {}),
      // No `url`: `@id` is the API's JSON, not a page for people.
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Earthquakes (USGS, EMSC)

function quake(
  source: SourceId,
  id: string,
  mag: number,
  time: number,
  lat: number,
  lon: number,
  depth: number | undefined,
  place: string,
  url: string | undefined,
): Alert {
  const title = `M ${mag.toFixed(1)} - ${place}`;
  return {
    id,
    source,
    kind: 'quake',
    hazard: 'quake',
    level: quakeLevel(mag),
    msgType: 'alert',
    references: [],
    topic: '',
    sent: time,
    onset: time,
    // Listed for a day (the feeds' own window), so a list cached offline doesn't keep old quakes forever.
    expires: time + 24 * 3600_000,
    area: place,
    texts: { en: { event: 'Earthquake', headline: title, description: '', instruction: '' } },
    original: 'en',
    point: { lat, lon },
    mag,
    ...(depth !== undefined ? { depthKm: depth } : {}),
    ...(url ? { url } : {}),
  };
}

/** USGS `summary/4.5_day.geojson`. Only `type: earthquake` (not quarry blasts and the like). */
export function parseUsgs(json: unknown): Alert[] {
  const out: Alert[] = [];
  for (const f of arr(obj(json).features)) {
    const p = obj(obj(f).properties);
    const [lon, lat, depth] = arr(obj(obj(f).geometry).coordinates).map(num);
    const id = str(obj(f).id);
    const mag = num(p.mag);
    const time = num(p.time);
    if (!id || mag === undefined || time === undefined || lat === undefined || lon === undefined) continue;
    if (str(p.type) && str(p.type) !== 'earthquake') continue;
    out.push(quake('usgs', id, mag, time, lat, lon, depth, str(p.place), str(p.url) || undefined));
  }
  return out;
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(-])[a-z]/g, (c) => c.toUpperCase());

/** EMSC FDSN `query?format=json`. Its regions are upper case ("SOUTH OF FIJI ISLANDS"): shown in title case. */
export function parseEmsc(json: unknown): Alert[] {
  const out: Alert[] = [];
  for (const f of arr(obj(json).features)) {
    const p = obj(obj(f).properties);
    const id = str(p.unid) || str(obj(f).id);
    const mag = num(p.mag);
    const time = parseTime(str(p.time));
    const lat = num(p.lat);
    const lon = num(p.lon);
    if (!id || mag === undefined || time === null || lat === undefined || lon === undefined) continue;
    if (str(p.evtype) && !str(p.evtype).endsWith('e')) continue; // "ke" known earthquake, "fe" felt…; "qb" quarry blast
    const depth = num(p.depth);
    out.push(
      quake(
        'emsc',
        id,
        mag,
        time,
        lat,
        lon,
        depth === undefined ? undefined : Math.abs(depth),
        titleCase(str(p.flynn_region)),
        `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(id)}`,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// GDACS

/**
 * GDACS's RSS → Orange/Red events with the countries they affect. Earthquakes are skipped: USGS + EMSC already cover
 * them with the distance rule, and GDACS repeats theirs.
 */
export function parseGdacs(xml: string): Alert[] {
  const out: Alert[] = [];
  for (const item of blocks(xml, 'item')) {
    const type = text(item, 'gdacs:eventtype');
    const level = levelOfGdacs(text(item, 'gdacs:alertlevel'));
    if (!level || type.toUpperCase() === 'EQ') continue;
    const id = text(item, 'guid') || `${type}${text(item, 'gdacs:eventid')}`;
    const countries = text(item, 'gdacs:iso3')
      .split(/[\s,;]+/)
      .map(iso2Of)
      .filter((c): c is string => c !== null);
    const lat = Number(text(item, 'geo:lat'));
    const lon = Number(text(item, 'geo:long'));
    const hazard = hazardOfGdacs(type);
    const kind: Kind = hazard === 'tsunami' ? 'tsunami' : 'disaster';
    const episode = text(item, 'gdacs:episodeid');
    const event = text(item, 'gdacs:country') || text(item, 'gdacs:eventname');
    // GDACS gives no end; `todate` is the last report, so the event stays a day past it unless reported again.
    const lastReport = parseTime(text(item, 'gdacs:todate')) ?? parseTime(text(item, 'pubDate'));
    out.push({
      id: episode ? `${id}-${episode}` : id,
      source: 'gdacs',
      kind,
      hazard,
      level,
      msgType: 'alert',
      references: [],
      topic: `gdacs:${id}`,
      sent: parseTime(text(item, 'gdacs:datemodified') || text(item, 'pubDate')),
      onset: parseTime(text(item, 'gdacs:fromdate')),
      expires: lastReport === null ? null : lastReport + 24 * 3600_000,
      area: event,
      texts: { en: { event: type, headline: text(item, 'title'), description: text(item, 'description'), instruction: '' } },
      original: 'en',
      ...(countries.length ? { countries } : {}),
      ...(Number.isFinite(lat) && Number.isFinite(lon) && text(item, 'geo:lat') ? { point: { lat, lon } } : {}),
      ...(text(item, 'link') ? { url: text(item, 'link') } : {}),
    });
  }
  return out;
}
