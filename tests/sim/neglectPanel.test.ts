/** LG-06: the Statistics row reports settled rebuilding and the current safety multiplier from mirrored state. */
import { describe, expect, it } from 'vitest';
import type { GameContext } from '../../src/game/context';
import type { CityState } from '../../src/sim/CityState';
import { EmergenciesPanel } from '../../src/ui/panels/EmergenciesPanel';
import { installFakeDom } from '../game/fakeDom';
import { newState } from '../infra/cityGen';

installFakeDom();

function panelFor(st: CityState) {
  const abort = new AbortController();
  const ctx = {
    get state() { return st; },
    get sim() { throw new Error('The panel must read mirrored state'); },
    host: { emergency: { active: true } }, signal: abort.signal,
  } as unknown as GameContext;
  const panel = new EmergenciesPanel(ctx);
  panel.mount(() => {}, () => {}, () => {});
  panel.showTab('stats');
  return { panel, close: () => { panel.onClose(); abort.abort('dispose'); } };
}

describe('neglect: Emergencies panel cost row', () => {
  it('shows unanswered settled rebuild costs and a whole-percent current migration cut', () => {
    const st = newState(16);
    st.stats.emergency.year.rebuildCost = 30_000;
    st.stats.emergency.year.unansweredRebuildCost = 8_400;
    st.stats.emergency.month.unansweredRebuildCost = 2_000;
    st.systemData.economy = { migration: [1, 1, 1], rawTarget: [1_000, 2_000, 1_000], safetyMigrationLoss: [0.02, 0.04, 0.08] };
    const before = structuredClone({ stats: st.stats, economy: st.systemData.economy });
    const { panel, close } = panelFor(st);
    try {
      expect(panel.body.textContent).toContain('Cost of unanswered emergencies this year: §8,400 rebuild; the safety record is cutting newcomers by 4 %');
      expect(panel.body.textContent).not.toContain('fewer newcomers');
      expect({ stats: st.stats, economy: st.systemData.economy }).toEqual(before);
    } finally { close(); }
  });

  it('hides the percentage for an old save or a cut that rounds to zero', () => {
    const st = newState(16);
    delete st.stats.emergency.year.unansweredRebuildCost;
    delete st.systemData.economy;
    const { panel, close } = panelFor(st);
    try {
      expect(panel.body.textContent).toContain('Cost of unanswered emergencies this year: §0 rebuild');
      expect(panel.body.textContent).not.toContain('cutting newcomers');
      st.systemData.economy = { migration: [1, 1, 1], rawTarget: [1_000, 1_000, 1_000], safetyMigrationLoss: [0.004, 0.004, 0.004] };
      panel.update();
      expect(panel.body.textContent).not.toContain('cutting newcomers');
    } finally { close(); }
  });

  it('refreshes when the safety multiplier changes without an emergency-stat change', () => {
    const st = newState(16);
    st.systemData.economy = { migration: [1, 1, 1], rawTarget: [1_000, 1_000, 1_000], safetyMigrationLoss: [0, 0, 0] };
    const emergency = structuredClone(st.stats.emergency);
    const { panel, close } = panelFor(st);
    try {
      expect(panel.body.textContent).not.toContain('cutting newcomers');
      st.systemData.economy = { migration: [1, 1, 1], rawTarget: [1_000, 1_000, 1_000], safetyMigrationLoss: [0.006, 0.006, 0.006] };
      panel.update();
      expect(panel.body.textContent).toContain('the safety record is cutting newcomers by 1 %');
      expect(st.stats.emergency).toEqual(emergency);
      st.systemData.economy = { migration: [1, 1, 1], rawTarget: [1_000, 1_000, 1_000], safetyMigrationLoss: [0, 0, 0] };
      panel.update();
      expect(panel.body.textContent).not.toContain('cutting newcomers');
    } finally { close(); }
  });
});
