//! Traffic core: port of the numeric phases of TrafficSystem (src/sim/infra/traffic.ts at commit 24f8609, the frozen
//! copy the profiler's 1M fixtures were saved with). Binding: src/wasm/kernels/trafficBind.ts; the restructured JS
//! twin with the same algorithm and data layout (the fair A/B control) is src/wasm/js/trafficCore.ts.
//!
//! Ported (everything numeric between the JS parts):
//!  * prep: BPR node times, volume resets, the regional sums and the per-cycle origin initialisation, buildClusters
//!  * prepTransit: stop x / z (precomputed exactly: cell % N, (cell - x) / N), the 8x8 stop bins, the transfer CSR,
//!    bus times
//!  * transit: seed construction, transitSearch (search.rs, called in place), originTransit (nearStops inside)
//!  * roundSearch (seeds + roadSearch), roundMatch (candidates, LSD radix sort of the packed keys, round-0 proposals,
//!    the accept loop with the logit mode split, flows accumulated into volNew, the first 256 car pieces for sampling)
//!  * commuteEnd incl. poolRemaining (shadow prices, cluster -> site distribution, transit forest with the stop sink,
//!    per-origin outputs, trip statistics)
//!  * the numeric bodies of inbound / shopping / freight (their road searches run in here too), cached volumes
//!  * finalize: MSA blend, traffic / congestion / rail layers, subway riders, the avgTraffic sums
//! Stays JS (trafficBind.ts driver): the building walk, collectStops / stop attachment (Building objects), every RNG
//! draw (jNoise, route sampling), tracePath and the sample routes, per-building-id arrays (priceById, inboundById,
//! freightById: gathered / scattered by the driver), the round control flow, stLoadPrev, stats, finalize2.
//!
//! Context: one block in linear memory, [F: f64 x F::COUNT][U: u32 x U::COUNT]. U holds counts, capacities and the
//! byte offset of every array (all arrays live in wasm memory: the JS TrafficSystem fields are views of them); F holds
//! the tuning constants (passed in from params.ts, never hard-coded here), per-call scalars and the outputs. The slot
//! names are exported (`traffic_names`) so the binding builds its table from this file.
//!
//! Bit-exactness (checked against the JS original by tests/wasm/trafficCore.test.ts):
//!  * f64 arithmetic in the JS evaluation order; `as f32` exactly where JS stores into a Float32Array (a single
//!    + - * / of two f32 values may stay in f32); f64 accumulations in the JS loop order.
//!  * Math.max / Math.min with their NaN / -0 semantics, Math.floor exact (math.rs), Math.sqrt = f64.sqrt,
//!    Math.exp / Math.log = the engine's own functions, imported (env.js_exp / env.js_log: see below).
//!  * the candidate sort: the JS packs key = floor(max(0, g) * q) * M + o into a Float64Array and sorts it. Those keys
//!    are distinct integers < 2^50 and o ascends in candidate order, so a STABLE sort of the candidates by
//!    k = floor(max(0, g) * q) yields exactly the JS order: an LSD radix sort (11-bit digits) on k. A non-finite or
//!    negative k (only reachable with NaN inputs) makes the kernel return -2 before any state changed: the binding then
//!    runs the JS phase.
//! Kernels never allocate and never grow memory: every buffer is sized by the binding; when one is too small the kernel
//! returns BEFORE changing any state, with the required size in U::outNeed: -1 seeds (class SD), -5 bucket-queue
//! entries (QE), -7 transfer edges (E), -8 stop bins (G); the binding grows the arena and calls again. Other codes:
//! -2 input outside the supported domain (the binding runs the JS kernel on the same arrays), -3 invalid transit net,
//! -4 search capacity (binding bug), -6 counts beyond capacities (binding bug).

#![allow(non_camel_case_types, non_snake_case, unexpected_cfgs, clippy::too_many_arguments, clippy::needless_range_loop)]

use crate::math::floor;
use crate::search::{Out, RoadIn, SeedList, TransitIn, road_search, transit_search};

/// bump when the context layout or an export changes (trafficBind.ts TRAFFIC_LAYOUT)
pub const LAYOUT: u32 = 1;

// ------------------------------------------------------------------------------------------------ JS Math
unsafe extern "C" {
    // compiler-builtins' libm symbol: LLVM lowers it to f64.sqrt (correctly rounded, = Math.sqrt), no import
    #[link_name = "sqrt"]
    fn libm_sqrt(x: f64) -> f64;
}
#[inline(always)]
fn sqrt(x: f64) -> f64 {
    unsafe { libm_sqrt(x) }
}

// Math.exp / Math.log are the ENGINE'S OWN functions, imported: env.js_exp = Math.exp, env.js_log = Math.log (the loader
// passes src/wasm/simWasm.ts simWasmImports() to every instantiation). The kernels therefore compute exactly what the JS
// original computes on every engine, by construction (V8, SpiderMonkey and JavaScriptCore each call their own libm).
// Cost: tools/bench/trafficCore/micro.ts (logit) and the in-situ arm `wasm-fdlibm` (a benchmark-only build with
// `--cfg traffic_inline_math`, which inlines fdlibm.rs = V8's algorithm instead: exact on V8 only).
#[cfg(all(target_arch = "wasm32", not(traffic_inline_math)))]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn js_exp(x: f64) -> f64;
    fn js_log(x: f64) -> f64;
}
#[cfg(all(target_arch = "wasm32", not(traffic_inline_math)))]
#[inline(always)]
fn exp(x: f64) -> f64 {
    unsafe { js_exp(x) }
}
#[cfg(all(target_arch = "wasm32", not(traffic_inline_math)))]
#[inline(always)]
fn log(x: f64) -> f64 {
    unsafe { js_log(x) }
}
// host builds (cargo test) and the benchmark-only inline build: fdlibm, V8's algorithm
#[cfg(any(not(target_arch = "wasm32"), traffic_inline_math))]
#[inline(always)]
fn exp(x: f64) -> f64 {
    crate::fdlibm::exp(x)
}
#[cfg(any(not(target_arch = "wasm32"), traffic_inline_math))]
#[inline(always)]
fn log(x: f64) -> f64 {
    crate::fdlibm::log(x)
}

const INF: f64 = f64::INFINITY;
const NEG_INF: f64 = f64::NEG_INFINITY;

/// `u > -Infinity ? Math.exp(u - um) : 0` of the mode split, skipping the call for the maximum utility itself:
/// u - um is then +0 and exp(+-0) = 1 exactly (every engine: IEEE 754 / ECMA-262 Math.exp(+-0) is 1); NaN /
/// infinite utilities take the full path
#[inline(always)]
fn share_exp(u: f64, um: f64) -> f64 {
    if u > NEG_INF { if u == um && u < INF { 1.0 } else { exp(u - um) } } else { 0.0 }
}

/// `Math.max(a, b)`: NaN if either is NaN, +0 beats -0
#[inline(always)]
pub fn js_max(a: f64, b: f64) -> f64 {
    if a != a || b != b {
        return f64::NAN;
    }
    if a == b {
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

// ------------------------------------------------------------------------------------------------ context layout
macro_rules! slots {
    ($en:ident, $names:ident; $($n:ident),* $(,)?) => {
        /// context slot indices (see the module comment)
        #[derive(Copy, Clone)]
        #[repr(u32)]
        pub enum $en { $($n,)* COUNT }
        /// slot names in index order, space separated (read by the binding through `traffic_names`)
        pub static $names: &str = concat!($(stringify!($n), " "),*);
    };
}

slots!(F, F_NAMES;
    // tuning constants (params.ts, set once by the binding)
    bprAlpha, bprMax, busTimeFactor, stopWalkT, priceMax, maxCommute, carOverhead, walkT, modeBeta,
    carBias0, carBias1, carBias2, trBias0, trBias1, trBias2, walkBias, busPcu, stepMin, stepRel, regionalTime, regionalFill,
    cw0, cw1, cw2, cw3, cw4, cw5, cw6, invCarOcc, shopPcu, shopTrips, truckPcu, railCap,
    limTransit, limRound, limInbound, limShop, limFreight, invQ, invQT, rampPen, railTime, subTime,
    // per cycle / per call
    propFactor, carPcu, trBonus, alpha, growth, regionWorkerCap,
    // outputs
    out0, out1, out2, out3, out4, out5, out6, out7,
);

slots!(U, U_NAMES;
    // counts
    n, nRail, nSub, total, mapN, cells, nComp, oN, jN, jB, sN, fN, kN, qN, stopN, binN, entN, nTr,
    saSettled, stSettled, sbSettled,
    // integer constants
    hw, street, rail, stopR, walkMax, propRounds, headLen,
    // capacities (elements) of the arena classes
    capN, capT, capRail, capSub, capO, capJ, capQ, capS, capF, capK, capStop, capAtt, capBin, capTr, capEnt, capSeed,
    capComp, capQent, capCells,
    // outputs
    outNc, outRoutes, outCand, outNeed, outStatus,
    // ---- arrays (byte offsets) ----
    // road graph copies (per graph version) and rail / subway graphs
    rev, fwd, typ, cellOf, cap, t0, comp, railAdj, railCellOf, subAdj, subCellOf,
    // city layers (resident or staged)
    traffic, congestion, network, subwayRiders,
    // per road node
    nodeTime, volNew, acc, busTime, volInbound, volShop, volFreight, nodeQ,
    // per transit node
    tAcc, nodeStop, trStart,
    railNew, subNew,
    // searches SA (rounds), ST (transit), SB (inbound / shop / freight)
    saDist, saSrc, saNext, saOrder, saHops, saDone,
    stDist, stSrc, stNext, stOrder, stHops, stDone,
    sbDist, sbSrc, sbNext, sbOrder, sbHops, sbDone,
    // bucket queue scratch, seeds
    head, qent, seedNode, seedLabel, seedId,
    // origins
    oBid, oW, oPop, oWealth, oEntS, oEntC, oCell, oHalf, oCarNode, oBoard, oShC, oShT, oShW, oTime, oEmp, oJobT,
    oU, oAsg, oTimeSum, oCarW, oTrW, oWalkW, oTrT, oBoardStop, oLastD, candNode, sortA, sortB, keyA, keyB,
    // job sites
    jBid, jSlots, jNoise, jAsg, jCapP, jPrice, jQ, jBase, jEntS, jEntC, jCell, jHalf, jRailNode, jConnType, jTimeSum,
    jInbound, jTmp, desire, bestNode, inCand, conns, scale, connSum,
    // job clusters
    qNode, qSlots, qCapP, qAsg, qPrice, qProp, qBase, qNoise, qTimeSum,
    // shops, freight sources, freight sinks
    sBid, sEntS, sEntC, sLoad,
    fBid, fTrucks, fEntS, fEntC, fAcc, fNode,
    kEntS, kEntC, kLabel,
    // stops
    stCell, stX, stZ, stMode, stAttS, stAttC, stAtt, stWait, stLoad, stopBins, stopBinStart, binFill, nsIdx, nsDist,
    trTo, trCost, trEFrom, trETo, trECost,
    // shared entry nodes, pool scratch, radix histograms, sampled car pieces
    ent, poolU, poolO, hist, routeCand, routeW,
);

/// radix digit width of the candidate sort
const RADIX_BITS: u32 = 11;
const RADIX: usize = 1 << RADIX_BITS;
/// histogram rows (50-bit keys / 11 bits -> 5 passes)
pub const HIST_ROWS: usize = 5;
/// sampled car pieces per round (traffic.ts routeCand)
pub const ROUTE_MAX: usize = 256;

/// the context: raw pointers to its two blocks
#[derive(Copy, Clone)]
struct Cx {
    f: *mut f64,
    u: *mut u32,
}

impl Cx {
    unsafe fn new(ctx: *mut u8) -> Cx {
        Cx { f: ctx as *mut f64, u: unsafe { ctx.add(8 * F::COUNT as usize) } as *mut u32 }
    }
    #[inline(always)]
    fn w(&self, i: U) -> u32 {
        unsafe { *self.u.add(i as usize) }
    }
    /// a count / capacity (>= 0, checked by `valid_counts`)
    #[inline(always)]
    fn n(&self, i: U) -> usize {
        self.w(i) as usize
    }
    #[inline(always)]
    fn i(&self, i: U) -> i32 {
        self.w(i) as i32
    }
    #[inline(always)]
    fn set(&self, i: U, v: i32) {
        unsafe { *self.u.add(i as usize) = v as u32 }
    }
    #[inline(always)]
    fn f(&self, i: F) -> f64 {
        unsafe { *self.f.add(i as usize) }
    }
    #[inline(always)]
    fn setf(&self, i: F, v: f64) {
        unsafe { *self.f.add(i as usize) = v }
    }
    /// array `i` as a slice of `len` elements. The binding guarantees non-null, aligned blocks of the class capacity;
    /// callers only request lengths <= that capacity (validated counts) and never hold two &mut to one array.
    #[inline(always)]
    fn sl<'a, T>(&self, i: U, len: usize) -> &'a mut [T] {
        unsafe { core::slice::from_raw_parts_mut(self.w(i) as usize as *mut T, len) }
    }
}

/// every count within its capacity: 0, or the number (1-based) of the first violated condition (a binding bug; the
/// exports then return -6 and `traffic_counts_check` names the condition)
fn counts_check(c: &Cx) -> i32 {
    let le = |a: U, b: U| c.i(a) >= 0 && c.i(a) <= c.i(b);
    let conds = [
        le(U::n, U::capN),
        le(U::total, U::capT),
        c.n(U::total) >= c.n(U::n) + c.n(U::nRail) + c.n(U::nSub),
        le(U::nRail, U::capRail),
        le(U::nSub, U::capSub),
        le(U::oN, U::capO),
        le(U::jN, U::capJ),
        c.i(U::jB) >= 0 && c.n(U::jB) <= c.n(U::jN),
        c.n(U::jN) < c.n(U::capQ),
        le(U::qN, U::capQ),
        le(U::sN, U::capS),
        le(U::fN, U::capF),
        le(U::kN, U::capK),
        c.i(U::stopN) >= 0 && c.n(U::stopN) < c.n(U::capStop),
        le(U::entN, U::capEnt),
        le(U::nComp, U::capComp),
        le(U::nTr, U::capTr),
        c.i(U::cells) >= 0 && c.n(U::cells) <= c.n(U::capCells),
        c.i(U::mapN) >= 0,
        // settled counts against the CAPACITIES, not the current n / total: after a road / rail / subway shrink the
        // last searches' counts are legally stale (> n) until the next search runs, exactly as in the JS (traffic.ts
        // keeps S.settled). Kernels that READ a settled count require it to be fresh (<= n / total) themselves.
        c.i(U::saSettled) >= 0 && c.n(U::saSettled) <= c.n(U::capN),
        c.i(U::sbSettled) >= 0 && c.n(U::sbSettled) <= c.n(U::capN),
        c.i(U::stSettled) >= 0 && c.n(U::stSettled) <= c.n(U::capT),
    ];
    for (i, ok) in conds.iter().enumerate() {
        if !ok {
            return i as i32 + 1;
        }
    }
    0
}

fn valid_counts(c: &Cx) -> bool {
    counts_check(c) == 0
}

// ------------------------------------------------------------------------------------------------ small helpers
/// the search arrays of SA / ST / SB as a search.rs Out
fn search_out<'a>(c: &Cx, which: u8, len: usize) -> Out<'a> {
    let (d, s, nx, o, h, dn) = match which {
        0 => (U::saDist, U::saSrc, U::saNext, U::saOrder, U::saHops, U::saDone),
        1 => (U::stDist, U::stSrc, U::stNext, U::stOrder, U::stHops, U::stDone),
        _ => (U::sbDist, U::sbSrc, U::sbNext, U::sbOrder, U::sbHops, U::sbDone),
    };
    Out { dist: c.sl(d, len), src: c.sl(s, len), next: c.sl(nx, len), hops: c.sl(h, len), order: c.sl(o, len), done: c.sl(dn, len) }
}

/// roadSearch(g, adj, nodeTime, S, heap, seeds[0, ns), limit) into search `which`; returns S.settled or < 0
fn run_road_search(c: &Cx, fwd: bool, which: u8, ns: usize, limit: f64) -> i32 {
    let n = c.n(U::n);
    let need = 2 * (ns + 4 * n) + 16;
    if need > c.n(U::capQent) {
        c.set(U::outNeed, need as i32);
        return -5;
    }
    let g = RoadIn {
        adj: c.sl::<i32>(if fwd { U::fwd } else { U::rev }, 4 * n),
        time: c.sl::<f32>(U::nodeTime, n),
        typ: c.sl::<u8>(U::typ, n),
        hw: c.w(U::hw) as u8,
        ramp: &[],
        ramp_pen: c.f(F::rampPen),
    };
    let seeds = SeedList { node: c.sl(U::seedNode, ns), label: c.sl(U::seedLabel, ns), id: c.sl(U::seedId, ns) };
    let mut o = search_out(c, which, n);
    let r = road_search(n, &g, &seeds, limit, c.f(F::invQ), &mut o, c.sl(U::head, c.n(U::headLen)), c.sl(U::qent, c.n(U::capQent)));
    if r < 0 {
        c.set(U::outNeed, 0);
        return -4;
    }
    c.set(if which == 0 { U::saSettled } else { U::sbSettled }, r);
    r
}

/// accumulate(S, acc) (no sink) over `settled` nodes, then volNew[v] += acc[v] for the settled nodes. `reset`:
/// roundMatch / poolRemaining form (only f != 0, acc[v] = 0 after); otherwise the inbound / shop / freight form
/// (always add; `cache[v] = acc[v]`).
fn flows_into_vol(c: &Cx, which: u8, reset: bool, cache: Option<U>) {
    let n = c.n(U::n);
    let (settled, order, next) = match which {
        0 => (c.n(U::saSettled), c.sl::<i32>(U::saOrder, n), c.sl::<i32>(U::saNext, n)),
        _ => (c.n(U::sbSettled), c.sl::<i32>(U::sbOrder, n), c.sl::<i32>(U::sbNext, n)),
    };
    let acc = c.sl::<f32>(U::acc, n);
    let vol = c.sl::<f32>(U::volNew, n);
    for k in (0..settled).rev() {
        let v = order[k] as usize;
        let f = acc[v];
        if f == 0.0 {
            continue;
        }
        let nx = next[v];
        if nx >= 0 {
            // one f32 + f32 add rounded to f32 == JS acc[nx] += f
            acc[nx as usize] += f;
        }
    }
    if reset {
        for k in 0..settled {
            let v = order[k] as usize;
            let f = acc[v];
            if f != 0.0 {
                vol[v] += f;
                acc[v] = 0.0;
            }
        }
    } else {
        let cache = c.sl::<f32>(cache.unwrap_or(U::volShop), n);
        for k in 0..settled {
            let v = order[k] as usize;
            vol[v] += acc[v];
            cache[v] = acc[v];
        }
    }
}

/// open capacity of cluster q: (round < MATCH_PROP_ROUNDS ? qCapP : qSlots) - qAsg
#[inline(always)]
fn open_cap(prop: bool, cap_p: &[f32], slots: &[f32], asg: &[f32], q: usize) -> f64 {
    (if prop { cap_p[q] } else { slots[q] }) as f64 - asg[q] as f64
}

/// the best done entry node of an entity (strict <, entries in order): (node, dist) or (-1, inf)
#[inline(always)]
fn best_entry(ent: &[i32], s: usize, cnt: usize, done: &[u8], dist: &[f64]) -> (i32, f64) {
    let mut best = -1i32;
    let mut bd = INF;
    for e in s..s + cnt {
        let v = ent[e] as usize;
        if done[v] == 1 && dist[v] < bd {
            bd = dist[v];
            best = v as i32;
        }
    }
    (best, bd)
}

/// the bias tables: JS `CAR_BIAS[wl]` (undefined -> NaN outside 0..2)
#[inline(always)]
fn bias(c: &Cx, base: F, wl: i32) -> f64 {
    if (0..3).contains(&wl) { c.f(unsafe { core::mem::transmute::<u32, F>(base as u32 + wl as u32) }) } else { f64::NAN }
}

/// CONNECTION_WORKERS[type] (undefined -> NaN)
#[inline(always)]
fn conn_workers(c: &Cx, t: u8) -> f64 {
    if t < 7 { c.f(unsafe { core::mem::transmute::<u32, F>(F::cw0 as u32 + t as u32) }) } else { f64::NAN }
}

// ------------------------------------------------------------------------------------------------ nearStops
struct StopGrid<'a> {
    x: &'a [i32],
    z: &'a [i32],
    bins: &'a [i32],
    start: &'a [i32],
    nb: i32,
}

impl StopGrid<'_> {
    fn of<'a>(c: &Cx) -> StopGrid<'a> {
        let sn = c.n(U::stopN);
        let nb = c.i(U::binN);
        StopGrid {
            x: c.sl(U::stX, sn),
            z: c.sl(U::stZ, sn),
            bins: c.sl(U::stopBins, sn),
            start: c.sl(U::stopBinStart, (nb * nb + 1) as usize),
            nb,
        }
    }

    /// traffic.ts nearStops: stops within radius r of (x, z) in bin order (bz, then bx, then bin contents), squared
    /// distance <= r^2; nsDist = f32(sqrt(d2)). Returns the count (idx / dist hold >= stopN entries).
    #[inline]
    fn near(&self, x: i32, z: i32, r: i32, idx: &mut [i32], dist: &mut [f32]) -> usize {
        let nb = self.nb;
        // JS ((x - R) / 8) | 0 == truncating integer division
        let bx0 = if (x - r) / 8 > 0 { (x - r) / 8 } else { 0 };
        let bx1 = if (x + r) / 8 < nb - 1 { (x + r) / 8 } else { nb - 1 };
        let bz0 = if (z - r) / 8 > 0 { (z - r) / 8 } else { 0 };
        let bz1 = if (z + r) / 8 < nb - 1 { (z + r) / 8 } else { nb - 1 };
        let r2 = r * r;
        let mut cnt = 0usize;
        let mut bz = bz0;
        while bz <= bz1 {
            let mut bx = bx0;
            while bx <= bx1 {
                let bi = (bz * nb + bx) as usize;
                let p1 = self.start[bi + 1] as usize;
                let mut p = self.start[bi] as usize;
                while p < p1 {
                    let s = self.bins[p] as usize;
                    let dx = self.x[s] - x;
                    let dz = self.z[s] - z;
                    let d2 = dx * dx + dz * dz;
                    if d2 <= r2 {
                        idx[cnt] = s as i32;
                        dist[cnt] = sqrt(d2 as f64) as f32;
                        cnt += 1;
                    }
                    p += 1;
                }
                bx += 1;
            }
            bz += 1;
        }
        cnt
    }
}

// ------------------------------------------------------------------------------------------------ PREP
/// node times from the smoothed volumes (BPR), volNew / railNew / subNew = 0
fn prep_nodes(c: &Cx) -> i32 {
    let n = c.n(U::n);
    let cells = c.n(U::cells);
    let traffic = c.sl::<f32>(U::traffic, cells);
    let cell_of = c.sl::<i32>(U::cellOf, n);
    let cap = c.sl::<f32>(U::cap, n);
    let t0 = c.sl::<f32>(U::t0, n);
    let nt = c.sl::<f32>(U::nodeTime, n);
    let (alpha, maxf) = (c.f(F::bprAlpha), c.f(F::bprMax));
    for v in 0..n {
        let r = traffic[cell_of[v] as usize] as f64 / cap[v] as f64;
        let mut f = 1.0 + alpha * r * r * r * r;
        if f > maxf {
            f = maxf;
        }
        nt[v] = (t0[v] as f64 * f) as f32;
    }
    c.sl::<f32>(U::volNew, n).fill(0.0);
    c.sl::<f32>(U::railNew, c.n(U::nRail)).fill(0.0);
    c.sl::<f32>(U::subNew, c.n(U::nSub)).fill(0.0);
    0
}

/// regional sums (workers, city / connection slots -> out0..2) and the per-cycle origin initialisation
fn prep_origins(c: &Cx) -> i32 {
    let on = c.n(U::oN);
    let (jn, jb) = (c.n(U::jN), c.n(U::jB));
    let ow = c.sl::<f32>(U::oW, on);
    let js = c.sl::<f32>(U::jSlots, jn);
    let mut workers = 0.0f64;
    for o in 0..on {
        workers += ow[o] as f64;
    }
    let mut city = 0.0f64;
    for j in 0..jb {
        city += js[j] as f64;
    }
    let mut conn = 0.0f64;
    for j in jb..jn {
        conn += js[j] as f64;
    }
    let (ou, oa, ot, oc, otr, owk) = (
        c.sl::<f32>(U::oU, on),
        c.sl::<f32>(U::oAsg, on),
        c.sl::<f32>(U::oTimeSum, on),
        c.sl::<f32>(U::oCarW, on),
        c.sl::<f32>(U::oTrW, on),
        c.sl::<f32>(U::oWalkW, on),
    );
    let (ocn, old) = (c.sl::<i32>(U::oCarNode, on), c.sl::<f32>(U::oLastD, on));
    for o in 0..on {
        ou[o] = ow[o];
        oa[o] = 0.0;
        ot[o] = 0.0;
        oc[o] = 0.0;
        otr[o] = 0.0;
        owk[o] = 0.0;
        ocn[o] = -1;
        old[o] = -1.0;
    }
    c.setf(F::out0, workers);
    c.setf(F::out1, city);
    c.setf(F::out2, conn);
    0
}

/// jCapP = jSlots x propFactor, then buildClusters (sites sharing their lowest entry node; connections alone)
fn clusters(c: &Cx) -> i32 {
    let n = c.n(U::n);
    let jn = c.n(U::jN);
    let ent = c.sl::<i32>(U::ent, c.n(U::entN));
    let (jslots, jcapp, jprice, jbase, jnoise) = (
        c.sl::<f32>(U::jSlots, jn),
        c.sl::<f32>(U::jCapP, jn),
        c.sl::<f32>(U::jPrice, jn),
        c.sl::<f32>(U::jBase, jn),
        c.sl::<f32>(U::jNoise, jn),
    );
    let (jents, jentc, jbid, jq) = (c.sl::<i32>(U::jEntS, jn), c.sl::<u8>(U::jEntC, jn), c.sl::<i32>(U::jBid, jn), c.sl::<i32>(U::jQ, jn));
    // validate the entry ranges first (no state change on failure)
    let en = ent.len();
    for j in 0..jn {
        let (s, k) = (jents[j], jentc[j] as usize);
        if k > 0 && (s < 0 || s as usize + k > en) {
            return -2;
        }
    }
    let pf = c.f(F::propFactor);
    for j in 0..jn {
        jcapp[j] = (jslots[j] as f64 * pf) as f32;
    }
    let qcap = c.n(U::capQ);
    let (qnode, qslots, qcapp, qasg, qprice, qprop, qbase, qnoise, qts) = (
        c.sl::<i32>(U::qNode, qcap),
        c.sl::<f32>(U::qSlots, qcap),
        c.sl::<f32>(U::qCapP, qcap),
        c.sl::<f32>(U::qAsg, qcap),
        c.sl::<f32>(U::qPrice, qcap),
        c.sl::<f32>(U::qProp, qcap),
        c.sl::<f32>(U::qBase, qcap),
        c.sl::<f32>(U::qNoise, qcap),
        c.sl::<f32>(U::qTimeSum, qcap),
    );
    let node_q = c.sl::<i32>(U::nodeQ, n);
    node_q.fill(-1);
    let mut qn = 0usize;
    for j in 0..jn {
        jq[j] = -1;
        let k = jentc[j] as usize;
        if k == 0 {
            continue;
        }
        let s = jents[j] as usize;
        let mut node = ent[s];
        for e in s + 1..s + k {
            if ent[e] < node {
                node = ent[e];
            }
        }
        let is_conn = jbid[j] < 0;
        let mut q = if is_conn { -1 } else { node_q[node as usize] };
        if q < 0 {
            q = qn as i32;
            qn += 1;
            if !is_conn {
                node_q[node as usize] = q;
            }
            let qi = q as usize;
            qnode[qi] = node;
            qslots[qi] = 0.0;
            qcapp[qi] = 0.0;
            qasg[qi] = 0.0;
            qprice[qi] = 0.0;
            qprop[qi] = 0.0;
            qts[qi] = 0.0;
            qbase[qi] = jbase[j];
            qnoise[qi] = jnoise[j];
        }
        jq[j] = q;
        let qi = q as usize;
        qslots[qi] += jslots[j];
        qcapp[qi] += jcapp[j];
        qprice[qi] = (qprice[qi] as f64 + jprice[j] as f64 * jslots[j] as f64) as f32;
    }
    for q in 0..qn {
        if qslots[q] > 0.0 {
            qprice[q] /= qslots[q];
        }
    }
    c.set(U::qN, qn as i32);
    0
}

// ------------------------------------------------------------------------------------------------ PREP TRANSIT
/// stop x / z and the 8x8 stop bins (stCell filled by the driver from collectStops)
fn prep_stops(c: &Cx) -> i32 {
    let sn = c.n(U::stopN);
    let big_n = c.i(U::mapN);
    if big_n <= 0 {
        return -2;
    }
    let nb = (big_n + 7) / 8; // Math.ceil(N / 8)
    let nbb = (nb * nb) as usize;
    if nbb + 1 > c.n(U::capBin) {
        c.set(U::outNeed, (nbb + 1) as i32);
        return -8;
    }
    let cell = c.sl::<i32>(U::stCell, sn);
    for s in 0..sn {
        let v = cell[s];
        if v < 0 || v as usize >= c.n(U::cells) {
            return -2;
        }
    }
    let (sx, sz) = (c.sl::<i32>(U::stX, sn), c.sl::<i32>(U::stZ, sn));
    for s in 0..sn {
        let x = cell[s] % big_n;
        sx[s] = x;
        sz[s] = (cell[s] - x) / big_n;
    }
    c.set(U::binN, nb);
    let start = c.sl::<i32>(U::stopBinStart, nbb + 1);
    start.fill(0);
    for s in 0..sn {
        start[((sz[s] / 8) * nb + sx[s] / 8 + 1) as usize] += 1;
    }
    for i in 0..nbb {
        start[i + 1] += start[i];
    }
    let fill = c.sl::<i32>(U::binFill, nbb);
    fill.fill(0);
    let bins = c.sl::<i32>(U::stopBins, sn);
    for s in 0..sn {
        let bi = ((sz[s] / 8) * nb + sx[s] / 8) as usize;
        bins[(start[bi] + fill[bi]) as usize] = s as i32;
        fill[bi] += 1;
    }
    0
}

/// transfers between stops of different modes within walking distance (CSR, the JS decrementing-cursor fill), bus
/// in-vehicle times. One nearStops pass records the edges in push order (from, to, cost stored as the f32 the CSR
/// keeps), then traffic.ts's counting placement. Returns the edge count, or -7 (U::outNeed = edges) when the edge
/// arrays are too small (only scratch written).
fn transfers(c: &Cx) -> i32 {
    let sn = c.n(U::stopN);
    let total = c.n(U::total);
    let grid = StopGrid::of(c);
    let (mode, attc, atts) = (c.sl::<u8>(U::stMode, sn), c.sl::<u8>(U::stAttC, sn + 1), c.sl::<i32>(U::stAttS, sn + 1));
    let att = c.sl::<i32>(U::stAtt, c.n(U::capAtt));
    let wait = c.sl::<f32>(U::stWait, sn);
    let cap_stop = c.n(U::capStop);
    let (idx, dist) = (c.sl::<i32>(U::nsIdx, cap_stop), c.sl::<f32>(U::nsDist, cap_stop));
    let r = c.i(U::stopR);
    // validate attachments (first attach node of every attached stop < total)
    for s in 0..sn {
        if attc[s] > 0 {
            let a = atts[s];
            if a < 0 || a as usize >= att.len() || att[a as usize] < 0 || att[a as usize] as usize >= total {
                return -2;
            }
        }
    }
    let cap = c.n(U::capTr);
    let (efrom, eto, ecost) = (c.sl::<i32>(U::trEFrom, cap), c.sl::<i32>(U::trETo, cap), c.sl::<f32>(U::trECost, cap));
    let wt = c.f(F::stopWalkT);
    let mut ne = 0usize;
    for s in 0..sn {
        if attc[s] == 0 {
            continue;
        }
        let cnt = grid.near(grid.x[s], grid.z[s], r, idx, dist);
        for q in 0..cnt {
            let s2 = idx[q] as usize;
            if s2 <= s || mode[s2] == mode[s] || attc[s2] == 0 {
                continue;
            }
            if ne + 2 <= cap {
                let a = att[atts[s] as usize];
                let b = att[atts[s2] as usize];
                let cst = (dist[q] as f64 * wt + 0.5 * (wait[s] as f64 + wait[s2] as f64)) as f32;
                efrom[ne] = a;
                eto[ne] = b;
                ecost[ne] = cst;
                efrom[ne + 1] = b;
                eto[ne + 1] = a;
                ecost[ne + 1] = cst;
            }
            ne += 2;
        }
    }
    if ne > cap {
        c.set(U::outNeed, ne as i32);
        return -7;
    }
    let tr_start = c.sl::<i32>(U::trStart, total + 1);
    let (to, cost) = (c.sl::<i32>(U::trTo, ne), c.sl::<f32>(U::trCost, ne));
    tr_start.fill(0);
    for k in 0..ne {
        tr_start[efrom[k] as usize + 1] += 1;
    }
    for i in 0..total {
        tr_start[i + 1] += tr_start[i];
    }
    for k in 0..ne {
        let f = efrom[k] as usize + 1;
        tr_start[f] -= 1;
        let p = tr_start[f] as usize;
        to[p] = eto[k];
        cost[p] = ecost[k];
    }
    // trStart[k] = start[k - 1] for k >= 1 now: shift back
    for i in 1..total {
        tr_start[i] = tr_start[i + 1];
    }
    tr_start[total] = ne as i32;
    c.set(U::nTr, ne as i32);
    // bus in-vehicle time per road node
    let n = c.n(U::n);
    let (bt, nt) = (c.sl::<f32>(U::busTime, n), c.sl::<f32>(U::nodeTime, n));
    let f = c.f(F::busTimeFactor);
    for v in 0..n {
        bt[v] = (nt[v] as f64 * f) as f32;
    }
    ne as i32
}

// ------------------------------------------------------------------------------------------------ TRANSIT
/// each origin's best transit option from the transit forest (+ acc / tAcc cleared)
fn origin_transit(c: &Cx) {
    let on = c.n(U::oN);
    let total = c.n(U::total);
    let (dist_t, src_t, done_t) = (c.sl::<f64>(U::stDist, total), c.sl::<i32>(U::stSrc, total), c.sl::<u8>(U::stDone, total));
    let has_stops = c.n(U::stopN) > 0;
    let (otrt, oboard, obs, ojt) = (c.sl::<f32>(U::oTrT, on), c.sl::<i32>(U::oBoard, on), c.sl::<i32>(U::oBoardStop, on), c.sl::<i32>(U::oJobT, on));
    let (ocell, ohalf) = (c.sl::<i32>(U::oCell, on), c.sl::<u8>(U::oHalf, on));
    let big_n = c.i(U::mapN);
    let r0 = c.i(U::stopR);
    let (wt, maxc) = (c.f(F::stopWalkT), c.f(F::maxCommute));
    let jnoise = c.sl::<f32>(U::jNoise, c.n(U::jN));
    if has_stops {
        let grid = StopGrid::of(c);
        let sn = c.n(U::stopN);
        let (atts, attc) = (c.sl::<i32>(U::stAttS, sn + 1), c.sl::<u8>(U::stAttC, sn + 1));
        let att = c.sl::<i32>(U::stAtt, c.n(U::capAtt));
        let wait = c.sl::<f32>(U::stWait, sn);
        let cap_stop = c.n(U::capStop);
        let (idx, dist) = (c.sl::<i32>(U::nsIdx, cap_stop), c.sl::<f32>(U::nsDist, cap_stop));
        for o in 0..on {
            otrt[o] = f32::INFINITY;
            oboard[o] = -1;
            obs[o] = -1;
            ojt[o] = -1;
            let cell = ocell[o];
            let x = cell % big_n;
            let z = (cell - x) / big_n;
            let half = ohalf[o] as i32;
            let cnt = grid.near(x, z, r0 + half, idx, dist);
            let mut best = INF;
            let mut board = -1i32;
            let mut board_stop = -1i32;
            for q in 0..cnt {
                let s = idx[q] as usize;
                let walk = js_max(0.0, dist[q] as f64 - half as f64) * wt + wait[s] as f64;
                let a0 = atts[s] as usize;
                for a in a0..a0 + attc[s] as usize {
                    let v = att[a] as usize;
                    if done_t[v] != 1 {
                        continue;
                    }
                    let g = walk + dist_t[v];
                    if g < best {
                        best = g;
                        board = v as i32;
                        board_stop = s as i32;
                    }
                }
            }
            if board < 0 {
                continue;
            }
            let jt = src_t[board as usize];
            let t = best - jnoise[jt as usize] as f64;
            if t > maxc {
                continue;
            }
            otrt[o] = t as f32;
            oboard[o] = board;
            obs[o] = board_stop;
            ojt[o] = jt;
        }
    } else {
        for o in 0..on {
            otrt[o] = f32::INFINITY;
            oboard[o] = -1;
            obs[o] = -1;
            ojt[o] = -1;
        }
    }
    c.sl::<f32>(U::acc, c.n(U::n)).fill(0.0);
    c.sl::<f32>(U::tAcc, total).fill(0.0);
}

/// transit(): seeds at stops within walking distance of job sites (+ rail connections), reverse transit search,
/// originTransit. -1 + U::outNeed when the seed or queue buffers are too small (no state changed).
fn transit(c: &Cx) -> i32 {
    let total = c.n(U::total);
    let sn = c.n(U::stopN);
    if sn == 0 {
        // S.reset(T.total)
        let o = search_out(c, 1, total);
        o.dist.fill(INF);
        o.src.fill(-1);
        o.next.fill(-1);
        o.done.fill(0);
        c.set(U::stSettled, 0);
        origin_transit(c);
        return 0;
    }
    let jn = c.n(U::jN);
    let n_r = c.n(U::n) as i32;
    let grid = StopGrid::of(c);
    let (atts, attc) = (c.sl::<i32>(U::stAttS, sn + 1), c.sl::<u8>(U::stAttC, sn + 1));
    let att = c.sl::<i32>(U::stAtt, c.n(U::capAtt));
    let cap_stop = c.n(U::capStop);
    let (idx, dist) = (c.sl::<i32>(U::nsIdx, cap_stop), c.sl::<f32>(U::nsDist, cap_stop));
    let (jbase, jnoise, jrail, jbid, jcell, jhalf) = (
        c.sl::<f32>(U::jBase, jn),
        c.sl::<f32>(U::jNoise, jn),
        c.sl::<i32>(U::jRailNode, jn),
        c.sl::<i32>(U::jBid, jn),
        c.sl::<i32>(U::jCell, jn),
        c.sl::<u8>(U::jHalf, jn),
    );
    let cap_seed = c.n(U::capSeed);
    let (snode, slabel, sid) = (c.sl::<i32>(U::seedNode, cap_seed), c.sl::<f64>(U::seedLabel, cap_seed), c.sl::<i32>(U::seedId, cap_seed));
    let big_n = c.i(U::mapN);
    let r0 = c.i(U::stopR);
    let wt = c.f(F::stopWalkT);
    let mut ns = 0usize;
    let mut push = |node: i32, label: f64, id: i32| {
        if ns < cap_seed {
            snode[ns] = node;
            slabel[ns] = label;
            sid[ns] = id;
        }
        ns += 1;
    };
    for j in 0..jn {
        let label0 = jbase[j] as f64 + jnoise[j] as f64;
        if jrail[j] >= 0 {
            push(n_r + jrail[j], label0, j as i32);
            continue;
        }
        if jbid[j] < 0 {
            continue;
        }
        let cell = jcell[j];
        let x = cell % big_n;
        let z = (cell - x) / big_n;
        let half = jhalf[j] as i32;
        let cnt = grid.near(x, z, r0 + half, idx, dist);
        for q in 0..cnt {
            let s = idx[q] as usize;
            let walk = js_max(0.0, dist[q] as f64 - half as f64) * wt;
            let a0 = atts[s] as usize;
            for a in a0..a0 + attc[s] as usize {
                push(att[a], label0 + walk, j as i32);
            }
        }
    }
    let n_tr = c.n(U::nTr);
    let need_q = 2 * (ns + 4 * total + n_tr) + 16;
    if ns > cap_seed {
        c.set(U::outNeed, ns as i32);
        return -1;
    }
    if need_q > c.n(U::capQent) {
        c.set(U::outNeed, need_q as i32);
        return -5;
    }
    let (nr, nrail, nsub) = (c.n(U::n), c.n(U::nRail), c.n(U::nSub));
    let t = TransitIn {
        n_r: nr,
        n_rail: nrail,
        n_sub: nsub,
        total,
        road_adj: c.sl(U::rev, 4 * nr),
        bus_time: c.sl(U::busTime, nr),
        rail_adj: c.sl(U::railAdj, 4 * nrail),
        sub_adj: c.sl(U::subAdj, 4 * nsub),
        rail_time: c.f(F::railTime),
        sub_time: c.f(F::subTime),
        tr_start: c.sl(U::trStart, total + 1),
        tr_to: c.sl(U::trTo, n_tr),
        tr_cost: c.sl(U::trCost, n_tr),
    };
    let seeds = SeedList { node: &snode[..ns], label: &slabel[..ns], id: &sid[..ns] };
    let mut o = search_out(c, 1, total);
    let k = transit_search(&t, &seeds, c.f(F::limTransit), c.f(F::invQT), &mut o, c.sl(U::head, c.n(U::headLen)), c.sl(U::qent, c.n(U::capQent)));
    if k < 0 {
        return if k == -3 { -3 } else { -4 };
    }
    c.set(U::stSettled, k);
    origin_transit(c);
    0
}

// ------------------------------------------------------------------------------------------------ ROUNDS
/// roundSearch(): seeds = clusters with open capacity >= 0.5, reverse road search into SA
fn round_search(c: &Cx, round: i32) -> i32 {
    let qn = c.n(U::qN);
    if qn > c.n(U::capSeed) {
        c.set(U::outNeed, qn as i32);
        return -1;
    }
    let prop = round < c.i(U::propRounds);
    let (capp, slots, asg, base, noise, price, qnode) = (
        c.sl::<f32>(U::qCapP, qn),
        c.sl::<f32>(U::qSlots, qn),
        c.sl::<f32>(U::qAsg, qn),
        c.sl::<f32>(U::qBase, qn),
        c.sl::<f32>(U::qNoise, qn),
        c.sl::<f32>(U::qPrice, qn),
        c.sl::<i32>(U::qNode, qn),
    );
    let (snode, slabel, sid) = (c.sl::<i32>(U::seedNode, qn), c.sl::<f64>(U::seedLabel, qn), c.sl::<i32>(U::seedId, qn));
    let pmax = c.f(F::priceMax);
    let mut ns = 0usize;
    for q in 0..qn {
        if open_cap(prop, capp, slots, asg, q) < 0.5 {
            continue;
        }
        snode[ns] = qnode[q];
        slabel[ns] = pmax + base[q] as f64 + noise[q] as f64 + price[q] as f64;
        sid[ns] = q as i32;
        ns += 1;
    }
    run_road_search(c, false, 0, ns, c.f(F::limRound))
}

/// stable LSD radix sort of idx[0, nc) by key[0, nc) (11-bit digits, trivial passes skipped); returns true when the
/// result is in (keys2, idx2)
fn radix_sort(nc: usize, max_k: u64, keys: &mut [u64], keys2: &mut [u64], idx: &mut [i32], idx2: &mut [i32], hist: &mut [u32]) -> bool {
    let bits = 64 - max_k.leading_zeros();
    let passes = (bits as usize).div_ceil(RADIX_BITS as usize);
    let rows = &mut hist[..passes * RADIX];
    rows.fill(0);
    for k in 0..nc {
        let key = keys[k];
        for p in 0..passes {
            rows[p * RADIX + ((key >> (p as u32 * RADIX_BITS)) as usize & (RADIX - 1))] += 1;
        }
    }
    let mut swapped = false;
    for p in 0..passes {
        let row = &mut rows[p * RADIX..(p + 1) * RADIX];
        let shift = p as u32 * RADIX_BITS;
        // a pass where every key has the same digit keeps the order: skip it
        let d0 = if nc > 0 { (if swapped { keys2[0] } else { keys[0] } >> shift) as usize & (RADIX - 1) } else { 0 };
        if row[d0] as usize == nc {
            continue;
        }
        let mut sum = 0u32;
        for b in 0..RADIX {
            let t = row[b];
            row[b] = sum;
            sum += t;
        }
        let (ks, ids, kd, idd): (&[u64], &[i32], &mut [u64], &mut [i32]) =
            if swapped { (&*keys2, &*idx2, &mut *keys, &mut *idx) } else { (&*keys, &*idx, &mut *keys2, &mut *idx2) };
        for k in 0..nc {
            let key = ks[k];
            let d = (key >> shift) as usize & (RADIX - 1);
            let pos = row[d] as usize;
            row[d] += 1;
            kd[pos] = key;
            idd[pos] = ids[k];
        }
        swapped = !swapped;
    }
    swapped
}

/// roundMatch() up to the round control flow. Outputs: out0 accepted, out1 carRound, out2 left (Σ oU in origin
/// order), U::outNc candidates, U::outRoutes sampled car pieces (routeCand / routeW). -2: a NaN sort key (JS runs
/// this phase; no state changed).
fn round_match(c: &Cx, round: i32) -> i32 {
    let n = c.n(U::n);
    // SA must be this cycle's search (roundSearch always precedes roundMatch): a stale count is outside the domain
    if c.n(U::saSettled) > n {
        return -2;
    }
    let on = c.n(U::oN);
    let (dist, src, hops, done) = (c.sl::<f64>(U::saDist, n), c.sl::<i32>(U::saSrc, n), c.sl::<u16>(U::saHops, n), c.sl::<u8>(U::saDone, n));
    let ent = c.sl::<i32>(U::ent, c.n(U::entN));
    let (oents, oentc) = (c.sl::<i32>(U::oEntS, on), c.sl::<u8>(U::oEntC, on));
    let ou = c.sl::<f32>(U::oU, on);
    let cand_node = c.sl::<i32>(U::candNode, on);
    let (sort_a, sort_b) = (c.sl::<i32>(U::sortA, on), c.sl::<i32>(U::sortB, on));
    let (key_a, key_b) = (c.sl::<u64>(U::keyA, on), c.sl::<u64>(U::keyB, on));
    let otrt = c.sl::<f32>(U::oTrT, on);
    let qcap = c.n(U::capQ);
    let (qnoise, qprice) = (c.sl::<f32>(U::qNoise, qcap), c.sl::<f32>(U::qPrice, qcap));
    let (pmax, car_over) = (c.f(F::priceMax), c.f(F::carOverhead));
    // candidates: origins with unassigned workers -> best entry node (validated entry ranges)
    let en = ent.len();
    let mut nc = 0usize;
    let mut max_d = 1.0f64;
    for o in 0..on {
        if (ou[o] as f64) < 0.01 {
            continue;
        }
        let (s, k) = (oents[o], oentc[o] as usize);
        if k > 0 && (s < 0 || s as usize + k > en) {
            return -2;
        }
        let (best, bd) = best_entry(ent, s.max(0) as usize, k, done, dist);
        if best < 0 {
            continue;
        }
        cand_node[o] = best;
        sort_a[nc] = o as i32;
        nc += 1;
        if bd > max_d {
            max_d = bd;
        }
    }
    // sort keys: k = floor(max(0, g) * q) with M = next power of two >= oN (JS packs k * M + o, distinct)
    let mut m = 1.0f64;
    while m < on as f64 {
        m *= 2.0;
    }
    let qq = js_max(1.0, floor(1125899906842624.0 / (m * (max_d + 1.0))));
    let mut max_k = 0u64;
    for k in 0..nc {
        let o = sort_a[k] as usize;
        let node = cand_node[o] as usize;
        let mut g = dist[node];
        let tr_t = otrt[o] as f64;
        if tr_t < INF {
            let cq = src[node] as usize;
            let car_pure = g - pmax - qnoise[cq] as f64 - qprice[cq] as f64 + car_over;
            if tr_t < car_pure {
                g -= car_pure - tr_t;
            }
        }
        let kf = floor(js_max(0.0, g) * qq);
        // finite, integral, >= 0 and < 2^53 (NaN fails the first test)
        if !(kf >= 0.0 && kf < 9007199254740992.0) {
            return -2;
        }
        let kk = kf as u64;
        key_a[k] = kk;
        if kk > max_k {
            max_k = kk;
        }
    }
    let hist = c.sl::<u32>(U::hist, HIST_ROWS * RADIX);
    let in_b = radix_sort(nc, max_k, key_a, key_b, sort_a, sort_b, hist);
    let sorted: &[i32] = if in_b { &sort_b[..nc] } else { &sort_a[..nc] };
    // accept nearest first
    let (car_pcu, tr_bonus) = (c.f(F::carPcu), c.f(F::trBonus));
    let (qasg, qbase, qts, qprop) = (c.sl::<f32>(U::qAsg, qcap), c.sl::<f32>(U::qBase, qcap), c.sl::<f32>(U::qTimeSum, qcap), c.sl::<f32>(U::qProp, qcap));
    let (qcapp, qslots) = (c.sl::<f32>(U::qCapP, qcap), c.sl::<f32>(U::qSlots, qcap));
    let acc = c.sl::<f32>(U::acc, n);
    let total = c.n(U::total);
    let tacc = c.sl::<f32>(U::tAcc, total);
    let st_load = c.sl::<f32>(U::stLoad, c.n(U::capStop));
    if round == 0 {
        for k in 0..nc {
            let o = sorted[k] as usize;
            let q = src[cand_node[o] as usize] as usize;
            qprop[q] += ou[o];
        }
    }
    let prop = round < c.i(U::propRounds);
    let (olastd, oasg, ots, ocw, otw, oww, ocn) = (
        c.sl::<f32>(U::oLastD, on),
        c.sl::<f32>(U::oAsg, on),
        c.sl::<f32>(U::oTimeSum, on),
        c.sl::<f32>(U::oCarW, on),
        c.sl::<f32>(U::oTrW, on),
        c.sl::<f32>(U::oWalkW, on),
        c.sl::<i32>(U::oCarNode, on),
    );
    let (owealth, oboard, obs) = (c.sl::<u8>(U::oWealth, on), c.sl::<i32>(U::oBoard, on), c.sl::<i32>(U::oBoardStop, on));
    let (route_cand, route_w) = (c.sl::<i32>(U::routeCand, ROUTE_MAX), c.sl::<f64>(U::routeW, ROUTE_MAX));
    let (maxc, walk_max, walk_t, beta, walk_bias) = (c.f(F::maxCommute), c.i(U::walkMax), c.f(F::walkT), c.f(F::modeBeta), c.f(F::walkBias));
    let mut accepted = 0.0f64;
    let mut car_round = 0.0f64;
    let mut rn = 0usize;
    for k in 0..nc {
        let o = sorted[k] as usize;
        let node = cand_node[o] as usize;
        let q = src[node] as usize;
        let d = dist[node] - pmax - qnoise[q] as f64 - qprice[q] as f64;
        olastd[o] = d as f32;
        let open = open_cap(prop, qcapp, qslots, qasg, q);
        if open < 0.01 {
            continue;
        }
        let take = js_min(ou[o] as f64, open);
        // mode split for this piece
        let car_t = d + car_over;
        let car_ok = d <= maxc;
        let h = hops[node] as i32;
        let walk = if qbase[q] as f64 == 0.0 && h <= walk_max { (h + 1) as f64 * walk_t } else { INF };
        let tr_t = otrt[o] as f64;
        let wl = owealth[o] as i32 - 1;
        let uc = if car_ok { -beta * car_t + bias(c, F::carBias0, wl) } else { NEG_INF };
        let ut = if tr_t < INF { -beta * tr_t + bias(c, F::trBias0, wl) + tr_bonus } else { NEG_INF };
        let uw = if walk < INF { -beta * walk + walk_bias } else { NEG_INF };
        let um = js_max(js_max(uc, ut), uw);
        if um == NEG_INF {
            continue;
        }
        let ec = share_exp(uc, um);
        let et = share_exp(ut, um);
        let ew = share_exp(uw, um);
        let tot = ec + et + ew;
        let sc = ec / tot;
        let st = et / tot;
        let sw = ew / tot;
        let time = sc * (if sc > 0.0 { car_t } else { 0.0 }) + st * (if st > 0.0 { tr_t } else { 0.0 }) + sw * (if sw > 0.0 { walk } else { 0.0 });
        // commit
        ou[o] = (ou[o] as f64 - take) as f32;
        oasg[o] = (oasg[o] as f64 + take) as f32;
        ots[o] = (ots[o] as f64 + take * time) as f32;
        ocw[o] = (ocw[o] as f64 + take * sc) as f32;
        otw[o] = (otw[o] as f64 + take * st) as f32;
        oww[o] = (oww[o] as f64 + take * sw) as f32;
        if ocn[o] < 0 {
            ocn[o] = node as i32;
        }
        qasg[q] = (qasg[q] as f64 + take) as f32;
        qts[q] = (qts[q] as f64 + take * time) as f32;
        accepted += take;
        if sc > 0.0 {
            let f = take * sc;
            acc[node] = (acc[node] as f64 + f * car_pcu) as f32;
            car_round += f;
            if rn < ROUTE_MAX {
                route_cand[rn] = node as i32;
                route_w[rn] = f;
                rn += 1;
            }
        }
        if st > 0.0 {
            // out-of-range board / stop indices are ignored like typed-array writes out of bounds in JS
            let v = take * st;
            if let Some(x) = tacc.get_mut(oboard[o] as usize) {
                *x = (*x as f64 + v) as f32;
            }
            if let Some(x) = st_load.get_mut(obs[o] as usize) {
                *x = (*x as f64 + v) as f32;
            }
        }
    }
    if car_round > 0.0 {
        flows_into_vol(c, 0, true, None);
    }
    let mut left = 0.0f64;
    for o in 0..on {
        left += ou[o] as f64;
    }
    c.setf(F::out0, accepted);
    c.setf(F::out1, car_round);
    c.setf(F::out2, left);
    c.set(U::outNc, nc as i32);
    c.set(U::outRoutes, rn as i32);
    0
}

// ------------------------------------------------------------------------------------------------ COMMUTE
/// poolRemaining(): unmatched workers take the remaining open capacity of their road component proportionally
fn pool_remaining(c: &Cx) {
    let n = c.n(U::n);
    let ncomp = c.n(U::nComp);
    if ncomp == 0 {
        return;
    }
    let on = c.n(U::oN);
    let qn = c.n(U::qN);
    let comp = c.sl::<i32>(U::comp, n);
    let ent = c.sl::<i32>(U::ent, c.n(U::entN));
    let (u_, o_) = (c.sl::<f64>(U::poolU, ncomp), c.sl::<f64>(U::poolO, ncomp));
    u_.fill(0.0);
    o_.fill(0.0);
    let (ou, olastd, oents) = (c.sl::<f32>(U::oU, on), c.sl::<f32>(U::oLastD, on), c.sl::<i32>(U::oEntS, on));
    let mut any = false;
    for o in 0..on {
        if (ou[o] as f64) < 0.01 || (olastd[o] as f64) < 0.0 {
            continue;
        }
        u_[comp[ent[oents[o] as usize] as usize] as usize] += ou[o] as f64;
        any = true;
    }
    if !any {
        return;
    }
    let (qslots, qasg, qnode, qts) = (c.sl::<f32>(U::qSlots, qn), c.sl::<f32>(U::qAsg, qn), c.sl::<i32>(U::qNode, qn), c.sl::<f32>(U::qTimeSum, qn));
    // full-capacity round: open = qSlots - qAsg
    for q in 0..qn {
        let cc = qslots[q] as f64 - qasg[q] as f64;
        if cc > 0.5 {
            o_[comp[qnode[q] as usize] as usize] += cc;
        }
    }
    let (oasg, ots, ocw, otw, otrt, owealth, oboard, obs, cand) = (
        c.sl::<f32>(U::oAsg, on),
        c.sl::<f32>(U::oTimeSum, on),
        c.sl::<f32>(U::oCarW, on),
        c.sl::<f32>(U::oTrW, on),
        c.sl::<f32>(U::oTrT, on),
        c.sl::<u8>(U::oWealth, on),
        c.sl::<i32>(U::oBoard, on),
        c.sl::<i32>(U::oBoardStop, on),
        c.sl::<i32>(U::candNode, on),
    );
    let mut tw = 0.0f64;
    let mut tt = 0.0f64;
    for o in 0..on {
        tw += oasg[o] as f64;
        tt += ots[o] as f64;
    }
    let avg_t = if tw > 0.0 { tt / tw } else { 15.0 };
    let car_pcu = c.f(F::carPcu);
    let (maxc, car_over, beta) = (c.f(F::maxCommute), c.f(F::carOverhead), c.f(F::modeBeta));
    let total = c.n(U::total);
    let tacc = c.sl::<f32>(U::tAcc, total);
    let st_load = c.sl::<f32>(U::stLoad, c.n(U::capStop));
    let sa_done = c.sl::<u8>(U::saDone, n);
    let acc = c.sl::<f32>(U::acc, n);
    let mut flows = false;
    for o in 0..on {
        let u = ou[o] as f64;
        if u < 0.01 || (olastd[o] as f64) < 0.0 {
            continue;
        }
        let cc = comp[ent[oents[o] as usize] as usize] as usize;
        if o_[cc] <= 0.0 {
            continue;
        }
        let take = u * js_min(1.0, o_[cc] / u_[cc]);
        let car_t = js_min(maxc, js_max(avg_t + 5.0, 1.3 * (olastd[o] as f64 + car_over)));
        let tr_t = otrt[o] as f64;
        let mut st = 0.0f64;
        if tr_t < INF {
            let wl = owealth[o] as i32 - 1;
            let d = (-beta * tr_t + bias(c, F::trBias0, wl)) - (-beta * car_t + bias(c, F::carBias0, wl));
            st = 1.0 / (1.0 + exp(-d));
        }
        let sc = 1.0 - st;
        ou[o] = (ou[o] as f64 - take) as f32;
        oasg[o] = (oasg[o] as f64 + take) as f32;
        ots[o] = (ots[o] as f64 + take * (sc * car_t + st * (if tr_t < INF { tr_t } else { 0.0 }))) as f32;
        ocw[o] = (ocw[o] as f64 + take * sc) as f32;
        if st > 0.0 {
            let v = take * st;
            otw[o] = (otw[o] as f64 + v) as f32;
            if let Some(x) = tacc.get_mut(oboard[o] as usize) {
                *x = (*x as f64 + v) as f32;
            }
            if let Some(x) = st_load.get_mut(obs[o] as usize) {
                *x = (*x as f64 + v) as f32;
            }
        }
        let node = cand[o];
        if sc > 0.0 && node >= 0 && (node as usize) < n && sa_done[node as usize] == 1 {
            let v = node as usize;
            acc[v] = (acc[v] as f64 + take * sc * car_pcu) as f32;
            flows = true;
        }
    }
    for q in 0..qn {
        let open = qslots[q] as f64 - qasg[q] as f64;
        if open <= 0.5 {
            continue;
        }
        let cc = comp[qnode[q] as usize] as usize;
        if o_[cc] <= 0.0 {
            continue;
        }
        let add = open * js_min(1.0, u_[cc] / o_[cc]);
        qasg[q] = (qasg[q] as f64 + add) as f32;
        qts[q] = (qts[q] as f64 + add * js_max(avg_t + 5.0, 20.0)) as f32;
    }
    if flows {
        flows_into_vol(c, 0, true, None);
    }
}

/// commuteEnd() without the per-id price scatter (driver): out0..4 = tripsC, tripsT, tripsW, commuteSum, commuteW
fn commute(c: &Cx) -> i32 {
    // validate what poolRemaining indexes with (no state change on failure)
    let (n, on, qn) = (c.n(U::n), c.n(U::oN), c.n(U::qN));
    // the SA / ST forests must be this cycle's (stale settled counts after a graph shrink: outside the domain)
    if c.n(U::saSettled) > n || c.n(U::stSettled) > c.n(U::total) {
        return -2;
    }
    let (ncomp, en) = (c.n(U::nComp) as i32, c.n(U::entN));
    let comp = c.sl::<i32>(U::comp, n);
    let ent = c.sl::<i32>(U::ent, en);
    let (oents, olastd) = (c.sl::<i32>(U::oEntS, on), c.sl::<f32>(U::oLastD, on));
    for o in 0..on {
        if (olastd[o] as f64) >= 0.0 {
            let s = oents[o];
            if s < 0 || s as usize >= en || ent[s as usize] < 0 || ent[s as usize] as usize >= n {
                return -2;
            }
        }
    }
    let qnode = c.sl::<i32>(U::qNode, qn);
    for q in 0..qn {
        if qnode[q] < 0 || qnode[q] as usize >= n {
            return -2;
        }
    }
    for v in 0..n {
        if comp[v] < 0 || comp[v] >= ncomp {
            return -2;
        }
    }
    pool_remaining(c);
    let (oasg, ots, ow, ocw, otw, oww) = (
        c.sl::<f32>(U::oAsg, on),
        c.sl::<f32>(U::oTimeSum, on),
        c.sl::<f32>(U::oW, on),
        c.sl::<f32>(U::oCarW, on),
        c.sl::<f32>(U::oTrW, on),
        c.sl::<f32>(U::oWalkW, on),
    );
    let mut tw = 0.0f64;
    let mut tt = 0.0f64;
    for o in 0..on {
        tw += oasg[o] as f64;
        tt += ots[o] as f64;
    }
    let avg_t = if tw > 0.0 { tt / tw - c.f(F::carOverhead) } else { 5.0 };
    let step_p = js_max(c.f(F::stepMin), c.f(F::stepRel) * avg_t);
    let (qprop, qcapp, qprice, qslots, qasg, qts) = (
        c.sl::<f32>(U::qProp, qn),
        c.sl::<f32>(U::qCapP, qn),
        c.sl::<f32>(U::qPrice, qn),
        c.sl::<f32>(U::qSlots, qn),
        c.sl::<f32>(U::qAsg, qn),
        c.sl::<f32>(U::qTimeSum, qn),
    );
    let mut prop_sum = 0.0f64;
    let mut cap_sum = 0.0f64;
    for q in 0..qn {
        prop_sum += qprop[q] as f64;
        cap_sum += js_max(1.0, qcapp[q] as f64);
    }
    let mean = if prop_sum > 0.0 && cap_sum > 0.0 { prop_sum / cap_sum } else { 1.0 };
    let pmax = c.f(F::priceMax);
    for q in 0..qn {
        let cap = js_max(1.0, qcapp[q] as f64);
        let r = js_max(0.25, js_min(8.0, qprop[q] as f64 / cap / mean));
        let p = qprice[q] as f64 + step_p * log(r);
        qprice[q] = (if p < -pmax { -pmax } else if p > pmax { pmax } else { p }) as f32;
    }
    // distribute cluster results to member job sites (by slots)
    let jn = c.n(U::jN);
    let (jq, jslots, jasg, jts) = (c.sl::<i32>(U::jQ, jn), c.sl::<f32>(U::jSlots, jn), c.sl::<f32>(U::jAsg, jn), c.sl::<f32>(U::jTimeSum, jn));
    for j in 0..jn {
        let q = jq[j];
        if q < 0 {
            jasg[j] = 0.0;
            jts[j] = 0.0;
            continue;
        }
        let q = q as usize;
        let share = if qslots[q] > 0.0 { jslots[j] as f64 / qslots[q] as f64 } else { 0.0 };
        jasg[j] = (qasg[q] as f64 * share) as f32;
        jts[j] = (qts[q] as f64 * share) as f32;
    }
    // transit riders along the transit forest (stop sink), bus PCU on roads, rail / subway riders
    let total = c.n(U::total);
    let (settled, order, next) = (c.n(U::stSettled), c.sl::<i32>(U::stOrder, total), c.sl::<i32>(U::stNext, total));
    let tacc = c.sl::<f32>(U::tAcc, total);
    let node_stop = c.sl::<i32>(U::nodeStop, total);
    let st_load = c.sl::<f32>(U::stLoad, c.n(U::capStop));
    for k in (0..settled).rev() {
        let v = order[k] as usize;
        let f = tacc[v];
        if f == 0.0 {
            continue;
        }
        let nx = next[v];
        if nx >= 0 {
            tacc[nx as usize] += f;
        } else {
            let s = node_stop[v];
            if s >= 0 {
                if let Some(x) = st_load.get_mut(s as usize) {
                    *x += f;
                }
            }
        }
    }
    let (nr, nrail) = (n, c.n(U::nRail));
    let vol = c.sl::<f32>(U::volNew, n);
    let (rail_new, sub_new) = (c.sl::<f32>(U::railNew, nrail), c.sl::<f32>(U::subNew, c.n(U::nSub)));
    let bus_pcu = c.f(F::busPcu);
    for k in 0..settled {
        let v = order[k] as usize;
        let f = tacc[v];
        if f == 0.0 {
            continue;
        }
        if v < nr {
            vol[v] = (vol[v] as f64 + f as f64 * bus_pcu) as f32;
        } else if v < nr + nrail {
            rail_new[v - nr] += f;
        } else {
            sub_new[v - nr - nrail] += f;
        }
    }
    // per-origin outputs and trip statistics
    let (oemp, otime, oshc, osht, oshw) = (c.sl::<f32>(U::oEmp, on), c.sl::<f32>(U::oTime, on), c.sl::<f32>(U::oShC, on), c.sl::<f32>(U::oShT, on), c.sl::<f32>(U::oShW, on));
    let (mut tc, mut tt2, mut twk, mut csum, mut cw) = (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
    for o in 0..on {
        let a = oasg[o];
        let w = ow[o];
        oemp[o] = if w > 0.0 { js_min(1.0, a as f64 / w as f64) as f32 } else { 0.0 };
        if a > 0.0 {
            otime[o] = ots[o] / a;
            oshc[o] = ocw[o] / a;
            osht[o] = otw[o] / a;
            oshw[o] = oww[o] / a;
            csum += ots[o] as f64;
            cw += a as f64;
        } else {
            otime[o] = 0.0;
            oshc[o] = 0.0;
            osht[o] = 0.0;
            oshw[o] = 0.0;
        }
        tc += ocw[o] as f64;
        tt2 += otw[o] as f64;
        twk += oww[o] as f64;
    }
    c.setf(F::out0, tc);
    c.setf(F::out1, tt2);
    c.setf(F::out2, twk);
    c.setf(F::out3, csum);
    c.setf(F::out4, cw);
    0
}

// ------------------------------------------------------------------------------------------------ INBOUND / SHOP / FREIGHT
fn add_cached(c: &Cx, which: U) {
    let n = c.n(U::n);
    let (vol, v) = (c.sl::<f32>(U::volNew, n), c.sl::<f32>(which, n));
    for i in 0..n {
        vol[i] += v[i];
    }
}

/// validated entry ranges of an entity class (count, starts, counts)
fn entries_ok(c: &Cx, cnt: usize, s: U, k: U) -> bool {
    let en = c.n(U::entN) as i64;
    let (st, kc) = (c.sl::<i32>(s, cnt), c.sl::<u8>(k, cnt));
    for i in 0..cnt {
        if kc[i] > 0 && (st[i] < 0 || st[i] as i64 + kc[i] as i64 > en) {
            return false;
        }
    }
    true
}

/// inbound() (cached branch): jTmp[j] = inboundById[jBid[j]] (driver); out0 = trips
fn inbound_cached(c: &Cx) -> i32 {
    let (jn, jb) = (c.n(U::jN), c.n(U::jB));
    let (jslots, jasg, jin, tmp) = (c.sl::<f32>(U::jSlots, jn), c.sl::<f32>(U::jAsg, jn), c.sl::<f32>(U::jInbound, jn), c.sl::<f32>(U::jTmp, jn));
    let mut tot = 0.0f64;
    for j in 0..jb {
        let spare = jslots[j] as f64 - js_min(jslots[j] as f64, jasg[j] as f64);
        let v = js_min(spare, tmp[j] as f64);
        jin[j] = (if v > 0.0 { v } else { 0.0 }) as f32;
        tot += jin[j] as f64;
    }
    add_cached(c, U::volInbound);
    c.setf(F::out0, tot);
    0
}

/// inbound() (recompute branch): out0 = trips, U::outCand = sampled candidates (inCand), status 1 = searched
fn inbound(c: &Cx) -> i32 {
    let n = c.n(U::n);
    let (jn, jb) = (c.n(U::jN), c.n(U::jB));
    if !entries_ok(c, jn, U::jEntS, U::jEntC) {
        return -2;
    }
    let (jents, jentc) = (c.sl::<i32>(U::jEntS, jn), c.sl::<u8>(U::jEntC, jn));
    let ent = c.sl::<i32>(U::ent, c.n(U::entN));
    // seeds: road neighbour connections
    let mut ns = 0usize;
    for j in jb..jn {
        if jentc[j] != 0 {
            ns += 1;
        }
    }
    if ns > c.n(U::capSeed) {
        c.set(U::outNeed, ns as i32);
        return -1;
    }
    if ns > 0 && 2 * (ns + 4 * n) + 16 > c.n(U::capQent) {
        c.set(U::outNeed, (2 * (ns + 4 * n) + 16) as i32);
        return -5;
    }
    c.sl::<f32>(U::volInbound, n).fill(0.0);
    c.setf(F::out0, 0.0);
    c.set(U::outCand, 0);
    if ns == 0 {
        return 0;
    }
    let (snode, slabel, sid) = (c.sl::<i32>(U::seedNode, ns), c.sl::<f64>(U::seedLabel, ns), c.sl::<i32>(U::seedId, ns));
    let conns = c.sl::<i32>(U::conns, ns);
    let rt = c.f(F::regionalTime);
    let mut k = 0usize;
    for j in jb..jn {
        if jentc[j] == 0 {
            continue;
        }
        snode[k] = ent[jents[j] as usize];
        slabel[k] = rt;
        sid[k] = k as i32;
        conns[k] = j as i32;
        k += 1;
    }
    let r = run_road_search(c, true, 2, ns, c.f(F::limInbound));
    if r < 0 {
        return r;
    }
    let (dist, src, done) = (c.sl::<f64>(U::sbDist, n), c.sl::<i32>(U::sbSrc, n), c.sl::<u8>(U::sbDone, n));
    let (jslots, jasg, jin, jtype) = (c.sl::<f32>(U::jSlots, jn), c.sl::<f32>(U::jAsg, jn), c.sl::<f32>(U::jInbound, jn), c.sl::<u8>(U::jConnType, jn));
    let (desire, best_node) = (c.sl::<f32>(U::desire, jn), c.sl::<i32>(U::bestNode, jn));
    let (conn_sum, scale) = (c.sl::<f64>(U::connSum, ns), c.sl::<f32>(U::scale, ns));
    desire[..jb].fill(0.0);
    best_node[..jb].fill(-1);
    conn_sum.fill(0.0);
    let fill = c.f(F::regionalFill);
    for j in 0..jb {
        let spare = jslots[j] as f64 - js_min(jslots[j] as f64, jasg[j] as f64);
        if spare <= 0.0 {
            continue;
        }
        let (bn, bd) = best_entry(ent, jents[j].max(0) as usize, jentc[j] as usize, done, dist);
        if bn < 0 {
            continue;
        }
        let f = js_max(0.2, js_min(1.0, 1.3 - bd / 60.0));
        desire[j] = (spare * fill * f) as f32;
        best_node[j] = bn;
        conn_sum[src[bn as usize] as usize] += desire[j] as f64;
    }
    let growth = c.f(F::growth);
    let mut cap_sum = 0.0f64;
    for k in 0..ns {
        cap_sum += conn_workers(c, jtype[conns[k] as usize]) * growth;
    }
    let rwc = c.f(F::regionWorkerCap);
    let cap_mul = if cap_sum > rwc { rwc / cap_sum } else { 1.0 };
    for k in 0..ns {
        let j = conns[k] as usize;
        let cap_w = conn_workers(c, jtype[j]) * growth * cap_mul;
        scale[k] = (if conn_sum[k] > cap_w { cap_w / conn_sum[k] } else { 1.0 }) as f32;
    }
    let acc = c.sl::<f32>(U::acc, n);
    acc.fill(0.0);
    let car_pcu = c.f(F::invCarOcc);
    let in_cand = c.sl::<i32>(U::inCand, jn);
    let mut tot = 0.0f64;
    let mut nc = 0usize;
    for j in 0..jb {
        let bn = best_node[j];
        if bn < 0 {
            continue;
        }
        let bn = bn as usize;
        let inflow = desire[j] as f64 * scale[src[bn] as usize] as f64;
        jin[j] = inflow as f32;
        acc[bn] = (acc[bn] as f64 + inflow * car_pcu) as f32;
        tot += inflow;
        if inflow > 0.0 {
            in_cand[nc] = j as i32;
            nc += 1;
        }
    }
    flows_into_vol(c, 2, false, Some(U::volInbound));
    c.setf(F::out0, tot);
    c.set(U::outCand, nc as i32);
    1
}

/// shopping() (recompute branch): out0 = trips
fn shop(c: &Cx) -> i32 {
    let n = c.n(U::n);
    let (sn, on) = (c.n(U::sN), c.n(U::oN));
    if !entries_ok(c, sn, U::sEntS, U::sEntC) || !entries_ok(c, on, U::oEntS, U::oEntC) {
        return -2;
    }
    let (sents, sentc) = (c.sl::<i32>(U::sEntS, sn), c.sl::<u8>(U::sEntC, sn));
    let ent = c.sl::<i32>(U::ent, c.n(U::entN));
    let mut ns = 0usize;
    for s in 0..sn {
        ns += sentc[s] as usize;
    }
    if ns > c.n(U::capSeed) {
        c.set(U::outNeed, ns as i32);
        return -1;
    }
    if ns > 0 && 2 * (ns + 4 * n) + 16 > c.n(U::capQent) {
        c.set(U::outNeed, (2 * (ns + 4 * n) + 16) as i32);
        return -5;
    }
    c.sl::<f32>(U::volShop, n).fill(0.0);
    c.setf(F::out0, 0.0);
    if ns == 0 {
        return 0;
    }
    let (snode, slabel, sid) = (c.sl::<i32>(U::seedNode, ns), c.sl::<f64>(U::seedLabel, ns), c.sl::<i32>(U::seedId, ns));
    let mut k = 0usize;
    for s in 0..sn {
        let s0 = sents[s] as usize;
        for e in s0..s0 + sentc[s] as usize {
            snode[k] = ent[e];
            slabel[k] = 0.0;
            sid[k] = s as i32;
            k += 1;
        }
    }
    let r = run_road_search(c, false, 2, ns, c.f(F::limShop));
    if r < 0 {
        return r;
    }
    let (dist, src, done) = (c.sl::<f64>(U::sbDist, n), c.sl::<i32>(U::sbSrc, n), c.sl::<u8>(U::sbDone, n));
    let acc = c.sl::<f32>(U::acc, n);
    acc.fill(0.0);
    let (oents, oentc, opop, oshc, osht, oshw) = (
        c.sl::<i32>(U::oEntS, on),
        c.sl::<u8>(U::oEntC, on),
        c.sl::<f32>(U::oPop, on),
        c.sl::<f32>(U::oShC, on),
        c.sl::<f32>(U::oShT, on),
        c.sl::<f32>(U::oShW, on),
    );
    let sload = c.sl::<f32>(U::sLoad, sn);
    let (pcu, per_res) = (c.f(F::shopPcu), c.f(F::shopTrips));
    let mut tot = 0.0f64;
    for o in 0..on {
        let (bn, bd) = best_entry(ent, oents[o].max(0) as usize, oentc[o] as usize, done, dist);
        if bn < 0 {
            continue;
        }
        let bn = bn as usize;
        // exp(-max(0, bd - 8) / 20): the argument is -0 for shops within 8 minutes, exp(-0) = 1 exactly
        let a = js_max(0.0, bd - 8.0);
        let trips = opop[o] as f64 * per_res * (if a == 0.0 { 1.0 } else { exp(-a / 20.0) });
        let car_share = if oshc[o] as f64 + oshw[o] as f64 + osht[o] as f64 > 0.0 { oshc[o] as f64 } else { 0.7 };
        let walkish = if bd < 3.0 { 0.6 } else { 0.0 };
        acc[bn] = (acc[bn] as f64 + trips * car_share * (1.0 - walkish) * pcu) as f32;
        let si = src[bn] as usize;
        sload[si] = (sload[si] as f64 + trips) as f32;
        tot += trips;
    }
    flows_into_vol(c, 2, false, Some(U::volShop));
    c.setf(F::out0, tot);
    1
}

/// freight() (recompute branch): fAcc[f] = freight access, fNode[f] = best node (-1 none); out0 = trucks;
/// status 0 = no sinks (every source 0.15, no search)
fn freight(c: &Cx) -> i32 {
    let n = c.n(U::n);
    let (kn, fnn) = (c.n(U::kN), c.n(U::fN));
    if !entries_ok(c, kn, U::kEntS, U::kEntC) || !entries_ok(c, fnn, U::fEntS, U::fEntC) {
        return -2;
    }
    let (kents, kentc, klabel) = (c.sl::<i32>(U::kEntS, kn), c.sl::<u8>(U::kEntC, kn), c.sl::<f32>(U::kLabel, kn));
    let ent = c.sl::<i32>(U::ent, c.n(U::entN));
    let mut ns = 0usize;
    for k in 0..kn {
        ns += kentc[k] as usize;
    }
    if ns > c.n(U::capSeed) {
        c.set(U::outNeed, ns as i32);
        return -1;
    }
    if ns > 0 && 2 * (ns + 4 * n) + 16 > c.n(U::capQent) {
        c.set(U::outNeed, (2 * (ns + 4 * n) + 16) as i32);
        return -5;
    }
    c.sl::<f32>(U::volFreight, n).fill(0.0);
    c.setf(F::out0, 0.0);
    let (facc, fnode) = (c.sl::<f32>(U::fAcc, fnn), c.sl::<i32>(U::fNode, fnn));
    if ns == 0 {
        facc.fill(0.15);
        fnode.fill(-1);
        return 0;
    }
    let (snode, slabel, sid) = (c.sl::<i32>(U::seedNode, ns), c.sl::<f64>(U::seedLabel, ns), c.sl::<i32>(U::seedId, ns));
    let mut q = 0usize;
    for k in 0..kn {
        let s0 = kents[k] as usize;
        for e in s0..s0 + kentc[k] as usize {
            snode[q] = ent[e];
            slabel[q] = klabel[k] as f64;
            sid[q] = k as i32;
            q += 1;
        }
    }
    let r = run_road_search(c, false, 2, ns, c.f(F::limFreight));
    if r < 0 {
        return r;
    }
    let (dist, done) = (c.sl::<f64>(U::sbDist, n), c.sl::<u8>(U::sbDone, n));
    let acc = c.sl::<f32>(U::acc, n);
    acc.fill(0.0);
    let (fents, fentc, ftrucks) = (c.sl::<i32>(U::fEntS, fnn), c.sl::<u8>(U::fEntC, fnn), c.sl::<f32>(U::fTrucks, fnn));
    let truck_pcu = c.f(F::truckPcu);
    let mut tot = 0.0f64;
    for f in 0..fnn {
        let (bn, bd) = best_entry(ent, fents[f].max(0) as usize, fentc[f] as usize, done, dist);
        if bn < 0 {
            facc[f] = 0.15;
            fnode[f] = -1;
            continue;
        }
        facc[f] = js_max(0.3, js_min(1.0, 1.25 - bd / 60.0)) as f32;
        let trucks = ftrucks[f] as f64;
        let v = bn as usize;
        acc[v] = (acc[v] as f64 + trucks * truck_pcu) as f32;
        tot += trucks;
        fnode[f] = bn;
    }
    flows_into_vol(c, 2, false, Some(U::volFreight));
    c.setf(F::out0, tot);
    1
}

// ------------------------------------------------------------------------------------------------ FINAL
/// finalize(): MSA blend (into acc), traffic / congestion / rail layers, subway riders; out0 congSum, out1 congN
fn finalize(c: &Cx) -> i32 {
    let n = c.n(U::n);
    let cells = c.n(U::cells);
    let (nrail, nsub) = (c.n(U::nRail), c.n(U::nSub));
    let traffic = c.sl::<f32>(U::traffic, cells);
    let congestion = c.sl::<f32>(U::congestion, cells);
    let net = c.sl::<u8>(U::network, cells);
    let (cell_of, cap) = (c.sl::<i32>(U::cellOf, n), c.sl::<f32>(U::cap, n));
    let (rail_cell, sub_cell) = (c.sl::<i32>(U::railCellOf, nrail), c.sl::<i32>(U::subCellOf, nsub));
    let (acc, vol) = (c.sl::<f32>(U::acc, n), c.sl::<f32>(U::volNew, n));
    let (rail_new, sub_new) = (c.sl::<f32>(U::railNew, nrail), c.sl::<f32>(U::subNew, nsub));
    let alpha = c.f(F::alpha);
    for v in 0..n {
        acc[v] = (traffic[cell_of[v] as usize] as f64 * (1.0 - alpha) + vol[v] as f64 * alpha) as f32;
    }
    for v in 0..nrail {
        rail_new[v] = (traffic[rail_cell[v] as usize] as f64 * (1.0 - alpha) + rail_new[v] as f64 * alpha) as f32;
    }
    traffic.fill(0.0);
    congestion.fill(0.0);
    let (street, hw, rail) = (c.w(U::street) as u8, c.w(U::hw) as u8, c.w(U::rail) as u8);
    let mut cong_sum = 0.0f64;
    let mut cong_n = 0i32;
    for v in 0..n {
        let cc = cell_of[v] as usize;
        let t = net[cc];
        if !(t >= street && t <= hw) {
            continue;
        }
        let vol = acc[v];
        traffic[cc] = vol;
        let r = vol as f64 / cap[v] as f64;
        congestion[cc] = r as f32;
        if vol > 1.0 {
            cong_sum += if r > 1.0 { 1.0 } else { r };
            cong_n += 1;
        }
    }
    let rail_cap = c.f(F::railCap);
    for v in 0..nrail {
        let cc = rail_cell[v] as usize;
        if net[cc] != rail {
            continue;
        }
        traffic[cc] = rail_new[v];
        congestion[cc] = (traffic[cc] as f64 / rail_cap) as f32;
    }
    let riders = c.sl::<f32>(U::subwayRiders, cells);
    riders.fill(0.0);
    for v in 0..nsub {
        riders[sub_cell[v] as usize] = sub_new[v];
    }
    c.setf(F::out0, cong_sum);
    c.setf(F::out1, cong_n as f64);
    0
}

/// graph copies in range: adjacency < n (search.rs relies on it), cellOf in [0, cells), comp in [0, nComp)
fn check_graph(c: &Cx) -> i32 {
    let (n, nrail, nsub, cells) = (c.n(U::n), c.n(U::nRail), c.n(U::nSub), c.n(U::cells) as i32);
    let ok_adj = |a: &[i32], m: usize| a.iter().all(|&v| v < 0 || (v as usize) < m);
    let ok_cell = |a: &[i32]| a.iter().all(|&v| v >= 0 && v < cells);
    if !ok_adj(c.sl(U::rev, 4 * n), n) || !ok_adj(c.sl(U::fwd, 4 * n), n) || !ok_adj(c.sl(U::railAdj, 4 * nrail), nrail) || !ok_adj(c.sl(U::subAdj, 4 * nsub), nsub) {
        return -2;
    }
    if !ok_cell(c.sl(U::cellOf, n)) || !ok_cell(c.sl(U::railCellOf, nrail)) || !ok_cell(c.sl(U::subCellOf, nsub)) {
        return -2;
    }
    let nc = c.i(U::nComp);
    if !c.sl::<i32>(U::comp, n).iter().all(|&v| v >= 0 && v < nc) {
        return -2;
    }
    0
}

// ------------------------------------------------------------------------------------------------ exports
macro_rules! export {
    ($name:ident, $f:ident) => {
        /// # Safety
        /// `ctx` must point to a context block written by src/wasm/kernels/trafficBind.ts
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn $name(ctx: *mut u8) -> i32 {
            let c = unsafe { Cx::new(ctx) };
            if !valid_counts(&c) {
                return -6;
            }
            $f(&c)
        }
    };
}
export!(traffic_prep_nodes, prep_nodes);
export!(traffic_prep_origins, prep_origins);
export!(traffic_clusters, clusters);
export!(traffic_prep_stops, prep_stops);
export!(traffic_transfers, transfers);
export!(traffic_transit, transit);
export!(traffic_commute, commute);
export!(traffic_inbound_cached, inbound_cached);
export!(traffic_inbound, inbound);
export!(traffic_shop, shop);
export!(traffic_freight, freight);
export!(traffic_finalize, finalize);
export!(traffic_check_graph, check_graph);

/// roundSearch for `round`
/// # Safety
/// see `export!`
#[unsafe(no_mangle)]
pub unsafe extern "C" fn traffic_round_search(ctx: *mut u8, round: i32) -> i32 {
    let c = unsafe { Cx::new(ctx) };
    if !valid_counts(&c) {
        return -6;
    }
    round_search(&c, round)
}

/// roundMatch for `round` (carPcu / trBonus in F)
/// # Safety
/// see `export!`
#[unsafe(no_mangle)]
pub unsafe extern "C" fn traffic_round_match(ctx: *mut u8, round: i32) -> i32 {
    let c = unsafe { Cx::new(ctx) };
    if !valid_counts(&c) {
        return -6;
    }
    round_match(&c, round)
}

/// volNew += cached volumes: which 0 = volInbound, 1 = volShop, 2 = volFreight
/// # Safety
/// see `export!`
#[unsafe(no_mangle)]
pub unsafe extern "C" fn traffic_add_cached(ctx: *mut u8, which: i32) -> i32 {
    let c = unsafe { Cx::new(ctx) };
    if !valid_counts(&c) {
        return -6;
    }
    add_cached(&c, if which == 0 { U::volInbound } else if which == 1 { U::volShop } else { U::volFreight });
    0
}

/// 0 when the counts fit the capacities, else the number of the first violated condition (diagnostics)
/// # Safety
/// see `export!`
#[unsafe(no_mangle)]
pub unsafe extern "C" fn traffic_counts_check(ctx: *mut u8) -> i32 {
    counts_check(&unsafe { Cx::new(ctx) })
}

/// layout version; `*f_count` / `*u_count` = slot counts
/// # Safety
/// pointers to two writable u32
#[unsafe(no_mangle)]
pub unsafe extern "C" fn traffic_layout(f_count: *mut u32, u_count: *mut u32, hist_rows: *mut u32) -> u32 {
    unsafe {
        *f_count = F::COUNT as u32;
        *u_count = U::COUNT as u32;
        *hist_rows = (HIST_ROWS * RADIX) as u32;
    }
    LAYOUT
}

/// the slot names (0 = F, 1 = U): pointer to the UTF-8 bytes, length in `*len`
/// # Safety
/// `len` must point to a writable u32
#[unsafe(no_mangle)]
pub unsafe extern "C" fn traffic_names(which: i32, len: *mut u32) -> *const u8 {
    let s = if which == 0 { F_NAMES } else { U_NAMES };
    unsafe { *len = s.len() as u32 };
    s.as_ptr()
}

/// Math.exp / Math.log as the kernels compute them (engine self-test and the bit tests)
#[unsafe(no_mangle)]
pub extern "C" fn traffic_exp(x: f64) -> f64 {
    exp(x)
}
#[unsafe(no_mangle)]
pub extern "C" fn traffic_log(x: f64) -> f64 {
    log(x)
}

/// out[i] = exp(x[i]) (which = 0) or log(x[i]) (which = 1), i < n: the bulk bit test
/// # Safety
/// x / out: n f64
#[unsafe(no_mangle)]
pub unsafe extern "C" fn traffic_math_batch(x: *const f64, out: *mut f64, n: i32, which: i32) {
    let (x, out) = unsafe { (core::slice::from_raw_parts(x, n.max(0) as usize), core::slice::from_raw_parts_mut(out, n.max(0) as usize)) };
    if which == 0 {
        for i in 0..x.len() {
            out[i] = exp(x[i]);
        }
    } else {
        for i in 0..x.len() {
            out[i] = log(x[i]);
        }
    }
}

/// benchmark: the radix sort alone on keys[0, n) (u64) with idx = 0..n; returns 1 when the result is in keys2 / idx2
/// # Safety
/// arrays of n elements (hist HIST_ROWS * 2048 u32)
#[unsafe(no_mangle)]
pub unsafe extern "C" fn traffic_bench_sort(keys: *mut u64, keys2: *mut u64, idx: *mut i32, idx2: *mut i32, hist: *mut u32, n: i32) -> i32 {
    let n = n.max(0) as usize;
    unsafe {
        let (k1, k2) = (core::slice::from_raw_parts_mut(keys, n), core::slice::from_raw_parts_mut(keys2, n));
        let (i1, i2) = (core::slice::from_raw_parts_mut(idx, n), core::slice::from_raw_parts_mut(idx2, n));
        let h = core::slice::from_raw_parts_mut(hist, HIST_ROWS * RADIX);
        let mut mk = 0u64;
        for &k in k1.iter() {
            if k > mk {
                mk = k;
            }
        }
        radix_sort(n, mk, k1, k2, i1, i2, h) as i32
    }
}

/// benchmark: the logit mode split of roundMatch on n prepared pieces (utilities uc / ut / uw, times carT / trT /
/// walkT) -> shares sc / st / sw and time (4 outputs per piece in `out`)
/// # Safety
/// u: 6n f64 (uc, ut, uw, carT, trT, walkT interleaved per piece), out: 4n f64
#[unsafe(no_mangle)]
pub unsafe extern "C" fn traffic_bench_logit(u: *const f64, out: *mut f64, n: i32) {
    let n = n.max(0) as usize;
    let (u, out) = unsafe { (core::slice::from_raw_parts(u, 6 * n), core::slice::from_raw_parts_mut(out, 4 * n)) };
    for i in 0..n {
        let (uc, ut, uw, car_t, tr_t, walk) = (u[6 * i], u[6 * i + 1], u[6 * i + 2], u[6 * i + 3], u[6 * i + 4], u[6 * i + 5]);
        let um = js_max(js_max(uc, ut), uw);
        if um == NEG_INF {
            out[4 * i] = f64::NAN;
            continue;
        }
        let ec = share_exp(uc, um);
        let et = share_exp(ut, um);
        let ew = share_exp(uw, um);
        let tot = ec + et + ew;
        let sc = ec / tot;
        let st = et / tot;
        let sw = ew / tot;
        out[4 * i] = sc;
        out[4 * i + 1] = st;
        out[4 * i + 2] = sw;
        out[4 * i + 3] = sc * (if sc > 0.0 { car_t } else { 0.0 }) + st * (if st > 0.0 { tr_t } else { 0.0 }) + sw * (if sw > 0.0 { walk } else { 0.0 });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn radix_sort_is_a_stable_sort() {
        let mut s: u64 = 12345;
        for &(n, bits) in &[(0usize, 1u32), (1, 1), (7, 3), (1000, 11), (5000, 36), (3000, 50), (257, 12)] {
            let mut keys = vec![0u64; n];
            let mut idx: Vec<i32> = (0..n as i32).collect();
            for k in keys.iter_mut() {
                s ^= s << 13;
                s ^= s >> 7;
                s ^= s << 17;
                *k = s & ((1u64 << bits) - 1);
            }
            let mut want: Vec<(u64, i32)> = keys.iter().copied().zip(idx.iter().copied()).collect();
            want.sort_by_key(|p| p.0); // stable
            let mut k2 = vec![0u64; n];
            let mut i2 = vec![0i32; n];
            let mut hist = vec![0u32; HIST_ROWS * RADIX];
            let mk = keys.iter().copied().max().unwrap_or(0);
            let b = radix_sort(n, mk, &mut keys, &mut k2, &mut idx, &mut i2, &mut hist);
            let (rk, ri) = if b { (&k2, &i2) } else { (&keys, &idx) };
            for i in 0..n {
                assert_eq!((rk[i], ri[i]), want[i], "n {n} bits {bits} at {i}");
            }
        }
    }

    #[test]
    fn js_min_max_zero_and_nan() {
        assert_eq!(js_max(0.0, -0.0).to_bits(), 0);
        assert_eq!(js_max(-0.0, 0.0).to_bits(), 0);
        assert_eq!(js_min(0.0, -0.0).to_bits(), (-0.0f64).to_bits());
        assert!(js_max(1.0, f64::NAN).is_nan());
        assert!(js_min(f64::NAN, 1.0).is_nan());
        assert_eq!(js_max(NEG_INF, NEG_INF), NEG_INF);
    }
}
