/**
 * "Blueprint" - slow ambient piano over drifting detuned pads (Eno / late-night city-builder menu feel).
 *
 * Form (2-bar harmonic rhythm, ~60-66 bpm, no drums):
 *   intro 8   pads bloom in over a tonic pedal, glass harmonics, a first fragment of the motif + pickup
 *   theme 16  piano states the motif (call), glass echoes it, piano answers (response), sequences it up, closes
 *   drift 16  aeolian turn to the relative minor: the motif in augmentation on glass, piano answers in the
 *             middle register, broken-chord left hand, the high pad layer grows, riser into the next section
 *   hush 4    (most seeds) breakdown: dark pad, sub, one slow motif fragment and a bell
 *   bloom 16  the theme in octaves over the fullest texture; the sequence climbs to the song's high point
 *   coda 8    a last soft call, glass echo, then a plagal close onto a held, rolled tonic chord with ritardando
 * Every play re-rolls: key, tempo, the theme / drift / lift / coda progressions (composed sets), whether the hush
 * appears, the motif (3 composed motifs with call + response forms), its variations (split notes, anticipations),
 * sequence intervals, left-hand patterns, pad waveform + detune, glass / bell placements and fills.
 * The whole plan is computed in create(); bar() only schedules.
 *
 * Layers: soft piano (left hand = spread broken chords, 'piano:lead' = melody), low saw/square pad summed to mono
 * (warm bed), high saw pad + octave shimmer note (stereo width), glass echoes, FM bell harmonics, noise riser, plus
 * two small LOCAL instruments built from plain nodes: a mono sine sub swell ('pad:sub') and a very quiet breathing
 * "air" noise band (4.5-10 kHz, in 'pad:hi') - the library pad's hard-L/R detuned pair decorrelates a sustained
 * low end, and nothing else in the palette supplies top-octave air without drums.
 */
import type { RNG } from '../../../core/rng';
import type { MusicEnv, MusicTrack } from '../types';
import { song, type BarInfo, type SongPlayer } from '../song';
import { parseChord, transposeChord, chord, chordTones, voiceLead, voicing, bassNote, humanize, humVel, pc, type Chord } from '../theory';

type Kind = 'intro' | 'theme' | 'drift' | 'hush' | 'bloom' | 'coda';
/** [beat within the phrase, scale degree (0 = key tonic, 7 = octave), duration in beats] */
type MN = readonly [number, number, number];

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

/** left-hand patterns: [beat, index into the spread chord (0 = bass .. 4 = top)] over an 8-beat slot */
const LH: Record<string, readonly (readonly [number, number])[]> = {
  drone: [[0, 0], [0.12, 1], [2, 3]],
  roll: [[0, 0], [0.07, 1], [0.14, 2], [0.21, 3], [0.28, 4]],
  rise: [[0, 0], [1, 1], [2, 2], [3, 3], [5, 4]],
  p332: [[0, 0], [1.5, 1], [3, 2], [4, 3], [5.5, 2], [7, 4]],
  wave: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 3], [6, 2], [7, 1]],
  float: [[0, 0], [0.5, 2], [2.5, 3], [4.5, 4], [6, 2]],
};

interface Ev {
  beat: number;
  dur: number;
  midi: number;
  vel: number;
  /** hold until the end of the song (final chord) */
  toEnd?: boolean;
}
type Layer = 'pad' | 'hi' | 'sub';
interface PadEv {
  beat: number;
  dur: number;
  notes: number[];
  vel: number;
  layer: Layer;
  attack: number;
  release: number;
  cutoff: number;
  wave: 'saw' | 'tri' | 'square';
  detune: number;
  toEnd?: boolean;
}
interface BarPlan {
  lh: Ev[];
  mel: Ev[];
  glass: Ev[];
  bell: Ev[];
  pads: PadEv[];
  sweeps: { beat: number; dur: number; vel: number }[];
  /** air swells: level 0..1 (x AIR), over `beats` */
  air: { beat: number; beats: number; level: number }[];
}
interface Slot {
  kind: Kind;
  idx: number;
  /** absolute beat of the slot start */
  beat: number;
  beats: number;
  segs: { beat: number; beats: number; chord: Chord; pedal: Chord }[];
}

// ---------------------------------------------------------------- phrase transformations
const seq = (ph: readonly MN[], k: number): MN[] => ph.map(([b, d, u]) => [b, d + k, u] as const);
const invert = (ph: readonly MN[]): MN[] => ph.map(([b, d, u]) => [b, 2 * ph[0][1] - d, u] as const);
const augment = (ph: readonly MN[], f: number): MN[] => ph.map(([b, d, u]) => [b * f, d, u * f] as const);
/** the last n notes, re-timed to start at 0 and stretched a little (an echo) */
const echo = (ph: readonly MN[], n: number, stretch = 1.25): MN[] => {
  const t = ph.slice(-n);
  const b0 = t[0][0];
  return t.map(([b, d, u]) => [(b - b0) * stretch, d, Math.max(1, u * stretch)] as const);
};
/** light variation: split a long inner note into note + neighbour, anticipate an inner note by an 8th */
function vary(rng: RNG, ph: readonly MN[], amt: number): MN[] {
  const out: MN[] = [];
  ph.forEach(([b, d, u], i) => {
    const inner = i > 0 && i < ph.length - 1;
    if (inner && u >= 2 && rng.chance(amt * 0.7)) {
      out.push([b, d, u / 2], [b + u / 2, d + (rng.chance(0.6) ? 1 : -1), u / 2]);
      return;
    }
    // anticipation: only into a free 8th (the previous note must start at least a beat earlier)
    const prev = out[out.length - 1];
    if (i > 0 && u >= 1 && b % 1 === 0 && prev && prev[0] <= b - 1 && rng.chance(amt * 0.45)) {
      out.push([b - 0.5, d, u + 0.5]);
      return;
    }
    out.push([b, d, u]);
  });
  return out;
}
const meanDeg = (ph: readonly MN[]): number => ph.reduce((s, n) => s + n[1], 0) / ph.length;
const m2s = (v: readonly number[]): number => v.slice(1).filter((m, i) => m - v[i] === 1).length;
/** open up minor-2nd clusters in a close voicing (raise the upper note, drop-2, or lower the lower note) */
function openUp(v: number[], lo: number, hi: number): number[] {
  let best = v, bc = m2s(v);
  if (!bc) return v;
  const sort = (x: number[]) => x.sort((a, b) => a - b);
  const cands: number[][] = [];
  for (let i = 0; i < v.length - 1; i++) {
    if (v[i + 1] - v[i] !== 1) continue;
    const up = [...v];
    up[i + 1] += 12;
    if (up[i + 1] <= hi + 5) cands.push(sort(up));
  }
  if (v.length >= 3) {
    const d2 = [...v];
    d2[d2.length - 2] -= 12;
    if (Math.min(...d2) >= lo - 5) cands.push(sort(d2));
  }
  for (let i = 0; i < v.length - 1; i++) {
    if (v[i + 1] - v[i] !== 1) continue;
    const dn = [...v];
    dn[i] -= 12;
    if (dn[i] >= lo - 5) cands.push(sort(dn));
  }
  for (const c of cands) {
    const n = m2s(c);
    if (n < bc) (bc = n), (best = c);
  }
  return best;
}

/**
 * Local instrument: MONO sine sub swell (sine + soft octave, slow linear attack, gentle sag, exponential release).
 * The library pad puts its detuned oscillator pair hard L/R, which decorrelates a sustained low end completely, so
 * the sub is built here from plain nodes and routed into the 'pad:sub' channel (envelope 0 -> 0, honours cutoff,
 * live past-note dropping and the lab's mute / solo as 'sub').
 */
function subSwell(env: MusicEnv, t: number, m: number, dur: number, vel: number, attack: number, release: number): void {
  const { ctx, inst } = env;
  if (!isFinite(t) || t >= inst.cutoff || (env.live && t < ctx.currentTime)) return;
  if (inst.mute.has('sub') || (inst.solo.size && !inst.solo.has('sub') && !inst.solo.has('pad:sub'))) return;
  const f = 440 * Math.pow(2, (m - 69) / 12);
  const peak = 0.085 * Math.pow(Math.max(0, Math.min(1, vel)), 1.5);
  const g = inst.node.gain(0);
  const tA = t + attack, tR = Math.max(tA, t + dur), end = tR + release;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, tA);
  g.gain.linearRampToValueAtTime(peak * 0.8, tR);
  g.gain.exponentialRampToValueAtTime(peak * 1e-3, end);
  g.gain.linearRampToValueAtTime(0, end + 0.02);
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
function airSwell(env: MusicEnv, t: number, attack: number, hold: number, release: number, level: number): void {
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
  src.start(t, env.rng.range(0, Math.max(0, env.noise.duration - 0.1)));
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
    let beat = 0;
    for (const s of form) {
      secStartSlot.push(slots.length);
      s.slots.forEach((d, idx) => {
        const beats = d.bars * 4;
        const segBeats = beats / d.syms.length;
        const segs = d.syms.map((sym, k) => {
          const c = ch(sym);
          return { beat: beat + k * segBeats, beats: segBeats, chord: c, pedal: s.kind === 'intro' ? chord(c.root, c.quality, tonic.root) : c };
        });
        slots.push({ kind: s.kind, idx, beat, beats, segs });
        beat += beats;
      });
    }
    const totalBeats = beat;
    const total = totalBeats / 4;
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

    // ---------------------------------------------------------------- plan
    const plan: BarPlan[] = Array.from({ length: total }, () => ({ lh: [], mel: [], glass: [], bell: [], pads: [], sweeps: [], air: [] }));
    const barOf = (ab: number) => Math.min(total - 1, Math.max(0, Math.floor(ab / 4 + 1e-6)));
    const put = (list: 'lh' | 'mel' | 'glass' | 'bell', ab: number, e: Omit<Ev, 'beat'>) => {
      if (ab >= totalBeats || ab < 0) return;
      const bar = barOf(ab);
      plan[bar][list].push({ ...e, beat: ab - bar * 4 });
    };
    const putPad = (ab: number, e: Omit<PadEv, 'beat'>) => {
      const bar = barOf(ab);
      plan[bar].pads.push({ ...e, beat: ab - bar * 4 });
    };

    // melody pitch: key scale with each chord's chromatic tones substituted (so D/C gives a lydian #4 etc.)
    const MAJOR = [0, 2, 4, 5, 7, 9, 11];
    const pcsOf = (c: Chord): number[] => [...c.tones.map((t) => (c.root + t) % 12), c.bass];
    const poolFor = (c: Chord): number[] => {
      const pcs = MAJOR.map((iv) => (key + iv) % 12);
      const ct = pcsOf(c);
      for (const t of ct) {
        if (pcs.includes(t)) continue;
        for (const d of [-1, 1]) {
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
     *  preferring the direction the line is already moving (dir) */
    const realize = (ab: number, deg: number, strong: boolean, dir = 0): number => {
      const c = segAt(ab).chord;
      const pool = poolFor(c);
      const at = (d: number) => R + 12 * Math.floor(d / 7) + pool[((d % 7) + 7) % 7];
      if (!strong || !clash(at(deg), c)) return at(deg);
      let best = at(deg), bs = Infinity;
      for (const dd of [-1, 1, -2, 2]) {
        const m = at(deg + dd);
        const s = (clash(m, c) ? 100 : 0) + (isCT(m, c) ? 0 : 0.5) + Math.abs(dd) - (Math.sign(dd) === Math.sign(dir) ? 0.3 : 0);
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
    const phrase = (slot: Slot, ph: readonly MN[], o: PhraseOpts): void => {
      const ms = ph.map(([b, d, u], i) => {
        const ab = slot.beat + (o.offset ?? 0) + b;
        let m = realize(ab, d + o.reg, b % 2 === 0 || u >= 1.5, i > 0 ? d - ph[i - 1][1] : 0);
        while (m > (o.max ?? (o.voice === 'glass' ? 93 : 88))) m -= 12;
        return m;
      });
      const lo = Math.min(...ms), hi = Math.max(...ms);
      ph.forEach(([b, , u], i) => {
        const ab = slot.beat + (o.offset ?? 0) + b;
        const m = ms[i];
        const arc = 0.92 + 0.14 * ((m - lo) / Math.max(1, hi - lo)) + (i === 0 ? 0.03 : 0) - (i === ph.length - 1 ? 0.08 : 0);
        const vel = humVel(rng, o.vel * arc, 0.04);
        if (o.voice === 'mel') {
          const pedalEnd = nextChange(ab);
          const dur = Math.min(u * 1.3 + 0.4, Math.max(u, pedalEnd - ab - 0.06));
          put('mel', ab, { dur, midi: m, vel });
          if (o.oct && m - 12 >= 58) put('mel', ab + 0.03, { dur, midi: m - 12, vel: vel * 0.42 });
          if (o.shimmer && u >= 2 && m + 12 <= 93) put('glass', ab + 0.03, { dur: u, midi: m + 12, vel: vel * 0.42 });
        } else put('glass', ab, { dur: u, midi: m, vel });
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

    // ---------------------------------------------------------------- harmony layers: pads, sub, left hand, bells
    let prevPad: number[] | null = null, prevHi: number[] | null = null, prevUp: number[] | null = null;
    const topTone = (c: Chord, lo: number, hi: number): number => {
      const ts = chordTones(c, lo, hi).filter((m) => !clash(m, c));
      return ts.length ? rng.pick(ts.slice(-3)) : lo + ((c.root - lo) % 12 + 12) % 12;
    };
    for (const s of slots) {
      const k = s.kind;
      const isFinal = k === 'coda' && s.idx === 2;
      s.segs.forEach((g, gi) => {
        const c = g.chord;
        // --- low pad (one voicing per chord change, voice-led)
        const pv = openUp(voiceLead(prevPad, c, { lo: 50, hi: 70, count: 4, rootless: true }), 50, 70);
        prevPad = pv;
        const padVel = k === 'intro' ? 0.42 + 0.03 * s.idx : k === 'theme' ? 0.47 : k === 'drift' ? 0.45 : k === 'hush' ? 0.4 : k === 'bloom' ? 0.5 : 0.44;
        const wave = k === 'drift' || k === 'hush' ? driftWave : padWave;
        putPad(g.beat, {
          dur: g.beats + 0.6, notes: pv, vel: padVel, layer: 'pad', wave, detune,
          attack: k === 'intro' && s.idx === 0 ? 6 : k === 'hush' ? 3.5 : 2.2, release: isFinal ? 5 : 3.5, cutoff: 1900, toEnd: isFinal,
        });
        // --- high saw pad + shimmer (second half of the theme, drift from slot 2, bloom, the final chord)
        if ((k === 'theme' && s.idx >= 4) || (k === 'drift' && s.idx >= 2) || k === 'bloom' || isFinal) {
          if (gi === 0) {
            const hv = openUp(voiceLead(prevHi, c, { lo: 67, hi: 86, count: 3, rootless: true }), 67, 86);
            prevHi = hv;
            // octave-up "shimmer" note (the top chord tone an octave higher) for air
            const sh = chordTones(c, hv[hv.length - 1] + 3, 96).filter((m) => !clash(m, c));
            const shimmer = sh.length ? [sh[Math.min(sh.length - 1, 2)]] : [];
            putPad(g.beat, {
              dur: s.beats + 0.6, notes: [...hv, ...shimmer], vel: k === 'theme' ? 0.27 : k === 'drift' ? 0.3 + 0.012 * s.idx : 0.36, layer: 'hi', wave: 'saw', detune: detune * 0.8,
              attack: (k === 'drift' && s.idx === 2) || (k === 'theme' && s.idx === 4) ? 6 : 3.5, release: 5, cutoff: 14000, toEnd: isFinal,
            });
          }
        }
        // --- air (breath of the high pad): one slow swell per slot, none in the hush / opening bars
        const airLv = k === 'intro' ? (s.idx >= 2 ? 0.45 : 0) : k === 'theme' ? 0.7 : k === 'drift' ? 0.8 + 0.03 * s.idx : k === 'bloom' ? 1 : k === 'coda' ? 0.75 : 0;
        if (airLv > 0 && gi === 0) {
          const bar = barOf(s.beat);
          plan[bar].air.push({ beat: s.beat - bar * 4, beats: s.beats, level: airLv });
        }
        // --- sub swell (root / pedal, slow attack, long release)
        const subOn = k === 'intro' ? s.idx % 2 === 0 : k === 'theme' ? s.idx % 2 === 0 : k === 'coda' ? s.idx >= 1 : true;
        if (subOn && gi === 0) {
          putPad(g.beat, {
            dur: isFinal ? s.beats : s.beats * 0.62, notes: [bassNote(g.pedal, 31)], vel: k === 'hush' ? 0.55 : 0.62, layer: 'sub', wave: 'tri', detune: 3,
            attack: 2.8, release: 4.5, cutoff: 520, toEnd: isFinal,
          });
        }
        // --- piano left hand: spread chord (bass, 5th or octave, 3 voice-led upper notes) in a pattern
        const bass = bassNote(g.pedal, 36);
        const fifth = g.pedal.bass === g.pedal.root && g.pedal.tones.includes(7);
        const up = openUp(voiceLead(prevUp, c, { lo: 53, hi: 69, count: 3, rootless: true }), 53, 69);
        prevUp = up;
        const spread = [bass, fifth ? bass + 7 : bass + 12, ...up];
        let pat: string | null;
        const melSlot = s.idx % 2 === 0;
        switch (k) {
          case 'intro': pat = s.idx === 0 ? null : s.idx === 1 ? 'drone' : s.idx === 2 ? 'roll' : 'rise'; break;
          case 'theme': pat = melSlot ? rng.pick(['roll', 'float', 'drone']) : rng.pick(['rise', 'p332']); break;
          case 'drift': pat = rng.pick(['p332', 'wave', 'float']); break;
          case 'hush': pat = 'drone'; break;
          case 'bloom': pat = melSlot ? rng.pick(['wave', 'p332']) : 'wave'; break;
          default: pat = s.idx === 0 ? 'float' : s.idx === 1 ? 'rise' : 'roll';
        }
        if (pat) {
          const lhVel = (k === 'intro' ? 0.34 : k === 'hush' ? 0.31 : k === 'bloom' ? 0.41 : 0.38) * (isFinal ? 1.12 : 1);
          const roll = isFinal ? 0.09 : 0;
          const notes = isFinal ? [...spread, ...voicing(c, { lo: 64, hi: 79, count: 2, rootless: true })] : spread;
          const steps = isFinal ? notes.map((_, j) => [j * roll, j] as const) : LH[pat];
          for (const [pb, idx] of steps) {
            if (pb > g.beats - 0.25) continue;
            const m = notes[Math.min(idx, notes.length - 1)];
            const ab = g.beat + pb;
            put('lh', ab, { dur: g.beats - pb - 0.12, midi: m, vel: humVel(rng, lhVel * (idx === 0 ? 0.86 : idx === 1 ? 0.84 : 0.9), 0.04), toEnd: isFinal });
          }
        }
        // --- occasional high bell harmonic on a chord change
        const bellOn = gi === 0 && ((k === 'intro' && s.idx === 1) || (k === 'drift' && s.idx % 4 === 0) || (k === 'hush' && s.idx === 1) || (k === 'bloom' && s.idx % 4 === 0) || (k === 'theme' && s.idx === 7 && rng.chance(0.6)));
        if (bellOn) put('bell', g.beat + rng.pick([0.5, 1, 1.5]), { dur: 1, midi: topTone(c, 79, 88), vel: humVel(rng, 0.24, 0.03) });
      });
    }

    // ---------------------------------------------------------------- melody, echoes, fills
    const S = (kind: Kind, idx: number) => slots[secStartSlot[form.findIndex((f) => f.kind === kind)] + idx];
    const has = (kind: Kind) => form.some((f) => f.kind === kind);
    const lastBarBeat = (kind: Kind) => {
      const i = form.findIndex((f) => f.kind === kind);
      const sl = slots[secStartSlot[i] + form[i].slots.length - 1];
      return sl.beat + sl.beats - 4;
    };
    /** glass arpeggio in the last two beats of a section, from the tones of the chord that follows */
    const glassFill = (ab: number, up: boolean, v = 0.26) => {
      const c = segAt(ab + 4).chord;
      let ts = chordTones(c, 76, 91).filter((m) => !clash(m, c));
      ts = up ? ts.slice(0, 4) : ts.slice(-4).reverse();
      ts.forEach((m, i) => put('glass', ab + 2 + i * 0.5, { dur: 2.5, midi: m, vel: humVel(rng, v * (up ? 0.85 + 0.08 * i : 1 - 0.07 * i), 0.03) }));
    };
    const pickup = (slotNext: Slot, first: MN, reg: number, v: number) => {
      const ab = slotNext.beat - 0.5;
      const m = realize(ab, first[1] + reg - 1, false);
      put('mel', ab, { dur: 0.9, midi: m, vel: v });
    };

    const regTheme = regFor(M.call, 75);
    // intro: glass harmonics, a fragment of the call, and a pickup into the theme
    {
      const s0 = S('intro', 0), s1 = S('intro', 1), s2 = S('intro', 2), s3 = S('intro', 3);
      for (const [s, beats] of [[s0, [2.5, 5.5]], [s1, [3]], [s3, [1.5, 5]]] as const)
        for (const b of beats) put('glass', s.beat + b + rng.range(-0.25, 0.25), { dur: 4, midi: topTone(s.segs[0].chord, 81, 91), vel: humVel(rng, 0.25, 0.04) });
      phrase(s2, M.call.slice(0, 3), { voice: 'mel', reg: regTheme, vel: 0.46 });
      pickup(S('theme', 0), M.call[0], regTheme, 0.42);
    }
    // theme: call / echo / response / sequence / echo / closing response
    {
      const call = M.call, resp = vary(rng, M.resp, 0.4), dev = seq(vary(rng, M.call, 0.35), seqK);
      phrase(S('theme', 0), call, { voice: 'mel', reg: regTheme, vel: 0.56 });
      phrase(S('theme', 1), echo(call, echoN), { voice: 'glass', reg: regTheme + 7, vel: 0.32, offset: 1 });
      phrase(S('theme', 2), resp, { voice: 'mel', reg: regTheme, vel: 0.54 });
      phrase(S('theme', 4), dev, { voice: 'mel', reg: regTheme, vel: 0.58 });
      phrase(S('theme', 5), echo(dev, 2), { voice: 'glass', reg: regTheme + 7, vel: 0.3, offset: 1.5 });
      phrase(S('theme', 6), M.resp, { voice: 'mel', reg: regTheme, vel: 0.54 });
      glassFill(lastBarBeat('theme'), false);
    }
    // drift: the call in augmentation on glass, the piano answers low; riser into what follows
    {
      const regG = regFor(M.call, 80);
      const inv = invert(vary(rng, M.resp, 0.5)), ans = vary(rng, M.resp, 0.3);
      phrase(S('drift', 0), augment(M.call, 2), { voice: 'glass', reg: regG, vel: 0.34 });
      phrase(S('drift', 2), inv, { voice: 'mel', reg: regFor(inv, 70), vel: 0.52 });
      phrase(S('drift', 4), augment(seq(M.call, -2), 2), { voice: 'glass', reg: regG, vel: 0.34 });
      phrase(S('drift', 6), ans, { voice: 'mel', reg: regFor(ans, 70), vel: 0.52 });
      const lb = lastBarBeat('drift');
      if (has('hush')) glassFill(lb, false, 0.22);
      else {
        plan[barOf(lb - 4)].sweeps.push({ beat: 0, dur: 8, vel: 0.2 });
        glassFill(lb, true);
        pickup(S('bloom', 0), M.call[0], regFor(M.call, 77), 0.44);
      }
    }
    // hush: one slow fragment, then a riser + pickup into the bloom
    if (has('hush')) {
      phrase(S('hush', 0), augment(M.call.slice(0, 2), 2), { voice: 'mel', reg: regTheme, vel: 0.42 });
      const lb = lastBarBeat('hush');
      plan[barOf(lb - 4)].sweeps.push({ beat: 0, dur: 8, vel: 0.2 });
      glassFill(lb, true, 0.22);
      pickup(S('bloom', 0), M.call[0], regFor(M.call, 77), 0.44);
    }
    // bloom: the theme in octaves, climbing sequence to the high point, closing response
    {
      const reg = regFor(M.call, 77);
      const resp = vary(rng, M.resp, 0.45), climax = seq(vary(rng, M.call, 0.4), climaxK);
      phrase(S('bloom', 0), M.call, { voice: 'mel', reg, vel: 0.6, oct: true, shimmer: true });
      phrase(S('bloom', 1), echo(M.call, echoN), { voice: 'glass', reg: reg + 7, vel: 0.33, offset: 1 });
      phrase(S('bloom', 2), resp, { voice: 'mel', reg, vel: 0.58, oct: true });
      phrase(S('bloom', 3), echo(resp, 2), { voice: 'glass', reg: reg + 7, vel: 0.28, offset: 2 });
      phrase(S('bloom', 4), climax, { voice: 'mel', reg, vel: 0.61, oct: true, shimmer: true, max: 90 });
      phrase(S('bloom', 5), echo(climax, 3, 1.4), { voice: 'glass', reg: reg + 7, vel: 0.32, offset: 0.5 });
      phrase(S('bloom', 6), M.resp, { voice: 'mel', reg, vel: 0.58, oct: true });
      glassFill(lastBarBeat('bloom'), false, 0.24);
    }
    // coda: a last soft call, a glass echo, the final chord with a closing sigh (end of the response, octave up)
    {
      phrase(S('coda', 0), M.call, { voice: 'mel', reg: regTheme, vel: 0.5 });
      phrase(S('coda', 1), echo(M.call, 2, 1.5), { voice: 'glass', reg: regTheme + 7, vel: 0.26, offset: 1 });
      const fin = S('coda', 2);
      phrase(fin, echo(M.resp, 2, 1.6), { voice: 'mel', reg: regFor(M.resp.slice(-2), 84), vel: 0.4, offset: 5 });
      const top = chordTones(fin.segs[0].chord, 81, 93).filter((m) => !clash(m, fin.segs[0].chord)).reverse();
      [2.5, 8.5].forEach((b, i) => top[i * 2] !== undefined && put('glass', fin.beat + b, { dur: 5, midi: top[i * 2], vel: 0.22 - i * 0.04 }));
      put('bell', fin.beat + 1, { dur: 1, midi: topTone(fin.segs[0].chord, 79, 86), vel: 0.2 });
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
    const tempo = (bar: number): number => {
      const r = bar - (total - 5);
      return r < 0 ? bpm : bpm * [0.97, 0.93, 0.88, 0.84, 0.8][r];
    };
    let player: SongPlayer | null = null;
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
        inst.mix('pad', { level: 2, reverb: 0.5, lowpass: 700, highpass: 110 });
        inst.mix('pad:hi', { level: 0.95, pan: 0.05, reverb: 0.6, highpass: 320, lowpass: 12000 });
        inst.mix('pad:sub', { level: 1, highpass: 24, lowpass: 300, reverb: 0.02 });
        inst.mix('glass', { level: 2, pan: -0.35, reverb: 0.65, delay: 0.24 });
        inst.mix('bell', { level: 1.1, pan: 0.38, reverb: 0.6, delay: 0.18 });
        inst.mix('sweep', { level: 0.45, reverb: 0.55, delay: 0.1 });
        inst.setDelay({ beats: 1.5, feedback: 0.38, tone: 3600 });
      },
      bar(b: BarInfo) {
        const p = plan[b.bar];
        const k = form[b.sectionIndex].kind;
        const d = dyn(k, b.sectionProgress);
        const endT = player ? player.barTimes[total] : b.t + b.dur * (total - b.bar);
        const sec = (beats: number) => b.beatsToSec(beats);
        inst.mix('pad', { lowpass: padCut(k, b.sectionProgress) }, b.t);
        // live only: a sustained layer whose start already passed (main-thread stall / throttled tab) enters late
        // with its remaining length instead of being dropped, so the bed fades back in rather than leaving a hole
        const now = env.live ? env.ctx.currentTime + 0.03 : -Infinity;
        for (const e of p.pads) {
          let t = b.at(e.beat);
          // final chord: hold ~45% of what is left, then a long release = a natural diminuendo into the tail
          const left = endT - t;
          let dur = e.toEnd ? Math.max(1, left * 0.45) : sec(e.dur);
          if (t < now) {
            if (t + dur < now + 1) continue;
            dur -= now - t;
            t = now;
          }
          const rel = e.toEnd ? left * 0.55 + 2 : e.release;
          if (e.layer === 'sub') {
            subSwell(env, t, e.notes[0], dur, e.vel * Math.sqrt(d), e.attack, rel);
            continue;
          }
          inst.pad(t, e.notes, dur, e.vel * d, { ch: e.layer === 'pad' ? undefined : e.layer, attack: e.attack, release: rel, cutoff: e.cutoff, wave: e.wave, detune: e.detune });
        }
        for (const e of p.lh) {
          const t = humanize(rng, b.at(e.beat), 9);
          inst.piano(t, e.midi, e.toEnd ? Math.max(1, endT - t - 0.3) : sec(e.dur), e.vel * d, { bright: 0.35 });
        }
        for (const e of p.mel) {
          const t = humanize(rng, b.at(e.beat), 12) + 0.01;
          inst.piano(t, e.midi, sec(e.dur), Math.min(0.64, e.vel * d), { ch: 'lead', bright: 0.7 });
        }
        for (const e of p.glass) inst.glass(humanize(rng, b.at(e.beat), 8), e.midi, sec(e.dur), e.vel * d);
        for (const e of p.bell) inst.bell(humanize(rng, b.at(e.beat), 8), e.midi, sec(e.dur), e.vel * d, { ratio: bellRatio, ring: 6 });
        for (const e of p.air) {
          const len = sec(e.beats);
          const fin = b.bar >= total - 4;
          const t = Math.max(b.at(e.beat), now);
          airSwell(env, t, len * 0.45, fin ? len * 0.2 : len * 0.3, fin ? Math.max(2, endT - t - len * 0.65) : len * 0.95, AIR * e.level * d);
        }
        for (const e of p.sweeps) inst.sweep(b.at(e.beat), sec(e.dur), e.vel, { up: true, from: 380, to: 2600, q: 2.2 });
      },
    });
  },
};
