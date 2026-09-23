/**
 * NewYearCelebration — rings in every new game year (the Simulation's 'year' event, Jan 1st):
 *   - toast "🎆 Happy New Year {year}!" with a line of city stats (population, growth vs last year)
 *   - settings.newYear = 'cinematic': a smooth ~3 s time-lapse to 23:55 (if it isn't night already), a
 *     3-2-1 countdown with the clock ticking to midnight, the opening salvo at 00:00 and a fireworks show sized by the
 *     population (objects.fireworks); afterwards the day / night cycle returns to normal (auto time resumes, or a quick
 *     time-lapse back to the fixed hour)
 *   - 'fireworks': countdown + show at whatever time it is;  'off': nothing
 * Everything runs in real time (independent of the sim speed; keeps going while paused). The camera is never moved.
 * Batch-simulated years (headless runDays, loading) are skipped: only years reached while the game loop runs party.
 *
 *   const ny = new NewYearCelebration({ sim, world: () => w, objects: () => o, settings: () => s, toast, audio });
 *   loop (before world.update): ny.frame(dt)        dev: ny.celebrate({ instant: true })
 */
import type { Simulation } from '../sim/Simulation';
import type { CityObjectsViewApi, WorldViewApi } from '../render/contracts';
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
}

type Phase = 'idle' | 'lapse' | 'countdown' | 'show' | 'restore';
type TimeWorld = WorldViewApi & { timeScale?: number };

/** 23:55 */
const EVE = 23 + 55 / 60;
/** seconds of countdown from 23:55 to midnight */
const COUNTDOWN = 3.6;
/** game minutes per real second while the show runs (keeps it night) */
const SHOW_RATE = 0.6;

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
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
  private restoreFrom = 0;
  private restoreTo = 0;
  private restoreT = 0;
  private fw: Fireworks | null = null;
  private audio: FireworksAudio | null = null;
  private audioLoading = false;
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

  // ------------------------------------------------------------------------------------------------ trigger
  private onYear(year: number): void {
    const st = this.deps.sim.state;
    const popNow = st.stats.population;
    // a brand-new city (day 0) or years simulated in a batch (headless runDays / loading) don't get a party
    const batch = this.frames === 0 || st.day - this.lastFrameDay > 8;
    if (st.day > 0 && !batch && (popNow > 0 || st.buildings.size > 0)) this.celebrate({ year });
    this.lastYearPop = popNow;
  }

  /** start the celebration now (also the dev hook behind scene.celebrateNewYear()) */
  celebrate(opts: CelebrateOptions = {}): boolean {
    const s = this.deps.settings();
    const mode: NewYearMode = opts.mode ?? s.newYear ?? 'cinematic';
    if (mode === 'off') return false;
    this.cancel();
    const st = this.deps.sim.state;
    const year = (this.year = opts.year ?? st.year);
    if (!opts.quiet && s.toasts !== false) {
      try {
        this.deps.toast(this.statsLine(year), 'reward', undefined, `🎆 Happy New Year ${year}!`);
        this.deps.sound?.('reward');
      } catch {
        /* ignore */
      }
    }
    const world = this.deps.world() as TimeWorld;
    this.t = 0;
    this.shownCount = 0;
    this.bannerShown = false;
    this.countdownOn = !opts.fastForward;
    this.timeControlled = mode === 'cinematic' && this.hasClock(world);
    this.lapseDur = 0;
    let delay = COUNTDOWN;
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
        // already (late) night: count down with the clock running
        const hu = h < 12 ? h + 24 : h;
        this.lapseFrom = this.lapseTo = hu;
        this.lapseDur = 0;
        delay = COUNTDOWN;
      }
    }
    this.midnightAt = delay;
    this.phase = this.lapseDur > 0 ? 'lapse' : 'countdown';
    // fireworks
    const fw = (this.deps.objects() as { fireworks?: Fireworks }).fireworks ?? null;
    this.fw = fw;
    if (fw) {
      try {
        fw.timeScale = 1;
        fw.onSound = (k, x, y, z, size, extra) => this.onSound(k, x, y, z, size, extra);
        fw.start({ population: opts.population ?? st.stats.population, delay, seed: opts.seed, duration: opts.duration });
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
    this.loadAudio();
    return true;
  }

  /** end the celebration now and give the clock back */
  cancel(): void {
    if (this.phase === 'idle') return;
    try {
      this.fw?.stop(true);
    } catch {
      /* ignore */
    }
    this.releaseTime(true);
    this.phase = 'idle';
    this.hideOverlay();
  }

  dispose(): void {
    this.cancel();
    this.off?.();
    this.off = null;
    this.overlay?.remove();
    this.overlay = null;
    this.audio?.dispose();
  }

  // ------------------------------------------------------------------------------------------------ frame
  frame(dt: number): void {
    this.frames++;
    this.lastFrameDay = this.deps.sim.state.day;
    if (this.phase === 'idle') return;
    const s = this.deps.settings();
    if (s.newYear === 'off') {
      this.cancel();
      return;
    }
    const frozen = !!this.fw && this.fw.timeScale === 0;
    const step = frozen ? 0 : Math.max(0, Math.min(dt, 0.1));
    const world = this.deps.world() as TimeWorld;
    if (this.phase === 'restore') {
      this.restoreT += step;
      this.driveTo(world, this.restoreHour(this.restoreT + step), step);
      if (this.restoreT >= 2.4) {
        world.autoTime = false;
        world.timeOfDay = s.fixedHour;
        if (typeof world.timeScale === 'number') world.timeScale = this.savedScale;
        this.timeControlled = false;
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
    const fwDone = !this.fw || !this.fw.active;
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
    return this.restoreFrom + (this.restoreTo - this.restoreFrom) * smooth(t / 2.4);
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
    if (!this.timeControlled) {
      this.phase = 'idle';
      return;
    }
    const s = this.deps.settings();
    const w = this.deps.world() as TimeWorld;
    if (s.autoTime) {
      this.releaseTime(false);
      this.phase = 'idle';
      return;
    }
    // fixed hour: time-lapse forward back to it
    let cur = w.timeOfDay;
    let to = s.fixedHour;
    while (to <= cur) to += 24;
    if (to - cur > 20) cur = to; // (almost) there already
    this.restoreFrom = cur;
    this.restoreTo = to;
    this.restoreT = 0;
    this.phase = 'restore';
  }

  /** hand the clock back to the settings (immediate) */
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

  // ------------------------------------------------------------------------------------------------ toast text
  private statsLine(year: number): string {
    const st = this.deps.sim.state;
    const pop = st.stats.population;
    const name = st.config.name || 'The city';
    // population a year ago: the monthly history (12 samples back), else what we saw at the last New Year
    const hp = st.history.pop;
    let prev = hp.length >= 13 ? hp[hp.length - 13] : this.lastYearPop;
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
    el.textContent = '';
    const span = document.createElement('span');
    span.textContent = text;
    const z = 'var(--ui-zoom, 1)';
    span.style.cssText = banner
      ? `font:800 calc(54px * ${z})/1.1 system-ui, -apple-system, 'Segoe UI', sans-serif;letter-spacing:.02em;color:#fff4d6;` +
        'text-shadow:0 0 18px rgba(255,190,90,.85),0 0 42px rgba(255,120,60,.55),0 3px 12px rgba(0,0,0,.6);white-space:nowrap;'
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
    if (this.audio || this.audioLoading) return;
    this.audioLoading = true;
    import('../audio/fireworks')
      .then((m) => {
        this.spatialize = m.spatialize;
        this.audio = new m.FireworksAudio(() => {
          const a = this.deps.audio?.() as { getSfxOutput?: () => FireworksAudioOut | null } | undefined;
          return typeof a?.getSfxOutput === 'function' ? a.getSfxOutput() : null;
        });
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
