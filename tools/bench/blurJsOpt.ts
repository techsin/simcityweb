/**
 * Benchmark-only control: the SAME restructuring as the Rust port (wasm/sim-kernels/src/blur.rs), written in plain
 * JS — boxH split at its branch boundaries with 4 rows interleaved, boxV with the add / store / subtract passes
 * fused per column. Bit-identical to src/sim/infra/blur.ts (checked by the benchmark before timing). It separates
 * "the algorithmic restructuring helps" from "WebAssembly helps": wasm must beat THIS, not only the original.
 */

function boxHRow(src: Float32Array, dst: Float32Array, row: number, N: number, r: number, inv: number): void {
  let s = 0;
  const head = r < N ? r : N;
  for (let x = 0; x < head; x++) s += src[row + x];
  const b = N > r ? N - r : 0;
  if (r <= b) {
    for (let x = 0; x < r; x++) { s += src[row + x + r]; dst[row + x] = s * inv; }
    for (let x = r; x < b; x++) { s += src[row + x + r]; dst[row + x] = s * inv; s -= src[row + x - r]; }
    for (let x = b; x < N; x++) { dst[row + x] = s * inv; s -= src[row + x - r]; }
  } else {
    for (let x = 0; x < b; x++) { s += src[row + x + r]; dst[row + x] = s * inv; }
    for (let x = b; x < head; x++) dst[row + x] = s * inv;
    for (let x = r; x < N; x++) { dst[row + x] = s * inv; s -= src[row + x - r]; }
  }
}

function boxHRows4(src: Float32Array, dst: Float32Array, row: number, N: number, r: number, inv: number): void {
  const r0 = row, r1 = row + N, r2 = row + 2 * N, r3 = row + 3 * N;
  let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
  const head = r < N ? r : N;
  for (let x = 0; x < head; x++) { a0 += src[r0 + x]; a1 += src[r1 + x]; a2 += src[r2 + x]; a3 += src[r3 + x]; }
  const b = N > r ? N - r : 0;
  if (r <= b) {
    for (let x = 0; x < r; x++) {
      const xr = x + r;
      a0 += src[r0 + xr]; a1 += src[r1 + xr]; a2 += src[r2 + xr]; a3 += src[r3 + xr];
      dst[r0 + x] = a0 * inv; dst[r1 + x] = a1 * inv; dst[r2 + x] = a2 * inv; dst[r3 + x] = a3 * inv;
    }
    for (let x = r; x < b; x++) {
      const xr = x + r, xl = x - r;
      a0 += src[r0 + xr]; a1 += src[r1 + xr]; a2 += src[r2 + xr]; a3 += src[r3 + xr];
      dst[r0 + x] = a0 * inv; dst[r1 + x] = a1 * inv; dst[r2 + x] = a2 * inv; dst[r3 + x] = a3 * inv;
      a0 -= src[r0 + xl]; a1 -= src[r1 + xl]; a2 -= src[r2 + xl]; a3 -= src[r3 + xl];
    }
    for (let x = b; x < N; x++) {
      const xl = x - r;
      dst[r0 + x] = a0 * inv; dst[r1 + x] = a1 * inv; dst[r2 + x] = a2 * inv; dst[r3 + x] = a3 * inv;
      a0 -= src[r0 + xl]; a1 -= src[r1 + xl]; a2 -= src[r2 + xl]; a3 -= src[r3 + xl];
    }
  } else {
    for (let x = 0; x < b; x++) {
      const xr = x + r;
      a0 += src[r0 + xr]; a1 += src[r1 + xr]; a2 += src[r2 + xr]; a3 += src[r3 + xr];
      dst[r0 + x] = a0 * inv; dst[r1 + x] = a1 * inv; dst[r2 + x] = a2 * inv; dst[r3 + x] = a3 * inv;
    }
    for (let x = b; x < head; x++) { dst[r0 + x] = a0 * inv; dst[r1 + x] = a1 * inv; dst[r2 + x] = a2 * inv; dst[r3 + x] = a3 * inv; }
    for (let x = r; x < N; x++) {
      const xl = x - r;
      dst[r0 + x] = a0 * inv; dst[r1 + x] = a1 * inv; dst[r2 + x] = a2 * inv; dst[r3 + x] = a3 * inv;
      a0 -= src[r0 + xl]; a1 -= src[r1 + xl]; a2 -= src[r2 + xl]; a3 -= src[r3 + xl];
    }
  }
}

export function boxHOpt(src: Float32Array, dst: Float32Array, N: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  let z = 0;
  for (; z + 4 <= N; z += 4) boxHRows4(src, dst, z * N, N, r, inv);
  for (; z < N; z++) boxHRow(src, dst, z * N, N, r, inv);
}

let col = new Float64Array(0);
export function boxVOpt(src: Float32Array, dst: Float32Array, N: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  if (col.length < N) col = new Float64Array(N);
  const cs = col;
  cs.fill(0, 0, N);
  const head = r < N ? r : N;
  for (let z = 0; z < head; z++) {
    const row = z * N;
    for (let x = 0; x < N; x++) cs[x] += src[row + x];
  }
  for (let z = 0; z < N; z++) {
    const row = z * N;
    const add = z + r < N, sub = z >= r;
    if (add && sub) {
      const ra = (z + r) * N, rs = (z - r) * N;
      for (let x = 0; x < N; x++) { const c = cs[x] + src[ra + x]; dst[row + x] = c * inv; cs[x] = c - src[rs + x]; }
    } else if (add) {
      const ra = (z + r) * N;
      for (let x = 0; x < N; x++) { const c = cs[x] + src[ra + x]; dst[row + x] = c * inv; cs[x] = c; }
    } else if (sub) {
      const rs = (z - r) * N;
      for (let x = 0; x < N; x++) { const c = cs[x]; dst[row + x] = c * inv; cs[x] = c - src[rs + x]; }
    } else {
      for (let x = 0; x < N; x++) dst[row + x] = cs[x] * inv;
    }
  }
}

export function blur3Opt(a: Float32Array, tmp: Float32Array, N: number, r: number): void {
  if (r <= 0) return;
  for (let p = 0; p < 3; p++) {
    boxHOpt(a, tmp, N, r);
    boxVOpt(tmp, a, N, r);
  }
}
