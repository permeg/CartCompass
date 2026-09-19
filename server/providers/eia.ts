import { haversineMiles } from '../../src/domain/geo';
import type { LatLon } from '../../src/domain/types';
import { UpstreamError } from '../errors';

/**
 * Weekly retail gasoline prices from the U.S. Energy Information Administration.
 * EIA publishes a price for the US, five regions (and sub-regions of the East Coast),
 * nine states and ten metro areas. We pick the most local series that exists.
 * EIA data is U.S. government open data, so it is safe to cache.
 */
const ENDPOINT = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/';

export interface EiaConfig {
  apiKey: string;
}

export function eiaConfig(env: Record<string, string | undefined>): EiaConfig | null {
  const apiKey = env.EIA_API_KEY?.trim();
  return apiKey ? { apiKey } : null;
}

export interface GasArea {
  /** EIA series id, e.g. "Y48SE". */
  id: string;
  /** What to call it in the UI, e.g. "Seattle". */
  name: string;
  kind: 'city' | 'state' | 'region' | 'national';
}

/** Metro areas EIA publishes. A point within `CITY_RADIUS_MILES` of one uses its (more local) price. */
const CITIES: (GasArea & LatLon)[] = [
  { id: 'Y48SE', name: 'Seattle', kind: 'city', lat: 47.6062, lon: -122.3321 },
  { id: 'Y05LA', name: 'Los Angeles', kind: 'city', lat: 34.0522, lon: -118.2437 },
  { id: 'Y05SF', name: 'San Francisco', kind: 'city', lat: 37.7749, lon: -122.4194 },
  { id: 'Y35NY', name: 'New York City', kind: 'city', lat: 40.7128, lon: -74.006 },
  { id: 'YBOS', name: 'Boston', kind: 'city', lat: 42.3601, lon: -71.0589 },
  { id: 'YORD', name: 'Chicago', kind: 'city', lat: 41.8781, lon: -87.6298 },
  { id: 'YDEN', name: 'Denver', kind: 'city', lat: 39.7392, lon: -104.9903 },
  { id: 'Y44HO', name: 'Houston', kind: 'city', lat: 29.7604, lon: -95.3698 },
  { id: 'YMIA', name: 'Miami', kind: 'city', lat: 25.7617, lon: -80.1918 },
  { id: 'YCLE', name: 'Cleveland', kind: 'city', lat: 41.4993, lon: -81.6944 },
];
export const CITY_RADIUS_MILES = 25;

const STATES: Record<string, GasArea> = {
  CA: { id: 'SCA', name: 'California', kind: 'state' },
  CO: { id: 'SCO', name: 'Colorado', kind: 'state' },
  FL: { id: 'SFL', name: 'Florida', kind: 'state' },
  MA: { id: 'SMA', name: 'Massachusetts', kind: 'state' },
  MN: { id: 'SMN', name: 'Minnesota', kind: 'state' },
  NY: { id: 'SNY', name: 'New York', kind: 'state' },
  OH: { id: 'SOH', name: 'Ohio', kind: 'state' },
  TX: { id: 'STX', name: 'Texas', kind: 'state' },
  WA: { id: 'SWA', name: 'Washington', kind: 'state' },
};

const NEW_ENGLAND: GasArea = { id: 'R1X', name: 'New England', kind: 'region' };
const CENTRAL_ATLANTIC: GasArea = { id: 'R1Y', name: 'the Central Atlantic states', kind: 'region' };
const LOWER_ATLANTIC: GasArea = { id: 'R1Z', name: 'the Lower Atlantic states', kind: 'region' };
const MIDWEST: GasArea = { id: 'R20', name: 'the Midwest', kind: 'region' };
const GULF_COAST: GasArea = { id: 'R30', name: 'the Gulf Coast', kind: 'region' };
const ROCKIES: GasArea = { id: 'R40', name: 'the Rocky Mountain states', kind: 'region' };
const WEST_COAST_NO_CA: GasArea = { id: 'R5XCA', name: 'the Western states (outside California)', kind: 'region' };
const NATIONAL: GasArea = { id: 'NUS', name: 'the U.S.', kind: 'national' };

/** For states EIA has no series of its own: the region the state belongs to. */
const REGION_BY_STATE: Record<string, GasArea> = {
  ...Object.fromEntries(['CT', 'ME', 'NH', 'RI', 'VT'].map((s) => [s, NEW_ENGLAND])),
  ...Object.fromEntries(['DE', 'DC', 'MD', 'NJ', 'PA'].map((s) => [s, CENTRAL_ATLANTIC])),
  ...Object.fromEntries(['GA', 'NC', 'SC', 'VA', 'WV'].map((s) => [s, LOWER_ATLANTIC])),
  ...Object.fromEntries(
    ['IL', 'IN', 'IA', 'KS', 'KY', 'MI', 'MO', 'NE', 'ND', 'OK', 'SD', 'TN', 'WI'].map((s) => [s, MIDWEST]),
  ),
  ...Object.fromEntries(['AL', 'AR', 'LA', 'MS', 'NM'].map((s) => [s, GULF_COAST])),
  ...Object.fromEntries(['ID', 'MT', 'UT', 'WY'].map((s) => [s, ROCKIES])),
  ...Object.fromEntries(['AK', 'AZ', 'HI', 'NV', 'OR'].map((s) => [s, WEST_COAST_NO_CA])),
};

/**
 * The most local EIA series for a point: a nearby metro area, else the state, else the
 * state's region, else the national average. `state` is a two-letter code, or null if unknown.
 */
export function gasAreaFor(point: LatLon, state: string | null): GasArea {
  let nearest: { area: GasArea; miles: number } | null = null;
  for (const city of CITIES) {
    const miles = haversineMiles(point, city);
    if (miles <= CITY_RADIUS_MILES && (!nearest || miles < nearest.miles)) nearest = { area: city, miles };
  }
  if (nearest) return { id: nearest.area.id, name: nearest.area.name, kind: 'city' };

  const code = state?.toUpperCase() ?? '';
  return STATES[code] ?? REGION_BY_STATE[code] ?? NATIONAL;
}

export interface GasPrice {
  /** Cents per gallon, regular unleaded. */
  cents: number;
  /** The week the price is for (a Monday), e.g. "2026-09-14". */
  period: string;
}

const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; price: GasPrice }>();

export function resetGasCache(): void {
  cache.clear();
}

/** Latest weekly retail price of regular gasoline for one EIA series. Cached for six hours. */
export async function eiaRegularGas(
  config: EiaConfig,
  areaId: string,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<GasPrice> {
  const hit = cache.get(areaId);
  if (hit && now - hit.at < CACHE_MS) return hit.price;

  const url = new URL(ENDPOINT);
  url.searchParams.set('api_key', config.apiKey);
  url.searchParams.set('frequency', 'weekly');
  url.searchParams.set('data[0]', 'value');
  url.searchParams.set('facets[product][]', 'EPMR'); // regular gasoline
  url.searchParams.set('facets[duoarea][]', areaId);
  url.searchParams.set('sort[0][column]', 'period');
  url.searchParams.set('sort[0][direction]', 'desc');
  url.searchParams.set('length', '1');

  const res = await fetch(url, { headers: { accept: 'application/json' }, signal });
  // The key is in this URL, so never put the URL or the body in an error.
  if (!res.ok) throw new UpstreamError('EIA', res.status);
  const body = (await res.json()) as { response?: { data?: { period?: string; value?: string | number }[] } };
  const row = body.response?.data?.[0];
  const dollars = Number(row?.value);
  if (!row?.period || !Number.isFinite(dollars) || dollars <= 0 || dollars > 20) {
    throw new Error('EIA response had no usable price');
  }
  const price = { cents: Math.round(dollars * 100), period: row.period };
  cache.set(areaId, { at: now, price });
  return price;
}
