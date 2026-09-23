/**
 * Synthetic city for the render-city demo: terrain with a river, a road grid mixing every network type,
 * a highway with ramps, rail with level crossings and a bridge, power lines, a subway line, and a few hundred
 * buildings (manifest model ids used directly as Building.def) in various states, plus fake traffic volumes.
 */
import { Network, Zone } from '../../core/types';
import { RNG } from '../../core/rng';
import { CELL_SIZE } from '../../core/constants';
import { defaultCityConfig } from '../../sim/config';
import { createCityState, computeWater } from '../../sim/terrainGen';
import { BF, type Building, type CityState } from '../../sim/CityState';
import { MANIFEST_BY_ID } from '../../assets/manifest';

export interface DemoOptions {
  size: number;
  seed: number;
  buildings: boolean;
  /** 0..1 density of lot filling */
  fill: number;
}

const R_LOW = ['res_cottage', 'res_suburban', 'res_ranch', 'res_townhouse_row', 'res_villa', 'res_shack', 'res_mansion'];
const R_MED = ['res_walkup', 'res_rowhouses', 'res_apartment', 'res_condo', 'res_tenement', 'res_courtyard'];
const R_HIGH = ['res_projects', 'res_tower', 'res_highrise_slab', 'res_twin_towers', 'res_luxury_tower', 'res_supertall'];
const C_LOW = ['com_corner_store', 'com_diner', 'com_restaurant', 'com_boutique', 'com_gas_station', 'com_strip_mall'];
const C_MED = ['com_shops_apartments', 'com_office_small', 'com_hotel', 'com_department_store', 'com_office_block', 'com_supermarket', 'com_motel'];
const C_HIGH = ['com_office_tower', 'com_skyscraper', 'com_hotel_tower', 'com_megatower', 'com_office_tower', 'com_skyscraper'];
const IND = ['ind_warehouse', 'ind_smokestack_factory', 'ind_workshop', 'ind_depot', 'ind_assembly_plant', 'ind_refinery', 'ind_scrapyard', 'ind_lab', 'ind_tech_campus', 'ind_datacenter'];
const AGR = ['ind_farm_field', 'ind_farm_barn', 'ind_greenhouse'];

export function buildDemoCity(opt: DemoOptions): CityState {
  const N = opt.size;
  const cfg = defaultCityConfig({ size: N, seed: opt.seed, terrain: 'plains', hilliness: 0.35, waterAmount: 0.0, treeDensity: 0.3 });
  const st = createCityState(cfg);
  const rng = new RNG(opt.seed * 7 + 3);
  const S = N / 128; // scale layout with map size
  const sx = (v: number) => Math.round(v * S);

  // ---------------------------------------------------------------- terrain: raise a bit, carve a river
  const N1 = N + 1;
  const riverX = sx(74);
  const riverW = 3.2 * S + 2.5;
  for (let z = 0; z <= N; z++) {
    for (let x = 0; x <= N; x++) {
      const i = z * N1 + x;
      let h = st.heights[i] + 3;
      const cxr = riverX + Math.sin(z / (14 * S)) * 3 * S;
      const d = Math.abs(x - cxr);
      if (d < riverW + 3) {
        const t = Math.min(1, Math.max(0, (d - riverW) / 3));
        const bed = -4.5;
        const bank = 1.0 + t * t * (h - 1.0);
        h = d < riverW ? bed + (d / riverW) ** 4 * 3.5 : bank;
      }
      st.heights[i] = h;
    }
  }
  computeWater(st);

  const net = st.network;
  const flags = st.netFlags;
  const set = (x: number, z: number, t: Network, dir = -1) => {
    if (x < 0 || z < 0 || x >= N || z >= N) return;
    const i = z * N + x;
    net[i] = t;
    flags[i] = st.water[i] ? 1 : 0;
    if (dir >= 0) flags[i] |= dir << 2;
  };
  const hline = (z: number, x0: number, x1: number, t: Network, dir = -1) => { for (let x = x0; x <= x1; x++) set(x, z, t, dir); };
  const vline = (x: number, z0: number, z1: number, t: Network, dir = -1) => { for (let z = z0; z <= z1; z++) set(x, z, t, dir); };

  // ---------------------------------------------------------------- road network
  const hwX = sx(6);
  // local street grid (west residential)
  for (let z = sx(12); z <= sx(88); z += 4) hline(z, hwX + 2, sx(30), Network.Street);
  for (let x = hwX + 6; x <= sx(30); x += 6) vline(x, sx(12), sx(88), Network.Street);
  // roads grid
  for (const z of [sx(10), sx(20), sx(44), sx(52), sx(64), sx(72), sx(80), sx(90), sx(112), sx(120)]) hline(z, sx(30), riverX - 6, Network.Road);
  for (const x of [sx(30), sx(48), sx(56), sx(64)]) vline(x, sx(10), sx(122), Network.Road);
  // downtown one-way pair
  hline(sx(40), sx(30), sx(64), Network.OneWay, 0);
  hline(sx(60), sx(30), sx(64), Network.OneWay, 2);
  // avenues
  hline(sx(32), hwX + 1, N - 1, Network.Avenue);
  vline(sx(40), 0, N - 1, Network.Avenue);
  hline(sx(96), hwX + 1, N - 1, Network.Avenue);
  // east side roads
  for (const x of [sx(86), sx(94), sx(102), sx(110), sx(118)]) vline(x, sx(8), sx(94), Network.Road);
  for (const z of [sx(8), sx(18), sx(46), sx(58), sx(70), sx(82)]) hline(z, riverX + 6, N - 3, Network.Road);
  hline(sx(24), riverX + 6, N - 3, Network.Street);
  // a bridge road over the river + cul-de-sacs
  hline(sx(64), riverX - 6, riverX + 6, Network.Road);
  vline(sx(26), sx(90), sx(93), Network.Street);
  vline(sx(20), sx(90), sx(92), Network.Street);
  hline(sx(90), sx(14), sx(30), Network.Street);
  // highway along the west edge
  vline(hwX, 0, N - 1, Network.Highway);
  hline(sx(32), hwX + 1, hwX + 1, Network.Avenue);
  hline(sx(96), hwX + 1, hwX + 1, Network.Avenue);
  // rail line (with level crossings over roads) along z = 104 ... curve north on the east side
  const railZ = sx(104);
  for (let x = hwX + 2; x <= sx(116); x++) {
    const i = railZ * N + x;
    if (net[i] && net[i] !== Network.Rail) { flags[i] |= 0x20; continue; } // road cell stays: level crossing (sim flag)
    set(x, railZ, Network.Rail);
  }
  for (let z = railZ - 1; z >= sx(60); z--) {
    const i = z * N + sx(116);
    if (net[i]) { flags[i] |= 0x20; continue; }
    set(sx(116), z, Network.Rail);
  }
  // rail cells adjacent to roads crossing: if a road runs across the rail row, the road cell becomes the crossing
  // ---------------------------------------------------------------- power lines
  for (let x = sx(20); x <= sx(122); x++) if (!st.water[sx(4) * N + x]) st.powerLines[sx(4) * N + x] = 1;
  for (let z = sx(4); z <= sx(60); z++) st.powerLines[z * N + sx(122)] = 1;
  for (let x = riverX - 8; x <= riverX + 8; x++) st.powerLines[sx(4) * N + x] = 1;
  // ---------------------------------------------------------------- subway
  for (let z = sx(20); z <= sx(90); z++) st.subway[z * N + sx(44)] = 1;
  for (let x = sx(44); x <= sx(100); x++) st.subway[sx(50) * N + x] = 1;

  // ---------------------------------------------------------------- traffic
  for (let i = 0; i < N * N; i++) {
    const t = net[i];
    if (!t || t === Network.Rail) continue;
    const base = t === Network.Highway ? 9000 : t === Network.Avenue ? 3500 : t === Network.Road || t === Network.OneWay ? 1300 : 250;
    st.traffic[i] = base * (0.5 + rng.next());
    st.congestion[i] = t === Network.Avenue ? 0.5 + rng.next() * 0.8 : t === Network.Street ? 0.1 * rng.next() : 0.2 + rng.next() * 0.7;
  }

  // ---------------------------------------------------------------- zones / buildings
  if (opt.buildings) placeBuildings(st, rng, opt, riverX);
  for (let i = 0; i < N * N; i++) if (net[i] || st.building[i] >= 0 || st.water[i]) st.trees[i] = 0;
  return st;
}

function zoneFor(st: CityState, x: number, z: number, riverX: number): { list: string[]; zone: Zone } {
  const N = st.size;
  const S = N / 128;
  const dx = x - 46 * S, dz = z - 50 * S;
  const dc = Math.sqrt(dx * dx + dz * dz) / S;
  if (x > riverX + 4 && z > 84 * S) return { list: IND, zone: Zone.IndMed };
  if (x > riverX + 4 && z < 30 * S) return { list: AGR, zone: Zone.IndAg };
  if (x < 31 * S) return { list: R_LOW, zone: Zone.ResLow };
  const h = ((x * 73856093) ^ (z * 19349663)) >>> 0;
  if (dc < 5) return { list: h % 3 ? C_HIGH : C_MED, zone: Zone.ComHigh };
  if (dc < 11) return { list: h % 4 === 0 ? C_HIGH : h % 4 === 1 ? R_HIGH : C_MED, zone: Zone.ComMed };
  if (dc < 24) return { list: h % 3 === 0 ? C_MED : R_MED, zone: Zone.ResMed };
  if (x > riverX) return { list: (x + z) % 4 === 0 ? C_LOW : R_LOW, zone: Zone.ResLow };
  return { list: (x + 2 * z) % 5 === 0 ? C_LOW : R_MED, zone: Zone.ResMed };
}

function placeBuildings(st: CityState, rng: RNG, opt: DemoOptions, riverX: number): void {
  const N = st.size;
  const net = st.network;
  const free = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N && !net[z * N + x] && st.building[z * N + x] < 0 && !st.water[z * N + x];
  const cells: number[] = [];
  for (let i = 0; i < N * N; i++) cells.push(i);
  rng.shuffle(cells);
  // a few plopped civic / utility buildings first
  const plops: [string, number, number, 0 | 1 | 2 | 3][] = [
    ['util_coal_plant', Math.round(112 * N / 128), Math.round(10 * N / 128), 0],
    ['civ_city_hall', Math.round(42 * N / 128), Math.round(34 * N / 128), 0],
    ['park_large', Math.round(50 * N / 128), Math.round(65 * N / 128), 0],
    ['civ_hospital', Math.round(57 * N / 128), Math.round(73 * N / 128), 0],
    ['civ_fire_station', Math.round(33 * N / 128), Math.round(65 * N / 128), 0],
    ['tr_train_station', Math.round(50 * N / 128), Math.round(105 * N / 128), 2],
  ];
  for (const [id, x, z, rot] of plops) tryPlace(st, rng, id, x, z, rot, 0, true);
  const dirs: [number, number, 0 | 1 | 2 | 3][] = [[0, 1, 0], [1, 0, 1], [0, -1, 2], [-1, 0, 3]];
  let count = 0;
  for (const i of cells) {
    const x = i % N, z = (i / N) | 0;
    if (!free(x, z)) continue;
    if (rng.next() > opt.fill) continue;
    // adjacent road?
    let rot: 0 | 1 | 2 | 3 = 0, found = false;
    for (const [ddx, ddz, r] of dirs) {
      const nx = x + ddx, nz = z + ddz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const t = net[nz * N + nx];
      if (t >= Network.Street && t <= Network.OneWay) { rot = r; found = true; break; }
    }
    if (!found) continue;
    const { list, zone } = zoneFor(st, x, z, riverX);
    const id = rng.pick(list);
    if (tryPlace(st, rng, id, x, z, rot, zone, false)) count++;
  }
  void count;
}

let nextId = 1;
function tryPlace(st: CityState, rng: RNG, id: string, fx: number, fz: number, rot: 0 | 1 | 2 | 3, zone: Zone, plop: boolean): boolean {
  const e = MANIFEST_BY_ID[id];
  if (!e) return false;
  const N = st.size;
  const [fw, fd] = e.footprint;
  const w = rot & 1 ? fd : fw, d = rot & 1 ? fw : fd;
  // front cell (fx,fz) is adjacent to the road; lot extends away from the road
  let x0 = fx, z0 = fz;
  if (rot === 0) { z0 = fz - d + 1; x0 = fx - Math.floor((w - 1) / 2); }
  else if (rot === 2) { z0 = fz; x0 = fx - Math.floor((w - 1) / 2); }
  else if (rot === 1) { x0 = fx - w + 1; z0 = fz - Math.floor((d - 1) / 2); }
  else { x0 = fx; z0 = fz - Math.floor((d - 1) / 2); }
  if (plop) { x0 = fx; z0 = fz; }
  for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) {
    if (x < 0 || z < 0 || x >= N || z >= N) return false;
    const i = z * N + x;
    if (st.network[i] || st.building[i] >= 0 || st.water[i]) return false;
  }
  // level the lot
  const N1 = N + 1;
  let sum = 0, cnt = 0;
  for (let z = z0; z <= z0 + d; z++) for (let x = x0; x <= x0 + w; x++) { sum += st.heights[z * N1 + x]; cnt++; }
  const baseY = sum / cnt;
  const keepSlope = rng.chance(0.15);
  if (!keepSlope) for (let z = z0 + 1; z < z0 + d; z++) for (let x = x0 + 1; x < x0 + w; x++) st.heights[z * N1 + x] = baseY;
  const b: Building = {
    id: nextId++, def: id, x: x0, z: z0, w, d, rot, variant: rng.int(0, 7), pop: 0, jobs: 0, capacity: 10, wealth: 1,
    built: 1, age: 100, flags: BF.Powered | BF.Watered, baseY, health: 1, unhappy: 0,
  };
  if (plop) b.flags |= BF.Plopped;
  const r = rng.next();
  if (!plop) {
    if (r < 0.05) { b.flags |= BF.Constructing; b.built = rng.range(0.15, 0.9); }
    else if (r < 0.08) b.flags |= BF.Abandoned;
    else if (r < 0.09) b.flags |= BF.OnFire;
    else if (r < 0.1) b.flags |= BF.Burnt;
  }
  st.buildings.set(b.id, b);
  for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) {
    st.building[z * N + x] = b.id;
    st.zone[z * N + x] = zone;
  }
  st.nextBuildingId = nextId;
  return true;
}

export { CELL_SIZE };
