#!/usr/bin/env node
/**
 * trafficCore benchmarks and checks: original JS (the tree's traffic.ts) vs the fair optimised-JS core
 * (src/wasm/js/trafficCore.ts) vs the wasm core (wasm/sim-kernels/src/traffic.rs via src/wasm/kernels/trafficBind.ts;
 * SIMD = the shipped binary, scalar = the same Rust without simd128, imp = exp / log imported from JS).
 *
 *   node tools/bench/trafficCore.bench.mjs <suite> [--tree snap|live|DIR] [--fixture dense1m|bot256|stress1m|stress256]
 *        [--fixtures DIR] [--json out.json] [suite options]
 *
 * suites
 *   verify   step-by-step equivalence (orig vs fair vs wasm after every traffic step), --cycles N
 *   (more suites: see the usage printed without arguments)
 *
 * --tree: the simulation sources the benchmark runs on: `snap` (default) = the frozen tree of commit 24f8609 ($SIM_SNAP,
 * default the profiler's snapshot; the version traffic.rs was ported from and the 1M fixtures were saved with), `live`
 * = this repo (only meaningful once src/sim/infra/traffic.ts is back at the 24f8609 phase structure), or a directory.
 * Bundles go to node_modules/.cache/sim-bench/trafficCore/. Protocol: tools/bench/ab.ts (warm-up, >= 31 interleaved
 * order-alternated pairs, CPU time from an idle worker thread, median / min, 95% bootstrap CI, load average).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treePlugins } from './trafficCore/plugins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = join(ROOT, 'tools', 'bench', 'trafficCore');
const CACHE = join(ROOT, 'node_modules', '.cache', 'sim-bench', 'trafficCore');
export const DEFAULT_SNAP = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/profile/snap';
mkdirSync(CACHE, { recursive: true });

const argv = process.argv.slice(2);
const suite = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
const rest = argv[0] === suite ? argv.slice(1) : argv;
const opt = (k, d) => (rest.indexOf(k) >= 0 ? rest[rest.indexOf(k) + 1] : d);
const treeArg = opt('--tree', 'snap');
const tree = treeArg === 'live' ? ROOT : treeArg === 'snap' ? process.env.SIM_SNAP ?? DEFAULT_SNAP : resolve(treeArg);
const treeTag = treeArg === 'live' ? 'live' : treeArg === 'snap' ? 'snap' : 'tree';

export async function bundle(entry, platform = 'node') {
  const { rolldown } = await import('rolldown');
  const out = join(CACHE, `${entry.replace(/\.ts$/, '')}.${treeTag}.${platform === 'node' ? 'mjs' : 'js'}`);
  const b = await rolldown({ input: join(HERE, entry), platform, logLevel: 'silent', plugins: treePlugins({ tree }) });
  await b.write({ format: 'esm', file: out });
  await b.close();
  return out;
}

export function runNode(file, args, label, env = {}) {
  const json = opt('--json') ?? join(CACHE, `${label}.${treeTag}.${opt('--fixture', 'default')}.json`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--max-old-space-size=8192', file, ...args, '--json', json], { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
  console.log(`# ${label}: ${((Date.now() - t0) / 1000).toFixed(0)} s wall -> ${json}`);
  return existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : null;
}

const passArgs = rest.filter((a, i) => a !== '--tree' && rest[i - 1] !== '--tree' && a !== '--json' && rest[i - 1] !== '--json');

async function main() {
  if (!existsSync(join(tree, 'src', 'sim', 'infra', 'traffic.ts'))) throw new Error(`no simulation tree at ${tree} (set SIM_SNAP)`);
  switch (suite) {
    case 'verify': return runNode(await bundle('verify.ts'), passArgs, 'verify');
    case 'insitu': {
      const { extraBinaries } = await import('./trafficCore/binaries.mjs');
      const bins = await extraBinaries(CACHE);
      const extra = [...(bins.scalar ? ['--scalar', bins.scalar] : []), ...(bins.imp ? ['--imp', bins.imp] : [])];
      return runNode(await bundle('insitu.ts'), [...passArgs, ...extra], 'insitu');
    }
    default:
      console.log('usage: node tools/bench/trafficCore.bench.mjs verify [--fixture F] [--cycles N]');
      process.exitCode = suite ? 1 : 0;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
