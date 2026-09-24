/**
 * Private helper for "Rush Hour" (rush_hour_funk.ts): cluster-free rootless voicings for the comping parts.
 *
 * theory.voiceLead() only knows close-position stackings and picks by voice-leading distance, which for the 3-note
 * funk grips of m9 (b3 7 9) and 7#9 (3 7 #9) lands on a semitone cluster two times out of three (Eb-G-Ab for Fm9,
 * #9 directly under the 3rd). grip() instead searches every octave placement of the chosen chord tones and rejects:
 *   - a minor 2nd between neighbouring voices and a minor 9th between any two voices (except on 7b9 / alt chords),
 *   - intervals smaller than a minor 3rd low in the register (mud),
 *   - for 7#9 anything but the "Hendrix" order: #9 on top, a major 7th above the 3rd (3-note grips: 3rd at the
 *     bottom, e.g. E4-Bb4-Eb5 for C7#9),
 * then picks the survivor with the least movement from the previous voicing, near the middle of [lo, hi], with a
 * penalty for a semitone / minor 9th against notes another part plays on the same chord (`against`). The range is
 * soft (a few semitones of slack at a penalty, more below than above) so a spread grip is reachable in any key.
 */
import { pc, voiceLead, type Chord } from '../theory';

/** chord-tone intervals above the root per quality: 3-note comping grips (clav, brass stabs) */
const GRIP3: Readonly<Record<string, readonly number[]>> = {
  m9: [3, 10, 14], m7: [3, 7, 10], m11: [3, 10, 17], m6: [3, 7, 9], m69: [3, 9, 14], min: [0, 3, 7], madd9: [3, 7, 14], mMaj7: [3, 7, 11],
  maj9: [4, 11, 14], maj7: [4, 7, 11], maj13: [4, 11, 21], maj7s11: [4, 11, 18], '69': [4, 9, 14], '6': [4, 7, 9], add9: [4, 7, 14], maj: [0, 4, 7],
  '13': [4, 10, 21], '9': [4, 10, 14], '7': [4, 7, 10], '7s9': [4, 10, 15], '7b9': [4, 10, 13], '7alt': [4, 10, 15], '7s11': [4, 10, 18], '7b13': [4, 10, 20],
  '9sus4': [5, 10, 14], '13sus4': [5, 10, 14], '7sus4': [5, 7, 10], sus4: [0, 5, 7], sus2: [0, 2, 7],
  m7b5: [3, 6, 10], dim7: [3, 6, 9], dim: [0, 3, 6], aug: [0, 4, 8],
};
/** 4-note beds (strings, Rhodes) */
const GRIP4: Readonly<Record<string, readonly number[]>> = {
  m9: [3, 7, 10, 14], m7: [0, 3, 7, 10], m11: [3, 10, 14, 17], m6: [0, 3, 7, 9], m69: [3, 7, 9, 14], madd9: [0, 3, 7, 14], mMaj7: [3, 7, 11, 14],
  maj9: [4, 7, 11, 14], maj7: [0, 4, 7, 11], maj13: [4, 11, 14, 21], maj7s11: [4, 7, 11, 18], '69': [4, 7, 9, 14], '6': [0, 4, 7, 9], add9: [0, 4, 7, 14],
  '13': [4, 10, 14, 21], '9': [4, 7, 10, 14], '7': [0, 4, 7, 10], '7s9': [4, 7, 10, 15], '7b9': [4, 7, 10, 13], '7alt': [4, 10, 15, 20], '7s11': [4, 10, 14, 18], '7b13': [4, 10, 14, 20],
  '9sus4': [5, 7, 10, 14], '13sus4': [5, 10, 14, 21], '7sus4': [0, 5, 7, 10],
  m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9],
};

export function gripIntervals(c: Chord, count: 3 | 4): readonly number[] {
  const t = (count === 3 ? GRIP3 : GRIP4)[c.quality];
  if (t) return t;
  // fallback: rootless when rich, drop the 5th first
  let iv = [...c.tones];
  if (iv.length > count) iv = iv.filter((x) => x !== 0);
  while (iv.length > count && iv.includes(7)) iv = iv.filter((x) => x !== 7);
  return iv.slice(0, count);
}

export interface GripOpts {
  lo: number;
  hi: number;
  count: 3 | 4;
  /** semitones the voicing may stray outside [lo, hi] (penalised); default 5 */
  slack?: number;
  /** widest allowed voicing (default 16 for 3 notes, 19 for 4) */
  maxSpan?: number;
  /** notes other parts play on the same chord: a semitone / minor 9th against one of them is penalised */
  against?: readonly number[];
}

/** true if two voices of v (sorted) form a minor 2nd / minor 9th, or a low narrow interval */
export function rough(v: readonly number[], allowB9 = false): boolean {
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    if (d <= 1) return true;
    if (d < 3 && v[i - 1] < 55) return true;
  }
  if (!allowB9) for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (v[j] - v[i] === 13) return true;
  return false;
}

/** memo for grip(): a vamp asks for the same chord from the same previous voicing over and over */
const memo = new Map<string, number[]>();

/**
 * Voice-led, cluster-free rootless voicing of c (sorted midi). prev = the part's previous voicing (null at the start).
 */
export function grip(prev: readonly number[] | null, c: Chord, o: GripOpts): number[] {
  const key = `${c.name}|${o.lo},${o.hi},${o.count},${o.slack ?? ''},${o.maxSpan ?? ''}|${prev?.join(',') ?? ''}|${o.against?.join(',') ?? ''}`;
  const hit = memo.get(key);
  if (hit) return [...hit];
  const iv = gripIntervals(c, o.count);
  const n = iv.length;
  const slack = o.slack ?? 5;
  const lo = o.lo - slack, hi = o.hi + slack;
  const maxSpan = o.maxSpan ?? (o.count === 3 ? 16 : 19);
  const allowB9 = c.quality === '7b9' || c.quality === '7alt';
  const hendrix = c.quality === '7s9';
  const i3 = iv.indexOf(4), i9 = iv.indexOf(15);
  const places = iv.map((x) => {
    const p = pc(c.root + x);
    const out: number[] = [];
    for (let m = lo; m <= hi; m++) if (pc(m) === p) out.push(m);
    return out;
  });
  const centre = (o.lo + o.hi) / 2;
  const ps = prev ? [...prev].sort((a, b) => a - b) : null;
  const against = o.against ?? [];
  let best: number[] | null = null, bs = Infinity;
  const cur = new Array<number>(n).fill(0);
  const v = new Array<number>(n).fill(0);
  const score = (): void => {
    for (let i = 0; i < n; i++) {
      const x = cur[i];
      let j = i - 1;
      while (j >= 0 && v[j] > x) (v[j + 1] = v[j]), j--;
      v[j + 1] = x;
    }
    const span = v[n - 1] - v[0];
    if (span > maxSpan || rough(v, allowB9)) return;
    // 7#9: #9 on top (a major 7th above the 3rd, never a semitone under it); 3-note grips also put the 3rd at the bottom
    if (hendrix && (cur[i9] !== v[n - 1] || (n === 3 && cur[i3] !== v[0]))) return;
    // soft range: below lo costs more than above hi (low grips get muddy); wide spreads and holes cost a little
    let s = span > 12 ? 0.4 * (span - 12) : 0, sum = 0;
    for (let k = 0; k < n; k++) {
      const m = v[k];
      sum += m;
      if (m < o.lo) s += 2.5 * (o.lo - m);
      else if (m > o.hi) s += 1.5 * (m - o.hi);
      if (k > 0 && m - v[k - 1] > 9) s += 1.5;
      for (const x of against) if (Math.abs(m - x) === 1 || Math.abs(m - x) === 13) s += 5;
      if (ps) {
        if (ps.length === n) s += Math.abs(m - ps[k]);
        else {
          let d = Infinity;
          for (const q of ps) d = Math.min(d, Math.abs(q - m));
          s += d;
        }
      }
    }
    s += Math.abs(sum / n - centre) * (ps ? 0.15 : 0.5);
    if (s < bs) (bs = s), (best = v.slice());
  };
  const rec = (i: number): void => {
    if (i === n) return score();
    for (const m of places[i]) {
      cur[i] = m;
      rec(i + 1);
    }
  };
  rec(0);
  const out = best ?? voiceLead(prev, c, { lo: o.lo, hi: o.hi, count: o.count, rootless: true });
  if (memo.size > 4000) memo.clear();
  memo.set(key, out);
  return [...out];
}
