# Cart Compass — Roadmap & Decisions

## Decisions (agreed before build)

- **Baseline for "you save":** the nearest single store that stocks the whole cart.
- **Max stops per plan:** 3.
- **Net savings:** shown as items + gas = true cost, compared against the baseline's true cost.
- **Modes:** "Lowest price", and "Save time" (fastest plan whose cost is at most the cheapest plus $X, and whose driving fits a max drive time).
- **Layout:** phone (bottom nav) and laptop (three-column workspace: list / chart / trip). Laptop is designed first, since it is the portfolio view.

## Phase 1: done

List, trip plan, mode toggle with extra-cost limit and drive-time limit, chart map, in-store checklist. Runs on **seeded, invented Bellevue demo data** (7 stores, 251 products, gas price, drive distances), all behind provider interfaces in `src/data/providers.ts`.

## Phase 2: real data (the API integration)

Goal: replace the seeded data with real providers, one piece at a time. The demo data stays as a fallback and as the portfolio mode, and the "Demo data" tag stays until every piece below is live.

1. [x] **Serverless proxy.** API keys can't live in the browser. Handlers in `server/`, served by Vite in dev and as Vercel functions in `api/`.
2. [x] **Live catalog search.** Product search from a real catalog (Kroger when keys are set, otherwise Open Food Facts). `CatalogProvider` is async, and cart lines store the product details they were added with. Opt in with `npm run dev:live`.
3. [ ] **Real prices.** Kroger product pricing by store location (QFC and Fred Meyer cover Bellevue). Chains with no public API need a decision: hide them, or label them "estimated".
4. [ ] **Real stores and drive distances.** OpenStreetMap (Overpass + OSRM) or Google Places/Routes. Address and ZIP lookup, browser geolocation, and drawing the real route on the chart instead of curved lines.
5. [ ] **Real gas prices.** EIA regional average, with the user's override kept.

Cross-cutting, do alongside the steps above:

- [ ] Show "updated X ago" on prices once they are live, and keep the "Demo data" tag until step 5 is done.
- [ ] Failure modes real data introduces: missing items, stale prices, rate limits, chains with no data.
- [ ] Store names in the demo are fictional. Real chains need real names, hours, and logos or plain text.
- [ ] Until step 3 lands, products from the live catalog have **invented** prices (from a reference price or a category default). This is why the tag stays.

## Phase 3: features (not started)

- Profile: accent color picker, home store, price-drop alerts, distance unit (see the handoff doc).
- Smart Swap: suggest a cheaper equivalent brand at a stop. Needs real product data from Phase 2.
- Saved lists and sharing.
