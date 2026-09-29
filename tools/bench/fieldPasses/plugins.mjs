/**
 * rolldown plugins for the field-pass benchmarks.
 *
 * treeRedirect(tree): every import that resolves into this repository's src/** (except src/wasm/**) or tests/** (except
 *   tests/wasm/**) is redirected to the same path inside `tree` — by default the frozen snapshot of commit 24f8609 (the
 *   version the kernels were ported from and the profiler's fixtures were saved with), so a benchmark is not disturbed by
 *   concurrent edits of the live sim. The kernels, their bindings (src/wasm/**) and the frozen originals
 *   (tests/wasm/fieldPassesOriginal.ts) always come from this repository; their own imports of src/sim/** land in `tree`
 *   too. `tree` = the repository root disables the redirect.
 * blurSwitch(): (--blur wasm) every sim module's import of './blur' gets the wasm blur bindings (src/wasm/kernels/blurBind.ts
 *   around the tree's blur.ts: the already ported and adopted blur kernels), for EVERY arm alike — the post-integration
 *   baseline in which the field passes' remaining JS is the blur-free part.
 * nimbySwitch(): services.ts's import of './nimby' (the only importer of nimby.ts) gets a virtual module that dispatches
 *   rebuildNimby / nimbyCost per CityState to the implementation registered in globalThis.__nimbySwitch
 *   (WeakMap<CityState, { rebuildNimby, nimbyCost }>), and to the genuine nimby.ts otherwise — so one process can run
 *   Simulations whose NIMBY step is the original, the fair JS or the wasm kernels side by side.
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
    name: 'fieldpasses-tree-redirect',
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

const VIRTUAL = '\0fieldpasses-nimby-switch';

export function nimbySwitch() {
  let target = null;
  return {
    name: 'fieldpasses-nimby-switch',
    resolveId(source, importer) {
      if (!importer || importer === VIRTUAL) return null;
      if (!importer.endsWith(join('src', 'sim', 'infra', 'services.ts'))) return null;
      if (!(source === './nimby' || source === './nimby.ts')) return null;
      target = resolve(dirname(importer), 'nimby.ts');
      return VIRTUAL;
    },
    load(id) {
      if (id !== VIRTUAL) return null;
      return `
import * as orig from ${JSON.stringify(target)};
const reg = (globalThis.__nimbySwitch ??= new WeakMap());
export const nimbyAt = orig.nimbyAt;
export function rebuildNimby(sim) { const impl = reg.get(sim.state); return impl ? impl.rebuildNimby(sim) : orig.rebuildNimby(sim); }
export function nimbyCost(sim) { const impl = reg.get(sim.state); return impl ? impl.nimbyCost(sim) : orig.nimbyCost(sim); }
`;
    },
  };
}

const BLUR_VIRTUAL = '\0fieldpasses-blur-switch';

export function blurSwitch(tree) {
  // every importer (the tree's sim modules and the field-pass overrides in src/wasm) gets the SAME module: the wasm
  // bindings around the tree's blur.ts
  const target = join(resolve(tree), 'src', 'sim', 'infra', 'blur.ts');
  const suffix = join('src', 'sim', 'infra', 'blur.ts');
  return {
    name: 'fieldpasses-blur-switch',
    resolveId(source, importer) {
      if (!importer || importer === BLUR_VIRTUAL || !source.startsWith('.')) return null;
      const abs = resolve(dirname(importer), source.endsWith('.ts') ? source : source + '.ts');
      return abs.endsWith(suffix) ? BLUR_VIRTUAL : null;
    },
    load(id) {
      if (id !== BLUR_VIRTUAL) return null;
      return `
import * as js from ${JSON.stringify(target)};
import { makeBlurKernels } from ${JSON.stringify(join(REPO, 'src', 'wasm', 'kernels', 'blurBind.ts'))};
const k = makeBlurKernels(js);
export const boxH = k.boxH, boxV = k.boxV, blur3 = k.blur3, boxAverage = k.boxAverage, blurDown = k.blurDown, upsampleAdd = k.upsampleAdd;
export const blurDownAdd = k.blurDownAdd, shiftField = k.shiftField, shiftPlume = k.shiftPlume, blurSigma2 = k.blurSigma2;
`;
    },
  };
}

/**
 * all plugins of a bundle: the NIMBY switch first (it must see services.ts's own import), the optional blur switch, then
 * the tree redirect
 */
export function plugins(tree, opts = {}) {
  return [nimbySwitch(), ...(opts.blur === 'wasm' ? [blurSwitch(tree)] : []), ...treeRedirect(tree)];
}
