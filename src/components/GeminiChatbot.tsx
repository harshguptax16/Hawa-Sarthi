import React, { useEffect, useRef, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase.ts';
import { useFirebaseAuth } from '../contexts/FirebaseContext.tsx';
import type {
  AqiBriefing,
  ChatbotRoleId,
  ChatMessage,
  HouseholdProfile,
} from '../types.ts';

interface GeminiChatbotProps {
  city: string;
  briefing: AqiBriefing | null;
  profile: HouseholdProfile;
  userProfileReady: boolean;
}

const CHATBOT_ROLES: Array<{
  id: ChatbotRoleId;
  label: string;
  model: string;
  focus: string;
}> = [
  {
    id: 'fastTriage',
    label: 'Fast Smog Triage',
    model: 'gemini-3.1-flash-lite',
    focus: 'Rapid 30-second mask, timing & exposure triage',
  },
  {
    id: 'familyGuide',
    label: 'Family Guide',
    model: 'gemini-4-hydrogen',
    focus: 'Balanced daily routines & indoor hacks for kids/elders',
  },
  {
    id: 'complexStrategist',
    label: 'Exposure Strategist',
    model: 'gemini-4-neon',
    focus: 'Multi-step CADR, commute & emission trade-off planning',
  },
  {
    id: 'deepAnalyst',
    label: 'Atmospheric Analyst',
    model: 'gemini-4-carbon',
    focus: 'Deep boundary-layer inversion & filtration reasoning',
  },
];

export const GeminiChatbot: React.FC<GeminiChatbotProps> = ({
  city,
  briefing,
  profile,
  userProfileReady,
}) => {
  const { user } = useFirebaseAuth();
  const canPersist = Boolean(user && user.emailVerified && userProfileReady);

  const [roleId, setRoleId] = useState<ChatbotRoleId>('familyGuide');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const activeRole = CHATBOT_ROLES.find((r) => r.id === roleId) ?? CHATBOT_ROLES[1];

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Sync multi-turn chat history with Firestore when user is verified & profile exists
  useEffect(() => {
    if (!canPersist || !user) return;
    const path = `users/${user.uid}/chatMessages`;
    const q = query(collection(db, path), orderBy('createdAt', 'asc'));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const loaded: ChatMessage[] = snap.docs.map((d) => {
          const data = d.data() as {
            role?: 'user' | 'assistant';
            personaRole?: string;
            model?: string;
            text?: string;
            createdAt?: Timestamp | null;
          };
          const ts = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
          return {
            id: d.id,
            role: data.role === 'assistant' ? 'assistant' : 'user',
            personaRole: data.personaRole,
            model: data.model,
            text: data.text ?? '',
            timestamp: ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          };
        });
        setMessages(loaded);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          setChatError(
            wrapped instanceof Error ? wrapped.message : 'Unable to sync chat history.'
          );
        }
      }
    );

    return () => unsub();
  }, [canPersist, user]);

  const persistMessage = async (msg: {
    id: string;
    role: 'user' | 'assistant';
    personaRole: string;
    model: string;
    text: string;
  }) => {
    if (!canPersist || !user) return;
    const cleanText = msg.text.trim().slice(0, 8000);
    if (!cleanText) return;
    const path = `users/${user.uid}/chatMessages/${msg.id}`;
    try {
      await setDoc(doc(db, 'users', user.uid, 'chatMessages', msg.id), {
        uid: user.uid,
        role: msg.role,
        personaRole: msg.personaRole.slice(0, 60),
        model: msg.model.slice(0, 60),
        text: cleanText,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleClearHistory = async () => {
    setChatError(null);
    if (!canPersist || !user) {
      setMessages([]);
      return;
    }
    try {
      await Promise.all(
        messages.map((m) => deleteDoc(doc(db, 'users', user.uid, 'chatMessages', m.id)))
      );
      setMessages([]);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/chatMessages`);
      } catch (wrapped) {
        setChatError(
          wrapped instanceof Error ? wrapped.message : 'Could not clear stored messages.'
        );
      }
    }
  };

  const sendMessage = async (questionText: string) => {
    const clean = questionText.trim();
    if (!clean || streaming) return;
    setChatError(null);

    const nowLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsgId = `u_${Date.now()}`;
    const assistantMsgId = `a_${Date.now() + 1}`;

    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      personaRole: activeRole.label,
      model: activeRole.model,
      text: clean,
      timestamp: nowLabel,
    };

    const placeholderAssistant: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      personaRole: activeRole.label,
      model: activeRole.model,
      text: '',
      timestamp: nowLabel,
    };

    const historySnapshot = messages.slice(-10).map((m) => ({
      role: m.role,
      text: m.text,
    }));

    setMessages((prev) => [...prev, userMsg, placeholderAssistant]);
    setInput('');
    setStreaming(true);

    try {
      if (canPersist) {
        void persistMessage({
          id: userMsgId,
          role: 'user',
          personaRole: activeRole.label,
          model: activeRole.model,
          text: clean,
        });
      }

      const res = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: clean,
          roleId,
          city,
          profile,
          briefingSummary: briefing
            ? `${briefing.severity} (AQI ${briefing.aqiEstimate ?? 'N/A'}, PM2.5 ${briefing.pm25Estimate ?? 'N/A'}). ${briefing.inversionContext}`
            : undefined,
          history: historySnapshot,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Chat request failed (${res.status}).`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Streaming response unavailable.');

      const decoder = new TextDecoder();
      let buffer = '';
      let finalReplyText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue;
          const payload = JSON.parse(chunk.slice(6));
          if (payload.type === 'chunk') {
            finalReplyText += payload.text;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, text: m.text + payload.text } : m
              )
            );
          } else if (payload.type === 'error') {
            throw new Error(payload.error || 'Chat stream interrupted.');
          }
        }
      }

      if (canPersist && finalReplyText.trim()) {
        await persistMessage({
          id: assistantMsgId,
          role: 'assistant',
          personaRole: activeRole.label,
          model: activeRole.model,
          text: finalReplyText,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reach Hawa Sarthi chat.';
      setChatError(msg);
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId || m.text.length > 0));
    } finally {
      setStreaming(false);
    }
  };

  return (
    <section className="flex flex-col rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 xl:col-span-7">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Hawa Sarthi Multi-Turn Advisor
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {activeRole.focus} · <span className="font-mono">{activeRole.model}</span>
            {canPersist ? ' · Synced to cloud' : ''}
          </p>
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => void handleClearHistory()}
            disabled={streaming}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* Role Selector */}
      <div className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {CHATBOT_ROLES.map((r) => {
          const active = r.id === roleId;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setRoleId(r.id)}
              disabled={streaming}
              className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                active
                  ? 'border-teal-600 bg-teal-50/70 text-teal-900 dark:border-teal-400 dark:bg-teal-950/40 dark:text-teal-200'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="truncate text-xs font-medium">{r.label}</div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500 dark:text-slate-400">
                {r.model}
              </div>
            </button>
          );
        })}
      </div>

      {/* Quick Starter Prompts */}
      <div className="my-3.5 flex flex-wrap gap-2">
        {[
          'Is it safe to open windows for 10 minutes today?',
          'Best N95 mask & commute swap for school drop-off?',
          'Compare HEPA purifier CADR vs DIY Corsi-Rosenthal box.',
        ].map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => void sendMessage(q)}
            disabled={streaming}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 transition-colors hover:border-teal-600 hover:text-slate-900 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-teal-400"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Multi-Turn Scrollable Conversation Thread */}
      <div className="min-h-[240px] max-h-[360px] flex-1 space-y-4 overflow-y-auto border-y border-slate-200 py-4 dark:border-slate-800">
        {messages.length === 0 && (
          <div className="flex h-full min-h-[190px] flex-col items-center justify-center text-center">
            <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
              Start a multi-turn conversation in {city}—switch roles anytime for fast triage, family routines, exposure trade-offs, or deep atmospheric math.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-900 dark:text-slate-200">
                {m.role === 'user' ? 'Your Household' : m.personaRole || 'Hawa Sarthi'}
              </span>
              {m.role === 'assistant' && m.model && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[11px]">{m.model}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{m.timestamp}</span>
            </div>
            <div
              className={`whitespace-pre-wrap text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'font-medium text-slate-900 dark:text-slate-100'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {m.text || (streaming ? 'Thinking...' : '')}
            </div>
          </div>
        ))}
        <div ref={chatBottomRef} />
      </div>

      {chatError && (
        <div className="mt-2 text-xs text-red-600 dark:text-red-400">{chatError}</div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage(input);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Continue conversation about ${city} smog or routines...`}
          disabled={streaming}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-teal-400"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400 whitespace-nowrap"
        >
          <Send className="h-3.5 w-3.5" />
          <span>{streaming ? 'Streaming...' : 'Send'}</span>
        </button>
      </form>
    </section>
  );
};
