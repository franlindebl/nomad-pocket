// Why an answer failed, as stored in the chat state and shown by the error banner:
// a key with its own message under `assistant:errors.*`, or the raw error text.
// The system-model bridge (modules/nomad-llm) rejects with a code and an English
// message; known codes get a message in the user's language.
// No `@/` imports: unit tests load this file directly.

export const ERROR_KEYS = [
  'noModel',
  'notInstalled',
  'systemUnavailable',
  'tooLong',
  'declined',
  'language',
  'notReady',
  'busy',
  'batteryQuota',
  'background',
  'diskFull',
  'systemUpdate',
  'empty',
] as const;

export type ErrorKey = (typeof ERROR_KEYS)[number];

const BY_CODE: Record<string, ErrorKey> = {
  // Apple Foundation Models (NomadLlmModule.swift `describe`).
  ERR_UNAVAILABLE: 'systemUnavailable',
  ERR_UNSUPPORTED: 'systemUnavailable',
  ERR_CONTEXT: 'tooLong',
  ERR_GUARDRAIL: 'declined',
  ERR_LANGUAGE: 'language',
  ERR_ASSETS: 'notReady',
  ERR_RATE_LIMITED: 'busy',
  ERR_BUSY: 'busy',
  // ML Kit GenAI on Android: ERR_GENAI_<GenAiException.ErrorCode> (genai-common 1.0.0-beta4).
  ERR_GENAI_8: 'systemUnavailable', // NOT_AVAILABLE
  ERR_GENAI_9: 'busy', // BUSY
  ERR_GENAI_12: 'tooLong', // REQUEST_TOO_LARGE
  ERR_GENAI_16: 'systemUnavailable', // NOT_SUPPORTED
  ERR_GENAI_27: 'batteryQuota', // PER_APP_BATTERY_USE_QUOTA_EXCEEDED
  ERR_GENAI_30: 'background', // BACKGROUND_USE_BLOCKED
  ERR_GENAI_501: 'diskFull', // NOT_ENOUGH_DISK_SPACE
  ERR_GENAI_604: 'systemUpdate', // NEEDS_SYSTEM_UPDATE
  'ERR_GENAI_-101': 'systemUpdate', // AICORE_INCOMPATIBLE
};

export function isErrorKey(value: string): value is ErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(value);
}

/** What to show for a failed answer: the key of a known error code, else the error's own text. */
export function errorFor(e: unknown): string {
  const code = (e as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && BY_CODE[code]) return BY_CODE[code];
  const message = (e as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message ? message : String(e);
}
