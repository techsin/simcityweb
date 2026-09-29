#!/usr/bin/env node
/**
 * Bundle a TypeScript benchmark with rolldown (the balance bot's execution style: bundle, then plain node) and run it.
 *
 *   npm run bench:wasm -- blur [--json out.json] [bench args…]      -> tools/bench/blur.bench.ts
 *   node tools/bench/run.mjs memory
 *
 * The bundle goes to node_modules/.cache/sim-bench/ (not next to the sources), which also proves the wasm loader finds
 * src/wasm/sim_kernels.wasm from a bundled file (cwd fallback). tools/bench/<name>.plugins.mjs (optional) adds rolldown
 * plugins, e.g. sim.plugins.mjs swaps the wasm blur bindings into the real systems without editing them.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [name = 'blur', ...rest] = process.argv.slice(2);
const entry = join(ROOT, 'tools', 'bench', `${name}.bench.ts`);
if (!existsSync(entry)) {
  console.error(`no benchmark ${entry}`);
  process.exit(1);
}
const outDir = join(ROOT, 'node_modules', '.cache', 'sim-bench');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${name}.bench.mjs`);

const { rolldown } = await import('rolldown');
// optional tools/bench/<name>.plugins.mjs: default export = rolldown plugins (e.g. redirect a sim module to its wasm binding)
const pluginFile = join(ROOT, 'tools', 'bench', `${name}.plugins.mjs`);
const plugins = existsSync(pluginFile) ? (await import(pluginFile)).default : [];
const bundle = await rolldown({ input: entry, platform: 'node', logLevel: 'warn', plugins });
await bundle.write({ format: 'esm', file: outFile });
await bundle.close();

const r = spawnSync(process.execPath, [outFile, ...rest], { stdio: 'inherit', cwd: ROOT });
process.exit(r.status ?? 1);
