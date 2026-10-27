// analysis helpers for perfrev-v2 (fresh specs, game specs, warm rows, gpu rows)
import { readJsonl, median, mean, OUT } from './lib.mjs';
import { resolve } from 'node:path';

let seed = 987654;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
export function bootMed(v, B = 5000) {
  v = v.filter(Number.isFinite);
  if (!v.length) return [NaN, NaN, NaN];
  const ms = new Float64Array(B);
  for (let b = 0; b < B; b++) { const s = new Array(v.length); for (let i = 0; i < v.length; i++) s[i] = v[Math.floor(rnd() * v.length)]; ms[b] = median(s); }
  ms.sort();
  return [median(v), ms[Math.floor(B * 0.05)], ms[Math.floor(B * 0.95)]];
}
export const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : 'nan');
export const fmt = (t) => `${f3(t[0])} [${f3(t[1])}-${f3(t[2])}]`;
export const above = (v) => `${v.filter((x) => x > 1).length}/${v.filter(Number.isFinite).length}`;

/** records of a spec: errors dropped, last record per tag kept; tag = <spec>_r<rep>_<label> */
export function loadSpec(spec) {
  const recs = readJsonl(resolve(OUT, `${spec}.jsonl`)).filter((r) => !r.error);
  const byTag = new Map();
  for (const r of recs) byTag.set(r.tag, r);
  const out = [];
  for (const r of byTag.values()) {
    const m = r.tag.match(/_r(\d+)_([A-Za-z0-9]+)$/);
    if (!m) continue;
    out.push({ ...r, rep: +m[1], label: m[2] });
  }
  return out;
}

/** metric of one fresh record: segment `seg` (name or name@2 for pass 2), field (cpu | pollCpu | gpu | js | mt | calls ...) */
export function segVal(r, seg, field = 'cpu') {
  const [name, p] = seg.split('@');
  const pass = p ? +p : 1;
  if (r.kind === 'game' || (r.segs && !Array.isArray(r.segs))) { const s = r.segs?.[name]; return s ? (field === 'cpu' ? s.cpu : s[field]) : NaN; }
  const s = (r.segs ?? []).find((x) => x.name === name && x.pass === pass);
  return s ? s[field] : NaN;
}

/** per-rep table of a value function: Map rep -> { label: value } */
export function byRep(recs, fn) {
  const m = new Map();
  for (const r of recs) {
    if (!m.has(r.rep)) m.set(r.rep, {});
    m.get(r.rep)[r.label] = fn(r);
  }
  return m;
}

/** ratio summary of num vs den labels (arrays of A/A copies, e.g. ['new','new2'] vs ['base','base2']) */
export function ratios(reps, num, den) {
  const pairs = [], vm = [], aaN = [], aaD = [];
  for (const v of reps.values()) {
    for (let k = 0; k < Math.min(num.length, den.length); k++) if (Number.isFinite(v[num[k]]) && Number.isFinite(v[den[k]])) pairs.push(v[num[k]] / v[den[k]]);
    const n = num.map((l) => v[l]).filter(Number.isFinite), d = den.map((l) => v[l]).filter(Number.isFinite);
    if (n.length && d.length) vm.push(mean(n) / mean(d));
    if (num.length > 1 && Number.isFinite(v[num[1]]) && Number.isFinite(v[num[0]])) aaN.push(v[num[1]] / v[num[0]]);
    if (den.length > 1 && Number.isFinite(v[den[1]]) && Number.isFinite(v[den[0]])) aaD.push(v[den[1]] / v[den[0]]);
  }
  return { pairs, vm, aaN, aaD, P: bootMed(pairs), V: bootMed(vm), AN: bootMed(aaN), AD: bootMed(aaD) };
}
export function ratioLine(name, R, numL = 'new', denL = 'base') {
  return `${name.padEnd(22)} pairs ${fmt(R.P)} (${above(R.pairs)})  vmeans ${fmt(R.V)} (${above(R.vm)})  A/A ${denL} ${fmt(R.AD)}  ${numL} ${fmt(R.AN)}`;
}

/** the lead's rule for a fresh-page segment (Oct 26): major iff lower CI bound > 1.02 with A/A within +-5 % */
export function verdict(R) {
  const lo = Math.min(R.P[1], R.V[1]);
  const pt = Math.max(R.P[0], R.V[0]);
  const aaOk = [R.AN[0], R.AD[0]].every((x) => !Number.isFinite(x) || Math.abs(x - 1) <= 0.05);
  if (R.P[1] > 1.02 && R.V[1] > 1.02 && aaOk) return 'MAJOR (excess shown)';
  if (R.P[1] > 1.02 || R.V[1] > 1.02) return aaOk ? 'MAJOR? (one estimate shows it)' : 'inconclusive (A/A > 5 %)';
  if (pt > 1.0) return 'minor/inconclusive (point > 1, CI reaches <= 1.02)';
  void lo;
  return 'ok (<= base)';
}
export function medianOf(recs, fn) { return median(recs.map(fn)); }
