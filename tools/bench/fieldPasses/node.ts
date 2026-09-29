/**
 * Field-pass A/B — node entry (bundled with plugins.mjs and run by tools/bench/fieldPasses.bench.mjs). CPU time
 * (process.cpuUsage) from an otherwise idle worker thread (node.ts benchMain), runAB (ab.ts): warm-up of both arms,
 * interleaved order-alternated pairs, median / min and a 95 % bootstrap CI of the paired ratio.
 *
 *   node fieldPasses.node.mjs --capture NAME=FIXTURE[@water] [--capture …] [--cap-dir DIR] [--warm 20] [--reps 31]
 *        [--scalar sim_kernels.scalar.wasm] [--simd sim_kernels.wasm] [--cases nimby,cells,…] [--json out.json]
 *
 * Per capture (cached in --cap-dir): check every arm bit-exact against the original (every case, twice: the second
 * NIMBY run hits the corridor cache), then time the cases. Arms: JS as-is (24f8609 loops verbatim), fair JS, wasm SIMD
 * resident (arrays in wasm memory), wasm SIMD staged (plain arrays: copies in / out per call, i.e. marshalling
 * included), wasm scalar resident / staged.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatResult, runAB, type AbResult } from '../ab';
import { benchMain, cpuMs, loadAvg } from '../node';
import { captureFixture } from './capture';
import { CASES, checkArms, decodeCapture, encodeCapture, fairArm, instantiate, origArm, wasmArm, type CaseName, type FieldArm, type FieldCapture } from './core';

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const caps: { name: string; fixture: string; water: string }[] = [];
  args.forEach((v, i) => {
    if (v !== '--capture') return;
    const [name, rest] = args[i + 1].split('=');
    const [fixture, water = ''] = rest.split('@');
    caps.push({ name, fixture, water });
  });
  const capDir = opt('--cap-dir', join(process.cwd(), 'node_modules', '.cache', 'sim-bench', 'fieldPasses'))!;
  const warm = Number(opt('--warm', '20'));
  const reps = Number(opt('--reps', '31'));
  const simdFile = opt('--simd', join(process.cwd(), 'src', 'wasm', 'sim_kernels.wasm'))!;
  const scalarFile = opt('--scalar');
  const only = (opt('--cases')?.split(',') ?? CASES) as CaseName[];
  const pairsOpt = opt('--pairs');
  mkdirSync(capDir, { recursive: true });
  const abOpts = { reps, clock: cpuMs, clockName: 'cpu', warmupMs: 400, minSampleMs: 10 };
  const simd = new WebAssembly.Module(readFileSync(simdFile));
  const scalar = scalarFile ? new WebAssembly.Module(readFileSync(scalarFile)) : null;
  const out: Record<string, unknown> = { simd: simdFile, scalar: scalarFile ?? null, reps, warm, loadBefore: loadAvg() };
  log(`# wasm SIMD ${simdFile}${scalarFile ? `, scalar ${scalarFile}` : ''}; ${reps} interleaved pairs per case; load ${loadAvg().join(' ')}`);

  for (const c of caps) {
    const capFile = join(capDir, `${c.name}.w${warm}.cap`);
    let cap: FieldCapture;
    if (existsSync(capFile)) cap = decodeCapture(new Uint8Array(readFileSync(capFile)));
    else {
      const t0 = cpuMs();
      cap = await captureFixture(c.fixture, warm, c.water);
      writeFileSync(capFile, encodeCapture(cap));
      log(`# captured ${cap.meta.name} after ${warm} days (${((cpuMs() - t0) / 1000).toFixed(1)} s cpu) -> ${capFile}`);
    }
    const m = cap.meta;
    const splats = (cap.arrays['nimby.splats'] as Float64Array).length / 7;
    let wCells = 0, hw = 0, rail = 0;
    const wm = cap.arrays['water.wm'] as Uint8Array, net = cap.arrays['nimby.net'] as Uint8Array;
    for (let i = 0; i < wm.length; i++) { if (wm[i]) wCells++; if (net[i] === 5) hw++; if (net[i] === 6) rail++; }
    log(`\n## ${m.name}: N ${m.N}, day ${m.day}, population ${m.population}, ${m.nimby.buildings} buildings, ${splats} NIMBY splats, ` +
      `${m.nimby.touches} touches, highway ${hw} / rail ${rail} cells, water ${wCells} cells (${m.water.nW} in the list, ${(cap.arrays['water.bank'] as Int32Array).length} bank), ` +
      `${m.cells.nReg} landfill regions${m.variant ? `; synthetic water: ${m.variant}` : ''}`);
    const wSimd = instantiate(simd), wScalar = scalar ? instantiate(scalar) : null;
    const arms: Record<string, FieldArm> = {
      orig: origArm(cap),
      fair: fairArm(cap),
      simdRes: wasmArm(cap, wSimd, 'wasm SIMD resident', true),
      simdStaged: wasmArm(cap, wSimd, 'wasm SIMD staged', false),
    };
    if (wScalar) {
      arms.scalarRes = wasmArm(cap, wScalar, 'wasm scalar resident', true);
      arms.scalarStaged = wasmArm(cap, wScalar, 'wasm scalar staged', false);
    }
    // the fair JS against the capture's reference first (the genuine rebuildNimby's outputs and touches)
    arms.fair.run('nimby');
    const o = arms.fair.outputs('nimby');
    for (const [k, e] of [['S', 'nimby.expS'], ['P', 'nimby.expP'], ['K', 'nimby.expK']] as const) {
      const a = o[k] as Float32Array, b = cap.arrays[e] as Float32Array;
      const ua = new Uint32Array(a.buffer, a.byteOffset, a.length), ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
      for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) throw new Error(`fair JS nimby ${k} differs from the genuine rebuildNimby at ${i}`);
    }
    if (o.touches !== m.nimby.touches) throw new Error(`fair JS touches ${String(o.touches)} != the genuine rebuild's ${m.nimby.touches}`);
    checkArms(Object.values(arms));
    log(`bit-exact: ${Object.values(arms).map((a) => a.label).join(', ')} identical on every case (outputs + touches + used flags); NIMBY also = the genuine rebuildNimby`);
    // staged bytes per call of each case
    const st = arms.simdStaged.stats!;
    const bytes: Record<string, { inKiB: number; outKiB: number }> = {};
    for (const k of CASES) {
      const i0 = st.bytesIn, o0 = st.bytesOut;
      arms.simdStaged.run(k);
      bytes[k] = { inKiB: +((st.bytesIn - i0) / 1024).toFixed(1), outKiB: +((st.bytesOut - o0) / 1024).toFixed(1) };
    }
    log(`staged copies per call (KiB in / out): ${CASES.map((k) => `${k} ${bytes[k].inKiB} / ${bytes[k].outKiB}`).join('; ')}`);

    const pairs: [string, string, string][] = [
      ['as-is vs fair JS', 'orig', 'fair'],
      ['fair JS vs wasm SIMD resident', 'fair', 'simdRes'],
      ['fair JS vs wasm SIMD staged', 'fair', 'simdStaged'],
      ['as-is vs wasm SIMD resident', 'orig', 'simdRes'],
      ['wasm SIMD staged vs resident', 'simdStaged', 'simdRes'],
    ];
    if (wScalar) {
      pairs.push(['fair JS vs wasm scalar resident', 'fair', 'scalarRes']);
      pairs.push(['wasm scalar vs SIMD build (resident)', 'scalarRes', 'simdRes']);
    }
    const sel = pairsOpt ? pairs.filter((_, k) => pairsOpt.split(',').includes(String(k))) : pairs;
    const R: Record<string, unknown> = { meta: m, splats, bytes };
    const results: Record<string, AbResult[]> = {};
    for (const kind of only) {
      results[kind] = [];
      log(`\n### ${kind}`);
      for (const [label, a, b] of sel) {
        // the original never caches the corridor raster: nimbyNoCache is its only NIMBY case
        const A = arms[a], B = arms[b];
        const ka: CaseName = a === 'orig' && kind === 'nimbyNoCache' ? 'nimby' : kind, kb: CaseName = b === 'orig' && kind === 'nimbyNoCache' ? 'nimby' : kind;
        const r = runAB({ name: `${kind} ${label}`, a: () => A.run(ka), b: () => B.run(kb), aLabel: A.label, bLabel: B.label }, abOpts);
        results[kind].push(r);
        log(formatResult(r) + `  load ${loadAvg()[0]}`);
      }
    }
    R.results = results;
    R.loadAfter = loadAvg();
    out[m.name] = R;
    for (const a of Object.values(arms)) a.dispose();
  }
  out.loadAfter = loadAvg();
  return out;
});
