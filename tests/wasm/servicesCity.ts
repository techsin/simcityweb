/**
 * Test city for the services tier engine: the synthetic stress city (tests/infra/cityGen.ts) with real catalog service
 * buildings of every tier (police / fire / schools / library / college / clinic / hospital / play / green incl. euclid
 * parks / transit stops) dropped into random blocks, a river (water with bridged roads = near-field barriers), a rail
 * line (a barrier for walk and drive) and the highways of the stress city (drive ramps). Deterministic per seed.
 */
import { Network } from '../../src/core/types';
import type { CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { place, stressCity } from '../infra/cityGen';

export const SERVICE_DEFS = [
  'civ_police_kiosk', 'civ_police_station', 'civ_police_hq', 'civ_fire_station', 'civ_fire_hq', 'civ_clinic', 'civ_hospital', 'civ_medical_center',
  'civ_elementary_school', 'civ_high_school', 'civ_college', 'civ_library', 'civ_museum', 'civ_cemetery', 'park_small', 'park_playground',
  'park_basketball', 'park_tennis', 'park_plaza', 'park_garden', 'park_soccer', 'park_baseball', 'park_marina', 'park_large', 'park_zoo', 'park_golf',
  'park_stadium', 'tr_bus_stop', 'tr_subway_station', 'tr_train_station',
] as const;

function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** remove every building overlapping the rectangle (empty grid cells hold -1) */
function clearRect(st: CityState, x0: number, z0: number, w: number, d: number): void {
  const N = st.size;
  for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) {
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    const id = st.building[z * N + x];
    if (id < 0) continue;
    const b = st.buildings.get(id);
    if (!b) { st.building[z * N + x] = -1; continue; }
    for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) if (xx >= 0 && zz >= 0 && xx < N && zz < N) st.building[zz * N + xx] = -1;
    st.buildings.delete(id);
  }
}

export interface ServicesCity {
  st: CityState;
  facilities: number;
}

/** stress city of `size` with `perDef` buildings of every service def (fewer when blocks run out) */
export function servicesCity(size = 128, seed = 11, perDef = 3): ServicesCity {
  const c = stressCity(size, seed, { withTransit: true });
  const st = c.st;
  const N = st.size;
  const r = rng(seed * 7919 + 3);
  // a river (2 columns of water; roads crossing it are bridges) and a rail line (barrier), buildings removed
  const rx = Math.floor(N * 0.37), railZ = Math.floor(N * 0.61);
  for (let z = 0; z < N; z++) for (let x = rx; x < rx + 2; x++) {
    const i = z * N + x;
    clearRect(st, x, z, 1, 1);
    st.water[i] = 1;
  }
  for (let x = 0; x < N; x++) {
    const i = railZ * N + x;
    if (st.network[i] !== Network.None) continue;
    clearRect(st, x, railZ, 1, 1);
    st.network[i] = Network.Rail;
  }
  let facilities = 0;
  for (const id of SERVICE_DEFS) {
    const def = getDef(id);
    if (!def) continue;
    const [w, d] = def.footprint;
    for (let n = 0; n < perDef; n++) {
      for (let tries = 0; tries < 200; tries++) {
        const x = Math.floor(r() * (N - w)), z = Math.floor(r() * (N - d));
        // streets / roads under the footprint are removed (avenues, highways, rail and water are kept)
        let ok = true;
        for (let zz = z; zz < z + d && ok; zz++) for (let xx = x; xx < x + w && ok; xx++) {
          const i = zz * N + xx;
          const t = st.network[i];
          if ((t !== Network.None && t !== Network.Street && t !== Network.Road) || st.water[i] !== 0) ok = false;
        }
        if (!ok) continue;
        clearRect(st, x, z, w, d);
        for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) { st.network[zz * N + xx] = Network.None; st.netFlags[zz * N + xx] = 0; }
        place(st, id, x, z);
        facilities++;
        break;
      }
    }
  }
  return { st, facilities };
}
