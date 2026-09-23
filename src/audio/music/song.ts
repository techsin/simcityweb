/**
 * song(): build a TrackPlayer from an arrangement + a per-bar render callback.
 *
 *   return song(env, {
 *     bpm: 80, swing: 0.6,
 *     sections: [{ name: 'intro', bars: 4 }, { name: 'A', bars: 8 }, ...],
 *     tail: 5,
 *     setup(t0) { env.inst.mix('pad', { level: 0.7 }); env.inst.vinyl(t0, t0 + 200, 0.4); },
 *     bar(b) { env.inst.kick(b.at(0), 0.8); env.inst.snare(b.at(1), 0.6); ... },
 *   });
 *
 * Bars are rendered in order, each exactly once, when their start time falls inside the scheduler lookahead.
 * Notes inside a bar may extend past the next bar (long pads, ties) - just schedule them with a long dur.
 * Tempo can change per bar (tempo callback) for ritardando / accelerando; b.at() and b.beatSec follow it.
 */
import type { MusicEnv, SectionMark, TrackPlayer } from './types';
import { swingPos } from './theory';

export interface SongSection {
  name: string;
  bars: number;
  /** beats per bar in this section (default: spec.beatsPerBar) */
  beats?: number;
}

export interface BarInfo {
  /** absolute ctx start time of the bar */
  t: number;
  /** global bar index (0-based) */
  bar: number;
  /** total bars in the song */
  totalBars: number;
  section: SongSection;
  sectionIndex: number;
  /** bar index inside the section (0-based) */
  barInSection: number;
  beats: number;
  /** seconds per beat in this bar */
  beatSec: number;
  /** bar duration in seconds */
  dur: number;
  bpm: number;
  /** first / last bar of its section */
  first: boolean;
  last: boolean;
  /** 0..1 position in the whole song / in the section */
  progress: number;
  sectionProgress: number;
  /** time of beat position b (0 = downbeat, fractional ok, may exceed the bar) with the song's swing applied */
  at(beat: number, swing?: number): number;
  /** seconds for a duration of n beats at this bar's tempo */
  beatsToSec(n: number): number;
}

export interface SongSpec {
  bpm: number;
  /** per-bar tempo override (ritardando etc.); default bpm */
  tempo?: (bar: number, section: SongSection) => number;
  beatsPerBar?: number;
  /** off-beat position within a swing unit: 0.5 straight .. 0.667 triplet (default 0.5) */
  swing?: number;
  /** swing 8ths (default) or 16ths */
  swingUnit?: 8 | 16;
  sections: SongSection[];
  /** seconds from the end of the last bar to endTime (ring-out; the director crossfades into the next song during it). Default 4 */
  tail?: number;
  /** called once at start (mix settings, beds) */
  setup?(t0: number, player: SongPlayer): void;
  /** schedule every note of one bar */
  bar(b: BarInfo): void;
  /** called when the director stops the song early */
  onStop?(t: number, fadeSec: number): void;
}

export interface SongPlayer extends TrackPlayer {
  readonly sections: readonly SectionMark[];
  /** bar start times (absolute), valid after start */
  readonly barTimes: readonly number[];
}

export function song(env: MusicEnv, spec: SongSpec): SongPlayer {
  const bpb = spec.beatsPerBar ?? 4;
  const swing = spec.swing ?? 0.5;
  const unit = spec.swingUnit ?? 8;
  const tail = spec.tail ?? 4;
  // flatten bars
  const bars: { section: SongSection; sectionIndex: number; barInSection: number; beats: number; bpm: number }[] = [];
  spec.sections.forEach((s, si) => {
    for (let i = 0; i < s.bars; i++) bars.push({ section: s, sectionIndex: si, barInSection: i, beats: s.beats ?? bpb, bpm: spec.bpm });
  });
  bars.forEach((b, i) => (b.bpm = spec.tempo ? spec.tempo(i, b.section) : spec.bpm));
  const barTimes: number[] = [];
  const marks: SectionMark[] = [];
  let next = 0;
  let stopAt = Infinity;
  let endTime = Infinity;
  let started = false;

  const player: SongPlayer = {
    get endTime() {
      return endTime;
    },
    sections: marks,
    barTimes,
    start(t0: number) {
      if (started) return;
      started = true;
      let t = t0;
      for (const b of bars) {
        barTimes.push(t);
        if (b.barInSection === 0) marks.push({ name: b.section.name, t });
        t += (b.beats * 60) / b.bpm;
      }
      barTimes.push(t);
      endTime = t + tail;
      spec.setup?.(t0, player);
    },
    scheduleUntil(t: number) {
      if (!started) return;
      while (next < bars.length && barTimes[next] < t) {
        const i = next++;
        const bt = barTimes[i];
        if (bt >= stopAt) continue;
        // live: a bar that is already fully in the past (tab was throttled) is skipped, not burst
        if (env.live && barTimes[i + 1] < env.ctx.currentTime) continue;
        const b = bars[i];
        const beatSec = 60 / b.bpm;
        const info: BarInfo = {
          t: bt,
          bar: i,
          totalBars: bars.length,
          section: b.section,
          sectionIndex: b.sectionIndex,
          barInSection: b.barInSection,
          beats: b.beats,
          beatSec,
          dur: barTimes[i + 1] - bt,
          bpm: b.bpm,
          first: b.barInSection === 0,
          last: b.barInSection === b.section.bars - 1,
          progress: i / bars.length,
          sectionProgress: b.barInSection / b.section.bars,
          at: (beat: number, sw?: number) => bt + swingPos(beat, sw ?? swing, unit) * beatSec,
          beatsToSec: (n: number) => n * beatSec,
        };
        spec.bar(info);
      }
    },
    stop(t: number, fadeSec: number) {
      stopAt = Math.min(stopAt, t + fadeSec);
      spec.onStop?.(t, fadeSec);
    },
  };
  return player;
}
