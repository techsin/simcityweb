// fresh bench-page tables: node anafresh.mjs <spec> [num csv] [den csv] [refs csv] [field]
import { median } from './lib.mjs';
import { loadSpec, byRep, ratios, ratioLine, verdict, bootMed, fmt, segVal } from './ana.mjs';

const [spec, numS = 'new,new2', denS = 'base,base2', refS = '', field = 'cpu'] = process.argv.slice(2);
const num = numS.split(','), den = denS.split(','), refs = refS ? refS.split(',') : [];
const recs = loadSpec(spec);
const labels = [...new Set(recs.map((r) => r.label))].sort();
const reps = new Set(recs.map((r) => r.rep)).size;
console.log(`== ${spec} (${recs[0]?.scene} ${recs[0]?.q}): ${recs.length} runs, labels ${labels.join(' ')}, reps ${reps}, load ${median(recs.map((r) => r.load0?.[0])).toFixed(1)} (start) ${median(recs.map((r) => r.load1?.[0])).toFixed(1)} (end); field ${field}`);
const segs = [...new Set(recs.flatMap((r) => (r.segs ?? []).map((s) => s.name + (s.pass > 1 ? '@' + s.pass : ''))))];
const MOVING = ['zoomout', 'farorbit', 'zoomin', 'streetpan', 'streetfast', 'pan', 'fastpan', 'cuts'];
for (const s of segs) {
  const R = ratios(byRep(recs, (r) => segVal(r, s, field)), num, den);
  console.log(ratioLine(s, R, num[0], den[0]) + `  -> ${verdict(R)}`);
  const meds = labels.map((l) => `${l} ${median(recs.filter((r) => r.label === l).map((r) => segVal(r, s, field))).toFixed(1)}`).join(' ');
  const o16 = labels.map((l) => `${l} ${recs.filter((r) => r.label === l).map((r) => segVal(r, s, 'over16')).reduce((a, b) => a + (b || 0), 0)}`).join(' ');
  const o33 = labels.map((l) => `${l} ${recs.filter((r) => r.label === l).map((r) => segVal(r, s, 'over33')).reduce((a, b) => a + (b || 0), 0)}`).join(' ');
  console.log(`   medians: ${meds} | frames>16.7 total: ${o16} | >33.3: ${o33}`);
  for (const ref of refs) { const R2 = ratios(byRep(recs, (r) => segVal(r, s, field)), num, [ref]); console.log(`   vs ${ref}: pairs ${fmt(R2.P)} (${R2.pairs.filter((x) => x > 1).length}/${R2.pairs.length})`); }
}
// pooled moving (pass 1)
const pooled = (r) => MOVING.reduce((a, s) => a + segVal(r, s, field), 0);
const RP = ratios(byRep(recs, pooled), num, den);
console.log(ratioLine('POOLED moving p1', RP, num[0], den[0]));
for (const ref of refs) { const R2 = ratios(byRep(recs, pooled), num, [ref]); console.log(`   vs ${ref}: pairs ${fmt(R2.P)}`); }
// load + first frames
for (const l of labels) {
  const R = recs.filter((r) => r.label === l);
  const v = R.map((r) => r.veilCpu ?? []);
  const o16 = v.map((x) => x.filter((y) => y > 16.7).length), o33 = v.map((x) => x.filter((y) => y > 33.3).length);
  console.log(`${l.padEnd(6)} ready ${(median(R.map((r) => r.readyMs)) / 1000).toFixed(2)} s, load main CPU ${(median(R.map((r) => r.loadCpu?.main)) / 1000).toFixed(2)} s, first frame CPU ${median(R.map((r) => r.firstCpu)).toFixed(0)} ms (js ${median(R.map((r) => r.load?.first?.js)).toFixed(0)}), veil frames>16.7 ${o16.join(',')} >33.3 ${o33.join(',')}, veil f2 ${fmt(bootMed(v.map((x) => x[0])))}, heap after GC ${(median(R.map((r) => r.heapGC)) / 1e6).toFixed(1)} MB, programs ${median(R.map((r) => r.stats?.programs))}`);
}
