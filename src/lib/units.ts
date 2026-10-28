// The arithmetic behind lib/format.ts (which adds the locale's number format): which unit a
// size, distance or amount of water is shown in and how a remaining time is split. Rounding decides the unit, so a value
// never shows as "1,000 MB" or "1 h 60 min".
// No `@/` imports: unit tests load this file directly.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Decimal (SI) units, like the OS storage screens. Never below MB for content sizes. */
export function scaleBytes(bytes: number, digits?: number): { value: number; unit: (typeof UNITS)[number]; fractionDigits: number } {
  const pick = (i: number) => {
    const value = bytes / 10 ** (i * 3);
    const fractionDigits = digits ?? (value >= 100 ? 0 : value >= 1 ? 1 : 2);
    return { value, unit: UNITS[i], fractionDigits };
  };
  let i = Math.max(2, Math.min(UNITS.length - 1, Math.floor(Math.log10(bytes) / 3)));
  let out = pick(i);
  // 999.95 MB rounds to 1000: say 1 GB instead.
  while (i < UNITS.length - 1 && Number(out.value.toFixed(out.fractionDigits)) >= 1000) out = pick(++i);
  return out;
}

/** A remaining time, rounded up to what is left: "45 s", "12 min", "1 h 5 min". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const s = Math.ceil(seconds);
  if (s < 60) return `${s} s`;
  const minutes = Math.ceil(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The region's measurement system, as the OS reports it (expo-localization). */
export type MeasurementSystem = 'metric' | 'us' | 'uk';

const FEET_PER_METER = 3.28084;
const YARDS_PER_METER = 1.09361;
const METERS_PER_MILE = 1609.344;
const LITERS_PER_US_GALLON = 3.785411784;

/**
 * A distance in the units people in the region read on road signs: m/km, ft/mi in the US,
 * yd/mi in the UK (like Apple Maps there). Short distances round to `step` of their unit
 * (10 for directions, 1 for a GPS accuracy) and never show as 0; miles start at 0.1 mi.
 */
export function scaleDistance(
  meters: number,
  system: MeasurementSystem,
  step = 10,
): { value: number; unit: 'm' | 'km' | 'ft' | 'yd' | 'mi'; fractionDigits: number } {
  const m = Math.max(0, meters);
  const short = (value: number, unit: 'm' | 'ft' | 'yd') => ({ value: Math.max(step, Math.round(value / step) * step), unit, fractionDigits: 0 });
  const long = (value: number, unit: 'km' | 'mi') => ({ value, unit, fractionDigits: value < 9.95 ? 1 : 0 });
  if (system === 'metric') return Math.round(m / step) * step < 1000 ? short(m, 'm') : long(m / 1000, 'km');
  const miles = m / METERS_PER_MILE;
  if (miles >= 0.095) return long(miles, 'mi');
  return system === 'us' ? short(m * FEET_PER_METER, 'ft') : short(m * YARDS_PER_METER, 'yd');
}

/** A volume of water: litres, or US gallons in the US (Ready.gov: about a gallon a day per person). */
export function scaleWater(liters: number, system: MeasurementSystem): { value: number; unit: 'L' | 'gal'; fractionDigits: number } {
  if (system !== 'us') return { value: liters, unit: 'L', fractionDigits: 0 };
  const gallons = liters / LITERS_PER_US_GALLON;
  return { value: gallons, unit: 'gal', fractionDigits: gallons < 9.95 ? 1 : 0 };
}
