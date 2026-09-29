/**
 * rolldown plugin for the desirability / land-value band benchmarks: redirects every import that resolves into this
 * repository's src/** (except src/wasm/**) or tests/** (except tests/wasm/**) to the same path inside `tree` — by
 * default the frozen snapshot of commit 24f8609 (the version the kernels were ported from, and the one the profiler's
 * 1M fixtures were saved with), so a benchmark is not disturbed by concurrent edits of the live sim. The kernels, their
 * bindings (src/wasm/**) and the frozen reference (tests/wasm/econBandsOriginal.ts) always come from this repository;
 * their own imports of src/sim/** land in `tree` too. `tree` = the repository root disables the redirect.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function treeRedirect(tree) {
  const T = resolve(tree);
  if (T === REPO) return [];
  const keep = [join(REPO, 'src', 'wasm') + sep, join(REPO, 'tests', 'wasm') + sep];
  return [{
    name: 'econ-tree-redirect',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.') || importer.startsWith(T + sep)) return null;
      let abs = resolve(dirname(importer), source);
      if (!abs.startsWith(REPO + sep) || keep.some((k) => abs.startsWith(k))) return null;
      const rel = abs.slice(REPO.length + 1);
      if (!(rel.startsWith('src' + sep) || rel.startsWith('tests' + sep))) return null;
      const t = join(T, rel);
      if (t.endsWith('.ts') && existsSync(t)) return t;
      if (existsSync(t + '.ts')) return t + '.ts';
      if (existsSync(join(t, 'index.ts'))) return join(t, 'index.ts');
      return null;
    },
  }];
}
