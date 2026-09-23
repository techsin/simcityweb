/**
 * Emergency alert banners (WP8) + the LIVE speed policy.
 *
 * An incident no station can auto-answer ('uncovered' with a possible player dispatch) raises a banner at the top of
 * the screen: kind colour + icon, title, place, why nobody is coming ("All 2 fire trucks of Fire Station #3 are
 * busy"), the time since it started and the time left before it fails, and buttons: Jump · Send nearest (ETA) ·
 * Choose station… (DispatchTool) · dismiss. At most MAX_BANNERS banners; major incidents only unless
 * settings.emergencyAlerts = 'all'; KIND_COOLDOWN days between banners of the same kind (fires always alert); no
 * alerts below ALERT_MIN_POP residents except fires. Covered incidents never alert — they only become statistics.
 *
 * Speed policy (settings.emergencyUncovered, pure function speedPolicy() below):
 *   'live'   an alert drops the game to 1x (remembering fast / ultra) and slows 1x by settings.emergencyLiveSlowmo
 *            (sim.liveSlowdown), so the player can follow the trucks; when every alerted incident is handled the
 *            previous speed comes back (unless the player changed the speed meanwhile) with a toast.
 *   'pause'  an alert pauses the game (the previous speed comes back the same way).
 *   'ignore' no speed change.
 */
import './emergency.css';
import type { GameContext } from '../game/context';
import type { EmergencyPolicy } from '../game/settings';
import type { IncidentKind } from '../sim/CityState';
import type { EmergencyEvent } from '../sim/Simulation';
import { INCIDENT_COLOR, INCIDENT_ICON, INCIDENT_LABEL, INCIDENT_RESPONDERS, RESPONDER_UNIT, emergencyOf, type Incident } from '../sim/infra/emergency';
import { openDispatch } from '../game/tools/DispatchTool';
import { clear, h, setText, toggleClass } from './dom';
import { icon } from './icons';

export const MAX_BANNERS = 3;
export const KIND_COOLDOWN = 15;
export const ALERT_MIN_POP = 1000;

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
 * @param trigger a new alert was raised since the last tick
 * @param pending alerted incidents that still need a player dispatch
 */
export function speedPolicy(policy: EmergencyPolicy, st: Readonly<LiveState>, speed: number, trigger: boolean, pending: number, slowmo: number): PolicyStep {
  let s: LiveState = { ...st };
  const out: PolicyStep = { liveSlowdown: 1, state: s };
  if (trigger && pending > 0 && !s.active && policy !== 'ignore') {
    if (policy === 'live') {
      const ns = speed > 1 ? 1 : speed;
      s = { active: true, policy, prevSpeed: speed > 1 ? speed : null, setSpeed: ns };
      if (ns !== speed) out.speed = ns;
    } else {
      s = { active: true, policy, prevSpeed: speed > 0 ? speed : null, setSpeed: 0 };
      if (speed !== 0) out.speed = 0;
    }
  }
  if (s.active && pending <= 0) {
    // every alerted emergency is handled: restore the speed the player had, unless they changed it meanwhile
    if (s.prevSpeed !== null && speed === s.setSpeed) {
      out.speed = s.prevSpeed;
      out.toast = `Emergencies handled — back to ${SPEED_NAME[s.prevSpeed] ?? 'normal'} speed`;
    } else out.toast = 'Emergencies handled';
    s = { ...LIVE_IDLE };
  }
  out.state = s;
  const eff = out.speed ?? speed;
  out.liveSlowdown = s.active && s.policy === 'live' && eff === 1 ? Math.max(1, slowmo || 1) : 1;
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
/** "3 days" / "18 hours" (1 game day = 24 hours) */
export function daysText(d: number): string {
  if (!Number.isFinite(d)) return '—';
  if (d < 1) return `${Math.max(1, Math.round(d * 24))} h`;
  return d < 10 ? `${d.toFixed(1)} days` : `${Math.round(d)} days`;
}
export function minText(m: number): string {
  return Number.isFinite(m) ? `${m.toFixed(1)} min` : 'no route';
}
export function kindIcon(kind: IncidentKind, size = 18): string {
  return icon(INCIDENT_ICON[kind] ?? 'alert', size);
}
/** what is happening to an incident, in words */
export function stateText(inc: Incident, now: number): string {
  const unit = RESPONDER_UNIT[INCIDENT_RESPONDERS[inc.kind][0]];
  switch (inc.state) {
    case 'queued': return 'Waiting for a unit to come back';
    case 'uncovered': return inc.manualPossible ? 'Nobody is coming — dispatch a unit' : 'Nobody can reach it';
    case 'dispatched': return inc.etaMin !== undefined ? `${unit[0][0].toUpperCase() + unit[0].slice(1)} on the way (ETA ${minText(inc.etaMin)})` : 'Help on the way';
    case 'onScene': return inc.kind === 'fire' ? `Firefighters on scene (${inc.fires.length} burning)` : 'Responders on scene';
    case 'resolved': return 'Resolved';
    case 'failed': return 'Failed';
  }
  void now;
  return '';
}

// ------------------------------------------------------------------------------------------------ banners
interface BannerEl {
  id: number;
  el: HTMLDivElement;
  title: HTMLElement;
  place: HTMLElement;
  note: HTMLElement;
  time: HTMLElement;
  send: HTMLButtonElement;
  /** real ms when the banner should go (after resolved / dispatched) */
  closeAt: number;
  optsDay: number;
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
    if (em) for (const inc of em.incidents()) if (inc.state === 'uncovered' && inc.manualPossible) this.onEvent({ type: 'uncovered', id: inc.id, kind: inc.kind, x: inc.x, z: inc.z, major: inc.major, manualPossible: true });
  }

  private onEvent(e: EmergencyEvent): void {
    if (e.type !== 'uncovered' || !e.manualPossible) return;
    if (this.dismissed.has(e.id)) return;
    const st = this.ctx.state;
    const mode = this.ctx.settings.emergencyAlerts ?? 'major';
    if (!this.queue.offer(e, st.day, st.stats.population, mode)) return;
    const inc = emergencyOf(this.ctx.sim)?.incident(e.id);
    if (!inc) {
      this.queue.remove(e.id);
      return;
    }
    this.addBanner(inc);
    this.trigger = true;
    this.ctx.sound('warning');
    // apply the speed policy right away: at ultra speed a UI tick (~0.16 s) would already be 3 game days
    this.applyPolicy();
  }

  /** alerted incidents that still need a player dispatch */
  private pendingCount(): number {
    const em = emergencyOf(this.ctx.sim);
    let n = 0;
    for (const id of this.banners.keys()) {
      const inc = em?.incident(id);
      if (inc && (inc.state === 'uncovered' || inc.state === 'queued') && inc.manualPossible) n++;
    }
    return n;
  }

  private applyPolicy(): void {
    const sim = this.ctx.sim;
    const policy = this.ctx.settings.emergencyUncovered ?? 'live';
    const step = speedPolicy(policy, this.live, sim.speed, this.trigger, this.pendingCount(), this.ctx.settings.emergencyLiveSlowmo ?? 3);
    this.trigger = false;
    this.live = step.state;
    if (step.speed !== undefined && step.speed !== sim.speed) sim.speed = step.speed;
    if (sim.liveSlowdown !== step.liveSlowdown) sim.liveSlowdown = step.liveSlowdown;
    if (step.toast) this.ctx.toast(step.toast, 'good', undefined, 'Emergency');
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
    const b: BannerEl = { id: inc.id, el, title, place, note, time, send, closeAt: 0, optsDay: -1 };
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
    setText(b.place, `${inc.place} · (${inc.x}, ${inc.z})`);
    const waiting = inc.state === 'uncovered' || inc.state === 'queued';
    setText(b.note, waiting ? inc.note || stateText(inc, now) : stateText(inc, now));
    const left = inc.deadline - now;
    setText(b.time, `${daysText(now - inc.start)} ago${waiting && left > 0 ? ` · ${daysText(left)} left` : ''}`);
    toggleClass(b.el, 'urgent', waiting && left < 2);
    toggleClass(b.el, 'handled', !waiting);
    // "Send nearest (ETA)" from the (3-day cached) dispatch options
    const em = emergencyOf(sim);
    if (waiting && em && b.optsDay !== sim.state.day) {
      b.optsDay = sim.state.day;
      const best = em.dispatchOptions(sim, inc.id).find((o) => o.free > 0 && Number.isFinite(o.etaMin));
      b.send.disabled = !best;
      // 1 game minute of driving = 1 day: warn when the fastest unit cannot make it before the deadline
      const late = !!best && best.etaDays > inc.deadline - now;
      b.send.innerHTML = best ? `<span>Send nearest</span><span class="emg-eta">${minText(best.etaMin)}${late ? ' · too far?' : ''}</span>` : '<span>No free unit</span>';
      b.send.title = best ? `${best.name}: arrives in ${daysText(best.etaDays)}${late ? ' — probably too late; build a station closer' : ''}` : 'Every station of this type is busy or cannot reach it';
    }
    b.send.style.display = waiting ? '' : 'none';
  }

  private tick(): void {
    const sim = this.ctx.sim;
    const em = emergencyOf(sim);
    const nowMs = performance.now();
    for (const b of [...this.banners.values()]) {
      const inc = em?.incident(b.id);
      if (!inc) {
        // resolved / failed: the banner lingers briefly
        if (!b.closeAt) {
          b.closeAt = nowMs + 2500;
          toggleClass(b.el, 'handled', true);
          setText(b.note, 'Over');
          b.send.style.display = 'none';
        } else if (nowMs > b.closeAt) this.removeBanner(b.id);
        continue;
      }
      const waiting = inc.state === 'uncovered' || inc.state === 'queued';
      if (!waiting) {
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
