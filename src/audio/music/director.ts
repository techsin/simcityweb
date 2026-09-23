/**
 * MusicDirector - plays the soundtrack as an endless, context-aware playlist of finite generative songs.
 *
 *  - one lookahead scheduler (250 ms timer, 1.5 s lookahead; 4 s while the tab is hidden). A tab that was throttled
 *    or a stalled main thread skips ahead (song.ts skips past bars, Instruments drop past notes) instead of bursting.
 *  - shuffle (weighted by context, never the last 1-2 tracks again) or sequential order; enabled set + shuffle persist
 *  - ~5 s crossfade into the next song before the current one ends; 2.5 s on manual next/prev/select
 *  - a track that throws (create / start / schedule) is logged, faded out and skipped for the session
 */
import { RNG, clamp, smoothstep } from '../../core/rng';
import { Instruments } from './synth';
import type { MusicEnv, MusicTrack, TrackPlayer, TrackTag } from './types';

export type MusicScreen = 'menu' | 'region' | 'city';

export interface MusicContext {
  screen: MusicScreen;
  night: boolean;
  population: number;
  /** 0..1 how lively the city is right now (sim speed, growth) */
  activity: number;
}

export interface TrackInfo {
  id: string;
  title: string;
  mood: string;
  tags: TrackTag[];
  bpm: number;
  enabled: boolean;
}

export interface NowPlaying extends TrackInfo {
  /** seconds since the song started / total song length (s) */
  elapsed: number;
  duration: number;
}

export interface MusicPrefs {
  shuffle: boolean;
  /** ids the player switched off (new tracks default to enabled) */
  disabled: string[];
}

export interface MusicPrefsStore {
  load(): MusicPrefs;
  save(p: MusicPrefs): void;
}

export interface TrackInstance {
  env: MusicEnv;
  inst: Instruments;
  player: TrackPlayer;
  /** per-play dry bus (track trim) and reverb send; route both to your outputs */
  bus: GainNode;
  send: GainNode;
}

/**
 * Build one play of a track: bus (gain = track trim) -> dest, reverb send -> reverbDest, Instruments, player.
 * Shared by the director (live) and the audio lab (offline), so renders match the game exactly.
 */
export function instantiateTrack(
  track: MusicTrack,
  ctx: BaseAudioContext,
  dest: AudioNode,
  reverbDest: AudioNode,
  noise: AudioBuffer,
  seed: number,
  o: { live: boolean; skipBefore?: number; stats?: boolean },
): TrackInstance {
  const trim = track.gain ?? 1;
  const bus = ctx.createGain();
  bus.gain.value = trim;
  bus.connect(dest);
  const send = ctx.createGain();
  send.gain.value = trim;
  send.connect(reverbDest);
  const inst = new Instruments(ctx, bus, send, noise, { bpm: track.bpm, live: o.live, seed, skipBefore: o.skipBefore, stats: o.stats });
  const env: MusicEnv = { ctx, out: bus, reverb: send, noise, rng: new RNG(seed), inst, live: o.live };
  const player = track.create(env);
  return { env, inst, player, bus, send };
}

const TICK_MS = 250;
const LOOKAHEAD = 1.5;
const HIDDEN_LOOKAHEAD = 4;
const XF_AUTO = 5;
const XF_MANUAL = 2.5;
const START_FADE = 1.2;

/** piecewise-linear gain schedule on one or more params that can be retargeted at any time without clicks */
class Fade {
  private pts: [number, number][];
  constructor(private params: AudioParam[], v0: number, now: number) {
    this.pts = [[now, v0]];
    for (const p of params) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(v0, now);
    }
  }

  valueAt(t: number): number {
    const p = this.pts;
    if (t <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) {
      if (t <= p[i][0]) {
        const [t0, v0] = p[i - 1], [t1, v1] = p[i];
        return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
      }
    }
    return p[p.length - 1][1];
  }

  /** from max(at, now) glide to v over dur with an equal-power-ish shape ('in' rises fast, 'out' falls late) */
  to(v: number, at: number, dur: number, now: number, shape: 'in' | 'out' | 'lin' = 'lin'): void {
    const vNow = this.valueAt(now);
    const start = Math.max(at, now);
    const pts: [number, number][] = [[now, vNow], [start, vNow]];
    const curve = shape === 'in' ? [0.38, 0.71, 0.92] : shape === 'out' ? [0.08, 0.29, 0.62] : [0.25, 0.5, 0.75];
    for (let k = 0; k < 3; k++) pts.push([start + (dur * (k + 1)) / 4, vNow + (v - vNow) * curve[k]]);
    pts.push([start + Math.max(0.01, dur), v]);
    for (const p of this.params) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(vNow, now);
      for (let i = 1; i < pts.length; i++) p.linearRampToValueAtTime(pts[i][1], pts[i][0]);
    }
    this.pts = pts;
  }
}

interface Play extends TrackInstance {
  track: MusicTrack;
  seed: number;
  startAt: number;
  fade: Fade;
  fadingOut: boolean;
  killAt: number;
}

export class MusicDirector {
  private tracks: MusicTrack[];
  private store: MusicPrefsStore;
  private prefs: MusicPrefs;
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private reverb: AudioNode | null = null;
  private noise: AudioBuffer | null = null;
  private plays: Play[] = [];
  private cur: Play | null = null;
  private history: string[] = [];
  private queued: string | null = null;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private context: MusicContext = { screen: 'menu', night: false, population: 0, activity: 0.5 };
  private listeners = new Set<() => void>();
  private failed = new Set<string>();
  private rng = new RNG((Date.now() ^ 0x2f6b) >>> 0);

  constructor(tracks: MusicTrack[], store: MusicPrefsStore) {
    this.tracks = tracks;
    this.store = store;
    let loaded: Partial<MusicPrefs> = {};
    try {
      loaded = store.load() ?? {};
    } catch {
      /* ignore */
    }
    this.prefs = { shuffle: loaded.shuffle ?? true, disabled: Array.isArray(loaded.disabled) ? loaded.disabled.filter((x) => typeof x === 'string') : [] };
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', () => {
        if (this.timer) this.tick();
      });
  }

  /** connect to the live audio graph (called by AudioEngine.init) */
  attach(ctx: AudioContext, out: AudioNode, reverb: AudioNode, noise: AudioBuffer): void {
    this.ctx = ctx;
    this.out = out;
    this.reverb = reverb;
    this.noise = noise;
    if (this.running) this.ensureTimer();
  }

  get playing(): boolean {
    return this.running;
  }

  /** start playback (no-op when already playing) */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.ensureTimer();
    this.tick();
  }

  /** fade everything out and stop */
  stop(fade = 2): void {
    this.running = false;
    const ctx = this.ctx;
    if (ctx) for (const p of this.plays) this.fadeOut(p, ctx.currentTime, fade);
    this.cur = null;
    this.emit();
  }

  setContext(c: Partial<MusicContext>): void {
    Object.assign(this.context, c);
  }

  getContext(): Readonly<MusicContext> {
    return this.context;
  }

  // ---------------------------------------------------------------- playlist API
  list(): TrackInfo[] {
    return this.tracks.map((t) => this.info(t));
  }

  get nowPlaying(): NowPlaying | null {
    const p = this.cur;
    if (!p) return null;
    const now = this.ctx?.currentTime ?? p.startAt;
    const duration = Math.max(0, p.player.endTime - p.startAt);
    return { ...this.info(p.track), elapsed: clamp(now - p.startAt, 0, duration), duration };
  }

  next(): void {
    this.switchTo(this.pick(), XF_MANUAL);
  }

  prev(): void {
    const h = this.history;
    if (h.length >= 2) {
      h.pop();
      const id = h.pop()!;
      this.switchTo(id, XF_MANUAL);
    } else if (this.cur) this.switchTo(this.cur.track.id, XF_MANUAL);
  }

  select(id: string): void {
    if (!this.tracks.some((t) => t.id === id)) return;
    this.switchTo(id, XF_MANUAL);
  }

  get shuffle(): boolean {
    return this.prefs.shuffle;
  }

  set shuffle(on: boolean) {
    this.prefs.shuffle = !!on;
    this.save();
    this.emit();
  }

  setShuffle(on: boolean): void {
    this.shuffle = on;
  }

  isEnabled(id: string): boolean {
    return !this.prefs.disabled.includes(id);
  }

  setEnabled(id: string, on: boolean): void {
    const d = new Set(this.prefs.disabled);
    if (on) d.delete(id);
    else d.add(id);
    this.prefs.disabled = [...d];
    this.save();
    this.emit();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------------------------------------------------------------- internals
  private info(t: MusicTrack): TrackInfo {
    return { id: t.id, title: t.title, mood: t.mood, tags: [...t.tags], bpm: t.bpm, enabled: this.isEnabled(t.id) };
  }

  private save(): void {
    try {
      this.store.save({ shuffle: this.prefs.shuffle, disabled: [...this.prefs.disabled] });
    } catch {
      /* ignore */
    }
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (e) {
        console.warn('[music] listener', e);
      }
    }
  }

  private ensureTimer(): void {
    if (this.timer || typeof setInterval === 'undefined') return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private candidates(): MusicTrack[] {
    const ok = this.tracks.filter((t) => !this.failed.has(t.id));
    const en = ok.filter((t) => this.isEnabled(t.id));
    return en.length ? en : ok.length ? ok : this.tracks;
  }

  /** context weight of a track */
  weight(t: MusicTrack): number {
    const c = this.context;
    const has = (tag: TrackTag) => t.tags.includes(tag);
    let w = 1;
    if (c.screen === 'menu' || c.screen === 'region') {
      if (has(c.screen)) w *= 3;
      if (has('calm')) w *= 1.5;
      if (has('busy')) w *= 0.45;
    } else {
      if (c.night) w *= has('night') ? 3 : has('day') ? 0.5 : 1;
      else w *= has('day') ? 2 : has('night') ? 0.6 : 1;
      const busy = smoothstep(3000, 150000, c.population) * (0.4 + 0.6 * clamp(c.activity, 0, 1));
      if (has('busy')) w *= 0.45 + 2.6 * busy;
      if (has('calm')) w *= 1.5 - 0.8 * busy;
    }
    return Math.max(0.02, w);
  }

  private pick(): string {
    const cands = this.candidates();
    if (!cands.length) return this.tracks[0]?.id ?? '';
    const last = this.history[this.history.length - 1];
    if (!this.prefs.shuffle) {
      const order = this.tracks.filter((t) => cands.includes(t));
      const i = order.findIndex((t) => t.id === last);
      return order[(i + 1) % order.length].id;
    }
    const avoid = new Set(this.history.slice(-Math.min(2, cands.length - 1)));
    const pool = cands.filter((t) => !avoid.has(t.id));
    const use = pool.length ? pool : cands;
    return this.rng.weighted(use, use.map((t) => this.weight(t))).id;
  }

  private switchTo(id: string, xf: number): void {
    if (!id) return;
    const ctx = this.ctx;
    if (!this.running || !ctx || ctx.state !== 'running' || !this.out) {
      this.queued = id;
      this.emit();
      return;
    }
    const now = ctx.currentTime;
    if (this.cur) this.fadeOut(this.cur, now, xf);
    this.begin(id, now + 0.06, xf * 0.8);
  }

  private fadeOut(p: Play, at: number, dur: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const start = Math.max(at, now);
    if (p.fadingOut && p.killAt - 0.5 <= start + dur) return; // an earlier / equal fade is already scheduled
    p.fadingOut = true;
    p.fade.to(0, start, dur, now, 'out');
    p.killAt = start + dur + 0.5;
    try {
      p.player.stop(start, dur);
    } catch {
      /* ignore */
    }
    p.inst.cutoff = Math.min(p.inst.cutoff, start + dur);
    if (this.cur === p) this.cur = null;
  }

  private begin(id: string, at: number, fadeIn: number, attempt = 0): void {
    const ctx = this.ctx!;
    const track = this.tracks.find((t) => t.id === id) ?? this.tracks[0];
    if (!track) return;
    const seed = (this.rng.next() * 0x7fffffff) | 0;
    let inst: TrackInstance | null = null;
    try {
      inst = instantiateTrack(track, ctx, this.out!, this.reverb!, this.noise!, seed, { live: true });
      inst.player.start(at);
      if (!(inst.player.endTime > at)) throw new Error('endTime not set after start()');
    } catch (e) {
      console.warn(`[music] track "${track.id}" failed to start`, e);
      this.failed.add(track.id);
      if (inst) {
        inst.inst.dispose();
        inst.bus.disconnect();
        inst.send.disconnect();
      }
      if (attempt < 3) this.begin(this.pick(), at, fadeIn, attempt + 1);
      return;
    }
    const trim = track.gain ?? 1;
    const fade = new Fade([inst.bus.gain, inst.send.gain], 0, ctx.currentTime);
    fade.to(trim, at, Math.max(0.05, fadeIn), ctx.currentTime, 'in');
    const play: Play = { ...inst, track, seed, startAt: at, fade, fadingOut: false, killAt: inst.player.endTime + 1 };
    this.plays.push(play);
    this.cur = play;
    this.queued = null;
    this.history.push(track.id);
    if (this.history.length > 50) this.history.splice(0, this.history.length - 50);
    this.emit();
    try {
      play.player.scheduleUntil(at + this.lookahead());
    } catch (e) {
      this.fail(play, e);
    }
  }

  private fail(p: Play, e: unknown): void {
    console.warn(`[music] track "${p.track.id}" failed while playing`, e);
    this.failed.add(p.track.id);
    const wasCur = this.cur === p;
    this.fadeOut(p, this.ctx!.currentTime, 0.4);
    if (wasCur && this.running) this.begin(this.pick(), this.ctx!.currentTime + 0.1, START_FADE);
  }

  private lookahead(): number {
    return typeof document !== 'undefined' && document.hidden ? HIDDEN_LOOKAHEAD : LOOKAHEAD;
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const la = this.lookahead();
    if (this.running && !this.cur) this.begin(this.queued ?? this.pick(), now + 0.08, START_FADE);
    for (const p of [...this.plays]) {
      if (p.fadingOut && now > p.killAt - 0.5) continue;
      try {
        p.player.scheduleUntil(now + la);
      } catch (e) {
        this.fail(p, e);
      }
    }
    // crossfade into the next song before the current one ends
    const c = this.cur;
    if (this.running && c && !c.fadingOut && now + la >= c.player.endTime - XF_AUTO) {
      const at = Math.max(now + 0.05, c.player.endTime - XF_AUTO);
      this.fadeOut(c, at, XF_AUTO);
      this.begin(this.pick(), at, XF_MANUAL);
    }
    // cleanup finished plays
    for (let i = this.plays.length - 1; i >= 0; i--) {
      const p = this.plays[i];
      if (now > p.killAt) {
        p.inst.dispose();
        try {
          p.bus.disconnect();
          p.send.disconnect();
        } catch {
          /* ignore */
        }
        this.plays.splice(i, 1);
        if (this.cur === p) this.cur = null;
      }
    }
    if (!this.running && !this.plays.length && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
