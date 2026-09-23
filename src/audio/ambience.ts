/**
 * Procedural city ambience: filtered noise bed + low traffic hum + distant horns (scale with population and
 * camera zoom), birds by day / crickets at night, wind when zoomed out, surf near water, construction ticks.
 */
import { playVoice, type SfxEnv } from './sfx';

export interface AmbienceParams {
  /** city population (0 .. 1M+) */
  population?: number;
  /** camera zoom 0 = street level (close) .. 1 = whole city (far) */
  zoom?: number;
  /** true at night (crickets instead of birds, calmer traffic) */
  night?: boolean;
  /** 0..1 construction activity (occasional hammer ticks) */
  construction?: number;
  /** 0..1 amount of water / coast in view (surf) */
  water?: number;
  /** 0..1 simulation speed factor (0 = paused: city bed quieter, no horns) */
  activity?: number;
}

export class Ambience {
  private env: SfxEnv;
  private out: GainNode;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private bedGain!: GainNode;
  private bedFilter!: BiquadFilterNode;
  private humGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private surfGain!: GainNode;
  private p: Required<AmbienceParams> = { population: 0, zoom: 0.5, night: false, construction: 0, water: 0, activity: 1 };
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBird = 0;
  private nextHorn = 0;
  private nextCricket = 0;
  private nextTick = 0;
  running = false;

  constructor(env: SfxEnv, dest: AudioNode) {
    this.env = env;
    this.out = env.ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
  }

  private loopNoise(color: 'white' | 'pink' | 'brown'): AudioBufferSourceNode {
    const ctx = this.env.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (color === 'white') d[i] = w * 0.5;
        else if (color === 'pink') {
          b0 = 0.99765 * b0 + w * 0.099046;
          b1 = 0.963 * b1 + w * 0.2965164;
          b2 = 0.57 * b2 + w * 1.0526913;
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
        } else {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.2;
        }
      }
      // smooth the loop seam
      for (let i = 0; i < 2048; i++) {
        const k = i / 2048;
        d[i] = d[i] * k + d[len - 2048 + i] * (1 - k);
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopEnd = (len - 2048) / ctx.sampleRate;
    return src;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const ctx = this.env.ctx;
    const t = ctx.currentTime;
    // --- city bed (distant murmur)
    const bed = this.loopNoise('pink');
    this.bedFilter = ctx.createBiquadFilter();
    this.bedFilter.type = 'bandpass';
    this.bedFilter.frequency.value = 500;
    this.bedFilter.Q.value = 0.6;
    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0;
    bed.connect(this.bedFilter).connect(this.bedGain).connect(this.out);
    // --- traffic hum: brown noise lowpassed + slow swell
    const hum = this.loopNoise('brown');
    const humLp = ctx.createBiquadFilter();
    humLp.type = 'lowpass';
    humLp.frequency.value = 220;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.07;
    const swellG = ctx.createGain();
    swellG.gain.value = 0.25;
    const humMod = ctx.createGain();
    humMod.gain.value = 1;
    swell.connect(swellG).connect(humMod.gain);
    hum.connect(humLp).connect(humMod).connect(this.humGain).connect(this.out);
    // engine drone partials
    const drone = ctx.createOscillator();
    drone.type = 'sawtooth';
    drone.frequency.value = 48;
    const drone2 = ctx.createOscillator();
    drone2.type = 'sawtooth';
    drone2.frequency.value = 50.7;
    const droneLp = ctx.createBiquadFilter();
    droneLp.type = 'lowpass';
    droneLp.frequency.value = 110;
    const droneG = ctx.createGain();
    droneG.gain.value = 0.05;
    drone.connect(droneLp);
    drone2.connect(droneLp);
    droneLp.connect(droneG).connect(humMod);
    // --- wind (zoomed out)
    const wind = this.loopNoise('pink');
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 1.4;
    this.windFilter.frequency.value = 600;
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.11;
    const windLfoG = ctx.createGain();
    windLfoG.gain.value = 300;
    windLfo.connect(windLfoG).connect(this.windFilter.frequency);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.out);
    // --- surf
    const surf = this.loopNoise('pink');
    const surfLp = ctx.createBiquadFilter();
    surfLp.type = 'lowpass';
    surfLp.frequency.value = 900;
    const surfAm = ctx.createGain();
    surfAm.gain.value = 0.5;
    const surfLfo = ctx.createOscillator();
    surfLfo.frequency.value = 0.12;
    const surfLfoG = ctx.createGain();
    surfLfoG.gain.value = 0.45;
    surfLfo.connect(surfLfoG).connect(surfAm.gain);
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0;
    surf.connect(surfLp).connect(surfAm).connect(this.surfGain).connect(this.out);

    this.sources = [bed, hum, swell, drone, drone2, wind, windLfo, surf, surfLfo];
    for (const s of this.sources) s.start(t);
    this.nodes = [this.bedFilter, this.bedGain, humLp, this.humGain, swellG, humMod, droneLp, droneG, this.windFilter, windLfoG, this.windGain, surfLp, surfAm, surfLfoG, this.surfGain];
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(1, t + 2.5);
    this.apply();
    this.timer = setInterval(() => this.tick(), 200);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const t = this.env.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + 1);
    const srcs = this.sources, nodes = this.nodes;
    this.sources = [];
    this.nodes = [];
    for (const s of srcs) s.stop(t + 1.1);
    setTimeout(() => nodes.forEach((n) => n.disconnect()), 1500);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  set(p: AmbienceParams): void {
    Object.assign(this.p, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    if (this.running) this.apply();
  }

  /** 0..1 how "big" the city sounds */
  private cityLevel(): number {
    const pop = Math.max(0, this.p.population);
    return Math.min(1, Math.log10(1 + pop / 50) / 4.2);
  }

  private apply(): void {
    const t = this.env.ctx.currentTime;
    const lvl = this.cityLevel();
    const z = Math.min(1, Math.max(0, this.p.zoom));
    const close = 1 - z;
    const night = this.p.night ? 0.6 : 1;
    const act = 0.45 + 0.55 * Math.min(1, this.p.activity);
    const ramp = (param: AudioParam, v: number) => param.setTargetAtTime(v, t, 0.6);
    ramp(this.bedGain.gain, 0.02 + lvl * (0.22 + 0.25 * close) * night * act);
    ramp(this.bedFilter.frequency, 380 + close * 900 * lvl);
    ramp(this.humGain.gain, lvl * (0.1 + 0.3 * close) * night * act);
    ramp(this.windGain.gain, 0.015 + z * z * 0.14 + (1 - lvl) * 0.03);
    ramp(this.surfGain.gain, Math.min(1, this.p.water) * (0.05 + 0.18 * close));
  }

  private tick(): void {
    const ctx = this.env.ctx;
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const lvl = this.cityLevel();
    const close = 1 - Math.min(1, Math.max(0, this.p.zoom));
    // birds by day: more in small towns and when close to the ground
    if (!this.p.night && now > this.nextBird) {
      this.nextBird = now + (1.2 + Math.random() * 4) / (0.35 + (1 - lvl) * 0.8 + close * 0.4);
      if (Math.random() < 0.8) this.bird(now + Math.random() * 0.2, 0.05 + 0.08 * (1 - lvl * 0.7) * (0.4 + close * 0.6));
    }
    // crickets at night
    if (this.p.night && now > this.nextCricket) {
      this.nextCricket = now + 0.35 + Math.random() * 0.9;
      this.cricket(now + Math.random() * 0.1, 0.02 + 0.03 * (1 - lvl * 0.5));
    }
    // distant horns in big cities
    if (lvl > 0.35 && this.p.activity > 0 && now > this.nextHorn) {
      this.nextHorn = now + (6 + Math.random() * 14) / (lvl * (this.p.night ? 0.4 : 1));
      if (this.nextHorn - now < 40) this.horn(now, 0.03 + 0.05 * close * lvl);
    }
    // construction ticks
    if (this.p.construction > 0.01 && this.p.activity > 0 && now > this.nextTick) {
      this.nextTick = now + (0.6 + Math.random() * 2.5) / this.p.construction;
      const pan = this.env.ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      const g = this.env.ctx.createGain();
      g.gain.value = 0.25 + close * 0.4;
      g.connect(pan).connect(this.out);
      const n = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) setTimeout(() => this.running && playVoice(this.env, 'construct', g, { volume: 1 }), k * (110 + Math.random() * 60));
    }
  }

  private panned(gain: number): GainNode {
    const ctx = this.env.ctx;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.8 - 0.9;
    const g = ctx.createGain();
    g.gain.value = gain;
    g.connect(pan).connect(this.out);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    g.connect(wet).connect(this.env.wet);
    return g;
  }

  /** a short song-bird phrase: FM chirps */
  private bird(t: number, gain: number): void {
    const ctx = this.env.ctx;
    const dest = this.panned(gain);
    const base = 2400 + Math.random() * 2200;
    const notes = 2 + Math.floor(Math.random() * 6);
    const style = Math.random();
    let tt = t;
    for (let k = 0; k < notes; k++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = base * (1 + (Math.random() - 0.5) * 0.35);
      const dur = style < 0.5 ? 0.05 + Math.random() * 0.05 : 0.09 + Math.random() * 0.08;
      o.frequency.setValueAtTime(f, tt);
      if (style < 0.5) o.frequency.exponentialRampToValueAtTime(f * (0.7 + Math.random() * 0.8), tt + dur);
      else {
        o.frequency.linearRampToValueAtTime(f * 1.3, tt + dur * 0.4);
        o.frequency.linearRampToValueAtTime(f * 0.85, tt + dur);
      }
      const tr = ctx.createOscillator();
      tr.frequency.value = 35 + Math.random() * 40;
      const trg = ctx.createGain();
      trg.gain.value = f * 0.04;
      tr.connect(trg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(1, tt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + dur);
      o.connect(g).connect(dest);
      o.start(tt);
      tr.start(tt);
      o.stop(tt + dur + 0.02);
      tr.stop(tt + dur + 0.02);
      tt += dur + 0.02 + Math.random() * 0.08;
    }
  }

  /** cricket chirp group: amplitude-pulsed high sine */
  private cricket(t: number, gain: number): void {
    const ctx = this.env.ctx;
    const dest = this.panned(gain);
    const f = 4200 + Math.random() * 900;
    const pulses = 3 + Math.floor(Math.random() * 4);
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g).connect(dest);
    for (let k = 0; k < pulses; k++) {
      const s = t + k * 0.045;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(1, s + 0.008);
      g.gain.linearRampToValueAtTime(0, s + 0.03);
    }
    o.start(t);
    o.stop(t + pulses * 0.045 + 0.05);
  }

  /** distant car horn (two-tone, heavily filtered) */
  private horn(t: number, gain: number): void {
    const ctx = this.env.ctx;
    const dest = this.panned(gain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.connect(dest);
    const f = 380 + Math.random() * 120;
    const beeps = Math.random() < 0.3 ? 2 : 1;
    for (let b = 0; b < beeps; b++) {
      const s = t + b * 0.28;
      const dur = 0.16 + Math.random() * 0.25;
      for (const ff of [f, f * 1.26]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = ff;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, s);
        g.gain.linearRampToValueAtTime(0.5, s + 0.02);
        g.gain.setValueAtTime(0.5, s + dur);
        g.gain.exponentialRampToValueAtTime(0.0001, s + dur + 0.08);
        o.connect(g).connect(lp);
        o.start(s);
        o.stop(s + dur + 0.1);
      }
    }
  }
}
