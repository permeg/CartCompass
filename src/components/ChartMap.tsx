import { useLayoutEffect, useRef, useState } from 'react';
import { miles as fmtMiles } from '../domain/format';
import { placeCentered, placeLabel, type Placed, type Rect } from './labels';
import type { LatLon, Market, Plan, RouteLine } from '../domain/types';

/**
 * A schematic chart of the trip: contour rings, the two lakes, edge ticks and a
 * dashed route. It is drawn in pixel space so labels stay crisp at any size.
 * Coastlines are simplified and roads are not drawn, so it reads as a chart, not
 * a street map.
 */

const LAKE_WASHINGTON: LatLon[] = [
  [47.72, -122.24],
  [47.685, -122.222],
  [47.655, -122.218],
  [47.64, -122.226],
  [47.618, -122.208],
  [47.598, -122.212],
  [47.575, -122.218],
  [47.55, -122.207],
  [47.5, -122.19],
  [47.5, -122.32],
  [47.72, -122.32],
].map(([lat, lon]) => ({ lat, lon }));

const LAKE_SAMMAMISH: LatLon[] = [
  [47.645, -122.097],
  [47.625, -122.087],
  [47.595, -122.092],
  [47.565, -122.086],
  [47.53, -122.098],
  [47.535, -122.108],
  [47.57, -122.108],
  [47.61, -122.102],
  [47.635, -122.108],
].map(([lat, lon]) => ({ lat, lon }));

const HILLS: { at: LatLon; radii: number[] }[] = [
  { at: { lat: 47.578, lon: -122.172 }, radii: [0.35, 0.75, 1.2, 1.7] },
  { at: { lat: 47.632, lon: -122.14 }, radii: [0.3, 0.65, 1.05] },
  { at: { lat: 47.548, lon: -122.132 }, radii: [0.4, 0.85, 1.35] },
];

const MILES_PER_DEG_LAT = 69.05;

interface Props {
  market: Market | null;
  plan: Plan | null;
  origin: LatLon;
  radiusMiles: number;
  includeMembership: boolean;
  activeStoreId: string | null;
  onActiveStore: (id: string | null) => void;
  homeLabel: string;
  /** Road geometry for the plan. When missing, simple curves are drawn instead. */
  routeLine?: RouteLine | null;
  /** Show the routing data credit (required by OpenRouteService and OpenStreetMap). */
  credit?: boolean;
}

export function ChartMap({
  market,
  plan,
  origin,
  radiusMiles,
  includeMembership,
  activeStoreId,
  onActiveStore,
  homeLabel,
  routeLine = null,
  credit = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 520 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.max(el.clientWidth, 280), h: Math.max(el.clientHeight, 260) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const stores = (market?.stores ?? []).filter(
    (s, i) =>
      (market?.miles[0][i + 1] ?? 99) <= radiusMiles && (includeMembership || !s.membership),
  );

  // Fit the origin and every visible store into the frame.
  const pts: LatLon[] = [origin, ...stores];
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const midLat = (minLat + maxLat) / 2;
  const midLon = (minLon + maxLon) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);
  const padX = Math.min(120, w * 0.16);
  const padTop = 56;
  const padBottom = 52;
  const spanX = Math.max((maxLon - minLon) * lonScale, 0.02);
  const spanY = Math.max(maxLat - minLat, 0.02);
  const k = Math.min((w - padX * 2) / spanX, (h - padTop - padBottom) / spanY);
  const project = (p: LatLon) => ({
    x: w / 2 + (p.lon - midLon) * lonScale * k,
    y: padTop + (h - padTop - padBottom) / 2 - (p.lat - midLat) * k,
  });

  const poly = (pts2: LatLon[]) => pts2.map((p) => project(p)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const pxPerMile = k / MILES_PER_DEG_LAT;

  const routeNodes: LatLon[] = plan ? [origin, ...plan.stops.map((s) => s.store), origin] : [];
  const onRouteIds = new Set(plan?.stops.map((s) => s.store.id));

  // Edge ticks every 0.02 degrees, labelled at intervals.
  const tickLons: number[] = [];
  for (let lon = Math.ceil((midLon - w / 2 / (k * lonScale)) / 0.02) * 0.02; project({ lat: midLat, lon }).x < w; lon += 0.02) {
    tickLons.push(lon);
  }
  const tickLats: number[] = [];
  for (let lat = Math.ceil((midLat - h / 2 / k) / 0.02) * 0.02; project({ lat, lon: midLon }).y > 0; lat += 0.02) {
    tickLats.push(lat);
  }

  const home = project(origin);
  // Lay out labels so they don't sit on top of each other or on markers.
  const frame: Rect = { x: 46, y: 30, w: w - 52, h: h - 62 };
  const taken: Rect[] = [
    { x: w - 46 - 30, y: padTop - 42, w: 60, h: 66 },
    { x: 12, y: h - 36, w: pxPerMile + 54, h: 28 },
  ];
  const mark = (p: { x: number; y: number }, r: number) => taken.push({ x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 });
  mark(home, 15);
  const stopPts = (plan?.stops ?? []).map((s) => project(s.store));
  stopPts.forEach((p) => mark(p, 14));
  const others = stores.filter((s) => !onRouteIds.has(s.id));
  others.forEach((s) => mark(project(s), 8));

  const stopLabels = (plan?.stops ?? []).map((s, i) =>
    placeLabel(stopPts[i], s.store.name, 13, 19, ['right', 'left', 'top', 'bottom'], taken, frame),
  );
  const homeText = placeLabel(home, homeLabel, 11, 17, ['bottom', 'top', 'right', 'left'], taken, frame, true);
  const otherLabels = new Map<string, Placed>(
    others.map((s) => [s.id, placeLabel(project(s), s.name, 12, 10, ['right', 'left', 'top', 'bottom'], taken, frame)]),
  );

  // With real road geometry the legs follow the streets. Otherwise they are simple curves.
  const useRoads = !!plan && !!routeLine && routeLine.wayPoints.length === routeNodes.length;

  const legs = plan
    ? routeNodes.slice(0, -1).map((from, i) => {
        const isReturn = i === routeNodes.length - 2;
        const miles = isReturn ? plan.returnMiles : plan.stops[i].legMiles;
        const text = fmtMiles(miles);

        if (useRoads) {
          const slice = routeLine!.coordinates.slice(routeLine!.wayPoints[i], routeLine!.wayPoints[i + 1] + 1).map(project);
          const d = slice.length > 1 ? `M${slice.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')}` : '';
          let label: Placed | null = null;
          for (const t of [0.5, 0.36, 0.64]) {
            const at = slice[Math.min(slice.length - 1, Math.floor(slice.length * t))];
            if (at) label = placeCentered(at, text, 11, taken, frame);
            if (label) break;
          }
          return { d, isReturn, miles, label };
        }

        const a = project(from);
        const b = project(routeNodes[i + 1]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const bow = (isReturn ? -0.16 : 0.1) * (i % 2 === 0 ? 1 : -1);
        const cx = (a.x + b.x) / 2 - dy * bow;
        const cy = (a.y + b.y) / 2 + dx * bow;
        // Try the middle of the leg first, then nearby points along it.
        let label: Placed | null = null;
        for (const t of [0.5, 0.36, 0.64]) {
          const at = {
            x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t * t * b.x,
            y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t * t * b.y,
          };
          label = placeCentered(at, text, 11, taken, frame);
          if (label) break;
        }
        return { d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`, isReturn, miles, label };
      })
    : [];

  const halo = { paintOrder: 'stroke' as const, stroke: 'var(--bg)', strokeWidth: 4, strokeLinejoin: 'round' as const };

  return (
    <div className="chart" ref={ref}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={
          plan
            ? `Route chart: home, then ${plan.stops.map((s) => s.store.name).join(', then ')}, then back home.`
            : 'Route chart showing your home and nearby stores.'
        }
      >
        <polygon points={poly(LAKE_WASHINGTON)} className="chart-water" />
        <polygon points={poly(LAKE_SAMMAMISH)} className="chart-water" />

        <g className="chart-contours">
          {HILLS.flatMap(({ at, radii }) => {
            const c = project(at);
            return radii.map((r) => (
              <ellipse
                key={`${at.lat}-${r}`}
                cx={c.x}
                cy={c.y}
                rx={r * pxPerMile * 1.25}
                ry={r * pxPerMile * 0.85}
                transform={`rotate(-18 ${c.x} ${c.y})`}
              />
            ));
          })}
        </g>

        {/* radius ring around home */}
        <circle cx={home.x} cy={home.y} r={radiusMiles * pxPerMile} className="chart-radius" />

        <g className="chart-ticks">
          {tickLons.map((lon) => {
            const x = project({ lat: midLat, lon }).x;
            return <line key={lon} x1={x} x2={x} y1={0} y2={7} />;
          })}
          {tickLats.map((lat) => {
            const y = project({ lat, lon: midLon }).y;
            return <line key={lat} x1={0} x2={7} y1={y} y2={y} />;
          })}
        </g>
        <g className="chart-coords">
          {tickLons
            .filter((lon, i) => i % 2 === 0 && project({ lat: midLat, lon }).x < w - 110)
            .map((lon) => (
              <text key={lon} x={project({ lat: midLat, lon }).x + 3} y={20}>
                {Math.abs(lon).toFixed(2)}°W
              </text>
            ))}
          {tickLats
            .filter((_, i) => i % 2 === 0)
            .map((lat) => (
              <text key={lat} x={12} y={project({ lat, lon: midLon }).y - 4}>
                {lat.toFixed(2)}°N
              </text>
            ))}
        </g>

        {/* route legs */}
        {plan && (
          <g fill="none" strokeLinecap="round">
            {legs.map((leg, i) => (
              <g key={i}>
                <path d={leg.d} className={leg.isReturn ? 'chart-route chart-route--return' : 'chart-route'} />
                {leg.label && (
                  <text x={leg.label.x} y={leg.label.y} className="chart-leg" textAnchor="middle" style={halo}>
                    {fmtMiles(leg.miles)}
                  </text>
                )}
              </g>
            ))}
          </g>
        )}

        {/* stores that are not on the route */}
        {others.map((s) => {
          const p = project(s);
          const label = otherLabels.get(s.id)!;
          return (
            <g
              key={s.id}
              className={`chart-other ${s.estimated ? 'chart-other--est' : ''} ${activeStoreId === s.id ? 'is-active' : ''}`}
              onMouseEnter={() => onActiveStore(s.id)}
              onMouseLeave={() => onActiveStore(null)}
            >
              <path d={`M${p.x},${p.y - 5.5} l5.5,5.5 l-5.5,5.5 l-5.5,-5.5z`} />
              <text x={label.x} y={label.y} textAnchor={label.anchor} style={halo}>
                {s.name}
              </text>
            </g>
          );
        })}

        {/* home */}
        <g className="chart-home">
          <circle cx={home.x} cy={home.y} r={6} />
          <path d={`M${home.x - 13},${home.y}h26M${home.x},${home.y - 13}v26`} />
          <text x={homeText.x} y={homeText.y} textAnchor={homeText.anchor} style={halo}>
            {homeLabel}
          </text>
        </g>

        {/* numbered stops */}
        {plan?.stops.map((stop, i) => {
          const p = stopPts[i];
          const label = stopLabels[i];
          return (
            <g
              key={stop.store.id}
              className={`chart-stop ${stop.store.estimated ? 'chart-stop--est' : ''} ${activeStoreId === stop.store.id ? 'is-active' : ''}`}
              onMouseEnter={() => onActiveStore(stop.store.id)}
              onMouseLeave={() => onActiveStore(null)}
            >
              <circle cx={p.x} cy={p.y} r={12} />
              <text x={p.x} y={p.y + 4.5} textAnchor="middle" className="chart-stop-num">
                {i + 1}
              </text>
              <text x={label.x} y={label.y} textAnchor={label.anchor} className="chart-stop-name" style={halo}>
                {stop.store.name}
              </text>
            </g>
          );
        })}

        {/* compass rose */}
        <g className="chart-rose" transform={`translate(${w - 46}, ${padTop - 6})`}>
          <circle r={17} />
          <path d="M0,-25V25M-25,0H25" />
          <path d="M0,-17 l4,10 h-8z" className="chart-rose-fill" />
          <text y={-30} textAnchor="middle">
            N
          </text>
        </g>

        {/* scale bar */}
        <g className="chart-scale" transform={`translate(20, ${h - 22})`}>
          <path d={`M0,0H${pxPerMile}M0,-4V4M${pxPerMile / 2},-2.5V2.5M${pxPerMile},-4V4`} />
          <text x={pxPerMile + 8} y={4}>
            1 mi
          </text>
        </g>
      </svg>

      {credit && (
        <p className="chart-credit">
          Routes ©{' '}
          <a href="https://openrouteservice.org" target="_blank" rel="noreferrer">
            openrouteservice.org
          </a>{' '}
          by HeiGIT · Map data ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap
          </a>{' '}
          contributors
        </p>
      )}

      {!plan && (
        <p className="chart-empty">Add items to your list and the route will appear here.</p>
      )}
    </div>
  );
}
