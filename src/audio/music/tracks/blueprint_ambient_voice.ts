/**
 * Private helper for "Blueprint" (blueprint_ambient.ts): melody-aware chord voicing.
 *
 * voiceChord() chooses WHICH chord tones to play and IN WHICH OCTAVE (inside [lo, hi]) by scoring every candidate:
 *   - smooth voice leading from the previous voicing and a sensible register / spacing (no minor-2nd clusters, no
 *     muddy close intervals low down, no holes),
 *   - the chord's character tones (3rd or sus 4th, 7th, the lydian #11, the 9th) are kept unless something forces them
 *     out; the root is left to the bass / sub in rootless voicings,
 *   - and - the reason this exists - the melody and glass notes that sound over the chord: a harmony note a semitone or
 *     a minor 9th from a sustained melody note, or a major 7th above it, blurs the top line, so such contacts cost a
 *     lot and the offending tone is re-voiced or left out (e.g. the maj7 is dropped while the melody holds the root).
 * A voicing may lose one voice when every full voicing rubs against the melody.
 */
import { voicing, type Chord } from '../theory';

/** a melody / glass note sounding over the chord, weighted by prominence (velocity, length, freshness) */
export interface Avoid {
  m: number;
  w: number;
}

export interface VoiceOpts {
  lo: number;
  hi: number;
  count: number;
  /** leave the root to the bass (default true) */
  rootless?: boolean;
  avoid?: readonly Avoid[];
  /** high layer: also keep harmony notes from sitting just above the melody (crowding the top line) */
  under?: boolean;
  /** register centre the voicing is drawn to (default the middle of [lo, hi]) */
  centre?: number;
}

const pcOf = (m: number): number => ((m % 12) + 12) % 12;

function subsets<T>(xs: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const cur: T[] = [];
  const rec = (i: number): void => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    if (xs.length - i < k - cur.length) return;
    cur.push(xs[i]);
    rec(i + 1);
    cur.pop();
    rec(i + 1);
  };
  rec(0);
  return out;
}

/** every assignment of one octave per pitch class inside [lo, hi], sorted ascending */
function placements(pcs: readonly number[], lo: number, hi: number): number[][] {
  let acc: number[][] = [[]];
  for (const p of pcs) {
    const next: number[][] = [];
    for (let m = lo; m <= hi; m++) if (pcOf(m) === p) for (const a of acc) next.push([...a, m]);
    acc = next;
    if (!acc.length) return [];
  }
  return acc.map((v) => v.sort((a, b) => a - b));
}

/** cost of the chosen chord tones (intervals above the root, mod 12); a character tone the melody itself is
 *  sounding (covered 0..1) may be left out of the harmony at little cost - the melody completes the chord */
function toneCost(all: ReadonlySet<number>, ivs: readonly number[], rootless: boolean, covered: (iv: number) => number): number {
  const has = (i: number) => ivs.includes(i);
  const miss = (i: number, c: number) => (all.has(i) && !has(i) ? c * (1 - 0.8 * covered(i)) : 0);
  let s = 0;
  const third = all.has(4) ? 4 : all.has(3) ? 3 : all.has(5) ? 5 : -1;
  if (third >= 0) s += miss(third, 8);
  const sev = all.has(11) ? 11 : all.has(10) ? 10 : -1;
  if (sev >= 0) s += miss(sev, 4);
  s += miss(6, 4); // the #11 of a maj7#11 (the lydian colour)
  s += miss(2, 1.2); // the 9th
  s += miss(9, 1);
  if (has(0)) s += rootless ? 2.5 : 0;
  else if (!rootless) s += 2;
  if (has(7)) s += 0.6; // the 5th is filler
  return s;
}

function shapeCost(v: readonly number[], centre: number): number {
  let s = 0;
  for (let i = 1; i < v.length; i++) {
    const g = v[i] - v[i - 1];
    if (g === 1) s += 6;
    if (g > 9) s += (g - 9) * 0.45;
    if (v[i - 1] < 52 && g < 4) s += 1.5;
  }
  const span = v[v.length - 1] - v[0];
  if (span > 19) s += (span - 19) * 0.3;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return s + Math.abs(mean - centre) * 0.15;
}

/** symmetric nearest-note distance (works when the voice count changes) */
function leadCost(v: readonly number[], prev: readonly number[] | null): number {
  if (!prev || !prev.length) return 0;
  let s = 0;
  for (const m of v) s += Math.min(...prev.map((p) => Math.abs(m - p)));
  for (const p of prev) s += Math.min(...v.map((m) => Math.abs(m - p)));
  return s * 0.5;
}

/** how badly harmony notes rub against the melody / glass notes sounding over them */
export function contactCost(notes: readonly number[], avoid: readonly Avoid[], under = false): number {
  let s = 0;
  for (const h of notes)
    for (const a of avoid) {
      const d = h - a.m;
      const ad = Math.abs(d);
      let c = ad === 1 ? 14 : ad === 13 ? 10 : d === 11 ? 6 : ad === 25 || d === 23 ? 2.5 : ad === 2 || d === 0 ? 1.2 : 0;
      if (under && d > 0 && d <= 4) c += 2;
      s += c * a.w;
    }
  return s;
}

export function voiceChord(c: Chord, prev: readonly number[] | null, o: VoiceOpts): number[] {
  const rootless = o.rootless ?? true;
  const allSet = new Set(c.tones.map((t) => t % 12));
  const ivs = [...allSet];
  const centre = o.centre ?? (o.lo + o.hi) / 2;
  const avoid = o.avoid ?? [];
  const kMax = Math.min(o.count, ivs.length);
  // how strongly the melody sounds each chord tone (by interval above the root)
  const cover = new Map<number, number>();
  for (const a of avoid) {
    const iv = pcOf(a.m - c.root);
    cover.set(iv, Math.min(1, (cover.get(iv) ?? 0) + a.w));
  }
  const covered = (iv: number) => cover.get(iv) ?? 0;
  let best: number[] = [];
  let bs = Infinity;
  for (const k of [kMax, kMax - 1]) {
    if (k < 2) continue;
    for (const sub of subsets(ivs, k)) {
      const tc = toneCost(allSet, sub, rootless, covered) + (k < kMax ? 4 : 0);
      if (tc >= bs) continue;
      for (const v of placements(sub.map((i) => (c.root + i) % 12), o.lo, o.hi)) {
        const s = tc + shapeCost(v, centre) + leadCost(v, prev) + contactCost(v, avoid, o.under);
        if (s < bs) (bs = s), (best = v);
      }
    }
  }
  return best.length ? best : voicing(c, { lo: o.lo, hi: o.hi, count: o.count, rootless });
}
