/**
 * Procedural one-shot sound effects (WebAudio node graphs, no asset files).
 * Every sound is a small function (ctx, time, options) that builds and schedules a short-lived graph.
 *
 * Palette: every tonal UI / event sound is drawn from C major pentatonic (+ B for sparkle, A minor for "bad" news),
 * so overlapping sounds (and the soundtrack) stay consonant and the whole UI feels like one instrument family.
 * Repetitive game sounds (build, zone, bulldoze...) pick random sample variations (filters, timings, pentatonic
 * notes) on every play so long sessions don't fatigue; `exact: true` makes a play deterministic (audio lab).
 *
 * Loudness: TRIM[name] (dB) normalizes each voice to its role's target (measured with the audio lab,
 * `node tools/render-audio.mjs "sfx=all" shots/audio/sfx_all.png`, momentary-max LUFS):
 *   hover / tick ~ -46 · icon taps ~ -38 · buttons / tabs / toggles / panels ~ -34..-37 · game actions ~ -28..-31
 *   notifications ~ -29..-33 · rewards / milestones / fanfares ~ -24 · disaster alarms ~ -23..-25
 */

export type SoundCategory = 'ui' | 'game' | 'event';

export interface SoundMeta {
  /** 'ui' sounds obey the "UI sounds" toggle; game actions and events always play (SFX volume) */
  cat: SoundCategory;
  /** approximate audible length (s) - the audio lab sizes its slots from it */
  dur: number;
  /** minimum ms between two plays of this sound (default 45) */
  gap?: number;
  /** de-dup group: only one sound of a group plays within `groupMs` (alerts from the same moment) */
  group?: 'alert';
  /** random pitch jitter (fraction, default 0.04) */
  jitter?: number;
}

const META = {
  // ------------------------------------------------------------ UI controls
  click: { cat: 'ui', dur: 0.08 },
  press: { cat: 'ui', dur: 0.2 },
  tap: { cat: 'ui', dur: 0.06 },
  hover: { cat: 'ui', dur: 0.05, gap: 60, jitter: 0 },
  tab: { cat: 'ui', dur: 0.1 },
  tick: { cat: 'ui', dur: 0.03, gap: 35, jitter: 0.01 },
  sliderRelease: { cat: 'ui', dur: 0.12 },
  toggle: { cat: 'ui', dur: 0.15 },
  toggleOn: { cat: 'ui', dur: 0.15 },
  toggleOff: { cat: 'ui', dur: 0.15 },
  open: { cat: 'ui', dur: 0.35 },
  close: { cat: 'ui', dur: 0.2 },
  dialogOpen: { cat: 'ui', dur: 0.6 },
  dialogClose: { cat: 'ui', dur: 0.3 },
  flyout: { cat: 'ui', dur: 0.25 },
  flyoutClose: { cat: 'ui', dur: 0.1 },
  grab: { cat: 'ui', dur: 0.05 },
  drop: { cat: 'ui', dur: 0.07 },
  confirm: { cat: 'ui', dur: 0.45 },
  cancel: { cat: 'ui', dur: 0.25 },
  toolSelect: { cat: 'ui', dur: 0.3, jitter: 0.01 },
  toolOff: { cat: 'ui', dur: 0.12 },
  rotate: { cat: 'ui', dur: 0.1 },
  camRotate: { cat: 'ui', dur: 0.4, gap: 120 },
  overlay: { cat: 'ui', dur: 0.45 },
  overlayOff: { cat: 'ui', dur: 0.25 },
  query: { cat: 'ui', dur: 0.3 },
  pause: { cat: 'ui', dur: 0.25, jitter: 0 },
  speed1: { cat: 'ui', dur: 0.2, jitter: 0 },
  speed2: { cat: 'ui', dur: 0.22, jitter: 0 },
  speed3: { cat: 'ui', dur: 0.25, jitter: 0 },
  speed: { cat: 'ui', dur: 0.22, jitter: 0 },
  save: { cat: 'ui', dur: 0.8 },
  autosave: { cat: 'ui', dur: 0.5 },
  shuffle: { cat: 'ui', dur: 0.35, gap: 120 },
  stepDone: { cat: 'ui', dur: 0.8, jitter: 0 },
  whoosh: { cat: 'ui', dur: 0.45 },
  // ------------------------------------------------------------ game actions
  error: { cat: 'game', dur: 0.3, group: 'alert', jitter: 0 },
  zone: { cat: 'game', dur: 0.25 },
  dezone: { cat: 'game', dur: 0.2 },
  road: { cat: 'game', dur: 0.3 },
  rail: { cat: 'game', dur: 0.35 },
  power: { cat: 'game', dur: 0.3 },
  pipe: { cat: 'game', dur: 0.2 },
  bulldoze: { cat: 'game', dur: 0.5 },
  plop: { cat: 'game', dur: 0.5 },
  terraform: { cat: 'game', dur: 0.4 },
  tree: { cat: 'game', dur: 0.3 },
  construct: { cat: 'game', dur: 0.06, gap: 30 },
  built: { cat: 'game', dur: 0.4, gap: 600 },
  cash: { cat: 'game', dur: 0.8 },
  // ------------------------------------------------------------ events / notifications
  notify: { cat: 'event', dur: 1.1, group: 'alert' },
  news: { cat: 'event', dur: 0.6, group: 'alert' },
  good: { cat: 'event', dur: 0.7, group: 'alert', jitter: 0 },
  warning: { cat: 'event', dur: 0.6, group: 'alert', jitter: 0 },
  bad: { cat: 'event', dur: 0.7, group: 'alert', jitter: 0 },
  advisor: { cat: 'event', dur: 0.7, group: 'alert', jitter: 0 },
  coin: { cat: 'event', dur: 0.5 },
  cashLow: { cat: 'event', dur: 0.6, jitter: 0 },
  bankrupt: { cat: 'event', dur: 1.1, jitter: 0 },
  reward: { cat: 'event', dur: 1.4, jitter: 0 },
  milestone: { cat: 'event', dur: 1.9, jitter: 0 },
  found: { cat: 'event', dur: 2.0, jitter: 0 },
  cityReady: { cat: 'event', dur: 1.6, jitter: 0 },
  regionEnter: { cat: 'event', dur: 1.2, jitter: 0 },
  alarm: { cat: 'event', dur: 2.8, gap: 1500 },
  fire: { cat: 'event', dur: 1.8, gap: 1500 },
  tornado: { cat: 'event', dur: 2.8, gap: 1500 },
  quake: { cat: 'event', dur: 2.4, gap: 1500 },
  meteor: { cat: 'event', dur: 2.0, gap: 400 },
} satisfies Record<string, SoundMeta>;

export type SoundName = keyof typeof META;
export const SOUND_META: Record<SoundName, SoundMeta> = META;
export const SOUND_NAMES = Object.keys(META) as SoundName[];

/**
 * Measured loudness normalization (dB), from the audio lab ("sfx=all"): trim = role target - measured momentary max.
 * Kept separate from META so re-measuring only touches this table.
 */
const TRIM: Partial<Record<SoundName, number>> = {
  click: -2.7, press: -3.8, tap: -1.9, hover: 0.9, tab: -0.3, tick: 0.1, sliderRelease: -2.4, toggle: -1.8,
  toggleOn: -1.8, toggleOff: -2.5, open: 0.3, close: 2.7, dialogOpen: 1, dialogClose: 3.3, flyout: -1.5,
  flyoutClose: -0.2, grab: -2.4, drop: -4.4, confirm: -4.1, cancel: -1.6, toolSelect: 0.4, toolOff: -0.3,
  rotate: 5.6, camRotate: 0.9, overlay: -1.9, overlayOff: -2.5, query: -1.9, pause: -2.4, speed1: 2.8,
  speed2: 0.4, speed3: -0.5, speed: 0.4, save: -2.7, autosave: -3.1, shuffle: 3.3, stepDone: -1.7, whoosh: -0.1,
  error: -4.6, zone: 10.8, dezone: 11, road: -2.2, rail: -0.5, power: 3.8, pipe: 0.3, bulldoze: 3.3, plop: -1.6,
  terraform: -0.3, tree: 1.4, construct: 1.7, built: -3.1, cash: -6.9, notify: -5.7, news: -2.8, good: -5.9,
  warning: 0.3, bad: -1.9, advisor: -5.2, coin: -4.8, cashLow: -9.6, bankrupt: 6.3, reward: -1.5, milestone: -1,
  found: -1.7, cityReady: -4.6, regionEnter: -1.1, alarm: -4.6, fire: 1.6, tornado: 0.4, quake: -6.3,
  meteor: -6.8,
};

export interface PlayOptions {
  /** 0..2 linear gain multiplier (default 1) */
  volume?: number;
  /** -1 (left) .. 1 (right) */
  pan?: number;
  /** pitch multiplier (default 1, small random variation is added unless exact = true) */
  pitch?: number;
  /** deterministic play (no random pitch / sample variation) */
  exact?: boolean;
  /** 0..1 how "big" the action was (drag length, brush strength); default 0.5 */
  intensity?: number;
}

export interface SfxEnv {
  ctx: AudioContext;
  /** destination for dry signal */
  out: AudioNode;
  /** reverb send */
  wet: AudioNode;
  /** white noise buffer (2 s) */
  noise: AudioBuffer;
}

/** per-play voice parameters: pitch multiplier, random source (deterministic when exact), intensity */
interface VP {
  p: number;
  r: () => number;
  k: number;
}
type Voice = (e: SfxEnv, t: number, dest: AudioNode, v: VP) => void;

// ------------------------------------------------------------------ primitives
function gainAt(e: SfxEnv, dest: AudioNode, v = 0): GainNode {
  const g = e.ctx.createGain();
  g.gain.value = v;
  g.connect(dest);
  return g;
}

/** attack / exponential decay envelope */
function perc(g: GainNode, t: number, peak: number, attack: number, decay: number): number {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return t + attack + decay + 0.05;
}

function tone(e: SfxEnv, dest: AudioNode, type: OscillatorType, f0: number, t: number, dur: number, peak: number, f1?: number, attack = 0.005): OscillatorNode {
  const o = e.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = gainAt(e, dest);
  o.connect(g);
  const end = perc(g, t, peak, attack, dur);
  o.start(t);
  o.stop(end);
  return o;
}

function noise(e: SfxEnv, dest: AudioNode, t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1?: number, q = 1, attack = 0.004, offset = Math.random() * 1.5): AudioBufferSourceNode {
  const src = e.ctx.createBufferSource();
  src.buffer = e.noise;
  const bq = e.ctx.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, t);
  if (f1 !== undefined) bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = gainAt(e, dest);
  src.connect(bq).connect(g);
  const end = perc(g, t, peak, attack, dur);
  src.start(t, offset);
  src.stop(end);
  return src;
}

/** FM bell / tine */
function bell(e: SfxEnv, dest: AudioNode, f: number, t: number, dur: number, peak: number, ratio = 3.5, index = 2.5): void {
  const c = e.ctx.createOscillator();
  const m = e.ctx.createOscillator();
  const mg = e.ctx.createGain();
  c.frequency.value = f;
  m.frequency.value = f * ratio;
  mg.gain.setValueAtTime(f * index, t);
  mg.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.6);
  m.connect(mg).connect(c.frequency);
  const g = gainAt(e, dest);
  c.connect(g);
  const end = perc(g, t, peak, 0.004, dur);
  c.start(t);
  m.start(t);
  c.stop(end);
  m.stop(end);
}

/** marimba-like mallet: sine fundamental + short 4th partial + knock */
function mallet(e: SfxEnv, dest: AudioNode, f: number, t: number, dur: number, peak: number): void {
  tone(e, dest, 'sine', f, t, dur, peak, undefined, 0.002);
  tone(e, dest, 'sine', f * 3.99, t, dur * 0.18, peak * 0.22, undefined, 0.001);
  tone(e, dest, 'sine', f * 2, t, dur * 0.35, peak * 0.12, undefined, 0.002);
}

function lowpass(e: SfxEnv, dest: AudioNode, f: number, q = 0.7): BiquadFilterNode {
  const lp = e.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = f;
  lp.Q.value = q;
  lp.connect(dest);
  return lp;
}

const N = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
/** C major pentatonic degrees (semitones above C) */
const PENTA = [0, 2, 4, 7, 9];
const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.min(a.length - 1, Math.floor(r() * a.length))];

// ------------------------------------------------------------------ voices
const VOICES: Record<SoundName, Voice> = {
  // ---------------------------------------------------------------- UI controls
  /** secondary button: soft rounded tick */
  click(e, t, d, { p, r }) {
    tone(e, d, 'sine', 1450 * p, t, 0.045, 0.2, 820 * p, 0.002);
    noise(e, d, t, 0.012, 0.05, 'highpass', 4500 + r() * 1500, undefined, 1, 0.002, r() * 1.5);
  },
  /** primary button: fuller pop with a C6 tone */
  press(e, t, d, { p, r }) {
    tone(e, d, 'sine', 980 * p, t, 0.07, 0.26, 560 * p, 0.002);
    tone(e, d, 'triangle', N(84) * p, t + 0.004, 0.1, 0.07);
    tone(e, e.wet, 'sine', N(91) * p, t + 0.01, 0.16, 0.035);
    noise(e, d, t, 0.012, 0.05, 'highpass', 4000, undefined, 1, 0.002, r() * 1.5);
  },
  /** icon button: light, short tap */
  tap(e, t, d, { p, r }) {
    tone(e, d, 'sine', 2100 * p, t, 0.03, 0.14, 1350 * p, 0.0015);
    noise(e, d, t, 0.008, 0.035, 'highpass', 5000 + r() * 1500, undefined, 1, 0.001, r() * 1.5);
  },
  /** menu / toolbar hover: a whisper-quiet pentatonic tick (sweeping a menu plays a little scale) */
  hover(e, t, d, { p, r }) {
    tone(e, d, 'sine', N(84 + pick(r, PENTA)) * p, t, 0.028, 0.05, undefined, 0.002);
  },
  /** tab / segmented control: woody tock */
  tab(e, t, d, { p, r }) {
    tone(e, d, 'triangle', N(81) * p, t, 0.06, 0.16, N(76) * p, 0.002);
    tone(e, d, 'sine', N(88) * p, t, 0.035, 0.05, undefined, 0.002);
    noise(e, d, t, 0.018, 0.05, 'bandpass', 1900 + r() * 400, undefined, 2.5, 0.002, r() * 1.5);
  },
  /** slider detent tick (pitch follows the value) */
  tick(e, t, d, { p }) {
    tone(e, d, 'sine', 2600 * p, t, 0.014, 0.06, 2000 * p, 0.001);
    noise(e, d, t, 0.006, 0.02, 'highpass', 6000, undefined, 1, 0.001, 0.3);
  },
  /** slider released: soft settle */
  sliderRelease(e, t, d, { p }) {
    tone(e, d, 'sine', 760 * p, t, 0.05, 0.12, 520 * p, 0.002);
    tone(e, d, 'triangle', N(79) * p, t + 0.01, 0.09, 0.05);
    noise(e, d, t, 0.015, 0.035, 'bandpass', 1400, undefined, 2, 0.002, 0.7);
  },
  toggle(e, t, d, v) {
    VOICES.toggleOn(e, t, d, v);
  },
  /** switch on: C6 -> G6 */
  toggleOn(e, t, d, { p }) {
    noise(e, d, t, 0.008, 0.04, 'highpass', 5000, undefined, 1, 0.001, 0.2);
    tone(e, d, 'triangle', N(84) * p, t, 0.05, 0.12);
    tone(e, d, 'triangle', N(91) * p, t + 0.045, 0.08, 0.12);
    tone(e, e.wet, 'sine', N(91) * p, t + 0.045, 0.12, 0.03);
  },
  /** switch off: G6 -> C6, darker */
  toggleOff(e, t, d, { p }) {
    const lp = lowpass(e, d, 2400);
    noise(e, d, t, 0.008, 0.035, 'highpass', 4500, undefined, 1, 0.001, 0.9);
    tone(e, lp, 'triangle', N(91) * p, t, 0.05, 0.11);
    tone(e, lp, 'triangle', N(84) * p, t + 0.045, 0.08, 0.11);
  },
  /** panel open: airy rising swish + E6 */
  open(e, t, d, { p, r }) {
    noise(e, d, t, 0.16, 0.06, 'bandpass', 700 * (0.9 + r() * 0.2), 3200, 1.3, 0.06, r() * 1.5);
    tone(e, d, 'sine', N(88) * p, t + 0.04, 0.16, 0.06);
    tone(e, e.wet, 'sine', N(95) * p, t + 0.07, 0.24, 0.035);
  },
  /** panel close: falling swish */
  close(e, t, d, { p, r }) {
    noise(e, d, t, 0.13, 0.05, 'bandpass', 2800, 600, 1.3, 0.02, r() * 1.5);
    tone(e, d, 'sine', N(86) * p, t, 0.11, 0.045, N(79) * p);
  },
  /** modal dialog open: swish + soft E-G-B bloom */
  dialogOpen(e, t, d, { p, r }) {
    noise(e, d, t, 0.28, 0.07, 'bandpass', 500, 2600, 1.1, 0.12, r() * 1.5);
    ([[76, 0], [79, 0.035], [83, 0.07]] as const).forEach(([m, dt]) => {
      tone(e, d, 'triangle', N(m) * p, t + 0.05 + dt, 0.3, 0.045, undefined, 0.012);
      tone(e, e.wet, 'sine', N(m + 12) * p, t + 0.05 + dt, 0.4, 0.02, undefined, 0.01);
    });
  },
  dialogClose(e, t, d, { p, r }) {
    noise(e, d, t, 0.2, 0.055, 'bandpass', 2400, 500, 1.1, 0.03, r() * 1.5);
    tone(e, d, 'triangle', N(83) * p, t, 0.12, 0.04);
    tone(e, d, 'triangle', N(76) * p, t + 0.05, 0.18, 0.04);
  },
  /** toolbar flyout open: rising bloop */
  flyout(e, t, d, { p, r }) {
    tone(e, d, 'sine', 520 * p, t, 0.08, 0.14, 1250 * p, 0.003);
    noise(e, d, t, 0.06, 0.035, 'bandpass', 900, 2800, 1.5, 0.02, r() * 1.5);
    tone(e, e.wet, 'sine', N(91) * p, t + 0.05, 0.16, 0.025);
  },
  flyoutClose(e, t, d, { p, r }) {
    tone(e, d, 'sine', 1050 * p, t, 0.06, 0.09, 520 * p, 0.002);
    noise(e, d, t, 0.05, 0.025, 'bandpass', 2400, 900, 1.5, 0.01, r() * 1.5);
  },
  /** panel drag start / drop */
  grab(e, t, d, { p }) {
    tone(e, d, 'sine', 340 * p, t, 0.03, 0.12, 260 * p, 0.002);
    noise(e, d, t, 0.01, 0.04, 'bandpass', 1600, undefined, 2, 0.001, 0.4);
  },
  drop(e, t, d, { p }) {
    tone(e, d, 'sine', 280 * p, t, 0.05, 0.14, 190 * p, 0.002);
    noise(e, d, t, 0.02, 0.04, 'lowpass', 1400, undefined, 0.7, 0.002, 1.1);
  },
  confirm(e, t, d, { p }) {
    tone(e, d, 'triangle', N(84) * p, t, 0.14, 0.18);
    tone(e, d, 'triangle', N(91) * p, t + 0.07, 0.22, 0.16);
    tone(e, e.wet, 'sine', N(91) * p, t + 0.07, 0.3, 0.06);
  },
  cancel(e, t, d, { p }) {
    tone(e, d, 'triangle', N(84) * p, t, 0.1, 0.14);
    tone(e, d, 'triangle', N(77) * p, t + 0.06, 0.16, 0.12);
  },
  /** tool picked: E6 tine over a soft body (callers transpose by category along the pentatonic scale) */
  toolSelect(e, t, d, { p }) {
    bell(e, d, N(88) * p, t, 0.22, 0.07, 2, 1.4);
    tone(e, d, 'sine', N(64) * p, t, 0.07, 0.12, N(64) * p * 0.8, 0.002);
    noise(e, d, t, 0.01, 0.04, 'highpass', 4500, undefined, 1, 0.001, 0.6);
    bell(e, e.wet, N(88) * p, t, 0.3, 0.03, 2, 1.4);
  },
  /** tool put away */
  toolOff(e, t, d, { p }) {
    tone(e, d, 'sine', 1250 * p, t, 0.07, 0.08, 700 * p, 0.002);
    tone(e, d, 'triangle', N(76) * p, t + 0.02, 0.08, 0.05);
  },
  /** building rotate: little ratchet */
  rotate(e, t, d, { p, r }) {
    let tt = t;
    for (let k = 0; k < 3; k++) {
      noise(e, d, tt, 0.01, 0.1 - k * 0.02, 'bandpass', (3200 - k * 400) * p, undefined, 5, 0.001, r() * 1.5);
      tt += 0.022 + r() * 0.01;
    }
    tone(e, d, 'sine', 1100 * p, t, 0.05, 0.06, 820 * p);
  },
  /** camera 90° rotate: soft air whoosh */
  camRotate(e, t, d, { p, r }) {
    noise(e, d, t, 0.36, 0.08, 'bandpass', 380 * p, 1500 * p * (0.9 + r() * 0.2), 0.9, 0.14, r() * 1.5);
  },
  /** data view on: glassy E-G-B shimmer */
  overlay(e, t, d, { p, r }) {
    noise(e, d, t, 0.22, 0.03, 'bandpass', 1200, 6000, 2, 0.08, r() * 1.5);
    [88, 91, 95].forEach((m, k) => bell(e, d, N(m) * p, t + k * 0.04, 0.25, 0.045, 3, 0.6));
    bell(e, e.wet, N(95) * p, t + 0.08, 0.4, 0.03, 3, 0.6);
  },
  overlayOff(e, t, d, { p }) {
    [95, 91, 88].forEach((m, k) => bell(e, d, N(m) * p, t + k * 0.035, 0.18, 0.035, 3, 0.6));
  },
  /** inspect a building / lot: A6 ping */
  query(e, t, d, { p }) {
    tone(e, d, 'sine', N(93) * p, t, 0.1, 0.12, undefined, 0.002);
    tone(e, d, 'sine', N(81) * p, t, 0.05, 0.07, N(76) * p, 0.002);
    bell(e, e.wet, N(93) * p, t, 0.3, 0.03, 2, 1);
    noise(e, d, t, 0.008, 0.04, 'highpass', 5000, undefined, 1, 0.001, 0.8);
  },
  /** pause: tape-stop glide down */
  pause(e, t, d, { p }) {
    const lp = lowpass(e, d, 2200);
    tone(e, lp, 'triangle', N(79) * p, t, 0.2, 0.14, N(65) * p, 0.003);
    tone(e, lp, 'sine', N(67) * p, t + 0.01, 0.16, 0.08, N(55) * p);
  },
  /** normal speed / resume: one rising blip */
  speed1(e, t, d, { p }) {
    tone(e, d, 'triangle', N(79) * p, t, 0.1, 0.13, N(84) * p, 0.003);
    tone(e, e.wet, 'sine', N(84) * p, t + 0.05, 0.15, 0.03);
  },
  /** fast: two rising blips */
  speed2(e, t, d, { p }) {
    [84, 88].forEach((m, k) => tone(e, d, 'triangle', N(m) * p, t + k * 0.055, 0.07, 0.12));
    tone(e, e.wet, 'sine', N(88) * p, t + 0.055, 0.15, 0.03);
  },
  /** ultra: three quick rising blips */
  speed3(e, t, d, { p }) {
    [84, 88, 91].forEach((m, k) => tone(e, d, 'triangle', N(m) * p, t + k * 0.045, 0.06, 0.11));
    tone(e, e.wet, 'sine', N(91) * p, t + 0.09, 0.18, 0.035);
  },
  speed(e, t, d, v) {
    VOICES.speed2(e, t, d, v);
  },
  /** manual save: G5 + C6 chime */
  save(e, t, d, { p }) {
    bell(e, d, N(79) * p, t, 0.4, 0.06, 2, 0.8);
    bell(e, d, N(84) * p, t + 0.08, 0.55, 0.06, 2, 0.8);
    bell(e, e.wet, N(84) * p, t + 0.08, 0.7, 0.04, 2, 0.8);
  },
  /** autosave: barely-there chime */
  autosave(e, t, d, { p }) {
    bell(e, d, N(84) * p, t, 0.35, 0.03, 2, 0.6);
    bell(e, e.wet, N(91) * p, t + 0.06, 0.5, 0.015, 2, 0.6);
  },
  /** randomize / dice: rattle + G6 */
  shuffle(e, t, d, { p, r }) {
    const n = 6 + Math.floor(r() * 3);
    let tt = t;
    for (let k = 0; k < n; k++) {
      noise(e, d, tt, 0.012, 0.09 * (0.6 + r() * 0.4), 'bandpass', (2200 + r() * 2400) * p, undefined, 4, 0.001, r() * 1.5);
      tt += 0.022 + r() * 0.03;
    }
    tone(e, d, 'triangle', N(91) * p, tt + 0.02, 0.1, 0.08);
  },
  /** getting-started step done: C-E-G arpeggio */
  stepDone(e, t, d, { p }) {
    [84, 88, 91].forEach((m, k) => bell(e, d, N(m) * p, t + k * 0.07, 0.45, 0.05, 2, 0.9));
    bell(e, e.wet, N(96) * p, t + 0.21, 0.7, 0.03, 2, 0.9);
  },
  whoosh(e, t, d, { p, r }) {
    noise(e, d, t, 0.45, 0.1, 'bandpass', 300 * p, 2400 * p, 1.4, 0.2, r() * 1.5);
  },

  // ---------------------------------------------------------------- game actions
  /** invalid action: soft double buzz */
  error(e, t, d, { p }) {
    for (let k = 0; k < 2; k++) {
      const lp = lowpass(e, d, 900);
      tone(e, lp, 'square', 190 * p, t + k * 0.13, 0.1, 0.12);
      tone(e, lp, 'square', 196 * p, t + k * 0.13, 0.1, 0.1);
    }
  },
  /** zoning: painterly swish (random brush) */
  zone(e, t, d, { p, r, k }) {
    const a = 0.85 + r() * 0.3;
    noise(e, d, t, 0.14 + k * 0.08, 0.14, 'bandpass', 850 * p * a, 2600 * p * a, 2 + r(), 0.03, r() * 1.5);
    tone(e, d, 'sine', 680 * p * a, t, 0.08, 0.05, 1100 * p * a);
    if (r() < 0.2 + k * 0.5) noise(e, d, t + 0.06 + r() * 0.03, 0.12, 0.08, 'bandpass', 1200 * p * a, 3200 * p * a, 2.2, 0.03, r() * 1.5);
  },
  dezone(e, t, d, { p, r }) {
    const a = 0.85 + r() * 0.3;
    noise(e, d, t, 0.15, 0.12, 'bandpass', 2400 * p * a, 800 * p * a, 2.2, 0.02, r() * 1.5);
    tone(e, d, 'sine', 900 * p * a, t, 0.07, 0.035, 600 * p * a);
  },
  /** road / network: thud + gravel (+ roller hiss) */
  road(e, t, d, { p, r }) {
    const a = 0.9 + r() * 0.2;
    tone(e, d, 'sine', 115 * p * a, t, 0.16, 0.36, 46);
    noise(e, d, t, 0.2 + r() * 0.06, 0.16, 'lowpass', 1400 * a, 300, 0.7, 0.004, r() * 1.5);
    noise(e, d, t + 0.04 + r() * 0.03, 0.1, 0.06, 'bandpass', 2600 * a, 1400, 1.5, 0.004, r() * 1.5);
    if (r() > 0.5) noise(e, d, t + 0.09, 0.14, 0.025, 'highpass', 3000, undefined, 0.7, 0.03, r() * 1.5);
  },
  /** rail: two clangs (random pentatonic pair) + thud */
  rail(e, t, d, { p, r }) {
    const [a, b] = pick(r, [[72, 79], [74, 81], [76, 83]] as const);
    bell(e, d, N(a) * p, t, 0.25, 0.09, 2.76, 3);
    tone(e, d, 'sine', 90, t, 0.12, 0.25, 50);
    bell(e, d, N(b) * p, t + 0.08 + r() * 0.03, 0.2, 0.055, 2.76, 3);
    noise(e, d, t, 0.03, 0.05, 'bandpass', 3000, undefined, 3, 0.002, r() * 1.5);
  },
  /** power line: hum + zaps */
  power(e, t, d, { p, r }) {
    const lp = lowpass(e, d, 1600 + r() * 600);
    tone(e, lp, 'sawtooth', 60 * p, t, 0.25, 0.12);
    tone(e, lp, 'sawtooth', 120 * p, t, 0.2, 0.06);
    noise(e, d, t, 0.06, 0.1, 'highpass', 5000, undefined, 1, 0.004, r() * 1.5);
    noise(e, d, t + 0.07 + r() * 0.05, 0.04, 0.07, 'highpass', 6000, undefined, 1, 0.004, r() * 1.5);
  },
  pipe(e, t, d, { p, r }) {
    const a = 0.9 + r() * 0.2;
    tone(e, d, 'sine', 260 * p * a, t, 0.09, 0.2, 620 * p * a);
    tone(e, d, 'sine', 330 * p * a, t + 0.07 + r() * 0.03, 0.08, 0.14, 700 * p * a);
  },
  /** demolition: grainy rubble + rumble + random crackles (more for bigger jobs) */
  bulldoze(e, t, d, { p, r, k }) {
    noise(e, d, t, 0.45, 0.35, 'lowpass', 900 * p * (0.85 + r() * 0.3), 250, 0.8, 0.01, r() * 1.5);
    tone(e, d, 'sawtooth', 52 * p, t, 0.35, 0.12, 38);
    const n = 5 + Math.round(k * 5 + r() * 2);
    for (let i = 0; i < n; i++) noise(e, d, t + r() * 0.35, 0.03 + r() * 0.04, 0.12 + r() * 0.12, 'bandpass', 800 + r() * 2500, undefined, 3, 0.004, r() * 1.5);
  },
  /** building placed: thump + sparkle on a random pentatonic note */
  plop(e, t, d, { p, r }) {
    tone(e, d, 'sine', 420 * p, t, 0.12, 0.35, 140 * p);
    noise(e, d, t, 0.1, 0.12, 'lowpass', 1200, 300, 0.7, 0.004, r() * 1.5);
    bell(e, e.wet, N(96 + pick(r, [0, 2, 4, 7])) * p, t + 0.06, 0.4, 0.035, 2, 1.5);
  },
  terraform(e, t, d, { p, r }) {
    noise(e, d, t, 0.35, 0.2, 'lowpass', 400 * p * (0.85 + r() * 0.3), 150, 0.8, 0.05, r() * 1.5);
    tone(e, d, 'sine', 70 * p, t, 0.3, 0.2, 45);
  },
  /** trees: leafy rustle */
  tree(e, t, d, { p, r }) {
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) noise(e, d, t + i * 0.05 + r() * 0.03, 0.08, 0.06, 'highpass', 3500 * p * (0.85 + r() * 0.3), undefined, 1, 0.004, r() * 1.5);
    tone(e, d, 'sine', 300 * p, t, 0.08, 0.08, 200);
  },
  /** hammer tick */
  construct(e, t, d, { p, r }) {
    tone(e, d, 'sine', 760 * p, t, 0.035, 0.12, 500 * p);
    noise(e, d, t, 0.02, 0.1, 'bandpass', 2800 * p, undefined, 4, 0.004, r() * 1.5);
  },
  /** construction finished (very quiet): wood knock + tiny chime */
  built(e, t, d, { p, r }) {
    tone(e, d, 'sine', 640 * p, t, 0.03, 0.1, 440 * p, 0.001);
    noise(e, d, t, 0.012, 0.05, 'bandpass', 2600, undefined, 4, 0.001, r() * 1.5);
    bell(e, d, N(pick(r, [91, 93, 96])) * p, t + 0.05, 0.3, 0.022, 2, 0.8);
  },
  /** money action (loan, repay): register clink */
  cash(e, t, d, { p, r }) {
    noise(e, d, t, 0.05, 0.12, 'bandpass', 2500, undefined, 2, 0.004, r() * 1.5);
    bell(e, d, 1860 * p, t + 0.05, 0.6, 0.12, 1.41, 1.2);
    bell(e, d, 2480 * p, t + 0.09, 0.7, 0.1, 1.41, 1.2);
    bell(e, e.wet, 2480 * p, t + 0.09, 0.8, 0.05, 1.41, 1.2);
  },

  // ---------------------------------------------------------------- events
  notify(e, t, d, { p }) {
    bell(e, d, N(88) * p, t, 0.9, 0.09, 2, 0.8);
    bell(e, d, N(95) * p, t + 0.12, 1.1, 0.08, 2, 0.8);
    bell(e, e.wet, N(95) * p, t + 0.12, 1.3, 0.05, 2, 0.8);
  },
  news(e, t, d, { p }) {
    bell(e, d, N(91) * p, t, 0.5, 0.06, 2, 0.6);
    bell(e, e.wet, N(91) * p, t, 0.6, 0.03, 2, 0.6);
  },
  /** good news: G5 -> C6 mallets + sparkle */
  good(e, t, d, { p }) {
    mallet(e, d, N(79) * p, t, 0.35, 0.16);
    mallet(e, d, N(84) * p, t + 0.1, 0.5, 0.16);
    bell(e, e.wet, N(100) * p, t + 0.1, 0.6, 0.02, 2, 0.7);
  },
  /** warning: two A5 bell pulses */
  warning(e, t, d, { p }) {
    for (let k = 0; k < 2; k++) {
      bell(e, d, N(81) * p, t + k * 0.16, 0.3, 0.07, 1, 1.2);
      tone(e, d, 'triangle', N(81) * p, t + k * 0.16, 0.14, 0.09, undefined, 0.004);
    }
    bell(e, e.wet, N(81) * p, t + 0.16, 0.5, 0.03, 1, 1.2);
  },
  /** bad news: falling E5-C5-A4 (A minor), dark */
  bad(e, t, d, { p }) {
    const lp = lowpass(e, d, 1500);
    [76, 72, 69].forEach((m, k) => tone(e, lp, 'triangle', N(m) * p, t + k * 0.11, k === 2 ? 0.35 : 0.12, 0.15, undefined, 0.006));
    tone(e, e.wet, 'sine', N(69) * p, t + 0.22, 0.4, 0.03);
  },
  /** advisor message: G5 / E5 ding-dong */
  advisor(e, t, d, { p }) {
    mallet(e, d, N(79) * p, t, 0.4, 0.13);
    mallet(e, d, N(76) * p, t + 0.16, 0.55, 0.13);
    bell(e, e.wet, N(88) * p, t + 0.16, 0.6, 0.02, 2, 0.7);
  },
  /** monthly budget in the black: one soft coin */
  coin(e, t, d, { p, r }) {
    noise(e, d, t, 0.02, 0.05, 'bandpass', 3200, undefined, 3, 0.002, r() * 1.5);
    bell(e, d, 2480 * p, t + 0.01, 0.32, 0.05, 1.41, 1.1);
    bell(e, d, 3310 * p, t + 0.06 + r() * 0.02, 0.4, 0.04, 1.41, 1.1);
  },
  /** monthly budget in the red: gentle low A3 -> E3 */
  cashLow(e, t, d, { p }) {
    const lp = lowpass(e, d, 900);
    tone(e, lp, 'triangle', N(57) * p, t, 0.22, 0.16, undefined, 0.02);
    tone(e, lp, 'triangle', N(52) * p, t + 0.16, 0.34, 0.16, undefined, 0.02);
  },
  /** bankruptcy warning: A minor pulses falling to F */
  bankrupt(e, t, d, { p }) {
    const lp = lowpass(e, d, 1400);
    [[57, 60], [57, 60], [53, 57]].forEach(([a, b], k) => {
      const dur = k === 2 ? 0.5 : 0.16;
      tone(e, lp, 'sawtooth', N(a) * p, t + k * 0.22, dur, 0.07, undefined, 0.01);
      tone(e, lp, 'sawtooth', N(b) * p, t + k * 0.22, dur, 0.06, undefined, 0.01);
    });
    tone(e, e.wet, 'sine', N(57) * p, t + 0.44, 0.6, 0.03);
  },
  reward(e, t, d, { p }) {
    fanfare(e, t, d, p, [72, 76, 79, 84], 0.11, 1.2);
  },
  milestone(e, t, d, { p }) {
    fanfare(e, t, d, p, [67, 72, 76, 79, 84, 88], 0.1, 1.6);
    bell(e, e.wet, N(100) * p, t + 0.55, 1, 0.03, 2, 1);
  },
  /** city founded: big but short fanfare + boom */
  found(e, t, d, { p }) {
    tone(e, d, 'sine', 90, t, 0.5, 0.25, 45, 0.01);
    fanfare(e, t + 0.02, d, p, [60, 64, 67, 72, 76, 79, 84], 0.075, 1.5);
    [96, 100, 103].forEach((m, k) => bell(e, e.wet, N(m) * p, t + 0.5 + k * 0.06, 0.9, 0.025, 2, 1));
  },
  /** city loaded: soft C-major-7 swell */
  cityReady(e, t, d, { p }) {
    const lp = lowpass(e, d, 2600);
    [60, 64, 67, 71].forEach((m, k) => {
      const o = e.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = N(m) * p;
      const g = gainAt(e, lp);
      o.connect(g);
      const st = t + k * 0.05;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.05, st + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 1.3);
      o.start(st);
      o.stop(st + 1.35);
    });
    bell(e, d, N(88) * p, t + 0.22, 1, 0.05, 2, 0.8);
    bell(e, e.wet, N(95) * p, t + 0.3, 1.1, 0.03, 2, 0.8);
  },
  /** back to the region: airy swell + G5 / D6 */
  regionEnter(e, t, d, { p, r }) {
    noise(e, d, t, 0.6, 0.05, 'bandpass', 300, 1800, 0.9, 0.3, r() * 1.5);
    bell(e, d, N(79) * p, t + 0.2, 0.8, 0.045, 2, 0.8);
    bell(e, d, N(86) * p, t + 0.3, 0.9, 0.04, 2, 0.8);
    bell(e, e.wet, N(91) * p, t + 0.3, 1, 0.03, 2, 0.8);
  },
  /** generic disaster: wailing siren (2 cycles) */
  alarm(e, t, d, { p }) {
    const o = e.ctx.createOscillator();
    o.type = 'sawtooth';
    const lp = e.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;
    const g = gainAt(e, d);
    o.connect(lp).connect(g);
    const f0 = 560 * p, f1 = 980 * p;
    o.frequency.setValueAtTime(f0, t);
    for (let k = 0; k < 2; k++) {
      o.frequency.linearRampToValueAtTime(f1, t + k * 1.3 + 0.65);
      o.frequency.linearRampToValueAtTime(f0, t + k * 1.3 + 1.3);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.15);
    g.gain.setValueAtTime(0.13, t + 2.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
    o.start(t);
    o.stop(t + 2.8);
    const ws = gainAt(e, e.wet, 0.4);
    lp.connect(ws);
  },
  /** fire: ringing fire-station bell */
  fire(e, t, d, { p, r }) {
    const strokes = 16;
    for (let k = 0; k < strokes; k++) {
      const st = t + k * 0.075;
      const fade = k < strokes - 3 ? 1 : (strokes - k) / 4;
      bell(e, d, 1480 * p * (1 + (r() - 0.5) * 0.01), st, 0.3, 0.07 * fade, 1.47, 2.2);
    }
    bell(e, d, 1480 * p, t + strokes * 0.075, 0.6, 0.05, 1.47, 2.2);
    bell(e, e.wet, 1480 * p, t, 1.4, 0.03, 1.47, 2.2);
    noise(e, d, t, 0.06, 0.05, 'bandpass', 3000, undefined, 3, 0.002, r() * 1.5);
  },
  /** tornado: air-raid wail + wind */
  tornado(e, t, d, { p, r }) {
    const lp = lowpass(e, d, 1500);
    for (const det of [-8, 8]) {
      const o = e.ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = det;
      const g = gainAt(e, lp);
      o.connect(g);
      o.frequency.setValueAtTime(260 * p, t);
      o.frequency.exponentialRampToValueAtTime(620 * p, t + 1.1);
      o.frequency.setValueAtTime(620 * p, t + 1.5);
      o.frequency.exponentialRampToValueAtTime(330 * p, t + 2.6);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.5);
      g.gain.setValueAtTime(0.06, t + 1.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
      o.start(t);
      o.stop(t + 2.8);
    }
    lp.connect(gainAt(e, e.wet, 0.35));
    noise(e, d, t, 2.4, 0.12, 'bandpass', 250, 900, 0.8, 0.9, r() * 0.5);
  },
  /** earthquake: deep rumble + low two-tone alert */
  quake(e, t, d, { p, r }) {
    noise(e, d, t, 2.0, 0.5, 'lowpass', 160, 70, 1.2, 0.25, r() * 0.5);
    const o = e.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 38;
    const lfo = e.ctx.createOscillator();
    lfo.frequency.value = 7;
    const lg = e.ctx.createGain();
    lg.gain.value = 6;
    lfo.connect(lg).connect(o.frequency);
    const g = gainAt(e, d);
    o.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.start(t);
    lfo.start(t);
    o.stop(t + 2.3);
    lfo.stop(t + 2.3);
    const lp = lowpass(e, d, 1100);
    [0, 0.45].forEach((dt) => {
      tone(e, lp, 'triangle', N(57) * p, t + 0.3 + dt, 0.18, 0.1, undefined, 0.01);
      tone(e, lp, 'triangle', N(52) * p, t + 0.52 + dt, 0.2, 0.1, undefined, 0.01);
    });
    for (let k = 0; k < 6; k++) noise(e, d, t + 0.3 + r() * 1.4, 0.05 + r() * 0.05, 0.08, 'bandpass', 500 + r() * 1500, undefined, 3, 0.004, r() * 1.5);
  },
  /** meteor: falling whistle, then a boom and debris */
  meteor(e, t, d, { p, r }) {
    const o = e.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2600 * p, t);
    o.frequency.exponentialRampToValueAtTime(320 * p, t + 0.85);
    const g = gainAt(e, d);
    o.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.3);
    g.gain.linearRampToValueAtTime(0.1, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.start(t);
    o.stop(t + 0.95);
    noise(e, d, t, 0.85, 0.05, 'bandpass', 3000, 600, 2, 0.5, r() * 1.5);
    const tb = t + 0.85;
    tone(e, d, 'sine', 70, tb, 0.8, 0.55, 28, 0.004);
    noise(e, d, tb, 1.0, 0.45, 'lowpass', 1800, 120, 0.7, 0.004, r() * 0.5);
    noise(e, e.wet, tb, 1.2, 0.2, 'lowpass', 900, 100, 0.7, 0.004, r() * 0.5);
    for (let k = 0; k < 7; k++) noise(e, d, tb + 0.1 + r() * 0.8, 0.03 + r() * 0.05, 0.08 + r() * 0.08, 'bandpass', 900 + r() * 3000, undefined, 3, 0.004, r() * 1.5);
  },
};

function fanfare(e: SfxEnv, t: number, d: AudioNode, p: number, notes: number[], step: number, tail: number): void {
  const lp = e.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1200, t);
  lp.frequency.linearRampToValueAtTime(3200, t + notes.length * step);
  lp.frequency.exponentialRampToValueAtTime(900, t + notes.length * step + tail);
  lp.connect(d);
  const wet = gainAt(e, e.wet, 0.5);
  lp.connect(wet);
  notes.forEach((n, k) => {
    const st = t + k * step;
    const last = k === notes.length - 1;
    const dur = last ? tail : step * 2.2;
    for (const det of [-6, 6]) {
      const o = e.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = N(n) * p;
      o.detune.value = det;
      const g = gainAt(e, lp);
      o.connect(g);
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.06, st + 0.02);
      g.gain.setValueAtTime(0.06, st + dur * 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
      o.start(st);
      o.stop(st + dur + 0.05);
    }
    if (last) for (const c of [notes[0] + 12, notes[1] + 12]) bell(e, wet, N(c) * p, st, tail, 0.05, 2, 1);
  });
}

/** deterministic PRNG for exact plays (mulberry32) */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** linear gain of a sound's measured loudness trim (TRIM) */
export function soundTrim(name: SoundName): number {
  return Math.pow(10, (TRIM[name] ?? 0) / 20);
}

/**
 * Play one voice now into `dest` (dry) and env.wet (reverb). Applies the loudness trim, opts.volume and opts.pan
 * to both paths (pan on the dry path only - the reverb stays wide).
 */
export function playVoice(env: SfxEnv, name: SoundName, dest: AudioNode, opts: PlayOptions = {}): void {
  const voice = VOICES[name];
  if (!voice) return;
  const meta = META[name] as SoundMeta;
  const ctx = env.ctx;
  const t = ctx.currentTime + 0.005;
  const r = opts.exact ? seeded(hashName(name)) : Math.random;
  const jit = opts.exact ? 0 : (Math.random() - 0.5) * (meta.jitter ?? 0.04);
  const p = (opts.pitch ?? 1) * (1 + jit);
  const k = Math.max(0, Math.min(1, opts.intensity ?? 0.5));
  const level = soundTrim(name) * Math.max(0, Math.min(2, opts.volume ?? 1));
  const dry = ctx.createGain();
  dry.gain.value = level;
  const pan = opts.pan ? Math.max(-1, Math.min(1, opts.pan)) : 0;
  if (pan && typeof ctx.createStereoPanner === 'function') {
    const sp = ctx.createStereoPanner();
    sp.pan.value = pan;
    dry.connect(sp).connect(dest);
  } else dry.connect(dest);
  const wet = ctx.createGain();
  wet.gain.value = level;
  wet.connect(env.wet);
  voice({ ...env, wet }, t, dry, { p, r, k });
}
