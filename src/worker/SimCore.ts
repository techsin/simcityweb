/** The headless simulation shared by hosts: region effects, guarded systems and authoritative actions. */
import { trackRegionEffects, type RegionContext } from '../region/regionEffects';
import type { CityActionsApi } from '../sim/actions';
import { BF, type CityState } from '../sim/CityState';
import type { DisastersSystem, DisasterKind } from '../sim/infra/disasters';
import type { EmergencySystem } from '../sim/infra/emergency';
import { Simulation, type SimSystem } from '../sim/Simulation';
import { applySimWasmFlag } from '../wasm/simWasm';
import type { Command, CommandOp, CommandResult } from './SimHost';
import { runQuery, watchSignature, type QueryName, type QueryArgs, type QueryResult, type WatchPolicy } from './queries';
// W0.4: headless policy and its read-only host view.
import { Emitter } from '../core/events';
import { AlertQueue, LIVE_IDLE, followingDispatch, pendingCount, sendDays, speedPolicy, unbanneredPrompt, urgentSeconds, type LiveState, type PolicyAlert } from '../game/emergencyPolicy';
import type { EmergencyEvent } from '../sim/Simulation';
import type { Incident } from '../sim/infra/emergency';
import type { PolicySnapshot, PolicyView, SimSettings } from './SimHost';
// W0.6: authoritative save copies and IDB only; browser recovery composition stays in LocalSimHost.
import { createCityRecord, putCityRecord, type CityRecord } from '../save/cities';
import { openKV } from '../save/db';
import { cityFingerprint } from '../save/fingerprint';
import { clearRecoveryAfterSave } from '../save/recoveryIdb';
import { summarizeCity } from '../region/citySummary';
import type { RegionCitySummary } from '../region/types';

export interface CitySaveCopy { record: CityRecord; fp: string; summary: RegionCitySummary }

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
  // W0.4: the host's city lifetime also owns policy listeners and queued flushes.
  private abort = new AbortController();
  readonly livePolicy: LivePolicy;

  constructor(state: CityState, errors?: SimErrors, flags: SimFlags = { simwasm: null }) {
    this.sim = new Simulation(state, []);
    this.guard = { errors: errors ?? null };
    this.flags = flags;
    this.livePolicy = new LivePolicy(this.sim, this.abort.signal);
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
    this.livePolicy.attach();
    this.booted = true;
  }

  frame(dt: number): void {
    if (this.booted && !this.disposed) {
      this.livePolicy.tick();
      this.sim.update(dt);
    }
  }

  // W0.3: headless reads; no command, stepping or policy state changes here.
  runQuery<K extends QueryName>(name: K, args: QueryArgs<K>): QueryResult<K> {
    if (this.disposed) throw new Error('Simulation core is disposed');
    return runQuery(this.sim, name, args);
  }

  querySignature<K extends QueryName>(name: K, args: QueryArgs<K>, when: WatchPolicy, commands: number): string {
    return `${this.booted}:${watchSignature(this.sim, name, args, when, commands)}`;
  }

  // W0.6: all values describing a save are captured in the same synchronous unit.
  copySave(regionId: string, tileKey: string): CitySaveCopy {
    if (this.disposed) throw new Error('Simulation core is disposed');
    const st = this.sim.state;
    return { record: createCityRecord(regionId, tileKey, st), fp: cityFingerprint(st), summary: summarizeCity(st) };
  }

  async putSave(copy: CitySaveCopy): Promise<boolean> {
    const kv = await openKV(), rec = copy.record;
    await putCityRecord(kv, rec);
    return clearRecoveryAfterSave(kv, rec.regionId, rec.tileKey, rec.savedAt).catch(() => false);
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
      case 'dispatch': {
        const result = sim.getSystem<EmergencySystem>('emergency')?.dispatch(sim, ...cmd.args) ?? { ok: false, reason: 'Emergency services unavailable' };
        this.livePolicy.apply();
        return result;
      }
      case 'dispatchBest': {
        const result = sim.getSystem<EmergencySystem>('emergency')?.dispatchBest(sim, ...cmd.args) ?? { ok: false, reason: 'Emergency services unavailable' };
        this.livePolicy.apply();
        return result;
      }
      case 'triggerDisaster': {
        const [kind, x, z] = cmd.args;
        return sim.getSystem<DisastersSystem>('disasters')?.trigger(sim, kind as DisasterKind, x, z) ?? false;
      }
      case 'setCamera': st.systemData.camera = cmd.args[0]; return;
      // W0.4: only the policy owner changes dismissals and simulation settings.
      case 'dismissAlert': this.livePolicy.dismiss(cmd.args[0]); return;
      case 'setSettings': this.livePolicy.setSettings(cmd.args[0]); return;
    }
  }

  report(title: string, err: unknown, opts?: { key?: string; sim?: boolean }): void {
    this.guard.errors?.report(title, err, opts);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.guard.errors = null;
    this.abort.abort('dispose');
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

// ------------------------------------------------------------------------------------------------ W0.4 LIVE policy
interface LiveAlert extends PolicyAlert { inc: Incident; closeAt: number }

/** Owns the old banner policy without a DOM, UI clock, settings object or scene reference. */
export class LivePolicy {
  readonly view: PolicyView;
  private snapshot: PolicySnapshot = { alerts: [], live: false };
  private changes = new Emitter<{ change: PolicySnapshot }>();
  private settings: SimSettings = { emergencyUncovered: 'live', emergencyLiveSlowmo: 3, emergencyAlerts: 'major' };
  private queue = new AlertQueue();
  private alerts = new Map<number, LiveAlert>();
  private dismissed = new Set<number>();
  private incoming = new Set<number>();
  private live: LiveState = { ...LIVE_IDLE };
  private trigger = false;
  private episodeBad = false;
  private scanned = false;
  private attached = false;
  private flushQueued = false;

  constructor(private sim: Simulation, private signal: AbortSignal) {
    const self = this;
    this.view = {
      get alerts() { return self.snapshot.alerts; },
      get live() { return self.snapshot.live; },
      get toast() { return self.snapshot.toast; },
      get warn() { return self.snapshot.warn; },
      subscribe(listener, signal) {
        if (signal.aborted || self.signal.aborted) return () => {};
        const off = self.changes.on('change', listener);
        const stop = () => { off(); signal.removeEventListener('abort', stop); };
        signal.addEventListener('abort', stop, { once: true });
        return stop;
      },
    };
  }

  /** Called after system init and CityActions, including when the HUD predates the lazy boot. */
  attach(): void {
    if (this.attached || this.signal.aborted) return;
    this.attached = true;
    const off = this.sim.events.on('emergency', (e) => this.onEvent(e));
    const offReset = this.sim.events.on('reset', () => this.boot());
    this.signal.addEventListener('abort', () => {
      off(); offReset();
      this.changes.clear();
      this.alerts.clear();
      this.incoming.clear();
      this.dismissed.clear();
      this.queue.clear();
      this.snapshot = { alerts: [], live: false };
    }, { once: true });
    this.boot();
  }

  /** A loaded city's waiting incidents re-raise; neither dismissals nor episodes are saved. */
  boot(): void {
    if (this.signal.aborted) return;
    this.queue.clear();
    this.alerts.clear();
    this.dismissed.clear();
    this.incoming.clear();
    this.live = { ...LIVE_IDLE };
    this.sim.liveSlowdown = 1;
    this.trigger = this.episodeBad = this.scanned = false;
    this.publish();
    this.rescan();
  }

  setSettings(settings: SimSettings): void {
    this.settings = { ...settings }; // commands never retain the page's mutable settings
    this.apply();
  }

  dismiss(id: number): void {
    if (!this.alerts.has(id) || this.signal.aborted) return;
    this.dismissed.add(id);
    const inc = this.sim.getSystem<EmergencySystem>('emergency')?.incident(id);
    if (inc && (inc.state === 'uncovered' || inc.state === 'queued')) this.episodeBad = true;
    this.alerts.delete(id);
    this.queue.remove(id);
    this.apply();
  }

  private rescan(): void {
    const em = this.sim.getSystem<EmergencySystem>('emergency');
    if (!em || this.scanned) return;
    this.scanned = true;
    for (const inc of em.incidents()) {
      if (inc.state === 'uncovered' && (inc.manualPossible || inc.canSend)) this.onEvent({ type: 'uncovered', id: inc.id, kind: inc.kind, x: inc.x, z: inc.z, major: inc.major, manualPossible: inc.manualPossible });
    }
  }

  private onEvent(e: EmergencyEvent): void {
    if (e.type === 'resolved' || e.type === 'failed') {
      const inc = this.alerts.get(e.id)?.inc;
      if (inc && (e.type === 'failed' || inc.lost > 0 || inc.deaths > 0)) this.episodeBad = true;
      return;
    }
    if (e.type !== 'uncovered' || this.dismissed.has(e.id)) return;
    this.incoming.add(e.id);
    if (!this.flushQueued) {
      this.flushQueued = true;
      // EM-1: the whole disaster burst assigns its units before an alert can hold LIVE or pause.
      queueMicrotask(() => this.flush());
    }
  }

  private send(em: EmergencySystem, inc: Incident): number {
    return sendDays(inc, this.sim.simTime(), () => em.dispatchOptions(this.sim, inc.id));
  }

  private flush(): void {
    this.flushQueued = false;
    if (this.signal.aborted || !this.incoming.size) return;
    const ids = [...this.incoming];
    this.incoming.clear();
    const em = this.sim.getSystem<EmergencySystem>('emergency');
    if (!em) return;
    let raised = false, added = false;
    for (const id of ids) {
      const inc = em.incident(id);
      if (!inc || inc.state !== 'uncovered' || this.dismissed.has(id) || !(inc.manualPossible || inc.canSend)) continue;
      const possible = !Number.isNaN(this.send(em, inc));
      const shown = this.alerts.get(id);
      if (shown) {
        if (possible) { shown.wasPossible = true; this.trigger = raised = true; }
        continue;
      }
      const st = this.sim.state;
      if (!this.queue.offer({ id, kind: inc.kind, major: inc.major, manualPossible: possible }, st.day, st.stats.population, this.settings.emergencyAlerts)) continue;
      this.alerts.set(id, { id, inc, wasPossible: possible, closeAt: 0 });
      added = raised = true;
      if (possible) this.trigger = true;
    }
    if (raised) this.apply(added);
  }

  /** Every host tick, including paused ticks; also the fallback when a queued microtask has not run yet. */
  tick(): void {
    if (!this.attached || this.signal.aborted) return;
    this.rescan();
    const em = this.sim.getSystem<EmergencySystem>('emergency');
    if (em) for (const inc of em.incidents()) {
      if (unbanneredPrompt(inc, this.alerts, this.dismissed, (i) => this.send(em, i))) this.incoming.add(inc.id);
    }
    this.flush();
    const now = this.sim.simTime(), nowMs = performance.now();
    for (const [id, alert] of this.alerts) {
      const inc = em?.incident(id);
      const waiting = inc && (inc.state === 'uncovered' || inc.state === 'queued');
      if (!inc || (!waiting && !(this.settings.emergencyUncovered === 'live' && followingDispatch(inc, now)))) {
        if (!alert.closeAt) alert.closeAt = nowMs + (inc ? 4000 : 2500);
        else if (nowMs > alert.closeAt) { this.alerts.delete(id); this.queue.remove(id); }
      } else alert.closeAt = 0;
    }
    this.apply();
  }

  /** Dispatch and settings commands re-evaluate the current episode without flushing a half-finished burst. */
  apply(warn = false): void {
    if (!this.attached || this.signal.aborted) return;
    const sim = this.sim, em = sim.getSystem<EmergencySystem>('emergency');
    const incidents = em?.incidents() ?? [], now = sim.simTime();
    const send = (inc: Incident) => em ? this.send(em, inc) : NaN;
    const policy = this.settings.emergencyUncovered, slowmo = this.settings.emergencyLiveSlowmo;
    const pending = pendingCount(policy, this.alerts, incidents, this.dismissed, now, send);
    this.episodeBad ||= pending.bad;
    const was = this.live.active;
    const step = speedPolicy(policy, this.live, sim.speed, this.trigger, pending.count, slowmo, this.episodeBad, policy === 'live' ? urgentSeconds(this.alerts, incidents, this.dismissed, now, slowmo, send) : Infinity);
    this.trigger = false;
    this.live = step.state;
    if (was !== this.live.active || step.toast) this.episodeBad = false;
    if (step.speed !== undefined && step.speed !== sim.speed) sim.speed = step.speed;
    if (sim.liveSlowdown !== step.liveSlowdown) sim.liveSlowdown = step.liveSlowdown;
    this.publish(step.toast, warn);
  }

  private publish(toast?: string, warn = false): void {
    const live = this.live.active && this.live.policy === 'live';
    const alerts = [...this.alerts.values()].map(({ id, wasPossible }) => ({ id, wasPossible }));
    const before = this.snapshot;
    if (!toast && !warn && before.live === live && before.alerts.length === alerts.length && alerts.every((a, k) => a.id === before.alerts[k].id && a.wasPossible === before.alerts[k].wasPossible)) return;
    this.snapshot = { alerts, live, ...(toast ? { toast: { text: toast, kind: toast.startsWith('Emergencies handled') ? 'good' as const : 'info' as const } } : {}), ...(warn ? { warn: true as const } : {}) };
    this.changes.emit('change', this.snapshot);
  }
}
