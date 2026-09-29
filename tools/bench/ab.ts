/**
 * A/B micro-benchmark harness for kernel ports (environment-agnostic: node worker thread or browser Web Worker).
 *
 * Method (robust on a heavily loaded machine):
 *  - warm-up: A and B alternate until both ran >= warmupMs (JS reaches TurboFan, wasm tiers Liftoff -> TurboFan)
 *  - calibration: `inner` calls per sample so one A sample takes >= minSampleMs of clock time
 *  - samples: `reps` pairs, INTERLEAVED and order-alternated (AB, BA, AB, ...), clock = CPU time when available
 *    (node: process.cpuUsage from an otherwise idle worker thread, see node.ts) else performance.now() (browsers)
 *  - statistics: per-call median / min of A and B, the paired ratio t_B / t_A per rep (median) with a 95% bootstrap
 *    CI (2000 resamples of the pairs); speedup = 1 / ratio (> 1: B is faster)
 */

export interface AbCase {
  name: string;
  /** baseline (JS) */
  a: () => void;
  /** candidate (wasm) */
  b: () => void;
  /** optional labels, e.g. 'js' / 'wasm copy' */
  aLabel?: string;
  bLabel?: string;
}

export interface AbOptions {
  reps?: number;
  warmupMs?: number;
  minSampleMs?: number;
  /** thread CPU time in ms (monotonic); defaults to wall clock */
  clock?: () => number;
  clockName?: string;
  /** deterministic bootstrap seed */
  seed?: number;
}

export interface SideStats {
  label: string;
  /** per call, ms */
  median: number;
  min: number;
  mean: number;
  /** per-call wall-clock median, ms (for reference; noisy under load) */
  wallMedian: number;
}

export interface AbResult {
  name: string;
  clock: string;
  reps: number;
  inner: number;
  a: SideStats;
  b: SideStats;
  /** median of paired t_B / t_A and its 95% bootstrap CI */
  ratio: { median: number; lo: number; hi: number };
  /** 1 / ratio: > 1 means B faster */
  speedup: { median: number; lo: number; hi: number };
}

const wall = (): number => performance.now();

function median(xs: number[]): number {
  const s = xs.slice().sort((p, q) => p - q);
  const n = s.length;
  return n === 0 ? NaN : n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** 95% bootstrap CI of the median of `xs` */
export function bootstrapMedianCI(xs: number[], seed = 1, resamples = 2000): { lo: number; hi: number } {
  const r = rng(seed);
  const n = xs.length;
  const meds: number[] = [];
  const buf = new Array<number>(n);
  for (let k = 0; k < resamples; k++) {
    for (let i = 0; i < n; i++) buf[i] = xs[(r() * n) | 0];
    meds.push(median(buf));
  }
  meds.sort((p, q) => p - q);
  return { lo: meds[Math.floor(0.025 * resamples)], hi: meds[Math.min(resamples - 1, Math.ceil(0.975 * resamples))] };
}

function timeIt(fn: () => void, inner: number, clock: () => number): { t: number; w: number } {
  const w0 = wall();
  const t0 = clock();
  for (let i = 0; i < inner; i++) fn();
  const t1 = clock();
  return { t: (t1 - t0) / inner, w: (wall() - w0) / inner };
}

export function runAB(c: AbCase, opts: AbOptions = {}): AbResult {
  const reps = opts.reps ?? 41;
  const warmupMs = opts.warmupMs ?? 400;
  const minSampleMs = opts.minSampleMs ?? 8;
  const clock = opts.clock ?? wall;
  // warm-up (alternating so both tiers up under the same conditions)
  let ta = 0, tb = 0, calls = 0;
  const wu0 = clock();
  while ((ta < warmupMs || tb < warmupMs || calls < 30) && clock() - wu0 < 30 * warmupMs) {
    let t0 = clock();
    c.a();
    ta += clock() - t0;
    t0 = clock();
    c.b();
    tb += clock() - t0;
    calls++;
  }
  // calibrate: one sample of the slower side >= minSampleMs
  const per = Math.max(ta, tb) / calls;
  const inner = Math.max(1, Math.ceil(minSampleMs / Math.max(per, 1e-6)));
  const A: number[] = [], B: number[] = [], AW: number[] = [], BW: number[] = [], R: number[] = [];
  for (let k = 0; k < reps; k++) {
    let a: { t: number; w: number }, b: { t: number; w: number };
    if (k % 2 === 0) {
      a = timeIt(c.a, inner, clock);
      b = timeIt(c.b, inner, clock);
    } else {
      b = timeIt(c.b, inner, clock);
      a = timeIt(c.a, inner, clock);
    }
    A.push(a.t); B.push(b.t); AW.push(a.w); BW.push(b.w);
    R.push(b.t / Math.max(a.t, 1e-9));
  }
  const ci = bootstrapMedianCI(R, opts.seed ?? 12345);
  const rm = median(R);
  const side = (label: string, xs: number[], ws: number[]): SideStats => ({
    label, median: median(xs), min: Math.min(...xs), mean: xs.reduce((p, q) => p + q, 0) / xs.length, wallMedian: median(ws),
  });
  return {
    name: c.name,
    clock: opts.clockName ?? 'wall',
    reps,
    inner,
    a: side(c.aLabel ?? 'A', A, AW),
    b: side(c.bLabel ?? 'B', B, BW),
    ratio: { median: rm, lo: ci.lo, hi: ci.hi },
    speedup: { median: 1 / rm, lo: 1 / ci.hi, hi: 1 / ci.lo },
  };
}

const fmtMs = (ms: number): string => (ms >= 1 ? ms.toFixed(3) + ' ms' : (ms * 1000).toFixed(1) + ' µs');

/** one aligned text line per result */
export function formatResult(r: AbResult): string {
  return (
    `${r.name.padEnd(46)} ${r.a.label}: ${fmtMs(r.a.median).padStart(10)} (min ${fmtMs(r.a.min).padStart(9)})  ` +
    `${r.b.label}: ${fmtMs(r.b.median).padStart(10)} (min ${fmtMs(r.b.min).padStart(9)})  ` +
    `speedup ${r.speedup.median.toFixed(2)}x [${r.speedup.lo.toFixed(2)}, ${r.speedup.hi.toFixed(2)}]  (x${r.inner}, n=${r.reps}, ${r.clock})`
  );
}
