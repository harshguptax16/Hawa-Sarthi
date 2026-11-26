import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  RefreshCw,
  Volume2,
} from 'lucide-react';
import type { RoutineCategory, RoutinePlan } from '../types.ts';

interface RoutinesViewProps {
  city: string;
  plan: RoutinePlan | null;
  loading: boolean;
  error: string | null;
  completedIds: string[];
  onToggleComplete: (id: string) => void;
  onGeneratePlan: (focusArea?: string) => void;
  onSpeakBriefing: (text: string) => void;
}

const CATEGORY_LABELS: Record<RoutineCategory, string> = {
  routine: 'Low-Emission Routine',
  indoorHack: 'Indoor Air Hack',
  sustainableAlt: 'Sustainable Swap',
  communityAction: 'Community Action',
};

export const RoutinesView: React.FC<RoutinesViewProps> = ({
  city,
  plan,
  loading,
  error,
  completedIds,
  onToggleComplete,
  onGeneratePlan,
  onSpeakBriefing,
}) => {
  const [filter, setFilter] = useState<'all' | RoutineCategory>('all');
  const [focusArea, setFocusArea] = useState('Balanced household & community plan');

  const items = plan?.items ?? [];
  const filteredItems =
    filter === 'all' ? items : items.filter((item) => item.category === filter);

  const completedCount = items.filter((i) => completedIds.includes(i.id)).length;
  const totalPm25Potential = items.reduce((acc, i) => acc + i.estimatedPm25DropPct, 0);
  const achievedPm25 = items
    .filter((i) => completedIds.includes(i.id))
    .reduce((acc, i) => acc + i.estimatedPm25DropPct, 0);
  const achievedCo2Grams = items
    .filter((i) => completedIds.includes(i.id))
    .reduce((acc, i) => acc + i.estimatedCo2SavedGrams, 0);

  return (
    <div className="space-y-6">
      {/* Planner Control Header */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 lg:flex-row lg:items-end">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{city}</span>
              <span aria-hidden="true">·</span>
              <span>Personalized daily resilience &amp; emission plan</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Low-Emission Routines &amp; Direct Impact
            </h1>
            <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-400">
              {plan?.dailyStrategySummary ??
                'Every recommendation links the exact household choice to its physical mechanism and measurable PM2.5 or emission impact.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="focus-area-select" className="sr-only">
              Focus Priority
            </label>
            <select
              id="focus-area-select"
              value={focusArea}
              onChange={(e) => setFocusArea(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="Balanced household & community plan">Balanced Family Plan</option>
              <option value="School commute & low-emission travel">School &amp; Commute Focus</option>
              <option value="Zero-cost indoor sealing & clean cooking">Indoor Air &amp; Kitchen</option>
              <option value="Seniors & respiratory protection">Elders &amp; Asthma Shield</option>
            </select>

            <button
              type="button"
              onClick={() => onGeneratePlan(focusArea)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400 whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Generating...' : 'Tailor Plan'}</span>
            </button>
          </div>
        </div>

        {/* Summary Tabular Row */}
        <div className="grid grid-cols-1 gap-4 pt-5 sm:grid-cols-3">
          <div className="border-b border-slate-200 pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">Routine Completion</div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {completedCount} / {items.length} steps
            </div>
          </div>
          <div className="border-b border-slate-200 pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Cumulative Inhaled PM2.5 Reduction
            </div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-teal-700 dark:text-teal-400">
              -{Math.min(achievedPm25, 85)}%{' '}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                (of -{Math.min(totalPm25Potential, 85)}% max)
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Direct Emissions Avoided Today
            </div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {(achievedCo2Grams / 1000).toFixed(2)} kg CO₂e
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50/70 px-4 py-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => onGeneratePlan(focusArea)}
            className="shrink-0 font-medium underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filter Tabs + Listen */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
          {[
            { id: 'all' as const, label: 'All Actions' },
            { id: 'routine' as const, label: 'Low-Emission Routine' },
            { id: 'indoorHack' as const, label: 'Indoor Hacks' },
            { id: 'sustainableAlt' as const, label: 'Sustainable Swaps' },
            { id: 'communityAction' as const, label: 'Community' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {items.length > 0 && (
          <button
            type="button"
            onClick={() =>
              onSpeakBriefing(
                `Today's plan for ${city}. ${plan?.dailyStrategySummary ?? ''} Top actions: ${items
                  .slice(0, 3)
                  .map((i) => `${i.title}: ${i.directImpactLabel}`)
                  .join('. ')}`
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Volume2 className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            <span>Read Plan Aloud</span>
          </button>
        )}
      </div>

      {/* Loading Skeleton */}
      {loading && items.length === 0 && (
        <div className="space-y-4">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && items.length === 0 && !error && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            No routine plan generated yet for {city}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
            Generate a tailored low-emission schedule and indoor air-quality checklist matched to your family profile.
          </p>
          <button
            type="button"
            onClick={() => onGeneratePlan(focusArea)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950"
          >
            Generate Today&apos;s Plan
          </button>
        </div>
      )}

      {/* Action List with Choice -> Mechanism -> Impact Breakdown */}
      <div className="space-y-4">
        {filteredItems.map((item) => {
          const isDone = completedIds.includes(item.id);
          return (
            <article
              key={item.id}
              className={`rounded-xl border p-5 transition-colors ${
                isDone
                  ? 'border-teal-300 bg-teal-50/30 dark:border-teal-800/70 dark:bg-teal-950/20'
                  : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
              }`}
            >
              <div className="flex items-start gap-4">
                <button
                  type="button"
                  onClick={() => onToggleComplete(item.id)}
                  aria-label={`Mark ${item.title} as ${isDone ? 'incomplete' : 'complete'}`}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                    isDone
                      ? 'border-teal-600 bg-teal-600 text-white dark:border-teal-400 dark:bg-teal-400 dark:text-slate-950'
                      : 'border-slate-300 bg-white hover:border-teal-600 dark:border-slate-600 dark:bg-slate-950 dark:hover:border-teal-400'
                  }`}
                >
                  {isDone && <Check className="h-3.5 w-3.5" />}
                </button>

                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-baseline">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono tabular-nums">{item.timeWindow}</span>
                        <span aria-hidden="true">·</span>
                        <span>{CATEGORY_LABELS[item.category]}</span>
                      </div>
                      <h3
                        className={`mt-1 text-base font-semibold ${
                          isDone
                            ? 'text-slate-500 line-through dark:text-slate-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {item.title}
                      </h3>
                    </div>

                    <div className="shrink-0 font-mono text-xs font-semibold tabular-nums text-teal-700 dark:text-teal-400">
                      {item.directImpactLabel}
                    </div>
                  </div>

                  <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
                    {item.actionSteps.map((step, sIdx) => (
                      <li key={sIdx} className="flex items-start gap-2">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400 dark:bg-slate-600" />
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Choice -> Mechanism -> Direct Impact Explanation */}
                  <div className="grid grid-cols-1 gap-3 border-t border-slate-200 pt-3 text-xs dark:border-slate-800 md:grid-cols-3">
                    <div>
                      <span className="font-medium text-slate-500 dark:text-slate-400">
                        Sustainable Choice
                      </span>
                      <p className="mt-0.5 text-slate-800 dark:text-slate-200">
                        {item.choiceSummary}
                      </p>
                    </div>
                    <div>
                      <span className="font-medium text-slate-500 dark:text-slate-400">
                        Why It Works
                      </span>
                      <p className="mt-0.5 text-slate-700 dark:text-slate-300">
                        {item.mechanismExplanation}
                      </p>
                    </div>
                    <div>
                      <span className="font-medium text-slate-500 dark:text-slate-400">
                        Quantified Impact
                      </span>
                      <p className="mt-0.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        -{item.estimatedPm25DropPct}% exposure ·{' '}
                        {item.estimatedCo2SavedGrams > 0
                          ? `${item.estimatedCo2SavedGrams}g CO₂e avoided`
                          : 'Zero-emission indoor shield'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};
