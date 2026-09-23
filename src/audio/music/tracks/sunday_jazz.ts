/**
 * "Sunday Jazz" - reference track #1 (port + upgrade of the original chill jazz-lite generator).
 *
 * Rhodes trio with brushes at a lazy ~80 bpm swing, AABA head on ii-V-I colours, Rhodes solo over two A's, vibes solo
 * over the bridge, head out and a three-times iii-VI-ii-V tag that slows into a rolled maj9 ending.
 * Every play re-rolls: key, tempo, swing, chord substitutions (tritone subs, secondary dominants), the head melody,
 * comping rhythms, the walking bass line and both solos. The plan (chords + all melodic lines) is computed up front
 * in create(); bar() only schedules what belongs to that bar.
 */
import type { RNG } from '../../../core/rng';
import type { MusicTrack } from '../types';
import { song, type BarInfo } from '../song';
import { parseChart, voiceLead, voicing, chordTones, scaleFor, walkingBass, humanize, humVel, snap, stepInPool, bassNote, pc, type Chord } from '../theory';

type Kind = 'intro' | 'A' | 'B' | 'soloA' | 'soloB' | 'tag';
interface Sec {
  name: string;
  bars: number;
  kind: Kind;
  /** how the last bars lead on: 'turn' (to A), 'bridge' (to B), 'tag', 'end' */
  lead: 'turn' | 'bridge' | 'tag' | 'end';
}

const FORM: Sec[] = [
  { name: 'intro', bars: 4, kind: 'intro', lead: 'turn' },
  { name: 'head A1', bars: 8, kind: 'A', lead: 'turn' },
  { name: 'head A2', bars: 8, kind: 'A', lead: 'bridge' },
  { name: 'bridge', bars: 8, kind: 'B', lead: 'turn' },
  { name: 'head A3', bars: 8, kind: 'A', lead: 'turn' },
  { name: 'rhodes solo', bars: 16, kind: 'soloA', lead: 'bridge' },
  { name: 'vibes solo', bars: 8, kind: 'soloB', lead: 'turn' },
  { name: 'head out', bars: 8, kind: 'A', lead: 'tag' },
  { name: 'tag + ending', bars: 6, kind: 'tag', lead: 'end' },
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
}
/** everything scheduled for one bar */
interface BarPlan {
  sec: Sec;
  slots: Slot[];
  comp: { beat: number; dur: number; notes: number[]; vel: number; roll?: number }[];
  bass: Ev[];
  lead: Ev[];
  vibes: Ev[];
}

// rhythm cells for the head: [beat, dur] in a 4/4 bar
const CELLS: [number, number][][] = [
  [[0, 1.5], [1.5, 1], [2.5, 1.5]],
  [[0.5, 0.5], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 1]],
  [[0, 1], [1, 0.5], [1.5, 0.5], [2, 2]],
  [[0.5, 1], [1.5, 0.5], [2, 0.5], [2.5, 1.5]],
  [[0, 0.5], [0.5, 0.5], [1, 1], [2.5, 0.5], [3, 1]],
  [[1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]],
];
const END_CELLS: [number, number][][] = [[[0, 3]], [[0, 1], [1, 2.5]], [[0.5, 0.5], [1, 3]], [[0, 1.5], [1.5, 2.5]]];
const BRIDGE_CELLS: [number, number][][] = [[[0, 2], [2, 2]], [[0, 3], [3, 1]], [[0.5, 1.5], [2, 2]], [[0, 1.5], [1.5, 0.5], [2, 2]]];

function aChart(rng: RNG, lead: Sec['lead'], subs: { two: string; four: string; seven: string; turn: string }): string {
  const b78 = lead === 'bridge' ? 'Cmaj9 | Gm9 C13' : lead === 'tag' ? 'Dm9 | G13' : `${subs.seven} | ${subs.turn}`;
  void rng;
  return `Cmaj9 | ${subs.two} | Dm9 | ${subs.four} | Em9 A7b9 | Dm9 G13 | ${b78}`;
}

function contour(rng: RNG, n: number, bias = 0): number[] {
  const out: number[] = [0];
  let dir = rng.chance(0.5 + bias * 0.3) ? 1 : -1;
  for (let i = 1; i < n; i++) {
    const r = rng.next();
    const size = r < 0.68 ? 1 : r < 0.9 ? 2 : rng.int(3, 4);
    out.push(dir * size);
    if (size > 1 || rng.chance(0.3)) dir = -dir;
  }
  return out;
}

export const track: MusicTrack = {
  id: 'sunday_jazz',
  title: 'Sunday Jazz',
  mood: 'Lazy Sunday Rhodes trio: brushes, upright bass, swing',
  tags: ['menu', 'region', 'day', 'calm'],
  bpm: 80,
  gain: 1.5,
  create(env) {
    const { inst, rng } = env;
    const bpm = rng.int(76, 84);
    inst.bpm = bpm;
    const swing = rng.range(0.6, 0.645);
    const key = rng.pick([5, 3, 10, 0, 7, 8, 2]); // F Eb Bb C G Ab D
    const T = ((key + 6) % 12) - 6;
    // ---------------------------------------------------------------- chord plan
    const subs = {
      two: rng.chance(0.3) ? 'A7b9' : 'Am9',
      four: rng.chance(0.35) ? 'Db9' : 'G13',
      seven: rng.chance(0.5) ? 'Cmaj9 Am9' : 'Em7 A7b9',
      turn: rng.pick(['Dm9 G13', 'Dm9 Db9', 'Dm9 G7alt']),
    };
    const bridge = `${rng.chance(0.25) ? 'Ebmaj9' : 'Fmaj9'} | Fm9 Bb13 | Em9 | A7alt | Dm9 | G13 | Em7 A7b9 | Dm9 G13`;
    const charts: Record<Kind, (s: Sec) => string> = {
      intro: () => 'Dm9 | G13 | Em9 A7b9 | Dm9 G13',
      A: (s) => aChart(rng, s.lead, subs),
      soloA: () => `${aChart(rng, 'turn', subs)} | ${aChart(rng, 'bridge', subs)}`,
      B: () => bridge,
      soloB: () => bridge,
      tag: () => 'Em7 A7b9 | Dm9 G13 | Em7 A7b9 | Dm9 Db9 | Cmaj9 | Cmaj9',
    };
    const plan: BarPlan[] = [];
    for (const s of FORM) {
      const bars = parseChart(charts[s.kind](s), T);
      for (let i = 0; i < s.bars; i++) {
        const cs = bars[i % bars.length];
        plan.push({ sec: s, slots: cs.map((c, k) => ({ beat: (k * 4) / cs.length, dur: 4 / cs.length, chord: c })), comp: [], bass: [], lead: [], vibes: [] });
      }
    }
    const total = plan.length;
    const chordAt = (bar: number, beat: number): Chord => {
      const p = plan[Math.min(total - 1, bar + Math.floor(beat / 4))];
      const bb = ((beat % 4) + 4) % 4;
      let c = p.slots[0].chord;
      for (const s of p.slots) if (bb >= s.beat - 1e-6) c = s.chord;
      return c;
    };
    const barStart: number[] = [];
    {
      let b = 0;
      for (const s of FORM) barStart.push(b), (b += s.bars);
    }

    // ---------------------------------------------------------------- comping (Rhodes left hand)
    let prevV: number[] | null = null;
    plan.forEach((p, bi) => {
      const k = p.sec.kind;
      const shells = k === 'soloA';
      const lo = shells ? 50 : 52, hi = shells ? 66 : 72;
      const vBase = k === 'intro' ? 0.42 : k === 'soloB' ? 0.42 : k === 'B' ? 0.4 : k === 'tag' ? 0.42 : 0.36;
      const inBar = bi - barStart[FORM.indexOf(p.sec)];
      p.slots.forEach((s, si) => {
        const v: number[] = voiceLead(prevV, s.chord, { lo, hi, count: shells ? 3 : 4, rootless: true });
        prevV = v;
        const two = p.slots.length > 1;
        if (k === 'intro' && inBar < 2) {
          p.comp.push({ beat: 0, dur: 4.2, notes: v, vel: vBase + 0.04, roll: 0.035 });
          return;
        }
        if (k === 'tag' && bi >= total - 2) return; // ending handled separately
        const r = rng.next();
        if (two) {
          // one hit per chord: on the beat, or pushed an 8th early
          const beat = si === 1 && r < 0.35 ? s.beat - 0.5 : s.beat + (r > 0.85 ? 0.5 : 0);
          p.comp.push({ beat, dur: s.dur - 0.3, notes: v, vel: humVel(rng, vBase, 0.05) });
        } else if (k === 'A' || k === 'tag' || k === 'intro') {
          if (r < 0.55) p.comp.push({ beat: 0, dur: 3.4, notes: v, vel: humVel(rng, vBase, 0.05) });
          else if (r < 0.85) {
            p.comp.push({ beat: 0, dur: 1.2, notes: v, vel: humVel(rng, vBase, 0.05) });
            p.comp.push({ beat: 1.5, dur: 2, notes: v, vel: humVel(rng, vBase - 0.05, 0.05) });
          } else p.comp.push({ beat: 0.5, dur: 3, notes: v, vel: humVel(rng, vBase, 0.05) });
        } else {
          // busier comping behind the solos / bridge
          const pats: [number, number][][] = [[[0, 1.2], [1.5, 1], [3, 0.8]], [[0.5, 1], [2.5, 1.2]], [[0, 1.3], [2.5, 1.2]], [[1.5, 1.2], [3, 0.8]], [[0, 2.2], [3.5, 0.4]]];
          for (const [b, d] of rng.pick(pats)) p.comp.push({ beat: b, dur: d, notes: v, vel: humVel(rng, vBase - (b % 1 ? 0.03 : 0), 0.06) });
        }
      });
    });

    // ---------------------------------------------------------------- bass
    let prevBass: number | null = null;
    plan.forEach((p, bi) => {
      const k = p.sec.kind;
      const inBar = bi - barStart[FORM.indexOf(p.sec)];
      if (k === 'intro' && inBar < 2) return;
      if (bi >= total - 2) return; // the ending plays its own bass note
      const twoFeel = k === 'intro' || p.sec.name === 'head A1' || (k === 'tag' && bi >= total - 4);
      p.slots.forEach((s, si) => {
        const nextChord = si + 1 < p.slots.length ? p.slots[si + 1].chord : bi + 1 < total ? plan[bi + 1].slots[0].chord : null;
        if (twoFeel) {
          const root = snap(prevBass ?? 38, [bassNote(s.chord, 31), bassNote(s.chord, 43)]);
          p.bass.push({ beat: s.beat, dur: Math.min(2, s.dur) * 0.95, midi: root, vel: humVel(rng, 0.72, 0.05) });
          if (s.dur >= 4) {
            const second = nextChord && rng.chance(0.5) ? snap(root, [bassNote(nextChord, 31) - 1, bassNote(nextChord, 31) + 1, bassNote(nextChord, 43) - 1]) : snap(root + (rng.chance(0.5) ? 7 : -5), chordTones(s.chord, 31, 52));
            if (rng.chance(0.28)) p.bass.push({ beat: 1.5, dur: 0.45, midi: root, vel: 0.38 }); // swung pickup
            p.bass.push({ beat: 2, dur: 1.9, midi: second, vel: humVel(rng, 0.64, 0.05) });
            prevBass = second;
          } else prevBass = root;
          return;
        }
        const line = walkingBass(rng, s.chord, nextChord, Math.round(s.dur), prevBass, 31, 55);
        line.forEach((m, j) => {
          p.bass.push({ beat: s.beat + j, dur: 0.92, midi: m, vel: humVel(rng, j === 0 ? 0.74 : 0.64, 0.05) });
          // occasional triplet skip / ghost note
          if (j === Math.round(s.dur) - 2 && rng.chance(0.12)) p.bass.push({ beat: s.beat + j + 0.667, dur: 0.3, midi: m + (rng.chance(0.5) ? 0 : -1), vel: 0.34 });
        });
        prevBass = line[line.length - 1];
      });
    });

    // ---------------------------------------------------------------- head melody (generated once, reused)
    const LO = 64, HI = 84;
    const fit = (m: number, c: Chord, strong: boolean, lo = LO, hi = HI): number => {
      if (!strong) return m;
      const ct = snap(m, chordTones(c, lo, hi));
      const avoid = c.quality.startsWith('maj') || c.quality === '69' ? pc(m - c.root) === 5 : false;
      return Math.abs(ct - m) <= 2 || avoid ? ct : m;
    };
    const cellA = rng.pick(CELLS), endA = rng.pick(END_CELLS), cellB = rng.pick(CELLS), cellC = rng.pick(CELLS), cellD = rng.pick(CELLS), endD = rng.pick(END_CELLS);
    const headRhythm: { bar: number; beat: number; dur: number }[] = [];
    const addCell = (bar: number, cell: [number, number][]) => cell.forEach(([beat, dur]) => headRhythm.push({ bar, beat, dur }));
    addCell(0, cellA), addCell(1, endA), addCell(2, cellA), addCell(3, endA), addCell(4, cellB), addCell(5, cellC), addCell(6, cellD), addCell(7, endD);
    const c1 = contour(rng, cellA.length + endA.length, 0.3);
    const headSteps = [...c1, ...c1.map((x, i) => (i === 0 ? 0 : x)), ...contour(rng, cellB.length + cellC.length, 0.5), ...contour(rng, cellD.length + endD.length, -0.6)];
    const headStart = [rng.int(69, 76)];
    const phrase2 = headRhythm.findIndex((x) => x.bar === 2);
    /** realize the head over the chords of the 8-bar section starting at global bar b0 */
    const realizeHead = (b0: number, variant: number): Ev[][] => {
      const out: Ev[][] = Array.from({ length: 8 }, () => []);
      let cur = headStart[0];
      headRhythm.forEach((n, i) => {
        const c = chordAt(b0 + n.bar, n.beat);
        const pool = scaleFor(c, LO, HI);
        if (i === 0) cur = snap(headStart[0], chordTones(c, LO, HI));
        else if (i === phrase2) cur = snap(headStart[0] + 2, chordTones(c, LO, HI)); // sequence the opening a step up
        else cur = stepInPool(cur, headSteps[i] ?? 0, pool);
        const strong = n.beat % 2 === 0 || n.dur >= 1.5;
        cur = fit(cur, c, strong);
        let beat = n.beat, dur = n.dur;
        let vel = 0.6 + (n.dur >= 1.5 ? 0.05 : 0) + (n.beat % 1 ? 0.03 : 0);
        if (variant > 0 && rng.chance(0.22) && beat % 1 === 0 && beat > 0) (beat -= 0.5), (dur += 0.5); // anticipation
        if (variant > 0 && dur >= 1.5 && rng.chance(0.3)) out[n.bar].push({ beat: beat - 0.14, dur: 0.14, midi: cur - 1, vel: vel - 0.18 }); // grace
        vel = humVel(rng, vel, 0.05);
        out[n.bar].push({ beat, dur: dur * 0.94, midi: cur, vel });
      });
      return out;
    };
    // bridge melody: long notes, rising then falling sequence
    const bridgeLine = (b0: number): Ev[][] => {
      const out: Ev[][] = Array.from({ length: 8 }, () => []);
      let cur = rng.int(67, 72);
      for (let bar = 0; bar < 8; bar++) {
        const cell = rng.pick(BRIDGE_CELLS);
        cell.forEach(([beat, dur], j) => {
          const c = chordAt(b0 + bar, beat);
          const dir = bar < 4 ? 1 : -1;
          cur = stepInPool(cur, j === 0 ? dir * rng.int(1, 2) : rng.pick([-1, 1, 2]), scaleFor(c, LO, HI));
          cur = fit(cur, c, true);
          out[bar].push({ beat, dur: dur * 0.95, midi: cur, vel: humVel(rng, 0.6, 0.05) });
        });
      }
      return out;
    };

    // ---------------------------------------------------------------- solos
    const soloLine = (b0: number, bars: number, lo: number, hi: number, dens: (x: number) => number, vib: boolean): Ev[][] => {
      const out: Ev[][] = Array.from({ length: bars }, () => []);
      let cur = rng.int(lo + 6, hi - 8);
      let dir = 1;
      let pos = rng.pick([0.5, 1, 1.5]);
      const end = bars * 4 - 1;
      while (pos < end) {
        const phraseLen = vib ? rng.int(3, 6) : rng.int(4, 11);
        const d = dens(pos / (bars * 4));
        let k = 0;
        while (k < phraseLen * 2 && pos < end) {
          const bar = Math.floor(pos / 4), beat = pos - bar * 4;
          const c = chordAt(b0 + bar, beat);
          const pool = scaleFor(c, lo, hi);
          if (!vib && rng.chance(0.07) && beat % 1 === 0) {
            // triplet arpeggio flourish
            const tones = chordTones(c, lo, hi);
            let m = snap(cur, tones);
            for (let q = 0; q < 3; q++) {
              out[bar].push({ beat: beat + q / 3, dur: 0.3, midi: m, vel: humVel(rng, 0.56, 0.05) });
              m = stepInPool(m, 1, tones);
            }
            cur = m;
            pos += 1;
            k += 2;
            continue;
          }
          if (rng.chance(d)) {
            const onBeat = beat % 1 === 0;
            const newChord = onBeat && p8(beat, c, b0 + bar);
            if (newChord && rng.chance(0.6)) {
              // land on a guide tone (3rd / 7th) of the new chord
              const guides = [3, 4, 10, 11].filter((iv) => c.tones.includes(iv)).map((iv) => pc(c.root + iv));
              const cand: number[] = [];
              for (let m = lo; m <= hi; m++) if (guides.includes(pc(m))) cand.push(m);
              if (cand.length) cur = snap(cur + dir, cand);
            } else {
              cur = stepInPool(cur, dir * (rng.chance(0.8) ? 1 : 2), pool);
              // chromatic passing tone on off-beats
              if (!onBeat && !vib && rng.chance(0.18)) cur += dir;
            }
            if (cur >= hi - 1) dir = -1;
            else if (cur <= lo + 1) dir = 1;
            else if (rng.chance(vib ? 0.35 : 0.2)) dir = -dir;
            const long = k >= phraseLen * 2 - 1;
            const dur = long ? rng.pick([1, 1.5]) : vib ? rng.pick([0.5, 1]) : 0.5;
            const vel = humVel(rng, (vib ? 0.58 : 0.54) + (onBeat ? 0 : 0.06), 0.06);
            out[bar].push({ beat, dur: dur * (vib ? 1.1 : 0.9), midi: cur, vel });
            if (dur > 0.5) {
              pos += dur;
              k += dur * 2;
              continue;
            }
          }
          pos += vib ? rng.pick([0.5, 1]) : 0.5;
          k++;
        }
        pos += rng.pick(vib ? [1, 1.5, 2, 2.5] : [1, 1.5, 2]); // breath
      }
      return out;
    };
    /** true when a new chord starts at this beat */
    function p8(beat: number, c: Chord, bar: number): boolean {
      const p = plan[Math.min(total - 1, bar)];
      return p.slots.some((s) => Math.abs(s.beat - beat) < 1e-6) && (beat > 0 || plan[Math.max(0, bar - 1)].slots.at(-1)!.chord !== c);
    }

    // place lines into the plan
    FORM.forEach((s, si) => {
      const b0 = barStart[si];
      let lines: Ev[][] | null = null, vibes: Ev[][] | null = null;
      if (s.kind === 'A') {
        const variant = s.name === 'head A1' ? 0 : 1;
        lines = realizeHead(b0, variant);
        if (s.name === 'head A3') vibes = lines.map((bar) => bar.filter((e) => e.dur > 0.2).map((e) => ({ ...e, midi: e.midi + 12, vel: e.vel * 0.55 })));
      } else if (s.kind === 'B') {
        lines = bridgeLine(b0);
        // vibes answers in the gaps (last beat of every other bar)
        vibes = Array.from({ length: 8 }, (_, bar) => {
          if (bar % 2 === 0) return [];
          const c = chordAt(b0 + bar, 3);
          const tones = chordTones(c, 72, 91);
          let m = snap(rng.int(76, 84), tones);
          return [0, 0.5, 1].map((dx) => {
            const e = { beat: 2.5 + dx, dur: 0.6, midi: m, vel: humVel(rng, 0.42, 0.05) };
            m = stepInPool(m, rng.chance(0.7) ? 1 : -1, tones);
            return e;
          });
        });
      } else if (s.kind === 'soloA') lines = soloLine(b0, s.bars, 60, 84, (x) => 0.45 + 0.4 * Math.sin(Math.PI * Math.min(1, x * 1.15)), false);
      else if (s.kind === 'soloB') vibes = soloLine(b0, s.bars, 65, 89, (x) => 0.55 + 0.25 * Math.sin(Math.PI * x), true);
      else if (s.kind === 'intro') {
        // pickup into the head on bar 4
        const c = chordAt(b0 + 3, 2);
        const tones = chordTones(c, LO, HI);
        let m = snap(headStart[0] - 5, tones);
        lines = [[], [], [], [2.5, 3, 3.5].map((beat) => {
          const e = { beat, dur: 0.45, midi: m, vel: humVel(rng, 0.52, 0.04) };
          m = stepInPool(m, 1, scaleFor(c, LO, HI));
          return e;
        })];
      }
      lines?.forEach((l, i) => plan[b0 + i].lead.push(...l));
      vibes?.forEach((l, i) => plan[b0 + i].vibes.push(...l));
    });

    // ---------------------------------------------------------------- ending
    const endBar = total - 2;
    const endChord = plan[endBar].slots[0].chord;
    const endVoicing = voicing(endChord, { lo: 52, hi: 81, count: 5, rootless: false });

    // ---------------------------------------------------------------- mix
    const setup = (t0: number) => {
      inst.mix('epiano', { level: 0.9, pan: -0.12, reverb: 0.25, delay: 0.05, tremolo: 0.35 });
      inst.mix('epiano:lead', { level: 1, pan: 0.12, reverb: 0.3, delay: 0.16 });
      inst.mix('upright', { level: 0.92 });
      inst.mix('vibes', { level: 0.9, pan: 0.3, reverb: 0.4 });
      inst.mix('pad', { level: 0.5, lowpass: 3500 });
      inst.mix('brush', { level: 0.9 });
      inst.mix('ride', { level: 0.75 });
      inst.mix('kick', { level: 0.8 });
      inst.setDelay({ beats: 0.75, feedback: 0.3, tone: 2800 });
      inst.vinyl(t0, t0 + 400, 0.35);
    };

    /** section dynamics (velocity factor): a gentle start, the Rhodes solo builds, the vibes solo relaxes, the tag winds down */
    const dynamics = (name: string, x: number): number => {
      switch (name) {
        case 'intro': return 0.92;
        case 'head A1': return 0.9;
        case 'head A2': return 0.95;
        case 'bridge': return 0.93;
        case 'rhodes solo': return 0.97 + 0.09 * Math.sin(Math.PI * Math.min(1, x * 1.2));
        case 'vibes solo': return 0.93;
        case 'head out': return 1.03;
        case 'tag + ending': return 1 - 0.15 * x;
        default: return 1;
      }
    };

    const tempo = (bar: number) => {
      const r = bar - (total - 4);
      return r < 0 ? bpm : bpm * [0.93, 0.86, 0.76, 0.7][r];
    };

    /** final bar: rolled maj9 on the Rhodes, bass root, vibes shimmer, soft pad, cymbal swell, a last high sigh */
    const ending = (b: BarInfo) => {
      const t = b.t;
      const sec = (beats: number) => b.beatsToSec(beats);
      endVoicing.forEach((m, j) => inst.epiano(t + 0.02 + j * 0.07, m, sec(7), 0.44 + j * 0.02));
      inst.upright(t, bassNote(endChord, 31), sec(7), 0.72);
      const top = chordTones(endChord, 76, 90);
      inst.vibes(t + sec(1.5), top[top.length - 1] ?? 84, sec(6), 0.36, { pedal: true });
      inst.vibes(t + sec(1.5) + 0.12, top[Math.max(0, top.length - 3)] ?? 79, sec(6), 0.3, { pedal: true });
      inst.pad(t, voicing(endChord, { lo: 55, hi: 76, count: 4 }), sec(8), 0.34, { attack: 1.2, release: 3, cutoff: 1500 });
      inst.cymbal(t, 0.22, { swell: 1.6 });
      inst.brushSwirl(t + sec(4), sec(3), 0.28);
      inst.epiano(t + sec(3), endVoicing[endVoicing.length - 1] + 2, sec(4), 0.28, { ch: 'lead' });
    };

    return song(env, {
      bpm,
      tempo,
      swing,
      sections: FORM.map((s) => ({ name: s.name, bars: s.bars })),
      tail: 5,
      setup,
      bar(b: BarInfo) {
        const p = plan[b.bar];
        const k = p.sec.kind;
        const dyn = dynamics(p.sec.name, b.sectionProgress);
        const at = (beat: number, ms = 7) => humanize(rng, b.at(beat), ms);
        const sec = (beats: number) => b.beatsToSec(beats);
        // --- Rhodes comping
        for (const c of p.comp) {
          const t = at(c.beat, 6);
          c.notes.forEach((m, j) => inst.epiano(t + (c.roll ?? 0.008) * j, m, sec(c.dur), c.vel * dyn * (j === c.notes.length - 1 ? 1.05 : 1)));
        }
        // --- melody (Rhodes lead laid back a hair) + vibes
        for (const e of p.lead) inst.epiano(at(e.beat, 8) + 0.012, e.midi, sec(e.dur), e.vel * dyn, { ch: 'lead', bright: 0.6 });
        for (const e of p.vibes) inst.vibes(at(e.beat, 8) + 0.01, e.midi, sec(e.dur), e.vel * dyn);
        // --- bass
        for (const e of p.bass) inst.upright(at(e.beat, 6), e.midi, sec(e.dur), e.vel * Math.sqrt(dyn));
        // --- pad bed (intro, bridge, tag)
        if ((k === 'intro' || k === 'tag' || (k === 'B' && b.barInSection % 2 === 0)) && b.bar < total - 2) {
          for (const s of p.slots) {
            const pv = voicing(s.chord, { lo: 55, hi: 76, count: 4 });
            inst.pad(b.at(s.beat), pv, sec(k === 'B' ? 8 : s.dur) + 0.3, k === 'B' ? 0.3 : 0.4, { attack: 1.4, release: 2, cutoff: 1800 });
          }
        }
        // --- drums: brush swirls throughout, taps on 2 & 4, ride + feathered kick as the tune builds
        const inIntro = k === 'intro';
        const soft = (inIntro ? 0.7 : k === 'tag' ? 0.85 : 1) * dyn;
        if (b.bar <= total - 2) for (let beat = 0; beat < 4; beat += 2) inst.brushSwirl(b.at(beat), sec(2) - 0.02, humVel(rng, 0.42 * soft, 0.04));
        if (b.bar >= total - 2) {
          if (b.bar === total - 2) ending(b);
          return;
        }
        if (!(inIntro && b.barInSection < 2)) {
          inst.brush(at(1, 5), humVel(rng, 0.5 * soft, 0.05));
          inst.brush(at(3, 5), humVel(rng, 0.52 * soft, 0.05));
          if (rng.chance(0.25)) inst.brush(at(2.5, 5), humVel(rng, 0.22, 0.04));
        }
        const rideOn = k === 'soloA' || k === 'soloB' || p.sec.name === 'head out' || p.sec.name === 'head A3';
        if (rideOn) {
          for (const [beat, v] of [[0, 0.4], [1, 0.46], [1.5, 0.28], [2, 0.4], [3, 0.46], [3.5, 0.28]] as const) inst.ride(at(beat, 4), humVel(rng, v * soft, 0.04));
          inst.hat(at(1, 3), 0.2, { decay: 0.05 });
          inst.hat(at(3, 3), 0.2, { decay: 0.05 });
        }
        if (!inIntro && p.sec.name !== 'head A1') for (const beat of [0, 2]) inst.kick(at(beat, 4), humVel(rng, 0.3, 0.04), { click: 0, tune: 50, decay: 0.32 });
        // brush fill at the end of a section
        if (b.last && !inIntro && rng.chance(0.6)) for (let q = 0; q < 3; q++) inst.snare(at(3 + q / 3, 3), 0.16 + q * 0.07, { snappy: 0.5, tone: 200 });
      },
    });
  },
};
