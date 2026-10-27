/** The main-thread seam. Commands, queries, views and persistence join it in W0.2–W0.6. */
import type { Emitter } from '../core/events';
import { ActionsProxy } from '../game/ActionsProxy';
import { FallbackActions } from '../game/fallback/FallbackActions';
import type { RegionContext } from '../region/regionEffects';
import type { CityActionsApi } from '../sim/actions';
import type { CityState } from '../sim/CityState';
import type { CityEvents, Simulation } from '../sim/Simulation';
import { SimCore, type SimErrors, type SimModules } from './SimCore';

export interface SimHost {
  readonly kind: 'local' | 'loopback' | 'worker';
  readonly ready: Promise<void>;
  readonly state: CityState;
  readonly events: Emitter<CityEvents>;
  /** Simulation compatibility during W0; narrowed as commands, queries and views migrate. */
  readonly sim: Simulation;
  readonly actions: CityActionsApi;
  readonly speed: number;
  readonly liveSlowdown: number;
  simTime(): number;
  secondsPerDay(): number;
  frame(dt: number): void;
  dispose(): Promise<void>;
}

export interface LocalSimHostOptions {
  rctx?: RegionContext | null;
  initialSpeed?: number;
  errors?: SimErrors;
}

/** Broken lazy imports must not take down the city screen: the local host keeps its stand-ins. */
const SIM_MODULES = import.meta.glob(['../sim/systems/index.ts', '../sim/actions.ts']);

export class LocalSimHost implements SimHost {
  readonly kind = 'local';
  readonly actions: ActionsProxy;
  private core: SimCore;
  private rctx: RegionContext | null;
  private started = false;
  private resolveReady!: () => void;
  private rejectReady!: (e: unknown) => void;
  readonly ready = new Promise<void>((resolve, reject) => {
    this.resolveReady = resolve;
    this.rejectReady = reject;
  });

  constructor(state: CityState, opts: LocalSimHostOptions = {}) {
    this.core = new SimCore(state, opts.errors);
    this.rctx = opts.rctx ?? null;
    if (opts.initialSpeed !== undefined) this.sim.speed = opts.initialSpeed;
    this.actions = new ActionsProxy(new FallbackActions(this.sim));
  }

  get sim(): Simulation { return this.core.sim; }
  get state(): CityState { return this.sim.state; }
  get events(): Emitter<CityEvents> { return this.sim.events; }
  get speed(): number { return this.sim.speed; }
  get liveSlowdown(): number { return this.sim.liveSlowdown; }
  get degradedActions(): boolean { return this.core.actions === null; }
  simTime(): number { return this.sim.simTime(); }
  secondsPerDay(): number { return this.sim.secondsPerDay(); }

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
      ]) as [Pick<SimModules, 'createSystems'> | null | undefined, Pick<SimModules, 'CityActions'> | null | undefined];
      if (this.core.isDisposed) return;
      this.core.boot(this.rctx, { createSystems: sysMod?.createSystems, CityActions: actMod?.CityActions });
      if (this.core.actions) this.actions.target = this.core.actions;
      this.resolveReady();
    } catch (e) {
      this.rejectReady(e);
    }
    return this.ready;
  }

  frame(dt: number): void { this.core.frame(dt); }

  dispose(): Promise<void> {
    this.core.dispose();
    this.rctx = null;
    this.resolveReady(); // an exit while imports are pending must not leave awaiters hanging
    return Promise.resolve();
  }
}
