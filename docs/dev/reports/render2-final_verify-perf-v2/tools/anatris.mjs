// triangles / draw calls per segment (sums over the segment's frames), fresh specs: node anatris.mjs <spec> <num> <den> [more labels csv]
// median over runs per label (A/A copies pooled by side), ratio num/den per segment, per-page moving sums.
import { median } from './lib.mjs';
import { loadSpec, segVal } from './ana.mjs';
const [spec, num = 'new', den = 'c024', moreS = ''] = process.argv.slice(2);
const recs = loadSpec(spec);
const side = (l) => recs.find((r) => r.label === l)?.side;
const bySide = (s) => recs.filter((r) => r.side === s);
const more = moreS ? moreS.split(',') : [];
const segs = [...new Set(recs.flatMap((r) => (r.segs ?? []).filter((x) => x.pass === 1).map((x) => x.name)))];
const MOVING = ['zoomout', 'farorbit', 'zoomin', 'streetpan', 'streetfast', 'pan', 'fastpan', 'cuts'];
const F = ['mt', 'mc', 'tris', 'calls', 'st', 'sc'];
const med = (s, seg, f) => median(bySide(s).map((r) => segVal(r, seg, f)).filter(Number.isFinite));
const sn = side(num) ?? num, sd = side(den) ?? den;
console.log(`== ${spec}: ${sn} vs ${sd} (medians over ${bySide(sn).length} / ${bySide(sd).length} runs); main tris (mt), main calls (mc), all tris, all calls, shadow tris (st), shadow calls (sc)`);
const sums = { n: Object.fromEntries(F.map((f) => [f, 0])), d: Object.fromEntries(F.map((f) => [f, 0])) };
for (const s of segs) {
  const parts = F.map((f) => { const a = med(sn, s, f), b = med(sd, s, f); if (MOVING.includes(s)) { sums.n[f] += a; sums.d[f] += b; } return `${f} ${(f.endsWith('t') || f === 'tris' ? (a / 1e6).toFixed(2) + 'M' : a.toFixed(0))}/${(f.endsWith('t') || f === 'tris' ? (b / 1e6).toFixed(2) + 'M' : b.toFixed(0))} ${(a / b).toFixed(3)}`; });
  const extra = more.map((l) => `${l} mt ${(med(l, s, 'mt') / 1e6).toFixed(2)}M`).join(' ');
  console.log(`${s.padEnd(11)} ${parts.join(' | ')} ${extra}`);
}
console.log(`MOVING sums ${F.map((f) => `${f} ${(sums.n[f] / sums.d[f]).toFixed(3)}`).join(' | ')}`);
