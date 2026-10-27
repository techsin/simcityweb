// run a fresh-page spec: reps x labels (rotated each rep), one fresh browser per run, strictly sequential; resumable
// (a tag already in the out file is skipped).
//   node chain.mjs <spec name> <reps> <driver: fresh|game> <label:side,...> -- <driver args after side>
// driver args use {out} and {tag}: e.g.  -- town low {out} {tag} street,zoomout,...
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readJsonl, OUT, TOOLS, loadavg, oom } from './lib.mjs';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const [spec, repsS, driver, labelCsv] = argv.slice(0, sep);
const dargs = argv.slice(sep + 1);
const reps = +repsS;
const labels = labelCsv.split(',').map((s) => { const [l, side] = s.split(':'); return { l, side }; });
const out = resolve(OUT, `${spec}.jsonl`);
const done = new Set(readJsonl(out).filter((r) => !r.error).map((r) => r.tag));
oom(process.pid);
const t0 = Date.now();
for (let r = 0; r < reps; r++) {
  const order = labels.map((_, i) => labels[(i + r) % labels.length]);
  for (const L of order) {
    const tag = `${spec}_r${r}_${L.l}`;
    if (done.has(tag)) continue;
    const hasSide = dargs.some((a) => a.includes('{side}'));
    const args = dargs.map((a) => a.replace('{out}', out).replace('{tag}', tag).replace('{side}', L.side));
    if (!hasSide) args.unshift(L.side);
    const t1 = Date.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = spawnSync('node', [resolve(TOOLS, `${driver}.mjs`), ...args], { encoding: 'utf8', timeout: 1800000 });
      const line = (res.stdout || '').trim().split('\n').pop();
      console.log(`[chain ${spec}] r${r} ${L.l} (${L.side}) ${((Date.now() - t1) / 1000).toFixed(0)} s load ${loadavg()[0]} :: ${line?.slice(0, 300)}`);
      if (res.status === 0 && !/"err":"/.test(line || '')) break;
      console.log(`[chain ${spec}] retry ${tag}: ${(res.stderr || '').slice(-400)}`);
    }
  }
}
console.log(`[chain ${spec}] done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
