// warm moving-segment counts (WC runs: c024 vs new, 1 row after the warm-up): per segment the frame sums of main tris,
// main calls, all tris, all calls, shadow tris / calls; ratio new/c024; per-page moving sums. node anawc.mjs <tag> [num] [den]
import { readJsonl } from './lib.mjs';
import { resolve } from 'node:path';
const [tag, num = 'new', den = 'c024'] = process.argv.slice(2);
const recs = readJsonl(resolve(process.cwd(), '../out/WC.jsonl')).filter((r) => r.tag === tag && !r.error && !r.final && r.row === 0);
const MOVING = ['zoomout', 'farorbit', 'zoomin', 'streetpan', 'streetfast', 'pan', 'fastpan', 'cuts', 'edgepan', 'edgefast', 'edgeturn'];
const F = ['mt', 'mc', 'tris', 'calls', 'st', 'sc'];
const sums = { n: {}, d: {} };
console.log(`== ${tag}: ${num} vs ${den} (one warm row; frame sums)`);
for (const s of [...new Set(recs.map((r) => r.seg))]) {
  const a = recs.find((r) => r.seg === s && r.label === num), b = recs.find((r) => r.seg === s && r.label === den);
  if (!a || !b) continue;
  const parts = F.map((f) => { if (MOVING.includes(s)) { sums.n[f] = (sums.n[f] ?? 0) + a[f]; sums.d[f] = (sums.d[f] ?? 0) + b[f]; } return `${f} ${(a[f] / b[f]).toFixed(3)}`; });
  console.log(`${s.padEnd(11)} ${parts.join(' | ')}   (mt ${(a.mt / 1e6).toFixed(2)}M vs ${(b.mt / 1e6).toFixed(2)}M, mc ${a.mc} vs ${b.mc})`);
}
console.log(`MOVING sums: ${F.map((f) => `${f} ${(sums.n[f] / sums.d[f]).toFixed(3)}`).join(' | ')}`);
