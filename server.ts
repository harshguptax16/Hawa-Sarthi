import dotenv from 'dotenv';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  Type,
  type LiveServerMessage,
} from '@google/genai';
import type {
  AqiBriefing,
  ChatbotRoleId,
  CommunityActionCard,
  DiyBlueprintResult,
  DiyDesignType,
  GroundedSource,
  HouseholdProfile,
  MapsPlaceChunk,
  RoutinePlan,
  VisionDiagnosticResult,
} from './src/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is missing or unconfigured. Add your key in the Settings > Secrets panel.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isClientError =
        msg.includes('400') ||
        msg.includes('403') ||
        msg.includes('404') ||
        msg.includes('API_KEY_INVALID') ||
        msg.includes('PERMISSION_DENIED');
      if (isClientError || attempt === maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw lastError;
}

function formatApiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return {
      status: 403,
      message:
        'Gemini API access failed. Please verify your API key in the Settings > Secrets panel.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message:
        'Gemini rate limit reached. Please wait a moment and try again, or review your quota in Settings > Secrets.',
    };
  }
  if (raw.includes('GEMINI_API_KEY is missing')) {
    return { status: 500, message: raw };
  }
  return { status: 500, message: raw || 'Unexpected server error communicating with Gemini.' };
}

function extractGroundingSources(response: unknown): GroundedSource[] {
  const r = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: { uri?: string; title?: string };
        }>;
      };
    }>;
  };
  const chunks = r?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: GroundedSource[] = [];
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    const title = chunk?.web?.title;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      sources.push({
        uri,
        title: title || new URL(uri).hostname,
      });
    }
  }
  return sources.slice(0, 6);
}

function describeProfile(profile: HouseholdProfile): string {
  const flags: string[] = [];
  if (profile.youngChildren) flags.push('young children');
  if (profile.seniors) flags.push('elderly seniors (65+)');
  if (profile.asthmaOrRespiratory) flags.push('asthma or respiratory sensitivity');
  if (profile.pregnant) flags.push('pregnant family member');
  const sensitiveText = flags.length > 0 ? flags.join(', ') : 'general healthy adults';
  return `Sensitive members: ${sensitiveText}. Commute: ${profile.commuteMode}. Home ventilation: ${profile.ventilationType}. Cooking fuel: ${profile.cookingFuel}. Preferred language: ${profile.language === 'hi' ? 'Hindi/Hinglish clarity with English terms' : 'Clear English'}.`;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '20mb' }));

  const briefingCache = new Map<string, { expiresAt: number; data: AqiBriefing }>();

  // 1. Live Grounded AQI & Winter Smog Briefing (Google Search Grounding + Structured Structuring)
  app.post('/api/aqi-briefing', async (req, res) => {
    try {
      const { city, profile } = req.body as {
        city?: string;
        profile?: HouseholdProfile;
      };
      if (!city || !city.trim()) {
        return res.status(400).json({ error: 'City name is required.' });
      }
      const cleanCity = city.trim();
      const profileSummary = profile ? describeProfile(profile) : 'General family household.';
      const cacheKey = `${cleanCity.toLowerCase()}::${profileSummary}`;
      const cached = briefingCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(cached.data);
      }

      const ai = getAiClient();

      // Step A: Grounded live search for current AQI, PM2.5, PM10, weather/wind/inversion
      const searchResponse = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Find the latest air quality index (AQI), PM2.5 (µg/m³), PM10 (µg/m³), weather temperature, wind speed, and winter smog / haze or pollution advisory today for ${cleanCity}. Include any local air pollution health advisories or peak traffic/inversion hours.`,
          config: {
            tools: [{ googleSearch: {} }],
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        })
      );

      const groundedText = searchResponse.text ?? '';
      const sources = extractGroundingSources(searchResponse);

      // Step B: Synthesize grounded context into clean structured telemetry & household windows
      const structuredResponse = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Based strictly on this grounded air quality report for ${cleanCity}, produce a structured household briefing.
Household context: ${profileSummary}
Grounded report:
${groundedText}`,
          config: {
            systemInstruction:
              'You are Hawa Sarthi, an urban air-quality and winter smog advisor. Extract real AQI/PM estimates when present in the grounded report (use null if genuinely unavailable rather than inventing numbers), classify severity accurately, explain thermal inversion/wind trapping clearly, and tailor the household alert to the family sensitivities. Use clean plain prose.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                aqiEstimate: { type: Type.NUMBER, nullable: true },
                pm25Estimate: { type: Type.NUMBER, nullable: true },
                pm10Estimate: { type: Type.NUMBER, nullable: true },
                severity: {
                  type: Type.STRING,
                  enum: ['Good', 'Moderate', 'Poor', 'Very Poor', 'Severe'],
                },
                headline: { type: Type.STRING },
                inversionContext: { type: Type.STRING },
                safeOutdoorWindow: { type: Type.STRING },
                householdAlert: { type: Type.STRING },
                hourlyWindows: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      timeLabel: { type: Type.STRING },
                      riskLevel: {
                        type: Type.STRING,
                        enum: ['Low', 'Elevated', 'High', 'Hazardous'],
                      },
                      guidance: { type: Type.STRING },
                    },
                    required: ['timeLabel', 'riskLevel', 'guidance'],
                  },
                },
              },
              required: [
                'severity',
                'headline',
                'inversionContext',
                'safeOutdoorWindow',
                'householdAlert',
                'hourlyWindows',
              ],
            },
          },
        })
      );

      const parsed = JSON.parse((structuredResponse.text ?? '{}').trim());
      const briefing: AqiBriefing = {
        cityName: cleanCity,
        updatedAt: new Date().toISOString(),
        aqiEstimate: typeof parsed.aqiEstimate === 'number' ? Math.round(parsed.aqiEstimate) : null,
        pm25Estimate: typeof parsed.pm25Estimate === 'number' ? Math.round(parsed.pm25Estimate) : null,
        pm10Estimate: typeof parsed.pm10Estimate === 'number' ? Math.round(parsed.pm10Estimate) : null,
        severity: parsed.severity ?? 'Poor',
        headline: parsed.headline ?? `Air quality briefing for ${cleanCity}`,
        inversionContext: parsed.inversionContext ?? groundedText.slice(0, 260),
        safeOutdoorWindow: parsed.safeOutdoorWindow ?? '1:00 PM – 4:00 PM (solar mixing peak)',
        householdAlert: parsed.householdAlert ?? 'Limit strenuous outdoor activity during early morning haze.',
        hourlyWindows: Array.isArray(parsed.hourlyWindows) ? parsed.hourlyWindows.slice(0, 4) : [],
        sources,
        rawSummary: groundedText,
      };

      briefingCache.set(cacheKey, {
        expiresAt: Date.now() + 5 * 60 * 1000,
        data: briefing,
      });

      res.json(briefing);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 2. Tailored Low-Emission Routine, Indoor Hacks & Direct Impact Plan
  app.post('/api/routine-plan', async (req, res) => {
    try {
      const { city, briefing, profile, focusArea } = req.body as {
        city?: string;
        briefing?: AqiBriefing | null;
        profile?: HouseholdProfile;
        focusArea?: string;
      };
      if (!city) {
        return res.status(400).json({ error: 'City is required.' });
      }
      const ai = getAiClient();
      const profileSummary = profile ? describeProfile(profile) : 'General urban household.';
      const aqiSummary = briefing
        ? `Current severity: ${briefing.severity} (AQI: ${briefing.aqiEstimate ?? 'unknown'}, PM2.5: ${briefing.pm25Estimate ?? 'unknown'} µg/m³). Safe window: ${briefing.safeOutdoorWindow}. ${briefing.inversionContext}`
        : `Severe winter urban smog conditions in ${city}.`;

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Create a practical, low-emission daily routine and indoor air quality plan for a family in ${city}.
Air Quality Context: ${aqiSummary}
Household Profile: ${profileSummary}
Focus Priority: ${focusArea || 'Balanced daily routines, indoor air hacks, sustainable swaps, and community habits'}

Generate 8 high-impact items spanning categories: 'routine', 'indoorHack', 'sustainableAlt', and 'communityAction' (2 per category).
For EVERY item:
- Provide a clear timeWindow (e.g., "06:30 – 08:30 AM", "12:30 – 03:00 PM", "06:00 – 09:00 PM", "Anytime Today").
- Provide 2-3 concise, actionable steps.
- Explain the direct impact clearly:
  - choiceSummary: The exact swap or choice made.
  - mechanismExplanation: Clear physical/biological explanation of WHY it works (e.g., avoiding morning boundary-layer inversion or trapping ultrafine cooking aerosols).
  - directImpactLabel: Concrete measurable takeaway (e.g., "~38% lower inhaled PM2.5 dose" or "Avoids 1.4 kg CO2 + 12g tailpipe PM").
  - estimatedPm25DropPct: realistic integer percentage (5 to 60) for personal exposure reduction or indoor drop.
  - estimatedCo2SavedGrams: realistic integer grams of CO2/emissions avoided (0 to 3500).`,
          config: {
            systemInstruction:
              'You are Hawa Sarthi, a practical winter-smog resilience planner. Every recommendation must be grounded in building physics, respiratory health, and urban emission science, tailored specifically to the user household profile and city.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                dailyStrategySummary: { type: Type.STRING },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      timeWindow: { type: Type.STRING },
                      category: {
                        type: Type.STRING,
                        enum: ['routine', 'indoorHack', 'sustainableAlt', 'communityAction'],
                      },
                      title: { type: Type.STRING },
                      actionSteps: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      choiceSummary: { type: Type.STRING },
                      mechanismExplanation: { type: Type.STRING },
                      directImpactLabel: { type: Type.STRING },
                      estimatedPm25DropPct: { type: Type.INTEGER },
                      estimatedCo2SavedGrams: { type: Type.INTEGER },
                    },
                    required: [
                      'id',
                      'timeWindow',
                      'category',
                      'title',
                      'actionSteps',
                      'choiceSummary',
                      'mechanismExplanation',
                      'directImpactLabel',
                      'estimatedPm25DropPct',
                      'estimatedCo2SavedGrams',
                    ],
                  },
                },
              },
              required: ['dailyStrategySummary', 'items'],
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim());
      const plan: RoutinePlan = {
        cityName: city,
        generatedAt: new Date().toISOString(),
        dailyStrategySummary:
          parsed.dailyStrategySummary ??
          `Tailored low-emission & indoor clean-air plan for ${city}.`,
        items: Array.isArray(parsed.items) ? parsed.items : [],
      };
      res.json(plan);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 3. Multimodal Room & Smog Photo Diagnostics (gemini-4-hydrogen Vision)
  app.post('/api/analyze-photo', async (req, res) => {
    try {
      const { imageBase64, mimeType, sceneType, city, profile } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        sceneType?: string;
        city?: string;
        profile?: HouseholdProfile;
      };
      if (!imageBase64 || !mimeType) {
        return res.status(400).json({ error: 'An image file is required for analysis.' });
      }
      const ai = getAiClient();
      const profileSummary = profile ? describeProfile(profile) : 'Urban family home.';

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: imageBase64,
                },
              },
              {
                text: `Analyze this uploaded image in the context of winter smog and air quality in ${city || 'an urban city'}.
Scene focus selected by user: ${sceneType || 'Indoor room or outdoor smog check'}.
Household context: ${profileSummary}

Inspect visible details:
- If indoor: look for window/door frame gaps, curtains, AC vents, kitchen exhaust/stove smoke, incense/candles, clutter/carpets trapping dust, purifier or fan placement, or indoor plants.
- If outdoor/sky: assess visible haze/inversion density, nearby dust/traffic/burning risk, and immediate commute/mask precautions.
- If mask/filter: assess fit, valve vs non-valve, filter saturation, or seal integrity.

Return structured hazards, practical low-cost/zero-cost indoor or immediate hacks, direct impact explanations, and an estimated PM2.5 reduction percentage achievable from the fixes.`,
              },
            ],
          },
          config: {
            systemInstruction:
              'You are Hawa Sarthi Visual Air Inspector. Be concrete, observational, and practical—reference what is visibly present in the photo without hallucinating invisible sensors.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                sceneSummary: { type: Type.STRING },
                riskRating: {
                  type: Type.STRING,
                  enum: ['Low', 'Moderate', 'High', 'Critical'],
                },
                detectedHazards: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      hazard: { type: Type.STRING },
                      severity: { type: Type.STRING },
                      whyItMatters: { type: Type.STRING },
                    },
                    required: ['hazard', 'severity', 'whyItMatters'],
                  },
                },
                indoorHacks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      steps: { type: Type.STRING },
                      directImpact: { type: Type.STRING },
                      estimatedCost: { type: Type.STRING },
                    },
                    required: ['title', 'steps', 'directImpact', 'estimatedCost'],
                  },
                },
                maskOrVentilationTip: { type: Type.STRING },
                expectedPm25ReductionPct: { type: Type.INTEGER },
              },
              required: [
                'sceneSummary',
                'riskRating',
                'detectedHazards',
                'indoorHacks',
                'maskOrVentilationTip',
                'expectedPm25ReductionPct',
              ],
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim()) as VisionDiagnosticResult;
      res.json(parsed);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 4. DIY Air-Purifier & Filter Blueprint Generator (gemini-4-hydrogen Structured Engineering Specs)
  app.post('/api/diy-diagram', async (req, res) => {
    try {
      const { designType, roomSize, city, budgetNote } = req.body as {
        designType?: DiyDesignType;
        roomSize?: string;
        city?: string;
        budgetNote?: string;
      };
      const ai = getAiClient();
      const selectedDesign: DiyDesignType = designType || 'corsiRosenthal';

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Design a practical DIY clean-air / PM2.5 filtration blueprint for a household in ${city || 'an urban smog city'}.
Design Type: ${selectedDesign}
Target Room: ${roomSize || 'Medium Bedroom (160 sq ft)'}
Budget / Context: ${budgetNote || 'Low-cost accessible household materials'}

Include realistic airflow CADR (CFM), expected PM2.5 capture percentage, local cost range, clear physical airflow mechanism, itemized bill of materials, concise step-by-step assembly instructions, optimal room placement rule, filter replacement schedule, and a clear direct health impact summary.`,
          config: {
            systemInstruction:
              'You are an indoor air-quality engineer advising families on safe, non-toxic, evidence-backed DIY filtration (Corsi-Rosenthal cubes, MERV-13/HEPA box fan builds, wet-mesh evaporative draft traps, and kitchen exhaust baffles). Never recommend ozone generators or unsafe electrical modifications.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                blueprintName: { type: Type.STRING },
                roomTarget: { type: Type.STRING },
                estimatedCadrCfm: { type: Type.INTEGER },
                estimatedPm25CapturePct: { type: Type.INTEGER },
                estimatedCostLocal: { type: Type.STRING },
                airflowMechanism: { type: Type.STRING },
                materials: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      item: { type: Type.STRING },
                      spec: { type: Type.STRING },
                      quantity: { type: Type.STRING },
                    },
                    required: ['item', 'spec', 'quantity'],
                  },
                },
                assemblySteps: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                placementRule: { type: Type.STRING },
                maintenanceSchedule: { type: Type.STRING },
                impactSummary: { type: Type.STRING },
              },
              required: [
                'blueprintName',
                'roomTarget',
                'estimatedCadrCfm',
                'estimatedPm25CapturePct',
                'estimatedCostLocal',
                'airflowMechanism',
                'materials',
                'assemblySteps',
                'placementRule',
                'maintenanceSchedule',
                'impactSummary',
              ],
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim());
      const result: DiyBlueprintResult = {
        ...parsed,
        designType: selectedDesign,
      };
      res.json(result);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 5. Community Clean-Air Actions Generator
  app.post('/api/community-actions', async (req, res) => {
    try {
      const { city, severity } = req.body as { city?: string; severity?: string };
      const ai = getAiClient();

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Generate 4 high-impact neighborhood & community clean-air initiatives tailored for residents of ${city || 'an urban city'} experiencing ${severity || 'winter smog'} air quality.
Include:
1. School-run or office Carpool rotation
2. Leaf/waste burning prevention & local civic reporting
3. School / elder center clean-air classroom zone
4. Community sustainable cooking/heating or dust-suppression drive

Each item must include collectiveImpact (quantified neighborhood effect) and a ready-to-paste WhatsApp/neighborhood group shareableMessage.`,
          config: {
            systemInstruction:
              'You are Hawa Sarthi Community Coordinator. Write empathetic, actionable, non-confrontational neighborhood initiatives that families can actually organize this week.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  category: {
                    type: Type.STRING,
                    enum: ['Carpool', 'Zero-Burn', 'School Zone', 'Clean Heating'],
                  },
                  description: { type: Type.STRING },
                  collectiveImpact: { type: Type.STRING },
                  shareableMessage: { type: Type.STRING },
                },
                required: [
                  'id',
                  'title',
                  'category',
                  'description',
                  'collectiveImpact',
                  'shareableMessage',
                ],
              },
            },
          },
        })
      );

      const actions = JSON.parse((response.text ?? '[]').trim()) as CommunityActionCard[];
      res.json({ actions });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 6. Voice Briefing Synthesis (gemini-3.8-flash-lite-tts returning WAV)
  app.post('/api/voice-briefing', async (req, res) => {
    try {
      const { scriptText, voiceName, language } = req.body as {
        scriptText?: string;
        voiceName?: string;
        language?: 'en' | 'hi';
      };
      if (!scriptText || !scriptText.trim()) {
        return res.status(400).json({ error: 'Briefing script text is required.' });
      }
      const ai = getAiClient();
      const selectedVoice = voiceName === 'Puck' ? 'Puck' : 'Kore';
      const styleNote =
        language === 'hi'
          ? 'Warm, calm, reassuring family advisor speaking clearly with gentle pacing for elders and parents'
          : 'Clear, warm, reassuring community health advisor with steady pacing';

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: scriptText.trim().slice(0, 2200),
                  speechMetadata: {
                    style: styleNote,
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: selectedVoice },
              },
            },
          },
        })
      );

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        return res.status(502).json({ error: 'Audio synthesis did not return audio data.' });
      }
      res.json({
        audioDataUrl: `data:audio/wav;base64,${base64Audio}`,
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 7. Voice Ask: Transcribe Microphone Audio (gemini-3.5-transcribe) + Grounded Response
  app.post('/api/voice-ask', async (req, res) => {
    try {
      const { audioBase64, mimeType, city, profile, briefingSummary } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        city?: string;
        profile?: HouseholdProfile;
        briefingSummary?: string;
      };
      if (!audioBase64 || !mimeType) {
        return res.status(400).json({ error: 'Recorded audio is required.' });
      }
      const ai = getAiClient();

      const transcribeRes = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-3.5-transcribe',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: audioBase64,
                },
              },
              {
                text: 'Transcribe this spoken question accurately in its spoken language (English or Hindi/Hinglish). Return only the transcript.',
              },
            ],
          },
        })
      );

      const transcript = (transcribeRes.text ?? '').trim();
      if (!transcript) {
        return res.status(400).json({ error: 'Could not detect clear speech in the recording.' });
      }

      const profileSummary = profile ? describeProfile(profile) : 'Urban family.';
      const answerRes = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `User spoken question: "${transcript}"
City: ${city || 'Delhi'}
Current AQI Summary: ${briefingSummary || 'Winter smog conditions'}
Household Profile: ${profileSummary}

Give a concise, empathetic, practical answer in 3-4 sentences explaining both what to do and the direct health or emission impact.`,
          config: {
            tools: [{ googleSearch: {} }],
            systemInstruction:
              'You are Hawa Sarthi, a calm winter-smog voice companion for families and seniors. Always answer clearly without jargon and explain the direct impact of the choice.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        })
      );

      res.json({
        transcript,
        answer: answerRes.text ?? 'No response generated.',
        sources: extractGroundingSources(answerRes),
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 8. Streaming GenAI Assistant Chat (SSE)
  app.post('/api/chat', async (req, res) => {
    try {
      const { message, city, profile, briefingSummary, history } = req.body as {
        message?: string;
        city?: string;
        profile?: HouseholdProfile;
        briefingSummary?: string;
        history?: Array<{ role: 'user' | 'assistant'; text: string }>;
      };
      if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message is required.' });
      }

      const ai = getAiClient();
      const profileSummary = profile ? describeProfile(profile) : 'Urban family.';

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const priorContext = (history ?? [])
        .slice(-6)
        .map((m) => `${m.role === 'user' ? 'Family' : 'Hawa Sarthi'}: ${m.text}`)
        .join('\n');

      const prompt = `${priorContext ? `Recent conversation:\n${priorContext}\n\n` : ''}City: ${city || 'New Delhi'}
Air Quality Context: ${briefingSummary || 'Winter smog season'}
Household Profile: ${profileSummary}
Current Question: ${message.trim()}

Answer practically with low-emission alternatives, indoor hacks, and a clear 1-line "Direct Impact" explanation.`;

      const stream = await ai.models.generateContentStream({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          systemInstruction:
            'You are Hawa Sarthi, an expert yet warm family & community clean-air guide. Tailor every response to the user city, household sensitivities, and winter smog physics. Always highlight the direct measurable impact of suggested choices.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const collectedSources: GroundedSource[] = [];
      const seenUris = new Set<string>();

      for await (const chunk of stream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk.text })}\n\n`);
        }
        const chunkSources = extractGroundingSources(chunk);
        for (const s of chunkSources) {
          if (!seenUris.has(s.uri)) {
            seenUris.add(s.uri);
            collectedSources.push(s);
          }
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'done', sources: collectedSources })}\n\n`);
      res.end();
    } catch (err) {
      const { message } = formatApiError(err);
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`);
        res.end();
      }
    }
  });

  // 9. Multi-Turn Role-Based Gemini Chatbot (ai.chats.create + model tier routing)
  app.post('/api/chatbot', async (req, res) => {
    try {
      const { message, roleId, city, profile, briefingSummary, history } = req.body as {
        message?: string;
        roleId?: ChatbotRoleId;
        city?: string;
        profile?: HouseholdProfile;
        briefingSummary?: string;
        history?: Array<{ role: 'user' | 'assistant'; text: string }>;
      };

      if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message is required.' });
      }

      const ROLE_CONFIG: Record<
        ChatbotRoleId,
        { model: string; roleName: string; systemInstruction: string }
      > = {
        fastTriage: {
          model: 'gemini-3.1-flash-lite',
          roleName: 'Fast Smog Triage',
          systemInstruction:
            'You are Hawa Sarthi Fast Triage (powered by gemini-3.1-flash-lite). Give crisp, immediate, practical winter-smog answers in 3-5 short bullet points covering mask grade, safe timing, and direct exposure impact.',
        },
        familyGuide: {
          model: 'gemini-4-hydrogen',
          roleName: 'Family Clean-Air Guide',
          systemInstruction:
            'You are Hawa Sarthi Family Guide (powered by gemini-4-hydrogen). Help families plan low-emission daily routines, indoor air quality hacks, and sustainable swaps tailored to children, elders, and respiratory sensitivities, always explaining the direct impact.',
        },
        complexStrategist: {
          model: 'gemini-4-neon',
          roleName: 'Interactive Exposure Strategist',
          systemInstruction:
            'You are Hawa Sarthi Exposure Strategist (powered by gemini-4-neon). Build interactive multi-step trade-off plans balancing commute emissions, CADR filtration math, kitchen ventilation, and community action with clear quantitative reasoning.',
        },
        deepAnalyst: {
          model: 'gemini-4-carbon',
          roleName: 'Deep Atmospheric & Building Analyst',
          systemInstruction:
            'You are Hawa Sarthi Deep Atmospheric Analyst (powered by gemini-4-carbon). Provide rigorous first-principles analysis of boundary-layer thermal inversions, PM2.5/NOx chemistry, HEPA fluid dynamics, and community-scale emission abatement.',
        },
      };

      const selectedRole = ROLE_CONFIG[roleId ?? 'familyGuide'] ?? ROLE_CONFIG.familyGuide;
      const ai = getAiClient();
      const profileSummary = profile ? describeProfile(profile) : 'General urban household.';

      const chatHistory = (history ?? [])
        .filter((m) => m.text && m.text.trim().length > 0)
        .slice(-12)
        .map((m) => ({
          role: m.role === 'user' ? ('user' as const) : ('model' as const),
          parts: [{ text: m.text }],
        }));

      const fullSystemInstruction = `${selectedRole.systemInstruction}
Active City: ${city || 'New Delhi'}
Current Air Quality Context: ${briefingSummary || 'Winter smog season'}
Household Profile: ${profileSummary}`;

      const chat = ai.chats.create({
        model: selectedRole.model,
        history: chatHistory,
        config: {
          systemInstruction: fullSystemInstruction,
        },
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const stream = await chat.sendMessageStream({
        message: message.trim(),
      });

      for await (const chunk of stream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk.text })}\n\n`);
        }
      }

      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          model: selectedRole.model,
          roleName: selectedRole.roleName,
        })}\n\n`
      );
      res.end();
    } catch (err) {
      const { status, message } = formatApiError(err);
      if (!res.headersSent) {
        res.status(status).json({ error: message });
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`);
        res.end();
      }
    }
  });

  // 10. Google Maps Grounding (gemini-4-hydrogen with googleMaps tool)
  app.post('/api/maps-places', async (req, res) => {
    try {
      const { city, queryCategory, latLng } = req.body as {
        city?: string;
        queryCategory?: string;
        latLng?: { latitude: number; longitude: number } | null;
      };
      const cleanCity = (city || 'New Delhi').trim();
      const category = (queryCategory || 'metro stations and clean-air public libraries').trim();
      const ai = getAiClient();

      const prompt = `Find top real-world ${category} in or near ${cleanCity} that help families navigate severe winter smog (e.g., low-emission public transit hubs, indoor clean-air shelters/libraries, hardware stores for HEPA/MERV filters, or respiratory clinics). Summarize why each place helps reduce smog exposure or emissions.`;

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            tools: [{ googleMaps: {} }],
            ...(latLng &&
            typeof latLng.latitude === 'number' &&
            typeof latLng.longitude === 'number'
              ? {
                  toolConfig: {
                    retrievalConfig: {
                      latLng: {
                        latitude: latLng.latitude,
                        longitude: latLng.longitude,
                      },
                    },
                  },
                }
              : {}),
          },
        })
      );

      const rawChunks =
        (
          response.candidates?.[0]?.groundingMetadata?.groundingChunks as
            | Array<{
                maps?: {
                  uri?: string;
                  title?: string;
                  placeAnswerSources?: {
                    reviewSnippets?: Array<{ content?: string }>;
                  };
                };
              }>
            | undefined
        ) ?? [];

      const places: MapsPlaceChunk[] = [];
      const seenUris = new Set<string>();
      for (const chunk of rawChunks) {
        const uri = chunk?.maps?.uri;
        const title = chunk?.maps?.title;
        if (uri && !seenUris.has(uri)) {
          seenUris.add(uri);
          const snippets = (chunk.maps?.placeAnswerSources?.reviewSnippets ?? [])
            .map((s) => s.content)
            .filter((s): s is string => Boolean(s));
          places.push({
            title: title || 'View on Google Maps',
            uri,
            reviewSnippets: snippets.slice(0, 2),
          });
        }
      }

      res.json({
        summaryMarkdown: response.text ?? '',
        places,
        queryLabel: category,
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 10b. Google Maps Platform Proxy Endpoints (Air Quality API, AQI Heatmap Tiles, Places API New)
  const getMapsApiKey = () =>
    process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

  app.get('/api/gmp/client-config', (_req, res) => {
    const apiKey = getMapsApiKey();
    res.json({ apiKey, configured: Boolean(apiKey && apiKey !== 'MY_GOOGLE_MAPS_API_KEY') });
  });

  app.post('/api/gmp/air-quality', async (req, res) => {
    try {
      const mapsKey = getMapsApiKey();
      if (!mapsKey) {
        return res.status(500).json({ error: 'Google Maps API key is not configured.' });
      }
      const { latitude, longitude } = req.body as {
        latitude?: number;
        longitude?: number;
      };
      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
      }

      const upstream = await fetch(
        `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${encodeURIComponent(mapsKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
          },
          body: JSON.stringify({
            universalAqi: true,
            location: { latitude, longitude },
            extraComputations: [
              'HEALTH_RECOMMENDATIONS',
              'DOMINANT_POLLUTANT_CONCENTRATION',
              'POLLUTANT_CONCENTRATION',
              'LOCAL_AQI',
              'POLLUTANT_ADDITIONAL_INFO',
            ],
            languageCode: 'en',
          }),
        }
      );

      const data = await upstream.json();
      if (!upstream.ok) {
        const statusCode = upstream.status;
        if (statusCode === 403) {
          return res.status(200).json({
            error: data?.error?.message || 'Air Quality API is not enabled on this key.',
            status: 'PERMISSION_DENIED',
            indexes: [],
            pollutants: [],
          });
        }
        return res.status(statusCode).json({
          error: data?.error?.message || `Air Quality API error (${statusCode})`,
          status: data?.error?.status,
        });
      }

      res.json({
        dateTime: data.dateTime,
        regionCode: data.regionCode,
        indexes: data.indexes ?? [],
        pollutants: data.pollutants ?? [],
        healthRecommendations: data.healthRecommendations,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to fetch Google Maps Air Quality data.',
      });
    }
  });

  app.get('/api/gmp/aqi-tile/:mapType/:z/:x/:y', async (req, res) => {
    try {
      const mapsKey = getMapsApiKey();
      if (!mapsKey) {
        return res.status(500).end();
      }
      const allowedTypes = new Set([
        'US_AQI',
        'UAQI_RED_GREEN',
        'UAQI_INDIGO_PERSIAN',
        'PM25_INDIGO_PERSIAN',
        'IND_CPCB',
        'GBR_DEFRA',
        'DEU_UBA',
      ]);
      const mapType = allowedTypes.has(req.params.mapType) ? req.params.mapType : 'US_AQI';
      const z = Number(req.params.z);
      const x = Number(req.params.x);
      const y = Number(req.params.y);
      if (
        !Number.isInteger(z) ||
        z < 0 ||
        z > 16 ||
        !Number.isInteger(x) ||
        !Number.isInteger(y)
      ) {
        return res.status(400).end();
      }

      const upstream = await fetch(
        `https://airquality.googleapis.com/v1/mapTypes/${mapType}/heatmapTiles/${z}/${x}/${y}?key=${encodeURIComponent(mapsKey)}`,
        {
          headers: {
            'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
          },
        }
      );
      if (!upstream.ok) {
        return res.status(upstream.status).end();
      }
      const arrayBuf = await upstream.arrayBuffer();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(Buffer.from(arrayBuf));
    } catch {
      res.status(500).end();
    }
  });

  app.post('/api/gmp/places-search', async (req, res) => {
    try {
      const mapsKey = getMapsApiKey();
      if (!mapsKey) {
        return res.status(500).json({ error: 'Google Maps API key is not configured.' });
      }
      const { textQuery, latitude, longitude } = req.body as {
        textQuery?: string;
        latitude?: number;
        longitude?: number;
      };
      if (!textQuery || !textQuery.trim()) {
        return res.status(400).json({ error: 'Search query is required.' });
      }

      const body: Record<string, unknown> = {
        textQuery: textQuery.trim(),
        pageSize: 10,
        languageCode: 'en',
      };
      if (typeof latitude === 'number' && typeof longitude === 'number') {
        body.locationBias = {
          circle: {
            center: { latitude, longitude },
            radius: 12000.0,
          },
        };
      }

      const upstream = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': mapsKey,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.primaryTypeDisplayName,places.rating,places.userRatingCount',
          'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
        },
        body: JSON.stringify(body),
      });

      const data = await upstream.json();
      if (!upstream.ok) {
        const statusCode = upstream.status;
        return res.status(statusCode).json({
          error: data?.error?.message || `Places API error (${statusCode})`,
          status: data?.error?.status,
        });
      }

      const rawPlaces = Array.isArray(data.places) ? data.places : [];
      const places = rawPlaces
        .filter((p: { location?: { latitude?: number; longitude?: number } }) =>
          typeof p?.location?.latitude === 'number' && typeof p?.location?.longitude === 'number'
        )
        .map(
          (p: {
            id?: string;
            displayName?: { text?: string };
            formattedAddress?: string;
            location: { latitude: number; longitude: number };
            googleMapsUri?: string;
            primaryTypeDisplayName?: { text?: string };
            rating?: number;
            userRatingCount?: number;
          }) => ({
            id: p.id || `${p.location.latitude},${p.location.longitude}`,
            displayName: p.displayName?.text || 'Place',
            formattedAddress: p.formattedAddress || '',
            location: p.location,
            googleMapsUri: p.googleMapsUri,
            primaryTypeDisplayName: p.primaryTypeDisplayName?.text,
            rating: p.rating,
            userRatingCount: p.userRatingCount,
          })
        );

      res.json({ places });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to search places via Google Maps.',
      });
    }
  });

  // 11. Real-Time Live Voice Conversation Bridge (gemini-3.8-live via WebSocket /ws/live)
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/live' });

  wss.on('connection', (clientWs) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let sessionReadyPromise: Promise<void> | null = null;
    let clientClosed = false;

    const sendJson = (payload: Record<string, unknown>) => {
      if (!clientClosed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const startLiveSession = (setup: {
      city?: string;
      profile?: HouseholdProfile;
      voiceName?: string;
      briefingSummary?: string;
    }) => {
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore close errors on re-init
        }
        liveSession = null;
      }

      const ai = getAiClient();
      const allowedVoices = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);
      const voiceName =
        setup.voiceName && allowedVoices.has(setup.voiceName) ? setup.voiceName : 'Zephyr';
      const cityName = (setup.city || 'New Delhi').trim();
      const profileSummary = setup.profile
        ? describeProfile(setup.profile)
        : 'General urban family household.';
      const systemInstruction = `You are Hawa Sarthi, a calm, empathetic real-time voice advisor helping families and elders navigate winter smog and urban air pollution.
Active City: ${cityName}
Current Air Quality Context: ${setup.briefingSummary || 'Winter smog conditions'}
Household Profile: ${profileSummary}
Speak naturally and concisely (2-4 clear sentences per turn unless asked for more detail). Always give practical low-emission routines, indoor air hacks, or sustainable swaps and explain the direct measurable impact of the choice.`;

      sessionReadyPromise = (async () => {
        try {
          const session = await ai.live.connect({
            model: 'gemini-3.8-live',
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction,
            },
            callbacks: {
              onopen: () => {
                sendJson({ type: 'ready', model: 'gemini-3.8-live', voiceName });
              },
              onmessage: (message: LiveServerMessage) => {
                const content = message.serverContent;
                if (content?.inputTranscription?.text) {
                  sendJson({
                    type: 'inputTranscript',
                    text: content.inputTranscription.text,
                  });
                }
                if (content?.outputTranscription?.text) {
                  sendJson({
                    type: 'outputTranscript',
                    text: content.outputTranscription.text,
                  });
                }
                for (const part of content?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    sendJson({ type: 'audio', data: part.inlineData.data });
                  }
                }
                if (content?.interrupted) {
                  sendJson({ type: 'interrupted' });
                }
                if (content?.turnComplete) {
                  sendJson({ type: 'turnComplete' });
                }
              },
              onerror: (err: unknown) => {
                const { message } = formatApiError(err);
                sendJson({ type: 'error', error: message });
              },
              onclose: () => {
                if (!clientClosed) {
                  sendJson({ type: 'closed' });
                }
              },
            },
          });

          if (clientClosed) {
            try {
              session.close();
            } catch {
              // ignore
            }
            return;
          }
          liveSession = session;
        } catch (err) {
          const { message } = formatApiError(err);
          sendJson({ type: 'error', error: message });
        }
      })();
    };

    clientWs.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          city?: string;
          profile?: HouseholdProfile;
          voiceName?: string;
          briefingSummary?: string;
          data?: string;
          text?: string;
        };

        if (msg.type === 'setup') {
          startLiveSession(msg);
          return;
        }

        if (msg.type === 'audio' && msg.data) {
          if (!sessionReadyPromise) {
            startLiveSession({});
          }
          await sessionReadyPromise;
          if (liveSession && !clientClosed) {
            liveSession.sendRealtimeInput({
              audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
            });
          }
          return;
        }

        if (msg.type === 'text' && msg.text && msg.text.trim()) {
          if (!sessionReadyPromise) {
            startLiveSession({});
          }
          await sessionReadyPromise;
          if (liveSession && !clientClosed) {
            liveSession.sendRealtimeInput({ text: msg.text.trim() });
          }
        }
      } catch (err) {
        const { message } = formatApiError(err);
        sendJson({ type: 'error', error: message });
      }
    });

    clientWs.on('close', () => {
      clientClosed = true;
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore
        }
        liveSession = null;
      }
    });
  });

  // Mount Vite middlewares in development or static dist in production
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Hawa Sarthi server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
