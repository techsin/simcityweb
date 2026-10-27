#!/usr/bin/env node
/**
 * Build tools/bench/baselines/pi1-<sha>.json from the raw PI-1 output of run_pi1.sh (default tools/bench/.fixtures/pi1).
 *   node tools/bench/baselines/pi1Summary.mjs [rawDir] [--sha 614609f]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { cpus, totalmem, platform, release } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const argv = process.argv.slice(2);
const raw = argv[0] && !argv[0].startsWith('--') ? argv[0] : join(root, 'tools/bench/.fixtures/pi1');
const sha = argv.includes('--sha') ? argv[argv.indexOf('--sha') + 1] : execSync('git rev-parse --short=7 HEAD', { cwd: root }).toString().trim();
const J = (f) => JSON.parse(readFileSync(join(raw, f), 'utf8'));
const r2 = (x) => Math.round(x * 100) / 100;
const med = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };

const FIX = {
  liveDense: { file: 'tools/bench/.fixtures/live/dense1m_s7.metropolis', built: 'dense1m.ts on this tree: target 1,150,000, 120 warm days, seed 7' },
  liveBot: { file: 'tools/bench/.fixtures/live/bot256_s7_y60.metropolis', built: 'botgrow.ts on this tree: 256 map, seed 7, 60 years' },
  snapDense: { file: 'tools/bench/.fixtures/fixtures/dense1m_s7.metropolis', built: 'npm run fixtures (24f8609 snap), the plan §2 city' },
  stress: { file: 'tools/bench/.fixtures/fixtures/stress1m_testdefs_s7.metropolis', built: 'npm run fixtures (24f8609 snap), test defs' },
};

const nodeDay = {};
for (const f of readdirSync(raw).filter((f) => /^day_.*\.json$/.test(f))) {
  const j = J(f), [, label, mode] = f.replace('.json', '').split('_');
  (nodeDay[label] ??= {})[mode] = {
    msPerDay: j.msPerDay.median, ci95: j.msPerDay.ci95, chunkDays: j.chunk, reps: j.reps, timedDays: j.timedDays,
    tickErrorPct: j.tickErrorPct, aa: j.aa, deterministic: j.deterministic, protectorIntact: j.protectorIntact,
    wallOverCpu: r2(j.armA.medianWallMsPerDay / j.armA.medianMsPerDay), population: j.info0.population,
  };
}

const prof = {};
for (const L of ['liveDense', 'liveBot']) {
  const p = (m) => join('prof', `${L}_${m}.json`);
  const xs = [1, 2, 3].map((r) => p(`framesX${r}`)).filter((f) => existsSync(join(raw, f))).map(J);
  const fr = J(p('frames')), cyc = J(p('cycles')), gc = J(p('gcnvp'));
  prof[L] = {
    clock: 'wall (threadCpuUsage shim), main thread, idle machine',
    ultraFrames: {
      runs: 1 + xs.length,
      simMsPerDay: [fr, ...xs].map((x) => x.cpuPerDay),
      systemsMsPerDay: fr.systemsExclCpuPerDay, schedulerMsPerDay: fr.schedulerCpuPerDay,
      frameP50: med([fr, ...xs].map((x) => x.frames.p50)), frameP99: med([fr, ...xs].map((x) => x.frames.p99)), frameMax: med([fr, ...xs].map((x) => x.frames.max)),
      emulatedDaysPerS: fr.frames.daysPerSec, trafficCyclesPer90Days: fr.trafficCycles, monthFrameMax: fr.frames.withMonth.max,
    },
    headlessMsPerDay: J(p('headless')).cpuPerDay, designCadenceMsPerDay: J(p('flush')).cpuPerDay,
    passesMedianMs: Object.fromEntries(Object.entries(cyc.passes).map(([k, v]) => [k, v.medianCpuMs])),
    gc: gc.gc,
  };
}

const browser = {};
for (const L of ['liveDense', 'liveBot']) {
  const b = J(`browser_${L}.json`), d = existsSync(join(raw, `browser_${L}_defaultPolicy.json`)) ? J(`browser_${L}_defaultPolicy.json`) : null;
  browser[L] = {
    clock: 'performance.now in the page, headless, real GPU', emergencyUncovered: b.emergencyUncovered, runs: b.runs, days: b.days,
    median: b.median,
    perRun: b.runsDetail.map((r) => ({ daysPerS: r.daysPerS, busyP50: r.busy.p50, busyP99: r.busy.p99, busyMax: r.busy.max, longTasks: r.longTasks.n, longTaskMax: r.longTasks.max })),
    defaultPolicyDaysPerS: d ? d.runsDetail.map((r) => r.daysPerS) : null,
  };
}

const out = {
  sha, date: new Date().toISOString().slice(0, 10),
  env: {
    cpu: cpus()[0].model.trim(), threads: cpus().length, memGB: Math.round(totalmem() / 2 ** 30), os: `${platform()} ${release()}`, node: process.version,
    browser: J('browser_liveDense.json').browser, renderer: J('browser_liveDense.json').renderer,
    clocks: 'node headline: process.cpuUsage (ticks 15.6 ms on Windows; chunks >= 1.17 s); profile.js: threadCpuUsage shimmed to hrtime (tools/bench/baselines/threadCpuShim.mjs); browser: performance.now',
    quiet: 'nothing else heavy running during the node headline runs (Codex lanes idle); load average n/a on Windows',
  },
  fixtures: Object.fromEntries(Object.entries(FIX).map(([k, v]) => [k, { ...v, residents: nodeDay[k]?.design?.population ?? nodeDay[k]?.headless?.population }])),
  nodeHeadline: nodeDay,
  nodeProfile: prof,
  browser,
};
const file = join(here, `pi1-${sha}.json`);
writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${file}`);
