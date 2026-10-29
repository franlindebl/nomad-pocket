// The mailto: link behind "Report answer". Google Play's AI-generated content policy asks for a way to
// flag an offensive answer without leaving the app; the app has no server of its own, so the report is
// an email the user reviews and sends from their mail app (nothing leaves the device otherwise).
// No `@/` imports: unit tests load this file directly.

export const REPORT_EMAIL = 'fran.linde.blazquez@gmail.com';

// Mail apps and Android intents cut long mailto: URLs; an answer is rarely longer than this.
const MAX_ANSWER = 1500;

export function clipAnswer(answer: string, max = MAX_ANSWER): string {
  const text = answer.trim();
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

export function reportMailto(subject: string, body: string, to = REPORT_EMAIL): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
