// top functions (by samples) inside given frames of a uiprof trace, outside the U (sim.update) region
import { readFileSync } from 'node:fs';
const T = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const P = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const which = (process.argv[4] ?? '7').split(',').map(Number);
const marks = T.events.filter((e) => e.cat === 'blink.user_timing' && /^[<>]/.test(e.name)).sort((a, b) => a.ts - b.ts);
const tid = marks[0].tid;
const ms = marks.filter((m) => m.tid === tid);
// frame windows and U / R windows
const frames = []; let cur = null;
for (const m of ms) {
  if (m.name === '>F') cur = { t0: m.ts, t1: 0, U: [], R: [] };
  else if (m.name === '<F' && cur) { cur.t1 = m.ts; frames.push(cur); cur = null; }
  else if (cur && m.name === '>U') cur.U.push([m.ts, 0]);
  else if (cur && m.name === '<U') cur.U[cur.U.length - 1][1] = m.ts;
  else if (cur && m.name.startsWith('>R:')) cur.R.push([m.ts, 0, m.name.slice(1)]);
  else if (cur && m.name.startsWith('<R:')) cur.R[cur.R.length - 1][1] = m.ts;
}
const byId = new Map(P.nodes.map((n) => [n.id, n]));
const parent = new Map(); for (const n of P.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
let t = P.startTime; const ts = P.timeDeltas.map((d) => (t += d));
for (const fi of which) {
  const f = frames[fi]; if (!f) continue;
  const cnt = new Map(), cntR = new Map(); let n = 0, nR = 0;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] < f.t0 || ts[i] > f.t1) continue;
    if (f.U.some(([a, b]) => ts[i] >= a && ts[i] <= b)) continue;
    const inR = f.R.find(([a, b]) => ts[i] >= a && ts[i] <= b);
    const nd = byId.get(P.samples[i]);
    // report leaf + 3 ancestors
    const chain = []; let id = P.samples[i];
    while (id !== undefined && chain.length < 4) { const x = byId.get(id); chain.push(`${x.callFrame.functionName || '(anon)'}@${x.callFrame.url.split('/').pop().split('?')[0]}:${x.callFrame.lineNumber + 1}`); id = parent.get(id); }
    const k = chain.join(' < ');
    const m = inR ? cntR : cnt;
    m.set(k, (m.get(k) ?? 0) + 1); inR ? nR++ : n++;
  }
  console.log(`frame ${fi}: ${((f.t1 - f.t0) / 1000).toFixed(0)} ms wall; samples outside sim.update: other ${n}, render ${nR}`);
  console.log(' other:'); for (const [k, v] of [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   ${v} ${k}`);
  console.log(' render:'); for (const [k, v] of [...cntR.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   ${v} ${k}`);
}
