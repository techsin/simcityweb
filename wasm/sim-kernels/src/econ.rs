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
    /// None when a table entry is out of range (term >= nt, lengths > nt)
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

    /// desirability of dev d from the term vector (JS: `let s = BIAS[d] + shift[d] + WT[o] * (T[T_LV] - LVREF[d]);
    /// for (q) s += WT[o + nz[q]] * T[nz[q]]; des[d][i] = clamp(s, -1, 1)`), before the f32 store
    #[inline(always)]
    fn value(&self, d: usize, t: &[f64; NT]) -> f64 {
        let mut s = self.bs[d] + self.wlv[d] * (t[T_LV] - self.lvref[d]);
        let len = self.len[d] as usize;
        let w = &self.w[d];
        let tt = &self.t[d];
        for q in 0..len {
            s += w[q] * t[tt[q] as usize];
        }
        clamp(s, -1.0, 1.0)
    }
}

/// desirabilitySystem → band(st, z0, z1, allCells). Returns 0, 1 when a cell's zone code is not a zone (JS: TypeError
/// on `ZONE_DEVTYPES[zone].length`; ip[ERR_CELL] = that cell, every earlier cell is done — the binding reruns the
/// band in JS, which rewrites the same values and throws the same error) or 2 when the parameters are out of domain
/// (nothing written).
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
        let traffic_on = flags & F_TRAFFIC != 0;
        let pollution_on = flags & F_POLLUTION != 0;
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

        let zone: &[u8] = sl(ip[ix::ZONE], nn);
        let net: &[u8] = sl(ip[ix::NET], nn);
        let water: &[u8] = sl(ip[ix::WATER], nn);
        let lv: &[f32] = sl(ip[ix::LV], nn);
        let air: &[f32] = sl(ip[ix::AIR], nn);
        let wpol: &[f32] = sl(ip[ix::WPOL], nn);
        let garb: &[f32] = sl(ip[ix::GARB], nn);
        let crime: &[f32] = sl(ip[ix::CRIME], nn);
        let noise: &[f32] = sl(ip[ix::NOISE], nn);
        let traffic: &[f32] = sl(ip[ix::TRAFFIC], nn);
        let commute: &[f32] = sl(ip[ix::COMMUTE], nn);
        // coverage layers are read only with the services system, lvEffects / lvLandfill only without it
        let cn = if services_on { nn } else { 0 };
        let police: &[f32] = sl(ip[ix::POLICE], cn);
        let fire: &[f32] = sl(ip[ix::FIRE], cn);
        let health: &[f32] = sl(ip[ix::HEALTH], cn);
        let edu: &[f32] = sl(ip[ix::EDU], cn);
        let park: &[f32] = sl(ip[ix::PARK], cn);
        let transit: &[f32] = sl(ip[ix::TRANSIT], cn);
        let en = if services_on { 0 } else { nn };
        let lveff: &[f32] = sl(ip[ix::LVEFF], en);
        let lvfill: &[f32] = sl(ip[ix::LVLANDFILL], en);
        let n1 = n + 1;
        let heights: &[f32] = sl(ip[ix::HEIGHTS], n1 * n1);
        let cc = cw * cw;
        let cpop: &[f32] = sl(ip[ix::CPOP], cc);
        let cfreight: &[f32] = sl(ip[ix::CFREIGHT], cc);
        let zkind: &[u8] = sl(ip[ix::ZKIND], CODES);
        let zdev: &[u8] = sl(ip[ix::ZDEV], CODES * devs);
        let zlen: &[u8] = sl(ip[ix::ZLEN], CODES);
        let net_noise: &[f64] = sl(ip[ix::NET_NOISE], CODES);
        let net_traffic: &[f64] = sl(ip[ix::NET_TRAFFIC], CODES);
        for code in 0..CODES {
            let l = zlen[code] as usize;
            if l > devs || zdev[code * devs..code * devs + l].iter().any(|&d| d as usize >= devs) {
                return 2;
            }
        }
        let mut des: [&mut [f32]; DEV_MAX] = core::array::from_fn(|d| if d < devs { sl_mut(ip[ix::DES + d], nn) } else { &mut [][..] });

        let avg_commute = fp[fx::AVG_COMMUTE];
        let c_good = fp[fx::COMMUTE_GOOD];
        let c_bad = fp[fx::COMMUTE_BAD];
        let cov_fallback = (fp[fx::COVERAGE_FALLBACK] as f32) as f64;
        let busy = fp[fx::TRAFFIC_BUSY];
        let pop_full = fp[fx::POP_NEAR_FULL];
        let s0 = fp[fx::SLOPE_P0];
        let s1 = fp[fx::SLOPE_P1];
        let eff_lo = fp[fx::EFF_MIN];
        let eff_hi = fp[fx::EFF_MAX];

        let mut all = [0u8; DEV_MAX];
        for (d, v) in all.iter_mut().enumerate() {
            *v = d as u8;
        }
        let mut t = [0.0f64; NT];
        for z in z0..z1 {
            let r = z * n;
            let row = r..r + n;
            let zone_r = &zone[row.clone()];
            let net_r = &net[row.clone()];
            let water_r = &water[row.clone()];
            let traffic_r = &traffic[row.clone()];
            let bz = (z / coarse) * cw;
            let h0 = &heights[z * n1..z * n1 + n1];
            let h1 = &heights[(z + 1) * n1..(z + 1) * n1 + n1];
            // x / coarse, advanced incrementally (no integer division per cell)
            let mut bx = 0usize;
            let mut bnext = coarse;
            for x in 0..n {
                if x == bnext {
                    bx += 1;
                    bnext += coarse;
                }
                let i = r + x;
                if water_r[x] != 0 || net_r[x] != 0 {
                    if des[chk_a][i] != -1.0 || des[chk_b][i] != -1.0 {
                        for dl in des.iter_mut().take(devs) {
                            dl[i] = -1.0;
                        }
                    }
                    continue;
                }
                let zc = zone_r[x] as usize;
                let list: &[u8] = match zkind[zc] {
                    1 => &zdev[zc * devs..zc * devs + zlen[zc] as usize],
                    0 => {
                        if all_cells {
                            &all[..devs]
                        } else {
                            continue;
                        }
                    }
                    _ => {
                        ip[ix::ERR_CELL] = i as i32;
                        return 1;
                    }
                };
                // ---- terms (each rounded to f32 like the JS Float32Array T)
                t[T_LV] = lv[i] as f64;
                t[T_AIR] = air[i] as f64;
                t[T_WATER] = wpol[i] as f64;
                t[T_GARB] = garb[i] as f64;
                t[T_CRIME] = crime[i] as f64;
                // neighbour roads, in the JS order x-1, x+1, z-1, z+1
                let mut n_noise = 0.0f64;
                let mut n_traffic = 0.0f64;
                let mut vol = 0.0f64;
                if x > 0 {
                    let k = net_r[x - 1] as usize;
                    let a = net_noise[k];
                    if a > n_noise {
                        n_noise = a;
                    }
                    let b = net_traffic[k];
                    if b > n_traffic {
                        n_traffic = b;
                    }
                    let v = traffic_r[x - 1] as f64;
                    if v > vol {
                        vol = v;
                    }
                }
                if x + 1 < n {
                    let k = net_r[x + 1] as usize;
                    let a = net_noise[k];
                    if a > n_noise {
                        n_noise = a;
                    }
                    let b = net_traffic[k];
                    if b > n_traffic {
                        n_traffic = b;
                    }
                    let v = traffic_r[x + 1] as f64;
                    if v > vol {
                        vol = v;
                    }
                }
                if z > 0 {
                    let k = net[i - n] as usize;
                    let a = net_noise[k];
                    if a > n_noise {
                        n_noise = a;
                    }
                    let b = net_traffic[k];
                    if b > n_traffic {
                        n_traffic = b;
                    }
                    let v = traffic[i - n] as f64;
                    if v > vol {
                        vol = v;
                    }
                }
                if z + 1 < n {
                    let k = net[i + n] as usize;
                    let a = net_noise[k];
                    if a > n_noise {
                        n_noise = a;
                    }
                    let b = net_traffic[k];
                    if b > n_traffic {
                        n_traffic = b;
                    }
                    let v = traffic[i + n] as f64;
                    if v > vol {
                        vol = v;
                    }
                }
                t[T_NOISE] = if pollution_on { noise[i] as f64 } else { (n_noise as f32) as f64 };
                t[T_TRAFFIC] = if traffic_on { (js_min1(vol / busy) as f32) as f64 } else { (n_traffic as f32) as f64 };
                let cmi = commute[i];
                let cm = if traffic_on && cmi > 0.0 { cmi as f64 } else { avg_commute };
                t[T_COMMUTE] = ((0.5 - smoothstep(c_good, c_bad, cm)) as f32) as f64;
                if services_on {
                    t[T_POLICE] = police[i] as f64;
                    t[T_FIRE] = fire[i] as f64;
                    t[T_HEALTH] = health[i] as f64;
                    t[T_EDU] = edu[i] as f64;
                    t[T_PARK] = park[i] as f64;
                    t[T_TRANSIT] = transit[i] as f64;
                } else {
                    t[T_POLICE] = cov_fallback;
                    t[T_FIRE] = cov_fallback;
                    t[T_HEALTH] = cov_fallback;
                    t[T_EDU] = cov_fallback;
                    t[T_PARK] = (js_min1(js_max0(lv_effect(lveff[i], lvfill[i], eff_lo, eff_hi)) * 3.0) as f32) as f64;
                    t[T_TRANSIT] = 0.0;
                }
                let blk = bz + bx;
                t[T_POP] = (js_min1(cpop[blk] as f64 / pop_full) as f32) as f64;
                t[T_FREIGHT] = cfreight[blk] as f64;
                let sl4 = slope4(h0[x] as f64, h0[x + 1] as f64, h1[x] as f64, h1[x + 1] as f64);
                t[T_SLOPE] = (smoothstep(s0, s1, sl4) as f32) as f64;
                // ---- per dev, in list order
                for &d in list {
                    let d = d as usize;
                    des[d][i] = tb.value(d, &t) as f32;
                }
            }
        }
        0
    }
}

// ------------------------------------------------------------------------------------------------ land value
/// landValueSystem → band(st, z0, z1, first): land value of rows z0..z1 IN PLACE (row order is a data dependency).
/// fp[ACC..ACC+4] = (sum, cnt, sumAll, cntAll) are read and written back (the JS closure accumulators). Returns 0, or 2
/// when the parameters are out of domain (nothing written).
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
        let traffic_on = flags & F_TRAFFIC != 0;
        let services_on = flags & F_SERVICES != 0;
        let first = flags & F_ALL != 0;
        use ix::*;
        if !ptrs_ok(ip, &[ZONE, WATER], 1)
            || !ptrs_ok(ip, &[BUILDING, LV, AIR, WPOL, GARB, CRIME, NOISE, COMMUTE, LVSTATIC, LVEFF, LVLANDFILL, CWEALTH], 4)
            || (services_on && !ptrs_ok(ip, &[POLICE, FIRE, HEALTH, EDU, PARK, TRANSIT], 4))
        {
            return 2;
        }

        let zone: &[u8] = sl(ip[ix::ZONE], nn);
        let water: &[u8] = sl(ip[ix::WATER], nn);
        let building: &[i32] = sl(ip[ix::BUILDING], nn);
        let lv: &mut [f32] = sl_mut(ip[ix::LV], nn);
        let air: &[f32] = sl(ip[ix::AIR], nn);
        let wpol: &[f32] = sl(ip[ix::WPOL], nn);
        let garb: &[f32] = sl(ip[ix::GARB], nn);
        let crime: &[f32] = sl(ip[ix::CRIME], nn);
        let noise: &[f32] = sl(ip[ix::NOISE], nn);
        let commute: &[f32] = sl(ip[ix::COMMUTE], nn);
        let cn = if services_on { nn } else { 0 };
        let police: &[f32] = sl(ip[ix::POLICE], cn);
        let fire: &[f32] = sl(ip[ix::FIRE], cn);
        let health: &[f32] = sl(ip[ix::HEALTH], cn);
        let edu: &[f32] = sl(ip[ix::EDU], cn);
        let park: &[f32] = sl(ip[ix::PARK], cn);
        let transit: &[f32] = sl(ip[ix::TRANSIT], cn);
        let lvstatic: &[f32] = sl(ip[ix::LVSTATIC], nn);
        let lveff: &[f32] = sl(ip[ix::LVEFF], nn);
        let lvfill: &[f32] = sl(ip[ix::LVLANDFILL], nn);
        let cwealth: &[f32] = sl(ip[ix::CWEALTH], cw * cw);

        let avg_commute = fp[fx::AVG_COMMUTE];
        let c_good = fp[fx::COMMUTE_GOOD];
        let c_bad = fp[fx::COMMUTE_BAD];
        let cov_fallback = fp[fx::COVERAGE_FALLBACK];
        let eff_lo = fp[fx::EFF_MIN];
        let eff_hi = fp[fx::EFF_MAX];
        let k_base = fp[fx::LV_BASE];
        let k_services = fp[fx::LV_SERVICES];
        let k_parks = fp[fx::LV_PARKS];
        let k_transit = fp[fx::LV_TRANSIT];
        let k_commute = fp[fx::LV_COMMUTE];
        let k_wealth = fp[fx::LV_WEALTH];
        let k_air = fp[fx::LV_AIR];
        let k_wpol = fp[fx::LV_WPOL];
        let k_garb = fp[fx::LV_GARBAGE];
        let k_crime = fp[fx::LV_CRIME];
        let k_noise = fp[fx::LV_NOISE];
        let temporal = fp[fx::LV_TEMPORAL];
        let spatial = fp[fx::LV_SPATIAL];
        let keep = 1.0 - spatial;

        let mut sum = fp[fx::ACC];
        let mut cnt = fp[fx::ACC + 1];
        let mut sum_all = fp[fx::ACC + 2];
        let mut cnt_all = fp[fx::ACC + 3];
        for z in z0..z1 {
            let r = z * n;
            let bz = (z / coarse) * cw;
            let (head, tail) = lv.split_at_mut(r);
            let (cur, rest) = tail.split_at_mut(n);
            let up: &[f32] = if z > 0 { &head[r - n..r] } else { &[] };
            let dn: &[f32] = if z + 1 < n { &rest[..n] } else { &[] };
            let row = r..r + n;
            let water_r = &water[row.clone()];
            // value stored at x-1 of this row (every cell of the band stores)
            let mut left = 0.0f32;
            let mut bx = 0usize;
            let mut bnext = coarse;
            for x in 0..n {
                if x == bnext {
                    bx += 1;
                    bnext += coarse;
                }
                let i = r + x;
                if water_r[x] != 0 {
                    cur[x] = 0.0;
                    left = 0.0;
                    continue;
                }
                let (services, prk, trn) = if services_on {
                    ((police[i] as f64 + fire[i] as f64 + health[i] as f64 + edu[i] as f64) * 0.25, park[i] as f64, transit[i] as f64)
                } else {
                    (cov_fallback, js_max0(lv_effect(lveff[i], lvfill[i], eff_lo, eff_hi)) * 2.0, 0.0)
                };
                let cmi = commute[i];
                let cm = if traffic_on && cmi > 0.0 { cmi as f64 } else { avg_commute };
                let score = 1.0 - smoothstep(c_good, c_bad, cm);
                let wealth = cwealth[bz + bx] as f64;
                let mut v = k_base + lvstatic[i] as f64 + lv_effect(lveff[i], lvfill[i], eff_lo, eff_hi) + k_services * services
                    + k_parks * prk
                    + k_transit * trn
                    + k_commute * (score - 0.5)
                    + k_wealth * wealth
                    - k_air * air[i] as f64
                    - k_wpol * wpol[i] as f64
                    - k_garb * garb[i] as f64
                    - k_crime * crime[i] as f64
                    - k_noise * noise[i] as f64;
                v = clamp(v, 0.0, 1.0);
                if first {
                    let f = v as f32;
                    cur[x] = f;
                    left = f;
                    continue;
                }
                let mut s = 0.0f64;
                let mut c = 0u32;
                if x > 0 {
                    s += left as f64;
                    c += 1;
                }
                if x + 1 < n {
                    s += cur[x + 1] as f64;
                    c += 1;
                }
                if z > 0 {
                    s += up[x] as f64;
                    c += 1;
                }
                if z + 1 < n {
                    s += dn[x] as f64;
                    c += 1;
                }
                let sp = if c != 0 { v * keep + (if c == 4 { s * 0.25 } else { s / c as f64 }) * spatial } else { v };
                let old = cur[x] as f64;
                let nv = old + (sp - old) * temporal;
                let f = nv as f32;
                cur[x] = f;
                left = f;
                sum_all += nv;
                cnt_all += 1.0;
                if zone[i] != 0 || building[i] >= 0 {
                    sum += nv;
                    cnt += 1.0;
                }
            }
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
