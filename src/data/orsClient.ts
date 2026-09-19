import type { LatLon, Place, RouteLine } from '../domain/types';
import type { RoutingProvider } from './providers';

const post = (path: string, points: LatLon[], signal?: AbortSignal) =>
  fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ points: points.map(({ lat, lon }) => ({ lat, lon })) }),
    signal,
  });

const isGrid = (m: unknown, n: number): m is number[][] =>
  Array.isArray(m) && m.length === n && m.every((row) => Array.isArray(row) && row.length === n && row.every(Number.isFinite));

/** Real driving distances and times, and the road line for a trip, through our proxy to OpenRouteService. */
export const liveRouting: RoutingProvider = {
  async matrix(points) {
    const res = await post('/api/matrix', points);
    if (!res.ok) throw new Error(`Drive times failed (${res.status})`);
    const body = (await res.json()) as { miles?: unknown; minutes?: unknown };
    if (!isGrid(body.miles, points.length) || !isGrid(body.minutes, points.length)) {
      throw new Error('Drive times came back in an unexpected shape');
    }
    return { miles: body.miles, minutes: body.minutes };
  },

  async routeLine(points, signal) {
    const res = await post('/api/route', points, signal);
    if (!res.ok) return null;
    const body = (await res.json()) as { route?: RouteLine | null };
    const r = body.route;
    if (!r || !Array.isArray(r.coordinates) || !Array.isArray(r.wayPoints) || r.wayPoints.length !== points.length) return null;
    return r;
  },
};

export interface AddressResult extends Place {
  kind: string;
}

/** Trim "1 Main St, Bellevue, WA, USA" down to something that fits on a button. */
export function shortLabel(label: string): string {
  return label.replace(/,\s*(USA|United States)$/i, '');
}

/** Address and ZIP suggestions. `near` only nudges the ranking toward where the user already is. */
export async function searchAddresses(query: string, near: LatLon | null, signal?: AbortSignal): Promise<AddressResult[]> {
  const params = new URLSearchParams({ q: query });
  if (near) {
    params.set('lat', String(near.lat));
    params.set('lon', String(near.lon));
  }
  const res = await fetch(`/api/geocode?${params}`, { signal });
  if (!res.ok) throw new Error(`Address search failed (${res.status})`);
  const body = (await res.json()) as { results?: { label?: string; lat?: number; lon?: number; kind?: string }[] };
  return (body.results ?? []).flatMap((r) =>
    typeof r.label === 'string' && Number.isFinite(r.lat) && Number.isFinite(r.lon)
      ? [{ label: shortLabel(r.label), lat: r.lat as number, lon: r.lon as number, kind: r.kind ?? 'place' }]
      : [],
  );
}
