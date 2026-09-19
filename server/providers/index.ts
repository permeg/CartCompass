import type { Product } from '../../src/domain/types';
import { krogerConfig, searchKroger } from './kroger';
import { searchOpenFoodFacts } from './openFoodFacts';

export type CatalogSource = 'kroger' | 'openfoodfacts';

type Env = Record<string, string | undefined>;

/**
 * CATALOG_PROVIDER can force `kroger` or `openfoodfacts`. Left as `auto`, Kroger
 * is used whenever its keys are present, since its products can be priced later.
 */
export function pickCatalogSource(env: Env): CatalogSource {
  const wanted = env.CATALOG_PROVIDER?.trim().toLowerCase();
  const kroger = krogerConfig(env) !== null;
  if (wanted === 'openfoodfacts') return 'openfoodfacts';
  return kroger ? 'kroger' : 'openfoodfacts';
}

export async function searchCatalog(
  env: Env,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<{ source: CatalogSource; products: Product[] }> {
  const source = pickCatalogSource(env);
  if (source === 'kroger') {
    return { source, products: await searchKroger(krogerConfig(env)!, query, limit, signal) };
  }
  return { source, products: await searchOpenFoodFacts(query, limit, signal) };
}
