/**
 * SIM_DEPTH_SPEC WP4: approval as named, resident-weighted terms (econData.approvalTerms / approvalBreakdown).
 */
import { describe, expect, it } from 'vitest';
import { makeCity, road } from './helpers';
import { Network, Zone } from '../../src/core/types';
import { BF, type Building } from '../../src/sim/CityState';
import { Simulation as Sim, type SimSystem, type Simulation } from '../../src/sim/Simulation';
import { economySystems } from '../../src/sim/systems/economy';
import { getDef } from '../../src/sim/catalog';
import { econData } from '../../src/sim/economy/runtime';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { APPROVAL_LABELS, approvalBreakdown, serviceGaps } from '../../src/sim/economy/approval';
import { sumTerms } from '../../src/sim/explain';
import { APPROVAL_TERMS, NEEDS_POP_FULL, NEEDS_POP_START } from '../../src/sim/economy/tuning';
import { smoothstep } from '../../src/core/rng';

const approvalSys = (sim: Simulation) => sim.systems.find((s) => s.name === 'economy.approval') as SimSystem;
/** run the monthly approval update with a fresh resident survey */
function approvalMonth(sim: Simulation) {
  sim.state.day++;
  approvalSys(sim).monthly!(sim);
  return econData(sim.state).approvalTerms;
}

let nextId = 2_000_000;
function home(sim: Simulation, x: number, z: number, pop: number, o: Partial<Building> = {}): Building {
  const defId = 'res_apartment.r2.4';
  const def = getDef(defId)!;
  const b: Building = {
    id: nextId++, def: defId, x, z, w: def.footprint[0], d: def.footprint[1], rot: 0, variant: 0, pop, jobs: 0,
    capacity: Math.max(pop, def.capacity ?? 0), wealth: 2, built: 1, age: 400, flags: BF.Powered | BF.Watered, baseY: 5, health: 0.8, unhappy: 0, ...o,
  };
  sim.state.nextBuildingId = Math.max(sim.state.nextBuildingId, b.id + 1);
  placeBuilding(sim, b);
  for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) sim.state.zone[sim.state.idx(xx, zz)] = Zone.ResMed;
  return b;
}

/** 12k residents in 8 apartment blocks; utilities layer switched on (flags decide power / water) */
function town() {
  const c = makeCity({ size: 96 });
  road(c.A, 0, 40, 95, 40, Network.Avenue);
  const homes: Building[] = [];
  for (let k = 0; k < 8; k++) homes.push(home(c.sim, 10 + k * 8, 42, 1500));
  c.st.systemData.infraVersion = 1;
  c.st.systemData.infraLayers = { utilities: true, traffic: false, pollution: false, services: false };
  c.st.stats.population = 12000;
  return { ...c, homes };
}

describe('approval terms', () => {
  it('the breakdown sums to approvalRaw (running town) and every term has a label', () => {
    const c = makeCity({ size: 64 });
    road(c.A, 0, 31, 63, 31, Network.Avenue);
    for (let z = 4; z <= 58; z += 9) road(c.A, 4, z, 58, z);
    c.A.zone({ x0: 5, z0: 5, x1: 58, z1: 30 }, Zone.ResLow);
    c.A.zone({ x0: 5, z0: 32, x1: 58, z1: 44 }, Zone.ComLow);
    c.A.zone({ x0: 5, z0: 45, x1: 58, z1: 58 }, Zone.IndMed);
    c.sim.runDays(200);
    const d = econData(c.st);
    const br = approvalBreakdown(c.st);
    expect(br[0].id).toBe('base');
    expect(Math.abs(sumTerms(br) - d.approvalRaw)).toBeLessThan(0.01);
    for (const t of br) expect(APPROVAL_LABELS[t.id], t.id).toBeDefined();
    // clamped approval keeps the identity (a 'clamp' term)
    for (let k = 0; k < 12; k++) c.st.budget.taxRates[k] = 20;
    const T = approvalMonth(c.sim);
    let s = 0;
    for (const k in T) s += T[k];
    expect(Math.abs(s - econData(c.st).approvalRaw)).toBeLessThan(0.01);
  });

  it('noise, garbage and outage terms are negative and resident-weighted', () => {
    const c = town();
    const T0 = approvalMonth(c.sim);
    expect(T0.noise).toBe(0);
    expect(T0.garbage).toBe(0);
    expect(T0.outages).toBe(0);
    // noise at half the homes
    for (const b of c.homes.slice(0, 4)) c.st.noise[c.st.idx(b.x + (b.w >> 1), b.z + (b.d >> 1))] = 0.5;
    // no garbage pickup at 2 of 8 homes, no power at 1, no water at 1
    c.homes[0].flags |= BF.NoGarbage;
    c.homes[1].flags |= BF.NoGarbage;
    c.homes[2].flags &= ~BF.Powered;
    c.homes[3].flags &= ~BF.Watered;
    const T = approvalMonth(c.sim);
    expect(T.noise).toBeCloseTo(APPROVAL_TERMS.noise * 0.25, 5);
    // garbage: −20 × share × fade(2k..20k residents), saturating softly at gapSat.garbage
    const S = APPROVAL_TERMS.gapSat;
    const gRaw = APPROVAL_TERMS.garbage * 0.25 * smoothstep(APPROVAL_TERMS.needsPop0, APPROVAL_TERMS.garbagePop1, 12000);
    expect(T.garbage).toBeCloseTo(-S.garbage * (1 - Math.exp(gRaw / S.garbage)), 5);
    expect(T.garbage).toBeGreaterThan(gRaw); // milder than the linear formula, never more
    expect(T.outages).toBeCloseTo(APPROVAL_TERMS.unpowered / 8 + APPROVAL_TERMS.unwatered / 8, 5);
    expect(T.noise).toBeLessThan(0);
    expect(T.garbage).toBeLessThan(0);
    expect(T.outages).toBeLessThan(0);
    // bad tap water: −12 × (1 − quality), saturating at gapSat.tapWater
    c.st.stats.tapWater = 0.5;
    expect(approvalMonth(c.sim).tapWater).toBeCloseTo(-S.tapWater * (1 - Math.exp(-6 / S.tapWater)), 5);
    // the inspector-style details say why
    const br = approvalBreakdown(c.st);
    expect(br.find((t) => t.id === 'garbage')!.detail).toMatch(/25% of residents without garbage pickup/);
    expect(br.find((t) => t.id === 'outages')!.detail).toMatch(/13% of residents without power, 13% without water/);
  });

  it('service gaps are bounded (garbage + needs + tap water ≥ gapMax) and fixing any one of them still pays', () => {
    // the review scenario: 10k residents, 90 % without pickup, 90 % of pupils and patients out of reach
    const c = town();
    c.homes.push(home(c.sim, 74, 42, 1000), home(c.sim, 82, 42, 1000));
    for (const b of c.homes) b.pop = 1000;
    c.st.stats.population = 10000;
    for (let k = 0; k < 9; k++) c.homes[k].flags |= BF.NoGarbage; // 9 of 10 homes = 90 %
    const n = c.st.stats.needs;
    n.elementary.need = 1000; n.elementary.unreached = 900;
    n.high.need = 500; n.high.unreached = 450;
    n.health.need = 3000; n.health.unreached = 2700;
    let T = approvalMonth(c.sim);
    const gap = (t: Record<string, number>) => t.garbage + t.needs + t.tapWater;
    expect(gap(T)).toBeGreaterThanOrEqual(APPROVAL_TERMS.gapMax - 1e-9);
    expect(T.garbage).toBeLessThan(0);
    const sum = (t: Record<string, number>) => Object.values(t).reduce((s, v) => s + v, 0);
    expect(Math.abs(sum(T) - econData(c.st).approvalRaw)).toBeLessThan(0.01);
    expect(Math.abs(sumTerms(approvalBreakdown(c.st)) - econData(c.st).approvalRaw)).toBeLessThan(0.01);
    // a big city failing everything: the three gaps together cost exactly |gapMax|, each still shows
    for (const b of c.homes) { b.pop = 10000; b.flags |= BF.NoGarbage; }
    c.st.stats.population = 100000;
    n.elementary.unreached = 1000; n.high.unreached = 500; n.health.unreached = 3000;
    c.st.stats.tapWater = 0;
    T = approvalMonth(c.sim);
    expect(gap(T)).toBeCloseTo(APPROVAL_TERMS.gapMax, 6);
    for (const k of ['garbage', 'needs', 'tapWater']) expect(T[k], k).toBeLessThan(-1);
    expect(Math.abs(sum(T) - econData(c.st).approvalRaw)).toBeLessThan(0.01);
    expect(approvalBreakdown(c.st).find((t) => t.id === 'garbage')!.detail).toMatch(/together cost at most 10/);
    // fixing ONE gap always pays, even while the limit binds (each gap saturates below the common limit)
    let g0 = gap(T);
    for (const b of c.homes) b.flags &= ~BF.NoGarbage;
    T = approvalMonth(c.sim);
    expect(T.garbage).toBe(0);
    expect(gap(T) - g0).toBeGreaterThan(1.5);
    // two gaps left (schools / clinics + tap water): below the limit, each at its own value; fixing one pays in full
    expect(gap(T)).toBeGreaterThan(APPROVAL_TERMS.gapMax);
    g0 = gap(T);
    const tap0 = T.tapWater;
    c.st.stats.tapWater = 1;
    T = approvalMonth(c.sim);
    expect(T.tapWater).toBe(0);
    expect(gap(T) - g0).toBeCloseTo(-tap0, 9);
    expect(Math.abs(sum(T) - econData(c.st).approvalRaw)).toBeLessThan(0.01);
  });

  it('serviceGaps: fades with the city, saturates per term, bounded in sum, monotone', () => {
    const nd = (u: number) => ({ elementary: { need: 1000, unreached: 1000 * u }, high: { need: 500, unreached: 500 * u }, health: { need: 2000, unreached: 2000 * u } });
    // a hamlet is not blamed; needs follow WP1's expectation curve (5k .. 60k residents)
    expect(serviceGaps(0, 1, 1, nd(1)).garbage).toBe(0);
    expect(serviceGaps(1500, 1, 1, nd(1)).garbage).toBe(0);
    expect(serviceGaps(NEEDS_POP_START, 0, 1, nd(1)).needs).toBe(0);
    expect(serviceGaps(9000, 0, 1, nd(1)).needs).toBeGreaterThan(-0.5);
    expect(serviceGaps(NEEDS_POP_FULL, 0, 1, nd(1)).needs).toBeCloseTo(-APPROVAL_TERMS.gapSat.needs * (1 - Math.exp(-20 / APPROVAL_TERMS.gapSat.needs)), 6);
    // small gaps follow the spec formula (−20 × share at full weight), big ones saturate
    expect(serviceGaps(50000, 0.02, 1, undefined).garbage).toBeCloseTo(-0.4, 1);
    expect(serviceGaps(50000, 1, 1, undefined).garbage).toBeGreaterThan(-APPROVAL_TERMS.gapSat.garbage);
    // monotone in every share, never below gapMax in sum
    let prev = 0;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const g = serviceGaps(80000, s, 1 - s, nd(s));
      const tot = g.garbage + g.needs + g.tapWater;
      expect(tot).toBeLessThanOrEqual(prev + 1e-9);
      expect(tot).toBeGreaterThanOrEqual(APPROVAL_TERMS.gapMax - 1e-9);
      prev = tot;
    }
    const all = serviceGaps(80000, 1, 0, nd(1));
    expect(all.limited).toBe(true);
    expect(all.sum).toBeLessThan(APPROVAL_TERMS.gapMax);
  });

  it('unmet needs, HQ and tourism', () => {
    const c = town();
    const n = c.st.stats.needs;
    n.elementary.need = 1000; n.elementary.unreached = 500;
    n.high.need = 1000; n.high.unreached = 0;
    n.health.need = 400; n.health.unreached = 400;
    // 12k residents: expectations are still low (WP1's curve starts at NEEDS_POP_START)
    let T = approvalMonth(c.sim);
    const raw = APPROVAL_TERMS.kidsUnreached * 0.25 + APPROVAL_TERMS.seniorsHealth;
    const sat = (v: number) => -APPROVAL_TERMS.gapSat.needs * (1 - Math.exp(v / APPROVAL_TERMS.gapSat.needs));
    expect(T.needs).toBeCloseTo(sat(raw * smoothstep(NEEDS_POP_START, NEEDS_POP_FULL, 12000)), 5);
    expect(T.needs).toBeGreaterThan(-1);
    // 80k residents: full weight (saturating)
    for (const b of c.homes) b.pop = 10000;
    T = approvalMonth(c.sim);
    expect(T.needs).toBeCloseTo(sat(raw), 5);
    expect(approvalBreakdown(c.st).find((t) => t.id === 'needs')!.detail).toBe('500 pupils without a school in reach, 400 patients without a clinic in reach');
    for (const b of c.homes) b.pop = 1500;
    // (without the services system sim-core itself moves HQ toward its target first)
    c.st.stats.hq = 150;
    econData(c.st).tourists = 90000;
    T = approvalMonth(c.sim);
    expect(T.hq).toBeCloseTo(Math.min(4, 4 * (c.st.stats.hq - 80) / 70), 5);
    expect(T.hq).toBeGreaterThan(3);
    expect(T.tourism).toBe(APPROVAL_TERMS.tourismMax);
    c.st.stats.hq = 20;
    T = approvalMonth(c.sim);
    expect(T.hq).toBeCloseTo(4 * (c.st.stats.hq - 80) / 70, 5);
    expect(T.hq).toBeLessThan(-2.5);
    // a hamlet is not blamed for poor health care (penalty fades in over 2k..8k residents)
    for (const b of c.homes) b.pop = 200;
    c.st.stats.hq = 20;
    expect(approvalMonth(c.sim).hq).toBe(0);
  });

  it('emergencies (WP8) replace the legacy fire count; jail overflow and disasters cost approval', () => {
    const c = town();
    // legacy: fires started last month (disaster events), −1.5 each, at most −6
    for (let k = 0; k < 2; k++) c.sim.events.emit('disaster', { kind: 'fire', x: 5, z: 5, active: true });
    expect(approvalMonth(c.sim).emergencies).toBeCloseTo(-3, 5);
    for (let k = 0; k < 9; k++) c.sim.events.emit('disaster', { kind: 'fire', x: 5, z: 5, active: true });
    expect(approvalMonth(c.sim).emergencies).toBe(-6);
    expect(approvalMonth(c.sim).emergencies).toBe(0); // counter reset
    // an active emergency system: last month's outcomes
    c.sim.systems.push({ name: 'emergency', active: true } as SimSystem & { active: boolean });
    const lm = c.st.stats.emergency.lastMonth;
    lm.failed = 2; lm.late = 1; lm.deaths = 3; lm.riotDays = 5;
    expect(approvalMonth(c.sim).emergencies).toBeCloseTo(-(1.2 * 2 + 0.4 + 0.3 * 3 + 0.1 * 5), 5);
    lm.failed = 30;
    expect(approvalMonth(c.sim).emergencies).toBe(-APPROVAL_TERMS.emergencyMax);
    // jail overflow (WP7)
    c.st.stats.justice.overflow = 0.5;
    expect(approvalMonth(c.sim).justice).toBeCloseTo(-1.5, 5);
    // a tornado last month
    c.sim.events.emit('disaster', { kind: 'tornado', x: 5, z: 5, active: true });
    expect(approvalMonth(c.sim).disaster).toBe(APPROVAL_TERMS.disaster);
    expect(approvalMonth(c.sim).disaster).toBe(0);
  });

  it('a loaded city keeps its smoothed approval, demand and tourism outputs at init (save / load continuity)', () => {
    const c = makeCity({ size: 64 });
    road(c.A, 0, 31, 63, 31, Network.Avenue);
    for (let z = 4; z <= 58; z += 9) road(c.A, 4, z, 58, z);
    c.A.zone({ x0: 5, z0: 5, x1: 58, z1: 30 }, Zone.ResLow);
    c.A.zone({ x0: 5, z0: 32, x1: 58, z1: 44 }, Zone.ComLow);
    c.A.zone({ x0: 5, z0: 45, x1: 58, z1: 58 }, Zone.IndMed);
    c.sim.runDays(215); // mid-month
    const d = econData(c.st);
    // smoothed values that lag this month's instantaneous ones (as in any growing city)
    c.st.stats.approval = Math.max(0, d.approvalRaw - 7);
    d.demandAbs[0] += 500;
    c.st.stats.demand[0] -= 0.1;
    d.migration[1] = 1.05;
    const before = JSON.stringify({
      approval: c.st.stats.approval, demand: c.st.stats.demand, abs: d.demandAbs, target: d.target, migration: d.migration,
      tourism: d.tourism, tourists: d.tourists, attractiveness: d.attractiveness,
    });
    const sim2 = new Sim(c.st, economySystems()); // what loading a save does: fresh systems on the saved state
    const d2 = econData(sim2.state);
    expect(JSON.stringify({
      approval: c.st.stats.approval, demand: c.st.stats.demand, abs: d2.demandAbs, target: d2.target, migration: d2.migration,
      tourism: d2.tourism, tourists: d2.tourists, attractiveness: d2.attractiveness,
    })).toBe(before);
    // derived data is rebuilt (breakdown available) and the next days continue normally
    expect(approvalBreakdown(c.st).length).toBeGreaterThan(1);
    sim2.runDays(20);
    expect(c.st.stats.population).toBeGreaterThan(0);
  });

  it('legacy terms keep their formulas (tax term)', () => {
    const c = town();
    c.st.stats.residents = [0, 12000, 0];
    const t0 = approvalMonth(c.sim).tax;
    for (let k = 0; k < 3; k++) c.st.budget.taxRates[k] = 12;
    const t1 = approvalMonth(c.sim).tax;
    expect(t0).toBe(0);
    expect(t1).toBeCloseTo(-3.5 * 3, 5);
  });
});
