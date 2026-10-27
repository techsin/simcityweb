// real load path: segment CPU split into render (world.update + objects.update + world.render + worker messages),
// the rest of the scene's frame callback, and main-thread work outside it; paired ratios per part.
//   node anaph.mjs <spec> [num csv] [den csv]
import { loadSpec, byRep, ratios, ratioLine, verdict } from './ana.mjs';
import { median } from './lib.mjs';
const [spec, numS = 'new,new2', denS = 'base,base2'] = process.argv.slice(2);
const num = numS.split(','), den = denS.split(',');
const recs = loadSpec(spec).filter((r) => Object.values(r.segs ?? {}).some((s) => s.ph));
console.log(`== ${spec}: ${recs.length} loads with the phase split; labels ${[...new Set(recs.map((r) => r.label))].sort().join(' ')}`);
const parts = {
  render: (s) => s.ph.wu + s.ph.ou + s.ph.wr + s.ph.wm,
  draw: (s) => s.ph.wr,
  loopRest: (s) => s.lcpu - (s.ph.wu + s.ph.ou + s.ph.wr),
  outside: (s) => s.cpu - s.lcpu - s.ph.wm,
  total: (s) => s.cpu,
};
for (const seg of Object.keys(recs[0]?.segs ?? {})) {
  for (const [p, f] of Object.entries(parts)) {
    const R = ratios(byRep(recs, (r) => (r.segs?.[seg]?.ph ? f(r.segs[seg]) : NaN)), num, den);
    const meds = [...new Set(recs.map((r) => r.label))].sort().map((l) => `${l} ${median(recs.filter((r) => r.label === l).map((r) => (r.segs?.[seg]?.ph ? f(r.segs[seg]) : NaN)).filter(Number.isFinite)).toFixed(0)}`).join(' ');
    console.log(ratioLine(`${seg}.${p}`, R, num[0], den[0]) + `  -> ${verdict(R)}  | ${meds}`);
  }
}
