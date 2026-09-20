import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { money } from '../domain/format';
import type { Action, Settings } from '../state/appState';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  marketGasPrice: number | null;
  /** Live mode with other chains' stores available. */
  canEstimate: boolean;
  dispatch: (a: Action) => void;
}

export function TripSettings({ open, onClose, settings, marketGasPrice, canEstimate, dispatch }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const set = (patch: Partial<Settings>) => dispatch({ type: 'settings', patch });
  const gas = settings.gasPriceOverride ?? marketGasPrice ?? 0;

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="settings-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-inner">
        <div className="panel-head">
          <h2 id="settings-title">Trip settings</h2>
          <button className="icon-btn" aria-label="Close settings" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="field">
          <div className="field-label" id="stops-label">
            <span>Most stops</span>
            <span className="muted small">More stops can save more, but each one takes time.</span>
          </div>
          <div className="segmented segmented--sm" role="radiogroup" aria-labelledby="stops-label">
            {([1, 2, 3] as const).map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={settings.maxStops === n}
                className={settings.maxStops === n ? 'is-on' : ''}
                onClick={() => set({ maxStops: n })}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="radius">
            <span>How far to look</span>
            <span className="muted small">Stores beyond this distance from home are skipped.</span>
          </label>
          <div className="range-row">
            <input
              id="radius"
              type="range"
              min={3}
              max={15}
              step={1}
              value={settings.radiusMiles}
              onChange={(e) => set({ radiusMiles: Number(e.target.value) })}
            />
            <span className="num">{settings.radiusMiles} mi</span>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="mpg">
            <span>Your car’s mpg</span>
            <span className="muted small">Used to turn miles into gas money.</span>
          </label>
          <input
            id="mpg"
            className="text-input num"
            type="number"
            inputMode="numeric"
            min={8}
            max={80}
            value={settings.mpg}
            onChange={(e) => set({ mpg: Math.min(80, Math.max(8, Number(e.target.value) || 26)) })}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="gas">
            <span>Gas price per gallon</span>
            <span className="muted small">
              Using {settings.gasPriceOverride === null ? 'the local average' : 'your price'} ({money(gas)}).
            </span>
          </label>
          <div className="gas-row">
            <input
              id="gas"
              className="text-input num"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={1}
              max={12}
              placeholder={marketGasPrice ? (marketGasPrice / 100).toFixed(2) : ''}
              value={settings.gasPriceOverride === null ? '' : (settings.gasPriceOverride / 100).toFixed(2)}
              onChange={(e) => {
                const v = e.target.value;
                set({ gasPriceOverride: v === '' ? null : Math.round(Number(v) * 100) });
              }}
            />
            {settings.gasPriceOverride !== null && (
              <button className="link" onClick={() => set({ gasPriceOverride: null })}>
                Use local average
              </button>
            )}
          </div>
        </div>

        {canEstimate && (
          <div className="field field--row">
            <div className="field-label">
              <span id="estimate-label">Include other stores, with estimated prices</span>
              <span className="muted small">
                Walmart, Aldi, Target and others don’t publish prices. We estimate them from a real nearby price and
                published price studies, so treat them as rough. Estimated stops are always marked.
              </span>
            </div>
            <button
              role="switch"
              aria-checked={settings.includeEstimated}
              aria-labelledby="estimate-label"
              className={`switch ${settings.includeEstimated ? 'is-on' : ''}`}
              onClick={() => set({ includeEstimated: !settings.includeEstimated })}
            >
              <span />
            </button>
          </div>
        )}

        <div className="field field--row">
          <div className="field-label">
            <span id="member-label">Include membership stores</span>
            <span className="muted small">Warehouse clubs like Costco need a paid membership.</span>
          </div>
          <button
            role="switch"
            aria-checked={settings.includeMembership}
            aria-labelledby="member-label"
            className={`switch ${settings.includeMembership ? 'is-on' : ''}`}
            onClick={() => set({ includeMembership: !settings.includeMembership })}
          >
            <span />
          </button>
        </div>

        <button className="btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
