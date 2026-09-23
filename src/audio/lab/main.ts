/**
 * AUDIO LAB (audio-lab.html) - offline renders + measurements, so agents can verify audio without ears.
 *
 *   ?track=<id>[&seed=S][&seconds=N][&from=T]   render a song (default: the whole song + tail) through the game's
 *                                                 instrument library, track trim and reverb (44.1 kHz stereo)
 *   ?sfx=<name>[,<name>...]|all                  render UI / game one-shots (one slot each) with per-sound stats
 *   ?inst=<name>|all                             instrument demo phrases (vel 0.7 then 0.35) with per-instrument stats
 *   ?director=<seconds>[&real=1&stall=T&next=T&select=id@T]   live MusicDirector test (see directorTest.ts)
 *   no params                                    index of everything available
 *
 * Results: window.__result (JSON), console line "LAB_RESULT {...}", canvas #lab (spectrogram 20 Hz-16 kHz,
 * loudness curves, onset density + node rate, section markers), window.__ready = true when done.
 * window.__wavInfo / __wavChunk(i) expose a 16-bit WAV (tools/render-audio.mjs wav=1).
 */
import { ALL_TRACKS } from '../music/tracks';
import { instantiateTrack } from '../music/director';
import { makeNoiseBuffer, makeReverb } from '../music/fx';
import { Instruments, type InstrumentName } from '../music/synth';
import { playVoice, SOUND_META, SOUND_NAMES, type SfxEnv, type SoundName } from '../sfx';
import { levels, loudness, onsets, spectrum, round, type SpectrumStats, type LoudnessResult } from './analysis';
import { runDirectorTest } from './directorTest';

declare global {
  interface Window {
    __ready?: boolean;
    __result?: unknown;
    __error?: string;
    __wavInfo?: { bytes: number; chunks: number; chunkBytes: number };
    __wavChunk?: (i: number) => string;
  }
}

const SR = 44100;
const q = new URLSearchParams(location.search);
const app = document.getElementById('app')!;

interface Marker {
  t: number;
  name: string;
}
interface Segment {
  name: string;
  t0: number;
  t1: number;
}

function log(msg: string): void {
  const p = document.createElement('div');
  p.textContent = msg;
  app.appendChild(p);
}

// ------------------------------------------------------------------ instrument demos
type Demo = (i: Instruments, t: number, v: number) => void;
const mel = [60, 64, 67, 71, 72, 71, 67, 64];
const phrase = (fn: (t: number, m: number, d: number, v: number) => void, t: number, v: number, notes = mel, step = 0.25, dur = 0.22) => notes.forEach((m, k) => fn(t + k * step, m, dur, v));
const chordV = [55, 60, 64, 67, 71];
const DEMOS: Record<string, Demo> = {
  epiano: (i, t, v) => (phrase((a, b, c, d) => i.epiano(a, b, c, d), t, v), i.epiano(t + 2.1, 48, 1.2, v), chordV.forEach((m) => i.epiano(t + 2.1, m, 1.2, v))),
  piano: (i, t, v) => (phrase((a, b, c, d) => i.piano(a, b, c, d), t, v), [36, ...chordV].forEach((m) => i.piano(t + 2.1, m, 1.2, v))),
  guitar: (i, t, v) => (phrase((a, b, c, d) => i.guitar(a, b, c, d), t, v, mel.map((m) => m - 12)), [40, 47, 52, 55, 59, 64].forEach((m, k) => i.guitar(t + 2.1 + k * 0.03, m, 1.3, v))),
  harp: (i, t, v) => phrase((a, b, c, d) => i.harp(a, b, c, d), t, v, [48, 55, 60, 64, 67, 72, 76, 79, 84, 79, 76, 72], 0.2, 1),
  clav: (i, t, v) => phrase((a, b, c, d) => i.clav(a, b, c, d), t, v, [52, 52, 55, 57, 52, 60, 59, 55, 52, 52, 55, 57, 52, 60, 59, 55], 0.14, 0.09),
  pad: (i, t, v) => i.pad(t, chordV, 2.6, v),
  strings: (i, t, v) => (i.strings(t, [55, 62, 67, 71], 1.4, v), i.strings(t + 1.5, [57, 64, 69, 72], 1.2, v)),
  pizz: (i, t, v) => phrase((a, b, c, d) => i.pizz(a, b, c, d), t, v, [48, 55, 60, 64, 67, 64, 60, 55], 0.28, 0.2),
  organ: (i, t, v) => (i.organ(t, [60, 64, 67, 71], 1.3, v), i.organ(t + 1.5, [62, 65, 69, 72], 1.2, v, { drawbars: 'gospel' })),
  bass: (i, t, v) => phrase((a, b, c, d) => i.bass(a, b, c, d), t, v, [36, 36, 43, 36, 41, 41, 43, 38], 0.35, 0.3),
  upright: (i, t, v) => phrase((a, b, c, d) => i.upright(a, b, c, d), t, v, [36, 40, 43, 45, 46, 45, 43, 40], 0.4, 0.36),
  slap: (i, t, v) => phrase((a, b, c, d) => i.slap(a, b, c, d), t, v, [28, 40, 28, 38, 40, 28, 43, 40], 0.2, 0.15),
  synthBass: (i, t, v) => phrase((a, b, c, d) => i.synthBass(a, b, c, d), t, v, [33, 33, 45, 33, 36, 38, 40, 43], 0.25, 0.2),
  marimba: (i, t, v) => phrase((a, b, c, d) => i.marimba(a, b, c, d), t, v, [...mel, 76, 79], 0.2, 0.5),
  vibes: (i, t, v) => (phrase((a, b, c, d) => i.vibes(a, b, c, d), t, v, mel, 0.25, 0.6), [64, 67, 71, 74].forEach((m) => i.vibes(t + 2.1, m, 1.3, v))),
  bell: (i, t, v) => [72, 79, 76, 84].forEach((m, k) => i.bell(t + k * 0.6, m, 2, v)),
  glass: (i, t, v) => [76, 83, 79, 88, 86].forEach((m, k) => i.glass(t + k * 0.45, m, 1.5, v)),
  flute: (i, t, v) => [72, 74, 76, 79, 76].forEach((m, k) => i.flute(t + k * 0.55, m, k === 4 ? 1.2 : 0.5, v)),
  whistle: (i, t, v) => [79, 81, 84, 86, 84].forEach((m, k) => i.whistle(t + k * 0.55, m, k === 4 ? 1.2 : 0.5, v)),
  lead: (i, t, v) => [69, 72, 76, 74, 72].forEach((m, k) => i.lead(t + k * 0.5, m, k === 4 ? 1.2 : 0.45, v, { glideFrom: k ? [69, 72, 76, 74][k - 1] : undefined, vibrato: 12 })),
  arp: (i, t, v) => phrase((a, b, c, d) => i.arp(a, b, c, d), t, v, [57, 60, 64, 69, 72, 69, 64, 60, 57, 60, 64, 69, 72, 69, 64, 60], 0.15, 0.12),
  brass: (i, t, v) => (i.brass(t, [60, 64, 67, 70], 0.25, v), i.brass(t + 0.5, [60, 64, 67, 70], 0.25, v), i.brass(t + 1.2, [62, 65, 69, 72], 1.2, v)),
  kick: (i, t, v) => [0, 0.5, 1, 1.5, 2, 2.5].forEach((d) => i.kick(t + d, v)),
  snare: (i, t, v) => [0, 0.5, 1, 1.25, 1.5, 2, 2.2, 2.4].forEach((d, k) => i.snare(t + d, k % 3 === 2 ? v * 0.35 : v)),
  rim: (i, t, v) => [0, 0.375, 0.75, 1.25, 1.5, 2, 2.375].forEach((d) => i.rim(t + d, v)),
  clap: (i, t, v) => [0, 0.75, 1.5, 2.25].forEach((d) => i.clap(t + d, v)),
  hat: (i, t, v) => ([0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 2.2] as number[]).forEach((d, k) => i.hat(t + d, k % 2 ? v * 0.6 : v, { open: k === 7 ? 0.35 : k === 9 ? 0.6 : undefined })),
  shaker: (i, t, v) => { for (let k = 0; k < 16; k++) i.shaker(t + k * 0.15, k % 2 ? v * 0.6 : v); },
  brush: (i, t, v) => { i.brushSwirl(t, 1.4, v); i.brushSwirl(t + 1.45, 1.4, v); [0.5, 1.2, 1.9, 2.6].forEach((d) => i.brush(t + d, v)); },
  tom: (i, t, v) => (['high', 'high', 'mid', 'mid', 'low', 'low'] as const).forEach((p, k) => i.tom(t + k * 0.25, v, { pitch: p })),
  triangle: (i, t, v) => (i.triangle(t, v, { open: false }), i.triangle(t + 0.3, v, { open: false }), i.triangle(t + 0.6, v)),
  ride: (i, t, v) => [0, 0.5, 0.75, 1, 1.5, 1.75, 2].forEach((d) => i.ride(t + d, v)),
  cymbal: (i, t, v) => (i.cymbal(t + 1.2, v, { swell: 1.2 }), i.cymbal(t + 1.3, v, { decay: 1.6 })),
  conga: (i, t, v) => (['hi', 'mute', 'hi', 'lo', 'slap', 'hi', 'lo', 'lo'] as const).forEach((tone, k) => i.conga(t + k * 0.25, v, { tone })),
  sweep: (i, t, v) => (i.sweep(t, 1.4, v, { up: true }), i.sweep(t + 1.5, 1.2, v, { up: false })),
  vinyl: (i, t, v) => i.vinyl(t, t + 2.8, v),
};

// ------------------------------------------------------------------ render helpers
function offline(seconds: number): { ctx: OfflineAudioContext; reverbIn: AudioNode; noise: AudioBuffer } {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * SR), sampleRate: SR });
  // noreverb=1: replace the convolver with a plain gain (profiling only)
  if (q.get('noreverb') === '1') {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(ctx.destination);
    return { ctx, reverbIn: g, noise: makeNoiseBuffer(ctx) };
  }
  const rv = makeReverb(ctx);
  rv.output.connect(ctx.destination);
  return { ctx, reverbIn: rv.input, noise: makeNoiseBuffer(ctx) };
}

function segStats(L: Float32Array, R: Float32Array, seg: Segment) {
  const a = Math.floor(seg.t0 * SR), b = Math.min(L.length, Math.floor(seg.t1 * SR));
  const lv = levels(L, R, SR, a, b);
  const ld = loudness(L, R, SR, a, b);
  // audible duration: until the last 50 ms window above -60 dBFS
  return { name: seg.name, peakDb: lv.peakDb, rmsDb: lv.rmsDb, lufs: round(ld.integrated, 1), momentaryMax: round(ld.momentaryMax, 1), audibleSec: round((b - a) / SR - lv.trailingSilenceSec - lv.leadingSilenceSec), startSilenceSec: lv.leadingSilenceSec, clipped: lv.clipped };
}

/** render with start / end markers so tools/render-audio.mjs can measure the CPU time of the render */
async function timed(ctx: OfflineAudioContext): Promise<AudioBuffer> {
  console.log('LAB_RENDER_START');
  await new Promise((r) => setTimeout(r, 30));
  const buf = await ctx.startRendering();
  console.log('LAB_RENDER_END');
  await new Promise((r) => setTimeout(r, 30));
  return buf;
}

// ------------------------------------------------------------------ modes
async function renderTrack(id: string) {
  const track = ALL_TRACKS.find((t) => t.id === id);
  if (!track) throw new Error(`unknown track "${id}" (have: ${ALL_TRACKS.map((t) => t.id).join(', ')})`);
  const seed = parseInt(q.get('seed') ?? '1', 10) | 0;
  const from = Math.max(0, parseFloat(q.get('from') ?? '0') || 0);
  const secondsQ = q.get('seconds');
  const T0 = 0.05;
  // probe: the song length is only known after start()
  const probe = offline(0.01);
  const pr = instantiateTrack(track, probe.ctx, probe.ctx.destination, probe.reverbIn, probe.noise, seed, { live: false });
  pr.player.start(T0);
  const songEnd = pr.player.endTime;
  if (!isFinite(songEnd)) throw new Error('player.endTime is not finite after start()');
  const to = secondsQ ? from + parseFloat(secondsQ) : songEnd + 0.5;
  const { ctx, reverbIn, noise } = offline(to);
  const ti = instantiateTrack(track, ctx, ctx.destination, reverbIn, noise, seed, { live: false, skipBefore: from > 0 ? from - 0.5 : undefined, stats: true });
  // mute=ride,brush / solo=epiano,upright : drop notes of instruments (by method name) for A/B checks
  for (const n of (q.get('mute') ?? '').split(',').filter(Boolean)) ti.inst.mute.add(n);
  for (const n of (q.get('solo') ?? '').split(',').filter(Boolean)) ti.inst.solo.add(n);
  // schedule like the live director: every 0.5 s of render time, schedule 1.5 s ahead (OfflineAudioContext.suspend).
  // Scheduling everything up front would leave thousands of not-yet-started nodes in the graph, which Chrome pulls
  // every render quantum (quadratic cost) - that is not how the game plays music.
  let schedMs = 0;
  const sched = (t: number) => {
    const a = performance.now();
    ti.player.scheduleUntil(t);
    schedMs += performance.now() - a;
  };
  ti.player.start(T0);
  sched(Math.max(from, 0) + 1.5);
  for (let t = Math.max(0.5, Math.floor(from * 2) / 2); t < to - 0.01; t += 0.5) {
    const at = t;
    void ctx.suspend(at).then(() => {
      sched(at + 1.5);
      void ctx.resume();
    });
  }
  const tB = performance.now();
  const buf = await timed(ctx);
  const renderMs = performance.now() - tB;
  const sections: Marker[] = (ti.player.sections ?? []).map((s) => ({ t: s.t, name: s.name }));
  const st = ti.inst.stats;
  const s0 = Math.floor(from), s1 = Math.ceil(Math.min(to, songEnd));
  let nodes = 0, notes = 0, maxNodes = 0;
  for (let s = s0; s < s1; s++) {
    nodes += st.perSec[s] ?? 0;
    notes += st.notesPerSec[s] ?? 0;
    maxNodes = Math.max(maxNodes, st.perSec[s] ?? 0);
  }
  const secs = Math.max(1, s1 - s0);
  return {
    buf,
    from,
    to,
    markers: sections,
    title: `${track.title} (${track.id})  seed ${seed}  ${track.bpm} bpm  gain ${track.gain ?? 1}`,
    extra: {
      mode: 'track',
      id: track.id,
      title: track.title,
      seed,
      bpm: track.bpm,
      gain: track.gain ?? 1,
      songDurationSec: round(songEnd - T0, 1),
      window: [round(from, 2), round(to, 2)],
      sections: sections.map((s) => ({ name: s.name, t: round(s.t - T0, 2) })),
      notesTotal: st.notes,
      nodesTotal: st.nodes,
      notesPerSec: round(notes / secs, 1),
      nodesPerSec: round(nodes / secs, 1),
      nodesPerSecMax: maxNodes,
      scheduleMs: Math.round(schedMs),
      renderMs: Math.round(renderMs),
      nodeCurve: Array.from({ length: secs }, (_, k) => st.perSec[s0 + k] ?? 0),
    },
  };
}

/** profiling baseline: an empty offline context (plus the reverb unless noreverb=1) */
async function renderIdle(seconds: number) {
  const { ctx } = offline(seconds);
  const buf = await timed(ctx);
  return { buf, from: 0, to: buf.duration, markers: [] as Marker[], title: `idle ${seconds}s`, extra: { mode: 'idle' } };
}

async function renderSfx(which: string) {
  // sfx=all | sfx=name | sfx=a,b,c ; each sound gets a slot of its length + 1.2 s (reverb tail), at least 1.5 s
  const names: SoundName[] = which === 'all' ? [...SOUND_NAMES] : (which.split(',') as SoundName[]);
  if (!names.every((n) => SOUND_NAMES.includes(n))) throw new Error(`unknown sfx "${which}" (have: ${SOUND_NAMES.join(', ')})`);
  const slot = (n: SoundName) => Math.max(1.5, (SOUND_META[n]?.dur ?? 1.5) + 1.2);
  const segs: Segment[] = [];
  let at = 0.2;
  for (const n of names) {
    segs.push({ name: n, t0: at, t1: at + slot(n) });
    at += slot(n);
  }
  const { ctx, reverbIn, noise } = offline(at + 0.5);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const env: SfxEnv = { ctx: ctx as unknown as AudioContext, out, wet: reverbIn, noise };
  segs.forEach((s) => {
    void ctx.suspend(s.t0).then(() => {
      playVoice(env, s.name as SoundName, out, { exact: true });
      void ctx.resume();
    });
  });
  const tB = performance.now();
  const buf = await timed(ctx);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  return {
    buf,
    from: 0,
    to: buf.duration,
    markers: segs.map((s) => ({ t: s.t0, name: s.name })),
    title: `SFX: ${which}`,
    extra: { mode: 'sfx', renderMs: Math.round(performance.now() - tB), sounds: segs.map((s) => segStats(L, R, s)) },
    table: segs.map((s) => segStats(L, R, s)),
  };
}

async function renderInst(which: string) {
  const names = which === 'all' ? Object.keys(DEMOS) : which.split(',');
  for (const n of names) if (!DEMOS[n]) throw new Error(`unknown instrument "${n}" (have: ${Object.keys(DEMOS).join(', ')})`);
  const slot = 3.4;
  const segs: Segment[] = [];
  names.forEach((n, k) => {
    segs.push({ name: `${n}`, t0: 0.1 + k * slot * 2, t1: 0.1 + k * slot * 2 + slot });
    segs.push({ name: `${n}~`, t0: 0.1 + k * slot * 2 + slot, t1: 0.1 + (k + 1) * slot * 2 });
  });
  const { ctx, reverbIn, noise } = offline(names.length * slot * 2 + 1);
  const bus = ctx.createGain();
  bus.connect(ctx.destination);
  const inst = new Instruments(ctx, bus, reverbIn, noise, { bpm: 100, live: false, seed: 1, stats: true });
  const perInst: Record<string, { notes: number; nodes: number }> = {};
  names.forEach((n, k) => {
    const n0 = inst.stats.notes, d0 = inst.stats.nodes;
    DEMOS[n](inst, 0.1 + k * slot * 2, 0.7);
    DEMOS[n](inst, 0.1 + k * slot * 2 + slot, 0.35);
    perInst[n] = { notes: inst.stats.notes - n0, nodes: inst.stats.nodes - d0 };
  });
  const buf = await timed(ctx);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const table = segs.map((s) => segStats(L, R, s));
  return {
    buf,
    from: 0,
    to: buf.duration,
    markers: segs.map((s) => ({ t: s.t0, name: s.name })),
    title: `Instruments: ${which} (vel 0.7, then 0.35 marked ~)`,
    extra: {
      mode: 'inst',
      instruments: names.map((n) => {
        const hi = table.find((r) => r.name === n)!, lo = table.find((r) => r.name === `${n}~`)!;
        const pi = perInst[n];
        return { name: n as InstrumentName, lufs07: hi.lufs, peak07: hi.peakDb, lufs035: lo.lufs, peak035: lo.peakDb, nodesPerNote: round(pi.nodes / Math.max(1, pi.notes), 1) };
      }),
    },
    table,
  };
}

// ------------------------------------------------------------------ drawing
const W = 1600;
function colormap(v: number): [number, number, number] {
  // inferno-like, v 0..1
  const stops: [number, number, number, number][] = [
    [0, 0, 0, 4], [0.15, 31, 12, 72], [0.35, 120, 28, 109], [0.55, 188, 55, 84], [0.72, 237, 105, 37], [0.87, 251, 180, 26], [1, 252, 255, 164],
  ];
  v = Math.max(0, Math.min(1, v));
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, r0, g0, b0] = stops[i - 1], [b, r1, g1, b1] = stops[i];
      const f = (v - a) / (b - a);
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
    }
  }
  return [252, 255, 164];
}

function draw(o: { title: string; from: number; to: number; markers: Marker[]; sp: SpectrumStats; ld: LoudnessResult; peaks: number[]; onsetDensity: number[]; nodeCurve?: number[]; lines: string[]; table?: ReturnType<typeof segStats>[] }): HTMLCanvasElement {
  const specH = 460, loudH = 200, stripH = 70, head = 56;
  const tableRows = o.table ? Math.ceil(o.table.length / 4) : 0;
  const footH = 22 + o.lines.length * 17 + tableRows * 16 + 10;
  const H = head + specH + 12 + loudH + 10 + stripH + footH;
  const cv = document.createElement('canvas');
  cv.id = 'lab';
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0b0d12';
  g.fillRect(0, 0, W, H);
  g.font = '15px monospace';
  g.fillStyle = '#e8ecf4';
  g.fillText(o.title, 10, 22);
  g.font = '12px monospace';
  g.fillStyle = '#9aa6bb';
  g.fillText(o.lines[0] ?? '', 10, 42);
  const dur = o.to - o.from;
  const xOf = (t: number) => ((t - o.from) / dur) * W;
  // spectrogram
  const y0 = head;
  const img = g.createImageData(o.sp.cols, o.sp.rows);
  for (let c = 0; c < o.sp.cols; c++) {
    for (let r = 0; r < o.sp.rows; r++) {
      const v = o.sp.spec[c * o.sp.rows + r];
      const [R, G, B] = colormap((v + 110) / 95);
      const idx = ((o.sp.rows - 1 - r) * o.sp.cols + c) * 4;
      img.data[idx] = R;
      img.data[idx + 1] = G;
      img.data[idx + 2] = B;
      img.data[idx + 3] = 255;
    }
  }
  g.putImageData(img, 0, y0);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.font = '11px monospace';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const y = y0 + specH - (Math.log(f / o.sp.fMin) / Math.log(o.sp.fMax / o.sp.fMin)) * specH;
    g.fillRect(0, y, 8, 1);
    g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, 10, y + 4);
  }
  // loudness panel
  const y1 = y0 + specH + 12;
  g.fillStyle = '#12151d';
  g.fillRect(0, y1, W, loudH);
  const yDb = (d: number) => y1 + ((0 - Math.max(-60, Math.min(0, d))) / 60) * loudH;
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let d = -60; d <= 0; d += 6) {
    g.beginPath();
    g.moveTo(0, yDb(d));
    g.lineTo(W, yDb(d));
    g.stroke();
  }
  g.fillStyle = '#6b778c';
  for (const d of [0, -12, -18, -24, -36, -48]) g.fillText(`${d}`, W - 30, yDb(d) + 4);
  // peaks
  g.fillStyle = 'rgba(255,80,80,0.55)';
  o.peaks.forEach((p, i) => {
    const x = (i / o.peaks.length) * W;
    g.fillRect(x, yDb(p), Math.max(1, W / o.peaks.length), 2);
  });
  const curve = (arr: number[], color: string, width: number) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    let pen = false;
    arr.forEach((v, i) => {
      const x = (i / arr.length) * W;
      if (!isFinite(v) || v < -60) return void (pen = false);
      if (!pen) g.moveTo(x, yDb(v));
      else g.lineTo(x, yDb(v));
      pen = true;
    });
    g.stroke();
    g.lineWidth = 1;
  };
  curve(o.ld.momentary, 'rgba(120,160,255,0.35)', 1);
  curve(o.ld.shortTerm, '#5fd3ff', 2);
  g.setLineDash([6, 5]);
  g.strokeStyle = '#4cd964';
  g.beginPath();
  g.moveTo(0, yDb(-18));
  g.lineTo(W, yDb(-18));
  g.stroke();
  if (isFinite(o.ld.integrated)) {
    g.strokeStyle = '#ffd24c';
    g.beginPath();
    g.moveTo(0, yDb(o.ld.integrated));
    g.lineTo(W, yDb(o.ld.integrated));
    g.stroke();
  }
  g.setLineDash([]);
  g.fillStyle = '#9aa6bb';
  g.fillText('short-term LUFS (cyan)  momentary (blue)  peak dBFS (red)  target -18 (green)  integrated (yellow)', 8, y1 + 14);
  // strip: onsets + nodes
  const y2 = y1 + loudH + 10;
  g.fillStyle = '#12151d';
  g.fillRect(0, y2, W, stripH);
  const maxOn = Math.max(4, ...o.onsetDensity);
  g.fillStyle = 'rgba(255,165,60,0.8)';
  o.onsetDensity.forEach((n, i) => {
    const x = (i / o.onsetDensity.length) * W, h = (n / maxOn) * (stripH - 14);
    g.fillRect(x, y2 + stripH - h, Math.max(1, W / o.onsetDensity.length - 1), h);
  });
  if (o.nodeCurve?.length) {
    const mx = Math.max(60, ...o.nodeCurve);
    g.strokeStyle = '#e05cff';
    g.beginPath();
    o.nodeCurve.forEach((n, i) => {
      const x = ((i + 0.5) / o.nodeCurve!.length) * W, y = y2 + stripH - (n / mx) * (stripH - 14);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.stroke();
    g.fillStyle = '#9aa6bb';
    g.fillText(`onsets/s (orange, max ${maxOn})  nodes/s (magenta, max ${Math.max(...o.nodeCurve)}, scale ${mx})`, 8, y2 + 12);
  } else {
    g.fillStyle = '#9aa6bb';
    g.fillText(`onsets/s (orange, max ${maxOn})`, 8, y2 + 12);
  }
  // time ticks + markers
  const tick = dur > 180 ? 30 : dur > 60 ? 10 : dur > 20 ? 5 : 1;
  g.fillStyle = 'rgba(255,255,255,0.5)';
  for (let t = Math.ceil(o.from / tick) * tick; t <= o.to; t += tick) {
    const x = xOf(t);
    g.fillRect(x, y2 + stripH - 4, 1, 4);
    g.fillText(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, x + 2, y2 + stripH + 12);
  }
  g.font = '12px monospace';
  o.markers.forEach((m, k) => {
    if (m.t < o.from - 0.01 || m.t > o.to) return;
    const x = xOf(m.t);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(x, y0, 1, y2 + stripH - y0);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    const tw = g.measureText(m.name).width;
    const ly = y0 + 14 + (k % 3) * 15;
    g.fillRect(x + 1, ly - 11, tw + 6, 14);
    g.fillStyle = '#ffffff';
    g.fillText(m.name, x + 4, ly);
  });
  // footer
  let y = y2 + stripH + 30;
  g.font = '12px monospace';
  g.fillStyle = '#d5dbe6';
  for (const l of o.lines.slice(1)) {
    g.fillText(l, 10, y);
    y += 17;
  }
  if (o.table) {
    const colW = W / 4;
    o.table.forEach((r, i) => {
      const cx = (i % 4) * colW + 10, cy = y + Math.floor(i / 4) * 16;
      const bad = r.clipped > 0 || r.peakDb > -1;
      g.fillStyle = bad ? '#ff6b6b' : '#c8d0dd';
      g.fillText(`${r.name.padEnd(11)} pk ${String(r.peakDb).padStart(6)} M ${String(r.momentaryMax).padStart(6)} I ${String(r.lufs).padStart(6)} ${r.audibleSec}s`, cx, cy);
    });
  }
  return cv;
}

// ------------------------------------------------------------------ WAV
function exposeWav(buf: AudioBuffer, a: number, b: number): void {
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const n = b - a;
  const bytes = 44 + n * 4;
  const ab = new ArrayBuffer(bytes);
  const dv = new DataView(ab);
  const str = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, SR, true);
  dv.setUint32(28, SR * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    dv.setInt16(44 + i * 4, Math.max(-32768, Math.min(32767, Math.round(L[a + i] * 32767))), true);
    dv.setInt16(46 + i * 4, Math.max(-32768, Math.min(32767, Math.round(R[a + i] * 32767))), true);
  }
  const chunkBytes = 6 * 1024 * 1024;
  window.__wavInfo = { bytes, chunks: Math.ceil(bytes / chunkBytes), chunkBytes };
  window.__wavChunk = (i: number) => {
    const u = new Uint8Array(ab, i * chunkBytes, Math.min(chunkBytes, bytes - i * chunkBytes));
    let s = '';
    for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode(...u.subarray(k, k + 0x8000));
    return btoa(s);
  };
}

// ------------------------------------------------------------------ main
async function main() {
  const track = q.get('track'), sfx = q.get('sfx'), instQ = q.get('inst'), idle = q.get('idle');
  if (q.get('director')) {
    const res = (await runDirectorTest(q, log)) as { levels: number[]; events: { t: number; id: string | null }[]; seconds: number };
    const cv = document.createElement('canvas');
    cv.id = 'lab';
    cv.width = W;
    cv.height = 260;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#0b0d12';
    g.fillRect(0, 0, W, 260);
    const yDb = (v: number) => 20 + ((0 - Math.max(-70, Math.min(0, v))) / 70) * 220;
    g.strokeStyle = '#5fd3ff';
    g.beginPath();
    res.levels.forEach((v, i) => (i ? g.lineTo((i / res.levels.length) * W, yDb(v)) : g.moveTo(0, yDb(v))));
    g.stroke();
    g.font = '12px monospace';
    for (const e of res.events) {
      const x = (e.t / res.seconds) * W;
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillRect(x, 20, 1, 220);
      g.fillStyle = '#fff';
      g.fillText(e.id ?? '(none)', x + 3, 34);
    }
    g.fillStyle = '#9aa6bb';
    g.fillText('director test: RMS dB every 100 ms (cyan), nowPlaying changes (white)', 8, 14);
    app.replaceChildren(cv);
    const { levels: _l, ...rest } = res as Record<string, unknown>;
    void _l;
    const pre = document.createElement('pre');
    pre.style.cssText = 'color:#cfd6e2;font:12px monospace;white-space:pre-wrap';
    pre.textContent = JSON.stringify(rest, null, 1);
    app.append(pre);
    window.__result = res;
    console.log('LAB_RESULT ' + JSON.stringify(rest));
    window.__ready = true;
    return;
  }
  if (!track && !sfx && !instQ && !idle) {
    const add = (label: string, href: string) => {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      a.style.marginRight = '14px';
      app.appendChild(a);
    };
    log('Tracks:');
    ALL_TRACKS.forEach((t) => add(t.id, `?track=${t.id}`));
    log('SFX:');
    add('all', '?sfx=all');
    SOUND_NAMES.forEach((s) => add(s, `?sfx=${s}`));
    log('Instruments:');
    add('all', '?inst=all');
    Object.keys(DEMOS).forEach((s) => add(s, `?inst=${s}`));
    window.__result = { tracks: ALL_TRACKS.map((t) => t.id), sfx: SOUND_NAMES, instruments: Object.keys(DEMOS) };
    window.__ready = true;
    return;
  }
  log('rendering...');
  const r = track ? await renderTrack(track) : sfx ? await renderSfx(sfx) : idle ? await renderIdle(parseFloat(idle)) : await renderInst(instQ!);
  const tA = performance.now();
  const buf = r.buf;
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const a = Math.floor(r.from * SR), b = Math.min(L.length, Math.floor(r.to * SR));
  const lv = levels(L, R, SR, a, b);
  const ld = loudness(L, R, SR, a, b);
  const sp = spectrum(L, R, SR, a, b, W, 460);
  const on = onsets(L, R, SR, a, b);
  const secs = Math.max(1, Math.ceil((b - a) / SR));
  const onsetDensity = new Array(secs).fill(0);
  for (const t of on) onsetDensity[Math.min(secs - 1, Math.floor(t))]++;
  // peak per column
  const peaks: number[] = [];
  const colLen = (b - a) / W;
  for (let c = 0; c < W; c++) {
    let p = 0;
    for (let i = a + Math.floor(c * colLen), e = a + Math.floor((c + 1) * colLen); i < e; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
    peaks.push(p > 0 ? 20 * Math.log10(p) : -120);
  }
  const shortTerm5s = ld.shortTerm.filter((_, i) => i % 50 === 49).map((v) => round(v, 1));
  const result = {
    ...r.extra,
    sampleRate: SR,
    analyzedSec: round((b - a) / SR, 2),
    lufsIntegrated: round(ld.integrated, 2),
    lufsShortTermMax: round(ld.shortTermMax, 1),
    lufsMomentaryMax: round(ld.momentaryMax, 1),
    loudnessRangeLU: round(ld.lra, 1),
    ...lv,
    centroidHz: sp.centroidHz,
    bands: sp.bands,
    onsetsPerSec: round(on.length / Math.max(1, (b - a) / SR), 2),
    analysisMs: Math.round(performance.now() - tA),
    shortTermEvery5s: shortTerm5s,
    onsetDensity,
  };
  const ex = r.extra as Record<string, unknown>;
  const lines = [
    `I ${result.lufsIntegrated} LUFS  (target -18)  | peak ${lv.peakDb} dBFS  true-peak ${lv.truePeakDb}  rms ${lv.rmsDb}  crest ${lv.crestDb} dB  LRA ${result.loudnessRangeLU} LU  | clipped ${lv.clipped}`,
    `short-term max ${result.lufsShortTermMax}  momentary max ${result.lufsMomentaryMax}  | DC ${lv.dcOffset.join(', ')}  corr ${lv.stereoCorrelation}  | longest silence ${lv.longestSilenceSec}s @${lv.longestSilenceAt}s`,
    `centroid ${sp.centroidHz} Hz  bands low ${sp.bands.low} mid ${sp.bands.mid} high ${sp.bands.high}  | onsets ${result.onsetsPerSec}/s`,
  ];
  if (ex.mode === 'track') lines.push(`song ${ex.songDurationSec}s  window ${JSON.stringify(ex.window)}  notes ${ex.notesPerSec}/s  nodes ${ex.nodesPerSec}/s (max ${ex.nodesPerSecMax})  schedule ${ex.scheduleMs} ms  render ${ex.renderMs} ms`);
  if (ex.mode === 'inst')
    for (const i of ex.instruments as { name: string; lufs07: number; peak07: number; lufs035: number; nodesPerNote: number }[]) void i;
  const cv = draw({ title: r.title, from: r.from, to: r.to, markers: r.markers, sp, ld, peaks, onsetDensity, nodeCurve: ex.mode === 'track' ? (ex.nodeCurve as number[]) : undefined, lines, table: 'table' in r ? (r.table as ReturnType<typeof segStats>[]) : undefined });
  app.replaceChildren(cv);
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#cfd6e2;font:12px monospace;white-space:pre-wrap';
  const { onsetDensity: _o, ...rest } = result as Record<string, unknown>;
  void _o;
  delete (rest as Record<string, unknown>).nodeCurve;
  pre.textContent = JSON.stringify(rest, null, 1);
  const play = document.createElement('button');
  play.textContent = 'Play render';
  play.onclick = () => {
    const ac = new AudioContext();
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    src.start(0, r.from);
  };
  app.append(play, pre);
  exposeWav(buf, a, b);
  window.__result = result;
  console.log('LAB_RESULT ' + JSON.stringify(rest));
  window.__ready = true;
}

main().catch((e) => {
  console.error('[lab] failed', e);
  window.__error = String((e as Error)?.stack ?? e);
  log(`ERROR: ${window.__error}`);
  window.__ready = true;
});
