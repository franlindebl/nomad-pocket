// One interface over the two local inference backends:
//  - the OS model (Apple Foundation Models / Gemini Nano) via modules/nomad-llm
//  - downloaded GGUF models via llama.rn (llama.cpp, chat template from the GGUF)
// Engines load lazily, stream text, can be stopped, and are released when the
// app goes to the background or after a few idle minutes (GGUF contexts hold
// hundreds of MB to several GB of RAM).
import * as Device from 'expo-device';
import { initLlama, type LlamaContext } from 'llama.rn';
import { AppState, Platform } from 'react-native';

import { getItem } from '@/features/content/items';
import { toNativePath } from '@/lib/storage';

import * as SystemLLM from '../../../modules/nomad-llm';
import { getModel, SYSTEM_MODEL_ID } from './models';
import { stripThinking, type Turn } from './rag-core';

export type GenerateRequest = {
  system: string;
  /** Conversation, oldest first; the last turn is the user's question. */
  messages: Turn[];
  temperature?: number;
  maxTokens?: number;
  /** Called with the whole answer so far (already cleaned) on every update. */
  onText: (text: string) => void;
};

export type GenerateResult = { text: string; stopped: boolean };

export interface Engine {
  readonly modelId: string;
  readonly kind: 'system' | 'gguf';
  /** Total context window in tokens (prompt + answer). */
  readonly contextTokens: number;
  load(onProgress?: (p: number) => void): Promise<void>;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  stop(): Promise<void>;
  release(): Promise<void>;
}

export class EngineUnavailableError extends Error {
  constructor(public reason: 'noModel' | 'notInstalled' | 'systemUnavailable') {
    super(reason);
  }
}

// ---------------------------------------------------------------------------
// System model

let requestCounter = 0;

class SystemEngine implements Engine {
  readonly modelId = SYSTEM_MODEL_ID;
  readonly kind = 'system' as const;
  // Apple FM and Gemini Nano both have ~4k-token windows.
  readonly contextTokens = 4000;
  private current: string | null = null;

  async load() {
    const info = await SystemLLM.getSystemModelStatus();
    if (info.status !== 'available') throw new EngineUnavailableError('systemUnavailable');
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const id = `req-${Date.now()}-${++requestCounter}`;
    this.current = id;
    // The system APIs take one prompt: flatten prior turns as a transcript.
    const history = req.messages.slice(0, -1);
    const last = req.messages[req.messages.length - 1]?.content ?? '';
    const prompt = history.length
      ? `${history.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n\n')}\n\nUser: ${last}`
      : last;
    let text = '';
    let stopped = false;
    try {
      const full = await SystemLLM.generate(id, { prompt, system: req.system, temperature: req.temperature, maxTokens: req.maxTokens }, (delta, reset) => {
        text = reset ? delta : text + delta;
        req.onText(text);
      });
      text = full || text;
    } finally {
      stopped = this.current !== id;
      if (this.current === id) this.current = null;
    }
    return { text, stopped };
  }

  async stop() {
    if (this.current) SystemLLM.cancel(this.current);
    this.current = null;
  }

  async release() {
    await this.stop();
  }
}

// ---------------------------------------------------------------------------
// GGUF via llama.rn

class LlamaEngine implements Engine {
  readonly kind = 'gguf' as const;
  readonly contextTokens: number;
  private ctx: LlamaContext | null = null;
  private loading: Promise<void> | null = null;
  private stopRequested = false;

  constructor(
    readonly modelId: string,
    private readonly path: string,
    contextTokens: number,
  ) {
    this.contextTokens = contextTokens;
  }

  load(onProgress?: (p: number) => void): Promise<void> {
    if (this.ctx) return Promise.resolve();
    if (!this.loading) {
      this.loading = initLlama(
        {
          model: this.path,
          n_ctx: this.contextTokens,
          n_batch: 512,
          // Metal on real iOS devices; the simulator runs llama.cpp on the CPU.
          n_gpu_layers: Platform.OS === 'ios' && Device.isDevice ? 99 : 0,
          use_mlock: false,
          use_mmap: true,
        },
        (p) => onProgress?.(p / 100),
      )
        .then((ctx) => {
          this.ctx = ctx;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    await this.load();
    const ctx = this.ctx!;
    this.stopRequested = false;
    let raw = '';
    let text = '';
    const result = await ctx.completion(
      {
        messages: [{ role: 'system', content: req.system }, ...req.messages],
        jinja: true,
        enable_thinking: false,
        reasoning_format: 'auto',
        n_predict: req.maxTokens ?? 768,
        temperature: req.temperature ?? 0.6,
        top_p: 0.9,
        top_k: 40,
        min_p: 0.05,
        penalty_repeat: 1.05,
      },
      (data) => {
        // `content` is the parsed answer so far (reasoning separated); fall back
        // to accumulating raw tokens for templates without a parser.
        if (typeof data.content === 'string') {
          raw = data.content;
        } else {
          raw += data.token;
        }
        const next = stripThinking(raw);
        if (next !== text) {
          text = next;
          req.onText(text);
        }
      },
    );
    const final = stripThinking(result.content ?? result.text ?? raw).trim() || text;
    return { text: final, stopped: this.stopRequested || !!result.interrupted };
  }

  async stop() {
    this.stopRequested = true;
    await this.ctx?.stopCompletion().catch(() => {});
  }

  async release() {
    // Let an in-flight load finish so its context can be freed too.
    if (this.loading) await this.loading.catch(() => {});
    const ctx = this.ctx;
    this.ctx = null;
    await ctx?.stopCompletion().catch(() => {});
    await ctx?.release().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Engine manager: one engine alive at a time.

const IDLE_RELEASE_MS = 4 * 60 * 1000;

let active: Engine | null = null;
let busy = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleIdleRelease() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!busy) releaseEngine().catch(() => {});
  }, IDLE_RELEASE_MS);
}

function createEngine(modelId: string): Engine {
  if (modelId === SYSTEM_MODEL_ID) return new SystemEngine();
  const item = getItem(modelId);
  if (!item || item.kind !== 'model') throw new EngineUnavailableError('notInstalled');
  const def = getModel(item.catalogId ?? item.id);
  return new LlamaEngine(modelId, toNativePath(item.fileUri), def?.contextTokens ?? 4096);
}

/** Returns the (lazily created) engine for a model id, releasing any other one. */
export async function getEngine(modelId: string | null): Promise<Engine> {
  if (!modelId) throw new EngineUnavailableError('noModel');
  if (active?.modelId === modelId) return active;
  await releaseEngine();
  active = createEngine(modelId);
  return active;
}

/** Wraps a generation so idle/background release never frees a busy context. */
export async function withEngine<T>(modelId: string | null, fn: (engine: Engine) => Promise<T>): Promise<T> {
  busy++;
  try {
    const engine = await getEngine(modelId);
    return await fn(engine);
  } finally {
    busy--;
    scheduleIdleRelease();
  }
}

export async function stopGeneration() {
  await active?.stop();
}

export async function releaseEngine() {
  const e = active;
  active = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  await e?.release();
}

/** Release the model a removed item was backing. */
export async function releaseIfModel(modelId: string) {
  if (active?.modelId === modelId) await releaseEngine();
}

export function isEngineLoaded(modelId: string): boolean {
  return active?.modelId === modelId;
}

let appStateHooked = false;

/** Free model memory when the app leaves the foreground (iOS kills big background apps). */
export function installEngineLifecycle() {
  if (appStateHooked) return;
  appStateHooked = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      const e = active;
      if (!e) return;
      // Stop any running answer first; the chat keeps the partial text.
      e.stop()
        .catch(() => {})
        .finally(() => releaseEngine().catch(() => {}));
    }
  });
}
