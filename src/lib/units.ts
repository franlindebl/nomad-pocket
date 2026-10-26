// The arithmetic behind lib/format.ts (which adds the locale's number format): which unit a
// size is shown in and how a remaining time is split. Rounding decides the unit, so a value
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
