/**
 * LG-14: the scenarios' reference runs (tools/scenarios.ts), judged by the game's own evaluateScenario.
 * The acceptance: every scenario has a bot strategy that reaches bronze and a do-nothing run that fails; in Lights Out
 * a run that only buys one replacement plant earns at most bronze, although without the start-money limit it would
 * earn gold.
 *
 * The runs of a year or so play here (Lights Out's, Smog City's clean-up). The ten-year runs (Boomtown's bot and
 * empty land, Smog City left alone) take about a minute together: SCENARIOS=1 plays them, as does
 * `npx tsx tools/scenarios.ts --verify`. One run goes beyond the acceptance: Lights Out's budget squeeze, which shows
 * that gold (no new loan) is in reach under the start-money limit.
 *
 * Also: a scenario city with the same actions plays out the same, and judging it changes nothing in it (the checks
 * draw no random number and write nothing); Boomtown's land is the land the bundled cities stand on.
 */
import { describe, expect, it } from 'vitest';
import { BOOMTOWN, LIGHTS_OUT, boomtownConfig, evaluateScenario, medalRank } from '../../src/game/scenarios';
import { defaultCityConfig } from '../../src/sim/config';
import { economySystems } from '../../src/sim/systems/economy';
import { createCityState } from '../../src/sim/terrainGen';
import { exactDigest } from '../../src/worker/queries';
import {
  SCENARIO_BOT, cleanUpMayor, openBundle, outcome, playScenario, readBundle, rebuildPlant, referenceRuns, type ReferenceRun, type ScenarioCity,
} from '../../tools/scenarios';
import { SimBot } from '../../tools/simbot';

const LONG = process.env.SCENARIOS === '1';
const runs = referenceRuns();
const run = (id: string, name: string): ReferenceRun => runs.find((r) => r.id === id && r.name === name)!;

describe('LG-14: reference runs', () => {
  it('every scenario has a bot strategy that must reach bronze and a do-nothing run that must fail', () => {
    for (const id of ['boomtown', 'lights_out', 'smog_city']) {
      const mine = runs.filter((r) => r.id === id);
      expect(mine.some((r) => r.name === 'nothing' && r.expect === 'fails'), id).toBe(true);
      expect(mine.some((r) => r.name !== 'nothing' && r.expect === 'bronze or better'), id).toBe(true);
    }
    expect(run('lights_out', 'one plant').expect).toBe('bronze at most');
    expect(run('lights_out', 'no limit').expect).toBe('gold');
    // the ten-year runs are the ones this file leaves to SCENARIOS=1
    expect(runs.filter((r) => r.years >= 10).map((r) => `${r.id} ${r.name}`)).toEqual(['boomtown bot', 'boomtown nothing', 'smog_city nothing']);
  });

  describe('Lights Out', () => {
    it('doing nothing fails: the city empties and the year runs out', { timeout: 300_000 }, () => {
      const s = run('lights_out', 'nothing').play();
      expect(outcome(s)).toBe('lost after 12 months');
      expect(s.newLoan).toBe(false);
    });

    it('a loan and the same plant again on day one reaches bronze (silver: the loan costs gold)', { timeout: 300_000 }, () => {
      const r = run('lights_out', 'loan'), s = r.play();
      expect(r.ok(s)).toBe(true);
      expect(s).toMatchObject({ phase: 'won', medal: 'silver', newLoan: true });
      expect(s.result!.month).toBeLessThanOrEqual(6);
    });

    it('a run that only buys one replacement plant earns at most bronze: the bank never holds its price', { timeout: 300_000 }, () => {
      const r = run('lights_out', 'one plant'), s = r.play();
      expect(r.ok(s)).toBe(true);
      expect(medalRank(s.phase === 'won' ? s.medal : null)).toBeLessThanOrEqual(medalRank('bronze'));
      expect(s.newLoan).toBe(false);
    });

    it('without the start-money limit the same run earns gold', { timeout: 300_000 }, () => {
      const s = run('lights_out', 'no limit').play();
      expect(s).toMatchObject({ phase: 'won', medal: 'gold', newLoan: false });
    });

    it('gold is in reach under the limit: no loan, a budget squeeze until the bank can pay for the plant', { timeout: 300_000 }, () => {
      const r = run('lights_out', 'squeeze'), s = r.play();
      expect(r.ok(s)).toBe(true);
      expect(s).toMatchObject({ phase: 'won', medal: 'gold', newLoan: false });
      // the city went dark first and came back: not the month-1 recovery of a plant bought on day one
      expect(s.result!.month).toBeGreaterThan(1);
      expect(s.result!.month).toBeLessThanOrEqual(LIGHTS_OUT.months.gold);
    });
  });

  describe('Smog City', () => {
    it('the clean-up mayor reaches bronze or better, with the city still above its floor', { timeout: 600_000 }, () => {
      const r = run('smog_city', 'clean-up'), s = r.play();
      expect(r.ok(s)).toBe(true);
      expect(s.phase).toBe('won');
      expect(s.lines.every((l) => l.done)).toBe(true);
    });

    it.skipIf(!LONG)('left alone for ten years it fails: the air only gets worse', { timeout: 900_000 }, () => {
      const s = run('smog_city', 'nothing').play();
      expect(outcome(s)).toBe('lost after 120 months');
    });
  });

  describe('Boomtown', () => {
    it.skipIf(!LONG)('the default bot reaches bronze by year 10', { timeout: 900_000 }, () => {
      const r = run('boomtown', 'bot'), s = r.play();
      expect(r.ok(s)).toBe(true);
      expect(s.result!.month).toBeLessThanOrEqual(BOOMTOWN.months);
    });

    it.skipIf(!LONG)('empty land for ten years fails', { timeout: 900_000 }, () => {
      expect(outcome(run('boomtown', 'nothing').play())).toBe('lost after 120 months');
    });

    it('is founded on the land the bundled cities were built on (the bot\'s map)', () => {
      const bot = new SimBot(SCENARIO_BOT, economySystems()).st;
      const mine = createCityState(defaultCityConfig(boomtownConfig()));
      expect(mine.size).toBe(bot.size);
      for (const layer of ['heights', 'water', 'trees'] as const) expect(Buffer.from(mine[layer].buffer).equals(Buffer.from(bot[layer].buffer)), layer).toBe(true);
      // and the Smog City bundle stands on it
      const smog = openBundle(readBundle('smog_city')).st;
      expect(Buffer.from(smog.water.buffer).equals(Buffer.from(bot.water.buffer))).toBe(true);
    });
  });
});

describe('LG-14: a scenario city is deterministic, and judging it leaves it alone', () => {
  /** Lights Out with the loan-and-rebuild mayor for `months` months; `judge`: evaluate every month, as the card does */
  function play(months: number, judge: boolean): ScenarioCity {
    const city = openBundle(readBundle('lights_out'));
    city.A.takeLoan(13_000);
    expect(rebuildPlant(city)).toBe(true);
    for (let m = 0; m < months; m++) {
      city.sim.runDays(30);
      if (judge) for (let k = 0; k < 3; k++) evaluateScenario(city.start, city.st, {});
    }
    return city;
  }

  it('the same seed and actions give the same city, with or without the objective checks', { timeout: 300_000 }, () => {
    const a = play(3, true), b = play(3, true), c = play(3, false);
    expect(exactDigest(b.st)).toBe(exactDigest(a.st));
    expect(exactDigest(c.st)).toBe(exactDigest(a.st));
    expect(c.st.systemData.simRng).toBe(a.st.systemData.simRng);
    expect(c.st.funds).toBe(a.st.funds);
    expect(evaluateScenario(c.start, c.st)).toEqual(evaluateScenario(a.start, a.st));
  });

  it('the clean-up mayor is a function of the city: two runs agree month by month', { timeout: 600_000 }, () => {
    const months = (): string[] => {
      const out: string[] = [];
      const city = openBundle(readBundle('smog_city'));
      const mayor = cleanUpMayor();
      for (let m = 0; m < 3; m++) {
        mayor(m, city);
        city.sim.runDays(30);
        out.push(`${city.st.stats.population}|${Math.round(city.st.funds)}|${city.st.history.air.at(-1)}`);
      }
      return out;
    };
    expect(months()).toEqual(months());
  });
});

describe('LG-14: playScenario judges month by month like the card', () => {
  it('stops at the month the outcome is decided and remembers a loan', { timeout: 300_000 }, () => {
    const city = openBundle(readBundle('lights_out'));
    const seen: number[] = [];
    const s = playScenario(city, (month, c) => {
      seen.push(month);
      // two dark months, then a loan and the plant: the recovery comes later and, with the loan, is silver at best
      if (month === 2) expect(c.A.takeLoan(30_000).ok && rebuildPlant(c)).toBe(true);
    });
    expect(seen[0]).toBe(0);
    expect(seen).toEqual(seen.map((_, k) => k));
    expect(s.phase).toBe('won');
    expect(s.newLoan).toBe(true);
    expect(s.medal).not.toBe('gold');
    expect(s.result!.month).toBe(seen.length);
  });
});
