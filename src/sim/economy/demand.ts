/**
 * RCI demand (SC4 style) → stats.demand[dev] ∈ [-1, 1] (smoothed), stats.demandCap[dev], and absolute demand
 * (capacity units) in systemData.economy.demandAbs used by growth. See tuning.ts DEMAND section for the model.
 *
 * Summary:
 *  - R demand comes from jobs (jobs > workers → R up) + regional attraction; unemployment pushes R down.
 *  - CS from residents (customers by wealth) + tourism; CO from the workforce, city size, EQ and connectivity.
 *  - Industry: export demand (region/world, boosted by neighbor connections, freight stations, seaport, airports)
 *    + workforce share; EQ shifts dirty → high-tech. Unemployment pushes C/I up.
 *  - Taxes lower targets per DevType (wealthy more sensitive), ordinances multiply them.
 *  - Caps: base + relief from parks / landmarks / airports / seaports / connections (catalog CAP_RELIEF).
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
  CS_BASE, CS_PER_RES, CUSTOMER_MIX, DEMAND_ABS_EMA, DEMAND_EMA, DEMAND_NORM_FRAC, DEMAND_NORM_MIN, FREIGHT_BOOST,
  FREIGHT_BOOST_MAX, I_BASE, I_SHARE_MAX, I_SHARE_MIN, IA_BASE, IA_PER_RES, ID_EQ_START, ID_SHARE_AT_EQ0, ID_SHARE_EQ_SLOPE, ID_SHARE_MIN,
  IHT_EQ_START, IHT_SHARE_MAX, IHT_SHARE_PER_EQ, JOB_SLACK, JOB_WEALTH_MIX, R_BASE, R_JOB_SLACK, TAX_FACTOR_MAX,
  TAX_FACTOR_MIN, TAX_NEUTRAL, TAX_SENS, TOURISM_CS_PER_POINT, UNEMP_CI_BOOST, UNEMP_NEUTRAL, UNEMP_R_PENALTY, WORKFORCE_RATIO,
} from './tuning';
import { type EconRuntime, econData } from './runtime';
import { ordinanceEffect } from './ordinances';

const DEV_ENUM = ['R1', 'R2', 'R3', 'CS1', 'CS2', 'CS3', 'CO2', 'CO3', 'IA', 'ID', 'IM', 'IHT'];

export interface DemandContext {
  connR: number;
  connC: number;
  connI: number;
  freightBoost: number;
  /** tourism points (≈ CS jobs from visitors) */
  tourism: number;
  /** family-level cap relief from buildings + connections */
  relief: { R: number; C: number; I: number; R3: number; IHT: number; CO3: number };
}

/** connection factors, freight boosts, tourism and cap relief from plopped buildings + neighbor connections */
export function demandContext(st: CityState, rt: EconRuntime): DemandContext {
  let cR = CONN_BASE.R, cC = CONN_BASE.C, cI = CONN_BASE.I;
  const relief = { R: 0, C: 0, I: 0, R3: 0, IHT: 0, CO3: 0 };
  for (const c of st.neighborConnections) {
    const w = CONN_WEIGHT[c.type];
    if (w) { cR += w.R; cC += w.C; cI += w.I; }
    const r = CONN_CAP_RELIEF[c.type];
    if (r) { relief.R += r.R; relief.C += r.C; relief.I += r.I; }
  }
  let freight = 0, tourism = 0;
  for (const b of rt.plopped) {
    if (b.flags & BF.Burnt) continue;
    const r = CAP_RELIEF[b.def];
    if (r) {
      relief.R += r.R ?? 0; relief.C += r.C ?? 0; relief.I += r.I ?? 0;
      relief.R3 += r.R3 ?? 0; relief.IHT += r.IHT ?? 0; relief.CO3 += r.CO3 ?? 0;
      tourism += (r.C ?? 0) * 0.05;
    }
    const f = FREIGHT_BOOST[b.def];
    if (f) freight += f;
  }
  tourism += ordinanceEffect(st, 'add.tourism') * st.stats.population / 1000;
  return {
    connR: Math.min(CONN_MAX.R, cR),
    connC: Math.min(CONN_MAX.C, cC),
    connI: Math.min(CONN_MAX.I, cI),
    freightBoost: Math.min(FREIGHT_BOOST_MAX, freight),
    tourism: tourism * TOURISM_CS_PER_POINT,
    relief,
  };
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

export function demandSystem(rt: EconRuntime): SimSystem {
  let ctx: DemandContext | null = null;
  const raw = new Float64Array(DEV_TYPE_COUNT);
  const cap = new Float64Array(DEV_TYPE_COUNT);
  const cur = new Float64Array(DEV_TYPE_COUNT);

  const compute = (st: CityState, first: boolean) => {
    if (!ctx || rt.capsDirty) { ctx = demandContext(st, rt); rt.capsDirty = false; }
    const data = econData(st);
    const t = rt.totals;
    const s = st.stats;
    const P = t.population;
    const W = P * WORKFORCE_RATIO;
    const EQ = s.eq;
    const rates = st.budget.taxRates;
    const u = s.unemployment;
    const excessU = Math.max(0, u - UNEMP_NEUTRAL);
    // ---- job targets
    const logF = P <= CO_SHARE_POP_START ? 0 : clamp(Math.log(P / CO_SHARE_POP_START) / Math.log(CO_SHARE_POP_FULL / CO_SHARE_POP_START), 0, 1);
    // customers per CS tier
    for (let w = 0; w < 3; w++) {
      let customers = 0;
      for (let r = 0; r < 3; r++) customers += t.pop[r] * CUSTOMER_MIX[r][w];
      const tourMix = w === 0 ? 0.35 : w === 1 ? 0.4 : 0.25;
      raw[DevType.CS1 + w] = CS_BASE[w] + CS_PER_RES[w] * customers + ctx.tourism * tourMix;
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
    for (let d = DevType.CS1; d <= DevType.IHT; d++) raw[d] *= JOB_SLACK * (1 + UNEMP_CI_BOOST * excessU);
    // ---- residential targets from jobs (capacity, incl. under construction)
    for (let w = 0; w < 3; w++) {
      let jobs = t.civicJobCap * CIVIC_WEALTH_MIX[w];
      for (let d = DevType.CS1; d <= DevType.IHT; d++) jobs += t.jobCapAll[d] * JOB_WEALTH_MIX[d][w];
      raw[w] = (R_BASE[w] * ctx.connR + (jobs / WORKFORCE_RATIO) * R_JOB_SLACK)
        * Math.max(0.2, 1 - UNEMP_R_PENALTY * excessU)
        * (1 + APPROVAL_R * (s.approval - 50) / 50);
    }
    // ---- modifiers + caps
    const relief = ctx.relief;
    for (let d = 0; d < DEV_TYPE_COUNT; d++) {
      const fam = devFamily(d);
      let m = taxFactor(d, rates[d]) * ordinanceEffect(st, 'demand.' + DEV_ENUM[d]) * ordinanceEffect(st, 'demand.' + fam);
      if (d >= DevType.CS1 && d <= DevType.CS3) m *= ordinanceEffect(st, 'demand.CS');
      if (d === DevType.CO2 || d === DevType.CO3) m *= ordinanceEffect(st, 'demand.CO');
      raw[d] *= m;
      let c = BASE_CAP[d] + (relief[fam] + CAP_POP_FRAC[fam] * P) * CAP_WEIGHT[d];
      if (d === DevType.R3) c += relief.R3;
      if (d === DevType.IHT) c += relief.IHT;
      if (d === DevType.CO3) c += relief.CO3;
      cap[d] = c;
      cur[d] = d <= DevType.R3 ? t.resCapAll[d] : t.jobCapAll[d];
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
      compute(sim.state, true);
    },
    daily(sim) {
      const t0 = performance.now();
      // refresh context monthly even without changes (population-dependent tourism)
      if (sim.state.dayOfMonth === 0) rt.capsDirty = true;
      compute(sim.state, false);
      rt.timing.demand = performance.now() - t0;
    },
  };
}

/** UI helper: which families are cap-limited and a hint what relieves them */
export function capHints(st: CityState): { family: 'R' | 'C' | 'I'; devs: number[]; hint: string }[] {
  const d = econData(st);
  const out: { family: 'R' | 'C' | 'I'; devs: number[]; hint: string }[] = [];
  const fams: ['R' | 'C' | 'I', number, number, string][] = [
    ['R', 0, 2, 'Build parks, plazas, a zoo or landmarks to raise the residential cap.'],
    ['C', 3, 7, 'Build an airport, a convention center or landmarks to raise the commercial cap.'],
    ['I', 8, 11, 'Connect to neighbors (highway / rail), build freight stations or a seaport to raise the industrial cap.'],
  ];
  for (const [family, a, b, hint] of fams) {
    const devs: number[] = [];
    for (let k = a; k <= b; k++) if (d.capBinding[k] && st.stats.demand[k] > -0.05) devs.push(k);
    if (devs.length) out.push({ family, devs, hint });
  }
  return out;
}
