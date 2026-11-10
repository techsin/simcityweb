/**
 * B2 G4 (docs/dev/B2_DESIGN.md §11.1, review 1 R6): synthetic cities that run every branch of the utilities and emergency
 * response passes.
 *  utilCity   the env city (tests/infra/envCity.ts: a river, a lake, a coal plant, an incinerator, a treatment plant, a
 *             pump) + a sea along the east edge, every producer kind (nuclear, gas, wind, solar, a small plant, pumps by
 *             fresh water / by the sea / inland, a tower, desalination by the sea and inland), power lines, an island grid
 *             (its own small plant, short), critical loads (clinic, police, fire) far from the plants, sparse building ids;
 *             `short`: the big plants and the treatment plant gone, so the main power grid and water network are short
 *             (both brownout searches run); `ok`: no island grid (no grid short: the results without a brownout)
 *  emergCity  the stress city with fire, police and medical stations (clinics, a hospital), some unfunded or unpowered
 */
import { Network, Zone } from '../../src/core/types';
import { RNG } from '../../src/core/rng';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { place, roadLine, stressCity } from './cityGen';
import { clearRect, envCity } from './envCity';

/** the utilities test city (see the file comment) */
export function utilCity(size = 96, seed = 7, mode: 'ok' | 'island' | 'short' = 'island'): CityState {
  const short = mode === 'short';
  const st = envCity(size, seed);
  const N = st.size, rng = new RNG(seed * 104729 + 11);
  // sparse ids: the next buildings start far above the existing ones
  st.nextBuildingId += 500 + (seed % 7) * 37;
  // a sea along the east edge (8 cells wide: a sea by terrainMasks' rule)
  clearRect(st, N - 9, 0, 9, N);
  for (let z = 0; z < N; z++) for (let x = N - 8; x < N; x++) st.water[z * N + x] = 1;
  // producers on cleared lots with a road on their north edge: by the sea, inland
  const lot = (id: string, x: number, z: number, opts: Partial<Building> = {}) => {
    const def = getDef(id);
    if (!def) return null;
    const [w, d] = def.footprint;
    if (x < 1 || z < 1 || x + w + 1 >= N || z + d + 1 >= N) return null;
    clearRect(st, x - 1, z - 1, w + 2, d + 2);
    for (let zz = z - 1; zz < z + d + 1; zz++) for (let xx = x - 1; xx < x + w + 1; xx++) st.water[zz * N + xx] = 0;
    roadLine(st, x - 1, z - 1, x + w, z - 1, Network.Road);
    return place(st, id, x, z, { flags: BF.Plopped | BF.Powered | BF.Watered, jobs: Math.round((def.jobs ?? 0) * 0.7), ...opts });
  };
  const seaX = N - 9 - 4;
  lot('util_desalination', seaX - 1, 4);
  lot('util_water_pump', seaX + 1, 12);
  lot('util_water_tower', 20, 4);
  lot('util_desalination', 26, 8); // inland: x 0.2
  lot('util_wind_turbine', 8, 4);
  lot('util_wind_turbine', 12, 4, { flags: BF.Plopped | BF.Burnt });
  lot('util_solar_farm', 40, 4);
  lot('util_gas_plant', 50, 30);
  lot('t_small_plant', 30, 30);
  if (!short) lot('util_nuclear_plant', 4, 30);
  // power lines along a row (they conduct between grids)
  for (let x = 5; x < N - 12; x++) { const i = 2 * N + x; if (st.network[i] === 0 && st.building[i] < 0 && !st.water[i]) st.powerLines[i] = 1; }
  // an island grid in the south-west: its own road loop, a small plant, homes (short)
  const ix = 14, iz = N - 30;
  if (mode !== 'ok') islandGrid(st, ix, iz, rng);
  // critical loads far from the plants
  for (const [id, x, z] of [['t_clinic', N - 14, N - 20], ['t_police', N - 16, N - 26], ['t_fire', N / 2, N - 18]] as const) lot(id, x | 0, z | 0);
  if (short) {
    // the big producers gone: the main grid and the water network run short (both brownout searches)
    for (const b of [...st.buildings.values()]) {
      if (b.def !== 'util_coal_plant' && b.def !== 'util_water_treatment' && b.def !== 'util_desalination') continue;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) st.building[z * N + x] = -1;
      st.buildings.delete(b.id);
    }
  }
  return st;
}

/** an island grid: its own two roads, a small plant, a water tower, homes (more demand than its plant supplies) */
function islandGrid(st: CityState, ix: number, iz: number, rng: RNG): void {
  const N = st.size;
  clearRect(st, ix - 2, iz - 2, 14, 12);
  for (let zz = iz - 2; zz < iz + 10; zz++) for (let xx = ix - 2; xx < ix + 12; xx++) { st.powerLines[zz * N + xx] = 0; st.water[zz * N + xx] = 0; }
  roadLine(st, ix, iz, ix + 9, iz, Network.Road);
  roadLine(st, ix, iz + 6, ix + 9, iz + 6, Network.Road);
  place(st, 't_small_plant', ix, iz + 1, { flags: BF.Plopped });
  place(st, 't_tower', ix + 1, iz + 1, { flags: BF.Plopped });
  for (let x = ix + 2; x < ix + 9; x++) { place(st, 't_r2', x, iz + 1, { pop: 50 + rng.int(0, 10), capacity: 60 }); place(st, 't_r2', x, iz + 5, { pop: 40, capacity: 60 }); }
  for (let x = ix; x < ix + 10; x++) st.zone[(iz + 2) * N + x] = Zone.ResMed;
}

/** the emergency test city: the stress city with every station kind */
export function emergCity(size = 96, seed = 7): CityState {
  const { st } = stressCity(size, seed);
  const N = st.size;
  const ids = ['civ_fire_station', 'civ_police_station', 'civ_clinic', 'civ_fire_station', 'civ_hospital', 'civ_police_kiosk', 'civ_fire_hq', 'civ_police_station'];
  let k = 0;
  for (let z = 8; z < N - 10 && k < ids.length; z += Math.max(14, N >> 2)) for (let x = 8; x < N - 10 && k < ids.length; x += Math.max(14, N >> 2)) {
    const id = ids[k++], def = getDef(id);
    if (!def) continue;
    const [w, d] = def.footprint;
    clearRect(st, x - 1, z - 1, w + 2, d + 2);
    roadLine(st, x - 1, z - 1, x + w, z - 1, Network.Road);
    // (one station unpowered: its turnout is later)
    place(st, id, x, z, { flags: BF.Plopped | (k === 4 ? BF.Watered : BF.Powered | BF.Watered), jobs: Math.round((def.jobs ?? 0) * 0.8) });
  }
  return st;
}
