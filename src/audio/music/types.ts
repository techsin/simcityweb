/**
 * Soundtrack contract. One file per track in src/audio/music/tracks/, registered in tracks/index.ts.
 *
 * A track is a FINITE (~3-5 min), generative song: create(env) is called once per play with a freshly seeded rng,
 * so every play differs musically but follows the same arrangement plan. Most tracks build their player with
 * song() from ../song.ts (bar-by-bar scheduling, sections, tempo map, swing) - see tracks/sunday_jazz.ts.
 */
import type { RNG } from '../../core/rng';
import type { Instruments } from './synth';

export type TrackTag = 'menu' | 'region' | 'day' | 'night' | 'calm' | 'busy';

export interface MusicTrack {
  /** stable id = file name without .ts (persisted in prefs) */
  id: string;
  title: string;
  /** one-line mood / genre description (shown in the music player) */
  mood: string;
  /** where the director prefers this track (menu/region screens, city by day/night, calm vs busy cities) */
  tags: TrackTag[];
  bpm: number;
  /** linear output trim applied by the director (default 1). Use it to land at -18 LUFS integrated. */
  gain?: number;
  create(env: MusicEnv): TrackPlayer;
}

export interface MusicEnv {
  ctx: BaseAudioContext;
  /** this play's bus (already includes the track gain trim + director fades). Instruments route here. */
  out: AudioNode;
  /** reverb send for this play */
  reverb: AudioNode;
  /** 2 s mono white noise */
  noise: AudioBuffer;
  /** seeded per play: use it for EVERY musical random choice (never Math.random) */
  rng: RNG;
  /** instrument library bound to ctx / out / reverb (tempo-synced delay uses track.bpm) */
  inst: Instruments;
  /** true for the real-time game context, false for offline lab renders */
  live: boolean;
}

export interface SectionMark {
  name: string;
  /** absolute ctx time the section starts */
  t: number;
}

export interface TrackPlayer {
  /** begin the song at absolute ctx time t0 (fixes endTime / sections) */
  start(t0: number): void;
  /**
   * Schedule (at least) every note that starts before t. Called repeatedly with a ~1.5 s lookahead live, or once
   * with t >= endTime offline. Must be idempotent for already-scheduled material; may schedule up to ~1 bar past t.
   */
  scheduleUntil(t: number): void;
  /** absolute ctx time the song is over (final note + ring-out tail), valid after start() */
  readonly endTime: number;
  /** stop producing notes after t + fadeSec (the director fades the bus itself) */
  stop(t: number, fadeSec: number): void;
  /** section start times (for the lab's markers / debugging) */
  readonly sections?: readonly SectionMark[];
}
