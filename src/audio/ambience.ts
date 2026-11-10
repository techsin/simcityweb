/**
 * Procedural city ambience: filtered noise bed + low traffic hum + distant horns (scale with population and
 * camera zoom), seasonal birds / crickets, winter and alpine wind, surf and gulls near water, construction ticks,
 * and four camera-local district beds sharing the running sources.
 */
import { playVoice, type SfxEnv } from './sfx';
import { oneShots, type OneShot } from './oneShot';
import { Network, Zone, type Climate } from '../core/types';
import { CELL_SIZE } from '../core/constants';
import { BF, type Building } from '../sim/CityState';
import { getDef } from '../sim/catalog';

export interface DistrictMix {
  industry: number;
  parks: number;
  crowd: number;
  airport: number;
  rail: number;
  harbour: number;
  distance: number;
}

/** Only mirrored map data: sampling never asks a simulation system to do work. */
export interface AmbienceDistrictCity {
  readonly size: number;
  readonly building: ArrayLike<number>;
  readonly zone: ArrayLike<number>;
  readonly network: ArrayLike<number>;
  readonly buildings: ReadonlyMap<number, Pick<Building, 'def' | 'built' | 'flags'>>;
}

/** A clipped 7x7 area sample, written into caller-owned scratch. Keep the last local mix above 700 m. */
export function sampleDistrictAmbience(st: AmbienceDistrictCity, worldX: number, worldZ: number,
  distance: number, out: DistrictMix): DistrictMix {
  out.distance = Math.max(0, distance);
  if (distance >= 700) return out;
  out.industry = out.parks = out.crowd = out.airport = out.rail = out.harbour = 0;
  const x = Math.floor(worldX / CELL_SIZE), z = Math.floor(worldZ / CELL_SIZE);
  const x0 = Math.max(0, x - 3), x1 = Math.min(st.size - 1, x + 3);
  const z0 = Math.max(0, z - 3), z1 = Math.min(st.size - 1, z + 3);
  let count = 0;
  for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) {
    const i = zz * st.size + xx;
    const id = st.building[i], zone = st.zone[i], network = st.network[i];
    const b = id >= 0 ? st.buildings.get(id) : undefined;
    const def = b && b.built >= 1 && !(b.flags & BF.Burnt) ? getDef(b.def) : undefined;
    count++;
    if (def?.id.includes('airport')) out.airport++;
    else if (def && (def.id.includes('seaport') || def.id.includes('harbour') || def.id.includes('ferry'))) out.harbour++;
    else if (network === Network.Rail || (def && (def.id.includes('train') || def.id.includes('freight')))) out.rail++;
    else if (def?.category === 'park') out.parks++;
    else if (def?.model.startsWith('ind_') || zone === Zone.IndAg || zone === Zone.IndMed || zone === Zone.IndHigh) out.industry++;
    else if (def?.model.startsWith('com_') || zone === Zone.ComHigh || zone === Zone.ResHigh) out.crowd++;
  }
  if (count) {
    out.industry /= count; out.parks /= count; out.crowd /= count;
    out.airport /= count; out.rail /= count; out.harbour /= count;
  }
  return out;
}

/** Full local detail below 700 m; 18 dB down at 1,500 m, continuing to fade above it. */
export function districtAttenuation(distance: number): number {
  return 10 ** (-18 * Math.max(0, distance - 700) / 800 / 20);
}

export type DistrictLayer = 'industry' | 'parks' | 'crowd' | 'transport';
/** Below this gain, a short linear tail reaches true silence; dB is undefined at zero. */
export const DISTRICT_GAIN_FLOOR = 0.045;

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
  /** simulation month: 0 = January .. 11 = December */
  month?: number;
  climate?: Climate;
  /** cosmetic rain intensity from weather(day, seed) */
  rain?: number;
  /** Camera-local land use; the input object may be reused by the caller. */
  district?: Readonly<DistrictMix>;
}

export type AmbienceEvent = 'bird' | 'cricket' | 'gull';

export interface AmbienceOptions {
  /** false: the offline lab drives tick() on the audio clock instead of a wall-clock timer */
  live?: boolean;
  /** audio-only random stream for repeatable lab renders */
  random?: () => number;
  onEvent?: (kind: AmbienceEvent, time: number) => void;
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
  private rainGain!: GainNode;
  private industryGain!: GainNode;
  private parkFilter!: BiquadFilterNode;
  private parkGain!: GainNode;
  private crowdGain!: GainNode;
  private transportFilter!: BiquadFilterNode;
  private transportGain!: GainNode;
  private district: DistrictMix = { industry: 0, parks: 0, crowd: 0, airport: 0, rail: 0, harbour: 0, distance: Infinity };
  private districtTargets = [-1, -1, -1, -1];
  private p: Omit<Required<AmbienceParams>, 'district'> = { population: 0, zoom: 0.5, night: false, construction: 0, water: 0, activity: 1, month: 0, climate: 'temperate', rain: 0 };
  private random: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBird = 0;
  private nextHorn = 0;
  private nextCricket = 0;
  private nextGull = 0;
  private nextTick = 0;
  private nextJet = 0;
  private jetAt = -Infinity;
  running = false;

  constructor(env: SfxEnv, dest: AudioNode, private options: AmbienceOptions = {}) {
    this.env = env;
    this.random = options.random ?? Math.random;
    this.out = env.ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
  }

  /** Current automated layer gains, exposed for the audio lab. */
  get surfLevel(): number { return this.surfGain?.gain.value ?? 0; }
  get windLevel(): number { return this.windGain?.gain.value ?? 0; }
  get rainLevel(): number { return this.rainGain?.gain.value ?? 0; }
  districtLevel(layer: DistrictLayer): number {
    if (layer === 'industry') return this.industryGain?.gain.value ?? 0;
    if (layer === 'parks') return this.parkGain?.gain.value ?? 0;
    if (layer === 'crowd') return this.crowdGain?.gain.value ?? 0;
    return this.transportGain?.gain.value ?? 0;
  }

  private loopNoise(color: 'white' | 'pink' | 'brown'): AudioBufferSourceNode {
    const ctx = this.env.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = this.random() * 2 - 1;
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

    const rain = this.loopNoise('white');
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = 'lowpass'; rainLp.frequency.value = 4200;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
    rain.connect(rainLp).connect(this.rainGain).connect(this.out);

    // Four local beds borrow the running sources: six processors, no extra source or one-shot voice.
    this.industryGain = ctx.createGain(); this.industryGain.gain.value = 0;
    humMod.connect(this.industryGain).connect(this.out);
    this.parkFilter = ctx.createBiquadFilter();
    this.parkFilter.type = 'bandpass'; this.parkFilter.frequency.value = 1100; this.parkFilter.Q.value = 1.8;
    this.parkGain = ctx.createGain(); this.parkGain.gain.value = 0;
    bed.connect(this.parkFilter).connect(this.parkGain).connect(this.out);
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0;
    this.bedFilter.connect(this.crowdGain).connect(this.out);
    this.transportFilter = ctx.createBiquadFilter();
    this.transportFilter.type = 'bandpass'; this.transportFilter.frequency.value = 220; this.transportFilter.Q.value = 0.7;
    this.transportGain = ctx.createGain(); this.transportGain.gain.value = 0;
    wind.connect(this.transportFilter).connect(this.transportGain).connect(this.out);
    this.districtTargets[0] = this.districtTargets[1] = this.districtTargets[2] = this.districtTargets[3] = -1;
    this.jetAt = -Infinity;
    this.nextJet = t + 30 + this.random() * 30;

    this.sources = [bed, hum, swell, drone, drone2, wind, windLfo, surf, surfLfo, rain];
    for (const s of this.sources) s.start(t);
    this.nodes = [this.bedFilter, this.bedGain, humLp, this.humGain, swellG, humMod, droneLp, droneG, this.windFilter, windLfoG, this.windGain, surfLp, surfAm, surfLfoG, this.surfGain];
    this.nodes.push(rainLp, this.rainGain);
    this.nodes.push(this.industryGain, this.parkFilter, this.parkGain, this.crowdGain, this.transportFilter, this.transportGain);
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(1, t + 2.5);
    this.apply();
    this.nextBird = this.nextCricket = this.nextGull = this.nextHorn = this.nextTick = t;
    if (this.options.live !== false) this.timer = setInterval(() => this.tick(), 200);
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
    if (p.population !== undefined) this.p.population = p.population;
    if (p.zoom !== undefined) this.p.zoom = p.zoom;
    if (p.night !== undefined) this.p.night = p.night;
    if (p.construction !== undefined) this.p.construction = p.construction;
    if (p.water !== undefined) this.p.water = p.water;
    if (p.activity !== undefined) this.p.activity = p.activity;
    if (p.month !== undefined) this.p.month = p.month;
    if (p.climate !== undefined) this.p.climate = p.climate;
    if (p.rain !== undefined) this.p.rain = p.rain;
    if (p.district !== undefined) {
      this.district.industry = p.district.industry;
      this.district.parks = p.district.parks;
      this.district.crowd = p.district.crowd;
      this.district.airport = p.district.airport;
      this.district.rail = p.district.rail;
      this.district.harbour = p.district.harbour;
      this.district.distance = p.district.distance;
    }
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
    const windy = this.p.month === 11 || this.p.month <= 1 || this.p.climate === 'alpine';
    this.bedGain.gain.setTargetAtTime(0.02 + lvl * (0.22 + 0.25 * close) * night * act, t, 0.6);
    this.bedFilter.frequency.setTargetAtTime(380 + close * 900 * lvl, t, 0.6);
    this.humGain.gain.setTargetAtTime(lvl * (0.1 + 0.3 * close) * night * act, t, 0.6);
    this.windGain.gain.setTargetAtTime((0.015 + z * z * 0.14 + (1 - lvl) * 0.03) * (windy ? 1.4 : 1), t, 0.6);
    this.surfGain.gain.setTargetAtTime(Math.max(0, Math.min(1, this.p.water)) * (0.08 + 0.28 * close), t, 0.6);
    this.rainGain.gain.setTargetAtTime(Math.max(0, Math.min(1, this.p.rain)) * (0.12 + 0.12 * close), t, 0.6);
    this.applyDistrict(t);
  }

  /** Hold the current value before retargeting. Above the quiet tail, log ramps change at most 1 dB / 100 ms. */
  private fadeDistrict(node: GainNode, slot: number, target: number, t: number): void {
    if (Math.abs(this.districtTargets[slot] - target) < 0.000001) return;
    this.districtTargets[slot] = target;
    const gain = node.gain, current = Math.max(0, gain.value), floor = DISTRICT_GAIN_FLOOR;
    gain.cancelScheduledValues(t);
    gain.setValueAtTime(current, t);
    if (current < floor && target > floor) {
      gain.linearRampToValueAtTime(floor, t + 0.15);
      gain.exponentialRampToValueAtTime(target, t + 1.5);
    } else if (current > floor && target < floor) {
      gain.exponentialRampToValueAtTime(floor, t + 1.35);
      gain.linearRampToValueAtTime(target, t + 1.5);
    } else if (current >= floor && target >= floor) {
      gain.exponentialRampToValueAtTime(target, t + Math.max(1.5, Math.abs(20 * Math.log10(target / current)) / 10));
    } else gain.linearRampToValueAtTime(target, t + 1.5);
  }

  private applyDistrict(t: number): void {
    const d = this.district, far = districtAttenuation(d.distance);
    const people = this.p.night ? 0.5 : 1;
    const activity = 0.45 + 0.55 * Math.max(0, Math.min(1, this.p.activity));
    this.fadeDistrict(this.industryGain, 0, Math.max(0, Math.min(1, d.industry)) * 0.2 * far * activity, t);
    this.fadeDistrict(this.parkGain, 1, Math.max(0, Math.min(1, d.parks)) * 0.18 * far * people, t);
    this.fadeDistrict(this.crowdGain, 2, Math.max(0, Math.min(1, d.crowd)) * 0.2 * far * people, t);
    const age = t - this.jetAt;
    const jet = age >= 0 && age < 10 ? Math.sin(age / 10 * Math.PI) ** 2 : 0;
    const airport = Math.max(0, Math.min(1, d.airport)), rail = Math.max(0, Math.min(1, d.rail)), harbour = Math.max(0, Math.min(1, d.harbour));
    this.fadeDistrict(this.transportGain, 3, Math.min(1, airport * (0.3 + jet * 0.7) + rail + harbour * 0.65) * 0.2 * far * activity, t);
    // A moving formant over noise suggests distant playground chatter; this is a texture, not recorded speech.
    this.parkFilter.frequency.setTargetAtTime(1050 + Math.sin(t * 2.2) * 280 + Math.sin(t * 0.73) * 170, t, 0.2);
    this.parkFilter.Q.setTargetAtTime(1.8 + Math.sin(t * 1.4) * 0.5, t, 0.2);
    const transport = airport + rail + harbour;
    this.transportFilter.frequency.setTargetAtTime(transport > 0 ? (airport * (260 + 650 * jet) + rail * 130 + harbour * 700) / transport : 220, t, 0.6);
  }

  /** Shared by the live timer and offline lab (200 ms of audio time per tick). */
  tick(): void {
    const ctx = this.env.ctx;
    if (!this.running || (this.options.live !== false && ctx.state !== 'running')) return;
    const now = ctx.currentTime;
    const district = this.district, local = districtAttenuation(district.distance);
    if (district.airport > 0 && this.p.activity > 0 && now >= this.nextJet) {
      this.jetAt = now;
      this.nextJet = now + 30 + this.random() * 30;
    }
    this.applyDistrict(now);
    const lvl = this.cityLevel();
    const close = 1 - Math.min(1, Math.max(0, this.p.zoom));
    // birds by day: seasonal phrase rate, more in small towns and close to the ground
    if (!this.p.night && now > this.nextBird) {
      const m = this.p.month;
      const season = m >= 3 && m <= 7 ? 1 : m === 2 || m === 8 || m === 9 ? 0.5 : 0.15;
      this.nextBird = now + (1.2 + this.random() * 4) / ((0.35 + (1 - lvl) * 0.8 + close * 0.4 + district.parks * local * 0.5) * season);
      if (this.random() < 0.8) this.bird(now + this.random() * 0.2, 0.05 + 0.08 * (1 - lvl * 0.7) * (0.4 + close * 0.6));
    }
    // May-September nights; desert crickets stay active all year
    if (this.p.night && (this.p.climate === 'desert' || (this.p.month >= 4 && this.p.month <= 8)) && now > this.nextCricket) {
      this.nextCricket = now + 0.35 + this.random() * 0.9;
      this.cricket(now + this.random() * 0.1, 0.02 + 0.03 * (1 - lvl * 0.5));
    }
    if ((this.p.water > 0.3 || district.harbour * local > 0.05) && now > this.nextGull) {
      this.nextGull = now + 8 + this.random() * 12;
      this.gull(now, (0.025 + 0.045 * close) * (this.p.water > 0.3 ? 1 : Math.min(1, district.harbour) * local));
    }
    // distant horns in big cities
    const rail = district.rail * local, harbour = district.harbour * local;
    if ((lvl > 0.35 || rail > 0.05 || harbour > 0.05) && this.p.activity > 0 && now > this.nextHorn) {
      if (rail > 0.05 || harbour > 0.05) {
        this.nextHorn = now + 18 + this.random() * 18;
        this.horn(now, (0.03 + 0.05 * close) * Math.max(rail, harbour), rail >= harbour ? 'train' : 'harbour');
      } else {
        this.nextHorn = now + (6 + this.random() * 14) / (lvl * (this.p.night ? 0.4 : 1));
        if (this.nextHorn - now < 40) this.horn(now, 0.03 + 0.05 * close * lvl);
      }
    }
    // construction ticks
    if (this.p.construction > 0.01 && this.p.activity > 0 && now > this.nextTick) {
      this.nextTick = now + (0.6 + this.random() * 2.5) / this.p.construction;
      const nodes = oneShots(ctx).begin();
      const pan = nodes.panner();
      pan.pan.value = this.random() * 1.6 - 0.8;
      const g = nodes.gain();
      g.gain.value = 0.25 + close * 0.4;
      g.connect(pan).connect(this.out);
      const n = 1 + Math.floor(this.random() * 3);
      let pending = n;
      for (let k = 0; k < n; k++) setTimeout(() => {
        if (this.running) {
          playVoice(this.env, 'construct', g, { volume: 1 });
          nodes.hold(ctx.currentTime + 0.1); // construct's last source stops at now + 0.095
        }
        if (--pending === 0) nodes.finish();
      }, k * (110 + this.random() * 60));
    }
  }

  private panned(gain: number, nodes: OneShot): GainNode {
    const pan = nodes.panner();
    pan.pan.value = this.random() * 1.8 - 0.9;
    const g = nodes.gain();
    g.gain.value = gain;
    g.connect(pan).connect(this.out);
    const wet = nodes.gain();
    wet.gain.value = 0.35;
    g.connect(wet).connect(this.env.wet);
    return g;
  }

  /** a short song-bird phrase: FM chirps */
  private bird(t: number, gain: number): void {
    this.options.onEvent?.('bird', t);
    const ctx = this.env.ctx;
    const nodes = oneShots(ctx).begin();
    const dest = this.panned(gain, nodes);
    const base = 2400 + this.random() * 2200;
    const notes = 2 + Math.floor(this.random() * 6);
    const style = this.random();
    let tt = t;
    for (let k = 0; k < notes; k++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = base * (1 + (this.random() - 0.5) * 0.35);
      const dur = style < 0.5 ? 0.05 + this.random() * 0.05 : 0.09 + this.random() * 0.08;
      o.frequency.setValueAtTime(f, tt);
      if (style < 0.5) o.frequency.exponentialRampToValueAtTime(f * (0.7 + this.random() * 0.8), tt + dur);
      else {
        o.frequency.linearRampToValueAtTime(f * 1.3, tt + dur * 0.4);
        o.frequency.linearRampToValueAtTime(f * 0.85, tt + dur);
      }
      const tr = ctx.createOscillator();
      tr.frequency.value = 35 + this.random() * 40;
      const trg = nodes.gain();
      trg.gain.value = f * 0.04;
      tr.connect(trg).connect(o.frequency);
      const g = nodes.gain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(1, tt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + dur);
      o.connect(g).connect(dest);
      o.start(tt);
      tr.start(tt);
      o.stop(tt + dur + 0.02);
      nodes.source(o, tt + dur + 0.02);
      tr.stop(tt + dur + 0.02);
      nodes.source(tr, tt + dur + 0.02);
      tt += dur + 0.02 + this.random() * 0.08;
    }
    nodes.finish();
  }

  /** cricket chirp group: amplitude-pulsed high sine */
  private cricket(t: number, gain: number): void {
    this.options.onEvent?.('cricket', t);
    const ctx = this.env.ctx;
    const nodes = oneShots(ctx).begin();
    const dest = this.panned(gain, nodes);
    const f = 4200 + this.random() * 900;
    const pulses = 3 + Math.floor(this.random() * 4);
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = nodes.gain();
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
    nodes.source(o, t + pulses * 0.045 + 0.05);
    nodes.finish();
  }

  /** a gull's falling cry, lower and longer than the song-bird chirps */
  private gull(t: number, gain: number): void {
    this.options.onEvent?.('gull', t);
    const ctx = this.env.ctx;
    const nodes = oneShots(ctx).begin();
    const dest = this.panned(gain, nodes);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const f = 850 + this.random() * 350;
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * 1.5, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(f * 0.65, t + 0.7);
    const g = nodes.gain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.8);
    nodes.source(o, t + 0.8);
    nodes.finish();
  }

  /** distant car horn (two-tone, heavily filtered) */
  private horn(t: number, gain: number, kind: 'car' | 'train' | 'harbour' = 'car'): void {
    const ctx = this.env.ctx;
    const nodes = oneShots(ctx).begin();
    const dest = this.panned(gain, nodes);
    const lp = nodes.filter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.connect(dest);
    const f = kind === 'car' ? 380 + this.random() * 120 : (kind === 'train' ? 160 : 110) + this.random() * 35;
    const beeps = kind === 'car' && this.random() < 0.3 ? 2 : 1;
    for (let b = 0; b < beeps; b++) {
      const s = t + b * 0.28;
      const dur = kind === 'car' ? 0.16 + this.random() * 0.25 : 0.7 + this.random() * 0.3;
      for (const ff of [f, f * 1.26]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = ff;
        const g = nodes.gain();
        g.gain.setValueAtTime(0.0001, s);
        g.gain.linearRampToValueAtTime(0.5, s + 0.02);
        g.gain.setValueAtTime(0.5, s + dur);
        g.gain.exponentialRampToValueAtTime(0.0001, s + dur + 0.08);
        o.connect(g).connect(lp);
        o.start(s);
        o.stop(s + dur + 0.1);
        nodes.source(o, s + dur + 0.1);
      }
    }
    nodes.finish();
  }
}
