import { useEffect, useMemo, useRef, useState } from 'react';
import { activeProviders, loadMarket } from '../data/providers';
import { NEIGHBORHOODS } from '../data/seed';
import { limitDriveTime, maxUsefulFlex, planTrips, recommend } from '../domain/optimizer';
import type { Market, Neighborhood, Plan, PlanSet, Product } from '../domain/types';
import type { AppState } from './appState';

const CATALOG: Product[] = activeProviders.catalog.list();
const PRODUCTS = new Map(CATALOG.map((p) => [p.id, p]));

export interface Planner {
  catalog: Product[];
  products: ReadonlyMap<string, Product>;
  home: Neighborhood;
  market: Market | null;
  planSet: PlanSet | null;
  recommended: Plan | null;
  /** Upper bound for the "spend more to save time" slider, in cents. */
  maxFlex: number;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches market data whenever the origin or the set of products changes, and
 * turns it into plans. Quantity and settings changes only re-plan, they never
 * refetch. While a refetch is in flight the previous plan stays on screen.
 */
export function usePlanner(state: AppState): Planner {
  const { cart, settings } = state;
  const home = NEIGHBORHOODS.find((n) => n.id === settings.homeId) ?? NEIGHBORHOODS[0];
  const productKey = cart
    .map((l) => l.productId)
    .sort()
    .join(',');

  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadMarket(home, productKey ? productKey.split(',') : [], settings.radiusMiles)
      .then((m) => {
        if (cancelled) return;
        setMarket(m);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError('Couldn’t load prices. Check your connection and try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [home, productKey, settings.radiusMiles]);

  // A market only describes the products and origin it was fetched for.
  const fresh =
    market !== null &&
    market.origin.lat === home.lat &&
    market.origin.lon === home.lon &&
    cart.every((l) => market.requested.has(l.productId));

  const computed = useMemo(() => {
    if (!market || !fresh) return null;
    const planSet = planTrips(cart, PRODUCTS, market, {
      maxStops: settings.maxStops,
      radiusMiles: settings.radiusMiles,
      mpg: settings.mpg,
      gasPriceOverride: settings.gasPriceOverride,
      includeMembership: settings.includeMembership,
    });
    return { market, planSet };
  }, [market, fresh, cart, settings.maxStops, settings.radiusMiles, settings.mpg, settings.gasPriceOverride, settings.includeMembership]);

  // Keep showing the last good result while new prices load.
  const lastGood = useRef(computed);
  if (computed) lastGood.current = computed;
  const shown = computed ?? lastGood.current;

  // The drive-time limit only applies when the user is trading money for time.
  const basePlanSet = shown?.planSet ?? null;
  const planSet = useMemo(
    () => (basePlanSet && settings.mode === 'time' ? limitDriveTime(basePlanSet, settings.maxDriveMinutes) : basePlanSet),
    [basePlanSet, settings.mode, settings.maxDriveMinutes],
  );
  const flex = Math.min(settings.flex, planSet ? maxUsefulFlex(planSet) : 0);
  const recommended = planSet ? recommend(planSet, settings.mode, flex) : null;

  return {
    catalog: CATALOG,
    products: PRODUCTS,
    home,
    market: shown?.market ?? market,
    planSet,
    recommended,
    maxFlex: planSet ? maxUsefulFlex(planSet) : 0,
    loading,
    error,
  };
}
