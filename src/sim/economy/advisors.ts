/**
 * Advisors & news: contextual advice with per-message cooldowns (no spam: at most ADVICE_PER_MONTH per month,
 * highest priority first, ≥ MIN_COOLDOWN days per message key, doubling while the condition persists), population
 * milestones, and flavor headlines.
 * Advisors: 'finance' | 'utilities' | 'transport' | 'safety' | 'health' | 'environment' | 'planning' (+ 'news').
 * Messages go through sim.notify(text, kind, x, z, advisor).
 *
 * "Why doesn't it grow?" (with the sim-infra utilities layer): a monthly scan of the zoned tiles buildings can use
 * (growable lots + empty tiles facing a road) and of the plopped utilities explains power plants that are not wired to
 * the zones ('gridGap'), isolated plants, burnt plants ('plantBurnt'), thermal plants without cooling water when the
 * capacity gets tight ('plantDry'), water facilities without a road / power
 * ('waterNoRoad' / 'waterNoPower'), dense zones off the pipe network ('waterGap'), zones without road access
 * ('noRoadAccess') and a city where nothing grows although zones are ready ('noDemand' / 'growthStalled').
 * Rules marked `confirm` read utilities results (which lag an edit by a few days) and only speak when the condition
 * already held at the previous monthly check.
 *
 * Flavour headlines: a shuffle bag over HEADLINES (each line once per cycle; lines that don't fit the city's size,
 * season, climate or buildings wait in the bag), and no line again within HEADLINE_REPEAT_DAYS (2 in-game years).
 * Bag / schedule persist in state.systemData.advisors; they use one sim.rng draw per headline like the former pick.
 */
import type { SimSystem, Simulation } from '../Simulation';
import { BF, type Building, type CityState } from '../CityState';
import { DEV_TYPE_LABELS, DevType, Network, Zone, zoneDensity } from '../../core/types';
import { type EconRuntime, econData, infraFlags } from './runtime';
import { capHints } from './demand';
import { residentCoverage } from './approval';
import { maxLoanAmount, loanRate } from './loans';
import { RNG, hash2 } from '../../core/rng';
import { ZONE_DEVTYPES, getDef } from '../catalog';
import { formatMoney } from './format';

const ADVICE_PER_MONTH = 2;
/** no advice repeats sooner than this (days) */
const MIN_COOLDOWN = 60;
const money = (v: number) => formatMoney(v);
const int = (v: number) => Math.round(v).toLocaleString('en-US');

interface Advice {
  id: string;
  /** days before the same id can repeat */
  cooldown: number;
  priority: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'warning';
  advisor: string;
  x?: number;
  z?: number;
  /** only speak when the condition already held at the previous monthly check (utilities results lag edits) */
  confirm?: boolean;
}

const POP_MILESTONES = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 750000, 1000000];

/** a `confirm` rule speaks once its condition has held this many days (i.e. at the second monthly check in a row) */
const CONFIRM_DAYS = 25;
/** grid / pipe gaps smaller than this (tiles) are not worth a message */
const GAP_MIN_TILES = 6;
/** zoned tiles without any road access before 'noRoadAccess' speaks */
const NO_ACCESS_MIN_TILES = 8;
/** a flavour headline never repeats within this many days (2 in-game years) */
export const HEADLINE_REPEAT_DAYS = 720;

// ------------------------------------------------------------------------------------------------ persistent state
/** advisor state in state.systemData.advisors (plain data, saved with the city) */
export interface AdvisorData {
  v: 1;
  /** absolute day of the next flavour headline */
  nextHeadline: number;
  /** headline shuffle bag (HEADLINES ids, drawn from the end) */
  bag: string[];
  /** headline id -> absolute day it was last shown */
  shown: Record<string, number>;
  /** confirm-rule id -> first day of the current uninterrupted sighting */
  seen: Record<string, number>;
}

export function advisorData(st: CityState): AdvisorData {
  let a = st.systemData.advisors as AdvisorData | undefined;
  if (!a || a.v !== 1) {
    // new city: first headline around day 45 (as before); an older save gets a calm first month
    a = { v: 1, nextHeadline: st.day < 45 ? 45 : st.day + 30, bag: [], shown: {}, seen: {} };
    st.systemData.advisors = a;
  }
  a.bag ??= [];
  a.shown ??= {};
  a.seen ??= {};
  return a;
}

// ------------------------------------------------------------------------------------------------ city scans
const isRoadN = (v: number) => v >= Network.Street && v <= Network.Highway;
const R_ZONES = (1 << Zone.ResLow) | (1 << Zone.ResMed) | (1 << Zone.ResHigh);
const C_ZONES = (1 << Zone.ComLow) | (1 << Zone.ComMed) | (1 << Zone.ComHigh);
const I_ZONES = (1 << Zone.IndAg) | (1 << Zone.IndMed) | (1 << Zone.IndHigh);

/** zoned tiles a building can use (growable lots + empty zoned tiles facing a road) and their utilities */
interface ZoneScan {
  /** zoned R/C/I tiles */
  zoned: number;
  /** usable tiles: growable lots + empty zoned tiles 4-adjacent to a road */
  front: number;
  /** usable tiles without power (utilities layer only), first one (cell index, -1 = none) */
  unpowered: number;
  unpoweredAt: number;
  /** usable medium / high density tiles (they need piped water), and those without water */
  needWater: number;
  unwatered: number;
  unwateredAt: number;
  /** usable tiles with everything a building needs (power, water where required), bitmask of their zones, first one */
  ready: number;
  readyZones: number;
  readyAt: number;
  /** zoned tiles in zone blocks without a single road-facing tile, first one */
  noAccess: number;
  noAccessAt: number;
}

/** one pass over the zoned tiles (4-connected blocks flood-filled for road access) */
function scanZones(st: CityState, util: boolean, visited: Uint8Array, stack: Int32Array): ZoneScan {
  const N = st.size, C = st.cells;
  const zone = st.zone, net = st.network, bld = st.building, powered = st.powered, watered = st.watered;
  const r: ZoneScan = {
    zoned: 0, front: 0, unpowered: 0, unpoweredAt: -1, needWater: 0, unwatered: 0, unwateredAt: -1, ready: 0, readyZones: 0, readyAt: -1, noAccess: 0, noAccessAt: -1,
  };
  const isZ = (i: number) => zone[i] >= Zone.ResLow && zone[i] <= Zone.IndHigh;
  visited.fill(0);
  for (let s = 0; s < C; s++) {
    if (visited[s] || !isZ(s)) continue;
    let sp = 0, cells = 0, access = false;
    stack[sp++] = s;
    visited[s] = 1;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % N;
      cells++;
      const zn = zone[i];
      const road = (x > 0 && isRoadN(net[i - 1])) || (x < N - 1 && isRoadN(net[i + 1])) || (i >= N && isRoadN(net[i - N])) || (i + N < C && isRoadN(net[i + N]));
      if (road) access = true;
      if (road || bld[i] >= 0) {
        r.front++;
        const p = !util || powered[i] === 1;
        if (!p) { r.unpowered++; if (r.unpoweredAt < 0) r.unpoweredAt = i; }
        let w = true;
        if (zoneDensity(zn) >= 2) {
          r.needWater++;
          w = !util || watered[i] === 1;
          if (!w) { r.unwatered++; if (r.unwateredAt < 0) r.unwateredAt = i; }
        }
        if (p && w) { r.ready++; r.readyZones |= 1 << zn; if (r.readyAt < 0) r.readyAt = i; }
      }
      if (x > 0 && !visited[i - 1] && isZ(i - 1)) { visited[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < N - 1 && !visited[i + 1] && isZ(i + 1)) { visited[i + 1] = 1; stack[sp++] = i + 1; }
      if (i >= N && !visited[i - N] && isZ(i - N)) { visited[i - N] = 1; stack[sp++] = i - N; }
      if (i + N < C && !visited[i + N] && isZ(i + N)) { visited[i + N] = 1; stack[sp++] = i + N; }
    }
    r.zoned += cells;
    if (!access) { r.noAccess += cells; if (r.noAccessAt < 0) r.noAccessAt = s; }
  }
  return r;
}

/** any 4-neighbour tile around the footprint (no corners) passes `test` */
function perimeterAny(st: CityState, b: Building, test: (i: number) => boolean): boolean {
  const N = st.size;
  for (let x = b.x; x < b.x + b.w; x++) {
    if (b.z > 0 && test((b.z - 1) * N + x)) return true;
    if (b.z + b.d < N && test((b.z + b.d) * N + x)) return true;
  }
  for (let z = b.z; z < b.z + b.d; z++) {
    if (b.x > 0 && test(z * N + b.x - 1)) return true;
    if (b.x + b.w < N && test(z * N + b.x + b.w)) return true;
  }
  return false;
}

/** plopped utilities by state */
interface FacilityScan {
  /** power plants (def.powerOut > 0) standing / burnt; standing plants touching no conductor at all */
  plants: Building[];
  plantsBurnt: Building[];
  plantsIsolated: Building[];
  /** nominal MW of the burnt plants */
  burntMW: number;
  /** standing thermal plants (coal / oil / gas / nuclear need cooling water) without water: they run at reduced output */
  plantsDry: Building[];
  /** water producers: working / burnt / not next to a road (no pipes) / next to a road but unpowered */
  waterOk: Building[];
  waterBurnt: Building[];
  waterNoRoad: Building[];
  waterNoPower: Building[];
  /** other plopped buildings that use power but have none (and the first of them) */
  civicUnpowered: number;
  civicFirst: Building | null;
}

function scanFacilities(st: CityState, rt: EconRuntime): FacilityScan {
  const f: FacilityScan = {
    plants: [], plantsBurnt: [], plantsIsolated: [], burntMW: 0, plantsDry: [], waterOk: [], waterBurnt: [], waterNoRoad: [], waterNoPower: [],
    civicUnpowered: 0, civicFirst: null,
  };
  rt.ensureLists();
  for (const b of rt.plopped) {
    const def = rt.defOf(b);
    if (!def) continue;
    const burnt = (b.flags & BF.Burnt) !== 0;
    if ((def.powerOut ?? 0) > 0) {
      if (burnt) { f.plantsBurnt.push(b); f.burntMW += def.powerOut!; continue; }
      f.plants.push(b);
      const conducts = (i: number) => st.network[i] !== Network.None || st.powerLines[i] !== 0 || (st.building[i] >= 0 && st.building[i] !== b.id);
      if (!perimeterAny(st, b, conducts)) f.plantsIsolated.push(b);
      if (def.category === 'power' && (def.waterUse ?? 0) > 0 && !(b.flags & BF.Watered)) f.plantsDry.push(b);
    } else if ((def.waterOut ?? 0) > 0) {
      if (burnt) f.waterBurnt.push(b);
      else if (!perimeterAny(st, b, (i) => isRoadN(st.network[i]))) f.waterNoRoad.push(b);
      else if ((def.powerUse ?? 0) > 0 && !(b.flags & BF.Powered)) f.waterNoPower.push(b);
      else f.waterOk.push(b);
    } else if (!burnt && (def.powerUse ?? 0) > 0 && !(b.flags & BF.Powered)) {
      f.civicUnpowered++;
      f.civicFirst ??= b;
    }
  }
  return f;
}

const nameOf = (b: Building) => getDef(b.def)?.name ?? 'building';
/** "1 zoned tile" / "12 zoned tiles" */
const count = (n: number, word: string) => `${Math.round(n).toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

// ------------------------------------------------------------------------------------------------ flavour headlines
interface HeadlineCtx {
  st: CityState;
  pop: number;
  /** 0 = January */
  month: number;
  /** any of these plopped defs stands in the city */
  has: (...defIds: string[]) => boolean;
  /** parks (plopped, category park) */
  parks: number;
  /** open water on the map (lazy) */
  water: () => boolean;
  /** growables per DevType */
  dev: readonly number[];
  /** a fire / any disaster made the news within the last 90 days */
  recentFire: boolean;
  recentDisaster: boolean;
}
interface Headline {
  id: string;
  /** placeholders {city} {mayor} {year} {pop} */
  text: string;
  /** population band [min, max) (every headline also needs more than 300 residents) */
  min?: number;
  max?: number;
  when?: (c: HeadlineCtx) => boolean;
}
const WINTER = (c: HeadlineCtx) => c.month === 11 || c.month <= 1;
const SPRING = (c: HeadlineCtx) => c.month >= 2 && c.month <= 4;
const SUMMER = (c: HeadlineCtx) => c.month >= 5 && c.month <= 7;
const AUTUMN = (c: HeadlineCtx) => c.month >= 8 && c.month <= 10;
const SNOWY = (c: HeadlineCtx) => WINTER(c) && (c.st.config.climate === 'temperate' || c.st.config.climate === 'alpine');
const FIRE_STATION = ['civ_fire_station', 'civ_fire_hq'];

const HEADLINES: readonly Headline[] = [
  // ---- any size
  { id: 'croissant', text: '{city} bakery wins regional croissant championship.' },
  { id: 'tie', text: 'Residents of {city} vote the mayor\'s tie "most daring" of {year}.' },
  { id: 'firecat', text: 'Stray cat elected honorary deputy of the {city} fire brigade.', when: (c) => c.has(...FIRE_STATION) },
  { id: 'market', text: 'Farmers\' market in {city} breaks attendance record.', when: (c) => !WINTER(c) },
  { id: 'houseplants', text: 'Study: {city} residents own more houseplants than anyone in the region.' },
  { id: 'jogging', text: 'Mayor {mayor} spotted jogging at dawn — citizens impressed.' },
  { id: 'gerald', text: 'Pothole named "Gerald" becomes local celebrity before repairs.' },
  { id: 'meteors', text: '{city} sky hosts a spectacular meteor shower tonight.', when: (c) => (c.month === 7 || c.month === 11) && !c.recentDisaster },
  { id: 'umbrella', text: 'Local inventor unveils a self-folding umbrella.' },
  { id: 'townsign', text: 'Historic society restores {city}\'s first town sign.', min: 2000 },
  { id: 'pumpkin', text: 'Community garden produces record-breaking pumpkin.', when: AUTUMN },
  { id: 'robotics', text: 'Local high school robotics team heads to nationals.', when: (c) => c.has('civ_high_school') },
  { id: 'crossword', text: 'Retired teacher, 94, completes her 1,000th crossword in the {city} Gazette.' },
  { id: 'chess', text: 'Chess club champion beats Mayor {mayor} in 14 moves; rematch scheduled.' },
  { id: 'triplets', text: 'Proud parents in {city} welcome triplets; the neighbours organise a nappy drive.' },
  // ---- small town
  { id: 'everyone', text: 'All {pop} residents of {city} invited to the town picnic — potato salad supply "under review".', max: 5000, when: (c) => !WINTER(c) },
  { id: 'bakesale', text: 'Bake sale at {city} town hall raises enough for a brand-new park bench.', max: 20000 },
  { id: 'doorbell', text: 'Local dog learns to ring doorbells, now "visits" every house on the block.', max: 30000 },
  { id: 'tortoise', text: 'Missing tortoise found three streets away after a two-week "adventure".', max: 40000 },
  { id: 'gnomes', text: 'Neighbourhood watch cracks the case of the missing garden gnomes.', max: 50000 },
  { id: 'garageband', text: 'Garage band from {city} plays its first sold-out show (capacity: 40).', max: 60000 },
  // ---- farms, water, seasons, climate
  { id: 'scarecrow', text: 'Scarecrow contest turns the fields around {city} into an open-air gallery.', when: (c) => AUTUMN(c) && c.dev[DevType.IA] > 0 },
  { id: 'goat', text: 'Goat escapes a farm near {city} and briefly directs traffic on Main Street.', when: (c) => c.dev[DevType.IA] > 0 },
  { id: 'duckrace', text: 'Annual rubber duck race ends in a 12-way photo finish.', when: (c) => !WINTER(c) && c.water() },
  { id: 'snowball', text: 'First snowfall of the season turns {city} into a snowball battlefield.', when: SNOWY },
  { id: 'snowday', text: 'Snow day! Schools close and every sledding hill in {city} is at capacity.', when: (c) => SNOWY(c) && c.has('civ_elementary_school', 'civ_high_school') },
  { id: 'carols', text: 'Local choir sets a regional record for the longest carol sing-along.', when: (c) => c.month === 11 },
  { id: 'icecream', text: 'Heatwave: {city} ice cream parlours report record sales.', when: (c) => SUMMER(c) && c.st.config.climate !== 'alpine' },
  { id: 'kites', text: 'Kite festival fills the spring sky above {city}.', when: SPRING },
  { id: 'showers', text: 'April showers: the {city} umbrella shop reports its best month ever.', when: (c) => c.month === 3 && c.st.config.climate !== 'desert' },
  { id: 'litter', text: 'Spring-cleaning volunteers collect two tons of litter from {city} parks.', when: (c) => SPRING(c) && c.parks > 0 },
  { id: 'lizard', text: 'Local lizard wins "most photographed resident" for the third year running.', when: (c) => c.st.config.climate === 'desert' },
  { id: 'coconut', text: 'Coconut falls, narrowly misses the mayor. Coconut unharmed.', when: (c) => c.st.config.climate === 'tropical' },
  { id: 'mtgoat', text: 'Mountain goat seen strolling through downtown {city}; declines to comment.', when: (c) => c.st.config.climate === 'alpine' },
  { id: 'cone', text: 'Traffic cone mysteriously appears on top of the {city} water tower.', when: (c) => c.has('util_water_tower') },
  // ---- growing city
  { id: 'pigeons', text: 'Pigeons stage sit-in on the tallest rooftop in {city}.', min: 3000 },
  { id: 'jazz', text: 'Jazz festival draws thousands to downtown {city}.', min: 5000 },
  { id: 'foodtrucks', text: 'New food truck park in {city} serves 14 kinds of tacos.', min: 5000 },
  { id: 'nightmarket', text: 'Night market opens in {city}; the dumplings sell out in 40 minutes.', min: 8000, when: (c) => !WINTER(c) },
  { id: 'economists', text: 'Economists call {city} "a city on the move".', min: 10000 },
  { id: 'playlist', text: 'Commuters vote the {city} rush-hour radio playlist "surprisingly good".', min: 10000 },
  { id: 'honey', text: 'Rooftop beehives on {city} offices produce 800 jars of "downtown honey".', min: 15000, when: (c) => c.dev[DevType.CO2] + c.dev[DevType.CO3] > 0 },
  { id: 'marathon', text: '{city} marathon: 3,000 runners, one of them dressed as a giant banana.', min: 20000, when: (c) => !WINTER(c) },
  { id: 'parkingapp', text: 'Local startup launches an app that finds free parking. Parking spots unimpressed.', min: 20000 },
  { id: 'squirrels', text: 'Squirrels of {city} declared "the best-fed in the region".', when: (c) => c.parks >= 8 },
  // ---- landmarks & facilities
  { id: 'giraffe', text: '{city} Zoo welcomes a baby giraffe; the naming contest gets 40,000 entries.', when: (c) => c.has('park_zoo') },
  { id: 'thewave', text: 'Stadium crowd in {city} keeps "the wave" going for 11 minutes straight.', when: (c) => c.has('park_stadium') },
  { id: 'trainspotters', text: 'Trainspotters gather to cheer the first freight train of the season through {city}.', when: (c) => c.has('tr_freight_station', 'tr_train_station') },
  { id: 'rubberchicken', text: 'Airport lost-and-found reunites a traveller with her lucky rubber chicken.', when: (c) => c.has('tr_airport_small', 'tr_airport_large') },
  { id: 'catapult', text: 'College students in {city} build a working catapult for physics week.', when: (c) => c.has('civ_college') },
  { id: 'holeinone', text: 'Golfers at the {city} club celebrate the first hole-in-one of the year.', when: (c) => c.has('park_golf') && !WINTER(c) },
  { id: 'ferry', text: '{city} ferry captain marks 10,000 crossings with a long toot of the horn.', when: (c) => c.has('tr_ferry_terminal') },
  { id: 'lighthouse', text: 'Lighthouse open day draws a queue all the way around the harbour.', when: (c) => c.has('lm_lighthouse') },
  { id: 'coaster', text: 'Amusement park unveils a new roller coaster, "only slightly terrifying".', when: (c) => c.has('park_amusement') },
  { id: 'dinohat', text: 'Museum night in {city}: the dinosaur skeleton gets a festive hat.', when: (c) => c.has('civ_museum') },
  { id: 'saturn', text: 'Observatory open night: {city} residents spot the rings of Saturn.', when: (c) => c.has('lm_observatory') },
  { id: 'amnesty', text: 'Library amnesty week: a book comes back 38 years late — "it was very good".', when: (c) => c.has('civ_library') },
  { id: 'busker', text: 'Subway busker plays the same song for 12 hours; {city} commuters now know every word.', when: (c) => c.has('tr_subway_station') },
  // ---- big city
  { id: 'pizza', text: '{city} crowned "Best Pizza Slice" in a hotly disputed regional poll.', min: 50000 },
  { id: 'picnic', text: '{city} office workers set a record for the longest lunch-break picnic.', min: 80000, when: (c) => !WINTER(c) },
  { id: 'skyline', text: 'Skyline photo of {city} goes viral: "Is that a painting?"', min: 100000 },
  { id: 'wifi', text: 'Tech conference in {city} ends early after someone forgets the Wi-Fi password.', min: 120000 },
  { id: 'fashion', text: 'Fashion week in {city}: this season\'s must-have accessory is a reusable coffee cup.', min: 150000 },
  { id: 'magnets', text: 'The {city} tourist office runs out of souvenir fridge magnets.', when: (c) => c.st.stats.tourists > 500 },
  // ---- events & mood
  { id: 'cookies', text: 'Grateful residents bury the {city} fire brigade in home-made cookies.', when: (c) => c.recentFire && c.has(...FIRE_STATION) },
  { id: 'greatcity', text: 'Survey: {city} residents rate their city "pretty great, actually".', when: (c) => c.st.stats.approval >= 72 },
  { id: 'committee', text: 'Residents of {city} form a committee to complain about committees.', when: (c) => c.st.stats.approval < 40 },
  { id: 'scarf', text: 'Commuter knits an entire scarf during one {city} traffic jam.', when: (c) => c.st.stats.avgCommute > 35 },
  { id: 'airjars', text: 'Local artist sells jars of "authentic {city} air". Critics call it breathtaking.', when: (c) => econData(c.st).resPollution > 0.3 },
  { id: 'babyboom', text: 'Maternity ward reports a baby boom as {city} keeps growing.', min: 2000, when: (c) => c.has('civ_clinic', 'civ_hospital', 'civ_medical_center') },
];
const HEADLINE_BY_ID = new Map(HEADLINES.map((h) => [h.id, h]));
/** number of flavour headlines (tests / docs) */
export const HEADLINE_COUNT = HEADLINES.length;

/**
 * Next flavour headline: shuffle bag over every line (each once per cycle); lines that don't fit the city right now stay
 * in the bag for later, and no line comes back within HEADLINE_REPEAT_DAYS. null = nothing fits (skip this one).
 */
function drawHeadline(a: AdvisorData, c: HeadlineCtx, day: number, seed: number): Headline | null {
  const fits = (h: Headline) => {
    const t = a.shown[h.id];
    return (t === undefined || day - t >= HEADLINE_REPEAT_DAYS) && c.pop >= (h.min ?? 0) && c.pop < (h.max ?? Infinity) && (!h.when || h.when(c));
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let k = a.bag.length - 1; k >= 0; k--) {
      const h = HEADLINE_BY_ID.get(a.bag[k]);
      if (!h) { a.bag.splice(k, 1); continue; } // line removed since the save
      if (!fits(h)) continue;
      a.bag.splice(k, 1);
      a.shown[h.id] = day;
      return h;
    }
    if (pass > 0) break;
    // cycle done (for what fits now): refill with every line not in the bag, freshly shuffled, drawn after the
    // leftovers (seasonal / size-gated lines keep their place and come up as soon as they fit)
    const inBag = new Set(a.bag);
    const refill = HEADLINES.filter((h) => !inBag.has(h.id)).map((h) => h.id);
    new RNG(seed).shuffle(refill);
    a.bag = refill.concat(a.bag);
  }
  return null;
}

export function advisorsSystem(rt: EconRuntime): SimSystem {
  /** flood-fill scratch for the monthly zone scan (re-sized with the map) */
  let scratch = { visited: new Uint8Array(0), stack: new Int32Array(0) };

  const headlineCtx = (st: CityState): HeadlineCtx => {
    rt.ensureLists();
    let parks = 0;
    for (const b of rt.plopped) if (!(b.flags & BF.Burnt) && rt.defOf(b)?.category === 'park') parks++;
    let water: boolean | undefined;
    const recent = (re: RegExp | null) => st.news.some((n) => n.kind === 'disaster' && st.day - n.day <= 90 && (!re || re.test(n.text)));
    return {
      st, pop: st.stats.population, month: st.month,
      has: (...ids) => ids.some((id) => (st.milestones[id] ?? 0) > 0),
      parks,
      water: () => (water ??= st.water.includes(1)),
      dev: rt.totals.countByDev,
      recentFire: recent(/fire/i),
      recentDisaster: recent(null),
    };
  };
  const fillHeadline = (text: string, st: CityState) => text.replaceAll('{city}', st.config.name).replaceAll('{mayor}', st.config.mayor)
    .replaceAll('{year}', String(st.year)).replaceAll('{pop}', int(st.stats.population));

  const gather = (st: CityState): Advice[] => {
    const out: Advice[] = [];
    const s = st.stats;
    const d = econData(st);
    const inf = infraFlags(st);
    const pop = s.population;
    const inc = st.budget.lastIncome, exp = st.budget.lastExpense;
    let income = 0, expense = 0;
    for (const k in inc) if (!k.startsWith('oneoff:')) income += inc[k];
    for (const k in exp) if (!k.startsWith('oneoff:')) expense += exp[k];
    const net = income - expense;
    // ---------------- finance
    if (net < 0 && st.funds >= 0 && st.funds < -net * 8 && pop > 0) {
      out.push({ id: 'deficit', cooldown: 90, priority: 8, kind: 'warning', advisor: 'finance',
        text: `We ran a deficit of ${money(-net)} last month and only have ${money(st.funds)} left. Trim services or raise taxes a little.` });
    }
    if (st.funds >= 0 && st.funds < 5000 && pop > 200) {
      const max = maxLoanAmount(st);
      if (max > 0) out.push({ id: 'lowFunds', cooldown: 150, priority: 6, kind: 'warning', advisor: 'finance',
        text: `Funds are low (${money(st.funds)}). The bank would lend up to ${money(max)} at ${(loanRate(st) * 100).toFixed(1)}%.` });
    }
    if (net > 0 && income > 0 && net > income * 0.3 && st.funds > 150000 && pop > 5000) {
      out.push({ id: 'surplus', cooldown: 360, priority: 1, kind: 'good', advisor: 'finance',
        text: `A healthy surplus of ${money(net)}/month! Lower taxes to boost growth, or invest in services and parks.` });
    }
    const rTax = (st.budget.taxRates[0] + st.budget.taxRates[1] + st.budget.taxRates[2]) / 3;
    if (rTax >= 12 && pop > 1000) {
      out.push({ id: 'taxHigh', cooldown: 180, priority: 5, kind: 'warning', advisor: 'finance',
        text: `Residential taxes average ${rTax.toFixed(1)}% — people are leaving for cheaper cities.` });
    }
    // ---------------- utilities
    let zoned = 0;
    for (let z = Zone.ResLow; z <= Zone.IndHigh; z++) zoned += rt.emptyZoned[z];
    const N = st.size;
    const util = inf.utilities;
    if (scratch.visited.length !== st.cells) scratch = { visited: new Uint8Array(st.cells), stack: new Int32Array(st.cells) };
    const scan = scanZones(st, util, scratch.visited, scratch.stack);
    const fac = scanFacilities(st, rt);
    const at = (b: Building) => ({ x: b.x + (b.w >> 1), z: b.z + (b.d >> 1) });
    const cellAt = (i: number): { x?: number; z?: number } => (i >= 0 ? { x: i % N, z: (i / N) | 0 } : {});
    const burntWhat = (list: Building[], many: string) => (list.length > 1 ? `${list.length} ${many}` : `The ${nameOf(list[0])}`);
    const needPower = zoned > 30 || rt.totals.growables > 0;
    if (s.powerSupply <= 0 && fac.plantsBurnt.length && (needPower || s.powerDemand > 0)) {
      out.push({ id: 'plantBurnt', cooldown: 60, priority: 10, kind: 'bad', advisor: 'utilities', ...at(fac.plantsBurnt[0]),
        text: `${burntWhat(fac.plantsBurnt, 'power plants')} burned down — the city has no power! Bulldoze the rubble and build a new power plant.` });
    } else if (s.powerSupply <= 0 && needPower) {
      if (util && fac.plants.length) {
        // plants stand but deliver nothing (ordinance shutdown, idle incinerator, …)
        out.push({ id: 'noPower', cooldown: 45, priority: 10, kind: 'bad', advisor: 'utilities', confirm: true, ...at(fac.plants[0]),
          text: `Nothing will grow without power! Your ${nameOf(fac.plants[0])} isn't producing any — click it to see why.` });
      } else {
        out.push({ id: 'noPower', cooldown: 45, priority: 10, kind: 'bad', advisor: 'utilities',
          text: 'Nothing will grow without power! Build a power plant and run power lines to your zones.' });
      }
    } else if (!inf.utilities && s.powerDemand > s.powerSupply * 0.99 && s.powerDemand > 0) {
      out.push({ id: 'powerShortage', cooldown: 60, priority: 9, kind: 'bad', advisor: 'utilities',
        text: `Brownouts! Demand of ${s.powerDemand.toFixed(0)} MW exceeds our ${s.powerSupply.toFixed(0)} MW supply. Build a power plant.` });
    } else if (s.powerDemand > s.powerSupply * 0.85 && s.powerSupply > 0) {
      out.push({ id: 'powerTight', cooldown: 180, priority: 4, kind: 'warning', advisor: 'utilities',
        text: `The power grid is at ${Math.round((100 * s.powerDemand) / s.powerSupply)}% capacity. Plan a new plant soon.` });
    }
    // a plant burned down while others still run (worth a word when it was ≥ 10 % of the capacity)
    if (s.powerSupply > 0 && fac.burntMW > 0 && fac.burntMW >= 0.1 * (s.powerSupply + fac.burntMW)) {
      out.push({ id: 'plantBurnt', cooldown: 90, priority: 7, kind: 'warning', advisor: 'utilities', ...at(fac.plantsBurnt[0]),
        text: `${burntWhat(fac.plantsBurnt, 'power plants')} burned down (−${int(fac.burntMW)} MW). Bulldoze the rubble and replace it before the grid runs short.` });
    }
    // thermal plants without cooling water run at reduced output — only worth a word once the capacity gets tight
    if (util && fac.plantsDry.length && s.powerSupply > 0 && s.powerDemand > s.powerSupply * 0.7) {
      const b = fac.plantsDry[0], n = fac.plantsDry.length;
      out.push({ id: 'plantDry', cooldown: 120, priority: 5, kind: 'warning', advisor: 'utilities', confirm: true, ...at(b),
        text: `${n > 1 ? `${n} power plants have` : `Your ${nameOf(b)} has`} no cooling water, so ${n > 1 ? 'they run' : 'it runs'} at reduced output. Connect ${n > 1 ? 'them' : 'it'} to your water network (pipes run under roads).` });
    }
    // power exists but does not reach the zones (skipped in a brownout: then the farthest consumers are cut on purpose)
    const powerShort = s.powerDemand > s.powerSupply * 1.0001;
    if (util && s.powerSupply > 0 && !powerShort && (scan.unpowered >= GAP_MIN_TILES || fac.civicUnpowered > 0)) {
      const parts: string[] = [];
      if (scan.unpowered) parts.push(count(scan.unpowered, 'zoned tile'));
      if (fac.civicUnpowered) parts.push(count(fac.civicUnpowered, 'city building'));
      const many = parts.length > 1 || (scan.unpowered || fac.civicUnpowered) > 1;
      const none = scan.front > 0 && scan.unpowered >= scan.front; // not one usable zoned tile has power
      const lone = fac.plants.length > 0 && fac.plantsIsolated.length === fac.plants.length;
      const base = { id: 'gridGap', cooldown: 60, priority: none ? 9 : 6, kind: none ? 'bad' as const : 'warning' as const, advisor: 'utilities', confirm: true };
      if (lone) {
        const who = fac.plants.length > 1 ? 'Your power plants are' : `Your ${nameOf(fac.plants[0])} is`;
        out.push({ ...base, ...at(fac.plantsIsolated[0]),
          text: `${who} running but not connected to anything — ${parts.join(' and ')} ${many ? 'have' : 'has'} no power. Run power lines or a road from the plant to your zones.` });
      } else {
        out.push({ ...base, ...(scan.unpoweredAt >= 0 ? cellAt(scan.unpoweredAt) : fac.civicFirst ? at(fac.civicFirst) : {}),
          text: `Power plants supply ${int(s.powerSupply)} MW, but ${parts.join(' and ')} ${many ? 'aren\'t' : 'isn\'t'} connected to the grid${scan.unpowered ? ', so nothing can grow there' : ''}. Connect ${many ? 'them' : 'it'} with roads or power lines (see the Power data view).` });
      }
    }
    const waterFacilities = fac.waterOk.length + fac.waterBurnt.length + fac.waterNoRoad.length + fac.waterNoPower.length;
    if (pop > 1500 && s.waterSupply <= 0 && (!util || waterFacilities === 0)) {
      out.push({ id: 'noWater', cooldown: 90, priority: 8, kind: 'warning', advisor: 'utilities',
        text: 'Medium and high density buildings need water — build water pumps or towers.' });
    } else if (s.waterDemand > s.waterSupply && s.waterSupply > 0) {
      out.push({ id: 'waterShortage', cooldown: 60, priority: 8, kind: 'bad', advisor: 'utilities',
        text: `Water shortage: ${int(s.waterDemand)} kL/day needed, ${int(s.waterSupply)} available.` });
    }
    if (util) {
      // water facilities that exist but can't deliver (these replace the generic "build water pumps" advice)
      const dry = s.waterSupply <= 0;
      if (fac.waterBurnt.length) {
        out.push({ id: 'waterBurnt', cooldown: 90, priority: dry ? 8 : 5, kind: 'warning', advisor: 'utilities', ...at(fac.waterBurnt[0]),
          text: `${burntWhat(fac.waterBurnt, 'water facilities')} burned down${dry ? ' — the taps have run dry' : ''}. Bulldoze the rubble and build a new one.` });
      }
      if (fac.waterNoRoad.length) {
        const b = fac.waterNoRoad[0];
        out.push({ id: 'waterNoRoad', cooldown: 60, priority: dry ? 8 : 5, kind: 'warning', advisor: 'utilities', ...at(b),
          text: `Your ${nameOf(b)} isn't next to a road, so its water can't reach anyone — pipes run under roads. Build a road beside it.` });
      }
      if (fac.waterNoPower.length) {
        const b = fac.waterNoPower[0], n = fac.waterNoPower.length;
        out.push({ id: 'waterNoPower', cooldown: 60, priority: dry ? 8 : 5, kind: 'warning', advisor: 'utilities', confirm: true, ...at(b),
          text: `${n > 1 ? `${n} water facilities have` : `Your ${nameOf(b)} has`} no power, so ${n > 1 ? 'they' : 'it'} can't pump any water. Connect ${n > 1 ? 'them' : 'it'} to the power grid with a road or power line.` });
      }
      // water flows, but dense zones sit on roads that are not part of its pipe network
      const waterShort = s.waterDemand > s.waterSupply * 1.0001;
      if (s.waterSupply > 0 && !waterShort && scan.unwatered >= GAP_MIN_TILES) {
        const none = scan.unwatered >= scan.needWater;
        const src = fac.waterOk[0];
        out.push({ id: 'waterGap', cooldown: 90, priority: none ? 7 : 5, kind: 'warning', advisor: 'utilities', confirm: true, ...cellAt(scan.unwateredAt),
          text: `Water is flowing, but ${count(scan.unwatered, 'medium/high-density tile')} ${scan.unwatered === 1 ? 'has' : 'have'} none, so they can't grow. Pipes run under roads — connect those roads to the one your ${src ? nameOf(src) : 'water supply'} stands on.` });
      }
    }
    if (pop > 2000 && s.garbageProduced > s.garbageCapacity * 1.02) {
      out.push({ id: 'garbage', cooldown: 120, priority: 6, kind: 'warning', advisor: 'utilities',
        text: 'Garbage is piling up in the streets! Zone a landfill or build a recycling center.' });
    }
    // ---------------- transport
    if (st.neighborConnections.length === 0 && pop > 800) {
      out.push({ id: 'noConnection', cooldown: 240, priority: 5, kind: 'info', advisor: 'transport',
        text: 'Connect to the region! A highway or road off the map edge boosts demand and brings commuters.' });
    }
    if (inf.traffic) {
      let worst = 0, wi = -1;
      const cg = st.congestion;
      const step = Math.max(1, (st.cells / 4096) | 0);
      for (let i = (hash2(st.day, 3) * step) | 0; i < st.cells; i += step) if (cg[i] > worst) { worst = cg[i]; wi = i; }
      if (worst > 1.25 && wi >= 0) {
        out.push({ id: 'gridlock', cooldown: 90, priority: 6, kind: 'warning', advisor: 'transport', x: wi % st.size, z: (wi / st.size) | 0,
          text: 'Traffic is gridlocked here! Upgrade to avenues, add alternate routes or build transit.' });
      }
    }
    if (s.avgCommute > 45 && pop > 3000) {
      out.push({ id: 'commute', cooldown: 180, priority: 5, kind: 'warning', advisor: 'transport',
        text: `Commutes average ${Math.round(s.avgCommute)} minutes. Build highways, avenues, buses or subways.` });
    }
    // ---------------- safety / health / education / environment
    const cov = residentCoverage(st);
    if (pop > 2500 && d.resCrime > 0.35) {
      out.push({ id: 'crime', cooldown: 150, priority: 6, kind: 'warning', advisor: 'safety', text: 'Crime is rising in residential areas. We need more police stations.' });
    }
    if (pop > 3000 && inf.services && cov.fire < 0.2) {
      out.push({ id: 'noFire', cooldown: 180, priority: 5, kind: 'warning', advisor: 'safety', text: 'Most homes are outside fire station coverage. One spark and we lose whole blocks!' });
    }
    if (pop > 3000 && inf.services && cov.police < 0.2) {
      out.push({ id: 'noPolice', cooldown: 180, priority: 4, kind: 'warning', advisor: 'safety', text: 'Most neighborhoods have no police coverage.' });
    }
    if (pop > 5000 && s.eq < 60) {
      out.push({ id: 'eqLow', cooldown: 240, priority: 3, kind: 'info', advisor: 'health',
        text: `Our education quotient is only ${Math.round(s.eq)}. Schools attract offices and high-tech industry (and clean the air of dirty industry).` });
    }
    if (pop > 5000 && s.hq < 60) {
      out.push({ id: 'hqLow', cooldown: 240, priority: 3, kind: 'info', advisor: 'health', text: `Health is poor (HQ ${Math.round(s.hq)}). Build clinics and hospitals.` });
    }
    if (pop > 2000 && d.resPollution > 0.3) {
      out.push({ id: 'airPollution', cooldown: 180, priority: 5, kind: 'warning', advisor: 'environment',
        text: 'Smog is choking our neighborhoods. Separate industry from homes, plant trees, or pass the Clean Air Act.' });
    }
    // ---------------- planning
    for (const h of capHints(st)) {
      const what = h.family === 'R' ? 'Residential' : h.family === 'C' ? 'Commercial' : 'Industrial';
      const fix = h.family === 'R' ? 'build parks and recreation' : h.family === 'C' ? 'build an airport or landmarks' : 'build a seaport, freight rail or highway connections';
      out.push({ id: 'cap' + h.family, cooldown: 150, priority: 7, kind: 'warning', advisor: 'planning',
        text: `${what} demand is capped (${h.devs.map((x) => DEV_TYPE_LABELS[x]).join(', ')}) — ${fix}!` });
    }
    const famDemand = (a: number, b: number) => { let m = -1; for (let k = a; k <= b; k++) m = Math.max(m, s.demand[k]); return m; };
    const room = (zs: number[]) => zs.reduce((t, z) => t + rt.emptyFront[z], 0);
    if (famDemand(0, 2) > 0.5 && room([Zone.ResLow, Zone.ResMed, Zone.ResHigh]) < 12) {
      out.push({ id: 'zoneR', cooldown: 90, priority: 6, kind: 'info', advisor: 'planning', text: 'Residential demand is strong but there is no room to grow — zone more residential land along roads.' });
    }
    if (famDemand(3, 7) > 0.5 && room([Zone.ComLow, Zone.ComMed, Zone.ComHigh]) < 8) {
      out.push({ id: 'zoneC', cooldown: 90, priority: 6, kind: 'info', advisor: 'planning', text: 'Businesses want to open shops and offices — zone more commercial land.' });
    }
    if (famDemand(8, 11) > 0.5 && room([Zone.IndAg, Zone.IndMed, Zone.IndHigh]) < 8) {
      out.push({ id: 'zoneI', cooldown: 90, priority: 6, kind: 'info', advisor: 'planning', text: 'Industry wants to move in — zone industrial land, ideally near highways or rail.' });
    }
    // sub-type specific: strong demand for a DevType whose zones have no room at all
    const SUBTYPE_HINT: [number, number[], string][] = [
      [DevType.IHT, [Zone.IndHigh], 'High-tech industry wants to move in, but there is no high-density industrial zone. Zone some — clean, educated areas are best.'],
      [DevType.IA, [Zone.IndAg], 'Farmers are looking for land. Zone agricultural land on flat ground away from pollution.'],
      [DevType.CO3, [Zone.ComMed, Zone.ComHigh], 'Corporate offices (CO$$$) want high land value downtown — zone medium or high density commercial.'],
      [DevType.R3, [Zone.ResLow, Zone.ResMed, Zone.ResHigh], 'Wealthy residents are looking for homes. Zone residential land near parks and water.'],
    ];
    for (const [dev, zs, text] of SUBTYPE_HINT) {
      if (s.demand[dev] > 0.6 && room(zs) === 0) out.push({ id: 'zoneDev' + dev, cooldown: 150, priority: 6, kind: 'info', advisor: 'planning', text });
    }
    if (pop > 2000 && s.unemployment > 0.15) {
      out.push({ id: 'unemployment', cooldown: 120, priority: 7, kind: 'warning', advisor: 'planning',
        text: `Unemployment is at ${Math.round(s.unemployment * 100)}%. Zone more commercial and industrial land.` });
    }
    if (pop > 2000 && rt.jobFill < 0.8 && rt.jobFill > 0) {
      out.push({ id: 'workers', cooldown: 120, priority: 5, kind: 'info', advisor: 'planning', text: 'Businesses cannot find enough workers. Zone more residential land.' });
    }
    if (rt.totals.abandoned > 20) {
      out.push({ id: 'abandoned', cooldown: 180, priority: 4, kind: 'warning', advisor: 'planning',
        text: `${rt.totals.abandoned} buildings stand abandoned. Check power, water, road access, crime, pollution and demand.` });
    }
    // ---------------- why nothing grows: road access, demand, land
    if (scan.noAccess >= NO_ACCESS_MIN_TILES) {
      const none = scan.front === 0;
      out.push({ id: 'noRoadAccess', cooldown: none ? 60 : 120, priority: none ? 9 : 5, kind: none ? 'bad' : 'warning', advisor: 'planning', confirm: true,
        ...cellAt(scan.noAccessAt),
        text: none
          ? `Nothing can grow: none of your ${count(scan.zoned, 'zoned tile')} touch a road. Buildings only grow on lots facing a road — build roads through your zones.`
          : `${count(scan.noAccess, 'zoned tile')} ${scan.noAccess === 1 ? 'has' : 'have'} no road access and will never develop. Run a road into those zones.` });
    }
    const alive = rt.totals.growables - rt.totals.abandoned;
    if (alive <= 0 && scan.ready > 0 && st.day >= 60) {
      // zones face a road and have their utilities, yet not a single building stands
      let best = -1;
      for (let z = Zone.ResLow; z <= Zone.IndHigh; z++) if (scan.readyZones & (1 << z)) for (const dv of ZONE_DEVTYPES[z]) best = Math.max(best, s.demand[dv]);
      if (best <= 0.02) {
        const fams = ([['residential', R_ZONES], ['commercial', C_ZONES], ['industrial', I_ZONES]] as const).filter(([, m]) => scan.readyZones & m).map(([n]) => n);
        let tip = 'Lower taxes, or connect a road or highway to the region to bring in demand.';
        if (famDemand(0, 2) > 0.1 && !(scan.readyZones & R_ZONES)) tip = 'Residents want to move in — zone some residential land; shops and jobs follow the people.';
        else if (famDemand(3, 7) > 0.1 && !(scan.readyZones & C_ZONES)) tip = 'Businesses want to open — zone some commercial land.';
        else if (famDemand(8, 11) > 0.1 && !(scan.readyZones & I_ZONES)) tip = 'Industry wants to move in — zone some industrial land.';
        out.push({ id: 'noDemand', cooldown: 90, priority: 7, kind: 'warning', advisor: 'planning', confirm: true, ...cellAt(scan.readyAt),
          text: `Nothing is growing: there is no demand for ${fams.join(' or ')} buildings right now (see the RCI meter). ${tip}` });
      } else if (st.day >= 150 && scan.ready >= 12) {
        out.push({ id: 'growthStalled', cooldown: 120, priority: 6, kind: 'warning', advisor: 'planning', confirm: true, ...cellAt(scan.readyAt),
          text: 'Nothing is growing although there is demand and the zones have roads and utilities. The land may be too steep or too unattractive (pollution, noise, a power plant next door) — check the Desirability data view.' });
      }
    }
    return out;
  };

  return {
    name: 'economy.advisors',
    init(sim) {
      rt.attach(sim);
      const d = econData(sim.state);
      if (!d.popMilestone) d.popMilestone = POP_MILESTONES.filter((m) => m <= sim.state.stats.population).pop() ?? 0;
    },
    daily(sim) {
      const st = sim.state;
      const d = econData(st);
      // population milestones
      const pop = st.stats.population;
      for (const m of POP_MILESTONES) {
        if (m > d.popMilestone && pop >= m) {
          d.popMilestone = m;
          sim.notify(`${st.config.name} reaches ${m.toLocaleString('en-US')} residents!`, 'good', undefined, undefined, 'news');
        }
      }
      // flavor headlines (shuffle bag; the schedule persists with the city)
      const a = advisorData(st);
      if (st.day >= a.nextHeadline) {
        a.nextHeadline = st.day + 40 + sim.rng.int(0, 60);
        if (pop > 300) {
          // exactly one draw, like the former rng.pick: the sim's random stream stays as it was
          const seed = (sim.rng.next() * 4294967296) >>> 0 || 1;
          const h = drawHeadline(a, headlineCtx(st), st.day, seed);
          if (h) sim.notify(fillHeadline(h.text, st), 'info', undefined, undefined, 'news');
        }
      }
    },
    monthly(sim) {
      const st = sim.state;
      const d = econData(st);
      const list = gather(st).sort((a, b) => b.priority - a.priority);
      // persistent conditions back off: each repeat doubles the cooldown (max ×8); cleared conditions reset
      const streak = (d.streak ??= {});
      const active = new Set(list.map((a) => a.id));
      for (const id of Object.keys(streak)) if (!active.has(id)) delete streak[id];
      // confirm rules: remember the first sighting; they speak once the condition held for CONFIRM_DAYS
      const seen = advisorData(st).seen;
      for (const id of Object.keys(seen)) if (!active.has(id)) delete seen[id];
      for (const a of list) if (a.confirm) seen[a.id] ??= st.day;
      let shown = 0;
      for (const a of list) {
        if (shown >= ADVICE_PER_MONTH) break;
        if (a.confirm && st.day - seen[a.id] < CONFIRM_DAYS) continue;
        const last = d.cooldowns[a.id];
        const cooldown = Math.max(MIN_COOLDOWN, a.cooldown) * 2 ** Math.min(3, streak[a.id] ?? 0);
        if (last !== undefined && st.day - last < cooldown) continue;
        d.cooldowns[a.id] = st.day;
        streak[a.id] = (streak[a.id] ?? 0) + 1;
        sim.notify(a.text, a.kind === 'info' ? 'advisor' : a.kind, a.x, a.z, a.advisor);
        shown++;
      }
    },
  };
}
