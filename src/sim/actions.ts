/**
 * CityActions — every player command that mutates the city goes through here (UI tools call these).
 * Every method supports `preview = true` which validates + computes cost WITHOUT mutating state
 * (used for live tool previews / tooltips). Methods emit the matching Simulation events when applied.
 *
 * Headless-safe: no DOM / three.js.
 *
 * NOTE: signatures are the contract with the UI; implementation is owned by the sim-core agent.
 *
 * Costs (see economy/tuning.ts; UI helpers networkCellCost / zoneCellCost): networks per cell street §10 · road §20 ·
 * one-way §25 · avenue §40 · highway §120 · rail §30 (bridges ×10, max span 12), power line §5/cell (×4 over water),
 * subway §100/cell, zoning §2–20/cell. Money in reasons is formatted with formatMoney ('§').
 * Wind turbines must keep ≥ 2 empty cells from other turbines (Chebyshev distance ≥ 3).
 * Upgrades (road→avenue) cost the difference. Bulldozing refunds 25% of networks; growables cost a small demolition
 * fee; civic buildings are removed for free (no refund). Sandbox skips money and unlock checks.
 * One-off spending is recorded in budget.curExpense under 'oneoff:construction' | 'oneoff:zoning' |
 * 'oneoff:demolition' | 'oneoff:terraform', refunds in budget.curIncome['oneoff:refund'].
 *
 * netFlags bits written here: bit0 bridge, bits2-3 one-way direction (0:+x 1:+z 2:-x 3:-z), bit5 (0x20) rail/road
 * level crossing (cell keeps its road type; rail passes through).
 */
import type { CellRect } from '../core/events';
import { DevType, Network, Zone, isRoad } from '../core/types';
import type { ServiceKind } from './catalogTypes';
import type { Simulation } from './Simulation';
import { BF, type Building } from './CityState';
import { getDef, rotatedFootprint } from './catalog';
import { computeWater } from './terrainGen';
import { smoothstep } from '../core/rng';
import {
  BRIDGE_COST_MUL, MAX_BRIDGE_SPAN, NETWORK_INFO, NETWORK_REFUND, PLOP_MAX_SLOPE, POWERLINE_COST, POWERLINE_MAX_SPAN,
  POWERLINE_WATER_MUL, SUBWAY_COST, TERRAFORM_COST_M3, TERRAFORM_MAX_H, TERRAFORM_MIN_H, TREE_CLEAR_COST, TREE_PLANT_COST,
  ZONE_COST, ZONE_FAMILY_OF,
} from './economy/tuning';
import { countFront, demolishFee, levelLot, lotSlope, lotTouchesRoad, placeBuilding, removeBuilding } from './economy/buildings';
import { updateNeighborConnections } from './economy/connections';
import { blockedByOrdinance, getOrdinance, setOrdinanceEnabled } from './economy/ordinances';
import { takeLoanNow } from './economy/loans';
import { formatMoney } from './economy/format';
export { networkCellCost, zoneCellCost, POWERLINE_COST, SUBWAY_COST, BRIDGE_COST_MUL } from './economy/tuning';
export { CURRENCY, formatMoney } from './economy/format';

export interface ActionResult {
  ok: boolean;
  /** total cost (negative = refund) */
  cost: number;
  /** human readable reason when !ok (or warnings when ok) */
  reason?: string;
  /** number of cells / items affected */
  affected?: number;
  /** cells that would be affected (for preview highlighting) */
  cells?: { x: number; z: number; ok: boolean }[];
}

export interface Cell {
  x: number;
  z: number;
}

export type TerraformKind = 'raise' | 'lower' | 'level' | 'smooth';

export interface CityActionsApi {
  zone(rect: CellRect, zone: Zone, preview?: boolean): ActionResult;
  dezone(rect: CellRect, preview?: boolean): ActionResult;
  /** path = ordered list of 4-connected cells */
  buildNetwork(path: Cell[], type: Network, preview?: boolean): ActionResult;
  buildPowerLine(path: Cell[], preview?: boolean): ActionResult;
  buildSubway(path: Cell[], preview?: boolean): ActionResult;
  /** removes buildings, networks, power lines, trees in rect (zones stay unless dezone) */
  bulldoze(rect: CellRect, preview?: boolean): ActionResult;
  /** place a ploppable BuildingDef with its min corner at (x,z) and rotation rot */
  plop(defId: string, x: number, z: number, rot: 0 | 1 | 2 | 3, preview?: boolean): ActionResult;
  terraform(kind: TerraformKind, cx: number, cz: number, radius: number, strength: number, preview?: boolean): ActionResult;
  plantTrees(rect: CellRect, preview?: boolean): ActionResult;
  setTax(dev: DevType, ratePercent: number): void;
  setFunding(service: ServiceKind, percent: number): void;
  setOrdinance(id: string, enabled: boolean): ActionResult;
  takeLoan(amount: number): ActionResult;
  repayLoan(index: number): ActionResult;
  toggleHistoric(buildingId: number): void;
}

/** Straight or L-shaped 4-connected path from a to b (horizontal first when `xFirst`). */
export function lPath(a: Cell, b: Cell, xFirst = true): Cell[] {
  const out: Cell[] = [];
  let x = a.x, z = a.z;
  out.push({ x, z });
  const stepX = () => { while (x !== b.x) { x += Math.sign(b.x - x); out.push({ x, z }); } };
  const stepZ = () => { while (z !== b.z) { z += Math.sign(b.z - z); out.push({ x, z }); } };
  if (xFirst) { stepX(); stepZ(); } else { stepZ(); stepX(); }
  return out;
}

/** Normalize a rect from two corner cells (inclusive) into CellRect (exclusive max). */
export function rectFrom(a: Cell, b: Cell): CellRect {
  return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x) + 1, z1: Math.max(a.z, b.z) + 1 };
}

export type { Simulation };

// ======================================================================================================
// implementation
// ======================================================================================================
/** previews list per-cell results only up to this many cells (bigger drags still get totals) */
export const MAX_PREVIEW_CELLS = 20000;
export const NET_BRIDGE = 1;
export const NET_ONEWAY_SHIFT = 2;
export const NET_ONEWAY_MASK = 0b1100;
export const NET_BUS_STOP = 1 << 4;
export const NET_CROSSING = 1 << 5;
const WIND_TURBINE = 'util_wind_turbine';
/** min Chebyshev distance between wind turbine cells */
export const WIND_SPACING = 3;

const fail = (reason: string, cost = 0, cells?: ActionResult['cells']): ActionResult => ({ ok: false, cost, reason, affected: 0, cells });
const money = (v: number) => formatMoney(v);

function clip(rect: CellRect, N: number): CellRect | null {
  const x0 = Math.max(0, Math.min(rect.x0, rect.x1)), x1 = Math.min(N, Math.max(rect.x0, rect.x1));
  const z0 = Math.max(0, Math.min(rect.z0, rect.z1)), z1 = Math.min(N, Math.max(rect.z0, rect.z1));
  if (x1 <= x0 || z1 <= z0) return null;
  return { x0, z0, x1, z1 };
}

function pathBBox(path: Cell[], N: number, pad = 0): CellRect {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const c of path) { if (c.x < x0) x0 = c.x; if (c.z < z0) z0 = c.z; if (c.x > x1) x1 = c.x; if (c.z > z1) z1 = c.z; }
  return { x0: Math.max(0, x0 - pad), z0: Math.max(0, z0 - pad), x1: Math.min(N, x1 + 1 + pad), z1: Math.min(N, z1 + 1 + pad) };
}

function dirCode(dx: number, dz: number): number {
  return dx > 0 ? 0 : dz > 0 ? 1 : dx < 0 ? 2 : 3;
}

export class CityActions implements CityActionsApi {
  readonly sim: Simulation;
  constructor(sim: Simulation) {
    this.sim = sim;
  }

  private get st() {
    return this.sim.state;
  }
  get sandbox(): boolean {
    return !!this.st.config.sandbox || this.st.config.difficulty === 'sandbox';
  }
  private affordable(cost: number): boolean {
    return this.sandbox || cost <= 0 || this.st.funds >= cost;
  }
  /** apply a one-off cost (negative = refund) and record it in the current month's budget */
  private spend(cost: number, key: string): void {
    const b = this.st.budget;
    if (cost > 0) b.curExpense[key] = (b.curExpense[key] ?? 0) + cost;
    else if (cost < 0) b.curIncome['oneoff:refund'] = (b.curIncome['oneoff:refund'] ?? 0) - cost;
    if (!this.sandbox) this.st.funds -= cost;
  }

  // ---------------------------------------------------------------------------------------------- zoning
  zone(rect: CellRect, zone: Zone, preview = false): ActionResult {
    if (zone === Zone.None) return this.dezone(rect, preview);
    const st = this.st, N = st.size;
    const r = clip(rect, N);
    if (!r) return fail('Out of bounds');
    if (!(zone > Zone.None && zone <= Zone.Landfill)) return fail('Unknown zone');
    const area = (r.x1 - r.x0) * (r.z1 - r.z0);
    const cells: ActionResult['cells'] = area <= MAX_PREVIEW_CELLS ? [] : undefined;
    const fam = ZONE_FAMILY_OF[zone];
    let count = 0, cost = 0, fee = 0, reason: string | undefined;
    const demolish: Building[] = [];
    const seen = new Set<number>();
    const okIdx = preview ? null : new Int32Array(area);
    for (let z: number = r.z0; z < r.z1; z++) {
      for (let x: number = r.x0; x < r.x1; x++) {
        const i = z * N + x;
        let ok = true;
        if (st.water[i]) { ok = false; reason ??= "Can't zone on water"; }
        else if (st.network[i] !== Network.None || st.powerLines[i]) ok = false;
        else if (st.zone[i] === zone) ok = false;
        else {
          const bid = st.building[i];
          if (bid >= 0) {
            const b = st.buildings.get(bid)!;
            if (b.flags & BF.Plopped) { ok = false; reason ??= "Can't zone over plopped buildings"; }
            else if (!seen.has(bid)) {
              seen.add(bid);
              // same family density change keeps the building (it redevelops later); other families demolish it
              const bfam = ZONE_FAMILY_OF[st.zone[i]];
              if (bfam !== fam || fam === null || b.flags & BF.Burnt) { demolish.push(b); fee += demolishFee(b); }
            }
          }
        }
        if (ok) { if (okIdx) okIdx[count] = i; count++; cost += ZONE_COST[zone]; }
        cells?.push({ x, z, ok });
      }
    }
    const total = cost + fee;
    if (count === 0) return fail(reason ?? 'Nothing to zone here', 0, cells);
    if (!this.affordable(total)) return fail(`Not enough money (${money(total)})`, total, cells);
    const warn = demolish.length ? `Rezoning demolishes ${demolish.length} building${demolish.length > 1 ? 's' : ''}` : undefined;
    if (preview) return { ok: true, cost: total, affected: count, cells, reason: warn };
    for (const b of demolish) removeBuilding(this.sim, b);
    for (let k = 0; k < count; k++) st.zone[okIdx![k]] = zone;
    this.spend(cost, 'oneoff:zoning');
    if (fee) this.spend(fee, 'oneoff:demolition');
    this.sim.events.emit('zoneChanged', r);
    return { ok: true, cost: total, affected: count, cells, reason: warn };
  }

  dezone(rect: CellRect, preview = false): ActionResult {
    const st = this.st, N = st.size;
    const r = clip(rect, N);
    if (!r) return fail('Out of bounds');
    const area = (r.x1 - r.x0) * (r.z1 - r.z0);
    const cells: ActionResult['cells'] = area <= MAX_PREVIEW_CELLS ? [] : undefined;
    let count = 0;
    for (let z: number = r.z0; z < r.z1; z++) {
      for (let x: number = r.x0; x < r.x1; x++) {
        const i = z * N + x;
        const ok = st.zone[i] !== Zone.None && st.building[i] < 0;
        if (ok) { count++; if (!preview) st.zone[i] = Zone.None; }
        cells?.push({ x, z, ok });
      }
    }
    if (count === 0) return fail('No empty zoned cells here (bulldoze buildings first)', 0, cells);
    if (!preview) this.sim.events.emit('zoneChanged', r);
    return { ok: true, cost: 0, affected: count, cells };
  }

  // ---------------------------------------------------------------------------------------------- networks
  buildNetwork(path: Cell[], type: Network, preview = false): ActionResult {
    const st = this.st, N = st.size;
    const info = NETWORK_INFO[type];
    if (!info) return fail('Unknown network type');
    if (!path.length) return fail('Empty path');
    const n = path.length;
    for (let k = 0; k < n; k++) {
      const c = path[k];
      if (!st.inBounds(c.x, c.z)) return fail('Out of bounds');
      if (k > 0 && Math.abs(c.x - path[k - 1].x) + Math.abs(c.z - path[k - 1].z) !== 1) return fail('Path must be 4-connected');
    }
    const cells: ActionResult['cells'] = [];
    const isRail = type === Network.Rail;
    let cost = 0, fee = 0, count = 0;
    let firstErr: string | undefined;
    const demolish: Building[] = [];
    const seen = new Set<number>();
    let waterRun = 0, runDir = -1;
    const err = (x: number, z: number, why: string) => { firstErr ??= why; cells.push({ x, z, ok: false }); };
    const roadAt = (i: number) => isRoad(st.network[i] as Network);
    for (let k = 0; k < n; k++) {
      const { x, z } = path[k];
      const i = z * N + x;
      const next = path[k + 1], prev = path[k - 1];
      const d = next ? dirCode(next.x - x, next.z - z) : prev ? dirCode(x - prev.x, z - prev.z) : 0;
      const wet = st.water[i] === 1;
      // ---- bridges
      if (wet) {
        if (!info.bridge) { err(x, z, `${info.name}s can't cross water`); continue; }
        if (k === 0 || k === n - 1) { err(x, z, 'Bridges must start and end on land'); continue; }
        if (waterRun > 0 && runDir !== d) { err(x, z, 'Bridges must be straight'); continue; }
        waterRun++;
        runDir = d;
        if (waterRun > MAX_BRIDGE_SPAN) { err(x, z, `Bridge too long (max ${MAX_BRIDGE_SPAN} cells)`); continue; }
      } else {
        waterRun = 0;
        runDir = -1;
      }
      // ---- slope
      if (!wet) {
        if (prev && !st.water[prev.z * N + prev.x]) {
          const dh = Math.abs(st.cellHeight(x, z) - st.cellHeight(prev.x, prev.z));
          if (dh > info.maxSlope && st.network[i] === Network.None) { err(x, z, 'Too steep'); continue; }
        }
        if (st.cellSlope(x, z) > info.maxSlope * 1.6 && st.network[i] === Network.None) { err(x, z, 'Too steep'); continue; }
      }
      // ---- buildings
      const bid = st.building[i];
      if (bid >= 0) {
        const b = st.buildings.get(bid)!;
        if (b.flags & BF.Plopped) { err(x, z, `Blocked by ${getDef(b.def)?.name ?? 'a building'}`); continue; }
        if (!seen.has(bid)) { seen.add(bid); demolish.push(b); fee += demolishFee(b); }
      }
      // ---- highway ↔ street rule
      if (type === Network.Highway || type === Network.Street) {
        const other = type === Network.Highway ? Network.Street : Network.Highway;
        let bad = st.network[i] === other;
        for (let r = 0; r < 4 && !bad; r++) {
          const nx = x + (r === 1 ? 1 : r === 3 ? -1 : 0), nz = z + (r === 0 ? 1 : r === 2 ? -1 : 0);
          if (st.inBounds(nx, nz) && st.network[nz * N + nx] === other) bad = true;
        }
        if (bad) { err(x, z, 'Highways cannot connect directly to streets'); continue; }
      }
      // ---- existing networks
      const cur = st.network[i] as Network;
      const mul = wet ? BRIDGE_COST_MUL : 1;
      if (cur === type) {
        if (type === Network.OneWay && ((st.netFlags[i] & NET_ONEWAY_MASK) >> NET_ONEWAY_SHIFT) !== d) cost += info.cost * 0.5 * mul;
        cells.push({ x, z, ok: true });
        continue;
      }
      if (cur !== Network.None) {
        const curRail = cur === Network.Rail;
        if (curRail !== isRail) {
          // level crossing: single-cell crossing only, never with highways
          if (type === Network.Highway || cur === Network.Highway) { err(x, z, 'Highways cannot cross rail at grade'); continue; }
          if (wet) { err(x, z, "Can't cross on a bridge"); continue; }
          const nb = (c?: Cell) => !!c && (isRail ? roadAt(c.z * N + c.x) : st.network[c.z * N + c.x] === Network.Rail);
          if (nb(prev) || nb(next)) { err(x, z, isRail ? "Rail can't run along a road" : "Roads can't run along rail"); continue; }
          if (st.netFlags[i] & NET_CROSSING) { cells.push({ x, z, ok: true }); continue; }
          cost += info.cost;
          count++;
          cells.push({ x, z, ok: true });
          continue;
        }
        if (st.netFlags[i] & NET_CROSSING) { err(x, z, 'Bulldoze the level crossing first'); continue; }
        const ci = NETWORK_INFO[cur];
        cost += info.rank >= ci.rank ? Math.max(0, info.cost - ci.cost) * mul : info.cost * 0.25 * mul;
      } else {
        cost += info.cost * mul;
        if (st.trees[i]) cost += TREE_CLEAR_COST;
      }
      count++;
      cells.push({ x, z, ok: true });
    }
    if (firstErr) return fail(firstErr, cost + fee, cells);
    const total = cost + fee;
    if (count === 0 && total === 0) return { ok: true, cost: 0, affected: 0, cells, reason: 'Already built' };
    if (!this.affordable(total)) return fail(`Not enough money (${money(total)})`, total, cells);
    const warn = demolish.length ? `Demolishes ${demolish.length} building${demolish.length > 1 ? 's' : ''}` : undefined;
    if (preview) return { ok: true, cost: total, affected: count, cells, reason: warn };

    // ---- apply
    for (const b of demolish) removeBuilding(this.sim, b);
    let zoneCleared = false, treesCleared = false;
    for (let k = 0; k < n; k++) {
      const { x, z } = path[k];
      const i = z * N + x;
      const next = path[k + 1], prev = path[k - 1];
      const d = next ? dirCode(next.x - x, next.z - z) : prev ? dirCode(x - prev.x, z - prev.z) : 0;
      const cur = st.network[i] as Network;
      const wet = st.water[i] === 1;
      if (cur === type) {
        if (type === Network.OneWay) st.netFlags[i] = (st.netFlags[i] & ~NET_ONEWAY_MASK) | (d << NET_ONEWAY_SHIFT);
        continue;
      }
      if (cur !== Network.None && (cur === Network.Rail) !== isRail) {
        // level crossing: keep / make the road type, flag the crossing
        if (isRail) st.netFlags[i] |= NET_CROSSING;
        else { st.network[i] = type; st.netFlags[i] = (st.netFlags[i] & NET_BUS_STOP) | NET_CROSSING; }
      } else {
        const keep = st.netFlags[i] & NET_BUS_STOP;
        st.network[i] = type;
        let f = keep | (wet ? NET_BRIDGE : 0);
        if (type === Network.OneWay) f |= d << NET_ONEWAY_SHIFT;
        st.netFlags[i] = isRail ? f & ~NET_BUS_STOP : f;
      }
      if (st.zone[i] !== Zone.None) { st.zone[i] = Zone.None; zoneCleared = true; }
      if (st.trees[i]) { st.trees[i] = 0; treesCleared = true; }
    }
    this.spend(cost, 'oneoff:construction');
    if (fee) this.spend(fee, 'oneoff:demolition');
    const bb = pathBBox(path, N);
    this.sim.events.emit('networkChanged', bb);
    if (zoneCleared) this.sim.events.emit('zoneChanged', bb);
    if (treesCleared) this.sim.events.emit('treesChanged', bb);
    this.afterNetworkChange();
    return { ok: true, cost: total, affected: count, cells, reason: warn };
  }

  private afterNetworkChange(): void {
    const before = this.st.neighborConnections.length;
    if (updateNeighborConnections(this.st) && this.st.neighborConnections.length > before) {
      this.sim.notify('New neighbor connection! Trade with the region boosts demand.', 'good', this.st.neighborConnections.at(-1)?.x, this.st.neighborConnections.at(-1)?.z, 'transport');
    }
  }

  buildPowerLine(path: Cell[], preview = false): ActionResult {
    const st = this.st, N = st.size;
    if (!path.length) return fail('Empty path');
    const cells: ActionResult['cells'] = [];
    let cost = 0, count = 0, run = 0;
    let firstErr: string | undefined;
    for (let k = 0; k < path.length; k++) {
      const { x, z } = path[k];
      if (!st.inBounds(x, z)) return fail('Out of bounds');
      if (k > 0 && Math.abs(x - path[k - 1].x) + Math.abs(z - path[k - 1].z) !== 1) return fail('Path must be 4-connected');
      const i = z * N + x;
      if (st.building[i] >= 0) { firstErr ??= 'Blocked by a building'; cells.push({ x, z, ok: false }); continue; }
      const wet = st.water[i] === 1;
      run = wet ? run + 1 : 0;
      if (run > POWERLINE_MAX_SPAN) { firstErr ??= `Span over water too long (max ${POWERLINE_MAX_SPAN})`; cells.push({ x, z, ok: false }); continue; }
      if (st.powerLines[i]) { cells.push({ x, z, ok: true }); continue; }
      cost += POWERLINE_COST * (wet ? POWERLINE_WATER_MUL : 1) + (st.trees[i] ? TREE_CLEAR_COST : 0);
      count++;
      cells.push({ x, z, ok: true });
    }
    if (firstErr) return fail(firstErr, cost, cells);
    if (count === 0) return { ok: true, cost: 0, affected: 0, cells, reason: 'Already built' };
    if (!this.affordable(cost)) return fail(`Not enough money (${money(cost)})`, cost, cells);
    if (preview) return { ok: true, cost, affected: count, cells };
    let zoneCleared = false, treesCleared = false;
    for (const { x, z } of path) {
      const i = z * N + x;
      st.powerLines[i] = 1;
      if (st.zone[i] !== Zone.None && st.network[i] === Network.None) { st.zone[i] = Zone.None; zoneCleared = true; }
      if (st.trees[i]) { st.trees[i] = 0; treesCleared = true; }
    }
    this.spend(cost, 'oneoff:construction');
    const bb = pathBBox(path, N);
    this.sim.events.emit('powerLinesChanged', bb);
    if (zoneCleared) this.sim.events.emit('zoneChanged', bb);
    if (treesCleared) this.sim.events.emit('treesChanged', bb);
    return { ok: true, cost, affected: count, cells };
  }

  buildSubway(path: Cell[], preview = false): ActionResult {
    const st = this.st, N = st.size;
    if (!path.length) return fail('Empty path');
    const cells: ActionResult['cells'] = [];
    let count = 0;
    for (let k = 0; k < path.length; k++) {
      const { x, z } = path[k];
      if (!st.inBounds(x, z)) return fail('Out of bounds');
      if (k > 0 && Math.abs(x - path[k - 1].x) + Math.abs(z - path[k - 1].z) !== 1) return fail('Path must be 4-connected');
      if (!st.subway[z * N + x]) count++;
      cells.push({ x, z, ok: true });
    }
    const cost = count * SUBWAY_COST;
    if (count === 0) return { ok: true, cost: 0, affected: 0, cells, reason: 'Already built' };
    if (!this.affordable(cost)) return fail(`Not enough money (${money(cost)})`, cost, cells);
    if (preview) return { ok: true, cost, affected: count, cells };
    for (const { x, z } of path) st.subway[z * N + x] = 1;
    this.spend(cost, 'oneoff:construction');
    this.sim.events.emit('subwayChanged', pathBBox(path, N));
    return { ok: true, cost, affected: count, cells };
  }

  /** Remove subway tunnels in rect (underground bulldozer). Refunds 25%. */
  bulldozeSubway(rect: CellRect, preview = false): ActionResult {
    const st = this.st, N = st.size;
    const r = clip(rect, N);
    if (!r) return fail('Out of bounds');
    let count = 0;
    for (let z: number = r.z0; z < r.z1; z++) for (let x: number = r.x0; x < r.x1; x++) if (st.subway[z * N + x]) count++;
    if (!count) return fail('No subway here');
    const cost = -count * SUBWAY_COST * NETWORK_REFUND;
    if (preview) return { ok: true, cost, affected: count };
    for (let z: number = r.z0; z < r.z1; z++) for (let x: number = r.x0; x < r.x1; x++) st.subway[z * N + x] = 0;
    this.spend(cost, 'oneoff:refund');
    this.sim.events.emit('subwayChanged', r);
    return { ok: true, cost, affected: count };
  }

  // ---------------------------------------------------------------------------------------------- bulldoze
  bulldoze(rect: CellRect, preview = false): ActionResult {
    const st = this.st, N = st.size;
    const r = clip(rect, N);
    if (!r) return fail('Out of bounds');
    const area = (r.x1 - r.x0) * (r.z1 - r.z0);
    const cells: ActionResult['cells'] = area <= MAX_PREVIEW_CELLS ? [] : undefined;
    const blds: Building[] = [];
    const seen = new Set<number>();
    let fee = 0, refund = 0, treeCost = 0, count = 0;
    let anyNet = false, anyPower = false, anyTree = false;
    for (let z: number = r.z0; z < r.z1; z++) {
      for (let x: number = r.x0; x < r.x1; x++) {
        const i = z * N + x;
        let ok = false;
        const bid = st.building[i];
        if (bid >= 0) {
          ok = true;
          if (!seen.has(bid)) { seen.add(bid); const b = st.buildings.get(bid)!; blds.push(b); fee += demolishFee(b); }
        }
        const net = st.network[i];
        if (net !== Network.None) {
          ok = true; anyNet = true;
          const info = NETWORK_INFO[net];
          let c = info.cost * (st.netFlags[i] & NET_BRIDGE ? BRIDGE_COST_MUL : 1);
          if (st.netFlags[i] & NET_CROSSING) c += NETWORK_INFO[Network.Rail].cost;
          refund += c * NETWORK_REFUND;
        }
        if (st.powerLines[i]) { ok = true; anyPower = true; refund += POWERLINE_COST * NETWORK_REFUND * (st.water[i] ? POWERLINE_WATER_MUL : 1); }
        if (st.trees[i] && bid < 0) { ok = true; anyTree = true; treeCost += TREE_CLEAR_COST; }
        if (ok) count++;
        cells?.push({ x, z, ok });
      }
    }
    if (count === 0) return fail('Nothing to bulldoze', 0, cells);
    const total = fee + treeCost - refund;
    if (!this.affordable(total)) return fail(`Not enough money (${money(total)})`, total, cells);
    const unique = blds.find((b) => getDef(b.def)?.unique);
    const warn = unique ? `Demolishes ${getDef(unique.def)?.name}` : undefined;
    if (preview) return { ok: true, cost: total, affected: count, cells, reason: warn };
    for (const b of blds) removeBuilding(this.sim, b);
    for (let z: number = r.z0; z < r.z1; z++) {
      for (let x: number = r.x0; x < r.x1; x++) {
        const i = z * N + x;
        st.network[i] = 0;
        st.netFlags[i] = 0;
        st.powerLines[i] = 0;
        st.trees[i] = 0;
      }
    }
    if (fee + treeCost) this.spend(fee + treeCost, 'oneoff:demolition');
    if (refund) this.spend(-refund, 'oneoff:refund');
    if (anyNet) { this.sim.events.emit('networkChanged', r); this.afterNetworkChange(); }
    if (anyPower) this.sim.events.emit('powerLinesChanged', r);
    if (anyTree) this.sim.events.emit('treesChanged', r);
    return { ok: true, cost: total, affected: count, cells, reason: warn };
  }

  // ---------------------------------------------------------------------------------------------- plop
  plop(defId: string, x: number, z: number, rot: 0 | 1 | 2 | 3, preview = false): ActionResult {
    const st = this.st, N = st.size;
    const def = getDef(defId);
    if (!def) return fail(`Unknown building "${defId}"`);
    if (def.hidden || def.category === 'growable') return fail(`${def.name} can't be placed directly`);
    if (def.requires && !this.sandbox && !st.unlocked.has(def.requires)) return fail(`${def.name} is not unlocked yet`);
    const blocked = blockedByOrdinance(st, def.id);
    if (blocked) return fail(`Banned by the ${blocked.name} ordinance`);
    if (def.unique && (st.milestones[def.id] ?? 0) > 0) return fail(`Only one ${def.name} allowed`);
    const [w, d] = rotatedFootprint(def, rot);
    const cells: ActionResult['cells'] = [];
    let firstErr: string | undefined;
    let treeCells = 0;
    const placement = def.placement ?? 'land';
    for (let zz = z; zz < z + d; zz++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!st.inBounds(xx, zz)) { firstErr ??= 'Out of bounds'; cells.push({ x: xx, z: zz, ok: false }); continue; }
        const i = zz * N + xx;
        let ok = true;
        if (st.building[i] >= 0) { ok = false; firstErr ??= 'Blocked by a building'; }
        else if (st.network[i] !== Network.None) { ok = false; firstErr ??= 'Blocked by a road or rail'; }
        else if (placement === 'water' ? !st.water[i] : st.water[i]) { ok = false; firstErr ??= placement === 'water' ? 'Must be placed on water' : "Can't build on water"; }
        if (ok && st.trees[i]) treeCells++;
        cells.push({ x: xx, z: zz, ok });
      }
    }
    if (!firstErr && def.id === WIND_TURBINE) {
      // realistic rotors (R ≈ 23 m) overlap unless turbines keep ≥ 2 empty cells between them (Chebyshev ≥ 3)
      for (let zz = z - WIND_SPACING + 1; zz < z + d + WIND_SPACING - 1 && !firstErr; zz++) {
        for (let xx = x - WIND_SPACING + 1; xx < x + w + WIND_SPACING - 1; xx++) {
          if (!st.inBounds(xx, zz)) continue;
          const o = st.buildingAt(xx, zz);
          if (o && o.def === WIND_TURBINE) { firstErr = 'Too close to another wind turbine'; break; }
        }
      }
    }
    if (firstErr) return fail(firstErr, def.cost ?? 0, cells);
    if (placement === 'shore') {
      const f = countFront(st, x, z, w, d, rot, (i) => st.water[i] === 1);
      if (f.total === 0 || f.hit * 2 < f.total) return fail('Must be placed on the shore with its front facing water', def.cost ?? 0, cells);
    }
    if (lotSlope(st, x, z, w, d) > PLOP_MAX_SLOPE) return fail('Too steep — level the ground first', def.cost ?? 0, cells);
    const cost = (def.cost ?? 0) + treeCells * TREE_CLEAR_COST;
    if (!this.affordable(cost)) return fail(`Not enough money (${money(cost)})`, cost, cells);
    const warn = lotTouchesRoad(st, x, z, w, d) ? undefined : 'Warning: no road access';
    if (preview) return { ok: true, cost, affected: 1, cells, reason: warn };

    // ---- apply: clear trees + zone, level, create
    let zoneCleared = false, treesCleared = false;
    for (let zz = z; zz < z + d; zz++) {
      for (let xx = x; xx < x + w; xx++) {
        const i = zz * N + xx;
        if (st.zone[i] !== Zone.None) { st.zone[i] = Zone.None; zoneCleared = true; }
        if (st.trees[i]) { st.trees[i] = 0; treesCleared = true; }
      }
    }
    const id = st.nextBuildingId++;
    const lv = levelLot(st, x, z, w, d, id, placement === 'shore');
    const b: Building = {
      id, def: def.id, x, z, w, d, rot, variant: 0, pop: 0, jobs: 0, capacity: def.jobs ?? 0, wealth: 0, built: 1, age: 0,
      flags: BF.Plopped, baseY: lv.baseY, health: 1, unhappy: 0,
    };
    placeBuilding(this.sim, b);
    this.spend(cost, 'oneoff:construction');
    const rect = { x0: x, z0: z, x1: x + w, z1: z + d };
    if (lv.changed) this.sim.events.emit('terrainChanged', lv.changed);
    if (zoneCleared) this.sim.events.emit('zoneChanged', rect);
    if (treesCleared) this.sim.events.emit('treesChanged', rect);
    if (def.unique && (def.category === 'reward' || def.category === 'landmark' || def.category === 'civic')) {
      this.sim.notify(`${def.name} opens in ${st.config.name}!`, 'good', x + (w >> 1), z + (d >> 1), 'planning');
    }
    return { ok: true, cost, affected: 1, cells, reason: warn };
  }

  // ---------------------------------------------------------------------------------------------- terrain
  terraform(kind: TerraformKind, cx: number, cz: number, radius: number, strength: number, preview = false): ActionResult {
    const st = this.st, N = st.size, N1 = N + 1;
    const rad = Math.max(0.5, Math.min(24, radius));
    const str = Math.max(0, strength);
    const ccx = cx + 0.5, ccz = cz + 0.5;
    const hx0 = Math.max(0, Math.floor(ccx - rad)), hx1 = Math.min(N, Math.ceil(ccx + rad));
    const hz0 = Math.max(0, Math.floor(ccz - rad)), hz1 = Math.min(N, Math.ceil(ccz + rad));
    if (hx1 < hx0 || hz1 < hz0) return fail('Out of bounds');
    const target = kind === 'level' && st.inBounds(cx, cz) ? st.cellHeight(cx, cz) : 0;
    const blend = Math.min(1, str > 1 ? str / 10 : str);
    const idx: number[] = [];
    const vals: number[] = [];
    let volume = 0, locked = 0;
    const H = st.heights;
    for (let hz = hz0; hz <= hz1; hz++) {
      for (let hx = hx0; hx <= hx1; hx++) {
        const dist = Math.hypot(hx - ccx, hz - ccz);
        if (dist > rad) continue;
        const fall = 1 - smoothstep(0, 1, dist / rad);
        if (fall <= 0.001) continue;
        // corners touching buildings or networks are locked
        let lock = false;
        for (let dz = -1; dz <= 0 && !lock; dz++) {
          for (let dx = -1; dx <= 0 && !lock; dx++) {
            const x = hx + dx, z = hz + dz;
            if (x < 0 || z < 0 || x >= N || z >= N) continue;
            const i = z * N + x;
            if (st.building[i] >= 0 || st.network[i] !== Network.None) lock = true;
          }
        }
        if (lock) { locked++; continue; }
        const hi = hz * N1 + hx;
        const h = H[hi];
        let nh = h;
        if (kind === 'raise') nh = h + str * fall;
        else if (kind === 'lower') nh = h - str * fall;
        else if (kind === 'level') nh = h + (target - h) * blend * fall;
        else {
          let s = 0, c = 0;
          if (hx > 0) { s += H[hi - 1]; c++; }
          if (hx < N) { s += H[hi + 1]; c++; }
          if (hz > 0) { s += H[hi - N1]; c++; }
          if (hz < N) { s += H[hi + N1]; c++; }
          nh = h + (s / c - h) * blend * fall;
        }
        nh = Math.max(TERRAFORM_MIN_H, Math.min(TERRAFORM_MAX_H, nh));
        if (Math.abs(nh - h) < 0.005) continue;
        volume += Math.abs(nh - h) * 256;
        idx.push(hi);
        vals.push(nh);
      }
    }
    if (!idx.length) return fail(locked ? "Can't terraform under buildings or roads" : 'Nothing to change');
    const cost = Math.round(volume * TERRAFORM_COST_M3);
    if (!this.affordable(cost)) return fail(`Not enough money (${money(cost)})`, cost);
    if (preview) return { ok: true, cost, affected: idx.length };
    for (let k = 0; k < idx.length; k++) H[idx[k]] = vals[k];
    const r: CellRect = { x0: Math.max(0, hx0 - 1), z0: Math.max(0, hz0 - 1), x1: Math.min(N, hx1 + 1), z1: Math.min(N, hz1 + 1) };
    computeWater(st, r.x0, r.z0, r.x1, r.z1);
    let treesChanged = false, zoneChanged = false, powerChanged = false;
    for (let z: number = r.z0; z < r.z1; z++) {
      for (let x: number = r.x0; x < r.x1; x++) {
        const i = z * N + x;
        if (!st.water[i]) continue;
        if (st.trees[i]) { st.trees[i] = 0; treesChanged = true; }
        if (st.zone[i]) { st.zone[i] = 0; zoneChanged = true; }
        if (st.powerLines[i]) { st.powerLines[i] = 0; powerChanged = true; }
      }
    }
    this.spend(cost, 'oneoff:terraform');
    this.sim.events.emit('terrainChanged', r);
    if (treesChanged) this.sim.events.emit('treesChanged', r);
    if (zoneChanged) this.sim.events.emit('zoneChanged', r);
    if (powerChanged) this.sim.events.emit('powerLinesChanged', r);
    return { ok: true, cost, affected: idx.length };
  }

  plantTrees(rect: CellRect, preview = false): ActionResult {
    const st = this.st, N = st.size;
    const r = clip(rect, N);
    if (!r) return fail('Out of bounds');
    const area = (r.x1 - r.x0) * (r.z1 - r.z0);
    const cells: ActionResult['cells'] = area <= MAX_PREVIEW_CELLS ? [] : undefined;
    let count = 0;
    for (let z: number = r.z0; z < r.z1; z++) {
      for (let x: number = r.x0; x < r.x1; x++) {
        const i = z * N + x;
        const ok = !st.water[i] && st.building[i] < 0 && st.network[i] === Network.None && st.trees[i] < 3;
        if (ok) count++;
        cells?.push({ x, z, ok });
      }
    }
    const cost = count * TREE_PLANT_COST;
    if (!count) return fail('No room for trees here', 0, cells);
    if (!this.affordable(cost)) return fail(`Not enough money (${money(cost)})`, cost, cells);
    if (preview) return { ok: true, cost, affected: count, cells };
    const rng = this.sim.rng;
    for (let z: number = r.z0; z < r.z1; z++) {
      for (let x: number = r.x0; x < r.x1; x++) {
        const i = z * N + x;
        if (!st.water[i] && st.building[i] < 0 && st.network[i] === Network.None && st.trees[i] < 3) st.trees[i] = rng.chance(0.5) ? 3 : 4;
      }
    }
    this.spend(cost, 'oneoff:construction');
    this.sim.events.emit('treesChanged', r);
    return { ok: true, cost, affected: count, cells };
  }

  // ---------------------------------------------------------------------------------------------- budget & policy
  setTax(dev: DevType, ratePercent: number): void {
    if (dev < 0 || dev >= this.st.budget.taxRates.length) return;
    this.st.budget.taxRates[dev] = Math.max(0, Math.min(20, Math.round(ratePercent * 10) / 10));
  }

  /** set all taxes of a family ('R' = R$..R$$$, 'C' = CS + CO, 'I' = all industry) */
  setFamilyTax(family: 'R' | 'C' | 'I', ratePercent: number): void {
    const [a, b] = family === 'R' ? [0, 2] : family === 'C' ? [3, 7] : [8, 11];
    for (let d = a; d <= b; d++) this.setTax(d, ratePercent);
  }

  setFunding(service: ServiceKind, percent: number): void {
    if (!(service in this.st.budget.funding)) return;
    this.st.budget.funding[service] = Math.max(0, Math.min(150, Math.round(percent)));
  }

  setOrdinance(id: string, enabled: boolean): ActionResult {
    const st = this.st;
    const o = getOrdinance(id);
    if (!o) return fail(`Unknown ordinance "${id}"`);
    const res = setOrdinanceEnabled(st, id, enabled);
    if (!res.ok) return fail(res.reason ?? 'Refused', res.monthly);
    return { ok: true, cost: res.monthly, affected: 1, reason: enabled ? `${o.name} enacted` : `${o.name} repealed` };
  }

  takeLoan(amount: number): ActionResult {
    const o = takeLoanNow(this.st, Math.round(amount));
    if (!o.ok) return fail(o.reason ?? 'Loan refused');
    return { ok: true, cost: -Math.round(amount), affected: 1, reason: `${(o.rate * 100).toFixed(1)}% for ${o.termMonths / 12} years: ${money(o.monthlyPayment)}/month` };
  }

  repayLoan(index: number): ActionResult {
    const st = this.st;
    const l = st.budget.loans[index];
    if (!l) return fail('No such loan');
    const cost = Math.ceil(l.remaining);
    if (!this.affordable(cost)) return fail(`Not enough money (${money(cost)})`, cost);
    st.budget.loans.splice(index, 1);
    const b = st.budget;
    b.curExpense['oneoff:loanRepay'] = (b.curExpense['oneoff:loanRepay'] ?? 0) + cost;
    if (!this.sandbox) st.funds -= cost;
    return { ok: true, cost, affected: 1 };
  }

  toggleHistoric(buildingId: number): void {
    const b = this.st.buildings.get(buildingId);
    if (!b || b.flags & BF.Plopped) return;
    b.flags ^= BF.Historic;
    this.sim.events.emit('buildingChanged', b);
  }
}
