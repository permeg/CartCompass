import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogSearch, health } from './handlers';
import { inferCategory, tidyName } from './normalize';
import { pickCatalogSource } from './providers';
import { resetKrogerToken } from './providers/kroger';
import { resetRateLimit } from './rateLimit';

const search = (q: string, init?: RequestInit, headers: Record<string, string> = {}) =>
  catalogSearch(
    new Request(`http://localhost/api/catalog/search?q=${encodeURIComponent(q)}`, {
      ...init,
      headers: { 'x-forwarded-for': '203.0.113.7', ...headers },
    }),
    process.env,
  );

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const savedEnv = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  delete process.env.KROGER_CLIENT_ID;
  delete process.env.KROGER_CLIENT_SECRET;
  delete process.env.KROGER_LOCATION_ID;
  delete process.env.CATALOG_PROVIDER;
  resetRateLimit();
  resetKrogerToken();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('catalogSearch validation', () => {
  it('rejects short, long and missing queries', async () => {
    expect((await search('a')).status).toBe(400);
    expect((await search('   ')).status).toBe(400);
    expect((await search('x'.repeat(61))).status).toBe(400);
    expect((await catalogSearch(new Request('http://localhost/api/catalog/search'), process.env)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('only allows GET', async () => {
    const res = await search('milk', { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('rate limits a single client', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ hits: [] }));
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await search(`milk ${i}`)).status;
    expect(last).toBe(429);
    // A different client is unaffected.
    expect((await search('milk', undefined, { 'x-forwarded-for': '198.51.100.9' })).status).toBe(200);
  });
});

describe('Open Food Facts (no keys)', () => {
  const hits = [
    {
      code: '0011110429087',
      product_name: 'ORGANIC WHOLE MILK',
      brands: ['Simple Truth Organic', 'The Kroger Co.'],
      quantity: '1 Gal (3.78 L)',
      categories_tags: ['en:milks', 'en:whole-milks'],
      image_front_small_url: 'https://images.example/milk.jpg',
    },
    { code: '0011110429087', product_name: 'Organic whole milk', brands: ['Simple Truth Organic'], quantity: '1 gal (3.78 l)' },
    { code: '1', product_name: '  ' },
    { product_name: 'No barcode' },
    {
      code: '0627893000049',
      product_name: 'Cucumber',
      brands: null,
      quantity: null,
      categories_tags: ['en:vegetables', 'en:fresh-cucumbers'],
    },
  ];

  it('normalizes results and drops junk', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hits }));
    const res = await search('milk');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; products: Record<string, unknown>[] };
    expect(body.source).toBe('openfoodfacts');
    expect(body.products.map((p) => p.id)).toEqual(['off:0011110429087', 'off:0627893000049']);
    expect(body.products[0]).toMatchObject({
      name: 'Organic whole milk',
      size: '1 Gal (3.78 L)',
      category: 'Dairy & eggs',
      brand: 'Simple Truth Organic',
      upc: '0011110429087',
      source: 'openfoodfacts',
    });
    expect(body.products[1]).toMatchObject({ name: 'Cucumber', size: '', category: 'Produce' });
  });

  it('asks for US products and identifies itself', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hits: [] }));
    await search('cucumber');
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.host).toBe('search.openfoodfacts.org');
    expect(url.searchParams.get('q')).toBe('cucumber countries_tags:"en:united-states"');
    expect((init.headers as Record<string, string>)['user-agent']).toMatch(/CartCompass/);
  });

  it('lets the CDN cache successful searches', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hits: [] }));
    const res = await search('rice');
    expect(res.headers.get('cache-control')).toContain('s-maxage');
  });

  it('turns an upstream failure into a 502 with no upstream detail', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Page temporarily unavailable</html>', { status: 503 }));
    const res = await search('milk');
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('temporarily unavailable');
    expect(text).not.toContain('503');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('survives a network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect((await search('milk')).status).toBe(502);
  });
});

describe('Kroger (with keys)', () => {
  beforeEach(() => {
    process.env.KROGER_CLIENT_ID = 'test-id';
    process.env.KROGER_CLIENT_SECRET = 'test-secret';
  });

  const krogerProducts = {
    data: [
      {
        productId: '0001111041700',
        upc: '0001111041700',
        brand: 'Kroger',
        description: 'Kroger® Vitamin D Whole Milk',
        categories: ['Dairy'],
        images: [{ perspective: 'front', sizes: [{ size: 'thumbnail', url: 'https://img.example/m.jpg' }] }],
        items: [{ size: '1 gal', price: { regular: 3.49, promo: 2.99 } }],
      },
      { productId: '2', description: '' },
    ],
  };

  it('fetches a token, searches with it, and normalizes', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 1800 }))
      .mockResolvedValueOnce(jsonResponse(krogerProducts));
    const res = await search('milk');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; products: Record<string, unknown>[] };
    expect(body.source).toBe('kroger');
    expect(body.products).toHaveLength(1);
    expect(body.products[0]).toMatchObject({
      id: 'kroger:0001111041700',
      name: 'Kroger® Vitamin D Whole Milk',
      size: '1 gal',
      category: 'Dairy & eggs',
      brand: 'Kroger',
      referencePrice: 349,
      imageUrl: 'https://img.example/m.jpg',
    });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toContain('/connect/oauth2/token');
    const basic = (tokenInit.headers as Record<string, string>).authorization;
    expect(Buffer.from(basic.replace('Basic ', ''), 'base64').toString()).toBe('test-id:test-secret');

    const [productUrl, productInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(productUrl.searchParams.get('filter.term')).toBe('milk');
    expect((productInit.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
  });

  it('reuses the token across searches', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 1800 }))
      .mockResolvedValue(jsonResponse(krogerProducts));
    await search('milk');
    await search('eggs');
    const tokenCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('oauth2/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('sends the store location when one is configured', async () => {
    process.env.KROGER_LOCATION_ID = '70100123';
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 't', expires_in: 1800 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    await search('milk');
    const [productUrl] = fetchMock.mock.calls[1] as [URL];
    expect(productUrl.searchParams.get('filter.locationId')).toBe('70100123');
  });

  it('never leaks credentials when Kroger rejects them', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_client', echoed: 'test-secret' }, 401));
    const res = await search('milk');
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('test-secret');
    const logged = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ');
    expect(logged).not.toContain('test-secret');
  });
});

describe('provider selection and health', () => {
  it('uses Kroger only when both keys are present', () => {
    expect(pickCatalogSource({})).toBe('openfoodfacts');
    expect(pickCatalogSource({ KROGER_CLIENT_ID: 'a' })).toBe('openfoodfacts');
    expect(pickCatalogSource({ KROGER_CLIENT_ID: 'a', KROGER_CLIENT_SECRET: 'b' })).toBe('kroger');
  });

  it('can be forced to Open Food Facts', () => {
    expect(
      pickCatalogSource({ KROGER_CLIENT_ID: 'a', KROGER_CLIENT_SECRET: 'b', CATALOG_PROVIDER: 'openfoodfacts' }),
    ).toBe('openfoodfacts');
  });

  it('health reports the provider and nothing secret', async () => {
    process.env.KROGER_CLIENT_ID = 'test-id';
    process.env.KROGER_CLIENT_SECRET = 'test-secret';
    const text = await (await health(new Request('http://localhost/api/health'), process.env)).text();
    expect(JSON.parse(text)).toEqual({ ok: true, catalog: 'kroger', livePrices: true });
    expect(text).not.toContain('test-');
  });
});

describe('normalize', () => {
  it('sorts products into aisles', () => {
    expect(inferCategory(['en:plant-based-foods-and-beverages', 'en:vegetables', 'en:fresh-cucumbers'])).toBe('Produce');
    expect(inferCategory(['en:milks', 'en:whole-milks'])).toBe('Dairy & eggs');
    expect(inferCategory(['en:peanut-butters'])).toBe('Pantry');
    expect(inferCategory(['en:frozen-foods', 'en:frozen-vegetables'])).toBe('Frozen');
    expect(inferCategory(['en:canned-vegetables'])).toBe('Pantry');
    expect(inferCategory(['Meat & Seafood'])).toBe('Meat & seafood');
    expect(inferCategory(['Cleaning Products'])).toBe('Household');
    expect(inferCategory(['en:breads'])).toBe('Bakery');
    expect(inferCategory([])).toBe('Pantry');
  });

  it('tidies shouting names', () => {
    expect(tidyName('WHOLE MILK')).toBe('Whole milk');
    expect(tidyName('  organic   eggs ')).toBe('Organic eggs');
    expect(tidyName('Kroger® Milk')).toBe('Kroger® Milk');
  });
});
