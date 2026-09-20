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

1. [x] **Serverless proxy.** API keys can't live in the browser. Handlers in `server/`, served by Vite in dev and as Cloudflare Pages Functions in `functions/`.
2. [x] **Live catalog search.** Product search from a real catalog (Kroger when keys are set, otherwise Open Food Facts). `CatalogProvider` is async, and cart lines store the product details they were added with. Live search is on whenever live mode is on.
3. [x] **Real prices and real stores.** Kroger's Locations and Products APIs through the proxy (`/api/stores`, `/api/prices`). Live mode is the default whenever the server has Kroger keys, with a Live/Demo switch in the header. Each mode keeps its own list. Only Kroger-family stores (QFC, Fred Meyer) have public prices, so other chains aren't included.
4. [x] **Drive distances, addresses and route line.** OpenRouteService through the proxy: `/api/geocode` (any US address or ZIP, plus browser location), `/api/matrix` (real driving distances and times, no live traffic), `/api/route` (the road line drawn on the chart). If drive times fail, the app falls back to estimates and the badge says so. The required OpenRouteService and OpenStreetMap credit is shown on the chart.
5. [x] **Real gas prices.** EIA weekly retail price of regular gas through `/api/gas`. It uses the most local series EIA publishes: a nearby metro area (10 cities), else the state (9 states), else the state's region, else the national average. The user's own price override is kept. With all five steps done the badge reads "Live data".

Cross-cutting, do alongside the steps above:

- [ ] Show "updated X ago" on prices once they are live, and keep the "Demo data" tag until step 5 is done.
- [ ] Failure modes real data introduces: missing items, stale prices, rate limits, chains with no data.
- [ ] Store names in the demo are fictional. Real chains need real names, hours, and logos or plain text.
- [x] Live-mode prices are real. Demo mode still uses invented prices, and the badge says which one you're looking at ("Live data" when all five sources are real, otherwise "Live prices" with the estimated parts listed).
- [ ] Real prices only exist for Kroger-family stores, and every QFC shares one price list, so live trips are mostly "QFC or Fred Meyer". A second price source would make multi-store trips more interesting. No legitimate public API exists for the other big chains.
- [ ] **Kroger terms (checked Sept 2026, not legal advice).** What's clear: Kroger content may not be scraped, put in databases or kept as permanent copies, and may only be cached as long as the API's cache header allows. Kroger's API sends *no* cache header, so everything Kroger-derived is served `no-store` (CDN, browser and the in-page search cache). Required: display any attribution the API docs ask for, don't misrepresent the source, and don't imply Kroger endorses the app (the footnote says it isn't affiliated). What's unclear: the terms also bar "publicly displaying" API content to third parties "unless expressly permitted", and the API Acceptable Use and Branding Guidelines pages (which may grant that permission and set attribution rules) couldn't be read automatically. **Owner to read both pages, and ask Kroger developer support for written confirmation before promoting the site.** Also review: saved lists keep product names locally in the browser, and the live starter list in `src/data/liveSample.ts` is a snapshot of product names and barcodes (no prices).
- [ ] Kroger's public rate limits: Products 10,000 calls a day, Locations 1,600 a day. With no caching, heavy traffic will hit these. The app shows a "busy" message and Demo mode still works.

## Beyond Kroger: prices for other stores (research, Sept 2026)

**Where real prices already reach.** Kroger's family (QFC, Fred Meyer, Ralphs, King Soopers, Fry's, Smith's, Harris Teeter, Mariano's, Pick 'n Save, Kroger, and more) returned stores in 30 of 40 large metros checked, with a solid presence (10+ stores within 15 miles) in 26 of them: Seattle, Portland, Los Angeles, San Diego, Phoenix, Las Vegas, Salt Lake City, Denver, Albuquerque, Dallas, Houston, Chicago, Milwaukee, Indianapolis, Cincinnati, Columbus, Detroit, Nashville, Atlanta, Charlotte, Richmond, Washington DC, Louisville, Little Rock, Jackson and Omaha. Thin: San Francisco, Sacramento, Philadelphia, Boise, Anchorage. None: New York, Boston, Miami, Orlando, Pittsburgh, Kansas City, Minneapolis, Austin, Honolulu.

**Store locations for any chain: solved.** OpenStreetMap (Overpass API, free, brand-tagged) finds Safeway, Walmart, Trader Joe's, Publix, Whole Foods, Lidl, Aldi, Save-A-Lot and more anywhere in the US. It would need a small proxy endpoint, server-side caching (its licence allows it) and an OSM credit.

**Real prices for other chains: no legitimate source.**

| Option | Verdict |
|---|---|
| Walmart | No public price API. Partner and supplier programs only. |
| Instacart Developer Platform | Public API returns a shopping link, not price data. |
| Safeway/Albertsons, Target, Aldi, Costco, Publix, H-E-B | No public APIs found. |
| Paid data vendors and scraping services (Datarade, Actowiz, Apify, SerpApi) | Exist, but they scrape retailer sites against those sites' terms, and cost money. Not recommended for a public portfolio. |
| Open Prices (Open Food Facts) | Crowdsourced, free, but only about 38,000 US-dollar prices worldwide, mostly snacks. Too thin to price a grocery list. |
| BLS / USDA average prices | Official and free, but national or regional averages for about 70 items, not store level. |

**The one workable option: clearly labelled estimates.** Consumer Reports' 2025 basket study (six metros) gives each chain's price level against Walmart: Costco -21%, BJ's -21%, Lidl -8.5%, Aldi -8.3%, WinCo -3.3%, H-E-B about even, Target +5.9%, Safeway +8.8%, Kroger +14.8%, Whole Foods +39.7%. Dividing by Kroger's level gives a factor per chain (Walmart about 0.87, Aldi about 0.80, Costco about 0.69, Target about 0.92, Safeway about 0.95, Whole Foods about 1.22). Applied to a real Kroger price for the same product, that gives an *estimated* price at another chain. Caveats: these are basket averages from six metros, not per-item prices, so estimates flatten every item to the same discount, and they'd always favor the cheaper chains. Anything built on them must be shown as approximate ("about $X"), be switchable off, and never presented as a real price. (It was built on by default, at the owner's request, with the labelling described below.) Where no Kroger store exists (New York, Boston, Miami and others) there is no real anchor price, so estimates would be weaker there.

**Built (Sept 2026): estimated prices for other chains, on by default.** `/api/places` finds Walmart, Target, Aldi, Lidl, Costco, BJ's, Safeway, Whole Foods, WinCo and H-E-B stores from OpenStreetMap (nearest two per chain, cached for a day). Each estimated price is a real price for the same item at the nearest Kroger-family store, scaled by the chain's price level (`src/domain/chains.ts`, `src/domain/estimate.ts`), rounded to 5 cents. Aldi and Lidl are only estimated for store-brand and fresh items, and warehouse clubs need "membership stores" switched on. Estimated stops are marked everywhere (an "estimated" chip, "~" on amounts, dashed markers on the chart, "prices are estimates" in the shopping list), the headline reads "You could save about ~$X", and the trip list always includes "Best with real prices" beside the recommendation. It can be switched off in Trip settings. The plan built from real prices shows first; other stores join when found, because the public Overpass servers can take 15 to 40 seconds.

Known limits and follow-ups:

- [ ] **No Kroger store nearby means no estimates** (New York, Boston, Miami, Kansas City, Minneapolis, Austin, Honolulu). Estimates need a real price to scale from. Next step: use a real price from the nearest Kroger-family store anywhere within 100 miles as a labelled "reference price", accepting that regional price levels differ.
- [ ] **Overpass is slow and shared.** Replace it with a static dataset of these chains' US stores (from an OpenStreetMap extract) served from the site, or a self-hosted Overpass.
- [ ] **Every estimate is one flat discount per chain**, so estimated stores will often beat real ones, and multi-store trips with estimated stores are rare. That comes from using a basket-level price study, not per-item data.
- [ ] **Kroger's terms** bar "derivative works" of Kroger data as well as public display. Estimates are derived from Kroger prices, so include them in the question to Kroger support.
- [ ] Price levels come from one study of six metros. Revisit when Consumer Reports publishes a newer one.

**Other long-term routes.** Let users contribute prices they see (slow to bootstrap). Apply for Kroger's partner program if the app ever needs more.

## Deployment target

Cloudflare Pages at `cartcompass.permeg.com` (the portfolio's domain is already on Cloudflare). The static site and the functions ship together from the GitHub repo. Live data is the default when server keys are configured, with the demo data available from a switch in the app.

## Phase 3: features (not started)

- Profile: accent color picker, home store, price-drop alerts, distance unit (see the handoff doc).
- Smart Swap: suggest a cheaper equivalent brand at a stop. Needs real product data from Phase 2.
- Saved lists and sharing.
