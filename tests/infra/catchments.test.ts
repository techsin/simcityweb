/**
 * WP2 catchments & proximity engine (docs/SIM_DEPTH_SPEC.md §B): reach kernels (walk / drive / euclid), capacity
 * sharing (seats conserved, crowding), tier separation, power gating, facilityLoad, unservedClusters, access fields
 * (accessCommute, shopAccess), NIMBY / YIMBY rasters, the reach cache and the step budget.
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { CATALOG, getDef, rebuildCatalogIndex } from '../../src/sim/catalog';
import type { BuildingDef } from '../../src/sim/catalogTypes';
import { clearInfoCache, infoOf } from '../../src/sim/infra/common';
import { facilityLoad, newReachScratch, reachCells, unservedClusters } from '../../src/sim/infra/catchments';
import type { ServicesSystem } from '../../src/sim/infra/services';
import { schedulerOf } from '../../src/sim/infra/scheduler';
import { serializeCity, deserializeCity } from '../../src/save/serialize';
import { newSim, newState, place, roadLine, stressCity } from './cityGen';

/** test tier defs without power / water use (so gating does not interfere), registered once */
const WP2_DEFS: BuildingDef[] = [
  { id: 'wp2_elem', name: 'Elem', model: 'civ_elementary_school', category: 'education', footprint: [1, 1], service: 'education',
    coverage: { kind: 'education', radius: 20, strength: 1, capacity: 1500, tier: 'elementary', metric: 'walk' } },
  { id: 'wp2_elem_small', name: 'Elem small', model: 'civ_elementary_school', category: 'education', footprint: [1, 1], service: 'education',
    coverage: { kind: 'education', radius: 12, strength: 1, capacity: 300, tier: 'elementary', metric: 'walk' } },
  { id: 'wp2_college', name: 'College', model: 'civ_college', category: 'education', footprint: [1, 1], service: 'education',
    coverage: { kind: 'education', radius: 30, strength: 1, capacity: 6000, tier: 'college', metric: 'drive' }, campus: { amount: 1, radius: 18 } },
  { id: 'wp2_play', name: 'Playground', model: 'park_playground', category: 'park', footprint: [1, 1], service: 'parks',
    coverage: { kind: 'park', radius: 6, strength: 0.9, capacity: 700, tier: 'play', metric: 'walk' } },
  { id: 'wp2_hosp', name: 'Hospital', model: 'civ_hospital', category: 'health', footprint: [1, 1], service: 'health',
    coverage: { kind: 'health', radius: 20, strength: 1, capacity: 40000, tier: 'hospital', metric: 'drive' } },
  { id: 'wp2_house', name: 'House', model: 'res_tower', category: 'growable', footprint: [1, 1], devType: 1, zones: [Zone.ResMed], capacity: 100000 },
];
function registerWp2(): void {
  let added = false;
  for (const d of WP2_DEFS) if (!getDef(d.id)) { CATALOG.push(d); added = true; }
  if (added) rebuildCatalogIndex();
  clearInfoCache();
}
function svc(sim: ReturnType<typeof newSim>): ServicesSystem {
  return sim.getSystem<ServicesSystem>('services')!;
}
/** homes along the road (one cell off), `perHome` residents each */
function homes(st: CityState, x0: number, x1: number, z: number, perHome: number): Building[] {
  const out: Building[] = [];
  for (let x = x0; x <= x1; x++) out.push(place(st, 'wp2_house', x, z, { pop: perHome, capacity: 100000, wealth: 2 }));
  return out;
}

describe('catchments: capacity sharing', () => {
  it('1 school (1,500 seats) + 3,000 kids ~ 0.5 in the plateau; two overlapping schools ~ 1.0 with served <= 3,000', () => {
    registerWp2();
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    // 3,000 kids = 23,077 residents at the reference mix (kids 0.13), 7 homes within 3 cells of the school
    const hs = homes(st, 27, 33, 31, 23077 / 7);
    place(st, 'wp2_elem', 30, 29);
    const sim = newSim(st);
    const kids = st.stats.needs.elementary.need;
    expect(kids).toBeGreaterThan(2990);
    expect(kids).toBeLessThan(3010);
    const cov1 = st.eduElemCov[st.idx(30, 31)];
    console.log(`one school: kids ${kids} served ${st.stats.needs.elementary.served} cov ${cov1.toFixed(3)}`);
    expect(cov1).toBeGreaterThan(0.45);
    expect(cov1).toBeLessThan(0.55);
    expect(st.stats.needs.elementary.served).toBeLessThanOrEqual(1500 * 1.01);
    const load = facilityLoad(sim, st.building[st.idx(30, 29)])!;
    expect(load.tier).toBe('elementary');
    expect(load.capacity).toBe(1500);
    expect(load.utilization).toBeGreaterThan(1.8);
    expect(load.utilization).toBeLessThan(2.1);
    // a second school next to it: each counts half the children
    place(st, 'wp2_elem', 31, 29);
    svc(sim).compute(sim, false);
    const cov2 = st.eduElemCov[st.idx(30, 31)];
    const n = st.stats.needs.elementary;
    console.log(`two schools: served ${n.served} capacity ${n.capacity} cov ${cov2.toFixed(3)}`);
    expect(cov2).toBeGreaterThan(0.95);
    expect(n.served).toBeLessThanOrEqual(3000 * 1.01);
    for (const h of hs) expect(st.eduElemCov[st.idx(h.x, h.z)]).toBeGreaterThan(0.95);
    expect(facilityLoad(sim, st.building[st.idx(31, 29)])!.utilization).toBeLessThan(1.1);
  });

  it('conservation: served <= 1.05 x capacity (and <= need) for random layouts', () => {
    registerWp2();
    let rs = 12345;
    const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
    for (let trial = 0; trial < 6; trial++) {
      const st = newState(48);
      for (let k = 2; k < 48; k += 5) { roadLine(st, 0, k, 47, k, Network.Street); roadLine(st, k, 0, k, 47, Network.Road); }
      for (let q = 0; q < 120; q++) {
        const x = Math.floor(rnd() * 48), z = Math.floor(rnd() * 48);
        if (st.network[st.idx(x, z)] || st.building[st.idx(x, z)] >= 0) continue;
        place(st, 'wp2_house', x, z, { pop: Math.round(200 + rnd() * 3000), capacity: 100000, wealth: 2 });
      }
      const nSchools = 2 + Math.floor(rnd() * 6);
      for (let q = 0; q < nSchools; q++) {
        const x = Math.floor(rnd() * 48), z = Math.floor(rnd() * 48);
        if (st.network[st.idx(x, z)] || st.building[st.idx(x, z)] >= 0) continue;
        place(st, rnd() < 0.5 ? 'wp2_elem_small' : 'wp2_elem', x, z);
      }
      newSim(st);
      const n = st.stats.needs.elementary;
      expect(n.served, `trial ${trial}`).toBeLessThanOrEqual(n.capacity * 1.05 + 1);
      expect(n.served).toBeLessThanOrEqual(n.need + 1);
      expect(n.need).toBeGreaterThan(0);
    }
  });

  it('tiers are separate: a university alone gives eduElemCov = 0 but eduCollegeCov > 0', () => {
    registerWp2();
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    homes(st, 20, 40, 31, 400);
    place(st, 'wp2_college', 30, 29);
    newSim(st);
    let elem = 0;
    for (let i = 0; i < st.cells; i++) elem = Math.max(elem, st.eduElemCov[i]);
    expect(elem).toBe(0);
    expect(st.eduCollegeCov[st.idx(30, 31)]).toBeGreaterThan(0.5);
    expect(st.stats.needs.elementary.unreached).toBeCloseTo(st.stats.needs.elementary.need, 0);
    // legacy eduCov = .2 x college here (no longer saturates)
    expect(st.eduCov[st.idx(30, 31)]).toBeCloseTo(0.2 * st.eduCollegeCov[st.idx(30, 31)], 4);
  });
});

describe('catchments: reach kernels', () => {
  it('walk: a highway blocks a playground / school catchment, a road does not', () => {
    registerWp2();
    for (const barrier of [Network.Road, Network.Highway]) {
      const st = newState(64);
      roadLine(st, 2, 30, 60, 30, Network.Road);
      roadLine(st, 25, 0, 25, 63, barrier); // crossing line at x = 25
      homes(st, 26, 29, 31, 100);
      place(st, 'wp2_play', 20, 31);
      place(st, 'wp2_elem', 12, 31);
      newSim(st);
      const play = st.playCov[st.idx(26, 31)], elem = st.eduElemCov[st.idx(28, 31)];
      console.log(`${barrier === Network.Highway ? 'highway' : 'road'}: play across ${play.toFixed(2)} elem across ${elem.toFixed(2)}`);
      if (barrier === Network.Highway) { expect(play).toBe(0); expect(elem).toBe(0); }
      else { expect(play).toBeGreaterThan(0.25); expect(elem).toBeGreaterThan(0.3); }
    }
    // drive metric (hospital) crosses via the ramp: highway <-> road connect
  });

  it('walk: an unbridged river blocks, a bridge passes', () => {
    registerWp2();
    for (const bridged of [false, true]) {
      const st = newState(64);
      for (let z = 0; z < 64; z++) for (let x = 36; x <= 38; x++) st.water[st.idx(x, z)] = 1;
      roadLine(st, 2, 30, 35, 30, Network.Road);
      roadLine(st, 39, 30, 60, 30, Network.Road);
      if (bridged) { roadLine(st, 36, 30, 38, 30, Network.Road); for (let x = 36; x <= 38; x++) st.netFlags[st.idx(x, 30)] |= 1; }
      homes(st, 40, 44, 31, 100);
      place(st, 'wp2_elem', 30, 31);
      newSim(st);
      const across = st.eduElemCov[st.idx(42, 31)];
      if (bridged) expect(across).toBeGreaterThan(0.3); else expect(across).toBe(0);
    }
  });

  it('drive: an avenue reaches farther than streets', () => {
    const st = newState(96);
    const sc = newReachScratch(st.cells);
    const reachAt = (type: Network, x: number) => {
      st.network.fill(0);
      roadLine(st, 2, 40, 94, 40, type);
      const n = reachCells(st, 10, 41, 1, 1, 20, 'drive', sc);
      for (let k = 0; k < n; k++) if (sc.idx[k] === st.idx(x, 41)) return sc.w[k];
      return 0;
    };
    // 20 x 1.3 = 26 road-cell units: streets (5/4) reach ~21 cells, avenues (3/4) ~35
    const street = reachAt(Network.Street, 10 + 24), avenue = reachAt(Network.Avenue, 10 + 24);
    console.log(`drive 24 cells: street ${street.toFixed(2)} avenue ${avenue.toFixed(2)}`);
    expect(street).toBe(0);
    expect(avenue).toBeGreaterThan(0.2);
    // walk: streets and roads cost the same, avenues are wider to cross
    const wRoad = (() => { st.network.fill(0); roadLine(st, 2, 40, 94, 40, Network.Road); const n = reachCells(st, 10, 41, 1, 1, 20, 'walk', sc); return n; })();
    expect(wRoad).toBeGreaterThan(50);
  });

  it('euclid: a disk that ignores roads', () => {
    const st = newState(64);
    const sc = newReachScratch(st.cells);
    const n = reachCells(st, 30, 30, 2, 2, 10, 'euclid', sc);
    expect(n).toBeGreaterThan(250);
    let far = 0;
    for (let k = 0; k < n; k++) { const x = sc.idx[k] % 64, z = (sc.idx[k] / 64) | 0; far = Math.max(far, Math.hypot(x - 30.5, z - 30.5)); }
    expect(far).toBeLessThanOrEqual(11.1);
  });
});

describe('catchments: operating factor', () => {
  it('an unpowered school operates at 0.3 (catalog def with powerUse); a def without power use at 1', () => {
    registerWp2();
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    roadLine(st, 2, 5, 60, 5, Network.Road);
    homes(st, 26, 34, 31, 300);
    const real = place(st, 'civ_elementary_school', 28, 27); // 3x3, powerUse 0.2, no power plant
    const test = place(st, 'wp2_elem', 45, 6);
    const sim = newSim(st);
    expect(real.flags & BF.Powered).toBe(0);
    const lr = facilityLoad(sim, real.id)!, lt = facilityLoad(sim, test.id)!;
    expect(lr.operating).toBeCloseTo(0.3, 3);
    expect(lr.powered).toBe(false);
    expect(lt.operating).toBeCloseTo(1, 3);
    // uncrowded: coverage = strength x op
    expect(st.eduElemCov[st.idx(29, 31)]).toBeCloseTo(0.3, 1);
    // half funding: funding^0.7 on the operating factor
    st.budget.funding.education = 50;
    svc(sim).compute(sim, false);
    expect(facilityLoad(sim, test.id)!.operating).toBeCloseTo(Math.pow(0.5, 0.7), 2);
  });
});

describe('catchments: clusters, access fields, NIMBY', () => {
  it('unservedClusters points at the uncovered neighbourhood', () => {
    registerWp2();
    const st = newState(64);
    roadLine(st, 2, 10, 60, 10, Network.Road);
    roadLine(st, 2, 50, 60, 50, Network.Road);
    homes(st, 5, 15, 11, 500); // covered
    homes(st, 40, 50, 51, 800); // not covered
    place(st, 'wp2_elem', 10, 9);
    const sim = newSim(st);
    const cl = unservedClusters(sim, 'elementary', 3);
    expect(cl.length).toBeGreaterThan(0);
    expect(Math.abs(cl[0].z - 51)).toBeLessThanOrEqual(2);
    expect(cl[0].x).toBeGreaterThan(38);
    expect(cl[0].people).toBeGreaterThan(500);
  });

  it('accessCommute is > 0 everywhere reachable and grows with distance from job sites; shopAccess falls off', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 62, 30, Network.Road);
    place(st, 't_co', 4, 31, { jobs: 300, capacity: 400 }); // 2x2 job site at the west end
    for (let x = 6; x <= 12; x++) place(st, 't_cs', x, 29, { jobs: 15, capacity: 20 });
    for (let x = 6; x <= 12; x++) place(st, 't_r2', x, 31, { pop: 60 });
    newSim(st);
    const at = (x: number, z: number) => st.accessCommute[st.idx(x, z)];
    const near = at(14, 29), mid = at(35, 29), far = at(60, 29);
    console.log(`accessCommute empty lots: near ${near.toFixed(2)} mid ${mid.toFixed(2)} far ${far.toFixed(2)} job site ${at(4, 31).toFixed(2)}`);
    expect(near).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(near);
    expect(far).toBeGreaterThan(mid);
    expect(at(4, 31)).toBeGreaterThan(0); // C / I cells too
    const s0 = st.shopAccess[st.idx(9, 28)], s1 = st.shopAccess[st.idx(40, 29)], s2 = st.shopAccess[st.idx(62, 10)];
    console.log(`shopAccess: next to shops ${s0.toFixed(2)} 30 cells ${s1.toFixed(2)} off-road ${s2.toFixed(2)}`);
    expect(s0).toBeGreaterThan(0.5);
    expect(s1).toBeLessThan(s0);
    expect(s2).toBe(0);
  });

  it('stigma: a coal plant is strongly stigmatised nearby, 0 at its radius; a burnt plant contributes 0', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    const plant = place(st, 'util_coal_plant', 20, 21); // 4x4, stigma .55 r12
    const sim = newSim(st);
    const near = st.stigma[st.idx(22, 26)];
    // .55 at the source, x (.5 + .5 load) once utilities reports plant load (WP3): idle plant .275
    console.log(`coal plant stigma next door ${near.toFixed(3)}`);
    expect(near).toBeGreaterThan(1 - Math.exp(-0.55 * 0.5) - 1e-6);
    expect(near).toBeLessThanOrEqual(1 - Math.exp(-0.55) + 1e-6);
    expect(st.stigma[st.idx(24 + 12, 23)]).toBe(0); // 12 cells from the footprint edge (x 20..23)
    expect(st.stigma[st.idx(24 + 6, 23)]).toBeGreaterThan(0);
    plant.flags |= BF.Burnt;
    sim.events.emit('buildingChanged', plant);
    svc(sim).compute(sim, false);
    expect(st.stigma[st.idx(22, 26)]).toBe(0);
  });

  it('prestige near a landmark, campus near a university; highway corridor stigma (tunnels none)', () => {
    registerWp2();
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    place(st, 'lm_cathedral', 10, 21);
    place(st, 'wp2_college', 40, 21);
    roadLine(st, 0, 45, 63, 45, Network.Highway);
    for (let x = 40; x < 63; x++) st.netFlags[st.idx(x, 45)] |= 2; // tunnel
    newSim(st);
    expect(st.prestige[st.idx(12, 26)]).toBeGreaterThan(0.3);
    expect(st.campus[st.idx(40, 25)]).toBeGreaterThan(0.5);
    expect(st.campus[st.idx(10, 50)]).toBe(0);
    expect(st.stigma[st.idx(10, 46)]).toBeGreaterThan(0.1);
    expect(st.stigma[st.idx(10, 46)]).toBeLessThan(0.2); // corridor combines by max, not sum
    expect(st.stigma[st.idx(55, 46)]).toBe(0);
  });
});

describe('catchments: cache, save / load, budget', () => {
  it('reach cache reuses searches; a network change near a facility refreshes it (same result as a fresh pass)', () => {
    registerWp2();
    const st = newState(64);
    roadLine(st, 2, 30, 50, 30, Network.Road);
    homes(st, 20, 40, 31, 400);
    place(st, 'wp2_elem', 30, 29);
    const sim = newSim(st);
    const before = st.eduElemCov[st.idx(47, 31)];
    // extend the road with an event (as the game does): coverage must grow into the new street
    roadLine(st, 51, 30, 60, 30, Network.Road);
    roadLine(st, 44, 31, 44, 40, Network.Street);
    homes(st, 45, 45, 38, 400);
    sim.events.emit('networkChanged', { x0: 44, z0: 30, x1: 60, z1: 40 });
    svc(sim).compute(sim, false);
    const withCache = Float32Array.from(st.eduElemCov);
    // fresh recomputation from scratch must match exactly
    const sim2 = newSim(st);
    void sim2;
    for (let i = 0; i < st.cells; i++) if (Math.abs(withCache[i] - st.eduElemCov[i]) > 1e-6) throw new Error(`cache mismatch at ${i}`);
    expect(st.eduElemCov[st.idx(45, 37)]).toBeGreaterThan(0);
    expect(before).toBeGreaterThanOrEqual(0);
    // a direct edit without an event is detected by the network hash
    roadLine(st, 30, 31, 30, 45, Network.Road);
    svc(sim).compute(sim, false);
    expect(st.eduElemCov[st.idx(31, 44)]).toBeGreaterThan(0);
  });

  it('derived layers are recomputed identically after save / load', () => {
    registerWp2();
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    homes(st, 20, 40, 31, 500);
    place(st, 'wp2_elem', 30, 29);
    place(st, 'wp2_play', 36, 29);
    place(st, 'util_coal_plant', 50, 25);
    for (let x = 10; x < 18; x++) place(st, 't_cs', x, 29, { jobs: 10, capacity: 20 });
    const sim = newSim(st);
    sim.runDays(20);
    const snap = { e: Float32Array.from(st.eduElemCov), p: Float32Array.from(st.playCov), s: Float32Array.from(st.stigma), sh: Float32Array.from(st.shopAccess), a: Float32Array.from(st.accessCommute) };
    const st2 = deserializeCity(structuredClone(serializeCity(st)));
    newSim(st2);
    for (const [k, a, b] of [['elem', snap.e, st2.eduElemCov], ['play', snap.p, st2.playCov], ['stigma', snap.s, st2.stigma], ['shop', snap.sh, st2.shopAccess]] as const) {
      let d = 0;
      for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
      expect(d, k).toBeLessThan(1e-5);
    }
    expect(st2.accessCommute[st2.idx(50, 29)]).toBeGreaterThan(0);
  });

  it('perf: 256² stress city with ~850 service buildings — every estimated step <= 3 ms, pass cost logged', { timeout: 300000 }, () => {
    const city = stressCity(256);
    const st = city.st;
    let rs = 99;
    const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
    const plan: [string, number][] = [['civ_elementary_school', 90], ['civ_high_school', 33], ['civ_college', 5], ['civ_clinic', 60], ['civ_hospital', 25],
      ['park_small', 200], ['park_playground', 150], ['park_plaza', 100], ['park_large', 60], ['park_soccer', 50], ['civ_police_station', 45], ['civ_fire_station', 35]];
    let placed = 0;
    for (const [def, n] of plan) {
      const d = getDef(def)!;
      let id = def;
      if (d.footprint[0] > 2 || d.footprint[1] > 2) {
        id = def + '_wp2x2';
        if (!getDef(id)) { CATALOG.push({ ...d, id, footprint: [2, 2] }); rebuildCatalogIndex(); clearInfoCache(); }
      }
      for (let k = 0, guard = 0; k < n && guard < 20000; guard++) {
        const bx = Math.floor(rnd() * 84) * 3 + 2, bz = Math.floor(rnd() * 84) * 3 + 2;
        if (bx + 2 >= 256 || bz + 2 >= 256) continue;
        for (let zz = bz; zz < bz + 2; zz++) for (let xx = bx; xx < bx + 2; xx++) {
          const bid = st.building[st.idx(xx, zz)];
          if (bid < 0) continue;
          const ob = st.buildings.get(bid)!;
          for (let a = ob.z; a < ob.z + ob.d; a++) for (let c = ob.x; c < ob.x + ob.w; c++) st.building[st.idx(c, a)] = -1;
          st.buildings.delete(bid);
        }
        const b = place(st, id, bx, bz);
        b.flags |= BF.Powered | BF.Watered;
        k++; placed++;
      }
    }
    const sim = newSim(st);
    const s = svc(sim);
    const sch = schedulerOf(sim);
    const task = sch.tasks.find((t) => t.name === 'services')!;
    const run = (fresh: boolean) => {
      if (fresh) (s as unknown as { invalidateReach(r?: unknown): void }).invalidateReach(undefined);
      let steps = 0, est = 0, maxEst = 0, ms = 0;
      (s as unknown as { stepIdx: number }).stepIdx = -1;
      (s as unknown as { accessDirty: boolean }).accessDirty = true;
      do {
        const c = task.cost(sim);
        est += c; maxEst = Math.max(maxEst, c);
        const a = performance.now();
        task.step(sim);
        ms += performance.now() - a;
        steps++;
      } while ((s as unknown as { stepIdx: number }).stepIdx >= 0);
      return { steps, est, maxEst, ms };
    };
    const fresh = run(true);
    const cached = run(false);
    console.log(`services pass with ${placed} facilities: fresh ${fresh.steps} steps est ${fresh.est.toFixed(1)} (max ${fresh.maxEst.toFixed(2)}) measured ${fresh.ms.toFixed(1)} ms · cached ${cached.steps} steps est ${cached.est.toFixed(1)} (max ${cached.maxEst.toFixed(2)}) measured ${cached.ms.toFixed(1)} ms`);
    expect(placed).toBeGreaterThan(800);
    expect(fresh.maxEst).toBeLessThanOrEqual(3.0);
    expect(cached.maxEst).toBeLessThanOrEqual(3.0);
    expect(cached.est).toBeLessThan(fresh.est * 0.6);
    if (process.env.PERF_STRICT) expect(cached.ms).toBeLessThan(35);
    // needs are filled for every tier
    for (const t of ['elementary', 'high', 'college', 'health', 'play', 'green', 'police', 'fire'] as const) expect(st.stats.needs[t].need).toBeGreaterThan(0);
    expect(infoOf(st, st.buildings.values().next().value!)).toBeDefined();
  });
});
