/** Auxiliary building work shares the geometry deadline without changing the unregistered path. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAllModels } from '../../src/assets/builders';
import { CELL_SIZE } from '../../src/core/constants';
import { BuildingRenderer, type BudgetedWork } from '../../src/render/city/buildings/BuildingRenderer';
import { TileCuller } from '../../src/render/city/common/batch';
import type { Building } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { createCityState } from '../../src/sim/terrainGen';

registerAllModels();

type Entry = { id: number };
type Internals = {
  buildQueue: Set<Entry>; buildOrder: Entry[]; buildAt: number; disposed: boolean;
  addBudgetedWork<T extends BudgetedWork>(work: T): T;
  orderBuilds(): void;
  buildNow(entry: Entry): void;
  drainBuilds(all?: boolean): void;
};
const inside = (br: BuildingRenderer) => br as unknown as Internals;
const renderers = new Set<BuildingRenderer>();

afterEach(() => {
  vi.restoreAllMocks();
  for (const br of renderers) br.dispose();
  renderers.clear();
});

function town() {
  const state = createCityState(defaultCityConfig({ size: 64, seed: 7, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
  state.heights.fill(0);
  const br = new BuildingRenderer(state, new TileCuller(64, CELL_SIZE, 16));
  renderers.add(br);
  return br;
}

function building(id: number): Building {
  return { id, def: 'res_cottage', x: 8 + id * 3 % 44, z: 8, w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 0 } as Building;
}

/** Geometry and fake tasks advance the clock; deadline behavior does not depend on machine speed. */
function clocked(br: BuildingRenderer, cost: number) {
  let now = 0;
  const trace: string[] = [], reads: number[] = [];
  vi.spyOn(performance, 'now').mockImplementation(() => { reads.push(now); return now; });
  const internal = inside(br), build = internal.buildNow.bind(br);
  vi.spyOn(internal, 'buildNow').mockImplementation((entry) => {
    build(entry);
    trace.push(`build:${entry.id}`);
    now += cost;
  });
  return { trace, reads, time: () => now, advance: (ms: number) => { now += ms; } };
}

function work(timer: ReturnType<typeof clocked>, name: string, cost: number, initial: number) {
  let left = initial;
  return {
    pending: vi.fn(() => left > 0),
    step: vi.fn(() => {
      if (!left) return false;
      left--;
      timer.trace.push(name);
      timer.advance(cost);
      return true;
    }),
    clear: vi.fn(() => { left = 0; }),
    enqueue: (count: number) => { left += count; },
    left: () => left,
  } satisfies BudgetedWork & { enqueue(count: number): void; left(): number };
}

/** The pre-hook drain is the compatibility reference, including clock checks and cancelled wave entries. */
function originalDrain(br: BuildingRenderer, all = false) {
  const internal = inside(br);
  if (!internal.buildQueue.size || internal.disposed) return;
  const end = performance.now() + 2;
  let done = 0;
  while (internal.buildQueue.size) {
    if (done > 0 && !all && performance.now() >= end) break;
    if (internal.buildAt >= internal.buildOrder.length) {
      internal.orderBuilds();
      if (done > 0 && !all && performance.now() >= end) break;
    }
    const entry = internal.buildOrder[internal.buildAt++];
    if (!internal.buildQueue.has(entry)) continue;
    internal.buildNow(entry);
    done++;
  }
  if (!internal.buildQueue.size) { internal.buildOrder.length = 0; internal.buildAt = 0; }
}

describe('BuildingRenderer shared budget work', () => {
  for (const cost of [0.65, 3.25]) it(`preserves build order, frame counts and clock checks with no registered work (${cost} ms entries)`, () => {
    const current = town(), reference = town();
    const run = (br: BuildingRenderer, drain: () => void) => {
      const timer = clocked(br, cost), frames: string[][] = [];
      for (let id = 1; id <= 12; id++) br.add(building(id));
      for (let frame = 0; br.pendingBuilds && frame < 30; frame++) {
        const start = timer.trace.length;
        drain();
        frames.push(timer.trace.slice(start));
        if (!frame) {
          br.remove(8);
          br.add({ ...building(8), variant: 2 });
          br.changed({ ...building(1), variant: 1 });
        }
      }
      expect(br.pendingBuilds).toBe(0);
      const readsBeforeEmpty = timer.reads.length;
      drain();
      expect(timer.reads).toHaveLength(readsBeforeEmpty);
      return { frames, reads: timer.reads, count: br.count };
    };
    const expected = run(reference, () => originalDrain(reference));
    const actual = run(current, () => inside(current).drainBuilds());
    expect(actual).toEqual(expected);
  });

  it('registers and returns field work without running it before a frame', () => {
    const br = town(), timer = clocked(br, 3), task = work(timer, 'field', 3, 1);
    expect(inside(br).addBudgetedWork(task)).toBe(task);
    expect(task.pending).not.toHaveBeenCalled();
    expect(task.step).not.toHaveBeenCalled();
    expect(task.clear).not.toHaveBeenCalled();
    br.update(0);
    expect(timer.trace).toEqual(['field']);
    expect(task.left()).toBe(0);
    expect(br.count).toBe(0);
  });

  it('alternates builds and round-robin works across frames that admit only one unit', () => {
    const br = town(), timer = clocked(br, 3), internal = inside(br);
    const a = internal.addBudgetedWork(work(timer, 'A', 3, 2));
    const b = internal.addBudgetedWork(work(timer, 'B', 3, 2));
    for (const id of [1, 2, 3]) br.add(building(id));
    for (let frame = 0; frame < 7; frame++) {
      const start = timer.time(), count = timer.trace.length;
      internal.drainBuilds();
      expect(timer.trace.length - count).toBe(1);
      expect(timer.time() - start).toBe(3);
    }
    expect(timer.trace).toEqual(['build:1', 'A', 'build:2', 'B', 'build:3', 'A', 'B']);
    expect(br.pendingBuilds).toBe(0);
    expect(a.left() + b.left()).toBe(0);
  });

  it('charges builds and work to one deadline and admits at most one unit beyond it', () => {
    const br = town(), timer = clocked(br, 0.75), internal = inside(br);
    const a = internal.addBudgetedWork(work(timer, 'A', 0.75, 3));
    const b = internal.addBudgetedWork(work(timer, 'B', 0.75, 3));
    for (let id = 1; id <= 6; id++) br.add(building(id));
    let frames = 0;
    while ((br.pendingBuilds || a.left() || b.left()) && frames++ < 12) {
      const start = timer.time(), count = timer.trace.length;
      internal.drainBuilds();
      expect(timer.trace.length - count).toBeGreaterThan(0);
      expect(timer.time() - start).toBeLessThanOrEqual(2 + 0.75);
      if (frames === 1) expect(timer.trace).toEqual(['build:1', 'A', 'build:2']);
      if (frames === 2) expect(timer.trace.slice(3)).toEqual(['B', 'build:3', 'A']);
    }
    expect(br.pendingBuilds).toBe(0);
    expect(a.left() + b.left()).toBe(0);
    expect(timer.trace).toHaveLength(12);
  });

  it('does not starve either work or an older build wave during steady arrivals', () => {
    const br = town(), timer = clocked(br, 3), internal = inside(br);
    const a = internal.addBudgetedWork(work(timer, 'A', 3, 4));
    const b = internal.addBudgetedWork(work(timer, 'B', 3, 4));
    for (let id = 1; id <= 4; id++) br.add(building(id));
    for (let frame = 0; frame < 12; frame++) {
      br.add(building(100 + frame * 2));
      br.add(building(101 + frame * 2));
      internal.drainBuilds();
      if (frame === 7) expect(timer.trace).toEqual(['build:1', 'A', 'build:2', 'B', 'build:3', 'A', 'build:4', 'B']);
    }
    expect(a.step).toHaveBeenCalledTimes(3);
    expect(b.step).toHaveBeenCalledTimes(3);
    expect(br.pendingBuilds).toBeGreaterThan(0);
    internal.drainBuilds(true);
    expect(br.pendingBuilds).toBe(0);
    expect(a.left() + b.left()).toBe(0);
    expect(timer.trace.filter((entry) => entry.startsWith('build:'))).toHaveLength(28);
  });

  it('drains all builds and works synchronously when requested', () => {
    const br = town(), timer = clocked(br, 3), internal = inside(br);
    const a = internal.addBudgetedWork(work(timer, 'A', 3, 3));
    const b = internal.addBudgetedWork(work(timer, 'B', 3, 2));
    for (let id = 1; id <= 5; id++) br.add(building(id));
    internal.drainBuilds(true);
    expect(timer.trace).toEqual(['build:1', 'A', 'build:2', 'B', 'build:3', 'A', 'build:4', 'B', 'build:5', 'A']);
    expect(timer.time()).toBe(30);
    expect(br.count).toBe(5);
    expect(br.pendingBuilds).toBe(0);
    expect(a.left() + b.left()).toBe(0);
  });

  it('skips idle and unsuccessful works without blocking later works or looping on all', () => {
    const br = town(), timer = clocked(br, 3), internal = inside(br);
    const idle = internal.addBudgetedWork(work(timer, 'idle', 3, 0));
    const stalled = internal.addBudgetedWork({ pending: vi.fn(() => true), step: vi.fn(() => false), clear: vi.fn() });
    const active = internal.addBudgetedWork(work(timer, 'active', 3, 2));
    br.add(building(1));
    internal.drainBuilds(true);
    expect(timer.trace).toEqual(['build:1', 'active', 'active']);
    expect(idle.step).not.toHaveBeenCalled();
    expect(stalled.step).toHaveBeenCalled();
    expect(active.left()).toBe(0);
    internal.drainBuilds(true);
    expect(timer.trace).toHaveLength(3);
    expect(br.pendingBuilds).toBe(0);
  });

  it('rechecks the deadline after an unsuccessful work attempt before another unit', () => {
    const br = town(), timer = clocked(br, 0.75), internal = inside(br);
    const stalled = internal.addBudgetedWork({
      pending: vi.fn(() => true),
      step: vi.fn(() => {
        timer.trace.push('A:attempt');
        timer.advance(1.5);
        return false;
      }),
      clear: vi.fn(),
    });
    const active = internal.addBudgetedWork(work(timer, 'B', 0.75, 2));
    for (const id of [1, 2, 3]) br.add(building(id));
    internal.drainBuilds();
    expect(timer.trace).toEqual(['build:1', 'A:attempt']);
    expect(timer.time()).toBe(2.25);
    expect(active.step).not.toHaveBeenCalled();
    expect(br.pendingBuilds).toBe(2);
    internal.drainBuilds();
    expect(timer.trace.slice(2, 4)).toEqual(['B', 'build:2']);
    internal.drainBuilds(true);
    expect(br.pendingBuilds).toBe(0);
    expect(active.left()).toBe(0);
    expect(timer.trace.filter((entry) => entry.startsWith('build:'))).toEqual(['build:1', 'build:2', 'build:3']);
    expect(stalled.step).toHaveBeenCalled();
    const before = timer.trace.length;
    internal.drainBuilds(true);
    expect(timer.trace.slice(before)).toEqual(['A:attempt']);
  });

  it('clears every work, resets fairness and preserves registrations for the next city', () => {
    const br = town(), timer = clocked(br, 3), internal = inside(br);
    const a = internal.addBudgetedWork(work(timer, 'A', 3, 1));
    const b = internal.addBudgetedWork(work(timer, 'B', 3, 1));
    br.add(building(1)); br.add(building(2)); br.add(building(3));
    for (let frame = 0; frame < 3; frame++) internal.drainBuilds();
    expect(timer.trace).toEqual(['build:1', 'A', 'build:2']);
    br.clear();
    expect(a.clear).toHaveBeenCalledTimes(1);
    expect(b.clear).toHaveBeenCalledTimes(1);
    expect(a.left() + b.left()).toBe(0);
    expect(br.pendingBuilds).toBe(0);
    expect(br.count).toBe(0);
    timer.trace.length = 0;
    a.enqueue(1); b.enqueue(1);
    br.add(building(4));
    internal.drainBuilds(true);
    expect(timer.trace).toEqual(['build:4', 'A', 'B']);
    expect(a.left() + b.left()).toBe(0);
  });

  it('clears all registered works before disposing renderer resources', () => {
    const br = town(), timer = clocked(br, 3), internal = inside(br);
    const a = internal.addBudgetedWork(work(timer, 'A', 3, 1));
    const b = internal.addBudgetedWork(work(timer, 'B', 3, 1));
    const dispose = br.batch.dispose.bind(br.batch);
    vi.spyOn(br.batch, 'dispose').mockImplementation(() => {
      expect(a.clear).toHaveBeenCalledTimes(1);
      expect(b.clear).toHaveBeenCalledTimes(1);
      dispose();
    });
    br.add(building(1));
    br.dispose();
    renderers.delete(br);
    expect(a.left() + b.left()).toBe(0);
    expect(br.pendingBuilds).toBe(0);
    internal.drainBuilds(true);
    expect(timer.trace).toEqual([]);
  });
});
