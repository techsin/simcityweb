/**
 * Demo content for testing the region view before the city game exists (?region=1&demo=1): founds a few cities
 * with a plausible road grid, zones and buildings, saves them and fills in the tile summaries.
 */
import { RNG } from '../core/rng';
import { Network, Zone, DevType } from '../core/types';
import { BF, type CityState } from '../sim/CityState';
import { createCityState } from '../sim/terrainGen';
import { randomCityName, randomMayorName } from './names';
import type { RegionModel } from './RegionModel';
import type { RegionTile } from './types';
import { summarizeCity } from './citySummary';
import { cityThumbnail } from './mapPreview';
import { saveCity } from '../save';
import { terrainOptionsFor } from './NewCityDialog';

function buildFakeCity(st: CityState, rng: RNG, intensity: number): void {
  const N = st.size;
  const cx = N / 2 + rng.range(-N * 0.12, N * 0.12), cz = N / 2 + rng.range(-N * 0.12, N * 0.12);
  const R = N * (0.22 + 0.25 * intensity);
  const ok = (x: number, z: number) => st.inBounds(x, z) && !st.water[st.idx(x, z)] && st.cellSlope(x, z) < 4;
  // road grid
  const step = 7;
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d > R || !ok(x, z)) continue;
      if (Math.round(x - cx) % step === 0 || Math.round(z - cz) % step === 0) st.network[st.idx(x, z)] = d < R * 0.35 ? Network.Avenue : Network.Road;
    }
  // zones + buildings on 2x2 lots next to roads
  let id = st.nextBuildingId;
  let pop = 0, jobsC = 0, jobsI = 0;
  for (let z = 1; z < N - 2; z += 2)
    for (let x = 1; x < N - 2; x += 2) {
      const d = Math.hypot(x - cx, z - cz);
      if (d > R) continue;
      let free = true;
      for (let k = 0; k < 4; k++) {
        const xx = x + (k & 1), zz = z + (k >> 1);
        if (!ok(xx, zz) || st.network[st.idx(xx, zz)] || st.building[st.idx(xx, zz)] >= 0) free = false;
      }
      if (!free || rng.chance(0.15)) continue;
      const core = 1 - d / R;
      const kind = core > 0.72 ? 'C' : d > R * 0.8 && rng.chance(0.4) ? 'I' : rng.chance(0.18) ? 'C' : 'R';
      const dens = core > 0.75 ? 3 : core > 0.45 ? 2 : 1;
      const zone = kind === 'R' ? [Zone.ResLow, Zone.ResMed, Zone.ResHigh][dens - 1] : kind === 'C' ? [Zone.ComLow, Zone.ComMed, Zone.ComHigh][dens - 1] : Zone.IndMed;
      const capacity = Math.round((dens === 3 ? rng.range(500, 1600) * core * intensity : dens === 2 ? rng.range(80, 240) : rng.range(6, 18)) + 4);
      for (let k = 0; k < 4; k++) {
        const i = st.idx(x + (k & 1), z + (k >> 1));
        st.zone[i] = zone;
        st.building[i] = id;
      }
      st.buildings.set(id, {
        id, def: `demo_${kind}${dens}`, x, z, w: 2, d: 2, rot: 0, variant: 0, pop: kind === 'R' ? capacity : 0, jobs: kind !== 'R' ? capacity : 0, capacity,
        wealth: dens, built: 1, age: 100, flags: BF.Powered | BF.Watered, baseY: st.cellHeight(x, z), health: 1, unhappy: 0,
      });
      if (kind === 'R') pop += capacity;
      else if (kind === 'C') jobsC += capacity;
      else jobsI += capacity;
      id++;
    }
  st.nextBuildingId = id;
  st.stats.population = pop;
  st.stats.residents = [Math.round(pop * 0.5), Math.round(pop * 0.35), Math.round(pop * 0.15)];
  st.stats.jobsByDev[DevType.CS1] = jobsC;
  st.stats.jobsByDev[DevType.IM] = jobsI;
  st.day = Math.round(360 * (2 + intensity * 20));
}

export async function populateDemoCities(model: RegionModel, count = 6): Promise<void> {
  const rng = new RNG(model.data.seed + 31337);
  const tiles = model.data.tiles
    .filter((t) => model.tileWaterFraction(t) < 0.35)
    .sort((a, b) => b.size - a.size || rng.next() - 0.5)
    .slice(0, count * 3);
  const chosen: RegionTile[] = [];
  for (const t of tiles) {
    if (chosen.length >= count) break;
    if (t.size === 4 && chosen.some((c) => c.size === 4) && chosen.length < 2) continue;
    chosen.push(t);
  }
  for (const [k, t] of chosen.entries()) {
    const cfg = model.cityConfigFor(t, { name: randomCityName(rng), mayor: randomMayorName(rng) });
    const st = createCityState(cfg, terrainOptionsFor(cfg, model, t));
    buildFakeCity(st, rng, k === 0 ? 1 : rng.range(0.2, 0.8));
    t.city = summarizeCity(st);
    t.city.thumbnail = cityThumbnail(st, Math.min(512, t.size * 128));
    await saveCity(model.data.id, t.key, st);
  }
  model.recomputeTotals();
}
