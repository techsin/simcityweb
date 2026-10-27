/**
 * Emergency alert banners (WP8), rendered from host.policy. SimCore owns selection, dismissals and LIVE speed.
 *
 * An incident no station can auto-answer ('uncovered' with a free unit the player can send) raises a banner at the top
 * of the screen: kind colour + icon, title, place, why nobody is coming ("All 2 fire trucks of Fire Station #3 are
 * busy"), the time since it started and the time left before it fails, and buttons: Jump · Send nearest (ETA) ·
 * Choose station… (DispatchTool) · dismiss. When even the nearest free unit cannot arrive before the deadline
 * (canSend without manualPossible) the banner still shows ("too far?") but the speed is left alone. At most
 * MAX_BANNERS full banners; major incidents only unless
 * settings.emergencyAlerts = 'all'; KIND_COOLDOWN days between banners of the same kind (fires always alert); no
 * alerts below ALERT_MIN_POP residents except fires — but a MAJOR incident a dispatch can still save (manualPossible)
 * always gets a banner (compact beyond MAX_BANNERS) and holds the speed policy: it scores as an ignored prompt when
 * nobody answers. Covered incidents never alert — they only become statistics.
 * A prompt counts (banner, LIVE mode, urgent pause, "N more" pill) only while a dispatch can really go (EM-1):
 * manualPossible and a free unit of its primary responder among the dispatch options that still arrives in time (the
 * Send button re-reads them after any dispatch); 'uncovered' events are taken up
 * once the dispatch call that raised them is over (a microtask), so a disaster's burst — each incident dispatched at
 * once, a later one taking the unit an earlier one counted on — raises no alert for a prompt that is already gone.
 * The countdown is the player's window (emergency.ts dispatchWindowEnd: an industrial accident's plant ignites 3
 * minutes after it started unless a fire truck is on its way: "3.0 min left to send a truck", never "too far?" then);
 * it stops once a building is lost or the incident is over (the outcome shows instead: "No fire truck could reach it in
 * time" when nobody was ever sent, "Help came too late" when it came after the loss). A supporting unit already sent
 * (an industrial accident's ambulance) gets its own line; the incident keeps waiting for its fire truck. A loaded
 * game's waiting incidents get their banners (and the policy) back on the first tick the sim systems exist. The stack
 * docks beside open panels (dockBanners), and never covers a panel's title and tabs, nor the bottom toolbar or its open
 * flyout (fitRows: the banners that do not fit, "No free unit" ones first, are counted by the "N more" pill; final fixes
 * r4 U1: an open flyout also stacks above the banners, hud.css). The Send button's and the pill's texts change in place
 * (stable spans: a click whose press and release span a rewrite would be lost, EM-4), and the stack does not re-dock
 * while one of its banners is pressed (the press may close the flyout); the docking re-measures the layout only after a
 * change (EM-3: no forced layout per UI tick, none at all without a banner).
 *
 * Speed policy (settings.emergencyUncovered, src/game/emergencyPolicy.ts, run by SimCore's LivePolicy):
 *   'live'   an alert drops the game to 1x (remembering fast / ultra) and slows 1x by settings.emergencyLiveSlowmo
 *            (sim.liveSlowdown), so the player can follow the trucks: the game stays live while an alerted incident
 *            waits for a dispatch AND while the unit the player sent is still driving (until it has been on scene
 *            for FOLLOW_GRACE days; not for drives longer than FOLLOW_MAX_MIN). Then the previous speed comes back
 *            (unless the player changed the speed meanwhile) with a toast.
 *            Too little time to react (critic item 27): when the most urgent alerted incident leaves less than
 *            LIVE_PAUSE_SEC real seconds at live speed before even the best dispatch arrives too late ((time left −
 *            best ETA) × seconds per live day), 'live' pauses until the player dispatches, then continues live. A player
 *            who resumes the game himself is not paused again in the same episode.
 *   'pause'  an alert pauses the game; the previous speed comes back as soon as help is dispatched.
 *   'ignore' no speed change.
 * Settings changes go through setSettings: changing it during an alert ends the current slow-down / pause (the speed it set
 * goes back) and the new setting applies to the incidents still waiting. The restore toast is neutral ("Emergency
 * over") when an alerted incident failed, lost buildings / lives or was dismissed.
 *
 * Emergency times are shown in "emergency minutes": one game-minute of siren driving takes EMERG_DAYS_PER_MIN sim
 * days, so ETAs, "time since" and "time left" all use the same unit ("Send nearest 4.7 min" vs "4.0 min left").
 */
import './emergency.css';
import type { GameContext } from '../game/context';
import { MAX_BANNERS, sendDays } from '../game/emergencyPolicy';
import { DispatchOptionsWatches, type EmergencyView, type PolicySnapshot } from '../worker/SimHost';
import type { IncidentKind, Responder } from '../sim/CityState';
import type { EmergencyEvent } from '../sim/Simulation';
import {
  INCIDENT_COLOR, INCIDENT_ICON, INCIDENT_LABEL, INCIDENT_RESPONDERS, RESPONDER_UNIT, dispatchWindowEnd,
  type EmergencyVehicle, type Incident,
} from '../sim/infra/emergency';
import { EMERG_DAYS_PER_MIN } from '../sim/infra/params';
import { openDispatch } from '../game/tools/DispatchTool';
import { clear, h, setText, toggleClass } from './dom';
import { icon } from './icons';

// Kept here for the existing policy consumers and tests.
export { AlertQueue, ALERT_MIN_POP, FOLLOW_GRACE, FOLLOW_MAX_MIN, KIND_COOLDOWN, LIVE_IDLE, LIVE_PAUSE_SEC, MAX_BANNERS, followingDispatch, speedPolicy, type LiveState, type PolicyStep } from '../game/emergencyPolicy';

// ------------------------------------------------------------------------------------------------ docking (P9)
/** banner stack width (css px, emergency.css) */
export const BANNER_W = 440;
/** the narrowest the stack may get to fit beside open panels */
export const BANNER_MIN_W = 340;
/** a panel's title bar + tab row (css px) */
export const PANEL_HEAD_H = 96;
/** the stack's top (css px, emergency.css .emg-banners) */
export const STACK_TOP = 70;
/** EM-2: banners shown (compact) below the panels' header rows when nothing fits beside the panels; the rest are
 *  listed by the "N more emergencies" pill */
export const FALLBACK_ROWS = 2;
/** room kept free above the layer's bottom edge for the fallback stack (the toolbar), when the toolbar is not found */
const BOTTOM_KEEP = 84;
/** room kept free between the stack and the bottom toolbar block (final fixes r3) */
export const TOOLBAR_GAP = 12;
/**
 * Close-out c1: a press on a banner's button or the pill is ignored while that banner (or the pill) has just moved under
 * the pointer — from the change (re-docked: a toolbar flyout opened, a panel moved; banners above it re-ordered, added,
 * removed or switched between full and compact; it was itself added or switched) until this long (real ms) after it was
 * first on screen: it was aimed at what sat there before (opening the Civic flyout re-docked the stack to compact rows,
 * and a press meant for one banner's Jump landed on the next banner's — Send nearest is on the same row). Close-out c2:
 * only the banners that moved (a press on one above the change, or on one that stayed, clicks at once), and an ignored
 * press says so: the banner flashes (SETTLE_FLASH_MS) and its click plays the denied sound.
 */
export const SETTLE_MS = 350;
/** close-out c2: how long a banner (or the pill) flashes when a press on it was ignored (real ms) */
export const SETTLE_FLASH_MS = 260;
/** a banner's height as a full / compact one when it was never measured at the stack's width (layout px) */
const FULL_H = 150, COMP_H = 64;
export interface DockRect { x: number; y: number; w: number; h: number }
/** where the stack goes: left / width (css px), all banners compact, its top (default STACK_TOP) and the number of
 *  banners shown (0 = all) */
export interface DockPlace { left: number; width: number; compact?: boolean; top?: number; rows?: number }
/** the fallback stack's geometry: the layer's height, one compact banner and the "more" pill (each with its 8 px gap),
 *  the number of banners and the lowest the stack may reach (default: BOTTOM_KEEP above the layer's bottom) */
export interface DockFallback { H: number; rowH: number; moreH: number; n: number; bottom?: number }

/**
 * How many banners of a stack from `top` fit above `bottom` (layout px; final fixes r3: an M7 quake stacked 10 banners
 * from y≈55 past the bottom of a 720p window, over the toolbar buttons the player needed to build the missing fire
 * station): `heights` are the banners' heights in display order, 8 px apart; while they do not all fit — or `pill` (the
 * "N more emergencies" pill shows anyway) — the pill below them takes `moreH` (its height and gap). 0: all of them fit;
 * else the number that do, at least one.
 */
export function fitRows(top: number, bottom: number, heights: readonly number[], moreH: number, pill = false): number {
  const n = heights.length;
  let best = 0, y = top - 8;
  for (let k = 1; k <= n; k++) {
    y += heights[k - 1] + 8;
    if (y + (k < n || pill ? moreH : 0) <= bottom) best = k;
  }
  return best >= n ? 0 : Math.max(1, best);
}

/**
 * Where the banner stack goes (layout px of the UI root; `top` its first row, `h` its height with full banners,
 * `compactH` with compact ones): centred unless that covers an open panel; else the free gap nearest the centre beside
 * the panels in its rows (left of a right-docked one, right of a left one) at full width, else narrowed down to
 * BANNER_MIN_W; else with compact banners (a lower stack clears a panel below it, e.g. the Budget under the banners
 * while Advisors is docked right); else beside the panels' header rows (title and tabs) at least; else (EM-2: no gap
 * of BANNER_MIN_W anywhere beside them — Advisors + Budget, or Budget + Advisors + inspector at 1280x720) compact and
 * capped at FALLBACK_ROWS banners as high as it gets without covering any panel's header rows: it may cover a panel's
 * body, never its title or tabs (the "N more emergencies" pill lists the rest). Null = the default centred place.
 */
export function dockBanners(W: number, top: number, h: number, w: number, panels: readonly DockRect[], compactH = 0, margin = 12, fb?: DockFallback): DockPlace | null {
  if (!(W >= w + 2 * margin)) return null; // narrow screens: the CSS default (full width)
  const at = (ww: number) => (W - ww) / 2;
  const inRows = (p: DockRect, hh: number, ph: number) => p.y < top + hh && p.y + ph > top;
  const hits = (l: number, ww: number, list: readonly DockRect[]) => list.some((p) => l < p.x + p.w + margin && l + ww > p.x - margin);
  // free intervals of [margin, W - margin] beside the given panels
  const gaps = (list: readonly DockRect[]): [number, number][] => {
    const iv = list.map((p) => [p.x - margin, p.x + p.w + margin] as [number, number]).sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    let x = margin;
    for (const [a, b] of iv) {
      if (a > x) out.push([x, a]);
      x = Math.max(x, b);
    }
    if (W - margin > x) out.push([x, W - margin]);
    return out;
  };
  /** the place nearest the centre clear of `list` (full width, else as wide as the widest gap down to BANNER_MIN_W) */
  const place = (list: readonly DockRect[]): DockPlace | null => {
    if (!hits(at(w), w, list)) return { left: at(w), width: w };
    const g = gaps(list);
    const widest = g.reduce((m, [a, b]) => Math.max(m, b - a), 0);
    for (const ww of [w, Math.min(w, widest)]) {
      if (ww < BANNER_MIN_W) break;
      let best: DockPlace | null = null, bd = Infinity;
      for (const [a, b] of g) {
        if (b - a < ww - 1e-6) continue;
        const l = Math.max(a, Math.min(b - ww, at(ww)));
        const d = Math.abs(l - at(ww));
        if (d < bd) { bd = d; best = { left: l, width: ww }; }
      }
      if (best) return best;
    }
    return null;
  };
  const centred = (d: DockPlace | null) => (d && Math.abs(d.left - at(w)) < 0.5 && d.width === w ? null : d);
  const full = place(panels.filter((p) => inRows(p, h, p.h)));
  if (full) return centred(full);
  if (compactH > 0 && compactH < h) {
    const c = place(panels.filter((p) => inRows(p, compactH, p.h)));
    if (c) return { ...c, compact: true };
  }
  const heads = place(panels.filter((p) => inRows(p, h, Math.min(p.h, PANEL_HEAD_H))));
  if (heads) return centred(heads);
  return belowHeads(W, top, w, panels, margin, fb ?? { H: Infinity, rowH: 72, moreH: 42, n: FALLBACK_ROWS + 1 });
}

/**
 * EM-2 fallback of dockBanners: compact banners, at most FALLBACK_ROWS (the "N more" pill below them when there are
 * more), at full width, as high as possible without covering any panel's header rows (it slides down below the title
 * and tabs of every panel whose columns it shares); the highest place wins, then more rows, then the one nearest the
 * centre. Places that would run into the bottom toolbar are skipped (as a last resort the highest single row anyway).
 */
function belowHeads(W: number, top: number, w: number, panels: readonly DockRect[], margin: number, fb: DockFallback): DockPlace {
  const at = (W - w) / 2;
  const heads = panels.map((p) => ({ x: p.x, y: p.y, w: p.w, h: Math.min(p.h, PANEL_HEAD_H) }));
  const lefts = [at, margin, W - margin - w];
  for (const p of panels) lefts.push(p.x - margin - w, p.x + p.w + margin);
  const maxRows = Math.max(1, Math.min(FALLBACK_ROWS, fb.n));
  let best: DockPlace | null = null, any: DockPlace | null = null;
  let by = Infinity, bk = 0, bd = Infinity, ay = Infinity;
  for (let k = maxRows; k >= 1; k--) {
    const hh = k * fb.rowH + (fb.n > k ? fb.moreH : 0) - 8;
    for (const l0 of lefts) {
      const l = Math.max(margin, Math.min(W - margin - w, l0));
      let y = top;
      // below every header row in the stack's columns that it would cover (each one pushes it down once)
      for (let guard = 0; guard <= heads.length; guard++) {
        const hit = heads.find((p) => l < p.x + p.w + margin && l + w > p.x - margin && p.y < y + hh && p.y + p.h + margin > y);
        if (!hit) break;
        y = hit.y + hit.h + margin;
      }
      const d = Math.abs(l - at);
      if (k === 1 && (y < ay - 0.5 || (y <= ay + 0.5 && d < Math.abs((any?.left ?? Infinity) - at)))) {
        ay = y;
        any = { left: l, width: w, compact: true, top: y, rows: 1 };
      }
      if (y + hh > (fb.bottom ?? fb.H - BOTTOM_KEEP)) continue;
      if (y < by - 0.5 || (y <= by + 0.5 && (k > bk || (k === bk && d < bd)))) {
        by = y; bk = k; bd = d;
        best = { left: l, width: w, compact: true, top: y, rows: k };
      }
    }
  }
  return best ?? any!;
}

/** A pill must clear whole panels, including their bodies. Search free strips, highest and nearest centre first. */
export function dockPill(W: number, height: number, panels: readonly DockRect[], bottom: number, measuredWidth = BANNER_W): DockPlace | null {
  const width = Math.min(BANNER_W, W - 24);
  // Unlike a banner's controls, the pill can wrap into a narrow free strip. Reserve for that extra height before
  // applying the width; ResizeObserver will supply its measured height at the next dirty docking.
  for (const w of [width, BANNER_MIN_W, 200, 160]) for (const gap of [12, 0]) {
    if (w > width) continue;
    const hh = Math.ceil(height * Math.max(1, (measuredWidth - 48) / (w - 48)));
    const tops = [STACK_TOP, Math.floor(bottom - hh), ...panels.flatMap((p) => [Math.floor(p.y - hh - gap), Math.ceil(p.y + p.h + gap)])].sort((a, b) => a - b);
    for (const top of tops) {
      if (top < STACK_TOP || top + hh > bottom || !Number.isFinite(top)) continue;
      const rows = panels.filter((p) => p.y < top + hh + gap && p.y + p.h + gap > top);
      const edges = rows.map((p) => [p.x - gap, p.x + p.w + gap]).sort((a, b) => a[0] - b[0]);
      const gaps: [number, number][] = [];
      let x = 12;
      for (const [a, b] of edges) {
        if (a > x) gaps.push([x, Math.min(W - 12, a)]);
        x = Math.max(x, b);
      }
      if (x < W - 12) gaps.push([x, W - 12]);
      let best: DockPlace | null = null, distance = Infinity;
      for (const [a0, b0] of gaps) {
        const a = Math.ceil(a0), b = Math.floor(b0);
        if (b - a < w) continue;
        const left = Math.max(a, Math.min(b - w, (W - w) / 2));
        const d = Math.abs(left - (W - w) / 2);
        if (d < distance) { best = { left, width: w, top }; distance = d; }
      }
      if (best) return best;
    }
  }
  return null;
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
/** the time left in the player's window, in words: an industrial accident's truck only has to be SENT before the plant
 *  ignites (it saves the plant even when it arrives later): "3.0 min left to send a truck" (EM-5) */
export function windowText(inc: Pick<Incident, 'kind'>, leftDays: number): string {
  return inc.kind === 'industrial' ? `${emgTime(leftDays)} left to send a truck` : `${emgTime(leftDays)} left`;
}
/**
 * How a failed incident ended, by its primary responder (EM-5): one of its units was sent but came after the loss
 * ("Help came too late"); none was ever sent although one could have made it ("No fire truck was sent in time"); none
 * could ("No fire truck could reach it in time").
 */
export function failText(inc: Pick<Incident, 'kind' | 'answered' | 'prompted'>, couldMakeIt = false): string {
  if (inc.answered > 0) return 'Help came too late';
  const u = RESPONDER_UNIT[INCIDENT_RESPONDERS[inc.kind][0]][0];
  return couldMakeIt || inc.prompted ? `No ${u} was sent in time` : `No ${u} could reach it in time`;
}
/** the unit still driving to an incident that arrives first (of `responder`, else of any kind): its station, the time
 *  left (days) and its kind */
export function nextArrival(em: EmergencyView | undefined, inc: Incident, now: number, responder?: Responder): { station: string; days: number; responder: Responder } | null {
  if (!em) return null;
  let best: EmergencyVehicle | null = null;
  for (const v of em.vehicles()) {
    if (v.incidentId === inc.id && v.state === 'outbound' && (!responder || v.responder === responder) && (!best || v.arrive < best.arrive)) best = v;
  }
  return best ? { station: em.stationName(best.stationId), days: Math.max(0, best.arrive - now), responder: best.responder } : null;
}
const cap1 = (s: string) => s[0].toUpperCase() + s.slice(1);
/** what is happening to an incident, in words (with `em`: a live countdown to the first arrival). Every vehicle is named
 *  by its own kind: an industrial accident's ambulance is no "fire truck" */
export function stateText(inc: Incident, now: number, em?: EmergencyView): string {
  const primary = INCIDENT_RESPONDERS[inc.kind][0];
  switch (inc.state) {
    case 'queued': return inc.reason === 'busy' ? 'Waiting for a unit to come back' : 'Dispatch pending';
    case 'uncovered': return inc.manualPossible ? 'Nobody is coming — dispatch a unit' : inc.canSend ? 'Nobody nearby — the nearest free unit is too far to make it in time' : 'Nobody can reach it';
    case 'dispatched': {
      // the first unit of the primary responder (the one the outcome waits for), else any
      const a = nextArrival(em, inc, now, primary) ?? nextArrival(em, inc, now);
      // the unit is at the site between two sim days (the day tick registers the arrival): no "arrives in 0.0 min"
      if (a) {
        const Unit = cap1(RESPONDER_UNIT[a.responder][0]);
        return a.days < 0.05 ? `${Unit} from ${a.station} arriving now` : `${Unit} from ${a.station} on the way — arrives in ${emgTime(a.days)}`;
      }
      return inc.etaMin !== undefined ? `${cap1(RESPONDER_UNIT[primary][0])} on the way (ETA ${minText(inc.etaMin)})` : 'Help on the way';
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
/**
 * A waiting incident's supporting units (an industrial accident's or a collapse's ambulance) and the primary unit it
 * still needs: "Ambulance from Medical Clinic #1 on the way — no fire truck yet: dispatch one" ('' when none is out).
 */
export function supportText(inc: Incident, now: number, em?: EmergencyView): string {
  if (!em || !(inc.state === 'uncovered' || inc.state === 'queued')) return '';
  const primary = INCIDENT_RESPONDERS[inc.kind][0];
  let on: EmergencyVehicle | null = null, out: EmergencyVehicle | null = null;
  for (const v of em.vehicles()) {
    if (v.incidentId !== inc.id || v.responder === primary) continue;
    if (v.state === 'onScene') on ??= v;
    else if (v.state === 'outbound' && (!out || v.arrive < out.arrive)) out = v;
  }
  const v = on ?? out;
  if (!v) return '';
  const what = `${cap1(RESPONDER_UNIT[v.responder][0])} from ${em.stationName(v.stationId)} ${v.state === 'onScene' ? 'on scene' : `on the way (${emgTime(Math.max(0, v.arrive - now))})`}`;
  const u = RESPONDER_UNIT[primary][0];
  let tail: string;
  if (inc.state === 'queued') tail = `no ${u} yet`;
  else if (inc.manualPossible) tail = `no ${u} yet: dispatch one`;
  else if (inc.canSend) tail = `no ${u} can make it in time`;
  else {
    // (EM-1: every unit busy is not "cannot reach it")
    const st = em.stationList().filter((s) => s.responder === primary && s.units > 0);
    tail = st.length && !st.some((s) => s.free > 0) ? `every ${u} is busy` : `no ${u} can reach it`;
  }
  return `${what} — ${tail}`;
}
/** the responders an incident still misses units of (need > units driving there or on scene), primary first */
export function missingResponders(em: EmergencyView, inc: Incident): Responder[] {
  const out: Responder[] = [];
  for (const r of INCIDENT_RESPONDERS[inc.kind]) {
    let n = 0;
    for (const v of em.vehicles()) if (v.incidentId === inc.id && v.responder === r && (v.state === 'outbound' || v.state === 'onScene')) n++;
    if ((inc.need[r] ?? 0) > n) out.push(r);
  }
  return out;
}
/** "Elementary School · (27, 45)" (sites without a building already carry their cell: "the highway (12, 40)") */
export function placeText(inc: Incident, sep = ' '): string {
  return /\(\d+, \d+\)$/.test(inc.place) ? inc.place : `${inc.place}${sep}(${inc.x}, ${inc.z})`;
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
  /** supporting units already sent while the primary one is still missing (supportText) */
  sub: HTMLElement;
  time: HTMLElement;
  send: HTMLButtonElement;
  /** the Send button's label and ETA: built once, their texts change in place (EM-4) */
  sendLbl: HTMLElement;
  sendEta: HTMLElement;
  choose: HTMLButtonElement;
  /** the options watch version last shown by Send (-1: read it at the next refresh) */
  optsVersion: number;
  /** outcome line once the incident is over */
  outcome?: string;
  /** a unit could make it in time at some point (the alert held the speed policy) */
  wasPossible?: boolean;
  /**
   * its heights as last measured as a full / compact banner, per stack width (layout px, rounded; dock: the stack's
   * height either way). The same banner is taller in a narrower stack — close-out c2: heights measured in the narrow
   * column beside a centre panel were read for the centred stack once the panel closed, and kept it all compact for
   * good; a width it was never measured at counts as a default-sized banner (fullAt / compAt)
   */
  hts?: Map<number, { full?: number; comp?: number }>;
  /** close-out c2: its slot at the last layout (the shown banners above it, its own full / compact and shown / folded
   *  state); once it moved, presses on it are ignored until settleUntil (real ms; markMoved) */
  slot?: string;
  settleUntil: number;
  settleGen: number;
}

/** a banner's height as a full / compact one in a stack `w` layout px wide: as measured there, else the default */
function fullAt(b: BannerEl, w: number): number {
  return b.hts?.get(Math.round(w))?.full ?? FULL_H;
}
function compAt(b: BannerEl, w: number): number {
  return b.hts?.get(Math.round(w))?.comp ?? COMP_H;
}
/** an element's box on screen (null: no layout to read) */
function boxOf(e: Element): DOMRect | null {
  return typeof e.getBoundingClientRect === 'function' ? e.getBoundingClientRect() : null;
}
/** the pointer of mouse event e lies in box r */
function inBox(e: MouseEvent, r: DOMRect | null): boolean {
  return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

export class EmergencyBanner {
  readonly el: HTMLDivElement;
  private banners = new Map<number, BannerEl>();
  private options: DispatchOptionsWatches;
  /** the "N more emergencies" pill and its text (built once: EM-4) */
  private more: HTMLDivElement;
  private moreText: HTMLElement;
  /** last docking applied to the stack (dock): its key, all banners compact, banners shown (0 = all, -1 = pill only) */
  private dockKey = '';
  private dockCompact = false;
  private dockRows = 0;
  /** close-out c4: last measured stack width; layout reads cached heights here, never the DOM (EM-3) */
  private dockWidth = BANNER_W;
  /** banners hidden by the docking's row cap that still wait for help (the pill counts them) */
  private capped = 0;
  /** alerts a dispatch can still save that have no banner (dismissed ones), at the last UI tick: the pill shows for them
   *  whatever the cap */
  private hiddenPrompts = 0;
  /** EM-3: the layout changed since the last docking (panels opened / closed / moved / resized, banners resized, the
   *  toolbar flyout opened / closed / resized, the window resized): only then does dock() measure — never without a
   *  banner */
  private dockDirty = true;
  private ro: ResizeObserver | null = null;
  private mo: MutationObserver | null = null;
  private watched = new WeakSet<Element>();
  private layerWatched = false;
  /** EM-4 / U1: real ms of a press on the stack not released yet (0 = none): no re-docking until it is released — its
   *  pointerdown may close the toolbar flyout, and a re-dock (more rows, full banners) before the pointerup moved the
   *  button away from under the pointer: the click was lost. Close-out c2: held until the release (pointerup /
   *  pointercancel / lostpointercapture, or the window's blur) however long the press — a 1.5 s cap re-docked under a
   *  long press and lost its click — and the pressed control captures the pointer, so its release still clicks it */
  private pressAt = 0;
  /** close-out c1 / c2: real ms until which a press on the pill is ignored — it just moved under the pointer (Infinity
   *  while the move is not on screen yet; markMoved, SETTLE_MS); its slot at the last layout (the shown banners) */
  private moreSettleUntil = 0;
  private moreSettleGen = 0;
  private moreSlot = '';
  /** the pill is shown (set with its display in tick) */
  private moreShown = false;
  /** the control a press was ignored on: its click is dropped too */
  private ignored: Element | null = null;
  /** close-out c2: the control the current press captured, and its box then. The capture sends the release's click to
   *  it wherever the pointer is: a release off it — off where it was pressed and off where it is now — is a cancelled
   *  press, as without the capture, and its click is dropped */
  private pressed: { ctl: Element; box: DOMRect | null } | null = null;
  /** close-out c1: the highest an open toolbar flyout's top reached since it opened (relative to the bottom block, <= 0;
   *  flyoutTop): a switch to a shorter tab keeps the bound of the tallest — the stack does not re-dock with every tab */
  private flyHigh = 0;

  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.options = new DispatchOptionsWatches(ctx.host, ctx.signal);
    this.el = h('div', { class: 'emg-banners' });
    this.moreText = h('span');
    this.more = h('div', { class: 'emg-more mp-glass', style: 'display:none' }, h('span', { class: 'emg-more-ico', html: icon('alert', 14) }), this.moreText);
    // close-out c4: a retained node after exit to region must not keep the city's element listeners alive
    this.more.addEventListener('click', () => this.ctx.panels.open('emergencies'), { signal: ctx.signal });
    this.el.appendChild(this.more);
    parent.appendChild(this.el);
    const dirty = () => { this.dockDirty = true; };
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(dirty);
      this.ro.observe(this.more);
    }
    if (typeof MutationObserver !== 'undefined') this.mo = new MutationObserver(dirty);
    const win = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
    // (a resize measures everything afresh, the open flyout's tallest tab too)
    const resized = () => { this.flyHigh = 0; this.dockDirty = true; };
    win?.addEventListener('resize', resized);
    // (a press anywhere on the stack holds the docking until it is released — the layout it measured then applies; the
    // pressed control captures the pointer, so its release clicks it whatever moved meanwhile, and a release off it
    // still cancels — close-out c2. A press on a button or the pill of a banner that has just moved under the pointer is
    // ignored, and its click: it was aimed at what sat there before — close-out c1, SETTLE_MS; c2: it flashes, and the
    // click plays the denied sound)
    this.el.addEventListener('pointerdown', (e) => {
      const now = performance.now();
      this.ignored = null;
      this.pressed = null;
      const t = (e as Event | undefined)?.target as Element | null | undefined;
      const ctl = t && typeof t.closest === 'function' ? t.closest('button, .emg-more') : null;
      if (ctl && this.unsettled(ctl, now)) {
        this.ignored = ctl;
        this.flashSettling(ctl);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      this.pressAt = now;
      this.pressed = ctl ? { ctl, box: boxOf(ctl) } : null;
      const pid = (e as Partial<PointerEvent>).pointerId;
      const cap = ctl as (Element & { setPointerCapture?: (id: number) => void }) | null;
      if (cap && pid !== undefined && typeof cap.setPointerCapture === 'function') {
        try {
          cap.setPointerCapture(pid);
        } catch {
          /* (no active pointer: a synthetic event) */
        }
      }
    }, { capture: true, signal: ctx.signal });
    this.el.addEventListener('click', (e) => {
      const pr = this.pressed;
      this.pressed = null;
      const t = e.target as Node | null;
      const ig = this.ignored;
      if (ig) {
        this.ignored = null;
        if (t && ig.contains(t)) {
          e.preventDefault();
          e.stopPropagation();
          // (within the click: the UI's generic click sound is left out — uiSounds)
          this.ctx.sound('error');
          return;
        }
      }
      // (a pointer's click — not the keyboard's — released off the captured control: a cancelled press)
      if (pr?.box && t && pr.ctl.contains(t) && e.detail > 0 && !inBox(e, pr.box) && !inBox(e, boxOf(pr.ctl))) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true, signal: ctx.signal });
    const release = () => {
      // (an ignored press's click follows its release in the same input task: forgotten after it)
      if (this.ignored) setTimeout(() => { this.ignored = null; }, 0);
      if (!this.pressAt) return;
      this.pressAt = 0;
      this.dockDirty = true;
    };
    win?.addEventListener('pointerup', release, true);
    win?.addEventListener('pointercancel', release, true);
    // (a release the window never sees: the pointer capture ends, or the window loses focus with the button held)
    win?.addEventListener('blur', release);
    this.el.addEventListener('lostpointercapture', release, { capture: true, signal: ctx.signal });
    const off = ctx.sim.events.on('emergency', (e) => this.onEvent(e));
    const offReset = ctx.sim.events.on('reset', () => this.reset());
    const offTick = ctx.ui.on('uiTick', () => this.tick());
    const offPolicy = ctx.host.policy.subscribe((policy) => this.renderPolicy(policy, true), ctx.signal);
    const offSettings = ctx.ui.on('settings', () => this.sendSettings());
    this.sendSettings();
    this.renderPolicy(ctx.host.policy);
    ctx.signal.addEventListener('abort', () => {
      off(); offReset(); offTick(); offPolicy(); offSettings();
      this.ro?.disconnect();
      this.mo?.disconnect();
      win?.removeEventListener('resize', resized);
      win?.removeEventListener('pointerup', release, true);
      win?.removeEventListener('pointercancel', release, true);
      win?.removeEventListener('blur', release);
    });
  }

  /**
   * close-out c1 / c2: these banners (and the pill) moved under the pointer — the stack re-docked, they were added,
   * switched between full and compact or folded, or a banner above them went, moved or changed its size: presses on them
   * are ignored until SETTLE_MS after the move is on screen — stamped at the start of the second frame from now (the
   * first one paints it; a later move starts over). The banners that did not move take presses at once. No layout read.
   */
  private markMoved(list: Iterable<BannerEl>, pill: boolean): void {
    const stamps: (() => void)[] = [];
    for (const b of list) {
      b.settleUntil = Infinity;
      const gen = ++b.settleGen;
      stamps.push(() => {
        if (gen === b.settleGen) b.settleUntil = performance.now() + SETTLE_MS;
      });
    }
    if (pill) {
      this.moreSettleUntil = Infinity;
      const gen = ++this.moreSettleGen;
      stamps.push(() => {
        if (gen === this.moreSettleGen) this.moreSettleUntil = performance.now() + SETTLE_MS;
      });
    }
    if (!stamps.length) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
    if (!raf) {
      for (const f of stamps) f();
      return;
    }
    raf(() => raf(() => {
      for (const f of stamps) f();
    }));
  }

  /** a press on control `ctl` lands on a banner (or the pill) that has just moved under the pointer */
  private unsettled(ctl: Element, now: number): boolean {
    if (this.more.contains(ctl)) return now < this.moreSettleUntil;
    for (const b of this.banners.values()) if (b.el.contains(ctl)) return now < b.settleUntil;
    return false;
  }

  /** close-out c2: an ignored press shows — the banner (or the pill) it landed on flashes for SETTLE_FLASH_MS */
  private flashSettling(ctl: Element): void {
    const el = this.more.contains(ctl) ? this.more : [...this.banners.values()].find((b) => b.el.contains(ctl))?.el;
    if (!el) return;
    toggleClass(el, 'settling', true);
    setTimeout(() => toggleClass(el, 'settling', false), SETTLE_FLASH_MS);
  }

  /** The LIVE badge follows the authoritative policy, even while the sim is paused. */
  get liveActive(): boolean { return this.ctx.host.policy.live; }

  private reset(): void {
    this.options.dispose();
    for (const b of this.banners.values()) b.el.remove();
    this.banners.clear();
    this.dockDirty = true;
  }

  /** Policy snapshots contain no incident objects; the emergency view supplies their display data. */
  private renderPolicy(policy: PolicySnapshot, feedback = false): void {
    const em = this.ctx.host.emergency;
    const ids = new Set(policy.alerts.map((a) => a.id));
    for (const id of this.banners.keys()) if (!ids.has(id)) this.removeBanner(id);
    for (const alert of policy.alerts) {
      if (!this.banners.has(alert.id)) {
        const inc = em?.incident(alert.id);
        if (inc) this.addBanner(inc);
      }
      const b = this.banners.get(alert.id);
      if (b) b.wasPossible = alert.wasPossible;
    }
    toggleClass(this.ctx.root, 'emg-live', policy.live);
    if (feedback && policy.warn) this.ctx.sound('warning');
    if (feedback && policy.toast) this.ctx.toast(policy.toast.text, policy.toast.kind, undefined, 'Emergency');
  }

  /** Only the three simulation settings cross the host seam. */
  private sendSettings(): void {
    const s = this.ctx.settings;
    this.ctx.host.act('setSettings', [{
      emergencyUncovered: s.emergencyUncovered ?? 'live', emergencyLiveSlowmo: s.emergencyLiveSlowmo ?? 3,
      emergencyAlerts: s.emergencyAlerts ?? 'major',
    }], { tag: this });
  }

  /** Layout and the count pill use the same current free-unit check as the policy. */
  private answerable(inc: Incident): boolean {
    return !Number.isNaN(sendDays(inc, this.ctx.host.simTime(), () => this.options.get(inc.id).value ?? []));
  }

  private onEvent(e: EmergencyEvent): void {
    const b = this.banners.get(e.id);
    if (e.type === 'resolved' || e.type === 'failed') {
      if (b) {
        b.inc = this.ctx.host.emergency.incident(e.id) ?? b.inc;
        const losses = lossText(b.inc);
        b.outcome = (e.type === 'failed' ? failText(b.inc, !!b.wasPossible) : `${INCIDENT_LABEL[e.kind]} under control`) + (losses ? ` — ${losses}` : '');
      }
      return;
    }
    // Any dispatch can take the unit another banner's Send nearest button counted on (EM-1).
    if (e.type === 'dispatched') for (const o of this.banners.values()) o.optsVersion = -1;
    else if (b && (e.type === 'uncovered' || e.type === 'queued')) b.optsVersion = -1;
  }

  private addBanner(inc: Incident): void {
    const color = INCIDENT_COLOR[inc.kind];
    const title = h('div', { class: 'emg-title' });
    const place = h('div', { class: 'emg-place' });
    const note = h('div', { class: 'emg-note' });
    const sub = h('div', { class: 'emg-sub', style: 'display:none' });
    const time = h('div', { class: 'emg-time' });
    const jump = h('button', { class: 'btn sm', title: 'Show on the map', html: icon('target', 13) + '<span>Jump</span>' });
    // (label and ETA spans built once: a press and a release on them span the once-a-day ETA update — EM-4)
    const sendLbl = h('span', null, 'Send nearest');
    const sendEta = h('span', { class: 'emg-eta' });
    const send = h('button', { class: 'btn sm primary', title: 'Dispatch the fastest free unit' }, sendLbl, sendEta) as HTMLButtonElement;
    const choose = h('button', { class: 'btn sm emg-choose', title: 'Pick the station yourself (Dispatch tool)', html: '<span>Choose station…</span>' }) as HTMLButtonElement;
    const close = h('button', { class: 'icon-btn emg-x', title: 'Dismiss', html: icon('close', 14) });
    const el = h('div', { class: 'emg-banner mp-glass', style: { '--kc': color } as Record<string, string> },
      h('div', { class: 'emg-ico', html: kindIcon(inc.kind, 22) }),
      h('div', { class: 'emg-body' }, h('div', { class: 'emg-head' }, title, time), place, note, sub, h('div', { class: 'emg-btns' }, jump, send, choose)),
      close,
    );
    jump.addEventListener('click', () => this.jump(inc.id), { signal: this.ctx.signal });
    send.addEventListener('click', () => this.sendNearest(inc.id), { signal: this.ctx.signal });
    choose.addEventListener('click', () => openDispatch(this.ctx, inc.id), { signal: this.ctx.signal });
    close.addEventListener('click', () => this.ctx.host.act('dismissAlert', [inc.id], { tag: this }), { signal: this.ctx.signal });
    this.el.insertBefore(el, this.more);
    const b: BannerEl = { id: inc.id, inc, el, title, place, note, sub, time, send, sendLbl, sendEta, choose, optsVersion: -1, settleUntil: 0, settleGen: 0 };
    this.banners.set(inc.id, b);
    this.ro?.observe(el);
    this.dockDirty = true;
    this.refresh(b, inc);
    this.layout();
  }

  private jump(id: number): void {
    const inc = this.ctx.host.emergency.incident(id);
    if (!inc) return;
    this.ctx.focusCell(inc.x, inc.z, 420);
    // the camera whoosh is the sound (silent inspector)
    this.ctx.showQuery({ buildingId: inc.buildingId >= 0 ? inc.buildingId : null, x: inc.x, z: inc.z }, { silent: true });
  }

  private async sendNearest(id: number): Promise<void> {
    const em = this.ctx.host.emergency;
    let r;
    try {
      r = await this.ctx.host.act('dispatchBest', [id]).done;
    } catch (e) {
      console.warn('[dispatch] failed', e);
      r = { ok: false, reason: 'No unit available' };
    }
    if (this.ctx.signal.aborted) return;
    if (r.ok) {
      this.ctx.sound('confirm');
      // named by its own kind; a unit that could not go is said too ("Ambulance dispatched … · no free fire truck can
      // reach it": the fire truck is still up to the player)
      const unit = r.responder ? cap1(RESPONDER_UNIT[r.responder][(r.sent ?? 1) === 1 ? 0 : 1]) : 'Unit';
      const miss = r.missing?.length ? ` · no free ${r.missing.map((q) => RESPONDER_UNIT[q][0]).join(' or ')} can reach it` : '';
      this.ctx.toast(`${unit} dispatched — ETA ${minText(r.etaMin ?? NaN)}${miss}`, miss ? 'warning' : 'good');
    } else {
      this.ctx.sound('error');
      this.ctx.toast(r.reason ?? 'No unit available', 'warning');
    }
    // EM-1: the button and note show the new situation at once; the policy owner already re-evaluated the dispatch.
    const b = this.banners.get(id);
    const inc = em.incident(id);
    if (b && inc) {
      b.optsVersion = -1;
      this.refresh(b, inc);
    }
  }

  private removeBanner(id: number): void {
    const b = this.banners.get(id);
    if (!b) return;
    this.banners.delete(id);
    this.ro?.unobserve(b.el);
    this.dockDirty = true;
    b.el.classList.add('out');
    setTimeout(() => {
      // (gone: the banners below it and the pill move up — close-out c1 / c2, markMoved; a folded one moves nothing. Its
      // style order is the one it had: the banners below it have taken orders from it on since)
      const shownB = b.el.parentElement === this.el && !b.el.classList.contains('capped');
      const at = Number(b.el.style.order);
      b.el.remove();
      if (shownB) this.markMoved([...this.banners.values()].filter((o) => !(Number(o.el.style.order) < at)), true);
    }, 250);
  }

  private refresh(b: BannerEl, inc: Incident): void {
    const now = this.ctx.host.simTime();
    setText(b.title, INCIDENT_LABEL[inc.kind] + (inc.kind === 'fire' && inc.fires.length > 1 ? ` · ${inc.fires.length} buildings` : inc.kind === 'riot' ? ` · radius ${Math.round(inc.radius)}` : ''));
    setText(b.place, placeText(inc, ' · '));
    const waiting = inc.state === 'uncovered' || inc.state === 'queued';
    const em = this.ctx.host.emergency;
    b.inc = inc;
    setText(b.note, waiting ? inc.note || stateText(inc, now, em) : stateText(inc, now, em));
    const sub = supportText(inc, now, em);
    setText(b.sub, sub);
    const sd = sub ? '' : 'none';
    if (b.sub.style.display !== sd) b.sub.style.display = sd;
    // the countdown is the player's window (an industrial accident: until its plant ignites). It stops once the window
    // has passed or a building is already lost — the loss shows instead, never "0.7 min left" next to "1 building lost"
    const left = dispatchWindowEnd(inc) - now;
    const counting = waiting && left > 0 && inc.lost === 0;
    const loss = lossText(inc);
    setText(b.time, `${emgTime(now - inc.start)} ago${counting ? ` · ${windowText(inc, left)}` : loss ? ` · ${loss}` : ''}`);
    toggleClass(b.el, 'urgent', counting && left < 2 * EMERG_DAYS_PER_MIN);
    toggleClass(b.el, 'handled', !waiting);
    // "Send nearest (ETA)" from the (3-day cached) dispatch options, for the units the incident still misses (an
    // industrial accident whose ambulance is out: the fire truck — what dispatchBest sends). The daily watch also
    // refreshes changed fleets while paused, capped at 5 Hz. The texts change in place (EM-4).
    const watch = waiting ? this.options.get(inc.id) : null;
    const options = watch?.value;
    if (watch && b.optsVersion !== watch.version) {
      b.optsVersion = watch.version;
      const miss = missingResponders(em, inc);
      const best = options?.find((o) => o.free > 0 && Number.isFinite(o.etaMin) && miss.includes(o.responder));
      if (b.send.disabled !== !best) b.send.disabled = !best;
      // warn when the fastest free unit cannot arrive before the deadline (same unit: emergency minutes) — never for an
      // industrial accident: a truck SENT before the ignition saves the plant, whenever it arrives (EM-5)
      const arriveLeft = inc.deadline - now;
      const late = !!best && inc.kind !== 'industrial' && best.etaDays > arriveLeft;
      setText(b.sendLbl, best ? 'Send nearest' : options ? 'No free unit' : 'Loading…');
      setText(b.sendEta, best ? `${minText(best.etaMin)}${late ? ' · too far?' : ''}` : '');
      const ed = best ? '' : 'none';
      if (b.sendEta.style.display !== ed) b.sendEta.style.display = ed;
      const title = best ? `${best.name}: arrives in ${minText(best.etaMin)}${late ? ` — only ${emgTime(Math.max(0, arriveLeft))} left: probably too late, build a station closer` : ''}` : options ? 'Every station of this type is busy or cannot reach it' : 'Loading dispatch options…';
      if (b.send.title !== title) b.send.title = title;
    }
    const vd = waiting ? '' : 'none';
    if (b.send.style.display !== vd) b.send.style.display = vd;
  }

  /** the incident is over: the banner lingers briefly with the outcome — no countdown, no urgency, no dispatch buttons */
  private ended(b: BannerEl, now: number): void {
    toggleClass(b.el, 'handled', true);
    toggleClass(b.el, 'urgent', false);
    setText(b.note, b.outcome ?? 'Over');
    b.sub.style.display = 'none';
    setText(b.time, `${emgTime(now - b.inc.start)} ago`);
    b.send.style.display = 'none';
    b.choose.style.display = 'none';
  }

  /**
   * The banners in display order: the alerts a dispatch can still save first (answerable, as for the speed policy —
   * EM-1), then the other waiting or followed incidents, the ones already over (their outcome lingers), and last those
   * no free unit can be sent to ("No free unit": nothing to do there) — the first ones a capped stack folds into the
   * "N more" pill (final fixes r3); oldest first within each
   */
  private ordered(): BannerEl[] {
    const em = this.ctx.host.emergency;
    const prio = new Map<number, number>();
    for (const b of this.banners.values()) {
      const inc = em?.incident(b.id);
      const waiting = !!inc && (inc.state === 'uncovered' || inc.state === 'queued');
      prio.set(b.id, !inc ? 2 : this.answerable(inc) ? 0 : waiting && b.send.disabled ? 3 : 1);
    }
    return [...this.banners.values()].sort((a, b) => prio.get(a.id)! - prio.get(b.id)! || a.inc.start - b.inc.start || a.id - b.id);
  }

  /** at most MAX_BANNERS full banners (all compact while the stack must stay low, see dock; only the first dockRows
   *  shown while the stack would run into a panel's header rows or the toolbar — the pill lists the rest), in display
   *  order (ordered), the rest compact (title, time and buttons); CSS order, so no banner is moved in the DOM (no
   *  restarted animations) */
  private layout(): void {
    const em = this.ctx.host.emergency;
    const list = this.ordered();
    let capped = 0;
    // (a banner's slot: the shown banners above it, full or compact, and its own state — a banner re-ordered, added,
    // shown / folded or switched between full and compact moves itself and the ones below it, never those above:
    // close-out c2, only the banners that moved ignore presses; c4: their measured heights too — a note wrapping
    // moves the banners below it even without a full / compact switch, using dock's cache, never a layout read)
    const moved: BannerEl[] = [];
    let above = '';
    list.forEach((b, k) => {
      const comp = this.dockCompact || k >= MAX_BANNERS;
      const cap = this.dockRows < 0 || (this.dockRows > 0 && k >= this.dockRows);
      const o = String(k);
      toggleClass(b.el, 'compact', comp);
      toggleClass(b.el, 'capped', cap);
      if (cap) {
        const inc = em?.incident(b.id);
        if (inc && (inc.state === 'uncovered' || inc.state === 'queued')) capped++;
      }
      if (b.el.style.order !== o) b.el.style.order = o;
      const slot = `${above}|${comp ? 'c' : 'f'}${cap ? 'x' : ''}`;
      if (slot !== b.slot) {
        b.slot = slot;
        if (!cap) moved.push(b);
      }
      if (!cap) above += `${b.id}${comp ? 'c' : 'f'}:${comp ? compAt(b, this.dockWidth) : fullAt(b, this.dockWidth)},`;
    });
    this.capped = capped;
    const pill = above !== this.moreSlot;
    this.moreSlot = above;
    if (moved.length || pill) this.markMoved(moved, pill);
  }

  /** observe a panel (its size, position and closing class) for the docking (EM-3) */
  private watch(p: Element): void {
    if (this.watched.has(p)) return;
    this.watched.add(p);
    this.ro?.observe(p);
    this.mo?.observe(p, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  /**
   * Keep the banner stack off open panels (their titles and tabs: a right-docked Advisors panel read "…isors & news"
   * with its tab hidden): beside them as near the centre as fits, else with compact banners, else beside their header
   * rows, else below the header rows, compact and capped (dockBanners); centred as before when nothing is in the way.
   * Final fixes r3: wherever it goes, the stack ends TOOLBAR_GAP above the bottom toolbar block (an M7 quake's ten
   * banners covered the toolbar buttons at 1280x720): as many banners as fit (fitRows; all compact when not even the
   * full ones do), the rest — "No free unit" ones first (ordered) — in the "N more emergencies" pill.
   * Heights are the ones measured before this tick's changes (full and compact), so the choice does not flip-flop with
   * the banners' own size. EM-3: no banner, no layout read at all (the TopBar and the panels wrote the DOM just
   * before: one read forced a style and layout pass every UI tick); with banners it measures only after the layout
   * changed (ResizeObserver: banners, panels, the pill, the toolbar block and its flyout; MutationObserver: panels
   * opened / closed / moved, the flyout opened / closed; a window resize). Final fixes r4 U1: an open toolbar flyout is
   * the bottom bound (stackBottom), and nothing re-docks while a banner is pressed (pressAt): a press whose pointerdown
   * closes the flyout still clicks (EM-4). Close-out c1: a press that lands just after the stack moved is ignored, not
   * sent to the banner that moved under the pointer (markMoved, SETTLE_MS), and the tallest tab seen since the flyout
   * opened bounds the stack (flyoutTop: no re-dock with every tab).
   */
  private dock(): void {
    // close-out c2: with every banner dismissed the "N more emergencies" pill alone docks like the stack (it sat at the
    // centred default over a centred panel's title row)
    const pillOnly = !this.banners.size && this.moreShown;
    if (!this.banners.size && !pillOnly) {
      if (this.dockKey || this.dockCompact || this.dockRows) this.applyDock(null, false, 0);
      this.dockDirty = true; // (the next banner measures afresh)
      return;
    }
    const tracked = !!(this.ro && this.mo);
    if (tracked && !this.dockDirty) return;
    // (held while pressed — dockDirty stays: the release docks; close-out c2: however long the press)
    if (this.pressAt) return;
    this.dockDirty = false;
    const root = this.ctx.root;
    if (tracked && !this.layerWatched) {
      const layer = root.querySelector?.('.panel-layer');
      if (layer) {
        this.layerWatched = true;
        this.mo!.observe(layer, { childList: true });
      }
    }
    const W = root.clientWidth, H = root.clientHeight;
    const panels: DockRect[] = [], centres: DockRect[] = [];
    if (W > 0) {
      for (const p of root.querySelectorAll<HTMLElement>('.panel-layer > .panel')) {
        if (tracked) this.watch(p);
        if (p.classList.contains('closing') || !p.offsetWidth) continue;
        const rect = { x: p.offsetLeft, y: p.offsetTop, w: p.offsetWidth, h: p.offsetHeight };
        panels.push(rect);
        if (p.classList.contains('center')) centres.push(rect);
      }
    }
    const mh = this.more.offsetHeight;
    const moreH = (mh > 0 ? mh : 34) + 8;
    const fbH = H > 0 ? H : Infinity;
    const bottom = this.stackBottom(root, H);
    this.more.style.visibility = '';
    // NOTE-023: the pill-only and folded-stack paths share full-panel clearance. If the tool chip leaves too little
    // room, use a free strip beside it, still clear of the toolbar and flyout. These reads stay inside dirty docking.
    const placePill = (): DockPlace | null => {
      const measuredWidth = this.el.offsetWidth || BANNER_W;
      let d = dockPill(W, moreH - 8, panels, bottom, measuredWidth);
      if (!d && H > 0 && typeof root.getBoundingClientRect === 'function') {
        const rr = root.getBoundingClientRect(), scale = rr.width / W;
        const obstacles = [...panels];
        for (const el of root.querySelectorAll<HTMLElement>('.hud-bottom .toolbar, .hud-bottom .tool-chip, .hud-bottom .flyout.open')) {
          if (tracked) this.watch(el);
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && scale > 0) obstacles.push({ x: (r.left - rr.left) / scale, y: (r.top - rr.top) / scale, w: r.width / scale, h: r.height / scale });
        }
        if (obstacles.length > panels.length) d = dockPill(W, moreH - 8, obstacles, H - 12, measuredWidth);
      }
      // User-dragged panels can fill every free strip; never make their content unclickable in that case.
      this.more.style.visibility = d ? '' : 'hidden';
      return d && d.top === STACK_TOP && d.width === BANNER_W && d.left === (W - BANNER_W) / 2 ? null : d;
    };
    // (one row: beside the panels, else below their header rows — never over a title or tab)
    const singlePlace = (height: number): DockPlace | null => {
      const d = panels.length ? dockBanners(W, STACK_TOP, height, BANNER_W, panels, 0, 12, { H: fbH, rowH: height + 8, moreH: 0, n: 1, bottom }) : null;
      return d && { left: d.left, width: d.width, top: d.top };
    };
    if (pillOnly) {
      this.applyDock(placePill(), false, 0);
      return;
    }
    // the banners' heights as full / compact ones — per stack width (close-out c2): measured at the width the stack has
    // now (a capped banner keeps the ones it was last seen with), read for the width a place gives it
    const sw = Math.round(this.el.offsetWidth) || BANNER_W;
    this.dockWidth = sw;
    for (const b of this.banners.values()) {
      const hh = b.el.offsetHeight;
      if (!(hh > 0)) continue;
      const m = (b.hts ??= new Map());
      let e = m.get(sw);
      if (!e) {
        m.set(sw, (e = {}));
        if (m.size > 4) m.delete(m.keys().next().value!);
      }
      if (b.el.classList.contains('compact')) e.comp = hh;
      else e.full = hh;
    }
    const n = this.banners.size;
    const more = this.more.style.display === 'none' ? 0 : moreH;
    /** the place for the stack with its banners' heights at width w (null: the centred default) */
    const placeAt = (w: number): DockPlace | null => {
      if (!panels.length) return null;
      let full = 0, comp = 0, compRow = 0;
      for (const b of this.banners.values()) {
        full += fullAt(b, w) + 8;
        const c = compAt(b, w) + 8;
        comp += c;
        compRow = Math.max(compRow, c);
      }
      return dockBanners(W, STACK_TOP, full + more - 8, BANNER_W, panels, comp + more - 8, 12, { H: fbH, rowH: compRow, moreH, n, bottom });
    };
    // (the default width; narrow screens: the CSS default, the stack's own)
    const defW = W >= BANNER_W + 24 ? BANNER_W : sw;
    let d = placeAt(defW);
    // a narrower place: decided again with the (taller) heights at that width
    if (d && Math.round(d.width) !== defW) d = placeAt(d.width) ?? d;
    const tw = d ? d.width : defW;
    // close-out c4: at 1024x600 even one compact row (and the pill) has no room beside / above Budget; the old
    // below-headers fallback covered its tiles and sliders. Fold every banner, keeping the pill clear of titles.
    if (centres.length) {
      const hh = compAt(this.ordered()[0], tw) + (n > 1 || this.hiddenPrompts > 0 ? moreH : 0);
      const one = singlePlace(hh);
      const left = one?.left ?? (W - defW) / 2, width = one?.width ?? defW, top = one?.top ?? STACK_TOP;
      if (centres.some((p) => left < p.x + p.w && left + width > p.x && top < p.y + p.h && top + hh > p.y)) {
        this.applyDock(placePill(), true, -1);
        return;
      }
    }
    // final fixes r3: no place but the EM-2 fallback (it caps its rows itself) knew the toolbar — the rows that fit above
    // it, in display order (the first MAX_BANNERS full); all compact when that shows more than the full ones that fit
    let compact = !!d?.compact, rows = d?.rows ?? 0;
    if (!rows && Number.isFinite(bottom)) {
      const list = this.ordered();
      const heights = (allCompact: boolean) => list.map((b, k) => (allCompact || k >= MAX_BANNERS ? compAt(b, tw) : fullAt(b, tw)));
      const top = d?.top ?? STACK_TOP, pill = this.hiddenPrompts > 0;
      rows = fitRows(top, bottom, heights(compact), moreH, pill);
      if (rows > 0 && !compact && rows < Math.min(list.length, MAX_BANNERS)) {
        const rc = fitRows(top, bottom, heights(true), moreH, pill);
        if (rc === 0 || rc > rows) {
          compact = true;
          rows = rc;
        }
      }
    }
    const list = this.ordered(), shown = rows > 0 ? Math.min(rows, list.length) : list.length;
    if (this.hiddenPrompts > 0 || shown < list.length) {
      const left = d?.left ?? (W - defW) / 2;
      const top = (d?.top ?? STACK_TOP) + list.slice(0, shown).reduce((h, b, k) => h + (compact || k >= MAX_BANNERS ? compAt(b, tw) : fullAt(b, tw)) + 8, 0);
      if (panels.some((p) => left < p.x + p.w && left + tw > p.x && top < p.y + p.h && top + moreH - 8 > p.y)) {
        this.applyDock(placePill(), true, -1);
        return;
      }
    }
    this.applyDock(d, compact, rows);
  }

  /** the lowest the stack may reach (layout px of the UI root): TOOLBAR_GAP above the bottom toolbar block (.hud-bottom:
   *  the toolbar and the tool chip above it, watched for size changes) or above its open flyout, whichever is higher,
   *  else BOTTOM_KEEP above the layer's bottom; Infinity when neither is known */
  private stackBottom(root: HTMLElement, H: number): number {
    const hud = root.querySelector?.('.hud-bottom') as HTMLElement | null | undefined;
    if (hud && hud.offsetHeight > 0) {
      if (this.ro && !this.watched.has(hud)) {
        this.watched.add(hud);
        this.ro.observe(hud);
      }
      let y = 0, e: HTMLElement | null = hud;
      for (; e && e !== root; e = e.offsetParent as HTMLElement | null) y += e.offsetTop;
      if (e === root) return y + Math.min(0, this.flyoutTop(hud)) - TOOLBAR_GAP;
    }
    return H > 0 ? H - BOTTOM_KEEP : Infinity;
  }

  /**
   * Final fixes r4 U1: the top of the bottom block's open flyout, relative to the block (layout px, < 0: it rises above
   * the block — absolutely positioned in the toolbar, it is no part of the block's box; 0 when none is open). The
   * banners covered its tabs and cards (a click on Civic > Fire pressed a banner's Send nearest): the stack ends above it
   * while it is open. Watched for opening / closing (class) and its size (a tab switch changes its height).
   * Close-out c1: the highest it reached since it opened (flyHigh) — a switch to a shorter tab, or back, keeps the
   * stack where it is instead of re-docking it with every tab; closed (or a window resize), it is forgotten.
   */
  private flyoutTop(hud: HTMLElement): number {
    const fly = hud.querySelector?.('.flyout') as HTMLElement | null | undefined;
    if (!fly) return (this.flyHigh = 0);
    if (!this.watched.has(fly)) {
      this.watched.add(fly);
      this.ro?.observe(fly);
      this.mo?.observe(fly, { attributes: true, attributeFilter: ['class'] });
    }
    if (!fly.classList.contains('open') || !(fly.offsetHeight > 0)) return (this.flyHigh = 0);
    let y = 0, e: HTMLElement | null = fly;
    for (; e && e !== hud; e = e.offsetParent as HTMLElement | null) y += e.offsetTop;
    if (e !== hud) return 0;
    this.flyHigh = Math.min(this.flyHigh, y);
    return this.flyHigh;
  }

  /** apply a docking: the stack's place (null: the centred CSS default), all banners compact, shown (0 = all, -1 = pill) */
  private applyDock(d: DockPlace | null, compact: boolean, rows: number): void {
    if (compact !== this.dockCompact || rows !== this.dockRows) {
      this.dockCompact = compact;
      this.dockRows = rows;
      this.layout();
    }
    const key = d ? `${Math.round(d.left)}:${Math.round(d.width)}:${d.top === undefined ? '' : Math.round(d.top)}` : '';
    if (key === this.dockKey) return;
    this.dockKey = key;
    // (the stack itself moved or changed width: every banner and the pill — close-out c1)
    this.markMoved(this.banners.values(), true);
    const s = this.el.style;
    if (!d) {
      s.left = s.transform = s.width = s.top = '';
      return;
    }
    s.left = `${Math.round(d.left)}px`;
    s.transform = 'none';
    s.width = `${Math.round(d.width)}px`;
    s.top = d.top === undefined ? '' : `${Math.round(d.top)}px`;
  }

  private tick(): void {
    const em = this.ctx.host.emergency;
    const now = this.ctx.host.simTime();
    this.renderPolicy(this.ctx.host.policy);
    for (const b of this.banners.values()) {
      const inc = em?.incident(b.id);
      if (inc) this.refresh(b, inc);
      else this.ended(b, now);
    }
    this.dock();
    this.layout();
    // the "N more" pill: alerts a dispatch can still save without a banner (dismissed ones), and the banners the docking
    // keeps out of sight below a panel's header rows (EM-2); its text changes in place (EM-4)
    let hidden = 0;
    if (em) {
      for (const inc of em.incidents()) {
        if (inc.state === 'uncovered' && inc.major && !this.banners.has(inc.id) && this.answerable(inc)) hidden++;
      }
    }
    // (the docking keeps room for the pill while these exist: final fixes r3)
    if (hidden !== this.hiddenPrompts) {
      this.hiddenPrompts = hidden;
      this.dockDirty = true;
    }
    const showMore = () => {
      let needYou = hidden;
      if (this.capped) for (const b of this.banners.values()) if (b.el.classList.contains('capped')) { const inc = em.incident(b.id); if (inc && this.answerable(inc)) needYou++; }
      const total = hidden + this.capped;
      const md = total ? '' : 'none';
      if (this.more.style.display !== md) {
        this.more.style.display = md;
        this.dockDirty = true;
      }
      this.moreShown = total > 0;
      // (close-out c2 polish: no "open Emergencies" while that panel is open)
      const listed = !!this.ctx.panels.isOpen?.('emergencies');
      if (total) setText(this.moreText, `${total} more emergenc${total === 1 ? 'y' : 'ies'}${needYou === total ? (total === 1 ? ' needs you' : ' need you') : ''} — ${listed ? 'see the Emergencies panel' : 'open Emergencies'}`);
    };
    showMore();
    // A newly shown pill gets its safe place in this tick, before it can paint over the panel for one UI interval.
    if (this.moreShown && this.dockDirty) { this.dock(); showMore(); }
    this.options.retain(new Set(em.incidents().filter((i) => (i.state === 'uncovered' || i.state === 'queued') && (this.banners.has(i.id) || i.major)).map((i) => i.id)));
  }

  /** tests / dev: current banners (incident ids) */
  get bannerIds(): number[] {
    return [...this.banners.keys()];
  }

  dispose(): void {
    this.options.dispose();
    this.ro?.disconnect();
    this.mo?.disconnect();
    clear(this.el);
    this.el.remove();
  }
}
