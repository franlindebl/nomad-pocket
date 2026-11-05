// CAP 1.2 (Common Alerting Protocol, OASIS) → plain objects. AEMET, MeteoAlarm, NWS and GDACS all publish CAP;
// here it is read with a few regexes because React Native has no DOMParser (same approach as catalog/opds.ts).
// Only the subset the alerts feature uses is read. Element names may carry any namespace prefix (`cap:info`).
// Times become epoch ms; polygons become flat [lon, lat, lon, lat…] arrays (CAP writes "lat,lon lat,lon…").
// Pure (no app imports) so node --test can load it.

export type CapArea = {
  desc: string;
  /** Each ring flattened as [lon, lat, lon, lat…], first point repeated at the end as CAP requires. */
  polygons: number[][];
  circles: { lat: number; lon: number; km: number }[];
  /** valueName → values (AEMET "AEMET-Meteoalerta zona", MeteoAlarm "EMMA_ID", NWS "UGC"/"SAME"). */
  geocodes: Record<string, string[]>;
};

export type CapInfo = {
  /** As published: "es-ES", "en-GB", "en-US"… (CAP's default is en-US). */
  language: string;
  category: string;
  event: string;
  urgency: string;
  severity: string;
  certainty: string;
  effective: number | null;
  onset: number | null;
  expires: number | null;
  senderName: string;
  headline: string;
  description: string;
  instruction: string;
  web: string;
  eventCodes: Record<string, string>;
  parameters: Record<string, string>;
  areas: CapArea[];
};

export type CapAlert = {
  identifier: string;
  sender: string;
  sent: number | null;
  status: string;
  msgType: string;
  scope: string;
  /** Identifiers of the earlier messages this one updates or cancels (CAP's "sender,identifier,sent" triples). */
  references: string[];
  infos: CapInfo[];
};

// ---------------------------------------------------------------------------
// XML helpers (shared with feeds-core)

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, ent: string) => {
    if (ent[0] !== '#') return NAMED[ent] ?? match;
    const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
    try {
      return String.fromCodePoint(code);
    } catch {
      return match;
    }
  });
}

/**
 * Text of an element's content: CDATA kept verbatim, markup elsewhere dropped, entities decoded. Line breaks are
 * kept (NWS and AEMET texts have paragraphs); spaces inside a line are collapsed.
 */
export function xmlText(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const start = raw.indexOf('<![CDATA[', i);
    if (start === -1) {
      out += decodeEntities(raw.slice(i).replace(/<[^>]*>/g, ''));
      break;
    }
    out += decodeEntities(raw.slice(i, start).replace(/<[^>]*>/g, ''));
    const end = raw.indexOf(']]>', start + 9);
    out += raw.slice(start + 9, end === -1 ? raw.length : end);
    if (end === -1) break;
    i = end + 3;
  }
  return out
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `tag` with any (or no) namespace prefix; `cap:event` also matches only that exact prefixed name. */
function tagRe(tag: string, flags: string): RegExp {
  const name = tag.includes(':') ? esc(tag) : `(?:[\\w.-]+:)?${esc(tag)}`;
  return new RegExp(`<(${name})(?=[\\s/>])[^>]*?(?:/>|>([\\s\\S]*?)</\\1\\s*>)`, flags);
}

/** Raw inner markup of every `<tag>` element (not nested in one another), in document order. */
export function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = tagRe(tag, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[2] ?? '');
  return out;
}

/** Text of the first `<tag>`, or '' when absent. */
export function text(xml: string, tag: string): string {
  const m = tagRe(tag, '').exec(xml);
  return m ? xmlText(m[2] ?? '') : '';
}

/** Attributes of the first `<tag …>` whose attributes satisfy `pick` (all of them when it is omitted). */
export function attrs(xml: string, tag: string, pick?: (a: Record<string, string>) => boolean): Record<string, string> | null {
  const name = tag.includes(':') ? esc(tag) : `(?:[\\w.-]+:)?${esc(tag)}`;
  const re = new RegExp(`<${name}(\\s[^>]*?)?\\/?>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const a: Record<string, string> = {};
    const ar = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let am: RegExpExecArray | null;
    while ((am = ar.exec(m[1] ?? ''))) a[am[1]] = decodeEntities(am[2] ?? am[3] ?? '');
    if (!pick || pick(a)) return a;
  }
  return null;
}

/** `xml` with every `<tag>` element (any prefix) removed, so a parent's own children can be read safely. */
export function without(xml: string, tags: string[]): string {
  return tags.reduce((s, t) => s.replace(tagRe(t, 'g'), ''), xml);
}

const MONTHS = 'janfebmaraprmayjunjulaugsepoctnovdec';

/** RSS's RFC 822 dates ("Wed,  4 Nov 2026 22:50:01 +0000", GDACS "… GMT"), read by hand: Hermes's Date.parse is only sure for ISO 8601. */
function parseRfc822(s: string): number | null {
  const m = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(GMT|UTC?|Z|[+-]\d{4})?$/.exec(s);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase()) / 3;
  if (!Number.isInteger(month)) return null;
  const zone = m[7] && /^[+-]/.test(m[7]) ? m[7] : '+0000';
  const offset = (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5)));
  return Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)) - offset * 60_000;
}

/** ISO 8601 / RFC 822 time → epoch ms, or null. */
export function parseTime(s: string | null | undefined): number | null {
  const v = s?.trim();
  if (!v) return null;
  const rfc = parseRfc822(v);
  if (rfc !== null) return rfc;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// ---------------------------------------------------------------------------
// CAP

/** "lat,lon lat,lon …" → [lon, lat, lon, lat…]; null for fewer than 4 points or a bad pair. */
export function parsePolygon(s: string): number[] | null {
  const out: number[] = [];
  for (const pair of s.trim().split(/\s+/)) {
    const [lat, lon] = pair.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    out.push(lon, lat);
  }
  return out.length >= 8 ? out : null;
}

function parseCircle(s: string): { lat: number; lon: number; km: number } | null {
  const m = /^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s+([\d.]+)\s*$/.exec(s);
  if (!m) return null;
  const [lat, lon, km] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(km) ? { lat, lon, km } : null;
}

/** valueName/value pairs of every `<tag>` (parameter, eventCode, geocode). Repeated names keep every value. */
function pairs(xml: string, tag: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const b of blocks(xml, tag)) {
    const name = text(b, 'valueName');
    if (!name) continue;
    (out[name] ??= []).push(text(b, 'value'));
  }
  return out;
}

const first = (r: Record<string, string[]>): Record<string, string> =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v[0] ?? '']));

function parseArea(xml: string): CapArea {
  return {
    desc: text(xml, 'areaDesc'),
    polygons: blocks(xml, 'polygon')
      .map((p) => parsePolygon(xmlText(p)))
      .filter((p): p is number[] => p !== null),
    circles: blocks(xml, 'circle')
      .map((c) => parseCircle(xmlText(c)))
      .filter((c): c is NonNullable<typeof c> => c !== null),
    geocodes: pairs(xml, 'geocode'),
  };
}

function parseInfo(xml: string): CapInfo {
  const own = without(xml, ['area', 'parameter', 'eventCode', 'resource']);
  return {
    language: text(own, 'language') || 'en-US',
    category: text(own, 'category'),
    event: text(own, 'event'),
    urgency: text(own, 'urgency'),
    severity: text(own, 'severity'),
    certainty: text(own, 'certainty'),
    effective: parseTime(text(own, 'effective')),
    onset: parseTime(text(own, 'onset')),
    expires: parseTime(text(own, 'expires')),
    senderName: text(own, 'senderName'),
    headline: text(own, 'headline'),
    description: text(own, 'description'),
    instruction: text(own, 'instruction'),
    web: text(own, 'web'),
    eventCodes: first(pairs(xml, 'eventCode')),
    parameters: first(pairs(xml, 'parameter')),
    areas: blocks(xml, 'area').map(parseArea),
  };
}

/** CAP "sender,identifier,sent sender,identifier,sent…" → the identifiers. */
export function parseReferences(s: string): string[] {
  return s
    .trim()
    .split(/\s+/)
    .map((t) => t.split(',')[1] ?? '')
    .filter(Boolean);
}

/** One CAP 1.2 `<alert>` document, or null when it isn't one (no `<alert>` or no identifier). */
export function parseCap(xml: string): CapAlert | null {
  const body = blocks(xml, 'alert')[0];
  if (body === undefined) return null;
  const head = without(body, ['info']);
  const identifier = text(head, 'identifier');
  if (!identifier) return null;
  return {
    identifier,
    sender: text(head, 'sender'),
    sent: parseTime(text(head, 'sent')),
    status: text(head, 'status'),
    msgType: text(head, 'msgType'),
    scope: text(head, 'scope'),
    references: parseReferences(text(head, 'references')),
    infos: blocks(body, 'info').map(parseInfo),
  };
}
