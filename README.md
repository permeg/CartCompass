# Cart Compass

Build a grocery list and Cart Compass works out the cheapest way to shop it: which stores to visit
(up to three), what to buy where, and whether the drive is worth it once gas is counted. Switch to
"Save time" and it finds the quickest trip that costs no more than a limit you set.

**Demo data.** Stores, prices and gas in this version are seeded sample data for Bellevue, WA. They are
invented, and the UI says so. See [ROADMAP.md](ROADMAP.md) for the plan to use real providers.

## Run it

```bash
npm install
npm run dev
```

Other scripts: `npm test` (optimizer tests), `npm run typecheck`, `npm run build`.

## How it works

- `src/domain/optimizer.ts` is a pure function. For every group of up to three nearby stores it buys
  each item where it's cheapest in that group, orders the stops for the shortest loop, then adds gas.
  It returns the cheapest plan, the fastest plan, the nearest single store (the baseline for "you save"),
  and the set of plans in between.
- `src/data/providers.ts` is the seam to the outside world. The app only ever sees a `Market`
  (stores, prices, gas, drive distances). The demo providers read `src/data/seed.ts`.
- `src/components/ChartMap.tsx` draws a schematic chart of the route. Coastlines are simplified and
  roads aren't drawn.

The layout is a three-column workspace on laptops (list, chart, trip) and a four-tab app on phones.
