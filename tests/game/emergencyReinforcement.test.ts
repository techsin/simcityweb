/**
 * T087 item 3 (T048's request 1; T061 item 3): FEEL-10's outcome stings read `host.cause.dispatchIncidentId`. Units the
 * player sends to an incident the city already answered by itself leave `answered === 1`, so the incident's own record
 * cannot say the player took part, and its outcome stayed silent. The cause of a dispatch or dispatchBest command names
 * its incident on every host, and GameSounds marks the player's response from it; the incident's `answered === 2`
 * still covers a first response from before this page saw the command (a loaded game, a resync).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Emitter } from '../../src/core/events';
import { GameSounds, emergencyStingPending } from '../../src/game/GameSounds';
import type { CityEvents, EmergencyEvent, Simulation } from '../../src/sim/Simulation';
import { emergencyOf, type EmergencySystem, type Incident } from '../../src/sim/infra/emergency';
import { clearRecoveryBase } from '../../src/save/cities';
import { MemoryKV, setKV } from '../../src/save/db';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { LocalSimHost, type Cause, type SimHost } from '../../src/worker/SimHost';
import { newState, place, roadLine } from '../infra/cityGen';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  clearRecoveryBase(); setKV(new MemoryKV());
});

const outcomes = (plays: readonly string[]) => plays.filter((name) => name === 'saved' || name === 'lost');

// ------------------------------------------------------------------------------------------------ a scripted host
function incident(id = 1, patch: Partial<Incident> = {}): Incident {
  return {
    id, kind: 'medical', x: 12, z: 10, buildingId: -1, major: true, state: 'dispatched',
    start: 0, deadline: 20, severity: 1, need: { medical: 2 }, units: [3], manualPossible: false,
    place: 'Apartments', note: '', grace: 6, arrived: -1, firstAt: {},
    answered: 1, work: 1, injured: 0, deaths: 0, radius: 0, fires: [], lost: 0, saved: 0,
    retry: 0, stVer: 0, ...patch,
  };
}

/** GameSounds on a host whose events, incident view and command cause the test scripts. */
function scripted(initial: Incident[] = []) {
  const events = new Emitter<CityEvents>(), live = new Map(initial.map((inc) => [inc.id, inc]));
  const abort = new AbortController(), state = { budget: { lastIncome: {}, lastExpense: {} } };
  let cause: Cause | null = null;
  const host = {
    events, state, ready: Promise.resolve(), speed: 1,
    get cause() { return cause; },
    emergency: { incident: (id: number) => live.get(id), incidents: () => [...live.values()] },
    policy: { alerts: [], live: false, subscribe: () => () => {} },
  } as unknown as SimHost;
  const plays: string[] = [];
  const sounds = new GameSounds({
    sim: { events, state } as unknown as Simulation, host, signal: abort.signal,
    sound: (name) => { plays.push(name); }, world: () => ({ camera: null }) as never, sandbox: () => true,
  });
  cleanups.push(() => { abort.abort(); sounds.dispose(); });
  /** one emergency event, inside the effects of the command `by` (none: the city's own doing) */
  const emit = (type: EmergencyEvent['type'], inc: Incident, by: Cause | null = null) => {
    live.set(inc.id, inc);
    cause = by;
    events.emit('emergency', { type, id: inc.id, kind: inc.kind, x: inc.x, z: inc.z, major: inc.major, manualPossible: inc.manualPossible });
    cause = null;
  };
  /** the local host's order: the incident leaves the lookup before its final event */
  const end = (inc: Incident, type: 'resolved' | 'failed' = 'resolved') => {
    inc.state = type;
    live.delete(inc.id);
    cause = null;
    events.emit('emergency', { type, id: inc.id, kind: inc.kind, x: inc.x, z: inc.z, major: inc.major, manualPossible: inc.manualPossible });
  };
  return { host, events, live, plays, emit, end };
}
/** the cause of the player's `dispatch` / `dispatchBest` for incident `id` */
const dispatchOf = (id: number, seq = 7): Cause => ({ seq, tag: null, dispatchIncidentId: id });

describe('outcome stings for a reinforcement (scripted host)', () => {
  it('plays one saved sting when units the player sent to an automatic response end it without losses', () => {
    const f = scripted(), inc = incident();
    f.emit('new', inc);
    f.emit('dispatched', inc); // the city's own answer: no command
    f.emit('dispatched', inc, dispatchOf(inc.id)); // the player's reinforcement: answered stays 1
    expect(inc.answered).toBe(1);
    f.emit('arrived', inc);
    f.end(inc);
    expect(f.plays).toEqual(['saved']);
  });

  it('plays lost when the reinforced incident ends with a death or fails', () => {
    for (const [patch, type] of [[{ deaths: 1 }, 'resolved'], [{ lost: 1 }, 'resolved'], [{}, 'failed']] as const) {
      const f = scripted(), inc = incident(1, patch);
      f.emit('dispatched', inc, dispatchOf(inc.id));
      f.end(inc, type);
      expect(f.plays).toEqual(['lost']);
    }
  });

  it('stays quiet for an automatic response without a reinforcement', () => {
    const f = scripted(), inc = incident();
    f.emit('new', inc);
    f.emit('dispatched', inc);
    f.end(inc);
    expect(f.plays).toEqual([]);
  });

  it('does not count a dispatch command that names another incident, or a command that names none', () => {
    const f = scripted(), other = incident(2), inc = incident(1), third = incident(3);
    // the player's dispatch to #2 frees or takes a unit, and the city sends one to #1 inside the same command
    f.emit('dispatched', inc, dispatchOf(other.id));
    // a disaster command whose incident the city answers at once (a tagged cause, no incident)
    f.emit('dispatched', third, { seq: 8, tag: { tool: 'disaster' } });
    f.end(inc);
    f.end(third);
    expect(f.plays).toEqual([]);
  });

  it('marks the incident only on its dispatched event', () => {
    const f = scripted(), inc = incident();
    for (const type of ['new', 'queued', 'arrived', 'escalated', 'uncovered'] as const) f.emit(type, inc, dispatchOf(inc.id));
    f.end(inc);
    // (the uncovered event rings its own warning: only the outcome is in question here)
    expect(outcomes(f.plays)).toEqual([]);
  });

  it('still reads answered 2 for a first response this page never saw a command for', () => {
    // a loaded game or a resync: the incident is already on scene, and no dispatched event carries a cause here
    const inc = incident(1, { answered: 2, state: 'onScene' }), f = scripted([inc]);
    f.end(inc);
    expect(f.plays).toEqual(['saved']);
    // and the dispatched event of a first response needs no incident in its cause either (an older host)
    const g = scripted(), first = incident(1, { answered: 2 });
    g.emit('dispatched', first, { seq: 3, tag: null });
    g.end(first);
    expect(g.plays).toEqual(['saved']);
  });

  it('forgets the reinforcement when the host resets', () => {
    const f = scripted(), inc = incident(4);
    f.emit('dispatched', inc, dispatchOf(inc.id));
    f.live.clear();
    f.events.emit('reset', undefined);
    // another city's incident with the same id, answered by the city alone
    const reused = incident(4);
    f.emit('dispatched', reused);
    f.end(reused);
    expect(f.plays).toEqual([]);
  });

  it('keeps the restore toast silent while a reinforced incident of the episode is still being worked on', () => {
    const f = scripted(), inc = incident(1, { state: 'onScene' }), auto = incident(2, { state: 'onScene' });
    f.emit('dispatched', inc, dispatchOf(inc.id));
    f.emit('dispatched', auto);
    expect(emergencyStingPending(f.host, new Set([inc.id]))).toBe(true);
    expect(emergencyStingPending(f.host, new Set([auto.id]))).toBe(false);
    f.end(inc);
    expect(f.plays).toEqual(['saved']);
  });
});

// ------------------------------------------------------------------------------------------------ the real hosts
/** dispatchCause.test.ts's city: a clinic beside a home, which answers a major medical call there by itself with its one
 *  ambulance (one short), and two clinics far down the road, out of range, whose ambulances only the player sends */
function coveredCity() {
  const st = newState(64); roadLine(st, 2, 20, 62, 20);
  const home = place(st, 't_r2', 14, 21, { pop: 60 });
  place(st, 't_clinic', 8, 19); place(st, 't_fire', 10, 19);
  place(st, 't_clinic', 50, 19);
  const farther = place(st, 't_clinic', 56, 19);
  return { st, home, farther };
}

describe.each(['local', 'loopback'] as const)('outcome stings for a reinforcement on the %s host', (kind) => {
  async function boot() {
    const { st, home, farther } = coveredCity();
    const host = kind === 'local' ? new LocalSimHost(st, { initialSpeed: 0 }) : new LoopbackSimHost(st, { initialSpeed: 0, loopback: { cadence: 'design' } });
    await host.start();
    const sim: Simulation = host instanceof LoopbackSimHost ? host.harness.core.sim : host.sim;
    const em = emergencyOf(sim) as EmergencySystem;
    const abort = new AbortController(), plays: string[] = [];
    const sounds = new GameSounds({
      sim: host.sim, host, signal: abort.signal, sound: (name) => { plays.push(name); },
      world: () => ({ camera: null }) as never, sandbox: () => true,
    });
    cleanups.push(async () => { abort.abort(); sounds.dispose(); await host.dispose(); });
    /** the page has everything the authority has done so far */
    const settle = async () => { if (host instanceof LoopbackSimHost) await host.drain(); };
    /** sim days until the incident is over (the authority's own record: the page's is gone with its last event) */
    const finish = async (id: number) => {
      const inc = em.incident(id)!;
      for (let day = 0; day < 20 && em.incident(id); day++) {
        if (host instanceof LoopbackSimHost) host.harness.runDays(1); else host.sim.runDays(1);
        await settle();
      }
      expect(em.incident(id)).toBeUndefined();
      return inc;
    };
    /** a major medical call at the home: the near clinic answers it by itself, one ambulance short */
    const call = async () => {
      const id = em.spawn(sim, 'medical', home.x, home.z, { buildingId: home.id, major: true });
      await settle();
      expect(em.incident(id)).toMatchObject({ answered: 1, state: 'dispatched' });
      expect(host.policy.alerts).toEqual([]);
      return id;
    };
    return { host, em, farther, plays, settle, finish, call };
  }

  it('a dispatch the player adds to the city\'s own answer earns the saved sting, though answered stays 1', { timeout: 30000 }, async () => {
    const { host, em, farther, plays, settle, finish, call } = await boot();
    const id = await call();
    const more = host.act('dispatch', [id, farther.id, 1], { tag: {} });
    await settle();
    expect(await more.done).toMatchObject({ ok: true });
    expect(em.incident(id)?.answered).toBe(1);
    const inc = await finish(id);
    expect(inc).toMatchObject({ state: 'resolved', answered: 1, lost: 0, deaths: 0 });
    expect(outcomes(plays)).toEqual(['saved']);
  });

  it('Send nearest (dispatchBest) for the ambulance the city could not send counts the same way', { timeout: 30000 }, async () => {
    const { host, em, plays, settle, finish, call } = await boot();
    const id = await call();
    const best = host.act('dispatchBest', [id]);
    await settle();
    expect(await best.done).toMatchObject({ ok: true });
    expect(em.incident(id)?.answered).toBe(1);
    const inc = await finish(id);
    expect(inc).toMatchObject({ state: 'resolved', answered: 1, lost: 0, deaths: 0 });
    expect(outcomes(plays)).toEqual(['saved']);
  });

  it('the same call left to the city alone ends without a sting', { timeout: 30000 }, async () => {
    const { plays, finish, call } = await boot();
    const id = await call();
    const inc = await finish(id);
    expect(inc).toMatchObject({ state: 'resolved', answered: 1, lost: 0, deaths: 0 });
    expect(outcomes(plays)).toEqual([]);
  });

  it('a dispatch command that fails marks nothing', { timeout: 30000 }, async () => {
    const { host, plays, settle, finish, call } = await boot();
    const id = await call();
    // not an emergency station: the command names the incident, sends nobody and emits no dispatched event
    const refused = host.act('dispatch', [id, -1, 1]);
    await settle();
    expect(await refused.done).toMatchObject({ ok: false });
    await finish(id);
    expect(outcomes(plays)).toEqual([]);
  });
});
