import { useEffect, useMemo, useRef, useState } from 'react';
import { loadMarket, type DataMode, type Providers } from '../data/providers';
import { NEIGHBORHOODS } from '../data/seed';
import { limitDriveTime, maxUsefulFlex, planTrips, recommend } from '../domain/optimizer';
import type { CartLine, Market, Place, Plan, PlanSet, Product } from '../domain/types';
import type { Settings } from './appState';

export interface Planner {
  products: ReadonlyMap<string, Product>;
  /** Where the trip starts. */
  home: Place;
  market: Market | null;
  planSet: PlanSet | null;
  recommended: Plan | null;
  /** Upper bound for the "spend more to save time" slider, in cents. */
  maxFlex: number;
  loading: boolean;
  error: string | null;
  /** Fetch prices again after a failure. */
  retry: () => void;
}

/** The starting point for this data mode. Demo stores are all around Bellevue, so demo uses preset areas. */
export function startingPlace(mode: DataMode, settings: Settings): Place {
  return mode === 'live' ? settings.home : (NEIGHBORHOODS.find((n) => n.id === settings.demoHomeId) ?? NEIGHBORHOODS[0]);
}

/**
 * The closest real store by driving distance. Live product search is limited to what this
 * store sells, so people only find things they can actually buy nearby.
 */
export function nearestStoreId(market: Market | null): string | undefined {
  if (!market || market.sources.stores !== 'live' || market.stores.length === 0) return undefined;
  let best = 0;
  for (let i = 1; i < market.stores.length; i++) {
    if (market.miles[0][i + 1] < market.miles[0][best + 1]) best = i;
  }
  return market.stores[best].id;
}

interface Loaded {
  market: Market;
  providers: Providers;
}

/**
 * Fetches market data whenever the origin, the set of products or the data
 * providers change, and turns it into plans. Quantity and settings changes only
 * re-plan, they never refetch. While a refetch is in flight the previous plan
 * stays on screen (unless it came from different providers).
 */
export function usePlanner(cart: CartLine[], settings: Settings, providers: Providers, mode: DataMode): Planner {
  const home = startingPlace(mode, settings);
  const productKey = cart
    .map((l) => l.productId)
    .sort()
    .join(',');
  const products = useMemo(() => new Map(cart.map((l) => [l.productId, l.product])), [cart]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadMarket(
      home,
      cart.map((l) => l.product),
      settings.radiusMiles,
      providers,
    )
      .then((market) => {
        if (!cancelled) setLoaded({ market, providers });
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setError(
            providers.sources.prices === 'live'
              ? 'Couldn’t load live prices, so what you see may be out of date.'
              : 'Couldn’t load prices. Check your connection.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `home` is compared by value: a new object with the same coordinates isn't a new trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home.lat, home.lon, productKey, settings.radiusMiles, providers, attempt]);

  // A market only describes the products, origin and providers it was fetched for.
  const market =
    loaded &&
    loaded.providers === providers &&
    loaded.market.origin.lat === home.lat &&
    loaded.market.origin.lon === home.lon &&
    cart.every((l) => loaded.market.requested.has(l.productId))
      ? loaded.market
      : null;

  const computed = useMemo(() => {
    if (!market) return null;
    const planSet = planTrips(cart, products, market, {
      maxStops: settings.maxStops,
      radiusMiles: settings.radiusMiles,
      mpg: settings.mpg,
      gasPriceOverride: settings.gasPriceOverride,
      includeMembership: settings.includeMembership,
    });
    return { market, planSet, providers };
  }, [market, cart, products, providers, settings.maxStops, settings.radiusMiles, settings.mpg, settings.gasPriceOverride, settings.includeMembership]);

  // Keep showing the last good result while new prices load, but never one from other providers.
  const lastGood = useRef(computed);
  if (computed) lastGood.current = computed;
  const shown = computed ?? (lastGood.current?.providers === providers ? lastGood.current : null);

  // The drive-time limit only applies when the user is trading money for time.
  const basePlanSet = shown?.planSet ?? null;
  const planSet = useMemo(
    () => (basePlanSet && settings.mode === 'time' ? limitDriveTime(basePlanSet, settings.maxDriveMinutes) : basePlanSet),
    [basePlanSet, settings.mode, settings.maxDriveMinutes],
  );
  const flex = Math.min(settings.flex, planSet ? maxUsefulFlex(planSet) : 0);
  const recommended = planSet ? recommend(planSet, settings.mode, flex) : null;

  return {
    products,
    home,
    market: shown?.market ?? (loaded?.providers === providers ? loaded.market : null),
    planSet,
    recommended,
    maxFlex: planSet ? maxUsefulFlex(planSet) : 0,
    loading,
    error,
    retry: () => setAttempt((n) => n + 1),
  };
}
