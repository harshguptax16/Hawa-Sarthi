import React, { useState, useRef, useEffect } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Mic,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  Users,
  Volume2,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase.ts';
import { useFirebaseAuth } from '../contexts/FirebaseContext.tsx';
import { LiveVoiceAdvisor } from './LiveVoiceAdvisor.tsx';
import type {
  AqiBriefing,
  CommunityActionCard,
  GroundedSource,
  HouseholdProfile,
  RoutinePlan,
  UserCommunityPledge,
} from '../types.ts';

interface VoiceCommunityViewProps {
  city: string;
  briefing: AqiBriefing | null;
  plan: RoutinePlan | null;
  profile: HouseholdProfile;
  audioUrl: string | null;
  audioScript: string | null;
  audioLoading: boolean;
  audioError: string | null;
  onSynthesizeAudio: (text: string, voiceName: 'Kore' | 'Puck') => void;
  communityActions: CommunityActionCard[];
  communityLoading: boolean;
  communityError: string | null;
  joinedPledges: string[];
  onTogglePledge: (id: string) => void;
  onRefreshCommunity: () => void;
}

export const VoiceCommunityView: React.FC<VoiceCommunityViewProps> = ({
  city,
  briefing,
  plan,
  profile,
  audioUrl,
  audioScript,
  audioLoading,
  audioError,
  onSynthesizeAudio,
  communityActions,
  communityLoading,
  communityError,
  joinedPledges,
  onTogglePledge,
  onRefreshCommunity,
}) => {
  const { user, signInWithGoogle, signingIn } = useFirebaseAuth();
  const [voicePersona, setVoicePersona] = useState<'Kore' | 'Puck'>('Kore');
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [voiceAnswer, setVoiceAnswer] = useState<string | null>(null);
  const [voiceSources, setVoiceSources] = useState<GroundedSource[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Shared Firestore Community Pledges state
  const [sharedPledges, setSharedPledges] = useState<UserCommunityPledge[]>([]);
  const [pledgeCategory, setPledgeCategory] =
    useState<UserCommunityPledge['category']>('Carpool');
  const [pledgeTitle, setPledgeTitle] = useState('');
  const [pledgeNote, setPledgeNote] = useState('');
  const [pledgeSubmitting, setPledgeSubmitting] = useState(false);
  const [pledgeError, setPledgeError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (!user || !user.emailVerified) {
      setSharedPledges([]);
      return;
    }
    const q = query(collection(db, 'communityPledges'), where('city', '==', city));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: UserCommunityPledge[] = snap.docs.map((d) => {
          const data = d.data() as Omit<UserCommunityPledge, 'id'>;
          return {
            id: d.id,
            uid: data.uid,
            authorName: data.authorName,
            city: data.city,
            category: data.category,
            title: data.title,
            note: data.note,
          };
        });
        setSharedPledges(items);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'communityPledges');
        } catch (wrapped) {
          setPledgeError(
            wrapped instanceof Error ? wrapped.message : 'Unable to load neighborhood pledges.'
          );
        }
      }
    );
    return () => unsub();
  }, [city, user]);

  const handleSubmitPledge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !user.emailVerified) return;
    const cleanTitle = pledgeTitle.trim();
    const cleanNote = pledgeNote.trim();
    if (cleanTitle.length < 3 || cleanNote.length < 3) {
      setPledgeError('Please enter at least 3 characters for both pledge title and details.');
      return;
    }
    setPledgeSubmitting(true);
    setPledgeError(null);
    const pledgeId = `pledge_${Date.now()}`;
    try {
      await setDoc(doc(db, 'communityPledges', pledgeId), {
        uid: user.uid,
        authorName: (user.displayName || 'Community Member').slice(0, 80),
        city: city.slice(0, 80),
        category: pledgeCategory,
        title: cleanTitle.slice(0, 140),
        note: cleanNote.slice(0, 400),
        createdAt: serverTimestamp(),
      });
      setPledgeTitle('');
      setPledgeNote('');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, `communityPledges/${pledgeId}`);
      } catch (wrapped) {
        setPledgeError(
          wrapped instanceof Error ? wrapped.message : 'Could not publish community pledge.'
        );
      }
    } finally {
      setPledgeSubmitting(false);
    }
  };

  const handleDeletePledge = async (pledgeId: string) => {
    setPledgeError(null);
    try {
      await deleteDoc(doc(db, 'communityPledges', pledgeId));
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `communityPledges/${pledgeId}`);
      } catch (wrapped) {
        setPledgeError(
          wrapped instanceof Error ? wrapped.message : 'Could not delete pledge.'
        );
      }
    }
  };

  const buildDailyBriefingScript = () => {
    const topRoutine = plan?.items.slice(0, 3) ?? [];
    const actionsText =
      topRoutine.length > 0
        ? topRoutine.map((r) => `${r.title}: ${r.directImpactLabel}`).join('. ')
        : 'Keep doors and windows sealed during morning inversion, run wet mopping instead of dry sweeping, and wear a snug N95 mask outdoors.';
    const header = briefing
      ? `Namaste from Hawa Sarthi. Today in ${briefing.cityName}, air quality is ${briefing.severity}. ${briefing.headline}. ${briefing.householdAlert} Best outdoor window is ${briefing.safeOutdoorWindow}.`
      : `Namaste from Hawa Sarthi for ${city}.`;

    if (profile.language === 'hi') {
      return `${header} Aaj ke mukhya kadam: ${actionsText}. Har chhota badlav aapke parivar ke PM2.5 exposure ko kam karta hai.`;
    }
    return `${header} Top actions for your household today: ${actionsText}.`;
  };

  const startRecording = async () => {
    setVoiceError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Microphone capture is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setRecording(false);
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (blob.size < 400) {
          setVoiceError('Recording was too short. Please speak for 2–3 seconds.');
          return;
        }
        await submitVoiceAudio(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setVoiceError(
        'Microphone access was blocked. Allow microphone permission in your browser settings to ask by voice.'
      );
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const submitVoiceAudio = async (blob: Blob) => {
    setVoiceProcessing(true);
    setVoiceError(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = String(reader.result || '');
          const idx = res.indexOf(',');
          resolve(idx >= 0 ? res.slice(idx + 1) : res);
        };
        reader.onerror = () => reject(new Error('Failed to read recorded audio.'));
        reader.readAsDataURL(blob);
      });

      const res = await fetch('/api/voice-ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: base64,
          mimeType: blob.type || 'audio/webm',
          city,
          profile,
          briefingSummary: briefing
            ? `${briefing.severity} (AQI ${briefing.aqiEstimate ?? 'N/A'}, PM2.5 ${briefing.pm25Estimate ?? 'N/A'})`
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Voice processing failed.');
      setVoiceTranscript(data.transcript);
      setVoiceAnswer(data.answer);
      setVoiceSources(data.sources ?? []);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Could not process voice question.');
    } finally {
      setVoiceProcessing(false);
    }
  };

  const handleCopyShare = async (card: CommunityActionCard) => {
    try {
      await navigator.clipboard.writeText(card.shareableMessage);
      setCopiedId(card.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Real-Time Bidirectional Live API Conversation */}
      <LiveVoiceAdvisor city={city} briefing={briefing} profile={profile} />

      {/* Top Split: Audio Briefing Player + Ask by Voice */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Audio Briefing Synthesis */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Volume2 className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                <span>Spoken Family &amp; Elder Guidance</span>
              </div>
              <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                Audio Smog Briefing
              </h2>
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
              {(['Kore', 'Puck'] as const).map((voice) => (
                <button
                  key={voice}
                  type="button"
                  onClick={() => setVoicePersona(voice)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    voicePersona === voice
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {voice === 'Kore' ? 'Calm (Kore)' : 'Warm (Puck)'}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              Synthesizes a clear spoken daily summary for parents, elders, and busy mornings in{' '}
              <span className="font-medium text-slate-900 dark:text-slate-200">
                {profile.language === 'hi' ? 'Hindi/Hinglish clarity' : 'English'}
              </span>
              .
            </p>

            <button
              type="button"
              onClick={() => onSynthesizeAudio(buildDailyBriefingScript(), voicePersona)}
              disabled={audioLoading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
            >
              <Volume2 className="h-4 w-4" />
              <span>
                {audioLoading ? 'Generating Spoken Audio...' : `Generate ${city} Audio Briefing`}
              </span>
            </button>

            {audioError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{audioError}</span>
              </div>
            )}

            {audioUrl && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <audio controls src={audioUrl} className="w-full" />
                {audioScript && (
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {audioScript}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Ask by Voice (Transcribe + Grounded Answer) */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Mic className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
              <span>Hands-Free Speech Recognition</span>
            </div>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
              Ask Hawa Sarthi by Voice
            </h2>
          </div>

          <div className="mt-4 space-y-4">
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              Speak a question in English or Hindi—for example, &ldquo;Should we cancel morning walk today?&rdquo; or &ldquo;Kitchen smoke kaise kam karein?&rdquo;
            </p>

            <div className="flex items-center gap-3">
              {!recording ? (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={voiceProcessing}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-medium text-slate-900 transition-colors hover:border-teal-600 hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-teal-400"
                >
                  <Mic className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  <span>{voiceProcessing ? 'Transcribing & Answering...' : 'Record Voice Question'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-red-700"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  <span className="font-mono tabular-nums">
                    Stop Recording ({recordSeconds}s)
                  </span>
                </button>
              )}
            </div>

            {voiceError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{voiceError}</span>
              </div>
            )}

            {voiceTranscript && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <div>
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Transcribed Question
                  </div>
                  <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    &ldquo;{voiceTranscript}&rdquo;
                  </p>
                </div>
                {voiceAnswer && (
                  <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Hawa Sarthi Guidance
                      </span>
                      <button
                        type="button"
                        onClick={() => onSynthesizeAudio(voiceAnswer, voicePersona)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                        <span>Speak Reply</span>
                      </button>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                      {voiceAnswer}
                    </p>
                    {voiceSources.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-3">
                        {voiceSources.map((s) => (
                          <a
                            key={s.uri}
                            href={s.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-teal-700 underline dark:text-teal-400"
                          >
                            <span className="max-w-[180px] truncate">{s.title}</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Community Clean-Air Action Board */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Users className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
              <span>Neighborhood &amp; School Collective Action</span>
            </div>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
              Community Initiatives for {city}
            </h2>
          </div>

          <button
            type="button"
            onClick={onRefreshCommunity}
            disabled={communityLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/70 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${communityLoading ? 'animate-spin' : ''}`} />
            <span>{communityLoading ? 'Loading...' : 'Refresh Local Actions'}</span>
          </button>
        </div>

        {communityError && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{communityError}</span>
          </div>
        )}

        {communityLoading && communityActions.length === 0 ? (
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-44 animate-pulse rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
              />
            ))}
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            {communityActions.map((card) => {
              const joined = joinedPledges.includes(card.id);
              const isCopied = copiedId === card.id;
              return (
                <article
                  key={card.id}
                  className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950"
                >
                  <div className="space-y-2">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {card.category} · {city}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {card.title}
                    </h3>
                    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {card.description}
                    </p>
                    <p className="text-xs font-medium text-teal-700 dark:text-teal-400">
                      Collective Impact: {card.collectiveImpact}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => onTogglePledge(card.id)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        joined
                          ? 'bg-teal-600 text-white dark:bg-teal-500 dark:text-slate-950'
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>{joined ? 'Pledged' : 'Join Pledge'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopyShare(card)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      {isCopied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                          <span>Copied Invite</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy Group Invite</span>
                        </>
                      )}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Shared Neighborhood Pledges (Firestore Live Collection) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Neighborhood Clean-Air Pledges · {city}
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Publish and browse live carpool, zero-burn, and clean-heating commitments from neighbors in {city}.
          </p>
        </div>

        {!user ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Sign in with Google to view live {city} pledges and post your family&apos;s commitment.
            </p>
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              disabled={signingIn}
              className="rounded-lg bg-teal-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 whitespace-nowrap"
            >
              {signingIn ? 'Signing in...' : 'Sign in with Google'}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <form
              onSubmit={(e) => void handleSubmitPledge(e)}
              className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950 md:grid-cols-12"
            >
              <div className="md:col-span-3">
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  Category
                </label>
                <select
                  value={pledgeCategory}
                  onChange={(e) =>
                    setPledgeCategory(e.target.value as UserCommunityPledge['category'])
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="Carpool">Carpool</option>
                  <option value="Zero-Burn">Zero-Burn</option>
                  <option value="School Zone">School Zone</option>
                  <option value="Clean Heating">Clean Heating</option>
                </select>
              </div>
              <div className="md:col-span-4">
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  Pledge Title
                </label>
                <input
                  type="text"
                  value={pledgeTitle}
                  onChange={(e) => setPledgeTitle(e.target.value)}
                  placeholder="e.g., 3-family school metro carpool"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="md:col-span-3">
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  Neighborhood Note &amp; Impact
                </label>
                <input
                  type="text"
                  value={pledgeNote}
                  onChange={(e) => setPledgeNote(e.target.value)}
                  placeholder="Block / timing / emission saved"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex items-end md:col-span-2">
                <button
                  type="submit"
                  disabled={pledgeSubmitting}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{pledgeSubmitting ? 'Posting...' : 'Post Pledge'}</span>
                </button>
              </div>
            </form>

            {pledgeError && (
              <p className="text-xs text-red-600 dark:text-red-400">{pledgeError}</p>
            )}

            {sharedPledges.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No neighbor pledges posted for {city} yet—be the first household to post one above.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {sharedPledges.map((pledge) => (
                  <div
                    key={pledge.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div className="space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {pledge.category} · {pledge.authorName}
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {pledge.title}
                      </h3>
                      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        {pledge.note}
                      </p>
                    </div>
                    {pledge.uid === user.uid && (
                      <button
                        type="button"
                        onClick={() => void handleDeletePledge(pledge.id)}
                        aria-label="Delete your pledge"
                        className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-red-600 dark:hover:bg-slate-800 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
