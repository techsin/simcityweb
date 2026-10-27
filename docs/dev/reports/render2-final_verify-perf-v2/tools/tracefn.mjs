// frame k of a trace: thread time by (top-level kind, function name@file) using the deepest FunctionCall in each task
import { readFileSync } from 'node:fs';
const [file, kS = '2'] = process.argv.slice(2);
const { D, events } = JSON.parse(readFileSync(file, 'utf8'));
const names = events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
const cnt = new Map();
for (const e of events) { const k = e.pid + ':' + e.tid; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
const main = names.map((n) => n.pid + ':' + n.tid).sort((a, b) => (cnt.get(b) ?? 0) - (cnt.get(a) ?? 0))[0];
const ev = events.filter((e) => e.pid + ':' + e.tid === main && e.ph === 'X').sort((a, b) => a.ts - b.ts);
const fafs = ev.filter((e) => e.name === 'FireAnimationFrame').map((e) => e.ts);
let best = null;
for (const f of fafs.slice(0, 400)) { const off = D.F[D.w] - f / 1000; let err = 0; for (let k = 1; k < 8; k++) { const t = (D.F[D.w + k] - off) * 1000; err += fafs.reduce((m, x) => Math.min(m, Math.abs(x - t)), 1e12); } if (!best || err < best.err) best = { off, err }; }
const toE = (ts) => ts / 1000 + best.off;
const k = +kS - 1, a = D.F[D.w + k], b = D.F[D.w + k + 1];
const idx = new Map(ev.map((e, i) => [e, i]));
const tops = ev.filter((e) => e.name === 'ThreadControllerImpl::RunTask' && toE(e.ts) >= a && toE(e.ts) < b);
const g = new Map();
for (const t of tops) {
  let kind = '', fn = '';
  for (let i = idx.get(t) + 1; i < ev.length && ev[i].ts <= t.ts + t.dur; i++) {
    const e = ev[i];
    if (!kind && /TimerFire|HandlePostMessage|EventDispatch|FireAnimationFrame|V8\.GC|ParseAuthorStyleSheet|XHR|ResourceReceive|FunctionCall/.test(e.name)) kind = e.name;
    if (e.name === 'FunctionCall' && e.args?.data) fn = (e.args.data.functionName || '(anon)') + '@' + String(e.args.data.url ?? '').split('/').pop().split('?')[0] + ':' + (e.args.data.lineNumber ?? '');
  }
  const key = (kind || '(none)') + ' ' + fn;
  const v = g.get(key) ?? { n: 0, t: 0 };
  v.n++; v.t += (t.tdur ?? t.dur) / 1000;
  g.set(key, v);
}
console.log(`frame ${k + 1}: ${tops.length} tasks`);
for (const [key, v] of [...g.entries()].sort((x, y) => y[1].t - x[1].t).slice(0, 25)) console.log(`  ${v.t.toFixed(1).padStart(7)} ms ${String(v.n).padStart(6)} x  ${key}`);
