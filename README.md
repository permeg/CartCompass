# Cart Compass

Build a grocery list and Cart Compass works out the cheapest way to shop it: which stores to visit
(up to three), what to buy where, and whether the drive is worth it once gas is counted. Switch to
"Save time" and it finds the quickest trip that costs no more than a limit you set.

**Data.** Live mode uses real Kroger-family prices. Demo mode uses invented Bellevue stores and prices,
and the UI labels which one you're looking at. See [ROADMAP.md](ROADMAP.md) for what's real so far.

## Run it

```bash
npm install
npm run dev
```

Other scripts: `npm test`, `npm run typecheck`, `npm run build`.

### Live data

When the server has Kroger API keys, the app defaults to **live mode**: real QFC and Fred Meyer stores
near you, real shelf prices, and product search from Kroger's catalog. A Live/Demo switch in the header
flips to invented demo data, which keeps its own list. With no keys (or on a static host) the app runs
in demo mode only.

- Copy `.env.example` to `.env.local` (git ignores it) and add `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET`.
  Never put secrets in `.env.live`: that file is committed.
- Keys stay on the server. The browser only talks to `/api/*`: `catalog/search`, `stores`, `prices`, `health`.
- Drive times and gas prices are still estimates (ROADMAP steps 4 and 5).
- With no Kroger keys, `npm run dev:live` gives demo mode a real product search from Open Food Facts.

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
