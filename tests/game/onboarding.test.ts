/** GUIDE (a): host-only predicates, the card, progress snapshots and the shared tip queue. */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAYS_PER_MONTH } from '../../src/core/constants';
import { Emitter } from '../../src/core/events';
import { Network, Overlay, Zone } from '../../src/core/types';
import type { GameContext, UIEvents } from '../../src/game/context';
import { BF, type CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { updateNeighborConnections } from '../../src/sim/economy/connections';
import { WIND_TURBINE_BASE, WIND_TURBINE_GAIN } from '../../src/sim/infra/params';
import { LocalSimHost } from '../../src/worker/SimHost';
import { Onboarding } from '../../src/ui/Onboarding';
import { guideCopy } from '../../src/ui/guide/copy';
import type { GuideHooks } from '../../src/ui/guide/coach';
import { edgeHint } from '../../src/ui/guide/edgeHint';
import { ExplainerQueue } from '../../src/ui/guide/explainers';
import { accessibleZones, foundingDone, WIND_START, zoneTargets } from '../../src/ui/guide/founding';
import { advanceGoals, goalAppears, goalDone, goalFacts, goalPresentation, landfillSites, taxPointIncome, trackBudget, trackPower, visibleGoals,
  type GoalInputs } from '../../src/ui/guide/goals';
import { FOUNDING_IDS, GOAL_IDS, loadGuideProfile, newProgress, readProgress, saveGuideProfile } from '../../src/ui/guide/progress';
import { newState, place, roadLine } from '../infra/cityGen';
import { scan } from '../worker/hygieneScan';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
let now = 0;
const cities: { host: LocalSimHost; abort: AbortController }[] = [];
beforeEach(() => {
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const prefs = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => prefs.get(key) ?? null, setItem: (key: string, value: string) => prefs.set(key, value) });
});
afterEach(async () => {
  for (const { host, abort } of cities.splice(0)) { abort.abort('dispose'); await host.dispose(); }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(st = newState(128), hooks: Partial<GuideHooks> = {}) {
  const abort = new AbortController(), host = new LocalSimHost(st, { initialSpeed: 0, signal: abort.signal, now: () => now });
  cities.push({ host, abort });
  const ui = new Emitter<UIEvents>(), coach = vi.fn(), sound = vi.fn(), toast = vi.fn();
  let activeId: string | null = null, overlay = Overlay.None;
  const ctx = {
    host, ui, signal: abort.signal, canvas: new FEl('canvas'), root: new FEl('div'), sound, toast,
    get state() { throw new Error('Read through host.state'); }, get sim() { throw new Error('Read through host'); },
    tools: { get activeId() { return activeId; }, select: vi.fn((id: string | null) => { activeId = id; ui.emit('tool', id); }) },
    panels: { open: vi.fn((id: string) => ui.emit('panel', { id, open: true })) },
    get overlay() { return overlay; }, setOverlay: vi.fn((value: Overlay) => { overlay = value; ui.emit('overlay', value); }),
    openFlyout: vi.fn(), world: { setHighlight: vi.fn() },
  } as unknown as GameContext;
  const card = new Onboarding(ctx, new FEl('div') as unknown as HTMLElement, { coach, ...hooks });
  const el = card.el as unknown as FEl;
  const row = (id: string) => el.querySelectorAll('.ob-step').find((r) => r.dataset.guideId === id)!;
  return { st, host, ctx, card, el, row, abort, sound, toast, coach };
}
type Fixture = ReturnType<typeof setup>;
const hidden = (el: FEl) => (el as unknown as HTMLElement).hidden;
const tick = (f: Fixture, ms = 500) => { now += ms; f.card.frame(ms / 1000); };
const button = (el: FEl, text: string) => el.querySelectorAll('button').find((b) => textOf(b) === text)!;
const goalRows = (f: Fixture) => f.el.querySelectorAll('.ob-step').filter((r) => r.dataset.guideId.startsWith('G') && !hidden(r));

function zoned(st: CityState, road = true): void {
  if (road) roadLine(st, 0, 10, 80, 10);
  for (let x = 5; x < 45; x++) st.zone[st.idx(x, 11)] = Zone.ResLow;
  for (let x = 48; x < 56; x++) st.zone[st.idx(x, 11)] = Zone.ComLow;
  for (let x = 60; x < 72; x++) st.zone[st.idx(x, 11)] = Zone.IndMed;
  updateNeighborConnections(st);
}
function ready(st: CityState): void {
  zoned(st);
  st.systemData.infraVersion = 1;
  st.powered.fill(1);
  st.watered.fill(1);
}
function yearState(): CityState {
  const st = newState(128), p = newProgress(0);
  p.phase = 'year'; p.completed = [...FOUNDING_IDS];
  st.systemData.onboarding = p;
  st.day = 1;
  return st;
}
function input(): GoalInputs {
  return { state: newState(128), progress: newProgress(0), landfill: [], viewSeconds: 0,
    facts: { noGarbage: false, brownout: false, fuelPlants: 0, services: 0, policeAtHomes: 0, fireCovered: 0, fuelCovered: true } };
}

describe('FH-01 founding predicates and card', () => {
  it('leaves roadless zones incomplete; 40/8/12 road-front cells complete zoning', () => {
    const st = newState(128);
    zoned(st, false);
    expect(foundingDone(st, 0, zoneTargets(st)).zones).toBe(false);
    expect(accessibleZones(st)).toEqual({ R: 0, C: 0, I: 0, roadless: 60 });
    roadLine(st, 0, 10, 80, 10);
    expect(accessibleZones(st)).toEqual({ R: 40, C: 8, I: 12, roadless: 0 });
    expect(foundingDone(st, 0, zoneTargets(st)).zones).toBe(true);
  });

  it('counts yards but not land separated from a road by an unzoned strip', () => {
    const st = newState(128);
    roadLine(st, 10, 10, 30, 10);
    for (let z = 11; z <= 15; z++) st.zone[st.idx(15, z)] = Zone.ResLow;
    expect(accessibleZones(st).R).toBe(5);
    st.zone[st.idx(15, 11)] = Zone.None;
    expect(accessibleZones(st).R).toBe(0);
  });

  it('rejects a two-cell edge stub and accepts six connected road cells reaching three tiles in', () => {
    const st = newState(128);
    roadLine(st, 0, 15, 1, 15);
    updateNeighborConnections(st);
    expect(foundingDone(st, 0, zoneTargets(st)).road).toBe(false);
    roadLine(st, 1, 15, 5, 15);
    updateNeighborConnections(st);
    expect(foundingDone(st, 0, zoneTargets(st)).road).toBe(true);
  });

  it('scales to 20/4/6 on 64 tiles and lowers targets on scarce dry land', () => {
    const st = newState(64);
    expect(zoneTargets(st)).toEqual({ R: 20, C: 4, I: 6 });
    st.water.fill(1); st.water.fill(0, 0, 256);
    expect(zoneTargets(st)).toEqual({ R: 10, C: 2, I: 3 });
  });

  it('requires utilities to reach a zone when the utilities layer is present', () => {
    const st = newState(128);
    zoned(st); st.systemData.infraVersion = 1;
    place(st, 'util_wind_turbine', 85, 10, { flags: BF.Plopped });
    place(st, 'util_water_tower', 90, 10, { flags: BF.Plopped });
    expect(foundingDone(st, 0, zoneTargets(st))).toMatchObject({ power: false, water: false });
    st.powered[st.idx(5, 10)] = 1; st.watered[st.idx(5, 10)] = 1;
    expect(foundingDone(st, 0, zoneTargets(st))).toMatchObject({ power: true, water: true });
  });

  it('preselects the wind turbine, tower, residential zone and road tools', () => {
    const f = setup();
    for (const [id, tool] of [['power', 'plop:util_wind_turbine'], ['water', 'plop:util_water_tower'], ['zones', 'zone:1'], ['road', 'net:2']]) {
      f.row(id).querySelector('button')!.click();
      expect(f.ctx.tools.activeId).toBe(tool);
    }
    expect(f.ctx.world.setHighlight).toHaveBeenCalled();
  });

  it('renders wind MW, price, spacing and residents from the copy module and tuning', () => {
    const f = setup(), wind = getDef('util_wind_turbine')!, text = textOf(f.row('power'));
    const flat = wind.powerOut! * WIND_TURBINE_BASE, hill = wind.powerOut! * (WIND_TURBINE_BASE + WIND_TURBINE_GAIN);
    expect(text).toContain(`${flat} MW`);
    expect(text).toContain(`up to ${hill}`);
    expect(text).toContain((Math.floor(WIND_START.turbines * flat * WIND_START.residentsPerMW / WIND_START.residentRounding) * WIND_START.residentRounding).toLocaleString('en-US'));
    expect(text).toContain(guideCopy.phaseB.B3(WIND_START));
    expect(textOf(f.row('water'))).toContain(guideCopy.phaseB.B4());
  });

  it('omits the Play button until steps 1–4 finish and uses the existing host speed source', () => {
    const f = setup(), speed = vi.spyOn(f.host, 'setSpeed');
    expect(f.row('play').querySelector('button')).toBeNull();
    expect(textOf(f.row('play'))).toContain(guideCopy.phaseB.B5Locked());
    ready(f.st); tick(f);
    f.row('play').querySelector('button')!.click();
    expect(speed).toHaveBeenCalledWith(1, 'onboarding');
    expect(f.card.progress.completed).not.toContain('play');
  });

  it('switches to G1 after one day, with a single completion sound and no global dismissal', () => {
    const f = setup();
    ready(f.st); tick(f);
    f.st.day++; tick(f);
    expect(textOf(f.el.querySelector('.ob-title')!)).toBe(guideCopy.phaseC.CTitle());
    expect(goalRows(f).map((r) => r.dataset.guideId)).toEqual(['G1']);
    expect(f.sound.mock.calls.filter(([name]) => name === 'reward')).toHaveLength(1);
    expect(f.toast).toHaveBeenCalledWith(guideCopy.phaseB.BComplete(), 'good', undefined, guideCopy.phaseB.BTitle());
    tick(f, 7000);
    expect(f.card.isVisible).toBe(true);
    expect(loadGuideProfile().dismissedAll).toBe(false);
  });

  it('retains the fuel-plant fire tip only when a fuel plant needs a station', () => {
    const f = setup();
    ready(f.st); place(f.st, 'util_gas_plant', 90, 30, { flags: BF.Plopped }); tick(f);
    f.st.day++; tick(f);
    expect(f.toast.mock.calls[0][0]).toContain(guideCopy.phaseB.BCompleteFire());
  });

  it('finds a dry edge route, returns no fictitious route on an isolated island, and clears the hint on input', () => {
    const st = newState(64), path = edgeHint(st);
    expect(path.length).toBeGreaterThanOrEqual(6);
    expect(path[0].x === 0 || path[0].z === 0 || path[0].x === 63 || path[0].z === 63).toBe(true);
    for (let k = 1; k < path.length; k++) expect(Math.abs(path[k].x - path[k - 1].x) + Math.abs(path[k].z - path[k - 1].z)).toBe(1);
    st.water.fill(1);
    for (let z = 15; z < 45; z++) for (let x = 15; x < 45; x++) st.water[st.idx(x, z)] = 0;
    expect(edgeHint(st)).toEqual([]);
    const f = setup();
    f.row('road').querySelector('button')!.click();
    (f.ctx.canvas as unknown as FEl).fire('pointermove');
    expect(f.ctx.world.setHighlight).toHaveBeenLastCalledWith(null);
  });
});

describe('FH-02 goal predicates', () => {
  it('G1 appears at once and completes at 500 residents', () => {
    const i = input(); expect(goalAppears('G1', i)).toBe(true); expect(goalDone('G1', i)).toBe(false);
    i.state.stats.population = 500; expect(goalDone('G1', i)).toBe(true);
  });
  it('G2 appears for garbage or 300 residents and requires road-reachable landfill capacity', () => {
    const i = input(); expect(goalAppears('G2', i)).toBe(false);
    i.facts.noGarbage = true; expect(goalAppears('G2', i)).toBe(true);
    i.facts.noGarbage = false; i.state.stats.population = 300; expect(goalAppears('G2', i)).toBe(true);
    i.landfill = [{ cells: 9, fill: 0, capacityT: 100, usedT: 0, road: false }]; expect(goalDone('G2', i)).toBe(false);
    i.landfill[0].road = true; expect(goalDone('G2', i)).toBe(true);
    i.landfill[0].capacityT = 0; expect(goalDone('G2', i)).toBe(false);
  });
  it('G3 appears at the crime threshold or 400 residents and needs half the homes covered', () => {
    const i = input(); expect(goalAppears('G3', i)).toBe(false);
    i.state.systemData.economy = { approvalTerms: { crime: -4 } }; expect(goalAppears('G3', i)).toBe(true);
    i.state.systemData.economy = {}; i.state.stats.population = 400; expect(goalAppears('G3', i)).toBe(true);
    i.facts.policeAtHomes = 0.49; expect(goalDone('G3', i)).toBe(false);
    i.facts.policeAtHomes = 0.5; expect(goalDone('G3', i)).toBe(true);
  });
  it('G4 appears for a fuel plant or 800 residents and includes every fuel plant in fire cover', () => {
    const i = input(); expect(goalAppears('G4', i)).toBe(false);
    i.facts.fuelPlants = 1; expect(goalAppears('G4', i)).toBe(true);
    i.facts.fuelPlants = 0; i.state.stats.population = 800; expect(goalAppears('G4', i)).toBe(true);
    i.facts.fireCovered = 0.5; i.facts.fuelCovered = false; expect(goalDone('G4', i)).toBe(false);
    i.facts.fuelCovered = true; expect(goalDone('G4', i)).toBe(true);
    i.facts.fireCovered = 0.49; expect(goalDone('G4', i)).toBe(false);
  });
  it('G5 counts two settled recurring surpluses or a Budget visit, without treating a loan as income', () => {
    const i = input(); i.state.budget.lastExpense = { 'service:police': 100, 'oneoff:construction': 5000 };
    i.state.budget.lastIncome = { 'oneoff:loan': 10000 }; expect(goalAppears('G5', i)).toBe(true);
    i.state.budget.lastIncome['tax:R$'] = 101; expect(goalAppears('G5', i)).toBe(false);
    i.facts.services = 2; expect(goalAppears('G5', i)).toBe(true);
    i.state.day = 30; trackBudget(i.state, i.progress); expect(goalDone('G5', i)).toBe(false);
    trackBudget(i.state, i.progress); expect(i.progress.solventMonths).toBe(1);
    i.state.day = 60; trackBudget(i.state, i.progress); expect(goalDone('G5', i)).toBe(true);
    i.state.budget.lastIncome = {}; i.state.day = 90; trackBudget(i.state, i.progress); expect(goalDone('G5', i)).toBe(false);
    i.progress.budgetOpened = true; expect(goalDone('G5', i)).toBe(true);
  });
  it('G6 appears at 100 unreached pupils and completes strictly below half unreached', () => {
    const i = input(), n = i.state.stats.needs.elementary;
    n.need = 200; n.unreached = 100; expect(goalAppears('G6', i)).toBe(true); expect(goalDone('G6', i)).toBe(false);
    n.unreached = 99; expect(goalDone('G6', i)).toBe(true);
    n.need = 0; n.unreached = 0; expect(goalDone('G6', i)).toBe(false);
  });
  it('G7 appears at 1,500 residents and needs three seconds in a data view', () => {
    const i = input(); expect(goalAppears('G7', i)).toBe(false);
    i.state.stats.population = 1500; expect(goalAppears('G7', i)).toBe(true);
    i.viewSeconds = 2.99; expect(goalDone('G7', i)).toBe(false);
    i.viewSeconds = 3; expect(goalDone('G7', i)).toBe(true);
  });
  it('G8 waits for G7 and actual Why? expansion, not just a Query selection', () => {
    const i = input(); expect(goalAppears('G8', i)).toBe(false);
    i.progress.completed.push('G7'); expect(goalAppears('G8', i)).toBe(true); expect(goalDone('G8', i)).toBe(false);
    i.progress.whyOpened = true; expect(goalDone('G8', i)).toBe(true);
  });
  it('G9 appears after G1 and hands over at 2,500 residents', () => {
    const i = input(); expect(goalAppears('G9', i)).toBe(false);
    i.progress.completed.push('G1'); expect(goalAppears('G9', i)).toBe(true);
    i.state.stats.population = 2499; expect(goalDone('G9', i)).toBe(false);
    i.state.stats.population = 2500; expect(goalDone('G9', i)).toBe(true);
  });
  it('G10 warns above 80%, accepts either power upgrade for a full month, and resets after a dip', () => {
    for (const supply of [12, 250]) {
      const i = input(); i.state.stats.powerDemand = 8; i.state.stats.powerSupply = 9;
      expect(goalAppears('G10', i)).toBe(true);
      i.progress.started.push('G10'); i.state.stats.powerSupply = supply; trackPower(i.state, i.progress);
      i.state.day = DAYS_PER_MONTH - 1; expect(goalDone('G10', i)).toBe(false);
      i.state.day++; expect(goalDone('G10', i)).toBe(true);
      i.state.stats.powerSupply = 9; trackPower(i.state, i.progress); expect(goalDone('G10', i)).toBe(false);
      expect(i.progress.powerMarginSince).toBeNull();
    }
    const i = input(); i.facts.brownout = true; expect(goalAppears('G10', i)).toBe(true);
    i.facts.brownout = false; expect(goalAppears('G10', i)).toBe(false);
  });

  it('reads resident-weighted police and guarded auto-dispatch fire layers through host views', () => {
    const st = newState(128);
    place(st, 't_r1', 5, 5, { pop: 10, flags: BF.Powered });
    place(st, 't_r1', 10, 5, { pop: 30, flags: BF.NoGarbage });
    const plant = place(st, 'util_gas_plant', 20, 20, { flags: BF.Plopped });
    st.policeCov[st.idx(5, 5)] = 1;
    st.respFire.fill(2);
    const f = setup(st), first = goalFacts(f.host);
    expect(first).toMatchObject({ policeAtHomes: 0.25, fireCovered: 0, fuelCovered: false, noGarbage: true, brownout: true });
    const host = { state: st, emergency: { ...f.host.emergency, active: true, layersReady: true } };
    expect(goalFacts(host)).toMatchObject({ fireCovered: 1, fuelCovered: true });
    st.respFire[st.idx(plant.x + (plant.w >> 1), plant.z + (plant.d >> 1))] = -99;
    expect(goalFacts(host)).toMatchObject({ fuelCovered: false });
  });

  it('keeps at most two goals visible, prioritises power, and permits G10 after handover', () => {
    const i = input(); i.progress.phase = 'year'; i.progress.started = [...GOAL_IDS];
    expect(visibleGoals(i.progress)).toEqual(['G10', 'G1']);
    i.progress.phase = 'complete'; expect(visibleGoals(i.progress)).toEqual(['G10']);
    i.progress.completed.push('G10'); expect(visibleGoals(i.progress)).toEqual([]);
    const st = yearState(); st.stats.population = 1800; st.stats.powerDemand = 8; st.stats.powerSupply = 9;
    const f = setup(st);
    expect(goalRows(f)).toHaveLength(2);
    expect(f.row('G10').classList.contains('current')).toBe(true);
  });

  it('latches triggered goals and reports each completion once', () => {
    const i = input(); i.progress.phase = 'year'; i.state.stats.population = 300;
    expect(advanceGoals(i)).toEqual([]); expect(i.progress.started).toContain('G2');
    i.state.stats.population = 0; advanceGoals(i); expect(visibleGoals(i.progress)).toContain('G2');
    i.state.stats.population = 500; expect(advanceGoals(i)).toEqual(['G1']);
    expect(advanceGoals(i)).toEqual([]);
  });

  it('latches achievements without another chime after a regression or Help reopening', () => {
    const f = setup(yearState());
    f.st.stats.population = 500; tick(f);
    expect(f.card.progress.completed).toContain('G1');
    const sounds = f.sound.mock.calls.length;
    f.st.stats.population = 400; tick(f); f.card.hide(false); f.card.show(false); tick(f);
    expect(f.card.progress.completed).toContain('G1');
    expect(f.sound.mock.calls.length).toBe(sounds);
    expect(f.el.querySelector('.ob-title')!.textContent).toBe(guideCopy.phaseC.CTitle());
  });

  it('uses UI events for Budget / data views and the inspector callback for Why?', () => {
    const f = setup(yearState(), { openWhy: vi.fn() });
    f.st.stats.population = 1500;
    f.ctx.panels.open('budget'); f.ctx.setOverlay(Overlay.Power);
    tick(f, 2999); expect(f.card.progress.completed).not.toContain('G7');
    tick(f, 501); expect(f.card.progress.completed).toContain('G7');
    const home = place(f.st, 't_r1', 10, 10, { pop: 10, flags: BF.Powered });
    f.ctx.ui.emit('query', { buildingId: home.id, x: 10, z: 10 });
    expect(f.card.progress.completed).not.toContain('G8');
    f.card.whyExpanded(home.id); tick(f);
    expect(f.card.progress.completed).toContain('G8');
    expect(f.card.progress.budgetOpened).toBe(true);
  });

  it('groups landfill tiles and completes from host query data, ignoring a late reply after disposal', async () => {
    const st = yearState(); st.stats.population = 300;
    for (let z = 10; z < 13; z++) for (let x = 10; x < 13; x++) st.zone[st.idx(x, z)] = Zone.Landfill;
    expect(landfillSites(st)).toEqual([{ x: 10, z: 10 }]);
    const f = setup(st);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const query = vi.spyOn(f.host, 'query').mockResolvedValue({ landfill: { cells: 9, road: true, capacityT: 100, fill: 0, usedT: 0 } } as never);
    tick(f, 1000);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(query).toHaveBeenCalledWith('inspectCell', { x: 10, z: 10, sections: [] });
    expect(f.card.progress.completed).toContain('G2');
    const g = setup(st);
    let resolve!: (value: never) => void;
    const pending = new Promise<never>((yes) => { resolve = yes; });
    vi.spyOn(g.host, 'query').mockReturnValueOnce(pending);
    tick(g, 1000);
    g.abort.abort('dispose');
    const saved = g.card.progress;
    resolve({ landfill: { cells: 9, road: true, capacityT: 100, fill: 0, usedT: 0 } } as never);
    await Promise.resolve(); await Promise.resolve();
    expect(g.card.progress).toEqual(saved);
  });

  it('does not invent a zero-tax projection and uses catalog goals without a guessed shore landmark', () => {
    const st = newState(128); st.stats.residents[0] = 100;
    expect(taxPointIncome(st, { income: { 'tax:R$': 900 }, expense: {}, totalIncome: 900, totalExpense: 0 })).toBe(100);
    st.budget.taxRates[0] = 0;
    expect(taxPointIncome(st, { income: {}, expense: {}, totalIncome: 0, totalExpense: 0 })).toBeNull();
    expect(goalPresentation('G9', st, undefined, { coach() {} }).text).toEqual([guideCopy.phaseC.G9()]);
  });
});

describe('FH-22 progress and profile boundaries', () => {
  it('restores a supplied G4 snapshot, including its timing fields, without mutating the host state', () => {
    const st = yearState(), p = newProgress(0); p.phase = 'year'; p.completed = [...FOUNDING_IDS, 'G1', 'G2', 'G3']; p.started = ['G4'];
    p.powerMarginSince = 0; p.lastExplainerDay = 0; st.systemData.onboarding = p; st.stats.population = 800;
    const before = structuredClone(p), f = setup(st);
    expect(goalRows(f)[0].dataset.guideId).toBe('G4');
    f.card.setMinimised(true); f.card.hide(true); f.card.show(false);
    expect(f.card.progress.phase).toBe('year');
    expect(st.systemData.onboarding).toEqual(before);
    const detached = f.card.progress; detached.completed.length = 0;
    expect(f.card.progress.completed).toContain('G3');
    expect(readProgress(JSON.parse(JSON.stringify(before)), st.day)).toEqual(before);
  });

  it('shows a second city unless all cities was chosen; city dismissal leaves profile tips enabled', () => {
    const f = setup(); button(f.el, "Don't show again").click();
    expect(hidden(f.el.querySelector('.ob-dismiss')!)).toBe(false);
    button(f.el, 'This city').click(); expect(f.card.isVisible).toBe(false);
    expect(setup().card.isVisible).toBe(true);
    expect(loadGuideProfile().tips).toBe(true);
    f.card.show(false); button(f.el, "Don't show again").click(); button(f.el, 'All cities').click();
    expect(setup().card.isVisible).toBe(false);
    expect(loadGuideProfile()).toMatchObject({ tips: false, dismissedAll: true });
  });

  it('keeps the young-city rule for old saves and migrates legacy global dismissal', () => {
    const st = newState(128); st.stats.population = 300;
    expect(setup(st).card.isVisible).toBe(false);
    expect(setup().card.isVisible).toBe(true);
    localStorage.setItem('metropolis.ui.onboarding', JSON.stringify({ dismissed: true, min: true }));
    const old = setup(); expect(old.card.isVisible).toBe(false); expect(old.card.isMinimised).toBe(true);
    expect(loadGuideProfile().dismissedAll).toBe(true);
  });

  it('rejects malformed / future progress and keeps unknown or duplicated ids out of current progress', () => {
    expect(readProgress({ version: 2, phase: 'year' }, 10)).toBeNull();
    expect(readProgress(null, 10)).toBeNull();
    const p = readProgress({ version: 1, phase: 'year', completed: ['G1', 'G1', 'bogus'], startDay: 50, powerMarginSince: 12 }, 10)!;
    expect(p.completed).toEqual(['G1']); expect(p.startDay).toBe(10); expect(p.powerMarginSince).toBeNull();
    localStorage.setItem('metropolis.ui.onboarding', 'null'); expect(loadGuideProfile().tips).toBe(true);
  });
});

describe('explainer framework and teardown', () => {
  it('shares one slot, a two-month cooldown, profile memory and the New Year gate', () => {
    const profile = loadGuideProfile(), p = newProgress(0), q = new ExplainerQueue(profile, p);
    q.offer({ id: 'E7', text: ['Cap'] }); q.offer({ id: 'E12', text: ['Power'], priority: 10 });
    expect(q.next(0, true)).toBeNull(); expect(profile.seenExplainers).toEqual([]);
    expect(q.next(0, false)?.id).toBe('E12'); expect(q.next(60, false)).toBeNull();
    q.close(); expect(q.next(59, false)).toBeNull(); expect(q.next(60, false)?.id).toBe('E7');
    const other = new ExplainerQueue(loadGuideProfile(), newProgress(0)); other.offer({ id: 'E12', text: ['Power'] });
    expect(other.next(0, false)).toBeNull();
  });

  it('withdraws fixed problems and honours tips off', () => {
    const profile = loadGuideProfile(), q = new ExplainerQueue(profile, newProgress(0));
    q.offer({ id: 'E12', text: ['Power'], relevant: () => false }); expect(q.next(0, false)).toBeNull();
    expect(profile.seenExplainers).toEqual([]);
    profile.tips = false; saveGuideProfile(profile);
    q.offer({ id: 'E7', text: ['Cap'] }); expect(q.next(100, false)).toBeNull();
  });

  it('waits for the New Year hook, pauses Easy through the host and respects a manual speed change', () => {
    const f = setup(); f.card.offerExplainer({ id: 'E7', text: ['Cap'] }); tick(f);
    expect(loadGuideProfile().seenExplainers).toEqual([]);
    const st = newState(128); st.config.difficulty = 'easy';
    const g = setup(st, { celebrating: () => false }); g.host.setSpeed(2, 'topbar');
    g.card.offerExplainer({ id: 'E7', text: ['Cap'] }); tick(g);
    expect(g.host.speed).toBe(0);
    button(g.el, guideCopy.actions.GotIt()).click(); expect(g.host.speed).toBe(2);
    st.day = 60; g.card.offerExplainer({ id: 'E12', text: ['Power'] }); tick(g);
    g.host.setSpeed(3, 'keyboard'); button(g.el, guideCopy.actions.GotIt()).click(); expect(g.host.speed).toBe(3);
  });

  it('shows the spend guard once, from the founding-day ledger, without counting loan proceeds', () => {
    const f = setup(undefined, { celebrating: () => false });
    f.st.budget.curExpense['oneoff:construction'] = f.st.config.startFunds * 0.41;
    f.st.budget.curIncome['oneoff:loan'] = 50000;
    tick(f);
    expect(textOf(f.el.querySelector('.ob-tip')!)).toContain(guideCopy.phaseB.BSpend(f.st.config.startFunds * 0.41, f.st.config.startFunds));
    expect(loadGuideProfile().seenExplainers).toContain('BSpend');
  });

  it('defers completion toasts and the guide while the New Year show owns the screen', () => {
    let celebrating = false;
    const f = setup(undefined, { celebrating: () => celebrating });
    ready(f.st); tick(f);
    celebrating = true; f.st.day++; tick(f);
    expect(f.el.classList.contains('show')).toBe(false);
    expect(f.toast).not.toHaveBeenCalled();
    expect(f.sound.mock.calls.some(([name]) => name === 'reward')).toBe(false);
    celebrating = false; tick(f);
    expect(f.toast).toHaveBeenCalledTimes(1);
    expect(f.el.classList.contains('show')).toBe(true);
  });

  it('removes DOM, UI and host listeners on abort and never calls a disposed host', () => {
    const f = setup(yearState(), { celebrating: () => false, openWhy: vi.fn() });
    const retained = f.el.all(); f.abort.abort('dispose');
    expect(retained.reduce((n, el) => n + el.listenerCount(), 0)).toBe(0);
    const before = f.card.progress, sounds = f.sound.mock.calls.length;
    f.ctx.ui.emit('panel', { id: 'budget', open: true }); f.ctx.ui.emit('overlay', Overlay.Power);
    f.host.events.emit('month', 1); f.host.events.emit('day', 1);
    for (const el of retained) el.click();
    f.card.show(); f.card.frame(100);
    expect(f.card.progress).toEqual(before); expect(f.sound.mock.calls.length).toBe(sounds);
  });

  it('keeps the owned UI files clear of system reads, speed writes and replica writes', () => {
    for (const name of ['Onboarding.ts', 'guide/founding.ts', 'guide/goals.ts', 'guide/progress.ts', 'guide/coach.ts', 'guide/explainers.ts', 'guide/edgeHint.ts']) {
      const file = 'src/ui/' + name, source = readFileSync(file, 'utf8');
      for (const rule of ['systems', 'speed', 'replica'] as const) expect(scan(file, source, rule), `${file}: ${rule}`).toEqual([]);
    }
  });
});
