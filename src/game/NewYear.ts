/**
 * NewYearCelebration — rings in every new game year (the Simulation's 'year' event, Jan 1st):
 *   - toast "🎆 Happy New Year {year}!" with a line of city stats (population, growth vs last year)
 *   - settings.newYear = 'cinematic': a smooth ~3 s time-lapse to 23:55 (if it isn't night already), a 3-2-1
 *     countdown with the clock ticking to midnight, the opening salvo at 00:00 and a fireworks show sized by the
 *     population (objects.fireworks). With settings.newYearCamera (default on) the camera eases to a skyline view of
 *     the show during the countdown — any camera input (or click on the city) hands control back at once — and
 *     returns to the player's view afterwards. When the show is over the clock time-lapses forward to where the day
 *     would have been without the party (auto time) or to the fixed hour.
 *   - 'fireworks': countdown + show at whatever time it is (the clock and the camera are left alone);  'off': nothing
 * Fast game years (sim speed 2-3) get shows that end well before the next New Year; a year too short for the night
 * switch runs in 'fireworks' mode, and very short years skip the countdown. A New Year that arrives while a show is
 * still running only gets its toast: a show is never cut short.
 * Everything runs in real time (independent of the sim speed; keeps going while paused).
 * Batch-simulated years (headless runDays, loading) are skipped: only years reached while the game loop runs party.
 *
 *   const ny = new NewYearCelebration({ sim, world: () => w, objects: () => o, settings: () => s, toast, audio });
 *   loop (before world.update): ny.frame(dt)        dev: ny.celebrate({ instant: true })
 */
import type { Simulation } from '../sim/Simulation';
import type { CityObjectsViewApi, WorldViewApi } from '../render/contracts';
import { DAYS_PER_MONTH, MONTHS_PER_YEAR } from '../core/constants';
import type { Fireworks, FireworksSoundKind } from '../render/city/effects/Fireworks';
import type { FireworksAudio, FireworksAudioOut, FireworksListener, FireworksSpatial } from '../audio/fireworks';
import type { GameSettings, NewYearMode } from './settings';

export interface NewYearDeps {
  sim: Simulation;
  world: () => WorldViewApi;
  objects: () => CityObjectsViewApi;
  settings: () => GameSettings;
  toast: (text: string, kind?: string, cell?: { x: number; z: number }, title?: string) => void;
  /** UI sound by name (optional) */
  sound?: (name: string) => void;
  /** the audio engine (fireworks audio uses its getSfxOutput()) */
  audio?: () => unknown;
  /** element for the countdown overlay (the HUD root) */
  overlayRoot?: HTMLElement;
}

export interface CelebrateOptions {
  /** year to announce (default: the current game year) */
  year?: number;
  /** override settings.newYear */
  mode?: NewYearMode;
  /** no time-lapse: jump to 23:59 and fire right away (dev / screenshots) */
  instant?: boolean;
  /** override the population that sizes the show */
  population?: number;
  /** show length override (s) */
  duration?: number;
  seed?: number;
  /** jump the show forward by this many seconds (deterministic; screenshots) */
  fastForward?: number;
  /** freeze the show (and the clock) after fastForward */
  freeze?: boolean;
  /** skip the toast */
  quiet?: boolean;
  /** show camera on / off (default: settings.newYearCamera in cinematic mode; off for instant / fast-forwarded dev shows) */
  camera?: boolean;
}

type Phase = 'idle' | 'lapse' | 'countdown' | 'show' | 'restore';
type TimeWorld = WorldViewApi & { timeScale?: number };
/** the parts of the fireworks the celebration uses (duck-typed: tests pass a stand-in) */
type FireworksLike = Pick<Fireworks, 'start' | 'stop' | 'fastForward' | 'active' | 'midnight' | 'timeScale' | 'onSound'> &
  Partial<Pick<Fireworks, 'settled' | 'isRunning' | 'centre' | 'showSize' | 'lengthFor'>>;
/** WorldView's camera controller (CameraController): only what the show camera needs */
interface CamCtl {
  enabled: boolean;
  readonly target: { x: number; z: number };
  readonly distance: number;
  readonly yawAngle: number;
  readonly tiltAngle: number;
  /** base tilt before the far-zoom top-down blend (radians) */
  readonly baseTilt?: number;
  setView(x: number, z: number, distance: number, tiltDeg?: number, yawDeg?: number): void;
}
/** camera view: target x/z (m), distance (m), tilt / yaw (degrees) */
interface View {
  x: number;
  z: number;
  d: number;
  tilt: number;
  yaw: number;
}

/** 23:55 */
const EVE = 23 + 55 / 60;
/** seconds of countdown from 23:55 to midnight */
const COUNTDOWN = 3.6;
/** game minutes per real second while the show runs (keeps it night) */
const SHOW_RATE = 0.6;
/** time-lapse back to the day after the show (s) */
const RESTORE = 2.4;
/** show camera: ease in (during the countdown) / out (after the show), s */
const CAM_IN = 2.5, CAM_OUT = 2.6;
/** the show camera's tilt (deg; the controller's minimum at skyline distances) */
const CAM_TILT = 25;
const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
/** keys the camera controller acts on: pressing one hands the camera back to the player */
const CAMERA_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown', 'home', '+', '=', '-', '_']);
const DEG = 180 / Math.PI;

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
/** default show length when the fireworks don't say (same curve as Fireworks.lengthFor) */
function defaultShowLength(pop: number): number {
  return 20 + 70 * Math.pow(clamp01((Math.log10(Math.max(pop, 30)) - 1.7) / 4.0), 1.4);
}
function smooth(t: number): number {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
}

export class NewYearCelebration {
  private deps: NewYearDeps;
  private phase: Phase = 'idle';
  private t = 0;
  private year = 0;
  private timeControlled = false;
  private lapseFrom = 0;
  private lapseTo = 0;
  private lapseDur = 0;
  private midnightAt = 3;
  private savedScale = 2;
  /** the clock when the celebration began (auto time continues from here + the real time it took) */
  private startHour = 12;
  private restoreFrom = 0;
  private restoreTo = 0;
  private restoreT = 0;
  private fw: FireworksLike | null = null;
  private audio: FireworksAudio | null = null;
  private audioLoading = false;
  private disposed = false;
  private spatialize: ((l: FireworksListener, x: number, y: number, z: number, o?: FireworksSpatial) => FireworksSpatial) | null = null;
  private listener: FireworksListener = { x: 0, y: 0, z: 0, rx: 1, ry: 0, rz: 0 };
  private sp: FireworksSpatial = { pan: 0, gain: 1, delay: 0, lowpass: 16000, distance: 0 };
  private frames = 0;
  private lastFrameDay = 0;
  private lastYearPop: number | null = null;
  private overlay: HTMLDivElement | null = null;
  private shownCount = 0;
  private bannerShown = false;
  private countdownOn = true;
  private off: (() => void) | null;
  // ---- show camera
  private camPhase: 'off' | 'wait' | 'in' | 'hold' | 'out' = 'off';
  private camT = 0;
  private camDur = CAM_IN;
  private camSnap = false;
  private camUser = false;
  private camMoved = false;
  private camSaved: View = { x: 0, z: 0, d: 900, tilt: 50, yaw: 45 };
  private camFrom: View = { x: 0, z: 0, d: 900, tilt: 50, yaw: 45 };
  private camTo: View = { x: 0, z: 0, d: 900, tilt: 50, yaw: 45 };
  private camCur: View = { x: 0, z: 0, d: 900, tilt: 50, yaw: 45 };
  private camOffs: (() => void)[] = [];
  /** a pointer button is held on the canvas (a tool drag): never start moving the camera then */
  private pointerHeld = false;
  private pointerOffs: (() => void)[] = [];

  constructor(deps: NewYearDeps) {
    this.deps = deps;
    this.off = deps.sim.events.on('year', (y) => this.onYear(y));
  }

  /** true while the celebration is driving the time of day (CityScene leaves the clock alone meanwhile) */
  get ownsTime(): boolean {
    return this.timeControlled && this.phase !== 'idle';
  }
  get active(): boolean {
    return this.phase !== 'idle';
  }
  /** a celebration or its show is still in progress (a New Year arriving now only gets its toast) */
  get busy(): boolean {
    return this.phase !== 'idle' || !!this.fw?.isRunning;
  }
  /** the show camera is driving (or about to drive) the camera */
  get cameraActive(): boolean {
    return this.camPhase !== 'off';
  }

  // ------------------------------------------------------------------------------------------------ trigger
  private onYear(year: number): void {
    const st = this.deps.sim.state;
    const popNow = st.stats.population;
    // a brand-new city (day 0) or years simulated in a batch (headless runDays / loading) don't get a party
    const batch = this.frames === 0 || st.day - this.lastFrameDay > 8;
    if (st.day > 0 && !batch && (popNow > 0 || st.buildings.size > 0)) {
      // a show that is still running is never cut short: this year only gets its toast
      if (this.busy) this.toastYear(year, true);
      else this.celebrate({ year });
    }
    this.lastYearPop = popNow;
  }

  private toastYear(year: number, checkMode = false): void {
    const s = this.deps.settings();
    if ((checkMode && s.newYear === 'off') || s.toasts === false) return;
    try {
      this.deps.toast(this.statsLine(year), 'reward', undefined, `🎆 Happy New Year ${year}!`);
      this.deps.sound?.('reward');
    } catch {
      /* ignore */
    }
  }

  /** real seconds per game year at the current sim speed (Infinity while paused / unknown) */
  private yearSeconds(): number {
    try {
      const sim = this.deps.sim as { secondsPerDay?: () => number };
      const s = typeof sim.secondsPerDay === 'function' ? sim.secondsPerDay() : NaN;
      return s > 0 && Number.isFinite(s) ? s * DAYS_PER_YEAR : Infinity;
    } catch {
      return Infinity;
    }
  }

  /** start the celebration now (also the dev hook behind scene.celebrateNewYear(); restarts a running one) */
  celebrate(opts: CelebrateOptions = {}): boolean {
    const s = this.deps.settings();
    let mode: NewYearMode = opts.mode ?? s.newYear ?? 'cinematic';
    if (mode === 'off') return false;
    this.cancel(true);
    const st = this.deps.sim.state;
    const year = (this.year = opts.year ?? st.year);
    if (!opts.quiet) this.toastYear(year);
    const world = this.deps.world() as TimeWorld;
    this.t = 0;
    this.shownCount = 0;
    this.bannerShown = false;
    const dev = !!(opts.instant || opts.fastForward);
    const population = opts.population ?? st.stats.population;
    const fw = (this.deps.objects() as { fireworks?: FireworksLike }).fireworks ?? null;
    let duration = opts.duration ?? (typeof fw?.lengthFor === 'function' ? fw.lengthFor(population) : defaultShowLength(population));
    // fast game years: the show has to end well before the next New Year; without room for the night switch the
    // show runs in 'fireworks' mode, and very short years skip the countdown
    const yearSec = this.yearSeconds();
    const fast = !dev && opts.duration === undefined && Number.isFinite(yearSec);
    let countdown = !opts.fastForward;
    if (fast && mode === 'cinematic') {
      const budget = yearSec / 2 - (3.2 + COUNTDOWN + 10);
      if (budget >= 20) duration = Math.min(duration, budget);
      else mode = 'fireworks';
    }
    if (fast && yearSec < 45) countdown = false;
    this.countdownOn = countdown;
    this.timeControlled = mode === 'cinematic' && this.hasClock(world);
    // show camera (cinematic only; dev shows keep the camera unless asked)
    const wantCam = this.timeControlled && (opts.camera ?? (!dev && s.newYearCamera !== false));
    this.lapseDur = 0;
    let delay = countdown ? COUNTDOWN : 2.8;
    this.startHour = this.hasClock(world) ? world.timeOfDay : 12;
    if (this.timeControlled) {
      this.savedScale = typeof world.timeScale === 'number' && world.timeScale > 0 && world.timeScale < 30 ? world.timeScale : 2;
      const h = world.timeOfDay;
      if (opts.instant) {
        world.timeOfDay = 23.985;
        this.lapseFrom = this.lapseTo = 23.985;
        this.lapseDur = 0;
        delay = 2.8;
      } else if (h >= 4.5 && h < EVE - 0.02) {
        // time-lapse forward through the evening to 23:55
        this.lapseFrom = h;
        this.lapseTo = EVE;
        this.lapseDur = Math.max(1.2, Math.min(3.2, 1.1 + (EVE - h) * 0.16));
        delay = this.lapseDur + COUNTDOWN;
      } else {
        // already (late) night: count down with the clock running (a little longer when the show camera has to
        // travel first: it arrives before the opening salvo launches, ~2.9 s before midnight)
        const hu = h < 12 ? h + 24 : h;
        this.lapseFrom = this.lapseTo = hu;
        this.lapseDur = 0;
        delay = wantCam && countdown ? COUNTDOWN + 1.8 : COUNTDOWN;
      }
    }
    if (fast) duration = Math.min(duration, Math.max(6, 0.6 * yearSec - delay));
    this.midnightAt = delay;
    this.phase = this.lapseDur > 0 ? 'lapse' : 'countdown';
    // fireworks
    this.fw = fw;
    if (fw) {
      try {
        fw.timeScale = 1;
        fw.onSound = (k, x, y, z, size, extra) => this.onSound(k, x, y, z, size, extra);
        fw.start({ population, delay, seed: opts.seed, duration });
        if (opts.fastForward && opts.fastForward > 0) {
          fw.fastForward(opts.fastForward);
          this.t = opts.fastForward;
        }
        if (opts.freeze) fw.timeScale = 0;
      } catch (e) {
        console.warn('[newyear] fireworks failed', e);
        this.fw = null;
      }
    }
    if (this.t > 0 && this.timeControlled) {
      // fast-forwarded: put the clock where it would be
      world.timeOfDay = this.targetHour(this.t) % 24;
    }
    if (wantCam && this.fw) this.camStart(!!opts.instant || !!opts.fastForward);
    this.loadAudio();
    return true;
  }

  /** end the celebration now and give the clock (and the camera) back; hard = clear the sky at once */
  cancel(hard = true): void {
    if (this.phase === 'idle') {
      this.camStop(true);
      return;
    }
    try {
      this.fw?.stop(hard);
    } catch {
      /* ignore */
    }
    this.releaseTime(true);
    this.phase = 'idle';
    this.hideOverlay();
    this.camStop(true);
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.off?.();
    this.off = null;
    for (const f of this.pointerOffs) f();
    this.pointerOffs.length = 0;
    this.overlay?.remove();
    this.overlay = null;
    this.audio?.dispose();
    this.audio = null;
  }

  // ------------------------------------------------------------------------------------------------ frame
  frame(dt: number): void {
    this.frames++;
    this.lastFrameDay = this.deps.sim.state.day;
    if (!this.pointerOffs.length && this.frames % 30 === 1) this.watchPointer();
    if (this.phase === 'idle' && this.camPhase === 'off') return;
    const s = this.deps.settings();
    if (s.newYear === 'off' && this.phase !== 'idle') {
      // switched off mid-show: no new launches, the sparks in the air fade out
      this.cancel(false);
      return;
    }
    const frozen = !!this.fw && this.fw.timeScale === 0;
    const step = frozen ? 0 : Math.max(0, Math.min(dt, 0.1));
    this.updateCamera(step);
    if (this.phase === 'idle') return;
    const world = this.deps.world() as TimeWorld;
    if (this.phase === 'restore') {
      this.restoreT += step;
      this.driveTo(world, this.restoreHour(this.restoreT + step), step);
      if (this.restoreT >= RESTORE) {
        try {
          world.timeOfDay = ((this.restoreTo % 24) + 24) % 24;
        } catch {
          /* ignore */
        }
        this.releaseTime(false);
        this.phase = 'idle';
      }
      return;
    }
    this.t += step;
    if (this.t < this.lapseDur) this.phase = 'lapse';
    else if (this.t < this.midnightAt) this.phase = 'countdown';
    else this.phase = 'show';
    if (this.timeControlled) this.driveTo(world, this.targetHour(this.t + step), step);
    this.updateOverlay();
    const fw = this.fw;
    const fwDone = !fw || !fw.active || fw.settled === true;
    if (this.phase === 'show' && ((fwDone && this.t > this.midnightAt + 5) || this.t > this.midnightAt + 160)) this.finish();
  }

  // ------------------------------------------------------------------------------------------------ time of day
  private hasClock(w: TimeWorld): boolean {
    try {
      return typeof w.timeOfDay === 'number' && !(w as { isNull?: boolean }).isNull;
    } catch {
      return false;
    }
  }

  /** unwrapped hour (may exceed 24) the clock should show at celebration time t */
  private targetHour(t: number): number {
    if (t < this.lapseDur) return this.lapseFrom + (this.lapseTo - this.lapseFrom) * smooth(t / this.lapseDur);
    const start = this.lapseTo;
    const end = start < 24 ? 24 : start + (COUNTDOWN * SHOW_RATE) / 60;
    if (t < this.midnightAt) {
      const span = Math.max(0.01, this.midnightAt - this.lapseDur);
      return start + (end - start) * clamp01((t - this.lapseDur) / span);
    }
    return end + ((t - this.midnightAt) * SHOW_RATE) / 60;
  }

  private restoreHour(t: number): number {
    return this.restoreFrom + (this.restoreTo - this.restoreFrom) * smooth(t / RESTORE);
  }

  /** steer the world clock toward `target` (unwrapped hours) by the end of this frame */
  private driveTo(w: TimeWorld, target: number, dt: number): void {
    try {
      let cur = w.timeOfDay;
      while (cur < target - 12) cur += 24;
      while (cur > target + 12) cur -= 24;
      if (typeof w.timeScale === 'number') {
        w.autoTime = true;
        if (Math.abs(target - cur) > 1.5 || dt <= 0) {
          // big mismatch (someone moved the clock) or frozen: place it
          if (Math.abs(target - cur) > 1e-3) w.timeOfDay = ((target % 24) + 24) % 24;
          w.timeScale = 0;
        } else {
          w.timeScale = Math.max(0, ((target - cur) / dt) * 60);
        }
      } else {
        w.autoTime = false;
        w.timeOfDay = ((target % 24) + 24) % 24;
      }
    } catch {
      /* stand-in world without a clock */
    }
  }

  private finish(): void {
    this.hideOverlay();
    this.camBack();
    if (!this.timeControlled) {
      this.phase = 'idle';
      return;
    }
    const s = this.deps.settings();
    const w = this.deps.world() as TimeWorld;
    let cur = 0;
    try {
      cur = w.timeOfDay;
    } catch {
      /* ignore */
    }
    // auto time: continue the day where it would be without the party (it took `t` real seconds + the lapse back);
    // fixed hour: back to it
    const to = s.autoTime ? this.startHour + ((this.t + RESTORE) * this.savedScale) / 60 : s.fixedHour;
    let d = (((to - cur) % 24) + 24) % 24;
    if (d > 20) {
      // the target is just behind us (a party that started at night): don't rewind, carry on from here / snap
      if (!s.autoTime) {
        try {
          w.timeOfDay = ((s.fixedHour % 24) + 24) % 24;
        } catch {
          /* ignore */
        }
      }
      this.releaseTime(false);
      this.phase = 'idle';
      return;
    }
    if (d < 0.02) d = 0;
    this.restoreFrom = cur;
    this.restoreTo = cur + d;
    this.restoreT = 0;
    this.phase = 'restore';
  }

  /** hand the clock back to the settings */
  private releaseTime(immediate: boolean): void {
    if (!this.timeControlled) return;
    this.timeControlled = false;
    const s = this.deps.settings();
    const w = this.deps.world() as TimeWorld;
    try {
      if (typeof w.timeScale === 'number') w.timeScale = this.savedScale;
      w.autoTime = s.autoTime;
      if (!s.autoTime && immediate) w.timeOfDay = s.fixedHour;
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------------------------------------ show camera
  private camCtl(): CamCtl | null {
    try {
      const c = (this.deps.world() as { cameraController?: CamCtl }).cameraController;
      return c && typeof c.setView === 'function' ? c : null;
    } catch {
      return null;
    }
  }

  private readView(c: CamCtl, out: View): View {
    out.x = c.target.x;
    out.z = c.target.z;
    out.d = c.distance;
    out.tilt = (typeof c.baseTilt === 'number' ? c.baseTilt : c.tiltAngle) * DEG;
    out.yaw = c.yawAngle * DEG;
    return out;
  }

  private camStart(snap: boolean): void {
    const c = this.camCtl();
    if (!c || !c.enabled || this.pointerHeld) return;
    this.readView(c, this.camSaved);
    this.camUser = false;
    this.camMoved = false;
    this.camSnap = snap;
    this.camPhase = 'wait';
    this.listenForUser();
  }

  private updateCamera(dt: number): void {
    if (this.camPhase === 'off') return;
    const c = this.camCtl();
    if (!c || this.camUser) {
      // the player took the camera (or it is gone): leave it where it is
      this.camStop(false);
      return;
    }
    if (this.camPhase === 'wait') {
      // the show's launch sites are collected one frame after it starts
      const ctr = this.fw?.centre;
      if (!ctr) return;
      const k = this.fw?.showSize ?? 0.5;
      const S = this.camSaved;
      Object.assign(this.camFrom, S);
      const to = this.camTo;
      to.x = ctr.x;
      to.z = ctr.z;
      to.d = 780 + (1350 - 780) * Math.pow(clamp01(k), 0.8);
      to.tilt = CAM_TILT;
      to.yaw = S.yaw;
      // arrive before the opening salvo's sites are chosen (2.6 s before midnight), so its bursts fit the frame
      this.camDur = this.camSnap ? 0 : Math.max(0.8, Math.min(CAM_IN, this.midnightAt - 2.9 - this.t));
      this.camT = 0;
      this.camPhase = 'in';
    }
    if (this.camPhase === 'in' || this.camPhase === 'out') {
      this.camT += dt;
      const k = this.camDur > 0 ? smooth(this.camT / this.camDur) : 1;
      this.applyView(c, k);
      if (k >= 1) {
        if (this.camPhase === 'in') this.camPhase = 'hold';
        else this.camStop(false);
      }
    }
  }

  /** place the camera between camFrom and camTo (distance eased in log space) */
  private applyView(c: CamCtl, k: number): void {
    const a = this.camFrom, b = this.camTo, v = this.camCur;
    v.x = a.x + (b.x - a.x) * k;
    v.z = a.z + (b.z - a.z) * k;
    v.d = Math.exp(Math.log(Math.max(1, a.d)) + (Math.log(Math.max(1, b.d)) - Math.log(Math.max(1, a.d))) * k);
    v.tilt = a.tilt + (b.tilt - a.tilt) * k;
    let dy = b.yaw - a.yaw;
    while (dy > 180) dy -= 360;
    while (dy < -180) dy += 360;
    v.yaw = a.yaw + dy * k;
    try {
      c.setView(v.x, v.z, v.d, v.tilt, v.yaw);
      this.camMoved = true;
    } catch {
      this.camStop(false);
    }
  }

  /** after the show: ease back to the player's view (unless they took the camera meanwhile) */
  private camBack(): void {
    if (this.camPhase === 'off' || this.camUser) {
      this.camStop(false);
      return;
    }
    const c = this.camCtl();
    if (!c || !this.camMoved) {
      this.camStop(false);
      return;
    }
    this.readView(c, this.camFrom);
    Object.assign(this.camTo, this.camSaved);
    this.camDur = CAM_OUT;
    this.camT = 0;
    this.camPhase = 'out';
  }

  /** stop driving the camera; restore = snap back to the player's view (cancelled mid-way) */
  private camStop(restore: boolean): void {
    if (this.camPhase === 'off') return;
    const c = restore && this.camMoved && !this.camUser ? this.camCtl() : null;
    if (c) {
      const v = this.camSaved;
      try {
        c.setView(v.x, v.z, v.d, v.tilt, v.yaw);
      } catch {
        /* ignore */
      }
    }
    this.camPhase = 'off';
    for (const f of this.camOffs) f();
    this.camOffs.length = 0;
  }

  /** any camera input (or a click / touch on the city) hands the camera back to the player */
  private listenForUser(): void {
    if (this.camOffs.length) return;
    const user = () => {
      this.camUser = true;
    };
    const el = this.canvas();
    if (el) {
      for (const ev of ['pointerdown', 'wheel', 'touchstart'] as const) {
        el.addEventListener(ev, user, { capture: true, passive: true });
        this.camOffs.push(() => el.removeEventListener(ev, user, { capture: true }));
      }
    }
    if (typeof window !== 'undefined') {
      const kd = (e: KeyboardEvent) => {
        if (CAMERA_KEYS.has(e.key.toLowerCase())) this.camUser = true;
      };
      window.addEventListener('keydown', kd, true);
      this.camOffs.push(() => window.removeEventListener('keydown', kd, true));
    }
  }

  private canvas(): HTMLElement | null {
    try {
      const r = (this.deps.world() as { renderer?: { domElement?: HTMLElement } }).renderer;
      return r?.domElement && typeof r.domElement.addEventListener === 'function' ? r.domElement : null;
    } catch {
      return null;
    }
  }

  /** track held pointer buttons on the canvas (the show camera never starts in the middle of a tool drag) */
  private watchPointer(): void {
    const el = this.canvas();
    if (!el || typeof window === 'undefined') return;
    const down = () => {
      this.pointerHeld = true;
    };
    const up = () => {
      this.pointerHeld = false;
    };
    el.addEventListener('pointerdown', down, { capture: true, passive: true });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    this.pointerOffs.push(
      () => el.removeEventListener('pointerdown', down, { capture: true }),
      () => window.removeEventListener('pointerup', up, true),
      () => window.removeEventListener('pointercancel', up, true),
    );
  }

  // ------------------------------------------------------------------------------------------------ toast text
  private statsLine(year: number): string {
    const st = this.deps.sim.state;
    const pop = st.stats.population;
    const name = st.config.name || 'The city';
    // population a year ago: the monthly history (12 samples back), else what we saw at the last New Year
    const hp = st.history.pop;
    const prev = hp.length >= 13 ? hp[hp.length - 13] : this.lastYearPop;
    if (pop <= 0) return `${name} rings in ${year}. Here's to the first residents!`;
    let growth = '';
    if (prev !== null && prev > 0) {
      const g = ((pop - prev) / prev) * 100;
      growth = Math.abs(g) < 0.05 ? ` · steady vs ${year - 1}` : ` · ${g > 0 ? '▲' : '▼'} ${Math.abs(g).toFixed(Math.abs(g) >= 100 ? 0 : 1)}% vs ${year - 1}`;
    } else growth = ' · its first year';
    return `${name} celebrates with ${nf.format(pop)} residents${growth}.`;
  }

  // ------------------------------------------------------------------------------------------------ countdown overlay
  private updateOverlay(): void {
    if (!this.countdownOn || !this.deps.overlayRoot) return;
    const left = this.midnightAt - this.t;
    if (left > 0 && left <= 3) {
      const n = Math.ceil(left);
      if (n !== this.shownCount) {
        this.shownCount = n;
        this.flashText(String(n), false);
        this.tick(false);
      }
    } else if (left <= 0 && !this.bannerShown) {
      this.bannerShown = true;
      this.flashText(`Happy New Year ${this.year}!`, true);
      this.tick(true);
    }
  }

  private flashText(text: string, banner: boolean): void {
    const root = this.deps.overlayRoot;
    if (!root) return;
    if (!this.overlay) {
      const el = document.createElement('div');
      el.className = 'newyear-countdown';
      el.setAttribute('aria-live', 'polite');
      el.style.cssText = 'position:absolute;left:0;right:0;top:15%;display:flex;justify-content:center;pointer-events:none;z-index:40;';
      root.appendChild(el);
      this.overlay = el;
    }
    const el = this.overlay;
    el.style.display = 'flex';
    // the countdown sits high; the banner sits below the midnight salvo (over the city), so it never covers it
    el.style.top = banner ? '62%' : '15%';
    el.textContent = '';
    const span = document.createElement('span');
    span.textContent = text;
    const z = 'var(--ui-zoom, 1)';
    span.style.cssText = banner
      ? `font:800 calc(44px * ${z})/1.1 system-ui, -apple-system, 'Segoe UI', sans-serif;letter-spacing:.02em;color:#fff4d6;` +
        'text-shadow:0 0 16px rgba(255,190,90,.8),0 0 36px rgba(255,120,60,.5),0 3px 12px rgba(0,0,0,.65);white-space:nowrap;'
      : `font:800 calc(110px * ${z})/1 system-ui, -apple-system, 'Segoe UI', sans-serif;color:#fff;` +
        'text-shadow:0 0 24px rgba(160,200,255,.9),0 0 60px rgba(120,160,255,.5),0 4px 14px rgba(0,0,0,.55);';
    el.appendChild(span);
    try {
      span.animate(
        banner
          ? [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1.04)', offset: 0.12 }, { opacity: 1, transform: 'scale(1)', offset: 0.75 }, { opacity: 0, transform: 'scale(1.02) translateY(-12px)' }]
          : [{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(1)', offset: 0.18 }, { opacity: 0.9, offset: 0.7 }, { opacity: 0, transform: 'scale(.85)' }],
        { duration: banner ? 4200 : 950, easing: 'ease-out', fill: 'forwards' },
      );
    } catch {
      /* no WAAPI: static text, hidden when the show ends */
    }
  }

  /** countdown blip: a UI sound, so it honours a "UI sounds" toggle (settings.uiSounds / audio.uiSounds) if present */
  private tick(final: boolean): void {
    const s = this.deps.settings() as GameSettings & { uiSounds?: boolean };
    const a = this.deps.audio?.() as { uiSounds?: boolean } | undefined;
    if (s.uiSounds === false || a?.uiSounds === false) return;
    this.audio?.tick(final);
  }

  private hideOverlay(): void {
    if (this.overlay) {
      this.overlay.textContent = '';
      this.overlay.style.display = 'none';
    }
  }

  // ------------------------------------------------------------------------------------------------ audio
  private loadAudio(): void {
    if (this.audio || this.audioLoading || this.disposed) return;
    this.audioLoading = true;
    import('../audio/fireworks')
      .then((m) => {
        // the city may have been left while the module loaded
        if (this.disposed) return;
        this.spatialize = m.spatialize;
        const fa = new m.FireworksAudio(() => {
          const a = this.deps.audio?.() as { getSfxOutput?: () => FireworksAudioOut | null } | undefined;
          return typeof a?.getSfxOutput === 'function' ? a.getSfxOutput() : null;
        });
        this.audio = fa;
        // pre-render the pop textures and the reverb off the countdown's critical path
        const idle = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
        const warm = () => {
          if (!this.disposed) fa.warm();
        };
        if (idle) idle(warm, { timeout: 600 });
        else setTimeout(warm, 30);
      })
      .catch((e) => console.warn('[newyear] fireworks audio unavailable', e))
      .finally(() => (this.audioLoading = false));
  }

  private onSound(kind: FireworksSoundKind, x: number, y: number, z: number, size: number, extra: number): void {
    const a = this.audio, sp = this.spatialize;
    if (!a || !sp) return;
    const cam = this.deps.world().camera;
    if (!cam) return;
    const e = cam.matrixWorld.elements;
    const l = this.listener;
    l.x = e[12]; l.y = e[13]; l.z = e[14];
    l.rx = e[0]; l.ry = e[1]; l.rz = e[2];
    const s = sp(l, x, y, z, this.sp);
    switch (kind) {
      case 'launch':
        a.launch(s, false, size, extra > 0.5);
        break;
      case 'whistle':
        a.launch(s, true, size, extra > 0.5);
        break;
      case 'burst':
        a.burst(s, clamp01((size - 30) / 100), extra);
        break;
      case 'crackle':
        a.crackle(s, Math.max(0.3, extra), 0.55);
        break;
      case 'glitter':
        a.glitter(s, Math.max(0.5, extra));
        break;
      case 'salute':
        a.salute(s);
        break;
    }
  }
}
