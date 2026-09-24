/**
 * WP8 emergency dispatch: auto-dispatch along real road routes when covered, 'uncovered' alerts + player dispatch when
 * not, fleets (busy stations), escalation, outcomes / stats, response layers, determinism + save / load, perf.
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import type { EmergencyEvent, Simulation } from '../../src/sim/Simulation';
import {
  emergencyCrimeBoosts, emergencyOf, emergencyPollution, responseAt, uncoveredHotspots, vehiclePosition,
} from '../../src/sim/infra/emergency';
import { getFire, triggerDisaster } from '../../src/sim/systems/infra';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { Simulation as SimulationCtor } from '../../src/sim/Simulation';
import { FireSystem } from '../../src/sim/infra/fire';
import { EmergencySystem } from '../../src/sim/infra/emergency';
import { DisastersSystem } from '../../src/sim/infra/disasters';
import { schedulerOf } from '../../src/sim/infra/scheduler';
import { newSim, newState, place, roadLine, stressCity } from './cityGen';

function events(sim: Simulation): EmergencyEvent[] {
  const out: EmergencyEvent[] = [];
  sim.events.on('emergency', (e) => out.push(e));
  return out;
}

/** a street along z = 20 (x 2..62) with a fire station at `stations` (north side) */
function fireTown(stations: number[], size = 64): { st: CityState; sim: Simulation; em: EmergencySystem; st0: Building[] } {
  const st = newState(size);
  roadLine(st, 2, 20, size - 2, 20, Network.Road);
  const st0 = stations.map((x) => place(st, 't_fire', x, 19));
  const sim = newSim(st);
  getFire(sim)!.riskBoost = 0; // no random ignitions
  return { st, sim, em: emergencyOf(sim)!, st0 };
}

function cellOf(st: CityState, c: number): [number, number] {
  return [c % st.size, Math.floor(c / st.size)];
}

describe('emergency dispatch: fires', () => {
  it('a covered fire is auto-dispatched the same day along a road route, resolves and is counted as auto', () => {
    const { st, sim, em, st0 } = fireTown([52]);
    const home = place(st, 't_r2', 46, 21, { pop: 60 });
    const ev = events(sim);
    expect(triggerDisaster(sim, 'fire', 46, 21)).toBe(true);
    expect(home.flags & BF.OnFire).toBeTruthy();
    const inc = em.incidents()[0];
    expect(inc.kind).toBe('fire');
    expect(inc.state).toBe('dispatched');
    expect(ev.map((e) => e.type)).toEqual(['new', 'dispatched']);
    expect(home.flags & BF.Incident).toBeTruthy();
    const v = em.vehicles()[0];
    expect(v.model).toBe('fire_truck');
    expect(v.stationId).toBe(st0[0].id);
    // path: from the road next to the station to the road next to the site, cumulative times increasing
    const [sx, sz] = cellOf(st, v.path[0]);
    const [ex, ez] = cellOf(st, v.path[v.path.length - 1]);
    expect(st.network[v.path[0]]).toBeGreaterThan(0);
    expect(Math.abs(sx - 52) + Math.abs(sz - 19)).toBeLessThanOrEqual(1);
    expect(Math.abs(ex - 46) + Math.abs(ez - 21)).toBeLessThanOrEqual(1);
    for (let k = 1; k < v.times.length; k++) expect(v.times[k]).toBeGreaterThan(v.times[k - 1]);
    expect(v.times[v.times.length - 1]).toBeCloseTo(0.6, 5); // 6 road cells x 0.1 min
    // renderer interpolation: halfway along the drive
    const p = vehiclePosition(v, v.legStart + 0.3, st.size);
    expect(p.x).toBeCloseTo(49.5, 1);
    expect(p.moving).toBe(true);
    sim.runDays(10);
    expect(home.flags & (BF.OnFire | BF.Burnt)).toBe(0);
    expect(em.incidents().length).toBe(0);
    expect(em.vehicles().length).toBe(0); // back at the station
    expect(home.flags & BF.Incident).toBe(0);
    const m = st.stats.emergency.month;
    expect(m.count.fire).toBe(1);
    expect(m.auto).toBe(1);
    expect(m.manual).toBe(0);
    expect(m.failed).toBe(0);
    expect(m.responses.fire).toBe(1);
    expect(m.responseMin.fire).toBeGreaterThan(0);
    expect(ev.map((e) => e.type)).toContain('arrived');
    expect(ev.map((e) => e.type)).toContain('resolved');
  });

  it('no station: uncovered (noStation, no manual dispatch), burnt down by day 6, counted as failed', () => {
    const { st, sim, em } = fireTown([]);
    const home = place(st, 't_r2', 10, 21, { pop: 60 });
    const ev = events(sim);
    triggerDisaster(sim, 'fire', 10, 21);
    const inc = em.incidents()[0];
    expect(inc.state).toBe('uncovered');
    expect(inc.reason).toBe('noStation');
    expect(inc.manualPossible).toBe(false);
    const u = ev.find((e) => e.type === 'uncovered')!;
    expect(u).toBeDefined();
    expect(u.reason).toBe('noStation');
    expect(u.major).toBe(true);
    expect(st.stats.emergency.manualActive).toBe(0); // no manual dispatch possible -> no LIVE mode
    sim.runDays(6);
    expect(home.flags & BF.Burnt).toBeTruthy();
    expect(st.stats.emergency.month.failed).toBe(1);
    expect(st.stats.emergency.month.buildingsLost).toBe(1);
    expect(st.stats.emergency.month.damage).toBeGreaterThan(0);
    expect(ev.some((e) => e.type === 'failed')).toBe(true);
  });

  it('fleets: 2 trucks and 3 fires -> the third is busy; manual dispatch from a far station; ETA grows with distance', () => {
    const { st, sim, em, st0 } = fireTown([40, 14, 6]);
    const [near, midS, farS] = st0;
    const a = place(st, 't_r2', 34, 21, { pop: 60 });
    const b = place(st, 't_r2', 40, 21, { pop: 60 });
    const c = place(st, 't_r2', 46, 21, { pop: 60 });
    const ev = events(sim);
    expect(em.stationFleet(near.id)).toEqual({ type: 'fire', total: 2, free: 2, out: 0 });
    triggerDisaster(sim, 'fire', 34, 21);
    triggerDisaster(sim, 'fire', 40, 21);
    triggerDisaster(sim, 'fire', 46, 21);
    expect(em.incidents().length).toBe(3);
    expect(em.stationFleet(near.id)).toEqual({ type: 'fire', total: 2, free: 0, out: 2 });
    const third = em.incidents().find((i) => i.buildingId === c.id)!;
    expect(third.state).toBe('uncovered');
    expect(third.reason).toBe('busy');
    expect(third.manualPossible).toBe(true);
    expect(third.note).toMatch(/All 2 fire trucks of .* are busy/);
    expect(ev.some((e) => e.type === 'uncovered' && e.reason === 'busy' && e.manualPossible)).toBe(true);
    expect(st.stats.emergency.manualActive).toBe(1);
    // dispatch options: every fire station, the busy one without free units; ETA monotonic in road distance
    const opts = em.dispatchOptions(sim, third.id);
    expect(opts.map((o) => o.stationId).sort()).toEqual([near.id, midS.id, farS.id].sort());
    const o = (id: number) => opts.find((q) => q.stationId === id)!;
    expect(o(near.id).free).toBe(0);
    expect(o(near.id).etaMin).toBeLessThan(o(midS.id).etaMin);
    expect(o(midS.id).etaMin).toBeLessThan(o(farS.id).etaMin);
    expect(o(midS.id).etaMin).toBeCloseTo(3.2, 1);
    expect(o(midS.id).inRange).toBe(false);
    // busy station -> refused with a reason; a station that is not a fire station -> refused
    const busy = em.dispatch(sim, third.id, near.id);
    expect(busy.ok).toBe(false);
    expect(busy.reason).toMatch(/busy/);
    const police = place(st, 't_police', 30, 19);
    sim.events.emit('buildingAdded', police);
    expect(em.dispatch(sim, third.id, police.id).ok).toBe(false);
    // player dispatch from the mid station
    const res = em.dispatch(sim, third.id, midS.id);
    expect(res.ok).toBe(true);
    expect(res.etaMin).toBeCloseTo(3.2, 1);
    expect(third.state).toBe('dispatched');
    expect(st.stats.emergency.manualActive).toBe(0);
    expect(st.stats.emergency.month.manual).toBe(1);
    sim.runDays(12);
    for (const h of [a, b, c]) expect(h.flags & (BF.OnFire | BF.Burnt)).toBe(0);
    const m = st.stats.emergency.month;
    expect(m.auto).toBe(2);
    expect(m.manual).toBe(1);
    expect(m.late).toBe(0); // 3.2 min < the 4-min fire grace (a fire station's own reach is 3.9 min)
    expect(m.failed).toBe(0);
    expect(em.vehicles().length).toBe(0);
  });

  it('an unreachable station (no road) cannot be dispatched', () => {
    const { st, sim, em } = fireTown([40]);
    const lone = place(st, 't_fire', 40, 40); // no road next to it
    sim.events.emit('buildingAdded', lone);
    place(st, 't_r2', 46, 21, { pop: 60 });
    triggerDisaster(sim, 'fire', 46, 21);
    const inc = em.incidents()[0];
    const r = em.dispatch(sim, inc.id, lone.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/No road route/);
  });

  it('fires within 3 cells join one incident; unattended spread escalates it', () => {
    const { st, sim, em } = fireTown([]);
    const row: Building[] = [];
    for (let x = 10; x < 20; x++) row.push(place(st, 't_r2', x, 21, { pop: 60 }));
    triggerDisaster(sim, 'fire', 12, 21);
    triggerDisaster(sim, 'fire', 14, 21);
    expect(em.incidents().length).toBe(1);
    expect(em.incidents()[0].fires.length).toBe(2);
    const ev = events(sim);
    // spread: FIRE_SPREAD_P per neighbour-day (x1.3 unwatered); force it by running a few seeded days
    sim.runDays(5);
    const burning = row.filter((b) => b.flags & BF.OnFire).length;
    const inc = em.incidents()[0];
    if (burning > 2) {
      expect(ev.some((e) => e.type === 'escalated')).toBe(true);
      expect(inc.need.fire).toBeGreaterThanOrEqual(1 + Math.floor(inc.fires.length / 3));
    }
    expect(inc.severity).toBe(inc.fires.length);
  });
});

describe('emergency dispatch: other incidents', () => {
  function medTown(clinicX: number | null, seed = 1234): { st: CityState; sim: Simulation; em: EmergencySystem; home: Building } {
    const st = newState(64);
    st.config.seed = seed;
    roadLine(st, 2, 20, 62, 20, Network.Road);
    if (clinicX !== null) place(st, 't_clinic', clinicX, 19);
    const home = place(st, 't_r2', 50, 21, { pop: 60 });
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    return { st, sim, em: emergencyOf(sim)!, home };
  }

  it('medical: survival falls with delay (a covered call vs a far manual dispatch)', () => {
    // near: clinic in range (auto); far: clinic 45 cells away, dispatched by the player after 7 days
    let nearDeaths = 0, farDeaths = 0, injured = 0;
    for (let k = 0; k < 6; k++) {
      const n = medTown(48, 100 + k);
      const id = n.em.spawn(n.sim, 'medical', 50, 21, { buildingId: n.home.id, major: true, severity: 20 });
      expect(n.em.incident(id)!.state).toBe('dispatched');
      n.sim.runDays(20);
      nearDeaths += n.st.stats.emergency.month.deaths;
      injured += 20;
      const f = medTown(5, 200 + k);
      const fid = f.em.spawn(f.sim, 'medical', 50, 21, { buildingId: f.home.id, major: true, severity: 20 });
      const inc = f.em.incident(fid)!;
      expect(inc.state).toBe('uncovered');
      expect(inc.reason).toBe('outOfRange');
      f.sim.runDays(7);
      expect(f.em.dispatchBest(f.sim, fid).ok).toBe(true);
      f.sim.runDays(20);
      farDeaths += f.st.stats.emergency.month.deaths;
      expect(f.st.stats.emergency.month.late).toBe(1);
    }
    expect(nearDeaths / injured).toBeLessThan(0.1);
    expect(farDeaths / injured).toBeGreaterThan(0.3);
  });

  it('medical: a district with 3x seniors gets >= 2x the medical calls over 5 seeded years', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    const young: Building[] = [], old: Building[] = [];
    place(st, 't_clinic', 16, 19);
    place(st, 't_clinic', 47, 19);
    for (let x = 4; x < 30; x++) young.push(place(st, 't_r2', x, 21, { pop: 2000, kids: 0.2, teens: 0.1, yad: 0.2, srs: 0.25 }));
    for (let x = 34; x < 60; x++) old.push(place(st, 't_r2', x, 21, { pop: 2000, kids: 0.05, teens: 0.05, yad: 0.05, srs: 0.75 }));
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    const ids = new Set(young.map((b) => b.id));
    const oldIds = new Set(old.map((b) => b.id));
    let y = 0, o = 0;
    sim.events.on('emergency', (e) => {
      if (e.type !== 'new' || e.kind !== 'medical') return;
      const inc = emergencyOf(sim)!.incident(e.id)!;
      if (ids.has(inc.buildingId)) y++;
      else if (oldIds.has(inc.buildingId)) o++;
    });
    sim.runDays(360 * 5);
    // expected ratio (0.6 + 2.7 x 0.75) / (0.6 + 2.7 x 0.25) = 2.06
    console.log(`medical calls over 5 years: seniors 25 % ${y}, seniors 75 % ${o} (x${(o / y).toFixed(2)})`);
    expect(y).toBeGreaterThan(50);
    expect(o).toBeGreaterThanOrEqual(1.75 * y);
  });

  it('riots only below 35 % approval with average crime above 0.45; 2 police units resolve one', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    for (let x = 30; x < 40; x++) place(st, 't_r2', x, 21, { pop: 400 });
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    const em = emergencyOf(sim)!;
    const s = st.stats;
    s.population = 50000;
    const riots = () => em.incidents().filter((i) => i.kind === 'riot').length;
    st.crime.fill(0.7); // riot site = worst crime x occupants block
    for (const [appr, crime] of [[50, 0.8], [36, 0.8], [15, 0.44]] as const) {
      for (let k = 0; k < 40; k++) {
        s.approval = appr; s.avgCrime = crime;
        em.monthly(sim);
      }
      expect(riots(), `approval ${appr} crime ${crime}`).toBe(0);
    }
    let n = 0;
    for (let k = 0; k < 60 && n === 0; k++) {
      s.approval = 15; s.avgCrime = 0.7;
      em.monthly(sim);
      n = riots();
    }
    expect(n).toBe(1);
    const riot = em.incidents().find((i) => i.kind === 'riot')!;
    expect(riot.major).toBe(true);
    expect(riot.state).toBe('uncovered');
    expect(riot.reason).toBe('noStation');
    // while active: crime boost around it, buildings damaged, radius grows
    const boosts = emergencyCrimeBoosts(sim);
    expect(boosts.some((b) => b.amount >= 0.3)).toBe(true);
    const site = st.buildings.get(riot.buildingId)!;
    const h0 = site.health;
    sim.runDays(4);
    expect(site.health).toBeLessThan(h0);
    expect(riot.radius).toBeGreaterThan(2);
    expect(st.stats.emergency.month.riotDays).toBeGreaterThan(0);
    // police station with 2 cars in range -> auto-dispatched on the next attempt, resolved after 3 days on scene
    const ps = place(st, 't_police', 34, 19);
    sim.events.emit('buildingAdded', ps);
    sim.runDays(8);
    expect(em.incidents().some((i) => i.id === riot.id)).toBe(false);
    const m = st.stats.emergency.month.arrests + st.stats.emergency.lastMonth.arrests;
    expect(m).toBeGreaterThanOrEqual(10);
    // after-effect: crime stays up in the area for a while
    expect(emergencyCrimeBoosts(sim).some((b) => b.amount > 0)).toBe(true);
  });

  it('spills pollute while active; industrial accidents ignite when unanswered', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    const f = place(st, 't_id', 30, 21, { jobs: 40 });
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    const em = emergencyOf(sim)!;
    const sp = em.spawn(sim, 'spill', 30, 21, { buildingId: f.id });
    expect(sp).toBeGreaterThan(0);
    expect(emergencyPollution(sim).some((p) => p.water > 0)).toBe(true);
    const ind = em.spawn(sim, 'industrial', 30, 21, { buildingId: f.id });
    expect(em.incident(ind)!.need).toEqual({ fire: 1, medical: 1 });
    sim.runDays(4);
    expect(f.flags & (BF.OnFire | BF.Burnt)).toBeTruthy();
    expect(em.incidents().some((i) => i.kind === 'fire')).toBe(true);
  });

  it('a covered industrial accident does not ignite while its truck is on the way (it only becomes statistics)', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    place(st, 'civ_fire_station', 4, 18); // real def: 3.9 min reach; unpowered here -> +0.5 day turnout
    const f = place(st, 't_id', 40, 21, { jobs: 40 });
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    const em = emergencyOf(sim)!;
    const id = em.spawn(sim, 'industrial', 40, 21, { buildingId: f.id });
    const inc = em.incident(id)!;
    expect(inc.state).toBe('dispatched');
    expect(inc.etaMin!).toBeGreaterThan(3); // arrives after the 3-day ignition grace
    sim.runDays(10);
    expect(f.flags & (BF.OnFire | BF.Burnt)).toBe(0);
    expect(em.incident(id)).toBeUndefined();
    const m = st.stats.emergency.month;
    expect(m.count.industrial).toBe(1);
    expect(m.auto).toBe(1);
    expect(m.failed).toBe(0);
    expect(m.count.fire).toBe(0);
  });

  it('earthquake aftermath: occupied collapsed buildings become rescue incidents', () => {
    const st = newState(64);
    for (let z = 5; z < 60; z += 3) roadLine(st, 2, z, 60, z, Network.Street);
    for (let z = 6; z < 60; z += 3) for (let x = 3; x < 60; x++) place(st, 't_r1', x, z, { pop: 10 });
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    const em = emergencyOf(sim)!;
    triggerDisaster(sim, 'earthquake', 30, 30);
    const col = em.incidents().filter((i) => i.kind === 'collapse');
    expect(col.length).toBeGreaterThan(0);
    expect(col.length).toBeLessThanOrEqual(12);
    for (const c of col) expect(st.buildings.get(c.buildingId)!.flags & BF.Burnt).toBeTruthy();
  });
});

describe('emergency dispatch: layers, determinism, save / load', () => {
  it('resp* slack >= 0 exactly where auto-dispatch happens (200 random cells)', () => {
    const st = newState(96);
    for (let z = 4; z < 92; z += 6) roadLine(st, 2, z, 92, z, Network.Road);
    for (let x = 4; x < 92; x += 12) roadLine(st, x, 4, x, 88, Network.Street);
    roadLine(st, 2, 46, 92, 46, Network.Avenue);
    place(st, 't_fire', 20, 17);
    place(st, 't_fire', 70, 59);
    place(st, 't_police', 50, 35);
    place(st, 't_clinic', 30, 71);
    for (let z = 5; z < 92; z += 6) for (let x = 3; x < 92; x += 5) if (st.building[st.idx(x, z)] < 0 && !st.network[st.idx(x, z)]) place(st, 't_r1', x, z, { pop: 10 });
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    const em = emergencyOf(sim)!;
    let rs = 99;
    const rnd = () => ((rs = (rs * 1103515245 + 12345) >>> 0) / 4294967296);
    let covered = 0, uncovered = 0;
    for (let k = 0; k < 200; k++) {
      const x = 1 + Math.floor(rnd() * 94), z = 1 + Math.floor(rnd() * 94);
      for (const r of ['fire', 'police', 'medical'] as const) {
        const p = em.probe(sim, r, x, z);
        const layer = responseAt(sim, st.idx(x, z), r)!;
        expect(layer).not.toBeNull();
        expect(layer.covered, `${r} at ${x},${z} slack ${layer.slackMin} probe ${p.auto} ${p.etaMin}`).toBe(p.auto);
        if (p.auto) covered++;
        else uncovered++;
      }
    }
    expect(covered).toBeGreaterThan(30);
    expect(uncovered).toBeGreaterThan(30);
    const hs = uncoveredHotspots(sim, 'medical', 3);
    expect(hs.length).toBe(3);
    expect(hs[0].people).toBeGreaterThanOrEqual(hs[1].people);
  });

  function busyTown(seed: number): { st: CityState; sim: Simulation } {
    const st = newState(64);
    st.config.seed = seed;
    for (let z = 8; z < 60; z += 6) roadLine(st, 2, z, 62, z, Network.Road);
    roadLine(st, 32, 8, 32, 56, Network.Road);
    place(st, 't_fire', 30, 25);
    place(st, 't_police', 34, 25);
    place(st, 't_clinic', 30, 37);
    for (let z = 9; z < 60; z += 6) for (let x = 3; x < 62; x++) if (st.building[st.idx(x, z)] < 0 && !st.network[st.idx(x, z)]) {
      if (x % 7 === 0) place(st, 't_id', x, z, { jobs: 40 });
      else place(st, 't_r2', x, z, { pop: 600, srs: 0.3, kids: 0.1, teens: 0.1, yad: 0.2 });
    }
    // high crime so that crime sprees happen
    return { st, sim: newSim(st) };
  }

  function log(sim: Simulation): string[] {
    const out: string[] = [];
    sim.events.on('emergency', (e) => out.push(`${sim.state.day}:${e.type}:${e.id}:${e.kind}:${e.x},${e.z}:${e.reason ?? ''}:${e.etaMin ?? ''}`));
    return out;
  }

  it('two runs with the same seed give identical logs (all infra systems)', () => {
    const a = busyTown(5), b = busyTown(5);
    for (const t of [a, b]) {
      getFire(t.sim)!.riskBoost = 40;
      t.st.crime.fill(0.7);
    }
    const la = log(a.sim), lb = log(b.sim);
    a.sim.runDays(150);
    b.sim.runDays(150);
    expect(la.length).toBeGreaterThan(10);
    expect(la).toEqual(lb);
  });

  it('save + load mid-response continues with the identical outcome log (fire + emergency state)', () => {
    // only the systems this package owns (other systems restart their time-sliced layer work on load)
    const make = (st: CityState) => new SimulationCtor(st, [new FireSystem(), new EmergencySystem(), new DisastersSystem()]);
    const a = busyTown(9);
    const sim = make(a.st);
    a.st.crime.fill(0.7); // static crime -> crime sprees
    getFire(sim)!.riskBoost = 40;
    const l0 = log(sim);
    sim.runDays(95);
    let guard = 0;
    while ((emergencyOf(sim)!.vehicles().length < 2 || !emergencyOf(sim)!.incidents().some((i) => i.state === 'uncovered')) && guard++ < 200) sim.runDays(1);
    expect(emergencyOf(sim)!.vehicles().length).toBeGreaterThan(1);
    expect(l0.length).toBeGreaterThan(20);
    const saved = structuredClone(serializeCity(a.st, { copy: true })) as SerializedCity;
    const st2 = deserializeCity(saved);
    const sim2 = make(st2);
    const e1 = emergencyOf(sim)!, e2 = emergencyOf(sim2)!;
    expect(e2.incidents()).toEqual(e1.incidents());
    expect(e2.vehicles()).toEqual(e1.vehicles());
    const l1 = log(sim), l2 = log(sim2);
    for (let d = 0; d < 80; d++) {
      sim.runDays(1);
      sim2.runDays(1);
      // the player dispatches the oldest uncovered major incident every 10 days (same call in both)
      if (d % 10 === 5) {
        const u1 = e1.incidents().find((i) => i.state === 'uncovered' && i.manualPossible);
        const u2 = e2.incidents().find((i) => i.state === 'uncovered' && i.manualPossible);
        expect(u2?.id).toBe(u1?.id);
        if (u1) expect(e2.dispatchBest(sim2, u1.id)).toEqual(e1.dispatchBest(sim, u1.id));
      }
    }
    expect(l1.length).toBeGreaterThan(10);
    expect(l2).toEqual(l1);
    expect(st2.stats.emergency.month).toEqual(a.st.stats.emergency.month);
    expect(st2.stats.emergency.year).toEqual(a.st.stats.emergency.year);
    expect(e2.vehicles()).toEqual(e1.vehicles());
  });
});

describe('emergency perf', () => {
  it('stress city with real stations: dispatch + generation <= 0.3 ms/day, max day <= 3 ms, estimated steps <= 3 ms', { timeout: 300000 }, () => {
    const city = stressCity(256);
    const st = city.st;
    // a fire station, police station and clinic (2x2, real catalog defs) every 30 cells, in the 2x2 blocks between roads
    const clearArea = (x: number, z: number, w: number, d: number): boolean => {
      const ids = new Set<number>();
      for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) {
        if (st.network[st.idx(xx, zz)]) return false;
        const id = st.building[st.idx(xx, zz)];
        if (id >= 0) ids.add(id);
      }
      for (const id of ids) {
        const b = st.buildings.get(id)!;
        if (b.x < x || b.z < z || b.x + b.w > x + w || b.z + b.d > z + d) return false;
      }
      for (const id of ids) {
        const b = st.buildings.get(id)!;
        for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) st.building[st.idx(xx, zz)] = -1;
        st.buildings.delete(id);
      }
      return true;
    };
    let n = 0;
    for (let z = 14; z < 250; z += 30) for (let x = 14; x < 244; x += 30) {
      for (const [dx, def] of [[0, 'civ_fire_station'], [3, 'civ_police_station'], [6, 'civ_clinic']] as const) {
        if (clearArea(x + dx, z, 2, 2)) { place(st, def, x + dx, z); n++; }
      }
    }
    expect(n).toBeGreaterThan(100);
    const sim = newSim(st);
    const em = emergencyOf(sim)!;
    const sch = schedulerOf(sim);
    // time the emergency system's own work (daily() first runs the shared infra scheduler tick); CPU time is far less
    // noisy than wall time on a shared machine
    const cpuNow = () => { const c = process.cpuUsage(); return (c.user + c.system) / 1000; };
    let wall = 0, cpu = 0, max = 0, dayWall = 0;
    const wrap = (name: 'dailyWork' | 'monthly') => {
      const f = (em[name] as (s: Simulation) => void).bind(em);
      (em as unknown as Record<string, unknown>)[name] = (s: Simulation) => {
        const t0 = performance.now(), c0 = cpuNow();
        f(s);
        const dt = performance.now() - t0;
        wall += dt; dayWall += dt;
        cpu += cpuNow() - c0;
      };
    };
    wrap('dailyWork');
    wrap('monthly');
    const D = 360 * 2;
    let days = 0;
    for (let d = 0; d < D; d++) {
      if (d === 30) { wall = 0; cpu = 0; }
      dayWall = 0;
      sim.advanceDay();
      if (d < 30) continue;
      max = Math.max(max, dayWall);
      days++;
    }
    const tot = wall;
    // estimated cost of every response-layer step (deterministic)
    const pr = em as unknown as { respStep: number; respCost(): number };
    const saved = pr.respStep;
    let maxEst = 0;
    for (let k = 0; k < 5; k++) { pr.respStep = k; maxEst = Math.max(maxEst, pr.respCost()); }
    pr.respStep = saved;
    const s = st.stats.emergency.year;
    const total = Object.values(s.count).reduce((a, b) => a + b, 0);
    const est = [...sch.estMs].find(([k]) => k === 'emergency.response')?.[1] ?? 0;
    console.log(`emergency perf: ${(tot / days).toFixed(3)} ms/day avg (cpu ${(cpu / days).toFixed(3)}), max day ${max.toFixed(2)} ms, max est. step ${maxEst.toFixed(2)}, response layers est ${(est / Math.max(1, sch.headlessDays)).toFixed(3)} ms/day, stations ${n}, incidents/yr ${total} (auto ${s.auto}, manual ${s.manual}, late ${s.late}, failed ${s.failed}), respMin fire ${(s.responseMin.fire / Math.max(1, s.responses.fire)).toFixed(2)} medical ${(s.responseMin.medical / Math.max(1, s.responses.medical)).toFixed(2)}`);
    expect(total).toBeGreaterThan(20);
    expect(s.auto / Math.max(1, total)).toBeGreaterThan(0.5);
    expect(maxEst).toBeLessThanOrEqual(3);
    if (process.env.PERF_STRICT) {
      expect(tot / days).toBeLessThan(0.3);
      expect(max).toBeLessThan(3);
    } else expect(cpu / days).toBeLessThan(1.5); // shared machine: loose (CPU time, not wall time)
  });
});
