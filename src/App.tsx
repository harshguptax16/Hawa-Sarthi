import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, RefreshCw, X } from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase.ts';
import { useFirebaseAuth } from './contexts/FirebaseContext.tsx';
import { DEFAULT_HOUSEHOLD_PROFILE } from './data/cities.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { BriefingView } from './components/BriefingView.tsx';
import { RoutinesView } from './components/RoutinesView.tsx';
import { IndoorLabView } from './components/IndoorLabView.tsx';
import { SmogScene3D } from './components/SmogScene3D.tsx';
import { VoiceCommunityView } from './components/VoiceCommunityView.tsx';
import type {
  AqiBriefing,
  CommunityActionCard,
  DailyCo2Point,
  HouseholdProfile,
  RoutinePlan,
  ThemeMode,
  WorkspaceTab,
} from './types.ts';

const STORAGE_KEYS = {
  city: 'hawa_sarthi_city',
  theme: 'hawa_sarthi_theme',
  profile: 'hawa_sarthi_profile',
  completed: 'hawa_sarthi_completed',
  pledges: 'hawa_sarthi_pledges',
  co2History: 'hawa_sarthi_co2_history',
};

function getLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [selectedCity, setSelectedCity] = useState<string>(
    () => localStorage.getItem(STORAGE_KEYS.city) || 'New Delhi'
  );
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.theme);
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [profile, setProfile] = useState<HouseholdProfile>(() =>
    readJson<HouseholdProfile>(STORAGE_KEYS.profile, DEFAULT_HOUSEHOLD_PROFILE)
  );
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('briefing');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Briefings & Plans State
  const [briefing, setBriefing] = useState<AqiBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);

  const [routinePlan, setRoutinePlan] = useState<RoutinePlan | null>(null);
  const [routineLoading, setRoutineLoading] = useState(false);
  const [routineError, setRoutineError] = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState<string[]>(() =>
    readJson<string[]>(STORAGE_KEYS.completed, [])
  );
  const [dailyCo2History, setDailyCo2History] = useState<Record<string, number>>(() =>
    readJson<Record<string, number>>(STORAGE_KEYS.co2History, {})
  );

  // Community State
  const [communityActions, setCommunityActions] = useState<CommunityActionCard[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [joinedPledges, setJoinedPledges] = useState<string[]>(() =>
    readJson<string[]>(STORAGE_KEYS.pledges, [])
  );

  // Audio Briefing State
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioScript, setAudioScript] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [showAudioBar, setShowAudioBar] = useState(false);

  // Firebase Auth & Firestore User Profile Sync
  const { user, authReady } = useFirebaseAuth();
  const [userProfileReady, setUserProfileReady] = useState(false);
  const hydratingFromCloudRef = useRef(false);

  // Google Maps Platform demo key quota warning state (persists at top-level)
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);

  useEffect(() => {
    const handleQuotaExceeded = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!user || !user.emailVerified) {
      setUserProfileReady(false);
      return;
    }

    let cancelled = false;
    const userDocRef = doc(db, 'users', user.uid);

    (async () => {
      try {
        const snap = await getDoc(userDocRef);
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as {
            selectedCity?: string;
            theme?: ThemeMode;
            householdProfile?: HouseholdProfile;
            joinedPledges?: string[];
          };
          hydratingFromCloudRef.current = true;
          if (data.selectedCity) setSelectedCity(data.selectedCity);
          if (data.theme === 'dark' || data.theme === 'light') setTheme(data.theme);
          if (data.householdProfile) setProfile(data.householdProfile);
          if (Array.isArray(data.joinedPledges)) setJoinedPledges(data.joinedPledges);
          window.setTimeout(() => {
            hydratingFromCloudRef.current = false;
          }, 100);
        } else {
          await setDoc(userDocRef, {
            uid: user.uid,
            displayName: (user.displayName || 'Household Member').slice(0, 100),
            selectedCity: selectedCity.slice(0, 80),
            theme,
            householdProfile: profile,
            joinedPledges: joinedPledges.slice(0, 20),
            updatedAt: serverTimestamp(),
          });
        }
        if (!cancelled) setUserProfileReady(true);
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
        } catch (wrapped) {
          console.error(wrapped);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, user?.uid]);

  // Subscribe to user's Firestore impactLogs for 7-day sparkline & today's completed steps
  useEffect(() => {
    if (!userProfileReady || !user || !user.emailVerified) return;
    const logsRef = collection(db, 'users', user.uid, 'impactLogs');
    const todayKey = getLocalDateKey(new Date());

    const unsub = onSnapshot(
      logsRef,
      (snap) => {
        const cloudHistory: Record<string, number> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as {
            dateId?: string;
            co2SavedGrams?: number;
            completedIds?: string[];
          };
          const key = data.dateId || d.id;
          if (typeof data.co2SavedGrams === 'number') {
            cloudHistory[key] = data.co2SavedGrams;
          }
          if (key === todayKey && Array.isArray(data.completedIds)) {
            setCompletedIds(data.completedIds);
          }
        });
        setDailyCo2History((prev) => ({ ...prev, ...cloudHistory }));
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/impactLogs`);
        } catch (wrapped) {
          console.error(wrapped);
        }
      }
    );

    return () => unsub();
  }, [userProfileReady, user]);

  // Persist user preferences/profile changes to Firestore
  useEffect(() => {
    if (!userProfileReady || !user || !user.emailVerified || hydratingFromCloudRef.current) return;
    const userDocRef = doc(db, 'users', user.uid);
    void setDoc(userDocRef, {
      uid: user.uid,
      displayName: (user.displayName || 'Household Member').slice(0, 100),
      selectedCity: selectedCity.slice(0, 80),
      theme,
      householdProfile: profile,
      joinedPledges: joinedPledges.slice(0, 20),
      updatedAt: serverTimestamp(),
    }).catch((err) => {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
      } catch (wrapped) {
        console.error(wrapped);
      }
    });
  }, [userProfileReady, user, selectedCity, theme, profile, joinedPledges]);

  // Sync theme class on documentElement
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.city, selectedCity);
  }, [selectedCity]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.completed, JSON.stringify(completedIds));
  }, [completedIds]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.pledges, JSON.stringify(joinedPledges));
  }, [joinedPledges]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.co2History, JSON.stringify(dailyCo2History));
  }, [dailyCo2History]);

  const fetchBriefing = useCallback(
    async (cityToLoad: string, activeProfile: HouseholdProfile) => {
      setBriefingLoading(true);
      setBriefingError(null);
      try {
        const res = await fetch('/api/aqi-briefing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ city: cityToLoad, profile: activeProfile }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch live briefing.');
        setBriefing(data as AqiBriefing);
        return data as AqiBriefing;
      } catch (err) {
        setBriefingError(
          err instanceof Error ? err.message : 'Unable to load grounded air quality.'
        );
        return null;
      } finally {
        setBriefingLoading(false);
      }
    },
    []
  );

  const fetchRoutinePlan = useCallback(
    async (
      cityToLoad: string,
      activeBriefing: AqiBriefing | null,
      activeProfile: HouseholdProfile,
      focusArea?: string
    ) => {
      setRoutineLoading(true);
      setRoutineError(null);
      try {
        const res = await fetch('/api/routine-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            city: cityToLoad,
            briefing: activeBriefing,
            profile: activeProfile,
            focusArea,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to generate routine plan.');
        setRoutinePlan(data as RoutinePlan);
      } catch (err) {
        setRoutineError(
          err instanceof Error ? err.message : 'Unable to generate daily routine plan.'
        );
      } finally {
        setRoutineLoading(false);
      }
    },
    []
  );

  const fetchCommunityActions = useCallback(
    async (cityToLoad: string, severity?: string) => {
      setCommunityLoading(true);
      setCommunityError(null);
      try {
        const res = await fetch('/api/community-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ city: cityToLoad, severity }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load community actions.');
        setCommunityActions(data.actions ?? []);
      } catch (err) {
        setCommunityError(
          err instanceof Error ? err.message : 'Unable to load community initiatives.'
        );
      } finally {
        setCommunityLoading(false);
      }
    },
    []
  );

  // Load live briefing whenever city changes (avoid burning quota on other tabs upfront)
  useEffect(() => {
    setBriefing(null);
    setBriefingError(null);
    setRoutinePlan(null);
    setRoutineError(null);
    setCommunityActions([]);
    setCommunityError(null);

    void fetchBriefing(selectedCity, profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCity]);

  // Lazy-load routines & community actions only when those tabs are visited
  useEffect(() => {
    if (activeTab === 'routines' && !routinePlan && !routineLoading && !routineError) {
      void fetchRoutinePlan(selectedCity, briefing, profile);
    } else if (
      activeTab === 'voice' &&
      communityActions.length === 0 &&
      !communityLoading &&
      !communityError
    ) {
      void fetchCommunityActions(selectedCity, briefing?.severity);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCity]);

  const handleSynthesizeAudio = async (text: string, voiceName: 'Kore' | 'Puck' = 'Kore') => {
    setAudioLoading(true);
    setAudioError(null);
    setAudioScript(text);
    setShowAudioBar(true);
    try {
      const res = await fetch('/api/voice-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptText: text,
          voiceName,
          language: profile.language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Audio synthesis failed.');
      setAudioUrl(data.audioDataUrl);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Unable to synthesize audio briefing.');
    } finally {
      setAudioLoading(false);
    }
  };

  const handleToggleComplete = (id: string) => {
    setCompletedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleTogglePledge = (id: string) => {
    setJoinedPledges((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const routineItems = routinePlan?.items ?? [];
  const completedCount = routineItems.filter((i) => completedIds.includes(i.id)).length;
  const pm25ReductionTotalPct = routineItems
    .filter((i) => completedIds.includes(i.id))
    .reduce((sum, i) => sum + i.estimatedPm25DropPct, 0);
  const co2SavedTotalGrams = routineItems
    .filter((i) => completedIds.includes(i.id))
    .reduce((sum, i) => sum + i.estimatedCo2SavedGrams, 0);

  useEffect(() => {
    if (routineItems.length === 0) return;
    const todayKey = getLocalDateKey(new Date());
    setDailyCo2History((prev) => {
      if (prev[todayKey] === co2SavedTotalGrams) return prev;
      return { ...prev, [todayKey]: co2SavedTotalGrams };
    });

    if (userProfileReady && user && user.emailVerified) {
      const logRef = doc(db, 'users', user.uid, 'impactLogs', todayKey);
      void setDoc(logRef, {
        uid: user.uid,
        dateId: todayKey,
        city: selectedCity.slice(0, 80),
        completedIds: completedIds.slice(0, 30),
        pm25ReductionPct: Math.min(Math.max(pm25ReductionTotalPct, 0), 100),
        co2SavedGrams: Math.min(Math.max(co2SavedTotalGrams, 0), 50000),
        updatedAt: serverTimestamp(),
      }).catch((err) => {
        try {
          handleFirestoreError(
            err,
            OperationType.WRITE,
            `users/${user.uid}/impactLogs/${todayKey}`
          );
        } catch (wrapped) {
          console.error(wrapped);
        }
      });
    }
  }, [
    co2SavedTotalGrams,
    pm25ReductionTotalPct,
    completedIds,
    routineItems.length,
    selectedCity,
    userProfileReady,
    user,
  ]);

  const co2History7Days: DailyCo2Point[] = useMemo(() => {
    const today = new Date();
    const points: DailyCo2Point[] = [];
    for (let offset = 6; offset >= 0; offset--) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const key = getLocalDateKey(d);
      const label =
        offset === 0
          ? 'Today'
          : d.toLocaleDateString(undefined, { weekday: 'short' });
      points.push({
        date: key,
        label,
        gramsSaved: dailyCo2History[key] ?? 0,
      });
    }
    return points;
  }, [dailyCo2History]);

  const handlePrimaryTopAction = () => {
    if (activeTab === 'routines') {
      void fetchRoutinePlan(selectedCity, briefing, profile);
    } else {
      void fetchBriefing(selectedCity, profile);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {gmpQuotaExceeded && (
        <div
          role="status"
          className="bg-amber-50 border-b border-amber-200 text-amber-900 dark:bg-amber-950/90 dark:border-amber-800 dark:text-amber-100 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm"
        >
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800 dark:text-amber-200 dark:hover:text-amber-100"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}
      {/* Strict 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-8 px-4 sm:px-6">
          {/* Zone 1: Single-line Brand Wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open city and household settings"
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <a
              href="#top"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('briefing');
              }}
              className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
            >
              Hawa Sarthi
            </a>
          </div>

          {/* Zone 2: 4 Single-Line Navigation Links */}
          <nav
            aria-label="Primary workspace navigation"
            className="flex items-center gap-5 overflow-x-auto sm:gap-7"
          >
            {[
              { id: 'briefing' as const, label: 'Briefing' },
              { id: 'routines' as const, label: 'Routines' },
              { id: 'lab' as const, label: 'Indoor Lab' },
              { id: '3d' as const, label: 'Airview 3D' },
              { id: 'voice' as const, label: 'Voice & Community' },
            ].map((nav) => {
              const active = activeTab === nav.id;
              return (
                <button
                  key={nav.id}
                  type="button"
                  onClick={() => setActiveTab(nav.id)}
                  className={`border-b-2 py-4 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:text-sm ${
                    active
                      ? 'border-teal-600 text-slate-900 dark:border-teal-400 dark:text-slate-100'
                      : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {nav.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary Action Button */}
          <div className="hidden shrink-0 sm:flex">
            <button
              type="button"
              onClick={handlePrimaryTopAction}
              disabled={briefingLoading || routineLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  briefingLoading || routineLoading ? 'animate-spin' : ''
                }`}
              />
              <span>{activeTab === 'routines' ? 'Tailor Plan' : 'Refresh Briefing'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Container */}
      <div className="mx-auto flex w-full max-w-[1440px] flex-1">
        <Sidebar
          selectedCity={selectedCity}
          onSelectCity={setSelectedCity}
          theme={theme}
          onChangeTheme={setTheme}
          profile={profile}
          onChangeProfile={setProfile}
          completedCount={completedCount}
          totalActionsCount={routineItems.length}
          pm25ReductionTotalPct={pm25ReductionTotalPct}
          co2SavedTotalGrams={co2SavedTotalGrams}
          co2History7Days={co2History7Days}
          isOpenMobile={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          {activeTab === 'briefing' && (
            <BriefingView
              city={selectedCity}
              briefing={briefing}
              loading={briefingLoading}
              error={briefingError}
              profile={profile}
              userProfileReady={userProfileReady}
              onRefresh={() => void fetchBriefing(selectedCity, profile)}
              onGoToRoutines={() => setActiveTab('routines')}
              onOpenLiveVoice={() => setActiveTab('voice')}
              onSpeakBriefing={(txt) => void handleSynthesizeAudio(txt, 'Kore')}
            />
          )}

          {activeTab === 'routines' && (
            <RoutinesView
              city={selectedCity}
              plan={routinePlan}
              loading={routineLoading}
              error={routineError}
              completedIds={completedIds}
              onToggleComplete={handleToggleComplete}
              onGeneratePlan={(focus) =>
                void fetchRoutinePlan(selectedCity, briefing, profile, focus)
              }
              onSpeakBriefing={(txt) => void handleSynthesizeAudio(txt, 'Kore')}
            />
          )}

          {activeTab === 'lab' && (
            <IndoorLabView
              city={selectedCity}
              profile={profile}
              onSpeakBriefing={(txt) => void handleSynthesizeAudio(txt, 'Kore')}
            />
          )}

          {activeTab === '3d' && (
            <SmogScene3D
              city={selectedCity}
              briefing={briefing}
              theme={theme}
              onExit={() => setActiveTab('briefing')}
            />
          )}

          {activeTab === 'voice' && (
            <VoiceCommunityView
              city={selectedCity}
              briefing={briefing}
              plan={routinePlan}
              profile={profile}
              audioUrl={audioUrl}
              audioScript={audioScript}
              audioLoading={audioLoading}
              audioError={audioError}
              onSynthesizeAudio={(txt, voice) => void handleSynthesizeAudio(txt, voice)}
              communityActions={communityActions}
              communityLoading={communityLoading}
              communityError={communityError}
              joinedPledges={joinedPledges}
              onTogglePledge={handleTogglePledge}
              onRefreshCommunity={() =>
                void fetchCommunityActions(selectedCity, briefing?.severity)
              }
            />
          )}
        </main>
      </div>

      {/* Contextual Spoken Audio Player Bar (only appears when user triggers audio playback) */}
      {showAudioBar && (
        <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur-xs dark:border-slate-800 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-xs text-slate-700 dark:text-slate-300">
              {audioLoading ? (
                <span>Synthesizing spoken audio briefing...</span>
              ) : audioError ? (
                <span className="text-red-600 dark:text-red-400">{audioError}</span>
              ) : (
                <span className="truncate block">
                  Audio Briefing · {selectedCity}
                </span>
              )}
            </div>
            {audioUrl && !audioLoading && (
              <audio controls autoPlay src={audioUrl} className="h-8 max-w-xs sm:max-w-sm" />
            )}
            <button
              type="button"
              onClick={() => setShowAudioBar(false)}
              aria-label="Close audio bar"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
