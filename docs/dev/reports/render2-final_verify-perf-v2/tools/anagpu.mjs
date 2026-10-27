// GPU stand-in tables (warm.mjs gpu mode): node anagpu.mjs <file> <num csv> <den csv> [stat min|med]
// per (row, view, browser): the median (or min) GPU-process CPU of its K drawn frames; version mean over browsers;
// ratio per (row, view); pooled per row over views; A/A between a version's browsers. Triangles / calls per view too.
import { readJsonl, median, mean } from './lib.mjs';
import { bootMed, fmt, above } from './ana.mjs';

const [file, numS, denS, stat = 'med'] = process.argv.slice(2);
const num = numS.split(','), den = denS.split(',');
const recs = readJsonl(file).filter((r) => r.mode === 'gpu' && r.fr);
const agg = (fr) => (stat === 'min' ? Math.min(...fr.map((f) => f.gpu)) : median(fr.map((f) => f.gpu)));
for (const q of [...new Set(recs.map((r) => r.q))]) {
  const R = recs.filter((r) => r.q === q);
  const views = [...new Set(R.map((r) => r.seg))];
  const rows = [...new Set(R.map((r) => r.row))].sort((a, b) => a - b);
  const get = (r0, v, l) => R.find((x) => x.row === r0 && x.seg === v && x.label === l);
  console.log(`== ${file.split('/').pop()} q=${q} rows=${rows.length} stat=${stat}  ${num} vs ${den}`);
  const pooled = [], aaN = [], aaD = [];
  const perRowN = new Map(), perRowD = new Map();
  for (const v of views) {
    const rr = [], an = [], ad = [];
    for (const r0 of rows) {
      const n = num.map((l) => get(r0, v, l)).filter(Boolean).map((x) => agg(x.fr)), d = den.map((l) => get(r0, v, l)).filter(Boolean).map((x) => agg(x.fr));
      if (!n.length || !d.length) continue;
      rr.push(mean(n) / mean(d));
      if (n.length > 1) an.push(n[1] / n[0]);
      if (d.length > 1) ad.push(d[1] / d[0]);
      perRowN.set(r0, (perRowN.get(r0) ?? 0) + mean(n)); perRowD.set(r0, (perRowD.get(r0) ?? 0) + mean(d));
    }
    aaN.push(...an); aaD.push(...ad);
    const one = (l) => R.find((x) => x.seg === v && x.label === l)?.fr?.[0];
    const fn = one(num[0]), fd = one(den[0]);
    const tri = fn && fd ? `main tris ${(fn.mt / 1e6).toFixed(3)}M vs ${(fd.mt / 1e6).toFixed(3)}M (${(fn.mt / fd.mt).toFixed(3)}), total ${(fn.tris / 1e6).toFixed(3)}M vs ${(fd.tris / 1e6).toFixed(3)}M (${(fn.tris / fd.tris).toFixed(3)}), calls ${fn.calls} vs ${fd.calls}, shadow tris ${(fn.st / 1e6).toFixed(3)}M vs ${(fd.st / 1e6).toFixed(3)}M` : '';
    console.log(`${v.padEnd(8)} gpu ${fmt(bootMed(rr))} (${above(rr)})  A/A |log| ${median([...an, ...ad].map((x) => Math.abs(Math.log(x)))).toFixed(3)}  ${num[0]} ${median(rows.map((r0) => get(r0, v, num[0])).filter(Boolean).map((x) => agg(x.fr))).toFixed(0)} ms  ${den[0]} ${median(rows.map((r0) => get(r0, v, den[0])).filter(Boolean).map((x) => agg(x.fr))).toFixed(0)} ms | ${tri}`);
  }
  for (const r0 of rows) if (perRowN.has(r0)) pooled.push(perRowN.get(r0) / perRowD.get(r0));
  console.log(`POOLED gpu ${fmt(bootMed(pooled))}  A/A ${num[0]} ${median(aaN).toFixed(3)} ${den[0]} ${median(aaD).toFixed(3)}  load ${median(R.map((r) => r.la)).toFixed(1)}`);
}
