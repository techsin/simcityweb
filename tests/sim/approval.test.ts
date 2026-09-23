/**
 * SIM_DEPTH_SPEC WP4: approval as named, resident-weighted terms (econData.approvalTerms / approvalBreakdown).
 */
import { describe, expect, it } from 'vitest';
import { makeCity, road } from './helpers';
import { Network, Zone } from '../../src/core/types';
import { BF, type Building } from '../../src/sim/CityState';
import type { SimSystem, Simulation } from '../../src/sim/Simulation';
import { getDef } from '../../src/sim/catalog';
import { econData } from '../../src/sim/economy/runtime';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { APPROVAL_LABELS, approvalBreakdown } from '../../src/sim/economy/approval';
import { sumTerms } from '../../src/sim/explain';
import { APPROVAL_TERMS } from '../../src/sim/economy/tuning';

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
    expect(T.garbage).toBeCloseTo(APPROVAL_TERMS.garbage * 0.25, 5);
    expect(T.outages).toBeCloseTo(APPROVAL_TERMS.unpowered / 8 + APPROVAL_TERMS.unwatered / 8, 5);
    expect(T.noise).toBeLessThan(0);
    expect(T.garbage).toBeLessThan(0);
    expect(T.outages).toBeLessThan(0);
    // bad tap water
    c.st.stats.tapWater = 0.5;
    expect(approvalMonth(c.sim).tapWater).toBeCloseTo(-6, 5);
  });

  it('unmet needs, HQ and tourism', () => {
    const c = town();
    const n = c.st.stats.needs;
    n.elementary.need = 1000; n.elementary.unreached = 500;
    n.high.need = 1000; n.high.unreached = 0;
    n.health.need = 400; n.health.unreached = 400;
    let T = approvalMonth(c.sim);
    expect(T.needs).toBeCloseTo(APPROVAL_TERMS.kidsUnreached * 0.25 + APPROVAL_TERMS.seniorsHealth, 5);
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
