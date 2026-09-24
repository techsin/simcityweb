/**
 * Private instruments for "Neon Skyline" (tracks/neon_skyline.ts). Built from plain WebAudio nodes following the
 * synth.ts conventions: every envelope starts and ends at exactly 0, notes at/after inst.cutoff are dropped, lab
 * mute / solo sets are honoured (by the library instrument name the voice replaces) and node / note counts are added
 * to inst.stats so the lab's CPU numbers stay honest.
 *
 *   monoBass  - one mono synth-bass voice per bar (saw + sub sine -> resonant lowpass -> amp) whose amp and filter
 *               envelopes are re-triggered for every 8th note. Same sound as inst.synthBass per note, but 5 nodes per
 *               bar instead of ~5 per note (the driving 8th bass would otherwise cost ~17 nodes/s).
 *   monoArp   - the same idea for the 16th / 8th-note sequencer arp (saw or square -> Q3 lowpass -> amp): 3 nodes per
 *               bar. Like a real mono sequencer each step cuts the previous one (12 ms release, click-free).
 *   gatedSnare- the 80s gated-reverb tail: a band-limited noise burst that holds for ~0.3 s and is chopped off,
 *               widened with a short Haas delay on one side, mixed into the 'snare' channel.
 */
import type { MusicEnv } from '../types';

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const vc = (v: number): number => Math.pow(clamp01(v), 1.5);

export interface MonoNote {
  /** absolute start time (s) */
  t: number;
  midi: number;
  /** key-held seconds (the voice cuts it earlier if the next step comes first) */
  len: number;
  vel: number;
  /** per-note filter cutoff (Hz, arp only) */
  cut?: number;
}

function kRate(...ps: AudioParam[]): void {
  for (const p of ps) {
    try {
      p.automationRate = 'k-rate';
    } catch {
      /* fixed-rate param */
    }
  }
}

/** same gate as Instruments.go(): cutoff, lab mute / solo, live notes in the past, lab excerpt pre-roll */
function allowed(env: MusicEnv, name: string, t: number, len: number): boolean {
  const { inst, ctx } = env;
  if (!isFinite(t) || !(t < inst.cutoff)) return false;
  if (inst.mute.has(name) || (inst.solo.size > 0 && !inst.solo.has(name))) return false;
  if (env.live && t < ctx.currentTime + 0.004) return false;
  // offline excerpt renders drop notes that end before the excerpt (Instruments keeps this option private)
  const skip = (inst as unknown as { skipBefore?: number }).skipBefore;
  if (typeof skip === 'number' && t + len + 0.5 < skip) return false;
  return true;
}

/** add our nodes / notes to the lab statistics (perSec is only filled when the lab records stats) */
function bump(env: MusicEnv, t: number, nodes: number, notes: number): void {
  const s = env.inst.stats;
  s.nodes += nodes;
  s.notes += notes;
  if (s.perSec.length) {
    const k = Math.max(0, Math.floor(t));
    s.perSec[k] = (s.perSec[k] ?? 0) + nodes;
    s.notesPerSec[k] = (s.notesPerSec[k] ?? 0) + notes;
  }
}

/**
 * exponential move of `p` from v0 (at t0) towards v1 (reached at t1), cut at tc <= t1 with the value computed
 * analytically so the next event continues without a jump
 */
function expCut(p: AudioParam, v0: number, v1: number, t0: number, t1: number, tc: number): number {
  const a = Math.max(v0, 1e-5), b = Math.max(v1, 1e-5);
  if (tc >= t1) {
    p.exponentialRampToValueAtTime(b, t1);
    if (tc > t1) p.setValueAtTime(b, tc);
    return b;
  }
  const v = a * Math.pow(b / a, (tc - t0) / Math.max(1e-4, t1 - t0));
  p.exponentialRampToValueAtTime(Math.max(v, 1e-5), tc);
  return v;
}

export interface MonoBassOpts {
  /** base cutoff Hz (default 360), resonance (default 4.5) */
  cutoff?: number;
  reso?: number;
  /** filter-envelope amount 0..1 (default 0.55) and decay (s, default 0.16) */
  envAmt?: number;
  decay?: number;
  /**
   * sub-octave sine level (default 0.55, like synthBass). It fades out for notes below E2 so the sub never drops
   * under ~41 Hz (B1's sub would be 31 Hz: inaudible on most speakers, under the 52 Hz kick, and it only eats headroom)
   */
  sub?: number;
  /** release seconds (default 0.035; a long release for a held final note) */
  release?: number;
}

/** a bar (or phrase) of re-triggered mono synth-bass notes; notes must be sorted by time */
export function monoBass(env: MusicEnv, notes: readonly MonoNote[], o: MonoBassOpts = {}): void {
  const ns = notes.filter((n) => allowed(env, 'synthBass', n.t, n.len));
  if (!ns.length) return;
  const { ctx, inst } = env;
  const nyq = ctx.sampleRate * 0.45;
  const base = o.cutoff ?? 360, amt = o.envAmt ?? 0.55, dec = o.decay ?? 0.16;
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = o.reso ?? 4.5;
  const subLevel = o.sub ?? 0.55;
  const sg = ctx.createGain();
  sg.gain.value = subLevel;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  kRate(saw.frequency, saw.detune, sub.frequency, sub.detune, lp.frequency, lp.detune, lp.Q, lp.gain, sg.gain);
  saw.connect(lp).connect(amp);
  sub.connect(sg).connect(amp);
  amp.connect(inst.channel('synthBass').input);
  const g = amp.gain;
  const rel = Math.max(0.01, o.release ?? 0.035);
  const t0 = ns[0].t;
  g.setValueAtTime(0, t0);
  lp.frequency.setValueAtTime(base, t0);
  let end = t0;
  ns.forEach((n, i) => {
    const t = n.t;
    const next = i + 1 < ns.length ? ns[i + 1].t : Infinity;
    const v = clamp01(n.vel);
    const peak = 0.36 * vc(v);
    const tc = Math.max(t + 0.02, Math.min(t + n.len, next - rel - 0.004));
    const f = mtof(n.midi);
    // pitch and sub level change while the amp is at 0 (previous note fully released)
    saw.frequency.setValueAtTime(f, t);
    sub.frequency.setValueAtTime(f / 2, t);
    sg.gain.setValueAtTime(subLevel * clamp01((n.midi - 34) / 6), t);
    // amp: 4 ms attack, exponential sag to 0.8 over 0.3 s (synthBass shape), linear release
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + 0.004);
    expCut(g, peak, peak * 0.8, t + 0.004, t + 0.3, tc);
    g.linearRampToValueAtTime(0, tc + rel);
    // filter: base * (1 + 8 amt v) -> base over `dec`
    const f0 = Math.min(nyq, base * (1 + 8 * amt * v));
    lp.frequency.setValueAtTime(f0, t);
    expCut(lp.frequency, f0, base, t, t + dec, Math.min(t + dec, next - 0.002));
    end = tc + rel;
  });
  saw.start(t0);
  sub.start(t0);
  saw.stop(end + 0.03);
  sub.stop(end + 0.03);
  bump(env, t0, 5, ns.length);
}

export interface MonoArpOpts {
  wave?: 'saw' | 'square';
  /** pluck decay (s, default 0.2) */
  decay?: number;
  /** filter-envelope depth: the cutoff starts at cut * (1 + envAmt * vel) (default 3, like inst.arp) */
  envAmt?: number;
  /** filter resonance (default 3) */
  reso?: number;
}

/** a bar of mono sequencer-arp steps; notes must be sorted by time */
export function monoArp(env: MusicEnv, notes: readonly MonoNote[], o: MonoArpOpts = {}): void {
  const ns = notes.filter((n) => allowed(env, 'arp', n.t, n.len));
  if (!ns.length) return;
  const { ctx, inst } = env;
  const nyq = ctx.sampleRate * 0.45;
  const dec = o.decay ?? 0.2;
  const x = ctx.createOscillator();
  x.type = o.wave === 'square' ? 'square' : 'sawtooth';
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = o.reso ?? 3;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  kRate(x.frequency, x.detune, lp.frequency, lp.detune, lp.Q, lp.gain);
  x.connect(lp).connect(amp).connect(inst.channel('arp').input);
  const envAmt = o.envAmt ?? 3;
  // a square carries 4.7 dB more energy than a saw of the same peak (its fundamental is twice the saw's), whatever
  // the note or cutoff: level-match it so the arp sits the same in the mix whichever wave the seed rolls
  const waveGain = o.wave === 'square' ? 0.58 : 1;
  const g = amp.gain;
  const rel = 0.012;
  const t0 = ns[0].t;
  g.setValueAtTime(0, t0);
  let end = t0;
  ns.forEach((n, i) => {
    const t = n.t;
    const next = i + 1 < ns.length ? ns[i + 1].t : Infinity;
    const v = clamp01(n.vel);
    const peak = 0.3 * vc(v) * waveGain;
    const tc = Math.max(t + 0.012, Math.min(t + n.len, next - rel - 0.003));
    x.frequency.setValueAtTime(mtof(n.midi), t);
    const ta = t + 0.003;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, ta);
    expCut(g, peak, peak * 1e-3, ta, ta + dec * 3, tc);
    g.linearRampToValueAtTime(0, tc + rel);
    const c = n.cut ?? 1800;
    const f0 = Math.min(nyq, c * (1 + envAmt * v)), f1 = Math.max(120, c * 0.5);
    lp.frequency.setValueAtTime(f0, t);
    expCut(lp.frequency, f0, f1, t, t + dec, Math.min(t + dec, next - 0.002));
    end = tc + rel;
  });
  x.start(t0);
  x.stop(end + 0.03);
  bump(env, t0, 3, ns.length);
}

/** returns tail(t, vel, len?) that adds the gated-reverb burst behind a snare hit at t */
export function makeGatedSnare(env: MusicEnv, level = 0.2): (t: number, vel: number, len?: number) => void {
  const { ctx, inst } = env;
  let input: AudioNode | null = null;
  let k = 0;
  const chain = (): AudioNode => {
    if (!input) {
      // long-lived: hp -> lp -> [L direct, R via 19 ms] -> merger -> snare channel
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 420;
      hp.Q.value = 0.6;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 4800;
      lp.Q.value = 0.5;
      const body = ctx.createBiquadFilter();
      body.type = 'peaking';
      body.frequency.value = 1100;
      body.Q.value = 0.8;
      body.gain.value = 3;
      const dl = ctx.createDelay(0.1);
      dl.delayTime.value = 0.019;
      const merge = ctx.createChannelMerger(2);
      hp.connect(lp).connect(body);
      body.connect(merge, 0, 0);
      body.connect(dl).connect(merge, 0, 1);
      merge.connect(inst.channel('snare').input);
      input = hp;
      bump(env, ctx.currentTime, 5, 0);
    }
    return input;
  };
  return (t: number, vel: number, len = 0.3) => {
    if (!allowed(env, 'snare', t, len)) return;
    const pk = level * vc(vel);
    const src = ctx.createBufferSource();
    src.buffer = env.noise;
    const g = ctx.createGain();
    g.gain.value = 0;
    const s = t + 0.004;
    const p = g.gain;
    p.setValueAtTime(0, s);
    p.linearRampToValueAtTime(pk, s + 0.012);
    p.linearRampToValueAtTime(pk * 0.5, s + len - 0.03);
    p.linearRampToValueAtTime(0, s + len);
    src.connect(g).connect(chain());
    const off = ((k++ * 0.2371) % Math.max(0.05, env.noise.duration - len - 0.1)) + 0.02;
    src.start(s, off);
    src.stop(s + len + 0.02);
    bump(env, t, 2, 1);
  };
}
