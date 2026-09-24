/**
 * "Greenbelt" - light orchestral pastoral for calm days in the suburbs and parks (Metropolis soundtrack).
 *
 * 6/8 at a dotted-quarter pulse of 68-74 (one song beat = one eighth note, 6 per bar). A marimba broken-chord ostinato,
 * pizzicato strings on the after-beats, a pizz upright on the dotted quarters, a warm voice-led string bed (common tones
 * held across the chords, moving voices re-bowed, swells on entries), and a flute theme: a 16-bar period (motif,
 * sequence a third lower, a climb, a 4-3 half cadence |
 * motif again, a climb to the peak, then an authentic cadence). Soft piano answers echo the motif head while the
 * theme holds its long notes; in the piano statement the two swap roles (piano tune, flute answers underneath).
 * A clarinet-like reed (a square-wave voice built on the pad) carries the contrasting "meadow" section, which later
 * returns on violins with the reed in thirds below. Harp fills mark the section ends, with vibes, shaker, triangle and
 * a cymbal swell into the big arrivals.
 *
 * Form (one of two per seed, 119 bars, about 3:20-3:30):
 *   intro 8 | theme 16 | theme II 16 | meadow 16 | theme III (piano) 16 | interlude 8 | meadow II 16 | theme out 16 | coda 7
 *   intro 8 | theme 16 | meadow 16 | theme II (piano) 16 | interlude 8 | theme III 16 | meadow II 16 | theme out 16 | coda 7
 * The coda echoes the motif (flute, then the reed over a borrowed iv), makes a ritardando cadence, and strikes a rolled
 * add9 / 6-9 / maj9 chord two bars before the end.
 *
 * Keeping the tune on top: every line is placed above the string bed (the bed follows the key down in G / A / Bb, the
 * piano states the theme in the flute's octave, the meadow tune sits around B4-B5 in every key). The bed is voiced
 * under the tune: voices above a held melody note and any m2 / m9 against a melody note are penalised, and a chord tone
 * a semitone under a chord-tone melody note (the maj7 under the root, the 9th under a minor third) is left out while
 * that note sounds. Mallets and harp are damped at chord changes and moved off any semitone rub with a melody note.
 *
 * Every play re-rolls the key, tempo and form. It picks one of three composed themes and, per statement, one of three
 * re-harmonisations of the same descending bass line. It also re-rolls the meadow chart and its melody (a skeleton of
 * chord tones on the dotted quarters - a phrase, its sequence a third higher, a falling answer and a half cadence -
 * filled in with passing and neighbour tones), the intro, interlude and cadence charts, ornaments (graces and passing
 * tones), the answers, the marimba and harp patterns, the bass figures, all voicings and the final chord.
 * The whole plan is computed in create(); bar() only schedules.
 */
import type { MusicTrack } from '../types';
import { song, type BarInfo } from '../song';
import { parseChart, chordTones, scale, humanize, humVel, snap, pc, mtof, type Chord } from '../theory';

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
  /** part of the section's tune (the string bed is voiced under it) */
  tn?: boolean;
}
interface PadEv {
  pos: number;
  /** length in seconds (from the tempo map, so held voices survive the ritardando) */
  sec: number;
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
  /** a second voicing from `split` eighths into the chord on (when the tune takes up a chord tone the bed left out) */
  v2?: number[];
  split?: number;
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
/** a melodic note of the plan (absolute eighths) */
interface MelNote {
  at: number;
  end: number;
  m: number;
  tune: boolean;
}
/** a melody note as seen by the voicing of one chord slot: weight 0..1 (overlap), tune = the section's main line */
interface LeadRef {
  m: number;
  w: number;
  tune: boolean;
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
/** three harmonisations of one descending bass line (C B A G F E D G | ... cadence), so every theme fits all of them.
 *  Bars 4, 12, 14 and 15 carry the leading tone B (a G- or E-family chord there, never C/G, C/E or a sus4, which would
 *  bend it to C); bar 13 carries the climb to the peak (A or C on its second beat), so it never moves to G there. */
const A_CHARTS = [
  'C | G/B | Am | Em/G | F | C/E | Dm7 | Gsus4 G | C | G/B | Am | Em/G | F | Em7 Am7 | Dm7 G7 | C',
  'Cadd9 | G/B | Am7 | Em7/G | Fmaj7 | C/E | Dm9 | G9sus4 G7 | Cadd9 | G/B | Am7 | Em7/G | Fmaj7 | Em7 A7 | Dm7 G9 | C',
  'C | G/B | F/A | G6 | F | C/E | Dm7 | Gsus4 G | C | Em/B | F/A | G6 | F Dm7 | Em7 Am7 | F/G G7 | C',
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
/** meadow melody skeletons: scale steps above the tune's first note on each dotted quarter (8 per 4-bar phrase).
 *  Phrase 2 is phrase 1 a third higher; phrase 3 falls from the peak; phrase 4 settles on the half cadence. */
const MEADOW_P1: readonly (readonly number[])[] = [
  [0, 1, 2, 1, 3, 4, 2, 1],
  [0, 2, 1, 2, 4, 3, 1, 2],
  [0, -1, 1, 0, 2, 4, 3, 1],
  [2, 1, 0, 1, 3, 2, 1, 0],
];
const MEADOW_P3: readonly (readonly number[])[] = [
  [6, 7, 5, 4, 5, 3, 4, 2],
  [7, 5, 6, 4, 3, 4, 2, 3],
  [5, 7, 6, 5, 4, 2, 3, 2],
];
const MEADOW_P4: readonly (readonly number[])[] = [
  [3, 4, 2, 1, 2, 0, 1, 1],
  [4, 2, 3, 1, 0, 1, -1, 1],
  [2, 3, 1, 2, 0, -1, 1, 1],
];

// accompaniment patterns: indices into the chord tones above the (voice-led) marimba base note; -1 = rest
const MAR_FULL = [[0, 2, 3, 4, 3, 2], [0, 2, 4, 2, 3, 2], [0, 1, 2, 3, 2, 1], [0, 2, 3, 1, 3, 2], [0, 3, 2, 4, 3, 2]];
const MAR_SPARSE = [[0, -1, -1, 2, -1, 3], [0, -1, 2, -1, 3, -1], [0, -1, 3, 2, -1, -1]];
const MAR_ACC = [1, 0.66, 0.74, 0.88, 0.66, 0.74];
const HARP_PAT = [[0, 1, 2, 3, 4, 5], [0, 2, 3, 4, 5, 3], [0, 2, 4, 5, 4, 2]];
/** chromatic chord tones (relative to the key) replace the diatonic neighbour: C# for C, Eb for E, F# for F, Ab for A, Bb for B */
const ALT: Record<number, number> = { 1: 0, 3: 4, 6: 5, 8: 9, 10: 11 };
/** timing jitter (ms) per instrument */
const HUM: Record<K, number> = { flute: 9, reed: 10, piano: 8, vln: 12, marimba: 6, vibes: 7, pizz: 8, upright: 6, harp: 5, glass: 6, triangle: 4, tri: 4, shaker: 5, swell: 0 };
const MEL: ReadonlySet<K> = new Set<K>(['flute', 'reed', 'piano', 'vln']);
/** a moving bed voice overlaps its successor by this much (eighths) and then fades with a short release: legato, but no
 *  old note left sounding under a new downbeat. Voices that stop for a rest keep a long release. */
const BED_OV = 0.2;
const BED_REL_MOVE = 0.9, BED_REL_REST = 1.5;
/** velocity for an n-note strings call whose notes are each as loud as inside a 4-note chord call at velocity 1
 *  (the synth divides by sqrt(n) and amplitude follows vel^1.5) */
const groupVel = (n: number): number => Math.pow(Math.sqrt(n) / 2, 2 / 3);

export const track: MusicTrack = {
  id: 'greenbelt_pastoral',
  title: 'Greenbelt',
  mood: 'Pastoral 6/8: marimba ostinato, flute and reed, pizzicato and warm strings, harp',
  tags: ['day', 'calm', 'region'],
  bpm: 72,
  gain: 1.5,
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
    /** string bed range: follows the key down, so the tunes of the low keys still sit above it */
    const bedLo = 55 + Math.min(0, T), bedHi = 76 + Math.min(0, T);
    /** register centre of the meadow tune: B4-D5 in every key (above the bed, below the flute's climax) */
    const meadowC = tonicM >= 72 ? tonicM - 1 : tonicM + 4;

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
    // a theme that peaks on the tonic in bar 14 keeps it natural: Am7 instead of the A7 (whose C# would bend the peak)
    const tonicPeak14 = theme.bars[13].some(([pos, dur, deg]) => pos >= 3 && dur >= 2 && ((deg % 7) + 7) % 7 === 0);
    const chartFor = (s: Sec): string => {
      switch (s.kind) {
        case 'intro': return introChart;
        case 'A': return tonicPeak14 ? A_CHARTS[aChart[s.v]].replace('Em7 A7', 'Em7 Am7') : A_CHARTS[aChart[s.v]];
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
    const nearestIn = (m: number, set: ReadonlySet<number>, dir: number): number => {
      if (set.has(pc(m))) return m;
      const d0 = dir >= 0 ? 1 : -1;
      for (let d = 1; d <= 3; d++) {
        if (set.has(pc(m + d0 * d))) return m + d0 * d;
        if (set.has(pc(m - d0 * d))) return m - d0 * d;
      }
      return m;
    };
    /** the next tone of `set` strictly above (dir >= 0) or below m */
    const stepTone = (m: number, set: ReadonlySet<number>, dir: number): number => {
      const d0 = dir >= 0 ? 1 : -1;
      for (let x = m + d0; Math.abs(x - m) <= 12; x += d0) if (set.has(pc(x))) return x;
      return m;
    };
    /** pitch classes that can carry a note from `at` for `dur` eighths: common to every chord it spans (when there is one) */
    const toneSet = (at: number, dur: number): Set<number> => {
      const first = pcsOf(chordAt(at));
      let common = first;
      for (let x = Math.floor(at) + 1; x < at + dur - 0.5; x++) {
        const s = pcsOf(chordAt(x));
        if (s !== first) common = new Set([...common].filter((p) => s.has(p)));
      }
      return common.size ? common : first;
    };
    /** strong-beat fit: the nearest chord tone */
    const fit = (m: number, at: number, dur: number, dir: number): number => nearestIn(m, toneSet(at, dur), dir);
    const diaIdx = (m: number): number => SC.indexOf(snap(m, SC));
    const isStrong = (at: number, dur: number): boolean => Math.abs(at - Math.round(at / 3) * 3) < 1e-6 || dur >= 2.5;

    // ---------------------------------------------------------------- event helpers
    const add = (k: K, at: number, dur: number, m: number, vel: number, tn = false): void => {
      let bar = Math.floor(at / 6);
      if (bar < 0) bar = 0;
      if (bar >= total) return;
      plan[bar].ev.push({ k, pos: Math.max(0, at - bar * 6), dur, m, vel, tn });
    };
    const addLine = (k: K, line: readonly Note[], vel: number, shift = 0, tn = false): void => {
      for (const n of line) add(k, n.at, n.dur, n.m + shift, vel * (1 + n.acc), tn);
    };
    /** tune velocities (the piano tune plays in the flute's octave, one velocity layer up from its answers) */
    const BASE: Record<string, number> = { flute: 0.62, piano: 0.66, reed: 0.52, vln: 0.46 };

    /** realise composed theme bars (degrees) over the chords, starting at bar b0 */
    const realize = (b0: number, bars: readonly (readonly N[])[], degShift = 0, arch = true): Note[] => {
      const flat: { at: number; dur: number; deg: number; j: number; pos: number }[] = [];
      bars.forEach((notes, j) => {
        for (const [pos, dur, deg] of notes) flat.push({ at: (b0 + j) * 6 + pos, dur, deg: deg + degShift, j, pos });
      });
      const out: Note[] = [];
      let prev = SC[i0];
      flat.forEach((n, i) => {
        let m = alter(SC[i0 + n.deg], chordAt(n.at));
        // a short note approached and left by step in one direction is a passing tone: it keeps its pitch on the beat
        const a = flat[i - 1], z = flat[i + 1];
        const passing = !!a && !!z && n.dur <= 1 && Math.abs(n.deg - a.deg) === 1 && n.deg - a.deg === z.deg - n.deg;
        if (isStrong(n.at, n.dur) && !passing) m = fit(m, n.at, n.dur, m - prev);
        out.push({ at: n.at, dur: n.dur, m, acc: (arch ? ARCH[n.j % 16] : 0) + (n.pos === 0 ? 0.03 : 0) + (n.dur >= 3 ? 0.02 : 0) });
        prev = m;
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
        const gm = alter(SC[diaIdx(n.m) + 1], chordAt(n.at));
        if (prev && n.dur >= 3 && prev.at + 0.6 < n.at && gm !== prev.m && rng.chance(p)) {
          const g = 0.3;
          prev.dur = Math.min(prev.dur, n.at - g - prev.at);
          out.push({ at: n.at - g, dur: g, m: gm, acc: -0.2 });
        }
        out.push({ ...n });
      }
      return out;
    };
    /** windows for answers, [start (abs eighths), length]: the second half of a bar where the line holds a note struck
     *  earlier, or the last two eighths under a long note struck on the second beat (never together with a tune onset) */
    const holds = (line: readonly Note[], b0: number, bars: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let j = 0; j < bars; j++) {
        const w0 = (b0 + j) * 6 + 3;
        if (line.some((n) => n.at <= w0 - 1 && n.at + n.dur >= w0 + 2)) {
          const next = line.filter((n) => n.at > w0 + 1e-6).reduce((a, n) => Math.min(a, n.at), w0 + 3);
          const len = Math.min(next, w0 + 3) - w0;
          if (len >= 2) out.push([w0, len]);
        } else if (line.some((n) => Math.abs(n.at - w0) < 1e-6 && n.dur >= 3)) out.push([w0 + 1, 2]);
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
        // a chromatic start can meet its altered neighbour: step once more in the motif's direction
        const prevIv = i > 0 ? (head[i - 1] - head[0]) * (mirror ? -1 : 1) : 0;
        if (i > 0 && m === out[i - 1].m) m = alter(SC[base + iv + (iv >= prevIv ? 1 : -1)], chordAt(a));
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
    /** the chord tone nearest `target` that has no semitone neighbour in the chord (safe against any voicing) */
    const safeTone = (c: Chord, target: number): number => {
      const cp = pcsOf(c);
      const ok = chordTones(c, target - 7, target + 7).filter((m) => !cp.has(pc(m + 1)) && !cp.has(pc(m - 1)));
      return ok.length ? snap(target, ok) : target;
    };

    // ---------------------------------------------------------------- the meadow melody (generated once, reused by B1 and B2)
    /** weak eighths between two beat notes (scale indices a -> b, k notes): passing tones, or a neighbour / turn when close */
    const fillPath = (a: number, b: number, k: number): number[] => {
      const d = b - a;
      const s = Math.sign(d) || (rng.chance(0.5) ? 1 : -1);
      if (Math.abs(d) > k) return Array.from({ length: k }, (_, q) => b - (k - q) * s); // approach the target by step
      if (k === 1) return [d === 0 ? a + s : b + s]; // neighbour, or overshoot and fall back
      if (k === 2) return d === 0 ? [a + s, a - s] : Math.abs(d) === 1 ? [a - s, a] : [a - s, a + s];
      return Array.from({ length: k }, (_, q) => (q % 2 ? a : a + s));
    };
    const meadowLine = (b0: number): Note[] => {
      const lo = meadowC - 9, hi = meadowC + 12;
      const cells = () => [rng.pick(BR_MOV), rng.pick(BR_MOV), rng.pick(BR_MOV)];
      const p0 = [...cells(), rng.pick(BR_END)];
      const phr = [p0, p0, [...cells(), rng.pick(BR_END)], [...cells(), [[0, 4]] as const]];
      const wobble = (sh: readonly number[]): number[] => {
        const o = [...sh];
        o[rng.int(1, 5)] += rng.pick([-1, 1]);
        return o;
      };
      const s1 = wobble(rng.pick(MEADOW_P1));
      const skel = [s1, s1.map((x) => x + 2), wobble(rng.pick(MEADOW_P3)), wobble(rng.pick(MEADOW_P4))];
      const sd = diaIdx(snap(meadowC - 2, chordTones(chordAt(b0 * 6), meadowC - 7, meadowC + 3)));
      const flat: { at: number; dur: number; tgt: number | null; acc: number }[] = [];
      phr.forEach((cs, pi) =>
        cs.forEach((cell, bj) => {
          for (const [pos, dur] of cell) {
            const beat = pos === 0 || pos === 3;
            flat.push({
              at: (b0 + pi * 4 + bj) * 6 + pos,
              dur,
              tgt: beat ? sd + skel[pi][bj * 2 + (pos === 3 ? 1 : 0)] : null,
              acc: [0, 0.02, 0.03, 0][bj] + [0, 0.02, 0.05, 0][pi] + (pos === 0 ? 0.03 : 0),
            });
          }
        }),
      );
      const ms = flat.map(() => NaN);
      // dotted-quarter beats: the chord tone nearest the skeleton, never repeating the beat note right before it
      let prevT = sd;
      flat.forEach((n, i) => {
        if (n.tgt === null) return;
        const set = toneSet(n.at, n.dur);
        const dir = n.tgt - prevT || (rng.chance(0.5) ? 1 : -1);
        let m = nearestIn(alter(SC[n.tgt], chordAt(n.at)), set, dir);
        for (let g = 0; g < 4 && m > hi; g++) m = stepTone(m, set, -1);
        for (let g = 0; g < 4 && m < lo; g++) m = stepTone(m, set, 1);
        if (i > 0 && flat[i - 1].tgt !== null && m === ms[i - 1]) {
          // the next chord tone in the skeleton's direction, or the other way at the edge of the range
          const on = stepTone(m, set, dir), back = stepTone(m, set, -dir);
          m = on >= lo && on <= hi ? on : back;
        }
        ms[i] = m;
        prevT = n.tgt;
      });
      // the eighths in between: passing tones toward the next beat note, or neighbour / turn figures
      for (let i = 0; i < flat.length; ) {
        if (flat[i].tgt !== null) {
          i++;
          continue;
        }
        let j = i;
        while (j < flat.length && flat[j].tgt === null) j++;
        const a = diaIdx(ms[i - 1]);
        const path = fillPath(a, j < flat.length ? diaIdx(ms[j]) : a, j - i);
        for (let q = i; q < j; q++) {
          const nxt = q + 1 < flat.length ? ms[q + 1] : NaN;
          // (a chromatic beat note can coincide with its altered diatonic neighbour: step once more, then the other way)
          for (const off of [0, -1, 1, -2, 2]) {
            ms[q] = alter(SC[path[q - i] + off], chordAt(flat[q].at));
            if (ms[q] !== ms[q - 1] && ms[q] !== nxt) break;
          }
        }
        i = j;
      }
      return flat.map((n, i) => ({ at: n.at, dur: n.dur, m: ms[i], acc: n.acc }));
    };
    /** harmony a third (strong beats: the next chord tone at least a minor third) below a line; it moves when the line moves */
    const thirdsBelow = (line: readonly Note[]): Note[] => {
      let prev = NaN;
      return line.map((n, i) => {
        let m = alter(SC[diaIdx(n.m) - 2], chordAt(n.at));
        if (isStrong(n.at, n.dur)) {
          const ct = chordTones(chordAt(n.at), n.m - 9, n.m - 3);
          if (ct.length) m = ct[ct.length - 1];
          if (m === prev && i > 0 && line[i - 1].m !== n.m && ct.length > 1) m = ct[ct.length - 2];
        }
        prev = m;
        return { ...n, acc: n.acc - 0.04, m };
      });
    };

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
        // pickup into the section (in the previous section's last bar)
        if (b0 > 0) addLine(melK, realize(b0 - 1, [theme.pickup], 0, false), BASE[melK] * 0.9, 0, true);
        addLine(melK, line, BASE[melK], 0, true);
        const hw = holds(line, b0, 15);
        if (s.v === 1) {
          // piano answers below the held flute notes
          for (const [at, len] of hw) if (rng.chance(0.8)) addLine('piano', answer(at, len, tonicM - 8, rng.chance(0.3)), 0.33);
        } else if (s.v === 2) {
          // roles swapped: the flute answers the piano tune from below, softly
          for (const [at, len] of hw) if (rng.chance(0.85)) addLine('flute', answer(at, len, Math.max(tonicM - 8, 63), rng.chance(0.3)), 0.4);
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
          addLine('reed', line, BASE.reed, 0, true);
          // flute answers above the reed at the phrase ends
          for (const [at, len] of holds(line, b0, 15)) if ((at / 6 - b0) % 4 >= 3 - 1e-6 || rng.chance(0.25)) addLine('flute', answer(at, len, meadowC + 7 + rng.pick([-2, 0, 3]), rng.chance(0.35)), 0.46);
        } else {
          const hiM = Math.max(...line.map((n) => n.m));
          addLine('vln', line, BASE.vln, hiM + 12 <= 94 ? 12 : 0, true);
          addLine('reed', thirdsBelow(line), BASE.reed * 0.84);
          for (const [at] of holds(line, b0, 15)) if (rng.chance(0.75)) harpRoll(at, tonicM - 17, 4, 0.14, 0.3, 4);
        }
      } else if (s.kind === 'inter') {
        // the motif passed around: reed, then flute, then piano; marimba creeps back in
        const m1 = theme.bars.slice(0, 2);
        const reedLine = realize(b0, m1, bestShift(b0, m1), false);
        const reedOct = Math.max(...reedLine.map((n) => n.m)) > tonicM + 9 ? -12 : 0;
        addLine('reed', reedLine, BASE.reed * 0.95, reedOct, true);
        addLine('flute', realize(b0 + 2, m1, bestShift(b0 + 2, m1), false), BASE.flute * 0.88, 0, true);
        for (const j of [4, 5]) addLine('piano', answer((b0 + j) * 6, 3, tonicM - 3, j === 5), 0.35);
        if (nx?.kind !== 'A') {
          // lead into the meadow on the flute: a rising line of the last chord's tones
          const tones = chordTones(chordAt((b0 + 7) * 6), tonicM - 3, tonicM + 9);
          [0, 1, 2].forEach((i) => add('flute', (b0 + 7) * 6 + 3 + i, 0.95, tones[Math.min(tones.length - 1, i + 1)], 0.5 + i * 0.03, true));
        }
      } else if (s.kind === 'coda') {
        // the motif on the flute, an arrival, then the reed echoes it over the borrowed iv
        const m0 = [theme.bars[0]];
        const fl = realize(b0, m0, bestShift(b0, m0), false);
        addLine('flute', fl, BASE.flute * 0.92, 0, true);
        const lastF = fl[fl.length - 1].m;
        add('flute', (b0 + 1) * 6, 5, snap(lastF, chordTones(chordAt((b0 + 1) * 6), lastF - 4, lastF + 4)), BASE.flute * 0.88, true);
        const rl = realize(b0 + 2, m0, bestShift(b0 + 2, m0), false);
        const reedOct = Math.max(...rl.map((n) => n.m)) > tonicM + 9 ? -12 : 0;
        addLine('reed', rl, BASE.reed * 0.9, reedOct, true);
        const lastR = rl[rl.length - 1].m;
        add('reed', (b0 + 3) * 6, 5, snap(lastR, chordTones(chordAt((b0 + 3) * 6), lastR - 4, lastR + 4)) + reedOct, BASE.reed * 0.82, true);
        addLine('piano', answer((b0 + 3) * 6 + 3, 3, tonicM - 5, true), 0.3);
        addLine('flute', realize(b0 + 4, [theme.bars[14]], 0, false), BASE.flute * 0.85, 0, true);
        // the last note: the tonic, or the third over a maj9 (its major seventh would rub a semitone under the tonic)
        add('flute', (b0 + 5) * 6, 11, fin === 'Cmaj9' ? SC[i0 + 2] : SC[i0], BASE.flute * 0.72, true);
      }
      // harp fill at the end of the section (or a marimba run in the accompaniment below)
      if (nx && s.kind !== 'coda' && s.kind !== 'intro' && rng.chance(0.7)) harpFill(b0 + s.bars - 1);
      // cymbal swell into the big arrivals
      // (placed two bars early at pos 12 so its start is inside the scheduling window of that bar)
      if (nx && (nx.name === 'meadow II' || nx.name === 'theme out' || (nx.kind === 'B' && rng.chance(0.5)))) plan[nx.start - 2].ev.push({ k: 'swell', pos: 12, dur: 2.1, m: 0, vel: 0.3 });
    }

    // ---------------------------------------------------------------- melodic notes by bar (for voicing and clash checks)
    const collectMel = (): MelNote[][] => {
      const byBar: MelNote[][] = plan.map(() => []);
      plan.forEach((p, bi) => {
        for (const e of p.ev) {
          if (!MEL.has(e.k) || e.vel <= 0) continue;
          const n: MelNote = { at: bi * 6 + e.pos, end: bi * 6 + e.pos + e.dur, m: e.m, tune: !!e.tn };
          for (let b = Math.floor(n.at / 6); b <= Math.floor((n.end - 1e-3) / 6) && b < total; b++) byBar[b].push(n);
        }
      });
      return byBar;
    };
    /** melodic notes (at least ~an eighth long) sounding in [a0, a1) */
    const melIn = (byBar: readonly MelNote[][], a0: number, a1: number): MelNote[] => {
      const out = new Set<MelNote>();
      for (let b = Math.max(0, Math.floor(a0 / 6)); b <= Math.floor((a1 - 1e-3) / 6) && b < total; b++)
        for (const n of byBar[b]) if (n.end - n.at >= 0.9 && n.at < a1 && n.end > a0) out.add(n);
      return [...out];
    };
    const leadIn = (byBar: readonly MelNote[][], a0: number, a1: number): LeadRef[] =>
      melIn(byBar, a0, a1)
        .map((n) => ({ m: n.m, w: Math.min(1, (Math.min(a1, n.end) - Math.max(a0, n.at)) / 3), tune: n.tune }))
        .filter((l) => l.w >= 0.2);

    // ---------------------------------------------------------------- voicings (strings bed, under the tune) + bass line
    /** chord tones a semitone under a chord-tone melody note: left to the melody (maj7 under the root, 9th under a minor 3rd) */
    const dropsFor = (c: Chord, lead: readonly LeadRef[]): Set<number> => {
      const cp = pcsOf(c);
      const drop = new Set<number>();
      for (const L of lead) {
        const under = pc(L.m - 1);
        if (L.w >= 0.3 && cp.has(pc(L.m)) && cp.has(under) && under !== pc(c.root) && under !== c.bass) drop.add(under);
      }
      return drop;
    };
    /**
     * 4-voice voicing of c in [lo, hi] (the bass voice may go 5 lower) with the least movement from prev (no minor seconds,
     * gaps <= 9, prefer doubling the root), voiced under the melody notes sounding in its slot: no m2 / m9 against any of
     * them, no voice above a held tune note. moveW < 1 lets a new section re-voice freely under its own tune.
     */
    const voice4 = (prev: number[] | null, c: Chord, lo: number, hi: number, lead: readonly LeadRef[] = [], moveW = 1): number[] => {
      const cp = pcsOf(c);
      const drop = dropsFor(c, lead);
      let req = [...cp].filter((p) => !drop.has(p));
      const fifth = pc(c.root + 7);
      if (req.length > 4 && c.tones.includes(7)) req = req.filter((p) => p !== fifth);
      if (req.length > 4) req = req.filter((p) => p !== pc(c.root));
      while (req.length > 4) req.pop();
      const pool: number[] = [];
      for (let m = lo - 5; m <= hi; m++) if (req.includes(pc(m))) pool.push(m);
      const pp = pool.map(pc);
      let reqMask = 0;
      for (const p of req) reqMask |= 1 << p;
      const centre = (lo + hi) / 2;
      const rootPc = pc(c.root);
      const third = [3, 4].map((iv) => pc(c.root + iv)).filter((p) => req.includes(p));
      /** doubling cost of a pitch class: a doubled 3rd or colour tone sounds thick */
      const dbl = (p: number): number => (p === rootPc ? 0 : p === fifth ? 0.8 : third.includes(p) ? 2.5 : 4);
      /** cost of one voice against the melody notes of the slot */
      const leadCost = (x: number): number => {
        let s = 0;
        for (const L of lead) {
          const iv = L.m - x;
          if (iv === 1 || iv === -1 || iv === 13 || iv === -13) s += 9 * L.w;
          else if (L.tune && x > L.m) s += L.w * (1.2 + 0.35 * (x - L.m));
          else if (L.tune && x === L.m) s += 0.6 * L.w;
        }
        return s;
      };
      const lc = pool.map(leadCost);
      let best: number[] = pool.slice(-4), bs = Infinity;
      const n = pool.length;
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++) {
          const g1 = pool[b] - pool[a];
          if (g1 < 2 || g1 > 12 || pool[b] < lo) continue;
          for (let d = b + 1; d < n; d++) {
            const g2 = pool[d] - pool[b];
            if (g2 < 2 || g2 > 9) continue;
            for (let e = d + 1; e < n; e++) {
              const g3 = pool[e] - pool[d];
              if (g3 < 2 || g3 > 9) continue;
              if ((((1 << pp[a]) | (1 << pp[b]) | (1 << pp[d]) | (1 << pp[e])) & reqMask) !== reqMask) continue;
              // doubling penalties (each extra copy of a pitch class)
              let s = 0;
              if (pp[b] === pp[a]) s += dbl(pp[b]);
              if (pp[d] === pp[a] || pp[d] === pp[b]) s += dbl(pp[d]);
              if (pp[e] === pp[a] || pp[e] === pp[b] || pp[e] === pp[d]) s += dbl(pp[e]);
              const mean = (pool[a] + pool[b] + pool[d] + pool[e]) / 4;
              if (prev) s += moveW * (Math.abs(pool[a] - prev[0]) + Math.abs(pool[b] - prev[1]) + Math.abs(pool[d] - prev[2]) + Math.abs(pool[e] - prev[3])) + Math.abs(mean - centre) * 0.3;
              else s += Math.abs(mean - centre);
              if (pool[a] < lo) s += 0.6 * (lo - pool[a]);
              // stay under the tune, and never a semitone (or minor ninth) away from a melody note
              s += lc[a] + lc[b] + lc[d] + lc[e];
              if (s < bs) (bs = s), (best = [pool[a], pool[b], pool[d], pool[e]]);
            }
          }
        }
      return best;
    };
    {
      const mel = collectMel();
      let prevV: number[] | null = null;
      let prevB = 45;
      plan.forEach((p, bi) => {
        for (const s of p.slots) {
          const a0 = bi * 6 + s.pos, a1 = a0 + s.dur;
          const lead = leadIn(mel, a0, a1);
          const pv = prevV, moveW = p.inSec === 0 && s.pos === 0 ? 0.35 : 1;
          s.v = prevV = voice4(pv, s.c, bedLo, bedHi, lead, moveW);
          // the tune sings a left-out chord tone before or after the note above it (E then F, or F then E, over Fmaj7):
          // the bed leaves the tone out only while that note sounds, so the tune's maj7 / 9th is never bare over the root
          const dropped = dropsFor(s.c, lead);
          if (dropped.size) {
            const inSlot = melIn(mel, a0, a1);
            const xs = inSlot.filter((n) => dropped.has(pc(n.m - 1)));
            const xStart = Math.max(a0, Math.min(...xs.map((n) => n.at))), xEnd = Math.min(a1, Math.max(...xs.map((n) => n.end)));
            const ys = inSlot.filter((n) => dropped.has(pc(n.m)));
            const cut = xEnd <= a1 - 1.5 && ys.some((n) => n.at >= xEnd - 0.05) ? xEnd : xStart >= a0 + 1.5 && ys.some((n) => n.end <= xStart + 0.05) ? xStart : NaN;
            if (Number.isFinite(cut)) {
              s.v = voice4(pv, s.c, bedLo, bedHi, leadIn(mel, a0, cut), moveW);
              s.split = cut - a0;
              s.v2 = prevV = voice4(s.v, s.c, bedLo, bedHi, leadIn(mel, cut, a1));
            }
          }
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
      });
    }

    // ---------------------------------------------------------------- intro: a soft "horn" line on the reed
    {
      // from the top voice of the strings, a slow line that steps down through the chords, ending on a 4-3 suspension
      const b0 = secs[0].start;
      const horn: Note[] = [{ at: (b0 + 4) * 6, dur: 6, m: plan[b0 + 4].slots[0].v[3], acc: 0 }];
      for (let j = 5; j < 7; j++) {
        const sl = plan[b0 + j].slots[0];
        const pm = horn[horn.length - 1].m;
        // chord tones a little below (or just above) the last note, clear of any semitone against the bed
        const cand = chordTones(sl.c, pm - 4, pm + 2).filter((m) => m !== pm && !sl.v.some((x) => [1, 11, 13].includes(Math.abs(m - x))));
        const m = cand.length ? cand.reduce((a, x) => (Math.abs(x - (pm - 1.5)) < Math.abs(a - (pm - 1.5)) ? x : a)) : pm;
        if (m === pm) horn[horn.length - 1].dur += 6;
        else horn.push({ at: (b0 + j) * 6, dur: 6, m, acc: 0 });
      }
      const last = plan[b0 + 7].slots;
      const hm = horn[horn.length - 1].m;
      // the suspension a little above (or, prepared, on) the last note; a prepared one is tied over the barline
      const fourths = chordTones(last[0].c, hm - 2, hm + 7).filter((m) => pc(m - last[0].c.root) === 5);
      const sus = last[0].c.tones.includes(5) && fourths.length ? snap(hm, fourths) : NaN;
      if (Number.isFinite(sus) && last.length > 1) {
        if (sus === hm) horn[horn.length - 1].dur += 3;
        else horn.push({ at: (b0 + 7) * 6, dur: 3, m: sus, acc: 0.02 });
        horn.push({ at: (b0 + 7) * 6 + 3, dur: 1.5, m: snap(sus - 1, chordTones(last[1].c, sus - 3, sus)), acc: -0.04 });
      } else horn.push({ at: (b0 + 7) * 6, dur: 4, m: last[0].v[3], acc: 0 });
      addLine('reed', horn, 0.34);
    }
    const mel = collectMel();

    // ---------------------------------------------------------------- tempo map (a broadening before the last chorus, a final ritardando)
    const b2 = secOf('meadow II');
    const broaden = b2 ? b2.start + b2.bars - 1 : -1;
    const tempo = (bar: number): number => {
      const r = bar - (total - 3);
      if (r >= 0) return bpm * [0.9, 0.8, 0.74][r];
      if (bar === total - 4) return bpm * 0.96;
      return bar === broaden ? bpm * 0.94 : bpm;
    };
    /** seconds between two absolute eighth positions */
    const spanSec = (a0: number, a1: number): number => {
      let sum = 0;
      for (let x = a0; x < a1 - 1e-9; ) {
        const bar = Math.floor(x / 6 + 1e-9);
        const nx = Math.min(a1, (bar + 1) * 6);
        sum += ((nx - x) * 60) / tempo(Math.min(total - 1, bar));
        x = nx;
      }
      return sum;
    };

    // ---------------------------------------------------------------- accompaniment per bar
    const bedVel: number[] = plan.map(() => 0);
    const bedAtt: number[] = plan.map(() => 1.1);
    let marBase = 57;
    const marPatBySec = new Map<string, number[]>();
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
        else if (s.v === 2) (pizz = true), (shaker = j < 8 ? 1 : 2), (padVel = 0.22), (mar = 1); // room for the piano
        else (pizz = true), (shaker = s.v === 3 ? 3 : 2), (padVel = s.v === 3 ? 0.36 : 0.3);
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

      // --- strings bed (voiced after this loop)
      bedVel[bi] = padVel;
      bedAtt[bi] = padAtt;

      // --- marimba ostinato
      if (mar) {
        // one pattern per section and density
        const pk = `${s.start}:${mar}`;
        let pat = marPatBySec.get(pk);
        if (!pat) marPatBySec.set(pk, (pat = mar === 2 ? rng.pick(MAR_FULL) : rng.pick(MAR_SPARSE)));
        const run = last && nextSec(s) && !p.ev.some((e) => e.k === 'harp') && mar === 2;
        const bases = p.slots.map((sl) => {
          const want = pcsOf(sl.c).has(sl.c.bass) ? sl.c.bass : sl.c.root;
          let best = marBase, bd = Infinity;
          for (let m = 52; m <= 64; m++) if (pc(m) === want && Math.abs(m - marBase) < bd) (bd = Math.abs(m - marBase)), (best = m);
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
      // --- vibes: soft dyads on the dotted quarters in the first meadow (the top of the bed, under the reed)
      if (vibesOn(s)) {
        for (const e of [0, 3]) {
          const sl = slotAt(x0 + e);
          const up = sl.v.map((m) => (m < meadowC - 12 ? m + 12 : m)).sort((a, b) => a - b);
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
        p.pads.push({ pos: 0, sec: spanSec(x0, x0 + 10), notes: voice4(plan[bi - 1].slots.at(-1)!.v, c, 50, 79, leadIn(mel, x0, x0 + 10)), vel: 0.36, att: 0.9, rel: 3.2, cut: 2600 });
        add('upright', x0, 9, p.slots[0].bass - (p.slots[0].bass >= 43 ? 12 : 0), 0.6);
        harpRoll(x0, tonicM - 24, 8, 0.22, 0.32, 10);
        const top = chordTones(c, tonicM + 2, tonicM + 16).slice(-2);
        top.forEach((m, i) => add('vibes', x0 + 1.5 + i * 0.06, 9, m, 0.24));
        add('triangle', x0, 0, 0, 0.26);
      }
      if (kind === 'coda' && j === 6) add('glass', x0 + 1, 4, safeTone(p.slots[0].c, SC[i0 + 7] <= 96 ? SC[i0 + 7] : SC[i0]), 0.2);
    });

    // ---------------------------------------------------------------- strings bed: voice-led, common tones held
    // Each of the four voices is its own bowed note: a voice that keeps its pitch across a chord change keeps sounding,
    // a voice that moves overlaps its successor only briefly (so no old note sits under a new downbeat) and enters with a
    // short attack. Only entries after a rest get the long swell (capped at 60% of the chord), and a section that changes
    // the bed's level re-bows. So the bed breathes with the harmony instead of dipping after every barline.
    {
      interface Open { ev: PadEv; m: number; start: number }
      const open: (Open | null)[] = [null, null, null, null];
      const voices: PadEv[][] = plan.map(() => []);
      const close = (i: number, at: number, ov: number, rel: number): void => {
        const o = open[i];
        if (!o) return;
        o.ev.sec = spanSec(o.start, at + ov);
        o.ev.rel = rel;
        open[i] = null;
      };
      plan.forEach((p, bi) => {
        const vel = bedVel[bi];
        const cut = p.sec.kind === 'B' ? 8600 : 8000;
        const subs = p.slots.flatMap((sl) =>
          sl.v2 && sl.split ? [{ pos: sl.pos, dur: sl.split, v: sl.v }, { pos: sl.pos + sl.split, dur: sl.dur - sl.split, v: sl.v2 }] : [{ pos: sl.pos, dur: sl.dur, v: sl.v }],
        );
        for (const sl of subs) {
          const a0 = bi * 6 + sl.pos;
          // a new section re-bows only when the bed changes its level
          const fresh = p.inSec === 0 && sl.pos === 0 && bi > 0 && Math.abs(vel - bedVel[bi - 1]) > 0.03;
          for (let i = 0; i < 4; i++) {
            const o = open[i];
            if (vel <= 0) {
              close(i, a0, BED_OV, BED_REL_REST);
              continue;
            }
            if (o && o.m === sl.v[i] && !fresh) continue; // common tone: keep bowing
            close(i, a0, BED_OV, BED_REL_MOVE);
            const slotSec = spanSec(a0, a0 + sl.dur);
            // a moving voice changes bow quickly (the old note fades fast too, so the level stays even); entries swell
            const att = o ? Math.min(0.18, 0.2 * slotSec) : Math.min(bedAtt[bi], 0.6 * slotSec);
            const ev: PadEv = { pos: sl.pos, sec: 0, notes: [sl.v[i]], vel, att, rel: BED_REL_REST, cut };
            voices[bi].push(ev);
            open[i] = { ev, m: sl.v[i], start: a0 };
          }
        }
      });
      for (let i = 0; i < 4; i++) close(i, total * 6, 0, BED_REL_REST);
      // voices that start and stop together share one call (fewer nodes); velocity and brightness are rescaled so each
      // note sounds as it would inside a 4-note chord at the chord velocity
      plan.forEach((p, bi) => {
        const groups = new Map<string, PadEv[]>();
        for (const ev of voices[bi]) {
          const k = `${ev.pos}|${ev.sec.toFixed(3)}|${ev.att}|${ev.rel}`;
          groups.set(k, [...(groups.get(k) ?? []), ev]);
        }
        for (const g of groups.values()) {
          const ev = g[0], v = ev.vel * groupVel(g.length);
          p.pads.push({ ...ev, notes: g.map((x) => x.notes[0]).sort((a, b) => a - b), vel: v, cut: (ev.cut * (0.35 + 0.65 * ev.vel)) / (0.35 + 0.65 * v) });
        }
      });
    }

    // ---------------------------------------------------------------- mallets and harp vs chord changes and tunes
    /** absolute eighth of the next chord change after `at` */
    const changeAfter = (at: number): number => {
      const c0 = chordAt(at).name;
      const bar = Math.floor(at / 6);
      for (let b = bar; b < Math.min(total, bar + 3); b++)
        for (const sl of plan[b].slots) {
          const x = b * 6 + sl.pos;
          if (x > at + 1e-6 && sl.c.name !== c0) return x;
        }
      return Infinity;
    };
    /** m2 / m9 either way, or a major seventh (or 14th) above the melody note */
    const rubs = (x: number, m: number): boolean => {
      const d = m - x;
      return d === 1 || d === -1 || d === 13 || d === -13 || d === -11 || d === -23;
    };
    plan.forEach((p, bi) => {
      for (const e of p.ev) {
        const a0 = bi * 6 + e.pos;
        // mallets and harp are damped at a chord change unless the note belongs to the new chord
        if (e.k === 'harp' || e.k === 'marimba' || e.k === 'vibes') {
          const x = changeAfter(a0);
          const gap = e.k === 'harp' ? 0.3 : 0.15;
          if (a0 + e.dur > x - gap && !pcsOf(chordAt(x)).has(pc(e.m))) e.dur = Math.max(0.35, x - gap - a0);
        }
        if (e.k !== 'harp' && e.k !== 'marimba' && e.k !== 'vibes' && e.k !== 'pizz' && e.k !== 'glass' && e.k !== 'upright') continue;
        const ring = e.k === 'harp' ? e.dur + 0.8 : e.k === 'pizz' ? 1.2 : e.k === 'glass' ? Math.max(e.dur, 6) : e.dur;
        const near = melIn(mel, a0 - 0.05, a0 + ring - 0.2);
        if (!near.length) continue;
        if (e.k === 'upright') {
          // a bass passing note a semitone (any octave) from a held tune note falls back to the chord's bass
          const sl = slotAt(a0);
          if (Math.abs(bi * 6 + sl.pos - a0) > 1e-6 && near.some((L) => L.tune && (pc(L.m - e.m) === 1 || pc(e.m - L.m) === 1))) e.m = sl.bass;
          continue;
        }
        if (!near.some((L) => rubs(e.m, L.m))) continue;
        const alt = chordTones(chordAt(a0), e.m - 5, e.m + 5)
          .sort((a, b) => Math.abs(a - e.m) - Math.abs(b - e.m))
          .find((m) => !near.some((L) => rubs(m, L.m)));
        if (alt === undefined) e.vel = -1;
        else e.m = alt;
      }
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

    const setup = (): void => {
      inst.mix('flute', { level: 0.85, pan: 0.1, reverb: 0.32, delay: 0.09 });
      inst.mix('pad:reed', { level: 0.74, pan: -0.14, reverb: 0.3 });
      inst.mix('piano', { level: 1.1, pan: -0.12, reverb: 0.3 });
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
        for (const c of p.pads) inst.strings(humanize(rng, b.at(c.pos), 12), c.notes, c.sec, c.vel * d, { attack: c.att, release: c.rel, cutoff: c.cut });
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
            // the filter follows the pitch so the reed keeps its hollow odd harmonics in the upper register
            case 'reed': inst.pad(t, e.m, du * 0.95, v, { ch: 'reed', attack: 0.07, release: 0.28, cutoff: Math.max(1500, mtof(e.m) * 3.4), wave: 'square', detune: 1 }); break;
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
