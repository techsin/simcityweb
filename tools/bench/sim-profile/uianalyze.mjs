#!/usr/bin/env node
/**
 * Analyze a uiprof.mjs trace: node browser/uianalyze.mjs prof/ui_dense.trace.json [--json out.json]
 * Regions from performance.mark('>X') / ('<X') pairs on the renderer main thread; cpu = tts delta (thread time),
 * wall = ts delta. Exclusive time = inclusive minus nested regions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.argv[2];
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const T = JSON.parse(readFileSync(file, 'utf8'));
const marks = T.events.filter((e) => e.cat === 'blink.user_timing' && (e.name.startsWith('>') || e.name.startsWith('<')));
const tid = (() => { const c = new Map(); for (const m of marks) c.set(m.tid, (c.get(m.tid) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; })();
const ms = marks.filter((m) => m.tid === tid).sort((a, b) => a.ts - b.ts);
const noTts = ms.filter((m) => m.tts === undefined).length;
// build regions
const stack = [];
const frames = [];
const intervals = []; // [ts0, ts1, label, depth]
const agg = new Map(); // label -> {n, cpu, wall, excl, exclWall, maxCpu, vals}
const A = (l) => { let a = agg.get(l); if (!a) agg.set(l, (a = { n: 0, cpu: 0, wall: 0, excl: 0, exclWall: 0, maxCpu: 0, vals: [] })); return a; };
let unmatched = 0;
for (const m of ms) {
  const open = m.name[0] === '>';
  const label = m.name.slice(1);
  if (open) { stack.push({ label, ts: m.ts, tts: m.tts, childCpu: 0, childWall: 0, kids: [], frame: label === 'F' ? { label, parts: {} } : null }); continue; }
  // close: pop to the matching label
  let k = stack.length - 1;
  while (k >= 0 && stack[k].label !== label) k--;
  if (k < 0) { unmatched++; continue; }
  while (stack.length - 1 > k) { stack.pop(); unmatched++; }
  const r = stack.pop();
  intervals.push([r.ts, m.ts, label, stack.length]);
  const cpu = (m.tts - r.tts) / 1000, wall = (m.ts - r.ts) / 1000;
  const a = A(label);
  a.n++; a.cpu += cpu; a.wall += wall; a.excl += cpu - r.childCpu; a.exclWall += wall - r.childWall; a.maxCpu = Math.max(a.maxCpu, cpu); a.vals.push(cpu);
  const parent = stack[stack.length - 1];
  if (parent) { parent.childCpu += cpu; parent.childWall += wall; parent.kids.push({ label, cpu, wall, excl: cpu - r.childCpu, kids: r.kids }); }
  if (label === 'F') frames.push({ cpu, wall, kids: r.kids, ts: r.ts });
}
const q = (v, f) => { if (!v.length) return 0; const s = v.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; };
const mean = (v) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);
const f2 = (x) => +x.toFixed(2);
// per-frame decomposition
function walk(kids, fn, depth = 0) { for (const k of kids) { fn(k, depth); walk(k.kids, fn, depth + 1); } }
const per = frames.map((f) => {
  let U = 0, D = 0, R = 0, E = 0, EinU = 0, S = 0, Tt = 0, mon = false, yr = false, day = 0;
  for (const k of f.kids) { if (k.label === 'U') U += k.cpu; if (k.label.startsWith('R:')) R += k.cpu; }
  walk(f.kids, (k) => {
    if (k.label === 'D') { D += k.cpu; day++; }
    if (k.label.startsWith('E:')) E += k.cpu;
    if (k.label.startsWith('S:')) S += k.excl;
    if (k.label.startsWith('T:')) Tt += k.excl;
    if (k.label.endsWith('.monthly')) mon = true;
    if (k.label.endsWith('.yearly') || k.label === 'E:year') yr = true;
  });
  // event listener time inside sim.update (render/UI handlers triggered by the sim)
  const Uk = f.kids.filter((k) => k.label === 'U');
  walk(Uk, (k) => { if (k.label.startsWith('E:')) EinU += k.cpu; });
  return { cpu: f.cpu, wall: f.wall, U, D, R, E, EinU, S, T: Tt, other: f.cpu - U - R, day, mon, yr };
});
const col = (k) => per.map((p) => p[k]);
const dist = (v) => ({ mean: f2(mean(v)), p50: f2(q(v, 0.5)), p95: f2(q(v, 0.95)), p99: f2(q(v, 0.99)), max: f2(Math.max(0, ...v)) });
const days = T.run.d1 - T.run.d0;
const totalCpu = per.reduce((s, p) => s + p.cpu, 0);
const res = {
  run: T.run, load: T.load, tid, marks: ms.length, noTts, unmatched, frames: per.length,
  fps: f2(per.length / (T.run.wallMs / 1000)), daysPerSec: f2(days / (T.run.wallMs / 1000)),
  cpuPerFrame: dist(col('cpu')), wallPerFrame: dist(col('wall')),
  simUpdateCpu: dist(col('U')), simUpdateWall: dist(per.map((p, i) => frames[i].kids.filter((k) => k.label === 'U').reduce((s, k) => s + k.wall, 0))),
  renderCpu: dist(col('R')), otherCpu: dist(col('other')),
  shares: {
    simUpdate: f2(per.reduce((s, p) => s + p.U, 0) / totalCpu), render: f2(per.reduce((s, p) => s + p.R, 0) / totalCpu), other: f2(per.reduce((s, p) => s + p.other, 0) / totalCpu),
    listenersInSimUpdate: f2(per.reduce((s, p) => s + p.EinU, 0) / Math.max(1e-9, per.reduce((s, p) => s + p.U, 0))),
  },
  perDayCpu: { simUpdate: f2(per.reduce((s, p) => s + p.U, 0) / days), listeners: f2(per.reduce((s, p) => s + p.EinU, 0) / days), render: f2(per.reduce((s, p) => s + p.R, 0) / days), frame: f2(totalCpu / days) },
  byBoundary: {
    noDay: dist(per.filter((p) => !p.day).map((p) => p.U)),
    day: dist(per.filter((p) => p.day && !p.mon && !p.yr).map((p) => p.U)),
    month: dist(per.filter((p) => p.mon && !p.yr).map((p) => p.U)),
    year: dist(per.filter((p) => p.yr).map((p) => p.U)),
    counts: { noDay: per.filter((p) => !p.day).length, day: per.filter((p) => p.day && !p.mon && !p.yr).length, month: per.filter((p) => p.mon && !p.yr).length, year: per.filter((p) => p.yr).length },
  },
  regions: Object.fromEntries([...agg.entries()].sort((a, b) => b[1].excl - a[1].excl).map(([l, a]) => [l, { n: a.n, cpuPerDay: f2(a.cpu / days), exclPerDay: f2(a.excl / days), mean: f2(a.cpu / a.n), p95: f2(q(a.vals, 0.95)), max: f2(a.maxCpu), wallPerDay: f2(a.wall / days) }])),
  topFrames: per.map((p, i) => ({ i, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'number' ? f2(v) : v])) })).sort((a, b) => b.cpu - a.cpu).slice(0, 15),
};
// GC on the main thread
const gcs = T.events.filter((e) => e.tid === tid && /GC/.test(e.name) && e.ph === 'X');
const gcBy = {};
for (const e of gcs) { const b = (gcBy[e.name] ??= { n: 0, durMs: 0, tdurMs: 0, maxMs: 0 }); b.n++; b.durMs += (e.dur ?? 0) / 1000; b.tdurMs += (e.tdur ?? 0) / 1000; b.maxMs = Math.max(b.maxMs, (e.tdur ?? e.dur ?? 0) / 1000); }
// GC events -> innermost region (by start ts) -> top-level class (sim.update / render / other) + innermost label
const gcBig = gcs.filter((e) => ['MinorGC', 'MajorGC'].includes(e.name) || e.name === 'V8.GCIncrementalMarking');
const byClass = {}, byLabel = {};
intervals.sort((a, b) => a[0] - b[0]);
for (const e of gcBig) {
  let inner = null, top = null;
  for (const iv of intervals) { if (iv[0] > e.ts) break; if (iv[1] >= e.ts) { if (!inner || iv[3] > inner[3]) inner = iv; if (iv[3] === 1) top = iv; } }
  const cls = !inner ? 'between frames' : !top ? 'frame (outside sim/render)' : top[2] === 'U' ? 'sim.update' : top[2].startsWith('R:') ? 'render' : 'frame (outside sim/render)';
  const k = e.name + ' @ ' + cls;
  byClass[k] = (byClass[k] ?? 0) + (e.tdur ?? 0) / 1000;
  if (inner) { const k2 = e.name + ' @ ' + inner[2]; byLabel[k2] = (byLabel[k2] ?? 0) + (e.tdur ?? 0) / 1000; }
}
res.gcByClassMsPerDay = Object.fromEntries(Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, f2(v / days)]));
res.gcByRegionTop = Object.fromEntries(Object.entries(byLabel).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, f2(v / days)]));
res.gc = Object.fromEntries(Object.entries(gcBy).map(([k, v]) => [k, { n: v.n, cpuMsPerDay: f2(v.tdurMs / days), wallMsPerDay: f2(v.durMs / days), maxCpuMs: f2(v.maxMs) }]));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(res, null, 1));
const { regions, topFrames, ...brief } = res;
console.log(JSON.stringify(brief, null, 1));
console.log('regions (sorted by exclusive CPU per day):');
for (const [l, a] of Object.entries(regions).slice(0, 60)) console.log(`  ${l.padEnd(44)} n=${String(a.n).padStart(6)} excl/day ${String(a.exclPerDay).padStart(7)} incl/day ${String(a.cpuPerDay).padStart(7)} mean ${String(a.mean).padStart(7)} p95 ${String(a.p95).padStart(7)} max ${String(a.max).padStart(8)}`);
console.log('top frames:'); for (const f of topFrames) console.log('  ' + JSON.stringify(f));
