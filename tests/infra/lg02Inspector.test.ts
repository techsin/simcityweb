/**
 * LG-02 QA round 2, B5 (the facility report and the static facts; text only — the effects are the catalog's CAP_RELIEF,
 * budget.ts' office-tax hook and approval.ts' Crown term, none of them touched):
 *  (a) the Stock Exchange's inspector had no line for its +5 % office tax;
 *  (b) its demand cap read "+55,000 commercial jobs" / "C +55,000", the CO$$$-only +40,000 lumped with the commercial
 *      +15,000, while its description and the Rewards text say "+40,000 CO$$$ cap";
 *  (c) the Metropolis Crown's build card had no fact row for its +3 approval (its inspector had the line).
 * Every other def keeps its text: one commercial figure, no new rows.
 */
import { describe, expect, it } from 'vitest';
import { DEV_TYPE_LABELS, DevType, Network } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { CAP_RELIEF } from '../../src/sim/catalog';
import { computeMonthlyBudget } from '../../src/sim/economy/budget';
import { facilityDefFacts, facilityReport } from '../../src/sim/infra/facilities';
import { newState, place, roadLine } from './cityGen';

const fact = (defId: string, key: string) => facilityDefFacts(defId).find((f) => f.key === key);

describe('LG-02 QA B5: the Stock Exchange and the Crown say what they do', () => {
  it('the exchange\'s inspector: the CO$$$ cap apart, and the office tax while it operates — the budget\'s own 5 %', () => {
    const st = newState(64);
    st.systemData.infraVersion = 1;
    roadLine(st, 2, 20, 61, 20, Network.Road);
    for (let d = DevType.CS1; d <= DevType.IHT; d++) st.stats.jobsByDev[d] = 100000;
    const before = computeMonthlyBudget(st, null).income;
    const ex = place(st, 'lm_stock_exchange', 10, 21, { flags: BF.Plopped | BF.Powered | BF.Watered });
    const sim = new Simulation(st, []);
    const line = (k: string) => facilityReport(sim, ex.id)!.lines.find((l) => l.key === k)!;
    // (b) the figures are the catalog's, each under its own name
    expect(CAP_RELIEF.lm_stock_exchange).toEqual({ C: 15000, CO3: 40000 });
    expect(line('relief').value).toBe('+15,000 commercial jobs, +40,000 CO$$$ office jobs');
    // (a) the row, and the receipts it stands for: CO$$ and CO$$$ only
    expect(line('officeTax')).toEqual({ key: 'officeTax', label: 'Office tax', value: '+5% (CO$$ and CO$$$ receipts)' });
    const open = computeMonthlyBudget(st, null).income;
    for (let d = DevType.CS1; d <= DevType.IHT; d++) {
      const key = 'tax:' + DEV_TYPE_LABELS[d];
      const gain = Math.round((open[key] / before[key] - 1) * 100);
      expect(gain, key).toBe(d === DevType.CO2 || d === DevType.CO3 ? 5 : 0);
    }
    // without power it is closed: no bonus in the budget, and the report says so in both lines
    ex.flags &= ~BF.Powered;
    expect(computeMonthlyBudget(st, null).income).toEqual(before);
    expect(line('officeTax')).toMatchObject({ value: 'none while it has no power', status: 'bad' });
    expect(line('relief').value).toBe('none while it has no power (+15,000 commercial jobs, +40,000 CO$$$ office jobs when working)');
  });

  it('the static facts: the exchange\'s split cap and office tax, the Crown\'s approval; no other def gains a row or a split', () => {
    expect(fact('lm_stock_exchange', 'relief')!.value).toBe('C +15,000 · CO$$$ +40,000');
    expect(fact('lm_stock_exchange', 'officeTax')).toEqual({ key: 'officeTax', label: 'Office tax', value: '+5% (CO$$ and CO$$$ receipts)' });
    expect(fact('lm_metropolis_crown', 'approval')).toEqual({ key: 'approval', label: 'Approval', value: '+3 (civic pride)' });
    expect(fact('lm_metropolis_crown', 'relief')!.value).toBe('R +60,000 · C +80,000');
    // the plop tip takes a def's first two facts: the new rows come after them
    expect(facilityDefFacts('lm_metropolis_crown').map((f) => f.key).slice(0, 4)).toEqual(['prestige', 'tourists', 'relief', 'approval']);
    expect(facilityDefFacts('lm_stock_exchange').map((f) => f.key).slice(0, 4)).toEqual(['prestige', 'tourists', 'relief', 'officeTax']);
    // base content as it was: a sub-type-only relief stays in its family's figure, the approval of the base's civic
    // rewards stays in their description and inspector
    expect(fact('lm_twin_spires', 'relief')!.value).toBe('R +40,000 · C +100,000');
    expect(fact('civ_city_hall', 'relief')!.value).toBe('R +10,000 · C +13,000');
    expect(fact('park_golf', 'relief')!.value).toBe('R +32,000');
    for (const id of ['civ_mayor_house', 'civ_statue', 'civ_city_hall', 'lm_twin_spires', 'lm_millennium_tower', 'lm_central_library']) {
      expect(fact(id, 'approval'), id).toBeUndefined();
      expect(fact(id, 'officeTax'), id).toBeUndefined();
    }
  });

  it('the Crown\'s inspector keeps its approval line (round 1), next to the same words on its card', () => {
    const st = newState(64);
    st.systemData.infraVersion = 1;
    roadLine(st, 2, 20, 61, 20, Network.Road);
    const crown = place(st, 'lm_metropolis_crown', 10, 21, { flags: BF.Plopped | BF.Powered | BF.Watered });
    const rep = facilityReport(new Simulation(st, []), crown.id)!;
    expect(rep.lines.find((l) => l.key === 'approval')).toMatchObject({ label: 'Approval', value: fact('lm_metropolis_crown', 'approval')!.value });
    expect(rep.lines.find((l) => l.key === 'officeTax')).toBeUndefined();
    expect(rep.lines.find((l) => l.key === 'relief')!.value).toBe('+60,000 residents, +80,000 commercial jobs');
  });
});
