#!/usr/bin/env node
/**
 * Analyze a V8 .cpuprofile of the bundled profiler (out/profile/profile.js + .map):
 *   node src/analyze.mjs <file.cpuprofile> [--map out/profile/profile.js.map] [--top 40] [--cpu <totalCpuMs>] [--json out.json]
 * Attribution by SAMPLE COUNT (robust under machine load). Self = samples whose leaf is the function; total = samples
 * with the function anywhere on the stack (counted once per sample). Functions are keyed by name + original
 * source file:line (via the bundle's source map).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const file = args[0];
const here = dirname(new URL(import.meta.url).pathname);
const mapFile = opt('map', resolve(here, '../../../node_modules/.cache/sim-profile/profile.js.map'));
const TOP = +opt('top', 40);
const CPU = opt('cpu') ? +opt('cpu') : null;
const prof = JSON.parse(readFileSync(file, 'utf8'));

// ------------------------------------------------------------------ source map (VLQ)
const map = JSON.parse(readFileSync(mapFile, 'utf8'));
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const b64 = new Map([...B64].map((c, i) => [c, i]));
const lines = [];
{
  let srcIdx = 0, srcLine = 0, srcCol = 0, nameIdx = 0;
  for (const l of map.mappings.split(';')) {
    const segs = [];
    let genCol = 0;
    if (l) for (const seg of l.split(',')) {
      const v = [];
      let shift = 0, val = 0;
      for (const ch of seg) {
        const d = b64.get(ch);
        val += (d & 31) << shift;
        if (d & 32) shift += 5;
        else { const neg = val & 1; val >>>= 1; v.push(neg ? -val : val); val = 0; shift = 0; }
      }
      genCol += v[0];
      if (v.length >= 4) { srcIdx += v[1]; srcLine += v[2]; srcCol += v[3]; if (v.length >= 5) nameIdx += v[4]; segs.push([genCol, srcIdx, srcLine, srcCol]); }
    }
    lines.push(segs);
  }
}
const root = resolve(here, '..');
function orig(line, col) {
  const segs = lines[line];
  if (!segs || !segs.length) return null;
  let lo = 0, hi = segs.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (segs[m][0] <= col) { best = m; lo = m + 1; } else hi = m - 1; }
  if (best < 0) best = 0;
  const s = segs[best];
  let src = map.sources[s[1]] ?? '?';
  src = src.replace(/^(\.\.\/)+/, '').replace(/^.*?snap(-kc)?\//, '');
  return { src, line: s[2] + 1 };
}

// ------------------------------------------------------------------ attribution
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const keyCache = new Map();
function keyOf(n) {
  let k = keyCache.get(n.id);
  if (k) return k;
  const cf = n.callFrame;
  const name = cf.functionName || '(anon)';
  if (!cf.url || !cf.url.includes('profile.js')) k = `${name} [${cf.url ? cf.url.split('/').pop() : 'native'}]`;
  else { const o = orig(cf.lineNumber, cf.columnNumber); k = o ? `${name} ${o.src}:${o.line}` : `${name} profile.js:${cf.lineNumber + 1}`; }
  keyCache.set(n.id, k);
  return k;
}
// ------------------------------------------------------------------ CPU-time weights per sample (--regions)
// Sample counts from a wall-clock sampler are biased by machine-load fluctuations; with the harness region log
// (start/end hrtime + main-thread CPU per system hook / scheduler step) each sample gets weight = exclusive CPU of the
// innermost region containing it / samples in that region, so function costs are in CPU ms.
const n = prof.samples.length;
const ts = new Float64Array(n);
{ let t = prof.startTime; for (let i = 0; i < n; i++) { t += prof.timeDeltas[i]; ts[i] = t; } }
const weight = new Float64Array(n).fill(1);
const regionOf = new Int32Array(n).fill(-1);
let R = null;
if (opt('regions')) {
  R = JSON.parse(readFileSync(opt('regions'), 'utf8'));
  const fl = R.regions, nr = fl.length / 4;
  const idx = [...Array(nr).keys()].sort((a, b) => fl[a * 4] - fl[b * 4] || fl[b * 4 + 1] - fl[a * 4 + 1]);
  const excl = new Float64Array(nr), parentR = new Int32Array(nr).fill(-1);
  for (let k = 0; k < nr; k++) excl[k] = fl[k * 4 + 2];
  // nesting via a stack sweep
  const stack = [];
  for (const r of idx) {
    while (stack.length && fl[stack[stack.length - 1] * 4 + 1] <= fl[r * 4]) stack.pop();
    if (stack.length) { parentR[r] = stack[stack.length - 1]; excl[parentR[r]] -= fl[r * 4 + 2]; }
    stack.push(r);
  }
  // innermost region per sample (samples sorted by time; sweep with a stack again)
  let j = 0; const st2 = [];
  for (let i = 0; i < n; i++) {
    const t = ts[i];
    while (j < idx.length && fl[idx[j] * 4] <= t) {
      const r = idx[j++];
      while (st2.length && fl[st2[st2.length - 1] * 4 + 1] <= fl[r * 4]) st2.pop();
      st2.push(r);
    }
    while (st2.length && fl[st2[st2.length - 1] * 4 + 1] < t) st2.pop();
    regionOf[i] = st2.length ? st2[st2.length - 1] : -1;
  }
  const cnt = new Float64Array(nr + 1);
  let inWin = 0;
  for (let i = 0; i < n; i++) { if (ts[i] < R.windowUs[0] || ts[i] > R.windowUs[1]) continue; inWin++; cnt[regionOf[i] < 0 ? nr : regionOf[i]]++; }
  // regions with CPU but no sample: aggregate per label so their CPU is not lost
  const lostByLabel = new Map();
  let exclSum = 0;
  for (let r = 0; r < nr; r++) { exclSum += Math.max(0, excl[r]); if (cnt[r] === 0 && excl[r] > 0) lostByLabel.set(R.labels[fl[r * 4 + 3]], (lostByLabel.get(R.labels[fl[r * 4 + 3]]) ?? 0) + excl[r]); }
  const gapCpu = Math.max(0, R.totalCpuMs - exclSum);
  for (let i = 0; i < n; i++) {
    if (ts[i] < R.windowUs[0] || ts[i] > R.windowUs[1]) { weight[i] = 0; continue; }
    const r = regionOf[i];
    weight[i] = r < 0 ? gapCpu / Math.max(1, cnt[nr]) : Math.max(0, excl[r]) / cnt[r];
  }
  globalThis.__lost = lostByLabel;
  globalThis.__regionLabel = (i) => (regionOf[i] < 0 ? '(gap)' : R.labels[fl[regionOf[i] * 4 + 3]]);
  console.log(`regions ${nr}, samples in window ${inWin}, gap samples ${cnt[nr]} (gap cpu ${gapCpu.toFixed(1)} ms), unsampled region cpu ${[...lostByLabel.values()].reduce((a, b) => a + b, 0).toFixed(1)} ms`);
}
const self = new Map(), total = new Map(), byRegionFn = new Map();
let tot = 0, idle = 0, gcS = 0, prog = 0, totW = 0;
for (let si = 0; si < n; si++) {
  const sid = prof.samples[si];
  const nd = byId.get(sid);
  const fn = nd.callFrame.functionName;
  const w = weight[si];
  if (fn === '(idle)') { idle++; continue; }
  if (fn === '(program)') { prog++; continue; }
  if (w === 0) continue;
  tot++; totW += w;
  if (fn === '(garbage collector)') gcS += w;
  const k = keyOf(nd);
  self.set(k, (self.get(k) ?? 0) + w);
  if (R) { const rl = globalThis.__regionLabel(si); const m = byRegionFn.get(rl) ?? new Map(); m.set(k, (m.get(k) ?? 0) + w); byRegionFn.set(rl, m); }
  const seen = new Set();
  let id = sid;
  while (id !== undefined) { const m = byId.get(id); const kk = keyOf(m); if (!seen.has(kk)) { seen.add(kk); total.set(kk, (total.get(kk) ?? 0) + w); } id = parent.get(id); }
}
if (R) for (const [l, c] of globalThis.__lost) { const k = `(unsampled) ${l}`; self.set(k, c); total.set(k, c); totW += c; }
const unit = R ? 'ms' : 'samples';
const ms = (c) => (R ? c.toFixed(1) + 'ms' : CPU ? ((c / totW) * CPU).toFixed(1) + 'ms' : String(Math.round(c)));
const pct = (c) => ((c / totW) * 100).toFixed(1).padStart(5) + '%';
console.log(`samples ${prof.samples.length}: counted ${tot} (idle ${idle}, program ${prog}); total ${R ? totW.toFixed(1) + ' cpu ms' : totW + ' samples'}; GC ${pct(gcS)}; interval ~${((prof.endTime - prof.startTime) / prof.samples.length).toFixed(0)}us wall`);
console.log(`\n== top ${TOP} by SELF (${unit})`);
const selfTop = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP);
for (const [k, v] of selfTop) console.log(`${pct(v)} ${ms(v).padStart(9)}  ${k}`);
console.log(`\n== top ${TOP} by TOTAL (inclusive)`);
const totTop = [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP + 25);
for (const [k, v] of totTop) console.log(`${pct(v)} ${ms(v).padStart(9)}  self ${pct(self.get(k) ?? 0)}  ${k}`);
if (R && opt('byregion')) {
  console.log('\n== per region: top self functions');
  const regTot = [...byRegionFn.entries()].map(([l, m]) => [l, [...m.values()].reduce((a, b) => a + b, 0), m]).sort((a, b) => b[1] - a[1]);
  for (const [l, t, m] of regTot.slice(0, +opt('byregion'))) {
    console.log(`${pct(t)} ${ms(t).padStart(9)}  ${l}: ` + [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k.replace(/ src\/sim\//, ' ')} ${(v / t * 100).toFixed(0)}%`).join(' | '));
  }
}
if (opt('json')) writeFileSync(opt('json'), JSON.stringify({ totW, gc: gcS, self: Object.fromEntries(self), total: Object.fromEntries(total), byRegion: Object.fromEntries([...byRegionFn.entries()].map(([l, m]) => [l, Object.fromEntries(m)])) }));
