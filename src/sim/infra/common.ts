/**
 * Shared helpers for the infrastructure systems: building-def classification (cached), ordinance lookup,
 * service funding factor, building occupancy helpers and a safe building-removal helper.
 * Headless: no DOM / three.js.
 */
import { DevType, Zone, zoneFamily, zoneDensity } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { Simulation } from '../Simulation';
import { getDef } from '../catalog';
import type { BuildingDef, ServiceKind } from '../catalogTypes';
import { ordinanceEffect } from '../economy/ordinances';

export const DX = [1, 0, -1, 0] as const;
export const DZ = [0, 1, 0, -1] as const;

// ------------------------------------------------------------------------------------------ def info
export enum Fam {
  None = 0,
  R = 1,
  C = 2,
  I = 3,
  Plop = 4,
}

export enum Transit {
  None = 0,
  Bus = 1,
  Subway = 2,
  Train = 3,
  Freight = 4,
  Seaport = 5,
  Airport = 6,
  Ferry = 7,
}

export const COV_KINDS = ['police', 'fire', 'health', 'education', 'park', 'transit', 'garbage'] as const;
export type CovKindName = (typeof COV_KINDS)[number];

export interface DefInfo {
  id: string;
  model: string;
  known: boolean;
  fam: Fam;
  /** DevType or -1 */
  dev: number;
  category: string;
  service?: ServiceKind;
  /** jobs offered by a plopped building (def.jobs) */
  civicJobs: number;
  powerOut: number;
  /** full-occupancy power use or -1 = derive */
  powerUse: number;
  waterOut: number;
  waterUse: number;
  garbageCap: number;
  air: number;
  waterPoll: number;
  noise: number;
  garbage: number;
  pollRadius: number;
  /** index into COV_KINDS or -1 */
  cov: number;
  covRadius: number;
  covStrength: number;
  covCapacity: number;
  transit: Transit;
  isPump: boolean;
  isTreatment: boolean;
  isIncinerator: boolean;
  isRecycling: boolean;
  /** jail boosts police effectiveness */
  isJail: boolean;
  isPark: boolean;
  /** passenger capacity (def.capacity) for treatment plants etc. */
  capacity: number;
}

const infoCache = new Map<string, DefInfo>();

const TRANSIT_BY_MODEL: Record<string, Transit> = {
  tr_bus_stop: Transit.Bus,
  tr_subway_station: Transit.Subway,
  tr_train_station: Transit.Train,
  tr_freight_station: Transit.Freight,
  tr_seaport: Transit.Seaport,
  tr_airport_small: Transit.Airport,
  tr_airport_large: Transit.Airport,
  tr_ferry_terminal: Transit.Ferry,
};

function transitRole(def: BuildingDef): Transit {
  const byModel = TRANSIT_BY_MODEL[def.model] ?? TRANSIT_BY_MODEL[def.id];
  if (byModel !== undefined) return byModel;
  const s = (def.id + ' ' + def.model).toLowerCase();
  if (def.category !== 'transport') return Transit.None;
  if (s.includes('bus_stop') || s.includes('busstop')) return Transit.Bus;
  if (s.includes('subway') || s.includes('metro')) return Transit.Subway;
  if (s.includes('freight')) return Transit.Freight;
  if (s.includes('train') || s.includes('rail')) return Transit.Train;
  if (s.includes('seaport') || s.includes('harbor') || s.includes('port')) return Transit.Seaport;
  if (s.includes('airport') || s.includes('airfield')) return Transit.Airport;
  if (s.includes('ferry')) return Transit.Ferry;
  return Transit.None;
}

function famOfDev(dev: number): Fam {
  if (dev < 0) return Fam.None;
  if (dev <= DevType.R3) return Fam.R;
  if (dev <= DevType.CO3) return Fam.C;
  return Fam.I;
}

function buildInfo(def: BuildingDef): DefInfo {
  const dev = def.devType ?? -1;
  let fam = famOfDev(dev);
  if (fam === Fam.None) fam = def.category === 'growable' ? Fam.None : Fam.Plop;
  const s = (def.id + ' ' + def.model).toLowerCase();
  const covIdx = def.coverage ? COV_KINDS.indexOf(def.coverage.kind as CovKindName) : -1;
  return {
    id: def.id,
    model: def.model,
    known: true,
    fam,
    dev,
    category: def.category,
    service: def.service,
    civicJobs: def.jobs ?? 0,
    powerOut: def.powerOut ?? 0,
    powerUse: def.powerUse ?? -1,
    waterOut: def.waterOut ?? 0,
    waterUse: def.waterUse ?? -1,
    garbageCap: def.garbageCapacity ?? 0,
    air: def.pollution?.air ?? 0,
    waterPoll: def.pollution?.water ?? 0,
    noise: def.pollution?.noise ?? 0,
    garbage: def.pollution?.garbage ?? 0,
    pollRadius: def.pollution?.radius ?? 0,
    cov: covIdx,
    covRadius: def.coverage?.radius ?? 0,
    covStrength: def.coverage?.strength ?? 0,
    covCapacity: def.coverage?.capacity ?? 0,
    transit: transitRole(def),
    isPump: (def.waterOut ?? 0) > 0 && (s.includes('pump') || s.includes('well')),
    isTreatment: s.includes('treatment') || s.includes('sewage'),
    isIncinerator: s.includes('incinerator') || s.includes('waste_to_energy'),
    isRecycling: s.includes('recycl'),
    isJail: s.includes('jail') || s.includes('prison'),
    isPark: def.category === 'park',
    capacity: def.capacity ?? 0,
  };
}

const ZONE_DEV_GUESS: Record<number, number[]> = {
  [Zone.ResLow]: [DevType.R1, DevType.R2, DevType.R3],
  [Zone.ResMed]: [DevType.R1, DevType.R2, DevType.R3],
  [Zone.ResHigh]: [DevType.R1, DevType.R2, DevType.R3],
  [Zone.ComLow]: [DevType.CS1, DevType.CS2, DevType.CS3],
  [Zone.ComMed]: [DevType.CS1, DevType.CO2, DevType.CS3],
  [Zone.ComHigh]: [DevType.CS2, DevType.CO2, DevType.CO3],
  [Zone.IndAg]: [DevType.IA, DevType.IA, DevType.IA],
  [Zone.IndMed]: [DevType.ID, DevType.IM, DevType.IM],
  [Zone.IndHigh]: [DevType.IM, DevType.IHT, DevType.IHT],
};

const unknownInfo: DefInfo = {
  id: '', model: '', known: false, fam: Fam.Plop, dev: -1, category: 'civic', civicJobs: 0,
  powerOut: 0, powerUse: -1, waterOut: 0, waterUse: -1, garbageCap: 0,
  air: 0, waterPoll: 0, noise: 0, garbage: 0, pollRadius: 0,
  cov: -1, covRadius: 0, covStrength: 0, covCapacity: 0, transit: Transit.None,
  isPump: false, isTreatment: false, isIncinerator: false, isRecycling: false, isJail: false, isPark: false, capacity: 0,
};
const guessCache = new Map<number, DefInfo>();

/** classification of a building (cached per def id). Falls back to the zone under the building for unknown defs. */
export function infoOf(state: CityState, b: Building): DefInfo {
  const cached = infoCache.get(b.def);
  if (cached) return cached;
  const def = getDef(b.def);
  if (def) {
    const inf = buildInfo(def);
    infoCache.set(b.def, inf);
    return inf;
  }
  // unknown def (catalog not loaded yet): guess from zone + wealth; do NOT cache by def id
  const z = state.zone[b.z * state.size + b.x] as Zone;
  const fam = zoneFamily(z);
  if (fam === 'R' || fam === 'C' || fam === 'I') {
    const w = Math.max(1, Math.min(3, b.wealth || 1));
    const dev = ZONE_DEV_GUESS[z][w - 1];
    const key = dev;
    let g = guessCache.get(key);
    if (!g) {
      g = { ...unknownInfo, fam: famOfDev(dev), dev, category: 'growable' };
      guessCache.set(key, g);
    }
    return g;
  }
  return unknownInfo;
}

/** clear classification cache (call after the catalog changes) */
export function clearInfoCache(): void {
  infoCache.clear();
  guessCache.clear();
}

export function wealthOf(inf: DefInfo, b: Building): number {
  if (inf.dev >= 0) {
    switch (inf.dev) {
      case DevType.R1: case DevType.CS1: return 1;
      case DevType.R2: case DevType.CS2: case DevType.CO2: return 2;
      case DevType.R3: case DevType.CS3: case DevType.CO3: return 3;
    }
  }
  return Math.max(1, Math.min(3, b.wealth || 2));
}

export function isDensity(z: Zone): number {
  return zoneDensity(z);
}

// ------------------------------------------------------------------------------------------ occupancy
/** building exists as a functioning structure (complete, not rubble). Abandoned buildings are inactive. */
export function isFunctional(b: Building): boolean {
  return b.built >= 1 && (b.flags & (BF.Burnt | BF.Abandoned)) === 0;
}

/**
 * Job slots of a job site used for commuting: growable C/I -> capacity, plopped -> def.jobs (or capacity).
 * Sim-core owns b.jobs; traffic reports reachability via TrafficSystem.jobFill().
 */
export function jobSlots(inf: DefInfo, b: Building): number {
  if (!isFunctional(b)) return 0;
  if (inf.fam === Fam.C || inf.fam === Fam.I) return b.capacity > 0 ? b.capacity : b.jobs;
  if (inf.fam === Fam.Plop) return inf.civicJobs > 0 ? inf.civicJobs : 0;
  return 0;
}

/** currently active jobs (for pollution / garbage / utilities): b.jobs, or a fallback when sim-core doesn't fill jobs */
export function activeJobs(inf: DefInfo, b: Building, jobsUnknown: boolean): number {
  if (inf.fam === Fam.R) return 0;
  if (!isFunctional(b)) return 0;
  if (b.jobs > 0) return b.jobs;
  if (jobsUnknown) {
    if (inf.fam === Fam.C || inf.fam === Fam.I) return b.capacity * 0.6;
    return inf.civicJobs;
  }
  return inf.fam === Fam.Plop ? inf.civicJobs * 0.5 : 0;
}

/**
 * activity 0..1 of a building (drives pollution / garbage / utility use scaling): R = pop / capacity,
 * C / I = active jobs / capacity, plopped = 1 when functional.
 */
export function activity(inf: DefInfo, b: Building, jobsUnknown: boolean): number {
  if (!isFunctional(b)) return 0;
  if (inf.fam === Fam.Plop || inf.fam === Fam.None) return 1;
  if (b.capacity <= 0) return 1;
  if (inf.fam === Fam.R) return Math.min(1, b.pop / b.capacity);
  return Math.min(1, activeJobs(inf, b, jobsUnknown) / b.capacity);
}

/** true when no job site has b.jobs > 0 although job capacity exists (sim-core not filling jobs yet) */
export function detectJobsUnknown(state: CityState): boolean {
  let cap = 0;
  for (const b of state.buildings.values()) {
    if (b.jobs > 0) return false;
    if (b.capacity > 0 && b.pop === 0) cap += b.capacity;
  }
  return cap > 0;
}

// ------------------------------------------------------------------------------------------ ordinances
/**
 * Ordinance effects relevant to the infrastructure systems, read once per update through sim-core's
 * ordinanceEffect(state, key) (src/sim/economy/ordinances.ts; multiplicative keys, default 1).
 */
export interface OrdEffects {
  fireRisk: number;
  fireEffect: number;
  crimeRate: number;
  policeEffect: number;
  healthEffect: number;
  eduEffect: number;
  air: number;
  airIndustry: number;
  water: number;
  waterIndustry: number;
  garbage: number;
  powerDemand: number;
  waterDemand: number;
  trafficCar: number;
  transitRidership: number;
}

function eff(state: CityState, key: string): number {
  try {
    const v = ordinanceEffect(state, key);
    return typeof v === 'number' && isFinite(v) && v >= 0 ? v : 1;
  } catch {
    return 1;
  }
}

export function readEffects(state: CityState): OrdEffects {
  return {
    fireRisk: eff(state, 'fire.risk'),
    fireEffect: eff(state, 'fire.effect'),
    crimeRate: eff(state, 'crime.rate'),
    policeEffect: eff(state, 'police.effect'),
    healthEffect: eff(state, 'health.effect'),
    eduEffect: eff(state, 'edu.effect'),
    air: eff(state, 'pollution.air'),
    airIndustry: eff(state, 'pollution.air.industry'),
    water: eff(state, 'pollution.water'),
    waterIndustry: eff(state, 'pollution.water.industry'),
    garbage: eff(state, 'garbage.produced'),
    powerDemand: eff(state, 'power.demand'),
    waterDemand: eff(state, 'water.demand'),
    trafficCar: eff(state, 'traffic.car'),
    transitRidership: eff(state, 'transit.ridership'),
  };
}

// ------------------------------------------------------------------------------------------ funding
/** funding percent -> effectiveness: linear below 100 %, diminishing returns above (150 % -> ~1.25) */
export function fundingFactor(state: CityState, service: ServiceKind | undefined): number {
  if (!service) return 1;
  const pct = state.budget?.funding?.[service];
  if (pct === undefined || pct === null || !isFinite(pct)) return 1;
  const f = Math.max(0, pct) / 100;
  if (f <= 1) return f;
  return 1 + (1 - Math.exp(-(f - 1) * 2.5)) * 0.35;
}

// ------------------------------------------------------------------------------------------ misc
/** building ids can be large; returns an Int32Array big enough to index by id */
export function ensureIdArray(arr: Int32Array<ArrayBuffer>, state: CityState): Int32Array<ArrayBuffer> {
  if (arr.length >= state.nextBuildingId + 1) return arr;
  const n = new Int32Array(Math.max(state.nextBuildingId + 1, arr.length * 2, 1024));
  n.set(arr);
  return n;
}
export function ensureIdFloat(arr: Float32Array<ArrayBuffer>, state: CityState, fill = 0): Float32Array<ArrayBuffer> {
  if (arr.length >= state.nextBuildingId + 1) return arr;
  const n = new Float32Array(Math.max(state.nextBuildingId + 1, arr.length * 2, 1024));
  if (fill !== 0) n.fill(fill);
  n.set(arr);
  return n;
}

/** set or clear a BF flag on a building; emits buildingChanged only when it flips. Returns true if flipped. */
export function setFlag(sim: Simulation, b: Building, flag: number, on: boolean): boolean {
  const has = (b.flags & flag) !== 0;
  if (has === on) return false;
  b.flags = on ? b.flags | flag : b.flags & ~flag;
  sim.events.emit('buildingChanged', b);
  return true;
}

/** set/clear a flag without emitting (caller batches emission) */
export function setFlagQuiet(b: Building, flag: number, on: boolean): boolean {
  const has = (b.flags & flag) !== 0;
  if (has === on) return false;
  b.flags = on ? b.flags | flag : b.flags & ~flag;
  return true;
}

/**
 * Remove a building completely: clears its cells in state.building, deletes it from state.buildings and emits
 * buildingRemoved. Used by disasters (meteor crater). Zones stay.
 */
export function removeBuilding(sim: Simulation, b: Building): void {
  const st = sim.state;
  const N = st.size;
  for (let z = b.z; z < b.z + b.d; z++) {
    if (z < 0 || z >= N) continue;
    for (let x = b.x; x < b.x + b.w; x++) {
      if (x < 0 || x >= N) continue;
      const i = z * N + x;
      if (st.building[i] === b.id) st.building[i] = -1;
    }
  }
  st.buildings.delete(b.id);
  sim.events.emit('buildingRemoved', b);
}

/** centre cell index of a building */
export function centerCell(state: CityState, b: Building): number {
  const cx = Math.min(state.size - 1, b.x + (b.w >> 1));
  const cz = Math.min(state.size - 1, b.z + (b.d >> 1));
  return cz * state.size + cx;
}

export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
