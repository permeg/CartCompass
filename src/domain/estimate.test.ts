import { describe, expect, it } from 'vitest';
import { CHAINS, KROGER_LEVEL, chainByKey, chainFromNames, scaleFromKroger } from './chains';
import { canEstimate, estimatePrices, roundEstimate } from './estimate';
import { planTrips } from './optimizer';
import type { Market, PlanOptions, Product, Store } from './types';

const product = (id: string, extra: Partial<Product> = {}): Product => ({ id, name: id, size: '', category: 'Pantry', ...extra });
const store = (id: string, extra: Partial<Store> = {}): Store => ({ id, name: id, blurb: '', lat: 0, lon: 0, ...extra });

describe('chains', () => {
  it('recognises each chain by the start of its name', () => {
    expect(chainFromNames(['Walmart Supercenter'])?.key).toBe('walmart');
    expect(chainFromNames([undefined, "BJ's Wholesale Club"])?.key).toBe('bjs');
    expect(chainFromNames(['H-E-B'])?.key).toBe('heb');
    expect(chainFromNames(['HEB plus!'])?.key).toBe('heb');
    expect(chainFromNames(['Whole Foods Market'])?.key).toBe('wholefoods');
    expect(chainFromNames(['ALDI'])?.key).toBe('aldi');
  });

  it('does not mistake other shops for a chain', () => {
    expect(chainFromNames(['Targeted Deals'])).toBeNull();
    expect(chainFromNames(['Sam\'s Club'])).toBeNull();
    expect(chainFromNames(['Kroger'])).toBeNull();
    expect(chainFromNames([])).toBeNull();
  });

  it('orders price levels the way the Consumer Reports study found them', () => {
    const level = (k: string) => chainByKey(k)!.level;
    expect(level('costco')).toBeLessThan(level('aldi'));
    expect(level('aldi')).toBeLessThan(level('walmart'));
    expect(level('walmart')).toBeLessThan(level('target'));
    expect(level('target')).toBeLessThan(level('safeway'));
    expect(level('safeway')).toBeLessThan(KROGER_LEVEL);
    expect(KROGER_LEVEL).toBeLessThan(level('wholefoods'));
  });

  it('scales from a real Kroger price', () => {
    expect(scaleFromKroger(chainByKey('walmart')!)).toBeCloseTo(0.871, 2);
    expect(scaleFromKroger(chainByKey('wholefoods')!)).toBeGreaterThan(1);
    expect(CHAINS.every((c) => c.level > 0.5 && c.level < 1.5)).toBe(true);
  });
});

describe('canEstimate', () => {
  const aldi = chainByKey('aldi')!;
  const walmart = chainByKey('walmart')!;

  it('guesses anything at a chain that carries national brands', () => {
    expect(canEstimate(product('a', { brand: "Bob's Red Mill" }), walmart)).toBe(true);
  });

  it('only guesses store brands and fresh items at Aldi and Lidl', () => {
    expect(canEstimate(product('a', { brand: "Bob's Red Mill" }), aldi)).toBe(false);
    expect(canEstimate(product('b', { brand: 'Kroger' }), aldi)).toBe(true);
    expect(canEstimate(product('c', { name: 'Simple Truth Organic Milk', brand: 'Whatever' }), aldi)).toBe(true);
    expect(canEstimate(product('d', { category: 'Produce', brand: 'Fresh Bananas' }), aldi)).toBe(true);
    expect(canEstimate(product('e'), aldi)).toBe(true); // no brand at all
  });
});

describe('roundEstimate', () => {
  it('rounds to 5 cents so a guess does not look exact', () => {
    expect(roundEstimate(347)).toBe(345);
    expect(roundEstimate(349)).toBe(350);
    expect(roundEstimate(2)).toBe(5);
  });
});

describe('estimatePrices', () => {
  const real = [store('near'), store('far')];
  const realPrices = { near: { milk: 400, eggs: 500 }, far: { milk: 300, eggs: 450, oats: 600 } };
  const walmart = store('w', { estimated: true, chainKey: 'walmart' });
  const aldi = store('a', { estimated: true, chainKey: 'aldi' });
  // origin, near, far, ... : near is closer.
  const miles = [0, 1, 5];

  it('starts from the nearest real store that has the item', () => {
    const out = estimatePrices([walmart], [product('milk'), product('oats')], real, realPrices, miles);
    // milk: near has it (400). oats: only far has it (600).
    expect(out.w.milk).toBe(roundEstimate(400 * scaleFromKroger(chainByKey('walmart')!)));
    expect(out.w.oats).toBe(roundEstimate(600 * scaleFromKroger(chainByKey('walmart')!)));
  });

  it('gives no guess for items that no real store prices', () => {
    const out = estimatePrices([walmart], [product('caviar')], real, realPrices, miles);
    expect(out.w.caviar).toBeUndefined();
  });

  it('makes cheaper chains cheaper and dearer chains dearer', () => {
    const whole = store('wf', { estimated: true, chainKey: 'wholefoods' });
    const out = estimatePrices([walmart, aldi, whole], [product('milk', { brand: 'Kroger' })], real, realPrices, miles);
    expect(out.a.milk).toBeLessThan(out.w.milk);
    expect(out.wf.milk).toBeGreaterThan(400);
  });

  it('skips items a store-brand chain would not carry', () => {
    const out = estimatePrices([aldi], [product('oats', { brand: "Bob's Red Mill" }), product('milk', { brand: 'Kroger' })], real, realPrices, miles);
    expect(out.a.oats).toBeUndefined();
    expect(out.a.milk).toBeDefined();
  });

  it('ignores stores whose chain is unknown', () => {
    const odd = store('odd', { estimated: true, chainKey: 'nonesuch' });
    expect(estimatePrices([odd], [product('milk')], real, realPrices, miles).odd).toEqual({});
  });
});

describe('planning with estimated stores', () => {
  const opts: PlanOptions = { maxStops: 3, radiusMiles: 20, mpg: 25, gasPriceOverride: null, includeMembership: false };
  const products = new Map([['milk', product('milk')]]);
  const market = (stores: Store[], prices: Market['prices'], miles: number[][]): Market => ({
    origin: { lat: 0, lon: 0 },
    stores,
    prices,
    gasPrice: 400,
    miles,
    minutes: miles.map((r) => r.map((m) => m * 2)),
    requested: new Set(['milk']),
    sources: { stores: 'live', prices: 'live', routing: 'live', gas: 'live' },
    pricesAsOf: null,
  });
  const cart = [{ productId: 'milk', qty: 1 }];

  const m = market(
    [store('kroger1'), store('guess', { estimated: true, chainKey: 'walmart' })],
    { kroger1: { milk: 500 }, guess: { milk: 400 } },
    [
      [0, 1, 2],
      [1, 0, 1],
      [2, 1, 0],
    ],
  );

  it('flags plans that use a guess, and offers the best real one beside them', () => {
    const set = planTrips(cart, products, m, opts);
    expect(set.cheapest!.estimated).toBe(true);
    expect(set.cheapest!.stops[0].store.id).toBe('guess');
    expect(set.cheapestReal!.estimated).toBe(false);
    expect(set.cheapestReal!.stops[0].store.id).toBe('kroger1');
  });

  it('measures savings against a real store, never a guess', () => {
    const set = planTrips(cart, products, m, opts);
    expect(set.baseline!.stops[0].store.id).toBe('kroger1');
    expect(set.baseline!.estimated).toBe(false);
  });

  it('has no "real only" alternative when nothing is estimated', () => {
    const real = market([store('a'), store('b')], { a: { milk: 500 }, b: { milk: 450 } }, [
      [0, 1, 2],
      [1, 0, 1],
      [2, 1, 0],
    ]);
    expect(planTrips(cart, products, real, opts).cheapestReal).toBeNull();
  });

  it('a warehouse club is left out unless the user opts in to membership stores', () => {
    const club = market(
      [store('kroger1'), store('club', { estimated: true, chainKey: 'costco', membership: true })],
      { kroger1: { milk: 500 }, club: { milk: 300 } },
      [
        [0, 1, 2],
        [1, 0, 1],
        [2, 1, 0],
      ],
    );
    expect(planTrips(cart, products, club, opts).cheapest!.stops[0].store.id).toBe('kroger1');
    expect(planTrips(cart, products, club, { ...opts, includeMembership: true }).cheapest!.stops[0].store.id).toBe('club');
  });
});
