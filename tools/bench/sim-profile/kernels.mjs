#!/usr/bin/env node
/**
 * Group the CPU-weighted profile (analyze.mjs --json) into candidate KERNELS.
 *   node src/kernels.mjs prof/dense_frames.analysis.json --days 90 [--harness prof/dense_framesP.json]
 * Each (region, function) self-cost goes to the kernel its function matches (pure numeric kernels first); unmatched
 * functions fall back to the kernel of their region (system / scheduler step), so helpers (infoOf, buildingList ...)
 * are charged to the work that called them. GC is its own row.
 */
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const A = JSON.parse(readFileSync(args[0], 'utf8'));
const DAYS = +opt('days', 90);
const H = opt('harness') ? JSON.parse(readFileSync(opt('harness'), 'utf8')) : null;

// function-name patterns -> kernel (checked in order; first match wins)
const FN = [
  ['K1 road/transit Dijkstra (+Dial queue, accumulate)', /^(roadSearch|transitSearch|accumulate|push|reset|ensure|pop|topKey) infra\/(search|heap)\.ts|^(roadTimeMulti|reachRaw|reachResult|walkReach|driveReach|euclidReach) infra\/catchments|^(respSearch|railBfs|findPath|tracePath) infra\//],
  ['K4 blur / diffusion passes', /^(boxH|boxV|blur3|blurDown|upsampleAdd|upTables|axisTable|blurInto|blur) infra\/blur\.ts|^smoothStep infra\/crime|^saturate infra\/pollution|^(chamfer|box3) infra\/services/],
  ['K6 desirability + land-value per-cell bands', /^band economy\/(desirability|landValue)\.ts|^(lvEffectAt|computeFreightAccess) economy\/|^smoothstep\$?\d* src\/core\/rng|^cellSlope/],
  ['K5 NIMBY / pollution / noise splats', /^(rebuildNimby|splatAdd|kernelOf) infra\/nimby|^(stageA|stageCells|stageAirNear|stageAir|stageNoise|stageB|intensityToSource|sourceRadius) infra\/pollution|^(splat\$?\d*) economy\/tourism/],
];
// region label -> kernel
const REG = [
  [/^task:traffic:(roundSearch|shop|inbound|freight)$/, 'K1 road/transit Dijkstra (+Dial queue, accumulate)'],
  [/^task:traffic:/, 'K2 traffic assignment / matching / route accumulation'],
  [/^task:services:(tiers|foot|stops|finish|prep)$/, 'K3 catchments / seat filling (services tier engine)'],
  [/^task:services:(accSeed|accSearch|accLand|shopA|shopB)$/, 'K3b services access / shop land rasters'],
  [/^task:services:nimby$/, 'K5 NIMBY / pollution / noise splats'],
  [/^task:pollution:garb/, 'K5b garbage sources / routes / piles'],
  [/^task:pollution:/, 'K5 NIMBY / pollution / noise splats'],
  [/^task:utilities:/, 'K8 utilities: grid labels (flood fill) + supply/demand sums'],
  [/^task:crime:/, 'K11 crime sources / spread / flags'],
  [/^task:emergency\.response/, 'K9 emergency response searches + dispatch'],
  [/^emergency\.(daily|monthly)$/, 'K9 emergency response searches + dispatch'],
  [/^economy\.population\.(daily|monthly)$/, 'K10 population / demographics per-building updates'],
  [/^economy\.desirability/, 'K6 desirability + land-value per-cell bands'],
  [/^economy\.landValue/, 'K6 desirability + land-value per-cell bands'],
  [/^economy\.growth/, 'K7 growth candidate scans / redevelopment'],
  [/^fire\./, 'K12 fire ignition scan'],
  [/^economy\.(tourism|advisors|budget|approval|history|rewards|demand)\./, 'K13 monthly economy (tourism, advisors, budget, approval) + demand'],
  [/^(justice|disasters|crime|pollution|services|traffic|utilities)\./, 'K14 scheduler / system glue'],
  [/^\(gap\)$/, 'K15 harness + Simulation glue'],
];
const kernels = new Map();
const add = (k, f, v) => { let e = kernels.get(k); if (!e) kernels.set(k, (e = { ms: 0, fns: new Map() })); e.ms += v; e.fns.set(f, (e.fns.get(f) ?? 0) + v); };
let total = 0;
for (const [region, fns] of Object.entries(A.byRegion)) {
  for (const [f, v] of Object.entries(fns)) {
    total += v;
    const short = f.replace(/ src\/sim\//, ' ');
    if (/^\(garbage collector\)/.test(f)) { add('GC (main-thread scavenges / incremental marking)', region, v); continue; }
    let k = null;
    for (const [name, re] of FN) if (re.test(short)) { k = name; break; }
    if (!k) for (const [re, name] of REG) if (re.test(region)) { k = name; break; }
    add(k ?? `other (${region})`, short, v);
  }
}
// unsampled regions (their CPU is known, no samples): charge them by label
for (const [f, v] of Object.entries(A.self)) if (f.startsWith('(unsampled) ')) {
  const region = f.slice(12);
  total += v;
  let k = null;
  for (const [re, name] of REG) if (re.test(region)) { k = name; break; }
  add(k ?? `other (${region})`, f, v);
}
const rows = [...kernels.entries()].sort((a, b) => b[1].ms - a[1].ms);
console.log(`total ${total.toFixed(0)} cpu ms over ${DAYS} days = ${(total / DAYS).toFixed(2)} ms/day`);
for (const [k, e] of rows) {
  const top = [...e.fns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, v]) => `${f} ${(v / e.ms * 100).toFixed(0)}%`).join(' | ');
  console.log(`${(e.ms / total * 100).toFixed(1).padStart(5)}% ${(e.ms / DAYS).toFixed(2).padStart(6)} ms/day  ${k}\n        ${top}`);
}
