/**
 * Regression (routed item 2): a burning building is listed by at most one fire incident, once.
 *
 * The crash: EmergencySystem.fireStep stepped `fire.fires.get(b.id)!` for every listed building; a building listed
 * twice was stepped twice a day, and the day the first pass put it out (or burnt it down) the second read a fire that
 * was gone: "TypeError: Cannot read properties of undefined (reading 'days')" (256x60 seed 7 / seed 11 bot runs).
 * How the id got there twice: fireStep put a building out but left its id in inc.fires until the end of the step;
 * putOut clears OnFire, so the spread pass of the same step could re-ignite it from a burning neighbour; onFire then
 * appended the id again (the stale entry made the incident "near"), and the end-of-step filter kept both entries
 * because the building was burning again. If an older fire incident was also near, the building was listed by both.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { FireSystem } from '../../src/sim/infra/fire';
import { EmergencySystem, type Incident } from '../../src/sim/infra/emergency';
import { DisastersSystem } from '../../src/sim/infra/disasters';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { newState, place, roadLine } from './cityGen';

type Sys = { sim: Simulation; st: CityState; fire: FireSystem; em: EmergencySystem };

/** the fire + emergency systems only (like the save / load test in emergency.test.ts) */
function make(st: CityState): Sys {
  const sim = new Simulation(st, [new FireSystem(), new EmergencySystem(), new DisastersSystem()]);
  return { sim, st, fire: sim.getSystem<FireSystem>('fire')!, em: sim.getSystem<EmergencySystem>('emergency')! };
}

/** a street along z = 20 and a row of 1x1 homes at z = 21 on the given x (no fire station: fires burn on their own) */
function row(xs: number[]): Sys & { b: Map<number, Building> } {
  const st = newState(64);
  roadLine(st, 2, 20, 62, 20, Network.Road);
  const b = new Map<number, Building>();
  for (const x of xs) b.set(x, place(st, 't_r2', x, 21, { pop: 60 }));
  const s = make(st);
  s.fire.riskBoost = 0; // no random ignitions
  return { ...s, b };
}

/** the next draw of the emergency RNG after `id` is put out returns 0: the spread roll onto `id` succeeds (p > 0) */
function forceSpreadBackOnto(s: Sys, id: number): { armed: () => boolean } {
  const rng = (s.em as unknown as { rng: { next(): number } }).rng;
  const next = rng.next.bind(rng);
  let force = false;
  rng.next = () => {
    if (!force) return next();
    force = false;
    next(); // keep the sequence position of the replaced draw
    return 0;
  };
  const putOut = s.fire.putOut.bind(s.fire);
  s.fire.putOut = (sim, b) => {
    if (b.id === id) force = true;
    putOut(sim, b);
  };
  return { armed: () => force };
}

function occurrences(em: EmergencySystem, id: number): { inc: number; n: number }[] {
  const out: { inc: number; n: number }[] = [];
  for (const inc of em.incidents()) {
    const n = inc.fires.filter((x) => x === id).length;
    if (n) out.push({ inc: inc.id, n });
  }
  return out;
}

/** end-of-day invariants: every listed id once, by one incident, a burning building whose fire names that incident,
 *  and every registered fire listed by the incident it names */
function checkInvariants(s: Sys): void {
  const owner = new Map<number, number>();
  for (const inc of s.em.incidents()) {
    for (const id of inc.fires) {
      expect(owner.has(id), `day ${s.st.day}: building ${id} listed by incident ${owner.get(id)} and again by ${inc.id}`).toBe(false);
      owner.set(id, inc.id);
      const f = s.fire.fires.get(id);
      const b = s.st.buildings.get(id);
      expect(!!f && !!b && (b.flags & BF.OnFire) !== 0, `day ${s.st.day}: incident ${inc.id} lists ${id} without a fire`).toBe(true);
      expect(f!.incidentId, `day ${s.st.day}: the fire of ${id} names another incident`).toBe(inc.id);
    }
    if (inc.kind === 'fire') expect(inc.severity).toBe(inc.fires.length);
  }
  for (const [id, f] of s.fire.fires) expect(owner.get(id), `day ${s.st.day}: fire ${id} is not listed by its incident`).toBe(f.incidentId);
}

/** the scratch reproduction's dense town: 3-deep rows of 1x1 homes / factories between roads every 4 cells, 2 stations */
function denseTown(seed: number): Sys {
  const st = newState(64);
  st.config.seed = seed;
  for (let z = 6; z < 60; z += 4) roadLine(st, 2, z, 62, z, Network.Road);
  roadLine(st, 32, 6, 32, 58, Network.Road);
  place(st, 't_fire', 30, 23);
  place(st, 't_fire', 34, 43);
  for (let z = 7; z < 60; z += 4) for (let dz = 0; dz < 3; dz++) for (let x = 3; x < 62; x++) {
    const zz = z + dz;
    if (zz >= 62 || st.building[st.idx(x, zz)] >= 0 || st.network[st.idx(x, zz)]) continue;
    if (x % 7 === 0) place(st, 't_id', x, zz, { jobs: 40 });
    else place(st, 't_r2', x, zz, { pop: 600 });
  }
  return make(st);
}

/** one day of the dense town with a high, constant ignition risk (riskBoost decays while nothing burns) */
function hotDay(s: Sys): void {
  s.fire.riskBoost = 200;
  s.sim.runDays(1);
}

/** canonical form: object keys sorted (a loaded game rebuilds some saved objects with another key order), typed
 *  arrays as plain arrays */
function canon(v: unknown): unknown {
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) o[k] = canon((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}

/** hash of the whole saved city except its save time and the news feed (the news throttles are not saved, so a loaded
 *  game can word its news differently; the simulation is the same) */
function cityHash(st: CityState): string {
  const sc = structuredClone(serializeCity(st, { copy: true })) as unknown as { savedAt?: number; data: { news?: unknown } };
  delete sc.savedAt;
  delete sc.data.news;
  return createHash('sha1').update(JSON.stringify(canon(sc))).digest('hex');
}

describe('fire incidents never list a building twice', () => {
  it('a building put out and re-ignited by its neighbour in the same fire step is listed once', () => {
    const s = row([30, 31]);
    const [a, b] = [s.b.get(30)!, s.b.get(31)!];
    expect(s.fire.ignite(s.sim, a)).toBe(true);
    expect(s.fire.ignite(s.sim, b)).toBe(true);
    const inc = s.em.incidents()[0];
    expect(s.em.incidents().length).toBe(1);
    expect(inc.fires).toEqual([a.id, b.id]);
    s.sim.runDays(1);
    // a's fire is out at the next step (heat 0); b keeps burning and its spread roll onto a succeeds
    s.fire.fires.get(a.id)!.heat = 0;
    const f = forceSpreadBackOnto(s, a.id);
    const saved0 = inc.saved;
    s.sim.runDays(1);
    expect(f.armed()).toBe(false); // the forced roll was used: a was put out, then re-ignited by b's spread
    expect(inc.saved).toBe(saved0 + 1);
    expect(a.flags & BF.OnFire).toBeTruthy();
    expect(s.fire.fires.get(a.id)).toMatchObject({ days: 0, heat: 1, incidentId: inc.id }); // a new fire
    expect(occurrences(s.em, a.id)).toEqual([{ inc: inc.id, n: 1 }]);
    expect(new Set(inc.fires).size).toBe(inc.fires.length);
    expect(inc.severity).toBe(2);
    checkInvariants(s);
    // both burn out without a crew (no station): no crash, each building stepped once a day
    let prevDays = s.fire.fires.get(a.id)!.days;
    for (let d = 0; d < 8; d++) {
      s.sim.runDays(1);
      const fa = s.fire.fires.get(a.id);
      if (fa) {
        expect(fa.days - prevDays).toBe(1);
        prevDays = fa.days;
      }
      checkInvariants(s);
    }
    expect(a.flags & BF.Burnt).toBeTruthy();
    expect(b.flags & BF.Burnt).toBeTruthy();
    expect(s.em.incidents().filter((i) => i.kind === 'fire').length).toBe(0);
    expect(s.fire.fires.size).toBe(0);
  });

  it('re-ignited next to an older incident: listed by that incident only, not also by the one that put it out', () => {
    const s = row([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    const id = (x: number) => s.b.get(x)!.id;
    for (const x of [10, 16, 17, 13, 14]) expect(s.fire.ignite(s.sim, s.b.get(x)!)).toBe(true);
    const [older, inc] = s.em.incidents();
    expect(older.fires).toEqual([id(10), id(13), id(14)]); // 13 / 14 joined the older incident (within 3 cells of 10)
    expect(inc.fires).toEqual([id(16), id(17)]); // 16 was more than 3 cells from it when it ignited
    s.fire.fires.get(id(16))!.heat = 0;
    const f = forceSpreadBackOnto(s, id(16));
    s.sim.runDays(1);
    expect(f.armed()).toBe(false);
    expect(s.b.get(16)!.flags & BF.OnFire).toBeTruthy();
    // first incident within FIRE_CLUSTER_R in list order (the older one, via 14) — and only that one
    expect(occurrences(s.em, id(16))).toEqual([{ inc: older.id, n: 1 }]);
    expect(s.fire.fires.get(id(16))!.incidentId).toBe(older.id);
    checkInvariants(s);
    for (let d = 0; d < 8; d++) {
      s.sim.runDays(1);
      checkInvariants(s);
    }
  });

  it('a fire that ended outside its incident\'s step and re-ignites before the next one joins that incident once', () => {
    const s = row([30, 31]);
    const [a, b] = [s.b.get(30)!, s.b.get(31)!];
    s.fire.ignite(s.sim, a);
    s.fire.ignite(s.sim, b);
    const inc = s.em.incidents()[0];
    s.fire.extinguish(s.sim, a); // UI / cheat: the incident still lists a until its next step
    expect(inc.fires).toEqual([a.id, b.id]);
    expect(s.fire.ignite(s.sim, a)).toBe(true); // re-lit before that step
    expect(occurrences(s.em, a.id)).toEqual([{ inc: inc.id, n: 1 }]);
    expect(inc.severity).toBe(2);
    checkInvariants(s);
    for (let d = 0; d < 8; d++) {
      s.sim.runDays(1);
      checkInvariants(s);
    }
    expect(a.flags & BF.Burnt).toBeTruthy();
  });

  it('a list that repeats an id (state written before the fix) steps the building once and cannot crash', () => {
    const s = row([30, 33]); // one incident (2 cells apart), not neighbours (no spread rolls between them)
    const [a, b] = [s.b.get(30)!, s.b.get(33)!];
    s.fire.ignite(s.sim, a);
    s.fire.ignite(s.sim, b);
    const inc = s.em.incidents()[0];
    expect(inc.fires).toEqual([a.id, b.id]);
    s.sim.runDays(1);
    inc.fires.push(a.id); // [a, b, a]
    const days = s.fire.fires.get(b.id)!.days;
    s.fire.fires.get(a.id)!.heat = 0; // the first pass puts a out: a second pass used to read its deleted fire
    expect(() => s.sim.runDays(1)).not.toThrow();
    expect(a.flags & BF.OnFire).toBe(0);
    expect(inc.saved).toBe(1);
    expect(inc.fires).toEqual([b.id]);
    expect(s.fire.fires.get(b.id)!.days).toBe(days + 1);
    checkInvariants(s);
  });

  it('a save that lists a building twice (one incident or two) is sanitised on load and continues without a crash', () => {
    const s = row([10, 11, 40, 41]);
    const [a, b, c, d] = [10, 11, 40, 41].map((x) => s.b.get(x)!);
    for (const x of [a, b, c, d]) s.fire.ignite(s.sim, x);
    const [first, second] = s.em.incidents();
    expect(first.fires).toEqual([a.id, b.id]);
    expect(second.fires).toEqual([c.id, d.id]);
    s.sim.runDays(1);
    // what an old build could save: a twice in its incident, b also listed by the second incident
    first.fires.push(a.id);
    second.fires.push(b.id);
    const save = structuredClone(serializeCity(s.st, { copy: true })) as SerializedCity;
    const l = make(deserializeCity(save));
    l.fire.riskBoost = 0;
    const [f2, s2] = l.em.incidents();
    expect(f2.fires).toEqual([a.id, b.id]);
    expect(s2.fires).toEqual([c.id, d.id]); // b stays with the incident its fire joined (its first listing)
    expect(l.fire.fires.get(b.id)!.incidentId).toBe(f2.id);
    const days = l.fire.fires.get(a.id)!.days;
    l.sim.runDays(1);
    expect(l.fire.fires.get(a.id)!.days).toBe(days + 1); // stepped once a day, not twice
    checkInvariants(l);
    for (let k = 0; k < 8; k++) {
      expect(() => l.sim.runDays(1)).not.toThrow();
      checkInvariants(l);
    }
    for (const x of [a, b, c, d]) expect(l.st.buildings.get(x.id)!.flags & BF.Burnt).toBeTruthy();
  });

  it('dense burning towns (the same-step re-ignition happens on its own): invariants hold every day, no crash', { timeout: 900000 }, () => {
    // seeds where the unfixed code listed a building twice: 6 (day 85), 10 (day 86); 11 crashed on day 900
    let reignitions = 0;
    for (const seed of [6, 10, 11]) {
      const s = denseTown(seed);
      const outDay = new Map<number, number>();
      const putOut = s.fire.putOut.bind(s.fire);
      s.fire.putOut = (sim, b) => { outDay.set(b.id, sim.state.day); putOut(sim, b); };
      const ignite = s.fire.ignite.bind(s.fire);
      s.fire.ignite = (sim, b, spread) => {
        const lit = ignite(sim, b, spread);
        if (lit && spread && outDay.get(b.id) === sim.state.day) reignitions++;
        return lit;
      };
      for (let d = 0; d < 1000; d++) {
        hotDay(s);
        checkInvariants(s);
      }
      expect(s.st.day).toBe(1000);
    }
    expect(reignitions).toBeGreaterThanOrEqual(3); // the path was exercised (put out, then re-ignited the same day)
  });

  it('determinism and save / load around an active multi-building fire', { timeout: 900000 }, () => {
    // same seed -> same city
    const a = denseTown(6), b = denseTown(6);
    for (let d = 0; d < 300; d++) { hotDay(a); hotDay(b); }
    expect(cityHash(b.st)).toBe(cityHash(a.st));
    // save while a multi-building fire is being fought (crews on scene), then both continue for 300 days through
    // more same-step re-ignitions: identical incidents, fire registry and city
    let guard = 0;
    const multi = (s: Sys) => s.em.incidents().some((i: Incident) => i.kind === 'fire' && i.fires.length >= 2 && i.state === 'onScene');
    while (!multi(a) && guard++ < 400) hotDay(a);
    expect(multi(a)).toBe(true);
    const l = make(deserializeCity(structuredClone(serializeCity(a.st, { copy: true })) as SerializedCity));
    expect(l.em.incidents()).toEqual(a.em.incidents());
    expect([...l.fire.fires]).toEqual([...a.fire.fires]);
    for (let d = 0; d < 300; d++) {
      hotDay(a);
      hotDay(l);
      expect(l.em.incidents()).toEqual(a.em.incidents());
      expect([...l.fire.fires]).toEqual([...a.fire.fires]);
    }
    checkInvariants(l);
    expect(cityHash(l.st)).toBe(cityHash(a.st));
  });
});
