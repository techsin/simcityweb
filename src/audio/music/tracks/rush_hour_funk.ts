/**
 * "Rush Hour" - upbeat downtown funk / pop for a busy, fast-growing city by day (Metropolis soundtrack).
 *
 * Band: clavinet 16th stabs (dyads / triads with ghost scratches), slap bass (thumb, octave pops, dead notes,
 * chromatic approaches), a tight kit (punchy kick, crisp snare with ghost notes, 16th hats with open-hat lifts, claps
 * on 2 & 4 in the choruses, tambourine), synth-brass stabs / answers / fills, a warm synth lead for the tunes, a
 * string bed in the choruses and a Rhodes in the bridge.
 *
 * Form (~98-102 bars at 101-107 bpm, ~3:40-4:05):
 *   intro 8 | verse 1 16 | pre-chorus 4 | chorus 1 8 | [interlude 4] | verse 2 16 | pre-chorus 4 | chorus 2 8 |
 *   bridge 8 | build 4 | chorus 3 (key up) 16 | outro 6 (band hit + ringing 6/9 chord)
 * Harmony: the verse vamps in a dorian minor key; the pre-chorus pivots into a major chorus key (up a 4th, a minor
 * 3rd or a whole step), the chorus's last bar is the verse key's V7#9 to fall back home, and the last chorus lifts
 * again (+1 / +2 semitones) after a dominant-pedal build.
 * Tunes: the verse is a 1-bar call + tail, answered by the call sequenced a step away, with brass answers in the gaps;
 * phrase 3 develops it higher, phrase 4 liquidates it into a rising lead-in. The chorus hook works the same way
 * (statement, answer, restatement, cadence). The interlude gives the verse call to the brass, the bridge plays it in
 * augmentation, and in the last chorus the brass takes the hook while the lead answers.
 * Every play re-rolls: key, tempo, 16th lilt, chorus key and final lift, verse vamp, pre-chorus / chorus / bridge /
 * build charts, the call, tails, hook and their sequences, all melodic variation (anticipations, stutters, drops,
 * scoops), clav / bass / kick / ghost-note patterns, brass figures, fills, intro type, interlude, pre-chorus stop.
 * Everything is planned in create(); bar() only schedules.
 *
 * CPU: the 16th hats and the tambourine are two persistent NoiseVoice envelopes (rush_hour_funk_perc.ts) instead of
 * a node graph per hit.
 */
import type { MusicTrack } from '../types';
import { song, type BarInfo } from '../song';
import { parseChart, voiceLead, voicing, chordTones, scaleFor, scale, humanize, humVel, snap, stepInPool, bassNote, pc, degree, pattern, type Chord, type ScaleName } from '../theory';
import { NoiseVoice } from './rush_hour_funk_perc';

type Kind = 'intro' | 'verse' | 'pre' | 'chorus' | 'inter' | 'bridge' | 'build' | 'final' | 'outro';
interface Sec {
  name: string;
  bars: number;
  kind: Kind;
  /** occurrence index of this kind (verse 1 = 0, verse 2 = 1) */
  n: number;
  start: number;
}
/** melody template note: [16th step from the bar start (may exceed 15), length in 16ths, scale degree, flags ('g' = scoop)] */
type TN = readonly [number, number, number, string?];
type Tpl = readonly TN[];
type MTN = [number, number, number, string?];
interface Ev {
  step: number;
  len: number;
  midi: number;
  vel: number;
  glide?: number;
  /** bass: slap pop (else a round finger / thumb note) */
  pop?: boolean;
}
interface Hit {
  step: number;
  len: number;
  notes: number[];
  vel: number;
  att?: number;
}
interface Slot {
  step: number;
  chord: Chord;
  root: number;
  clav: number[];
  brass: number[];
  str: number[];
  ep: number[];
}
interface Drum {
  step: number;
  vel: number;
  /** hat: open ring seconds; tom: 0 low, 1 mid, 2 high */
  x?: number;
}
interface BarPlan {
  sec: Sec;
  inSec: number;
  slots: Slot[];
  lead: Ev[];
  bass: Ev[];
  clav: Hit[];
  brass: Hit[];
  strings: Hit[];
  epiano: Hit[];
  kick: Drum[];
  snare: Drum[];
  clap: Drum[];
  hat: Drum[];
  tamb: Drum[];
  rim: Drum[];
  tom: Drum[];
  crash: number;
  /** reverse-cymbal swell into the NEXT bar's downbeat */
  swell: number;
  /** noise riser starting on this bar: [beats, vel] */
  sweep: [number, number] | null;
  final: boolean;
}

// ------------------------------------------------------------------ composed material
// verse vamps (written in E dorian, transposed to the verse key)
const VAMPS = ['Em9 | Em9 | A13 | A13', 'Em9 | Em9 | Cmaj9 | B7s9', 'Em9 | Em9 | Am9 | Bm9', 'Em9 | Em9 A13 | Em9 | Em9 A13'];
// pre-chorus / chorus / build / outro (written in C major, transposed to the chorus key)
const PRES = ['Dm9 | Em7 | Fmaj9 | G13sus4', 'Fmaj9 | Em7 Am9 | Dm9 | G9sus4 G13'];
const CHORUSES = [
  'Cmaj9 | Am9 | Dm9 | G9sus4 G13 | Cmaj9 | Am9 | Dm9 G9sus4',
  'Fmaj9 | Em7 Am9 | Dm9 | G9sus4 G13 | Fmaj9 | Em7 Am9 | Dm9 G13sus4',
  'Dm9 | G13 | Cmaj9 | Am9 | Dm9 | G13 | Em7 Am9',
  'Cmaj9 | Em7 | Fmaj9 | G9sus4 | Cmaj9 | Em7 | Fmaj9 G9sus4',
];
// bridge (E terms) and build (C terms of the final key)
const BRIDGES = ['Em9 | Em9 | Em9 | Em9 | Cmaj9 | Bm9 | Am9 | Bm9', 'Cmaj9 | Bm9 | Am9 | Bm9 | Cmaj9 | Bm9 | Am9 | Am9', 'Am9 | D13 | Gmaj9 | Cmaj9 | F#m7b5 | B7s9 | Em9 | Em9'];
const BUILDS = ['G9sus4 | G9sus4 | G9sus4 | G13', 'G9sus4 | G9sus4 | Abmaj9 | Bb13'];
const OUTRO = 'Cmaj9 | Fmaj9 | Cmaj9 | Dm9 G13 | C69 | C69';

// verse call bars (dorian degrees from the verse tonic: 0 E, 2 G, 3 A, 4 B, 5 C#, 6 D, 7 E')
const CALLS: Tpl[] = [
  [[0, 2, 4], [2, 1, 6], [3, 3, 7, 'g'], [7, 1, 6], [8, 2, 4], [10, 2, 3], [12, 2, 2], [14, 2, 0]],
  [[0, 1, 7], [2, 1, 7], [3, 2, 6], [6, 2, 4], [8, 1, 6], [9, 3, 7, 'g'], [14, 2, 6]],
  [[2, 1, 0], [3, 1, 2], [4, 2, 3], [7, 1, 4], [8, 2, 3], [10, 1, 2], [11, 3, 0], [15, 1, -1]],
  [[0, 3, 4, 'g'], [3, 1, 3], [4, 1, 2], [6, 2, 0], [10, 1, 2], [11, 1, 3], [12, 4, 4]],
];
// the bar after a call: notes in steps 0-9, the brass answers in 10-15
const TAIL_OPEN: Tpl[] = [[[2, 2, 2], [4, 6, 4]], [[1, 1, 6], [2, 1, 7], [4, 1, 6], [6, 4, 4]]];
const TAIL_LOW: Tpl = [[0, 2, 3], [2, 2, 2], [4, 6, 0]];
const END_TAILS: Tpl[] = [[[0, 2, 2], [2, 2, 1], [4, 8, 0]], [[0, 1, 6], [1, 1, 7], [2, 2, 6], [4, 8, 4]]];
const END_LEADIN: Tpl = [[0, 4, 4], [4, 4, 5], [8, 8, 6, 'g']];
// chorus hooks (major degrees from the chorus tonic)
const HOOKS: Tpl[] = [
  [[0, 2, 4], [2, 1, 5], [3, 3, 4], [6, 2, 2], [8, 2, 4], [10, 1, 5], [11, 5, 7, 'g']],
  [[0, 1, 2], [1, 2, 4], [3, 3, 5], [8, 1, 4], [9, 2, 5], [11, 5, 7]],
  [[0, 3, 7, 'g'], [3, 1, 6], [4, 2, 5], [6, 2, 4], [10, 2, 5], [12, 4, 4]],
  [[2, 1, 2], [3, 1, 4], [4, 2, 5], [6, 2, 4], [8, 1, 5], [9, 1, 6], [10, 6, 7]],
];
const HOOK_TAILS: Tpl[] = [[[0, 2, 6], [2, 2, 5], [4, 6, 4]], [[2, 2, 5], [4, 2, 4], [6, 4, 2]]];
const HOOK_UP: Tpl = [[0, 2, 4], [2, 2, 5], [4, 6, 6]];
const HOOK_CLOSE: Tpl[] = [[[0, 2, 2], [2, 2, 1], [4, 8, 0]], [[0, 1, 4], [1, 1, 2], [2, 2, 1], [4, 8, 0]]];
// pre-chorus lines (4 bars, rising sequences into the hook)
const PRE_MEL: Tpl[][] = [
  [[[0, 6, 1], [6, 2, 2], [8, 8, 3]], [[0, 6, 2], [6, 2, 3], [8, 8, 4]], [[0, 6, 3], [6, 2, 4], [8, 8, 5]], [[0, 10, 4, 'g'], [12, 2, 5], [14, 2, 6]]],
  [[[2, 2, 4], [4, 4, 3], [10, 6, 1]], [[2, 2, 5], [4, 4, 4], [10, 6, 2]], [[2, 2, 6], [4, 4, 5], [10, 6, 3]], [[0, 8, 4, 'g'], [8, 4, 5], [12, 4, 6]]],
];
// lead answer licks (degrees, placed in steps 10-15)
const LICKS: Tpl[] = [[[10, 1, 7], [11, 1, 5], [12, 1, 4], [13, 3, 2]], [[11, 1, 4], [12, 1, 5], [13, 1, 7], [14, 2, 8]], [[10, 2, 5], [12, 1, 4], [13, 1, 2], [14, 2, 4]]];
// brass answer figures: [step, length]
const BRASS_FIGS: (readonly [number, number])[][] = [[[10, 1], [12, 2]], [[11, 1], [12, 1], [14, 2]], [[10, 2], [13, 1], [14, 2]], [[12, 1], [14, 1], [15, 1]]];
// clav: X triad stab, x dyad, o ghost scratch
const CLAV_V = ['-oX----x--X--ox-', 'x--X-ox---X--o-x', 'X--o-x--X-o--x--'];
const CLAV_C = ['x--x--X---x--x--', '--x--x-x--X---x-'];
const CLAV_SPARSE = '--X---x---X-----';
const CLAV_PRE = '--x---x---x---x-';
const CLAV_BUILD = 'x---x-o-x---x-ox';
// kick patterns
const KICK_V = ['X-----x-X--x----', 'X--x----X-x-----', 'X------xX-----x-', 'X-x-------x---x-'];
const KICK_C = ['X---X---X---X---', 'X-----x-X-x---x-', 'X--x--x-X-----x-'];
const GHOSTS = [[7, 10, 15], [2, 9, 14], [6, 9, 11], [3, 7, 10]];
// slap bass: [step, length, tone, kind]; tones R root, O octave, 5, 7 (b7 / 6), 3, Q 4th, A approach next root, x dead note
// kinds: T thumb, P pop, x dead
type BN = readonly [number, number, string, string];
const BASS_V: BN[][] = [
  [[0, 3, 'R', 'T'], [4, 1, 'O', 'P'], [6, 1, 'R', 'T'], [7, 1, 'x', 'x'], [10, 2, '7', 'T'], [12, 1, 'O', 'P'], [14, 2, '5', 'T']],
  [[0, 2, 'R', 'T'], [3, 1, 'R', 'T'], [6, 1, 'O', 'P'], [8, 2, 'R', 'T'], [11, 1, '5', 'T'], [12, 1, '7', 'T'], [14, 1, 'O', 'P'], [15, 1, 'A', 'T']],
  [[0, 4, 'R', 'T'], [6, 1, 'O', 'P'], [7, 1, 'x', 'x'], [9, 1, 'R', 'T'], [10, 2, '5', 'T'], [13, 1, '7', 'T'], [14, 2, 'O', 'P']],
];
const BASS_C: BN[][] = [
  [[0, 2, 'R', 'T'], [2, 1, 'O', 'P'], [4, 1, 'x', 'x'], [6, 2, 'O', 'P'], [8, 2, 'R', 'T'], [10, 1, 'O', 'P'], [12, 1, '5', 'T'], [14, 1, 'O', 'P'], [15, 1, 'A', 'T']],
  [[0, 3, 'R', 'T'], [3, 1, 'O', 'P'], [6, 2, 'R', 'T'], [8, 1, 'O', 'P'], [10, 1, 'R', 'T'], [11, 1, '7', 'T'], [12, 2, 'O', 'P'], [14, 2, 'A', 'T']],
];
const BASS_HALF: BN[][] = [
  [[0, 2, 'R', 'T'], [3, 1, 'O', 'P'], [4, 1, 'x', 'x'], [6, 2, '5', 'T']],
  [[0, 3, 'R', 'T'], [3, 1, 'O', 'P'], [6, 1, 'R', 'T'], [7, 1, 'A', 'T']],
];
const BASS_PUMP: BN[] = [[0, 2, 'R', 'T'], [2, 2, 'R', 'T'], [4, 1, 'O', 'P'], [6, 2, 'R', 'T'], [8, 2, 'R', 'T'], [10, 1, 'O', 'P'], [12, 2, 'R', 'T'], [14, 2, 'A', 'T']];
const BASS_FILLS: BN[][] = [
  [[12, 1, 'O', 'P'], [13, 1, '7', 'T'], [14, 1, '5', 'T'], [15, 1, 'A', 'T']],
  [[12, 1, 'R', 'T'], [13, 1, '3', 'T'], [14, 1, 'Q', 'T'], [15, 1, 'A', 'T']],
  [[12, 1, 'O', 'P'], [13, 1, 'x', 'x'], [14, 1, 'O', 'P'], [15, 1, 'A', 'T']],
];

export const track: MusicTrack = {
  id: 'rush_hour_funk',
  title: 'Rush Hour',
  mood: 'Downtown funk: clav stabs, slap bass, synth brass, tight 16th groove',
  tags: ['day', 'busy'],
  bpm: 104,
  gain: 0.98, // measured -18.2 LUFS avg (seeds 1-3) at gain 1
  create(env) {
    const { inst, rng } = env;
    const bpm = rng.int(101, 107);
    inst.bpm = bpm;
    const swing = rng.range(0.515, 0.55);
    // ---------------------------------------------------------------- keys
    const kv = rng.weighted([4, 2, 5, 7, 0], [3, 2, 2, 1.5, 1]); // verse tonic (dorian): E D F G C
    const off = rng.weighted([5, 3, 2], [4, 3, 3]); // chorus key: up a 4th / minor 3rd / whole step
    const lift = rng.weighted([2, 1], [6, 4]); // last chorus lift
    const k2 = (kv + off) % 12, k3 = (k2 + lift) % 12;
    const Tv = kv - 4;
    const vt = 60 + kv; // verse melody tonic (midi)
    const ct = vt + off; // chorus melody tonic
    const ft = ct + lift; // final chorus tonic

    // ---------------------------------------------------------------- arrangement
    const interlude = rng.chance(0.5);
    const FORM: Sec[] = [];
    const add = (name: string, bars: number, kind: Kind) => {
      const start = FORM.reduce((a, s) => a + s.bars, 0);
      FORM.push({ name, bars, kind, n: FORM.filter((s) => s.kind === kind).length, start });
    };
    add('intro', 8, 'intro');
    add('verse 1', 16, 'verse');
    add('pre-chorus 1', 4, 'pre');
    add('chorus 1', 8, 'chorus');
    if (interlude) add('interlude', 4, 'inter');
    add('verse 2', 16, 'verse');
    add('pre-chorus 2', 4, 'pre');
    add('chorus 2', 8, 'chorus');
    add('bridge', 8, 'bridge');
    add('build', 4, 'build');
    add('chorus 3 (key up)', 16, 'final');
    add('outro', 6, 'outro');

    const vamp = rng.weighted(VAMPS, [4, 3, 2, 2]);
    const preChart = rng.pick(PRES);
    const chorusChart = rng.pick(CHORUSES);
    const bridgeChart = rng.pick(BRIDGES);
    const buildChart = rng.pick(BUILDS);
    const cycle = (bars: Chord[][], n: number): Chord[][] => Array.from({ length: n }, (_, i) => bars[i % bars.length]);
    const chartFor = (s: Sec): Chord[][] => {
      switch (s.kind) {
        case 'intro':
        case 'verse':
        case 'inter':
          return cycle(parseChart(vamp, Tv), s.bars);
        case 'pre':
          return parseChart(preChart, k2);
        case 'chorus':
          return [...parseChart(chorusChart, k2), ...parseChart('B7s9', Tv)];
        case 'bridge':
          return parseChart(bridgeChart, Tv);
        case 'build':
          return parseChart(buildChart, k3);
        case 'final': {
          const c = [...parseChart(chorusChart, k3), ...parseChart('Dm9 G13', k3)];
          return [...c, ...c];
        }
        case 'outro':
          return parseChart(OUTRO, k3);
      }
    };

    const plan: BarPlan[] = [];
    for (const s of FORM) {
      const bars = chartFor(s);
      for (let i = 0; i < s.bars; i++) {
        const cs = bars[i % bars.length];
        plan.push({
          sec: s, inSec: i,
          slots: cs.map((c, k) => ({ step: (k * 16) / cs.length, chord: c, root: bassNote(c, 31), clav: [], brass: [], str: [], ep: [] })),
          lead: [], bass: [], clav: [], brass: [], strings: [], epiano: [],
          kick: [], snare: [], clap: [], hat: [], tamb: [], rim: [], tom: [],
          crash: 0, swell: 0, sweep: null, final: false,
        });
      }
    }
    const total = plan.length;
    // voicings: one voice-led chain per part through the whole song
    {
      let pc3: number[] | null = null, pb: number[] | null = null, ps: number[] | null = null, pe: number[] | null = null;
      for (const p of plan)
        for (const s of p.slots) {
          s.clav = pc3 = voiceLead(pc3, s.chord, { lo: 57, hi: 72, count: 3, rootless: true });
          s.brass = pb = voiceLead(pb, s.chord, { lo: 60, hi: 77, count: 3, rootless: true });
          s.str = ps = voiceLead(ps, s.chord, { lo: 55, hi: 76, count: 4, rootless: true });
          s.ep = pe = voiceLead(pe, s.chord, { lo: 52, hi: 71, count: 4, rootless: true });
        }
    }
    const slotAt = (bi: number, step: number): Slot => {
      const p = plan[Math.max(0, Math.min(total - 1, bi))];
      let s = p.slots[0];
      for (const x of p.slots) if (step >= x.step - 1e-6) s = x;
      return s;
    };
    const chordAt = (bi: number, step: number): Chord => slotAt(bi, step).chord;
    const nextChordAfter = (bi: number, step: number): Chord => (step + 1 < 16 ? chordAt(bi, step + 1) : chordAt(bi + 1, 0));

    // ---------------------------------------------------------------- melody helpers
    const isAvoid = (m: number, c: Chord): boolean => {
      const rel = pc(m - c.root);
      const base = c.tones.map((t) => t % 12);
      if (base.includes(rel)) return false;
      if (c.quality.includes('sus') && rel === 4) return true;
      return base.some((t) => pc(rel - t) === 1);
    };
    /** realize a template at bar0: degrees in the key's scale, snapped to the chord scale, strong notes off avoid notes */
    const place = (tpl: Tpl, bar0: number, tonic: number, mode: ScaleName, vel: number, shift = 0, to: 'lead' | 'brass' = 'lead') => {
      const keyPcs = new Set(scale(tonic, mode, tonic, tonic + 11).map(pc));
      for (const [step, len, deg, fl] of tpl) {
        const bi = bar0 + Math.floor(step / 16), st = step % 16;
        if (bi < 0 || bi >= total) continue;
        const c = chordAt(bi, st);
        const raw = degree(tonic, mode, deg + shift);
        // diatonic chords keep the tune in the key; chromatic ones get their own colour: the V7#9 pivot a bluesy
        // dominant pool (root, #9, 3, 5, 13, b7), borrowed maj7 chords lydian, others their chord scale
        const inKey = c.tones.every((t) => keyPcs.has(pc(c.root + t)));
        const pool = inKey
          ? scale(tonic, mode, raw - 8, raw + 8)
          : c.quality === '7s9'
            ? scale(c.root, [0, 3, 4, 7, 9, 10], raw - 8, raw + 8)
            : c.quality === 'maj7' || c.quality === 'maj9'
              ? scale(c.root, 'lydian', raw - 8, raw + 8)
              : scaleFor(c, raw - 8, raw + 8);
        let m = snap(raw, pool);
        if (len >= 6 || ((st % 4 === 0 || len >= 3) && isAvoid(m, c))) m = snap(m, chordTones(c, m - 4, m + 4));
        const v = humVel(rng, vel + (st % 2 ? 0.03 : 0) + (len >= 4 ? 0.02 : 0), 0.04);
        if (to === 'lead') plan[bi].lead.push({ step: st, len, midi: m, vel: v, glide: fl?.includes('g') ? stepInPool(m, -1, pool) : undefined });
        else {
          // brass section line: melody on top, a diatonic 3rd below
          const lo = snap(stepInPool(m, -2, pool), pool);
          plan[bi].brass.push({ step: st, len, notes: [lo, m], vel: v * 0.95 });
        }
      }
    };
    const shiftT = (tpl: Tpl, k: number): Tpl => tpl.map((n) => [n[0], n[1], n[2] + k, n[3]] as TN);
    const frag = (tpl: Tpl): Tpl => {
      const a = tpl.filter((n) => n[0] < 8);
      return [...a, ...a.map((n) => [n[0] + 8, n[1], n[2], n[3]] as TN)];
    };
    const augment = (tpl: Tpl): Tpl => tpl.slice(0, 5).map((n) => [n[0] * 2, Math.max(2, n[1] * 2), n[2], n[3]] as TN);
    /** light variation: anticipations, stutters, dropped passing notes, scoops */
    const vary = (tpl: Tpl, amt: number): Tpl => {
      const out: MTN[] = tpl.map((n) => [n[0], n[1], n[2], n[3]]);
      for (let i = out.length - 1; i >= 1; i--) {
        const n = out[i], prev = out[i - 1];
        const r = rng.next();
        if (r < 0.15 * amt && n[0] % 4 === 0 && n[0] - 1 > prev[0]) (n[0] -= 1), (n[1] += 1);
        else if (r < 0.24 * amt && n[1] <= 1 && i < out.length - 1) out.splice(i, 1);
        else if (r < 0.33 * amt && n[1] >= 2 && n[1] <= 3) out.splice(i + 1, 0, [n[0] + 1, n[1] - 1, n[2]]), (n[1] = 1);
        else if (r < 0.42 * amt && n[1] >= 3) n[3] = 'g';
      }
      for (let i = 0; i < out.length - 1; i++) out[i][1] = Math.max(1, Math.min(out[i][1], out[i + 1][0] - out[i][0]));
      return out;
    };
    const brassFig = (bi: number, fig: readonly (readonly [number, number])[], vel: number) => {
      if (bi < 0 || bi >= total) return;
      fig.forEach(([st, len], j) => plan[bi].brass.push({ step: st, len, notes: slotAt(bi, st).brass, vel: humVel(rng, vel + (j === fig.length - 1 ? 0.05 : 0), 0.04) }));
    };
    /** brass pickup run (single notes) into the next bar's first voicing */
    const brassRun = (bi: number, vel: number) => {
      if (bi + 1 >= total) return;
      const target = slotAt(bi + 1, 0).brass;
      const top = target[target.length - 1];
      const pool = scaleFor(chordAt(bi, 12), top - 12, top + 2);
      let m = stepInPool(top, -3, pool);
      for (const st of [13, 14, 15]) {
        plan[bi].brass.push({ step: st, len: 1, notes: [m], vel: humVel(rng, vel + (st - 13) * 0.04, 0.03) });
        m = stepInPool(m, 1, pool);
      }
    };

    // ---------------------------------------------------------------- per-song choices
    const call = rng.pick(CALLS);
    const tailOpen = rng.pick(TAIL_OPEN);
    const [endA, endB] = rng.chance(0.5) ? [END_TAILS[0], END_TAILS[1]] : [END_TAILS[1], END_TAILS[0]];
    const seq = rng.weighted([1, -1, 2], [4, 3, 2]);
    const dev = rng.pick([2, 3]);
    const hook = rng.pick(HOOKS);
    const hookTail = rng.pick(HOOK_TAILS);
    const hookTail2 = rng.chance(0.6) ? hookTail : HOOK_TAILS[1 - HOOK_TAILS.indexOf(hookTail)];
    const hookClose = rng.pick(HOOK_CLOSE);
    const hSeq = rng.weighted([1, -1, 2], [5, 3, 2]);
    const preMel = rng.pick(PRE_MEL);
    const figA = rng.pick(BRASS_FIGS), figB = rng.pick(BRASS_FIGS), figC = rng.pick(BRASS_FIGS);
    const clavV = rng.pick(CLAV_V), clavC = rng.pick(CLAV_C);
    const kickV1 = pattern(rng.pick(KICK_V)), kickV2 = pattern(rng.pick(KICK_V)), kickC = pattern(rng.weighted(KICK_C, [4, 3, 3]));
    const ghostsV = rng.pick(GHOSTS), ghostsC = rng.pick(GHOSTS);
    const bassV = rng.pick(BASS_V), bassC = rng.pick(BASS_C), bassH = rng.pick(BASS_HALF);
    const introType = rng.chance(0.5) ? 'clav' : 'drums';
    const preStop = rng.chance(0.5);
    const verse2Drop = rng.chance(0.75);
    const leadWave = rng.chance(0.55) ? 'square' : 'saw';
    const leadCut = leadWave === 'square' ? 1700 : 1500;
    const leadLevel = leadWave === 'square' ? 1.2 : 2; // the filtered saw measures ~4.5 dB softer than the square
    const kickTune = rng.range(54, 60);
    const snareTone = rng.range(185, 200);

    // ---------------------------------------------------------------- part writers
    const clavBar = (bi: number, pat: string, vel: number, vary4 = true) => {
      const p = plan[bi];
      let s = pat;
      if (vary4 && p.inSec % 4 === 3 && rng.chance(0.7)) {
        // bar 4 of a phrase: move one ghost / add a push
        const a = s.split('');
        const gi = a.indexOf('o');
        if (gi >= 0) a[gi] = '-';
        const free = a.map((c, i) => (c === '-' && i > 8 ? i : -1)).filter((i) => i >= 0);
        if (free.length) a[rng.pick(free)] = 'x';
        s = a.join('');
      }
      for (let st = 0; st < 16; st++) {
        const ch = s[st];
        if (ch === '-' || ch === undefined) continue;
        const v = slotAt(bi, st).clav;
        const notes = ch === 'X' ? v : ch === 'x' ? v.slice(1) : [v[1]];
        p.clav.push({ step: st, len: ch === 'o' ? 0.35 : ch === 'X' ? 1.1 : 0.85, notes, vel: humVel(rng, (ch === 'X' ? 0.62 : ch === 'x' ? 0.54 : 0.3) * vel, 0.04) });
      }
    };
    const toneOf = (sym: string, c: Chord, root: number): number => {
      const has = (iv: number) => c.tones.includes(iv);
      switch (sym) {
        case 'O': return root + 12;
        case '5': return root + (has(6) && !has(7) ? 6 : 7);
        case '7': return root + (has(10) ? 10 : 9);
        case '3': return root + (has(3) ? 3 : has(4) ? 4 : 5);
        case 'Q': return root + 5;
        default: return root;
      }
    };
    const bassNotes = (bi: number, pat: readonly BN[], offset: number, vel = 1) => {
      const p = plan[bi];
      let prev = slotAt(bi, offset).root;
      for (const [st0, len, sym, kind] of pat) {
        const st = st0 + offset;
        const slot = slotAt(bi, st);
        let m: number;
        if (sym === 'A') {
          const nr = bassNote(nextChordAfter(bi, st), 31);
          m = rng.weighted([nr - 1, nr + 1, nr - 5 >= 31 ? nr - 5 : nr + 7], [5, 3, 2]);
          if (m < 31) m += 12;
        } else if (sym === 'x') m = prev;
        else m = toneOf(sym, slot.chord, slot.root);
        prev = m;
        const v = kind === 'T' ? 0.72 : kind === 'P' ? 0.66 : 0.3;
        p.bass.push({ step: st, len: kind === 'x' ? 0.45 : len, midi: m, vel: humVel(rng, v * vel, 0.05), pop: kind === 'P' });
      }
    };
    const bassBar = (bi: number, pat: readonly BN[], vel = 1, fill?: readonly BN[]) => {
      const p = plan[bi];
      if (p.slots.length > 1) {
        bassNotes(bi, bassH, 0, vel);
        bassNotes(bi, bassH, 8, vel);
      } else bassNotes(bi, pat, 0, vel);
      if (fill) {
        p.bass = p.bass.filter((e) => e.step < 12);
        bassNotes(bi, fill, 0, vel);
      }
    };
    interface Groove {
      kick: number[] | null;
      snare: boolean;
      ghosts: number[];
      hat: 'none' | 'eighth' | 'soft8' | 'sixteenth' | 'disco' | 'chorus';
      clap: boolean;
      tamb: 'none' | 'eighth' | 'sixteenth';
      rim: boolean;
    }
    const drums = (bi: number, g: Groove, vel = 1) => {
      const p = plan[bi];
      g.kick?.forEach((v, st) => v > 0 && p.kick.push({ step: st, vel: humVel(rng, (v >= 1 ? 0.8 : v >= 0.7 ? 0.64 : 0.45) * vel, 0.04) }));
      if (g.snare) for (const st of [4, 12]) p.snare.push({ step: st, vel: humVel(rng, 0.7 * vel, 0.04) });
      if (g.rim) for (const st of [4, 12]) p.rim.push({ step: st, vel: humVel(rng, 0.42 * vel, 0.04) });
      for (const st of g.ghosts) if (rng.chance(0.62)) p.snare.push({ step: st, vel: humVel(rng, 0.2, 0.05) });
      if (g.clap) for (const st of [4, 12]) p.clap.push({ step: st, vel: humVel(rng, 0.62 * vel, 0.05) });
      for (let st = 0; st < 16; st++) {
        const beat = st % 4 === 0, eighth = st % 2 === 0;
        let v = 0, x: number | undefined;
        switch (g.hat) {
          case 'eighth': v = eighth ? (beat ? 0.3 : 0.25) : 0; break;
          case 'soft8': v = eighth ? (beat ? 0.22 : 0.18) : 0; break;
          case 'sixteenth':
            v = beat ? 0.32 : eighth ? 0.27 : 0.15;
            if (st === 14 && p.inSec % 2 === 1) (x = 0.11), (v = 0.28);
            break;
          case 'chorus':
            v = beat ? 0.32 : eighth ? 0.27 : 0.15;
            if (st === 6 || st === 14) (x = 0.1), (v = 0.27);
            break;
          case 'disco':
            if (beat) v = 0.28;
            else if (eighth) (v = 0.3), (x = 0.13);
            break;
        }
        if (v > 0) p.hat.push({ step: st, vel: humVel(rng, v * vel, 0.035), x });
        if (g.tamb === 'sixteenth') p.tamb.push({ step: st, vel: humVel(rng, st === 4 || st === 12 ? 0.34 : beat ? 0.2 : eighth ? 0.2 : 0.12, 0.03) });
        else if (g.tamb === 'eighth' && eighth) p.tamb.push({ step: st, vel: humVel(rng, beat ? 0.16 : 0.24, 0.03) });
      }
    };
    type FillKind = 'snare' | 'tom' | 'mix' | 'roll' | 'short';
    const fill = (bi: number, kind: FillKind, vel = 1) => {
      const p = plan[bi];
      const from = kind === 'roll' ? 8 : kind === 'short' ? 13 : 12;
      p.hat = p.hat.filter((h) => h.step < from);
      p.snare = p.snare.filter((s) => s.step < from);
      p.kick = p.kick.filter((k) => k.step < from);
      p.tamb = p.tamb.filter((k) => k.step < from);
      const sn = (st: number, v: number) => p.snare.push({ step: st, vel: humVel(rng, v * vel, 0.03) });
      const tm = (st: number, v: number, x: number) => p.tom.push({ step: st, vel: humVel(rng, v * vel, 0.03), x });
      switch (kind) {
        case 'snare': [12, 13, 14, 15].forEach((st, i) => sn(st, 0.32 + 0.08 * i)); break;
        case 'tom': sn(12, 0.55), tm(13, 0.44, 2), tm(14, 0.48, 1), tm(15, 0.52, 0); break;
        case 'mix': sn(12, 0.5), sn(13, 0.28), tm(14, 0.46, 1), tm(15, 0.5, 0); break;
        case 'roll': for (let st = 8; st < 16; st++) sn(st, 0.16 + 0.05 * (st - 8)); break;
        case 'short': sn(13, 0.3), sn(14, 0.4), sn(15, 0.48); break;
      }
      p.kick.push({ step: 15, vel: 0.5 * vel });
    };
    const pickFill = (): FillKind => rng.weighted<FillKind>(['snare', 'tom', 'mix', 'short'], [3, 3, 3, 1]);

    const G_VERSE = (k: number[]): Groove => ({ kick: k, snare: true, ghosts: ghostsV, hat: 'sixteenth', clap: false, tamb: 'none', rim: false });
    const G_CHORUS: Groove = { kick: kickC, snare: true, ghosts: ghostsC.slice(0, 2), hat: kickC[4] > 0 ? 'disco' : 'chorus', clap: true, tamb: 'sixteenth', rim: false };

    // ---------------------------------------------------------------- write every section
    for (const s of FORM) {
      const b0 = s.start;
      const last = b0 + s.bars - 1;
      switch (s.kind) {
        case 'intro': {
          for (let i = 0; i < 8; i++) {
            const bi = b0 + i;
            if (introType === 'clav') {
              clavBar(bi, clavV, i < 2 ? 0.85 : 1);
              if (i >= 2) drums(bi, { ...G_VERSE(kickV1), ghosts: i >= 4 ? ghostsV : [], hat: 'sixteenth' }, i < 4 ? 0.9 : 1);
              else drums(bi, { kick: null, snare: false, ghosts: [], hat: i === 0 ? 'soft8' : 'eighth', clap: false, tamb: 'none', rim: false });
              if (i >= 4) bassBar(bi, bassV);
            } else {
              drums(bi, { ...G_VERSE(kickV1), ghosts: i >= 2 ? ghostsV : [] }, i < 2 ? 0.9 : 1);
              if (i >= 2) bassBar(bi, bassV, i < 4 ? 0.9 : 1);
              if (i >= 4) clavBar(bi, clavV, 1);
            }
          }
          if (introType === 'clav') {
            fill(b0 + 3, 'short', 0.9);
            // bass pickup into bar 5
            bassNotes(b0 + 3, [[13, 1, '5', 'T'], [14, 1, '7', 'T'], [15, 1, 'A', 'T']], 0, 0.9);
          } else fill(b0 + 1, 'short', 0.9);
          plan[b0 + 4].crash = 0.24;
          brassFig(b0 + 5, figA, 0.52);
          brassFig(b0 + 7, figB, 0.56);
          fill(last, pickFill());
          break;
        }
        case 'verse': {
          const amt = s.n === 0 ? 0.55 : 1;
          const kick = s.n === 0 ? kickV1 : kickV2;
          for (let i = 0; i < 16; i++) {
            const bi = b0 + i;
            const drop = s.n === 1 && verse2Drop && i < 4;
            if (!drop) clavBar(bi, clavV, 1);
            bassBar(bi, bassV, 1, i % 4 === 3 && i < 15 && rng.chance(0.45) ? rng.pick(BASS_FILLS) : undefined);
            drums(bi, { ...G_VERSE(kick), ghosts: drop ? [] : ghostsV, tamb: s.n === 1 && i >= 8 ? 'eighth' : 'none' });
            // second half of verse 2: a soft Rhodes bed joins
            if (s.n === 1 && i >= 8) {
              const p = plan[bi];
              for (const sl of p.slots) p.epiano.push({ step: sl.step, len: p.slots.length > 1 ? 7 : 10, notes: sl.ep, vel: 0.3 });
              if (p.slots.length === 1) p.epiano.push({ step: 10, len: 5, notes: p.slots[0].ep, vel: 0.24 });
            }
            if (i % 4 === 3 && i < 15 && rng.chance(0.35)) fill(bi, 'short', 0.8);
          }
          if (s.n === 0) plan[b0].crash = 0.22;
          for (let ph = 0; ph < 4; ph++) {
            const pb = b0 + ph * 4;
            const up = ph === 2 ? dev : 0;
            const open = (ph + s.n) % 2 === 0;
            place(ph === 0 && s.n === 0 ? call : vary(call, amt), pb, vt, 'dorian', 0.66, up);
            place(open ? tailOpen : TAIL_LOW, pb + 1, vt, 'dorian', 0.64);
            place(ph === 3 ? frag(call) : vary(call, amt), pb + 2, vt, 'dorian', 0.66, seq + up);
            place(ph === 3 ? END_LEADIN : ph % 2 === 0 ? endB : endA, pb + 3, vt, 'dorian', 0.64);
            if (s.n > 0 || ph > 0) brassFig(pb + 1, s.n > 0 && ph % 2 ? figC : figA, 0.54);
            if (ph < 3) brassFig(pb + 3, figB, 0.56);
          }
          brassRun(last, 0.46);
          fill(last, pickFill());
          break;
        }
        case 'pre': {
          for (let i = 0; i < 4; i++) {
            const bi = b0 + i;
            const p = plan[bi];
            clavBar(bi, CLAV_PRE, 0.95, false);
            bassBar(bi, BASS_PUMP, 0.92 + 0.03 * i);
            drums(bi, { kick: pattern('X---X---X---X---'), snare: true, ghosts: [], hat: 'disco', clap: false, tamb: 'none', rim: false }, 0.92 + 0.03 * i);
            for (const sl of p.slots) p.strings.push({ step: sl.step, len: 16 / p.slots.length + 1, notes: sl.str, vel: 0.24 + 0.05 * i, att: 0.5 });
            place(preMel[i], bi, ct, 'major', 0.58 + 0.015 * i);
          }
          plan[b0 + 2].sweep = [8, 0.3];
          plan[last].swell = 0.26;
          plan[last].brass.push({ step: 0, len: 6, notes: slotAt(last, 0).brass, vel: 0.4 });
          if (preStop) {
            // band stops on beat 4: one tutti hit, then only the lead pickup + cymbal swell
            const p = plan[last];
            fill(last, 'roll');
            p.snare = p.snare.filter((x) => x.step < 12);
            p.kick = p.kick.filter((x) => x.step < 12);
            p.hat = p.hat.filter((x) => x.step < 12);
            p.clav = p.clav.filter((x) => x.step < 12);
            p.bass = p.bass.filter((x) => x.step < 12);
            p.snare.push({ step: 12, vel: 0.55 });
            p.kick.push({ step: 12, vel: 0.7 });
            p.clav.push({ step: 12, len: 1.4, notes: slotAt(last, 12).clav, vel: 0.62 });
            p.bass.push({ step: 12, len: 2, midi: slotAt(last, 12).root + 12, vel: 0.7, pop: true });
            p.brass.push({ step: 12, len: 2, notes: slotAt(last, 12).brass, vel: 0.6 });
          } else {
            fill(last, 'roll');
            brassFig(last, [[12, 1], [14, 2]], 0.58);
          }
          break;
        }
        case 'chorus':
        case 'final': {
          const fin = s.kind === 'final';
          const tonic = fin ? ft : ct;
          for (let i = 0; i < s.bars; i++) {
            const bi = b0 + i;
            const p = plan[bi];
            clavBar(bi, clavC, 0.95);
            bassBar(bi, bassC, 1, i % 8 === 7 ? rng.pick(BASS_FILLS) : undefined);
            drums(bi, G_CHORUS, fin ? 1.03 : 1);
            for (const sl of p.slots) p.strings.push({ step: sl.step, len: 16 / p.slots.length + 0.5, notes: sl.str, vel: fin ? 0.4 : 0.37 });
            if (i % 8 === 7) fill(bi, pickFill());
            else if (i % 4 === 3 && rng.chance(0.5)) fill(bi, 'short', 0.85);
          }
          const amt = s.n === 0 && !fin ? 0.4 : 0.8;
          // (brass-led second half of the last chorus)
          for (let half = 0; half < s.bars / 8; half++) {
            const hb = b0 + half * 8;
            const brassLead = fin && half === 1;
            const to = brassLead ? 'brass' : 'lead';
            const hv = brassLead ? 0.6 : 0.62;
            place(half === 0 && s.n === 0 && !fin ? hook : vary(hook, amt), hb, tonic, 'major', hv, 0, to);
            place(hookTail, hb + 1, tonic, 'major', hv - 0.02, 0, to);
            place(vary(hook, amt), hb + 2, tonic, 'major', hv, hSeq, to);
            place(HOOK_UP, hb + 3, tonic, 'major', hv, 0, to);
            place(vary(hook, amt), hb + 4, tonic, 'major', hv, 0, to);
            place(hookTail2, hb + 5, tonic, 'major', hv - 0.02, 0, to);
            place(vary(hook, amt), hb + 6, tonic, 'major', hv, hSeq, to);
            place(hookClose, hb + 7, tonic, 'major', hv, 0, to);
            plan[hb].crash = fin ? 0.3 : 0.28;
            if (!brassLead) plan[hb].brass.push({ step: 0, len: 2, notes: slotAt(hb, 0).brass, vel: 0.56 });
            if (brassLead) {
              // lead answers the brass
              for (const k of [1, 3, 5]) place(rng.pick(LICKS), hb + k, tonic, 'major', 0.56);
            } else {
              for (const k of [1, 3, 5]) brassFig(hb + k, k === 3 ? figB : figC, 0.55);
              brassFig(hb + 7, [[10, 1], [12, 2]], 0.57);
            }
          }
          if (!fin) plan[last].brass.push({ step: 14, len: 2, notes: slotAt(last, 14).brass, vel: 0.5 });
          break;
        }
        case 'inter': {
          for (let i = 0; i < 4; i++) {
            const bi = b0 + i;
            clavBar(bi, clavV, 1);
            bassBar(bi, bassV);
            drums(bi, { ...G_VERSE(kickV1), tamb: 'eighth' });
            const p = plan[bi];
            if (i % 2 === 0) for (const sl of p.slots) p.epiano.push({ step: sl.step, len: 6, notes: sl.ep, vel: 0.38 });
          }
          // the verse call goes to the brass, the lead answers
          place(call, b0, vt, 'dorian', 0.58, 0, 'brass');
          place(tailOpen, b0 + 1, vt, 'dorian', 0.56, 0, 'brass');
          place(vary(call, 0.6), b0 + 2, vt, 'dorian', 0.58, seq, 'brass');
          place(endA, b0 + 3, vt, 'dorian', 0.56, 0, 'brass');
          place(rng.pick(LICKS), b0 + 1, vt, 'dorian', 0.54);
          place(rng.pick(LICKS), b0 + 3, vt, 'dorian', 0.54);
          fill(last, pickFill());
          break;
        }
        case 'bridge': {
          for (let i = 0; i < 8; i++) {
            const bi = b0 + i;
            const p = plan[bi];
            clavBar(bi, CLAV_SPARSE, 0.9, false);
            bassBar(bi, i < 4 ? bassC : bassV, 0.95);
            if (i < 4) drums(bi, { kick: pattern('X-----x---x-----'), snare: false, ghosts: [], hat: 'soft8', clap: false, tamb: 'none', rim: true });
            else drums(bi, { ...G_VERSE(kickV1), ghosts: ghostsV.slice(0, 1), hat: 'eighth' }, 0.92);
            for (const sl of p.slots) {
              p.epiano.push({ step: sl.step, len: 6, notes: sl.ep, vel: 0.4 });
              if (p.slots.length === 1) p.epiano.push({ step: rng.pick([6, 10]), len: 4, notes: sl.ep, vel: 0.34 });
              if (i >= 4) p.strings.push({ step: sl.step, len: 16 / p.slots.length + 0.5, notes: sl.str, vel: 0.27, att: 0.8 });
            }
          }
          // the call in augmentation over the new changes
          place(augment(call), b0 + 4, vt, 'dorian', 0.56);
          place(augment(call), b0 + 6, vt, 'dorian', 0.56, seq);
          brassRun(last, 0.46);
          fill(last, 'snare', 0.9);
          break;
        }
        case 'build': {
          for (let i = 0; i < 4; i++) {
            const bi = b0 + i;
            const p = plan[bi];
            const v = 0.84 + 0.06 * i;
            clavBar(bi, CLAV_BUILD, v, false);
            bassBar(bi, BASS_PUMP, v);
            drums(bi, { kick: pattern('X---X---X---X---'), snare: i < 2, ghosts: [], hat: 'sixteenth', clap: i >= 2, tamb: i >= 2 ? 'eighth' : 'none', rim: false }, v);
            if (i === 2) for (let st = 0; st < 16; st += 2) p.snare.push({ step: st, vel: humVel(rng, st % 4 ? 0.26 : 0.36, 0.03) });
            p.brass.push({ step: 0, len: 10, notes: p.slots[0].brass, vel: 0.36 + 0.05 * i });
            place([[0, 14, [1, 3, 4, 5][i], 'g']], bi, ft, 'major', 0.52 + 0.03 * i);
          }
          plan[b0].strings.push({ step: 0, len: 64, notes: plan[b0].slots[0].str, vel: 0.42, att: 6 });
          fill(last, 'roll', 1.05);
          plan[b0].sweep = [16, 0.34];
          plan[last].swell = 0.3;
          break;
        }
        case 'outro': {
          for (let i = 0; i < 3; i++) {
            const bi = b0 + i;
            const p = plan[bi];
            clavBar(bi, clavC, 0.95 - 0.04 * i);
            bassBar(bi, bassC, 1 - 0.03 * i);
            drums(bi, { ...G_CHORUS, tamb: i < 2 ? 'sixteenth' : 'eighth' }, 1 - 0.04 * i);
            if (i < 2) for (const sl of p.slots) p.strings.push({ step: sl.step, len: 16 / p.slots.length + 0.5, notes: sl.str, vel: 0.27 });
          }
          place(vary(hook, 0.5), b0, ft, 'major', 0.6);
          place(hookClose, b0 + 1, ft, 'major', 0.58);
          brassFig(b0 + 1, figC, 0.54);
          brassFig(b0 + 2, figA, 0.52);
          // bar 4: band hits on the ii-V, toms into the final chord
          const hb = b0 + 3;
          const ph = plan[hb];
          for (const st of [0, 3, 6, 10]) {
            const sl = slotAt(hb, st);
            const v = st === 10 ? 0.6 : 0.55;
            ph.brass.push({ step: st, len: st === 6 ? 2 : 1.5, notes: sl.brass, vel: v });
            ph.clav.push({ step: st, len: 1.1, notes: sl.clav, vel: 0.6 });
            ph.bass.push({ step: st, len: 1.5, midi: sl.root + (st === 3 ? 12 : 0), vel: 0.72, pop: st === 3 });
            ph.kick.push({ step: st, vel: 0.7 });
            ph.snare.push({ step: st, vel: 0.42 });
            ph.hat.push({ step: st, vel: 0.26 });
          }
          [0.34, 0.4, 0.46, 0.52].forEach((v, k) => ph.tom.push({ step: 12 + k, vel: v, x: 2 - Math.min(2, k) }));
          plan[b0 + 4].final = true;
          break;
        }
      }
    }

    // ---------------------------------------------------------------- dynamics, tempo, mix
    const dynamics = (s: Sec, x: number): number => {
      switch (s.kind) {
        case 'intro': return 0.8 + 0.1 * x;
        case 'verse': return s.n === 0 ? 0.86 : 0.9;
        case 'pre': return 0.9 + 0.1 * x;
        case 'chorus': return 1;
        case 'inter': return 0.94;
        case 'bridge': return 0.84;
        case 'build': return 0.86 + 0.12 * x;
        case 'final': return 1.03;
        case 'outro': return 1 - 0.05 * x;
      }
    };
    const tempo = (bar: number) => {
      const r = bar - (total - 3);
      return r < 0 ? bpm : bpm * [0.97, 0.93, 0.9][r];
    };
    let hatV: NoiseVoice | null = null, tambV: NoiseVoice | null = null;
    const setup = (t0: number, player: { endTime: number }) => {
      inst.mix('kick', { level: 0.5, highpass: 32 });
      inst.mix('snare', { level: 0.76, reverb: 0.17 });
      inst.mix('clap', { level: 0.72, reverb: 0.24 });
      inst.mix('rim', { level: 0.7 });
      inst.mix('tom', { level: 0.6, reverb: 0.16 });
      inst.mix('hat', { level: 0.75, pan: 0.34, lowpass: 12500 });
      inst.mix('shaker:tamb', { level: 0.42, pan: -0.4, lowpass: 11000 });
      inst.mix('cymbal', { level: 0.5 });
      inst.mix('sweep', { level: 0.45 });
      inst.mix('bass', { level: 0.78, highpass: 38, reverb: 0.02 });
      inst.mix('slap', { level: 0.75, lowpass: 4200, reverb: 0.04 });
      inst.mix('clav', { level: 1.05, pan: 0.36, lowpass: introType === 'clav' ? 1600 : 2400, reverb: 0.12, delay: 0.06 });
      inst.mix('lead', { level: leadLevel, pan: 0.03, reverb: 0.22, delay: 0.12 });
      inst.mix('brass', { level: 1.1, pan: -0.3, reverb: 0.24 });
      inst.mix('strings', { level: 1.5, lowpass: 5000, reverb: 0.4 });
      inst.mix('epiano', { level: 0.8, pan: -0.3, reverb: 0.24, tremolo: 0.35 });
      inst.setDelay({ beats: 0.75, feedback: 0.24, tone: 2600 });
      const end = player.endTime;
      hatV = new NoiseVoice(env, 'hat', inst.channel('hat').input, t0, end, 0.45, 0.3);
      tambV = new NoiseVoice(env, 'shaker', inst.channel('shaker:tamb').input, t0, end, 0.3, 1.1);
    };

    // final chord: I 6/9 on the band, strings + Rhodes ring out
    const ending = (b: BarInfo) => {
      const t = b.t;
      const sl = plan[b.bar].slots[0];
      const c = sl.chord;
      const sec = (beats: number) => b.beatsToSec(beats);
      inst.brass(t + 0.005, voicing(c, { lo: 60, hi: 79, count: 4 }), 0.9, 0.56);
      inst.strings(t, voicing(c, { lo: 55, hi: 79, count: 4 }), sec(8), 0.36, { attack: 0.25, release: 2.6, cutoff: 3200 });
      voicing(c, { lo: 52, hi: 76, count: 5, rootless: false }).forEach((m, j) => inst.epiano(t + 0.03 + j * 0.035, m, sec(8), 0.42 + j * 0.015));
      inst.clav(t, sl.clav[sl.clav.length - 1], 0.2, 0.5, { bright: 0.35 });
      inst.slap(t, sl.root, sec(5), 0.72);
      inst.kick(t, 0.72, { tune: kickTune, decay: 0.45, click: 0.3 });
      inst.cymbal(t + 0.01, 0.28, { decay: 3.5 });
      const top = chordTones(c, 76, 88);
      inst.lead(t + sec(1), top[Math.min(1, top.length - 1)] ?? ft + 14, sec(5), 0.44, { wave: leadWave, cutoff: leadCut, reso: 1.2, detune: 6, vibrato: 13 });
    };

    return song(env, {
      bpm,
      tempo,
      swing,
      swingUnit: 16,
      sections: FORM.map((s) => ({ name: s.name, bars: s.bars })),
      tail: 5,
      setup,
      onStop(t, fade) {
        hatV?.stop(t + fade);
        tambV?.stop(t + fade);
      },
      bar(b: BarInfo) {
        const p = plan[b.bar];
        const dyn = dynamics(p.sec, b.sectionProgress);
        const S = (st: number) => b.at(st / 4);
        const L = (len: number) => b.beatsToSec(len / 4);
        const end = b.t + b.dur;
        // intro filter opening on the clav
        if (p.sec.kind === 'intro') {
          const i0 = introType === 'clav' ? 0 : 4;
          const k = p.inSec - i0;
          const lp0 = introType === 'clav' ? 1600 : 2400;
          if (k >= 0 && k < 4) for (let h = 0; h < 2; h++) inst.mix('clav', { lowpass: lp0 * Math.pow(5800 / lp0, (k * 2 + h + 1) / 8) }, b.at(h * 2));
        }
        if (p.final) ending(b);
        // --- lead
        for (const e of p.lead) {
          const d = Math.max(0.1, L(e.len) * 0.9);
          inst.lead(humanize(rng, S(e.step), 6) + 0.004, e.midi, d, e.vel * dyn, { wave: leadWave, cutoff: leadCut, reso: 1.3, detune: d > 0.4 ? 6 : 0, vibrato: d > 0.45 ? 11 : 0, glideFrom: e.glide, glideTime: 0.07 });
        }
        // --- brass
        for (const h of p.brass) inst.brass(humanize(rng, S(h.step), 5), h.notes, Math.max(0.12, L(h.len) * 0.8), h.vel * dyn);
        // --- clav
        for (const h of p.clav) {
          const t = humanize(rng, S(h.step), 4);
          h.notes.forEach((m, j) => inst.clav(t + j * 0.004, m, Math.max(0.05, L(h.len)), h.vel * dyn * (j === h.notes.length - 1 ? 1.05 : 1), { bright: 0.35 }));
        }
        // --- bass
        for (const e of p.bass) {
          const t = humanize(rng, S(e.step), 4), d = Math.max(0.06, L(e.len) * 0.92), v = e.vel * Math.sqrt(dyn);
          if (e.pop) inst.slap(t, e.midi, d, v);
          else inst.bass(t, e.midi, d, v);
        }
        // --- strings / Rhodes
        for (const h of p.strings) inst.strings(S(h.step), h.notes, L(h.len), h.vel * dyn, { attack: h.att ?? 0.35, release: 0.9, cutoff: 3600 });
        for (const h of p.epiano) {
          const t = humanize(rng, S(h.step), 6);
          h.notes.forEach((m, j) => inst.epiano(t + j * 0.012, m, L(h.len), h.vel * dyn));
        }
        // --- drums
        const dd = Math.sqrt(dyn);
        for (const d of p.kick) inst.kick(humanize(rng, S(d.step), 3), d.vel * dd, { tune: kickTune, decay: 0.3, click: d.vel >= 0.7 ? 0.4 : 0 });
        for (const d of p.snare) inst.snare(humanize(rng, S(d.step), 3), d.vel * dd, { tone: snareTone, snappy: 0.78 });
        for (const d of p.clap) inst.clap(humanize(rng, S(d.step), 3) + 0.004, d.vel * dd);
        for (const d of p.rim) inst.rim(humanize(rng, S(d.step), 3), d.vel * dd);
        for (const d of p.tom) inst.tom(humanize(rng, S(d.step), 3), d.vel * dd, { pitch: d.x === 2 ? 'high' : d.x === 1 ? 'mid' : 'low' });
        const hats = [...p.hat].sort((a, c) => a.step - c.step);
        hats.forEach((h, i) => {
          const t = humanize(rng, S(h.step), 2.5);
          const tn = i + 1 < hats.length ? S(hats[i + 1].step) : end;
          const v = h.vel * dd;
          hatV?.hit(t, v, 0.0008, 0.035 + 0.03 * v, h.x ?? 0, tn - t - 0.006);
        });
        p.tamb.forEach((h, i) => {
          const t = humanize(rng, S(h.step), 3);
          const tn = i + 1 < p.tamb.length ? S(p.tamb[i + 1].step) : end;
          tambV?.hit(t, h.vel * dd, 0.004, 0.065, 0, tn - t - 0.005);
        });
        if (p.crash > 0) inst.cymbal(b.t + 0.005, p.crash, { decay: 2.2 });
        if (p.swell > 0) inst.cymbal(end, p.swell, { swell: Math.min(1.6, b.dur * 0.7) });
        if (p.sweep) inst.sweep(b.t, b.beatsToSec(p.sweep[0]), p.sweep[1], { up: true, from: 400, to: 6000, q: 2 });
      },
    });
  },
};
