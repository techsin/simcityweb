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
 *
 * Fire aftermath (routed items 33-35): a building that leaves a fire cluster part-way loses BF.Incident at once (it kept
 * "Emergency here" for good); a bulldozed burning building leaves the fire registry at once (a loaded game drops it,
 * and fires.size gates the riskBoost decay: save / load diverged after disasters); the news throttles are saved.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { FireSystem } from '../../src/sim/infra/fire';
import { EmergencySystem, type Incident } from '../../src/sim/infra/emergency';
import { DisastersSystem, triggerDisaster } from '../../src/sim/infra/disasters';
import { removeBuilding } from '../../src/sim/economy/buildings';
import { FIRE_BURN_DAYS } from '../../src/sim/infra/params';
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
 *  and every registered fire listed by the incident it names (its building still standing); BF.Incident on exactly the
 *  listed buildings (incident sites and fire-cluster members — routed item 35: a building that left a cluster part-way
 *  kept it for good) */
function checkInvariants(s: Sys): void {
  const owner = new Map<number, number>();
  const listed = new Set<number>();
  for (const inc of s.em.incidents()) {
    if (inc.buildingId >= 0) listed.add(inc.buildingId);
    for (const id of inc.fires) {
      expect(owner.has(id), `day ${s.st.day}: building ${id} listed by incident ${owner.get(id)} and again by ${inc.id}`).toBe(false);
      owner.set(id, inc.id);
      listed.add(id);
      const f = s.fire.fires.get(id);
      const b = s.st.buildings.get(id);
      expect(!!f && !!b && (b.flags & BF.OnFire) !== 0, `day ${s.st.day}: incident ${inc.id} lists ${id} without a fire`).toBe(true);
      expect(f!.incidentId, `day ${s.st.day}: the fire of ${id} names another incident`).toBe(inc.id);
    }
    if (inc.kind === 'fire') expect(inc.severity).toBe(inc.fires.length);
  }
  for (const [id, f] of s.fire.fires) {
    expect(owner.get(id), `day ${s.st.day}: fire ${id} is not listed by its incident`).toBe(f.incidentId);
    expect(s.st.buildings.has(id), `day ${s.st.day}: the registry keeps fire ${id} of a removed building`).toBe(true);
  }
  const wrong: number[] = [];
  for (const b of s.st.buildings.values()) if (((b.flags & BF.Incident) !== 0) !== listed.has(b.id)) wrong.push(b.id);
  expect(wrong, `day ${s.st.day}: buildings whose BF.Incident does not match their listing`).toEqual([]);
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

/** hash of the whole saved city except its save time — the news feed included (the news throttles are saved since
 *  routed item 34, so a loaded game words its news like the original) */
function cityHash(st: CityState): string {
  const sc = structuredClone(serializeCity(st, { copy: true })) as unknown as { savedAt?: number };
  delete sc.savedAt;
  return createHash('sha1').update(JSON.stringify(canon(sc))).digest('hex');
}

/** a saved and reloaded copy of a game (fire + emergency + disasters, like make()) */
function reload(s: Sys): Sys {
  return make(deserializeCity(structuredClone(serializeCity(s.st, { copy: true })) as SerializedCity));
}

/** the live and the loaded game agree on the incidents, the fire registry (order included) and the ignition boost */
function expectSame(l: Sys, a: Sys, what: string): void {
  expect(l.em.incidents(), what).toEqual(a.em.incidents());
  expect([...l.fire.fires], what).toEqual([...a.fire.fires]);
  expect(l.fire.riskBoost, what).toBe(a.fire.riskBoost);
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
    const reignitions = new Map<number, number>();
    for (const seed of [6, 10, 11]) {
      const s = denseTown(seed);
      const outDay = new Map<number, number>();
      const putOut = s.fire.putOut.bind(s.fire);
      s.fire.putOut = (sim, b) => { outDay.set(b.id, sim.state.day); putOut(sim, b); };
      const ignite = s.fire.ignite.bind(s.fire);
      let n = 0;
      s.fire.ignite = (sim, b, spread) => {
        const lit = ignite(sim, b, spread);
        if (lit && spread && outDay.get(b.id) === sim.state.day) n++;
        return lit;
      };
      for (let d = 0; d < 1000; d++) {
        hotDay(s);
        checkInvariants(s);
      }
      expect(s.st.day).toBe(1000);
      reignitions.set(seed, n);
    }
    // the path was exercised (put out, then re-ignited the same day) at least once per seed — today exactly once each,
    // on days 85 / 86 / 896; if fire tuning changes and this fails, pick seeds that still re-ignite a just-extinguished
    // building (the scratch search printed them)
    for (const [seed, n] of reignitions) expect(n, `seed ${seed}: same-day re-ignitions of extinguished buildings`).toBeGreaterThanOrEqual(1);
  });

  it('determinism and save / load around an active multi-building fire', { timeout: 900000 }, () => {
    // same seed -> same city
    const a = denseTown(6), b = denseTown(6);
    for (let d = 0; d < 300; d++) { hotDay(a); hotDay(b); }
    expect(cityHash(b.st)).toBe(cityHash(a.st));
    // save while a multi-building fire is being fought (crews on scene), then both continue for 300 days through
    // more same-step re-ignitions: identical incidents, fire registry, news feed and city
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
      // (the news throttles are saved: before routed item 34 the loaded game posted alerts the original had throttled —
      // 4 news items instead of 2 on its first day here)
      expect(l.st.news, `day ${a.st.day}: news feed`).toEqual(a.st.news);
    }
    checkInvariants(l);
    expect(cityHash(l.st)).toBe(cityHash(a.st));
  });
});

describe('fire aftermath: BF.Incident, bulldozed fires, news throttles (routed items 35, 33, 34)', () => {
  it('a building that leaves a fire cluster part-way loses BF.Incident at once; the site keeps it until the end', () => {
    const s = row([30, 32, 34, 36]); // one incident (each within 3 cells of the cluster), no neighbours: no spread rolls
    const [a, b, c, d] = [30, 32, 34, 36].map((x) => s.b.get(x)!);
    for (const x of [a, b, c, d]) expect(s.fire.ignite(s.sim, x)).toBe(true);
    expect(s.em.incidents().length).toBe(1);
    const inc = s.em.incidents()[0];
    expect(inc.buildingId).toBe(a.id);
    expect(inc.fires).toEqual([a.id, b.id, c.id, d.id]);
    const flagged = () => [a, b, c, d].filter((x) => x.flags & BF.Incident).map((x) => x.id);
    expect(flagged()).toEqual([a.id, b.id, c.id, d.id]);
    s.sim.runDays(1);
    // in the same step b is put out and c burns down: both leave the cluster and lose the flag (one buildingChanged
    // each — putOut / burnDown carry it), the incident goes on with a and d
    s.fire.fires.get(b.id)!.heat = 0;
    s.fire.fires.get(c.id)!.days = FIRE_BURN_DAYS - 1;
    const changed: number[] = [];
    const off = s.sim.events.on('buildingChanged', (x) => changed.push(x.id));
    s.sim.runDays(1);
    off();
    expect(b.flags & BF.OnFire).toBe(0);
    expect(c.flags & BF.Burnt).toBeTruthy();
    expect(inc.fires).toEqual([a.id, d.id]);
    expect(flagged()).toEqual([a.id, d.id]);
    expect(changed.filter((id) => id === b.id).length).toBe(1);
    expect(changed.filter((id) => id === c.id).length).toBe(1);
    checkInvariants(s);
    // a fire that ends outside the step (UI): listed (and flagged) until the incident's next step, then neither
    s.fire.extinguish(s.sim, d);
    expect(inc.fires).toEqual([a.id, d.id]);
    expect(d.flags & BF.Incident).toBeTruthy();
    s.sim.runDays(1);
    expect(inc.fires).toEqual([a.id]);
    expect(flagged()).toEqual([a.id]); // the site keeps it while its incident lasts (report() shows the incident there)
    checkInvariants(s);
    for (let k = 0; k < 8 && s.em.incidents().length; k++) {
      s.sim.runDays(1);
      checkInvariants(s);
    }
    expect(s.em.incidents().length).toBe(0);
    expect(a.flags & BF.Burnt).toBeTruthy();
    expect(flagged()).toEqual([]);
  });

  it('a save with stale BF.Incident flags (written before the fix) is repaired on load', () => {
    const s = row([30, 32, 50]);
    const [a, b, c] = [30, 32, 50].map((x) => s.b.get(x)!);
    s.fire.ignite(s.sim, a);
    s.fire.ignite(s.sim, b);
    s.sim.runDays(1);
    c.flags |= BF.Incident; // what an older build saved: c left a fire cluster long ago and kept the flag
    b.flags &= ~BF.Incident; // (and the inverse, for an exact invariant: a listed building without it)
    const l = reload(s);
    expect(l.st.buildings.get(c.id)!.flags & BF.Incident).toBe(0);
    expect(l.st.buildings.get(b.id)!.flags & BF.Incident).toBeTruthy();
    expect(l.st.buildings.get(a.id)!.flags & BF.Incident).toBeTruthy();
    checkInvariants(l);
  });

  it('a bulldozed burning building leaves the fire registry at once: save / load around it with disasters on', { timeout: 900000 }, () => {
    const a = denseTown(7);
    a.st.config.disasters = true;
    a.fire.riskBoost = 0; // no random ignitions before the quake
    a.sim.runDays(3);
    expect(triggerDisaster(a.sim, 'earthquake', 32, 30)).toBe(true);
    expect(a.fire.riskBoost).toBe(3); // raised until nothing burns any more (fire.daily decays it while fires.size is 0)
    a.sim.runDays(3); // (the quake's own active days are over: DisastersSystem.active is not saved)
    checkInvariants(a);
    // the player bulldozes a burning building of a multi-building fire (not the incident's site)
    const inc = a.em.incidents().find((i) => i.kind === 'fire' && i.fires.some((id) => id !== i.buildingId));
    expect(inc, 'a multi-building fire after the quake').toBeDefined();
    const victim = inc!.fires.find((id) => id !== inc!.buildingId)!;
    removeBuilding(a.sim, a.st.buildings.get(victim)!);
    expect(a.fire.fires.has(victim)).toBe(false); // gone from the registry at once (it stayed until the incident ended)
    expect(inc!.fires).toContain(victim); // the incident drops it at its next step
    // saved right after: the loaded game has the same registry, so the same riskBoost decay (gated on fires.size)
    const l = reload(a);
    expectSame(l, a, 'right after the load');
    let cleared = -1, decayed = -1;
    for (let d = 0; d < 150; d++) {
      a.sim.runDays(1);
      l.sim.runDays(1);
      expectSame(l, a, `day ${a.st.day}`);
      checkInvariants(a);
      checkInvariants(l);
      // a few days on the player clears every burning building in both games: nothing burns, the boost starts decaying
      if (d === 5) {
        for (const s of [a, l]) for (const id of [...s.fire.fires.keys()]) removeBuilding(s.sim, s.st.buildings.get(id)!);
        expect(a.fire.fires.size).toBe(0);
        expectSame(l, a, 'after the clearing');
        cleared = a.st.day;
      }
      if (cleared >= 0 && decayed < 0 && a.fire.riskBoost < 3) decayed = a.st.day;
    }
    expect(cleared).toBeGreaterThan(0);
    expect(decayed, 'the boost decayed after the clearing, the same days in both games').toBeGreaterThan(cleared);
    checkInvariants(l);
    expect(cityHash(l.st)).toBe(cityHash(a.st)); // news feed included
  });

  it('a fire area cleared after a quake: the ignition boost decays from the next day, in the live and the loaded game', () => {
    // homes every 2 cells (no neighbours: no spread), no station; a quake (riskBoost 3) and two plain fires 2 cells apart
    const xs = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40];
    const s = row(xs);
    s.st.config.disasters = true;
    expect(triggerDisaster(s.sim, 'earthquake', 25, 21)).toBe(true);
    expect(s.fire.riskBoost).toBe(3);
    expect(triggerDisaster(s.sim, 'fire', 30, 21)).toBe(true);
    expect(triggerDisaster(s.sim, 'fire', 32, 21)).toBe(true);
    s.sim.runDays(2); // (the quake's own active days are over)
    expect(s.fire.fires.size).toBeGreaterThanOrEqual(2);
    expect(s.em.incidents().some((i) => i.kind === 'fire' && i.fires.length >= 2)).toBe(true);
    checkInvariants(s);
    // the player bulldozes every burning building: nothing burns any more, right away
    const burning = [...s.fire.fires.keys()];
    for (const id of burning) removeBuilding(s.sim, s.st.buildings.get(id)!);
    expect(s.fire.fires.size).toBe(0); // (the dangling entries kept it above 0 until their incidents ended)
    const cleared = s.st.day;
    const l = reload(s);
    expectSame(l, s, 'right after the load');
    const boost: number[] = [];
    for (let d = 0; d < 12; d++) {
      s.sim.runDays(1);
      l.sim.runDays(1);
      expectSame(l, s, `day ${s.st.day}`);
      checkInvariants(s);
      boost.push(s.fire.riskBoost);
    }
    // the boost decays from the first day after the clearing (x0.8 a day while nothing burns), the same in both games
    expect(boost[0]).toBeCloseTo(3 * 0.8, 9);
    expect(boost[1]).toBeCloseTo(3 * 0.8 * 0.8, 9);
    expect(boost[boost.length - 1]).toBe(1);
    expect(s.em.incidents().filter((i) => i.kind === 'fire').length).toBe(0);
    expect(s.st.day).toBe(cleared + 12);
    expect(cityHash(l.st)).toBe(cityHash(s.st));
  });

  it('the news throttles are saved: a loaded game words its news feed like the original (older saves still load)', () => {
    // emergency path: an uncovered major fire posts an alert; another one within 2 days is throttled
    const s = row([10, 40]); // far apart: two incidents; no station: both uncovered
    const [h10, h40] = [s.b.get(10)!, s.b.get(40)!];
    s.fire.ignite(s.sim, h10);
    expect(s.st.news.length).toBe(1);
    const save = structuredClone(serializeCity(s.st, { copy: true })) as SerializedCity;
    const l = make(deserializeCity(save));
    // an older save (no throttle saved) still loads: nothing is throttled yet, as before
    const old = structuredClone(save);
    const sd = (old.data.systemData as Record<string, unknown>);
    delete (sd.emergency as Record<string, unknown>).news;
    delete sd.infraFireNews;
    const o = make(deserializeCity(old));
    for (const g of [s, l, o]) {
      g.fire.riskBoost = 0;
      g.fire.ignite(g.sim, g.st.buildings.get(h40.id)!);
    }
    expect(s.st.news.length).toBe(1); // throttled
    expect(l.st.news).toEqual(s.st.news);
    expect(o.st.news.length).toBe(2); // the older save posts it (its throttle was not saved)
    for (let d = 0; d < 10; d++) {
      s.sim.runDays(1);
      l.sim.runDays(1);
    }
    expect(s.st.news.length).toBeGreaterThan(1); // (the burnt-down news)
    expect(l.st.news).toEqual(s.st.news);
    // legacy path (no emergency system): 'Fire reported' at most every 5 days
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    const p10 = place(st, 't_r2', 10, 21, { pop: 60 });
    const p40 = place(st, 't_r2', 40, 21, { pop: 60 });
    const sim = new Simulation(st, [new FireSystem()]);
    const fire = sim.getSystem<FireSystem>('fire')!;
    fire.riskBoost = 0;
    fire.ignite(sim, p10);
    expect(st.news.length).toBe(1);
    const st2 = deserializeCity(structuredClone(serializeCity(st, { copy: true })) as SerializedCity);
    const sim2 = new Simulation(st2, [new FireSystem()]);
    sim2.getSystem<FireSystem>('fire')!.riskBoost = 0;
    fire.ignite(sim, p40);
    sim2.getSystem<FireSystem>('fire')!.ignite(sim2, st2.buildings.get(p40.id)!);
    expect(st.news.length).toBe(1); // throttled
    expect(st2.news).toEqual(st.news);
  });
});
