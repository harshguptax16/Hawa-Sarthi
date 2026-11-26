export type ThemeMode = 'light' | 'dark';

export type WorkspaceTab = 'briefing' | 'routines' | 'lab' | '3d' | 'voice';

export type SeverityTier = 'Good' | 'Moderate' | 'Poor' | 'Very Poor' | 'Severe';

export interface CityPreset {
  id: string;
  name: string;
  region: string;
  country: string;
  seasonalNote: string;
  lat: number;
  lng: number;
}

export interface HouseholdProfile {
  youngChildren: boolean;
  seniors: boolean;
  asthmaOrRespiratory: boolean;
  pregnant: boolean;
  commuteMode: 'car' | 'twoWheeler' | 'publicTransit' | 'walkCycle' | 'workFromHome';
  ventilationType: 'sealedAC' | 'naturalWindows' | 'mixed';
  cookingFuel: 'lpg' | 'electricInduction' | 'solidBiomass';
  language: 'en' | 'hi';
}

export interface GroundedSource {
  title: string;
  uri: string;
}

export interface MapsPlaceChunk {
  title: string;
  uri: string;
  reviewSnippets?: string[];
}

export interface MapsPlacesResult {
  summaryMarkdown: string;
  places: MapsPlaceChunk[];
  queryLabel: string;
}

export interface HourlyWindow {
  timeLabel: string;
  riskLevel: 'Low' | 'Elevated' | 'High' | 'Hazardous';
  guidance: string;
}

export interface AqiBriefing {
  cityName: string;
  updatedAt: string;
  aqiEstimate: number | null;
  pm25Estimate: number | null;
  pm10Estimate: number | null;
  severity: SeverityTier;
  headline: string;
  inversionContext: string;
  safeOutdoorWindow: string;
  householdAlert: string;
  hourlyWindows: HourlyWindow[];
  sources: GroundedSource[];
  rawSummary: string;
}

export type RoutineCategory = 'routine' | 'indoorHack' | 'sustainableAlt' | 'communityAction';

export interface RoutineItem {
  id: string;
  timeWindow: string;
  category: RoutineCategory;
  title: string;
  actionSteps: string[];
  choiceSummary: string;
  mechanismExplanation: string;
  directImpactLabel: string;
  estimatedPm25DropPct: number;
  estimatedCo2SavedGrams: number;
}

export interface RoutinePlan {
  cityName: string;
  generatedAt: string;
  dailyStrategySummary: string;
  items: RoutineItem[];
}

export interface VisionDiagnosticResult {
  sceneSummary: string;
  riskRating: 'Low' | 'Moderate' | 'High' | 'Critical';
  detectedHazards: Array<{
    hazard: string;
    severity: string;
    whyItMatters: string;
  }>;
  indoorHacks: Array<{
    title: string;
    steps: string;
    directImpact: string;
    estimatedCost: string;
  }>;
  maskOrVentilationTip: string;
  expectedPm25ReductionPct: number;
}

export type DiyDesignType =
  | 'corsiRosenthal'
  | 'singleBoxFan'
  | 'wetMeshDraftTrap'
  | 'kitchenBaffle';

export interface DiyBlueprintResult {
  blueprintName: string;
  roomTarget: string;
  designType: DiyDesignType;
  estimatedCadrCfm: number;
  estimatedPm25CapturePct: number;
  estimatedCostLocal: string;
  airflowMechanism: string;
  materials: Array<{
    item: string;
    spec: string;
    quantity: string;
  }>;
  assemblySteps: string[];
  placementRule: string;
  maintenanceSchedule: string;
  impactSummary: string;
}

export interface CommunityActionCard {
  id: string;
  title: string;
  category: 'Carpool' | 'Zero-Burn' | 'School Zone' | 'Clean Heating';
  description: string;
  collectiveImpact: string;
  shareableMessage: string;
}

export interface UserCommunityPledge {
  id: string;
  uid: string;
  authorName: string;
  city: string;
  category: 'Carpool' | 'Zero-Burn' | 'School Zone' | 'Clean Heating';
  title: string;
  note: string;
}

export type ChatbotRoleId = 'fastTriage' | 'familyGuide' | 'complexStrategist' | 'deepAnalyst';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  personaRole?: string;
  model?: string;
  text: string;
  timestamp: string;
  sources?: GroundedSource[];
}

export interface DailyCo2Point {
  date: string;
  label: string;
  gramsSaved: number;
}

export interface GmpAirQualityPollutant {
  code: string;
  displayName: string;
  fullName: string;
  concentration?: {
    value: number;
    units: string;
  };
  additionalInfo?: {
    sources?: string;
    effects?: string;
  };
}

export interface GmpAirQualityIndex {
  code: string;
  displayName: string;
  aqi?: number;
  aqiDisplay?: string;
  category?: string;
  dominantPollutant?: string;
}

export interface GmpAirQualityResult {
  dateTime?: string;
  regionCode?: string;
  indexes: GmpAirQualityIndex[];
  pollutants: GmpAirQualityPollutant[];
  healthRecommendations?: {
    generalPopulation?: string;
    elderly?: string;
    children?: string;
    lungDiseasePopulation?: string;
    pregnantWomen?: string;
  };
}

export interface GmpPlaceItem {
  id: string;
  displayName: string;
  formattedAddress: string;
  location: {
    latitude: number;
    longitude: number;
  };
  googleMapsUri?: string;
  primaryTypeDisplayName?: string;
  rating?: number;
  userRatingCount?: number;
}

