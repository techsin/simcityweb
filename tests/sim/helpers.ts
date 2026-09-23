/** Shared helpers for sim-core tests: small flat deterministic cities (economy systems only, no infra). */
import { createCityState } from '../../src/sim/terrainGen';
import { computeWater } from '../../src/sim/terrainGen';
import { defaultCityConfig, type CityConfigData } from '../../src/sim/config';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { economySystems } from '../../src/sim/systems/economy';
import { CityActions, lPath } from '../../src/sim/actions';
import { Network } from '../../src/core/types';
import type { CityState } from '../../src/sim/CityState';

export function makeCity(cfg: Partial<CityConfigData> = {}, systems: SimSystem[] = economySystems()) {
  const st = createCityState(defaultCityConfig({ size: 64, seed: 1234, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false, ...cfg }));
  // perfectly flat, dry land
  st.heights.fill(5);
  computeWater(st);
  st.trees.fill(0);
  const sim = new Simulation(st, systems);
  const A = new CityActions(sim);
  return { st, sim, A };
}

/** carve a water strip (rows z0..z1-1, all x) */
export function addWaterRows(st: CityState, z0: number, z1: number): void {
  const N1 = st.size + 1;
  for (let z = z0; z <= z1; z++) for (let x = 0; x <= st.size; x++) st.heights[z * N1 + x] = -4;
  computeWater(st);
}

export function road(A: CityActions, x0: number, z0: number, x1: number, z1: number, type = Network.Road) {
  return A.buildNetwork(lPath({ x: x0, z: z0 }, { x: x1, z: z1 }), type);
}
