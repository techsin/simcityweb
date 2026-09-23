/**
 * "Neon Skyline" - night-drive synthwave / 80s city-pop (Metropolis soundtrack).
 *
 * A mono sequencer arp (8ths with a dotted-8th ping-pong in the verses, 16ths in the builds and choruses), lush
 * detuned saw pads that pump softly against the kick in the choruses, a driving 8th-note synth bass (roots, octave
 * pops), gated-reverb snare + clap backbeat, Simmons-style tom fills and snare-roll builds at section ends, a soft
 * square lead for the verse / pre-chorus lines, a singing detuned saw lead with glide and vibrato for the chorus
 * hook, DX bell and Rhodes colours in the breakdown and a held final chord.
 *
 * Form (one of two per seed, ~4:00-4:30 at 93-99 bpm):
 *   intro 8 | verse 16 | pre 8 | chorus 16 | verse 8 | pre 8 | chorus 8 | breakdown 8 | final chorus 16 | outro 8
 *   intro 8 | verse 16 | pre 8 | chorus 16 | breakdown 8 | verse 8 | pre 8 | final chorus 16 | outro 8
 * Minor key (aeolian) verses on i-VI-III-VII colours, a rising iv-v-VI-VII pre-chorus, choruses that lift to the
 * relative major (IV-V-I-vi), a breakdown with a borrowed bII (lydian Bbmaj7#11 in A minor), an optional 80s key
 * change (+1 / +2) for the final chorus, and an ending on the tonic minor 9 or a Picardy major (add9).
 *
 * The chorus hook (one of three composed 6-bar hooks: motif, repeat, climb) ends with a half cadence the first time
 * and a full cadence the second; later choruses vary it (anticipations, turns, passing tones) and the final chorus
 * adds a harmony line under the long notes. The bell foreshadows the hook in the intro, the breakdown plays it in
 * augmentation and the outro quotes it once more before the last note.
 * Every play re-rolls: key, tempo, form, verse / chorus / breakdown charts, hook, verse motif, cadences, arp patterns
 * and waveform, bass and kick patterns, fills, rolls, the key change and the final chord.
 * The plan is computed in create(); bar() only schedules it.
 */
import type { RNG } from '../../../core/rng';
import type { MusicTrack } from '../types';
import { song, type BarInfo } from '../song';
import { parseChart, voiceLead, voicing, bassNote, humanize, humVel, pc, type Chord } from '../theory';
import { monoBass, monoArp, makeGatedSnare, type MonoNote, type MonoBassOpts } from './neon_skyline_fx';

type Kind = 'intro' | 'verse' | 'pre' | 'chorus' | 'break' | 'final' | 'outro';
interface Sec {
  name: string;
  kind: Kind;
  bars: number;
  start: number;
  next: Sec | null;
}

const FORMS: [string, Kind, number][][] = [
  [['intro', 'intro', 8], ['verse 1', 'verse', 16], ['pre-chorus 1', 'pre', 8], ['chorus 1', 'chorus', 16], ['verse 2', 'verse', 8], ['pre-chorus 2', 'pre', 8], ['chorus 2', 'chorus', 8], ['breakdown', 'break', 8], ['final chorus', 'final', 16], ['outro', 'outro', 8]],
  [['intro', 'intro', 8], ['verse 1', 'verse', 16], ['pre-chorus 1', 'pre', 8], ['chorus 1', 'chorus', 16], ['breakdown', 'break', 8], ['verse 2', 'verse', 8], ['pre-chorus 2', 'pre', 8], ['final chorus', 'final', 16], ['outro', 'outro', 8]],
];

// ---------------------------------------------------------------------------------------------- harmony (A minor)
const VERSE_CHARTS = [
  'Am9 | Fmaj9 | Cmaj7 | G6 | Am9 | Fmaj9 | Cmaj7 | Gsus4 G',
  'Am9 | Am9/G | Fmaj9 | Esus4 E | Am9 | Am9/G | Fmaj9 | G6',
  'Am9 | Fmaj9 | G6 | Em7 | Am9 | Fmaj9 | G6 | Esus4 E',
];
interface ChorusChart {
  body: string;
  half: string;
  full: string;
  /** the pre-chorus that sets this chorus up (its last chord leads into body[0]) */
  pre: string;
  /** last bar of a breakdown before this chorus / a verse */
  brk: string;
}
const CHORUS_CHARTS: ChorusChart[] = [
  { body: 'Fmaj7 | G6 | Cmaj7 | Am7 | Fmaj7 | G6', half: 'Esus4 | E', full: 'Dm9 Em7 | Am9', pre: 'Dm9 | Em7 | Fmaj9 | Gsus4 G | Dm9 | Em7 | Fmaj9 | Esus4 E', brk: 'Esus4 E' },
  { body: 'Cmaj7 | G6/B | Am9 | Fmaj7 | Cmaj7 | G6/B', half: 'Fmaj7 | Gsus4 G', full: 'Fmaj7 G6 | Am9', pre: 'Fmaj7 | G6 | Em7 | Am9 | Dm9 | Em7 | Fmaj9 | Gsus4 G', brk: 'Gsus4 G' },
  { body: 'Fmaj9 | G6 | Em7 | Am9 | Fmaj9 | G6', half: 'Esus4 | E', full: 'Em7 | Am9', pre: 'Dm9 | Em7 | Fmaj9 | Gsus4 G | Dm9 | Em7 | Fmaj9 | Esus4 E', brk: 'Esus4 E' },
];
const BREAK_CHARTS = ['Fmaj9 | Em7 | Dm9 | Cmaj9 | Bbmaj7#11 | Am9 | Dm9', 'Dm9 | Am9 | Bbmaj9 | Fmaj9 | Dm9 | Cmaj9 | Bbmaj7#11'];
const OUTRO_CHART = 'Fmaj9 | G6 | Am9 | Am9/G | Fmaj9 | G6';

// ---------------------------------------------------------------------------------------------- melody material
/** [bar, beat, dur (beats), scale degree]; degree 0 = tonic in octave 4 (aeolian), negative bar = pickup */
type Tpl = readonly (readonly [number, number, number, number])[];
const AEOL = [0, 2, 3, 5, 7, 8, 10];

/** chorus hooks, 6 bars each (motif, answer, climb, resolution, motif again, climb into the cadence) */
const HOOKS: Tpl[] = [
  // "Skyline": syncopated fall E-D-C-D-E~, leap to G, settle on C, again, then climb
  [
    [-1, 3, 0.5, 2], [-1, 3.5, 0.5, 3],
    [0, 0, 1.5, 4], [0, 1.5, 0.5, 3], [0, 2, 1, 2], [0, 3, 0.5, 3], [0, 3.5, 2.5, 4],
    [1, 2, 1, 3], [1, 3, 0.5, 1], [1, 3.5, 2, 6],
    [2, 2, 1, 4], [2, 3, 1, 3],
    [3, 0, 2.5, 2], [3, 2.5, 0.5, 1], [3, 3, 0.5, 2], [3, 3.5, 0.5, 3],
    [4, 0, 1.5, 4], [4, 1.5, 0.5, 3], [4, 2, 1, 2], [4, 3, 0.5, 3], [4, 3.5, 2.5, 4],
    [5, 2, 0.5, 3], [5, 2.5, 0.5, 4], [5, 3, 1, 6],
  ],
  // "Neon": rising broken-chord call, falling answer, climb to the 9th
  [
    [0, 0, 0.5, 0], [0, 0.5, 0.5, 2], [0, 1, 1, 4], [0, 2, 0.5, 5], [0, 2.5, 1.5, 4],
    [1, 0, 0.5, 3], [1, 0.5, 0.5, 1], [1, 1, 2.5, 3],
    [2, 0, 0.5, 2], [2, 0.5, 0.5, 4], [2, 1, 1, 6], [2, 2, 0.5, 7], [2, 2.5, 1.5, 6],
    [3, 0, 0.5, 4], [3, 0.5, 0.5, 2], [3, 1, 2.5, 4],
    [4, 0, 0.5, 0], [4, 0.5, 0.5, 2], [4, 1, 1, 4], [4, 2, 0.5, 5], [4, 2.5, 1.5, 4],
    [5, 0, 0.5, 3], [5, 0.5, 0.5, 4], [5, 1, 1, 6], [5, 2, 2, 8],
  ],
  // "Night Drive": off-beat repeated notes (city-pop), sequence up, climb
  [
    [0, 0.5, 0.5, 4], [0, 1, 0.5, 4], [0, 1.5, 1, 5], [0, 2.5, 1.5, 4],
    [1, 0.5, 0.5, 3], [1, 1, 0.5, 3], [1, 1.5, 1, 4], [1, 2.5, 1.5, 3],
    [2, 0.5, 0.5, 6], [2, 1, 0.5, 6], [2, 1.5, 1, 7], [2, 2.5, 1, 6], [2, 3.5, 0.5, 4],
    [3, 0, 3, 4],
    [4, 0.5, 0.5, 4], [4, 1, 0.5, 4], [4, 1.5, 1, 5], [4, 2.5, 1.5, 4],
    [5, 0.5, 0.5, 3], [5, 1, 0.5, 3], [5, 1.5, 1, 4], [5, 2.5, 0.5, 6], [5, 3, 1, 7],
  ],
];
/** chorus bars 7-8, half cadence (on V / VII) */
const CAD_HALF: Tpl[] = [
  [[6, 0, 2, 7], [6, 2, 1, 8], [6, 3, 1, 7], [7, 0, 3, 6]],
  [[6, 0, 1.5, 4], [6, 1.5, 0.5, 3], [6, 2, 2, 4], [7, 0, 3, 1]],
];
/** chorus bars 7-8, full cadence (on i) */
const CAD_FULL: Tpl[] = [
  [[6, 0, 1, 4], [6, 1, 0.5, 3], [6, 1.5, 0.5, 2], [6, 2, 1, 3], [6, 3, 1, 1], [7, 0, 3.5, 2]],
  [[6, 0, 1.5, 6], [6, 1.5, 0.5, 4], [6, 2, 1, 3], [6, 3, 0.5, 2], [6, 3.5, 3.5, 0]],
  [[6, 0, 2, 2], [6, 2, 1, 1], [6, 3, 1, -1], [7, 0, 3.5, 0]],
];
/** verse motifs, 4 bars: 2-bar call + 2-bar answer (soft square lead) */
const VERSE_MOTIFS: Tpl[] = [
  [[0, 0.5, 0.5, 0], [0, 1, 0.5, 2], [0, 1.5, 1, 4], [0, 2.5, 0.5, 3], [0, 3, 1, 2], [1, 0, 3, 0],
    [2, 0.5, 0.5, -1], [2, 1, 0.5, 0], [2, 1.5, 1, 2], [2, 2.5, 1.5, 4], [3, 0, 1.5, 3], [3, 1.5, 0.5, 1], [3, 2, 2, -1]],
  [[0, 0, 0.5, 4], [0, 0.5, 0.5, 4], [0, 1, 0.5, 3], [0, 1.5, 1.5, 2], [0, 3, 0.5, 0], [0, 3.5, 0.5, 2], [1, 0, 1.5, 2], [1, 1.5, 0.5, 0], [1, 2, 2, -1],
    [2, 0, 0.5, 4], [2, 0.5, 0.5, 4], [2, 1, 0.5, 3], [2, 1.5, 1.5, 4], [2, 3, 0.5, 6], [2, 3.5, 0.5, 4], [3, 0, 3, 3]],
  [[0, 0, 1.5, 2], [0, 1.5, 0.5, 1], [0, 2, 2, 0], [1, 0.5, 0.5, -1], [1, 1, 0.5, 0], [1, 1.5, 2.5, 2],
    [2, 0, 1.5, 4], [2, 1.5, 0.5, 3], [2, 2, 2, 2], [3, 0.5, 0.5, 1], [3, 1, 0.5, 3], [3, 1.5, 2.5, 1]],
];
/** pre-chorus rhythm cells (one per bar, degree offsets from the bar's climbing target) */
const PRE_CELLS: Tpl[] = [
  [[0, 0, 3.5, 0]],
  [[0, 0, 2, 0], [0, 2, 0.5, 1], [0, 2.5, 1.5, 0]],
  [[0, 0.5, 3, 0]],
  [[0, 0, 1.5, 0], [0, 1.5, 0.5, -1], [0, 2, 2, 0]],
];

// ---------------------------------------------------------------------------------------------- rhythm material
/** arp step patterns: indexes into arpTones() = [R, 3, 5, 8, 10, 12, 7th, 9th] */
const ARP16 = [
  [0, 2, 3, 4, 0, 2, 3, 4, 0, 2, 3, 4, 0, 2, 3, 5],
  [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3],
  [0, 3, 2, 3, 1, 3, 2, 3, 0, 3, 2, 3, 7, 3, 2, 3],
  [0, 2, 6, 3, 4, 3, 6, 2, 0, 2, 7, 3, 4, 3, 7, 2],
];
const ARP8 = [
  [0, 2, 3, 4, 5, 4, 3, 2],
  [0, 3, 2, 4, 1, 3, 2, 5],
  [0, 2, 7, 3, 4, 3, 7, 2],
  [0, 2, 3, 2, 4, 2, 3, 2],
];
/** 8th-note bass offsets from the root (12 = octave pop, 7 = fifth) */
const BASS8 = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 12, 0, 0, 0, 12, 0],
  [0, 12, 0, 12, 0, 12, 0, 12],
  [0, 0, 0, 12, 0, 0, 7, 12],
];
const BASS_VEL = [0.7, 0.58, 0.65, 0.58, 0.68, 0.58, 0.65, 0.6];
const KICK_VERSE = [[0, 2], [0, 2, 2.5], [0, 1.5, 2], [0, 0.5, 2]];
const KICK_CHORUS = [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1.5, 2, 3], [0, 2, 2.5, 3.5]];
/** tom fills: [beat, pitch Hz, vel] */
const FILLS: [number, number, number][][] = [
  [[2, 200, 0.5], [2.5, 168, 0.52], [3, 138, 0.55], [3.5, 108, 0.58]],
  [[2, 200, 0.46], [2.25, 200, 0.42], [2.5, 166, 0.48], [2.75, 166, 0.45], [3, 134, 0.52], [3.25, 134, 0.49], [3.5, 104, 0.56], [3.75, 104, 0.53]],
  [[3, 190, 0.46], [3.333, 150, 0.5], [3.667, 116, 0.54]],
  [[1, 210, 0.44], [1.5, 186, 0.46], [2, 160, 0.48], [2.5, 140, 0.5], [3, 120, 0.53], [3.25, 110, 0.5], [3.5, 96, 0.56], [3.75, 90, 0.53]],
];

interface Slot {
  beat: number;
  dur: number;
  chord: Chord;
}
interface Ev {
  beat: number;
  dur: number;
  midi: number;
  vel: number;
  glide?: number;
  cut?: number;
}
interface ChordEv {
  beat: number;
  dur: number;
  notes: number[];
  vel: number;
}
interface BarPlan {
  sec: Sec;
  inSec: number;
  shift: number;
  dyn: number;
  slots: Slot[];
  pad: (ChordEv & { attack: number; cutoff: number })[];
  keys: ChordEv[];
  bass: Ev[];
  bassLong: Ev[];
  arp: Ev[];
  arp16: boolean;
  lead: Ev[];
  soft: Ev[];
  bell: Ev[];
  fill: number;
  roll: 0 | 1 | 2;
}
interface MN {
  pos: number;
  dur: number;
  deg: number;
  acc?: number;
}

const tplNotes = (t: Tpl, barOff = 0, degOff = 0): MN[] => t.map(([b, beat, dur, d]) => ({ pos: (b + barOff) * 4 + beat, dur, deg: d + degOff }));

/** melodic variation: anticipations, turns on long notes, passing tones in thirds (amount 0..1) */
function vary(rng: RNG, ns: readonly MN[], amt: number): MN[] {
  const out: MN[] = [];
  for (let i = 0; i < ns.length; i++) {
    const n = { ...ns[i] };
    const nx = ns[i + 1];
    const prev = out[out.length - 1];
    if (n.pos > 0 && n.pos % 2 === 0 && rng.chance(0.2 * amt) && (!prev || prev.pos + 0.5 <= n.pos - 0.5)) {
      n.pos -= 0.5;
      n.dur += 0.5;
      if (prev && prev.pos + prev.dur > n.pos) prev.dur = n.pos - prev.pos;
    }
    if (n.dur >= 2 && rng.chance(0.3 * amt)) {
      out.push({ ...n, dur: n.dur - 0.5 });
      out.push({ pos: n.pos + n.dur - 0.5, dur: 0.5, deg: n.deg + (rng.chance(0.5) ? 1 : -1), acc: -0.04 });
      continue;
    }
    if (nx && n.dur >= 1 && Math.abs(nx.deg - n.deg) === 2 && rng.chance(0.3 * amt)) {
      out.push({ ...n, dur: n.dur - 0.5 });
      out.push({ pos: n.pos + n.dur - 0.5, dur: 0.5, deg: (n.deg + nx.deg) / 2, acc: -0.05 });
      continue;
    }
    out.push(n);
  }
  return out;
}

/** arp tones for a chord: [R, 3rd, 5th, 8ve, 10th, 12th, 7th, 9th] with the root in D3..C#4 */
function arpTones(c: Chord): number[] {
  const ts = c.tones.map((t) => t % 12);
  const third = ts.includes(3) ? 3 : ts.includes(4) ? 4 : ts.includes(5) ? 5 : 2;
  const fifth = ts.includes(7) ? 7 : 6;
  const sev = ts.includes(10) ? 10 : ts.includes(11) ? 11 : ts.includes(9) ? 9 : 12;
  const ninth = ts.includes(2) ? 14 : 12 + fifth;
  const r = 50 + pc(c.root - 50);
  return [r, r + third, r + fifth, r + 12, r + 12 + third, r + 12 + fifth, r + sev, r + ninth];
}

/** melody note allowed on a strong beat over chord c (chord tone, 9th, 11th over minor, 6th over major) */
function okStrong(m: number, c: Chord): boolean {
  if (pc(m - c.bass) === 1) return false;
  const iv = pc(m - c.root);
  const ts = c.tones.map((t) => t % 12);
  if (ts.includes(iv)) return true;
  const minor = ts.includes(3), major = ts.includes(4), dom = major && ts.includes(10);
  if (iv === 2) return true;
  if (iv === 5) return minor;
  if (iv === 9) return major && !dom;
  return false;
}

export const track: MusicTrack = {
  id: 'neon_skyline',
  title: 'Neon Skyline',
  mood: 'Night-drive synthwave: sequencer arps, wide pads, gated drums, singing lead',
  tags: ['night', 'busy'],
  bpm: 96,
  gain: 1.06,
  create(env) {
    const { inst, rng } = env;
    const bpm = rng.int(93, 99);
    inst.bpm = bpm;
    // ------------------------------------------------------------------ key, form, material
    const tonic = rng.weighted([67, 68, 69, 70, 71, 72], [0.7, 1, 1.4, 1, 0.9, 1]); // melody degree 0: G4..C5 minor
    const tonicPc = pc(tonic);
    const T = ((tonicPc - 9 + 18) % 12) - 6; // charts are written in A minor
    let mod = rng.weighted([0, 1, 2], [0.45, 0.2, 0.35]); // final chorus key change
    while (tonic + mod > 72) mod--;
    const form = rng.pick(FORMS);
    const verseChart = rng.pick(VERSE_CHARTS);
    const ch = rng.pick(CHORUS_CHARTS);
    const brkChart = rng.pick(BREAK_CHARTS);
    const endChord = rng.chance(0.35) ? 'Aadd9' : 'Am9';
    const hook = rng.pick(HOOKS);
    const cadH = rng.pick(CAD_HALF);
    const cadF = rng.pick(CAD_FULL);
    const motifV = rng.pick(VERSE_MOTIFS);
    const arpV = rng.pick(ARP8), arpB = rng.pick(ARP8);
    const arpC = rng.pick(ARP16), arpP = rng.chance(0.5) ? arpC : rng.pick(ARP16);
    const arpWave: 'saw' | 'square' = rng.chance(0.7) ? 'saw' : 'square';
    const bassV = rng.pick([0, 1]), bassC = rng.pick([2, 3]);
    const kickV = rng.pick(KICK_VERSE), kickC = rng.pick(KICK_CHORUS);

    const secs: Sec[] = [];
    {
      let start = 0;
      for (const [name, kind, bars] of form) {
        const s: Sec = { name, kind, bars, start, next: null };
        if (secs.length) secs[secs.length - 1].next = s;
        secs.push(s);
        start += bars;
      }
    }
    const split = (s: string): string[] => s.split('|').map((x) => x.trim()).filter(Boolean);
    const barsFor = (s: Sec): string[] => {
      switch (s.kind) {
        case 'intro': return split(verseChart);
        case 'verse': return s.bars === 16 ? [...split(verseChart), ...split(verseChart)] : split(verseChart);
        case 'pre': return split(ch.pre);
        case 'chorus':
        case 'final':
          return s.bars === 16 ? [...split(ch.body), ...split(ch.half), ...split(ch.body), ...split(ch.full)] : [...split(ch.body), ...split(ch.half)];
        case 'break': return [...split(brkChart), ch.brk];
        case 'outro': return [...split(OUTRO_CHART), endChord, endChord];
      }
    };
    const dynamics = (k: Kind, i: number, n: number): number => {
      const x = i / n;
      switch (k) {
        case 'intro': return 0.8 + 0.14 * x;
        case 'verse': return 0.84 + 0.04 * x;
        case 'pre': return 0.88 + 0.12 * x;
        case 'chorus': return 1.03;
        case 'break': return i >= n - 2 ? 0.9 + 0.05 * (i - n + 2) : 0.86;
        case 'final': return 1.05;
        case 'outro': return 0.96 - 0.22 * x;
      }
    };

    const plan: BarPlan[] = [];
    for (const s of secs) {
      const bs = barsFor(s);
      for (let i = 0; i < s.bars; i++) {
        const pivot = s.next?.kind === 'final' && i === s.bars - 1;
        const shift = s.kind === 'final' || s.kind === 'outro' || pivot ? mod : 0;
        const cs = parseChart(bs[i % bs.length], T + shift)[0];
        plan.push({
          sec: s, inSec: i, shift, dyn: dynamics(s.kind, i, s.bars),
          slots: cs.map((c, k) => ({ beat: (k * 4) / cs.length, dur: 4 / cs.length, chord: c })),
          pad: [], keys: [], bass: [], bassLong: [], arp: [], arp16: false, lead: [], soft: [], bell: [], fill: -1, roll: 0,
        });
      }
    }
    const total = plan.length;
    const chordAt = (bar: number, beat: number): Chord => {
      const p = plan[Math.max(0, Math.min(total - 1, bar))];
      let c = p.slots[0].chord;
      for (const s of p.slots) if (beat >= s.beat - 1e-6) c = s.chord;
      return c;
    };

    // ------------------------------------------------------------------ melody mapping (degrees -> midi over chords)
    const degMidi = (d: number, sh: number): number => {
      const o = Math.floor(d / 7), i = ((d % 7) + 7) % 7;
      return tonic + sh + 12 * o + AEOL[i];
    };
    const alterCache = new Map<string, Map<number, number>>();
    /** chromatic chord tones outside the key (G# over E, Bb over Bbmaj7, C# over A) replace their scale neighbour */
    const alter = (m: number, c: Chord, sh: number): number => {
      const key = `${c.name}:${sh}`;
      let map = alterCache.get(key);
      if (!map) {
        map = new Map();
        const scalePcs = AEOL.map((i) => pc(tonicPc + sh + i));
        const cps = new Set(c.tones.map((t) => pc(c.root + t)));
        for (const ct of cps) {
          if (scalePcs.includes(ct)) continue;
          const lo = pc(ct - 1), hi = pc(ct + 1);
          if (scalePcs.includes(lo) && !cps.has(lo)) map.set(lo, 1);
          else if (scalePcs.includes(hi) && !cps.has(hi)) map.set(hi, -1);
        }
        alterCache.set(key, map);
      }
      return m + (map.get(pc(m)) ?? 0);
    };
    const fitDeg = (d: number, c: Chord, sh: number, dir: number): number => {
      const mm = (x: number) => alter(degMidi(x, sh), c, sh);
      if (okStrong(mm(d), c)) return d;
      const m0 = degMidi(d, sh);
      const cands = [d + 1, d - 1, d + 2, d - 2].filter((x) => okStrong(mm(x), c));
      if (!cands.length) return d;
      cands.sort((a, b) => Math.abs(mm(a) - m0) - Math.abs(mm(b) - m0) || (b - a) * (dir || 1));
      return cands[0];
    };
    const harmonyBelow = (m: number, c: Chord): number | null => {
      const cps = c.tones.map((t) => pc(c.root + t));
      for (let h = m - 3; h >= m - 9; h--) if (cps.includes(pc(h))) return h;
      return null;
    };
    /** place a melody (positions relative to bar b0) into the plan; strong notes are fitted to the harmony */
    const place = (ns: readonly MN[], b0: number, target: 'lead' | 'soft' | 'bell', o: { vel: number; glide?: number; scoop?: number; harmony?: boolean; fitAll?: boolean }): void => {
      const s = [...ns].sort((a, b) => a.pos - b.pos);
      let prevMidi: number | null = null, prevEnd = -99, prevDeg: number | null = null;
      s.forEach((n, i) => {
        const nx = s[i + 1];
        let dur = n.dur;
        if (nx && n.pos + dur > nx.pos - 0.03) dur = Math.max(0.2, nx.pos - n.pos - 0.03);
        const gb = b0 + Math.floor(n.pos / 4);
        if (gb < 0 || gb >= total) return;
        const beat = n.pos - Math.floor(n.pos / 4) * 4;
        const p = plan[gb];
        const c = chordAt(gb, beat);
        const strong = o.fitAll || beat % 2 === 0 || n.dur >= 1.5;
        const dir = prevDeg === null ? 0 : Math.sign(n.deg - prevDeg);
        const d = strong ? fitDeg(Math.round(n.deg), c, p.shift, dir) : Math.round(n.deg);
        const midi = alter(degMidi(d, p.shift), c, p.shift);
        const vel = humVel(rng, o.vel + (n.dur >= 1.5 ? 0.03 : 0) + (beat === 0 ? 0.01 : 0) + (n.acc ?? 0) - (n.dur <= 0.25 ? 0.05 : 0), 0.035);
        const ev: Ev = { beat, dur, midi, vel };
        const legato = prevMidi !== null && n.pos - prevEnd < 0.1;
        if (o.glide && legato && prevMidi !== null && prevMidi !== midi && Math.abs(midi - prevMidi) <= 5 && rng.chance(o.glide)) ev.glide = prevMidi;
        else if (o.scoop && n.dur >= 1.5 && rng.chance(o.scoop)) ev.glide = midi - (rng.chance(0.6) ? 1 : 2);
        p[target].push(ev);
        if (o.harmony && dur >= 0.75) {
          const h = harmonyBelow(midi, c);
          if (h !== null) p.soft.push({ beat, dur, midi: h, vel: vel * 0.7 });
        }
        prevMidi = midi;
        prevEnd = n.pos + dur;
        prevDeg = d;
      });
    };

    // ------------------------------------------------------------------ melodies per section
    const hookBlock = (barOff: number, amt: number, cad: Tpl): MN[] => [...vary(rng, tplNotes(hook, barOff), amt), ...tplNotes(cad, barOff)];
    for (const s of secs) {
      const b0 = s.start;
      switch (s.kind) {
        case 'intro': {
          // the bell foreshadows the hook's first two bars
          if (rng.chance(0.75)) place(tplNotes(hook, 4).filter((n) => n.pos >= 12 && n.pos < 24), b0, 'bell', { vel: 0.4 });
          break;
        }
        case 'verse': {
          const m = motifV;
          const a = rng.range(0, 0.3);
          const ns = s.bars === 16
            ? [...tplNotes(m, 4), ...vary(rng, tplNotes(m, 8), 0.5 + a), ...vary(rng, tplNotes(m, 12, 2), 0.3 + a)]
            : [...vary(rng, tplNotes(m, 0), 0.6 + a), ...vary(rng, tplNotes(m, 4, 2), 0.5 + a)];
          place(ns, b0, 'soft', { vel: 0.56, glide: 0.25, scoop: 0.15 });
          // call / response: the bell echoes the tail of each call in the gap of its second bar
          const calls = s.bars === 16 ? [8, 12] : [0, 4];
          for (const cb of calls) {
            if (!rng.chance(0.8)) continue;
            const call = ns.filter((q) => q.pos >= cb * 4 && q.pos < cb * 4 + 6).slice(-3);
            const off = rng.pick([2.5, 2]);
            place(call.map((q, j) => ({ pos: (cb + 1) * 4 + off + j * 0.5, dur: j === call.length - 1 ? 1.5 : 0.5, deg: q.deg + 7 })), b0, 'bell', { vel: 0.3, fitAll: true });
          }
          break;
        }
        case 'pre': {
          const start = rng.pick([-1, 0, 1]);
          const steps = rng.pick([[0, 1, 2, 1, 3, 4, 5, 6], [0, 1, 2, 3, 2, 3, 4, 6], [0, 0, 1, 2, 3, 4, 5, 6]]);
          const ns: MN[] = [];
          for (let b = 0; b < 8; b++) {
            const d = start + steps[b];
            if (b === 7) ns.push({ pos: 28, dur: 2.5, deg: d, acc: 0.03 });
            else for (const [, beat, dur, dd] of rng.pick(PRE_CELLS)) ns.push({ pos: b * 4 + beat, dur, deg: d + dd });
          }
          place(ns, b0, 'soft', { vel: 0.54, glide: 0.3, scoop: 0.25 });
          break;
        }
        case 'chorus':
        case 'final': {
          const fin = s.kind === 'final';
          const ns = s.bars === 16
            ? [...hookBlock(0, fin ? 0.7 : 0.15, cadH), ...hookBlock(8, fin ? 0.9 : 0.5, cadF)]
            : hookBlock(0, 0.6, cadH);
          place(ns, b0, 'lead', { vel: 0.62, glide: 0.35, scoop: 0.2, harmony: fin });
          break;
        }
        case 'break': {
          // the hook in augmentation on the bell
          const ns = tplNotes(hook).filter((n) => n.pos >= 0 && n.pos < 16).map((n) => ({ ...n, pos: n.pos * 2, dur: n.dur * 2 }));
          place(ns, b0, 'bell', { vel: 0.4 });
          break;
        }
        case 'outro': {
          const q = [...tplNotes(hook).filter((n) => n.pos >= 0 && n.pos < 8), ...tplNotes(hook, -1).filter((n) => n.pos >= 8 && n.pos < 12)];
          const last = tonic + mod >= 67 ? 0 : 7;
          place([...q, { pos: 24, dur: 7, deg: last, acc: -0.06 }], b0, 'lead', { vel: 0.56, glide: 0.3 });
          place(tplNotes(hook, 4).filter((n) => n.pos >= 16 && n.pos < 24), b0, 'bell', { vel: 0.34 });
          break;
        }
      }
    }

    // ------------------------------------------------------------------ pads, keys, arp, bass, drums plan
    let prevPad: number[] | null = null, prevKeys: number[] | null = null;
    plan.forEach((p, bi) => {
      const k = p.sec.kind, i = p.inSec, n = p.sec.bars, x = i / n;
      const endBar = k === 'outro' && i >= 6;
      // pad bed (one voicing per chord)
      if (!endBar) {
        const full = k === 'chorus' || k === 'final';
        const vel = { intro: 0.48, verse: 0.5, pre: 0.52, chorus: 0.55, break: 0.52, final: 0.56, outro: 0.5 }[k];
        const cutoff = { intro: 1000 + 1000 * x, verse: 1900, pre: 1900 + 1300 * x, chorus: 3000, break: 1600, final: 3200, outro: 2200 - 900 * x }[k];
        const attack = k === 'intro' ? (i === 0 ? 2.2 : 1.1) : full ? 0.3 : k === 'break' ? 1 : 0.7;
        for (const s of p.slots) {
          const v: number[] = voiceLead(prevPad, s.chord, { lo: 57, hi: full ? 77 : 76, count: 4 });
          prevPad = v;
          p.pad.push({ beat: s.beat, dur: s.dur, notes: v, vel, attack, cutoff });
        }
      }
      // Rhodes colours in the breakdown
      if (k === 'break') {
        for (const s of p.slots) {
          const v: number[] = voiceLead(prevKeys, s.chord, { lo: 57, hi: 76, count: 4, rootless: true });
          prevKeys = v;
          if (s.dur >= 4) {
            p.keys.push({ beat: 0, dur: 1.6, notes: v, vel: 0.4 });
            p.keys.push({ beat: rng.pick([2.5, 3, 1.5]), dur: 1.3, notes: v, vel: 0.33 });
          } else p.keys.push({ beat: s.beat, dur: s.dur - 0.2, notes: v, vel: 0.38 });
        }
      }
      // arp
      const arpOn = !(k === 'outro' && i === 7);
      if (arpOn) {
        const six = k === 'pre' || k === 'chorus' || k === 'final' || (k === 'outro' && i < 4) || (k === 'break' && i >= 6);
        const pat = six ? (k === 'pre' || k === 'break' ? arpP : arpC) : k === 'break' ? arpB : arpV;
        const steps = six ? 16 : 8, len = 4 / steps;
        const base = { intro: 0.5, verse: 0.54, pre: 0.5, chorus: 0.48, break: 0.5, final: 0.5, outro: 0.5 }[k];
        const cutAt = (y: number): number => ({ intro: 600 + 1600 * y, verse: 2200, pre: 2100 + 1000 * y, chorus: 2700, break: 1300 + 300 * y, final: 2900, outro: 2400 - 1700 * y })[k];
        const cut0 = cutAt(x), cut1 = cutAt((i + 1) / n);
        p.arp16 = six;
        for (let st = 0; st < steps; st++) {
          const beat = st * len;
          const tones = arpTones(chordAt(bi, beat));
          const acc = st % (steps / 4) === 0 ? 0.06 : six && st % 2 === 1 ? -0.03 : 0.02;
          let vel = base + acc;
          if (endBar) vel *= Math.max(0.15, 1 - st / steps); // the last arp fades under the final chord
          p.arp.push({ beat, dur: len * 0.82, midi: tones[pat[st % pat.length]], vel, cut: cut0 + ((cut1 - cut0) * st) / steps });
        }
      }
      // bass
      const long = (k === 'intro' && i >= 4) || (k === 'break' && i < 6) || (k === 'outro' && i >= 4);
      if (long) {
        if (!(k === 'outro' && i >= 6)) {
          const half = k !== 'break';
          for (const s of p.slots) {
            const root = bassNote(s.chord, 35);
            if (half && s.dur >= 4) {
              p.bassLong.push({ beat: 0, dur: 1.85, midi: root, vel: 0.62 });
              p.bassLong.push({ beat: 2, dur: 1.85, midi: root, vel: 0.56 });
            } else p.bassLong.push({ beat: s.beat, dur: s.dur - 0.12, midi: root, vel: 0.62 });
          }
        }
      } else if (k !== 'intro') {
        const pat = BASS8[k === 'chorus' || k === 'final' ? bassC : bassV];
        for (let st = 0; st < 8; st++) {
          const beat = st / 2;
          const root = bassNote(chordAt(bi, beat), 35);
          const off = pat[st];
          p.bass.push({ beat, dur: off ? 0.3 : 0.36, midi: root + off, vel: BASS_VEL[st] - (off ? 0.05 : 0) });
        }
      }
      // fills and rolls
      const lastBar = i === n - 1;
      const nextK = p.sec.next?.kind;
      if (k === 'intro' && lastBar) p.fill = 0;
      else if (k === 'verse') {
        if (lastBar) p.fill = rng.pick([0, 2]);
        else if (i === 7 && n === 16 && rng.chance(0.5)) p.fill = 2;
      } else if (k === 'pre') {
        if (rng.chance(0.55)) {
          if (i === n - 2) p.roll = 1;
          if (lastBar) p.roll = 2;
        } else if (lastBar) p.fill = rng.pick([1, 3]);
      } else if (k === 'chorus' || k === 'final') {
        if (lastBar) p.fill = nextK === 'outro' ? 2 : nextK === 'break' ? 0 : rng.pick([1, 3]);
        else if (i === 7 && rng.chance(0.6)) p.fill = 2;
      } else if (k === 'break') {
        if (i === n - 2) p.roll = 1;
        if (lastBar) (p.roll = 2), (p.fill = 1);
      }
    });

    // ------------------------------------------------------------------ mix
    const PAD_LEVEL = 0.9;
    const gated = makeGatedSnare(env, 0.46);
    const setup = (): void => {
      inst.mix('pad', { level: PAD_LEVEL, pan: 0, reverb: 0.42, lowpass: 9000, highpass: 150 });
      inst.mix('arp', { level: 1.35, pan: 0.3, reverb: 0.22, delay: 0.3, highpass: 200 });
      inst.mix('lead', { level: 1.15, pan: -0.03, reverb: 0.3, delay: 0.2, lowpass: 8000 });
      inst.mix('lead:soft', { level: 1.15, pan: -0.2, reverb: 0.3, delay: 0.18, lowpass: 6500 });
      inst.mix('synthBass', { level: 0.8, reverb: 0.02, highpass: 35 });
      inst.mix('kick', { level: 0.5, reverb: 0.02 });
      inst.mix('snare', { level: 0.7, reverb: 0.1 });
      inst.mix('clap', { level: 0.6, reverb: 0.22 });
      inst.mix('hat', { level: 0.85, pan: 0.3 });
      inst.mix('tom', { level: 0.72, reverb: 0.28 });
      inst.mix('cymbal', { level: 0.6 });
      inst.mix('bell', { level: 0.8, pan: 0.3, reverb: 0.5, delay: 0.26 });
      inst.mix('epiano', { level: 0.8, pan: -0.25, reverb: 0.32, delay: 0.12, tremolo: 0.35 });
      inst.mix('sweep', { level: 0.6 });
      inst.setDelay({ beats: 0.75, feedback: 0.3, tone: 2600 });
    };

    const bassOpts = (k: Kind): MonoBassOpts =>
      k === 'chorus' || k === 'final' ? { cutoff: 380, envAmt: 0.6, decay: 0.17, reso: 4.5, sub: 0.35 } : k === 'pre' ? { cutoff: 350, envAmt: 0.55, decay: 0.16, reso: 4.5, sub: 0.35 } : { cutoff: 320, envAmt: 0.5, decay: 0.15, reso: 4, sub: 0.35 };
    const leadOpts = (k: Kind) => ({ wave: 'saw' as const, cutoff: k === 'final' ? 2600 : k === 'outro' ? 1900 : 2400, reso: 1.6, detune: 12, vibrato: 14 });
    const SOFT = { ch: 'soft', wave: 'square' as const, cutoff: 1400, reso: 1, detune: 5, vibrato: 9 };

    // ------------------------------------------------------------------ per-bar scheduling
    const drums = (b: BarInfo, p: BarPlan): void => {
      const k = p.sec.kind, i = p.inSec, n = p.sec.bars, dyn = p.dyn;
      const at = (beat: number, ms = 3) => humanize(rng, b.at(beat), ms);
      const fill = p.fill >= 0 ? FILLS[p.fill] : null;
      const fillAt = fill ? fill[0][0] : 4;
      const rollAt = p.roll === 2 ? 0 : 4;
      let kick: number[] = [], snare = false, clap = false, hats: 'none' | 'off' | 'all' = 'none', open = false, pump = false;
      switch (k) {
        case 'intro':
          if (i >= 4) (kick = i === n - 1 ? [0] : [0, 2]), (hats = 'off');
          break;
        case 'verse':
          kick = kickV, snare = true, hats = 'all', open = p.sec.name === 'verse 2' && i % 2 === 1;
          break;
        case 'pre':
          kick = [0, 1, 2, 3], snare = true, hats = 'all', open = i >= 4, pump = i >= 4;
          break;
        case 'chorus':
        case 'final':
          kick = kickC, snare = true, clap = true, hats = 'all', open = true, pump = true;
          break;
        case 'break':
          if (i === 3) kick = [0];
          else if (i >= 4) (kick = i >= n - 2 ? [0, 1, 2, 3] : [0, 2]), (hats = i >= 5 ? 'all' : 'off');
          break;
        case 'outro':
          if (i < 4) (kick = kickV), (snare = true), (hats = 'all');
          else if (i < 6) (kick = [0, 2]), (hats = 'off');
          break;
      }
      const soft = k === 'outro' ? 0.85 : k === 'intro' ? 0.8 : 1;
      for (const kb of kick) {
        if (kb >= fillAt && kb % 1) continue;
        const t = at(kb, 2);
        // softer under the backbeat so kick + snare + clap do not stack into a peak
        const kv = kb % 1 ? 0.62 : snare && kb % 2 === 1 ? 0.64 : 0.77;
        inst.kick(t, humVel(rng, kv * soft * dyn, 0.03), { tune: 52, decay: 0.34, click: 0.25 });
        if (pump) {
          inst.mix('pad', { level: PAD_LEVEL * 0.58 }, t);
          inst.mix('pad', { level: PAD_LEVEL }, t + 0.09);
        }
      }
      if (snare) {
        for (const sb of [1, 3]) {
          if (sb >= fillAt || sb >= rollAt) continue;
          const t = at(sb, 3);
          const v = humVel(rng, 0.52 * soft * dyn, 0.03);
          inst.snare(t, v, { tone: 190, snappy: 0.55 });
          gated(t, v);
          if (clap) inst.clap(t + 0.011, humVel(rng, 0.38 * dyn, 0.03));
        }
      }
      if (hats !== 'none') {
        for (let st = 0; st < 8; st++) {
          const beat = st / 2;
          if (beat >= fillAt) break;
          const off = st % 2 === 1;
          if (hats === 'off' && !off) continue;
          if (open && st === 7) inst.hat(at(beat, 3), humVel(rng, 0.38 * dyn, 0.03), { open: 0.16 });
          else inst.hat(at(beat, 3), humVel(rng, (off ? 0.44 : 0.32) * soft * dyn * (k === 'intro' ? 0.8 : 1), 0.03));
        }
      }
      // crashes and swells
      if (i === 0 && (k === 'chorus' || k === 'final')) inst.cymbal(at(0, 2), 0.3 * dyn, { decay: 2.4 });
      if (i === 8 && (k === 'chorus' || k === 'final')) inst.cymbal(at(0, 2), 0.24 * dyn, { decay: 2 });
      if (i === 0 && (k === 'verse' || k === 'outro') && b.bar > 8) inst.cymbal(at(0, 2), 0.22, { decay: 2 });
      const nk = p.sec.next?.kind;
      if (i === n - 1 && (nk === 'chorus' || nk === 'final' || (k === 'intro' && nk === 'verse'))) inst.cymbal(b.t + b.dur, 0.24, { swell: 1.5 });
      if (k === 'outro' && i === 5) inst.cymbal(b.t + b.dur, 0.2, { swell: 1.8 });
      if (i === n - 2 && (k === 'pre' || k === 'break')) inst.sweep(b.t, b.dur * 2, 0.42, { up: true, from: 450, to: 5500, q: 2 });
      // snare roll build
      if (p.roll === 1) for (let st = 0; st < 8; st++) inst.snare(at(st / 2, 2), (0.16 + 0.16 * (st / 8)) * dyn, { tone: 200, snappy: 0.55 });
      if (p.roll === 2) {
        for (let st = 0; st < 16; st++) {
          const beat = st / 4;
          if (beat >= fillAt) break;
          inst.snare(at(beat, 2), (0.24 + 0.3 * (st / 16)) * dyn, { tone: 205, snappy: 0.55 });
        }
      }
      if (fill) for (const [beat, hz, v] of fill) inst.tom(at(beat, 3), v * dyn, { pitch: hz, pan: hz > 170 ? 0.28 : hz < 115 ? -0.28 : 0.04 });
    };

    /** outro bar 6: the final chord */
    const ending = (b: BarInfo, p: BarPlan): void => {
      const c = p.slots[0].chord;
      const sec = (beats: number) => b.beatsToSec(beats);
      inst.pad(b.t, voicing(c, { lo: 50, hi: 77, count: 5, rootless: false }), sec(8) + 0.5, 0.42, { attack: 0.5, release: 4.5, cutoff: 1900, detune: 13 });
      inst.synthBass(b.t, bassNote(c, 35), sec(7.5), 0.55, { cutoff: 240, envAmt: 0.2, decay: 0.4, reso: 2 });
      voicing(c, { lo: 57, hi: 79, count: 4, rootless: true }).forEach((m, j) => inst.epiano(b.t + 0.03 + j * 0.07, m, sec(6), 0.34 + j * 0.015, { bright: 0.55 }));
      const top = tonic + p.shift + 12;
      inst.bell(b.t + sec(1.5), top, sec(4), 0.3);
      inst.bell(b.t + sec(3), top + 7, sec(4), 0.24);
      inst.kick(b.t, 0.5, { tune: 46, decay: 0.5, click: 0.2 });
    };

    return song(env, {
      bpm,
      sections: secs.map((s) => ({ name: s.name, bars: s.bars })),
      tail: 5,
      setup,
      bar(b: BarInfo) {
        const p = plan[b.bar];
        const k = p.sec.kind, dyn = p.dyn;
        const at = (beat: number, ms = 6) => humanize(rng, b.at(beat), ms);
        const sec = (beats: number) => b.beatsToSec(beats);
        if (b.first) {
          // arp echo: dotted-8th gallop in the 8th-note sections, drier in the 16th-note ones
          inst.mix('arp', { delay: p.arp16 ? 0.2 : k === 'break' ? 0.38 : 0.3 }, b.t);
        }
        for (const e of p.pad) inst.pad(at(e.beat, 8), e.notes, sec(e.dur) + 0.05, e.vel * dyn, { attack: e.attack, release: 1.6, cutoff: e.cutoff, detune: 13 });
        for (const e of p.keys) {
          const t = at(e.beat, 6);
          e.notes.forEach((m, j) => inst.epiano(t + j * 0.012, m, sec(e.dur), e.vel * dyn, { bright: 0.55 }));
        }
        if (p.arp.length) {
          const ns: MonoNote[] = p.arp.map((e) => ({ t: humanize(rng, b.at(e.beat), 1.5), midi: e.midi, len: sec(e.dur), vel: e.vel * dyn, cut: e.cut }));
          monoArp(env, ns, { wave: arpWave, decay: 0.2, envAmt: 2, reso: 2.5 });
        }
        if (p.bass.length) {
          const bd = Math.sqrt(dyn);
          const ns: MonoNote[] = p.bass.map((e) => ({ t: humanize(rng, b.at(e.beat), 2), midi: e.midi, len: sec(e.dur), vel: e.vel * bd }));
          monoBass(env, ns, bassOpts(k));
        }
        if (p.bassLong.length) {
          const ns: MonoNote[] = p.bassLong.map((e) => ({ t: at(e.beat, 3), midi: e.midi, len: sec(e.dur), vel: e.vel * Math.sqrt(dyn) }));
          monoBass(env, ns, { cutoff: 300, envAmt: 0.3, decay: 0.3, reso: 3, sub: 0.35 });
        }
        const lo = leadOpts(k);
        for (const e of p.lead) inst.lead(at(e.beat, 7) + 0.006, e.midi, sec(e.dur), e.vel * dyn, { ...lo, glideFrom: e.glide, glideTime: 0.07 });
        for (const e of p.soft) inst.lead(at(e.beat, 7) + 0.006, e.midi, sec(e.dur), e.vel * dyn, { ...SOFT, glideFrom: e.glide, glideTime: 0.06 });
        for (const e of p.bell) inst.bell(at(e.beat, 5), e.midi, sec(Math.max(1, e.dur)), e.vel * dyn);
        drums(b, p);
        if (k === 'outro' && p.inSec === 6) ending(b, p);
      },
    });
  },
};
