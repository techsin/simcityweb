/** The headless simulation shared by hosts: region effects, guarded systems and authoritative actions. */
import { trackRegionEffects, type RegionContext } from '../region/regionEffects';
import type { CityActionsApi } from '../sim/actions';
import { BF, type CityState } from '../sim/CityState';
import type { DisastersSystem, DisasterKind } from '../sim/infra/disasters';
import type { EmergencySystem } from '../sim/infra/emergency';
import { Simulation, type SimSystem } from '../sim/Simulation';
import { applySimWasmFlag } from '../wasm/simWasm';
import type { Command, CommandOp, CommandResult } from './SimHost';

/** The page's flags, passed at init (WORKER_DESIGN §1). */
export interface SimFlags {
  /** ?simwasm=…; null keeps the blur kernel on JS (WASM_PLAN PI-6) */
  simwasm: string | null;
}

export interface SimErrors {
  report(title: string, err: unknown, opts?: { key?: string; sim?: boolean }): void;
}

export interface SimModules {
  createSystems?: () => SimSystem[];
  CityActions?: new (sim: Simulation) => CityActionsApi;
}

export class SimCore {
  readonly sim: Simulation;
  readonly flags: SimFlags;
  actions: CityActionsApi | null = null;
  private booted = false;
  private disposed = false;
  private offRegion: (() => void) | null = null;
  private pausedFrom = 1;
  /** Cleared at dispose: a retained system must not reach the scene or its HUD (close-out c4). */
  private guard: { errors: SimErrors | null };

  constructor(state: CityState, errors?: SimErrors, flags: SimFlags = { simwasm: null }) {
    this.sim = new Simulation(state, []);
    this.guard = { errors: errors ?? null };
    this.flags = flags;
  }

  get isDisposed(): boolean { return this.disposed; }

  /** The empty sim is available to the HUD before the lazy system / action modules finish loading. */
  boot(rctx: RegionContext | null, mods: SimModules): void {
    if (this.booted || this.disposed) return;
    // The flag picks the kernels before any system runs; without one the kernel defaults hold.
    if (this.flags.simwasm != null) applySimWasmFlag(this.flags.simwasm);
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

  /** Commands run synchronously between local ticks, through the same authoritative actions as before. */
  applyCommand(cmd: Command, actions: CityActionsApi): CommandResult<CommandOp> {
    if (this.disposed) throw new Error('Simulation core is disposed');
    const sim = this.sim, st = sim.state;
    switch (cmd.op) {
      case 'zone': return actions.zone(...cmd.args);
      case 'dezone': return actions.dezone(...cmd.args);
      case 'bulldoze': return actions.bulldoze(...cmd.args);
      case 'buildNetwork': return actions.buildNetwork(...cmd.args);
      case 'buildPowerLine': return actions.buildPowerLine(...cmd.args);
      case 'buildSubway': return actions.buildSubway(...cmd.args);
      case 'plop': return actions.plop(...cmd.args);
      case 'terraform': return actions.terraform(...cmd.args);
      case 'plantTrees': return actions.plantTrees(...cmd.args);
      case 'setTax': return actions.setTax(...cmd.args);
      case 'setFunding': return actions.setFunding(...cmd.args);
      case 'setOrdinance': return actions.setOrdinance(...cmd.args);
      case 'takeLoan': return actions.takeLoan(...cmd.args);
      case 'repayLoan': {
        const [index, guard] = cmd.args;
        const loan = st.budget.loans[index];
        if (loan && (loan.principal !== guard.principal || loan.monthsLeft !== guard.monthsLeft)) {
          return { ok: false, cost: 0, reason: 'Loan changed — refresh and try again' };
        }
        return actions.repayLoan(index);
      }
      case 'setHistoric': {
        const [id, on] = cmd.args;
        const b = st.buildings.get(id);
        if (b && !!(b.flags & BF.Historic) !== on) actions.toggleHistoric(id);
        return;
      }
      case 'setSpeed': {
        const [speed, source] = cmd.args;
        if (speed === 0 && source === 'pause') this.pausedFrom = sim.speed;
        sim.speed = speed;
        return;
      }
      case 'resume': sim.speed = this.pausedFrom; return;
      case 'dispatch': return sim.getSystem<EmergencySystem>('emergency')?.dispatch(sim, ...cmd.args) ?? { ok: false, reason: 'Emergency services unavailable' };
      case 'dispatchBest': return sim.getSystem<EmergencySystem>('emergency')?.dispatchBest(sim, ...cmd.args) ?? { ok: false, reason: 'Emergency services unavailable' };
      case 'triggerDisaster': {
        const [kind, x, z] = cmd.args;
        return sim.getSystem<DisastersSystem>('disasters')?.trigger(sim, kind as DisasterKind, x, z) ?? false;
      }
      case 'setCamera': st.systemData.camera = cmd.args[0]; return;
    }
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
