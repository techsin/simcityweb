/** The main-thread seam. Full views and persistence join it in W0.5–W0.6. */
import type { CellRect, Emitter } from '../core/events';
import type { DevType, Network, Zone } from '../core/types';
import { ActionsProxy } from '../game/ActionsProxy';
import type { SavedCamera } from '../game/cameraStart';
import { FallbackActions } from '../game/fallback/FallbackActions';
import type { RegionContext } from '../region/regionEffects';
import type { ActionResult, Cell, CityActionsApi, TerraformKind } from '../sim/actions';
import { BF, type CityState } from '../sim/CityState';
import type { ServiceKind } from '../sim/catalogTypes';
import type { DispatchResult, EmergencySystem } from '../sim/infra/emergency';
import type { SampleRoute, TrafficSystem } from '../sim/infra/traffic';
import type { UtilitiesSystem } from '../sim/infra/utilities';
import type { CityEvents, Simulation } from '../sim/Simulation';
import { simWasmFlagSelects } from '../wasm/simWasm';
import { SimCore, type SimErrors, type SimFlags, type SimModules } from './SimCore';
import { queryKey, type QueryName, type QueryArgs, type QueryResult, type WatchPolicy } from './queries';
import type { PolicyState, SimSettings, ViewState } from './protocol';

export type { QueryName, QueryArgs, QueryResult, WatchPolicy } from './queries';

/** W0.3's dispatch reads; W0.5 completes the stream views. No system or mutation method escapes. */
export type DispatchView = Pick<EmergencySystem, 'incident' | 'incidents' | 'vehicles' | 'stationFleet' | 'stationName'>;

// W0.3: query/watch contracts and local transport checks.
export interface WatchHandle<R, A = unknown> {
  readonly value: R | undefined;
  readonly error: unknown;
  readonly version: number;
  setArgs(args: A): void;
  subscribe(listener: () => void, signal: AbortSignal): () => void;
  dispose(): void;
}

/** Bind the watch itself to the city's lifetime, removing the abort listener on an earlier close. */
export function watchFor<K extends QueryName>(host: SimHost, name: K, args: QueryArgs<K>, when: WatchPolicy, signal: AbortSignal): WatchHandle<QueryResult<K>, QueryArgs<K>> {
  const w = host.watch(name, args, when);
  const dispose = w.dispose.bind(w);
  const close = () => { signal.removeEventListener('abort', close); dispose(); };
  w.dispose = close;
  if (signal.aborted) close();
  else signal.addEventListener('abort', close, { once: true });
  return w;
}

function cloneResult<T>(value: T): T {
  return import.meta.env?.DEV || import.meta.env?.MODE === 'test' || IN_NODE ? structuredClone(value) : value;
}

class LocalWatch<K extends QueryName> implements WatchHandle<QueryResult<K>, QueryArgs<K>> {
  private cache = new Map<string, { value: QueryResult<K>; signature: string; at: number }>();
  private listeners = new Map<() => void, () => void>();
  private key: string;
  private at = -Infinity;
  private commandEpoch: number | undefined;
  private failed = '';
  error: unknown;
  version = 0;

  constructor(private args: QueryArgs<K>, private source: {
    now(): number;
    signature(args: QueryArgs<K>): string;
    run(args: QueryArgs<K>): QueryResult<K>;
    report(e: unknown): void;
    remove(): void;
    interval: number;
    /** Dispatch controls reflect an acknowledged command immediately, even inside the normal cap. */
    commandEpoch?: () => number;
  } | null) { this.args = structuredClone(args); this.key = queryKey(args); }

  get value(): QueryResult<K> | undefined { this.refresh(); return this.cache.get(this.key)?.value; }

  setArgs(args: QueryArgs<K>): void {
    const key = queryKey(args);
    if (key === this.key) return;
    this.args = structuredClone(args);
    this.key = key;
    this.error = undefined;
    this.version++;
    this.refresh();
  }

  refresh(): void {
    const s = this.source;
    if (!s) return;
    const now = s.now(), cached = this.cache.get(this.key), commandEpoch = s.commandEpoch?.();
    // Argument changes share the cap; dispatch command epochs bypass it. Inspector's 1 Hz gate is per key.
    if (commandEpoch === this.commandEpoch && (now - this.at < 200 || (cached && now - cached.at < s.interval))) return;
    const signature = s.signature(this.args), failureKey = this.key + ':' + signature;
    if (cached?.signature === signature || this.failed === failureKey) return;
    this.at = now;
    this.commandEpoch = commandEpoch;
    try {
      const value = s.run(this.args);
      this.cache.delete(this.key);
      this.cache.set(this.key, { value, signature, at: now });
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
      this.failed = '';
      this.error = undefined;
      this.version++;
    } catch (e) {
      this.error = e;
      this.failed = failureKey;
      this.version++;
      s.report(e);
    }
    for (const listener of this.listeners.keys()) listener();
  }

  subscribe(listener: () => void, signal: AbortSignal): () => void {
    this.listeners.get(listener)?.();
    const off = () => { this.listeners.delete(listener); signal.removeEventListener('abort', off); };
    if (!signal.aborted && this.source) { this.listeners.set(listener, off); signal.addEventListener('abort', off, { once: true }); }
    return off;
  }

  dispose(): void {
    this.source?.remove();
    this.source = null;
    for (const off of this.listeners.values()) off();
    this.cache.clear();
  }
}

// W0.4: the policy owns alerts and speed; subscribers only render its plain snapshots.
export type { SimSettings } from './protocol';
export interface PolicySnapshot {
  readonly alerts: readonly Readonly<PolicyState['alerts'][number]>[];
  readonly live: boolean;
  readonly toast?: Readonly<NonNullable<PolicyState['toast']>>;
  readonly warn?: true;
}
export interface PolicyView extends PolicySnapshot {
  subscribe(listener: (policy: PolicySnapshot) => void, signal: AbortSignal): () => void;
}

export type SpeedSource = 'initial' | 'keyboard' | 'topbar' | 'pause' | 'error' | 'visibility' | 'exit' | 'onboarding' | 'emergency' | 'facade';
export interface LoanGuard { principal: number; monthsLeft: number }

/** W0.2 commands; debug and persistence join in their own steps. */
interface Commands {
  zone(rect: CellRect, zone: Zone): ActionResult;
  dezone(rect: CellRect): ActionResult;
  bulldoze(rect: CellRect): ActionResult;
  buildNetwork(path: Cell[], type: Network): ActionResult;
  buildPowerLine(path: Cell[]): ActionResult;
  buildSubway(path: Cell[]): ActionResult;
  plop(defId: string, x: number, z: number, rot: 0 | 1 | 2 | 3): ActionResult;
  terraform(kind: TerraformKind, cx: number, cz: number, radius: number, strength: number): ActionResult;
  plantTrees(rect: CellRect): ActionResult;
  setTax(dev: DevType, value: number): void;
  setFunding(service: ServiceKind, value: number): void;
  setHistoric(buildingId: number, on: boolean): void;
  setOrdinance(id: string, enabled: boolean, opts?: { confirm?: boolean }): ActionResult & { needsConfirm?: boolean };
  takeLoan(amount: number): ActionResult;
  repayLoan(index: number, guard: LoanGuard): ActionResult;
  setSpeed(value: number, source: SpeedSource): void;
  resume(source: SpeedSource): void;
  dispatch(incidentId: number, stationId: number, units: number): DispatchResult;
  dispatchBest(incidentId: number): DispatchResult;
  triggerDisaster(kind: string, x: number, z: number): boolean;
  setCamera(camera: SavedCamera): void;
}
/** W0.4 policy commands. */
interface Commands {
  dismissAlert(incidentId: number): void;
  setSettings(settings: SimSettings): void;
}
export type CommandOp = keyof Commands;
export type CommandArgs<K extends CommandOp> = Parameters<Commands[K]>;
export type CommandResult<K extends CommandOp> = ReturnType<Commands[K]>;
export type Command = { [K in CommandOp]: { op: K; args: CommandArgs<K> } }[CommandOp];
export interface Ticket<R> { readonly seq: number; readonly predicted?: R; readonly exact: boolean; readonly done: Promise<R> }
export interface ActOptions { tag?: object; gesture?: Gesture }
export interface Cause { seq: number; tag: object | null }
export type GestureOwner = object;

/** W0.5: read-only system data, shared by local readers and the replica's streams. */
export type EmergencyView = Pick<EmergencySystem, 'active' | 'layersReady' | 'incidents' | 'incident' | 'vehicles' | 'stationList' | 'stationFleet' | 'stationName'>;
export interface TrafficView {
  sampleRoutes(max: number): SampleRoute[];
  truckVolume(): Float32Array | null;
}
export interface UtilitiesView {
  waterQualityAt(sim: Pick<Simulation, 'state'>, cell: number): number;
}

/** A pointer stroke (or one off-pointer commit), including acknowledgements arriving after release. */
export class Gesture {
  private pending = 0;
  private ended = false;
  private failed = false;
  private resolve!: () => void;
  readonly settled = new Promise<void>((resolve) => { this.resolve = resolve; });

  constructor(readonly owner: GestureOwner, private onEnd: () => void = () => {}) {}

  track(done: Promise<unknown>): void {
    this.pending++;
    const finish = () => {
      this.pending--;
      if (this.ended && !this.pending) this.resolve();
    };
    void done.then(finish, finish);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.onEnd();
    this.onEnd = () => {};
    if (!this.pending) this.resolve();
  }

  /** Corrections and provisional failures are reported by their issuer, once per gesture. */
  fail(report: () => void): void {
    if (this.failed) return;
    this.failed = true;
    report();
  }
}

export interface SimHost {
  readonly kind: 'local' | 'loopback' | 'worker';
  readonly ready: Promise<void>;
  readonly state: CityState;
  readonly events: Emitter<CityEvents>;
  /** Simulation compatibility during W0; narrowed as commands, queries and views migrate. */
  readonly sim: Simulation;
  readonly actions: CityActionsApi;
  readonly preview: CityActionsApi;
  readonly speed: number;
  readonly liveSlowdown: number;
  setSpeed(v: number, source: SpeedSource): void;
  resume(source: SpeedSource): void;
  act<K extends CommandOp>(op: K, args: CommandArgs<K>, opts?: ActOptions): Ticket<CommandResult<K>>;
  readonly cause: Cause | null;
  /** Read epoch for UI memos; counts issued commands, including same-day edits. */
  readonly commandCount: number;
  beginGesture(owner: GestureOwner): Gesture;
  query<K extends QueryName>(name: K, args: QueryArgs<K>): Promise<QueryResult<K>>;
  watch<K extends QueryName>(name: K, args: QueryArgs<K>, when: WatchPolicy): WatchHandle<QueryResult<K>, QueryArgs<K>>;
  simTime(): number;
  secondsPerDay(): number;
  frame(dt: number): void;
  /** W0.5 views and news revision (the retained news array is capped at 200). */
  readonly emergency: EmergencyView;
  readonly traffic: TrafficView;
  readonly utilities: UtilitiesView;
  readonly newsSeq: number;
  setView(view: ViewState): void;
  dispose(): Promise<void>;
}
/** W0.4 policy view; independent of the query and stream seams. */
export interface SimHost {
  readonly policy: PolicyView;
}

export interface LocalSimHostOptions {
  rctx?: RegionContext | null;
  initialSpeed?: number;
  errors?: SimErrors;
  flags?: SimFlags;
  /** Monotonic real time, injectable for watch cadence tests. */
  now?: () => number;
  signal?: AbortSignal;
}

/** Broken lazy imports must not take down the city screen: the local host keeps its stand-ins. */
const SIM_MODULES = import.meta.glob(['../sim/systems/index.ts', '../sim/actions.ts']);
/** node instantiates the kernels on their first call; a page must fetch and compile them before boot */
const IN_NODE = typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === 'string';

export class LocalSimHost implements SimHost {
  readonly kind = 'local';
  readonly actions: ActionsProxy;
  readonly preview: ActionsProxy;
  private core: SimCore;
  private rctx: RegionContext | null;
  private started = false;
  private seq = 0;
  private emitting: Cause | null = null;
  private gesture: Gesture | null = null;
  // W0.3: watches and in-flight reads are separate from command/policy ownership.
  private watches = new Set<LocalWatch<QueryName>>();
  private queries = new Map<string, Promise<unknown>>();
  private queryClock: () => number;
  private views: ReturnType<typeof localViews>;
  private news: ReturnType<typeof newsSequence>;
  private resolveReady!: () => void;
  private rejectReady!: (e: unknown) => void;
  readonly ready = new Promise<void>((resolve, reject) => {
    this.resolveReady = resolve;
    this.rejectReady = reject;
  });

  constructor(state: CityState, opts: LocalSimHostOptions = {}) {
    this.core = new SimCore(state, opts.errors, opts.flags);
    this.rctx = opts.rctx ?? null;
    this.queryClock = opts.now ?? (() => performance.now());
    this.views = localViews(this.sim);
    this.news = newsSequence(this.events, state.news.length, opts.signal);
    const fallback = new FallbackActions(this.sim);
    this.actions = new LocalActions(fallback, this);
    this.preview = new LocalActions(fallback, this, true);
    if (opts.initialSpeed !== undefined) this.setSpeed(opts.initialSpeed, 'initial');
  }

  get sim(): Simulation { return this.core.sim; }
  get state(): CityState { return this.sim.state; }
  get events(): Emitter<CityEvents> { return this.sim.events; }
  get speed(): number { return this.sim.speed; }
  get liveSlowdown(): number { return this.sim.liveSlowdown; }
  get cause(): Cause | null { return this.emitting; }
  get degradedActions(): boolean { return this.core.actions === null; }
  get policy(): PolicyView { return this.core.livePolicy.view; }
  simTime(): number { return this.sim.simTime(); }
  secondsPerDay(): number { return this.sim.secondsPerDay(); }

  // W0.5: stable readers follow lazy system boot and state replacement.
  get emergency(): EmergencyView { return this.views.emergency; }
  get traffic(): TrafficView { return this.views.traffic; }
  get utilities(): UtilitiesView { return this.views.utilities; }
  get newsSeq(): number { return this.news.seq; }
  get commandCount(): number { return this.seq; }
  /** All local layers are already available; replica hosts subscribe through this seam. */
  setView(_view: ViewState): void {}

  setSpeed(v: number, source: SpeedSource): void { this.act('setSpeed', [v, source]); }
  resume(source: SpeedSource): void { this.act('resume', [source]); }

  act<K extends CommandOp>(op: K, args: CommandArgs<K>, opts: ActOptions = {}): Ticket<CommandResult<K>> {
    if (this.core.isDisposed) throw new Error('Simulation host is disposed');
    const seq = ++this.seq;
    const gesture = opts.gesture ?? this.gesture;
    const before = this.emitting;
    this.emitting = { seq, tag: opts.tag ?? null };
    try {
      const predicted = cloneResult(this.core.applyCommand({ op, args } as Command, this.actions.target)) as CommandResult<K>;
      const done = Promise.resolve(predicted);
      gesture?.track(done);
      return { seq, predicted, exact: true, done };
    } finally {
      this.emitting = before;
    }
  }

  beginGesture(owner: GestureOwner): Gesture {
    this.gesture?.end();
    const gesture = new Gesture(owner, () => { if (this.gesture === gesture) this.gesture = null; });
    this.gesture = gesture;
    return gesture;
  }

  // W0.3: run now, publish only after the command's synchronous effects have completed.
  query<K extends QueryName>(name: K, args: QueryArgs<K>): Promise<QueryResult<K>> {
    if (this.core.isDisposed) return Promise.reject(new Error('Simulation host is disposed'));
    // A later command starts a new read epoch: it must not reuse a result from before that command (R3).
    const key = `${this.seq}:${this.state.day}:${name}:${queryKey(args)}`;
    const pending = this.queries.get(key);
    if (pending) return pending as Promise<QueryResult<K>>;
    let result: Promise<QueryResult<K>>;
    try { result = Promise.resolve(cloneResult(this.core.runQuery(name, args))); }
    catch (e) { this.queryError(name, e); result = Promise.reject(e); }
    this.queries.set(key, result);
    const clear = () => { if (this.queries.get(key) === result) this.queries.delete(key); };
    void result.then(clear, clear);
    return result;
  }

  watch<K extends QueryName>(name: K, args: QueryArgs<K>, when: WatchPolicy): WatchHandle<QueryResult<K>, QueryArgs<K>> {
    if (this.core.isDisposed) throw new Error('Simulation host is disposed');
    const w = new LocalWatch<K>(args, {
      now: this.queryClock,
      signature: (a) => this.core.querySignature(name, a, when, this.seq),
      run: (a) => cloneResult(this.core.runQuery(name, a)),
      report: (e) => this.queryError(name, e),
      remove: () => this.watches.delete(w as LocalWatch<QueryName>),
      interval: name === 'inspectBuilding' || name === 'inspectCell' ? 1000 : 200,
      commandEpoch: name === 'dispatchOptions' ? () => this.seq : undefined,
    });
    this.watches.add(w as LocalWatch<QueryName>);
    w.refresh();
    return w;
  }

  private queryError(name: QueryName, e: unknown): void {
    this.core.report(`Query “${name}” failed`, e, { key: `query:${name}` });
    if (import.meta.env?.DEV) console.error(`[query] ${name} failed`, e);
  }

  /** Attach the lazy systems and real CityActions, in the same order as CityScene.loadSim. */
  async start(): Promise<void> {
    if (this.started || this.core.isDisposed) return this.ready;
    this.started = true;
    try {
      const [sysMod, actMod] = await Promise.all([
        SIM_MODULES['../sim/systems/index.ts']?.().catch((e: unknown) => {
          this.core.report('Simulation systems failed to load — the city will not grow', e, { sim: true });
          return null;
        }),
        SIM_MODULES['../sim/actions.ts']?.().catch((e: unknown) => {
          this.core.report('City actions failed to load — using stand-in actions', e);
          return null;
        }),
        this.initWasm(),
      ]) as [Pick<SimModules, 'createSystems'> | null | undefined, Pick<SimModules, 'CityActions'> | null | undefined, void];
      if (this.core.isDisposed) return;
      this.core.boot(this.rctx, { createSystems: sysMod?.createSystems, CityActions: actMod?.CityActions });
      if (this.core.actions) this.actions.target = this.preview.target = this.core.actions;
      this.resolveReady();
    } catch (e) {
      this.rejectReady(e);
    }
    return this.ready;
  }

  /** WASM blur is opt-in (WASM_PLAN PI-6): unless the flag selects it, nothing wasm is fetched or instantiated. */
  private async initWasm(): Promise<void> {
    const flag = this.core.flags.simwasm;
    if (IN_NODE || flag == null || !simWasmFlagSelects(flag, 'blur')) return;
    try {
      const { initSimWasmBrowser } = await import('../wasm/browser');
      await initSimWasmBrowser({ flag });
    } catch (e) {
      this.core.report('WASM kernels failed to load', e);
    }
  }

  frame(dt: number): void {
    this.core.frame(dt);
    for (const w of this.watches) w.refresh();
  }

  dispose(): Promise<void> {
    this.gesture?.end();
    for (const w of this.watches) w.dispose();
    this.queries.clear();
    this.news.dispose();
    this.core.dispose();
    this.rctx = null;
    this.resolveReady(); // an exit while imports are pending must not leave awaiters hanging
    return Promise.resolve();
  }
}

/** W0.5 local views: no commands or system internals escape through these readers. */
function localViews(sim: Simulation): { emergency: EmergencyView; traffic: TrafficView; utilities: UtilitiesView } {
  const em = () => sim.getSystem<EmergencySystem>('emergency');
  const tr = () => sim.getSystem<TrafficSystem>('traffic');
  return {
    emergency: {
      get active() { return em()?.active ?? false; },
      get layersReady() { return em()?.layersReady ?? false; },
      incidents: () => em()?.incidents() ?? [],
      incident: (id) => em()?.incident(id),
      vehicles: () => em()?.vehicles() ?? [],
      stationList: () => em()?.stationList() ?? [],
      stationFleet: (id) => em()?.stationFleet(id) ?? null,
      stationName: (id) => em()?.stationName(id) ?? 'Station',
    },
    traffic: {
      sampleRoutes: (max) => tr()?.getSampleRoutes(max) ?? [],
      truckVolume: () => tr()?.truckVolume() ?? null,
    },
    utilities: {
      waterQualityAt: (_source, cell) => sim.getSystem<UtilitiesSystem>('utilities')?.waterQualityAt(sim, cell) ?? sim.state.stats.tapWater ?? 1,
    },
  };
}

/** Count every news event before the HUD sees it; reset invalidates a loaded log even at the same length. */
function newsSequence(events: Emitter<CityEvents>, initial: number, signal?: AbortSignal): { seq: number; dispose(): void } {
  const counter = { seq: initial, dispose: () => {} };
  if (signal?.aborted) return counter;
  const bump = () => { counter.seq++; };
  const offs = [events.on('news', bump), events.on('reset', bump)];
  const dispose = () => {
    for (const off of offs) off();
    signal?.removeEventListener('abort', dispose);
  };
  counter.dispose = dispose;
  signal?.addEventListener('abort', dispose, { once: true });
  return counter;
}

/** The compatibility actions also use the command seam; hover calls only reach the preview path. */
class LocalActions extends ActionsProxy {
  constructor(target: CityActionsApi, private host: LocalSimHost, private previewOnly = false) { super(target); }
  override zone(rect: CellRect, zone: Zone, preview = false): ActionResult {
    return preview || this.previewOnly ? this.target.zone(rect, zone, true) : this.host.act('zone', [rect, zone]).predicted!;
  }
  override dezone(rect: CellRect, preview = false): ActionResult {
    return preview || this.previewOnly ? this.target.dezone(rect, true) : this.host.act('dezone', [rect]).predicted!;
  }
  override bulldoze(rect: CellRect, preview = false): ActionResult {
    return preview || this.previewOnly ? this.target.bulldoze(rect, true) : this.host.act('bulldoze', [rect]).predicted!;
  }
  override buildNetwork(path: Cell[], type: Network, preview = false): ActionResult {
    return preview || this.previewOnly ? this.target.buildNetwork(path, type, true) : this.host.act('buildNetwork', [path, type]).predicted!;
  }
  override buildPowerLine(path: Cell[], preview = false): ActionResult {
    return preview || this.previewOnly ? this.target.buildPowerLine(path, true) : this.host.act('buildPowerLine', [path]).predicted!;
  }
  override buildSubway(path: Cell[], preview = false): ActionResult {
    return preview || this.previewOnly ? this.target.buildSubway(path, true) : this.host.act('buildSubway', [path]).predicted!;
  }
  override plop(id: string, x: number, z: number, rot: 0 | 1 | 2 | 3, preview = false): ActionResult {
    return preview || this.previewOnly ? this.target.plop(id, x, z, rot, true) : this.host.act('plop', [id, x, z, rot]).predicted!;
  }
  override terraform(kind: TerraformKind, x: number, z: number, radius: number, strength: number, preview = false): ActionResult {
    return preview || this.previewOnly ? this.target.terraform(kind, x, z, radius, strength, true) : this.host.act('terraform', [kind, x, z, radius, strength]).predicted!;
  }
  override plantTrees(rect: CellRect, preview = false): ActionResult {
    return preview || this.previewOnly ? this.target.plantTrees(rect, true) : this.host.act('plantTrees', [rect]).predicted!;
  }
  private writable(): void { if (this.previewOnly) throw new Error('Preview actions are read-only'); }
  override setTax(dev: DevType, value: number): void {
    this.writable(); this.host.act('setTax', [dev, value]);
  }
  override setFunding(service: ServiceKind, value: number): void {
    this.writable(); this.host.act('setFunding', [service, value]);
  }
  override setOrdinance(id: string, enabled: boolean, opts?: { confirm?: boolean }): ActionResult & { needsConfirm?: boolean } {
    this.writable(); return this.host.act('setOrdinance', [id, enabled, opts]).predicted!;
  }
  override takeLoan(amount: number): ActionResult {
    this.writable(); return this.host.act('takeLoan', [amount]).predicted!;
  }
  override repayLoan(index: number): ActionResult {
    this.writable();
    const loan = this.host.state.budget.loans[index];
    return this.host.act('repayLoan', [index, { principal: loan?.principal ?? NaN, monthsLeft: loan?.monthsLeft ?? NaN }]).predicted!;
  }
  override toggleHistoric(id: number): void {
    this.writable(); this.host.act('setHistoric', [id, !((this.host.state.buildings.get(id)?.flags ?? 0) & BF.Historic)]);
  }
}
