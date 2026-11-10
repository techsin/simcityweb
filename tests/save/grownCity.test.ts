/**
 * Save completeness with a real grown city: SimBot plays ~2 years with all systems (infra + economy),
 * the city is serialized → (structured clone | binary bundle) → deserialized, then both the original and the
 * restored city run 30 more days. The restored city must run without errors and track the original closely.
 */
import { describe, expect, it } from 'vitest';
import { SimBot } from '../../tools/simbot';
import { createSystems } from '../../src/sim/systems/index';
import { Simulation } from '../../src/sim/Simulation';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';
import type { CityState } from '../../src/sim/CityState';

function grow(years: number): SimBot {
  const bot = new SimBot(
    { size: 128, years, seed: 11, difficulty: 'medium', terrain: 'plains', water: 0.1, quiet: true, noInfra: false },
    createSystems(),
  );
  bot.run(years);
  return bot;
}

function snapshot(st: CityState) {
  return {
    pop: st.stats.population,
    buildings: st.buildings.size,
    funds: st.funds,
    unlocked: [...st.unlocked].sort(),
    announced: [...st.announced].sort(),
    milestones: { ...st.milestones },
    economyKeys: Object.keys((st.systemData.economy as Record<string, unknown>) ?? {}).sort(),
  };
}

describe('grown city round trip', () => {
  it('a 2-year SimBot city survives save/load and keeps simulating identically (±1.5%)', { timeout: 600_000 }, () => {
    const bot = grow(2);
    const orig = bot.st;
    expect(orig.stats.population).toBeGreaterThan(500);
    expect(orig.systemData.economy).toBeTruthy();
    const before = snapshot(orig);

    // IndexedDB path (structured clone) and export-file path (binary bundle)
    const viaClone = deserializeCity(structuredClone(serializeCity(orig, { copy: true })) as SerializedCity);
    const viaFile = deserializeCity(decodeBundle(encodeBundle(serializeCity(orig))) as SerializedCity);

    for (const restored of [viaClone, viaFile]) {
      const s = snapshot(restored);
      expect(s.pop).toBe(before.pop);
      expect(s.buildings).toBe(before.buildings);
      expect(s.funds).toBe(before.funds);
      expect(s.unlocked).toEqual(before.unlocked);
      expect(s.announced).toEqual(before.announced);
      expect(s.milestones).toEqual(before.milestones);
      expect(s.economyKeys).toEqual(before.economyKeys);
      expect(restored.unlocked instanceof Set).toBe(true);
      expect(restored.announced instanceof Set).toBe(true);
    }

    // continue the original and both restored copies for 30 days
    const errors: unknown[] = [];
    // note: system runtime caches (e.g. the traffic assignment) are rebuilt after load and re-converge, so the
    // continuation is close but not bit-identical. The population gap after 30 days is a random walk of single
    // buildings (~100 people at this size) and moves with any change of the headless schedule: B2 fix round
    // (b2work/fix1 grown*.ts, save at the end of year 2 + 0 / 5 / 10 / 15 days and seeds 3 / 5 / 7 / 11 / 13), |gap|
    // at day 30 up to 0.97 % before B2 (this test's seed 11: 0.97 %), 1.07 % at G4, 1.42 % at the fix round (seed 11:
    // 1.19 %), the mean 0.47 / 0.41 / 0.59 %; the exact load behaviour is pinned by the §11.3 tests and b2Pieces R9.
    const run = (st: CityState, sim?: Simulation) => {
      const s = sim ?? new Simulation(st, createSystems());
      try {
        s.runDays(30);
      } catch (e) {
        errors.push(e);
      }
      return st;
    };
    run(orig, bot.sim);
    const a = run(viaClone);
    const b = run(viaFile);
    expect(errors).toEqual([]);
    const p0 = orig.stats.population;
    if (process.env.VERBOSE_SAVE_TEST)
      console.log(
        `grown: pop ${before.pop} bldg ${before.buildings} unlocked ${before.unlocked.length} econ keys ${before.economyKeys.length} systemData ${Object.keys(orig.systemData).join(',')}` +
          ` | after 30d: orig ${p0}, clone ${a.stats.population}, file ${b.stats.population}`,
      );
    for (const st of [a, b]) {
      expect(st.day).toBe(orig.day);
      expect(Math.abs(st.stats.population - p0) / Math.max(1, p0), `pop ${st.stats.population} vs ${p0}`).toBeLessThanOrEqual(0.015);
      expect(Math.abs(st.buildings.size - orig.buildings.size) / Math.max(1, orig.buildings.size)).toBeLessThanOrEqual(0.02);
    }
  });
});
