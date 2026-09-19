import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogSearch, starter } from './handlers';
import {
  chainLabel,
  isShoppableStore,
  normalizeLocation,
  resetKrogerToken,
  storeName,
  tidyCase,
} from './providers/kroger';
import { resetRateLimit } from './rateLimit';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const get = (path: string) => new Request(`http://localhost${path}`, { headers: { 'x-forwarded-for': '203.0.113.7' } });
const KEYS = { KROGER_CLIENT_ID: 'test-id', KROGER_CLIENT_SECRET: 'test-secret' };
const token = () => jsonResponse({ access_token: 'tok', expires_in: 1800 });

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

describe('Kroger banners across the country', () => {
  it('names every banner the way its customers do', () => {
    expect(chainLabel('HART')).toBe('Harris Teeter');
    expect(chainLabel('KINGSOOPERS')).toBe('King Soopers');
    expect(chainLabel('FRYS')).toBe("Fry's");
    expect(chainLabel('SMITHS')).toBe("Smith's");
    expect(chainLabel('MARIANOS')).toBe("Mariano's");
    expect(chainLabel('PICK N SAVE')).toBe("Pick 'n Save");
    expect(chainLabel('METRO MARKET')).toBe('Metro Market');
    expect(chainLabel('SOMENEWBANNER')).toBe('Somenewbanner'); // still readable when Kroger adds one
  });

  it('cleans up the repeated banner in store names', () => {
    expect(storeName('MARIANOS', 'Marianos - Marianos Lakeshore East')).toBe("Mariano's Lakeshore East");
    expect(storeName('FRYS', "Fry's Food And Drug - Frys Food And Drug Phoenix")).toBe("Fry's Food And Drug Phoenix");
    expect(storeName('KINGSOOPERS', 'King Soopers - Speer Blvd')).toBe('King Soopers Speer Blvd');
    expect(storeName('HART', 'Harris Teeter - Fifth and Poplar')).toBe('Harris Teeter Fifth and Poplar');
    expect(storeName('RALPHS', 'Ralphs Fresh Fare - 9th Flower')).toBe('Ralphs 9th Flower');
    expect(storeName('QFC', 'Quality Food Center - Bellevue East')).toBe('QFC Bellevue East');
    expect(storeName('KROGER', 'Kroger - K Street')).toBe('Kroger K Street'); // a lone "K" is a place, not the banner
    expect(storeName('KROGER', 'Kroger - Glenwood Kroger')).toBe('Kroger Glenwood');
    expect(storeName('KINGSOOPERS', 'King Soopers - CAPITOL HILL')).toBe('King Soopers Capitol Hill');
  });

  it('tidies shouted addresses', () => {
    expect(tidyCase('1155 E 9Th Ave')).toBe('1155 E 9th Ave');
    expect(tidyCase('CHICAGO')).toBe('Chicago');
    expect(tidyCase('2041 148Th Ave Ne')).toBe('2041 148th Ave NE');
    expect(tidyCase('10116 NE 8th St STE 1')).toBe('10116 NE 8th St STE 1');
  });

  it('drops distribution centers, hubs and test entries', () => {
    const depts = Array.from({ length: 20 }, () => ({}));
    expect(isShoppableStore({ chain: 'HART', name: 'Harris Teeter - Fifth and Poplar', departments: depts })).toBe(true);
    expect(isShoppableStore({ chain: 'VITACOST', name: 'VitaCost DC Nevada', departments: depts })).toBe(false);
    expect(isShoppableStore({ chain: 'HART', name: 'Harris Teeter - - Unused Spoke', departments: depts })).toBe(false);
    expect(isShoppableStore({ chain: 'KROGER', name: 'Kroger - - Phoenix Shed', departments: depts })).toBe(false);
    expect(isShoppableStore({ chain: 'KROGER', name: 'Kroger - Fulfillment Center', departments: depts })).toBe(false);
    expect(isShoppableStore({ chain: 'KROGER', name: 'Kroger - Tiny', departments: [{}, {}] })).toBe(false);
    // "DC" as part of a word must not count ("Mcdc" is silly, but "Dcville" shouldn't be dropped)
    expect(isShoppableStore({ chain: 'KROGER', name: 'Kroger - Dcville Commons', departments: depts })).toBe(true);
  });

  it('skips non-stores when reading locations', () => {
    const loc = { locationId: '1', chain: 'VITACOST', name: 'VitaCost DC', geolocation: { latLng: '1,2' }, departments: [{}, {}, {}, {}, {}, {}] };
    expect(normalizeLocation(loc)).toBeNull();
  });
});

describe('store-aware search', () => {
  const product = (id: string, description: string, regular?: number, extra: object = {}) => ({
    productId: id,
    upc: id,
    description,
    brand: 'Brand',
    items: [{ size: '1 gal', ...(regular ? { price: { regular } } : {}), ...extra }],
  });

  it('only returns what the store sells, priced at that store', async () => {
    fetchMock.mockResolvedValueOnce(token()).mockResolvedValueOnce(
      jsonResponse({
        data: [
          product('0000000000011', 'Sold milk', 3.49, { price: { regular: 3.49, promo: 2.99 } }),
          product('0000000000012', 'Not sold here'),
          product('0000000000013', 'Sold out', 4.99, { inventory: { stockLevel: 'TEMPORARILY_OUT_OF_STOCK' } }),
        ],
      }),
    );
    const res = await catalogSearch(get('/api/catalog/search?q=milk&store=kroger:70500808'), KEYS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: { name: string; referencePrice: number }[] };
    expect(body.products).toHaveLength(1);
    expect(body.products[0]).toMatchObject({ name: 'Sold milk', referencePrice: 299 });
    const url = fetchMock.mock.calls[1][0] as URL;
    expect(url.searchParams.get('filter.locationId')).toBe('70500808');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('without a store, searches the whole catalog as before', async () => {
    fetchMock.mockResolvedValueOnce(token()).mockResolvedValueOnce(jsonResponse({ data: [product('0000000000012', 'Anywhere milk')] }));
    const res = await catalogSearch(get('/api/catalog/search?q=milk'), KEYS);
    expect(((await res.json()) as { products: unknown[] }).products).toHaveLength(1);
    expect((fetchMock.mock.calls[1][0] as URL).searchParams.has('filter.locationId')).toBe(false);
  });

  it('rejects a malformed store id', async () => {
    for (const bad of ['70500808', 'kroger:1', 'kroger:abc', 'other:70500808']) {
      expect((await catalogSearch(get(`/api/catalog/search?q=milk&store=${bad}`), KEYS)).status, bad).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/starter', () => {
  const stocked = (term: string) =>
    jsonResponse({
      data: [
        {
          productId: `00000000${String(term.length).padStart(5, '0')}`,
          description: `Some ${term}`,
          items: [{ size: '1 ea', price: { regular: 2.5 } }],
        },
      ],
    });

  it('builds a list from what the store carries, skipping what it does not', async () => {
    fetchMock.mockResolvedValueOnce(token()).mockImplementation(async (url: URL) => {
      const term = url.searchParams.get('filter.term') ?? '';
      return term === 'olive oil' || term === 'cucumber' ? jsonResponse({ data: [] }) : stocked(term);
    });
    const res = await starter(get('/api/starter?store=kroger:09700205'), KEYS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { product: { name: string; referencePrice: number }; qty: number }[] };
    expect(body.items.length).toBe(13); // 15 staples, 2 not stocked
    expect(body.items.every((i) => i.product.referencePrice === 250)).toBe(true);
    expect(body.items.find((i) => i.product.name === 'Some bananas')?.qty).toBe(3);
    expect(body.items.some((i) => /olive oil|cucumber/.test(i.product.name))).toBe(false);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('asks Kroger for one token, even though it searches fifteen things at once', async () => {
    fetchMock.mockImplementation(async (url: URL | string) =>
      String(url).includes('oauth2/token') ? token() : jsonResponse({ data: [] }),
    );
    await starter(get('/api/starter?store=kroger:09700205'), KEYS);
    const tokenCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('oauth2/token'));
    expect(tokenCalls).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/products'))).toHaveLength(15);
  });

  it('fails cleanly when Kroger is down, and validates the store', async () => {
    fetchMock.mockResolvedValueOnce(token()).mockImplementation(async () => new Response('down', { status: 503 }));
    expect((await starter(get('/api/starter?store=kroger:09700205'), KEYS)).status).toBe(502);
    expect((await starter(get('/api/starter'), KEYS)).status).toBe(400);
    expect((await starter(get('/api/starter?store=nope'), KEYS)).status).toBe(400);
    expect((await starter(get('/api/starter?store=kroger:09700205'), {})).status).toBe(501);
  });

  it('is rate limited tightly, since one request is fifteen searches', async () => {
    fetchMock.mockImplementation(async (url: URL | string) =>
      String(url).includes('oauth2/token') ? token() : jsonResponse({ data: [] }),
    );
    let last = 200;
    for (let i = 0; i < 6; i++) last = (await starter(get('/api/starter?store=kroger:09700205'), KEYS)).status;
    expect(last).toBe(429);
  });
});
