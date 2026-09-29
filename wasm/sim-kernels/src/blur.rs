//! Port of src/sim/infra/blur.ts (separable box blurs, block downsampling, bilinear upsampling, field shifts).
//!
//! Float semantics = the JS original, bit for bit: every value read from a Float32Array is promoted to f64, all
//! arithmetic is f64 in the JS evaluation order, and results are rounded to f32 exactly where JS stores into a
//! Float32Array (`as f32` is round-to-nearest-even, like ToFloat32). Running sums keep their JS sequence of
//! additions and subtractions per row / column. Restructurings used here (loop splitting at the branch boundaries,
//! fusing the per-column add / store / subtract of boxV into one pass, interleaving independent rows of boxH) do not
//! change the sequence of operations applied to any single value, so results stay identical.
//!
//! Scratch: JS kept module-level scratch arrays (colSum, the upsample tables); here the caller passes them in
//! (`col`: n f64, `tables`: see `upsample_add`), so kernels stay allocation-free and re-entrant.

use crate::abi::{f32s, f32s_mut, f64s_mut};
use crate::math::{clamp_offset, floor};

// ------------------------------------------------------------------------------------------------ box passes

/// One row of the horizontal running-sum box filter (JS boxH inner loop), split at the branch boundaries:
/// add while x + r < n, subtract once x >= r.
#[inline(always)]
fn box_h_row(s_row: &[f32], d_row: &mut [f32], n: usize, r: usize, inv: f64) {
    let s_row = &s_row[..n];
    let d_row = &mut d_row[..n];
    let mut s = 0.0f64;
    let head = if r < n { r } else { n };
    for &v in &s_row[..head] {
        s += v as f64;
    }
    let b = n.saturating_sub(r); // x < b  <=>  x + r < n
    if r <= b {
        for x in 0..r {
            s += s_row[x + r] as f64;
            d_row[x] = (s * inv) as f32;
        }
        for x in r..b {
            s += s_row[x + r] as f64;
            d_row[x] = (s * inv) as f32;
            s -= s_row[x - r] as f64;
        }
        for x in b..n {
            d_row[x] = (s * inv) as f32;
            s -= s_row[x - r] as f64;
        }
    } else {
        for x in 0..b {
            s += s_row[x + r] as f64;
            d_row[x] = (s * inv) as f32;
        }
        for x in b..head {
            d_row[x] = (s * inv) as f32;
        }
        for x in r..n {
            d_row[x] = (s * inv) as f32;
            s -= s_row[x - r] as f64;
        }
    }
}

/// Four rows of `box_h_row` in lockstep: four independent f64 dependency chains (the single-row loop is bound by
/// the latency of its add -> sub chain). Per-row operation order is unchanged.
#[inline(always)]
fn box_h_rows4(src: &[f32], dst: &mut [f32], row: usize, n: usize, r: usize, inv: f64) {
    let (s0, s1, s2, s3) = (&src[row..row + n], &src[row + n..row + 2 * n], &src[row + 2 * n..row + 3 * n], &src[row + 3 * n..row + 4 * n]);
    let d = &mut dst[row..row + 4 * n];
    let (d0, rest) = d.split_at_mut(n);
    let (d1, rest) = rest.split_at_mut(n);
    let (d2, d3) = rest.split_at_mut(n);
    let mut a0 = 0.0f64;
    let mut a1 = 0.0f64;
    let mut a2 = 0.0f64;
    let mut a3 = 0.0f64;
    let head = if r < n { r } else { n };
    for x in 0..head {
        a0 += s0[x] as f64;
        a1 += s1[x] as f64;
        a2 += s2[x] as f64;
        a3 += s3[x] as f64;
    }
    let b = n.saturating_sub(r);
    macro_rules! add {
        ($x:expr) => {{
            let xr = $x + r;
            a0 += s0[xr] as f64;
            a1 += s1[xr] as f64;
            a2 += s2[xr] as f64;
            a3 += s3[xr] as f64;
        }};
    }
    macro_rules! store {
        ($x:expr) => {{
            d0[$x] = (a0 * inv) as f32;
            d1[$x] = (a1 * inv) as f32;
            d2[$x] = (a2 * inv) as f32;
            d3[$x] = (a3 * inv) as f32;
        }};
    }
    macro_rules! sub {
        ($x:expr) => {{
            let xr = $x - r;
            a0 -= s0[xr] as f64;
            a1 -= s1[xr] as f64;
            a2 -= s2[xr] as f64;
            a3 -= s3[xr] as f64;
        }};
    }
    if r <= b {
        for x in 0..r {
            add!(x);
            store!(x);
        }
        for x in r..b {
            add!(x);
            store!(x);
            sub!(x);
        }
        for x in b..n {
            store!(x);
            sub!(x);
        }
    } else {
        for x in 0..b {
            add!(x);
            store!(x);
        }
        for x in b..head {
            store!(x);
        }
        for x in r..n {
            store!(x);
            sub!(x);
        }
    }
}

/// JS `boxH(src, dst, N, r)` for r >= 0: horizontal box blur src -> dst (mass preserving, zero boundary).
pub fn box_h(src: &[f32], dst: &mut [f32], n: usize, r: usize) {
    let nn = n * n;
    let src = &src[..nn];
    let dst = &mut dst[..nn];
    let inv = 1.0 / (2 * r + 1) as f64;
    let mut z = 0;
    while z + 4 <= n {
        box_h_rows4(src, dst, z * n, n, r, inv);
        z += 4;
    }
    while z < n {
        box_h_row(&src[z * n..], &mut dst[z * n..], n, r, inv);
        z += 1;
    }
}

/// JS `boxV(src, dst, N, r)` for r >= 0: vertical box blur with running column sums (`col`: >= n f64 scratch).
/// JS does `cs += row z+r`, `dst = cs * inv`, `cs -= row z-r` as three passes; fused here per column (same order).
pub fn box_v(src: &[f32], dst: &mut [f32], col: &mut [f64], n: usize, r: usize) {
    let nn = n * n;
    let src = &src[..nn];
    let dst = &mut dst[..nn];
    let cs = &mut col[..n];
    let inv = 1.0 / (2 * r + 1) as f64;
    for c in cs.iter_mut() {
        *c = 0.0;
    }
    let head = if r < n { r } else { n };
    for z in 0..head {
        let row = &src[z * n..z * n + n];
        for (c, &v) in cs.iter_mut().zip(row) {
            *c += v as f64;
        }
    }
    for z in 0..n {
        let d = &mut dst[z * n..z * n + n];
        let add = z + r < n;
        let sub = z >= r;
        if add && sub {
            let a = &src[(z + r) * n..(z + r) * n + n];
            let s = &src[(z - r) * n..(z - r) * n + n];
            for x in 0..n {
                let c = cs[x] + a[x] as f64;
                d[x] = (c * inv) as f32;
                cs[x] = c - s[x] as f64;
            }
        } else if add {
            let a = &src[(z + r) * n..(z + r) * n + n];
            for x in 0..n {
                let c = cs[x] + a[x] as f64;
                d[x] = (c * inv) as f32;
                cs[x] = c;
            }
        } else if sub {
            let s = &src[(z - r) * n..(z - r) * n + n];
            for x in 0..n {
                let c = cs[x];
                d[x] = (c * inv) as f32;
                cs[x] = c - s[x] as f64;
            }
        } else {
            for x in 0..n {
                d[x] = (cs[x] * inv) as f32;
            }
        }
    }
}

/// JS `blur3(a, tmp, N, r)`: in-place ~Gaussian blur of `a` (3 x (boxH a->tmp, boxV tmp->a)); no-op for r <= 0.
pub fn blur3(a: &mut [f32], tmp: &mut [f32], col: &mut [f64], n: usize, r: i32) {
    if r <= 0 {
        return;
    }
    let r = r as usize;
    for _ in 0..3 {
        box_h(a, tmp, n, r);
        box_v(tmp, a, col, n, r);
    }
}

// ------------------------------------------------------------------------------------------------ resampling

/// JS `Math.ceil(N / f)` for positive integers
#[inline(always)]
fn coarse_size(n: usize, f: usize) -> usize {
    n.div_ceil(f)
}

/// JS `blurDown(src, N, f, r, coarse, coarseTmp)` for integer f >= 1: block sums into `coarse` (M x M, M = ceil(N/f)),
/// then blur3 there. Returns M.
pub fn downsample_blur(src: &[f32], n: usize, f: usize, r: i32, coarse: &mut [f32], coarse_tmp: &mut [f32], col: &mut [f64]) -> usize {
    let m = coarse_size(n, f);
    let src = &src[..n * n];
    let coarse_m = &mut coarse[..m * m];
    for c in coarse_m.iter_mut() {
        *c = 0.0;
    }
    let sh: u32 = match f {
        2 => 1,
        4 => 2,
        8 => 3,
        _ => u32::MAX,
    };
    for z in 0..n {
        let cz = if sh != u32::MAX { z >> sh } else { z / f };
        let row = &src[z * n..z * n + n];
        let crow = &mut coarse_m[cz * m..cz * m + m];
        if sh != u32::MAX {
            for (x, &v) in row.iter().enumerate() {
                if v != 0.0 {
                    // f32 + f32 rounded once to f32 == JS f64 add then f32 store (53 >= 2 * 24 + 2)
                    crow[x >> sh] += v;
                }
            }
        } else {
            for (x, &v) in row.iter().enumerate() {
                if v != 0.0 {
                    crow[x / f] += v;
                }
            }
        }
    }
    blur3(coarse_m, coarse_tmp, col, m, r);
    m
}

/// scratch words (4 bytes) `upsample_add` needs for its tables: 8 * n (x and z axis tables) + m (row buffer)
pub const fn upsample_scratch_words(n: usize, f: usize) -> usize {
    8 * n + n.div_ceil(f)
}

/// JS `axisTable`: bilinear tables for fine x -> coarse (x0, x1, t) shifted by `off`, and the edge weight W.
/// T and W are Float32 in JS (rounded on store); I0 / I1 are clamped integers (NaN -> 0 like ToInt32).
#[inline(never)]
fn axis_table(n: usize, f: usize, m: usize, off: f64, i0: &mut [i32], i1: &mut [i32], t_out: &mut [f32], w_out: &mut [f32]) {
    let nm1 = (n - 1) as f64;
    let mmax = m as f64;
    let ff = f as f64;
    for x in 0..n {
        let s = x as f64 - off;
        let out = if s < 0.0 {
            -s
        } else if s > nm1 {
            s - nm1
        } else {
            0.0
        };
        w_out[x] = if out >= 1.0 { 0.0 } else { (1.0 - out) as f32 };
        let fx = (s + 0.5) / ff - 0.5;
        let mut x0 = floor(fx);
        let t = fx - x0;
        let mut x1 = x0 + 1.0;
        if x0 < 0.0 {
            x0 = 0.0;
        }
        if x1 < 0.0 {
            x1 = 0.0;
        }
        if x0 >= mmax {
            x0 = mmax - 1.0;
        }
        if x1 >= mmax {
            x1 = mmax - 1.0;
        }
        // x0 / x1 are integral in [0, m-1] or NaN; `as i32` maps NaN to 0 exactly like Int32Array's ToInt32
        i0[x] = x0 as i32;
        i1[x] = x1 as i32;
        t_out[x] = t as f32;
    }
}

/// JS `upsampleAdd(coarse, acc, N, f, gain, dx, dz)` for integer f >= 1: acc(x, z) += bilinear(coarse)(x - dx, z - dz)
/// * gain / f^2 * edge weights. `tables` = `upsample_scratch_words(n, f)` 4-byte words of scratch.
#[allow(clippy::too_many_arguments)]
pub fn upsample_add(coarse: &[f32], acc: &mut [f32], n: usize, f: usize, gain: f64, dx: f64, dz: f64, tables: &mut [u32]) {
    let m = coarse_size(n, f);
    let coarse = &coarse[..m * m];
    let acc = &mut acc[..n * n];
    let g = gain / ((f * f) as f64);
    let tables = &mut tables[..upsample_scratch_words(n, f)];
    // carve the tables (u32 words reinterpreted as i32 / f32; same size and alignment)
    let (ix0, rest) = tables.split_at_mut(n);
    let (ix1, rest) = rest.split_at_mut(n);
    let (tx, rest) = rest.split_at_mut(n);
    let (wx, rest) = rest.split_at_mut(n);
    let (iz0, rest) = rest.split_at_mut(n);
    let (iz1, rest) = rest.split_at_mut(n);
    let (tz_t, rest) = rest.split_at_mut(n);
    let (wz_t, rrow) = rest.split_at_mut(n);
    // SAFETY: u32, i32 and f32 have identical size and alignment; every bit pattern is a valid value of each
    let (ix0, ix1, iz0, iz1) = unsafe { (as_i32(ix0), as_i32(ix1), as_i32(iz0), as_i32(iz1)) };
    let (tx, wx, tz_t, wz_t, rrow) = unsafe { (as_f32(tx), as_f32(wx), as_f32(tz_t), as_f32(wz_t), as_f32(&mut rrow[..m])) };
    axis_table(n, f, m, dx, ix0, ix1, tx, wx);
    axis_table(n, f, m, dz, iz0, iz1, tz_t, wz_t);
    let shift_x = dx != 0.0;
    for z in 0..n {
        let wz = wz_t[z];
        if wz == 0.0 {
            continue;
        }
        let tz = tz_t[z] as f64;
        let wz = wz as f64;
        let r0 = iz0[z] as usize * m;
        let r1 = iz1[z] as usize * m;
        let a = (1.0 - tz) * g * wz;
        let b = tz * g * wz;
        let c0 = &coarse[r0..r0 + m];
        let c1 = &coarse[r1..r1 + m];
        for k in 0..m {
            rrow[k] = (c0[k] as f64 * a + c1[k] as f64 * b) as f32;
        }
        let row = &mut acc[z * n..z * n + n];
        if shift_x {
            for x in 0..n {
                let t = tx[x] as f64;
                let v0 = rrow[ix0[x] as usize] as f64;
                let v1 = rrow[ix1[x] as usize] as f64;
                row[x] = (row[x] as f64 + (v0 + (v1 - v0) * t) * wx[x] as f64) as f32;
            }
        } else {
            for x in 0..n {
                let t = tx[x] as f64;
                let v0 = rrow[ix0[x] as usize] as f64;
                let v1 = rrow[ix1[x] as usize] as f64;
                row[x] = (row[x] as f64 + (v0 + (v1 - v0) * t)) as f32;
            }
        }
    }
}

#[inline(always)]
unsafe fn as_i32(s: &mut [u32]) -> &mut [i32] {
    unsafe { core::slice::from_raw_parts_mut(s.as_mut_ptr() as *mut i32, s.len()) }
}
#[inline(always)]
unsafe fn as_f32(s: &mut [u32]) -> &mut [f32] {
    unsafe { core::slice::from_raw_parts_mut(s.as_mut_ptr() as *mut f32, s.len()) }
}

// ------------------------------------------------------------------------------------------------ shifts

/// JS `shiftField(src, dst, N, dx, dz)`: dst(x, z) = bilinear src(x - dx, z - dz), zero outside the map.
pub fn shift_field(src: &[f32], dst: &mut [f32], n: usize, dx: f64, dz: f64) {
    let src = &src[..n * n];
    let dst = &mut dst[..n * n];
    let fx = floor(dx);
    let fz = floor(dz);
    let tx = dx - fx;
    let tz = dz - fz;
    let w00 = (1.0 - tx) * (1.0 - tz);
    let w10 = tx * (1.0 - tz);
    let w01 = (1.0 - tx) * tz;
    let w11 = tx * tz;
    // integer offsets; beyond +-(n + 2) every index is out of range either way (NaN / inf too)
    let lim = n as i64 + 2;
    let ix = clamp_offset(fx, lim);
    let iz = clamp_offset(fz, lim);
    let ni = n as i64;
    for z in 0..n {
        let sz0 = z as i64 - iz;
        let sz1 = sz0 - 1;
        let in0 = sz0 >= 0 && sz0 < ni;
        let in1 = sz1 >= 0 && sz1 < ni;
        let row = z * n;
        for x in 0..n {
            let sx0 = x as i64 - ix;
            let sx1 = sx0 - 1;
            let jx0 = sx0 >= 0 && sx0 < ni;
            let jx1 = sx1 >= 0 && sx1 < ni;
            let mut v = 0.0f64;
            if in0 {
                let r = sz0 as usize * n;
                if jx0 {
                    v += w00 * src[r + sx0 as usize] as f64;
                }
                if jx1 {
                    v += w10 * src[r + sx1 as usize] as f64;
                }
            }
            if in1 {
                let r = sz1 as usize * n;
                if jx0 {
                    v += w01 * src[r + sx0 as usize] as f64;
                }
                if jx1 {
                    v += w11 * src[r + sx1 as usize] as f64;
                }
            }
            dst[row + x] = v as f32;
        }
    }
}

/// JS `shiftPlume(src, dst, N, dx, dz)`: dst = 0.5 shift(src, dx, dz) + 0.5 shift(src, 2dx, 2dz) in one pass.
pub fn shift_plume(src: &[f32], dst: &mut [f32], n: usize, dx: f64, dz: f64) {
    let src = &src[..n * n];
    let dst = &mut dst[..n * n];
    let ax = floor(dx);
    let az = floor(dz);
    let bx = floor(2.0 * dx);
    let bz = floor(2.0 * dz);
    let tax = dx - ax;
    let taz = dz - az;
    let tbx = 2.0 * dx - bx;
    let tbz = 2.0 * dz - bz;
    let a00 = 0.5 * (1.0 - tax) * (1.0 - taz);
    let a10 = 0.5 * tax * (1.0 - taz);
    let a01 = 0.5 * (1.0 - tax) * taz;
    let a11 = 0.5 * tax * taz;
    let b00 = 0.5 * (1.0 - tbx) * (1.0 - tbz);
    let b10 = 0.5 * tbx * (1.0 - tbz);
    let b01 = 0.5 * (1.0 - tbx) * tbz;
    let b11 = 0.5 * tbx * tbz;
    let lim = n as i64 + 2;
    let (iax, iaz, ibx, ibz) = (clamp_offset(ax, lim), clamp_offset(az, lim), clamp_offset(bx, lim), clamp_offset(bz, lim));
    let ni = n as i64;
    let rowoff = |zz: i64| -> i64 { if zz >= 0 && zz < ni { zz * ni } else { -1 } };
    for z in 0..n {
        let za0 = z as i64 - iaz;
        let zb0 = z as i64 - ibz;
        let (ra0, ra1, rb0, rb1) = (rowoff(za0), rowoff(za0 - 1), rowoff(zb0), rowoff(zb0 - 1));
        let row = z * n;
        for x in 0..n {
            let xa0 = x as i64 - iax;
            let xa1 = xa0 - 1;
            let xb0 = x as i64 - ibx;
            let xb1 = xb0 - 1;
            let ia0 = xa0 >= 0 && xa0 < ni;
            let ia1 = xa1 >= 0 && xa1 < ni;
            let ib0 = xb0 >= 0 && xb0 < ni;
            let ib1 = xb1 >= 0 && xb1 < ni;
            let mut v = 0.0f64;
            if ra0 >= 0 {
                if ia0 {
                    v += a00 * src[(ra0 + xa0) as usize] as f64;
                }
                if ia1 {
                    v += a10 * src[(ra0 + xa1) as usize] as f64;
                }
            }
            if ra1 >= 0 {
                if ia0 {
                    v += a01 * src[(ra1 + xa0) as usize] as f64;
                }
                if ia1 {
                    v += a11 * src[(ra1 + xa1) as usize] as f64;
                }
            }
            if rb0 >= 0 {
                if ib0 {
                    v += b00 * src[(rb0 + xb0) as usize] as f64;
                }
                if ib1 {
                    v += b10 * src[(rb0 + xb1) as usize] as f64;
                }
            }
            if rb1 >= 0 {
                if ib0 {
                    v += b01 * src[(rb1 + xb0) as usize] as f64;
                }
                if ib1 {
                    v += b11 * src[(rb1 + xb1) as usize] as f64;
                }
            }
            dst[row + x] = v as f32;
        }
    }
}

// ------------------------------------------------------------------------------------------------ exports
// Pointers are byte offsets into linear memory (4-byte aligned for f32 / i32, 8-byte for f64). The JS wrappers
// (src/wasm/kernels/blur.ts) validate sizes, alignment and aliasing before calling, and fall back to JS otherwise.

#[inline(always)]
fn nn(n: i32) -> usize {
    let n = n as usize;
    n * n
}

/// # Safety
/// src / dst: n*n f32 each, disjoint; r >= 0.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn blur_box_h(src: *const f32, dst: *mut f32, n: i32, r: i32) {
    let (s, d) = unsafe { (f32s(src, nn(n)), f32s_mut(dst, nn(n))) };
    box_h(s, d, n as usize, r as usize);
}

/// # Safety
/// src / dst: n*n f32 each, disjoint; col: n f64; r >= 0.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn blur_box_v(src: *const f32, dst: *mut f32, col: *mut f64, n: i32, r: i32) {
    let (s, d, c) = unsafe { (f32s(src, nn(n)), f32s_mut(dst, nn(n)), f64s_mut(col, n as usize)) };
    box_v(s, d, c, n as usize, r as usize);
}

/// # Safety
/// a / tmp: n*n f32 each, disjoint; col: n f64.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn blur_blur3(a: *mut f32, tmp: *mut f32, col: *mut f64, n: i32, r: i32) {
    let (a, t, c) = unsafe { (f32s_mut(a, nn(n)), f32s_mut(tmp, nn(n)), f64s_mut(col, n as usize)) };
    blur3(a, t, c, n as usize, r);
}

/// JS `boxAverage(src, dst, tmp, N, r)` = boxH(src -> tmp) + boxV(tmp -> dst).
///
/// # Safety
/// src / dst / tmp: n*n f32 each; tmp disjoint from both (src == dst allowed); col: n f64; r >= 0.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn blur_box_average(src: *const f32, dst: *mut f32, tmp: *mut f32, col: *mut f64, n: i32, r: i32) {
    let len = nn(n);
    let t = unsafe { f32s_mut(tmp, len) };
    box_h(unsafe { f32s(src, len) }, t, n as usize, r as usize);
    let d = unsafe { f32s_mut(dst, len) };
    box_v(t, d, unsafe { f64s_mut(col, n as usize) }, n as usize, r as usize);
}

/// # Safety
/// src: n*n f32; coarse / coarse_tmp: m*m f32 each (m = ceil(n/f)), disjoint from each other and src; col: m f64.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn blur_down(src: *const f32, n: i32, f: i32, r: i32, coarse: *mut f32, coarse_tmp: *mut f32, col: *mut f64) -> i32 {
    let (nu, fu) = (n as usize, f as usize);
    let m = coarse_size(nu, fu);
    let s = unsafe { f32s(src, nu * nu) };
    let (c, ct, cl) = unsafe { (f32s_mut(coarse, m * m), f32s_mut(coarse_tmp, m * m), f64s_mut(col, m)) };
    downsample_blur(s, nu, fu, r, c, ct, cl) as i32
}

/// # Safety
/// coarse: m*m f32; acc: n*n f32 (disjoint from coarse); tables: upsample_scratch_words(n, f) words.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn blur_upsample_add(coarse: *const f32, acc: *mut f32, n: i32, f: i32, gain: f64, dx: f64, dz: f64, tables: *mut u32) {
    let (nu, fu) = (n as usize, f as usize);
    let m = coarse_size(nu, fu);
    let c = unsafe { f32s(coarse, m * m) };
    let a = unsafe { f32s_mut(acc, nu * nu) };
    let t = unsafe { core::slice::from_raw_parts_mut(tables, upsample_scratch_words(nu, fu)) };
    upsample_add(c, a, nu, fu, gain, dx, dz, t);
}

/// JS `blurDownAdd(src, acc, N, f, r, gain, coarse, coarseTmp, dx, dz)` = blurDown + upsampleAdd.
///
/// # Safety
/// as blur_down + blur_upsample_add; acc disjoint from coarse / coarse_tmp.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn blur_down_add(
    src: *const f32, acc: *mut f32, n: i32, f: i32, r: i32, gain: f64, coarse: *mut f32, coarse_tmp: *mut f32, col: *mut f64, dx: f64,
    dz: f64, tables: *mut u32,
) {
    unsafe {
        blur_down(src, n, f, r, coarse, coarse_tmp, col);
        blur_upsample_add(coarse, acc, n, f, gain, dx, dz, tables);
    }
}

/// # Safety
/// src / dst: n*n f32 each, disjoint.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn blur_shift_field(src: *const f32, dst: *mut f32, n: i32, dx: f64, dz: f64) {
    let (s, d) = unsafe { (f32s(src, nn(n)), f32s_mut(dst, nn(n))) };
    shift_field(s, d, n as usize, dx, dz);
}

/// # Safety
/// src / dst: n*n f32 each, disjoint.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn blur_shift_plume(src: *const f32, dst: *mut f32, n: i32, dx: f64, dz: f64) {
    let (s, d) = unsafe { (f32s(src, nn(n)), f32s_mut(dst, nn(n))) };
    shift_plume(s, d, n as usize, dx, dz);
}

/// scratch words `blur_upsample_add` / `blur_down_add` need (lets JS size the tables buffer)
#[unsafe(no_mangle)]
pub extern "C" fn blur_upsample_scratch_words(n: i32, f: i32) -> i32 {
    upsample_scratch_words(n as usize, f as usize) as i32
}

// ------------------------------------------------------------------------------------------------ A/B variants
// Kept for the benchmark (tools/bench/blur.bench.ts): the single-row box_h, to measure what the 4-row interleave buys.

/// # Safety
/// as blur_box_h.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn blur_box_h_1row(src: *const f32, dst: *mut f32, n: i32, r: i32) {
    let (s, d) = unsafe { (f32s(src, nn(n)), f32s_mut(dst, nn(n))) };
    let (n, r) = (n as usize, r as usize);
    let inv = 1.0 / (2 * r + 1) as f64;
    for z in 0..n {
        box_h_row(&s[z * n..], &mut d[z * n..], n, r, inv);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// literal transcription of the JS boxH (branchy single loop) as the reference for the split / interleaved code
    fn box_h_ref(src: &[f32], dst: &mut [f32], n: usize, r: usize) {
        let inv = 1.0 / (2 * r + 1) as f64;
        for z in 0..n {
            let row = z * n;
            let mut s = 0.0f64;
            let mut x = 0;
            while x < r && x < n {
                s += src[row + x] as f64;
                x += 1;
            }
            for x in 0..n {
                if x + r < n {
                    s += src[row + x + r] as f64;
                }
                dst[row + x] = (s * inv) as f32;
                if x >= r {
                    s -= src[row + x - r] as f64;
                }
            }
        }
    }

    fn box_v_ref(src: &[f32], dst: &mut [f32], n: usize, r: usize) {
        let inv = 1.0 / (2 * r + 1) as f64;
        let mut cs = vec![0.0f64; n];
        let mut z = 0;
        while z < r && z < n {
            for x in 0..n {
                cs[x] += src[z * n + x] as f64;
            }
            z += 1;
        }
        for z in 0..n {
            if z + r < n {
                for x in 0..n {
                    cs[x] += src[(z + r) * n + x] as f64;
                }
            }
            for x in 0..n {
                dst[z * n + x] = (cs[x] * inv) as f32;
            }
            if z >= r {
                for x in 0..n {
                    cs[x] -= src[(z - r) * n + x] as f64;
                }
            }
        }
    }

    fn noise(len: usize, seed: u64) -> Vec<f32> {
        let mut s = seed | 1;
        (0..len)
            .map(|_| {
                s ^= s << 13;
                s ^= s >> 7;
                s ^= s << 17;
                if s % 5 == 0 { 0.0 } else { ((s >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 0.5) as f32 }
            })
            .collect()
    }

    #[test]
    fn restructured_box_passes_match_the_literal_transcription() {
        for &n in &[1usize, 2, 3, 5, 7, 8, 13, 64, 67] {
            for &r in &[0usize, 1, 2, 3, 6, 7, 20, 100] {
                let src = noise(n * n, (n * 131 + r) as u64);
                let (mut a, mut b) = (vec![0f32; n * n], vec![0f32; n * n]);
                box_h(&src, &mut a, n, r);
                box_h_ref(&src, &mut b, n, r);
                assert!(a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits()), "box_h n={n} r={r}");
                let mut col = vec![0f64; n];
                box_v(&src, &mut a, &mut col, n, r);
                box_v_ref(&src, &mut b, n, r);
                assert!(a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits()), "box_v n={n} r={r}");
            }
        }
    }
}
