/**
 * Advisors panel model (headless, no DOM; tests pin it):
 *  - adviceView: the data view an advice opens together with its "Show me" camera move (final fixes N8: a newcomer told
 *    "Water data view → Tap water quality" opened Water pollution; "Show me" only moved the camera);
 *  - utilityOutages: the occupied buildings without power / without the piped water they need, live from the
 *    buildings' own flags (final fixes N1, card part: the Utilities card said "Power, water and garbage services are
 *    keeping up" 31 days after one bulldoze cut a district off).
 */
import { Overlay } from '../core/types';
import { BF, type CityState } from '../sim/CityState';
import { getDef } from '../sim/catalog';
import { buildingPowered, buildingWatered } from '../sim/economy/population';
import { waterRequired } from '../sim/economy/demographics';
import { infraFlags } from '../sim/economy/runtime';
import { EMG_FIRE, EMG_MEDICAL } from '../sim/infra/overlays';

/** a data view and (optionally) its variant (index into OVERLAY_VARIANTS[overlay]) */
export interface AdviceView {
  overlay: Overlay;
  variant?: number;
}

const V = (overlay: Overlay, variant?: number): AdviceView => (variant === undefined ? { overlay } : { overlay, variant });

/** advice id (advisors.ts) → the data view that shows the problem */
const ADVICE_VIEWS: Readonly<Record<string, AdviceView>> = {
  // utilities
  noPower: V(Overlay.Power), powerShortage: V(Overlay.Power), powerTight: V(Overlay.Power), gridGap: V(Overlay.Power),
  plantBurnt: V(Overlay.Power), plantBurntPart: V(Overlay.Power), plantDry: V(Overlay.Water, 0), waterNoPower: V(Overlay.Power),
  noWater: V(Overlay.Water, 0), waterShortage: V(Overlay.Water, 0), waterGap: V(Overlay.Water, 0), waterBurnt: V(Overlay.Water, 0),
  waterNoRoad: V(Overlay.Water, 0), tapWater: V(Overlay.Water, 1),
  garbage: V(Overlay.Garbage, 0), landfillFull: V(Overlay.Garbage, 1),
  // environment
  noise: V(Overlay.Noise), airPollution: V(Overlay.AirPollution), sewage: V(Overlay.WaterPollution), parks: V(Overlay.Parks, 2),
  // transport
  gridlock: V(Overlay.Traffic, 0), commute: V(Overlay.Commute), parkingPressure: V(Overlay.Parking), busFleetShort: V(Overlay.Transit),
  // health & education
  noElementary: V(Overlay.Education, 1), noHigh: V(Overlay.Education, 2), noCollege: V(Overlay.Education, 3),
  schoolOvercrowded: V(Overlay.Education, 0), eqLow: V(Overlay.Education, 0), playgrounds: V(Overlay.Parks, 1),
  seniorsHealth: V(Overlay.Health), hospitalOvercrowded: V(Overlay.Health), hqLow: V(Overlay.Health),
  slowAmbulances: V(Overlay.Emergency, EMG_MEDICAL),
  // public safety
  noPolice: V(Overlay.Police), policeOverloaded: V(Overlay.Police), crime: V(Overlay.Crime), riotRisk: V(Overlay.Crime),
  noFire: V(Overlay.Fire), noFireResponse: V(Overlay.Emergency, EMG_FIRE), plantFireReach: V(Overlay.Emergency, EMG_FIRE),
  plantNoFire: V(Overlay.Emergency, EMG_FIRE),
  // planning
  noRoadAccess: V(Overlay.Zones), zoneR: V(Overlay.Zones), zoneC: V(Overlay.Zones), zoneI: V(Overlay.Zones),
  growthStalled: V(Overlay.Desirability), lowAttractiveness: V(Overlay.Tourism), hotelsFull: V(Overlay.Tourism), tourismGood: V(Overlay.Tourism),
};

/** the data view for an advice id ('zoneDev<DevType>' → Desirability of that type, 'zoneNoFit<R|C|I>' → Desirability);
 *  null when no view shows it (money, demand caps, unemployment ...) */
export function adviceView(id: string | undefined | null): AdviceView | null {
  if (!id) return null;
  const v = ADVICE_VIEWS[id];
  if (v) return v;
  const dev = /^zoneDev(\d+)$/.exec(id);
  // (Desirability's variants 0..11 are the DevTypes)
  if (dev) return V(Overlay.Desirability, Number(dev[1]));
  if (id.startsWith('zoneNoFit')) return V(Overlay.Desirability);
  return null;
}

// ------------------------------------------------------------------------------------------------ outages
export interface OutageGroup {
  /** occupied buildings in this outage */
  buildings: number;
  residents: number;
  jobs: number;
  /** centre cell of the biggest one (most residents + jobs), null when none */
  at: { x: number; z: number } | null;
}
export interface UtilityOutages {
  power: OutageGroup;
  water: OutageGroup;
}

const EMPTY: UtilityOutages = {
  power: { buildings: 0, residents: 0, jobs: 0, at: null },
  water: { buildings: 0, residents: 0, jobs: 0, at: null },
};
/** per city: the last count, its building count and when it was taken (performance.now ms) */
const memo = new WeakMap<CityState, { n: number; at: number; out: UtilityOutages }>();
/** a count is reused for this long (real ms) — the panel asks on every UI tick, the top-bar badge every 2 s — unless a
 *  building was added or removed (a repair while paused shows within a second) */
const REUSE_MS = 1000;

/**
 * Occupied growables (residents or jobs; not abandoned or burnt) without power, and those without the piped water they
 * need (demographics.waterRequired) — read from the buildings' own flags, as the population system reads them
 * (population.buildingPowered / buildingWatered: what makes residents leave). Without sim-infra's utilities nothing
 * counts. Cached per city for REUSE_MS of real time, or until the building count changes (one pass over the buildings:
 * ~1–2 ms at a million residents).
 */
export function utilityOutages(st: CityState, now: number = typeof performance !== 'undefined' ? performance.now() : Date.now()): UtilityOutages {
  if (!infraFlags(st).utilities) return EMPTY;
  const m = memo.get(st);
  const n = st.buildings.size;
  if (m && m.n === n && now >= m.at && now - m.at < REUSE_MS) return m.out;
  const out: UtilityOutages = {
    power: { buildings: 0, residents: 0, jobs: 0, at: null },
    water: { buildings: 0, residents: 0, jobs: 0, at: null },
  };
  let bigP = 0, bigW = 0;
  for (const b of st.buildings.values()) {
    const people = b.pop + b.jobs;
    if (!(people > 0) || b.flags & (BF.Abandoned | BF.Burnt | BF.Plopped)) continue;
    if (getDef(b.def)?.category !== 'growable') continue;
    const p = buildingPowered(st, b, true);
    const w = !!(b.flags & BF.Watered) || !waterRequired(st, b) || buildingWatered(st, b, true);
    if (p && w) continue;
    const at = { x: Math.min(st.size - 1, b.x + (b.w >> 1)), z: Math.min(st.size - 1, b.z + (b.d >> 1)) };
    if (!p) {
      const g = out.power;
      g.buildings++;
      g.residents += b.pop;
      g.jobs += b.jobs;
      if (people > bigP) { bigP = people; g.at = at; }
    }
    if (!w) {
      const g = out.water;
      g.buildings++;
      g.residents += b.pop;
      g.jobs += b.jobs;
      if (people > bigW) { bigW = people; g.at = at; }
    }
  }
  for (const g of [out.power, out.water]) {
    g.residents = Math.round(g.residents);
    g.jobs = Math.round(g.jobs);
  }
  memo.set(st, { n, at: now, out });
  return out;
}

const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "2 buildings (83 residents, 12 jobs)" */
export function outageWho(g: OutageGroup): string {
  const parts = [g.residents > 0 ? plural(g.residents, 'resident') : '', g.jobs > 0 ? plural(g.jobs, 'job') : ''].filter(Boolean).join(', ');
  return `${plural(g.buildings, 'building')}${parts ? ` (${parts})` : ''}`;
}

/** the Utilities advisor's outage line (null when every occupied building has power and the water it needs) */
export function outageAssessment(o: UtilityOutages): { level: 'bad' | 'warn'; text: string; at: { x: number; z: number } | null; view: AdviceView } | null {
  if (o.power.buildings > 0) {
    const g = o.power, one = g.buildings === 1;
    const water = o.water.buildings > 0 ? ` (and ${plural(o.water.buildings, 'building')} no water)` : '';
    return {
      level: 'bad',
      text: `${outageWho(g)} ${one ? 'has' : 'have'} no power${water} — reconnect ${one ? 'it' : 'them'} to the grid with a road or power line before people leave.`,
      at: g.at,
      view: V(Overlay.Power),
    };
  }
  if (o.water.buildings > 0) {
    const g = o.water, one = g.buildings === 1;
    return {
      level: 'warn',
      text: `${outageWho(g)} ${one ? 'has' : 'have'} no water — pipes run under roads: connect ${one ? 'its road' : 'their roads'} to a pump or water tower.`,
      at: g.at,
      view: V(Overlay.Water, 0),
    };
  }
  return null;
}
