/** The guide is saved UI state, outside T057's economy continuity records. */
import { describe, expect, it } from 'vitest';
import { SimBot } from '../../tools/simbot';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { applyCityDelta, encodeCityDelta } from '../../src/save/recoveryCodec';
import { CityActions } from '../../src/sim/actions';
import { CONTINUITY_RECORDS } from '../../src/sim/persist';
import { economySystems } from '../../src/sim/systems/economy';
import { newProgress } from '../../src/ui/guide/progress';
import { SimCore } from '../../src/worker/SimCore';
import { exactDigest } from '../../src/worker/queries';

describe('FH-22 with T057 continuity', () => {
  it('keeps guide progress outside continuity records and continues an economy save bit-exact for 30 days', () => {
    const bot = new SimBot({ size: 32, years: 1, seed: 7, difficulty: 'medium', terrain: 'flat', water: 0,
      quiet: true, noInfra: true }, economySystems());
    bot.run(1);
    const base = serializeCity(bot.st, { copy: true });
    const cores: SimCore[] = [], errors: unknown[] = [];
    const boot = (saved: SerializedCity) => {
      const core = new SimCore(deserializeCity(saved), { report: (...args) => errors.push(args) });
      cores.push(core); core.boot(null, { CityActions, createSystems: economySystems });
      return core;
    };
    const saved = (core: SimCore) => { const out = serializeCity(core.sim.state, { copy: true }); out.savedAt = 0; return out; };
    try {
      const control = boot(base), guided = boot(base);
      const progress = { ...newProgress(90), phase: 'year' as const, started: ['G1' as const] };
      expect(guided.applyCommand({ op: 'setOnboarding', args: [progress] }, guided.actions!)).toBe(true);
      const withGuide = saved(guided), loaded = boot(withGuide);
      expect(loaded.sim.state.systemData.onboarding).toEqual(progress);
      expect(CONTINUITY_RECORDS as readonly string[]).not.toContain('onboarding');
      for (let day = 0; day <= 30; day++) {
        if (day === 10) for (const core of [guided, loaded]) {
          expect(core.applyCommand({ op: 'setOnboarding', args: [{ ...progress, minimised: true }] }, core.actions!)).toBe(true);
        }
        const expected = saved(control), actual = saved(guided), reloaded = saved(loaded);
        expect(reloaded, `reloaded day ${day}`).toEqual(actual);
        expect(exactDigest(loaded.sim.state)).toBe(exactDigest(guided.sim.state));
        const ui = actual.data.systemData as Record<string, unknown>;
        const game = expected.data.systemData as Record<string, unknown>;
        for (const key of CONTINUITY_RECORDS) expect(ui[key], key).toEqual(game[key]);
        delete ui.onboarding;
        expect(actual, `game state day ${day}`).toEqual(expected);
        expect(guided.sim.rng.state).toBe(control.sim.rng.state);
        if (day < 30) for (const core of cores) core.sim.advanceDay();
      }
      const current = saved(guided);
      for (const options of [{ lean: true }, { budget: 1 }]) {
        const back = applyCityDelta(encodeCityDelta(current, withGuide, 1, options), withGuide);
        expect((back.data.systemData as Record<string, unknown>).onboarding).toEqual({ ...progress, minimised: true });
      }
      expect(errors).toEqual([]);
    } finally { for (const core of cores) core.dispose(); }
  });
});
