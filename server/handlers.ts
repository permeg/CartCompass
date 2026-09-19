import { clientId, error, json, type Env } from './http';
import { pickCatalogSource, searchCatalog } from './providers';
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

  if (!allow(clientId(request))) return error(429, 'rate_limited', 'Too many searches. Try again in a minute.');

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

/** GET /api/health: lets the app check the proxy is there. Never returns secrets. */
export async function health(_request: Request, env: Env): Promise<Response> {
  return json({ ok: true, catalog: pickCatalogSource(env) });
}
