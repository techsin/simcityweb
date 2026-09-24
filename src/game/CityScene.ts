/**
 * CityScene — the in-city game screen: canvas + HUD, Simulation, CityActions, WorldView, CityObjectsView, tools,
 * main loop, autosave, keyboard, settings. Constructed by the meta layer (src/main.ts):
 *
 *   const scene = new CityScene({ container, state, onExitToRegion, onSave, settings });
 *   scene.start();   ...   scene.dispose();
 *
 * Degrades gracefully: missing / throwing modules (renderers, actions, systems) are replaced by stand-ins and
 * reported in an error overlay; the UI keeps working.
 */
import '../ui/theme.css';
import '../ui/hud.css';
import { Emitter } from '../core/events';
import { CELL_SIZE } from '../core/constants';
import { Overlay } from '../core/types';
import type { CityObjectsViewApi, WorldViewApi } from '../render/contracts';
import type { CityActionsApi } from '../sim/actions';
import type { CityState } from '../sim/CityState';
import { Simulation, type SimSystem } from '../sim/Simulation';
import type { GameContext, QueryTarget, SoundOpts, UIEvents } from './context';
import { ActionsProxy } from './ActionsProxy';
import { FallbackActions } from './fallback/FallbackActions';
import { FallbackObjectsView } from './fallback/FallbackObjectsView';
import { FallbackWorldView } from './fallback/FallbackWorldView';
import { NullObjectsView, NullWorldView } from './fallback/NullViews';
import { loadGameModules, type GameModules } from './modules';
import { loadSettings, saveSettings, type GameSettings } from './settings';
import { NewYearCelebration, type CelebrateOptions } from './NewYear';
import { GameSounds } from './GameSounds';
import { HOTKEY_CYCLES, PANEL_HOTKEYS } from './toolCatalog';
import { ToolController } from './tools/ToolController';
import { CursorTip } from '../ui/CursorTip';
import { h, isTyping } from '../ui/dom';
import { MiniMap } from '../ui/MiniMap';
import { ErrorOverlay, HelpPanel, PauseMenu, SavePill, confirmOpen } from '../ui/Modals';
import { applyCamera, bestBuildableCell, readCamera, validCamera } from './cameraStart';
import { NewsTicker, Toasts } from '../ui/Notifications';
import { Onboarding } from '../ui/Onboarding';
import { PanelManager } from '../ui/Panel';
import { AdvisorsPanel } from '../ui/panels/AdvisorsPanel';
import { BudgetPanel } from '../ui/panels/BudgetPanel';
import { DataViewsPanel, LegendChip } from '../ui/panels/DataViewsPanel';
import { GraphsPanel } from '../ui/panels/GraphsPanel';
import { InfoPanel } from '../ui/panels/InfoPanel';
import { OrdinancesPanel, RewardsPanel } from '../ui/panels/ListPanels';
import { SettingsPanel } from '../ui/panels/SettingsPanel';
import { StatsPanel } from '../ui/panels/StatsPanel';
import { Toolbar } from '../ui/Toolbar';
import { TopBar } from '../ui/TopBar';
import { computeUiZoom, setUiZoom } from '../ui/zoom';
import { installUiSounds, type UiSoundAudio } from '../ui/uiSounds';
import { asMusicAudio, shortMood, watchTrackChanges } from '../ui/MusicPlayer';
import { EmergencyBanner } from '../ui/EmergencyBanner';
import { EmergenciesPanel } from '../ui/panels/EmergenciesPanel';
import { Sirens, type SirenOut, type SirenSource } from '../audio/sirens';
import type { EmergencyVehicles } from '../render/city/vehicles/EmergencyVehicles';
import type { EmergencySystem } from '../sim/infra/emergency';

export type { GameSettings } from './settings';

export interface CitySceneOptions {
  container: HTMLElement;
  state: CityState;
  onExitToRegion: (thumbnailDataUrl?: string) => void;
  onSave: (state: CityState) => Promise<void>;
  /** initial settings (e.g. the app-level settings); keys given here win over the stored in-game prefs */
  settings?: Partial<GameSettings>;
  /** called whenever the player changes a setting in-game (the passed `settings` object is also updated in place) */
  onSettingsChange?: (settings: GameSettings) => void;
  /** dev/testing: force the stand-in views ('world' | 'objects' | 'all') */
  forceFallback?: 'world' | 'objects' | 'all';
  /** dev/testing: initial simulation speed (default 1) */
  initialSpeed?: number;
}

type ActionsCtor = new (sim: Simulation) => CityActionsApi;

/** keys the camera controller binds that we also use (we stop propagation only when we act on them) */
const CAMERA_KEYS = new Set(['r', 'f']);

/**
 * Sim systems and CityActions are imported lazily: they are large, actively developed module graphs and a broken
 * import there must not take down the whole city screen (the UI keeps working with stand-ins).
 */
const SIM_MODULES = import.meta.glob(['../sim/systems/index.ts', '../sim/actions.ts']);

/** UI sound aliases -> audio engine sound names (src/audio/sfx.ts; any other name is passed through) */
const SOUND_MAP: Record<string, string> = {
  build: 'road', powerline: 'power', subway: 'rail', select: 'query', trees: 'tree', money: 'cash', disaster: 'alarm',
};

/** game-action sounds that follow the cursor's screen x (stereo) */
const SPATIAL = new Set(['road', 'rail', 'power', 'pipe', 'zone', 'dezone', 'bulldoze', 'plop', 'terraform', 'tree', 'construct', 'error', 'rotate', 'query']);

export class CityScene {
  readonly sim: Simulation;
  readonly actions: CityActionsApi;
  readonly ctx: GameContext;
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private uiRoot: HTMLDivElement;
  private opts: CitySceneOptions;
  private settings: GameSettings;
  private uiEvents = new Emitter<UIEvents>();
  private world: WorldViewApi = new NullWorldView();
  private objects: CityObjectsViewApi = new NullObjectsView();
  private mods: GameModules = { errors: [] };
  private tools: ToolController;
  private panels: PanelManager;
  private topBar: TopBar;
  private toolbar: Toolbar;
  private minimap: MiniMap;
  private ticker: NewsTicker;
  private toasts: Toasts;
  private onboarding: Onboarding;
  private errors: ErrorOverlay;
  private pause: PauseMenu;
  private savePill: SavePill;
  private info: InfoPanel;
  private newYear: NewYearCelebration;
  private gameSounds: GameSounds;
  private offUiSounds: () => void;
  private advisors: AdvisorsPanel;
  /** WP8: emergency alert banners (LIVE speed policy) and siren voices */
  private emgBanner: EmergencyBanner;
  private sirens: Sirens | null = null;
  private sirenSrc: { x: number; y: number; z: number; responder: string }[] = [];
  private tip: CursorTip;
  private fpsEl: HTMLDivElement;
  private veil: HTMLDivElement;
  private raf = 0;
  private last = 0;
  private uiAcc = 0;
  private slowAcc = 0;
  private ambAcc = 0;
  private started = false;
  private disposed = false;
  private resolveReady!: () => void;
  /** resolves once the views are up (real or stand-in views constructed and the first frame rendered) */
  readonly ready: Promise<void> = new Promise<void>((res) => (this.resolveReady = res));
  private readyPending = false;
  private offs: (() => void)[] = [];
  private monthsSinceSave = 0;
  private saving: Promise<void> | null = null;
  private hiddenPausedFrom: number | null = null;
  private mouse = { x: -1, y: -1, inside: false };
  /** fps readout, measured with the real (unclamped) frame delta from performance.now() — the sim dt is clamped */
  private fps = { frames: 0, t: 0, value: 0, last: 0 };
  private renderFailures = 0;
  private degraded = { world: false, objects: false, actions: false };
  private resizeObs: ResizeObserver | null = null;
  private actionsProxy: ActionsProxy;
  private simReady = false;
  private abort = new AbortController();
  /** founded just now (day 0, never saved with a camera): starts paused, camera on the best buildable land */
  private readonly newCity: boolean;

  constructor(opts: CitySceneOptions) {
    this.opts = opts;
    this.settings = loadSettings(opts.settings);
    const state = opts.state;

    // ---- DOM
    this.root = h('div', { class: 'mp-scene' });
    this.canvas = h('canvas', { class: 'mp-canvas', tabindex: '0' });
    this.uiRoot = h('div', { class: 'mp-ui' });
    this.veil = h('div', { class: 'loading-veil' }, h('div', { class: 'spin' }), h('div', null, 'Loading city…'));
    this.root.append(this.canvas, this.uiRoot, this.veil);
    opts.container.appendChild(this.root);
    this.errors = new ErrorOverlay(this.uiRoot, { pause: () => (this.sim.speed = 0) });

    // ---- simulation: systems are attached in loadSim() (guarded so one broken system can't take the game down)
    this.sim = new Simulation(state, []);
    // a brand-new city starts PAUSED (build first, then press play); saved cities keep running at normal speed
    this.newCity = state.day === 0 && !validCamera(state.systemData.camera, state);
    if (opts.initialSpeed !== undefined) this.sim.speed = opts.initialSpeed;
    else if (this.newCity) this.sim.speed = 0;

    // ---- actions: stand-in until sim-core's CityActions has loaded (see loadSim)
    this.actionsProxy = new ActionsProxy(new FallbackActions(this.sim));
    this.degraded.actions = true;
    this.actions = this.actionsProxy;

    // ---- context
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.tip = new CursorTip(this.uiRoot);
    const ctx: GameContext = {
      get state() {
        return self.sim.state;
      },
      sim: this.sim,
      actions: this.actions,
      get world() {
        return self.world;
      },
      set world(v) {
        self.world = v;
      },
      get objects() {
        return self.objects;
      },
      set objects(v) {
        self.objects = v;
      },
      canvas: this.canvas,
      root: this.uiRoot,
      get settings() {
        return self.settings;
      },
      set settings(v) {
        self.settings = v;
      },
      get mods() {
        return self.mods;
      },
      set mods(v) {
        self.mods = v;
      },
      ui: this.uiEvents,
      signal: this.abort.signal,
      tools: null as unknown as ToolController,
      panels: null as unknown as PanelManager,
      tip: this.tip,
      overlay: Overlay.None,
      degraded: this.degraded,
      setOverlay: (o) => this.setOverlay(o),
      sound: (n, o) => this.sound(n, o),
      focusCell: (x, z, d) => this.focusCell(x, z, d),
      showQuery: (t) => this.showQuery(t),
      applySettings: (p) => this.applySettings(p),
      toast: (text, kind, cell, title) => this.toasts?.show(text, kind, cell, title),
      openFlyout: (id, tab) => this.toolbar?.openFlyout(id, tab),
      showOnboarding: () => this.onboarding?.show(),
      save: () => this.save(false),
      exitToRegion: () => this.exitToRegion(),
      openPauseMenu: () => this.pause.open(),
      sandbox: () => !!this.sim.state.config.sandbox || this.sim.state.config.difficulty === 'sandbox',
    };
    this.ctx = ctx;
    this.tools = new ToolController(ctx, this.canvas);
    ctx.tools = this.tools;
    const panelLayer = h('div', { class: 'panel-layer' });
    this.uiRoot.appendChild(panelLayer);
    this.panels = new PanelManager(ctx, panelLayer);
    ctx.panels = this.panels;

    // ---- HUD
    this.topBar = new TopBar(ctx, this.uiRoot);
    const bl = h('div', { class: 'hud-bl' });
    this.uiRoot.appendChild(bl);
    new LegendChip(ctx, bl);
    this.ticker = new NewsTicker(ctx, bl);
    this.toolbar = new Toolbar(ctx, this.uiRoot);
    this.minimap = new MiniMap(ctx, this.uiRoot);
    const tl = h('div', { class: 'hud-tl' });
    this.uiRoot.appendChild(tl);
    this.toasts = new Toasts(ctx, tl);
    this.onboarding = new Onboarding(ctx, tl, {
      coach: (cats, play) => {
        this.toolbar.setCoach(cats);
        this.topBar.setCoachPlay(play);
      },
    });
    this.savePill = new SavePill(this.uiRoot);
    // New Year fireworks (src/game/NewYear.ts): listens to the sim's 'year' event itself
    this.newYear = new NewYearCelebration({
      sim: this.sim,
      world: () => this.world,
      objects: () => this.objects,
      settings: () => this.settings,
      toast: (text, kind, cell, title) => this.toasts.show(text, kind, cell, title),
      sound: (n) => this.sound(n),
      audio: () => this.mods.audio,
      overlayRoot: this.uiRoot,
    });
    // event-driven sounds (news, disasters, rewards, budget ticks, construction) + generic control feedback
    this.gameSounds = new GameSounds({ sim: this.sim, sound: (n, o) => this.sound(n, o), world: () => this.world, sandbox: () => ctx.sandbox() });
    this.offUiSounds = installUiSounds(() => this.mods.audio as unknown as UiSoundAudio | undefined);
    this.fpsEl = h('div', { class: 'fps mp-glass', style: 'display:none' });
    this.uiRoot.appendChild(this.fpsEl);
    this.info = new InfoPanel(ctx);
    this.advisors = new AdvisorsPanel(ctx);
    for (const p of [new BudgetPanel(ctx), new GraphsPanel(ctx), new StatsPanel(ctx), this.advisors, new OrdinancesPanel(ctx), new RewardsPanel(ctx), new SettingsPanel(ctx), new DataViewsPanel(ctx), this.info, new HelpPanel(ctx)]) this.panels.register(p);
    this.panels.register(new EmergenciesPanel(ctx));
    this.emgBanner = new EmergencyBanner(ctx, this.uiRoot);
    this.pause = new PauseMenu(ctx, this.uiRoot, { onSettings: () => this.panels.open('settings'), onHelp: () => this.panels.open('help') });

    // ---- events
    const on = <K extends keyof WindowEventMap>(t: Window | Document, k: K, f: (e: WindowEventMap[K]) => void) => {
      t.addEventListener(k, f as EventListener);
      this.offs.push(() => t.removeEventListener(k, f as EventListener));
    };
    // capture phase: runs before the camera controller so keys we act on that it also binds (R = tilt) can be consumed
    const kd = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', kd, true);
    this.offs.push(() => window.removeEventListener('keydown', kd, true));
    on(window, 'keyup', (e) => {
      if (!isTyping(e)) this.tools.key(e);
    });
    const vis = () => this.onVisibility();
    document.addEventListener('visibilitychange', vis);
    this.offs.push(() => document.removeEventListener('visibilitychange', vis));
    on(window, 'pointermove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.inside = true;
    });
    this.root.addEventListener('pointerleave', () => (this.mouse.inside = false));
    this.offs.push(
      this.sim.events.on('month', () => this.onMonth()),
      this.sim.events.on('disaster', (d) => {
        if (d.active && d.kind === 'earthquake') this.quakeEventAt = performance.now();
      }),
      this.sim.events.on('unlocked', () => this.topBar.setBadge('rewards', 1)),
      this.uiEvents.on('panel', ({ id, open }) => {
        if (id === 'rewards' && open) this.topBar.setBadge('rewards', 0);
      }),
    );
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(this.root);
    } else on(window, 'resize', () => this.resize());
    this.resize();
    this.applySettings({});
  }

  // ------------------------------------------------------------------------------------------------ lifecycle
  /** same as `ready` (for callers that prefer a method) */
  whenReady(): Promise<void> {
    return this.ready;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    this.initViews().catch((e) => {
      this.errors.report('Starting the city view failed', e);
      this.veil.classList.add('gone');
      this.resolveReady();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resolveReady(); // never leave awaiters hanging
    this.abort.abort();
    for (const f of this.offs) f();
    this.resizeObs?.disconnect();
    try {
      (this.mods.audio as { stopAmbience?: () => void } | undefined)?.stopAmbience?.();
    } catch {
      /* ignore */
    }
    this.newYear.dispose();
    this.sirens?.dispose();
    this.emgBanner.dispose();
    this.gameSounds.dispose();
    this.offUiSounds();
    this.tools.dispose();
    this.minimap.dispose();
    try {
      this.objects.dispose();
    } catch (e) {
      console.warn(e);
    }
    try {
      this.world.dispose();
    } catch (e) {
      console.warn(e);
    }
    this.uiEvents.clear();
    this.root.remove();
  }

  /** the loaded optional modules (rewards, ordinances, audio, ...) */
  get modules(): GameModules {
    return this.mods;
  }

  /** attach sim-core / sim-infra systems and the real CityActions (lazily imported, guarded) */
  private async loadSim(): Promise<void> {
    const [sysMod, actMod] = await Promise.all([
      SIM_MODULES['../sim/systems/index.ts']?.().catch((e: unknown) => {
        this.errors.report('Simulation systems failed to load — the city will not grow', e, { sim: true });
        return null;
      }),
      SIM_MODULES['../sim/actions.ts']?.().catch((e: unknown) => {
        this.errors.report('City actions failed to load — using stand-in actions', e);
        return null;
      }),
    ]) as [{ createSystems?: () => SimSystem[] } | null | undefined, { CityActions?: ActionsCtor } | null | undefined];
    if (this.disposed) return;
    let systems: SimSystem[] = [];
    try {
      systems = sysMod?.createSystems?.() ?? [];
    } catch (e) {
      this.errors.report('Simulation systems failed to start', e, { sim: true });
    }
    for (const s of systems) {
      this.guardSystem(s);
      this.sim.systems.push(s);
    }
    for (const s of systems) s.init?.(this.sim);
    const Ctor = actMod?.CityActions;
    if (typeof Ctor === 'function') {
      try {
        this.actionsProxy.target = new Ctor(this.sim);
        this.degraded.actions = false;
      } catch (e) {
        this.errors.report('CityActions failed to construct — using stand-in actions', e);
      }
    }
    this.simReady = true;
  }

  private async initViews(): Promise<void> {
    await this.loadSim();
    try {
      this.mods = await loadGameModules();
    } catch (e) {
      this.errors.report('Failed to load game modules', e);
    }
    if (this.disposed) return;
    this.syncVolumesFromAudio();
    this.watchNowPlaying();
    try {
      (this.mods.audio as { startAmbience?: () => void } | undefined)?.startAmbience?.();
    } catch {
      /* ignore */
    }
    const state = this.sim.state;
    const events = this.sim.events;
    const force = this.opts.forceFallback;
    // ---- world
    let world: WorldViewApi | null = null;
    if (this.mods.WorldView && force !== 'world' && force !== 'all') {
      try {
        world = new this.mods.WorldView(this.canvas, state, events, { quality: this.settings.quality });
      } catch (e) {
        this.errors.report('3D world view failed to start — using a simplified view', e);
        this.swapCanvas();
      }
    }
    if (!world) {
      try {
        world = new FallbackWorldView(this.canvas, state, events, { quality: this.settings.quality });
        this.degraded.world = true;
      } catch (e) {
        this.errors.report('WebGL is not available — the 3D view is disabled', e, { fatal: false });
        world = new NullWorldView();
      }
    }
    this.world = world;
    this.hookCameraSounds(world);
    // ---- objects
    const traffic = () => this.sim.getSystem<SimSystem & { getSampleRoutes?: (max: number) => unknown }>('traffic');
    const getTrafficRoutes = (max: number) => {
      try {
        return traffic()?.getSampleRoutes?.(max) ?? [];
      } catch {
        return [];
      }
    };
    let objects: CityObjectsViewApi | null = null;
    const hasScene = !(world as NullWorldView).isNull;
    if (hasScene && this.mods.CityObjectsView && force !== 'objects' && force !== 'all') {
      try {
        const emergency = () => this.sim.getSystem<EmergencySystem>('emergency');
        const getEmergency = { vehicles: () => emergency()?.vehicles() ?? [], incidents: () => emergency()?.incidents() ?? [], time: () => this.sim.simTime() };
        const octx = { scene: world.scene, camera: world.camera, renderer: world.renderer, canvas: this.canvas, getTrafficRoutes, getState: () => this.sim.state, quality: this.settings.quality, getEmergency };
        objects = new this.mods.CityObjectsView(state, events, octx);
      } catch (e) {
        this.errors.report('City objects view failed to start — using simplified buildings', e);
      }
    }
    if (!objects && hasScene) {
      try {
        objects = new FallbackObjectsView(state, events, { scene: world.scene, camera: world.camera, renderer: world.renderer, canvas: this.canvas });
        this.degraded.objects = true;
      } catch (e) {
        this.errors.report('City objects view unavailable', e);
      }
    }
    this.objects = objects ?? new NullObjectsView();
    this.resize();
    this.applySettings({});
    this.placeInitialCamera();
    if (this.mods.errors.length) console.warn('[game] module load issues', this.mods.errors);
    this.showDevBadge();
    this.uiEvents.emit('viewsReady', undefined);
    this.readyPending = true; // resolved after the next rendered frame (see loop)
    this.veil.classList.add('gone');
    setTimeout(() => this.veil.remove(), 600);
  }

  /**
   * Saved city: restore the last camera (state.systemData.camera). New city (or an old save without one): look at the
   * best buildable land — the largest flat dry area near the centre / a neighbour connection — not the map centre.
   */
  private placeInitialCamera(): void {
    const st = this.sim.state;
    const c = this.world.controls;
    if (!c) return;
    try {
      const saved = validCamera(st.systemData.camera, st);
      if (saved) {
        applyCamera(c, saved);
        return;
      }
      let cell = bestBuildableCell(st);
      if (st.buildings.size) {
        // an older save without a stored camera: centre on the city itself
        let sx = 0, sz = 0, n = 0;
        for (const b of st.buildings.values()) {
          sx += b.x + b.w / 2;
          sz += b.z + b.d / 2;
          n++;
        }
        cell = { x: Math.floor(sx / n), z: Math.floor(sz / n) };
      }
      applyCamera(c, { x: (cell.x + 0.5) * CELL_SIZE, z: (cell.z + 0.5) * CELL_SIZE, distance: c.distance || 900 });
    } catch (e) {
      console.warn('[game] initial camera', e);
      try {
        c.focusOn((st.size / 2) * CELL_SIZE, (st.size / 2) * CELL_SIZE);
      } catch {
        /* ignore */
      }
    }
  }

  /** remember the view in the save (state.systemData.camera) */
  private storeCamera(): void {
    try {
      const cam = readCamera(this.world.controls);
      if (cam) this.sim.state.systemData.camera = cam;
    } catch {
      /* ignore */
    }
  }

  /** soft whoosh on every 90° camera rotate step (Q / E, minimap buttons), panned in the turn direction */
  private hookCameraSounds(world: WorldViewApi): void {
    try {
      const c = world.controls as { rotateStep?: (dir: 1 | -1) => void } | undefined;
      if (!c || typeof c.rotateStep !== 'function') return;
      const orig = c.rotateStep.bind(c);
      c.rotateStep = (dir: 1 | -1) => {
        orig(dir);
        this.sound('camRotate', { pan: dir * 0.35 });
      };
    } catch {
      /* ignore */
    }
  }

  /** replace the canvas (a failed renderer may have grabbed an incompatible context) */
  private swapCanvas(): void {
    const fresh = h('canvas', { class: 'mp-canvas', tabindex: '0' });
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    (this.ctx as { canvas: HTMLCanvasElement }).canvas = fresh;
    this.tools.attach(fresh);
  }

  private showDevBadge(): void {
    const parts = [this.degraded.world && 'world view', this.degraded.objects && 'city objects', this.degraded.actions && 'actions'].filter(Boolean);
    if (!parts.length) return;
    const b = h('div', { class: 'dev-badge mp-glass', title: `Stand-ins active for: ${parts.join(', ')}. ${this.mods.errors.join(' | ')}` }, 'DEV · stand-in ' + parts.join(', '));
    b.addEventListener('click', () => b.remove());
    this.uiRoot.appendChild(b);
  }

  private guardSystem(s: SimSystem): void {
    const methods = ['init', 'daily', 'monthly', 'yearly', 'frame'] as const;
    for (const m of methods) {
      const f = s[m] as ((...a: unknown[]) => void) | undefined;
      if (typeof f !== 'function') continue;
      let errors = 0;
      const report = (e: unknown) => {
        errors++;
        this.errors?.report(`Simulation system “${s.name}” failed (${m})${errors > 20 ? ' — disabled' : ''}`, e, { key: `sys:${s.name}:${m}`, sim: true });
      };
      (s as unknown as Record<string, unknown>)[m] = function (this: unknown, ...args: unknown[]) {
        if (errors > 20) return;
        try {
          return f.apply(this, args);
        } catch (e) {
          report(e);
        }
      };
    }
  }

  // ------------------------------------------------------------------------------------------------ main loop
  private loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    try {
      this.tools.frame(dt);
    } catch (e) {
      this.errors.report('Tool error', e);
    }
    try {
      if (this.simReady) this.sim.update(dt);
    } catch (e) {
      this.errors.report('Simulation error', e, { sim: true, key: 'sim.update' });
    }
    this.edgeScroll(dt);
    try {
      this.newYear.frame(dt);
    } catch (e) {
      this.errors.report('New Year celebration error', e, { key: 'newyear' });
    }
    try {
      this.world.update(dt);
      this.objects.update(dt);
      this.feedShake(dt);
      this.world.render();
      this.renderFailures = 0;
    } catch (e) {
      this.renderFailures++;
      this.errors.report('Rendering error', e, { key: 'render' });
    }
    if (this.readyPending) {
      this.readyPending = false;
      this.resolveReady();
    }
    this.minimap.frame(dt);
    this.ticker.frame(dt);
    this.onboarding.frame(dt);
    // UI ticks (~6 Hz)
    this.uiAcc += dt;
    if (this.uiAcc > 0.16) {
      this.uiAcc = 0;
      try {
        this.topBar.update();
        this.panels.tick();
        this.uiEvents.emit('uiTick', undefined);
      } catch (e) {
        this.errors.report('Interface error', e, { key: 'ui' });
      }
    }
    this.slowAcc += dt;
    this.ambAcc += dt;
    if (this.ambAcc > 0.5) {
      this.ambAcc = 0;
      this.updateAmbience();
    }
    if (this.slowAcc > 2) {
      this.slowAcc = 0;
      this.topBar.setBadge('advisors', this.panels.isOpen('advisors') ? 0 : this.advisors.alertCount());
      // keep the view in state.systemData.camera so every save path (autosave, tab hide, exit) restores it
      if (!this.readyPending && this.simReady) this.storeCamera();
    }
    // fps (real wall-clock delta: the clamped dt above would cap the readout at >= 10 fps)
    const tNow = performance.now();
    if (this.fps.last > 0) {
      this.fps.frames++;
      this.fps.t += Math.max(0, (tNow - this.fps.last) / 1000);
    }
    this.fps.last = tNow;
    if (this.fps.t >= 0.5) {
      this.fps.value = this.fps.frames / this.fps.t;
      this.fps.frames = 0;
      this.fps.t = 0;
      if (this.settings.showFps) this.updatePerf();
    }
  };

  /** QA readout: fps + frame time, world / city draw calls and triangles (world.stats, objects.stats()) */
  private updatePerf(): void {
    // (no clamping: below 10 fps show a decimal, and the real mean frame time — seconds once it passes 1 s)
    const f = this.fps.value, frameMs = f > 0 ? 1000 / f : 0;
    const lines: string[] = [`<b>${f >= 10 ? Math.round(f) : f.toFixed(1)} fps</b> · ${frameMs >= 1000 ? (frameMs / 1000).toFixed(1) + ' s' : frameMs.toFixed(1) + ' ms'}`];
    const k = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
    try {
      const ws = (this.world as { stats?: { calls?: number; triangles?: number; trees?: number; frameMs?: number } }).stats;
      const info = this.world.renderer?.info?.render;
      const calls = ws?.calls ?? info?.calls, tris = ws?.triangles ?? info?.triangles;
      if (calls !== undefined) lines.push(`world ${k(calls)} calls · ${k(tris ?? 0)} tris${ws?.trees !== undefined ? ` · ${k(ws.trees)} trees` : ''}${ws?.frameMs !== undefined ? ` · ${ws.frameMs.toFixed(1)} ms` : ''}`);
    } catch {
      /* ignore */
    }
    try {
      const os = (this.objects as { stats?: () => Record<string, number> }).stats?.();
      if (os) {
        lines.push(`city ${k(os.drawCalls ?? 0)} calls · ${k(os.roadTriangles ?? 0)} road tris · ${(os.updateMs ?? 0).toFixed(1)} ms`);
        lines.push(`${k(os.buildings ?? 0)} bldg · ${k(os.vehicles ?? 0)} veh · ${k(os.trains ?? 0)} trains · ${k(os.particles ?? 0)} fx · ${k(os.props ?? 0)} props`);
      }
    } catch {
      /* ignore */
    }
    const st = this.sim.state;
    lines.push(`sim day ${st.day} · ${st.buildings.size} buildings · speed ${this.sim.speed}`);
    this.fpsEl.innerHTML = lines.join('<br>');
  }

  /**
   * Earthquake camera shake: render-world auto-shakes for ~3 s when an earthquake starts; for longer quakes keep
   * the camera moving from render-city's disaster intensity (objects.disasters.shake, 0..1).
   */
  private feedShake(_dt: number): void {
    const w = this.world as { shake?: (intensity: number, seconds: number) => void };
    const k = (this.objects as { disasters?: { shake?: number } }).disasters?.shake ?? 0;
    if (typeof w.shake !== 'function' || !(k > 0.05)) return;
    const now = performance.now();
    if (now < this.shakeNext) return;
    // render-world shakes for ~3 s on its own when the earthquake starts
    const sinceEvent = now - this.quakeEventAt;
    if (sinceEvent < 2400) {
      this.shakeNext = this.quakeEventAt + 2400;
      return;
    }
    w.shake(0.45 + 0.55 * Math.min(1, k), 1.6);
    this.shakeNext = now + 1200;
  }
  private shakeNext = 0;
  private quakeEventAt = -1e9;

  private edgeScroll(dt: number): void {
    if (!this.settings.edgeScroll || !this.mouse.inside || document.hidden || this.pause.isOpen) return;
    const c = this.world.controls as unknown as Record<string, unknown>;
    if ('edgeScroll' in c) return; // controller implements it itself
    const r = this.root.getBoundingClientRect();
    const m = 14;
    let ax = 0, az = 0;
    if (this.mouse.x - r.left < m) ax = -1;
    else if (r.right - this.mouse.x < m) ax = 1;
    if (this.mouse.y - r.top < m) az = 1;
    else if (r.bottom - this.mouse.y < m) az = -1;
    if (!ax && !az) return;
    const cam = this.world.camera, t = this.world.controls.target;
    const fx = t.x - cam.position.x, fz = t.z - cam.position.z;
    const len = Math.hypot(fx, fz) || 1;
    const f = { x: fx / len, z: fz / len };
    const rt = { x: -f.z, z: f.x };
    const sp = (this.world.controls.distance || 600) * 0.9 * dt;
    const nx = t.x + (rt.x * ax + f.x * az) * sp, nz = t.z + (rt.z * ax + f.z * az) * sp;
    const M = this.sim.state.size * CELL_SIZE;
    try {
      this.world.controls.focusOn(Math.max(0, Math.min(M, nx)), Math.max(0, Math.min(M, nz)));
    } catch {
      /* ignore */
    }
  }

  private resize(): void {
    const w = Math.max(1, this.root.clientWidth), hh = Math.max(1, this.root.clientHeight);
    try {
      this.world.resize(w, hh);
    } catch (e) {
      console.warn('[game] resize failed', e);
    }
    const z = computeUiZoom(w, hh, this.settings.uiScale);
    setUiZoom(z);
    this.uiRoot.style.setProperty('--ui-zoom', String(z));
    const layoutW = w / z;
    this.uiRoot.classList.toggle('narrow', layoutW < 1500);
    this.uiRoot.classList.toggle('xnarrow', layoutW < 1380);
    // short screens (1280×720, 1366×768 laptops, or a big UI scale leaving < 920 css px of height): compact toasts
    // (max 3), onboarding / data-view layouts (hud.css .short)
    this.uiRoot.classList.toggle('short', hh <= 800 || hh / z <= 920);
    this.panels?.clampAll();
  }

  // ------------------------------------------------------------------------------------------------ input
  private onKey(e: KeyboardEvent): void {
    if (isTyping(e) || this.disposed) return;
    // a confirmation dialog handles Enter / Esc itself; no hotkeys underneath it
    if (confirmOpen()) return;
    if (this.pause.isOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.pause.close();
      }
      return;
    }
    if (this.tools.key(e)) {
      this.consume(e);
      return;
    }
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      if (this.tools.cancelDrag()) {
        this.sound('cancel');
        return;
      }
      if (this.toolbar.flyoutOpen) {
        this.sound('flyoutClose');
        return this.toolbar.closeFlyout();
      }
      if (this.topBar.closePopover()) return;
      if (this.panels.closeTop()) return;
      if (this.tools.activeId) {
        this.tools.select(null);
        return;
      }
      this.pause.open();
      return;
    }
    if (k === 'F1' || k === '?') {
      e.preventDefault();
      this.panels.toggle('help');
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (k.toLowerCase() === 's') {
        e.preventDefault();
        void this.save(false);
      }
      return;
    }
    if (e.altKey || e.repeat) return;
    if (k === ' ') {
      e.preventDefault();
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      this.sim.speed = this.sim.speed === 0 ? this.lastSpeed || 1 : 0;
      if (this.sim.speed) this.lastSpeed = this.sim.speed;
      this.sound(this.sim.speed === 0 ? 'pause' : 'speed' + this.sim.speed);
      return;
    }
    if (k === '1' || k === '2' || k === '3') {
      if (this.sim.speed !== Number(k)) this.sound('speed' + k);
      this.sim.speed = Number(k);
      this.lastSpeed = this.sim.speed;
      return;
    }
    if (k === 'Delete') {
      this.tools.select('bulldoze');
      return;
    }
    const lk = k.toLowerCase();
    const cycle = HOTKEY_CYCLES[lk];
    if (cycle && !e.shiftKey) {
      const cur = this.tools.activeId ?? 'query';
      const i = cycle.indexOf(cur);
      const next = cycle[(i + 1) % cycle.length];
      // ToolController.select plays the tool select / put-away sound
      if (cycle.length === 1 && i === 0 && next !== 'query') this.tools.select(null);
      else this.tools.select(next);
      this.consume(e);
      return;
    }
    const panel = PANEL_HOTKEYS[lk];
    if (panel && !e.shiftKey) {
      this.panels.toggle(panel);
      return;
    }
  }
  private lastSpeed = 1;

  /** we handled this key: keep it from the camera controller too when the camera also binds it */
  private consume(e: KeyboardEvent): void {
    e.preventDefault();
    if (CAMERA_KEYS.has(e.key.toLowerCase())) e.stopImmediatePropagation();
  }

  private onVisibility(): void {
    if (!this.settings.pauseWhenHidden) return;
    if (document.hidden) {
      if (this.sim.speed > 0) {
        this.hiddenPausedFrom = this.sim.speed;
        this.sim.speed = 0;
      }
    } else if (this.hiddenPausedFrom !== null) {
      this.sim.speed = this.hiddenPausedFrom;
      this.hiddenPausedFrom = null;
      this.last = performance.now();
    }
  }

  // ------------------------------------------------------------------------------------------------ actions
  private onMonth(): void {
    this.monthsSinceSave++;
    const n = this.settings.autosaveMonths;
    if (n > 0 && this.monthsSinceSave >= n) void this.save(true);
  }

  async save(auto = false): Promise<void> {
    if (this.saving) return this.saving;
    this.savePill.saving(auto);
    this.storeCamera();
    this.saving = (async () => {
      try {
        await this.opts.onSave(this.sim.state);
        this.monthsSinceSave = 0;
        this.savePill.done(true, auto ? 'Autosaved' : 'City saved');
        this.sound(auto ? 'autosave' : 'save', auto ? { volume: 0.8 } : undefined);
      } catch (e) {
        this.savePill.done(false);
        this.sound('error');
        this.errors.report('Saving failed', e, { key: 'save' });
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  async exitToRegion(): Promise<void> {
    this.sim.speed = 0;
    this.tools.select(null, { silent: true });
    this.panels.closeAll();
    await this.save(false);
    let thumb: string | undefined;
    try {
      thumb = this.world.capture(512, 512, true) || undefined;
    } catch (e) {
      console.warn('[game] capture failed', e);
    }
    this.opts.onExitToRegion(thumb);
  }

  private setOverlay(o: Overlay): void {
    this.ctx.overlay = o;
    try {
      this.world.setOverlay(o);
    } catch (e) {
      console.warn(e);
    }
    try {
      this.objects.setOverlayMode(o);
    } catch (e) {
      console.warn(e);
    }
    this.minimap.markDirty();
    this.uiEvents.emit('overlay', o);
  }

  private focusCell(x: number, z: number, distance?: number): void {
    // camera flight (toast / news / advisor / emergency "jump"): a very soft whoosh
    this.sound('whoosh', { volume: 0.7 });
    try {
      this.world.controls.focusOn(x * CELL_SIZE + CELL_SIZE / 2, z * CELL_SIZE + CELL_SIZE / 2, distance);
    } catch (e) {
      console.warn(e);
    }
  }

  private showQuery(t: QueryTarget | null): void {
    if (!t) {
      this.panels.close('info');
      return;
    }
    this.panels.open('info');
    this.info.show(t);
    try {
      this.objects.setSelected(t.buildingId ?? null);
    } catch {
      /* ignore */
    }
    this.uiEvents.emit('query', t);
  }

  /** play a sound through the (optional) audio module; game-action sounds pan with the cursor's screen x */
  private sound(name: string, opts?: SoundOpts): void {
    const a = this.mods.audio;
    if (!a) return;
    const n = SOUND_MAP[name] ?? name;
    let o: SoundOpts | undefined = opts;
    if (SPATIAL.has(n) && opts?.pan === undefined && this.mouse.inside) {
      const r = this.root.getBoundingClientRect();
      if (r.width > 0) o = { ...opts, pan: Math.max(-1, Math.min(1, ((this.mouse.x - r.left) / r.width) * 2 - 1)) * 0.45 };
    }
    try {
      a.play(n, o);
    } catch {
      /* unknown sound */
    }
  }

  /** feed the audio engine's city ambience (~2 Hz) */
  private updateAmbience(): void {
    this.feedSirens();
    const a = this.mods.audio as (GameModules['audio'] & { setAmbience?: (p: Record<string, unknown>) => void }) | undefined;
    if (!a?.setAmbience) return;
    try {
      const st = this.sim.state;
      const dist = this.world.controls.distance || 800;
      const hour = this.world.timeOfDay;
      let constructing = 0;
      if (st.buildings.size) {
        let n = 0, k = 0;
        for (const b of st.buildings.values()) {
          if (b.built < 1) k++;
          if (++n > 400) break;
        }
        constructing = Math.min(1, k / Math.max(1, n) * 5);
      }
      a.setAmbience({ population: st.stats.population, zoom: Math.max(0, Math.min(1, (dist - 60) / (st.size * CELL_SIZE))), night: hour < 6 || hour > 19.5, construction: constructing, activity: this.sim.speed / 3 });
      // soundtrack context: night, city size, liveliness (sim speed + recent growth + construction)
      const m = this.musicPop;
      const now = performance.now();
      if (now - m.t > 20000) {
        m.growth = m.t ? Math.max(0, Math.min(1, ((st.stats.population - m.pop) / Math.max(500, m.pop)) * 20)) : 0;
        m.pop = st.stats.population;
        m.t = now;
      }
      const music = a as { setMusicContext?: (c: Record<string, unknown>) => void };
      music.setMusicContext?.({ screen: 'city', night: hour < 6 || hour > 19.5, population: st.stats.population, activity: Math.min(1, (this.sim.speed / 3) * 0.6 + m.growth * 0.25 + constructing * 0.15) });
    } catch {
      /* ignore */
    }
  }
  private musicPop = { pop: 0, t: 0, growth: 0 };

  /** WP8: siren voices follow the nearest emergency vehicle of each kind (camera distance, screen-x pan) */
  private feedSirens(): void {
    const a = this.mods.audio as { getSfxOutput?: () => SirenOut | null } | undefined;
    if (typeof a?.getSfxOutput !== 'function') return;
    try {
      this.sirens ??= new Sirens(() => a.getSfxOutput!.call(a));
      const ev = (this.objects as { emergency?: EmergencyVehicles }).emergency;
      const srcs = ev?.sirenSources(this.sirenSrc) ?? [];
      const out: SirenSource[] = [];
      const cam = this.world.camera;
      if (cam && srcs.length) {
        const e = cam.matrixWorld.elements;
        const cx = e[12], cy = e[13], cz = e[14];
        for (const s of srcs) {
          const dx = s.x - cx, dy = s.y - cy, dz = s.z - cz;
          const d = Math.hypot(dx, dy, dz);
          out.push({ responder: s.responder, distance: d, pan: ((dx * e[0] + dy * e[1] + dz * e[2]) / Math.max(1, d)) * 1.2 });
        }
      }
      this.sirens.update(out, this.sim.speed === 0);
    } catch {
      /* ignore */
    }
  }

  /** brief "Now playing" toast when the soundtrack changes song (audio.nowPlayingToasts, settings.toasts) */
  private watchNowPlaying(): void {
    const ma = asMusicAudio(this.mods.audio);
    if (!ma) return;
    this.offs.push(
      watchTrackChanges(ma, (np) => {
        const a = this.mods.audio as { nowPlayingToasts?: boolean } | undefined;
        if (a?.nowPlayingToasts === false || !this.settings.toasts || this.disposed) return;
        // click: the music player (Settings → Music: skip, pause, shuffle, pick tracks)
        const openPlayer = () => {
          this.panels.open('settings');
          (this.panels.get('settings') as SettingsPanel | undefined)?.showSection?.('music');
        };
        this.toasts.show(`${np.title} · ${shortMood(np.mood)}`, 'music', undefined, '♪ Now playing', { silent: true, action: { hint: 'Music player', icon: 'music', run: openPlayer } });
      }),
    );
  }

  /** take the audio engine's volumes as the starting values (single source of truth) */
  private syncVolumesFromAudio(): void {
    const a = this.mods.audio as (GameModules['audio'] & { getVolume?: (k: string) => number }) | undefined;
    if (!a?.getVolume) return;
    const o = this.opts.settings ?? {};
    try {
      if (o.masterVolume === undefined) this.settings.masterVolume = a.getVolume('master');
      if (o.musicVolume === undefined) this.settings.musicVolume = a.getVolume('music');
      if (o.sfxVolume === undefined) this.settings.sfxVolume = a.getVolume('sfx');
      if (o.ambienceVolume === undefined) this.settings.ambienceVolume = a.getVolume('ambience');
    } catch {
      /* ignore */
    }
  }

  private applyAudio(patch: Partial<GameSettings>): void {
    const a = this.mods.audio;
    if (!a) return;
    const s = this.settings;
    const vols: [keyof GameSettings, string, number][] = [['masterVolume', 'master', s.masterVolume], ['musicVolume', 'music', s.musicVolume], ['sfxVolume', 'sfx', s.sfxVolume], ['ambienceVolume', 'ambience', s.ambienceVolume]];
    try {
      for (const [key, c, v] of vols) {
        if (patch[key] === undefined) continue;
        if (typeof a.setVolume === 'function') a.setVolume(c, v);
        else if (key in a) (a as Record<string, unknown>)[key] = v;
      }
    } catch (e) {
      console.warn('[game] audio volume', e);
    }
  }

  applySettings(patch: Partial<GameSettings>): void {
    const prev = { ...this.settings };
    Object.assign(this.settings, patch);
    if (Object.keys(patch).length) {
      saveSettings(this.settings);
      const shared = this.opts.settings as Record<string, unknown> | undefined;
      if (shared) for (const k of Object.keys(patch)) if (k in shared) shared[k] = (patch as Record<string, unknown>)[k];
      try {
        this.opts.onSettingsChange?.(this.settings);
      } catch (e) {
        console.warn(e);
      }
    }
    const s = this.settings;
    const w = this.world;
    try {
      if (patch.quality !== undefined && patch.quality !== prev.quality) {
        w.setQuality(s.quality);
        (this.objects as { setQuality?: (q: string) => void }).setQuality?.(s.quality);
      }
      if (!this.newYear?.ownsTime) {
        w.autoTime = s.autoTime;
        if (!s.autoTime) w.timeOfDay = s.fixedHour;
      }
      w.setGridVisible(s.showGrid && !!this.tools?.activeId && this.tools.active.wantsGrid);
      const c = w.controls as unknown as { edgeScroll?: boolean };
      if (c && 'edgeScroll' in c) c.edgeScroll = s.edgeScroll;
    } catch (e) {
      console.warn('[game] applying settings', e);
    }
    if (patch.uiScale !== undefined) this.resize();
    this.fpsEl.style.display = s.showFps ? 'block' : 'none';
    this.applyAudio(patch);
    this.uiEvents.emit('settings', s);
  }

  // ------------------------------------------------------------------------------------------------ dev helpers
  /** select a tool by id (e.g. 'net:2', 'zone:1', 'plop:police_station'); for tests / meta */
  selectTool(id: string | null): boolean {
    return this.tools.select(id);
  }
  openPanel(id: string): void {
    this.panels.open(id);
  }
  openFlyout(categoryId: string, tab?: string): void {
    this.toolbar.openFlyout(categoryId, tab);
  }
  /** show the "Getting started" card again (e.g. from a help menu) */
  showOnboarding(): void {
    this.onboarding.show();
  }
  get worldView(): WorldViewApi {
    return this.world;
  }
  /** dev / meta: ring in the New Year now (toast + time-lapse + fireworks per settings.newYear) */
  celebrateNewYear(opts?: CelebrateOptions): boolean {
    return this.newYear.celebrate(opts);
  }
  get objectsView(): CityObjectsViewApi {
    return this.objects;
  }
}
