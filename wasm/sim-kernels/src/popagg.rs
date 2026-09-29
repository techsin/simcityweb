//! Population aggregate PROBE (benchmark only, not wired into the sim): a port of the daily growables aggregation of
//! `populationSystem → aggregate(sim, first)` (src/sim/economy/population.ts at commit 24f8609, lines ~250–360: the
//! totals / coarse-grid / employment-sample / demographics-sample loop over `rt.growables`, then the coarse 3×3 blur
//! and `blurCoarse`) over a STRUCT-OF-ARRAYS snapshot of the buildings. It answers the architect's question "how much
//! of the population cost is data layout and how much is language" — see tools/bench/populationAggregateProbe.bench.mjs.
//! Binding: src/wasm/kernels/populationAggregateProbeBind.ts; the JS twin (arm C, and the JS fallback) and the gather
//! from Building objects (arm E): src/wasm/js/populationAggregateProbe.ts.
//!
//! SoA per growable k (list order): dev u8 (255 = no def / no devType: skipped, like the JS `continue`), blk i32 (coarse
//! block, computed by the gather with the JS formula), flags i32 (ToInt32(b.flags)), pop / capacity / jobs f64,
//! wealth u8, id i32, kids / teens / yad / srs / edu f32 with NaN = undefined (the gather rejects values that do not
//! round-trip: non-f32 numbers, NaN, null, so NaN unambiguously means "absent"). mWf (cache.wf) and accessById are
//! f32 arrays read by building id, exactly as the JS does (an id outside mWf reads `undefined`: wk = NaN).
//!
//! Calling convention (as econ.rs): `ip` = i32 words (sizes, flags, byte pointers) at the indices of `ix`, `fp` = f64
//! (constants in, results out) at the indices of `fx`. Grids are f32[cw²]. Kernels never allocate or grow memory.
//!
//! Bit-exactness (wasm/README.md "Float / determinism rules"): every accumulation is done in the JS order and type —
//! f64 for the totals / W / accE / accW / unW / eduSum / eduPop / coh (JS numbers and a Float64Array), and for the
//! Float32Array grids `g[blk] = (g[blk] as f64 + v) as f32` (read, f64 add, round on store). `b.kids ?? COHORT_BASE[0]`
//! substitutes the f64 constant (0.13 is not an f32), `Math.max(0, x)` keeps NaN and turns -0 into +0, and
//! out-of-range grid indices skip the add (a JS typed-array write out of range is dropped). The blur sums in the JS
//! (dz, dx) order starting from +0 (so a -0 product cannot leak into the result).
//!
//! SIMD: the per-building loop is a chain of order-dependent scatter-adds (no lanes to exploit). The blurs vectorise
//! across two neighbouring blocks (f64x2 lanes are IEEE per lane and see the same op sequence); edge columns stay
//! scalar. `FL_SCALAR_BLUR` forces the scalar blur in a SIMD build (A/B of the explicit SIMD).

/// parameter-block layout version (populationAggregateProbeBind.ts POPAGG_LAYOUT)
pub const LAYOUT: u32 = 1;
/// capacity of the dev dimension (DEV_TYPE_COUNT = 12 at 24f8609)
pub const DEV_MAX: usize = 16;
/// residential devs are 0..=R_MAX (DevType.R3 = 2): the three popWRaw grids
pub const R_MAX: u8 = 2;
/// dev code of a growable the loop skips (no def, or a def without devType)
pub const DEV_SKIP: u8 = 255;

pub const FL_SAMPLE: i32 = 1;
pub const FL_DEMO: i32 = 2;
/// the traffic system gives worker access (tAcc): accE / accW / unW are summed; requires an access array (ACC)
pub const FL_TACC: i32 = 4;
/// `rt.coarsePopW[0].length === cc`: the demographics grids are blurred on demo days
pub const FL_DEMO_GRIDS: i32 = 8;
/// use the scalar blur even in a SIMD build
pub const FL_SCALAR_BLUR: i32 = 16;

#[unsafe(no_mangle)]
pub extern "C" fn popagg_layout() -> u32 {
    LAYOUT
}

/// `ip` indices (i32 words)
pub mod ix {
    pub const N: usize = 0;
    pub const CW: usize = 1;
    pub const FLAGS: usize = 2;
    /// length of the per-dev totals (DEV_TYPE_COUNT, <= DEV_MAX)
    pub const DEVS: usize = 3;
    /// BF.Abandoned | BF.Burnt
    pub const MASK_SKIP: usize = 4;
    /// BF.Constructing
    pub const MASK_CONSTR: usize = 5;
    /// out: index of the first building with an invalid dev code (return 1)
    pub const ERR_K: usize = 6;
    // SoA (n elements each)
    pub const DEV: usize = 8;
    pub const BLK: usize = 9;
    pub const BFLAGS: usize = 10;
    pub const POP: usize = 11;
    pub const CAP: usize = 12;
    pub const JOBS: usize = 13;
    pub const WEALTH: usize = 14;
    pub const ID: usize = 15;
    pub const KIDS: usize = 16;
    pub const TEENS: usize = 17;
    pub const YAD: usize = 18;
    pub const SRS: usize = 19;
    pub const EDU: usize = 20;
    // read by id
    pub const MWF: usize = 21;
    pub const MWF_LEN: usize = 22;
    pub const ACC: usize = 23;
    pub const ACC_LEN: usize = 24;
    // coarse grids (f32[cw²])
    pub const C_POP_RAW: usize = 25;
    pub const C_WEALTH_RAW: usize = 26;
    pub const C_COUNT_RAW: usize = 27;
    pub const C_POP: usize = 28;
    pub const C_WEALTH: usize = 29;
    /// popWRaw[0..3]
    pub const POPW_RAW: usize = 30;
    pub const SKILL_RAW: usize = 33;
    pub const KIDS_RAW: usize = 34;
    /// rt.coarsePopW[0..3]
    pub const C_POPW: usize = 35;
    pub const C_KIDS: usize = 38;
    pub const SKILL_BLUR: usize = 39;
    pub const C_SKILL: usize = 40;
    pub const LEN: usize = 48;
}

/// `fp` indices (f64)
pub mod fx {
    // in
    pub const EDU_FALLBACK: usize = 0;
    pub const WORKFORCE_RATIO: usize = 1;
    /// COHORT_BASE[0..5]
    pub const COHORT_BASE: usize = 2;
    // out
    pub const W: usize = 8;
    pub const ACC_E: usize = 9;
    pub const ACC_W: usize = 10;
    pub const UN_W: usize = 11;
    pub const EDU_SUM: usize = 12;
    pub const EDU_POP: usize = 13;
    pub const ABANDONED: usize = 14;
    pub const CONSTRUCTING: usize = 15;
    /// t.pop[3], t.resCapAll[3], t.resCapBuilt[3]
    pub const POP: usize = 16;
    pub const RES_CAP_ALL: usize = 19;
    pub const RES_CAP_BUILT: usize = 22;
    /// t.jobs / t.jobCapAll / t.jobCapBuilt / t.countByDev [DEV_MAX each]
    pub const JOBS: usize = 25;
    pub const JOB_CAP_ALL: usize = 25 + super::DEV_MAX;
    pub const JOB_CAP_BUILT: usize = 25 + 2 * super::DEV_MAX;
    pub const COUNT_BY_DEV: usize = 25 + 3 * super::DEV_MAX;
    /// coh[15] (in: unchanged on non-demo days; out: zeroed + summed on demo days)
    pub const COH: usize = 25 + 4 * super::DEV_MAX;
    pub const LEN: usize = COH + 15;
}

/// `Math.max(0, x)`: NaN stays NaN, -0 becomes +0
#[inline(always)]
pub fn js_max0(x: f64) -> f64 {
    if x > 0.0 || x != x { x } else { 0.0 }
}

/// # Safety
/// For n > 0, `p` must be a valid, aligned byte offset of `n` initialised elements (the binding validates lengths,
/// `ptr_ok` rejects null / misaligned pointers).
#[inline(always)]
unsafe fn sl<'a, T>(p: i32, n: usize) -> &'a [T] {
    if n == 0 {
        return &[];
    }
    unsafe { core::slice::from_raw_parts(p as u32 as usize as *const T, n) }
}
/// # Safety
/// as `sl`, and no other live slice may overlap the block (the binding rejects overlapping arguments)
#[inline(always)]
unsafe fn sl_mut<'a, T>(p: i32, n: usize) -> &'a mut [T] {
    if n == 0 {
        return &mut [];
    }
    unsafe { core::slice::from_raw_parts_mut(p as u32 as usize as *mut T, n) }
}

#[inline(always)]
fn ptr_ok(p: i32, align: i32) -> bool {
    p != 0 && p % align == 0
}

/// f32 grid accumulate in the JS way: `g[b] += v` on a Float32Array (read f32 -> f64 add -> round on store); an
/// out-of-range index drops the write like JS does
#[inline(always)]
fn acc32(g: &mut [f32], b: usize, v: f64) {
    if let Some(c) = g.get_mut(b) {
        *c = (*c as f64 + v) as f32;
    }
}

/// the SoA inputs of one call
pub struct Soa<'a> {
    pub dev: &'a [u8],
    pub blk: &'a [i32],
    pub flags: &'a [i32],
    pub pop: &'a [f64],
    pub cap: &'a [f64],
    pub jobs: &'a [f64],
    pub wealth: &'a [u8],
    pub id: &'a [i32],
    pub kids: &'a [f32],
    pub teens: &'a [f32],
    pub yad: &'a [f32],
    pub srs: &'a [f32],
    pub edu: &'a [f32],
}

/// scalar inputs of one call
pub struct Params {
    pub cw: usize,
    pub flags: i32,
    pub devs: usize,
    pub mask_skip: i32,
    pub mask_constr: i32,
    pub edu_fallback: f64,
    pub workforce_ratio: f64,
    pub cohort_base: [f64; 5],
}

/// results of the loop (the JS locals / rt.totals)
pub struct Totals {
    pub w: f64,
    pub acc_e: f64,
    pub acc_w: f64,
    pub un_w: f64,
    pub edu_sum: f64,
    pub edu_pop: f64,
    pub abandoned: u32,
    pub constructing: u32,
    pub pop: [f64; 3],
    pub res_cap_all: [f64; 3],
    pub res_cap_built: [f64; 3],
    pub jobs: [f64; DEV_MAX],
    pub job_cap_all: [f64; DEV_MAX],
    pub job_cap_built: [f64; DEV_MAX],
    pub count_by_dev: [u32; DEV_MAX],
    pub coh: [f64; 15],
}

impl Totals {
    pub fn new() -> Totals {
        Totals {
            w: 0.0, acc_e: 0.0, acc_w: 0.0, un_w: 0.0, edu_sum: 0.0, edu_pop: 0.0, abandoned: 0, constructing: 0,
            pop: [0.0; 3], res_cap_all: [0.0; 3], res_cap_built: [0.0; 3], jobs: [0.0; DEV_MAX], job_cap_all: [0.0; DEV_MAX],
            job_cap_built: [0.0; DEV_MAX], count_by_dev: [0; DEV_MAX], coh: [0.0; 15],
        }
    }
}

impl Default for Totals {
    fn default() -> Self {
        Totals::new()
    }
}

/// the grids the loop writes (all f32[cw²]; the demographics ones only on demo days)
pub struct RawGrids<'a> {
    pub pop: &'a mut [f32],
    pub wealth: &'a mut [f32],
    pub count: &'a mut [f32],
    pub popw: [&'a mut [f32]; 3],
    pub skill: &'a mut [f32],
    pub kids: &'a mut [f32],
}

/// The growables loop (population.ts 24f8609 lines 283–327) over the SoA. `t.coh` must hold the previous values (they
/// are only zeroed + summed on demo days). Returns Err(k) at the first building whose dev code is neither DEV_SKIP nor
/// < devs (the JS would index past its arrays; the binding reruns the call in JS).
pub fn aggregate_loop(s: &Soa, n: usize, mwf: &[f32], acc: Option<&[f32]>, p: &Params, g: &mut RawGrids, t: &mut Totals) -> Result<(), usize> {
    let sample = p.flags & FL_SAMPLE != 0;
    let demo = p.flags & FL_DEMO != 0;
    let tacc = p.flags & FL_TACC != 0;
    let wr = p.workforce_ratio;
    let cb = p.cohort_base;
    let (mut w, mut acc_e, mut acc_w, mut un_w, mut edu_sum, mut edu_pop) = (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
    let (mut abandoned, mut constructing_n) = (0u32, 0u32);
    if demo {
        t.coh = [0.0; 15];
    }
    let dev_a = &s.dev[..n];
    let blk_a = &s.blk[..n];
    let flags_a = &s.flags[..n];
    for k in 0..n {
        let dev = dev_a[k];
        if dev == DEV_SKIP {
            continue;
        }
        let d = dev as usize;
        if d >= p.devs {
            return Err(k);
        }
        let blk = blk_a[k] as u32 as usize; // negative -> huge -> out of range (dropped)
        let f = flags_a[k];
        if f & p.mask_skip != 0 {
            abandoned += 1;
            continue;
        }
        t.count_by_dev[d] += 1;
        let constructing = f & p.mask_constr != 0;
        if constructing {
            constructing_n += 1;
        }
        if dev <= R_MAX {
            let pv = s.pop[k];
            let cap = s.cap[k];
            t.pop[d] += pv;
            t.res_cap_all[d] += cap;
            if !constructing {
                t.res_cap_built[d] += cap;
            }
            acc32(g.pop, blk, pv);
            if pv > 0.0 && sample {
                let id = s.id[k];
                // mWf[id]: an f32 (NaN -> WORKFORCE_RATIO), or `undefined` outside the array (undefined === undefined,
                // so wk = p * undefined = NaN)
                let wk = match mwf.get(id as u32 as usize) {
                    Some(&v) => {
                        let wv = v as f64;
                        pv * (if wv == wv { wv } else { wr })
                    }
                    None => f64::NAN,
                };
                w += wk;
                if tacc {
                    // accArr: id < length ? accArr[id] (undefined for a negative id) : -1
                    let a = match acc {
                        Some(arr) => {
                            if (id as i64) < arr.len() as i64 {
                                if id >= 0 { arr[id as usize] as f64 } else { f64::NAN }
                            } else {
                                -1.0
                            }
                        }
                        None => f64::NAN, // unreachable: the binding requires the array with FL_TACC
                    };
                    if a >= 0.0 {
                        acc_e += wk * (if a < 1.0 { a } else { 1.0 });
                        acc_w += wk;
                    } else {
                        un_w += wk;
                    }
                }
            }
            if pv > 0.0 && demo {
                let (x0, x1, x2, x4) = (s.kids[k], s.teens[k], s.yad[k], s.srs[k]);
                let k0 = if x0 != x0 { cb[0] } else { x0 as f64 };
                let k1 = if x1 != x1 { cb[1] } else { x1 as f64 };
                let k2 = if x2 != x2 { cb[2] } else { x2 as f64 };
                let k4 = if x4 != x4 { cb[4] } else { x4 as f64 };
                let k3 = js_max0(1.0 - k0 - k1 - k2 - k4);
                let o = d * 5;
                t.coh[o] += pv * k0;
                t.coh[o + 1] += pv * k1;
                t.coh[o + 2] += pv * k2;
                t.coh[o + 3] += pv * k3;
                t.coh[o + 4] += pv * k4;
                let e = s.edu[k];
                let ev = if e != e { p.edu_fallback } else { e as f64 };
                if e == e {
                    edu_sum += pv * (e as f64);
                    edu_pop += pv;
                }
                acc32(g.popw[d], blk, pv);
                acc32(g.skill, blk, pv * ev);
                acc32(g.kids, blk, pv * k0);
            }
        } else {
            let cap = s.cap[k];
            t.jobs[d] += s.jobs[k];
            t.job_cap_all[d] += cap;
            if !constructing {
                t.job_cap_built[d] += cap;
            }
        }
        acc32(g.wealth, blk, s.wealth[k] as f64 - 2.0);
        acc32(g.count, blk, 1.0);
    }
    t.w = w;
    t.acc_e = acc_e;
    t.acc_w = acc_w;
    t.un_w = un_w;
    t.edu_sum = edu_sum;
    t.edu_pop = edu_pop;
    t.abandoned = abandoned;
    t.constructing = constructing_n;
    Ok(())
}

// ------------------------------------------------------------------------------------------------ blurs
/// weight of neighbour (dx, dz) (centre 1, the 8 neighbours 0.5)
#[inline(always)]
fn wgt(dx: isize, dz: isize) -> f64 {
    if dx == 0 && dz == 0 { 1.0 } else { 0.5 }
}

/// the main 3×3 blur of block (bx, bz), JS order: sp / sw / sc summed over dz = -1..1, dx = -1..1 (valid only)
#[inline(always)]
fn blur3_cell(pr: &[f32], wr: &[f32], cr: &[f32], cw: usize, bx: usize, bz: usize) -> (f64, f64, f64) {
    let (mut sp, mut sw, mut sc) = (0.0f64, 0.0f64, 0.0f64);
    for dz in -1isize..=1 {
        let z = bz as isize + dz;
        if z < 0 || z >= cw as isize {
            continue;
        }
        for dx in -1isize..=1 {
            let x = bx as isize + dx;
            if x < 0 || x >= cw as isize {
                continue;
            }
            let b = z as usize * cw + x as usize;
            let g = wgt(dx, dz);
            sp += pr[b] as f64 * g;
            sw += wr[b] as f64 * g;
            sc += cr[b] as f64 * g;
        }
    }
    (sp, sw, sc)
}

/// blurCoarse of block (bx, bz)
#[inline(always)]
fn blur1_cell(raw: &[f32], cw: usize, bx: usize, bz: usize) -> f64 {
    let mut s = 0.0f64;
    for dz in -1isize..=1 {
        let z = bz as isize + dz;
        if z < 0 || z >= cw as isize {
            continue;
        }
        for dx in -1isize..=1 {
            let x = bx as isize + dx;
            if x < 0 || x >= cw as isize {
                continue;
            }
            s += raw[z as usize * cw + x as usize] as f64 * wgt(dx, dz);
        }
    }
    s
}

/// population.ts "blur coarse grids (3×3)": coarsePop = blur(popRaw), coarseWealth = sc > 0 ? sw / sc : 0
pub fn blur_main_scalar(pr: &[f32], wr: &[f32], cr: &[f32], cpop: &mut [f32], cwealth: &mut [f32], cw: usize) {
    for bz in 0..cw {
        for bx in 0..cw {
            let (sp, sw, sc) = blur3_cell(pr, wr, cr, cw, bx, bz);
            cpop[bz * cw + bx] = sp as f32;
            cwealth[bz * cw + bx] = (if sc > 0.0 { sw / sc } else { 0.0 }) as f32;
        }
    }
}

/// blurCoarse(raw, out, cw)
pub fn blur_coarse_scalar(raw: &[f32], out: &mut [f32], cw: usize) {
    for bz in 0..cw {
        for bx in 0..cw {
            out[bz * cw + bx] = blur1_cell(raw, cw, bx, bz) as f32;
        }
    }
}

#[cfg(target_feature = "simd128")]
mod x2 {
    //! f64x2 blurs: lanes = blocks (bx, bx + 1) of one row with 1 <= bx and bx + 1 <= cw - 2 (all three dx neighbours
    //! exist for both), so both lanes run the scalar op sequence exactly; edge blocks use the scalar cell functions.
    use super::{blur1_cell, blur3_cell};
    use core::arch::wasm32::*;

    /// two adjacent f32 at `p` promoted to f64x2 (exact)
    #[inline(always)]
    unsafe fn ld(p: *const f32) -> v128 {
        unsafe { f64x2_promote_low_f32x4(v128_load64_zero(p as *const u64)) }
    }
    /// both lanes rounded to f32 and stored at p[0], p[1]
    #[inline(always)]
    unsafe fn st(v: v128, p: *mut f32) {
        unsafe { v128_store64_lane::<0>(f32x4_demote_f64x2_zero(v), p as *mut u64) }
    }

    /// rows z of the blur window of row bz: (z, valid)
    #[inline(always)]
    fn rows(bz: usize, cw: usize) -> [(usize, bool); 3] {
        [(bz.wrapping_sub(1), bz >= 1), (bz, true), (bz + 1, bz + 1 < cw)]
    }

    pub fn blur_main(pr: &[f32], wr: &[f32], cr: &[f32], cpop: &mut [f32], cwealth: &mut [f32], cw: usize) {
        let cc = cw * cw;
        assert!(pr.len() >= cc && wr.len() >= cc && cr.len() >= cc && cpop.len() >= cc && cwealth.len() >= cc);
        let half = f64x2_splat(0.5);
        let one = f64x2_splat(1.0);
        let zero = f64x2_splat(0.0);
        for bz in 0..cw {
            let edge = |bx: usize, cpop: &mut [f32], cwealth: &mut [f32]| {
                let (sp, sw, sc) = blur3_cell(pr, wr, cr, cw, bx, bz);
                cpop[bz * cw + bx] = sp as f32;
                cwealth[bz * cw + bx] = (if sc > 0.0 { sw / sc } else { 0.0 }) as f32;
            };
            if cw < 4 {
                for bx in 0..cw {
                    edge(bx, cpop, cwealth);
                }
                continue;
            }
            edge(0, cpop, cwealth);
            let rs = rows(bz, cw);
            let mut bx = 1;
            while bx + 1 <= cw - 2 {
                let (mut sp, mut sw, mut sc) = (zero, zero, zero);
                for (r, &(z, ok)) in rs.iter().enumerate() {
                    if !ok {
                        continue;
                    }
                    let base = z * cw + bx - 1;
                    for dx in 0..3 {
                        let g = if r == 1 && dx == 1 { one } else { half };
                        // SAFETY: base + dx + 1 <= z·cw + bx + 2 <= z·cw + cw - 1 < cc (asserted lengths)
                        unsafe {
                            sp = f64x2_add(sp, f64x2_mul(ld(pr.as_ptr().add(base + dx)), g));
                            sw = f64x2_add(sw, f64x2_mul(ld(wr.as_ptr().add(base + dx)), g));
                            sc = f64x2_add(sc, f64x2_mul(ld(cr.as_ptr().add(base + dx)), g));
                        }
                    }
                }
                // coarseWealth = sc > 0 ? sw / sc : 0 (NaN sc -> 0)
                let q = v128_and(f64x2_div(sw, sc), f64x2_gt(sc, zero));
                unsafe {
                    st(sp, cpop.as_mut_ptr().add(bz * cw + bx));
                    st(q, cwealth.as_mut_ptr().add(bz * cw + bx));
                }
                bx += 2;
            }
            while bx < cw {
                edge(bx, cpop, cwealth);
                bx += 1;
            }
        }
    }

    pub fn blur_coarse(raw: &[f32], out: &mut [f32], cw: usize) {
        let cc = cw * cw;
        assert!(raw.len() >= cc && out.len() >= cc);
        let half = f64x2_splat(0.5);
        let one = f64x2_splat(1.0);
        let zero = f64x2_splat(0.0);
        for bz in 0..cw {
            if cw < 4 {
                for bx in 0..cw {
                    out[bz * cw + bx] = blur1_cell(raw, cw, bx, bz) as f32;
                }
                continue;
            }
            out[bz * cw] = blur1_cell(raw, cw, 0, bz) as f32;
            let rs = rows(bz, cw);
            let mut bx = 1;
            while bx + 1 <= cw - 2 {
                let mut s = zero;
                for (r, &(z, ok)) in rs.iter().enumerate() {
                    if !ok {
                        continue;
                    }
                    let base = z * cw + bx - 1;
                    for dx in 0..3 {
                        let g = if r == 1 && dx == 1 { one } else { half };
                        unsafe { s = f64x2_add(s, f64x2_mul(ld(raw.as_ptr().add(base + dx)), g)) };
                    }
                }
                unsafe { st(s, out.as_mut_ptr().add(bz * cw + bx)) };
                bx += 2;
            }
            while bx < cw {
                out[bz * cw + bx] = blur1_cell(raw, cw, bx, bz) as f32;
                bx += 1;
            }
        }
    }
}

/// the main blur (explicit f64x2 in SIMD builds unless `scalar`)
pub fn blur_main(pr: &[f32], wr: &[f32], cr: &[f32], cpop: &mut [f32], cwealth: &mut [f32], cw: usize, scalar: bool) {
    #[cfg(target_feature = "simd128")]
    if !scalar {
        return x2::blur_main(pr, wr, cr, cpop, cwealth, cw);
    }
    let _ = scalar;
    blur_main_scalar(pr, wr, cr, cpop, cwealth, cw)
}

pub fn blur_coarse(raw: &[f32], out: &mut [f32], cw: usize, scalar: bool) {
    #[cfg(target_feature = "simd128")]
    if !scalar {
        return x2::blur_coarse(raw, out, cw);
    }
    let _ = scalar;
    blur_coarse_scalar(raw, out, cw)
}

// ------------------------------------------------------------------------------------------------ export
/// The probe kernel: zero the outputs, the growables loop, the coarse blur, and on demo days (FL_DEMO_GRIDS) the
/// demographics blurs + coarseSkill. Returns 0 (done), 1 (building ip[ERR_K] has an invalid dev code: outputs are
/// partially written, the binding reruns the call in JS, which rewrites every output), 2 (arguments outside the
/// kernel's domain: nothing written).
///
/// # Safety
/// `ip` must point to ix::LEN i32 and `fp` to fx::LEN f64 in linear memory; every pointer in `ip` that the call uses
/// must address the documented number of elements (n for the SoA, MWF_LEN / ACC_LEN, cw² for the grids), aligned, and
/// the written arrays must not overlap each other or any input (the binding checks all of this).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn popagg_aggregate(ip: *mut i32, fp: *mut f64) -> i32 {
    unsafe {
        let ip: &mut [i32] = sl_mut(ip as i32, ix::LEN);
        let fp: &mut [f64] = sl_mut(fp as i32, fx::LEN);
        let n = ip[ix::N];
        let cw = ip[ix::CW];
        let flags = ip[ix::FLAGS];
        let devs = ip[ix::DEVS];
        if n < 0 || !(1..=4096).contains(&cw) || !(3..=DEV_MAX as i32).contains(&devs) || ip[ix::MWF_LEN] < 0 || ip[ix::ACC_LEN] < 0 {
            return 2;
        }
        let (n, cw) = (n as usize, cw as usize);
        let cc = cw * cw;
        let sample = flags & FL_SAMPLE != 0;
        let demo = flags & FL_DEMO != 0;
        let tacc = flags & FL_TACC != 0;
        let demo_grids = flags & FL_DEMO_GRIDS != 0;
        // pointer checks: SoA (when n > 0), grids, the arrays read by id
        if n > 0 {
            for (k, a) in [(ix::BLK, 4), (ix::BFLAGS, 4), (ix::POP, 8), (ix::CAP, 8), (ix::JOBS, 8), (ix::ID, 4), (ix::KIDS, 4),
                (ix::TEENS, 4), (ix::YAD, 4), (ix::SRS, 4), (ix::EDU, 4), (ix::DEV, 1), (ix::WEALTH, 1)] {
                if !ptr_ok(ip[k], a) {
                    return 2;
                }
            }
        }
        for k in [ix::C_POP_RAW, ix::C_WEALTH_RAW, ix::C_COUNT_RAW, ix::C_POP, ix::C_WEALTH] {
            if !ptr_ok(ip[k], 4) {
                return 2;
            }
        }
        if demo {
            for k in [ix::POPW_RAW, ix::POPW_RAW + 1, ix::POPW_RAW + 2, ix::SKILL_RAW, ix::KIDS_RAW] {
                if !ptr_ok(ip[k], 4) {
                    return 2;
                }
            }
            if demo_grids {
                for k in [ix::C_POPW, ix::C_POPW + 1, ix::C_POPW + 2, ix::C_KIDS, ix::SKILL_BLUR, ix::C_SKILL] {
                    if !ptr_ok(ip[k], 4) {
                        return 2;
                    }
                }
            }
        }
        let mwf_len = ip[ix::MWF_LEN] as usize;
        let acc_len = ip[ix::ACC_LEN] as usize;
        if (mwf_len > 0 && !ptr_ok(ip[ix::MWF], 4)) || (tacc && (!ptr_ok(ip[ix::ACC], 4) && acc_len > 0)) {
            return 2;
        }
        let soa = Soa {
            dev: sl(ip[ix::DEV], n),
            blk: sl(ip[ix::BLK], n),
            flags: sl(ip[ix::BFLAGS], n),
            pop: sl(ip[ix::POP], n),
            cap: sl(ip[ix::CAP], n),
            jobs: sl(ip[ix::JOBS], n),
            wealth: sl(ip[ix::WEALTH], n),
            id: sl(ip[ix::ID], n),
            kids: sl(ip[ix::KIDS], n),
            teens: sl(ip[ix::TEENS], n),
            yad: sl(ip[ix::YAD], n),
            srs: sl(ip[ix::SRS], n),
            edu: sl(ip[ix::EDU], n),
        };
        let mwf: &[f32] = if sample { sl(ip[ix::MWF], mwf_len) } else { &[] };
        let acc: Option<&[f32]> = if tacc { Some(sl(ip[ix::ACC], acc_len)) } else { None };
        let pr: &mut [f32] = sl_mut(ip[ix::C_POP_RAW], cc);
        let wr: &mut [f32] = sl_mut(ip[ix::C_WEALTH_RAW], cc);
        let cr: &mut [f32] = sl_mut(ip[ix::C_COUNT_RAW], cc);
        pr.fill(0.0);
        wr.fill(0.0);
        cr.fill(0.0);
        // the demographics grids exist (and are written) on demo days only
        let (mut e0, mut e1, mut e2, mut e3, mut e4): ([f32; 0], [f32; 0], [f32; 0], [f32; 0], [f32; 0]) = ([], [], [], [], []);
        let (pw0, pw1, pw2, skill, kids): (&mut [f32], &mut [f32], &mut [f32], &mut [f32], &mut [f32]) = if demo {
            let a: &mut [f32] = sl_mut(ip[ix::POPW_RAW], cc);
            let b: &mut [f32] = sl_mut(ip[ix::POPW_RAW + 1], cc);
            let c: &mut [f32] = sl_mut(ip[ix::POPW_RAW + 2], cc);
            let d: &mut [f32] = sl_mut(ip[ix::SKILL_RAW], cc);
            let e: &mut [f32] = sl_mut(ip[ix::KIDS_RAW], cc);
            a.fill(0.0);
            b.fill(0.0);
            c.fill(0.0);
            d.fill(0.0);
            e.fill(0.0);
            (a, b, c, d, e)
        } else {
            (&mut e0, &mut e1, &mut e2, &mut e3, &mut e4)
        };
        let params = Params {
            cw,
            flags,
            devs: devs as usize,
            mask_skip: ip[ix::MASK_SKIP],
            mask_constr: ip[ix::MASK_CONSTR],
            edu_fallback: fp[fx::EDU_FALLBACK],
            workforce_ratio: fp[fx::WORKFORCE_RATIO],
            cohort_base: [fp[fx::COHORT_BASE], fp[fx::COHORT_BASE + 1], fp[fx::COHORT_BASE + 2], fp[fx::COHORT_BASE + 3], fp[fx::COHORT_BASE + 4]],
        };
        let mut t = Totals::new();
        for q in 0..15 {
            t.coh[q] = fp[fx::COH + q];
        }
        let mut g = RawGrids { pop: pr, wealth: wr, count: cr, popw: [pw0, pw1, pw2], skill, kids };
        if let Err(k) = aggregate_loop(&soa, n, mwf, acc, &params, &mut g, &mut t) {
            ip[ix::ERR_K] = k as i32;
            return 1;
        }
        // results
        fp[fx::W] = t.w;
        fp[fx::ACC_E] = t.acc_e;
        fp[fx::ACC_W] = t.acc_w;
        fp[fx::UN_W] = t.un_w;
        fp[fx::EDU_SUM] = t.edu_sum;
        fp[fx::EDU_POP] = t.edu_pop;
        fp[fx::ABANDONED] = t.abandoned as f64;
        fp[fx::CONSTRUCTING] = t.constructing as f64;
        for d in 0..3 {
            fp[fx::POP + d] = t.pop[d];
            fp[fx::RES_CAP_ALL + d] = t.res_cap_all[d];
            fp[fx::RES_CAP_BUILT + d] = t.res_cap_built[d];
        }
        for d in 0..DEV_MAX {
            fp[fx::JOBS + d] = t.jobs[d];
            fp[fx::JOB_CAP_ALL + d] = t.job_cap_all[d];
            fp[fx::JOB_CAP_BUILT + d] = t.job_cap_built[d];
            fp[fx::COUNT_BY_DEV + d] = t.count_by_dev[d] as f64;
        }
        for q in 0..15 {
            fp[fx::COH + q] = t.coh[q];
        }
        // blurs
        let scalar = flags & FL_SCALAR_BLUR != 0;
        let RawGrids { pop: pr, wealth: wr, count: cr, popw, skill, kids } = g;
        let cpop: &mut [f32] = sl_mut(ip[ix::C_POP], cc);
        let cwealth: &mut [f32] = sl_mut(ip[ix::C_WEALTH], cc);
        blur_main(pr, wr, cr, cpop, cwealth, cw, scalar);
        if demo && demo_grids {
            let [pw0, pw1, pw2] = popw;
            for (w, raw) in [pw0, pw1, pw2].into_iter().enumerate() {
                let out: &mut [f32] = sl_mut(ip[ix::C_POPW + w], cc);
                blur_coarse(raw, out, cw, scalar);
            }
            let ck: &mut [f32] = sl_mut(ip[ix::C_KIDS], cc);
            blur_coarse(kids, ck, cw, scalar);
            let sb: &mut [f32] = sl_mut(ip[ix::SKILL_BLUR], cc);
            blur_coarse(skill, sb, cw, scalar);
            let cs: &mut [f32] = sl_mut(ip[ix::C_SKILL], cc);
            for q in 0..cc {
                let cp = cpop[q];
                cs[q] = (if cp > 0.0 { sb[q] as f64 / cp as f64 } else { 0.0 }) as f32;
            }
        }
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rng(seed: u32) -> impl FnMut() -> f64 {
        let mut s = if seed == 0 { 1 } else { seed };
        move || {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            s as f64 / 4294967296.0
        }
    }

    #[test]
    fn max0_js_semantics() {
        assert_eq!(js_max0(-0.0).to_bits(), 0.0f64.to_bits());
        assert_eq!(js_max0(0.0).to_bits(), 0.0f64.to_bits());
        assert!(js_max0(f64::NAN).is_nan());
        assert_eq!(js_max0(-3.0), 0.0);
        assert_eq!(js_max0(0.25), 0.25);
        assert_eq!(js_max0(f64::INFINITY), f64::INFINITY);
        assert_eq!(js_max0(f64::NEG_INFINITY), 0.0);
    }

    #[test]
    fn acc32_drops_out_of_range() {
        let mut g = [1.5f32, 2.0];
        acc32(&mut g, 7, 1.0);
        acc32(&mut g, usize::MAX, 1.0);
        acc32(&mut g, 1, 0.1);
        assert_eq!(g[0], 1.5);
        assert_eq!(g[1], (2.0f64 + 0.1) as f32);
    }

    /// the scalar blur equals a literal transcription of the JS loops (incl. -0 / NaN / huge values)
    #[test]
    fn blur_matches_literal_js() {
        for cw in [1usize, 2, 3, 4, 5, 7, 32] {
            let mut r = rng(cw as u32 * 7 + 1);
            let cc = cw * cw;
            let mut mk = || -> alloc_free::V {
                let mut v = alloc_free::V::new(cc);
                for q in 0..cc {
                    let u = r();
                    v.0[q] = if u < 0.05 { -0.0 } else if u < 0.08 { f32::NAN } else if u < 0.1 { 3.0e38 } else { ((r() - 0.3) * 1000.0) as f32 };
                }
                v
            };
            let (pr, wr, cr) = (mk(), mk(), mk());
            let mut cpop = alloc_free::V::new(cc);
            let mut cwe = alloc_free::V::new(cc);
            blur_main_scalar(&pr.0, &wr.0, &cr.0, &mut cpop.0, &mut cwe.0, cw);
            for bz in 0..cw {
                for bx in 0..cw {
                    let (mut sp, mut sw, mut sc) = (0.0f64, 0.0f64, 0.0f64);
                    for dz in -1i32..=1 {
                        let z = bz as i32 + dz;
                        if z < 0 || z >= cw as i32 { continue; }
                        for dx in -1i32..=1 {
                            let x = bx as i32 + dx;
                            if x < 0 || x >= cw as i32 { continue; }
                            let b = (z * cw as i32 + x) as usize;
                            let w = if dx == 0 && dz == 0 { 1.0 } else { 0.5 };
                            sp += pr.0[b] as f64 * w; sw += wr.0[b] as f64 * w; sc += cr.0[b] as f64 * w;
                        }
                    }
                    let q = bz * cw + bx;
                    let e1 = sp as f32;
                    let e2 = (if sc > 0.0 { sw / sc } else { 0.0 }) as f32;
                    assert!(e1.to_bits() == cpop.0[q].to_bits() || (e1.is_nan() && cpop.0[q].is_nan()));
                    assert!(e2.to_bits() == cwe.0[q].to_bits() || (e2.is_nan() && cwe.0[q].is_nan()));
                }
            }
        }
    }

    /// tiny heap-free vector for the host tests (the crate is no_std on wasm, std on the host)
    mod alloc_free {
        pub struct V(pub std::vec::Vec<f32>);
        impl V {
            pub fn new(n: usize) -> V {
                V(std::vec![0.0; n])
            }
        }
    }
}
