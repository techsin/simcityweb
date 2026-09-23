/**
 * Minimal CityActionsApi used ONLY when sim-core's CityActions class is not available (keeps tools testable).
 * Validation and costs are approximations; the real rules live in src/sim/actions.ts (sim-core).
 */
import type { CellRect } from '../../core/events';
import { DevType, Network, Zone, isRoad } from '../../core/types';
import type { ActionResult, Cell, CityActionsApi, TerraformKind } from '../../sim/actions';
import { BF, type Building } from '../../sim/CityState';
import type { ServiceKind } from '../../sim/catalogTypes';
import { getDef } from '../../sim/catalog';
import type { Simulation } from '../../sim/Simulation';
import { computeWater } from '../../sim/terrainGen';

const NET_COST: Record<number, number> = { [Network.Street]: 6, [Network.Road]: 10, [Network.Avenue]: 22, [Network.OneWay]: 12, [Network.Highway]: 60, [Network.Rail]: 25 };
const ZONE_COST = [0, 5, 10, 20, 5, 10, 20, 4, 10, 20, 15];

function bounds(path: Cell[]): CellRect {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const c of path) {
    x0 = Math.min(x0, c.x); z0 = Math.min(z0, c.z); x1 = Math.max(x1, c.x + 1); z1 = Math.max(z1, c.z + 1);
  }
  return { x0, z0, x1, z1 };
}

export class FallbackActions implements CityActionsApi {
  readonly isFallback = true;
  constructor(private sim: Simulation) {}
  private get st() {
    return this.sim.state;
  }
  private sandbox(): boolean {
    return !!this.st.config.sandbox;
  }
  private afford(cost: number): boolean {
    return this.sandbox() || cost <= this.st.funds;
  }
  private spend(cost: number, key: string): void {
    if (this.sandbox()) return;
    this.st.funds -= cost;
    const e = this.st.budget.curExpense;
    e[key] = (e[key] ?? 0) + cost;
  }

  zone(rect: CellRect, zone: Zone, preview = false): ActionResult {
    const st = this.st;
    const cells: { x: number; z: number; ok: boolean }[] = [];
    let n = 0;
    for (let z = Math.max(0, rect.z0); z < Math.min(st.size, rect.z1); z++)
      for (let x = Math.max(0, rect.x0); x < Math.min(st.size, rect.x1); x++) {
        const i = st.idx(x, z);
        const b = st.buildingAt(x, z);
        const ok = !st.water[i] && !st.network[i] && !(b && b.flags & BF.Plopped) && st.zone[i] !== zone && st.cellSlope(x, z) < 10;
        cells.push({ x, z, ok });
        if (ok) n++;
      }
    const cost = n * (ZONE_COST[zone] ?? 5);
    if (!n) return { ok: false, cost: 0, reason: 'Nothing to zone here', affected: 0, cells };
    if (!this.afford(cost)) return { ok: false, cost, reason: 'Not enough money', affected: n, cells };
    if (!preview) {
      for (const c of cells) if (c.ok) st.zone[st.idx(c.x, c.z)] = zone;
      this.spend(cost, 'zoning');
      this.sim.events.emit('zoneChanged', rect);
    }
    return { ok: true, cost, affected: n, cells };
  }

  dezone(rect: CellRect, preview = false): ActionResult {
    const st = this.st;
    let n = 0;
    for (let z = Math.max(0, rect.z0); z < Math.min(st.size, rect.z1); z++)
      for (let x = Math.max(0, rect.x0); x < Math.min(st.size, rect.x1); x++) {
        const i = st.idx(x, z);
        if (st.zone[i]) {
          n++;
          if (!preview) st.zone[i] = 0;
        }
      }
    if (!n) return { ok: false, cost: 0, reason: 'No zones here', affected: 0 };
    if (!preview) this.sim.events.emit('zoneChanged', rect);
    return { ok: true, cost: 0, affected: n };
  }

  private pathCheck(path: Cell[], per: number, allowWater: boolean, layer: 'net' | 'power' | 'subway', type?: Network) {
    const st = this.st;
    const cells: { x: number; z: number; ok: boolean }[] = [];
    let cost = 0, n = 0, bad = 0;
    let reason: string | undefined;
    for (const c of path) {
      if (!st.inBounds(c.x, c.z)) continue;
      const i = st.idx(c.x, c.z);
      let ok = true;
      const b = st.buildingAt(c.x, c.z);
      if (layer === 'net') {
        if (st.network[i] === type) { cells.push({ ...c, ok: true }); continue; }
        if (b) { ok = false; reason = 'Blocked by a building'; }
        else if (st.water[i] && !allowWater) { ok = false; reason = "Can't build on water"; }
        else if (st.cellSlope(c.x, c.z) > 14) { ok = false; reason = 'Too steep'; }
      } else if (layer === 'power') {
        if (st.powerLines[i]) { cells.push({ ...c, ok: true }); continue; }
        if (b) { ok = false; reason = 'Blocked by a building'; }
      } else if (st.subway[i]) { cells.push({ ...c, ok: true }); continue; }
      cells.push({ ...c, ok });
      if (ok) { n++; cost += per * (st.water[i] ? 5 : 1); } else bad++;
    }
    return { cells, cost, n, bad, reason };
  }

  buildNetwork(path: Cell[], type: Network, preview = false): ActionResult {
    const st = this.st;
    const r = this.pathCheck(path, NET_COST[type] ?? 10, type !== Network.Street, 'net', type);
    if (r.bad) return { ok: false, cost: r.cost, reason: r.reason, affected: r.n, cells: r.cells };
    if (!r.n) return { ok: false, cost: 0, reason: 'Already built', affected: 0, cells: r.cells };
    if (!this.afford(r.cost)) return { ok: false, cost: r.cost, reason: 'Not enough money', affected: r.n, cells: r.cells };
    if (!preview) {
      for (let k = 0; k < path.length; k++) {
        const c = path[k];
        if (!st.inBounds(c.x, c.z)) continue;
        const i = st.idx(c.x, c.z);
        st.network[i] = type;
        st.zone[i] = 0;
        st.trees[i] = 0;
        let fl = st.water[i] ? 1 : 0;
        if (type === Network.OneWay) {
          const n = path[Math.min(k + 1, path.length - 1)], p = path[Math.max(0, k - 1)];
          const dx = n.x - p.x, dz = n.z - p.z;
          const dir = Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 0 : 2) : dz >= 0 ? 1 : 3;
          fl |= dir << 2;
        }
        st.netFlags[i] = fl;
      }
      this.spend(r.cost, isRoad(type) ? 'transport:roads' : 'transport:rail');
      const b = bounds(path);
      this.sim.events.emit('networkChanged', b);
      this.sim.events.emit('treesChanged', b);
    }
    return { ok: true, cost: r.cost, affected: r.n, cells: r.cells };
  }

  buildPowerLine(path: Cell[], preview = false): ActionResult {
    const st = this.st;
    const r = this.pathCheck(path, 4, true, 'power');
    if (!r.n) return { ok: false, cost: 0, reason: 'Already built', affected: 0, cells: r.cells };
    if (!this.afford(r.cost)) return { ok: false, cost: r.cost, reason: 'Not enough money', cells: r.cells };
    if (!preview) {
      for (const c of path) if (st.inBounds(c.x, c.z)) st.powerLines[st.idx(c.x, c.z)] = 1;
      this.spend(r.cost, 'utilities:power');
      this.sim.events.emit('powerLinesChanged', bounds(path));
    }
    return { ok: true, cost: r.cost, affected: r.n, cells: r.cells };
  }

  buildSubway(path: Cell[], preview = false): ActionResult {
    const st = this.st;
    const r = this.pathCheck(path, 50, true, 'subway');
    if (!r.n) return { ok: false, cost: 0, reason: 'Already built', affected: 0, cells: r.cells };
    if (!this.afford(r.cost)) return { ok: false, cost: r.cost, reason: 'Not enough money', cells: r.cells };
    if (!preview) {
      for (const c of path) if (st.inBounds(c.x, c.z)) st.subway[st.idx(c.x, c.z)] = 1;
      this.spend(r.cost, 'transport:subway');
      this.sim.events.emit('subwayChanged', bounds(path));
    }
    return { ok: true, cost: r.cost, affected: r.n, cells: r.cells };
  }

  bulldoze(rect: CellRect, preview = false): ActionResult {
    const st = this.st;
    const blds = new Set<Building>();
    let cells = 0;
    for (let z = Math.max(0, rect.z0); z < Math.min(st.size, rect.z1); z++)
      for (let x = Math.max(0, rect.x0); x < Math.min(st.size, rect.x1); x++) {
        const i = st.idx(x, z);
        const b = st.buildingAt(x, z);
        if (b) blds.add(b);
        if (st.network[i] || st.powerLines[i] || st.trees[i]) cells++;
      }
    let cost = cells * 5;
    for (const b of blds) cost += Math.round((b.w * b.d) * (b.flags & BF.Plopped ? 30 : 10));
    if (!cells && !blds.size) return { ok: false, cost: 0, reason: 'Nothing to bulldoze', affected: 0 };
    if (!this.afford(cost)) return { ok: false, cost, reason: 'Not enough money' };
    if (!preview) {
      for (const b of blds) this.removeBuilding(b);
      for (let z = Math.max(0, rect.z0); z < Math.min(st.size, rect.z1); z++)
        for (let x = Math.max(0, rect.x0); x < Math.min(st.size, rect.x1); x++) {
          const i = st.idx(x, z);
          st.network[i] = 0;
          st.netFlags[i] = 0;
          st.powerLines[i] = 0;
          st.trees[i] = 0;
        }
      this.spend(cost, 'bulldoze');
      this.sim.events.emit('networkChanged', rect);
      this.sim.events.emit('powerLinesChanged', rect);
      this.sim.events.emit('treesChanged', rect);
    }
    return { ok: true, cost, affected: cells + blds.size };
  }

  private removeBuilding(b: Building): void {
    const st = this.st;
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if (st.inBounds(x, z)) st.building[st.idx(x, z)] = -1;
    st.buildings.delete(b.id);
    this.sim.events.emit('buildingRemoved', b);
  }

  plop(defId: string, x: number, z: number, rot: 0 | 1 | 2 | 3, preview = false): ActionResult {
    const st = this.st;
    const def = getDef(defId);
    if (!def) return { ok: false, cost: 0, reason: 'Unknown building' };
    const w = rot % 2 ? def.footprint[1] : def.footprint[0];
    const d = rot % 2 ? def.footprint[0] : def.footprint[1];
    const cost = def.cost ?? 0;
    const cells: { x: number; z: number; ok: boolean }[] = [];
    let reason: string | undefined;
    let minH = Infinity, maxH = -Infinity;
    for (let zz = z; zz < z + d; zz++)
      for (let xx = x; xx < x + w; xx++) {
        let ok = true;
        if (!st.inBounds(xx, zz)) { ok = false; reason = 'Outside the city limits'; }
        else {
          const i = st.idx(xx, zz);
          if (st.water[i] && def.placement !== 'water' && def.placement !== 'shore') { ok = false; reason = "Can't build on water"; }
          else if (st.network[i]) { ok = false; reason = 'Blocked by a road'; }
          else if (st.building[i] >= 0) { ok = false; reason = 'Blocked by a building'; }
          const hgt = st.cellHeight(xx, zz);
          minH = Math.min(minH, hgt); maxH = Math.max(maxH, hgt);
        }
        cells.push({ x: xx, z: zz, ok });
      }
    if (!reason && maxH - minH > 12) reason = 'Terrain too steep';
    if (!reason && def.requires && !st.unlocked.has(def.requires) && !this.sandbox()) reason = 'Not unlocked yet';
    if (!reason && def.unique && [...st.buildings.values()].some((b) => b.def === defId)) reason = 'Only one allowed per city';
    if (!reason && !this.afford(cost)) reason = 'Not enough money';
    if (reason) return { ok: false, cost, reason, cells };
    if (!preview) {
      const id = st.nextBuildingId++;
      const b: Building = {
        id, def: defId, x, z, w, d, rot, variant: 0, pop: 0, jobs: 0, capacity: def.capacity ?? def.jobs ?? 0, wealth: 0, built: 1, age: 0,
        flags: BF.Plopped, baseY: Math.max(0, (minH + maxH) / 2), health: 1, unhappy: 0,
      };
      st.buildings.set(id, b);
      for (const c of cells) {
        const i = st.idx(c.x, c.z);
        st.building[i] = id;
        st.zone[i] = 0;
        st.trees[i] = 0;
      }
      this.spend(cost, 'construction');
      st.milestones[defId] = (st.milestones[defId] ?? 0) + 1;
      this.sim.events.emit('buildingAdded', b);
      this.sim.events.emit('treesChanged', { x0: x, z0: z, x1: x + w, z1: z + d });
    }
    return { ok: true, cost, affected: 1, cells };
  }

  terraform(kind: TerraformKind, cx: number, cz: number, radius: number, strength: number, preview = false): ActionResult {
    const st = this.st;
    const N = st.size, N1 = N + 1;
    const r = Math.max(1, radius);
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N, Math.ceil(cx + r + 1));
    const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(N, Math.ceil(cz + r + 1));
    const cost = Math.round(Math.PI * r * r * 2 * strength);
    if (!this.afford(cost)) return { ok: false, cost, reason: 'Not enough money' };
    if (preview) return { ok: true, cost };
    const target = st.cornerHeight(Math.round(cx), Math.round(cz));
    const H = st.heights;
    const src = H.slice();
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const dd = Math.hypot(x - cx, z - cz);
        if (dd > r) continue;
        const f = Math.cos((dd / r) * Math.PI * 0.5) * strength;
        const i = z * N1 + x;
        if (kind === 'raise') H[i] += f * 2;
        else if (kind === 'lower') H[i] -= f * 2;
        else if (kind === 'level') H[i] += (target - H[i]) * Math.min(1, f);
        else {
          let s = 0, n = 0;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, zz = z + dz;
            if (xx < 0 || zz < 0 || xx > N || zz > N) continue;
            s += src[zz * N1 + xx]; n++;
          }
          H[i] += (s / n - H[i]) * Math.min(1, f);
        }
      }
    computeWater(st, Math.max(0, x0 - 1), Math.max(0, z0 - 1), Math.min(N, x1 + 1), Math.min(N, z1 + 1));
    this.spend(cost, 'terraform');
    this.sim.events.emit('terrainChanged', { x0, z0, x1, z1 });
    return { ok: true, cost };
  }

  plantTrees(rect: CellRect, preview = false): ActionResult {
    const st = this.st;
    let n = 0;
    for (let z = Math.max(0, rect.z0); z < Math.min(st.size, rect.z1); z++)
      for (let x = Math.max(0, rect.x0); x < Math.min(st.size, rect.x1); x++) {
        const i = st.idx(x, z);
        if (st.water[i] || st.network[i] || st.building[i] >= 0 || st.trees[i] >= 4) continue;
        n++;
        if (!preview) st.trees[i] = Math.min(4, st.trees[i] + 2);
      }
    const cost = n * 3;
    if (!n) return { ok: false, cost: 0, reason: 'No room for trees' };
    if (!this.afford(cost)) return { ok: false, cost, reason: 'Not enough money' };
    if (!preview) {
      this.spend(cost, 'trees');
      this.sim.events.emit('treesChanged', rect);
    }
    return { ok: true, cost, affected: n };
  }

  setTax(dev: DevType, ratePercent: number): void {
    this.st.budget.taxRates[dev] = Math.max(0, Math.min(20, ratePercent));
  }
  setFunding(service: ServiceKind, percent: number): void {
    this.st.budget.funding[service] = Math.max(0, Math.min(150, percent));
  }
  setOrdinance(id: string, enabled: boolean): ActionResult {
    const o = this.st.budget.ordinances;
    const i = o.indexOf(id);
    if (enabled && i < 0) o.push(id);
    if (!enabled && i >= 0) o.splice(i, 1);
    return { ok: true, cost: 0 };
  }
  takeLoan(amount: number): ActionResult {
    const st = this.st;
    if (st.budget.loans.length >= 5) return { ok: false, cost: 0, reason: 'Too many outstanding loans' };
    const rate = 0.06, months = 120;
    const mr = rate / 12;
    const pay = (amount * mr) / (1 - Math.pow(1 + mr, -months));
    st.budget.loans.push({ principal: amount, remaining: amount, rate, monthlyPayment: Math.round(pay), monthsLeft: months });
    st.funds += amount;
    return { ok: true, cost: -amount };
  }
  repayLoan(index: number): ActionResult {
    const st = this.st;
    const l = st.budget.loans[index];
    if (!l) return { ok: false, cost: 0, reason: 'No such loan' };
    if (st.funds < l.remaining) return { ok: false, cost: l.remaining, reason: 'Not enough money' };
    st.funds -= l.remaining;
    st.budget.loans.splice(index, 1);
    return { ok: true, cost: l.remaining };
  }
  toggleHistoric(buildingId: number): void {
    const b = this.st.buildings.get(buildingId);
    if (!b) return;
    b.flags ^= BF.Historic;
    this.sim.events.emit('buildingChanged', b);
  }
}
