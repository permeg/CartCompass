/** All money is integer cents. Distances are miles, durations are minutes. */

export interface LatLon {
  lat: number;
  lon: number;
}

export type Category =
  | 'Dairy & eggs'
  | 'Produce'
  | 'Meat & seafood'
  | 'Bakery'
  | 'Pantry'
  | 'Frozen'
  | 'Beverages'
  | 'Household';

export interface Product {
  id: string;
  name: string;
  size: string;
  category: Category;
  /** Extra search terms, e.g. "12 eggs" for a dozen eggs. */
  aliases?: string[];
  brand?: string;
  imageUrl?: string;
  /** Barcode, when the catalog knows it. Real price providers look products up by this. */
  upc?: string;
  /** A typical shelf price in cents, when the catalog knows one. */
  referencePrice?: number;
  /** Where this product came from. Missing means the built-in demo catalog. */
  source?: 'demo' | 'kroger' | 'openfoodfacts';
}

export interface Store extends LatLon {
  id: string;
  name: string;
  blurb: string;
  /** Retail chain, e.g. "QFC". Missing for the invented demo stores. */
  chain?: string;
  /** Prices only apply to members. Excluded unless the user opts in. */
  membership?: boolean;
}

export interface CartLine {
  productId: string;
  qty: number;
  /** A snapshot of the product as it was added, so the list survives without the catalog. */
  product: Product;
}

/** Somewhere the user can start a trip from: a typed address, their location, or a preset area. */
export interface Place extends LatLon {
  label: string;
  /** Set for preset areas, so the demo can tell them apart from typed addresses. */
  id?: string;
}

export interface Neighborhood extends Place {
  id: string;
  zip: string;
}

/** A road route through several waypoints, split into legs by `wayPoints`. */
export interface RouteLine {
  coordinates: LatLon[];
  /** Index in `coordinates` of each waypoint that was asked for. */
  wayPoints: number[];
  miles: number;
  minutes: number;
}

/**
 * Everything the optimizer needs to know about the world, gathered once by the
 * data providers. The optimizer never fetches anything itself.
 */
export interface Market {
  origin: LatLon;
  stores: Store[];
  /** storeId -> productId -> cents. A missing product means "not stocked". */
  prices: Record<string, Record<string, number>>;
  /** Cents per gallon. */
  gasPrice: number;
  /** Where the gas price came from, when it is a real average. */
  gasInfo?: { area: string; period: string };
  /** Driving miles, index 0 is the origin and 1..n follow `stores` order. */
  miles: number[][];
  /** Driving minutes, same indexing as `miles`. */
  minutes: number[][];
  /** The product ids these prices were fetched for. */
  requested: ReadonlySet<string>;
  /** Which parts of this market are real. Anything 'demo' is invented or estimated. */
  sources: DataSources;
  /** ISO timestamp of the price snapshot, if known. */
  pricesAsOf: string | null;
}

export type DataSource = 'demo' | 'live';

export interface DataSources {
  stores: DataSource;
  prices: DataSource;
  /** Drive distances and times. */
  routing: DataSource;
  gas: DataSource;
}

export interface PlanOptions {
  maxStops: 1 | 2 | 3;
  radiusMiles: number;
  mpg: number;
  /** Overrides `Market.gasPrice` when set. Cents per gallon. */
  gasPriceOverride: number | null;
  includeMembership: boolean;
}

export interface PlanLine {
  product: Product;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface PlanStop {
  store: Store;
  lines: PlanLine[];
  subtotal: number;
  /** Miles driven to reach this stop from the previous point. */
  legMiles: number;
  legMinutes: number;
}

export interface Plan {
  /** Stable key from the ordered store ids. */
  id: string;
  stops: PlanStop[];
  itemsTotal: number;
  gasCost: number;
  /** items + gas */
  total: number;
  totalMiles: number;
  /** Miles from the last stop back to the origin. */
  returnMiles: number;
  returnMinutes: number;
  driveMinutes: number;
  shopMinutes: number;
  totalMinutes: number;
}

export interface PlanSet {
  cheapest: Plan | null;
  fastest: Plan | null;
  /** Nearest single store that stocks the whole cart. Null if none does. */
  baseline: Plan | null;
  /** Non-dominated plans, cheapest first (so also slowest first). */
  frontier: Plan[];
  /** Cart items no eligible store stocks. */
  unavailable: Product[];
  /** How many stores were considered. */
  storesConsidered: number;
  /** Every feasible plan, before any drive-time limit. */
  all: Plan[];
  /** Set when a drive-time limit has been applied. */
  driveLimit?: {
    minutes: number;
    /** No plan fits, so the least-driving plan is shown instead. */
    overLimit: boolean;
    /** The most stops any allowed plan has. */
    maxStops: number;
  };
}

export type Mode = 'cheapest' | 'time';
