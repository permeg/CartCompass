import { padUpc } from '../src/domain/upc';
import { clientId, error, json, type Env } from './http';
import { pickCatalogSource, searchCatalog } from './providers';
import { krogerConfig, krogerPrices, krogerStoresNear } from './providers/kroger';
import { allow } from './rateLimit';

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
    // Popular searches repeat a lot, so let the CDN hold on to them.
    return json({ source, products }, { cache: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' });
  } catch (err) {
    // Log the reason on the server, but never send upstream details to the browser.
    console.error('[catalog] upstream failure:', err instanceof Error ? err.message : err);
    return error(502, 'catalog_unavailable', 'The product catalog is unavailable right now.');
  }
}

const num = (v: string | null): number | null =>
  v !== null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;

/** GET /api/stores?lat=47.6&lon=-122.2&radius=10: Kroger-family stores near a point. */
export async function stores(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return error(405, 'method_not_allowed', 'Use GET.');
  const params = new URL(request.url).searchParams;
  const lat = num(params.get('lat'));
  const lon = num(params.get('lon'));
  const radius = num(params.get('radius')) ?? 10;
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return error(400, 'bad_location', 'Send lat and lon as numbers.');
  if (radius < 1 || radius > 25) return error(400, 'bad_radius', 'Radius must be between 1 and 25 miles.');

  const config = krogerConfig(env);
  if (!config) return error(501, 'not_configured', 'Live store data is not set up on this server.');
  if (!allow(`stores:${clientId(request)}`, 30)) return error(429, 'rate_limited', 'Too many requests. Try again in a minute.');

  try {
    const found = await krogerStoresNear(config, { lat, lon }, radius, AbortSignal.timeout(8000));
    return json({ stores: found }, { cache: 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400' });
  } catch (err) {
    console.error('[stores] upstream failure:', err instanceof Error ? err.message : err);
    return error(502, 'stores_unavailable', 'Store data is unavailable right now.');
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
    return json(
      { prices: result, asOf: new Date().toISOString() },
      { cache: 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600' },
    );
  } catch (err) {
    console.error('[prices] upstream failure:', err instanceof Error ? err.message : err);
    return error(502, 'prices_unavailable', 'Prices are unavailable right now.');
  }
}

/** GET /api/health: lets the app see what this server can do. Never returns secrets. */
export async function health(_request: Request, env: Env): Promise<Response> {
  return json({ ok: true, catalog: pickCatalogSource(env), livePrices: krogerConfig(env) !== null });
}
