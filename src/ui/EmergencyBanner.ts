/**
 * Emergency alert banners (WP8) + the LIVE speed policy.
 *
 * An incident no station can auto-answer ('uncovered' with a free unit the player can send) raises a banner at the top
 * of the screen: kind colour + icon, title, place, why nobody is coming ("All 2 fire trucks of Fire Station #3 are
 * busy"), the time since it started and the time left before it fails, and buttons: Jump · Send nearest (ETA) ·
 * Choose station… (DispatchTool) · dismiss. When even the nearest free unit cannot arrive before the deadline
 * (canSend without manualPossible) the banner still shows ("too far?") but the speed is left alone. At most
 * MAX_BANNERS banners; major incidents only unless
 * settings.emergencyAlerts = 'all'; KIND_COOLDOWN days between banners of the same kind (fires always alert); no
 * alerts below ALERT_MIN_POP residents except fires. Covered incidents never alert — they only become statistics.
 *
 * Speed policy (settings.emergencyUncovered, pure function speedPolicy() below):
 *   'live'   an alert drops the game to 1x (remembering fast / ultra) and slows 1x by settings.emergencyLiveSlowmo
 *            (sim.liveSlowdown), so the player can follow the trucks: the game stays live while an alerted incident
 *            waits for a dispatch AND while the unit the player sent is still driving (until it has been on scene
 *            for FOLLOW_GRACE days; not for drives longer than FOLLOW_MAX_MIN). Then the previous speed comes back
 *            (unless the player changed the speed meanwhile) with a toast.
 *   'pause'  an alert pauses the game; the previous speed comes back as soon as help is dispatched.
 *   'ignore' no speed change.
 * The setting is re-read every tick: changing it during an alert ends the current slow-down / pause (the speed it set
 * goes back) and the new setting applies to the incidents still waiting. The restore toast is neutral ("Emergency
 * over") when an alerted incident failed, lost buildings / lives or was dismissed.
 *
 * Emergency times are shown in "emergency minutes": one game-minute of siren driving takes EMERG_DAYS_PER_MIN sim
 * days, so ETAs, "time since" and "time left" all use the same unit ("Send nearest 4.7 min" vs "4.0 min left").
 */
import './emergency.css';
import type { GameContext } from '../game/context';
import type { EmergencyPolicy } from '../game/settings';
import type { IncidentKind } from '../sim/CityState';
import type { EmergencyEvent } from '../sim/Simulation';
import { INCIDENT_COLOR, INCIDENT_ICON, INCIDENT_LABEL, INCIDENT_RESPONDERS, RESPONDER_UNIT, emergencyOf, type EmergencySystem, type Incident } from '../sim/infra/emergency';
import { EMERG_DAYS_PER_MIN } from '../sim/infra/params';
import { openDispatch } from '../game/tools/DispatchTool';
import { clear, h, setText, toggleClass } from './dom';
import { icon } from './icons';

export const MAX_BANNERS = 3;
export const KIND_COOLDOWN = 15;
export const ALERT_MIN_POP = 1000;
/** 'live': after a player dispatch the game stays live until the first unit has been on scene this long (days) ... */
export const FOLLOW_GRACE = 0.75;
/** ... unless its drive is longer than this (game minutes): then the previous speed comes back right away */
export const FOLLOW_MAX_MIN = 15;

// ------------------------------------------------------------------------------------------------ pure policy
/** LIVE-mode bookkeeping between UI ticks */
export interface LiveState {
  active: boolean;
  policy: EmergencyPolicy | null;
  /** speed to restore when every alerted incident is handled (null = leave it) */
  prevSpeed: number | null;
  /** the speed the policy set (the player changed it if the current speed differs) */
  setSpeed: number | null;
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
 * One UI tick of the emergency speed policy.
 * @param policy the current setting (re-read every tick)
 * @param trigger a new alert was raised since the last tick
 * @param pending alerted incidents that still need a player dispatch
 * @param neutral the episode did not end well (a failure, losses, a dismissed alert): neutral restore toast
 */
export function speedPolicy(policy: EmergencyPolicy, st: Readonly<LiveState>, speed: number, trigger: boolean, pending: number, slowmo: number, neutral = false): PolicyStep {
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
  if (s.active && pending <= 0) {
    // every alerted emergency is handled: restore the speed the player had, unless they changed it meanwhile
    const head = neutral ? 'Emergency over' : 'Emergencies handled';
    if (s.prevSpeed !== null && cur === s.setSpeed) {
      cur = s.prevSpeed;
      toast = `${head} — back to ${SPEED_NAME[s.prevSpeed] ?? 'normal'} speed`;
    } else toast = head;
    s = { ...LIVE_IDLE };
  }
  const out: PolicyStep = { liveSlowdown: s.active && s.policy === 'live' && cur === 1 ? Math.max(1, slowmo || 1) : 1, state: s };
  if (cur !== speed) out.speed = cur;
  if (toast) out.toast = toast;
  return out;
}

/** which incidents get a banner: queue limit, major-only mode, per-kind cooldown, small-town filter */
export class AlertQueue {
  readonly shown: number[] = [];
  private lastByKind = new Map<IncidentKind, number>();
  constructor(public max = MAX_BANNERS, public cooldown = KIND_COOLDOWN, public minPop = ALERT_MIN_POP) {}

  /** would / does this incident get a banner now (and records it) */
  offer(e: { id: number; kind: IncidentKind; major: boolean }, day: number, population: number, mode: 'major' | 'all'): boolean {
    if (this.shown.includes(e.id)) return false;
    if (mode === 'major' && !e.major) return false;
    if (population < this.minPop && e.kind !== 'fire') return false;
    if (e.kind !== 'fire' && day - (this.lastByKind.get(e.kind) ?? -1e9) < this.cooldown) return false;
    if (this.shown.length >= this.max) return false;
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

// ------------------------------------------------------------------------------------------------ shared UI helpers
/** a duration in sim days as emergency minutes ("4.0 min"; 1 game-minute of siren driving = EMERG_DAYS_PER_MIN days) */
export function emgTime(days: number): string {
  if (!Number.isFinite(days)) return '—';
  const m = Math.max(0, days / EMERG_DAYS_PER_MIN);
  return m < 10 ? `${m.toFixed(1)} min` : `${Math.round(m)} min`;
}
export function minText(m: number): string {
  return Number.isFinite(m) ? `${m.toFixed(1)} min` : 'no route';
}
export function kindIcon(kind: IncidentKind, size = 18): string {
  return icon(INCIDENT_ICON[kind] ?? 'alert', size);
}
/** the unit still driving to an incident that arrives first: its station and the time left (days) */
export function nextArrival(em: EmergencySystem | undefined, inc: Incident, now: number): { station: string; days: number } | null {
  if (!em) return null;
  let best: { stationId: number; arrive: number } | null = null;
  for (const v of em.vehicles()) if (v.incidentId === inc.id && v.state === 'outbound' && (!best || v.arrive < best.arrive)) best = v;
  return best ? { station: em.stationName(best.stationId), days: Math.max(0, best.arrive - now) } : null;
}
/** what is happening to an incident, in words (with `em`: a live countdown to the first arrival) */
export function stateText(inc: Incident, now: number, em?: EmergencySystem): string {
  const unit = RESPONDER_UNIT[INCIDENT_RESPONDERS[inc.kind][0]];
  const Unit = unit[0][0].toUpperCase() + unit[0].slice(1);
  switch (inc.state) {
    case 'queued': return inc.reason === 'busy' ? 'Waiting for a unit to come back' : 'Dispatch pending';
    case 'uncovered': return inc.manualPossible ? 'Nobody is coming — dispatch a unit' : inc.canSend ? 'Nobody nearby — the nearest free unit is too far to make it in time' : 'Nobody can reach it';
    case 'dispatched': {
      const a = nextArrival(em, inc, now);
      // the unit is at the site between two sim days (the day tick registers the arrival): no "arrives in 0.0 min"
      if (a) return a.days < 0.05 ? `${Unit} from ${a.station} arriving now` : `${Unit} from ${a.station} on the way — arrives in ${emgTime(a.days)}`;
      return inc.etaMin !== undefined ? `${Unit} on the way (ETA ${minText(inc.etaMin)})` : 'Help on the way';
    }
    case 'onScene': return inc.kind === 'fire' ? `Firefighters on scene (${inc.fires.length} burning)` : inc.kind === 'medical' ? 'Paramedics on scene' : 'Responders on scene';
    case 'resolved': return 'Resolved';
    case 'failed': return 'Failed';
  }
  return '';
}
/** what an incident cost ("2 buildings lost · 1 dead"; '' when nothing) */
export function lossText(inc: Pick<Incident, 'lost' | 'deaths'>): string {
  const parts: string[] = [];
  if (inc.lost > 0) parts.push(`${inc.lost} building${inc.lost === 1 ? '' : 's'} lost`);
  if (inc.deaths > 0) parts.push(`${inc.deaths} dead`);
  return parts.join(' · ');
}
/** "Elementary School · (27, 45)" (sites without a building already carry their cell: "the highway (12, 40)") */
export function placeText(inc: Incident, sep = ' '): string {
  return /\(\d+, \d+\)$/.test(inc.place) ? inc.place : `${inc.place}${sep}(${inc.x}, ${inc.z})`;
}
/** 'live' follow: the player sent help and it is still on its way (or just arrived) */
export function followingDispatch(inc: Incident, now: number): boolean {
  if (inc.answered !== 2) return false;
  if (inc.state === 'dispatched') return inc.arrived < 0 && (inc.etaMin ?? Infinity) <= FOLLOW_MAX_MIN;
  if (inc.state === 'onScene') return inc.arrived >= 0 && now - inc.arrived < FOLLOW_GRACE && (inc.etaMin ?? Infinity) <= FOLLOW_MAX_MIN;
  return false;
}

// ------------------------------------------------------------------------------------------------ banners
interface BannerEl {
  id: number;
  /** the incident (its final lost / deaths are read when it ends) */
  inc: Incident;
  el: HTMLDivElement;
  title: HTMLElement;
  place: HTMLElement;
  note: HTMLElement;
  time: HTMLElement;
  send: HTMLButtonElement;
  /** real ms when the banner should go (after resolved / dispatched) */
  closeAt: number;
  optsDay: number;
  /** outcome line once the incident is over */
  outcome?: string;
  /** a unit could make it in time at some point (the alert held the speed policy) */
  wasPossible?: boolean;
}

export class EmergencyBanner {
  readonly el: HTMLDivElement;
  private queue = new AlertQueue();
  private banners = new Map<number, BannerEl>();
  private more: HTMLDivElement;
  private live: LiveState = { ...LIVE_IDLE };
  private trigger = false;
  private dismissed = new Set<number>();
  private lastState: unknown = null;
  /** an alerted incident of the current LIVE / pause episode failed, lost buildings or lives, or was dismissed */
  private episodeBad = false;

  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.el = h('div', { class: 'emg-banners' });
    this.more = h('div', { class: 'emg-more mp-glass', style: 'display:none' });
    this.more.addEventListener('click', () => this.ctx.panels.open('emergencies'));
    this.el.appendChild(this.more);
    parent.appendChild(this.el);
    const off = ctx.sim.events.on('emergency', (e) => this.onEvent(e));
    const offReset = ctx.sim.events.on('reset', () => this.reset());
    const offTick = ctx.ui.on('uiTick', () => this.tick());
    ctx.signal.addEventListener('abort', () => { off(); offReset(); offTick(); });
  }

  /** the LIVE badge: an alert is holding the game at (slowed) 1x */
  get liveActive(): boolean {
    return this.live.active && this.live.policy === 'live';
  }

  private reset(): void {
    for (const b of this.banners.values()) b.el.remove();
    this.banners.clear();
    this.queue.clear();
    this.dismissed.clear();
    this.live = { ...LIVE_IDLE };
    this.ctx.sim.liveSlowdown = 1;
    // a loaded game: incidents that were already waiting for the player get their banners back
    const em = emergencyOf(this.ctx.sim);
    this.episodeBad = false;
    if (em) for (const inc of em.incidents()) if (inc.state === 'uncovered' && (inc.manualPossible || inc.canSend)) this.onEvent({ type: 'uncovered', id: inc.id, kind: inc.kind, x: inc.x, z: inc.z, major: inc.major, manualPossible: inc.manualPossible });
  }

  private onEvent(e: EmergencyEvent): void {
    if (e.type === 'resolved' || e.type === 'failed') {
      const b = this.banners.get(e.id);
      if (b) {
        const losses = lossText(b.inc);
        b.outcome = e.type === 'failed' ? 'Help came too late' + (losses ? ` — ${losses}` : '') : `${INCIDENT_LABEL[e.kind]} under control` + (losses ? ` — ${losses}` : '');
        if (e.type === 'failed' || losses) this.episodeBad = true;
      }
      return;
    }
    if (e.type !== 'uncovered' || this.dismissed.has(e.id)) return;
    const inc = emergencyOf(this.ctx.sim)?.incident(e.id);
    // a banner when the player can send a unit; LIVE / pause only when it can still arrive in time (manualPossible)
    if (!inc || !(inc.manualPossible || inc.canSend)) return;
    const shown = this.banners.get(e.id);
    if (shown) {
      // already on screen (e.g. first as "too far"): the speed policy starts once a unit can make it in time
      if (inc.manualPossible) {
        shown.wasPossible = true;
        this.trigger = true;
        this.applyPolicy();
      }
      return;
    }
    const st = this.ctx.state;
    const mode = this.ctx.settings.emergencyAlerts ?? 'major';
    if (!this.queue.offer(e, st.day, st.stats.population, mode)) return;
    this.addBanner(inc);
    if (inc.manualPossible) {
      this.trigger = true;
      this.banners.get(inc.id)!.wasPossible = true;
    }
    this.ctx.sound('warning');
    // apply the speed policy right away: at ultra speed a UI tick (~0.16 s) would already be 3 game days
    this.applyPolicy();
  }

  /** alerted incidents that still need the player: waiting for a dispatch, or ('live') the unit they sent is still on
   *  its way / just arrived */
  private pendingCount(policy: EmergencyPolicy): number {
    const em = emergencyOf(this.ctx.sim);
    const now = this.ctx.sim.simTime();
    let n = 0;
    for (const [id, b] of this.banners) {
      const inc = em?.incident(id);
      if (!inc) continue;
      const waiting = inc.state === 'uncovered' || inc.state === 'queued';
      if (waiting && inc.manualPossible) n++;
      else if (policy === 'live' && followingDispatch(inc, now)) n++;
      // nobody was sent while a unit could still make it: whatever ends this episode, it did not end well
      else if (waiting && b.wasPossible) this.episodeBad = true;
    }
    return n;
  }

  private applyPolicy(): void {
    const sim = this.ctx.sim;
    const policy = this.ctx.settings.emergencyUncovered ?? 'live';
    const was = this.live.active;
    const step = speedPolicy(policy, this.live, sim.speed, this.trigger, this.pendingCount(policy), this.ctx.settings.emergencyLiveSlowmo ?? 3, this.episodeBad);
    this.trigger = false;
    this.live = step.state;
    // outcomes count per episode: from the alert that starts it to the restore toast that ends it
    if (was !== this.live.active || step.toast) this.episodeBad = false;
    if (step.speed !== undefined && step.speed !== sim.speed) sim.speed = step.speed;
    if (sim.liveSlowdown !== step.liveSlowdown) sim.liveSlowdown = step.liveSlowdown;
    if (step.toast) this.ctx.toast(step.toast, step.toast.startsWith('Emergencies handled') ? 'good' : 'info', undefined, 'Emergency');
    if (this.live.active !== this.lastState) {
      this.lastState = this.live.active;
      toggleClass(this.ctx.root, 'emg-live', this.liveActive);
    }
  }

  private addBanner(inc: Incident): void {
    const color = INCIDENT_COLOR[inc.kind];
    const title = h('div', { class: 'emg-title' });
    const place = h('div', { class: 'emg-place' });
    const note = h('div', { class: 'emg-note' });
    const time = h('div', { class: 'emg-time' });
    const jump = h('button', { class: 'btn sm', title: 'Show on the map', html: icon('target', 13) + '<span>Jump</span>' });
    const send = h('button', { class: 'btn sm primary', title: 'Dispatch the fastest free unit' }) as HTMLButtonElement;
    const choose = h('button', { class: 'btn sm', title: 'Pick the station yourself (Dispatch tool)', html: '<span>Choose station…</span>' });
    const close = h('button', { class: 'icon-btn emg-x', title: 'Dismiss', html: icon('close', 14) });
    const el = h('div', { class: 'emg-banner mp-glass', style: { '--kc': color } as Record<string, string> },
      h('div', { class: 'emg-ico', html: kindIcon(inc.kind, 22) }),
      h('div', { class: 'emg-body' }, h('div', { class: 'emg-head' }, title, time), place, note, h('div', { class: 'emg-btns' }, jump, send, choose)),
      close,
    );
    jump.addEventListener('click', () => this.jump(inc.id));
    send.addEventListener('click', () => this.sendNearest(inc.id));
    choose.addEventListener('click', () => openDispatch(this.ctx, inc.id));
    close.addEventListener('click', () => this.dismiss(inc.id));
    this.el.insertBefore(el, this.more);
    const b: BannerEl = { id: inc.id, inc, el, title, place, note, time, send, closeAt: 0, optsDay: -1 };
    this.banners.set(inc.id, b);
    this.refresh(b, inc);
  }

  private jump(id: number): void {
    const inc = emergencyOf(this.ctx.sim)?.incident(id);
    if (!inc) return;
    this.ctx.focusCell(inc.x, inc.z, 420);
    this.ctx.showQuery({ buildingId: inc.buildingId >= 0 ? inc.buildingId : null, x: inc.x, z: inc.z });
  }

  private sendNearest(id: number): void {
    const em = emergencyOf(this.ctx.sim);
    if (!em) return;
    const r = em.dispatchBest(this.ctx.sim, id);
    if (r.ok) {
      this.ctx.sound('confirm');
      this.ctx.toast(`Unit dispatched — ETA ${minText(r.etaMin ?? NaN)}`, 'good');
    } else {
      this.ctx.sound('error');
      this.ctx.toast(r.reason ?? 'No unit available', 'warning');
    }
  }

  private dismiss(id: number): void {
    this.dismissed.add(id);
    const inc = emergencyOf(this.ctx.sim)?.incident(id);
    if (inc && (inc.state === 'uncovered' || inc.state === 'queued')) this.episodeBad = true; // left unanswered
    this.removeBanner(id);
  }

  private removeBanner(id: number): void {
    const b = this.banners.get(id);
    this.queue.remove(id);
    if (!b) return;
    this.banners.delete(id);
    b.el.classList.add('out');
    setTimeout(() => b.el.remove(), 250);
  }

  private refresh(b: BannerEl, inc: Incident): void {
    const sim = this.ctx.sim;
    const now = sim.simTime();
    setText(b.title, INCIDENT_LABEL[inc.kind] + (inc.kind === 'fire' && inc.fires.length > 1 ? ` · ${inc.fires.length} buildings` : inc.kind === 'riot' ? ` · radius ${Math.round(inc.radius)}` : ''));
    setText(b.place, placeText(inc, ' · '));
    const waiting = inc.state === 'uncovered' || inc.state === 'queued';
    const em = emergencyOf(sim);
    setText(b.note, waiting ? inc.note || stateText(inc, now, em) : stateText(inc, now, em));
    const left = inc.deadline - now;
    setText(b.time, `${emgTime(now - inc.start)} ago${waiting && left > 0 ? ` · ${emgTime(left)} left` : ''}`);
    toggleClass(b.el, 'urgent', waiting && left < 2 * EMERG_DAYS_PER_MIN);
    toggleClass(b.el, 'handled', !waiting);
    // "Send nearest (ETA)" from the (3-day cached) dispatch options
    if (waiting && em && b.optsDay !== sim.state.day) {
      b.optsDay = sim.state.day;
      const best = em.dispatchOptions(sim, inc.id).find((o) => o.free > 0 && Number.isFinite(o.etaMin));
      b.send.disabled = !best;
      // warn when the fastest free unit cannot make it before the deadline (same unit: emergency minutes)
      const late = !!best && best.etaDays > inc.deadline - now;
      b.send.innerHTML = best ? `<span>Send nearest</span><span class="emg-eta">${minText(best.etaMin)}${late ? ' · too far?' : ''}</span>` : '<span>No free unit</span>';
      b.send.title = best ? `${best.name}: arrives in ${minText(best.etaMin)}${late ? ` — only ${emgTime(Math.max(0, left))} left: probably too late, build a station closer` : ''}` : 'Every station of this type is busy or cannot reach it';
    }
    b.send.style.display = waiting ? '' : 'none';
  }

  private tick(): void {
    const sim = this.ctx.sim;
    const em = emergencyOf(sim);
    const nowMs = performance.now();
    const now = sim.simTime();
    const live = (this.ctx.settings.emergencyUncovered ?? 'live') === 'live';
    for (const b of [...this.banners.values()]) {
      const inc = em?.incident(b.id);
      if (!inc) {
        // resolved / failed: the banner lingers briefly with the outcome
        if (!b.closeAt) {
          b.closeAt = nowMs + 2500;
          toggleClass(b.el, 'handled', true);
          setText(b.note, b.outcome ?? 'Over');
          b.send.style.display = 'none';
        } else if (nowMs > b.closeAt) this.removeBanner(b.id);
        continue;
      }
      // the banner stays while the incident waits for the player and ('live') while the unit they sent drives there
      const waiting = inc.state === 'uncovered' || inc.state === 'queued';
      if (!waiting && !(live && followingDispatch(inc, now))) {
        if (!b.closeAt) b.closeAt = nowMs + 4000;
        else if (nowMs > b.closeAt) { this.removeBanner(b.id); continue; }
      } else b.closeAt = 0;
      this.refresh(b, inc);
    }
    // incidents that need the player but have no banner (cooldown / queue full)
    let hidden = 0;
    if (em) for (const inc of em.incidents()) if (inc.state === 'uncovered' && inc.manualPossible && inc.major && !this.banners.has(inc.id)) hidden++;
    this.more.style.display = hidden ? '' : 'none';
    if (hidden) this.more.innerHTML = `${icon('alert', 14)}<span>${hidden} more emergenc${hidden === 1 ? 'y needs' : 'ies need'} you — open Emergencies</span>`;
    this.applyPolicy();
  }

  /** tests / dev: current banners (incident ids) */
  get bannerIds(): number[] {
    return [...this.banners.keys()];
  }

  dispose(): void {
    clear(this.el);
    this.el.remove();
  }
}
