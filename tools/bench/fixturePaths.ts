/**
 * Default directories of the WASM benchmark / test fixtures (node only), built by `npm run fixtures`
 * (tools/makeFixtures.mjs; docs/dev/TEST_CITIES.md). $SIM_FIXTURES and $SIM_SNAP override them where they are used.
 *   DEFAULT_FIXTURES  <repo>/tools/bench/.fixtures/fixtures   dense1m_s7, stress1m_testdefs_s7, bot256_s7_y60 .metropolis
 *   DEFAULT_SNAP      <repo>/tools/bench/.fixtures/snap       the frozen tree of commit 24f8609
 * The repository is found from this module's location, which also works inside the bundles the benches build into
 * node_modules/.cache (their directory is below the repository too).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** the nearest directory at or above `from` holding the metropolis package.json (the working directory if none) */
export function repoRoot(from = dirname(fileURLToPath(import.meta.url))): string {
  for (let d = from; ; d = dirname(d)) {
    const pkg = join(d, 'package.json');
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === 'metropolis') return d;
      } catch {
        /* not ours: keep looking */
      }
    }
    if (dirname(d) === d) return process.cwd();
  }
}

export const DEFAULT_FIXTURES = join(repoRoot(), 'tools', 'bench', '.fixtures', 'fixtures');
export const DEFAULT_SNAP = join(repoRoot(), 'tools', 'bench', '.fixtures', 'snap');
