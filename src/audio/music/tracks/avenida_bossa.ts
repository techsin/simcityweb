/**
 * "Avenida" - sunny daytime bossa nova (Metropolis soundtrack).
 *
 * Nylon guitar batida (thumb on 1 & 3 when there is no bass, syncopated finger pinches on the bossa clave with
 * anticipated chord changes, 3-note colour voicings with smooth voice leading and inner-voice motion on held chords),
 * breathy flute theme, upright bass on roots / fifths with surdo pickups and tied anticipations, shaker 8ths,
 * cross-stick clave, feathered kick, hi-hat foot, congas, a soft string bed in the bridge / interlude / out chorus,
 * vibes answers and a nylon guitar solo over the A changes.
 *
 * Form (one of two per seed, 120 bars, ~3:50):
 *   intro 8 | theme A 16 | theme A2 16 | bridge 16 | theme A3 16 | guitar solo 16 | interlude 8 | theme out 16 | tag 8
 *   intro 8 | theme A 16 | bridge 16 | theme A2 16 | guitar solo 16 | interlude 8 | bridge 2 16 | theme out 16 | tag 8
 * The theme is composed once per play: a 2-bar motif (rhythm cell + contour) stated, sequenced and restated, a
 * response ending on the half cadence, a chromatic guide-tone line over IV - iv - iii - biii°, then the motif head
 * and a stepwise approach that resolves on the tonic. Later choruses re-realize it over re-harmonized changes
 * (tritone subs) with anticipations, scoops, vibes answers and harmony. The tag repeats the cadence twice (deceptive,
 * then final) under a ritardando into a rolled maj9 chord.
 * Every play re-rolls key, tempo, lilt, form, A / B / intro charts, subs, the whole theme, comping patterns, bass
 * figures, breaks and fills, the solo and the answers. All of it is planned in create(); bar() only schedules.
 */
import type { RNG } from '../../../core/rng';
import type { MusicTrack } from '../types';
import { song, type BarInfo } from '../song';
import { parseChart, voiceLead, voicing, chordTones, scaleFor, humanize, humVel, snap, stepInPool, pc, type Chord } from '../theory';

type Kind = 'intro' | 'A' | 'B' | 'solo' | 'inter' | 'coda';
interface Sec {
  name: string;
  bars: number;
  kind: Kind;
  /** statement variant: A 0 = first, 1 = varied (A2), 2 = restated (A3), 3 = out chorus; B 0 / 1 */
  v: number;
  start: number;
  next: Sec | null;
}
/** [beat relative to the phrase start (may be negative = pickup), duration] */
type Cell = readonly (readonly [number, number])[];
interface Note {
  pos: number; // absolute beat position from song start
  dur: number;
  midi: number;
  vel: number;
  glide?: number;
}
interface Hit {
  pos: number;
  dur: number;
  notes: number[];
  vel: number;
  spread: number;
}
interface PadEv {
  pos: number;
  dur: number;
  notes: number[];
  vel: number;
}
type PercKind = 'shaker' | 'rim' | 'kick' | 'hat' | 'ride' | 'congaHi' | 'congaLo' | 'congaMute' | 'tomH' | 'tomM' | 'tomL' | 'swell';
interface Perc {
  pos: number;
  k: PercKind;
  vel: number;
}

const FORMS: readonly (readonly [string, number, Kind, number])[][] = [
  [['intro', 8, 'intro', 0], ['theme A', 16, 'A', 0], ['theme A2', 16, 'A', 1], ['bridge', 16, 'B', 0], ['theme A3', 16, 'A', 2], ['guitar solo', 16, 'solo', 0], ['interlude', 8, 'inter', 0], ['theme out', 16, 'A', 3], ['tag + ending', 8, 'coda', 0]],
  [['intro', 8, 'intro', 0], ['theme A', 16, 'A', 0], ['bridge', 16, 'B', 0], ['theme A2', 16, 'A', 1], ['guitar solo', 16, 'solo', 0], ['interlude', 8, 'inter', 0], ['bridge 2', 16, 'B', 1], ['theme out', 16, 'A', 3], ['tag + ending', 8, 'coda', 0]],
];

// ------------------------------------------------------------------ charts (written in F, transposed per play)
/** 16-bar A sections: I - ii - V - iii - VI - ii - V | IV - iv - iii - biii° - ii - V - I (+ turnaround in bar 16) */
const A_CHARTS = [
  'Fmaj9 | % | Gm9 | C13 | Am7 | D7b9 | Gm9 | C13 | Bbmaj9 | Bbm6 | Am7 | Abdim7 | Gm9 | C13 | Fmaj9 | Gm7 C9',
  'F69 | % | G13 | % | Gm9 | Gb7s11 | Fmaj9 | D7b9 | Gm9 | Bbm6 | Am7 | Ab7s11 | Gm9 | C13 | F69 | Gm7 C9',
  'Fmaj9 | % | Cm9 | F13 | Bbmaj9 | Bbm6 | Am7 | D7b9 | Gm9 | % | Bbm6 | Eb9 | Am7 D7b9 | Gm9 C13 | Fmaj9 | Gm7 C9',
];
/** bridges + the lead-in bar that replaces the last bar of the section before them */
const B_CHARTS = [
  { chart: 'Bbmaj9 | % | Bbm9 | Eb13 | Am9 | D7b9 | Gm9 | % | Dm9 | G13 | Gm9 | C7b9 | Am7 | D7b9 | Gm9 | C13', lead: 'Cm9 F13' },
  { chart: 'Dbmaj9 | % | Cm9 | F13 | Bbmaj9 | Bbm6 | Am7 | D7b9 | Gm9 | % | Ebmaj9 | Ab13 | Gm9 | C13 | Am7 Ab7s11 | Gm9 C13', lead: 'Ebm9 Ab13' },
];
const INTRO_CHARTS = ['Gm9 | C13 | Gm9 | C13 | Gm9 | C13 | Gm9 | Gm7 C7b9', 'Bbmaj9 | Am7 | Gm9 | C13 | Bbmaj9 | Am7 | Gm9 | Gm7 C7b9'];
const INTER_CHART = 'Bbmaj9 | Bbm6 | Am7 | Abdim7 | Gm9 | % | Gm9 | C13';
const CODA_CHART = 'Gm9 | C13 | Am7 D7b9 | Gm9 C13 | Am7 D7b9 | Gm9 Gb7s11 | X | X';

// ------------------------------------------------------------------ rhythm vocabulary
/** motif cells (2 bars) - every one leaves a breath at the end of the phrase */
const M_CELLS: Cell[] = [
  [[0, 1], [1, 0.5], [1.5, 1], [2.5, 1], [3.5, 2.5]],
  [[0.5, 0.5], [1, 1], [2, 0.5], [2.5, 1.5], [4, 0.5], [4.5, 2]],
  [[-0.5, 1], [0.5, 0.5], [1, 1], [2, 1.5], [3.5, 3]],
  [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 1.5], [3, 0.5], [3.5, 3]],
  [[0, 1.5], [1.5, 1], [2.5, 1], [3.5, 0.5], [4, 2.5]],
];
/** responses (half cadence, long last note) */
const R_CELLS: Cell[] = [
  [[0, 0.5], [0.5, 1], [1.5, 1], [2.5, 1.5], [4, 3]],
  [[0.5, 1], [1.5, 0.5], [2, 1.5], [3.5, 3.5]],
  [[0, 1], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1], [4, 2.5]],
];
/** contrast (long guide tones) */
const N_CELLS: Cell[] = [
  [[0, 2.5], [2.5, 1.5], [4, 3]],
  [[-0.5, 3], [2.5, 1.5], [4, 3.5]],
  [[0, 1.5], [1.5, 2.5], [4, 1.5], [5.5, 2]],
  [[0, 3], [3, 1], [4, 3]],
];
/** cadence approach in the 2nd bar of the ii-V + landing on the tonic (beat 7.5 = anticipated, 8 = on the downbeat) */
const E_CELLS: Cell[] = [
  [[4.5, 0.5], [5, 0.5], [5.5, 1], [6.5, 1], [7.5, 5]],
  [[4, 1], [5, 1], [6, 1.5], [8, 5]],
  [[5, 0.5], [5.5, 0.5], [6, 0.5], [6.5, 1], [8, 4.5]],
  [[4.5, 1], [5.5, 1], [6.5, 1], [7.5, 5]],
];
/** bridge phrases: rising lines */
const Q_CELLS: Cell[] = [
  [[0, 1], [1, 1], [2, 1], [3, 1], [4, 3]],
  [[0.5, 1], [1.5, 1], [2.5, 1], [3.5, 3]],
  [[0, 1.5], [1.5, 1], [2.5, 1.5], [4, 3]],
];
/** guitar finger patterns over 2 bars of 8ths (thumb / bass carry 1 and 3) */
const PATS = {
  clave: [0, 3, 6, 10, 13],
  ant: [0, 3, 6, 10, 13, 15],
  busy: [0, 2, 3, 6, 9, 10, 13, 15],
  long: [0, 8],
} as const;
type Pat = keyof typeof PATS;
const CLAVE = [0, 3, 6, 10, 13];
const SHAKER = [0.44, 0.28, 0.36, 0.43];
/** guide tones (intervals mod 12 above the root) for the contrast lines: b3 3 b7 7 9 6 */
const GUIDE = [3, 4, 10, 11, 2, 9];

// ------------------------------------------------------------------ helpers
/** 3 upper guitar voices (intervals above the root) per chord quality; alt = the colour for the 2nd bar of a held chord */
function gtrIv(c: Chord, alt: boolean): number[] {
  switch (c.quality) {
    case 'maj7': case 'maj9': case 'maj13': case 'maj': case 'add9': return alt ? [4, 9, 14] : [4, 11, 14];
    case 'maj7s11': return [4, 11, 18];
    case '6': case '69': return alt ? [4, 11, 14] : [4, 9, 14];
    case 'm7': case 'm9': case 'm11': case 'min': case 'madd9': return alt ? [3, 9, 14] : [3, 10, 14];
    case 'm6': case 'm69': return [3, 7, 9];
    case 'mMaj7': return [3, 11, 14];
    case '13': return alt ? [4, 10, 20] : [4, 10, 21];
    case '9': case '7': return alt ? [4, 10, 21] : [4, 10, 14];
    case '7b9': return [4, 10, 13];
    case '7s11': return [4, 10, 18];
    case '7alt': case '7s9': case '7b13': return [4, 10, 15];
    case '7sus4': case '9sus4': case '13sus4': return [5, 10, 14];
    case 'dim7': case 'dim': return [3, 6, 9];
    case 'm7b5': return [3, 6, 10];
    default: return [4, 7, 10];
  }
}

function nearestPc(p: number, near: number, lo: number, hi: number): number {
  let best = lo, bd = Infinity;
  for (let m = lo; m <= hi; m++) if (pc(m) === pc(p) && Math.abs(m - near) < bd) (bd = Math.abs(m - near)), (best = m);
  return best;
}

/** the motif's contour (pool steps): a handful of memorable shapes, lightly perturbed */
function motifContour(rng: RNG, n: number): number[] {
  const shape = rng.int(0, 3);
  const out = [0];
  for (let i = 1; i < n; i++) {
    let s: number;
    if (shape === 0) s = i === 1 ? rng.pick([2, 3]) : -1; // leap up, stepwise fall
    else if (shape === 1) s = i < Math.min(3, n - 1) ? 0 : i === n - 1 ? rng.pick([-1, -2]) : 1; // repeated note, then a turn
    else if (shape === 2) s = i <= Math.ceil((n - 1) / 2) ? 1 : i === n - 1 && rng.chance(0.4) ? -2 : -1; // arch
    else s = i === n - 2 ? rng.pick([2, 3]) : -1; // fall, then leap back
    out.push(s);
  }
  if (n > 3 && shape !== 1 && rng.chance(0.35)) {
    // one interior interval widened / narrowed (never turned into a repeat)
    const k = rng.int(2, n - 2);
    const w = out[k] + (rng.chance(0.5) ? 1 : -1);
    out[k] = w === 0 ? Math.sign(out[k]) * 2 : w;
  }
  return out;
}

function lineContour(rng: RNG, n: number, dir: 1 | -1): number[] {
  const out = [0];
  const turn = rng.int(1, Math.max(1, n - 2));
  for (let i = 1; i < n; i++) out.push(i === turn && rng.chance(0.6) ? -dir * rng.pick([1, 2]) : dir * (rng.chance(0.8) ? 1 : 2));
  return out;
}

// ------------------------------------------------------------------ the track
export const track: MusicTrack = {
  id: 'avenida_bossa',
  title: 'Avenida',
  mood: 'Sunny bossa nova: nylon guitar, flute, upright, shaker',
  tags: ['day', 'calm', 'region'],
  bpm: 128,
  gain: 1.5,
  create(env) {
    const { inst, rng } = env;
    const bpm = rng.int(124, 132);
    inst.bpm = bpm;
    const swing = rng.range(0.505, 0.53); // a hint of lilt on the 8ths
    const key = rng.pick([5, 7, 2, 0, 10, 3, 8]); // F G D C Bb Eb Ab
    const T = ((key - 5 + 18) % 12) - 6;

    // ---------------------------------------------------------------- form
    const secs: Sec[] = [];
    {
      let s0 = 0;
      for (const [name, bars, kind, v] of rng.pick(FORMS)) secs.push({ name, bars, kind, v, start: s0, next: null }), (s0 += bars);
      secs.forEach((s, i) => (s.next = secs[i + 1] ?? null));
    }
    const total = secs.reduce((a, s) => a + s.bars, 0);
    const secOf: Sec[] = [];
    for (const s of secs) for (let i = 0; i < s.bars; i++) secOf.push(s);

    // ---------------------------------------------------------------- harmony
    const aChart = rng.pick(A_CHARTS).split('|').map((x) => x.trim());
    const bSpec = rng.pick(B_CHARTS);
    const bChart = bSpec.chart.split('|').map((x) => x.trim());
    const introChart = rng.pick(INTRO_CHARTS).split('|').map((x) => x.trim());
    const finalChord = rng.pick(['Fmaj9', 'F69', 'Fmaj9', 'Fmaj7s11']);
    /** later choruses: tritone subs for the dominants (never in the cadence bars) */
    const subA = (p: number): string[] =>
      aChart.map((bar, i) => (i >= 13 ? bar : bar.split(/\s+/).map((c) => (c === 'C13' && rng.chance(p) ? 'Gb7s11' : c === 'D7b9' && rng.chance(p) ? 'Ab7s11' : c)).join(' ')));
    const sectionBars = (s: Sec): string[] => {
      let bars: string[];
      switch (s.kind) {
        case 'intro': bars = [...introChart]; break;
        case 'A': bars = subA([0, 0.2, 0.3, 0.35][s.v] ?? 0.3); break;
        case 'solo': bars = subA(0.5); break;
        case 'B': bars = [...bChart]; break;
        case 'inter': bars = INTER_CHART.split('|').map((x) => x.trim()); break;
        default: bars = CODA_CHART.split('|').map((x) => (x.trim() === 'X' ? finalChord : x.trim()));
      }
      while (bars.length < s.bars) bars.push(bars[bars.length - 1]);
      bars = bars.slice(0, s.bars);
      for (let i = 1; i < bars.length; i++) if (bars[i] === '%') bars[i] = bars[i - 1];
      const nx = s.next?.kind;
      if (s.kind === 'A' || s.kind === 'solo' || s.kind === 'inter') {
        if (nx === 'B') bars[s.bars - 1] = bSpec.lead;
        else if (nx === 'inter') bars[s.bars - 1] = 'Cm9 F13';
        else if (nx === 'coda') bars[s.bars - 1] = 'Am7 D7b9';
      }
      return bars;
    };
    const slots: { beat: number; chord: Chord }[][] = [];
    for (const s of secs)
      for (const bs of sectionBars(s)) {
        const cs = parseChart(bs, T)[0];
        slots.push(cs.map((c, k) => ({ beat: (k * 4) / cs.length, chord: c })));
      }
    const chordAt = (pos: number): Chord => {
      const bi = Math.max(0, Math.min(total - 1, Math.floor(pos / 4 + 1e-9)));
      const beat = pos - bi * 4;
      let c = slots[bi][0].chord;
      for (const sl of slots[bi]) if (beat >= sl.beat - 1e-6) c = sl.chord;
      return c;
    };
    /** harmony a melody note belongs to: an off-beat 8th right before a chord change anticipates the new chord */
    const harmAt = (pos: number): Chord => {
      const c = chordAt(pos);
      if (Math.abs(pos - Math.floor(pos) - 0.5) < 1e-6) {
        const n = chordAt(pos + 0.5);
        if (n.name !== c.name) return n;
      }
      return c;
    };
    const isChange = (pos: number): boolean => {
      const bi = Math.floor(pos / 4 + 1e-9);
      if (bi < 0 || bi >= total) return false;
      const beat = pos - bi * 4;
      return slots[bi].some((s) => Math.abs(s.beat - beat) < 1e-6) && chordAt(pos - 0.5).name !== chordAt(pos).name;
    };

    // ---------------------------------------------------------------- arrangement helpers
    interface Lay { thumb: boolean; bass: boolean; shaker: number; rim: number; kick: boolean; hat: boolean; ride: boolean; conga: boolean; strings: boolean; gtr: number }
    const lay = (bi: number): Lay => {
      const s = secOf[bi], x = bi - s.start;
      const L: Lay = { thumb: false, bass: true, shaker: 1, rim: 1, kick: false, hat: false, ride: false, conga: false, strings: false, gtr: 1 };
      switch (s.kind) {
        case 'intro':
          if (x < 4) Object.assign(L, { thumb: true, bass: false, shaker: 0, rim: 0 });
          else Object.assign(L, { shaker: x < 6 ? 0.75 : 0.95, rim: x < 6 ? 0 : 0.85 });
          break;
        case 'A':
          L.kick = s.v >= 1;
          L.hat = s.v >= 2;
          L.conga = s.v === 3 || (s.v === 2 && x >= 8);
          L.strings = s.v === 3 && x >= 8;
          L.ride = s.v === 3 && x >= 8;
          break;
        case 'B':
          Object.assign(L, { kick: true, hat: true, ride: true, shaker: 0.8, strings: true, conga: s.v === 1 || x >= 8 });
          break;
        case 'solo':
          Object.assign(L, { shaker: x < 4 ? 0 : 1, kick: x >= 8, hat: x >= 8, conga: x >= 12, strings: x >= 8, gtr: 0.85 });
          break;
        case 'inter':
          Object.assign(L, { shaker: x < 4 ? 0 : 0.9, rim: x < 2 ? 0 : 0.8, kick: x >= 6, strings: true, gtr: x < 4 ? 0.9 : 1 });
          break;
        default: // coda
          Object.assign(L, { kick: x < 4, hat: x < 4, shaker: x < 6 ? 1 - x * 0.09 : 0, rim: x < 6 ? 0.9 : 0, strings: x >= 2 });
      }
      return L;
    };
    /** section dynamics (velocity factor) - the arrangement breathes: soft intro, A2 / bridge lift, solo builds, breakdown, out chorus peak */
    const dynAt = (bi: number): number => {
      const s = secOf[bi], x = (bi - s.start) / s.bars;
      switch (s.kind) {
        case 'intro': return 0.84 + 0.1 * x;
        case 'A': return [0.9, 0.95, 0.99, 1.04][s.v] ?? 1;
        case 'B': return 0.95 + 0.06 * Math.sin(Math.PI * x);
        case 'solo': return 0.88 + 0.12 * x;
        case 'inter': return 0.82 + 0.14 * x;
        default: return 1.02 - 0.16 * x;
      }
    };
    const bucket = <T,>(): T[][] => Array.from({ length: total + 1 }, () => [] as T[]);
    const G = bucket<Hit>(), TH = bucket<Note>(), BS = bucket<Note>(), FL: Note[] = [], VB = bucket<Note>(), LD = bucket<Note>(), ST = bucket<PadEv>(), PC = bucket<Perc>();
    const put = <T extends { pos: number }>(arr: T[][], e: T): void => {
      const bi = Math.floor(e.pos / 4 + 1e-9);
      if (bi >= 0 && bi < total) arr[bi].push(e);
    };

    // breaks (stop-time on beats 3-4 before a theme returns) and section-end fills
    const brk = new Set<number>();
    const fill: (string | null)[] = new Array(total).fill(null);
    for (const s of secs) {
      const last = s.start + s.bars - 1;
      if (!s.next || s.kind === 'coda') continue;
      if ((s.next.name === 'theme A3' || s.next.name === 'theme out') && brk.size < 2 && rng.chance(0.6)) brk.add(last);
      else fill[last] = s.kind === 'intro' ? 'swell' : s.next.kind === 'inter' ? 'swell' : rng.weighted(['toms', 'rim', 'conga', 'swell'], [3, 3, 2, 2]);
      if (s.bars === 16 && rng.chance(0.45)) fill[s.start + 7] = rng.pick(['lite', 'conga']);
    }

    // ---------------------------------------------------------------- guitar voicings (voice-led chain over every chord slot)
    const vmap = new Map<Chord, number[]>();
    {
      let prevV: number[] | null = null;
      let prevName = '';
      for (let bi = 0; bi < total; bi++)
        for (const sl of slots[bi]) {
          const alt = sl.chord.name === prevName && slots[bi].length === 1;
          const syn: Chord = { ...sl.chord, tones: gtrIv(sl.chord, alt) };
          prevV = voiceLead(prevV, syn, { lo: 53, hi: 71, count: 3, rootless: false });
          vmap.set(sl.chord, prevV);
          prevName = alt ? '' : sl.chord.name; // a third bar of the same chord returns to the main colour
        }
    }

    // ---------------------------------------------------------------- guitar comping
    const patFor = (s: Sec, x: number): Pat => {
      switch (s.kind) {
        case 'intro': return 'clave';
        case 'A': return s.v === 0 ? rng.weighted<Pat>(['clave', 'ant'], [0.75, 0.25]) : s.v === 1 ? rng.weighted<Pat>(['clave', 'ant'], [0.5, 0.5]) : rng.weighted<Pat>(['clave', 'ant', 'busy'], [0.3, 0.4, 0.3]);
        case 'B': return rng.weighted<Pat>(['clave', 'ant', 'busy'], [0.3, 0.45, 0.25]);
        case 'solo': return 'clave';
        case 'inter': return x < 4 ? 'long' : 'clave';
        default: return x < 4 ? 'ant' : 'clave';
      }
    };
    {
      let tiedIn = false; // previous group ended on an &4 anticipation that already sounds this downbeat
      let prevThumb = 45;
      for (let g = 0; g * 2 < total - 2; g++) {
        const b0 = g * 2;
        const s = secOf[b0];
        const pat = PATS[patFor(s, b0 - s.start)];
        const hits = pat.filter((st) => !(st === 0 && tiedIn));
        tiedIn = pat[pat.length - 1] === 15 && !brk.has(b0 + 1) && b0 + 2 < total - 2;
        hits.forEach((st, k) => {
          const bi = b0 + Math.floor(st / 8);
          if (bi >= total - 2) return;
          const beat = (st % 8) / 2;
          if (brk.has(bi) && beat >= 2) return;
          const pos = bi * 4 + beat;
          let c = chordAt(pos);
          if (st % 2 === 1 && chordAt(pos + 0.5).name !== c.name) c = chordAt(pos + 0.5); // anticipation
          const nextSt = k + 1 < hits.length ? hits[k + 1] : 16;
          const gap = (nextSt - st) / 2;
          const L = lay(bi);
          const dur = pat === PATS.long ? 3.6 : Math.min(1.6, gap * 0.86);
          const base = st === 0 ? 0.54 : st === 8 ? 0.5 : st % 2 ? 0.51 : 0.46;
          put(G, { pos, dur, notes: vmap.get(c) ?? [], vel: humVel(rng, base * L.gtr * dynAt(bi), 0.04), spread: pos === 0 ? 0.04 : rng.range(0.006, 0.011) });
        });
        // break bars: a unison stab on the &2
        for (const bi of [b0, b0 + 1]) if (brk.has(bi)) put(G, { pos: bi * 4 + 1.5, dur: 0.35, notes: vmap.get(chordAt(bi * 4 + 1.5)) ?? [], vel: 0.52, spread: 0.006 });
        // thumb (only while there is no bass player): root on 1, fifth on 3
        for (const bi of [b0, b0 + 1]) {
          if (bi >= total - 2 || !lay(bi).thumb) continue;
          for (const beat of [0, 2]) {
            const c = chordAt(bi * 4 + beat);
            const r = nearestPc(c.bass, prevThumb, 40, 52);
            const m = beat === 0 || slots[bi].length > 1 ? r : c.tones.includes(7) ? (r + 7 > 52 ? r - 5 : r + 7) : r;
            if (beat === 0 || slots[bi].length > 1) prevThumb = r;
            TH[bi].push({ pos: bi * 4 + beat, dur: 1.8, midi: m, vel: humVel(rng, 0.55 * dynAt(bi), 0.03) });
          }
        }
      }
    }

    // ---------------------------------------------------------------- upright bass
    {
      let prevB = 38;
      let tied = false;
      const root = (c: Chord, near: number) => nearestPc(c.bass, near, 31, 45);
      const fifth = (c: Chord, r: number) => {
        const iv = c.tones.includes(7) ? 7 : c.tones.includes(6) ? 6 : c.tones.includes(8) ? 8 : 0;
        if (!iv) return r;
        return r - (12 - iv) >= 28 ? r - (12 - iv) : r + iv;
      };
      type BStyle = 'half' | 'surdo' | 'antic' | 'whole';
      const style = (s: Sec, x: number): BStyle => {
        switch (s.kind) {
          case 'intro': return 'half';
          case 'A': return s.v === 0 ? rng.weighted<BStyle>(['half', 'surdo'], [0.55, 0.45]) : rng.weighted<BStyle>(['half', 'surdo', 'antic'], [0.2, 0.5, 0.3]);
          case 'B': return rng.weighted<BStyle>(['surdo', 'antic', 'half'], [0.45, 0.35, 0.2]);
          case 'solo': return x < 4 ? 'half' : rng.weighted<BStyle>(['surdo', 'antic'], [0.6, 0.4]);
          case 'inter': return x < 4 ? 'whole' : 'half';
          default: return x < 4 ? 'surdo' : 'half';
        }
      };
      for (let bi = 0; bi < total - 2; bi++) {
        const L = lay(bi);
        if (!L.bass) {
          tied = false;
          continue;
        }
        const s = secOf[bi], x = bi - s.start, P = bi * 4, sl = slots[bi];
        const st = brk.has(bi) ? 'half' : style(s, x);
        const dv = Math.sqrt(dynAt(bi));
        const v = (a: number) => humVel(rng, a * dv, 0.05);
        const nextC = bi + 1 < total - 1 ? slots[bi + 1][0].chord : null;
        const r1 = root(sl[0].chord, prevB);
        const m2 = sl.length > 1 ? root(sl[1].chord, r1) : fifth(sl[0].chord, r1);
        if (brk.has(bi)) {
          if (!tied) put(BS, { pos: P, dur: 1.3, midi: r1, vel: v(0.72) });
          put(BS, { pos: P + 1.5, dur: 0.35, midi: r1, vel: v(0.7) });
          tied = false;
          prevB = r1;
          continue;
        }
        if (!tied) put(BS, { pos: P, dur: st === 'whole' ? 3.8 : st === 'half' ? 1.85 : 1.4, midi: r1, vel: v(0.72) });
        tied = false;
        if (st === 'whole') {
          prevB = r1;
          continue;
        }
        if (st !== 'half' && (sl.length > 1 || rng.chance(0.7))) put(BS, { pos: P + 1.5, dur: 0.4, midi: m2, vel: v(0.48) });
        put(BS, { pos: P + 2, dur: st === 'half' ? 1.85 : 1.4, midi: m2, vel: v(0.66) });
        prevB = sl.length > 1 ? m2 : r1;
        if (nextC && (st === 'surdo' || st === 'antic')) {
          const nr = root(nextC, prevB);
          if (st === 'antic' && nextC.name !== sl[sl.length - 1].chord.name && !brk.has(bi + 1)) {
            put(BS, { pos: P + 3.5, dur: 2.1, midi: nr, vel: v(0.68) });
            tied = true;
          } else if (rng.chance(0.75)) put(BS, { pos: P + 3.5, dur: 0.4, midi: nr, vel: v(0.46) });
          prevB = nr;
        }
      }
    }

    // ---------------------------------------------------------------- melody toolkit
    const LO = 65, HI = 86;
    const melVel = (beat: number, dur: number) => 0.56 + (dur >= 1.5 ? 0.04 : 0) + (beat % 1 ? 0.03 : 0);
    const fitNote = (m: number, c: Chord, strong: boolean, long: boolean): number => {
      const pool = scaleFor(c, LO, HI);
      const x = pool.includes(m) ? m : snap(m, pool);
      if (!strong && !long) return x;
      const rel = pc(x - c.root);
      const avoid = (c.tones.includes(4) && rel === 5) || rel === 1 || (c.tones.includes(3) && rel === 8);
      let tones = chordTones(c, LO, HI);
      if (long) {
        // resting notes: no b9 / #9 / b5 unless the chord is built on them
        const t2 = tones.filter((t) => ![1, 3, 6].includes(pc(t - c.root)) || c.quality === 'dim7' || c.quality === 'm7b5' || (c.tones.includes(3) && pc(t - c.root) === 3));
        if (t2.length) tones = t2;
      }
      const ct = snap(x, tones);
      return long || avoid || Math.abs(ct - x) <= 1 ? ct : x;
    };
    /** realize a rhythm cell + contour from a start pitch over the planned harmony */
    const place = (cell: Cell, cont: readonly number[], seg: number, start: number): Note[] => {
      let cur = start;
      return cell.map(([beat, dur], i) => {
        const pos = seg + beat;
        const c = harmAt(pos);
        const pool = scaleFor(c, LO, HI);
        const prev = cur, want = i === 0 ? 0 : cont[i] ?? 0;
        if (i === 0) {
          const ct = chordTones(c, LO, HI);
          cur = ct.includes(cur) ? cur : snap(cur, ct);
        } else cur = stepInPool(cur, want, pool);
        cur = fitNote(cur, c, (beat % 2 === 0 && beat >= 0) || dur >= 1.5, i === cell.length - 1 && dur >= 2);
        if (want !== 0 && cur === prev) {
          // snapping to a chord tone undid the step: take the next chord tone in the intended direction
          const ct = chordTones(c, LO, HI);
          const nx = want > 0 ? ct.find((m) => m > prev) : [...ct].reverse().find((m) => m < prev);
          if (nx !== undefined && Math.abs(nx - prev) <= 5) cur = nx;
        }
        return { pos, dur, midi: cur, vel: melVel(beat, dur) };
      });
    };
    const lastOf = (ns: Note[], dflt: number) => (ns.length ? ns[ns.length - 1].midi : dflt);
    /** contrast line: long guide tones moving by the smallest step (chromatic where the harmony allows) */
    const guide = (cell: Cell, seg: number, near: number, dir: 1 | -1): Note[] => {
      let cur = near;
      return cell.map(([beat, dur]) => {
        const pos = seg + beat;
        const c = harmAt(pos);
        const tones = chordTones(c, LO + 2, HI - 3);
        let g = tones.filter((m) => GUIDE.includes(pc(m - c.root)) || c.quality === 'dim7');
        if (!g.length) g = tones;
        let best = g[0], bs = Infinity;
        for (const m of g) {
          if (m === cur) continue;
          const d = m - cur;
          const sc = Math.abs(d) + (Math.sign(d) === dir ? 0 : 0.8) + (Math.abs(d) > 4 ? 3 : 0);
          if (sc < bs) (bs = sc), (best = m);
        }
        cur = best;
        return { pos, dur, midi: cur, vel: melVel(beat, dur) + 0.02 };
      });
    };

    // ---------------------------------------------------------------- the theme (composed once per play)
    const mCell = rng.pick(M_CELLS);
    const mCont = motifContour(rng, mCell.length);
    const mContAlt = mCont.map((s, i) => (i >= mCont.length - 2 ? -s || 1 : s)); // same head, answering tail
    const headCell: Cell = mCell.filter(([b]) => b < 3);
    const S0 = rng.int(72, 79);
    const seqShift = rng.pick([-1, -1, 1, 0, -2]);
    const rCell = rng.pick(R_CELLS), rCont = lineContour(rng, rCell.length, -1);
    const rCell2 = rng.pick(R_CELLS), rCont2 = lineContour(rng, rCell2.length, -1);
    const nCell = rng.pick(N_CELLS);
    const eCell = rng.pick(E_CELLS), eCell2 = rng.pick(E_CELLS);
    const eSteps = eCell.map(() => (rng.chance(0.8) ? 1 : 2)), eSteps2 = eCell2.map(() => (rng.chance(0.8) ? 1 : 2));
    const appDir = rng.chance(0.72) ? 1 : -1; // approach the landing from above (mostly) or below
    const landIv = rng.pick([[4], [2], [4, 7], [2, 4]]);
    const landIv2 = rng.pick([[7], [2], [4]]);
    /** motif head + stepwise approach + landing on a chosen colour of the arrival chord */
    const cadence = (seg: number, hs: number, cell: Cell, steps: number[], want: number[], final: boolean): Note[] => {
      const head = place(headCell, mCont, seg, hs);
      const [lb, ld] = cell[cell.length - 1];
      const lpos = seg + lb;
      const lc = harmAt(lpos);
      const all = chordTones(lc, LO + 3, HI - 4);
      const cands = all.filter((m) => want.includes(pc(m - lc.root)));
      const target = snap(final ? S0 + 2 : S0, cands.length ? cands : all);
      const app: Note[] = [];
      let cur = target;
      for (let k = cell.length - 2; k >= 0; k--) {
        const [b, d] = cell[k];
        cur = stepInPool(cur, appDir * steps[k], scaleFor(harmAt(seg + b), LO, HI));
        app.unshift({ pos: seg + b, dur: d, midi: cur, vel: melVel(b, d) });
      }
      return [...head, ...app, { pos: lpos, dur: final ? 7 : ld, midi: target, vel: melVel(lb, ld) + 0.02 }];
    };
    const realizeA = (s: Sec): Note[] => {
      const base = s.start * 4, v = s.v;
      const alt = v === 1 || v === 3;
      const a0 = place(mCell, mCont, base, S0);
      const a1 = place(mCell, alt ? mContAlt : mCont, base + 8, stepInPool(S0, seqShift, scaleFor(harmAt(base + 8), LO, HI)));
      const a2 = place(mCell, alt ? mContAlt : mCont, base + 16, v === 3 ? stepInPool(S0, 1, scaleFor(harmAt(base + 16), LO, HI)) : S0);
      const a3 = place(alt ? rCell2 : rCell, alt ? rCont2 : rCont, base + 24, lastOf(a2, S0));
      const a4 = guide(nCell, base + 32, lastOf(a3, S0) + (v === 3 ? 4 : 1), -1);
      const a5 = guide(nCell, base + 40, lastOf(a4, S0), -1);
      const toB = s.next?.kind === 'B';
      const a6 = cadence(base + 48, v === 3 ? S0 + 2 : S0, alt ? eCell2 : eCell, alt ? eSteps2 : eSteps, toB ? landIv2 : landIv, false);
      return [...a0, ...a1, ...a2, ...a3, ...a4, ...a5, ...a6];
    };
    // bridge material
    const qCell = rng.pick(Q_CELLS), qCont = lineContour(rng, qCell.length, 1);
    const q2Cell = rng.pick(Q_CELLS), q2Cont = lineContour(rng, q2Cell.length, 1);
    const bAns = rng.pick(R_CELLS), bAnsCont = lineContour(rng, bAns.length, -1);
    const QS = rng.int(70, 75);
    const realizeB = (s: Sec): Note[] => {
      const base = s.start * 4;
      const b0 = place(qCell, qCont, base, QS);
      const b1 = place(bAns, bAnsCont, base + 8, lastOf(b0, QS));
      const b2 = place(qCell, qCont, base + 16, Math.min(HI - 9, stepInPool(QS, 2, scaleFor(harmAt(base + 16), LO, HI))));
      const b3 = place(bAns, bAnsCont, base + 24, lastOf(b2, QS));
      const b4 = place(q2Cell, q2Cont, base + 32, Math.min(HI - 8, Math.max(QS + 3, lastOf(b3, QS) + 3) + (s.v ? 2 : 0))); // the bridge's high point
      const b5 = guide(nCell, base + 40, lastOf(b4, QS), -1);
      const b6 = place(headCell, mCont, base + 48, S0);
      const b7 = place([[0, 1], [1, 2]], [0, -1], base + 56, lastOf(b6, S0) - 2);
      return [...b0, ...b1, ...b2, ...b3, ...b4, ...b5, ...b6, ...b7];
    };
    /** later statements: anticipations, scoops into long notes */
    const ornament = (ns: Note[], p: number): Note[] => {
      for (let i = 1; i < ns.length; i++) {
        const n = ns[i], prev = ns[i - 1];
        if (n.pos % 1 === 0 && n.pos % 4 !== 0 && prev.pos < n.pos - 0.6 && rng.chance(p * 0.6)) (n.pos -= 0.5), (n.dur += 0.5);
        if (n.dur >= 1.5 && rng.chance(p)) n.glide = n.midi - (rng.chance(0.6) ? 1 : 2);
      }
      return ns;
    };

    // ---------------------------------------------------------------- lay out the melody, solos and answers
    const answers = (line: Note[], s: Sec, who: 'vib' | 'gtr', p: number): void => {
      const s0 = s.start * 4, s1 = (s.start + s.bars) * 4;
      const ls = line.filter((n) => n.pos >= s0 - 1 && n.pos < s1).sort((a, b) => a.pos - b.pos);
      for (let i = 0; i < ls.length; i++) {
        const n = ls[i];
        const gs = n.pos + n.dur, ge = i + 1 < ls.length ? ls[i + 1].pos : s1 - 1;
        if (ge - gs < 1.75 || !rng.chance(p) || gs >= s1 - 2) continue;
        const st = Math.ceil((gs + 0.25) * 2) / 2;
        const count = Math.max(2, Math.min(4, Math.floor((ge - 0.5 - st) / 0.5) + 1));
        const c = harmAt(st);
        const tones = who === 'vib' ? chordTones(c, 70, 86) : chordTones(c, 59, 76);
        let m = snap(who === 'vib' ? n.midi + rng.pick([-3, 0, 3]) : n.midi - rng.pick([5, 7, 9]), tones);
        const ix = tones.indexOf(m);
        // run away from the edges of the register so the answer always moves
        const dir = ix < count ? 1 : ix > tones.length - 1 - count ? -1 : rng.chance(0.6) ? -1 : 1;
        const dv = dynAt(Math.floor(st / 4));
        for (let q = 0; q < count; q++) {
          const e = { pos: st + q * 0.5, dur: q === count - 1 ? 1.2 : 0.55, midi: m, vel: humVel(rng, (who === 'vib' ? 0.4 : 0.46) * dv, 0.04) };
          put(who === 'vib' ? VB : LD, e);
          m = stepInPool(m, dir, tones);
        }
      }
    };
    for (const s of secs) {
      const base = s.start * 4;
      const dv = (n: Note) => ({ ...n, vel: humVel(rng, n.vel * dynAt(Math.min(total - 1, Math.floor(n.pos / 4))), 0.035) });
      if (s.kind === 'A') {
        const line = ornament(realizeA(s), [0, 0.28, 0.22, 0.32][s.v] ?? 0.25).map(dv);
        FL.push(...line);
        if (s.v === 3) for (const n of line) if (n.dur >= 1) put(VB, { pos: n.pos, dur: n.dur, midi: stepInPool(n.midi, -2, scaleFor(harmAt(n.pos), 60, HI)), vel: n.vel * 0.5 });
        answers(line, s, s.v >= 2 ? 'vib' : 'gtr', s.v === 0 ? 0.35 : 0.5);
      } else if (s.kind === 'B') {
        const line = ornament(realizeB(s), s.v ? 0.3 : 0.15).map(dv);
        FL.push(...line);
        answers(line, s, 'vib', 0.45);
      } else if (s.kind === 'solo') {
        // nylon guitar solo: 8th-note phrases targeting guide tones on the changes, density rising through the chorus
        const lo = 57, hi = 79, end = base + s.bars * 4 - 2;
        let pos = base + rng.pick([0.5, 1, 1.5]), cur = rng.int(64, 70), dir = 1;
        while (pos < end) {
          const x = (pos - base) / (s.bars * 4);
          const dens = 0.55 + 0.35 * Math.sin(Math.PI * Math.min(1, x * 1.15));
          const len = rng.int(3, 7) * 2;
          for (let k = 0; k < len && pos < end; k++) {
            const c = harmAt(pos);
            if (k > 0 && !rng.chance(dens)) {
              pos += 0.5;
              continue;
            }
            if (isChange(pos) && rng.chance(0.65)) cur = snap(cur + dir, chordTones(c, lo, hi).filter((m) => GUIDE.includes(pc(m - c.root))));
            else cur = stepInPool(cur, dir * (rng.chance(0.78) ? 1 : 2), scaleFor(c, lo, hi));
            if (cur >= hi - 2) dir = -1;
            else if (cur <= lo + 2) dir = 1;
            else if (rng.chance(0.22)) dir = -dir;
            const last = k === len - 1;
            const d = last ? rng.pick([1, 1.5, 2]) : 0.5;
            if (last) cur = snap(cur, chordTones(c, lo, hi));
            const vel = humVel(rng, (0.52 + (pos % 1 ? 0.05 : 0)) * dynAt(Math.floor(pos / 4)), 0.05);
            put(LD, { pos, dur: d * 0.92, midi: cur, vel });
            if (last && rng.chance(0.35)) put(LD, { pos: pos + 0.01, dur: d * 0.92, midi: stepInPool(cur, -2, scaleFor(c, lo - 5, hi)), vel: vel * 0.85 });
            pos += d;
          }
          pos = Math.round((pos + rng.pick([1, 1.5, 2, 2.5])) * 2) / 2;
        }
      } else if (s.kind === 'inter') {
        // breakdown: the vibes quote the motif and its sequence, the guitar answers
        const q0 = place(mCell, mCont, base, S0);
        const q1 = place(mCell, mCont, base + 8, stepInPool(S0, seqShift, scaleFor(harmAt(base + 8), LO, HI)));
        for (const n of [...q0, ...q1]) put(VB, { ...n, vel: humVel(rng, 0.46 * dynAt(Math.floor(n.pos / 4)), 0.03) });
        answers([...q0, ...q1], s, 'gtr', 0.8);
      } else if (s.kind === 'coda') {
        // tag: the cadence lands deceptively on iii, the vibes answer, then the cadence again into the final chord
        const c1 = cadence(base, S0, eCell, eSteps, [0, 3, 7], false);
        const c2 = cadence(base + 16, S0, eCell, eSteps, [2, 4], true);
        const line = [...c1, ...c2].map(dv);
        line[line.length - 1].vel *= 0.9;
        line[line.length - 1].glide = line[line.length - 1].midi - 2;
        FL.push(...line);
        answers(c1, s, 'vib', 1);
      } else if (s.kind === 'intro') {
        // guitar licks closing each 4-bar phrase
        for (const bar of [3, 7]) {
          const st = base + bar * 4 + (bar === 7 && mCell[0][0] < 0 ? 1.5 : 2.5);
          const c = harmAt(st);
          const tones = chordTones(c, 60, 76);
          let m = snap(rng.int(68, 74), tones);
          for (let q = 0; q < 3; q++) {
            put(LD, { pos: st + q * 0.5, dur: q === 2 ? 1.1 : 0.5, midi: m, vel: humVel(rng, 0.44, 0.03) });
            m = stepInPool(m, -1, tones);
          }
        }
      }
    }
    // the flute is monophonic: trim overlaps, keep a breath between notes
    FL.sort((a, b) => a.pos - b.pos);
    for (let i = FL.length - 2; i >= 0; i--) {
      const n = FL[i], nx = FL[i + 1];
      if (nx.pos - n.pos < 0.2) FL.splice(i, 1);
      else if (n.pos + n.dur > nx.pos - 0.06) n.dur = Math.max(0.2, nx.pos - n.pos - 0.06);
    }
    const FLB = bucket<Note>();
    for (const n of FL) put(FLB, n);

    // ---------------------------------------------------------------- strings bed (one voicing per chord change)
    {
      let prevS: number[] | null = null;
      let run: { pos: number; dur: number; chord: Chord } | null = null;
      const flush = () => {
        if (!run) return;
        prevS = voiceLead(prevS, run.chord, { lo: 52, hi: 72, count: 4 });
        const bi = Math.floor(run.pos / 4);
        put(ST, { pos: run.pos, dur: run.dur + 0.25, notes: prevS, vel: 0.3 * dynAt(bi) });
        run = null;
      };
      for (let bi = 0; bi < total - 2; bi++) {
        if (!lay(bi).strings) {
          flush();
          continue;
        }
        for (const sl of slots[bi]) {
          const d = 4 / slots[bi].length;
          if (run && run.chord.name === sl.chord.name && run.dur < 8) run.dur += d;
          else flush(), (run = { pos: bi * 4 + sl.beat, dur: d, chord: sl.chord });
        }
      }
      flush();
    }

    // ---------------------------------------------------------------- percussion
    for (let bi = 0; bi < total - 2; bi++) {
      const L = lay(bi), dyn = dynAt(bi), P = bi * 4, f = fill[bi];
      const lim = brk.has(bi) ? 2 : 4;
      const fillFrom = f === 'rim' || f === 'toms' || f === 'conga' ? 2 : f === 'lite' ? 3 : 4;
      const add = (b: number, k: PercKind, v: number) => put(PC, { pos: P + b, k, vel: humVel(rng, v * dyn, 0.035) });
      if (L.shaker > 0) for (let e = 0; e < 8 && e / 2 < lim; e++) add(e / 2, 'shaker', SHAKER[e % 4] * L.shaker);
      if (L.rim > 0)
        for (const st of CLAVE) {
          if (Math.floor(st / 8) !== bi % 2) continue;
          const b = (st % 8) / 2;
          if (b < lim && !(f === 'rim' && b >= 2)) add(b, 'rim', (st === 0 ? 0.42 : 0.36) * L.rim);
        }
      if (L.kick) for (const [b, v] of [[0, 0.34], [1.5, 0.15], [2, 0.28], [3.5, 0.15]] as const) if (b < lim && !(brk.has(bi) && b === 1.5)) add(b, 'kick', v);
      if (L.hat) for (const b of [1, 3]) if (b < lim) add(b, 'hat', 0.24);
      if (L.ride) for (const [b, v] of [[0, 0.3], [1, 0.24], [2, 0.3], [3, 0.24], [3.5, 0.16]] as const) if (b < lim && b < fillFrom) add(b, 'ride', v);
      if (L.conga) for (const [b, k, v] of [[0.5, 'congaMute', 0.2], [1.5, 'congaHi', 0.3], [3, 'congaLo', 0.3], [3.5, 'congaHi', 0.24]] as const) if (b < Math.min(lim, fillFrom)) add(b, k, v);
      if (brk.has(bi)) {
        add(1.5, 'rim', 0.4);
        add(1.5, 'kick', 0.3);
        put(PC, { pos: P, k: 'swell', vel: 0.2 });
        continue;
      }
      switch (f) {
        case 'rim': [0.22, 0.28, 0.34, 0.42].forEach((v, q) => add(2 + q * 0.5, 'rim', v)); break;
        case 'toms': add(2.5, 'tomH', 0.24), add(3, 'tomM', 0.27), add(3.5, 'tomL', 0.3); break;
        case 'conga': add(2, 'congaHi', 0.26), add(2.5, 'congaHi', 0.3), add(3, 'congaLo', 0.32), add(3.5, 'congaLo', 0.36); break;
        case 'lite': add(3, 'congaHi', 0.24), add(3.5, 'congaLo', 0.28); break;
        case 'swell': put(PC, { pos: P, k: 'swell', vel: 0.2 }); break;
      }
    }

    // ---------------------------------------------------------------- ending
    const endBar = total - 2;
    const endChord = slots[endBar][0].chord;
    const ending = (b: BarInfo) => {
      const t = b.t, sec = (n: number) => b.beatsToSec(n);
      const top = voicing({ ...endChord, tones: gtrIv(endChord, false) }, { lo: 55, hi: 74, count: 3, rootless: false });
      const low = nearestPc(endChord.bass, 41, 40, 51);
      const roll = [low, low + 7, ...top, top[top.length - 1] + (pc(top[top.length - 1] - endChord.root) === 2 ? 5 : 3)];
      roll.forEach((m, j) => inst.guitar(t + 0.03 + j * 0.075, m, sec(8), 0.5 - j * 0.025));
      inst.guitar(t + sec(2.5), top[1] + 12, sec(5), 0.3, { ch: 'lead' });
      inst.upright(t, nearestPc(endChord.bass, 36, 31, 42), sec(6), 0.64);
      inst.strings(t, voicing(endChord, { lo: 53, hi: 74, count: 4 }), sec(7), 0.26, { attack: 1.1, release: 2.6, cutoff: 2000 });
      const hi = chordTones(endChord, 79, 91);
      inst.vibes(t + sec(1.5), hi[hi.length - 1] ?? 84, sec(5), 0.26, { pedal: true });
      inst.vibes(t + sec(1.5) + 0.14, hi[Math.max(0, hi.length - 3)] ?? 79, sec(5), 0.22, { pedal: true });
      inst.cymbal(t, 0.14, { swell: sec(2) });
      inst.shaker(t, 0.22, { len: 0.35 });
    };

    // ---------------------------------------------------------------- mix
    const setup = () => {
      inst.mix('guitar', { level: 0.98, pan: -0.42, reverb: 0.28 });
      inst.mix('guitar:lead', { level: 0.95, pan: 0.36, reverb: 0.34, delay: 0.12 });
      inst.mix('flute', { level: 1.16, pan: 0.1, reverb: 0.4, delay: 0.12 });
      inst.mix('vibes', { level: 0.7, pan: 0.38, reverb: 0.4, tremolo: 0.12 });
      inst.mix('upright', { level: 0.85 });
      inst.mix('strings', { level: 0.5, lowpass: 5000, reverb: 0.5 });
      inst.mix('shaker', { level: 1.1, pan: 0.4, reverb: 0.2 });
      inst.mix('rim', { level: 0.7, pan: -0.2, reverb: 0.25 });
      inst.mix('kick', { level: 0.55 });
      inst.mix('hat', { level: 0.6, pan: 0.3 });
      inst.mix('ride', { level: 0.6, pan: -0.3 });
      inst.mix('conga', { level: 0.55, pan: -0.28 });
      inst.mix('tom', { level: 0.55 });
      inst.mix('cymbal', { level: 0.5 });
      inst.setDelay({ beats: 0.75, feedback: 0.26, tone: 2800 });
    };

    const tempo = (bar: number) => {
      const r = bar - (total - 4);
      return r < 0 ? bpm : bpm * [0.95, 0.88, 0.8, 0.76][r];
    };

    return song(env, {
      bpm,
      tempo,
      swing,
      sections: secs.map((s) => ({ name: s.name, bars: s.bars })),
      tail: 5,
      setup,
      bar(b: BarInfo) {
        const i = b.bar, off = i * 4;
        const at = (pos: number, ms: number) => humanize(rng, b.at(pos - off), ms);
        const sec = (n: number) => b.beatsToSec(n);
        for (const h of G[i]) {
          const t = at(h.pos, 5);
          h.notes.forEach((m, j) => inst.guitar(t + (j + 1) * h.spread, m, sec(h.dur), h.vel * (j === h.notes.length - 1 ? 1.06 : 0.96)));
        }
        for (const n of TH[i]) inst.guitar(at(n.pos, 4), n.midi, sec(n.dur), n.vel);
        for (const n of BS[i]) inst.upright(at(n.pos, 5), n.midi, sec(n.dur), n.vel);
        for (const n of FLB[i]) inst.flute(at(n.pos, 8) + 0.012, n.midi, sec(n.dur), n.vel, { vibrato: n.dur >= 2 ? 17 : 12, glideFrom: n.glide, glideTime: 0.09 });
        for (const n of VB[i]) inst.vibes(at(n.pos, 6), n.midi, sec(n.dur), n.vel);
        for (const n of LD[i]) inst.guitar(at(n.pos, 6), n.midi, sec(n.dur), n.vel, { ch: 'lead' });
        for (const p of ST[i]) inst.strings(b.at(p.pos - off), p.notes, sec(p.dur), p.vel, { attack: 0.7, release: 1.4, cutoff: 2600 });
        for (const p of PC[i]) {
          const t = at(p.pos, 4);
          switch (p.k) {
            case 'shaker': inst.shaker(t, p.vel, { len: 0.085 }); break;
            case 'rim': inst.rim(t, p.vel); break;
            case 'kick': inst.kick(t, p.vel, { click: 0, tune: 50, decay: 0.32 }); break;
            case 'hat': inst.hat(t, p.vel, { decay: 0.035 }); break;
            case 'ride': inst.ride(t, p.vel); break;
            case 'congaHi': inst.conga(t, p.vel, { tone: 'hi' }); break;
            case 'congaLo': inst.conga(t, p.vel, { tone: 'lo' }); break;
            case 'congaMute': inst.conga(t, p.vel, { tone: 'mute' }); break;
            case 'tomH': inst.tom(t, p.vel, { pitch: 'high' }); break;
            case 'tomM': inst.tom(t, p.vel, { pitch: 'mid' }); break;
            case 'tomL': inst.tom(t, p.vel, { pitch: 'low' }); break;
            case 'swell': inst.cymbal(b.at(4), p.vel, { swell: sec(3) }); break;
          }
        }
        if (i === endBar) ending(b);
      },
    });
  },
};
