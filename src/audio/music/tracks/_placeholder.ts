/**
 * TODO(composer): shared helper for the PLACEHOLDER tracks only. Each stub file (avenida_bossa.ts, ...) is replaced
 * by its composer with a real song; once no stub imports this file it can be deleted.
 * Plays a short (~70 s) pad + bass + soft-percussion loop over a chord chart so the director has something valid.
 */
import { song } from '../song';
import { parseChart, voiceLead, bassNote } from '../theory';
import type { MusicEnv, TrackPlayer } from '../types';

export function placeholderSong(env: MusicEnv, o: { bpm: number; chart: string; transpose?: number; swing?: number }): TrackPlayer {
  const { inst, rng } = env;
  const bars = parseChart(o.chart, o.transpose ?? 0);
  let prev: number[] | null = null;
  const voicings = bars.map((b) => b.map((c) => (prev = voiceLead(prev, c, { lo: 55, hi: 74, count: 4 }))));
  const total = 32;
  return song(env, {
    bpm: o.bpm,
    swing: o.swing ?? 0.5,
    sections: [
      { name: 'intro', bars: 4 },
      { name: 'A', bars: 12 },
      { name: 'B', bars: 12 },
      { name: 'outro', bars: 4 },
    ],
    tail: 4,
    setup() {
      inst.mix('pad', { level: 2 });
      inst.mix('bass', { level: 0.8 });
    },
    bar(b) {
      const i = b.bar % bars.length;
      const chords = bars[i];
      const fadeOut = b.bar >= total - 4 ? (total - b.bar) / 5 : 1;
      chords.forEach((c, k) => {
        const beat = (k * b.beats) / chords.length;
        const len = b.beats / chords.length;
        inst.pad(b.at(beat), voicings[i][k], b.beatsToSec(len) + 0.2, 0.55 * fadeOut, { attack: 0.8, release: 1.5 });
        if (b.section.name !== 'intro') inst.bass(b.at(beat), bassNote(c, 36), b.beatsToSec(len * 0.9), 0.7 * fadeOut);
      });
      if (b.section.name === 'A' || b.section.name === 'B') {
        for (let q = 0; q < b.beats; q++) {
          inst.shaker(b.at(q + 0.5), 0.35 + rng.next() * 0.1);
          if (q % 2 === 0) inst.kick(b.at(q), 0.5, { click: 0.2 });
          else inst.rim(b.at(q), 0.35);
        }
      }
    },
  });
}
