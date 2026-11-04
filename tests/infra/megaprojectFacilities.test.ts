/** LG-03 project facts and inspector reports use the real definitions, ledger and effect hooks. */
import { describe, expect, it } from 'vitest';
import { BF } from '../../src/sim/CityState';
import { DAYS_PER_MONTH } from '../../src/core/constants';
import { getDef } from '../../src/sim/catalog';
import { projectProgress, projectsSystem } from '../../src/sim/economy/projects';
import { budgetSystem } from '../../src/sim/economy/budget';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { facilityDefFacts, facilityReport } from '../../src/sim/infra/facilities';
import { EXPRESS_STOP_CAP_SUBWAY, EXPRESS_WAIT_SUBWAY } from '../../src/sim/infra/params';
import { makeCity } from '../sim/helpers';

const IDS = ['tr_express_metro', 'util_fusion_plant', 'lm_world_expo'] as const;

function start(id: typeof IDS[number]) {
  const c = makeCity({ difficulty: 'sandbox' }, [projectsSystem(), budgetSystem(new EconRuntime())]);
  expect(c.A.startProject(id, 4, 4, 0).ok).toBe(true);
  const p = projectProgress(c.st, c.st.buildingAt(4, 4)!.id)!;
  return { ...c, p, b: c.st.buildings.get(p.buildingId)! };
}

function complete(c: ReturnType<typeof start>) {
  c.sim.runDays(getDef(c.b.def)!.buildMonths! * DAYS_PER_MONTH);
  expect(c.p.completedDay).toBe(c.st.day);
  expect(c.p.paid).toBe(c.p.totalCost);
  expect(c.b.built).toBe(1);
}

describe('mega-project facility facts', () => {
  it('explains construction, real unlock gates and implemented effects for all three production definitions', () => {
    for (const id of IDS) {
      const def = getDef(id)!;
      const facts = facilityDefFacts(id);
      expect(facts.find((f) => f.key === 'construction')!.value).toContain(`${def.buildMonths} months`);
      expect(facts.find((f) => f.key === 'projectGate')!.value).toContain(def.project!.population.toLocaleString('en-US'));
    }
    const metro = facilityDefFacts('tr_express_metro');
    expect(metro.find((f) => f.key === 'projectGate')!.value).toContain('6 completed subway stations');
    expect(metro.find((f) => f.key === 'subwayTime')!.value).toBe('−30% citywide');
    expect(metro.find((f) => f.key === 'subwayWait')!.value).toBe(`${EXPRESS_WAIT_SUBWAY} min`);
    expect(metro.find((f) => f.key === 'subwayCapacity')!.value).toContain(EXPRESS_STOP_CAP_SUBWAY.toLocaleString('en-US'));
    expect(facilityDefFacts('util_fusion_plant').find((f) => f.key === 'output')!.value).toBe('4,000 MW');
    const expo = facilityDefFacts('lm_world_expo');
    expect(expo.find((f) => f.key === 'exhibition')!.value).toContain('12 months');
    expect(expo.some((f) => f.key === 'approval' || f.key === 'prestige')).toBe(false);
  });
});

describe('mega-project facility reports', () => {
  it.each(IDS)('%s reports exact ledger progress and pause without premature operating effects', (id) => {
    const c = start(id);
    c.st.config.difficulty = 'medium';
    c.st.config.sandbox = false;
    c.st.funds = 0;
    c.sim.runDays(DAYS_PER_MONTH);
    expect(c.p.paused).toBe(true);
    const before = structuredClone(c.st.systemData.projects);
    const rep = facilityReport(c.sim, c.b.id)!;
    expect(rep.title).toBe(getDef(id)!.name);
    expect(rep.role).toBeTruthy();
    expect(rep.lines.find((l) => l.key === 'construction')).toMatchObject({ value: `30 / ${c.p.totalDays} days`, ratio: 30 / c.p.totalDays });
    expect(rep.lines.find((l) => l.key === 'paid')!.value).toContain(c.p.paid.toLocaleString('en-US'));
    expect(rep.lines.find((l) => l.key === 'operation')!.value).toBe('Start on opening');
    expect(rep.lines.some((l) => ['output', 'jobs', 'staff', 'upkeep', 'subwayTime', 'expoDraw'].includes(l.key))).toBe(false);
    expect(rep.warnings).toContain('Under construction');
    expect(rep.warnings.some((w) => w.startsWith('Paused: needs '))).toBe(true);
    expect(c.st.systemData.projects).toEqual(before);
  });

  it('does not quote operating upkeep for a ruined Fusion construction site', () => {
    const c = start('util_fusion_plant');
    c.b.flags |= BF.Burnt;
    const rep = facilityReport(c.sim, c.b.id)!;
    expect(rep.lines.find((l) => l.key === 'status')!.value).toContain('in ruins');
    expect(rep.lines.some((l) => l.key === 'upkeep' || l.key === 'output')).toBe(false);
  });

  it('does not promise that a completed ruined Expo can be commissioned again', () => {
    const c = start('lm_world_expo');
    complete(c);
    c.b.flags |= BF.Burnt;
    const rep = facilityReport(c.sim, c.b.id)!;
    expect(rep.warnings).toContain('In ruins — this once-per-city exhibition cannot be rebuilt');
    expect(rep.lines.find((l) => l.key === 'status')!.value).toBe('in ruins — no active exhibition');
    expect(rep.lines.some((l) => l.key === 'expoDraw')).toBe(false);
    expect(c.A.startProject('lm_world_expo', 20, 20, 0).ok).toBe(false);
  });

  it('shows the Metro upgrade only while its completed building supplies the real effect', () => {
    const c = start('tr_express_metro');
    complete(c);
    const rep = facilityReport(c.sim, c.b.id)!;
    expect(rep.lines.find((l) => l.key === 'metro')!.value).toBe('active citywide');
    expect(rep.lines.find((l) => l.key === 'subwayTime')!.value).toBe('−30% citywide');
    c.b.flags |= BF.Abandoned;
    const closed = facilityReport(c.sim, c.b.id)!;
    expect(closed.lines.find((l) => l.key === 'metro')!.value).toBe('inactive');
    expect(closed.lines.some((l) => l.key === 'subwayTime')).toBe(false);
  });

  it('reports the Expo draw window through its last active day and its exact expiry', () => {
    const c = start('lm_world_expo');
    complete(c);
    c.st.day = 1079;
    const active = facilityReport(c.sim, c.b.id)!;
    expect(active.role).toContain('citywide tourist draw');
    expect(active.role).not.toMatch(/prestige|wealthy/);
    expect(active.lines.find((l) => l.key === 'expoDraw')!.value).toBe('×1.5');
    expect(active.lines.find((l) => l.key === 'expoRemaining')!.value).toBe('1 day');
    c.st.day++;
    const expired = facilityReport(c.sim, c.b.id)!;
    expect(expired.lines.find((l) => l.key === 'expoDraw')!.value).toBe('exhibition ended');
    expect(expired.lines.some((l) => l.key === 'expoRemaining' || l.key === 'approval')).toBe(false);
  });
});
