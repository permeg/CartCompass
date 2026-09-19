import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gas, health } from './handlers';
import { CITY_RADIUS_MILES, eiaRegularGas, gasAreaFor, resetGasCache } from './providers/eia';
import { resetStateCache } from './providers/ors';
import { resetRateLimit } from './rateLimit';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const get = (path: string) => new Request(`http://localhost${path}`, { headers: { 'x-forwarded-for': '203.0.113.7' } });

const EIA_ONLY = { EIA_API_KEY: 'test-eia-key' };
const BOTH = { EIA_API_KEY: 'test-eia-key', ORS_API_KEY: 'test-ors-key' };
const eiaReply = (value: string, period = '2026-09-14') => jsonResponse({ response: { data: [{ period, value }] } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetRateLimit();
  resetGasCache();
  resetStateCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('gasAreaFor', () => {
  const at = (lat: number, lon: number, state: string | null) => gasAreaFor({ lat, lon }, state);

  it('prefers a nearby metro area', () => {
    expect(at(47.61, -122.2, 'WA')).toMatchObject({ id: 'Y48SE', name: 'Seattle', kind: 'city' }); // Bellevue
    expect(at(40.7357, -74.1724, 'NJ')).toMatchObject({ id: 'Y35NY', kind: 'city' }); // Newark is in NYC's orbit
    expect(at(34.0195, -118.4912, 'CA')).toMatchObject({ id: 'Y05LA' }); // Santa Monica
  });

  it('uses the state when EIA publishes one and no metro is near', () => {
    expect(at(47.6588, -117.426, 'WA')).toMatchObject({ id: 'SWA', kind: 'state' }); // Spokane
    expect(at(30.2672, -97.7431, 'TX')).toMatchObject({ id: 'STX' }); // Austin
    expect(at(38.5816, -121.4944, 'CA')).toMatchObject({ id: 'SCA' }); // Sacramento
  });

  it('falls back to the state\'s region', () => {
    expect(at(33.749, -84.388, 'GA')).toMatchObject({ id: 'R1Z', kind: 'region' });
    expect(at(45.5152, -122.6784, 'OR')).toMatchObject({ id: 'R5XCA' });
    expect(at(39.0997, -94.5786, 'MO')).toMatchObject({ id: 'R20' });
    expect(at(35.0844, -106.6504, 'NM')).toMatchObject({ id: 'R30' });
    expect(at(40.7608, -111.891, 'UT')).toMatchObject({ id: 'R40' });
    expect(at(39.9526, -75.1652, 'PA')).toMatchObject({ id: 'R1Y' });
    expect(at(44.4759, -73.2121, 'VT')).toMatchObject({ id: 'R1X' });
  });

  it('uses the national average when the state is unknown or unrecognised', () => {
    expect(at(39.5, -117, null)).toMatchObject({ id: 'NUS', kind: 'national' });
    expect(at(39.5, -117, 'ZZ')).toMatchObject({ id: 'NUS' });
  });

  it('every state maps somewhere', () => {
    const states = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');
    for (const s of states) expect(gasAreaFor({ lat: 39.5, lon: -98 }, s).id, s).not.toBe('NUS');
  });

  it('stops using a metro price once you are well outside it', () => {
    // Olympia, WA is about 60 miles from Seattle.
    expect(CITY_RADIUS_MILES).toBeLessThan(60);
    expect(at(47.0379, -122.9007, 'WA')).toMatchObject({ id: 'SWA' });
  });
});

describe('eiaRegularGas', () => {
  it('reads the latest weekly price, in cents', async () => {
    fetchMock.mockResolvedValueOnce(eiaReply('5.653'));
    const price = await eiaRegularGas({ apiKey: 'test-eia-key' }, 'Y48SE');
    expect(price).toEqual({ cents: 565, period: '2026-09-14' });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('facets[product][]')).toBe('EPMR');
    expect(url.searchParams.get('facets[duoarea][]')).toBe('Y48SE');
    expect(url.searchParams.get('sort[0][direction]')).toBe('desc');
  });

  it('caches for six hours, per area', async () => {
    fetchMock.mockImplementation(async () => eiaReply('4.319'));
    const cfg = { apiKey: 'k' };
    await eiaRegularGas(cfg, 'NUS', undefined, 1_000);
    await eiaRegularGas(cfg, 'NUS', undefined, 1_000 + 5 * 3_600_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await eiaRegularGas(cfg, 'NUS', undefined, 1_000 + 7 * 3_600_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await eiaRegularGas(cfg, 'R30', undefined, 1_000 + 7 * 3_600_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects an empty or nonsense answer', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ response: { data: [] } }));
    await expect(eiaRegularGas({ apiKey: 'k' }, 'NUS')).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(eiaReply('not a number'));
    await expect(eiaRegularGas({ apiKey: 'k' }, 'R30')).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(eiaReply('400'));
    await expect(eiaRegularGas({ apiKey: 'k' }, 'R40')).rejects.toThrow();
  });

  it('never puts the key in an error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad key test-eia-key', { status: 403 }));
    await expect(eiaRegularGas({ apiKey: 'test-eia-key' }, 'NUS')).rejects.not.toThrow(/test-eia-key/);
  });
});

describe('GET /api/gas', () => {
  const stateReply = (region_a: string) => jsonResponse({ features: [{ properties: { region_a } }] });

  it('finds the state, then the most local price', async () => {
    fetchMock.mockResolvedValueOnce(stateReply('WA')).mockResolvedValueOnce(eiaReply('5.653'));
    const res = await gas(get('/api/gas?lat=47.61&lon=-122.2'), BOTH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cents: 565,
      period: '2026-09-14',
      area: { id: 'Y48SE', name: 'Seattle', kind: 'city' },
      source: 'U.S. Energy Information Administration',
    });
    // The ORS key goes in a header, the EIA key in the (server-side) URL.
    const [reverseUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(reverseUrl).not.toContain('test-ors-key');
    expect((init.headers as Record<string, string>).authorization).toBe('test-ors-key');
  });

  it('works without OpenRouteService, using the nearest metro or the national average', async () => {
    fetchMock.mockResolvedValueOnce(eiaReply('4.319'));
    const res = await gas(get('/api/gas?lat=39.5&lon=-98'), EIA_ONLY);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { area: { id: string } }).area.id).toBe('NUS');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('carries on when the state lookup fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 })).mockResolvedValueOnce(eiaReply('4.319'));
    const res = await gas(get('/api/gas?lat=39.5&lon=-98'), BOTH);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { area: { id: string } }).area.id).toBe('NUS');
  });

  it('validates input and setup', async () => {
    expect((await gas(get('/api/gas'), EIA_ONLY)).status).toBe(400);
    expect((await gas(get('/api/gas?lat=abc&lon=1'), EIA_ONLY)).status).toBe(400);
    expect((await gas(get('/api/gas?lat=95&lon=1'), EIA_ONLY)).status).toBe(400);
    expect((await gas(get('/api/gas?lat=47&lon=-122'), {})).status).toBe(501);
    expect((await gas(new Request('http://localhost/api/gas?lat=1&lon=1', { method: 'POST' }), EIA_ONLY)).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides EIA failures, including the key', async () => {
    fetchMock.mockResolvedValueOnce(new Response('forbidden test-eia-key', { status: 403 }));
    const res = await gas(get('/api/gas?lat=39.5&lon=-98'), EIA_ONLY);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('test-eia-key');
  });
});

describe('health', () => {
  it('reports whether gas prices are available', async () => {
    expect(await (await health(get('/api/health'), EIA_ONLY)).json()).toMatchObject({ liveGas: true });
    expect(await (await health(get('/api/health'), {})).json()).toMatchObject({ liveGas: false });
  });
});
