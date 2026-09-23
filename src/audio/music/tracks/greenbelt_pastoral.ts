/**
 * "Greenbelt" - light orchestral pastoral for calm days in the suburbs and parks (Metropolis soundtrack).
 *
 * 6/8 at a dotted-quarter pulse of 68-74 (one song beat = one eighth note, 6 per bar). A marimba broken-chord ostinato,
 * pizzicato strings on the after-beats, a pizz upright on the dotted quarters, a warm bowed-string bed that swells on
 * every chord, and a flute theme: a 16-bar period (motif, sequence a third lower, a climb, a 4-3 half cadence |
 * motif again, a climb to the peak, then an authentic cadence). Soft piano answers echo the motif head while the
 * theme holds its long notes. A clarinet-like reed (a square-wave voice built on the pad) carries the contrasting
 * "meadow" section, which later returns on violins with the reed in thirds below. Harp fills mark the section ends,
 * with vibes, shaker, triangle and a cymbal swell into the big arrivals.
 *
 * Form (one of two per seed, 119 bars, about 3:25-3:45):
 *   intro 8 | theme 16 | theme II 16 | meadow 16 | theme III (piano) 16 | interlude 8 | meadow II 16 | theme out 16 | coda 7
 *   intro 8 | theme 16 | meadow 16 | theme II (piano) 16 | interlude 8 | theme III 16 | meadow II 16 | theme out 16 | coda 7
 * The coda echoes the motif (flute, then the reed over a borrowed iv), makes a ritardando cadence, and strikes a rolled
 * add9 / 6-9 / maj9 chord two bars before the end.
 *
 * Every play re-rolls the key, tempo and form. It picks one of three composed themes and, per statement, one of three
 * re-harmonisations of the same descending bass line. It also re-rolls the meadow chart and its generated melody, the
 * intro, interlude and cadence charts, ornaments (graces and passing tones), the answers, the marimba and harp
 * patterns, the bass figures, all voicings (4-voice minimal-motion voice leading) and the final chord.
 * The whole plan is computed in create(); bar() only schedules.
 */
import type { MusicTrack } from '../types';
import { song, type BarInfo } from '../song';
import { parseChart, chordTones, scale, humanize, humVel, snap, pc, type Chord } from '../theory';

type Kind = 'intro' | 'A' | 'B' | 'inter' | 'coda';
interface Sec {
  name: string;
  bars: number;
  kind: Kind;
  /** orchestration variant. A: 0 flute plain, 1 flute ornamented + piano answers, 2 piano theme + flute answers,
   *  3 out chorus (flute + strings octave, harp, glass). B: 0 reed + vibes + flute answers, 1 violins + reed thirds */
  v: number;
  start: number;
}

/** instrument keys used in the plan */
type K = 'flute' | 'reed' | 'piano' | 'vln' | 'marimba' | 'vibes' | 'pizz' | 'upright' | 'harp' | 'glass' | 'triangle' | 'tri' | 'shaker' | 'swell';
interface Ev {
  k: K;
  /** eighth position inside the bar (may exceed 6 for events scheduled early, e.g. swells) */
  pos: number;
  /** eighths (swell: seconds) */
  dur: number;
  m: number;
  vel: number;
}
interface PadEv {
  pos: number;
  dur: number;
  notes: number[];
  vel: number;
  att: number;
  rel: number;
  cut: number;
}
interface Slot {
  pos: number;
  dur: number;
  c: Chord;
  /** 4-voice string voicing for this chord */
  v: number[];
  /** upright bass note */
  bass: number;
}
interface BarPlan {
  sec: Sec;
  inSec: number;
  slots: Slot[];
  ev: Ev[];
  pads: PadEv[];
}
/** a realised melodic note, absolute position in eighths from the song start */
interface Note {
  at: number;
  dur: number;
  m: number;
  /** velocity accent (relative, added to 1) */
  acc: number;
}
/** composed theme note: [eighth position in bar, duration in eighths, scale degree (0 = tonic)] */
type N = readonly [number, number, number];
interface Theme {
  pickup: readonly N[];
  bars: readonly (readonly N[])[];
}

const FORMS: readonly (readonly [string, number, Kind, number])[][] = [
  [['intro', 8, 'intro', 0], ['theme', 16, 'A', 0], ['theme II', 16, 'A', 1], ['meadow', 16, 'B', 0], ['theme III (piano)', 16, 'A', 2], ['interlude', 8, 'inter', 0], ['meadow II', 16, 'B', 1], ['theme out', 16, 'A', 3], ['coda', 7, 'coda', 0]],
  [['intro', 8, 'intro', 0], ['theme', 16, 'A', 0], ['meadow', 16, 'B', 0], ['theme II (piano)', 16, 'A', 2], ['interlude', 8, 'inter', 0], ['theme III', 16, 'A', 1], ['meadow II', 16, 'B', 1], ['theme out', 16, 'A', 3], ['coda', 7, 'coda', 0]],
];

// ------------------------------------------------------------------ charts (written in C, transposed per play)
/** three harmonisations of one descending bass line (C B A G F E D G | ... cadence), so every theme fits all of them */
const A_CHARTS = [
  'C | G/B | Am | Em/G | F | C/E | Dm7 | Gsus4 G | C | G/B | Am | Em/G | F | Em7 Am7 | Dm7 G7 | C',
  'Cadd9 | G/B | Am7 | C/G | Fmaj7 | C/E | Dm9 | G9sus4 G7 | Cadd9 | G/B | Am7 | C/G | Fmaj7 | C/E A7 | Dm7 G7sus4 | C',
  'C | G/B | F/A | C/G | F | C/E | Dm7 | Gsus4 G | C | Em/B | F/A | C/G | F G | Em7 Am7 | F/G G7 | C',
];
/** contrasting "meadow" section: subdominant / relative minor colours, a borrowed iv, and a half cadence back to the theme */
const B_CHARTS = [
  'F | G/F | Em7 | Am7 | Dm7 | Em7 | Fmaj7 | Gsus4 G | F | Fm6 | C/E | A7/C# | Dm7 | Fm6 | C/G | Gsus4 G7',
  'Am | Em/G | F | C/E | Dm7 | Am/C | Bb | Gsus4 G | Am | Em/G | F | C/E | Dm7 | Fm6 | C/G | Gsus4 G7',
  'Fmaj7 | Em7 | Dm7 | C | Bb | Am7 | Dm7 | Gsus4 G | Fmaj7 | Em7 | Am7 | D7/F# | Fmaj7 | Fm6 | C/G | Gsus4 G7',
];
const INTRO_CHARTS = ['C | F/C | C | F/C | Am7 | Fmaj7 | Dm7 | Gsus4 G', 'Cadd9 | Fmaj7/C | Cadd9 | Fmaj7/C | Fmaj7 | Em7 | Dm7 | G9sus4 G7'];
const INTER_CHARTS = ['Am7 | Fmaj7 | Am7 | Fmaj7 | Dm7 | Em7 | Fmaj7 | Gsus4 G', 'F/C | C | F/C | C | Dm7 | C/E | Fmaj7 | G9sus4 G', 'Am | Em/G | F | C/E | Dm7 | Am/C | Bb | Gsus4 G'];
const CODA_CADENCES = ['Dm7 G7', 'F/G G7', 'Dm9 G7sus4'];
const FINAL_CHORDS = ['Cadd9', 'C69', 'Cmaj9'];

// ------------------------------------------------------------------ themes (scale degrees in the major key, 0 = tonic)
const THEMES: readonly Theme[] = [
  {
    // "morning walk": siciliano motif E D C | G E, sequenced a third lower, 4-3 half cadence, climb to C6
    pickup: [[5, 1, 1]],
    bars: [
      [[0, 1.5, 2], [1.5, 0.5, 1], [2, 1, 0], [3, 2, 4], [5, 1, 2]],
      [[0, 5, 1], [5, 1, -1]],
      [[0, 1.5, 0], [1.5, 0.5, -1], [2, 1, -2], [3, 2, 2], [5, 1, 0]],
      [[0, 3, -1], [3, 3, -3]],
      [[0, 1, -2], [1, 1, -1], [2, 1, 0], [3, 3, 3]],
      [[0, 1.5, 4], [1.5, 0.5, 3], [2, 1, 2], [3, 3, 4]],
      [[0, 2, 5], [2, 1, 3], [3, 2, 1], [5, 1, 0]],
      [[0, 3, 0], [3, 2, -1], [5, 1, 1]],
      [[0, 1.5, 2], [1.5, 0.5, 1], [2, 1, 0], [3, 2, 4], [5, 1, 2]],
      [[0, 5, 1], [5, 1, -1]],
      [[0, 1.5, 0], [1.5, 0.5, -1], [2, 1, -2], [3, 2, 2], [5, 1, 0]],
      [[0, 3, -1], [3, 1, 0], [4, 1, 1], [5, 1, 2]],
      [[0, 1.5, 5], [1.5, 0.5, 4], [2, 1, 3], [3, 2, 7], [5, 1, 5]],
      [[0, 3, 6], [3, 3, 5]],
      [[0, 1.5, 3], [1.5, 0.5, 2], [2, 1, 1], [3, 2, -1], [5, 1, 1]],
      [[0, 5, 0]],
    ],
  },
  {
    // "swallow": sol-do pickup, lilting quarter-eighth motif C D | E G, answered by D B | G
    pickup: [[5, 1, -3]],
    bars: [
      [[0, 2, 0], [2, 1, 1], [3, 2, 2], [5, 1, 4]],
      [[0, 2, 1], [2, 1, -1], [3, 3, -3]],
      [[0, 2, -2], [2, 1, -1], [3, 2, 0], [5, 1, 2]],
      [[0, 3, -1], [3, 3, 2]],
      [[0, 2, 0], [2, 1, -2], [3, 2, 3], [5, 1, 2]],
      [[0, 2, 4], [2, 1, 3], [3, 3, 2]],
      [[0, 2, 1], [2, 1, 3], [3, 2, 5], [5, 1, 3]],
      [[0, 3, 1], [3, 2, -1], [5, 1, -3]],
      [[0, 2, 0], [2, 1, 1], [3, 2, 2], [5, 1, 4]],
      [[0, 2, 1], [2, 1, -1], [3, 3, -3]],
      [[0, 2, -2], [2, 1, -1], [3, 2, 0], [5, 1, 2]],
      [[0, 3, -1], [3, 1, 0], [4, 1, 1], [5, 1, 2]],
      [[0, 2, 3], [2, 1, 2], [3, 2, 5], [5, 1, 4]],
      [[0, 2, 4], [2, 1, 6], [3, 3, 7]],
      [[0, 2, 5], [2, 1, 3], [3, 2, 1], [5, 1, -1]],
      [[0, 5, 0]],
    ],
  },
  {
    // "lullaby": flowing eighths E F G | E, sequenced down a third, arpeggio climb to C6
    pickup: [[4, 1, 0], [5, 1, 1]],
    bars: [
      [[0, 1, 2], [1, 1, 3], [2, 1, 4], [3, 3, 2]],
      [[0, 1, 1], [1, 1, 2], [2, 1, 1], [3, 3, -1]],
      [[0, 1, 0], [1, 1, 1], [2, 1, 2], [3, 3, 0]],
      [[0, 1, -1], [1, 1, 0], [2, 1, -1], [3, 3, -3]],
      [[0, 1, -2], [1, 1, 0], [2, 1, 3], [3, 2, 5], [5, 1, 3]],
      [[0, 1, 4], [1, 1, 3], [2, 1, 2], [3, 3, 4]],
      [[0, 1, 5], [1, 1, 3], [2, 1, 1], [3, 2, 0], [5, 1, 1]],
      [[0, 3, 0], [3, 1, -1], [4, 1, 0], [5, 1, 1]],
      [[0, 1, 2], [1, 1, 3], [2, 1, 4], [3, 3, 2]],
      [[0, 1, 1], [1, 1, 2], [2, 1, 1], [3, 3, -1]],
      [[0, 1, 0], [1, 1, 1], [2, 1, 2], [3, 3, 0]],
      [[0, 1, -1], [1, 1, 0], [2, 1, 1], [3, 3, 2]],
      [[0, 1, 3], [1, 1, 4], [2, 1, 5], [3, 3, 7]],
      [[0, 1, 6], [1, 1, 5], [2, 1, 4], [3, 3, 5]],
      [[0, 1, 3], [1, 1, 2], [2, 1, 1], [3, 2, -1], [5, 1, 1]],
      [[0, 5, 0]],
    ],
  },
];
/** velocity arch over the 16-bar period (peak at the climax, bars 13-14) */
const ARCH = [0, 0.01, 0.02, 0, 0.02, 0.04, 0.02, -0.02, 0, 0.01, 0.02, 0.03, 0.06, 0.07, 0.02, -0.03];

// meadow melody rhythm cells (per 6/8 bar): moving bars and phrase-end bars
const BR_MOV: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 3], [3, 2], [5, 1]],
  [[0, 2], [2, 1], [3, 3]],
  [[0, 3], [3, 3]],
  [[0, 1.5], [1.5, 0.5], [2, 1], [3, 3]],
  [[0, 2], [2, 1], [3, 2], [5, 1]],
];
const BR_END: readonly (readonly (readonly [number, number])[])[] = [[[0, 6]], [[0, 5]], [[0, 3], [3, 3]], [[0, 4], [4, 1], [5, 1]]];

// accompaniment patterns: indices into the chord tones above the (voice-led) marimba base note; -1 = rest
const MAR_FULL = [[0, 2, 3, 4, 3, 2], [0, 2, 4, 2, 3, 2], [0, 1, 2, 3, 2, 1], [0, 2, 3, 1, 3, 2], [0, 3, 2, 4, 3, 2]];
const MAR_SPARSE = [[0, -1, -1, 2, -1, 3], [0, -1, 2, -1, 3, -1], [0, -1, 3, 2, -1, -1]];
const MAR_ACC = [1, 0.66, 0.74, 0.88, 0.66, 0.74];
const HARP_PAT = [[0, 1, 2, 3, 4, 5], [0, 2, 3, 4, 5, 3], [0, 2, 4, 5, 4, 2]];
/** chromatic chord tones (relative to the key) replace the diatonic neighbour: C# for C, Eb for E, F# for F, Ab for A, Bb for B */
const ALT: Record<number, number> = { 1: 0, 3: 4, 6: 5, 8: 9, 10: 11 };
/** timing jitter (ms) per instrument */
const HUM: Record<K, number> = { flute: 9, reed: 10, piano: 8, vln: 12, marimba: 6, vibes: 7, pizz: 8, upright: 6, harp: 5, glass: 6, triangle: 4, tri: 4, shaker: 5, swell: 0 };

export const track: MusicTrack = {
  id: 'greenbelt_pastoral',
  title: 'Greenbelt',
  mood: 'Pastoral 6/8: marimba ostinato, flute and reed, pizzicato and warm strings, harp',
  tags: ['day', 'calm', 'region'],
  bpm: 72,
  gain: 1.56,
  create(env) {
    const { inst, rng } = env;
    const dq = rng.int(68, 74); // dotted-quarter pulse
    const bpm = dq * 3; // song beats are eighth notes
    inst.bpm = bpm;
    const T = rng.pick([0, 2, 3, -5, -3, -2]); // C D Eb G A Bb (the flute's climax stays at or below Eb6)
    const key = pc(T);
    const tonicM = 72 + T; // melody tonic (flute register)
    const SC = scale(key, 'major', 24, 108);
    const i0 = SC.indexOf(tonicM);
    const theme = rng.pick(THEMES);
    const head = theme.bars[0].slice(0, 3).map((n) => n[2]);

    // ---------------------------------------------------------------- form + charts
    const secs: Sec[] = [];
    {
      let s0 = 0;
      for (const [name, bars, kind, v] of rng.pick(FORMS)) {
        secs.push({ name, bars, kind, v, start: s0 });
        s0 += bars;
      }
    }
    const aFirst = rng.int(0, A_CHARTS.length - 1);
    const aChart = [aFirst, rng.chance(0.5) ? aFirst : (aFirst + 1) % 3, (aFirst + 2) % 3, rng.chance(0.65) ? 1 : aFirst];
    const bChart = rng.int(0, B_CHARTS.length - 1);
    const introChart = rng.pick(INTRO_CHARTS);
    const interChart = rng.pick(INTER_CHARTS);
    const fin = rng.pick(FINAL_CHORDS);
    const codaChart = `F/C | C | Fm6/C | C | ${rng.pick(CODA_CADENCES)} | ${fin} | ${fin}`;
    const chartFor = (s: Sec): string => {
      switch (s.kind) {
        case 'intro': return introChart;
        case 'A': return A_CHARTS[aChart[s.v]];
        case 'B': return B_CHARTS[bChart];
        case 'inter': return interChart;
        default: return codaChart;
      }
    };
    const plan: BarPlan[] = [];
    for (const s of secs) {
      const bars = parseChart(chartFor(s), T);
      for (let i = 0; i < s.bars; i++) {
        const cs = bars[i % bars.length];
        plan.push({ sec: s, inSec: i, slots: cs.map((c, k) => ({ pos: (k * 6) / cs.length, dur: 6 / cs.length, c, v: [], bass: 0 })), ev: [], pads: [] });
      }
    }
    const total = plan.length;
    const secOf = (name: string): Sec | undefined => secs.find((s) => s.name === name);
    const nextSec = (s: Sec): Sec | null => secs[secs.indexOf(s) + 1] ?? null;

    // ---------------------------------------------------------------- harmony helpers
    const slotAt = (at: number): Slot => {
      const bar = Math.max(0, Math.min(total - 1, Math.floor(at / 6)));
      const e = at - bar * 6;
      const p = plan[bar];
      let s = p.slots[0];
      for (const x of p.slots) if (e >= x.pos - 1e-6) s = x;
      return s;
    };
    const chordAt = (at: number): Chord => slotAt(at).c;
    const pcsCache = new Map<Chord, Set<number>>();
    const pcsOf = (c: Chord): Set<number> => {
      let s = pcsCache.get(c);
      if (!s) pcsCache.set(c, (s = new Set(c.tones.map((t) => pc(c.root + t)))));
      return s;
    };
    /** apply the chord's chromatic alterations to a diatonic note (C -> C# over A7, A -> Ab over Fm6, B -> Bb over Bb) */
    const alter = (m: number, c: Chord): number => {
      const r = pc(m - key);
      for (const t of c.tones) {
        const a = pc(c.root + t - key);
        if (ALT[a] === r) return m + (a - r);
      }
      return m;
    };
    /** nearest tone of `set`, preferring direction dir on ties */
    const nearestIn = (m: number, set: Set<number>, dir: number): number => {
      if (set.has(pc(m))) return m;
      const d0 = dir >= 0 ? 1 : -1;
      for (let d = 1; d <= 3; d++) {
        if (set.has(pc(m + d0 * d))) return m + d0 * d;
        if (set.has(pc(m - d0 * d))) return m - d0 * d;
      }
      return m;
    };
    /** strong-beat fit: a chord tone (common to every chord the note spans, when there is one) */
    const fit = (m: number, at: number, dur: number, dir: number): number => {
      const first = pcsOf(chordAt(at));
      let common = first;
      for (let x = Math.floor(at) + 1; x < at + dur - 0.5; x++) {
        const s = pcsOf(chordAt(x));
        if (s !== first) common = new Set([...common].filter((p) => s.has(p)));
      }
      return nearestIn(m, common.size ? common : first, dir);
    };
    const diaIdx = (m: number): number => SC.indexOf(snap(m, SC));
    const isStrong = (at: number, dur: number): boolean => Math.abs(at - Math.round(at / 3) * 3) < 1e-6 || dur >= 2.5;

    // ---------------------------------------------------------------- voicings (strings bed) + bass line
    /** 4-voice voicing of c in [lo, hi] with the least movement from prev (no seconds, gaps <= 9, prefer doubling the root) */
    const voice4 = (prev: number[] | null, c: Chord, lo: number, hi: number): number[] => {
      let req = [...pcsOf(c)];
      const fifth = pc(c.root + 7);
      if (req.length > 4 && c.tones.includes(7)) req = req.filter((p) => p !== fifth);
      if (req.length > 4) req = req.filter((p) => p !== pc(c.root));
      while (req.length > 4) req.pop();
      const pool: number[] = [];
      for (let m = lo; m <= hi; m++) if (req.includes(pc(m))) pool.push(m);
      const centre = (lo + hi) / 2;
      const third = [3, 4].map((iv) => pc(c.root + iv)).filter((p) => req.includes(p));
      let best: number[] = pool.slice(-4), bs = Infinity;
      for (let a = 0; a < pool.length; a++)
        for (let b = a + 1; b < pool.length; b++)
          for (let d = b + 1; d < pool.length; d++)
            for (let e = d + 1; e < pool.length; e++) {
              const v = [pool[a], pool[b], pool[d], pool[e]];
              let ok = true;
              for (let i = 1; i < 4; i++) {
                const g = v[i] - v[i - 1];
                if (g < 2 || g > (i === 1 ? 12 : 9)) ok = false;
              }
              if (!ok) continue;
              const got = new Set(v.map(pc));
              if (req.some((p) => !got.has(p))) continue;
              let s = 0;
              // doubling penalties: a doubled 3rd or colour tone sounds thick
              const counts = new Map<number, number>();
              for (const m of v) counts.set(pc(m), (counts.get(pc(m)) ?? 0) + 1);
              for (const [p, n] of counts) if (n > 1) s += p === pc(c.root) ? 0 : p === fifth ? 0.8 : third.includes(p) ? 2.5 : 4;
              const mean = (v[0] + v[1] + v[2] + v[3]) / 4;
              if (prev) {
                for (let i = 0; i < 4; i++) s += Math.abs(v[i] - prev[i]);
                s += Math.abs(mean - centre) * 0.3;
              } else s += Math.abs(mean - centre);
              if (s < bs) (bs = s), (best = v);
            }
      return best;
    };
    {
      let prevV: number[] | null = null;
      let prevB = 45;
      for (const p of plan) {
        for (const s of p.slots) {
          s.v = prevV = voice4(prevV, s.c, 53, 76);
          // bass: nearest octave to the previous note; each section restarts high so descending lines have room
          const lo = p.inSec === 0 && s.pos === 0 ? 41 : 31, hi = p.inSec === 0 && s.pos === 0 ? 53 : 55;
          const target = p.inSec === 0 && s.pos === 0 ? 48 : prevB;
          let best = lo, bd = Infinity;
          for (let m = lo; m <= hi; m++) {
            const d = Math.abs(m - target) + 0.3 * Math.abs(m - 43);
            if (pc(m) === s.c.bass && d < bd) (bd = d), (best = m);
          }
          s.bass = prevB = best;
        }
      }
    }

    // ---------------------------------------------------------------- event helpers
    const add = (k: K, at: number, dur: number, m: number, vel: number): void => {
      let bar = Math.floor(at / 6);
      if (bar < 0) bar = 0;
      if (bar >= total) return;
      plan[bar].ev.push({ k, pos: Math.max(0, at - bar * 6), dur, m, vel });
    };
    const addLine = (k: K, line: readonly Note[], vel: number, shift = 0): void => {
      for (const n of line) add(k, n.at, n.dur, n.m + shift, vel * (1 + n.acc));
    };
    const BASE: Record<string, number> = { flute: 0.62, piano: 0.5, reed: 0.5, vln: 0.46 };

    /** realise composed theme bars (degrees) over the chords, starting at bar b0 */
    const realize = (b0: number, bars: readonly (readonly N[])[], degShift = 0, arch = true): Note[] => {
      const out: Note[] = [];
      let prev = SC[i0];
      bars.forEach((notes, j) => {
        for (const [pos, dur, deg] of notes) {
          const at = (b0 + j) * 6 + pos;
          const c = chordAt(at);
          let m = alter(SC[i0 + deg + degShift], c);
          if (isStrong(at, dur)) m = fit(m, at, dur, m - prev);
          out.push({ at, dur, m, acc: (arch ? ARCH[j % 16] : 0) + (pos === 0 ? 0.03 : 0) + (dur >= 3 ? 0.02 : 0) });
          prev = m;
        }
      });
      return out;
    };
    /** diatonic shift that puts the most strong-beat notes of `bars` on chord tones (small shifts preferred) */
    const bestShift = (b0: number, bars: readonly (readonly N[])[]): number => {
      let best = 0, bs = -1;
      for (const s of [0, 1, -1, 2, -2, 3, -3]) {
        let score = 0;
        bars.forEach((notes, j) => {
          for (const [pos, dur, deg] of notes) {
            const at = (b0 + j) * 6 + pos;
            if (!isStrong(at, dur)) continue;
            const c = chordAt(at);
            if (pcsOf(c).has(pc(alter(SC[i0 + deg + s], c)))) score++;
          }
        });
        if (score > bs) (bs = score), (best = s);
      }
      return best;
    };
    /** variation: fill some falling / rising thirds with a passing tone on a weak eighth */
    const ornament = (bars: readonly (readonly N[])[], p: number): N[][] =>
      bars.map((notes, j) => {
        const out: N[] = [];
        notes.forEach((n, i) => {
          const [pos, dur, deg] = n;
          const nx = notes[i + 1] ?? bars[j + 1]?.[0];
          const pp = pos + dur - 1;
          if (nx && dur >= 2 && Math.abs(nx[2] - deg) === 2 && pp % 3 !== 0 && rng.chance(p)) out.push([pos, dur - 1, deg], [pp, 1, (deg + nx[2]) / 2]);
          else out.push(n);
        });
        return out;
      });
    /** variation: upper-neighbour grace notes before some long notes */
    const graces = (line: Note[], p: number): Note[] => {
      const out: Note[] = [];
      for (const n of line) {
        const prev = out[out.length - 1];
        if (prev && n.dur >= 3 && prev.at + 0.6 < n.at && rng.chance(p)) {
          const g = 0.3;
          prev.dur = Math.min(prev.dur, n.at - g - prev.at);
          out.push({ at: n.at - g, dur: g, m: alter(SC[diaIdx(n.m) + 1], chordAt(n.at)), acc: -0.2 });
        }
        out.push({ ...n });
      }
      return out;
    };
    /** where the line holds a note through the second half of a bar: [start (abs eighths), length] windows for answers */
    const holds = (line: readonly Note[], b0: number, bars: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let j = 0; j < bars; j++) {
        const w0 = (b0 + j) * 6 + 3;
        const held = line.some((n) => n.at <= w0 && n.at + n.dur >= w0 + 2);
        if (!held) continue;
        const next = line.filter((n) => n.at > w0 + 1e-6).reduce((a, n) => Math.min(a, n.at), w0 + 3);
        const len = Math.min(next, w0 + 3) - w0;
        if (len >= 2) out.push([w0, len]);
      }
      return out;
    };
    /** echo the motif head (first three degrees of the theme, or its mirror) at `at`, around register `reg` */
    const answer = (at: number, len: number, reg: number, mirror: boolean): Note[] => {
      const n = len >= 3 ? 3 : 2;
      const c = chordAt(at);
      const start = snap(reg, chordTones(c, reg - 7, reg + 7));
      const base = diaIdx(start);
      const out: Note[] = [];
      for (let i = 0; i < n; i++) {
        const a = at + i;
        const iv = (head[i] - head[0]) * (mirror ? -1 : 1);
        let m = i === 0 ? start : alter(SC[base + iv], chordAt(a));
        if (i > 0 && isStrong(a, 1)) m = fit(m, a, 1, iv);
        out.push({ at: a, dur: i === n - 1 ? Math.max(1, len - i) * 0.92 : 0.95, m, acc: i === 0 ? 0 : -0.05 });
      }
      return out;
    };
    /** chord tones upward from the lowest bass-or-root note at or above lo (for arpeggios) */
    const arpTones = (c: Chord, lo: number): number[] => {
      const want = pcsOf(c).has(c.bass) ? c.bass : c.root;
      let base = lo;
      while (pc(base) !== want) base++;
      return chordTones(c, base, base + 40);
    };
    const harpFill = (bar: number, from = 3): void => {
      const tones = arpTones(chordAt(bar * 6 + from), tonicM - 12);
      for (let i = 0; i < 6; i++) add('harp', bar * 6 + from + i * 0.5, 3, tones[Math.min(tones.length - 1, i)], 0.3 + i * 0.03);
    };
    const harpRoll = (at: number, lo: number, n: number, gap: number, vel: number, dur: number): void => {
      const tones = arpTones(chordAt(at), lo);
      for (let i = 0; i < n && i < tones.length; i++) add('harp', at + i * gap, dur, tones[i], vel + i * 0.012);
    };
    const pianoShift = tonicM - 12 >= 60 ? -12 : 0;

    // ---------------------------------------------------------------- the meadow melody (generated once, reused by B1 and B2)
    const meadowLine = (b0: number): Note[] => {
      const lo = tonicM - 10, hi = tonicM + 8;
      const pickCells = () => [rng.pick(BR_MOV), rng.pick(BR_MOV), rng.pick(BR_MOV)];
      const p0 = [...pickCells(), rng.pick(BR_END)];
      const phr = [p0, p0, [...pickCells(), rng.pick(BR_END)], [...pickCells(), [[0, 4]] as const]];
      const steps = (n: number, up: boolean): number[] =>
        Array.from({ length: n }, (_, i) => (i === 0 ? 0 : rng.weighted([1, -1, 2, -2, 0, 3, -3], up ? [40, 24, 14, 9, 4, 6, 3] : [24, 40, 9, 14, 4, 3, 6])));
      const count = (p: readonly (readonly (readonly [number, number])[])[]) => p.reduce((a, c) => a + c.length, 0);
      const st0 = steps(count(p0), true);
      const allSteps = [st0, st0, steps(count(phr[2]), false), steps(count(phr[3]), false)];
      const out: Note[] = [];
      const startIdx = diaIdx(snap(tonicM - 5, chordTones(chordAt(b0 * 6), lo, hi)));
      let idx = startIdx, top = startIdx, prev = SC[idx];
      phr.forEach((cells, pi) => {
        if (pi === 1) idx = startIdx + 2; // sequence a third higher
        if (pi === 2) idx = Math.min(top, diaIdx(hi - 2)) + (rng.chance(0.5) ? 0 : -1);
        let k = 0;
        cells.forEach((cell, bj) => {
          for (const [pos, dur] of cell) {
            const st = allSteps[pi][k++] ?? 0;
            idx += st;
            if (SC[idx] > hi) idx -= 2 * Math.max(1, Math.abs(st));
            if (SC[idx] < lo) idx += 2 * Math.max(1, Math.abs(st));
            const at = (b0 + pi * 4 + bj) * 6 + pos;
            let m = alter(SC[idx], chordAt(at));
            if (isStrong(at, dur)) {
              m = fit(m, at, dur, m - prev || st);
              idx = diaIdx(m);
            }
            top = Math.max(top, idx);
            const arch = [0, 0.02, 0.03, 0][bj] + [0, 0.02, 0.05, 0][pi];
            out.push({ at, dur, m, acc: arch + (pos === 0 ? 0.03 : 0) });
            prev = m;
          }
        });
      });
      return out;
    };
    /** harmony a third (strong beats: the next chord tone at least a minor third) below a line */
    const thirdsBelow = (line: readonly Note[]): Note[] =>
      line.map((n) => {
        let m = alter(SC[diaIdx(n.m) - 2], chordAt(n.at));
        if (isStrong(n.at, n.dur)) {
          const ct = chordTones(chordAt(n.at), n.m - 9, n.m - 3);
          if (ct.length) m = ct[ct.length - 1];
        }
        return { ...n, acc: n.acc - 0.04, m };
      });

    // ---------------------------------------------------------------- melody / counter-lines per section
    let meadow: Note[] | null = null;
    for (const s of secs) {
      const b0 = s.start;
      const nx = nextSec(s);
      if (s.kind === 'A') {
        let bars = theme.bars.map((b) => [...b]);
        if (s.v === 1 || s.v === 3) bars = ornament(bars, s.v === 3 ? 0.5 : 0.4);
        let line = realize(b0, bars);
        if (s.v === 1 || s.v === 3) line = graces(line, s.v === 3 ? 0.35 : 0.28);
        const melK: K = s.v === 2 ? 'piano' : 'flute';
        const shift = s.v === 2 ? pianoShift : 0;
        // pickup into the section (in the previous section's last bar)
        if (b0 > 0) {
          const pk = realize(b0 - 1, [theme.pickup], 0, false);
          addLine(melK, pk, BASE[melK] * 0.9, shift);
        }
        addLine(melK, line, BASE[melK], shift);
        const hw = holds(line, b0, 15);
        if (s.v === 1) {
          // piano answers below the held flute notes
          for (const [at, len] of hw) if (rng.chance(0.8)) addLine('piano', answer(at, len, tonicM - 8, rng.chance(0.3)), 0.42);
        } else if (s.v === 2) {
          // the flute answers the piano from above
          for (const [at, len] of hw) if (rng.chance(0.85)) addLine('flute', answer(at, len, tonicM + shift + 9, rng.chance(0.3)), 0.52);
        } else if (s.v === 3) {
          // out chorus: strings an octave below on the consequent, harp rolls in the holds, glass on the climax
          addLine('vln', line.filter((n) => n.at >= (b0 + 8) * 6 && n.dur >= 1.5), 0.42, -12);
          for (const [at] of hw) if (rng.chance(0.7)) harpRoll(at, tonicM - 17, 4, 0.14, 0.32, 4);
          for (const n of line) if (n.at >= (b0 + 12) * 6 && n.at < (b0 + 14) * 6 && n.dur >= 2 && n.m + 12 <= 98) add('glass', n.at, n.dur, n.m + 12, 0.3);
        }
      } else if (s.kind === 'B') {
        meadow ??= meadowLine(b0);
        const off = (b0 - (secs.find((x) => x.kind === 'B')?.start ?? b0)) * 6;
        const line = meadow.map((n) => ({ ...n, at: n.at + off }));
        if (s.v === 0) {
          addLine('reed', line, BASE.reed);
          // flute answers at the phrase ends
          for (const [at, len] of holds(line, b0, 15)) if ((at / 6 - b0) % 4 >= 3 - 1e-6 || rng.chance(0.25)) addLine('flute', answer(at, len, tonicM + 5, rng.chance(0.35)), 0.5);
        } else {
          const hiM = Math.max(...line.map((n) => n.m));
          addLine('vln', line, BASE.vln, hiM + 12 <= 91 ? 12 : 0);
          addLine('reed', thirdsBelow(line), BASE.reed * 0.86);
          for (const [at] of holds(line, b0, 15)) if (rng.chance(0.75)) harpRoll(at, tonicM - 17, 4, 0.14, 0.3, 4);
        }
      } else if (s.kind === 'inter') {
        // the motif passed around: reed, then flute, then piano; marimba creeps back in
        const m1 = theme.bars.slice(0, 2);
        const sh1 = bestShift(b0, m1);
        const reedLine = realize(b0, m1, sh1, false);
        const reedOct = Math.max(...reedLine.map((n) => n.m)) > tonicM + 6 ? -12 : 0;
        addLine('reed', reedLine, BASE.reed * 0.95, reedOct);
        const sh2 = bestShift(b0 + 2, m1);
        addLine('flute', realize(b0 + 2, m1, sh2, false), BASE.flute * 0.88);
        for (const j of [4, 5]) addLine('piano', answer((b0 + j) * 6, 3, tonicM - 3, j === 5), 0.44);
        if (nx?.kind !== 'A') {
          // lead into the meadow on the flute: a rising line of the last chord's tones
          const tones = chordTones(chordAt((b0 + 7) * 6), tonicM - 3, tonicM + 9);
          [0, 1, 2].forEach((i) => add('flute', (b0 + 7) * 6 + 3 + i, 0.95, tones[Math.min(tones.length - 1, i + 1)], 0.5 + i * 0.03));
        }
      } else if (s.kind === 'intro') {
        // a soft "horn" line on the reed: the top voice of the strings, common tones tied, ending on a 4-3 suspension
        const horn: Note[] = [];
        for (let j = 4; j < 7; j++) {
          const m = plan[b0 + j].slots[0].v[3];
          const prevH = horn[horn.length - 1];
          if (prevH && prevH.m === m) prevH.dur += 6;
          else horn.push({ at: (b0 + j) * 6, dur: 6, m, acc: 0 });
        }
        const last = plan[b0 + 7].slots;
        const hm = horn[horn.length - 1].m;
        const sus = last[0].c.tones.includes(5) ? snap(hm, chordTones(last[0].c, hm - 5, hm + 3).filter((m) => pc(m - last[0].c.root) === 5)) : NaN;
        if (Number.isFinite(sus) && last.length > 1) {
          horn.push({ at: (b0 + 7) * 6, dur: 3, m: sus, acc: 0.02 });
          horn.push({ at: (b0 + 7) * 6 + 3, dur: 1.5, m: snap(sus - 1, chordTones(last[1].c, sus - 3, sus)), acc: -0.04 });
        } else horn.push({ at: (b0 + 7) * 6, dur: 4, m: last[0].v[3], acc: 0 });
        addLine('reed', horn, 0.34);
      } else if (s.kind === 'coda') {
        // the motif on the flute, an arrival, then the reed echoes it over the borrowed iv
        const m0 = [theme.bars[0]];
        const fl = realize(b0, m0, bestShift(b0, m0), false);
        addLine('flute', fl, BASE.flute * 0.92);
        const lastF = fl[fl.length - 1].m;
        add('flute', (b0 + 1) * 6, 5, snap(lastF, chordTones(chordAt((b0 + 1) * 6), lastF - 4, lastF + 4)), BASE.flute * 0.88);
        const rl = realize(b0 + 2, m0, bestShift(b0 + 2, m0), false);
        const reedOct = Math.max(...rl.map((n) => n.m)) > tonicM + 4 ? -12 : 0;
        addLine('reed', rl, BASE.reed * 0.9, reedOct);
        const lastR = rl[rl.length - 1].m;
        add('reed', (b0 + 3) * 6, 5, snap(lastR, chordTones(chordAt((b0 + 3) * 6), lastR - 4, lastR + 4)) + reedOct, BASE.reed * 0.82);
        addLine('piano', answer((b0 + 3) * 6 + 3, 3, tonicM - 5, true), 0.36);
        addLine('flute', realize(b0 + 4, [theme.bars[14]], 0, false), BASE.flute * 0.85);
        add('flute', (b0 + 5) * 6, 11, SC[i0], BASE.flute * 0.72);
      }
      // harp fill at the end of the section (or a marimba run in the accompaniment below)
      if (nx && s.kind !== 'coda' && s.kind !== 'intro' && rng.chance(0.7)) harpFill(b0 + s.bars - 1);
      // cymbal swell into the big arrivals
      // (placed two bars early at pos 12 so its start is inside the scheduling window of that bar)
      if (nx && (nx.name === 'meadow II' || nx.name === 'theme out' || (nx.kind === 'B' && rng.chance(0.5)))) plan[nx.start - 2].ev.push({ k: 'swell', pos: 12, dur: 2.1, m: 0, vel: 0.3 });
    }

    // ---------------------------------------------------------------- accompaniment per bar
    let marBase = 55;
    const marPatBySec = new Map<Sec, number[]>();
    const harpPat = rng.pick(HARP_PAT);
    const vibesOn = (s: Sec) => s.kind === 'B' && s.v === 0;
    plan.forEach((p, bi) => {
      const s = p.sec, j = p.inSec, x0 = bi * 6;
      const last = j === s.bars - 1;
      const kind = s.kind;
      const isFinal = kind === 'coda' && j >= 5;
      // --- texture switches
      let mar: 0 | 1 | 2 = 2; // off / sparse / full
      let bass: 0 | 1 | 2 = 2; // off / dotted-half / dotted-quarters
      let padVel = 0.3, padAtt = 1.1;
      let pizz = false;
      let shaker: 0 | 1 | 2 | 3 = 0; // off / light / normal / full
      if (kind === 'intro') {
        bass = j < 2 ? 0 : j < 4 ? 1 : 2;
        padVel = j >= 4 ? 0.28 : 0;
        padAtt = 1.8;
        shaker = j >= 6 ? 1 : 0;
      } else if (kind === 'A') {
        if (s.v === 0) (bass = j < 8 ? 1 : 2), (padVel = 0.26), (shaker = j >= 8 ? 1 : 0);
        else (pizz = true), (shaker = s.v === 3 ? 3 : s.v === 2 && j < 8 ? 1 : 2), (padVel = s.v === 3 ? 0.36 : 0.3);
      } else if (kind === 'B') {
        if (s.v === 0) (mar = 1), (bass = j % 2 ? 2 : 1), (padVel = 0.34), (padAtt = 1.5), (shaker = 1);
        else (pizz = true), (shaker = 3), (padVel = 0.34), (padAtt = 1.3);
      } else if (kind === 'inter') {
        mar = j >= 6 ? 1 : 0;
        bass = 1;
        padVel = 0.36;
        padAtt = 1.8;
        pizz = j === 7;
        shaker = j >= 6 ? 1 : 0;
      } else {
        mar = j < 2 ? 2 : j < 5 ? 1 : 0;
        bass = j < 2 || j === 4 ? 2 : 1;
        pizz = j < 2;
        padVel = 0.3;
        shaker = j < 2 ? 1 : 0;
      }
      if (isFinal) (mar = 0), (bass = 0), (pizz = false), (padVel = 0);

      // --- strings bed: one voicing per chord (identical consecutive chords are tied)
      if (padVel > 0)
        for (const sl of p.slots) {
          const prevPad = bi > 0 ? plan[bi - 1].pads.at(-1) : undefined;
          const prevSlot = sl.pos > 0 ? p.slots[0] : bi > 0 ? plan[bi - 1].slots.at(-1) : undefined;
          if (sl.pos === 0 && prevPad && prevSlot && prevSlot.c.name === sl.c.name && prevPad.pos + prevPad.dur <= 6 + 1.01) {
            prevPad.dur += sl.dur;
            continue;
          }
          p.pads.push({ pos: sl.pos, dur: sl.dur + 0.8, notes: sl.v, vel: padVel, att: padAtt, rel: 1.5, cut: kind === 'B' ? 8600 : 8000 });
        }

      // --- marimba ostinato
      if (mar) {
        let pat = marPatBySec.get(s);
        if (!pat) marPatBySec.set(s, (pat = mar === 2 ? rng.pick(MAR_FULL) : rng.pick(MAR_SPARSE)));
        if (mar === 1 && pat.every((x) => x >= 0)) pat = MAR_SPARSE[0];
        const run = last && nextSec(s) && !p.ev.some((e) => e.k === 'harp') && mar === 2;
        const bases = p.slots.map((sl) => {
          const want = pcsOf(sl.c).has(sl.c.bass) ? sl.c.bass : sl.c.root;
          let best = marBase, bd = Infinity;
          for (let m = 50; m <= 63; m++) if (pc(m) === want && Math.abs(m - marBase) < bd) (bd = Math.abs(m - marBase)), (best = m);
          return (marBase = best);
        });
        const vBase = kind === 'intro' ? 0.4 : kind === 'coda' ? 0.42 : 0.46;
        for (let e = 0; e < 6; e++) {
          const idx = run ? e : pat[e];
          if (idx < 0) continue;
          const si = p.slots.length > 1 && e >= 3 ? 1 : 0;
          const tones = chordTones(p.slots[si].c, bases[si], bases[si] + 30);
          add('marimba', x0 + e, 2, tones[Math.min(tones.length - 1, idx)], humVel(rng, vBase * MAR_ACC[e] * (run ? 0.9 + e * 0.03 : 1), 0.04));
        }
      }
      // --- pizzicato after-beats (eighths 2 and 5): upper voices of the strings voicing
      if (pizz)
        for (const e of [2, 5]) {
          const sl = slotAt(x0 + e);
          const hiV = sl.v.filter((m) => m >= tonicM - 14);
          const notes = hiV.length >= 2 ? hiV.slice(-2) : [sl.v[2], sl.v[3]];
          const both = kind === 'A' && s.v === 3;
          add('pizz', x0 + e, 1, notes[e === 2 ? 1 : 0], humVel(rng, e === 2 ? 0.44 : 0.38, 0.04));
          if (both) add('pizz', x0 + e, 1, notes[e === 2 ? 0 : 1], humVel(rng, 0.34, 0.04));
        }
      // --- upright: dotted quarters (root, then fifth / root / approach), or one long note
      if (bass) {
        for (const sl of p.slots) {
          add('upright', x0 + sl.pos, bass === 1 && sl.dur === 6 ? 5 : 2.7, sl.bass, humVel(rng, 0.66, 0.04));
          if (bass === 2 && sl.dur === 6) {
            const nextBass = bi + 1 < total ? plan[bi + 1].slots[0].bass : sl.bass;
            const r = rng.next();
            let m = sl.bass;
            if (r < 0.45) {
              const f = sl.bass + 7 <= 52 ? sl.bass + 7 : sl.bass - 5;
              m = pcsOf(sl.c).has(pc(f)) ? f : sl.bass;
            } else if (r < 0.7 && Math.abs(nextBass - sl.bass) >= 3) m = diaIdx(nextBass) >= 0 ? SC[diaIdx(nextBass) + (nextBass > sl.bass ? -1 : 1)] : sl.bass;
            add('upright', x0 + 3, 2.6, m, humVel(rng, 0.55, 0.04));
          }
        }
      }
      // --- vibes: soft dyads on the dotted quarters in the first meadow
      if (vibesOn(s)) {
        for (const e of [0, 3]) {
          const sl = slotAt(x0 + e);
          const up = sl.v.map((m) => (m < tonicM - 5 ? m + 12 : m)).sort((a, b) => a - b);
          const top = up.slice(-2);
          if (e === 0 || sl.pos === 3) top.forEach((m, i) => add('vibes', x0 + e + i * 0.04, 3, m, humVel(rng, 0.28, 0.03)));
          else add('vibes', x0 + e, 2.5, up[up.length - 3] ?? top[0], humVel(rng, 0.22, 0.03));
        }
      }
      // --- interlude harp arpeggios
      if (kind === 'inter' || (kind === 'intro' && j === 0)) {
        if (kind === 'intro') harpRoll(x0, tonicM - 24, 6, 0.3, 0.34, 8);
        else
          for (let e = 0; e < 6; e++) {
            const sl = slotAt(x0 + e);
            const tones = arpTones(sl.c, tonicM - 22);
            add('harp', x0 + e, 3, tones[Math.min(tones.length - 1, harpPat[e])], humVel(rng, 0.36 * MAR_ACC[e], 0.03));
          }
      }
      // --- shaker (6/8 lilt), triangle
      if (shaker) {
        const hits: [number, number][] = shaker === 3 ? [[0, 0.36], [1, 0.17], [2, 0.24], [3, 0.32], [4, 0.17], [5, 0.24]] : shaker === 1 ? [[0, 0.3], [3, 0.26], [5, 0.16]] : [[0, 0.34], [2, 0.21], [3, 0.3], [5, 0.21]];
        for (const [e, v] of hits) add('shaker', x0 + e, 0, 0, humVel(rng, v, 0.03));
      }
      const triOpen = (kind === 'intro' && j === 4) || (j === 0 && kind !== 'coda') || (kind === 'A' && (s.v === 3 ? j % 4 === 0 : j === 8)) || (kind === 'B' && j === 8);
      if (triOpen) add('triangle', x0, 0, 0, humVel(rng, 0.34, 0.03));
      if (((kind === 'A' && s.v !== 0) || (kind === 'B' && s.v === 1)) && j % 2 === 1) add('tri', x0 + 3, 0, 0, humVel(rng, 0.22, 0.03));

      // --- the final chord (coda bar 6 of 7) and its ring
      if (kind === 'coda' && j === 5) {
        const c = p.slots[0].c;
        p.pads.push({ pos: 0, dur: 10, notes: voice4(plan[bi - 1].slots.at(-1)!.v, c, 50, 79), vel: 0.36, att: 0.9, rel: 3.2, cut: 2600 });
        add('upright', x0, 9, p.slots[0].bass - (p.slots[0].bass >= 43 ? 12 : 0), 0.6);
        harpRoll(x0, tonicM - 24, 8, 0.22, 0.32, 10);
        const top = chordTones(c, tonicM + 2, tonicM + 16).slice(-2);
        top.forEach((m, i) => add('vibes', x0 + 1.5 + i * 0.06, 9, m, 0.24));
        add('triangle', x0, 0, 0, 0.26);
      }
      if (kind === 'coda' && j === 6) add('glass', x0 + 1, 4, SC[i0 + 7] <= 96 ? SC[i0 + 7] : SC[i0], 0.2);
    });

    // ---------------------------------------------------------------- monophonic lines: no overlaps / double onsets
    for (const k of ['flute', 'reed', 'vln', 'piano'] as const) {
      const list: { e: Ev; at: number }[] = [];
      plan.forEach((p, bi) => p.ev.forEach((e) => e.k === k && list.push({ e, at: bi * 6 + e.pos })));
      list.sort((a, b) => a.at - b.at);
      for (let i = 0; i + 1 < list.length; i++) {
        const gap = list[i + 1].at - list[i].at;
        if (gap < 0.05) list[i + 1].e.vel = -1; // same onset: keep the first
        else if (list[i].e.dur > gap) list[i].e.dur = gap;
      }
    }
    for (const p of plan) p.ev = p.ev.filter((e) => e.vel > 0);

    // ---------------------------------------------------------------- dynamics, tempo, mix
    const dynamics = (s: Sec, x: number): number => {
      switch (s.kind) {
        case 'intro': return 0.84 + 0.1 * x;
        case 'A': return [0.92, 0.96, 0.95, 1.1][s.v];
        case 'B': return s.v === 0 ? 0.9 + 0.06 * Math.sin(Math.PI * x) : 0.96 + 0.05 * Math.sin(Math.PI * x);
        case 'inter': return 0.84 + 0.1 * x;
        default: return 0.98 - 0.12 * x;
      }
    };
    const b2 = secOf('meadow II');
    const broaden = b2 ? b2.start + b2.bars - 1 : -1;
    const tempo = (bar: number): number => {
      const r = bar - (total - 3);
      if (r >= 0) return bpm * [0.9, 0.8, 0.74][r];
      if (bar === total - 4) return bpm * 0.96;
      return bar === broaden ? bpm * 0.94 : bpm;
    };

    const setup = (): void => {
      inst.mix('flute', { level: 0.85, pan: 0.1, reverb: 0.32, delay: 0.09 });
      inst.mix('pad:reed', { level: 0.64, pan: -0.14, reverb: 0.3 });
      inst.mix('piano', { level: 0.75, pan: -0.12, reverb: 0.3 });
      inst.mix('strings', { level: 1.15, reverb: 0.45, lowpass: 11000 });
      inst.mix('strings:lead', { level: 0.9, pan: 0.14, reverb: 0.38 });
      inst.mix('marimba', { level: 1.05, pan: 0.24, reverb: 0.22 });
      inst.mix('pizz', { level: 1.0, pan: -0.32, reverb: 0.3 });
      inst.mix('upright', { level: 0.9, reverb: 0.05 });
      inst.mix('harp', { level: 1.05, pan: 0.3, reverb: 0.42 });
      inst.mix('vibes', { level: 1.5, pan: -0.28, reverb: 0.4, tremolo: 0.15, tremoloRate: 3.6 });
      inst.mix('glass', { level: 0.55, pan: 0.3, lowpass: 8000 });
      inst.mix('triangle', { level: 0.9, pan: 0.36 });
      inst.mix('shaker', { level: 1.9, pan: -0.3 });
      inst.mix('cymbal', { level: 0.55 });
      inst.setDelay({ beats: 3, feedback: 0.24, tone: 2600 });
    };

    return song(env, {
      bpm,
      tempo,
      beatsPerBar: 6,
      sections: secs.map((s) => ({ name: s.name, bars: s.bars })),
      tail: 5,
      setup,
      bar(b: BarInfo) {
        const p = plan[b.bar];
        const d = dynamics(p.sec, b.sectionProgress);
        const sec = (n: number) => b.beatsToSec(n);
        for (const c of p.pads) inst.strings(humanize(rng, b.at(c.pos), 12), c.notes, sec(c.dur), c.vel * d, { attack: c.att, release: c.rel, cutoff: c.cut });
        for (const e of p.ev) {
          if (e.k === 'swell') {
            inst.cymbal(b.at(e.pos), e.vel * d, { swell: e.dur });
            continue;
          }
          const t = humanize(rng, b.at(e.pos), HUM[e.k]) + (e.k === 'flute' || e.k === 'reed' ? 0.006 : 0);
          const du = sec(e.dur);
          const v = e.vel * d;
          switch (e.k) {
            case 'flute': inst.flute(t, e.m, du * 0.95, v, { breath: du > 0.35 ? 0.55 : 0, vibrato: 12 }); break;
            case 'reed': inst.pad(t, e.m, du * 0.95, v, { ch: 'reed', attack: 0.07, release: 0.28, cutoff: 1500, wave: 'square', detune: 3 }); break;
            case 'piano': inst.piano(t, e.m, du, v, { bright: 0.35 }); break;
            case 'vln': inst.strings(t, e.m, du * 0.97, v, { ch: 'lead', attack: 0.16, release: 0.6, cutoff: 4200 }); break;
            case 'marimba': inst.marimba(t, e.m, du, v); break;
            case 'vibes': inst.vibes(t, e.m, du, v); break;
            case 'pizz': inst.pizz(t, e.m, du, v); break;
            case 'upright': inst.upright(t, e.m, du, v); break;
            case 'harp': inst.harp(t, e.m, du, v); break;
            case 'glass': inst.glass(t, e.m, du, v); break;
            case 'triangle': inst.triangle(t, v); break;
            case 'tri': inst.triangle(t, v, { open: false }); break;
            case 'shaker': inst.shaker(t, v, { len: 0.08 }); break;
          }
        }
      },
    });
  },
};
