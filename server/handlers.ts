import type { LatLon } from '../src/domain/types';
import { padUpc } from '../src/domain/upc';
import { isRateLimited } from './errors';
import { clientId, error, json, type Env } from './http';
import { pickCatalogSource, searchCatalog } from './providers';
import { eiaConfig, eiaRegularGas, gasAreaFor } from './providers/eia';
import { krogerConfig, krogerPrices, krogerStoresNear } from './providers/kroger';
import { orsConfig, orsGeocode, orsMatrix, orsRoute, orsState } from './providers/ors';
import { allow } from './rateLimit';

/**
 * Caching. Kroger's terms only allow keeping API content for as long as its cache
 * header permits, and its API sends no cache header, so anything derived from
 * Kroger is `no-store`: not held by the CDN or the browser. Open Food Facts search
 * results are open data and safe to cache. Addresses are personal, so never cache them.
 */
const NO_STORE = 'no-store';
const OPEN_DATA_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

/** Turn an upstream failure into a response without leaking any detail. */
function failure(tag: string, err: unknown, code: string, message: string): Response {
  console.error(`[${tag}] upstream failure:`, err instanceof Error ? err.message : err);
  if (isRateLimited(err)) {
    return error(503, 'busy', 'This service has reached its daily limit. Try again later, or switch to demo data.');
  }
  return error(502, code, message);
}

const num = (v: string | null): number | null =>
  v !== null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;

const validPoint = (lat: number, lon: number) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/* ---------- catalog ---------- */

const MAX_QUERY = 60;
const RESULT_LIMIT = 10;

/** GET /api/catalog/search?q=milk */
export async function catalogSearch(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return error(405, 'method_not_allowed', 'Use GET.');

  const raw = new URL(request.url).searchParams.get('q') ?? '';
  // \p{C} covers control characters, which have no business in a product search.
  const q = raw.replace(/\p{C}/gu, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < 2) return error(400, 'query_too_short', 'Type at least two characters.');
  if (q.length > MAX_QUERY) return error(400, 'query_too_long', `Keep the search under ${MAX_QUERY} characters.`);

  if (!allow(`search:${clientId(request)}`)) return error(429, 'rate_limited', 'Too many searches. Try again in a minute.');

  try {
    const { source, products } = await searchCatalog(env, q, RESULT_LIMIT, AbortSignal.timeout(8000));
    return json({ source, products }, { cache: source === 'kroger' ? NO_STORE : OPEN_DATA_CACHE });
  } catch (err) {
    return failure('catalog', err, 'catalog_unavailable', 'The product catalog is unavailable right now.');
  }
}

/* ---------- Kroger stores and prices ---------- */

/** GET /api/stores?lat=47.6&lon=-122.2&radius=10: Kroger-family stores near a point. */
export async function stores(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return error(405, 'method_not_allowed', 'Use GET.');
  const params = new URL(request.url).searchParams;
  const lat = num(params.get('lat'));
  const lon = num(params.get('lon'));
  const radius = num(params.get('radius')) ?? 10;
  if (lat === null || lon === null || !validPoint(lat, lon)) return error(400, 'bad_location', 'Send lat and lon as numbers.');
  if (radius < 1 || radius > 25) return error(400, 'bad_radius', 'Radius must be between 1 and 25 miles.');

  const config = krogerConfig(env);
  if (!config) return error(501, 'not_configured', 'Live store data is not set up on this server.');
  if (!allow(`stores:${clientId(request)}`, 30)) return error(429, 'rate_limited', 'Too many requests. Try again in a minute.');

  try {
    const found = await krogerStoresNear(config, { lat, lon }, radius, AbortSignal.timeout(8000));
    return json({ stores: found }, { cache: NO_STORE });
  } catch (err) {
    return failure('stores', err, 'stores_unavailable', 'Store data is unavailable right now.');
  }
}

const MAX_PRICE_STORES = 12;
const MAX_PRICE_UPCS = 100;
const STORE_ID = /^kroger:\d{8}$/;

/** GET /api/prices?stores=kroger:70500808,...&upcs=0001111042908,...: shelf prices in cents. */
export async function prices(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return error(405, 'method_not_allowed', 'Use GET.');
  const params = new URL(request.url).searchParams;
  const storeIds = [
    ...new Set(
      (params.get('stores') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  const upcs = [
    ...new Set(
      (params.get('upcs') ?? '')
        .split(',')
        .map((u) => padUpc(u))
        .filter((u): u is string => u !== null),
    ),
  ];
  if (storeIds.length === 0 || storeIds.length > MAX_PRICE_STORES || !storeIds.every((s) => STORE_ID.test(s)))
    return error(400, 'bad_stores', `Send 1 to ${MAX_PRICE_STORES} store ids.`);
  if (upcs.length === 0 || upcs.length > MAX_PRICE_UPCS)
    return error(400, 'bad_upcs', `Send 1 to ${MAX_PRICE_UPCS} product codes.`);

  const config = krogerConfig(env);
  if (!config) return error(501, 'not_configured', 'Live prices are not set up on this server.');
  if (!allow(`prices:${clientId(request)}`, 30)) return error(429, 'rate_limited', 'Too many requests. Try again in a minute.');

  try {
    const result = await krogerPrices(config, storeIds, upcs, AbortSignal.timeout(12000));
    return json({ prices: result, asOf: new Date().toISOString() }, { cache: NO_STORE });
  } catch (err) {
    return failure('prices', err, 'prices_unavailable', 'Prices are unavailable right now.');
  }
}

/* ---------- OpenRouteService: addresses, drive times, route line ---------- */

/** GET /api/geocode?q=1 Main St&lat=47.6&lon=-122.2: address suggestions. lat/lon just bias the results. */
export async function geocode(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return error(405, 'method_not_allowed', 'Use GET.');
  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').replace(/\p{C}/gu, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < 3) return error(400, 'query_too_short', 'Type at least three characters.');
  if (q.length > 120) return error(400, 'query_too_long', 'That address is too long.');

  const lat = num(params.get('lat'));
  const lon = num(params.get('lon'));
  const focus: LatLon | null = lat !== null && lon !== null && validPoint(lat, lon) ? { lat, lon } : null;

  const config = orsConfig(env);
  if (!config) return error(501, 'not_configured', 'Address search is not set up on this server.');
  if (!allow(`geocode:${clientId(request)}`, 30)) return error(429, 'rate_limited', 'Too many searches. Try again in a minute.');

  try {
    const results = await orsGeocode(config, q, focus, AbortSignal.timeout(8000));
    return json({ results }, { cache: NO_STORE });
  } catch (err) {
    return failure('geocode', err, 'geocode_unavailable', 'Address search is unavailable right now.');
  }
}

const MAX_BODY = 4000;

/** Read a small JSON body of `{ points: [{ lat, lon }, ...] }`. Null when it isn't valid. */
async function readPoints(request: Request, min: number, max: number): Promise<LatLon[] | null> {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const list = (parsed as { points?: unknown })?.points;
  if (!Array.isArray(list) || list.length < min || list.length > max) return null;
  const points: LatLon[] = [];
  for (const p of list) {
    const lat = (p as { lat?: unknown })?.lat;
    const lon = (p as { lon?: unknown })?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (!validPoint(lat, lon)) return null;
    points.push({ lat, lon });
  }
  return points;
}

/** POST /api/matrix { points: [...] }: driving miles and minutes between every pair. */
export async function matrix(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return error(405, 'method_not_allowed', 'Use POST.');
  const points = await readPoints(request, 2, 14);
  if (!points) return error(400, 'bad_points', 'Send 2 to 14 points as { lat, lon }.');

  const config = orsConfig(env);
  if (!config) return error(501, 'not_configured', 'Drive times are not set up on this server.');
  if (!allow(`matrix:${clientId(request)}`, 20)) return error(429, 'rate_limited', 'Too many requests. Try again in a minute.');

  try {
    return json(await orsMatrix(config, points, AbortSignal.timeout(10000)), { cache: NO_STORE });
  } catch (err) {
    return failure('matrix', err, 'routing_unavailable', 'Drive times are unavailable right now.');
  }
}

/** POST /api/route { points: [...] }: the road line through the points, in order. */
export async function route(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return error(405, 'method_not_allowed', 'Use POST.');
  const points = await readPoints(request, 2, 6);
  if (!points) return error(400, 'bad_points', 'Send 2 to 6 points as { lat, lon }.');

  const config = orsConfig(env);
  if (!config) return error(501, 'not_configured', 'Routes are not set up on this server.');
  if (!allow(`route:${clientId(request)}`, 20)) return error(429, 'rate_limited', 'Too many requests. Try again in a minute.');

  try {
    const line = await orsRoute(config, points, AbortSignal.timeout(10000));
    return json({ route: line }, { cache: NO_STORE });
  } catch (err) {
    return failure('route', err, 'routing_unavailable', 'Routes are unavailable right now.');
  }
}

/* ---------- gas prices ---------- */

/** GET /api/gas?lat=47.6&lon=-122.2: this week's average price of regular gas near a point (EIA). */
export async function gas(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return error(405, 'method_not_allowed', 'Use GET.');
  const params = new URL(request.url).searchParams;
  const lat = num(params.get('lat'));
  const lon = num(params.get('lon'));
  if (lat === null || lon === null || !validPoint(lat, lon)) return error(400, 'bad_location', 'Send lat and lon as numbers.');

  const eia = eiaConfig(env);
  if (!eia) return error(501, 'not_configured', 'Gas prices are not set up on this server.');
  if (!allow(`gas:${clientId(request)}`, 30)) return error(429, 'rate_limited', 'Too many requests. Try again in a minute.');

  try {
    // The state is only used to pick the right EIA series. If it can't be found, the
    // nearest metro area or the national average still gives a sensible price.
    let state: string | null = null;
    const ors = orsConfig(env);
    if (ors) {
      try {
        state = await orsState(ors, { lat, lon }, AbortSignal.timeout(5000));
      } catch (err) {
        console.error('[gas] state lookup failed:', err instanceof Error ? err.message : err);
      }
    }
    const area = gasAreaFor({ lat, lon }, state);
    const price = await eiaRegularGas(eia, area.id, AbortSignal.timeout(8000));
    // EIA data is public, but the answer depends on where you are, so keep it to the browser.
    return json(
      { cents: price.cents, period: price.period, area: { id: area.id, name: area.name, kind: area.kind }, source: 'U.S. Energy Information Administration' },
      { cache: 'private, max-age=3600' },
    );
  } catch (err) {
    return failure('gas', err, 'gas_unavailable', 'Gas prices are unavailable right now.');
  }
}

/* ---------- health ---------- */

/** GET /api/health: lets the app see what this server can do. Never returns secrets. */
export async function health(_request: Request, env: Env): Promise<Response> {
  return json({
    ok: true,
    catalog: pickCatalogSource(env),
    livePrices: krogerConfig(env) !== null,
    liveRouting: orsConfig(env) !== null,
    liveGas: eiaConfig(env) !== null,
  });
}
