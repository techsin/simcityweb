// warm-page tables: node anawarm.mjs <file.jsonl> <num labels csv> <den labels csv> [field] [tag filter] [skip rows]
// version mean per (row, seg) = mean over the version's browsers; ratio per (row, seg); pooled moving per row.
import { readJsonl, median, mean } from './lib.mjs';
import { bootMed, fmt, above } from './ana.mjs';

const [file, numS, denS, field = 'cpu', tagF = '', skipS = '0'] = process.argv.slice(2);
const num = numS.split(','), den = denS.split(',');
const skip = +skipS;
const MOVING = ['zoomout', 'farorbit', 'zoomin', 'streetpan', 'streetfast', 'pan', 'fastpan', 'cuts', 'edgepan', 'edgefast', 'edgeturn'];
const recs = readJsonl(file).filter((r) => !r.error && !r.final && (!tagF || r.tag === tagF) && r.row >= skip);
const qs = [...new Set(recs.map((r) => r.q))];
for (const q of qs) {
  const R = recs.filter((r) => r.q === q);
  const segs = [...new Set(R.map((r) => r.seg))];
  const rows = [...new Set(R.map((r) => r.row))].sort((a, b) => a - b);
  const val = (r0, s, l) => { const x = R.find((r) => r.row === r0 && r.seg === s && r.label === l); return x ? x[field] : NaN; };
  console.log(`== ${file.split('/').pop()} q=${q} field=${field} rows=${rows.length} num=${num} den=${den}`);
  const allRatios = [];
  for (const s of segs) {
    const rr = [], aaN = [], aaD = [], vn = [], vd = [];
    for (const r0 of rows) {
      const n = num.map((l) => val(r0, s, l)).filter(Number.isFinite), d = den.map((l) => val(r0, s, l)).filter(Number.isFinite);
      if (!n.length || !d.length) continue;
      rr.push(mean(n) / mean(d)); vn.push(mean(n)); vd.push(mean(d));
      if (num.length > 1) aaN.push(val(r0, s, num[1]) / val(r0, s, num[0]));
      if (den.length > 1) aaD.push(val(r0, s, den[1]) / val(r0, s, den[0]));
    }
    if (MOVING.includes(s)) allRatios.push(...rr);
    console.log(`${s.padEnd(11)} ${num[0]} ${median(vn).toFixed(1).padStart(7)}  ${den[0]} ${median(vd).toFixed(1).padStart(7)}  ratio ${fmt(bootMed(rr))} (${above(rr)})  A/A ${num[0]} ${median(aaN).toFixed(3)} ${den[0]} ${median(aaD).toFixed(3)}`);
  }
  // pooled moving per row
  const pooled = [], paN = [], paD = [];
  for (const r0 of rows) {
    let sn = 0, sd = 0, sn0 = 0, sn1 = 0, sd0 = 0, sd1 = 0, ok = true;
    for (const s of segs.filter((x) => MOVING.includes(x))) {
      const n = num.map((l) => val(r0, s, l)), d = den.map((l) => val(r0, s, l));
      if (![...n, ...d].every(Number.isFinite)) { ok = false; break; }
      sn += mean(n); sd += mean(d); sn0 += n[0]; sn1 += n[1] ?? n[0]; sd0 += d[0]; sd1 += d[1] ?? d[0];
    }
    if (!ok) continue;
    pooled.push(sn / sd); paN.push(sn1 / sn0); paD.push(sd1 / sd0);
  }
  console.log(`POOLED moving ${fmt(bootMed(pooled))} (${above(pooled)} rows)  A/A ${num[0]} ${fmt(bootMed(paN))}  ${den[0]} ${fmt(bootMed(paD))}  | (row,seg) ratios above 1: ${above(allRatios)}  load ${median(R.map((r) => r.la)).toFixed(1)}`);
}
