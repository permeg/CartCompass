/**
 * SEEDED DEMO DATA. Every store, price and gas figure in this file is invented.
 * It exists so the app works with no API keys. See ROADMAP.md for the plan to
 * replace it with real providers.
 */
import type { CartLine, Category, Neighborhood, Product, Store } from '../domain/types';
import { EXTRA_PRODUCTS } from './catalog';

export const NEIGHBORHOODS: Neighborhood[] = [
  { id: 'wilburton', label: 'Wilburton', zip: '98004', lat: 47.606, lon: -122.183 },
  { id: 'downtown', label: 'Downtown Bellevue', zip: '98004', lat: 47.6104, lon: -122.2007 },
  { id: 'crossroads', label: 'Crossroads', zip: '98008', lat: 47.6175, lon: -122.124 },
  { id: 'factoria', label: 'Factoria', zip: '98006', lat: 47.5735, lon: -122.149 },
  { id: 'lakehills', label: 'Lake Hills', zip: '98007', lat: 47.596, lon: -122.13 },
  { id: 'newport', label: 'Newport Hills', zip: '98006', lat: 47.557, lon: -122.19 },
];

export const DEFAULT_NEIGHBORHOOD = 'wilburton';

export interface SeedStore extends Store {
  /** Baseline price multiplier for the whole store. */
  factor: number;
  /** Per-category adjustment on top of `factor`. */
  bias: Partial<Record<Category, number>>;
  /** Share of the catalog this store stocks. */
  coverage: number;
}

export const SEED_STORES: SeedStore[] = [
  {
    id: 'meridian',
    name: 'Meridian Foods',
    blurb: 'Full-service supermarket',
    lat: 47.6136,
    lon: -122.1958,
    factor: 1.0,
    bias: { Produce: 1.02 },
    coverage: 1,
  },
  {
    id: 'alder',
    name: 'Alder Market',
    blurb: 'Natural and organic grocer',
    lat: 47.6039,
    lon: -122.2013,
    factor: 1.2,
    bias: { Produce: 1.05, 'Meat & seafood': 1.1 },
    coverage: 1,
  },
  {
    id: 'thrift',
    name: 'Thrift & Co',
    blurb: 'Discount grocer, limited selection',
    lat: 47.5962,
    lon: -122.1565,
    factor: 0.87,
    bias: { 'Dairy & eggs': 0.95, Pantry: 0.94, Produce: 1.05 },
    coverage: 0.78,
  },
  {
    id: 'crossroads',
    name: 'Crossroads Grocer',
    blurb: 'Neighborhood supermarket',
    lat: 47.6172,
    lon: -122.129,
    factor: 1.03,
    bias: { Produce: 0.86, Bakery: 0.9 },
    coverage: 1,
  },
  {
    id: 'factoria',
    name: 'Factoria Fresh',
    blurb: 'Supermarket with a deli counter',
    lat: 47.5728,
    lon: -122.1455,
    factor: 0.98,
    bias: { 'Meat & seafood': 0.9 },
    coverage: 0.97,
  },
  {
    id: 'lowtide',
    name: 'Lowtide Foods',
    blurb: 'Closeouts and overstock',
    lat: 47.6265,
    lon: -122.156,
    factor: 0.8,
    bias: { Household: 0.85, Beverages: 0.9, 'Meat & seafood': 1.15 },
    coverage: 0.7,
  },
  {
    id: 'harbor',
    name: 'Harbor Wholesale',
    blurb: 'Warehouse club, members only',
    lat: 47.585,
    lon: -122.123,
    factor: 0.78,
    bias: { 'Meat & seafood': 0.9, Pantry: 0.92, Produce: 1.1 },
    coverage: 0.85,
    membership: true,
  },
];

/** Shelf price in cents at a "typical" store. */
export interface SeedProduct extends Product {
  basePrice: number;
}

const p = (
  id: string,
  name: string,
  size: string,
  category: Category,
  basePrice: number,
  aliases: string[] = [],
): SeedProduct => ({ id, name, size, category, basePrice, aliases });

const CORE_PRODUCTS: SeedProduct[] = [
  p('eggs-12', 'Large eggs', '12 ct', 'Dairy & eggs', 449, ['12 eggs', 'dozen eggs', 'eggs']),
  p('eggs-18', 'Large eggs', '18 ct', 'Dairy & eggs', 619, ['18 eggs', 'eggs']),
  p('milk-whole', 'Whole milk', '1 gal', 'Dairy & eggs', 439, ['milk']),
  p('milk-2', '2% milk', '1 gal', 'Dairy & eggs', 429, ['milk', 'two percent']),
  p('milk-oat', 'Oat milk', '64 oz', 'Dairy & eggs', 449, ['milk', 'plant milk']),
  p('butter', 'Salted butter', '1 lb', 'Dairy & eggs', 549),
  p('cheddar', 'Sharp cheddar', '8 oz', 'Dairy & eggs', 429, ['cheese']),
  p('mozzarella', 'Shredded mozzarella', '8 oz', 'Dairy & eggs', 369, ['cheese']),
  p('cream-cheese', 'Cream cheese', '8 oz', 'Dairy & eggs', 259),
  p('yogurt', 'Plain Greek yogurt', '32 oz', 'Dairy & eggs', 549),

  p('bananas', 'Bananas', 'per lb', 'Produce', 69),
  p('apples', 'Gala apples', '3 lb bag', 'Produce', 599),
  p('avocado', 'Avocado', 'each', 'Produce', 149),
  p('tomatoes', 'Roma tomatoes', 'per lb', 'Produce', 199),
  p('onions', 'Yellow onions', '3 lb bag', 'Produce', 379),
  p('potatoes', 'Russet potatoes', '5 lb bag', 'Produce', 449),
  p('spinach', 'Baby spinach', '5 oz', 'Produce', 329, ['greens']),
  p('carrots', 'Carrots', '2 lb bag', 'Produce', 279),
  p('broccoli', 'Broccoli crowns', 'per lb', 'Produce', 229),
  p('romaine', 'Romaine hearts', '3 ct', 'Produce', 449, ['lettuce']),

  p('chicken-thigh', 'Bone-in chicken thighs', 'per lb', 'Meat & seafood', 229, ['chicken']),
  p('chicken-breast', 'Boneless chicken breast', 'per lb', 'Meat & seafood', 449, ['chicken']),
  p('ground-beef', 'Ground beef, 80/20', '1 lb', 'Meat & seafood', 749, ['beef', 'hamburger']),
  p('bacon', 'Thick-cut bacon', '12 oz', 'Meat & seafood', 799),
  p('salmon', 'Atlantic salmon fillet', 'per lb', 'Meat & seafood', 1099, ['fish']),

  p('bread', 'Sandwich bread', '20 oz', 'Bakery', 399, ['loaf']),
  p('tortillas', 'Flour tortillas', '10 ct', 'Bakery', 349, ['wraps']),
  p('bagels', 'Plain bagels', '6 ct', 'Bakery', 449),

  p('oats', 'Rolled oats', '42 oz', 'Pantry', 649, ['oatmeal', 'old fashioned oats']),
  p('pasta', 'Spaghetti', '1 lb', 'Pantry', 199, ['noodles']),
  p('marinara', 'Marinara sauce', '24 oz', 'Pantry', 379, ['tomato sauce', 'pasta sauce']),
  p('rice', 'Jasmine rice', '5 lb', 'Pantry', 749),
  p('olive-oil', 'Extra virgin olive oil', '17 oz', 'Pantry', 999, ['oil']),
  p('peanut-butter', 'Peanut butter', '16 oz', 'Pantry', 399),
  p('flour', 'All-purpose flour', '5 lb', 'Pantry', 449),
  p('sugar', 'Granulated sugar', '4 lb', 'Pantry', 429),
  p('coffee', 'Ground coffee', '12 oz', 'Pantry', 999),
  p('black-beans', 'Black beans', '15 oz can', 'Pantry', 129, ['beans']),
  p('diced-tomatoes', 'Diced tomatoes', '14.5 oz can', 'Pantry', 129),
  p('broth', 'Chicken broth', '32 oz', 'Pantry', 269, ['stock']),
  p('cereal', 'Corn flakes', '12 oz', 'Pantry', 499, ['cereal']),
  p('honey', 'Clover honey', '12 oz', 'Pantry', 599),
  p('tuna', 'Chunk light tuna', '5 oz can', 'Pantry', 149),

  p('frozen-veg', 'Frozen mixed vegetables', '12 oz', 'Frozen', 229),
  p('ice-cream', 'Vanilla ice cream', '1.5 qt', 'Frozen', 599),
  p('frozen-pizza', 'Frozen pizza', '12 in', 'Frozen', 749),
  p('frozen-berries', 'Frozen mixed berries', '48 oz', 'Frozen', 1099),

  p('oj', 'Orange juice', '52 oz', 'Beverages', 499),
  p('sparkling', 'Sparkling water', '12 pack', 'Beverages', 599, ['seltzer']),
  p('tea', 'Black tea bags', '20 ct', 'Beverages', 399),

  p('paper-towels', 'Paper towels', '6 rolls', 'Household', 1099),
  p('dish-soap', 'Dish soap', '19 oz', 'Household', 399),
  p('toilet-paper', 'Toilet paper', '12 mega rolls', 'Household', 1399),
  p('trash-bags', 'Kitchen trash bags', '30 ct', 'Household', 899),
];

export const SEED_PRODUCTS: SeedProduct[] = [...CORE_PRODUCTS, ...EXTRA_PRODUCTS];

/** The demo catalog as plain products, without the invented base prices. */
export const DEMO_CATALOG: Product[] = SEED_PRODUCTS.map(({ basePrice: _basePrice, ...product }) => product);

const DEMO_BY_ID = new Map(DEMO_CATALOG.map((p) => [p.id, p]));

export function findDemoProduct(id: string): Product | undefined {
  return DEMO_BY_ID.get(id);
}

/** What a fresh visitor sees: a cart that produces an interesting trade-off. */
const SAMPLE_ITEMS: [string, number][] = [
  ['eggs-12', 1],
  ['milk-whole', 1],
  ['oats', 1],
  ['bananas', 3],
  ['chicken-thigh', 3],
  ['pasta', 2],
  ['marinara', 2],
  ['cheddar', 1],
  ['bread', 1],
  ['coffee', 1],
  ['olive-oil', 1],
  ['rice', 1],
  ['onions', 1],
  ['butter', 1],
];

export const SAMPLE_CART: CartLine[] = SAMPLE_ITEMS.map(([productId, qty]) => ({
  productId,
  qty,
  product: DEMO_BY_ID.get(productId)!,
}));

export const SEED_GAS_PRICE_CENTS = 489;
export const SEED_PRICES_AS_OF = '2026-09-17T18:00:00Z';
