/**
 * rolldown plugins of the population aggregate probe benchmarks (tools/bench/populationAggregateProbe.bench.mjs).
 *
 *  - treeRedirect(tree): imports that resolve into this repository's src/** (except src/wasm/**) or tests/** (except
 *    tests/wasm/**) are redirected to the same path inside `tree` — by default the profiler's frozen snapshot of commit
 *    24f8609 (the version the probe was ported from and the 1M fixtures were saved with), so a concurrent rewrite of the
 *    live sim cannot disturb a measurement. (Same rule as tools/bench/desirabilityLandValueBands/plugins.mjs.)
 *  - exposeCache(): a bundle-time copy edit of <tree>/src/sim/economy/population.ts that adds one getter to the system
 *    object — `get __probeCache() { return cache; }` — so arm A can read the population system's own DemographicsCache
 *    (mWf = cache.wf). Nothing else changes; the file on disk is never touched.
 *  - popShell(): a virtual module `popagg:shell` = the same frozen population.ts with populationSystem renamed to
 *    populationSystemShell(rt, kernel) and the probed region of aggregate() (the zeroing, growables loop, blurs) replaced
 *    by `kernel.run(...)`; the plopped loop and the O(1) tail stay verbatim. The e2e benchmark installs it in place of
 *    the genuine system for the kernel arms (the genuine system stays in the bundle for arm A).
 * Every edit asserts its exact anchor text, so a changed source fails loudly instead of benchmarking something else.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DEFAULT_SNAP = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/profile/snap';

export function treeRedirect(tree) {
  const T = resolve(tree);
  if (T === REPO) return [];
  const keep = [join(REPO, 'src', 'wasm') + sep, join(REPO, 'tests', 'wasm') + sep];
  return [{
    name: 'popagg-tree-redirect',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.') || importer.startsWith(T + sep)) return null;
      const abs = resolve(dirname(importer), source);
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

const POP_REL = join('src', 'sim', 'economy', 'population.ts');
const EXPOSE_ANCHOR = "    name: 'economy.population',\n    rt,\n";

function replaceOnce(code, anchor, repl, what) {
  const i = code.indexOf(anchor);
  if (i < 0 || code.indexOf(anchor, i + 1) >= 0) throw new Error(`popagg plugins: anchor for ${what} not found exactly once`);
  return code.slice(0, i) + repl + code.slice(i + anchor.length);
}

export function exposeCache(tree) {
  const file = join(resolve(tree), POP_REL);
  return {
    name: 'popagg-expose-cache',
    transform(code, id) {
      if (id !== file) return null;
      return { code: replaceOnce(code, EXPOSE_ANCHOR, EXPOSE_ANCHOR + '    get __probeCache() { return cache; },\n', 'the system object'), map: null };
    },
  };
}

// ------------------------------------------------------------------------------------------------ the e2e shell
const REGION_START = '    rt.coarsePopRaw.fill(0); rt.coarseWealthRaw.fill(0); rt.coarseCountRaw.fill(0);\n';
const REGION_END = '    // ---- employment (workforce and traffic access are summed every OCC_PERIOD days; in between the workforce follows\n';
const PLOPPED = `    for (const b of rt.plopped) {
      if (b.flags & BF.Burnt) continue;
      t.civicJobCap += b.capacity;
      t.civicJobs += b.jobs;
    }
    t.growables = list.length;
    t.population = t.pop[0] + t.pop[1] + t.pop[2];
`;
const SHELL_REGION = `    const cw = rt.cw;
    const cc = cw * cw;
    const sample = first || st.day % OCC_PERIOD === 0;
    const demo = first || st.day % DEMO_AGG_DAYS === 0;
    if (sample) cache.ensure(st.nextBuildingId);
    const dd = demographicsData(st);
    // ---- probe: the zeroing, the growables loop and the blurs run in the kernel under test
    const __k = __probeKernel.run(sim, rt, cache, inf, first, sample, demo, dd, coh);
    let W = __k.W;
    const eduSum = __k.eduSum, eduPop = __k.eduPop, accE = __k.accE, accW = __k.accW, unW = __k.unW;
    const tAcc = __k.tAcc;
    const list = rt.growables;
    void cc;
` + PLOPPED;

export function shellSource(tree) {
  const file = join(resolve(tree), POP_REL);
  let code = readFileSync(file, 'utf8');
  // the region = from the grid zeroing to the employment comment; it must contain the plopped loop verbatim
  const i = code.indexOf(REGION_START), j = code.indexOf(REGION_END);
  if (i < 0 || j < i || code.indexOf(REGION_START, i + 1) >= 0 || code.indexOf(REGION_END, j + 1) >= 0) throw new Error('popagg shell: region anchors not found exactly once');
  const region = code.slice(i, j);
  if (!region.includes(PLOPPED)) throw new Error('popagg shell: the plopped loop is not in the region verbatim');
  code = code.slice(0, i) + SHELL_REGION + code.slice(j);
  code = replaceOnce(code, 'export function populationSystem(rt: EconRuntime): SimSystem & { rt: EconRuntime } {\n',
    'export function populationSystemShell(rt: EconRuntime, __probeKernel: ProbeKernel): SimSystem & { rt: EconRuntime } {\n', 'populationSystem');
  code = replaceOnce(code, EXPOSE_ANCHOR, EXPOSE_ANCHOR + '    get __probeCache() { return cache; },\n', 'the system object');
  // the kernel interface (structural)
  code += `
/** the e2e probe kernel (tools/bench/populationAggregateProbe/e2e.ts) */
export interface ProbeKernel {
  run(sim: Simulation, rt: EconRuntime, cache: DemographicsCache, inf: InfraFlags, first: boolean, sample: boolean, demo: boolean,
    dd: ReturnType<typeof demographicsData>, coh: Float64Array): { W: number; eduSum: number; eduPop: number; accE: number; accW: number; unW: number; tAcc: unknown };
}
`;
  return code;
}

/** virtual module 'popagg:shell' next to the frozen population.ts (so its relative imports resolve the same way) */
export function popShell(tree) {
  const id = join(resolve(tree), 'src', 'sim', 'economy', 'population.probe-shell.ts');
  return {
    name: 'popagg-shell',
    resolveId(source) {
      return source === 'popagg:shell' ? id : null;
    },
    load(x) {
      return x === id ? { code: shellSource(tree), moduleType: 'ts' } : null;
    },
  };
}

export function probePlugins(tree, { shell = false } = {}) {
  return [...treeRedirect(tree), exposeCache(tree), ...(shell ? [popShell(tree)] : [])];
}
