import type { Category, Product } from '../src/domain/types';

/**
 * Sort a catalog product into one of the app's aisles from whatever category
 * text the source gives us. Order matters: the specific cases go first so that
 * "frozen vegetables" and "canned vegetables" don't land in produce.
 */
export function inferCategory(hints: string[]): Category {
  const text = hints
    .join(' ')
    .toLowerCase()
    .replace(/plant-based-foods-and-beverages/g, '')
    .replace(/[^a-z& ]+/g, ' ');

  const has = (re: RegExp) => re.test(text);
  if (has(/cleaning|laundry|detergent|paper towel|toilet|tissue|household|trash bag|diaper|soap/)) return 'Household';
  if (has(/frozen|ice cream/)) return 'Frozen';
  if (
    has(
      /peanut|nut butter|canned|preserved|dried|jam|sauce|soup|snack|cereal|pasta|rice|oil|spice|condiment|chocolate|biscuit|cookie|candy|coffee|flour|sugar/,
    )
  )
    return 'Pantry';
  if (has(/meat|poultry|chicken|beef|pork|seafood|fish|sausage|bacon|turkey|shrimp/)) return 'Meat & seafood';
  if (has(/dairy|dairies|milk|cheese|yogurt|yoghurt|butter|egg|cream/)) return 'Dairy & eggs';
  if (has(/bread|bakery|bakeries|pastr|tortilla|bagel|bun |cake/)) return 'Bakery';
  if (has(/beverage|drink|juice|soda|water|tea /)) return 'Beverages';
  if (has(/fresh|fruit|vegetable|produce|salad|herb/)) return 'Produce';
  return 'Pantry';
}

/** "WHOLE MILK" -> "Whole milk". Otherwise just capitalises the first letter. */
export function tidyName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length > 1 && name === name.toUpperCase()) return name.charAt(0) + name.slice(1).toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Drop repeats that only differ by case, so the same milk doesn't appear five times. */
export function dedupe(products: Product[]): Product[] {
  const seen = new Set<string>();
  return products.filter((p) => {
    const key = [p.name, p.size, p.brand ?? ''].map((s) => s.toLowerCase().trim()).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
