// @ts-nocheck — B2 gate 4 probe (WASM_PLAN B2 / WORKER_DESIGN S3; docs/dev/reports/local-B2-step-split.md): per
// InfraScheduler step after --warm days: day, task, label (stepName without #k), est = cost() just before, wall ms
// (performance.now), start ms, and from /proc/self/schedstat (Linux only; the main thread): the on-CPU time and the
// run-queue wait (runnable but not running: another process had the core) inside the step; GC entries
// (PerformanceObserver). The cloud ran it bundled (b2work's stepmap-bundle.mjs); `npx tsx` runs the same code.
//   npx tsx tools/bench/b2/gate4Probe.ts --fixture F.metropolis --warm 0 --days 220 --out X.json
// Analyse a set of runs with tools/bench/b2/gate4.py (the lead's amended gate 4).
import { readFileSync, writeFileSync, openSync, readSync } from 'node:fs';
import { loadavg } from 'node:os';
import { PerformanceObserver } from 'node:perf_hooks';
import { unpackFile } from '../../../src/save/bundle';
import { deserializeCity } from '../../../src/save/serialize';
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { schedulerOf } from '../../../src/sim/infra/scheduler';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '1') : d; };
const FIX = arg('fixture'), WARM = +arg('warm', '0'), DAYS = +arg('days', '80'), OUT = arg('out');
const now = performance.now.bind(performance);
const fd = openSync('/proc/self/schedstat', 'r');
const sbuf = Buffer.alloc(96);
let sCpu = 0, sWait = 0;
const ss = () => {
  const n = readSync(fd, sbuf, 0, 96, 0);
  let i = 0, a = 0, b = 0;
  while (i < n && sbuf[i] !== 32) { a = a * 10 + (sbuf[i] - 48); i++; }
  i++;
  while (i < n && sbuf[i] !== 32) { b = b * 10 + (sbuf[i] - 48); i++; }
  sCpu = a; sWait = b;
};
const tl0 = now();
const state = deserializeCity(await unpackFile(new Uint8Array(readFileSync(FIX))));
const sim = new Simulation(state, createSystems());
const loadMs = now() - tl0;
const sch = schedulerOf(sim);
const sysOf = (n) => sim.getSystem(n === 'emergency.response' ? 'emergency' : n);
const idx = (s) => (s.stepIdx ?? s.phase ?? s.respStep);
let rec = false;
const D = [], T = [], L = [], E = [], M = [], S = [], C = [], Q = [];
const lab = new Map(); const labs = [];
const lid = (x) => { let i = lab.get(x); if (i === undefined) { i = labs.length; labs.push(x); lab.set(x, i); } return i; };
const tnames = sch.tasks.map((t) => t.name);
sch.tasks.forEach((t, ti) => {
  const step = t.step.bind(t), cost = t.cost.bind(t);
  const sys = sysOf(t.name);
  t.step = (s2) => {
    if (!rec) return step(s2);
    let l;
    try { const sn = sys && sys.stepName; l = typeof sn === 'string' ? sn.replace(/#\d+/, '') : 'st' + idx(sys); } catch { l = '?'; }
    const e = cost(s2);
    ss(); const c0 = sCpu, q0 = sWait;
    const a = now();
    step(s2);
    const b = now();
    ss();
    D.push(sim.state.day); T.push(ti); L.push(lid(l)); E.push(e); M.push(b - a); S.push(a); C.push((sCpu - c0) / 1e6); Q.push((sWait - q0) / 1e6);
  };
});
const gc = [];
const obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) gc.push([e.startTime, e.duration]); });
obs.observe({ entryTypes: ['gc'] });
for (let d = 0; d < WARM; d++) sim.advanceDay();
rec = true;
const la0 = loadavg()[0];
const w0 = now();
for (let d = 0; d < DAYS; d++) {
  sim.advanceDay();
  if (d % 10 === 9) await new Promise((r) => setImmediate(r));
}
const wall = now() - w0;
rec = false;
await new Promise((r) => setTimeout(r, 50));
const out = { fix: FIX, warm: WARM, days: DAYS, loadMs, wall, la0, la1: loadavg()[0], pop: sim.state.stats.population, day: sim.state.day,
  tnames, labs, d: D, t: T, l: L, e: E.map((x) => +x.toFixed(5)), m: M.map((x) => +x.toFixed(4)), s: S.map((x) => +x.toFixed(3)),
  c: C.map((x) => +x.toFixed(3)), q: Q.map((x) => +x.toFixed(3)), gc,
  spent: Object.fromEntries(sch.spentMs), est: Object.fromEntries(sch.estMs) };
if (OUT) writeFileSync(OUT, JSON.stringify(out));
console.log(JSON.stringify({ fix: FIX, warm: WARM, days: DAYS, loadMs: +loadMs.toFixed(0), wall: +wall.toFixed(0), steps: D.length, gcs: gc.length, pop: out.pop, la0, la1: out.la1 }));
process.exit(0);
