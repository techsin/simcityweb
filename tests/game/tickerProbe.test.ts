/**
 * FEEL-01's pacing probe, headless: a real city save runs in the real Simulation at 1x, 2x and ultra on a simulated
 * real-time clock (30 frames a second), and the real NewsTicker (tests/game/tickerLayout.ts's 1280x720 layout) shows
 * the city's own news. For every item: when it arrived and when it was fully visible (its start in view, then its end);
 * for 10 consecutive flavour headlines, POLISH_PLAN FEEL-01's acceptance: each fully visible within 15 s of arriving.
 * Skipped unless TICKER_SAVE names a .city.metropolis save:
 *
 *   TICKER_SAVE=…/id128_y10.city.metropolis npx vitest run --configLoader runner tests/game/tickerProbe.test.ts
 *
 * TICKER_ONLY=1x|2x|ultra runs one probe; TICKER_LIST=1 lists every item; TICKER_OUT=<file> appends the report there. At ultra the sim posts news faster than one item a few seconds can show, so
 * that probe reports only (the queue keeps the newest waiting; every item stays in the news feed).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { unpackFile } from '../../src/save/bundle';
import { deserializeCity } from '../../src/save/serialize';
import type { NewsItem } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems';
import { NewsTicker, isGazette, tickerClause } from '../../src/ui/Notifications';
import { FEl, installFakeDom } from './fakeDom';
import { tickerLayout, visibilityWatch } from './tickerLayout';

const SAVE = process.env.TICKER_SAVE ?? '';
const ONLY = process.env.TICKER_ONLY ?? '';
const FPS = 30;
/** TICKER_OUT=<file>: the report lines go there too (vitest keeps a passing test's console quiet) */
const OUT = process.env.TICKER_OUT ?? '';
const say = (line: string) => {
  console.log(line);
  if (OUT) appendFileSync(OUT, line + '\n');
};

installFakeDom();
beforeEach(() => vi.useFakeTimers({ toFake: ['performance'] }));
afterEach(() => vi.useRealTimers());

interface Probe {
  speed: string;
  seconds: number;
  items: number;
  /** seconds from arrival to fully visible, per item (Infinity: never, it gave way in the queue) */
  all: number[];
  headlines: number[];
  /** the longest run of consecutive headlines each fully visible within 15 s */
  headlineRun: number;
}

async function probe(label: string, speed: number, headlines: number, maxMinutes: number): Promise<Probe> {
  const st = deserializeCity((await unpackFile(new Uint8Array(readFileSync(SAVE)))) as Parameters<typeof deserializeCity>[0]);
  const sim = new Simulation(st, createSystems());
  sim.speed = speed;
  let seq = st.news.length;
  const arrived: { n: NewsItem; t: number }[] = [];
  const t0 = performance.now();
  sim.events.on('news', (n) => {
    seq++;
    arrived.push({ n, t: (performance.now() - t0) / 1000 });
  });
  const abort = new AbortController();
  const ctx = { host: { get newsSeq() { return seq; } }, get state() { return sim.state; }, signal: abort.signal, focusCell() {}, panels: { open() {} } } as unknown as GameContext;
  const ticker = new NewsTicker(ctx, new FEl('div') as unknown as HTMLElement);
  const layout = tickerLayout(ticker);
  // (as a new item: an item that gave way and came back in the idle rotation counts as gave way)
  const watch = visibilityWatch(ticker, layout, true);
  const dt = 1 / FPS;
  const frames = maxMinutes * 60 * FPS;
  let f = 0;
  for (; f < frames; f++) {
    vi.advanceTimersByTime(1000 / FPS);
    sim.update(dt);
    ticker.frame(dt);
    watch.frame((performance.now() - t0) / 1000);
    // enough headlines, and the last one had 20 s
    const hs = arrived.filter((a) => isGazette(a.n));
    if (hs.length >= headlines && (performance.now() - t0) / 1000 - hs[headlines - 1].t > 20) break;
  }
  abort.abort();
  const after = (a: { n: NewsItem; t: number }) => watch.at(a.n) - a.t;
  const hs = arrived.filter((a) => isGazette(a.n)).slice(0, headlines);
  let run = 0, best = 0;
  for (const a of hs) {
    run = after(a) <= 15 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const r: Probe = { speed: label, seconds: Math.round(f / FPS), items: arrived.length, all: arrived.map(after), headlines: hs.map(after), headlineRun: best };
  if (process.env.TICKER_LIST) for (const a of arrived) say(`[ticker probe]   +${a.t.toFixed(1)} s ${a.n.kind}${isGazette(a.n) ? ' (Gazette)' : ''} visible after ${after(a).toFixed(1)} s: ${tickerClause(a.n.text)}`);
  const fmt = (v: number[]) => v.map((x) => (x === Infinity ? '∞' : x.toFixed(1))).join(' ');
  const fin = r.all.filter((x) => x !== Infinity).sort((a, b) => a - b);
  // never shown: it gave way in the queue, or it arrived in the last 30 s and still waited when the probe ended
  const gave = arrived.filter((a) => watch.at(a.n) === Infinity && r.seconds - a.t > 30).length;
  say(`[ticker probe] ${label}: ${r.seconds} s, ${r.items} items (${gave} gave way, ${r.all.length - fin.length - gave} still waiting at the end), visible after: median ${fin[fin.length >> 1]?.toFixed(1)} s, p90 ${fin[Math.floor(fin.length * 0.9)]?.toFixed(1)} s, max ${fin[fin.length - 1]?.toFixed(1)} s`);
  say(`[ticker probe] ${label}: ${hs.length} headlines, visible after ${fmt(r.headlines)} s; longest run within 15 s: ${best}`);
  return r;
}

describe.skipIf(!SAVE)('FEEL-01 pacing probe on a real city (TICKER_SAVE)', () => {
  it.skipIf(ONLY && ONLY !== '1x')('1x: each of 10 consecutive flavour headlines is fully visible within 15 s of arriving', { timeout: 1_200_000 }, async () => {
    const r = await probe('1x', 1, 10, 20);
    expect(r.headlines).toHaveLength(10);
    for (const s of r.headlines) expect(s).toBeLessThanOrEqual(15);
  });
  it.skipIf(ONLY && ONLY !== '2x')('2x: each of 10 consecutive flavour headlines is fully visible within 15 s of arriving', { timeout: 1_200_000 }, async () => {
    const r = await probe('2x', 2, 10, 10);
    expect(r.headlines).toHaveLength(10);
    for (const s of r.headlines) expect(s).toBeLessThanOrEqual(15);
  });
  it.skipIf(ONLY && ONLY !== 'ultra')('ultra: reported (the news comes faster than the ticker can show it)', { timeout: 1_200_000 }, async () => {
    const r = await probe('ultra', 3, 10, 5);
    expect(r.items).toBeGreaterThan(0);
  });
});
