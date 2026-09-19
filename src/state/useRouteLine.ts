import { useEffect, useState } from 'react';
import type { Providers } from '../data/providers';
import type { LatLon, Plan, RouteLine } from '../domain/types';

/**
 * The road line for the plan being shown, when the routing provider can draw one.
 * Until it arrives (or if it fails) the chart draws simple curves instead.
 */
export function useRouteLine(providers: Providers, plan: Plan | null, origin: LatLon): RouteLine | null {
  const key = plan ? `${plan.id}|${origin.lat},${origin.lon}` : null;
  const [state, setState] = useState<{ key: string; line: RouteLine | null } | null>(null);

  useEffect(() => {
    const routeLine = providers.routing.routeLine;
    if (!key || !plan || !routeLine) {
      setState(null);
      return;
    }
    const controller = new AbortController();
    const points: LatLon[] = [origin, ...plan.stops.map((s) => s.store), origin];
    // Wait a beat so dragging a slider doesn't fire a request per step.
    const timer = setTimeout(() => {
      routeLine
        .call(providers.routing, points, controller.signal)
        .then((line) => {
          if (!controller.signal.aborted) setState({ key, line });
        })
        .catch(() => {
          if (!controller.signal.aborted) setState({ key, line: null });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `plan` and `origin` are covered by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, providers]);

  return state?.key === key ? state.line : null;
}
