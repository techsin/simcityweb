/**
 * "Blueprint" - slow ambient piano over drifting detuned pads (Eno / late-night city-builder menu feel).
 *
 * Form (2-bar harmonic rhythm, ~60-66 bpm, no drums):
 *   intro 8   pads bloom in over a tonic pedal, glass harmonics, a first fragment of the motif + pickup
 *   theme 16  piano states the motif (call), glass echoes it, piano answers (response), sequences it up, and closes
 *             with a cadence variant (late arrival / ti-re-do appoggiatura)
 *   drift 16  aeolian turn to the relative minor: the motif in augmentation on glass, piano answers in the middle
 *             register (the second answer settles on la), the high pad layer grows, riser into the next section
 *   hush 4    (most seeds) breakdown: the high pad dissolves, dark pad, sub, one slow motif fragment and a bell
 *   bloom 16  the theme in octaves over the fullest texture; the sequence climbs to the song's high point; the closing
 *             response stays open (ends on mi) - the tonic arrival is saved for the coda
 *   coda 8    a last soft call, glass echo, then a plagal close onto a held, rolled tonic chord with ritardando
 * Every play re-rolls: key, tempo, the theme / drift / lift / coda progressions (composed sets), whether the hush
 * appears, the motif (3 composed motifs with call + response forms), its variations (split / passing / neighbour notes,
 * anticipations - every varied restatement really differs), cadence forms, sequence intervals, left-hand patterns, pad
 * waveform + detune, glass / bell placements and fills, tempo breathing and the sub's swells.
 * The whole plan is computed in create() - melody first, then every harmony voicing is chosen AROUND it (see
 * blueprint_ambient_voice.ts: no semitone / minor-9th rubs against sustained melody notes) - and bar() only schedules.
 *
 * Time feel: piano phrases breathe (late entries, a little push through the middle, a late settle onto the last
 * note, +-28 ms humanising), the tempo breathes +-2-3 % (slow drift + a lean into each melody phrase), the last bar
 * of every section eases ~4 % and the hush sits a little slower; ritardando into the final chord.
 *
 * Layers: soft piano (left hand = spread broken chords, sparse while the melody sings; 'piano:lead' = melody), low
 * saw/square pad summed to mono (warm bed, its lowpass morphs continuously and glides across section changes), high
 * saw pad + octave shimmer note (stereo width), glass echoes, FM bell harmonics, noise riser, plus two small LOCAL
 * instruments built from plain nodes: a mono sine sub ('pad:sub': one note per bass pitch, crossfaded at bass changes,
 * gentle random internal swells) and a very quiet breathing "air" noise band (4.5-10 kHz, in 'pad:hi') - the library
 * pad's hard-L/R detuned pair decorrelates a sustained low end, and nothing else in the palette supplies top-octave air
 * without drums.
 */
import type { RNG } from '../../../core/rng';
import type { MusicEnv, MusicTrack } from '../types';
import { song, type BarInfo, type SongPlayer } from '../song';
import { parseChord, transposeChord, chord, chordTones, bassNote, humanize, humVel, pc, type Chord } from '../theory';
import { voiceChord, contactCost, type Avoid } from './blueprint_ambient_voice';

type Kind = 'intro' | 'theme' | 'drift' | 'hush' | 'bloom' | 'coda';
/** [beat within the phrase, scale degree (0 = key tonic, 7 = octave), duration in beats] */
type MN = readonly [number, number, number];
const N = (b: number, d: number, u: number): MN => [b, d, u];

interface Motif {
  call: MN[];
  resp: MN[];
}

// Three composed motifs. `call` ends open (3rd / 9th), `resp` closes on the tonic.
const MOTIFS: Motif[] = [
  // "sigh": sol - mi re mi ...  /  sol - mi re ti do
  { call: [[0, 4, 1.5], [1.5, 2, 0.5], [2, 1, 2], [4, 2, 3.5]], resp: [[0, 4, 1.5], [1.5, 2, 0.5], [2, 1, 1], [3, -1, 1], [4, 0, 3.5]] },
  // "fifths": do sol re' - mi'  /  do sol re' ti do'
  { call: [[0, 0, 1], [1, 4, 1], [2, 8, 2], [4, 9, 3.5]], resp: [[0, 0, 1], [1, 4, 1], [2, 8, 1.5], [3.5, 6, 0.5], [4, 7, 3.5]] },
  // "descent": do' ti sol - la sol  /  do' ti sol - mi re do
  { call: [[0, 7, 1], [1, 6, 1], [2, 4, 2], [4, 5, 1.5], [5.5, 4, 2.5]], resp: [[0, 7, 1], [1, 6, 1], [2, 4, 2], [4, 2, 1.5], [5.5, 1, 0.5], [6, 0, 2]] },
];

// Progressions in C (transposed per play). One entry = one 2-bar slot; two symbols split the slot.
const INTROS = [
  ['Cmaj9', 'Fmaj7s11', 'Cmaj9', 'Dadd9'],
  ['Cmaj9', 'Am9', 'Fmaj7s11', 'G9sus4'],
  ['Cadd9', 'Fmaj9', 'Cmaj9', 'G9sus4'],
];
const THEMES = [
  { a: ['Cmaj9', 'Dadd9/C', 'Am9', 'Fmaj7s11'], b: ['Cmaj9', 'Dadd9/C', 'Am9', 'Fmaj7s11 G9sus4'] },
  { a: ['Cmaj9', 'Em7/B', 'Am9', 'Fmaj7s11'], b: ['Cmaj9', 'Em7/B', 'Am9', 'Dm9 G9sus4'] },
  { a: ['Fmaj7s11', 'Cmaj9/E', 'Dm9', 'G9sus4'], b: ['Fmaj7s11', 'Cmaj9/E', 'Am9', 'G9sus4'] },
];
const DRIFTS = [
  { a: ['Am9', 'Fmaj9', 'Dm9', 'Em7'], b: ['Am9', 'Fmaj9', 'Dm9', 'G9sus4'] },
  { a: ['Am9', 'Em7/G', 'Fmaj7s11', 'Em7'], b: ['Am9', 'Em7/G', 'Fmaj7s11', 'G9sus4'] },
  { a: ['Dm9', 'Am9', 'Bbmaj7s11', 'Fmaj9/A'], b: ['Dm9', 'Am9', 'Bbmaj7s11', 'G9sus4'] },
];
const HUSHES = [['Fmaj7s11', 'Fmaj7s11'], ['Am9', 'Fmaj7s11'], ['Dm9', 'G9sus4']];
const LIFTS = [
  ['Am9', 'Fmaj7s11', 'Cmaj9/E', 'G9sus4'],
  ['Fmaj7s11', 'Gadd9/F', 'Em7', 'Am9'],
  ['Dm9', 'Cmaj9/E', 'Fmaj7s11', 'G9sus4'],
];
const CODAS = [['Fmaj7s11', 'G9sus4'], ['Dm9', 'Fmaj7s11'], ['Am9', 'Fmaj7s11']];
const FINALS = ['Cmaj9', 'Cadd9', 'Cmaj7s11'];

/** left-hand patterns: [beat, index into the spread chord (0 = bass, 1 = 5th / octave, 2..4 = upper voices)] per slot */
const LH: Record<string, readonly (readonly [number, number])[]> = {
  drone: [[0, 0], [0.12, 1], [2, 3]],
  roll: [[0, 0], [0.07, 1], [0.14, 2], [0.21, 3], [0.28, 4]],
  rise: [[0, 0], [1, 1], [2, 2], [3, 3], [5, 4]],
  p332: [[0, 0], [1.5, 1], [3, 2], [4, 3], [5.5, 2], [7, 4]],
  wave: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 3], [6, 2], [7, 1]],
  float: [[0, 0], [0.5, 2], [2.5, 3], [4.5, 4], [6, 2]],
  sparse: [[0, 0], [0.1, 1], [3, 3], [6, 4]],
  bass: [[0, 0], [0.1, 1]],
};

interface Ev {
  /** absolute beat of the nominal onset */
  ab: number;
  /** held length in beats */
  dur: number;
  midi: number;
  vel: number;
  /** timing offset in seconds (phrase agogics + humanising), fixed in create() */
  dt: number;
  /** hold until the end of the song (final chord) */
  toEnd?: boolean;
}
interface PadEv {
  ab: number;
  dur: number;
  notes: number[];
  vel: number;
  layer: 'pad' | 'hi';
  attack: number;
  release: number;
  cutoff: number;
  wave: 'saw' | 'tri' | 'square';
  detune: number;
  toEnd?: boolean;
}
interface SubEv {
  ab: number;
  /** absolute beat of the next bass change (the note releases just after it) */
  end: number;
  midi: number;
  vel: number;
  /** level reached at the end of the attack, 0..1 */
  lv0: number;
  /** seconds */
  attack: number;
  release: number;
  /** gentle internal swells: [absolute beat, level 0..1] */
  pts: [number, number][];
  toEnd?: boolean;
}
interface BarPlan {
  lh: Ev[];
  mel: Ev[];
  glass: Ev[];
  bell: Ev[];
  pads: PadEv[];
  subs: SubEv[];
  sweeps: { ab: number; dur: number; vel: number }[];
  /** air swells: level 0..1 (x AIR) over `beats`; off = noise buffer offset */
  air: { ab: number; beats: number; level: number; off: number }[];
}
interface Seg {
  beat: number;
  beats: number;
  chord: Chord;
  pedal: Chord;
  slot: number;
}
interface Slot {
  kind: Kind;
  idx: number;
  /** absolute beat of the slot start */
  beat: number;
  beats: number;
  segs: Seg[];
}

// ---------------------------------------------------------------- phrase transformations
const seq = (ph: readonly MN[], k: number): MN[] => ph.map(([b, d, u]) => N(b, d + k, u));
const invert = (ph: readonly MN[]): MN[] => ph.map(([b, d, u]) => N(b, 2 * ph[0][1] - d, u));
const augment = (ph: readonly MN[], f: number): MN[] => ph.map(([b, d, u]) => N(b * f, d, u * f));
/** the last n notes, re-timed to start at 0 and stretched a little (an echo) */
const echo = (ph: readonly MN[], n: number, stretch = 1.25): MN[] => {
  const t = ph.slice(-n);
  const b0 = t[0][0];
  return t.map(([b, d, u]) => N((b - b0) * stretch, d, Math.max(1, u * stretch)));
};
const sameShape = (a: readonly MN[], b: readonly MN[]): boolean => a.length === b.length && a.every((n, i) => n[0] === b[i][0] && n[1] === b[i][1] && n[2] === b[i][2]);

/** the degree a split note moves to before `next`: a passing step toward a leap, the far-side neighbour before a
 *  step (never the next note itself - no repeated notes) */
function nbFor(rng: RNG, d: number, next: number): number {
  const gap = next - d;
  if (gap === 0) return d + (rng.chance(0.6) ? 1 : -1);
  return Math.abs(gap) >= 2 ? d + Math.sign(gap) : d - Math.sign(gap);
}
/** split the longest inner note (>= 1.5 beats) into note + neighbour */
function splitLong(rng: RNG, ph: readonly MN[]): MN[] | null {
  let bi = -1;
  for (let i = 1; i < ph.length - 1; i++) if (ph[i][2] >= 1.5 && (bi < 0 || ph[i][2] > ph[bi][2])) bi = i;
  if (bi < 0) return null;
  const [b, d, u] = ph[bi];
  return [...ph.slice(0, bi), N(b, d, u / 2), N(b + u / 2, nbFor(rng, d, ph[bi + 1][1]), u / 2), ...ph.slice(bi + 1)];
}
/** fill a third (a note of >= 1 beat followed by a skip of two degrees) with a passing note */
function passing(rng: RNG, ph: readonly MN[]): MN[] | null {
  const cand: number[] = [];
  for (let i = 0; i < ph.length - 1; i++) if (Math.abs(ph[i + 1][1] - ph[i][1]) === 2 && Math.min(ph[i][2], ph[i + 1][0] - ph[i][0]) >= 1) cand.push(i);
  if (!cand.length) return null;
  const i = rng.pick(cand);
  const [b, d, u] = ph[i];
  const gap = ph[i + 1][0] - b;
  const h = Math.max(0.5, Math.round(Math.min(u, gap)) / 2); // stay on the 8th grid
  return [...ph.slice(0, i), N(b, d, h), N(b + h, d + Math.sign(ph[i + 1][1] - d), gap - h), ...ph.slice(i + 1)];
}
/** anticipate an inner on-beat note by an 8th (only into a free 8th) */
function anticipate(rng: RNG, ph: readonly MN[]): MN[] | null {
  const cand: number[] = [];
  for (let i = 1; i < ph.length - 1; i++) if (ph[i][0] % 1 === 0 && ph[i][2] >= 1 && ph[i - 1][0] <= ph[i][0] - 1) cand.push(i);
  if (!cand.length) return null;
  const i = rng.pick(cand);
  const [b, d, u] = ph[i];
  return [...ph.slice(0, i), N(b - 0.5, d, u + 0.5), ...ph.slice(i + 1)];
}
/** move a short inner note to a neighbouring degree (never onto the pitch of the notes around it) */
function neighbour(rng: RNG, ph: readonly MN[]): MN[] | null {
  const cand: [number, number][] = [];
  for (let i = 1; i < ph.length - 1; i++) {
    if (ph[i][2] > 1.5) continue;
    for (const s of [1, -1]) {
      const d = ph[i][1] + s;
      if (d !== ph[i - 1][1] && d !== ph[i + 1][1]) cand.push([i, d]);
    }
  }
  if (!cand.length) return null;
  const [i, d] = rng.pick(cand);
  return ph.map((n, j) => (j === i ? N(n[0], d, n[2]) : n));
}
/** light variation; with amt >= 0.3 at least one change is guaranteed, so a "varied" restatement is never literal */
function vary(rng: RNG, ph: readonly MN[], amt: number): MN[] {
  let out: MN[] = [];
  ph.forEach(([b, d, u], i) => {
    const inner = i > 0 && i < ph.length - 1;
    if (inner && u >= 2 && rng.chance(amt * 0.7)) {
      out.push(N(b, d, u / 2), N(b + u / 2, nbFor(rng, d, ph[i + 1][1]), u / 2));
      return;
    }
    const prev = out[out.length - 1];
    if (i > 0 && u >= 1 && b % 1 === 0 && prev && prev[0] <= b - 1 && rng.chance(amt * 0.45)) {
      out.push(N(b - 0.5, d, u + 0.5));
      return;
    }
    out.push(N(b, d, u));
  });
  if (rng.chance(amt * 0.35)) out = passing(rng, out) ?? out;
  if (amt >= 0.3 && sameShape(out, ph)) {
    for (const f of rng.shuffle([splitLong, passing, anticipate, neighbour])) {
      const r = f(rng, out);
      if (r) {
        out = r;
        break;
      }
    }
  }
  return out;
}
/** cadence variant: the final note arrives half a beat late, the note before it is held into it */
function lateArrival(ph: readonly MN[]): MN[] {
  const n = ph.length;
  return ph.map(([b, d, u], i) => (i === n - 2 ? N(b, d, u + 0.5) : i === n - 1 ? N(b + 0.5, d, Math.max(1, u - 0.5)) : N(b, d, u)));
}
/** cadence variant: the degree above the final note on its beat, resolving a beat later (e.g. ti - re - do) */
function appoggiatura(ph: readonly MN[]): MN[] | null {
  const n = ph.length;
  const [b, d, u] = ph[n - 1];
  if (u < 2 || ph[n - 2][1] === d + 1) return null;
  return [...ph.slice(0, n - 1), N(b, d + 1, 1), N(b + 1, d, u - 1)];
}
/** open ending: the final tonic becomes degree `to` (2 mi, 5 la) nearest the note before it, reached by step, held
 *  a little longer */
function openEnd(ph: readonly MN[], to: number): MN[] {
  const out = ph.map(([b, d, u]) => [b, d, u]);
  const last = out[out.length - 1], pen = out[out.length - 2];
  let d = Math.floor(last[1] / 7) * 7 + to;
  for (const c of [d - 7, d + 7]) if (Math.abs(c - pen[1]) < Math.abs(d - pen[1])) d = c;
  last[1] = d;
  last[2] = Math.min(last[2] + 1.5, 8 - last[0]);
  if (Math.abs(pen[1] - d) > 2 || pen[1] === d) pen[1] = d + 1;
  if (out.length >= 3 && out[out.length - 3][1] === pen[1]) pen[1] = d - 1;
  return out.map(([b, dd, u]) => N(b, dd, u));
}
const meanDeg = (ph: readonly MN[]): number => ph.reduce((s, n) => s + n[1], 0) / ph.length;

/**
 * Local instrument: MONO sine sub (sine + soft octave). One note per bass pitch: a slow linear attack, gentle random
 * swells at the given breakpoints, a hold until just after the next bass change, then a linear release that
 * crossfades with the next note (no deep dips, no clock-locked pumping). The library pad puts its detuned oscillator
 * pair hard L/R, which decorrelates a sustained low end completely, so the sub is built here from plain nodes and routed
 * into the 'pad:sub' channel (envelope 0 -> 0, honours cutoff, starts late instead of vanishing after a live stall,
 * and the lab's mute / solo as 'sub').
 */
function subVoice(env: MusicEnv, t0: number, m: number, amp: number, lv0: number, attack: number, pts: readonly (readonly [number, number])[], tEnd: number, release: number): void {
  const { ctx, inst } = env;
  if (!isFinite(t0) || t0 >= inst.cutoff) return;
  if (inst.mute.has('sub') || (inst.solo.size && !inst.solo.has('sub') && !inst.solo.has('pad:sub'))) return;
  let t = t0, att = attack;
  const now = env.live ? ctx.currentTime + 0.03 : -Infinity;
  if (t < now) {
    if (tEnd + release * 0.5 < now + 1) return;
    t = now;
    att = Math.min(attack, 1);
  }
  const f = 440 * Math.pow(2, (m - 69) / 12);
  const peak = 0.048 * Math.pow(Math.max(0, Math.min(1, amp)), 1.5);
  const g = inst.node.gain(0);
  g.gain.setValueAtTime(0, t);
  let last = t + att, lv = lv0;
  g.gain.linearRampToValueAtTime(peak * lv, last);
  for (const [pt, pl] of pts)
    if (pt > last + 0.25 && pt < tEnd - 0.25) {
      g.gain.linearRampToValueAtTime(peak * pl, pt);
      (last = pt), (lv = pl);
    }
  const tR = Math.max(last, tEnd), end = tR + release;
  g.gain.linearRampToValueAtTime(peak * lv, tR);
  g.gain.linearRampToValueAtTime(0, end);
  const o1 = ctx.createOscillator();
  o1.frequency.value = f;
  const o2 = ctx.createOscillator();
  o2.frequency.value = f * 2;
  const g2 = inst.node.gain(0.22);
  o1.connect(g);
  o2.connect(g2).connect(g);
  g.connect(inst.channel('pad:sub').input);
  for (const o of [o1, o2]) {
    o.start(t);
    o.stop(end + 0.05);
  }
}

/**
 * Local instrument: "air" - band-limited noise (4.5-10 kHz) with a slow breathing envelope, the breath layer of the
 * high pad (routed into 'pad:hi'). Very quiet: it only adds the top-octave shimmer the dark piano / pads lack.
 */
function airSwell(env: MusicEnv, t: number, attack: number, hold: number, release: number, level: number, offset: number): void {
  const { ctx, inst } = env;
  if (!isFinite(t) || t >= inst.cutoff || (env.live && t < ctx.currentTime)) return;
  if (inst.mute.has('air') || (inst.solo.size && !inst.solo.has('air'))) return;
  const tA = t + attack, tR = tA + hold, end = tR + release;
  const src = ctx.createBufferSource();
  src.buffer = env.noise;
  src.loop = true;
  const hp = inst.node.filter('highpass', 4500, 0.5);
  const lp = inst.node.filter('lowpass', 10000, 0.5);
  const g = inst.node.gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, tA);
  g.gain.setValueAtTime(level, tR);
  g.gain.exponentialRampToValueAtTime(level * 1e-3, end);
  g.gain.linearRampToValueAtTime(0, end + 0.02);
  src.connect(hp).connect(lp).connect(g).connect(inst.channel('pad:hi').input);
  src.start(t, Math.min(offset, Math.max(0, env.noise.duration - 0.1)));
  src.stop(end + 0.05);
}

export const track: MusicTrack = {
  id: 'blueprint_ambient',
  title: 'Blueprint',
  mood: 'Slow ambient piano over drifting detuned pads, glass harmonics and sub swells',
  tags: ['menu', 'region', 'calm', 'night'],
  bpm: 62,
  gain: 1.87, // measured -23.75 LUFS mean over seeds 1-3 at gain 1 -> about -18.3
  create(env) {
    const { inst, rng } = env;
    const bpm = rng.int(60, 66);
    inst.bpm = bpm;
    const T = rng.pick([-4, -3, -2, 0, 2, 3]); // Ab A Bb C D Eb
    const key = (T + 12) % 12;
    const R = 72 + T; // melody tonic reference (degree 0)
    const ch = (s: string): Chord => transposeChord(parseChord(s), T);

    // ---------------------------------------------------------------- form + chords
    const theme = rng.pick(THEMES), drift = rng.pick(DRIFTS), lift = rng.pick(LIFTS);
    const intro = rng.pick(INTROS);
    const hushOn = rng.chance(0.7);
    const hushOpts = HUSHES.filter((h) => h[h.length - 1] !== theme.a[0]);
    const hush = rng.pick(hushOpts.length ? hushOpts : HUSHES);
    const codaOpts = CODAS.filter((c) => c[0] !== lift[lift.length - 1]);
    const coda = rng.pick(codaOpts.length ? codaOpts : CODAS);
    const finalSym = rng.weighted(FINALS, [0.45, 0.25, 0.3]);
    const M = rng.pick(MOTIFS);

    const form: { name: string; kind: Kind; slots: { syms: string[]; bars: number }[] }[] = [];
    const add = (name: string, kind: Kind, syms: string[], lastBars = 2) =>
      form.push({ name, kind, slots: syms.map((s, i) => ({ syms: s.split(' '), bars: i === syms.length - 1 ? lastBars : 2 })) });
    add('intro', 'intro', intro);
    add('theme', 'theme', [...theme.a, ...theme.b]);
    add('drift', 'drift', [...drift.a, ...drift.b]);
    if (hushOn) add('hush', 'hush', hush);
    add('bloom', 'bloom', [...theme.a, ...lift]);
    add('coda', 'coda', [...coda, finalSym], 4);

    const tonic = chord(key, 'maj');
    const slots: Slot[] = [];
    const secStartSlot: number[] = [];
    const secBeat: number[] = [];
    let beat = 0;
    for (const s of form) {
      secStartSlot.push(slots.length);
      secBeat.push(beat);
      s.slots.forEach((d, idx) => {
        const beats = d.bars * 4;
        const segBeats = beats / d.syms.length;
        const si = slots.length;
        const segs = d.syms.map((sym, k) => {
          const c = ch(sym);
          return { beat: beat + k * segBeats, beats: segBeats, chord: c, pedal: s.kind === 'intro' ? chord(c.root, c.quality, tonic.root) : c, slot: si };
        });
        slots.push({ kind: s.kind, idx, beat, beats, segs });
        beat += beats;
      });
    }
    const totalBeats = beat;
    const total = totalBeats / 4;
    secBeat.push(totalBeats);
    const timeline = slots.flatMap((s) => s.segs);
    const segAt = (ab: number) => {
      let r = timeline[0];
      for (const s of timeline) if (ab >= s.beat - 1e-6) r = s;
      return r;
    };
    const nextChange = (ab: number): number => {
      for (const s of timeline) if (s.beat > ab + 1e-6) return s.beat;
      return totalBeats;
    };
    const secAt = (ab: number): number => {
      let i = 0;
      while (i + 1 < form.length && ab >= secBeat[i + 1] - 1e-6) i++;
      return i;
    };

    // ---------------------------------------------------------------- plan
    const plan: BarPlan[] = Array.from({ length: total }, () => ({ lh: [], mel: [], glass: [], bell: [], pads: [], subs: [], sweeps: [], air: [] }));
    const barOf = (ab: number) => Math.min(total - 1, Math.max(0, Math.floor(ab / 4 + 1e-6)));
    const allMel: Ev[] = [], allGlass: Ev[] = [];
    const put = (list: 'lh' | 'mel' | 'glass' | 'bell', ab: number, e: Omit<Ev, 'ab'>) => {
      if (ab >= totalBeats || ab < 0) return;
      const ev: Ev = { ...e, ab };
      plan[barOf(ab)][list].push(ev);
      if (list === 'mel') allMel.push(ev);
      else if (list === 'glass') allGlass.push(ev);
    };
    const putPad = (e: PadEv) => plan[barOf(e.ab)].pads.push(e);

    // melody pitch: key scale with each chord's chromatic tones substituted for the scale tone a semitone BELOW them
    // first (so D/C gives the lydian #4: F -> F#, and Bbmaj7#11 the aeolian b7: B -> Bb)
    const MAJOR = [0, 2, 4, 5, 7, 9, 11];
    const pcsOf = (c: Chord): number[] => [...c.tones.map((t) => (c.root + t) % 12), c.bass];
    const poolFor = (c: Chord): number[] => {
      const pcs = MAJOR.map((iv) => (key + iv) % 12);
      const ct = pcsOf(c);
      for (const t of ct) {
        if (pcs.includes(t)) continue;
        for (const d of [1, -1]) {
          const i = pcs.indexOf((t - d + 12) % 12);
          if (i >= 0 && !ct.includes(pcs[i])) {
            pcs[i] = t;
            break;
          }
        }
      }
      return pcs.map((p) => (p - key + 12) % 12).sort((a, b) => a - b);
    };
    const isCT = (m: number, c: Chord) => pcsOf(c).includes(pc(m));
    /** avoid notes: a semitone above a chord tone (b9 / natural 4 over major), or the major 3rd over a sus chord */
    const clash = (m: number, c: Chord): boolean => {
      const p = pc(m);
      const ct = pcsOf(c);
      if (ct.includes(p)) return false;
      if (c.quality.includes('sus') && (p - c.root + 12) % 12 === 4) return true;
      return ct.some((t) => (p - t + 12) % 12 === 1);
    };
    /** degree -> midi over the chord at `ab`; strong notes that clash move to the nearest good neighbour,
     *  preferring the direction the line is already moving (dir) and avoiding the pitches around it (no repeats) */
    const realize = (ab: number, deg: number, strong: boolean, dir = 0, exclude: readonly number[] = []): number => {
      const c = segAt(ab).chord;
      const pool = poolFor(c);
      const at = (d: number) => R + 12 * Math.floor(d / 7) + pool[((d % 7) + 7) % 7];
      if (!strong || !clash(at(deg), c)) return at(deg);
      let best = at(deg), bs = Infinity;
      for (const dd of [-1, 1, -2, 2]) {
        const m = at(deg + dd);
        const s = (clash(m, c) ? 100 : 0) + (exclude.includes(m) ? 20 : 0) + (isCT(m, c) ? 0 : 0.5) + Math.abs(dd) - (Math.sign(dd) === Math.sign(dir) ? 0.3 : 0);
        if (s < bs) (bs = s), (best = m);
      }
      return best;
    };
    /** octave (in degrees) that puts a phrase's mean pitch nearest `target` */
    const regFor = (ph: readonly MN[], target: number): number => {
      const md = meanDeg(ph);
      let best = 0, bd = Infinity;
      for (const k of [-2, -1, 0, 1]) {
        const d = Math.abs(R + (md + 7 * k) * (12 / 7) - target);
        if (d < bd) (bd = d), (best = k * 7);
      }
      return best;
    };

    interface PhraseOpts {
      voice: 'mel' | 'glass';
      reg: number;
      vel: number;
      offset?: number;
      /** double the piano an octave below (bloom) */
      oct?: boolean;
      /** add a quiet glass shimmer an octave above the long notes */
      shimmer?: boolean;
      max?: number;
    }
    /** slots in which a piano phrase starts (the left hand thins out under them, the tempo leans into them) */
    const melSlots = new Set<Slot>();
    const phrase = (slot: Slot, ph: readonly MN[], o: PhraseOpts): void => {
      const off = o.offset ?? 0;
      const glass = o.voice === 'glass';
      if (!glass) melSlots.add(slot);
      // anything that is heard as harmony (on a strong beat, or a beat or longer - the pedal holds it) must fit it;
      // a second pass re-snaps a moved note that landed on the pitch of the note after it
      const fit = (i: number, exclude: readonly number[]) => {
        const [b, d, u] = ph[i];
        const ab = slot.beat + off + b;
        let m = realize(ab, d + o.reg, b % 2 === 0 || ab % 2 === 0 || u >= 1, i > 0 ? d - ph[i - 1][1] : 0, exclude);
        while (m > (o.max ?? (glass ? 93 : 88))) m -= 12;
        return m;
      };
      const ms: number[] = [];
      ph.forEach((_, i) => ms.push(fit(i, i > 0 ? [ms[i - 1]] : [])));
      for (let i = 0; i + 1 < ms.length; i++) if (ms[i] === ms[i + 1]) ms[i] = fit(i, [ms[i + 1], ...(i > 0 ? [ms[i - 1]] : [])]);
      const lo = Math.min(...ms), hi = Math.max(...ms);
      const n = ph.length;
      // agogics: the phrase breathes in late, moves on through its middle and settles late onto its last note
      const lead = glass ? rng.range(0.01, 0.04) : rng.range(0.04, 0.09);
      const settle = glass ? rng.range(0, 0.03) : rng.range(0.03, 0.07);
      ph.forEach(([b, , u], i) => {
        const ab = slot.beat + off + b;
        const m = ms[i];
        const last = i === n - 1;
        const arc = 0.92 + 0.14 * ((m - lo) / Math.max(1, hi - lo)) + (i === 0 ? 0.03 : 0) - (last ? 0.08 : 0);
        // a dissonant passing note is played lighter and dry (no pedal overlap into its resolution)
        const passingNote = clash(m, segAt(ab).chord);
        const vel = humVel(rng, o.vel * arc * (passingNote ? 0.94 : 1), 0.04);
        const dt = (i === 0 ? lead : last ? settle : i === n - 2 ? settle * 0.4 : -0.012) + humanize(rng, 0, glass ? 14 : 28);
        if (glass) {
          put('glass', ab, { dur: u, midi: m, vel, dt });
          return;
        }
        // held to the next chord change (pedal), phrase-final notes a little longer
        const dur = passingNote ? u : Math.min(u * (last ? 1.45 : 1.3) + (last ? 0.6 : 0.4), Math.max(u, nextChange(ab) - ab - 0.06));
        put('mel', ab, { dur, midi: m, vel, dt });
        if (o.oct && m - 12 >= 58) put('mel', ab + 0.03, { dur, midi: m - 12, vel: vel * 0.42, dt });
        if (o.shimmer && u >= 2 && m + 12 <= 93) put('glass', ab + 0.03, { dur: u, midi: m + 12, vel: vel * 0.42, dt });
      });
    };

    // ---------------------------------------------------------------- per-seed colour
    const padWave: 'saw' | 'square' = rng.chance(0.75) ? 'saw' : 'square';
    const driftWave: 'saw' | 'square' = rng.chance(0.5) ? 'square' : padWave;
    const detune = rng.range(8, 14);
    const seqK = rng.pick([1, 2]);
    const climaxK = seqK + 1; // the bloom climbs one step past the theme's sequence
    const echoN = rng.pick([2, 3]);
    const bellRatio = rng.pick([3.5, 5]);

    /** a high chord tone that neither clashes with the chord nor rubs against the melody around it */
    const topTone = (c: Chord, lo: number, hi: number, av: readonly Avoid[] = []): number => {
      const ts = chordTones(c, lo, hi).filter((m) => !clash(m, c)).slice(-3);
      const ok = ts.filter((m) => contactCost([m], av) < 4);
      return ts.length ? rng.pick(ok.length ? ok : ts) : lo + ((c.root - lo) % 12 + 12) % 12;
    };

    // ---------------------------------------------------------------- melody, echoes, fills (planned first)
    const S = (kind: Kind, idx: number) => slots[secStartSlot[form.findIndex((f) => f.kind === kind)] + idx];
    const has = (kind: Kind) => form.some((f) => f.kind === kind);
    const lastBarBeat = (kind: Kind) => {
      const i = form.findIndex((f) => f.kind === kind);
      return secBeat[i + 1] - 4;
    };
    /** glass arpeggio in the last two beats of a section, from the tones of the chord that follows that also sit well
     *  over the chord still sounding (no major 3rd over a sus4, no b9) */
    const glassFill = (ab: number, up: boolean, v = 0.26) => {
      const next = segAt(ab + 4).chord, cur = segAt(ab + 2).chord;
      let ts = chordTones(next, 76, 91).filter((m) => !clash(m, next) && !clash(m, cur));
      ts = up ? ts.slice(0, 4) : ts.slice(-4).reverse();
      ts.forEach((m, i) => put('glass', ab + 2 + i * 0.5, { dur: 2.5, midi: m, vel: humVel(rng, v * (up ? 0.85 + 0.08 * i : 1 - 0.07 * i), 0.03), dt: humanize(rng, 0, 10) + i * 0.015 }));
    };
    /** a step into the next phrase's first note: the scale step below, else the one above; skipped if both clash */
    const pickup = (slotNext: Slot, first: MN, reg: number, v: number) => {
      const ab = slotNext.beat - 0.5;
      const c = segAt(ab).chord;
      const target = realize(slotNext.beat, first[1] + reg, true);
      for (const s of [-1, 1]) {
        const m = realize(ab, first[1] + reg + s, false);
        if (m !== target && !clash(m, c) && !clash(m, segAt(slotNext.beat).chord)) {
          put('mel', ab, { dur: 0.55, midi: m, vel: v, dt: 0.02 + humanize(rng, 0, 20) });
          return;
        }
      }
    };

    const regTheme = regFor(M.call, 75);
    // intro: glass harmonics, a fragment of the call, and a pickup into the theme
    {
      const s0 = S('intro', 0), s1 = S('intro', 1), s2 = S('intro', 2), s3 = S('intro', 3);
      for (const [s, beats] of [[s0, [2.5, 5.5]], [s1, [3]], [s3, [1.5, 5]]] as const)
        for (const b of beats) put('glass', s.beat + b + rng.range(-0.25, 0.25), { dur: 4, midi: topTone(s.segs[0].chord, 81, 91), vel: humVel(rng, 0.25, 0.04), dt: humanize(rng, 0, 12) });
      phrase(s2, M.call.slice(0, 3), { voice: 'mel', reg: regTheme, vel: 0.46 });
      pickup(S('theme', 0), M.call[0], regTheme, 0.42);
    }
    // theme: call / echo / response / sequence / echo / closing response (a cadence variant, not the literal answer)
    {
      const call = M.call, resp = vary(rng, M.resp, 0.4), dev = seq(vary(rng, M.call, 0.35), seqK);
      const close = (rng.chance(0.55) ? appoggiatura(M.resp) : null) ?? lateArrival(M.resp);
      phrase(S('theme', 0), call, { voice: 'mel', reg: regTheme, vel: 0.56 });
      phrase(S('theme', 1), echo(call, echoN), { voice: 'glass', reg: regTheme + 7, vel: 0.32, offset: 1 });
      phrase(S('theme', 2), resp, { voice: 'mel', reg: regTheme, vel: 0.54 });
      phrase(S('theme', 4), dev, { voice: 'mel', reg: regTheme, vel: 0.58 });
      phrase(S('theme', 5), echo(dev, 2), { voice: 'glass', reg: regTheme + 7, vel: 0.3, offset: 1.5 });
      phrase(S('theme', 6), close, { voice: 'mel', reg: regTheme, vel: 0.54 });
      glassFill(lastBarBeat('theme'), false);
    }
    // drift: the call in augmentation on glass, the piano answers low (the second answer settles on la); riser out
    {
      const regG = regFor(M.call, 80);
      const inv = invert(vary(rng, M.resp, 0.5)), ans = openEnd(vary(rng, M.resp, 0.3), 5);
      phrase(S('drift', 0), augment(M.call, 2), { voice: 'glass', reg: regG, vel: 0.34 });
      phrase(S('drift', 2), inv, { voice: 'mel', reg: regFor(inv, 70), vel: 0.52 });
      phrase(S('drift', 4), augment(seq(M.call, -2), 2), { voice: 'glass', reg: regG, vel: 0.34 });
      phrase(S('drift', 6), ans, { voice: 'mel', reg: regFor(ans, 70), vel: 0.52 });
      const lb = lastBarBeat('drift');
      if (has('hush')) glassFill(lb, false, 0.22);
      else {
        plan[barOf(lb - 4)].sweeps.push({ ab: lb - 4, dur: 8, vel: 0.2 });
        glassFill(lb, true);
        pickup(S('bloom', 0), M.call[0], regFor(M.call, 77), 0.44);
      }
    }
    // hush: one slow fragment, then a riser + pickup into the bloom
    if (has('hush')) {
      phrase(S('hush', 0), augment(M.call.slice(0, 2), 2), { voice: 'mel', reg: regTheme, vel: 0.42 });
      const lb = lastBarBeat('hush');
      plan[barOf(lb - 4)].sweeps.push({ ab: lb - 4, dur: 8, vel: 0.2 });
      glassFill(lb, true, 0.22);
      pickup(S('bloom', 0), M.call[0], regFor(M.call, 77), 0.44);
    }
    // bloom: the theme in octaves, climbing sequence to the high point, closing response left open (ends on mi)
    {
      const reg = regFor(M.call, 77);
      const resp = vary(rng, M.resp, 0.45), climax = seq(vary(rng, M.call, 0.4), climaxK);
      const close = openEnd(vary(rng, M.resp, 0.5), 2);
      phrase(S('bloom', 0), M.call, { voice: 'mel', reg, vel: 0.6, oct: true, shimmer: true });
      phrase(S('bloom', 1), echo(M.call, echoN), { voice: 'glass', reg: reg + 7, vel: 0.33, offset: 1 });
      phrase(S('bloom', 2), resp, { voice: 'mel', reg, vel: 0.58, oct: true });
      phrase(S('bloom', 3), echo(resp, 2), { voice: 'glass', reg: reg + 7, vel: 0.28, offset: 2 });
      phrase(S('bloom', 4), climax, { voice: 'mel', reg, vel: 0.61, oct: true, shimmer: true, max: 90 });
      phrase(S('bloom', 5), echo(climax, 3, 1.4), { voice: 'glass', reg: reg + 7, vel: 0.32, offset: 0.5 });
      phrase(S('bloom', 6), close, { voice: 'mel', reg, vel: 0.58, oct: true });
      glassFill(lastBarBeat('bloom'), false, 0.24);
    }
    // coda: a last soft call, a glass echo, the final chord with a closing sigh (end of the response, octave up) -
    // the song's only literal arrival on the tonic after the theme
    {
      phrase(S('coda', 0), M.call, { voice: 'mel', reg: regTheme, vel: 0.5 });
      phrase(S('coda', 1), echo(M.call, 2, 1.5), { voice: 'glass', reg: regTheme + 7, vel: 0.26, offset: 1 });
      const fin = S('coda', 2);
      phrase(fin, echo(M.resp, 2, 1.6), { voice: 'mel', reg: regFor(M.resp.slice(-2), 84), vel: 0.4, offset: 5 });
      const top = chordTones(fin.segs[0].chord, 81, 93).filter((m) => !clash(m, fin.segs[0].chord)).reverse();
      [2.5, 8.5].forEach((b, i) => top[i * 2] !== undefined && put('glass', fin.beat + b, { dur: 5, midi: top[i * 2], vel: 0.22 - i * 0.04, dt: humanize(rng, 0, 10) }));
    }

    /** melody + glass notes sounding over [a0, a1) (beats), weighted by velocity, length and freshness */
    const avoidFor = (a0: number, a1: number, glassW = 0.45): Avoid[] => {
      const out: Avoid[] = [];
      const addEv = (e: Ev, lw: number) => {
        const ov = Math.min(a1, e.ab + e.dur) - Math.max(a0, e.ab);
        if (ov <= 0.05) return;
        const fresh = e.ab >= a0 - 0.3 ? 1 : 0.3; // struck over this chord, or held in from before (decayed)
        const w = lw * Math.sqrt(e.vel / 0.55) * fresh * (e.dur >= 1 ? 1 : 0.45) * Math.min(1, ov / 1.5 + 0.35);
        if (w > 0.02) out.push({ m: e.midi, w });
      };
      for (const e of allMel) addEv(e, 1);
      for (const e of allGlass) addEv(e, glassW);
      return out;
    };

    // ---------------------------------------------------------------- harmony layers, voiced around the melody
    let prevPad: number[] | null = null, prevHi: number[] | null = null, prevUp: number[] | null = null;
    for (const s of slots) {
      const k = s.kind;
      const isFinal = k === 'coda' && s.idx === 2;
      const singing = melSlots.has(s);
      s.segs.forEach((g, gi) => {
        const c = g.chord;
        const segEnd = g.beat + g.beats;
        const av = avoidFor(g.beat, segEnd + 0.6);
        // --- low pad (one voicing per chord change, voice-led, around the melody)
        const pv = voiceChord(c, prevPad, { lo: 52, hi: 74, count: 4, avoid: av, centre: 63 });
        prevPad = pv;
        // pads overlap the next chord by 0.6 beat - unless that would rub against the next chord's first melody notes
        const handoff = (v: readonly number[]) => (contactCost(v, avoidFor(segEnd - 0.1, segEnd + 0.8).filter((a) => allMel.some((e) => e.midi === a.m && e.ab >= segEnd - 0.1))) >= 5 ? 0.1 : 0.6);
        const padVel = k === 'intro' ? 0.42 + 0.03 * s.idx : k === 'theme' ? 0.47 : k === 'drift' ? 0.45 : k === 'hush' ? 0.4 : k === 'bloom' ? 0.5 : 0.44;
        putPad({
          ab: g.beat, dur: g.beats + handoff(pv), notes: pv, vel: padVel, layer: 'pad', wave: k === 'drift' || k === 'hush' ? driftWave : padWave, detune,
          attack: k === 'intro' && s.idx === 0 ? 6 : k === 'hush' ? 3.5 : 2.2, release: isFinal ? 5 : 3.5, cutoff: 1900, toEnd: isFinal,
        });
        // --- high saw pad + shimmer (second half of the theme, drift from slot 2, bloom, the final chord), re-voiced on
        // every chord change; in the hush's first chord it dissolves (quiet, long release) instead of stopping dead
        const dissolve = k === 'hush' && s.idx === 0 && gi === 0;
        if ((k === 'theme' && s.idx >= 4) || (k === 'drift' && s.idx >= 2) || k === 'bloom' || isFinal || dissolve) {
          const avH = avoidFor(g.beat, segEnd + 0.6, 0.6);
          const hv = voiceChord(c, prevHi, { lo: 67, hi: 86, count: 3, avoid: avH, under: true });
          prevHi = hv;
          // octave-up "shimmer" note (a high chord tone above the voicing) for air, only where it rubs against nothing
          const sh = chordTones(c, hv[hv.length - 1] + 3, 96).filter((m) => !clash(m, c));
          const ranked = sh.map((m, i) => ({ m, s: contactCost([m], avH, true) + Math.abs(i - 2) * 0.4 })).sort((a, b) => a.s - b.s);
          const shimmer = ranked.length && ranked[0].s < 4 ? [ranked[0].m] : [];
          const entry = gi === 0 && ((k === 'drift' && s.idx === 2) || (k === 'theme' && s.idx === 4));
          putPad({
            ab: g.beat, dur: dissolve ? 2 : g.beats + handoff([...hv, ...shimmer]), notes: [...hv, ...shimmer], layer: 'hi', wave: 'saw', detune: detune * 0.8,
            vel: dissolve ? 0.22 : k === 'theme' ? 0.27 : k === 'drift' ? 0.3 + 0.012 * s.idx : 0.36,
            attack: dissolve ? 0.8 : entry ? 6 : 3.5, release: dissolve ? 8 : 5, cutoff: dissolve ? 6000 : 14000, toEnd: isFinal,
          });
        }
        // --- air (breath of the high pad): one slow swell per slot, none in the hush / opening bars
        const airLv = k === 'intro' ? (s.idx >= 2 ? 0.45 : 0) : k === 'theme' ? 0.7 : k === 'drift' ? 0.8 + 0.03 * s.idx : k === 'bloom' ? 1 : k === 'coda' ? 0.75 : 0;
        if (airLv > 0 && gi === 0) plan[barOf(s.beat)].air.push({ ab: s.beat, beats: s.beats, level: airLv, off: rng.range(0, 1.9) });
        // --- piano left hand: spread chord (bass, 5th or octave, 3 voice-led upper notes) in a pattern; sparse while
        // the melody sings, more motion where it rests
        const bass = bassNote(g.pedal, 36);
        const fifth = g.pedal.bass === g.pedal.root && g.pedal.tones.includes(7);
        const up = voiceChord(c, prevUp, { lo: 55, hi: 70, count: 3, avoid: [...av, ...pv.map((m) => ({ m, w: 0.25 }))], centre: 62.5 });
        prevUp = up;
        let second: number | null = null;
        {
          let bc = Infinity;
          for (const m of fifth ? [bass + 7, bass + 12] : [bass + 12]) {
            const cc = contactCost([m], av);
            if (cc < bc) (bc = cc), (second = m);
          }
          if (bc >= 8) second = null;
        }
        const spread: (number | null)[] = [bass, second, ...up];
        let pat: string | null;
        switch (k) {
          case 'intro': pat = s.idx === 0 ? null : s.idx === 1 ? 'drone' : s.idx === 2 ? 'roll' : 'rise'; break;
          case 'theme': pat = singing ? rng.weighted(['roll', 'float', 'drone', 'sparse'], [0.3, 0.3, 0.2, 0.2]) : rng.weighted(['rise', 'p332', 'float', 'sparse'], [0.3, 0.3, 0.2, 0.2]); break;
          case 'drift': pat = singing ? rng.weighted(['drone', 'float', 'bass', 'sparse'], [0.3, 0.3, 0.15, 0.25]) : rng.weighted(['p332', 'float', 'rise', 'wave'], [0.35, 0.3, 0.2, 0.15]); break;
          case 'hush': pat = 'drone'; break;
          // (no rolled chords under the bloom's melody: five attacks piling onto a doubled melody note peak hard)
          case 'bloom': pat = singing ? rng.weighted(['float', 'drone', 'sparse'], [0.4, 0.3, 0.3]) : rng.weighted(['wave', 'p332', 'float', 'rise'], [0.25, 0.3, 0.25, 0.2]); break;
          default: pat = s.idx === 0 ? 'float' : s.idx === 1 ? 'rise' : 'roll';
        }
        if (pat) {
          const lhVel = (k === 'intro' ? 0.34 : k === 'hush' ? 0.31 : k === 'bloom' ? 0.41 : 0.38) * (isFinal ? 1.12 : 1);
          const notes = isFinal ? [...spread.filter((m): m is number => m !== null), ...voiceChord(c, null, { lo: 64, hi: 79, count: 2, avoid: av, centre: 72 })] : spread;
          const steps = isFinal ? notes.map((_, j) => [j * 0.09, j] as const) : LH[pat];
          for (const [pb, idx] of steps) {
            if (pb > g.beats - 0.25) continue;
            const m = notes[Math.min(idx, notes.length - 1)];
            if (m === null) continue;
            const soft = pat === 'roll' || isFinal ? 0.88 : 1; // a rolled chord is a soft spread of near-simultaneous attacks
            put('lh', g.beat + pb, { dur: g.beats - pb - 0.12, midi: m, vel: humVel(rng, lhVel * soft * (idx === 0 ? 0.86 : idx === 1 ? 0.84 : 0.9), 0.04), dt: humanize(rng, 0, 14), toEnd: isFinal });
          }
        }
        // --- occasional high bell harmonic on a chord change
        const bellOn = gi === 0 && ((k === 'intro' && s.idx === 1) || (k === 'drift' && s.idx % 4 === 0) || (k === 'hush' && s.idx === 1) || (k === 'bloom' && s.idx % 4 === 0) || (k === 'theme' && s.idx === 7 && rng.chance(0.6)));
        if (bellOn) put('bell', g.beat + rng.pick([0.5, 1, 1.5]), { dur: 1, midi: topTone(c, 79, 88, av), vel: humVel(rng, 0.24, 0.03), dt: humanize(rng, 0, 10) });
      });
    }
    {
      const fin = S('coda', 2);
      put('bell', fin.beat + 1, { dur: 1, midi: topTone(fin.segs[0].chord, 79, 86, avoidFor(fin.beat, fin.beat + 4)), vel: 0.2, dt: 0 });
    }

    // ---------------------------------------------------------------- sub: one note per bass pitch, crossfaded
    {
      const subs: SubEv[] = [];
      let skipped = false, skips = 0;
      timeline.forEach((g, i) => {
        const s = slots[g.slot], k = s.kind;
        const isFinal = k === 'coda' && s.idx === 2;
        const first = i === 0 || slots[timeline[i - 1].slot].kind !== k;
        // now and then (at most twice) the sub sits a chord out in the theme / drift - not locked to the harmonic clock
        const skip = !first && !skipped && skips < 2 && (k === 'theme' || k === 'drift') && rng.chance(0.12);
        skipped = skip;
        if (skip) {
          skips++;
          return;
        }
        const midi = bassNote(g.pedal, 31);
        const last = subs[subs.length - 1];
        if (last && !last.toEnd && last.midi === midi && Math.abs(last.end - g.beat) < 1e-6) {
          // the same bass pitch continues: one longer note with a gentle swell somewhere inside this chord
          last.pts.push([g.beat + g.beats * rng.range(0.3, 0.75), rng.range(0.74, 1)]);
          last.end = g.beat + g.beats;
          last.toEnd = isFinal;
          return;
        }
        subs.push({
          ab: g.beat, end: g.beat + g.beats, midi,
          vel: k === 'hush' ? 0.56 : k === 'intro' ? 0.58 : k === 'coda' && s.idx === 0 ? 0.5 : 0.62,
          lv0: rng.range(0.86, 1), attack: i === 0 ? 5 : rng.range(1.7, 2.6), release: rng.range(1.8, 2.6),
          pts: [[g.beat + g.beats * rng.range(0.55, 0.85), rng.range(0.74, 0.95)]], toEnd: isFinal,
        });
      });
      for (const e of subs) plan[barOf(e.ab)].subs.push(e);
    }

    // ---------------------------------------------------------------- dynamics, filter morph, tempo
    const dyn = (k: Kind, x: number): number => {
      switch (k) {
        case 'intro': return 0.88 + 0.1 * x;
        case 'theme': return 0.95 + 0.04 * x;
        case 'drift': return 0.9 + 0.1 * x;
        case 'hush': return 0.84;
        case 'bloom': return 1 + 0.06 * Math.sin(Math.PI * Math.min(1, x * 1.15));
        default: return 0.95 - 0.1 * x;
      }
    };
    const padCut = (k: Kind, x: number): number => {
      switch (k) {
        case 'intro': return 900 + 900 * x;
        case 'theme': return 1800 + 300 * Math.sin(Math.PI * x);
        case 'drift': return 1300 + 1300 * x;
        case 'hush': return 850;
        case 'bloom': return 2500 + 900 * Math.sin(Math.PI * x);
        default: return 1900 - 1100 * x;
      }
    };
    /** low-pad lowpass at an absolute beat: continuous inside a section, and a slow (2-bar) glide from the previous
     *  section's closing value into the new section's curve */
    const cutAt = (ab: number): number => {
      const i = secAt(ab);
      const into = ab - secBeat[i];
      const v = padCut(form[i].kind, Math.min(1, into / (secBeat[i + 1] - secBeat[i])));
      if (i === 0 || into >= 8) return v;
      const pv = padCut(form[i - 1].kind, 1);
      return pv * Math.pow(v / pv, 0.5 - 0.5 * Math.cos((Math.PI * into) / 8));
    };
    // tempo breathing: a slow +-1.1..1.7 % drift, a lean into each melody phrase (+1 % / -0.8 %), the last bar of a
    // section eases 4 %, the hush sits 2.5 % slower; ritardando over the last 5 bars
    const barKind: Kind[] = [], barLast: boolean[] = [], barLean: number[] = [];
    slots.forEach((s, si) => {
      const lastOfSec = si + 1 === slots.length || slots[si + 1].kind !== s.kind;
      for (let j = 0; j < s.beats / 4; j++) {
        const bi = s.beat / 4 + j;
        barKind[bi] = s.kind;
        barLast[bi] = lastOfSec && j === s.beats / 4 - 1;
        // a phrase pushes a little into its first bar and relaxes into its long last note; the first bar of a section
        // recovers gently from the eased bar before it (poco rit. ... a tempo)
        barLean[bi] = (melSlots.has(s) ? (j === 0 ? 1.01 : j === 1 ? 0.992 : 1) : 1) * (si > 0 && s.idx === 0 && j === 0 ? 0.985 : 1);
      }
    });
    const breathA = rng.range(0.011, 0.017), breathPh = rng.range(0, 2 * Math.PI);
    const tempo = (bar: number): number => {
      const r = bar - (total - 5);
      if (r >= 0) return bpm * [0.97, 0.93, 0.88, 0.84, 0.8][r];
      let f = (1 + breathA * Math.sin((2 * Math.PI * bar) / 16 + breathPh)) * barLean[bar];
      if (barLast[bar]) f *= 0.96;
      if (barKind[bar] === 'hush') f *= 0.975;
      return bpm * Math.min(1.035, Math.max(0.93, f));
    };
    let player: SongPlayer | null = null;
    /** absolute beat -> ctx time (tempo is constant inside a bar, so this is exact; extrapolates past the end) */
    const tb = (ab: number): number => {
      const bt = player!.barTimes;
      const i = Math.max(0, Math.min(total - 1, Math.floor(ab / 4 + 1e-9)));
      return bt[i] + ((ab - i * 4) / 4) * (bt[i + 1] - bt[i]);
    };
    const AIR = 0.015;

    return song(env, {
      bpm,
      tempo,
      sections: form.map((f) => ({ name: f.name, bars: f.slots.reduce((a, s) => a + s.bars, 0) })),
      tail: 5,
      setup(_t0, p) {
        player = p;
        inst.mix('piano', { level: 2.4, pan: -0.2, reverb: 0.5, delay: 0.05 });
        inst.mix('piano:lead', { level: 2, pan: 0.16, reverb: 0.55, delay: 0.15 });
        // the low pad is summed to mono at its channel input (the stereo width comes from the high pad + reverb);
        // mono summing halves its level, hence the fader at ~2
        const padIn = inst.channel('pad').input;
        padIn.channelCount = 1;
        padIn.channelCountMode = 'explicit';
        inst.mix('pad', { level: 2, reverb: 0.5, lowpass: cutAt(0), highpass: 110 });
        inst.mix('pad:hi', { level: 0.95, pan: 0.05, reverb: 0.6, highpass: 320, lowpass: 12000 });
        inst.mix('pad:sub', { level: 1, highpass: 24, lowpass: 300, reverb: 0.02 });
        inst.mix('glass', { level: 2, pan: -0.35, reverb: 0.65, delay: 0.24 });
        inst.mix('bell', { level: 1.1, pan: 0.38, reverb: 0.6, delay: 0.18 });
        inst.mix('sweep', { level: 0.45, reverb: 0.55, delay: 0.1 });
        inst.setDelay({ beats: 1.5, feedback: 0.38, tone: 3600 });
      },
      bar(b: BarInfo) {
        const p = plan[b.bar];
        const d = dyn(form[b.sectionIndex].kind, b.sectionProgress);
        const endT = player!.barTimes[total];
        const a0 = b.bar * 4;
        const len = (ab: number, beats: number) => tb(ab + beats) - tb(ab);
        // the pad filter follows cutAt() in half-beat steps (each glides in over ~60 ms): a continuous morph
        for (let q = 0; q < 8; q++) inst.mix('pad', { lowpass: cutAt(a0 + (q + 1) * 0.5) }, tb(a0 + q * 0.5));
        // live only: a sustained layer whose start already passed (main-thread stall / throttled tab) enters late
        // with its remaining length instead of being dropped, so the bed fades back in rather than leaving a hole
        const now = env.live ? env.ctx.currentTime + 0.03 : -Infinity;
        const lim = b.t - 0.045;
        for (const e of p.pads) {
          let t = tb(e.ab);
          // final chord: hold ~45% of what is left, then a long release = a natural diminuendo into the tail
          const left = endT - t;
          let dur = e.toEnd ? Math.max(1, left * 0.45) : len(e.ab, e.dur);
          if (t < now) {
            if (t + dur < now + 1) continue;
            dur -= now - t;
            t = now;
          }
          const rel = e.toEnd ? left * 0.55 + 2 : e.release;
          inst.pad(t, e.notes, dur, e.vel * d, { ch: e.layer === 'pad' ? undefined : e.layer, attack: e.attack, release: rel, cutoff: e.cutoff, wave: e.wave, detune: e.detune });
        }
        for (const e of p.subs) {
          const t = tb(e.ab);
          const left = endT - t;
          const tEnd = e.toEnd ? t + Math.max(1, left * 0.45) : tb(e.end + 0.35);
          subVoice(env, t, e.midi, e.vel * Math.sqrt(d), e.lv0, e.attack, e.pts.map(([ab, lv]) => [tb(ab), lv] as const), tEnd, e.toEnd ? left * 0.55 + 2 : e.release);
        }
        for (const e of p.lh) {
          const t = Math.max(lim, tb(e.ab) + e.dt);
          inst.piano(t, e.midi, e.toEnd ? Math.max(1, endT - t - 0.3) : len(e.ab, e.dur), e.vel * d, { bright: 0.35 });
        }
        for (const e of p.mel) inst.piano(Math.max(lim, tb(e.ab) + e.dt) + 0.01, e.midi, len(e.ab, e.dur), Math.min(0.64, e.vel * d), { ch: 'lead', bright: 0.7 });
        for (const e of p.glass) inst.glass(Math.max(lim, tb(e.ab) + e.dt), e.midi, len(e.ab, e.dur), e.vel * d);
        for (const e of p.bell) inst.bell(Math.max(lim, tb(e.ab) + e.dt), e.midi, len(e.ab, e.dur), e.vel * d, { ratio: bellRatio, ring: 6 });
        for (const e of p.air) {
          const l = len(e.ab, e.beats);
          const fin = b.bar >= total - 4;
          const t = Math.max(tb(e.ab), now);
          airSwell(env, t, l * 0.45, fin ? l * 0.2 : l * 0.3, fin ? Math.max(2, endT - t - l * 0.65) : l * 0.95, AIR * e.level * d, e.off);
        }
        for (const e of p.sweeps) inst.sweep(tb(e.ab), len(e.ab, e.dur), e.vel, { up: true, from: 380, to: 2600, q: 2.2 });
      },
    });
  },
};
