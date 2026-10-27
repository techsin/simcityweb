// what the many small tasks in the first frames are: per frame, top-level tasks grouped by their first nested event
import { readFileSync } from 'node:fs';
const [file, fromS = '1', toS = '8'] = process.argv.slice(2);
const { D, events } = JSON.parse(readFileSync(file, 'utf8'));
const names = events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
const cnt = new Map();
for (const e of events) { const k = e.pid + ':' + e.tid; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
const main = names.map((n) => n.pid + ':' + n.tid).sort((a, b) => (cnt.get(b) ?? 0) - (cnt.get(a) ?? 0))[0];
const ev = events.filter((e) => e.pid + ':' + e.tid === main && e.ph === 'X').sort((a, b) => a.ts - b.ts);
const fafs = ev.filter((e) => e.name === 'FireAnimationFrame').map((e) => e.ts);
let best = null;
for (const f of fafs.slice(0, 400)) {
  const off = D.F[D.w] - f / 1000;
  let err = 0;
  for (let k = 1; k < 8; k++) { const t = (D.F[D.w + k] - off) * 1000; err += fafs.reduce((m, x) => Math.min(m, Math.abs(x - t)), 1e12); }
  if (!best || err < best.err) best = { off, err };
}
const toE = (ts) => ts / 1000 + best.off;
const tops = ev.filter((e) => e.name === 'ThreadControllerImpl::RunTask');
const idx = new Map(ev.map((e, i) => [e, i]));
for (let k = +fromS - 1; k < +toS; k++) {
  const a = D.F[D.w + k], b = D.F[D.w + k + 1];
  const T = tops.filter((e) => toE(e.ts) >= a && toE(e.ts) < b);
  const g = new Map();
  for (const t of T) {
    // (ev is sorted by start: the task's nested events follow it)
    const kids = [];
    for (let i = idx.get(t) + 1; i < ev.length && ev[i].ts <= t.ts + t.dur; i++) { const e = ev[i]; if (e.ts + (e.dur ?? 0) <= t.ts + t.dur && e.name !== 'ThreadControllerImpl::RunTask') kids.push(e); }
    // the most specific informative child
    const inf = kids.find((e) => e.name === 'FunctionCall' && e.args?.data?.functionName) ?? kids.find((e) => /HandlePostMessage|TimerFire|EventDispatch|FireAnimationFrame|ParseHTML|XHR|ResourceReceive|BeginMainFrame|V8.GC|MajorGC|MinorGC|Scavenge|Mark/.test(e.name)) ?? kids[0];
    const key = inf ? inf.name + (inf.args?.data?.functionName ? ':' + inf.args.data.functionName + '@' + String(inf.args.data.url ?? '').split('/').pop() : '') + (inf.args?.data?.type ? '[' + inf.args.data.type + ']' : '') : '(empty)';
    const v = g.get(key) ?? { n: 0, t: 0 };
    v.n++; v.t += (t.tdur ?? t.dur) / 1000;
    g.set(key, v);
  }
  const tot = T.reduce((s, t) => s + (t.tdur ?? t.dur) / 1000, 0);
  // GC on the main thread inside this frame interval
  const gcs = ev.filter((e) => toE(e.ts) >= a && toE(e.ts) < b && /^(MajorGC|MinorGC|V8\.GC_MARK_COMPACTOR|V8\.GC_SCAVENGER|V8\.GC_MC_BACKGROUND|V8\.GCScavenger|V8\.GCIncrementalMarking|V8\.GCFinalizeMC|V8\.GC_MC_INCREMENTAL|V8\.GCCompactor|V8\.GC_MC_FINISH|V8\.GC_MC_MARK)$/.test(e.name));
  const gagg = new Map();
  for (const e of gcs) gagg.set(e.name, (gagg.get(e.name) ?? 0) + (e.tdur ?? e.dur ?? 0) / 1000);
  if (gcs.length) console.log(`   GC: ${[...gagg.entries()].map(([n, v]) => n + ' ' + v.toFixed(1)).join(' | ')}`);
  console.log(`frame ${k + 1}: ${T.length} tasks, thread ${tot.toFixed(1)} ms`);
  for (const [key, v] of [...g.entries()].sort((x, y) => y[1].t - x[1].t).slice(0, 8)) console.log(`   ${v.t.toFixed(1).padStart(7)} ms  ${String(v.n).padStart(6)} x  ${key.slice(0, 140)}`);
}
