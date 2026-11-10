/**
 * T087 item 2 (REVIEW-T051 minor 4): a power plant that delivers 0 MW counts as unavailable. The sim gives it a valid
 * load of 0, which FEEL-15's plant floor max(0.25, load) drew as quarter-strength smoke whenever another plant kept it
 * powered. The local view returns null and the recorder's utilities stream sends -1 for it, so every host shows no
 * plume; NOTE-054's stream conditions (unchanged passes send nothing, a 0.005 threshold) still hold. Nothing in src/sim
 * changes: `producerInfo(id).output` is the last pass's own breakdown.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevType, Zone } from '../../src/core/types';
import { BF, CityState, type Building } from '../../src/sim/CityState';
import { CATALOG, getDef, rebuildCatalogIndex } from '../../src/sim/catalog';
import type { BuildingDef } from '../../src/sim/catalogTypes';
import { defaultCityConfig } from '../../src/sim/config';
import { UtilitiesSystem, type ProducerInfo } from '../../src/sim/infra/utilities';
import type { Simulation } from '../../src/sim/Simulation';
import { LoopbackCore } from '../../src/worker/loopbackCore';
import type { Packet, Streams } from '../../src/worker/protocol';
import { LocalSimHost } from '../../src/worker/SimHost';

const loops: LoopbackCore[] = [], hosts: LocalSimHost[] = [];
const CONSUMER: BuildingDef = {
  id: 't_t087_load_60', name: 'Test 60 MW consumer', model: 'res_cottage', category: 'growable', footprint: [1, 1],
  devType: DevType.R1, zones: [Zone.ResLow], capacity: 100, powerUse: 60, waterUse: 0,
};

afterEach(async () => {
  for (const loop of loops.splice(0)) loop.dispose();
  for (const host of hosts.splice(0)) await host.dispose();
  vi.restoreAllMocks();
});

function city(size = 64): CityState {
  if (!getDef(CONSUMER.id)) { CATALOG.push(CONSUMER); rebuildCatalogIndex(); }
  const state = new CityState(defaultCityConfig({ size, seed: 7, terrain: 'flat', disasters: false, treeDensity: 0, waterAmount: 0 }));
  state.heights.fill(5);
  return state;
}

function place(state: CityState, defId: string, x: number, z: number, fields: Partial<Building> = {}): Building {
  const def = getDef(defId)!, [w, d] = def.footprint, capacity = def.capacity ?? def.jobs ?? 0;
  const b: Building = {
    id: state.nextBuildingId++, def: defId, x, z, w, d, rot: 0, variant: 0,
    pop: def.category === 'growable' ? capacity : 0, jobs: def.jobs ?? 0, capacity,
    wealth: 1, built: 1, age: 100, flags: BF.Powered | BF.Watered, baseY: 5, health: 1, unhappy: 0, ...fields,
  };
  state.buildings.set(b.id, b);
  for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) state.building[state.idx(xx, zz)] = b.id;
  return b;
}

/** One grid: a nuclear plant (1,600 MW) and a hydro station (80 MW, no cooling water) joined by a power line, and a
 *  60 MW consumer beside the dam. The dam alone carries the consumer, so the nuclear plant stays powered when it stops. */
function nuclearTown() {
  const state = city();
  const nuclear = place(state, 'util_nuclear_plant', 4, 4);
  const hydro = place(state, 'util_hydro_dam', 4, 20);
  for (let z = nuclear.z + nuclear.d; z < hydro.z; z++) state.powerLines[state.idx(4, z)] = 1;
  const consumer = place(state, CONSUMER.id, 4, hydro.z + hydro.d);
  return { state, nuclear, hydro, consumer };
}

describe('LocalSimHost: a plant that delivers 0 MW is unavailable', () => {
  async function local(state: CityState) {
    const host = new LocalSimHost(state), utilities = new UtilitiesSystem();
    hosts.push(host);
    await host.start({ createSystems: () => [utilities] });
    return { host, utilities, load: (b: Building) => host.utilities.plantLoad!(b.id) };
  }

  it('returns null for a nuclear plant the Nuclear Free Zone shut down, and its load again after the repeal', async () => {
    const { state, nuclear, hydro } = nuclearTown();
    const { host, utilities, load } = await local(state);
    expect(utilities.producerInfo(nuclear.id)?.output).toBe(1600);
    expect(load(nuclear)).toBeCloseTo(60 / 1680, 6);
    expect(load(hydro)).toBeCloseTo(60 / 1680, 6);

    state.budget.ordinances.push('nuclear_free_zone');
    utilities.compute(host.sim);
    // shut down, still powered by the dam and fully staffed: the sim's own load is a valid 0
    expect(utilities.producerInfo(nuclear.id)).toMatchObject({ kind: 'power', nominal: 1600, output: 0 });
    expect(utilities.plantLoad(nuclear.id)).toBe(0);
    expect(nuclear.flags & BF.Powered).toBeTruthy();
    expect(load(nuclear)).toBeNull();
    expect(load(hydro)).toBeCloseTo(60 / 80, 6);

    state.budget.ordinances.length = 0;
    utilities.compute(host.sim);
    expect(utilities.producerInfo(nuclear.id)!.output).toBeGreaterThan(0);
    expect(load(nuclear)).toBe(utilities.plantLoad(nuclear.id));
    expect(load(nuclear)).toBeGreaterThan(0);
  });

  it('returns null for a burnt plant and for one still under construction, on a grid another plant powers', async () => {
    const state = city();
    const hydro = place(state, 'util_hydro_dam', 4, 20);
    const burnt = place(state, 'util_coal_plant', 4 + hydro.w, 20, { flags: BF.Powered | BF.Burnt });
    const rising = place(state, 'util_coal_plant', 4 + hydro.w + burnt.w, 20, { built: 0.5, flags: BF.Powered | BF.Constructing });
    place(state, CONSUMER.id, 4, hydro.z + hydro.d);
    const { utilities, load } = await local(state);
    for (const b of [burnt, rising]) {
      expect(utilities.producerInfo(b.id)?.output).toBe(0);
      expect(utilities.plantLoad(b.id)).toBe(0);
      expect(load(b)).toBeNull();
    }
    expect(load(hydro)).toBeCloseTo(60 / 80, 6);
  });

  it('keeps the load of a thermal plant without cooling water: its output halves, it is not a 0 MW plant', async () => {
    const state = city();
    const coal = place(state, 'util_coal_plant', 4, 20);
    place(state, CONSUMER.id, 4, coal.z + coal.d);
    const { host, utilities, load } = await local(state);
    expect(load(coal)).toBeCloseTo(60 / 400, 6);
    // the first pass found no water network: from the next pass on the plant runs at half output
    utilities.compute(host.sim);
    expect(utilities.producerInfo(coal.id)).toMatchObject({ output: 200, factors: [{ label: 'No cooling water', mul: 0.5 }] });
    expect(load(coal)).toBeCloseTo(60 / 200, 6);
  });

  it('lets the load decide when the system reports no output breakdown for the plant', async () => {
    const state = city(), host = new LocalSimHost(state);
    hosts.push(host);
    const loads = new Map<number, number>([[3, 0], [4, 0.4]]);
    // a stand-in system that only reports loads (as the stream tests use), then a real one that has run no pass
    const standIn = { name: 'utilities', plantLoad: (id: number) => loads.get(id) ?? -1 };
    host.sim.systems.push(standIn);
    expect(host.utilities.plantLoad!(3)).toBe(0);
    expect(host.utilities.plantLoad!(4)).toBe(0.4);
    expect(host.utilities.plantLoad!(5)).toBeNull();
    host.sim.systems.pop();
    const utilities = new UtilitiesSystem();
    vi.spyOn(utilities, 'plantLoad').mockReturnValue(0);
    host.sim.systems.push(utilities);
    expect(utilities.producerInfo(3)).toBeNull();
    expect(host.utilities.plantLoad!(3)).toBe(0);
  });

  it.each([
    { output: 0, load: null }, { output: -5, load: null }, { output: 0.001, load: 0.3 }, { output: NaN, load: 0.3 },
  ])('reads output $output as load $load', async ({ output, load }) => {
    const state = city(), host = new LocalSimHost(state), utilities = new UtilitiesSystem();
    hosts.push(host);
    vi.spyOn(utilities, 'plantLoad').mockReturnValue(0.3);
    vi.spyOn(utilities, 'producerInfo').mockReturnValue({ kind: 'power', nominal: 400, output, factors: [], load: 0.3 });
    host.sim.systems.push(utilities);
    const read = host.utilities.plantLoad!(7);
    if (load === null) expect(read).toBeNull();
    else expect(read).toBeCloseTo(load, 6);
  });
});

// ------------------------------------------------------------------------------------------------ the wire
interface Plant { load: number; output?: number }

/** The real recorder and replica over the clone-only packet path; the utilities system is a stand-in whose loads and
 *  outputs the test sets (`output` undefined: no breakdown for that plant). */
function stream(plants: Plant[], dailyPass = false) {
  const state = city(16);
  const values = new Map<number, Plant>();
  const buildings = plants.map((plant, i) => {
    const b = place(state, 'util_coal_plant', 1 + i * 4, 1);
    values.set(b.id, { ...plant });
    return b;
  });
  const info = (id: number): ProducerInfo | null => {
    const p = values.get(id);
    return p?.output === undefined ? null : { kind: 'power', nominal: 400, output: p.output, factors: [], load: p.load };
  };
  const utilities = {
    name: 'utilities',
    plantLoad: vi.fn((id: number) => values.get(id)?.load ?? -1),
    producerInfo: vi.fn(info),
    daily: dailyPass ? (sim: Simulation) => sim.events.emit('layerUpdated', 'utilities') : undefined,
  };
  const packets: Packet[] = [];
  const loop = new LoopbackCore(state, {
    cadence: 'design', initialSpeed: 0, modules: { createSystems: () => [utilities] },
    recorder: { rollingCount: 0 }, onPacket: (p) => packets.push(p),
  });
  loops.push(loop);
  const set = (b: Building, plant: Plant) => { values.set(b.id, { ...plant }); };
  const pass = () => {
    loop.core.sim.events.emit('layerUpdated', 'utilities');
    loop.runDays(1);
    return packets.at(-1)!;
  };
  return { loop, buildings, utilities, packets, set, pass };
}

function rows(streams: Streams): [number, number][] {
  const snapshot = streams.utilities!.plantLoads;
  return [...snapshot.ids].map((id, i) => [id, snapshot.loads[i]]);
}

describe('utilities stream: a plant that delivers 0 MW is unavailable on the wire', () => {
  it('sends -1 for it on ready and resync, a valid 0 for an idle plant that produces, and the load without a breakdown', () => {
    const { loop, buildings: [stopped, idle, plain], utilities } = stream([{ load: 0, output: 0 }, { load: 0, output: 400 }, { load: 0 }]);
    expect(loop.replica.plantLoad(stopped.id)).toBeNull();
    expect(loop.replica.plantLoad(idle.id)).toBe(0);
    expect(loop.replica.plantLoad(plain.id)).toBe(0);
    expect(rows(loop.resync().streams)).toEqual([[stopped.id, -1], [idle.id, 0], [plain.id, 0]]);
    expect(utilities.producerInfo).toHaveBeenCalledWith(stopped.id);
    // unavailable either way: the load of a plant that delivers nothing is not read
    expect(utilities.plantLoad).not.toHaveBeenCalledWith(stopped.id);
  });

  it('publishes a shutdown and a restart once each, and nothing while the plant stays shut down', () => {
    const { loop, buildings: [b], set, pass } = stream([{ load: 0.3, output: 400 }]);
    expect(loop.replica.plantLoad(b.id)).toBeCloseTo(0.3, 6);
    set(b, { load: 0, output: 0 });
    expect(rows(pass())).toEqual([[b.id, -1]]);
    expect(loop.replica.plantLoad(b.id)).toBeNull();
    expect(pass().utilities).toBeUndefined();
    // whatever load the sim keeps for a plant that delivers nothing, the wire stays at unavailable
    for (const load of [0.004, 0.5, 1]) {
      set(b, { load, output: 0 });
      expect(pass().utilities).toBeUndefined();
      expect(loop.replica.plantLoad(b.id)).toBeNull();
    }
    // back on an idle grid: a valid 0 is a change from unavailable
    set(b, { load: 0, output: 400 });
    expect(rows(pass())).toEqual([[b.id, 0]]);
    expect(loop.replica.plantLoad(b.id)).toBe(0);
    expect(pass().utilities).toBeUndefined();
  });

  it('keeps NOTE-054\'s strict 0.005 threshold against the last published snapshot for plants that produce', () => {
    const { loop, buildings: [b, stopped], set, pass } = stream([{ load: 0.2, output: 400 }, { load: 0, output: 0 }]);
    for (const load of [0.202, 0.204, 0.205]) {
      set(b, { load, output: 400 });
      expect(pass().utilities).toBeUndefined();
    }
    expect(loop.replica.plantLoad(b.id)).toBeCloseTo(0.2, 6);
    set(b, { load: 0.206, output: 400 });
    const sent = rows(pass());
    expect(sent[0][0]).toBe(b.id);
    expect(sent[0][1]).toBeCloseTo(0.206, 6);
    // a full snapshot: the stopped plant rides along as unavailable
    expect(sent[1]).toEqual([stopped.id, -1]);
    // a change of output alone, with the same load, is not a change of the stream
    set(b, { load: 0.206, output: 200 });
    expect(pass().utilities).toBeUndefined();
    set(b, { load: 0.2, output: 200 });
    expect(rows(pass())[0][1]).toBeCloseTo(0.2, 6);
  });

  it('sends no utilities snapshot during a whole unchanged month of completed passes with a stopped plant', () => {
    const { loop, packets, buildings: [b, stopped] } = stream([{ load: 0.2, output: 400 }, { load: 0, output: 0 }], true);
    loop.runDays(30);
    expect(loop.state.day).toBe(30);
    expect(packets).toHaveLength(30);
    expect(packets.every((p) => p.utilities === undefined)).toBe(true);
    expect(packets.some((p) => p.log.some((entry) => entry[2] === 'utilities'))).toBe(true);
    expect(loop.replica.plantLoad(b.id)).toBeCloseTo(0.2, 6);
    expect(loop.replica.plantLoad(stopped.id)).toBeNull();
  });

  it('carries the real utilities system\'s shutdown by ordinance to the replica after its pass', () => {
    const { state, nuclear, hydro } = nuclearTown();
    const utilities = new UtilitiesSystem(), packets: Packet[] = [];
    const loop = new LoopbackCore(state, {
      cadence: 'design', initialSpeed: 0, modules: { createSystems: () => [utilities] },
      recorder: { rollingCount: 0 }, onPacket: (p) => packets.push(p),
    });
    loops.push(loop);
    expect(loop.replica.plantLoad(nuclear.id)).toBeCloseTo(60 / 1680, 6);
    expect(loop.replica.plantLoad(hydro.id)).toBeCloseTo(60 / 1680, 6);
    state.budget.ordinances.push('nuclear_free_zone');
    utilities.compute(loop.core.sim);
    // the pass is complete, its packet is not out yet: the page still holds the last snapshot
    expect(loop.replica.plantLoad(nuclear.id)).toBeCloseTo(60 / 1680, 6);
    loop.runDays(1);
    const sent = rows(packets.at(-1)!);
    expect(sent[0]).toEqual([nuclear.id, -1]);
    expect(sent[1][0]).toBe(hydro.id);
    expect(sent[1][1]).toBeCloseTo(0.75, 6);
    expect(loop.replica.plantLoad(nuclear.id)).toBeNull();
    expect(loop.replica.plantLoad(hydro.id)).toBeCloseTo(0.75, 6);
    // the replica's building is still powered and staffed: only the load says it is off
    const mirrored = loop.state.buildings.get(nuclear.id)!;
    expect(mirrored.flags & BF.Powered).toBeTruthy();
    expect(mirrored.jobs).toBe(nuclear.jobs);
    state.budget.ordinances.length = 0;
    utilities.compute(loop.core.sim);
    loop.runDays(1);
    expect(loop.replica.plantLoad(nuclear.id)).toBeGreaterThan(0);
    expect(loop.replica.plantLoad(nuclear.id)).toBe(loop.replica.plantLoad(hydro.id));
  });
});
