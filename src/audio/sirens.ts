/**
 * Emergency sirens (WP8) — procedural, no assets. Three voices, one per responder, each following the nearest
 * vehicle of its kind that is driving with sirens on:
 *   fire     'wail'   slow up / down sweep (≈ 4 s period)
 *   police   'yelp'   fast sweep (≈ 3.5 Hz)
 *   medical  'hi-lo'  two alternating tones (≈ 1 Hz)
 * Gain falls off with the camera distance, pan follows the screen x of the source, everything fades out while the
 * game is paused or nothing drives. Output: the audio engine's SFX bus (AudioEngine.getSfxOutput()), so SFX volume
 * and mute apply; while the engine returns null (not started, suspended, muted) the voices are torn down.
 *
 *   const sirens = new Sirens(() => audio.getSfxOutput());
 *   ~2 Hz: sirens.update([{ responder: 'fire', distance: 320, pan: -0.2 }, ...], paused);
 */

export interface SirenOut {
  ctx: BaseAudioContext;
  dest: AudioNode;
}

export type SirenKind = 'fire' | 'police' | 'medical';

/** one audible source, already projected: camera distance (m) and stereo position (-1..1) */
export interface SirenSource {
  responder: SirenKind | string;
  distance: number;
  pan: number;
}

interface Voice {
  osc: OscillatorNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: StereoPannerNode | null;
}

const KINDS: SirenKind[] = ['fire', 'police', 'medical'];
/** base frequency, LFO shape / rate / depth, filter cutoff, peak gain */
const VOICE: Record<SirenKind, { f: number; lfo: OscillatorType; rate: number; depth: number; cutoff: number; peak: number }> = {
  fire: { f: 900, lfo: 'triangle', rate: 0.24, depth: 380, cutoff: 2600, peak: 0.09 },
  police: { f: 950, lfo: 'sawtooth', rate: 3.4, depth: 360, cutoff: 3000, peak: 0.075 },
  medical: { f: 860, lfo: 'square', rate: 0.95, depth: 95, cutoff: 2400, peak: 0.07 },
};
/** audible up to this camera distance (m) */
const RANGE = 1400;

/** distance attenuation 0..1 */
export function sirenGain(distance: number): number {
  if (!(distance >= 0)) return 0;
  const f = Math.max(0, 1 - distance / RANGE);
  return f * f;
}

export class Sirens {
  private voices = new Map<SirenKind, Voice>();
  private out: SirenOut | null = null;
  /** updates in a row with nothing audible (voices are released after a few seconds of silence) */
  private idle = 0;

  constructor(private getOut: () => SirenOut | null) {}

  /** set the audible sources (nearest per kind wins); paused -> silence */
  update(sources: readonly SirenSource[], paused: boolean): void {
    const out = this.getOut();
    if (!out) {
      this.stopAll();
      return;
    }
    if (out !== this.out && this.out && out.ctx !== this.out.ctx) this.stopAll();
    this.out = out;
    const best = new Map<SirenKind, SirenSource>();
    if (!paused) {
      for (const s of sources) {
        const k = s.responder as SirenKind;
        if (!VOICE[k]) continue;
        const b = best.get(k);
        if (!b || s.distance < b.distance) best.set(k, s);
      }
    }
    const t = out.ctx.currentTime;
    let audible = false;
    for (const k of KINDS) {
      const s = best.get(k);
      const g = s ? sirenGain(s.distance) * VOICE[k].peak : 0;
      if (g > 1e-4) audible = true;
      let v = this.voices.get(k);
      if (!v) {
        if (g <= 1e-4) continue;
        v = this.makeVoice(out, k);
        this.voices.set(k, v);
      }
      v.gain.gain.setTargetAtTime(g, t, 0.25);
      if (s && v.panner) v.panner.pan.setTargetAtTime(Math.max(-0.95, Math.min(0.95, s.pan)), t, 0.2);
      // farther sirens sound duller
      if (s) v.filter.frequency.setTargetAtTime(VOICE[k].cutoff * (0.45 + 0.55 * Math.max(0, 1 - s.distance / RANGE)), t, 0.3);
    }
    this.idle = audible ? 0 : this.idle + 1;
    if (this.idle > 8 && this.voices.size) this.stopAll();
  }

  private makeVoice(out: SirenOut, k: SirenKind): Voice {
    const c = out.ctx;
    const p = VOICE[k];
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = p.f;
    const lfo = c.createOscillator();
    lfo.type = p.lfo;
    lfo.frequency.value = p.rate;
    const lfoGain = c.createGain();
    lfoGain.gain.value = p.depth;
    lfo.connect(lfoGain).connect(osc.frequency);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = p.cutoff;
    filter.Q.value = 0.7;
    const gain = c.createGain();
    gain.gain.value = 0;
    let panner: StereoPannerNode | null = null;
    osc.connect(filter).connect(gain);
    if (typeof (c as AudioContext).createStereoPanner === 'function') {
      panner = (c as AudioContext).createStereoPanner();
      gain.connect(panner).connect(out.dest);
    } else gain.connect(out.dest);
    const t = c.currentTime;
    osc.start(t);
    lfo.start(t);
    return { osc, lfo, lfoGain, filter, gain, panner };
  }

  /** fade out and release every voice */
  stopAll(): void {
    for (const v of this.voices.values()) {
      try {
        const t = v.osc.context.currentTime;
        v.gain.gain.setTargetAtTime(0, t, 0.08);
        v.osc.stop(t + 0.5);
        v.lfo.stop(t + 0.5);
        v.osc.onended = () => {
          v.osc.disconnect();
          v.lfo.disconnect();
          v.lfoGain.disconnect();
          v.filter.disconnect();
          v.gain.disconnect();
          v.panner?.disconnect();
        };
      } catch {
        /* context closed */
      }
    }
    this.voices.clear();
  }

  get active(): number {
    return this.voices.size;
  }

  dispose(): void {
    this.stopAll();
    this.out = null;
  }
}
