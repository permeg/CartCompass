import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { geocode, health, matrix, route } from './handlers';
import { resetRateLimit } from './rateLimit';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ENV = { ORS_API_KEY: 'test-ors-key' };
const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.7', 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const get = (path: string) => new Request(`http://localhost${path}`, { headers: { 'x-forwarded-for': '203.0.113.7' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetRateLimit();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const home = { lat: 47.606, lon: -122.183 };
const store = { lat: 47.6288, lon: -122.1446 };

describe('GET /api/geocode', () => {
  const feature = (label: string, lon: number, lat: number, layer = 'address') => ({
    geometry: { coordinates: [lon, lat] },
    properties: { label, layer },
  });

  it('returns suggestions, dropping repeats', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        features: [
          feature('1 Bellevue Way NE, Bellevue, WA, USA', -122.2017, 47.6104),
          feature('1 Bellevue Way NE, Bellevue, WA, USA', -122.2017, 47.6104),
          feature('98004, Bellevue, WA, USA', -122.2, 47.61, 'postalcode'),
          { properties: { label: 'no geometry' } },
        ],
      }),
    );
    const res = await geocode(get('/api/geocode?q=1%20Bellevue%20Way&lat=47.6&lon=-122.2'), ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { label: string; lat: number; lon: number; kind: string }[] };
    expect(body.results).toEqual([
      { label: '1 Bellevue Way NE, Bellevue, WA, USA', lat: 47.6104, lon: -122.2017, kind: 'address' },
      { label: '98004, Bellevue, WA, USA', lat: 47.61, lon: -122.2, kind: 'postalcode' },
    ]);
    // Typed addresses are personal, so nothing may hold on to them.
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps the API key out of the URL, and limits results to the US', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ features: [] }));
    await geocode(get('/api/geocode?q=98004&lat=47.6&lon=-122.2'), ENV);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('test-ors-key');
    expect((init.headers as Record<string, string>).authorization).toBe('test-ors-key');
    expect(url).toContain('boundary.country=US');
    expect(url).toContain('focus.point.lat=47.6');
  });

  it('validates the query and the server setup', async () => {
    expect((await geocode(get('/api/geocode?q=ab'), ENV)).status).toBe(400);
    expect((await geocode(get(`/api/geocode?q=${'x'.repeat(121)}`), ENV)).status).toBe(400);
    expect((await geocode(get('/api/geocode?q=98004'), {})).status).toBe(501);
    expect((await geocode(post('/api/geocode', {}), ENV)).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a used-up quota as busy, not broken', async () => {
    fetchMock.mockResolvedValueOnce(new Response('quota', { status: 429 }));
    const res = await geocode(get('/api/geocode?q=98004'), ENV);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('busy');
  });

  it('hides other upstream failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('internal details test-ors-key', { status: 500 }));
    const res = await geocode(get('/api/geocode?q=98004'), ENV);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('test-ors-key');
  });

  it('rate limits per client', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ features: [] }));
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await geocode(get(`/api/geocode?q=street${i}`), ENV)).status;
    expect(last).toBe(429);
  });
});

describe('POST /api/matrix', () => {
  it('returns miles and minutes, converting seconds', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        distances: [
          [0, 2.1],
          [2.1, 0],
        ],
        durations: [
          [0, 510],
          [522, 0],
        ],
      }),
    );
    const res = await matrix(post('/api/matrix', { points: [home, store] }), ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      miles: [
        [0, 2.1],
        [2.1, 0],
      ],
      minutes: [
        [0, 8.5],
        [8.7, 0],
      ],
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent.locations).toEqual([
      [-122.183, 47.606],
      [-122.1446, 47.6288],
    ]); // ORS wants [lon, lat]
    expect(sent.units).toBe('mi');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('estimates pairs the router cannot connect', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        distances: [
          [0, null],
          [null, 0],
        ],
        durations: [
          [0, null],
          [null, 0],
        ],
      }),
    );
    const res = await matrix(post('/api/matrix', { points: [home, store] }), ENV);
    const body = (await res.json()) as { miles: number[][]; minutes: number[][] };
    expect(body.miles[0][1]).toBeGreaterThan(1);
    expect(body.minutes[0][1]).toBeGreaterThan(1);
    expect(Number.isFinite(body.miles[1][0])).toBe(true);
  });

  it('validates the body', async () => {
    const bad: unknown[] = [
      'not json',
      {},
      { points: [home] },
      { points: Array.from({ length: 31 }, () => home) },
      { points: [home, { lat: 'x', lon: 1 }] },
      { points: [home, { lat: 95, lon: 1 }] },
      { points: [home, { lat: 1 }] },
      { points: [home, ...Array.from({ length: 300 }, () => ({ lat: 47.123456789, lon: -122.123456789 }))] },
    ];
    for (const body of bad) expect((await matrix(post('/api/matrix', body), ENV)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    expect((await matrix(get('/api/matrix'), ENV)).status).toBe(405);
    expect((await matrix(post('/api/matrix', { points: [home, store] }), {})).status).toBe(501);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/route', () => {
  const line = {
    features: [
      {
        geometry: {
          coordinates: [
            [-122.183, 47.606],
            [-122.17, 47.615],
            [-122.1446, 47.6288],
            [-122.183, 47.606],
          ],
        },
        properties: { way_points: [0, 2, 3], summary: { distance: 6.2, duration: 900 } },
      },
    ],
  };

  it('returns the road line with its waypoint indexes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(line, 200));
    const res = await route(post('/api/route', { points: [home, store, home] }), ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { route: { coordinates: { lat: number; lon: number }[]; wayPoints: number[]; miles: number; minutes: number } };
    expect(body.route.wayPoints).toEqual([0, 2, 3]);
    expect(body.route.coordinates[1]).toEqual({ lat: 47.615, lon: -122.17 });
    expect(body.route.miles).toBe(6.2);
    expect(body.route.minutes).toBe(15);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v2/directions/driving-car/geojson');
    expect((init.headers as Record<string, string>).accept).toContain('geo+json'); // plain json is refused
  });

  it('returns no route when the waypoints do not line up', async () => {
    const broken = JSON.parse(JSON.stringify(line));
    broken.features[0].properties.way_points = [0, 3];
    fetchMock.mockResolvedValueOnce(jsonResponse(broken));
    const res = await route(post('/api/route', { points: [home, store, home] }), ENV);
    expect(((await res.json()) as { route: unknown }).route).toBeNull();
  });

  it('validates the body', async () => {
    expect((await route(post('/api/route', { points: [home] }), ENV)).status).toBe(400);
    expect((await route(post('/api/route', { points: Array.from({ length: 7 }, () => home) }), ENV)).status).toBe(400);
    expect((await route(get('/api/route'), ENV)).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('health', () => {
  it('reports routing separately from prices', async () => {
    const withKey = await (await health(get('/api/health'), ENV)).json();
    const without = await (await health(get('/api/health'), {})).json();
    expect(withKey).toMatchObject({ liveRouting: true, livePrices: false });
    expect(without).toMatchObject({ liveRouting: false });
    expect(JSON.stringify(withKey)).not.toContain('test-ors-key');
  });
});
