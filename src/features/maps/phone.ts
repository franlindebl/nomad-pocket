// Phone numbers as people and OpenStreetMap write them, turned into what a tel: URL
// can dial. OSM's phone tags often hold several numbers ("+34 976 765 500;+34 976 765
// 501") or an extension ("+34 900 123 456 ext. 12"); stripping every non-digit glued
// them into one invalid number. Used for emergency places, the family plan's contacts
// and the 112/911 buttons.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.

export type PhoneNumber = {
  /** The number as written (spaces kept), plus its extension: what the screen shows. */
  label: string;
  /** Digits, with a leading + for international numbers: what gets dialled. */
  dial: string;
};

/** Shortest real number is a three-digit emergency one; E.164 allows 15 digits, plus a "00" prefix. */
const MIN_DIGITS = 3;
const MAX_DIGITS = 17;
/** A slash between two parts this long separates two numbers ("600 111 222 / 600 333 444"). */
const SLASH_NUMBER_DIGITS = 6;

const digitCount = (s: string) => s.replace(/\D/g, '').length;

/**
 * Every number in a phone field, in order, without duplicates, at most `max`.
 * Lists use ";" (OSM's separator), "," or "|", or nothing but the next number's "+".
 */
export function parsePhones(raw: string | null | undefined, max = 3): PhoneNumber[] {
  if (!raw) return [];
  const out: PhoneNumber[] = [];
  const parts = raw.replace(/(\d)\s*(?=\+)/g, '$1;').split(/[;,|\n]/);
  for (const part of parts.flatMap(splitSlash)) {
    const phone = parsePhone(part);
    if (phone && !out.some((p) => p.dial === phone.dial)) out.push(phone);
    if (out.length >= max) break;
  }
  return out;
}

/** The tel: URL for a number (parsed, or a bare one such as "112"). */
export function telUrl(phone: PhoneNumber | string): string {
  return `tel:${typeof phone === 'string' ? phone.replace(/[^\d+]/g, '') : phone.dial}`;
}

/**
 * "600 111 222 / 600 333 444" holds two numbers; "030/1234567" (German and Austrian
 * style) is one, with the slash after the area code.
 */
function splitSlash(part: string): string[] {
  if (!part.includes('/')) return [part];
  const pieces = part.split('/');
  return pieces.every((p) => digitCount(p) >= SLASH_NUMBER_DIGITS) ? pieces : [part];
}

function parsePhone(part: string): PhoneNumber | null {
  // The number runs from its first digit, "+" or "(" until letters start: "ext. 12",
  // "x12", "#12" or a note such as "(urgencias)" are not part of it.
  const match = part.match(/[+(\d][\d\s()+.\-\/‐-―]*/);
  if (!match) return null;
  const text = match[0].replace(/[\s(.\-\/‐-―]+$/, '').replace(/\s+/g, ' ');
  const international = /^\(?\+/.test(text);
  // "+44 (0)20 …": the (0) is the national trunk prefix, never dialled after the country code.
  const digits = (international ? text.replace(/\(0\)/g, '') : text).replace(/\D/g, '');
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  const ext = part.slice((match.index ?? 0) + match[0].length).match(/^\s*(?:ext\.?|extension|extensión|x|#)\s*:?\s*(\d+)/i);
  return { label: ext ? `${text} ext. ${ext[1]}` : text, dial: `${international ? '+' : ''}${digits}` };
}
