// real-load-path tables: node anagame.mjs <spec> [num csv] [den csv] [refs csv]
// frames: per-frame main-thread CPU for frames 1..K after viewsReady (frame 1 = the city's first WorldView frame)
import { median } from './lib.mjs';
import { loadSpec, byRep, ratios, ratioLine, verdict, bootMed, fmt, segVal } from './ana.mjs';

const [spec, numS = 'new,new2', denS = 'base,base2', refS = 'c024'] = process.argv.slice(2);
const num = numS.split(','), den = denS.split(','), refs = refS ? refS.split(',') : [];
const recs = loadSpec(spec);
const labels = [...new Set(recs.map((r) => r.label))].sort();
console.log(`== ${spec}: ${recs.length} loads, labels ${labels.join(' ')}, reps ${new Set(recs.map((r) => r.rep)).size}, load ${median(recs.map((r) => r.load0?.[0])).toFixed(1)}-${median(recs.map((r) => r.load1?.[0])).toFixed(1)}`);
const K = Math.min(...recs.map((r) => r.frames?.length ?? 0));
console.log(`per-frame main-thread CPU (ms), median [90% CI] over loads; K=${K}`);
const show = [1, 2, 3, 4, 5, 6, 8, 10];
for (const l of labels) {
  const R = recs.filter((r) => r.label === l);
  const parts = show.filter((f) => f <= K).map((f) => `f${f} ${fmt(bootMed(R.map((r) => r.frames[f - 1])))}`);
  const o16 = R.map((r) => r.frames.slice(0, 30).filter((x) => x > 16.7).length), o33 = R.map((r) => r.frames.slice(0, 30).filter((x) => x > 33.3).length);
  const o16b = R.map((r) => r.frames.slice(2, 30).filter((x) => x > 16.7).length);
  const sum130 = R.map((r) => r.frames.slice(0, 30).reduce((a, b) => a + b, 0));
  const sum330 = R.map((r) => r.frames.slice(2, 30).reduce((a, b) => a + b, 0));
  console.log(`${l.padEnd(6)} n=${R.length} ${parts.join('  ')}`);
  console.log(`       frames>16.7 in 1-30 per load: ${o16.join(',')} (median ${median(o16)}); >33.3: ${o33.join(',')}; >16.7 in 3-30: ${o16b.join(',')}; sum 1-30 ${median(sum130).toFixed(0)} ms; sum 3-30 ${median(sum330).toFixed(0)} ms; veilFrame ${median(R.map((r) => r.veilFrame))}`);
  const ip = R.map((r) => r.inpage?.[1]).filter(Boolean);
  if (ip.length) console.log(`       frame 2 in-page: world.update ${median(ip.map((x) => x.wu)).toFixed(1)} objects.update ${median(ip.map((x) => x.ou)).toFixed(1)} world.render ${median(ip.map((x) => x.wr)).toFixed(1)} sim ${median(ip.map((x) => x.su)).toFixed(2)}`);
  const ip1 = R.map((r) => r.inpage?.[0]).filter(Boolean);
  if (ip1.length) console.log(`       frame 1 in-page: world.update ${median(ip1.map((x) => x.wu)).toFixed(1)} objects.update ${median(ip1.map((x) => x.ou)).toFixed(1)} world.render ${median(ip1.map((x) => x.wr)).toFixed(1)}; load CPU ${median(R.map((r) => r.loadCpu?.main)).toFixed(0)} ms; click->frames ${median(R.map((r) => r.clickToFramesMs)).toFixed(0)} ms; heap ${(median(R.map((r) => r.heap)) / 1e6).toFixed(1)} MB`);
}
// long frames 2..30 with attribution (phase CPU: lp = the scene's frame callback, wm = worker messages, rest = other
// main-thread work in the frame interval: GC, timers, DOM lifecycle)
console.log('frames 2-30 over 16.7 / 33.3 ms per load, and their parts (lp / wm / other, ms):');
for (const l of labels) {
  const R = recs.filter((r) => r.label === l);
  const lines = R.map((r) => {
    const out = [];
    for (let k = 1; k < 30; k++) {
      const c = r.frames[k];
      if (!(c > 16.7)) continue;
      const p = r.phase?.[k];
      out.push(`f${k + 1} ${c.toFixed(0)}` + (p ? ` (${p.lp.toFixed(0)}/${(p.wm ?? 0).toFixed(0)}/${(c - p.lp - (p.wm ?? 0)).toFixed(0)})` : ''));
    }
    return `r${r.rep}: ${out.join(' ') || '-'}`;
  });
  const n16 = R.map((r) => r.frames.slice(1, 30).filter((x) => x > 16.7).length), n33 = R.map((r) => r.frames.slice(1, 30).filter((x) => x > 33.3).length);
  console.log(`${l.padEnd(6)} >16.7: ${n16.join(',')} (sum ${n16.reduce((a, b) => a + b, 0)}/${R.length} loads)  >33.3: ${n33.join(',')} (sum ${n33.reduce((a, b) => a + b, 0)})  max f2-30 median ${median(R.map((r) => Math.max(...r.frames.slice(1, 30)))).toFixed(0)} ms`);
  console.log(`       ${lines.join(' | ')}`);
}
// first motions
const segs = [...new Set(recs.flatMap((r) => Object.keys(r.segs ?? {})))];
console.log('first motions after the load (main-thread CPU per segment):');
for (const s of segs) {
  const reps = byRep(recs, (r) => segVal(r, s));
  const R = ratios(reps, num, den);
  console.log(ratioLine(s, R, num[0], den[0]) + `  -> ${verdict(R)}`);
  for (const ref of refs) { const R2 = ratios(reps, num, [ref]); console.log(`   vs ${ref}: pairs ${fmt(R2.P)}`); }
  const repsR = byRep(recs, (r) => r.segs?.[s]?.rcpu ?? NaN);
  const RR = ratios(repsR, num, den);
  if (RR.pairs.length) console.log('   render-only ' + ratioLine(s, RR, num[0], den[0]).trim() + `  -> ${verdict(RR)}`);
  const lf = (l) => recs.filter((r) => r.label === l).map((r) => r.segs?.[s]?.over16 ?? NaN);
  console.log(`   frames>16.7 per load: ${labels.map((l) => `${l} ${lf(l).join(',')}`).join(' | ')}`);
}
