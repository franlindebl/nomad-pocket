/**
 * Availability of the operating system's built-in language model.
 * - `available`: ready to generate.
 * - `notEnabled`: device is eligible but Apple Intelligence is turned off.
 * - `deviceNotEligible`: hardware can't run the model.
 * - `modelNotReady`: model assets are still downloading / being prepared by the OS.
 * - `downloadable`: (Android) Gemini Nano can be downloaded via `downloadSystemModel()`.
 * - `unsupportedOS`: OS too old (iOS < 26).
 * - `unsupported`: no system model on this platform/build (no AICore, web...).
 */
export type SystemModelStatus = 'available' | 'notEnabled' | 'deviceNotEligible' | 'modelNotReady' | 'downloadable' | 'unsupportedOS' | 'unsupported';

export type SystemModelInfo = {
  status: SystemModelStatus;
  /** 'apple' (Foundation Models) or 'gemini' (Gemini Nano via ML Kit), null if unsupported. */
  provider: 'apple' | 'gemini' | null;
  /** Free-form diagnostic (error message, raw status code...). */
  detail?: string | null;
};

export type GenerateOptions = {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
};

/** The model's call on whether a chat message needs a library search, and with what keywords. */
export type RouteDecision = { search: boolean; query: string };

export type DeltaEvent = {
  requestId: string;
  delta: string;
  /** True when the model rewrote earlier output: replace the text with `delta`. */
  reset?: boolean;
};

export type DoneEvent = { requestId: string; text: string; cancelled?: boolean };

export type ErrorEvent = { requestId: string; message: string; code?: string };

export type DownloadProgressEvent = { bytesDownloaded: number; totalBytes: number };

export type NomadLlmEvents = {
  onDelta: (e: DeltaEvent) => void;
  onDone: (e: DoneEvent) => void;
  onError: (e: ErrorEvent) => void;
  onDownloadProgress: (e: DownloadProgressEvent) => void;
};
