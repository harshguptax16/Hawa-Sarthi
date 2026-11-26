import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  APILoadingStatus,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  ExternalLink,
  Footprints,
  Layers,
  LocateFixed,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  TrainFront,
  Wind,
} from 'lucide-react';
import { PRESET_CITIES } from '../data/cities.ts';
import type {
  GmpAirQualityResult,
  GmpPlaceItem,
  MapsPlacesResult,
} from '../types.ts';

interface MapsPlacesPanelProps {
  city: string;
}

const PLACE_CATEGORIES = [
  {
    id: 'transit',
    label: 'Metro & Low-Emission Transit',
    query: 'metro stations and electric bus transit hubs',
  },
  {
    id: 'shelters',
    label: 'Clean-Air Libraries & Centers',
    query: 'public libraries, museums, and indoor community centers',
  },
  {
    id: 'filters',
    label: 'HEPA & MERV Hardware Stores',
    query: 'hardware stores selling HEPA air filters and box fans',
  },
  {
    id: 'clinics',
    label: 'Respiratory & Pediatric Clinics',
    query: 'pulmonary, asthma, and family respiratory clinics',
  },
];

type AqiTileType =
  | 'OFF'
  | 'US_AQI'
  | 'IND_CPCB'
  | 'PM25_INDIGO_PERSIAN'
  | 'UAQI_INDIGO_PERSIAN';

const AQI_TILE_OPTIONS: Array<{ id: AqiTileType; label: string }> = [
  { id: 'OFF', label: 'Heatmap Off' },
  { id: 'US_AQI', label: 'US AQI' },
  { id: 'IND_CPCB', label: 'India CPCB' },
  { id: 'PM25_INDIGO_PERSIAN', label: 'PM2.5 Plume' },
  { id: 'UAQI_INDIGO_PERSIAN', label: 'Universal AQI' },
];

type RouteMode = 'TRANSIT' | 'WALKING';

interface RouteSummary {
  distanceText: string;
  durationText: string;
  mode: RouteMode;
  destinationName: string;
  warnings?: string[];
}

function triggerQuotaWarning() {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
}

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('OverQuotaMapError') ||
    msg.includes('429') ||
    msg.toLowerCase().includes('quota')
  );
}

/* -------------------------------------------------------------------------- */
/* Inner Map Sub-Components (require <APIProvider> / <GoogleMap> context)      */
/* -------------------------------------------------------------------------- */

const ApiStatusWatcher: React.FC = () => {
  const status = useApiLoadingStatus();
  useEffect(() => {
    if (status === APILoadingStatus.AUTH_FAILURE || status === APILoadingStatus.FAILED) {
      triggerQuotaWarning();
    }
  }, [status]);
  return null;
};

const MapViewportController: React.FC<{ center: google.maps.LatLngLiteral }> = ({ center }) => {
  const map = useMap();
  const prevRef = useRef<string>('');
  useEffect(() => {
    if (!map) return;
    const key = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
    if (prevRef.current && prevRef.current !== key) {
      map.panTo(center);
      map.setZoom(12);
    }
    prevRef.current = key;
  }, [map, center]);
  return null;
};

const AqiTileOverlay: React.FC<{ tileType: AqiTileType }> = ({ tileType }) => {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    map.overlayMapTypes.clear();
    if (tileType === 'OFF') return;

    const airQualityMapType = new google.maps.ImageMapType({
      getTileUrl: (coord, zoom) => {
        if (zoom < 0 || zoom > 16) return null;
        const numTiles = 1 << zoom;
        if (coord.y < 0 || coord.y >= numTiles) return null;
        const x = ((coord.x % numTiles) + numTiles) % numTiles;
        return `/api/gmp/aqi-tile/${encodeURIComponent(tileType)}/${zoom}/${x}/${coord.y}`;
      },
      tileSize: new google.maps.Size(256, 256),
      maxZoom: 16,
      minZoom: 0,
      name: `AQI-${tileType}`,
      opacity: 0.56,
    });

    map.overlayMapTypes.insertAt(0, airQualityMapType);

    return () => {
      map.overlayMapTypes.clear();
    };
  }, [map, tileType]);

  return null;
};

const RoutePolylineLayer: React.FC<{
  origin: google.maps.LatLngLiteral;
  destinationPlace: GmpPlaceItem | null;
  travelMode: RouteMode;
  onRouteResult: (summary: RouteSummary | null, errorMsg: string | null) => void;
}> = ({ origin, destinationPlace, travelMode, onRouteResult }) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!map || !routesLib || !destinationPlace) {
      onRouteResult(null, null);
      return;
    }

    let cancelled = false;

    const destinationCoords: google.maps.LatLngLiteral = {
      lat: destinationPlace.location.latitude,
      lng: destinationPlace.location.longitude,
    };

    const sdkTravelMode =
      travelMode === 'TRANSIT'
        ? google.maps.TravelMode.TRANSIT
        : google.maps.TravelMode.WALKING;

    const request: google.maps.routes.ComputeRoutesRequest = {
      origin,
      destination: destinationCoords,
      travelMode: sdkTravelMode,
      fields: ['path', 'distanceMeters', 'durationMillis', 'localizedValues', 'viewport', 'legs', 'warnings'],
      internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
    };

    routesLib.Route.computeRoutes(request)
      .then((response) => {
        if (cancelled) return;
        const route = response.routes?.[0];
        if (!route) {
          onRouteResult(null, `No ${travelMode.toLowerCase()} route returned between origin and this location.`);
          return;
        }

        const created = route.createPolylines({
          polylineOptions: {
            strokeColor: travelMode === 'TRANSIT' ? '#0d9488' : '#2563eb',
            strokeOpacity: 0.9,
            strokeWeight: 5,
          },
        });
        created.forEach((p) => p.setMap(map));
        polylinesRef.current = created;

        if (route.viewport) {
          map.fitBounds(route.viewport, 48);
        }

        const kmText =
          route.localizedValues?.distance ||
          (typeof route.distanceMeters === 'number'
            ? `${(route.distanceMeters / 1000).toFixed(1)} km`
            : 'N/A');
        const durText =
          route.localizedValues?.duration ||
          (typeof route.durationMillis === 'number'
            ? `${Math.max(1, Math.round(route.durationMillis / 60000))} min`
            : 'N/A');

        onRouteResult(
          {
            distanceText: kmText,
            durationText: durText,
            mode: travelMode,
            destinationName: destinationPlace.displayName,
            warnings: route.warnings,
          },
          null
        );
      })
      .catch((err) => {
        if (cancelled) return;
        if (isQuotaError(err)) {
          triggerQuotaWarning();
        }
        onRouteResult(
          null,
          err instanceof Error
            ? err.message
            : `Unable to compute ${travelMode.toLowerCase()} route right now.`
        );
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, routesLib, origin, destinationPlace, travelMode, onRouteResult]);

  return null;
};

interface PlaceMarkerItemProps {
  place: GmpPlaceItem;
  index: number;
  selected: boolean;
  onSelect: (place: GmpPlaceItem, marker: google.maps.marker.AdvancedMarkerElement | null) => void;
}

const PlaceMarkerItem: React.FC<PlaceMarkerItemProps> = ({
  place,
  index,
  selected,
  onSelect,
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const position = useMemo(
    () => ({ lat: place.location.latitude, lng: place.location.longitude }),
    [place.location.latitude, place.location.longitude]
  );

  return (
    <AdvancedMarker
      ref={markerRef}
      position={position}
      title={place.displayName}
      zIndex={selected ? 1000 : index + 1}
      onClick={() => onSelect(place, marker)}
    >
      <Pin
        background={selected ? '#0f766e' : '#0d9488'}
        borderColor={selected ? '#042f2e' : '#115e59'}
        glyphColor="#ffffff"
        glyphText={String(index + 1)}
      />
    </AdvancedMarker>
  );
};

/* -------------------------------------------------------------------------- */
/* Main Panel Component                                                       */
/* -------------------------------------------------------------------------- */

export const MapsPlacesPanel: React.FC<MapsPlacesPanelProps> = ({ city }) => {
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    () => import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [keyChecked, setKeyChecked] = useState<boolean>(
    () => Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY)
  );

  const [selectedCatId, setSelectedCatId] = useState(PLACE_CATEGORIES[0].id);
  const [customQuery, setCustomQuery] = useState('');
  const [useDeviceGps, setUseDeviceGps] = useState(false);
  const [deviceCoords, setDeviceCoords] = useState<{ latitude: number; longitude: number } | null>(
    null
  );
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);

  // Air Quality API state
  const [aqLoading, setAqLoading] = useState(false);
  const [aqError, setAqError] = useState<string | null>(null);
  const [aqUnavailable, setAqUnavailable] = useState(false);
  const [aqData, setAqData] = useState<GmpAirQualityResult | null>(null);
  const [tileType, setTileType] = useState<AqiTileType>('OFF');

  // Places API (New) state
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [places, setPlaces] = useState<GmpPlaceItem[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<GmpPlaceItem | null>(null);
  const [infoAnchor, setInfoAnchor] =
    useState<google.maps.marker.AdvancedMarkerElement | null>(null);

  // Routes API state
  const [routeMode, setRouteMode] = useState<RouteMode>('TRANSIT');
  const [routeDestination, setRouteDestination] = useState<GmpPlaceItem | null>(null);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Gemini Maps Grounding AI Context state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<MapsPlacesResult | null>(null);

  // Resolve client Maps API key from server if not baked into VITE_ env
  useEffect(() => {
    if (mapsApiKey) return;
    let cancelled = false;
    fetch('/api/gmp/client-config')
      .then((res) => res.json())
      .then((data: { apiKey?: string }) => {
        if (!cancelled) {
          if (data.apiKey) setMapsApiKey(data.apiKey);
          setKeyChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) setKeyChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mapsApiKey]);

  const cityPreset = useMemo(
    () => PRESET_CITIES.find((c) => c.name.toLowerCase() === city.toLowerCase()),
    [city]
  );

  const activeCoords = useMemo(() => {
    if (useDeviceGps && deviceCoords) {
      return deviceCoords;
    }
    if (cityPreset) {
      return { latitude: cityPreset.lat, longitude: cityPreset.lng };
    }
    return { latitude: 28.6139, longitude: 77.209 };
  }, [useDeviceGps, deviceCoords, cityPreset]);

  const mapCenter = useMemo(
    () => ({ lat: activeCoords.latitude, lng: activeCoords.longitude }),
    [activeCoords]
  );

  const requestGps = () => {
    if (!navigator.geolocation) {
      setGpsStatus('Browser geolocation is unavailable.');
      return;
    }
    setGpsStatus('Locating...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDeviceCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        setUseDeviceGps(true);
        setGpsStatus(
          `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`
        );
      },
      () => {
        setUseDeviceGps(false);
        setGpsStatus('Location permission declined; using city coordinates.');
      },
      { timeout: 8000 }
    );
  };

  // Fetch Google Maps Air Quality API current conditions
  const fetchAirQuality = useCallback(async (lat: number, lng: number) => {
    setAqLoading(true);
    setAqError(null);
    try {
      const res = await fetch('/api/gmp/air-quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });
      const data = await res.json();
      if (res.status === 429 || data?.status === 'RESOURCE_EXHAUSTED') {
        triggerQuotaWarning();
      }
      if (res.status === 403 || data?.status === 'PERMISSION_DENIED') {
        setAqUnavailable(true);
        setTileType('OFF');
        setAqData(null);
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || 'Air Quality API lookup failed.');
      }
      setAqUnavailable(false);
      setAqData(data as GmpAirQualityResult);
    } catch (err) {
      setAqError(
        err instanceof Error ? err.message : 'Unable to fetch Google Maps Air Quality conditions.'
      );
    } finally {
      setAqLoading(false);
    }
  }, []);

  // Search Places API (New) via backend proxy
  const searchPlaces = useCallback(
    async (queryText: string, catId?: string) => {
      if (catId) setSelectedCatId(catId);
      setPlacesLoading(true);
      setPlacesError(null);
      setSelectedPlace(null);
      setInfoAnchor(null);
      setRouteDestination(null);
      setRouteSummary(null);
      setRouteError(null);

      try {
        const res = await fetch('/api/gmp/places-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            textQuery: `${queryText} in ${city}`,
            latitude: activeCoords.latitude,
            longitude: activeCoords.longitude,
          }),
        });
        const data = await res.json();
        if (res.status === 429 || data?.status === 'RESOURCE_EXHAUSTED') {
          triggerQuotaWarning();
        }
        if (!res.ok) {
          throw new Error(data.error || 'Places API search failed.');
        }
        setPlaces(Array.isArray(data.places) ? (data.places as GmpPlaceItem[]) : []);
      } catch (err) {
        setPlacesError(
          err instanceof Error ? err.message : 'Unable to fetch Google Places results.'
        );
      } finally {
        setPlacesLoading(false);
      }
    },
    [city, activeCoords.latitude, activeCoords.longitude]
  );

  // Load Air Quality + default Transit places when city or GPS coords change
  useEffect(() => {
    setAiResult(null);
    void fetchAirQuality(activeCoords.latitude, activeCoords.longitude);
    const defaultCat =
      PLACE_CATEGORIES.find((c) => c.id === selectedCatId) ?? PLACE_CATEGORIES[0];
    void searchPlaces(defaultCat.query, defaultCat.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, activeCoords.latitude, activeCoords.longitude]);

  const fetchAiGrounding = async () => {
    const category =
      PLACE_CATEGORIES.find((c) => c.id === selectedCatId) ?? PLACE_CATEGORIES[0];
    const queryLabel = customQuery.trim() || category.query;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch('/api/maps-places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city,
          queryCategory: queryLabel,
          latLng: activeCoords,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Maps grounding request failed.');
      setAiResult(data as MapsPlacesResult);
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : 'Unable to fetch Gemini Maps grounding summary.'
      );
    } finally {
      setAiLoading(false);
    }
  };

  const handleMarkerSelect = useCallback(
    (place: GmpPlaceItem, marker: google.maps.marker.AdvancedMarkerElement | null) => {
      setSelectedPlace(place);
      setInfoAnchor(marker);
    },
    []
  );

  const handleRouteResult = useCallback(
    (summary: RouteSummary | null, err: string | null) => {
      setRouteSummary(summary);
      setRouteError(err);
    },
    []
  );

  const primaryIndex = aqData?.indexes?.find((i) => i.code !== 'uaqi') ?? aqData?.indexes?.[0];
  const uaqiIndex = aqData?.indexes?.find((i) => i.code === 'uaqi');
  const pm25Pollutant = aqData?.pollutants?.find((p) => p.code === 'pm25');
  const pm10Pollutant = aqData?.pollutants?.find((p) => p.code === 'pm10');
  const no2Pollutant = aqData?.pollutants?.find((p) => p.code === 'no2');

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      {/* Header Row */}
      <div className="flex flex-col justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <MapPin className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            <span>
              Interactive Google Maps · Air Quality, Places &amp; Routes · {city}
            </span>
          </div>
          <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
            Live Smog Heatmap, Clean-Air Shelters &amp; Low-Emission Transit Routes
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={requestGps}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-teal-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-teal-400 whitespace-nowrap"
          >
            <LocateFixed className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            <span>{useDeviceGps && deviceCoords ? 'GPS Active' : 'Use My GPS'}</span>
          </button>

          <button
            type="button"
            onClick={() => void fetchAirQuality(activeCoords.latitude, activeCoords.longitude)}
            disabled={aqLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-teal-600 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-teal-400 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${aqLoading ? 'animate-spin' : ''}`} />
            <span>Refresh AQI</span>
          </button>

          <button
            type="button"
            onClick={() => void fetchAiGrounding()}
            disabled={aiLoading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400 whitespace-nowrap"
          >
            <Sparkles className={`h-3.5 w-3.5 ${aiLoading ? 'animate-pulse' : ''}`} />
            <span>{aiLoading ? 'Summarizing...' : 'AI Grounding Brief'}</span>
          </button>
        </div>
      </div>

      {gpsStatus && (
        <p className="mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
          Origin Coordinates: {gpsStatus}
        </p>
      )}

      {/* Google Maps Air Quality API Telemetry Strip */}
      {(aqData || aqError || (aqLoading && !aqUnavailable) || aqUnavailable) && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/70">
          {aqUnavailable ? (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Google Maps Places Search &amp; Transit/Walking Routes are active for {city}. Detailed Air Quality API tile layers require a Cloud project key with the Air Quality API enabled.
            </p>
          ) : aqError ? (
            <p className="text-xs text-red-600 dark:text-red-400">{aqError}</p>
          ) : aqLoading && !aqData ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Loading live Google Maps Air Quality API telemetry...
            </p>
          ) : aqData ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-center">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 lg:col-span-7">
              <div>
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {primaryIndex?.displayName || 'Local Air Quality'}
                </div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {primaryIndex?.aqiDisplay ?? primaryIndex?.aqi ?? '—'}
                  </span>
                  <span className="text-xs font-medium text-teal-700 dark:text-teal-400">
                    {primaryIndex?.category || 'Live'}
                  </span>
                </div>
              </div>

              {uaqiIndex && uaqiIndex.code !== primaryIndex?.code && (
                <div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Universal AQI
                  </div>
                  <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                    {uaqiIndex.aqiDisplay ?? uaqiIndex.aqi ?? '—'}
                  </div>
                </div>
              )}

              <div>
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  PM2.5 · PM10 · NO₂
                </div>
                <div className="mt-0.5 font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300">
                  {pm25Pollutant?.concentration
                    ? `${pm25Pollutant.concentration.value.toFixed(1)} µg/m³`
                    : '—'}{' '}
                  ·{' '}
                  {pm10Pollutant?.concentration
                    ? `${pm10Pollutant.concentration.value.toFixed(1)} µg/m³`
                    : '—'}{' '}
                  ·{' '}
                  {no2Pollutant?.concentration
                    ? `${no2Pollutant.concentration.value.toFixed(1)} ppb`
                    : '—'}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-2.5 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:text-slate-300 lg:col-span-5 lg:border-t-0 lg:border-l lg:pl-4 lg:pt-0">
              <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                <Wind className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                <span>
                  Sensitive-Group Advisory
                  {primaryIndex?.dominantPollutant
                    ? ` · Dominant: ${primaryIndex.dominantPollutant.toUpperCase()}`
                    : ''}
                </span>
              </div>
              <p className="mt-1">
                {aqData.healthRecommendations?.lungDiseasePopulation ||
                  aqData.healthRecommendations?.children ||
                  aqData.healthRecommendations?.generalPopulation ||
                  'Monitor hourly PM2.5 changes before outdoor commutes.'}
              </p>
            </div>
          </div>
        ) : null}
        </div>
      )}

      {/* Category Filter Buttons & Custom Search */}
      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {PLACE_CATEGORIES.map((cat) => {
            const active = cat.id === selectedCatId && !customQuery.trim();
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setCustomQuery('');
                  void searchPlaces(cat.query, cat.id);
                }}
                disabled={placesLoading}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'border-teal-600 bg-teal-50/70 text-teal-900 dark:border-teal-400 dark:bg-teal-950/40 dark:text-teal-200'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!customQuery.trim()) return;
            void searchPlaces(customQuery.trim());
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1 sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={customQuery}
              onChange={(e) => setCustomQuery(e.target.value)}
              placeholder={`Search places in ${city}...`}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-900 outline-hidden focus:border-teal-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-teal-400"
            />
          </div>
          <button
            type="submit"
            disabled={placesLoading || !customQuery.trim()}
            className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-200 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Search
          </button>
        </form>
      </div>

      {/* Heatmap Tile Layer & Route Mode Bar */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-y border-slate-200 py-2.5 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400 mr-1">
            <Layers className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            <span>AQI Layer:</span>
          </span>
          {AQI_TILE_OPTIONS.map((opt) => {
            const disabled = aqUnavailable && opt.id !== 'OFF';
            return (
              <button
                key={opt.id}
                type="button"
                disabled={disabled}
                onClick={() => setTileType(opt.id)}
                title={disabled ? 'Requires Air Quality API enabled on Google Cloud key' : undefined}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  tileType === opt.id
                    ? 'bg-teal-600 text-white dark:bg-teal-500 dark:text-slate-950'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mr-1">
            Route Mode:
          </span>
          <button
            type="button"
            onClick={() => setRouteMode('TRANSIT')}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              routeMode === 'TRANSIT'
                ? 'bg-teal-600 text-white dark:bg-teal-500 dark:text-slate-950'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            <TrainFront className="h-3 w-3" />
            <span>Transit</span>
          </button>
          <button
            type="button"
            onClick={() => setRouteMode('WALKING')}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              routeMode === 'WALKING'
                ? 'bg-blue-600 text-white dark:bg-blue-500 dark:text-slate-950'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            <Footprints className="h-3 w-3" />
            <span>Walking</span>
          </button>
        </div>
      </div>

      {/* Route Summary / Error Strip */}
      {routeSummary && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50/70 px-3.5 py-2 text-xs text-teal-950 dark:border-teal-900/60 dark:bg-teal-950/30 dark:text-teal-200">
          <div className="flex items-center gap-2">
            <Navigation className="h-3.5 w-3.5 shrink-0 text-teal-700 dark:text-teal-400" />
            <span>
              <strong>{routeSummary.mode === 'TRANSIT' ? 'Public Transit' : 'Walking'}</strong> to{' '}
              <strong>{routeSummary.destinationName}</strong> ·{' '}
              <span className="font-mono font-semibold tabular-nums">
                {routeSummary.durationText} ({routeSummary.distanceText})
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setRouteDestination(null);
              setRouteSummary(null);
              setRouteError(null);
            }}
            className="text-xs font-medium underline hover:opacity-80"
          >
            Clear route
          </button>
        </div>
      )}

      {routeError && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          {routeError}
        </div>
      )}

      {placesError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {placesError}
        </div>
      )}

      {/* Interactive Google Map + Places List Grid */}
      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Map Canvas Container (Explicit height required per CF2) */}
        <div className="relative h-[420px] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950 lg:col-span-7">
          {!keyChecked ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">
              Initializing Google Maps Platform...
            </div>
          ) : !mapsApiKey ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Google Maps API key is not configured yet. Enable Google Maps in Settings to render the interactive map.
            </div>
          ) : (
            <APIProvider
              apiKey={mapsApiKey}
              libraries={['marker', 'places', 'routes']}
              language="en"
            >
              <ApiStatusWatcher />
              <GoogleMap
                className="h-full w-full"
                defaultCenter={mapCenter}
                defaultZoom={12}
                mapId="DEMO_MAP_ID"
                gestureHandling="greedy"
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              >
                <MapViewportController center={mapCenter} />
                <AqiTileOverlay tileType={tileType} />
                <RoutePolylineLayer
                  origin={mapCenter}
                  destinationPlace={routeDestination}
                  travelMode={routeMode}
                  onRouteResult={handleRouteResult}
                />

                {/* Origin Marker (GPS or City Center) */}
                <AdvancedMarker
                  position={mapCenter}
                  title={useDeviceGps && deviceCoords ? 'Your GPS Location' : `${city} Center`}
                  zIndex={1100}
                >
                  <Pin
                    background="#1e293b"
                    borderColor="#0f172a"
                    glyphColor="#5eead4"
                    glyphText={useDeviceGps && deviceCoords ? 'ME' : 'C'}
                  />
                </AdvancedMarker>

                {/* Place Markers */}
                {places.map((place, idx) => (
                  <PlaceMarkerItem
                    key={place.id}
                    place={place}
                    index={idx}
                    selected={selectedPlace?.id === place.id}
                    onSelect={handleMarkerSelect}
                  />
                ))}

                {/* InfoWindow anchored to AdvancedMarker */}
                {selectedPlace && infoAnchor && (
                  <InfoWindow
                    anchor={infoAnchor}
                    pixelOffset={[0, -4]}
                    onCloseClick={() => {
                      setSelectedPlace(null);
                      setInfoAnchor(null);
                    }}
                  >
                    <div className="max-w-[230px] p-0.5 text-slate-900">
                      <div className="text-xs font-semibold leading-snug">
                        {selectedPlace.displayName}
                      </div>
                      {selectedPlace.primaryTypeDisplayName && (
                        <div className="mt-0.5 text-[11px] text-slate-600">
                          {selectedPlace.primaryTypeDisplayName}
                        </div>
                      )}
                      {selectedPlace.formattedAddress && (
                        <div className="mt-1 text-[11px] leading-snug text-slate-600">
                          {selectedPlace.formattedAddress}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setRouteDestination(selectedPlace)}
                          className="rounded bg-teal-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-700"
                        >
                          {routeMode === 'TRANSIT' ? 'Transit Route' : 'Walk Route'}
                        </button>
                        {selectedPlace.googleMapsUri && (
                          <a
                            href={selectedPlace.googleMapsUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:underline"
                          >
                            <span>Maps</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </InfoWindow>
                )}
              </GoogleMap>
            </APIProvider>
          )}
        </div>

        {/* Places List */}
        <div className="flex flex-col lg:col-span-5">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              Places Results ({places.length}) · Click a location to draw route
            </span>
            {placesLoading && <span>Updating...</span>}
          </div>

          <div className="max-h-[390px] flex-1 divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/70 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950">
            {places.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 dark:text-slate-400">
                {placesLoading
                  ? 'Searching nearby Google Places...'
                  : 'No places returned for this search. Try another category or keyword.'}
              </div>
            ) : (
              places.map((place, idx) => {
                const isRouteTarget = routeDestination?.id === place.id;
                return (
                  <div
                    key={place.id}
                    className={`p-3 transition-colors ${
                      isRouteTarget
                        ? 'bg-teal-50/80 dark:bg-teal-950/30'
                        : 'hover:bg-slate-100/70 dark:hover:bg-slate-900/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-teal-600 font-mono text-[10px] font-semibold text-white">
                            {idx + 1}
                          </span>
                          <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {place.displayName}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-snug text-slate-600 dark:text-slate-400">
                          {place.formattedAddress}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                          {place.primaryTypeDisplayName && (
                            <span>{place.primaryTypeDisplayName}</span>
                          )}
                          {typeof place.rating === 'number' && (
                            <span className="inline-flex items-center gap-0.5 font-mono tabular-nums">
                              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                              {place.rating.toFixed(1)}
                              {place.userRatingCount ? ` (${place.userRatingCount})` : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPlace(place);
                            setRouteDestination(place);
                          }}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            isRouteTarget
                              ? 'bg-teal-600 text-white dark:bg-teal-500 dark:text-slate-950'
                              : 'border border-slate-200 bg-white text-slate-700 hover:border-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                          }`}
                        >
                          <Navigation className="h-3 w-3" />
                          <span>{isRouteTarget ? 'Routed' : 'Route'}</span>
                        </button>

                        {place.googleMapsUri && (
                          <a
                            href={place.googleMapsUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-teal-700 hover:underline dark:text-teal-400"
                          >
                            <span>Open Maps</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Gemini Maps Grounding Summary (Optional on-demand context) */}
      {(aiError || aiResult) && (
        <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
          {aiError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              {aiError}
            </div>
          )}
          {aiResult && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-300 lg:col-span-7">
                <div className="mb-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Gemini Maps Grounding Guidance · {aiResult.queryLabel}
                </div>
                {aiResult.summaryMarkdown}
              </div>

              <div className="space-y-2 lg:col-span-5">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Grounded Map References ({aiResult.places.length})
                </div>
                <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-slate-50/70 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950">
                  {aiResult.places.map((p) => (
                    <div key={p.uri} className="p-2.5">
                      <a
                        href={p.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:underline dark:text-teal-400"
                      >
                        <span>{p.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      {p.reviewSnippets && p.reviewSnippets.length > 0 && (
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                          &ldquo;{p.reviewSnippets[0]}&rdquo;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
