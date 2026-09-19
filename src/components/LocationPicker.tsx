import { LocateFixed, MapPin, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { searchAddresses, type AddressResult } from '../data/orsClient';
import { NEIGHBORHOODS } from '../data/seed';
import type { Place } from '../domain/types';

interface Props {
  /** Where trips start right now. */
  place: Place;
  /** Live mode with address search available. Otherwise only the preset areas are offered. */
  canSearchAddresses: boolean;
  onSelect: (place: Place) => void;
}

type Search =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; results: AddressResult[] };

/** Wait for typing to settle, then look the address up. Stale requests are cancelled. */
function useAddressSearch(query: string, near: Place, enabled: boolean): Search {
  const [state, setState] = useState<Search>({ status: 'idle' });
  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 3) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    const timer = setTimeout(async () => {
      try {
        const results = await searchAddresses(q, near, controller.signal);
        if (!controller.signal.aborted) setState({ status: 'done', results });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error' });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // Only the coordinates matter for ranking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, enabled, near.lat, near.lon]);
  return state;
}

export function LocationPicker({ place, canSearchAddresses, onSelect }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [locating, setLocating] = useState<'idle' | 'working' | 'failed'>('idle');
  const listId = useId();

  const search = useAddressSearch(query, place, canSearchAddresses && open);
  const results = search.status === 'done' ? search.results : [];

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(0);
    setLocating('idle');
  };
  const choose = (p: Place) => {
    // Keep only what a Place needs (search results also carry a `kind`).
    onSelect({ label: p.label, lat: p.lat, lon: p.lon, ...(p.id ? { id: p.id } : {}) });
    close();
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setLocating('failed');
      return;
    }
    setLocating('working');
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ label: 'Current location', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setLocating('failed'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  return (
    <>
      <button className="place-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <MapPin size={15} aria-hidden="true" />
        <span className="place-label">{place.label}</span>
        <span className="sr-only">. Change starting point</span>
      </button>

      <dialog
        ref={dialog}
        className="sheet"
        aria-labelledby="place-title"
        onClose={close}
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
      >
        <div className="sheet-inner">
          <div className="panel-head">
            <h2 id="place-title">{canSearchAddresses ? 'Where are you starting from?' : 'Pick a starting point'}</h2>
            <button className="icon-btn" aria-label="Close" onClick={close}>
              <X size={18} />
            </button>
          </div>

          {canSearchAddresses && (
            <>
              <div className="search">
                <Search size={16} aria-hidden="true" className="search-icon" />
                <input
                  type="text"
                  role="combobox"
                  aria-expanded={results.length > 0}
                  aria-controls={listId}
                  aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
                  aria-label="Street address or ZIP code"
                  placeholder="Street address or ZIP code"
                  autoComplete="street-address"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActive((a) => Math.min(a + 1, results.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActive((a) => Math.max(a - 1, 0));
                    } else if (e.key === 'Enter' && results[active]) {
                      e.preventDefault();
                      choose(results[active]);
                    }
                  }}
                />
              </div>

              <ul className="address-results" role="listbox" id={listId} aria-label="Address suggestions">
                {results.map((r, i) => (
                  <li
                    key={`${r.label}-${r.lat}`}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? 'is-active' : ''}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(r);
                    }}
                    onMouseEnter={() => setActive(i)}
                  >
                    <MapPin size={14} aria-hidden="true" />
                    <span>{r.label}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small address-status" role="status">
                {search.status === 'loading' && 'Searching…'}
                {search.status === 'error' && 'Couldn’t search addresses right now. Try again, or pick an area below.'}
                {search.status === 'done' && results.length === 0 && 'No matches. Try adding the city or ZIP code.'}
                {search.status === 'idle' && query.trim().length > 0 && query.trim().length < 3 && 'Keep typing…'}
              </p>

              <button className="btn-ghost btn-block" onClick={useMyLocation} disabled={locating === 'working'}>
                <LocateFixed size={16} aria-hidden="true" />
                {locating === 'working' ? 'Finding you…' : 'Use my current location'}
              </button>
              {locating === 'failed' && (
                <p className="small warn" role="alert">
                  Couldn’t get your location. Check that your browser allows it, or type an address.
                </p>
              )}
            </>
          )}

          <div className="eyebrow area-heading">{canSearchAddresses ? 'or pick an area' : 'bellevue areas'}</div>
          <ul className="area-list">
            {NEIGHBORHOODS.map((n) => (
              <li key={n.id}>
                <button
                  className={n.id === place.id ? 'is-on' : ''}
                  aria-pressed={n.id === place.id}
                  onClick={() => choose(n)}
                >
                  <span>{n.label}</span>
                  <span className="muted small num">{n.zip}</span>
                </button>
              </li>
            ))}
          </ul>

          {canSearchAddresses && (
            <p className="footnote">
              The address you type is sent to OpenRouteService to find its location and drive times. It’s saved only in
              this browser.
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
