import { padUpc } from '../domain/upc';
import type { Store } from '../domain/types';
import type { PriceProvider, StoreProvider } from './providers';

/** Live store lookup through our proxy, which talks to Kroger's Locations API. */
export const liveStores: StoreProvider = {
  async storesNear(origin, radiusMiles) {
    const url = `/api/stores?lat=${origin.lat}&lon=${origin.lon}&radius=${Math.min(Math.round(radiusMiles), 25)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Store lookup failed (${res.status})`);
    const body = (await res.json()) as { stores?: Store[] };
    return (body.stores ?? []).filter((s) => typeof s.id === 'string' && Number.isFinite(s.lat) && Number.isFinite(s.lon));
  },
};

/** Live shelf prices through our proxy. Only products with a barcode can be priced. */
export const livePrices: PriceProvider = {
  async getPrices(storeIds, products) {
    // The proxy answers by 13-digit barcode; map those back to our product ids.
    const idsByCode = new Map<string, string[]>();
    for (const p of products) {
      const code = padUpc(p.upc);
      if (code) idsByCode.set(code, [...(idsByCode.get(code) ?? []), p.id]);
    }
    const prices: Record<string, Record<string, number>> = Object.fromEntries(storeIds.map((id) => [id, {}]));
    if (idsByCode.size === 0 || storeIds.length === 0) return { prices, asOf: null };

    const url = `/api/prices?stores=${encodeURIComponent(storeIds.join(','))}&upcs=${[...idsByCode.keys()].join(',')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Price lookup failed (${res.status})`);
    const body = (await res.json()) as { prices?: Record<string, Record<string, number>>; asOf?: string };

    for (const [storeId, byCode] of Object.entries(body.prices ?? {})) {
      if (!prices[storeId]) continue;
      for (const [code, cents] of Object.entries(byCode)) {
        if (typeof cents !== 'number') continue;
        for (const productId of idsByCode.get(code) ?? []) prices[storeId][productId] = cents;
      }
    }
    return { prices, asOf: body.asOf ?? null };
  },
};
