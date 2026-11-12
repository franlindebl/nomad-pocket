// Words for an alert in the app's frame: its title, when it applies, how long ago, how far. The source's own texts
// are shown as they are (textFor); only this frame is ours (docs/ALERTS_PLAN.md, decision 5). The wording lives in
// present-core.ts, shared with the push server; this binds it to i18next and the unit setting. No React here: the
// background task builds notifications with these too.
import i18n from '@/i18n';
import { formatDistance } from '@/lib/format';

import { textFor, type Alert, type AlertText, type LatLon, type SourceId } from './alerts-core';
import * as core from './present-core';

export type Lang = 'es' | 'en';
export const appLang = (): Lang => (i18n.language === 'es' ? 'es' : 'en');

/** Route param of an alert: unique across sources. */
export const alertKey = (a: Pick<Alert, 'source' | 'id'>) => `${a.source}:${a.id}`;

export const officialText = (a: Alert): AlertText => textFor(a, appLang());

const words = (): core.Words => ({
  t: (key, vars) => i18n.t(key, vars),
  locale: i18n.language,
  lang: appLang(),
  formatDistance: (m) => formatDistance(m, 1000),
});

export const formatMag = (mag: number | undefined): string => core.formatMag(words(), mag);

/** "Aviso naranja · Lluvias", "Terremoto M 5,2". */
export const alertTitle = (a: Alert): string => core.alertTitle(words(), a);

/** "hoy 19:00", "mañana 06:00", "jue 6 nov 12:00". */
export const formatWhen = (ts: number, now = Date.now()): string => core.formatWhen(words(), ts, now);

/** "desde hoy 19:00 hasta mañana 06:00", "hasta mañana 06:00", "hace 12 min" (a quake). */
export const windowLabel = (a: Alert, now = Date.now()): string => core.windowLabel(words(), a, now);

/** "ahora", "hace 5 min", "hace 3 h", "hace 2 días". */
export const agoLabel = (ts: number, now = Date.now()): string => core.agoLabel(words(), ts, now);

/** "a 42 km" from the person, for quakes and GDACS events. */
export const distanceLabel = (a: Alert, pos: LatLon | null): string | null => core.distanceLabel(words(), a, pos);

/** One line under the title: the place, and when (or how far, for a quake). */
export const alertSubtitle = (a: Alert, pos: LatLon | null, now = Date.now()): string => core.alertSubtitle(words(), a, pos, now);

export const sourceName = (s: SourceId): string => i18n.t(`alerts:source.${s}`);
