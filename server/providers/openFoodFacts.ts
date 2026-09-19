import type { Product } from '../../src/domain/types';
import { dedupe, inferCategory, tidyName } from '../normalize';

const ENDPOINT = 'https://search.openfoodfacts.org/search';
// Open Food Facts asks every client to identify itself.
const USER_AGENT = 'CartCompass/0.1 (portfolio project)';

interface Hit {
  code?: string;
  product_name?: string;
  brands?: string[] | string | null;
  quantity?: string | null;
  categories_tags?: string[];
  image_front_small_url?: string | null;
}

export function normalizeHit(hit: Hit): Product | null {
  const name = hit.product_name?.trim();
  if (!hit.code || !name) return null;
  const brands = Array.isArray(hit.brands) ? hit.brands : hit.brands ? [hit.brands] : [];
  const brand = brands.map((b) => b.trim()).find(Boolean);
  return {
    id: `off:${hit.code}`,
    name: tidyName(name),
    size: hit.quantity?.trim() ?? '',
    category: inferCategory(hit.categories_tags ?? []),
    brand,
    imageUrl: hit.image_front_small_url ?? undefined,
    upc: hit.code,
    source: 'openfoodfacts',
  };
}

/** Search Open Food Facts, limited to products sold in the United States. */
export async function searchOpenFoodFacts(query: string, limit: number, signal?: AbortSignal): Promise<Product[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('q', `${query} countries_tags:"en:united-states"`);
  // Ask for extra rows, since blank names and repeats get filtered out.
  url.searchParams.set('page_size', String(Math.min(limit * 3, 40)));
  url.searchParams.set('fields', 'code,product_name,brands,quantity,categories_tags,image_front_small_url');

  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal });
  if (!res.ok) throw new Error(`Open Food Facts responded ${res.status}`);
  const body = (await res.json()) as { hits?: Hit[] };
  const products = (body.hits ?? []).map(normalizeHit).filter((p): p is Product => p !== null);
  return dedupe(products).slice(0, limit);
}
