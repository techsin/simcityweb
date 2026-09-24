/**
 * "Harbor Lights" - late-night waterfront lounge / trip-hop (~84 bpm, swung 16ths).
 *
 * Tremolo vibraphone carries a composed 8-bar theme (call - response - call' - resolving answer) over jazzy minor-9
 * changes on a muted, filtered Rhodes; a round sub bass locks to a dusty boom-bap kit (soft kick, laid-back
 * snare + rim, band-limited lo-fi hats); vinyl crackle, a distant buoy bell and slow "wave wash" noise swells set the
 * harbour at night.
 *
 * Form: intro (Rhodes + bed, filter opens, drums enter) -> theme (16) -> bridge (8, half-time or cross-stick) ->
 * theme II (16: Rhodes answers the vibes, then trades - the Rhodes takes the call and response while the vibes
 * answer) -> breakdown (8, drums out, motif in augmentation, build) and vibes solo (8/16: quotes the call, sequences
 * it higher, climbs to a peak and comes home through the tune's own cadence) in either order -> theme out (8, Rhodes
 * doubles the tune) -> outro (thins out, iv-V-i, ritardando into a held tonic chord).
 *
 * The Rhodes comp is voice-led under the tune (its top at least a minor 3rd below the melody over each chord, out of
 * the mud below G3), and melody notes that would ring on into a chord they clash with are released at the change.
 *
 * Every play re-rolls: key (F G A Bb C minor), tempo, swing, the A progression (3), the bridge changes (2), the theme
 * (3 composed motifs) and how each statement is ornamented (anticipations, grace notes, neighbour splits, alternate
 * phrase endings), kick / hat patterns, the bridge groove, form order, intro / solo lengths, comping rhythms, bass
 * pickups / glides, section fills, the bridge melody, the vibes solo, Rhodes answer licks and the final chord colour.
 * All of it is planned in create(); bar() only schedules.
 */
import type { MusicEnv, MusicTrack } from '../types';
import type { MixSettings } from '../synth';
import { song, type BarInfo } from '../song';
import { parseChart, voiceLead, voicing, chordTones, scaleFor, bassNote, snap, stepInPool, humanize, humVel, pattern, pc, type Chord } from '../theory';

type Kind = 'intro' | 'A' | 'B' | 'break' | 'solo' | 'outro';
interface Sec {
  name: string;
  bars: number;
  kind: Kind;
}
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
}
interface VEv extends Ev {
  pedal?: boolean;
  /** straight (unswung) timing - triplets */
  st?: boolean;
}
interface BEv extends Ev {
  glide?: number;
}
interface Hit {
  beat: number;
  dur: number;
  notes: number[];
  vel: number;
  roll: number;
}
type DrumKind = 'kick' | 'snare' | 'rim' | 'hat' | 'ohat' | 'shaker' | 'ride';
interface DHit {
  k: DrumKind;
  /** 16th step 0..15 */
  step: number;
  vel: number;
}
interface Fx {
  kind: 'bell' | 'wave' | 'swell' | 'crash';
  beat: number;
  vel: number;
  /** seconds (wave) */
  dur?: number;
  midi?: number;
  pan?: number;
  off?: number;
}
interface BarPlan {
  sec: Sec;
  si: number;
  inSec: number;
  slots: Slot[];
  comp: Hit[];
  pads: Hit[];
  bass: BEv[];
  vibes: VEv[];
  /** Rhodes melody (theme II trade) */
  lead: Ev[];
  /** Rhodes answer licks / octave doubling */
  answer: Ev[];
  drums: DHit[];
  fx: Fx[];
  mix: [string, MixSettings][];
  dyn: number;
}
interface Placed {
  bar: number;
  e: VEv;
}
type Groove = 'none' | 'light' | 'full' | 'fullRim' | 'half' | 'rim' | 'ghost' | 'build' | 'kick';
type Fill = 'drop' | 'roll' | 'swell' | 'flam';
/** [bar, beat, dur, midi in A minor] */
type Note = readonly [number, number, number, number];

// ---------------------------------------------------------------- composed material (reference key: A minor)
/** 8-bar A progressions (bar 7 is the tonic; a turnaround E7alt is appended when the next section starts on i) */
const A_PROGS = [
  'Am9 | Fmaj9 | Dm9 | E7b9 | Am9 | Fmaj9 | Dm9 E7b9 | Am9',
  'Am9 | Dm9 | Fmaj9 | E7b9 | Am9 | Dm9 | Bm7b5 E7b9 | Am9',
  'Am9 | Cmaj9 | Fmaj9 | E7b9 | Am9 | Cmaj9 | Dm9 E7alt | Am9',
];
/** bridge: a stepwise-descending bass line through bII, or the minor circle of fifths */
const B_PROGS = [
  'Fmaj9 | Em7 | Dm9 | Cmaj9 | Bbmaj9 | Am9 | Bm7b5 | E7b9',
  'Dm9 | G13 | Cmaj9 | Fmaj9 | Bm7b5 | E7b9 | Am9 | Bm7b5 E7alt',
];
/** the theme: three composed 8-bar melodies written over A_PROGS[0]; realized over the actual chords with fit() */
const MOTIFS: readonly Note[][] = [
  // "Lanterns": rising 5-b7-1 call, falling answer, the call sequenced a step lower, leading-tone cadence
  [
    [0, 0.5, 0.5, 76], [0, 1, 0.5, 79], [0, 1.5, 2, 81], [0, 3.5, 0.5, 79],
    [1, 0, 1.5, 76], [1, 1.5, 0.5, 74], [1, 2, 1.75, 72],
    [2, 0.5, 0.5, 74], [2, 1, 0.5, 77], [2, 1.5, 2, 79], [2, 3.5, 0.5, 77],
    [3, 0, 1.5, 76], [3, 1.5, 0.5, 74], [3, 2, 1.5, 71], [3, 3.5, 0.5, 68],
    [4, 0.5, 0.5, 76], [4, 1, 0.5, 79], [4, 1.5, 1, 81], [4, 2.5, 0.5, 83], [4, 3, 1, 84],
    [5, 0, 2, 83], [5, 2, 0.75, 81], [5, 2.75, 1.25, 79],
    [6, 0, 0.75, 77], [6, 0.75, 0.75, 76], [6, 1.5, 0.5, 74], [6, 2, 1, 76], [6, 3, 0.5, 71], [6, 3.5, 0.5, 68],
    [7, 0, 2, 69],
  ],
  // "Pier": syncopated falling thirds, answered a step lower, b9 neighbour on the dominant
  [
    [0, 0, 0.75, 81], [0, 0.75, 0.75, 79], [0, 1.5, 1.5, 76], [0, 3.5, 0.5, 79],
    [1, 0, 1.5, 81], [1, 1.5, 0.5, 79], [1, 2, 2, 76],
    [2, 0, 0.75, 77], [2, 0.75, 0.75, 76], [2, 1.5, 1.5, 74], [2, 3.5, 0.5, 77],
    [3, 0, 1.5, 76], [3, 1.5, 0.5, 77], [3, 2, 2, 76],
    [4, 0, 0.75, 81], [4, 0.75, 0.75, 79], [4, 1.5, 1, 76], [4, 2.5, 0.5, 79], [4, 3, 1, 81],
    [5, 0, 0.75, 84], [5, 0.75, 0.75, 83], [5, 1.5, 2.5, 79],
    [6, 0, 1, 77], [6, 1, 1, 74], [6, 2, 1, 76], [6, 3, 1, 71],
    [7, 0, 0.5, 72], [7, 0.5, 1.5, 69],
  ],
  // "Tide": minor-9 arpeggios in long tones, diminished fall on the dominant, resolves up an octave
  [
    [0, 0, 1.5, 76], [0, 1.5, 0.5, 79], [0, 2, 2, 83],
    [1, 0, 1, 81], [1, 1, 1, 79], [1, 2, 2, 76],
    [2, 0, 1.5, 74], [2, 1.5, 0.5, 77], [2, 2, 2, 81],
    [3, 0, 1, 80], [3, 1, 1, 77], [3, 2, 1.5, 74], [3, 3.5, 0.5, 71],
    [4, 0, 1.5, 76], [4, 1.5, 0.5, 79], [4, 2, 1.5, 83], [4, 3.5, 0.5, 84],
    [5, 0, 2, 86], [5, 2, 1, 84], [5, 3, 1, 81],
    [6, 0, 1, 77], [6, 1, 1, 76], [6, 2, 1, 80], [6, 3, 1, 83],
    [7, 0, 2, 81],
  ],
];
const B_CELLS: [number, number][][] = [
  [[0, 2], [2, 2]],
  [[0, 3], [3, 1]],
  [[0.5, 1.5], [2, 2]],
  [[0, 1.5], [1.5, 0.5], [2, 2]],
  [[0, 1], [1, 1], [2, 2]],
];
/** comping rhythms for one-chord bars: [beat, dur, full voicing?]; beat 3.5 with dur 0 = push the next chord */
const COMP_SPARSE: [number, number, boolean][][] = [
  [[0, 3.6, true]],
  [[0, 2.3, true], [2.5, 1.2, false]],
  [[0.5, 3.1, true]],
  [[0, 1.4, true], [1.75, 1.9, false]],
];
const COMP_BUSY: [number, number, boolean][][] = [
  [[0, 1.4, true], [1.75, 0.6, false], [2.5, 1.2, false]],
  [[0, 2.3, true], [2.75, 0.9, false]],
  [[0, 1.2, true], [1.5, 0.4, false], [3, 0.9, false]],
  [[0, 2.6, true], [3.5, 0, true]],
  [[0.5, 1.5, true], [2.5, 1.3, false]],
];
const KICKS = ['X------x--x-----', 'X-----x---x-----', 'X--x------x-----', 'X---------x--x--'];
const HATS = ['x-o-x-o-x-o-x-o-', 'x-o-x-oox-o-x-o-', 'x-oox-o-x-o-x-o.'];
/** hat velocity for the pattern's quarter-note 'x' (0.75): ~7 dB over the 'o' off-beats instead of ~10 */
const HAT_ACC = 0.62;
/** Rhodes channel lowpass once the band is in (intro opens up to it) */
const EP_OPEN = 3600;
const BASS_LVL = 0.43;
const DOM_Q = new Set<string>(['7', '9', '13', '7b9', '7s9', '7s11', '7b13', '7alt', '7sus4', '9sus4', '13sus4']);

/**
 * Wave wash: slow lowpassed-noise swell (water lapping at the pier). Custom graph built from the counted node
 * factory, routed into the 'sweep:wave' channel; envelope 0 -> 0, source always stopped. Gated like
 * Instruments.go() (cutoff, live notes in the past, lab mute / solo as 'wave' | 'sweep' | 'sweep:wave', lab excerpt
 * pre-roll) and added to inst.stats, so the lab's note / node counts include it.
 */
const WAVE_KEYS = ['wave', 'sweep', 'sweep:wave'];
function waveWash(env: MusicEnv, t: number, dur: number, vel: number, pan: number, off: number): void {
  const { inst, ctx } = env;
  if (!isFinite(t) || !(t < inst.cutoff) || (env.live && t < ctx.currentTime)) return;
  if (WAVE_KEYS.some((k) => inst.mute.has(k)) || (inst.solo.size > 0 && !WAVE_KEYS.some((k) => inst.solo.has(k)))) return;
  // offline excerpt renders drop notes that end before the excerpt (Instruments keeps this option private)
  const skip = (inst as unknown as { skipBefore?: number }).skipBefore;
  if (typeof skip === 'number' && t + dur < skip) return;
  // the buffer source is not made by the counted node factory: count it (and the note) here
  const st = inst.stats;
  st.nodes++;
  st.notes++;
  if (st.perSec.length) {
    const k = Math.max(0, Math.floor(t));
    st.perSec[k] = (st.perSec[k] ?? 0) + 1;
    st.notesPerSec[k] = (st.notesPerSec[k] ?? 0) + 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = env.noise;
  src.loop = true;
  src.playbackRate.value = 0.55;
  const lp = inst.node.filter('lowpass', 260, 0.5);
  lp.frequency.setValueAtTime(240, t);
  lp.frequency.exponentialRampToValueAtTime(900, t + dur * 0.42);
  lp.frequency.exponentialRampToValueAtTime(200, t + dur);
  const g = inst.node.gain(0);
  const pk = 0.2 * Math.pow(Math.max(0, Math.min(1, vel)), 1.5);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(pk, t + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(pk * 0.004, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  const pn = inst.node.panner(pan);
  src.connect(lp).connect(g).connect(pn).connect(inst.channel('sweep:wave').input);
  src.start(t, off * (env.noise.duration - 0.1));
  src.stop(t + dur + 0.05);
}

export const track: MusicTrack = {
  id: 'harbor_lights',
  title: 'Harbor Lights',
  mood: 'Late-night waterfront trip-hop: tremolo vibes, muted Rhodes, sub bass, dusty swung drums',
  tags: ['night', 'calm'],
  bpm: 84,
  gain: 1.52,
  create(env) {
    const { inst, rng } = env;
    const bpm = rng.int(80, 87);
    inst.bpm = bpm;
    const swing = rng.range(0.55, 0.62); // swung 16ths: light shuffle .. near-triplet lilt
    const T = rng.pick([-4, -2, 0, 1, 3]); // F G A Bb C minor
    const MOT = MOTIFS[rng.int(0, MOTIFS.length - 1)];
    const PA = rng.pick(A_PROGS);
    const X = PA.split('|')[1].trim();
    const BCH = rng.pick(B_PROGS);
    const bGroove: Groove = rng.chance(0.5) ? 'half' : 'rim';
    const FIN = rng.pick(['Am9', 'Am11', 'Am69']);

    // ---------------------------------------------------------------- form
    const introBars = rng.chance(0.6) ? 8 : 4;
    const soloBars = rng.chance(0.55) ? 16 : 8;
    const brk: Sec = { name: 'breakdown', bars: 8, kind: 'break' };
    const solo: Sec = { name: 'vibes solo', bars: soloBars, kind: 'solo' };
    const FORM: Sec[] = [
      { name: 'intro', bars: introBars, kind: 'intro' },
      { name: 'theme', bars: 16, kind: 'A' },
      { name: 'bridge', bars: 8, kind: 'B' },
      { name: 'theme II', bars: 16, kind: 'A' },
      ...(rng.chance(0.5) ? [brk, solo] : [solo, brk]),
      { name: 'theme out', bars: 8, kind: 'A' },
      { name: 'outro', bars: 8, kind: 'outro' },
    ];

    // ---------------------------------------------------------------- charts
    const startsOnI = (k: Kind | undefined) => k === 'A' || k === 'solo' || k === 'outro';
    const block = (variant: number, turn: boolean): string => {
      const bars = PA.split('|').map((s) => s.trim());
      if (variant > 0) {
        if (rng.chance(0.4)) for (let i = 0; i < bars.length; i++) bars[i] = bars[i].replace('Fmaj9', 'Fmaj7#11');
        if (rng.chance(0.3)) bars[3] = bars[3].replace('E7b9', 'E7alt');
        if (rng.chance(0.35)) bars[4] = 'Am11';
      }
      if (turn) bars[7] = `${bars[7]} E7alt`;
      return bars.join(' | ');
    };
    const chartFor = (s: Sec, si: number): string => {
      const turnOut = startsOnI(FORM[si + 1]?.kind);
      const pre = X === 'Dm9' ? 'Fmaj9' : 'Dm9';
      switch (s.kind) {
        case 'intro':
          return s.bars === 8 ? `Am9 | ${X} | Am9 | ${X} | Am9 | ${X} | ${pre} | E7sus4 E7b9` : `Am9 | ${X} | ${pre} | E7sus4 E7b9`;
        case 'A':
          return s.bars === 16 ? `${block(0, true)} | ${block(1, turnOut)}` : block(1, turnOut);
        case 'B':
          return BCH;
        case 'break':
          return 'Fmaj9 | % | Am9 | % | Dm9 | % | E7sus4 | E7b9';
        case 'solo': {
          const n = s.bars / 8;
          const out: string[] = [];
          for (let i = 0; i < n; i++) out.push(block(2, i < n - 1 || turnOut));
          return out.join(' | ');
        }
        case 'outro':
          return `Am9 | ${X} | Am9 | ${X} | Dm9 | E7sus4 E7b9 | ${FIN} | ${FIN}`;
      }
    };

    const plan: BarPlan[] = [];
    const secStart: number[] = [];
    FORM.forEach((s, si) => {
      secStart.push(plan.length);
      const bars = parseChart(chartFor(s, si), T);
      for (let i = 0; i < s.bars; i++) {
        const cs = bars[i % bars.length];
        plan.push({
          sec: s, si, inSec: i,
          slots: cs.map((c, k) => ({ beat: (k * 4) / cs.length, dur: 4 / cs.length, chord: c })),
          comp: [], pads: [], bass: [], vibes: [], lead: [], answer: [], drums: [], fx: [], mix: [], dyn: 1,
        });
      }
    });
    const total = plan.length;
    const chordAt = (bar: number, beat: number): Chord => {
      const p = plan[Math.max(0, Math.min(total - 1, bar + Math.floor(beat / 4)))];
      const bb = ((beat % 4) + 4) % 4;
      let c = p.slots[0].chord;
      for (const s of p.slots) if (bb >= s.beat - 1e-6) c = s.chord;
      return c;
    };
    const isChange = (bar: number, beat: number): boolean => {
      const p = plan[Math.min(total - 1, bar)];
      if (!p.slots.some((s) => Math.abs(s.beat - beat) < 1e-6)) return false;
      return beat > 0 || bar === 0 || plan[bar - 1].slots[plan[bar - 1].slots.length - 1].chord.name !== p.slots[0].chord.name;
    };

    // ---------------------------------------------------------------- melodic fitting
    const keyPcs = new Set([0, 2, 3, 5, 7, 8, 10].map((x) => pc(9 + T + x)));
    const isTone = (m: number, c: Chord) => c.tones.some((t) => t % 12 === pc(m - c.root));
    const avoid = (m: number, c: Chord): boolean => {
      const rel = pc(m - c.root);
      const ts = c.tones.map((t) => t % 12);
      if (ts.includes(rel)) return false;
      if (DOM_Q.has(c.quality)) {
        if (rel === 5) return !c.quality.includes('sus');
        if (rel === 1 || rel === 3 || rel === 8) return false;
      }
      return ts.some((t) => pc(rel - t) === 1);
    };
    const colourOk = (m: number, c: Chord) => !avoid(m, c) && (keyPcs.has(pc(m)) || isTone(m, c));
    const allowed = (c: Chord, lo: number, hi: number): number[] => {
      const out: number[] = [];
      for (let m = lo; m <= hi; m++) if (colourOk(m, c)) out.push(m);
      return out.length ? out : chordTones(c, lo, hi);
    };
    /** keep composed pitches when they are chord tones or good colours, else move to the nearest acceptable note */
    const fit = (m: number, c: Chord, strong: boolean): number => {
      if (isTone(m, c)) return m;
      if (strong && DOM_Q.has(c.quality) && pc(m - c.root) === 3) return m + 1; // #9 -> major third on strong beats
      if (colourOk(m, c)) return m;
      const cands: number[] = [];
      for (let x = m - 2; x <= m + 2; x++) if (x !== m && (strong ? isTone(x, c) : colourOk(x, c))) cands.push(x);
      return cands.length ? snap(m, cands) : snap(m, chordTones(c, m - 7, m + 7));
    };
    const guideTones = (c: Chord, lo: number, hi: number) => chordTones(c, lo, hi).filter((m) => [3, 4, 10, 11].includes(pc(m - c.root)));

    // ---------------------------------------------------------------- lines
    const addAt = (out: Placed[], b0: number, pos: number, dur: number, midi: number, vel: number, pedal?: boolean) => {
      const bar = b0 + Math.floor(pos / 4);
      out.push({ bar, e: { beat: pos - Math.floor(pos / 4) * 4, dur, midi, vel, pedal } });
    };
    /** realize (a part of) the theme from global bar b0: amt 0 = as composed, 1 = heavily ornamented */
    const realize = (b0: number, notes: readonly Note[], amt: number, o: { endAlt?: boolean; vel?: number; pedal?: boolean; stretch?: number; shift?: number } = {}): Placed[] => {
      const out: Placed[] = [];
      const st = o.stretch ?? 1;
      notes.forEach(([nb, nbeat, ndur, ref], i) => {
        const pos = (nb * 4 + nbeat) * st;
        let dur = ndur * st;
        let m = ref + T + (o.shift ?? 0);
        const c = chordAt(b0 + Math.floor(pos / 4), pos % 4);
        const beat = pos % 4;
        const strong = beat % 1 === 0 || dur >= 1;
        if (i === notes.length - 1 && o.endAlt) {
          // open ending: the 3rd or 5th ABOVE the composed tonic (never down into the Rhodes)
          const alts = chordTones(c, m + 1, Math.min(m + 7, 86 + T)).filter((x) => [3, 7].includes(pc(x - c.root)));
          if (alts.length) m = rng.pick(alts);
        }
        m = fit(m, c, strong);
        const vel = (o.vel ?? 0.56) + (dur >= 1.5 ? 0.035 : 0) + (m - 76 - T) * 0.004;
        let pb = pos;
        if (amt > 0 && i > 0 && beat % 1 === 0 && beat > 0 && rng.chance(0.22 * amt)) (pb -= 0.25), (dur += 0.25);
        if (amt > 0 && dur >= 1.5 && pb >= 0.25 && rng.chance(0.3 * amt)) {
          const g = rng.chance(0.5) ? m - 1 : stepInPool(m, 1, allowed(c, m - 3, m + 4));
          addAt(out, b0, pb - 0.18, 0.2, g, vel - 0.17, o.pedal);
        }
        // neighbour split of a long note (never the phrase's final, resolving note)
        if (amt > 0 && dur >= 2 && i < notes.length - 1 && rng.chance(0.25 * amt)) {
          const half = dur / 2;
          addAt(out, b0, pb, half, m, humVel(rng, vel, 0.03), o.pedal);
          const c2 = chordAt(b0, pb + half);
          const n2 = fit(stepInPool(m, rng.chance(0.6) ? 1 : -1, allowed(c2, m - 4, m + 4)), c2, false);
          addAt(out, b0, pb + half, half, n2, humVel(rng, vel - 0.06, 0.03), o.pedal);
          return;
        }
        addAt(out, b0, pb, dur, m, humVel(rng, vel, 0.035), o.pedal);
      });
      return out;
    };
    /** bridge: lyrical long notes rising then falling, double-stopped (two mallets) on held notes */
    const bridgeLine = (b0: number, bars: number): Placed[] => {
      const out: Placed[] = [];
      const lo = 67 + T, hi = 85 + T;
      let cur = rng.int(72, 76) + T;
      const peakBar = rng.int(2, 4);
      const peak = rng.int(80, 84) + T;
      for (let bar = 0; bar < bars; bar++) {
        const last = bar === bars - 1;
        const cell: [number, number][] = last ? [[0, 2]] : rng.pick(B_CELLS);
        cell.forEach(([beat, dur], j) => {
          const c = chordAt(b0 + bar, beat);
          const pool = allowed(c, lo, hi);
          // arch: climb towards the peak, then settle back down towards the leading tone
          const goal = bar <= peakBar ? peak : 74 + T;
          const dir = goal > cur + 1 ? 1 : goal < cur - 1 ? -1 : rng.chance(0.5) ? 1 : -1;
          const prev = cur;
          cur = stepInPool(cur, j === 0 ? dir * rng.int(1, 2) : rng.pick([-1, 1, 1, 2]) * dir, pool);
          if (cur === prev) cur = stepInPool(cur, -dir, pool);
          const ct = chordTones(c, lo, hi);
          if (dur >= 1.5 || beat % 2 === 0) {
            const s = snap(cur, ct);
            if (Math.abs(s - cur) <= 2) cur = s;
          }
          if (last) {
            const g = ct.filter((x) => [3, 4, 7].includes(pc(x - c.root)));
            if (g.length) cur = snap(cur, g);
          }
          const vel = humVel(rng, 0.54, 0.04);
          out.push({ bar: b0 + bar, e: { beat, dur: dur * 0.96, midi: cur, vel } });
          if (dur >= 1.5) {
            const below = chordTones(c, cur - 9, cur - 3);
            if (below.length) out.push({ bar: b0 + bar, e: { beat, dur: dur * 0.96, midi: below[below.length - 1], vel: vel * 0.66 } });
          }
        });
      }
      return out;
    };
    /** scale degree of a reference pitch in A natural minor (A3 = 0; the leading tone G# counts as G) */
    const AMIN = [0, 2, 3, 5, 7, 8, 10];
    const degOf = (ref: number): number => {
      const r = ref - 57, o = Math.floor(r / 12), k = ((r % 12) + 12) % 12;
      let i = AMIN.length - 1;
      while (AMIN[i] > k) i--;
      return o * 7 + i;
    };
    /** the rhythm and scale-step contour of a composed phrase, restarted `lift` semitones higher over the changes at b0 */
    const sequence = (b0: number, notes: readonly Note[], lift: number, lo: number, hi: number, vel: number): Placed[] => {
      const out: Placed[] = [];
      let cur = 0, prevDeg = 0;
      notes.forEach(([nb, nbeat, ndur, ref], i) => {
        const pos = nb * 4 + nbeat;
        const bar = b0 + Math.floor(pos / 4), beat = pos - Math.floor(pos / 4) * 4;
        const c = chordAt(bar, beat);
        const pool = allowed(c, lo, hi);
        const d = degOf(ref);
        if (i === 0) cur = snap(ref + T + lift, chordTones(c, lo, hi));
        else {
          const prev = cur;
          cur = stepInPool(cur, d - prevDeg, pool);
          if (cur === prev && d !== prevDeg) cur = stepInPool(cur, prevDeg - d, pool);
          if (beat % 1 === 0 && ndur >= 1) {
            // long notes on the beat land on a chord tone when one is a step away
            const s = snap(cur, chordTones(c, lo, hi));
            if (Math.abs(s - cur) <= 2 && s !== prev) cur = s;
          }
        }
        prevDeg = d;
        out.push({ bar, e: { beat, dur: ndur, midi: cur, vel: humVel(rng, vel + (ndur >= 1.5 ? 0.03 : 0), 0.035) } });
      });
      return out;
    };
    /**
     * vibes solo: quotes the call, sequences its rhythm and contour higher, then climbs through freer phrases (8ths,
     * swung 16th pairs, triplet arpeggios, breaths) to a peak about two thirds in, and comes home with the tune's own
     * cadence in the last two bars (the solo changes end like the theme's). Sits above the head (Bb4..F6 in A minor),
     * never re-strikes the note it just played.
     */
    const soloLine = (b0: number, bars: number): Placed[] => {
      const call = MOT.filter((n) => n[0] < 2);
      const cad = MOT.filter((n) => n[0] >= 6).map(([b, beat, dur, m]) => [b - 6, beat, dur, m] as Note);
      const lo = 70 + T, hi = Math.min(89 + T, 90);
      const out: Placed[] = realize(b0, call, 0.8, { vel: 0.55 });
      const callTop = Math.max(...call.map((n) => n[3])) + T;
      out.push(...sequence(b0 + 2, call, Math.max(2, Math.min(rng.pick([3, 5, 7]), hi - 1 - callTop)), lo, hi, 0.54));
      // free phrases, bars 5 .. bars-2, shaped by a goal contour: from above the tune's cadence up to a peak and back
      const f0 = 16, endF = (bars - 2) * 4 - 0.5;
      const home = 79 + T, peak = hi - 2;
      // one arch over the whole solo, with phrase-length waves riding on it (so the line rises and falls, not hovers)
      const phase = rng.range(0, 0.8), wave = 3.5 * Math.min(1, (endF - f0) / 16); // the first wave rises
      const goal = (p: number) => {
        const x = Math.min(1, Math.max(0, (p - f0) / (endF - f0)));
        const g = home + (peak - home) * Math.sin(Math.PI * Math.pow(x, 1.6)) + wave * Math.sin((2 * Math.PI * (p - f0)) / 7 + phase);
        return Math.max(lo + 2, Math.min(hi - 1, g));
      };
      let last = out[out.length - 1].e.midi;
      let cur = last;
      let dir = 1;
      const emit = (p: number, dur: number, m: number, vel: number, st?: boolean) => {
        const bar = Math.floor(p / 4);
        out.push({ bar: b0 + bar, e: { beat: p - bar * 4, dur, midi: m, vel, st } });
        last = m;
      };
      /** m, or one more step (the other way at the range edge) if m is the note just played */
      const fresh = (m: number, d: number, pool: number[]) => {
        if (m !== last) return m;
        const a = stepInPool(m, d, pool);
        return a !== m ? a : stepInPool(m, -d, pool);
      };
      let pos = f0 + rng.pick([0.5, 1]);
      while (pos < endF - 1) {
        const x = (pos - f0) / (endF - f0);
        const stop = Math.min(endF - 0.5, pos + rng.int(4, 8 + Math.round(6 * x)) * 0.5);
        let first = true;
        while (pos < stop) {
          const bar = Math.floor(pos / 4), beat = pos - bar * 4;
          const c = chordAt(b0 + bar, beat);
          const pool = allowed(c, lo, hi);
          const want = goal(pos);
          if (cur >= hi - 1) dir = -1;
          else if (cur <= lo + 1) dir = 1;
          else if (cur < want - 2) dir = rng.chance(0.85) ? 1 : -1;
          else if (cur > want + 2) dir = rng.chance(0.85) ? -1 : 1;
          else if (rng.chance(0.25)) dir = -dir;
          if (!first && beat % 1 === 0 && pos + 1 <= stop && rng.chance(0.06 + 0.06 * x)) {
            // triplet arpeggio through the chord tones
            const tones = chordTones(c, lo, hi);
            let m = fresh(snap(cur + dir, tones), dir, tones);
            for (let q = 0; q < 3; q++) {
              emit(pos + q / 3, 0.34, m, humVel(rng, 0.5, 0.04), true);
              const n = stepInPool(m, dir, tones);
              if (n === m) dir = -dir;
              m = n !== m ? n : stepInPool(m, dir, tones);
            }
            cur = last;
            pos += 1;
            continue;
          }
          let nx: number;
          if (isChange(b0 + bar, beat) && rng.chance(0.65)) {
            const g = guideTones(c, lo, hi);
            nx = g.length ? snap(cur + dir, g) : stepInPool(cur, dir, pool);
          } else nx = stepInPool(cur, dir * (rng.chance(0.78) ? 1 : 2), pool);
          cur = fresh(nx, dir, pool);
          const vel = humVel(rng, 0.5 + (beat % 1 ? 0.03 : 0) + 0.04 * x, 0.05);
          const r = rng.next();
          if (r < 0.16 + 0.2 * x && pos + 0.5 <= stop) {
            // swung 16th pair
            emit(pos, 0.3, cur, vel);
            cur = fresh(stepInPool(cur, dir, pool), dir, pool);
            emit(pos + 0.25, 0.3, cur, vel - 0.04);
            pos += 0.5;
          } else {
            const step = r < 0.85 ? 0.5 : 1;
            emit(pos, step * 1.1, cur, vel);
            pos += step;
          }
          first = false;
        }
        if (pos < endF) {
          // phrase end: a held chord tone (released at the next change if it would clash there - see tidy pass)
          const bar = Math.floor(pos / 4), beat = pos - bar * 4;
          const tones = chordTones(chordAt(b0 + bar, beat), lo, hi);
          cur = fresh(snap(cur + dir, tones), dir, tones);
          const d = Math.min(endF - pos, rng.pick([1, 1.5, 2]));
          emit(pos, d, cur, humVel(rng, 0.52, 0.04));
          pos += d;
        }
        pos += rng.pick([1, 1.5, 2, 2.5]) * (1 - 0.35 * x);
        pos = Math.round(pos * 2) / 2;
      }
      out.push(...realize(b0 + bars - 2, cad, 0.4, { vel: 0.55 }));
      return out;
    };
    /** Rhodes answer lick in the gap [from, to) of global bar `bar` */
    const lick = (bar: number, from: number, to: number, lo = 62, hi = 79, vel = 0.46): Ev[] => {
      const out: Ev[] = [];
      if (to - from < 1) return out;
      const n = to - from >= 2 ? rng.int(3, 4) : 2;
      const stp = n >= 3 && rng.chance(0.4) ? 0.25 : 0.5;
      const up = rng.chance(0.35);
      let m = fit(snap(rng.int(lo + 8, hi - 2), chordTones(chordAt(bar, from), lo, hi)), chordAt(bar, from), true);
      for (let k = 0; k < n; k++) {
        const beat = from + k * stp;
        if (beat >= to - 0.2) break;
        const c = chordAt(bar, beat);
        const lastN = k === n - 1;
        if (k > 0) m = stepInPool(m, up ? 1 : -rng.int(1, 2), lastN ? chordTones(c, lo, hi) : allowed(c, lo, hi));
        out.push({ beat, dur: lastN ? Math.max(0.5, to - beat) : stp * 1.15, midi: m, vel: humVel(rng, vel - (lastN ? 0 : 0.04), 0.04) });
      }
      return out;
    };
    /** vibes answer in a gap of the Rhodes melody: 2-3 notes stepping down (or up) to a chord tone around `centre` */
    const vibesAnswer = (bar: number, from: number, to: number, centre: number): VEv[] => {
      const out: VEv[] = [];
      const n = to - from >= 1.5 ? 3 : 2;
      const down = rng.chance(0.65);
      const lo = centre - 9, hi = Math.min(centre + 9, 90);
      let m = snap(centre + (down ? 3 : -3), chordTones(chordAt(bar, from), lo, hi));
      for (let k = 0; k < n; k++) {
        const beat = from + k * 0.5;
        const c = chordAt(bar, beat);
        const last = k === n - 1 || beat + 0.5 >= to - 0.2;
        if (k > 0) {
          const nx = stepInPool(m, down ? -1 : 1, last ? chordTones(c, lo, hi) : allowed(c, lo, hi));
          m = nx !== m ? nx : stepInPool(m, down ? 1 : -1, allowed(c, lo, hi));
        }
        out.push({ beat, dur: last ? Math.max(0.5, to - beat) : 0.55, midi: m, vel: humVel(rng, last ? 0.44 : 0.4, 0.03) });
        if (last) break;
      }
      return out;
    };
    const pickup = (bar: number, target: number): VEv[] => {
      const c = chordAt(bar, 3);
      const pool = allowed(c, target - 9, target + 2).filter((x) => keyPcs.has(pc(x)) || isTone(x, c));
      let m = stepInPool(target, -3, pool);
      return [2.5, 3, 3.5].map((beat) => {
        const e: VEv = { beat, dur: 0.45, midi: m, vel: humVel(rng, 0.46 + beat * 0.02, 0.03) };
        m = stepInPool(m, 1, pool);
        return e;
      });
    };
    const vibesFree = (bar: number, from: number) => plan[bar].vibes.every((e) => e.beat + e.dur <= from + 0.05);
    const motifStart = MOT[0][3] + T;
    const place = (xs: Placed[]) => xs.forEach(({ bar, e }) => bar >= 0 && bar < total && plan[bar].vibes.push(e));

    // theme statements
    let stmt = 0;
    /** bars where the Rhodes has the tune and the vibes answer (theme II, second block, first half) */
    const traded = new Set<number>();
    FORM.forEach((s, si) => {
      const b0 = secStart[si];
      if (s.kind === 'A') {
        for (let blk = 0; blk < s.bars / 8; blk++) {
          const amt = s.name === 'theme out' ? 0.35 : [0, 0.3, 0.5, 0.7][Math.min(3, stmt)];
          const inner = blk === 0 && s.bars === 16;
          const bb = b0 + blk * 8;
          if (s.name === 'theme II' && blk === 1) {
            // 4th statement: the Rhodes takes the call and response, the vibes answer in its long notes and take
            // the tune back for the second half
            for (let i = 0; i < 4; i++) traded.add(bb + i);
            for (const { bar, e } of realize(bb, MOT.filter((n) => n[0] < 4), amt, { vel: 0.6 })) if (bar < total) plan[bar].lead.push(e);
            place(realize(bb, MOT.filter((n) => n[0] >= 4), amt));
            for (let i = 0; i < 4; i++) {
              // the widest gap inside a held Rhodes note of this bar
              let gap: { from: number; to: number; m: number } | null = null;
              for (const e of plan[bb + i].lead) {
                if (e.dur < 1.5 || e.beat + e.dur > 4.1) continue;
                const from = e.beat + (e.dur >= 2 ? 1 : 0.5), to = Math.min(4, e.beat + e.dur);
                if (to - from >= 0.95 && (!gap || to - from >= gap.to - gap.from)) gap = { from, to, m: e.midi };
              }
              if (gap && rng.chance(0.85)) plan[bb + i].vibes.push(...vibesAnswer(bb + i, gap.from, gap.to, gap.m <= 79 + T ? gap.m + 7 : gap.m - 7));
            }
            stmt++;
            continue;
          }
          const ph = realize(bb, MOT, amt, { endAlt: inner && rng.chance(0.5) });
          place(ph);
          if (s.name === 'theme out') {
            // Rhodes doubles the tune an octave below
            ph.forEach(({ bar, e }) => e.dur > 0.21 && plan[bar].answer.push({ beat: e.beat + 0.02, dur: e.dur, midi: e.midi - 12, vel: e.vel * 0.55 }));
          }
          stmt++;
        }
      } else if (s.kind === 'B') place(bridgeLine(b0, s.bars));
      else if (s.kind === 'solo') place(soloLine(b0, s.bars));
      else if (s.kind === 'break') {
        // the call in augmentation (pedal down), then the response over the iv chord; bars 6-7 left open for the build
        place(realize(b0, MOT.filter((n) => n[0] < 2), 0, { stretch: 2, pedal: true, vel: 0.5 }));
        place(realize(b0 + 4, MOT.filter((n) => n[0] === 2).map(([, beat, dur, m]) => [0, beat, dur, m] as Note), 0, { stretch: 2, pedal: true, vel: 0.47 }));
      } else if (s.kind === 'intro') {
        // distant "harbour lights": soft pedalled high chord tones, every other bar
        for (let i = 1; i < s.bars - 1; i += 2) {
          const c = chordAt(b0 + i, 1);
          // pedalled: only tones that still sound right over the next bar's chord
          const nx = chordAt(b0 + i + 1, 0);
          const tones = chordTones(c, 79 + T, 91 + T).filter((m) => colourOk(m, nx));
          if (tones.length < 2) continue;
          const a = rng.pick(tones.slice(0, -1));
          plan[b0 + i].vibes.push({ beat: 1, dur: 2, midi: a, vel: humVel(rng, 0.36, 0.04), pedal: true });
          plan[b0 + i].vibes.push({ beat: 2.5, dur: 2, midi: stepInPool(a, rng.chance(0.5) ? 1 : -1, tones), vel: humVel(rng, 0.3, 0.04), pedal: true });
        }
      } else if (s.kind === 'outro') {
        const call = MOT.filter((n) => n[0] < 2);
        place(realize(b0, call, 0.3, { vel: 0.54 }));
        place(realize(b0 + 2, call.slice(0, Math.max(3, Math.ceil(call.length / 2))), 0, { vel: 0.44, pedal: true }));
        place(realize(b0 + 4, MOT.filter((n) => n[0] === 2 || n[0] === 3).map(([b, beat, dur, m]) => [b - 2, beat, dur, m] as Note), 0.2, { vel: 0.48 }));
        // final resolution: tonic + a high 9th sigh
        const fb = b0 + 6;
        const fc = plan[fb].slots[0].chord;
        const ton = snap(motifStart - 7, chordTones(fc, 67 + T, 83 + T).filter((m) => pc(m - fc.root) === 0));
        plan[fb].vibes.push({ beat: 0, dur: 6, midi: ton, vel: 0.5, pedal: true });
        plan[fb].vibes.push({ beat: 1.5, dur: 5, midi: ton + 14, vel: 0.34, pedal: true });
        plan[fb + 1].vibes.push({ beat: 1, dur: 4, midi: ton + 7, vel: 0.24, pedal: true });
      }
    });
    // pickups into every theme statement
    FORM.forEach((s, si) => {
      if (s.kind !== 'A' || si === 0) return;
      const pb = secStart[si] - 1;
      if (vibesFree(pb, 2.4)) plan[pb].vibes.push(...pickup(pb, fit(motifStart, chordAt(pb + 1, MOT[0][1]), true)));
    });

    // Rhodes answers (call & response with the vibes)
    FORM.forEach((s, si) => {
      const b0 = secStart[si];
      if (s.kind === 'A') {
        for (let blk = 0; blk < s.bars / 8; blk++) {
          const first = s.name === 'theme' && blk === 0;
          if (s.name === 'theme out') continue;
          const bb = b0 + blk * 8;
          if (!first) plan[bb + 7].answer.push(...lick(bb + 7, 2.25, 3.9));
          if (s.name !== 'theme') {
            for (let i = 0; i < 7; i++) {
              if (traded.has(bb + i)) continue;
              const held = plan[bb + i].vibes.find((e) => e.dur >= 2 && e.beat + e.dur <= 4.05);
              if (held && rng.chance(0.45)) plan[bb + i].answer.push(...lick(bb + i, held.beat + 1, held.beat + held.dur, 60, 74, 0.42));
            }
          }
        }
      } else if (s.kind === 'B') {
        for (let i = 0; i < s.bars - 1; i++) {
          const held = plan[b0 + i].vibes.find((e) => e.dur >= 1.9 && e.beat >= 1.9);
          if (held && rng.chance(0.55)) plan[b0 + i].answer.push(...lick(b0 + i, held.beat + 0.5, Math.min(4, held.beat + held.dur), 58, 72, 0.42));
        }
      }
    });

    // melody notes (not pedalled) that would ring on into a chord they clash with are released just before the change
    plan.forEach((p, bi) => {
      for (const list of [p.vibes, p.lead, p.answer] as VEv[][]) {
        for (const e of list) {
          if (e.pedal || e.dur <= 0.6) continue;
          const g0 = bi * 4 + e.beat, g1 = g0 + e.dur;
          let cPrev = chordAt(bi, e.beat);
          scan: for (let b = bi; b < total && b * 4 < g1 - 0.25; b++) {
            for (const s of plan[b].slots) {
              const g = b * 4 + s.beat;
              if (g <= g0 + 0.01) continue;
              if (g >= g1 - 0.25) break scan;
              if (s.chord.name === cPrev.name) continue;
              if (!colourOk(e.midi, s.chord)) {
                e.dur = Math.max(0.45, g - g0 - 0.06);
                break scan;
              }
              cPrev = s.chord;
            }
          }
        }
      }
    });

    // ---------------------------------------------------------------- drums
    const kMain = pattern(rng.pick(KICKS));
    const kAlt = [...kMain];
    if (rng.chance(0.5)) kAlt[15] = 0.35;
    else (kAlt[13] = 0.75), (kAlt[10] = 0);
    const hatP = pattern(rng.pick(HATS));
    const grooveOf = (p: BarPlan): Groove => {
      const i = p.inSec, n = p.sec.bars;
      switch (p.sec.kind) {
        case 'intro': return i < n / 2 ? 'none' : 'light';
        case 'A': case 'solo': return 'full';
        case 'B': return bGroove;
        case 'break': return i < 4 ? 'none' : i < 6 ? 'ghost' : i === 6 ? 'light' : 'build';
        case 'outro': return i < 2 ? 'fullRim' : i < 4 ? 'light' : i < 5 ? 'kick' : 'none';
      }
    };
    const grooves: Groove[] = plan.map(grooveOf);
    const fills: (Fill | null)[] = plan.map(() => null);
    plan.forEach((p, bi) => {
      const g = grooves[bi];
      const d: DHit[] = [];
      const alt = p.inSec % 4 === 3;
      const shaker = p.sec.kind === 'solo' || p.sec.name === 'theme out' || p.sec.name === 'theme II' || (p.sec.name === 'theme' && p.inSec >= 8);
      if (g !== 'none') {
        const hs = g === 'light' || g === 'ghost' || g === 'build' ? 0.7 : g === 'rim' ? 0.85 : 1;
        if (g === 'kick' || g === 'ghost' || g === 'build') d.push({ k: 'kick', step: 0, vel: 0.5 });
        else if (g === 'half') {
          d.push({ k: 'kick', step: 0, vel: 0.7 });
          if (rng.chance(0.6)) d.push({ k: 'kick', step: rng.pick([6, 7]), vel: 0.5 });
          if (alt) d.push({ k: 'kick', step: 14, vel: 0.45 });
        } else (alt ? kAlt : kMain).forEach((v, s) => v && d.push({ k: 'kick', step: s, vel: (v >= 1 ? 0.7 : v >= 0.75 ? 0.58 : 0.4) * (g === 'light' ? 0.85 : 1) }));
        if (g === 'full') {
          for (const s of [4, 12]) d.push({ k: 'snare', step: s, vel: humVel(rng, 0.56, 0.04) }, { k: 'rim', step: s, vel: 0.24 });
          if (rng.chance(0.3)) d.push({ k: 'snare', step: 7, vel: 0.13 });
          if (rng.chance(0.35)) d.push({ k: 'snare', step: 15, vel: 0.15 });
          if (rng.chance(0.12)) d.push({ k: 'snare', step: 10, vel: 0.12 });
        } else if (g === 'half') {
          d.push({ k: 'snare', step: 8, vel: humVel(rng, 0.58, 0.04) }, { k: 'rim', step: 8, vel: 0.24 });
          if (rng.chance(0.4)) d.push({ k: 'snare', step: 14, vel: 0.13 });
        } else if (g === 'fullRim' || g === 'rim' || g === 'light') {
          for (const s of [4, 12]) d.push({ k: 'rim', step: s, vel: humVel(rng, g === 'light' ? 0.4 : 0.46, 0.04) });
        }
        if (g !== 'kick') {
          hatP.forEach((v, s) => {
            if (!v) return;
            const open = s === 14 && alt && (g === 'full' || g === 'half' || g === 'fullRim') && rng.chance(0.45);
            // small quarter-note accent (pattern 'x' 0.75 -> HAT_ACC): lazier, less on top of the beat
            d.push({ k: open ? 'ohat' : 'hat', step: s, vel: (v >= 0.75 ? HAT_ACC : v) * 0.42 * hs * (open ? 0.8 : 1) });
          });
          // swung ghost 16ths on the "a" of the beat (the lilt into the next beat) in the busier sections
          if (g === 'full' && (p.sec.kind === 'solo' || p.sec.name === 'theme II' || p.sec.name === 'theme out'))
            for (const s of [3, 7, 11, 15]) if (!hatP[s] && rng.chance(0.75)) d.push({ k: 'hat', step: s, vel: humVel(rng, 0.085, 0.02) });
        }
        if (shaker && g === 'full') for (const s of [2, 6, 10, 14]) d.push({ k: 'shaker', step: s, vel: humVel(rng, 0.28, 0.03) });
        // lounge ride ping over the solo: quarters with a swung skip into 2 and 4
        if (p.sec.kind === 'solo' && g === 'full') for (const [s, v] of [[0, 0.3], [4, 0.34], [7, 0.2], [8, 0.3], [12, 0.34], [15, 0.2]] as const) d.push({ k: 'ride', step: s, vel: humVel(rng, v, 0.03) });
        if (g === 'build') for (let s = 0; s < 16; s += 2) d.push({ k: 'snare', step: s, vel: 0.1 + 0.24 * (s / 14) });
      }
      p.drums = d;
      // section-end fills
      const lastBar = p.inSec === p.sec.bars - 1;
      if (lastBar && g !== 'none' && g !== 'build' && p.sec.kind !== 'outro') {
        const f: Fill = rng.weighted<Fill>(['drop', 'roll', 'swell', 'flam'], [0.25, 0.3, 0.25, 0.2]);
        fills[bi] = f;
        if (f === 'drop') p.drums = d.filter((h) => h.step < 8);
        else if (f === 'roll') {
          p.drums = d.filter((h) => !(h.k === 'snare' && h.step > 12));
          p.drums.push({ k: 'snare', step: 13, vel: 0.15 }, { k: 'snare', step: 14, vel: 0.2 }, { k: 'snare', step: 15, vel: 0.27 });
        } else if (f === 'flam') {
          p.drums.push({ k: 'snare', step: 14, vel: 0.3 }, { k: 'snare', step: 15, vel: 0.36 }, { k: 'kick', step: 11, vel: 0.45 });
        } else {
          p.drums = d.map((h) => (h.k === 'hat' && h.step === 14 ? { ...h, k: 'ohat' as DrumKind } : h));
          p.fx.push({ kind: 'swell', beat: 4, vel: 0.24 });
        }
      }
      if (g === 'build') p.fx.push({ kind: 'swell', beat: 4, vel: 0.26 });
    });
    // soft crash on a section downbeat after a drop / swell / build
    plan.forEach((p, bi) => {
      if (bi === 0 || p.inSec !== 0 || (p.sec.kind !== 'A' && p.sec.kind !== 'solo')) return;
      const f = fills[bi - 1];
      if (f === 'drop' || f === 'swell' || grooves[bi - 1] === 'build') p.fx.push({ kind: 'crash', beat: 0, vel: 0.2 });
    });

    // ---------------------------------------------------------------- bass
    let prevBass = 36 + T;
    const bassRoot = (c: Chord, near: number): number => {
      const n = bassNote(c, 32);
      const cands = [n, n + 12].filter((x) => x <= 45);
      return snap(near - 1, cands);
    };
    plan.forEach((p, bi) => {
      const g = grooves[bi];
      const k = p.sec.kind;
      const next = plan[bi + 1];
      if (k === 'outro' && p.inSec >= 6) {
        if (p.inSec === 6) p.bass.push({ beat: 0, dur: 11, midi: bassRoot(p.slots[0].chord, prevBass), vel: 0.64 });
        return;
      }
      if (k === 'break' && p.inSec < 2) return; // the breakdown opens without bass
      const long = k === 'break' || (k === 'outro' && p.inSec >= 4);
      if (long) {
        const c = p.slots[0].chord;
        const prevSame = bi > 0 && plan[bi - 1].sec === p.sec && plan[bi - 1].slots.length === 1 && plan[bi - 1].slots[0].chord.name === c.name && p.inSec % 2 === 1 && p.inSec > 2;
        if (prevSame && k === 'break') return; // tied from the previous bar
        const nextSame = next && next.sec === p.sec && p.slots.length === 1 && next.slots[0].chord.name === c.name;
        p.slots.forEach((s, j) => {
          const root = bassRoot(s.chord, prevBass);
          const dur = nextSame && k === 'break' ? 7.8 : s.dur - 0.15;
          p.bass.push({ beat: s.beat, dur, midi: root, vel: humVel(rng, k === 'break' ? 0.5 : 0.58, 0.03), glide: j === 0 && prevBass !== root && rng.chance(0.35) ? prevBass : undefined });
          prevBass = root;
        });
        if (k === 'break' && p.inSec === p.sec.bars - 1) {
          const nr = bassRoot(next.slots[0].chord, prevBass);
          p.bass.push({ beat: 3.5, dur: 0.4, midi: nr - 1, vel: 0.5 });
        }
        return;
      }
      if (g === 'none') return;
      const cut = fills[bi] === 'drop' ? 2 : 4;
      const onsets = new Set<number>(p.drums.filter((h) => h.k === 'kick' && h.vel >= 0.45).map((h) => h.step));
      if (k === 'B') for (const s of [...onsets]) if (s !== 10 && s !== 14) onsets.delete(s); // two-feel under the bridge
      for (const s of p.slots) onsets.add(s.beat * 4);
      const steps = [...onsets].filter((s) => s / 4 < cut).sort((a, b) => a - b);
      let pick = -1;
      if (cut >= 4 && next && rng.chance(0.4) && !steps.includes(14) && !steps.includes(15)) {
        pick = rng.pick([14, 15]);
        steps.push(pick);
      }
      steps.forEach((s, j) => {
        const beat = s / 4;
        const c = chordAt(bi, beat);
        const slotStart = p.slots.some((sl) => Math.abs(sl.beat - beat) < 1e-6);
        const root = bassRoot(c, prevBass);
        let m = root;
        if (s === pick) {
          const nr = bassRoot(next.slots[0].chord, root);
          m = rng.chance(0.55) ? nr + (rng.chance(0.6) ? -1 : 1) : stepInPool(nr, rng.chance(0.5) ? -1 : 1, scaleFor(next.slots[0].chord, 26, 50));
        } else if (!slotStart) {
          const r = rng.next();
          // the chord's own fifth: perfect, or the b5 of a half-diminished chord; 7alt has none (b13) -> the root
          const ts = c.tones.map((t) => t % 12);
          const f5 = ts.includes(7) ? 7 : ts.includes(6) ? 6 : 0;
          const fifth = f5 ? (root + f5 <= 47 ? root + f5 : root + f5 - 12) : root;
          m = r < 0.5 ? root : r < 0.72 ? fifth : r < 0.86 && root + 12 <= 50 ? root + 12 : c.tones.includes(10) && root + 10 <= 50 ? root + 10 : root;
        }
        const nextOn = j + 1 < steps.length ? steps[j + 1] / 4 : cut;
        // articulated, not legato: the root speaks for up to a dotted quarter, other hits are short and bouncy
        let dur = Math.max(0.3, Math.min(nextOn - beat - 0.12, slotStart ? 1.6 : 0.85));
        if (s % 2 === 1) dur = Math.min(dur, 0.4);
        if (k === 'B' && slotStart) dur = Math.max(dur, Math.min(nextOn - beat - 0.1, 2.6));
        const vel = humVel(rng, slotStart ? 0.7 : s === pick ? 0.5 : 0.6, 0.04);
        const glide = !slotStart && s !== pick && m !== prevBass && rng.chance(0.18) ? prevBass : undefined;
        p.bass.push({ beat, dur, midi: m, vel, glide });
        prevBass = m;
      });
    });

    // ---------------------------------------------------------------- Rhodes comping + pad bed
    /** rootless voicing pitch classes, as theory's voicing(): drop the root, then the 5th, then the top extension */
    const vPcs = (c: Chord, count: number): number[] => {
      let iv = [...c.tones];
      const n = Math.min(count, iv.length);
      if (iv.length > 3 && n < iv.length) iv = iv.filter((t) => t !== 0);
      while (iv.length > n && iv.includes(7)) iv = iv.filter((t) => t !== 7);
      while (iv.length > n && iv.includes(0)) iv = iv.filter((t) => t !== 0);
      while (iv.length > n) iv.pop();
      return iv.map((t) => (c.root + t) % 12);
    };
    /** close-position stackings of the pitch classes inside [lo, hi] (every inversion, every octave) */
    const stacks = (pcs: number[], lo: number, hi: number): number[][] => {
      const out: number[][] = [];
      const s = [...pcs].sort((a, b) => a - b);
      for (let r = 0; r < s.length; r++) {
        const order = [...s.slice(r), ...s.slice(0, r)];
        for (let base = lo; base <= hi; base++) {
          if (pc(base) !== order[0]) continue;
          const v = [base];
          for (let k = 1; k < order.length; k++) {
            let m = v[k - 1] + 1;
            while (pc(m) !== order[k]) m++;
            v.push(m);
          }
          if (v[v.length - 1] <= hi) out.push(v);
        }
      }
      return out;
    };
    /** lowest vibes / Rhodes-lead melody note of half a beat or more (no grace notes) sounding in global beats [g0, g1) */
    const melLow = (g0: number, g1: number): number => {
      let low = Infinity;
      const b1 = Math.min(total - 1, Math.floor((g1 - 1e-6) / 4));
      for (let b = Math.max(0, Math.floor(g0 / 4) - 1); b <= b1; b++) {
        for (const e of [...plan[b].vibes, ...plan[b].lead]) {
          const s0 = b * 4 + e.beat;
          if (e.dur >= 0.45 && s0 < g1 - 0.25 && s0 + e.dur > g0 + 0.25) low = Math.min(low, e.midi);
        }
      }
      return low;
    };
    /** Rhodes ceiling for a chord slot: a minor 3rd under the lowest melody note over it (slot 0 also covers a push) */
    const slotCeil = (bi: number, j: number): number => {
      const s = plan[bi].slots[j];
      return Math.min(71, melLow(bi * 4 + s.beat - (j === 0 ? 0.5 : 0), bi * 4 + s.beat + s.dur) - 3);
    };
    /**
     * Rhodes voicing, in priority tiers: 4 notes under the tune (ceil) with the bottom at G3 or above; then dipping
     * to D3; then 3-note shells; then a semitone or two of headroom (only under a very low melody note). Within a
     * tier: least movement from the previous chord, no minor 2nds below Bb3, centred around D4.
     */
    const compVoice = (prev: readonly number[] | null, c: Chord, ceil: number): number[] => {
      const ps = prev ? [...prev].sort((a, b) => a - b) : null;
      const score = (v: number[]) => {
        let s = 0;
        if (ps) for (let i = 0; i < v.length; i++) s += Math.abs(v[i] - ps[Math.min(i, ps.length - 1)]);
        s += Math.abs(v.reduce((a, b) => a + b, 0) / v.length - 62.5) * 0.15;
        s += Math.max(0, 55 - v[0]) * 1.2;
        for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] === 1 && v[i - 1] < 58) s += 4;
        return s;
      };
      const hi0 = Math.max(60, ceil);
      for (const [n, lo, up] of [[4, 55, 0], [4, 50, 0], [3, 55, 0], [3, 50, 0], [4, 50, 1], [4, 50, 2], [3, 50, 2]] as const) {
        const cands = stacks(vPcs(c, n), lo, hi0 + up);
        if (!cands.length) continue;
        let best = cands[0], bs = Infinity;
        for (const v of cands) {
          const s = score(v);
          if (s < bs) (bs = s), (best = v);
        }
        return best;
      }
      return voiceLead(prev, c, { lo: 55, hi: 71, count: 4, rootless: true });
    };
    let prevV: number[] | null = null;
    let pushed = false;
    plan.forEach((p, bi) => {
      const k = p.sec.kind;
      const i = p.inSec;
      const next = plan[bi + 1];
      if (k === 'outro' && i >= 6) {
        if (i === 6) {
          const c = p.slots[0].chord;
          p.comp.push({ beat: 0, dur: 7, notes: voicing(c, { lo: 50, hi: 76, count: 5, rootless: false }), vel: 0.42, roll: 0.055 });
          p.pads.push({ beat: 0, dur: 8, notes: voicing(c, { lo: 57, hi: 76, count: 4 }), vel: 0.3, roll: 0 });
        }
        return;
      }
      const whole = (k === 'intro' && i < p.sec.bars / 2) || k === 'B' || k === 'break' || (k === 'outro' && i >= 4);
      const busy = k === 'solo' || p.sec.name === 'theme II' || p.sec.name === 'theme out';
      // (a lighter left hand while the Rhodes itself has the tune)
      const baseVel = (k === 'break' ? 0.34 : k === 'B' ? 0.36 : 0.38) * (traded.has(bi) ? 0.92 : 1);
      const vs = p.slots.map((s, j) => (prevV = compVoice(prevV, s.chord, slotCeil(bi, j))));
      const skipFirst = pushed;
      pushed = false;
      if (p.slots.length > 1) {
        p.slots.forEach((s, j) => {
          if (j === 0 && skipFirst) return;
          const ant = j > 0 && !whole && rng.chance(0.3) ? 0.25 : 0;
          p.comp.push({ beat: s.beat - ant, dur: s.dur - 0.2 + ant, notes: vs[j], vel: humVel(rng, baseVel, 0.04), roll: 0.012 });
        });
      } else if (whole) {
        if (!skipFirst) p.comp.push({ beat: 0, dur: 3.9, notes: vs[0], vel: humVel(rng, baseVel, 0.03), roll: 0.028 });
      } else {
        const pat = rng.pick(busy ? COMP_BUSY : COMP_SPARSE);
        for (const [beat, dur, full] of pat) {
          if (beat === 0 && skipFirst) continue;
          if (dur === 0) {
            // push: the next bar's chord an 8th early, tied over the barline
            if (!next || next.sec !== p.sec || next.slots.length > 1) continue;
            const nv = compVoice(prevV, next.slots[0].chord, slotCeil(bi + 1, 0));
            p.comp.push({ beat, dur: 2.4, notes: nv, vel: humVel(rng, baseVel, 0.03), roll: 0.01 });
            pushed = true;
            continue;
          }
          const notes = full ? vs[0] : vs[0].slice(1);
          p.comp.push({ beat, dur, notes, vel: humVel(rng, full ? baseVel : baseVel - 0.04, 0.04), roll: full ? 0.014 : 0.008 });
        }
      }
      // pad bed: intro, bridge, breakdown, late solo, outro
      const padOn = k === 'intro' || k === 'B' || k === 'break' || (k === 'solo' && p.sec.bars - i <= 8 && i % 2 === 0) || (k === 'outro' && i >= 4);
      if (padOn) {
        const pv = (c: Chord) => voicing(c, { lo: 57, hi: 76, count: 4 });
        if (k === 'break' && i % 2 === 1 && i < 6) {
          /* held from the previous bar */
        } else if (k === 'break' && i < 6) p.pads.push({ beat: 0, dur: 8, notes: pv(p.slots[0].chord), vel: 0.32, roll: 0 });
        else if (k === 'solo') p.pads.push({ beat: 0, dur: 8, notes: pv(p.slots[0].chord), vel: 0.2, roll: 0 });
        else for (const s of p.slots) p.pads.push({ beat: s.beat, dur: s.dur + 0.2, notes: pv(s.chord), vel: k === 'intro' && i < p.sec.bars / 2 ? 0.32 : 0.26, roll: 0 });
      }
    });

    // ---------------------------------------------------------------- atmosphere, dynamics, mix automation
    const tonicBell = 69 + T;
    FORM.forEach((s, si) => {
      const b0 = secStart[si];
      if (s.kind === 'intro') {
        plan[b0].fx.push({ kind: 'bell', beat: 0, vel: 0.3, midi: tonicBell }, { kind: 'bell', beat: 1.6, vel: 0.2, midi: tonicBell });
        plan[b0].fx.push({ kind: 'wave', beat: 0, vel: 0.55, dur: 5.5, pan: -0.3, off: rng.next() });
        if (s.bars > 2) plan[b0 + 2].fx.push({ kind: 'wave', beat: 0.5, vel: 0.45, dur: 5, pan: 0.3, off: rng.next() });
        for (let i = 0; i < s.bars; i++) plan[b0 + i].mix.push(['epiano', { lowpass: 950 + (EP_OPEN - 950) * Math.min(1, i / (s.bars - 2)) }]);
      } else if (s.kind === 'break') {
        plan[b0].fx.push({ kind: 'bell', beat: 0, vel: 0.26, midi: tonicBell }, { kind: 'bell', beat: 1.6, vel: 0.17, midi: tonicBell });
        for (const [i, beat, pan] of [[0, 0, -0.3], [2, 1, 0.3], [4, 0.5, -0.1]] as const) plan[b0 + i].fx.push({ kind: 'wave', beat, vel: 0.5, dur: 5.5, pan, off: rng.next() });
        plan[b0].mix.push(['epiano', { lowpass: 1500 }], ['vibes', { tremoloRate: 3.4 }], ['hat', { lowpass: 6000 }]);
        plan[b0 + 6].mix.push(['epiano', { lowpass: 2000 }]);
        plan[b0 + 7].mix.push(['epiano', { lowpass: 3000 }], ['vibes', { tremoloRate: 4.6 }]);
      } else if (s.kind === 'outro') {
        for (let i = 3; i < 7; i++) plan[b0 + i].mix.push(['epiano', { lowpass: 3200 - (i - 3) * 500 }]);
        plan[b0 + 5].mix.push(['vibes', { tremoloRate: 3.6 }]);
        plan[b0 + 4].fx.push({ kind: 'wave', beat: 0, vel: 0.45, dur: 5.5, pan: 0.3, off: rng.next() });
        // the final low note fades on the bass channel instead of stopping dead
        for (let q = 1; q <= 24; q++) plan[b0 + 6].mix.push([`bass@${1.5 + q * 0.25}`, { level: BASS_LVL * Math.pow(0.85, q) }]);
        plan[b0 + 6].fx.push({ kind: 'bell', beat: 0.5, vel: 0.24, midi: tonicBell }, { kind: 'wave', beat: 0, vel: 0.5, dur: 6.5, pan: -0.3, off: rng.next() }, { kind: 'swell', beat: 0, vel: 0.2 });
      } else {
        plan[b0].mix.push(['epiano', { lowpass: EP_OPEN }], ['hat', { lowpass: 10000 }], ['vibes', { tremoloRate: 4.6 }]);
      }
    });
    const dynFor = (s: Sec, x: number): number => {
      switch (s.kind) {
        case 'intro': return 0.84 + 0.1 * x;
        case 'A': return s.name === 'theme' ? 0.93 : s.name === 'theme II' ? 0.97 : 0.98;
        case 'B': return 0.9;
        case 'break': return 0.84 + 0.08 * x;
        case 'solo': return 0.94 + 0.05 * Math.sin(Math.PI * x);
        case 'outro': return 0.97 - 0.12 * x;
      }
    };
    plan.forEach((p) => (p.dyn = dynFor(p.sec, p.inSec / p.sec.bars)));

    // ---------------------------------------------------------------- mix
    const setup = (t0: number, player: { endTime: number }) => {
      inst.mix('vibes', { level: 1.9, pan: 0.3, reverb: 0.4, delay: 0.1, tremolo: 0.42, tremoloRate: 4.6 });
      inst.mix('epiano', { level: 1.15, pan: -0.28, reverb: 0.28, delay: 0.03, tremolo: 0.25, lowpass: 950 });
      inst.mix('epiano:lead', { level: 1.3, pan: -0.12, reverb: 0.34, delay: 0.16, tremolo: 0.2, lowpass: 3800 });
      inst.mix('bass', { level: BASS_LVL, lowpass: 1200 });
      inst.mix('pad', { level: 0.42, lowpass: 1700, reverb: 0.5 });
      inst.mix('kick', { level: 0.4 });
      inst.mix('snare', { level: 0.62, pan: 0.06, lowpass: 9000, reverb: 0.16 });
      inst.mix('rim', { level: 0.85, pan: 0.18, reverb: 0.18 });
      inst.mix('hat', { level: 2.5, pan: 0.36, highpass: 4500, lowpass: 10000 });
      inst.mix('shaker', { level: 1.6, pan: -0.38 });
      inst.mix('ride', { level: 0.8, pan: -0.3, lowpass: 11000 });
      inst.mix('bell', { level: 0.55, pan: -0.25, reverb: 0.7, delay: 0.14, lowpass: 3600 });
      inst.mix('cymbal', { level: 0.6, lowpass: 9000 });
      inst.mix('sweep:wave', { level: 1, reverb: 0.45, delay: 0 });
      inst.setDelay({ beats: 0.75, feedback: 0.3, tone: 2400 });
      inst.vinyl(t0, player.endTime - 0.5, 0.6);
    };

    const tempo = (bar: number) => {
      const r = bar - (total - 3);
      return r < 0 ? bpm : bpm * [0.95, 0.88, 0.8][r];
    };

    return song(env, {
      bpm,
      tempo,
      swing,
      swingUnit: 16,
      sections: FORM.map((s) => ({ name: s.name, bars: s.bars })),
      tail: 5,
      setup,
      bar(b: BarInfo) {
        const p = plan[b.bar];
        const dyn = p.dyn;
        const at = (beat: number, ms = 6) => humanize(rng, b.at(beat), ms);
        const sec = (beats: number) => b.beatsToSec(beats);
        for (const [name, s] of p.mix) {
          const [ch, beat] = name.split('@');
          inst.mix(ch, s, beat ? b.at(+beat) : b.t);
        }
        // --- Rhodes comp (muted, filtered on the channel)
        for (const h of p.comp) {
          const t = at(h.beat, 6);
          h.notes.forEach((m, j) => inst.epiano(t + h.roll * j, m, sec(h.dur), h.vel * dyn * (j === h.notes.length - 1 ? 1.04 : 1), { bright: 0.26 }));
        }
        for (const h of p.pads) inst.pad(b.at(h.beat), h.notes, sec(h.dur), h.vel * dyn, { wave: 'tri', attack: 1.6, release: 2.4, cutoff: 1500 });
        // --- vibes (laid back a hair) + Rhodes answers
        for (const e of p.vibes) inst.vibes((e.st ? humanize(rng, b.at(e.beat, 0.5), 6) : at(e.beat, 7)) + 0.01, e.midi, sec(e.dur), e.vel * dyn, { pedal: e.pedal });
        for (const e of p.lead) inst.epiano(at(e.beat, 6) + 0.008, e.midi, sec(e.dur), e.vel * dyn, { ch: 'lead', bright: 0.45 });
        for (const e of p.answer) inst.epiano(at(e.beat, 7) + 0.006, e.midi, sec(e.dur), e.vel * dyn, { ch: 'lead', bright: 0.35 });
        // --- sub bass
        for (const e of p.bass) inst.bass(at(e.beat, 3), e.midi, sec(e.dur), e.vel * Math.sqrt(dyn), e.glide !== undefined ? { glideFrom: e.glide, glideTime: 0.07 } : {});
        // --- drums: snare / rim dragged behind the beat
        for (const d of p.drums) {
          const beat = d.step / 4;
          const v = d.vel * dyn;
          switch (d.k) {
            case 'kick': inst.kick(at(beat, 3), v, { tune: 54, decay: 0.32, click: 0.15 }); break;
            case 'snare': inst.snare(at(beat, 4) + (d.vel > 0.3 ? 0.016 : 0.008), v, { tone: 205, snappy: 0.6, decay: d.vel > 0.3 ? 0.17 : 0.1 }); break;
            case 'rim': inst.rim(at(beat, 4) + 0.012, v); break;
            // hats: the "&" off-beats sit a few ms late (lazy), the rest on the grid; a 70 ms "tss" rather than a
            // click - the energy of a longer decay without a higher transient
            case 'hat': inst.hat(at(beat, 5) + (d.step % 4 === 2 ? 0.005 : 0), humVel(rng, v, 0.03), { decay: 0.07 }); break;
            case 'ohat': inst.hat(at(beat, 5), v, { open: 0.16 }); break;
            case 'shaker': inst.shaker(at(beat, 6), v, { len: 0.1 }); break;
            case 'ride': inst.ride(at(beat, 4), v); break;
          }
        }
        // --- atmosphere
        for (const f of p.fx) {
          const t = b.at(f.beat);
          if (f.kind === 'bell') inst.bell(t, f.midi ?? tonicBell, 4, f.vel, { ring: 5 });
          else if (f.kind === 'wave') waveWash(env, t, f.dur ?? 5, f.vel, f.pan ?? 0, f.off ?? 0);
          else if (f.kind === 'swell') inst.cymbal(t, f.vel, { swell: Math.min(1.6, b.dur * 0.55) });
          else inst.cymbal(t, f.vel, { decay: 2.2 });
        }
      },
    });
  },
};
