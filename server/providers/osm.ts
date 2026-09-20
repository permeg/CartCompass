import { chainFromNames } from '../../src/domain/chains';
import { haversineMiles } from '../../src/domain/geo';
import type { LatLon, Store } from '../../src/domain/types';
import { UpstreamError } from '../errors';

/**
 * Stores of the chains that don't publish prices, found in OpenStreetMap through the
 * Overpass API. Data © OpenStreetMap contributors (ODbL), so it may be cached.
 *
 * The public Overpass servers are shared and can take 15 to 40 seconds, so answers are
 * cached, and the app asks for these stores in the background after the real-price plan is up.
 */
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const USER_AGENT = 'CartCompass/0.1 (portfolio project)';
const ATTEMPT_TIMEOUT_MS = 30_000;

const MAX_PER_CHAIN = 2;
const MAX_TOTAL = 10;
const METERS_PER_MILE = 1609.34;

/**
 * The exact `brand` values OpenStreetMap uses for our chains. Matching exact values is far
 * faster on Overpass than case-insensitive patterns; `chainFromNames` makes the final call.
 */
const BRANDS = [
  'Walmart',
  'Target',
  'ALDI',
  'Aldi',
  'Costco',
  'Costco Wholesale',
  'Safeway',
  'Whole Foods Market',
  'WinCo Foods',
  'H-E-B',
  "BJ's Wholesale Club",
  'Lidl',
];

interface OsmElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

export function buildQuery(origin: LatLon, radiusMiles: number): string {
  const meters = Math.round(radiusMiles * METERS_PER_MILE);
  const brands = BRANDS.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return (
    '[out:json][timeout:25];' +
    `nwr["shop"]["brand"~"^(${brands})$"](around:${meters},${origin.lat},${origin.lon});` +
    'out center tags 150;'
  );
}

export function normalizeElement(e: OsmElement): Store | null {
  const tags = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !e.type || e.id === undefined) return null;

  const chain = chainFromNames([tags.brand, tags.name, tags.operator]);
  if (!chain) return null;

  const street = tags['addr:street'];
  const city = tags['addr:city'];
  const where = street ?? city;
  const address = [[tags['addr:housenumber'], street].filter(Boolean).join(' '), city].filter(Boolean).join(', ');
  return {
    id: `osm:${e.type}/${e.id}`,
    name: where ? `${chain.label} ${where}` : chain.label,
    blurb: address,
    chain: chain.label,
    chainKey: chain.key,
    estimated: true,
    membership: chain.membership,
    lat,
    lon,
  };
}

/** Nearest few of each chain, so a dense city doesn't drown the trip planner in near-identical stores. */
export function pickNearest(stores: Store[], origin: LatLon): Store[] {
  const sorted = [...stores].sort((a, b) => haversineMiles(origin, a) - haversineMiles(origin, b));
  const perChain = new Map<string, number>();
  const kept: Store[] = [];
  for (const s of sorted) {
    const n = perChain.get(s.chainKey ?? '') ?? 0;
    if (n >= MAX_PER_CHAIN || kept.length >= MAX_TOTAL) continue;
    perChain.set(s.chainKey ?? '', n + 1);
    kept.push(s);
  }
  return kept;
}

/* ---------- caching ---------- */

// Stores don't move, so a day is safe. Keyed by a ~2 mile cell so nearby people share an answer.
const CACHE_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; stores: Store[] }>();

export function resetOsmCache(): void {
  cache.clear();
}

const cellKey = (origin: LatLon, radiusMiles: number) =>
  `${(Math.round(origin.lat * 25) / 25).toFixed(2)},${(Math.round(origin.lon * 25) / 25).toFixed(2)},${Math.round(radiusMiles)}`;

export async function osmChainStores(
  origin: LatLon,
  radiusMiles: number,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<Store[]> {
  const key = cellKey(origin, radiusMiles);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return pickNearest(hit.stores, origin);

  const body = `data=${encodeURIComponent(buildQuery(origin, radiusMiles))}`;
  let lastError: unknown = new UpstreamError('OpenStreetMap', 503);

  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT, accept: 'application/json' },
        body,
        // Each server gets its own time, so a slow first one doesn't leave none for the second.
        signal: signal ?? AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (!res.ok) throw new UpstreamError('OpenStreetMap', res.status);
      const json = (await res.json()) as { elements?: OsmElement[] };
      const stores = (json.elements ?? []).map(normalizeElement).filter((s): s is Store => s !== null);
      if (cache.size > 300) cache.clear();
      cache.set(key, { at: now, stores });
      return pickNearest(stores, origin);
    } catch (err) {
      lastError = err;
      // A busy public server is common. Try the next one.
    }
  }
  throw lastError;
}
