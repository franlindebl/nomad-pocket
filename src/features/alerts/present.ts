// Words for an alert in the app's frame: its title, when it applies, how long ago, how far. The source's own texts
// are shown as they are (textFor); only this frame is ours (docs/ALERTS_PLAN.md, decision 5). No React here: the
// background task builds notifications with these too.
import i18n from '@/i18n';
import { formatDistance } from '@/lib/format';

import { distanceKm, textFor, type Alert, type AlertText, type LatLon, type SourceId } from './alerts-core';

export type Lang = 'es' | 'en';
export const appLang = (): Lang => (i18n.language === 'es' ? 'es' : 'en');

/** Route param of an alert: unique across sources. */
export const alertKey = (a: Pick<Alert, 'source' | 'id'>) => `${a.source}:${a.id}`;

export const officialText = (a: Alert): AlertText => textFor(a, appLang());

export function formatMag(mag: number | undefined): string {
  return mag === undefined ? '?' : new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(mag);
}

/**
 * "Aviso naranja · Lluvias", "Terremoto M 5,2". NWS's events are already named for people ("Flood Warning"): their
 * own name is kept.
 */
export function alertTitle(a: Alert): string {
  if (a.kind === 'quake') return i18n.t('alerts:quakeTitle', { mag: formatMag(a.mag) });
  const level = i18n.t(`alerts:levelName.${a.level}`);
  const what =
    a.source === 'nws' || a.hazard === 'other'
      ? officialText(a).event || i18n.t('alerts:hazard.other')
      : i18n.t(`alerts:hazard.${a.hazard}`);
  return i18n.t('alerts:warningTitle', { level, what });
}

const DAY = 24 * 3600_000;
const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "hoy 19:00", "mañana 06:00", "jue 6 nov 12:00". */
export function formatWhen(ts: number, now = Date.now()): string {
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(ts);
  const days = Math.round((startOfDay(ts) - startOfDay(now)) / DAY);
  if (days === 0) return i18n.t('alerts:when.today', { time });
  if (days === 1) return i18n.t('alerts:when.tomorrow', { time });
  if (days === -1) return i18n.t('alerts:when.yesterday', { time });
  const date = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(ts);
  return i18n.t('alerts:when.date', { date, time });
}

/** "desde hoy 19:00 hasta mañana 06:00", "hasta mañana 06:00", "hace 12 min" (a quake). */
export function windowLabel(a: Alert, now = Date.now()): string {
  if (a.kind === 'quake') return a.sent !== null ? agoLabel(a.sent, now) : '';
  const start = a.onset;
  const end = a.kind === 'disaster' ? null : a.expires;
  if (start !== null && start > now && end !== null)
    return i18n.t('alerts:window.fromTo', { from: formatWhen(start, now), to: formatWhen(end, now) });
  if (start !== null && start > now) return i18n.t('alerts:window.from', { from: formatWhen(start, now) });
  if (end !== null) return i18n.t('alerts:window.until', { to: formatWhen(end, now) });
  return '';
}

/** "ahora", "hace 5 min", "hace 3 h", "hace 2 días" (Hermes has no Intl.RelativeTimeFormat). */
export function agoLabel(ts: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - ts) / 60_000));
  if (min < 1) return i18n.t('alerts:ago.now');
  if (min < 60) return i18n.t('alerts:ago.minutes', { count: min });
  const h = Math.round(min / 60);
  if (h < 24) return i18n.t('alerts:ago.hours', { count: h });
  return i18n.t('alerts:ago.days', { count: Math.round(h / 24) });
}

/** "a 42 km" from the person, for quakes and GDACS events. */
export function distanceLabel(a: Alert, pos: LatLon | null): string | null {
  if (!pos || !a.point) return null;
  return i18n.t('alerts:distance', { distance: formatDistance(distanceKm(pos, a.point) * 1000, 1000) });
}

/** One line under the title: the place, and when (or how far, for a quake). */
export function alertSubtitle(a: Alert, pos: LatLon | null, now = Date.now()): string {
  const parts = a.kind === 'quake' ? [distanceLabel(a, pos), a.area, windowLabel(a, now)] : [a.area, windowLabel(a, now)];
  return parts.filter(Boolean).join(' · ');
}

export const sourceName = (s: SourceId): string => i18n.t(`alerts:source.${s}`);
