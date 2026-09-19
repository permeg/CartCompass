import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { padUpc } from '../src/domain/upc';
import { health, prices, stores } from './handlers';
import { normalizeLocation, resetKrogerToken, shelfPriceCents, storeName } from './providers/kroger';
import { resetRateLimit } from './rateLimit';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const req = (path: string, init?: RequestInit) =>
  new Request(`http://localhost${path}`, { headers: { 'x-forwarded-for': '203.0.113.7' }, ...init });

const KEYS = { KROGER_CLIENT_ID: 'test-id', KROGER_CLIENT_SECRET: 'test-secret' };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetRateLimit();
  resetKrogerToken();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Shapes copied from real Kroger responses.
const location = (id: string, chain: string, name: string, latLng: string, line1 = '1 Main St') => ({
  locationId: id,
  chain,
  name,
  address: { addressLine1: line1, city: 'Bellevue', zipCode: '98004' },
  geolocation: { latLng },
});

const token = () => jsonResponse({ access_token: 'tok', expires_in: 1800 });

describe('UPC codes', () => {
  it('pads to 13 digits and rejects junk', () => {
    expect(padUpc('11110429087')).toBe('0011110429087');
    expect(padUpc('0001111042908')).toBe('0001111042908');
    expect(padUpc('  0-001111-042908 ')).toBe('0001111042908');
    expect(padUpc('abc')).toBeNull();
    expect(padUpc('123')).toBeNull();
    expect(padUpc(undefined)).toBeNull();
  });
});

describe('store names', () => {
  it('drops the repeated chain', () => {
    expect(storeName('QFC', 'Quality Food Center - Bellevue East')).toBe('QFC Bellevue East');
    expect(storeName('QFC', 'Quality Food Center - QFC Totem Lake')).toBe('QFC Totem Lake');
    expect(storeName('FRED', 'Fred Meyer - Bellevue')).toBe('Fred Meyer Bellevue');
    expect(storeName('FRED', 'Fred Meyer - Fred Meyer Kirkland')).toBe('Fred Meyer Kirkland');
    expect(storeName('KROGER', 'Kroger - Downtown')).toBe('Kroger Downtown');
  });

  it('reads coordinates from a latLng string and skips stores without any', () => {
    const s = normalizeLocation(location('70500808', 'QFC', 'Quality Food Center - Bellevue', '47.618564,-122.205617'));
    expect(s).toMatchObject({ id: 'kroger:70500808', chain: 'QFC', lat: 47.618564, lon: -122.205617 });
    expect(normalizeLocation({ locationId: '1', chain: 'QFC', name: 'x' })).toBeNull();
  });
});

describe('shelf prices', () => {
  it('uses the sale price when there is one', () => {
    expect(shelfPriceCents({ items: [{ price: { regular: 4.99, promo: 3.99 } }] })).toBe(399);
    expect(shelfPriceCents({ items: [{ price: { regular: 4.99 } }] })).toBe(499);
    expect(shelfPriceCents({ items: [{ price: { regular: 0.55 } }] })).toBe(55);
  });

  it('treats unavailable products as not sold', () => {
    expect(shelfPriceCents({ items: [{}] })).toBeNull(); // no price at this store
    expect(
      shelfPriceCents({ items: [{ price: { regular: 4.99 }, inventory: { stockLevel: 'TEMPORARILY_OUT_OF_STOCK' } }] }),
    ).toBeNull();
    expect(shelfPriceCents({ items: [{ price: { regular: 4.99 }, fulfillment: { inStore: false } }] })).toBeNull();
    expect(shelfPriceCents({})).toBeNull();
  });
});

describe('GET /api/stores', () => {
  it('returns the nearest stores of each chain, closest first', async () => {
    const qfcs = Array.from({ length: 6 }, (_, i) =>
      location(`7050000${i}`, 'QFC', `Quality Food Center - Spot ${i}`, `${47.61 + i * 0.01},-122.18`),
    );
    fetchMock.mockResolvedValueOnce(token()).mockResolvedValueOnce(
      jsonResponse({
        data: [...qfcs, location('70100023', 'FRED', 'Fred Meyer - Bellevue', '47.6288,-122.1446')],
      }),
    );
    const res = await stores(req('/api/stores?lat=47.606&lon=-122.183&radius=10'), KEYS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stores: { id: string; chain: string }[] };
    // Three QFCs at most, plus the Fred Meyer.
    expect(body.stores.filter((s) => s.chain === 'QFC')).toHaveLength(3);
    expect(body.stores.some((s) => s.id === 'kroger:70100023')).toBe(true);
    expect(res.headers.get('cache-control')).toContain('s-maxage');

    const url = fetchMock.mock.calls[1][0] as URL;
    expect(url.pathname).toBe('/v1/locations');
    expect(url.searchParams.get('filter.latLong.near')).toBe('47.606,-122.183');
  });

  it('validates input before calling Kroger', async () => {
    for (const q of ['?lat=abc&lon=1', '?lat=95&lon=1', '?lat=47&lon=-122&radius=99', '?lat=47&lon=-122&radius=0', '']) {
      expect((await stores(req(`/api/stores${q}`), KEYS)).status).toBe(400);
    }
    expect((await stores(req('/api/stores?lat=1&lon=1', { method: 'POST' }), KEYS)).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says so plainly when the server has no keys', async () => {
    const res = await stores(req('/api/stores?lat=47&lon=-122'), {});
    expect(res.status).toBe(501);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides upstream failures', async () => {
    fetchMock.mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response('kaboom', { status: 500 }));
    const res = await stores(req('/api/stores?lat=47&lon=-122'), KEYS);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('kaboom');
  });
});

describe('GET /api/prices', () => {
  const priced = (id: string, regular?: number, extra: object = {}) => ({
    productId: id,
    upc: id,
    items: [{ size: '1 gal', ...(regular ? { price: { regular } } : {}), ...extra }],
  });

  it('prices each store and drops products it cannot sell', async () => {
    fetchMock.mockResolvedValueOnce(token()).mockImplementation(async (url: URL) =>
      url.searchParams.get('filter.locationId') === '70500808'
        ? jsonResponse({ data: [priced('0001111042908', 7.99), priced('0001111013416', 3.99), priced('0000000004011')] })
        : jsonResponse({ data: [priced('0001111042908', 7.49), priced('0001111013416', 2)] }),
    );
    const res = await prices(
      req('/api/prices?stores=kroger:70500808,kroger:70100023&upcs=0001111042908,0001111013416,4011,11110429087'),
      KEYS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { prices: Record<string, Record<string, number>>; asOf: string };
    expect(body.prices['kroger:70500808']).toEqual({ '0001111042908': 799, '0001111013416': 399 });
    expect(body.prices['kroger:70100023']).toEqual({ '0001111042908': 749, '0001111013416': 200 });
    expect(Date.parse(body.asOf)).not.toBeNaN();

    // One token, then one product request per store, with padded codes.
    const productCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/products'));
    expect(productCalls).toHaveLength(2);
    const codes = (productCalls[0][0] as URL).searchParams.get('filter.productId')!.split(',');
    expect(codes).toContain('0011110429087');
    expect(codes.every((c) => c.length === 13)).toBe(true);
  });

  it('splits big lists into batches of 50', async () => {
    fetchMock.mockResolvedValueOnce(token()).mockImplementation(async () => jsonResponse({ data: [] }));
    const upcs = Array.from({ length: 70 }, (_, i) => String(1000000000000 + i)).join(',');
    await prices(req(`/api/prices?stores=kroger:70500808&upcs=${upcs}`), KEYS);
    const productCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/products'));
    expect(productCalls).toHaveLength(2);
  });

  it('validates ids and sizes', async () => {
    const tooManyStores = Array.from({ length: 13 }, (_, i) => `kroger:${70500000 + i}`).join(',');
    const tooManyCodes = Array.from({ length: 101 }, (_, i) => String(2000000000000 + i)).join(',');
    const bad = [
      '/api/prices',
      '/api/prices?stores=kroger:70500808',
      '/api/prices?stores=70500808&upcs=0001111042908',
      '/api/prices?stores=kroger:1&upcs=0001111042908',
      '/api/prices?stores=kroger:70500808&upcs=nope',
      `/api/prices?stores=${tooManyStores}&upcs=0001111042908`,
      `/api/prices?stores=kroger:70500808&upcs=${tooManyCodes}`,
    ];
    for (const path of bad) expect((await prices(req(path), KEYS)).status, path).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate limits per client', async () => {
    fetchMock.mockResolvedValueOnce(token()).mockImplementation(async () => jsonResponse({ data: [] }));
    let last = 200;
    for (let i = 0; i < 31; i++) {
      last = (await prices(req('/api/prices?stores=kroger:70500808&upcs=0001111042908'), KEYS)).status;
    }
    expect(last).toBe(429);
  });

  it('fails as a 502 when Kroger errors, without leaking detail', async () => {
    fetchMock.mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response('secret internals', { status: 503 }));
    const res = await prices(req('/api/prices?stores=kroger:70500808&upcs=0001111042908'), KEYS);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('secret internals');
  });
});

describe('health', () => {
  it('reports whether live prices are available', async () => {
    const yes = await (await health(req('/api/health'), KEYS)).json();
    const no = await (await health(req('/api/health'), {})).json();
    expect(yes).toMatchObject({ livePrices: true });
    expect(no).toMatchObject({ livePrices: false, catalog: 'openfoodfacts' });
  });
});
