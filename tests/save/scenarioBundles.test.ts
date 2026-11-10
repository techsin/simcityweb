/**
 * LG-14: every bundled scenario file loads at HEAD, by the old-save method: the file is read as it ships, its region
 * and city go through the save layer's migrations, the city is deserialized and then runs on every system. A bundle
 * that a later save version can no longer load fails here (regenerate it: tools/scenarios.ts --write).
 *
 * Also: what each bundle must hold for its scenario to be the one the game describes (the start day, the baseline
 * figures, Lights Out's ruin and its money limit), that a scenario's saved record survives a save and load and does not
 * disturb save / load continuity (T057's method, on the economy systems), and that a city saved before LG-14 loads as
 * free play.
 */
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LIGHTS_OUT, SCENARIOS, SCENARIO_LAND, SMOG_CITY, evaluateScenario, scenarioOf, type ScenarioStart,
} from '../../src/game/scenarios';
import { REGION_FILE_KIND, REGION_FILE_VERSION, migrateRegion } from '../../src/save';
import { CITY_SAVE_VERSION, deserializeCity, migrateCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { getDef } from '../../src/sim/catalog';
import { BF, type CityState } from '../../src/sim/CityState';
import { cityChallenges } from '../../src/sim/economy/challenges';
import { Simulation } from '../../src/sim/Simulation';
import { economySystems } from '../../src/sim/systems/economy';
import { createSystems } from '../../src/sim/systems/index';
import { summarizeCity } from '../../src/region/citySummary';
import { BUNDLE_MONTH, bundlePath, readBundle, type BundleId } from '../../tools/scenarios';
import { SimBot } from '../../tools/simbot';

const BUNDLES = Object.keys(BUNDLE_MONTH) as BundleId[];

function canonical(v: unknown): unknown {
  if (ArrayBuffer.isView(v)) {
    const b = new Uint8Array((v as ArrayBufferView).buffer, (v as ArrayBufferView).byteOffset, (v as ArrayBufferView).byteLength);
    return `${v.constructor.name}:${createHash('sha256').update(b).digest('hex')}`;
  }
  if (v instanceof Map) return ['$map', ...[...v.entries()].map(([k, x]) => [canonical(k), canonical(x)])];
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : Number.isNaN(v) ? 'NaN' : v;
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}
/** the whole city as saved (the time of the save aside) */
function digest(st: CityState): string {
  const s = serializeCity(st, { copy: true }) as unknown as Record<string, unknown>;
  delete s.savedAt;
  return createHash('sha256').update(JSON.stringify(canonical(s))).digest('hex');
}

describe('LG-14: the bundled scenario files', () => {
  it('there is one bundle for every scenario that starts from a saved city', () => {
    expect(Object.values(SCENARIOS).filter((s) => s.start === 'bundle').map((s) => s.id).sort()).toEqual([...BUNDLES].sort());
  });

  for (const id of BUNDLES) {
    it(`${id}: loads at HEAD and runs on every system`, { timeout: 300_000 }, () => {
      // 128-map scenarios ship at 1-2 MB each (the plan's size risk)
      const bytes = statSync(bundlePath(id)).size;
      expect(bytes).toBeGreaterThan(300_000);
      expect(bytes).toBeLessThan(2_000_000);

      // a one-city region file, as Export region writes it
      const file = readBundle(id);
      expect(file.kind).toBe(REGION_FILE_KIND);
      expect(file.version).toBeLessThanOrEqual(REGION_FILE_VERSION);
      const region = migrateRegion(file.region);
      expect(region.name).toBe(SCENARIOS[id].title);
      const tiles = region.tiles.filter((t) => t.city);
      expect(tiles).toHaveLength(1);
      expect(tiles[0].size).toBe(2);
      expect(tiles[0].city).toMatchObject({ name: SCENARIOS[id].city, scenario: id });
      expect(Object.keys(file.cities)).toEqual([tiles[0].key]);

      // the city, through the save layer's migrations
      const ser = migrateCity(file.cities[tiles[0].key]);
      expect(ser.version).toBe(CITY_SAVE_VERSION);
      const st = deserializeCity(ser);
      expect(st.config).toMatchObject({ ...SCENARIO_LAND, name: SCENARIOS[id].city, difficulty: 'medium', disasters: false, regionId: region.id, tileX: tiles[0].x, tileZ: tiles[0].z });
      const start = scenarioOf(st.config)!;
      expect(start).toMatchObject({ id, startDay: BUNDLE_MONTH[id] * 30 });
      // it starts on a month's first day, with that month's history sample as its last
      expect(st.day).toBe(start.startDay);
      expect(st.day % 30).toBe(0);
      expect(st.history.t.at(-1)).toBe(st.day / 30);
      expect(st.history.t.length).toBeGreaterThanOrEqual(SMOG_CITY.window);
      // a city that has not been played yet: every goal is open
      expect(evaluateScenario(start, st)).toMatchObject({ phase: 'active', medal: null, month: 0, reach: 'gold', result: null, newLoan: false });

      // it runs: two months on every system, with sane figures and two more history samples
      const sim = new Simulation(st, createSystems());
      const samples = st.history.t.length;
      sim.runDays(60);
      expect(st.day).toBe(start.startDay + 60);
      expect(st.history.t.length).toBe(samples + 2);
      for (const v of [st.funds, st.stats.population, st.stats.approval, st.stats.avgAir, st.stats.powerSupply, st.stats.powerDemand]) expect(Number.isFinite(v)).toBe(true);
      expect(st.stats.population).toBeGreaterThan(0);
      expect(evaluateScenario(start, st)).toMatchObject({ phase: 'active', month: 2 });
      // and saves again: the scenario's record is in the save, and the tile summary names the scenario
      const again = deserializeCity(serializeCity(st, { copy: true }));
      expect(again.config.scenario).toEqual(start);
      expect(summarizeCity(again).scenario).toBe(id);
    });
  }

  it('lights_out: the city\'s plant is a ruin, the bank cannot pay for a new one, and the start loans are on record', () => {
    const file = readBundle('lights_out');
    const st = deserializeCity(Object.values(file.cities)[0] as SerializedCity);
    const start = scenarioOf(st.config)!;
    const plants = [...st.buildings.values()].filter((b) => (getDef(b.def)?.powerOut ?? 0) > 0);
    const ruins = plants.filter((b) => b.flags & BF.Burnt);
    expect(ruins).toHaveLength(1);
    const ruin = ruins[0], def = getDef(ruin.def)!;
    // the largest plant burned: what still stands is a fraction of it
    const standing = plants.filter((b) => !(b.flags & BF.Burnt)).reduce((n, b) => n + (getDef(b.def)!.powerOut ?? 0), 0);
    expect(standing).toBeLessThan((def.powerOut ?? 0) / 2);
    // "less money than one replacement plant costs"
    expect(st.funds).toBe(LIGHTS_OUT.funds);
    expect(st.funds).toBeLessThan(def.cost ?? 0);
    // the city it must come back to: at the goal's figures the day the plant burned
    expect(st.history.pop.at(-1)).toBeGreaterThanOrEqual(LIGHTS_OUT.residents);
    expect(st.history.approval.at(-1)).toBeGreaterThanOrEqual(LIGHTS_OUT.approval);
    expect(start.loans).toEqual(st.budget.loans.map((l) => [l.principal, l.rate]));
    // the view opens on the ruin, and the news says what happened
    const cam = st.systemData.camera as { x: number; z: number; distance: number };
    expect(Math.abs(cam.x / 16 - (ruin.x + ruin.w / 2))).toBeLessThan(1.01);
    expect(Math.abs(cam.z / 16 - (ruin.z + ruin.d / 2))).toBeLessThan(1.01);
    expect(st.news.at(-1)).toMatchObject({ kind: 'disaster', day: st.day });
    expect(st.news.at(-1)!.text).toContain(def.name);
  });

  it('the menu and the briefings describe the bundles as they are: the month, the population, the burnt plant', () => {
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    for (const id of BUNDLES) {
      const st = deserializeCity(Object.values(readBundle(id).cities)[0] as SerializedCity);
      // "February 2008. ...", "January 2015. ..."
      expect(SCENARIOS[id].brief.startsWith(`${MONTHS[st.month]} ${st.year}. `), id).toBe(true);
      // the tagline's round figure is the city's residents to the thousand ("A city of 71,000 ...")
      expect(SCENARIOS[id].tagline, id).toContain(`${Math.round(st.stats.population / 1000).toLocaleString('en-US')},000`);
    }
    // the plant the Lights Out briefing names is the one that burned
    const st = deserializeCity(Object.values(readBundle('lights_out').cities)[0] as SerializedCity);
    const ruin = [...st.buildings.values()].find((b) => b.flags & BF.Burnt && (getDef(b.def)?.powerOut ?? 0) > 0)!;
    expect(ruin.def).toBe('util_gas_plant');
    expect(SCENARIOS.lights_out.brief).toContain('The gas power plant that lit Ashbury burned down');
  });

  it('smog_city: the goal is measured against the year before the start, and the city stands above its floor', () => {
    const file = readBundle('smog_city');
    const st = deserializeCity(Object.values(file.cities)[0] as SerializedCity);
    const start = scenarioOf(st.config)!;
    const year = st.history.air.slice(-SMOG_CITY.window);
    expect(start.air).toBeCloseTo(year.reduce((a, b) => a + b, 0) / SMOG_CITY.window, 12);
    expect(start.air!).toBeGreaterThan(0.02);
    expect(st.stats.population).toBeGreaterThan(SMOG_CITY.residents);
    // nothing is broken at the start: the fossil plants stand
    expect([...st.buildings.values()].some((b) => b.flags & BF.Burnt && (getDef(b.def)?.powerOut ?? 0) > 0)).toBe(false);
  });
});

describe('LG-14: scenario records in a save', () => {
  it('a city saved before LG-14 loads as free play, with no challenge', () => {
    const bot = new SimBot({ size: 64, years: 1, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0.15, quiet: true, noInfra: true }, economySystems());
    const old = serializeCity(bot.st, { copy: true });
    expect(Object.hasOwn(old.config, 'scenario')).toBe(false);
    expect(Object.hasOwn(old.config, 'challenges')).toBe(false);
    const st = deserializeCity(old);
    expect(scenarioOf(st.config)).toBeNull();
    expect(cityChallenges(st.config)).toEqual([]);
    const s = summarizeCity(st);
    expect('scenario' in s || 'challenges' in s || 'badges' in s).toBe(false);
  });

  it('a scenario city with Mayor\'s challenges, saved mid-game, continues bit for bit and is judged the same (economy systems)', { timeout: 300_000 }, () => {
    const start: ScenarioStart = { id: 'boomtown', startDay: 0 };
    const bot = new SimBot({ size: 64, years: 1, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0.15, quiet: true, noInfra: true }, economySystems());
    bot.st.config = { ...bot.st.config, scenario: start, challenges: ['noDirtyIndustry', 'hardMoney'] };
    bot.run(1);
    const st = bot.st;
    expect(st.stats.population).toBeGreaterThan(300);
    // (a day in the middle of a month)
    bot.sim.runDays(17);
    // saved as a file would be, loaded into a new simulation
    const loaded = deserializeCity(structuredClone(serializeCity(st, { copy: true })) as SerializedCity);
    expect(loaded.config.scenario).toEqual(start);
    expect(loaded.config.challenges).toEqual(['noDirtyIndustry', 'hardMoney']);
    const sim2 = new Simulation(loaded, economySystems());
    expect(digest(loaded)).toBe(digest(st));
    for (let d = 0; d < 45; d++) {
      bot.sim.advanceDay();
      sim2.advanceDay();
      // judging between the days changes neither city
      expect(evaluateScenario(start, loaded)).toEqual(evaluateScenario(start, st));
      if (d % 15 === 14) expect(digest(loaded), `day ${st.day}`).toBe(digest(st));
    }
    expect(digest(loaded)).toBe(digest(st));
  });
});
