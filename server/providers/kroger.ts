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
let pending: { key: string; promise: Promise<string> } | null = null;

async function accessToken(config: KrogerConfig, signal?: AbortSignal): Promise<string> {
  const key = config.clientId;
  if (cached && cached.key === key && cached.expiresAt > Date.now() + 30_000) return cached.token;
  // Several searches can start together (the starter list does); they share one token request.
  if (pending && pending.key === key) return pending.promise;
  const promise = requestToken(config, signal).finally(() => {
    if (pending?.promise === promise) pending = null;
  });
  pending = { key, promise };
  return promise;
}

async function requestToken(config: KrogerConfig, signal?: AbortSignal): Promise<string> {
  const key = config.clientId;
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
  pending = null;
}

/* ---------- catalog ---------- */

export function normalizeProduct(p: KrogerProduct, priceCents?: number): Product | null {
  const upc = p.upc ?? p.productId;
  const name = p.description?.trim();
  if (!upc || !name) return null;
  const item = p.items?.[0];
  const price = priceCents !== undefined ? priceCents / 100 : item?.price?.regular;
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

/**
 * Search Kroger's catalog. With a `storeId`, results are limited to what that store sells
 * right now, each carrying that store's shelf price, so people only find things they can buy.
 */
export async function searchKroger(
  config: KrogerConfig,
  query: string,
  limit: number,
  signal?: AbortSignal,
  storeId?: string,
): Promise<Product[]> {
  const token = await accessToken(config, signal);
  const url = new URL(`${API}/products`);
  url.searchParams.set('filter.term', query);
  url.searchParams.set('filter.limit', String(Math.min(limit * (storeId ? 4 : 2), 50)));
  const locationId = storeId ? storeId.replace(/^kroger:/, '') : config.locationId;
  if (locationId) url.searchParams.set('filter.locationId', locationId);

  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal });
  if (res.status === 401) cached = null;
  if (!res.ok) throw new UpstreamError('Kroger', res.status);
  const body = (await res.json()) as { data?: KrogerProduct[] };
  const products = (body.data ?? [])
    .map((p) => {
      if (!storeId) return normalizeProduct(p);
      const cents = shelfPriceCents(p);
      return cents === null ? null : normalizeProduct(p, cents);
    })
    .filter((p): p is Product => p !== null);
  return dedupe(products).slice(0, limit);
}

/* ---------- stores ---------- */

interface KrogerLocation {
  locationId?: string;
  chain?: string;
  name?: string;
  address?: { addressLine1?: string; city?: string; state?: string; zipCode?: string };
  geolocation?: { latLng?: string; latitude?: number; longitude?: number };
  departments?: unknown[];
}

/** The banners in Kroger's family, as their customers know them. */
const CHAIN_LABELS: Record<string, string> = {
  QFC: 'QFC',
  FRED: 'Fred Meyer',
  KROGER: 'Kroger',
  RALPHS: 'Ralphs',
  FOOD4LESS: 'Food 4 Less',
  FOODSCO: 'Foods Co',
  FRYS: "Fry's",
  SMITHS: "Smith's",
  KINGSOOPERS: 'King Soopers',
  MARIANOS: "Mariano's",
  'METRO MARKET': 'Metro Market',
  'PICK N SAVE': "Pick 'n Save",
  HART: 'Harris Teeter',
  JAYC: 'Jay C',
  BAKERS: "Baker's",
  DILLONS: 'Dillons',
  GERBES: 'Gerbes',
  'CITY MARKET': 'City Market',
  PAYLESS: 'Pay Less',
  COPPS: 'Copps',
};
const MAX_STORES = 10;
const MAX_PER_CHAIN = 3;

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function chainLabel(code: string): string {
  return CHAIN_LABELS[code] ?? titleCase(code);
}

/** "Quality Food Center - QFC Totem Lake" -> "QFC Totem Lake"; "Marianos - Marianos Lakeshore East" -> "Mariano's Lakeshore East". */
export function storeName(chainCode: string, rawName: string): string {
  const label = chainLabel(chainCode);
  let place = rawName.includes(' - ') ? rawName.slice(rawName.indexOf(' - ') + 3) : rawName;
  place = place.replace(/^[\s-]+/, '');
  // Kroger often repeats the chain in the place name, sometimes spelled a little differently
  // ("Frys", "Marianos"). Drop leading words that just spell out the chain.
  let rest = label.toLowerCase().replace(/[^a-z0-9]/g, '');
  const words = place.split(/\s+/).filter(Boolean);
  while (words.length > 0) {
    const w = words[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (w && rest.startsWith(w) && (w.length >= 3 || w === rest)) {
      rest = rest.slice(w.length);
      words.shift();
    } else if (chainCode === 'QFC' && (w === 'quality' || w === 'food' || w === 'center')) {
      // "Quality Food Center" is QFC's full name.
      words.shift();
    } else break;
  }
  place = tidyCase(words.join(' ').trim());
  // "Glenwood Kroger" -> "Glenwood": the banner is already at the front.
  if (place.toLowerCase().endsWith(label.toLowerCase())) place = place.slice(0, place.length - label.length).trim();
  return place && place.toLowerCase() !== label.toLowerCase() ? `${label} ${place}` : label;
}

/** Kroger's data shouts sometimes ("CHICAGO", "1155 E 9Th Ave"). Make it read normally. */
export function tidyCase(text: string): string {
  const t = text === text.toUpperCase() ? titleCase(text) : text;
  return t
    .replace(/(\d)(St|Nd|Rd|Th)\b/g, (_m, d: string, suffix: string) => d + suffix.toLowerCase())
    .replace(/\b(Ne|Nw|Se|Sw)\b/g, (m) => m.toUpperCase());
}

/**
 * Kroger's location list includes distribution centers, e-commerce hubs and test
 * entries. Only keep places a person could actually shop.
 */
export function isShoppableStore(l: KrogerLocation): boolean {
  const chain = (l.chain ?? '').toUpperCase();
  if (chain === 'VITACOST') return false;
  if (/unused|spoke|fulfil|distribution|warehouse|\bshed\b|\bdc\b|\btest\b/i.test(l.name ?? '')) return false;
  if (Array.isArray(l.departments) && l.departments.length < 5) return false;
  return true;
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
  if (!isShoppableStore(l)) return null;
  const chain = (l.chain ?? 'KROGER').toUpperCase();
  const a = l.address;
  return {
    id: `kroger:${id}`,
    name: storeName(chain, l.name ?? ''),
    blurb: [a?.addressLine1, a?.city]
      .filter((x): x is string => !!x)
      .map(tidyCase)
      .join(', '),
    chain: chainLabel(chain),
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

/* ---------- starter list ---------- */

/** Everyday staples, searched at the user's nearest store so the list matches what that store carries. */
const STARTER_ITEMS: { term: string; qty: number }[] = [
  { term: 'large eggs', qty: 1 },
  { term: 'whole milk', qty: 1 },
  { term: 'bananas', qty: 3 },
  { term: 'sandwich bread', qty: 1 },
  { term: 'butter', qty: 1 },
  { term: 'cheddar cheese', qty: 1 },
  { term: 'spaghetti', qty: 2 },
  { term: 'pasta sauce', qty: 2 },
  { term: 'rolled oats', qty: 1 },
  { term: 'ground coffee', qty: 1 },
  { term: 'olive oil', qty: 1 },
  { term: 'jasmine rice', qty: 1 },
  { term: 'yellow onions', qty: 1 },
  { term: 'chicken thighs', qty: 2 },
  { term: 'cucumber', qty: 2 },
];

/**
 * A starter list built from what one store actually sells: the top in-stock result for
 * each staple, with that store's price. Items the store doesn't carry are left out.
 */
export async function krogerStarter(
  config: KrogerConfig,
  storeId: string,
  signal?: AbortSignal,
): Promise<{ product: Product; qty: number }[]> {
  const settled = await Promise.allSettled(
    STARTER_ITEMS.map(async ({ term, qty }) => {
      const [product] = await searchKroger(config, term, 1, signal, storeId);
      return product ? { product, qty } : null;
    }),
  );
  const items = settled.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
  const failure = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  // A few missing items is normal. Everything failing means Kroger is the problem.
  if (items.length === 0 && failure) throw failure.reason;
  return items;
}
