/** NEW-05: fixed-tax sweeps can begin after the competent mayor's normal early game. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimBot, USAGE, parseArgs, type BotOptions } from '../../tools/simbot';

afterEach(() => vi.restoreAllMocks());

function bot(opts: Partial<BotOptions> = {}) {
  return new SimBot({ size: 96, years: 30, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0,
    quiet: true, noInfra: true, ...opts }, []);
}

function rejects(args: string[], message: RegExp) {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  expect(() => parseArgs(args)).toThrow('exit');
  expect(err).toHaveBeenCalledWith(expect.stringMatching(message));
}

describe('bot: delayed fixed taxes', () => {
  it('parses both start-year forms without consuming the next flag and documents the day boundary', () => {
    expect(parseArgs(['--years', '30', '--tax=12', '--tax-start-year', '21', '--quiet'])).toMatchObject({
      tax: 12, taxStartYear: 21, years: 30, quiet: true,
    });
    expect(parseArgs(['--tax-start-year=21', '--tax', '12', '--venues'])).toMatchObject({
      tax: 12, taxStartYear: 21, venues: true,
    });
    expect(parseArgs(['--tax=12', '--tax-start-year=1']).taxStartYear).toBe(1);
    expect(parseArgs(['--tax=12']).taxStartYear).toBeUndefined();
    expect(parseArgs([]).taxStartYear).toBeUndefined();
    expect(USAGE).toContain('--tax-start-year N');
    expect(USAGE).toContain('year 21 starts on day 7200');
  });

  it.each(['--tax-start-year=', '--tax-start-year=NaN', '--tax-start-year=Infinity', '--tax-start-year=0',
    '--tax-start-year=-1', '--tax-start-year=1.5', '--tax-start-year=9007199254740992', '--tax-start-year'])('rejects invalid start years: %s', (arg) => {
    rejects(['--tax=12', arg], /positive integer/);
  });

  it('requires a tax and a start year within the run', () => {
    rejects(['--tax-start-year=21'], /needs --tax=N and a year of this run/);
    rejects(['--years', '20', '--tax=12', '--tax-start-year=21'], /1\.\.20/);
  });

  it('keeps the newcomer profile on its own tax rules', () => {
    rejects(['--profile', 'newcomer', '--tax-start-year=1'], /newcomer has its own/);
  });

  it('uses normal tax management before year 21, then fixes every rate through deficits and surpluses', () => {
    const b = bot({ tax: 12, taxStartYear: 21 });
    const base = bot();
    b.setup(); base.setup();
    expect(b.st.budget.taxRates).toEqual(base.st.budget.taxRates);
    for (const mayor of [b, base]) {
      mayor.st.day = 7199;
      mayor.st.funds = 10000;
      mayor.st.stats.population = 25000;
      mayor.st.budget.lastIncome = {};
      mayor.st.budget.lastExpense = { 'service:police': 1000 };
      mayor.finance();
    }
    expect(b.st.budget.taxRates).toEqual(Array(12).fill(9.5));
    expect(b.st.budget.taxRates).toEqual(base.st.budget.taxRates);
    b.st.day = 7200;
    for (const income of [0, 1e6]) {
      b.st.budget.taxRates.fill(7);
      b.st.budget.lastIncome = { 'tax:R$': income };
      b.finance();
      expect(b.st.budget.taxRates).toEqual(Array(12).fill(12));
    }
  });

  it('sets all rates at day 7200 before advancing the first day of year 21, without RNG draws', () => {
    const b = bot({ tax: 12, taxStartYear: 21 });
    vi.spyOn(b, 'setup').mockImplementation(() => { b.st.day = 7199; });
    vi.spyOn(b, 'daily').mockImplementation(() => {});
    vi.spyOn(b, 'monthly').mockImplementation(() => {});
    const seen: { day: number; rates: number[] }[] = [];
    vi.spyOn(b.sim, 'advanceDay').mockImplementation(() => {
      if (seen.length < 3) seen.push({ day: b.st.day, rates: [...b.st.budget.taxRates] });
      b.st.day++;
    });
    const rng = vi.spyOn(b.sim.rng, 'next');
    b.run(1);
    expect(seen).toEqual([
      { day: 7199, rates: Array(12).fill(9) },
      { day: 7200, rates: Array(12).fill(12) },
      { day: 7201, rates: Array(12).fill(12) },
    ]);
    expect(rng).not.toHaveBeenCalled();
  });

  it.each([undefined, 1])('preserves fixed taxes from setup when the start year is %s', (taxStartYear) => {
    const b = bot({ tax: 12, taxStartYear });
    b.setup();
    expect(b.st.day).toBe(0);
    expect(b.st.budget.taxRates).toEqual(Array(12).fill(12));
    b.st.budget.lastExpense = { 'service:police': 1000 };
    b.finance();
    expect(b.st.budget.taxRates).toEqual(Array(12).fill(12));
  });
});
