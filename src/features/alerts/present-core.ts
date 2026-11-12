// The app's frame around an official alert (docs/ALERTS_PLAN.md, decision 5): its title, when it applies, how long
// ago, how far. Shared by the app (present.ts, over i18next) and the push server (server/alerts, over the same locale
// JSON), so a pushed alert reads exactly like a locally notified one. Pure (no app imports) so node --test can load it.
import { distanceKm, textFor, type Alert, type LatLon } from './alerts-core.ts';

export type Words = {
  /** i18next-style lookup ("alerts:quakeTitle", "alerts:ago.minutes" with `count`, …). */
  t: (k: string, vars?: Record<string, string | number>) => string;
  /** BCP 47 locale for numbers and dates ("es", "en"). */
  locale: string;
  /** Two-letter language of the alert texts to pick. */
  lang: string;
  /** IANA zone for days and times; undefined = the device's own (the app). The server passes the person's. */
  timeZone?: string;
  /** "42 km" (the app follows its unit setting; the server uses km, or miles for `en-US`). */
  formatDistance: (meters: number) => string;
};

const DAY = 24 * 3600_000;

/** Days since the epoch of `ts` as a calendar date in the zone (so "today"/"tomorrow" follow the person's clock). */
function dayNumber(ts: number, timeZone: string | undefined): number {
  if (!timeZone) {
    const d = new Date(ts);
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(ts);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Math.round(Date.UTC(n('year'), n('month') - 1, n('day')) / DAY);
}

export function formatMag(w: Words, mag: number | undefined): string {
  return mag === undefined ? '?' : new Intl.NumberFormat(w.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(mag);
}

/**
 * "Aviso naranja · Lluvias", "Terremoto M 5,2". NWS's events are already named for people ("Flood Warning"): their
 * own name is kept.
 */
export function alertTitle(w: Words, a: Alert): string {
  const { t } = w;
  if (a.kind === 'quake') return t('alerts:quakeTitle', { mag: formatMag(w, a.mag) });
  const level = t(`alerts:levelName.${a.level}`);
  const what = a.source === 'nws' || a.hazard === 'other' ? textFor(a, w.lang).event || t('alerts:hazard.other') : t(`alerts:hazard.${a.hazard}`);
  return t('alerts:warningTitle', { level, what });
}

/** "hoy 19:00", "mañana 06:00", "jue 6 nov 12:00". */
export function formatWhen(w: Words, ts: number, now: number): string {
  const { t } = w;
  const time = new Intl.DateTimeFormat(w.locale, { hour: '2-digit', minute: '2-digit', timeZone: w.timeZone }).format(ts);
  const days = dayNumber(ts, w.timeZone) - dayNumber(now, w.timeZone);
  if (days === 0) return t('alerts:when.today', { time });
  if (days === 1) return t('alerts:when.tomorrow', { time });
  if (days === -1) return t('alerts:when.yesterday', { time });
  const date = new Intl.DateTimeFormat(w.locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: w.timeZone }).format(ts);
  return t('alerts:when.date', { date, time });
}

/** "ahora", "hace 5 min", "hace 3 h", "hace 2 días" (Hermes has no Intl.RelativeTimeFormat). */
export function agoLabel(w: Words, ts: number, now: number): string {
  const { t } = w;
  const min = Math.max(0, Math.round((now - ts) / 60_000));
  if (min < 1) return t('alerts:ago.now');
  if (min < 60) return t('alerts:ago.minutes', { count: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('alerts:ago.hours', { count: h });
  return t('alerts:ago.days', { count: Math.round(h / 24) });
}

/** "desde hoy 19:00 hasta mañana 06:00", "hasta mañana 06:00", "hace 12 min" (a quake). */
export function windowLabel(w: Words, a: Alert, now: number): string {
  const { t } = w;
  if (a.kind === 'quake') return a.sent !== null ? agoLabel(w, a.sent, now) : '';
  const start = a.onset;
  const end = a.kind === 'disaster' ? null : a.expires;
  if (start !== null && start > now && end !== null) return t('alerts:window.fromTo', { from: formatWhen(w, start, now), to: formatWhen(w, end, now) });
  if (start !== null && start > now) return t('alerts:window.from', { from: formatWhen(w, start, now) });
  if (end !== null) return t('alerts:window.until', { to: formatWhen(w, end, now) });
  return '';
}

/** "a 42 km" from the person, for quakes and GDACS events. */
export function distanceLabel(w: Words, a: Alert, pos: LatLon | null): string | null {
  const { t } = w;
  if (!pos || !a.point) return null;
  return t('alerts:distance', { distance: w.formatDistance(distanceKm(pos, a.point) * 1000) });
}

/** One line under the title: the place, and when (or how far, for a quake). */
/** A long list of places (MeteoAlarm and NWS name every district or county) cut to its first three. */
export function shortArea(area: string): string {
  if (area.length <= 90) return area;
  const parts = area.split(/[;,]\s*/).filter(Boolean);
  return parts.length > 3 ? `${parts.slice(0, 3).join(', ')}…` : area;
}

export function alertSubtitle(w: Words, a: Alert, pos: LatLon | null, now: number): string {
  const area = shortArea(a.area);
  const parts = a.kind === 'quake' ? [distanceLabel(w, a, pos), area, windowLabel(w, a, now)] : [area, windowLabel(w, a, now)];
  return parts.filter(Boolean).join(' · ');
}
