/** The main-thread seam. Queries, views and persistence join it in W0.3–W0.6. */
import type { CellRect, Emitter } from '../core/events';
import type { DevType, Network, Zone } from '../core/types';
import { ActionsProxy } from '../game/ActionsProxy';
import type { SavedCamera } from '../game/cameraStart';
import { FallbackActions } from '../game/fallback/FallbackActions';
import type { RegionContext } from '../region/regionEffects';
import type { ActionResult, Cell, CityActionsApi, TerraformKind } from '../sim/actions';
import { BF, type CityState } from '../sim/CityState';
import type { ServiceKind } from '../sim/catalogTypes';
import type { DispatchResult } from '../sim/infra/emergency';
import type { CityEvents, Simulation } from '../sim/Simulation';
import { simWasmFlagSelects } from '../wasm/simWasm';
import { SimCore, type SimErrors, type SimFlags, type SimModules } from './SimCore';

export type SpeedSource = 'initial' | 'keyboard' | 'topbar' | 'pause' | 'error' | 'visibility' | 'exit' | 'onboarding' | 'emergency' | 'facade';
export interface LoanGuard { principal: number; monthsLeft: number }

/** W0.2 commands; policy/settings, debug and persistence join in their own steps. */
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
export type CommandOp = keyof Commands;
export type CommandArgs<K extends CommandOp> = Parameters<Commands[K]>;
export type CommandResult<K extends CommandOp> = ReturnType<Commands[K]>;
export type Command = { [K in CommandOp]: { op: K; args: CommandArgs<K> } }[CommandOp];
export interface Ticket<R> { readonly seq: number; readonly predicted?: R; readonly exact: boolean; readonly done: Promise<R> }
export interface ActOptions { tag?: object; gesture?: Gesture }
export interface Cause { seq: number; tag: object | null }
export type GestureOwner = object;

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
  beginGesture(owner: GestureOwner): Gesture;
  simTime(): number;
  secondsPerDay(): number;
  frame(dt: number): void;
  dispose(): Promise<void>;
}

export interface LocalSimHostOptions {
  rctx?: RegionContext | null;
  initialSpeed?: number;
  errors?: SimErrors;
  flags?: SimFlags;
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
  private resolveReady!: () => void;
  private rejectReady!: (e: unknown) => void;
  readonly ready = new Promise<void>((resolve, reject) => {
    this.resolveReady = resolve;
    this.rejectReady = reject;
  });

  constructor(state: CityState, opts: LocalSimHostOptions = {}) {
    this.core = new SimCore(state, opts.errors, opts.flags);
    this.rctx = opts.rctx ?? null;
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
  simTime(): number { return this.sim.simTime(); }
  secondsPerDay(): number { return this.sim.secondsPerDay(); }

  setSpeed(v: number, source: SpeedSource): void { this.act('setSpeed', [v, source]); }
  resume(source: SpeedSource): void { this.act('resume', [source]); }

  act<K extends CommandOp>(op: K, args: CommandArgs<K>, opts: ActOptions = {}): Ticket<CommandResult<K>> {
    if (this.core.isDisposed) throw new Error('Simulation host is disposed');
    const seq = ++this.seq;
    const gesture = opts.gesture ?? this.gesture;
    const before = this.emitting;
    this.emitting = { seq, tag: opts.tag ?? null };
    try {
      const predicted = this.core.applyCommand({ op, args } as Command, this.actions.target) as CommandResult<K>;
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

  frame(dt: number): void { this.core.frame(dt); }

  dispose(): Promise<void> {
    this.gesture?.end();
    this.core.dispose();
    this.rctx = null;
    this.resolveReady(); // an exit while imports are pending must not leave awaiters hanging
    return Promise.resolve();
  }
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
