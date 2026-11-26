import React, { useState } from 'react';
import {
  MapPin,
  Search,
  Sun,
  Moon,
  Users,
  CheckCircle2,
  LogIn,
  LogOut,
  X,
} from 'lucide-react';
import { PRESET_CITIES } from '../data/cities.ts';
import { useFirebaseAuth } from '../contexts/FirebaseContext.tsx';
import { Co2Sparkline } from './Co2Sparkline.tsx';
import type { DailyCo2Point, HouseholdProfile, ThemeMode } from '../types.ts';

interface SidebarProps {
  selectedCity: string;
  onSelectCity: (city: string) => void;
  theme: ThemeMode;
  onChangeTheme: (theme: ThemeMode) => void;
  profile: HouseholdProfile;
  onChangeProfile: (profile: HouseholdProfile) => void;
  completedCount: number;
  totalActionsCount: number;
  pm25ReductionTotalPct: number;
  co2SavedTotalGrams: number;
  co2History7Days: DailyCo2Point[];
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  selectedCity,
  onSelectCity,
  theme,
  onChangeTheme,
  profile,
  onChangeProfile,
  completedCount,
  totalActionsCount,
  pm25ReductionTotalPct,
  co2SavedTotalGrams,
  co2History7Days,
  isOpenMobile,
  onCloseMobile,
}) => {
  const { user, authReady, signingIn, authError, signInWithGoogle, signOutUser } =
    useFirebaseAuth();
  const [cityQuery, setCityQuery] = useState('');

  const handleCitySearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = cityQuery.trim();
    if (!trimmed) return;
    onSelectCity(trimmed);
    setCityQuery('');
    onCloseMobile();
  };

  const toggleFlag = (
    key: 'youngChildren' | 'seniors' | 'asthmaOrRespiratory' | 'pregnant'
  ) => {
    onChangeProfile({
      ...profile,
      [key]: !profile[key],
    });
  };

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between overflow-y-auto px-5 py-6">
      <div className="space-y-6">
        {/* Account & Cloud Sync */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Household Account
            </span>
            <button
              type="button"
              onClick={onCloseMobile}
              className="rounded-md p-1 text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 lg:hidden"
              aria-label="Close sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {!authReady ? (
            <div className="h-9 animate-pulse rounded-lg bg-slate-200/70 dark:bg-slate-800" />
          ) : user ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-800 dark:bg-slate-900">
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                  {user.displayName || 'Household Member'}
                </div>
                <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                  Cloud sync active
                </div>
              </div>
              <button
                type="button"
                onClick={() => void signOutUser()}
                title="Sign out"
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <LogOut className="h-3 w-3" />
                <span>Sign out</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              disabled={signingIn}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:border-teal-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-teal-400 whitespace-nowrap"
            >
              <LogIn className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
              <span>{signingIn ? 'Signing in...' : 'Sign in with Google'}</span>
            </button>
          )}
          {authError && (
            <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{authError}</p>
          )}
        </div>

        {/* Theme Switch */}
        <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Appearance
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
            <button
              type="button"
              onClick={() => onChangeTheme('light')}
              className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                theme === 'light'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
              <span>Light</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeTheme('dark')}
              className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                theme === 'dark'
                  ? 'bg-slate-900 text-slate-100 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
              <span>Dark</span>
            </button>
          </div>
        </div>

        {/* City Selector */}
        <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
          <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <MapPin className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            <span>City &amp; Airshed</span>
          </div>

          <form onSubmit={handleCitySearch} className="mb-3 flex gap-1.5">
            <input
              type="text"
              value={cityQuery}
              onChange={(e) => setCityQuery(e.target.value)}
              placeholder="Search any city..."
              aria-label="Search custom city"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-teal-400"
            />
            <button
              type="submit"
              aria-label="Apply city"
              className="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </form>

          <label htmlFor="city-preset-select" className="sr-only">
            Select city preset
          </label>
          <select
            id="city-preset-select"
            value={
              PRESET_CITIES.some((c) => c.name.toLowerCase() === selectedCity.toLowerCase())
                ? PRESET_CITIES.find((c) => c.name.toLowerCase() === selectedCity.toLowerCase())!
                    .name
                : '__custom__'
            }
            onChange={(e) => {
              if (e.target.value !== '__custom__') {
                onSelectCity(e.target.value);
                onCloseMobile();
              }
            }}
            className="mb-2.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-teal-400"
          >
            {!PRESET_CITIES.some((c) => c.name.toLowerCase() === selectedCity.toLowerCase()) && (
              <option value="__custom__">{selectedCity} (Custom)</option>
            )}
            {PRESET_CITIES.map((city) => (
              <option key={city.id} value={city.name}>
                {city.name} · {city.country}
              </option>
            ))}
          </select>

          <div className="grid grid-cols-2 gap-1.5">
            {PRESET_CITIES.slice(0, 6).map((city) => {
              const active = city.name.toLowerCase() === selectedCity.toLowerCase();
              return (
                <button
                  key={city.id}
                  type="button"
                  onClick={() => {
                    onSelectCity(city.name);
                    onCloseMobile();
                  }}
                  className={`truncate rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                    active
                      ? 'border-teal-600 bg-teal-50/70 font-medium text-teal-800 dark:border-teal-400 dark:bg-teal-950/50 dark:text-teal-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {city.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Household Profile Calibration */}
        <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
          <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <Users className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            <span>Household Sensitivity</span>
          </div>

          <div className="space-y-2">
            {[
              { key: 'youngChildren' as const, label: 'Young children' },
              { key: 'seniors' as const, label: 'Seniors (65+)' },
              { key: 'asthmaOrRespiratory' as const, label: 'Asthma / respiratory' },
              { key: 'pregnant' as const, label: 'Pregnant member' },
            ].map((item) => (
              <label
                key={item.key}
                className="flex cursor-pointer items-center justify-between rounded-md py-1 text-xs text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
              >
                <span>{item.label}</span>
                <input
                  type="checkbox"
                  checked={profile[item.key]}
                  onChange={() => toggleFlag(item.key)}
                  className="h-4 w-4 rounded border-slate-300 accent-teal-600 dark:border-slate-700 dark:accent-teal-400"
                />
              </label>
            ))}
          </div>

          <div className="mt-4 space-y-2.5">
            <div>
              <label
                htmlFor="commute-select"
                className="mb-1 block text-xs text-slate-500 dark:text-slate-400"
              >
                Primary commute
              </label>
              <select
                id="commute-select"
                value={profile.commuteMode}
                onChange={(e) =>
                  onChangeProfile({
                    ...profile,
                    commuteMode: e.target.value as HouseholdProfile['commuteMode'],
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="publicTransit">Metro / Bus Transit</option>
                <option value="car">Private Car</option>
                <option value="twoWheeler">Two-Wheeler / Scooter</option>
                <option value="walkCycle">Walk / Cycle</option>
                <option value="workFromHome">Work / Study From Home</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="ventilation-select"
                className="mb-1 block text-xs text-slate-500 dark:text-slate-400"
              >
                Home ventilation
              </label>
              <select
                id="ventilation-select"
                value={profile.ventilationType}
                onChange={(e) =>
                  onChangeProfile({
                    ...profile,
                    ventilationType: e.target.value as HouseholdProfile['ventilationType'],
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="mixed">Mixed windows &amp; fans</option>
                <option value="naturalWindows">Natural window airflow only</option>
                <option value="sealedAC">Sealed room with purifier/AC</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="cooking-select"
                className="mb-1 block text-xs text-slate-500 dark:text-slate-400"
              >
                Cooking fuel
              </label>
              <select
                id="cooking-select"
                value={profile.cookingFuel}
                onChange={(e) =>
                  onChangeProfile({
                    ...profile,
                    cookingFuel: e.target.value as HouseholdProfile['cookingFuel'],
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="lpg">LPG Gas Stove</option>
                <option value="electricInduction">Electric / Induction</option>
                <option value="solidBiomass">Solid Fuel / Biomass</option>
              </select>
            </div>

            <div>
              <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                Briefing language
              </span>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
                <button
                  type="button"
                  onClick={() => onChangeProfile({ ...profile, language: 'en' })}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    profile.language === 'en'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => onChangeProfile({ ...profile, language: 'hi' })}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    profile.language === 'hi'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Hinglish
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Persistent Impact Ledger Summary */}
      <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
        <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
          <CheckCircle2 className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
          <span>Today&apos;s Impact Ledger</span>
        </div>
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">Completed steps</span>
            <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {completedCount}/{totalActionsCount}
            </span>
          </div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">Est. PM2.5 drop</span>
            <span className="font-mono font-semibold tabular-nums text-teal-700 dark:text-teal-400">
              -{Math.min(pm25ReductionTotalPct, 85)}%
            </span>
          </div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">CO₂ avoided</span>
            <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {(co2SavedTotalGrams / 1000).toFixed(2)} kg
            </span>
          </div>
          <Co2Sparkline data={co2History7Days} theme={theme} />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden w-[264px] shrink-0 border-r border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950 lg:block">
        {sidebarContent}
      </aside>

      {isOpenMobile && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 h-full w-72 border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
};
