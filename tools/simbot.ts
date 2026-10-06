/**
 * SIMBOT — scripted "competent mayor" for balance testing (owned by sim-core).
 *
 *   npx tsx tools/simbot.ts [--size 256] [--years 60] [--seed 7] [--difficulty medium] [--terrain plains]
 *                           [--water 0.2] [--quiet] [--no-infra] [--tax 12] [--spendy] [--neglect]
 *   env: SIMBOT_BUDGET=1 (yearly budget lines) · SIMBOT_LOG=1 (full action log) · SIMBOT_VERBOSE=1
 *
 * Plays through CityActions only (like the UI): lays out a 9-cell road grid (avenues every 4th line) with a
 * trunk line edge-to-edge (upgraded to a highway later), sectors (commercial core, industrial park east of the
 * center along the trunk, residential rings, 1-in-9 civic/park blocks, utility blocks, a landfill block),
 * develops blocks as demand calls for them, places power / water / garbage by capacity, services by coverage,
 * parks / airports / freight / connections when demand caps bind, rezones to medium / high density as the city
 * grows, builds rewards and landmarks, manages taxes and takes a loan early if needed.
 * SIM_DEPTH (WP6a): keeps water, power, sewage and garbage ahead of demand (reserved utility blocks, pumps upgraded to
 * treatment plants in place, desalination / shore sites, no brown-out trap), serves the catchment needs (schools,
 * clinics / hospitals, colleges / libraries, playgrounds, parks: unserved homes counted per building — homeNeed —,
 * partly served catchment edges, overloaded facilities; keyed to completed services passes), sends a unit to every
 * uncovered major emergency like an attentive player (--neglect: never), builds fire stations / clinics where responders
 * cannot reach, a prison when the jail overflows, bus stops / depots / garages, tree buffers along noisy highways, and
 * places every service and utility on a lot that touches a road.
 * Prints a yearly table (population, funds, income/expense, demand, EQ, commute, cohorts, enrolment, tourism, timings).
 */
import { createCityState } from '../src/sim/terrainGen';
import { defaultCityConfig, type CityConfigData } from '../src/sim/config';
import { Simulation, type SimSystem } from '../src/sim/Simulation';
import { economySystems, economyRuntime } from '../src/sim/systems/economy';
import { CityActions, lPath, type ActionResult } from '../src/sim/actions';
import { DevType, Network, Zone, type Difficulty, type TerrainPreset } from '../src/core/types';
import { CAP_RELIEF, getDef, rotatedFootprint } from '../src/sim/catalog';
import { econData, type EconRuntime } from '../src/sim/economy/runtime';
import { BF, type Building, type CityState } from '../src/sim/CityState';
import { maxLoanAmount } from '../src/sim/economy/loans';
import { listRewards } from '../src/sim/economy/rewards';
import type { NeedTier } from '../src/sim/CityState';
import { facilityLoad, tierLayer, unservedClusters } from '../src/sim/infra/catchments';
import { emergencyOf, uncoveredHotspots } from '../src/sim/infra/emergency';

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
  /** fixed tax rate for every DevType (disables the bot's tax management) */
  tax?: number;
  /** careless mayor: 150% funding everywhere and builds services / parks without checking the budget */
  spendy?: boolean;
  /** inattentive mayor: never dispatches to uncovered emergencies (measures failure outcomes) */
  neglect?: boolean;
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
  /** kids / seniors share of residents, elementary / high school pupils served / need, tourists per day, attractiveness */
  kidsPct: number;
  senPct: number;
  enrolE: number;
  enrolH: number;
  tourists: number;
  attr: number;
}

/** block use: ... 'X' planned landfill block, 'L' landfill zoned by ensureGarbage (utilities never go there) */
type Use = 'R' | 'C' | 'I' | 'P' | 'U' | 'X' | 'A' | 'L';
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

/** duck-typed view of sim-infra's PollutionSystem garbage queries (WP3) */
interface GarbageApi {
  garbageSummary(): { producedT: number; outOfRangeT: number; overCapacityT?: number };
  garbageInfo(id: number): { producedT: number; collected: boolean; reason?: string } | null;
}

const GRID = 9;
/** a prison keeps at least this many cells from R$$$ homes (bot rule; PART_B item 38 d) */
export const JAIL_GAP = 12;
/** a cluster of buildings beyond garbage-truck range producing this much (t / month) gets a facility (ensureGarbage) */
const GARB_RANGE_MIN_T = 10;
/** small parks a school or clinic may replace when a built-up district has no other lot (placeByClearing) */
const POCKET_PARKS = new Set(['park_small', 'park_plaza', 'park_playground']);
/** a placeByClearing site the facility cannot stand on is not tried again for this many days */
const CLEAR_FAIL_DAYS = 720;
/** a prison when this share of the sentenced has no bed (the first one: JAIL_OVERFLOW_FIRST, PART_B §5 WP6a "a jail when
 *  justice.overflow > 0.25"); once one stands the next is built at JAIL_OVERFLOW_MORE, so overflow stays within WP6b's
 *  "≤ 0.2 from year 20" gate (at 0.25 the 256x60 bots sat at 0.23-0.24 for years: s7 2057, s11 2054) */
export const JAIL_OVERFLOW_FIRST = 0.25;
export const JAIL_OVERFLOW_MORE = 0.15;

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
  /** ms per system during the current / last simulated year */
  yearBySystem: Record<string, number> = {};
  days = 0;
  trunkZ: number;
  highway = false;
  rows: YearRow[] = [];
  private quiet: boolean;
  rt: EconRuntime | undefined;
  opts: BotOptions;

  constructor(opts: BotOptions, systems: SimSystem[] = economySystems()) {
    const cfg: CityConfigData = defaultCityConfig({
      size: opts.size, seed: opts.seed, difficulty: opts.difficulty, terrain: opts.terrain, waterAmount: opts.water,
      hilliness: 0.25, treeDensity: 0.35, name: 'Botville', mayor: 'Bot', disasters: false,
    });
    this.quiet = opts.quiet;
    this.opts = opts;
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
          this.yearBySystem[s.name] = (this.yearBySystem[s.name] ?? 0) + dt;
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
    if (dx >= -6 && dx <= -4 && dz === 5) return 'A';
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
  /** investments that raise income (zoning / roads for new blocks) use a much smaller reserve; the price of a needed
   *  prison the bot is saving for (jailHold) is not theirs */
  canInvest(cost: number): boolean {
    let e = 0;
    for (const k in this.st.budget.lastExpense) if (!k.startsWith('oneoff:')) e += this.st.budget.lastExpense[k];
    return this.funds - cost - this.jailHold > 1500 + e * 0.3;
  }
  /** money held back from zoning for a needed prison (ensureJustice sets it every month, before zoning runs) */
  jailHold = 0;
  private jailSaving = false;
  /** a competent mayor only adds recurring costs the budget can carry (or when sitting on a big pile of cash) */
  canAfford(defId: string): boolean {
    const d = getDef(defId);
    if (!d) return false;
    const up = d.upkeep ?? 0;
    const net = this.monthlyNet() + this.pendingUpkeep;
    if (this.opts.spendy) return this.funds > (d.cost ?? 0);
    if (!this.canSpend(d.cost ?? 0)) return false;
    return net - up > 0 || this.funds > 60 * up + 50000;
  }
  /** upkeep committed this month (not yet in the last budget) */
  pendingUpkeep = 0;

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
    if (b.use === 'X' || b.use === 'L') return Zone.Landfill;
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
    if (best || (use !== 'I' && use !== 'C')) return best;
    // sector full: repurpose the undeveloped residential block closest to existing blocks of that use
    const same = this.blocks.filter((o) => o.developed && o.use === use);
    for (const b of this.blocks) {
      if (b.developed || b.use !== 'R' || !this.touchesDeveloped(b)) continue;
      let dmin = Infinity;
      for (const o of same) dmin = Math.min(dmin, Math.abs(o.bx - b.bx) + Math.abs(o.bz - b.bz));
      if (dmin < bd) { bd = dmin; best = b; }
    }
    if (best) best.use = use;
    return best;
  }
  touchesDeveloped(b: Block): boolean {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const o = this.byKey.get(b.bx + dx + ',' + (b.bz + dz));
      if (o?.developed) return true;
    }
    return false;
  }

  /** find a spot for a ploppable inside blocks of the given uses near (nx,nz). Returns result or null. `accept` may veto
   *  a lot (x, z, w, d) before it is built (e.g. a prison far from wealthy homes). */
  placeNear(defId: string, nx: number, nz: number, uses: Use[], developOk = true, maxDist = Infinity, edgeOnly = false,
    accept?: (x: number, z: number, w: number, d: number) => boolean): ActionResult | null {
    const def = getDef(defId);
    if (!def) return null;
    const dist = (b: Block) => Math.hypot((b.x0 + b.x1) / 2 - nx, (b.z0 + b.z1) / 2 - nz);
    // undeveloped utility blocks are the land reserveUtilityLand keeps for power and water: anything else takes one
    // only while more are left than the reserve
    const utility = def.category === 'power' || def.category === 'water' || this.spareUtilityBlocks() > 0;
    const area = def.footprint[0] * def.footprint[1];
    // (only blocks with room for the lot count toward the 14 tried: in a grown city the nearest blocks are full, and a
    // window of full blocks left the reserved utility land unused for decades — 256×60 s7 ran dry from 2040)
    const cand = this.blocks.filter((b) => uses.includes(b.use) && (b.developed || developOk) && (utility || b.use !== 'U' || b.developed)
      && dist(b) <= maxDist && this.freeCells(b) >= area)
      .sort((a, b) => dist(a) - dist(b));
    for (const b of cand.slice(0, 14)) {
      for (const rot of [0, 1, 2, 3] as const) {
        const [w, d] = rotatedFootprint(def, rot);
        if (w > b.x1 - b.x0 || d > b.z1 - b.z0) continue;
        // candidate origins: edges of the block so the lot touches a road (edgeOnly: never the block centre, e.g. for
        // garbage facilities, which need a road on their edge for the trucks)
        const xs = [b.x0, b.x1 - w, b.x0 + ((b.x1 - b.x0 - w) >> 1)];
        const zs = [b.z0, b.z1 - d, b.z0 + ((b.z1 - b.z0 - d) >> 1)];
        for (const z of zs) {
          for (const x of xs) {
            if (edgeOnly && x === xs[2] && z === zs[2] && x !== b.x0 && x !== b.x1 - w && z !== b.z0 && z !== b.z1 - d) continue;
            if (accept && !accept(x, z, w, d)) continue;
            const p = this.A.plop(defId, x, z, rot, true);
            if (!p.ok || (edgeOnly && p.reason)) continue; // edgeOnly: the lot must touch a road (no access warning)
            if (!b.developed) { this.buildBlockRoads(b); b.developed = true; }
            const r = this.A.plop(defId, x, z, rot);
            if (r.ok) {
              this.pendingUpkeep -= def.upkeep ?? 0;
              this.services.push({ def: defId, x: x + (w >> 1), z: z + (d >> 1) });
              this.lastPlaced = { x, z, w, d };
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

  /** free cells of a block's interior (no building, road or water) */
  freeCells(b: Block): number {
    const st = this.st, N = this.N;
    let n = 0;
    for (let z = b.z0; z < b.z1; z++) {
      for (let x = b.x0; x < b.x1; x++) {
        const i = z * N + x;
        if (st.building[i] < 0 && st.network[i] === Network.None && !st.water[i]) n++;
      }
    }
    return n;
  }
  /** lot of the last successful placeNear */
  lastPlaced = { x: 0, z: 0, w: 0, d: 0 };
  /** origin of the last successful placeByClearing */
  lastCleared = { x: 0, z: 0 };

  /**
   * a civic / service building near (x, z) within `reach` cells, always on a lot that touches a road: civic blocks,
   * then an undeveloped block next to town (it becomes a civic block), then free lots of developed blocks within
   * 0.7 × reach (deep blocks fill their interiors with yards, so free lots there get rare)
   */
  /** a walking catchment (elementary school, clinic, library, parks) starts on the streets / roads / avenues along the
   *  lot: true when one touches lot (lx, lz, w, d) — a highway is no footpath */
  walkableLot(lx: number, lz: number, w: number, d: number): boolean {
    const N = this.N, net = this.st.network;
    const foot = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N && net[z * N + x] >= Network.Street && net[z * N + x] <= Network.OneWay;
    for (let x = lx; x < lx + w; x++) if (foot(x, lz - 1) || foot(x, lz + d)) return true;
    for (let z = lz; z < lz + d; z++) if (foot(lx - 1, z) || foot(lx + w, z)) return true;
    return false;
  }

  /**
   * lot filter of a civic building serving (x, z): on the target's side of the trunk highway (walking catchments stop at
   * highways) and, for a walking catchment, a lot along a street / road / avenue (walkableLot): a lot whose only road is
   * the highway reaches nobody (128 s7: a school fronting the trunk served 0 pupils while 5,670 kids were unreached)
   */
  civicAccept(defId: string, z: number): (lx: number, lz: number, w: number, d: number) => boolean {
    const side = (lz: number, d: number) => !this.highway || (lz + d / 2 < this.trunkZ) === (z < this.trunkZ);
    const walk = (getDef(defId)?.coverage as { metric?: string } | undefined)?.metric === 'walk';
    return (lx, lz, w, d) => side(lz, d) && (!walk || this.walkableLot(lx, lz, w, d));
  }

  /**
   * after the trunk avenue became a highway: walking-catchment facilities whose only road it was reach nobody any more
   * (no footpath along their lot) — bulldoze them, like a mayor moving the school; the needs rules build new ones on
   * walkable lots for the districts left unserved
   */
  rehomeStranded(): void {
    const st = this.st;
    const gone: Building[] = [];
    for (const b of st.buildings.values()) {
      if (!(b.flags & BF.Plopped) || (getDef(b.def)?.coverage as { metric?: string } | undefined)?.metric !== 'walk') continue;
      if (!this.walkableLot(b.x, b.z, b.w, b.d)) gone.push(b);
    }
    for (const b of gone) {
      if (this.A.bulldoze({ x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d }).ok) this.say(`trunk highway: ${getDef(b.def)?.name} at ${b.x},${b.z} had no footpath left — bulldozed`);
    }
  }

  placeCivic(defId: string, x: number, z: number, reach: number, clearLots = false): ActionResult | null {
    const side = (lz: number, d: number) => !this.highway || (lz + d / 2 < this.trunkZ) === (z < this.trunkZ);
    const accept = this.civicAccept(defId, z);
    const r = this.placeNear(defId, x, z, ['P'], true, reach, true, accept);
    if (r) return r;
    const dist = (b: Block) => Math.hypot((b.x0 + b.x1) / 2 - x, (b.z0 + b.z1) / 2 - z);
    const nb = this.blocks.filter((b) => !b.developed && (b.use === 'R' || b.use === 'C') && this.touchesDeveloped(b) && dist(b) <= reach && side(b.z0, b.z1 - b.z0))
      .sort((a, b) => dist(a) - dist(b))[0];
    if (nb) {
      const was = nb.use;
      nb.use = 'P';
      const r2 = this.placeNear(defId, x, z, ['P'], true, reach, true, accept);
      if (r2) return r2;
      if (!nb.developed) nb.use = was;
    }
    const r3 = this.placeNear(defId, x, z, ['R', 'C', 'I'], false, reach * 0.7, true, accept);
    if (r3 || !clearLots) return r3;
    return this.placeByClearing(defId, x, z, reach * 0.7, ['R', 'C'], accept);
  }

  /**
   * like a player who bulldozes a few small houses for a school: the lot (touching a road) inside a developed block of
   * `uses` (R / C by default; a prison clears industrial lots) within `reach` of the target (to the block's nearest cell)
   * whose cells are empty or hold only small growables (stage ≤ maxStage, 2 by default; not historic; a deep lot that
   * reaches past the new lot at most max(6 cells, twice its size)) or a bus stop, and that `accept` allows, fewest
   * residents / jobs displaced first; they are bulldozed and the facility is built there
   */
  placeByClearing(defId: string, x: number, z: number, reach: number, uses: readonly Use[] = ['R', 'C'],
    accept?: (x: number, z: number, w: number, d: number) => boolean, maxStage = 2, clearParks = false, anySide = false): ActionResult | null {
    const def = getDef(defId);
    if (!def) return null;
    const st = this.st, N = this.N;
    let best: { x: number; z: number; rot: 0 | 1 | 2 | 3; cost: number; olds: Building[] } | null = null;
    for (const b of this.blocks) {
      if (!b.developed || !uses.includes(b.use)) continue;
      // distance to the block's nearest cell (not its centre: a target near a block corner reaches the next blocks)
      const bdx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0, bdz = z < b.z0 ? b.z0 - z : z > b.z1 ? z - b.z1 : 0;
      if (Math.hypot(bdx, bdz) > reach) continue;
      // (the target's side of the trunk highway, unless the facility serves both: `anySide`)
      if (!anySide && this.highway && ((b.z0 + b.z1) / 2 < this.trunkZ) !== (z < this.trunkZ)) continue;
      for (const rot of [0, 1] as const) {
        const [w, d] = rotatedFootprint(def, rot);
        // lots on the block edge (they touch the road)
        for (const [lx, lz] of [[b.x0, b.z0], [b.x1 - w, b.z0], [b.x0, b.z1 - d], [b.x1 - w, b.z1 - d], [(b.x0 + b.x1 - w) >> 1, b.z0], [(b.x0 + b.x1 - w) >> 1, b.z1 - d], [b.x0, (b.z0 + b.z1 - d) >> 1], [b.x1 - w, (b.z0 + b.z1 - d) >> 1]]) {
          if (lx < b.x0 || lz < b.z0 || lx + w > b.x1 || lz + d > b.z1) continue;
          if (accept && !accept(lx, lz, w, d)) continue;
          const olds: Building[] = [];
          let ok = true, cost = 0;
          for (let zz = lz; zz < lz + d && ok; zz++) for (let xx = lx; xx < lx + w && ok; xx++) {
            const id = st.building[zz * N + xx];
            if (id < 0) continue;
            const o = st.buildings.get(id);
            if (!o) continue;
            if (olds.includes(o)) continue;
            const od = getDef(o.def);
            // a bus stop moves out of the way (the transit rule puts one back where the block lacks coverage); for a school
            // or clinic also a pocket park / plaza / playground (the green / play rules put one back elsewhere)
            if (o.def === 'tr_bus_stop' && defId !== 'tr_bus_stop') { olds.push(o); cost += 3; continue; }
            if (clearParks && POCKET_PARKS.has(o.def)) { olds.push(o); cost += 20; continue; }
            // small homes / shops only; a deep lot reaching past the new lot goes too (a cottage with its yards, or at most
            // twice the new lot's size)
            if (o.flags & (BF.Plopped | BF.Historic | BF.OnFire) || (od?.stage ?? 9) > maxStage || o.w * o.d > Math.max(6, 2 * w * d)) { ok = false; break; }
            olds.push(o);
            cost += o.pop + o.jobs + 1;
          }
          if (!ok || (best && cost >= best.cost)) continue;
          // a site that failed after clearing before is skipped for CLEAR_FAIL_DAYS; a new best must pass the plop check
          // as if it were cleared (slope, water, a road along the lot, money), so nothing is bulldozed for a facility
          // that cannot stand there (256x60 s11: 28 times 'cleared 1 small lots at 251,131 but could not build')
          // (short of money is no reason to give a site up)
          const key = `${defId}@${lx},${lz},${rot}`;
          if ((this.clearFailed.get(key) ?? -1) > st.day) continue;
          const pre = this.clearedPlopRot(defId, lx, lz, w, d, rot, olds);
          if (pre < 0) { if (pre === -1) this.clearFailed.set(key, st.day + CLEAR_FAIL_DAYS); continue; }
          best = { x: lx, z: lz, rot: pre as 0 | 1 | 2 | 3, cost, olds };
        }
      }
    }
    if (!best) return null;
    for (const o of best.olds) this.A.bulldoze({ x0: o.x, z0: o.z, x1: o.x + o.w, z1: o.z + o.d });
    for (const rot of [best.rot, ((best.rot + 2) & 3) as 0 | 1 | 2 | 3]) {
      const p = this.A.plop(defId, best.x, best.z, rot, true);
      if (!p.ok || p.reason) continue;
      const r = this.A.plop(defId, best.x, best.z, rot);
      if (r.ok) {
        const [w, d] = rotatedFootprint(def, rot);
        this.lastCleared = { x: best.x, z: best.z };
        this.pendingUpkeep -= def.upkeep ?? 0;
        this.services.push({ def: defId, x: best.x + (w >> 1), z: best.z + (d >> 1) });
        this.say(`cleared ${best.olds.length} small lots for ${def.name} ($${r.cost})`);
        return r;
      }
    }
    this.clearFailed.set(`${defId}@${best.x},${best.z},${best.rot}`, st.day + CLEAR_FAIL_DAYS);
    this.say(`cleared ${best.olds.length} small lots at ${best.x},${best.z} but could not build a ${def.name} there`);
    return null;
  }
  /** placeByClearing sites (def @ x,z,rot) that failed: skipped until the day stored */
  private clearFailed = new Map<string, number>();
  /**
   * the rotation (rot, else its opposite: the same footprint) at which defId would plop on lot (x, z, w, d) once the
   * buildings `olds` are gone, with no warning (a road along the lot); -2 when only money is short, else -1: the plop
   * preview runs with the lot's cells of `olds` marked free for the call (the real check: bounds, roads / rails, water,
   * slope, money, road access)
   */
  clearedPlopRot(defId: string, x: number, z: number, w: number, d: number, rot: number, olds: readonly Building[]): number {
    const st = this.st, N = this.N;
    const saved: number[] = [];
    for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) {
      const i = zz * N + xx, id = st.building[i];
      if (id >= 0 && olds.some((o) => o.id === id)) { saved.push(i, id); st.building[i] = -1; }
    }
    let out = -1;
    try {
      for (const r of [rot, (rot + 2) & 3] as (0 | 1 | 2 | 3)[]) {
        const p = this.A.plop(defId, x, z, r, true);
        if (p.ok && !p.reason) { out = r; break; }
        if (!p.ok && p.reason?.startsWith('Not enough money')) out = -2;
      }
    } finally {
      for (let k = 0; k < saved.length; k += 2) st.building[saved[k]] = saved[k + 1];
    }
    return out;
  }

  /** a bus stop on a free frontage cell of block b (avenue sides first, from the middle of each side); its cell or null */
  placeStop(b: Block): { x: number; z: number } | null {
    const st = this.st, N = this.N;
    const sides: { x: number; z: number; dx: number; dz: number; len: number; avenue: boolean }[] = [
      { x: b.x0, z: b.z0, dx: 1, dz: 0, len: b.x1 - b.x0, avenue: this.lineType(b.bz, false) === Network.Avenue },
      { x: b.x0, z: b.z1 - 1, dx: 1, dz: 0, len: b.x1 - b.x0, avenue: this.lineType(b.bz + 1, false) === Network.Avenue },
      { x: b.x0, z: b.z0, dx: 0, dz: 1, len: b.z1 - b.z0, avenue: this.lineType(b.bx, true) === Network.Avenue },
      { x: b.x1 - 1, z: b.z0, dx: 0, dz: 1, len: b.z1 - b.z0, avenue: this.lineType(b.bx + 1, true) === Network.Avenue },
    ];
    sides.sort((p, q) => Number(q.avenue) - Number(p.avenue));
    for (const sd of sides) {
      const mid = sd.len >> 1;
      for (let k = 0; k < sd.len; k++) {
        const off = mid + (k & 1 ? 1 : -1) * ((k + 1) >> 1);
        if (off < 0 || off >= sd.len) continue;
        const x = sd.x + sd.dx * off, z = sd.z + sd.dz * off;
        const i = z * N + x;
        if (x < 0 || z < 0 || x >= N || z >= N || st.building[i] >= 0 || st.network[i] !== Network.None || st.water[i]) continue;
        for (const rot of [0, 1, 2, 3] as const) {
          const p = this.A.plop('tr_bus_stop', x, z, rot, true);
          if (!p.ok || p.reason) continue;
          if (this.A.plop('tr_bus_stop', x, z, rot).ok) return { x, z };
          break;
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------ setup
  setup(): void {
    const N = this.N;
    if (this.opts.spendy) for (const k of Object.keys(this.st.budget.funding) as (keyof typeof this.st.budget.funding)[]) this.A.setFunding(k, 150);
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
    this.pendingUpkeep = 0;
    const st = this.st, s = st.stats;
    const pop = s.population;
    this.finance();
    this.repairUtilities();
    this.reserveUtilityLand();
    this.ensurePower();
    this.ensureWater();
    this.ensureSewage();
    this.ensureGarbage();
    this.ensureJustice();
    this.zoning();
    this.ensureServices();
    this.ensureNeeds();
    this.ensureResponse();
    this.ensureTransit();
    this.treeBuffers();
    this.caps();
    this.rewards();
    this.density();
    this.ordinances();
    if (!this.highway && pop > 12000 && this.canSpend(30000)) {
      const r = this.A.buildNetwork(lPath({ x: 0, z: this.trunkZ }, { x: this.N - 1, z: this.trunkZ }), Network.Highway);
      if (r.ok) { this.highway = true; this.say(`trunk upgraded to highway ($${Math.round(r.cost)})`); this.rehomeStranded(); }
    }
  }

  // ------------------------------------------------------------------------------------------ daily (attentive mayor)
  /** WP6-3: an attentive mayor sends a unit to every uncovered major emergency (--neglect: never) */
  daily(): void {
    if (this.opts.neglect) return;
    const em = emergencyOf(this.sim);
    if (!em || !em.active) return;
    const list = em.incidents();
    for (let k = 0; k < list.length; k++) {
      const inc = list[k];
      if (inc.state !== 'uncovered' || !inc.major) continue;
      if (inc.canSend === false && !inc.manualPossible) continue;
      const r = em.dispatchBest(this.sim, inc.id);
      if (r.ok) this.dispatches++;
    }
  }
  /** player dispatches so far (report) */
  dispatches = 0;

  finance(): void {
    const st = this.st;
    const net = this.monthlyNet();
    // early loans to invest (competent mayors borrow while the town is small and the budget is tight)
    let income = 0;
    for (const k in st.budget.lastIncome) if (!k.startsWith('oneoff:')) income += st.budget.lastIncome[k];
    if (st.budget.loans.length < 2 && st.day < 360 * 12 && st.funds < 25000 && net < income * 0.05 && st.stats.population > 1000) {
      const amt = Math.min(maxLoanAmount(st), 60000);
      if (amt >= 5000 && this.A.takeLoan(amt).ok) this.say(`took a loan of $${amt}`);
    }
    if (st.funds < 0 && st.budget.loans.length < 3) {
      const amt = Math.min(maxLoanAmount(st), 100000);
      if (amt >= 5000 && this.A.takeLoan(amt).ok) this.say(`emergency loan $${amt}`);
    }
    if (this.opts.tax !== undefined) {
      for (let d = 0; d < 12; d++) this.A.setTax(d as DevType, this.opts.tax);
      return;
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
    if (!this.canSpend(cost) && this.funds < cost + 2000) {
      // POWER TRAP (WP4 note): the plant the city needs is not affordable yet — bridge the shortfall with wind turbines
      // (≈ 3 MW each) instead of browning out for years while saving up
      if (def !== 'util_wind_turbine' && s.powerSupply < need * 1.05) {
        const n = Math.min(8, Math.ceil((need * 1.1 - s.powerSupply) / 3));
        for (let k = 0; k < n && this.funds > 800 + 3000; k++) if (!this.placeUtility('util_wind_turbine', cx, cz)) break;
      }
      return;
    }
    const n = def === 'util_wind_turbine' ? 3 : 1;
    for (let k = 0; k < n; k++) {
      if (this.placeUtility(def, cx, cz)) continue;
      // a full map: clear small industrial / utility lots for the plant (at most every 120 days while it finds no site)
      if (def !== 'util_wind_turbine' && (this.svcRetry.get('power:clear') ?? -1) <= this.st.day) {
        // (a built-up map: stage-3 lots too, on either side of the trunk — one grid spans it)
        const ok = !!this.placeByClearing(def, cx, cz, Infinity, ['I', 'U']) || !!this.placeByClearing(def, cx, cz, Infinity, ['I', 'U'], undefined, 3, false, true);
        this.svcRetry.set('power:clear', this.st.day + (ok ? 30 : 120));
        if (ok) { this.say(`power: cleared small lots for a ${getDef(def)?.name}`); continue; }
      }
      break;
    }
  }

  /**
   * utilities: utility blocks, then industrial / civic blocks, then a fresh utility block at the edge of town — always
   * on a lot that touches a road (edgeOnly: a producer without road access is cut off)
   */
  placeUtility(def: string, cx: number, cz: number): boolean {
    if (this.placeNear(def, cx, cz, ['U', 'I', 'X'], true, Infinity, true)) return true;
    if (this.placeNear(def, cx, cz, ['P'], true, 60, true)) return true;
    const b = this.blocks.filter((o) => !o.developed && (o.use === 'R' || o.use === 'I') && this.touchesDeveloped(o))
      .sort((a, o) => Math.hypot(a.x0 - cx, a.z0 - cz) - Math.hypot(o.x0 - cx, o.z0 - cz))[0];
    if (!b) return false;
    b.use = 'U';
    return !!this.placeNear(def, cx, cz, ['U'], true, Infinity, true);
  }

  /**
   * keep land for utilities as the map fills (QA growth regression b): at least 1 + pop / 150k undeveloped utility
   * blocks while undeveloped land remains (a treatment plant serves ~130k residents), taken from the undeveloped blocks
   * next to the town nearest the utility area; only power and water may use them (placeNear)
   */
  /** undeveloped utility blocks the utility reserve can do without (non-utility placements may use those) */
  spareUtilityBlocks(): number {
    let n = 0;
    for (const b of this.blocks) if (b.use === 'U' && !b.developed) n++;
    return n - this.utilityReserve();
  }
  /** undeveloped utility blocks kept for power and water: 1 + pop / 150k (a treatment plant serves ~130k residents) */
  utilityReserve(): number {
    return 1 + Math.floor(this.st.stats.population / 150000);
  }

  reserveUtilityLand(): void {
    const free = this.blocks.filter((b) => !b.developed);
    if (free.length > this.blocks.length * 0.3) return;
    const want = this.utilityReserve();
    let have = free.filter((b) => b.use === 'U').length;
    const cx = this.line(this.cbx) + 3 * GRID, cz = this.trunkZ;
    while (have < want) {
      const b = free.filter((o) => (o.use === 'R' || o.use === 'I') && this.touchesDeveloped(o))
        .sort((a, o) => Math.hypot(a.x0 - cx, a.z0 - cz) - Math.hypot(o.x0 - cx, o.z0 - cz))[0];
      if (!b) break;
      b.use = 'U';
      have++;
      this.say(`reserved block (${b.bx},${b.bz}) for utilities`);
    }
  }

  ensureWater(): void {
    const st = this.st, s = st.stats;
    if (s.population < 300 && s.waterSupply > 0) return;
    // stay ahead of demand: build at 75 % load (more headroom in a fast-growing big city)
    const load = s.population > 150000 ? 0.7 : 0.75;
    if (s.waterSupply > 0 && s.waterDemand < s.waterSupply * load) return;
    const big = st.unlocked.has('water_treatment') && s.waterDemand > 20000;
    const desal = st.unlocked.has('desalination') && s.waterDemand > 60000;
    const def = big ? 'util_water_treatment' : 'util_water_pump';
    const cost = getDef(def)?.cost ?? 0;
    if (!this.canSpend(cost) && this.funds < cost + 5000) return;
    // enough to cover the shortfall + 30% headroom (max 3 per month)
    const out = getDef(def)!.waterOut!;
    const n = Math.max(1, Math.min(3, Math.ceil((s.waterDemand * 1.3 - s.waterSupply) / out)));
    const cx = this.line(this.cbx), cz = this.line(this.cbz);
    for (let k = 0; k < n; k++) {
      if (!big && this.placeNear(def, cx, cz, ['P', 'U'], true, Infinity, true)) continue;
      if (this.placeUtility(def, cx, cz)) continue;
      // no free land: desalination on the shore, else replace a group of pumps by a treatment plant in place
      // (the shore search scans the map: at most twice a year)
      if (desal && (this.svcRetry.get('desal') ?? -1) <= this.st.day && this.canSpend(getDef('util_desalination')!.cost ?? 0)) {
        const ok = this.placeShore('util_desalination');
        this.svcRetry.set('desal', this.st.day + (ok ? 30 : 180));
        if (ok) continue;
      }
      if (big && this.upgradePumps()) continue;
      // a full map: clear a few small lots for the plant (industrial / utility blocks first, then shops / homes), like
      // a player bulldozing a corner of town for water (at most every 120 days while it finds no site)
      if (big && (this.svcRetry.get('water:clear') ?? -1) <= st.day) {
        // (a built-up map, where schools, clinics and depots have taken the small lots: stage-3 lots too, on either side
        // of the trunk — pipes run under every road, the highway included; 256×60 s7 had no site 2040–57 without it)
        const ok = !!this.placeByClearing(def, cx, cz, Infinity, ['I', 'U']) || !!this.placeByClearing(def, cx, cz, Infinity, ['C', 'R'])
          || !!this.placeByClearing(def, cx, cz, Infinity, ['I', 'U', 'C', 'R'], undefined, 3, false, true);
        this.svcRetry.set('water:clear', st.day + (ok ? 30 : 120));
        if (ok) { this.say(`water: cleared small lots for a ${getDef(def)?.name}`); continue; }
      }
      break;
    }
  }

  /**
   * one treatment plant (50,000 kL) in place of up to 9 pumps (5,000 kL each) when no land is left: a 3x3 window of a
   * utility / civic / industrial block whose cells are empty or pumps; the pumps go, the plant goes in (re-plopped if
   * the plant cannot be built)
   */
  upgradePumps(): boolean {
    const st = this.st, N = this.N;
    const def = getDef('util_water_treatment');
    if (!def || !st.unlocked.has('water_treatment') || !this.canSpend((def.cost ?? 0) + 2000)) return false;
    for (const b of this.blocks) {
      if (!b.developed || (b.use !== 'U' && b.use !== 'P' && b.use !== 'X' && b.use !== 'I')) continue;
      for (let z = b.z0; z + 3 <= b.z1; z++) {
        for (let x = b.x0; x + 3 <= b.x1; x++) {
          const pumps: Building[] = [];
          let ok = true;
          for (let dz = 0; dz < 3 && ok; dz++) for (let dx = 0; dx < 3 && ok; dx++) {
            const i = (z + dz) * N + x + dx;
            if (st.network[i] !== Network.None || st.water[i]) { ok = false; break; }
            const id = st.building[i];
            if (id < 0) continue;
            const o = st.buildings.get(id);
            if (!o || o.def !== 'util_water_pump' || o.x < x || o.z < z || o.x + o.w > x + 3 || o.z + o.d > z + 3) { ok = false; break; }
            if (!pumps.includes(o)) pumps.push(o);
          }
          if (!ok || pumps.length === 0) continue;
          const saved = pumps.map((o) => ({ x: o.x, z: o.z, rot: o.rot }));
          for (const o of pumps) this.A.bulldoze({ x0: o.x, z0: o.z, x1: o.x + o.w, z1: o.z + o.d });
          for (const rot of [0, 1, 2, 3] as const) {
            const p = this.A.plop(def.id, x, z, rot, true);
            if (!p.ok || p.reason) continue;
            if (this.A.plop(def.id, x, z, rot).ok) {
              this.services.push({ def: def.id, x: x + 1, z: z + 1 });
              this.say(`replaced ${pumps.length} pumps by a treatment plant at ${x},${z}`);
              return true;
            }
          }
          for (const o of saved) this.A.plop('util_water_pump', o.x, o.z, o.rot);
        }
      }
    }
    return false;
  }

  /** a treatment plant when less than 80 % of the sewage is treated in a city of 20k+ (tap water, rivers) */
  ensureSewage(): void {
    const st = this.st, s = st.stats;
    if (s.population < 20000 || !st.unlocked.has('water_treatment')) return;
    if ((s.sewageTreated ?? 1) >= 0.8) return;
    if ((this.svcRetry.get('sewage') ?? -1) > st.day || !this.canAfford('util_water_treatment')) return;
    const cx = this.line(this.cbx), cz = this.line(this.cbz);
    if (!this.placeUtility('util_water_treatment', cx, cz) && !this.upgradePumps()) this.svcRetry.set('sewage', st.day + 120);
    else this.svcRetry.set('sewage', st.day + 60); // let the next pollution pass see it
  }

  /**
   * Garbage (SIM_DEPTH_SPEC WP3 C5: trucks collect only within 90 road tiles of a landfill / incinerator / recycling
   * center; landfill cells fill up over ~10 years). A district beyond truck range gets a facility as soon as its cluster
   * produces GARB_RANGE_MIN_T (or 0.3 % of the city's garbage; or 1 % of the city's garbage lies beyond range): a few
   * new shop blocks at the edge are far below any city-wide share, yet their own piles abandon luxury shops within ~4
   * months (WP6a diag, 256 s7: every CS$$$ abandoned in 2007-10 was 'uncollected: range', pile ~0.9). A recycling
   * center once unlocked (compact transfer point), else a landfill block within ~60 cells, else an incinerator; a
   * cluster within 30 cells of a range facility of the last 120 days waits (the garbage pass must see it first).
   * Capacity: collected garbage near the capacity, the landfills filling up, or > 2 % of the garbage turned away for lack
   * of capacity (homes, shops, offices and industry alike): landfill blocks nearest the town (never on R / C blocks)
   * while the live (not yet full) landfill stays under ~3x production; incinerator / recycling beyond that.
   */
  private garbageRange: { x: number; z: number; day: number }[] = [];
  ensureGarbage(): void {
    const st = this.st, s = st.stats;
    const pol = this.sim.getSystem('pollution') as unknown as GarbageApi | undefined;
    const g = typeof pol?.garbageSummary === 'function' ? pol.garbageSummary() : null;
    if (!pol || !g) return this.ensureGarbageLegacy();
    if (s.population < 1200) return;
    // live (not yet full) landfill stays under ~3x production: 300 t/month per cell (one block of slack for reach)
    const live = this.liveLandfillCells();
    const lfCap = Math.max(64, (3 * s.garbageProduced) / 300);
    // beyond truck range: the largest cluster of out-of-range buildings
    if (g.outOfRangeT > 0 && (this.svcRetry.get('garbage:range') ?? -1) <= st.day) {
      this.garbageRange = this.garbageRange.filter((p) => st.day - p.day < 120);
      const t = this.outOfRangeCenter(pol);
      if (t && !this.garbageRange.some((p) => Math.hypot(p.x - t.x, p.z - t.z) < 30) &&
        (t.tons >= Math.max(GARB_RANGE_MIN_T, 0.003 * g.producedT) || g.outOfRangeT > 0.01 * g.producedT)) {
        const ok = this.garbageFacilityNear(t.x, t.z, live < lfCap + 64);
        this.svcRetry.set('garbage:range', st.day + (ok ? 30 : 60));
        if (ok) { this.garbageRange.push({ x: t.x, z: t.z, day: st.day }); return; }
      }
    }
    // capacity: collected garbage near the capacity, the landfills filling up, or garbage turned away for lack of capacity
    const over = g.producedT > 0 && (g.overCapacityT ?? 0) > 0.02 * g.producedT;
    if (s.garbageProduced < s.garbageCapacity * 0.8 && (s.landfillFill ?? 0) < 0.7 && !over) return;
    const cx = this.line(this.cbx), cz = this.line(this.cbz);
    if (live < lfCap && this.canSpend(2000) && this.zoneLandfillNear(cx, cz, Infinity)) return;
    // no land left for landfill (or enough of it): burn / recycle, on the fullest old landfill block first (full cells
    // are dead land), else in utility / industrial blocks
    for (const def of ['util_incinerator', 'util_recycling_center']) {
      if (!st.unlocked.has(def === 'util_incinerator' ? 'incinerator' : 'recycling_center') || !this.canAfford(def)) continue;
      const lf = this.fullestLandfillBlock();
      if ((lf && this.placeNear(def, (lf.x0 + lf.x1) / 2, (lf.z0 + lf.z1) / 2, ['L'], false, 2, true)) ||
        this.placeNear(def, cx + 4 * GRID, this.trunkZ, ['U', 'I', 'X'], true, Infinity, true)) {
        this.say(`${def === 'util_incinerator' ? 'incinerator' : 'recycling center'} for garbage capacity`);
        return;
      }
    }
  }

  /** the bot-zoned landfill block with the highest mean fill (null if none) */
  private fullestLandfillBlock(): Block | null {
    const st = this.st, N = this.N, f = st.landfillFill;
    let best: Block | null = null, bf = -1;
    for (const b of this.blocks) {
      if (b.use !== 'L') continue;
      let s = 0, n = 0;
      for (let z = b.z0; z < b.z1; z++) for (let x = b.x0; x < b.x1; x++) { s += f[z * N + x]; n++; }
      const m = n > 0 ? s / n : 0;
      if (m > bf) { bf = m; best = b; }
    }
    return best;
  }

  /**
   * a competent mayor clears the rubble of a burnt utility (power plant, water producer, garbage facility) and rebuilds
   * it in place: plopped rubble never clears by itself, and one random fire on a treatment plant otherwise leaves the
   * city short of water for decades (256x60 seed 11, 2028)
   */
  repairUtilities(): void {
    const st = this.st;
    const burnt: Building[] = [];
    for (const b of st.buildings.values()) if ((b.flags & BF.Burnt) !== 0 && (b.flags & BF.Plopped) !== 0) burnt.push(b);
    for (const b of burnt) {
      const def = getDef(b.def);
      if (!def || (def.category !== 'power' && def.category !== 'water' && def.category !== 'garbage')) continue;
      if (!this.canSpend((def.cost ?? 0) + 1000)) continue;
      const { x, z, w, d } = b;
      const rot = (b.rot ?? 0) as 0 | 1 | 2 | 3;
      if (!this.A.bulldoze({ x0: x, z0: z, x1: x + w, z1: z + d }).ok) continue;
      const r = this.A.plop(def.id, x, z, rot);
      this.say(`rebuilt burnt ${def.name}${r.ok ? '' : ` — failed: ${r.reason}`}`);
    }
  }

  /** pre-WP3 rule (economy-only runs without the pollution system) */
  private ensureGarbageLegacy(): void {
    const s = this.st.stats;
    if (s.population < 2500) return;
    if (s.garbageProduced < s.garbageCapacity * 0.8) return;
    const x = this.blocks.find((b) => b.use === 'X' && !b.developed);
    if (x && this.canSpend(2000)) { this.develop(x, Zone.Landfill); this.say('zoned landfill'); return; }
    const def = this.st.unlocked.has('incinerator') ? 'util_incinerator' : this.st.unlocked.has('recycling_center') ? 'util_recycling_center' : null;
    if (def && this.canSpend(getDef(def)!.cost!)) this.placeNear(def, this.line(this.cbx) + 4 * GRID, this.trunkZ, ['U', 'I']);
  }

  /** landfill cells that still take garbage (zoned, not full) */
  private liveLandfillCells(): number {
    const st = this.st, z = st.zone, f = st.landfillFill;
    let n = 0;
    for (let i = 0; i < st.cells; i++) if (z[i] === Zone.Landfill && f[i] < 1) n++;
    return n;
  }

  /**
   * garbage-weighted centre of the LARGEST cluster of buildings beyond truck range and its garbage (t / month; null if
   * none): districts beyond range usually ring the city, so their overall centroid would sit in the (served) middle
   */
  private outOfRangeCenter(pol: GarbageApi): { x: number; z: number; tons: number } | null {
    const B = 3 * GRID, nb = Math.ceil(this.N / B);
    const w = new Float64Array(nb * nb), wx = new Float64Array(nb * nb), wz = new Float64Array(nb * nb);
    for (const b of this.st.buildings.values()) {
      const gi = pol.garbageInfo(b.id);
      if (!gi || gi.collected || gi.reason !== 'range' || !(gi.producedT > 0)) continue;
      const x = b.x + b.w / 2, z = b.z + b.d / 2;
      const k = Math.min(nb - 1, Math.floor(z / B)) * nb + Math.min(nb - 1, Math.floor(x / B));
      w[k] += gi.producedT; wx[k] += x * gi.producedT; wz[k] += z * gi.producedT;
    }
    let best = -1, bw = 0;
    for (let k = 0; k < nb * nb; k++) {
      if (w[k] === 0) continue;
      const kx = k % nb, kz = (k - kx) / nb;
      let s = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = kx + dx, z = kz + dz;
        if (x >= 0 && z >= 0 && x < nb && z < nb) s += w[z * nb + x];
      }
      if (s > bw) { bw = s; best = k; }
    }
    if (best < 0) return null;
    const kx = best % nb, kz = (best - kx) / nb;
    let sx = 0, sz = 0, sw = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = kx + dx, z = kz + dz;
      if (x < 0 || z < 0 || x >= nb || z >= nb) continue;
      const k = z * nb + x;
      sx += wx[k]; sz += wz[k]; sw += w[k];
    }
    return sw > 0 ? { x: sx / sw, z: sz / sw, tons: sw } : null;
  }

  /** a garbage facility for the district around (x, z): recycling center, landfill block (if room), incinerator */
  private garbageFacilityNear(x: number, z: number, landfillOk: boolean): boolean {
    const st = this.st;
    if (st.unlocked.has('recycling_center') && this.canAfford('util_recycling_center') &&
      (this.placeNear('util_recycling_center', x, z, ['P', 'U', 'I', 'X'], true, 45, true) || this.placeNear('util_recycling_center', x, z, ['R', 'C', 'I'], false, 30, true))) {
      this.say(`recycling center for a district beyond truck range near ${Math.round(x)},${Math.round(z)}`);
      return true;
    }
    if (landfillOk && this.canSpend(2000) && this.zoneLandfillNear(x, z, 60)) return true;
    if (st.unlocked.has('incinerator') && this.canAfford('util_incinerator') && this.placeNear('util_incinerator', x, z, ['U', 'I', 'X'], true, 60, true)) {
      this.say(`incinerator for a district beyond truck range near ${Math.round(x)},${Math.round(z)}`);
      return true;
    }
    return false;
  }

  /**
   * zone the undeveloped block nearest (x, z) (within maxDist, grid distance ~ road distance) as landfill: the planned
   * landfill block, utility or industrial blocks first, a civic block last; never residential, commercial or airport
   * land. It must touch the developed area so its roads join the town's network.
   */
  private zoneLandfillNear(x: number, z: number, maxDist: number): boolean {
    // (undeveloped utility blocks beyond the ones reserveUtilityLand keeps for power and water, before civic / park
    // blocks, which sit among the homes)
    const penalty: Partial<Record<Use, number>> = { X: 0, I: 10, P: 40 };
    if (this.spareUtilityBlocks() > 0) penalty.U = 6;
    let best: Block | undefined, bs = Infinity;
    for (const b of this.blocks) {
      const pen = penalty[b.use];
      if (b.developed || pen === undefined || !this.touchesDeveloped(b)) continue;
      const d = Math.abs((b.x0 + b.x1) / 2 - x) + Math.abs((b.z0 + b.z1) / 2 - z);
      if (d > maxDist || d + pen >= bs) continue;
      bs = d + pen;
      best = b;
    }
    if (!best) return false;
    const was = best.use;
    best.use = 'L';
    if (!this.develop(best, Zone.Landfill)) { best.use = was; return false; }
    this.say(`zoned landfill block (${best.bx},${best.bz}) near ${Math.round(x)},${Math.round(z)}`);
    return true;
  }

  /** coverage-driven police / fire (coverage of R/C blocks), with a retry cooldown per def; a second station next to an
   *  overloaded police station (WP7-1 patrol capacity) */
  private svcRetry = new Map<string, number>();
  ensureServices(): void {
    const pop = this.st.stats.population;
    const plan: [string, number, number][] = [
      // def, min pop, coverage radius
      ['civ_fire_station', 1200, 24],
      ['civ_police_station', 2000, 26],
    ];
    let spent = 0;
    for (const [def, minPop, radius] of plan) {
      if (pop < minPop || spent >= 2) continue;
      if ((this.svcRetry.get(def) ?? -1) > this.st.day) continue;
      if (!this.canAfford(def)) continue;
      const mine = this.services.filter((s) => s.def === def);
      // don't chase coverage of a sprawling town with more stations than its size justifies
      if (mine.length >= 1 + pop / 9000) continue;
      const u = this.uncovered(def, radius);
      if (!u) continue;
      // prefer civic blocks within reach, else any free spot in developed blocks within reach (lots on a road), else a few
      // small lots cleared (deep blocks leave no free frontage in a grown district)
      const ok = this.placeCivic(def, u.x, u.z, radius * 0.8, true);
      if (ok) spent++;
      else this.svcRetry.set(def, this.st.day + 180);
    }
    // police capacity (WP7-1): a station beside any station whose patrol load exceeds 110 %
    if (pop >= 20000 && spent < 2 && (this.svcRetry.get('police:load') ?? -1) <= this.st.day && this.canAfford('civ_police_station')) {
      let worst: { x: number; z: number } | null = null, wu = 1.1;
      for (const b of this.st.buildings.values()) {
        if (b.def !== 'civ_police_station' && b.def !== 'civ_police_kiosk') continue;
        const l = facilityLoad(this.sim, b.id);
        if (l && l.utilization > wu) { wu = l.utilization; worst = { x: b.x + (b.w >> 1), z: b.z + (b.d >> 1) }; }
      }
      if (worst) {
        const ok = this.placeCivic('civ_police_station', worst.x, worst.z, 26);
        this.svcRetry.set('police:load', this.st.day + (ok ? 90 : 180));
        if (ok) this.say(`second police station for an overloaded station (${Math.round(wu * 100)} % load)`);
      }
    }
  }

  // ------------------------------------------------------------------------------------------ needs (WP6 ensureNeeds)
  /** completed services passes (layerUpdated 'catchments'): need-driven placements wait for fresh coverage */
  private passes = 0;
  /** placements whose effect the coverage layers do not show yet: tier, position, services pass at placement */
  private pendingNeeds: { tier: NeedTier; x: number; z: number; pass: number }[] = [];
  /** need placements per tier and 16x16 area in the last two years (a cluster a facility cannot fix is not chased) */
  private needHistory: { tier: NeedTier; key: number; day: number }[] = [];
  /** tier + 16x16 area -> day until which a cluster with no free site is skipped (the next cluster gets the facility) */
  private needNoSite = new Map<string, number>();
  private passesHooked = false;

  /**
   * Need of a tier counted per home (building), not per cell: a home is reached when any cell of its footprint is (the
   * services pass makes a building's coverage uniform, but stats.needs counts the back rows of deep lots — no road within
   * one cell — as unreached even when the front door is covered). Unreached homes are clustered on 8 × 8 blocks
   * (need-weighted centroids, largest first); `gaps` clusters the unserved part of every home (need × (1 − coverage):
   * the edge of a catchment, a crowded school). Falls back to the catchment's own numbers without a need raster.
   */
  homeNeed(tier: NeedTier, max = 40): { need: number; served: number; unreached: number; clusters: { x: number; z: number; people: number }[]; gaps: { x: number; z: number; people: number }[] } {
    const st = this.st, N = this.N;
    const svc = this.sim.getSystem('services') as unknown as { needRaster?: (t: NeedTier) => Float32Array | null } | undefined;
    const raster = svc?.needRaster?.(tier) ?? null;
    const n = st.stats.needs?.[tier];
    if (!raster || raster.length !== st.cells) {
      const cl = unservedClusters(this.sim, tier, max);
      return { need: n?.need ?? 0, served: n?.served ?? 0, unreached: n?.unreached ?? 0, clusters: cl, gaps: cl };
    }
    const layer = tierLayer(st, tier);
    const cw = Math.ceil(N / 8);
    const ps = new Float64Array(cw * cw), px = new Float64Array(cw * cw), pz = new Float64Array(cw * cw);
    const gs = new Float64Array(cw * cw), gx = new Float64Array(cw * cw), gz = new Float64Array(cw * cw);
    let need = 0, served = 0, unreached = 0;
    for (const b of st.buildings.values()) {
      if (b.flags & BF.Plopped || b.pop <= 0) continue;
      let m = 0, k = 0;
      for (let z = Math.max(0, b.z); z < Math.min(N, b.z + b.d); z++) {
        for (let x = Math.max(0, b.x); x < Math.min(N, b.x + b.w); x++) { const i = z * N + x; k += raster[i]; if (layer[i] > m) m = layer[i]; }
      }
      if (k <= 0) continue;
      need += k;
      const cov = Math.min(1, m);
      served += k * cov;
      const cx = b.x + b.w / 2, cz = b.z + b.d / 2;
      const blk = Math.min(cw - 1, (cz / 8) | 0) * cw + Math.min(cw - 1, (cx / 8) | 0);
      const gap = k * (1 - cov);
      if (gap > 0) { gs[blk] += gap; gx[blk] += gap * cx; gz[blk] += gap * cz; }
      if (m > 0) continue;
      unreached += k;
      ps[blk] += k; px[blk] += k * cx; pz[blk] += k * cz;
    }
    const list = (w: Float64Array, wx: Float64Array, wz: Float64Array) => {
      const out: { x: number; z: number; people: number }[] = [];
      for (let q = 0; q < w.length; q++) if (w[q] > 0) out.push({ x: wx[q] / w[q], z: wz[q] / w[q], people: w[q] });
      out.sort((a, b) => b.people - a.people || a.z - b.z || a.x - b.x);
      return out.slice(0, max);
    };
    return { need, served, unreached, clusters: list(ps, px, pz), gaps: list(gs, gx, gz) };
  }

  /** facility of a need tier for a cluster of `people` in need */
  private needDef(tier: NeedTier, people: number): string | null {
    const st = this.st, pop = st.stats.population;
    switch (tier) {
      case 'elementary': return 'civ_elementary_school';
      case 'high': return 'civ_high_school';
      case 'health': return people < 12000 || pop < 18000 ? 'civ_clinic' : 'civ_hospital';
      case 'college': return st.unlocked.has('college') && pop >= 40000 && this.count('civ_college') < 1 + Math.floor(pop / 250000) ? 'civ_college' : 'civ_library';
      case 'play': return people < 1200 ? 'park_playground' : 'park_soccer';
      // a big park where many are in need (it also relieves the R cap 14,000), a plaza for a block or two, else a pocket park
      case 'green': return people >= 2500 && pop >= 4000 ? 'park_large' : people >= 1200 && pop > 1500 ? 'park_plaza' : 'park_small';
      default: return null;
    }
  }

  /**
   * Catchment needs (SIM_DEPTH_SPEC WP6 ensureNeeds): for each tier (elementary, high school, health, college, play,
   * green): more than max(200, 3 %) of the need unreached (counted per home: homeNeed) -> a facility at the largest
   * unserved cluster; else under 90 % served: another one beside the most crowded facility (over 110 % full) or, for
   * schools and clinics, where the unserved part of the need is largest (homes at the edge of a catchment). At most 3
   * a month, while service upkeep stays within 45 % of income; a cluster waits for two completed services passes after a
   * placement (a headless 256 pass takes 45-60 days) so it is not served twice.
   */
  ensureNeeds(): void {
    const st = this.st, s = st.stats, pop = s.population;
    if (!this.passesHooked) {
      this.sim.events.on('layerUpdated', (n) => { if (n === 'catchments') this.passes++; });
      this.passesHooked = true;
    }
    if (pop < 1500 || !s.needs) return;
    this.pendingNeeds = this.pendingNeeds.filter((p) => this.passes < p.pass + 2);
    // the upkeep of what these rules build (schools, clinics / hospitals, parks) stays within 45 % of income
    let income = 0, upkeep = 0, expense = 0;
    for (const k in st.budget.lastIncome) if (!k.startsWith('oneoff:')) income += st.budget.lastIncome[k];
    for (const k in st.budget.lastExpense) if (!k.startsWith('oneoff:')) expense += st.budget.lastExpense[k];
    for (const k of ['service:education', 'service:health', 'service:parks']) upkeep += st.budget.lastExpense[k] ?? 0;
    if (!this.opts.spendy && income > 0 && upkeep > 0.45 * income) return;
    const MIN_POP: Partial<Record<NeedTier, number>> = { elementary: 1500, high: 6000, health: 2500, college: 15000, play: 3000, green: 1500 };
    /** smallest unserved need (people in the facility's reach) worth a facility */
    const MIN_PEOPLE: Partial<Record<NeedTier, number>> = { elementary: 120, high: 150, health: 500, college: 400, play: 150, green: 600 };
    const tiers: NeedTier[] = ['elementary', 'health', 'high', 'play', 'green', 'college'];
    let placed = 0;
    for (const tier of tiers) {
      if (placed >= 3) break;
      if (pop < (MIN_POP[tier] ?? 0)) continue;
      const n0 = s.needs[tier];
      if (!n0 || !(n0.need > 0)) continue;
      if ((this.svcRetry.get('need:' + tier) ?? -1) > st.day) continue;
      // per home: a deep lot whose front door is reached is served (homeNeed)
      const n = this.homeNeed(tier, 40);
      if (!(n.need > 0)) continue;
      const areaKey = (c: { x: number; z: number }) => ((c.z >> 4) << 12) | (c.x >> 4);
      // a 16x16 area whose cluster had no free site is skipped for a year: the next cluster gets the facility (the bot
      // used to retry the same unplaceable cluster every two months, leaving every other district without a school)
      const skip = (c: { x: number; z: number }) => {
        const key = areaKey(c);
        if ((this.needNoSite.get(tier + ':' + key) ?? -1) > st.day) return true;
        return this.needHistory.filter((h) => h.tier === tier && h.key === key && st.day - h.day < 720).length >= 2;
      };
      /** candidate sites, best first: the clusters by the need a facility there would reach */
      const ranked = (cl: { x: number; z: number; people: number }[], reach: number, minPeople: number, pending: boolean) => {
        const out: { x: number; z: number; people: number }[] = [];
        for (const c of cl) {
          if (pending && this.pendingNeeds.some((p) => p.tier === tier && Math.hypot(p.x - c.x, p.z - c.z) < reach)) continue;
          if (skip(c)) continue;
          let sum = 0;
          for (const o of cl) if (Math.hypot(o.x - c.x, o.z - c.z) <= reach) sum += o.people;
          if (sum >= minPeople) out.push({ x: c.x, z: c.z, people: sum });
        }
        return out.sort((a, b) => b.people - a.people || a.z - b.z || a.x - b.x);
      };
      // clusters are ranked by the need the tier's largest facility would reach there (a big park, a hospital)
      const d0 = getDef(this.needDef(tier, 1e9) ?? '');
      const reach0 = (d0?.coverage?.radius ?? 16) * 0.8;
      let targets: { x: number; z: number; people: number }[] = [];
      if (n.unreached > Math.max(200, 0.03 * n.need)) {
        // the unserved need a facility at a cluster would reach: the clusters (8x8 blocks) within its reach
        targets = ranked(n.clusters, reach0, MIN_PEOPLE[tier] ?? 0, true);
      }
      if (!targets.length && n.served / n.need < 0.9 && !this.pendingNeeds.some((p) => p.tier === tier)) {
        // crowded: beside the most overloaded facility of the tier
        let worst: Building | null = null, wu = 1.1;
        for (const b of st.buildings.values()) {
          if (!(b.flags & BF.Plopped)) continue;
          const l = facilityLoad(this.sim, b.id);
          if (!l || l.needTier !== tier || !(l.utilization > wu)) continue;
          wu = l.utilization; worst = b;
        }
        const w = worst ? { x: worst.x + (worst.w >> 1), z: worst.z + (worst.d >> 1), people: Math.max(0, (wu - 1) * (facilityLoad(this.sim, worst.id)?.capacity ?? 0)) } : null;
        if (w && !skip(w)) targets = [w];
        else if (tier === 'elementary' || tier === 'high' || tier === 'health') {
          // under-served: homes at the edge of a catchment (partial coverage) — a facility where the unserved part of the
          // need is largest (same history / no-site / MIN_PEOPLE rules as unreached clusters)
          targets = ranked(n.gaps, reach0, 2 * (MIN_PEOPLE[tier] ?? 0), false);
        }
      }
      if (!targets.length) continue;
      // up to two sites a month per tier: when the best cluster has no free lot, the next one is tried. A town of 30k+
      // opens a second elementary school (out of the first one's reach, with canAfford's reserve) while more than 5 %
      // of the kids are unreached: growing ~15k a year it opens districts faster than one school a month (128 s7 2010:
      // 6 % unreached). Not earlier, and not for clinics: the early cash went to the first high school (EQ −5…−14).
      const maxBuilt = tier === 'elementary' && pop >= 30000 && n.unreached > 0.05 * n.need ? 2 : 1;
      const builtAt: { x: number; z: number }[] = [];
      let tried = 0;
      for (const target of targets) {
        if (tried >= maxBuilt + 1 || builtAt.length >= maxBuilt || placed >= 3) break;
        if (builtAt.some((p) => Math.hypot(p.x - target.x, p.z - target.z) < reach0)) continue;
        const def = this.needDef(tier, target.people);
        if (!def) break;
        const d = getDef(def)!;
        // schools and clinics come before most other spending: a smaller cash reserve than canAfford's
        const cost = d.cost ?? 0;
        const priority = tier === 'elementary' || tier === 'health';
        const affordable = this.opts.spendy ? this.funds > cost
          : priority && !builtAt.length ? this.funds - cost > 1500 + 0.5 * expense && (this.monthlyNet() + this.pendingUpkeep - (d.upkeep ?? 0) > -0.05 * income || this.funds > 60 * (d.upkeep ?? 0) + 20000)
            : this.canAfford(def);
        if (!affordable) break;
        tried++;
        const reach = Math.max(8, (d.coverage?.radius ?? 16) * 0.9);
        // schools, clinics, playgrounds and parks clear a few small lots when a built-up district has no room left (deep
        // blocks fill their interiors: without clearing a grown district never gets its pocket park)
        const clear = tier !== 'college';
        let built = this.placeCivic(def, target.x, target.z, reach, clear) ? d : null;
        // a built-up district without room for the big facility gets the small one (park / playground / clinic)
        const small = tier === 'green' ? 'park_small' : tier === 'play' ? 'park_playground' : tier === 'health' ? 'civ_clinic' : null;
        if (!built && small && small !== def && this.canAfford(small)) {
          const ds = getDef(small)!;
          if (this.placeCivic(small, target.x, target.z, Math.max(8, (ds.coverage?.radius ?? 16) * 0.9), clear)) built = ds;
        }
        // schools and clinics: a district without a single small lot left loses a pocket park or a few townhouses / small
        // shops (stage 3) for them, like a mayor who buys out a corner — kids stuck without a school for years is worse
        if (!built && priority && this.placeByClearing(def, target.x, target.z, reach, ['P', 'R', 'C'], this.civicAccept(def, target.z), 3, true)) built = d;
        if (built) {
          if (!builtAt.length) placed++; // (a second school / clinic this month leaves the other tiers their places)
          builtAt.push(target);
          this.pendingNeeds.push({ tier, x: target.x, z: target.z, pass: this.passes });
          this.needHistory.push({ tier, key: areaKey(target), day: st.day });
          if (this.needHistory.length > 400) this.needHistory = this.needHistory.filter((h) => st.day - h.day < 720);
          this.say(`${tier}: ${built.name} for ${Math.round(target.people)} people in need near ${Math.round(target.x)},${Math.round(target.z)}`);
        } else {
          this.needNoSite.set(tier + ':' + areaKey(target), st.day + 360);
          this.say(`${tier}: no site for a ${d.name} near ${Math.round(target.x)},${Math.round(target.z)} (${Math.round(target.people)} people in need)`);
        }
      }
      if (!builtAt.length && tried > 0) this.svcRetry.set('need:' + tier, st.day + 60);
    }
    if (this.needNoSite.size > 200) for (const [k, v] of this.needNoSite) if (v <= st.day) this.needNoSite.delete(k);
  }

  // ------------------------------------------------------------------------------------------ emergency response
  /** WP6-3: a fire station / clinic at the largest uncovered hotspot while more than 10 % of residents are out of that
   *  responder's automatic reach */
  ensureResponse(): void {
    const st = this.st, pop = st.stats.population;
    if (pop < 6000) return;
    const em = emergencyOf(this.sim);
    if (!em || !em.active || !em.layersReady) return;
    for (const [r, def] of [['fire', 'civ_fire_station'], ['medical', 'civ_clinic']] as const) {
      if ((this.svcRetry.get('resp:' + r) ?? -1) > st.day || !this.canAfford(def)) continue;
      const layer = r === 'fire' ? st.respFire : st.respMedical;
      let out = 0, tot = 0;
      for (const b of st.buildings.values()) {
        if (b.pop <= 0) continue;
        tot += b.pop;
        if (layer[Math.min(this.N - 1, b.z + (b.d >> 1)) * this.N + Math.min(this.N - 1, b.x + (b.w >> 1))] < 0) out += b.pop;
      }
      if (tot <= 0 || out / tot <= 0.1) continue;
      const h = uncoveredHotspots(this.sim, r, 1)[0];
      if (!h) continue;
      const ok = this.placeCivic(def, h.x, h.z, 14);
      this.svcRetry.set('resp:' + r, st.day + (ok ? 90 : 150));
      if (ok) this.say(`${def === 'civ_clinic' ? 'clinic' : 'fire station'}: ${Math.round((100 * out) / tot)} % of residents beyond ${r} response`);
    }
  }

  // ------------------------------------------------------------------------------------------ justice
  /** WP6-3: a prison when more than 25 % of sentenced offenders find no bed (15 % once a prison stands: JAIL_OVERFLOW_MORE)
   *  — in an industrial / utility block, never
   *  within 12 cells of wealthy (R$$$) homes (stigma, crime spill). It runs before zoning: a prison is lumpy ($12k) and
   *  a growing town's income goes to new blocks, so it may use the investment reserve, and while it is short its price
   *  is held back from zoning (an overflowing justice system costs every police station up to 30 % of its effect). */
  ensureJustice(): void {
    const st = this.st, j = st.stats.justice;
    this.jailHold = 0;
    const limit = this.count('civ_jail') > 0 ? JAIL_OVERFLOW_MORE : JAIL_OVERFLOW_FIRST;
    if (!j || !(j.overflow > limit) || !st.unlocked.has('jail') || (this.svcRetry.get('jail') ?? -1) > st.day) {
      this.jailSaving = false;
      return;
    }
    const jd = getDef('civ_jail'), cost = jd?.cost ?? 0, up = jd?.upkeep ?? 0;
    const carry = this.monthlyNet() + this.pendingUpkeep - up > 0 || this.funds > 60 * up + 50000;
    if (!this.canAfford('civ_jail') && !(carry && this.canInvest(cost))) {
      if (carry && !this.jailSaving) this.say(`saving for a prison ($${cost}): ${Math.round(j.overflow * 100)} % of the sentenced have no bed`);
      if (carry) this.jailHold = cost;
      this.jailSaving = carry;
      return;
    }
    this.jailSaving = false;
    const ov = Math.round(j.overflow * 100); // (before the plop: placing a prison refreshes stats.justice)
    const rich: { x: number; z: number }[] = [];
    for (const b of st.buildings.values()) if (!(b.flags & BF.Plopped) && b.wealth === 3 && getDef(b.def)?.devType === DevType.R3) rich.push({ x: b.x, z: b.z });
    const cx = this.line(this.cbx) + 5 * GRID, cz = this.trunkZ;
    // never within JAIL_GAP cells of R$$$ homes (PART_B item 38 d: the prison's stigma reaches 10 cells, crime spills)
    const G = JAIL_GAP;
    const far = (x: number, z: number, w: number, d: number) => !rich.some((r) => r.x >= x - G && r.x < x + w + G && r.z >= z - G && r.z < z + d + G);
    let ok = !!this.placeNear('civ_jail', cx, cz, ['I', 'U'], true, Infinity, true, far), cleared = false;
    // a full map: bulldoze a few small factories / sheds in an industrial / utility block for the prison
    if (!ok) ok = cleared = !!this.placeByClearing('civ_jail', cx, cz, Infinity, ['I', 'U'], far);
    // a built-up city (no stage <= 2 lot left in the industrial / utility blocks): stage-3 lots too, on either side of the
    // trunk, as for water, power and depots — still JAIL_GAP cells from R$$$ homes (256x60 s7 kept 16,000 beds from 2032
    // on and ran 59 % of the sentenced without a bed in 2053; with it 40,000 beds, overflow <= 0.24)
    if (!ok) ok = cleared = !!this.placeByClearing('civ_jail', cx, cz, Infinity, ['I', 'U'], far, 3, false, true);
    this.svcRetry.set('jail', st.day + (ok ? 240 : 120));
    if (ok) this.say(`prison: ${ov} % of the sentenced had no bed (${cleared ? 'small industrial lots cleared, ' : ''}${G}+ cells from R$$$ homes)`);
    else this.say(`prison: no industrial / utility lot ${G}+ cells from R$$$ homes (${ov} % without a bed)`);
  }

  // ------------------------------------------------------------------------------------------ transit (item 38c)
  /** block key -> day until which it gets no new stop (placed: a year; no site: half a year) */
  private stopRetry = new Map<string, number>();
  /** stops placed in the last ~4 months (their coverage shows only after the next services pass) */
  private recentStops: { x: number; z: number; day: number }[] = [];
  /**
   * Bus service from 20k people: a stop for every developed R / C block whose centre has no transit coverage and no stop
   * within walking distance — the blocks with the most residents / jobs first, up to 5 a month (8 above 150k): on a free
   * frontage cell of any side (avenue sides first), else in place of the smallest home / shop on the block's edge (a grown
   * district has no free frontage; the old rule tried each block once, on avenue sides only, and a 188k city had 2
   * stops). A depot whenever the fleet needs more than 110 % of the buses it has, and (once unlocked) a garage beside a
   * stop for a commercial block under parking pressure > 0.6.
   */
  ensureTransit(): void {
    const st = this.st, pop = st.stats.population;
    if (pop < 20000) return;
    const N = this.N;
    let stops = 0;
    if (this.canSpend(2000)) {
      const maxStops = pop > 150000 ? 8 : 5;
      this.recentStops = this.recentStops.filter((p) => st.day - p.day < 120);
      const have: { x: number; z: number }[] = [...this.recentStops];
      for (const b of st.buildings.values()) if (b.def === 'tr_bus_stop' || b.def === 'tr_subway_station' || b.def === 'tr_train_station') have.push({ x: b.x, z: b.z });
      const cands: { b: Block; p: number }[] = [];
      for (const b of this.blocks) {
        if (!b.developed || (b.use !== 'R' && b.use !== 'C') || b.zone === Zone.None) continue;
        if ((this.stopRetry.get(b.bx + ',' + b.bz) ?? -1) > st.day) continue;
        const cx = (b.x0 + b.x1) >> 1, cz = (b.z0 + b.z1) >> 1;
        if (st.transitCov[cz * N + cx] >= 0.25) continue;
        if (have.some((q) => Math.abs(q.x - cx) + Math.abs(q.z - cz) <= 7)) continue;
        let p = 0;
        for (let z = b.z0; z < b.z1; z += 2) for (let x = b.x0; x < b.x1; x += 2) {
          const id = st.building[z * N + x];
          const o = id >= 0 ? st.buildings.get(id) : undefined;
          if (o) p += o.pop + 0.5 * o.jobs;
        }
        if (p > 0) cands.push({ b, p });
      }
      cands.sort((a, c) => c.p - a.p || a.b.ring - c.b.ring);
      for (const { b } of cands) {
        if (stops >= maxStops || !this.canSpend(2000)) break;
        const cx = (b.x0 + b.x1) >> 1, cz = (b.z0 + b.z1) >> 1;
        if (have.some((q) => Math.abs(q.x - cx) + Math.abs(q.z - cz) <= 7)) continue; // (a stop placed this month)
        const at = this.placeStop(b) ?? (this.placeByClearing('tr_bus_stop', cx, cz, 4, ['R', 'C']) ? this.lastCleared : null);
        this.stopRetry.set(b.bx + ',' + b.bz, st.day + (at ? 360 : 180));
        if (!at) continue;
        stops++;
        this.recentStops.push({ x: at.x, z: at.z, day: st.day });
        have.push(at);
      }
      if (stops) this.say(`built ${stops} bus stop${stops > 1 ? 's' : ''}`);
    }
    // depot: the fleet runs short (a full map: clear small industrial / commercial lots for it; a grown city, where none
    // is left at stage ≤ 2, also stage-3 lots on either side of the trunk — 256×60 s11 ran 288 buses for 447 needed from
    // 2038 on: a depot's road reach crosses the highway)
    const f = st.stats.transitFleet;
    if (f && f.busesNeeded > 1.1 * Math.max(1, f.buses) && (this.svcRetry.get('depot') ?? -1) <= st.day && this.canAfford('civ_bus_depot')) {
      const cx = this.line(this.cbx), cz = this.line(this.cbz);
      const ok = this.placeNear('civ_bus_depot', cx, cz, ['P', 'U', 'I'], true, Infinity, true) || this.placeByClearing('civ_bus_depot', cx, cz, Infinity, ['I', 'C'])
        || this.placeByClearing('civ_bus_depot', cx, cz, Infinity, ['I', 'C', 'R'], undefined, 3, false, true);
      this.svcRetry.set('depot', st.day + (ok ? 120 : 180));
      if (ok) this.say(`bus depot: ${Math.round(f.busesNeeded)} buses needed, ${f.buses} running`);
    }
    // garages beside stops for commercial blocks under parking pressure
    if (st.unlocked.has('parking_garage') && (this.svcRetry.get('garage') ?? -1) <= st.day && this.canAfford('tr_parking_garage')) {
      const stopsAt: { x: number; z: number }[] = [];
      for (const b of st.buildings.values()) if (b.def === 'tr_bus_stop' || b.def === 'tr_subway_station' || b.def === 'tr_train_station') stopsAt.push({ x: b.x, z: b.z });
      for (const b of this.blocks) {
        if (!b.developed || b.use !== 'C') continue;
        let pk = 0, n = 0;
        for (let z = b.z0; z < b.z1; z += 2) for (let x = b.x0; x < b.x1; x += 2) { pk += st.parking[z * N + x]; n++; }
        if (n === 0 || pk / n <= 0.6) continue;
        const stop = stopsAt.find((s) => s.x >= b.x0 - 4 && s.x < b.x1 + 4 && s.z >= b.z0 - 4 && s.z < b.z1 + 4);
        if (!stop) continue;
        const near = (x: number, z: number, w: number, d: number) => Math.abs(x + w / 2 - stop.x) + Math.abs(z + d / 2 - stop.z) <= 6;
        const ok = this.placeNear('tr_parking_garage', stop.x, stop.z, ['C', 'R', 'P'], false, 10, true, near);
        this.svcRetry.set('garage', st.day + (ok ? 60 : 120));
        if (ok) { this.say(`parking garage beside a stop (block parking ${(pk / n).toFixed(2)})`); break; }
      }
    }
  }

  // ------------------------------------------------------------------------------------------ noise buffers
  /** tree buffers along the highway while more than 5 % of homes are Noisy: free cells within 2 of highway cells */
  treeBuffers(): void {
    const st = this.st, N = this.N;
    if (!this.highway || (this.svcRetry.get('trees') ?? -1) > st.day || !this.canSpend(3000)) return;
    let homes = 0, noisy = 0;
    for (const b of st.buildings.values()) {
      if (b.pop <= 0 || b.flags & BF.Plopped) continue;
      homes++;
      if (b.flags & BF.Noisy) noisy++;
    }
    this.svcRetry.set('trees', st.day + 180);
    if (homes === 0 || noisy / homes <= 0.05) return;
    let planted = 0;
    const z0 = this.trunkZ;
    for (const dz of [-2, -1, 1, 2]) {
      const z = z0 + dz;
      if (z < 0 || z >= N) continue;
      let run = -1;
      for (let x = 0; x <= N; x++) {
        const i = z * N + x;
        const free = x < N && st.building[i] < 0 && st.network[i] === Network.None && !st.water[i] && st.trees[i] < 3;
        if (free && run < 0) run = x;
        if ((!free || x === N) && run >= 0) {
          if (x - run >= 1 && this.canSpend(1000)) { const r = this.A.plantTrees({ x0: run, z0: z, x1: x, z1: z + 1 }); if (r.ok) planted += r.affected ?? 0; }
          run = -1;
        }
      }
    }
    if (planted) this.say(`planted ${planted} buffer trees along the highway (${Math.round((100 * noisy) / homes)} % of homes noisy)`);
  }

  /** center of a developed residential block with no big park (R cap relief ≥ 4,000) or landmark within 10 cells
   *  (nearest the center first) */
  uncoveredPark(): { x: number; z: number } | null {
    // (only big parks and landmarks count: the pocket parks and playgrounds of the need rules relieve the R cap little)
    const parks = this.services.filter((s) => s.def.startsWith('lm_') || (s.def.startsWith('park_') && (CAP_RELIEF[s.def]?.R ?? 0) >= 4000));
    let best: { x: number; z: number } | null = null, bd = Infinity;
    for (const b of this.blocks) {
      if (!b.developed || b.use !== 'R' || b.zone === Zone.None) continue;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      if (parks.some((s) => Math.hypot(s.x - cx, s.z - cz) <= 10)) continue;
      if (b.ring < bd) { bd = b.ring; best = { x: cx, z: cz }; }
    }
    return best;
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
        if (!this.canInvest(2500)) break;
        this.develop(b);
        this.say(`developed ${use} block (${b.bx},${b.bz}) as zone ${b.zone}`);
      }
    }
    // out of land with high unemployment: convert an outer residential block next to industry into jobs land
    const iDem = Math.max(d[DevType.ID], d[DevType.IM], d[DevType.IHT]);
    if (s.unemployment > 0.1 && iDem > 0.4 && !this.blocks.some((b) => !b.developed && (b.use === 'I' || b.use === 'R')) &&
      st.day - this.lastConvert > 180 && this.canInvest(5000)) {
      const cand = this.blocks.filter((b) => b.developed && b.use === 'R' && b.zone !== Zone.None &&
        [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => this.byKey.get(b.bx + dx + ',' + (b.bz + dz))?.use === 'I'))
        .sort((a, b) => b.ring - a.ring)[0];
      if (cand) {
        const z = d[DevType.IHT] >= Math.max(d[DevType.ID], d[DevType.IM]) ? Zone.IndHigh : Zone.IndMed;
        if (this.A.zone({ x0: cand.x0, z0: cand.z0, x1: cand.x1, z1: cand.z1 }, z).ok) {
          cand.use = 'I'; cand.zone = z; this.lastConvert = st.day;
          this.say(`converted residential block (${cand.bx},${cand.bz}) to industry (unemployment ${(s.unemployment * 100).toFixed(0)}%)`);
        }
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
    // parks: coverage of residential blocks + more when the R cap binds
    const rBinding = binding(0, 2);
    let placed = 0;
    // park upkeep budget: ≤ 8% of income unless the residential cap binds
    let income = 0;
    for (const k in st.budget.lastIncome) if (!k.startsWith('oneoff:')) income += st.budget.lastIncome[k];
    if (!rBinding && ((st.budget.lastExpense['service:parks'] ?? 0) > income * 0.08 || !this.canSpend(8000))) return this.capsCI(binding, pop);
    for (let k = 0; k < (rBinding ? 3 : 1) && placed < 2; k++) {
      const big = pop > 4000 && this.canSpend(3000);
      const def = st.unlocked.has('zoo') && this.count('park_zoo') < 1 + Math.floor(pop / 250000) && this.canSpend(20000) ? 'park_zoo'
        : big ? 'park_large' : pop > 1500 ? 'park_plaza' : 'park_small';
      const target = this.uncoveredPark() ?? (rBinding ? center : null);
      if (!target || !this.canAfford(def)) break;
      // 1) civic/park blocks nearby, 2) empty zoned lots inside residential blocks (small parks / plazas),
      // 3) turn an adjacent undeveloped block into a park block
      let ok = this.placeNear(def, target.x, target.z, ['P'], true, 20);
      // while the R cap binds a big park is worth a few bulldozed small homes (a grown district has no free 4x4 lot)
      if (!ok && rBinding && def === 'park_large') ok = this.placeCivic(def, target.x, target.z, 20, true);
      if (!ok) ok = this.placeNear(pop > 1500 ? 'park_plaza' : 'park_small', target.x, target.z, ['R', 'C'], false, 12);
      if (!ok) {
        const nb = this.blocks.filter((b) => !b.developed && b.use === 'R' && this.touchesDeveloped(b))
          .sort((a, b) => Math.hypot(a.x0 - target.x, a.z0 - target.z) - Math.hypot(b.x0 - target.x, b.z0 - target.z))[0];
        if (nb && Math.hypot(nb.x0 - target.x, nb.z0 - target.z) < 30) { nb.use = 'P'; ok = this.placeNear(def, target.x, target.z, ['P'], true, 30); }
      }
      if (ok) placed++;
      else break;
    }
    this.capsCI(binding, pop);
  }

  capsCI(binding: (a: number, b: number) => boolean, pop: number): void {
    const st = this.st;
    // commercial caps
    if (binding(3, 7)) {
      if (st.unlocked.has('airport_small') && this.count('tr_airport_small') === 0 && this.canSpend(30000)) this.placeAirport('tr_airport_small');
      else if (st.unlocked.has('airport_large') && this.count('tr_airport_large') < 1 && this.canSpend(150000)) this.placeAirport('tr_airport_large');
    }
    // industrial caps
    if (binding(8, 11)) {
      if (this.count('tr_freight_station') < 1 + Math.floor(pop / 150000) && this.canSpend(5000 + 30 * this.N)) this.freightRail();
      else if (st.unlocked.has('seaport') && this.count('tr_seaport') === 0 && this.canSpend(60000)) this.placeShore('tr_seaport');
      else this.extraConnection();
    }
  }

  private railBuilt = false;
  private lastConvert = -1e9;
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

  /** airports: small one in the first airport block, the international one across the other two (interior road removed) */
  placeAirport(defId: string): void {
    const all = this.blocks.filter((b) => b.use === 'A').sort((a, b) => a.bx - b.bx);
    if (all.length < 3) return;
    const blocks = defId === 'tr_airport_small' ? [all[0]] : all.slice(1, 3);
    const xs = Math.min(...blocks.map((b) => b.x0)), xe = Math.max(...blocks.map((b) => b.x1));
    const zs = Math.min(...blocks.map((b) => b.z0)), ze = Math.max(...blocks.map((b) => b.z1));
    this.road(xs - 1, zs - 1, xe, zs - 1, Network.Road);
    this.road(xs - 1, ze, xe, ze, Network.Road);
    this.road(xs - 1, zs - 1, xs - 1, ze, Network.Road);
    this.road(xe, zs - 1, xe, ze, Network.Road);
    // clear interior lines between merged blocks
    for (let k = 1; k < blocks.length; k++) {
      const lx = blocks[k].x0 - 1;
      this.A.bulldoze({ x0: lx, z0: zs, x1: lx + 1, z1: ze });
    }
    for (const b of blocks) b.developed = true;
    const def = getDef(defId)!;
    for (const rot of [0, 2, 1, 3] as const) {
      const [w, d] = rotatedFootprint(def, rot);
      for (let z = zs; z + d <= ze; z++) for (let x = xs; x + w <= xe; x++) {
        const p = this.A.plop(defId, x, z, rot, true);
        if (p.ok && !p.reason) { this.A.plop(defId, x, z, rot); this.services.push({ def: defId, x: x + (w >> 1), z: z + (d >> 1) }); this.say(`built ${def.name}`); return; }
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
      } else if (b.use === 'I' && b.zone === Zone.IndMed && s.demand[DevType.IHT] > 0.4 && s.demand[DevType.ID] < 0 && b.ring >= 5) target = Zone.IndHigh;
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
        for (let d = 0; d < 30; d++) { this.sim.advanceDay(); this.days++; this.daily(); }
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
      const coh = s.cohorts ?? [0, 0, 0, 0, 0];
      const cohTot = coh[0] + coh[1] + coh[2] + coh[3] + coh[4];
      const share = (t: NeedTier) => { const n = s.needs?.[t]; return n && n.need > 0 ? n.served / n.need : 0; };
      const row: YearRow = {
        year: st.year, pop: s.population, funds: Math.round(st.funds), income: Math.round(inc), expense: Math.round(exp),
        dR: avg(s.demand, 0, 2), dC: avg(s.demand, 3, 7), dI: avg(s.demand, 8, 11), eq: s.eq, commute: s.avgCommute,
        buildings: s.buildingCount, jobs, unemployment: s.unemployment, approval: s.approval,
        econMsPerDay: (this.econTime - e0) / days, totalMsPerDay: (this.totalTime - t0) / days, maxStage, access: this.rt?.accessAvg ?? -1,
        kidsPct: cohTot > 0 ? coh[0] / cohTot : 0, senPct: cohTot > 0 ? coh[4] / cohTot : 0,
        enrolE: share('elementary'), enrolH: share('high'), tourists: s.tourists ?? 0, attr: s.attractiveness ?? 0,
      };
      e0 = this.econTime; t0 = this.totalTime; d0 = this.days;
      this.rows.push(row);
      onYear?.(row);
      if (process.env.SIMBOT_PROFILE) {
        console.log('   ms/day:', Object.entries(this.yearBySystem).filter(([k]) => k.startsWith('economy.')).map(([k, v]) => `${k.slice(8)} ${(v / days).toFixed(3)}`).join(' | '));
      }
      this.yearBySystem = {};
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
    String(r.maxStage).padStart(3), r.access.toFixed(2).padStart(5),
    (r.kidsPct * 100).toFixed(0).padStart(4) + '%', (r.senPct * 100).toFixed(0).padStart(3) + '%', (r.enrolE * 100).toFixed(0).padStart(4) + '%',
    (r.enrolH * 100).toFixed(0).padStart(4) + '%', k(r.tourists).padStart(6), r.attr.toFixed(0).padStart(4),
    r.econMsPerDay.toFixed(2).padStart(6), r.totalMsPerDay.toFixed(1).padStart(7),
  ].join(' ');
}
export const HEADER = 'year      pop    funds  income expense   dR     dC     dI    EQ  com   bldg    jobs unem appr stg   acc kids%  sen% enrE% enrH%  tourist attr econms totalms';

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
    else if (a === '--tax') { o.tax = +v; i++; }
    else if (a === '--spendy') o.spendy = true;
    else if (a === '--neglect') o.neglect = true;
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
