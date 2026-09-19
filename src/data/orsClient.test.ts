import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product, Store } from '../domain/types';
import { liveRouting, searchAddresses, shortLabel } from './orsClient';
import { demoProviders, loadMarket, type Providers } from './providers';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const home = { lat: 47.606, lon: -122.183 };
const store = { lat: 47.6288, lon: -122.1446 };

describe('shortLabel', () => {
  it('drops the country', () => {
    expect(shortLabel('1 Main St, Bellevue, WA, USA')).toBe('1 Main St, Bellevue, WA');
    expect(shortLabel('98004, Bellevue, WA, United States')).toBe('98004, Bellevue, WA');
    expect(shortLabel('Wilburton')).toBe('Wilburton');
  });
});

describe('searchAddresses', () => {
  it('maps results and passes the bias point', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        results: [
          { label: '1 Main St, Bellevue, WA, USA', lat: 47.6, lon: -122.2, kind: 'address' },
          { label: 'broken', lat: 'x', lon: 1 },
        ],
      }),
    );
    const results = await searchAddresses('1 main', home);
    expect(results).toEqual([{ label: '1 Main St, Bellevue, WA', lat: 47.6, lon: -122.2, kind: 'address' }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('lat=47.606');
  });

  it('throws when the server says no', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 502 }));
    await expect(searchAddresses('1 main', null)).rejects.toThrow();
  });
});

describe('liveRouting', () => {
  it('accepts a well-formed matrix', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ miles: [[0, 1], [1, 0]], minutes: [[0, 4], [4, 0]] }),
    );
    const m = await liveRouting.matrix([home, store]);
    expect(m.minutes[0][1]).toBe(4);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
  });

  it('rejects a matrix of the wrong size', async () => {
    fetchMock.mockResolvedValueOnce(ok({ miles: [[0]], minutes: [[0]] }));
    await expect(liveRouting.matrix([home, store])).rejects.toThrow();
  });

  it('returns null rather than a route that does not fit the waypoints', async () => {
    fetchMock.mockResolvedValueOnce(ok({ route: { coordinates: [home, store], wayPoints: [0], miles: 1, minutes: 1 } }));
    expect(await liveRouting.routeLine!([home, store, home])).toBeNull();
  });
});

describe('loadMarket with live routing', () => {
  const product: Product = { id: 'p', name: 'p', size: '', category: 'Pantry', upc: '0001111042908' };
  const stores: Store[] = [{ id: 's1', name: 'S1', blurb: '', ...store }];

  const liveProviders = (matrix: Providers['routing']['matrix']): Providers => ({
    ...demoProviders,
    sources: { stores: 'live', prices: 'live', routing: 'live', gas: 'demo' },
    stores: { storesNear: async () => stores },
    prices: { getPrices: async () => ({ prices: { s1: { p: 100 } }, asOf: null }) },
    routing: { matrix },
  });

  it('keeps live drive times when they load', async () => {
    const market = await loadMarket(home, [product], 10, liveProviders(async () => ({ miles: [[0, 3], [3, 0]], minutes: [[0, 9], [9, 0]] })));
    expect(market.sources.routing).toBe('live');
    expect(market.miles[0][1]).toBe(3);
  });

  it('falls back to estimates, and says so, when drive times fail', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const market = await loadMarket(home, [product], 10, liveProviders(async () => Promise.reject(new Error('down'))));
    expect(market.sources.routing).toBe('demo');
    expect(market.sources.prices).toBe('live');
    expect(market.miles[0][1]).toBeGreaterThan(0);
  });
});
