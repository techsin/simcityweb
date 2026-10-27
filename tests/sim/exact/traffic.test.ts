import { Buffer } from 'node:buffer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RNG } from '../../../src/core/rng';
import { Network } from '../../../src/core/types';
import { deserializeCity, serializeCity } from '../../../src/save/serialize';
import type { CityState } from '../../../src/sim/CityState';
import { Simulation } from '../../../src/sim/Simulation';
import { PR_OPTIONS } from '../../../src/sim/infra/params';
import { Search } from '../../../src/sim/infra/search';
import { TrafficSystem } from '../../../src/sim/infra/traffic';
import { newState, place, roadLine, stressCity } from '../../infra/cityGen';
import { lineTown } from '../../infra/prTowns';
import { TrafficSystemOriginal } from './trafficOriginal';

// Private methods/fields are inspected here so inactive tails, caches and scheduler inputs are checked too.
type Fields = Record<string, any>;
const fields = (t: TrafficSystem | TrafficSystemOriginal): Fields => t as unknown as Fields;

function same(a: any, b: any, at: string, seen = new WeakMap<object, object>()): void {
  if (typeof a === 'function' && typeof b === 'function') return;
  if (Object.is(a, b)) return;
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    if (a.constructor !== b.constructor || a.byteLength !== b.byteLength
      || !Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))) {
      throw new Error(`${at}: different array bytes (${a.byteLength}, ${b.byteLength})`);
    }
    return;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    throw new Error(`${at}: ${String(a)} != ${String(b)}`);
  }
  if (seen.get(a) === b) return;
  seen.set(a, b);
  if (a instanceof Map && b instanceof Map) { same([...a], [...b], at, seen); return; }
  if (a instanceof Set && b instanceof Set) { same([...a], [...b], at, seen); return; }
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) throw new Error(`${at}: different array lengths`);
  const keys = Object.keys(a), otherKeys = Object.keys(b);
  if (keys.length !== otherKeys.length || keys.some((k, i) => k !== otherKeys[i])) throw new Error(`${at}: different fields/order`);
  for (const k of keys) same(a[k], b[k], `${at}.${k}`, seen);
}

function sameTraffic(a: Fields, b: Fields, at: string): void {
  const seen = new WeakMap<object, object>();
  // Only newly introduced scratch has no original counterpart. Every original field is compared, including timers.
  for (const k of Object.keys(a)) same(a[k], b[k], `${at}.${k}`, seen);
}

beforeAll(() => {
  // Wall-clock diagnostics are not deterministic; both arms see the same clock, without excluding any written field.
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.spyOn(Date, 'now').mockReturnValue(0);
});
afterAll(() => vi.restoreAllMocks());

describe('traffic exact J2', () => {
  it('sort: 10,000 seeded cases, preserving packed keys and untouched tails', () => {
    const rng = new RNG(0x614609f), t = fields(new TrafficSystem());
    const special = [-Infinity, -Number.MAX_VALUE, -1, -Number.MIN_VALUE, -0, 0, Number.MIN_VALUE, 0.5,
      2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 50, Number.MAX_SAFE_INTEGER, 2 ** 53, Number.MAX_VALUE, Infinity, NaN];
    const sizes = [0, 1, 2, 63, 64, 65, 127, 128, 255, 256, 257, 1024, 2049];
    for (let c = 0; c < 10_000; c++) {
      const n = c % 16 === 0 ? rng.pick(sizes) : rng.int(64, 192);
      const a = new Float64Array(n + 7).fill(-123.5);
      let M = 1;
      while (M < n) M *= 2;
      for (let k = 0; k < n; k++) {
        switch (c % 10) {
          case 0: a[k] = rng.int(0, 7) * M + k; break; // quantized-cost collisions, origin tie-break
          case 1: a[k] = c % 20 === 1 ? 0 : 2 ** 44; break; // equal keys, all passes trivial
          case 2: a[k] = rng.int(0, 2047) * 2 ** 33; break; // middle/low digits all equal
          case 3: a[k] = rng.int(0, 2 ** 21 - 1) * 2 ** 32 + rng.int(0, 0xffffffff); break;
          case 4: a[k] = rng.pick(special); break;
          case 5: a[k] = rng.int(0, 255); break; // many duplicate whole keys
          case 6: a[k] = k; break;
          case 7: a[k] = n - k; break;
          case 8: a[k] = Number.MAX_SAFE_INTEGER - rng.int(0, 4096); break;
          default: a[k] = rng.int(0, 1024) * M + k;
        }
      }
      if (c % 10 !== 6 && c % 10 !== 7) {
        for (let k = n - 1; k > 0; k--) { const j = rng.int(0, k), v = a[k]; a[k] = a[j]; a[j] = v; }
      }
      const expected = a.slice();
      // The exact sort expression in the frozen roundMatch (Float64Array's stable numeric sort, no comparator).
      const original = expected.subarray(0, n).sort();
      t.candKey = a;
      const sorted = t.sortCandidates(n) as Float64Array;
      same(original, sorted, `sort ${c}`);
      same(expected, t.candKey, `sort ${c} whole backing array`);
    }
  });

  it('sort: 68 digit-boundary and native special-value/NaN-payload cases', () => {
    const t = fields(new TrafficSystem());
    const cases: Float64Array[] = [];
    for (const bit of [0, 10, 11, 21, 22, 31, 32, 33, 43, 44, 52]) {
      for (const n of [0, 1, 63, 64, 65, 513]) {
        cases.push(Float64Array.from({ length: n }, (_, k) => 2 ** bit + (k % 3) - 1));
      }
    }
    const payloads = new Float64Array(128), view = new DataView(payloads.buffer);
    for (let k = 0; k < payloads.length; k++) {
      view.setBigUint64(k * 8, k % 3 === 0 ? 0x7ff8000000000001n + BigInt(k)
        : k % 3 === 1 ? 0xfff8000000000001n + BigInt(k) : 0x8000000000000000n, true);
    }
    cases.push(payloads, Float64Array.from({ length: 128 }, (_, k) => k % 2 ? -0 : 0));
    for (let c = 0; c < cases.length; c++) {
      t.candKey = cases[c].slice();
      same(cases[c].slice().sort(), t.sortCandidates(cases[c].length), `boundary ${c}`);
    }
  });

  it('matching: 1,000 seeded rounds against the frozen method, including ties and extreme labels', () => {
    const rng = new RNG(0x2a51), a = fields(new TrafficSystemOriginal()), b = fields(new TrafficSystem());
    // Isolate candidate construction/ordering; complete mode choice and flows are exercised by the city tests.
    for (const t of [a, b]) { t.split = () => false; t.prPick = () => -1; t.transitOnly = () => 0; }
    const extreme = [-Infinity, -Number.MAX_VALUE, -1, -0, 0, Number.MIN_VALUE, 2 ** 50, Number.MAX_VALUE, Infinity, NaN];
    for (let c = 0; c < 1000; c++) {
      const n = c % 16 === 0 ? rng.pick([0, 1, 63, 64, 65, 256, 257]) : rng.int(64, 192), qN = 4;
      const S = new Search(); S.reset(n);
      const f: Fields = {
        oN: n, qN, round: c % 5, extraRounds: 0, propFactor: 0.8,
        oU: new Float32Array(n), oEntS: new Int32Array(n), oEntC: new Uint8Array(n), ent: new Int32Array(n * 2),
        oTrT: new Float32Array(n), oPrN: new Uint8Array(n), oPrT: new Float32Array(n * PR_OPTIONS),
        candKey: new Float64Array(n + 7).fill(-91), candNode: new Int32Array(n + 7).fill(-1), oLastD: new Float32Array(n),
        qSlots: new Float32Array(qN).fill(100), qCapP: new Float32Array(qN).fill(60), qAsg: new Float32Array(qN),
        qProp: new Float32Array(qN), qNoise: new Float32Array(qN), qPrice: new Float32Array(qN), qBase: new Float32Array(qN),
        qPark: new Float32Array(qN),
      };
      for (let q = 0; q < qN; q++) { f.qNoise[q] = rng.range(0, 10); f.qPrice[q] = rng.range(-20, 20); }
      for (let o = 0; o < n; o++) {
        f.oU[o] = rng.pick([0, 0.005, 0.01, 1, 2 ** 24, rng.range(0, 400)]);
        f.oEntS[o] = o * 2; f.oEntC[o] = rng.int(0, 2);
        f.ent[o * 2] = o; f.ent[o * 2 + 1] = (o + 1) % n;
        f.oTrT[o] = c % 7 === 0 ? rng.pick(extreme) : rng.pick([Infinity, 5, 10, 40]);
        f.oPrN[o] = rng.int(0, 1); f.oPrT[o * PR_OPTIONS] = rng.pick([5, 10, Infinity]);
        S.dist[o] = c % 7 === 0 ? rng.pick(extreme) : rng.pick([30, 30, 40, 80, rng.range(25, 120)]);
        S.src[o] = rng.int(0, qN - 1); S.done[o] = c % 3 === 0 ? 1 : rng.int(0, 1); S.hops[o] = rng.int(0, 64);
      }
      for (const t of [a, b]) { Object.assign(t, structuredClone(f)); Object.assign(t.SA, structuredClone(S)); }
      if (c % 32 === 0) {
        // Restarting a round can leave the old overflow holding its candidate arrays.
        a.ovRouteCand = [3, 7]; a.ovRouteW = [0.1, 2 ** 40];
        b.routeCand = [3, 7]; b.routeW = [0.1, 2 ** 40];
        b.ovRouteCand = b.routeCand; b.ovRouteW = b.routeW;
      }
      same(a.roundMatch(), b.roundMatch(), `round ${c} successor`);
      sameTraffic(a, b, `round ${c}`);
    }
  });

  it('stops: 2,048 seeded queries after 32 growing/shrinking stop snapshots, including borders and full grids', () => {
    const rng = new RNG(0x5710), a = fields(new TrafficSystemOriginal()), b = fields(new TrafficSystem());
    const sizes = [1, 2, 7, 8, 9, 16, 24, 33];
    for (let c = 0; c < 32; c++) {
      const N = sizes[c % sizes.length], st = newState(N);
      for (let i = 0; i < st.cells; i++) {
        st.network[i] = Network.Road;
        if (c % 4 === 0 || (c % 4 !== 1 && rng.chance(0.4))) st.netFlags[i] = 16;
      }
      for (const t of [a, b]) { t.rebuildGraphs(st); t.prepTransit(st); }
      sameTraffic(a, b, `stop snapshot ${c}`);
      for (let k = 0; k < 64; k++) {
        const x = k < 8 ? [0, N - 1, -1, N, 7, 8, -0, NaN][k] : rng.range(-2, N + 2);
        const z = k < 8 ? [0, N - 1, N, -1, 8, 7, Infinity, -Infinity][k] : rng.range(-2, N + 2);
        const R = k < 8 ? [0, N * 2, 1, Math.SQRT2, 8, 9, NaN, Infinity][k] : rng.range(0, N * 2);
        same(a.nearStops(N, x, z, R), b.nearStops(N, x, z, R), `stop ${c}/${k} count`);
        same(a.nsIdx, b.nsIdx, `stop ${c}/${k} order and tail`);
        same(a.nsDist, b.nsDist, `stop ${c}/${k} distance bytes and tail`);
      }
    }
  });

  it('route scratch: 256 seeded samplings with shrinking/growing candidate counts and extreme weights', () => {
    const rng = new RNG(0x123ab), a = fields(new TrafficSystemOriginal()), b = fields(new TrafficSystem());
    for (const t of [a, b]) {
      t.SA.reset(4); t.SA.settled = 4; t.SA.order.set([0, 1, 2, 3]); t.SA.next.set([-1, 0, 1, 2]);
      t.road.cellOf = Int32Array.from([0, 1, 2, 3]);
    }
    for (let c = 0; c < 256; c++) {
      const n = rng.pick([0, 1, 2, 9, 10, 63, 64, 128, 256]);
      const candidates = Array.from({ length: n }, () => rng.int(1, 3));
      const weights = Array.from({ length: n }, () => rng.pick([0, Number.MIN_VALUE, 0.1, 2 ** 24, rng.range(0, 1000)]));
      for (const t of [a, b]) { t.acc = new Float32Array(4); t.volNew = new Float32Array(4); t.pendingRoutes = []; }
      a.roundFlows(100, candidates, weights); b.roundFlows(100, candidates, weights);
      sameTraffic(a, b, `routes ${c}`);
    }
  });

  it('pool/inbound scratch: 128 seeded passes, with empty cities, resizing, special values and cached passes', () => {
    const rng = new RNG(0xa71), original = new TrafficSystemOriginal(), current = new TrafficSystem();
    const simA = new Simulation(newState(8), [original]), simB = new Simulation(newState(8), [current]);
    const a = fields(original), b = fields(current);
    for (let c = 0; c < 128; c++) {
      if (c % 32 === 0) {
        const size = [8, 32, 16, 24][c / 32];
        for (const sim of [simA, simB]) sim.replaceState(size === 8 ? newState(size) : smallCity(size, c + 17));
      }
      a.prep(simA); b.prep(simB);
      a.roundSearch(); b.roundSearch();
      for (let o = 0; o < a.oN; o++) {
        const u = rng.pick([0, 0.005, 1, 2 ** 24, rng.range(0, 1000)]);
        const d = c % 8 === 0 ? rng.pick([-1, -0, 0, Number.MIN_VALUE, Infinity, NaN]) : rng.range(0, 80);
        a.oU[o] = b.oU[o] = u; a.oLastD[o] = b.oLastD[o] = d;
      }
      a.poolRemaining(); b.poolRemaining();
      sameTraffic(a, b, `pool ${c}`);
      for (let j = 0; j < a.jB; j++) {
        const slots = c % 8 === 0 ? rng.pick([0, 1, 2 ** 24, Infinity, NaN]) : rng.range(0, 2000);
        a.jSlots[j] = b.jSlots[j] = slots;
      }
      a.sfRecompute = b.sfRecompute = c % 3 !== 1;
      a.inbound(); b.inbound();
      sameTraffic(a, b, `inbound ${c}`);
    }
  });

  it('cities: all fields and scheduler costs after every phase, across edits, reloads and multiple traffic cycles', () => {
    const factories = [
      () => newState(8),
      () => { const st = newState(9); st.network.fill(Network.Road); st.netFlags.fill(16); return st; },
      () => smallCity(32, 7),
      () => smallCity(48, 81),
      () => lineTown([48, 60, 72, 84, 96], 2).st,
    ];
    const phases = new Set<number>();
    let steps = 0;
    for (let c = 0; c < factories.length; c++) {
      let stA = factories[c](), stB = factories[c]();
      const original = new TrafficSystemOriginal(), current = new TrafficSystem();
      const simA = new Simulation(stA, [original]), simB = new Simulation(stB, [current]);
      const a = fields(original), b = fields(current);
      const check = (at: string) => {
        sameTraffic(a, b, at);
        same(stA, stB, `${at} city`);
        same(original.stepCost(simA), current.stepCost(simB), `${at} scheduler cost`);
      };
      check(`city ${c} warm start`);
      for (let cycle = 0; cycle < 6; cycle++) {
        if (cycle === 2 || cycle === 4) {
          for (const sim of [simA, simB]) {
            const st = sim.state, end = st.size - 1;
            roadLine(st, 0, end, end, end, cycle === 2 ? Network.Avenue : Network.None);
            for (let i = 0; i < st.cells; i++) if (i % 11 === 0) st.netFlags[i] ^= 16;
            sim.events.emit('networkChanged', { x0: 0, z0: 0, x1: st.size, z1: st.size });
          }
        }
        stA.day += 2; stB.day += 2;
        a.phase = b.phase = 0; a.lastCycleStart = b.lastCycleStart = stA.day;
        let cycleSteps = 0;
        while (a.phase >= 0) {
          if (++cycleSteps > 500) throw new Error('traffic cycle did not finish');
          phases.add(a.phase);
          check(`city ${c} cycle ${cycle} before ${cycleSteps}`);
          original.step(simA); current.step(simB);
          steps++;
          check(`city ${c} cycle ${cycle} after ${cycleSteps}`);
        }
        same(serializeCity(stA, { copy: true }), serializeCity(stB, { copy: true }), `city ${c} cycle ${cycle} save`);
        if (cycle === 3) {
          stA = deserializeCity(serializeCity(stA, { copy: true }));
          stB = deserializeCity(serializeCity(stB, { copy: true }));
          simA.replaceState(stA); simB.replaceState(stB);
          check(`city ${c} reload`);
        }
      }
    }
    expect(steps).toBeGreaterThan(500);
    expect(phases.has(15), 'park & ride overflow exercised').toBe(true);
  }, 30_000);
});

function smallCity(size: number, seed: number): CityState {
  // The stress generator's optional subway has a fixed row 97; add transit within this small map instead.
  const st = stressCity(size, seed, { withTransit: false, jobsPerWorker: 0.7 }).st;
  for (let i = 0; i < st.cells; i++) if (st.network[i] && i % 17 === 0) st.netFlags[i] |= 16;
  const z = size - 3;
  roadLine(st, 0, z, size - 1, z, Network.Road);
  for (let x = 1; x < size - 1; x++) st.subway[st.idx(x, z + 1)] = 1;
  place(st, 't_subway', 1, z + 1); place(st, 't_subway', size - 2, z + 1);
  return st;
}
