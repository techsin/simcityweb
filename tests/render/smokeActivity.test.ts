/** FEEL-15: mirrored output refreshes share R2's budget without rebuilding building geometry. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAllModels } from '../../src/assets/builders';
import { CELL_SIZE } from '../../src/core/constants';
import { BuildingRenderer, type BudgetedWork, type BuildingVisual } from '../../src/render/city/buildings/BuildingRenderer';
import { TileCuller } from '../../src/render/city/common/batch';
import { Effects } from '../../src/render/city/effects/Effects';
import { BF, type Building } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { createCityState } from '../../src/sim/terrainGen';

registerAllModels();

const renderers: BuildingRenderer[] = [];
const effects: Effects[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const br of renderers.splice(0)) br.dispose();
  for (const fx of effects.splice(0)) fx.dispose();
});

function town() {
  const state = createCityState(defaultCityConfig({ size: 64, seed: 7, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
  state.heights.fill(0);
  const br = new BuildingRenderer(state, new TileCuller(64, CELL_SIZE, 16));
  renderers.push(br);
  const fx = new Effects();
  effects.push(fx);
  br.onVisual = (v, id) => fx.onBuilding(v, id);
  const add = (id: number, fields: Partial<Building> = {}) => {
    const b: Building = {
      id, def: 'ind_refinery.id.4', x: 8, z: 8, w: 4, d: 4, rot: 0, variant: 0,
      pop: 0, jobs: 340, capacity: 340, wealth: 0, built: 1, age: 0, flags: BF.Powered,
      baseY: 0, health: 1, unhappy: 0, ...fields,
    };
    state.buildings.set(id, b);
    br.add(b, false);
    return b;
  };
  return { state, br, fx, add };
}

type ActivityInternals = {
  activityWork: BudgetedWork;
  budgetedWorks: BudgetedWork[];
  activityOf(b: Building): number;
  activityScan: Iterator<unknown> | null;
  activityBuildings: Set<unknown>;
  activityChanged: Set<unknown>;
  build(bi: unknown): void;
};
const inside = (br: BuildingRenderer) => br as unknown as ActivityInternals;

describe('BuildingVisual output activity', () => {
  it('keeps a 0/340 refinery smokeless and uses filled jobs / capacity at the 10% boundary', () => {
    const { br, fx, add } = town();
    add(1, { jobs: 0 });
    fx.update();
    expect(br.getVisual(1)!.activity).toBe(0);
    expect(fx.particleCount).toBe(0);
    add(2, { jobs: 33 });
    add(3, { jobs: 34 });
    add(4, { jobs: 170 });
    add(5, { jobs: 500 });
    expect([2, 3, 4, 5].map((id) => br.getVisual(id)!.activity)).toEqual([0, 0.1, 0.5, 1]);
  });

  it.each([
    { flags: 0 }, { flags: BF.Powered | BF.Abandoned }, { flags: BF.Powered | BF.Burnt },
    { flags: BF.Powered | BF.Constructing }, { built: 0.5 }, { capacity: 0 }, { jobs: NaN },
  ])('has zero activity for inactive or invalid industry: %j', (fields) => {
    const { br, add } = town();
    add(1, fields);
    expect(br.getVisual(1)!.activity).toBe(0);
  });

  it('uses each plant load independently, with an idle floor and no invented load when unavailable', () => {
    const { br, add } = town();
    const loads = new Map<number, number>([[1, 0.15], [2, 1], [3, 0], [4, -1], [5, NaN], [6, 2]]);
    br.plantLoad = (id) => loads.get(id) ?? null;
    for (let id = 1; id <= 7; id++) add(id, { def: 'util_coal_plant', jobs: 180, capacity: 180 });
    expect([1, 2, 3, 4, 5, 6, 7].map((id) => br.getVisual(id)!.activity)).toEqual([0.25, 1, 0.25, 0, 0, 1, 0]);
    add(8, { def: 'util_coal_plant', jobs: 17, capacity: 180 });
    add(9, { def: 'util_coal_plant', flags: 0, jobs: 180, capacity: 180 });
    expect(br.getVisual(8)!.activity).toBe(0);
    expect(br.getVisual(9)!.activity).toBe(0);
  });

  it('refreshes silent mirrored staffing and plant load each month without allocating geometry', () => {
    const { state, br, fx, add } = town();
    let load = 0.15;
    br.plantLoad = () => load;
    const b = add(1, { jobs: 0 });
    add(2, { def: 'util_coal_plant', jobs: 180, capacity: 180 });
    br.update(0);
    const builds = vi.spyOn(inside(br), 'build'), alloc = vi.spyOn(br.batch, 'add'), free = vi.spyOn(br.batch, 'remove');
    const visual = br.getVisual(1)!;
    b.jobs = 170;
    load = 1;
    state.day = 30;
    br.update(0);
    fx.update();
    expect(br.getVisual(1)).toBe(visual);
    expect(visual.activity).toBe(0.5);
    expect(visual.activityMonth).toBe(1);
    expect(br.getVisual(2)!.activity).toBe(1);
    expect(fx.particleCount).toBeGreaterThan(0);
    expect(builds).not.toHaveBeenCalled();
    expect(alloc).not.toHaveBeenCalled();
    expect(free).not.toHaveBeenCalled();
    expect(br.pendingBuilds).toBe(0);
  });

  it('queues event-only power changes in the budget and stops plumes immediately when drained', () => {
    const { br, fx, add } = town();
    const b = add(1);
    br.update(0);
    fx.update();
    expect(fx.particleCount).toBeGreaterThan(0);
    const builds = vi.spyOn(inside(br), 'build');
    b.flags = 0;
    br.changed(b);
    expect(br.getVisual(1)!.activity).toBe(1);
    br.update(0);
    fx.update();
    expect(br.getVisual(1)!.activity).toBe(0);
    expect(fx.particleCount).toBe(0);
    expect(builds).not.toHaveBeenCalled();
  });

  it('paces monthly output work under the same 2ms deadline, even with no geometry queued', () => {
    const { state, br, add } = town();
    const buildings = Array.from({ length: 12 }, (_, i) => add(i + 1));
    br.update(0);
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const activity = inside(br).activityOf.bind(br);
    const reads = vi.spyOn(inside(br), 'activityOf').mockImplementation((b) => { now += 0.65; return activity(b); });
    for (const b of buildings) b.jobs = 170;
    state.day = 30;
    br.update(0);
    expect(reads).toHaveBeenCalledTimes(4);
    expect(now).toBeCloseTo(2.6);
    for (let frame = 0; frame < 4; frame++) br.update(0);
    expect(buildings.map((b) => br.getVisual(b.id)!.activity)).toEqual(Array(12).fill(0.5));
    expect(reads).toHaveBeenCalledTimes(12);
    br.update(0);
    expect(reads).toHaveBeenCalledTimes(12);
  });

  it('visits only output buildings and continues monthly work while new geometry arrives', () => {
    const { state, br, add } = town();
    const factory = add(1);
    for (let id = 2; id <= 8; id++) add(id, { def: 'res_cottage' });
    br.update(0);
    const reads = vi.spyOn(inside(br), 'activityOf');
    factory.jobs = 170;
    state.day = 30;
    br.add({ ...factory, id: 20, def: 'res_cottage' });
    br.update(0);
    expect(br.getVisual(1)!.activity).toBe(0.5);
    expect(reads.mock.calls.filter(([b]) => b.id < 20).map(([b]) => b.id)).toEqual([1]);
  });

  it('gives queued geometry the initial turn before an indivisible output refresh overruns the deadline', () => {
    const { state, br, add } = town();
    const factory = add(1);
    br.update(0);
    let now = 0;
    const order: string[] = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const internal = inside(br), activity = internal.activityOf.bind(br), build = internal.build.bind(br);
    vi.spyOn(internal, 'activityOf').mockImplementation((b) => {
      if (b.id === 1) { now += 3.25; order.push('activity'); }
      return activity(b);
    });
    vi.spyOn(internal, 'build').mockImplementation((bi) => { order.push('geometry'); build(bi); });
    state.day = 30;
    factory.jobs = 170;
    br.add({ ...factory, id: 20, def: 'res_cottage' });
    br.update(0);
    expect(order).toEqual(['geometry', 'activity']);
    expect(br.getVisual(20)).not.toBeNull();
    expect(br.getVisual(1)!.activity).toBe(0.5);
    expect(br.pendingBuilds).toBe(0);
    expect(now).toBe(3.25);
  });

  it('registers activity with the shared hook and charges it and queued builds to one deadline', () => {
    const { state, br, add } = town();
    const first = add(1), second = add(2);
    br.update(0);
    const internal = inside(br), work = internal.activityWork;
    expect(internal.budgetedWorks).toContain(work);
    let now = 0;
    const order: string[] = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const activity = internal.activityOf.bind(br), build = internal.build.bind(br);
    const reads = vi.spyOn(internal, 'activityOf').mockImplementation((b) => {
      if (b.id < 20) { order.push(`activity:${b.id}`); now += 0.75; }
      return activity(b);
    });
    vi.spyOn(internal, 'build').mockImplementation((bi) => {
      order.push('geometry');
      build(bi);
      now += 0.75;
    });
    const steps = vi.spyOn(work, 'step');
    first.jobs = second.jobs = 170;
    state.day = 30;
    expect(work.pending()).toBe(true);
    expect(reads).not.toHaveBeenCalled();
    for (const id of [20, 21]) br.add({ ...first, id, def: 'res_cottage' });
    br.update(0);
    expect(order).toEqual(['geometry', 'activity:1', 'geometry']);
    expect(steps).toHaveBeenCalledTimes(1);
    expect(now).toBe(2.25);
    expect(br.pendingBuilds).toBe(0);
    expect(work.pending()).toBe(true);
    br.update(0);
    expect(order).toEqual(['geometry', 'activity:1', 'geometry', 'activity:2']);
    expect(now).toBe(3);
    expect(work.pending()).toBe(false);
    expect([1, 2].map((id) => br.getVisual(id)!.activity)).toEqual([0.5, 0.5]);
    const clear = vi.spyOn(work, 'clear');
    br.clear();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(work.pending()).toBe(false);
    expect(internal.budgetedWorks).toContain(work);
  });

  it('retains the old visual while a structural change waits, and cancels stale activity on id reuse', () => {
    const { br, add } = town();
    const b = add(1);
    const old = br.getVisual(1)!;
    br.changed({ ...b, flags: BF.Powered | BF.Abandoned });
    expect(br.getVisual(1)).toBe(old);
    br.remove(1);
    add(1, { jobs: 0 });
    br.update(0);
    expect(br.getVisual(1)).not.toBe(old);
    expect(br.getVisual(1)!.activity).toBe(0);
    expect(inside(br).activityChanged.size).toBe(0);
    br.clear();
    expect(inside(br).activityScan).toBeNull();
    expect(inside(br).activityBuildings.size).toBe(0);
    expect([...br.visuals()]).toEqual([] as BuildingVisual[]);
  });
});
