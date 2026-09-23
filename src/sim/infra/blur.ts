/**
 * Separable box blurs on N x N float grids (running sums, zero outside the map, no allocation).
 * Three box passes of radius r approximate a Gaussian with sigma^2 = r * (r + 1).
 */

/** horizontal box blur src -> dst (mass preserving, zero boundary) */
export function boxH(src: Float32Array, dst: Float32Array, N: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  for (let z = 0; z < N; z++) {
    const row = z * N;
    let s = 0;
    for (let x = 0; x < r && x < N; x++) s += src[row + x];
    for (let x = 0; x < N; x++) {
      if (x + r < N) s += src[row + x + r];
      dst[row + x] = s * inv;
      if (x - r >= 0) s -= src[row + x - r];
    }
  }
}

/** vertical box blur src -> dst (row-wise running column sums: cache friendly) */
let colSum = new Float64Array(0);
export function boxV(src: Float32Array, dst: Float32Array, N: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  if (colSum.length < N) colSum = new Float64Array(N);
  const cs = colSum;
  cs.fill(0, 0, N);
  for (let z = 0; z < r && z < N; z++) {
    const row = z * N;
    for (let x = 0; x < N; x++) cs[x] += src[row + x];
  }
  for (let z = 0; z < N; z++) {
    const row = z * N;
    if (z + r < N) {
      const add = (z + r) * N;
      for (let x = 0; x < N; x++) cs[x] += src[add + x];
    }
    for (let x = 0; x < N; x++) dst[row + x] = cs[x] * inv;
    if (z - r >= 0) {
      const sub = (z - r) * N;
      for (let x = 0; x < N; x++) cs[x] -= src[sub + x];
    }
  }
}

/** in-place ~Gaussian blur of `a` (3 box passes of radius r), tmp = scratch of same size */
export function blur3(a: Float32Array, tmp: Float32Array, N: number, r: number): void {
  if (r <= 0) return;
  for (let p = 0; p < 3; p++) {
    boxH(a, tmp, N, r);
    boxV(tmp, a, N, r);
  }
}

/** sigma^2 of blur3 with radius r */
export function blurSigma2(r: number): number {
  return r * (r + 1);
}

/** shift a field by a fractional offset (dx, dz) cells with bilinear sampling: dst(x,z) = src(x - dx, z - dz) */
export function shiftField(src: Float32Array, dst: Float32Array, N: number, dx: number, dz: number): void {
  const fx = Math.floor(dx), fz = Math.floor(dz);
  const tx = dx - fx, tz = dz - fz;
  const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;
  for (let z = 0; z < N; z++) {
    const sz0 = z - fz, sz1 = z - fz - 1;
    for (let x = 0; x < N; x++) {
      const sx0 = x - fx, sx1 = x - fx - 1;
      let v = 0;
      if (sz0 >= 0 && sz0 < N) {
        if (sx0 >= 0 && sx0 < N) v += w00 * src[sz0 * N + sx0];
        if (sx1 >= 0 && sx1 < N) v += w10 * src[sz0 * N + sx1];
      }
      if (sz1 >= 0 && sz1 < N) {
        if (sx0 >= 0 && sx0 < N) v += w01 * src[sz1 * N + sx0];
        if (sx1 >= 0 && sx1 < N) v += w11 * src[sz1 * N + sx1];
      }
      dst[z * N + x] = v;
    }
  }
}

/**
 * Blur at reduced resolution: downsample `src` (N x N) by `f` (block sums), blur3 with radius r at coarse
 * resolution, upsample bilinearly and ADD gain * density into `acc`. Effective fine sigma^2 = f^2 * r(r+1).
 * `coarse` / `coarseTmp` must hold (ceil(N/f))^2 floats.
 */
let upKey = '';
let upI0 = new Int32Array(0), upI1 = new Int32Array(0), upT = new Float32Array(0);
let upRow = new Float32Array(0);
function upTables(N: number, f: number, M: number): void {
  const key = N + ':' + f;
  if (key === upKey) return;
  upKey = key;
  upI0 = new Int32Array(N); upI1 = new Int32Array(N); upT = new Float32Array(N);
  for (let x = 0; x < N; x++) {
    const fx = (x + 0.5) / f - 0.5;
    let x0 = Math.floor(fx);
    const t = fx - x0;
    let x1 = x0 + 1;
    if (x0 < 0) x0 = 0;
    if (x1 >= M) x1 = M - 1;
    upI0[x] = x0; upI1[x] = x1; upT[x] = t;
  }
  if (upRow.length < M) upRow = new Float32Array(M);
}

export function blurDownAdd(src: Float32Array, acc: Float32Array, N: number, f: number, r: number, gain: number, coarse: Float32Array, coarseTmp: Float32Array): void {
  const M = Math.ceil(N / f);
  coarse.fill(0, 0, M * M);
  const sh = f === 2 ? 1 : f === 4 ? 2 : f === 8 ? 3 : -1;
  for (let z = 0; z < N; z++) {
    const cz = sh >= 0 ? z >> sh : (z / f) | 0;
    const row = z * N, crow = cz * M;
    if (sh >= 0) {
      for (let x = 0; x < N; x++) {
        const v = src[row + x];
        if (v !== 0) coarse[crow + (x >> sh)] += v;
      }
    } else {
      for (let x = 0; x < N; x++) {
        const v = src[row + x];
        if (v !== 0) coarse[crow + ((x / f) | 0)] += v;
      }
    }
  }
  blur3(coarse, coarseTmp, M, r);
  const g = gain / (f * f);
  upTables(N, f, M);
  const I0 = upI0, I1 = upI1, T = upT;
  const R = upRow;
  for (let z = 0; z < N; z++) {
    // vertical interpolation of the two coarse rows into R (pre-scaled by g)
    const tz = T[z];
    const r0 = I0[z] * M, r1 = I1[z] * M;
    const a = (1 - tz) * g, b = tz * g;
    for (let m = 0; m < M; m++) R[m] = coarse[r0 + m] * a + coarse[r1 + m] * b;
    const row = z * N;
    for (let x = 0; x < N; x++) {
      const t = T[x];
      const v0 = R[I0[x]];
      acc[row + x] += v0 + (R[I1[x]] - v0) * t;
    }
  }
}
