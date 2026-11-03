/**
 * Separable box blurs on N x N float grids (running sums, zero outside the map, no allocation).
 * Three box passes of radius r approximate a Gaussian with sigma^2 = r * (r + 1).
 */

// Split boundaries need integer grids; interleaved reads / writes need non-overlapping, unshared views.
function canRestructure(src: Float32Array, dst: Float32Array, N: number, r: number): boolean {
  return Number.isInteger(N) && N >= 0 && Number.isInteger(r) && r >= 0 && src.length >= N * N && dst.length >= N * N
    && src.buffer instanceof ArrayBuffer && dst.buffer instanceof ArrayBuffer
    && (src.buffer !== dst.buffer || src.byteOffset + src.byteLength <= dst.byteOffset || dst.byteOffset + dst.byteLength <= src.byteOffset);
}

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

/** horizontal box blur src -> dst (mass preserving, zero boundary) */
export function boxH(src: Float32Array, dst: Float32Array, N: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  if (canRestructure(src, dst, N, r)) {
    let z = 0;
    for (; z + 4 <= N; z += 4) boxHRows4(src, dst, z * N, N, r, inv);
    for (; z < N; z++) boxHRow(src, dst, z * N, N, r, inv);
    return;
  }
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
  if (canRestructure(src, dst, N, r)) {
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
    return;
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

/** B2: boxH over the rows [z0, z1) only — the same per-row operations as boxH (rows are independent), so ranges that
 *  cover every row once give boxH's result exactly */
export function boxHRows(src: Float32Array, dst: Float32Array, N: number, r: number, z0: number, z1: number): void {
  const inv = 1 / (2 * r + 1);
  if (canRestructure(src, dst, N, r)) {
    let z = z0;
    for (; z + 4 <= z1; z += 4) boxHRows4(src, dst, z * N, N, r, inv);
    for (; z < z1; z++) boxHRow(src, dst, z * N, N, r, inv);
    return;
  }
  for (let z = z0; z < z1; z++) {
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

/**
 * B2: boxV in row pieces — begin() is boxV's prologue (column sums of the first r rows), run(rows) continues the row
 * loop with the same per-row operations; the running column sums live in the run (not in boxV's module scratch, which
 * other code may use between two pieces). Rows in order give boxV's result exactly. src / dst must not change between
 * the pieces (except dst rows already written).
 */
export class BoxVRun {
  private cs: Float64Array<ArrayBuffer> = new Float64Array(0);
  private src: Float32Array = new Float32Array(0);
  private dst: Float32Array = new Float32Array(0);
  private N = 0;
  private r = 0;
  private inv = 1;
  private restructure = false;
  /** next row */
  z = 0;

  begin(src: Float32Array, dst: Float32Array, N: number, r: number): void {
    this.inv = 1 / (2 * r + 1);
    if (this.cs.length < N) this.cs = new Float64Array(N);
    const cs = this.cs;
    cs.fill(0, 0, N);
    for (let z = 0; z < r && z < N; z++) {
      const row = z * N;
      for (let x = 0; x < N; x++) cs[x] += src[row + x];
    }
    this.src = src; this.dst = dst; this.N = N; this.r = r;
    this.restructure = canRestructure(src, dst, N, r);
    this.z = 0;
  }

  /** the next `rows` rows; true when the last row is done */
  run(rows: number): boolean {
    const src = this.src, dst = this.dst, N = this.N, r = this.r, inv = this.inv, cs = this.cs;
    const z0 = this.z, z1 = Math.min(N, z0 + rows);
    if (this.restructure) {
      for (let z = z0; z < z1; z++) {
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
    } else {
      for (let z = z0; z < z1; z++) {
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
    this.z = z1;
    return z1 >= N;
  }
}

/**
 * B2 (G3): blur3 in row pieces — begin(), then run(rows) until it returns true. The six half passes (boxH a -> tmp, boxV
 * tmp -> a, three times) run in order, `rows` rows per call across the half passes (boxHRows; BoxVRun keeps its running
 * column sums itself, so other code may call boxV between two pieces). Rows in order give blur3's result exactly. a / tmp
 * must not change between the pieces except through the run.
 */
export class Blur3Run {
  private v = new BoxVRun();
  private a: Float32Array = new Float32Array(0);
  private t: Float32Array = new Float32Array(0);
  private N = 0;
  private r = 0;
  /** half passes done (0..6: even = boxH, odd = boxV) and the next row of the current half */
  half = 6;
  z = 0;

  begin(a: Float32Array, tmp: Float32Array, N: number, r: number): void {
    this.a = a; this.t = tmp; this.N = N; this.r = r;
    this.half = r <= 0 ? 6 : 0;
    this.z = 0;
  }

  /** rows of the whole blur (six half passes of N rows; 0 when r <= 0, as blur3 returns at once) */
  static rowsOf(N: number, r: number): number {
    return r <= 0 ? 0 : 6 * N;
  }

  /** the next `rows` rows (across half passes); true when the blur is complete */
  run(rows: number): boolean {
    const N = this.N, r = this.r;
    while (rows > 0 && this.half < 6) {
      if ((this.half & 1) === 0) {
        const z1 = Math.min(N, this.z + rows);
        boxHRows(this.a, this.t, N, r, this.z, z1);
        rows -= z1 - this.z;
        this.z = z1;
        if (z1 >= N) { this.half++; this.z = 0; this.v.begin(this.t, this.a, N, r); }
      } else {
        const z0 = this.v.z;
        const done = this.v.run(rows);
        rows -= this.v.z - z0;
        this.z = this.v.z;
        if (done) { this.half++; this.z = 0; }
      }
    }
    return this.half >= 6;
  }

  /** drop the references (stage end) */
  release(): void {
    this.a = this.t = new Float32Array(0);
    this.half = 6;
    this.z = 0;
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
let upI0 = new Int32Array(0), upI1 = new Int32Array(0), upT = new Float32Array(0), upW = new Float32Array(0);
let upZ0 = new Int32Array(0), upZ1 = new Int32Array(0), upTZ = new Float32Array(0), upWZ = new Float32Array(0);
let upRow = new Float32Array(0);
/**
 * bilinear upsampling tables for fine x -> coarse (x0, x1, t), shifted by `off` fine cells (sample at x - off).
 * W = weight of the sample: 1 inside the map, fading to 0 over one cell beyond it — a shifted plume brings no field in
 * from outside the map (clean air blows in over the upwind edge) instead of repeating the edge values.
 */
function axisTable(N: number, f: number, M: number, off: number, I0: Int32Array, I1: Int32Array, T: Float32Array, W: Float32Array): void {
  for (let x = 0; x < N; x++) {
    const s = x - off;
    const out = s < 0 ? -s : s > N - 1 ? s - (N - 1) : 0;
    W[x] = out >= 1 ? 0 : 1 - out;
    const fx = (s + 0.5) / f - 0.5;
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
    upI0 = new Int32Array(N); upI1 = new Int32Array(N); upT = new Float32Array(N); upW = new Float32Array(N);
    upZ0 = new Int32Array(N); upZ1 = new Int32Array(N); upTZ = new Float32Array(N); upWZ = new Float32Array(N);
  }
  axisTable(N, f, M, dx, upI0, upI1, upT, upW);
  axisTable(N, f, M, dz, upZ0, upZ1, upTZ, upWZ);
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
 * B2 (G3): blurDown's downsample over the fine rows [z0, z1) only (block sums into `coarse`). The caller zeroes coarse's
 * first M x M cells before the first range; ranges that cover every row once, in order, give blurDown's coarse field
 * before its blur3 exactly (each coarse cell adds its fine cells in blurDown's order).
 */
export function downsampleRows(src: Float32Array, N: number, f: number, coarse: Float32Array, z0: number, z1: number): void {
  const M = Math.ceil(N / f);
  const sh = f === 2 ? 1 : f === 4 ? 2 : f === 8 ? 3 : -1;
  for (let z = z0; z < z1; z++) {
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
}

/**
 * B2 (G3): upsampleAdd over the fine rows [z0, z1) only — the same per-row operations (rows are independent; the
 * interpolation tables are a pure cache of (N, f, dx, dz), rebuilt here when other code changed them in between), so
 * ranges that cover every row once give upsampleAdd's result exactly.
 */
export function upsampleAddRows(coarse: Float32Array, acc: Float32Array, N: number, f: number, gain: number, dx: number, dz: number, z0: number, z1: number): void {
  const M = Math.ceil(N / f);
  const g = gain / (f * f);
  upTables(N, f, M, dx, dz);
  const I0 = upI0, I1 = upI1, T = upT, WX = upW, Z0 = upZ0, Z1 = upZ1, TZ = upTZ, WZ = upWZ;
  const R = upRow;
  const shiftX = dx !== 0;
  for (let z = z0; z < z1; z++) {
    const wz = WZ[z];
    if (wz === 0) continue;
    const tz = TZ[z];
    const r0 = Z0[z] * M, r1 = Z1[z] * M;
    const a = (1 - tz) * g * wz, b = tz * g * wz;
    for (let m = 0; m < M; m++) R[m] = coarse[r0 + m] * a + coarse[r1 + m] * b;
    const row = z * N;
    if (shiftX) {
      for (let x = 0; x < N; x++) {
        const t = T[x];
        const v0 = R[I0[x]];
        acc[row + x] += (v0 + (R[I1[x]] - v0) * t) * WX[x];
      }
    } else {
      for (let x = 0; x < N; x++) {
        const t = T[x];
        const v0 = R[I0[x]];
        acc[row + x] += v0 + (R[I1[x]] - v0) * t;
      }
    }
  }
}

/**
 * upsample a coarse field (from blurDown) bilinearly and ADD gain * density into `acc`, shifted by (dx, dz) fine cells
 * (acc(x, z) += up(x - dx, z - dz): a drifting plume at no extra cost). Within the map, values beyond the coarse
 * edge clamp to it; samples from outside the map (a shift over the upwind edge) fade to 0 within one cell.
 */
export function upsampleAdd(coarse: Float32Array, acc: Float32Array, N: number, f: number, gain: number, dx = 0, dz = 0): void {
  const M = Math.ceil(N / f);
  const g = gain / (f * f);
  upTables(N, f, M, dx, dz);
  const I0 = upI0, I1 = upI1, T = upT, WX = upW, Z0 = upZ0, Z1 = upZ1, TZ = upTZ, WZ = upWZ;
  const R = upRow;
  const shiftX = dx !== 0;
  for (let z = 0; z < N; z++) {
    const wz = WZ[z];
    if (wz === 0) continue;
    // vertical interpolation of the two coarse rows into R (pre-scaled by g and the edge weight)
    const tz = TZ[z];
    const r0 = Z0[z] * M, r1 = Z1[z] * M;
    const a = (1 - tz) * g * wz, b = tz * g * wz;
    for (let m = 0; m < M; m++) R[m] = coarse[r0 + m] * a + coarse[r1 + m] * b;
    const row = z * N;
    if (shiftX) {
      for (let x = 0; x < N; x++) {
        const t = T[x];
        const v0 = R[I0[x]];
        acc[row + x] += (v0 + (R[I1[x]] - v0) * t) * WX[x];
      }
    } else {
      for (let x = 0; x < N; x++) {
        const t = T[x];
        const v0 = R[I0[x]];
        acc[row + x] += v0 + (R[I1[x]] - v0) * t;
      }
    }
  }
}

export function blurDownAdd(src: Float32Array, acc: Float32Array, N: number, f: number, r: number, gain: number, coarse: Float32Array, coarseTmp: Float32Array, dx = 0, dz = 0): void {
  blurDown(src, N, f, r, coarse, coarseTmp);
  upsampleAdd(coarse, acc, N, f, gain, dx, dz);
}
