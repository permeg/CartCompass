import { Minus, Plus, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { LocalCatalog, RemoteCatalog } from '../data/providers';
import { money } from '../domain/format';
import { searchCatalog } from '../domain/search';
import type { CartLine, Market, Product } from '../domain/types';
import type { Action } from '../state/appState';

function lowestPrice(market: Market | null, productId: string): number | null {
  if (!market) return null;
  const all = Object.values(market.prices)
    .map((byProduct) => byProduct[productId])
    .filter((v): v is number => v !== undefined);
  return all.length ? Math.min(...all) : null;
}

type RemoteState = { status: 'idle' | 'loading' | 'error'; products: Product[] };

/** Wait for typing to settle, then ask the remote catalog. Stale requests are cancelled. */
function useRemoteSearch(query: string, remote: RemoteCatalog | null): RemoteState {
  const [state, setState] = useState<RemoteState>({ status: 'idle', products: [] });

  useEffect(() => {
    const q = query.trim();
    if (!remote || q.length < 2) {
      setState({ status: 'idle', products: [] });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ status: 'loading', products: s.products }));
    const timer = setTimeout(async () => {
      try {
        const products = await remote.search(q, controller.signal);
        if (!controller.signal.aborted) setState({ status: 'idle', products });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error', products: [] });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, remote]);

  return state;
}

interface Props {
  cart: CartLine[];
  catalog: { local: LocalCatalog; remote: RemoteCatalog | null };
  sampleCart: CartLine[];
  market: Market | null;
  unavailableIds: Set<string>;
  dispatch: (a: Action) => void;
}

export function CartPanel({ cart, catalog, sampleCart, market, unavailableIds, dispatch }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const local = useMemo(() => searchCatalog(catalog.local.list(), query), [catalog, query]);
  const remote = useRemoteSearch(query, catalog.remote);
  // Anything already shown from the demo list shouldn't be listed twice.
  const remoteOnly = remote.products.filter((p) => !local.some((l) => l.id === p.id));
  const results = [...local, ...remoteOnly];
  const inCart = new Set(cart.map((l) => l.productId));
  const searching = query.trim() !== '';

  const add = (p: Product) => {
    dispatch({ type: 'add', product: p });
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const grouped = useMemo(() => {
    const byCat = new Map<string, CartLine[]>();
    for (const line of cart) byCat.set(line.product.category, [...(byCat.get(line.product.category) ?? []), line]);
    return [...byCat.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [cart]);

  const count = cart.reduce((n, l) => n + l.qty, 0);

  const option = (p: Product, i: number) => (
    <li
      key={p.id}
      id={`${listId}-${i}`}
      role="option"
      aria-selected={i === active}
      className={i === active ? 'is-active' : ''}
      onMouseDown={(e) => {
        e.preventDefault();
        add(p);
      }}
      onMouseEnter={() => setActive(i)}
    >
      <span className="result-name">
        {p.name} <span className="muted">{p.size}</span>
      </span>
      <span className="muted small result-meta">{inCart.has(p.id) ? 'add another' : (p.brand ?? p.category)}</span>
    </li>
  );

  return (
    <section className="panel-body" aria-labelledby="cart-heading">
      <div className="panel-head">
        <h2 id="cart-heading">Your list</h2>
        <span className="num muted">{count === 0 ? 'empty' : `${count} ${count === 1 ? 'item' : 'items'}`}</span>
      </div>

      <div className="search">
        <Search size={16} aria-hidden="true" className="search-icon" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-activedescendant={open && results.length ? `${listId}-${active}` : undefined}
          aria-label="Add an item"
          placeholder="Add an item, like 12 eggs or oats"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && results[active]) {
              e.preventDefault();
              add(results[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {open && searching && (
          <ul className="search-results" role="listbox" id={listId}>
            {local.map((p, i) => option(p, i))}

            {catalog.remote && query.trim().length >= 2 && (
              <>
                <li role="presentation" className="search-divider">
                  {remote.status === 'loading'
                    ? 'Searching the product catalog…'
                    : remote.status === 'error'
                      ? `Couldn’t reach the product catalog. ${local.length > 0 ? 'Showing built-in items only.' : 'Try again in a moment.'}`
                      : remoteOnly.length > 0
                        ? 'More from the product catalog'
                        : local.length > 0
                          ? 'Nothing more in the product catalog'
                          : 'No match in the product catalog either. Try a simpler word.'}
                </li>
                {remoteOnly.map((p, i) => option(p, local.length + i))}
              </>
            )}

            {!catalog.remote && local.length === 0 && catalog.local.list().length > 0 && (
              <li className="search-none" role="presentation">
                Not in the demo catalog of {catalog.local.list().length} items. Try a simpler word, like “milk”.
              </li>
            )}
          </ul>
        )}
      </div>

      {cart.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Start your list</p>
          <p className="muted">Add what you need this week. We’ll work out which stores are worth the drive.</p>
          <div className="chips" aria-label="Quick add">
            {catalog.local.quickAdds().map((p) => (
              <button key={p.id} className="chip" onClick={() => dispatch({ type: 'add', product: p })}>
                <Plus size={13} aria-hidden="true" /> <span className="chip-label" title={p.name}>{p.name}</span>
              </button>
            ))}
          </div>
          <button className="link" onClick={() => dispatch({ type: 'sample', cart: sampleCart })}>
            Or load a sample list
          </button>
        </div>
      ) : (
        <>
          <div className="cart">
            {grouped.map(([category, lines]) => (
              <div key={category} className="cart-group">
                <h3 className="eyebrow">{category}</h3>
                <ul>
                  {lines.map((line) => {
                    const { product } = line;
                    const low = lowestPrice(market, product.id);
                    const missing = unavailableIds.has(product.id);
                    return (
                      <li key={product.id} className="cart-row">
                        <div className="cart-name">
                          <span>{product.name}</span>
                          <span className="muted small">
                            {[product.brand, product.size].filter(Boolean).join(' · ')}
                            {missing ? (
                              <span className="warn"> · not sold at any nearby store</span>
                            ) : (
                              low !== null && <span className="num"> · from {money(low)}</span>
                            )}
                          </span>
                        </div>
                        <div className="stepper" role="group" aria-label={`Quantity of ${product.name}`}>
                          <button
                            aria-label={line.qty === 1 ? `Remove ${product.name}` : `One fewer ${product.name}`}
                            onClick={() => dispatch({ type: 'setQty', productId: product.id, qty: line.qty - 1 })}
                          >
                            {line.qty === 1 ? <X size={14} /> : <Minus size={14} />}
                          </button>
                          <span className="num" aria-live="polite">
                            {line.qty}
                          </span>
                          <button
                            aria-label={`One more ${product.name}`}
                            onClick={() => dispatch({ type: 'setQty', productId: product.id, qty: line.qty + 1 })}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <button className="link" onClick={() => dispatch({ type: 'clear' })}>
            Clear list
          </button>
        </>
      )}
    </section>
  );
}
