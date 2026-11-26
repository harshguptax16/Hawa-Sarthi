import React, { useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Download,
  Layers,
  Upload,
  Volume2,
  Wrench,
} from 'lucide-react';
import type {
  DiyBlueprintResult,
  DiyDesignType,
  HouseholdProfile,
  VisionDiagnosticResult,
} from '../types.ts';

interface IndoorLabViewProps {
  city: string;
  profile: HouseholdProfile;
  onSpeakBriefing: (text: string) => void;
}

const DIY_PRESETS: Array<{ id: DiyDesignType; label: string; summary: string }> = [
  {
    id: 'corsiRosenthal',
    label: 'Corsi-Rosenthal 4-Filter Cube',
    summary: 'Box fan + 4 pleated MERV-13/HEPA panels for high-CADR living rooms',
  },
  {
    id: 'singleBoxFan',
    label: 'Single Box-Fan HEPA Build',
    summary: 'Compact 1-filter taped shroud ideal for bedrooms & study desks',
  },
  {
    id: 'wetMeshDraftTrap',
    label: 'Wet-Mesh Window Draft Trap',
    summary: 'Zero-electronics damp cotton/coir mesh barrier for leaky window sills',
  },
  {
    id: 'kitchenBaffle',
    label: 'Kitchen Exhaust & Oil-Mist Baffle',
    summary: 'Cross-draft window exhaust setup to purge cooking PM2.5 rapidly',
  },
];

const SchematicDiagram: React.FC<{ blueprint: DiyBlueprintResult }> = ({ blueprint }) => {
  const { designType, blueprintName, estimatedCadrCfm, estimatedPm25CapturePct } = blueprint;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>Engineering Airflow Schematic</span>
        <span className="font-mono tabular-nums">
          {estimatedCadrCfm} CFM · {estimatedPm25CapturePct}% PM2.5 capture
        </span>
      </div>

      <svg
        id="diy-blueprint-svg"
        viewBox="0 0 640 320"
        className="h-auto w-full rounded border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        role="img"
        aria-label={`Technical schematic for ${blueprintName}`}
      >
        <defs>
          <marker
            id="arrowClean"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#0d9488" />
          </marker>
          <marker
            id="arrowSmog"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#d97706" />
          </marker>
          <pattern id="gridPattern" width="24" height="24" patternUnits="userSpaceOnUse">
            <path
              d="M 24 0 L 0 0 0 24"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.06"
              strokeWidth="1"
            />
          </pattern>
        </defs>

        <rect width="640" height="320" fill="url(#gridPattern)" className="text-slate-500" />

        {/* Schematic Frame */}
        <rect
          x="16"
          y="16"
          width="608"
          height="288"
          rx="6"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.18"
          className="text-slate-400"
        />

        {designType === 'corsiRosenthal' && (
          <g>
            {/* Cube Filters */}
            <rect
              x="210"
              y="105"
              width="220"
              height="145"
              rx="4"
              fill="#0d9488"
              fillOpacity="0.08"
              stroke="#0d9488"
              strokeWidth="2"
            />
            {/* Pleat lines */}
            {[230, 250, 270, 290, 310, 330, 350, 370, 390, 410].map((x) => (
              <line
                key={x}
                x1={x}
                y1="112"
                x2={x}
                y2="242"
                stroke="#0d9488"
                strokeOpacity="0.35"
                strokeWidth="1.5"
              />
            ))}
            {/* Top Box Fan Shroud */}
            <rect
              x="220"
              y="78"
              width="200"
              height="26"
              rx="3"
              fill="#334155"
              stroke="#0f172a"
              strokeWidth="1.5"
            />
            <text x="320" y="95" textAnchor="middle" fill="#f8fafc" fontSize="11" fontFamily="monospace">
              UPWARD BOX FAN (SEALED CORNERS)
            </text>
            {/* Bottom Cardboard Base */}
            <rect x="206" y="250" width="228" height="12" rx="2" fill="#94a3b8" />
            <text x="320" y="278" textAnchor="middle" className="fill-slate-600 dark:fill-slate-400" fontSize="11" fontFamily="monospace">
              4x MERV-13 / HEPA PLEATED PANELS + SEALED BASE
            </text>
            {/* Intake Arrows */}
            <line x1="120" y1="150" x2="200" y2="150" stroke="#d97706" strokeWidth="2.5" markerEnd="url(#arrowSmog)" />
            <line x1="120" y1="205" x2="200" y2="205" stroke="#d97706" strokeWidth="2.5" markerEnd="url(#arrowSmog)" />
            <line x1="520" y1="150" x2="440" y2="150" stroke="#d97706" strokeWidth="2.5" markerEnd="url(#arrowSmog)" />
            <line x1="520" y1="205" x2="440" y2="205" stroke="#d97706" strokeWidth="2.5" markerEnd="url(#arrowSmog)" />
            {/* Clean Output Arrows */}
            <line x1="270" y1="74" x2="270" y2="32" stroke="#0d9488" strokeWidth="2.5" markerEnd="url(#arrowClean)" />
            <line x1="320" y1="74" x2="320" y2="26" stroke="#0d9488" strokeWidth="2.5" markerEnd="url(#arrowClean)" />
            <line x1="370" y1="74" x2="370" y2="32" stroke="#0d9488" strokeWidth="2.5" markerEnd="url(#arrowClean)" />
          </g>
        )}

        {designType === 'singleBoxFan' && (
          <g>
            {/* Filter Media */}
            <rect x="240" y="95" width="38" height="150" fill="#0d9488" fillOpacity="0.15" stroke="#0d9488" strokeWidth="2" />
            {/* Spacer Shroud */}
            <rect x="278" y="95" width="44" height="150" fill="#64748b" fillOpacity="0.12" stroke="#64748b" strokeWidth="1.5" strokeDasharray="4 3" />
            {/* Box Fan */}
            <rect x="322" y="95" width="42" height="150" rx="3" fill="#334155" stroke="#0f172a" strokeWidth="1.5" />
            <text x="259" y="268" textAnchor="middle" className="fill-slate-600 dark:fill-slate-400" fontSize="10" fontFamily="monospace">
              HEPA FILTER
            </text>
            <text x="343" y="268" textAnchor="middle" className="fill-slate-600 dark:fill-slate-400" fontSize="10" fontFamily="monospace">
              FAN OUTFLOW
            </text>
            <line x1="130" y1="135" x2="230" y2="135" stroke="#d97706" strokeWidth="2.5" markerEnd="url(#arrowSmog)" />
            <line x1="130" y1="170" x2="230" y2="170" stroke="#d97706" strokeWidth="2.5" markerEnd="url(#arrowSmog)" />
            <line x1="130" y1="205" x2="230" y2="205" stroke="#d97706" strokeWidth="2.5" markerEnd="url(#arrowSmog)" />
            <line x1="372" y1="135" x2="495" y2="135" stroke="#0d9488" strokeWidth="2.5" markerEnd="url(#arrowClean)" />
            <line x1="372" y1="170" x2="510" y2="170" stroke="#0d9488" strokeWidth="2.5" markerEnd="url(#arrowClean)" />
            <line x1="372" y1="205" x2="495" y2="205" stroke="#0d9488" strokeWidth="2.5" markerEnd="url(#arrowClean)" />
          </g>
        )}

        {designType === 'wetMeshDraftTrap' && (
          <g>
            {/* Window Frame */}
            <rect x="290" y="60" width="24" height="200" fill="#475569" />
            {/* Damp Cotton / Coir Mesh */}
            <rect x="314" y="75" width="22" height="170" fill="#0d9488" fillOpacity="0.22" stroke="#0d9488" strokeWidth="2" />
            {/* Water Tray */}
            <rect x="296" y="245" width="58" height="16" rx="2" fill="#0284c7" fillOpacity="0.3" stroke="#0284c7" strokeWidth="1.5" />
            <text x="325" y="280" textAnchor="middle" className="fill-slate-600 dark:fill-slate-400" fontSize="11" fontFamily="monospace">
              SEALED WINDOW SILL + DAMP COTTON / COIR MESH + TRAY
            </text>
            <line x1="140" y1="125" x2="280" y2="125" stroke="#d97706" strokeWidth="2.5" markerEnd="url(#arrowSmog)" />
            <line x1="140" y1="175" x2="280" y2="175" stroke="#d97706" strokeWidth="2.5" markerEnd="url(#arrowSmog)" />
            <line x1="346" y1="125" x2="490" y2="125" stroke="#0d9488" strokeWidth="2.5" markerEnd="url(#arrowClean)" />
            <line x1="346" y1="175" x2="490" y2="175" stroke="#0d9488" strokeWidth="2.5" markerEnd="url(#arrowClean)" />
          </g>
        )}

        {designType === 'kitchenBaffle' && (
          <g>
            {/* Stove Burner */}
            <rect x="170" y="210" width="120" height="36" rx="3" fill="#475569" />
            {/* Steam/Oil Plume */}
            <path d="M 230 205 Q 245 150 310 120" fill="none" stroke="#d97706" strokeWidth="2.5" markerEnd="url(#arrowSmog)" />
            <path d="M 210 205 Q 225 140 310 105" fill="none" stroke="#d97706" strokeWidth="2.5" markerEnd="url(#arrowSmog)" />
            {/* Window Exhaust Fan */}
            <rect x="430" y="75" width="32" height="110" rx="3" fill="#334155" stroke="#0d9488" strokeWidth="2" />
            <line x1="330" y1="125" x2="422" y2="125" stroke="#d97706" strokeWidth="2.5" markerEnd="url(#arrowSmog)" />
            <line x1="468" y1="125" x2="555" y2="125" stroke="#0d9488" strokeWidth="2.5" markerEnd="url(#arrowClean)" />
            <text x="320" y="275" textAnchor="middle" className="fill-slate-600 dark:fill-slate-400" fontSize="11" fontFamily="monospace">
              LIDDED COOKING + DIRECT EXHAUST PUSH (AVOIDS PM2.5 SPIKE)
            </text>
          </g>
        )}

        {/* Legend */}
        <text x="34" y="42" fill="#d97706" fontSize="11" fontFamily="monospace" fontWeight="600">
          ● PM2.5 LADEN AIR INTAKE
        </text>
        <text x="34" y="60" fill="#0d9488" fontSize="11" fontFamily="monospace" fontWeight="600">
          ● FILTERED / PURGED AIRFLOW
        </text>
      </svg>
    </div>
  );
};

export const IndoorLabView: React.FC<IndoorLabViewProps> = ({
  city,
  profile,
  onSpeakBriefing,
}) => {
  // Photo Diagnostic State
  const [sceneType, setSceneType] = useState('Indoor Room & Window Seals');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<VisionDiagnosticResult | null>(null);

  // DIY Purifier Blueprint State
  const [designType, setDesignType] = useState<DiyDesignType>('corsiRosenthal');
  const [roomSize, setRoomSize] = useState('Medium Bedroom (160 sq ft)');
  const [budgetNote, setBudgetNote] = useState('Standard hardware store materials');
  const [generatingDiy, setGeneratingDiy] = useState(false);
  const [diyError, setDiyError] = useState<string | null>(null);
  const [blueprint, setBlueprint] = useState<DiyBlueprintResult | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setPhotoError('Please choose an image smaller than 10 MB.');
      return;
    }
    setPhotoError(null);
    setImageMime(file.type || 'image/jpeg');
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      setPreviewUrl(result);
      const commaIndex = result.indexOf(',');
      setImageBase64(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  };

  const runPhotoDiagnostic = async () => {
    if (!imageBase64) return;
    setAnalyzingPhoto(true);
    setPhotoError(null);
    try {
      const res = await fetch('/api/analyze-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mimeType: imageMime,
          sceneType,
          city,
          profile,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Photo analysis failed.');
      setDiagnostic(data);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Unable to analyze photo.');
    } finally {
      setAnalyzingPhoto(false);
    }
  };

  const generateDiyBlueprint = async () => {
    setGeneratingDiy(true);
    setDiyError(null);
    try {
      const res = await fetch('/api/diy-diagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          designType,
          roomSize,
          city,
          budgetNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Blueprint generation failed.');
      setBlueprint(data);
    } catch (err) {
      setDiyError(err instanceof Error ? err.message : 'Unable to generate DIY schematic.');
    } finally {
      setGeneratingDiy(false);
    }
  };

  const downloadSchematicSvg = () => {
    const svgEl = document.getElementById('diy-blueprint-svg');
    if (!svgEl || !blueprint) return;
    const serialized = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${blueprint.designType}-schematic.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* 1. Room & Smog Photo Diagnostics */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Camera className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                <span>Multimodal Vision Inspector</span>
              </div>
              <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                Room &amp; Smog Photo Diagnostics
              </h2>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="scene-focus-select"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
              >
                What is in the photo?
              </label>
              <select
                id="scene-focus-select"
                value={sceneType}
                onChange={(e) => setSceneType(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="Indoor Room & Window Seals">Indoor Room &amp; Window Seals</option>
                <option value="Kitchen Stove & Exhaust Setup">Kitchen Stove &amp; Exhaust Setup</option>
                <option value="Outdoor Street / Sky Haze">Outdoor Street / Sky Haze</option>
                <option value="Mask or Air Purifier Placement">Mask or Air Purifier Placement</option>
              </select>
            </div>

            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-4 py-6 text-center transition-colors hover:border-teal-600 dark:border-slate-700 dark:bg-slate-950/70 dark:hover:border-teal-400">
              <Upload className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              <span className="mt-2 text-xs font-medium text-slate-700 dark:text-slate-200">
                Upload a photo of your room, window gap, kitchen, or outdoor sky
              </span>
              <span className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                JPEG, PNG, or WebP up to 10 MB
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>

            {previewUrl && (
              <div className="space-y-3">
                <img
                  src={previewUrl}
                  alt="Uploaded space for air quality diagnostic"
                  referrerPolicy="no-referrer"
                  className="max-h-56 w-full rounded-lg border border-slate-200 object-cover dark:border-slate-800"
                />
                <button
                  type="button"
                  onClick={runPhotoDiagnostic}
                  disabled={analyzingPhoto}
                  className="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
                >
                  {analyzingPhoto ? 'Inspecting Airflow & Particulate Risks...' : 'Run GenAI Photo Diagnostic'}
                </button>
              </div>
            )}

            {photoError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{photoError}</span>
              </div>
            )}

            {diagnostic && (
              <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Risk Rating: <strong className="text-slate-900 dark:text-slate-100">{diagnostic.riskRating}</strong>
                      <span className="mx-1.5" aria-hidden="true">·</span>
                      Est. indoor PM2.5 drop:{' '}
                      <strong className="font-mono tabular-nums text-teal-700 dark:text-teal-400">
                        -{diagnostic.expectedPm25ReductionPct}%
                      </strong>
                    </div>
                    <p className="mt-1 text-sm text-slate-800 dark:text-slate-200">
                      {diagnostic.sceneSummary}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onSpeakBriefing(
                        `Photo inspection complete. ${diagnostic.sceneSummary}. Top fix: ${diagnostic.indoorHacks[0]?.title ?? ''} — ${diagnostic.indoorHacks[0]?.steps ?? ''}`
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Volume2 className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                    <span>Listen</span>
                  </button>
                </div>

                {diagnostic.detectedHazards.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Detected Hazards
                    </div>
                    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                      {diagnostic.detectedHazards.map((h, i) => (
                        <div key={i} className="p-3 text-xs">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {h.hazard} ({h.severity})
                          </div>
                          <p className="mt-0.5 text-slate-600 dark:text-slate-400">{h.whyItMatters}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {diagnostic.indoorHacks.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Prioritized Low-Cost Fixes
                    </div>
                    <div className="space-y-2">
                      {diagnostic.indoorHacks.map((hack, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {hack.title}
                            </span>
                            <span className="font-mono text-slate-500 dark:text-slate-400">
                              {hack.estimatedCost}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-700 dark:text-slate-300">{hack.steps}</p>
                          <p className="mt-1 font-medium text-teal-700 dark:text-teal-400">
                            Direct Impact: {hack.directImpact}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  <strong className="text-slate-900 dark:text-slate-100">Mask / Ventilation Note: </strong>
                  {diagnostic.maskOrVentilationTip}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 2. DIY Air-Purifier & Filter Blueprint Studio */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Wrench className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                <span>Engineering Blueprint Generator</span>
              </div>
              <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                DIY Air-Purifier &amp; Filter Schematic Studio
              </h2>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DIY_PRESETS.map((preset) => {
                const active = designType === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setDesignType(preset.id)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? 'border-teal-600 bg-teal-50/60 dark:border-teal-400 dark:bg-teal-950/40'
                        : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {preset.label}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {preset.summary}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="diy-room-size"
                  className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Target Room Size
                </label>
                <select
                  id="diy-room-size"
                  value={roomSize}
                  onChange={(e) => setRoomSize(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="Small Bedroom (120 sq ft)">Small Bedroom (120 sq ft)</option>
                  <option value="Medium Bedroom (160 sq ft)">Medium Bedroom (160 sq ft)</option>
                  <option value="Living Room (280 sq ft)">Living Room (280 sq ft)</option>
                  <option value="Community Classroom (500 sq ft)">Classroom / Hall (500 sq ft)</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="diy-budget-note"
                  className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Material Availability
                </label>
                <input
                  id="diy-budget-note"
                  type="text"
                  value={budgetNote}
                  onChange={(e) => setBudgetNote(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={generateDiyBlueprint}
              disabled={generatingDiy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
            >
              <Layers className="h-3.5 w-3.5" />
              <span>{generatingDiy ? 'Synthesizing Engineering Schematic...' : 'Generate DIY Schematic & Spec'}</span>
            </button>

            {diyError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{diyError}</span>
              </div>
            )}

            {blueprint && (
              <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      {blueprint.blueprintName}
                    </h3>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {blueprint.roomTarget} · Est. cost: {blueprint.estimatedCostLocal}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={downloadSchematicSvg}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Save SVG</span>
                  </button>
                </div>

                <SchematicDiagram blueprint={blueprint} />

                <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  <strong className="text-slate-900 dark:text-slate-100">Airflow Mechanism: </strong>
                  {blueprint.airflowMechanism}
                </p>

                {/* Materials Table */}
                <div>
                  <div className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Bill of Materials
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2 font-medium">Component</th>
                          <th className="px-3 py-2 font-medium">Spec</th>
                          <th className="px-3 py-2 text-right font-medium">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {blueprint.materials.map((m, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                              {m.item}
                            </td>
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{m.spec}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                              {m.quantity}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Assembly Steps */}
                <div>
                  <div className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Assembly &amp; Placement
                  </div>
                  <ol className="list-decimal space-y-1 pl-4 text-xs text-slate-700 dark:text-slate-300">
                    {blueprint.assemblySteps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ol>
                  <p className="mt-2 text-xs text-teal-700 dark:text-teal-400">
                    <strong>Direct Impact: </strong>
                    {blueprint.impactSummary}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
