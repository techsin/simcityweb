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
 * Plume shift: dst = 0.5 * shift(src, dx, dz) + 0.5 * shift(src, 2 dx, 2 dz) (bilinear, zero outside the map), i.e. the
 * average of two copies drifted by d/2 and d (prevailing wind; SIM_DEPTH_SPEC WP3 C2). One pass, no allocation.
 */
export function shiftPlume(src: Float32Array, dst: Float32Array, N: number, dx: number, dz: number): void {
  const ax = Math.floor(dx), az = Math.floor(dz), bx = Math.floor(2 * dx), bz = Math.floor(2 * dz);
  const tax = dx - ax, taz = dz - az, tbx = 2 * dx - bx, tbz = 2 * dz - bz;
  const a00 = 0.5 * (1 - tax) * (1 - taz), a10 = 0.5 * tax * (1 - taz), a01 = 0.5 * (1 - tax) * taz, a11 = 0.5 * tax * taz;
  const b00 = 0.5 * (1 - tbx) * (1 - tbz), b10 = 0.5 * tbx * (1 - tbz), b01 = 0.5 * (1 - tbx) * tbz, b11 = 0.5 * tbx * tbz;
  for (let z = 0; z < N; z++) {
    const za0 = z - az, za1 = za0 - 1, zb0 = z - bz, zb1 = zb0 - 1;
    const ra0 = za0 >= 0 && za0 < N ? za0 * N : -1, ra1 = za1 >= 0 && za1 < N ? za1 * N : -1;
    const rb0 = zb0 >= 0 && zb0 < N ? zb0 * N : -1, rb1 = zb1 >= 0 && zb1 < N ? zb1 * N : -1;
    const row = z * N;
    for (let x = 0; x < N; x++) {
      const xa0 = x - ax, xa1 = xa0 - 1, xb0 = x - bx, xb1 = xb0 - 1;
      const ia0 = xa0 >= 0 && xa0 < N, ia1 = xa1 >= 0 && xa1 < N, ib0 = xb0 >= 0 && xb0 < N, ib1 = xb1 >= 0 && xb1 < N;
      let v = 0;
      if (ra0 >= 0) { if (ia0) v += a00 * src[ra0 + xa0]; if (ia1) v += a10 * src[ra0 + xa1]; }
      if (ra1 >= 0) { if (ia0) v += a01 * src[ra1 + xa0]; if (ia1) v += a11 * src[ra1 + xa1]; }
      if (rb0 >= 0) { if (ib0) v += b00 * src[rb0 + xb0]; if (ib1) v += b10 * src[rb0 + xb1]; }
      if (rb1 >= 0) { if (ib0) v += b01 * src[rb1 + xb0]; if (ib1) v += b11 * src[rb1 + xb1]; }
      dst[row + x] = v;
    }
  }
}

/** single box average of radius r (a (2r+1)^2 mean, zero outside the map): src -> dst, tmp = scratch */
export function boxAverage(src: Float32Array, dst: Float32Array, tmp: Float32Array, N: number, r: number): void {
  boxH(src, tmp, N, r);
  boxV(tmp, dst, N, r);
}

/**
 * Blur at reduced resolution: downsample `src` (N x N) by `f` (block sums), blur3 with radius r at coarse
 * resolution, upsample bilinearly and ADD gain * density into `acc`. Effective fine sigma^2 = f^2 * r(r+1).
 * `coarse` / `coarseTmp` must hold (ceil(N/f))^2 floats.
 */
let upKey = '';
let upI0 = new Int32Array(0), upI1 = new Int32Array(0), upT = new Float32Array(0);
let upZ0 = new Int32Array(0), upZ1 = new Int32Array(0), upTZ = new Float32Array(0);
let upRow = new Float32Array(0);
/** bilinear upsampling tables for fine x -> coarse (x0, x1, t), shifted by `off` fine cells (sample at x - off) */
function axisTable(N: number, f: number, M: number, off: number, I0: Int32Array, I1: Int32Array, T: Float32Array): void {
  for (let x = 0; x < N; x++) {
    const fx = (x - off + 0.5) / f - 0.5;
    let x0 = Math.floor(fx);
    const t = fx - x0;
    let x1 = x0 + 1;
    if (x0 < 0) x0 = 0;
    if (x1 < 0) x1 = 0;
    if (x0 >= M) x0 = M - 1;
    if (x1 >= M) x1 = M - 1;
    I0[x] = x0; I1[x] = x1; T[x] = t;
  }
}
function upTables(N: number, f: number, M: number, dx: number, dz: number): void {
  const key = N + ':' + f + ':' + dx + ':' + dz;
  if (key === upKey) return;
  upKey = key;
  if (upI0.length !== N) {
    upI0 = new Int32Array(N); upI1 = new Int32Array(N); upT = new Float32Array(N);
    upZ0 = new Int32Array(N); upZ1 = new Int32Array(N); upTZ = new Float32Array(N);
  }
  axisTable(N, f, M, dx, upI0, upI1, upT);
  axisTable(N, f, M, dz, upZ0, upZ1, upTZ);
  if (upRow.length < M) upRow = new Float32Array(M);
}

/** downsample `src` (N x N) by `f` (block sums) into `coarse` and blur3 it there with radius r. Returns M = ceil(N / f). */
export function blurDown(src: Float32Array, N: number, f: number, r: number, coarse: Float32Array, coarseTmp: Float32Array): number {
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
  return M;
}

/**
 * upsample a coarse field (from blurDown) bilinearly and ADD gain * density into `acc`, shifted by (dx, dz) fine cells
 * (acc(x, z) += up(x - dx, z - dz): a drifting plume at no extra cost). Values beyond the coarse edge clamp to it.
 */
export function upsampleAdd(coarse: Float32Array, acc: Float32Array, N: number, f: number, gain: number, dx = 0, dz = 0): void {
  const M = Math.ceil(N / f);
  const g = gain / (f * f);
  upTables(N, f, M, dx, dz);
  const I0 = upI0, I1 = upI1, T = upT, Z0 = upZ0, Z1 = upZ1, TZ = upTZ;
  const R = upRow;
  for (let z = 0; z < N; z++) {
    // vertical interpolation of the two coarse rows into R (pre-scaled by g)
    const tz = TZ[z];
    const r0 = Z0[z] * M, r1 = Z1[z] * M;
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

export function blurDownAdd(src: Float32Array, acc: Float32Array, N: number, f: number, r: number, gain: number, coarse: Float32Array, coarseTmp: Float32Array, dx = 0, dz = 0): void {
  blurDown(src, N, f, r, coarse, coarseTmp);
  upsampleAdd(coarse, acc, N, f, gain, dx, dz);
}
