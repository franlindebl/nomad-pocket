import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { Alert } from './alerts-core.ts';
import { alertSubtitle, alertTitle, formatWhen, type Words } from './present-core.ts';

const es = JSON.parse(readFileSync(new URL('../../i18n/locales/es/alerts.json', import.meta.url), 'utf8'));

// The same lookup the push server uses: dotted keys, _one/_other plurals, {{var}} interpolation.
function words(timeZone?: string): Words {
  const t = (fullKey: string, vars: Record<string, string | number> = {}) => {
    const key = fullKey.replace(/^alerts:/, '');
    const get = (k: string) => k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], es);
    const v = (typeof vars.count === 'number' && get(`${key}_${vars.count === 1 ? 'one' : 'other'}`)) || get(key);
    return String(v ?? key).replace(/\{\{(\w+)\}\}/g, (_, n) => String(vars[n] ?? ''));
  };
  return { t, locale: 'es', lang: 'es', timeZone, formatDistance: (m) => `${Math.round(m / 1000)} km` };
}

const base: Alert = {
  source: 'aemet',
  id: 'x',
  kind: 'weather',
  hazard: 'rain',
  level: 'orange',
  msgType: 'alert',
  references: [],
  topic: '',
  sent: null,
  onset: null,
  expires: null,
  area: 'Litoral sur de Valencia',
  texts: {},
  original: 'es',
} as unknown as Alert;

test('weather title and window in the person’s time zone', () => {
  // 22:30 UTC on 12 Nov is 23:30 in Madrid: "hoy" there; the end, 23:30 UTC, is already 00:30 of the 13th in Madrid.
  const now = Date.UTC(2026, 10, 12, 22, 30);
  const a = { ...base, onset: now - 3600_000, expires: Date.UTC(2026, 10, 12, 23, 30) };
  assert.equal(alertTitle(words('Europe/Madrid'), a), 'Aviso naranja · Lluvias');
  assert.equal(alertSubtitle(words('Europe/Madrid'), a, null, now), 'Litoral sur de Valencia · hasta mañana 00:30');
  assert.equal(formatWhen(words('UTC'), a.expires!, now), 'hoy 23:30');
});

test('quake title, distance and age', () => {
  const now = Date.UTC(2026, 10, 12, 12, 0);
  const q = { ...base, kind: 'quake', hazard: 'quake', mag: 5.24, point: { lat: 37.0, lon: -3.0 }, area: 'Granada', sent: now - 12 * 60_000 } as Alert;
  assert.equal(alertTitle(words(), q), 'Terremoto M 5,2');
  assert.equal(alertSubtitle(words(), q, { lat: 37.1, lon: -3.6 }, now), 'a 54 km · Granada · hace 12 min');
});

test('shortArea: a long list of places keeps its first three', async () => {
  const { shortArea } = await import('./present-core.ts');
  assert.equal(shortArea('Madrid'), 'Madrid');
  const long = 'Kreis Wittmund - Küste, Kreis Aurich - Küste, Kreis Cuxhaven - Küste, Stadt Bremerhaven, Kreis Wesermarsch - Küste';
  assert.equal(shortArea(long), 'Kreis Wittmund - Küste, Kreis Aurich - Küste, Kreis Cuxhaven - Küste…');
  assert.equal(shortArea('Marion; Lamar; Fayette; Winston; Walker; Blount; Etowah; Calhoun; Cherokee; Cleburne; Pickens; Tuscaloosa'), 'Marion, Lamar, Fayette…');
});
