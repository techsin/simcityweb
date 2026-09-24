/**
 * Ordinances (SC4 style). Enabled ids live in state.budget.ordinances. Costs are charged monthly by the budget
 * system under 'ordinance:<id>' (expense) or income for revenue ordinances.
 *
 * EFFECT KEYS — query with ordinanceEffect(state, key). O(1) (cached per ordinance set).
 *  Multiplicative (product of enabled ordinances, default 1):
 *    'fire.risk'              fire ignition probability            (sim-infra fire)
 *    'fire.effect'            firefighting effectiveness           (sim-infra fire)
 *    'crime.rate'             crime generation                     (sim-infra crime)
 *    'police.effect'          police effectiveness                 (sim-infra crime)
 *    'health.effect'          health coverage effectiveness        (economy HQ + sim-infra)
 *    'edu.effect'             education effectiveness              (economy EQ + sim-infra)
 *    'pollution.air'          all air pollution emissions          (sim-infra pollution)
 *    'pollution.air.industry' extra multiplier for industrial growables & power plants
 *    'pollution.water'        all water pollution emissions
 *    'pollution.water.industry'
 *    'garbage.produced'       garbage generation                   (sim-infra garbage)
 *    'power.demand'           power consumption                    (sim-infra utilities)
 *    'water.demand'           water consumption                    (sim-infra utilities)
 *    'traffic.car'            share / volume of car trips          (sim-infra traffic)
 *    'transit.ridership'      transit attractiveness               (sim-infra traffic)
 *    'tourism.draw'           venue visitor draw                   (economy tourism, WP4)
 *    'power.nuclear'          nuclear plant output (0 = shut down) (sim-infra utilities, WP3)
 *    'pollution.air.power'    extra air multiplier for power plants (sim-infra pollution, WP3)
 *    'pollution.sewage'       residential sewage (water pollution)  (sim-infra pollution, WP3)
 *    'pollution.noise'        noise of commerce, industry and construction sites (sim-infra pollution, WP3)
 *    'pollution.noise.traffic' road / rail traffic noise           (sim-infra pollution, WP3)
 *    'soil.decay'             soil contamination decay speed       (sim-infra pollution, WP3)
 *    'crime.youth'            youth crime component                (sim-infra crime, WP3)
 *    'demand.<Dev>'           demand target per DevType enum name: demand.R1 … demand.IHT      (economy)
 *    'demand.R' | 'demand.C' | 'demand.CS' | 'demand.CO' | 'demand.I'  family multipliers           (economy)
 *  Additive (keys starting with 'add.', sum, default 0):
 *    'add.approval'           mayor approval points                (economy)
 *    'add.desir.<Dev>' / 'add.desir.R|C|I'   desirability shift    (economy)
 *    'add.tourism'            tourism points per 1000 residents    (economy)
 *    'add.rubble.cleanup'     > 0 → burnt rubble is auto-cleared   (economy growth)
 *  'blocks' (definition field): def ids that cannot be built while the ordinance is on (nuclear-free zone).
 */
import { BF, type CityState } from '../CityState';
import { getDef } from '../catalog';

export interface OrdinanceDef {
  id: string;
  name: string;
  description: string;
  /** monthly cost = fixed + perCapita × population. With `income: true` the same formula is monthly income. */
  fixed: number;
  perCapita: number;
  income?: boolean;
  /** population needed before the ordinance can be enacted */
  unlockPop: number;
  effects: Record<string, number>;
  /** def ids blocked while enabled */
  blocks?: string[];
  /** short human-readable effect summary */
  effectText: string;
}

export const ORDINANCES: OrdinanceDef[] = [
  { id: 'smoke_detectors', name: 'Smoke Detector Program', description: 'Free smoke detectors for every home and business.', fixed: 25, perCapita: 0.006,
    unlockPop: 500, effects: { 'fire.risk': 0.75 }, effectText: '−25% fire risk' },
  { id: 'rubble_cleanup', name: 'Municipal Demolition Crews', description: 'City crews clear burnt-out rubble automatically so lots can rebuild.', fixed: 100, perCapita: 0.002,
    unlockPop: 1000, effects: { 'add.rubble.cleanup': 1 }, effectText: 'Rubble auto-cleared after 30 days' },
  { id: 'neighborhood_watch', name: 'Neighborhood Watch', description: 'Residents keep an eye out for each other.', fixed: 20, perCapita: 0.005,
    unlockPop: 1500, effects: { 'crime.rate': 0.9, 'add.approval': 1 }, effectText: '−10% crime, +1 approval' },
  { id: 'youth_curfew', name: 'Youth Curfew', description: 'Minors must be home by 10pm.', fixed: 10, perCapita: 0.005,
    unlockPop: 2500, effects: { 'crime.rate': 0.9, 'crime.youth': 0.5, 'add.approval': -1, 'add.desir.R3': -0.01 }, effectText: '−50% youth crime, −10% crime, −1 approval' },
  { id: 'legalized_gambling', name: 'Legalized Gambling', description: 'Allow casinos and betting. Brings money — and crime.', fixed: 0, perCapita: 0.03, income: true,
    unlockPop: 3000, effects: { 'crime.rate': 1.15, 'add.approval': -2 }, effectText: '+§0.03/resident income, +15% crime, unlocks casinos' },
  { id: 'pro_reading', name: 'Pro-Reading Campaign', description: 'Libraries and schools promote reading.', fixed: 30, perCapita: 0.006,
    unlockPop: 3000, effects: { 'edu.effect': 1.1 }, effectText: '+10% education effectiveness' },
  { id: 'free_clinics', name: 'Free Clinics', description: 'Free medical care for low-income residents.', fixed: 50, perCapita: 0.012,
    unlockPop: 5000, effects: { 'health.effect': 1.15, 'add.desir.R1': 0.04 }, effectText: '+15% health effectiveness, R$ like it' },
  { id: 'carpool', name: 'Carpool Incentive', description: 'Rewards for commuters who share rides.', fixed: 20, perCapita: 0.006,
    unlockPop: 5000, effects: { 'traffic.car': 0.93, 'pollution.air': 0.97 }, effectText: '−7% car traffic' },
  { id: 'water_conservation', name: 'Water Conservation', description: 'Low-flow fixtures and watering restrictions.', fixed: 20, perCapita: 0.006,
    unlockPop: 5000, effects: { 'water.demand': 0.8 }, effectText: '−20% water use' },
  { id: 'power_conservation', name: 'Power Conservation', description: 'Efficient appliances and lighting subsidies.', fixed: 30, perCapita: 0.008,
    unlockPop: 6000, effects: { 'power.demand': 0.85 }, effectText: '−15% power use' },
  { id: 'recycling', name: 'Recycling Program', description: 'Curbside recycling for every home.', fixed: 40, perCapita: 0.01,
    unlockPop: 8000, effects: { 'garbage.produced': 0.8 }, effectText: '−20% garbage' },
  { id: 'parking_fines', name: 'Parking Fines', description: 'Aggressive enforcement of parking rules.', fixed: 0, perCapita: 0.008, income: true,
    unlockPop: 8000, effects: { 'traffic.car': 0.97, 'add.approval': -1 }, effectText: '+§0.008/resident income, −3% car trips, −1 approval' },
  { id: 'nuclear_free_zone', name: 'Nuclear Free Zone', description: 'Declare the city nuclear free. No nuclear plants allowed.', fixed: 0, perCapita: 0,
    unlockPop: 10000, effects: { 'add.desir.R': 0.02, 'add.desir.R3': 0.02, 'add.approval': 1, 'power.nuclear': 0 }, blocks: ['util_nuclear_plant'],
    effectText: 'Residents feel safer (+desirability), bans nuclear power and shuts down existing nuclear plants' },
  { id: 'tourism_promotion', name: 'Tourism Promotion', description: 'Advertise the city to visitors from around the world.', fixed: 300, perCapita: 0.004,
    unlockPop: 10000, effects: { 'demand.CS': 1.08, 'add.tourism': 4, 'tourism.draw': 1.2 }, effectText: '+8% retail demand, more tourists' },
  { id: 'pollution_controls', name: 'Industrial Pollution Controls', description: 'Scrubbers and filters required on industrial sites.', fixed: 100, perCapita: 0.005,
    unlockPop: 12000, effects: { 'pollution.air.industry': 0.85, 'pollution.water.industry': 0.75, 'demand.I': 0.94 }, effectText: '−15% industrial air, −25% water pollution, −6% industrial demand' },
  { id: 'tire_recycling', name: 'Tire Recycling', description: 'Keeps old tires out of landfills and fires.', fixed: 250, perCapita: 0,
    unlockPop: 12000, effects: { 'pollution.air': 0.97, 'garbage.produced': 0.97 }, effectText: '−3% air pollution and garbage' },
  { id: 'commuter_shuttle', name: 'Commuter Shuttle Service', description: 'Shuttle buses between neighborhoods and job centers.', fixed: 50, perCapita: 0.01,
    unlockPop: 15000, effects: { 'traffic.car': 0.95, 'transit.ridership': 1.1 }, effectText: '−5% car traffic, +10% transit use' },
  { id: 'clean_air_act', name: 'Clean Air Act', description: 'Strict emission limits for industry.', fixed: 200, perCapita: 0.004,
    unlockPop: 20000, effects: { 'pollution.air.industry': 0.7, 'demand.ID': 0.75, 'demand.IM': 0.95 }, effectText: '−30% industrial air pollution, −25% dirty industry demand' },
  // ---- SIM_DEPTH_SPEC WP3 (environment)
  { id: 'quiet_zones', name: 'Quiet Zones', description: 'Quiet hours for shops, factories and building sites; lower speed limits and truck routes.', fixed: 30, perCapita: 0.004,
    unlockPop: 4000, effects: { 'pollution.noise': 0.85, 'pollution.noise.traffic': 0.9 }, effectText: '−15% business & construction noise, −10% traffic noise' },
  { id: 'sewage_mandate', name: 'Sewage Treatment Mandate', description: 'Septic upgrades and sewer connections for every home.', fixed: 40, perCapita: 0.003,
    unlockPop: 6000, effects: { 'pollution.sewage': 0.6 }, effectText: '−40% sewage water pollution (cleaner rivers and tap water)' },
  { id: 'clean_power_act', name: 'Clean Power Act', description: 'Scrubbers and filters on every power plant. Utilities pass the cost on.', fixed: 150, perCapita: 0.004,
    unlockPop: 8000, effects: { 'pollution.air.power': 0.6 }, effectText: '−40% power plant smoke' },
  { id: 'brownfield_cleanup', name: 'Brownfield Cleanup', description: 'Crews excavate and treat contaminated soil at old industrial sites and landfills.', fixed: 200, perCapita: 0.002,
    unlockPop: 10000, effects: { 'soil.decay': 5 }, effectText: 'Contaminated soil recovers 5× faster' },
];

const BY_ID = new Map(ORDINANCES.map((o) => [o.id, o]));
export function getOrdinance(id: string): OrdinanceDef | undefined {
  return BY_ID.get(id);
}

/** monthly cost of an ordinance (negative = income) at the current population */
export function ordinanceMonthly(o: OrdinanceDef, population: number): number {
  const v = o.fixed + o.perCapita * population;
  return o.income ? -v : v;
}

export function ordinanceAvailable(state: CityState, o: OrdinanceDef): boolean {
  return !!state.config.sandbox || state.stats.population >= o.unlockPop;
}

// ---------------------------------------------------------------------------- cached effects
interface EffectCache { list: string[]; mul: Map<string, number>; add: Map<string, number> }
const cache = new WeakMap<CityState, EffectCache>();

function effects(state: CityState): EffectCache {
  const ords = state.budget.ordinances;
  let c = cache.get(state);
  if (c && c.list.length === ords.length && c.list.every((v, i) => v === ords[i])) return c;
  c = { list: ords.slice(), mul: new Map(), add: new Map() };
  for (const id of ords) {
    const o = BY_ID.get(id);
    if (!o) continue;
    for (const [k, v] of Object.entries(o.effects)) {
      if (k.startsWith('add.')) c.add.set(k, (c.add.get(k) ?? 0) + v);
      else c.mul.set(k, (c.mul.get(k) ?? 1) * v);
    }
  }
  cache.set(state, c);
  return c;
}

/**
 * Combined effect of enabled ordinances for `key`. Keys starting with 'add.' are additive (default 0),
 * all others multiplicative (default 1). See the key list at the top of this file.
 */
export function ordinanceEffect(state: CityState, key: string): number {
  const c = effects(state);
  if (key.startsWith('add.')) return c.add.get(key) ?? 0;
  return c.mul.get(key) ?? 1;
}

/** true if a def id is blocked by an enabled ordinance (e.g. nuclear-free zone) */
export function blockedByOrdinance(state: CityState, defId: string): OrdinanceDef | undefined {
  for (const id of state.budget.ordinances) {
    const o = BY_ID.get(id);
    if (o?.blocks?.includes(defId)) return o;
  }
  return undefined;
}

export interface OrdinanceInfo {
  id: string;
  name: string;
  description: string;
  effectText: string;
  enabled: boolean;
  /** can be enacted now (population reached) */
  available: boolean;
  unlockText: string;
  /** monthly § at current population; negative = income */
  monthly: number;
  income: boolean;
}

/** Ordinance list for the UI. */
export function listOrdinances(state: CityState): OrdinanceInfo[] {
  const pop = state.stats.population;
  return ORDINANCES.map((o) => ({
    id: o.id,
    name: o.name,
    description: o.description,
    effectText: o.effectText,
    enabled: state.budget.ordinances.includes(o.id),
    available: ordinanceAvailable(state, o),
    unlockText: `Requires population ${o.unlockPop.toLocaleString('en-US')}`,
    monthly: Math.round(ordinanceMonthly(o, pop)),
    income: !!o.income,
  }));
}

/** operating buildings of defs the ordinance blocks (burnt ones do not count): count, total MW, a display name */
function standingBlocked(state: CityState, o: OrdinanceDef): { count: number; mw: number; name: string } {
  let count = 0, mw = 0, name = '';
  if (!o.blocks?.length) return { count, mw, name };
  for (const b of state.buildings.values()) {
    if (!o.blocks.includes(b.def) || (b.flags & BF.Burnt) !== 0) continue;
    const d = getDef(b.def);
    count++;
    mw += d?.powerOut ?? 0;
    if (!name) name = d?.name ?? b.def;
  }
  return { count, mw, name };
}

/**
 * Enable / disable. Returns a reason when refused. (CityActions.setOrdinance wraps this.)
 * An ordinance whose effect keys shut existing buildings down (nuclear-free zone: 'power.nuclear' 0 -> utilities,
 * WP3-1) is refused while such a building still operates, unless `opts.confirm` is set: the UI asks first (WP5-6) and
 * enacts again with confirm; `needsConfirm` marks that refusal.
 */
export function setOrdinanceEnabled(state: CityState, id: string, enabled: boolean, opts: { confirm?: boolean } = {}): { ok: boolean; reason?: string; monthly: number; needsConfirm?: boolean } {
  const o = BY_ID.get(id);
  if (!o) return { ok: false, reason: `Unknown ordinance "${id}"`, monthly: 0 };
  const list = state.budget.ordinances;
  const has = list.includes(id);
  const monthly = ordinanceMonthly(o, state.stats.population);
  if (enabled) {
    if (has) return { ok: true, monthly };
    if (!ordinanceAvailable(state, o)) return { ok: false, reason: `Needs a population of ${o.unlockPop.toLocaleString('en-US')}`, monthly };
    if (!opts.confirm) {
      const s = standingBlocked(state, o);
      if (s.count > 0) {
        const what = s.count > 1 ? `${s.count} ${s.name}s` : `the ${s.name}`;
        const mw = s.mw > 0 ? ` (−${Math.round(s.mw).toLocaleString('en-US')} MW)` : '';
        return { ok: false, reason: `Demolish ${what} first: this ordinance would shut ${s.count > 1 ? 'them' : 'it'} down${mw}`, monthly, needsConfirm: true };
      }
    }
    list.push(id);
  } else {
    if (!has) return { ok: true, monthly: 0 };
    list.splice(list.indexOf(id), 1);
  }
  return { ok: true, monthly: enabled ? monthly : 0 };
}
