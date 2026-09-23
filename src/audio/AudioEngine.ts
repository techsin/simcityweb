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
 *   audio.startMusic() / stopMusic()     request / release music for the current screen
 *   audio.setMusicContext({ screen: 'menu'|'region'|'city', night, population, activity })   steers track choice
 *   audio.music                          soundtrack player: nowPlaying, list(), next(), prev(), select(id),
 *                                        shuffle (get/set), setShuffle, isEnabled / setEnabled(id, on), onChange(cb)
 *   audio.setMuted(on) / muted
 * Volumes, music toggle, shuffle and the enabled-track set persist in localStorage ('metropolis.audio').
 */
import { playVoice, type PlayOptions, type SfxEnv, type SoundName } from './sfx';
import { Ambience, type AmbienceParams } from './ambience';
import { MusicDirector, type MusicContext, type NowPlaying, type TrackInfo } from './music/director';
import { ALL_TRACKS } from './music/tracks';
import { makeNoiseBuffer, makeReverb } from './music/fx';

export type VolumeKind = 'master' | 'music' | 'sfx' | 'ambience';
export type { MusicContext, NowPlaying, TrackInfo };

/** soundtrack player facade (audio.music) for the music player UI */
export interface MusicControls {
  /** current song (id, title, mood, tags, bpm, enabled, elapsed / duration seconds) or null */
  readonly nowPlaying: NowPlaying | null;
  /** all tracks in playlist order */
  list(): TrackInfo[];
  next(): void;
  prev(): void;
  /** play this track now (turns music on if it was off) */
  select(id: string): void;
  shuffle: boolean;
  setShuffle(on: boolean): void;
  isEnabled(id: string): boolean;
  /** include / exclude a track from the playlist (persisted) */
  setEnabled(id: string, on: boolean): void;
  /** fires on track change, playlist / shuffle edits and music on/off; returns unsubscribe */
  onChange(cb: () => void): () => void;
}

interface Prefs {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  musicOn: boolean;
  muted: boolean;
  musicShuffle: boolean;
  /** track ids switched off in the music player */
  musicDisabled: string[];
}

const PREFS_KEY = 'metropolis.audio';
const DEFAULT_PREFS: Prefs = { master: 0.8, music: 0.55, sfx: 0.8, ambience: 0.7, musicOn: true, muted: false, musicShuffle: true, musicDisabled: [] };

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
  private director = new MusicDirector(ALL_TRACKS, {
    load: () => ({ shuffle: this.prefs.musicShuffle !== false, disabled: Array.isArray(this.prefs.musicDisabled) ? this.prefs.musicDisabled : [] }),
    save: (p) => {
      this.prefs.musicShuffle = p.shuffle;
      this.prefs.musicDisabled = [...p.disabled];
      this.save();
    },
  });
  /** music's reverb send (follows the music volume) */
  private musicReverb: GainNode | null = null;
  private wantAmbience = false;
  private pendingAmbience: AmbienceParams = {};
  private wantMusic = false;
  private lastHover = 0;
  private lastPlay = new Map<string, number>();
  private listeners = new Set<Listener>();
  private autoInitAttached = false;

  /** soundtrack player (see MusicControls) */
  readonly music: MusicControls = (() => {
    const d = this.director;
    const self = this;
    return {
      get nowPlaying() {
        return d.nowPlaying;
      },
      list: () => d.list(),
      next: () => d.next(),
      prev: () => d.prev(),
      select: (id: string) => {
        d.select(id);
        if (!self.prefs.musicOn) self.setMusicEnabled(true);
        else if (!d.playing) self.startMusic();
      },
      get shuffle() {
        return d.shuffle;
      },
      set shuffle(on: boolean) {
        d.shuffle = on;
      },
      setShuffle: (on: boolean) => d.setShuffle(on),
      isEnabled: (id: string) => d.isEnabled(id),
      setEnabled: (id: string, on: boolean) => d.setEnabled(id, on),
      onChange: (cb: () => void) => {
        const a = d.onChange(cb);
        const b = self.onChange(cb);
        return () => {
          a();
          b();
        };
      },
    };
  })();

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
    // shared hall reverb + noise (src/audio/music/fx.ts - the audio lab renders through the same ones)
    const rv = makeReverb(ctx);
    this.reverbIn = rv.input;
    rv.output.connect(this.master);
    const noise = makeNoiseBuffer(ctx);
    this.env = { ctx, out: this.buses.sfx, wet: this.reverbIn, noise };
    // music reverb send: goes through the music volume (and mute) like the dry signal
    const musicRev = ctx.createGain();
    musicRev.gain.value = 1;
    this.musicReverb = musicRev;
    musicRev.connect(this.reverbIn);
    this.director.attach(ctx, this.buses.music, musicRev, noise);
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
    this.director.start();
  }

  stopMusic(): void {
    this.wantMusic = false;
    this.director.stop();
  }

  setMusicEnabled(on: boolean): void {
    this.prefs.musicOn = on;
    this.save();
    if (on) {
      this.wantMusic = true;
      this.startMusic();
    } else this.director.stop();
    this.emit();
  }

  /** tell the soundtrack where the player is (menu / region / city by day or night, city size, liveliness) */
  setMusicContext(c: Partial<MusicContext>): void {
    this.director.setContext(c);
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

  // ------------------------------------------------------------------ fireworks (src/audio/fireworks.ts)
  /** raw SFX output for procedural one-shots (New Year fireworks); null before init, while suspended or muted */
  getSfxOutput(): { ctx: AudioContext; dest: AudioNode; wet: AudioNode; noise: AudioBuffer } | null {
    if (!this.ctx || this.ctx.state !== 'running' || this.prefs.muted || !this.env) return null;
    return { ctx: this.ctx, dest: this.buses.sfx, wet: this.reverbIn, noise: this.env.noise };
  }

  private applyVolumes(immediate = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => (immediate ? p.setValueAtTime(v, t) : p.setTargetAtTime(v, t, 0.05));
    // perceptual curve
    const curve = (v: number) => v * v;
    set(this.master.gain, this.prefs.muted ? 0 : curve(this.prefs.master));
    set(this.buses.music.gain, curve(this.prefs.music) * 0.9);
    if (this.musicReverb) set(this.musicReverb.gain, curve(this.prefs.music) * 0.9);
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
