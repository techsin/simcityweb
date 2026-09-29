#!/usr/bin/env node
/**
 * Bundle a sim-profile tool (TypeScript entry importing src/**) with rolldown into node_modules/.cache/sim-profile/.
 *   node tools/bench/sim-profile/bundle.mjs profile            -> .cache/sim-profile/profile.js (+ .map for analyze.mjs)
 *   node tools/bench/sim-profile/bundle.mjs fixtures/dense1m   -> .cache/sim-profile/dense1m.js
 * Then run with plain node (see the header of each entry for its arguments).
 */
import { mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..', '..');
const name = process.argv[2] ?? 'profile';
const entry = join(here, `${name}.ts`);
const outDir = join(ROOT, 'node_modules', '.cache', 'sim-profile');
mkdirSync(outDir, { recursive: true });
const { rolldown } = await import('rolldown');
const bundle = await rolldown({ input: entry, platform: 'node', logLevel: 'warn' });
await bundle.write({ format: 'esm', dir: outDir, entryFileNames: `${basename(name)}.js`, sourcemap: true });
await bundle.close();
console.log(`bundled ${entry} -> ${join(outDir, basename(name) + '.js')}`);
