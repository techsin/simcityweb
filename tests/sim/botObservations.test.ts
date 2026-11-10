/** NOTE-062 collectors read the simulation's stored outputs without changing the competent mayor. */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevType } from '../../src/core/types';
import { serializeCity } from '../../src/save/serialize';
import { APPROVAL } from '../../src/sim/economy/tuning';
import { REWARDS } from '../../src/sim/economy/rewards';
import * as botModule from '../../tools/simbot';
import { runChild } from '../../tools/simAaForkEnvelope.mjs';
import { attachBotObservations, ihtDemandShare } from '../../tools/simBotObservations';

afterEach(() => vi.restoreAllMocks());
const dev = { IA: 0, ID: 1, IM: 2, IHT: 3 };
function host() {
  const st = {
    day: 0, year: 2000, dateLabel: () => 'January 2000',
    stats: { approval: 70, jobsByDev: [40, 10, 20, 30] },
    budget: { ordinances: [] as string[] },
    systemData: { economy: { approvalTerms: { commute: -2 }, resCommute: 16,
      rawTarget: [900, 100, 100, 100], target: [900, 50, 50, 100], demandAbs: [1000, 5, -2, 5] } },
  };
  const monthly = vi.fn();
  const plop = vi.fn(function (this: unknown, _def: string, _x: number, _z: number, _rot: number, _preview?: boolean) {
    return { ok: true, cost: 5, affected: 1 };
  });
  const setOrdinance = vi.fn(function (id: string, enabled: boolean) {
    if (id === 'failed') return { ok: false, cost: 0 };
    if (enabled) { if (!st.budget.ordinances.includes(id)) st.budget.ordinances.push(id); }
    else st.budget.ordinances = st.budget.ordinances.filter((o) => o !== id);
    return { ok: true, cost: 0 };
  });
  const bot = { st, sim: { systems: [{ name: 'economy.approval', monthly }] }, A: { plop, setOrdinance } };
  return { bot, monthly, plop, setOrdinance,
    typed: bot as unknown as Parameters<typeof attachBotObservations>[0] };
}

describe('bot: NOTE-062 read-only observations', () => {
  it('smooths the stored, faded commute term at each approval update, rather than annual or average commute', () => {
    const h = host(), data = h.bot.st.systemData.economy;
    const observed = attachBotObservations(h.typed, dev, { approvalEma: 0.3, rewards: [] });
    expect(observed.annual()).toMatchObject({ commuteTerm: -2, commuteTermRaw: -2, resCommute: 16, approvalNetCommute: 72 });
    let term = -2;
    for (const raw of [-4, -1, 0]) {
      h.monthly.mockImplementation(() => {
        data.approvalTerms.commute = raw;
        const rawApproval = 72 + raw;
        h.bot.st.stats.approval += (rawApproval - h.bot.st.stats.approval) * 0.3;
      });
      h.typed.sim.systems[0].monthly!({} as never);
      term += (raw - term) * 0.3;
      expect(observed.annual()).toMatchObject({ commuteTerm: term, commuteTermRaw: raw });
      expect(observed.annual().approvalNetCommute).toBeCloseTo(72, 12);
    }
    observed.dispose();
    expect(h.bot.sim.systems[0].monthly).toBe(h.monthly);
  });

  it('disposes safely when an optional approval system is absent', () => {
    const h = host();
    h.typed.sim.systems.length = 0;
    const observed = attachBotObservations(h.typed, dev, { approvalEma: 0.3, rewards: [] });
    expect(() => observed.dispose()).not.toThrow();
    expect(h.bot.A.plop).toBe(h.plop);
    expect(h.bot.A.setOrdinance).toBe(h.setOrdinance);
  });

  it('distinguishes raw and capped target stocks from positive incremental I-HT demand, excluding farms', () => {
    const h = host(), before = JSON.parse(JSON.stringify(h.bot.st));
    const observed = attachBotObservations(h.typed, dev, { approvalEma: 0.3, rewards: [] });
    for (const array of [h.bot.st.systemData.economy.rawTarget, h.bot.st.systemData.economy.target, h.bot.st.systemData.economy.demandAbs]) Object.freeze(array);
    expect(observed.annual()).toMatchObject({ ihtDemandShareRaw: 1 / 3, ihtDemandShareCapped: 0.5,
      ihtDemandShare: 0.5, dirtyJobShare: 0.1 });
    expect(observed.annual()).not.toHaveProperty('retooledIM');
    expect(ihtDemandShare([1000, -5, -2, 0], dev, true)).toBe(0);
    expect(ihtDemandShare(undefined, dev, true)).toBeUndefined();
    const after = { ...h.bot.st } as { dateLabel?: unknown };
    delete after.dateLabel;
    expect(after).toEqual(before);
  });

  it('reads the initialized industrial strategy without storing or changing it', () => {
    const h = host(), strategy = Object.freeze({ dirtyShare: 0.125, retooledIM: 27, retooledIHT: 3 });
    const getter = vi.fn(() => strategy);
    const observed = attachBotObservations(h.typed, dev, { approvalEma: 0.3, rewards: [], industrialStrategy: getter });
    expect(observed.annual()).toMatchObject({ dirtyJobShare: 0.125, retooledIM: 27, retooledIHT: 3 });
    expect(getter).toHaveBeenCalledExactlyOnceWith(h.bot.st);
    expect(h.bot.st.systemData.economy).not.toHaveProperty('industry');
  });

  it('dates successful reward purchases and enacted ordinances, retaining receivers, results and approval gates', () => {
    const h = host();
    const observed = attachBotObservations(h.typed, dev, { approvalEma: 0.3,
      rewards: [{ id: 'statue', kind: 'reward', defIds: ['civ_statue'], conds: [{ label: 'Approval', need: 65 }] }] });
    const preview = h.bot.A.plop('civ_statue', 3, 4, 0, true);
    const built = h.bot.A.plop('civ_statue', 3, 4, 0);
    expect(preview).toBe(h.plop.mock.results[0].value);
    expect(built).toBe(h.plop.mock.results[1].value);
    expect(h.plop.mock.contexts).toEqual([h.bot.A, h.bot.A]);
    h.bot.A.setOrdinance('parking_fines', true);
    h.bot.A.setOrdinance('parking_fines', true);
    h.bot.A.setOrdinance('failed', true);
    h.bot.A.setOrdinance('parking_fines', false);
    expect(observed.approvalActions).toEqual([
      { day: 0, date: 'January 2000', year: 2000, approval: 70, action: 'rewardBought', id: 'statue', defId: 'civ_statue', approvalThreshold: 65, approvalGate: 'unlock' },
      { day: 0, date: 'January 2000', year: 2000, approval: 70, action: 'ordinanceEnacted', id: 'parking_fines', approvalThreshold: 55, approvalGate: 'bot' },
    ]);
    observed.dispose();
    expect(h.bot.A.plop).toBe(h.plop);
    expect(h.bot.A.setOrdinance).toBe(h.setOrdinance);
  });

  it('keeps default annual rows, successful actions, bot decisions and serialized state hashes identical with collectors on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'metropolis-observations-'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const play = async (name: string, enabled: boolean) => {
        const stem = join(dir, name), specPath = `${stem}.spec.json`;
        writeFileSync(specPath, JSON.stringify({ size: 64, years: 1, seed: 7, nudge: 0, day: 1, id: name,
          jsonPath: `${stem}.json`, annualPath: `${stem}.ndjson`, actionPath: `${stem}.actions.ndjson`, logPath: `${stem}.log` }), 'utf8');
        await runChild(botModule, DevType, serializeCity, specPath, enabled ? { approvalEma: APPROVAL.ema, rewards: REWARDS } : undefined);
        return JSON.parse(readFileSync(`${stem}.json`, 'utf8'));
      };
      const base = await play('off', false), observed = await play('on', true);
      expect(observed.actions).toEqual(base.actions);
      expect(observed.log).toEqual(base.log);
      expect(observed.rows.map(({ yearIndex, year, population, air, approval, ihtShare, funds, residents, jobsByDev, botRow, stateHash }: Record<string, unknown>) =>
        ({ yearIndex, year, population, air, approval, ihtShare, funds, residents, jobsByDev, botRow, stateHash }))).toEqual(base.rows);
      expect(observed.rows[0]).toHaveProperty('approvalNetCommute');
      expect(observed.rows[0].commuteTerm).toBe(0);
      expect(observed.approvalActions).toBeInstanceOf(Array);
      expect(createHash('sha256').update(JSON.stringify(observed.rows.map((r: { stateHash: string }) => r.stateHash))).digest('hex'))
        .toBe(createHash('sha256').update(JSON.stringify(base.rows.map((r: { stateHash: string }) => r.stateHash))).digest('hex'));
    } finally {
      if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error('unexpected test output path');
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
