/** NOTE-054: completed utilities passes publish bounded plant-load snapshots through the clone-only packet path. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overlay } from '../../src/core/types';
import { BF, CityState, type Building } from '../../src/sim/CityState';
import type { Simulation } from '../../src/sim/Simulation';
import { getDef } from '../../src/sim/catalog';
import { defaultCityConfig } from '../../src/sim/config';
import { placeBuilding, removeBuilding } from '../../src/sim/economy/buildings';
import { LoopbackCore } from '../../src/worker/loopbackCore';
import { assertOwnedBuffers, cloneMessage, type Packet, type Streams } from '../../src/worker/protocol';

const loops: LoopbackCore[] = [];

afterEach(() => {
  for (const loop of loops.splice(0)) loop.dispose();
});

function building(state: CityState, defId: string, x: number): Building {
  const def = getDef(defId)!;
  const [w, d] = def.footprint;
  const capacity = def.capacity ?? def.jobs ?? 0;
  return {
    id: state.nextBuildingId++, def: defId, x, z: 1, w, d, rot: 0, variant: 0, pop: 0, jobs: capacity, capacity,
    wealth: 1, built: 1, age: 100, flags: BF.Powered | BF.Watered, baseY: 5, health: 1, unhappy: 0,
  };
}

function setup(entries: [string, number][] = [['util_coal_plant', 0.2]], dailyPass = false, live = false) {
  const state = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', disasters: false, treeDensity: 0, waterAmount: 0 }));
  state.heights.fill(5);
  const loads = new Map<number, number>();
  const buildings = entries.map(([def, load], i) => {
    const b = building(state, def, 1 + i * 4);
    state.buildings.set(b.id, b);
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) state.building[state.idx(x, z)] = b.id;
    loads.set(b.id, load);
    return b;
  });
  const utilities = {
    name: 'utilities',
    plantLoad: vi.fn((id: number) => loads.get(id) ?? -1),
    daily: dailyPass ? (sim: Simulation) => sim.events.emit('layerUpdated', 'utilities') : undefined,
  };
  const packets: Packet[] = [];
  const loop = new LoopbackCore(state, {
    cadence: live ? 'live' : 'design', initialSpeed: 0, modules: { createSystems: () => [utilities] },
    recorder: { rollingCount: 0 }, onPacket: (p) => packets.push(p),
  });
  loops.push(loop);
  const pass = () => {
    loop.core.sim.events.emit('layerUpdated', 'utilities');
    loop.runDays(1);
    return packets.at(-1)!;
  };
  return { loop, loads, buildings, utilities, packets, pass };
}

function rows(streams: Streams): [number, number][] {
  const snapshot = streams.utilities!.plantLoads;
  return [...snapshot.ids].map((id, i) => [id, snapshot.loads[i]]);
}

function apply(loop: LoopbackCore, utilities?: Streams['utilities']): Packet {
  const p = loop.recorder.flush({ force: true })!;
  if (utilities === undefined) delete p.utilities;
  else p.utilities = utilities;
  const message = cloneMessage({ t: 'pkt' as const, p });
  expect(loop.replica.apply(message.p)).toBe(true);
  return p;
}

describe('plant-load utilities stream', () => {
  it('sends every power producer on ready/resync without an overlay or focus, including incinerators', () => {
    const { loop, buildings, utilities } = setup([
      ['util_coal_plant', 0.15], ['util_incinerator', 1], ['ind_refinery.id.4', 0.8],
    ]);
    const [coal, incinerator, refinery] = buildings;
    expect(loop.replica.plantLoad(coal.id)).toBeCloseTo(0.15, 6);
    expect(loop.replica.plantLoad(incinerator.id)).toBe(1);
    expect(loop.replica.plantLoad(refinery.id)).toBeNull();
    expect(loop.replica.plantLoad(999)).toBeNull();
    expect(utilities.plantLoad).not.toHaveBeenCalledWith(refinery.id);
    const ready = loop.resync();
    expect([...ready.streams.utilities!.plantLoads.ids]).toEqual([coal.id, incinerator.id]);
    expect(rows(ready.streams)[0][1]).toBeCloseTo(0.15, 6);
    expect(rows(ready.streams)[1]).toEqual([incinerator.id, 1]);
    expect(loop.flush(true)!.utilities).toBeUndefined();
  });

  it('sends no utilities snapshot during a whole unchanged month of completed passes', () => {
    const { loop, packets } = setup(undefined, true);
    loop.runDays(30);
    expect(loop.state.day).toBe(30);
    expect(packets).toHaveLength(30);
    expect(packets.every((p) => p.utilities === undefined)).toBe(true);
    expect(packets.some((p) => p.log.some((entry) => entry[2] === 'utilities'))).toBe(true);
    expect(loop.replica.plantLoad(1)).toBeCloseTo(0.2, 6);
  });

  it('uses a strict absolute 0.005 threshold in either direction', () => {
    const { loop, loads, buildings: [b], pass } = setup([['util_coal_plant', 0]]);
    loads.set(b.id, 0.005);
    expect(pass().utilities).toBeUndefined();
    expect(loop.replica.plantLoad(b.id)).toBe(0);
    loads.set(b.id, 0.005001);
    expect(rows(pass())[0][1]).toBeCloseTo(0.005001, 6);
    expect(loop.replica.plantLoad(b.id)).toBeCloseTo(0.005001, 6);
    loads.set(b.id, 0);
    expect(rows(pass())).toEqual([[b.id, 0]]);
    expect(loop.replica.plantLoad(b.id)).toBe(0);
  });

  it('compares cumulative drift with the last published snapshot rather than the previous sample', () => {
    const { loop, loads, buildings: [b], pass } = setup();
    for (const load of [0.202, 0.204]) {
      loads.set(b.id, load);
      expect(pass().utilities).toBeUndefined();
    }
    loads.set(b.id, 0.206);
    expect(rows(pass())[0][1]).toBeCloseTo(0.206, 6);
    loads.set(b.id, 0.210);
    expect(pass().utilities).toBeUndefined();
    expect(loop.replica.plantLoad(b.id)).toBeCloseTo(0.206, 6);
    loads.set(b.id, 0.212);
    expect(rows(pass())[0][1]).toBeCloseTo(0.212, 6);
    expect(loop.replica.plantLoad(b.id)).toBeCloseTo(0.212, 6);
  });

  it('does not read in-flight loads on ordinary packets or view changes', () => {
    const { loop, loads, buildings: [b], utilities, pass } = setup();
    utilities.plantLoad.mockClear();
    loads.set(b.id, 0.8);
    expect(loop.flush(true)!.utilities).toBeUndefined();
    loop.runDays(1);
    loop.setView({ overlay: Overlay.None, variant: 0, panels: ['roadInspector'], focus: [b.id] });
    expect(loop.flush(true)!.utilities).toBeUndefined();
    expect(utilities.plantLoad).not.toHaveBeenCalled();
    expect(loop.replica.plantLoad(b.id)).toBeCloseTo(0.2, 6);
    expect(rows(pass())[0][1]).toBeCloseTo(0.8, 6);
    expect(utilities.plantLoad).toHaveBeenCalledWith(b.id);
  });

  it('samples flush-time values when a completed utilities group is throttled for 250 ms', () => {
    const { loop, loads, buildings: [b], utilities, packets } = setup(undefined, false, true);
    loads.set(b.id, 0.4);
    loop.core.sim.events.emit('layerUpdated', 'utilities');
    expect(rows(loop.flush(true)!)[0][1]).toBeCloseTo(0.4, 6);
    utilities.plantLoad.mockClear();
    loads.set(b.id, 0.6);
    loop.core.sim.events.emit('layerUpdated', 'utilities');
    loop.frame(0.1);
    expect(loop.flush(true)!.utilities).toBeUndefined();
    loop.frame(0.149);
    expect(loop.flush(true)!.utilities).toBeUndefined();
    expect(utilities.plantLoad).not.toHaveBeenCalled();
    expect(loop.replica.plantLoad(b.id)).toBeCloseTo(0.4, 6);
    // NOTE-020 / F4: a newer in-flight write is included when the earlier completion is delivered.
    loads.set(b.id, 0.8);
    loop.frame(0.001);
    expect(rows(packets.at(-1)!)[0][1]).toBeCloseTo(0.8, 6);
    expect(loop.replica.plantLoad(b.id)).toBeCloseTo(0.8, 6);
  });

  it('publishes full membership on the next completed pass and sends an empty snapshot for the final removal', () => {
    const { loop, loads, buildings: [coal], utilities, pass } = setup();
    utilities.plantLoad.mockClear();
    const incinerator = building(loop.primary, 'util_incinerator', 8);
    loads.set(incinerator.id, 0.6);
    placeBuilding(loop.core.sim, incinerator);
    expect(loop.flush(true)!.utilities).toBeUndefined();
    expect(utilities.plantLoad).not.toHaveBeenCalled();
    expect(loop.replica.plantLoad(incinerator.id)).toBeNull();
    const added = pass().utilities!.plantLoads;
    expect([...added.ids]).toEqual([coal.id, incinerator.id]);
    expect(loop.replica.plantLoad(incinerator.id)).toBeCloseTo(0.6, 6);
    removeBuilding(loop.core.sim, coal);
    expect(loop.flush(true)!.utilities).toBeUndefined();
    expect(loop.replica.plantLoad(coal.id)).toBeCloseTo(0.2, 6);
    const removed = pass().utilities!.plantLoads;
    expect([...removed.ids]).toEqual([incinerator.id]);
    expect(loop.replica.plantLoad(coal.id)).toBeNull();
    removeBuilding(loop.core.sim, incinerator);
    const empty = pass().utilities!.plantLoads;
    expect([...empty.ids]).toEqual([]);
    expect([...empty.loads]).toEqual([]);
    expect(loop.replica.plantLoad(incinerator.id)).toBeNull();
    expect(pass().utilities).toBeUndefined();
  });

  it('normalizes unknown loads and publishes transitions between unavailable and valid', () => {
    const { loop, loads, buildings: [b], pass } = setup([['util_coal_plant', -1]]);
    expect(rows(loop.resync().streams)).toEqual([[b.id, -1]]);
    expect(loop.replica.plantLoad(b.id)).toBeNull();
    for (const invalid of [NaN, Infinity, -10]) {
      loads.set(b.id, invalid);
      expect(pass().utilities).toBeUndefined();
      expect(loop.replica.plantLoad(b.id)).toBeNull();
    }
    loads.set(b.id, 0.5);
    expect(rows(pass())).toEqual([[b.id, 0.5]]);
    expect(loop.replica.plantLoad(b.id)).toBe(0.5);
    loads.delete(b.id);
    expect(rows(pass())).toEqual([[b.id, -1]]);
    expect(loop.replica.plantLoad(b.id)).toBeNull();
  });

  it('always includes resync loads and resets the last-published comparison baseline', () => {
    const { loop, loads, buildings: [b], pass } = setup();
    loads.set(b.id, 0.204);
    expect(pass().utilities).toBeUndefined();
    expect(rows(loop.resync().streams)[0][1]).toBeCloseTo(0.204, 6);
    loads.set(b.id, 0.208);
    expect(pass().utilities).toBeUndefined();
    expect(loop.replica.plantLoad(b.id)).toBeCloseTo(0.204, 6);
    loads.set(b.id, 0.210);
    expect(rows(pass())[0][1]).toBeCloseTo(0.210, 6);
  });

  it('returns null for unavailable, nonfinite and absent wire loads', () => {
    const { loop, buildings: [b] } = setup();
    for (const load of [-1, NaN, Infinity]) {
      apply(loop, { plantLoads: { ids: new Uint32Array([b.id]), loads: new Float32Array([load]) } });
      expect(loop.replica.plantLoad(b.id)).toBeNull();
      expect(loop.replica.plantLoad(999)).toBeNull();
    }
    apply(loop, { plantLoads: { ids: new Uint32Array([b.id]), loads: new Float32Array([0]) } });
    expect(loop.replica.plantLoad(b.id)).toBe(0);
  });

  it('retains omitted packet data, replaces complete snapshots, and clears stale data on empty snapshots or adoption', () => {
    const { loop, buildings: [coal, incinerator] } = setup([['util_coal_plant', 0.2], ['util_incinerator', 0.6]]);
    apply(loop);
    expect(loop.replica.plantLoad(coal.id)).toBeCloseTo(0.2, 6);
    apply(loop, { plantLoads: { ids: new Uint32Array(), loads: new Float32Array() } });
    expect(loop.replica.plantLoad(coal.id)).toBeNull();
    expect(loop.replica.plantLoad(incinerator.id)).toBeNull();
    apply(loop, { plantLoads: { ids: new Uint32Array([coal.id, incinerator.id]), loads: new Float32Array([0.3, 0.7]) } });
    apply(loop, { plantLoads: { ids: new Uint32Array([incinerator.id]), loads: new Float32Array([0.4]) } });
    expect(loop.replica.plantLoad(coal.id)).toBeNull();
    expect(loop.replica.plantLoad(incinerator.id)).toBeCloseTo(0.4, 6);
    const ready = loop.recorder.ready();
    delete ready.streams.utilities;
    loop.replica.adopt(cloneMessage(ready));
    expect(loop.replica.plantLoad(incinerator.id)).toBeNull();
    loop.resync();
    expect(loop.replica.plantLoad(coal.id)).toBeCloseTo(0.2, 6);
    expect(loop.replica.plantLoad(incinerator.id)).toBeCloseTo(0.6, 6);
  });

  it('owns snapshot buffers across cloning and does not alias recorder baselines or replica values', () => {
    const { loop, buildings: [b] } = setup();
    const ready = loop.resync(), data = ready.streams.utilities!.plantLoads;
    assertOwnedBuffers(ready);
    expect(data.ids.byteLength).toBe(data.ids.buffer.byteLength);
    expect(data.loads.byteLength).toBe(data.loads.buffer.byteLength);
    const cloned = cloneMessage(ready);
    expect(cloned.streams.utilities!.plantLoads.ids.buffer).not.toBe(data.ids.buffer);
    expect(cloned.streams.utilities!.plantLoads.loads.buffer).not.toBe(data.loads.buffer);
    data.ids[0] = 999; data.loads[0] = 0.9;
    expect(loop.replica.plantLoad(b.id)).toBeCloseTo(0.2, 6);
    expect(rows(loop.resync().streams)[0][0]).toBe(b.id);
    expect(loop.flush(true)!.utilities).toBeUndefined();
  });
});
