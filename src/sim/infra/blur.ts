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

/** vertical box blur src -> dst */
export function boxV(src: Float32Array, dst: Float32Array, N: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < N; x++) {
    let s = 0;
    for (let z = 0; z < r && z < N; z++) s += src[z * N + x];
    for (let z = 0; z < N; z++) {
      if (z + r < N) s += src[(z + r) * N + x];
      dst[z * N + x] = s * inv;
      if (z - r >= 0) s -= src[(z - r) * N + x];
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
