/**
 * Instrument library for the procedural soundtrack.
 *
 * Every note builds a tiny short-lived graph (oscillators / noise / KS-buffer source -> filter -> envelope gain) that
 * feeds a long-lived per-instrument CHANNEL (hp -> eq -> lp -> fader -> panner, with post-fader reverb + tempo-synced
 * ping-pong delay sends). Channels, LFOs and shared filters are created lazily once per Instruments instance (= one
 * song play) and live until dispose().
 *
 * Conventions (all instruments):
 *   pitched:  inst.NAME(time, midi, dur, vel, opts?)     time = absolute ctx seconds, dur = key-held seconds
 *   chordal:  inst.pad / strings / brass / organ accept midi | midi[]
 *   drums:    inst.NAME(time, vel, opts?)
 *   vel 0..1 (perceptual: amplitude ~ vel^1.5, and brightness follows velocity)
 *   opts.ch   route to a separate channel 'NAME:variant' (own mix settings), e.g. { ch: 'epiano:lead' }
 *   opts.pan  per-note pan (-1..1) - costs one extra node; channel pan is free
 * Every envelope starts and ends at exactly 0 (click-free). Levels are calibrated so a typical part at vel ~0.7
 * sits well in a -18 LUFS mix at channel level 1 (see COMPOSER GUIDE in the lab / director docs).
 */
import { RNG, hashString } from '../../core/rng';

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
/** perceptual velocity -> amplitude */
const vc = (v: number): number => Math.pow(clamp(v, 0, 1), 1.5);

export type InstrumentName =
  | 'epiano' | 'piano' | 'guitar' | 'harp' | 'clav' | 'pad' | 'strings' | 'pizz' | 'organ'
  | 'bass' | 'upright' | 'slap' | 'synthBass'
  | 'marimba' | 'vibes' | 'bell' | 'glass' | 'flute' | 'whistle' | 'lead' | 'arp' | 'brass'
  | 'kick' | 'snare' | 'rim' | 'clap' | 'hat' | 'shaker' | 'brush' | 'tom' | 'triangle' | 'ride' | 'cymbal' | 'conga' | 'sweep'
  | 'vinyl';

export interface MixSettings {
  /** channel fader, linear (1 = calibrated default) */
  level?: number;
  /** -1..1 */
  pan?: number;
  /** reverb send 0..1 */
  reverb?: number;
  /** tempo-synced delay send 0..1 */
  delay?: number;
  /** channel lowpass / highpass cutoff in Hz */
  lowpass?: number;
  highpass?: number;
  /** tremolo / auto-pan depth 0..1 (epiano auto-pan, vibes motor, organ leslie) and rate in Hz */
  tremolo?: number;
  tremoloRate?: number;
}

type EqBand = readonly [BiquadFilterType, number, number, number]; // type, freq, Q, gain dB
interface ChanDef {
  level: number;
  pan: number;
  reverb: number;
  delay?: number;
  hp?: number;
  lp?: number;
  eq?: readonly EqBand[];
  trem?: { kind: 'amp' | 'pan' | 'both'; depth: number; rate: number };
}

const DEFS: Record<InstrumentName, ChanDef> = {
  epiano: { level: 1, pan: 0, reverb: 0.22, delay: 0.1, hp: 55, lp: 9000, trem: { kind: 'pan', depth: 0.3, rate: 3.1 } },
  piano: { level: 1, pan: 0, reverb: 0.28, hp: 35, lp: 12000 },
  guitar: { level: 1, pan: -0.22, reverb: 0.22, hp: 75, eq: [['peaking', 115, 1.1, 3], ['peaking', 2600, 0.9, 2]] },
  harp: { level: 1, pan: 0.18, reverb: 0.4, hp: 60 },
  clav: { level: 1, pan: 0.15, reverb: 0.08, hp: 140, eq: [['peaking', 1800, 1, 3]] },
  pad: { level: 1, pan: 0, reverb: 0.45, hp: 90, lp: 12000 },
  strings: { level: 1, pan: 0, reverb: 0.42, hp: 140, lp: 10000, eq: [['peaking', 400, 1, -2]] },
  pizz: { level: 1, pan: -0.2, reverb: 0.35, hp: 70 },
  organ: { level: 1, pan: 0, reverb: 0.18, hp: 50, lp: 7500, trem: { kind: 'both', depth: 0.22, rate: 5.8 } },
  bass: { level: 1, pan: 0, reverb: 0.02, hp: 28, lp: 5000 },
  upright: { level: 1, pan: 0, reverb: 0.06, hp: 30, eq: [['peaking', 90, 1, 2]] },
  slap: { level: 1, pan: 0, reverb: 0.05, hp: 32 },
  synthBass: { level: 1, pan: 0, reverb: 0.03, hp: 28 },
  marimba: { level: 1, pan: 0.12, reverb: 0.3, hp: 80 },
  vibes: { level: 1, pan: -0.15, reverb: 0.35, hp: 90, trem: { kind: 'amp', depth: 0.3, rate: 5.4 } },
  bell: { level: 1, pan: 0.2, reverb: 0.45, delay: 0.12, hp: 200 },
  glass: { level: 1, pan: -0.2, reverb: 0.5, hp: 200 },
  flute: { level: 1, pan: 0.05, reverb: 0.35, delay: 0.08, hp: 150 },
  whistle: { level: 1, pan: -0.05, reverb: 0.4, delay: 0.1, hp: 250 },
  lead: { level: 1, pan: 0, reverb: 0.22, delay: 0.18, hp: 120 },
  arp: { level: 1, pan: 0.1, reverb: 0.22, delay: 0.3, hp: 150 },
  brass: { level: 1, pan: 0, reverb: 0.22, hp: 110 },
  kick: { level: 1, pan: 0, reverb: 0.03, hp: 25 },
  snare: { level: 1, pan: 0.04, reverb: 0.18, hp: 90 },
  rim: { level: 1, pan: 0.12, reverb: 0.2, hp: 300 },
  clap: { level: 1, pan: 0, reverb: 0.3, hp: 300 },
  hat: { level: 1, pan: 0.28, reverb: 0.07, hp: 6500, eq: [['peaking', 10000, 1.2, 4]] },
  shaker: { level: 1, pan: -0.3, reverb: 0.12, hp: 3200, eq: [['peaking', 7000, 1.4, 4]] },
  brush: { level: 1, pan: 0.06, reverb: 0.2, hp: 900, lp: 9000, eq: [['peaking', 3500, 0.8, 3]] },
  tom: { level: 1, pan: 0, reverb: 0.2, hp: 50 },
  triangle: { level: 1, pan: 0.4, reverb: 0.35, hp: 2000 },
  ride: { level: 1, pan: -0.32, reverb: 0.15, hp: 2500 },
  cymbal: { level: 1, pan: -0.15, reverb: 0.35, hp: 3500, lp: 15000 },
  conga: { level: 1, pan: 0.22, reverb: 0.18, hp: 80 },
  sweep: { level: 1, pan: 0, reverb: 0.4, delay: 0.15, hp: 150 },
  vinyl: { level: 1, pan: 0, reverb: 0, hp: 400, lp: 9000 },
};

// ------------------------------------------------------------------ envelope
/** [time offset from note start, value, curve] */
type Seg = readonly [number, number, ('lin' | 'exp')?];

/**
 * Breakpoint envelope that starts at 0 at t, follows segs (relative times), holds the last value, then releases
 * at tRel over rel seconds (exponential to -60 dB, then linear to exactly 0). If tRel falls inside a segment the
 * value at tRel is computed analytically, so the release starts without a jump. Returns the time the envelope is 0.
 */
function env(p: AudioParam, t: number, segs: readonly Seg[], tRel: number, rel: number): number {
  p.setValueAtTime(0, t);
  let pt = t, pv = 0, cut = false;
  for (const [dt, v, c] of segs) {
    const st = t + dt;
    const isExp = c === 'exp' && pv > 0;
    const tv = isExp ? Math.max(v, 1e-5) : v;
    if (st > tRel) {
      const f = (tRel - pt) / (st - pt);
      const vr = isExp ? pv * Math.pow(tv / pv, f) : pv + (tv - pv) * f;
      if (tRel > pt) {
        if (isExp) p.exponentialRampToValueAtTime(Math.max(vr, 1e-5), tRel);
        else p.linearRampToValueAtTime(vr, tRel);
      }
      pv = vr;
      pt = tRel;
      cut = true;
      break;
    }
    if (isExp) p.exponentialRampToValueAtTime(tv, st);
    else p.linearRampToValueAtTime(tv, st);
    pt = st;
    pv = tv;
  }
  if (!cut && tRel > pt) p.setValueAtTime(pv, tRel);
  const end = Math.max(tRel, pt) + rel;
  if (pv > 2e-5) p.exponentialRampToValueAtTime(Math.max(pv * 1e-3, 1e-6), end);
  p.linearRampToValueAtTime(0, end + 0.006);
  return end + 0.012;
}

// ------------------------------------------------------------------ Karplus-Strong buffers (rendered in JS, cached)
interface KSParams {
  /** T60 of the fundamental (s) */
  t60: number;
  /** excitation brightness 0..1 */
  bright: number;
  /** pick position 0..0.5 (comb notch; small = thin/nasal) */
  pick: number;
  /** loop lowpass 0 (bright, long highs) .. 0.5 (dark, classic KS) */
  damp: number;
  /** max buffer length (s) */
  maxLen: number;
}
const ksCache = new Map<string, { buf: AudioBuffer; f0: number }>();

function ksBuffer(ctx: BaseAudioContext, kind: string, m: number, p: KSParams): { buf: AudioBuffer; f0: number } {
  const sr = ctx.sampleRate;
  const mi = Math.round(m);
  const key = `${kind}:${sr}:${mi}`;
  const hit = ksCache.get(key);
  if (hit) return hit;
  const f = mtof(mi);
  const s = clamp(p.damp, 0.02, 0.5);
  const N = Math.max(4, Math.round(sr / f - s));
  const f0 = sr / (N + s);
  const w = (2 * Math.PI * f0) / sr;
  const hMag = Math.sqrt((1 - s) * (1 - s) + s * s + 2 * s * (1 - s) * Math.cos(w));
  const g = Math.min(0.99995, Math.pow(1e-3, 1 / (f0 * p.t60)) / hMag);
  const len = Math.floor(sr * Math.min(p.maxLen, p.t60 * 0.9 + 0.1));
  const out = new Float32Array(len);
  const rng = new RNG(hashString(key));
  // excitation: filtered noise with pick-position comb, zero-mean, normalised
  const ex = new Float32Array(N);
  let y1 = 0, y2 = 0;
  const k = 0.04 + 0.96 * p.bright * p.bright;
  for (let i = 0; i < N * 3; i++) {
    const x = rng.next() * 2 - 1;
    y1 += k * (x - y1);
    y2 += k * (y1 - y2);
    if (i >= N * 2) ex[i - N * 2] = p.bright > 0.7 ? y1 : y2;
  }
  const P = Math.max(1, Math.round(p.pick * N));
  const ex2 = new Float32Array(N);
  let mean = 0;
  for (let i = 0; i < N; i++) {
    ex2[i] = ex[i] - ex[(i - P + N) % N];
    mean += ex2[i];
  }
  mean /= N;
  let mx = 1e-9;
  for (let i = 0; i < N; i++) {
    ex2[i] -= mean;
    mx = Math.max(mx, Math.abs(ex2[i]));
  }
  for (let i = 0; i < Math.min(N, len); i++) out[i] = ex2[i] / mx;
  for (let i = N; i < len; i++) out[i] = g * ((1 - s) * out[i - N] + s * (i - N - 1 >= 0 ? out[i - N - 1] : 0));
  // DC blocker + fade out tail
  let xm1 = 0, ym1 = 0, peak = 1e-9;
  for (let i = 0; i < len; i++) {
    const x = out[i];
    const y = x - xm1 + 0.995 * ym1;
    xm1 = x;
    ym1 = y;
    out[i] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  const fade = Math.min(len, Math.floor(sr * 0.08));
  for (let i = 0; i < len; i++) {
    let v = out[i] / peak;
    if (i > len - fade) v *= (len - i) / fade;
    out[i] = v;
  }
  const buf = ctx.createBuffer(1, len, sr);
  buf.copyToChannel(out, 0);
  if (ksCache.size > 240) ksCache.delete(ksCache.keys().next().value as string);
  const r = { buf, f0 };
  ksCache.set(key, r);
  return r;
}

// vinyl crackle loop (4 s stereo), deterministic
const crackleCache = new Map<number, AudioBuffer>();
function crackleBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const hit = crackleCache.get(sr);
  if (hit) return hit;
  const len = sr * 4;
  const buf = ctx.createBuffer(2, len, sr);
  const rng = new RNG(4242);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0, hpx = 0, hpy = 0;
    for (let i = 0; i < len; i++) {
      // soft hiss
      lp += 0.35 * ((rng.next() * 2 - 1) * 0.05 - lp);
      let v = lp;
      // crackles: ~14 /s small, ~0.6 /s big
      const r = rng.next();
      if (r < 14 / sr) v += (rng.next() * 2 - 1) * (0.05 + 0.12 * rng.next());
      else if (r < 14.6 / sr) v += (rng.next() < 0.5 ? -1 : 1) * (0.18 + 0.2 * rng.next());
      const y = v - hpx + 0.97 * hpy;
      hpx = v;
      hpy = y;
      d[i] = y;
    }
    // smooth the loop seam
    const f = Math.floor(sr * 0.02);
    for (let i = 0; i < f; i++) {
      const a = i / f;
      d[i] = d[i] * a + d[len - f + i] * (1 - a);
    }
  }
  crackleCache.set(sr, buf);
  return buf;
}

// ------------------------------------------------------------------ channel
export class Channel {
  readonly input: GainNode;
  private hp: BiquadFilterNode;
  private lp: BiquadFilterNode;
  private fader: GainNode;
  private panner: StereoPannerNode;
  private rev: GainNode;
  private dly: GainNode | null = null;
  private tremGain: GainNode | null = null;
  private tremLfo: OscillatorNode | null = null;
  private level: number;
  private tremDepth = 0;
  private tremKind: 'amp' | 'pan' | 'both' = 'amp';
  private basePan: number;

  constructor(private inst: Instruments, def: ChanDef) {
    const n = inst.node;
    this.input = n.gain(1);
    this.hp = n.filter('highpass', def.hp ?? 20, 0.707);
    this.lp = n.filter('lowpass', def.lp ?? 20000, 0.707);
    this.fader = n.gain(def.level);
    this.panner = n.panner(def.pan);
    this.level = def.level;
    this.basePan = def.pan;
    let x: AudioNode = this.input.connect(this.hp);
    for (const [type, f, q, g] of def.eq ?? []) {
      const b = n.filter(type, f, q);
      b.gain.value = g;
      x = x.connect(b);
    }
    x.connect(this.lp).connect(this.fader).connect(this.panner).connect(inst.out);
    this.rev = n.gain(def.reverb);
    this.panner.connect(this.rev).connect(inst.reverb);
    if (def.delay) this.setDelay(def.delay);
    if (def.trem) {
      this.tremKind = def.trem.kind;
      this.tremLfo = inst.lfoNode(def.trem.rate);
      this.tremGain = n.gain(0);
      this.tremLfo.connect(this.tremGain);
      if (this.tremKind !== 'pan') this.tremGain.connect(this.fader.gain);
      this.tremDepth = def.trem.depth;
      this.applyLevel(null);
    }
  }

  private setDelay(v: number, at: number | null = null): void {
    if (!this.dly) {
      if (v <= 0) return;
      this.dly = this.inst.node.gain(0);
      this.panner.connect(this.dly).connect(this.inst.delayInput());
    }
    set(this.dly.gain, v, at);
  }

  private applyLevel(at: number | null): void {
    const d = this.tremDepth;
    if (this.tremGain && this.tremKind !== 'pan') {
      set(this.fader.gain, this.level * (1 - d * 0.5), at);
      set(this.tremGain.gain, this.level * d * 0.5, at);
    } else set(this.fader.gain, this.level, at);
    if (this.tremGain && this.tremKind !== 'amp') {
      // auto-pan: a second gain drives the panner (created on demand)
      if (!this.panLfoGain) {
        this.panLfoGain = this.inst.node.gain(0);
        this.tremLfo!.connect(this.panLfoGain).connect(this.panner.pan);
      }
      set(this.panLfoGain.gain, d * 0.6, at);
    }
  }
  private panLfoGain: GainNode | null = null;

  mix(s: MixSettings, at: number | null): void {
    if (s.level !== undefined) this.level = s.level;
    if (s.tremolo !== undefined) this.tremDepth = s.tremolo;
    if (s.level !== undefined || s.tremolo !== undefined) this.applyLevel(at);
    if (s.tremoloRate !== undefined && this.tremLfo) set(this.tremLfo.frequency, s.tremoloRate, at);
    if (s.pan !== undefined) {
      this.basePan = s.pan;
      set(this.panner.pan, clamp(s.pan, -1, 1), at);
    }
    if (s.reverb !== undefined) set(this.rev.gain, s.reverb, at);
    if (s.delay !== undefined) this.setDelay(s.delay, at);
    if (s.lowpass !== undefined) set(this.lp.frequency, clamp(s.lowpass, 30, 20000), at);
    if (s.highpass !== undefined) set(this.hp.frequency, clamp(s.highpass, 10, 16000), at);
  }
}

function kRate(...ps: AudioParam[]): void {
  for (const p of ps) {
    try {
      p.automationRate = 'k-rate';
    } catch {
      /* not supported / fixed rate */
    }
  }
}

function set(p: AudioParam, v: number, at: number | null): void {
  if (at === null) p.value = v;
  else p.setTargetAtTime(v, at, 0.06);
}

// ------------------------------------------------------------------ option types
export interface NoteOpts {
  /** route to channel 'NAME:variant' (separately mixable) */
  ch?: string;
  /** per-note pan -1..1 (one extra node) */
  pan?: number;
}
export interface KeyOpts extends NoteOpts {
  /** timbre brightness 0..1 (default 0.5) */
  bright?: number;
}
export interface PadOpts extends NoteOpts {
  /** attack / release seconds (pad default 1.2 / 1.8, strings 0.5-0.25*vel / 0.9) */
  attack?: number;
  release?: number;
  /** filter cutoff Hz at full velocity (pad default 2200, strings 5000) */
  cutoff?: number;
  /** oscillator: 'saw' (default), 'tri' (soft), 'square' (hollow) */
  wave?: 'saw' | 'tri' | 'square';
  /** detune spread in cents between the L/R voices (default 9) */
  detune?: number;
}
export interface GlideOpts extends NoteOpts {
  /** portamento: start at this midi note and glide to the target */
  glideFrom?: number;
  /** glide time (s), default 0.06 */
  glideTime?: number;
}
export interface LeadOpts extends GlideOpts {
  wave?: 'saw' | 'square' | 'tri' | 'sine';
  /** filter cutoff Hz (default 2400; opens with velocity) */
  cutoff?: number;
  /** filter resonance Q (default 2) */
  reso?: number;
  /** unison detune cents (default 8, 0 = single oscillator) */
  detune?: number;
  /** vibrato depth cents (default 0 for lead; delayed onset) */
  vibrato?: number;
}
export interface FluteOpts extends GlideOpts {
  /** vibrato depth cents (flute 14, whistle 22) */
  vibrato?: number;
  /** breath noise amount 0..1 (flute 0.5, whistle 0.15) */
  breath?: number;
}
export interface SynthBassOpts extends GlideOpts {
  wave?: 'saw' | 'square';
  /** base cutoff Hz (default 380) and resonance Q (default 5) */
  cutoff?: number;
  reso?: number;
  /** filter-envelope amount 0..1 (default 0.6) and decay seconds (default 0.18) */
  envAmt?: number;
  decay?: number;
}
export interface ArpOpts extends NoteOpts {
  wave?: 'saw' | 'square';
  cutoff?: number;
  /** pluck decay seconds (default 0.22) */
  decay?: number;
}
export interface OrganOpts extends NoteOpts {
  /** drawbar preset */
  drawbars?: 'jazz' | 'gospel' | 'soft' | 'full';
}
export interface BellOpts extends NoteOpts {
  /** FM ratio (bell 3.5 = church-ish, 1.4 = gong-ish, 5.0 = glassy) */
  ratio?: number;
  /** ring time in seconds (default max(dur, 2.5)) */
  ring?: number;
}
export interface MalletOpts extends NoteOpts {
  /** vibes: let ring past dur (sustain pedal) */
  pedal?: boolean;
}
export interface KickOpts extends NoteOpts {
  /** fundamental Hz (default 52) */
  tune?: number;
  /** decay seconds (default 0.42) */
  decay?: number;
  /** beater click amount 0..1 (default 0.5) */
  click?: number;
}
export interface SnareOpts extends NoteOpts {
  /** body pitch Hz (default 185) */
  tone?: number;
  /** snare-wire noise amount 0..1 (default 0.75) */
  snappy?: number;
  /** noise decay seconds (default 0.14 + 0.1*vel) */
  decay?: number;
}
export interface HatOpts extends NoteOpts {
  /** open hat: ring this many seconds, then choke (default closed) */
  open?: number;
  /** closed-hat decay seconds (default 0.045 + 0.03*vel) */
  decay?: number;
}

export interface InstrumentsOptions {
  bpm: number;
  /** real-time context: drop notes that are already in the past (tab throttling) instead of bursting them */
  live: boolean;
  /** seed for instrument-internal randomness (noise offsets, micro detune) */
  seed?: number;
  /** offline excerpt rendering: skip notes that end before this time */
  skipBefore?: number;
  /** keep per-second node counts (lab) */
  stats?: boolean;
}

export interface InstrumentStats {
  notes: number;
  nodes: number;
  /** nodes created per second of song time (index = floor(time)); only with opts.stats */
  perSec: number[];
  notesPerSec: number[];
}

type OscWave = OscillatorType | PeriodicWave;

// ------------------------------------------------------------------ Instruments
export class Instruments {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  readonly reverb: AudioNode;
  readonly noise: AudioBuffer;
  readonly stats: InstrumentStats = { notes: 0, nodes: 0, perSec: [], notesPerSec: [] };
  bpm: number;
  /** notes starting at or after this time are dropped (set by the director when a song is faded out) */
  cutoff = Infinity;
  private live: boolean;
  private skipBefore: number;
  private recordStats: boolean;
  private rng: RNG;
  private nyq: number;
  private channels = new Map<string, Channel>();
  private sharedNodes = new Map<string, AudioNode>();
  private lfos = new Map<string, OscillatorNode>();
  private allLfos: OscillatorNode[] = [];
  private loops: AudioScheduledSourceNode[] = [];
  private waves = new Map<string, PeriodicWave>();
  private delay: { input: GainNode; dl: DelayNode; dr: DelayNode; fb: GainNode; lp: BiquadFilterNode; ret: GainNode } | null = null;
  private delayCfg = { beats: 0.75, feedback: 0.34, tone: 3200, level: 1 };
  private disposed = false;
  private nowT = 0;

  constructor(ctx: BaseAudioContext, out: AudioNode, reverb: AudioNode, noise: AudioBuffer, o: InstrumentsOptions) {
    this.ctx = ctx;
    this.out = out;
    this.reverb = reverb;
    this.noise = noise;
    this.bpm = o.bpm;
    this.live = o.live;
    this.skipBefore = o.skipBefore ?? -Infinity;
    this.recordStats = !!o.stats;
    this.rng = new RNG((o.seed ?? 1) ^ 0x5bd1e995);
    this.nyq = ctx.sampleRate * 0.45;
  }

  // ---------------------------------------------------------------- node factory (counted)
  /** @internal low-level node constructors (counted in stats.nodes) */
  readonly node = {
    gain: (v = 0): GainNode => {
      this.count();
      const g = this.ctx.createGain();
      g.gain.value = v;
      return g;
    },
    filter: (type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode => {
      this.count();
      const b = this.ctx.createBiquadFilter();
      // k-rate: coefficients are recomputed once per 128-sample block instead of per sample while automated
      kRate(b.frequency, b.detune, b.Q, b.gain);
      b.type = type;
      b.frequency.value = Math.min(f, this.nyq);
      b.Q.value = q;
      return b;
    },
    panner: (p = 0): StereoPannerNode => {
      this.count();
      const s = this.ctx.createStereoPanner();
      kRate(s.pan);
      s.pan.value = clamp(p, -1, 1);
      return s;
    },
  };

  private count(): void {
    this.stats.nodes++;
    if (this.recordStats) {
      const s = Math.max(0, Math.floor(this.nowT));
      this.stats.perSec[s] = (this.stats.perSec[s] ?? 0) + 1;
    }
  }

  /** oscillator; frequency/detune are k-rate (cheap) unless `fm` (an audio-rate modulator feeds its frequency) */
  private osc(w: OscWave, f: number, t: number, end: number, fm = false): OscillatorNode {
    this.count();
    const o = this.ctx.createOscillator();
    if (!fm) kRate(o.frequency, o.detune);
    if (typeof w === 'string') o.type = w as OscillatorType;
    else o.setPeriodicWave(w);
    o.frequency.value = Math.min(f, this.nyq);
    o.start(t);
    o.stop(end);
    return o;
  }

  private noiseSrc(t: number, end: number, rate = 1): AudioBufferSourceNode {
    this.count();
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(t, this.rng.next() * (this.noise.duration - 0.05));
    s.stop(end);
    return s;
  }

  private bufSrc(buf: AudioBuffer, t: number, end: number, rate: number): AudioBufferSourceNode {
    this.count();
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    s.start(t);
    s.stop(Math.min(end, t + buf.duration / rate + 0.01));
    return s;
  }

  /** lab / debugging: drop notes of these instruments (mute) or of all others (solo) */
  readonly mute = new Set<string>();
  readonly solo = new Set<string>();

  /** gate every note: returns false to drop it */
  private go(name: string, t: number, len: number, ch?: string): boolean {
    if (this.disposed || t >= this.cutoff || !isFinite(t)) return false;
    if (this.mute.size || this.solo.size) {
      const key = ch ? `${name}:${ch}` : name;
      if (this.mute.has(name) || this.mute.has(key) || (this.solo.size && !this.solo.has(name) && !this.solo.has(key))) return false;
    }
    if (this.live && t < this.ctx.currentTime) return false;
    if (t + len < this.skipBefore) return false;
    this.nowT = t;
    this.stats.notes++;
    if (this.recordStats) {
      const s = Math.max(0, Math.floor(t));
      this.stats.notesPerSec[s] = (this.stats.notesPerSec[s] ?? 0) + 1;
    }
    return true;
  }

  /** shared long-lived oscillator LFO (created on first use) */
  lfoNode(rate: number, type: OscillatorType = 'sine'): OscillatorNode {
    this.count();
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = rate;
    o.start(this.ctx.currentTime);
    this.allLfos.push(o);
    return o;
  }

  private lfo(key: string, rate: number, depth: number): GainNode {
    let g = this.sharedNodes.get(`lfo:${key}`) as GainNode | undefined;
    if (!g) {
      const o = this.lfoNode(rate);
      this.lfos.set(key, o);
      g = this.node.gain(depth);
      o.connect(g);
      this.sharedNodes.set(`lfo:${key}`, g);
    }
    return g;
  }

  /** connect a shared LFO to a short-lived param and disconnect it when `src` ends (avoids leaks) */
  private modulate(lfo: AudioNode, param: AudioParam, src: AudioScheduledSourceNode): void {
    lfo.connect(param);
    src.addEventListener('ended', () => {
      try {
        lfo.disconnect(param);
      } catch {
        /* already gone */
      }
    });
  }

  /** like modulate() but for a node input (per-note depth gain fed by a shared LFO) */
  private modulateNode(lfo: AudioNode, dest: AudioNode, src: AudioScheduledSourceNode): void {
    lfo.connect(dest);
    src.addEventListener('ended', () => {
      try {
        lfo.disconnect(dest);
      } catch {
        /* already gone */
      }
    });
  }

  private shared<T extends AudioNode>(key: string, make: () => T): T {
    let n = this.sharedNodes.get(key) as T | undefined;
    if (!n) {
      n = make();
      this.sharedNodes.set(key, n);
    }
    return n;
  }

  /** channel for an instrument (lazily created); name may be 'epiano' or a variant 'epiano:lead' */
  channel(name: string): Channel {
    let c = this.channels.get(name);
    if (!c) {
      const base = name.split(':')[0] as InstrumentName;
      c = new Channel(this, DEFS[base] ?? DEFS.pad);
      this.channels.set(name, c);
    }
    return c;
  }

  private chIn(base: InstrumentName, o?: NoteOpts): GainNode {
    return this.channel(o?.ch ? (o.ch.includes(':') ? o.ch : `${base}:${o.ch}`) : base).input;
  }

  /** route a note's output to its channel (optionally via a per-note panner) */
  private route(n: AudioNode, base: InstrumentName, o?: NoteOpts): void {
    const dest = this.chIn(base, o);
    if (o?.pan !== undefined) n.connect(this.node.panner(o.pan)).connect(dest);
    else n.connect(dest);
  }

  /**
   * Mix a channel: inst.mix('pad', { level: 0.8, lowpass: 1800, reverb: 0.5 }). With `at` the change glides in
   * smoothly from that time (automation); without it the value is set immediately (use at song start).
   */
  mix(name: InstrumentName | string, s: MixSettings, at?: number): void {
    this.channel(name).mix(s, at === undefined ? null : at);
  }

  /** tempo-synced ping-pong delay: beats (0.75 = dotted 8th), feedback 0..0.9, tone = lowpass Hz, level = return gain */
  setDelay(o: { beats?: number; feedback?: number; tone?: number; level?: number }): void {
    Object.assign(this.delayCfg, o);
    if (this.delay) this.applyDelay();
  }

  private applyDelay(): void {
    const d = this.delay!;
    const c = this.delayCfg;
    const tm = clamp((c.beats * 60) / this.bpm, 0.02, 3.9);
    d.dl.delayTime.value = tm;
    d.dr.delayTime.value = tm;
    d.fb.gain.value = clamp(c.feedback, 0, 0.9);
    d.lp.frequency.value = c.tone;
    d.ret.gain.value = c.level;
  }

  /** @internal */
  delayInput(): GainNode {
    if (!this.delay) {
      const ctx = this.ctx;
      const input = this.node.gain(1);
      input.channelCount = 1;
      input.channelCountMode = 'explicit';
      const hp = this.node.filter('highpass', 280, 0.6);
      const lp = this.node.filter('lowpass', 3200, 0.6);
      this.count();
      const dl = ctx.createDelay(4);
      this.count();
      const dr = ctx.createDelay(4);
      const fb = this.node.gain(0.34);
      this.count();
      const merge = ctx.createChannelMerger(2);
      const ret = this.node.gain(1);
      input.connect(hp).connect(lp).connect(dl);
      dl.connect(dr);
      dr.connect(fb).connect(lp);
      dl.connect(merge, 0, 0);
      dr.connect(merge, 0, 1);
      merge.connect(ret).connect(this.out);
      this.delay = { input, dl, dr, fb, lp, ret };
      this.applyDelay();
    }
    return this.delay.input;
  }

  private wave(key: string, real: number[] | null, imag: number[]): PeriodicWave {
    let w = this.waves.get(key);
    if (!w) {
      const n = imag.length;
      w = this.ctx.createPeriodicWave(new Float32Array(real ?? new Array(n).fill(0)), new Float32Array(imag), { disableNormalization: false });
      this.waves.set(key, w);
    }
    return w;
  }

  private pianoWave(v: number): PeriodicWave {
    const layer = v < 0.4 ? 0 : v < 0.72 ? 1 : 2;
    const p = [2.0, 1.55, 1.2][layer];
    const imag = [0];
    for (let n = 1; n <= 40; n++) imag.push((Math.pow(n, -p) * (0.35 + Math.abs(Math.sin((Math.PI * n) / 7.6)))) / 1.35);
    return this.wave(`piano${layer}`, null, imag);
  }

  // ================================================================ KEYS
  /** FM electric piano (Rhodes-like): 1:1 FM body with velocity "bark", tine transient, stereo auto-pan channel */
  epiano(t: number, m: number, dur: number, vel: number, o: KeyOpts = {}): void {
    const rel = 0.3 + Math.max(0, 60 - m) * 0.008;
    if (!this.go('epiano', t, dur + rel, o.ch)) return;
    const f = mtof(m), v = clamp(vel, 0, 1);
    const bright = o.bright ?? 0.5;
    const t60 = clamp(8.5 - (m - 36) * 0.12, 1.6, 8.5);
    const peak = 0.3 * vc(v);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.0025 + 0.003 * (1 - v), peak], [0.3, peak * 0.55, 'exp'], [0.3 + t60, peak * 1e-3, 'exp']], t + dur, rel);
    const car = this.osc('sine', f, t, end, true);
    const mod = this.osc('sine', f + 0.15, t, end);
    const mg = this.node.gain();
    const reg = clamp(1.25 - (m - 48) / 40, 0.4, 1.25);
    const i0 = (0.5 + 2.6 * Math.pow(v, 1.4) * (0.55 + bright)) * reg;
    const i1 = (0.18 + 0.35 * v * (0.5 + bright)) * reg;
    mg.gain.setValueAtTime(f * i0, t);
    mg.gain.exponentialRampToValueAtTime(f * i1, t + 0.45);
    mg.gain.exponentialRampToValueAtTime(f * i1 * 0.5, t + 3);
    mod.connect(mg).connect(car.frequency);
    car.connect(g);
    // tine "ding"
    const tr = f * 14 < this.nyq * 0.7 ? 14 : f * 7 < this.nyq * 0.7 ? 7 : 0;
    if (tr && v > 0.15) {
      const tine = this.osc('sine', f * tr, t, t + 0.25);
      const tg = this.node.gain();
      env(tg.gain, t, [[0.0015, peak * 0.22 * v * (0.4 + bright)], [0.09, 1e-5, 'exp']], t + 0.09, 0.02);
      tine.connect(tg).connect(g);
    }
    this.route(g, 'epiano', o);
  }

  /** soft acoustic piano: band-limited string spectrum (3 velocity layers), unison detune, decaying brightness, hammer noise */
  piano(t: number, m: number, dur: number, vel: number, o: KeyOpts = {}): void {
    const rel = m < 50 ? 0.45 : 0.28;
    if (!this.go('piano', t, dur + rel, o.ch)) return;
    const f = mtof(m), v = clamp(vel, 0, 1);
    const bright = o.bright ?? 0.5;
    const t60 = clamp(13 - (m - 21) * 0.16, 1.2, 12);
    const peak = 0.13 * vc(v);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.002, peak], [0.35, peak * 0.42, 'exp'], [0.35 + t60, peak * 1e-3, 'exp']], t + dur, rel);
    const w = this.pianoWave(v);
    const o1 = this.osc(w, f, t, end);
    const o2 = this.osc(w, f * 1.0011, t, end);
    const lp = this.node.filter('lowpass', 1000, 0.5);
    const c0 = Math.min(this.nyq, f * (2.5 + 12 * Math.pow(v, 1.2) * (0.5 + bright)) + 700);
    const c1 = Math.min(c0, f * 1.6 + 500);
    lp.frequency.setValueAtTime(c0, t);
    lp.frequency.exponentialRampToValueAtTime(c1, t + 0.9 + t60 * 0.25);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    // hammer
    if (v > 0.2) {
      const ns = this.noiseSrc(t, t + 0.06, 0.6);
      const hg = this.node.gain();
      env(hg.gain, t, [[0.001, 0.35 * v], [0.025, 1e-5, 'exp']], t + 0.03, 0.01);
      ns.connect(hg).connect(lp);
    }
    this.route(g, 'piano', o);
  }

  private pluck(kind: InstrumentName, t: number, m: number, dur: number, vel: number, o: NoteOpts, p: KSParams & { peak: number; rel: number; lp0: number; lpv: number; q?: number; filterEnv?: number }): GainNode | null {
    if (!this.go(kind, t, dur + p.rel)) return null;
    const v = clamp(vel, 0, 1);
    const { buf, f0 } = ksBuffer(this.ctx, kind, m, p);
    const rate = mtof(m) / f0;
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.0015, p.peak * vc(v)]], Math.min(t + dur, t + buf.duration / rate), p.rel);
    const src = this.bufSrc(buf, t, end, rate);
    const lp = this.node.filter('lowpass', p.lp0 + p.lpv * Math.pow(v, 1.3), p.q ?? 0.6);
    if (p.filterEnv) {
      const c = lp.frequency.value;
      lp.frequency.setValueAtTime(Math.min(this.nyq, c * (1 + p.filterEnv)), t);
      lp.frequency.exponentialRampToValueAtTime(c, t + 0.25);
    }
    src.connect(lp).connect(g);
    this.route(g, kind, o);
    return g;
  }

  /** plucked nylon guitar (Karplus-Strong, body EQ on the channel) */
  guitar(t: number, m: number, dur: number, vel: number, o: NoteOpts = {}): void {
    this.pluck('guitar', t, m, dur, vel, o, { t60: clamp(5 - (m - 40) * 0.075, 1.3, 5), bright: 0.5, pick: 0.13, damp: 0.42, maxLen: 3.2, peak: 0.34, rel: 0.12, lp0: 1300, lpv: 4800 });
  }

  /** concert harp (bright, long KS) */
  harp(t: number, m: number, dur: number, vel: number, o: NoteOpts = {}): void {
    this.pluck('harp', t, m, dur, vel, o, { t60: clamp(6 - (m - 40) * 0.08, 1.4, 6), bright: 0.62, pick: 0.3, damp: 0.3, maxLen: 3.6, peak: 0.38, rel: 0.6, lp0: 2200, lpv: 6000 });
  }

  /** clavinet-like funky pluck: bright near-bridge KS + resonant filter, short muted release */
  clav(t: number, m: number, dur: number, vel: number, o: KeyOpts = {}): void {
    const b = o.bright ?? 0.5;
    this.pluck('clav', t, m, dur, vel, o, { t60: 1.4, bright: 1, pick: 0.05, damp: 0.12, maxLen: 1.4, peak: 0.5, rel: 0.035, lp0: 900 + 800 * b, lpv: 3200 + 2500 * b, q: 3.2 });
  }

  /** string pizzicato */
  pizz(t: number, m: number, dur: number, vel: number, o: NoteOpts = {}): void {
    this.pluck('pizz', t, m, dur, vel, o, { t60: clamp(1.1 - (m - 48) * 0.012, 0.45, 1.2), bright: 0.45, pick: 0.22, damp: 0.5, maxLen: 1.3, peak: 0.55, rel: 0.12, lp0: 900, lpv: 2600 });
  }

  // ================================================================ SUSTAINED
  /** warm pad: detuned oscillator pairs spread L/R, lowpass swell with slow LFO, chorus drift */
  pad(t: number, midis: number | readonly number[], dur: number, vel: number, o: PadOpts = {}): void {
    const ms = typeof midis === 'number' ? [midis] : midis;
    const att = o.attack ?? 1.2, rel = o.release ?? 1.8;
    if (!ms.length || !this.go('pad', t, dur + rel)) return;
    const v = clamp(vel, 0, 1);
    const peak = (0.2 * vc(v)) / Math.sqrt(ms.length);
    const g = this.node.gain();
    const end = env(g.gain, t, [[att, peak], [att + 3, peak * 0.85]], t + dur, rel);
    this.count();
    const merge = this.ctx.createChannelMerger(2);
    const cut = (o.cutoff ?? 2200) * (0.45 + 0.7 * v);
    const lp = this.node.filter('lowpass', cut, 0.6);
    lp.frequency.setValueAtTime(cut * 0.45, t);
    lp.frequency.exponentialRampToValueAtTime(cut, t + Math.max(0.1, att * 1.4));
    const wave: OscillatorType = o.wave === 'tri' ? 'triangle' : o.wave === 'square' ? 'square' : 'sawtooth';
    const det = o.detune ?? 9;
    const vibA = this.lfo('padA', 0.31, 4);
    const vibB = this.lfo('padB', 0.23, 5);
    let first: OscillatorNode | null = null;
    for (const m of ms) {
      const f = mtof(m);
      const a = this.osc(wave, f, t, end);
      a.detune.value = -det + (this.rng.next() - 0.5) * 3;
      const b = this.osc(wave, f, t, end);
      b.detune.value = det + (this.rng.next() - 0.5) * 3;
      a.connect(merge, 0, 0);
      b.connect(merge, 0, 1);
      this.modulate(vibA, a.detune, a);
      this.modulate(vibB, b.detune, b);
      first ??= a;
    }
    if (first) this.modulate(this.lfo('padFilt', 0.11, 450), lp.detune, first);
    merge.connect(lp).connect(g);
    this.route(g, 'pad', o);
  }

  /** string ensemble: detuned saw pairs with vibrato, bowed attack, stereo */
  strings(t: number, midis: number | readonly number[], dur: number, vel: number, o: PadOpts = {}): void {
    const ms = typeof midis === 'number' ? [midis] : midis;
    const v = clamp(vel, 0, 1);
    const att = o.attack ?? 0.5 - 0.3 * v, rel = o.release ?? 0.9;
    if (!ms.length || !this.go('strings', t, dur + rel)) return;
    const peak = (0.2 * vc(v)) / Math.sqrt(ms.length);
    const g = this.node.gain();
    const end = env(g.gain, t, [[att, peak], [att + 1.5, peak * 0.9]], t + dur, rel);
    this.count();
    const merge = this.ctx.createChannelMerger(2);
    const cut = (o.cutoff ?? 5000) * (0.35 + 0.65 * v);
    const lp = this.node.filter('lowpass', cut, 0.5);
    lp.frequency.setValueAtTime(cut * 0.5, t);
    lp.frequency.linearRampToValueAtTime(cut, t + att + 0.1);
    const vib = this.lfo('strVib', 5.3, 7);
    const det = o.detune ?? 7;
    const wave: OscillatorType = o.wave === 'tri' ? 'triangle' : o.wave === 'square' ? 'square' : 'sawtooth';
    for (const m of ms) {
      const f = mtof(m);
      const a = this.osc(wave, f, t, end);
      a.detune.value = -det;
      const b = this.osc(wave, f, t, end);
      b.detune.value = det;
      a.connect(merge, 0, 0);
      b.connect(merge, 0, 1);
      this.modulate(vib, a.detune, a);
      this.modulate(vib, b.detune, b);
    }
    merge.connect(lp).connect(g);
    this.route(g, 'strings', o);
  }

  /** drawbar organ (one oscillator per note, leslie tremolo on the channel) */
  organ(t: number, midis: number | readonly number[], dur: number, vel: number, o: OrganOpts = {}): void {
    const ms = typeof midis === 'number' ? [midis] : midis;
    if (!ms.length || !this.go('organ', t, dur + 0.08)) return;
    const v = clamp(vel, 0, 1);
    const preset = o.drawbars ?? 'jazz';
    // drawbar footages relative to the 16' sub: harmonics 1(16') 3(5 1/3') 2(8') 4(4') 6(2 2/3') 8(2') 10 12 16
    const bars: Record<string, number[]> = { jazz: [8, 8, 8, 0, 0, 0, 0, 0, 0], gospel: [8, 8, 8, 8, 0, 0, 0, 0, 8], soft: [0, 0, 8, 6, 0, 0, 0, 0, 0], full: [8, 8, 8, 8, 6, 6, 4, 4, 4] };
    const harm = [1, 3, 2, 4, 6, 8, 10, 12, 16];
    const imag = new Array(17).fill(0);
    bars[preset].forEach((lv, i) => {
      if (lv > 0) imag[harm[i]] += Math.pow(10, ((lv - 8) * 3) / 20);
    });
    const w = this.wave(`organ:${preset}`, null, imag);
    const peak = (0.25 * (0.5 + 0.5 * vc(v))) / Math.sqrt(ms.length);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.006, peak]], t + dur, 0.07);
    for (const m of ms) this.osc(w, mtof(m) / 2, t, end).connect(g);
    this.route(g, 'organ', o);
  }

  // ================================================================ BASS
  /** round bass: sine + triangle through a plucky lowpass */
  bass(t: number, m: number, dur: number, vel: number, o: GlideOpts = {}): void {
    if (!this.go('bass', t, dur + 0.09)) return;
    const f = mtof(m), v = clamp(vel, 0, 1);
    const peak = 0.2 * vc(v);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.007, peak], [0.4, peak * 0.7, 'exp']], t + dur, 0.09);
    const s = this.osc('sine', f, t, end);
    const tri = this.osc('triangle', f, t, end);
    if (o.glideFrom !== undefined) for (const x of [s, tri]) this.glide(x, o.glideFrom, f, t, o.glideTime);
    const lp = this.node.filter('lowpass', 300, 0.8);
    const c = 220 + 1500 * Math.pow(v, 1.5);
    lp.frequency.setValueAtTime(c, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(180, c * 0.45), t + 0.3);
    s.connect(g);
    tri.connect(lp).connect(g);
    this.route(g, 'bass', o);
  }

  private glide(x: OscillatorNode, from: number, f: number, t: number, time = 0.06): void {
    x.frequency.setValueAtTime(mtof(from), t);
    x.frequency.exponentialRampToValueAtTime(f, t + time);
  }

  /** upright (double) bass: dark KS pluck + sine body + thumb-filter envelope */
  upright(t: number, m: number, dur: number, vel: number, o: NoteOpts = {}): void {
    const g = this.pluck('upright', t, m, dur, vel, o, { t60: clamp(3.4 - (m - 28) * 0.04, 1.6, 3.4), bright: 0.3, pick: 0.2, damp: 0.5, maxLen: 2.6, peak: 0.5, rel: 0.1, lp0: 380, lpv: 1500, filterEnv: 1.2 });
    if (!g) return;
    const v = clamp(vel, 0, 1);
    const sg = this.node.gain();
    const end = env(sg.gain, t, [[0.008, 0.27 * vc(v)], [0.9, 0.06 * vc(v), 'exp']], t + dur, 0.1);
    this.osc('sine', mtof(m), t, end).connect(sg).connect(g);
  }

  /** slap / pop bass: bright KS + thumb click */
  slap(t: number, m: number, dur: number, vel: number, o: NoteOpts = {}): void {
    const g = this.pluck('slap', t, m, dur, vel, o, { t60: 2, bright: 0.95, pick: 0.07, damp: 0.25, maxLen: 2, peak: 0.5, rel: 0.06, lp0: 1400, lpv: 5000, filterEnv: 0.8 });
    if (!g) return;
    const v = clamp(vel, 0, 1);
    const ns = this.noiseSrc(t, t + 0.03);
    const ng = this.node.gain();
    env(ng.gain, t, [[0.0008, 0.22 * v], [0.012, 1e-5, 'exp']], t + 0.012, 0.005);
    ns.connect(ng).connect(g);
  }

  /** analog-style synth bass: saw/square + sub sine, resonant lowpass with envelope, optional glide */
  synthBass(t: number, m: number, dur: number, vel: number, o: SynthBassOpts = {}): void {
    if (!this.go('synthBass', t, dur + 0.08)) return;
    const f = mtof(m), v = clamp(vel, 0, 1);
    const peak = 0.36 * vc(v);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.004, peak], [0.3, peak * 0.8, 'exp']], t + dur, 0.07);
    const x = this.osc(o.wave === 'square' ? 'square' : 'sawtooth', f, t, end);
    const sub = this.osc('sine', f / 2, t, end);
    if (o.glideFrom !== undefined) {
      this.glide(x, o.glideFrom, f, t, o.glideTime);
      this.glide(sub, o.glideFrom - 12, f / 2, t, o.glideTime);
    }
    const base = o.cutoff ?? 380;
    const lp = this.node.filter('lowpass', base, o.reso ?? 5);
    const amt = o.envAmt ?? 0.6;
    lp.frequency.setValueAtTime(Math.min(this.nyq, base * (1 + 8 * amt * v)), t);
    lp.frequency.exponentialRampToValueAtTime(base, t + (o.decay ?? 0.18));
    const sg = this.node.gain(0.55);
    x.connect(lp).connect(g);
    sub.connect(sg).connect(g);
    this.route(g, 'synthBass', o);
  }

  // ================================================================ MALLETS / BELLS
  /** marimba: sine + 3.93x partial (mallet brightness follows velocity) */
  marimba(t: number, m: number, dur: number, vel: number, o: NoteOpts = {}): void {
    const f = mtof(m), v = clamp(vel, 0, 1);
    const t60 = clamp(2.2 - (m - 48) * 0.035, 0.35, 2.2);
    if (!this.go('marimba', t, Math.min(dur, t60) + 0.1)) return;
    const peak = 0.32 * vc(v);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.0015, peak], [0.0015 + t60, peak * 1e-3, 'exp']], t + Math.min(Math.max(dur, 0.15), t60), 0.08);
    this.osc('sine', f, t, end).connect(g);
    if (f * 3.93 < this.nyq) {
      const g2 = this.node.gain();
      env(g2.gain, t, [[0.001, peak * 0.5 * v], [0.06 + 0.1 * (1 - (m - 48) / 48), 1e-5, 'exp']], t + 0.2, 0.01);
      this.osc('sine', f * 3.93, t, t + 0.25).connect(g2);
      this.route(g2, 'marimba', o);
    }
    this.route(g, 'marimba', o);
  }

  /** vibraphone: sine + 4x partial, long ring, motor tremolo on the channel (mix tremolo: 0 to switch the motor off) */
  vibes(t: number, m: number, dur: number, vel: number, o: MalletOpts = {}): void {
    const f = mtof(m), v = clamp(vel, 0, 1);
    const t60 = clamp(6 - (m - 53) * 0.1, 1.5, 6);
    const hold = o.pedal ? t60 : Math.min(dur, t60);
    if (!this.go('vibes', t, hold + 0.3)) return;
    const peak = 0.24 * vc(v);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.002, peak], [0.4, peak * 0.6, 'exp'], [0.4 + t60, peak * 1e-3, 'exp']], t + hold, 0.25);
    this.osc('sine', f, t, end).connect(g);
    if (f * 4 < this.nyq) {
      const g2 = this.node.gain();
      env(g2.gain, t, [[0.0015, peak * 0.3 * (0.3 + v)], [0.5, 1e-5, 'exp']], t + 0.5, 0.02);
      this.osc('sine', f * 4, t, t + 0.6).connect(g2).connect(g);
    }
    this.route(g, 'vibes', o);
  }

  /** FM bell (ratio 3.5 default): bright inharmonic strike decaying to a pure hum */
  bell(t: number, m: number, dur: number, vel: number, o: BellOpts = {}): void {
    const ring = o.ring ?? Math.max(dur, 2.5);
    if (!this.go('bell', t, ring)) return;
    const f = mtof(m), v = clamp(vel, 0, 1);
    const peak = 0.25 * vc(v);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.002, peak], [ring, peak * 1e-3, 'exp']], t + ring, 0.05);
    const car = this.osc('sine', f, t, end, true);
    const mod = this.osc('sine', f * (o.ratio ?? 3.5), t, end);
    const mg = this.node.gain();
    mg.gain.setValueAtTime(f * (1.2 + 3 * v), t);
    mg.gain.exponentialRampToValueAtTime(f * 0.15, t + ring * 0.6);
    mod.connect(mg).connect(car.frequency);
    car.connect(g);
    this.route(g, 'bell', o);
  }

  /** glass / celesta-like: sine + 2.76x inharmonic partial, soft strike */
  glass(t: number, m: number, dur: number, vel: number, o: NoteOpts = {}): void {
    const ring = Math.max(dur, 2.2);
    if (!this.go('glass', t, ring)) return;
    const f = mtof(m), v = clamp(vel, 0, 1);
    const peak = 0.24 * vc(v);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.006, peak], [ring, peak * 1e-3, 'exp']], t + ring, 0.05);
    this.osc('sine', f, t, end).connect(g);
    if (f * 2.76 < this.nyq) {
      const g2 = this.node.gain();
      env(g2.gain, t, [[0.004, peak * 0.45], [ring * 0.4, 1e-5, 'exp']], t + ring * 0.4, 0.02);
      this.osc('sine', f * 2.76, t, t + ring * 0.4 + 0.05).connect(g2);
      this.route(g2, 'glass', o);
    }
    this.route(g, 'glass', o);
  }

  // ================================================================ LEADS / WINDS
  /** breathy flute: near-sine tone, delayed vibrato, chiff + breath noise */
  flute(t: number, m: number, dur: number, vel: number, o: FluteOpts = {}): void {
    this.wind('flute', t, m, dur, vel, o, o.vibrato ?? 14, o.breath ?? 0.5, this.wave('flute', null, [0, 1, 0.22, 0.07, 0.025]));
  }

  /** whistle: pure sine, wider vibrato, little breath */
  whistle(t: number, m: number, dur: number, vel: number, o: FluteOpts = {}): void {
    this.wind('whistle', t, m, dur, vel, o, o.vibrato ?? 22, o.breath ?? 0.15, 'sine');
  }

  private wind(kind: InstrumentName, t: number, m: number, dur: number, vel: number, o: FluteOpts, vib: number, breath: number, w: OscWave): void {
    if (!this.go(kind, t, dur + 0.14)) return;
    const f = mtof(m), v = clamp(vel, 0, 1);
    const att = 0.045 + 0.07 * (1 - v);
    const peak = 0.2 * vc(v);
    const g = this.node.gain();
    const end = env(g.gain, t, [[att * 0.6, peak * 1.1], [att, peak], [att + 0.6, peak * 0.88]], t + dur, 0.12);
    const x = this.osc(w, f, t, end);
    if (o.glideFrom !== undefined) this.glide(x, o.glideFrom, f, t, o.glideTime ?? 0.08);
    x.connect(g);
    if (vib > 0 && dur > 0.3) {
      const vg = this.node.gain();
      vg.gain.setValueAtTime(0, t);
      vg.gain.setValueAtTime(0, t + 0.22);
      vg.gain.linearRampToValueAtTime(vib, t + 0.6);
      vg.connect(x.detune);
      this.modulateNode(this.lfo('vib', 5.1, 1), vg, x);
    }
    if (breath > 0) {
      const ns = this.noiseSrc(t, end);
      const bp = this.node.filter('bandpass', Math.min(f * 2.2, 7000), 1.1);
      const ng = this.node.gain();
      env(ng.gain, t, [[0.02, peak * 0.45 * breath], [0.13, peak * 0.1 * breath, 'exp']], t + dur, 0.1);
      ns.connect(bp).connect(ng);
      this.route(ng, kind, o);
    }
    this.route(g, kind, o);
  }

  /** synth lead: unison saw/square/tri/sine, filter envelope, glide, optional delayed vibrato */
  lead(t: number, m: number, dur: number, vel: number, o: LeadOpts = {}): void {
    if (!this.go('lead', t, dur + 0.15)) return;
    const f = mtof(m), v = clamp(vel, 0, 1);
    const peak = 0.18 * vc(v);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.008, peak], [0.35, peak * 0.8, 'exp']], t + dur, 0.14);
    const wave: OscillatorType = o.wave === 'square' ? 'square' : o.wave === 'tri' ? 'triangle' : o.wave === 'sine' ? 'sine' : 'sawtooth';
    const det = o.detune ?? 8;
    const oscs = [this.osc(wave, f, t, end)];
    if (det > 0) oscs.push(this.osc(wave, f, t, end));
    oscs[0].detune.value = -det / 2;
    if (oscs[1]) oscs[1].detune.value = det / 2;
    const c = (o.cutoff ?? 2400) * (0.5 + v);
    const lp = this.node.filter('lowpass', c, o.reso ?? 2);
    lp.frequency.setValueAtTime(Math.min(this.nyq, c * 1.9), t);
    lp.frequency.exponentialRampToValueAtTime(c, t + 0.25);
    for (const x of oscs) {
      if (o.glideFrom !== undefined) this.glide(x, o.glideFrom, f, t, o.glideTime);
      x.connect(lp);
    }
    if (o.vibrato && dur > 0.3) {
      const vg = this.node.gain();
      vg.gain.setValueAtTime(0, t + 0.2);
      vg.gain.linearRampToValueAtTime(o.vibrato, t + 0.55);
      for (const x of oscs) vg.connect(x.detune);
      this.modulateNode(this.lfo('vib', 5.1, 1), vg, oscs[0]);
    }
    lp.connect(g);
    this.route(g, 'lead', o);
  }

  /** arpeggiator pluck: single saw/square, snappy filter + amp decay (channel has delay send) */
  arp(t: number, m: number, dur: number, vel: number, o: ArpOpts = {}): void {
    const dec = o.decay ?? 0.22;
    if (!this.go('arp', t, dur + 0.05)) return;
    const f = mtof(m), v = clamp(vel, 0, 1);
    const peak = 0.3 * vc(v);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.003, peak], [0.003 + dec * 3, peak * 1e-3, 'exp']], t + dur, 0.05);
    const x = this.osc(o.wave === 'square' ? 'square' : 'sawtooth', f, t, end);
    const c = o.cutoff ?? 1800;
    const lp = this.node.filter('lowpass', c, 3);
    lp.frequency.setValueAtTime(Math.min(this.nyq, c * (1 + 3 * v)), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120, c * 0.5), t + dec);
    x.connect(lp).connect(g);
    this.route(g, 'arp', o);
  }

  /** synth brass stab / swell: detuned saws per note, scoop-in pitch, "blat" filter envelope */
  brass(t: number, midis: number | readonly number[], dur: number, vel: number, o: NoteOpts = {}): void {
    const ms = typeof midis === 'number' ? [midis] : midis;
    if (!ms.length || !this.go('brass', t, dur + 0.12)) return;
    const v = clamp(vel, 0, 1);
    const peak = (0.27 * vc(v)) / Math.sqrt(ms.length);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.028, peak], [0.18, peak * 0.72, 'exp']], t + dur, 0.12);
    const lp = this.node.filter('lowpass', 400, 1.3);
    lp.frequency.setValueAtTime(350, t);
    lp.frequency.linearRampToValueAtTime(1200 + 3800 * v, t + 0.05);
    lp.frequency.exponentialRampToValueAtTime(800 + 1600 * v, t + 0.32);
    for (const m of ms) {
      for (const d of [-6, 6]) {
        const x = this.osc('sawtooth', mtof(m), t, end);
        x.detune.setValueAtTime(d - 35, t);
        x.detune.linearRampToValueAtTime(d, t + 0.05);
        x.connect(lp);
      }
    }
    lp.connect(g);
    this.route(g, 'brass', o);
  }

  // ================================================================ DRUMS & PERCUSSION
  /** kick: pitch-swept sine + beater click. Jazz "feathered" kick: vel ~0.3, click 0 */
  kick(t: number, vel: number, o: KickOpts = {}): void {
    const dec = o.decay ?? 0.42;
    if (!this.go('kick', t, dec)) return;
    const v = clamp(vel, 0, 1);
    const tune = o.tune ?? 52;
    const peak = 0.8 * vc(v);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.0015, peak], [0.07, peak * 0.72, 'exp'], [dec, peak * 2e-3, 'exp']], t + dec, 0.02);
    const x = this.osc('sine', tune * (2.4 + 2 * v), t, end);
    x.frequency.exponentialRampToValueAtTime(tune * 1.3, t + 0.035);
    x.frequency.exponentialRampToValueAtTime(tune, t + 0.12);
    x.connect(g);
    this.route(g, 'kick', o);
    const click = o.click ?? 0.5;
    if (click > 0 && v > 0.2) {
      const ns = this.noiseSrc(t, t + 0.02);
      const ng = this.node.gain();
      env(ng.gain, t, [[0.0005, peak * 0.3 * click], [0.007, 1e-5, 'exp']], t + 0.007, 0.003);
      const hp = this.shared(`kickClick:${o.ch ?? ''}`, () => {
        const f = this.node.filter('bandpass', 3200, 0.7);
        f.connect(this.chIn('kick', o));
        return f;
      });
      ns.connect(ng).connect(hp);
    }
  }

  /** snare: triangle body + wire noise. Ghost notes at vel 0.15-0.3 (body fades faster than the wires) */
  snare(t: number, vel: number, o: SnareOpts = {}): void {
    const v = clamp(vel, 0, 1);
    const dec = o.decay ?? 0.14 + 0.1 * v;
    if (!this.go('snare', t, dec)) return;
    const tone = o.tone ?? 185;
    const peak = 0.66 * vc(v);
    const gb = this.node.gain();
    const e1 = env(gb.gain, t, [[0.001, peak * (0.35 + 0.65 * v)], [0.07 + 0.06 * v, 1e-5, 'exp']], t + 0.14, 0.01);
    const x = this.osc('triangle', tone * 1.4, t, e1);
    x.frequency.exponentialRampToValueAtTime(tone, t + 0.03);
    x.connect(gb);
    this.route(gb, 'snare', o);
    const ns = this.noiseSrc(t, t + dec + 0.05);
    const ng = this.node.gain();
    env(ng.gain, t, [[0.001, peak * (o.snappy ?? 0.75)], [dec, 1e-5, 'exp']], t + dec, 0.01);
    const hp = this.shared(`snareWire:${o.ch ?? ''}`, () => {
      const f = this.node.filter('highpass', 1400, 0.7);
      const pk = this.node.filter('peaking', 5200, 1);
      pk.gain.value = 4;
      f.connect(pk).connect(this.chIn('snare', o));
      return f;
    });
    ns.connect(ng).connect(hp);
  }

  /** rim click / cross-stick */
  rim(t: number, vel: number, o: NoteOpts = {}): void {
    if (!this.go('rim', t, 0.05)) return;
    const v = clamp(vel, 0, 1);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.0005, 0.8 * vc(v)], [0.035, 1e-5, 'exp']], t + 0.035, 0.005);
    const a = this.osc('triangle', 1750, t, end);
    a.frequency.exponentialRampToValueAtTime(1500, t + 0.02);
    const b = this.osc('square', 470, t, end);
    a.connect(g);
    b.connect(g);
    const bp = this.shared(`rimBp:${o.ch ?? ''}`, () => {
      const f = this.node.filter('bandpass', 1350, 1.3);
      f.connect(this.chIn('rim', o));
      return f;
    });
    g.connect(bp);
  }

  /** hand clap: 3 fast noise bursts + tail through a band-pass */
  clap(t: number, vel: number, o: NoteOpts = {}): void {
    if (!this.go('clap', t, 0.25)) return;
    const v = clamp(vel, 0, 1);
    const peak = 1.2 * vc(v);
    const ns = this.noiseSrc(t, t + 0.3);
    const g = this.node.gain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    for (let k = 0; k < 3; k++) {
      const s = t + k * 0.011;
      p.linearRampToValueAtTime(peak, s + 0.001);
      p.linearRampToValueAtTime(peak * 0.15, s + 0.009);
    }
    p.linearRampToValueAtTime(peak, t + 0.034);
    p.exponentialRampToValueAtTime(peak * 1e-3, t + 0.034 + 0.2);
    p.linearRampToValueAtTime(0, t + 0.24);
    const bp = this.shared(`clapBp:${o.ch ?? ''}`, () => {
      const f = this.node.filter('bandpass', 1150, 1.1);
      f.connect(this.chIn('clap', o));
      return f;
    });
    ns.connect(g).connect(bp);
  }

  /** hi-hat: closed by default; { open: seconds } rings then chokes */
  hat(t: number, vel: number, o: HatOpts = {}): void {
    const v = clamp(vel, 0, 1);
    const open = o.open ?? 0;
    const dec = open > 0 ? Math.max(open, 0.05) : o.decay ?? 0.045 + 0.03 * v;
    if (!this.go('hat', t, dec + 0.03)) return;
    const peak = 0.45 * vc(v);
    const ns = this.noiseSrc(t, t + dec + 0.06);
    const g = this.node.gain();
    if (open > 0) env(g.gain, t, [[0.002, peak], [0.6, peak * 0.1, 'exp']], t + open, 0.03);
    else env(g.gain, t, [[0.0008, peak], [dec, 1e-5, 'exp']], t + dec, 0.005);
    ns.connect(g);
    this.route(g, 'hat', o);
  }

  /** shaker / cabasa: swishy band-passed noise (len = swish length, default 0.09 s) */
  shaker(t: number, vel: number, o: NoteOpts & { len?: number } = {}): void {
    const len = o.len ?? 0.09;
    if (!this.go('shaker', t, len + 0.02)) return;
    const v = clamp(vel, 0, 1);
    const ns = this.noiseSrc(t, t + len + 0.03);
    const g = this.node.gain();
    env(g.gain, t, [[len * 0.45, 0.3 * vc(v)], [len, 1e-4, 'exp']], t + len, 0.01);
    ns.connect(g);
    this.route(g, 'shaker', o);
  }

  /** brush tap on the snare (jazz 2 & 4, or soft comping taps) */
  brush(t: number, vel: number, o: NoteOpts = {}): void {
    const v = clamp(vel, 0, 1);
    const dec = 0.12 + 0.1 * v;
    if (!this.go('brush', t, dec)) return;
    const ns = this.noiseSrc(t, t + dec + 0.03, 0.8);
    const g = this.node.gain();
    env(g.gain, t, [[0.003, 0.4 * vc(v)], [dec, 1e-4, 'exp']], t + dec, 0.01);
    ns.connect(g);
    this.route(g, 'brush', o);
  }

  /** brush swirl: a moving band-passed noise sweep that fills `dur` seconds (one per 2 beats is typical) */
  brushSwirl(t: number, dur: number, vel: number, o: NoteOpts = {}): void {
    if (!this.go('brushSwirl', t, dur + 0.15)) return;
    const v = clamp(vel, 0, 1);
    const peak = 0.22 * vc(v);
    const ns = this.noiseSrc(t, t + dur + 0.2, 0.7);
    const bp = this.node.filter('bandpass', 2000, 0.9);
    bp.frequency.setValueAtTime(1600, t);
    bp.frequency.linearRampToValueAtTime(3300, t + dur * 0.55);
    bp.frequency.linearRampToValueAtTime(2100, t + dur);
    const g = this.node.gain();
    env(g.gain, t, [[dur * 0.35, peak], [dur * 0.8, peak * 0.55]], t + dur, 0.15);
    const pn = this.node.panner(-0.3);
    pn.pan.setValueAtTime(-0.3, t);
    pn.pan.linearRampToValueAtTime(0.35, t + dur);
    ns.connect(bp).connect(g).connect(pn).connect(this.chIn('brush', o));
  }

  /** tom: pitched sine thump. pitch 'low' | 'mid' | 'high' or Hz */
  tom(t: number, vel: number, o: NoteOpts & { pitch?: 'low' | 'mid' | 'high' | number } = {}): void {
    if (!this.go('tom', t, 0.5)) return;
    const v = clamp(vel, 0, 1);
    const p = o.pitch ?? 'mid';
    const f = typeof p === 'number' ? p : p === 'low' ? 92 : p === 'high' ? 175 : 128;
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.0015, 0.6 * vc(v)], [0.42, 1e-4, 'exp']], t + 0.42, 0.02);
    const x = this.osc('sine', f * 1.55, t, end);
    x.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    x.connect(g);
    this.route(g, 'tom', { ...o, pan: o.pan ?? (p === 'low' ? -0.25 : p === 'high' ? 0.25 : undefined) });
  }

  /** orchestral triangle: two high inharmonic sines; open rings ~2 s, { open: false } is muted */
  triangle(t: number, vel: number, o: NoteOpts & { open?: boolean } = {}): void {
    const ring = o.open === false ? 0.12 : 2.2;
    if (!this.go('triangle', t, ring)) return;
    const v = clamp(vel, 0, 1);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.001, 0.13 * vc(v)], [ring, 1e-5, 'exp']], t + ring, 0.02);
    this.osc('sine', 3230, t, end).connect(g);
    this.osc('sine', 5570, t, end).connect(g);
    this.route(g, 'triangle', o);
  }

  /** ride cymbal: noise wash + stick ping; { bell: true } for the bell */
  ride(t: number, vel: number, o: NoteOpts & { bell?: boolean } = {}): void {
    if (!this.go('ride', t, 1.6)) return;
    const v = clamp(vel, 0, 1);
    const peak = 0.25 * vc(v);
    const bp = this.shared(`rideBp:${o.ch ?? ''}`, () => {
      const f = this.node.filter('bandpass', 6800, 0.55);
      f.connect(this.chIn('ride', o));
      return f;
    });
    const ns = this.noiseSrc(t, t + 1.7);
    const g = this.node.gain();
    env(g.gain, t, [[0.001, peak], [0.08, peak * 0.45, 'exp'], [1.6, 1e-4, 'exp']], t + 1.6, 0.02);
    ns.connect(g).connect(bp);
    const bell = !!o.bell;
    const pg = this.node.gain();
    const pe = env(pg.gain, t, [[0.001, peak * (bell ? 1.2 : 0.5)], [bell ? 1.1 : 0.22, 1e-5, 'exp']], t + (bell ? 1.1 : 0.22), 0.01);
    this.osc('square', bell ? 1180 : 3700, t, pe).connect(pg).connect(bp);
  }

  /** crash cymbal, or a reverse swell INTO time t with { swell: seconds } */
  cymbal(t: number, vel: number, o: NoteOpts & { swell?: number; decay?: number } = {}): void {
    const v = clamp(vel, 0, 1);
    const peak = 0.26 * vc(v);
    const sw = o.swell ?? 0;
    const t0 = t - sw;
    if (!this.go('cymbal', Math.max(0, t0), sw + (o.decay ?? 2.5))) return;
    const ns = this.noiseSrc(Math.max(0, t0), t + (sw ? 0.1 : (o.decay ?? 2.5) + 0.05));
    const g = this.node.gain();
    if (sw) env(g.gain, Math.max(0, t0), [[sw * 0.7, peak * 0.25], [sw, peak]], t, 0.06);
    else env(g.gain, t, [[0.002, peak], [o.decay ?? 2.5, 1e-4, 'exp']], t + (o.decay ?? 2.5), 0.02);
    ns.connect(g);
    this.route(g, 'cymbal', o);
  }

  /** conga: tone 'hi' | 'lo' | 'slap' | 'mute' */
  conga(t: number, vel: number, o: NoteOpts & { tone?: 'hi' | 'lo' | 'slap' | 'mute' } = {}): void {
    const tone = o.tone ?? 'hi';
    const dec = tone === 'lo' ? 0.38 : tone === 'hi' ? 0.3 : tone === 'slap' ? 0.12 : 0.07;
    if (!this.go('conga', t, dec)) return;
    const v = clamp(vel, 0, 1);
    const f = tone === 'lo' ? 215 : tone === 'slap' ? 350 : 325;
    const peak = 0.5 * vc(v);
    const g = this.node.gain();
    const end = env(g.gain, t, [[0.001, peak], [dec, 1e-4, 'exp']], t + dec, 0.01);
    const x = this.osc('sine', f * 1.2, t, end);
    x.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    x.connect(g);
    if (tone === 'slap' || tone === 'mute') {
      const ns = this.noiseSrc(t, t + 0.05);
      const ng = this.node.gain();
      env(ng.gain, t, [[0.0008, peak * 0.6], [0.025, 1e-5, 'exp']], t + 0.025, 0.005);
      const bp = this.shared(`congaBp:${o.ch ?? ''}`, () => {
        const b = this.node.filter('bandpass', 2100, 0.9);
        b.connect(this.chIn('conga', o));
        return b;
      });
      ns.connect(ng).connect(bp);
    }
    this.route(g, 'conga', { ...o, pan: o.pan ?? (tone === 'lo' ? -0.15 : undefined) });
  }

  /** noise sweep / riser for transitions: { up: true } rises into t+dur, false falls away from t */
  sweep(t: number, dur: number, vel: number, o: NoteOpts & { up?: boolean; from?: number; to?: number; q?: number } = {}): void {
    if (!this.go('sweep', t, dur + 0.25)) return;
    const up = o.up ?? true;
    const v = clamp(vel, 0, 1);
    const peak = 0.4 * vc(v);
    const ns = this.noiseSrc(t, t + dur + 0.3);
    const f0 = o.from ?? (up ? 300 : 7000), f1 = o.to ?? (up ? 7000 : 300);
    const bp = this.node.filter('bandpass', f0, o.q ?? 2.5);
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.node.gain();
    if (up) env(g.gain, t, [[dur * 0.85, peak], [dur, peak * 0.6]], t + dur, 0.2);
    else env(g.gain, t, [[0.05, peak], [dur, 1e-4, 'exp']], t + dur, 0.05);
    ns.connect(bp).connect(g);
    this.route(g, 'sweep', o);
  }

  /** vinyl crackle + hiss bed from t0 to t1 (fades 1.5 s in / 2 s out). level 0..1 (0.5 = subtle) */
  vinyl(t0: number, t1: number, level = 0.5): void {
    if (!this.go('vinyl', t0, t1 - t0)) return;
    const buf = crackleBuffer(this.ctx);
    this.count();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.node.gain();
    const pk = 0.5 * level;
    env(g.gain, t0, [[1.5, pk]], Math.max(t0 + 1.5, t1 - 2), 2);
    src.start(t0, this.rng.next() * 3);
    src.stop(t1 + 0.1);
    src.connect(g).connect(this.chIn('vinyl'));
    this.loops.push(src);
  }

  /** stop LFOs / loops at time `at` (default now). Called by the director when a play is over. */
  dispose(at?: number): void {
    if (this.disposed) return;
    this.disposed = true;
    const t = Math.max(at ?? this.ctx.currentTime, this.ctx.currentTime);
    for (const o of this.allLfos) {
      try {
        o.stop(t);
      } catch {
        /* ignore */
      }
    }
    for (const s of this.loops) {
      try {
        s.stop(t);
      } catch {
        /* ignore */
      }
    }
  }
}
