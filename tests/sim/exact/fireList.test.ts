import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { RNG } from '../../../src/core/rng';
import { Zone } from '../../../src/core/types';
import { BF, CityState, type Building } from '../../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../../src/sim/Simulation';
import { placeBuilding, removeBuilding } from '../../../src/sim/economy/buildings';
import { buildingList } from '../../../src/sim/infra/common';
import { FireSystem } from '../../../src/sim/infra/fire';
import { EmergencySystem } from '../../../src/sim/infra/emergency';
import { schedulerOf } from '../../../src/sim/infra/scheduler';
import type { TrafficSystem } from '../../../src/sim/infra/traffic';
import { deserializeCity, serializeCity } from '../../../src/save/serialize';
import { newState, place } from '../../infra/cityGen';
import { buildingListOriginal, FireSystemOriginal } from './fireListOriginal';

const special = [-Infinity, -Number.MAX_VALUE, -1, -Number.MIN_VALUE, -0, 0, Number.MIN_VALUE,
  0.15, 0.3, 0.35, 0.6, 1, 1.0000000000000002, Number.MAX_VALUE, Infinity, NaN];
const a64 = new Float64Array(1), b64 = new Float64Array(1);
const aBytes = Buffer.from(a64.buffer), bBytes = Buffer.from(b64.buffer);

/** Compare every scalar as f64 bytes and every typed array as raw bytes, including NaNs and signed zero. */
function exact(a: unknown, b: unknown, path = 'output'): void {
  if (typeof b === 'number') {
    assert.equal(typeof a, 'number', path);
    a64[0] = a as number; b64[0] = b;
    assert.ok(aBytes.equals(bBytes), path);
    return;
  }
  if (Object.is(a, b)) return;
  assert.equal(typeof a, typeof b, path);
  if (typeof b === 'function') return; // subscription closures belong to their respective simulations
  assert.ok(a !== null && b !== null && typeof a === 'object' && typeof b === 'object', path);
  if (ArrayBuffer.isView(b)) {
    assert.ok(ArrayBuffer.isView(a), path);
    assert.equal(a.constructor, b.constructor, path);
    const ab = Buffer.from(a.buffer, a.byteOffset, a.byteLength), bb = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
    if (!ab.equals(bb)) {
      // a NaN matches any NaN (its bits depend on the tier that stored it); every other byte must match
      assert.ok(a instanceof Float32Array || a instanceof Float64Array, path);
      const fa = a as Float32Array | Float64Array, fb = b as Float32Array | Float64Array;
      const stride = fa.BYTES_PER_ELEMENT;
      for (let i = 0; i < fa.length; i++) {
        if (Number.isNaN(fa[i]) && Number.isNaN(fb[i])) continue;
        for (let j = i * stride; j < (i + 1) * stride; j++) assert.equal(ab[j], bb[j], `${path}[${i}]`);
      }
    }
  } else if (b instanceof Map) {
    assert.ok(a instanceof Map, path);
    exact([...a], [...b], path);
  } else if (b instanceof Set) {
    assert.ok(a instanceof Set, path);
    exact([...a], [...b], path);
  } else if (Array.isArray(b)) {
    assert.ok(Array.isArray(a), path);
    assert.equal(a.length, b.length, path);
    for (let i = 0; i < b.length; i++) {
      assert.equal(Object.hasOwn(a, i), Object.hasOwn(b, i), path);
      exact(a[i], b[i], `${path}[${i}]`);
    }
  } else {
    assert.deepEqual(Object.keys(a), Object.keys(b), path);
    for (const k of Object.keys(b)) exact((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
  }
}

function cloneState(st: CityState): CityState {
  return Object.assign(new CityState({ ...st.config }), structuredClone(st));
}

function checkList(st: CityState, previous?: [Building[], Building[]]): [Building[], Building[]] {
  const original = buildingListOriginal(st), current = buildingList(st);
  assert.equal(current.length, original.length);
  for (let i = 0; i < original.length; i++) assert.equal(current[i], original[i], `building ${i}`);
  if (previous) {
    assert.equal(current, previous[0]);
    assert.equal(original, previous[1]);
  }
  return [current, original];
}

type Fire = FireSystem | FireSystemOriginal;
interface Harness { sim: Simulation; fire: Fire; log: unknown[] }

function harness(st: CityState, fire: Fire, emergency = false, route = 2): Harness {
  const log: unknown[] = [];
  const traffic: SimSystem & Pick<TrafficSystem, 'findPath' | 'pushServiceRoute'> = {
    name: 'traffic',
    findPath(_sim, from, to) {
      log.push(['findPath', from, to]);
      return route === 0 ? null : route === 1 ? new Uint32Array([from]) : new Uint32Array([from, to]);
    },
    pushServiceRoute(_sim, path, weight, days) { log.push(['route', path.slice(), weight, days]); },
  };
  const sim = new Simulation(st, emergency ? [fire, new EmergencySystem()] : [fire, traffic]);
  for (const kind of ['buildingAdded', 'buildingRemoved', 'buildingChanged', 'disaster', 'news', 'emergency', 'day', 'month', 'reset']) {
    sim.events.on(kind, (value) => log.push([kind, structuredClone(value)]));
  }
  return { sim, fire, log };
}

function checkFire(a: Harness, b: Harness): void {
  exact(a.sim.state, b.sim.state, 'city');
  exact(a.fire, b.fire, 'fire'); // includes the private RNG, news throttle and fireEffect
  exact(a.log, b.log, 'events and routes');
  exact(buildingList(a.sim.state), buildingListOriginal(b.sim.state), 'building list');
}

function schedulerState(h: Harness): unknown {
  // Wall-clock profiling is not part of the deterministic schedule; keep all estimated costs and credits.
  const { spentMs, maxStepMs, tasks, ...state } = schedulerOf(h.sim);
  return { ...state, tasks: tasks.map((t) => [t.name, t.due(h.sim), t.urgent(h.sim), t.cost(h.sim)]) };
}

function fixture(rng: RNG, size: number, count: number): CityState {
  const st = newState(size);
  st.config.seed = rng.int(0, 0xffffffff);
  st.day = rng.int(0, 60);
  const cells = rng.shuffle(Array.from({ length: size * size }, (_, i) => i));
  const defs = ['t_r1', 't_r2', 't_cs', 't_id', 't_im', 't_iht', 't_park', 't_fire'];
  const saved: number[][] = [];
  for (let q = 0; q < count; q++) {
    const i = cells[q], x = i % size, z = Math.floor(i / size);
    const b = place(st, rng.pick(defs), x, z, {
      pop: rng.chance(0.2) ? rng.pick(special) : rng.range(0, 1000),
      jobs: rng.chance(0.2) ? rng.pick(special) : rng.range(0, 200),
      built: rng.pick([0, 0.29999999999999993, 0.3, 0.5, 1, NaN, Infinity, -Infinity]),
      flags: rng.pick([0, BF.OnFire, BF.Burnt, BF.Abandoned, BF.OnFire | BF.Abandoned]),
      w: rng.int(1, Math.min(2, size - x)), d: rng.int(1, Math.min(2, size - z)),
    });
    st.zone[i] = rng.pick([Zone.None, Zone.ResLow, Zone.ComHigh, Zone.IndMed]);
    if (rng.chance(0.1)) b.def = 'fireList_unknown';
    if (b.flags & BF.OnFire && rng.chance(0.7)) {
      saved.push([b.id, rng.pick([0, 1, 5, 6, -1, NaN, Infinity]),
        rng.pick([-1, st.day, st.day + 1, st.day + 3, NaN]), rng.pick([-1, 0, 99]), rng.pick(special)]);
    }
  }
  // Rebuild the cell index for the chosen footprints, including overlapping and border lots.
  st.building.fill(-1);
  for (const b of st.buildings.values()) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) st.building[st.idx(x, z)] = b.id;
  for (let i = 0; i < st.cells; i++) {
    st.fireCov[i] = rng.chance(0.3) ? rng.pick(special) : rng.next();
    st.garbage[i] = rng.chance(0.3) ? rng.pick(special) : rng.range(0, 2);
  }
  // Noncanonical NaN payloads must survive unchanged in untouched f32/f64 layers too.
  if (st.cells > 1) new Uint32Array(st.fireCov.buffer)[1] = 0x7fc00017;
  st.systemData.fireListFloats = new Float64Array(special);
  st.systemData.infraFires = rng.shuffle(saved);
  st.systemData.infraFireRng = rng.int(0, 0xffffffff);
  st.systemData.infraFireBoost = rng.pick([0, 1, 2, 1000, Infinity, NaN]);
  st.systemData.infraFireNews = rng.pick([-1e9, st.day - 5, st.day - 6, Infinity, NaN]);
  if (rng.chance(0.5)) st.budget.ordinances.push('smoke_detectors');
  return st;
}

function fireDays(st: CityState, rng: RNG, route: number): void {
  const a = harness(cloneState(st), new FireSystem(), false, route);
  const b = harness(cloneState(st), new FireSystemOriginal(), false, route);
  checkFire(a, b);
  for (let day = 0; day < 8; day++) {
    const risk = rng.pick([0, -0, -1, 1, 2, 10, 10000, 250000, Number.MAX_VALUE, Infinity, NaN]);
    for (const h of [a, b]) {
      const s = h.sim.state;
      const first = s.buildings.values().next().value;
      h.fire.riskBoost = risk;
      if (day === 1 && first) {
        s.buildings.delete(first.id);
        s.buildings.set(first.id, { ...first, jobs: -0 });
      } else if (day === 2 && first) {
        removeBuilding(h.sim, first);
      } else if (day === 3) {
        s.buildings = new Map([...s.buildings].reverse());
      } else if (day === 4) {
        h.sim.replaceState(cloneState(s));
      } else if (day === 5 && first) {
        h.fire.ignite(h.sim, first, false);
        h.fire.extinguish(h.sim, first);
      } else if (day === 6) {
        for (const old of [...s.buildings.values()]) removeBuilding(h.sim, old);
      } else if (day === 7) {
        place(s, 't_r1', 0, 0, { flags: BF.Abandoned, pop: 120 });
      }
    }
    checkFire(a, b);
    const oldA = a.sim.state.systemData.infraFires, oldB = b.sim.state.systemData.infraFires;
    const oldCopy = structuredClone(oldA);
    a.sim.advanceDay(); b.sim.advanceDay();
    checkFire(a, b);
    exact(oldA, oldB, 'retained save arrays');
    exact(oldA, oldCopy, 'save snapshot remains unchanged');
    assert.notEqual(a.sim.state.systemData.infraFires, oldA);
  }
}

describe('fireList exact (614609f)', () => {
  it('matches 10,000 seeded building-map mutation cases, including unchanged size and next id', () => {
    const rng = new RNG('fireList mutations 614609f');
    let cases = 0;
    for (let city = 0; city < 100; city++) {
      const st = newState(8);
      let previous: [Building[], Building[]] | undefined;
      for (let step = 0; step < 100; step++) {
        const all = [...st.buildings.values()], b = rng.pick(all);
        switch (rng.int(0, 12)) {
          case 0: case 1: place(st, 't_r1', rng.int(0, 7), rng.int(0, 7), { pop: rng.pick(special) }); break;
          case 2: if (b) st.buildings.delete(b.id); break;
          case 3: if (b) st.buildings.set(b.id, { ...b, pop: rng.pick(special) }); break;
          case 4: if (b) { st.buildings.delete(b.id); st.buildings.set(b.id, b); } break;
          case 5:
            st.buildings.clear();
            for (const v of rng.shuffle(all)) st.buildings.set(v.id, v);
            break;
          case 6: st.buildings = new Map(rng.shuffle(all).map((v) => [v.id, { ...v }])); break;
          case 7: st.nextBuildingId += rng.pick([-1, 0, 1]); break;
          case 8: st.day += rng.pick([-1, 1, 4]); break;
          case 9: if (b) b.health = rng.pick(special); break;
          case 10: st.buildings.clear(); break;
          case 11: st.day = rng.pick([-1, 0, 1, 0x7fffffff, 0xffffffff, NaN, Infinity]); break;
          case 12: break;
        }
        previous = checkList(st, previous);
        checkList(st, previous);
        cases++;
      }
    }
    expect(cases).toBe(10000);
  });

  it('keeps the original same-day snapshot, then observes replacement, reinsertion, clear and a new Map next day', () => {
    const st = newState(4);
    const a = place(st, 't_r1', 0, 0), b = place(st, 't_r1', 1, 0), c = place(st, 't_r1', 2, 0);
    const previous = checkList(st), nextId = st.nextBuildingId;
    const replacement = { ...b, pop: -0 };
    const changes = [
      () => st.buildings.set(b.id, replacement),
      () => { st.buildings.delete(a.id); st.buildings.set(a.id, a); },
      () => { st.buildings.clear(); for (const v of [a, c, replacement]) st.buildings.set(v.id, v); },
      () => { st.buildings = new Map([replacement, c, a].map((v) => [v.id, v])); },
    ];
    for (const change of changes) {
      const snapshot = previous[0].slice();
      change();
      assert.equal(st.buildings.size, 3);
      assert.equal(st.nextBuildingId, nextId);
      checkList(st, previous);
      for (let i = 0; i < snapshot.length; i++) assert.equal(previous[0][i], snapshot[i]);
      st.day++;
      checkList(st, previous);
      assert.deepEqual(previous[0], [...st.buildings.values()]);
    }
    const sim = new Simulation(st);
    removeBuilding(sim, c);
    placeBuilding(sim, c);
    checkList(st, previous);
    st.day++;
    checkList(st, previous);
    const loaded = deserializeCity(serializeCity(st, { copy: true }));
    sim.replaceState(loaded);
    checkList(sim.state);
    assert.notEqual(buildingList(sim.state), previous[0]);
  });

  it('reuses the array through empty, full, 17,154-building, growing and shrinking snapshots', () => {
    const st = newState(132);
    const all: Building[] = [];
    for (let i = 0; i < 17154; i++) all.push(place(st, 't_r1', i % 132, Math.floor(i / 132)));
    const sizes = [0, 1, 2, 3, 4, 5, 15, 16, 17, 255, 256, 257, 17154];
    let previous: [Building[], Building[]] | undefined;
    for (const n of [...sizes, ...sizes.slice().reverse(), 17154]) {
      st.buildings = new Map(all.slice(0, n).map((v) => [v.id, v]));
      for (let day = 0; day < 4; day++) {
        st.day++;
        previous = checkList(st, previous);
        assert.equal(previous[0].length, n);
      }
    }
  });

  it('matches all outputs over 1,024 seeded fire days, including state replacement and retained saves', () => {
    const rng = new RNG('fireList fire 614609f');
    for (let city = 0; city < 128; city++) {
      const size = rng.pick([1, 2, 3, 5, 8]);
      fireDays(fixture(rng, size, city % 8 === 0 ? size * size : rng.int(0, size * size)), rng, city % 3);
    }
  }, 20000);

  it('matches 128 fire days at float extremes, ignition and coverage thresholds, and map borders', () => {
    const rng = new RNG('fireList edge 614609f');
    for (const v of special) {
      const st = newState(3);
      st.day = 29;
      st.fireCov.fill(v); st.garbage.fill(v);
      for (let i = 0; i < st.cells; i++) place(st, i === 4 ? 't_fire' : 't_r1', i % 3, Math.floor(i / 3), {
        pop: v, jobs: v, built: v, flags: i % 2 ? BF.OnFire : 0,
      });
      st.systemData.infraFires = [[2, v, v, v, v], [4], [2, v, -1, -1, v], [123456, 0, -1, -1, 1]];
      fireDays(st, rng, 2);
    }
  }, 20000);

  it('matches emergency adoption and a save/load continuation with cold caches', () => {
    const st = newState(8);
    for (let i = 0; i < 8; i++) place(st, 't_r1', i, 0, { flags: BF.OnFire, pop: 12 });
    st.systemData.infraFires = [[1, 0, -1, 9999, 0.123456789], [2, 3, 5, -1, -0]];
    const a = harness(cloneState(st), new FireSystem(), true);
    const b = harness(cloneState(st), new FireSystemOriginal(), true);
    checkFire(a, b);
    exact(schedulerState(a), schedulerState(b), 'cold scheduler');
    for (let day = 0; day < 12; day++) {
      a.fire.riskBoost = b.fire.riskBoost = day % 3 ? 0 : 50000;
      a.sim.advanceDay(); b.sim.advanceDay();
      checkFire(a, b);
      exact(schedulerState(a), schedulerState(b), 'scheduler');
      exact(a.sim.getSystem<EmergencySystem>('emergency')!.incidents(), b.sim.getSystem<EmergencySystem>('emergency')!.incidents(), 'incidents');
      if (day === 5) {
        a.sim.replaceState(deserializeCity(serializeCity(a.sim.state, { copy: true })));
        b.sim.replaceState(deserializeCity(serializeCity(b.sim.state, { copy: true })));
        checkFire(a, b);
        exact(schedulerState(a), schedulerState(b), 'reloaded scheduler');
      }
    }
  });

  it('keeps live Map iteration when event handlers delete, reinsert and append fires', () => {
    const st = newState(4);
    const ids = [place(st, 't_r1', 0, 0), place(st, 't_r1', 1, 0), place(st, 't_r1', 2, 0)].map((b) => b.id);
    const a = harness(cloneState(st), new FireSystem()), b = harness(cloneState(st), new FireSystemOriginal());
    for (const h of [a, b]) {
      h.fire.riskBoost = 0;
      for (const id of ids.slice(0, 2)) {
        h.fire.ignite(h.sim, h.sim.state.buildings.get(id)!);
        h.fire.fires.get(id)!.putOut = 1;
      }
      let changed = false;
      h.sim.events.on('buildingChanged', (v) => {
        if (changed || v.id !== ids[0] || v.flags & BF.OnFire) return;
        changed = true;
        const f = h.fire.fires.get(ids[1])!;
        h.fire.fires.delete(ids[1]); h.fire.fires.set(ids[1], { ...f, putOut: -1 });
        h.fire.ignite(h.sim, h.sim.state.buildings.get(ids[2])!, true);
      });
    }
    for (let day = 0; day < 8; day++) { a.sim.advanceDay(); b.sim.advanceDay(); checkFire(a, b); }
    expect(a.log.some((e) => Array.isArray(e) && e[0] === 'buildingChanged')).toBe(true);
  });
});
