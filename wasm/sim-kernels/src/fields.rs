//! Field passes: the NIMBY / YIMBY rasters and the pollution field stages — ports of src/sim/infra/nimby.ts
//! (`rebuildNimby`: splatAdd over the kernel tables, the landfill 2×2 blocks, the highway / rail corridor splatMax, the
//! 1 − exp(−x) pass) and src/sim/infra/pollution.ts (`stageCells`' cell loop + freight rail + landfill regions,
//! `saturate`, `stageB`'s water stage, the soil stock loop of `stageFlags`) at commit 24f8609. Binding:
//! src/wasm/kernels/fieldPassesBind.ts; the restructured JS twin (fair A/B baseline and JS fallback):
//! src/wasm/js/fieldPasses.ts. What stays JS: the building walks (source strengths from Building / DefInfo, plantLoad,
//! getDef stage), the garbage steps, flags and events, the blur calls (already ported: blur.rs).
//!
//! Calling convention (as in econ.rs / catch.rs): `ip: *mut i32` holds integers and byte pointers at the fixed indices
//! of the `*_ix` modules (a few slots are outputs), `fp: *const f64` the float parameters at the indices of `*_fx`. The
//! binding fills both blocks per call (`fields_layout()` must equal its FIELDS_LAYOUT). Layers are N×N arrays (cell
//! i = z·N + x): the CityState / PollutionSystem arrays themselves (resident in wasm memory, zero copy) or staging
//! blocks. Kernels never allocate and never grow memory; a null pointer (0) marks an absent optional array.
//!
//! NIMBY kernel tables (built in JS exactly as nimby.ts kernelOf, keyed the same way) are stored as ROW RUNS:
//! `i32 nRuns, i32 n, (dz, dx0, len)·nRuns, f32 w[n]` — the entries of one run are consecutive cells of one row, in
//! the table's entry order, so a splat touches exactly the cells (and weights) of the original entry list.
//!
//! Bit-exactness (wasm/README.md "Float / determinism rules"):
//!  * f64 in the JS evaluation order, f32 exactly where the JS stores into a Float32Array
//!    (`out[i] = f32(out[i] + amount·w)`, `L = f32(L + (t − L)·alpha)`, …); comparisons against f64 literals are
//!    done in f64 (`g > 0.02` compares the promoted f32 with the double 0.02);
//!  * sources are applied in the JS order (per cell, the adds arrive in the same sequence); the order WITHIN one splat
//!    does not matter (every cell is touched once per splat);
//!  * Math.exp / Math.log are the fdlibm ports of V8's ieee754::exp / log (fdlibm.rs); the binding self-tests them
//!    against the engine's Math.exp / Math.log (`fields_math_batch`) and runs JS if any bit differs;
//!  * Math.min / Math.max keep their NaN / ±0 semantics wherever that can matter (`js_max0`, `its`), ToInt32 of the
//!    SAT index is a plain truncation because the index is known to be in [0, 4096).
//!
//! Index lists (freight rail cells, landfill cells) are scatter targets: an index outside [0, C) is skipped, which is
//! what the JS does (a typed-array store out of range is a no-op). The water kernel validates its lists (water cells,
//! neighbour slots, bank cells) BEFORE writing anything and returns 1 when one is out of range (the binding then runs the
//! JS, whose out-of-range reads produce NaN / undefined semantics not worth emulating).

use crate::fdlibm::{exp, log};

/// parameter-block layout version (fieldPassesBind.ts FIELDS_LAYOUT)
pub const LAYOUT: u32 = 1;
/// SAT lookup table size (pollution.ts SAT_N): f32[SAT_N + 1]
pub const SAT_N: usize = 4096;

#[unsafe(no_mangle)]
pub extern "C" fn fields_layout() -> u32 {
    LAYOUT
}

/// NIMBY parameter block (`fields_nimby`)
pub mod nimby_ix {
    pub const N: usize = 0;
    /// sources: count, i32[4·n] (bx, bz, target 0 stigma / 1 prestige / 2 campus, table id), f64[n] amounts
    pub const NSRC: usize = 1;
    pub const SRC: usize = 2;
    pub const AMT: usize = 3;
    /// f32[C] accumulators (kernel-owned): stigma, prestige, campus, corridor line
    pub const STIG: usize = 4;
    pub const PRES: usize = 5;
    pub const CAMP: usize = 6;
    pub const LINE: usize = 7;
    /// landfill blocks: zone u8[C], landfillFill f32[C] (0 = none), the landfill zone code, the id of the (lfR, 2, 2)
    /// table (-1 = no splats)
    pub const ZONE: usize = 8;
    pub const FILL: usize = 9;
    pub const LF_CODE: usize = 10;
    pub const LF_TAB: usize = 11;
    /// corridors: network u8[C], netFlags u8[C], previous class map u8[C] (kernel-owned), valid (the class map is from
    /// this N), force (rebuild the raster even when unchanged), the ids of the (R, 1, 1) tables of highway / rail,
    /// network codes
    pub const NET: usize = 12;
    pub const FLAGS: usize = 13;
    pub const CLS: usize = 14;
    pub const VALID: usize = 15;
    pub const FORCE: usize = 16;
    pub const TAB_H: usize = 17;
    pub const TAB_R: usize = 18;
    pub const HIGHWAY: usize = 19;
    pub const RAIL: usize = 20;
    /// final pass outputs: stigma, prestige, campus f32[C] (CityState layers)
    pub const S: usize = 21;
    pub const P: usize = 22;
    pub const K: usize = 23;
    /// outputs: landfill blocks splatted, corridor raster rebuilt (0 / 1), highway cells (non-tunnel), rail cells
    pub const OUT_LF: usize = 24;
    pub const OUT_CHANGED: usize = 25;
    pub const OUT_NH: usize = 26;
    pub const OUT_NR: usize = 27;
    /// table directory: i32[NTABS] byte offsets of the tables, indexed by table id
    pub const TABS: usize = 28;
    pub const NTABS: usize = 29;
    pub const LEN: usize = 30;
}
pub mod nimby_fx {
    /// landfill stigma amount per block and NIMBY_LANDFILL_IDLE
    pub const LF_A: usize = 0;
    pub const LF_IDLE: usize = 1;
    /// corridor amounts: highway, highway bridge, rail
    pub const A_H: usize = 2;
    pub const A_HB: usize = 3;
    pub const A_R: usize = 4;
    pub const LEN: usize = 5;
}
/// `fields_nimby` phases (bit mask)
pub const PH_SPLAT: i32 = 1;
pub const PH_LANDFILL: i32 = 2;
pub const PH_CORRIDOR: i32 = 4;
pub const PH_FINAL: i32 = 8;

/// stageCells parameter block (`fields_cells`)
pub mod cells_ix {
    pub const C: usize = 0;
    pub const GARBAGE: usize = 1;
    pub const BUILDING: usize = 2;
    pub const SOIL: usize = 3;
    pub const NET: usize = 4;
    pub const TRAFFIC: usize = 5;
    pub const CONG: usize = 6;
    pub const FLAGS: usize = 7;
    /// class-0 source fields (in / out): air[0], waterS[0], noiseS[0]; soilSrc (in / out)
    pub const A0: usize = 8;
    pub const W0: usize = 9;
    pub const N0: usize = 10;
    pub const SOIL_SRC: usize = 11;
    /// freight rail cells i32[n] (0 = none)
    pub const FREIGHT: usize = 12;
    pub const NFREIGHT: usize = 13;
    /// landfill regions: lfOrder i32[..], count, i32[2·n] (start, count), f64[4·n] (air, water, noise, soil adds)
    pub const LF_ORDER: usize = 14;
    pub const LF_ORDER_LEN: usize = 15;
    pub const NREG: usize = 16;
    pub const REG: usize = 17;
    pub const REG_F: usize = 18;
    pub const HIGHWAY: usize = 19;
    pub const RAIL: usize = 20;
    pub const LEN: usize = 21;
}
pub mod cells_fx {
    /// areaSource(GARBAGE_SMELL, AIR_K) · fx.air
    pub const SMELL: usize = 0;
    /// srcScale(WATER_K) (soil leaching: intensityToSource(SOIL_GROUNDWATER · soil, waterK))
    pub const WATER_K: usize = 1;
    pub const SOIL_GW: usize = 2;
    /// AIR_PER_TRIP · fx.air
    pub const TRAFFIC_AIR: usize = 3;
    pub const TUNNEL_AIR: usize = 4;
    pub const CONG_DAMP: usize = 5;
    /// intensityToSource(NOISE_CROSSING, noiseK) · tn
    pub const CROSSING: usize = 6;
    pub const NOISE_PER_TRIP: usize = 7;
    pub const TUNNEL_NOISE: usize = 8;
    pub const BRIDGE_NOISE: usize = 9;
    /// fx3.noiseTraffic
    pub const TN: usize = 10;
    /// intensityToSource(NOISE_FREIGHT_RAIL, noiseK) · tn
    pub const FREIGHT_S: usize = 11;
    /// NOISE_PER_TRIP_NET[0..8) and baseNoiseSources(noiseK)[0..8) (f32 values), by network code
    pub const PER_TRIP: usize = 12;
    pub const BASE: usize = 20;
    pub const LEN: usize = 28;
}
/// `fields_cells` result bits: anyA (used[0]), anyN (used[5]), anyW (used[3]) of the cell loop
pub const USED_A: i32 = 1;
pub const USED_N: i32 = 2;
pub const USED_W: i32 = 4;

/// saturate parameter block (`fields_saturate`)
pub mod sat_ix {
    pub const C: usize = 0;
    pub const FIELD: usize = 1;
    pub const L: usize = 2;
    /// u8[C] or 0; buffers f32[C] or 0
    pub const MASK: usize = 3;
    pub const BUF1: usize = 4;
    pub const BUF2: usize = 5;
    /// SAT table f32[SAT_N + 1]
    pub const SAT: usize = 6;
    pub const LEN: usize = 7;
}
pub mod sat_fx {
    /// (invK · SAT_N) / SAT_MAX as the JS computes it
    pub const SCALE: usize = 0;
    pub const ALPHA: usize = 1;
    pub const K1: usize = 2;
    pub const K2: usize = 3;
    pub const LEN: usize = 4;
}

/// stageB parameter block (`fields_water`)
pub mod water_ix {
    pub const C: usize = 0;
    /// blurred water sources (in; afterwards the diffusion's `nxt`), tmp2 (the diffusion's `cur`)
    pub const TMP: usize = 1;
    pub const TMP2: usize = 2;
    pub const L: usize = 3;
    pub const GROUND: usize = 4;
    pub const WATER: usize = 5;
    pub const SAT: usize = 6;
    /// water cells i32[nW], neighbour slots i32[4·nW], bank cells / their water cell i32[nBank]
    pub const CELLS: usize = 7;
    pub const NW: usize = 8;
    pub const NB: usize = 9;
    pub const BANK: usize = 10;
    pub const BANK_SRC: usize = 11;
    pub const NBANK: usize = 12;
    pub const ITERS: usize = 13;
    /// kernel scratch: f64[nW] inflow terms, f64[nW] divisors n, i32[4·nW] padded water-neighbour lists,
    /// f32[nW + 1] ×2 private cur / nxt buffers
    pub const INFL: usize = 14;
    pub const NDIV: usize = 15;
    pub const WLIST: usize = 16;
    pub const CUR: usize = 17;
    pub const NXT: usize = 18;
    pub const LEN: usize = 19;
}
pub mod water_fx {
    pub const SCALE: usize = 0;
    pub const ALPHA: usize = 1;
    /// WATER_DIFFUSE_KEEP, the inflow gain (0.12), the negative-source cleaning gain (0.05), BANK_COUPLING
    pub const KEEP: usize = 2;
    pub const INFLOW: usize = 3;
    pub const CLEAN: usize = 4;
    pub const BANK: usize = 5;
    pub const LEN: usize = 6;
}
/// neighbour slot of a missing neighbour (map edge)
pub const NO_NB: i32 = 0x7fff_ffff;

// ------------------------------------------------------------------------------------------------ helpers
#[inline(always)]
unsafe fn sl<'a, T>(p: i32, n: usize) -> &'a [T] {
    if n == 0 {
        return &[];
    }
    unsafe { core::slice::from_raw_parts(p as u32 as usize as *const T, n) }
}
#[inline(always)]
unsafe fn sl_mut<'a, T>(p: i32, n: usize) -> &'a mut [T] {
    if n == 0 {
        return &mut [];
    }
    unsafe { core::slice::from_raw_parts_mut(p as u32 as usize as *mut T, n) }
}

/// `Math.max(0, v)`: NaN stays NaN, −0 and negatives give +0
#[inline(always)]
fn js_max0(v: f64) -> f64 {
    if v != v {
        v
    } else if v > 0.0 {
        v
    } else {
        0.0
    }
}

/// pollution.ts intensityToSource(I, scale): 0 for ±0, else ±(−ln(1 − min(0.95, |I|)) · scale)
#[inline(always)]
fn its(i: f64, scale: f64) -> f64 {
    if i == 0.0 {
        return 0.0;
    }
    let ab = f64::from_bits(i.to_bits() & 0x7fff_ffff_ffff_ffff);
    // Math.min(0.95, |I|): NaN propagates (|I| is never −0 here)
    let a = if ab != ab {
        ab
    } else if ab < 0.95 {
        ab
    } else {
        0.95
    };
    let v = -log(1.0 - a) * scale;
    if i < 0.0 { -v } else { v }
}

/// a NIMBY kernel table (row runs + weights) at byte offset `tab`
struct Table<'a> {
    runs: &'a [i32],
    w: &'a [f32],
}
#[inline(always)]
unsafe fn table<'a>(tab: i32) -> Table<'a> {
    let h = tab as u32 as usize as *const i32;
    let nr = unsafe { *h } as usize;
    let n = unsafe { *h.add(1) } as usize;
    unsafe { Table { runs: sl(tab + 8, 3 * nr), w: sl(tab + 8 + 12 * nr as i32, n) } }
}

/// splatAdd over one table: out[z·N + x] = f32(out + amount · w) for every in-map cell of the table at (bx, bz)
#[inline(always)]
fn splat_add(out: &mut [f32], n: i32, bx: i32, bz: i32, t: &Table, amount: f64) {
    let mut wi = 0usize;
    for run in t.runs.chunks_exact(3) {
        let (dz, dx0, len) = (run[0], run[1], run[2]);
        let z = bz + dz;
        if z >= 0 && z < n {
            let x0 = bx + dx0;
            let x1 = x0 + len;
            let xa = if x0 > 0 { x0 } else { 0 };
            let xb = if x1 < n { x1 } else { n };
            if xa < xb {
                let row = (z * n) as usize;
                let o = &mut out[row + xa as usize..row + xb as usize];
                let w = &t.w[wi + (xa - x0) as usize..wi + (xb - x0) as usize];
                for (a, &b) in o.iter_mut().zip(w) {
                    *a = (*a as f64 + amount * b as f64) as f32;
                }
            }
        }
        wi += len as usize;
    }
}

/// splatMax over one table: v = amount · w; out = f32(v) where v > out
#[inline(always)]
fn splat_max(out: &mut [f32], n: i32, bx: i32, bz: i32, t: &Table, amount: f64) {
    let mut wi = 0usize;
    for run in t.runs.chunks_exact(3) {
        let (dz, dx0, len) = (run[0], run[1], run[2]);
        let z = bz + dz;
        if z >= 0 && z < n {
            let x0 = bx + dx0;
            let x1 = x0 + len;
            let xa = if x0 > 0 { x0 } else { 0 };
            let xb = if x1 < n { x1 } else { n };
            if xa < xb {
                let row = (z * n) as usize;
                let o = &mut out[row + xa as usize..row + xb as usize];
                let w = &t.w[wi + (xa - x0) as usize..wi + (xb - x0) as usize];
                for (a, &b) in o.iter_mut().zip(w) {
                    let v = amount * b as f64;
                    if v > *a as f64 {
                        *a = v as f32;
                    }
                }
            }
        }
        wi += len as usize;
    }
}

// ------------------------------------------------------------------------------------------------ NIMBY
/// rebuildNimby's raster work, by phase (PH_* bits, in this order): building splats (STIG / PRES / CAMP cleared, then
/// the source list in its order), landfill 2×2 blocks (after the buildings, into STIG), corridors (class map compare;
/// the LINE raster is rebuilt with splatMax in cell order only when the map changed, VALID = 0 or FORCE), final
/// 1 − exp(−x) into S / P / K. Returns 0.
/// # Safety
/// every pointer of the block must be valid for its documented length (C = N²); the four accumulators, CLS and the
/// outputs must not overlap each other or any input.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn fields_nimby(ip: *mut i32, fp: *const f64, phases: i32) -> i32 {
    use nimby_fx as fx;
    use nimby_ix as ix;
    let rd = |k: usize| unsafe { *ip.add(k) };
    let rf = |k: usize| unsafe { *fp.add(k) };
    let n = rd(ix::N);
    if n <= 0 {
        return 0;
    }
    let c = (n as usize) * (n as usize);
    let stig = unsafe { sl_mut::<f32>(rd(ix::STIG), c) };
    let pres = unsafe { sl_mut::<f32>(rd(ix::PRES), c) };
    let camp = unsafe { sl_mut::<f32>(rd(ix::CAMP), c) };
    let line = unsafe { sl_mut::<f32>(rd(ix::LINE), c) };
    let tabs = unsafe { sl::<i32>(rd(ix::TABS), rd(ix::NTABS).max(0) as usize) };

    if phases & PH_SPLAT != 0 {
        stig.fill(0.0);
        pres.fill(0.0);
        camp.fill(0.0);
        let ns = rd(ix::NSRC).max(0) as usize;
        let src = unsafe { sl::<i32>(rd(ix::SRC), 4 * ns) };
        let amt = unsafe { sl::<f64>(rd(ix::AMT), ns) };
        for s in 0..ns {
            let r = &src[4 * s..4 * s + 4];
            let t = unsafe { table(tabs[r[3] as usize]) };
            let out: &mut [f32] = match r[2] {
                0 => &mut *stig,
                1 => &mut *pres,
                _ => &mut *camp,
            };
            splat_add(out, n, r[0], r[1], &t, amt[s]);
        }
    }

    if phases & PH_LANDFILL != 0 {
        let tab = rd(ix::LF_TAB);
        let mut count = 0i32;
        if tab >= 0 {
            let t = unsafe { table(tabs[tab as usize]) };
            let zone = unsafe { sl::<u8>(rd(ix::ZONE), c) };
            let fp_ = rd(ix::FILL);
            let fill = if fp_ != 0 { unsafe { sl::<f32>(fp_, c) } } else { &[][..] };
            let lf = Landfill { zone, fill, has_fill: fp_ != 0, code: rd(ix::LF_CODE) as u8, lf_a: rf(fx::LF_A), idle: rf(fx::LF_IDLE) };
            count = landfill_phase(stig, n as usize, &lf, &t);
        }
        unsafe { *ip.add(ix::OUT_LF) = count };
    }

    if phases & PH_CORRIDOR != 0 {
        let net = unsafe { sl::<u8>(rd(ix::NET), c) };
        let flags = unsafe { sl::<u8>(rd(ix::FLAGS), c) };
        let cls = unsafe { sl_mut::<u8>(rd(ix::CLS), c) };
        let (hw, rail) = (rd(ix::HIGHWAY) as u8, rd(ix::RAIL) as u8);
        let (mut changed, nh, nr) = corridor_classes(net, flags, cls, hw, rail);
        if rd(ix::VALID) == 0 || rd(ix::FORCE) != 0 {
            changed = true;
        }
        if changed {
            line.fill(0.0);
            let th = unsafe { table(tabs[rd(ix::TAB_H) as usize]) };
            let tr = unsafe { table(tabs[rd(ix::TAB_R) as usize]) };
            let (ah, ahb, ar) = (rf(fx::A_H), rf(fx::A_HB), rf(fx::A_R));
            let nu = n as usize;
            for i in 0..c {
                let k = cls[i];
                if k == 0 {
                    continue;
                }
                let (x, z) = ((i % nu) as i32, (i / nu) as i32);
                match k {
                    1 => splat_max(line, n, x, z, &th, ah),
                    2 => splat_max(line, n, x, z, &th, ahb),
                    _ => splat_max(line, n, x, z, &tr, ar),
                }
            }
        }
        unsafe {
            *ip.add(ix::OUT_CHANGED) = changed as i32;
            *ip.add(ix::OUT_NH) = nh as i32;
            *ip.add(ix::OUT_NR) = nr as i32;
        }
    }

    if phases & PH_FINAL != 0 {
        let s = unsafe { sl_mut::<f32>(rd(ix::S), c) };
        let p = unsafe { sl_mut::<f32>(rd(ix::P), c) };
        let k = unsafe { sl_mut::<f32>(rd(ix::K), c) };
        final_pass(stig, line, pres, camp, s, p, k);
    }
    0
}

/// the landfill layers and numbers of one rebuild
struct Landfill<'a> {
    zone: &'a [u8],
    fill: &'a [f32],
    has_fill: bool,
    code: u8,
    lf_a: f64,
    idle: f64,
}

/// one 2×2 landfill block at (x, z): cell count and clamped fill as nimby.ts, splatted when the amount is > 0 (1 = splatted)
#[inline(always)]
fn landfill_block(stig: &mut [f32], nu: usize, x: usize, z: usize, lf: &Landfill, t: &Table) -> i32 {
    let mut cnt = 0i32;
    let mut f_sum = 0.0f64;
    let mut dz = 0;
    while dz < 2 && z + dz < nu {
        let mut dx = 0;
        while dx < 2 && x + dx < nu {
            let i = (z + dz) * nu + x + dx;
            if lf.zone[i] == lf.code {
                cnt += 1;
                let f = if lf.has_fill { lf.fill[i] as f64 } else { 0.0 };
                f_sum += if f > 0.0 {
                    if f < 1.0 { f } else { 1.0 }
                } else {
                    0.0
                };
            }
            dx += 1;
        }
        dz += 1;
    }
    if cnt > 0 {
        let cf = cnt as f64;
        let amount = lf.lf_a * (lf.idle + (1.0 - lf.idle) * (f_sum / cf)) * cf / 4.0;
        if amount > 0.0 {
            splat_add(stig, nu as i32, x as i32, z as i32, t, amount);
            return 1;
        }
    }
    0
}

/// every 2×2 block in (z, x) order (the SIMD build skips 16-column spans of both rows that hold no landfill cell:
/// those blocks have cnt = 0 and splat nothing); returns the number of splatted blocks
fn landfill_phase(stig: &mut [f32], nu: usize, lf: &Landfill, t: &Table) -> i32 {
    let mut count = 0i32;
    let mut z = 0usize;
    while z < nu {
        #[cfg(target_feature = "simd128")]
        let (r0, r1) = (z * nu, if z + 1 < nu { (z + 1) * nu } else { z * nu });
        let mut x = 0usize;
        while x < nu {
            #[cfg(target_feature = "simd128")]
            if x + 16 <= nu && !simd::any_eq16(lf.zone, r0 + x, r1 + x, lf.code) {
                x += 16;
                continue;
            }
            count += landfill_block(stig, nu, x, z, lf, t);
            x += 2;
        }
        z += 2;
    }
    count
}

/// the corridor class map (0 none, 1 highway, 2 highway bridge, 3 rail; tunnels are none) written into `cls`; returns
/// (any cell changed, highway cells, rail cells)
fn corridor_classes(net: &[u8], flags: &[u8], cls: &mut [u8], hw: u8, rail: u8) -> (bool, u32, u32) {
    let c = cls.len();
    let (mut changed, mut nh, mut nr) = (false, 0u32, 0u32);
    let mut i = 0usize;
    #[cfg(target_feature = "simd128")]
    while i + 16 <= c {
        let (ch, h, r) = simd::corridor16(net, flags, cls, i, hw, rail);
        changed |= ch;
        nh += h;
        nr += r;
        i += 16;
    }
    while i < c {
        let t = net[i];
        let k = if t == hw {
            let f = flags[i];
            if f & 2 != 0 {
                0
            } else {
                nh += 1;
                if f & 1 != 0 { 2 } else { 1 }
            }
        } else if t == rail {
            nr += 1;
            3
        } else {
            0
        };
        if cls[i] != k {
            cls[i] = k;
            changed = true;
        }
        i += 1;
    }
    (changed, nh, nr)
}

/// the 1 − exp(−x) pass: S = a > 0 ? f32(1 − exp(−a)) : 0 with a = stig + line (f32 + f32 in f64), P / K likewise
fn final_pass(stig: &[f32], line: &[f32], pres: &[f32], camp: &[f32], s: &mut [f32], p: &mut [f32], k: &mut [f32]) {
    let c = s.len();
    let mut i = 0usize;
    #[cfg(target_feature = "simd128")]
    while i + 2 <= c {
        simd::final2(stig, line, pres, camp, s, p, k, i);
        i += 2;
    }
    while i < c {
        let a = stig[i] as f64 + line[i] as f64;
        s[i] = if a > 0.0 { (1.0 - exp(-a)) as f32 } else { 0.0 };
        let pv = pres[i] as f64;
        p[i] = if pv > 0.0 { (1.0 - exp(-pv)) as f32 } else { 0.0 };
        let cv = camp[i] as f64;
        k[i] = if cv > 0.0 { (1.0 - exp(-cv)) as f32 } else { 0.0 };
        i += 1;
    }
}

// ------------------------------------------------------------------------------------------------ pollution: cells
/// stageCells' field work: the cell loop (garbage smell, soil leaching, traffic / network sources with tunnel, bridge,
/// crossing and congestion damping), then the freight rail cells, then the landfill regions (air / water / noise /
/// soil adds per cell of lfOrder). Returns the USED_* bits of the cell loop.
/// # Safety
/// every pointer valid for its documented length; A0 / W0 / N0 / SOIL_SRC must not overlap each other or the inputs.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn fields_cells(ip: *const i32, fp: *const f64) -> i32 {
    use cells_fx as fx;
    use cells_ix as ix;
    let rd = |k: usize| unsafe { *ip.add(k) };
    let rf = |k: usize| unsafe { *fp.add(k) };
    let c = rd(ix::C).max(0) as usize;
    let (g, bld, soil) = unsafe { (sl::<f32>(rd(ix::GARBAGE), c), sl::<i32>(rd(ix::BUILDING), c), sl::<f32>(rd(ix::SOIL), c)) };
    let (net, traffic, cong, nf) =
        unsafe { (sl::<u8>(rd(ix::NET), c), sl::<f32>(rd(ix::TRAFFIC), c), sl::<f32>(rd(ix::CONG), c), sl::<u8>(rd(ix::FLAGS), c)) };
    let (a0, w0, n0) = unsafe { (sl_mut::<f32>(rd(ix::A0), c), sl_mut::<f32>(rd(ix::W0), c), sl_mut::<f32>(rd(ix::N0), c)) };
    let smell = rf(fx::SMELL);
    let water_k = rf(fx::WATER_K);
    let soil_gw = rf(fx::SOIL_GW);
    let traffic_air = rf(fx::TRAFFIC_AIR);
    let tunnel_air = rf(fx::TUNNEL_AIR);
    let cong_damp = rf(fx::CONG_DAMP);
    let crossing = rf(fx::CROSSING);
    let npt = rf(fx::NOISE_PER_TRIP);
    let tunnel_noise = rf(fx::TUNNEL_NOISE);
    let bridge_noise = rf(fx::BRIDGE_NOISE);
    let tn = rf(fx::TN);
    let mut per_trip = [0.0f64; 8];
    let mut base = [0.0f64; 8];
    for k in 0..8 {
        per_trip[k] = rf(fx::PER_TRIP + k);
        base[k] = rf(fx::BASE + k);
    }
    let hw = rd(ix::HIGHWAY) as u8;
    let rail = rd(ix::RAIL) as u8;
    let (mut any_a, mut any_n, mut any_w) = (false, false, false);
    for i in 0..c {
        let gv = g[i] as f64;
        if gv > 0.02 && bld[i] >= 0 {
            a0[i] = (a0[i] as f64 + smell * gv) as f32;
            any_a = true;
        }
        let so = soil[i] as f64;
        if so > 0.005 {
            w0[i] = (w0[i] as f64 + its(soil_gw * so, water_k)) as f32;
            any_w = true;
        }
        let n = net[i];
        if n == 0 {
            continue;
        }
        let t = traffic[i] as f64;
        let f = nf[i];
        let mut nz = 0.0f64;
        if n <= hw {
            // road codes 1..=highway (n < 8: the tables have 8 slots)
            let nn = (n & 7) as usize;
            if t > 0.0 {
                let cv = cong[i] as f64;
                let cc = if cv < 2.0 { cv } else { 2.0 };
                a0[i] = (a0[i] as f64 + t * traffic_air * (1.0 + cc) * (if f & 2 != 0 { tunnel_air } else { 1.0 })) as f32;
                any_a = true;
                let damp = if cv > 1.0 { 1.0 - cong_damp * (if cv < 2.0 { cv - 1.0 } else { 1.0 }) } else { 1.0 };
                nz = t * per_trip[nn] * damp;
            }
            nz += base[nn];
            if f & 0x20 != 0 {
                nz += crossing;
            }
        } else if n == rail {
            nz = t * npt * 0.2 + base[(rail & 7) as usize];
        }
        if nz > 0.0 {
            if f & 2 != 0 {
                nz *= tunnel_noise;
            } else if f & 1 != 0 {
                nz *= bridge_noise;
            }
            n0[i] = (n0[i] as f64 + nz * tn) as f32;
            any_n = true;
        }
    }
    // freight trains (in list order; an index outside the map is skipped, as the JS store is a no-op)
    let nfr = rd(ix::NFREIGHT).max(0) as usize;
    if nfr > 0 {
        let fr = unsafe { sl::<i32>(rd(ix::FREIGHT), nfr) };
        let s = rf(fx::FREIGHT_S);
        for &i in fr {
            if i >= 0 && (i as usize) < c {
                n0[i as usize] = (n0[i as usize] as f64 + s) as f32;
            }
        }
    }
    // landfill regions
    let nreg = rd(ix::NREG).max(0) as usize;
    if nreg > 0 {
        let order = unsafe { sl::<i32>(rd(ix::LF_ORDER), rd(ix::LF_ORDER_LEN).max(0) as usize) };
        let reg = unsafe { sl::<i32>(rd(ix::REG), 2 * nreg) };
        let rf_ = unsafe { sl::<f64>(rd(ix::REG_F), 4 * nreg) };
        let soil_src = unsafe { sl_mut::<f32>(rd(ix::SOIL_SRC), c) };
        for r in 0..nreg {
            let (s0, cnt) = (reg[2 * r], reg[2 * r + 1]);
            let (aa, wa, na, sa) = (rf_[4 * r], rf_[4 * r + 1], rf_[4 * r + 2], rf_[4 * r + 3]);
            for q in 0..cnt.max(0) {
                // lfOrder[s + q]: an index past the list reads undefined in JS (store skipped): skip it too
                let j = s0 as i64 + q as i64;
                if j < 0 || j as usize >= order.len() {
                    continue;
                }
                let i = order[j as usize];
                if i < 0 || i as usize >= c {
                    continue;
                }
                let i = i as usize;
                a0[i] = (a0[i] as f64 + aa) as f32;
                w0[i] = (w0[i] as f64 + wa) as f32;
                n0[i] = (n0[i] as f64 + na) as f32;
                soil_src[i] = (soil_src[i] as f64 + sa) as f32;
            }
        }
    }
    (if any_a { USED_A } else { 0 }) | (if any_n { USED_N } else { 0 }) | (if any_w { USED_W } else { 0 })
}

// ------------------------------------------------------------------------------------------------ pollution: saturate
/// sat(f · scale): 0 for f <= 0 (and NaN), 1 beyond the table, else the linear interpolation of the table at u
#[inline(always)]
fn sat_of(f: f64, sat: &[f32], scale: f64) -> f64 {
    let u = f * scale;
    if u >= SAT_N as f64 {
        1.0
    } else {
        // 0 <= u < SAT_N here (f > 0, scale > 0 finite: checked by the binding): ToInt32 = truncation
        let k = u as i32 as usize;
        let a = sat[k] as f64;
        a + (sat[k + 1] as f64 - a) * (u - k as f64)
    }
}

/// the saturate loop, monomorphised per argument combination
#[inline(always)]
#[cfg_attr(target_feature = "simd128", allow(dead_code))]
fn saturate_core<const MASK: bool, const B1: bool, const B2: bool>(
    field: &[f32],
    l: &mut [f32],
    mask: &[u8],
    buf1: &[f32],
    buf2: &[f32],
    sat: &[f32],
    scale: f64,
    alpha: f64,
    k1: f64,
    k2: f64,
) {
    saturate_range::<MASK, B1, B2>(field, l, mask, buf1, buf2, sat, scale, alpha, k1, k2, 0);
}

/// saturate_core over cells [start, len)
#[inline(always)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn saturate_range<const MASK: bool, const B1: bool, const B2: bool>(
    field: &[f32],
    l: &mut [f32],
    mask: &[u8],
    buf1: &[f32],
    buf2: &[f32],
    sat: &[f32],
    scale: f64,
    alpha: f64,
    k1: f64,
    k2: f64,
    start: usize,
) {
    let sat = &sat[..SAT_N + 1];
    for i in start..l.len() {
        if MASK && mask[i] != 0 {
            continue;
        }
        let f = field[i] as f64;
        let mut t = 0.0f64;
        if f > 0.0 {
            t = sat_of(f, sat, scale);
            if B1 {
                let mut m = 1.0 - k1 * buf1[i] as f64;
                if B2 {
                    m -= k2 * buf2[i] as f64;
                }
                t *= if m > 0.0 { m } else { 0.0 };
            }
        }
        let lv = l[i] as f64;
        l[i] = (lv + (t - lv) * alpha) as f32;
    }
}

#[allow(clippy::too_many_arguments)]
fn saturate_any(
    field: &[f32],
    l: &mut [f32],
    mask: Option<&[u8]>,
    buf1: Option<&[f32]>,
    buf2: Option<&[f32]>,
    sat: &[f32],
    scale: f64,
    alpha: f64,
    k1: f64,
    k2: f64,
) {
    let e8: &[u8] = &[];
    let e32: &[f32] = &[];
    #[cfg(target_feature = "simd128")]
    {
        use simd::saturate as sv;
        match (mask, buf1, buf2) {
            (None, None, _) => sv::<false, false, false>(field, l, e8, e32, e32, sat, scale, alpha, k1, k2),
            (None, Some(b1), None) => sv::<false, true, false>(field, l, e8, b1, e32, sat, scale, alpha, k1, k2),
            (None, Some(b1), Some(b2)) => sv::<false, true, true>(field, l, e8, b1, b2, sat, scale, alpha, k1, k2),
            (Some(m), None, _) => sv::<true, false, false>(field, l, m, e32, e32, sat, scale, alpha, k1, k2),
            (Some(m), Some(b1), None) => sv::<true, true, false>(field, l, m, b1, e32, sat, scale, alpha, k1, k2),
            (Some(m), Some(b1), Some(b2)) => sv::<true, true, true>(field, l, m, b1, b2, sat, scale, alpha, k1, k2),
        }
    }
    #[cfg(not(target_feature = "simd128"))]
    match (mask, buf1, buf2) {
        (None, None, _) => saturate_core::<false, false, false>(field, l, e8, e32, e32, sat, scale, alpha, k1, k2),
        (None, Some(b1), None) => saturate_core::<false, true, false>(field, l, e8, b1, e32, sat, scale, alpha, k1, k2),
        (None, Some(b1), Some(b2)) => saturate_core::<false, true, true>(field, l, e8, b1, b2, sat, scale, alpha, k1, k2),
        (Some(m), None, _) => saturate_core::<true, false, false>(field, l, m, e32, e32, sat, scale, alpha, k1, k2),
        (Some(m), Some(b1), None) => saturate_core::<true, true, false>(field, l, m, b1, e32, sat, scale, alpha, k1, k2),
        (Some(m), Some(b1), Some(b2)) => saturate_core::<true, true, true>(field, l, m, b1, b2, sat, scale, alpha, k1, k2),
    }
}

/// pollution.ts saturate: L[i] += (sat(field[i]) · buffer(i) − L[i]) · alpha, skipping mask[i] != 0 (buf2 is only read
/// when buf1 is given, as in the JS)
/// # Safety
/// pointers valid for C elements (SAT: SAT_N + 1); L must not overlap the inputs
#[unsafe(no_mangle)]
pub unsafe extern "C" fn fields_saturate(ip: *const i32, fp: *const f64) -> i32 {
    use sat_fx as fx;
    use sat_ix as ix;
    let rd = |k: usize| unsafe { *ip.add(k) };
    let rf = |k: usize| unsafe { *fp.add(k) };
    let c = rd(ix::C).max(0) as usize;
    let field = unsafe { sl::<f32>(rd(ix::FIELD), c) };
    let l = unsafe { sl_mut::<f32>(rd(ix::L), c) };
    let sat = unsafe { sl::<f32>(rd(ix::SAT), SAT_N + 1) };
    let mask = if rd(ix::MASK) != 0 { Some(unsafe { sl::<u8>(rd(ix::MASK), c) }) } else { None };
    let buf1 = if rd(ix::BUF1) != 0 { Some(unsafe { sl::<f32>(rd(ix::BUF1), c) }) } else { None };
    let buf2 = if rd(ix::BUF2) != 0 { Some(unsafe { sl::<f32>(rd(ix::BUF2), c) }) } else { None };
    saturate_any(field, l, mask, buf1, buf2, sat, rf(fx::SCALE), rf(fx::ALPHA), rf(fx::K1), rf(fx::K2));
    0
}

// ------------------------------------------------------------------------------------------------ pollution: water
/// stageB after the blur: negative sources clean water cells, the ground-water saturate (water cells masked), the
/// diffusion over the water list (ITERS iterations, `cur` = TMP2, `nxt` = TMP as in the JS), land = ground, bank
/// coupling by max in list order. Returns 1 (and writes nothing) when a list holds an index out of range.
/// # Safety
/// pointers valid for their documented lengths; TMP / TMP2 / L / GROUND must not overlap each other or the inputs
#[unsafe(no_mangle)]
pub unsafe extern "C" fn fields_water(ip: *const i32, fp: *const f64) -> i32 {
    use water_fx as fx;
    use water_ix as ix;
    let rd = |k: usize| unsafe { *ip.add(k) };
    let rf = |k: usize| unsafe { *fp.add(k) };
    let c = rd(ix::C).max(0) as usize;
    let nw = rd(ix::NW).max(0) as usize;
    let nbank = rd(ix::NBANK).max(0) as usize;
    if nw > c {
        return 1;
    }
    let wc = unsafe { sl::<i32>(rd(ix::CELLS), nw) };
    let wnb = unsafe { sl::<i32>(rd(ix::NB), 4 * nw) };
    let bank = unsafe { sl::<i32>(rd(ix::BANK), nbank) };
    let bsrc = unsafe { sl::<i32>(rd(ix::BANK_SRC), nbank) };
    // validate before writing anything (branch-free accumulation of an "out of range" flag)
    let mut bad = false;
    for &i in wc {
        bad |= (i as u32 as usize) >= c;
    }
    for &t in wnb {
        let land = -(t as i64) - 1;
        bad |= t != NO_NB && if t >= 0 { t as usize >= nw } else { land as usize >= c };
    }
    for k in 0..nbank {
        bad |= (bank[k] as u32 as usize) >= c || (bsrc[k] as u32 as usize) >= c;
    }
    if bad {
        return 1;
    }
    let wm = unsafe { sl::<u8>(rd(ix::WATER), c) };
    let sat = unsafe { sl::<f32>(rd(ix::SAT), SAT_N + 1) };
    let (scale, alpha) = (rf(fx::SCALE), rf(fx::ALPHA));
    let l = unsafe { sl_mut::<f32>(rd(ix::L), c) };
    let ground = unsafe { sl_mut::<f32>(rd(ix::GROUND), c) };
    {
        let tmp = unsafe { sl::<f32>(rd(ix::TMP), c) };
        // negative sources (treatment plants) also clean nearby water bodies: L = max(0, L + tmp · 0.05)
        let clean = rf(fx::CLEAN);
        for i in 0..c {
            if wm[i] != 0 {
                let t = tmp[i] as f64;
                if t < 0.0 {
                    l[i] = js_max0(l[i] as f64 + t * clean) as f32;
                }
            }
        }
        // ground water of land cells
        saturate_any(tmp, ground, Some(wm), None, None, sat, scale, alpha, 0.0, 0.0);
    }
    // diffusion over the water cells. Restructured (identically in the fair JS, src/wasm/js/fieldPasses.ts):
    //  * loop invariants hoisted: ground is final before the diffusion, so each water cell's land inflow term (max over
    //    its land slots in slot order, × the gain) and its water neighbours (slot order) are computed once per call;
    //  * each neighbour list is padded to 4 slots with the index nW of an extra cell holding −0.0, the exact additive
    //    identity of IEEE 754 (x + (−0) = x for every x, ±0 included): a cell adds cur[q] and its 4 slots in slot order —
    //    the same values in the same order as the JS `s += cur[t]` over its water slots — branch-free;
    //  * private ping-pong buffers (cur / nxt of nW + 1) replace the per-iteration copy; afterwards TMP2 (`cur`) and,
    //    when an iteration ran, TMP (`nxt`) hold the final values as in the JS.
    let (keep, inflow_gain) = (rf(fx::KEEP), rf(fx::INFLOW));
    let iters = rd(ix::ITERS).max(0);
    let infl = unsafe { sl_mut::<f64>(rd(ix::INFL), nw) };
    let ndiv = unsafe { sl_mut::<f64>(rd(ix::NDIV), nw) };
    let wlist = unsafe { sl_mut::<i32>(rd(ix::WLIST), 4 * nw) };
    let mut a = unsafe { sl_mut::<f32>(rd(ix::CUR), nw + 1) };
    let mut b = unsafe { sl_mut::<f32>(rd(ix::NXT), nw + 1) };
    for q in 0..nw {
        a[q] = l[wc[q] as usize];
    }
    a[nw] = -0.0;
    b[nw] = -0.0;
    let pad = nw as i32;
    for q in 0..nw {
        let mut inflow = 0.0f64;
        let mut cnt = 0usize;
        let slots = &mut wlist[4 * q..4 * q + 4];
        for k in 0..4 {
            let t = wnb[4 * q + k];
            let water = t >= 0 && t != NO_NB;
            let land = t < 0;
            slots[cnt] = t;
            cnt += water as usize;
            let il = if land { (-(t as i64) - 1) as usize } else { 0 };
            // SAFETY: il < c (validated land index, or 0 with c >= nw >= 1)
            let lv = unsafe { *ground.get_unchecked(il) } as f64;
            inflow = if land && lv > inflow { lv } else { inflow };
        }
        for j in cnt..4 {
            slots[j] = pad;
        }
        infl[q] = inflow * inflow_gain;
        ndiv[q] = cnt as f64 + 1.0;
    }
    for _ in 0..iters {
        for q in 0..nw {
            let sl4 = &wlist[4 * q..4 * q + 4];
            // SAFETY: every slot is < nW (validated water index) or nW (the −0.0 pad); a / b have nW + 1 cells
            let s = unsafe {
                a[q] as f64
                    + *a.get_unchecked(sl4[0] as usize) as f64
                    + *a.get_unchecked(sl4[1] as usize) as f64
                    + *a.get_unchecked(sl4[2] as usize) as f64
                    + *a.get_unchecked(sl4[3] as usize) as f64
            };
            let v = (s / ndiv[q]) * keep + infl[q];
            b[q] = if v > 1.0 { 1.0 } else { v as f32 };
        }
        core::mem::swap(&mut a, &mut b);
    }
    {
        let tmp2 = unsafe { sl_mut::<f32>(rd(ix::TMP2), nw) };
        tmp2.copy_from_slice(&a[..nw]);
        if iters > 0 {
            let tmp = unsafe { sl_mut::<f32>(rd(ix::TMP), nw) };
            tmp.copy_from_slice(&a[..nw]);
        }
    }
    for q in 0..nw {
        l[wc[q] as usize] = a[q];
    }
    // land = ground water, raised on the banks of polluted water bodies
    for i in 0..c {
        if wm[i] == 0 {
            l[i] = ground[i];
        }
    }
    let coupling = rf(fx::BANK);
    for k in 0..nbank {
        let v = coupling * l[bsrc[k] as usize] as f64;
        let i = bank[k] as usize;
        if v > l[i] as f64 {
            l[i] = v as f32;
        }
    }
    0
}

// ------------------------------------------------------------------------------------------------ pollution: soil
/// stageFlags' soil stock: s += grow · min(1, q) · (1 − s) under sources (q > 0), s ·= keep, s < 1e-4 → 0; cells with
/// s == 0 and q == 0 are left untouched
/// # Safety
/// soil / src valid for c elements, not overlapping
#[unsafe(no_mangle)]
pub unsafe extern "C" fn fields_soil(soil: *mut f32, src: *const f32, c: i32, grow: f64, keep: f64) -> i32 {
    let c = c.max(0) as usize;
    if c == 0 {
        return 0;
    }
    let (soil, src) = unsafe { (core::slice::from_raw_parts_mut(soil, c), core::slice::from_raw_parts(src, c)) };
    let mut i = 0usize;
    // SIMD build: most cells have neither soil nor a source (~92 % on the 1M fixtures): skip 4 of them per test (the
    // scalar test `s == 0 && q == 0` per lane, exact in f32: ±0 skip, NaN does not). Without this the SIMD build lets
    // LLVM auto-vectorize the loop into f64x2 lanes with per-lane stores, which Chrome 141's V8 runs at 0.67x of the
    // scalar build.
    #[cfg(target_feature = "simd128")]
    while i + 4 <= c {
        if simd::any_nonzero4(soil, src, i) {
            for j in i..i + 4 {
                soil_cell(soil, src, j, grow, keep);
            }
        }
        i += 4;
    }
    while i < c {
        soil_cell(soil, src, i, grow, keep);
        i += 1;
    }
    0
}

#[inline(always)]
fn soil_cell(soil: &mut [f32], src: &[f32], i: usize, grow: f64, keep: f64) {
    let mut s = soil[i] as f64;
    let q = src[i] as f64;
    if s == 0.0 && q == 0.0 {
        return;
    }
    if q > 0.0 {
        s += grow * (if q < 1.0 { q } else { 1.0 }) * (1.0 - s);
    }
    s *= keep;
    soil[i] = if s < 1e-4 { 0.0 } else { s as f32 };
}

// ------------------------------------------------------------------------------------------------ math self-test
/// out[i] = exp(x[i]) (which = 0) or log(x[i]) (which = 1): the binding's bit test against the engine's Math.exp / log
/// # Safety
/// x / out: n f64
#[unsafe(no_mangle)]
pub unsafe extern "C" fn fields_math_batch(x: *const f64, out: *mut f64, n: i32, which: i32) {
    let n = n.max(0) as usize;
    if n == 0 {
        return;
    }
    let (x, out) = unsafe { (core::slice::from_raw_parts(x, n), core::slice::from_raw_parts_mut(out, n)) };
    if which == 0 {
        for i in 0..n {
            out[i] = exp(x[i]);
        }
    } else {
        for i in 0..n {
            out[i] = log(x[i]);
        }
    }
}

// ------------------------------------------------------------------------------------------------ SIMD (simd128 build)
/// Explicit simd128 paths of the SIMD build (the scalar build runs the plain loops above). Every lane follows exactly
/// the scalar operation sequence (f64x2 lanes are IEEE binary64 per lane, promote / demote are exact / round-to-nearest
/// like the f32 stores of JS); branches become selects between values computed the same way.
#[cfg(target_feature = "simd128")]
mod simd {
    use super::SAT_N;
    use crate::fdlibm::exp;
    use core::arch::wasm32::*;
    use core::ptr::{read_unaligned, write_unaligned};

    #[inline(always)]
    unsafe fn ld(p: *const u8) -> v128 {
        unsafe { read_unaligned(p as *const v128) }
    }
    /// two f32 at p, promoted to f64x2
    #[inline(always)]
    unsafe fn ld2(p: *const f32) -> v128 {
        unsafe { f64x2_promote_low_f32x4(v128_load64_zero(p as *const u64)) }
    }
    /// store the two low f32 lanes of v at p
    #[inline(always)]
    unsafe fn st2(p: *mut f32, v: v128) {
        unsafe { v128_store64_lane::<0>(v, p as *mut u64) }
    }

    /// any of a[i..i + 4], b[i..i + 4] != ±0 (NaN counts as non-zero)
    #[inline(always)]
    pub fn any_nonzero4(a: &[f32], b: &[f32], i: usize) -> bool {
        let (x, y) = (&a[i..i + 4], &b[i..i + 4]);
        let z = f32x4_splat(0.0);
        unsafe { v128_any_true(v128_or(f32x4_ne(ld(x.as_ptr() as *const u8), z), f32x4_ne(ld(y.as_ptr() as *const u8), z))) }
    }

    /// any byte == code in zone[a..a + 16] or zone[b..b + 16]
    #[inline(always)]
    pub fn any_eq16(zone: &[u8], a: usize, b: usize, code: u8) -> bool {
        let (za, zb) = (&zone[a..a + 16], &zone[b..b + 16]);
        let c = u8x16_splat(code);
        unsafe { v128_any_true(v128_or(i8x16_eq(ld(za.as_ptr()), c), i8x16_eq(ld(zb.as_ptr()), c))) }
    }

    /// corridor classes of cells [i, i + 16): (changed, highway cells, rail cells); hw != rail (checked by the binding)
    #[inline(always)]
    pub fn corridor16(net: &[u8], flags: &[u8], cls: &mut [u8], i: usize, hw: u8, rail: u8) -> (bool, u32, u32) {
        let (n, f, o) = (&net[i..i + 16], &flags[i..i + 16], &mut cls[i..i + 16]);
        unsafe {
            let nv = ld(n.as_ptr());
            let fv = ld(f.as_ptr());
            let old = ld(o.as_ptr());
            let zero = u8x16_splat(0);
            let is_h = i8x16_eq(nv, u8x16_splat(hw));
            let is_r = i8x16_eq(nv, u8x16_splat(rail));
            let tunnel = i8x16_ne(v128_and(fv, u8x16_splat(2)), zero);
            let bridge = i8x16_ne(v128_and(fv, u8x16_splat(1)), zero);
            let h_ok = v128_andnot(is_h, tunnel);
            let hcls = v128_bitselect(u8x16_splat(2), u8x16_splat(1), bridge);
            let cl = v128_or(v128_and(h_ok, hcls), v128_and(is_r, u8x16_splat(3)));
            write_unaligned(o.as_mut_ptr() as *mut v128, cl);
            (v128_any_true(v128_xor(cl, old)), (i8x16_bitmask(h_ok) as u32).count_ones(), (i8x16_bitmask(is_r) as u32).count_ones())
        }
    }

    // fdlibm exp constants (fdlibm.rs)
    const INVLN2: f64 = 1.44269504088896338700e+00;
    const LN2HI0: f64 = 6.93147180369123816490e-01;
    const LN2LO0: f64 = 1.90821492927058770002e-10;
    const P1: f64 = 1.66666666666666019037e-01;
    const P2: f64 = -2.77777777770155933842e-03;
    const P3: f64 = 6.61375632143793436117e-05;
    const P4: f64 = -1.65339022054652515390e-06;
    const P5: f64 = 4.13813679705723846039e-08;
    const E: f64 = 2.718281828459045;

    /// fdlibm exp (V8's ieee754::exp) of both lanes, for |x| < 704 (high word < 0x40860000: no overflow / underflow and
    /// k >= -1021); None when a lane is outside (the caller then uses the scalar exp). Per lane this is exactly the
    /// scalar sequence: the reduction case (|x| <= 0.5 ln2: k = 0; < 1.5 ln2: k = ±1; else k = trunc(x / ln2 ± 0.5),
    /// decided on the HIGH WORD as fdlibm does), hi / lo / c, the k = 0 or 2^k formula, x == 1 → E, |x| < 2^-28 → 1 + x.
    #[inline(always)]
    pub fn exp2(x: v128) -> Option<v128> {
        let hx = v128_and(u64x2_shr(x, 32), i64x2_splat(0x7fff_ffff));
        if !i64x2_all_true(i64x2_lt(hx, i64x2_splat(0x4086_0000))) {
            return None;
        }
        let one = f64x2_splat(1.0);
        let two = f64x2_splat(2.0);
        let reduce = i64x2_gt(hx, i64x2_splat(0x3fd6_2e42));
        // the lanes' case decides which formulas are needed: both lanes reduced (the common case of 1 − exp(−a) with
        // a > 0.35), neither (k = 0), or mixed (both computed, selected per lane)
        let all_reduce = i64x2_all_true(reduce);
        let any_reduce = all_reduce || v128_any_true(reduce);
        let mut r = f64x2_splat(0.0);
        if any_reduce {
            let neg = i64x2_lt(x, i64x2_splat(0));
            let one_ln2 = i64x2_lt(hx, i64x2_splat(0x3ff0_a2b2));
            // k as a double: ±1 for 0.5 ln2 < |x| < 1.5 ln2 (x - LN2HI[xsb] = x - k·LN2HI[0], LN2LO[xsb] = k·LN2LO[0]),
            // else trunc(INVLN2·x + HALF[xsb]) (fdlibm: (int) then (double): exact, |k| < 1100)
            let t_one = v128_bitselect(f64x2_splat(-1.0), one, neg);
            let t = if !v128_any_true(one_ln2) {
                let half = v128_bitselect(f64x2_splat(-0.5), f64x2_splat(0.5), neg);
                f64x2_trunc(f64x2_add(f64x2_mul(f64x2_splat(INVLN2), x), half))
            } else if i64x2_all_true(one_ln2) {
                t_one
            } else {
                let half = v128_bitselect(f64x2_splat(-0.5), f64x2_splat(0.5), neg);
                let t_far = f64x2_trunc(f64x2_add(f64x2_mul(f64x2_splat(INVLN2), x), half));
                v128_bitselect(t_one, t_far, one_ln2)
            };
            let hi = f64x2_sub(x, f64x2_mul(t, f64x2_splat(LN2HI0)));
            let lo = f64x2_mul(t, f64x2_splat(LN2LO0));
            let xr = f64x2_sub(hi, lo);
            let c = poly_c(xr);
            let xc = f64x2_mul(xr, c);
            // y = 1 - ((lo - (x·c) / (2 - c)) - hi); y · 2^k
            let y = f64x2_sub(one, f64x2_sub(f64x2_sub(lo, f64x2_div(xc, f64x2_sub(two, c))), hi));
            let k = i64x2_extend_low_i32x4(i32x4_trunc_sat_f64x2_zero(t));
            let twopk = i64x2_shl(i64x2_add(k, i64x2_splat(0x3ff)), 52);
            r = f64x2_mul(y, twopk);
        }
        if !all_reduce {
            // k = 0: 1 - ((x·c) / (c - 2) - x); |x| < 2^-28: 1 + x
            let c = poly_c(x);
            let xc = f64x2_mul(x, c);
            let mut r0 = f64x2_sub(one, f64x2_sub(f64x2_div(xc, f64x2_sub(c, two)), x));
            let tiny = i64x2_lt(hx, i64x2_splat(0x3e30_0000));
            if v128_any_true(tiny) {
                r0 = v128_bitselect(f64x2_add(one, x), r0, tiny);
            }
            r = if any_reduce { v128_bitselect(r, r0, reduce) } else { r0 };
        }
        let is_one = f64x2_eq(x, one);
        if v128_any_true(is_one) {
            r = v128_bitselect(f64x2_splat(E), r, is_one);
        }
        Some(r)
    }

    /// c = x - t·(P1 + t·(P2 + t·(P3 + t·(P4 + t·P5)))), t = x·x
    #[inline(always)]
    fn poly_c(x: v128) -> v128 {
        let tt = f64x2_mul(x, x);
        let poly = f64x2_add(
            f64x2_splat(P1),
            f64x2_mul(tt, f64x2_add(f64x2_splat(P2), f64x2_mul(tt, f64x2_add(f64x2_splat(P3), f64x2_mul(tt, f64x2_add(f64x2_splat(P4), f64x2_mul(tt, f64x2_splat(P5)))))))),
        );
        f64x2_sub(x, f64x2_mul(tt, poly))
    }

    /// two cells of the 1 − exp(−v) pass: f32 lanes (low two) of v > 0 ? f32(1 − exp(−v)) : 0
    #[inline(always)]
    fn sat_exp(v: v128) -> v128 {
        let pos = f64x2_gt(v, f64x2_splat(0.0));
        if !v128_any_true(pos) {
            return u8x16_splat(0);
        }
        // lanes that are not > 0 compute exp(0) (their result is replaced by +0)
        let x = v128_bitselect(f64x2_neg(v), f64x2_splat(0.0), pos);
        let e = match exp2(x) {
            Some(e) => e,
            None => f64x2(exp(f64x2_extract_lane::<0>(x)), exp(f64x2_extract_lane::<1>(x))),
        };
        let r = f32x4_demote_f64x2_zero(f64x2_sub(f64x2_splat(1.0), e));
        // 64-bit lane mask -> the two low 32-bit lanes; +0.0f32 is all-zero bits
        v128_and(r, i32x4_shuffle::<0, 2, 0, 2>(pos, pos))
    }

    /// cells i, i + 1 of the final pass
    #[inline(always)]
    #[allow(clippy::too_many_arguments)]
    pub fn final2(stig: &[f32], line: &[f32], pres: &[f32], camp: &[f32], s: &mut [f32], p: &mut [f32], k: &mut [f32], i: usize) {
        let (a, l, pr, cm) = (&stig[i..i + 2], &line[i..i + 2], &pres[i..i + 2], &camp[i..i + 2]);
        let (so, po, ko) = (&mut s[i..i + 2], &mut p[i..i + 2], &mut k[i..i + 2]);
        unsafe {
            st2(so.as_mut_ptr(), sat_exp(f64x2_add(ld2(a.as_ptr()), ld2(l.as_ptr()))));
            st2(po.as_mut_ptr(), sat_exp(ld2(pr.as_ptr())));
            st2(ko.as_mut_ptr(), sat_exp(ld2(cm.as_ptr())));
        }
    }

    /// pollution.ts saturate over pairs of cells (tail: the scalar loop); see saturate_core for the per-cell sequence
    #[inline(always)]
    #[allow(clippy::too_many_arguments)]
    pub fn saturate<const MASK: bool, const B1: bool, const B2: bool>(
        field: &[f32],
        l: &mut [f32],
        mask: &[u8],
        buf1: &[f32],
        buf2: &[f32],
        sat: &[f32],
        scale: f64,
        alpha: f64,
        k1: f64,
        k2: f64,
    ) {
        let n = l.len();
        let field = &field[..n];
        let sat = &sat[..SAT_N + 1];
        let (vscale, valpha, vk1, vk2) = (f64x2_splat(scale), f64x2_splat(alpha), f64x2_splat(k1), f64x2_splat(k2));
        let (zero, one, big) = (f64x2_splat(0.0), f64x2_splat(1.0), f64x2_splat(SAT_N as f64));
        let (imin, imax) = (i32x4_splat(0), i32x4_splat(SAT_N as i32 - 1));
        let mut i = 0usize;
        while i + 2 <= n {
            if MASK && mask[i] != 0 && mask[i + 1] != 0 {
                i += 2;
                continue;
            }
            unsafe {
                let f = ld2(field.as_ptr().add(i));
                let lv = ld2(l.as_ptr().add(i));
                let pos = f64x2_gt(f, zero);
                let u = f64x2_mul(f, vscale);
                let is_big = f64x2_ge(u, big);
                // k = u | 0 for 0 < u < SAT_N (clamped for the lanes whose value is not used)
                let ki = i32x4_min(i32x4_max(i32x4_trunc_sat_f64x2_zero(u), imin), imax);
                let (k0, k1i) = (i32x4_extract_lane::<0>(ki) as usize, i32x4_extract_lane::<1>(ki) as usize);
                let a = f64x2(*sat.get_unchecked(k0) as f64, *sat.get_unchecked(k1i) as f64);
                let b = f64x2(*sat.get_unchecked(k0 + 1) as f64, *sat.get_unchecked(k1i + 1) as f64);
                let interp = f64x2_add(a, f64x2_mul(f64x2_sub(b, a), f64x2_sub(u, f64x2_convert_low_i32x4(ki))));
                let mut t = v128_bitselect(one, interp, is_big);
                if B1 {
                    let mut m = f64x2_sub(one, f64x2_mul(vk1, ld2(buf1.as_ptr().add(i))));
                    if B2 {
                        m = f64x2_sub(m, f64x2_mul(vk2, ld2(buf2.as_ptr().add(i))));
                    }
                    t = f64x2_mul(t, v128_bitselect(m, zero, f64x2_gt(m, zero)));
                }
                let t = v128_bitselect(t, zero, pos);
                let r = f32x4_demote_f64x2_zero(f64x2_add(lv, f64x2_mul(f64x2_sub(t, lv), valpha)));
                if MASK && (mask[i] != 0 || mask[i + 1] != 0) {
                    if mask[i] == 0 {
                        *l.get_unchecked_mut(i) = f32x4_extract_lane::<0>(r);
                    }
                    if mask[i + 1] == 0 {
                        *l.get_unchecked_mut(i + 1) = f32x4_extract_lane::<1>(r);
                    }
                } else {
                    st2(l.as_mut_ptr().add(i), r);
                }
            }
            i += 2;
        }
        super::saturate_range::<MASK, B1, B2>(field, l, mask, buf1, buf2, sat, scale, alpha, k1, k2, i);
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_semantics_helpers() {
        assert!(js_max0(f64::NAN).is_nan());
        assert_eq!(js_max0(-0.0).to_bits(), 0.0f64.to_bits());
        assert_eq!(js_max0(-3.0).to_bits(), 0.0f64.to_bits());
        assert_eq!(js_max0(2.5), 2.5);
        assert_eq!(its(0.0, 3.0), 0.0);
        assert_eq!(its(-0.0, 3.0).to_bits(), 0.0f64.to_bits());
        assert!(its(f64::NAN, 1.0).is_nan());
        // clamped at 0.95 for |I| >= 0.95, sign restored
        assert_eq!(its(5.0, 2.0), its(0.95, 2.0));
        assert_eq!(its(-5.0, 2.0), -its(0.95, 2.0));
    }

    #[test]
    fn sat_index_range() {
        let sat: [f32; SAT_N + 1] = core::array::from_fn(|i| i as f32);
        // just below the table end interpolates between the last two entries
        let u = 4095.75f64;
        assert_eq!(sat_of(u, &sat, 1.0), 4095.75);
        assert_eq!(sat_of(4096.0, &sat, 1.0), 1.0);
        assert_eq!(sat_of(f64::INFINITY, &sat, 1.0), 1.0);
        assert_eq!(sat_of(1e-300, &sat, 1.0), 1e-300);
    }
}
