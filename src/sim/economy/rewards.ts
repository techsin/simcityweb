/**
 * Rewards, unlocks, landmarks and business deals (SC4 style).
 * When a reward's conditions are met: state.unlocked.add(id), notify(kind 'reward'), emit 'unlocked' (once).
 * Unlocks are permanent. BuildingDef.requires references these ids. Sandbox unlocks everything.
 */
import type { SimSystem, Simulation } from '../Simulation';
import type { CityState } from '../CityState';
import { DevType } from '../../core/types';
import { getDef } from '../catalog';
import type { EconRuntime } from './runtime';

export type RewardKind = 'unlock' | 'reward' | 'landmark' | 'deal';

interface Cond {
  label: string;
  value: (st: CityState) => number;
  need: number;
  /** display format */
  fmt?: 'int' | 'bool';
}

export interface RewardDef {
  id: string;
  name: string;
  description: string;
  kind: RewardKind;
  /** building defs this unlocks */
  defIds: string[];
  conds: Cond[];
  /** custom announcement */
  announce?: string;
}

const pop = (need: number): Cond => ({ label: 'Population', value: (s) => s.stats.population, need });
const eq = (need: number): Cond => ({ label: 'EQ', value: (s) => s.stats.eq, need });
const hq = (need: number): Cond => ({ label: 'HQ', value: (s) => s.stats.hq, need });
const has = (defId: string, label: string): Cond => ({ label, value: (s) => ((s.milestones[defId] ?? 0) > 0 ? 1 : 0), need: 1, fmt: 'bool' });
const indJobs = (need: number): Cond => ({
  label: 'Industrial jobs',
  value: (s) => s.stats.jobsByDev[DevType.IA] + s.stats.jobsByDev[DevType.ID] + s.stats.jobsByDev[DevType.IM] + s.stats.jobsByDev[DevType.IHT],
  need,
});
const comJobs = (need: number): Cond => ({
  label: 'Commercial jobs',
  value: (s) => { let t = 0; for (let d = DevType.CS1; d <= DevType.CO3; d++) t += s.stats.jobsByDev[d]; return t; },
  need,
});

function lm(id: string, need: number): RewardDef {
  const d = getDef(id);
  return {
    id, name: d?.name ?? id, kind: 'landmark', defIds: [id], conds: [pop(need)],
    description: `Landmark unlocked at ${need.toLocaleString('en-US')} residents. Raises land value and tourism.`,
  };
}

export const REWARDS: RewardDef[] = [
  // ---------------- infrastructure unlocks
  { id: 'water_treatment', name: 'Water Treatment Plant', kind: 'unlock', defIds: ['util_water_treatment'], conds: [pop(6000)], description: 'Large clean water supply.' },
  { id: 'recycling_center', name: 'Recycling Center', kind: 'unlock', defIds: ['util_recycling_center'], conds: [pop(8000)], description: 'Clean garbage processing.' },
  { id: 'museum', name: 'Museum', kind: 'unlock', defIds: ['civ_museum'], conds: [pop(12000)], description: 'Culture raises EQ and land value.' },
  { id: 'airport_small', name: 'Municipal Airport', kind: 'unlock', defIds: ['tr_airport_small'], conds: [pop(12000)], description: 'Raises the commercial demand cap.' },
  { id: 'jail', name: 'Prison', kind: 'unlock', defIds: ['civ_jail'], conds: [pop(15000)], description: 'City-wide police effectiveness.' },
  { id: 'parking_garage', name: 'Parking Garage', kind: 'unlock', defIds: ['tr_parking_garage'], conds: [pop(15000)], description: 'Park-and-ride.' },
  { id: 'college', name: 'University', kind: 'unlock', defIds: ['civ_college'], conds: [pop(20000)], description: 'Big EQ boost.' },
  { id: 'desalination', name: 'Desalination Plant', kind: 'unlock', defIds: ['util_desalination'], conds: [pop(20000)], description: 'Water from the sea.' },
  { id: 'incinerator', name: 'Incinerator', kind: 'unlock', defIds: ['util_incinerator'], conds: [pop(20000)], description: 'Burns garbage, makes power.' },
  { id: 'solar_power', name: 'Solar Farm', kind: 'unlock', defIds: ['util_solar_farm'], conds: [pop(30000)], description: 'Clean power.' },
  { id: 'zoo', name: 'Zoo', kind: 'unlock', defIds: ['park_zoo'], conds: [pop(30000)], description: 'Huge residential cap boost.' },
  { id: 'fire_hq', name: 'Fire Headquarters', kind: 'unlock', defIds: ['civ_fire_hq'], conds: [pop(35000)], description: 'Large fire coverage.' },
  { id: 'police_hq', name: 'Police Headquarters', kind: 'unlock', defIds: ['civ_police_hq'], conds: [pop(40000)], description: 'Large police coverage.' },
  { id: 'nuclear_power', name: 'Nuclear Power', kind: 'unlock', defIds: ['util_nuclear_plant'], conds: [pop(60000), eq(85)], description: '1600 MW of clean power (needs an educated workforce).' },
  // ---------------- SC4-style rewards
  { id: 'mayor_house', name: "Mayor's House", kind: 'reward', defIds: ['civ_mayor_house'], conds: [pop(1200)], description: 'The town wants a proper home for its mayor.',
    announce: "The citizens have built you a Mayor's House! Place it from Rewards." },
  { id: 'cemetery', name: 'Cemetery', kind: 'reward', defIds: ['civ_cemetery'], conds: [pop(2000)], description: 'A quiet resting place.' },
  { id: 'statue', name: 'Statue of the Mayor', kind: 'reward', defIds: ['civ_statue'], conds: [pop(2500), { label: 'Approval', value: (s) => s.stats.approval, need: 65 }],
    description: 'Awarded for high approval.', announce: 'Your approval is sky high — the grateful citizens erect a statue in your honor!' },
  { id: 'courthouse', name: 'Courthouse', kind: 'reward', defIds: ['civ_courthouse'], conds: [pop(8000), has('civ_police_station', 'Police station built')], description: 'Justice for all.' },
  { id: 'city_hall', name: 'City Hall', kind: 'reward', defIds: ['civ_city_hall'], conds: [pop(20000)], description: 'A seat of government worthy of the city.' },
  { id: 'country_club', name: 'Country Club', kind: 'reward', defIds: ['park_golf'], conds: [{ label: 'R$$$ residents', value: (s) => s.stats.residents[2], need: 4000 }],
    description: 'The rich want to golf.' },
  { id: 'casino', name: 'Casino Resort', kind: 'reward', defIds: ['rw_casino'], conds: [pop(15000), { label: 'Legalized Gambling', value: (s) => (s.budget.ordinances.includes('legalized_gambling') ? 1 : 0), need: 1, fmt: 'bool' }],
    description: 'Requires the Legalized Gambling ordinance.' },
  { id: 'research_center', name: 'Advanced Research Center', kind: 'reward', defIds: ['rw_research_center'], conds: [pop(40000), eq(110)], description: 'Awarded for a highly educated city.' },
  { id: 'medical_center', name: 'Medical Research Center', kind: 'reward', defIds: ['civ_medical_center'], conds: [pop(40000), hq(100)], description: 'Awarded for a very healthy city.' },
  { id: 'stadium', name: 'Major League Stadium', kind: 'reward', defIds: ['park_stadium'], conds: [pop(50000)], description: 'The league wants a team here!' },
  { id: 'convention_center', name: 'Convention Center', kind: 'reward', defIds: ['civ_convention_center'], conds: [pop(60000), comJobs(15000)], description: 'Business visitors raise the commercial cap.' },
  { id: 'amusement_park', name: 'Amusement Park', kind: 'reward', defIds: ['park_amusement'], conds: [pop(80000)], description: 'Rides and tourists.' },
  { id: 'seaport', name: 'Container Seaport', kind: 'reward', defIds: ['tr_seaport'], conds: [indJobs(6000), { label: 'Coastline', value: (s) => (hasWater(s) ? 1 : 0), need: 1, fmt: 'bool' }],
    description: 'Industry wants to ship by sea: massive industrial cap boost.' },
  { id: 'airport_large', name: 'International Airport', kind: 'reward', defIds: ['tr_airport_large'], conds: [pop(120000), has('tr_airport_small', 'Municipal airport built')],
    description: 'A global hub for a global city.' },
  // ---------------- business deals
  { id: 'military_base', name: 'Military Base', kind: 'deal', defIds: ['rw_military_base'], conds: [pop(15000)],
    description: 'The army pays well — but it is noisy.', announce: 'The Defense Department offers a deal: host a Military Base for $1,500/month. Find it under Rewards & Deals.' },
  { id: 'missile_range', name: 'Missile Test Range', kind: 'deal', defIds: ['rw_missile_range'], conds: [pop(35000)],
    description: 'Big income, bad neighbour.', announce: 'An aerospace contractor offers $2,500/month for a Missile Test Range. Residents will hate it.' },
  { id: 'toxic_dump', name: 'Toxic Waste Dump', kind: 'deal', defIds: ['rw_toxic_dump'], conds: [pop(60000)],
    description: 'Huge income, horrible pollution.', announce: 'A chemical conglomerate offers $4,000/month to dump toxic waste here. Are you that desperate?' },
  // ---------------- landmarks by population
  lm('lm_lighthouse', 3000), lm('lm_clock_tower', 5000), lm('lm_obelisk', 10000), lm('lm_arch', 15000), lm('lm_observatory', 25000),
  lm('lm_cathedral', 35000), lm('lm_castle', 50000), lm('lm_pyramid', 70000), lm('lm_ferris_wheel', 90000), lm('lm_opera_house', 150000),
  lm('lm_spire_tower', 250000), lm('lm_twin_spires', 500000),
];

const hasWaterCache = new WeakMap<CityState, boolean>();
function hasWater(st: CityState): boolean {
  let v = hasWaterCache.get(st);
  if (v === undefined) {
    let n = 0;
    for (let i = 0; i < st.cells; i++) if (st.water[i]) n++;
    v = n > 40;
    hasWaterCache.set(st, v);
  }
  return v;
}

export const REWARD_BY_ID = new Map(REWARDS.map((r) => [r.id, r]));

export interface RewardInfo {
  id: string;
  name: string;
  description: string;
  kind: RewardKind;
  defIds: string[];
  unlocked: boolean;
  /** built at least once */
  built: boolean;
  progress: number;
  progressText: string;
}

function fmt(c: Cond, v: number): string {
  if (c.fmt === 'bool') return `${c.label}: ${v >= c.need ? 'yes' : 'no'}`;
  return `${c.label} ${Math.floor(v).toLocaleString('en-US')} / ${c.need.toLocaleString('en-US')}`;
}

/** Reward list for the UI (all rewards, with progress). */
export function listRewards(state: CityState): RewardInfo[] {
  return REWARDS.map((r) => {
    let progress = 1;
    const parts: string[] = [];
    for (const c of r.conds) {
      const v = c.value(state);
      progress = Math.min(progress, Math.max(0, Math.min(1, v / c.need)));
      parts.push(fmt(c, v));
    }
    const unlocked = state.unlocked.has(r.id) || !!state.config.sandbox;
    return {
      id: r.id, name: r.name, description: r.description, kind: r.kind, defIds: r.defIds, unlocked,
      built: r.defIds.some((d) => (state.milestones[d] ?? 0) > 0),
      progress: unlocked ? 1 : progress,
      progressText: unlocked ? 'Unlocked' : parts.join(' · '),
    };
  });
}

export function rewardConditionsMet(state: CityState, r: RewardDef): boolean {
  for (const c of r.conds) if (c.value(state) < c.need) return false;
  return true;
}

export function rewardsSystem(rt: EconRuntime): SimSystem {
  const check = (sim: Simulation, silent: boolean) => {
    const st = sim.state;
    for (const r of REWARDS) {
      if (st.unlocked.has(r.id)) continue;
      if (!st.config.sandbox && !rewardConditionsMet(st, r)) continue;
      st.unlocked.add(r.id);
      if (!st.announced.has(r.id)) {
        st.announced.add(r.id);
        if (!silent) {
          const text = r.announce ?? (r.kind === 'landmark' ? `New landmark available: ${r.name}!`
            : r.kind === 'unlock' ? `${r.name} is now available.`
              : `Reward unlocked: ${r.name}! ${r.description}`);
          sim.notify(text, 'reward', undefined, undefined, r.kind === 'deal' ? 'finance' : 'planning');
        }
      }
      sim.events.emit('unlocked', r.id);
    }
  };
  return {
    name: 'economy.rewards',
    init(sim) {
      rt.attach(sim);
      check(sim, true);
    },
    monthly(sim) {
      check(sim, false);
    },
  };
}
