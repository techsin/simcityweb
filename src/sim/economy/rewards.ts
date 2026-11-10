/**
 * Rewards, unlocks, landmarks and business deals (SC4 style).
 * When a reward's conditions are met: state.unlocked.add(id), notify(kind 'reward'), emit 'unlocked' (once).
 * Unlocks are permanent. BuildingDef.requires references these ids. Sandbox unlocks ordinary rewards; honours are earned.
 */
import type { SimSystem, Simulation } from '../Simulation';
import { BF, type CityState } from '../CityState';
import { DevType } from '../../core/types';
import { DAYS_PER_MONTH } from '../../core/constants';
import { getDef } from '../catalog';
import { reachRaw, reachResult } from '../infra/catchments';
import type { EconRuntime } from './runtime';

export type RewardKind = 'unlock' | 'reward' | 'landmark' | 'deal' | 'honour';

export interface CityRank {
  id: string;
  name: string;
  population: number;
}

export const CITY_RANKS: readonly CityRank[] = [
  { id: 'settlement', name: 'Settlement', population: 0 },
  { id: 'village', name: 'Village', population: 1000 },
  { id: 'town', name: 'Town', population: 5000 },
  { id: 'small_city', name: 'Small City', population: 10000 },
  { id: 'city', name: 'City', population: 25000 },
  { id: 'large_city', name: 'Large City', population: 50000 },
  { id: 'metropolis', name: 'Metropolis', population: 100000 },
  { id: 'major_metropolis', name: 'Major Metropolis', population: 250000 },
  { id: 'global_city', name: 'Global City', population: 500000 },
  { id: 'world_city', name: 'World City', population: 750000 },
  { id: 'megacity', name: 'Megacity', population: 1000000 },
  { id: 'megalopolis', name: 'Megalopolis', population: 1500000 },
];

type MilestoneState = Pick<CityState, 'stats' | 'unlocked' | 'milestones'>;

interface CondInfo {
  label: string;
  need: number;
  /** display format */
  fmt?: 'int' | 'bool' | 'decimal' | 'percent';
  atMost?: boolean;
  below?: boolean;
}

type Cond = CondInfo & (
  | { value: (st: MilestoneState) => number; fullState?: false }
  | { value: (st: CityState) => number; fullState: true }
);

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
  /** composite goals describe their alternative routes together */
  progressText?: (st: CityState) => string;
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

/** Monthly survey and consecutive qualifying months. Optional in saves made before LG-20. */
export interface HonoursData {
  month: number;
  cleanAir: number;
  safeCity: number;
  employment: number;
  books: number;
  homes: number;
  noisyShare: number;
  parkShare: number;
  booksInterrupted?: boolean;
  cleanAirInterrupted?: boolean;
  safeCityInterrupted?: boolean;
  employmentInterrupted?: boolean;
}

function honoursData(st: CityState): HonoursData | undefined {
  return (st.systemData.economy as { honours?: HonoursData } | undefined)?.honours;
}

const inhabited: Cond = { label: 'Occupied homes', need: 1, fmt: 'bool', fullState: true, value: (s) => (honoursData(s)?.homes ?? 0) > 0 ? 1 : 0 };
const streak = (key: 'cleanAir' | 'safeCity' | 'employment' | 'books', label: string, need: number): Cond => ({
  label, need, fullState: true, value: (s) => honoursData(s)?.[key] ?? 0,
});
const transitShare = (st: MilestoneState) => {
  const s = st.stats, trips = s.tripsCar + s.tripsTransit + s.tripsWalk;
  return trips > 0 ? s.tripsTransit / trips : 0;
};
const highestTax = (st: CityState) => Math.max(0, ...st.budget.taxRates);

function honour(id: string, name: string, conds: Cond[], description: string, extra: string[] = []): RewardDef {
  return { id: 'honour_' + id, name, kind: 'honour', conds: [inhabited, ...conds],
    defIds: ['rw_honour_' + id + '_plaque', ...extra], description,
    announce: `Honour earned: ${name}! Your city has been awarded a commemorative plaque.` };
}

export const HONOURS: RewardDef[] = [
  honour('clean_air_metropolis', 'Clean Air Metropolis', [pop(250000),
    { label: 'Air at homes', need: 0.10, atMost: true, fmt: 'decimal', value: (s) => s.stats.avgAir },
    streak('cleanAir', 'Clean-air months', 12)], 'Keep air at homes at 0.10 or less for 12 months with 250,000 residents. Unlocks the Eco Plaza.', ['rw_eco_plaza']),
  honour('transit_capital', 'Transit Capital', [pop(200000),
    { label: 'Transit trips', need: 0.25, fmt: 'percent', value: transitShare }], 'Carry at least 25% of trips by transit with 200,000 residents. +5% transit ridership.'),
  honour('scholar_city', 'Scholar City', [eq(130)], 'Reach EQ 130. +5% education effectiveness.'),
  honour('healthy_city', 'Healthy City', [hq(130)], 'Reach HQ 130.'),
  honour('safe_city', 'Safe City', [pop(100000),
    { label: 'Failed emergencies last month', need: 0, atMost: true, value: (s) => s.stats.emergency.lastMonth.failed },
    streak('safeCity', 'Months without a failed emergency', 60)],
    "Keep 100,000 residents safe for five years without a failed emergency. Unlocks the Firefighters' Memorial.", ['rw_firefighters_memorial']),
  honour('tourist_capital', 'Tourist Capital', [{ label: 'Tourists/day', need: 50000, value: (s) => s.stats.tourists }], 'Welcome 50,000 tourists a day.'),
  honour('full_employment', 'Full Employment', [pop(500000),
    { label: 'Unemployment', need: 0.03, atMost: true, fmt: 'percent', value: (s) => s.stats.unemployment },
    streak('employment', 'Full-employment months', 24)], 'Keep unemployment at 3% or less for two years with 500,000 residents.'),
  honour('green_belt', 'Green Belt', [{ label: 'Homes in reach of a large park', need: 0.30, fmt: 'percent', fullState: true, value: (s) => honoursData(s)?.parkShare ?? 0 }],
    'Bring at least 30% of occupied homes within walking reach of a Large Park.'),
  honour('balanced_books', 'Balanced Books', [
    { label: 'Outstanding loans', need: 0, atMost: true, fullState: true, value: (s) => s.budget.loans.length },
    { label: 'Highest tax', need: 9, atMost: true, fullState: true, value: highestTax }, streak('books', 'Loan-free months at taxes ≤9%', 120)],
    'Go ten years without a loan and keep every tax rate at 9% or less.'),
  honour('quiet_city', 'Quiet City', [pop(250000),
    { label: 'Noisy homes', need: 0.05, below: true, atMost: true, fmt: 'percent', fullState: true, value: (s) => honoursData(s)?.noisyShare ?? 1 }],
    'Keep fewer than 5% of occupied homes Noisy with 250,000 residents.'),
  honour('megacity', 'Megacity', [pop(1000000)], 'Build a city of one million residents.'),
  honour('megalopolis', 'Megalopolis', [pop(1500000)], 'Build a city of one and a half million residents.'),
];

/** Small permanent perks; the infrastructure effects reader applies them once per pass. */
export function honourPerks(st: Pick<CityState, 'unlocked'>): { education: number; ridership: number } {
  return { education: st.unlocked.has('honour_scholar_city') ? 1.05 : 1,
    ridership: st.unlocked.has('honour_transit_capital') ? 1.05 : 1 };
}

/**
 * The walking reach of the standing Large Parks, kept from one survey to the next (QA round 2, B8: the survey searched
 * every park and walked the buildings twice each month, 6 ms on a cold run in a city of a million). A park's reach is a
 * function of its lot and of the network and the water around it (catchments.ts reachRoad / nearField). So each survey
 * compares the two layers with the copies its mask was searched on, and searches again only the parks near a cell that
 * differs; a park that came or went searches them all. The mask is, cell for cell, a fresh search's.
 */
interface ParkReach {
  radius: number;
  /** id, x, z, w, d of every park in the mask, in building order (none: nothing is kept) */
  parks: number[];
  /** x0, z0, x1, z1 of the cells each park marks */
  boxes: number[];
  network: Uint8Array;
  water: Uint8Array;
  mask: Uint8Array;
}

const NO_CELLS = new Uint8Array(0);
const noParkReach = (): ParkReach => ({ radius: 0, parks: [], boxes: [], network: NO_CELLS, water: NO_CELLS, mask: NO_CELLS });

/** search park `p` on the layers as they are, mark the cells it reaches and note their box */
function markParkReach(st: CityState, reach: ParkReach, p: number): void {
  const N = st.size, parks = reach.parks, boxes = reach.boxes, mask = reach.mask, k = p * 5;
  const n = reachRaw(st, parks[k + 1], parks[k + 2], parks[k + 3], parks[k + 4], reach.radius, 0);
  const { touched, best } = reachResult();
  let x0 = N, z0 = N, x1 = -1, z1 = -1;
  for (let t = 0; t < n; t++) {
    const i = touched[t];
    if (!(best[i] > 0)) continue;
    mask[i] = 1;
    const x = i % N, z = (i - x) / N;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  boxes[p * 4] = x0;
  boxes[p * 4 + 1] = z0;
  boxes[p * 4 + 2] = x1;
  boxes[p * 4 + 3] = z1;
}

/** search the reach of `parks` afresh, and keep it with the layers it was searched on */
function searchParkReach(st: CityState, reach: ParkReach, parks: number[], radius: number): Uint8Array {
  reach.mask = reach.mask.length === st.cells ? reach.mask.fill(0) : new Uint8Array(st.cells);
  reach.radius = radius;
  reach.parks = parks;
  reach.boxes = [];
  for (let p = 0; p * 5 < parks.length; p++) markParkReach(st, reach, p);
  reach.network = st.network.slice();
  reach.water = st.water.slice();
  return reach.mask;
}

/**
 * Bring the kept reach up to the network and the water as they are now. No cell further than one from the cells a
 * search marks can change its result, so a park is flagged when a cell changed inside its box or within two cells of it
 * (the services' rule for their own kept reaches, services.ts invalidateReach). The flagged parks' boxes are cleared,
 * and every park that marks a cleared cell is searched again. False: the layers are of another size (another city),
 * nothing is kept.
 */
function refreshParkReach(st: CityState, reach: ParkReach): boolean {
  const N = st.size, boxes = reach.boxes, mask = reach.mask, count = boxes.length / 4;
  const near = new Uint8Array(count);
  let changed = false, left = count;
  const flag = (i: number): void => {
    const x = i % N, z = (i - x) / N;
    changed = true;
    for (let p = 0, k = 0; p < count; p++, k += 4) {
      if (near[p] || x < boxes[k] - 2 || x > boxes[k + 2] + 2 || z < boxes[k + 1] - 2 || z > boxes[k + 3] + 2) continue;
      near[p] = 1;
      left--;
    }
  };
  for (const [layer, copy] of [[st.network, reach.network], [st.water, reach.water]]) {
    const n = layer.length;
    if (copy.length !== n) return false;
    let i = 0;
    // (four cells a step where both allow a 32-bit view; once every park is flagged there is nothing more to learn)
    if (!((layer.byteOffset | copy.byteOffset) & 3)) {
      const m = n >> 2, a = new Uint32Array(layer.buffer, layer.byteOffset, m), b = new Uint32Array(copy.buffer, copy.byteOffset, m);
      for (let k = 0; k < m && left; k++) if (a[k] !== b[k]) for (let j = k << 2; j < (k << 2) + 4; j++) if (layer[j] !== copy[j]) flag(j);
      i = m << 2;
    }
    for (; i < n && left; i++) if (layer[i] !== copy[i]) flag(i);
  }
  if (!changed) return true;
  reach.network.set(st.network);
  reach.water.set(st.water);
  if (left === count) return true;
  const was = boxes.slice();
  for (let p = 0, k = 0; p < count; p++, k += 4) {
    if (near[p]) for (let z = was[k + 1]; z <= was[k + 3]; z++) mask.fill(0, z * N + was[k], z * N + was[k + 2] + 1);
  }
  for (let p = 0, k = 0; p < count; p++, k += 4) {
    let again = near[p] === 1;
    for (let q = 0, j = 0; !again && q < count; q++, j += 4) {
      again = near[q] === 1 && was[k] <= was[j + 2] && was[j] <= was[k + 2] && was[k + 1] <= was[j + 3] && was[j + 1] <= was[k + 3];
    }
    if (again) markParkReach(st, reach, p);
  }
  return true;
}

/**
 * One walk over the buildings: the occupied homes, the noisy ones and (`onMask`) those with a cell in `mask`, by the
 * first survey's conditions with the cheap ones first (a def is looked up for occupied buildings only). `parks`
 * collects the standing Large Parks.
 */
function countHomes(st: CityState, rt: EconRuntime, mask: Uint8Array, onMask: boolean, parks: number[] | null): [homes: number, noisy: number, reached: number] {
  let homes = 0, noisy = 0, green = 0;
  for (const b of st.buildings.values()) {
    if (b.built < 1 || (b.flags & (BF.Burnt | BF.Abandoned))) continue;
    if (parks && b.def === 'park_large') parks.push(b.id, b.x, b.z, b.w, b.d);
    if (b.pop <= 0) continue;
    const dev = rt.defOf(b)?.devType;
    if (dev === undefined || dev > DevType.R3) continue;
    homes++;
    if (b.flags & BF.Noisy) noisy++;
    if (!onMask) continue;
    let reached = false;
    for (let z = b.z; z < b.z + b.d && !reached; z++) for (let x = b.x; x < b.x + b.w; x++) {
      if (mask[z * st.size + x]) { reached = true; break; }
    }
    if (reached) green++;
  }
  return [homes, noisy, green];
}

function surveyHonours(st: CityState, data: HonoursData, rt: EconRuntime, reach: ParkReach): void {
  const greenBelt = !st.unlocked.has('honour_green_belt');
  // The kept reach is brought up to this month's layers, then used during the walk. Green Belt earned (its share is no
  // longer surveyed) or layers of another size: it is let go.
  if (reach.parks.length && !(greenBelt && refreshParkReach(st, reach))) Object.assign(reach, noParkReach());
  const kept = reach.parks.length > 0, parks: number[] = [];
  const [homes, noisy, reached] = countHomes(st, rt, reach.mask, kept, greenBelt ? parks : null);
  data.homes = homes;
  data.noisyShare = homes ? noisy / homes : 1;
  if (!greenBelt) return;
  if (!parks.length) {
    // no park stands: no home in reach, nothing kept
    if (kept) Object.assign(reach, noParkReach());
    data.parkShare = 0;
    return;
  }
  const radius = getDef('park_large')!.coverage!.radius;
  let same = kept && reach.radius === radius && reach.parks.length === parks.length;
  for (let k = 0; same && k < parks.length; k++) same = reach.parks[k] === parks[k];
  // (a park came or went: all of them are searched, and the homes counted against the new reach)
  const green = same ? reached : countHomes(st, rt, searchParkReach(st, reach, parks, radius), true, null)[2];
  data.parkShare = homes ? green / homes : 0;
}

function updateHonours(st: CityState, monthly: boolean, rt: EconRuntime, reach: ParkReach): void {
  // economy is already mirrored by every host; no new worker protocol row is needed.
  const economy = st.systemData.economy as { honours?: HonoursData };
  const data = (economy.honours ??= { month: Math.ceil(st.day / DAYS_PER_MONTH), cleanAir: 0, safeCity: 0, employment: 0, books: 0,
    homes: 0, noisyShare: 1, parkShare: 0 });
  if (!monthly || data.month === st.monthIndex) {
    if (!monthly) surveyHonours(st, data, rt, reach);
    // The first partial month earns nothing; its setbacks must not poison the next full month (QA round 2, B5).
    else if (st.day % DAYS_PER_MONTH === 0) {
      data.booksInterrupted = false;
      data.cleanAirInterrupted = data.safeCityInterrupted = data.employmentInterrupted = false;
    }
    return;
  }
  const consecutive = data.month === st.monthIndex - 1;
  data.month = st.monthIndex;
  surveyHonours(st, data, rt, reach);
  const s = st.stats;
  data.cleanAir = !data.cleanAirInterrupted && s.population >= 250000 && s.avgAir <= 0.10 ? Math.min(12, (consecutive ? data.cleanAir : 0) + 1) : 0;
  data.safeCity = !data.safeCityInterrupted && s.population >= 100000 && !s.emergency.lastMonth.failed && !s.emergency.month.failed
    ? Math.min(60, (consecutive ? data.safeCity : 0) + 1) : 0;
  data.employment = !data.employmentInterrupted && s.population >= 500000 && s.unemployment <= 0.03 ? Math.min(24, (consecutive ? data.employment : 0) + 1) : 0;
  const b = st.budget;
  const borrowed = (b.lastIncome['oneoff:loan'] ?? 0) > 0 || (b.lastExpense.loan ?? 0) > 0;
  data.books = !data.booksInterrupted && !borrowed && !b.loans.length && highestTax(st) <= 9
    ? Math.min(120, (consecutive ? data.books : 0) + 1) : 0;
  data.booksInterrupted = false;
  data.cleanAirInterrupted = data.safeCityInterrupted = data.employmentInterrupted = false;
}

const STATUE_APPROVAL = 55;
const STATUE_MONTHS = 6;
const STATUE_RECOVERY = 10;

/** FH-26: independent approval and recovery holds, on every difficulty (D7). */
export interface ApprovalRewardData {
  month: number;
  months: number;
  interrupted?: boolean;
  /** Exact minimum observed from founding, including before 2,500 residents. Old saves start this record at load. */
  lowestApproval?: number;
  recoveryMonths?: number;
  recoveryInterrupted?: boolean;
}

function approvalRewardData(st: CityState): ApprovalRewardData | undefined {
  return (st.systemData.economy as { approvalReward?: ApprovalRewardData } | undefined)?.approvalReward;
}

function updateApprovalReward(st: CityState, monthly: boolean, initial = false): void {
  const economy = st.systemData.economy as { approvalReward?: ApprovalRewardData };
  const existing = economy.approvalReward;
  const data = (economy.approvalReward ??= { month: Math.ceil(st.day / DAYS_PER_MONTH), months: 0 });
  // Rounded, capped history cannot reconstruct an exact founding low. Never grant retroactive recovery credit.
  if (data.lowestApproval === undefined) {
    data.lowestApproval = st.stats.approval;
    data.recoveryMonths = 0;
    data.recoveryInterrupted = st.day % DAYS_PER_MONTH !== 0;
  }
  data.recoveryMonths ??= 0;
  if (initial && existing) return;
  data.lowestApproval = Math.min(data.lowestApproval, st.stats.approval);
  const qualifies = st.stats.population >= 2500 && st.stats.approval >= STATUE_APPROVAL;
  const recovered = st.stats.population >= 2500 && st.stats.approval >= data.lowestApproval + STATUE_RECOVERY;
  if (!qualifies) {
    data.months = 0;
    data.interrupted = true;
  }
  if (!recovered) {
    data.recoveryMonths = 0;
    data.recoveryInterrupted = true;
  }
  if (!monthly) return;
  if (data.month === st.monthIndex) {
    // The first partial month earns nothing; its setbacks must not poison the next full month.
    if (st.day % DAYS_PER_MONTH === 0) data.interrupted = data.recoveryInterrupted = false;
    return;
  }
  const consecutive = data.month === st.monthIndex - 1;
  data.months = qualifies && !data.interrupted ? Math.min(STATUE_MONTHS, (consecutive ? data.months : 0) + 1) : 0;
  data.recoveryMonths = recovered && !data.recoveryInterrupted ? Math.min(STATUE_MONTHS, (consecutive ? data.recoveryMonths : 0) + 1) : 0;
  data.month = st.monthIndex;
  data.interrupted = false;
  data.recoveryInterrupted = false;
}

const statueApprovalMonths: Cond = { label: 'Approval goal (months)', need: STATUE_MONTHS, fullState: true,
  value: (s) => {
    const data = approvalRewardData(s), low = data?.lowestApproval ?? s.stats.approval;
    const recovery = s.stats.approval >= low + STATUE_RECOVERY ? 1 : Math.max(0, s.stats.approval - low) / STATUE_RECOVERY;
    return Math.max(Math.min(data?.months ?? 0, s.stats.approval / STATUE_APPROVAL * STATUE_MONTHS),
      Math.min(data?.recoveryMonths ?? 0, recovery * STATUE_MONTHS));
  } };

function statueProgressText(st: CityState): string {
  const data = approvalRewardData(st), low = data?.lowestApproval ?? st.stats.approval;
  const gain = st.stats.approval - low;
  return `Population ${Math.floor(st.stats.population).toLocaleString('en-US')} / 2,500 · Approval ${Math.floor(st.stats.approval)} / ${STATUE_APPROVAL} · Months at approval ≥${STATUE_APPROVAL}% ${data?.months ?? 0} / ${STATUE_MONTHS}`
    + ` OR +${Math.max(0, gain).toFixed(1)} / ${STATUE_RECOVERY} points from lowest ${low.toFixed(1)}% · Recovery months ${data?.recoveryMonths ?? 0} / ${STATUE_MONTHS}`;
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
  { id: 'statue', name: 'Statue of the Mayor', kind: 'reward', defIds: ['civ_statue'], conds: [pop(2500), statueApprovalMonths],
    description: 'Keep 2,500 residents and, for six months, either approval of at least 55% or a recovery of 10 points from its lowest recorded approval.',
    progressText: statueProgressText, announce: 'Six months of popular leadership — the grateful citizens award you a Statue of the Mayor!' },
  { id: 'courthouse', name: 'Courthouse', kind: 'reward', defIds: ['civ_courthouse'], conds: [pop(8000), has('civ_police_station', 'Police station built')], description: 'Justice for all.' },
  { id: 'city_hall', name: 'City Hall', kind: 'reward', defIds: ['civ_city_hall'], conds: [pop(20000)], description: 'A seat of government worthy of the city.' },
  { id: 'country_club', name: 'Country Club', kind: 'reward', defIds: ['park_golf'], conds: [{ label: 'R$$$ residents', value: (s) => s.stats.residents[2], need: 4000 }],
    description: 'The rich want to golf.' },
  { id: 'casino', name: 'Casino Resort', kind: 'reward', defIds: ['rw_casino'], conds: [pop(15000), { label: 'Legalized Gambling', value: (s) => (s.budget.ordinances.includes('legalized_gambling') ? 1 : 0), need: 1, fmt: 'bool', fullState: true }],
    description: 'Requires the Legalized Gambling ordinance.' },
  { id: 'research_center', name: 'Advanced Research Center', kind: 'reward', defIds: ['rw_research_center'], conds: [pop(40000), eq(110)], description: 'Awarded for a highly educated city.' },
  { id: 'medical_center', name: 'Medical Research Center', kind: 'reward', defIds: ['civ_medical_center'], conds: [pop(40000), hq(100)], description: 'Awarded for a very healthy city.' },
  { id: 'stadium', name: 'Major League Stadium', kind: 'reward', defIds: ['park_stadium'], conds: [pop(50000)], description: 'The league wants a team here!' },
  { id: 'convention_center', name: 'Convention Center', kind: 'reward', defIds: ['civ_convention_center'], conds: [pop(60000), comJobs(15000)], description: 'Business visitors raise the commercial cap.' },
  { id: 'amusement_park', name: 'Amusement Park', kind: 'reward', defIds: ['park_amusement'], conds: [pop(80000)], description: 'Rides and tourists.' },
  { id: 'seaport', name: 'Container Seaport', kind: 'reward', defIds: ['tr_seaport'], conds: [indJobs(6000), { label: 'Coastline', value: (s) => (hasWater(s) ? 1 : 0), need: 1, fmt: 'bool', fullState: true }],
    description: 'Industry wants to ship by sea: massive industrial cap boost.' },
  { id: 'airport_large', name: 'International Airport', kind: 'reward', defIds: ['tr_airport_large'], conds: [pop(120000), has('tr_airport_small', 'Municipal airport built')],
    description: 'A global hub for a global city.' },
  // ---------------- business deals
  { id: 'military_base', name: 'Military Base', kind: 'deal', defIds: ['rw_military_base'], conds: [pop(15000)],
    description: 'The army pays well — but it is noisy.', announce: 'The Defense Department offers a deal: host a Military Base for §1,500/month. Find it under Rewards & Deals.' },
  { id: 'missile_range', name: 'Missile Test Range', kind: 'deal', defIds: ['rw_missile_range'], conds: [pop(35000)],
    description: 'Big income, bad neighbour.', announce: 'An aerospace contractor offers §2,500/month for a Missile Test Range. Residents will hate it.' },
  { id: 'toxic_dump', name: 'Toxic Waste Dump', kind: 'deal', defIds: ['rw_toxic_dump'], conds: [pop(60000)],
    description: 'Huge income, horrible pollution — and the whole city dislikes hosting it (approval −3, a worse clean-air image).', announce: 'A chemical conglomerate offers §4,000/month to dump toxic waste here. Are you that desperate?' },
  // ---------------- landmarks by population
  lm('lm_lighthouse', 3000), lm('lm_clock_tower', 5000), lm('lm_obelisk', 10000), lm('lm_arch', 15000), lm('lm_observatory', 25000),
  lm('lm_cathedral', 35000), lm('lm_castle', 50000), lm('lm_pyramid', 70000), lm('lm_ferris_wheel', 90000), lm('lm_opera_house', 150000),
  lm('lm_spire_tower', 250000), lm('lm_twin_spires', 500000),
  // ---------------- quality honours (LG-20; independent of the landmark ladder)
  ...HONOURS,
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

export interface MilestoneInfo {
  currentRank: CityRank;
  nextRank: CityRank | null;
  nextUnlocks: Pick<RewardInfo, 'id' | 'name' | 'kind' | 'progress'>[];
}

/** Current population rank and the three closest unlocks; ties keep REWARDS order.
 * Conditions needing budget or terrain (Casino, Seaport) are omitted from this query. */
export function listMilestones(st: MilestoneState): MilestoneInfo {
  let rank = 0;
  while (rank + 1 < CITY_RANKS.length && st.stats.population >= CITY_RANKS[rank + 1].population) rank++;

  const rewards: RewardDef[] = [];
  const scores: number[] = [];
  for (const r of REWARDS) {
    if (r.kind === 'honour') continue;
    if (st.unlocked.has(r.id)) continue;
    let progress = 1;
    for (const c of r.conds) {
      if (c.fullState) { progress = -1; break; }
      progress = Math.min(progress, Math.max(0, Math.min(1, c.value(st) / c.need)));
    }
    if (progress < 0) continue;
    let pos = 0;
    while (pos < scores.length && scores[pos] >= progress) pos++;
    if (pos >= 3) continue;
    for (let i = Math.min(scores.length, 2); i > pos; i--) {
      rewards[i] = rewards[i - 1];
      scores[i] = scores[i - 1];
    }
    rewards[pos] = r;
    scores[pos] = progress;
  }
  return {
    currentRank: CITY_RANKS[rank], nextRank: CITY_RANKS[rank + 1] ?? null,
    nextUnlocks: rewards.map((r, i) => ({ id: r.id, name: r.name, kind: r.kind, progress: scores[i] })),
  };
}

function fmt(c: Cond, v: number): string {
  if (c.fmt === 'bool') return `${c.label}: ${v >= c.need ? 'yes' : 'no'}`;
  if (c.fmt === 'decimal' || c.fmt === 'percent' || c.atMost) {
    const show = (n: number) => c.fmt === 'percent' ? `${(n * 100).toFixed(1)}%` : c.fmt === 'decimal' ? n.toFixed(2) : String(n);
    return `${c.label} ${show(v)}; needs ${c.below ? '< ' : c.atMost ? '≤ ' : ''}${show(c.need)}`;
  }
  return `${c.label} ${Math.floor(v).toLocaleString('en-US')} / ${c.need.toLocaleString('en-US')}`;
}

function conditionProgress(c: Cond, v: number): number {
  if (c.below && v >= c.need) return Math.min(0.99, c.need / v);
  return Math.max(0, Math.min(1, c.atMost ? (v <= c.need ? 1 : c.need / v) : v / c.need));
}

/** Reward list for the UI (all rewards, with progress). */
export function listRewards(state: CityState): RewardInfo[] {
  return REWARDS.map((r) => {
    let progress = 1;
    const parts: string[] = [];
    for (const c of r.conds) {
      const v = c.value(state);
      progress = Math.min(progress, conditionProgress(c, v));
      if (c !== inhabited || v < c.need) parts.push(fmt(c, v));
    }
    const unlocked = state.unlocked.has(r.id) || (r.kind !== 'honour' && !!state.config.sandbox);
    return {
      id: r.id, name: r.name, description: r.description, kind: r.kind, defIds: r.defIds, unlocked,
      built: r.defIds.some((d) => (state.milestones[d] ?? 0) > 0),
      progress: unlocked ? 1 : progress,
      progressText: unlocked ? (r.kind === 'honour' ? 'Earned · Commemorative plaque awarded' : 'Unlocked') : r.progressText?.(state) ?? parts.join(' · '),
    };
  });
}

export function rewardConditionsMet(state: CityState, r: RewardDef): boolean {
  for (const c of r.conds) {
    const v = c.value(state);
    if (c.below ? v >= c.need : c.atMost ? v > c.need : v < c.need) return false;
  }
  return true;
}

export function rewardsSystem(rt: EconRuntime): SimSystem {
  const parkReach = noParkReach();
  const check = (sim: Simulation, silent: boolean) => {
    const st = sim.state;
    // Reached ranks survive population drops; init fills this optional key silently for old saves.
    const ranks = (st.systemData.cityRanks ??= {}) as Record<string, boolean>;
    for (const r of CITY_RANKS) {
      if (st.stats.population < r.population) break;
      if (!ranks[r.id]) ranks[r.id] = true;
    }
    for (const r of REWARDS) {
      if (st.unlocked.has(r.id)) continue;
      if ((r.kind === 'honour' || !st.config.sandbox) && !rewardConditionsMet(st, r)) continue;
      st.unlocked.add(r.id);
      if (!st.announced.has(r.id)) {
        st.announced.add(r.id);
        if (!silent) {
          const text = r.announce ?? (r.kind === 'landmark' ? `New landmark available: ${r.name}!`
            : r.kind === 'unlock' ? `${r.name} is now available.`
              : `Reward unlocked: ${r.name}! ${r.description}`);
          sim.notify(text, 'reward', undefined, undefined, r.kind === 'deal' ? 'finance' : 'planning', { reward: r.id });
        }
      }
      sim.events.emit('unlocked', r.id);
    }
  };
  return {
    name: 'economy.rewards',
    init(sim) {
      rt.attach(sim);
      // a loaded city keeps its honours record as saved (T057 continuity): only a city without one is surveyed here
      if (!honoursData(sim.state)) updateHonours(sim.state, false, rt, parkReach);
      updateApprovalReward(sim.state, false, true);
      check(sim, true);
    },
    daily(sim) {
      const st = sim.state, data = honoursData(st);
      updateApprovalReward(st, false);
      if (data && (st.stats.population < 250000 || st.stats.avgAir > 0.10)) {
        data.cleanAir = 0;
        data.cleanAirInterrupted = true;
      }
      if (data && (st.stats.population < 100000 || st.stats.emergency.month.failed)) {
        data.safeCity = 0;
        data.safeCityInterrupted = true;
      }
      if (data && (st.stats.population < 500000 || st.stats.unemployment > 0.03)) {
        data.employment = 0;
        data.employmentInterrupted = true;
      }
      if (data && (st.budget.loans.length || highestTax(st) > 9 || (st.budget.curIncome['oneoff:loan'] ?? 0) > 0)) {
        data.books = 0;
        data.booksInterrupted = true;
      }
    },
    monthly(sim) {
      updateHonours(sim.state, true, rt, parkReach);
      updateApprovalReward(sim.state, true);
      check(sim, false);
    },
  };
}
