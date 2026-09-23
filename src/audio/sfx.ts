/**
 * Procedural one-shot sound effects (WebAudio node graphs, no asset files).
 * Every sound is a small function (ctx, time, options) that builds and schedules a short-lived graph.
 */

export type SoundName =
  | 'click'
  | 'hover'
  | 'confirm'
  | 'cancel'
  | 'error'
  | 'open'
  | 'close'
  | 'toggle'
  | 'zone'
  | 'dezone'
  | 'road'
  | 'rail'
  | 'power'
  | 'pipe'
  | 'bulldoze'
  | 'plop'
  | 'terraform'
  | 'tree'
  | 'cash'
  | 'notify'
  | 'news'
  | 'reward'
  | 'milestone'
  | 'alarm'
  | 'construct'
  | 'whoosh'
  | 'speed'
  | 'pause';

export const SOUND_NAMES: SoundName[] = [
  'click', 'hover', 'confirm', 'cancel', 'error', 'open', 'close', 'toggle', 'zone', 'dezone', 'road', 'rail', 'power', 'pipe',
  'bulldoze', 'plop', 'terraform', 'tree', 'cash', 'notify', 'news', 'reward', 'milestone', 'alarm', 'construct', 'whoosh', 'speed', 'pause',
];

export interface PlayOptions {
  /** 0..2 linear gain multiplier (default 1) */
  volume?: number;
  /** -1 (left) .. 1 (right) */
  pan?: number;
  /** pitch multiplier (default 1, small random variation is added unless exact = true) */
  pitch?: number;
  exact?: boolean;
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

type Voice = (e: SfxEnv, t: number, dest: AudioNode, p: number) => void;

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

function noise(e: SfxEnv, dest: AudioNode, t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1?: number, q = 1, attack = 0.004): AudioBufferSourceNode {
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
  src.start(t, Math.random() * 1.5);
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

const N = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

// ------------------------------------------------------------------ voices
const VOICES: Record<SoundName, Voice> = {
  click(e, t, d, p) {
    tone(e, d, 'sine', 1500 * p, t, 0.05, 0.25, 700 * p);
    noise(e, d, t, 0.015, 0.08, 'highpass', 4000);
  },
  hover(e, t, d, p) {
    tone(e, d, 'sine', 2400 * p, t, 0.035, 0.05, 2000 * p, 0.004);
  },
  confirm(e, t, d, p) {
    tone(e, d, 'triangle', N(84) * p, t, 0.14, 0.18);
    tone(e, d, 'triangle', N(91) * p, t + 0.07, 0.22, 0.16);
    tone(e, e.wet, 'sine', N(91) * p, t + 0.07, 0.3, 0.06);
  },
  cancel(e, t, d, p) {
    tone(e, d, 'triangle', N(84) * p, t, 0.1, 0.14);
    tone(e, d, 'triangle', N(77) * p, t + 0.06, 0.16, 0.12);
  },
  error(e, t, d, p) {
    for (let k = 0; k < 2; k++) {
      const lp = e.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      lp.connect(d);
      tone(e, lp, 'square', 190 * p, t + k * 0.13, 0.1, 0.12);
      tone(e, lp, 'square', 196 * p, t + k * 0.13, 0.1, 0.1);
    }
  },
  open(e, t, d, p) {
    noise(e, d, t, 0.22, 0.07, 'bandpass', 600, 3000, 1.2, 0.08);
    tone(e, d, 'sine', N(88) * p, t + 0.05, 0.25, 0.07);
    tone(e, e.wet, 'sine', N(95) * p, t + 0.1, 0.3, 0.04);
  },
  close(e, t, d, p) {
    noise(e, d, t, 0.18, 0.06, 'bandpass', 2600, 500, 1.2, 0.03);
    tone(e, d, 'sine', N(83) * p, t, 0.15, 0.05, N(76) * p);
  },
  toggle(e, t, d, p) {
    tone(e, d, 'square', 900 * p, t, 0.02, 0.05);
    tone(e, d, 'sine', 1300 * p, t + 0.03, 0.05, 0.12);
  },
  zone(e, t, d, p) {
    // painterly swish
    noise(e, d, t, 0.16, 0.14, 'bandpass', 900 * p, 2600 * p, 2.2, 0.03);
    tone(e, d, 'sine', 700 * p, t, 0.08, 0.05, 1100 * p);
  },
  dezone(e, t, d, p) {
    noise(e, d, t, 0.15, 0.12, 'bandpass', 2400 * p, 800 * p, 2.2, 0.02);
  },
  road(e, t, d, p) {
    tone(e, d, 'sine', 110 * p, t, 0.18, 0.4, 45);
    noise(e, d, t, 0.22, 0.18, 'lowpass', 1400, 300, 0.7);
    noise(e, d, t + 0.05, 0.12, 0.06, 'bandpass', 3000, 1500, 1.5);
  },
  rail(e, t, d, p) {
    bell(e, d, 520 * p, t, 0.25, 0.1, 2.76, 3);
    tone(e, d, 'sine', 90, t, 0.12, 0.25, 50);
    bell(e, d, 780 * p, t + 0.09, 0.2, 0.06, 2.76, 3);
  },
  power(e, t, d, p) {
    const lp = e.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    lp.connect(d);
    tone(e, lp, 'sawtooth', 60 * p, t, 0.25, 0.12);
    tone(e, lp, 'sawtooth', 120 * p, t, 0.2, 0.06);
    noise(e, d, t, 0.06, 0.1, 'highpass', 5000);
    noise(e, d, t + 0.09, 0.04, 0.07, 'highpass', 6000);
  },
  pipe(e, t, d, p) {
    tone(e, d, 'sine', 260 * p, t, 0.09, 0.2, 620 * p);
    tone(e, d, 'sine', 330 * p, t + 0.08, 0.08, 0.14, 700 * p);
  },
  bulldoze(e, t, d, p) {
    // crunchy rubble: grainy low noise + rumble + random crackles
    noise(e, d, t, 0.45, 0.35, 'lowpass', 900 * p, 250, 0.8, 0.01);
    tone(e, d, 'sawtooth', 52 * p, t, 0.35, 0.12, 38);
    for (let k = 0; k < 7; k++) noise(e, d, t + Math.random() * 0.35, 0.03 + Math.random() * 0.04, 0.12 + Math.random() * 0.12, 'bandpass', 800 + Math.random() * 2500, undefined, 3);
  },
  plop(e, t, d, p) {
    tone(e, d, 'sine', 420 * p, t, 0.12, 0.35, 140 * p);
    noise(e, d, t, 0.1, 0.12, 'lowpass', 1200, 300);
    bell(e, e.wet, N(96) * p, t + 0.06, 0.4, 0.035, 2, 1.5);
  },
  terraform(e, t, d, p) {
    noise(e, d, t, 0.35, 0.2, 'lowpass', 400 * p, 150, 0.8, 0.05);
    tone(e, d, 'sine', 70 * p, t, 0.3, 0.2, 45);
  },
  tree(e, t, d, p) {
    for (let k = 0; k < 4; k++) noise(e, d, t + k * 0.05 + Math.random() * 0.03, 0.08, 0.06, 'highpass', 3500 * p);
    tone(e, d, 'sine', 300 * p, t, 0.08, 0.08, 200);
  },
  cash(e, t, d, p) {
    noise(e, d, t, 0.05, 0.12, 'bandpass', 2500, undefined, 2);
    bell(e, d, 1860 * p, t + 0.05, 0.6, 0.12, 1.41, 1.2);
    bell(e, d, 2480 * p, t + 0.09, 0.7, 0.1, 1.41, 1.2);
    bell(e, e.wet, 2480 * p, t + 0.09, 0.8, 0.05, 1.41, 1.2);
  },
  notify(e, t, d, p) {
    bell(e, d, N(88) * p, t, 0.9, 0.09, 2, 0.8);
    bell(e, d, N(95) * p, t + 0.12, 1.1, 0.08, 2, 0.8);
    bell(e, e.wet, N(95) * p, t + 0.12, 1.3, 0.05, 2, 0.8);
  },
  news(e, t, d, p) {
    bell(e, d, N(91) * p, t, 0.5, 0.06, 2, 0.6);
    bell(e, e.wet, N(91) * p, t, 0.6, 0.03, 2, 0.6);
  },
  reward(e, t, d, p) {
    fanfare(e, t, d, p, [72, 76, 79, 84], 0.11, 1.2);
  },
  milestone(e, t, d, p) {
    fanfare(e, t, d, p, [67, 72, 76, 79, 84, 88], 0.1, 1.8);
  },
  alarm(e, t, d, p) {
    // wailing siren (2 cycles) + low klaxon
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
  construct(e, t, d, p) {
    // hammer tick: wood knock + metallic click
    tone(e, d, 'sine', 760 * p, t, 0.035, 0.12, 500 * p);
    noise(e, d, t, 0.02, 0.1, 'bandpass', 2800 * p, undefined, 4);
  },
  whoosh(e, t, d, p) {
    noise(e, d, t, 0.45, 0.1, 'bandpass', 300 * p, 2400 * p, 1.4, 0.2);
  },
  speed(e, t, d, p) {
    tone(e, d, 'square', 1100 * p, t, 0.02, 0.05);
    tone(e, d, 'square', 1650 * p, t + 0.06, 0.02, 0.05);
  },
  pause(e, t, d, p) {
    tone(e, d, 'sine', 900 * p, t, 0.08, 0.12, 500 * p);
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

export function playVoice(env: SfxEnv, name: SoundName, dest: AudioNode, opts: PlayOptions = {}): void {
  const v = VOICES[name];
  if (!v) return;
  const t = env.ctx.currentTime + 0.005;
  const p = (opts.pitch ?? 1) * (opts.exact ? 1 : 1 + (Math.random() - 0.5) * 0.04);
  v(env, t, dest, p);
}
