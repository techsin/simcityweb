/**
 * OPERATING COSTS of the city's service facilities (WP6b balance round 2; SIM_DEPTH_PART_B acceptance r1 "money too
 * easy": a 1.5M city ran 2.8× its expenses at the 7 % tax floor with $118M in the bank, because every service cost a
 * flat upkeep per building while a dense city's buildings serve ever more people — the bot's 2060 city spent $0.17 a
 * month per resident, its 2020 city $0.40, on the same services).
 *
 * A school, clinic, police / fire station or park costs
 *   building upkeep  def.upkeep × OPEX_BUILDING_SHARE × funding / 100      (maintenance: the building itself)
 * + running costs    OPEX_PER_SERVED[tier] × the people its tier serves     (staff, books, medicine, patrols)
 * The running costs of a tier are charged city-wide from stats.needs[tier].served — the pupils / patients / residents
 * the Statistics panel shows as served, which already carry funding, strikes, power and staffing through the service
 * quality (an underfunded school teaches less and costs less) — and each facility carries its share of them (by the
 * coverage it delivers, facilityLoad().served). Only cities that run sim-infra's services system: economy-only
 * simulations (tests, tools) keep the flat upkeep.
 *
 * Venues that earn money (zoo, stadium, amusement park), rewards, landmarks and civic buildings keep their flat upkeep.
 */
import type { Simulation } from '../Simulation';
import { BF, type Building, type CityState, type NeedTier } from '../CityState';
import type { BuildingDef, ServiceKind, ServiceTier } from '../catalogTypes';
import { getDef } from '../catalog';
import { OPEX_BUILDING_SHARE, OPEX_PER_SERVED, OPEX_TYPICAL_COVERED, OPEX_TYPICAL_LOAD } from './tuning';
import { infraFlags } from './runtime';
import { facilityLoad } from '../infra/catchments';

/** need tier of each catchment tier (catchments.TIER_NEED, repeated here: economy must not depend on its import order) */
const NEED_OF: Readonly<Record<ServiceTier, NeedTier>> = {
  elementary: 'elementary', high: 'high', college: 'college', library: 'college', clinic: 'health', hospital: 'health',
  play: 'play', green: 'green', police: 'police', fire: 'fire',
};
/** budget bucket of each need tier's running costs */
export const OPEX_SERVICE: Readonly<Record<NeedTier, ServiceKind>> = {
  elementary: 'education', high: 'education', college: 'education', health: 'health', play: 'parks', green: 'parks',
  police: 'police', fire: 'fire',
};
/** who a tier's running costs are counted in (inspector / tooltip text) */
export const OPEX_UNIT: Readonly<Record<NeedTier, [string, string]>> = {
  elementary: ['pupil', 'pupils'], high: ['student', 'students'], college: ['student', 'students'],
  health: ['patient', 'patients'], play: ['young visitor', 'young visitors'], green: ['visitor', 'visitors'],
  police: ['resident patrolled', 'residents patrolled'], fire: ['resident protected', 'residents protected'],
};
const OPEX_CATEGORIES = new Set(['police', 'fire', 'health', 'education', 'park']);

/** the need tier whose running costs this def carries, or null (flat upkeep: no service tier, venues with income,
 *  rewards, landmarks, civic buildings) */
export function opexTierOf(def: BuildingDef | undefined): NeedTier | null {
  const t = def?.coverage?.tier;
  if (!def || !t || def.income || !OPEX_CATEGORIES.has(def.category)) return null;
  return NEED_OF[t] ?? null;
}

/** true when this city charges running costs (sim-infra services writes stats.needs) */
export function opexActive(st: CityState): boolean {
  return infraFlags(st).services;
}

/** monthly building upkeep of a def at 100 % funding (the flat part; the whole upkeep without running costs) */
export function buildingUpkeep(st: CityState | null, def: BuildingDef): number {
  const up = def.upkeep ?? 0;
  return (!st || opexActive(st)) && opexTierOf(def) ? up * OPEX_BUILDING_SHARE : up;
}

/** running costs per need tier this month (§): OPEX_PER_SERVED × stats.needs[tier].served, for the tiers the city runs
 *  at least one operating-cost facility of (`tiers`; all when omitted) */
export function tierOperatingCosts(st: CityState, tiers?: ReadonlySet<NeedTier>): Partial<Record<NeedTier, number>> {
  const out: Partial<Record<NeedTier, number>> = {};
  if (!opexActive(st)) return out;
  const needs = st.stats.needs as Partial<Record<NeedTier, { served?: number }>> | undefined;
  if (!needs) return out;
  for (const t of Object.keys(OPEX_PER_SERVED) as NeedTier[]) {
    if (tiers && !tiers.has(t)) continue;
    const served = needs[t]?.served ?? 0;
    if (served > 0) out[t] = served * OPEX_PER_SERVED[t];
  }
  return out;
}

/**
 * Monthly cost of one more facility of this def at 100 % funding (bot budget checks, plop tooltip): its building upkeep
 * plus the running costs of the people it would newly serve — `people` when the caller knows them (a cluster of unserved
 * homes), else the tier's unserved need city-wide (at least a quarter of a typical load), capped by a typical load:
 * OPEX_TYPICAL_LOAD of its seats (schools, clinics, parks) or the people a station typically covers (police / fire:
 * OPEX_TYPICAL_COVERED × (radius / 26)²). The flat upkeep for every other def.
 */
export function expectedUpkeep(st: CityState | null, def: BuildingDef, people?: number): number {
  const tier = opexTierOf(def);
  if (!tier || (st && !opexActive(st))) return def.upkeep ?? 0;
  const cap = def.coverage?.capacity;
  const r = def.coverage?.radius ?? 26;
  const typical = cap !== undefined ? cap * OPEX_TYPICAL_LOAD : OPEX_TYPICAL_COVERED * (r / 26) * (r / 26);
  let n = typical;
  if (people !== undefined) n = Math.min(typical, Math.max(0, people));
  else if (st) {
    const ns = (st.stats.needs as Partial<Record<NeedTier, { need?: number; served?: number }>> | undefined)?.[tier];
    if (ns && (ns.need ?? 0) > 0) n = Math.min(typical, Math.max(0.25 * typical, (ns.need ?? 0) - (ns.served ?? 0)));
  }
  return (def.upkeep ?? 0) * OPEX_BUILDING_SHARE + n * OPEX_PER_SERVED[tier];
}

/** the running-cost rate of a def (§ per person served per month) and its unit, or null (flat upkeep) */
export function opexRateOf(def: BuildingDef | undefined): { tier: NeedTier; rate: number; unit: string } | null {
  const tier = opexTierOf(def);
  return tier ? { tier, rate: OPEX_PER_SERVED[tier], unit: OPEX_UNIT[tier][0] } : null;
}

export interface FacilityOpex {
  tier: NeedTier;
  /** building upkeep at the current funding */
  building: number;
  /** this facility's share of its tier's running costs (0 until the services system has assessed it) */
  running: number;
  /** the people that share stands for (its share of stats.needs[tier].served) */
  people: number;
  /** § per person served per month */
  rate: number;
}

/**
 * Upkeep split of one plopped facility (inspector): its building upkeep and its share of the tier's running costs, by
 * the coverage it delivers among the tier's operating-cost facilities (Σ over the facilities = the budget line).
 * null for buildings with a flat upkeep.
 */
export function facilityOpex(sim: Simulation, b: Building): FacilityOpex | null {
  const st = sim.state;
  const def = getDef(b.def);
  const tier = opexTierOf(def);
  if (!def || !tier || !opexActive(st)) return null;
  const svc = def.service;
  const f = svc ? (st.budget.funding[svc] ?? 100) / 100 : 1;
  const building = (def.upkeep ?? 0) * OPEX_BUILDING_SHARE * f;
  const rate = OPEX_PER_SERVED[tier];
  const own = facilityLoad(sim, b.id);
  const served = (st.stats.needs as Partial<Record<NeedTier, { served?: number }>> | undefined)?.[tier]?.served ?? 0;
  if (!own || !(own.served > 0) || !(served > 0) || (b.flags & BF.Burnt)) return { tier, building, running: 0, people: 0, rate };
  let sum = 0;
  for (const o of st.buildings.values()) {
    if (!(o.flags & BF.Plopped) || opexTierOf(getDef(o.def)) !== tier) continue;
    const L = o.id === b.id ? own : facilityLoad(sim, o.id);
    if (L && L.served > 0) sum += L.served;
  }
  const share = sum > 0 ? own.served / sum : 0;
  return { tier, building, running: served * share * rate, people: served * share, rate };
}
