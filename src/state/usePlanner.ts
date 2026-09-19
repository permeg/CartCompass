import { useEffect, useMemo, useRef, useState } from 'react';
import { loadMarket, type Providers } from '../data/providers';
import { NEIGHBORHOODS } from '../data/seed';
import { limitDriveTime, maxUsefulFlex, planTrips, recommend } from '../domain/optimizer';
import type { CartLine, Market, Neighborhood, Plan, PlanSet, Product } from '../domain/types';
import type { Settings } from './appState';

export interface Planner {
  products: ReadonlyMap<string, Product>;
  home: Neighborhood;
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

/**
 * Fetches market data whenever the origin, the set of products or the data
 * providers change, and turns it into plans. Quantity and settings changes only
 * re-plan, they never refetch. While a refetch is in flight the previous plan
 * stays on screen (unless it came from a different set of providers).
 */
export function usePlanner(cart: CartLine[], settings: Settings, providers: Providers): Planner {
  const home = NEIGHBORHOODS.find((n) => n.id === settings.homeId) ?? NEIGHBORHOODS[0];
  const productKey = cart
    .map((l) => l.productId)
    .sort()
    .join(',');
  const products = useMemo(() => new Map(cart.map((l) => [l.productId, l.product])), [cart]);

  const [market, setMarket] = useState<Market | null>(null);
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
      .then((m) => {
        if (!cancelled) setMarket(m);
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
  }, [home, productKey, settings.radiusMiles, providers, attempt]);

  // A market only describes the products, origin and data source it was fetched for.
  const fresh =
    market !== null &&
    market.sources === providers.sources &&
    market.origin.lat === home.lat &&
    market.origin.lon === home.lon &&
    cart.every((l) => market.requested.has(l.productId));

  const computed = useMemo(() => {
    if (!market || !fresh) return null;
    const planSet = planTrips(cart, products, market, {
      maxStops: settings.maxStops,
      radiusMiles: settings.radiusMiles,
      mpg: settings.mpg,
      gasPriceOverride: settings.gasPriceOverride,
      includeMembership: settings.includeMembership,
    });
    return { market, planSet, sources: providers.sources };
  }, [market, fresh, cart, products, providers.sources, settings.maxStops, settings.radiusMiles, settings.mpg, settings.gasPriceOverride, settings.includeMembership]);

  // Keep showing the last good result while new prices load, but never one from other data.
  const lastGood = useRef(computed);
  if (computed) lastGood.current = computed;
  const shown = computed ?? (lastGood.current?.sources === providers.sources ? lastGood.current : null);

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
    market: shown?.market ?? (market?.sources === providers.sources ? market : null),
    planSet,
    recommended,
    maxFlex: planSet ? maxUsefulFlex(planSet) : 0,
    loading,
    error,
    retry: () => setAttempt((n) => n + 1),
  };
}
