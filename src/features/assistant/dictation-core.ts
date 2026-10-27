// Dictation in the chat composer, the pure part: which recognizer locale to ask for and how
// the spoken text joins what was already typed. The recognizer itself is the OS's
// (dictation.ts), always on the device.
// No `@/` imports: unit tests load this file directly.

/** Used when the phone's own regions don't speak the app's language. */
const FALLBACK: Record<string, string> = { es: 'es-ES', en: 'en-US' };

/**
 * Recognizer locale for the app language `lang`: the phone's first locale in that language
 * (a Mexican phone gets es-MX), else the language's default. `supported`, when known, wins:
 * the first locale in it for that language if neither of ours is there.
 */
export function dictationLocale(lang: string, deviceLocales: string[], supported?: string[]): string {
  const norm = (l: string) => l.replace('_', '-');
  const same = (l: string) => norm(l).split('-')[0].toLowerCase() === lang;
  const wanted = [...deviceLocales.map(norm).filter((l) => same(l) && l.includes('-')), FALLBACK[lang] ?? lang];
  if (!supported?.length) return wanted[0];
  const has = new Set(supported.map((l) => norm(l).toLowerCase()));
  return wanted.find((l) => has.has(l.toLowerCase())) ?? supported.map(norm).find(same) ?? wanted[0];
}

/** `before` (what was typed when dictation started) followed by what is being said. */
export function joinDictation(before: string, spoken: string): string {
  const said = spoken.trim();
  if (!said) return before;
  if (!before.trim()) return said;
  return /\s$/.test(before) ? before + said : `${before} ${said}`;
}
