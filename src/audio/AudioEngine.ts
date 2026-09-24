/**
 * AudioEngine — fully procedural WebAudio (no asset files).
 *
 *   audio.init()                         create / resume the AudioContext (call from a user gesture; safe to repeat)
 *   audio.attachAutoInit()               init on the first pointerdown / keydown (main.ts does this once)
 *   audio.play(name, opts?)              one-shot UI / game sound (see SoundName / SOUND_META; opts: volume, pan, pitch, intensity)
 *   audio.hover()                        throttled soft hover sound
 *   audio.uiSounds / setUiSounds(on), hoverSounds / setHoverSounds(on), nowPlayingToasts / setNowPlayingToasts(on)
 *   audio.playCount                      play() request counter, hover blips aside (delegated UI sounds de-dup,
 *                                        src/ui/uiSounds.ts); audio.sinceLastPlay() ms since a sound played
 *   audio.startAmbience() / stopAmbience()
 *   audio.setAmbience({ population, zoom, night, construction, water, activity })
 *   audio.setVolume(kind, v) / getVolume(kind)   kind: 'master' | 'music' | 'sfx' | 'ambience', v in 0..1
 *   audio.setMusicEnabled(on) / musicEnabled / toggleMusic()
 *   audio.startMusic() / stopMusic()     request / release music for the current screen
 *   audio.setMusicContext({ screen: 'menu'|'region'|'city', night, population, activity })   steers track choice
 *   audio.music                          soundtrack player: nowPlaying, list(), next(), prev(), select(id),
 *                                        shuffle (get/set), setShuffle, isEnabled / setEnabled(id, on), onChange(cb)
 *   audio.setMuted(on) / muted
 * Volumes, music toggle, shuffle, the enabled-track set and the UI / hover / now-playing toggles persist in
 * localStorage ('metropolis.audio').
 */
import { playVoice, SOUND_META, type PlayOptions, type SfxEnv, type SoundName } from './sfx';
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
  /** interface sounds (buttons, panels, sliders, tools); game actions + events always play */
  uiSounds: boolean;
  /** soft hover blips on menus / toolbars */
  hoverSounds: boolean;
  /** "Now playing" pop-up when the soundtrack changes track (in the city) */
  nowPlayingToasts: boolean;
}

const PREFS_KEY = 'metropolis.audio';
const DEFAULT_PREFS: Prefs = { master: 0.8, music: 0.55, sfx: 0.8, ambience: 0.7, musicOn: true, muted: false, musicShuffle: true, musicDisabled: [], uiSounds: true, hoverSounds: true, nowPlayingToasts: true };

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
  /** recent play times per sound (repeat attenuation: machine-gunned sounds get gently quieter) */
  private recent = new Map<string, number[]>();
  private lastGroup = new Map<string, number>();
  private serial = 0;
  private lastAnyPlay = -1e9;
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
  /**
   * One-shot sound. Honours mute, the "UI sounds" / "Hover sounds" prefs (SOUND_META[name].cat), a per-sound
   * minimum gap, alert de-dup (one alert-group sound per 150 ms) and a gentle repeat attenuation (a sound played
   * many times in a few seconds gets up to ~4 dB quieter so long build sessions don't fatigue).
   */
  play(name: SoundName, opts: PlayOptions = {}): void {
    const meta = SOUND_META[name];
    if (!meta) return;
    // every request counts (even when rate-limited / muted): the delegated UI handler uses it to avoid doubling up.
    // Hover blips don't: one landing between a click and the handler's deferred check dropped the click's sound
    const soft = name === 'hover' || name === 'tick';
    if (name !== 'hover') this.serial++;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.prefs.muted) return;
    if (meta.cat === 'ui' && this.prefs.uiSounds === false) return;
    if (name === 'hover' && this.prefs.hoverSounds === false) return;
    const now = performance.now();
    const last = this.lastPlay.get(name) ?? -1e9;
    if (now - last < (meta.gap ?? 45)) return;
    if (meta.group) {
      if (now - (this.lastGroup.get(meta.group) ?? -1e9) < 150) return;
      this.lastGroup.set(meta.group, now);
    }
    this.lastPlay.set(name, now);
    if (!soft) this.lastAnyPlay = now;
    let vol = opts.volume ?? 1;
    if (meta.cat !== 'event') {
      const rec = (this.recent.get(name) ?? []).filter((t) => now - t < 3000);
      rec.push(now);
      this.recent.set(name, rec);
      if (rec.length > 3) vol *= Math.max(0.62, 1 - 0.06 * (rec.length - 3));
    }
    playVoice(this.env, name, this.buses.sfx, { ...opts, volume: vol });
  }

  /** number of play() requests so far (the delegated UI sound handler compares it to skip generic feedback) */
  get playCount(): number {
    return this.serial;
  }

  /** ms since the last sound actually played (hover blips and slider ticks aside: they never stand for an action) */
  sinceLastPlay(): number {
    return performance.now() - this.lastAnyPlay;
  }

  /** throttled soft hover blip for menus / toolbars */
  hover(): void {
    if (this.prefs.hoverSounds === false || this.prefs.uiSounds === false) return;
    const now = performance.now();
    if (now - this.lastHover < 70) return;
    this.lastHover = now;
    this.play('hover');
  }

  /** interface sounds on / off (buttons, panels, sliders, tools; persisted) */
  get uiSounds(): boolean {
    return this.prefs.uiSounds !== false;
  }

  setUiSounds(on: boolean): void {
    this.prefs.uiSounds = on;
    this.save();
    this.emit();
  }

  /** hover blips on menus / toolbars (persisted) */
  get hoverSounds(): boolean {
    return this.prefs.hoverSounds !== false;
  }

  setHoverSounds(on: boolean): void {
    this.prefs.hoverSounds = on;
    this.save();
    this.emit();
  }

  /** "Now playing" pop-up on track changes (persisted) */
  get nowPlayingToasts(): boolean {
    return this.prefs.nowPlayingToasts !== false;
  }

  setNowPlayingToasts(on: boolean): void {
    this.prefs.nowPlayingToasts = on;
    this.save();
    this.emit();
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
