import { beforeAll, describe, expect, it } from 'vitest';
import { RNG } from '../../../src/core/rng';
import { DevType, Network, Zone } from '../../../src/core/types';
import { BF, CityState } from '../../../src/sim/CityState';
import { Simulation } from '../../../src/sim/Simulation';
import { CATALOG, getDef, rebuildCatalogIndex } from '../../../src/sim/catalog';
import type { BuildingDef } from '../../../src/sim/catalogTypes';
import { clearInfoCache } from '../../../src/sim/infra/common';
import { nimbyCost, rebuildNimby } from '../../../src/sim/infra/nimby';
import { place, registerTestDefs } from '../../infra/cityGen';
import { nimbyCostOriginal, rebuildNimbyOriginal } from './nimbyOriginal';

const OFFSETS = [0, 1, 2, 3, 4, 8];
const FILL = [-Infinity, -1, -0, 0, 1e-40, 0.01, 0.3, 0.99999994, 1, 1.00000012, 2, Infinity, NaN];
const OTHER_NET = [Network.None, Network.Street, Network.Road, Network.Avenue, Network.OneWay, 7, 127, 128, 129, 254, 255];
const LAYERS = ['stigma', 'prestige', 'campus'] as const;
const SOURCES = ['t_r1', 't_id', 't_im', 'j4_plant', 'j4_landmark', 'j4_campus', 'j4_co6', 'j4_cs6', 'j4_cs5'];

beforeAll(() => {
  registerTestDefs();
  const defs: BuildingDef[] = [
    { id: 'j4_plant', name: 'Plant', model: 'util_coal_plant', category: 'power', footprint: [1, 1], powerOut: 100,
      stigma: { amount: 0.55, radius: 4.25 } },
    { id: 'j4_landmark', name: 'Landmark', model: 'civ_city_hall', category: 'landmark', footprint: [1, 1],
      prestige: { amount: 0.4, radius: 3.5 } },
    { id: 'j4_campus', name: 'Campus', model: 'civ_university', category: 'education', footprint: [1, 1],
      stigma: { amount: 0.1, radius: 2 }, prestige: { amount: 0.2, radius: 3 }, campus: { amount: 0.6, radius: 4 } },
    { ...getDef('t_co')!, id: 'j4_co6', footprint: [1, 1], stage: 6 },
    { ...getDef('t_cs')!, id: 'j4_cs6', devType: DevType.CS3, stage: 6 },
    { ...getDef('t_cs')!, id: 'j4_cs5', devType: DevType.CS3, stage: 5 },
  ];
  for (const def of defs) if (!getDef(def.id)) CATALOG.push(def);
  rebuildCatalogIndex();
  clearInfoCache();
});

function byteView(length: number, offset: number, sentinel: number): Uint8Array {
  const storage = new Uint8Array(offset + length + 3).fill(sentinel);
  return storage.subarray(offset, offset + length);
}

function makeState(size: number, offset = 0): CityState {
  // Like cityGen.newState, with a fixed config to avoid defaultCityConfig's random default seed draw.
  const st = new CityState({
    name: 'NIMBY exact', mayor: 'Test', size, seed: 0x4a34, difficulty: 'medium', climate: 'temperate',
    terrain: 'flat', waterAmount: 0, hilliness: 0, treeDensity: 0, disasters: false, startFunds: 100000, startYear: 2000,
  });
  st.heights.fill(5);
  st.zone = byteView(st.cells, 1, Zone.Landfill).fill(Zone.None);
  st.network = byteView(st.cells, offset, Network.Highway).fill(Network.None);
  st.netFlags = byteView(st.cells, 3, 255).fill(0);
  return st;
}

function makeSim(st: CityState, load?: number): Simulation {
  const utilities = { name: 'utilities', load: load ?? 0, plantLoad(id: number) { return this.load + (id & 1) * 0.125; } };
  return new Simulation(st, load === undefined ? [] : [utilities]);
}

function bytes(a: Float32Array): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

function check(sim: Simulation, label: string): void {
  // Both the initial scheduler estimate and the cached estimate after a previous rebuild must agree.
  expect(nimbyCost(sim), `${label}: previous cost`).toBe(nimbyCostOriginal(sim));
  rebuildNimbyOriginal(sim);
  const expected = LAYERS.map((key) => bytes(sim.state[key]).slice());
  const cost = nimbyCostOriginal(sim);
  for (const key of LAYERS) sim.state[key].fill(NaN);
  rebuildNimby(sim);
  expect(nimbyCost(sim), `${label}: rebuilt cost`).toBe(cost);
  for (let k = 0; k < LAYERS.length; k++) {
    const actual = bytes(sim.state[LAYERS[k]]), ref = expected[k];
    let diff = -1;
    for (let i = 0; i < ref.length; i++) if (actual[i] !== ref[i]) { diff = i; break; }
    expect(diff, `${label}: ${LAYERS[k]} byte ${diff}: ${actual[diff]} vs ${ref[diff]}`).toBe(-1);
  }
}

describe('J4 NIMBY exactness against the frozen pre-fix rebuild (14,178 cases)', () => {
  it('matches 10,000 seeded random states, including mixed building sources and plant loads', { timeout: 30000 }, () => {
    const rng = new RNG(0x4a340001);
    for (let c = 0; c < 10000; c++) {
      const N = rng.pick([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
      const offset = rng.pick(OFFSETS), st = makeState(N, offset);
      const lfDensity = rng.pick([0, 0.02, 0.2, 0.6, 1]), netDensity = rng.pick([0, 0.05, 0.25, 0.8, 1]);
      for (let i = 0; i < st.cells; i++) {
        st.zone[i] = rng.chance(lfDensity) ? Zone.Landfill : rng.int(0, 9);
        st.landfillFill[i] = rng.chance(0.25) ? rng.pick(FILL) : rng.range(-0.1, 1.1);
        st.network[i] = rng.chance(netDensity) ? rng.pick([Network.Highway, Network.Rail]) : rng.pick(OTHER_NET);
        st.netFlags[i] = rng.int(0, 255);
      }
      const count = N > 0 ? rng.int(0, 4) : 0;
      for (let b = 0; b < count; b++) {
        let def = getDef(rng.pick(SOURCES))!;
        if (def.footprint[0] > N || def.footprint[1] > N) def = getDef('t_id')!;
        place(st, def.id, rng.int(0, N - def.footprint[0]), rng.int(0, N - def.footprint[1]), {
          flags: rng.pick([0, BF.Powered, BF.Burnt, BF.Abandoned, BF.OnFire, BF.Constructing]),
          built: rng.pick([0, 0.99, 1, 1, 1.1]),
        });
      }
      const sim = makeSim(st, rng.pick([undefined, -Infinity, -1, -0, 0.4, 1, 2, Infinity, NaN]));
      check(sim, `seed=0x4a340001 case=${c} N=${N} offset=${offset}`);
    }
  });

  it('matches 1,990 empty, single-cell, full-row, full-map and last-column landfill cases', () => {
    let cases = 0;
    for (const N of [0, 1, 2, 3, 4, 5, 6, 7, 9, 10]) for (const offset of OFFSETS.slice(0, 5)) {
      const st = makeState(N, offset), sim = makeSim(st);
      for (let i = 0; i < st.cells; i++) st.landfillFill[i] = FILL[i % FILL.length];
      const run = (label: string) => { check(sim, `landfill N=${N} offset=${offset} ${label}`); cases++; };
      run('empty');
      for (let i = 0; i < st.cells; i++) {
        st.zone.fill(Zone.None);
        st.zone[i] = Zone.Landfill;
        run(`single ${i}`);
      }
      for (let z = 0; z < N; z++) {
        st.zone.fill(Zone.None);
        st.zone.fill(Zone.Landfill, z * N, (z + 1) * N);
        run(`full row ${z}`);
      }
      st.zone.fill(Zone.Landfill);
      run('full map');
      st.zone.fill(Zone.None);
      for (let z = 0; z < N; z++) st.zone[z * N + N - 1] = Zone.Landfill;
      run('last column');
    }
    expect(cases).toBe(1990);
  });

  it('matches 1,068 corridor boundary, tail, bridge, tunnel and mixed-word cases', () => {
    let cases = 0;
    for (const offset of OFFSETS) {
      const st = makeState(3, offset), sim = makeSim(st);
      for (const type of [Network.Highway, Network.Rail]) for (const flags of [0, 1, 2, 3, 4, 16, 32, 128, 255]) {
        for (let at = 0; at < st.cells; at++) {
          for (let i = 0; i < st.cells; i++) st.network[i] = OTHER_NET[(i + flags) % OTHER_NET.length];
          st.network[at] = type;
          st.netFlags.fill(flags);
          check(sim, `network offset=${offset} type=${type} flags=${flags} at=${at}`);
          cases++;
        }
      }
      for (let mask = 0; mask < 16; mask++) {
        for (let i = 0; i < 8; i++) {
          st.network[i] = mask & (1 << (i & 3)) ? (i < 4 ? Network.Highway : Network.Rail) : Network.OneWay;
          st.netFlags[i] = i & 3;
        }
        st.network[8] = mask & 1 ? Network.Highway : Network.Rail;
        st.netFlags[8] = mask;
        check(sim, `mixed network offset=${offset} mask=${mask}`);
        cases++;
      }
    }
    expect(cases).toBe(1068);
  });

  it('matches all 256 byte values in every word lane (1,024 cases)', () => {
    const sims = OFFSETS.filter((offset) => (offset & 3) === 0).map((offset) => makeSim(makeState(3, offset)));
    let cases = 0;
    for (let value = 0; value < 256; value++) for (let lane = 0; lane < 4; lane++) {
      const sim = sims[(value + lane) % sims.length], st = sim.state;
      st.network.set([128, 255, 1, 4, 7, 129, 254, 0, 0]);
      st.network[lane] = value;
      st.netFlags.fill(0);
      check(sim, `byte=${value} lane=${lane} offset=${st.network.byteOffset}`);
      cases++;
    }
    expect(cases).toBe(1024);
  });

  it('matches 96 short and oversized network views without reading outside the view or cell count', () => {
    let cases = 0;
    for (const offset of OFFSETS) for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16, 17, 19]) {
      const st = makeState(4, offset);
      st.network = byteView(length, offset, Network.Highway);
      for (let i = 0; i < length; i++) st.network[i] = i % 3 ? Network.Rail : Network.Highway;
      check(makeSim(st), `view offset=${offset} length=${length}`);
      cases++;
    }
    expect(cases).toBe(96);
  });
});
