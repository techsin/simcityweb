/**
 * App entry — owned by the meta agent: title screen -> region view -> new city / load city -> CityScene -> region.
 *
 * URL params (testing):
 *   ?quickstart=1   skip menus, start a new medium city immediately (default config, region terrain of a fixed
 *                   quickstart region). Extras: &size=small|medium|large|64|128|256 &terrain=<preset> &seed=N
 *                   &difficulty=easy|medium|hard|sandbox &climate=...
 *   ?region=1       open the region view of a fresh default region (&preset=<id> &seed=N &demo=1 founds demo cities)
 *   ?newcity=1      like region=1, then open the New City dialog on a medium tile
 * window.__ready = true once the first screen has rendered. window.__metropolis exposes the App (debugging).
 *
 * Saving: CityScene autosaves on game time (AppSettings.autosaveMonths, default 3); the app saves on tab hide and
 * on exit, tracks unsaved changes (dirty flag + SaveStatus indicator) and keeps an emergency "unsaved progress"
 * snapshot (save/recovery.ts) — written synchronously on beforeunload / pagehide / tab hide and every 30 s while
 * dirty — which the next start offers to recover.
 */
import './ui/theme.css';
import './region/ui/meta.css';
import { audio } from './audio';
import { installUiSounds } from './ui/uiSounds';
import type { CityState } from './sim/CityState';
import type { CityConfigData } from './sim/config';
import { BF, CityState as CityStateClass } from './sim/CityState';
import { generateTerrain, scatterTrees } from './sim/terrainGen';
import type { TerrainPreset, Difficulty, Climate } from './core/types';
import { RegionModel, createRegionData, PRESET_BY_ID } from './region/RegionModel';
import type { RegionData, RegionPresetId, RegionTile, TileSize } from './region/types';
import { RegionScreen } from './region/RegionScreen';
import { openNewCityDialog, terrainOptionsFor } from './region/NewCityDialog';
import { summarizeCity } from './region/citySummary';
import { cityThumbnail, drawCityMap, normalizeThumbnail, regionPreviewDataUrl, regionPreviewKey } from './region/mapPreview';
import { randomCityName, randomMayorName } from './region/names';
import { loadSettings, saveSettings, type AppSettings } from './region/settings';
import { TitleScreen } from './region/ui/TitleScreen';
import { LoadingScreen } from './region/ui/LoadingScreen';
import { openCredits, openLoadRegion, openNewRegion, openRecoverDialog, openSettings } from './region/ui/dialogs';
import { SaveStatus } from './region/ui/SaveStatus';
import { setUiRoot, toast } from './region/ui/modal';
import { button, formatMoney, formatPop, h, paint, timeAgo } from './region/ui/dom';
import {
  clearRecoveryAfterSave,
  clearRecoveryBase,
  deleteCity,
  deleteRegion,
  discardRecoverySnapshot,
  findRecoverySnapshot,
  getLastSession,
  hasCity,
  hasRecoverySnapshot,
  isPersistent,
  loadCity,
  loadRegion,
  restoreRecoverySnapshot,
  saveCity,
  saveRegion,
  setLastRegionId,
  setLastSession,
  writeRecoverySnapshot,
  type PendingRecovery,
  type WriteResult,
} from './save';
import { regionContext, applyRegionEffects, trackRegionEffects } from './region/regionEffects';
import { NeighborLabels } from './region/NeighborLabels';
import type { Camera } from 'three';

// ---------------------------------------------------------------------------------------------------------------
// CityScene contract (owned by ui-game; loaded lazily so the app works before it exists)
// ---------------------------------------------------------------------------------------------------------------
interface CitySceneLike {
  start?(): unknown;
  dispose(): void;
  /** save now (shows CityScene's SavePill); resolves when done */
  save?(auto?: boolean): Promise<void>;
  sim?: { state: CityState; events?: { on(type: 'month', fn: (m: number) => void): () => void } };
  /** current world view (NullWorldView until the 3D views are up); used for neighbour labels + readiness */
  worldView?: { camera?: Camera; isNull?: boolean };
  /** optional: resolves once the 3D views are up (used to delay window.__ready) */
  ready?: Promise<unknown>;
  whenReady?(): Promise<unknown>;
}
interface CitySceneOptions {
  container: HTMLElement;
  state: CityState;
  onExitToRegion: (thumbnailDataUrl?: string) => void;
  onSave: (state: CityState) => Promise<void>;
  /** app-level settings; CityScene treats these keys as overrides of its stored in-game prefs */
  settings?: Partial<AppSettings>;
  onSettingsChange?: (s: Partial<AppSettings> & Record<string, unknown>) => void;
}
type CitySceneCtor = new (opts: CitySceneOptions) => CitySceneLike;

const cityModules = import.meta.glob('./game/CityScene.ts');
async function loadCitySceneCtor(): Promise<CitySceneCtor | null> {
  const loader = cityModules['./game/CityScene.ts'];
  if (!loader) return null;
  try {
    const mod = (await loader()) as { CityScene?: CitySceneCtor; default?: CitySceneCtor };
    return mod.CityScene ?? mod.default ?? null;
  } catch (e) {
    console.error('[main] failed to load CityScene', e);
    return null;
  }
}

/** resolve when CityScene's 3D views are up: its ready promise if it has one, else poll worldView (max 90 s) */
async function waitForScene(scene: CitySceneLike): Promise<void> {
  const explicit = scene.ready ?? scene.whenReady?.();
  const timeout = new Promise<void>((r) => setTimeout(r, 90_000));
  if (explicit) {
    await Promise.race([explicit.then(() => undefined, () => undefined), timeout]);
    return;
  }
  const poll = new Promise<void>((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const wv = scene.worldView;
      if ((wv && !wv.isNull && wv.camera) || !('worldView' in scene) || performance.now() - t0 > 90_000) resolve();
      else setTimeout(tick, 200);
    };
    tick();
  });
  await Promise.race([poll, timeout]);
}

function markReady(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => ((window as unknown as { __ready: boolean }).__ready = true)));
}

/**
 * Cheap summary of what a save would change: sim time, money, buildings, budget / policies, name, unlocks. Together
 * with the change events counted in App.city.changes it tells "unsaved changes" apart (camera moves don't count).
 */
function cityFingerprint(st: CityState): string {
  const b = st.budget;
  const budget = b ? JSON.stringify([b.taxRates, b.funding, b.ordinances, b.loans?.length ?? 0]) : '';
  // player-set "historic" marks (toggling one emits only buildingChanged, which derived recomputes emit too)
  let hist = 0;
  for (const x of st.buildings.values()) if (x.flags & BF.Historic) hist = (hist + Math.imul(x.id, 2654435761)) | 0;
  return `${st.day}|${Math.round(st.funds * 100)}|${st.buildings.size}|${st.nextBuildingId}|${st.config.name}|${st.unlocked?.size ?? 0}|${hist}|${budget}`;
}

/**
 * sim events that change saved state without necessarily moving the fingerprint (paused edits: tools, dispatches,
 * disasters, unlocks). Not counted: derived recomputes (layerUpdated, and buildingChanged, which traffic / utilities /
 * pollution passes emit for flag updates after an edit — counting those would flag a just-saved city as unsaved).
 */
const CHANGE_EVENTS = [
  'networkChanged', 'zoneChanged', 'terrainChanged', 'powerLinesChanged', 'subwayChanged', 'treesChanged',
  'buildingAdded', 'buildingRemoved', 'disaster', 'emergency', 'unlocked',
];
/** wall-clock interval of background recovery snapshots while there are unsaved changes */
const SNAPSHOT_INTERVAL_MS = 30_000;
/** outcome of a "Recover unsaved progress?" prompt ('later' = dismissed, snapshot kept; 'none' = nothing to offer) */
type RecoverChoice = 'recovered' | 'discarded' | 'later' | 'failed' | 'none';

// ---------------------------------------------------------------------------------------------------------------
class App {
  readonly root: HTMLElement;
  private title: TitleScreen | null = null;
  private regionScreen: RegionScreen | null = null;
  private region: RegionModel | null = null;
  private city: {
    scene: CitySceneLike | null;
    tile: RegionTile;
    state: CityState;
    placeholder?: HTMLElement;
    lastSave: number;
    offRegion?: () => void;
    labels?: NeighborLabels;
    /** change events seen (counter) / at the last successful save / at the last recovery snapshot */
    changes: number;
    cleanChanges: number;
    snapChanges: number;
    /** fingerprint at the last successful save / at the last recovery snapshot */
    cleanFp: string;
    snapFp: string;
    /** the last recovery snapshot was a lean (periodic) one */
    snapLean?: boolean;
    lastSnap: number;
    saving: number;
    saveFailed: boolean;
    offChanges?: () => void;
    status?: SaveStatus;
    ticker?: number;
  } | null = null;
  /** serializes city saves (CityScene autosave, tab-hide, exit) so writes never overlap */
  private saveChain: Promise<void> = Promise.resolve();
  private settings: AppSettings = loadSettings();
  private busy = false;
  /** saves survive a reload (IndexedDB available) — recovery snapshots are pointless otherwise */
  private persistent = false;
  private previewPending = false;
  /** the page is being unloaded (pagehide seen): a full save would not complete, only snapshots are taken */
  private unloading = false;
  /** the start-up "Recover unsaved progress?" offer while it is in progress (see recoveryGate) */
  private offerPending: Promise<RecoverChoice> | null = null;
  /** last recovery snapshot result (debugging / tests) */
  lastSnapshot: (WriteResult & { why: string }) | null = null;

  constructor(host: HTMLElement) {
    this.root = h('div', { class: 'meta-root' });
    host.appendChild(this.root);
    setUiRoot(this.root);
    audio.attachAutoInit();
    audio.startMusic();
    // generic click / slider / tab / hover feedback for every control (src/ui/uiSounds.ts)
    installUiSounds(() => audio);
    // CityScene autosaves on game time (autosaveMonths); we add save-on-exit, save-on-tab-hide and — because an async
    // IndexedDB save started while the page unloads does not complete — a synchronous recovery snapshot on unload
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden' || !this.city) return;
      this.snapshotNow('hidden');
      // + a full save when the tab is merely hidden (on unload it would not finish; the snapshot covers that)
      if (!this.unloading && this.isDirty()) void this.saveCurrentCity().catch(() => undefined);
    });
    window.addEventListener('beforeunload', () => this.snapshotNow('beforeunload'));
    window.addEventListener('pagehide', () => {
      this.unloading = true;
      this.snapshotNow('pagehide');
    });
    // back from the back/forward cache
    window.addEventListener('pageshow', () => (this.unloading = false));
  }

  async boot(): Promise<void> {
    const q = new URLSearchParams(location.search);
    // (the testing entry points below return early; recovery snapshots need this in every mode)
    void isPersistent().then((p) => (this.persistent = p));
    try {
      if (q.get('quickstart') === '1') return await this.quickstart(q);
      if (q.get('region') === '1' || q.get('newcity') === '1') return await this.freshRegion(q, q.get('newcity') === '1');
      await this.showTitle();
    } catch (e) {
      console.error('[main] boot failed', e);
      toast(`Something went wrong: ${(e as Error).message}`, 'bad', 6000);
      markReady();
    }
    this.persistent = await isPersistent();
    if (!this.persistent) toast('Saving is unavailable in this browser mode — progress will be lost on reload.', 'bad', 6000);
    // the last session ended with changes newer than the last save: offer them back (title screen only)
    else if (this.title) void this.offerRecovery();
  }

  // ------------------------------------------------------------------ recovery of unsaved progress
  /** at start: "Recover unsaved progress?" for a pending snapshot; Recover restores it and continues into the city */
  private async offerRecovery(): Promise<void> {
    const found: { p: PendingRecovery | null } = { p: null };
    const run = (async (): Promise<RecoverChoice> => {
      found.p = await findRecoverySnapshot().catch((e) => (console.warn('[main] recovery check failed', e), null));
      if (!found.p || !this.title) return 'none';
      return this.askRecover(found.p);
    })();
    this.offerPending = run;
    let choice: RecoverChoice = 'none';
    try {
      choice = await run;
    } finally {
      this.offerPending = null;
    }
    const p = found.p;
    if (choice !== 'recovered' || !p || !this.title) return;
    const data = await loadRegion(p.marker.regionId).catch(() => null);
    if (data) await this.continueInCity(data, p.marker.tileKey);
  }

  /** before entering a city: if a snapshot of it is pending, ask first. false = don't enter (dismissed / superseded) */
  private async recoveryGate(regionId: string, tileKey: string): Promise<boolean> {
    // the player clicked before the start-up offer opened: let it decide first (on Recover it enters that city itself)
    const offer = this.offerPending;
    if (offer) {
      const r = await offer;
      if (r === 'recovered' || r === 'later') return false;
    }
    const city = { regionId, tileKey };
    if (!(await hasRecoverySnapshot(city)) || !(await isPersistent())) return true;
    const pending = await findRecoverySnapshot(city).catch(() => null);
    if (!pending) return true;
    return (await this.askRecover(pending)) !== 'later';
  }

  /** dialog + restore / discard. 'later' = dismissed (snapshot kept) */
  private async askRecover(p: PendingRecovery): Promise<RecoverChoice> {
    const choice = await openRecoverDialog(p.marker);
    if (choice === 'discard') {
      await discardRecoverySnapshot(p.marker);
      return 'discarded';
    }
    if (choice !== 'recover') return 'later';
    try {
      await restoreRecoverySnapshot(p);
      toast(`Recovered ${p.marker.cityName} (${p.marker.date ?? 'unsaved progress'})`, 'good', 3500);
      return 'recovered';
    } catch (e) {
      console.error('[main] recovery failed', e);
      toast(`The snapshot could not be recovered: ${(e as Error).message}`, 'bad', 6000);
      await discardRecoverySnapshot(p.marker);
      return 'failed';
    }
  }

  // ------------------------------------------------------------------ screens
  private clearScreens(): void {
    this.title?.dispose();
    this.title = null;
    this.regionScreen?.dispose();
    this.regionScreen = null;
  }

  async showTitle(): Promise<void> {
    this.clearScreens();
    audio.stopAmbience();
    audio.setMusicContext({ screen: 'menu', night: false, population: 0, activity: 0.3 });
    audio.startMusic();
    let continueInfo: { title: string; sub: string } | null = null;
    let last: RegionData | null = null;
    let lastTile: RegionTile | undefined;
    const session = getLastSession();
    if (session) {
      last = await loadRegion(session.regionId).catch(() => null);
      if (last && session.tileKey) {
        const t = last.tiles.find((x) => x.key === session.tileKey);
        if (t?.city && (await hasCity(last.id, t.key).catch(() => false))) lastTile = t;
      }
      if (last && lastTile?.city)
        continueInfo = { title: lastTile.city.name, sub: `${last.name} · ${formatPop(lastTile.city.population)} residents · ${timeAgo(lastTile.city.lastPlayed)}` };
      else if (last) continueInfo = { title: last.name, sub: `${formatPop(last.totals?.population ?? 0)} residents · ${timeAgo(last.lastPlayed)}` };
    }
    this.title = new TitleScreen(this.root, {
      continueInfo,
      quality: this.settings.quality,
      onContinue: last ? () => void (lastTile ? this.continueInCity(last!, lastTile.key) : this.openRegion(last!)) : undefined,
      onNewRegion: () => void this.newRegionFlow(),
      onLoadRegion: () => openLoadRegion((r) => void this.openRegion(r)),
      onSettings: () => openSettings((s) => (this.settings = s)),
      onCredits: () => openCredits(),
    });
    await this.title.ready;
    markReady();
  }

  private async newRegionFlow(): Promise<void> {
    const choice = await openNewRegion();
    if (!choice) return;
    const ld = new LoadingScreen(this.root);
    ld.set('Shaping the landscape…', 0.15);
    await paint();
    const { data, model } = createRegionData({ seed: choice.seed, preset: choice.preset, name: choice.name, climate: choice.climate });
    ld.set('Carving rivers and coastlines…', 0.55);
    await paint();
    drawPreview(model);
    await saveRegion(data);
    setLastRegionId(data.id);
    await this.showRegion(model, ld);
  }

  async openRegion(data: RegionData, select?: string): Promise<void> {
    const ld = new LoadingScreen(this.root);
    ld.set('Generating terrain…', 0.2);
    await paint();
    const model = new RegionModel(data);
    ld.set('Placing city tiles…', 0.6);
    await paint();
    setLastRegionId(data.id);
    await this.showRegion(model, ld, select);
  }

  private async showRegion(model: RegionModel, ld?: LoadingScreen, selectKey?: string, signalReady = true): Promise<void> {
    this.clearScreens();
    this.region = model;
    audio.stopAmbience();
    audio.setMusicContext({ screen: 'region', night: false, population: model.data.totals?.population ?? 0, activity: 0.3 });
    audio.startMusic();
    ld?.set('Rendering the region…', 0.85);
    if (ld) await paint();
    model.data.lastPlayed = Date.now();
    void saveRegion(model.data);
    // an overview image left stale while a city was open (founded tiles changed) is redrawn here, when idle
    if (!model.data.preview || model.data.previewKey !== regionPreviewKey(model)) this.schedulePreview();
    this.regionScreen = new RegionScreen(
      this.root,
      model,
      {
        onPlay: (t) => void this.playCity(t),
        onFound: (t) => void this.foundCity(t),
        onMenu: () => void this.showTitle(),
        onSettings: () => openSettings((s) => (this.settings = s)),
        onChanged: () => this.persistRegion(),
        onDeleteCity: async (t) => {
          await deleteCity(model.data.id, t.key);
          t.city = undefined;
          await this.persistRegion();
        },
        onImported: (r) => void this.openRegion(r),
      },
      { quality: this.settings.quality },
    );
    if (selectKey) {
      const t = model.tileByKey(selectKey);
      if (t) this.regionScreen.selectTile(t);
    }
    await this.regionScreen.ready;
    await ld?.hide();
    // arriving at the region after a loading screen (new / loaded region, back from a city)
    if (ld) audio.play('regionEnter');
    if (signalReady) markReady();
  }

  private async persistRegion(): Promise<void> {
    const m = this.region;
    if (!m) return;
    m.recomputeTotals();
    // the overview image only depends on which tiles are founded: redraw it (when idle) only when that changed
    if (!m.data.preview || m.data.previewKey !== regionPreviewKey(m)) this.schedulePreview();
    await saveRegion(m.data);
  }

  /**
   * Lazily redraw + store the region overview image (deduplicated; runs when the main thread is idle, and never
   * while a city is open — showRegion schedules it again).
   */
  private schedulePreview(): void {
    if (this.previewPending) return;
    this.previewPending = true;
    const run = () => {
      this.previewPending = false;
      const m = this.region;
      if (!m || this.city || (m.data.preview && m.data.previewKey === regionPreviewKey(m))) return;
      if (drawPreview(m)) void saveRegion(m.data).catch(() => undefined);
    };
    const ric = (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(run, { timeout: 2500 });
    else setTimeout(run, 600);
  }

  // ------------------------------------------------------------------ cities
  async foundCity(tile: RegionTile): Promise<void> {
    if (this.busy || !this.region) return;
    const cfg = await openNewCityDialog({ region: this.region, tile });
    if (!cfg) return;
    await this.startNewCity(this.region, tile, cfg);
  }

  private async startNewCity(model: RegionModel, tile: RegionTile, cfg: CityConfigData): Promise<void> {
    this.busy = true;
    const ld = new LoadingScreen(this.root);
    try {
      ld.set('Generating terrain…', 0.1);
      await paint();
      const st = new CityStateClass(cfg);
      const topts = terrainOptionsFor(cfg, model, tile);
      generateTerrain(st, { ...topts, skipTrees: true });
      ld.set('Planting trees…', 0.35);
      await paint();
      scatterTrees(st, topts);
      ld.set('Founding the city…', 0.5);
      await paint();
      tile.city = summarizeCity(st);
      tile.city.thumbnail = cityThumbnail(st, 256);
      await saveCity(model.data.id, tile.key, st);
      await this.persistRegion();
      await this.enterCity(model, tile, st, ld);
    } catch (e) {
      console.error('[main] failed to found city', e);
      toast(`Could not found the city: ${(e as Error).message}`, 'bad', 6000);
      ld.remove();
    } finally {
      this.busy = false;
    }
  }

  /** Continue straight into the city the player was in when the page was closed */
  async continueInCity(data: RegionData, tileKey: string): Promise<void> {
    if (!(await this.recoveryGate(data.id, tileKey))) return;
    const ld = new LoadingScreen(this.root);
    ld.set('Generating terrain…', 0.15);
    await paint();
    const model = new RegionModel(data);
    this.region = model;
    const tile = model.tileByKey(tileKey);
    if (!tile?.city) {
      ld.remove();
      return this.openRegion(data);
    }
    await this.playCity(tile, ld);
  }

  async playCity(tile: RegionTile, existing?: LoadingScreen): Promise<void> {
    if (this.busy || !this.region) {
      existing?.remove();
      return;
    }
    this.busy = true;
    // unsaved progress of this city from an earlier session? (asked before the loading screen covers the UI)
    if (!existing && !(await this.recoveryGate(this.region.data.id, tile.key).catch(() => true))) {
      this.busy = false;
      return;
    }
    const ld = existing ?? new LoadingScreen(this.root);
    try {
      ld.set(`Loading ${tile.city?.name ?? 'city'}…`, 0.25);
      await paint();
      const st = await loadCity(this.region.data.id, tile.key);
      if (!st) {
        ld.remove();
        toast('This city’s save could not be found. You can found a new city here.', 'bad', 5000);
        tile.city = undefined;
        await this.persistRegion();
        await this.regionScreen?.refresh();
        return;
      }
      await this.enterCity(this.region, tile, st, ld);
    } catch (e) {
      console.error('[main] failed to load city', e);
      toast(`Could not load the city: ${(e as Error).message}`, 'bad', 6000);
      ld.remove();
    } finally {
      this.busy = false;
    }
  }

  private async enterCity(model: RegionModel, tile: RegionTile, st: CityState, ld: LoadingScreen): Promise<void> {
    ld.set('Building the city…', 0.7);
    await paint();
    this.clearScreens();
    const Ctor = await loadCitySceneCtor();
    const container = h('div', { class: 'meta-layer city-host' });
    this.root.prepend(container);
    setLastSession({ regionId: model.data.id, tileKey: tile.key });
    // regional play: neighbours' jobs / workers + summary for sim systems (refreshed monthly below)
    const rctx = regionContext(model, tile);
    applyRegionEffects(st, rctx);
    // the state was just loaded / founded + saved: clean
    const now = Date.now();
    this.city = { scene: null, tile, state: st, lastSave: now, changes: 0, cleanChanges: 0, snapChanges: 0, cleanFp: cityFingerprint(st), snapFp: '', lastSnap: now, saving: 0, saveFailed: false };
    audio.startAmbience();
    audio.setAmbience({ population: st.stats.population, zoom: 0.5, night: false });
    audio.setMusicContext({ screen: 'city', night: false, population: st.stats.population, activity: 0.5 });
    if (Ctor) {
      const scene = new Ctor({
        container,
        state: st,
        settings: { quality: this.settings.quality, edgeScroll: this.settings.edgeScroll, showFps: this.settings.showFps, autosaveMonths: this.settings.autosaveMonths },
        onExitToRegion: (thumb) => void this.exitCity(thumb),
        onSave: (s) => this.saveCityState(s),
        onSettingsChange: (gs) => {
          // keep the app-level defaults in sync with changes made in the in-game settings panel
          if (gs.quality) this.settings.quality = gs.quality;
          if (typeof gs.edgeScroll === 'boolean') this.settings.edgeScroll = gs.edgeScroll;
          if (typeof gs.showFps === 'boolean') this.settings.showFps = gs.showFps;
          if (typeof gs.autosaveMonths === 'number') this.settings.autosaveMonths = gs.autosaveMonths;
          saveSettings(this.settings);
        },
      });
      this.city.scene = scene;
      if (scene.sim?.events) this.city.offRegion = trackRegionEffects(scene.sim as Parameters<typeof trackRegionEffects>[0], rctx);
      // edits that don't move the fingerprint (e.g. zoning while paused) still count as unsaved changes
      const ev = scene.sim?.events as unknown as { on(type: string, fn: () => void): () => void } | undefined;
      if (ev) {
        const c = this.city;
        const offs = CHANGE_EVENTS.map((t) => ev.on(t, () => void c.changes++));
        c.offChanges = () => offs.forEach((off) => off());
      }
      await scene.start?.();
      await waitForScene(scene);
      if (rctx.neighbors.some((n) => n.founded)) this.city.labels = new NeighborLabels(container, () => scene.worldView?.camera, scene.sim?.state ?? st, rctx.neighbors);
    } else {
      this.city.placeholder = this.cityPlaceholder(container, st, tile);
    }
    if (this.city) {
      // "Unsaved changes" / "Saved" indicator (above the minimap) + dirty checks and background recovery snapshots
      const c = this.city;
      c.status = new SaveStatus(() => this.saveNow());
      c.status.mount(container);
      c.ticker = window.setInterval(() => this.tickSaveState(), 1000);
      this.tickSaveState();
    }
    await ld.hide();
    audio.play('cityReady');
    markReady();
  }

  private currentState(): CityState | null {
    if (!this.city) return null;
    return this.city.scene?.sim?.state ?? this.city.state;
  }

  /** the current city differs from its last successful save */
  private isDirty(): boolean {
    const c = this.city;
    const st = this.currentState();
    if (!c || !st) return false;
    return c.changes !== c.cleanChanges || cityFingerprint(st) !== c.cleanFp;
  }

  /** refresh the save indicator; schedule a background recovery snapshot while dirty */
  private tickSaveState(): void {
    const c = this.city;
    if (!c) return;
    if (c.saving > 0) {
      c.status?.set('saving');
      return;
    }
    const dirty = this.isDirty();
    c.status?.set(!dirty ? 'saved' : c.saveFailed ? 'error' : 'dirty', c.lastSave);
    if (dirty && this.persistent && !document.hidden && Date.now() - c.lastSnap >= SNAPSHOT_INTERVAL_MS) {
      c.lastSnap = Date.now(); // (re)armed now; the snapshot itself runs when the main thread is idle
      const ric = (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(() => this.snapshotNow('periodic'), { timeout: 5000 });
      else this.snapshotNow('periodic');
    }
  }

  /**
   * Synchronous recovery snapshot of unsaved changes (save/recovery.ts): safe inside beforeunload / pagehide, where
   * an IndexedDB full save would not complete. Skipped when nothing changed since the last save or snapshot.
   * Periodic ones are lean (sim-recomputed layers left out: cheaper on the main thread); an unload snapshot after a
   * lean one is written in full even when nothing else changed.
   */
  private snapshotNow(why: string): void {
    const c = this.city, model = this.region;
    if (!c || !model || !this.persistent) return;
    const st = this.currentState();
    if (!st) return;
    try {
      const fp = cityFingerprint(st);
      const lean = why === 'periodic';
      if (c.saving === 0 && fp === c.cleanFp && c.changes === c.cleanChanges) return;
      if (fp === c.snapFp && c.changes === c.snapChanges && (lean || !c.snapLean)) return;
      const r = writeRecoverySnapshot(model.data.id, c.tile.key, st, { cityName: st.config.name, regionName: model.data.name, population: st.stats?.population ?? 0, funds: st.funds, why, lean });
      c.snapFp = fp;
      c.snapChanges = c.changes;
      c.snapLean = lean;
      c.lastSnap = Date.now();
      this.lastSnapshot = { ...r, why };
    } catch (e) {
      console.warn('[main] recovery snapshot failed', e);
    }
  }

  /** indicator click: save now (through CityScene so its SavePill / sound confirm it) */
  private saveNow(): void {
    const c = this.city;
    if (!c || c.saving > 0) return;
    const p = c.scene?.save ? c.scene.save(false) : this.saveCurrentCity();
    void p.catch((e) => toast(`Saving failed: ${(e as Error).message}`, 'bad', 6000));
  }

  private async saveCurrentCity(thumb?: string): Promise<void> {
    const st = this.currentState();
    if (st) await this.saveCityState(st, thumb);
  }

  /** persist a city + refresh its region tile summary (also CityScene's onSave). Saves are queued, never overlap. */
  saveCityState(st: CityState, thumb?: string): Promise<void> {
    const run = this.saveChain.then(() => this.doSaveCity(st, thumb));
    this.saveChain = run.catch(() => undefined);
    return run;
  }

  private async doSaveCity(st: CityState, thumb?: string): Promise<void> {
    const model = this.region;
    const c = this.city;
    if (!model || !c) return;
    const tile = c.tile;
    // what this save covers: saveCity serializes synchronously (no other task runs before it)
    const fp = cityFingerprint(st), changes = c.changes;
    c.saving++;
    c.status?.set('saving');
    try {
      const savedAt = await saveCity(model.data.id, tile.key, st);
      c.cleanFp = fp;
      c.cleanChanges = changes;
      c.saveFailed = false;
      c.lastSave = Date.now();
      // this save made the city's recovery snapshots obsolete; the next one is a delta of it. A snapshot taken while
      // it was being written (newer, but a delta of the replaced save) is dropped too: take a fresh one soon.
      if (clearRecoveryAfterSave(model.data.id, tile.key, savedAt)) c.lastSnap = 0;
      c.snapFp = '';
      c.snapChanges = -1;
    } catch (e) {
      c.saveFailed = true;
      throw e;
    } finally {
      c.saving--;
      if (this.city === c) this.tickSaveState();
    }
    const prevThumb = tile.city?.thumbnail;
    const newThumb = thumb ? await normalizeThumbnail(thumb, Math.min(512, tile.size * 128)) : undefined;
    tile.city = summarizeCity(st, tile.city);
    tile.city.thumbnail = newThumb ?? prevThumb ?? cityThumbnail(st, 256);
    await this.persistRegion();
  }

  async exitCity(thumb?: string): Promise<void> {
    const c = this.city;
    const model = this.region;
    if (!c || !model) return;
    const ld = new LoadingScreen(this.root);
    ld.set('Saving city…', 0.3);
    await paint();
    try {
      await this.saveChain; // an autosave may still be writing
      if (!this.isDirty()) {
        // CityScene.exitToRegion just saved (onSave) and paused the sim: trust that save and only refresh the tile
        // thumbnail + region summary (no second city save)
        if (thumb && c.tile.city) c.tile.city.thumbnail = await normalizeThumbnail(thumb, Math.min(512, c.tile.size * 128));
        await this.persistRegion();
      } else await this.saveCurrentCity(thumb);
    } catch (e) {
      console.error('[main] save on exit failed', e);
      toast(`Saving failed: ${(e as Error).message}`, 'bad', 6000);
    }
    // the save failed: keep the progress as a recovery snapshot (offered when the city is opened again)
    if (this.isDirty()) this.snapshotNow('exit');
    c.offRegion?.();
    c.offChanges?.();
    clearInterval(c.ticker);
    c.status?.dispose();
    c.labels?.dispose();
    setLastSession({ regionId: model.data.id });
    try {
      c.scene?.dispose();
    } catch (e) {
      console.warn('[main] CityScene.dispose failed', e);
    }
    this.root.querySelector('.city-host')?.remove();
    this.city = null;
    clearRecoveryBase();
    audio.stopAmbience();
    ld.set('Returning to the region…', 0.7);
    await this.showRegion(model, ld, c.tile.key);
  }

  /** stand-in when src/game/CityScene.ts is not available yet */
  private cityPlaceholder(container: HTMLElement, st: CityState, tile: RegionTile): HTMLElement {
    const canvas = h('canvas', { width: '420', height: '420' }) as HTMLCanvasElement;
    drawCityMap(canvas, st, { city: true });
    const back = button('Back to Region', { icon: 'chevronLeft', cls: 'lg warm', sound: 'confirm', onClick: () => void this.exitCity() });
    const el = h(
      'div',
      { class: 'city-placeholder' },
      h(
        'div',
        { class: 'cp-card glass' },
        canvas,
        h(
          'div',
          {},
          h('h2', {}, st.config.name),
          h('div', { class: 'kbd-hint' }, `Mayor ${st.config.mayor} · ${tile.size * 64} × ${tile.size * 64} cells · ${st.config.climate}`),
          h('p', {}, 'The 3D city view is still under construction in this build. Your city has been founded and saved — its terrain matches the neighbouring region tiles.'),
          h('p', {}, `Treasury: ${formatMoney(st.funds)} · Population: ${formatPop(st.stats.population)}`),
          back,
        ),
      ),
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.city) {
        window.removeEventListener('keydown', onKey);
        void this.exitCity();
      }
    };
    window.addEventListener('keydown', onKey);
    container.appendChild(el);
    return el;
  }

  // ------------------------------------------------------------------ testing entry points
  private async freshRegion(q: URLSearchParams, openDialog: boolean): Promise<void> {
    const preset = (q.get('preset') as RegionPresetId) || 'greenvale';
    const seed = q.get('seed') ? +q.get('seed')! : 4242;
    const id = `fresh-${preset}-${seed}`;
    const ld = new LoadingScreen(this.root);
    ld.set('Generating terrain…', 0.2);
    await paint();
    await deleteRegion(id).catch(() => undefined);
    const { data, model } = createRegionData({ seed, preset: PRESET_BY_ID[preset] ? preset : 'greenvale', id });
    if (q.get('demo') === '1') {
      ld.set('Founding demo cities…', 0.5);
      await paint();
      const { populateDemoCities } = await import('./region/demo');
      await populateDemoCities(model, +(q.get('cities') ?? 6));
    }
    drawPreview(model);
    await saveRegion(data);
    setLastRegionId(id);
    if (!openDialog) return this.showRegion(model, ld);
    const tile = pickNiceTile(model, 2);
    await this.showRegion(model, ld, tile.key, false);
    const p = openNewCityDialog({ region: model, tile });
    markReady();
    const cfg = await p;
    if (cfg) await this.startNewCity(model, tile, cfg);
  }

  private async quickstart(q: URLSearchParams): Promise<void> {
    const sizeParam = q.get('size') ?? 'medium';
    const size = (({ small: 1, medium: 2, large: 4, '64': 1, '128': 2, '256': 4 }) as Record<string, TileSize>)[sizeParam] ?? 2;
    const seed = q.get('seed') ? +q.get('seed')! : 1234;
    const ld = new LoadingScreen(this.root);
    ld.set('Generating terrain…', 0.1);
    await paint();
    await deleteRegion('quickstart').catch(() => undefined);
    const { data, model } = createRegionData({ seed, preset: 'greenvale', id: 'quickstart', name: 'Quickstart Valley' });
    this.region = model;
    const tile = pickNiceTile(model, size);
    const partial: Partial<CityConfigData> = { name: randomCityName(), mayor: randomMayorName() };
    const terrain = q.get('terrain') as TerrainPreset | null;
    if (terrain && terrain !== 'region') partial.terrain = terrain;
    const diff = q.get('difficulty') as Difficulty | null;
    if (diff) partial.difficulty = diff;
    const climate = q.get('climate') as Climate | null;
    if (climate) partial.climate = climate;
    const cfg = model.cityConfigFor(tile, partial);
    if (diff) cfg.startFunds = ({ easy: 250_000, medium: 100_000, hard: 40_000, sandbox: 10_000_000 } as const)[diff] ?? cfg.startFunds;
    cfg.sandbox = cfg.difficulty === 'sandbox';
    drawPreview(model);
    await saveRegion(data);
    setLastRegionId(data.id);
    ld.remove();
    await this.startNewCity(model, tile, cfg);
  }
}

/** draw + store the region overview image (false when no 2D canvas is available) */
function drawPreview(model: RegionModel): boolean {
  try {
    model.data.preview = regionPreviewDataUrl(model);
    model.data.previewKey = regionPreviewKey(model);
    return true;
  } catch {
    return false;
  }
}

/** a tile of the wanted size with a pleasant amount of water (some, not much) */
function pickNiceTile(model: RegionModel, size: TileSize): RegionTile {
  const cands = model.data.tiles.filter((t) => t.size === size);
  const pool = cands.length ? cands : model.data.tiles;
  let best = pool[0], bestScore = -1e9;
  for (const t of pool) {
    const w = model.tileWaterFraction(t);
    const score = -Math.abs(w - 0.12) - (w > 0.4 ? 1 : 0) - Math.hypot(t.x + t.size / 2 - 8, t.z + t.size / 2 - 8) * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

const host = document.getElementById('app') ?? document.body;
const app = new App(host);
(window as unknown as { __metropolis: App; __audio: typeof audio }).__metropolis = app;
(window as unknown as { __audio: typeof audio }).__audio = audio;
void app.boot();
