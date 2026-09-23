/**
 * Approval (0..100), EQ / HQ (0..150) and the pop-weighted "resident experience" used by approval + advisors.
 * sim-core OWNS stats.approval. stats.eq / stats.hq are written by sim-infra's services system when present;
 * without it sim-core moves them slowly toward a target from coverage at homes (× ordinance effects).
 * Without infra sim-core also fills stats.avgCommute / avgPollution / avgCrime (fallbacks).
 */
import type { SimSystem, Simulation } from '../Simulation';
import { BF } from '../CityState';
import { clamp } from '../../core/rng';
import { DevType } from '../../core/types';
import { getDef } from '../catalog';
import {
  APPROVAL, COMMUTE_FALLBACK, COVERAGE_FALLBACK, EQ_BASE, EQ_RATE, EQ_SPAN, HQ_BASE, HQ_RATE, HQ_SPAN, TAX_NEUTRAL,
} from './tuning';
import { type EconRuntime, econData, infraFlags } from './runtime';
import { ordinanceEffect } from './ordinances';
import { serviceEffectiveness } from './budget';

export interface ResidentCoverage {
  police: number;
  fire: number;
  health: number;
  edu: number;
  park: number;
  transit: number;
}
const coverage = new WeakMap<object, ResidentCoverage>();
/** pop-weighted coverage at homes from the last monthly update */
export function residentCoverage(state: object): ResidentCoverage {
  return coverage.get(state) ?? { police: 0, fire: 0, health: 0, edu: 0, park: 0, transit: 0 };
}

export function approvalSystem(rt: EconRuntime): SimSystem {
  const update = (sim: Simulation, first: boolean) => {
    const st = sim.state;
    const data = econData(st);
    const inf = infraFlags(st);
    const N = st.size;
    let w = 0, crime = 0, poll = 0, commute = 0, pol = 0, fire = 0, hlth = 0, edu = 0, park = 0, transit = 0;
    for (const b of rt.growables) {
      if (b.pop <= 0 || b.flags & BF.Abandoned) continue;
      const def = getDef(b.def);
      if (!def || def.devType === undefined || def.devType > DevType.R3) continue;
      const i = (b.z + (b.d >> 1)) * N + b.x + (b.w >> 1);
      const p = b.pop;
      w += p;
      crime += st.crime[i] * p;
      poll += st.airPollution[i] * p;
      commute += (inf.traffic && st.commute[i] > 0 ? st.commute[i] : COMMUTE_FALLBACK) * p;
      if (inf.services) {
        pol += st.policeCov[i] * p; fire += st.fireCov[i] * p; hlth += st.healthCov[i] * p; edu += st.eduCov[i] * p;
        park += st.parkCov[i] * p; transit += st.transitCov[i] * p;
      }
    }
    const cov: ResidentCoverage = inf.services && w > 0
      ? { police: pol / w, fire: fire / w, health: hlth / w, edu: edu / w, park: park / w, transit: transit / w }
      : {
        police: COVERAGE_FALLBACK * serviceEffectiveness(st, 'police'), fire: COVERAGE_FALLBACK * serviceEffectiveness(st, 'fire'),
        health: COVERAGE_FALLBACK * serviceEffectiveness(st, 'health'), edu: COVERAGE_FALLBACK * serviceEffectiveness(st, 'education'),
        park: 0.3, transit: 0,
      };
    coverage.set(st, cov);
    if (w > 0) {
      data.resCrime = crime / w;
      data.resPollution = poll / w;
      data.resCommute = commute / w;
    }
    data.resServices = (cov.police + cov.fire + cov.health + cov.edu) / 4;
    data.resParks = cov.park;
    data.resEdu = cov.edu;
    data.resHealth = cov.health;
    const s = st.stats;
    if (!inf.traffic) s.avgCommute = w > 0 ? data.resCommute : COMMUTE_FALLBACK;
    // ---- EQ / HQ
    const eqT = clamp(EQ_BASE + EQ_SPAN * cov.edu * ordinanceEffect(st, 'edu.effect'), 0, 150);
    const hqT = clamp(HQ_BASE + HQ_SPAN * cov.health * ordinanceEffect(st, 'health.effect'), 0, 150);
    if (inf.services) { /* sim-infra services owns EQ / HQ */ }
    else if (s.population <= 0) { s.eq = first ? s.eq : s.eq + (50 - s.eq) * 0.1; s.hq = first ? s.hq : s.hq + (50 - s.hq) * 0.1; }
    else if (!first) {
      s.eq += (eqT - s.eq) * EQ_RATE;
      s.hq += (hqT - s.hq) * HQ_RATE;
    }
    // ---- approval
    const pop = s.population;
    let tax = TAX_NEUTRAL;
    if (pop > 0) tax = (s.residents[0] * st.budget.taxRates[0] + s.residents[1] * st.budget.taxRates[1] + s.residents[2] * st.budget.taxRates[2]) / pop;
    const taxTerm = tax > TAX_NEUTRAL ? APPROVAL.taxPerPoint * (tax - TAX_NEUTRAL) : APPROVAL.taxLowPerPoint * (TAX_NEUTRAL - tax);
    let strikes = 0;
    for (const k in data.strikes) if (data.strikes[k] > 0) strikes++;
    let raw = APPROVAL.base + taxTerm
      + APPROVAL.services * (data.resServices - 0.3)
      + APPROVAL.pollution * data.resPollution
      + APPROVAL.crime * data.resCrime
      + APPROVAL.commute * Math.max(0, data.resCommute - 30)
      + APPROVAL.unemployment * Math.max(0, s.unemployment - 0.08)
      + APPROVAL.parks * (data.resParks - 0.2)
      + APPROVAL.strike * strikes
      + (data.monthsNegative > 0 ? APPROVAL.deficit : 0)
      + ordinanceEffect(st, 'add.approval')
      + ((st.milestones.civ_mayor_house ?? 0) > 0 ? 2 : 0)
      + ((st.milestones.civ_statue ?? 0) > 0 ? 3 : 0)
      + ((st.milestones.civ_city_hall ?? 0) > 0 ? 2 : 0);
    raw = clamp(raw, 0, 100);
    data.approvalRaw = raw;
    s.approval = first ? raw : clamp(s.approval + (raw - s.approval) * APPROVAL.ema, 0, 100);
    if (!inf.pollution) s.avgPollution = data.resPollution;
    if (!inf.services) s.avgCrime = data.resCrime;
  };
  return {
    name: 'economy.approval',
    init(sim) {
      rt.attach(sim);
      update(sim, true);
    },
    monthly(sim) {
      update(sim, false);
    },
  };
}
