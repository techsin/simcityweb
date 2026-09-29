/**
 * City fixtures for the roadTransitSearch benchmarks (node only). Loaded with the benchmark tree's own save code.
 *   dense1m   profiler fixture dense1m_s7.metropolis (1.12M residents, 23k road nodes, transit net)
 *   stress1m  profiler fixture stress1m_testdefs_s7.metropolis (~1.03M residents, 36k road nodes; TEST defs)
 *   stress256 tests/infra/cityGen.ts stressCity(256) (no file needed)
 *   <path>    any .metropolis file
 * Fixture directory: --fixtures DIR, env SIM_FIXTURES, or the profiler's scratch directory.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserializeCity } from '../../../src/save/serialize';
import { unpackFile } from '../../../src/save/bundle';
import { registerTestDefs, stressCity } from '../../../tests/infra/cityGen';
import type { CityState } from '../../../src/sim/CityState';

export const DEFAULT_FIXTURES = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/profile/fixtures';

export function fixtureDir(args: string[]): string {
  const i = args.indexOf('--fixtures');
  return i >= 0 ? args[i + 1] : process.env.SIM_FIXTURES ?? DEFAULT_FIXTURES;
}

export async function loadCity(spec: string, dir: string): Promise<{ st: CityState; label: string }> {
  if (spec === 'stress256') {
    registerTestDefs();
    return { st: stressCity(256).st, label: 'stress256' };
  }
  let file = spec;
  if (spec === 'dense1m') file = join(dir, 'dense1m_s7.metropolis');
  else if (spec === 'stress1m') file = join(dir, 'stress1m_testdefs_s7.metropolis');
  if (spec === 'stress1m' || file.includes('testdefs')) registerTestDefs();
  if (!existsSync(file)) throw new Error(`fixture ${file} not found (--fixtures DIR / SIM_FIXTURES)`);
  const st = deserializeCity((await unpackFile(new Uint8Array(readFileSync(file)))) as Parameters<typeof deserializeCity>[0]);
  return { st, label: spec };
}
