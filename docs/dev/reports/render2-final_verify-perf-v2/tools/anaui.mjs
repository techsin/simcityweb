// ui page fresh tables (uipage.mjs fresh): node anaui.mjs <spec> [num csv] [den csv] [refs csv]
import { median } from './lib.mjs';
import { loadSpec, byRep, ratios, ratioLine, verdict, fmt } from './ana.mjs';
const [spec, numS = 'new,new2', denS = 'base,base2', refS = ''] = process.argv.slice(2);
const num = numS.split(','), den = denS.split(','), refs = refS ? refS.split(',') : [];
const recs = loadSpec(spec);
const labels = [...new Set(recs.map((r) => r.label))].sort();
console.log(`== ${spec} (${recs[0]?.q}): ${recs.length} loads, labels ${labels.join(' ')}, reps ${new Set(recs.map((r) => r.rep)).size}, load ${median(recs.map((r) => r.load0?.[0])).toFixed(1)}-${median(recs.map((r) => r.load1?.[0])).toFixed(1)}`);
const segs = Object.keys(recs[0]?.segs ?? {});
const MOVING = ['zoomout', 'farorbit', 'zoomin', 'pan', 'fastpan', 'cuts'];
for (const s of segs) {
  const R = ratios(byRep(recs, (r) => r.segs?.[s]?.cpu ?? NaN), num, den);
  console.log(ratioLine(s, R, num[0], den[0]) + `  -> ${verdict(R)}`);
  for (const ref of refs) { const R2 = ratios(byRep(recs, (r) => r.segs?.[s]?.cpu ?? NaN), num, [ref]); console.log(`   vs ${ref}: pairs ${fmt(R2.P)} (${R2.pairs.filter((x) => x > 1).length}/${R2.pairs.length})`); }
  console.log(`   medians: ${labels.map((l) => `${l} ${median(recs.filter((r) => r.label === l).map((r) => r.segs?.[s]?.cpu ?? NaN).filter(Number.isFinite)).toFixed(0)}`).join(' ')} | >16.7: ${labels.map((l) => `${l} ${recs.filter((r) => r.label === l).reduce((a, r) => a + (r.segs?.[s]?.over16 ?? 0), 0)}`).join(' ')} | >33.3: ${labels.map((l) => `${l} ${recs.filter((r) => r.label === l).reduce((a, r) => a + (r.segs?.[s]?.over33 ?? 0), 0)}`).join(' ')}`);
}
const pooled = (r) => MOVING.reduce((a, s) => a + (r.segs?.[s]?.cpu ?? NaN), 0);
const RP = ratios(byRep(recs, pooled), num, den);
console.log(ratioLine('POOLED moving', RP, num[0], den[0]));
for (const ref of refs) { const R2 = ratios(byRep(recs, pooled), num, [ref]); console.log(`   vs ${ref}: pairs ${fmt(R2.P)}`); }
for (const l of labels) { const R = recs.filter((r) => r.label === l); console.log(`${l.padEnd(6)} ready ${(median(R.map((r) => r.readyMs)) / 1000).toFixed(1)} s, load main CPU ${(median(R.map((r) => r.loadCpu?.main)) / 1000).toFixed(2)} s`); }
