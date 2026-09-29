/**
 * rolldown plugins for tools/bench/sim.bench.ts: every sim module that imports src/sim/infra/blur.ts gets the virtual
 * module `\0sim-blur-switch` instead — the wasm bindings built around the JS original plus per-call CPU timers — so the
 * real systems run on the wasm kernels (or on JS, per preference) without any sim file being edited.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BLUR = join(ROOT, 'src', 'sim', 'infra', 'blur.ts');
const VIRTUAL = '\0sim-blur-switch';

export default [
  {
    name: 'sim-blur-switch',
    resolveId(source, importer) {
      if (!importer || importer === VIRTUAL || importer.includes(`${join('src', 'wasm')}`)) return null;
      if (!(source === './blur' || source.endsWith('/infra/blur') || source.endsWith('/infra/blur.ts'))) return null;
      const abs = resolve(dirname(importer), source.endsWith('.ts') ? source : source + '.ts');
      return abs === BLUR ? VIRTUAL : null;
    },
    load(id) {
      if (id !== VIRTUAL) return null;
      return `
import * as js from ${JSON.stringify(BLUR)};
import { makeBlurKernels } from ${JSON.stringify(join(ROOT, 'src', 'wasm', 'kernels', 'blurBind.ts'))};
const k = makeBlurKernels(js);
const stats = (globalThis.__blurStats ??= { ms: 0, calls: 0 });
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const timed = (f) => (...a) => { const t0 = cpu(); try { return f(...a); } finally { stats.ms += cpu() - t0; stats.calls++; } };
export const boxH = timed(k.boxH), boxV = timed(k.boxV), blur3 = timed(k.blur3), boxAverage = timed(k.boxAverage);
export const blurDown = timed(k.blurDown), upsampleAdd = timed(k.upsampleAdd), blurDownAdd = timed(k.blurDownAdd);
export const shiftField = timed(k.shiftField), shiftPlume = timed(k.shiftPlume), blurSigma2 = k.blurSigma2;
`;
    },
  },
];
