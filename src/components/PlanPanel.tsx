import { Check } from 'lucide-react';
import { miles, minutes, money, moneyShort, plural } from '../domain/format';
import type { DataSources, Market, Mode, Plan, PlanSet } from '../domain/types';
import type { Action, Settings } from '../state/appState';
import { planOptions, savingsVsBaseline } from './planOptions';

interface Props {
  planSet: PlanSet | null;
  recommended: Plan | null;
  shown: Plan | null;
  onShow: (planId: string | null) => void;
  settings: Settings;
  maxFlex: number;
  market: Market | null;
  cartEmpty: boolean;
  loading: boolean;
  /** Other chains' stores are still being found. */
  estimating: boolean;
  error: string | null;
  onRetry: () => void;
  dispatch: (a: Action) => void;
  activeStoreId: string | null;
  onActiveStore: (id: string | null) => void;
}

export function PlanPanel(props: Props) {
  const { planSet, recommended, shown, settings, cartEmpty, error } = props;

  return (
    <section className="panel-body" aria-labelledby="plan-heading">
      <div className="panel-head">
        <h2 id="plan-heading">Your trip</h2>
        <DataBadge sources={props.market?.sources} hasEstimates={!!props.market?.stores.some((st) => st.estimated)} />
      </div>

      {props.estimating && (
        <p className="muted small estimating" role="status">
          Looking for other stores nearby…
        </p>
      )}

      {error && (
        <p className="notice notice--warn" role="alert">
          {error}{' '}
          <button className="link link--inline" onClick={props.onRetry}>
            Try again
          </button>
        </p>
      )}

      <ModeControl {...props} />

      {cartEmpty ? (
        <p className="empty-plan">Add a few items to your list and your route will show up here.</p>
      ) : !planSet || !recommended || !shown ? (
        error ? null : <PlanEmpty planSet={planSet} loading={props.loading} settings={settings} live={props.market?.sources.prices === 'live'} />
      ) : (
        <>
          <Hero planSet={planSet} plan={shown} />
          <TradeoffNote planSet={planSet} plan={shown} mode={settings.mode} flex={settings.flex} />
          <EstimateNote planSet={planSet} plan={shown} />
          <Ledger {...props} plan={shown} planSet={planSet} />
          {planSet.unavailable.length > 0 && (
            <p className="notice notice--warn">
              No nearby store carries {planSet.unavailable.map((p) => p.name.toLowerCase()).join(', ')}, so{' '}
              {planSet.unavailable.length === 1 ? 'it isn’t' : 'they aren’t'} in this plan.
            </p>
          )}
          <Compare {...props} planSet={planSet} recommended={recommended} shown={shown} />
          <Footnote market={props.market} settings={settings} />
        </>
      )}
    </section>
  );
}

const SOURCE_LABELS: Record<keyof DataSources, string> = {
  stores: 'stores',
  prices: 'prices',
  routing: 'drive times',
  gas: 'gas price',
};

function DataBadge({ sources, hasEstimates }: { sources: DataSources | undefined; hasEstimates: boolean }) {
  if (!sources) return null;
  const entries = Object.entries(sources) as [keyof DataSources, DataSources[keyof DataSources]][];
  const real = entries.filter(([, v]) => v === 'live').map(([k]) => SOURCE_LABELS[k]);
  const estimated = entries.filter(([, v]) => v === 'demo').map(([k]) => SOURCE_LABELS[k]);

  if (estimated.length === 0) {
    return (
      <span
        className="tag tag--live"
        title={`Stores, prices, drive times and gas are all real.${hasEstimates ? ' Other chains use estimated prices, and are marked.' : ''}`}
      >
        Live data
      </span>
    );
  }
  if (sources.prices === 'live') {
    return (
      <span className="tag tag--live" title={`Real: ${real.join(', ')}. Estimated: ${estimated.join(', ')}.${hasEstimates ? ' Some other stores use estimated prices.' : ''}`}>
        Live prices
      </span>
    );
  }
  return (
    <span className="tag" title="Stores, prices and gas are sample data for this demo.">
      Demo data
    </span>
  );
}

function gasSentence(market: Market, settings: Settings): string {
  const price = `${money(settings.gasPriceOverride ?? market.gasPrice)}/gal`;
  if (settings.gasPriceOverride !== null) return `Gas is ${price} (your price) at ${settings.mpg} mpg.`;
  if (market.sources.gas === 'live' && market.gasInfo) {
    const week = new Date(`${market.gasInfo.period}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `Gas is ${price}, the U.S. Energy Information Administration’s weekly average for ${market.gasInfo.area} (week of ${week}), at ${settings.mpg} mpg.`;
  }
  return `Gas is ${price} (an estimate) at ${settings.mpg} mpg.`;
}

function Footnote({ market, settings }: { market: Market | null; settings: Settings }) {
  if (!market) return null;
  const { sources } = market;
  const asOf = market.pricesAsOf ? new Date(market.pricesAsOf) : null;
  return (
    <p className="footnote">
      {sources.routing === 'live'
        ? 'Drive times and distances are from OpenRouteService, without live traffic.'
        : 'Distances are estimated road miles.'}{' '}
      {gasSentence(market, settings)}
      {sources.prices === 'live' ? (
        <>
          {' '}
          Store and price data come from Kroger’s public API
          {asOf ? `, as of ${asOf.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}. Sale prices may
          need the store’s loyalty card. Only Kroger-family stores (QFC, Fred Meyer) publish prices, so other chains aren’t
          included. This app isn’t affiliated with or endorsed by Kroger.
          {market.stores.some((st) => st.estimated) && (
            <>
              {' '}
              Prices marked ~ are estimates for stores that don’t publish prices. Each starts from a real price for the same
              item and is scaled by how the chain compares with Kroger in Consumer Reports’ 2025 study of six metros (for
              example, Aldi about 20% lower, Walmart about 13% lower, Whole Foods about 22% higher). Aldi and Lidl are only
              estimated for store-brand and fresh items, and warehouse clubs sell larger packs. Their locations are ©{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap
              </a>{' '}
              contributors.
            </>
          )}
        </>
      ) : (
        asOf && (
          <> Prices as of {asOf.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. These are sample prices.</>
        )
      )}
    </p>
  );
}

function PlanEmpty({ planSet, loading, settings, live }: { planSet: PlanSet | null; loading: boolean; settings: Settings; live: boolean }) {
  if (loading && !planSet) return <p className="empty-plan">Working out your route…</p>;
  if (planSet && planSet.storesConsidered === 0) {
    return (
      <p className="notice notice--warn">
        {live && 'There are no Kroger-family stores near here, so there are no real prices to compare, and estimates for other chains need a real price to start from. '}
        {settings.radiusMiles <= 10 ? `No stores within ${settings.radiusMiles} miles of here. ` : 'No stores found near here. '}
        {settings.radiusMiles < 15 ? 'Try a larger distance in Trip settings, or a different starting point.' : 'Try a different starting point.'}
      </p>
    );
  }
  return <p className="empty-plan">No nearby store carries anything on your list yet.</p>;
}

/* ---------- mode ---------- */

function ModeControl({ settings, planSet, maxFlex, dispatch }: Props) {
  const flex = Math.min(settings.flex, maxFlex);
  const options: { value: Mode; label: string; hint: string }[] = [
    { value: 'cheapest', label: 'Lowest price', hint: 'Whatever costs least, even if it’s a longer trip' },
    { value: 'time', label: 'Save time', hint: 'Stay flexible on price, and go for the quicker trip' },
  ];
  const current = options.find((o) => o.value === settings.mode)!;

  return (
    <div className="mode">
      <div className="eyebrow" id="mode-label">
        What matters most
      </div>
      <div className="segmented" role="radiogroup" aria-labelledby="mode-label">
        {options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={settings.mode === o.value}
            className={settings.mode === o.value ? 'is-on' : ''}
            onClick={() => dispatch({ type: 'settings', patch: { mode: o.value } })}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="muted small mode-hint">{current.hint}.</p>

      {settings.mode === 'time' && (
        <div className="flex">
          <label htmlFor="drive" className="flex-label">
            Drive no more than <strong className="num">{minutes(settings.maxDriveMinutes)}</strong> in total
          </label>
          <div className="range-row">
            <input
              id="drive"
              type="range"
              min={5}
              max={60}
              step={5}
              value={settings.maxDriveMinutes}
              aria-valuetext={`${settings.maxDriveMinutes} minutes of driving, round trip`}
              onChange={(e) => dispatch({ type: 'settings', patch: { maxDriveMinutes: Number(e.target.value) } })}
            />
          </div>
          <div className="flex-scale num muted small" aria-hidden="true">
            <span>5 min</span>
            <span>1 hr</span>
          </div>
          <p className={`small ${planSet?.driveLimit?.overLimit ? 'warn' : 'muted'}`}>
            {!planSet?.driveLimit
              ? 'Round-trip driving, not counting time in the stores.'
              : planSet.driveLimit.overLimit
                ? `Even the closest store needs more driving than that, so we’re showing the shortest trip.`
                : planSet.driveLimit.maxStops === 1
                  ? 'Round-trip driving. At this limit, a single stop is all that fits.'
                  : `Round-trip driving. At this limit, up to ${planSet.driveLimit.maxStops} stops fit.`}
          </p>
        </div>
      )}

      {settings.mode === 'time' && planSet?.cheapest && (
        <div className="flex">
          {maxFlex === 0 ? (
            <p className="muted small">Under this drive limit the cheapest trip is also the fastest, so there’s nothing to trade off.</p>
          ) : (
            <>
              <label htmlFor="flex" className="flex-label">
                I’ll pay up to <strong className="num">{money(flex)}</strong> more to save time
              </label>
              <div className="flex-track">
                <input
                  id="flex"
                  type="range"
                  min={0}
                  max={maxFlex}
                  step={5}
                  value={flex}
                  aria-valuetext={`${money(flex)} more than the cheapest trip`}
                  onChange={(e) => dispatch({ type: 'settings', patch: { flex: Number(e.target.value) } })}
                />
                <div className="flex-ticks" aria-hidden="true">
                  {planSet.frontier.slice(1).map((p) => (
                    <span key={p.id} style={{ left: `${((p.total - planSet.cheapest!.total) / maxFlex) * 100}%` }} />
                  ))}
                </div>
              </div>
              <div className="flex-scale num muted small" aria-hidden="true">
                <span>$0</span>
                <span>{moneyShort(Math.ceil(maxFlex / 100) * 100)}</span>
              </div>
              <p className="muted small">Marks show where a faster trip becomes affordable.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- hero ---------- */

function Hero({ planSet, plan }: { planSet: PlanSet; plan: Plan }) {
  const saved = savingsVsBaseline(planSet, plan);
  const base = planSet.baseline?.stops[0].store.name;

  let label = 'Your trip costs';
  let figure = money(plan.total);
  let sub = 'No single store has everything on your list.';
  let tone = '';
  if (saved !== null && base) {
    if (saved > 0) {
      label = 'You save';
      figure = money(saved);
      sub = `compared with ${base} alone, gas included`;
    } else if (saved === 0) {
      label = 'You save';
      figure = money(0);
      sub = `same as shopping at ${base} alone`;
      tone = 'hero-figure--flat';
    } else {
      label = 'Costs extra';
      figure = money(-saved);
      sub = `compared with ${base} alone, gas included`;
      tone = 'hero-figure--flat';
    }
  }

  if (plan.estimated) {
    // A guess shouldn't read like a fact.
    label = label === 'You save' ? 'You could save about' : label === 'Costs extra' ? 'Could cost about' : 'Your trip could cost about';
    figure = `~${figure}`;
    sub = `${sub}. Includes estimated prices.`;
  }

  return (
    <div className="hero">
      <div className="eyebrow">{label}</div>
      <div className={`hero-figure ${tone}`}>{figure}</div>
      <p className="muted small">{sub}</p>
      <dl className="stats">
        <div>
          <dt>Stops</dt>
          <dd className="num">{plan.stops.length}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd className="num">{minutes(plan.totalMinutes)}</dd>
        </div>
        <div>
          <dt>Driving</dt>
          <dd className="num">
            {miles(plan.totalMiles)} · {minutes(plan.driveMinutes)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Says which stops are guesses, and what the best trip with only real prices would be. */
function EstimateNote({ planSet, plan }: { planSet: PlanSet; plan: Plan }) {
  if (!plan.estimated) return null;
  const names = plan.stops.filter((s) => s.store.estimated).map((s) => s.store.name);
  const real = planSet.cheapestReal;
  let compare = '';
  if (real && real.id !== plan.id) {
    const diff = real.total - plan.total;
    compare = ` The best trip using only real prices costs ${money(real.total)}${
      diff > 0 ? `, about ${money(diff)} more` : diff < 0 ? `, about ${money(-diff)} less` : ''
    }.`;
  }
  return (
    <p className="tradeoff tradeoff--est">
      Prices at {names.join(' and ')} {names.length === 1 ? 'are an estimate' : 'are estimates'}: a real nearby price for the same
      item, scaled by how the chain compares in a 2025 Consumer Reports study.{compare}
    </p>
  );
}

function TradeoffNote({ planSet, plan, mode, flex }: { planSet: PlanSet; plan: Plan; mode: Mode; flex: number }) {
  const cheapest = planSet.cheapest!;
  const extra = plan.total - cheapest.total;
  const faster = cheapest.totalMinutes - plan.totalMinutes;

  let text: string | null = null;
  if (plan.id !== cheapest.id && extra > 0 && faster >= 1) {
    text = `${money(extra)} more than the cheapest trip, and ${minutes(faster)} quicker.`;
  } else if (plan.id === cheapest.id && mode === 'time') {
    const next = planSet.frontier.find((p) => p.totalMinutes < plan.totalMinutes - 0.5 && p.total > plan.total);
    if (next) {
      const need = next.total - cheapest.total;
      text = `Your ${money(Math.min(flex, planSet.fastest!.total - cheapest.total))} limit doesn’t buy a faster trip yet. The next step up is ${minutes(plan.totalMinutes - next.totalMinutes)} quicker for ${money(need)} more.`;
    }
  }
  if (!text) return null;
  return <p className="tradeoff">{text}</p>;
}

/* ---------- ledger ---------- */

function Ledger({
  plan,
  planSet,
  settings,
  market,
  activeStoreId,
  onActiveStore,
}: Props & { plan: Plan; planSet: PlanSet }) {
  const base = planSet.baseline;
  return (
    <ol className="ledger" aria-label="Stops in order">
      {plan.stops.map((stop, i) => (
        <li
          key={stop.store.id}
          className={`ledger-stop ${activeStoreId === stop.store.id ? 'is-active' : ''}`}
          onMouseEnter={() => onActiveStore(stop.store.id)}
          onMouseLeave={() => onActiveStore(null)}
        >
          <span className="stop-num num" aria-hidden="true">
            {i + 1}
          </span>
          <div className="ledger-main">
            <span className="ledger-name">
              {stop.store.name}
              {stop.store.estimated && <span className="est-tag">estimated</span>}
            </span>
            <span className="muted small">
              {plural(
                stop.lines.reduce((n, l) => n + l.qty, 0),
                'item',
              )}{' '}
              · {miles(stop.legMiles)} {i === 0 ? 'from home' : 'from stop ' + i} · {minutes(stop.legMinutes)}
            </span>
          </div>
          <span className="leader" aria-hidden="true" />
          <span className="num">{stop.store.estimated ? '~' : ''}{money(stop.subtotal)}</span>
        </li>
      ))}
      <li className="ledger-row">
        <div className="ledger-main">
          <span>Gas</span>
          <span className="muted small">
            {miles(plan.totalMiles)} round trip · {settings.mpg} mpg
            {market ? ` · ${money(settings.gasPriceOverride ?? market.gasPrice)}/gal` : ''}
          </span>
        </div>
        <span className="leader" aria-hidden="true" />
        <span className="num">{money(plan.gasCost)}</span>
      </li>
      <li className="ledger-total">
        <span>Total</span>
        <span className="leader" aria-hidden="true" />
        <span className="num">{plan.estimated ? '~' : ''}{money(plan.total)}</span>
      </li>
      {base && base.id !== plan.id && (
        <li className="ledger-row muted">
          <div className="ledger-main">
            <span className="small">{base.stops[0].store.name} alone</span>
          </div>
          <span className="leader" aria-hidden="true" />
          <span className="num strike">{money(base.total)}</span>
        </li>
      )}
    </ol>
  );
}

/* ---------- compare ---------- */

function Compare({
  planSet,
  recommended,
  shown,
  onShow,
}: Props & { planSet: PlanSet; recommended: Plan; shown: Plan }) {
  const options = planOptions(planSet, recommended);
  if (options.length < 2) return null;
  return (
    <div className="compare">
      <div className="eyebrow" id="compare-label">
        Compare trips
      </div>
      <div role="radiogroup" aria-labelledby="compare-label">
        {options.map(({ plan, tags }) => {
          const on = plan.id === shown.id;
          return (
            <button
              key={plan.id}
              role="radio"
              aria-checked={on}
              className={`compare-row ${on ? 'is-on' : ''}`}
              onClick={() => onShow(plan.id === recommended.id ? null : plan.id)}
            >
              <span className="radio" aria-hidden="true">
                {on && <Check size={11} strokeWidth={3} />}
              </span>
              <span className="compare-main">
                <span className="compare-title">{tags.join(' · ')}</span>
                <span className="muted small">{plan.stops.map((s) => s.store.name).join(' → ')}</span>
              </span>
              <span className="compare-nums num">
                <span>{plan.estimated ? '~' : ''}{money(plan.total)}</span>
                <span className="muted small">{minutes(plan.totalMinutes)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
