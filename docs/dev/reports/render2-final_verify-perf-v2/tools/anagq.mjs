// GPU stand-in along sequences (warm4 'gpuseq' rows): node anagq.mjs <file> <num csv> <den csv> [tag]
// per (row, seq, browser): sum of the GPU-process CPU over the sampled drawn frames; version mean over browsers; ratio per
// (row, seq); pooled per row over the sequences; A/A between a version's browsers; main-pass triangles / calls of the
// sampled frames (deterministic: medians).
import { readJsonl, median, mean } from './lib.mjs';
import { bootMed, fmt, above } from './ana.mjs';
const [file, numS, denS, tagF = ''] = process.argv.slice(2);
const num = numS.split(','), den = denS.split(',');
const recs = readJsonl(file).filter((r) => r.mode === 'gpuseq' && r.fr && (!tagF || r.tag === tagF));
for (const tag of [...new Set(recs.map((r) => r.tag))]) {
  const R = recs.filter((r) => r.tag === tag);
  const seqs = [...new Set(R.map((r) => r.seg))];
  const rows = [...new Set(R.map((r) => r.row))].sort((a, b) => a - b);
  const get = (r0, s, l) => R.find((x) => x.row === r0 && x.seg === s && x.label === l);
  const sum = (x, f) => x.fr.reduce((a, b) => a + b[f], 0);
  console.log(`== ${tag} (${R[0].q}) rows ${rows.length}: ${num} vs ${den}`);
  const perRowN = new Map(), perRowD = new Map(), aa = [];
  for (const s of seqs) {
    const rr = [], an = [], ad = [];
    for (const r0 of rows) {
      const n = num.map((l) => get(r0, s, l)).filter(Boolean).map((x) => sum(x, 'gpu')), d = den.map((l) => get(r0, s, l)).filter(Boolean).map((x) => sum(x, 'gpu'));
      if (!n.length || !d.length) continue;
      rr.push(mean(n) / mean(d));
      if (n.length > 1) an.push(n[1] / n[0]);
      if (d.length > 1) ad.push(d[1] / d[0]);
      perRowN.set(r0, (perRowN.get(r0) ?? 0) + mean(n)); perRowD.set(r0, (perRowD.get(r0) ?? 0) + mean(d));
    }
    aa.push(...an, ...ad);
    const tri = (labs, f) => median(R.filter((x) => x.seg === s && labs.includes(x.label)).map((x) => sum(x, f)));
    const mtN = tri(num, 'mt'), mtD = tri(den, 'mt'), tN = tri(num, 'tris'), tD = tri(den, 'tris'), cN = tri(num, 'calls'), cD = tri(den, 'calls');
    console.log(`${s.padEnd(9)} gpu ${fmt(bootMed(rr))} (${above(rr)})  A/A |log| ${median([...an, ...ad].map((x) => Math.abs(Math.log(x)))).toFixed(3)}  ${num[0]} ${median(R.filter((x) => x.seg === s && num.includes(x.label)).map((x) => sum(x, 'gpu'))).toFixed(0)} ms  ${den[0]} ${median(R.filter((x) => x.seg === s && den.includes(x.label)).map((x) => sum(x, 'gpu'))).toFixed(0)} ms | sampled frames ${R.find((x) => x.seg === s).fr.length}: main tris ${(mtN / 1e6).toFixed(2)}M vs ${(mtD / 1e6).toFixed(2)}M (${(mtN / mtD).toFixed(3)}), all tris ${(tN / mtD * mtD / 1e6).toFixed(2)}M vs ${(tD / 1e6).toFixed(2)}M (${(tN / tD).toFixed(3)}), calls ${cN} vs ${cD}`);
  }
  const pooled = rows.filter((r0) => perRowN.has(r0)).map((r0) => perRowN.get(r0) / perRowD.get(r0));
  console.log(`POOLED seq gpu ${fmt(bootMed(pooled))} (${above(pooled)})  A/A |log| median ${median(aa.map((x) => Math.abs(Math.log(x)))).toFixed(3)}  load ${median(R.map((r) => r.la)).toFixed(1)}`);
}
