/**
 * WP8 emergency UI policy: the LIVE / pause speed policy (pure speedPolicy) and the alert queue (limit, major-only,
 * per-kind cooldown, small-town filter).
 */
import { describe, expect, it } from 'vitest';
import { AlertQueue, FOLLOW_GRACE, FOLLOW_MAX_MIN, LIVE_IDLE, LIVE_PAUSE_SEC, emgTime, followingDispatch, lossText, speedPolicy, stateText, type LiveState } from '../../src/ui/EmergencyBanner';
import { EmergencyTeachingPolicy, pendingCount, sendDays, unbanneredPrompt, urgentSeconds, type EmergencyTeaching, type PolicyAlert } from '../../src/game/emergencyPolicy';
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

  it("'live' with too little time to react (critic item 27): pauses until dispatched, then continues live", () => {
    // an alert whose best manual dispatch leaves 3 s at live speed: pause right away (from ultra)
    let r = speedPolicy('live', LIVE_IDLE, 3, true, 1, 3, false, 3);
    expect(LIVE_PAUSE_SEC).toBe(8);
    expect(r.speed).toBe(0);
    expect(r.state.urgentPause).toBe(true);
    let st = r.state;
    // still waiting for the player: stays paused
    r = speedPolicy('live', st, 0, false, 1, 3, false, 3);
    expect(r.speed).toBeUndefined();
    st = r.state;
    // dispatched (the unit is driving: still pending, no longer urgent) -> live 1x with the slow-motion
    r = speedPolicy('live', st, 0, false, 1, 3, false, Infinity);
    expect(r.speed).toBe(1);
    expect(r.liveSlowdown).toBe(3);
    st = r.state;
    expect(st.urgentPause).toBe(false);
    // the unit arrived: back to the player's ultra speed
    r = speedPolicy('live', st, 1, false, 0, 3, false, Infinity);
    expect(r.speed).toBe(3);
    expect(r.toast).toMatch(/ultra/);
    // plenty of time (20 s): no pause, just live
    r = speedPolicy('live', LIVE_IDLE, 2, true, 1, 3, false, 20);
    expect(r.speed).toBe(1);
    // the player resumes the urgent pause himself: never paused twice in the same episode
    r = speedPolicy('live', LIVE_IDLE, 1, true, 1, 3, false, 2);
    expect(r.speed).toBe(0);
    r = speedPolicy('live', r.state, 2, false, 1, 3, false, 2);
    expect(r.speed).toBeUndefined();
    expect(r.state.urgentPause).toBe(false);
    r = speedPolicy('live', r.state, 2, false, 1, 3, false, 1);
    expect(r.speed).toBeUndefined();
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

describe('FH-08 first-emergency teaching', () => {
  const lesson: EmergencyTeaching = { id: 1, variant: 'E1a' };
  const inc = (o: Partial<Incident> = {}): Incident => ({ id: 1, kind: 'fire', state: 'uncovered', major: true, reason: 'outOfRange', manualPossible: true, canSend: true, ...o }) as Incident;
  const alerts = (...ids: number[]) => new Map<number, PolicyAlert>(ids.map((id) => [id, { id, wasPossible: true }]));

  it('selects each variant once from major settled alerts, with independent profile flags', () => {
    const teacher = new EmergencyTeachingPolicy();
    const settings = { teachFirst: true, teachTooFar: true };
    expect(teacher.update(settings, alerts(1), [inc()])).toEqual(lesson);
    // Saving the seen flag while showing a card must not release its pause.
    expect(teacher.update({ teachFirst: false }, alerts(1), [inc()])).toEqual(lesson);
    expect(teacher.update({ ...settings, teachingAck: 1 }, alerts(1), [inc()])).toBeNull();
    expect(teacher.update(settings, alerts(1, 2), [inc(), inc({ id: 2 })])).toBeNull();
    const tooFar = inc({ id: 3, manualPossible: false });
    expect(teacher.update(settings, alerts(3), [tooFar])).toEqual({ id: 3, variant: 'E1b' });
    expect(teacher.update({ ...settings, teachingAck: 3 }, alerts(3), [tooFar])).toBeNull();
    expect(teacher.update(settings, alerts(4), [inc({ id: 4, manualPossible: false })])).toBeNull();
  });

  it('skips disabled tips, unalerted, minor, busy, already handled and unreachable calls', () => {
    const eligible = inc();
    expect(new EmergencyTeachingPolicy().update({}, alerts(1), [eligible])).toBeNull();
    expect(new EmergencyTeachingPolicy().update({ teachFirst: true }, alerts(), [eligible])).toBeNull();
    for (const ignored of [inc({ major: false }), inc({ reason: 'busy' }), inc({ state: 'dispatched' }), inc({ manualPossible: false, canSend: false })]) {
      expect(new EmergencyTeachingPolicy().update({ teachFirst: true, teachTooFar: true }, alerts(1), [ignored])).toBeNull();
    }
    expect(new EmergencyTeachingPolicy().update({ teachFirst: true }, alerts(1), [inc({ manualPossible: false })])).toBeNull();
    expect(new EmergencyTeachingPolicy().update({ teachTooFar: true }, alerts(1), [eligible])).toBeNull();
  });

  it.each(['dispatched', 'removed', 'busy'] as const)('closes a %s lesson without teaching the same variant again', (change) => {
    const teacher = new EmergencyTeachingPolicy();
    const settings = { teachFirst: true };
    teacher.update(settings, alerts(1), [inc()]);
    const after = change === 'removed' ? [] : [change === 'busy' ? inc({ reason: 'busy' }) : inc({ state: 'dispatched' })];
    expect(teacher.update(settings, alerts(1), after)).toBeNull();
    expect(teacher.update(settings, alerts(2), [inc({ id: 2 })])).toBeNull();
  });

  it('reset clears the current card and keeps the host lifetime one-shot guard', () => {
    const teacher = new EmergencyTeachingPolicy();
    teacher.update({ teachFirst: true }, alerts(1), [inc()]);
    teacher.reset();
    expect(teacher.episode).toBeNull();
    expect(teacher.update({ teachFirst: true }, alerts(2), [inc({ id: 2 })])).toBeNull();
  });

  it('E1a pauses once, stays paused through callbacks, then follows the dispatched truck and restores speed', () => {
    let r = speedPolicy('live', LIVE_IDLE, 3, true, 1, 3, false, 30, lesson);
    expect(r.speed).toBe(0);
    expect(r.liveSlowdown).toBe(1);
    expect(r.state.urgentPause).toBeFalsy();
    expect(r.state.teachingPause?.held).toBe(true);
    r = speedPolicy('live', r.state, 0, false, 1, 3, false, Infinity, lesson);
    expect(r.speed).toBeUndefined();
    expect(r.state.teachingPause?.held).toBe(true);
    // The policy clears the lesson when Send nearest dispatches; LIVE still follows the truck.
    r = speedPolicy('live', r.state, 0, false, 1, 3, false, Infinity, null);
    expect(r.speed).toBe(1);
    expect(r.liveSlowdown).toBe(3);
    expect(r.state.teachingPause).toBeUndefined();
    r = speedPolicy('live', r.state, 1, false, 0, 3);
    expect(r.speed).toBe(3);
    // Later uncovered calls use the normal policy.
    r = speedPolicy('live', r.state, 3, true, 1, 3, false, 30);
    expect(r.speed).toBe(1);
    expect(r.state.teachingPause).toBeUndefined();
  });

  it('a lesson supplies the urgent reaction time and never pauses the same call again after acknowledgement', () => {
    let r = speedPolicy('live', LIVE_IDLE, 3, true, 1, 3, false, 1, lesson);
    expect(r.speed).toBe(0);
    expect(r.state.urgentPause).toBeFalsy();
    r = speedPolicy('live', r.state, 0, false, 1, 3, false, 1, lesson);
    expect(r.speed).toBeUndefined();
    r = speedPolicy('live', r.state, 0, false, 1, 3, false, 1, null);
    expect(r.speed).toBe(1);
    expect(r.state.urgentPause).toBeFalsy();
    r = speedPolicy('live', r.state, 1, false, 1, 3, false, 1);
    expect(r.speed).toBeUndefined();
  });

  it('the first teaching episode can follow its dispatch even when the normal trigger is in cooldown', () => {
    let r = speedPolicy('live', LIVE_IDLE, 3, false, 1, 3, false, 30, lesson);
    expect(r.speed).toBe(0);
    expect(r.state.active).toBe(true);
    r = speedPolicy('live', r.state, 0, false, 1, 3, false, Infinity, null);
    expect(r.speed).toBe(1);
    expect(r.liveSlowdown).toBe(3);
    r = speedPolicy('live', r.state, 1, false, 0, 3);
    expect(r.speed).toBe(3);
    // Once the lesson is over, a banner-only cooldown call still cannot start a delayed slowdown.
    expect(speedPolicy('live', r.state, 3, false, 1, 3).speed).toBeUndefined();
  });

  it('E1b explains a too-far incident without a speed episode or a pending dispatch', () => {
    const tooFar: EmergencyTeaching = { id: 1, variant: 'E1b' };
    const r = speedPolicy('live', LIVE_IDLE, 3, false, 0, 3, false, Infinity, tooFar);
    expect(r.speed).toBeUndefined();
    expect(r.liveSlowdown).toBe(1);
    expect(r.state).toEqual(LIVE_IDLE);
  });

  it('acknowledgement, failure or alert removal restores the speed that preceded the lesson', () => {
    const paused = speedPolicy('live', LIVE_IDLE, 3, true, 1, 3, false, Infinity, lesson);
    const ended = speedPolicy('live', paused.state, 0, false, 0, 3, true, Infinity, null);
    expect(ended.speed).toBe(3);
    expect(ended.state).toEqual(LIVE_IDLE);
    expect(ended.toast).toMatch(/Emergency over/);
  });

  it('respects the player resuming a lesson, including at normal speed, without a second pause or restore', () => {
    for (const chosen of [1, 2, 3]) {
      let r = speedPolicy('live', LIVE_IDLE, 3, true, 1, 3, false, 1, lesson);
      r = speedPolicy('live', r.state, chosen, false, 1, 3, false, 1, lesson);
      expect(r.speed).toBeUndefined();
      expect(r.state.teachingPause?.held).toBe(false);
      r = speedPolicy('live', r.state, chosen, false, 1, 3, false, 1, lesson);
      expect(r.speed).toBeUndefined();
      r = speedPolicy('live', r.state, chosen, false, 0, 3, false, Infinity, null);
      expect(r.speed).toBeUndefined();
    }
  });

  it('keeps an already paused game paused and releases its own hold when the policy changes', () => {
    let r = speedPolicy('live', LIVE_IDLE, 0, true, 1, 3, false, Infinity, lesson);
    expect(r.speed).toBeUndefined();
    r = speedPolicy('live', r.state, 0, false, 0, 3, false, Infinity, null);
    expect(r.speed).toBeUndefined();
    r = speedPolicy('live', LIVE_IDLE, 3, true, 1, 3, false, Infinity, lesson);
    r = speedPolicy('ignore', r.state, 0, false, 1, 3, false, Infinity, lesson);
    expect(r.speed).toBe(3);
    expect(r.state.teachingPause?.held).toBe(false);
    r = speedPolicy('ignore', r.state, 3, false, 1, 3, false, Infinity, lesson);
    expect(r.speed).toBeUndefined();
  });
});

describe('incident state text', () => {
  const inc = (o: Partial<Incident>): Incident => ({ kind: 'fire', state: 'queued', manualPossible: false, fires: [], ...o }) as Incident;
  it("a fresh incident waiting for the search budget reads 'Dispatch pending', not 'waiting for a unit'", () => {
    expect(stateText(inc({}), 0)).toBe('Dispatch pending');
    expect(stateText(inc({ reason: 'busy' }), 0)).toBe('Waiting for a unit to come back');
    expect(stateText(inc({ state: 'uncovered', reason: 'busy', manualPossible: true }), 0)).toBe('Waiting for a unit');
    expect(stateText(inc({ state: 'uncovered', manualPossible: true }), 0)).toMatch(/dispatch a unit/);
    expect(stateText(inc({ state: 'uncovered', canSend: true }), 0)).toMatch(/too far to make it in time/);
    expect(stateText(inc({ state: 'uncovered' }), 0)).toBe('Nobody can reach it');
  });
});

describe('AlertQueue', () => {
  it.each(['major', 'all'] as const)('busy majors never take a banner slot or a per-kind cooldown in %s mode', (mode) => {
    const q = new AlertQueue();
    const busy = { id: 1, kind: 'medical' as const, major: true, manualPossible: true, reason: 'busy' as const };
    expect(q.offer(busy, 10, 50000, mode)).toBe(false);
    expect(q.shown).toEqual([]);
    expect(q.offer({ ...busy, reason: 'outOfRange', manualPossible: false }, 10, 50000, mode)).toBe(true);
  });

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

  it('F2: a major incident a dispatch can still save always gets a banner — no cooldown, no limit, no small-town filter', () => {
    const q = new AlertQueue();
    const pop = 50000;
    expect(q.offer({ id: 1, kind: 'medical', major: true, manualPossible: true }, 906, pop, 'major')).toBe(true);
    // 7 days later, same kind: the cooldown holds back "too far" alerts only
    expect(q.offer({ id: 2, kind: 'medical', major: true, manualPossible: false }, 913, pop, 'major')).toBe(false);
    expect(q.offer({ id: 3, kind: 'medical', major: true, manualPossible: true }, 913, pop, 'major')).toBe(true);
    expect(q.offer({ id: 4, kind: 'riot', major: true, manualPossible: true }, 913, pop, 'major')).toBe(true);
    // beyond the 3-banner limit (shown compact by the banner)
    expect(q.offer({ id: 5, kind: 'crime', major: true, manualPossible: true }, 913, pop, 'major')).toBe(true);
    expect(q.offer({ id: 6, kind: 'spill', major: true }, 913, pop, 'major')).toBe(false);
    expect(q.offer({ id: 7, kind: 'crime', major: true, manualPossible: true }, 0, 400, 'major')).toBe(true);
    // minor ones keep the old rules
    expect(q.offer({ id: 8, kind: 'medical', major: false, manualPossible: true }, 913, pop, 'major')).toBe(false);
    expect(q.shown).toEqual([1, 3, 4, 5, 7]);
  });
});

describe('coverage-gap prompts', () => {
  const inc = (reason: Incident['reason']): Incident => ({ id: 1, kind: 'fire', state: 'uncovered', major: true, reason, manualPossible: true, deadline: 4 }) as Incident;
  const alerts = new Map<number, PolicyAlert>([[1, { id: 1, wasPossible: true }]]);
  const dismissed = new Set<number>();
  const send = () => 1;

  it('a busy incident is dispatchable but never pending or urgent, even with an old alert', () => {
    const busy = inc('busy');
    expect(sendDays(busy, 0, () => [{ stationId: 1, name: 'Fire', responder: 'fire', free: 1, total: 1, etaDays: 1, etaMin: 1, inRange: false }])).toBe(1);
    expect(unbanneredPrompt(busy, new Map(), dismissed, send)).toBe(false);
    for (const shown of [new Map<number, PolicyAlert>(), alerts]) {
      expect(pendingCount('live', shown, [busy], dismissed, 0, send)).toEqual({ count: 0, bad: false });
      expect(pendingCount('pause', shown, [busy], dismissed, 0, () => NaN)).toEqual({ count: 0, bad: false });
      expect(urgentSeconds(shown, [busy], dismissed, 0, 3, send)).toBe(Infinity);
    }
  });

  it.each(['outOfRange', 'noStation'] as const)('%s keeps the pending and urgent policy when help can arrive', (reason) => {
    const gap = inc(reason);
    expect(unbanneredPrompt(gap, new Map(), dismissed, send)).toBe(true);
    expect(pendingCount('live', alerts, [gap], dismissed, 0, send)).toEqual({ count: 1, bad: false });
    expect(urgentSeconds(alerts, [gap], dismissed, 0, 3, send)).toBeLessThan(LIVE_PAUSE_SEC);
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
  it('follows the primary responder: an industrial accident\'s ambulance on scene for days does not end the follow of the fire truck', () => {
    const ind = (o: Partial<Incident>) => inc({ kind: 'industrial', arrived: 101, firstAt: { medical: 101 }, ...o });
    expect(followingDispatch(ind({}), 104)).toBe(true);
    expect(followingDispatch(ind({ state: 'onScene', firstAt: { medical: 101, fire: 104 } }), 104.5)).toBe(true);
    expect(followingDispatch(ind({ state: 'onScene', firstAt: { medical: 101, fire: 104 } }), 104 + FOLLOW_GRACE + 0.01)).toBe(false);
  });
  it('emergency times read in minutes (1 game-minute of driving = 1 day)', () => {
    expect(emgTime(4)).toBe('4.0 min');
    expect(emgTime(0.25)).toBe('0.3 min');
    expect(emgTime(16)).toBe('16 min');
  });
});
