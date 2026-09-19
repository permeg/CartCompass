import { describe, expect, it } from 'vitest';
import { loadMarket } from '../data/providers';
import { SAMPLE_CART, SEED_PRODUCTS, NEIGHBORHOODS } from '../data/seed';
import { limitDriveTime, maxUsefulFlex, planTrips, recommend } from './optimizer';
import type { CartLine, Market, PlanOptions, Product, Store } from './types';

const products = new Map<string, Product>(
  ['eggs', 'milk', 'oats'].map((id) => [id, { id, name: id, size: '1', category: 'Pantry' }]),
);

const store = (id: string, membership = false): Store => ({
  id,
  name: id,
  blurb: '',
  lat: 0,
  lon: 0,
  membership,
});

/**
 * Stores sit on a line: near is 1 mi from home, far is 6 mi, mid is 3 mi.
 * Each mile costs 2 min of driving.
 */
function lineMarket(
  prices: Market['prices'],
  stores: Store[] = [store('near'), store('far'), store('mid')],
): Market {
  const pos: Record<string, number> = { near: 1, far: 6, mid: 3, club: 2 };
  const xs = [0, ...stores.map((s) => pos[s.id])];
  const miles = xs.map((a) => xs.map((b) => Math.abs(a - b)));
  return {
    origin: { lat: 0, lon: 0 },
    stores,
    prices,
    gasPrice: 400,
    miles,
    minutes: miles.map((r) => r.map((m) => m * 2)),
    requested: new Set(['eggs', 'milk', 'oats']),
    source: 'demo',
    pricesAsOf: null,
  };
}

const opts: PlanOptions = {
  maxStops: 3,
  radiusMiles: 20,
  mpg: 20, // 20 cents per mile at $4.00/gal
  gasPriceOverride: null,
  includeMembership: false,
};

const cart: Pick<CartLine, 'productId' | 'qty'>[] = [
  { productId: 'eggs', qty: 1 },
  { productId: 'milk', qty: 1 },
  { productId: 'oats', qty: 1 },
];

describe('planTrips', () => {
  it('goes to the far store when the savings outweigh the gas', () => {
    const market = lineMarket({
      near: { eggs: 500, milk: 500, oats: 500 },
      far: { eggs: 300, milk: 300, oats: 300 },
      mid: { eggs: 500, milk: 500, oats: 500 },
    });
    const set = planTrips(cart, products, market, opts);
    // Far round trip: 12 mi * 20c = $2.40 gas. Items save $6.00.
    expect(set.cheapest!.stops.map((s) => s.store.id)).toEqual(['far']);
    expect(set.baseline!.stops[0].store.id).toBe('near');
    expect(set.baseline!.total - set.cheapest!.total).toBe(1500 + 40 - (900 + 240));
  });

  it('stays close when the far store saves less than the gas costs', () => {
    const market = lineMarket({
      near: { eggs: 500, milk: 500, oats: 500 },
      far: { eggs: 490, milk: 490, oats: 490 },
      mid: { eggs: 900, milk: 900, oats: 900 },
    });
    expect(planTrips(cart, products, market, opts).cheapest!.stops[0].store.id).toBe('near');
  });

  it('splits across two stores when each is cheapest for different items', () => {
    const market = lineMarket({
      near: { eggs: 200, milk: 700, oats: 700 },
      far: { eggs: 700, milk: 200, oats: 200 },
      mid: { eggs: 800, milk: 800, oats: 800 },
    });
    const plan = planTrips(cart, products, market, opts).cheapest!;
    expect(plan.stops).toHaveLength(2);
    expect(plan.itemsTotal).toBe(600);
    // The stops are ordered to keep the loop short: near first, then far.
    expect(plan.stops.map((s) => s.store.id)).toEqual(['near', 'far']);
    expect(plan.totalMiles).toBe(12);
  });

  it('respects the stop cap', () => {
    const market = lineMarket({
      near: { eggs: 100, milk: 900, oats: 900 },
      mid: { eggs: 900, milk: 100, oats: 900 },
      far: { eggs: 900, milk: 900, oats: 100 },
    });
    expect(planTrips(cart, products, market, { ...opts, maxStops: 3 }).cheapest!.stops).toHaveLength(3);
    expect(planTrips(cart, products, market, { ...opts, maxStops: 2 }).cheapest!.stops.length).toBeLessThanOrEqual(2);
  });

  it('never adds a stop that sells nothing', () => {
    const market = lineMarket({
      near: { eggs: 100, milk: 100, oats: 100 },
      far: { eggs: 900, milk: 900, oats: 900 },
      mid: { eggs: 900, milk: 900, oats: 900 },
    });
    const set = planTrips(cart, products, market, opts);
    for (const plan of [set.cheapest!, set.fastest!, ...set.frontier]) {
      expect(plan.stops.every((s) => s.lines.length > 0)).toBe(true);
    }
  });

  it('flags items no store carries and plans the rest', () => {
    const market = lineMarket({
      near: { eggs: 300, milk: 300 },
      far: { eggs: 300, milk: 300 },
      mid: { eggs: 300, milk: 300 },
    });
    const set = planTrips(cart, products, market, opts);
    expect(set.unavailable.map((p) => p.id)).toEqual(['oats']);
    expect(set.cheapest!.itemsTotal).toBe(600);
  });

  it('has no baseline when no single store carries everything', () => {
    const market = lineMarket({
      near: { eggs: 300, milk: 300 },
      far: { oats: 300 },
      mid: { eggs: 300 },
    });
    const set = planTrips(cart, products, market, opts);
    expect(set.baseline).toBeNull();
    expect(set.cheapest!.stops.length).toBeGreaterThan(1);
  });

  it('skips membership stores unless the user opts in', () => {
    const stores = [store('near'), store('club', true)];
    const market = lineMarket(
      {
        near: { eggs: 500, milk: 500, oats: 500 },
        club: { eggs: 100, milk: 100, oats: 100 },
      },
      stores,
    );
    expect(planTrips(cart, products, market, opts).cheapest!.stops[0].store.id).toBe('near');
    expect(
      planTrips(cart, products, market, { ...opts, includeMembership: true }).cheapest!.stops[0].store.id,
    ).toBe('club');
  });

  it('ignores stores outside the radius', () => {
    const market = lineMarket({
      near: { eggs: 500, milk: 500, oats: 500 },
      far: { eggs: 100, milk: 100, oats: 100 },
      mid: { eggs: 500, milk: 500, oats: 500 },
    });
    const set = planTrips(cart, products, market, { ...opts, radiusMiles: 4 });
    expect(set.cheapest!.stops.every((s) => s.store.id !== 'far')).toBe(true);
  });

  it('returns an empty set for an empty cart', () => {
    const set = planTrips([], products, lineMarket({}), opts);
    expect(set.cheapest).toBeNull();
    expect(recommend(set, 'cheapest', 0)).toBeNull();
  });
});

describe('recommend', () => {
  // near: $18.00 items, 1 mi.  far: $12.00 items, 6 mi.  far is cheaper but slower.
  const market = lineMarket({
    near: { eggs: 600, milk: 600, oats: 600 },
    far: { eggs: 400, milk: 400, oats: 400 },
    mid: { eggs: 550, milk: 550, oats: 550 },
  });
  const set = planTrips(cart, products, market, opts);

  it('picks the cheapest plan in lowest-price mode', () => {
    expect(recommend(set, 'cheapest', 9999)!.id).toBe(set.cheapest!.id);
  });

  it('falls back to the nearby store once the extra cost is more than the user allows', () => {
    // mid: 16.50 + 8 mi*20c=1.60 => 18.10. near: 18.00 + 0.40 = 18.40. far: 12.00 + 2.40 = 14.40.
    expect(set.cheapest!.stops[0].store.id).toBe('far');
    const fast = recommend(set, 'time', 0);
    expect(fast!.id).toBe(set.cheapest!.id);
    const allowed = recommend(set, 'time', maxUsefulFlex(set));
    expect(allowed!.id).toBe(set.fastest!.id);
    expect(allowed!.totalMinutes).toBeLessThan(set.cheapest!.totalMinutes);
  });

  it('never exceeds the budget it was given', () => {
    for (const flex of [0, 100, 250, 500, 1000, 5000]) {
      const plan = recommend(set, 'time', flex)!;
      expect(plan.total).toBeLessThanOrEqual(set.cheapest!.total + flex);
    }
  });

  it('frontier gets faster as it gets more expensive', () => {
    for (let i = 1; i < set.frontier.length; i++) {
      expect(set.frontier[i].total).toBeGreaterThanOrEqual(set.frontier[i - 1].total);
      expect(set.frontier[i].totalMinutes).toBeLessThan(set.frontier[i - 1].totalMinutes);
    }
  });
});

describe('limitDriveTime', () => {
  // Each item is cheapest at a different store, so the cheapest plan visits all three.
  // Drive times (2 min per mile): near alone 4, near+mid 12, near+mid+far 24.
  const market = lineMarket({
    near: { eggs: 100, milk: 900, oats: 900 },
    mid: { eggs: 900, milk: 100, oats: 900 },
    far: { eggs: 900, milk: 900, oats: 100 },
  });
  const base = planTrips(cart, products, market, opts);

  it('leaves the plans alone when the limit is generous', () => {
    const set = limitDriveTime(base, 120);
    expect(set.cheapest!.id).toBe(base.cheapest!.id);
    expect(set.driveLimit).toMatchObject({ overLimit: false, maxStops: 3 });
  });

  it('caps the number of stops by the driving they need', () => {
    expect(base.cheapest!.stops).toHaveLength(3);
    const set = limitDriveTime(base, 15);
    for (const plan of set.frontier) expect(plan.driveMinutes).toBeLessThanOrEqual(15);
    expect(set.cheapest!.stops.length).toBeLessThanOrEqual(2);
    expect(set.driveLimit!.maxStops).toBe(2);
  });

  it('gets down to one stop when the limit is tight', () => {
    const set = limitDriveTime(base, 5);
    expect(set.cheapest!.stops.map((s) => s.store.id)).toEqual(['near']);
    expect(set.driveLimit).toMatchObject({ overLimit: false, maxStops: 1 });
  });

  it('shows the least-driving plan when nothing fits', () => {
    const set = limitDriveTime(base, 1);
    expect(set.driveLimit!.overLimit).toBe(true);
    expect(set.cheapest!.stops.map((s) => s.store.id)).toEqual(['near']);
  });

  it('feeds the time recommendation', () => {
    const set = limitDriveTime(base, 15);
    const plan = recommend(set, 'time', 100000)!;
    expect(plan.driveMinutes).toBeLessThanOrEqual(15);
  });

  it('keeps the baseline for comparison', () => {
    expect(limitDriveTime(base, 5).baseline?.id).toBe(base.baseline?.id);
  });
});

describe('demo data', () => {
  it('produces a multi-store win for the sample cart', async () => {
    const home = NEIGHBORHOODS[0];
    const market = await loadMarket(
      home,
      SAMPLE_CART.map((l) => l.product),
      12,
    );
    const catalog = new Map(SEED_PRODUCTS.map((p) => [p.id, p as Product]));
    const set = planTrips(SAMPLE_CART, catalog, market, {
      ...opts,
      radiusMiles: 12,
      mpg: 26,
    });
    expect(set.unavailable).toEqual([]);
    expect(set.baseline).not.toBeNull();
    expect(set.cheapest!.total).toBeLessThanOrEqual(set.baseline!.total);
  });
});
