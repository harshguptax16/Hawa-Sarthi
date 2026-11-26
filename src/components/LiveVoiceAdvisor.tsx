import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  AudioLines,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Send,
} from 'lucide-react';
import type { AqiBriefing, HouseholdProfile } from '../types.ts';

interface LiveVoiceAdvisorProps {
  city: string;
  briefing: AqiBriefing | null;
  profile: HouseholdProfile;
}

type LiveVoiceName = 'Zephyr' | 'Kore' | 'Puck' | 'Fenrir' | 'Charon';

interface LiveTurnEntry {
  id: string;
  speaker: 'user' | 'assistant';
  text: string;
}

const VOICE_OPTIONS: Array<{ id: LiveVoiceName; label: string }> = [
  { id: 'Zephyr', label: 'Zephyr · Clear' },
  { id: 'Kore', label: 'Kore · Calm' },
  { id: 'Puck', label: 'Puck · Warm' },
  { id: 'Fenrir', label: 'Fenrir · Steady' },
  { id: 'Charon', label: 'Charon · Deep' },
];

function float32ToInt16Base64(float32: Float32Array): string {
  const bytes = new Uint8Array(float32.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(i * 2, Math.round(int16), true);
  }
  let binary = '';
  const chunkSize = 0x4000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

export const LiveVoiceAdvisor: React.FC<LiveVoiceAdvisorProps> = ({
  city,
  briefing,
  profile,
}) => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [voiceName, setVoiceName] = useState<LiveVoiceName>('Zephyr');
  const [muted, setMuted] = useState(false);
  const [micLevelPct, setMicLevelPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<LiveTurnEntry[]>([]);
  const [textPrompt, setTextPrompt] = useState('');

  // Refs for audio/WS callbacks (avoid stale closures in onaudioprocess/onmessage)
  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const mutedRef = useRef<boolean>(false);
  const statusRef = useRef<'idle' | 'connecting' | 'connected'>('idle');
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const stopQueuedOutputAudio = useCallback(() => {
    activeSourcesRef.current.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // ignore already stopped sources
      }
    });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const teardownSession = useCallback(() => {
    stopQueuedOutputAudio();

    if (processorNodeRef.current) {
      processorNodeRef.current.onaudioprocess = null;
      try {
        processorNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      processorNodeRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceNodeRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (inputCtxRef.current) {
      void inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }

    if (outputCtxRef.current) {
      void outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    statusRef.current = 'idle';
    setMicLevelPct(0);
    setMuted(false);
    setStatus('idle');
  }, [stopQueuedOutputAudio]);

  useEffect(() => {
    return () => {
      teardownSession();
    };
  }, [teardownSession]);

  const appendTranscriptChunk = useCallback((speaker: 'user' | 'assistant', chunkText: string) => {
    if (!chunkText) return;
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === speaker) {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...last,
          text: `${last.text}${chunkText}`,
        };
        return updated;
      }
      return [
        ...prev,
        {
          id: `${speaker}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          speaker,
          text: chunkText,
        },
      ];
    });
  }, []);

  const schedulePcmOutput = useCallback(
    (base64Audio: string) => {
      const ctx = outputCtxRef.current;
      if (!ctx) return;
      const samples = base64PcmToFloat32(base64Audio);
      if (samples.length === 0) return;

      const audioBuffer = ctx.createBuffer(1, samples.length, 24000);
      audioBuffer.getChannelData(0).set(samples);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const startAt = Math.max(ctx.currentTime + 0.01, nextStartTimeRef.current);
      source.start(startAt);
      nextStartTimeRef.current = startAt + audioBuffer.duration;

      activeSourcesRef.current.add(source);
      source.onended = () => {
        activeSourcesRef.current.delete(source);
      };
    },
    []
  );

  const startLiveConversation = async () => {
    if (status !== 'idle') return;
    setError(null);
    setStatus('connecting');

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone capture is unavailable in this browser.');
      setStatus('idle');
      return;
    }

    try {
      // 1. Acquire mic & create separate 16kHz input and 24kHz output AudioContexts
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      await inputCtx.resume();
      await outputCtx.resume();
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;

      // 2. Open WebSocket bridge to /ws/live
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'setup',
            city,
            profile,
            voiceName,
            briefingSummary: briefing
              ? `${briefing.severity} (AQI ${briefing.aqiEstimate ?? 'N/A'}, PM2.5 ${briefing.pm25Estimate ?? 'N/A'}). ${briefing.householdAlert}`
              : undefined,
          })
        );
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as {
          type?: string;
          data?: string;
          text?: string;
          error?: string;
        };

        if (msg.type === 'ready') {
          statusRef.current = 'connected';
          setStatus('connected');
          // Wire microphone PCM capture once session is ready
          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(4096, 1, 1);
          sourceNodeRef.current = source;
          processorNodeRef.current = processor;

          processor.onaudioprocess = (ev) => {
            if (ws.readyState !== WebSocket.OPEN || statusRef.current !== 'connected') {
              return;
            }
            const channel = ev.inputBuffer.getChannelData(0);
            if (mutedRef.current) {
              setMicLevelPct(0);
              return;
            }
            let sumSq = 0;
            for (let i = 0; i < channel.length; i++) {
              sumSq += channel[i] * channel[i];
            }
            const rms = Math.sqrt(sumSq / channel.length);
            setMicLevelPct(Math.min(100, Math.round(rms * 420)));

            const base64 = float32ToInt16Base64(channel);
            ws.send(JSON.stringify({ type: 'audio', data: base64 }));
          };

          source.connect(processor);
          processor.connect(inputCtx.destination);
        } else if (msg.type === 'audio' && msg.data) {
          schedulePcmOutput(msg.data);
        } else if (msg.type === 'inputTranscript' && msg.text) {
          appendTranscriptChunk('user', msg.text);
        } else if (msg.type === 'outputTranscript' && msg.text) {
          appendTranscriptChunk('assistant', msg.text);
        } else if (msg.type === 'interrupted') {
          stopQueuedOutputAudio();
        } else if (msg.type === 'error') {
          setError(msg.error || 'Live voice session encountered an error.');
          teardownSession();
        } else if (msg.type === 'closed') {
          teardownSession();
        }
      };

      ws.onerror = () => {
        setError('Live WebSocket connection interrupted.');
        teardownSession();
      };

      ws.onclose = () => {
        if (statusRef.current !== 'idle') {
          teardownSession();
        }
      };
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Microphone access was blocked or Live audio initialization failed.'
      );
      teardownSession();
    }
  };

  const handleSendTextInterjection = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = textPrompt.trim();
    if (!clean || status !== 'connected' || !wsRef.current) return;
    if (wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'text', text: clean }));
      appendTranscriptChunk('user', clean);
      setTextPrompt('');
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <AudioLines className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            <span>Real-Time Bidirectional Voice · gemini-3.8-live</span>
          </div>
          <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Live Voice Conversation with Hawa Sarthi
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Speak naturally and interrupt anytime—grounded in {city}&apos;s airshed and your household sensitivities.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Select live voice persona"
            value={voiceName}
            disabled={status !== 'idle'}
            onChange={(e) => setVoiceName(e.target.value as LiveVoiceName)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-800 focus:border-teal-600 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            {VOICE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>

          {status === 'connected' && (
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                muted
                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
              }`}
            >
              {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              <span>{muted ? 'Mic Muted' : 'Mute Mic'}</span>
            </button>
          )}

          {status === 'idle' ? (
            <button
              type="button"
              onClick={() => void startLiveConversation()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400 whitespace-nowrap"
            >
              <PhoneCall className="h-3.5 w-3.5" />
              <span>Start Live Conversation</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={teardownSession}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-red-700 whitespace-nowrap"
            >
              <PhoneOff className="h-3.5 w-3.5" />
              <span>{status === 'connecting' ? 'Cancel' : 'End Conversation'}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Live Mic Input Level & Session Status */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-950">
        <div className="text-xs text-slate-600 dark:text-slate-400">
          Status:{' '}
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {status === 'idle'
              ? 'Ready to connect'
              : status === 'connecting'
                ? 'Connecting Live audio session...'
                : muted
                  ? 'Connected · Microphone muted'
                  : 'Connected · Listening & speaking in real time'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Mic Input</span>
          <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full bg-teal-600 transition-all duration-75 dark:bg-teal-400"
              style={{ width: `${micLevelPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Live Bidirectional Transcript */}
      <div className="mt-4 max-h-56 min-h-[120px] space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
        {turns.length === 0 ? (
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Click &ldquo;Start Live Conversation&rdquo; to speak directly with Hawa Sarthi—ask about outdoor walk windows, sealing windows, DIY box-fan filters, or school commute protection in {city}.
          </p>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className="space-y-0.5">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {turn.speaker === 'user' ? 'Your Household' : 'Hawa Sarthi Live'}
              </div>
              <p
                className={`text-sm leading-relaxed ${
                  turn.speaker === 'user'
                    ? 'font-medium text-slate-900 dark:text-slate-100'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {turn.text}
              </p>
            </div>
          ))
        )}
        <div ref={transcriptEndRef} />
      </div>

      {status === 'connected' && (
        <form onSubmit={handleSendTextInterjection} className="mt-3 flex gap-2">
          <input
            type="text"
            value={textPrompt}
            onChange={(e) => setTextPrompt(e.target.value)}
            placeholder="Optional: type a quick follow-up while on the call..."
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={!textPrompt.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 whitespace-nowrap"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Send</span>
          </button>
        </form>
      )}
    </section>
  );
};
