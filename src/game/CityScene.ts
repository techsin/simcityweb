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
import * as actionsMod from '../sim/actions';
import type { CityActionsApi } from '../sim/actions';
import type { CityState } from '../sim/CityState';
import { Simulation, type SimSystem } from '../sim/Simulation';
import { createSystems } from '../sim/systems';
import type { GameContext, QueryTarget, UIEvents } from './context';
import { FallbackActions } from './fallback/FallbackActions';
import { FallbackObjectsView } from './fallback/FallbackObjectsView';
import { FallbackWorldView } from './fallback/FallbackWorldView';
import { NullObjectsView, NullWorldView } from './fallback/NullViews';
import { loadGameModules, type GameModules } from './modules';
import { loadSettings, saveSettings, type GameSettings } from './settings';
import { HOTKEY_CYCLES, PANEL_HOTKEYS } from './toolCatalog';
import { ToolController } from './tools/ToolController';
import { CursorTip } from '../ui/CursorTip';
import { h, isTyping } from '../ui/dom';
import { icon } from '../ui/icons';
import { MiniMap } from '../ui/MiniMap';
import { ErrorOverlay, HelpPanel, PauseMenu, SavePill } from '../ui/Modals';
import { NewsTicker, Toasts } from '../ui/Notifications';
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

export type { GameSettings } from './settings';

export interface CitySceneOptions {
  container: HTMLElement;
  state: CityState;
  onExitToRegion: (thumbnailDataUrl?: string) => void;
  onSave: (state: CityState) => Promise<void>;
  settings?: Partial<GameSettings>;
  /** dev/testing: force the stand-in views ('world' | 'objects' | 'all') */
  forceFallback?: 'world' | 'objects' | 'all';
  /** dev/testing: initial simulation speed (default 1) */
  initialSpeed?: number;
}

type ActionsCtor = new (sim: Simulation) => CityActionsApi;

/** UI sound names -> audio engine sound names (src/audio/sfx.ts) */
const SOUND_MAP: Record<string, string> = {
  build: 'road', powerline: 'power', subway: 'rail', select: 'click', rotate: 'click', trees: 'tree', money: 'cash', save: 'confirm',
  warning: 'notify', disaster: 'alarm', toggleOn: 'toggle', toggleOff: 'toggle', cancel: 'cancel',
};

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
  private errors: ErrorOverlay;
  private pause: PauseMenu;
  private savePill: SavePill;
  private info: InfoPanel;
  private advisors: AdvisorsPanel;
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
  private offs: (() => void)[] = [];
  private monthsSinceSave = 0;
  private saving: Promise<void> | null = null;
  private hiddenPausedFrom: number | null = null;
  private mouse = { x: -1, y: -1, inside: false };
  private fps = { frames: 0, t: 0, value: 0 };
  private renderFailures = 0;
  private degraded = { world: false, objects: false, actions: false };
  private resizeObs: ResizeObserver | null = null;

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

    // ---- simulation (systems are guarded so one broken system can't take the game down)
    let systems: SimSystem[] = [];
    try {
      systems = createSystems();
    } catch (e) {
      this.errors.report('Simulation systems failed to load', e, { sim: true });
    }
    for (const s of systems) this.guardSystem(s);
    let sim: Simulation;
    try {
      sim = new Simulation(state, systems);
    } catch (e) {
      this.errors.report('Simulation failed to start', e, { sim: true });
      sim = new Simulation(state, []);
    }
    this.sim = sim;
    if (opts.initialSpeed !== undefined) this.sim.speed = opts.initialSpeed;

    // ---- actions (sim-core's CityActions, else a stand-in)
    const Ctor = (actionsMod as unknown as { CityActions?: ActionsCtor }).CityActions;
    let actions: CityActionsApi | null = null;
    if (typeof Ctor === 'function') {
      try {
        actions = new Ctor(this.sim);
      } catch (e) {
        this.errors.report('CityActions failed to construct — using stand-in actions', e);
      }
    }
    if (!actions) {
      actions = new FallbackActions(this.sim);
      this.degraded.actions = true;
    }
    this.actions = actions;

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
      tools: null as unknown as ToolController,
      panels: null as unknown as PanelManager,
      tip: this.tip,
      overlay: Overlay.None,
      degraded: this.degraded,
      setOverlay: (o) => this.setOverlay(o),
      sound: (n) => this.sound(n),
      focusCell: (x, z, d) => this.focusCell(x, z, d),
      showQuery: (t) => this.showQuery(t),
      applySettings: (p) => this.applySettings(p),
      toast: (text, kind, cell) => this.toasts?.show(text, kind, cell),
      save: () => this.save(false),
      exitToRegion: () => this.exitToRegion(),
      openPauseMenu: () => this.pause.open(),
      sandbox: () => !!this.sim.state.config.sandbox || this.sim.state.config.difficulty === 'sandbox',
    };
    this.ctx = ctx;
    this.tools = new ToolController(ctx, this.canvas);
    ctx.tools = this.tools;
    this.panels = new PanelManager(ctx, this.uiRoot);
    ctx.panels = this.panels;

    // ---- HUD
    this.topBar = new TopBar(ctx, this.uiRoot);
    const bl = h('div', { class: 'hud-bl' });
    this.uiRoot.appendChild(bl);
    new LegendChip(ctx, bl);
    this.ticker = new NewsTicker(ctx, bl);
    this.toolbar = new Toolbar(ctx, this.uiRoot);
    this.minimap = new MiniMap(ctx, this.uiRoot);
    this.toasts = new Toasts(ctx, this.uiRoot);
    this.savePill = new SavePill(this.uiRoot);
    this.fpsEl = h('div', { class: 'fps mp-glass', style: 'display:none' });
    this.uiRoot.appendChild(this.fpsEl);
    this.info = new InfoPanel(ctx);
    this.advisors = new AdvisorsPanel(ctx);
    for (const p of [new BudgetPanel(ctx), new GraphsPanel(ctx), new StatsPanel(ctx), this.advisors, new OrdinancesPanel(ctx), new RewardsPanel(ctx), new SettingsPanel(ctx), new DataViewsPanel(ctx), this.info, new HelpPanel(ctx)]) this.panels.register(p);
    this.pause = new PauseMenu(ctx, this.uiRoot, { onSettings: () => this.panels.open('settings'), onHelp: () => this.panels.open('help') });

    // ---- events
    const on = <K extends keyof WindowEventMap>(t: Window | Document, k: K, f: (e: WindowEventMap[K]) => void) => {
      t.addEventListener(k, f as EventListener);
      this.offs.push(() => t.removeEventListener(k, f as EventListener));
    };
    on(window, 'keydown', (e) => this.onKey(e));
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
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    void this.initViews();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const f of this.offs) f();
    this.resizeObs?.disconnect();
    try {
      (this.mods.audio as { stopAmbience?: () => void } | undefined)?.stopAmbience?.();
    } catch {
      /* ignore */
    }
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

  private async initViews(): Promise<void> {
    try {
      this.mods = await loadGameModules();
    } catch (e) {
      this.errors.report('Failed to load game modules', e);
    }
    if (this.disposed) return;
    this.syncVolumesFromAudio();
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
        objects = new this.mods.CityObjectsView(state, events, { scene: world.scene, camera: world.camera, renderer: world.renderer, canvas: this.canvas, getTrafficRoutes });
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
    try {
      const N = state.size;
      this.world.controls.focusOn((N / 2) * CELL_SIZE, (N / 2) * CELL_SIZE);
    } catch {
      /* ignore */
    }
    if (this.mods.errors.length) console.warn('[game] module load issues', this.mods.errors);
    this.showDevBadge();
    this.uiEvents.emit('viewsReady', undefined);
    this.veil.classList.add('gone');
    setTimeout(() => this.veil.remove(), 600);
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
      this.sim.update(dt);
    } catch (e) {
      this.errors.report('Simulation error', e, { sim: true, key: 'sim.update' });
    }
    this.edgeScroll(dt);
    try {
      this.world.update(dt);
      this.objects.update(dt);
      this.world.render();
      this.renderFailures = 0;
    } catch (e) {
      this.renderFailures++;
      this.errors.report('Rendering error', e, { key: 'render' });
    }
    this.minimap.frame(dt);
    this.ticker.frame(dt);
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
    }
    // fps
    this.fps.frames++;
    this.fps.t += dt;
    if (this.fps.t >= 0.5) {
      this.fps.value = this.fps.frames / this.fps.t;
      this.fps.frames = 0;
      this.fps.t = 0;
      if (this.settings.showFps) this.fpsEl.textContent = `${Math.round(this.fps.value)} fps`;
    }
  };

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
    this.panels?.clampAll();
  }

  // ------------------------------------------------------------------------------------------------ input
  private onKey(e: KeyboardEvent): void {
    if (isTyping(e) || this.disposed) return;
    if (this.pause.isOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.pause.close();
      }
      return;
    }
    if (this.tools.key(e)) {
      e.preventDefault();
      return;
    }
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      if (this.tools.cancelDrag()) return;
      if (this.toolbar.flyoutOpen) return this.toolbar.closeFlyout();
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
      this.sound('click');
      return;
    }
    if (k === '1' || k === '2' || k === '3') {
      this.sim.speed = Number(k);
      this.lastSpeed = this.sim.speed;
      this.sound('click');
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
      if (cycle.length === 1 && i === 0 && next !== 'query') this.tools.select(null);
      else this.tools.select(next);
      this.sound('click');
      return;
    }
    const panel = PANEL_HOTKEYS[lk];
    if (panel && !e.shiftKey) {
      this.panels.toggle(panel);
      return;
    }
  }
  private lastSpeed = 1;

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
    this.saving = (async () => {
      try {
        await this.opts.onSave(this.sim.state);
        this.monthsSinceSave = 0;
        this.savePill.done(true, auto ? 'Autosaved' : 'City saved');
        if (!auto) this.sound('save');
      } catch (e) {
        this.savePill.done(false);
        this.errors.report('Saving failed', e, { key: 'save' });
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  async exitToRegion(): Promise<void> {
    this.sim.speed = 0;
    this.tools.select(null);
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

  private sound(name: string): void {
    const a = this.mods.audio;
    if (!a) return;
    try {
      a.play(SOUND_MAP[name] ?? name);
    } catch {
      /* unknown sound */
    }
  }

  /** feed the audio engine's city ambience (~2 Hz) */
  private updateAmbience(): void {
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
    } catch {
      /* ignore */
    }
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
    if (Object.keys(patch).length) saveSettings(this.settings);
    const s = this.settings;
    const w = this.world;
    try {
      if (patch.quality !== undefined && patch.quality !== prev.quality) w.setQuality(s.quality);
      w.autoTime = s.autoTime;
      if (!s.autoTime) w.timeOfDay = s.fixedHour;
      w.setGridVisible(s.showGrid && !!this.tools?.activeId && this.tools.active.wantsGrid);
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
  openFlyout(categoryId: string): void {
    this.toolbar.openFlyout(categoryId);
  }
  get worldView(): WorldViewApi {
    return this.world;
  }
  get objectsView(): CityObjectsViewApi {
    return this.objects;
  }
  /** internal: icon helper export so meta can reuse the icon set */
  static icon = icon;
}
