/**
 * RCI demand (SC4 style) → stats.demand[dev] ∈ [-1, 1] (smoothed), stats.demandCap[dev], and absolute demand
 * (capacity units) in systemData.economy.demandAbs used by growth. See tuning.ts DEMAND section for the model.
 *
 * Summary:
 *  - R demand comes from jobs (jobs > workers → R up) + regional attraction; unemployment pushes R down.
 *    SIM_DEPTH_SPEC WP4: the whole R target of each wealth tier × MIGRATION (attractiveness, tourism.ts), plus retirees
 *    and university students who come without local jobs (econData.migrants). The actual workforce ratio (WP1,
 *    rt.workforceRatio) converts jobs into residents.
 *  - CS from residents (customers by wealth) + TOURISM (econData.tourism = CS jobs from effective tourists, tourism.ts);
 *    CO from the workforce, city size, EQ and connectivity.
 *  - Industry: export demand (region/world, boosted by neighbor connections, freight stations, seaport, airports)
 *    + workforce share; EQ shifts dirty → high-tech. Unemployment pushes C/I up.
 *  - REGIONAL PLAY (WP4-1): founded neighbour cities (state.systemData.region, src/region/regionEffects.ts) change the
 *    targets like SC4 — a neighbouring job centre raises R, a neighbouring bedroom town raises C / I, neighbouring
 *    residents shop here, a big region widens the industrial market, and neighbours relieve the caps. Every effect is
 *    scaled by how well the shared edge is connected (EDGE_CONN: highway 1 … street .3, none .1).
 *    Terms → econData.regionTerms (WP5 RCI tooltip). An isolated city gets bit-identical demand.
 *  - Taxes lower targets per DevType (wealthy more sensitive), ordinances multiply them.
 *  - Caps: base + relief from parks / landmarks / airports / seaports / connections (catalog CAP_RELIEF). Relief only
 *    counts while the building works (not burnt, powered when it needs power, a road next to tourist venues, × funding)
 *    and × its use factor (WP7); the withheld relief and why (DemandContext.reliefLost / reliefIssues) feed capHints.
 */
import type { SimSystem } from '../Simulation';
import type { CityState } from '../CityState';
import { BF } from '../CityState';
import { clamp, lerp, smoothstep } from '../../core/rng';
import { DEV_TYPE_COUNT, DevType } from '../../core/types';
import { CAP_RELIEF, devFamily } from '../catalog';
import {
  APPROVAL_R, BASE_CAP, CAP_BINDING, CAP_POP_FRAC, CAP_SOFTMIN_K, CAP_WEIGHT, CIVIC_WEALTH_MIX, CO3_FRAC_MAX, CO3_FRAC_MIN,
  CO_SHARE_MAX, CO_SHARE_MIN, CO_SHARE_POP_FULL, CO_SHARE_POP_START, CONN_BASE, CONN_CAP_RELIEF, CONN_MAX, CONN_WEIGHT,
  CS_BASE, CS_PER_RES, CS_SMALL_TOWN_BOOST, CS_SMALL_TOWN_POP, CUSTOMER_MIX, DEMAND_ABS_EMA, DEMAND_EMA, DEMAND_NORM_FRAC, DEMAND_NORM_MIN,
  EDGE_CONN, EDGE_NONE, FREIGHT_BOOST, FREIGHT_BOOST_MAX, I_BASE, I_SHARE_MAX, I_SHARE_MIN, IA_BASE, IA_PER_RES, ID_EQ_START,
  ID_SHARE_AT_EQ0, ID_SHARE_EQ_SLOPE, ID_SHARE_MIN, IHT_EQ_START, IHT_SHARE_MAX, IHT_SHARE_PER_EQ, JOB_MIX_AVG, JOB_SLACK,
  JOB_WEALTH_MIX, R_BASE, R_JOB_SLACK, REGION_WEALTH_MIX, RG_CAP, RG_CI, RG_CI_SPLIT, RG_CS, RG_CS_MAX, RG_MARKET, RG_MARKET_POP,
  RG_R, TAX_FACTOR_MAX, TAX_FACTOR_MIN, TAX_NEUTRAL, TAX_SENS, TOURISM_CS_PER_POINT, TOURISM_CS_SPLIT, UNEMP_CI_BOOST,
  UNEMP_NEUTRAL, UNEMP_R_PENALTY, WORKFORCE_RATIO,
} from './tuning';
import { type EconRuntime, type RegionTerms, econData, infraFlags } from './runtime';
import { ordinanceEffect } from './ordinances';
import { venueIssue, venueOp } from './tourism';
import { facilityUseFactor } from '../infra/facilities';
import type { RegionContext, RegionNeighbor } from '../../region/regionEffects';

const DEV_ENUM = ['R1', 'R2', 'R3', 'CS1', 'CS2', 'CS3', 'CO2', 'CO3', 'IA', 'ID', 'IM', 'IHT'];

export interface DemandContext {
  connR: number;
  connC: number;
  connI: number;
  freightBoost: number;
  /**
   * LEGACY tourism points (cap-relief C × 0.05 + ordinance 'add.tourism'), kept only for comparison with the new venue
   * model (WP6 acceptance: tourism jobs within ±30 % of this). The demand model uses econData.tourism.
   */
  tourism: number;
  /** family-level cap relief from buildings + connections */
  relief: { R: number; C: number; I: number; R3: number; IHT: number; CO3: number };
  /**
   * cap relief withheld because relief buildings work below full strength (burnt / closed, unpowered, no road,
   * underfunded, on strike, little used), per family (R3 / IHT / CO3 relief counted in R / I / C), and why:
   * issue -> number of buildings (capHints tells the player)
   */
  reliefLost: { R: number; C: number; I: number };
  reliefIssues: { R: Record<string, number>; C: Record<string, number>; I: Record<string, number> };
}

/** the last demand context per state (capHints reads the withheld relief; derived, not saved) */
const contexts = new WeakMap<CityState, DemandContext>();

/** connection factors, freight boosts and cap relief from plopped buildings + neighbor connections */
export function demandContext(st: CityState, rt: EconRuntime): DemandContext {
  let cR = CONN_BASE.R, cC = CONN_BASE.C, cI = CONN_BASE.I;
  const relief = { R: 0, C: 0, I: 0, R3: 0, IHT: 0, CO3: 0 };
  const lost = { R: 0, C: 0, I: 0 };
  const issues: DemandContext['reliefIssues'] = { R: {}, C: {}, I: {} };
  for (const c of st.neighborConnections) {
    const w = CONN_WEIGHT[c.type];
    if (w) { cR += w.R; cC += w.C; cI += w.I; }
    const r = CONN_CAP_RELIEF[c.type];
    if (r) { relief.R += r.R; relief.C += r.C; relief.I += r.I; }
  }
  const inf = infraFlags(st);
  let freight = 0, tourism = 0;
  for (const b of rt.plopped) {
    const r = CAP_RELIEF[b.def];
    const f = FREIGHT_BOOST[b.def];
    if (!r && !f) continue;
    const def = rt.defOf(b);
    // relief follows use (WP4-3): a working (powered, road-connected, funded) building × its use factor (WP7)
    const k = b.flags & BF.Burnt ? 0 : def ? venueOp(st, b, def, inf) * facilityUseFactor(st, b) : 1;
    if (r) {
      relief.R += (r.R ?? 0) * k; relief.C += (r.C ?? 0) * k; relief.I += (r.I ?? 0) * k;
      relief.R3 += (r.R3 ?? 0) * k; relief.IHT += (r.IHT ?? 0) * k; relief.CO3 += (r.CO3 ?? 0) * k;
      if (!(b.flags & BF.Burnt)) tourism += (r.C ?? 0) * 0.05; // legacy comparison number: unchanged formula
      if (k < 0.999) {
        const why = (b.flags & BF.Burnt) || !def ? 'closed' : venueIssue(st, b, def, inf) ?? 'use';
        const add = (fam: 'R' | 'C' | 'I', v: number) => {
          if (!(v > 0)) return;
          lost[fam] += v * (1 - k);
          issues[fam][why] = (issues[fam][why] ?? 0) + 1;
        };
        add('R', (r.R ?? 0) + (r.R3 ?? 0));
        add('C', (r.C ?? 0) + (r.CO3 ?? 0));
        add('I', (r.I ?? 0) + (r.IHT ?? 0));
      }
    }
    if (f) freight += f * k;
  }
  tourism += ordinanceEffect(st, 'add.tourism') * st.stats.population / 1000;
  const ctx: DemandContext = {
    connR: Math.min(CONN_MAX.R, cR),
    connC: Math.min(CONN_MAX.C, cC),
    connI: Math.min(CONN_MAX.I, cI),
    freightBoost: Math.min(FREIGHT_BOOST_MAX, freight),
    tourism: tourism * TOURISM_CS_PER_POINT,
    relief,
    reliefLost: lost,
    reliefIssues: issues,
  };
  contexts.set(st, ctx);
  return ctx;
}

export function taxFactor(dev: number, rate: number): number {
  return clamp(1 - TAX_SENS[dev] * (rate - TAX_NEUTRAL) / TAX_NEUTRAL, TAX_FACTOR_MIN, TAX_FACTOR_MAX);
}

function softmin(t: number, cap: number): number {
  if (t <= 0) return t;
  if (cap <= 0) return 0;
  const k = CAP_SOFTMIN_K;
  return (t * cap) / Math.pow(Math.pow(t, k) + Math.pow(cap, k), 1 / k);
}

// ------------------------------------------------------------------------------------------------ regional play
/**
 * How well this city reaches neighbour `n`: the best EDGE_CONN of our neighbour connections on the shared edge segment
 * (the along-edge coordinate x for n / s, z for e / w inside [n.from, n.to)), EDGE_NONE without a connection.
 */
export function edgeFactor(st: CityState, n: Pick<RegionNeighbor, 'edge' | 'from' | 'to'>): number {
  let f = 0;
  for (const c of st.neighborConnections) {
    if (c.edge !== n.edge) continue;
    const a = n.edge === 'n' || n.edge === 's' ? c.x : c.z;
    if (a < n.from || a >= n.to) continue;
    const e = EDGE_CONN[c.type] ?? 0;
    if (e > f) f = e;
  }
  return f > 0 ? f : EDGE_NONE;
}

/** regional inputs of the demand model (edge-weighted neighbour sums); null for an isolated city */
export interface RegionInputs {
  /** Σ max(0, n.jobs − n.workers) × edgeF — neighbour jobs our residents could take */
  jobSurplus: number;
  /** Σ max(0, n.workers − n.jobs) × edgeF — neighbour workers looking for jobs here */
  workerSurplus: number;
  /** Σ_r n.pop × REGION_WEALTH_MIX_r × CUSTOMER_MIX[r][w] × edgeF — neighbour shoppers per CS tier */
  customers: [number, number, number];
  /** Σ edgeF × n.pop */
  reachPop: number;
  /** industrial market multiplier (1 + RG_MARKET × min(1, region pop / RG_MARKET_POP)) */
  market: number;
  /** per neighbour tile: best edge factor (for the UI / advisors, e.g. "connect a highway on the north edge") */
  neighbors: { tileKey: string; name: string | null; edge: string; edgeF: number; population: number; jobs: number; workers: number }[];
}

export function regionInputs(st: CityState): RegionInputs | null {
  const reg = st.systemData.region as RegionContext | undefined;
  if (!reg || !Array.isArray(reg.neighbors)) return null;
  // one entry per shared edge segment; a tile is counted once with its best-connected segment
  const best = new Map<string, { n: RegionNeighbor; f: number }>();
  for (const n of reg.neighbors) {
    if (!n.founded) continue;
    const f = edgeFactor(st, n);
    const cur = best.get(n.tileKey);
    if (!cur || f > cur.f) best.set(n.tileKey, { n, f });
  }
  const market = 1 + RG_MARKET * Math.min(1, Math.max(0, reg.population ?? 0) / RG_MARKET_POP);
  if (best.size === 0 && market === 1) return null;
  let jobSurplus = 0, workerSurplus = 0, reachPop = 0;
  const customers: [number, number, number] = [0, 0, 0];
  const neighbors: RegionInputs['neighbors'] = [];
  for (const { n, f } of best.values()) {
    const jobs = Math.max(0, n.jobs || 0), workers = Math.max(0, n.workers || 0), p = Math.max(0, n.population || 0);
    jobSurplus += Math.max(0, jobs - workers) * f;
    workerSurplus += Math.max(0, workers - jobs) * f;
    reachPop += p * f;
    for (let w = 0; w < 3; w++) {
      let c = 0;
      for (let r = 0; r < 3; r++) c += p * REGION_WEALTH_MIX[r] * CUSTOMER_MIX[r][w];
      customers[w] += c * f;
    }
    neighbors.push({ tileKey: n.tileKey, name: n.name, edge: n.edge, edgeF: f, population: p, jobs, workers });
  }
  return { jobSurplus, workerSurplus, customers, reachPop, market, neighbors };
}

// ------------------------------------------------------------------------------------------------ the system
export function demandSystem(rt: EconRuntime): SimSystem {
  let ctx: DemandContext | null = null;
  const raw = new Float64Array(DEV_TYPE_COUNT);
  const cap = new Float64Array(DEV_TYPE_COUNT);
  const cur = new Float64Array(DEV_TYPE_COUNT);
  /** regional additions per DevType before modifiers (capacity units) */
  const reg = new Float64Array(DEV_TYPE_COUNT);
  /** product of all multiplicative modifiers applied after the additions, per DevType */
  const mods = new Float64Array(DEV_TYPE_COUNT);

  const compute = (st: CityState, first: boolean) => {
    if (!ctx || rt.capsDirty) { ctx = demandContext(st, rt); rt.capsDirty = false; }
    const data = econData(st);
    const t = rt.totals;
    const s = st.stats;
    const P = t.population;
    const wr = rt.workforceRatio > 0 ? rt.workforceRatio : WORKFORCE_RATIO;
    const W = P * wr;
    const EQ = s.eq;
    const rates = st.budget.taxRates;
    const u = s.unemployment;
    const excessU = Math.max(0, u - UNEMP_NEUTRAL);
    const rin = regionInputs(st);
    reg.fill(0);
    // ---- job targets
    const logF = P <= CO_SHARE_POP_START ? 0 : clamp(Math.log(P / CO_SHARE_POP_START) / Math.log(CO_SHARE_POP_FULL / CO_SHARE_POP_START), 0, 1);
    const smallTown = 1 + CS_SMALL_TOWN_BOOST * (1 - smoothstep(0, CS_SMALL_TOWN_POP, P));
    // customers per CS tier + tourism (CS jobs from effective tourists, WP4)
    const tourismJobs = Math.max(0, data.tourism || 0);
    for (let w = 0; w < 3; w++) {
      let customers = 0;
      for (let r = 0; r < 3; r++) customers += t.pop[r] * CUSTOMER_MIX[r][w];
      raw[DevType.CS1 + w] = (CS_BASE[w] + CS_PER_RES[w] * customers) * smallTown + tourismJobs * TOURISM_CS_SPLIT[w];
    }
    const eqF = 0.6 + 0.8 * smoothstep(0, 100, EQ);
    const co = W * lerp(CO_SHARE_MIN, CO_SHARE_MAX, logF) * eqF * ctx.connC;
    const f3 = lerp(CO3_FRAC_MIN, CO3_FRAC_MAX, smoothstep(60, 130, EQ));
    raw[DevType.CO2] = co * (1 - f3);
    raw[DevType.CO3] = co * f3;
    const iTotal = (I_BASE + W * lerp(I_SHARE_MAX, I_SHARE_MIN, logF)) * ctx.connI * (1 + ctx.freightBoost);
    const sID = clamp(ID_SHARE_AT_EQ0 - Math.max(0, EQ - ID_EQ_START) * ID_SHARE_EQ_SLOPE, ID_SHARE_MIN, 1);
    const sIHT = clamp((EQ - IHT_EQ_START) * IHT_SHARE_PER_EQ, 0, IHT_SHARE_MAX);
    const sIM = Math.max(0.1, 1 - sID - sIHT);
    raw[DevType.ID] = iTotal * sID;
    raw[DevType.IM] = iTotal * sIM;
    raw[DevType.IHT] = iTotal * sIHT;
    raw[DevType.IA] = (IA_BASE + IA_PER_RES * P) * Math.sqrt(ctx.connI);
    if (rin) {
      // neighbour shoppers (≤ RG_CS_MAX × local CS) + neighbour workers (bedroom towns) + a bigger regional market
      const ci = RG_CI * rin.workerSurplus;
      let csLocal = 0;
      for (let w = 0; w < 3; w++) csLocal += raw[DevType.CS1 + w];
      for (let w = 0; w < 3; w++) {
        const d = DevType.CS1 + w;
        const shop = Math.min(RG_CS * CS_PER_RES[w] * rin.customers[w], RG_CS_MAX * raw[d]);
        reg[d] = shop + (csLocal > 0 ? ci * RG_CI_SPLIT.CS * raw[d] / csLocal : ci * RG_CI_SPLIT.CS / 3);
      }
      reg[DevType.CO2] = ci * RG_CI_SPLIT.CO * (1 - f3);
      reg[DevType.CO3] = ci * RG_CI_SPLIT.CO * f3;
      const iAdd = iTotal * (rin.market - 1);
      const sSum = sID + sIM + sIHT;
      reg[DevType.ID] = iAdd * sID + ci * RG_CI_SPLIT.I * sID / sSum;
      reg[DevType.IM] = iAdd * sIM + ci * RG_CI_SPLIT.I * sIM / sSum;
      reg[DevType.IHT] = iAdd * sIHT + ci * RG_CI_SPLIT.I * sIHT / sSum;
      for (let d = DevType.CS1; d <= DevType.IHT; d++) raw[d] += reg[d];
    }
    const jobMul = JOB_SLACK * (1 + UNEMP_CI_BOOST * excessU);
    for (let d = DevType.CS1; d <= DevType.IHT; d++) { raw[d] *= jobMul; mods[d] = jobMul; }
    // ---- residential targets from jobs (capacity, incl. under construction), migration, retirees / students, region
    const mig = data.migration;
    const migrants = data.migrants;
    const unempF = Math.max(0.2, 1 - UNEMP_R_PENALTY * excessU);
    const apprF = 1 + APPROVAL_R * (s.approval - 50) / 50;
    for (let w = 0; w < 3; w++) {
      let jobs = t.civicJobCap * CIVIC_WEALTH_MIX[w];
      for (let d = DevType.CS1; d <= DevType.IHT; d++) jobs += t.jobCapAll[d] * JOB_WEALTH_MIX[d][w];
      let base = R_BASE[w] * ctx.connR + (jobs / wr) * R_JOB_SLACK;
      const extra = migrants ? migrants[w] || 0 : 0;
      if (extra > 0) base += extra * ctx.connR;
      if (rin) { reg[w] = RG_R * rin.jobSurplus * JOB_MIX_AVG[w] / wr; base += reg[w]; }
      raw[w] = base * unempF * apprF;
      const m = mig && mig[w] > 0 ? mig[w] : 1;
      if (m !== 1) raw[w] *= m;
      mods[w] = unempF * apprF * m;
    }
    // ---- modifiers + caps
    const relief = ctx.relief;
    const rCap = rin ? { R: rin.reachPop * RG_CAP.R, C: rin.reachPop * RG_CAP.C, I: rin.reachPop * RG_CAP.I } : null;
    for (let d = 0; d < DEV_TYPE_COUNT; d++) {
      const fam = devFamily(d);
      let m = taxFactor(d, rates[d]) * ordinanceEffect(st, 'demand.' + DEV_ENUM[d]) * ordinanceEffect(st, 'demand.' + fam);
      if (d >= DevType.CS1 && d <= DevType.CS3) m *= ordinanceEffect(st, 'demand.CS');
      if (d === DevType.CO2 || d === DevType.CO3) m *= ordinanceEffect(st, 'demand.CO');
      raw[d] *= m;
      mods[d] *= m;
      let c = BASE_CAP[d] + (relief[fam] + CAP_POP_FRAC[fam] * P) * CAP_WEIGHT[d];
      if (rCap) c += rCap[fam] * CAP_WEIGHT[d];
      if (d === DevType.R3) c += relief.R3;
      if (d === DevType.IHT) c += relief.IHT;
      if (d === DevType.CO3) c += relief.CO3;
      cap[d] = c;
      cur[d] = d <= DevType.R3 ? t.resCapAll[d] : t.jobCapAll[d];
    }
    if (rin) {
      const terms: RegionTerms = {
        R: [reg[0] * mods[0], reg[1] * mods[1], reg[2] * mods[2]],
        CS: [reg[3] * mods[3], reg[4] * mods[4], reg[5] * mods[5]],
        CO: reg[DevType.CO2] * mods[DevType.CO2] + reg[DevType.CO3] * mods[DevType.CO3],
        I: reg[DevType.ID] * mods[DevType.ID] + reg[DevType.IM] * mods[DevType.IM] + reg[DevType.IHT] * mods[DevType.IHT],
        market: rin.market,
        capR: rCap!.R, capC: rCap!.C, capI: rCap!.I,
      };
      data.regionTerms = terms;
    } else if (data.regionTerms) {
      delete data.regionTerms;
    }
    // ---- absolute & normalised demand
    for (let d = 0; d < DEV_TYPE_COUNT; d++) {
      const fam = devFamily(d);
      const eff = softmin(raw[d], cap[d]);
      const abs = eff - cur[d];
      data.rawTarget[d] = Math.round(raw[d]);
      data.target[d] = Math.round(eff);
      data.capBinding[d] = raw[d] > CAP_BINDING * cap[d] ? 1 : 0;
      data.demandAbs[d] = first ? abs : data.demandAbs[d] + (abs - data.demandAbs[d]) * DEMAND_ABS_EMA;
      const norm = DEMAND_NORM_MIN[fam] + DEMAND_NORM_FRAC * Math.max(cur[d], eff);
      const n = Math.tanh(data.demandAbs[d] / norm);
      s.demand[d] = first ? n : s.demand[d] + (n - s.demand[d]) * DEMAND_EMA;
      s.demandCap[d] = Math.round(cap[d]);
    }
  };

  return {
    name: 'economy.demand',
    init(sim) {
      rt.attach(sim);
      ctx = null;
      const st = sim.state;
      // a loaded city keeps its smoothed demand (growth reads demandAbs, the UI stats.demand): only the derived context
      // is rebuilt and the next daily update continues the EMA, so a save / load does not jolt growth. A new city
      // starts from its instantaneous demand.
      if (st.day > 0 && econData(st).demandAbs.some((v) => v !== 0)) {
        ctx = demandContext(st, rt);
        rt.capsDirty = false;
      } else {
        compute(st, true);
      }
    },
    daily(sim) {
      const t0 = performance.now();
      // refresh context monthly even without changes (power / funding of relief buildings, use factors)
      if (sim.state.dayOfMonth === 0) rt.capsDirty = true;
      compute(sim.state, false);
      rt.timing.demand = performance.now() - t0;
    },
  };
}

const ISSUE_TEXT: Record<string, string> = {
  closed: 'burnt or closed', unpowered: 'without power', noRoad: 'without road access', strike: 'on strike', funding: 'underfunded',
  use: 'little used',
};

/**
 * UI helper: which families are cap-limited and a hint what relieves them. When relief buildings of a capped family
 * work below full strength (≥ 10 % of its relief withheld), the hint says so first — fixing them is the cheap way out.
 */
export function capHints(st: CityState): { family: 'R' | 'C' | 'I'; devs: number[]; hint: string }[] {
  const d = econData(st);
  const ctx = contexts.get(st);
  const out: { family: 'R' | 'C' | 'I'; devs: number[]; hint: string }[] = [];
  const fams: ['R' | 'C' | 'I', number, number, string][] = [
    ['R', 0, 2, 'Build parks, plazas, a zoo or landmarks to raise the residential cap.'],
    ['C', 3, 7, 'Build an airport, a convention center or landmarks to raise the commercial cap.'],
    ['I', 8, 11, 'Connect to neighbors (highway / rail), build freight stations or a seaport to raise the industrial cap.'],
  ];
  for (const [family, a, b, hint] of fams) {
    const devs: number[] = [];
    for (let k = a; k <= b; k++) if (d.capBinding[k] && st.stats.demand[k] > -0.05) devs.push(k);
    if (!devs.length) continue;
    let text = hint;
    const lost = ctx ? ctx.reliefLost[family] : 0;
    const total = ctx ? lost + ctx.relief[family] + (family === 'R' ? ctx.relief.R3 : family === 'C' ? ctx.relief.CO3 : ctx.relief.IHT) : 0;
    if (ctx && lost > 0 && lost >= 0.1 * total) {
      const why = Object.entries(ctx.reliefIssues[family]).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${n} ${ISSUE_TEXT[k] ?? k}`);
      const n = Object.values(ctx.reliefIssues[family]).reduce((s, v) => s + v, 0);
      text = `${n === 1 ? 'A building that raises' : `${n} buildings that raise`} this cap ${n === 1 ? 'works' : 'work'} below strength (${why.join(', ')}): `
        + `fix ${n === 1 ? 'it' : 'them'} to win back ${Math.round(lost).toLocaleString('en-US')} of the cap. ${hint}`;
    }
    out.push({ family, devs, hint: text });
  }
  return out;
}
