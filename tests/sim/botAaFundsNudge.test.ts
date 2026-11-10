/** NOTE-048: a neutral funds perturbation; flags off keep the competent mayor's path. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimBot, USAGE, botSystems, parseArgs, type BotOptions } from '../../tools/simbot';
import { serializeCity } from '../../src/save/serialize';

afterEach(() => vi.restoreAllMocks());

const opts: BotOptions = { size: 64, years: 1, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: true, noInfra: false };
function snapshot(b: SimBot) {
  const s = serializeCity(b.st, { copy: true });
  s.savedAt = 0;
  return s;
}

describe('bot: A/A funds nudge', () => {
  it('is absent by default and parses finite signed amounts without consuming the next flag', () => {
    expect(parseArgs([])).not.toHaveProperty('aaFundsNudge');
    expect(parseArgs(['--aa-funds-nudge', '1', '--quiet'])).toMatchObject({ aaFundsNudge: 1, quiet: true });
    expect(parseArgs(['--aa-funds-nudge=-2.5', '--neglect'])).toMatchObject({ aaFundsNudge: -2.5, neglect: true });
    expect(parseArgs(['--aa-funds-nudge', '0']).aaFundsNudge).toBe(0);
    expect(USAGE).toContain('--aa-funds-nudge N');
  });

  it.each(['--aa-funds-nudge', '--aa-funds-nudge=', '--aa-funds-nudge=NaN', '--aa-funds-nudge=Infinity', '--aa-funds-nudge=-Infinity'])('rejects invalid amounts: %s', (arg) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    expect(() => parseArgs([arg])).toThrow('exit');
    expect(err).toHaveBeenCalledWith('simbot: --aa-funds-nudge must be a finite amount');
  });

  it.each([1, -2.5, 0])('changes only funds by %s on day 1, never setup or a later day, without drawing RNG', (amount) => {
    const b = new SimBot({ ...opts, aaFundsNudge: amount }, []);
    vi.spyOn(b, 'setup').mockImplementation(() => {});
    vi.spyOn(b, 'monthly').mockImplementation(() => {});
    const initial = snapshot(b), funds = b.st.funds;
    const rng = vi.spyOn(b.sim.rng, 'next');
    let calls = 0;
    vi.spyOn(b, 'daily').mockImplementation(() => {
      calls++;
      expect(b.st.funds).toBe(funds + amount);
      if (b.st.day === 1) {
        const expected = structuredClone(initial);
        expected.scalars.day = 1;
        expected.scalars.funds = funds + amount;
        expect(snapshot(b)).toEqual(expected);
      }
    });
    b.run(1);
    b.run(1);
    expect(calls).toBe(720);
    expect(b.st.day).toBe(720);
    expect(b.st.funds).toBe(funds + amount);
    expect(rng).not.toHaveBeenCalled();
  });

  it('keeps real setup and the first simulated day identical apart from the funds scalar', async () => {
    const base = new SimBot(opts, await botSystems(false));
    const nudged = new SimBot({ ...opts, aaFundsNudge: 1 }, await botSystems(false));
    const stop = new Error('after day 1');
    const first = (b: SimBot) => {
      vi.spyOn(b, 'daily').mockImplementation(() => { throw stop; });
      expect(() => b.run(1)).toThrow(stop);
      return snapshot(b);
    };
    expect(snapshot(nudged)).toEqual(snapshot(base));
    const a = first(base), b = first(nudged);
    expect(b.scalars.day).toBe(1);
    expect(b.scalars.funds).toBe((a.scalars.funds as number) + 1);
    b.scalars.funds = a.scalars.funds;
    expect(b).toEqual(a);
    expect(nudged.sim.rng.state).toBe(base.sim.rng.state);
  });

  it('keeps every annual non-timing field and saved state identical with the flag omitted or explicitly zero', async () => {
    const play = async (extra: Partial<BotOptions>) => {
      const b = new SimBot({ ...opts, ...extra }, await botSystems(false));
      b.run(1);
      return { state: snapshot(b), rows: b.rows.map(({ econMsPerDay, totalMsPerDay, ...r }) => r) };
    };
    expect(await play({ aaFundsNudge: 0 })).toEqual(await play({}));
  });
});
