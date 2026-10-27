// base calibration summary: V1 / candidate pooled moving CPU per warm run (tag) and the candidates against each other
import { readJsonl, mean, OUT } from './lib.mjs';
import { bootMed, fmt, above } from './ana.mjs';
import { resolve } from 'node:path';

const MOVING = ['zoomout', 'farorbit', 'zoomin', 'streetpan', 'streetfast', 'pan', 'fastpan', 'cuts', 'edgepan', 'edgefast', 'edgeturn'];
const files = ['WT_cal.jsonl', 'WT.jsonl', 'WK.jsonl', 'WS.jsonl', 'WM.jsonl'];
const recs = files.flatMap((f) => readJsonl(resolve(OUT, f)).filter((r) => !r.error && !r.final && r.row >= 1).map((r) => ({ ...r, file: f })));
const tags = [...new Set(recs.map((r) => r.tag))];
const side = (l) => l.replace(/2$/, '');
for (const tag of tags) {
  const R = recs.filter((r) => r.tag === tag);
  const sides = [...new Set(R.map((r) => r.side))];
  const labelsOf = (s) => [...new Set(R.filter((r) => r.side === s).map((r) => r.label))].sort();
  const rows = [...new Set(R.map((r) => r.row))];
  const segs = [...new Set(R.map((r) => r.seg))].filter((s) => MOVING.includes(s));
  const pooled = (s) => rows.map((r0) => {
    let t = 0;
    for (const sg of segs) { const v = labelsOf(s).map((l) => R.find((x) => x.row === r0 && x.seg === sg && x.label === l)?.cpu).filter(Number.isFinite); if (!v.length) return NaN; t += mean(v); }
    return t;
  });
  const P = Object.fromEntries(sides.map((s) => [s, pooled(s)]));
  const pairs = [];
  for (const a of ['v1', 'new']) for (const b of ['base', 'b48', 'hyb']) if (P[a] && P[b]) pairs.push([a, b]);
  if (P.base && P.b48) pairs.push(['base', 'b48']);
  if (P.hyb && P.b48) pairs.push(['hyb', 'b48']);
  if (P.hyb && P.base) pairs.push(['hyb', 'base']);
  const out = pairs.map(([a, b]) => { const rr = P[a].map((x, i) => x / P[b][i]).filter(Number.isFinite); return `${a}/${b} ${fmt(bootMed(rr))} (${above(rr)})`; });
  console.log(`${tag.padEnd(14)} ${R[0].scene ?? ''} ${R[0].q} rows ${rows.length} segs ${segs.length}: ${out.join('  ')}`);
}
