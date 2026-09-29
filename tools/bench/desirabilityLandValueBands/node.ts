/**
 * Desirability / land-value band A/B — node entry (bundled with plugins.mjs's tree redirect and run by
 * tools/bench/desirabilityLandValueBands.bench.mjs). CPU time (process.cpuUsage) from an otherwise idle worker thread
 * (node.ts benchMain), runAB (ab.ts): warm-up of both arms, interleaved order-alternated pairs, median / min and a 95 %
 * bootstrap CI of the paired ratio.
 *
 *   node desirabilityLandValueBands.node.mjs --fixture F.metropolis [--fixture G …] [--cap-dir DIR] [--warm 20]
 *        [--reps 31] [--scalar sim_kernels.scalar.wasm] [--simd sim_kernels.wasm] [--json out.json]
 *
 * Per fixture: capture the band inputs after `warm` days (cached in --cap-dir), check every arm bit-exact against the
 * original after every band of the three sweeps, then time full sweeps (12 daily bands = one refresh period):
 *   desZoned (allCells = false), desAll (allCells = true: every 4th sweep also rates unzoned land), lv (land value).
 * Arms: JS as-is (24f8609 verbatim), fair JS, wasm SIMD resident (layers in wasm memory), wasm SIMD staged (plain
 * arrays: the band rows copied in / out per call, i.e. marshalling included), wasm scalar resident / staged.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ECON_TABLES } from '../../../src/wasm/kernels/desirabilityLandValueBands';
import { formatResult, runAB, type AbResult } from '../ab';
import { benchMain, cpuMs, loadAvg } from '../node';
import { captureFixture } from './capture';
import {
  SWEEPS, bandsOf, checkArms, decodeCapture, encodeCapture, fixedArm, instantiate, origArm, sweep, wasmArm, type Arm, type EconCapture,
  type SweepKind,
} from './core';

/** zoned / unzoned / road-water cells of a capture (what the sweeps actually process) */
function cellCounts(c: EconCapture): { zoned: number; unzoned: number; roadWater: number } {
  const zone = c.layers.zone as Uint8Array, net = c.layers.network as Uint8Array, water = c.layers.water as Uint8Array;
  let zoned = 0, unzoned = 0, rw = 0;
  for (let i = 0; i < zone.length; i++) {
    if (water[i] || net[i]) rw++;
    else if (zone[i] !== 0 && zone[i] !== 10) zoned++;
    else unzoned++;
  }
  return { zoned, unzoned, roadWater: rw };
}

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const fixtures: string[] = [];
  args.forEach((v, i) => { if (v === '--fixture') fixtures.push(args[i + 1]); });
  const capDir = opt('--cap-dir', join(process.cwd(), 'node_modules', '.cache', 'sim-bench', 'econ'))!;
  const warm = Number(opt('--warm', '20'));
  const reps = Number(opt('--reps', '31'));
  const simdFile = opt('--simd', join(process.cwd(), 'src', 'wasm', 'sim_kernels.wasm'))!;
  const scalarFile = opt('--scalar');
  const only = opt('--sweeps')?.split(',') as SweepKind[] | undefined;
  mkdirSync(capDir, { recursive: true });
  const abOpts = { reps, clock: cpuMs, clockName: 'cpu', warmupMs: 500, minSampleMs: 12 };
  const simd = new WebAssembly.Module(readFileSync(simdFile));
  const scalar = scalarFile ? new WebAssembly.Module(readFileSync(scalarFile)) : null;
  const out: Record<string, unknown> = { simd: simdFile, scalar: scalarFile ?? null, reps, warm, loadBefore: loadAvg() };
  log(`# wasm SIMD ${simdFile}${scalarFile ? `, scalar ${scalarFile}` : ''}; ${reps} interleaved pairs per case; load ${loadAvg().join(' ')}`);

  for (const fixture of fixtures) {
    const name = fixture.split('/').pop()!.replace(/\.metropolis$/, '');
    const capFile = join(capDir, `${name}.w${warm}.cap`);
    let cap: EconCapture;
    if (existsSync(capFile)) cap = decodeCapture(new Uint8Array(readFileSync(capFile)));
    else {
      const t0 = cpuMs();
      cap = await captureFixture(fixture, warm);
      writeFileSync(capFile, encodeCapture(cap));
      log(`# captured ${name} after ${warm} days (${((cpuMs() - t0) / 1000).toFixed(1)} s cpu) -> ${capFile}`);
    }
    const cells = cellCounts(cap);
    log(`\n## ${name}: N ${cap.N}, day ${cap.day}, population ${cap.population}, cells: ${cells.zoned} zoned, ${cells.unzoned} unzoned land, ${cells.roadWater} road / water; flags ${JSON.stringify(cap.systemData.infraLayers ?? {})}`);
    const wSimd = instantiate(simd), wScalar = scalar ? instantiate(scalar) : null;
    const arms: Record<string, Arm> = {
      orig: origArm(cap),
      fixed: fixedArm(cap, ECON_TABLES),
      simdRes: wasmArm(cap, ECON_TABLES, wSimd, 'wasm SIMD resident', true),
      simdStaged: wasmArm(cap, ECON_TABLES, wSimd, 'wasm SIMD staged', false),
    };
    if (wScalar) {
      arms.scalarRes = wasmArm(cap, ECON_TABLES, wScalar, 'wasm scalar resident', true);
      arms.scalarStaged = wasmArm(cap, ECON_TABLES, wScalar, 'wasm scalar staged', false);
    }
    checkArms(Object.values(arms), cap.N);
    log(`bit-exact: ${Object.values(arms).map((a) => a.label).join(', ')} identical after every band of the zoned, allCells and land-value sweeps`);
    const bands = bandsOf(cap.N);
    const R: Record<string, unknown> = { population: cap.population, day: cap.day, cells, bandsPerSweep: bands.length };
    // staged bytes per band (from one sweep of each kind)
    const st = arms.simdStaged.stats!;
    const bytes: Record<string, { inKiB: number; outKiB: number }> = {};
    for (const kind of SWEEPS) {
      const i0 = st.bytesIn, o0 = st.bytesOut;
      sweep(arms.simdStaged, kind, bands);
      bytes[kind] = { inKiB: +((st.bytesIn - i0) / bands.length / 1024).toFixed(1), outKiB: +((st.bytesOut - o0) / bands.length / 1024).toFixed(1) };
    }
    R.stagedBytesPerBand = bytes;
    log(`staged copies per band: ${SWEEPS.map((k) => `${k} ${bytes[k].inKiB} KiB in / ${bytes[k].outKiB} KiB out`).join('; ')}`);

    const pairs: [string, string, string][] = [
      ['as-is vs fair JS', 'orig', 'fixed'],
      ['fair JS vs wasm SIMD resident', 'fixed', 'simdRes'],
      ['fair JS vs wasm SIMD staged', 'fixed', 'simdStaged'],
      ['as-is vs wasm SIMD resident', 'orig', 'simdRes'],
      ['wasm SIMD staged vs resident', 'simdStaged', 'simdRes'],
    ];
    if (wScalar) {
      pairs.push(['fair JS vs wasm scalar resident', 'fixed', 'scalarRes']);
      pairs.push(['wasm scalar vs SIMD build (resident)', 'scalarRes', 'simdRes']);
    }
    const results: Record<string, AbResult[]> = {};
    for (const kind of (only ?? SWEEPS).filter((k) => SWEEPS.includes(k))) {
      results[kind] = [];
      log(`\n### ${kind}: one full sweep = ${bands.length} daily bands (per day = / ${bands.length})`);
      for (const [label, a, b] of pairs) {
        const A = arms[a], B = arms[b];
        const r = runAB({ name: `${kind} ${label}`, a: () => sweep(A, kind, bands), b: () => sweep(B, kind, bands), aLabel: A.label, bLabel: B.label }, abOpts);
        results[kind].push(r);
        log(formatResult(r) + `  load ${loadAvg()[0]}`);
      }
    }
    R.results = results;
    R.loadAfter = loadAvg();
    out[name] = R;
    for (const a of Object.values(arms)) a.dispose();
  }
  out.loadAfter = loadAvg();
  return out;
});
