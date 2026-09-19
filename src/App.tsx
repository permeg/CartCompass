import { ArrowRight, Compass, ListChecks, Map as MapIcon, Settings2, ShoppingBasket, Route } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CartPanel } from './components/CartPanel';
import { ChartMap } from './components/ChartMap';
import { LocationPicker } from './components/LocationPicker';
import { PlanPanel } from './components/PlanPanel';
import { planOptions, savingsVsBaseline } from './components/planOptions';
import { ShoppingList } from './components/ShoppingList';
import { TripSettings } from './components/TripSettings';
import { miles, money } from './domain/format';
import { providersFor, type Capabilities, type DataMode } from './data/providers';
import { useAppState, type Action, type AppState } from './state/appState';
import { nearestStoreId, usePlanner } from './state/usePlanner';
import { useRouteLine } from './state/useRouteLine';

type Tab = 'basket' | 'trip' | 'map' | 'store';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** Ask the server what it can do. A static host or an offline server means demo only. */
function useCapabilities(): Capabilities | null {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/health', { signal: AbortSignal.timeout(3000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { ok?: boolean; livePrices?: boolean; liveRouting?: boolean; liveGas?: boolean }) => {
        if (cancelled) return;
        const ok = body.ok === true;
        setCaps({
          livePrices: ok && body.livePrices === true,
          liveRouting: ok && body.liveRouting === true,
          liveGas: ok && body.liveGas === true,
        });
      })
      .catch(() => {
        if (!cancelled) setCaps({ livePrices: false, liveRouting: false, liveGas: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return caps;
}

export default function App() {
  const [state, dispatch] = useAppState();
  const caps = useCapabilities();
  // Live data is the default whenever the server supports it. Otherwise fall back to demo.
  const effective: DataMode = caps?.livePrices ? state.preferred : 'demo';

  useEffect(() => {
    if (caps) dispatch({ type: 'activate', mode: effective });
  }, [caps, effective, dispatch]);

  if (!caps || state.mode !== effective) {
    return (
      <div className="splash" role="status">
        <Compass size={28} strokeWidth={1.4} aria-hidden="true" />
        <span>Loading Cart Compass…</span>
      </div>
    );
  }
  // Keyed by mode so tabs and pinned comparisons start fresh when switching.
  return <Workspace key={effective} state={state} dispatch={dispatch} mode={effective} caps={caps} />;
}

interface WorkspaceProps {
  state: AppState;
  dispatch: (a: Action) => void;
  mode: DataMode;
  caps: Capabilities;
}

function Workspace({ state, dispatch, mode, caps }: WorkspaceProps) {
  const canGoLive = caps.livePrices;
  const providers = useMemo(() => providersFor(mode, caps), [mode, caps]);
  const cart = state.carts[mode];
  const { settings, checked } = state;
  const planner = usePlanner(cart, settings, providers, mode);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('basket');
  const [sideTab, setSideTab] = useState<'trip' | 'store'>('trip');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // A pinned comparison only makes sense for the inputs it was pinned under.
  const cartKey = cart.map((l) => `${l.productId}:${l.qty}`).join(',');
  useEffect(() => setPinnedId(null), [settings.mode, settings.flex, settings.maxDriveMinutes, settings.maxStops, settings.radiusMiles, settings.includeMembership, settings.home.lat, settings.home.lon, settings.demoHomeId, cartKey]);

  const { planSet, recommended } = planner;
  const shown = useMemo(() => {
    if (!planSet || !recommended) return null;
    return planOptions(planSet, recommended).find((o) => o.plan.id === pinnedId)?.plan ?? recommended;
  }, [planSet, recommended, pinnedId]);

  const unavailableIds = useMemo(() => new Set(planSet?.unavailable.map((p) => p.id)), [planSet]);
  const itemCount = cart.reduce((n, l) => n + l.qty, 0);
  const saved = planSet && shown ? savingsVsBaseline(planSet, shown) : null;

  const cartPanel = (
    <CartPanel
      cart={cart}
      catalog={providers.catalog}
      sampleCart={providers.sampleCart()}
      searchStoreId={nearestStoreId(planner.market)}
      market={planner.market}
      unavailableIds={unavailableIds}
      dispatch={dispatch}
    />
  );
  const planPanel = (
    <PlanPanel
      planSet={planSet}
      recommended={recommended}
      shown={shown}
      onShow={setPinnedId}
      settings={settings}
      maxFlex={planner.maxFlex}
      market={planner.market}
      cartEmpty={cart.length === 0}
      loading={planner.loading}
      error={planner.error}
      onRetry={planner.retry}
      dispatch={dispatch}
      activeStoreId={activeStoreId}
      onActiveStore={setActiveStoreId}
    />
  );
  const shopPanel = (
    <ShoppingList plan={shown} checked={checked} dispatch={dispatch} activeStoreId={activeStoreId} onActiveStore={setActiveStoreId} />
  );
  const routeLine = useRouteLine(providers, cart.length === 0 ? null : shown, planner.home);
  const chart = (
    <ChartMap
      market={planner.market}
      plan={cart.length === 0 ? null : shown}
      origin={planner.home}
      radiusMiles={settings.radiusMiles}
      includeMembership={settings.includeMembership}
      activeStoreId={activeStoreId}
      onActiveStore={setActiveStoreId}
      homeLabel={planner.home.label.split(',')[0]}
      routeLine={routeLine}
      credit={providers.sources.routing === 'live'}
    />
  );

  const header = (
    <header className="topbar">
      <div className="brand">
        <Compass size={22} strokeWidth={1.6} aria-hidden="true" />
        <span>Cart Compass</span>
      </div>
      <div className="topbar-actions">
        {canGoLive && (
          <div className="segmented segmented--tiny" role="radiogroup" aria-label="Data source">
            {(['live', 'demo'] as const).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                className={mode === m ? 'is-on' : ''}
                title={m === 'live' ? 'Real QFC and Fred Meyer prices' : 'Invented stores and prices, for trying the app'}
                onClick={() => dispatch({ type: 'choose', mode: m })}
              >
                {m === 'live' ? 'Live' : 'Demo'}
              </button>
            ))}
          </div>
        )}
        <LocationPicker
          place={planner.home}
          canSearchAddresses={mode === 'live' && caps.liveRouting}
          onSelect={(place) =>
            dispatch({
              type: 'settings',
              patch: mode === 'live' ? { home: place } : { demoHomeId: place.id ?? settings.demoHomeId },
            })
          }
        />
        <button className="btn-ghost" aria-label="Trip settings" onClick={() => setSettingsOpen(true)}>
          <Settings2 size={16} aria-hidden="true" />
          <span className="btn-label">Trip settings</span>
        </button>
      </div>
    </header>
  );

  const settingsSheet = (
    <TripSettings
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      settings={settings}
      marketGasPrice={planner.market?.gasPrice ?? null}
      dispatch={dispatch}
    />
  );

  if (isDesktop) {
    return (
      <div className="app app--desktop">
        {header}
        <main className="workspace">
          <aside className="col col--list">{cartPanel}</aside>
          <div className="col col--map">{chart}</div>
          <aside className="col col--plan">
            <div className="side-tabs" role="tablist" aria-label="Trip details">
              <button role="tab" aria-selected={sideTab === 'trip'} onClick={() => setSideTab('trip')}>
                Trip
              </button>
              <button role="tab" aria-selected={sideTab === 'store'} onClick={() => setSideTab('store')}>
                At the store
              </button>
            </div>
            {sideTab === 'trip' ? planPanel : shopPanel}
          </aside>
        </main>
        {settingsSheet}
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: typeof Route }[] = [
    { id: 'basket', label: 'Basket', icon: ShoppingBasket },
    { id: 'trip', label: 'Trip', icon: Route },
    { id: 'map', label: 'Map', icon: MapIcon },
    { id: 'store', label: 'In store', icon: ListChecks },
  ];

  return (
    <div className="app app--mobile">
      {header}
      <main className="mobile-main">
        {tab === 'basket' && cartPanel}
        {tab === 'trip' && planPanel}
        {tab === 'map' && (
          <div className="map-tab">
            {chart}
            {shown && (
              <ol className="legend" aria-label="Stops in order">
                {shown.stops.map((s, i) => (
                  <li key={s.store.id} onMouseEnter={() => setActiveStoreId(s.store.id)} onMouseLeave={() => setActiveStoreId(null)}>
                    <span className="stop-num num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span>{s.store.name}</span>
                    <span className="muted small num">{miles(s.legMiles)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        {tab === 'store' && shopPanel}
      </main>

      {tab === 'basket' && cart.length > 0 && shown && (
        <button className="cta" onClick={() => setTab('trip')}>
          <span>
            {saved !== null && saved > 0 ? `See your trip · save ${money(saved)}` : 'See your trip'}
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      )}

      <nav className="bottom-nav" aria-label="Sections">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            <span className="nav-icon">
              <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
              {id === 'basket' && itemCount > 0 && <span className="badge num">{itemCount}</span>}
            </span>
            {label}
          </button>
        ))}
      </nav>
      {settingsSheet}
    </div>
  );
}
