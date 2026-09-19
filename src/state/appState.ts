import { useEffect, useReducer } from 'react';
import { DEFAULT_NEIGHBORHOOD, SAMPLE_CART, findDemoProduct } from '../data/seed';
import type { CartLine, Mode, Product } from '../domain/types';

export interface Settings {
  homeId: string;
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
  cart: CartLine[];
  settings: Settings;
  /** `${storeId}:${productId}` for every ticked shopping-list row. */
  checked: string[];
}

export type Action =
  | { type: 'add'; product: Product }
  | { type: 'setQty'; productId: string; qty: number }
  | { type: 'remove'; productId: string }
  | { type: 'clear' }
  | { type: 'sample' }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'toggleChecked'; key: string }
  | { type: 'clearChecked' };

export const DEFAULT_SETTINGS: Settings = {
  homeId: DEFAULT_NEIGHBORHOOD,
  mode: 'cheapest',
  flex: 300,
  maxDriveMinutes: 30,
  maxStops: 3,
  radiusMiles: 10,
  mpg: 26,
  gasPriceOverride: null,
  includeMembership: false,
};

const STORAGE_KEY = 'cart-compass:v1';

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

function initialState(): AppState {
  const fresh: AppState = { cart: SAMPLE_CART, settings: DEFAULT_SETTINGS, checked: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as Partial<AppState>;
    return {
      cart: Array.isArray(saved.cart) ? migrateCart(saved.cart) : fresh.cart,
      settings: { ...DEFAULT_SETTINGS, ...saved.settings },
      checked: Array.isArray(saved.checked) ? saved.checked : [],
    };
  } catch {
    return fresh;
  }
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'add': {
      const existing = state.cart.find((l) => l.productId === action.product.id);
      const cart = existing
        ? state.cart.map((l) => (l === existing ? { ...l, qty: Math.min(l.qty + 1, 99) } : l))
        : [...state.cart, { productId: action.product.id, qty: 1, product: action.product }];
      return { ...state, cart };
    }
    case 'setQty':
      return {
        ...state,
        cart:
          action.qty <= 0
            ? state.cart.filter((l) => l.productId !== action.productId)
            : state.cart.map((l) =>
                l.productId === action.productId ? { ...l, qty: Math.min(action.qty, 99) } : l,
              ),
      };
    case 'remove':
      return { ...state, cart: state.cart.filter((l) => l.productId !== action.productId) };
    case 'clear':
      return { ...state, cart: [], checked: [] };
    case 'sample':
      return { ...state, cart: SAMPLE_CART, checked: [] };
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
