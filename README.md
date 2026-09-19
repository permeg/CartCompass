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

Other scripts: `npm test`, `npm run typecheck`, `npm run build`.

### Live product search

`npm run dev:live` also searches a real product catalog when you type in the list. It goes through
a small proxy in `server/` (served by Vite in dev, and as Cloudflare Pages Functions from `functions/` in production),
so API keys never reach the browser.

- With no keys it uses [Open Food Facts](https://world.openfoodfacts.org), limited to US products.
- To use Kroger's catalog instead, copy `.env.example` to `.env.local` and add your Kroger developer
  keys. The Kroger adapter is written from their docs and hasn't been run against the live API yet.
- Products found this way still get **invented prices** until real pricing lands (ROADMAP, step 3).
- Plain `npm run dev` and any static deploy stay demo-only and make no network calls.

## How it works

- `src/domain/optimizer.ts` is a pure function. For every group of up to three nearby stores it buys
  each item where it's cheapest in that group, orders the stops for the shortest loop, then adds gas.
  It returns the cheapest plan, the fastest plan, the nearest single store (the baseline for "you save"),
  and the set of plans in between.
- `src/data/providers.ts` is the seam to the outside world. The app only ever sees a `Market`
  (stores, prices, gas, drive distances). The demo providers read `src/data/seed.ts`.
- `server/` holds the proxy handlers (`server/handlers.ts`), which are plain `(Request, env)` to `Response`
  functions. `functions/` has the thin Cloudflare Pages wrappers, and `vite.config.ts` mounts the same
  handlers in dev.
- `src/components/ChartMap.tsx` draws a schematic chart of the route. Coastlines are simplified and
  roads aren't drawn.

The layout is a three-column workspace on laptops (list, chart, trip) and a four-tab app on phones.

## Deploying (Cloudflare Pages)

- Build command `npm run build`, output directory `dist`. Cloudflare picks up `functions/` automatically.
- Set `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET` as encrypted variables in the Pages project settings.
- `npm run preview:cf` runs the built site and the functions locally under Cloudflare's runtime. Put local
  secrets in a `.dev.vars` file (git ignores it), in the same `KEY=value` format as `.env.example`.
