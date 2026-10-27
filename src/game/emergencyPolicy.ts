/** Headless emergency alert selection and LIVE speed policy (WORKER_DESIGN §3.3). */
import { SECONDS_PER_DAY } from '../core/constants';
import type { EmergencyPolicy } from './settings';
import type { IncidentKind } from '../sim/CityState';
import { dispatchWindowEnd, INCIDENT_RESPONDERS, type DispatchOption, type Incident } from '../sim/infra/emergency';

export const MAX_BANNERS = 3;
export const KIND_COOLDOWN = 15;
export const ALERT_MIN_POP = 1000;
/** 'live': after a player dispatch the game stays live until the first unit has been on scene this long (days) ... */
export const FOLLOW_GRACE = 0.75;
/** ... unless its drive is longer than this (game minutes): then the previous speed comes back right away */
export const FOLLOW_MAX_MIN = 15;
/** 'live': less real time than this (seconds at live speed) to dispatch the most urgent alert pauses the game */
export const LIVE_PAUSE_SEC = 8;

// ------------------------------------------------------------------------------------------------ pure policy
/** LIVE-mode bookkeeping between host ticks */
export interface LiveState {
  active: boolean;
  policy: EmergencyPolicy | null;
  /** speed to restore when every alerted incident is handled (null = leave it) */
  prevSpeed: number | null;
  /** the speed the policy set (the player changed it if the current speed differs) */
  setSpeed: number | null;
  /** 'live': paused because an alert left too little time to react (resumes live once dispatched) */
  urgentPause?: boolean;
  /** 'live': the urgent pause was used in this episode (the player resumed it himself: never twice) */
  urgentUsed?: boolean;
}
export const LIVE_IDLE: Readonly<LiveState> = { active: false, policy: null, prevSpeed: null, setSpeed: null };

export interface PolicyStep {
  /** new sim speed (undefined = unchanged) */
  speed?: number;
  /** sim.liveSlowdown to apply */
  liveSlowdown: number;
  state: LiveState;
  /** toast to show (restored speed) */
  toast?: string;
}

const SPEED_NAME = ['paused', 'normal', 'fast', 'ultra'];

/**
 * One host tick of the emergency speed policy.
 * @param policy the current setting (re-read every tick)
 * @param trigger a new alert was raised since the last tick
 * @param pending alerted incidents that still need a player dispatch
 * @param neutral the episode did not end well (a failure, losses, a dismissed alert): neutral restore toast
 * @param urgentSec real seconds at live speed the most urgent alert still waiting for a dispatch leaves before even the
 *   best unit arrives too late (Infinity = none waiting); under LIVE_PAUSE_SEC 'live' pauses until dispatched
 */
export function speedPolicy(policy: EmergencyPolicy, st: Readonly<LiveState>, speed: number, trigger: boolean, pending: number, slowmo: number, neutral = false, urgentSec = Infinity): PolicyStep {
  let s: LiveState = { ...st };
  let cur = speed;
  let toast: string | undefined;
  // the setting changed during an episode: end it (the speed it set goes back) and let the new setting take over
  if (s.active && s.policy !== policy) {
    if (s.prevSpeed !== null && cur === s.setSpeed) cur = s.prevSpeed;
    s = { ...LIVE_IDLE };
    if (pending > 0) trigger = true;
  }
  if (trigger && pending > 0 && !s.active && policy !== 'ignore') {
    if (policy === 'live') {
      const ns = cur > 1 ? 1 : cur;
      s = { active: true, policy, prevSpeed: cur > 1 ? cur : null, setSpeed: ns };
      cur = ns;
    } else {
      s = { active: true, policy, prevSpeed: cur > 0 ? cur : null, setSpeed: 0 };
      cur = 0;
    }
  }
  if (s.active && s.policy === 'live' && pending > 0) {
    const urgent = urgentSec < LIVE_PAUSE_SEC;
    if (s.urgentPause) {
      if (cur !== 0) s = { ...s, urgentPause: false }; // the player resumed it himself
      else if (!urgent) {
        // dispatched (or the window closed): continue live
        cur = 1;
        s = { ...s, urgentPause: false, setSpeed: 1 };
      }
    } else if (urgent && !s.urgentUsed && cur > 0) {
      cur = 0;
      s = { ...s, urgentPause: true, urgentUsed: true, setSpeed: 0 };
    }
  }
  if (s.active && pending <= 0) {
    // every alerted emergency is handled: restore the speed the player had, unless they changed it meanwhile
    const head = neutral ? 'Emergency over' : 'Emergencies handled';
    if (s.prevSpeed !== null && cur === s.setSpeed) {
      cur = s.prevSpeed;
      toast = `${head} — back to ${SPEED_NAME[s.prevSpeed] ?? 'normal'} speed`;
    } else if (s.urgentPause && cur === 0) {
      // paused for an urgent alert that ended without a dispatch (it failed / was dismissed / nothing can go): play on
      cur = 1;
      toast = head;
    } else toast = head;
    s = { ...LIVE_IDLE };
  }
  const out: PolicyStep = { liveSlowdown: s.active && s.policy === 'live' && cur === 1 ? Math.max(1, slowmo || 1) : 1, state: s };
  if (toast) out.toast = toast;
  return cur !== speed ? { ...out, speed: cur } : out;
}

/**
 * Which incidents get a banner: queue limit, major-only mode, per-kind cooldown, small-town filter — except a major
 * incident a player dispatch can still save (manualPossible): that one always gets one (shown compact beyond
 * MAX_BANNERS). It holds the LIVE / pause policy and scores as an ignored Dispatch prompt when nobody answers (WP6b),
 * so the player must see it: a second uncovered medical call 7 days after the first used to get no banner and no
 * slow-down, and still cost approval as "ignored".
 */
export class AlertQueue {
  readonly shown: number[] = [];
  private lastByKind = new Map<IncidentKind, number>();
  constructor(public max = MAX_BANNERS, public cooldown = KIND_COOLDOWN, public minPop = ALERT_MIN_POP) {}

  /** would / does this incident get a banner now (and records it) */
  offer(e: { id: number; kind: IncidentKind; major: boolean; manualPossible?: boolean }, day: number, population: number, mode: 'major' | 'all'): boolean {
    if (this.shown.includes(e.id)) return false;
    if (!(e.major && e.manualPossible === true)) {
      if (mode === 'major' && !e.major) return false;
      if (population < this.minPop && e.kind !== 'fire') return false;
      if (e.kind !== 'fire' && day - (this.lastByKind.get(e.kind) ?? -1e9) < this.cooldown) return false;
      if (this.shown.length >= this.max) return false;
    }
    this.shown.push(e.id);
    this.lastByKind.set(e.kind, day);
    return true;
  }

  remove(id: number): void {
    const i = this.shown.indexOf(id);
    if (i >= 0) this.shown.splice(i, 1);
  }

  has(id: number): boolean {
    return this.shown.includes(id);
  }

  clear(): void {
    this.shown.length = 0;
    this.lastByKind.clear();
  }
}

/** 'live' follow: the player sent help and it is still on its way (or just arrived) — the primary responder's unit
 *  (an industrial accident's fire truck, not the ambulance that may have been on scene for a while) */
export function followingDispatch(inc: Incident, now: number): boolean {
  if (inc.answered !== 2) return false;
  const arrived = inc.firstAt ? (inc.firstAt[INCIDENT_RESPONDERS[inc.kind][0]] ?? -1) : inc.arrived;
  if (inc.state === 'dispatched') return arrived < 0 && (inc.etaMin ?? Infinity) <= FOLLOW_MAX_MIN;
  if (inc.state === 'onScene') return arrived >= 0 && now - arrived < FOLLOW_GRACE && (inc.etaMin ?? Infinity) <= FOLLOW_MAX_MIN;
  return false;
}

/** EM-1: the fastest free primary unit that can still save a waiting incident (days), else NaN. */
export function sendDays(inc: Incident, now: number, options: () => readonly DispatchOption[]): number {
  if (!inc.manualPossible || !(inc.state === 'uncovered' || inc.state === 'queued')) return NaN;
  if (now >= dispatchWindowEnd(inc) - 1e-6) return NaN;
  const r = INCIDENT_RESPONDERS[inc.kind][0];
  const left = inc.deadline - now + 1e-6;
  let best = Infinity;
  for (const o of options()) {
    if (o.responder === r && o.free > 0 && o.etaDays <= left && o.etaDays < best) best = o.etaDays;
  }
  return best < Infinity ? best : NaN;
}

export interface PolicyAlert { id: number; wasPossible: boolean }
type Alerts = ReadonlyMap<number, PolicyAlert>;
type SendDays = (inc: Incident) => number;

/** Major prompts never lose their policy just because their event preceded the alert owner. */
export function unbanneredPrompt(inc: Incident, alerts: Alerts, dismissed: ReadonlySet<number>, send: SendDays): boolean {
  return inc.state === 'uncovered' && inc.major && inc.manualPossible && !alerts.has(inc.id) && !dismissed.has(inc.id) && !Number.isNaN(send(inc));
}

/** Waiting prompts plus the primary unit the player sent; an expired unanswered prompt makes the episode neutral. */
export function pendingCount(policy: EmergencyPolicy, alerts: Alerts, incidents: readonly Incident[], dismissed: ReadonlySet<number>, now: number, send: SendDays): { count: number; bad: boolean } {
  let count = 0, bad = false;
  for (const inc of incidents) {
    const alert = alerts.get(inc.id);
    if (!alert) {
      if (unbanneredPrompt(inc, alerts, dismissed, send)) count++;
      continue;
    }
    const waiting = inc.state === 'uncovered' || inc.state === 'queued';
    if (waiting && !Number.isNaN(send(inc))) count++;
    else if (policy === 'live' && followingDispatch(inc, now)) count++;
    else if (waiting && alert.wasPossible) bad = true;
  }
  return { count, bad };
}

/** Seconds at LIVE speed left to send the best free unit, before ignition or a too-late arrival. */
export function urgentSeconds(alerts: Alerts, incidents: readonly Incident[], dismissed: ReadonlySet<number>, now: number, slowmo: number, send: SendDays): number {
  const secPerDay = SECONDS_PER_DAY[1] * Math.max(1, slowmo || 1);
  let best = Infinity;
  for (const inc of incidents) {
    if (!alerts.has(inc.id) && (inc.state !== 'uncovered' || !inc.major || dismissed.has(inc.id))) continue;
    const eta = send(inc);
    if (Number.isNaN(eta)) continue;
    const windowDays = Math.min(dispatchWindowEnd(inc) - now, inc.deadline - now - eta);
    best = Math.min(best, Math.max(0, windowDays) * secPerDay);
  }
  return best;
}

