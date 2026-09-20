import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scaleFromKroger, chainByKey } from '../domain/chains';
import { roundEstimate } from '../domain/estimate';
import type { Market, Product, Store } from '../domain/types';
import { livePlaces } from './placesClient';
import { addEstimatedStores, demoProviders, type Providers } from './providers';

const origin = { lat: 47.606, lon: -122.183 };
const product = (id: string, extra: Partial<Product> = {}): Product => ({ id, name: id, size: '', category: 'Pantry', ...extra });
const real = (id: string): Store => ({ id, name: id, blurb: '', lat: 47.62, lon: -122.14, chain: 'QFC' });
const walmart: Store = { id: 'osm:node/1', name: 'Walmart', blurb: '', lat: 47.63, lon: -122.13, estimated: true, chainKey: 'walmart' };
const aldi: Store = { id: 'osm:node/2', name: 'Aldi', blurb: '', lat: 47.64, lon: -122.12, estimated: true, chainKey: 'aldi' };

const baseMarket = (stores: Store[] = [real('k1')]): Market => ({
  origin,
  stores,
  prices: Object.fromEntries(stores.map((s) => [s.id, { milk: 400, oats: 600 }])),
  gasPrice: 500,
  miles: [[0, ...stores.map(() => 2)], ...stores.map(() => [2, ...stores.map(() => 1)])],
  minutes: [[0, ...stores.map(() => 6)], ...stores.map(() => [6, ...stores.map(() => 3)])],
  requested: new Set(['milk', 'oats']),
  sources: { stores: 'live', prices: 'live', routing: 'live', gas: 'live' },
  pricesAsOf: null,
});

const providers = (
  placesNear: (() => Promise<Store[]>) | undefined,
  matrix: Providers['routing']['matrix'] = async (points) => ({
    miles: points.map((_, i) => points.map((__, j) => (i === j ? 0 : 3))),
    minutes: points.map((_, i) => points.map((__, j) => (i === j ? 0 : 9))),
  }),
): Providers => ({
  ...demoProviders,
  places: placesNear ? { placesNear } : undefined,
  routing: { matrix },
});

const products = [product('milk', { brand: 'Kroger' }), product('oats', { brand: "Bob's Red Mill" })];

describe('addEstimatedStores', () => {
  it('adds other chains, with prices scaled from the real ones', async () => {
    const market = await addEstimatedStores(baseMarket(), products, 10, providers(async () => [walmart, aldi]));
    expect(market.stores.map((s) => s.id)).toEqual(['k1', walmart.id, aldi.id]);
    // Real prices are untouched.
    expect(market.prices.k1).toEqual({ milk: 400, oats: 600 });
    // Walmart carries everything.
    expect(market.prices[walmart.id].milk).toBe(roundEstimate(400 * scaleFromKroger(chainByKey('walmart')!)));
    expect(market.prices[walmart.id].oats).toBe(roundEstimate(600 * scaleFromKroger(chainByKey('walmart')!)));
    // Aldi mostly sells its own brands: milk yes, a national brand of oats no.
    expect(market.prices[aldi.id].milk).toBeDefined();
    expect(market.prices[aldi.id].oats).toBeUndefined();
    // Drive times now cover every store.
    expect(market.miles).toHaveLength(4);
    expect(market.miles[0]).toHaveLength(4);
    expect(market.minutes[0][3]).toBe(9);
  });

  it('is cheaper than the real store for a cheaper chain', async () => {
    const market = await addEstimatedStores(baseMarket(), products, 10, providers(async () => [walmart]));
    expect(market.prices[walmart.id].milk).toBeLessThan(market.prices.k1.milk);
  });

  it('never costs the user their real-price plan', async () => {
    const base = baseMarket();
    // The other-stores lookup fails.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await addEstimatedStores(base, products, 10, providers(async () => Promise.reject(new Error('busy'))))).toBe(base);
    // It finds nothing.
    expect(await addEstimatedStores(base, products, 10, providers(async () => []))).toBe(base);
    // Timing the extra stores fails.
    expect(await addEstimatedStores(base, products, 10, providers(async () => [walmart], async () => Promise.reject(new Error('no'))))).toBe(base);
    // Demo mode has no such provider.
    expect(await addEstimatedStores(base, products, 10, providers(undefined))).toBe(base);
  });

  it('needs real stores to scale from', async () => {
    const empty = baseMarket([]);
    const placesNear = vi.fn(async () => [walmart]);
    expect(await addEstimatedStores(empty, products, 10, providers(placesNear))).toBe(empty);
    expect(placesNear).not.toHaveBeenCalled();
  });

  it('does not stack estimates when run twice on the same market', async () => {
    const once = await addEstimatedStores(baseMarket(), products, 10, providers(async () => [walmart]));
    const twice = await addEstimatedStores(once, products, 10, providers(async () => [walmart]));
    expect(twice.stores.map((s) => s.id)).toEqual(['k1', walmart.id]);
  });
});

describe('livePlaces client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rounds the location so nearby visitors share a cached answer, and marks stores as estimated', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ places: [{ ...walmart, estimated: false }, { id: 'bad', name: 'x', lat: 'no', lon: 1 }] })),
    );
    const found = await livePlaces.placesNear({ lat: 47.60612, lon: -122.18345 }, 10);
    expect(String(fetchMock.mock.calls[0][0])).toContain('lat=47.61&lon=-122.18&radius=10');
    expect(found).toHaveLength(1);
    expect(found[0].estimated).toBe(true);
  });

  it('throws when the server does', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 502 }));
    await expect(livePlaces.placesNear(origin, 10)).rejects.toThrow();
  });
});
