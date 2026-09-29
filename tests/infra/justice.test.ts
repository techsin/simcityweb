/**
 * WP7a justice (SIM_DEPTH_AMENDMENTS WP7-2, docs/SIM_DEPTH_PART_B.md items 9 / 10): arrests from the crime pass's arrest
 * potential, the sentenced share, the inmate stock, beds / holding cells, overflow -> policeMul / crimeMul, the
 * courthouse, prison riots, save / load of systemData.justice, and no unfixable penalty before the prison unlocks.
 */
import { describe, expect, it } from 'vitest';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { CATALOG, getDef, rebuildCatalogIndex } from '../../src/sim/catalog';
import { clearInfoCache } from '../../src/sim/infra/common';
import { ARREST_K, COURTHOUSE_POLICE_MUL, HOLDING_CELLS, JAIL_BEDS } from '../../src/sim/infra/params';
import { addArrestPotential, hash01, justiceData, justiceFactors, justiceMonthly, justiceRefresh } from '../../src/sim/infra/justice';
import { removeBuilding } from '../../src/sim/infra/common';
import { facilityReport } from '../../src/sim/infra/facilities';
import { emergencyOf } from '../../src/sim/infra/emergency';
import type { CrimeSystem } from '../../src/sim/infra/crime';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { newSim, newState, place, roadLine, stressCity } from './cityGen';

/** 2x2 test copies of the prison / courthouse (they fit the stress city's 2x2 blocks); tables resolve by model */
function registerJusticeDefs(): void {
  let added = false;
  for (const [src, id] of [['civ_jail', 'wp7a_jail22'], ['civ_courthouse', 'wp7a_court22']] as const) {
    if (getDef(id)) continue;
    const d = getDef(src)!;
    CATALOG.push({ ...d, id, footprint: [2, 2], requires: undefined, unique: false });
    added = true;
  }
  if (added) rebuildCatalogIndex();
  clearInfoCache();
}

/** remove every building overlapping the w x d rect at (x, z), then place `defId` there (powered + watered) */
function plopAt(st: CityState, defId: string, x: number, z: number): Building {
  const def = getDef(defId)!;
  const [w, d] = def.footprint;
  for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) {
    const id = st.building[st.idx(xx, zz)];
    if (id < 0) continue;
    const o = st.buildings.get(id)!;
    for (let a = o.z; a < o.z + o.d; a++) for (let c = o.x; c < o.x + o.w; c++) st.building[st.idx(c, a)] = -1;
    st.buildings.delete(id);
  }
  const b = place(st, defId, x, z);
  b.flags |= BF.Powered | BF.Watered;
  return b;
}

/** stress-city blocks (2x2 lots at 3k + 2) on a regular grid for n stations */
function gridLots(n: number, blocks = 42): [number, number][] {
  const g = Math.ceil(Math.sqrt(n));
  const out: [number, number][] = [];
  for (let a = 0; a < g; a++) for (let c = 0; c < g && out.length < n; c++) {
    out.push([Math.floor(((a + 0.5) / g) * blocks) * 3 + 2, Math.floor(((c + 0.5) / g) * blocks) * 3 + 2]);
  }
  return out;
}

function justiceCity(popScale: number, stations: number) {
  registerJusticeDefs();
  const city = stressCity(128, 7, { popScale, withTransit: false });
  const st = city.st;
  const police = gridLots(stations).map(([x, z]) => plopAt(st, 'civ_police_station', x, z));
  const sim = newSim(st);
  return { st, sim, pop: city.pop, police };
}

describe('justice: the monthly model', () => {
  it('60k city without a prison: overflow >= 0.5, policeMul <= 0.85, crime x crimeMul; a prison clears the overflow within 3 months, crime >= 5 % lower, the live stock follows inmates += sentenced - inmates / 12', { timeout: 600_000 }, () => {
    const { st, sim, pop } = justiceCity(0.4, 5);
    expect(pop).toBeGreaterThan(50000);
    expect(pop).toBeLessThan(80000);
    st.stats.unemployment = 0.1;
    st.unlocked.add('jail'); // the prison could be built, but is not
    sim.runDays(120);
    const j = st.stats.justice;
    console.log(`60k no prison: pop ${pop} potential ${Math.round(justiceData(st).potential)} arrests ${j.arrestsMonth}/mo holding ${j.holding} inmates ${Math.round(j.inmates)} overflow ${j.overflow} policeMul ${j.policeMul} crimeMul ${j.crimeMul} crime ${st.stats.avgCrime.toFixed(3)}`);
    expect(j.holding).toBe(5 * HOLDING_CELLS.civ_police_station);
    expect(j.beds).toBe(0);
    expect(j.overflow).toBeGreaterThanOrEqual(0.5);
    expect(j.policeMul).toBeLessThanOrEqual(0.85);
    expect(j.crimeMul).toBeCloseTo(1 + 0.15 * j.overflow, 3);
    expect(justiceFactors(st)).toEqual({ policeMul: j.policeMul, crimeMul: j.crimeMul });
    expect(j.arrestsMonth).toBeGreaterThan(0);
    // branch the same city: without / with a prison (crime is compared at the same time: piles, growth ... move it)
    const snap = serializeCity(st, { copy: true });
    const branch = (jail: boolean) => {
      const s2 = deserializeCity(structuredClone(snap) as SerializedCity);
      const sim2 = newSim(s2);
      if (jail) sim2.events.emit('buildingAdded', plopAt(s2, 'wp7a_jail22', 62, 62));
      return { s2, sim2 };
    };
    const A = branch(false), B = branch(true);
    let months = 0;
    while (B.s2.stats.justice.overflow > 0 && months < 3) { B.sim2.runDays(30); A.sim2.runDays(30); months++; }
    expect(B.s2.stats.justice.overflow).toBe(0);
    expect(B.s2.stats.justice.beds).toBe(JAIL_BEDS.civ_jail);
    expect(B.s2.stats.justice.policeMul).toBe(1);
    expect(B.s2.stats.justice.crimeMul).toBe(1);
    expect(A.s2.stats.justice.overflow).toBeGreaterThan(0.3);
    A.sim2.runDays(90); B.sim2.runDays(90);
    const cA = A.s2.stats.avgCrime, cB = B.s2.stats.avgCrime;
    console.log(`after ${months} + 3 months: crime without a prison ${cA.toFixed(3)}, with ${cB.toFixed(3)} (${((cB / cA - 1) * 100).toFixed(1)} %)`);
    expect(cB).toBeLessThanOrEqual(cA * 0.95);
    // the live stock follows the amended recurrence month by month (60k > 40k: every arrest is sentenced), i.e. it
    // converges to 12 x the monthly arrests (12-month sentences; the formula test checks the arithmetic)
    const inm0 = justiceData(B.s2).inmates;
    let expected = inm0;
    const off = B.sim2.events.on('month', () => { expected += B.s2.stats.justice.arrestsMonth - expected / 12; });
    B.sim2.runDays(180);
    off();
    const inm = B.s2.stats.justice.inmates;
    console.log(`6 months later: inmates ${inm0.toFixed(1)} -> ${inm.toFixed(1)}, recurrence ${expected.toFixed(1)}, 12 x arrests ${(12 * B.s2.stats.justice.arrestsMonth).toFixed(0)} (occupancy ${B.s2.stats.justice.occupancy})`);
    expect(inm).toBeGreaterThan(inm0);
    expect(Math.abs(inm - expected)).toBeLessThanOrEqual(0.02 * expected + 1);
    expect(B.s2.stats.justice.releasesMonth).toBeGreaterThan(0);
  });

  it('no unfixable penalty: below the prison unlock a town with a police station has overflow <= 0.05 (holding cells)', { timeout: 300_000 }, () => {
    const { st, sim, pop } = justiceCity(0.08, 1);
    expect(pop).toBeLessThan(15000);
    expect(st.unlocked.has('jail')).toBe(false);
    sim.runDays(150);
    const j = st.stats.justice;
    console.log(`${pop} residents, 1 station: arrests ${j.arrestsMonth}/mo inmates ${j.inmates.toFixed(1)} / holding ${j.holding} overflow ${j.overflow}`);
    expect(j.holding).toBe(HOLDING_CELLS.civ_police_station);
    expect(j.overflow).toBeLessThanOrEqual(0.05);
    expect(j.policeMul).toBeGreaterThanOrEqual(0.985);
  });

  it('the formula: sentencing ramps 5k -> 40k, stock and overflow as amended, holding cells x police funding, courthouse x1.08', () => {
    registerJusticeDefs();
    const st = newState(48);
    roadLine(st, 2, 20, 45, 20);
    place(st, 'civ_police_station', 10, 21).flags |= BF.Powered | BF.Watered;
    const sim = newSim(st);
    st.unlocked.add('jail');
    const d = justiceData(st);
    const run = (potential: number, pop: number, emArrests = 0) => {
      d.potential = potential;
      st.stats.population = pop;
      st.stats.emergency.lastMonth.arrests = emArrests;
      justiceMonthly(sim);
      return st.stats.justice;
    };
    // 60k: arrests = ARREST_K x potential + emergency arrests, all sentenced
    d.inmates = 0;
    let j = run(20000, 60000, 10);
    const arrests = ARREST_K * 20000 + 10;
    expect(j.arrestsMonth).toBeCloseTo(arrests, 1);
    expect(j.overflow).toBeCloseTo((12 * arrests - 25) / (12 * arrests), 3);
    expect(j.policeMul).toBeCloseTo(1 - 0.3 * j.overflow, 3);
    expect(j.inmates).toBeLessThanOrEqual(1.3 * 25 + 1e-6); // capped at 1.3 x places
    // 5k and below: petty offenders are not jailed
    d.inmates = 0;
    j = run(20000, 5000);
    expect(j.overflow).toBe(0);
    expect(j.inmates).toBe(0);
    // half funding halves the holding cells
    st.budget.funding.police = 50;
    j = run(100, 60000);
    expect(j.holding).toBe(Math.round(25 * Math.pow(0.5, 0.7)));
    st.budget.funding.police = 100;
    // courthouse: x1.08 on the police multiplier
    const base = run(20000, 60000);
    const pm0 = base.policeMul, ov0 = base.overflow;
    const court = place(st, 'wp7a_court22', 30, 21);
    court.flags |= BF.Powered | BF.Watered;
    j = run(20000, 60000);
    expect(j.overflow).toBe(ov0);
    expect(j.policeMul).toBeCloseTo(pm0 * COURTHOUSE_POLICE_MUL, 3);
    // stock dynamics: inmates += sentenced - inmates / 12
    const jail = place(st, 'wp7a_jail22', 36, 21);
    jail.flags |= BF.Powered | BF.Watered;
    d.inmates = 600;
    j = run(0, 60000);
    expect(j.inmates).toBeCloseTo(600 - 600 / 12, 3);
    expect(j.releasesMonth).toBeCloseTo(50, 1);
    expect(j.occupancy).toBeCloseTo(j.inmates / (JAIL_BEDS.civ_jail + 25), 2);
    // WP8's failed prison riot lets 30 % escape: the stock is a plain number it can scale
    (st.systemData.justice as { inmates: number }).inmates *= 0.7;
    j = run(0, 60000);
    expect(j.inmates).toBeCloseTo(550 * 0.7 * (11 / 12), 2);
  });

  it('prison riots: occupancy > 1.2 for 3 months -> hash(jail, month) < 0.25 spawns a prison riot at the jail (no rng draw)', () => {
    registerJusticeDefs();
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20);
    place(st, 'civ_police_station', 10, 21).flags |= BF.Powered | BF.Watered;
    const jail = place(st, 'wp7a_jail22', 30, 21);
    jail.flags |= BF.Powered | BF.Watered;
    const sim = newSim(st);
    st.unlocked.add('jail');
    const d = justiceData(st);
    const rng0 = sim.rng.state;
    let riotMonth = -1;
    for (let k = 0; k < 40 && riotMonth < 0; k++) {
      st.day += 30;
      d.potential = 2e6; // 8,000 arrests a month: the stock fills to its 1.3 x places cap
      st.stats.population = 200000;
      justiceMonthly(sim);
      if (emergencyOf(sim)!.incidents().some((i) => i.kind === 'prisonRiot' && i.buildingId === jail.id)) riotMonth = st.monthIndex;
    }
    expect(riotMonth).toBeGreaterThanOrEqual(0);
    expect(hash01(jail.id, riotMonth)).toBeLessThan(0.25);
    expect(d.riotMonth).toBe(riotMonth);
    expect(st.stats.justice.occupancy).toBeGreaterThan(1.2);
    expect(sim.rng.state).toBe(rng0);
  });
});

describe('justice: the numbers follow the buildings at once (refresh on placement / removal, end of day)', () => {
  it('a new prison counts the moment it is placed (report, stats and factors agree); an unpowered prison holds 30 % of its beds; bulldozing it brings the overflow back', () => {
    registerJusticeDefs();
    const st = newState(48);
    roadLine(st, 2, 20, 45, 20);
    const station = place(st, 'civ_police_station', 10, 21);
    station.flags |= BF.Powered | BF.Watered;
    const sim = newSim(st);
    st.unlocked.add('jail');
    const d = justiceData(st);
    d.potential = 20000; // 80 arrests a month
    st.stats.population = 60000;
    justiceMonthly(sim);
    const before = st.stats.justice;
    expect(before.overflow).toBeGreaterThan(0.9);
    expect(before.policeMul).toBeLessThan(0.75);
    // the station's report: stock and places (no "% full" next to the early releases), the yearly flow, the fix
    let rep = facilityReport(sim, station.id)!;
    const jails = rep.lines.find((l) => l.key === 'jails')!;
    expect(jails.value).toMatch(/inmates · 25 places/);
    expect(jails.value).not.toMatch(/full/);
    const ovf = rep.lines.find((l) => l.key === 'overflow')!;
    expect(ovf.value).toMatch(/≈960 sentences a year for 25 places/);
    expect(ovf.hint).toMatch(/build a prison/);
    // the quality line names the justice factor
    expect(rep.lines.find((l) => l.key === 'quality')!.hint).toMatch(/criminals released early −\d+%/);
    // place a prison (the plop path emits buildingAdded): counted at once, no month tick needed
    const jail = place(st, 'wp7a_jail22', 30, 21);
    jail.flags |= BF.Powered | BF.Watered;
    sim.events.emit('buildingAdded', jail);
    const j = st.stats.justice;
    expect(j.beds).toBe(JAIL_BEDS.civ_jail);
    expect(j.overflow).toBe(0);
    expect(j.policeMul).toBe(1);
    expect(j.crimeMul).toBe(1);
    rep = facilityReport(sim, jail.id)!;
    const inm = rep.lines.find((l) => l.key === 'inmates')!;
    expect(inm.value).toMatch(new RegExp(`/ ${JAIL_BEDS.civ_jail.toLocaleString('en-US')} \\(\\d+% full\\)`));
    expect(inm.status).toBe('ok');
    expect(inm.hint).toBeUndefined();
    expect(rep.lines.some((l) => l.key === 'overflow')).toBe(false);
    expect(facilityReport(sim, station.id)!.lines.some((l) => l.key === 'overflow')).toBe(false);
    // an unpowered prison holds only 30 % of its beds (and says so); power back (utilities emits buildingChanged) -> full
    // again at once; the end-of-day refresh catches any change without an event
    jail.flags &= ~BF.Powered;
    sim.events.emit('buildingChanged', jail);
    expect(st.stats.justice.beds).toBe(Math.round(JAIL_BEDS.civ_jail * 0.3));
    expect(facilityReport(sim, jail.id)!.warnings.some((w) => /^No power — holds only 30% of its beds/.test(w))).toBe(true);
    expect(facilityReport(sim, jail.id)!.lines.find((l) => l.key === 'inmates')!.value).toMatch(new RegExp(`/ ${Math.round(JAIL_BEDS.civ_jail * 0.3).toLocaleString('en-US')} \\(`));
    jail.flags |= BF.Powered;
    sim.events.emit('buildingChanged', jail);
    expect(st.stats.justice.beds).toBe(JAIL_BEDS.civ_jail);
    st.budget.funding.police = 50;
    sim.events.emit('day', st.day);
    expect(st.stats.justice.beds).toBe(Math.round(JAIL_BEDS.civ_jail * Math.pow(0.5, 0.7)));
    st.budget.funding.police = 100;
    justiceRefresh(sim);
    // bulldoze it: the overflow comes back right away
    removeBuilding(sim, jail);
    expect(st.stats.justice.beds).toBe(0);
    expect(st.stats.justice.overflow).toBeGreaterThan(0.9);
    expect(st.stats.justice.policeMul).toBeCloseTo(before.policeMul, 4);
    // the monthly rate the overflow projects is persisted (a save keeps it)
    expect(justiceData(st).sentenced).toBeCloseTo(80, 6);
  });
});

describe('justice: arrest potential, save / load', () => {
  it('the potential is the level of the latest crime pass (not a sum); a saved level survives crime.init on load', { timeout: 300_000 }, () => {
    const { st, sim } = justiceCity(0.2, 3);
    const crime = sim.getSystem<CrimeSystem>('crime')!;
    crime.compute(sim, false);
    const p1 = justiceData(st).potential;
    expect(p1).toBeGreaterThan(0);
    crime.compute(sim, false);
    const p2 = justiceData(st).potential;
    expect(p2).toBeGreaterThan(p1 * 0.8);
    expect(p2).toBeLessThan(p1 * 1.2);
    sim.runDays(75);
    st.stats.justice.inmates = justiceData(st).inmates;
    justiceData(st).potential = 12345.5; // a distinctive saved level
    const saved = structuredClone(st.systemData.justice);
    const back = deserializeCity(structuredClone(serializeCity(st, { copy: true })) as SerializedCity);
    expect(back.systemData.justice).toEqual(saved);
    expect(back.stats.justice).toEqual(st.stats.justice);
    expect(justiceFactors(back)).toEqual(justiceFactors(st));
    newSim(back); // crime.init recomputes its pass: the saved potential wins
    expect(justiceData(back).potential).toBe(12345.5);
    // a fresh city takes crime.init's pass
    const fresh = justiceCity(0.2, 3);
    expect(justiceData(fresh.st).potential).toBeGreaterThan(0);
    addArrestPotential(fresh.st, -5);
    addArrestPotential(fresh.st, NaN);
    expect(justiceData(fresh.st).potential).toBeGreaterThan(0);
  });
});
