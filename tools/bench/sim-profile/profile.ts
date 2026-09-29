// @ts-nocheck — dev tool, bundled with rolldown (not type-checked by design; keeps `tsc --noEmit` independent of it)
/**
 * Headless sim profiler for big-city fixtures (read-only use of src/**).
 *
 *   node tools/bench/sim-profile/bundle.mjs profile   (-> node_modules/.cache/sim-profile/profile.js + .map)
 *   node node_modules/.cache/sim-profile/profile.js --fixture F.metropolis [--mode headless|frames] [--days 60] [--warm 20]
 *        [--fps 60] [--speed 3] [--renderMs 6] [--cpuprof out.cpuprofile] [--interval 100] [--heapprof out.heapprofile]
 *        [--out result.json] [--testdefs] [--gcmarks] [--startDay N] [--flush] [--mode cycles --reps 5]
 * --flush (headless): scheduler.flush() after every day = every due infra pass completes on time (design cadence).
 * --mode cycles: back-to-back full passes of each time-sliced task (traffic cycle, utilities, pollution, services, crime,
 *   emergency response), interleaved, --reps rounds after one warm-up round.
 *
 * mode headless: sim.advanceDay() x days (InfraScheduler headless: ~INFRA_DAY_BUDGET estimated ms of infra steps / day).
 * mode frames:   emulates CityScene's rAF loop on an IDLE machine: a virtual clock replaces performance.now()
 *                (virtual now = frame start + main-thread CPU time used in the frame), so the scheduler's real-time
 *                budgets (INFRA_FRAME_BUDGET_MS per frame, TRAFFIC_MIN_CYCLE_MS) see CPU time, not the time this
 *                process spends descheduled on the loaded box. Frame k+1 starts at max(start_k + 1000/fps,
 *                start_k + simCpu_k + renderMs); sim.update(dt) gets dt = min(0.1, start_{k+1} - start_k) like
 *                CityScene. --days = simulated days to run (at speed 3 = ultra, 0.05 s per day).
 * All costs are main-thread CPU time (process.threadCpuUsage; unbiased but ~0.1-1 ms granular per reading) plus
 * wall-clock (inflated by machine load; reported for reference).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { PerformanceObserver } from 'node:perf_hooks';
import { Session } from 'node:inspector/promises';
import { deserializeCity } from '../../../src/save/serialize';
import { unpackFile } from '../../../src/save/bundle';
import { Simulation, type SimSystem } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { schedulerOf } from '../../../src/sim/infra/scheduler';
import { registerTestDefs } from '../../../tests/infra/cityGen';
import { Network } from '../../../src/core/types';

// ------------------------------------------------------------------------------------------------ args / clocks
const argv = process.argv.slice(2);
const arg = (k: string, d?: string): string | undefined => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '1') : d; };
const FIXTURE = arg('fixture')!;
const MODE = arg('mode', 'headless')!;
const DAYS = +arg('days', '60')!;
const WARM = +arg('warm', '20')!;
const FPS = +arg('fps', '60')!;
const SPEED = +arg('speed', '3')!;
const RENDER_MS = +arg('renderMs', '6')!;
const OUT = arg('out');
const CPUPROF = arg('cpuprof');
const HEAPPROF = arg('heapprof');
const INTERVAL = +arg('interval', '100')!;
const GCMARKS = !!arg('gcmarks');
const START_DAY = arg('startDay') ? +arg('startDay')! : -1;
const REPS = +arg('reps', '5')!;
const FLUSH = !!arg('flush');

const realNow = performance.now.bind(performance);
const cpu = (): number => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000; };

// virtual clock for frames mode
let vFrameStart = 0, vCpuAtFrameStart = 0, useVirtual = false;
if (MODE === 'frames') {
  (performance as unknown as { now: () => number }).now = () => (useVirtual ? vFrameStart + (cpu() - vCpuAtFrameStart) : realNow());
}

// ------------------------------------------------------------------------------------------------ load
if (arg('testdefs')) registerTestDefs();
const bytes = new Uint8Array(readFileSync(FIXTURE));
const c0 = cpu(), w0 = realNow();
const state = deserializeCity(await unpackFile(bytes));
const loadCpu = cpu() - c0;
if (START_DAY >= 0) state.day = START_DAY;
const c1 = cpu(), w1 = realNow();
const sim = new Simulation(state, createSystems());
const initCpu = cpu() - c1, initWall = realNow() - w1;
const st = sim.state;
const sch = schedulerOf(sim);

function cityInfo() {
  let roads = 0, pop = 0, jobs = 0, cap = 0, growables = 0;
  for (let i = 0; i < st.cells; i++) if (st.network[i] >= Network.Street && st.network[i] <= Network.Highway) roads++;
  for (const b of st.buildings.values()) { pop += b.pop; jobs += b.jobs; cap += b.capacity; if (!(b.flags & 256)) growables++; }
  const s = st.stats;
  return {
    day: st.day, population: s.population, sumPop: pop, jobsFilled: jobs, buildings: st.buildings.size, growables, roadCells: roads,
    unemployment: +s.unemployment.toFixed(4), commute: +s.avgCommute.toFixed(2), demand: s.demand.map((v: number) => +v.toFixed(2)),
    power: [Math.round(s.powerSupply), Math.round(s.powerDemand)], water: [Math.round(s.waterSupply), Math.round(s.waterDemand)],
    eq: Math.round(s.eq), approval: Math.round(s.approval), funds: Math.round(st.funds),
  };
}
const info0 = cityInfo();
console.log(`[profile] ${FIXTURE}: load ${loadCpu.toFixed(0)} ms cpu, init ${initCpu.toFixed(0)} ms cpu (${initWall.toFixed(0)} wall) :: ${JSON.stringify(info0)}`);

// ------------------------------------------------------------------------------------------------ instrumentation
interface Acc { n: number; cpu: number; wall: number; max: number; vals?: number[] }
const newAcc = (keep = false): Acc => ({ n: 0, cpu: 0, wall: 0, max: 0, vals: keep ? [] : undefined });
const add = (a: Acc, c: number, w: number) => { a.n++; a.cpu += c; a.wall += w; if (c > a.max) a.max = c; a.vals?.push(c); };
let measuring = false;
const hr = (): number => Number(process.hrtime.bigint()) / 1000;
const regLabels: string[] = [];
const regLabelId = new Map<string, number>();
const regions: number[] = []; // flat: start_us, end_us, cpu_ms, labelId
const regId = (l: string) => { let i = regLabelId.get(l); if (i === undefined) { i = regLabels.length; regLabels.push(l); regLabelId.set(l, i); } return i; };
const sysAcc = new Map<string, Acc>();
const taskAcc = new Map<string, Acc>();
const stepAcc = new Map<string, Acc>();
const evCount = new Map<string, number>();
const evWall = new Map<string, number>();
let schedCpuInSystems = 0; // scheduler step CPU nested inside system hooks (to compute exclusive system time)
let depth = 0;

const hooks = ['daily', 'monthly', 'yearly', 'frame'] as const;
for (const s of sim.systems as SimSystem[]) {
  for (const k of hooks) {
    const fn = s[k] as ((...a: unknown[]) => void) | undefined;
    if (!fn) continue;
    (s as unknown as Record<string, unknown>)[k] = function (this: unknown, ...a: unknown[]) {
      if (!measuring) return fn.apply(s, a);
      const sc0 = schedCpuInSystems;
      const h0 = hr();
      const ca = cpu(), wa = realNow();
      depth++;
      fn.apply(s, a);
      depth--;
      const c = cpu() - ca, w = realNow() - wa;
      const key = `${s.name}.${k}`;
      regions.push(h0, hr(), c, regId(key));
      let acc = sysAcc.get(key);
      if (!acc) sysAcc.set(key, (acc = newAcc(true)));
      // exclusive: minus scheduler steps that ran inside this hook
      const inner = schedCpuInSystems - sc0;
      add(acc, c - inner, w);
    };
  }
}

const sysByName = (n: string) => sim.getSystem(n) as unknown as Record<string, unknown> | undefined;
const TR_PH = ['prep', 'prepTransit', 'transit', 'roundSearch', 'roundMatch', 'commute', 'inbound', 'shop', 'freight', 'final', 'final2'];
const UT_PH = ['uses', 'label', 'power', 'brownout', 'water', 'waterBrownout'];
const PO_PH = ['garbSrc', 'garbRoute', 'garbApply', 'srcBld', 'srcCells', 'airNear', 'airFar', 'noise', 'water', 'flags'];
const SV_PH = ['prep', 'tiers', 'stops', 'nimby', 'accSeed', 'accSearch', 'accLand', 'shopA', 'shopB', 'foot', 'finish'];
function subLabel(task: string): string {
  if (task === 'traffic') { const t = sysByName('traffic')!; const ph = t.phase as number; return ph < 0 ? 'prep' : ph === 0 && t.graphDirty ? 'rebuild' : TR_PH[ph] ?? String(ph); }
  if (task === 'utilities') { const i = sysByName('utilities')!.stepIdx as number; return UT_PH[i < 0 ? 0 : i] ?? String(i); }
  if (task === 'pollution') { const i = sysByName('pollution')!.stepIdx as number; return PO_PH[i < 0 ? 0 : i] ?? String(i); }
  if (task === 'services') { const i = sysByName('services')!.stepIdx as number; return SV_PH[i < 0 ? 0 : i] ?? String(i); }
  if (task === 'crime') { const i = sysByName('crime')!.stepIdx as number; return ['sources', 'spread', 'flags'][i < 0 ? 0 : i] ?? String(i); }
  if (task === 'emergency.response') { const i = sysByName('emergency')!.respStep as number; return 'resp' + (i < 0 ? 0 : i); }
  return '-';
}
const traffic = sysByName('traffic')!;
let trafficCycles0 = 0;
const stepLog: { f: number; d: number; t: string; s: string; c: number; e: number }[] = [];
let frameIdx = -1;
for (const t of sch.tasks) {
  const step = t.step.bind(t);
  const cost = t.cost.bind(t);
  t.step = (s2) => {
    if (!measuring) return step(s2);
    const label = subLabel(t.name);
    const est = cost(s2);
    const h0 = hr();
    const ca = cpu(), wa = realNow();
    step(s2);
    const c = cpu() - ca, w = realNow() - wa;
    regions.push(h0, hr(), c, regId(`task:${t.name}:${label}`));
    if (depth > 0) schedCpuInSystems += c;
    let a = taskAcc.get(t.name);
    if (!a) taskAcc.set(t.name, (a = newAcc(true)));
    add(a, c, w);
    const k = `${t.name}:${label}`;
    let b = stepAcc.get(k);
    if (!b) stepAcc.set(k, (b = newAcc(true)));
    add(b, c, w);
    stepLog.push({ f: frameIdx, d: st.day, t: t.name, s: label, c: +c.toFixed(3), e: +est.toFixed(2) });
  };
}
const emit = sim.events.emit.bind(sim.events);
(sim.events as unknown as { emit: typeof emit }).emit = (type, payload) => {
  if (!measuring) return emit(type, payload);
  evCount.set(type as string, (evCount.get(type as string) ?? 0) + 1);
  const wa = realNow();
  emit(type, payload);
  evWall.set(type as string, (evWall.get(type as string) ?? 0) + realNow() - wa);
};

// GC observer (main-thread pauses)
const gcKinds: Record<number, string> = { 1: 'minor', 2: 'major', 4: 'incremental', 8: 'weakcb' };
const gcAll: { t: number; d: number; kind: string }[] = [];
const obs = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) gcAll.push({ t: e.startTime, d: e.duration, kind: gcKinds[(e as unknown as { detail?: { kind?: number } }).detail?.kind ?? 0] ?? 'other' });
});
obs.observe({ entryTypes: ['gc'] });

// ------------------------------------------------------------------------------------------------ run
const daysMs: number[] = [];
const frames: { c: number; days: number; steps: number; dayCpu: number; mon: number; yr: number }[] = [];
function runHeadless(n: number, record: boolean): void {
  for (let d = 0; d < n; d++) {
    const ca = cpu();
    sim.advanceDay();
    // --flush: finish every due infra task the same day (design cadence, no time-slicing budget)
    if (FLUSH) { depth++; sch.flush(sim); depth--; }
    if (record) daysMs.push(cpu() - ca);
    if (GCMARKS && record) console.log(`DAYMARK ${st.day}`);
  }
}
let vClock = 0;
let dayCpuAcc = 0;
function runFrames(nDays: number, record: boolean): void {
  sim.speed = SPEED;
  const frameMs = 1000 / FPS;
  const dayTarget = st.day + nDays;
  let dt = 1 / FPS;
  useVirtual = true;
  let guard = 0;
  while (st.day < dayTarget && guard++ < 1e6) {
    vFrameStart = vClock;
    vCpuAtFrameStart = cpu();
    const day0 = st.day, steps0 = stepLog.length;
    if (record) frameIdx++;
    const ca = cpu();
    dayCpuAcc = 0;
    sim.update(dt);
    const c = cpu() - ca;
    const next = Math.max(vClock + frameMs, vClock + c + RENDER_MS);
    dt = Math.min(0.1, (next - vClock) / 1000);
    vClock = next;
    let mon = 0, yr = 0;
    for (let d = day0 + 1; d <= st.day; d++) { if (d % 30 === 0) mon = 1; if (d % 360 === 0) yr = 1; }
    if (record) frames.push({ c, days: st.day - day0, steps: stepLog.length - steps0, dayCpu: dayCpuAcc, mon, yr });
  }
  useVirtual = false;
}

{
  const ad = sim.advanceDay.bind(sim);
  sim.advanceDay = () => { if (!measuring || MODE !== 'frames') return ad(); const ca = cpu(); ad(); const c = cpu() - ca; dayCpuAcc += c; daysMs.push(c); };
}
const la0 = loadavg();
if (MODE === 'cycles') {
  // full synchronous passes of every time-sliced infra task, interleaved (ABCD ABCD ...), REPS rounds after 1 warm-up
  const tr = sysByName('traffic')! as unknown as { invalidate(): void; runCycleSync(s: Simulation): void; phaseMs: Float64Array };
  const ut = sysByName('utilities')! as unknown as { compute(s: Simulation): void };
  const po = sysByName('pollution')! as unknown as { compute(s: Simulation, f: boolean): void };
  const sv = sysByName('services')! as unknown as { compute(s: Simulation, f: boolean): void };
  const cr = sysByName('crime')! as unknown as { compute(s: Simulation, f: boolean): void };
  const em = sysByName('emergency')! as unknown as { respStep: number; respDirty: boolean; respTaskStep(s: Simulation): void };
  const jobs: [string, () => void][] = [
    ['traffic.cycle', () => { tr.invalidate(); tr.runCycleSync(sim); }],
    ['utilities.fullPass', () => ut.compute(sim)],
    ['pollution.pass', () => po.compute(sim, false)],
    ['services.pass', () => sv.compute(sim, false)],
    ['crime.pass', () => cr.compute(sim, false)],
    ['emergency.respRefresh', () => { em.respStep = -1; em.respDirty = true; do em.respTaskStep(sim); while (em.respStep >= 0); }],
  ];
  const out: Record<string, number[]> = {};
  const phases: number[][] = [];
  for (let r = 0; r <= REPS; r++) {
    for (const [name, fn] of jobs) {
      const ca = cpu();
      fn();
      const c = cpu() - ca;
      if (r > 0) (out[name] ??= []).push(c);
      if (r > 0 && name === 'traffic.cycle') phases.push(Array.from(tr.phaseMs));
    }
  }
  const med = (v: number[]) => { const s2 = v.slice().sort((a, b) => a - b); return s2[s2.length >> 1]; };
  const res2 = { fixture: FIXTURE, mode: MODE, reps: REPS, loadavg: [la0, loadavg()].map((l) => l.map((v) => +v.toFixed(1))), city: info0,
    passes: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { medianCpuMs: +med(v).toFixed(1), minCpuMs: +Math.min(...v).toFixed(1), all: v.map((x) => +x.toFixed(1)) }])),
    trafficPhasesWallMs: TR_PH.map((n, i) => [n, +med(phases.map((p) => p[i])).toFixed(1)]) };
  if (OUT) writeFileSync(OUT, JSON.stringify(res2, null, 1));
  console.log(JSON.stringify(res2, null, 1));
  process.exit(0);
}
// warm-up (JIT tiers, first cycles after load)
if (MODE === 'frames') runFrames(WARM, false); else runHeadless(WARM, false);
let session: Session | null = null;
if (CPUPROF || HEAPPROF) {
  session = new Session();
  session.connect();
  if (CPUPROF) {
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval', { interval: INTERVAL });
    await session.post('Profiler.start');
  }
  if (HEAPPROF) {
    await session.post('HeapProfiler.enable');
    await session.post('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  }
}
trafficCycles0 = traffic.cycles as number;
const util0 = { util: 0 };
void util0;
(globalThis as any).__KC = {};
measuring = true;
const cStart = cpu(), wStart = realNow(), dayStart = st.day, hStart = hr();
if (MODE === 'frames') runFrames(DAYS, true); else runHeadless(DAYS, true);
const totalCpu = cpu() - cStart, totalWall = realNow() - wStart, hEnd = hr();
measuring = false;
const daysRun = st.day - dayStart;
if (session) {
  if (CPUPROF) {
    const { profile } = await session.post('Profiler.stop');
    writeFileSync(CPUPROF, JSON.stringify(profile));
  }
  if (HEAPPROF) {
    const { profile } = await session.post('HeapProfiler.stopSampling');
    writeFileSync(HEAPPROF, JSON.stringify(profile));
  }
  session.disconnect();
}
const la1 = loadavg();
const wEnd = realNow();
await new Promise((r) => setTimeout(r, 100));
obs.disconnect();
const gc = { n: 0, ms: 0, byKind: {} as Record<string, { n: number; ms: number; max: number }>, pauses: [] as number[] };
for (const e of gcAll) {
  if (e.t < wStart || e.t > wEnd) continue;
  gc.n++; gc.ms += e.d; gc.pauses.push(e.d);
  const b = (gc.byKind[e.kind] ??= { n: 0, ms: 0, max: 0 });
  b.n++; b.ms += e.d; if (e.d > b.max) b.max = e.d;
}

// ------------------------------------------------------------------------------------------------ report
const q = (v: number[], f: number) => { if (!v.length) return 0; const s = v.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; };
const summ = (a: Acc) => ({ n: a.n, cpuMs: +a.cpu.toFixed(2), perDay: +(a.cpu / daysRun).toFixed(3), mean: +(a.cpu / Math.max(1, a.n)).toFixed(3), p95: +q(a.vals ?? [], 0.95).toFixed(2), max: +a.max.toFixed(2), wallMs: +a.wall.toFixed(1) });
const sortMap = (m: Map<string, Acc>) => Object.fromEntries([...m.entries()].sort((a, b) => b[1].cpu - a[1].cpu).map(([k, v]) => [k, summ(v)]));
let sysTotal = 0; for (const a of sysAcc.values()) sysTotal += a.cpu;
let taskTotal = 0; for (const a of taskAcc.values()) taskTotal += a.cpu;
const res = {
  fixture: FIXTURE, mode: MODE, days: daysRun, warm: WARM, fps: FPS, speed: SPEED, renderMs: RENDER_MS,
  loadavg: { start: la0.map((v) => +v.toFixed(1)), end: la1.map((v) => +v.toFixed(1)) },
  loadCpuMs: +loadCpu.toFixed(0), initCpuMs: +initCpu.toFixed(0), initWallMs: +initWall.toFixed(0),
  city0: info0, city1: cityInfo(),
  totalCpuMs: +totalCpu.toFixed(1), totalWallMs: +totalWall.toFixed(1), cpuPerDay: +(totalCpu / daysRun).toFixed(2),
  systemsExclCpuPerDay: +(sysTotal / daysRun).toFixed(2), schedulerCpuPerDay: +(taskTotal / daysRun).toFixed(2),
  trafficCycles: (traffic.cycles as number) - trafficCycles0,
  day: daysMs.length ? { mean: +(daysMs.reduce((s, v) => s + v, 0) / daysMs.length).toFixed(2), p50: +q(daysMs, 0.5).toFixed(2), p95: +q(daysMs, 0.95).toFixed(2), p99: +q(daysMs, 0.99).toFixed(2), max: +Math.max(...daysMs).toFixed(2) } : null,
  frames: frames.length ? (() => {
    const c = frames.map((f) => f.c);
    const withDay = frames.filter((f) => f.days > 0).map((f) => f.c), noDay = frames.filter((f) => f.days === 0).map((f) => f.c);
    const mean = (v: number[]) => v.length ? +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(2) : 0;
    return {
      n: frames.length, simSeconds: +(vClock / 1000).toFixed(2), daysPerSec: +(daysRun / (vClock / 1000)).toFixed(2),
      mean: mean(c), p50: +q(c, 0.5).toFixed(2), p95: +q(c, 0.95).toFixed(2), p99: +q(c, 0.99).toFixed(2), max: +Math.max(...c).toFixed(2),
      over16: frames.filter((f) => f.c > 16.7).length, over33: frames.filter((f) => f.c > 33).length, over100: frames.filter((f) => f.c > 100).length,
      withDay: { n: withDay.length, mean: mean(withDay), p95: +q(withDay, 0.95).toFixed(2), max: +Math.max(0, ...withDay).toFixed(2) },
      withMonth: (() => { const v = frames.filter((f) => f.mon && !f.yr).map((f) => f.c); return { n: v.length, mean: mean(v), max: +Math.max(0, ...v).toFixed(2) }; })(),
      withYear: (() => { const v = frames.filter((f) => f.yr).map((f) => f.c); return { n: v.length, mean: mean(v), max: +Math.max(0, ...v).toFixed(2) }; })(),
      dayPartMean: mean(frames.filter((f) => f.days > 0).map((f) => f.dayCpu)), infraPartMean: mean(frames.map((f) => f.c - f.dayCpu)),
      infraPartP95: +q(frames.map((f) => f.c - f.dayCpu), 0.95).toFixed(2), infraPartMax: +Math.max(...frames.map((f) => f.c - f.dayCpu)).toFixed(2),
      noDay: { n: noDay.length, mean: mean(noDay), p95: +q(noDay, 0.95).toFixed(2), max: +Math.max(0, ...noDay).toFixed(2) },
      top: frames.map((f, i) => ({ i, ...f, c: +f.c.toFixed(2) })).sort((a, b) => b.c - a.c).slice(0, 25),
    };
  })() : null,
  systems: sortMap(sysAcc),
  tasks: sortMap(taskAcc),
  steps: sortMap(stepAcc),
  events: Object.fromEntries([...evCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { perDay: +(v / daysRun).toFixed(1), listenerWallMsPerDay: +((evWall.get(k) ?? 0) / daysRun).toFixed(3) }])),
  gc: { n: gc.n, msPerDay: +(gc.ms / daysRun).toFixed(2), maxPause: +Math.max(0, ...gc.pauses).toFixed(2), p99: +q(gc.pauses, 0.99).toFixed(2), byKind: gc.byKind },
  maxStepMsWall: Object.fromEntries(sch.maxStepMs),
  callsPerDay: Object.fromEntries(Object.entries(((globalThis as any).__KC ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / daysRun).toFixed(2)])),
};
if (OUT) {
  writeFileSync(OUT, JSON.stringify(res, null, 1));
  writeFileSync(OUT.replace(/\.json$/, '') + '.steps.json', JSON.stringify(stepLog));
  writeFileSync(OUT.replace(/\.json$/, '') + '.regions.json', JSON.stringify({ labels: regLabels, regions, totalCpuMs: totalCpu, windowUs: [hStart, hEnd] }));
}
const brief = { ...res, frames: res.frames ? { ...res.frames, top: res.frames.top.slice(0, 8) } : null, steps: undefined };
console.log(JSON.stringify(brief, null, 1));
