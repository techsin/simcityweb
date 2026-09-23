/**
 * Live MusicDirector test (audio-lab.html?director=<seconds>): runs the real director on a real-time AudioContext
 * and reports what it did, so the playlist / crossfade / throttling logic can be verified headless.
 *
 *   ?director=70                 three short (~19 s) test songs: expect auto crossfades, no immediate repeats
 *   &real=1                      use ALL_TRACKS instead (long songs; use for smoke tests)
 *   &stall=30                    block the main thread for 3 s at t=30 (tab throttling / jank): no note burst after it
 *   &next=40 / &select=<id>@50   exercise next() / select() at those times
 *   &screen=city&night=1&pop=200000&activity=1   music context
 *
 * window.__result: { events: [{t, id}], levels: dB every 100 ms, gaps (runs < -50 dB inside the run), maxJumpDb,
 *                    nodesAfterStall, errors }. Loudness here is only a sanity check - use ?track= for real stats.
 */
import { MusicDirector, type MusicScreen } from '../music/director';
import { ALL_TRACKS } from '../music/tracks';
import { makeNoiseBuffer, makeReverb } from '../music/fx';
import { song } from '../music/song';
import { parseChart, voiceLead, bassNote } from '../music/theory';
import type { MusicEnv, MusicTrack, TrackTag } from '../music/types';

function testTrack(id: string, tags: TrackTag[], chart: string, bpm: number): MusicTrack {
  return {
    id,
    title: id,
    mood: 'director test',
    tags,
    bpm,
    create(env: MusicEnv) {
      const { inst } = env;
      const bars = parseChart(chart);
      let prev: number[] | null = null;
      const vs = bars.map((b) => (prev = voiceLead(prev, b[0], { lo: 55, hi: 74, count: 4 })));
      return song(env, {
        bpm,
        sections: [{ name: 'a', bars: 4 }, { name: 'b', bars: 4 }],
        tail: 3,
        bar(b) {
          const c = bars[b.bar % bars.length][0];
          inst.pad(b.at(0), vs[b.bar % bars.length], b.dur + 0.3, 0.6, { attack: 0.3, release: 1 });
          for (let q = 0; q < b.beats; q++) {
            inst.bass(b.at(q), bassNote(c, 36), b.beatsToSec(0.8), 0.7);
            inst.hat(b.at(q + 0.5), 0.4);
          }
        },
      });
    },
  };
}

const TEST_TRACKS: MusicTrack[] = [
  testTrack('test_a', ['menu', 'calm'], 'Cmaj7 | Am7 | Dm7 | G7', 120),
  testTrack('test_b', ['day', 'busy'], 'Fmaj7 | Em7 | Dm7 | Cmaj7', 120),
  testTrack('test_c', ['night', 'calm'], 'Am7 | Fmaj7 | G7 | Em7', 120),
];

export async function runDirectorTest(q: URLSearchParams, log: (s: string) => void): Promise<unknown> {
  const seconds = parseFloat(q.get('director') ?? '60') || 60;
  const ctx = new AudioContext({ latencyHint: 'playback' });
  await ctx.resume().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 300));
  if (ctx.state !== 'running') throw new Error(`AudioContext state ${ctx.state} (autoplay?)`);
  const rv = makeReverb(ctx);
  rv.output.connect(ctx.destination);
  const bus = ctx.createGain();
  bus.connect(ctx.destination);
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  bus.connect(an);
  rv.output.connect(an);
  const tracks = q.get('real') === '1' ? ALL_TRACKS : TEST_TRACKS;
  let saved: unknown = null;
  const d = new MusicDirector(tracks, { load: () => ({ shuffle: q.get('shuffle') !== '0', disabled: [] }), save: (p) => (saved = p) });
  d.setContext({ screen: (q.get('screen') as MusicScreen) ?? 'menu', night: q.get('night') === '1', population: parseFloat(q.get('pop') ?? '0'), activity: parseFloat(q.get('activity') ?? '0.5') });
  const errors: string[] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => (errors.push(a.map(String).join(' ')), origWarn(...a));
  d.attach(ctx, bus, rv.input, makeNoiseBuffer(ctx));
  const t0 = ctx.currentTime;
  const events: { t: number; id: string | null; elapsed?: number; duration?: number }[] = [];
  d.onChange(() => {
    const np = d.nowPlaying;
    events.push({ t: Math.round((ctx.currentTime - t0) * 100) / 100, id: np?.id ?? null, duration: np ? Math.round(np.duration) : undefined });
  });
  d.start();
  const stall = parseFloat(q.get('stall') ?? 'NaN');
  const nextAt = parseFloat(q.get('next') ?? 'NaN');
  const [selId, selAtS] = (q.get('select') ?? '').split('@');
  const selAt = parseFloat(selAtS ?? 'NaN');
  const done = { stall: false, next: false, select: false };
  const lv: number[] = [];
  const buf = new Float32Array(an.fftSize);
  let stallInfo: { before: number; after: number; late: number } | null = null;
  log(`director test: ${tracks.map((t) => t.id).join(', ')} for ${seconds}s`);
  while (ctx.currentTime - t0 < seconds) {
    await new Promise((r) => setTimeout(r, 100));
    const t = ctx.currentTime - t0;
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (const x of buf) s += x * x;
    lv.push(Math.round(10 * Math.log10(s / buf.length + 1e-12) * 10) / 10);
    if (!done.stall && t >= stall) {
      done.stall = true;
      const a = performance.now();
      while (performance.now() - a < 3000) {
        /* jank */
      }
      stallInfo = { before: Math.round(t * 10) / 10, after: Math.round((ctx.currentTime - t0) * 10) / 10, late: 0 };
    }
    if (!done.next && t >= nextAt) {
      done.next = true;
      d.next();
    }
    if (!done.select && selId && t >= selAt) {
      done.select = true;
      d.select(selId);
    }
  }
  d.stop(1);
  await new Promise((r) => setTimeout(r, 1500));
  console.warn = origWarn;
  // silence runs (< -50 dB) after the first second, excluding the final stop fade
  const gaps: { at: number; len: number }[] = [];
  let run = 0;
  for (let i = 10; i < lv.length; i++) {
    if (lv[i] < -50) run++;
    else {
      if (run >= 3) gaps.push({ at: Math.round((i - run) * 10) / 100, len: run / 10 });
      run = 0;
    }
  }
  let maxJump = 0;
  for (let i = 12; i < lv.length; i++) if (lv[i - 1] > -50 && lv[i] > -50) maxJump = Math.max(maxJump, Math.abs(lv[i] - lv[i - 1]));
  const ids = events.map((e) => e.id).filter(Boolean) as string[];
  let repeats = 0;
  for (let i = 1; i < ids.length; i++) if (ids[i] === ids[i - 1]) repeats++;
  return {
    mode: 'director',
    tracks: tracks.map((t) => t.id),
    seconds,
    events,
    immediateRepeats: repeats,
    gaps,
    maxStepDb: Math.round(maxJump * 10) / 10,
    stall: stallInfo,
    errors,
    savedPrefs: saved,
    levels: lv,
    ctxState: ctx.state,
    weights: tracks.map((t) => ({ id: t.id, w: Math.round(d.weight(t) * 100) / 100 })),
  };
}
