/**
 * Shared DSP resources: deterministic white-noise buffer and the stereo hall reverb used by the game (music + sfx)
 * and by the offline audio lab (so renders match the game).
 */
import { RNG } from '../../core/rng';

/** mono white noise (default 2 s), deterministic for a given seed */
export function makeNoiseBuffer(ctx: BaseAudioContext, seconds = 2, seed = 7): AudioBuffer {
  const rng = new RNG(seed);
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rng.next() * 2 - 1;
  return buf;
}

/**
 * Stereo hall impulse response: 12 ms pre-delay, sparse early reflections, then decorrelated noise with an
 * exponential decay (T60 ~ seconds * 0.85) whose high frequencies die faster than the lows (air / wall damping).
 */
export function makeImpulse(ctx: BaseAudioContext, seconds = 2.8, seed = 11): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const rng = new RNG(seed);
  const pre = Math.floor(sr * 0.012);
  const t60 = seconds * 0.85;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    // early reflections
    for (let k = 0; k < 9; k++) {
      const at = pre + Math.floor(sr * (0.004 + rng.next() * 0.075));
      if (at < len) d[at] += (rng.next() < 0.5 ? -1 : 1) * (0.5 - k * 0.04) * (0.6 + rng.next() * 0.4);
    }
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      // damping filter coefficient falls with time -> the tail darkens
      const a = 0.12 + 0.7 * Math.exp(-t / 0.55);
      lp += a * (rng.next() * 2 - 1 - lp);
      const envl = Math.exp((-6.91 * t) / t60) * Math.min(1, t / 0.02);
      d[i] += lp * envl * 1.4;
    }
    // fade the last 60 ms
    const f = Math.floor(sr * 0.06);
    for (let i = 0; i < f; i++) d[len - 1 - i] *= i / f;
  }
  return buf;
}

export interface Reverb {
  /** send into the reverb (gain 0.35, as the game has always used) */
  input: GainNode;
  /** wet return (gain 0.7) - connect to the master / destination */
  output: GainNode;
  convolver: ConvolverNode;
}

export function makeReverb(ctx: BaseAudioContext): Reverb {
  const input = ctx.createGain();
  input.gain.value = 0.35;
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx);
  const output = ctx.createGain();
  output.gain.value = 0.7;
  input.connect(convolver).connect(output);
  return { input, output, convolver };
}
