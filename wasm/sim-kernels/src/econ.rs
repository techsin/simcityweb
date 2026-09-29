//! Economy bands: the per-day band kernels of the desirability and land-value systems — ports of
//! `desirabilitySystem → band` (src/sim/economy/desirability.ts) and `landValueSystem → band`
//! (src/sim/economy/landValue.ts) at commit 24f8609. Binding: src/wasm/kernels/desirabilityLandValueBandsBind.ts; the
//! restructured JS twin (fair A/B baseline and JS fallback): src/wasm/js/desirabilityLandValueBands.ts.
//!
//! Calling convention (as in catch.rs): `ip: *const i32` holds integers and byte pointers at the fixed indices of `ix`,
//! `fp: *mut f64` float parameters (plus the land-value accumulators, in / out) at the indices of `fx`; the binding
//! fills both blocks per call (`econ_layout()` must equal its ECON_LAYOUT). Layers are absolute N×N arrays (cell
//! i = z·N + x): either the CityState / EconRuntime arrays themselves (resident in wasm memory, zero copy) or staging
//! blocks of the same shape in which the binding filled only the rows the band reads. Kernels never allocate and never
//! grow memory.
//!
//! Table-driven desirability: the weights WT f32[devs·nt], LVREF / BIAS f32[devs], the per-dev non-zero term lists NZ,
//! the per-zone dev lists (ZONE_DEVTYPES), NET_NOISE / NET_TRAFFIC and the tuning constants are data; only the TERM
//! VECTOR (which layer / formula gives term t) is code: the 17 `T_*` terms of 24f8609.
//!
//! Bit-exactness (wasm/README.md "Float / determinism rules"):
//!  * every term is computed in f64 in the JS order and rounded to f32 where the JS stores it into its Float32Array T;
//!  * per dev: s = (BIAS + shift) + WT[lv]·(T_lv − LVREF), then s += WT[t]·T[t] over NZ in list order, all in f64,
//!    clamp, f32 store. BIAS + shift is hoisted out of the cell loop (the same two f32 values give the same f64 sum);
//!  * land value: the 13-term sum in the JS order, clamp, the 4-neighbour blend on the CURRENT values (x−1 / z−1 already
//!    updated in this band, x+1 / z+1 not: a row-order data dependency), s / c with c = 4 computed as s·0.25 (the same
//!    real quotient, hence the same rounding), the temporal blend, f32 store. The accumulators are f64 in cell order and
//!    add the UNROUNDED value (the JS adds `nv`, not the stored f32);
//!  * Math.min / Math.max keep their NaN / ±0 semantics wherever that can matter (js_min1, js_max0, the slope).
//!
//! Restructurings (each value still sees the JS operation sequence; checked bit for bit by
//! tests/wasm/desirabilityLandValueBands.test.ts):
//!  * two neighbouring cells as the two lanes of an f64x2 (`F2`; the scalar build uses [f64; 2]): desirability pairs
//!    (x, x + 1) that are both eligible with the same dev list — terms and dot products; land value computes the 13-term
//!    value of every cell of a row in pairs before the blend. wasm f64x2 lanes are IEEE per lane, f64x2.max / min are
//!    NaN-propagating with -0 < +0 (= Math.max / Math.min), pmin / pmax give the JS clamp;
//!  * land value blends two rows as a wavefront (independent add chains), accumulating in row-major order.
//! Measured (1M city, CPU time): the straight per-cell port was 2.6–3.0× the fair JS, this version 3.3–4.2×
//! (tools/bench/desirabilityLandValueBands.bench.mjs).

/// parameter-block layout version (desirabilityLandValueBandsBind.ts ECON_LAYOUT)
pub const LAYOUT: u32 = 1;
/// term count of the 24f8609 term vector (T_LV .. T_SLOPE)
pub const NT: usize = 17;
/// capacity of the dev dimension (12 DevTypes at 24f8609)
pub const DEV_MAX: usize = 16;
/// entries of the NET_NOISE / NET_TRAFFIC / zone tables (u8 codes)
pub const CODES: usize = 256;

#[unsafe(no_mangle)]
pub extern "C" fn econ_layout() -> u32 {
    LAYOUT
}

/// `ip` indices (i32 words)
pub mod ix {
    pub const N: usize = 0;
    pub const CW: usize = 1;
    pub const COARSE: usize = 2;
    pub const Z0: usize = 3;
    pub const Z1: usize = 4;
    /// bit 0 traffic, bit 1 pollution, bit 2 services, bit 3 allCells (desirability) / first (land value)
    pub const FLAGS: usize = 5;
    pub const NTERMS: usize = 6;
    pub const DEVS: usize = 7;
    // per-cell layers (byte offsets)
    pub const ZONE: usize = 8;
    pub const NET: usize = 9;
    pub const WATER: usize = 10;
    pub const BUILDING: usize = 11;
    pub const LV: usize = 12;
    pub const AIR: usize = 13;
    pub const WPOL: usize = 14;
    pub const GARB: usize = 15;
    pub const CRIME: usize = 16;
    pub const NOISE: usize = 17;
    pub const TRAFFIC: usize = 18;
    pub const COMMUTE: usize = 19;
    pub const POLICE: usize = 20;
    pub const FIRE: usize = 21;
    pub const HEALTH: usize = 22;
    pub const EDU: usize = 23;
    pub const PARK: usize = 24;
    pub const TRANSIT: usize = 25;
    /// corner heights, (N+1)²
    pub const HEIGHTS: usize = 26;
    // coarse grids, cw²
    pub const CPOP: usize = 27;
    pub const CFREIGHT: usize = 28;
    pub const CWEALTH: usize = 29;
    // land value effects (per cell)
    pub const LVSTATIC: usize = 30;
    pub const LVEFF: usize = 31;
    pub const LVLANDFILL: usize = 32;
    // desirability tables
    /// f32[devs]: prepShift output (tax + ordinance shift)
    pub const SHIFT: usize = 33;
    /// f32[devs·nt]
    pub const WT: usize = 34;
    /// f32[devs]
    pub const LVREF: usize = 35;
    /// f32[devs]
    pub const BIAS: usize = 36;
    /// u8[devs·nt]: row d = the non-zero terms of dev d (1..nt-1, list order); u8[devs] lengths at NZ_LEN
    pub const NZ: usize = 37;
    pub const NZ_LEN: usize = 38;
    /// u8[256]: 0 = unzoned (None / Landfill: all devs on allCells sweeps), 1 = zoned (its dev list), 2 = not a zone
    pub const ZKIND: usize = 39;
    /// u8[256·devs] per-zone dev lists, u8[256] lengths
    pub const ZDEV: usize = 40;
    pub const ZLEN: usize = 41;
    /// f64[256] each; codes the JS tables do not have hold -inf (a JS `undefined > x` comparison is false)
    pub const NET_NOISE: usize = 42;
    pub const NET_TRAFFIC: usize = 43;
    /// the two devs whose value -1 marks an already cleared road / water cell (des[0], des[11])
    pub const CHK_A: usize = 44;
    pub const CHK_B: usize = 45;
    /// out: cell index of the first cell whose zone code is not a zone (return 1)
    pub const ERR_CELL: usize = 46;
    /// DEV_MAX slots: des[d] (f32 N×N each)
    pub const DES: usize = 48;
    pub const LEN: usize = DES + super::DEV_MAX;
}

/// `fp` indices (f64)
pub mod fx {
    pub const AVG_COMMUTE: usize = 0;
    pub const COMMUTE_GOOD: usize = 1;
    pub const COMMUTE_BAD: usize = 2;
    pub const COVERAGE_FALLBACK: usize = 3;
    pub const TRAFFIC_BUSY: usize = 4;
    pub const POP_NEAR_FULL: usize = 5;
    pub const SLOPE_P0: usize = 6;
    pub const SLOPE_P1: usize = 7;
    /// lvEffectAt clamp
    pub const EFF_MIN: usize = 8;
    pub const EFF_MAX: usize = 9;
    // LV.* (land value)
    pub const LV_BASE: usize = 10;
    pub const LV_SERVICES: usize = 11;
    pub const LV_PARKS: usize = 12;
    pub const LV_TRANSIT: usize = 13;
    pub const LV_COMMUTE: usize = 14;
    pub const LV_WEALTH: usize = 15;
    pub const LV_AIR: usize = 16;
    pub const LV_WPOL: usize = 17;
    pub const LV_GARBAGE: usize = 18;
    pub const LV_CRIME: usize = 19;
    pub const LV_NOISE: usize = 20;
    pub const LV_TEMPORAL: usize = 21;
    pub const LV_SPATIAL: usize = 22;
    /// land-value accumulators (in / out): sum, cnt, sumAll, cntAll
    pub const ACC: usize = 24;
    pub const LEN: usize = 28;
}

// term indices of the 24f8609 term vector (desirability.ts)
pub const T_LV: usize = 0;
pub const T_AIR: usize = 1;
pub const T_WATER: usize = 2;
pub const T_GARB: usize = 3;
pub const T_CRIME: usize = 4;
pub const T_NOISE: usize = 5;
pub const T_COMMUTE: usize = 6;
pub const T_POLICE: usize = 7;
pub const T_FIRE: usize = 8;
pub const T_HEALTH: usize = 9;
pub const T_EDU: usize = 10;
pub const T_PARK: usize = 11;
pub const T_TRANSIT: usize = 12;
pub const T_TRAFFIC: usize = 13;
pub const T_POP: usize = 14;
pub const T_FREIGHT: usize = 15;
pub const T_SLOPE: usize = 16;

pub const F_TRAFFIC: i32 = 1;
pub const F_POLLUTION: i32 = 2;
pub const F_SERVICES: i32 = 4;
pub const F_ALL: i32 = 8;

// ------------------------------------------------------------------------------------------------ JS semantics
/// core/rng.ts clamp: `v < a ? a : v > b ? b : v` (NaN and -0 pass through)
#[inline(always)]
pub fn clamp(v: f64, a: f64, b: f64) -> f64 {
    if v < a {
        a
    } else if v > b {
        b
    } else {
        v
    }
}

/// core/rng.ts smoothstep: t = clamp((v − a) / (b − a), 0, 1); t·t·(3 − 2t)
#[inline(always)]
pub fn smoothstep(a: f64, b: f64, v: f64) -> f64 {
    let t = clamp((v - a) / (b - a), 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// `Math.min(1, x)`: NaN stays NaN (Rust's f64::min would return 1)
#[inline(always)]
pub fn js_min1(x: f64) -> f64 {
    if x >= 1.0 { 1.0 } else { x }
}

/// `Math.max(0, x)`: NaN stays NaN, -0 becomes +0
#[inline(always)]
pub fn js_max0(x: f64) -> f64 {
    if x > 0.0 || x != x { x } else { 0.0 }
}

/// CityState.cellSlope: `Math.max(a, b, c, d) − Math.min(a, b, c, d)` (NaN if any corner is NaN; the sign of a zero
/// max or min cannot change the difference)
#[inline(always)]
pub fn slope4(a: f64, b: f64, c: f64, d: f64) -> f64 {
    if a != a || b != b || c != c || d != d {
        return f64::NAN;
    }
    let mut mx = a;
    let mut mn = a;
    if b > mx {
        mx = b;
    }
    if b < mn {
        mn = b;
    }
    if c > mx {
        mx = c;
    }
    if c < mn {
        mn = c;
    }
    if d > mx {
        mx = d;
    }
    if d < mn {
        mn = d;
    }
    mx - mn
}

/// landValue.ts lvEffectAt: `v < lo ? lo : v > hi ? hi : v` with v = lvEffects[i] + lvLandfill[i]
#[inline(always)]
fn lv_effect(eff: f32, landfill: f32, lo: f64, hi: f64) -> f64 {
    let v = eff as f64 + landfill as f64;
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

// ------------------------------------------------------------------------------------------------ memory access
/// A slice of `n` elements at byte offset `p` (empty when n = 0, whatever `p` is: unused layers are passed as 0).
///
/// # Safety
/// For n > 0, `p` must be a valid, aligned byte offset of `n` initialised elements (the binding validates every length,
/// `ptrs_ok` rejects null / misaligned pointers).
#[inline(always)]
unsafe fn sl<'a, T>(p: i32, n: usize) -> &'a [T] {
    if n == 0 {
        return &[];
    }
    unsafe { core::slice::from_raw_parts(p as usize as *const T, n) }
}
/// # Safety
/// as `sl`, and no other live slice may overlap the block (the binding rejects overlapping outputs)
#[inline(always)]
unsafe fn sl_mut<'a, T>(p: i32, n: usize) -> &'a mut [T] {
    if n == 0 {
        return &mut [];
    }
    unsafe { core::slice::from_raw_parts_mut(p as usize as *mut T, n) }
}

/// every listed pointer is non-null and aligned to `align` bytes
fn ptrs_ok(ip: &[i32], idx: &[usize], align: i32) -> bool {
    idx.iter().all(|&k| ip[k] != 0 && ip[k] % align == 0)
}

/// grid sizes of a call; None when the integers are outside the supported domain
fn dims(ip: &[i32]) -> Option<(usize, usize, usize, usize, usize)> {
    let n = ip[ix::N];
    let cw = ip[ix::CW];
    let coarse = ip[ix::COARSE];
    let z0 = ip[ix::Z0];
    let z1 = ip[ix::Z1];
    if !(1..=32767).contains(&n) || coarse < 1 || cw < 1 || cw > 32767 || z0 < 0 || z1 < z0 || z1 > n {
        return None;
    }
    // every block index the band can form must exist: ((N-1)/COARSE)·cw + (N-1)/COARSE < cw²
    let last = ((n - 1) / coarse) as usize;
    if last >= cw as usize {
        return None;
    }
    Some((n as usize, cw as usize, coarse as usize, z0 as usize, z1 as usize))
}

// ------------------------------------------------------------------------------------------------ cell access
// Every per-cell slice a kernel builds has exactly N·N (heights (N+1)², coarse grids cw²) elements (the binding
// validates the lengths, `dims` the grid), and every index below is formed from loop bounds inside those shapes
// (z0 <= z < z1 <= N, x < N, neighbours guarded by the map edges, blk < cw² by `dims`, u8 codes < 256). Those reads
// skip the bounds check; everything else stays checked.
#[inline(always)]
fn at<T: Copy>(a: &[T], i: usize) -> T {
    debug_assert!(i < a.len());
    unsafe { *a.get_unchecked(i) }
}

// ------------------------------------------------------------------------------------------------ two cells per value
// F2 = the values of two neighbouring cells (x, x + 1), one per lane. Every operation is lane-wise IEEE f64 (an
// f64x2 lane is exactly a scalar f64 operation), so each cell sees the scalar JS operation sequence. The simd128 build
// maps F2 to v128, the scalar build to [f64; 2] with the same operations.
#[cfg(target_feature = "simd128")]
mod f2 {
    use core::arch::wasm32::*;
    #[derive(Clone, Copy)]
    pub struct F2(pub v128);
    impl F2 {
        #[inline(always)]
        pub fn splat(v: f64) -> F2 {
            F2(f64x2_splat(v))
        }
        #[inline(always)]
        pub fn new(a: f64, b: f64) -> F2 {
            F2(f64x2(a, b))
        }
        #[inline(always)]
        pub fn lane0(self) -> f64 {
            f64x2_extract_lane::<0>(self.0)
        }
        #[inline(always)]
        pub fn lane1(self) -> f64 {
            f64x2_extract_lane::<1>(self.0)
        }
        #[inline(always)]
        pub fn add(self, o: F2) -> F2 {
            F2(f64x2_add(self.0, o.0))
        }
        #[inline(always)]
        pub fn sub(self, o: F2) -> F2 {
            F2(f64x2_sub(self.0, o.0))
        }
        #[inline(always)]
        pub fn mul(self, o: F2) -> F2 {
            F2(f64x2_mul(self.0, o.0))
        }
        #[inline(always)]
        pub fn div(self, o: F2) -> F2 {
            F2(f64x2_div(self.0, o.0))
        }
        /// f64 of two adjacent f32 (exact promotion); `p` must point to 2 readable f32
        #[inline(always)]
        pub unsafe fn load_f32(p: *const f32) -> F2 {
            unsafe { F2(f64x2_promote_low_f32x4(v128_load64_zero(p as *const u64))) }
        }
        /// JS clamp `v < lo ? lo : v > hi ? hi : v` (lo <= hi): pmax(v, lo) = v < lo ? lo : v, pmin(·, hi) = hi < · ? hi : ·
        #[inline(always)]
        pub fn clamp(self, lo: F2, hi: F2) -> F2 {
            F2(f64x2_pmin(f64x2_pmax(self.0, lo.0), hi.0))
        }
        /// `Math.min(1, x)` = pmin(x, 1) = 1 < x ? 1 : x (NaN and -0 kept)
        #[inline(always)]
        pub fn min1(self) -> F2 {
            F2(f64x2_pmin(self.0, f64x2_splat(1.0)))
        }
        /// `Math.max(0, x)`: x when x > 0 or NaN, else +0
        #[inline(always)]
        pub fn max0(self) -> F2 {
            let keep = v128_or(f64x2_gt(self.0, f64x2_splat(0.0)), f64x2_ne(self.0, self.0));
            F2(v128_and(self.0, keep))
        }
        /// round each lane to f32 and back (a Float32Array store + load)
        #[inline(always)]
        pub fn fround(self) -> F2 {
            F2(f64x2_promote_low_f32x4(f32x4_demote_f64x2_zero(self.0)))
        }
        /// `Math.max(a, b)` per lane: wasm f64x2.max is NaN-propagating with -0 < +0, exactly the JS semantics
        #[inline(always)]
        pub fn max(self, o: F2) -> F2 {
            F2(f64x2_max(self.0, o.0))
        }
        /// `Math.min(a, b)` per lane (f64x2.min: NaN-propagating, -0 < +0)
        #[inline(always)]
        pub fn min(self, o: F2) -> F2 {
            F2(f64x2_min(self.0, o.0))
        }
        /// store both lanes as f32 at p[0], p[1]
        #[inline(always)]
        pub unsafe fn store_f32(self, p: *mut f32) {
            unsafe { v128_store64_lane::<0>(f32x4_demote_f64x2_zero(self.0), p as *mut u64) }
        }
    }
}

#[cfg(not(target_feature = "simd128"))]
mod f2 {
    use super::clamp;
    /// `Math.max(a, b)`: NaN if either is NaN, +0 beats -0
    #[inline(always)]
    fn js_max(a: f64, b: f64) -> f64 {
        if a != a || b != b {
            f64::NAN
        } else if a > b || (a == b && a.to_bits() == 0) {
            a
        } else {
            b
        }
    }
    /// `Math.min(a, b)`: NaN if either is NaN, -0 beats +0
    #[inline(always)]
    fn js_min(a: f64, b: f64) -> f64 {
        if a != a || b != b {
            f64::NAN
        } else if a < b || (a == b && a.to_bits() == 1u64 << 63) {
            a
        } else {
            b
        }
    }
    #[derive(Clone, Copy)]
    pub struct F2(pub [f64; 2]);
    impl F2 {
        #[inline(always)]
        pub fn splat(v: f64) -> F2 {
            F2([v, v])
        }
        #[inline(always)]
        pub fn new(a: f64, b: f64) -> F2 {
            F2([a, b])
        }
        #[inline(always)]
        pub fn lane0(self) -> f64 {
            self.0[0]
        }
        #[inline(always)]
        pub fn lane1(self) -> f64 {
            self.0[1]
        }
        #[inline(always)]
        pub fn add(self, o: F2) -> F2 {
            F2([self.0[0] + o.0[0], self.0[1] + o.0[1]])
        }
        #[inline(always)]
        pub fn sub(self, o: F2) -> F2 {
            F2([self.0[0] - o.0[0], self.0[1] - o.0[1]])
        }
        #[inline(always)]
        pub fn mul(self, o: F2) -> F2 {
            F2([self.0[0] * o.0[0], self.0[1] * o.0[1]])
        }
        #[inline(always)]
        pub fn div(self, o: F2) -> F2 {
            F2([self.0[0] / o.0[0], self.0[1] / o.0[1]])
        }
        #[inline(always)]
        pub unsafe fn load_f32(p: *const f32) -> F2 {
            unsafe { F2([*p as f64, *p.add(1) as f64]) }
        }
        #[inline(always)]
        pub fn clamp(self, lo: F2, hi: F2) -> F2 {
            F2([clamp(self.0[0], lo.0[0], hi.0[0]), clamp(self.0[1], lo.0[1], hi.0[1])])
        }
        #[inline(always)]
        pub fn min1(self) -> F2 {
            F2([super::js_min1(self.0[0]), super::js_min1(self.0[1])])
        }
        #[inline(always)]
        pub fn max0(self) -> F2 {
            F2([super::js_max0(self.0[0]), super::js_max0(self.0[1])])
        }
        #[inline(always)]
        pub fn fround(self) -> F2 {
            F2([(self.0[0] as f32) as f64, (self.0[1] as f32) as f64])
        }
        #[inline(always)]
        pub fn max(self, o: F2) -> F2 {
            F2([js_max(self.0[0], o.0[0]), js_max(self.0[1], o.0[1])])
        }
        #[inline(always)]
        pub fn min(self, o: F2) -> F2 {
            F2([js_min(self.0[0], o.0[0]), js_min(self.0[1], o.0[1])])
        }
        #[inline(always)]
        pub unsafe fn store_f32(self, p: *mut f32) {
            unsafe {
                *p = self.0[0] as f32;
                *p.add(1) = self.0[1] as f32;
            }
        }
    }
}
use f2::F2;

/// smoothstep of two lanes (core/rng.ts): t = clamp((v − a) / (b − a), 0, 1); t·t·(3 − 2t)
#[inline(always)]
fn smoothstep2(a: F2, ba: F2, v: F2) -> F2 {
    let t = v.sub(a).div(ba).clamp(F2::splat(0.0), F2::splat(1.0));
    t.mul(t).mul(F2::splat(3.0).sub(F2::splat(2.0).mul(t)))
}

/// two f32 of layer `a` at cells i, i + 1 as F2
#[inline(always)]
fn pair(a: &[f32], i: usize) -> F2 {
    debug_assert!(i + 1 < a.len());
    unsafe { F2::load_f32(a.as_ptr().add(i)) }
}

// ------------------------------------------------------------------------------------------------ desirability
/// dot-product tables of one call: per dev (BIAS + shift), WT[lv], LVREF and its (weight, term) list, all f64
struct DevTabs {
    bs: [f64; DEV_MAX],
    wlv: [f64; DEV_MAX],
    lvref: [f64; DEV_MAX],
    w: [[f64; NT]; DEV_MAX],
    t: [[u8; NT]; DEV_MAX],
    len: [u8; DEV_MAX],
}

impl DevTabs {
    /// None when a table entry is out of range (term 0 or >= NT, NZ longer than NT - 1)
    unsafe fn load(ip: &[i32], devs: usize) -> Option<DevTabs> {
        unsafe {
            let wt: &[f32] = sl(ip[ix::WT], devs * NT);
            let lvref: &[f32] = sl(ip[ix::LVREF], devs);
            let bias: &[f32] = sl(ip[ix::BIAS], devs);
            let shift: &[f32] = sl(ip[ix::SHIFT], devs);
            let nz: &[u8] = sl(ip[ix::NZ], devs * NT);
            let nz_len: &[u8] = sl(ip[ix::NZ_LEN], devs);
            let mut tb = DevTabs {
                bs: [0.0; DEV_MAX],
                wlv: [0.0; DEV_MAX],
                lvref: [0.0; DEV_MAX],
                w: [[0.0; NT]; DEV_MAX],
                t: [[0; NT]; DEV_MAX],
                len: [0; DEV_MAX],
            };
            for d in 0..devs {
                let o = d * NT;
                tb.bs[d] = bias[d] as f64 + shift[d] as f64;
                tb.wlv[d] = wt[o] as f64;
                tb.lvref[d] = lvref[d] as f64;
                let len = nz_len[d] as usize;
                if len >= NT {
                    return None;
                }
                tb.len[d] = len as u8;
                for q in 0..len {
                    let t = nz[o + q] as usize;
                    if t == 0 || t >= NT {
                        return None;
                    }
                    tb.t[d][q] = t as u8;
                    tb.w[d][q] = wt[o + t] as f64;
                }
            }
            Some(tb)
        }
    }
}

/// the inputs of the term vector
struct DesCtx<'a> {
    n: usize,
    lv: &'a [f32],
    air: &'a [f32],
    wpol: &'a [f32],
    garb: &'a [f32],
    crime: &'a [f32],
    noise: &'a [f32],
    net: &'a [u8],
    traffic: &'a [f32],
    commute: &'a [f32],
    police: &'a [f32],
    fire: &'a [f32],
    health: &'a [f32],
    edu: &'a [f32],
    park: &'a [f32],
    transit: &'a [f32],
    lveff: &'a [f32],
    lvfill: &'a [f32],
    heights: &'a [f32],
    cpop: &'a [f32],
    cfreight: &'a [f32],
    net_noise: &'a [f64],
    net_traffic: &'a [f64],
    traffic_on: bool,
    pollution_on: bool,
    services_on: bool,
    avg_commute: f64,
    c_good: f64,
    c_bad: f64,
    cov_fallback: f64,
    busy: f64,
    pop_full: f64,
    s0: f64,
    s1: f64,
    eff_lo: f64,
    eff_hi: f64,
}

/// per-cell scalar parts of the term vector (the rest are layer values)
#[derive(Clone, Copy)]
struct CellScalars {
    /// neighbour-road noise proxy (f64 from NET_NOISE)
    n_noise: f64,
    n_traffic: f64,
    /// max adjacent traffic volume
    vol: f64,
    /// commute minutes used (cell or city average)
    cm: f64,
    /// max − min of the 4 corner heights
    slope: f64,
    /// coarse block
    blk: usize,
}

impl DesCtx<'_> {
    /// the neighbour-road terms of one side (JS: `if (NET_NOISE[k] > nNoise) nNoise = …; …`)
    #[inline(always)]
    fn side(&self, j: usize, s: &mut CellScalars) {
        let k = at(self.net, j) as usize;
        let a = at(self.net_noise, k);
        if a > s.n_noise {
            s.n_noise = a;
        }
        let b = at(self.net_traffic, k);
        if b > s.n_traffic {
            s.n_traffic = b;
        }
        let v = at(self.traffic, j) as f64;
        if v > s.vol {
            s.vol = v;
        }
    }

    #[inline(always)]
    fn scalars(&self, x: usize, z: usize, i: usize, blk: usize, with_slope: bool) -> CellScalars {
        let n = self.n;
        let mut s = CellScalars { n_noise: 0.0, n_traffic: 0.0, vol: 0.0, cm: 0.0, slope: 0.0, blk };
        // neighbour roads, in the JS order x-1, x+1, z-1, z+1
        if x > 0 {
            self.side(i - 1, &mut s);
        }
        if x + 1 < n {
            self.side(i + 1, &mut s);
        }
        if z > 0 {
            self.side(i - n, &mut s);
        }
        if z + 1 < n {
            self.side(i + n, &mut s);
        }
        let cmi = at(self.commute, i);
        s.cm = if self.traffic_on && cmi > 0.0 { cmi as f64 } else { self.avg_commute };
        if with_slope {
            let n1 = n + 1;
            let h = z * n1 + x;
            s.slope = slope4(at(self.heights, h) as f64, at(self.heights, h + 1) as f64, at(self.heights, h + n1) as f64, at(self.heights, h + n1 + 1) as f64);
        }
        s
    }

    /// CityState.cellSlope of cells (x, z) and (x + 1, z) as lanes: the corners a = (x, z), b = (x + 1, z), c = (x, z + 1),
    /// d = (x + 1, z + 1) of both cells are 4 pairs of adjacent corner heights; `Math.max(a, b, c, d) − Math.min(…)`
    #[inline(always)]
    fn slope2(&self, x: usize, z: usize) -> F2 {
        let n1 = self.n + 1;
        let h = z * n1 + x;
        let a = pair(self.heights, h);
        let b = pair(self.heights, h + 1);
        let c = pair(self.heights, h + n1);
        let d = pair(self.heights, h + n1 + 1);
        a.max(b).max(c).max(d).sub(a.min(b).min(c).min(d))
    }

    /// the 17 terms of cells i, i + 1 (lanes), each rounded to f32 where the JS stores it into its Float32Array T
    #[inline(always)]
    fn terms2(&self, x: usize, z: usize, i: usize, a: &CellScalars, b: &CellScalars, t: &mut [F2; NT]) {
        t[T_LV] = pair(self.lv, i);
        t[T_AIR] = pair(self.air, i);
        t[T_WATER] = pair(self.wpol, i);
        t[T_GARB] = pair(self.garb, i);
        t[T_CRIME] = pair(self.crime, i);
        t[T_NOISE] = if self.pollution_on { pair(self.noise, i) } else { F2::new(a.n_noise, b.n_noise).fround() };
        t[T_TRAFFIC] = if self.traffic_on { F2::new(a.vol, b.vol).div(F2::splat(self.busy)).min1().fround() } else { F2::new(a.n_traffic, b.n_traffic).fround() };
        let good = F2::splat(self.c_good);
        let span = F2::splat(self.c_bad - self.c_good);
        t[T_COMMUTE] = F2::splat(0.5).sub(smoothstep2(good, span, F2::new(a.cm, b.cm))).fround();
        if self.services_on {
            t[T_POLICE] = pair(self.police, i);
            t[T_FIRE] = pair(self.fire, i);
            t[T_HEALTH] = pair(self.health, i);
            t[T_EDU] = pair(self.edu, i);
            t[T_PARK] = pair(self.park, i);
            t[T_TRANSIT] = pair(self.transit, i);
        } else {
            let c = F2::splat(self.cov_fallback);
            t[T_POLICE] = c;
            t[T_FIRE] = c;
            t[T_HEALTH] = c;
            t[T_EDU] = c;
            let e = pair(self.lveff, i).add(pair(self.lvfill, i)).clamp(F2::splat(self.eff_lo), F2::splat(self.eff_hi));
            t[T_PARK] = e.max0().mul(F2::splat(3.0)).min1().fround();
            t[T_TRANSIT] = F2::splat(0.0);
        }
        t[T_POP] = F2::new(at(self.cpop, a.blk) as f64, at(self.cpop, b.blk) as f64).div(F2::splat(self.pop_full)).min1().fround();
        t[T_FREIGHT] = F2::new(at(self.cfreight, a.blk) as f64, at(self.cfreight, b.blk) as f64);
        t[T_SLOPE] = smoothstep2(F2::splat(self.s0), F2::splat(self.s1 - self.s0), self.slope2(x, z)).fround();
    }

    /// the 17 terms of one cell (scalar; the same operations as one lane of terms2)
    #[inline(always)]
    fn terms1(&self, i: usize, a: &CellScalars, t: &mut [f64; NT]) {
        t[T_LV] = at(self.lv, i) as f64;
        t[T_AIR] = at(self.air, i) as f64;
        t[T_WATER] = at(self.wpol, i) as f64;
        t[T_GARB] = at(self.garb, i) as f64;
        t[T_CRIME] = at(self.crime, i) as f64;
        t[T_NOISE] = if self.pollution_on { at(self.noise, i) as f64 } else { (a.n_noise as f32) as f64 };
        t[T_TRAFFIC] = if self.traffic_on { (js_min1(a.vol / self.busy) as f32) as f64 } else { (a.n_traffic as f32) as f64 };
        t[T_COMMUTE] = ((0.5 - smoothstep(self.c_good, self.c_bad, a.cm)) as f32) as f64;
        if self.services_on {
            t[T_POLICE] = at(self.police, i) as f64;
            t[T_FIRE] = at(self.fire, i) as f64;
            t[T_HEALTH] = at(self.health, i) as f64;
            t[T_EDU] = at(self.edu, i) as f64;
            t[T_PARK] = at(self.park, i) as f64;
            t[T_TRANSIT] = at(self.transit, i) as f64;
        } else {
            t[T_POLICE] = self.cov_fallback;
            t[T_FIRE] = self.cov_fallback;
            t[T_HEALTH] = self.cov_fallback;
            t[T_EDU] = self.cov_fallback;
            let e = lv_effect(at(self.lveff, i), at(self.lvfill, i), self.eff_lo, self.eff_hi);
            t[T_PARK] = (js_min1(js_max0(e) * 3.0) as f32) as f64;
            t[T_TRANSIT] = 0.0;
        }
        t[T_POP] = (js_min1(at(self.cpop, a.blk) as f64 / self.pop_full) as f32) as f64;
        t[T_FREIGHT] = at(self.cfreight, a.blk) as f64;
        t[T_SLOPE] = (smoothstep(self.s0, self.s1, a.slope) as f32) as f64;
    }
}

/// desirabilitySystem → band(st, z0, z1, allCells). Returns 0, 1 when a cell's zone code is not a zone (JS: TypeError
/// on `ZONE_DEVTYPES[zone].length`; ip[ERR_CELL] = that cell; every earlier cell is done, no later one was written — the
/// binding reruns the band in JS, which rewrites the same values and throws the same error) or 2 when the parameters
/// are out of domain (nothing written).
///
/// Row-major; two neighbouring cells (x, x + 1) that are both eligible with the same dev list go together as the two
/// lanes of every term and every dot-product step (86–97 % of the eligible cells of the 1M fixtures; the rest one by
/// one). The per-cell operation sequence is the JS one in both paths: s = (BIAS + shift) + WT[lv]·(T_lv − LVREF), then
/// += WT[t]·T[t] over NZ in list order, clamp, f32 store (BIAS + shift hoisted: the same f64 sum every time).
///
/// # Safety
/// `ip` / `fp` must point to parameter blocks of ix::LEN i32 / fx::LEN f64 whose pointers the binding validated.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn econ_desirability_band(ip: *mut i32, fp: *const f64) -> i32 {
    unsafe {
        let ip: &mut [i32] = sl_mut(ip as i32, ix::LEN);
        let fp: &[f64] = sl(fp as i32, fx::LEN);
        let Some((n, cw, coarse, z0, z1)) = dims(ip) else { return 2 };
        let devs = ip[ix::DEVS] as usize;
        if ip[ix::NTERMS] as usize != NT || devs == 0 || devs > DEV_MAX {
            return 2;
        }
        let chk_a = ip[ix::CHK_A] as usize;
        let chk_b = ip[ix::CHK_B] as usize;
        if chk_a >= devs || chk_b >= devs {
            return 2;
        }
        let flags = ip[ix::FLAGS];
        let services_on = flags & F_SERVICES != 0;
        let all_cells = flags & F_ALL != 0;
        use ix::*;
        if !ptrs_ok(ip, &[ZONE, NET, WATER, ZKIND, ZDEV, ZLEN, NZ, NZ_LEN], 1)
            || !ptrs_ok(ip, &[LV, AIR, WPOL, GARB, CRIME, NOISE, TRAFFIC, COMMUTE, HEIGHTS, CPOP, CFREIGHT, SHIFT, WT, LVREF, BIAS], 4)
            || !ptrs_ok(ip, &[NET_NOISE, NET_TRAFFIC], 8)
            || (services_on && !ptrs_ok(ip, &[POLICE, FIRE, HEALTH, EDU, PARK, TRANSIT], 4))
            || (!services_on && !ptrs_ok(ip, &[LVEFF, LVLANDFILL], 4))
            || !(0..devs).all(|d| ip[DES + d] != 0 && ip[DES + d] % 4 == 0)
        {
            return 2;
        }
        let Some(tb) = DevTabs::load(ip, devs) else { return 2 };
        let nn = n * n;
        let cn = if services_on { nn } else { 0 };
        let en = if services_on { 0 } else { nn };
        let cc = cw * cw;
        let ctx = DesCtx {
            n,
            lv: sl(ip[LV], nn),
            air: sl(ip[AIR], nn),
            wpol: sl(ip[WPOL], nn),
            garb: sl(ip[GARB], nn),
            crime: sl(ip[CRIME], nn),
            noise: sl(ip[NOISE], nn),
            net: sl(ip[NET], nn),
            traffic: sl(ip[TRAFFIC], nn),
            commute: sl(ip[COMMUTE], nn),
            // coverage layers are read only with the services system, lvEffects / lvLandfill only without it
            police: sl(ip[POLICE], cn),
            fire: sl(ip[FIRE], cn),
            health: sl(ip[HEALTH], cn),
            edu: sl(ip[EDU], cn),
            park: sl(ip[PARK], cn),
            transit: sl(ip[TRANSIT], cn),
            lveff: sl(ip[LVEFF], en),
            lvfill: sl(ip[LVLANDFILL], en),
            heights: sl(ip[HEIGHTS], (n + 1) * (n + 1)),
            cpop: sl(ip[CPOP], cc),
            cfreight: sl(ip[CFREIGHT], cc),
            net_noise: sl(ip[NET_NOISE], CODES),
            net_traffic: sl(ip[NET_TRAFFIC], CODES),
            traffic_on: flags & F_TRAFFIC != 0,
            pollution_on: flags & F_POLLUTION != 0,
            services_on,
            avg_commute: fp[fx::AVG_COMMUTE],
            c_good: fp[fx::COMMUTE_GOOD],
            c_bad: fp[fx::COMMUTE_BAD],
            cov_fallback: (fp[fx::COVERAGE_FALLBACK] as f32) as f64,
            busy: fp[fx::TRAFFIC_BUSY],
            pop_full: fp[fx::POP_NEAR_FULL],
            s0: fp[fx::SLOPE_P0],
            s1: fp[fx::SLOPE_P1],
            eff_lo: fp[fx::EFF_MIN],
            eff_hi: fp[fx::EFF_MAX],
        };
        let zone: &[u8] = sl(ip[ZONE], nn);
        let water: &[u8] = sl(ip[WATER], nn);
        let net: &[u8] = ctx.net;
        let zkind: &[u8] = sl(ip[ZKIND], CODES);
        let zdev: &[u8] = sl(ip[ZDEV], CODES * devs);
        let zlen: &[u8] = sl(ip[ZLEN], CODES);
        for code in 0..CODES {
            let l = zlen[code] as usize;
            if l > devs || zdev[code * devs..code * devs + l].iter().any(|&d| d as usize >= devs) {
                return 2;
            }
        }
        let mut all = [0u8; DEV_MAX];
        for (d, v) in all.iter_mut().enumerate() {
            *v = d as u8;
        }
        let des_p: [*mut f32; DEV_MAX] = core::array::from_fn(|d| if d < devs { ip[DES + d] as usize as *mut f32 } else { core::ptr::null_mut() });
        // (the des layers have nn elements each, i < nn below)

        // dev-list id of a cell: 0..=255 = its zone code (zoned), 256 = all devs (unzoned + allCells); None = skip
        const ALL: usize = 256;
        const SKIP: usize = 257;
        const BAD: usize = 258;
        let list_of = |i: usize| -> usize {
            let zc = at(zone, i) as usize;
            match at(zkind, zc) {
                1 => zc,
                0 => {
                    if all_cells {
                        ALL
                    } else {
                        SKIP
                    }
                }
                _ => BAD,
            }
        };
        let devs_of = |id: usize| -> &[u8] { if id == ALL { &all[..devs] } else { &zdev[id * devs..id * devs + at(zlen, id) as usize] } };
        // equal dev lists of two cells (zones with the same list pair up too)
        let same_list = |p: usize, q: usize| -> bool { p == q || (p != ALL && q != ALL && devs_of(p) == devs_of(q)) };

        let mut t2 = [F2::splat(0.0); NT];
        let mut t1 = [0.0f64; NT];
        let lo = F2::splat(-1.0);
        let hi = F2::splat(1.0);
        let pow2 = coarse.is_power_of_two();
        let shift = coarse.trailing_zeros();
        let block = |x: usize| if pow2 { x >> shift } else { x / coarse };
        for z in z0..z1 {
            let r = z * n;
            let bz = (z / coarse) * cw;
            let mut x = 0usize;
            while x < n {
                let i = r + x;
                if at(water, i) != 0 || at(net, i) != 0 {
                    if *des_p[chk_a].add(i) != -1.0 || *des_p[chk_b].add(i) != -1.0 {
                        for p in des_p.iter().take(devs) {
                            *p.add(i) = -1.0;
                        }
                    }
                    x += 1;
                    continue;
                }
                let id = list_of(i);
                if id == SKIP {
                    x += 1;
                    continue;
                }
                if id == BAD {
                    ip[ERR_CELL] = i as i32;
                    return 1;
                }
                let list = devs_of(id);
                let blk = bz + block(x);
                let blk_b = bz + block(x + 1);
                // partner x + 1: eligible (not road / water) with the same dev list
                let j = i + 1;
                let paired = x + 1 < n && at(water, j) == 0 && at(net, j) == 0 && {
                    let id2 = list_of(j);
                    id2 < SKIP && same_list(id, id2)
                };
                if paired {
                    let sa = ctx.scalars(x, z, i, blk, false);
                    let sb = ctx.scalars(x + 1, z, j, blk_b, false);
                    ctx.terms2(x, z, i, &sa, &sb, &mut t2);
                    for &d in list {
                        let d = d as usize;
                        let mut s = F2::splat(tb.bs[d]).add(F2::splat(tb.wlv[d]).mul(t2[T_LV].sub(F2::splat(tb.lvref[d]))));
                        let len = (tb.len[d] as usize).min(NT);
                        for q in 0..len {
                            s = s.add(F2::splat(tb.w[d][q]).mul(t2[(tb.t[d][q] as usize).min(NT - 1)]));
                        }
                        s.clamp(lo, hi).store_f32(des_p[d].add(i));
                    }
                    x += 2;
                } else {
                    let sa = ctx.scalars(x, z, i, blk, true);
                    ctx.terms1(i, &sa, &mut t1);
                    for &d in list {
                        let d = d as usize;
                        let mut s = tb.bs[d] + tb.wlv[d] * (t1[T_LV] - tb.lvref[d]);
                        let len = (tb.len[d] as usize).min(NT);
                        for q in 0..len {
                            s += tb.w[d][q] * t1[(tb.t[d][q] as usize).min(NT - 1)];
                        }
                        *des_p[d].add(i) = clamp(s, -1.0, 1.0) as f32;
                    }
                    x += 1;
                }
            }
        }
        0
    }
}

// ------------------------------------------------------------------------------------------------ land value
/// the inputs of the 13-term land value of a cell
struct LvCtx<'a> {
    zone: &'a [u8],
    building: &'a [i32],
    air: &'a [f32],
    wpol: &'a [f32],
    garb: &'a [f32],
    crime: &'a [f32],
    noise: &'a [f32],
    commute: &'a [f32],
    police: &'a [f32],
    fire: &'a [f32],
    health: &'a [f32],
    edu: &'a [f32],
    park: &'a [f32],
    transit: &'a [f32],
    lvstatic: &'a [f32],
    lveff: &'a [f32],
    lvfill: &'a [f32],
    cwealth: &'a [f32],
    traffic_on: bool,
    services_on: bool,
    avg_commute: f64,
    c_good: f64,
    c_bad: f64,
    cov_fallback: f64,
    eff_lo: f64,
    eff_hi: f64,
    k: [f64; 11],
}

impl LvCtx<'_> {
    /// clamp(v, 0, 1) of cells i, i + 1 (lanes; blocks ba, bb), landValue.ts in the JS evaluation order. Pure: water
    /// cells get a value too, which the caller ignores.
    #[inline(always)]
    fn value2(&self, i: usize, ba: usize, bb: usize) -> F2 {
        let eff = pair(self.lveff, i).add(pair(self.lvfill, i)).clamp(F2::splat(self.eff_lo), F2::splat(self.eff_hi));
        let (services, prk, trn) = if self.services_on {
            (
                pair(self.police, i).add(pair(self.fire, i)).add(pair(self.health, i)).add(pair(self.edu, i)).mul(F2::splat(0.25)),
                pair(self.park, i),
                pair(self.transit, i),
            )
        } else {
            (F2::splat(self.cov_fallback), eff.max0().mul(F2::splat(2.0)), F2::splat(0.0))
        };
        let ca = at(self.commute, i);
        let cb = at(self.commute, i + 1);
        let cma = if self.traffic_on && ca > 0.0 { ca as f64 } else { self.avg_commute };
        let cmb = if self.traffic_on && cb > 0.0 { cb as f64 } else { self.avg_commute };
        let score = F2::splat(1.0).sub(smoothstep2(F2::splat(self.c_good), F2::splat(self.c_bad - self.c_good), F2::new(cma, cmb)));
        let wealth = F2::new(at(self.cwealth, ba) as f64, at(self.cwealth, bb) as f64);
        let k = &self.k;
        let kk = |j: usize| F2::splat(k[j]);
        let v = kk(0)
            .add(pair(self.lvstatic, i))
            .add(eff)
            .add(kk(1).mul(services))
            .add(kk(2).mul(prk))
            .add(kk(3).mul(trn))
            .add(kk(4).mul(score.sub(F2::splat(0.5))))
            .add(kk(5).mul(wealth))
            .sub(kk(6).mul(pair(self.air, i)))
            .sub(kk(7).mul(pair(self.wpol, i)))
            .sub(kk(8).mul(pair(self.garb, i)))
            .sub(kk(9).mul(pair(self.crime, i)))
            .sub(kk(10).mul(pair(self.noise, i)));
        v.clamp(F2::splat(0.0), F2::splat(1.0))
    }

    /// clamp(v, 0, 1) of cell i (scalar; the same operations as one lane of value2)
    #[inline(always)]
    fn value1(&self, i: usize, blk: usize) -> f64 {
        let eff = lv_effect(at(self.lveff, i), at(self.lvfill, i), self.eff_lo, self.eff_hi);
        let (services, prk, trn) = if self.services_on {
            (
                (at(self.police, i) as f64 + at(self.fire, i) as f64 + at(self.health, i) as f64 + at(self.edu, i) as f64) * 0.25,
                at(self.park, i) as f64,
                at(self.transit, i) as f64,
            )
        } else {
            (self.cov_fallback, js_max0(eff) * 2.0, 0.0)
        };
        let cmi = at(self.commute, i);
        let cm = if self.traffic_on && cmi > 0.0 { cmi as f64 } else { self.avg_commute };
        let score = 1.0 - smoothstep(self.c_good, self.c_bad, cm);
        let wealth = at(self.cwealth, blk) as f64;
        let k = &self.k;
        let v = k[0] + at(self.lvstatic, i) as f64 + eff + k[1] * services + k[2] * prk + k[3] * trn + k[4] * (score - 0.5) + k[5] * wealth
            - k[6] * at(self.air, i) as f64
            - k[7] * at(self.wpol, i) as f64
            - k[8] * at(self.garb, i) as f64
            - k[9] * at(self.crime, i) as f64
            - k[10] * at(self.noise, i) as f64;
        clamp(v, 0.0, 1.0)
    }

    /// v of every cell of row z into out[0..n] (pairs of cells as lanes, an odd last cell alone)
    #[inline(always)]
    fn row_values(&self, n: usize, z: usize, bz: usize, block: impl Fn(usize) -> usize, out: &mut [f64]) {
        let r = z * n;
        let mut x = 0;
        while x + 2 <= n {
            let v = self.value2(r + x, bz + block(x), bz + block(x + 1));
            out[x] = v.lane0();
            out[x + 1] = v.lane1();
            x += 2;
        }
        if x < n {
            out[x] = self.value1(r + x, bz + block(x));
        }
    }

    /// counts in sum / cnt (zoned or built)
    #[inline(always)]
    fn counted(&self, i: usize) -> bool {
        at(self.zone, i) != 0 || at(self.building, i) >= 0
    }
}

/// the blend of one cell: spatial blend with the current neighbour values, then temporal smoothing (landValue.ts):
/// `s` = Σ neighbours (x−1, x+1, z−1, z+1 order, from 0), `c` their count; returns nv (unrounded)
#[inline(always)]
fn lv_blend(v: f64, s: f64, c: u32, old: f32, keep: f64, spatial: f64, temporal: f64) -> f64 {
    let sp = if c != 0 { v * keep + (if c == 4 { s * 0.25 } else { s / c as f64 }) * spatial } else { v };
    let old = old as f64;
    old + (sp - old) * temporal
}

/// rows up to this length use the value buffers / 2-row wavefront (their buffers live on the stack)
const WMAX: usize = 4096;

/// landValueSystem → band(st, z0, z1, first): land value of rows z0..z1 IN PLACE (row order is a data dependency).
/// fp[ACC..ACC+4] = (sum, cnt, sumAll, cntAll) are read and written back (the JS closure accumulators). Returns 0, or 2
/// when the parameters are out of domain (nothing written).
///
/// Per pair of rows: (1) the 13-term value v of every cell (independent of the land value itself: two cells per lane
/// pair), (2) the blend as a wavefront: step x updates cell x of row A = z and cell x − 1 of row B = z + 1. Every cell
/// reads exactly the values the row-major JS reads — A's lower neighbour (B, x) is updated one step later, B's upper
/// neighbour (A, x − 1) one step earlier, x + 1 of either row later — and the two add chains are independent. Row B's
/// unrounded values are buffered and added to the accumulators after row A: the accumulation order stays row-major.
///
/// # Safety
/// as econ_desirability_band; the land-value layer must not overlap any input
#[unsafe(no_mangle)]
pub unsafe extern "C" fn econ_land_value_band(ip: *const i32, fp: *mut f64) -> i32 {
    unsafe {
        let ip: &[i32] = sl(ip as i32, ix::LEN);
        let fp: &mut [f64] = sl_mut(fp as i32, fx::LEN);
        let Some((n, cw, coarse, z0, z1)) = dims(ip) else { return 2 };
        let nn = n * n;
        let flags = ip[ix::FLAGS];
        let services_on = flags & F_SERVICES != 0;
        let first = flags & F_ALL != 0;
        use ix::*;
        if !ptrs_ok(ip, &[ZONE, WATER], 1)
            || !ptrs_ok(ip, &[BUILDING, LV, AIR, WPOL, GARB, CRIME, NOISE, COMMUTE, LVSTATIC, LVEFF, LVLANDFILL, CWEALTH], 4)
            || (services_on && !ptrs_ok(ip, &[POLICE, FIRE, HEALTH, EDU, PARK, TRANSIT], 4))
        {
            return 2;
        }
        let cn = if services_on { nn } else { 0 };
        let ctx = LvCtx {
            zone: sl(ip[ZONE], nn),
            building: sl(ip[BUILDING], nn),
            air: sl(ip[AIR], nn),
            wpol: sl(ip[WPOL], nn),
            garb: sl(ip[GARB], nn),
            crime: sl(ip[CRIME], nn),
            noise: sl(ip[NOISE], nn),
            commute: sl(ip[COMMUTE], nn),
            police: sl(ip[POLICE], cn),
            fire: sl(ip[FIRE], cn),
            health: sl(ip[HEALTH], cn),
            edu: sl(ip[EDU], cn),
            park: sl(ip[PARK], cn),
            transit: sl(ip[TRANSIT], cn),
            lvstatic: sl(ip[LVSTATIC], nn),
            lveff: sl(ip[LVEFF], nn),
            lvfill: sl(ip[LVLANDFILL], nn),
            cwealth: sl(ip[CWEALTH], cw * cw),
            traffic_on: flags & F_TRAFFIC != 0,
            services_on,
            avg_commute: fp[fx::AVG_COMMUTE],
            c_good: fp[fx::COMMUTE_GOOD],
            c_bad: fp[fx::COMMUTE_BAD],
            cov_fallback: fp[fx::COVERAGE_FALLBACK],
            eff_lo: fp[fx::EFF_MIN],
            eff_hi: fp[fx::EFF_MAX],
            k: [
                fp[fx::LV_BASE], fp[fx::LV_SERVICES], fp[fx::LV_PARKS], fp[fx::LV_TRANSIT], fp[fx::LV_COMMUTE], fp[fx::LV_WEALTH],
                fp[fx::LV_AIR], fp[fx::LV_WPOL], fp[fx::LV_GARBAGE], fp[fx::LV_CRIME], fp[fx::LV_NOISE],
            ],
        };
        let water: &[u8] = sl(ip[WATER], nn);
        let lv: &mut [f32] = sl_mut(ip[LV], nn);
        let temporal = fp[fx::LV_TEMPORAL];
        let spatial = fp[fx::LV_SPATIAL];
        let keep = 1.0 - spatial;

        let mut sum = fp[fx::ACC];
        let mut cnt = fp[fx::ACC + 1];
        let mut sum_all = fp[fx::ACC + 2];
        let mut cnt_all = fp[fx::ACC + 3];
        let big = n > WMAX;
        let pow2 = coarse.is_power_of_two();
        let shift = coarse.trailing_zeros();
        let block = |x: usize| if pow2 { x >> shift } else { x / coarse };
        let mut va = [0.0f64; WMAX];
        let mut vb = [0.0f64; WMAX];
        let mut nvb = [0.0f64; WMAX];
        let mut fb = [0u8; WMAX];
        let mut z = z0;
        while z < z1 {
            let bz = (z / coarse) * cw;
            let r = z * n;
            if first || big || z + 1 >= z1 {
                // one row, row-major (first: no blend, every cell independent)
                let (head, tail) = lv.split_at_mut(r);
                let (cur, rest) = tail.split_at_mut(n);
                let up: &[f32] = if z > 0 { &head[r - n..r] } else { &[] };
                let dn: &[f32] = if z + 1 < n { &rest[..n] } else { &[] };
                if !big {
                    ctx.row_values(n, z, bz, block, &mut va[..n]);
                }
                let mut left = 0.0f32;
                for x in 0..n {
                    let i = r + x;
                    if at(water, i) != 0 {
                        cur[x] = 0.0;
                        left = 0.0;
                        continue;
                    }
                    let v = if big { ctx.value1(i, bz + block(x)) } else { va[x] };
                    if first {
                        cur[x] = v as f32;
                        continue;
                    }
                    let mut s = 0.0f64;
                    let mut c = 0u32;
                    if x > 0 {
                        s += left as f64;
                        c += 1;
                    }
                    if x + 1 < n {
                        s += at(cur, x + 1) as f64;
                        c += 1;
                    }
                    if z > 0 {
                        s += at(up, x) as f64;
                        c += 1;
                    }
                    if z + 1 < n {
                        s += at(dn, x) as f64;
                        c += 1;
                    }
                    let nv = lv_blend(v, s, c, cur[x], keep, spatial, temporal);
                    let f = nv as f32;
                    cur[x] = f;
                    left = f;
                    sum_all += nv;
                    cnt_all += 1.0;
                    if ctx.counted(i) {
                        sum += nv;
                        cnt += 1.0;
                    }
                }
                z += 1;
                continue;
            }
            // rows A = z, B = z + 1: values first, then the blend as a wavefront
            let zb2 = z + 1;
            let bzb = (zb2 / coarse) * cw;
            let rb = zb2 * n;
            ctx.row_values(n, z, bz, block, &mut va[..n]);
            ctx.row_values(n, zb2, bzb, block, &mut vb[..n]);
            let (head, tail) = lv.split_at_mut(r);
            let (ra, tail2) = tail.split_at_mut(n);
            let (rbv, rest) = tail2.split_at_mut(n);
            let up_a: &[f32] = if z > 0 { &head[r - n..r] } else { &[] };
            let dn_b: &[f32] = if zb2 + 1 < n { &rest[..n] } else { &[] };
            let has_up = z > 0;
            let has_dn_b = zb2 + 1 < n;
            let mut left_a = 0.0f32;
            let mut left_b = 0.0f32;
            for x in 0..=n {
                if x < n {
                    // cell (x, A): its lower neighbour (x, B) is not updated yet (step x + 1)
                    let i = r + x;
                    if at(water, i) != 0 {
                        ra[x] = 0.0;
                        left_a = 0.0;
                    } else {
                        let mut s = 0.0f64;
                        let mut c = 1u32; // the row below exists (B)
                        if x > 0 {
                            s += left_a as f64;
                            c += 1;
                        }
                        if x + 1 < n {
                            s += at(ra, x + 1) as f64;
                            c += 1;
                        }
                        if has_up {
                            s += at(up_a, x) as f64;
                            c += 1;
                        }
                        s += at(rbv, x) as f64;
                        let nv = lv_blend(va[x], s, c, ra[x], keep, spatial, temporal);
                        let f = nv as f32;
                        ra[x] = f;
                        left_a = f;
                        sum_all += nv;
                        cnt_all += 1.0;
                        if ctx.counted(i) {
                            sum += nv;
                            cnt += 1.0;
                        }
                    }
                }
                if x >= 1 {
                    // cell (x - 1, B): its upper neighbour (x - 1, A) was updated at step x - 1
                    let xb = x - 1;
                    let i = rb + xb;
                    if at(water, i) != 0 {
                        rbv[xb] = 0.0;
                        left_b = 0.0;
                        fb[xb] = 0;
                    } else {
                        let mut s = 0.0f64;
                        let mut c = 1u32; // the row above exists (A)
                        if xb > 0 {
                            s += left_b as f64;
                            c += 1;
                        }
                        if xb + 1 < n {
                            s += at(rbv, xb + 1) as f64;
                            c += 1;
                        }
                        s += at(ra, xb) as f64;
                        if has_dn_b {
                            s += at(dn_b, xb) as f64;
                            c += 1;
                        }
                        let nv = lv_blend(vb[xb], s, c, rbv[xb], keep, spatial, temporal);
                        let f = nv as f32;
                        rbv[xb] = f;
                        left_b = f;
                        nvb[xb] = nv;
                        fb[xb] = if ctx.counted(i) { 2 } else { 1 };
                    }
                }
            }
            // row B's contributions, after row A's (row-major accumulation order)
            for xb in 0..n {
                let f = fb[xb];
                if f != 0 {
                    let nv = nvb[xb];
                    sum_all += nv;
                    cnt_all += 1.0;
                    if f == 2 {
                        sum += nv;
                        cnt += 1.0;
                    }
                }
            }
            z += 2;
        }
        fp[fx::ACC] = sum;
        fp[fx::ACC + 1] = cnt;
        fp[fx::ACC + 2] = sum_all;
        fp[fx::ACC + 3] = cnt_all;
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_min_max_semantics() {
        assert!(js_min1(f64::NAN).is_nan());
        assert_eq!(js_min1(-0.0).to_bits(), (-0.0f64).to_bits());
        assert_eq!(js_min1(2.0), 1.0);
        assert_eq!(js_min1(f64::INFINITY), 1.0);
        assert_eq!(js_min1(0.25), 0.25);
        assert!(js_max0(f64::NAN).is_nan());
        assert_eq!(js_max0(-0.0).to_bits(), 0);
        assert_eq!(js_max0(-3.0).to_bits(), 0);
        assert_eq!(js_max0(0.5), 0.5);
        assert!(slope4(0.0, 1.0, f64::NAN, 2.0).is_nan());
        assert_eq!(slope4(-0.0, 0.0, 0.0, -0.0).to_bits(), 0);
        assert_eq!(slope4(1.0, 5.0, -2.0, 3.0), 7.0);
    }

    #[test]
    fn clamp_smoothstep_semantics() {
        assert!(clamp(f64::NAN, 0.0, 1.0).is_nan());
        assert_eq!(clamp(-0.0, 0.0, 1.0).to_bits(), (-0.0f64).to_bits());
        assert!(smoothstep(2.0, 12.0, f64::NAN).is_nan());
        assert_eq!(smoothstep(2.0, 12.0, 7.0), 0.5);
        assert_eq!(smoothstep(12.0, 80.0, 1e300), 1.0);
        assert_eq!(smoothstep(12.0, 80.0, -1e300), 0.0);
        // (b - a) = 0: (v - a) / 0 = +-inf or NaN, like JS
        assert_eq!(smoothstep(1.0, 1.0, 2.0), 1.0);
        assert!(smoothstep(1.0, 1.0, 1.0).is_nan());
    }

    #[test]
    fn quarter_is_exact_division() {
        let mut s: u64 = 0x2545f4914f6cdd1d;
        for _ in 0..1_000_000 {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            let x = f64::from_bits(s);
            if x.is_nan() {
                continue;
            }
            assert_eq!((x * 0.25).to_bits(), (x / 4.0).to_bits(), "{x:e}");
            let y = f32::from_bits(s as u32) as f64 * 3.0;
            if !y.is_nan() {
                assert_eq!((y * 0.25).to_bits(), (y / 4.0).to_bits(), "{y:e}");
            }
        }
    }
}
