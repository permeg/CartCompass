import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { places } from './handlers';
import { buildQuery, normalizeElement, pickNearest, resetOsmCache } from './providers/osm';
import { resetRateLimit } from './rateLimit';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const get = (path: string) => new Request(`http://localhost${path}`, { headers: { 'x-forwarded-for': '203.0.113.7' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetRateLimit();
  resetOsmCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const home = { lat: 47.606, lon: -122.183 };
const el = (id: number, tags: Record<string, string>, lat = 47.62, lon = -122.15, type = 'node') => ({ type, id, lat, lon, tags });

describe('normalizeElement', () => {
  it('turns an OpenStreetMap shop into an estimated store', () => {
    const s = normalizeElement(
      el(1, { shop: 'supermarket', brand: 'Safeway', name: 'Safeway', 'addr:housenumber': '2020', 'addr:street': '148th Ave NE', 'addr:city': 'Bellevue' }),
    );
    expect(s).toMatchObject({
      id: 'osm:node/1',
      name: 'Safeway 148th Ave NE',
      chain: 'Safeway',
      chainKey: 'safeway',
      estimated: true,
      blurb: '2020 148th Ave NE, Bellevue',
    });
  });

  it('uses the centre of a building drawn as an area', () => {
    const s = normalizeElement({ type: 'way', id: 9, center: { lat: 47.5, lon: -122.1 }, tags: { shop: 'supermarket', name: 'Walmart Supercenter' } });
    expect(s).toMatchObject({ id: 'osm:way/9', lat: 47.5, lon: -122.1, chainKey: 'walmart', name: 'Walmart' });
  });

  it('flags warehouse clubs as membership stores', () => {
    expect(normalizeElement(el(2, { shop: 'wholesale', name: 'Costco Wholesale' }))).toMatchObject({ membership: true, chainKey: 'costco' });
    expect(normalizeElement(el(3, { shop: 'supermarket', name: "BJ's Wholesale Club" }))).toMatchObject({ membership: true });
    expect(normalizeElement(el(4, { shop: 'supermarket', name: 'Aldi' }))?.membership).toBeFalsy();
  });

  it('ignores shops that are not one of our chains, and shops with no location', () => {
    expect(normalizeElement(el(5, { shop: 'supermarket', name: 'Corner Market' }))).toBeNull();
    expect(normalizeElement(el(6, { shop: 'supermarket', name: 'Targeted Deals Outlet' }))).toBeNull();
    expect(normalizeElement({ type: 'node', id: 7, tags: { shop: 'supermarket', name: 'Aldi' } })).toBeNull();
  });

  it('recognises chains by brand even when the name is different', () => {
    expect(normalizeElement(el(8, { shop: 'supermarket', brand: 'H-E-B', name: 'Central Market' }))).toMatchObject({ chainKey: 'heb' });
  });
});

describe('pickNearest', () => {
  it('keeps the closest two of each chain', () => {
    const mk = (id: number, lat: number, chainKey: string) =>
      normalizeElement(el(id, { shop: 'supermarket', name: chainKey === 'aldi' ? 'Aldi' : 'Walmart' }, lat, -122.18))!;
    const stores = [mk(1, 47.9, 'walmart'), mk(2, 47.61, 'walmart'), mk(3, 47.62, 'walmart'), mk(4, 47.8, 'aldi')];
    const kept = pickNearest(stores, home);
    expect(kept.filter((s) => s.chainKey === 'walmart').map((s) => s.id)).toEqual(['osm:node/2', 'osm:node/3']);
    expect(kept.some((s) => s.chainKey === 'aldi')).toBe(true);
  });
});

describe('the Overpass query', () => {
  it('searches around the point, in metres, for shops of our chains', () => {
    const q = buildQuery(home, 10);
    expect(q).toContain('around:16093,47.606,-122.183');
    expect(q).toContain('"brand"~');
    expect(q).toContain('Walmart');
    expect(q).toContain('H-E-B');
    expect(q).toContain("BJ's Wholesale Club");
    expect(q).not.toContain(',i]'); // exact values only: case-insensitive patterns are far slower on Overpass
    expect(q).toContain('[out:json]');
  });
});

describe('GET /api/places', () => {
  it('returns nearby stores of chains without public prices, and lets the CDN cache them', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        elements: [
          el(1, { shop: 'supermarket', name: 'Walmart Supercenter', 'addr:street': 'Bel-Red Rd' }, 47.63, -122.14),
          el(2, { shop: 'supermarket', name: 'Some Local Grocer' }),
          el(3, { shop: 'supermarket', name: 'ALDI', 'addr:city': 'Redmond' }, 47.67, -122.12),
        ],
      }),
    );
    const res = await places(get('/api/places?lat=47.606&lon=-122.183&radius=10'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { places: { name: string; estimated: boolean }[] };
    expect(body.places.map((p) => p.name)).toEqual(['Walmart Bel-Red Rd', 'Aldi Redmond']);
    expect(body.places.every((p) => p.estimated)).toBe(true);
    // OpenStreetMap data is open, unlike Kroger's.
    expect(res.headers.get('cache-control')).toContain('s-maxage');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('overpass');
    expect((init.headers as Record<string, string>)['user-agent']).toMatch(/CartCompass/);
  });

  it('tries the second server when the first is busy', async () => {
    fetchMock.mockResolvedValueOnce(new Response('busy', { status: 429 })).mockResolvedValueOnce(jsonResponse({ elements: [] }));
    const res = await places(get('/api/places?lat=47.6&lon=-122.2'));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).not.toBe(String(fetchMock.mock.calls[1][0]));
  });

  it('fails cleanly when every server is down', async () => {
    fetchMock.mockImplementation(async () => new Response('down', { status: 504 }));
    const res = await places(get('/api/places?lat=47.6&lon=-122.2'));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('down');
  });

  it('remembers answers for a day, so the next visitor nearby is instant', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ elements: [el(1, { shop: 'supermarket', brand: 'Walmart' })] }));
    await places(get('/api/places?lat=47.606&lon=-122.183&radius=10'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A hundred metres away: same cell.
    const res = await places(get('/api/places?lat=47.607&lon=-122.184&radius=10'));
    expect(((await res.json()) as { places: unknown[] }).places).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A different city is a different question.
    await places(get('/api/places?lat=33.75&lon=-84.39&radius=10'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('validates input', async () => {
    for (const q of ['', '?lat=abc&lon=1', '?lat=95&lon=1', '?lat=47&lon=-122&radius=0', '?lat=47&lon=-122&radius=40']) {
      expect((await places(get(`/api/places${q}`))).status, q).toBe(400);
    }
    expect((await places(new Request('http://localhost/api/places?lat=1&lon=1', { method: 'POST' }))).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
