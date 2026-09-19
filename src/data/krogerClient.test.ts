import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../domain/types';
import { livePrices, liveStores } from './krogerClient';

const product = (id: string, upc?: string): Product => ({ id, name: id, size: '', category: 'Pantry', upc });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('livePrices', () => {
  it('maps prices back from barcodes to product ids', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        prices: {
          'kroger:70500808': { '0001111042908': 799 },
          'kroger:70100023': { '0001111042908': 749, '0011110429087': 599 },
        },
        asOf: '2026-09-19T20:00:00Z',
      }),
    );
    const milk = product('kroger:0001111042908', '0001111042908');
    const offMilk = product('off:0011110429087', '11110429087'); // 12-digit code from another catalog
    const result = await livePrices.getPrices(['kroger:70500808', 'kroger:70100023'], [milk, offMilk]);

    expect(result.prices['kroger:70500808']).toEqual({ [milk.id]: 799 });
    expect(result.prices['kroger:70100023']).toEqual({ [milk.id]: 749, [offMilk.id]: 599 });
    expect(result.asOf).toBe('2026-09-19T20:00:00Z');

    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(url).toContain('stores=kroger:70500808,kroger:70100023');
    expect(url).toContain('0011110429087'); // padded before sending
  });

  it('skips the network when no product has a barcode', async () => {
    const result = await livePrices.getPrices(['kroger:70500808'], [product('demo-milk')]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.prices).toEqual({ 'kroger:70500808': {} });
  });

  it('fails loudly so the UI can say prices are unavailable', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 502 }));
    await expect(livePrices.getPrices(['kroger:70500808'], [product('a', '0001111042908')])).rejects.toThrow();
  });
});

describe('liveStores', () => {
  it('returns stores and ignores malformed entries', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        stores: [
          { id: 'kroger:1', name: 'QFC A', blurb: '', lat: 47.6, lon: -122.2 },
          { id: 'kroger:2', name: 'bad', blurb: '', lat: null, lon: -122.2 },
        ],
      }),
    );
    const stores = await liveStores.storesNear({ lat: 47.606, lon: -122.183 }, 10);
    expect(stores.map((s) => s.id)).toEqual(['kroger:1']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('lat=47.606&lon=-122.183&radius=10');
  });
});
