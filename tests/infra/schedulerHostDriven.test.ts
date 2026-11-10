/**
 * W1.2's host-driven scheduler mode (src/sim/infra/scheduler.ts: beginFrame / stepOnce / endFrame), which the worker
 * runs one step per task: the same selection as run() (urgent first, then least-served within the frame budget, then
 * the credit renormalisation), and the time the host spends between two steps (commands, reads, other units) is not
 * charged to the frame's budget. B2 rebases its scheduler work onto this mode (NOTE-044).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Simulation } from '../../src/sim/Simulation';
import { InfraScheduler, type InfraTask } from '../../src/sim/infra/scheduler';
import { INFRA_FRAME_BUDGET_MS } from '../../src/sim/infra/params';

/** the scheduler's clock (nowMs reads performance.now): steps advance it by their real cost */
let clock = 0;
afterEach(() => { vi.restoreAllMocks(); });

/** Tasks with real costs in ms on the test clock, due a fixed number of times; 'edit' is urgent for its first steps. */
function tasks(log: string[]): InfraTask[] {
  const make = (name: string, ms: number, count: number, urgentFor = 0): InfraTask => {
    let done = 0;
    return {
      name,
      due: () => done < count,
      urgent: () => done < urgentFor,
      cost: () => ms,
      step: () => { done++; clock += ms; log.push(name); },
    };
  };
  return [make('traffic', 0.5, 60), make('utilities', 1.2, 14), make('services', 2, 8), make('edit', 0.7, 6, 3)];
}
function scheduler(log: string[], hostDriven: boolean): InfraScheduler {
  const s = new InfraScheduler();
  s.hostDriven = hostDriven;
  for (const t of tasks(log)) s.register(t);
  return s;
}
const credits = (s: InfraScheduler) => [...(s as unknown as { credit: number[] }).credit];
const sim = {} as Simulation;

describe('InfraScheduler host-driven mode (W1.2)', () => {
  it('a beginFrame / stepOnce drain selects exactly the steps of run(), frame by frame, with the same credits', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const localLog: string[] = [], hostLog: string[] = [];
    const local = scheduler(localLog, false), host = scheduler(hostLog, true), owner = {};
    for (let frame = 0; frame < 12; frame++) {
      const a = localLog.length, b = hostLog.length;
      local.tickFrame(sim, owner); // run(sim, INFRA_FRAME_BUDGET_MS, true) in one go
      clock += 16;
      host.tickFrame(sim, owner); // only stamps the frame: the host runs the steps
      expect(hostLog.length, 'tickFrame runs no step in host-driven mode').toBe(b);
      host.beginFrame(sim);
      let tasksRun = 0;
      while (host.stepOnce()) tasksRun++;
      expect(host.stepOnce(), 'the frame is over').toBe(false);
      expect(hostLog.slice(b), `frame ${frame}`).toEqual(localLog.slice(a));
      expect(tasksRun, 'one step per stepOnce').toBe(hostLog.length - b);
      expect(credits(host), `credits after frame ${frame}`).toEqual(credits(local));
      clock += 16;
    }
    // the budget bounded the least-served loop in some frame (otherwise this test proves little)
    expect(localLog.length).toBeGreaterThan(12);
    expect(localLog.length).toBeLessThan(60 + 14 + 8 + 6);
  });

  it('time spent between two steps (the worker\'s commands and other units) is not charged to the frame budget', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const localLog: string[] = [], hostLog: string[] = [];
    const local = scheduler(localLog, false), host = scheduler(hostLog, true), owner = {};
    let longest = 0;
    for (let frame = 0; frame < 12; frame++) {
      const a = localLog.length, b = hostLog.length;
      local.tickFrame(sim, owner);
      clock += 16;
      host.tickFrame(sim, owner);
      host.beginFrame(sim);
      // more than the whole frame budget passes between every two steps
      while (host.stepOnce()) clock += INFRA_FRAME_BUDGET_MS + 2;
      expect(hostLog.slice(b), `frame ${frame}`).toEqual(localLog.slice(a));
      if (frame > 0) longest = Math.max(longest, hostLog.length - b); // frame 0's urgent steps are not budgeted
      clock += 16;
    }
    expect(longest, 'a later frame ran several least-served steps despite the delays').toBeGreaterThan(2);
  });

  it('endFrame abandons the frame in progress, and beginFrame starts a fresh selection', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const log: string[] = [];
    const host = scheduler(log, true);
    host.beginFrame(sim);
    expect(host.stepOnce()).toBe(true);
    host.endFrame();
    expect(host.stepOnce(), 'no frame in progress').toBe(false);
    expect(log).toEqual(['edit']);
    host.beginFrame(sim);
    while (host.stepOnce()) { /* drain */ }
    expect(log.slice(0, 3), 'the urgent edit finishes first').toEqual(['edit', 'edit', 'edit']);
  });
});
