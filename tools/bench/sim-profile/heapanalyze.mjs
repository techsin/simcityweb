#!/usr/bin/env node
/** Allocation sites from a sampling heap profile (includes collected objects): node src/heapanalyze.mjs F.heapprofile --days N [--top 40] */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const here = dirname(new URL(import.meta.url).pathname);
const mapFile = opt('map', resolve(here, '../../../node_modules/.cache/sim-profile/profile.js.map'));
const TOP = +opt('top', 40), DAYS = +opt('days', 1);
const prof = JSON.parse(readFileSync(args[0], 'utf8'));
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


const self = new Map(), total = new Map();
let all = 0;
function key(n) { const cf = n.callFrame; const name = cf.functionName || '(anon)'; if (!cf.url || !cf.url.includes('profile.js')) return `${name} [${cf.url ? cf.url.split('/').pop() : 'native'}]`; const o = orig(cf.lineNumber, cf.columnNumber); return o ? `${name} ${o.src}:${o.line}` : name; }
function walk(n, stack) {
  const k = key(n);
  const s = n.selfSize;
  all += s;
  self.set(k, (self.get(k) ?? 0) + s);
  const st2 = stack.includes(k) ? stack : [...stack, k];
  for (const kk of new Set(st2)) total.set(kk, (total.get(kk) ?? 0) + s);
  for (const c of n.children) walk(c, st2);
}
walk(prof.head, []);
const MB = (b) => (b / 1e6).toFixed(2);
console.log(`estimated allocation ${MB(all)} MB total = ${MB(all / DAYS)} MB/day over ${DAYS} days`);
console.log(`\n== top ${TOP} allocation sites (self, MB/day)`);
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${(v / all * 100).toFixed(1).padStart(5)}% ${MB(v / DAYS).padStart(7)} MB/day  ${k}`);
console.log(`\n== top ${TOP} by total (inclusive, MB/day)`);
for (const [k, v] of [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP + 10)) console.log(`${(v / all * 100).toFixed(1).padStart(5)}% ${MB(v / DAYS).padStart(7)} MB/day  ${k}`);
