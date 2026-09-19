/**
 * The seam between the app and the outside world.
 *
 * The optimizer and UI only ever see a `Market`. This file builds one from a set
 * of providers. `demoProviders` are backed by `seed.ts`; `liveProviders` use real
 * Kroger stores and prices through our proxy. Each real data source that lands
 * (see ROADMAP.md) replaces one demo provider inside `liveProviders`.
 */
import { haversineMiles } from '../domain/geo';
import type { CartLine, Category, DataSources, LatLon, Market, Product, RouteLine, Store } from '../domain/types';
import { liveGas } from './gasClient';
import { liveStores, livePrices } from './krogerClient';
import { liveRouting } from './orsClient';
import { LIVE_QUICK_ADDS, LIVE_SAMPLE_CART } from './liveSample';
import { remoteCatalog } from './remoteCatalog';
import {
  DEMO_CATALOG,
  SAMPLE_CART,
  SEED_GAS_PRICE_CENTS,
  SEED_PRICES_AS_OF,
  SEED_PRODUCTS,
  SEED_STORES,
  findDemoProduct,
  type SeedStore,
} from './seed';

/** Instant, in-memory products. The demo catalog is one of these. */
export interface LocalCatalog {
  list(): Product[];
  find(id: string): Product | undefined;
  /** One-tap adds shown when the list is empty. */
  quickAdds(): Product[];
}

/** Product search over the network, through our own proxy. */
export interface RemoteCatalog {
  /** With a `storeId`, only products that store sells now, each with its shelf price in `referencePrice`. */
  search(query: string, signal?: AbortSignal, storeId?: string): Promise<Product[]>;
  /** A starter list built from what one store carries. */
  starter?(storeId: string): Promise<CartLine[]>;
}

export interface StoreProvider {
  storesNear(origin: LatLon, radiusMiles: number): Promise<Store[]>;
}

export interface PriceProvider {
  /**
   * storeId -> productId -> cents. Omit products a store doesn't carry.
   * Products are passed whole, since real providers look them up by barcode.
   */
  getPrices(
    storeIds: string[],
    products: Product[],
  ): Promise<{ prices: Record<string, Record<string, number>>; asOf: string | null }>;
}

export interface GasQuote {
  /** Cents per gallon of regular near the point. */
  cents: number;
  /** Where the price applies and which week, for real averages. */
  info?: { area: string; period: string };
}

export interface GasProvider {
  getGasPrice(origin: LatLon): Promise<GasQuote>;
}

export interface RoutingProvider {
  /** Driving miles and minutes between every pair of points. */
  matrix(points: LatLon[]): Promise<{ miles: number[][]; minutes: number[][] }>;
  /** The road line through the points, when the provider can draw one. */
  routeLine?(points: LatLon[], signal?: AbortSignal): Promise<RouteLine | null>;
}

export interface Providers {
  /** Which parts of the data are real. Drives the badge in the UI. */
  sources: DataSources;
  catalog: { local: LocalCatalog; remote: RemoteCatalog | null };
  /** What a first-time visitor's list starts with. */
  sampleCart(): CartLine[];
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

const SEED_BASE_PRICE = new Map(SEED_PRODUCTS.map((p) => [p.id, p.basePrice]));

/** Rough shelf prices for products the demo has never seen (from the live catalog). */
const CATEGORY_DEFAULT_PRICE: Record<Category, number> = {
  'Dairy & eggs': 449,
  Produce: 299,
  'Meat & seafood': 799,
  Bakery: 399,
  Pantry: 399,
  Frozen: 549,
  Beverages: 499,
  Household: 799,
};

function shelfPrice(store: SeedStore, product: Product): number | undefined {
  if (hash01(`stock:${store.id}:${product.id}`) >= store.coverage) return undefined;
  const base =
    SEED_BASE_PRICE.get(product.id) ?? product.referencePrice ?? CATEGORY_DEFAULT_PRICE[product.category];
  const wobble = 1 + (hash01(`price:${store.id}:${product.id}`) - 0.5) * 0.14;
  const raw = base * store.factor * (store.bias[product.category] ?? 1) * wobble;
  const cents = Math.round(raw);
  // Shelf prices end in 9 once they are over a dollar: 3.49, 4.39.
  return cents >= 100 ? Math.max(99, Math.round((cents + 1) / 10) * 10 - 1) : Math.max(29, cents);
}

/** Road miles are roughly 1.3x the straight line in a suburban street grid. */
const ROAD_FACTOR = 1.3;
const AVERAGE_MPH = 24;

const DEMO_QUICK_ADDS = ['eggs-12', 'milk-whole', 'bread', 'bananas', 'oats', 'coffee'];

const demoCatalog: LocalCatalog = {
  list: () => DEMO_CATALOG,
  find: findDemoProduct,
  quickAdds: () => DEMO_QUICK_ADDS.map(findDemoProduct).filter((p): p is Product => !!p),
};

export const demoProviders: Providers = {
  sources: { stores: 'demo', prices: 'demo', routing: 'demo', gas: 'demo' },
  catalog: { local: demoCatalog, remote: null },
  sampleCart: () => SAMPLE_CART,
  stores: {
    async storesNear(origin, radiusMiles) {
      return SEED_STORES.filter((s) => haversineMiles(origin, s) * ROAD_FACTOR <= radiusMiles).map(
        // Strip demo-only fields so nothing downstream depends on them.
        ({ id, name, blurb, lat, lon, membership }) => ({ id, name, blurb, lat, lon, membership }),
      );
    },
  },
  prices: {
    async getPrices(storeIds, products) {
      const prices: Record<string, Record<string, number>> = {};
      for (const store of SEED_STORES.filter((s) => storeIds.includes(s.id))) {
        prices[store.id] = {};
        for (const product of products) {
          const price = shelfPrice(store, product);
          if (price !== undefined) prices[store.id][product.id] = price;
        }
      }
      return { prices, asOf: SEED_PRICES_AS_OF };
    },
  },
  gas: { getGasPrice: async () => ({ cents: SEED_GAS_PRICE_CENTS }) },
  routing: {
    async matrix(points) {
      const miles = points.map((a) => points.map((b) => haversineMiles(a, b) * ROAD_FACTOR));
      const minutes = miles.map((row) => row.map((m) => (m / AVERAGE_MPH) * 60));
      return { miles, minutes };
    },
  },
};

/**
 * Real Kroger-family stores (QFC, Fred Meyer) and real shelf prices, searched
 * through Kroger's product catalog. Drive times come from OpenRouteService and gas
 * prices from the EIA when the server has those keys, and are estimates otherwise.
 */
function buildLive(routingLive: boolean, gasLive: boolean): Providers {
  return {
    ...demoProviders,
    sources: { stores: 'live', prices: 'live', routing: routingLive ? 'live' : 'demo', gas: gasLive ? 'live' : 'demo' },
    catalog: {
      // Demo products have no barcode, so they can't be priced live.
      local: { list: () => [], find: () => undefined, quickAdds: () => LIVE_QUICK_ADDS },
      remote: remoteCatalog,
    },
    sampleCart: () => LIVE_SAMPLE_CART,
    stores: liveStores,
    prices: livePrices,
    routing: routingLive ? liveRouting : demoProviders.routing,
    gas: gasLive ? liveGas : demoProviders.gas,
  };
}

export type DataMode = 'live' | 'demo';

export interface Capabilities {
  /** The server can look up real Kroger stores and prices. */
  livePrices: boolean;
  /** The server can look up addresses, drive times and routes. */
  liveRouting: boolean;
  /** The server can look up current gas prices. */
  liveGas: boolean;
}

// Provider sets are cached so their identity is stable. The planner uses that to tell
// whether a market was loaded with the providers it is being shown for.
const cache = new Map<string, Providers>();

/**
 * Pick the providers for a mode. The older `dev:live` switch (VITE_LIVE_CATALOG) still
 * gives the demo data a real catalog to search, for servers with no Kroger keys.
 */
export function providersFor(mode: DataMode, caps: Capabilities): Providers {
  const key = mode === 'live' ? `live:${caps.liveRouting}:${caps.liveGas}` : 'demo';
  let providers = cache.get(key);
  if (!providers) {
    providers =
      mode === 'live'
        ? buildLive(caps.liveRouting, caps.liveGas)
        : import.meta.env.VITE_LIVE_CATALOG === 'true'
          ? { ...demoProviders, catalog: { local: demoCatalog, remote: remoteCatalog } }
          : demoProviders;
    cache.set(key, providers);
  }
  return providers;
}

/** Gather everything the optimizer needs for this origin and set of products. */
export async function loadMarket(
  origin: LatLon,
  products: Product[],
  radiusMiles: number,
  providers: Providers,
): Promise<Market> {
  // Ask for a wider ring than the user's radius so a bigger radius doesn't need a refetch.
  const stores = await providers.stores.storesNear(origin, Math.max(radiusMiles, 15));
  const points = [origin, ...stores];
  // If real drive times fail, fall back to estimates rather than losing the whole trip.
  let routing = providers.sources.routing;
  const matrix = providers.routing.matrix(points).catch((err) => {
    if (providers.sources.routing !== 'live') throw err;
    console.warn('Drive times unavailable, using estimates:', err);
    routing = 'demo';
    return demoProviders.routing.matrix(points);
  });
  // Same for gas: a failed lookup shouldn't cost the user their trip.
  let gasSource = providers.sources.gas;
  const gas = providers.gas.getGasPrice(origin).catch((err) => {
    if (providers.sources.gas !== 'live') throw err;
    console.warn('Gas price unavailable, using an estimate:', err);
    gasSource = 'demo';
    return demoProviders.gas.getGasPrice(origin);
  });
  const [{ prices, asOf }, gasQuote, { miles, minutes }] = await Promise.all([
    providers.prices.getPrices(
      stores.map((s) => s.id),
      products,
    ),
    gas,
    matrix,
  ]);
  return {
    origin,
    stores,
    prices,
    gasPrice: gasQuote.cents,
    gasInfo: gasQuote.info,
    miles,
    minutes,
    requested: new Set(products.map((p) => p.id)),
    sources: { ...providers.sources, routing, gas: gasSource },
    pricesAsOf: asOf,
  };
}
