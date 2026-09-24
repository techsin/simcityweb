/**
 * WP8 emergency UI policy: the LIVE / pause speed policy (pure speedPolicy) and the alert queue (limit, major-only,
 * per-kind cooldown, small-town filter).
 */
import { describe, expect, it } from 'vitest';
import { AlertQueue, FOLLOW_GRACE, FOLLOW_MAX_MIN, LIVE_IDLE, emgTime, followingDispatch, lossText, speedPolicy, stateText, type LiveState } from '../../src/ui/EmergencyBanner';
import type { Incident } from '../../src/sim/infra/emergency';

describe('speedPolicy', () => {
  it("'live': an alert drops fast / ultra to slowed 1x and restores the speed when handled", () => {
    let st: LiveState = { ...LIVE_IDLE };
    let speed = 3;
    let r = speedPolicy('live', st, speed, true, 1, 3);
    expect(r.speed).toBe(1);
    expect(r.liveSlowdown).toBe(3);
    st = r.state;
    speed = r.speed!;
    expect(st.active).toBe(true);
    // still pending: stays at slowed 1x, no speed change
    r = speedPolicy('live', st, speed, false, 1, 3);
    expect(r.speed).toBeUndefined();
    expect(r.liveSlowdown).toBe(3);
    st = r.state;
    // handled: back to ultra with a toast
    r = speedPolicy('live', st, speed, false, 0, 3);
    expect(r.speed).toBe(3);
    expect(r.liveSlowdown).toBe(1);
    expect(r.toast).toMatch(/ultra/);
    expect(r.state.active).toBe(false);
  });

  it("'live' at 1x only slows down; paused stays paused; slowmo 1 = plain 1x", () => {
    let r = speedPolicy('live', LIVE_IDLE, 1, true, 1, 3);
    expect(r.speed).toBeUndefined();
    expect(r.liveSlowdown).toBe(3);
    r = speedPolicy('live', r.state, 1, false, 0, 3);
    expect(r.speed).toBeUndefined(); // nothing to restore
    expect(r.liveSlowdown).toBe(1);
    r = speedPolicy('live', LIVE_IDLE, 0, true, 1, 3);
    expect(r.speed).toBeUndefined();
    expect(r.liveSlowdown).toBe(1); // paused: slow-down irrelevant
    r = speedPolicy('live', LIVE_IDLE, 2, true, 1, 1);
    expect(r.speed).toBe(1);
    expect(r.liveSlowdown).toBe(1);
  });

  it('the player changing the speed during LIVE mode is respected (no restore)', () => {
    let r = speedPolicy('live', LIVE_IDLE, 2, true, 1, 3);
    expect(r.speed).toBe(1);
    // player presses 3 while the emergency is still open: no forced 1x, no slow-down at 3x
    r = speedPolicy('live', r.state, 3, false, 1, 3);
    expect(r.speed).toBeUndefined();
    expect(r.liveSlowdown).toBe(1);
    r = speedPolicy('live', r.state, 3, false, 0, 3);
    expect(r.speed).toBeUndefined();
    expect(r.state.active).toBe(false);
  });

  it("'pause' pauses and restores; 'ignore' never touches the speed", () => {
    let r = speedPolicy('pause', LIVE_IDLE, 2, true, 1, 3);
    expect(r.speed).toBe(0);
    expect(r.liveSlowdown).toBe(1);
    r = speedPolicy('pause', r.state, 0, false, 0, 3);
    expect(r.speed).toBe(2);
    r = speedPolicy('ignore', LIVE_IDLE, 3, true, 2, 3);
    expect(r.speed).toBeUndefined();
    expect(r.liveSlowdown).toBe(1);
    expect(r.state.active).toBe(false);
  });

  it('no trigger or nothing pending -> no change', () => {
    expect(speedPolicy('live', LIVE_IDLE, 3, false, 1, 3).speed).toBeUndefined();
    expect(speedPolicy('live', LIVE_IDLE, 3, true, 0, 3).speed).toBeUndefined();
  });

  it('the setting is re-read every tick: switching it during an alert ends the slow-down and applies the new one', () => {
    // live -> ignore: ultra comes back right away, no slow-down, nothing active any more
    let r = speedPolicy('live', LIVE_IDLE, 3, true, 1, 3);
    expect(r.speed).toBe(1);
    r = speedPolicy('ignore', r.state, 1, false, 1, 3);
    expect(r.speed).toBe(3);
    expect(r.liveSlowdown).toBe(1);
    expect(r.state.active).toBe(false);
    expect(r.toast).toBeUndefined();
    // live -> pause: paused, and the original ultra comes back when handled (not the 1x LIVE set)
    r = speedPolicy('live', LIVE_IDLE, 3, true, 1, 3);
    r = speedPolicy('pause', r.state, 1, false, 1, 3);
    expect(r.speed).toBe(0);
    expect(r.liveSlowdown).toBe(1);
    r = speedPolicy('pause', r.state, 0, false, 0, 3);
    expect(r.speed).toBe(3);
    // pause -> live: unpaused into slowed 1x, ultra remembered
    r = speedPolicy('pause', LIVE_IDLE, 2, true, 1, 3);
    expect(r.speed).toBe(0);
    r = speedPolicy('live', r.state, 0, false, 1, 3);
    expect(r.speed).toBe(1);
    expect(r.liveSlowdown).toBe(3);
    r = speedPolicy('live', r.state, 1, false, 0, 3);
    expect(r.speed).toBe(2);
  });

  it('the restore toast is neutral when the emergency did not end well', () => {
    const r = speedPolicy('live', LIVE_IDLE, 3, true, 1, 3);
    expect(speedPolicy('live', r.state, 1, false, 0, 3, true).toast).toBe('Emergency over — back to ultra speed');
    expect(speedPolicy('live', r.state, 1, false, 0, 3, false).toast).toBe('Emergencies handled — back to ultra speed');
    expect(lossText({ lost: 2, deaths: 1 })).toBe('2 buildings lost · 1 dead');
    expect(lossText({ lost: 0, deaths: 0 })).toBe('');
  });
});

describe('incident state text', () => {
  const inc = (o: Partial<Incident>): Incident => ({ kind: 'fire', state: 'queued', manualPossible: false, fires: [], ...o }) as Incident;
  it("a fresh incident waiting for the search budget reads 'Dispatch pending', not 'waiting for a unit'", () => {
    expect(stateText(inc({}), 0)).toBe('Dispatch pending');
    expect(stateText(inc({ reason: 'busy' }), 0)).toBe('Waiting for a unit to come back');
    expect(stateText(inc({ state: 'uncovered', manualPossible: true }), 0)).toMatch(/dispatch a unit/);
    expect(stateText(inc({ state: 'uncovered', canSend: true }), 0)).toMatch(/too far to make it in time/);
    expect(stateText(inc({ state: 'uncovered' }), 0)).toBe('Nobody can reach it');
  });
});

describe('AlertQueue', () => {
  it('at most 3 banners, major only by default, 15-day cooldown per kind (fires always alert)', () => {
    const q = new AlertQueue();
    const pop = 50000;
    expect(q.offer({ id: 1, kind: 'medical', major: false }, 10, pop, 'major')).toBe(false); // minor
    expect(q.offer({ id: 1, kind: 'medical', major: false }, 10, pop, 'all')).toBe(true);
    expect(q.offer({ id: 2, kind: 'medical', major: true }, 12, pop, 'major')).toBe(false); // cooldown
    expect(q.offer({ id: 3, kind: 'fire', major: true }, 12, pop, 'major')).toBe(true);
    expect(q.offer({ id: 4, kind: 'fire', major: true }, 13, pop, 'major')).toBe(true); // fires: no cooldown
    expect(q.offer({ id: 5, kind: 'riot', major: true }, 13, pop, 'major')).toBe(false); // 3 shown
    expect(q.offer({ id: 3, kind: 'fire', major: true }, 13, pop, 'major')).toBe(false); // already shown
    q.remove(1);
    expect(q.offer({ id: 5, kind: 'riot', major: true }, 13, pop, 'major')).toBe(true);
    q.remove(5);
    expect(q.offer({ id: 6, kind: 'medical', major: true }, 26, pop, 'major')).toBe(true); // 16 days later
    expect(q.shown).toEqual([3, 4, 6]);
  });

  it('small towns (< 1,000 residents) only get fire alerts', () => {
    const q = new AlertQueue();
    expect(q.offer({ id: 1, kind: 'crime', major: true }, 0, 400, 'major')).toBe(false);
    expect(q.offer({ id: 2, kind: 'fire', major: true }, 0, 400, 'major')).toBe(true);
  });
});

describe('LIVE follow of a player dispatch', () => {
  const inc = (o: Partial<Incident>): Incident => ({ answered: 2, state: 'dispatched', arrived: -1, etaMin: 4.7, ...o }) as Incident;
  it('holds while the unit the player sent drives there, then for FOLLOW_GRACE days on scene', () => {
    expect(followingDispatch(inc({}), 100)).toBe(true);
    expect(followingDispatch(inc({ state: 'onScene', arrived: 104.7 }), 104.9)).toBe(true);
    expect(followingDispatch(inc({ state: 'onScene', arrived: 104.7 }), 104.7 + FOLLOW_GRACE + 0.01)).toBe(false);
  });
  it('not for auto-dispatched incidents, long drives or waiting incidents', () => {
    expect(followingDispatch(inc({ answered: 1 }), 100)).toBe(false);
    expect(followingDispatch(inc({ etaMin: FOLLOW_MAX_MIN + 1 }), 100)).toBe(false);
    expect(followingDispatch(inc({ state: 'uncovered' }), 100)).toBe(false);
  });
  it('emergency times read in minutes (1 game-minute of driving = 1 day)', () => {
    expect(emgTime(4)).toBe('4.0 min');
    expect(emgTime(0.25)).toBe('0.3 min');
    expect(emgTime(16)).toBe('16 min');
  });
});
