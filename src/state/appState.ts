import { useEffect, useReducer } from 'react';
import { LIVE_SAMPLE_CART } from '../data/liveSample';
import type { DataMode } from '../data/providers';
import { DEFAULT_NEIGHBORHOOD, NEIGHBORHOODS, SAMPLE_CART, findDemoProduct } from '../data/seed';
import type { CartLine, Mode, Place, Product } from '../domain/types';

export interface Settings {
  /** Where live trips start: any address, or a preset area. */
  home: Place;
  /** The Bellevue area demo trips start from (the demo's stores are all around Bellevue). */
  demoHomeId: string;
  mode: Mode;
  /** Extra cents the user will pay to save time (only used in "time" mode). */
  flex: number;
  /** Most round-trip driving minutes the user will accept (only used in "time" mode). */
  maxDriveMinutes: number;
  maxStops: 1 | 2 | 3;
  radiusMiles: number;
  mpg: number;
  /** Cents per gallon. Null means "use the market's price". */
  gasPriceOverride: number | null;
  includeMembership: boolean;
}

export interface AppState {
  /**
   * Live and demo data use different products (only live ones have barcodes a
   * store can price), so each keeps its own list.
   */
  carts: Record<DataMode, CartLine[]>;
  /** Which list is being shown right now. */
  mode: DataMode;
  /** What the user picked. `mode` follows it whenever live data is available. */
  preferred: DataMode;
  settings: Settings;
  /** `${storeId}:${productId}` for every ticked shopping-list row. */
  checked: string[];
}

export type Action =
  | { type: 'add'; product: Product }
  | { type: 'setQty'; productId: string; qty: number }
  | { type: 'remove'; productId: string }
  | { type: 'clear' }
  | { type: 'sample'; cart: CartLine[] }
  /** The user chose live or demo. */
  | { type: 'choose'; mode: DataMode }
  /** Live data isn't available here, so fall back without forgetting the choice. */
  | { type: 'activate'; mode: DataMode }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'toggleChecked'; key: string }
  | { type: 'clearChecked' };

const DEFAULT_PLACE: Place =
  NEIGHBORHOODS.find((n) => n.id === DEFAULT_NEIGHBORHOOD) ?? NEIGHBORHOODS[0];

export const DEFAULT_SETTINGS: Settings = {
  home: DEFAULT_PLACE,
  demoHomeId: DEFAULT_NEIGHBORHOOD,
  mode: 'cheapest',
  flex: 300,
  maxDriveMinutes: 30,
  maxStops: 3,
  radiusMiles: 10,
  mpg: 26,
  gasPriceOverride: null,
  includeMembership: false,
};

/** Settings saved before addresses existed only had a `homeId`. */
function mergeSettings(saved: (Partial<Settings> & { homeId?: string }) | undefined): Settings {
  const { homeId, ...rest } = saved ?? {};
  const legacy = homeId ? NEIGHBORHOODS.find((n) => n.id === homeId) : undefined;
  const merged: Settings = { ...DEFAULT_SETTINGS, ...rest };
  if (legacy && !saved?.home) {
    merged.home = legacy;
    merged.demoHomeId = legacy.id;
  }
  const h = merged.home;
  if (!h || !Number.isFinite(h.lat) || !Number.isFinite(h.lon) || typeof h.label !== 'string') merged.home = DEFAULT_PLACE;
  if (!NEIGHBORHOODS.some((n) => n.id === merged.demoHomeId)) merged.demoHomeId = DEFAULT_NEIGHBORHOOD;
  return merged;
}

const STORAGE_KEY = 'cart-compass:v2';
const LEGACY_KEY = 'cart-compass:v1';

/**
 * Lists saved before cart lines carried their own product only have an id. Look
 * those up in the demo catalog, and drop any that can't be found.
 */
function migrateCart(lines: Partial<CartLine>[]): CartLine[] {
  return lines.flatMap((l) => {
    const product = l.product ?? (l.productId ? findDemoProduct(l.productId) : undefined);
    if (!product || typeof l.qty !== 'number') return [];
    return [{ productId: product.id, qty: l.qty, product }];
  });
}

function fresh(): AppState {
  return {
    carts: { live: LIVE_SAMPLE_CART, demo: SAMPLE_CART },
    mode: 'live',
    preferred: 'live',
    settings: DEFAULT_SETTINGS,
    checked: [],
  };
}

function initialState(): AppState {
  const base = fresh();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppState>;
      const pick = (m: DataMode) => (Array.isArray(saved.carts?.[m]) ? migrateCart(saved.carts![m]) : base.carts[m]);
      const preferred = saved.preferred === 'demo' ? 'demo' : 'live';
      return {
        carts: { live: pick('live'), demo: pick('demo') },
        mode: preferred,
        preferred,
        settings: mergeSettings(saved.settings),
        checked: Array.isArray(saved.checked) ? saved.checked : [],
      };
    }
    // Lists from before live data existed become the demo list.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const old = JSON.parse(legacy) as { cart?: Partial<CartLine>[]; settings?: Partial<Settings>; checked?: string[] };
      return {
        ...base,
        carts: { live: base.carts.live, demo: Array.isArray(old.cart) ? migrateCart(old.cart) : base.carts.demo },
        settings: mergeSettings(old.settings),
        checked: Array.isArray(old.checked) ? old.checked : [],
      };
    }
  } catch {
    /* unreadable saved state: start fresh */
  }
  return base;
}

function reducer(state: AppState, action: Action): AppState {
  const cart = state.carts[state.mode];
  const withCart = (next: CartLine[]): AppState => ({ ...state, carts: { ...state.carts, [state.mode]: next } });

  switch (action.type) {
    case 'add': {
      const existing = cart.find((l) => l.productId === action.product.id);
      return withCart(
        existing
          ? cart.map((l) => (l === existing ? { ...l, qty: Math.min(l.qty + 1, 99) } : l))
          : [...cart, { productId: action.product.id, qty: 1, product: action.product }],
      );
    }
    case 'setQty':
      return withCart(
        action.qty <= 0
          ? cart.filter((l) => l.productId !== action.productId)
          : cart.map((l) => (l.productId === action.productId ? { ...l, qty: Math.min(action.qty, 99) } : l)),
      );
    case 'remove':
      return withCart(cart.filter((l) => l.productId !== action.productId));
    case 'clear':
      return { ...withCart([]), checked: [] };
    case 'sample':
      return { ...withCart(action.cart), checked: [] };
    case 'choose':
      return { ...state, mode: action.mode, preferred: action.mode, checked: [] };
    case 'activate':
      return state.mode === action.mode ? state : { ...state, mode: action.mode, checked: [] };
    case 'settings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'toggleChecked':
      return {
        ...state,
        checked: state.checked.includes(action.key)
          ? state.checked.filter((k) => k !== action.key)
          : [...state.checked, action.key],
      };
    case 'clearChecked':
      return { ...state, checked: [] };
  }
}

export function useAppState() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage can be blocked or full; the app still works without it */
    }
  }, [state]);
  return [state, dispatch] as const;
}
