import type { Store } from '../domain/types';
import type { PlaceProvider } from './providers';

/** Stores of chains that don't publish prices (Walmart, Aldi, Target...), found in OpenStreetMap through our proxy. */
export const livePlaces: PlaceProvider = {
  async placesNear(origin, radiusMiles) {
    // Round to about half a mile so nearby visitors share a cached answer.
    const url = `/api/places?lat=${origin.lat.toFixed(2)}&lon=${origin.lon.toFixed(2)}&radius=${Math.min(Math.max(Math.round(radiusMiles), 1), 15)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Other stores failed (${res.status})`);
    const body = (await res.json()) as { places?: Store[] };
    return (body.places ?? []).filter(
      (s) => typeof s.id === 'string' && Number.isFinite(s.lat) && Number.isFinite(s.lon) && typeof s.chainKey === 'string',
    ).map((s) => ({ ...s, estimated: true }));
  },
};
