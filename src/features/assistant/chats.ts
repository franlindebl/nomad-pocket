// Assistant conversations: persistence (chat_sessions / chat_messages) and the
// in-memory chat state, including the streaming answer and the send/stop flow.
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { db, parseJson } from '@/db';
import i18n from '@/i18n';
import { uid } from '@/lib/format';
import { useSettings } from '@/stores/settings';

import { EngineUnavailableError, stopGeneration, withEngine } from './engine';
import { retrieve } from './rag';
import { citedNumbers, detectLanguage, estimateTokens, systemPrompt, tokensToChars, trimHistory, type Lang, type Turn } from './rag-core';

export type MessageSource = { n: number; itemId: string; path: string; title: string };

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  sources: MessageSource[];
  createdAt: number;
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

export type Phase = 'searching' | 'loading' | 'generating';

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
    .map((r) => ({ id: r.id, title: r.title, modelId: r.model_id, createdAt: r.created_at, updatedAt: r.updated_at, preview: r.preview?.slice(0, 140) ?? undefined }));
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
  if (st.streaming?.sessionId === id) stopGeneration().catch(() => {});
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
      storage: createJSONStorage(() => Storage),
      partialize: ({ useLibrary }) => ({ useLibrary }),
    },
  ),
);

export function refreshSessions() {
  useChat.setState({ sessions: listSessions() });
}

export function openSession(id: string | null) {
  const st = useChat.getState();
  if (st.streaming && st.streaming.sessionId !== id) stopGeneration().catch(() => {});
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

function languageFor(question: string): Lang {
  const ui = (i18n.language === 'es' ? 'es' : 'en') as Lang;
  return detectLanguage(question, ui);
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
  const history: Turn[] = (sessionId === st.activeSessionId ? st.messages : []).map((m) => ({ role: m.role, content: m.content }));
  const userMsg: ChatMessage = { id: uid(), sessionId, role: 'user', content: text, sources: [], createdAt: Date.now() };
  insertMessage(userMsg);

  const streaming: Streaming = { sessionId, messageId: uid(), text: '', phase: st.useLibrary ? 'searching' : 'loading', loadProgress: 0, sources: [] };
  useChat.setState({
    activeSessionId: sessionId,
    messages: [...(sessionId === st.activeSessionId ? st.messages : []), userMsg],
    streaming,
    error: null,
    sessions: listSessions(),
  });

  const lang = languageFor(text);
  let answer = '';
  let sources: MessageSource[] = [];
  let failed: string | null = null;

  try {
    await withEngine(modelId, async (engine) => {
      // Token budget: system + history + sources + answer must fit the window.
      const answerTokens = engine.kind === 'system' ? SYSTEM_ANSWER_TOKENS : MAX_ANSWER_TOKENS;
      const sys = systemPrompt(lang, st.useLibrary);
      const free = engine.contextTokens - answerTokens - estimateTokens(sys) - estimateTokens(text) - 120;
      const historyBudget = tokensToChars(Math.max(0, Math.floor(free * 0.25)));
      const turns = trimHistory(history, historyBudget);
      const contextBudget = Math.max(800, tokensToChars(free) - turns.reduce((s, t) => s + t.content.length + 16, 0));

      let userTurn = text;
      if (st.useLibrary) {
        const r = await retrieve(text, lang, contextBudget);
        sources = r.sources.map(({ n, itemId, path, title }) => ({ n, itemId, path, title }));
        userTurn = r.noLibrary ? text : r.userMessage;
        patchStreaming({ sources, phase: 'loading' });
      }

      await engine.load((p) => patchStreaming({ loadProgress: p }));
      patchStreaming({ phase: 'generating' });

      let last = 0;
      const res = await engine.generate({
        system: systemFor(sys, st.useLibrary && !!sources.length),
        messages: [...turns, { role: 'user', content: userTurn }],
        maxTokens: answerTokens,
        temperature: 0.5,
        onText: (t) => {
          answer = t;
          const now = Date.now();
          if (now - last >= UI_THROTTLE_MS) {
            last = now;
            patchStreaming({ text: t });
          }
        },
      });
      answer = res.text || answer;
    });
  } catch (e) {
    if (e instanceof EngineUnavailableError) failed = e.reason;
    else failed = String((e as Error)?.message ?? e);
  }

  const cur = useChat.getState();
  const finalText = answer.trim();
  if (finalText) {
    const msg: ChatMessage = {
      id: streaming.messageId,
      sessionId,
      role: 'assistant',
      content: finalText,
      sources: citedSources(finalText, sources),
      createdAt: Date.now(),
    };
    insertMessage(msg);
    useChat.setState({
      streaming: null,
      messages: cur.activeSessionId === sessionId ? [...cur.messages, msg] : cur.messages,
      error: failed,
      sessions: listSessions(),
    });
  } else {
    useChat.setState({ streaming: null, error: failed, sessions: listSessions() });
  }
}

/** Without sources the RAG rules (cite [n]) would only confuse the model. */
function systemFor(sys: string, hasSources: boolean): string {
  return hasSources ? sys : sys.split('\n\n')[0];
}

export async function stopAnswer() {
  await stopGeneration();
}

export function dismissError() {
  useChat.setState({ error: null });
}
