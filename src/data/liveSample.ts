/**
 * A starter list of real products for live mode, so a first-time visitor sees a
 * working trip straight away. These are snapshots of real Kroger products
 * (checked Sept 2026). Prices are never stored here: they are fetched live, and
 * if a product is discontinued it simply shows as "not sold at any nearby store".
 */
import type { CartLine, Category, Product } from '../domain/types';

const k = (upc: string, name: string, size: string, category: Category, brand: string): Product => ({
  id: `kroger:${upc}`,
  name,
  size,
  category,
  brand,
  upc,
  imageUrl: `https://www.kroger.com/product/images/small/front/${upc}`,
  source: 'kroger',
});

export const LIVE_STARTERS: Record<string, Product> = {
  eggs: k('0071514151471', "Eggland's Best Cage Free Large White Eggs", '12 ct', 'Dairy & eggs', "Eggland's Best"),
  milk: k('0001111042908', 'Simple Truth Organic® Vitamin D Whole Milk Gallon', '1 gal', 'Dairy & eggs', 'Simple Truth Organic'),
  oats: k('0003997804154', "Bob's Red Mill Whole Grain Old Fashioned Rolled Oats", '32 oz', 'Pantry', "Bob's Red Mill"),
  bananas: k('0000000004011', 'Fresh Bunch of Bananas – 5-7 Bananas', '1 lb', 'Produce', ''),
  chicken: k('0024898750000', 'Simple Truth® Natural Boneless and Skinless Fresh Chicken Thighs', '1 lb', 'Meat & seafood', 'Simple Truth'),
  spaghetti: k('0001111085004', 'Kroger® Spaghetti', '16 oz', 'Pantry', 'Kroger'),
  marinara: k('0001111013416', 'Kroger® Marinara Pasta Sauce', '24 oz', 'Pantry', 'Kroger'),
  cheddar: k('0001111058627', 'Kroger® Sharp Cheddar Block Cheese', '8 oz', 'Dairy & eggs', 'Kroger'),
  bread: k('0007225001137', 'Wonder Classic White Bread', '20 oz', 'Bakery', 'Wonder'),
  coffee: k('0001111010741', 'Kroger® 100% Colombian Medium Dark Roast Ground Coffee', '11 oz', 'Pantry', 'Kroger'),
  oil: k('0001111087856', 'Kroger® Extra Virgin Olive Oil', '16.9 fl oz', 'Pantry', 'Kroger'),
  rice: k('0001111015343', 'Kroger® Jasmine Rice', '5 lb', 'Pantry', 'Kroger'),
  onions: k('0001111091682', 'Kroger® Yellow Onion 3 lb Bag', '3 lb', 'Produce', 'Kroger'),
  butter: k('0001111010080', 'Kroger® Salted Butter Sticks', '16 oz', 'Dairy & eggs', 'Kroger'),
  cucumber: k('0000000004593', 'English Cucumber', '1 ct', 'Produce', ''),
};

// Empty brands are left out so the cart row doesn't show a stray separator.
for (const p of Object.values(LIVE_STARTERS)) if (!p.brand) delete p.brand;

const sample: [keyof typeof LIVE_STARTERS, number][] = [
  ['eggs', 1],
  ['milk', 1],
  ['oats', 1],
  ['bananas', 3],
  ['chicken', 2],
  ['spaghetti', 2],
  ['marinara', 2],
  ['cheddar', 1],
  ['bread', 1],
  ['coffee', 1],
  ['oil', 1],
  ['rice', 1],
  ['onions', 1],
  ['butter', 1],
  ['cucumber', 2],
];

export const LIVE_SAMPLE_CART: CartLine[] = sample.map(([key, qty]) => ({
  productId: LIVE_STARTERS[key].id,
  qty,
  product: LIVE_STARTERS[key],
}));

/** One-tap adds for an empty list. */
export const LIVE_QUICK_ADDS: Product[] = [
  LIVE_STARTERS.eggs,
  LIVE_STARTERS.milk,
  LIVE_STARTERS.bread,
  LIVE_STARTERS.bananas,
  LIVE_STARTERS.oats,
  LIVE_STARTERS.coffee,
];
