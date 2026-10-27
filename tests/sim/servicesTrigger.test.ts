/** B1 / PI-5a: services invalidation, urgent feedback, live throttling and deterministic headless scheduling. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BF, type Building } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { CityActions } from '../../src/sim/actions';
import { CATALOG, getDef, rebuildCatalogIndex } from '../../src/sim/catalog';
import { econData } from '../../src/sim/economy/runtime';
import { clearInfoCache } from '../../src/sim/infra/common';
import { facilityOpFactor } from '../../src/sim/infra/facilities';
import { JusticeSystem, justiceData, justiceFactors } from '../../src/sim/infra/justice';
import { schedulerOf } from '../../src/sim/infra/scheduler';
import { SERVICES_DIRTY_DAYS, SERVICES_MIN_CYCLE_MS, SERVICES_PERIOD, SERVICES_STAFF_DELTA, ServicesSystem } from '../../src/sim/infra/services';
import { createSystems } from '../../src/sim/systems';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { newState, place, roadLine } from '../infra/cityGen';

function city(withJustice = false) {
  const st = newState(32);
  for (const [src, id] of [['civ_elementary_school', 'b1_school'], ['civ_clinic', 'b1_clinic'], ['civ_police_station', 'b1_police']] as const) {
    if (!getDef(id)) CATALOG.push({ ...getDef(src)!, id, footprint: [1, 1], jobs: 100 });
  }
  rebuildCatalogIndex();
  clearInfoCache();
  st.config.sandbox = true;
  roadLine(st, 2, 10, 28, 10);
  const opts = { flags: BF.Plopped | BF.Powered | BF.Watered, jobs: 100, hire: 1 };
  const school = place(st, 'b1_school', 8, 9, opts);
  const clinic = place(st, 'b1_clinic', 10, 9, opts);
  const police = place(st, 'b1_police', 12, 9, opts);
  place(st, 't_r1', 10, 11, { pop: 100, capacity: 100 });
  st.stats.population = 100;
  st.budget.funding.education = st.budget.funding.health = st.budget.funding.police = 50;
  justiceData(st).cityFill = 1;
  const services = new ServicesSystem();
  const sim = new Simulation(st, withJustice ? [services, new JusticeSystem()] : [services]);
  const scheduler = schedulerOf(sim);
  const task = scheduler.tasks.find((t) => t.name === 'services')!;
  return { st, sim, services, scheduler, task, school, clinic, police, A: new CityActions(sim), at: st.idx(10, 11) };
}
type City = ReturnType<typeof city>;

// N = 2: an eventless staffing / water change needs one end-of-day observation, then the next day's urgent pass.
// This 32² fixture's cached pass takes at most six steps, within the scheduler's eight urgent steps per day.
// A month-boundary access refresh can use both days. Latency checks never flush / compute past the scheduler;
// larger cities still spread their work over steps.
const LATENCY_DAYS = 2;
function withinLatency(c: City, changed: () => boolean): void {
  expect(changed()).toBe(false);
  for (let d = 0; d < LATENCY_DAYS && !changed(); d++) c.sim.advanceDay();
  expect(changed()).toBe(true);
}

afterEach(() => vi.restoreAllMocks());

describe('services: relevant building inputs', () => {
  it('ignores Congested and other unrelated flags, retaining the 15-day periodic pass', () => {
    const c = city();
    const passes: number[] = [];
    c.sim.events.on('layerUpdated', (layer) => { if (layer === 'services') passes.push(c.st.day); });
    for (let d = 0; d < SERVICES_PERIOD - 1; d++) {
      c.school.flags ^= BF.Congested | BF.Historic | BF.Polluted | BF.Understaffed;
      c.sim.events.emit('buildingChanged', c.school);
      c.sim.advanceDay();
      expect(c.task.due(c.sim)).toBe(false);
      expect(c.task.urgent(c.sim)).toBe(false);
    }
    expect(passes).toEqual([]);
    c.sim.advanceDay();
    c.scheduler.flush(c.sim);
    expect(passes).toEqual([SERVICES_PERIOD]);
  });

  it.each<[string, (b: Building) => void]>([
    ['definition', (b) => { b.def = 'b1_clinic'; }],
    ['power', (b) => { b.flags ^= BF.Powered; }],
    ['construction completion', (b) => { b.built = 0.5; }],
    ['burnt', (b) => { b.flags ^= BF.Burnt; }],
    ['abandoned', (b) => { b.flags ^= BF.Abandoned; }],
  ])('dirties services on a %s change in either direction', (_name, change) => {
    const c = city();
    const before = { ...c.school };
    c.st.day = SERVICES_DIRTY_DAYS;
    change(c.school);
    c.sim.events.emit('buildingChanged', c.school);
    expect(c.task.due(c.sim)).toBe(true);
    c.scheduler.flush(c.sim);
    expect(c.task.due(c.sim)).toBe(false);
    Object.assign(c.school, before);
    c.sim.events.emit('buildingChanged', c.school);
    c.st.day += SERVICES_DIRTY_DAYS;
    expect(c.task.due(c.sim)).toBe(true);
  });

  it('ignores water at non-health facilities and partial construction progress', () => {
    const c = city();
    c.st.day = SERVICES_DIRTY_DAYS;
    c.school.flags ^= BF.Watered;
    c.sim.events.emit('buildingChanged', c.school);
    expect(c.task.due(c.sim)).toBe(false);
    c.school.built = 0.2;
    c.sim.events.emit('buildingChanged', c.school);
    c.scheduler.flush(c.sim);
    c.school.built = 0.8;
    c.sim.events.emit('buildingChanged', c.school);
    c.st.day += SERVICES_DIRTY_DAYS;
    expect(c.task.due(c.sim)).toBe(false);
  });

  it('tracks def transitions into and out of coverage relevance', () => {
    const c = city();
    c.school.def = 't_r1';
    c.sim.events.emit('buildingChanged', c.school);
    c.st.day = SERVICES_DIRTY_DAYS;
    expect(c.task.due(c.sim)).toBe(true);
    c.scheduler.flush(c.sim);
    expect(c.st.eduElemCov[c.at]).toBe(0);
    c.school.flags ^= BF.Congested;
    c.sim.events.emit('buildingChanged', c.school);
    c.st.day += SERVICES_DIRTY_DAYS;
    expect(c.task.due(c.sim)).toBe(false);
    c.school.def = 'b1_school';
    c.sim.events.emit('buildingChanged', c.school);
    expect(c.task.due(c.sim)).toBe(true);
    c.scheduler.flush(c.sim);
    expect(c.st.eduElemCov[c.at]).toBeGreaterThan(0);
  });

  it('captures added buildings and forgets removed buildings', () => {
    const c = city();
    const added = place(c.st, 'b1_school', 14, 9, { flags: BF.Powered | BF.Watered });
    c.sim.events.emit('buildingAdded', added);
    c.st.day = SERVICES_DIRTY_DAYS;
    expect(c.task.due(c.sim)).toBe(true);
    c.scheduler.flush(c.sim);
    added.flags ^= BF.Congested;
    c.sim.events.emit('buildingChanged', added);
    c.st.day += SERVICES_DIRTY_DAYS;
    expect(c.task.due(c.sim)).toBe(false);
    c.st.buildings.delete(added.id);
    c.st.building[c.st.idx(added.x, added.z)] = -1;
    c.sim.events.emit('buildingRemoved', added);
    expect(c.task.due(c.sim)).toBe(true);
    c.scheduler.flush(c.sim);
    c.sim.runDays(SERVICES_DIRTY_DAYS);
    expect(c.task.due(c.sim)).toBe(false);
  });
});

describe('services: urgent coverage latency', () => {
  it('applies a funding change within N days without unrelated building events', () => {
    const c = city();
    const before = c.st.eduElemCov[c.at];
    expect(before).toBeGreaterThan(0);
    c.A.setFunding('education', 25);
    expect(c.task.urgent(c.sim)).toBe(true);
    withinLatency(c, () => c.st.eduElemCov[c.at] < before);
    expect(c.task.urgent(c.sim)).toBe(false);
  });

  it('applies ordinance enactment and repeal within N days', () => {
    const c = city();
    const before = c.st.healthCov[c.at];
    expect(before).toBeGreaterThan(0);
    expect(c.A.setOrdinance('free_clinics', true).ok).toBe(true);
    expect(c.task.urgent(c.sim)).toBe(true);
    withinLatency(c, () => c.st.healthCov[c.at] > before);
    const enacted = c.st.healthCov[c.at];
    expect(c.A.setOrdinance('free_clinics', false).ok).toBe(true);
    expect(c.task.urgent(c.sim)).toBe(true);
    withinLatency(c, () => c.st.healthCov[c.at] < enacted);
    expect(c.st.healthCov[c.at]).toBe(before);
  });

  it('ignores unchanged funding / ordinances and refused ordinance actions', () => {
    const c = city();
    c.A.setFunding('education', 50.1);
    expect(c.A.setOrdinance('free_clinics', false).ok).toBe(true);
    c.st.config.sandbox = false;
    expect(c.A.setOrdinance('free_clinics', true).ok).toBe(false);
    expect(c.A.setOrdinance('unknown', true).ok).toBe(false);
    c.st.day = SERVICES_DIRTY_DAYS;
    expect(c.task.due(c.sim)).toBe(false);
    expect(c.task.urgent(c.sim)).toBe(false);
  });

  it.each([true, false])('applies health Watered loss and restoration within N days (event: %s)', (emit) => {
    const c = city();
    const before = c.st.healthCov[c.at];
    c.clinic.flags &= ~BF.Watered;
    if (emit) {
      c.sim.events.emit('buildingChanged', c.clinic);
      expect(c.task.urgent(c.sim)).toBe(true);
    }
    withinLatency(c, () => c.st.healthCov[c.at] < before);
    const dry = c.st.healthCov[c.at];
    c.clinic.flags |= BF.Watered;
    if (emit) c.sim.events.emit('buildingChanged', c.clinic);
    withinLatency(c, () => c.st.healthCov[c.at] > dry);
    expect(c.st.healthCov[c.at]).toBe(before);
  });

  it('applies a strike start and end within N days without a funding action', () => {
    const c = city();
    const before = c.st.eduElemCov[c.at];
    expect(before).toBeGreaterThan(0);
    econData(c.st).strikes.education = 2; // what the monthly budget does under STRIKE_FUNDING
    withinLatency(c, () => c.st.eduElemCov[c.at] < before);
    const struck = c.st.eduElemCov[c.at];
    econData(c.st).strikes.education = 0;
    withinLatency(c, () => c.st.eduElemCov[c.at] > struck);
    expect(c.st.eduElemCov[c.at]).toBe(before);
  });

  it('applies staffing changes without an event or an Understaffed flag flip within N days', () => {
    const c = city();
    const before = c.st.eduElemCov[c.at];
    const flags = c.school.flags;
    c.school.jobs = 80;
    expect(1 - facilityOpFactor(c.st, c.school)).toBeGreaterThan(SERVICES_STAFF_DELTA);
    withinLatency(c, () => c.st.eduElemCov[c.at] < before);
    expect(c.school.flags).toBe(flags);
    const understaffed = c.st.eduElemCov[c.at];
    c.school.jobs = 100;
    withinLatency(c, () => c.st.eduElemCov[c.at] > understaffed);
    expect(c.st.eduElemCov[c.at]).toBe(before);
  });

  it('accumulates sub-threshold staffing drift across irrelevant events', () => {
    const c = city();
    c.st.day = SERVICES_DIRTY_DAYS;
    for (const jobs of [95, 90]) {
      c.school.jobs = jobs;
      c.school.flags ^= BF.Congested;
      c.sim.events.emit('buildingChanged', c.school);
      expect(c.task.due(c.sim)).toBe(false);
      expect(c.task.urgent(c.sim)).toBe(false);
    }
    c.school.jobs = 85;
    c.sim.events.emit('buildingChanged', c.school);
    expect(c.task.due(c.sim)).toBe(true);
    expect(c.task.urgent(c.sim)).toBe(true);
  });

  it('observes hiring and city-fill changes through their staffing factor', () => {
    const c = city();
    c.school.jobs = 50;
    c.school.hire = 0.5;
    c.sim.advanceDay();
    expect(c.task.urgent(c.sim)).toBe(false);
    c.school.hire = 1;
    c.sim.advanceDay();
    expect(c.task.urgent(c.sim)).toBe(true);
    c.scheduler.flush(c.sim);
    justiceData(c.st).cityFill = 0.5;
    c.sim.advanceDay();
    expect(c.task.urgent(c.sim)).toBe(true);
  });

  it('marks the monthly justice multiplier update urgent after JusticeSystem runs', () => {
    const c = city(true);
    c.st.stats.population = 60000;
    justiceData(c.st).potential = 1e6;
    c.sim.runDays(29);
    c.services.compute(c.sim, false); // put the month update just after a pass, away from the 15-day cadence
    const before = c.st.policeCov[c.at];
    c.sim.advanceDay();
    expect(justiceFactors(c.st).policeMul).toBeLessThan(c.services.policeMul);
    expect(c.task.urgent(c.sim)).toBe(true);
    expect(c.task.due(c.sim)).toBe(true);
    withinLatency(c, () => c.st.policeCov[c.at] < before);
    expect(c.services.policeMul).toBe(justiceFactors(c.st).policeMul);
  });

  it('keeps an urgent change arriving after prep pending for a second pass', () => {
    const c = city();
    const before = c.st.eduElemCov[c.at];
    c.st.day = SERVICES_PERIOD;
    c.task.step(c.sim); // prep captured the old funding
    c.A.setFunding('education', 25);
    const progress = c.services as unknown as { stepIdx: number };
    while (progress.stepIdx >= 0) c.task.step(c.sim);
    expect(c.st.eduElemCov[c.at]).toBe(before);
    expect(c.task.due(c.sim)).toBe(true);
    expect(c.task.urgent(c.sim)).toBe(true);
    c.task.step(c.sim);
    expect(c.task.urgent(c.sim)).toBe(true); // priority survives prep consuming the pending dirty bit
    c.scheduler.flush(c.sim);
    expect(c.st.eduElemCov[c.at]).toBeLessThan(before);
    expect(c.task.urgent(c.sim)).toBe(false);
  });
});

describe('services: live cap and determinism', () => {
  it('caps live starts of dirty passes only: periodic and urgent passes start at once, a running pass keeps going', () => {
    const c = city();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    let passes = 0;
    c.sim.events.on('layerUpdated', (layer) => { if (layer === 'services') passes++; });
    c.st.day = SERVICES_PERIOD;
    c.services.frame(c.sim, 0);
    expect(passes).toBe(1);
    c.A.setFunding('education', 25); // urgent, at the same instant as the last pass start
    expect(c.task.urgent(c.sim)).toBe(true);
    expect(c.task.due(c.sim)).toBe(true);
    c.scheduler.flush(c.sim);
    expect(passes).toBe(2);
    c.school.flags ^= BF.Powered; // dirty, not urgent
    c.sim.events.emit('buildingChanged', c.school);
    c.st.day += SERVICES_DIRTY_DAYS;
    expect(c.task.urgent(c.sim)).toBe(false);
    expect(c.task.due(c.sim)).toBe(false);
    now = SERVICES_MIN_CYCLE_MS - 1;
    c.services.frame(c.sim, 0);
    expect(c.task.due(c.sim)).toBe(false);
    expect(passes).toBe(2);
    now++;
    expect(c.task.due(c.sim)).toBe(true);
    c.task.step(c.sim);
    expect(c.task.due(c.sim)).toBe(true);
    c.scheduler.flush(c.sim);
    expect(passes).toBe(3);
    c.st.day += SERVICES_PERIOD; // periodic, at the same instant as the last pass start
    expect(c.task.due(c.sim)).toBe(true);
  });

  it('does not consult the cap clock in headless due checks', () => {
    const c = city();
    vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('headless cap read the clock'); });
    c.A.setFunding('education', 25);
    expect(c.task.due(c.sim)).toBe(true);
    expect(c.task.urgent(c.sim)).toBe(true);
  });

  it('resets remembered inputs and pending urgency when replacing a city', () => {
    const c = city();
    const saved = serializeCity(c.st, { copy: true });
    c.A.setFunding('education', 25);
    c.school.flags |= BF.Burnt;
    c.sim.events.emit('buildingChanged', c.school);
    c.sim.replaceState(deserializeCity(saved));
    const school = c.sim.state.buildings.get(c.school.id)!;
    school.flags ^= BF.Congested;
    c.sim.events.emit('buildingChanged', school);
    c.sim.state.day += SERVICES_DIRTY_DAYS;
    expect(c.task.due(c.sim)).toBe(false);
    expect(c.task.urgent(c.sim)).toBe(false);
  });

  it('produces identical cities and service passes over 60 headless days at different clock speeds', () => {
    const initial = city(true);
    const saved = serializeCity(initial.st, { copy: true });
    let now = 0, clockStep = 0.01;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += clockStep));
    const run = () => {
      const st = deserializeCity(saved);
      const sim = new Simulation(st, createSystems());
      const A = new CityActions(sim);
      const passes: number[] = [];
      sim.events.on('layerUpdated', (layer) => { if (layer === 'services') passes.push(st.day); });
      const school = st.buildings.get(initial.school.id)!;
      const clinic = st.buildings.get(initial.clinic.id)!;
      for (let d = 0; d < 60; d++) {
        if (d === 5) A.setFunding('education', 25);
        if (d === 12) A.setOrdinance('free_clinics', true);
        if (d === 20) clinic.flags ^= BF.Watered;
        if (d === 24) school.jobs = 0;
        if (d === 35) A.setFunding('education', 75);
        if (d === 42) A.setOrdinance('free_clinics', false);
        school.flags ^= BF.Congested;
        sim.events.emit('buildingChanged', school);
        sim.advanceDay();
      }
      const snapshot = serializeCity(st, { copy: true });
      snapshot.savedAt = 0; // save metadata, not simulation state
      return { snapshot, passes, coverage: [st.policeCov, st.fireCov, st.eduElemCov, st.eduHighCov, st.eduCollegeCov,
        st.healthCov, st.playCov, st.greenCov, st.transitCov, st.stigma, st.prestige, st.campus, st.accessCommute, st.shopAccess] };
    };
    const first = run();
    clockStep = 50;
    const second = run();
    expect(first.passes.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });
});
