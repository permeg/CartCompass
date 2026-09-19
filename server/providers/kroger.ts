import { haversineMiles } from '../../src/domain/geo';
import type { Product, Store } from '../../src/domain/types';
import { padUpc } from '../../src/domain/upc';
import { UpstreamError } from '../errors';
import { dedupe, inferCategory, tidyName } from '../normalize';

const API = 'https://api.kroger.com/v1';

// Response shapes below were checked against the live API (Sept 2026).
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
  /** Optional. When set, catalog searches include prices for that store. */
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
  const basic = btoa(`${config.clientId}:${config.clientSecret}`);
  const res = await fetch(`${API}/connect/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=product.compact',
    signal,
  });
  // Deliberately not including the response body in the error: it can echo credentials back.
  if (!res.ok) throw new UpstreamError('Kroger', res.status);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Kroger token response had no access_token');
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 1500) * 1000, key };
  return cached.token;
}

export function resetKrogerToken(): void {
  cached = null;
}

/* ---------- catalog ---------- */

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
  if (!res.ok) throw new UpstreamError('Kroger', res.status);
  const body = (await res.json()) as { data?: KrogerProduct[] };
  const products = (body.data ?? []).map(normalizeProduct).filter((p): p is Product => p !== null);
  return dedupe(products).slice(0, limit);
}

/* ---------- stores ---------- */

interface KrogerLocation {
  locationId?: string;
  chain?: string;
  name?: string;
  address?: { addressLine1?: string; city?: string; state?: string; zipCode?: string };
  geolocation?: { latLng?: string; latitude?: number; longitude?: number };
}

const CHAIN_LABELS: Record<string, string> = { QFC: 'QFC', FRED: 'Fred Meyer' };
const MAX_STORES = 10;
const MAX_PER_CHAIN = 3;

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "Quality Food Center - QFC Totem Lake" -> "QFC Totem Lake"; "Fred Meyer - Bellevue" -> "Fred Meyer Bellevue". */
export function storeName(chainCode: string, rawName: string): string {
  const label = CHAIN_LABELS[chainCode] ?? titleCase(chainCode);
  let place = rawName.includes(' - ') ? rawName.slice(rawName.indexOf(' - ') + 3) : rawName;
  // Kroger often repeats the chain in the place name.
  for (;;) {
    const trimmed = place.replace(/^(qfc|quality food center|fred meyer)\s+/i, '');
    if (trimmed === place) break;
    place = trimmed;
  }
  place = place.trim();
  return place && place.toLowerCase() !== label.toLowerCase() ? `${label} ${place}` : label;
}

export function normalizeLocation(l: KrogerLocation): Store | null {
  const id = l.locationId?.trim();
  const g = l.geolocation;
  let lat = g?.latitude;
  let lon = g?.longitude;
  if ((lat === undefined || lon === undefined) && g?.latLng) {
    const [a, b] = g.latLng.split(',').map(Number);
    lat = a;
    lon = b;
  }
  if (!id || typeof lat !== 'number' || typeof lon !== 'number' || Number.isNaN(lat) || Number.isNaN(lon)) return null;
  const chain = (l.chain ?? 'KROGER').toUpperCase();
  const a = l.address;
  return {
    id: `kroger:${id}`,
    name: storeName(chain, l.name ?? ''),
    blurb: [a?.addressLine1, a?.city].filter(Boolean).join(', '),
    chain: CHAIN_LABELS[chain] ?? titleCase(chain),
    lat,
    lon,
  };
}

/**
 * Kroger-family stores near a point. Fetching many near-identical QFCs would only
 * slow the trip planner down (every QFC shares one price list), so keep the
 * nearest few of each chain.
 */
export async function krogerStoresNear(
  config: KrogerConfig,
  origin: { lat: number; lon: number },
  radiusMiles: number,
  signal?: AbortSignal,
): Promise<Store[]> {
  const token = await accessToken(config, signal);
  const url = new URL(`${API}/locations`);
  url.searchParams.set('filter.latLong.near', `${origin.lat},${origin.lon}`);
  url.searchParams.set('filter.radiusInMiles', String(Math.min(Math.max(Math.round(radiusMiles), 1), 25)));
  url.searchParams.set('filter.limit', '50');
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal });
  if (res.status === 401) cached = null;
  if (!res.ok) throw new UpstreamError('Kroger', res.status);
  const body = (await res.json()) as { data?: KrogerLocation[] };

  const found = (body.data ?? [])
    .map(normalizeLocation)
    .filter((s): s is Store => s !== null)
    .sort((a, b) => haversineMiles(origin, a) - haversineMiles(origin, b));

  const perChain = new Map<string, number>();
  const kept: Store[] = [];
  for (const s of found) {
    const n = perChain.get(s.chain ?? '') ?? 0;
    if (n >= MAX_PER_CHAIN || kept.length >= MAX_STORES) continue;
    perChain.set(s.chain ?? '', n + 1);
    kept.push(s);
  }
  return kept;
}

/* ---------- prices ---------- */

interface PricedProduct {
  productId?: string;
  upc?: string;
  items?: {
    price?: { regular?: number; promo?: number };
    inventory?: { stockLevel?: string };
    fulfillment?: { inStore?: boolean };
  }[];
}

const BATCH = 50;

/** The price a shopper pays, in cents, or null when the store can't sell it right now. */
export function shelfPriceCents(p: PricedProduct): number | null {
  const item = p.items?.[0];
  const price = item?.price;
  if (!price) return null;
  if (item.inventory?.stockLevel === 'TEMPORARILY_OUT_OF_STOCK') return null;
  if (item.fulfillment?.inStore === false) return null;
  const dollars = price.promo && price.promo > 0 ? price.promo : price.regular;
  return typeof dollars === 'number' && dollars > 0 ? Math.round(dollars * 100) : null;
}

/**
 * Price a list of products at each store. Returns storeId -> 13-digit UPC -> cents.
 * A product with no entry isn't sold at that store (or is out of stock).
 */
export async function krogerPrices(
  config: KrogerConfig,
  storeIds: string[],
  upcs: string[],
  signal?: AbortSignal,
): Promise<Record<string, Record<string, number>>> {
  const token = await accessToken(config, signal);
  const codes = [...new Set(upcs.map((u) => padUpc(u)).filter((u): u is string => u !== null))];
  const batches: string[][] = [];
  for (let i = 0; i < codes.length; i += BATCH) batches.push(codes.slice(i, i + BATCH));

  const out: Record<string, Record<string, number>> = {};
  await Promise.all(
    storeIds.map(async (storeId) => {
      const locationId = storeId.replace(/^kroger:/, '');
      out[storeId] = {};
      await Promise.all(
        batches.map(async (batch) => {
          const url = new URL(`${API}/products`);
          url.searchParams.set('filter.productId', batch.join(','));
          url.searchParams.set('filter.locationId', locationId);
          const res = await fetch(url, {
            headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
            signal,
          });
          if (res.status === 401) cached = null;
          if (!res.ok) throw new UpstreamError('Kroger', res.status);
          const body = (await res.json()) as { data?: PricedProduct[] };
          for (const p of body.data ?? []) {
            const code = padUpc(p.productId ?? p.upc);
            const cents = shelfPriceCents(p);
            if (code && cents !== null) out[storeId][code] = cents;
          }
        }),
      );
    }),
  );
  return out;
}
