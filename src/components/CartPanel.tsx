import { Minus, Plus, Search, X } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { money } from '../domain/format';
import { searchCatalog } from '../domain/search';
import type { CartLine, Market, Product } from '../domain/types';
import type { Action } from '../state/appState';

const QUICK_ADDS = ['eggs-12', 'milk-whole', 'bread', 'bananas', 'oats', 'coffee'];

function lowestPrice(market: Market | null, productId: string): number | null {
  if (!market) return null;
  const all = Object.values(market.prices)
    .map((byProduct) => byProduct[productId])
    .filter((v): v is number => v !== undefined);
  return all.length ? Math.min(...all) : null;
}

interface Props {
  cart: CartLine[];
  catalog: Product[];
  products: ReadonlyMap<string, Product>;
  market: Market | null;
  unavailableIds: Set<string>;
  dispatch: (a: Action) => void;
}

export function CartPanel({ cart, catalog, products, market, unavailableIds, dispatch }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => searchCatalog(catalog, query), [catalog, query]);
  const inCart = new Set(cart.map((l) => l.productId));

  const add = (p: Product) => {
    dispatch({ type: 'add', productId: p.id });
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const grouped = useMemo(() => {
    const byCat = new Map<string, { line: CartLine; product: Product }[]>();
    for (const line of cart) {
      const product = products.get(line.productId);
      if (!product) continue;
      byCat.set(product.category, [...(byCat.get(product.category) ?? []), { line, product }]);
    }
    return [...byCat.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [cart, products]);

  const count = cart.reduce((n, l) => n + l.qty, 0);

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
        {open && query.trim() !== '' && (
          <ul className="search-results" role="listbox" id={listId}>
            {results.length === 0 && <li className="search-none">{market?.source === 'demo'
                ? `Not in the demo catalog of ${catalog.length} items. Try a simpler word, like “milk”.`
                : 'No match. Try a simpler word, like “milk”.'}</li>}
            {results.map((p, i) => (
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
                <span>
                  {p.name} <span className="muted">{p.size}</span>
                </span>
                <span className="muted small">{inCart.has(p.id) ? 'add another' : p.category}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {cart.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Start your list</p>
          <p className="muted">Add what you need this week. We’ll work out which stores are worth the drive.</p>
          <div className="chips" aria-label="Quick add">
            {QUICK_ADDS.map((id) => {
              const p = products.get(id)!;
              return (
                <button key={id} className="chip" onClick={() => dispatch({ type: 'add', productId: id })}>
                  <Plus size={13} aria-hidden="true" /> {p.name}
                </button>
              );
            })}
          </div>
          <button className="link" onClick={() => dispatch({ type: 'sample' })}>
            Or load a sample list
          </button>
        </div>
      ) : (
        <>
          <div className="cart">
            {grouped.map(([category, rows]) => (
              <div key={category} className="cart-group">
                <h3 className="eyebrow">{category}</h3>
                <ul>
                  {rows.map(({ line, product }) => {
                    const low = lowestPrice(market, product.id);
                    const missing = unavailableIds.has(product.id);
                    return (
                      <li key={product.id} className="cart-row">
                        <div className="cart-name">
                          <span>{product.name}</span>
                          <span className="muted small">
                            {product.size}
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
