// One interface over the two local inference backends:
//  - the OS model (Apple Foundation Models, iOS only) via modules/nomad-llm
//  - downloaded GGUF models via llama.rn (llama.cpp, chat template from the GGUF)
// Engines load lazily, stream text, can be stopped, and are released when the
// app goes to the background or after a few idle minutes (GGUF contexts hold
// hundreds of MB to several GB of RAM).
import * as Device from 'expo-device';
import { File } from 'expo-file-system';
import { initLlama, type LlamaContext } from 'llama.rn';
import { AppState, Platform } from 'react-native';

import { getItem, type InstalledItem } from '@/features/content/items';
import { contentFile, toNativePath } from '@/lib/storage';

import * as SystemLLM from '../../../modules/nomad-llm';
import { getModel, SYSTEM_MODEL_ID } from './models';
import { parseToolQuery, SEARCH_TOOL_NAME, stripThinking, type Turn } from './rag-core';

/** The library search offered to a model that calls tools. */
export type SearchTool = {
  /** OpenAI-style function definition (`searchToolSpec`). */
  spec: object;
  /**
   * Runs the search and returns the text handed back to the model, or `{ final }`: the answer
   * itself, without a second pass (nothing found: the model would answer from memory).
   */
  run: (query: string) => Promise<string | { final: string }>;
};

export type GenerateRequest = {
  system: string;
  /** Conversation, oldest first; the last turn is the user's question. */
  messages: Turn[];
  temperature?: number;
  maxTokens?: number;
  /** Lets the model search the library itself (engines with `decides === 'tools'`). */
  tool?: SearchTool;
  /** Called with the whole answer so far (already cleaned) on every update. */
  onText: (text: string) => void;
};

export type GenerateResult = {
  text: string;
  stopped: boolean;
  /** The query of the library search the model made, if it made one. */
  toolQuery?: string;
};

export type RouteDecision = { search: boolean; query: string };

export interface Engine {
  readonly modelId: string;
  readonly kind: 'system' | 'gguf';
  /** Total context window in tokens (prompt + answer). */
  readonly contextTokens: number;
  /**
   * How the model decides whether to search the library (known after `load`):
   * `tools` calls search_library while answering, `router` answers a short structured
   * "search or not" question first (`route`), null can't decide (heuristics instead).
   */
  readonly decides: 'tools' | 'router' | null;
  load(onProgress?: (p: number) => void): Promise<void>;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  route?(instructions: string, prompt: string): Promise<RouteDecision>;
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
  // Apple FM has a ~4k-token window.
  readonly contextTokens = 4000;
  decides: 'router' | null = null;
  private current: string | null = null;

  async load() {
    const info = await SystemLLM.getSystemModelStatus();
    if (info.status !== 'available') throw new EngineUnavailableError('systemUnavailable');
    // Apple FM decides itself, with guided generation, whether a message needs a library search.
    this.decides = info.provider === 'apple' ? 'router' : null;
  }

  async route(instructions: string, prompt: string): Promise<RouteDecision> {
    return SystemLLM.route(prompt, instructions);
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
        try {
          text = reset ? delta : text + delta;
          req.onText(text);
        } catch (e) {
          console.warn('[assistant] delta callback failed', e);
        }
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

/** Runs a native call that may return a promise, a value or throw; never rejects. */
async function quietly(fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch {
    // ignore
  }
}

type LlamaMessage = Record<string, unknown> & { role: string; content: string };
type LlamaToolCall = { id?: string; type: 'function'; function: { name: string; arguments: string } };

// Reasoning allowed before a tool decision. Qwen3.5 only calls tools with thinking on
// (with it off it answers everything from memory); it then mostly closes the think
// block at once, the 0.8B model reasons ~80 tokens. The budget caps the odd ramble.
const DECISION_THINKING_TOKENS = 256;

type ToolStyle = 'thinking' | 'direct' | null;

class LlamaEngine implements Engine {
  readonly kind = 'gguf' as const;
  readonly contextTokens: number;
  readonly decides: 'tools' | null;
  private readonly toolThinking: boolean;
  private ctx: LlamaContext | null = null;
  private loading: Promise<void> | null = null;
  private stopRequested = false;
  // Set by release(), after which the manager no longer tracks this engine: loading
  // again would leave a context nobody frees (hundreds of MB to GBs until the app dies).
  private released = false;

  constructor(
    readonly modelId: string,
    private readonly path: string,
    contextTokens: number,
    tools: ToolStyle,
  ) {
    this.contextTokens = contextTokens;
    this.decides = tools ? 'tools' : null;
    this.toolThinking = tools === 'thinking';
  }

  load(onProgress?: (p: number) => void): Promise<void> {
    if (this.ctx || this.released) return Promise.resolve();
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
        (p) => {
          try {
            onProgress?.(Number(p) / 100);
          } catch {
            // never throw from a native callback
          }
        },
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
    this.stopRequested = false;
    await this.load();
    // Released (app in the background, model switched or deleted) or stopped while loading.
    if (this.released || !this.ctx || this.stopRequested) return { text: '', stopped: true };
    const messages: LlamaMessage[] = [{ role: 'system', content: req.system }, ...req.messages];
    const tool = this.decides === 'tools' ? req.tool : undefined;
    if (!tool) return this.complete(req, messages, {});

    // Pass 1: the model answers directly or calls search_library.
    const first = await this.complete(req, messages, {
      tools: [tool.spec],
      tool_choice: 'auto',
      ...(this.toolThinking ? { enable_thinking: true, thinking_budget_tokens: DECISION_THINKING_TOKENS } : {}),
    });
    // search_library is the only tool offered: a small model that misspells its name
    // still meant it (and streaming stops at the call, so there is no text to fall back on).
    const call = first.toolCalls?.find((c) => c.function?.name === SEARCH_TOOL_NAME) ?? first.toolCalls?.[0];
    if (!call || first.stopped) return { text: first.text, stopped: first.stopped };

    // Pass 2: answer from the search results. Tools stay declared so the chat template
    // renders the call the same way; tool_choice "none" keeps the model from searching again.
    req.onText('');
    const query = parseToolQuery(call.function?.arguments);
    const result = await tool.run(query);
    if (this.stopRequested) return { text: '', stopped: true, toolQuery: query };
    if (typeof result !== 'string') {
      req.onText(result.final);
      return { text: result.final, stopped: false, toolQuery: query };
    }
    const id = call.id || 'call_0';
    const fn = call.function?.name === SEARCH_TOOL_NAME ? call.function : { name: SEARCH_TOOL_NAME, arguments: JSON.stringify({ query }) };
    const second = await this.complete(
      req,
      [
        ...messages,
        { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: fn }] },
        { role: 'tool', tool_call_id: id, name: SEARCH_TOOL_NAME, content: result },
      ],
      { tools: [tool.spec], tool_choice: 'none' },
    );
    return { text: second.text, stopped: second.stopped, toolQuery: query };
  }

  /** One streamed completion; text updates go to `req.onText` until a tool call shows up. */
  private async complete(
    req: GenerateRequest,
    messages: LlamaMessage[],
    extra: { tools?: object[]; tool_choice?: string; enable_thinking?: boolean; thinking_budget_tokens?: number },
  ): Promise<{ text: string; stopped: boolean; toolCalls?: LlamaToolCall[] }> {
    const ctx = this.ctx;
    // Released between two passes (while the tool searched the library).
    if (!ctx || this.released) return { text: '', stopped: true };
    let raw = '';
    let text = '';
    let calling = false;
    const result = await ctx.completion(
      {
        // llama.rn's message type omits tool_calls / tool_call_id; the native side reads them.
        messages: messages as { role: string; content: string }[],
        jinja: true,
        enable_thinking: false,
        reasoning_format: 'auto',
        n_predict: req.maxTokens ?? 768,
        temperature: req.temperature ?? 0.6,
        top_p: 0.9,
        top_k: 40,
        min_p: 0.05,
        penalty_repeat: 1.05,
        ...extra,
      },
      (data) => {
        // Runs inside a native callback: an exception here would crash Release builds.
        try {
          if (calling || data.tool_calls?.length) {
            calling = true;
            return;
          }
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
        } catch (e) {
          console.warn('[assistant] token callback failed', e);
        }
      },
    );
    const final = stripThinking(result.content ?? result.text ?? raw).trim() || text;
    const toolCalls = (result.tool_calls ?? []) as LlamaToolCall[];
    return { text: final, stopped: this.stopRequested || !!result.interrupted, toolCalls: toolCalls.length ? toolCalls : undefined };
  }

  async stop() {
    this.stopRequested = true;
    const ctx = this.ctx;
    if (ctx) await quietly(() => ctx.stopCompletion());
  }

  async release() {
    this.released = true;
    this.stopRequested = true;
    // Let an in-flight load finish so its context can be freed too.
    if (this.loading) await this.loading.catch(() => {});
    const ctx = this.ctx;
    this.ctx = null;
    if (!ctx) return;
    await quietly(() => ctx.stopCompletion());
    await quietly(() => ctx.release());
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

/**
 * The stored URI is absolute, but the app container path changes on reinstall
 * and app updates: fall back to the same filename inside content/models.
 */
function modelPath(item: InstalledItem, filename: string | undefined): string {
  try {
    if (new File(item.fileUri).exists) return toNativePath(item.fileUri);
    const name = filename ?? decodeURIComponent(item.fileUri.split('/').pop() ?? '');
    const moved = contentFile('model', name);
    if (moved.exists) return toNativePath(moved.uri);
  } catch {
    // fall through
  }
  throw new EngineUnavailableError('notInstalled');
}

function createEngine(modelId: string): Engine {
  if (modelId === SYSTEM_MODEL_ID) return new SystemEngine();
  const item = getItem(modelId);
  if (!item || item.kind !== 'model') throw new EngineUnavailableError('notInstalled');
  const def = getModel(item.catalogId ?? item.id);
  return new LlamaEngine(modelId, modelPath(item, def?.filename), def?.contextTokens ?? 4096, def?.tools ?? null);
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

let appStateHooked = false;

/**
 * Free model memory when the app leaves the foreground (iOS kills big background apps).
 * `onBackground` ends the answer in progress: while it loads or searches there is no
 * completion to stop, and it must not carry on with a released engine.
 */
export function installEngineLifecycle(onBackground?: () => void) {
  if (appStateHooked) return;
  appStateHooked = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      try {
        onBackground?.();
      } catch (e) {
        console.warn('[assistant] background handler failed', e);
      }
      const e = active;
      if (!e) return;
      // Stop any running answer first; the chat keeps the partial text.
      e.stop()
        .catch(() => {})
        .finally(() => releaseEngine().catch(() => {}));
    }
  });
}
