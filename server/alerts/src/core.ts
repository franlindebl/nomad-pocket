// The app's pure alert cores, used here as they are (docs/ALERTS_PLAN.md, phase 2 design): the server parses,
// matches and words alerts exactly like the app's phase-1 check, and both share the tests. esbuild bundles them into
// lib/index.js; node --test loads them directly.
import en from '../../../src/i18n/locales/en/alerts.json' with { type: 'json' };
import es from '../../../src/i18n/locales/es/alerts.json' with { type: 'json' };
import type { Words } from '../../../src/features/alerts/present-core.ts';

export * from '../../../src/features/alerts/alerts-core.ts';
export { alertOfCap, alertsOfAemetBundle, parseAemetRss, parseEmsc, parseGdacs, parseMeteoalarmAtom, parseNws, parseUsgs } from '../../../src/features/alerts/feeds-core.ts';
export { xmlFilesOfTarGz } from '../../../src/features/alerts/tar-core.ts';
export { parseCap } from '../../../src/features/alerts/cap-core.ts';
export { alertSubtitle, alertTitle, formatWhen, type Words } from '../../../src/features/alerts/present-core.ts';

const LOCALES: Record<string, unknown> = { es, en };

/** The app's own wording in `lang` (es or en), in the person's time zone, like i18next would give it. */
export function wordsFor(lang: string, timeZone: string | undefined): Words {
  const dict = LOCALES[lang] ?? en;
  const get = (k: string) => k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], dict);
  const t = (fullKey: string, vars: Record<string, string | number> = {}) => {
    const key = fullKey.replace(/^alerts:/, '');
    const plural = typeof vars.count === 'number' ? get(`${key}_${vars.count === 1 ? 'one' : 'other'}`) : undefined;
    const v = plural ?? get(key);
    return String(typeof v === 'string' ? v : key).replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(vars[n] ?? ''));
  };
  const locale = lang === 'es' ? 'es' : 'en';
  const km = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return { t, locale, lang: LOCALES[lang] ? lang : 'en', timeZone, formatDistance: (m) => `${km.format(Math.max(1, Math.round(m / 1000)))} km` };
}
