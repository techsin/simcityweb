/**
 * rolldown plugins for the trafficCore benchmarks (tools/bench/trafficCore.bench.mjs).
 *
 * The benchmark entries (tools/bench/trafficCore/*.ts) import the simulation through relative paths into src/** and
 * tests/** (so they typecheck with the project). With `tree` set to another checkout — by default the profiler's
 * frozen snapshot of commit 24f8609, the version traffic.rs was ported from and the 1M fixtures were saved with —
 * those imports are redirected to the same paths inside that tree, so concurrent edits of the live sim (sim-depth part
 * B is rewriting traffic.ts) cannot disturb a measurement. src/wasm/** (the kernels and bindings) always comes from
 * this repo. No file is edited.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HERE = join(REPO, 'tools', 'bench', 'trafficCore');

export function treePlugins({ tree = REPO } = {}) {
  return [
    {
      name: 'traffic-core-tree-redirect',
      resolveId(source, importer) {
        if (tree === REPO || !importer || !importer.startsWith(HERE) || !source.startsWith('.')) return null;
        const abs = resolve(dirname(importer), source);
        const rel = abs.slice(REPO.length + 1);
        if (!(rel.startsWith('src' + sep) || rel.startsWith('tests' + sep)) || rel.startsWith(join('src', 'wasm') + sep)) return null;
        const t = join(tree, rel);
        return t.endsWith('.ts') ? t : existsSync(t + '.ts') ? t + '.ts' : join(t, 'index.ts');
      },
    },
  ];
}

export default treePlugins;
