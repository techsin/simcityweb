/**
 * InfraScheduler — one shared, deterministic work scheduler for the heavy infrastructure work (traffic assignment
 * steps, utilities, pollution, services, crime). Each system registers a task that exposes small STEPS
 * (~0.5–3 ms each on a 256² city); the scheduler decides which steps run when:
 *
 *  - headless (no frame() calls in the last 750 ms, e.g. tests / balance bots): once per sim day, round-robin over
 *    due tasks until the day's cost budget (INFRA_DAY_BUDGET, in estimated ms) is used — at least one step per day.
 *    Costs are ESTIMATES (from problem sizes), so the schedule is deterministic.
 *  - with a live renderer: every frame, round-robin over due tasks until INFRA_FRAME_BUDGET_MS of real time is used
 *    (at least one step when something is due), so no frame stalls and the per-day load spreads over frames.
 *  - urgent tasks (player edits: roads, power lines, plopped buildings) run first.
 *
 * Tasks keep their own "due" logic (periods in sim days, dirty flags, pass progress).
 */
import type { Simulation } from '../Simulation';
import { nowMs } from './common';
import { INFRA_DAY_BUDGET, INFRA_FRAME_BUDGET_MS } from './params';

export interface InfraTask {
  /** unique name ('utilities', 'traffic', ...) */
  readonly name: string;
  /** true when the task has a step to run now */
  due(sim: Simulation): boolean;
  /** true when the task should run before everything else (player edit feedback) */
  urgent(sim: Simulation): boolean;
  /** estimated cost (ms on a reference machine) of the next step */
  cost(sim: Simulation): number;
  /** run exactly one step */
  step(sim: Simulation): void;
}

export class InfraScheduler {
  readonly tasks: InfraTask[] = [];
  private pointer = 0;
  private lastDay = -1;
  private lastFrameMs = -1e9;
  private frameOwner: object | null = null;
  /** estimated cost units used per day (headless) and measured ms per task (both modes), for profiling */
  readonly spentMs = new Map<string, number>();
  lastDayCost = 0;

  register(task: InfraTask): void {
    const i = this.tasks.findIndex((t) => t.name === task.name);
    if (i >= 0) this.tasks[i] = task;
    else this.tasks.push(task);
  }

  get framesActive(): boolean {
    return nowMs() - this.lastFrameMs < 750;
  }

  /** call from every infra system's daily(); does the work once per sim day (headless mode only) */
  tickDay(sim: Simulation): void {
    const day = sim.state.day;
    if (day === this.lastDay) return;
    this.lastDay = day;
    if (this.framesActive) return;
    this.run(sim, INFRA_DAY_BUDGET, false);
  }

  /** call from every infra system's frame(); only the first caller (per frame) does the work */
  tickFrame(sim: Simulation, caller: object): void {
    if (this.frameOwner === null) this.frameOwner = caller;
    if (caller !== this.frameOwner) return;
    this.lastFrameMs = nowMs();
    this.run(sim, INFRA_FRAME_BUDGET_MS, true);
  }

  /** run every pending step now (tests / load) */
  flush(sim: Simulation, maxSteps = 10000): void {
    for (let k = 0; k < maxSteps; k++) {
      const t = this.tasks.find((x) => x.due(sim));
      if (!t) return;
      this.exec(sim, t);
    }
  }

  private exec(sim: Simulation, t: InfraTask): void {
    const t0 = nowMs();
    t.step(sim);
    this.spentMs.set(t.name, (this.spentMs.get(t.name) ?? 0) + nowMs() - t0);
  }

  private run(sim: Simulation, budget: number, realTime: boolean): void {
    const tasks = this.tasks;
    const n = tasks.length;
    if (n === 0) return;
    const t0 = nowMs();
    let spent = 0;
    let ran = 0;
    // urgent first (player edits), bounded to a few steps
    for (let k = 0; k < n && ran < 4; k++) {
      const t = tasks[k];
      if (!t.urgent(sim) || !t.due(sim)) continue;
      spent += t.cost(sim);
      this.exec(sim, t);
      ran++;
    }
    // round-robin over due tasks until the budget is used
    let guard = 0;
    let idle = 0;
    while (guard++ < 64 && idle < n) {
      const i = this.pointer % n;
      const t = tasks[i];
      if (!t.due(sim)) { this.pointer = i + 1; idle++; continue; }
      const c = t.cost(sim);
      const used = realTime ? nowMs() - t0 : spent;
      if (ran > 0 && used + (realTime ? Math.min(c, 1) : c) > budget) break;
      this.exec(sim, t);
      spent += c;
      ran++;
      idle = 0;
      this.pointer = i + 1;
    }
    this.lastDayCost = spent;
  }
}

const schedulers = new WeakMap<Simulation, InfraScheduler>();
/** the shared scheduler of a simulation (created on first use) */
export function schedulerOf(sim: Simulation): InfraScheduler {
  let s = schedulers.get(sim);
  if (!s) schedulers.set(sim, (s = new InfraScheduler()));
  return s;
}

/** size factors for cost estimates: cells / 65,536 and buildings / 20,000 */
export function sizeFactors(sim: Simulation): { cells: number; bld: number } {
  const st = sim.state;
  return { cells: st.cells / 65536, bld: Math.max(0.05, st.buildings.size / 20000) };
}
