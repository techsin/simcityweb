/**
 * Micro A/B on a real round of the fixture (node, CPU time, tools/bench/ab.ts protocol): the state after round 0's
 * search is captured once, then
 *   sort       the candidate ordering: JS native (Float64Array.prototype.sort of the packed keys, traffic.ts) vs JS
 *              LSD radix (fair core) vs wasm LSD radix (traffic.rs), inputs copied in each rep for all three
 *   logit      the mode split of every candidate (3 exps, shares, time): JS (Math.exp) vs wasm with the inline fdlibm
 *              vs wasm with imported Math.exp (benchmark-only build)
 *   roundMatch the whole kernel (candidates, keys, sort, proposals, accept loop, commits, forest walk, volNew):
 *              fair JS vs wasm (SIMD) vs wasm scalar; the mutated arrays are restored before every rep (restore
 *              cost is in both sides)
 *   args: --fixture dense1m [--fixtures DIR] [--reps 31] [--scalar FILE] [--imp FILE]
 */
import { benchMain, loadAvg } from '../node';
import { formatResult, runAB, type AbResult } from '../ab';
import { initSimWasmSync, simWasmInstance, simWasmStatus, type SimWasmInstance } from '../../../src/wasm/simWasm';
import { makeWasmTrafficCore } from '../../../src/wasm/kernels/trafficBind';
import { makeFairTrafficCore, type Arrs } from '../../../src/wasm/js/trafficCore';
import type { TrafficCoreApi } from '../../../src/wasm/kernels/trafficLayout';
import { installTrafficCore } from '../../../src/wasm/kernels/trafficDriver';
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { deps, fairSearch, P } from './deps';
import { fixtureDir, loadCity } from './fixtures';
import { cpuMs } from './arms';
import { instanceFromFile } from './instances';

interface BenchEx {
  traffic_bench_sort(k: number, k2: number, i: number, i2: number, h: number, n: number): number;
  traffic_bench_logit(u: number, out: number, n: number): void;
}

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
  const spec = opt('--fixture', 'dense1m')!;
  const reps = Number(opt('--reps', '31'));
  if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
  const W = simWasmInstance()!;
  const scalar = opt('--scalar') ? instanceFromFile(opt('--scalar')!, 'scalar') : null;
  const imp = opt('--imp') ? instanceFromFile(opt('--imp')!, 'imported-math') : null;
  const ab = (c: Parameters<typeof runAB>[0]) => { const r = runAB(c, { reps, clock: cpuMs, clockName: 'cpu', warmupMs: 500, minSampleMs: 6 }); log(formatResult(r)); return r; };
  const results: AbResult[] = [];
  // one system per core, stepped to "round 0 searched"
  const prepared = async (core: TrafficCoreApi) => {
    const st = (await loadCity(spec, fixtureDir(args))).st;
    const systems = createSystems();
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const tr = systems.find((s) => s.name === 'traffic') as any;
    installTrafficCore(tr, deps, core);
    const sim = new Simulation(st, systems);
    tr.runCycleSync(sim);
    tr.phase = 0;
    tr.lastCycleStart = st.day;
    while (tr.phase !== 4) tr.step(sim); // PH_RMATCH of round 0
    return { tr, sim, core };
  };
  const F = await prepared(makeFairTrafficCore(P, fairSearch));
  const Wc = await prepared(makeWasmTrafficCore(P, { search: fairSearch, label: 'wasm' }));
  const Sc = scalar ? await prepared(makeWasmTrafficCore(P, { search: fairSearch, instance: () => scalar, label: 'wasm-scalar' })) : null;
  log(`# ${spec}: origins ${F.core.c.oN}, clusters ${F.core.c.qN}, SA settled ${F.core.c.saSettled}; load ${loadAvg().join(' ')}`);

  // ------------------------------------------------------------------ candidates / keys of round 0 (as the kernels compute them)
  const A = F.core.A as unknown as Arrs, c = F.core.c;
  const cand: number[] = [], kf: number[] = [];
  let maxD = 1;
  for (let o = 0; o < c.oN; o++) {
    if (A.oU[o] < 0.01) continue;
    let best = -1, bd = Infinity;
    for (let q = A.oEntS[o], q1 = q + A.oEntC[o]; q < q1; q++) { const v = A.ent[q]; if (A.saDone[v] === 1 && A.saDist[v] < bd) { bd = A.saDist[v]; best = v; } }
    if (best < 0) continue;
    cand.push(o); kf.push(best);
    if (bd > maxD) maxD = bd;
  }
  let M = 1;
  while (M < c.oN) M *= 2;
  const qq = Math.max(1, Math.floor(2 ** 50 / (M * (maxD + 1))));
  const nc = cand.length;
  const K = new Float64Array(nc), packed = new Float64Array(nc);
  for (let k = 0; k < nc; k++) {
    const o = cand[k], node = kf[k];
    let g = A.saDist[node];
    const trT = A.oTrT[o];
    if (trT < Infinity) { const cq = A.saSrc[node]; const carPure = g - P.priceMax - A.qNoise[cq] - A.qPrice[cq] + P.carOverhead; if (trT < carPure) g -= carPure - trT; }
    K[k] = Math.floor(Math.max(0, g) * qq);
    packed[k] = K[k] * M + o;
  }
  log(`# round 0: ${nc} candidates, M ${M}, max key ${Math.max(...K).toExponential(3)} (${Math.ceil(Math.log2(Math.max(...K) + 1))} bits)`);
  // ------------------------------------------------------------------ sort
  const work = new Float64Array(nc);
  const jsNative = () => { work.set(packed); work.sort(); };
  const lo = new Uint32Array(nc), hi = new Uint32Array(nc), lo2 = new Uint32Array(nc), hi2 = new Uint32Array(nc), ix = new Int32Array(nc), ix2 = new Int32Array(nc);
  const hist = new Int32Array(5 * 2048);
  let maxK = 0;
  for (let k = 0; k < nc; k++) if (K[k] > maxK) maxK = K[k];
  // the fair core's radix sort (same function body), inputs rebuilt each rep like the kernel does
  const radixJs = () => {
    for (let k = 0; k < nc; k++) { const x = K[k]; const l = x >>> 0; lo[k] = l; hi[k] = (x - l) / 4294967296; ix[k] = cand[k]; }
    radixSortJs(nc, maxK, lo, hi, lo2, hi2, ix, ix2, hist);
  };
  const h = W.heap;
  const pk = h.alloc(8 * nc * 2 + 8 * nc + 4 * 5 * 2048 + 64, 16);
  const pk2 = pk + 8 * nc, pi = pk + 16 * nc, pi2 = pi + 4 * nc, ph = pi2 + 4 * nc;
  const Kb = new BigUint64Array(nc);
  for (let k = 0; k < nc; k++) Kb[k] = BigInt(K[k]);
  const exW = W.exports as unknown as BenchEx;
  const candI = Int32Array.from(cand);
  const radixWasm = () => {
    const buf = h.memory.buffer;
    new BigUint64Array(buf, pk, nc).set(Kb);
    new Int32Array(buf, pi, nc).set(candI);
    exW.traffic_bench_sort(pk, pk2, pi, pi2, ph, nc);
  };
  // all three produce the same order
  jsNative();
  const want = Array.from(work, (x) => x % M);
  radixJs();
  const gotJs = radixSortJs(nc, maxK, lo, hi, lo2, hi2, ix, ix2, hist) ? ix2 : ix;
  void gotJs;
  radixWasm();
  {
    radixJs();
    // recompute for the check (radixJs sorted into ix / ix2)
    for (let k = 0; k < nc; k++) { const x = K[k]; const l = x >>> 0; lo[k] = l; hi[k] = (x - l) / 4294967296; ix[k] = cand[k]; }
    const sw = radixSortJs(nc, maxK, lo, hi, lo2, hi2, ix, ix2, hist);
    const js = sw ? ix2 : ix;
    const sww = exW.traffic_bench_sort(pk, pk2, pi, pi2, ph, 0); void sww;
    new BigUint64Array(h.memory.buffer, pk, nc).set(Kb);
    new Int32Array(h.memory.buffer, pi, nc).set(candI);
    const r = exW.traffic_bench_sort(pk, pk2, pi, pi2, ph, nc);
    const ws = new Int32Array(h.memory.buffer, r ? pi2 : pi, nc);
    for (let k = 0; k < nc; k++) if (js[k] !== want[k] || ws[k] !== want[k]) throw new Error(`sort order differs at ${k}`);
  }
  results.push(ab({ name: `sort ${nc} keys: JS native -> JS radix`, a: jsNative, b: radixJs, aLabel: 'js native', bLabel: 'js radix' }));
  results.push(ab({ name: `sort ${nc} keys: JS native -> wasm radix`, a: jsNative, b: radixWasm, aLabel: 'js native', bLabel: 'wasm radix' }));
  results.push(ab({ name: `sort ${nc} keys: JS radix -> wasm radix`, a: radixJs, b: radixWasm, aLabel: 'js radix', bLabel: 'wasm radix' }));

  // ------------------------------------------------------------------ logit
  const U: number[] = [];
  const beta = P.modeBeta, trBonus = F.core.s.trBonus;
  for (let k = 0; k < nc; k++) {
    const o = cand[k], node = kf[k], q = A.saSrc[node];
    const d = A.saDist[node] - P.priceMax - A.qNoise[q] - A.qPrice[q];
    const carT = d + P.carOverhead, carOk = d <= P.maxCommute;
    const walkT = A.qBase[q] === 0 && A.saHops[node] <= P.walkMax ? (A.saHops[node] + 1) * P.walkT : Infinity;
    const trT = A.oTrT[o], wl = A.oWealth[o] - 1;
    const uc = carOk ? -beta * carT + P.carBias[wl] : -Infinity;
    const ut = trT < Infinity ? -beta * trT + P.trBias[wl] + trBonus : -Infinity;
    const uw = walkT < Infinity ? -beta * walkT + P.walkBias : -Infinity;
    if (Math.max(uc, ut, uw) === -Infinity) continue;
    U.push(uc, ut, uw, carT, trT, walkT);
  }
  const nl = U.length / 6;
  const Uj = Float64Array.from(U), Oj = new Float64Array(4 * nl);
  const logitJs = () => {
    for (let i = 0; i < nl; i++) {
      const uc = Uj[6 * i], ut = Uj[6 * i + 1], uw = Uj[6 * i + 2], carT = Uj[6 * i + 3], trT = Uj[6 * i + 4], walkT = Uj[6 * i + 5];
      const um = Math.max(uc, ut, uw);
      const ec = uc > -Infinity ? (uc === um && uc < Infinity ? 1 : Math.exp(uc - um)) : 0;
      const et = ut > -Infinity ? (ut === um && ut < Infinity ? 1 : Math.exp(ut - um)) : 0;
      const ew = uw > -Infinity ? (uw === um && uw < Infinity ? 1 : Math.exp(uw - um)) : 0;
      const tot = ec + et + ew;
      const sc = ec / tot, st = et / tot, sw = ew / tot;
      Oj[4 * i] = sc; Oj[4 * i + 1] = st; Oj[4 * i + 2] = sw;
      Oj[4 * i + 3] = sc * (sc > 0 ? carT : 0) + st * (st > 0 ? trT : 0) + sw * (sw > 0 ? walkT : 0);
    }
  };
  const logitOn = (w: SimWasmInstance) => {
    const hh = w.heap, pu = hh.alloc(48 * nl + 32 * nl + 64, 16), po = pu + 48 * nl;
    new Float64Array(hh.memory.buffer, pu, 6 * nl).set(Uj);
    const ex = w.exports as unknown as BenchEx;
    return { run: () => ex.traffic_bench_logit(pu, po, nl), out: () => new Float64Array(hh.memory.buffer, po, 4 * nl) };
  };
  const LW = logitOn(W);
  logitJs(); LW.run();
  { const o = LW.out(); for (let i = 0; i < 4 * nl; i++) if (!Object.is(o[i], Oj[i])) throw new Error(`logit differs at ${i}`); }
  results.push(ab({ name: `logit ${nl} pieces (3 exp): JS -> wasm fdlibm`, a: logitJs, b: LW.run, aLabel: 'js', bLabel: 'wasm fdlibm' }));
  if (imp) {
    const LI = logitOn(imp);
    LI.run();
    { const o = LI.out(); for (let i = 0; i < 4 * nl; i++) if (!Object.is(o[i], Oj[i])) throw new Error(`logit (imported exp) differs at ${i}`); }
    results.push(ab({ name: `logit ${nl} pieces (3 exp): JS -> wasm imported exp`, a: logitJs, b: LI.run, aLabel: 'js', bLabel: 'wasm import' }));
    results.push(ab({ name: `logit ${nl} pieces: wasm imported exp -> fdlibm`, a: LI.run, b: LW.run, aLabel: 'wasm import', bLabel: 'wasm fdlibm' }));
  }

  // ------------------------------------------------------------------ the whole roundMatch kernel (state restored per rep)
  const MUT = ['oU', 'oAsg', 'oTimeSum', 'oCarW', 'oTrW', 'oWalkW', 'oCarNode', 'oLastD', 'candNode', 'qAsg', 'qTimeSum', 'qProp', 'acc', 'tAcc', 'stLoad', 'volNew'];
  const snapshot = (core: TrafficCoreApi) => {
    const a = core.A as unknown as Record<string, Float32Array>;
    const s = MUT.map((k) => a[k].slice());
    return () => { const b = core.A as unknown as Record<string, Float32Array>; MUT.forEach((k, i) => b[k].set(s[i])); };
  };
  const rF = snapshot(F.core), rW = snapshot(Wc.core), rS = Sc ? snapshot(Sc.core) : null;
  const mF = () => { rF(); F.core.roundMatch(0); };
  const mW = () => { rW(); Wc.core.roundMatch(0); };
  mF(); mW();
  for (const k of MUT) {
    const x = (F.core.A as unknown as Record<string, Float32Array>)[k], y = (Wc.core.A as unknown as Record<string, Float32Array>)[k];
    const n = k.startsWith('o') || k === 'candNode' ? c.oN : k.startsWith('q') ? c.qN : k === 'tAcc' ? c.total : k === 'stLoad' ? c.stopN : c.n;
    for (let i = 0; i < n; i++) if (!Object.is(x[i], y[i])) throw new Error(`roundMatch replay differs: ${k}[${i}]`);
  }
  const restoreOnly = () => { rF(); };
  results.push(ab({ name: 'state restore alone (both sides pay it)', a: restoreOnly, b: () => rW(), aLabel: 'restore js', bLabel: 'restore wasm' }));
  results.push(ab({ name: 'roundMatch round 0: fair JS -> wasm', a: mF, b: mW, aLabel: 'fair js', bLabel: 'wasm' }));
  if (Sc && rS) {
    const mS = () => { rS(); Sc.core.roundMatch(0); };
    results.push(ab({ name: 'roundMatch round 0: wasm scalar -> wasm SIMD', a: mS, b: mW, aLabel: 'wasm scalar', bLabel: 'wasm simd' }));
  }
  h.free(pk);
  return { fixture: spec, candidates: nc, pieces: nl, results, load: loadAvg() };
});

/** the fair core's radix sort (copied 1:1 from src/wasm/js/trafficCore.ts, where it is module-private) */
function radixSortJs(nc: number, maxK: number, lo: Uint32Array, hi: Uint32Array, lo2: Uint32Array, hi2: Uint32Array, idx: Int32Array, idx2: Int32Array, hist: Int32Array): boolean {
  const mHi = Math.floor(maxK / 4294967296), mLo = maxK >>> 0;
  const bits = mHi > 0 ? 64 - Math.clz32(mHi) : 32 - Math.clz32(mLo);
  const passes = Math.ceil(bits / 11);
  hist.fill(0, 0, passes * 2048);
  for (let k = 0; k < nc; k++) {
    const l = lo[k], h = hi[k];
    hist[l & 2047]++;
    if (passes > 1) hist[2048 + ((l >>> 11) & 2047)]++;
    if (passes > 2) hist[4096 + (((l >>> 22) | (h << 10)) & 2047)]++;
    if (passes > 3) hist[6144 + ((h >>> 1) & 2047)]++;
    if (passes > 4) hist[8192 + ((h >>> 12) & 2047)]++;
  }
  let swapped = false;
  for (let p = 0; p < passes; p++) {
    const row = p * 2048;
    const sLo = swapped ? lo2 : lo, sHi = swapped ? hi2 : hi, sIdx = swapped ? idx2 : idx;
    const dLo = swapped ? lo : lo2, dHi = swapped ? hi : hi2, dIdx = swapped ? idx : idx2;
    const s = 11 * p;
    const dig0 = nc > 0 ? (s + 11 <= 32 ? (sLo[0] >>> s) & 2047 : s >= 32 ? (sHi[0] >>> (s - 32)) & 2047 : ((sLo[0] >>> s) | (sHi[0] << (32 - s))) & 2047) : 0;
    if (hist[row + dig0] === nc) continue;
    let sum = 0;
    for (let b = 0; b < 2048; b++) { const t = hist[row + b]; hist[row + b] = sum; sum += t; }
    if (s + 11 <= 32) {
      for (let k = 0; k < nc; k++) { const l = sLo[k]; const pos = hist[row + ((l >>> s) & 2047)]++; dLo[pos] = l; dHi[pos] = sHi[k]; dIdx[pos] = sIdx[k]; }
    } else if (s >= 32) {
      const t = s - 32;
      for (let k = 0; k < nc; k++) { const h = sHi[k]; const pos = hist[row + ((h >>> t) & 2047)]++; dLo[pos] = sLo[k]; dHi[pos] = h; dIdx[pos] = sIdx[k]; }
    } else {
      const t = 32 - s;
      for (let k = 0; k < nc; k++) { const l = sLo[k], h = sHi[k]; const pos = hist[row + (((l >>> s) | (h << t)) & 2047)]++; dLo[pos] = l; dHi[pos] = h; dIdx[pos] = sIdx[k]; }
    }
    swapped = !swapped;
  }
  return swapped;
}
