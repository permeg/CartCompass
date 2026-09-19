import type { Category, Product } from '../domain/types';
import type { RemoteCatalog } from './providers';

const CATEGORIES: Category[] = [
  'Dairy & eggs',
  'Produce',
  'Meat & seafood',
  'Bakery',
  'Pantry',
  'Frozen',
  'Beverages',
  'Household',
];

/** The proxy is ours, but its output still becomes cart data, so check its shape. */
function toProduct(value: unknown): Product | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.name !== 'string' || v.name.trim() === '') return null;
  const str = (x: unknown) => (typeof x === 'string' && x.trim() !== '' ? x : undefined);
  return {
    id: v.id,
    name: v.name,
    size: typeof v.size === 'string' ? v.size : '',
    category: CATEGORIES.includes(v.category as Category) ? (v.category as Category) : 'Pantry',
    brand: str(v.brand),
    imageUrl: str(v.imageUrl),
    upc: str(v.upc),
    referencePrice: typeof v.referencePrice === 'number' && v.referencePrice > 0 ? v.referencePrice : undefined,
    source: v.source === 'kroger' || v.source === 'openfoodfacts' ? v.source : undefined,
  };
}

const cache = new Map<string, Product[]>();

/**
 * Product search through our own `/api/catalog/search` proxy. Open Food Facts results are
 * kept for the session; Kroger results are not, since Kroger's terms only allow keeping
 * its content as long as its cache header permits (and it sends none).
 */
export const remoteCatalog: RemoteCatalog = {
  async starter(storeId) {
    const res = await fetch(`/api/starter?store=${encodeURIComponent(storeId)}`);
    if (!res.ok) throw new Error(`Starter list failed (${res.status})`);
    const body = (await res.json()) as { items?: { product?: unknown; qty?: unknown }[] };
    return (body.items ?? []).flatMap((item) => {
      const product = toProduct(item.product);
      const qty = typeof item.qty === 'number' && item.qty >= 1 && item.qty <= 99 ? Math.round(item.qty) : 1;
      return product ? [{ productId: product.id, qty, product }] : [];
    });
  },

  async search(query, signal, storeId) {
    const key = `${storeId ?? ''}|${query.trim().toLowerCase()}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const store = storeId ? `&store=${encodeURIComponent(storeId)}` : '';
    const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(query.trim())}${store}`, { signal });
    if (!res.ok) throw new Error(`Catalog search failed (${res.status})`);
    const body = (await res.json()) as { source?: string; products?: unknown[] };
    const products = (body.products ?? []).map(toProduct).filter((p): p is Product => p !== null);
    if (body.source !== 'kroger') cache.set(key, products);
    return products;
  },
};
