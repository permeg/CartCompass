import type { GasProvider } from './providers';

/** Current gas prices through our proxy, from the U.S. Energy Information Administration. */
export const liveGas: GasProvider = {
  async getGasPrice(origin) {
    const res = await fetch(`/api/gas?lat=${origin.lat}&lon=${origin.lon}`);
    if (!res.ok) throw new Error(`Gas price failed (${res.status})`);
    const body = (await res.json()) as { cents?: number; period?: string; area?: { name?: string } };
    if (typeof body.cents !== 'number' || !Number.isFinite(body.cents) || body.cents < 100 || body.cents > 2000) {
      throw new Error('Gas price came back in an unexpected shape');
    }
    return {
      cents: Math.round(body.cents),
      info: body.period && body.area?.name ? { area: body.area.name, period: body.period } : undefined,
    };
  },
};
