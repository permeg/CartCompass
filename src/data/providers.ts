/**
 * The seam between the app and the outside world.
 *
 * The optimizer and UI only ever see a `Market`. This file builds one from a set
 * of providers, and the demo providers below are backed by `seed.ts`. To go live,
 * write providers that call real APIs and swap them into `activeProviders`
 * (see ROADMAP.md). Nothing else should need to change.
 */
import { haversineMiles } from '../domain/geo';
import type { LatLon, Market, Product, Store } from '../domain/types';
import {
  SEED_GAS_PRICE_CENTS,
  SEED_PRICES_AS_OF,
  SEED_PRODUCTS,
  SEED_STORES,
  type SeedStore,
} from './seed';

export interface CatalogProvider {
  list(): Product[];
}

export interface StoreProvider {
  storesNear(origin: LatLon, radiusMiles: number): Promise<Store[]>;
}

export interface PriceProvider {
  /** storeId -> productId -> cents. Omit products a store doesn't carry. */
  getPrices(
    storeIds: string[],
    productIds: string[],
  ): Promise<{ prices: Record<string, Record<string, number>>; asOf: string | null }>;
}

export interface GasProvider {
  /** Cents per gallon near this point. */
  getGasPrice(origin: LatLon): Promise<number>;
}

export interface RoutingProvider {
  /** Driving miles and minutes between every pair of points. */
  matrix(points: LatLon[]): Promise<{ miles: number[][]; minutes: number[][] }>;
}

export interface Providers {
  source: Market['source'];
  catalog: CatalogProvider;
  stores: StoreProvider;
  prices: PriceProvider;
  gas: GasProvider;
  routing: RoutingProvider;
}

/* ---------- demo implementations ---------- */

/** Cheap deterministic hash to [0, 1), so demo prices don't change between reloads. */
function hash01(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function shelfPrice(store: SeedStore, product: (typeof SEED_PRODUCTS)[number]): number | undefined {
  if (hash01(`stock:${store.id}:${product.id}`) >= store.coverage) return undefined;
  const wobble = 1 + (hash01(`price:${store.id}:${product.id}`) - 0.5) * 0.14;
  const raw = product.basePrice * store.factor * (store.bias[product.category] ?? 1) * wobble;
  const cents = Math.round(raw);
  // Shelf prices end in 9 once they are over a dollar: 3.49, 4.39.
  return cents >= 100 ? Math.max(99, Math.round((cents + 1) / 10) * 10 - 1) : Math.max(29, cents);
}

/** Road miles are roughly 1.3x the straight line in a suburban street grid. */
const ROAD_FACTOR = 1.3;
const AVERAGE_MPH = 24;

export const demoProviders: Providers = {
  source: 'demo',
  catalog: { list: () => SEED_PRODUCTS },
  stores: {
    async storesNear(origin, radiusMiles) {
      return SEED_STORES.filter((s) => haversineMiles(origin, s) * ROAD_FACTOR <= radiusMiles).map(
        // Strip demo-only fields so nothing downstream depends on them.
        ({ id, name, blurb, lat, lon, membership }) => ({ id, name, blurb, lat, lon, membership }),
      );
    },
  },
  prices: {
    async getPrices(storeIds, productIds) {
      const prices: Record<string, Record<string, number>> = {};
      for (const store of SEED_STORES.filter((s) => storeIds.includes(s.id))) {
        prices[store.id] = {};
        for (const product of SEED_PRODUCTS.filter((x) => productIds.includes(x.id))) {
          const price = shelfPrice(store, product);
          if (price !== undefined) prices[store.id][product.id] = price;
        }
      }
      return { prices, asOf: SEED_PRICES_AS_OF };
    },
  },
  gas: { getGasPrice: async () => SEED_GAS_PRICE_CENTS },
  routing: {
    async matrix(points) {
      const miles = points.map((a) => points.map((b) => haversineMiles(a, b) * ROAD_FACTOR));
      const minutes = miles.map((row) => row.map((m) => (m / AVERAGE_MPH) * 60));
      return { miles, minutes };
    },
  },
};

export const activeProviders: Providers = demoProviders;

/** Gather everything the optimizer needs for this origin and set of products. */
export async function loadMarket(
  origin: LatLon,
  productIds: string[],
  radiusMiles: number,
  providers: Providers = activeProviders,
): Promise<Market> {
  // Ask for a wider ring than the user's radius so a bigger radius doesn't need a refetch.
  const stores = await providers.stores.storesNear(origin, Math.max(radiusMiles, 15));
  const [{ prices, asOf }, gasPrice, { miles, minutes }] = await Promise.all([
    providers.prices.getPrices(
      stores.map((s) => s.id),
      productIds,
    ),
    providers.gas.getGasPrice(origin),
    providers.routing.matrix([origin, ...stores]),
  ]);
  return {
    origin,
    stores,
    prices,
    gasPrice,
    miles,
    minutes,
    requested: new Set(productIds),
    source: providers.source,
    pricesAsOf: asOf,
  };
}
