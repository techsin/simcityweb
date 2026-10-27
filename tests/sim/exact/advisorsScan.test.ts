/**
 * B3 A0 exactness gate: the advisors' month scans in small top-level kernels (scanZones' flood fill and lot classification,
 * lotFitAny's wide search, scanOutages' and scanRubble's rare branches) give the same ZoneScan as the frozen base
 * (advisorsScanOriginal.ts, a59f08f) on random cities: zones of every family, roads, rail, water, power lines, odd tiles,
 * steep ground, occupied buildings without power / water, rubble. Every value is compared with Object.is.
 */
import { describe, expect, it } from 'vitest';
import { RNG } from '../../../src/core/rng';
import { Network, Zone } from '../../../src/core/types';
import { BF, type CityState } from '../../../src/sim/CityState';
import { Simulation } from '../../../src/sim/Simulation';
import { EconRuntime } from '../../../src/sim/economy/runtime';
import { MONTH_SCAN_DAYS, advisorData, advisorsSystem, lotFitAt } from '../../../src/sim/economy/advisors';
import { newState, place } from '../../infra/cityGen';
import { lotFitAtOriginal, zoneScanOriginal } from './advisorsScanOriginal';

function exact(a: unknown, b: unknown, path = 'scan'): void {
  if (Object.is(a, b)) return;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') throw new Error(`A0 mismatch at ${path}: ${String(a)} / ${String(b)}`);
  if (Array.isArray(a) !== Array.isArray(b)) throw new Error(`A0 mismatch at ${path}: array / object`);
  const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
  if (ak.join() !== bk.join()) throw new Error(`A0 mismatch at ${path}: keys ${ak.join()} / ${bk.join()}`);
  for (const k of ak) exact((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
}

const GROWABLES_1 = ['t_r1', 't_r2', 't_cs', 't_id', 't_iht'];
const GROWABLES_2 = ['t_r3', 't_co', 't_im'];
const ZONES = [Zone.ResLow, Zone.ResMed, Zone.ResHigh, Zone.ComLow, Zone.ComMed, Zone.ComHigh, Zone.IndAg, Zone.IndMed, Zone.IndHigh, Zone.Landfill];

/** a random city: zone rectangles, a road grid with gaps, rail, water, power lines, slopes, buildings (some dark, dry,
 *  abandoned or in rubble), random power / water / desirability layers */
function randomCity(seed: number, size = 72): CityState {
  const st = newState(size);
  const rng = new RNG(seed);
  const N = size, N1 = N + 1;
  // terrain: flat with a few hills (steep lots)
  for (let h = 0; h < 8; h++) {
    const cx = rng.int(0, N), cz = rng.int(0, N), r = rng.int(3, 8), top = 10 + rng.next() * 30;
    for (let z = 0; z <= N; z++) for (let x = 0; x <= N; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d < r) st.heights[z * N1 + x] += top * (1 - d / r);
    }
  }
  for (let k = 0; k < 40; k++) {
    const x0 = rng.int(0, N - 2), z0 = rng.int(0, N - 2), w = rng.int(1, 14), d = rng.int(1, 14), zn = rng.pick(ZONES);
    for (let z = z0; z < Math.min(N, z0 + d); z++) for (let x = x0; x < Math.min(N, x0 + w); x++) st.zone[z * N + x] = zn;
  }
  const kinds = [Network.Street, Network.Road, Network.OneWay, Network.Avenue, Network.Highway, Network.Rail];
  for (let v = 2; v < N; v += rng.int(3, 7)) {
    const t = rng.pick(kinds);
    for (let z = 0; z < N; z++) if (rng.next() > 0.08) { st.network[z * N + v] = t; st.zone[z * N + v] = 0; }
  }
  for (let h = 3; h < N; h += rng.int(3, 8)) {
    const t = rng.pick(kinds);
    for (let x = 0; x < N; x++) if (rng.next() > 0.08) { st.network[h * N + x] = t; st.zone[h * N + x] = 0; }
  }
  for (let k = 0; k < 30; k++) st.water[rng.int(0, st.cells - 1)] = 1;
  for (let k = 0; k < 30; k++) st.powerLines[rng.int(0, st.cells - 1)] = 1;
  // buildings on zoned land
  for (let k = 0; k < 500; k++) {
    const big = rng.next() < 0.25;
    const def = big ? rng.pick(GROWABLES_2) : rng.pick(GROWABLES_1);
    const s = big ? 2 : 1;
    const x = rng.int(0, N - s), z = rng.int(0, N - s);
    let free = true;
    for (let zz = z; zz < z + s; zz++) for (let xx = x; xx < x + s; xx++) {
      const i = zz * N + xx;
      if (st.building[i] >= 0 || st.network[i] !== Network.None || st.water[i] || st.zone[i] < Zone.ResLow || st.zone[i] > Zone.IndHigh) free = false;
    }
    if (!free) continue;
    let flags = 0;
    if (rng.next() < 0.8) flags |= BF.Powered;
    if (rng.next() < 0.7) flags |= BF.Watered;
    if (rng.next() < 0.06) flags |= BF.Burnt;
    if (rng.next() < 0.05) flags |= BF.Abandoned;
    place(st, def, x, z, { pop: rng.next() < 0.7 ? rng.int(0, 80) : 0, jobs: rng.next() < 0.5 ? rng.int(0, 40) : 0, flags });
  }
  // plopped rubble (ignored by scanRubble) and a burnt def-less building
  place(st, 't_park', 1, 1, { flags: BF.Plopped | BF.Burnt });
  for (let i = 0; i < st.cells; i++) {
    st.powered[i] = rng.next() < 0.85 ? 1 : 0;
    st.watered[i] = rng.next() < 0.75 ? 1 : 0;
  }
  for (const layer of st.desirability) for (let i = 0; i < st.cells; i++) layer[i] = rng.next() * 2 - 1;
  return st;
}

describe('B3 A0: the advisors month scans in kernels are bit-identical to the base', () => {
  for (const util of [true, false]) {
    it(`zone scan, utilities ${util ? 'on' : 'off'}: 8 random cities, the kernels' ZoneScan equals the frozen base's`, () => {
      const seen = { out: 0, small: 0, steep: 0, rubble: 0, noAccess: 0 };
      for (let seed = 1; seed <= 8; seed++) {
        const st = randomCity(seed * 7919 + (util ? 1 : 0));
        st.systemData.infraVersion = 1;
        st.systemData.infraLayers = { utilities: util, traffic: false, pollution: false, services: false };
        const rt = new EconRuntime();
        const adv = advisorsSystem(rt);
        const sim = new Simulation(st, [adv]);
        st.day = 30 + MONTH_SCAN_DAYS[0];
        adv.daily!(sim);
        const live = advisorData(st).scan!.zone!;
        const orig = zoneScanOriginal(st, rt, util);
        exact(live, orig, `seed ${seed}`);
        if (util && live.outP! + live.outW! > 0) seen.out++;
        if (live.lotSmall!.some((n) => n > 0)) seen.small++;
        if (live.lotSteep!.some((n) => n > 0)) seen.steep++;
        if (live.rubbleLots!.some((n) => n > 0)) seen.rubble++;
        if (live.noAccess > 0) seen.noAccess++;
      }
      // (the random cities reach every branch: outages, odd tiles, steep lots, rubble, roadless blocks)
      expect(seen.small * seen.steep * seen.rubble * seen.noAccess * (util ? seen.out : 1), JSON.stringify(seen)).toBeGreaterThan(0);
    });
  }

  it('lotFitAt (the lot inspector) equals the frozen base on every tile', () => {
    const total = [0, 0, 0, 0];
    for (let seed = 1; seed <= 4; seed++) {
      const st = randomCity(seed * 104729);
      const counts = [0, 0, 0, 0];
      for (let z = 0; z < st.size; z++) for (let x = 0; x < st.size; x++) {
        const a = lotFitAt(st, x, z), b = lotFitAtOriginal(st, x, z);
        if (a !== b) throw new Error(`lotFitAt mismatch at ${x},${z}: ${a} / ${b}`);
        counts[a + 1]++;
      }
      for (let k = 0; k < 4; k++) total[k] += counts[k];
    }
    // every answer occurs (not a growth tile, fits, too small, too steep)
    expect(total.every((n) => n > 0), total.join()).toBe(true);
  });
});
