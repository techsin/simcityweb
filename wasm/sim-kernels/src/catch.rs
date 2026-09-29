//! Services tier engine ("catchments") — port of `ServicesSystem.tierWork` (src/sim/infra/services.ts at commit
//! 24f8609: reachOf, splatUnion, allocSeats, reportDemand, finalizeTier, footprints, the legacy-combo loop of finish,
//! finishTransit), of the reach kernels of src/sim/infra/catchments.ts (reachRaw -> reachRoad / reachEuclid /
//! nearField / falloff), of transit.ts computeTransitCoverage, and of the numeric parts of accessCommuteLand / shopLand
//! (chamfer, box3, block sums, bilinear LUT taps). Binding: src/wasm/kernels/servicesBind.ts; the restructured JS twin
//! (same algorithm, same data layout) is src/wasm/js/servicesTierEngine.ts.
//!
//! Calling convention: every export takes `ip: *mut i32` (integers and byte pointers) and, where needed,
//! `fp: *mut f64` (float parameters / outputs), a parameter block the binding fills at the fixed indices below
//! (mirrored in servicesBind.ts; `catch_layout()` must match its CATCH_LAYOUT). Kernels read their inputs from linear
//! memory and write outputs in place; they never allocate and never grow memory.
//!
//! Bit-exactness notes (see wasm/README.md "Float / determinism rules"):
//!  * every value is computed in f64 in the JS evaluation order and rounded to f32 exactly where the JS stores into a
//!    Float32Array; the f64 accumulations (D, served, work units, need / served / unreached sums) run in the JS order;
//!  * THE TOUCHED ORDER IS PART OF THE CONTRACT: a reach's pool segment is written in the order of catchments.ts's
//!    `touched` list (near-field BFS order, then the Dial search's settle order x 3x3 row-major splat), because that
//!    order fixes the f64 accumulation order of D / served in later phases;
//!  * `Math.hypot` is V8's algorithm (normalise by the max, Kahan-compensated sum of squares, sqrt(sum) x max);
//!    `Math.max / Math.min` keep their NaN / -0 semantics (js_max / js_min); `Math.floor / Math.ceil` are exact.
//!  * the scheduler's work units (U_SEARCH / U_COPY / U_ENTRY per entry, WORK_PER_STEP) are accumulated here in the
//!    JS order too, so the batched phases stop at exactly the facility where the JS step stops.

use crate::math::floor;

/// parameter-block layout version (servicesBind.ts CATCH_LAYOUT)
pub const LAYOUT: u32 = 3;

#[unsafe(no_mangle)]
pub extern "C" fn catch_layout() -> u32 {
    LAYOUT
}

// ------------------------------------------------------------------------------------------------ parameter blocks
/// reach context: ip indices shared by catch_search and catch_reach_raw
pub mod rx {
    pub const N: usize = 0;
    pub const NET: usize = 1;
    pub const WATER: usize = 2;
    pub const WALK: usize = 3;
    pub const DRIVE: usize = 4;
    pub const NCOST: usize = 5;
    pub const RAMP: usize = 6;
    pub const HW: usize = 7;
    pub const STREET: usize = 8;
    pub const VISIT: usize = 9;
    pub const DSTAMP: usize = 10;
    pub const DIST: usize = 11;
    pub const TOUCHED: usize = 12;
    pub const BEST: usize = 13;
    pub const HEAD: usize = 14;
    pub const ENODE: usize = 15;
    pub const ENEXT: usize = 16;
    pub const EN_CAP: usize = 17;
    pub const FALL: usize = 18;
    pub const FALL_CAP: usize = 19;
    pub const NF_SEEN: usize = 20;
    pub const NF_QUEUE: usize = 21;
    pub const NF_CAP: usize = 22;
    pub const STAMP: usize = 23;
    /// catch_reach_raw: footprint + metric
    pub const BX: usize = 24;
    pub const BZ: usize = 25;
    pub const BW: usize = 26;
    pub const BD: usize = 27;
    pub const METRIC: usize = 28;
    /// fp
    pub const F_NEAR: usize = 0;
    pub const F_ROADF: usize = 1;
    pub const F_RADIUS: usize = 2;
}

/// catch_search ip indices (after the reach context) / fp indices
pub mod sx {
    pub const N_FAC: usize = 24;
    pub const GEO: usize = 25;
    pub const RADIUS: usize = 26;
    pub const METRIC: usize = 27;
    pub const STR: usize = 28;
    pub const OP: usize = 29;
    pub const CAP: usize = 30;
    pub const KEY: usize = 31;
    pub const REC: usize = 32;
    pub const ALIVE: usize = 33;
    pub const FS: usize = 34;
    pub const FE: usize = 35;
    pub const D: usize = 36;
    pub const SERVED: usize = 37;
    pub const REC_START: usize = 38;
    pub const REC_END: usize = 39;
    pub const REC_BOX: usize = 40;
    pub const REC_KEY: usize = 41;
    pub const REC_VALID: usize = 42;
    pub const REC_ROAD: usize = 43;
    pub const REC_STAMP: usize = 44;
    pub const N_REC: usize = 45;
    pub const PASS_STAMP: usize = 46;
    pub const IDX: usize = 47;
    pub const W: usize = 48;
    pub const POOL_CAP: usize = 49;
    pub const TOP: usize = 50;
    pub const DEAD: usize = 51;
    pub const SPLAT: usize = 52;
    pub const NEED: usize = 53;
    pub const A: usize = 54;
    pub const COV: usize = 55;
    pub const CURSOR: usize = 56;
    pub const N_FRESH: usize = 57;
    pub const N_CACHED: usize = 58;
    pub const F_NEAR: usize = 0;
    pub const F_ROADF: usize = 1;
    pub const F_WORK: usize = 2;
    pub const F_LEFT: usize = 3;
    pub const F_LIMIT: usize = 4;
    pub const F_USEARCH: usize = 5;
    pub const F_UCOPY: usize = 6;
    pub const F_UENTRY: usize = 7;
}

/// catch_union / catch_alloc / catch_report ip indices (shared prefix) and fp indices
pub mod ax {
    pub const N_FAC: usize = 0;
    pub const CURSOR: usize = 1;
    pub const ORDER: usize = 2;
    pub const FS: usize = 3;
    pub const FE: usize = 4;
    pub const STR: usize = 5;
    pub const OP: usize = 6;
    pub const CAP: usize = 7;
    pub const IDX: usize = 8;
    pub const W: usize = 9;
    pub const POOL_CAP: usize = 10;
    pub const NEED: usize = 11;
    pub const U: usize = 12;
    pub const A: usize = 13;
    pub const COV: usize = 14;
    pub const C: usize = 15;
    /// alloc: sig / seated / D (f64 per facility); union: D / served; report: sig (in) / seated (in) / dem (out)
    pub const O1: usize = 16;
    pub const O2: usize = 17;
    pub const O3: usize = 18;
    /// alloc: e-cache (f64); report: dem-ok flags (u8)
    pub const EC: usize = 19;
    pub const EC_CAP: usize = 20;
    pub const F_WORK: usize = 0;
    pub const F_LEFT: usize = 1;
    pub const F_LIMIT: usize = 2;
    pub const F_UENTRY: usize = 3;
}

// ------------------------------------------------------------------------------------------------ JS Math
// `sqrt` from the libm that ships with compiler-builtins (no import): LLVM lowers the call to the `f64.sqrt`
// instruction (correctly rounded, like Math.sqrt) and keeps the libm call only for a NaN result (negative input).
// core has no stable f64::sqrt under #![no_std] and core::arch::wasm32::f64_sqrt is unstable.
unsafe extern "C" {
    #[link_name = "sqrt"]
    fn libm_sqrt(x: f64) -> f64;
}
#[inline(always)]
fn sqrt(x: f64) -> f64 {
    unsafe { libm_sqrt(x) }
}

#[inline(always)]
fn fabs(x: f64) -> f64 {
    f64::from_bits(x.to_bits() & !(1u64 << 63))
}

/// `Math.ceil`
#[inline(always)]
pub fn ceil(x: f64) -> f64 {
    -floor(-x)
}

/// `Math.max(a, b)`: NaN if either is NaN, +0 beats -0
#[inline(always)]
pub fn js_max(a: f64, b: f64) -> f64 {
    if a != a || b != b {
        return f64::NAN;
    }
    if a == b {
        // equal (incl. +0 / -0): +0 if either is +0
        return if a.to_bits() == 0 || b.to_bits() == 0 { 0.0 } else { a };
    }
    if a > b { a } else { b }
}

/// `Math.min(a, b)`: NaN if either is NaN, -0 beats +0
#[inline(always)]
pub fn js_min(a: f64, b: f64) -> f64 {
    if a != a || b != b {
        return f64::NAN;
    }
    if a == b {
        return if a.to_bits() == (1u64 << 63) || b.to_bits() == (1u64 << 63) { -0.0 } else { a };
    }
    if a < b { a } else { b }
}

/// `Math.hypot(a, b)` exactly as V8 computes it (builtins/math.tq MathHypot): max of the absolute values, Infinity /
/// NaN / 0 shortcuts, then a Kahan-compensated sum of the squares normalised by the max, sqrt(sum) x max.
#[inline]
pub fn v8_hypot2(a: f64, b: f64) -> f64 {
    let a_nan = a != a;
    let b_nan = b != b;
    let aa = fabs(a);
    let bb = fabs(b);
    let mut max = 0.0f64;
    if !a_nan && aa > max {
        max = aa;
    }
    if !b_nan && bb > max {
        max = bb;
    }
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if a_nan || b_nan {
        return f64::NAN;
    }
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0f64;
    let mut comp = 0.0f64;
    let n = aa / max;
    let summand = n * n - comp;
    let pre = sum + summand;
    comp = (pre - sum) - summand;
    sum = pre;
    let n = bb / max;
    let summand = n * n - comp;
    let pre = sum + summand;
    // (the compensation after the last term is not used)
    let _ = (pre - sum) - summand;
    sum = pre;
    sqrt(sum) * max
}

#[unsafe(no_mangle)]
pub extern "C" fn catch_hypot(a: f64, b: f64) -> f64 {
    v8_hypot2(a, b)
}

/// catchments.ts falloff: full strength up to 35 % of R, smoothstep drop to 0 at R
#[inline]
pub fn falloff(d: f64, r: f64) -> f64 {
    let a = 0.35 * r;
    if d <= a {
        return 1.0;
    }
    if d >= r {
        return 0.0;
    }
    let t = (d - a) / (r - a);
    1.0 - t * t * (3.0 - 2.0 * t)
}

// ------------------------------------------------------------------------------------------------ slices
#[inline(always)]
unsafe fn s<'a, T>(p: i32, n: usize) -> &'a [T] {
    unsafe { core::slice::from_raw_parts(p as usize as *const T, n) }
}
#[inline(always)]
unsafe fn sm<'a, T>(p: i32, n: usize) -> &'a mut [T] {
    unsafe { core::slice::from_raw_parts_mut(p as usize as *mut T, n) }
}

// ------------------------------------------------------------------------------------------------ reach kernels
/// map + scratch of one reach search (catchments.ts ReachEngine + the module-level near-field buffers)
pub struct Reach<'a> {
    pub n: usize,
    pub net: &'a [u8],
    pub water: &'a [u8],
    pub walk: &'a [i32],
    pub drive: &'a [i32],
    pub ramp: i32,
    pub hw: u8,
    pub street: u8,
    pub visit: &'a mut [i32],
    pub dstamp: &'a mut [i32],
    pub dist: &'a mut [i32],
    pub touched: &'a mut [i32],
    pub best: &'a mut [f32],
    pub head: &'a mut [i32],
    pub enode: &'a mut [i32],
    pub enext: &'a mut [i32],
    pub fall: &'a mut [f32],
    pub nf_seen: &'a mut [u8],
    pub nf_queue: &'a mut [i32],
    pub stamp: i32,
    pub near_field: f64,
    pub road_factor: f64,
}

impl<'a> Reach<'a> {
    /// ReachEngine.nextStamp()
    #[inline]
    fn next_stamp(&mut self) -> i32 {
        if self.stamp >= 0x7ffffff0 {
            self.stamp = 0;
            self.visit.fill(0);
            self.dstamp.fill(0);
        }
        self.stamp += 1;
        self.stamp
    }

    /// reachRaw: 0 when !(radius > 0); metric 2 = euclid, else road (0 walk costs, 1 drive costs + ramps).
    /// None: a network code outside the cost tables (JS would read `undefined` there): nothing but scratch was
    /// touched, the caller runs this facility in JS.
    pub fn reach_raw(&mut self, bx: i32, bz: i32, bw: i32, bd: i32, radius: f64, metric: i32) -> Option<usize> {
        if !(radius > 0.0) {
            return Some(0);
        }
        if metric == 2 { Some(self.reach_euclid(bx, bz, bw, bd, radius)) } else { self.reach_road(bx, bz, bw, bd, radius, metric) }
    }

    fn reach_euclid(&mut self, bx: i32, bz: i32, bw: i32, bd: i32, r: f64) -> usize {
        let n = self.n;
        let stamp = self.next_stamp();
        let (bx, bz, bw, bd) = (bx as f64, bz as f64, bw as f64, bd as f64);
        let cx = bx + bw / 2.0 - 0.5;
        let cz = bz + bd / 2.0 - 0.5;
        let half = js_max(bw, bd) / 2.0;
        let rt = r + half;
        let nm1 = (n - 1) as f64;
        let x0 = js_max(0.0, floor(cx - rt));
        let x1 = js_min(nm1, ceil(cx + rt));
        let z0 = js_max(0.0, floor(cz - rt));
        let z1 = js_min(nm1, ceil(cz + rt));
        // JS loops `for (z = z0; z <= z1; z++)`: empty when z0 > z1 or either is NaN
        if !(x0 <= x1) || !(z0 <= z1) {
            return 0;
        }
        let (x0, x1, z0, z1) = (x0 as usize, x1 as usize, z0 as usize, z1 as usize);
        let visit = &mut *self.visit;
        let best = &mut *self.best;
        let touched = &mut *self.touched;
        let mut cnt = 0usize;
        for z in z0..=z1 {
            let dz = z as f64 - cz;
            let row = z * n;
            for x in x0..=x1 {
                let d = js_max(0.0, v8_hypot2(x as f64 - cx, dz) - half);
                if d > r {
                    continue;
                }
                let v = falloff(d, r);
                if v <= 0.0 {
                    continue;
                }
                let i = row + x;
                if visit[i] != stamp {
                    visit[i] = stamp;
                    touched[cnt] = i as i32;
                    cnt += 1;
                }
                best[i] = v as f32;
            }
        }
        cnt
    }

    /// near field: cells within `near` (Chebyshev) of the footprint, 4-connected to it without crossing a barrier
    /// (cost 0 network cell, or water without a passable road); best = 1, touched from 0 in BFS order
    fn near_field(&mut self, bx: i64, bz: i64, bw: i64, bd: i64, near: i64, cost: &[i32], stamp: i32) -> Option<usize> {
        let n = self.n as i64;
        let x0 = if bx - near > 0 { bx - near } else { 0 };
        let x1 = if bx + bw - 1 + near < n - 1 { bx + bw - 1 + near } else { n - 1 };
        let z0 = if bz - near > 0 { bz - near } else { 0 };
        let z1 = if bz + bd - 1 + near < n - 1 { bz + bd - 1 + near } else { n - 1 };
        if x1 < x0 || z1 < z0 {
            return Some(0);
        }
        let w = (x1 - x0 + 1) as usize;
        let h = (z1 - z0 + 1) as usize;
        let nu = self.n;
        let seen = &mut self.nf_seen[..w * h];
        let queue = &mut *self.nf_queue;
        seen.fill(0);
        let mut qt = 0usize;
        let fz0 = if bz > z0 { bz } else { z0 };
        let fz1 = if bz + bd - 1 < z1 { bz + bd - 1 } else { z1 };
        let fx0 = if bx > x0 { bx } else { x0 };
        let fx1 = if bx + bw - 1 < x1 { bx + bw - 1 } else { x1 };
        let mut z = fz0;
        while z <= fz1 {
            let mut x = fx0;
            while x <= fx1 {
                let l = (z - z0) as usize * w + (x - x0) as usize;
                seen[l] = 1;
                queue[qt] = l as i32;
                qt += 1;
                x += 1;
            }
            z += 1;
        }
        let (x0, z0) = (x0 as usize, z0 as usize);
        let net = self.net;
        let water = self.water;
        let visit = &mut *self.visit;
        let best = &mut *self.best;
        let touched = &mut *self.touched;
        let mut cnt = 0usize;
        let mut qh = 0usize;
        while qh < qt {
            let l = queue[qh] as usize;
            qh += 1;
            let lx = l % w;
            let lz = l / w;
            let i = (z0 + lz) * nu + x0 + lx;
            if visit[i] != stamp {
                visit[i] = stamp;
                touched[cnt] = i as i32;
                cnt += 1;
            }
            best[i] = 1.0;
            for k in 0..4 {
                let (m, j) = match k {
                    0 => {
                        if lx == 0 {
                            continue;
                        }
                        (l - 1, i - 1)
                    }
                    1 => {
                        if lx == w - 1 {
                            continue;
                        }
                        (l + 1, i + 1)
                    }
                    2 => {
                        if lz == 0 {
                            continue;
                        }
                        (l - w, i - nu)
                    }
                    _ => {
                        if lz == h - 1 {
                            continue;
                        }
                        (l + w, i + nu)
                    }
                };
                if seen[m] != 0 {
                    continue;
                }
                seen[m] = 1;
                let t = net[j];
                let ct = match cost.get(t as usize) {
                    Some(&v) => v,
                    None => return None,
                };
                if ct == 0 && (t != 0 || water[j] != 0) {
                    continue; // barrier
                }
                queue[qt] = m as i32;
                qt += 1;
            }
        }
        Some(cnt)
    }

    #[inline(always)]
    fn push(head: &mut [i32], enode: &mut [i32], enext: &mut [i32], en: &mut usize, slot: usize, v: i32) {
        let e = *en;
        *en = e + 1;
        enode[e] = v;
        enext[e] = head[slot];
        head[slot] = e as i32;
    }

    fn reach_road(&mut self, bx: i32, bz: i32, bw: i32, bd: i32, radius: f64, metric: i32) -> Option<usize> {
        let n = self.n;
        let net = self.net;
        let cost: &[i32] = if metric == 0 { self.walk } else { self.drive };
        let drive = metric == 1;
        let stamp = self.next_stamp();
        let road_r = radius * self.road_factor;
        // maxQ = Math.min(8000, Math.ceil(roadR * 4)) (radius > 0: an integer in [1, 8000])
        let mq = js_min(8000.0, ceil(road_r * 4.0));
        let max_q = mq as i32;
        {
            let fall = &mut *self.fall;
            let mut q = 0i32;
            while q <= max_q + 8 {
                fall[q as usize] = falloff(q as f64 / 4.0, road_r) as f32;
                q += 1;
            }
        }
        // near field: Math.min(CATCH_NEAR_FIELD, Math.floor(radius)) (>= 0: radius > 0)
        let nf = js_min(self.near_field, floor(radius));
        let near = if nf > 1048576.0 { 1048576i64 } else { nf as i64 };
        let mut cnt = self.near_field(bx as i64, bz as i64, bw as i64, bd as i64, near, cost, stamp)?;
        // seeds: passable road cells around the footprint (corners included)
        let head = &mut *self.head;
        head.fill(-1);
        let enode = &mut *self.enode;
        let enext = &mut *self.enext;
        let dist = &mut *self.dist;
        let dstamp = &mut *self.dstamp;
        let visit = &mut *self.visit;
        let best = &mut *self.best;
        let touched = &mut *self.touched;
        let fall = &*self.fall;
        let mut en = 0usize;
        let mut pending = 0i64;
        let ni = n as i64;
        let (bx, bz, bw, bd) = (bx as i64, bz as i64, bw as i64, bd as i64);
        let mut z = bz - 1;
        while z <= bz + bd {
            if z >= 0 && z < ni {
                let mut x = bx - 1;
                while x <= bx + bw {
                    if x >= 0 && x < ni && !(x >= bx && x < bx + bw && z >= bz && z < bz + bd) {
                        let i = (z * ni + x) as usize;
                        let ci = match cost.get(net[i] as usize) {
                            Some(&v) => v,
                            None => return None,
                        };
                        if !(ci == 0 || dstamp[i] == stamp) {
                            dstamp[i] = stamp;
                            dist[i] = 0;
                            Self::push(head, enode, enext, &mut en, 0, i as i32);
                            pending += 1;
                        }
                    }
                    x += 1;
                }
            }
            z += 1;
        }
        // Dial: 8 circular buckets
        let hw = self.hw;
        let street = self.street;
        let ramp = self.ramp;
        let mut cur: i32 = 0;
        while pending > 0 {
            let slot = (cur & 7) as usize;
            let mut e = head[slot];
            head[slot] = -1;
            while e >= 0 {
                let u = enode[e as usize] as usize;
                e = enext[e as usize];
                pending -= 1;
                if dist[u] != cur {
                    continue; // stale entry
                }
                let v = fall[cur as usize];
                let x = u % n;
                let z = u / n;
                if v > 0.0 {
                    let v1 = fall[cur as usize + 4];
                    let zz0 = if z > 0 { z - 1 } else { 0 };
                    let zz1 = if z < n - 1 { z + 1 } else { n - 1 };
                    let xx0 = if x > 0 { x - 1 } else { 0 };
                    let xx1 = if x < n - 1 { x + 1 } else { n - 1 };
                    for zz in zz0..=zz1 {
                        let row = zz * n;
                        for xx in xx0..=xx1 {
                            let j = row + xx;
                            let w = if j == u { v } else { v1 };
                            if visit[j] != stamp {
                                visit[j] = stamp;
                                best[j] = w;
                                touched[cnt] = j as i32;
                                cnt += 1;
                            } else if w > best[j] {
                                best[j] = w;
                            }
                        }
                    }
                }
                let tu = net[u];
                let hu = tu == hw;
                for k in 0..4 {
                    let j = match k {
                        0 => {
                            if x == 0 {
                                continue;
                            }
                            u - 1
                        }
                        1 => {
                            if x == n - 1 {
                                continue;
                            }
                            u + 1
                        }
                        2 => {
                            if z == 0 {
                                continue;
                            }
                            u - n
                        }
                        _ => {
                            if z == n - 1 {
                                continue;
                            }
                            u + n
                        }
                    };
                    let tj = net[j];
                    let mut c = match cost.get(tj as usize) {
                        Some(&v) => v,
                        None => return None,
                    };
                    if c == 0 {
                        continue;
                    }
                    if drive && hu != (tj == hw) {
                        if tu == street || tj == street {
                            continue; // no ramps between streets and highways
                        }
                        c += ramp;
                    }
                    let nd = cur + c;
                    if nd > max_q {
                        continue;
                    }
                    if dstamp[j] != stamp || nd < dist[j] {
                        dstamp[j] = stamp;
                        dist[j] = nd;
                        Self::push(head, enode, enext, &mut en, (nd & 7) as usize, j as i32);
                        pending += 1;
                    }
                }
            }
            cur += 1;
        }
        Some(cnt)
    }
}

/// build the reach context from the parameter block (with_map = false: no network / water yet — empty slices; the
/// caller must not search then)
unsafe fn reach_ctx<'a>(ip: &[i32], fp: &[f64], f_near: usize, f_roadf: usize, with_map: bool) -> Reach<'a> {
    unsafe {
        let n = ip[rx::N] as usize;
        let c = n * n;
        let ncost = ip[rx::NCOST] as usize;
        Reach {
            n,
            net: if with_map { s(ip[rx::NET], c) } else { &[] },
            water: if with_map { s(ip[rx::WATER], c) } else { &[] },
            walk: s(ip[rx::WALK], ncost),
            drive: s(ip[rx::DRIVE], ncost),
            ramp: ip[rx::RAMP],
            hw: ip[rx::HW] as u8,
            street: ip[rx::STREET] as u8,
            visit: sm(ip[rx::VISIT], c),
            dstamp: sm(ip[rx::DSTAMP], c),
            dist: sm(ip[rx::DIST], c),
            touched: sm(ip[rx::TOUCHED], c),
            best: sm(ip[rx::BEST], c),
            head: sm(ip[rx::HEAD], 8),
            enode: sm(ip[rx::ENODE], ip[rx::EN_CAP] as usize),
            enext: sm(ip[rx::ENEXT], ip[rx::EN_CAP] as usize),
            fall: sm(ip[rx::FALL], ip[rx::FALL_CAP] as usize),
            nf_seen: sm(ip[rx::NF_SEEN], ip[rx::NF_CAP] as usize),
            nf_queue: sm(ip[rx::NF_QUEUE], ip[rx::NF_CAP] as usize),
            stamp: ip[rx::STAMP],
            near_field: fp[f_near],
            road_factor: fp[f_roadf],
        }
    }
}

/// catchments.reachRaw (tests / micro-benchmarks): touched[0..n) + best[], returns n (-1: network code outside the
/// cost tables); ip[STAMP] updated
#[unsafe(no_mangle)]
pub unsafe extern "C" fn catch_reach_raw(ip: *mut i32, fp: *mut f64) -> i32 {
    unsafe {
        let ip = sm::<i32>(ip as i32, 32);
        let fp = sm::<f64>(fp as i32, 4);
        let mut r = reach_ctx(ip, fp, rx::F_NEAR, rx::F_ROADF, true);
        let cnt = r.reach_raw(ip[rx::BX], ip[rx::BZ], ip[rx::BW], ip[rx::BD], fp[rx::F_RADIUS], ip[rx::METRIC]);
        ip[rx::STAMP] = r.stamp;
        match cnt {
            Some(c) => c as i32,
            None => -1,
        }
    }
}

// ------------------------------------------------------------------------------------------------ cell access
// The pool loops (union splat, alloc, report) gather / scatter per-cell arrays at the pool's cell indices. Pool entries
// are written only from a reach's touched cells (always < C, see Reach) and only moved by compaction, and every
// per-cell slice passed to these loops has exactly C elements, so the cell index is in bounds by construction: those
// accesses skip the bounds check (1.07x [1.06, 1.10] on allocSeats, dense1m). Everything else stays checked.
#[inline(always)]
fn cell<T: Copy>(a: &[T], i: usize) -> T {
    debug_assert!(i < a.len());
    unsafe { *a.get_unchecked(i) }
}
#[inline(always)]
fn cell_mut<T>(a: &mut [T], i: usize) -> &mut T {
    debug_assert!(i < a.len());
    unsafe { a.get_unchecked_mut(i) }
}

// ------------------------------------------------------------------------------------------------ union splat
/// splatUnion over pool[q0, q1): returns (D, served); A / cov updated in place
#[inline]
fn splat_union(
    idx: &[i32], w: &[f32], q0: usize, q1: usize, s: f64, op: f64, cap: f64, need: &[f32], a: &mut [f32], cov: &mut [f32],
) -> (f64, f64) {
    let idx = &idx[q0..q1];
    let w = &w[q0..q1];
    let mut d = 0.0f64;
    let c = need.len();
    if a.len() != c || cov.len() != c {
        return (0.0, 0.0);
    }
    for q in 0..idx.len() {
        let i = idx[q] as usize;
        let wq = w[q] as f64;
        d += cell(need, i) as f64 * wq;
        let ai = cell_mut(a, i);
        *ai = (*ai as f64 + wq) as f32;
    }
    let r = if cap < f64::INFINITY && d > cap { op * (cap / d) } else { op };
    let eff = s * r;
    let mut served = 0.0f64;
    if eff > 0.0 {
        for q in 0..idx.len() {
            let i = idx[q] as usize;
            let mut v = w[q] as f64 * eff;
            if v > 1.0 {
                v = 1.0;
            }
            served += cell(need, i) as f64 * v;
            let ci = cell_mut(cov, i);
            *ci = (1.0 - (1.0 - *ci as f64) * (1.0 - v)) as f32;
        }
    }
    (d, served)
}

// ------------------------------------------------------------------------------------------------ P_SEARCH
/// One P_SEARCH batch of a tier slot (ServicesSystem.tierWork P_SEARCH + reachOf + splatUnion for union slots):
/// facilities [cursor, n) in list order while work < limit. Per facility: dead (alive = 0) -> empty range, no work;
/// cached (record valid, same key) -> its pool segment in place; else a fresh reach appended at the pool top (the
/// record is rewritten, its old segment counted dead). Union slots (splat = 1) splat the segment right after.
/// Returns 0 (limit reached or list done), 1 (pool too full for a fresh reach: grow it and call again), 2 (a network
/// code outside the cost tables: run the rest of the batch in JS) or 3 (a fresh reach needs the network / water, whose
/// pointers are 0: stage them and call again); for 1..3 the cursor points at that facility and nothing of it was done
/// (reach scratch aside).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn catch_search(ip: *mut i32, fp: *mut f64) -> i32 {
    unsafe {
        let ip = sm::<i32>(ip as i32, 64);
        let fp = sm::<f64>(fp as i32, 8);
        // network / water are staged lazily by the binding (0 = not provided yet: only cached reaches possible)
        let have_map = ip[rx::NET] != 0 && ip[rx::WATER] != 0;
        let n = ip[rx::N] as usize;
        let c = n * n;
        let mut r = reach_ctx(ip, fp, sx::F_NEAR, sx::F_ROADF, have_map);
        let nf = ip[sx::N_FAC] as usize;
        let geo = s::<i32>(ip[sx::GEO], 4 * nf);
        let radius = s::<f64>(ip[sx::RADIUS], nf);
        let metric = s::<i32>(ip[sx::METRIC], nf);
        let strength = s::<f64>(ip[sx::STR], nf);
        let op = s::<f64>(ip[sx::OP], nf);
        let capv = s::<f64>(ip[sx::CAP], nf);
        let key = s::<f64>(ip[sx::KEY], nf);
        let rec_of = s::<i32>(ip[sx::REC], nf);
        let alive = s::<u8>(ip[sx::ALIVE], nf);
        let fs = sm::<i32>(ip[sx::FS], nf);
        let fe = sm::<i32>(ip[sx::FE], nf);
        let d_out = sm::<f64>(ip[sx::D], nf);
        let served_out = sm::<f64>(ip[sx::SERVED], nf);
        let nrec = ip[sx::N_REC] as usize;
        let rec_start = sm::<i32>(ip[sx::REC_START], nrec);
        let rec_end = sm::<i32>(ip[sx::REC_END], nrec);
        let rec_box = sm::<i32>(ip[sx::REC_BOX], 4 * nrec);
        let rec_key = sm::<f64>(ip[sx::REC_KEY], nrec);
        let rec_valid = sm::<u8>(ip[sx::REC_VALID], nrec);
        let rec_road = sm::<u8>(ip[sx::REC_ROAD], nrec);
        let rec_stamp = sm::<i32>(ip[sx::REC_STAMP], nrec);
        let pass = ip[sx::PASS_STAMP];
        let pool_cap = ip[sx::POOL_CAP] as usize;
        let idx = sm::<i32>(ip[sx::IDX], pool_cap);
        let pw = sm::<f32>(ip[sx::W], pool_cap);
        let mut top = ip[sx::TOP] as usize;
        let mut dead = ip[sx::DEAD] as i64;
        let splat = ip[sx::SPLAT] != 0;
        let (need, a, cov): (&[f32], &mut [f32], &mut [f32]) = if splat {
            (s::<f32>(ip[sx::NEED], c), sm::<f32>(ip[sx::A], c), sm::<f32>(ip[sx::COV], c))
        } else {
            (&[], &mut [], &mut [])
        };
        let mut cursor = ip[sx::CURSOR] as usize;
        let mut n_fresh = ip[sx::N_FRESH];
        let mut n_cached = ip[sx::N_CACHED];
        let mut work = fp[sx::F_WORK];
        let mut left = fp[sx::F_LEFT];
        let limit = fp[sx::F_LIMIT];
        let u_search = fp[sx::F_USEARCH];
        let u_copy = fp[sx::F_UCOPY];
        let u_entry = fp[sx::F_UENTRY];
        let mut status = 0;
        while cursor < nf {
            let ci = cursor;
            if alive[ci] == 0 {
                // !st.buildings.has(b.id): facStart = facEnd = poolN, no work (the loop condition is unchanged)
                fs[ci] = top as i32;
                fe[ci] = top as i32;
                cursor += 1;
                continue;
            }
            let rec = rec_of[ci] as usize;
            let ureach: f64;
            if rec_valid[rec] != 0 && rec_key[rec] == key[ci] {
                let (q0, q1) = (rec_start[rec], rec_end[rec]);
                fs[ci] = q0;
                fe[ci] = q1;
                rec_stamp[rec] = pass;
                n_cached += 1;
                ureach = (q1 - q0) as f64 * u_copy + 8.0;
            } else {
                if !have_map {
                    status = 3;
                    break;
                }
                if pool_cap - top < c {
                    status = 1;
                    break;
                }
                let m0 = metric[ci];
                let cnt = match r.reach_raw(geo[4 * ci], geo[4 * ci + 1], geo[4 * ci + 2], geo[4 * ci + 3], radius[ci], m0) {
                    Some(v) => v,
                    None => {
                        status = 2;
                        break;
                    }
                };
                let off = top;
                let mut m = off;
                let (mut x0, mut z0, mut x1, mut z1) = (n as i32, n as i32, -1i32, -1i32);
                let touched = &*r.touched;
                let best = &*r.best;
                for t in 0..cnt {
                    let i = touched[t] as usize;
                    let wv = best[i];
                    if wv <= 0.0 {
                        continue;
                    }
                    idx[m] = i as i32;
                    pw[m] = wv;
                    m += 1;
                    let x = (i % n) as i32;
                    let z = (i / n) as i32;
                    if x < x0 {
                        x0 = x;
                    }
                    if x > x1 {
                        x1 = x;
                    }
                    if z < z0 {
                        z0 = z;
                    }
                    if z > z1 {
                        z1 = z;
                    }
                }
                top = m;
                dead += (rec_end[rec] - rec_start[rec]) as i64;
                rec_start[rec] = off as i32;
                rec_end[rec] = m as i32;
                rec_box[4 * rec] = x0;
                rec_box[4 * rec + 1] = z0;
                rec_box[4 * rec + 2] = x1;
                rec_box[4 * rec + 3] = z1;
                rec_key[rec] = key[ci];
                rec_valid[rec] = 1;
                rec_road[rec] = if m0 != 2 { 1 } else { 0 };
                rec_stamp[rec] = pass;
                fs[ci] = off as i32;
                fe[ci] = m as i32;
                n_fresh += 1;
                ureach = cnt as f64 * (if m0 == 2 { u_search / 2.0 } else { u_search }) + 16.0;
            }
            let mut u = ureach;
            if splat {
                let (q0, q1) = (fs[ci] as usize, fe[ci] as usize);
                let (d, sv) = splat_union(idx, pw, q0, q1, strength[ci], op[ci], capv[ci], need, a, cov);
                d_out[ci] = d;
                served_out[ci] = sv;
                u = ureach + ((q1 - q0) as f64 * u_entry * 2.0 + 8.0);
            } else {
                // JS: reachOf(...) + (shared ? 0 : splatUnion(...)) — the + 0 is kept for the exact same f64 sequence
                u = u + 0.0;
            }
            work += u;
            left -= u;
            cursor += 1;
            if !(work < limit) {
                break;
            }
        }
        ip[sx::CURSOR] = cursor as i32;
        ip[sx::TOP] = top as i32;
        ip[sx::DEAD] = dead as i32;
        ip[sx::N_FRESH] = n_fresh;
        ip[sx::N_CACHED] = n_cached;
        ip[rx::STAMP] = r.stamp;
        fp[sx::F_WORK] = work;
        fp[sx::F_LEFT] = left;
        status
    }
}

// ------------------------------------------------------------------------------------------------ union (replay)
/// splatUnion for facilities [cursor, n) in list order (pool ranges given) while work < limit: D / served per facility
#[unsafe(no_mangle)]
pub unsafe extern "C" fn catch_union(ip: *mut i32, fp: *mut f64) -> i32 {
    unsafe {
        let ip = sm::<i32>(ip as i32, 24);
        let fp = sm::<f64>(fp as i32, 4);
        let nf = ip[ax::N_FAC] as usize;
        let c = ip[ax::C] as usize;
        let pool_cap = ip[ax::POOL_CAP] as usize;
        let fs = s::<i32>(ip[ax::FS], nf);
        let fe = s::<i32>(ip[ax::FE], nf);
        let strength = s::<f64>(ip[ax::STR], nf);
        let op = s::<f64>(ip[ax::OP], nf);
        let capv = s::<f64>(ip[ax::CAP], nf);
        let idx = s::<i32>(ip[ax::IDX], pool_cap);
        let pw = s::<f32>(ip[ax::W], pool_cap);
        let need = s::<f32>(ip[ax::NEED], c);
        let a = sm::<f32>(ip[ax::A], c);
        let cov = sm::<f32>(ip[ax::COV], c);
        let d_out = sm::<f64>(ip[ax::O1], nf);
        let served_out = sm::<f64>(ip[ax::O2], nf);
        let mut cursor = ip[ax::CURSOR] as usize;
        let mut work = fp[ax::F_WORK];
        let mut left = fp[ax::F_LEFT];
        let limit = fp[ax::F_LIMIT];
        let u_entry = fp[ax::F_UENTRY];
        while cursor < nf {
            let ci = cursor;
            let (q0, q1) = (fs[ci] as usize, fe[ci] as usize);
            let (d, sv) = splat_union(idx, pw, q0, q1, strength[ci], op[ci], capv[ci], need, a, cov);
            d_out[ci] = d;
            served_out[ci] = sv;
            let u = (q1 - q0) as f64 * u_entry * 2.0 + 8.0;
            work += u;
            left -= u;
            cursor += 1;
            if !(work < limit) {
                break;
            }
        }
        ip[ax::CURSOR] = cursor as i32;
        fp[ax::F_WORK] = work;
        fp[ax::F_LEFT] = left;
        0
    }
}

// ------------------------------------------------------------------------------------------------ P_ALLOC
/// allocSeats for facilities order[cursor..n) (seat order) while work < limit. Loop 1 caches e = min(u, a) per entry
/// (cells are unique within one reach, so loop 2 would recompute exactly the same e). Outputs per facility index c:
/// sig (O1), seated = D x sig (O2), D (O3); an empty reach keeps sig 1 / seated 0 (and costs 4 work units).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn catch_alloc(ip: *mut i32, fp: *mut f64) -> i32 {
    unsafe {
        let ip = sm::<i32>(ip as i32, 24);
        let fp = sm::<f64>(fp as i32, 4);
        let nf = ip[ax::N_FAC] as usize;
        let c = ip[ax::C] as usize;
        let pool_cap = ip[ax::POOL_CAP] as usize;
        let order = s::<i32>(ip[ax::ORDER], nf);
        let fs = s::<i32>(ip[ax::FS], nf);
        let fe = s::<i32>(ip[ax::FE], nf);
        let strength = s::<f64>(ip[ax::STR], nf);
        let op = s::<f64>(ip[ax::OP], nf);
        let capv = s::<f64>(ip[ax::CAP], nf);
        let idx = s::<i32>(ip[ax::IDX], pool_cap);
        let pw = s::<f32>(ip[ax::W], pool_cap);
        let need = s::<f32>(ip[ax::NEED], c);
        let u = sm::<f32>(ip[ax::U], c);
        let a_sum = sm::<f32>(ip[ax::A], c);
        let cov = sm::<f32>(ip[ax::COV], c);
        let sig_out = sm::<f64>(ip[ax::O1], nf);
        let seat_out = sm::<f64>(ip[ax::O2], nf);
        let d_out = sm::<f64>(ip[ax::O3], nf);
        let ec = sm::<f64>(ip[ax::EC], ip[ax::EC_CAP] as usize);
        let mut cursor = ip[ax::CURSOR] as usize;
        let mut work = fp[ax::F_WORK];
        let mut left = fp[ax::F_LEFT];
        let limit = fp[ax::F_LIMIT];
        let u_entry = fp[ax::F_UENTRY];
        while cursor < nf {
            let ci = order[cursor] as usize;
            cursor += 1;
            let (q0, q1) = (fs[ci], fe[ci]);
            sig_out[ci] = 1.0;
            seat_out[ci] = 0.0;
            let uw: f64;
            if q1 <= q0 {
                d_out[ci] = 0.0;
                uw = 4.0;
            } else {
                let (q0, q1) = (q0 as usize, q1 as usize);
                let m = q1 - q0;
                let sv = strength[ci];
                let ids = &idx[q0..q1];
                let ws = &pw[q0..q1];
                let e_ = &mut ec[..m];
                let mut d = 0.0f64;
                for j in 0..m {
                    let i = ids[j] as usize;
                    let a = ws[j] as f64 * sv;
                    let ap = cell_mut(a_sum, i);
                    *ap = (*ap as f64 + a) as f32;
                    let ui = cell(u, i) as f64;
                    let e = if ui < a { ui } else { a };
                    e_[j] = e;
                    d += cell(need, i) as f64 * e;
                }
                let cp = capv[ci];
                let sig = if cp < f64::INFINITY && d > cp { cp / d } else { 1.0 };
                let rho = sig * op[ci];
                if sig > 0.0 {
                    for j in 0..m {
                        let e = e_[j];
                        if !(e > 0.0) {
                            continue;
                        }
                        let i = ids[j] as usize;
                        let up = cell_mut(u, i);
                        let ui = *up as f64;
                        let lf = ui - e * sig;
                        *up = (if lf > 0.0 { lf } else { 0.0 }) as f32;
                        let cp = cell_mut(cov, i);
                        *cp = (*cp as f64 + e * rho) as f32;
                    }
                }
                sig_out[ci] = sig;
                seat_out[ci] = d * sig;
                d_out[ci] = d;
                uw = 2.0 * m as f64 * u_entry + 8.0;
            }
            work += uw;
            left -= uw;
            if !(work < limit) {
                break;
            }
        }
        ip[ax::CURSOR] = cursor as i32;
        fp[ax::F_WORK] = work;
        fp[ax::F_LEFT] = left;
        0
    }
}

// ------------------------------------------------------------------------------------------------ P_REPORT
/// reportDemand for facilities [cursor, n) in list order while work < limit: crowded facilities (sig < 1, non-empty
/// reach) get dem = seated + the need their reach leaves unseated by reach share (O3, flag in EC as u8)
#[unsafe(no_mangle)]
pub unsafe extern "C" fn catch_report(ip: *mut i32, fp: *mut f64) -> i32 {
    unsafe {
        let ip = sm::<i32>(ip as i32, 24);
        let fp = sm::<f64>(fp as i32, 4);
        let nf = ip[ax::N_FAC] as usize;
        let c = ip[ax::C] as usize;
        let pool_cap = ip[ax::POOL_CAP] as usize;
        let fs = s::<i32>(ip[ax::FS], nf);
        let fe = s::<i32>(ip[ax::FE], nf);
        let strength = s::<f64>(ip[ax::STR], nf);
        let idx = s::<i32>(ip[ax::IDX], pool_cap);
        let pw = s::<f32>(ip[ax::W], pool_cap);
        let need = s::<f32>(ip[ax::NEED], c);
        let u = s::<f32>(ip[ax::U], c);
        let a_sum = s::<f32>(ip[ax::A], c);
        let sig = s::<f64>(ip[ax::O1], nf);
        let seat = s::<f64>(ip[ax::O2], nf);
        let dem = sm::<f64>(ip[ax::O3], nf);
        let ok = sm::<u8>(ip[ax::EC], nf);
        let mut cursor = ip[ax::CURSOR] as usize;
        let mut work = fp[ax::F_WORK];
        let mut left_w = fp[ax::F_LEFT];
        let limit = fp[ax::F_LIMIT];
        let u_entry = fp[ax::F_UENTRY];
        while cursor < nf {
            let ci = cursor;
            cursor += 1;
            let (q0, q1) = (fs[ci], fe[ci]);
            let uw: f64;
            if q1 <= q0 || !(sig[ci] < 1.0) {
                ok[ci] = 0;
                uw = 2.0;
            } else {
                let (q0, q1) = (q0 as usize, q1 as usize);
                let sv = strength[ci];
                let ids = &idx[q0..q1];
                let ws = &pw[q0..q1];
                let mut lf = 0.0f64;
                for j in 0..ids.len() {
                    let i = ids[j] as usize;
                    let nv = cell(need, i) as f64;
                    if !(nv > 0.0) {
                        continue;
                    }
                    let ui = cell(u, i) as f64;
                    if !(ui > 0.0) {
                        continue;
                    }
                    let a = ws[j] as f64 * sv;
                    let ai = cell(a_sum, i) as f64;
                    lf += nv * (if ui < a { ui } else { a }) * (if ai > a { a / ai } else { 1.0 });
                }
                dem[ci] = seat[ci] + lf;
                ok[ci] = 1;
                uw = (q1 - q0) as f64 * u_entry + 8.0;
            }
            work += uw;
            left_w -= uw;
            if !(work < limit) {
                break;
            }
        }
        ip[ax::CURSOR] = cursor as i32;
        fp[ax::F_WORK] = work;
        fp[ax::F_LEFT] = left_w;
        0
    }
}

// ------------------------------------------------------------------------------------------------ P_FINAL
/// finalizeTier: layer = min(cov, 1); unless transit: need / served / unreached sums (cells with !(n <= 0)) -> fp[0..3)
#[unsafe(no_mangle)]
pub unsafe extern "C" fn catch_finalize(ip: *mut i32, fp: *mut f64) -> i32 {
    unsafe {
        let ip = sm::<i32>(ip as i32, 8);
        let fp = sm::<f64>(fp as i32, 4);
        let c = ip[0] as usize;
        let cov = s::<f32>(ip[1], c);
        let layer = sm::<f32>(ip[2], c);
        for i in 0..c {
            let v = cov[i];
            layer[i] = if v < 1.0 { v } else { 1.0 };
        }
        if ip[3] != 0 {
            return 0;
        }
        let need = s::<f32>(ip[4], c);
        let a = s::<f32>(ip[5], c);
        let (mut nsum, mut served, mut unreached) = (0.0f64, 0.0f64, 0.0f64);
        for i in 0..c {
            let n = need[i] as f64;
            if n <= 0.0 {
                continue;
            }
            nsum += n;
            served += n * layer[i] as f64;
            if a[i] <= 0.0 {
                unreached += n;
            }
        }
        fp[0] = nsum;
        fp[1] = served;
        fp[2] = unreached;
        0
    }
}

// ------------------------------------------------------------------------------------------------ transit stops
/// computeTransitCoverage (transit.ts) into tmp, then finishTransit's combine into T: T = 1 - (1 - T)(1 - min(1, t))
/// where t > 0. Per stop (computed in JS from the live stop rules): centre cell, integer radius R, strength factor
/// (Bus 0.75, else 1: strength = factor x funding) and a skip flag (def coverage / not serving).
/// ip: 0 N, 1 nStops, 2 cell i32[], 3 R i32[], 4 factor f64[], 5 skip u8[], 6 tmp f32[C], 7 T f32[C]; fp: 0 funding
#[unsafe(no_mangle)]
pub unsafe extern "C" fn catch_transit_cov(ip: *mut i32, fp: *mut f64) -> i32 {
    unsafe {
        let ip = sm::<i32>(ip as i32, 8);
        let fp = sm::<f64>(fp as i32, 2);
        let n = ip[0] as i64;
        let c = (n * n) as usize;
        let ns = ip[1] as usize;
        let cell = s::<i32>(ip[2], ns);
        let rr = s::<i32>(ip[3], ns);
        let fac = s::<f64>(ip[4], ns);
        let skip = s::<u8>(ip[5], ns);
        let out = sm::<f32>(ip[6], c);
        let tt = sm::<f32>(ip[7], c);
        let funding = fp[0];
        out.fill(0.0);
        for st in 0..ns {
            if skip[st] != 0 {
                continue;
            }
            let r = rr[st] as i64;
            let ci = cell[st] as i64;
            let cx = ci % n;
            let cz = (ci - cx) / n;
            let rh = r as f64 + 0.5;
            let r2 = rh * rh;
            let strength = fac[st] * funding;
            let za = if cz - r > 0 { cz - r } else { 0 };
            let zb = if cz + r < n - 1 { cz + r } else { n - 1 };
            let xa = if cx - r > 0 { cx - r } else { 0 };
            let xb = if cx + r < n - 1 { cx + r } else { n - 1 };
            let mut z = za;
            while z <= zb {
                let dz = (z - cz) as f64;
                let row = (z * n) as usize;
                let mut x = xa;
                while x <= xb {
                    let dx = (x - cx) as f64;
                    let d2 = dx * dx + dz * dz;
                    if !(d2 > r2) {
                        let d = sqrt(d2) / rh;
                        let v = strength * (1.0 - d * d * 0.7);
                        let i = row + x as usize;
                        let cur = out[i] as f64;
                        out[i] = (cur + v * (1.0 - cur)) as f32;
                    }
                    x += 1;
                }
                z += 1;
            }
        }
        for i in 0..c {
            let t = out[i];
            if t > 0.0 {
                let t = t as f64;
                let m = if t < 1.0 { t } else { 1.0 };
                tt[i] = (1.0 - (1.0 - tt[i] as f64) * (1.0 - m)) as f32;
            }
        }
        0
    }
}

// ------------------------------------------------------------------------------------------------ footprints
/// uniform coverage over multi-cell building footprints: per layer (independent), per building in list order, the
/// max over the clipped footprint (starting at 0), then fill. ip: 0 N, 1 nB, 2 boxes i32[4nB] (x, z, w, d),
/// 3 nL, 4 layer pointers i32[nL]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn catch_footprints(ip: *mut i32) -> i32 {
    unsafe {
        let ip = sm::<i32>(ip as i32, 8);
        let n = ip[0] as i64;
        let c = (n * n) as usize;
        let nb = ip[1] as usize;
        let boxes = s::<i32>(ip[2], 4 * nb);
        let nl = ip[3] as usize;
        let lp = s::<i32>(ip[4], nl);
        for l in 0..nl {
            let layer = sm::<f32>(lp[l], c);
            for q in 0..nb {
                let (bx, bz, bw, bd) = (boxes[4 * q] as i64, boxes[4 * q + 1] as i64, boxes[4 * q + 2] as i64, boxes[4 * q + 3] as i64);
                let x0 = if bx > 0 { bx } else { 0 };
                let z0 = if bz > 0 { bz } else { 0 };
                let x1 = if bx + bw < n { bx + bw } else { n };
                let z1 = if bz + bd < n { bz + bd } else { n };
                if x0 >= x1 || z0 >= z1 {
                    continue;
                }
                let (x0, x1) = (x0 as usize, x1 as usize);
                let nu = n as usize;
                let mut m = 0.0f32;
                for z in z0 as usize..z1 as usize {
                    let row = &layer[z * nu + x0..z * nu + x1];
                    for &v in row {
                        if v > m {
                            m = v;
                        }
                    }
                }
                for z in z0 as usize..z1 as usize {
                    layer[z * nu + x0..z * nu + x1].fill(m);
                }
            }
        }
        0
    }
}

// ------------------------------------------------------------------------------------------------ finish: legacy combos
/// eduCov = min(1, we E + wh H + wc K), parkCov = 1 - (1 - P)(1 - G). ip: 0 C, 1 E, 2 H, 3 K, 4 P, 5 G, 6 edu, 7 park;
/// fp: we, wh, wc
#[unsafe(no_mangle)]
pub unsafe extern "C" fn catch_combo(ip: *mut i32, fp: *mut f64) -> i32 {
    unsafe {
        let ip = sm::<i32>(ip as i32, 8);
        let fp = sm::<f64>(fp as i32, 3);
        let c = ip[0] as usize;
        let e_ = s::<f32>(ip[1], c);
        let h_ = s::<f32>(ip[2], c);
        let k_ = s::<f32>(ip[3], c);
        let p_ = s::<f32>(ip[4], c);
        let g_ = s::<f32>(ip[5], c);
        let edu = sm::<f32>(ip[6], c);
        let park = sm::<f32>(ip[7], c);
        let (we, wh, wc) = (fp[0], fp[1], fp[2]);
        for i in 0..c {
            let e = we * e_[i] as f64 + wh * h_[i] as f64 + wc * k_[i] as f64;
            edu[i] = (if e < 1.0 { e } else { 1.0 }) as f32;
            park[i] = (1.0 - (1.0 - p_[i] as f64) * (1.0 - g_[i] as f64)) as f32;
        }
        0
    }
}

// ------------------------------------------------------------------------------------------------ access fields
/// two-pass 4-neighbour chamfer over non-road cells (services.ts chamfer): road cells (net 1..5) keep their value
#[inline]
fn chamfer(v: &mut [f32], n: usize, net: &[u8], step: f64, inf: f64) {
    let road = |t: u8| t >= 1 && t <= 5;
    for z in 0..n {
        let row = z * n;
        for x in 0..n {
            let i = row + x;
            if road(net[i]) {
                continue;
            }
            let mut m = v[i] as f64;
            if x > 0 {
                let a = v[i - 1] as f64 + step;
                if a < m {
                    m = a;
                }
            }
            if z > 0 {
                let a = v[i - n] as f64 + step;
                if a < m {
                    m = a;
                }
            }
            if x < n - 1 && road(net[i + 1]) {
                let a = v[i + 1] as f64 + step;
                if a < m {
                    m = a;
                }
            }
            if z < n - 1 && road(net[i + n]) {
                let a = v[i + n] as f64 + step;
                if a < m {
                    m = a;
                }
            }
            v[i] = (if m < inf { m } else { inf }) as f32;
        }
    }
    for z in (0..n).rev() {
        let row = z * n;
        for x in (0..n).rev() {
            let i = row + x;
            if road(net[i]) {
                continue;
            }
            let mut m = v[i] as f64;
            if x < n - 1 {
                let a = v[i + 1] as f64 + step;
                if a < m {
                    m = a;
                }
            }
            if z < n - 1 {
                let a = v[i + n] as f64 + step;
                if a < m {
                    m = a;
                }
            }
            v[i] = (if m < inf { m } else { inf }) as f32;
        }
    }
}

/// accessCommuteLand / shopLand numeric part: v = (road cell with dist >= 0 ? dist x scale : INF), chamfer; when
/// out != 0 also out = (v < INF / 2 ? v : unreached). ip: 0 N, 1 net u8[C], 2 dist i32[C], 3 v f32[C], 4 out f32[C]
/// (0 = none), 5 scaled (1: dist x fp[0], 0: dist as is); fp: 0 scale, 1 step, 2 inf, 3 unreached
#[unsafe(no_mangle)]
pub unsafe extern "C" fn catch_access_land(ip: *mut i32, fp: *mut f64) -> i32 {
    unsafe {
        let ip = sm::<i32>(ip as i32, 8);
        let fp = sm::<f64>(fp as i32, 4);
        let n = ip[0] as usize;
        let c = n * n;
        let net = s::<u8>(ip[1], c);
        let dist = s::<i32>(ip[2], c);
        let v = sm::<f32>(ip[3], c);
        let scaled = ip[5] != 0;
        let (scale, step, inf, unreached) = (fp[0], fp[1], fp[2], fp[3]);
        let inf32 = inf as f32;
        for i in 0..c {
            let t = net[i];
            v[i] = if t >= 1 && t <= 5 && dist[i] >= 0 {
                if scaled { (dist[i] as f64 * scale) as f32 } else { dist[i] as f32 }
            } else {
                inf32
            };
        }
        chamfer(v, n, net, step, inf);
        if ip[4] != 0 {
            let out = sm::<f32>(ip[4], c);
            let half = inf * 0.5;
            let un = unreached as f32;
            for i in 0..c {
                out[i] = if (v[i] as f64) < half { v[i] } else { un };
            }
        }
        0
    }
}

/// services.ts box3: 3x3 box blur on an n x n grid in place (zero boundary). ip: 0 n, 1 a f32[n²], 2 tmp f32[n²]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn catch_box3(ip: *mut i32) -> i32 {
    unsafe {
        let ip = sm::<i32>(ip as i32, 4);
        let n = ip[0] as usize;
        let a = sm::<f32>(ip[1], n * n);
        let t = sm::<f32>(ip[2], n * n);
        for z in 0..n {
            for x in 0..n {
                let i = z * n + x;
                let mut sum = a[i] as f64;
                if x > 0 {
                    sum += a[i - 1] as f64;
                }
                if x < n - 1 {
                    sum += a[i + 1] as f64;
                }
                t[i] = (sum / 3.0) as f32;
            }
        }
        for z in 0..n {
            for x in 0..n {
                let i = z * n + x;
                let mut sum = t[i] as f64;
                if z > 0 {
                    sum += t[i - n] as f64;
                }
                if z < n - 1 {
                    sum += t[i + n] as f64;
                }
                a[i] = (sum / 3.0) as f32;
            }
        }
        0
    }
}

/// shopLand block sums: pop[(z / B | 0) nb + (x / B | 0)] += res (res > 0), row-major. ip: 0 N, 1 B, 2 nb, 3 res, 4 pop
#[unsafe(no_mangle)]
pub unsafe extern "C" fn catch_block_sum(ip: *mut i32) -> i32 {
    unsafe {
        let ip = sm::<i32>(ip as i32, 8);
        let n = ip[0] as usize;
        let b = ip[1] as usize;
        let nb = ip[2] as usize;
        let res = s::<f32>(ip[3], n * n);
        let pop = sm::<f32>(ip[4], nb * nb);
        for z in 0..n {
            let bz = z / b;
            for x in 0..n {
                let r = res[z * n + x];
                if r > 0.0 {
                    let q = bz * nb + x / b;
                    pop[q] = (pop[q] as f64 + r as f64) as f32;
                }
            }
        }
        0
    }
}

/// shopLand main loop: out = lut[q | 0] x (base + (1 - base) r) with r the bilinear tap of the coarse ratio grid;
/// out = 0 where !(q <= capQ). ip: 0 N, 1 nb, 2 B, 3 v f32[C], 4 ratio f32[nb²], 5 lut f32[], 6 lut len, 7 cx0 i32[N],
/// 8 cx1 i32[N], 9 ct f32[N], 10 out f32[C]; fp: 0 capQ, 1 base
#[unsafe(no_mangle)]
pub unsafe extern "C" fn catch_shop_taps(ip: *mut i32, fp: *mut f64) -> i32 {
    unsafe {
        let ip = sm::<i32>(ip as i32, 12);
        let fp = sm::<f64>(fp as i32, 2);
        let n = ip[0] as usize;
        let nb = ip[1] as usize;
        let bsz = ip[2] as f64;
        let c = n * n;
        let v = s::<f32>(ip[3], c);
        let ratio = s::<f32>(ip[4], nb * nb);
        let lut = s::<f32>(ip[5], ip[6] as usize);
        let cx0 = s::<i32>(ip[7], n);
        let cx1 = s::<i32>(ip[8], n);
        let ct = s::<f32>(ip[9], n);
        let out = sm::<f32>(ip[10], c);
        let cap_q = fp[0];
        let base = fp[1];
        let nbm1 = (nb - 1) as f64;
        for z in 0..n {
            let fz = js_min(nbm1, js_max(0.0, (z as f64 + 0.5) / bsz - 0.5));
            let z0 = floor(fz);
            let tz = fz - z0;
            let z0i = z0 as usize;
            let r0 = z0i * nb;
            let r1 = (if z0i + 1 < nb - 1 { z0i + 1 } else { nb - 1 }) * nb;
            let row = z * n;
            for x in 0..n {
                let i = row + x;
                let q = v[i] as f64;
                if !(q <= cap_q) {
                    out[i] = 0.0;
                    continue;
                }
                let tx = ct[x] as f64;
                let a = cx0[x] as usize;
                let cc = cx1[x] as usize;
                let ra = ratio[r0 + a] as f64;
                let rb = ratio[r1 + a] as f64;
                let r = (ra + (ratio[r0 + cc] as f64 - ra) * tx) * (1.0 - tz) + (rb + (ratio[r1 + cc] as f64 - rb) * tx) * tz;
                // q | 0 (ToInt32 of a value <= capQ): truncation; a negative index reads undefined in JS -> NaN
                let qi = q as i64;
                let lv = if qi >= 0 && (qi as usize) < lut.len() { lut[qi as usize] as f64 } else { f64::NAN };
                out[i] = (lv * (base + (1.0 - base) * r)) as f32;
            }
        }
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_max_min_semantics() {
        assert_eq!(js_max(0.0, -0.0).to_bits(), 0);
        assert_eq!(js_max(-0.0, 0.0).to_bits(), 0);
        assert_eq!(js_min(0.0, -0.0).to_bits(), (-0.0f64).to_bits());
        assert!(js_max(f64::NAN, 1.0).is_nan());
        assert!(js_min(1.0, f64::NAN).is_nan());
        assert_eq!(js_max(3.0, 5.0), 5.0);
        assert_eq!(js_min(3.0, 5.0), 3.0);
        assert_eq!(ceil(-0.5).to_bits(), (-0.0f64).to_bits());
        assert_eq!(ceil(2.1), 3.0);
    }

    #[test]
    fn hypot_shortcuts() {
        assert_eq!(v8_hypot2(0.0, 0.0), 0.0);
        assert_eq!(v8_hypot2(f64::NAN, f64::INFINITY), f64::INFINITY);
        assert!(v8_hypot2(f64::NAN, 1.0).is_nan());
        assert_eq!(v8_hypot2(3.0, 4.0), 5.0);
        assert_eq!(v8_hypot2(-3.0, 0.0), 3.0);
    }

    #[test]
    fn falloff_shape() {
        assert_eq!(falloff(0.0, 10.0), 1.0);
        assert_eq!(falloff(3.5, 10.0), 1.0);
        assert_eq!(falloff(10.0, 10.0), 0.0);
        let m = falloff(6.75, 10.0);
        assert!(m > 0.49 && m < 0.51);
    }
}
