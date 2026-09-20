import type {
  CartLine,
  Market,
  Mode,
  Plan,
  PlanLine,
  PlanOptions,
  PlanSet,
  PlanStop,
  Product,
} from './types';

/** Time spent inside a store: a fixed cost per stop plus a little per item. */
const SHOP_MINUTES_PER_STOP = 6;
const SHOP_MINUTES_PER_ITEM = 0.6;

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

function subsets(indexes: number[], maxSize: number): number[][] {
  const out: number[][] = [];
  const walk = (start: number, current: number[]) => {
    if (current.length > 0) out.push(current);
    if (current.length === maxSize) return;
    for (let i = start; i < indexes.length; i++) walk(i + 1, [...current, indexes[i]]);
  };
  walk(0, []);
  return out;
}

/**
 * Build every sensible plan and pick out the interesting ones.
 *
 * For each group of up to `maxStops` stores, every item is bought wherever it is
 * cheapest inside that group, then the stops are ordered to minimise driving.
 * A group only counts if every store in it actually gets something to sell,
 * otherwise it is just a longer version of a smaller group.
 */
export function planTrips(
  cart: Pick<CartLine, 'productId' | 'qty'>[],
  products: ReadonlyMap<string, Product>,
  market: Market,
  options: PlanOptions,
): PlanSet {
  const gasPrice = options.gasPriceOverride ?? market.gasPrice;
  const lines = cart
    .map((l) => ({ product: products.get(l.productId), qty: l.qty }))
    .filter((l): l is { product: Product; qty: number } => !!l.product && l.qty > 0);

  const eligible = market.stores
    .map((store, i) => ({ store, node: i + 1 }))
    .filter(
      ({ store, node }) =>
        market.miles[0][node] <= options.radiusMiles && (options.includeMembership || !store.membership),
    );

  const priceAt = (node: number, productId: string): number | undefined =>
    market.prices[market.stores[node - 1].id]?.[productId];

  const unavailable = lines
    .filter((l) => !eligible.some(({ node }) => priceAt(node, l.product.id) !== undefined))
    .map((l) => l.product);
  const shoppable = lines.filter((l) => !unavailable.includes(l.product));

  const empty: PlanSet = {
    cheapest: null,
    cheapestReal: null,
    fastest: null,
    baseline: null,
    frontier: [],
    unavailable,
    storesConsidered: eligible.length,
    all: [],
  };
  if (shoppable.length === 0 || eligible.length === 0) return empty;

  const plans: Plan[] = [];
  const byHomeDistance = [...eligible].sort((a, b) => market.miles[0][a.node] - market.miles[0][b.node]);

  for (const group of subsets(
    byHomeDistance.map((e) => e.node),
    options.maxStops,
  )) {
    // Assign each item to its cheapest store in the group (ties go to the nearer store).
    const assigned = new Map<number, PlanLine[]>(group.map((n) => [n, []]));
    let feasible = true;
    for (const { product, qty } of shoppable) {
      let bestNode = -1;
      let bestPrice = Infinity;
      for (const node of group) {
        const price = priceAt(node, product.id);
        if (price !== undefined && price < bestPrice) {
          bestPrice = price;
          bestNode = node;
        }
      }
      if (bestNode === -1) {
        feasible = false;
        break;
      }
      assigned.get(bestNode)!.push({ product, qty, unitPrice: bestPrice, total: bestPrice * qty });
    }
    if (!feasible || [...assigned.values()].some((l) => l.length === 0)) continue;

    // Shortest round trip through the group.
    let bestOrder: number[] = group;
    let bestMiles = Infinity;
    for (const order of permutations(group)) {
      let d = market.miles[0][order[0]];
      for (let i = 1; i < order.length; i++) d += market.miles[order[i - 1]][order[i]];
      d += market.miles[order[order.length - 1]][0];
      if (d < bestMiles) {
        bestMiles = d;
        bestOrder = order;
      }
    }
    plans.push(buildPlan(bestOrder, assigned, market, gasPrice, options.mpg));
  }

  if (plans.length === 0) return empty;

  // "You save" is measured against a real store, never against a guess.
  const singles = plans.filter((p) => p.stops.length === 1 && !p.estimated);
  const baseline =
    [...singles].sort(
      (a, b) =>
        market.miles[0][indexOf(market, a.stops[0].store.id)] - market.miles[0][indexOf(market, b.stops[0].store.id)],
    )[0] ?? null;

  return summarize(plans, baseline, unavailable, eligible.length);
}

function summarize(plans: Plan[], baseline: Plan | null, unavailable: Product[], storesConsidered: number): PlanSet {
  const byCost = [...plans].sort((a, b) => a.total - b.total || a.totalMinutes - b.totalMinutes);
  const byTime = [...plans].sort((a, b) => a.totalMinutes - b.totalMinutes || a.total - b.total);

  const frontier: Plan[] = [];
  let fastestSoFar = Infinity;
  for (const p of byCost) {
    if (p.totalMinutes < fastestSoFar - 1e-9) {
      frontier.push(p);
      fastestSoFar = p.totalMinutes;
    }
  }

  // Only worth reporting when some plans rely on guesses, so there is something to compare it with.
  const cheapestReal = plans.some((p) => p.estimated) ? (byCost.find((p) => !p.estimated) ?? null) : null;

  return {
    cheapest: byCost[0],
    cheapestReal,
    fastest: byTime[0],
    baseline,
    frontier,
    unavailable,
    storesConsidered,
    all: plans,
  };
}

/**
 * Keep only plans whose round-trip driving fits within `maxMinutes`. Since every
 * extra stop adds driving, this also caps how many stops are worth making.
 * If even the closest option is over the limit, the least-driving plan is kept
 * and `driveLimit.overLimit` is set so the UI can say so.
 */
export function limitDriveTime(set: PlanSet, maxMinutes: number): PlanSet {
  if (set.all.length === 0) return set;
  const within = set.all.filter((p) => Math.round(p.driveMinutes) <= maxMinutes);
  const overLimit = within.length === 0;
  const pool = overLimit
    ? [[...set.all].sort((a, b) => a.driveMinutes - b.driveMinutes || a.total - b.total)[0]]
    : within;
  return {
    ...summarize(pool, set.baseline, set.unavailable, set.storesConsidered),
    all: set.all,
    driveLimit: { minutes: maxMinutes, overLimit, maxStops: Math.max(...pool.map((p) => p.stops.length)) },
  };
}

function indexOf(market: Market, storeId: string): number {
  return market.stores.findIndex((s) => s.id === storeId) + 1;
}

function buildPlan(
  order: number[],
  assigned: Map<number, PlanLine[]>,
  market: Market,
  gasPrice: number,
  mpg: number,
): Plan {
  const stops: PlanStop[] = order.map((node, i) => {
    const from = i === 0 ? 0 : order[i - 1];
    const lines = assigned.get(node)!;
    return {
      store: market.stores[node - 1],
      lines,
      subtotal: lines.reduce((sum, l) => sum + l.total, 0),
      legMiles: market.miles[from][node],
      legMinutes: market.minutes[from][node],
    };
  });
  const last = order[order.length - 1];
  const returnMiles = market.miles[last][0];
  const returnMinutes = market.minutes[last][0];
  const totalMiles = stops.reduce((s, x) => s + x.legMiles, 0) + returnMiles;
  const driveMinutes = stops.reduce((s, x) => s + x.legMinutes, 0) + returnMinutes;
  const itemCount = stops.reduce((s, x) => s + x.lines.reduce((n, l) => n + l.qty, 0), 0);
  const shopMinutes = stops.length * SHOP_MINUTES_PER_STOP + itemCount * SHOP_MINUTES_PER_ITEM;
  const itemsTotal = stops.reduce((s, x) => s + x.subtotal, 0);
  const gasCost = Math.round((totalMiles / mpg) * gasPrice);
  return {
    id: stops.map((s) => s.store.id).join('>'),
    stops,
    estimated: stops.some((s) => s.store.estimated === true),
    itemsTotal,
    gasCost,
    total: itemsTotal + gasCost,
    totalMiles,
    returnMiles,
    returnMinutes,
    driveMinutes,
    shopMinutes,
    totalMinutes: driveMinutes + shopMinutes,
  };
}

/**
 * "Lowest price" picks the cheapest plan. "Save me time" picks the fastest plan
 * that costs no more than `flexCents` above the cheapest one.
 */
export function recommend(set: PlanSet, mode: Mode, flexCents: number): Plan | null {
  if (!set.cheapest) return null;
  if (mode === 'cheapest') return set.cheapest;
  const budget = set.cheapest.total + flexCents;
  return (
    set.frontier.filter((p) => p.total <= budget).sort((a, b) => a.totalMinutes - b.totalMinutes)[0] ??
    set.cheapest
  );
}

/** The most extra money a user could usefully spend to save time. */
export function maxUsefulFlex(set: PlanSet): number {
  if (!set.cheapest || !set.fastest) return 0;
  return set.fastest.total - set.cheapest.total;
}
