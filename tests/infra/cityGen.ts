/**
 * Test helpers: test building defs registered into the (possibly empty) catalog, tiny city builders, and a synthetic
 * 256x256 stress city generator (grid of roads / avenues / highways, ~20k buildings with pop / jobs).
 */
import { DevType, Network, Zone } from '../../src/core/types';
import { CityState, type Building } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { CATALOG, getDef, rebuildCatalogIndex } from '../../src/sim/catalog';
import type { BuildingDef } from '../../src/sim/catalogTypes';
import { Simulation } from '../../src/sim/Simulation';
import { clearInfoCache } from '../../src/sim/infra/common';
import { infraSystems } from '../../src/sim/systems/infra';

export const TEST_DEFS: BuildingDef[] = [
  { id: 't_r1', name: 'R$ house', model: 'res_cottage', category: 'growable', footprint: [1, 1], devType: DevType.R1, zones: [Zone.ResLow], capacity: 12 },
  // explicit (test-scale) utility use: 3 MW / 12 kL per day at full occupancy
  { id: 't_r2', name: 'R$$ apt', model: 'res_apartment', category: 'growable', footprint: [1, 1], devType: DevType.R2, zones: [Zone.ResMed], capacity: 60, powerUse: 3, waterUse: 12 },
  { id: 't_r3', name: 'R$$$ tower', model: 'res_tower', category: 'growable', footprint: [2, 2], devType: DevType.R3, zones: [Zone.ResHigh], capacity: 400 },
  { id: 't_cs', name: 'shop', model: 'com_corner_store', category: 'growable', footprint: [1, 1], devType: DevType.CS2, zones: [Zone.ComLow], capacity: 20 },
  { id: 't_co', name: 'office', model: 'com_office_tower', category: 'growable', footprint: [2, 2], devType: DevType.CO3, zones: [Zone.ComHigh], capacity: 400 },
  { id: 't_id', name: 'factory', model: 'ind_smokestack_factory', category: 'growable', footprint: [1, 1], devType: DevType.ID, zones: [Zone.IndMed], capacity: 40 },
  { id: 't_im', name: 'plant', model: 'ind_warehouse', category: 'growable', footprint: [2, 2], devType: DevType.IM, zones: [Zone.IndMed], capacity: 150 },
  { id: 't_iht', name: 'lab', model: 'ind_lab', category: 'growable', footprint: [1, 1], devType: DevType.IHT, zones: [Zone.IndHigh], capacity: 40 },
  { id: 't_coal', name: 'Coal plant', model: 'util_coal_plant', category: 'power', footprint: [2, 2], powerOut: 1000, jobs: 50, service: 'utilities', pollution: { air: 8, radius: 10 } },
  { id: 't_small_plant', name: 'Small plant', model: 'util_gas_plant', category: 'power', footprint: [1, 1], powerOut: 10, service: 'utilities' },
  { id: 't_pump', name: 'Water pump', model: 'util_water_pump', category: 'water', footprint: [1, 1], waterOut: 100, service: 'utilities' },
  { id: 't_tower', name: 'Water tower', model: 'util_water_tower', category: 'water', footprint: [1, 1], waterOut: 100, service: 'utilities' },
  { id: 't_treat', name: 'Treatment', model: 'util_water_treatment', category: 'water', footprint: [2, 2], service: 'utilities', capacity: 100000 },
  { id: 't_police', name: 'Police', model: 'civ_police_station', category: 'police', footprint: [1, 1], jobs: 20, service: 'police', coverage: { kind: 'police', radius: 16, strength: 1 } },
  { id: 't_fire', name: 'Fire', model: 'civ_fire_station', category: 'fire', footprint: [1, 1], jobs: 15, service: 'fire', coverage: { kind: 'fire', radius: 16, strength: 1 } },
  { id: 't_school', name: 'School', model: 'civ_elementary_school', category: 'education', footprint: [1, 1], jobs: 20, service: 'education', coverage: { kind: 'education', radius: 14, strength: 1, capacity: 1000 } },
  { id: 't_clinic', name: 'Clinic', model: 'civ_clinic', category: 'health', footprint: [1, 1], jobs: 20, service: 'health', coverage: { kind: 'health', radius: 14, strength: 1, capacity: 3000 } },
  { id: 't_park', name: 'Park', model: 'park_small', category: 'park', footprint: [1, 1], coverage: { kind: 'park', radius: 4, strength: 0.8 } },
  { id: 't_incin', name: 'Incinerator', model: 'util_incinerator', category: 'garbage', footprint: [1, 1], garbageCapacity: 5000, service: 'utilities', pollution: { air: 3, radius: 6 } },
  { id: 't_bus', name: 'Bus stop', model: 'tr_bus_stop', category: 'transport', footprint: [1, 1], service: 'transit' },
  { id: 't_subway', name: 'Subway', model: 'tr_subway_station', category: 'transport', footprint: [1, 1], service: 'transit' },
  { id: 't_train', name: 'Train station', model: 'tr_train_station', category: 'transport', footprint: [2, 1], service: 'transit' },
  { id: 't_freight', name: 'Freight', model: 'tr_freight_station', category: 'transport', footprint: [2, 1], service: 'transit' },
];

export function registerTestDefs(): void {
  let added = false;
  for (const d of TEST_DEFS) {
    if (!getDef(d.id)) {
      CATALOG.push(d);
      added = true;
    }
  }
  if (added) rebuildCatalogIndex();
  clearInfoCache();
}

export function newState(size = 64, disasters = false): CityState {
  registerTestDefs();
  const st = new CityState(defaultCityConfig({ size, seed: 1234, terrain: 'flat', disasters, treeDensity: 0, waterAmount: 0 }));
  for (let i = 0; i < st.heights.length; i++) st.heights[i] = 5;
  return st;
}

export function newSim(st: CityState): Simulation {
  registerTestDefs();
  return new Simulation(st, infraSystems());
}

export function setRoad(st: CityState, x: number, z: number, type: Network = Network.Road, oneWayDir = -1): void {
  const i = st.idx(x, z);
  st.network[i] = type;
  st.netFlags[i] = oneWayDir >= 0 ? (st.netFlags[i] & ~0x0c) | ((oneWayDir & 3) << 2) : st.netFlags[i] & ~0x0c;
}

export function roadLine(st: CityState, x0: number, z0: number, x1: number, z1: number, type: Network = Network.Road, oneWayDir = -1): void {
  const dx = Math.sign(x1 - x0), dz = Math.sign(z1 - z0);
  let x = x0, z = z0;
  for (;;) {
    setRoad(st, x, z, type, oneWayDir);
    if (x === x1 && z === z1) break;
    if (x !== x1) x += dx;
    else z += dz;
  }
}

export function place(st: CityState, defId: string, x: number, z: number, opts: Partial<Building> = {}): Building {
  const def = getDef(defId) ?? TEST_DEFS.find((d) => d.id === defId)!;
  const [w, d] = def.footprint;
  const id = st.nextBuildingId++;
  const b: Building = {
    id, def: defId, x, z, w, d, rot: 0, variant: 0, pop: 0, jobs: 0, capacity: def.capacity ?? def.jobs ?? 0,
    wealth: 1, built: 1, age: 100, flags: 0, baseY: 5, health: 1, unhappy: 0, ...opts,
  };
  st.buildings.set(id, b);
  for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) st.building[st.idx(xx, zz)] = id;
  return b;
}

export interface StressCity {
  st: CityState;
  roadCells: number;
  buildings: number;
  pop: number;
  jobs: number;
}

/**
 * Synthetic stress city on a size^2 map: road lines every 3 cells (2x2 blocks), avenues every 24 cells, two highways
 * crossing the map; avenues and highways reach the map edges (neighbour connections). Blocks are filled with
 * 1x1 / 2x2 residential, commercial (CBD in the centre) and industrial (east side) buildings.
 */
export function stressCity(size = 256, seed = 7, withTransit = true): StressCity {
  registerTestDefs();
  const st = newState(size);
  let rs = seed >>> 0 || 1;
  const rnd = () => {
    rs = (rs + 0x6d2b79f5) >>> 0;
    let t = rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const N = size;
  let roadCells = 0;
  const isLine = (v: number) => v % 3 === 1;
  const hw = Math.floor(N / 2 / 3) * 3 + 1;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const lx = isLine(x), lz = isLine(z);
    if (!lx && !lz) continue;
    const edge = x === 0 || z === 0 || x === N - 1 || z === N - 1;
    const aveX = lx && (x - 1) % 24 === 0, aveZ = lz && (z - 1) % 24 === 0;
    const hwy = (lx && x === hw) || (lz && z === hw);
    if (edge && !aveX && !aveZ && !hwy) continue;
    let t = Network.Street;
    if ((lx && (x - 1) % 6 === 0) || (lz && (z - 1) % 6 === 0)) t = Network.Road;
    if (aveX || aveZ) t = Network.Avenue;
    if (hwy) t = Network.Highway;
    st.network[z * N + x] = t;
    roadCells++;
  }
  let pop = 0, jobs = 0, count = 0;
  const cx = N / 2, cz = N / 2;
  for (let bz = 0; bz < N; bz += 3) for (let bx = 0; bx < N; bx += 3) {
    const x0 = bx + 2, z0 = bz + 2; // block cells x0..x0+1
    if (x0 + 1 >= N || z0 + 1 >= N) continue;
    const dist = Math.hypot(x0 - cx, z0 - cz) / (N / 2);
    const east = x0 > N * 0.78;
    const r = rnd();
    if (r < 0.12) continue; // empty lot
    let kind: 'R' | 'C' | 'I';
    if (east) kind = rnd() < 0.8 ? 'I' : 'R';
    else if (dist < 0.22) kind = rnd() < 0.7 ? 'C' : 'R';
    else kind = rnd() < 0.12 ? 'C' : 'R';
    const big = rnd() < (kind === 'C' && dist < 0.22 ? 0.5 : 0.18);
    if (big) {
      const id = kind === 'R' ? 't_r3' : kind === 'C' ? 't_co' : 't_im';
      const def = getDef(id)!;
      const cap = def.capacity!;
      const b = place(st, id, x0, z0, kind === 'R' ? { pop: Math.round(cap * (0.6 + rnd() * 0.4)), wealth: 3 } : { jobs: Math.round(cap * 0.8), wealth: 2 });
      zoneFor(st, b, kind);
      pop += b.pop; jobs += b.capacity * (kind === 'R' ? 0 : 1); count++;
    } else {
      for (let q = 0; q < 4; q++) {
        if (rnd() < 0.1) continue;
        const x = x0 + (q & 1), z = z0 + (q >> 1);
        let id: string;
        if (kind === 'R') id = rnd() < 0.6 ? 't_r2' : 't_r1';
        else if (kind === 'C') id = 't_cs';
        else id = rnd() < 0.7 ? 't_id' : 't_iht';
        const def = getDef(id)!;
        const cap = def.capacity!;
        const b = place(st, id, x, z, kind === 'R' ? { pop: Math.round(cap * (0.5 + rnd() * 0.5)), wealth: id === 't_r1' ? 1 : 2 } : { jobs: Math.round(cap * 0.8) });
        zoneFor(st, b, kind);
        pop += b.pop; jobs += kind === 'R' ? 0 : b.capacity; count++;
      }
    }
  }
  // transit: bus stops (road netFlags bit 4) every 12 cells along roads, a subway line with stations
  if (withTransit) {
    for (let z = 1; z < N; z += 12) for (let x = 1; x < N; x += 12) {
      const i = z * N + x + 1;
      if (st.network[i] >= Network.Street && st.network[i] <= Network.Avenue) st.netFlags[i] |= 1 << 4;
    }
    const sz = 1 + 24 * 4; // under an avenue row
    for (let x = 10; x < N - 10; x++) st.subway[sz * N + x] = 1;
    for (let x = 12; x < N - 12; x += 16) {
      // station on a block cell next to the line (replace a building if any)
      const bz = sz + 1, bx = x - (x % 3) + 2;
      const old = st.building[bz * N + bx];
      if (old >= 0) {
        const ob = st.buildings.get(old)!;
        for (let zz = ob.z; zz < ob.z + ob.d; zz++) for (let xx = ob.x; xx < ob.x + ob.w; xx++) st.building[zz * N + xx] = -1;
        st.buildings.delete(old);
        pop -= ob.pop;
        count--;
      }
      st.subway[bz * N + bx] = 1;
      place(st, 't_subway', bx, bz);
      count++;
    }
  }
  st.stats.population = pop;
  return { st, roadCells, buildings: count, pop, jobs };
}

function zoneFor(st: CityState, b: Building, kind: 'R' | 'C' | 'I'): void {
  const z = kind === 'R' ? Zone.ResMed : kind === 'C' ? Zone.ComHigh : Zone.IndMed;
  for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) st.zone[st.idx(xx, zz)] = z;
}
