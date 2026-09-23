/**
 * AudioEngine — fully procedural WebAudio (no asset files).
 *
 *   audio.init()                         create / resume the AudioContext (call from a user gesture; safe to repeat)
 *   audio.attachAutoInit()               init on the first pointerdown / keydown (main.ts does this once)
 *   audio.play(name, opts?)              one-shot UI / game sound (see SoundName)
 *   audio.hover()                        throttled soft hover sound
 *   audio.startAmbience() / stopAmbience()
 *   audio.setAmbience({ population, zoom, night, construction, water, activity })
 *   audio.setVolume(kind, v) / getVolume(kind)   kind: 'master' | 'music' | 'sfx' | 'ambience', v in 0..1
 *   audio.setMusicEnabled(on) / musicEnabled / toggleMusic()
 *   audio.setMuted(on) / muted
 * Volumes + music toggle persist in localStorage ('metropolis.audio').
 */
import { playVoice, type PlayOptions, type SfxEnv, type SoundName } from './sfx';
import { Ambience, type AmbienceParams } from './ambience';
import { MusicGenerator } from './music';

export type VolumeKind = 'master' | 'music' | 'sfx' | 'ambience';

interface Prefs {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  musicOn: boolean;
  muted: boolean;
}

const PREFS_KEY = 'metropolis.audio';
const DEFAULT_PREFS: Prefs = { master: 0.8, music: 0.55, sfx: 0.8, ambience: 0.7, musicOn: true, muted: false };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PREFS };
}

type Listener = () => void;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private prefs: Prefs = loadPrefs();
  private master!: GainNode;
  private buses = {} as Record<Exclude<VolumeKind, 'master'>, GainNode>;
  private reverbIn!: GainNode;
  private env!: SfxEnv;
  private ambience: Ambience | null = null;
  private music: MusicGenerator | null = null;
  private wantAmbience = false;
  private pendingAmbience: AmbienceParams = {};
  private wantMusic = false;
  private lastHover = 0;
  private lastPlay = new Map<string, number>();
  private listeners = new Set<Listener>();
  private autoInitAttached = false;

  /** true once the AudioContext exists and is running */
  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** create / resume the AudioContext. Returns false when WebAudio is unavailable. */
  init(): boolean {
    if (typeof window === 'undefined') return false;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    let ctx: AudioContext;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      return false;
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    // gentle glue compressor on the master
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    for (const k of ['music', 'sfx', 'ambience'] as const) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[k] = g;
    }
    // shared reverb
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.35;
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 2.6, 2.2);
    const rvOut = ctx.createGain();
    rvOut.gain.value = 0.7;
    this.reverbIn.connect(conv).connect(rvOut).connect(this.master);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.env = { ctx, out: this.buses.sfx, wet: this.reverbIn, noise };
    this.applyVolumes(true);
    if (ctx.state === 'suspended') void ctx.resume();
    if (this.wantMusic && this.prefs.musicOn) this.startMusic();
    if (this.wantAmbience) this.startAmbience();
    this.emit();
    return true;
  }

  /** init on the first user gesture (autoplay policy) */
  attachAutoInit(target: Window | HTMLElement = window): void {
    if (this.autoInitAttached || typeof window === 'undefined') return;
    this.autoInitAttached = true;
    const go = () => {
      this.init();
      if (this.ctx?.state === 'running') {
        target.removeEventListener('pointerdown', go, true);
        target.removeEventListener('keydown', go, true);
      }
    };
    target.addEventListener('pointerdown', go, true);
    target.addEventListener('keydown', go, true);
  }

  // ------------------------------------------------------------------ sfx
  play(name: SoundName, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.prefs.muted) return;
    // avoid machine-gunning the same sound
    const now = performance.now();
    const last = this.lastPlay.get(name) ?? 0;
    if (now - last < (name === 'construct' ? 30 : 45)) return;
    this.lastPlay.set(name, now);
    let dest: AudioNode = this.buses.sfx;
    const v = opts.volume ?? 1;
    if (v !== 1 || opts.pan) {
      const g = ctx.createGain();
      g.gain.value = v;
      if (opts.pan) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, opts.pan));
        g.connect(p).connect(this.buses.sfx);
      } else g.connect(this.buses.sfx);
      dest = g;
      setTimeout(() => g.disconnect(), 4000);
    }
    playVoice(this.env, name, dest, opts);
  }

  /** throttled soft hover blip for menus / toolbars */
  hover(): void {
    const now = performance.now();
    if (now - this.lastHover < 70) return;
    this.lastHover = now;
    this.play('hover');
  }

  // ------------------------------------------------------------------ ambience
  startAmbience(): void {
    this.wantAmbience = true;
    if (!this.ctx) return;
    if (!this.ambience) this.ambience = new Ambience(this.env, this.buses.ambience);
    this.ambience.set(this.pendingAmbience);
    this.ambience.start();
  }

  stopAmbience(): void {
    this.wantAmbience = false;
    this.ambience?.stop();
  }

  setAmbience(p: AmbienceParams): void {
    Object.assign(this.pendingAmbience, p);
    this.ambience?.set(p);
  }

  // ------------------------------------------------------------------ music
  get musicEnabled(): boolean {
    return this.prefs.musicOn;
  }

  /** request music playback for the current screen (starts once the context exists and music is enabled) */
  startMusic(): void {
    this.wantMusic = true;
    if (!this.ctx || !this.prefs.musicOn) return;
    if (!this.music) this.music = new MusicGenerator(this.ctx, this.buses.music, this.reverbIn, this.env.noise);
    this.music.start();
  }

  stopMusic(): void {
    this.wantMusic = false;
    this.music?.stop();
  }

  setMusicEnabled(on: boolean): void {
    this.prefs.musicOn = on;
    this.save();
    if (on) {
      if (this.wantMusic || !this.music) {
        this.wantMusic = true;
        this.startMusic();
      }
    } else this.music?.stop();
    this.emit();
  }

  toggleMusic(): boolean {
    this.setMusicEnabled(!this.prefs.musicOn);
    return this.prefs.musicOn;
  }

  // ------------------------------------------------------------------ volumes
  getVolume(kind: VolumeKind): number {
    return this.prefs[kind];
  }

  setVolume(kind: VolumeKind, v: number): void {
    this.prefs[kind] = Math.max(0, Math.min(1, v));
    this.save();
    this.applyVolumes();
    this.emit();
  }

  get muted(): boolean {
    return this.prefs.muted;
  }

  setMuted(m: boolean): void {
    this.prefs.muted = m;
    this.save();
    this.applyVolumes();
    this.emit();
  }

  /** subscribe to volume / music toggle changes (for settings UI); returns unsubscribe */
  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  private applyVolumes(immediate = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => (immediate ? p.setValueAtTime(v, t) : p.setTargetAtTime(v, t, 0.05));
    // perceptual curve
    const curve = (v: number) => v * v;
    set(this.master.gain, this.prefs.muted ? 0 : curve(this.prefs.master));
    set(this.buses.music.gain, curve(this.prefs.music) * 0.9);
    set(this.buses.sfx.gain, curve(this.prefs.sfx));
    set(this.buses.ambience.gain, curve(this.prefs.ambience));
  }

  private save(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* ignore */
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/** stereo decaying-noise impulse response */
function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45; // darken
      d[i] = lp * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
    }
  }
  return buf;
}
