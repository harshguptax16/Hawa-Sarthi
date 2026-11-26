import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  AudioLines,
  Clock,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Volume2,
  Wind,
} from 'lucide-react';
import { GeminiChatbot } from './GeminiChatbot.tsx';
import { MapsPlacesPanel } from './MapsPlacesPanel.tsx';
import { PRESET_CITIES } from '../data/cities.ts';
import type {
  AqiBriefing,
  HouseholdProfile,
  SeverityTier,
} from '../types.ts';

interface BriefingViewProps {
  city: string;
  briefing: AqiBriefing | null;
  loading: boolean;
  error: string | null;
  profile: HouseholdProfile;
  userProfileReady: boolean;
  onRefresh: () => void;
  onGoToRoutines: () => void;
  onOpenLiveVoice: () => void;
  onSpeakBriefing: (text: string) => void;
}

function getSeverityDisplay(severity: SeverityTier): {
  label: string;
  textClass: string;
  borderClass: string;
  surfaceClass: string;
} {
  switch (severity) {
    case 'Good':
      return {
        label: 'Good Air Quality',
        textClass: 'text-emerald-700 dark:text-emerald-400',
        borderClass: 'border-emerald-200 dark:border-emerald-800/70',
        surfaceClass: 'bg-emerald-50/60 dark:bg-emerald-950/30',
      };
    case 'Moderate':
      return {
        label: 'Moderate Haze',
        textClass: 'text-amber-700 dark:text-amber-400',
        borderClass: 'border-amber-200 dark:border-amber-800/70',
        surfaceClass: 'bg-amber-50/60 dark:bg-amber-950/30',
      };
    case 'Poor':
      return {
        label: 'Poor · Sensitive Alert',
        textClass: 'text-orange-700 dark:text-orange-400',
        borderClass: 'border-orange-200 dark:border-orange-800/70',
        surfaceClass: 'bg-orange-50/60 dark:bg-orange-950/30',
      };
    case 'Very Poor':
      return {
        label: 'Very Poor · Smog Alert',
        textClass: 'text-rose-700 dark:text-rose-400',
        borderClass: 'border-rose-200 dark:border-rose-800/70',
        surfaceClass: 'bg-rose-50/60 dark:bg-rose-950/30',
      };
    case 'Severe':
    default:
      return {
        label: 'Severe Winter Smog',
        textClass: 'text-red-700 dark:text-red-400',
        borderClass: 'border-red-200 dark:border-red-800/70',
        surfaceClass: 'bg-red-50/70 dark:bg-red-950/40',
      };
  }
}

export const BriefingView: React.FC<BriefingViewProps> = ({
  city,
  briefing,
  loading,
  error,
  profile,
  userProfileReady,
  onRefresh,
  onGoToRoutines,
  onOpenLiveVoice,
  onSpeakBriefing,
}) => {

  const cityPreset = PRESET_CITIES.find(
    (c) => c.name.toLowerCase() === city.toLowerCase()
  );

  const fallbackWindows = [
    {
      timeLabel: '6:00 AM – 9:30 AM',
      riskLevel: 'Hazardous' as const,
      guidance:
        'Morning thermal inversion traps overnight emissions near ground level. Keep windows closed and postpone outdoor walks.',
    },
    {
      timeLabel: '1:00 PM – 4:00 PM',
      riskLevel: 'Elevated' as const,
      guidance:
        'Solar warming lifts the boundary layer—safest window for brief errands or 10-minute cross-ventilation if haze clears.',
    },
    {
      timeLabel: '7:00 PM – 11:00 PM',
      riskLevel: 'High' as const,
      guidance:
        'Evening cooling rapidly concentrates traffic and heating PM2.5. Switch to sealed indoor filtration and N95 masks outdoors.',
    },
  ];

  const activeWindows =
    briefing && briefing.hourlyWindows.length > 0 ? briefing.hourlyWindows : fallbackWindows;

  const sev = getSeverityDisplay(briefing?.severity ?? 'Poor');

  return (
    <div className="space-y-6">
      {loading && !briefing && (
        <div className="flex items-center gap-2.5 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3 text-xs text-teal-900 dark:border-teal-800/70 dark:bg-teal-950/30 dark:text-teal-200">
          <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
          <span>Fetching live grounded air-quality briefing for {city}...</span>
        </div>
      )}

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              Live AI briefing temporarily unavailable ({error}). Showing seasonal smog guidance, chatbot, and interactive Google Map below.
            </span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            <span>Retry Live Grounding</span>
          </button>
        </div>
      )}

      {/* Primary Telemetry & Grounded Briefing */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 md:flex-row md:items-start">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{briefing?.cityName ?? city}</span>
              <span aria-hidden="true">·</span>
              <span>{briefing ? 'Grounded live briefing' : 'Seasonal smog baseline'}</span>
              {briefing?.updatedAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {new Date(briefing.updatedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </>
              )}
            </div>
            <h1 className="max-w-3xl text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
              {briefing?.headline ?? `Winter Smog Briefing for ${city}`}
            </h1>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <div
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${sev.borderClass} ${sev.surfaceClass} ${sev.textClass}`}
            >
              {briefing?.severity === 'Good' ? (
                <ShieldCheck className="h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              )}
              <span className="whitespace-nowrap">{sev.label}</span>
            </div>

            {briefing && (
              <button
                type="button"
                onClick={() =>
                  onSpeakBriefing(
                    `${briefing.cityName} air quality briefing. ${sev.label}. ${briefing.headline}. ${briefing.householdAlert} Best outdoor window: ${briefing.safeOutdoorWindow}.`
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/70 whitespace-nowrap"
              >
                <Volume2 className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                <span>Listen</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenLiveVoice}
              className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50/70 px-3 py-1.5 text-xs font-medium text-teal-800 transition-colors hover:bg-teal-100/80 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300 dark:hover:bg-teal-900/50 whitespace-nowrap"
            >
              <AudioLines className="h-3.5 w-3.5" />
              <span>Live Voice</span>
            </button>
          </div>
        </div>

        {/* 4-Column Tabular Metrics Strip */}
        <div className="grid grid-cols-2 gap-4 py-5 lg:grid-cols-4">
          <div className="border-r border-slate-200/80 pr-4 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">Reported AQI</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {briefing?.aqiEstimate !== null && briefing?.aqiEstimate !== undefined
                ? briefing.aqiEstimate
                : 'N/A'}
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Composite index
            </div>
          </div>

          <div className="lg:border-r lg:border-slate-200/80 lg:pr-4 dark:lg:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">PM2.5 Fine Dust</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {briefing?.pm25Estimate !== null && briefing?.pm25Estimate !== undefined
                ? `${briefing.pm25Estimate}`
                : 'N/A'}
              <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">
                µg/m³
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Alveolar-penetrating
            </div>
          </div>

          <div className="border-r border-slate-200/80 pr-4 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">PM10 Coarse Dust</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {briefing?.pm10Estimate !== null && briefing?.pm10Estimate !== undefined
                ? `${briefing.pm10Estimate}`
                : 'N/A'}
              <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">
                µg/m³
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Road &amp; smoke ash
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Safest Outdoor Window</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-teal-700 dark:text-teal-400">
              <Clock className="h-4 w-4 shrink-0" />
              <span>{briefing?.safeOutdoorWindow ?? '1:00 PM – 4:00 PM'}</span>
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Peak thermal dispersion
            </div>
          </div>
        </div>

        {/* Inversion & Household Advisory */}
        <div className="grid grid-cols-1 gap-6 border-t border-slate-200 pt-5 dark:border-slate-800 lg:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Wind className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
              <span>Atmospheric &amp; Inversion Mechanism</span>
            </div>
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {briefing?.inversionContext ??
                (cityPreset
                  ? `${cityPreset.seasonalNote}. Cold night air pins urban exhaust, cooking smoke, and road dust beneath a shallow inversion lid until afternoon sunlight improves dispersion.`
                  : `Cold winter surface temperatures trap fine PM2.5 particles near ground level during calm early mornings and evenings.`)}
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Tailored Household Advisory
            </div>
            <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">
              {briefing?.householdAlert ??
                `Prioritize indoor air filtration during morning and evening rush hours, shift errands to the midday dispersion window, and wear a well-sealed N95/FFP2 respirator outdoors.`}
            </p>
            <button
              type="button"
              onClick={onGoToRoutines}
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300"
            >
              <span>Open tailored low-emission routine &amp; impact plan</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Grounded Sources */}
        {briefing && briefing.sources.length > 0 && (
          <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              Grounded Sources
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {briefing.sources.map((src) => (
                <a
                  key={src.uri}
                  href={src.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-teal-700 dark:text-slate-400 dark:decoration-slate-700 dark:hover:text-teal-300"
                >
                  <span className="max-w-[220px] truncate">{src.title}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 2-Column Split: Hourly Exposure Matrix + Streaming Ask Hawa Sarthi */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Hourly Window Matrix */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 xl:col-span-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Daily Exposure &amp; Ventilation Windows
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Plan commutes, school runs, and brief window cross-ventilation around cold-air inversion.
          </p>

          <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
            {activeWindows.map((win, idx) => (
              <div key={idx} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs font-medium tabular-nums text-slate-900 dark:text-slate-100">
                    {win.timeLabel}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      win.riskLevel === 'Low'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : win.riskLevel === 'Elevated'
                          ? 'text-amber-700 dark:text-amber-400'
                          : win.riskLevel === 'High'
                            ? 'text-orange-700 dark:text-orange-400'
                            : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {win.riskLevel} Risk
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {win.guidance}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Multi-Turn Role-Based Gemini Chatbot */}
        <GeminiChatbot
          city={city}
          briefing={briefing}
          profile={profile}
          userProfileReady={userProfileReady}
        />
      </div>

      {/* Google Maps Grounding: Clean-Air Transit, Shelters & Supplies */}
      <MapsPlacesPanel city={city} />
    </div>
  );
};
