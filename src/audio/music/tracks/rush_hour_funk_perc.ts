/**
 * Private helper for "Rush Hour" (rush_hour_funk.ts): a CPU-light percussion voice for dense 16th-note parts.
 *
 * The library's inst.hat()/inst.shaker() build a small graph per hit (noise source + envelope gain). A funk groove
 * wants 16th hats and a 16th tambourine for minutes, which would add ~2.4 nodes per hit (~30 nodes/s). A NoiseVoice
 * instead runs ONE looped noise source into ONE gain for the whole song and plays every hit as automation events on
 * that gain, routed into a regular library channel (so the channel's filters, EQ, pan, level and reverb still apply).
 * Being a single voice it chokes naturally: a new hit never overlaps the previous one (an open hat is cut by the next
 * closed hat, as on a real kit).
 *
 * Conventions follow synth.ts: every envelope starts and ends at exactly 0, amplitude ~ vel^1.5, notes at or after
 * inst.cutoff are dropped, live notes already in the past are dropped, and the lab's mute/solo sets are honoured.
 * The source is stopped at the end of the song (or when the director stops it early).
 */
import type { MusicEnv } from '../types';

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const vc = (v: number): number => Math.pow(clamp(v, 0, 1), 1.5);

export class NoiseVoice {
  private readonly g: GainNode;
  private readonly src: AudioBufferSourceNode;
  /** time the last scheduled envelope is back at 0 */
  private last = -Infinity;
  private stopAt = Infinity;

  /**
   * @param name   mute/solo key (e.g. 'hat'); the lab's inst.mute / inst.solo use instrument names
   * @param dest   channel input, e.g. env.inst.channel('hat').input
   * @param scale  peak amplitude at vel 1 (inst.hat uses 0.45, inst.shaker 0.3)
   */
  constructor(private readonly env: MusicEnv, private readonly name: string, dest: AudioNode, t0: number, t1: number, private readonly scale: number, offset = 0) {
    const ctx = env.ctx;
    this.src = ctx.createBufferSource();
    this.src.buffer = env.noise;
    this.src.loop = true;
    this.g = ctx.createGain();
    this.g.gain.value = 0;
    this.src.connect(this.g).connect(dest);
    const start = Math.max(t0, ctx.currentTime);
    this.src.start(start, offset % Math.max(0.1, env.noise.duration - 0.05));
    this.src.stop(Math.max(start + 0.1, t1));
  }

  private ok(t: number): boolean {
    const inst = this.env.inst;
    if (!isFinite(t) || t >= inst.cutoff || t >= this.stopAt) return false;
    if (this.env.live && t < this.env.ctx.currentTime + 0.005) return false;
    if (inst.mute.has(this.name) || (inst.solo.size > 0 && !inst.solo.has(this.name))) return false;
    return true;
  }

  /**
   * One hit: attack `att` s to the peak, exponential decay over `dec` s, then exactly 0.
   * With `ring` > 0 (open hat) the tone decays slowly for `ring` s and is then choked quickly.
   * `maxLen` caps the whole envelope (so it ends before the next scheduled hit).
   */
  hit(t: number, vel: number, att: number, dec: number, ring = 0, maxLen = Infinity): void {
    if (!this.ok(t)) return;
    if (t < this.last + 0.002) t = this.last + 0.002;
    const peak = this.scale * vc(vel);
    if (peak < 1e-4) return;
    const p = this.g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + att);
    let end: number;
    if (ring > 0) {
      const r = Math.max(0.03, Math.min(ring, maxLen - att - 0.02));
      p.exponentialRampToValueAtTime(peak * 0.28, t + att + r);
      end = t + att + r + 0.018;
    } else {
      const d = Math.max(0.01, Math.min(dec, maxLen - att - 0.005));
      p.exponentialRampToValueAtTime(peak * 1e-3, t + att + d);
      end = t + att + d + 0.004;
    }
    p.linearRampToValueAtTime(0, end);
    this.last = end;
  }

  /** stop producing hits after t and release the source */
  stop(t: number): void {
    const at = Math.max(t, this.env.ctx.currentTime);
    this.stopAt = Math.min(this.stopAt, at);
    try {
      this.g.gain.cancelScheduledValues(at);
      this.g.gain.setValueAtTime(0, at);
      this.src.stop(at + 0.05);
    } catch {
      /* already stopped */
    }
  }
}
