/**
 * LG-14 scenario bundles and their reference runs (node only; POLISH_PLAN LG-14: "scenarios generated from fixed bot
 * seeds").
 *
 *   npx tsx tools/scenarios.ts              build the two bundled cities in memory and print their start figures
 *   npx tsx tools/scenarios.ts --write      ... and write src/game/scenarioBundles/<id>.metropolis (about 1 MB each)
 *   npx tsx tools/scenarios.ts --verify     play every reference run on the bundles on disk and check its outcome
 *   --only boomtown,lights_out,smog_city    limit --verify to these scenarios
 *
 * THE BUNDLES. One run of the default bot (tools/simbot.ts: 128 cells, seed 7, Medium, plains, water 0.2: SCENARIO_LAND)
 * is saved twice, each as a one-city region file like the game's Export region (tools/citySaves.ts regionFileFor):
 *   lights_out  1 February 2008 (day 2910, about 71,000 residents). The plant that lights the city, its largest, has
 *               burned down (the fire system's burnDown, so every system has seen it), the bank holds LIGHTS_OUT.funds,
 *               less than a replacement costs (checked against the catalog here), and the view opens on the ruin.
 *   smog_city   1 January 2015 (day 5400, about 193,000 residents), unchanged; its record holds the air pollution at
 *               homes averaged over the 12 months before, which the goal is measured against.
 * Both carry `config.scenario` (src/game/scenarios.ts ScenarioStart). The files hold no wall-clock time, so the same tree
 * writes the same bytes; a tree with another balance writes another city, and the scenario figures in scenarios.ts
 * (70,000, 180,000, the months) then want a look: --verify says whether they still fit. Bundles stay loadable as old
 * saves (tests/save/scenarioBundles.test.ts loads each at HEAD); regenerate them when the save version changes.
 *
 * THE REFERENCE RUNS (--verify; tests/sim/scenarioRuns.test.ts plays the short ones). The acceptance asks, for every
 * scenario, for a bot strategy that reaches bronze and a do-nothing run that fails, and for Lights Out that a run buying
 * only one replacement plant earns at most bronze although, without the start-money limit, it would earn gold:
 *   boomtown    bot: the default bot on the scenario's land for ten years · nothing: the empty land for ten years
 *   lights_out  nothing · loan: a loan and the same plant again on day one · one plant: no loan, the plant as soon as
 *               the bank can pay for it · no limit: the same with the plant's price in the bank · squeeze (beyond the
 *               acceptance: gold is in reach): no loan, taxes up and spending down until the bank can pay for the plant
 *   smog_city   nothing · clean-up: the clean-air ordinances, the dirty-industry zones cleared and rezoned for
 *               manufacturing and high-tech, a nuclear plant in place of the fossil plants once it is affordable
 * Every run is judged by src/game/scenarios.ts evaluateScenario, the function the objectives card uses, month by month.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { Zone, type DevType } from '../src/core/types';
import {
  BOOMTOWN, LIGHTS_OUT, SCENARIOS, SCENARIO_IDS, SCENARIO_LAND, SMOG_CITY, boomtownConfig, evaluateScenario, medalRank, scenarioOf,
  type Medal, type ScenarioId, type ScenarioMemo, type ScenarioStart, type ScenarioStatus,
} from '../src/game/scenarios';
import { decodeBundle } from '../src/save/bundleCodec';
import type { RegionFile } from '../src/save/index';
import { deserializeCity, serializeCity, type SerializedCity } from '../src/save/serialize';
import { CityActions } from '../src/sim/actions';
import { getDef } from '../src/sim/catalog';
import type { ServiceKind } from '../src/sim/catalogTypes';
import { BF, type Building, type CityState } from '../src/sim/CityState';
import { defaultCityConfig } from '../src/sim/config';
import { demolishFee } from '../src/sim/economy/buildings';
import type { FireSystem } from '../src/sim/infra/fire';
import { Simulation } from '../src/sim/Simulation';
import { createSystems } from '../src/sim/systems/index';
import { createCityState } from '../src/sim/terrainGen';
import { packSync, regionFileFor } from './citySaves';
import { SimBot, type BotOptions } from './simbot';

export const BUNDLE_DIR = fileURLToPath(new URL('../src/game/scenarioBundles/', import.meta.url));
export const bundlePath = (id: ScenarioId): string => join(BUNDLE_DIR, `${id}.metropolis`);
/** the bundled scenarios and the bot month each is saved at (day = month × 30) */
export const BUNDLE_MONTH = { lights_out: 97, smog_city: 180 } as const;
export type BundleId = keyof typeof BUNDLE_MONTH;
/** every time stamp in a bundle (the files must not depend on when they were written): 1 November 2026 UTC */
const BUNDLE_EPOCH = Date.UTC(2026, 10, 1);
const CELL = 16;

/** the bot whose city the bundles are (the simbot defaults; its land is SCENARIO_LAND) */
export const SCENARIO_BOT: BotOptions = {
  size: SCENARIO_LAND.size, years: 15, seed: SCENARIO_LAND.seed, difficulty: 'medium', terrain: SCENARIO_LAND.terrain,
  water: SCENARIO_LAND.waterAmount, quiet: true, noInfra: false,
};

/** one month of a bot exactly as SimBot.run plays it (30 days with its daily rules, then its monthly rules); call
 *  bot.setup() once before the first */
export function playBotMonth(bot: SimBot): void {
  for (let d = 0; d < 30; d++) { bot.sim.advanceDay(); bot.days++; bot.daily(); }
  bot.monthly();
}

const powerOut = (b: Building): number => getDef(b.def)?.powerOut ?? 0;
const standing = (b: Building): boolean => !(b.flags & BF.Burnt);

/** an independent copy of a city, as a save and load makes it */
function copyCity(st: CityState): CityState {
  return deserializeCity(serializeCity(st, { copy: true }));
}

/** Lights Out: the bot's city with its largest power plant burned down and LIGHTS_OUT.funds in the bank */
export function lightsOutCity(src: CityState): CityState {
  const st = copyCity(src);
  const sim = new Simulation(st, createSystems());
  let plant: Building | undefined;
  for (const b of st.buildings.values()) if (standing(b) && powerOut(b) > (plant ? powerOut(plant) : 0)) plant = b;
  if (!plant) throw new Error('lights_out: the city has no power plant');
  const def = getDef(plant.def)!;
  if (!(LIGHTS_OUT.funds < (def.cost ?? 0))) throw new Error(`lights_out: ${LIGHTS_OUT.funds} in the bank buys a ${def.name} (${def.cost})`);
  const fire = sim.getSystem<FireSystem>('fire');
  if (!fire) throw new Error('lights_out: no fire system');
  fire.burnDown(sim, plant);
  st.funds = LIGHTS_OUT.funds;
  st.config = {
    ...st.config, name: SCENARIOS.lights_out.city, mayor: 'Mayor',
    scenario: { id: 'lights_out', startDay: st.day, loans: st.budget.loans.map((l): [number, number] => [l.principal, l.rate]) },
  };
  const x = plant.x + (plant.w >> 1), z = plant.z + (plant.d >> 1);
  // the city opens on the ruin (src/game/cameraStart.ts SavedCamera)
  st.systemData.camera = { x: (x + 0.5) * CELL, z: (z + 0.5) * CELL, distance: 460 };
  sim.notify(`The ${def.name} burned down last night. The city has no power: bulldoze the ruin and build a new plant.`, 'disaster', x, z, 'utilities');
  return st;
}

/** Smog City: the bot's city as it is, with the last year's air pollution at homes as the goal's baseline */
export function smogCity(src: CityState): CityState {
  const st = copyCity(src);
  const air = st.history.air.slice(-SMOG_CITY.window);
  if (air.length < SMOG_CITY.window) throw new Error('smog_city: less than a year of history');
  st.config = {
    ...st.config, name: SCENARIOS.smog_city.city, mayor: 'Mayor',
    scenario: { id: 'smog_city', startDay: st.day, air: air.reduce((a, b) => a + b, 0) / air.length },
  };
  st.notify('Smog hangs over the city again. Residents want cleaner air: the new mayor has ten years.', 'warning', undefined, undefined, 'environment');
  return st;
}

/** the one-city region file of a scenario city, free of wall-clock time */
export function bundleFile(id: BundleId, st: CityState): RegionFile {
  const ser = serializeCity(st);
  ser.savedAt = BUNDLE_EPOCH;
  const file = regionFileFor(st, ser, { name: SCENARIOS[id].title, id: `scenario-${id}`, seed: SCENARIO_LAND.seed });
  file.exportedAt = BUNDLE_EPOCH;
  file.region.created = file.region.lastPlayed = BUNDLE_EPOCH;
  for (const t of file.region.tiles) if (t.city) t.city.lastPlayed = t.city.founded = BUNDLE_EPOCH;
  return file;
}

/** play the bot and build both bundled cities (about 20 s) */
export function buildBundles(log: (line: string) => void = () => {}): Record<BundleId, RegionFile> {
  const bot = new SimBot(SCENARIO_BOT, createSystems());
  bot.setup();
  const out = {} as Record<BundleId, RegionFile>;
  const last = Math.max(...Object.values(BUNDLE_MONTH));
  for (let m = 1; m <= last; m++) {
    playBotMonth(bot);
    if (m === BUNDLE_MONTH.lights_out) {
      log(`bot month ${m}: ${describe(bot.st)}`);
      out.lights_out = bundleFile('lights_out', lightsOutCity(bot.st));
    }
    if (m === BUNDLE_MONTH.smog_city) {
      log(`bot month ${m}: ${describe(bot.st)}; residents by wealth ${bot.st.stats.residents.join(' ')}`);
      out.smog_city = bundleFile('smog_city', smogCity(bot.st));
    }
  }
  return out;
}

function describe(st: CityState): string {
  const s = st.stats;
  return `${st.dateLabel()} (day ${st.day}), ${s.population} residents, approval ${s.approval.toFixed(1)}, §${Math.round(st.funds)}, power ${Math.round(s.powerSupply)}/${Math.round(s.powerDemand)} MW, `
    + `air at homes ${s.avgAir.toFixed(4)}, ${st.budget.loans.length} loans`;
}

/** a bundle from disk (node's zlib, not the browser stream) */
export function readBundle(id: BundleId): RegionFile {
  return decodeBundle(gunzipSync(readFileSync(bundlePath(id)))) as RegionFile;
}

// ------------------------------------------------------------------------------------------------ playing a scenario
export interface ScenarioCity {
  st: CityState;
  sim: Simulation;
  A: CityActions;
  start: ScenarioStart;
}

/** the city of a region file (a bundle), loaded and running on every system */
export function openBundle(file: RegionFile): ScenarioCity {
  const [ser] = Object.values(file.cities) as SerializedCity[];
  const st = deserializeCity(ser);
  const start = scenarioOf(st.config);
  if (!start) throw new Error('the bundle holds no scenario city');
  const sim = new Simulation(st, createSystems());
  return { st, sim, A: new CityActions(sim), start };
}

/**
 * Play a scenario to its outcome, as the game judges it: `mayor` acts at the start of every month (month 0: the first
 * day), then `step` runs the month (default: 30 days with nobody governing) and the month's history sample is judged.
 */
export function playScenario(city: ScenarioCity, mayor?: (month: number, city: ScenarioCity) => void, step?: () => void): ScenarioStatus {
  const memo: ScenarioMemo = {};
  let status = evaluateScenario(city.start, city.st, memo);
  while (!status.result) {
    mayor?.(status.month, city);
    if (step) step();
    else city.sim.runDays(30);
    status = evaluateScenario(city.start, city.st, memo);
    if (status.newLoan) memo.newLoan = true;
  }
  return status;
}

// ---- Lights Out
/** the burnt plant's lot cleared and the same plant built on it again; false while the bank cannot pay for both */
export function rebuildPlant({ st, A }: ScenarioCity): boolean {
  let ruin: Building | undefined;
  for (const b of st.buildings.values()) if (!standing(b) && powerOut(b) > 0) ruin = b;
  const def = ruin && getDef(ruin.def);
  if (!ruin || !def || st.funds < (def.cost ?? 0) + demolishFee(ruin)) return false;
  const { x, z, w, d, rot } = ruin, id = ruin.def;
  return A.bulldoze({ x0: x, z0: z, x1: x + w, z1: z + d }).ok && A.plop(id, x, z, rot).ok;
}
const ruinCost = ({ st }: ScenarioCity): number => {
  for (const b of st.buildings.values()) if (!standing(b) && powerOut(b) > 0) return (getDef(b.def)?.cost ?? 0) + demolishFee(b);
  return 0;
};

/** the squeeze of Lights Out's no-loan mayor: every tax rate (%) and the funding (%) of these services */
const SQUEEZE = { tax: 14, funding: 50 } as const;
const SQUEEZED: ServiceKind[] = ['police', 'fire', 'health', 'education', 'transit', 'parks'];

/**
 * Lights Out without a loan: taxes up, service funding down and every ordinance repealed until the bank holds the
 * plant's price; then the plant again, and the budget as it was before
 */
export function squeezeMayor(): (month: number, city: ScenarioCity) => void {
  let before: { taxes: number[]; funding: number[]; ordinances: string[] } | null = null;
  let done = false;
  return (_month, city) => {
    if (done) return;
    const { st, A } = city;
    if (!before) {
      before = { taxes: [...st.budget.taxRates], funding: SQUEEZED.map((k) => st.budget.funding[k]), ordinances: [...st.budget.ordinances] };
      before.taxes.forEach((_rate, d) => A.setTax(d as DevType, SQUEEZE.tax));
      for (const k of SQUEEZED) A.setFunding(k, SQUEEZE.funding);
      for (const id of before.ordinances) A.setOrdinance(id, false, { confirm: true });
    }
    if (!rebuildPlant(city)) return;
    done = true;
    before.taxes.forEach((rate, d) => A.setTax(d as DevType, rate));
    SQUEEZED.forEach((k, i) => A.setFunding(k, before!.funding[i]));
    for (const id of before.ordinances) A.setOrdinance(id, true, { confirm: true });
  };
}

// ---- Smog City
const CLEAN_AIR_ORDINANCES = ['pollution_controls', 'clean_air_act', 'clean_power_act', 'tire_recycling', 'carpool', 'commuter_shuttle'];

/** every dirty-industry (medium density) zone cleared and rezoned high density: manufacturing and high-tech only */
function clearDirtyIndustry({ st, A }: ScenarioCity): void {
  const N = st.size;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    if (st.zone[z * N + x] !== Zone.IndMed) continue;
    const b = st.buildingAt(x, z);
    if (b) A.bulldoze({ x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d });
    A.zone({ x0: x, z0: z, x1: x + 1, z1: z + 1 }, Zone.IndHigh);
  }
}

/** a nuclear plant on the free site nearest the fossil plants, which are then demolished; false when it cannot be built */
function goNuclear({ st, A }: ScenarioCity): boolean {
  const fossil = [...st.buildings.values()].filter((b) => standing(b) && powerOut(b) > 0 && (getDef(b.def)?.pollution?.air ?? 0) > 0.1);
  if (!fossil.length) return false;
  const [fw, fd] = getDef('util_nuclear_plant')!.footprint, side = Math.max(fw, fd);
  let best: { x: number; z: number; rot: 0 | 1 | 2 | 3; d: number } | null = null;
  for (let z = 1; z < st.size - side - 1; z++) for (let x = 1; x < st.size - side - 1; x++) {
    const d = Math.hypot(x - fossil[0].x, z - fossil[0].z);
    if (best && d >= best.d) continue;
    for (const rot of [0, 1, 2, 3] as const) {
      if (!A.plop('util_nuclear_plant', x, z, rot, true).ok) continue;
      best = { x, z, rot, d };
      break;
    }
  }
  if (!best || !A.plop('util_nuclear_plant', best.x, best.z, best.rot).ok) return false;
  for (const b of fossil) A.bulldoze({ x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d });
  return true;
}

/** Smog City's clean-up mayor: ordinances and the dirty zones on day one, nuclear power as soon as the bank allows */
export function cleanUpMayor(): (month: number, city: ScenarioCity) => void {
  let nuclear = false;
  return (month, city) => {
    if (month === 0) {
      for (const id of CLEAN_AIR_ORDINANCES) city.A.setOrdinance(id, true, { confirm: true });
      clearDirtyIndustry(city);
    }
    // (the plant's price and a small reserve)
    if (!nuclear && city.st.funds >= (getDef('util_nuclear_plant')!.cost ?? 0) + 5000) nuclear = goNuclear(city);
  };
}

// ---- the reference runs
export interface ReferenceRun {
  id: ScenarioId;
  name: string;
  /** what the acceptance asks of the run, in words */
  expect: string;
  /** years of simulation it takes at most (the ten-year ones are left to --verify and to SCENARIOS=1 in the tests) */
  years: number;
  ok(status: ScenarioStatus): boolean;
  play(): ScenarioStatus;
}

const atLeast = (m: Medal) => (s: ScenarioStatus): boolean => s.phase === 'won' && medalRank(s.medal) >= medalRank(m);
const atMost = (m: Medal) => (s: ScenarioStatus): boolean => medalRank(s.phase === 'won' ? s.medal : null) <= medalRank(m);
const lost = (s: ScenarioStatus): boolean => s.phase === 'lost';

export function referenceRuns(): ReferenceRun[] {
  const lightsOut = (): ScenarioCity => openBundle(readBundle('lights_out'));
  const smog = (): ScenarioCity => openBundle(readBundle('smog_city'));
  return [
    {
      id: 'boomtown', name: 'bot', expect: 'bronze or better', years: 10, ok: atLeast('bronze'),
      play: () => {
        // the default bot founds on day 0 (a player's Boomtown on NEW_CITY_DAY): its ten years start there
        const bot = new SimBot({ ...SCENARIO_BOT, years: BOOMTOWN.months / 12 }, createSystems());
        bot.setup();
        return playScenario({ st: bot.st, sim: bot.sim, A: bot.A, start: { id: 'boomtown', startDay: 0 } }, undefined, () => playBotMonth(bot));
      },
    },
    {
      id: 'boomtown', name: 'nothing', expect: 'fails', years: 10, ok: lost,
      play: () => {
        const st = createCityState(defaultCityConfig({ ...boomtownConfig(), scenario: { id: 'boomtown', startDay: 0 } }));
        const sim = new Simulation(st, createSystems());
        return playScenario({ st, sim, A: new CityActions(sim), start: scenarioOf(st.config)! });
      },
    },
    { id: 'lights_out', name: 'nothing', expect: 'fails', years: 1, ok: lost, play: () => playScenario(lightsOut()) },
    {
      id: 'lights_out', name: 'loan', expect: 'bronze or better', years: 1, ok: atLeast('bronze'),
      play: () => playScenario(lightsOut(), (month, city) => {
        if (month !== 0) return;
        // (rounded up to the bank's thousands, with the month's bills on top)
        const need = Math.ceil((ruinCost(city) - city.st.funds + 5000) / 1000) * 1000;
        if (!city.A.takeLoan(need).ok || !rebuildPlant(city)) throw new Error('lights_out loan: the plant could not be rebuilt');
      }),
    },
    {
      id: 'lights_out', name: 'one plant', expect: 'bronze at most', years: 1, ok: atMost('bronze'),
      play: () => { let done = false; return playScenario(lightsOut(), (_m, city) => { if (!done) done = rebuildPlant(city); }); },
    },
    {
      id: 'lights_out', name: 'no limit', expect: 'gold', years: 1, ok: atLeast('gold'),
      play: () => playScenario(lightsOut(), (month, city) => {
        if (month !== 0) return;
        city.st.funds = ruinCost(city) + LIGHTS_OUT.funds;
        if (!rebuildPlant(city)) throw new Error('lights_out no limit: the plant could not be rebuilt');
      }),
    },
    // (not asked by the acceptance: that gold, which needs no new loan, is in reach under the start-money limit)
    { id: 'lights_out', name: 'squeeze', expect: 'gold', years: 1, ok: (s) => atLeast('gold')(s) && !s.newLoan, play: () => playScenario(lightsOut(), squeezeMayor()) },
    { id: 'smog_city', name: 'nothing', expect: 'fails', years: 10, ok: lost, play: () => playScenario(smog()) },
    { id: 'smog_city', name: 'clean-up', expect: 'bronze or better', years: 3, ok: atLeast('bronze'), play: () => playScenario(smog(), cleanUpMayor()) },
  ];
}

export function outcome(s: ScenarioStatus): string {
  const months = (m: number): string => `${m} month${m === 1 ? '' : 's'}`;
  return s.phase === 'won' ? `${s.medal} after ${months(s.result!.month)}` : s.phase === 'lost' ? `lost after ${months(s.result!.month)}` : 'undecided';
}

// ------------------------------------------------------------------------------------------------ command line
if (/[\\/]scenarios\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('usage: npx tsx tools/scenarios.ts [--write] [--verify] [--only boomtown,lights_out,smog_city]   (see the file header)');
  } else {
    const only = args.includes('--only') ? args[args.indexOf('--only') + 1]?.split(',') ?? [] : [...SCENARIO_IDS];
    let failed = 0;
    if (!args.includes('--verify') || args.includes('--write')) {
      const t0 = Date.now();
      const files = buildBundles((l) => console.log(l));
      for (const id of Object.keys(BUNDLE_MONTH) as BundleId[]) {
        const file = files[id], bytes = packSync(file);
        const city = openBundle(file);
        console.log(`${id}: ${describe(city.st)}; scenario ${JSON.stringify(city.start)}`);
        console.log(`${id}: ${(bytes.length / 1e6).toFixed(2)} MB, sha256 ${createHash('sha256').update(bytes).digest('hex')}`);
        if (args.includes('--write')) {
          mkdirSync(dirname(bundlePath(id)), { recursive: true });
          const tmp = `${bundlePath(id)}.tmp${process.pid}`;
          writeFileSync(tmp, bytes);
          renameSync(tmp, bundlePath(id));
          console.log(`${id}: written to ${bundlePath(id)}`);
        }
      }
      console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    if (args.includes('--verify')) {
      for (const id of Object.keys(BUNDLE_MONTH) as BundleId[]) {
        if (only.includes(id) && !existsSync(bundlePath(id))) { console.error(`${id}: no bundle at ${bundlePath(id)} (run with --write)`); failed++; }
      }
      if (!failed) for (const run of referenceRuns()) {
        if (!only.includes(run.id)) continue;
        const t0 = Date.now();
        const status = run.play();
        const ok = run.ok(status);
        if (!ok) failed++;
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${run.id.padEnd(10)} ${run.name.padEnd(9)} ${outcome(status).padEnd(26)} expected: ${run.expect.padEnd(16)} `
          + `${status.lines.map((l) => `${l.label} ${l.value}`).join('; ')} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      }
    }
    if (failed) process.exitCode = 1;
  }
}
