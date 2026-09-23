/**
 * InfraScheduler — one shared, deterministic work scheduler for the heavy infrastructure work (traffic assignment
 * steps, utilities, pollution, services, crime). Each system registers a task that exposes small STEPS
 * (~0.5–3 ms each on a 256² city); the scheduler decides which steps run when:
 *
 *  - headless (no frame() calls in the last 750 ms, e.g. tests / balance bots): once per sim day, steps of due tasks
 *    until the day's cost budget (INFRA_DAY_BUDGET, in estimated ms) is used — at least one step per day.
 *    Costs are ESTIMATES (from problem sizes), so the schedule is deterministic.
 *  - with a live renderer: every frame, steps of due tasks until INFRA_FRAME_BUDGET_MS of real time is used
 *    (at least one step when something is due), so no frame stalls and the per-day load spreads over frames.
 *  - fairness by cost: the due task with the least recently used (estimated) time runs next, so a task with many
 *    small steps (traffic) gets the same share as one with few large steps; an idle task banks at most
 *    CREDIT_FLOOR ms of priority for when it becomes due.
 *  - urgent tasks (player edits: roads, power lines, plopped buildings) run first.
 *
 * Tasks keep their own "due" logic (periods in sim days, dirty flags, pass progress).
 */
import type { Simulation } from '../Simulation';
import { nowMs } from './common';
import { INFRA_DAY_BUDGET, INFRA_DAY_CARRY, INFRA_FRAME_BUDGET_MS } from './params';

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

/** max priority (estimated ms) an idle task can bank */
const CREDIT_FLOOR = 4;

export class InfraScheduler {
  readonly tasks: InfraTask[] = [];
  /** estimated ms used per task, relative to the least-served due task */
  private credit: number[] = [];
  private lastDay = -1;
  private carry = 0;
  private lastFrameMs = -1e9;
  private frameOwner: object | null = null;
  /** estimated cost units used per day (headless) and measured ms per task (both modes), for profiling */
  readonly spentMs = new Map<string, number>();
  lastDayCost = 0;

  register(task: InfraTask): void {
    const i = this.tasks.findIndex((t) => t.name === task.name);
    if (i >= 0) this.tasks[i] = task;
    else {
      this.tasks.push(task);
      this.credit.push(0);
    }
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
    // budget left over when the next step did not fit carries to the next day (bounded), so the average per day
    // stays ~INFRA_DAY_BUDGET while no day exceeds INFRA_DAY_BUDGET + INFRA_DAY_CARRY (except one oversized step)
    const budget = INFRA_DAY_BUDGET + this.carry;
    const spent = this.run(sim, budget, false);
    this.carry = Math.max(0, Math.min(INFRA_DAY_CARRY, budget - spent));
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

  /** run steps within `budget`; returns the estimated cost used */
  private run(sim: Simulation, budget: number, realTime: boolean): number {
    const tasks = this.tasks;
    const n = tasks.length;
    if (n === 0) return 0;
    const credit = this.credit;
    const t0 = nowMs();
    let spent = 0;
    let ran = 0;
    // urgent first (player edits: finish their passes now), bounded
    for (let rep = 0; rep < 8; rep++) {
      let k = 0;
      while (k < n && !(tasks[k].urgent(sim) && tasks[k].due(sim))) k++;
      if (k === n) break;
      const c = tasks[k].cost(sim);
      this.exec(sim, tasks[k]);
      credit[k] += c;
      spent += c;
      ran++;
    }
    // least-served due task next, until the budget is used
    for (let guard = 0; guard < 64; guard++) {
      let i = -1;
      for (let k = 0; k < n; k++) if ((i < 0 || credit[k] < credit[i]) && tasks[k].due(sim)) i = k;
      if (i < 0) break;
      const c = tasks[i].cost(sim);
      const used = realTime ? nowMs() - t0 : spent;
      if (ran > 0 && used + c > budget) break;
      this.exec(sim, tasks[i]);
      credit[i] += c;
      spent += c;
      ran++;
    }
    // renormalise: the least-served due task is at 0, idle tasks bank at most CREDIT_FLOOR
    let m = Infinity;
    for (let k = 0; k < n; k++) if (credit[k] < m && tasks[k].due(sim)) m = credit[k];
    if (m === Infinity) m = 0;
    for (let k = 0; k < n; k++) credit[k] = Math.max(-CREDIT_FLOOR, credit[k] - m);
    this.lastDayCost = spent;
    return spent;
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
