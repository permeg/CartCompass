import { chainByKey, scaleFromKroger, type Chain } from './chains';
import type { Market, Product, Store } from './types';

/** Store brands at the Kroger family's banners. Aldi and Lidl mostly sell their own brands, so these are the comparable items. */
const STORE_BRAND =
  /\b(kroger|simple truth|private selection|harris teeter|smith'?s|fred meyer|ralphs|king soopers|fry'?s|qfc|mariano'?s|pick 'n save|dillons|baker'?s|city market|jay c|food 4 less|foods co|heritage farm)\b/i;

/**
 * Whether it is reasonable to guess this product's price at this chain. Chains that mostly
 * sell their own brands (Aldi, Lidl) are only estimated for store-brand and fresh items, since
 * a national brand probably isn't on their shelves at all.
 */
export function canEstimate(product: Product, chain: Chain): boolean {
  if (!chain.storeBrandOnly) return true;
  if (product.category === 'Produce') return true;
  return !product.brand || STORE_BRAND.test(product.brand) || STORE_BRAND.test(product.name);
}

/** Round to the nearest 5 cents, so a guess doesn't look more precise than it is. */
export function roundEstimate(cents: number): number {
  return Math.max(5, Math.round(cents / 5) * 5);
}

/**
 * Guess prices at stores that don't publish any. Each guess starts from a real price for the
 * same item at the nearest store that has one, then scales it by how the chain's overall price
 * level compares (see chains.ts). Items with no real price anywhere get no guess.
 *
 * `miles[0]` is the driving distance from the origin to every store, indexed from 1 in `stores` order.
 */
export function estimatePrices(
  estimatedStores: Store[],
  products: Product[],
  realStores: Store[],
  realPrices: Record<string, Record<string, number>>,
  milesFromOrigin: number[],
): Record<string, Record<string, number>> {
  const byDistance = realStores
    .map((store, i) => ({ store, miles: milesFromOrigin[i + 1] ?? Infinity }))
    .sort((a, b) => a.miles - b.miles);

  const out: Record<string, Record<string, number>> = {};
  for (const store of estimatedStores) out[store.id] = {};

  for (const product of products) {
    const anchor = byDistance.map((s) => realPrices[s.store.id]?.[product.id]).find((p) => p !== undefined);
    if (anchor === undefined) continue;
    for (const store of estimatedStores) {
      const chain = chainByKey(store.chainKey);
      if (!chain || !canEstimate(product, chain)) continue;
      out[store.id][product.id] = roundEstimate(anchor * scaleFromKroger(chain));
    }
  }
  return out;
}

/** True when a market includes stores whose prices are guesses. */
export function hasEstimates(market: Pick<Market, 'stores'>): boolean {
  return market.stores.some((s) => s.estimated);
}
