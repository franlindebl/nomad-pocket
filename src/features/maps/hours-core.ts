// "Open now" from OpenStreetMap's opening_hours, a subset of its grammar: 24/7, weekdays and their ranges
// (Mo-Fr, Sa,Su), times and lists of times (09:00-14:00,17:00-20:00, overnight 22:00-02:00), off / closed, rules
// separated by ";" where a later rule replaces the earlier ones for its days, and PH (public holidays) left aside.
// Anything else (months, weeks, sunrise, comments, "+") is unknown: never "open" when unsure, since someone may walk
// there in an emergency. The full grammar (opening_hours.js) is large; this covers the common forms.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.

export type OpenState = 'open' | 'closed' | null;

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

type Rule = { days: Set<number>; spans: [number, number][] | 'off' };

/** "09:00" → minutes from midnight; "24:00" → 1440. */
function minutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 24 && min < 60 && h * 60 + min <= 1440 ? h * 60 + min : null;
}

/** "Mo-Fr", "Sa,Su", "Mo-We,Fr" → day indexes (Monday 0); null when not a day list. */
function parseDays(s: string): Set<number> | null {
  const out = new Set<number>();
  for (const part of s.split(',')) {
    const [a, b] = part.split('-');
    const i = DAYS.indexOf(a as (typeof DAYS)[number]);
    if (i < 0) return null;
    if (b === undefined) {
      out.add(i);
      continue;
    }
    const j = DAYS.indexOf(b as (typeof DAYS)[number]);
    if (j < 0) return null;
    // Wrapping ranges ("Fr-Mo") go round the week.
    for (let k = i; ; k = (k + 1) % 7) {
      out.add(k);
      if (k === j) break;
    }
  }
  return out;
}

function parseSpans(s: string): [number, number][] | null {
  const out: [number, number][] = [];
  for (const part of s.split(',')) {
    const [a, b] = part.split('-');
    const from = minutes(a ?? '');
    const to = minutes(b ?? '');
    if (from === null || to === null) return null;
    out.push([from, to]);
  }
  return out;
}

const ALL = new Set([0, 1, 2, 3, 4, 5, 6]);

/** The rules of an opening_hours value, or null when any part is outside the subset. PH rules are dropped. */
export function parseHours(value: string): Rule[] | null {
  const text = value.trim();
  if (!text) return null;
  if (text === '24/7') return [{ days: ALL, spans: [[0, 1440]] }];
  const rules: Rule[] = [];
  for (const raw of text.split(';')) {
    let r = raw.trim();
    if (!r) continue;
    // "PH off", "PH 10:00-14:00": holidays aren't known on the device; the weekday rules stand.
    if (/^PH\b/.test(r)) continue;
    r = r.replace(/,\s*PH\b/, '').replace(/\bPH\s*,/, '');
    const m = /^(?:([A-Za-z,-]+)\s+)?(.+)$/.exec(r);
    if (!m) return null;
    let daysText = m[1];
    let rest = m[2].trim();
    // A rule that is only days ("Mo-Fr") is open all day; "Mo-Fr off".
    if (!daysText && parseDays(rest)) {
      daysText = rest;
      rest = '00:00-24:00';
    }
    const days = daysText ? parseDays(daysText) : ALL;
    if (!days) return null;
    if (/^(?:off|closed)$/i.test(rest)) {
      rules.push({ days, spans: 'off' });
      continue;
    }
    if (rest === '24/7') {
      rules.push({ days, spans: [[0, 1440]] });
      continue;
    }
    const spans = parseSpans(rest.replace(/\s+/g, ''));
    if (!spans) return null;
    rules.push({ days, spans });
  }
  return rules.length ? rules : null;
}

/** The rules in force for a weekday: the last rule naming it wins (OSM: later rules override earlier ones). */
function rulesFor(rules: Rule[], day: number): Rule | null {
  let found: Rule | null = null;
  for (const r of rules) if (r.days.has(day)) found = r;
  return found;
}

/**
 * Whether a place is open at a moment (the device's local time), or null when its hours aren't understood. A span
 * past midnight ("22:00-02:00") is open early the next day too.
 */
export function openState(value: string | null | undefined, at: Date): OpenState {
  if (!value) return null;
  const rules = parseHours(value);
  if (!rules) return null;
  const day = (at.getDay() + 6) % 7;
  const now = at.getHours() * 60 + at.getMinutes();
  const today = rulesFor(rules, day);
  if (today && today.spans !== 'off') {
    for (const [from, to] of today.spans) {
      if (to > from ? now >= from && now < to : now >= from) return 'open';
    }
  }
  // Yesterday's overnight span still running.
  const yesterday = rulesFor(rules, (day + 6) % 7);
  if (yesterday && yesterday.spans !== 'off') {
    for (const [from, to] of yesterday.spans) if (to <= from && now < to) return 'open';
  }
  return 'closed';
}
