import { Check } from 'lucide-react';
import { money, plural } from '../domain/format';
import type { Plan } from '../domain/types';
import type { Action } from '../state/appState';

interface Props {
  plan: Plan | null;
  checked: string[];
  dispatch: (a: Action) => void;
  activeStoreId: string | null;
  onActiveStore: (id: string | null) => void;
}

export function ShoppingList({ plan, checked, dispatch, activeStoreId, onActiveStore }: Props) {
  if (!plan) {
    return (
      <section className="panel-body" aria-labelledby="list-heading">
        <div className="panel-head">
          <h2 id="list-heading">At the store</h2>
        </div>
        <p className="empty-plan">Once you have a trip, each stop’s list shows up here to tick off as you shop.</p>
      </section>
    );
  }

  const keys = plan.stops.flatMap((s) => s.lines.map((l) => `${s.store.id}:${l.product.id}`));
  const done = keys.filter((k) => checked.includes(k)).length;

  return (
    <section className="panel-body" aria-labelledby="list-heading">
      <div className="panel-head">
        <h2 id="list-heading">At the store</h2>
        <span className="num muted">
          {done} of {keys.length}
        </span>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={keys.length} aria-valuenow={done} aria-label="Items picked up">
        <span style={{ width: `${keys.length ? (done / keys.length) * 100 : 0}%` }} />
      </div>

      {plan.stops.map((stop, i) => (
        <div
          key={stop.store.id}
          className={`shop-stop ${activeStoreId === stop.store.id ? 'is-active' : ''}`}
          onMouseEnter={() => onActiveStore(stop.store.id)}
          onMouseLeave={() => onActiveStore(null)}
        >
          <div className="shop-head">
            <span className="stop-num num" aria-hidden="true">
              {i + 1}
            </span>
            <div className="ledger-main">
              <h3>
                {stop.store.name}
                {stop.store.estimated && <span className="est-tag">estimated</span>}
              </h3>
              <span className="muted small">
                {plural(
                  stop.lines.reduce((n, l) => n + l.qty, 0),
                  'item',
                )}
                {stop.store.membership ? ' · membership required' : ''}
                {stop.store.estimated ? ' · prices are estimates' : ''}
              </span>
            </div>
            <span className="num">{stop.store.estimated ? '~' : ''}{money(stop.subtotal)}</span>
          </div>
          <ul>
            {[...stop.lines]
              .sort((a, b) => a.product.category.localeCompare(b.product.category) || a.product.name.localeCompare(b.product.name))
              .map((line) => {
                const key = `${stop.store.id}:${line.product.id}`;
                const on = checked.includes(key);
                return (
                  <li key={key}>
                    <button
                      role="checkbox"
                      aria-checked={on}
                      className={`check-row ${on ? 'is-done' : ''}`}
                      onClick={() => dispatch({ type: 'toggleChecked', key })}
                    >
                      <span className="box" aria-hidden="true">
                        {on && <Check size={12} strokeWidth={3} />}
                      </span>
                      <span className="check-name">
                        {line.qty > 1 && <span className="num">{line.qty} × </span>}
                        {line.product.name} <span className="muted small">{line.product.size}</span>
                      </span>
                      <span className="num muted">{stop.store.estimated ? '~' : ''}{money(line.total)}</span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}

      {done > 0 && (
        <button className="link" onClick={() => dispatch({ type: 'clearChecked' })}>
          Reset checkmarks
        </button>
      )}
    </section>
  );
}
