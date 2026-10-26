// Assistant conversations: persistence (chat_sessions / chat_messages) and the
// in-memory chat state, including the streaming answer and the send/stop flow.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { db, parseJson } from '@/db';
import i18n from '@/i18n';
import { uid } from '@/lib/format';
import { kvStorage } from '@/lib/kv';
import { useSettings } from '@/stores/settings';

import { EngineUnavailableError, stopGeneration, withEngine, type SearchTool } from './engine';
import { errorFor } from './errors';
import { libraryItemIds, retrieve } from './rag';
import {
  buildRouterPrompt,
  buildToolResult,
  citedNumbers,
  detectLanguage,
  estimateTokens,
  guessIntent,
  isHealthQuestion,
  ragMessageFrame,
  ROUTER_INSTRUCTIONS,
  searchToolSpec,
  systemPrompt,
  tokensToChars,
  trimHistory,
  type Lang,
  type Turn,
} from './rag-core';

export type MessageSource = { n: number; itemId: string; path: string; title: string };

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  sources: MessageSource[];
  createdAt: number;
  /**
   * Whether the library was searched for this answer. Only known for answers given in
   * this session (not stored): an answer without it gets a "Search my library" button.
   */
  searched?: boolean;
};

export type ChatSession = {
  id: string;
  title: string;
  modelId: string | null;
  createdAt: number;
  updatedAt: number;
  /** First characters of the last message, for the list. */
  preview?: string;
};

export type Phase = 'loading' | 'thinking' | 'searching' | 'generating';

export type Streaming = {
  sessionId: string;
  /** Id the assistant message will be stored with. */
  messageId: string;
  text: string;
  phase: Phase;
  loadProgress: number;
  sources: MessageSource[];
};

// ---------------------------------------------------------------------------
// Persistence

type SessionRow = { id: string; title: string; model_id: string | null; created_at: number; updated_at: number; preview: string | null };
type MessageRow = { id: string; session_id: string; role: 'user' | 'assistant'; content: string; sources: string | null; created_at: number };

export function listSessions(): ChatSession[] {
  return db()
    .getAllSync<SessionRow>(
      `SELECT s.*, (SELECT content FROM chat_messages m WHERE m.session_id = s.id ORDER BY created_at DESC LIMIT 1) AS preview
       FROM chat_sessions s ORDER BY updated_at DESC`,
    )
    .map((r) => ({ id: r.id, title: r.title, modelId: r.model_id, createdAt: r.created_at, updatedAt: r.updated_at, preview: r.preview ? plainPreview(r.preview) : undefined }));
}

/** First line-ish of a message without Markdown markers, for the conversation list. */
function plainPreview(text: string): string {
  return text
    .replace(/^\s*(#{1,6}|[-*•+]|\d+[.)]|>)\s+/gm, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

export function loadMessages(sessionId: string): ChatMessage[] {
  return db()
    .getAllSync<MessageRow>('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at', sessionId)
    .map((r) => ({ id: r.id, sessionId: r.session_id, role: r.role, content: r.content, sources: parseJson<MessageSource[]>(r.sources, []), createdAt: r.created_at }));
}

function insertMessage(m: ChatMessage) {
  db().runSync(
    'INSERT OR REPLACE INTO chat_messages (id, session_id, role, content, sources, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    m.id,
    m.sessionId,
    m.role,
    m.content,
    m.sources.length ? JSON.stringify(m.sources) : null,
    m.createdAt,
  );
  db().runSync('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', m.createdAt, m.sessionId);
}

function createSession(title: string, modelId: string | null): ChatSession {
  const now = Date.now();
  const s: ChatSession = { id: uid(), title, modelId, createdAt: now, updatedAt: now };
  db().runSync('INSERT INTO chat_sessions (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', s.id, s.title, s.modelId, now, now);
  return s;
}

export function deleteSession(id: string) {
  const d = db();
  d.runSync('DELETE FROM chat_messages WHERE session_id = ?', id);
  d.runSync('DELETE FROM chat_sessions WHERE id = ?', id);
  const st = useChat.getState();
  if (st.streaming?.sessionId === id) stopAnswer().catch(() => {});
  useChat.setState({
    sessions: listSessions(),
    ...(st.activeSessionId === id ? { activeSessionId: null, messages: [], error: null } : {}),
  });
}

function titleFrom(question: string): string {
  const t = question.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t;
}

// ---------------------------------------------------------------------------
// State

type ChatState = {
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  streaming: Streaming | null;
  error: string | null;
  /** Ground answers in the offline library (RAG). Persisted. */
  useLibrary: boolean;
  setUseLibrary: (v: boolean) => void;
};

export const useChat = create<ChatState>()(
  persist(
    (set) => ({
      sessions: [],
      activeSessionId: null,
      messages: [],
      streaming: null,
      error: null,
      useLibrary: true,
      setUseLibrary: (useLibrary) => set({ useLibrary }),
    }),
    {
      name: 'assistant',
      storage: kvStorage(),
      partialize: ({ useLibrary }) => ({ useLibrary }),
    },
  ),
);

export function refreshSessions() {
  useChat.setState({ sessions: listSessions() });
}

export function openSession(id: string | null) {
  const st = useChat.getState();
  // The answer being written belongs to the conversation we leave: it ends there.
  if (st.streaming && st.streaming.sessionId !== id) stopAnswer().catch(() => {});
  useChat.setState({ activeSessionId: id, messages: id ? loadMessages(id) : [], error: null });
}

export function newChat() {
  openSession(null);
}

// ---------------------------------------------------------------------------
// Send / stop

const MAX_ANSWER_TOKENS = 768;
const SYSTEM_ANSWER_TOKENS = 600;
const UI_THROTTLE_MS = 60;
// What declaring search_library costs in the prompt: the JSON schema plus the
// template's own tool instructions (~250 tokens in Qwen's).
const TOOL_PROMPT_TOKENS = 380;

/** Language of the message; short ones ("ok", "gracias") follow the conversation. */
function languageFor(question: string, history: Turn[]): Lang {
  const ui = (i18n.language === 'es' ? 'es' : 'en') as Lang;
  const earlier = history
    .filter((t) => t.role === 'user')
    .map((t) => t.content)
    .join(' ');
  return detectLanguage(question, earlier ? detectLanguage(earlier, ui) : ui);
}

function patchStreaming(patch: Partial<Streaming>) {
  const s = useChat.getState().streaming;
  if (s) useChat.setState({ streaming: { ...s, ...patch } });
}

/** Keeps only sources the answer cites (all of them if it cited none). */
function citedSources(answer: string, sources: MessageSource[]): MessageSource[] {
  const cited = new Set(citedNumbers(answer));
  const used = sources.filter((s) => cited.has(s.n));
  return used.length ? used : sources;
}

export async function sendMessage(question: string) {
  const text = question.trim();
  const st = useChat.getState();
  if (!text || st.streaming) return;
  const modelId = useSettings.getState().aiModelId;

  let sessionId = st.activeSessionId;
  if (!sessionId) {
    sessionId = createSession(titleFrom(text), modelId).id;
  }
  const earlier = sessionId === st.activeSessionId ? st.messages : [];
  const userMsg: ChatMessage = { id: uid(), sessionId, role: 'user', content: text, sources: [], createdAt: Date.now() };
  insertMessage(userMsg);
  useChat.setState({ activeSessionId: sessionId, messages: [...earlier, userMsg], error: null, sessions: listSessions() });
  await answer(sessionId, text, toTurns(earlier), false);
}

/**
 * Answers the question behind `messageId` (an answer given without the library) again,
 * this time searching the library: the "Search my library" button under it.
 */
export async function searchLibraryFor(messageId: string) {
  const st = useChat.getState();
  if (st.streaming || !st.activeSessionId) return;
  const i = st.messages.findIndex((m) => m.id === messageId);
  const question = st.messages[i - 1];
  if (i < 1 || st.messages[i].role !== 'assistant' || question?.role !== 'user') return;
  // Hidden while the new answer is written; only deleted once that one is stored.
  useChat.setState({ messages: st.messages.slice(0, i), error: null });
  await answer(st.activeSessionId, question.content, toTurns(st.messages.slice(0, i - 1)), true, st.messages[i]);
}

function toTurns(messages: ChatMessage[]): Turn[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Generates the assistant's reply to `text`. Whether the library is searched:
 * library off or small talk → no; `forceSearch` → yes; otherwise the model decides
 * when it can (tool call or router), and a question is searched when it can't.
 * `replaces` is an earlier answer to the same question: deleted once this one is
 * stored, shown again if this one ends up empty (stopped early, or failed).
 */
async function answer(sessionId: string, text: string, history: Turn[], forceSearch: boolean, replaces?: ChatMessage) {
  const st = useChat.getState();
  const modelId = useSettings.getState().aiModelId;
  const library = st.useLibrary && libraryItemIds().length > 0;
  const streaming: Streaming = { sessionId, messageId: uid(), text: '', phase: 'loading', loadProgress: 0, sources: [] };
  useChat.setState({ streaming });

  const lang = languageFor(text, history);
  const health = isHealthQuestion(text);
  let answerText = '';
  let sources: MessageSource[] = [];
  let searched = false;
  let stopped = false;
  let failed: string | null = null;
  const cancelled = () => cancelledAnswers.has(streaming.messageId);

  try {
    await withEngine(modelId, async (engine) => {
      await engine.load((p) => patchStreaming({ loadProgress: p }));
      if (cancelled()) return;

      // Decide whether to search.
      let mode: 'chat' | 'search' | 'tools' = 'chat';
      let query: string | undefined;
      if (library) {
        if (forceSearch) mode = 'search';
        else if (guessIntent(text, history) === 'chat') mode = 'chat';
        else if (engine.decides === 'tools') mode = 'tools';
        else if (engine.decides === 'router' && engine.route) {
          patchStreaming({ phase: 'thinking' });
          try {
            const d = await engine.route(ROUTER_INSTRUCTIONS, buildRouterPrompt(text, history));
            mode = d.search ? 'search' : 'chat';
            query = d.query.trim() || undefined;
          } catch (e) {
            console.warn('[assistant] router failed, searching', e);
            mode = 'search';
          }
          if (cancelled()) return;
        } else mode = 'search';
      }

      // Token budget: system + history + sources + answer must fit the window.
      const answerTokens = engine.kind === 'system' ? SYSTEM_ANSWER_TOKENS : MAX_ANSWER_TOKENS;
      let sys = systemPrompt(lang, mode === 'tools' ? 'tools' : mode === 'search' ? 'sources' : 'chat', { health, library });
      const toolTokens = mode === 'tools' ? TOOL_PROMPT_TOKENS : 0;
      // With sources in the user turn the question goes in twice (once if long), with labels.
      const questionTokens = estimateTokens(mode === 'search' ? ragMessageFrame(text, lang) : text);
      const free = engine.contextTokens - answerTokens - estimateTokens(sys) - questionTokens - toolTokens - 120;
      const historyBudget = tokensToChars(Math.max(0, Math.floor(free * 0.25)));
      const turns = trimHistory(history, historyBudget);
      // Sources get what's left: none when a very long question fills the window.
      const contextBudget = Math.max(0, tokensToChars(free) - turns.reduce((s, t) => s + t.content.length + 16, 0));
      const keep = (r: { sources: { n: number; itemId: string; path: string; title: string }[] }) => {
        sources = r.sources.map(({ n, itemId, path, title }) => ({ n, itemId, path, title }));
        searched = true;
        patchStreaming({ sources });
      };

      let userTurn = text;
      if (mode === 'search') {
        patchStreaming({ phase: 'searching' });
        const r = await retrieve(text, lang, contextBudget, { history, query });
        keep(r);
        userTurn = r.noLibrary ? text : r.userMessage;
        // Without sources the citation rules would only confuse the model.
        if (!sources.length) sys = systemPrompt(lang, 'chat', { health, library });
      }
      if (cancelled()) return;

      const tool: SearchTool | undefined =
        mode === 'tools'
          ? {
              spec: searchToolSpec(lang),
              run: async (q) => {
                patchStreaming({ phase: 'searching', text: '' });
                const r = await retrieve(text, lang, contextBudget, { history, query: q || undefined });
                keep(r);
                patchStreaming({ phase: 'generating' });
                return buildToolResult(r.sources, lang);
              },
            }
          : undefined;
      patchStreaming({ phase: mode === 'tools' ? 'thinking' : 'generating' });

      let last = 0;
      const res = await engine.generate({
        system: sys,
        messages: [...turns, { role: 'user', content: userTurn }],
        maxTokens: answerTokens,
        temperature: 0.5,
        tool,
        onText: (t) => {
          answerText = t;
          const now = Date.now();
          // An empty text resets the bubble (a tool call replaced a preamble): never throttle it.
          if (!t || now - last >= UI_THROTTLE_MS) {
            last = now;
            patchStreaming({ text: t });
          }
        },
      });
      answerText = res.text || answerText;
      stopped = res.stopped;
    });
  } catch (e) {
    failed = e instanceof EngineUnavailableError ? e.reason : errorFor(e);
  }

  const wasCancelled = cancelled();
  cancelledAnswers.delete(streaming.messageId);
  const cur = useChat.getState();
  const finalText = answerText.trim();
  // A stopped answer reports nothing (the user may be in another conversation by now);
  // one that came out empty (only reasoning, a call to an unknown tool) must not vanish silently.
  if (wasCancelled) failed = null;
  else if (!finalText && !failed && !stopped) failed = 'empty';
  // The conversation may have been deleted while answering.
  const sessionAlive = !!db().getFirstSync('SELECT 1 FROM chat_sessions WHERE id = ?', sessionId);
  if (finalText && sessionAlive) {
    const msg: ChatMessage = {
      id: streaming.messageId,
      sessionId,
      role: 'assistant',
      content: finalText,
      sources: citedSources(finalText, sources),
      createdAt: Date.now(),
      searched,
    };
    insertMessage(msg);
    if (replaces) db().runSync('DELETE FROM chat_messages WHERE id = ?', replaces.id);
    useChat.setState({
      streaming: null,
      // The conversation may have been reopened meanwhile, reloading the old answer.
      messages: cur.activeSessionId === sessionId ? [...cur.messages.filter((m) => m.id !== replaces?.id), msg] : cur.messages,
      error: failed,
      sessions: listSessions(),
    });
  } else {
    const restore = replaces && sessionAlive && cur.activeSessionId === sessionId && !cur.messages.some((m) => m.id === replaces.id);
    useChat.setState({
      streaming: null,
      ...(restore ? { messages: [...cur.messages, replaces] } : {}),
      error: failed,
      sessions: listSessions(),
    });
  }
}

/** Answers stopped before generation started (ids of their streaming messages). */
const cancelledAnswers = new Set<string>();

/**
 * Marks the answer in progress as stopped. While it loads, routes or searches the engine
 * has nothing to stop yet: `answer()` checks this between steps. Text already written
 * is kept.
 */
export function cancelAnswer() {
  const id = useChat.getState().streaming?.messageId;
  if (id) cancelledAnswers.add(id);
}

export async function stopAnswer() {
  cancelAnswer();
  await stopGeneration();
}

export function dismissError() {
  useChat.setState({ error: null });
}
