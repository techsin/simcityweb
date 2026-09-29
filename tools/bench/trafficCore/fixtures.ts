/**
 * City fixtures for the trafficCore benchmarks (node only), loaded with the benchmark tree's own save code.
 *   dense1m    profiler fixture dense1m_s7.metropolis (1.12M residents, 23k road nodes, 3k stops: transit-heavy)
 *   bot256     profiler fixture bot256_s7_y60.metropolis (balance-bot city, year 60, no transit stops)
 *   stress1m   profiler fixture stress1m_testdefs_s7.metropolis (~1.03M residents, 36k road nodes; test defs)
 *   stress256  tests/infra/cityGen.ts stressCity(256) (generated, no file)
 *   stress96   stressCity(96) (small, for tests)
 *   <path>     any .metropolis file
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

export function fixtureFile(spec: string, dir: string): string | null {
  if (spec.startsWith('stress') && /^stress\d+$/.test(spec) && spec !== 'stress1m') return null;
  if (spec === 'dense1m') return join(dir, 'dense1m_s7.metropolis');
  if (spec === 'bot256') return join(dir, 'bot256_s7_y60.metropolis');
  if (spec === 'stress1m') return join(dir, 'stress1m_testdefs_s7.metropolis');
  return spec;
}

export async function loadCity(spec: string, dir: string): Promise<{ st: CityState; label: string }> {
  const m = /^stress(\d+)$/.exec(spec);
  if (m && spec !== 'stress1m') {
    registerTestDefs();
    return { st: stressCity(Number(m[1])).st, label: spec };
  }
  const file = fixtureFile(spec, dir)!;
  if (spec === 'stress1m' || file.includes('testdefs')) registerTestDefs();
  if (!existsSync(file)) throw new Error(`fixture ${file} not found (--fixtures DIR / SIM_FIXTURES)`);
  const st = deserializeCity((await unpackFile(new Uint8Array(readFileSync(file)))) as Parameters<typeof deserializeCity>[0]);
  return { st, label: spec };
}
