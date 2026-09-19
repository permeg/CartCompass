import { haversineMiles } from '../../src/domain/geo';
import type { LatLon } from '../../src/domain/types';
import { UpstreamError } from '../errors';

/**
 * OpenRouteService: address search, drive times and route lines.
 * Data © openrouteservice.org by HeiGIT, map data © OpenStreetMap contributors.
 */
const BASE = 'https://api.openrouteservice.org';

export interface OrsConfig {
  apiKey: string;
}

export function orsConfig(env: Record<string, string | undefined>): OrsConfig | null {
  const apiKey = env.ORS_API_KEY?.trim();
  return apiKey ? { apiKey } : null;
}

async function ors(config: OrsConfig, path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
  const headers: Record<string, string> = {
    // The key goes in a header, never in the URL, so it can't end up in logs.
    authorization: config.apiKey,
    accept: 'application/geo+json, application/json',
  };
  if (init.body) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { ...init, headers, signal });
  if (!res.ok) throw new UpstreamError('OpenRouteService', res.status);
  return res.json();
}

/* ---------- address search ---------- */

export interface GeoResult {
  label: string;
  lat: number;
  lon: number;
  /** What kind of place this is, e.g. "address" or "postalcode". */
  kind: string;
}

interface PeliasFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { label?: string; layer?: string };
}

export function normalizeFeature(f: PeliasFeature): GeoResult | null {
  const c = f.geometry?.coordinates;
  const label = f.properties?.label?.trim();
  if (!c || !label || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  return { label, lat: c[1], lon: c[0], kind: f.properties?.layer ?? 'place' };
}

export async function orsGeocode(
  config: OrsConfig,
  text: string,
  focus: LatLon | null,
  signal?: AbortSignal,
): Promise<GeoResult[]> {
  const params = new URLSearchParams({ text, 'boundary.country': 'US', size: '5' });
  if (focus) {
    params.set('focus.point.lat', String(focus.lat));
    params.set('focus.point.lon', String(focus.lon));
  }
  const body = (await ors(config, `/geocode/search?${params}`, {}, signal)) as { features?: PeliasFeature[] };
  const seen = new Set<string>();
  return (body.features ?? [])
    .map(normalizeFeature)
    .filter((r): r is GeoResult => r !== null)
    .filter((r) => (seen.has(r.label) ? false : (seen.add(r.label), true)));
}

/* ---------- drive times ---------- */

/** Fallback when the router can't connect two points: straight line x 1.3 at 24 mph. */
function estimate(a: LatLon, b: LatLon): { miles: number; minutes: number } {
  const miles = haversineMiles(a, b) * 1.3;
  return { miles, minutes: (miles / 24) * 60 };
}

/** Driving miles and minutes between every pair of points (no live traffic). */
export async function orsMatrix(
  config: OrsConfig,
  points: LatLon[],
  signal?: AbortSignal,
): Promise<{ miles: number[][]; minutes: number[][] }> {
  const body = (await ors(
    config,
    '/v2/matrix/driving-car',
    {
      method: 'POST',
      body: JSON.stringify({
        locations: points.map((p) => [p.lon, p.lat]),
        metrics: ['distance', 'duration'],
        units: 'mi',
      }),
    },
    signal,
  )) as { distances?: (number | null)[][]; durations?: (number | null)[][] };

  const miles: number[][] = [];
  const minutes: number[][] = [];
  for (let i = 0; i < points.length; i++) {
    miles.push([]);
    minutes.push([]);
    for (let j = 0; j < points.length; j++) {
      const d = body.distances?.[i]?.[j];
      const t = body.durations?.[i]?.[j];
      if (typeof d === 'number' && typeof t === 'number') {
        miles[i].push(d);
        minutes[i].push(t / 60);
      } else {
        // null means the router found no road between them (an island, say).
        const e = estimate(points[i], points[j]);
        miles[i].push(e.miles);
        minutes[i].push(e.minutes);
      }
    }
  }
  return { miles, minutes };
}

/* ---------- route line ---------- */

export interface RouteLine {
  /** The road geometry, in order. */
  coordinates: LatLon[];
  /** Index in `coordinates` of each waypoint you asked for, so the line can be split into legs. */
  wayPoints: number[];
  miles: number;
  minutes: number;
}

interface DirectionsFeature {
  geometry?: { coordinates?: [number, number][] };
  properties?: { way_points?: number[]; summary?: { distance?: number; duration?: number } };
}

export async function orsRoute(config: OrsConfig, points: LatLon[], signal?: AbortSignal): Promise<RouteLine | null> {
  const body = (await ors(
    config,
    '/v2/directions/driving-car/geojson',
    {
      method: 'POST',
      body: JSON.stringify({
        coordinates: points.map((p) => [p.lon, p.lat]),
        units: 'mi',
        instructions: false,
        geometry_simplify: true,
      }),
    },
    signal,
  )) as { features?: DirectionsFeature[] };

  const f = body.features?.[0];
  const coords = f?.geometry?.coordinates;
  const wayPoints = f?.properties?.way_points;
  if (!coords || coords.length < 2 || !wayPoints || wayPoints.length !== points.length) return null;
  return {
    coordinates: coords.map(([lon, lat]) => ({ lat, lon })),
    wayPoints,
    miles: f?.properties?.summary?.distance ?? 0,
    minutes: (f?.properties?.summary?.duration ?? 0) / 60,
  };
}
