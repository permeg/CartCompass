import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product, Store } from '../domain/types';
import { liveGas } from './gasClient';
import { demoProviders, loadMarket, type Providers } from './providers';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const home = { lat: 47.606, lon: -122.183 };

describe('liveGas', () => {
  it('returns cents and where the price applies', async () => {
    fetchMock.mockResolvedValueOnce(ok({ cents: 565, period: '2026-09-14', area: { name: 'Seattle' } }));
    expect(await liveGas.getGasPrice(home)).toEqual({ cents: 565, info: { area: 'Seattle', period: '2026-09-14' } });
    expect(String(fetchMock.mock.calls[0][0])).toContain('lat=47.606&lon=-122.183');
  });

  it('rejects prices that cannot be right', async () => {
    for (const cents of [0, 50, 99999, 'x', null]) {
      fetchMock.mockResolvedValueOnce(ok({ cents }));
      await expect(liveGas.getGasPrice(home)).rejects.toThrow();
    }
  });

  it('fails when the server does', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 502 }));
    await expect(liveGas.getGasPrice(home)).rejects.toThrow();
  });
});

describe('loadMarket with live gas', () => {
  const product: Product = { id: 'p', name: 'p', size: '', category: 'Pantry', upc: '0001111042908' };
  const stores: Store[] = [{ id: 's1', name: 'S1', blurb: '', lat: 47.62, lon: -122.14 }];
  const providers = (getGasPrice: Providers['gas']['getGasPrice']): Providers => ({
    ...demoProviders,
    sources: { stores: 'live', prices: 'live', routing: 'demo', gas: 'live' },
    stores: { storesNear: async () => stores },
    prices: { getPrices: async () => ({ prices: { s1: { p: 100 } }, asOf: null }) },
    gas: { getGasPrice },
  });

  it('uses the real price and says where it is from', async () => {
    const market = await loadMarket(home, [product], 10, providers(async () => ({ cents: 565, info: { area: 'Seattle', period: '2026-09-14' } })));
    expect(market.gasPrice).toBe(565);
    expect(market.gasInfo).toEqual({ area: 'Seattle', period: '2026-09-14' });
    expect(market.sources.gas).toBe('live');
  });

  it('falls back to an estimate, and says so, when the lookup fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const market = await loadMarket(home, [product], 10, providers(async () => Promise.reject(new Error('down'))));
    expect(market.sources.gas).toBe('demo');
    expect(market.sources.prices).toBe('live');
    expect(market.gasPrice).toBeGreaterThan(100);
    expect(market.gasInfo).toBeUndefined();
  });
});
