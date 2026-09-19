# Cart Compass — Roadmap & Decisions

## Decisions (agreed before build)

- **Baseline for "you save":** the nearest single store that stocks the whole cart.
- **Max stops per plan:** 3.
- **Net savings:** shown as items + gas = true cost, compared against the baseline's true cost.
- **Modes:** Cheapest, and Balanced (fastest plan whose cost <= cheapest + $X).
- **Layout:** phone (bottom nav) and laptop (three-column workspace: cart / map / plan). Laptop is designed first, since it is the portfolio view.
- **Phase 1 scope:** cart -> results -> mode toggle -> map -> shopping list.
- **Phase 2:** Profile (accent picker, home store, alerts, distance unit) and Smart Swap.

## TODO after the initial implementation: replace seeded data with real providers

Phase 1 ships with **seeded, hardcoded Bellevue demo data** (about 6-8 stores, about 60 products, gas price, drive distances). This is a stopgap. Once the initial implementation is done:

- [ ] **Do not leave prices hardcoded.** Move all price, store, gas and routing access behind the data-provider interfaces so the seeded dataset is just one implementation.
- [ ] Grocery prices: integrate the Kroger public API (QFC/Fred Meyer cover Bellevue). Use Open Food Facts for product metadata. Other chains have no public API, so decide how to handle them (hide, mark "estimated", or exclude).
- [ ] Store locations, distance and drive time: OpenStreetMap (Overpass + OSRM), or Google Places/Routes if paid is acceptable.
- [ ] Gas price: EIA regional average, with a user override.
- [ ] API keys must not ship in the client. Add a small serverless proxy.
- [ ] UI: keep a visible "demo data" label until real providers are wired, and show "updated X ago" once prices are live.
- [ ] Handle the failure modes real data introduces: missing items, stale prices, rate limits, chains with no data.
- [ ] Map: the chart is schematic (simplified coastlines, curved lines between stops). With live routing, draw the real route geometry.
- [ ] Location: the demo offers six Bellevue neighborhoods. Add address and ZIP lookup (geocoding) and browser geolocation.
- [ ] Store names are fictional. Real chains will need brand names, hours, and logos or plain-text names.
- [ ] **Product catalog:** the demo has 251 hand-written products (`src/data/seed.ts`, `src/data/catalog.ts`), so anything outside that list can't be added. Replace it with live product search (Kroger product API and/or Open Food Facts). That means `CatalogProvider` becomes async (`search(query)`), and cart lines need to store the product details they were added with, since there is no longer a fixed list to look them up in. The stemming and typo-tolerant matching in `src/domain/search.ts` is only for the demo catalog.

## Phase 2 (not started)

- Profile: accent color picker, home store, price-drop alerts, distance unit (see the handoff doc).
- Smart Swap: suggest a cheaper equivalent brand at a stop.
- Saved lists and sharing.
