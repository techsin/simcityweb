/** The headless simulation shared by hosts: region effects, guarded systems and authoritative actions. */
import { trackRegionEffects, type RegionContext } from '../region/regionEffects';
import type { CityActionsApi } from '../sim/actions';
import type { CityState } from '../sim/CityState';
import { Simulation, type SimSystem } from '../sim/Simulation';

export interface SimErrors {
  report(title: string, err: unknown, opts?: { key?: string; sim?: boolean }): void;
}

export interface SimModules {
  createSystems?: () => SimSystem[];
  CityActions?: new (sim: Simulation) => CityActionsApi;
}

export class SimCore {
  readonly sim: Simulation;
  actions: CityActionsApi | null = null;
  private booted = false;
  private disposed = false;
  private offRegion: (() => void) | null = null;
  /** Cleared at dispose: a retained system must not reach the scene or its HUD (close-out c4). */
  private guard: { errors: SimErrors | null };

  constructor(state: CityState, errors?: SimErrors) {
    this.sim = new Simulation(state, []);
    this.guard = { errors: errors ?? null };
  }

  get isDisposed(): boolean { return this.disposed; }

  /** The empty sim is available to the HUD before the lazy system / action modules finish loading. */
  boot(rctx: RegionContext | null, mods: SimModules): void {
    if (this.booted || this.disposed) return;
    // trackRegionEffects applies the entry values before subscribing to 'month', ahead of system init.
    if (rctx) this.offRegion = trackRegionEffects(this.sim, rctx);
    let systems: SimSystem[] = [];
    try {
      systems = mods.createSystems?.() ?? [];
    } catch (e) {
      this.report('Simulation systems failed to start', e, { sim: true });
    }
    for (const s of systems) {
      this.guardSystem(s);
      this.sim.systems.push(s);
    }
    for (const s of systems) s.init?.(this.sim);
    const Ctor = mods.CityActions;
    if (typeof Ctor === 'function') {
      try {
        this.actions = new Ctor(this.sim);
      } catch (e) {
        this.report('CityActions failed to construct — using stand-in actions', e);
      }
    }
    this.booted = true;
  }

  frame(dt: number): void {
    if (this.booted && !this.disposed) this.sim.update(dt);
  }

  report(title: string, err: unknown, opts?: { key?: string; sim?: boolean }): void {
    this.guard.errors?.report(title, err, opts);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.guard.errors = null;
    this.offRegion?.();
    this.offRegion = null;
  }

  private guardSystem(s: SimSystem): void {
    const methods = ['init', 'daily', 'monthly', 'yearly', 'frame'] as const;
    // The wrappers hold only the cleared holder, never the core, scene or error overlay itself.
    const guard = this.guard;
    for (const m of methods) {
      const f = s[m] as ((...a: unknown[]) => void) | undefined;
      if (typeof f !== 'function') continue;
      let errors = 0;
      const report = (e: unknown) => {
        errors++;
        guard.errors?.report(`Simulation system “${s.name}” failed (${m})${errors > 20 ? ' — disabled' : ''}`, e, { key: `sys:${s.name}:${m}`, sim: true });
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
}
