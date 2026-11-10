/**
 * App entry — owned by the meta agent: title screen -> region view -> new city / load city -> CityScene -> region.
 *
 * URL params (testing):
 *   ?quickstart=1   skip menus, start a new medium city immediately (default config, region terrain of a fixed
 *                   quickstart region). Extras: &size=small|medium|large|64|128|256 &terrain=<preset> &seed=N
 *                   &difficulty=easy|medium|hard|sandbox &climate=...
 *   ?region=1       open the region view of a fresh default region (&preset=<id> &seed=N &demo=1 founds demo cities)
 *   ?newcity=1      like region=1, then open the New City dialog on a medium tile
 *   ?simworker=1    W1.2: the simulation runs in a dedicated Web Worker (WORKER_DESIGN §6); the region screen
 *                   prefetches and pre-spawns it, a boot failure falls back to the main thread, a crash offers
 *                   restart / recover / the main thread. ?simworker=loopback runs the same protocol on the main thread
 *                   (CityScene). &simdev=1 boots the worker with its dev checks and protector probe in a production build
 *                   (tools/qa-worker.mjs; the probe needs Chromium's --js-flags=--allow-natives-syntax).
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
import { CityState as CityStateClass } from './sim/CityState';
import { generateTerrain, scatterTrees } from './sim/terrainGen';
import type { TerrainPreset, Difficulty, Climate } from './core/types';
import { RegionModel, createRegionData, PRESET_BY_ID } from './region/RegionModel';
import type { RegionData, RegionPresetId, RegionTile, TileSize } from './region/types';
import { RegionScreen } from './region/RegionScreen';
import { terrainOptionsFor } from './region/NewCityDialog';
import { summarizeCity } from './region/citySummary';
import { cityThumbnail, drawCityMap, normalizeThumbnail, regionPreviewDataUrl, regionPreviewKey } from './region/mapPreview';
import { randomCityName, randomMayorName } from './region/names';
import { applyFirstRunQuality, cityOverrides, loadSettings, saveSettings, takeCityChanges, type AppSettings } from './region/settings';
import { TitleScreen } from './region/ui/TitleScreen';
import { LoadingScreen } from './region/ui/LoadingScreen';
import { createFirstCity, firstCityTips, hasSavedRegion, lastCityTileKey } from './region/firstCity';
import { openCredits, openLoadRegion, openNewRegion, openRecoverDialog, openSettings, openSimCrashDialog } from './region/ui/dialogs';
import { SaveStatus } from './region/ui/SaveStatus';
import { setUiRoot, toast } from './region/ui/modal';
import { button, formatMoney, formatPop, h, paint, timeAgo } from './region/ui/dom';
import {
  clearRecoveryBase,
  deleteCity,
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
  type PendingRecovery,
  type WriteResult,
} from './save';
import { commitSisterCity, planSisterCity, prepareSisterCity, regionContext, sisterParent, type RegionContext, type SisterParent, type SisterPlan } from './region/regionEffects';
import type { CityPersistence, HostState, SaveReason, SimHost, SnapshotWhy } from './worker/SimHost';
// W1.3: the packet hosts' snapshot cadence, min(30 s, 90 sim days) (WORKER_DESIGN §4.3)
import { periodicSnapshotDue } from './worker/recoveryMirror';
// W1.2: type-only here; the worker host and its module load with the first worker city (or the region screen's spawn)
import type { WorkerSimHost } from './worker/WorkerSimHost';
import type { WorkerPort } from './worker/workerProtocol';
import type { SimErrors } from './worker/SimCore';
import { cityFingerprint } from './save/fingerprint';
import { NeighborLabels } from './region/NeighborLabels';
import type { Camera } from 'three';
import { regionSaveAccess, requestPersistentStorage, requireRegionSaveAccess, withRegionSaveAccess } from './save/db';
import { RegionStorage } from './region/regionLock';
import { handleRecoveryStorageError, isStorageError, recoveryStorageGate, showStorageError, storageRecoveryChoice, withRecoveryStorage } from './ui/StorageDialog';

// ---------------------------------------------------------------------------------------------------------------
// CityScene contract (owned by ui-game; loaded lazily so the app works before it exists)
// ---------------------------------------------------------------------------------------------------------------
interface CitySceneLike {
  readonly host: SimHost;
  /** the scene's error overlay (a worker host booted before the scene reports into it) */
  readonly errors?: SimErrors;
  start?(): unknown;
  dispose(): void;
  /** save now (shows CityScene's SavePill); resolves when done */
  save?(auto?: boolean): Promise<void>;
  storeCamera?(): void;
  sim?: { state: CityState; events?: { on(type: 'month', fn: (m: number) => void): () => void } };
  /** current world view (NullWorldView until the 3D views are up); used for neighbour labels + readiness */
  worldView?: { camera?: Camera; isNull?: boolean };
  /** optional: resolves once the 3D views are up (used to delay window.__ready) */
  ready?: Promise<unknown>;
  /** FH-21: the measured time from the click to the first interactive frame (the fps readout shows it) */
  reportLoadTime?(ms: number): void;
  recordSaved?(): void;
  whenReady?(): Promise<unknown>;
}
interface CitySceneOptions {
  container: HTMLElement;
  state: CityState;
  /** W1.2: the worker host the App booted; `state` is its replica */
  host?: WorkerSimHost;
  rctx?: RegionContext;
  persistence?: CityPersistence;
  /** W1.3: false starts a local or loopback host without the save's recovery journal (§4.4) */
  replayJournal?: boolean;
  onExitToRegion: (thumbnailDataUrl?: string) => void;
  /** LG-12: "Found a sister city": the same exit, then the New City dialog on a free tile next to the city */
  onFoundSister?: (thumbnailDataUrl?: string) => void;
  onSave: (state: HostState, reason?: SaveReason) => Promise<void>;
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

/** FEEL-05: the day a new city is founded on, 1 April of its start year (systemData.foundedDay; the bot founds on day 0) */
const FOUNDING_DAY = 90;

/** wall-clock interval of background recovery snapshots while there are unsaved changes */
const SNAPSHOT_INTERVAL_MS = 30_000;

/** W1.2 (WORKER_DESIGN §6): the simulation in a dedicated worker, behind ?simworker=1 */
const SIM_WORKER = new URLSearchParams(location.search).get('simworker') === '1';
/** the worker's dev checks (assertOwnedBuffers, the recorder's audits, the protector probe): dev builds, or &simdev=1 */
const SIM_WORKER_DEV = !!import.meta.env.DEV || new URLSearchParams(location.search).get('simdev') === '1';
const workerModules = () => Promise.all([import('./worker/WorkerSimHost'), import('./wasm/simWasm'), import('./worker/simWorkerUrl')]);
/** §4.1 step 1: the hello deadline starts once the prefetch has completed or the city is entered, whichever is later;
 *  a download that stalls without an error event starts it this long after entry at the latest (decision, T034) */
const PREFETCH_WAIT_MS = 60_000;
/** the loading screen's text for the worker's boot phases (§4.1 step 4: a slow load shows, not a frozen veil) */
const BOOT_PHASES: Record<string, string> = {
  idb: 'Reading the city…', deserialize: 'Reading the city…', wasm: 'Loading the simulation kernels…',
  systems: 'Starting the simulation…', journal: 'Replaying recent edits…', snapshot: 'Preparing the city…',
};
/** A worker host is booted before its scene exists: its errors go to the console until the scene's overlay takes them. */
class ErrorSink implements SimErrors {
  target: SimErrors | null = null;
  report(title: string, err: unknown, opts?: { key?: string; sim?: boolean }): void {
    if (this.target) this.target.report(title, err, opts);
    else console.error('[sim]', title, err);
  }
}
/** a booted worker host; `crashed` is set by a crash that came before its city was entered */
interface WorkerBoot { host: WorkerSimHost; errors: ErrorSink; crashed: Error | null }
/** outcome of a "Recover unsaved progress?" prompt ('later' = dismissed, snapshot kept; 'none' = nothing to offer) */
type RecoverChoice = 'recovered' | 'discarded' | 'later' | 'failed' | 'none';

// ---------------------------------------------------------------------------------------------------------------
class App {
  readonly root: HTMLElement;
  private title: TitleScreen | null = null;
  private regionScreen: RegionScreen | null = null;
  private region: RegionModel | null = null;
  private storage = new RegionStorage(() => ({
    root: this.root, region: this.region, city: this.city, saved: this.saveChain,
    busy: this.busy, setBusy: (busy) => { this.busy = busy; },
    clearCity: () => { this.city = null; }, open: (data) => this.openRegion(data),
  }));
  private city: {
    scene: CitySceneLike | null;
    tile: RegionTile;
    host: SimHost | null;
    placeholder?: HTMLElement;
    lastSave: number;
    labels?: NeighborLabels;
    /** change events seen (counter) / at the last successful save / at the last recovery snapshot */
    cleanChanges: number;
    snapChanges: number;
    /** fingerprint at the last successful save / at the last recovery snapshot */
    cleanFp: string;
    snapFp: string;
    /** the last recovery snapshot was a lean (periodic) one */
    snapLean?: boolean;
    lastSnap: number;
    /** W1.3: the sim day of the last recovery snapshot and of the last save (the 90-day bound) */
    snapDay: number;
    saveDay: number;
    saving: number;
    saveFailed: boolean;
    status?: SaveStatus;
    ticker?: number;
    /** W1.2: the worker crashed; the crash dialog decides what follows (§4.4) */
    crashed?: boolean;
    /** enterCity finished: a crash dialog may close this city (until then the crash waits, see WorkerBoot) */
    entered?: boolean;
  } | null = null;
  /** W1.2: the next city's worker, spawned while the region screen shows (§4.1 step 1) */
  private spareWorker: Promise<WorkerPort | null> | null = null;
  /** W1.2: the worker script's prefetch (O12), once per page; settles when it has downloaded or failed */
  private workerScript: Promise<void> | null = null;
  /** W1.2: the player chose "Continue on the main thread" after a crash: local hosts for the rest of this page */
  private workerOff = false;
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
  /** FH-21: ms from the last "Found City" / "Play" to the city's first interactive frame (P-5 reports it) */
  lastLoadMs: number | null = null;

  constructor(host: HTMLElement) {
    // FH-21: a first run picks the graphics quality the device can carry (and keeps it, like a chosen setting)
    if (applyFirstRunQuality(this.settings)) saveSettings(this.settings);
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
      if (!this.unloading && this.isDirty() && regionSaveAccess(this.region?.data.id)) void this.saveCurrentCity('hidden').catch((e) => showStorageError(e, { retry: () => this.saveCurrentCity('hidden') }));
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
    const run = withRecoveryStorage<RecoverChoice>(async () => {
      found.p = await findRecoverySnapshot().catch((e) => (console.warn('[main] recovery check failed', e), null));
      if (!found.p || !this.title) return 'none';
      return this.askRecover(found.p);
    }, 'none');
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
    // the player just chose: no second offer of the journal the restore left for the boot to replay (W1.3)
    if (data) await this.continueInCity(data, p.marker.tileKey, false);
  }

  /** NEW-04: the start-up offer holds temporary locks on the regions it scans; let it settle (and decide) before this
   *  tab takes a region's lock, or the session would be read-only against itself */
  private async startupOffer(): Promise<RecoverChoice | null> {
    return this.offerPending ? await this.offerPending.catch(() => null) : null;
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
    return recoveryStorageGate(city, (pending) => this.askRecover(pending));
  }

  /** dialog + restore / discard. 'later' = dismissed (snapshot kept) */
  private async askRecover(p: PendingRecovery): Promise<RecoverChoice> {
    const choice = await storageRecoveryChoice(p.marker.regionId, () => openRecoverDialog(p.marker));
    if (choice === 'discard') {
      await discardRecoverySnapshot(p.marker);
      return 'discarded';
    }
    if (choice !== 'recover') return 'later';
    return this.restoreRecovery(p);
  }

  /** restore a pending snapshot, or report and delete one that cannot be restored */
  private async restoreRecovery(p: PendingRecovery): Promise<RecoverChoice> {
    try {
      await restoreRecoverySnapshot(p);
      toast(`Recovered ${p.marker.cityName} (${p.marker.date ?? 'unsaved progress'})`, 'good', 3500);
      return 'recovered';
    } catch (e) {
      console.error('[main] recovery failed', e);
      if (handleRecoveryStorageError(e, p.marker, (pending) => this.askRecover(pending))) return 'later';
      // player-facing (the reason is in the console); the snapshot is deleted, so it is never offered again
      const m = p.marker;
      const last = m.baseDate ?? (m.baseDay !== undefined ? `day ${m.baseDay}` : '');
      toast(`The snapshot of ${m.cityName} could not be restored. Your last save${last ? ` from ${last}` : ''} is kept.`, 'bad', 6000);
      await discardRecoverySnapshot(m);
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
    this.storage.dispose();
    this.clearScreens();
    this.dropSpareWorker();
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
    // FH-12: with no region saved, the title leads with "Start your first city"
    const firstRun = !last && !(await hasSavedRegion().catch(() => true));
    this.title = new TitleScreen(this.root, {
      continueInfo,
      quality: this.settings.quality,
      // a region left from its region screen opens with its last-played city selected (FH-12: Continue returns to it)
      onContinue: last ? () => void (lastTile ? this.continueInCity(last!, lastTile.key) : this.openRegion(last!, lastCityTileKey(last!))) : undefined,
      onFirstCity: firstRun ? () => void this.startFirstCity() : undefined,
      onNewRegion: () => void this.newRegionFlow(),
      onLoadRegion: () => openLoadRegion((r) => void this.openRegion(r)),
      onSettings: () => openSettings((s) => (this.settings = s)),
      onCredits: () => openCredits(),
    });
    await this.title.ready;
    markReady();
  }

  /** FH-12: "Start your first city": a new region and its first city (src/region/firstCity.ts), founded and opened paused
   *  behind one loading screen with the first-city tips */
  private async startFirstCity(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    // NEW-04: founding the first city asks for persistent storage, inside the player's click (before any await)
    void requestPersistentStorage();
    const t0 = performance.now();
    const ld = new LoadingScreen(this.root, undefined, firstCityTips());
    ld.set('Shaping the landscape…', 0.05);
    await paint();
    const first = await createFirstCity(drawPreview).catch((e: Error) => {
      console.error('[main] failed to create the first city', e);
      toast(`Could not start your first city: ${e.message}`, 'bad', 6000);
      return null;
    });
    this.busy = false;
    if (!first) return ld.remove();
    this.region = first.model;
    await this.startNewCity(first.model, first.tile, first.cfg, t0, ld);
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
    // on Recover the start-up offer enters the recovered city itself
    if ((await this.startupOffer()) === 'recovered') return;
    const ld = new LoadingScreen(this.root);
    ld.set('Generating terrain…', 0.2);
    await paint();
    data = await this.storage.open(data);
    const model = new RegionModel(data);
    ld.set('Placing city tiles…', 0.6);
    await paint();
    setLastRegionId(data.id);
    await this.showRegion(model, ld, select);
  }

  private async showRegion(model: RegionModel, ld?: LoadingScreen, selectKey?: string, signalReady = true): Promise<void> {
    await this.storage.hold(model.data);
    this.clearScreens();
    this.region = model;
    audio.stopAmbience();
    audio.setMusicContext({ screen: 'region', night: false, population: model.data.totals?.population ?? 0, activity: 0.3 });
    audio.startMusic();
    ld?.set('Rendering the region…', 0.85);
    if (ld) await paint();
    model.data.lastPlayed = Date.now();
    if (regionSaveAccess(model.data.id)) void saveRegion(model.data).catch((e) => showStorageError(e, { retry: () => this.persistRegion() }));
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
          requireRegionSaveAccess(model.data.id);
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
    // W1.2: the next city's worker starts while the region shows (a new isolate per city session, §4.4)
    if (this.useWorker()) this.prespawnWorker();
    await ld?.hide();
    // arriving at the region after a loading screen (new / loaded region, back from a city)
    if (ld) audio.play('regionEnter');
    if (signalReady) markReady();
  }

  private async persistRegion(): Promise<void> {
    const m = this.region;
    if (!m || !regionSaveAccess(m.data.id)) return;
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
      if (!m || !regionSaveAccess(m.data.id) || this.city || (m.data.preview && m.data.previewKey === regionPreviewKey(m))) return;
      if (drawPreview(m)) void saveRegion(m.data).catch(() => undefined);
    };
    const ric = (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(run, { timeout: 2500 });
    else setTimeout(run, 600);
  }

  // ------------------------------------------------------------------ cities
  async foundCity(tile: RegionTile): Promise<void> {
    if (this.busy || !this.region) return;
    const model = this.region;
    const cfg = await this.storage.foundDialog(model, tile);
    if (!cfg) return;
    await this.startNewCity(model, tile, cfg);
  }

  /** `t0`: when the player asked for the city (performance.now(); FH-21 measures the load from it); `existing`: a loading
   *  screen already up (FH-12's first city keeps its one screen; removed if the region's lock is refused); `sister`
   *  (LG-12): the city is founded as a sister city, with a road stub and its founding in the region's ledger */
  private async startNewCity(model: RegionModel, tile: RegionTile, cfg: CityConfigData, t0 = performance.now(), existing?: LoadingScreen, sister?: SisterPlan): Promise<void> {
    if (!(await this.storage.hold(model.data))) return void existing?.remove();
    this.busy = true;
    const ld = existing ?? new LoadingScreen(this.root);
    let storing = false; // NEW-04: only a failed write gets the storage dialog
    try {
      ld.set('Generating terrain…', 0.1);
      await paint();
      let st: CityState | null = new CityStateClass(cfg);
      // FEEL-05: a player's city opens in spring (1 April); the CityState constructor keeps day 0 for the bot, the tests
      // and old saves, so only a city founded here starts later in its first year
      st.day = FOUNDING_DAY;
      st.systemData.foundedDay = FOUNDING_DAY;
      const topts = terrainOptionsFor(cfg, model, tile);
      generateTerrain(st, { ...topts, skipTrees: true });
      ld.set('Planting trees…', 0.35);
      await paint();
      scatterTrees(st, topts);
      // LG-12: a sister city's first save holds its road stub, names its parent and starts on its parent's date (that
      // year and month, in place of the founding day above: NOTE-095)
      if (sister) prepareSisterCity(st, sister);
      ld.set('Founding the city…', 0.5);
      await paint();
      tile.city = summarizeCity(st);
      tile.city.thumbnail = cityThumbnail(st, 256);
      storing = true;
      // `st!`: still set here (it is dropped just before enterCity); no second binding keeps it alive past that
      await withRegionSaveAccess(model.data.id, () => saveCity(model.data.id, tile.key, st!));
      // LG-12: the founding's ledger entry (the endowment) is stored by the region write that first names the new city
      if (sister) await commitSisterCity(model.data, sister, () => this.persistRegion());
      else await this.persistRegion();
      storing = false;
      // W1.2: the worker then loads it from IndexedDB (§4.5). Main keeps no recovery base and no state of its own (O6):
      // the scene runs on the worker's replica, as when a saved city is played
      const worker = this.useWorker() ? await this.bootWorker(model, tile, ld) : null;
      if (worker) clearRecoveryBase();
      const state = worker ? worker.host.state : st;
      st = null;
      await this.enterCity(model, tile, state, ld, t0, worker ?? undefined);
    } catch (e) {
      console.error('[main] failed to found city', e);
      if (storing || isStorageError(e)) void showStorageError(e, { retry: () => this.startNewCity(model, tile, cfg, undefined, undefined, sister) });
      else toast(`Could not found the city: ${(e as Error).message}`, 'bad', 6000);
      ld.remove();
    } finally {
      this.busy = false;
    }
  }

  /** Continue straight into the city the player was in when the page was closed (`gate`: ask about its recovery). The
   *  region's lock is taken either way (NEW-04): a city entered after the title's Recover (W1.3: `gate` false, no second
   *  offer of the journal that restore left for the boot to replay) still writes as this tab's region */
  async continueInCity(data: RegionData, tileKey: string, gate = true): Promise<void> {
    const offered = await this.startupOffer();
    if (offered === 'recovered' || offered === 'later') return;
    data = await this.storage.open(data);
    const offer = this.offerPending;
    if (gate && !(await this.recoveryGate(data.id, tileKey))) {
      // T086 B6: "Later" leaves this tab on its title screen, which must not keep the region's lock (a second tab would
      // open read-only). Only the start-up offer's Recover goes on into the city, on this session.
      if ((await offer) !== 'recovered') this.storage.dispose();
      return;
    }
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

  /** `replay` (W1.3, §4.4): false loads the save without the recovery journal bound to it (the crash dialog's "Restart
   *  from autosave" and "Continue on the main thread"); by default the host replays it */
  async playCity(tile: RegionTile, existing?: LoadingScreen, replay = true): Promise<void> {
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
    const t0 = performance.now();
    const ld = existing ?? new LoadingScreen(this.root);
    try {
      ld.set(`Loading ${tile.city?.name ?? 'city'}…`, 0.25);
      await paint();
      // W1.2: main reads the record without deserializing it, and the worker boots on it (O6, R14)
      const worker = this.useWorker() ? await this.bootWorker(this.region, tile, ld, replay) : null;
      if (worker) {
        await this.enterCity(this.region, tile, worker.host.state, ld, t0, worker);
        return;
      }
      const st = await loadCity(this.region.data.id, tile.key);
      if (!st) {
        ld.remove();
        toast('This city’s save could not be found. You can found a new city here.', 'bad', 5000);
        tile.city = undefined;
        await this.persistRegion();
        await this.regionScreen?.refresh();
        return;
      }
      await this.enterCity(this.region, tile, st, ld, t0, undefined, replay);
    } catch (e) {
      console.error('[main] failed to load city', e);
      toast(`Could not load the city: ${(e as Error).message}`, 'bad', 6000);
      ld.remove();
    } finally {
      this.busy = false;
    }
  }

  /** `t0`: when the player asked for the city (FH-21); `worker`: W1.2's booted worker host, whose replica `st` is */
  private async enterCity(model: RegionModel, tile: RegionTile, st: CityState, ld: LoadingScreen, t0 = performance.now(), worker?: WorkerBoot, replay = true): Promise<void> {
    ld.set('Building the city…', 0.7);
    await paint();
    this.clearScreens();
    const Ctor = await loadCitySceneCtor();
    if (worker && !Ctor) {
      // the placeholder runs a local host on a loaded state, never on a replica (§4.5)
      await worker.host.dispose();
      worker = undefined;
      const loaded = await loadCity(model.data.id, tile.key);
      if (!loaded) throw new Error('The city save could not be found');
      st = loaded;
    }
    const container = h('div', { class: 'meta-layer city-host' });
    this.root.prepend(container);
    setLastSession({ regionId: model.data.id, tileKey: tile.key });
    // Both the playable city and the placeholder keep persistence and regional effects in the host.
    const rctx = regionContext(model, tile);
    // the state was just loaded / founded + saved: clean
    const now = Date.now();
    this.city = { scene: null, tile, host: null, lastSave: now, cleanChanges: 0, snapChanges: 0, cleanFp: cityFingerprint(st), snapFp: '', lastSnap: now, snapDay: st.day, saveDay: st.day, saving: 0, saveFailed: false };
    audio.setAmbience({ population: st.stats.population, zoom: 0.5, night: false, water: 0, month: st.month, climate: st.config.climate, construction: 0, activity: 1 });
    audio.startAmbienceAfterLoading(this.root);
    audio.setMusicContext({ screen: 'city', night: false, population: st.stats.population, activity: 0.5 });
    if (Ctor && worker?.host.isDisposed) {
      // W1.2: the worker crashed between its Ready and here (enterCity awaited a paint and the scene's chunk). No scene
      // on a closed host: the crash dialog below decides what follows (§4.4)
      this.city.host = worker.host;
    } else if (Ctor) {
      const scene = new Ctor({
        container,
        state: st,
        host: worker?.host,
        rctx,
        persistence: { regionId: model.data.id, tileKey: tile.key, regionName: model.data.name },
        replayJournal: replay,
        settings: cityOverrides(this.settings),
        onExitToRegion: (thumb) => void this.exitCity(thumb),
        onFoundSister: (thumb) => void this.exitCity(thumb, true),
        onSave: (_state, reason = 'manual') => this.saveCityState(reason),
        onSettingsChange: (gs) => {
          // keep the app-level settings (the shared keys) in sync with changes made in the in-game settings panel
          takeCityChanges(this.settings, gs);
          saveSettings(this.settings);
        },
      });
      this.city.scene = scene;
      this.city.host = scene.host;
      if (worker) worker.errors.target = scene.errors ?? null;
      try {
        await scene.start?.();
        await waitForScene(scene);
      } catch (e) {
        // a worker that crashed while the scene started: the crash dialog below, not the founding / loading error
        if (!worker?.host.isDisposed) throw e;
        console.warn('[main] the city scene did not finish starting: its simulation worker stopped', e);
      }
      if (rctx.neighbors.some((n) => n.founded)) this.city.labels = new NeighborLabels(container, () => scene.worldView?.camera, scene.sim?.state ?? st, rctx.neighbors);
    } else {
      const { LocalSimHost } = await import('./worker/SimHost');
      const host = new LocalSimHost(st, { rctx, persistence: { regionId: model.data.id, tileKey: tile.key, regionName: model.data.name } });
      await host.start({}); // the placeholder keeps its entry effects without running simulation systems
      this.city.host = host;
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
    // FH-21: the loading screen is gone and the views drew a frame: the city takes input from here
    this.lastLoadMs = performance.now() - t0;
    this.city?.scene?.reportLoadTime?.(this.lastLoadMs);
    audio.play('cityReady');
    markReady();
    if (this.city) this.city.entered = true;
    // W1.2: the worker crashed while the city was being entered; the dialog opens now
    if (worker && (worker.crashed || worker.host.isDisposed)) void this.onWorkerCrash(worker.host, worker.crashed ?? new Error('The simulation worker stopped'));
  }

  private currentState(): HostState | null {
    if (!this.city) return null;
    return this.city.host?.state ?? null;
  }

  /** the current city differs from its last successful save */
  private isDirty(): boolean {
    const c = this.city;
    const st = this.currentState();
    if (!c || !st) return false;
    return c.host?.changes !== c.cleanChanges || cityFingerprint(st) !== c.cleanFp;
  }

  /** refresh the save indicator; schedule a background recovery snapshot while dirty */
  private tickSaveState(): void {
    const c = this.city;
    if (!c) return;
    if (c.status) c.status.el.disabled = !regionSaveAccess(this.region?.data.id);
    if (c.saving > 0) {
      c.status?.set('saving');
      return;
    }
    const dirty = this.isDirty();
    c.status?.set(!dirty ? 'saved' : c.saveFailed ? 'error' : 'dirty', c.lastSave);
    // W1.3: a packet host's worker snapshot every min(30 s, 90 sim days), counted from the last snapshot or save (a save
    // in the window is the better base); the local host keeps its 30 s on the main thread
    const day = this.currentState()?.day ?? c.snapDay;
    const due = c.host?.kind === 'local' || !c.host ? Date.now() - c.lastSnap >= SNAPSHOT_INTERVAL_MS
      : periodicSnapshotDue({ now: Date.now(), day, snapAt: c.lastSnap, snapDay: c.snapDay, saveAt: c.lastSave, saveDay: c.saveDay });
    if (dirty && this.persistent && !document.hidden && due) {
      c.lastSnap = Date.now(); // (re)armed now; the snapshot itself runs when the main thread is idle
      c.snapDay = day;
      const ric = (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(() => { if (this.city === c) this.snapshotNow('periodic'); }, { timeout: 5000 });
      else this.snapshotNow('periodic');
    }
  }

  /**
   * Synchronous recovery snapshot of unsaved changes (save/recovery.ts): safe inside beforeunload / pagehide, where
   * an IndexedDB full save would not complete. Skipped when nothing changed since the last save or snapshot.
   * Periodic ones are lean (sim-recomputed layers left out: cheaper on the main thread); an unload snapshot after a
   * lean one is written in full even when nothing else changed.
   */
  private snapshotNow(why: SnapshotWhy): void {
    const c = this.city, model = this.region;
    if (!c?.host || c.crashed || !model || !this.persistent || !regionSaveAccess(model.data.id)) return;
    const st = this.currentState();
    if (!st) return;
    try {
      c.host.recovery?.writeNow(why);
      if (c.host.recovery && (why === 'beforeunload' || why === 'pagehide' || why === 'exit')) return;
      const fp = cityFingerprint(st);
      const lean = why === 'periodic';
      if (c.saving === 0 && fp === c.cleanFp && c.host?.changes === c.cleanChanges) return;
      if (fp === c.snapFp && c.host?.changes === c.snapChanges && (lean || !c.snapLean)) return;
      void c.host.snapshot(why).then((r) => {
        if (!r || this.city !== c) return;
        if (r.ok) {
          c.snapFp = r.fp;
          c.snapChanges = r.changes;
          c.snapLean = lean;
          c.lastSnap = r.marker.at;
        }
        this.lastSnapshot = { ok: r.ok, bytes: r.bytes, ls: r.ls, idb: r.idb, ms: r.ms, dropped: r.dropped, why };
      }).catch((e) => console.warn('[main] recovery snapshot failed', e));
    } catch (e) {
      console.warn('[main] recovery snapshot failed', e);
    }
  }

  /** indicator click: save now (through CityScene so its SavePill / sound confirm it) */
  private saveNow(): void {
    const c = this.city;
    if (!c || c.saving > 0 || !regionSaveAccess(this.region?.data.id)) return;
    const p = c.scene?.save ? c.scene.save(false) : this.saveCurrentCity();
    void p.catch((e) => showStorageError(e, { retry: () => this.saveCurrentCity() }));
  }

  private async saveCurrentCity(reason: SaveReason = 'manual', thumb?: string): Promise<void> {
    this.city?.scene?.storeCamera?.();
    await this.saveCityState(reason, thumb);
  }

  /** persist a city + refresh its region tile summary (also CityScene's onSave). Saves are queued, never overlap. */
  saveCityState(reason: SaveReason, thumb?: string): Promise<void> {
    const c = this.city, model = this.region;
    const run = this.saveChain.then(() => c && model && this.city === c && this.region === model ? this.doSaveCity(reason, thumb) : undefined);
    this.saveChain = run.catch(() => undefined);
    return run;
  }

  private async doSaveCity(reason: SaveReason, thumb?: string): Promise<void> {
    const model = this.region;
    const c = this.city;
    if (!model || !c?.host || c.crashed) return;
    const tile = c.tile;
    c.saving++;
    c.status?.set('saving');
    try {
      const saved = await withRegionSaveAccess(model.data.id, () => c.host!.save(reason));
      if (this.city !== c || this.region !== model) return;
      c.scene?.recordSaved?.();
      c.cleanFp = saved.fp;
      c.cleanChanges = saved.changes;
      c.saveFailed = false;
      c.lastSave = saved.savedAt;
      c.saveDay = this.currentState()?.day ?? c.saveDay;
      // this save made the city's recovery snapshots obsolete; the next one is a delta of it. A snapshot taken while
      // it was being written (newer, but a delta of the replaced save) is dropped too: take a fresh one soon.
      if (saved.recoveryDropped) c.lastSnap = 0;
      c.snapFp = '';
      c.snapChanges = -1;
      const prev = tile.city;
      tile.city = { ...saved.summary, founded: prev?.founded ?? saved.summary.founded, thumbnail: prev?.thumbnail };
    } catch (e) {
      c.saveFailed = true;
      throw e;
    } finally {
      c.saving--;
      if (this.city === c) this.tickSaveState();
    }
    const prevThumb = tile.city?.thumbnail;
    const newThumb = thumb ? await normalizeThumbnail(thumb, Math.min(512, tile.size * 128)) : undefined;
    if (tile.city) tile.city.thumbnail = newThumb ?? prevThumb ?? cityThumbnail(c.host.state, 256);
    await this.persistRegion();
  }

  /** `sister` (LG-12): the city was left through "Found a sister city": the founding follows once the region shows */
  async exitCity(thumb?: string, sister = false): Promise<void> {
    const c = this.city;
    const model = this.region;
    if (!c || !model) return;
    // LG-12: what the founding needs of the parent, read while its host still stands
    const parent = sister && c.host ? sisterParent(c.host.state, c.tile.key) : null;
    const ld = new LoadingScreen(this.root);
    ld.set('Saving city…', 0.3);
    await paint();
    try {
      await this.saveChain; // an autosave may still be writing
      if (regionSaveAccess(model.data.id) && !this.isDirty()) {
        // CityScene.exitToRegion just saved (onSave) and paused the sim: trust that save and only refresh the tile
        // thumbnail + region summary (no second city save)
        if (thumb && c.tile.city) c.tile.city.thumbnail = await normalizeThumbnail(thumb, Math.min(512, c.tile.size * 128));
        await this.persistRegion();
      } else if (regionSaveAccess(model.data.id)) await this.saveCurrentCity('exit', thumb);
    } catch (e) {
      console.error('[main] save on exit failed', e);
      ld.remove();
      void showStorageError(e, { retry: () => this.exitCity(thumb, sister) });
      return;
    }
    // the save failed: keep the progress as a recovery snapshot (offered when the city is opened again)
    if (this.isDirty()) this.snapshotNow('exit');
    setLastSession({ regionId: model.data.id });
    await this.closeCity(c);
    ld.set('Returning to the region…', 0.7);
    await this.showRegion(model, ld, c.tile.key);
    if (parent) await this.foundSister(c.tile, parent);
  }

  /** LG-12: "Found a sister city" (the pause menu, the built-out advice): the New City dialog on the best free tile next
   *  to the city just left, with its endowment. Nothing is charged or stored unless the player presses Found there */
  private async foundSister(from: RegionTile, parent: SisterParent): Promise<void> {
    const model = this.region;
    if (this.busy || !model) return;
    const plan = planSisterCity(model, from, parent);
    if (!plan) return toast(`No free land borders ${parent.name}: a sister city needs an unfounded tile next to it.`, 'bad', 5000);
    this.regionScreen?.selectTile(plan.to);
    const cfg = await this.storage.foundDialog(model, plan.to, plan);
    if (cfg) await this.startNewCity(model, plan.to, cfg, undefined, undefined, plan);
  }

  /** the city's scene, host and indicators go; nothing is saved here */
  private async closeCity(c: NonNullable<App['city']>): Promise<void> {
    clearInterval(c.ticker);
    c.status?.dispose();
    c.labels?.dispose();
    try {
      c.scene?.dispose();
      if (!c.scene) await c.host?.dispose();
    } catch (e) {
      console.warn('[main] CityScene.dispose failed', e);
    }
    this.root.querySelector('.city-host')?.remove();
    if (this.city === c) this.city = null;
    clearRecoveryBase();
    audio.stopAmbience();
  }

  // ------------------------------------------------------------------ W1.2: the simulation worker
  private useWorker(): boolean {
    return SIM_WORKER && !this.workerOff;
  }

  /** §4.1 step 1: prefetched, then spawned while the region screen shows; its hello waits for the host that boots on it */
  private prespawnWorker(): void {
    if (this.spareWorker) return;
    this.spareWorker = workerModules().then(async ([m, , { SIM_WORKER_URL }]) => {
      await this.prefetchWorkerScript(SIM_WORKER_URL);
      return m.browserSimWorker(SIM_WORKER_URL);
    }).catch((e) => {
      console.warn('[main] the simulation worker could not be pre-spawned', e);
      return null;
    });
  }
  /** O12: the worker's chunk into the HTTP cache, so the spawn does not wait for the network. Never rejects: a script
   *  that cannot load is the worker's own error event (R11). */
  private prefetchWorkerScript(url: string): Promise<void> {
    return this.workerScript ??= new Promise<void>((resolve) => {
      const link = document.createElement('link');
      if (link.relList?.supports?.('prefetch')) {
        link.rel = 'prefetch';
        link.href = url;
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => resolve(), { once: true });
        document.head.append(link);
      } else {
        // a Blob holds the bytes natively: no ArrayBuffer is made on the page
        fetch(url).then((r) => r.blob()).then(() => resolve(), () => resolve());
      }
    });
  }
  private async takeSpareWorker(): Promise<WorkerPort | undefined> {
    const spare = this.spareWorker;
    this.spareWorker = null;
    return (await spare) ?? undefined;
  }
  private dropSpareWorker(): void {
    const spare = this.spareWorker;
    this.spareWorker = null;
    void spare?.then((port) => port?.terminate());
  }

  /**
   * Boot the worker on the city's stored record, read without deserializing it (O6, R14), with the boot phases on the
   * loading screen. null when it does not boot (a script error, a version mismatch, a fatal message, 20 s without
   * progress): the caller then loads the city on the main thread, after one toast (§4.1 step 4).
   */
  private async bootWorker(model: RegionModel, tile: RegionTile, ld: LoadingScreen, replay = true): Promise<WorkerBoot | null> {
    const errors = new ErrorSink();
    let boot: WorkerBoot | null = null;
    try {
      const [[{ loadWorkerSimHost, browserSimWorker }, { pageSimWasmFlag }, { SIM_WORKER_URL }], spare] = await Promise.all([workerModules(), this.takeSpareWorker()]);
      ld.set('Starting the simulation…', 0.35);
      // quickstart and Continue enter without the region screen: the prefetch starts with the spawn
      const prefetched = this.prefetchWorkerScript(SIM_WORKER_URL);
      const port = spare ?? browserSimWorker(SIM_WORKER_URL);
      // entry is now: the hello deadline runs from the prefetch's end, or from PREFETCH_WAIT_MS hence at the latest
      let waited: ReturnType<typeof setTimeout> | undefined;
      const scriptLoaded = Promise.race([prefetched, new Promise<void>((r) => { waited = setTimeout(r, PREFETCH_WAIT_MS); })])
        .finally(() => clearTimeout(waited));
      const host = await loadWorkerSimHost(model.data.id, tile.key, {
        port, scriptLoaded, dev: SIM_WORKER_DEV, rctx: regionContext(model, tile), regionName: model.data.name, errors,
        // W1.3: the worker reads and writes its own IndexedDB; one whose IndexedDB falls back to memory is replaced by a
        // fresh worker with persistence 'main' (§4.1 step 3)
        respawn: () => browserSimWorker(SIM_WORKER_URL), replayJournal: replay,
        // paused until the scene knows from the replica whether the city is new (CityScene applies the speed)
        initialSpeed: 0,
        flags: { simwasm: pageSimWasmFlag() },
        onBoot: (phase, pct) => ld.set(BOOT_PHASES[phase] ?? 'Starting the simulation…', 0.35 + 0.3 * pct),
        // a boot failure rejects instead (the fallback below); a crash before the city is entered waits for it
        onCrash: (e, duringBoot) => {
          if (duringBoot || !boot) return;
          boot.crashed = e;
          void this.onWorkerCrash(boot.host, e);
        },
      });
      boot = { host, errors, crashed: null };
      return boot;
    } catch (e) {
      // a missing record is the local path's to report
      if ((e as Error)?.message === 'City record not found') return null;
      console.error('[main] the simulation worker did not start', e);
      toast('The simulation worker could not start: the city runs on the main thread.', 'bad', 5000);
      return null;
    }
  }

  /** §4.4: the worker crashed during play (fatal, onerror / messageerror, or 10 visible seconds without a packet). The
   *  host already wrote its recovery snapshot; the player picks what follows. */
  private async onWorkerCrash(host: WorkerSimHost, error: Error): Promise<void> {
    const c = this.city, model = this.region;
    if (!c || !model || c.host !== host || c.crashed || !c.entered) return;
    c.crashed = true;
    clearInterval(c.ticker);
    console.error('[main] the simulation worker crashed', error);
    const city = { regionId: model.data.id, tileKey: c.tile.key }, name = c.tile.city?.name ?? 'This city';
    const recoverable = this.persistent && (await hasRecoverySnapshot(city).catch(() => false));
    const choice = await openSimCrashDialog({ cityName: name, message: error.message, recoverable });
    if (this.city !== c) return;
    const ld = new LoadingScreen(this.root);
    ld.set('Restarting the simulation…', 0.2);
    await paint();
    // a city still being entered or saved holds `busy` for a moment
    for (let i = 0; this.busy && i < 600; i++) await new Promise((r) => setTimeout(r, 50));
    await this.closeCity(c);
    if (choice === 'local') this.workerOff = true;
    let replay = false;
    if (choice === 'recover') {
      // a snapshot that cannot be restored is reported and deleted: the last save is what remains
      const pending = await findRecoverySnapshot(city).catch(() => null);
      const restored: RecoverChoice = pending ? await this.restoreRecovery(pending) : 'none';
      // T089 (W1.3 decision 20): only a restore that succeeded is followed by a replay. One that left the recovery copy
      // stored (a full store, a region now open in another tab, a copy that could not be read) opens no city over it,
      // as the recovery gate opens none: that city's own snapshots and journal would replace the copy
      replay = restored === 'recovered';
      if (!replay && (await hasRecoverySnapshot(city).catch(() => false))) {
        // NOTE-092: the region then says why nothing was recovered, and that the copy is kept (the city's Play asks
        // about it again). A snapshot that could not be restored ('failed') was reported by restoreRecovery
        const why = restored === 'failed' ? null
          : !regionSaveAccess(city.regionId) ? 'this region is now open in another tab. Its recovery copy is kept.'
          : restored === 'none' ? 'its recovery copy could not be read. The copy is kept. Free some browser storage, then play the city to try again.'
          : "your browser's storage for Metropolis is full. Its recovery copy is kept. Free some browser storage, then play the city to recover it.";
        ld.set('Returning to the region…', 0.7);
        await this.showRegion(model, ld, c.tile.key);
        if (why) toast(`${name} was not recovered: ${why}`, 'bad', 9000);
        return;
      }
    } else {
      // T089 (NOTE-080, the owner's choice): Restart and Continue on the main thread discard the crashed session's
      // recovery copy (the worker's snapshot, the journal, the localStorage slot), as the dialog says: no later crash
      // or start can bring that session back
      await discardRecoverySnapshot(city);
    }
    // the player has chosen: no second recovery offer (a loading screen handed over skips it). W1.3: only Recover
    // replays the journal; Restart and Continue on the main thread load the save as it is
    await this.playCity(c.tile, ld, replay);
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
    const { data, model } = createRegionData({ seed, preset: PRESET_BY_ID[preset] ? preset : 'greenvale', id });
    if (!(await this.storage.reset(data))) { ld.remove(); return; }
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
    const tile = model.pickNiceTile(2);
    await this.showRegion(model, ld, tile.key, false);
    const p = this.storage.foundDialog(model, tile);
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
    const { data, model } = createRegionData({ seed, preset: 'greenvale', id: 'quickstart', name: 'Quickstart Valley' });
    if (!(await this.storage.reset(data))) { ld.remove(); return; }
    this.region = model;
    const tile = model.pickNiceTile(size);
    const partial: Partial<CityConfigData> = { name: randomCityName(), mayor: randomMayorName() };
    const terrain = q.get('terrain') as TerrainPreset | null;
    if (terrain && terrain !== 'region') partial.terrain = terrain;
    const diff = q.get('difficulty') as Difficulty | null;
    if (diff) partial.difficulty = diff;
    const climate = q.get('climate') as Climate | null;
    if (climate) partial.climate = climate;
    const cfg = model.cityConfigFor(tile, partial);
    if (diff) cfg.startFunds = ({ easy: 250_000, medium: 100_000, hard: 40_000, expert: 40_000, sandbox: 10_000_000 } as const)[diff] ?? cfg.startFunds;
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

const host = document.getElementById('app') ?? document.body;
const app = new App(host);
(window as unknown as { __metropolis: App; __audio: typeof audio }).__metropolis = app;
(window as unknown as { __audio: typeof audio }).__audio = audio;
void app.boot();
