/**
 * SIMBOT — scripted "competent mayor" for balance testing (owned by sim-core).
 *
 *   npx tsx tools/simbot.ts [--size 256] [--years 60] [--seed 7] [--difficulty medium] [--terrain plains]
 *                           [--water 0.2] [--quiet] [--no-infra]
 *
 * Plays through CityActions only (like the UI): lays out a 9-cell road grid (avenues every 4th line) with a
 * trunk line edge-to-edge (upgraded to a highway later), sectors (commercial core, industrial park east of the
 * center along the trunk, residential rings, 1-in-9 civic/park blocks, utility blocks, a landfill block),
 * develops blocks as demand calls for them, places power / water / garbage by capacity, services by coverage,
 * parks / airports / freight / connections when demand caps bind, rezones to medium / high density as the city
 * grows, builds rewards and landmarks, manages taxes and takes a loan early if needed.
 * Prints a yearly table (population, funds, income/expense, demand, EQ, commute, timings).
 */
import { createCityState } from '../src/sim/terrainGen';
import { defaultCityConfig, type CityConfigData } from '../src/sim/config';
import { Simulation, type SimSystem } from '../src/sim/Simulation';
import { economySystems, economyRuntime } from '../src/sim/systems/economy';
import { CityActions, lPath, type ActionResult } from '../src/sim/actions';
import { DevType, Network, Zone, type Difficulty, type TerrainPreset } from '../src/core/types';
import { getDef, rotatedFootprint } from '../src/sim/catalog';
import { econData, type EconRuntime } from '../src/sim/economy/runtime';
import { BF, type CityState } from '../src/sim/CityState';
import { maxLoanAmount } from '../src/sim/economy/loans';
import { listRewards } from '../src/sim/economy/rewards';

export interface BotOptions {
  size: number;
  years: number;
  seed: number;
  difficulty: Difficulty;
  terrain: TerrainPreset;
  water: number;
  quiet: boolean;
  /** run without sim-infra systems (economy only) */
  noInfra: boolean;
}

export interface YearRow {
  year: number;
  pop: number;
  funds: number;
  income: number;
  expense: number;
  dR: number;
  dC: number;
  dI: number;
  eq: number;
  commute: number;
  buildings: number;
  jobs: number;
  unemployment: number;
  approval: number;
  econMsPerDay: number;
  totalMsPerDay: number;
  maxStage: number;
  /** pop-weighted traffic job access (-1 = n/a) */
  access: number;
}

type Use = 'R' | 'C' | 'I' | 'P' | 'U' | 'X' | 'A';
interface Block {
  bx: number;
  bz: number;
  use: Use;
  /** interior rect (inclusive min, exclusive max) */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  developed: boolean;
  zone: Zone;
  ring: number;
}

const GRID = 9;

export class SimBot {
  sim: Simulation;
  st: CityState;
  A: CityActions;
  N: number;
  off: number;
  nb: number;
  cbx: number;
  cbz: number;
  blocks: Block[] = [];
  byKey = new Map<string, Block>();
  segs = new Set<string>();
  log: string[] = [];
  services: { def: string; x: number; z: number }[] = [];
  econTime = 0;
  totalTime = 0;
  /** accumulated ms per system name (daily + monthly + yearly) */
  bySystem: Record<string, number> = {};
  days = 0;
  trunkZ: number;
  highway = false;
  rows: YearRow[] = [];
  private quiet: boolean;
  rt: EconRuntime | undefined;

  constructor(opts: BotOptions, systems: SimSystem[] = economySystems()) {
    const cfg: CityConfigData = defaultCityConfig({
      size: opts.size, seed: opts.seed, difficulty: opts.difficulty, terrain: opts.terrain, waterAmount: opts.water,
      hilliness: 0.25, treeDensity: 0.35, name: 'Botville', mayor: 'Bot', disasters: false,
    });
    this.quiet = opts.quiet;
    this.st = createCityState(cfg);
    void opts.noInfra;
    this.wrapTimers(systems);
    this.sim = new Simulation(this.st, systems);
    this.A = new CityActions(this.sim);
    this.rt = economyRuntime(systems);
    this.N = this.st.size;
    const N = this.N;
    // lines at off + k*GRID; center line through the middle
    const mid = N >> 1;
    this.off = mid % GRID;
    this.nb = Math.floor((N - 1 - this.off) / GRID);
    this.cbx = Math.floor((mid - this.off) / GRID);
    this.cbz = this.cbx;
    this.trunkZ = this.line(this.cbz);
    for (let bz = 0; bz < this.nb; bz++) {
      for (let bx = 0; bx < this.nb; bx++) {
        const b: Block = {
          bx, bz, use: this.landUse(bx, bz), x0: this.line(bx) + 1, z0: this.line(bz) + 1, x1: this.line(bx + 1), z1: this.line(bz + 1),
          developed: false, zone: Zone.None, ring: Math.max(Math.abs(bx - this.cbx + 0.5), Math.abs(bz - this.cbz + 0.5)),
        };
        if (b.x1 > N - 1 || b.z1 > N - 1) continue;
        this.blocks.push(b);
        this.byKey.set(bx + ',' + bz, b);
      }
    }
  }

  line(k: number): number {
    return this.off + k * GRID;
  }

  private wrapTimers(systems: SimSystem[]): void {
    for (const s of systems) {
      const econ = s.name.startsWith('economy.');
      for (const k of ['daily', 'monthly', 'yearly'] as const) {
        const fn = s[k];
        if (!fn) continue;
        s[k] = (sim: Simulation) => {
          const t0 = cpuMs();
          fn.call(s, sim);
          const dt = cpuMs() - t0;
          this.totalTime += dt;
          if (econ) this.econTime += dt;
          this.bySystem[s.name] = (this.bySystem[s.name] ?? 0) + dt;
        };
      }
    }
  }

  /** land use plan by block offset from the center block */
  landUse(bx: number, bz: number): Use {
    const dx = bx - this.cbx, dz = bz - this.cbz;
    const far = Math.floor(this.nb / 2) - 1;
    if (dx === far && dz === 4) return 'X';
    if ((dx === 3 && (dz === 1 || dz === -1)) || (dx === -3 && dz === -3)) return 'U';
    if ((dx === -5 || dx === -4) && dz === 5) return 'A';
    if ((bx % 3 === 1 && bz % 3 === 1)) return 'P';
    if (dx >= 4 && Math.abs(dz) <= 3) return 'I';
    if (dx >= 4 && Math.abs(dz) <= 5 && dx >= 7) return 'I';
    if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) return 'C';
    if (((dx * 7 + dz * 3) % 6 + 6) % 6 === 0 && Math.max(Math.abs(dx), Math.abs(dz)) <= 8) return 'C';
    return 'R';
  }

  say(msg: string): void {
    const line = `[${this.st.dateLabel()}] ${msg}`;
    this.log.push(line);
    if (!this.quiet && process.env.SIMBOT_VERBOSE) console.log(line);
  }

  // ------------------------------------------------------------------------------------------ helpers
  get funds(): number {
    return this.st.funds;
  }
  monthlyNet(): number {
    let i = 0, e = 0;
    for (const k in this.st.budget.lastIncome) if (!k.startsWith('oneoff:')) i += this.st.budget.lastIncome[k];
    for (const k in this.st.budget.lastExpense) if (!k.startsWith('oneoff:')) e += this.st.budget.lastExpense[k];
    return i - e;
  }
  reserve(): number {
    let e = 0;
    for (const k in this.st.budget.lastExpense) if (!k.startsWith('oneoff:')) e += this.st.budget.lastExpense[k];
    return 4000 + e * 1.5;
  }
  canSpend(cost: number): boolean {
    return this.funds - cost > this.reserve();
  }

  road(x0: number, z0: number, x1: number, z1: number, type: Network): boolean {
    const key = `${x0},${z0},${x1},${z1}`;
    if (this.segs.has(key)) return true;
    const r = this.A.buildNetwork(lPath({ x: x0, z: z0 }, { x: x1, z: z1 }), type);
    if (r.ok) { this.segs.add(key); return true; }
    // try a street / road fallback for steep bits
    if (type !== Network.Road) {
      const r2 = this.A.buildNetwork(lPath({ x: x0, z: z0 }, { x: x1, z: z1 }), Network.Road);
      if (r2.ok) { this.segs.add(key); return true; }
    }
    return false;
  }

  lineType(k: number, vertical: boolean): Network {
    if (!vertical && this.line(k) === this.trunkZ) return this.highway ? Network.Highway : Network.Avenue;
    return k % 4 === 0 ? Network.Avenue : Network.Road;
  }

  buildBlockRoads(b: Block): void {
    const xa = this.line(b.bx), xb = this.line(b.bx + 1), za = this.line(b.bz), zb = this.line(b.bz + 1);
    this.road(xa, za, xb, za, this.lineType(b.bz, false));
    this.road(xa, zb, xb, zb, this.lineType(b.bz + 1, false));
    this.road(xa, za, xa, zb, this.lineType(b.bx, true));
    this.road(xb, za, xb, zb, this.lineType(b.bx + 1, true));
  }

  zoneFor(b: Block): Zone {
    const pop = this.st.stats.population;
    const eq = this.st.stats.eq;
    if (b.use === 'R') {
      if (pop > 60000 && b.ring <= 4) return Zone.ResHigh;
      if (pop > 150000 && b.ring <= 7) return Zone.ResHigh;
      if (pop > 5000) return Zone.ResMed;
      return Zone.ResLow;
    }
    if (b.use === 'C') {
      if (pop > 25000 && b.ring <= 2) return Zone.ComHigh;
      if (pop > 100000) return Zone.ComHigh;
      if (pop > 3000) return Zone.ComMed;
      return Zone.ComLow;
    }
    if (b.use === 'I') {
      const d = this.st.stats.demand;
      // follow sub-type demand: high-tech / manufacturing → high density, dirty / manufacturing → medium
      return d[DevType.IHT] > 0.25 && d[DevType.IHT] >= d[DevType.ID] && (eq > 70 || pop > 20000) ? Zone.IndHigh : Zone.IndMed;
    }
    if (b.use === 'X') return Zone.Landfill;
    return Zone.None;
  }

  develop(b: Block, zone?: Zone): boolean {
    const z = zone ?? this.zoneFor(b);
    this.buildBlockRoads(b);
    if (z !== Zone.None) {
      const r = this.A.zone({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }, z);
      if (!r.ok) return false;
      b.zone = z;
    }
    b.developed = true;
    return true;
  }

  /** next undeveloped block of a use, nearest to the center (industry: nearest to the existing industry) */
  nextBlock(use: Use): Block | undefined {
    let best: Block | undefined, bd = Infinity;
    for (const b of this.blocks) {
      if (b.developed || b.use !== use) continue;
      // must touch the developed area (or be adjacent to the trunk) to keep roads contiguous
      // compact growth: strongly prefer blocks touching the developed area (industry may start a new cluster once)
      const d = b.ring + (this.touchesDeveloped(b) ? 0 : use === 'I' && !this.blocks.some((o) => o.developed && o.use === 'I') ? 2 : 50);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  touchesDeveloped(b: Block): boolean {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const o = this.byKey.get(b.bx + dx + ',' + (b.bz + dz));
      if (o?.developed) return true;
    }
    return false;
  }

  /** find a spot for a ploppable inside blocks of the given uses near (nx,nz). Returns result or null. */
  placeNear(defId: string, nx: number, nz: number, uses: Use[], developOk = true, maxDist = Infinity): ActionResult | null {
    const def = getDef(defId);
    if (!def) return null;
    const dist = (b: Block) => Math.hypot((b.x0 + b.x1) / 2 - nx, (b.z0 + b.z1) / 2 - nz);
    const cand = this.blocks.filter((b) => uses.includes(b.use) && (b.developed || developOk) && dist(b) <= maxDist)
      .sort((a, b) => dist(a) - dist(b));
    for (const b of cand.slice(0, 14)) {
      for (const rot of [0, 1, 2, 3] as const) {
        const [w, d] = rotatedFootprint(def, rot);
        if (w > b.x1 - b.x0 || d > b.z1 - b.z0) continue;
        // candidate origins: edges of the block so the lot touches a road
        const xs = [b.x0, b.x1 - w, b.x0 + ((b.x1 - b.x0 - w) >> 1)];
        const zs = [b.z0, b.z1 - d, b.z0 + ((b.z1 - b.z0 - d) >> 1)];
        for (const z of zs) {
          for (const x of xs) {
            const p = this.A.plop(defId, x, z, rot, true);
            if (!p.ok) continue;
            if (!b.developed) { this.buildBlockRoads(b); b.developed = true; }
            const r = this.A.plop(defId, x, z, rot);
            if (r.ok) {
              this.services.push({ def: defId, x: x + (w >> 1), z: z + (d >> 1) });
              this.say(`built ${def.name} ($${r.cost})`);
              return r;
            }
          }
        }
      }
    }
    return null;
  }

  count(defId: string): number {
    return this.st.milestones[defId] ?? 0;
  }

  // ------------------------------------------------------------------------------------------ setup
  setup(): void {
    const N = this.N;
    // trunk: avenue edge to edge through the center (highway later)
    this.A.buildNetwork(lPath({ x: 0, z: this.trunkZ }, { x: N - 1, z: this.trunkZ }), Network.Avenue);
    // initial blocks: 4 residential, 2 commercial, 2 industrial nearest to the center
    for (const [use, n] of [['R', 4], ['C', 2], ['I', 2]] as [Use, number][]) {
      for (let k = 0; k < n; k++) { const b = this.nextBlock(use); if (b) this.develop(b); }
    }
    this.ensurePower();
    this.ensureWater();
  }

  // ------------------------------------------------------------------------------------------ monthly brain
  monthly(): void {
    const st = this.st, s = st.stats;
    const pop = s.population;
    this.finance();
    this.ensurePower();
    this.ensureWater();
    this.ensureGarbage();
    this.ensureServices();
    this.zoning();
    this.caps();
    this.rewards();
    this.density();
    this.ordinances();
    if (!this.highway && pop > 12000 && this.canSpend(30000)) {
      const r = this.A.buildNetwork(lPath({ x: 0, z: this.trunkZ }, { x: this.N - 1, z: this.trunkZ }), Network.Highway);
      if (r.ok) { this.highway = true; this.say(`trunk upgraded to highway ($${Math.round(r.cost)})`); }
    }
  }

  finance(): void {
    const st = this.st;
    const net = this.monthlyNet();
    // early loan to get going
    if (st.funds < 12000 && st.budget.loans.length === 0 && st.day < 360 * 6) {
      const amt = Math.min(maxLoanAmount(st), 60000);
      if (amt >= 5000 && this.A.takeLoan(amt).ok) this.say(`took a loan of $${amt}`);
    }
    if (st.funds < 0 && st.budget.loans.length < 3) {
      const amt = Math.min(maxLoanAmount(st), 100000);
      if (amt >= 5000 && this.A.takeLoan(amt).ok) this.say(`emergency loan $${amt}`);
    }
    // taxes: 9% baseline; +1 when losing money and low on funds, −1 when rich
    const cur = st.budget.taxRates[0];
    let t = cur;
    if (net < 0 && st.funds < 30000) t = Math.min(11, cur + 0.5);
    else if (net > 0 && st.funds > 400000 + st.stats.population * 2) t = Math.max(7, cur - 0.5);
    else if (st.funds > 60000 && cur > 9) t = cur - 0.5;
    if (t !== cur) for (let d = 0; d < 12; d++) this.A.setTax(d as DevType, t);
  }

  ensurePower(): void {
    const s = this.st.stats;
    const need = Math.max(s.powerDemand, 1);
    if (s.powerSupply > 0 && need < s.powerSupply * 0.75) return;
    const cx = this.line(this.cbx) + 3 * GRID, cz = this.trunkZ;
    let def = 'util_wind_turbine';
    if (need > 12) def = this.st.unlocked.has('nuclear_power') && need > 900 ? 'util_nuclear_plant' : need > 150 ? 'util_coal_plant' : 'util_gas_plant';
    const cost = getDef(def)?.cost ?? 0;
    if (!this.canSpend(cost) && this.funds < cost + 2000) return;
    const n = def === 'util_wind_turbine' ? 3 : 1;
    for (let k = 0; k < n; k++) if (!this.placeNear(def, cx, cz, ['U', 'I'])) break;
  }

  ensureWater(): void {
    const s = this.st.stats;
    if (s.population < 300 && s.waterSupply > 0) return;
    if (s.waterSupply > 0 && s.waterDemand < s.waterSupply * 0.75) return;
    const big = this.st.unlocked.has('water_treatment') && s.waterDemand > 20000;
    const def = big ? 'util_water_treatment' : 'util_water_pump';
    const cost = getDef(def)?.cost ?? 0;
    if (!this.canSpend(cost)) return;
    const n = big ? 1 : 2;
    const cx = this.line(this.cbx), cz = this.line(this.cbz);
    for (let k = 0; k < n; k++) if (!this.placeNear(def, cx, cz, big ? ['U', 'P'] : ['P', 'U'])) break;
  }

  ensureGarbage(): void {
    const s = this.st.stats;
    if (s.population < 2500) return;
    if (s.garbageProduced < s.garbageCapacity * 0.8) return;
    const x = this.blocks.find((b) => b.use === 'X' && !b.developed);
    if (x && this.canSpend(2000)) { this.develop(x, Zone.Landfill); this.say('zoned landfill'); return; }
    const def = this.st.unlocked.has('incinerator') ? 'util_incinerator' : this.st.unlocked.has('recycling_center') ? 'util_recycling_center' : null;
    if (def && this.canSpend(getDef(def)!.cost!)) this.placeNear(def, this.line(this.cbx) + 4 * GRID, this.trunkZ, ['U', 'I']);
  }

  /** coverage-driven services (coverage of R/C blocks + capacity), with a retry cooldown per def */
  private svcRetry = new Map<string, number>();
  ensureServices(): void {
    const pop = this.st.stats.population;
    const plan: [string, number, number, number][] = [
      // def, min pop, coverage radius (0 = capacity only), residents per building (capacity; 0 = coverage only)
      ['civ_fire_station', 1200, 24, 0],
      ['civ_police_station', 2000, 26, 0],
      ['civ_elementary_school', 2500, 0, 12000],
      ['civ_clinic', 3500, 0, 8000],
      ['civ_high_school', 9000, 0, 30000],
      ['civ_library', 12000, 0, 30000],
      ['civ_hospital', 18000, 0, 40000],
    ];
    if (this.st.unlocked.has('college')) plan.push(['civ_college', 40000, 0, 80000]);
    let spent = 0;
    for (const [def, minPop, radius, cap] of plan) {
      if (pop < minPop || spent >= 2) continue;
      if ((this.svcRetry.get(def) ?? -1) > this.st.day) continue;
      const cost = getDef(def)?.cost ?? 0;
      if (!this.canSpend(cost)) continue;
      const mine = this.services.filter((s) => s.def === def);
      const u = radius > 0 ? this.uncovered(def, radius) : null;
      const needCap = cap > 0 && mine.length * cap < pop * 1.02;
      if (!u && !needCap) continue;
      // capacity buildings go to the most populous area without one nearby
      const tgt = u ?? this.popCenterWithout(def, cap > 30000 ? 36 : 20);
      const reach = radius > 0 ? radius * 0.8 : 30;
      // prefer civic blocks within reach, else any free spot in developed blocks within reach
      const ok = this.placeNear(def, tgt.x, tgt.z, ['P'], true, reach) ?? this.placeNear(def, tgt.x, tgt.z, ['R', 'C', 'I'], false, reach * 0.7);
      if (ok) spent++;
      else this.svcRetry.set(def, this.st.day + 180);
    }
  }

  /** center of the most populated developed block with no `def` within `r` cells */
  popCenterWithout(def: string, r: number): { x: number; z: number } {
    const mine = this.services.filter((s) => s.def === def);
    const st = this.st, N = this.N;
    let best = { x: this.line(this.cbx), z: this.line(this.cbz) }, bp = -1;
    for (const b of this.blocks) {
      if (!b.developed || b.use !== 'R') continue;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      if (mine.some((s) => Math.hypot(s.x - cx, s.z - cz) < r)) continue;
      let p = 0;
      for (let z = b.z0; z < b.z1; z += 2) for (let x = b.x0; x < b.x1; x += 2) { const bb = st.buildingAt(x, z); if (bb) p += bb.pop; }
      if (p > bp) { bp = p; best = { x: cx, z: cz }; }
    }
    void N;
    return best;
  }

  /** center of a developed R/C block not covered by any `def` within radius × 0.85, nearest to the center first */
  uncovered(def: string, radius: number): { x: number; z: number } | null {
    const mine = this.services.filter((s) => s.def === def || (def === 'civ_police_station' && s.def === 'civ_police_hq') || (def === 'civ_fire_station' && s.def === 'civ_fire_hq'));
    let best: { x: number; z: number } | null = null, bd = Infinity;
    for (const b of this.blocks) {
      if (!b.developed || (b.use !== 'R' && b.use !== 'C' && !(b.use === 'I' && def === 'civ_fire_station'))) continue;
      if (b.zone === Zone.None) continue;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      let ok = false;
      for (const s of mine) if (Math.hypot(s.x - cx, s.z - cz) <= radius * 0.85) { ok = true; break; }
      if (ok) continue;
      if (b.ring < bd) { bd = b.ring; best = { x: cx, z: cz }; }
    }
    return best;
  }

  zoning(): void {
    const st = this.st, s = st.stats;
    const d = s.demand;
    const fam = (a: number, b: number) => { let m = -1; for (let k = a; k <= b; k++) m = Math.max(m, d[k]); return m; };
    // room = empty zoned cells with road frontage (deep interior cells only fill via redevelopment)
    const emptyOf = (zs: Zone[]) => {
      let n = 0;
      const N = this.N, net = st.network;
      const road = (i: number) => net[i] >= Network.Street && net[i] <= Network.Highway;
      for (const b of this.blocks) {
        if (!b.developed || !zs.includes(b.zone)) continue;
        for (let z = b.z0; z < b.z1; z++) for (let x = b.x0; x < b.x1; x++) {
          const i = z * N + x;
          if (st.building[i] >= 0 || st.zone[i] === Zone.None) continue;
          if (road(i - 1) || road(i + 1) || road(i - N) || road(i + N)) n++;
        }
      }
      return n;
    };
    const pop = s.population;
    const growthCells = 16 + pop / 400;
    const wants: [Use, number, Zone[]][] = [
      ['R', fam(0, 2), [Zone.ResLow, Zone.ResMed, Zone.ResHigh]],
      ['C', fam(3, 7), [Zone.ComLow, Zone.ComMed, Zone.ComHigh]],
      ['I', fam(8, 11), [Zone.IndMed, Zone.IndHigh, Zone.IndAg]],
    ];
    for (const [use, dem, zs] of wants) {
      if (dem < 0.1) continue;
      const empty = emptyOf(zs);
      let blocks = empty < growthCells * (use === 'R' ? 1 : 0.6) ? (dem > 0.5 && pop > 20000 ? 2 : 1) : 0;
      while (blocks-- > 0) {
        const b = this.nextBlock(use);
        if (!b) break;
        if (!this.canSpend(2500)) break;
        this.develop(b);
        this.say(`developed ${use} block (${b.bx},${b.bz}) as zone ${b.zone}`);
      }
    }
    // sub-type specific: high-tech industry needs IndHigh room, farms need IndAg land
    if (d[DevType.IHT] > 0.35 && emptyOf([Zone.IndHigh]) < growthCells * 0.3 && this.canSpend(3000)) {
      const b = this.nextBlock('I');
      if (b) { this.develop(b, Zone.IndHigh); this.say(`developed high-tech block (${b.bx},${b.bz})`); }
    }
    const farms = this.blocks.filter((b) => b.zone === Zone.IndAg).length;
    if (d[DevType.IA] > 0.4 && emptyOf([Zone.IndAg]) < 8 && farms < 1 + pop / 80000 && this.canSpend(2000)) {
      const outer = this.blocks.filter((b) => !b.developed && b.use === 'R' && this.touchesDeveloped(b)).sort((a, b) => b.ring - a.ring)[0];
      if (outer) { outer.use = 'I'; this.develop(outer, Zone.IndAg); this.say(`developed farm block (${outer.bx},${outer.bz})`); }
    }
  }

  /** demand caps: parks for R, airport / landmarks for C, freight / connections / seaport for I */
  caps(): void {
    const st = this.st;
    const data = econData(st);
    const binding = (a: number, b: number) => { for (let k = a; k <= b; k++) if (data.capBinding[k] && st.stats.demand[k] > -0.2) return true; return false; };
    const center = { x: this.line(this.cbx), z: this.line(this.cbz) };
    const pop = st.stats.population;
    // parks: always some, more when R capped
    const parksWanted = 2 + pop / 6000;
    const parks = this.services.filter((s) => s.def.startsWith('park_')).length;
    if (binding(0, 2) || parks < parksWanted) {
      const big = this.canSpend(3000) && pop > 4000;
      const def = st.unlocked.has('zoo') && this.count('park_zoo') < 1 + Math.floor(pop / 300000) && this.canSpend(20000) ? 'park_zoo'
        : big ? 'park_large' : pop > 1500 ? 'park_plaza' : 'park_small';
      const target = this.uncovered('park_large', 18) ?? center;
      if (this.canSpend(getDef(def)!.cost!)) this.placeNear(def, target.x, target.z, ['P']);
    }
    // commercial caps
    if (binding(3, 7)) {
      if (st.unlocked.has('airport_small') && this.count('tr_airport_small') === 0 && this.canSpend(30000)) this.placeAirport('tr_airport_small');
      else if (st.unlocked.has('airport_large') && this.count('tr_airport_large') < 1 + Math.floor(pop / 500000) && this.canSpend(150000)) this.placeAirport('tr_airport_large');
    }
    // industrial caps
    if (binding(8, 11)) {
      if (this.count('tr_freight_station') < 1 + Math.floor(pop / 150000) && this.canSpend(5000 + 30 * this.N)) this.freightRail();
      else if (st.unlocked.has('seaport') && this.count('tr_seaport') === 0 && this.canSpend(60000)) this.placeShore('tr_seaport');
      else this.extraConnection();
    }
  }

  private railBuilt = false;
  freightRail(): void {
    const st = this.st;
    const N = this.N;
    if (!this.railBuilt) {
      // rail inside the industrial blocks just south of the trunk, from the industry to the east edge
      const z = this.trunkZ + 5;
      const x0 = this.line(this.cbx + 4) + 1;
      const r = this.A.buildNetwork(lPath({ x: x0, z }, { x: N - 1, z }), Network.Rail);
      if (r.ok) { this.railBuilt = true; this.say(`built freight rail ($${Math.round(r.cost)})`); }
      else { this.say(`rail failed: ${r.reason}`); this.railBuilt = true; }
    }
    // freight station next to the rail (station platforms at the back: rot 0 → back is -Z... use preview search)
    const z = this.trunkZ + 5;
    for (let x = this.line(this.cbx + 4) + 1; x < N - 6; x++) {
      for (const [zz, rot] of [[z + 1, 2], [z - 2, 0]] as [number, 0 | 2][]) {
        const p = this.A.plop('tr_freight_station', x, zz, rot, true);
        if (p.ok && !p.reason) { this.A.plop('tr_freight_station', x, zz, rot); this.say('built freight station'); return; }
      }
    }
    void st;
  }

  private connections = 0;
  extraConnection(): void {
    if (this.connections >= 4 || !this.canSpend(12000)) return;
    const N = this.N;
    const k = this.connections++;
    // avenues from the center to N / S edges, then a second highway
    const x = this.line(this.cbx + (k % 2 === 0 ? -2 : 2));
    const r = k < 2 ? this.A.buildNetwork(lPath({ x, z: 0 }, { x, z: N - 1 }), Network.Avenue)
      : this.A.buildNetwork(lPath({ x: this.line(this.cbx + (k === 2 ? 1 : -1)), z: 0 }, { x: this.line(this.cbx + (k === 2 ? 1 : -1)), z: N - 1 }), Network.Road);
    this.say(`extra connection ${k}: ${r.ok ? 'ok' : r.reason}`);
  }

  placeAirport(defId: string): void {
    const blocks = this.blocks.filter((b) => b.use === 'A');
    if (!blocks.length) return;
    const xs = Math.min(...blocks.map((b) => b.x0)), xe = Math.max(...blocks.map((b) => b.x1));
    const zs = Math.min(...blocks.map((b) => b.z0)), ze = Math.max(...blocks.map((b) => b.z1));
    // roads around the merged area (no line in between)
    this.road(xs - 1, zs - 1, xe, zs - 1, Network.Road);
    this.road(xs - 1, ze, xe, ze, Network.Road);
    this.road(xs - 1, zs - 1, xs - 1, ze, Network.Road);
    this.road(xe, zs - 1, xe, ze, Network.Road);
    for (const b of blocks) b.developed = true;
    const def = getDef(defId)!;
    for (const rot of [0, 2, 1, 3] as const) {
      const [w, d] = rotatedFootprint(def, rot);
      for (let z = zs; z + d <= ze; z++) for (let x = xs; x + w <= xe; x++) {
        const p = this.A.plop(defId, x, z, rot, true);
        if (p.ok && !p.reason) { this.A.plop(defId, x, z, rot); this.say(`built ${def.name}`); return; }
      }
    }
    this.say(`no room for ${def.name}`);
  }

  placeShore(defId: string): boolean {
    const st = this.st, N = this.N;
    const def = getDef(defId)!;
    const cx = N >> 1;
    let best: [number, number, 0 | 1 | 2 | 3] | null = null, bd = Infinity;
    for (let z = 2; z < N - 8; z += 1) {
      for (let x = 2; x < N - 8; x += 1) {
        if (!st.water[z * N + x]) continue;
        const d = Math.hypot(x - cx, z - cx);
        if (d > bd) continue;
        for (const rot of [0, 1, 2, 3] as const) {
          const [w, dd] = rotatedFootprint(def, rot);
          const ox = rot === 1 ? x - w : rot === 3 ? x + 1 : x - (w >> 1);
          const oz = rot === 0 ? z - dd : rot === 2 ? z + 1 : z - (dd >> 1);
          const p = this.A.plop(defId, ox, oz, rot, true);
          if (p.ok && !p.reason && d < bd) { bd = d; best = [ox, oz, rot]; }
        }
      }
    }
    if (!best) return false;
    const r = this.A.plop(defId, best[0], best[1], best[2]);
    if (r.ok) this.say(`built ${def.name} at ${best[0]},${best[1]}`);
    return r.ok;
  }

  rewards(): void {
    const st = this.st;
    const center = { x: this.line(this.cbx), z: this.line(this.cbz) };
    const skip = new Set(['toxic_dump', 'casino', 'airport_large', 'seaport', 'military_base', 'missile_range']);
    for (const r of listRewards(st)) {
      if (!r.unlocked || r.built || skip.has(r.id) || (r.kind !== 'reward' && r.kind !== 'landmark')) continue;
      for (const defId of r.defIds) {
        const def = getDef(defId);
        if (!def || !def.unique) continue;
        if (!this.canSpend((def.cost ?? 0) * 1.5)) continue;
        if (def.placement === 'shore') { this.placeShore(defId); continue; }
        this.placeNear(defId, center.x, center.z, ['P']);
      }
    }
    // business deals: take the military base far from the center
    for (const id of ['rw_military_base', 'rw_missile_range']) {
      const def = getDef(id)!;
      if (!st.unlocked.has(def.requires!) || this.count(id) > 0) continue;
      const far = this.blocks.filter((b) => !b.developed && b.use === 'R' && b.ring >= this.nb / 2 - 2).sort((a, b) => b.ring - a.ring)[0];
      if (far) {
        this.buildBlockRoads(far);
        const r = this.A.plop(id, far.x0, far.z0, 0);
        far.developed = true;
        if (r.ok) this.say(`accepted deal: ${def.name}`);
      }
    }
  }

  density(): void {
    const st = this.st, s = st.stats;
    const pop = s.population;
    let n = 0;
    const R = Math.max(s.demand[0], s.demand[1], s.demand[2]);
    const C = Math.max(s.demand[3], s.demand[4], s.demand[5], s.demand[6], s.demand[7]);
    const cand = this.blocks.filter((b) => b.developed).sort((a, b) => a.ring - b.ring);
    for (const b of cand) {
      if (n >= 2) break;
      let target = b.zone;
      if (b.use === 'R' && R > 0.25) {
        if (b.zone === Zone.ResLow && pop > 5000) target = Zone.ResMed;
        else if (b.zone === Zone.ResMed && pop > 50000 && b.ring <= 3 + pop / 60000) target = Zone.ResHigh;
      } else if (b.use === 'C' && C > 0.2) {
        if (b.zone === Zone.ComLow && pop > 3000) target = Zone.ComMed;
        else if (b.zone === Zone.ComMed && pop > 25000 && b.ring <= 2 + pop / 80000) target = Zone.ComHigh;
      } else if (b.use === 'I' && b.zone === Zone.IndMed && s.eq > 100 && pop > 60000 && s.demand[DevType.IHT] > 0.2 && b.ring >= 6) target = Zone.IndHigh;
      if (target === b.zone) continue;
      if (!this.canSpend(1500)) break;
      const r = this.A.zone({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }, target);
      if (r.ok) { b.zone = target; n++; this.say(`rezoned (${b.bx},${b.bz}) to ${target}`); }
    }
  }

  ordinances(): void {
    const st = this.st;
    const pop = st.stats.population;
    const want = pop > 25000 ? ['smoke_detectors', 'rubble_cleanup'] : [];
    if (pop > 50000) want.push('pro_reading', 'neighborhood_watch', 'recycling');
    if (pop > 120000) want.push('free_clinics', 'carpool', 'commuter_shuttle');
    if (this.monthlyNet() < 0) return;
    for (const id of want) if (!st.budget.ordinances.includes(id)) this.A.setOrdinance(id, true);
  }

  // ------------------------------------------------------------------------------------------ run
  run(years: number, onYear?: (row: YearRow) => void): YearRow[] {
    this.setup();
    const st = this.st;
    let e0 = this.econTime, t0 = this.totalTime, d0 = 0;
    for (let y = 0; y < years; y++) {
      for (let m = 0; m < 12; m++) {
        for (let d = 0; d < 30; d++) { this.sim.advanceDay(); this.days++; }
        this.monthly();
      }
      const s = st.stats;
      let inc = 0, exp = 0;
      for (const k in st.budget.lastIncome) if (!k.startsWith('oneoff:')) inc += st.budget.lastIncome[k];
      for (const k in st.budget.lastExpense) if (!k.startsWith('oneoff:')) exp += st.budget.lastExpense[k];
      let jobs = 0;
      for (const j of s.jobsByDev) jobs += j;
      let maxStage = 0;
      for (const b of st.buildings.values()) if (!(b.flags & BF.Plopped)) maxStage = Math.max(maxStage, getDef(b.def)?.stage ?? 0);
      const days = this.days - d0;
      const row: YearRow = {
        year: st.year, pop: s.population, funds: Math.round(st.funds), income: Math.round(inc), expense: Math.round(exp),
        dR: avg(s.demand, 0, 2), dC: avg(s.demand, 3, 7), dI: avg(s.demand, 8, 11), eq: s.eq, commute: s.avgCommute,
        buildings: s.buildingCount, jobs, unemployment: s.unemployment, approval: s.approval,
        econMsPerDay: (this.econTime - e0) / days, totalMsPerDay: (this.totalTime - t0) / days, maxStage, access: this.rt?.accessAvg ?? -1,
      };
      e0 = this.econTime; t0 = this.totalTime; d0 = this.days;
      this.rows.push(row);
      onYear?.(row);
      if (process.env.SIMBOT_BUDGET) {
        const fmt = (o: Record<string, number>) => Object.entries(o).filter(([k]) => !k.startsWith('oneoff:')).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ');
        console.log('   income:', fmt(st.budget.lastIncome));
        console.log('   expense:', fmt(st.budget.lastExpense));
      }
    }
    return this.rows;
  }
}

function avg(a: number[], i0: number, i1: number): number {
  let s = 0;
  for (let i = i0; i <= i1; i++) s += a[i];
  return s / (i1 - i0 + 1);
}

export function formatRow(r: YearRow): string {
  const k = (v: number) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : String(Math.round(v)));
  return [
    String(r.year).padEnd(5), k(r.pop).padStart(7), ('$' + k(r.funds)).padStart(8), ('+' + k(r.income)).padStart(7), ('-' + k(r.expense)).padStart(7),
    r.dR.toFixed(2).padStart(6), r.dC.toFixed(2).padStart(6), r.dI.toFixed(2).padStart(6), r.eq.toFixed(0).padStart(4), r.commute.toFixed(0).padStart(4),
    k(r.buildings).padStart(6), k(r.jobs).padStart(7), (r.unemployment * 100).toFixed(0).padStart(4) + '%', r.approval.toFixed(0).padStart(4),
    String(r.maxStage).padStart(3), r.access.toFixed(2).padStart(5), r.econMsPerDay.toFixed(2).padStart(6), r.totalMsPerDay.toFixed(1).padStart(7),
  ].join(' ');
}
export const HEADER = 'year      pop    funds  income expense   dR     dC     dI    EQ  com   bldg    jobs unem appr stg   acc econms totalms';

function parseArgs(argv: string[]): BotOptions {
  const o: BotOptions = { size: 256, years: 60, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: false, noInfra: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--size') { o.size = +v; i++; }
    else if (a === '--years') { o.years = +v; i++; }
    else if (a === '--seed') { o.seed = +v; i++; }
    else if (a === '--difficulty') { o.difficulty = v as Difficulty; i++; }
    else if (a === '--terrain') { o.terrain = v as TerrainPreset; i++; }
    else if (a === '--water') { o.water = +v; i++; }
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--no-infra') o.noInfra = true;
  }
  return o;
}

if (process.argv[1]?.includes('simbot')) {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`SIMBOT size=${opts.size} years=${opts.years} seed=${opts.seed} ${opts.difficulty} ${opts.terrain}${opts.noInfra ? ' (no infra)' : ''}`);
  const systems = opts.noInfra ? economySystems() : (await import("../src/sim/systems/index")).createSystems();
  const bot = new SimBot(opts, systems);
  console.log(HEADER);
  const t0 = performance.now();
  bot.run(opts.years, (r) => console.log(formatRow(r)));
  const st = bot.st;
  console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s; loans ${st.budget.loans.length}; unlocked ${st.unlocked.size}; approval ${st.stats.approval.toFixed(0)}`);
  console.log('ms/day by system (whole run):', Object.entries(bot.bySystem).map(([k, v]) => `${k} ${(v / bot.days).toFixed(3)}`).join(' | '));
  const s = st.stats;
  console.log('residents', s.residents, 'jobs', s.jobsByDev.join(','), 'caps', s.demandCap.join(','));
  console.log('last income', st.budget.lastIncome);
  console.log('last expense', st.budget.lastExpense);
  if (process.env.SIMBOT_LOG) console.log(bot.log.join('\n'));
  else console.log(bot.log.slice(-25).join('\n'));
  console.log('news:', st.news.slice(-12).map((n) => n.text).join('\n  '));
}

/** systems for a bot run: full (infra + economy) or economy only; infra is imported lazily */
export async function botSystems(noInfra: boolean): Promise<SimSystem[]> {
  return noInfra ? economySystems() : (await import('../src/sim/systems/index')).createSystems();
}

/** process CPU time in ms (user + system) — robust against a loaded machine, unlike wall clock */
function cpuMs(): number {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
}
