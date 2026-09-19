import type { Product } from '../../src/domain/types';
import { dedupe, inferCategory, tidyName } from '../normalize';

const API = 'https://api.kroger.com/v1';

// NOTE: written from Kroger's public documentation and not yet exercised against
// the live API (it needs a developer account). Check the first real responses.
interface KrogerProduct {
  productId?: string;
  upc?: string;
  brand?: string;
  description?: string;
  categories?: string[];
  images?: { perspective?: string; sizes?: { size?: string; url?: string }[] }[];
  items?: { size?: string; price?: { regular?: number; promo?: number } }[];
}

export interface KrogerConfig {
  clientId: string;
  clientSecret: string;
  /** Optional. When set, Kroger includes prices for that store. */
  locationId?: string;
}

export function krogerConfig(env: Record<string, string | undefined>): KrogerConfig | null {
  const clientId = env.KROGER_CLIENT_ID?.trim();
  const clientSecret = env.KROGER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, locationId: env.KROGER_LOCATION_ID?.trim() || undefined };
}

let cached: { token: string; expiresAt: number; key: string } | null = null;

async function accessToken(config: KrogerConfig, signal?: AbortSignal): Promise<string> {
  const key = config.clientId;
  if (cached && cached.key === key && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const res = await fetch(`${API}/connect/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=product.compact',
    signal,
  });
  // Deliberately not including the response body in the error: it can echo credentials back.
  if (!res.ok) throw new Error(`Kroger token request failed with ${res.status}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Kroger token response had no access_token');
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 1500) * 1000, key };
  return cached.token;
}

export function resetKrogerToken(): void {
  cached = null;
}

export function normalizeProduct(p: KrogerProduct): Product | null {
  const upc = p.upc ?? p.productId;
  const name = p.description?.trim();
  if (!upc || !name) return null;
  const item = p.items?.[0];
  const price = item?.price?.regular;
  const front = p.images?.find((i) => i.perspective === 'front') ?? p.images?.[0];
  const image = front?.sizes?.find((s) => s.size === 'thumbnail' || s.size === 'small')?.url ?? front?.sizes?.[0]?.url;
  return {
    id: `kroger:${upc}`,
    name: tidyName(name),
    size: item?.size?.trim() ?? '',
    category: inferCategory(p.categories ?? []),
    brand: p.brand?.trim() || undefined,
    imageUrl: image,
    upc,
    referencePrice: typeof price === 'number' && price > 0 ? Math.round(price * 100) : undefined,
    source: 'kroger',
  };
}

export async function searchKroger(
  config: KrogerConfig,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Product[]> {
  const token = await accessToken(config, signal);
  const url = new URL(`${API}/products`);
  url.searchParams.set('filter.term', query);
  url.searchParams.set('filter.limit', String(Math.min(limit * 2, 50)));
  if (config.locationId) url.searchParams.set('filter.locationId', config.locationId);

  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal });
  if (res.status === 401) cached = null;
  if (!res.ok) throw new Error(`Kroger product search failed with ${res.status}`);
  const body = (await res.json()) as { data?: KrogerProduct[] };
  const products = (body.data ?? []).map(normalizeProduct).filter((p): p is Product => p !== null);
  return dedupe(products).slice(0, limit);
}
