/**
 * Shared building / lot helpers used by CityActions (player) and the growth system.
 * Every building add/remove in sim-core goes through placeBuilding / removeBuilding so the grid,
 * the buildings map, milestones and events stay consistent. Headless.
 */
import { BF, type Building, type CityState } from '../CityState';
import type { Simulation } from '../Simulation';
import { getDef } from '../catalog';
import { Network } from '../../core/types';
import { DEMOLISH_FEE_BASE, DEMOLISH_FEE_PER_CELL_STAGE, RUBBLE_FEE_PER_CELL } from './tuning';
import type { CellRect } from '../../core/events';

/** Write a new building into the grid + map, count plopped defs in state.milestones, emit buildingAdded. */
export function placeBuilding(sim: Simulation, b: Building): void {
  const st = sim.state;
  const N = st.size;
  for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) st.building[z * N + x] = b.id;
  st.buildings.set(b.id, b);
  if (b.flags & BF.Plopped) st.milestones[b.def] = (st.milestones[b.def] ?? 0) + 1;
  st.stats.buildingCount = st.buildings.size;
  sim.events.emit('buildingAdded', b);
}

/** Remove a building from grid + map, emit buildingRemoved. Zones are kept. */
export function removeBuilding(sim: Simulation, b: Building): void {
  const st = sim.state;
  if (!st.buildings.has(b.id)) return;
  const N = st.size;
  for (let z = b.z; z < b.z + b.d; z++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = z * N + x;
      if (st.building[i] === b.id) st.building[i] = -1;
    }
  }
  st.buildings.delete(b.id);
  if (b.flags & BF.Plopped) {
    const c = (st.milestones[b.def] ?? 1) - 1;
    if (c > 0) st.milestones[b.def] = c;
    else delete st.milestones[b.def];
  }
  st.stats.buildingCount = st.buildings.size;
  sim.events.emit('buildingRemoved', b);
}

/** Cost to demolish a building (growables: small fee; rubble: per cell; plopped: 0 — no refund either). */
export function demolishFee(b: Building): number {
  if (b.flags & BF.Burnt) return RUBBLE_FEE_PER_CELL * b.w * b.d;
  if (b.flags & BF.Plopped) return 0;
  const stage = getDef(b.def)?.stage ?? 1;
  return DEMOLISH_FEE_BASE + DEMOLISH_FEE_PER_CELL_STAGE * b.w * b.d * stage;
}

/** true if the corner (cx,cz) is shared with a water cell or a cell of another building (≠ selfId) */
function cornerLocked(st: CityState, cx: number, cz: number, selfId: number, lockNetworks: boolean): boolean {
  const N = st.size;
  for (let dz = -1; dz <= 0; dz++) {
    const z = cz + dz;
    if (z < 0 || z >= N) continue;
    for (let dx = -1; dx <= 0; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= N) continue;
      const i = z * N + x;
      if (st.water[i]) return true;
      const bid = st.building[i];
      if (bid >= 0 && bid !== selfId) return true;
      if (lockNetworks && st.network[i] !== Network.None) return true;
    }
  }
  return false;
}

/** average corner height of a lot (all (w+1)(d+1) corners) */
export function lotAverageHeight(st: CityState, x0: number, z0: number, w: number, d: number): number {
  const N1 = st.size + 1;
  let s = 0, n = 0;
  for (let z = z0; z <= z0 + d; z++) for (let x = x0; x <= x0 + w; x++) { s += st.heights[z * N1 + x]; n++; }
  return s / n;
}

/** max − min corner height of a lot */
export function lotSlope(st: CityState, x0: number, z0: number, w: number, d: number): number {
  const N1 = st.size + 1;
  let lo = Infinity, hi = -Infinity;
  for (let z = z0; z <= z0 + d; z++) {
    for (let x = x0; x <= x0 + w; x++) {
      const h = st.heights[z * N1 + x];
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return hi - lo;
}

/**
 * Level a lot to `baseY` (lot average, min 0.3 m). Corners shared with water cells or other buildings are kept
 * (so neighbours and shorelines are untouched); with `keepNetworkCorners` corners touching roads are kept too.
 * Returns the base height and the changed-corner rect (null if nothing moved > 5 cm).
 */
export function levelLot(
  st: CityState, x0: number, z0: number, w: number, d: number, selfId: number, keepNetworkCorners = false,
): { baseY: number; changed: CellRect | null } {
  const N1 = st.size + 1;
  const baseY = Math.max(0.3, lotAverageHeight(st, x0, z0, w, d));
  let changed = false;
  for (let z = z0; z <= z0 + d; z++) {
    for (let x = x0; x <= x0 + w; x++) {
      const hi = z * N1 + x;
      if (Math.abs(st.heights[hi] - baseY) < 0.05) continue;
      if (cornerLocked(st, x, z, selfId, keepNetworkCorners)) continue;
      st.heights[hi] = baseY;
      changed = true;
    }
  }
  if (!changed) return { baseY, changed: null };
  const N = st.size;
  return { baseY, changed: { x0: Math.max(0, x0 - 1), z0: Math.max(0, z0 - 1), x1: Math.min(N, x0 + w + 1), z1: Math.min(N, z0 + d + 1) } };
}

/** direction vector of the front of a building with rotation rot (0:+Z 1:+X 2:-Z 3:-X) */
export const FRONT_DX = [0, 1, 0, -1];
export const FRONT_DZ = [1, 0, -1, 0];

/**
 * Visit the cells just outside the front edge of a lot (x0,z0,w,d are rotated extents).
 * Returns the number of those cells for which `pred(i)` is true, and the total visited in-bounds.
 */
export function countFront(st: CityState, x0: number, z0: number, w: number, d: number, rot: number, pred: (i: number) => boolean): { hit: number; total: number } {
  const N = st.size;
  let hit = 0, total = 0;
  if (rot === 0 || rot === 2) {
    const z = rot === 0 ? z0 + d : z0 - 1;
    if (z < 0 || z >= N) return { hit, total };
    for (let x = x0; x < x0 + w; x++) { if (x < 0 || x >= N) continue; total++; if (pred(z * N + x)) hit++; }
  } else {
    const x = rot === 1 ? x0 + w : x0 - 1;
    if (x < 0 || x >= N) return { hit, total };
    for (let z = z0; z < z0 + d; z++) { if (z < 0 || z >= N) continue; total++; if (pred(z * N + x)) hit++; }
  }
  return { hit, total };
}

/** true if any road cell touches the lot's front edge (allocation-free: used in hot loops) */
export function frontHasRoad(st: CityState, b: Pick<Building, 'x' | 'z' | 'w' | 'd' | 'rot'>): boolean {
  const net = st.network, N = st.size, rot = b.rot;
  if (rot === 0 || rot === 2) {
    const z = rot === 0 ? b.z + b.d : b.z - 1;
    if (z < 0 || z >= N) return false;
    const x1 = Math.min(N, b.x + b.w);
    for (let x = Math.max(0, b.x); x < x1; x++) { const n = net[z * N + x]; if (n >= Network.Street && n <= Network.Highway) return true; }
  } else {
    const x = rot === 1 ? b.x + b.w : b.x - 1;
    if (x < 0 || x >= N) return false;
    const z1 = Math.min(N, b.z + b.d);
    for (let z = Math.max(0, b.z); z < z1; z++) { const n = net[z * N + x]; if (n >= Network.Street && n <= Network.Highway) return true; }
  }
  return false;
}

/** true if any road cell is 4-adjacent to the lot on any side */
export function lotTouchesRoad(st: CityState, x0: number, z0: number, w: number, d: number): boolean {
  for (let r = 0; r < 4; r++) {
    if (countFront(st, x0, z0, w, d, r, (i) => st.network[i] >= Network.Street && st.network[i] <= Network.Highway).hit > 0) return true;
  }
  return false;
}

/** bounding rect of a building */
export function buildingRect(b: Building): CellRect {
  return { x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d };
}
