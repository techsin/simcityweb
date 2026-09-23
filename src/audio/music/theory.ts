/**
 * Music theory helpers for the procedural soundtrack (pure functions, no WebAudio).
 *
 *  pitch:     mtof, ftom, note('Eb4'), noteName(63), pc(m)
 *  scales:    SCALES, scale(root, 'dorian', lo, hi), degree(root, 'major', deg), snap(m, pool), stepInPool
 *  chords:    CHORDS, chord(root, 'm9'), parseChord('F#m7b5/C'), parseChart('Dm9 G13 | Cmaj9 %'),
 *             roman(key, 'ii7', 'major'), progression(key, 'ii7 V7 Imaj7'), transposeChord
 *  voicing:   voicing(ch, { lo, hi, count, rootless, drop2 }), voiceLead(prev, ch, opts), chordTones, chordScale,
 *             scaleFor(ch, lo, hi), bassNote(ch, lo)
 *  lines:     walkingBass(rng, ch, next, beats, prevNote), motif(rng, pool, n, opts), approach(target, from)
 *  rhythm:    swingPos(pos, swing, unit), humanize(rng, t, ms), humVel(rng, v, amt), euclid(k, n, rot), pattern('x-o-X---')
 *  form:      arrange([{ name, bars }...]) -> { sections, totalBars, sectionAt(bar) }
 *  levels:    dbToGain, gainToDb
 */
import type { RNG } from '../../core/rng';

// ------------------------------------------------------------------ pitch
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const ftom = (f: number): number => 69 + 12 * Math.log2(f / 440);
/** pitch class 0..11 */
export const pc = (m: number): number => ((Math.round(m) % 12) + 12) % 12;

export const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' = 60, 'Eb3' = 51, 'F#' (no octave) = pitch class 6 */
export function note(name: string): number {
  const m = /^([A-Ga-g])([#b]*)(-?\d+)?$/.exec(name.trim());
  if (!m) throw new Error(`bad note name ${name}`);
  let v = LETTER[m[1].toUpperCase()];
  for (const c of m[2]) v += c === '#' ? 1 : -1;
  return m[3] === undefined ? ((v % 12) + 12) % 12 : v + (parseInt(m[3], 10) + 1) * 12;
}

export function noteName(m: number): string {
  return `${NOTE_NAMES[pc(m)]}${Math.floor(Math.round(m) / 12) - 1}`;
}

// ------------------------------------------------------------------ scales
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  majorPent: [0, 2, 4, 7, 9],
  minorPent: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  majorBlues: [0, 2, 3, 4, 7, 9],
  wholeTone: [0, 2, 4, 6, 8, 10],
  diminished: [0, 2, 3, 5, 6, 8, 9, 11], // whole-half
  halfWhole: [0, 1, 3, 4, 6, 7, 9, 10],
  lydianDominant: [0, 2, 4, 6, 7, 9, 10],
  altered: [0, 1, 3, 4, 6, 8, 10],
  bebopDominant: [0, 2, 4, 5, 7, 9, 10, 11],
  bebopMajor: [0, 2, 4, 5, 7, 8, 9, 11],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} as const;
export type ScaleName = keyof typeof SCALES;
type ScaleLike = ScaleName | readonly number[];
const sc = (s: ScaleLike): readonly number[] => (typeof s === 'string' ? SCALES[s] : s);

/** all midi notes of `root`'s scale within [lo, hi] (ascending). root may be a pitch class or a midi note. */
export function scale(root: number, s: ScaleLike, lo = 48, hi = 84): number[] {
  const iv = sc(s);
  const out: number[] = [];
  const r = pc(root);
  for (let m = Math.ceil(lo); m <= hi; m++) if (iv.includes(((m - r) % 12 + 12) % 12)) out.push(m);
  return out;
}

/** scale degree (0-based, may be negative or > 7) relative to a midi root: degree(60,'major',2) = 64, (60,'major',7) = 72 */
export function degree(root: number, s: ScaleLike, deg: number): number {
  const iv = sc(s);
  const n = iv.length;
  const oct = Math.floor(deg / n);
  return root + oct * 12 + iv[((deg % n) + n) % n];
}

/** nearest note of pool to m (ties -> lower) */
export function snap(m: number, pool: readonly number[]): number {
  let best = pool[0], bd = Infinity;
  for (const p of pool) {
    const d = Math.abs(p - m);
    if (d < bd) (bd = d), (best = p);
  }
  return best;
}

/** move `steps` scale steps from m within the (sorted) pool; clamps at the ends */
export function stepInPool(m: number, steps: number, pool: readonly number[]): number {
  let i = pool.indexOf(snap(m, pool));
  i = Math.max(0, Math.min(pool.length - 1, i + steps));
  return pool[i];
}

// ------------------------------------------------------------------ chords
/** chord qualities as semitone intervals above the root */
export const CHORDS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '5': [0, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '69': [0, 4, 7, 9, 14],
  m69: [0, 3, 7, 9, 14],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  maj7s11: [0, 4, 7, 11, 18],
  maj13: [0, 4, 7, 11, 14, 21],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  m11: [0, 3, 7, 10, 14, 17],
  mMaj7: [0, 3, 7, 11],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  '7': [0, 4, 7, 10],
  '9': [0, 4, 7, 10, 14],
  '13': [0, 4, 7, 10, 14, 21],
  '7b9': [0, 4, 7, 10, 13],
  '7s9': [0, 4, 7, 10, 15],
  '7s11': [0, 4, 7, 10, 18],
  '7b13': [0, 4, 7, 10, 20],
  '7alt': [0, 4, 10, 13, 15, 20],
  '7sus4': [0, 5, 7, 10],
  '9sus4': [0, 5, 7, 10, 14],
  '13sus4': [0, 5, 7, 10, 14, 21],
} as const;
export type Quality = keyof typeof CHORDS;

export interface Chord {
  /** root pitch class 0..11 */
  root: number;
  quality: Quality;
  /** intervals above the root (from CHORDS) */
  tones: readonly number[];
  /** slash-bass pitch class (defaults to root) */
  bass: number;
  name: string;
}

export function chord(root: number | string, quality: Quality = 'maj', bass?: number): Chord {
  const r = typeof root === 'string' ? pc(note(root)) : pc(root);
  const b = bass === undefined ? r : pc(bass);
  return { root: r, quality, tones: CHORDS[quality], bass: b, name: `${NOTE_NAMES[r]}${quality === 'maj' ? '' : quality === 'min' ? 'm' : quality}${b !== r ? '/' + NOTE_NAMES[b] : ''}` };
}

const QUALITY_ALIASES: Record<string, Quality> = {
  '': 'maj', M: 'maj', maj: 'maj', m: 'min', min: 'min', '-': 'min', dim: 'dim', o: 'dim', aug: 'aug', '+': 'aug', sus: 'sus4', sus4: 'sus4', sus2: 'sus2',
  '5': '5', '6': '6', m6: 'm6', '69': '69', '6/9': '69', m69: 'm69', add9: 'add9', madd9: 'madd9', maj7: 'maj7', M7: 'maj7', '^7': 'maj7', maj9: 'maj9', M9: 'maj9',
  'maj7#11': 'maj7s11', maj7s11: 'maj7s11', maj13: 'maj13', m7: 'm7', '-7': 'm7', min7: 'm7', m9: 'm9', m11: 'm11', mMaj7: 'mMaj7', mM7: 'mMaj7', m7b5: 'm7b5', ø: 'm7b5',
  dim7: 'dim7', o7: 'dim7', '7': '7', '9': '9', '13': '13', '7b9': '7b9', '7#9': '7s9', '7s9': '7s9', '7#11': '7s11', '7s11': '7s11', '7b13': '7b13', '7alt': '7alt', alt: '7alt',
  '7sus': '7sus4', '7sus4': '7sus4', '9sus': '9sus4', '9sus4': '9sus4', '13sus': '13sus4', '13sus4': '13sus4',
};

/** 'Dm9', 'G13', 'Bbmaj7', 'F#m7b5', 'C/E', 'Ab69' */
export function parseChord(sym: string): Chord {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym.trim());
  if (!m) throw new Error(`bad chord ${sym}`);
  const q = QUALITY_ALIASES[m[2]];
  if (!q) throw new Error(`unknown chord quality "${m[2]}" in ${sym}`);
  return chord(note(m[1]), q, m[3] ? note(m[3]) : undefined);
}

/**
 * Chord chart -> bars: 'Dm9 G13 | Cmaj9 | % | A7alt' -> [[Dm9, G13], [Cmaj9], [Cmaj9], [A7alt]]
 * ('%' repeats the previous bar; chords in a bar split it evenly)
 */
export function parseChart(chart: string, transpose = 0): Chord[][] {
  const bars: Chord[][] = [];
  for (const raw of chart.split('|')) {
    const s = raw.trim();
    if (!s) continue;
    if (s === '%') {
      bars.push(bars[bars.length - 1] ?? []);
      continue;
    }
    bars.push(s.split(/\s+/).map((c) => transposeChord(parseChord(c), transpose)));
  }
  return bars;
}

export function transposeChord(c: Chord, semis: number): Chord {
  return semis ? chord(c.root + semis, c.quality, c.bass + semis) : c;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
/**
 * Roman numeral -> chord in a key. Case gives major/minor triad colour, suffix picks the quality:
 *   roman(0,'ii7') = Dm7, roman(0,'V13') = G13, roman(0,'bVII9') = Bb9, roman(9,'i','minor') = Am, roman(0,'IVmaj9') = Fmaj9
 * The degree root comes from the mode's scale (flats/sharps prefix alter it).
 */
export function roman(key: number, sym: string, mode: ScaleName = 'major'): Chord {
  const m = /^([b#]*)([ivIV]+)(.*)$/.exec(sym.trim());
  if (!m) throw new Error(`bad roman ${sym}`);
  const deg = ROMAN.indexOf(m[2].toUpperCase());
  if (deg < 0) throw new Error(`bad roman ${sym}`);
  let root = degree(pc(key), mode, deg);
  for (const c of m[1]) root += c === '#' ? 1 : -1;
  const lower = m[2] === m[2].toLowerCase();
  let suf = m[3];
  if (suf === 'o') suf = 'dim';
  if (suf === 'ø' || suf === 'ø7') suf = 'm7b5';
  let q: Quality | undefined;
  if (!lower) q = QUALITY_ALIASES[suf];
  else if (suf === '') q = 'min';
  else if (suf.startsWith('dim') || suf.startsWith('o') || suf.startsWith('m')) q = QUALITY_ALIASES[suf];
  else if (suf === 'maj7') q = 'mMaj7';
  else q = QUALITY_ALIASES['m' + suf] ?? QUALITY_ALIASES[suf];
  if (!q) throw new Error(`unknown quality in ${sym}`);
  return chord(root, q);
}

/** 'ii7 V7 Imaj7 vi7' in a key -> chords */
export function progression(key: number, romans: string, mode: ScaleName = 'major'): Chord[] {
  return romans.trim().split(/\s+/).map((r) => roman(key, r, mode));
}

/** chord tones (midi) within [lo, hi] */
export function chordTones(c: Chord, lo = 48, hi = 84): number[] {
  const pcs = new Set(c.tones.map((t) => (c.root + t) % 12));
  const out: number[] = [];
  for (let m = Math.ceil(lo); m <= hi; m++) if (pcs.has(pc(m))) out.push(m);
  return out;
}

/** a good melodic scale (intervals from the chord root) for a chord quality */
export function chordScale(c: Chord): readonly number[] {
  switch (c.quality) {
    case 'maj': case '6': case '69': case 'add9': case 'maj7': case 'maj9': case 'maj13': return SCALES.major;
    case 'maj7s11': return SCALES.lydian;
    case 'min': case 'm7': case 'm9': case 'm11': case 'm6': case 'm69': case 'madd9': return SCALES.dorian;
    case 'mMaj7': return SCALES.melodicMinor;
    case 'm7b5': return SCALES.locrian;
    case 'dim': case 'dim7': return SCALES.diminished;
    case 'aug': return SCALES.wholeTone;
    case '7s11': return SCALES.lydianDominant;
    case '7alt': case '7s9': case '7b13': return SCALES.altered;
    case '7b9': return SCALES.halfWhole;
    default: return SCALES.mixolydian; // 7, 9, 13, sus
  }
}

/** melody pool (midi) for a chord: its chord scale within [lo, hi] */
export function scaleFor(c: Chord, lo = 60, hi = 84): number[] {
  return scale(c.root, chordScale(c), lo, hi);
}

/** bass note (root, or slash bass) in [lo, lo+11] */
export function bassNote(c: Chord, lo = 36): number {
  const b = c.bass;
  return lo + ((b - pc(lo)) % 12 + 12) % 12;
}

export interface VoicingOpts {
  /** lowest / highest allowed midi (default 50..76) */
  lo?: number;
  hi?: number;
  /** number of notes (default: all chord tones, max 5) */
  count?: number;
  /** drop the root (jazz rootless voicing; the bass plays it). Default true for chords with >= 4 tones */
  rootless?: boolean;
  /** drop-2: move the 2nd-highest note down an octave (opens the voicing) */
  drop2?: boolean;
}

function voicingPcs(c: Chord, o: VoicingOpts): number[] {
  let iv = [...c.tones];
  const rootless = o.rootless ?? iv.length >= 4;
  // prefer colour tones: drop 5th first, then root
  const count = Math.min(o.count ?? Math.min(5, iv.length), iv.length);
  if (rootless && iv.length > 3 && count < iv.length) iv = iv.filter((t) => t !== 0);
  while (iv.length > count && iv.includes(7)) iv = iv.filter((t) => t !== 7);
  while (iv.length > count && iv.includes(0)) iv = iv.filter((t) => t !== 0);
  while (iv.length > count) iv.pop();
  return iv.map((t) => (c.root + t) % 12);
}

/** close voicing of the chord inside [lo, hi] (lowest inversion that fits) */
export function voicing(c: Chord, o: VoicingOpts = {}): number[] {
  const lo = o.lo ?? 50, hi = o.hi ?? 76;
  const pcs = voicingPcs(c, o);
  const cands = inversions(pcs, lo, hi);
  let v = cands[0] ?? pcs.map((p) => lo + ((p - lo) % 12 + 12) % 12).sort((a, b) => a - b);
  if (o.drop2 && v.length >= 4) {
    v = [...v];
    const i = v.length - 2;
    v[i] -= 12;
    if (v[i] < lo - 5) v[i] += 12;
    v.sort((a, b) => a - b);
  }
  return v;
}

/** all close-position stackings of pitch classes whose notes fit in [lo, hi] */
function inversions(pcs: number[], lo: number, hi: number): number[][] {
  const out: number[][] = [];
  const n = pcs.length;
  if (!n) return out;
  const sorted = [...pcs].sort((a, b) => a - b);
  for (let r = 0; r < n; r++) {
    const order = [...sorted.slice(r), ...sorted.slice(0, r)];
    for (let base = lo; base < lo + 12; base++) {
      if (pc(base) !== order[0]) continue;
      const v = [base];
      for (let k = 1; k < n; k++) {
        let m = v[k - 1] + 1;
        while (pc(m) !== order[k]) m++;
        v.push(m);
      }
      for (let shift = 0; v[v.length - 1] + shift <= hi; shift += 12) out.push(v.map((x) => x + shift));
    }
  }
  return out;
}

/**
 * Smooth voice leading: of all voicings of `c` in [lo, hi] with the same note count as `prev`, pick the one with the
 * least total movement (ties favour the one nearest the range centre). prev = null -> voicing(c, o).
 */
export function voiceLead(prev: readonly number[] | null, c: Chord, o: VoicingOpts = {}): number[] {
  if (!prev || !prev.length) return voicing(c, o);
  const lo = o.lo ?? 50, hi = o.hi ?? 76;
  const pcs = voicingPcs(c, { ...o, count: o.count ?? prev.length });
  const cands = inversions(pcs, lo, hi);
  if (o.drop2) for (const v of [...cands]) if (v.length >= 4) {
    const d = [...v];
    d[d.length - 2] -= 12;
    if (d[d.length - 2] >= lo - 3) cands.push(d.sort((a, b) => a - b));
  }
  if (!cands.length) return voicing(c, o);
  const centre = (lo + hi) / 2;
  const ps = [...prev].sort((a, b) => a - b);
  let best = cands[0], bs = Infinity;
  for (const v of cands) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += Math.abs(v[i] - (ps[Math.min(i, ps.length - 1)] ?? v[i]));
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    s += Math.abs(mean - centre) * 0.15;
    if (s < bs) (bs = s), (best = v);
  }
  return best;
}

// ------------------------------------------------------------------ lines
/** chromatic / diatonic approach note into `target` (one semitone below or above, or a scale step) */
export function approach(rng: RNG, target: number, pool?: readonly number[]): number {
  if (pool && rng.chance(0.4)) {
    const i = pool.indexOf(snap(target, pool));
    const j = rng.chance(0.5) ? i - 1 : i + 1;
    if (j >= 0 && j < pool.length && pool[j] !== target) return pool[j];
  }
  return target + (rng.chance(0.6) ? -1 : 1);
}

/**
 * One chord's worth of walking bass (quarter notes), ending with an approach into the next chord's root.
 * Returns midi notes (length = beats). prev = last bass note played (for smooth register), lo/hi = register.
 */
export function walkingBass(rng: RNG, c: Chord, next: Chord | null, beats: number, prev: number | null, lo = 31, hi = 55): number[] {
  const root = nearestPc(c.bass, prev ?? (lo + hi) / 2 - 4, lo, hi);
  const pool = scale(c.root, chordScale(c), lo, hi);
  const tones = chordTones(c, lo, hi);
  const out: number[] = [root];
  let cur = root;
  const nextRoot = next ? nearestPc(next.bass, root, lo, hi) : root;
  for (let b = 1; b < beats; b++) {
    const last = b === beats - 1;
    if (last && next) {
      cur = approach(rng, nextRoot, scale(next.root, chordScale(next), lo, hi));
    } else {
      const dir = nextRoot > cur ? 1 : nextRoot < cur ? -1 : rng.chance(0.5) ? 1 : -1;
      if (rng.chance(0.55)) cur = stepInPool(cur, dir * (rng.chance(0.7) ? 1 : 2), pool);
      else cur = snap(cur + dir * rng.int(3, 5), tones);
    }
    cur = Math.max(lo, Math.min(hi, cur));
    out.push(cur);
  }
  return out;
}

function nearestPc(p: number, near: number, lo: number, hi: number): number {
  let best = lo, bd = Infinity;
  for (let m = lo; m <= hi; m++) if (pc(m) === pc(p) && Math.abs(m - near) < bd) (bd = Math.abs(m - near)), (best = m);
  return best;
}

export interface MotifOpts {
  /** start note (snapped to pool); default: random chord-ish middle */
  start?: number;
  /** probability of a stepwise move (default 0.7), else a leap of 2-4 pool steps */
  stepiness?: number;
  /** general direction bias -1..1 (default 0) */
  bias?: number;
}

/** generate a melodic contour of n notes from a (sorted) pool: mostly steps, occasional leaps, direction changes after leaps */
export function motif(rng: RNG, pool: readonly number[], n: number, o: MotifOpts = {}): number[] {
  const out: number[] = [];
  let cur = o.start !== undefined ? snap(o.start, pool) : pool[Math.floor(pool.length / 2 + rng.range(-2, 2))] ?? pool[0];
  let dir = rng.chance(0.5 + (o.bias ?? 0) * 0.4) ? 1 : -1;
  for (let i = 0; i < n; i++) {
    out.push(cur);
    const leap = !rng.chance(o.stepiness ?? 0.7);
    const size = leap ? rng.int(2, 4) : 1;
    let nxt = stepInPool(cur, dir * size, pool);
    if (nxt === cur) (dir = -dir), (nxt = stepInPool(cur, dir * size, pool));
    if (leap || rng.chance(0.25)) dir = -dir; // recover after leaps
    cur = nxt;
  }
  return out;
}

// ------------------------------------------------------------------ rhythm
/**
 * Swing a position given in beats. swing = fraction of the beat where the off-beat 8th lands (0.5 straight,
 * 0.58 light, 0.667 triplet). unit 16 swings 16ths instead (funk / hip-hop).
 */
export function swingPos(pos: number, swing = 0.5, unit: 8 | 16 = 8): number {
  if (swing === 0.5) return pos;
  const span = unit === 8 ? 1 : 0.5;
  const base = Math.floor(pos / span) * span;
  const f = (pos - base) / span; // 0..1 within the pair
  const w = f <= 0.5 ? (f / 0.5) * swing : swing + ((f - 0.5) / 0.5) * (1 - swing);
  return base + w * span;
}

/** random timing offset (seconds): ± ms/1000, triangular distribution */
export function humanize(rng: RNG, t: number, ms = 8): number {
  return t + ((rng.next() + rng.next() - 1) * ms) / 1000;
}

/** velocity jitter, clamped to 0.02..1 */
export function humVel(rng: RNG, v: number, amt = 0.08): number {
  return Math.max(0.02, Math.min(1, v + (rng.next() + rng.next() - 1) * amt));
}

/** Euclidean rhythm: k onsets spread over n steps (Bjorklund), rotated by rot */
export function euclid(k: number, n: number, rot = 0): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const j = (((i + rot) % n) + n) % n;
    out.push(Math.floor((j * k) / n) !== Math.floor(((j - 1) * k) / n));
  }
  return out;
}

/**
 * Step pattern string -> velocities (0 = rest). 'X' accent 1.0, 'x' 0.75, 'o' ghost 0.35, '.' very soft 0.18,
 * '-' rest. Spaces and '|' are ignored (use them to group beats): pattern('x-o- X-o-') has 8 steps.
 */
export function pattern(p: string): number[] {
  const out: number[] = [];
  for (const ch of p) {
    if (ch === ' ' || ch === '|') continue;
    out.push(ch === 'X' ? 1 : ch === 'x' ? 0.75 : ch === 'o' ? 0.35 : ch === '.' ? 0.18 : 0);
  }
  return out;
}

// ------------------------------------------------------------------ form
export interface FormSection {
  name: string;
  bars: number;
  /** first bar index (global) */
  start: number;
  index: number;
}

/** lay out sections back to back; sectionAt(bar) finds the section containing a global bar index */
export function arrange(spec: readonly { name: string; bars: number }[]): { sections: FormSection[]; totalBars: number; sectionAt(bar: number): FormSection } {
  const sections: FormSection[] = [];
  let b = 0;
  spec.forEach((s, index) => {
    sections.push({ name: s.name, bars: s.bars, start: b, index });
    b += s.bars;
  });
  return {
    sections,
    totalBars: b,
    sectionAt(bar: number) {
      for (let i = sections.length - 1; i >= 0; i--) if (bar >= sections[i].start) return sections[i];
      return sections[0];
    },
  };
}

// ------------------------------------------------------------------ levels
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(1e-12, g));
