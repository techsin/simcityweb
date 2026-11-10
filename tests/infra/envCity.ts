/**
 * B2 G3 (docs/dev/B2_DESIGN.md §11.1): a synthetic city that runs every branch of the pollution and crime passes — the
 * stress city plus a river and a lake (the water diffusion, banks), rail with level crossings, highway tunnels / bridges,
 * a landfill (partly full, a few cells already built over: the landfill-fill reset), trees (the tree cover, belts) and
 * every garbage / emitter / spill kind on cleared lots beside a road: a coal plant, an incinerator, a recycling center, a
 * water treatment plant (a cleaning source), a water pump, a casino and a prison (CRIME_SPILL venues), parks; and
 * buildings abandoned, burnt, on fire and under construction, high-density commercial (nightlife).
 * fieldTestCity is tests/wasm/fieldPasses.test.ts's city (moved here so both use it).
 */
import { Network, Zone } from '../../src/core/types';
import { RNG } from '../../src/core/rng';
import { BF, type CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { place, roadLine, stressCity } from './cityGen';

/** the WASM field-pass sections' city: stressCity + a river, a lake, tunnels / bridges, rail with crossings, a landfill */
export function fieldTestCity(size = 96, seed = 7): CityState {
  const { st } = stressCity(size, seed);
  const N = st.size;
  const clear = (x: number, z: number): boolean => {
    const i = z * N + x;
    if (st.network[i] === Network.Highway || st.network[i] === Network.Avenue) { st.netFlags[i] |= 1; return false; }
    const id = st.building[i];
    if (id >= 0) {
      const b = st.buildings.get(id);
      if (b) for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) st.building[zz * N + xx] = -1;
      st.buildings.delete(id);
    }
    st.network[i] = 0; st.netFlags[i] = 0; st.zone[i] = 0;
    return true;
  };
  const rx = Math.floor(N * 0.35);
  for (let z = 6; z < N - 6; z++) for (let x = rx; x < rx + 3; x++) if (clear(x, z)) st.water[z * N + x] = 1;
  const lx = Math.floor(N * 0.6), lz = Math.floor(N * 0.2);
  for (let z = lz; z < lz + 9; z++) for (let x = lx; x < lx + 9; x++) if (clear(x, z)) st.water[z * N + x] = 1;
  // highway tunnels / bridges elsewhere, a rail line with level crossings
  let hw = 0;
  for (let i = 0; i < st.cells; i++) if (st.network[i] === Network.Highway && !(st.netFlags[i] & 1)) { hw++; if (hw % 7 === 0) st.netFlags[i] |= 1; if (hw % 11 === 0) st.netFlags[i] |= 2; }
  const rz = 3 * Math.floor(N / 3 / 4) + 1;
  for (let x = 0; x < N; x++) {
    const i = rz * N + x;
    if (st.network[i] === Network.Street || st.network[i] === Network.Road) {
      if (x % 3 === 1) st.netFlags[i] |= 0x20;
      else st.network[i] = Network.Rail;
    }
  }
  // a landfill next to a road
  for (let z = N - 12; z < N - 4; z++) for (let x = 4; x < 12; x++) {
    const i = z * N + x;
    if (st.network[i] === 0 && st.building[i] < 0 && !st.water[i]) st.zone[i] = Zone.Landfill;
  }
  return st;
}

/** remove every building and road of a rectangle (map-clamped) */
export function clearRect(st: CityState, x0: number, z0: number, w: number, d: number): void {
  const N = st.size;
  for (let z = Math.max(0, z0); z < Math.min(N, z0 + d); z++) for (let x = Math.max(0, x0); x < Math.min(N, x0 + w); x++) {
    const i = z * N + x;
    const id = st.building[i];
    if (id >= 0) {
      const b = st.buildings.get(id);
      if (b) for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) st.building[zz * N + xx] = -1;
      st.buildings.delete(id);
    }
    st.network[i] = 0; st.netFlags[i] = 0;
    if (st.zone[i] !== Zone.Landfill) st.zone[i] = 0;
  }
}

/** the pollution / crime test city (see the file comment) */
export function envCity(size = 96, seed = 7): CityState {
  const st = fieldTestCity(size, seed);
  const N = st.size, rng = new RNG(seed * 7919 + 3);
  // a landfill on a cleared 8 x 8 lot with a road on its north edge, and a small one no road touches (the roadless path)
  clearRect(st, 3, N - 13, 10, 10);
  roadLine(st, 3, N - 13, 12, N - 13, Network.Road);
  for (let z = N - 12; z < N - 4; z++) for (let x = 4; x < 12; x++) if (!st.water[z * N + x]) st.zone[z * N + x] = Zone.Landfill;
  clearRect(st, N - 9, N - 9, 6, 6);
  for (let z = N - 8; z < N - 5; z++) for (let x = N - 8; x < N - 5; x++) st.zone[z * N + x] = Zone.Landfill;
  // landfill: partly full; two built-over cells keep a fill (the reset), a few fill up completely
  for (let i = 0; i < st.cells; i++) if (st.zone[i] === Zone.Landfill) st.landfillFill[i] = rng.chance(0.4) ? rng.range(0, 1) : rng.chance(0.1) ? 1 : 0;
  for (const b of st.buildings.values()) {
    const i = b.z * N + b.x;
    if (b.x < 16 && b.z > N - 16 && st.zone[i] !== Zone.Landfill) { st.landfillFill[i] = 0.4; break; }
  }
  // facilities on cleared lots, a road on the lot's north edge
  const fac = ['util_coal_plant', 'util_incinerator', 'util_recycling_center', 'util_water_treatment', 'rw_casino', 'civ_jail', 'park_large', 'park_small', 'park_small', 'util_water_pump'];
  let fx = 3, fz = Math.floor(N * 0.55);
  for (const id of fac) {
    const def = getDef(id);
    if (!def) continue;
    const [w, d] = def.footprint;
    if (fx + w + 2 >= N) { fx = 3; fz += 9; }
    if (fz + d + 2 >= N - 14) break;
    clearRect(st, fx - 1, fz - 1, w + 2, d + 2);
    roadLine(st, fx - 1, fz - 1, fx + w, fz - 1, Network.Road);
    place(st, id, fx, fz, { flags: BF.Powered | BF.Watered, jobs: Math.round((def.jobs ?? 0) * 0.8) });
    fx += w + 3;
  }
  // trees on empty land (not everywhere: the belts and the cover)
  for (let i = 0; i < st.cells; i++) if (st.network[i] === 0 && st.building[i] < 0 && !st.water[i] && st.zone[i] !== Zone.Landfill && rng.chance(0.35)) st.trees[i] = rng.int(1, 4);
  // building states and high-density commercial
  let k = 0;
  for (const b of st.buildings.values()) {
    if (b.def.startsWith('util_') || b.def.startsWith('park_') || b.def === 'rw_casino' || b.def === 'civ_jail') continue;
    k++;
    if (k % 37 === 0) b.flags |= BF.Abandoned;
    else if (k % 53 === 0) b.flags |= BF.Burnt;
    else if (k % 41 === 0) { b.flags |= BF.OnFire; }
    else if (k % 29 === 0) { b.built = 0.5; b.flags |= BF.Constructing; }
    if (k % 7 === 0) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) st.zone[z * N + x] = Zone.ComHigh;
  }
  for (let i = 0; i < st.cells; i++) st.garbage[i] = st.building[i] >= 0 && rng.chance(0.2) ? rng.range(0, 0.6) : 0;
  return st;
}
