// real load path: the scene's frame callback CPU (lcpu: render + the game loop's own logic; no timers / audio / DOM
// lifecycle / GC outside it) per segment, paired ratios.  node analp.mjs <spec> [num csv] [den csv] [ref]
import { loadSpec, byRep, ratios, ratioLine, verdict, fmt } from './ana.mjs';
import { median } from './lib.mjs';
const [spec, numS = 'new,new2', denS = 'base,base2', ref = 'c024'] = process.argv.slice(2);
const num = numS.split(','), den = denS.split(',');
const recs = loadSpec(spec);
console.log(`== ${spec}: ${recs.length} loads, reps ${new Set(recs.map((r) => r.rep)).size}; field lcpu (scene frame callback) and cpu (whole main thread)`);
for (const seg of Object.keys(recs[0]?.segs ?? {})) {
  for (const f of ['lcpu', 'cpu']) {
    const reps = byRep(recs, (r) => r.segs?.[seg]?.[f] ?? NaN);
    const R = ratios(reps, num, den);
    const R2 = ratios(reps, num, [ref]);
    const meds = [...new Set(recs.map((r) => r.label))].sort().map((l) => `${l} ${median(recs.filter((r) => r.label === l).map((r) => r.segs?.[seg]?.[f] ?? NaN).filter(Number.isFinite)).toFixed(0)}`).join(' ');
    console.log(ratioLine(`${seg}.${f}`, R, num[0], den[0]) + `  -> ${verdict(R)} | vs ${ref} ${fmt(R2.P)} | ${meds}`);
  }
}
