//! Port of src/sim/infra/search.ts (exact multi-source Dijkstra with Dial bucket queues + forest accumulation) and of
//! the other road searches built on the same model: catchments.ts roadTimeMulti / roadDistMulti (cell-grid Dial
//! searches of the services system) and emergency.ts ChunkedSearch / DispatchSearch (resumable / early-exit searches).
//!
//! Source: search.ts at commit 24f8609, plus the two extensions the live file gained during sim-depth part B (both
//! reduce to the 24f8609 behaviour when unused): the per-node `ramp` interchange minutes of roadSearch and the ferry
//! nodes of the transit net (nodes >= nR + nRail + nSub have no grid adjacency, only transfers).
//!
//! Bit-exactness (checked by tests/wasm/roadTransitSearch.test.ts against the JS originals):
//!  * all labels are f64 computed in the JS evaluation order: `0.5 * (t[u] + t[v])` from f32 values promoted to f64,
//!    `+ ramp`, `key + c`; Float32Array accumulations round to f32 exactly where JS stores (`acc[nx] += f`).
//!  * bucket indices use the exact JS `(x * invQ) | 0` (ToInt32: truncate, wrap modulo 2^32, NaN / inf -> 0) and
//!    `Math.ceil`, so even adversarial inputs (negative / NaN / infinite times or labels) settle the same nodes in the
//!    same order as JS. A push to a bucket outside [0, nb) is lost, exactly as in JS (such buckets are never read).
//!  * the bucket queue is the JS one: per bucket a LIFO singly linked list of entries, buckets drained in ascending
//!    order, stale entries (settled nodes) skipped. Entries are stored as (node, next) pairs in one array instead of
//!    two parallel arrays: same links, same traversal order, one cache line per pop instead of two.
//!
//! Memory: no allocation. The caller passes every array (graph, outputs, queue scratch) as a pointer + capacity; the
//! entry capacity must be >= 2 * (ns + 4n) i32 (a search pushes at most one entry per seed and per improving
//! relaxation: <= 4 per settled node), so the kernel never needs to grow anything. Capacities are checked on entry
//! (negative return = the binding runs JS). Hot loops use unchecked indexing; that is sound because every index is
//! either a node id validated by the caller (adjacency values < n: `search_check_adj`, checked once per graph version;
//! transit tables: checked on every call inside `search_transit`), a counter bounded by the checks above, or a seed
//! node filtered by the same `v < 0 || v >= n` test as JS.

use crate::math::floor;

// ------------------------------------------------------------------------------------------------ JS number helpers

/// JS `x | 0` (ToInt32): truncate toward zero, wrap modulo 2^32; NaN and +-inf give 0.
#[inline(always)]
pub fn to_int32(x: f64) -> i32 {
    // NaN fails both comparisons and takes the slow path; inside this range `as` truncates exactly
    if x > -2147483649.0 && x < 2147483648.0 { x as i32 } else { to_int32_slow(x) }
}

#[cold]
#[inline(never)]
fn to_int32_slow(x: f64) -> i32 {
    let bits = x.to_bits();
    let exp = ((bits >> 52) & 0x7ff) as i32;
    if exp == 0x7ff || exp < 0x3ff {
        return 0; // NaN, +-inf, |x| < 1
    }
    let e = exp - 0x3ff; // x = 1.m * 2^e
    let mant = (bits & 0x000f_ffff_ffff_ffff) | 0x0010_0000_0000_0000; // |x| = mant * 2^(e - 52)
    let t: u64 = if e >= 52 {
        let sh = (e - 52) as u32;
        if sh >= 64 { 0 } else { mant << sh } // only the low 32 bits matter
    } else {
        mant >> (52 - e) as u32
    };
    let r = t as u32;
    (if (bits >> 63) != 0 { r.wrapping_neg() } else { r }) as i32
}

/// JS `Math.ceil` (exact for +-0, NaN, +-inf): ceil(x) = -floor(-x).
#[inline]
pub fn ceil(x: f64) -> f64 {
    -floor(-x)
}

/// JS `Math.ceil(limit * invQ) + 2` as a bucket count: buckets b < nb are processed (`for (b = 0; b < nb; b++)`).
/// Non-positive / -inf counts process nothing. `limit` is already clamped to <= 2000 (or -inf).
#[inline]
fn bucket_count(limit: f64, inv_q: f64) -> usize {
    let nbf = ceil(limit * inv_q) + 2.0;
    if nbf >= 1.0 { if nbf < 4.0e9 { nbf as usize } else { usize::MAX } } else { 0 }
}

macro_rules! at {
    ($a:expr, $i:expr) => {
        *unsafe { $a.get_unchecked($i) }
    };
}
macro_rules! set {
    ($a:expr, $i:expr, $v:expr) => {
        *unsafe { $a.get_unchecked_mut($i) } = $v
    };
}

/// Dial bucket queue in caller memory: `head[b]` = first entry of bucket b (-1 = empty), `ent[2e]` = node,
/// `ent[2e + 1]` = next entry of the same bucket. Buckets are LIFO lists (push = prepend), like search.ts BucketQueue.
struct Buckets<'a> {
    head: &'a mut [i32],
    ent: &'a mut [i32],
    nb: usize,
    en: usize,
}

impl Buckets<'_> {
    /// push `v` to bucket `b`; buckets outside [0, nb) are never read (JS: lost / out-of-range write)
    #[inline(always)]
    fn push(&mut self, b: usize, v: usize) {
        if b < self.nb {
            let e = self.en;
            set!(self.ent, 2 * e, v as i32);
            set!(self.ent, 2 * e + 1, at!(self.head, b));
            set!(self.head, b, e as i32);
            self.en = e + 1;
        }
    }
    /// push from a (possibly negative / huge) ToInt32 bucket index
    #[inline(always)]
    fn push_i(&mut self, b: i32, v: usize) {
        if b >= 0 {
            self.push(b as usize, v);
        }
    }
}

/// Search outputs (the JS Search object's arrays); every slice holds >= n elements.
pub struct Out<'a> {
    pub dist: &'a mut [f64],
    pub src: &'a mut [i32],
    pub next: &'a mut [i32],
    pub hops: &'a mut [u16],
    pub order: &'a mut [i32],
    pub done: &'a mut [u8],
}

impl Out<'_> {
    /// Search.reset(n): dist = +inf, src = next = -1, done = 0 on [0, n) (hops and order are not reset)
    fn reset(&mut self, n: usize) {
        self.dist[..n].fill(f64::INFINITY);
        self.src[..n].fill(-1);
        self.next[..n].fill(-1);
        self.done[..n].fill(0);
    }
}

/// Seeds object (node, label, id) x ns
pub struct SeedList<'a> {
    pub node: &'a [i32],
    pub label: &'a [f64],
    pub id: &'a [i32],
}

/// the seed loop shared by roadSearch / transitSearch (search.ts, identical in both)
#[inline(always)]
fn push_seeds(seeds: &SeedList, n: usize, limit: f64, inv_q: f64, o: &mut Out, q: &mut Buckets) {
    for s in 0..seeds.node.len() {
        let v = seeds.node[s];
        let l = seeds.label[s];
        if v < 0 || v as usize >= n || !(l <= limit) {
            continue;
        }
        let v = v as usize;
        if l < o.dist[v] {
            o.dist[v] = l;
            o.src[v] = seeds.id[s];
            o.next[v] = -1;
            o.hops[v] = 0;
            q.push_i(to_int32(l * inv_q), v);
        }
    }
}

// ------------------------------------------------------------------------------------------------ roadSearch

/// Road graph inputs of one roadSearch call.
pub struct RoadIn<'a> {
    /// 4 neighbour slots per node (g.fwd or g.rev), values < n (negative = no edge)
    pub adj: &'a [i32],
    /// node travel minutes (f32)
    pub time: &'a [f32],
    /// Network type per node
    pub typ: &'a [u8],
    pub hw: u8,
    /// per-node interchange minutes (live search.ts `ramp`), or empty = flat `ramp_pen` (RAMP_PENALTY)
    pub ramp: &'a [f32],
    pub ramp_pen: f64,
}

/// roadSearch (search.ts) including S.reset(n). Returns S.settled.
pub fn road_search(n: usize, g: &RoadIn, seeds: &SeedList, limit_in: f64, inv_q: f64, o: &mut Out, head: &mut [i32], ent: &mut [i32]) -> i32 {
    if g.ramp.is_empty() { road_search_impl::<false>(n, g, seeds, limit_in, inv_q, o, head, ent) } else { road_search_impl::<true>(n, g, seeds, limit_in, inv_q, o, head, ent) }
}

#[inline(always)]
fn road_search_impl<const RAMP: bool>(
    n: usize, g: &RoadIn, seeds: &SeedList, limit_in: f64, inv_q: f64, o: &mut Out, head: &mut [i32], ent: &mut [i32],
) -> i32 {
    o.reset(n);
    let limit = if limit_in < 2000.0 { limit_in } else { 2000.0 };
    let nb = bucket_count(limit, inv_q);
    if nb > head.len() {
        return -1;
    }
    head[..nb].fill(-1);
    let mut q = Buckets { head, ent, nb, en: 0 };
    push_seeds(seeds, n, limit, inv_q, o, &mut q);
    let (adj, time, typ, ramp) = (g.adj, g.time, g.typ, g.ramp);
    let (hw, ramp_pen) = (g.hw, g.ramp_pen);
    let dist = &mut *o.dist;
    let src = &mut *o.src;
    let next = &mut *o.next;
    let hops = &mut *o.hops;
    let order = &mut *o.order;
    let done = &mut *o.done;
    let mut cnt = 0usize;
    for b in 0..nb {
        let mut e = at!(q.head, b);
        while e >= 0 {
            let ei = e as usize;
            let u = at!(q.ent, 2 * ei) as usize;
            e = at!(q.ent, 2 * ei + 1);
            if at!(done, u) == 1 {
                continue;
            }
            set!(done, u, 1);
            set!(order, cnt, u as i32);
            cnt += 1;
            let key = at!(dist, u);
            let tu = at!(time, u) as f64;
            let hu = at!(typ, u) == hw;
            let su = at!(src, u);
            let hp = at!(hops, u) as u32 + 1;
            let hp = if hp > 65535 { 65535 } else { hp as u16 };
            let base = u * 4;
            for k in 0..4 {
                let v = at!(adj, base + k);
                if v < 0 {
                    continue;
                }
                let v = v as usize;
                if at!(done, v) == 1 {
                    continue;
                }
                let mut c = 0.5 * (tu + at!(time, v) as f64);
                if hu != (at!(typ, v) == hw) {
                    c += if RAMP { at!(ramp, if hu { v } else { u }) as f64 } else { ramp_pen };
                }
                let nd = key + c;
                if nd < at!(dist, v) && nd <= limit {
                    set!(dist, v, nd);
                    set!(src, v, su);
                    set!(next, v, u as i32);
                    set!(hops, v, hp);
                    let bi = to_int32(nd * inv_q);
                    // bi > b always holds for real inputs (edge cost >= Q); JS guards float edge cases the same way
                    if bi > b as i32 { q.push(bi as usize, v) } else { q.push(b + 1, v) }
                }
            }
        }
        set!(q.head, b, -1);
    }
    cnt as i32
}

// ------------------------------------------------------------------------------------------------ transitSearch

/// Transit net inputs (search.ts TransitNet): nodes [0, nR) road (bus riding, roadAdj = g.rev), [nR, nRR) rail,
/// [nRR, nGrid) subway, [nGrid, total) ferry (transfers only; the 24f8609 net has none), CSR transfers.
pub struct TransitIn<'a> {
    pub n_r: usize,
    pub n_rail: usize,
    pub n_sub: usize,
    pub total: usize,
    pub road_adj: &'a [i32],
    pub bus_time: &'a [f32],
    pub rail_adj: &'a [i32],
    pub sub_adj: &'a [i32],
    pub rail_time: f64,
    pub sub_time: f64,
    pub tr_start: &'a [i32],
    pub tr_to: &'a [i32],
    pub tr_cost: &'a [f32],
}

impl TransitIn<'_> {
    /// every index the search can follow is in range (else the binding runs JS)
    pub fn valid(&self) -> bool {
        let (n_r, n_rail, n_sub, total) = (self.n_r, self.n_rail, self.n_sub, self.total);
        if n_r.checked_add(n_rail).and_then(|x| x.checked_add(n_sub)).map_or(true, |g| g > total) {
            return false;
        }
        if self.road_adj.len() < 4 * n_r || self.bus_time.len() < n_r || self.rail_adj.len() < 4 * n_rail || self.sub_adj.len() < 4 * n_sub {
            return false;
        }
        if self.tr_start.len() < total + 1 {
            return false;
        }
        let ok = |a: &[i32], m: usize| a.iter().all(|&v| v < 0 || (v as usize) < m);
        if !ok(&self.road_adj[..4 * n_r], n_r) || !ok(&self.rail_adj[..4 * n_rail], n_rail) || !ok(&self.sub_adj[..4 * n_sub], n_sub) {
            return false;
        }
        // CSR: non-decreasing starts inside the transfer arrays, targets in [0, total)
        let nt = self.tr_to.len().min(self.tr_cost.len());
        let st = &self.tr_start[..total + 1];
        if st[0] < 0 {
            return false;
        }
        for i in 0..total {
            if st[i + 1] < st[i] {
                return false;
            }
        }
        if st[total] as usize > nt {
            return false;
        }
        self.tr_to[..st[total] as usize].iter().all(|&v| v >= 0 && (v as usize) < total)
    }
}

/// transitSearch (search.ts) including S.reset(total). Returns S.settled, or -3 for an invalid net.
pub fn transit_search(t: &TransitIn, seeds: &SeedList, limit_in: f64, inv_q: f64, o: &mut Out, head: &mut [i32], ent: &mut [i32]) -> i32 {
    if !t.valid() {
        return -3;
    }
    let n = t.total;
    o.reset(n);
    let limit = if limit_in < 2000.0 { limit_in } else { 2000.0 };
    let nb = bucket_count(limit, inv_q);
    if nb > head.len() {
        return -1;
    }
    head[..nb].fill(-1);
    let mut q = Buckets { head, ent, nb, en: 0 };
    push_seeds(seeds, n, limit, inv_q, o, &mut q);
    let n_r = t.n_r;
    let n_rr = t.n_r + t.n_rail;
    let n_grid = n_rr + t.n_sub;
    let (road_adj, bus_time, rail_adj, sub_adj) = (t.road_adj, t.bus_time, t.rail_adj, t.sub_adj);
    let (tr_start, tr_to, tr_cost) = (t.tr_start, t.tr_to, t.tr_cost);
    let (rail_time, sub_time) = (t.rail_time, t.sub_time);
    let dist = &mut *o.dist;
    let src = &mut *o.src;
    let next = &mut *o.next;
    let hops = &mut *o.hops;
    let order = &mut *o.order;
    let done = &mut *o.done;
    let mut cnt = 0usize;
    // one relaxation (search.ts: `if (done[v] === 1) continue; const nd = key + c; if (nd < dist[v] && nd <= limit)`)
    macro_rules! relax {
        ($v:expr, $nd:expr, $b:expr, $su:expr, $u:expr, $hp:expr) => {{
            let v: usize = $v;
            if at!(done, v) != 1 {
                let nd: f64 = $nd;
                if nd < at!(dist, v) && nd <= limit {
                    set!(dist, v, nd);
                    set!(src, v, $su);
                    set!(next, v, $u as i32);
                    set!(hops, v, $hp);
                    let bi = to_int32(nd * inv_q);
                    if bi > $b as i32 { q.push(bi as usize, v) } else { q.push($b + 1, v) }
                }
            }
        }};
    }
    for b in 0..nb {
        let mut e = at!(q.head, b);
        while e >= 0 {
            let ei = e as usize;
            let u = at!(q.ent, 2 * ei) as usize;
            e = at!(q.ent, 2 * ei + 1);
            if at!(done, u) == 1 {
                continue;
            }
            set!(done, u, 1);
            set!(order, cnt, u as i32);
            cnt += 1;
            let key = at!(dist, u);
            let su = at!(src, u);
            let hp = at!(hops, u) as u32 + 1;
            let hp = if hp > 65535 { 65535 } else { hp as u16 };
            if u < n_r {
                let tu = at!(bus_time, u) as f64;
                for k in 0..4 {
                    let v = at!(road_adj, u * 4 + k);
                    if v < 0 {
                        continue;
                    }
                    let v = v as usize;
                    let c = 0.5 * (tu + at!(bus_time, v) as f64);
                    relax!(v, key + c, b, su, u, hp);
                }
            } else if u < n_rr {
                for k in 0..4 {
                    let a = at!(rail_adj, (u - n_r) * 4 + k);
                    if a < 0 {
                        continue;
                    }
                    relax!(a as usize + n_r, key + rail_time, b, su, u, hp);
                }
            } else if u < n_grid {
                for k in 0..4 {
                    let a = at!(sub_adj, (u - n_rr) * 4 + k);
                    if a < 0 {
                        continue;
                    }
                    relax!(a as usize + n_rr, key + sub_time, b, su, u, hp);
                }
            }
            let t1 = at!(tr_start, u + 1) as usize;
            let mut tt = at!(tr_start, u) as usize;
            while tt < t1 {
                let v = at!(tr_to, tt) as usize;
                relax!(v, key + at!(tr_cost, tt) as f64, b, su, u, hp);
                tt += 1;
            }
        }
        set!(q.head, b, -1);
    }
    cnt as i32
}

// ------------------------------------------------------------------------------------------------ accumulate

/// one onSink record: (flow, seed id, node); the binding replays onSink(src, flow, node) in record order
#[repr(C)]
pub struct Sink {
    pub f: f64,
    pub src: i32,
    pub node: i32,
}

/// accumulate(S, acc, onSink) for a Float32Array acc (search.ts): walk `order` backwards, acc[next[v]] += acc[v]
/// (f32 store), roots emit a sink record. Bounds-checked (indices come from a Search object JS code can write).
pub fn accumulate_f32(order: &[i32], next: &[i32], src: &[i32], acc: &mut [f32], sinks: &mut [Sink]) -> usize {
    let mut ns = 0usize;
    let want = !sinks.is_empty();
    for k in (0..order.len()).rev() {
        let v = order[k] as usize;
        let f = acc[v];
        if f == 0.0 {
            continue;
        }
        let nx = next[v];
        if nx >= 0 {
            let j = nx as usize;
            // one f32 + f32 add rounded to f32 == the f64 add rounded to f32 (JS: acc[nx] += f)
            acc[j] += f;
        } else if want {
            sinks[ns] = Sink { f: f as f64, src: src[v], node: v as i32 };
            ns += 1;
        }
    }
    ns
}

/// accumulate for a Float64Array acc
pub fn accumulate_f64(order: &[i32], next: &[i32], src: &[i32], acc: &mut [f64], sinks: &mut [Sink]) -> usize {
    let mut ns = 0usize;
    let want = !sinks.is_empty();
    for k in (0..order.len()).rev() {
        let v = order[k] as usize;
        let f = acc[v];
        if f == 0.0 {
            continue;
        }
        let nx = next[v];
        if nx >= 0 {
            let j = nx as usize;
            acc[j] += f;
        } else if want {
            sinks[ns] = Sink { f, src: src[v], node: v as i32 };
            ns += 1;
        }
    }
    ns
}

// ------------------------------------------------------------------------------------------------ exports

use core::slice::{from_raw_parts as sl, from_raw_parts_mut as slm};

/// empty slice for a null pointer (optional arguments)
#[inline(always)]
unsafe fn opt<'a, T>(p: *const T, len: usize) -> &'a [T] {
    if p.is_null() || len == 0 { &[] } else { unsafe { sl(p, len) } }
}

/// 1 when every adjacency value is < n (negative = no edge), else 0. The binding calls it once per cached graph
/// version; the search kernels rely on it (unchecked neighbour loads).
///
/// # Safety
/// `adj` must point to `len` i32 values.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn search_check_adj(adj: *const i32, len: i32, n: i32) -> i32 {
    let a = unsafe { opt(adj, len.max(0) as usize) };
    a.iter().all(|&v| v < n) as i32
}

/// `x | 0` exactly as JS (test hook for the ToInt32 emulation)
#[unsafe(no_mangle)]
pub extern "C" fn search_to_int32(x: f64) -> i32 {
    to_int32(x)
}

/// `Math.ceil(x)` exactly as JS (test hook)
#[unsafe(no_mangle)]
pub extern "C" fn search_ceil(x: f64) -> f64 {
    ceil(x)
}

/// roadSearch(g, adj, time, S, heap, seeds, limit, ramp) including S.reset(n); returns S.settled, or a negative
/// code when a capacity is too small (-1 head, -2 entries, -4 bad n).
///
/// `ramp` may be null (flat `ramp_pen`). `limit` is the JS argument after its default (400); the kernel applies the
/// `limit < 2000` clamp. `inv_q` = 1 / (MIN_ROAD_T * 0.999) from JS. `ent` holds `ecap` i32 = (node, next) pairs.
///
/// # Safety
/// Every pointer must reference the stated number of elements (adj 4n, time / typ / ramp n, outputs >= n, seeds ns,
/// head `head_len`, ent `ecap`); `adj` values must be < n (`search_check_adj`); output arrays must not alias inputs.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn search_road(
    n: i32, adj: *const i32, time: *const f32, typ: *const u8, hw: i32, ramp: *const f32, ramp_pen: f64,
    s_node: *const i32, s_label: *const f64, s_id: *const i32, ns: i32, limit: f64, inv_q: f64,
    dist: *mut f64, src: *mut i32, next: *mut i32, hops: *mut u16, order: *mut i32, done: *mut u8,
    head: *mut i32, head_len: i32, ent: *mut i32, ecap: i32,
) -> i32 {
    if n < 0 || ns < 0 || head_len < 0 || ecap < 0 {
        return -4;
    }
    let (nu, nsu) = (n as usize, ns as usize);
    if (ecap as usize) < 2 * (nsu + 4 * nu) {
        return -2;
    }
    unsafe {
        let g = RoadIn { adj: opt(adj, 4 * nu), time: opt(time, nu), typ: opt(typ, nu), hw: hw as u8, ramp: opt(ramp, nu), ramp_pen };
        let seeds = SeedList { node: opt(s_node, nsu), label: opt(s_label, nsu), id: opt(s_id, nsu) };
        let mut o = Out {
            dist: slm(dist, nu), src: slm(src, nu), next: slm(next, nu), hops: slm(hops, nu), order: slm(order, nu), done: slm(done, nu),
        };
        road_search(nu, &g, &seeds, limit, inv_q, &mut o, slm(head, head_len as usize), slm(ent, ecap as usize))
    }
}

/// transitSearch(T, S, heap, seeds, limit) including S.reset(total); returns S.settled or a negative code (-3 = the
/// net fails validation, e.g. an adjacency value out of range: the binding runs JS).
///
/// # Safety
/// Pointers must reference: road_adj 4 n_r, bus_time n_r, rail_adj 4 n_rail, sub_adj 4 n_sub, tr_start total + 1,
/// tr_to / tr_cost n_tr, outputs >= total, seeds ns, head head_len, ent ecap.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn search_transit(
    n_r: i32, n_rail: i32, n_sub: i32, total: i32, road_adj: *const i32, bus_time: *const f32, rail_adj: *const i32, sub_adj: *const i32,
    rail_time: f64, sub_time: f64, tr_start: *const i32, tr_to: *const i32, tr_cost: *const f32, n_tr: i32,
    s_node: *const i32, s_label: *const f64, s_id: *const i32, ns: i32, limit: f64, inv_q: f64,
    dist: *mut f64, src: *mut i32, next: *mut i32, hops: *mut u16, order: *mut i32, done: *mut u8,
    head: *mut i32, head_len: i32, ent: *mut i32, ecap: i32,
) -> i32 {
    if n_r < 0 || n_rail < 0 || n_sub < 0 || total < 0 || n_tr < 0 || ns < 0 || head_len < 0 || ecap < 0 {
        return -4;
    }
    let (nr, nrl, nsb, tot, nt, nsu) = (n_r as usize, n_rail as usize, n_sub as usize, total as usize, n_tr as usize, ns as usize);
    if (ecap as usize) < 2 * (nsu + 4 * tot + nt) {
        return -2;
    }
    unsafe {
        let t = TransitIn {
            n_r: nr, n_rail: nrl, n_sub: nsb, total: tot, road_adj: opt(road_adj, 4 * nr), bus_time: opt(bus_time, nr), rail_adj: opt(rail_adj, 4 * nrl),
            sub_adj: opt(sub_adj, 4 * nsb), rail_time, sub_time, tr_start: opt(tr_start, tot + 1), tr_to: opt(tr_to, nt), tr_cost: opt(tr_cost, nt),
        };
        let seeds = SeedList { node: opt(s_node, nsu), label: opt(s_label, nsu), id: opt(s_id, nsu) };
        let mut o = Out {
            dist: slm(dist, tot), src: slm(src, tot), next: slm(next, tot), hops: slm(hops, tot), order: slm(order, tot), done: slm(done, tot),
        };
        transit_search(&t, &seeds, limit, inv_q, &mut o, slm(head, head_len as usize), slm(ent, ecap as usize))
    }
}

/// accumulate(S, acc, onSink) over `settled` nodes with a Float32Array (`f64acc` = 0) or Float64Array (`f64acc` = 1)
/// acc of `acc_len` elements. Sink records (16 bytes: f64 flow, i32 seed id, i32 node) are written to `sinks` when it
/// is non-null (room for `settled` records). Returns the number of sink records. An out-of-range index traps (the
/// binding then runs JS on the untouched original).
///
/// # Safety
/// order: `settled` i32; next / src: `n` i32; acc: `acc_len` f32 / f64; sinks: null or room for `settled` records.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn search_accumulate(
    order: *const i32, next: *const i32, src: *const i32, n: i32, settled: i32, acc: *mut u8, acc_len: i32, f64acc: i32, sinks: *mut Sink,
) -> i32 {
    if n < 0 || settled < 0 || acc_len < 0 {
        return -4;
    }
    let (nu, k) = (n as usize, settled as usize);
    unsafe {
        let order = opt(order, k);
        let next = opt(next, nu);
        let src = opt(src, nu);
        let sinks: &mut [Sink] = if sinks.is_null() || k == 0 { &mut [] } else { slm(sinks, k) };
        let r = if f64acc != 0 {
            accumulate_f64(order, next, src, slm(acc as *mut f64, acc_len as usize), sinks)
        } else {
            accumulate_f32(order, next, src, slm(acc as *mut f32, acc_len as usize), sinks)
        };
        r as i32
    }
}

// ------------------------------------------------------------------------------------------------ catchments.ts
//
// roadTimeMulti / roadDistMulti: multi-source Dial searches over the cell grid (st.network) with small integer costs.
// Neighbours in slot order -x, +x, -z, +z; a move between a highway and a non-highway cell is a ramp (cost + ramp)
// except to / from a street (no ramp: the move is skipped). Labels are exact integers (the binding validates the cost
// tables: integers in [0, 2^20]; 0 = impassable), so every relaxation raises the label (cost >= 1) and each cell is
// processed at most once: <= cells + 4 cells pushes (entry capacity 2 x (seeds + 5 C) i32).

/// grid neighbour `k` of cell u = (x, z) or usize::MAX at the map edge
#[inline(always)]
fn grid_nb(u: usize, x: usize, z: usize, n_side: usize, k: usize) -> usize {
    match k {
        0 => if x == 0 { usize::MAX } else { u - 1 },
        1 => if x == n_side - 1 { usize::MAX } else { u + 1 },
        2 => if z == 0 { usize::MAX } else { u - n_side },
        _ => if z == n_side - 1 { usize::MAX } else { u + n_side },
    }
}

/// catchments.ts roadTimeMulti: linear Dial (limit_q + 1 buckets). `out` holds the seed labels (< 0 = no seed) on
/// input and the settled labels on output (unreached cells keep their negative input value). `cost[t]` = netTimeQ[t]
/// for every network value t present (the binding checks coverage). Returns the settled cell count, or < 0 on a
/// capacity / input problem (the binding then runs JS).
pub fn road_time_multi(
    n_side: usize, net: &[u8], out: &mut [i32], limit_q: i32, cost: &[i32], ramp_q: i32, hw: u8, street: u8, head: &mut [i32], ent: &mut [i32],
) -> i32 {
    let c_n = n_side * n_side;
    if net.len() < c_n || out.len() < c_n || limit_q < 0 {
        return -4;
    }
    let nb = limit_q as usize + 1;
    if head.len() < nb || ent.len() < 2 * (5 * c_n) {
        return -1;
    }
    if net[..c_n].iter().any(|&t| t as usize >= cost.len()) {
        return -5;
    }
    head[..nb].fill(-1);
    let mut en = 0usize;
    let mut pending = 0usize;
    macro_rules! push {
        ($b:expr, $v:expr) => {{
            let b: usize = $b;
            set!(ent, 2 * en, $v as i32);
            set!(ent, 2 * en + 1, at!(head, b));
            set!(head, b, en as i32);
            en += 1;
            pending += 1;
        }};
    }
    for i in 0..c_n {
        let l = out[i];
        if l < 0 {
            continue;
        }
        if l > limit_q || cost[net[i] as usize] == 0 {
            out[i] = -1;
            continue;
        }
        push!(l as usize, i);
    }
    let mut settled = 0i32;
    let mut cur = 0usize;
    while cur < nb && pending > 0 {
        let mut e = at!(head, cur);
        set!(head, cur, -1);
        while e >= 0 {
            let ei = e as usize;
            let u = at!(ent, 2 * ei) as usize;
            e = at!(ent, 2 * ei + 1);
            pending -= 1;
            if at!(out, u) != cur as i32 {
                continue;
            }
            settled += 1;
            let x = u % n_side;
            let z = u / n_side;
            let tu = at!(net, u);
            let hu = tu == hw;
            for k in 0..4 {
                let j = grid_nb(u, x, z, n_side, k);
                if j == usize::MAX {
                    continue;
                }
                let tj = at!(net, j);
                let mut c = at!(cost, tj as usize);
                if c == 0 {
                    continue;
                }
                if hu != (tj == hw) {
                    if tu == street || tj == street {
                        continue;
                    }
                    c += ramp_q;
                }
                let nd = cur as i32 + c;
                if nd > limit_q {
                    continue;
                }
                let oj = at!(out, j);
                if oj < 0 || nd < oj {
                    set!(out, j, nd);
                    push!(nd as usize, j);
                }
            }
        }
        cur += 1;
    }
    settled
}

/// catchments.ts roadDistMulti: circular 8-slot Dial from `seeds` (label 0) up to max_q; `out` (out_len >= C cells) is
/// filled with -1 first. `drive` adds `ramp` on highway <-> road moves (never street <-> highway). Seeds must be cells
/// in [0, C) (checked by the binding). Returns the settled count.
pub fn road_dist_multi(
    n_side: usize, net: &[u8], seeds: &[i32], max_q: i32, cost: &[i32], drive: bool, ramp: i32, hw: u8, street: u8, out: &mut [i32], head: &mut [i32; 8],
    ent: &mut [i32],
) -> i32 {
    let c_n = n_side * n_side;
    if net.len() < c_n || out.len() < c_n {
        return -4;
    }
    if ent.len() < 2 * (seeds.len() + 4 * c_n) {
        return -1;
    }
    if net[..c_n].iter().any(|&t| t as usize >= cost.len()) {
        return -5;
    }
    out.fill(-1);
    head.fill(-1);
    let mut en = 0usize;
    let mut pending = 0usize;
    macro_rules! push {
        ($slot:expr, $v:expr) => {{
            let b: usize = $slot;
            set!(ent, 2 * en, $v as i32);
            set!(ent, 2 * en + 1, head[b]);
            head[b] = en as i32;
            en += 1;
            pending += 1;
        }};
    }
    for &i in seeds {
        let i = i as usize;
        if out[i] == 0 || cost[net[i] as usize] == 0 {
            continue;
        }
        out[i] = 0;
        push!(0, i);
    }
    let mut settled = 0i32;
    let mut cur: i32 = 0;
    while pending > 0 {
        let slot = (cur & 7) as usize;
        let mut e = head[slot];
        head[slot] = -1;
        while e >= 0 {
            let ei = e as usize;
            let u = at!(ent, 2 * ei) as usize;
            e = at!(ent, 2 * ei + 1);
            pending -= 1;
            if at!(out, u) != cur {
                continue;
            }
            settled += 1;
            let x = u % n_side;
            let z = u / n_side;
            let tu = at!(net, u);
            let hu = tu == hw;
            for k in 0..4 {
                let j = grid_nb(u, x, z, n_side, k);
                if j == usize::MAX {
                    continue;
                }
                let tj = at!(net, j);
                let mut c = at!(cost, tj as usize);
                if c == 0 {
                    continue;
                }
                if drive && hu != (tj == hw) {
                    if tu == street || tj == street {
                        continue;
                    }
                    c += ramp;
                }
                let nd = cur + c;
                if nd > max_q {
                    continue;
                }
                let oj = at!(out, j);
                if oj < 0 || nd < oj {
                    set!(out, j, nd);
                    push!((nd & 7) as usize, j);
                }
            }
        }
        cur += 1;
    }
    settled
}

// ------------------------------------------------------------------------------------------------ emergency.ts
//
// ChunkedSearch: resumable forward Dial search (roadSearch's model: labels only), settled in chunks of maxSettle.
// DispatchSearch: reverse Dial search from zero-label seeds with an early exit: at every settled node with station
// entries (stHead[u] >= 0) it yields to JS, where the visitor runs; JS resumes it (or stops it) and may lower `stop`.
// Both keep their whole state in caller memory between calls, so JS can interleave other work.

/// scalar state of a ChunkedSearch (lives in wasm memory next to its arrays)
#[repr(C)]
pub struct ChunkState {
    pub n: i32,
    pub nb: i32,
    pub b: i32,
    pub en: i32,
    pub settled: i32,
    pub head_len: i32,
    pub ecap: i32,
    pub _pad: i32,
    pub limit: f64,
    pub inv_q: f64,
}

/// ChunkedSearch.start: dist = +inf / done = 0 on [0, n), queue reset, seeds pushed (labels > limit, NaN or nodes out
/// of range skipped; a seed bucket outside [0, nb) is lost exactly like the JS out-of-range head write)
pub fn chunk_start(st: &mut ChunkState, seeds: &SeedList, limit_in: f64, inv_q: f64, dist: &mut [f64], done: &mut [u8], head: &mut [i32], ent: &mut [i32]) -> i32 {
    let n = st.n.max(0) as usize;
    dist[..n].fill(f64::INFINITY);
    done[..n].fill(0);
    let limit = if limit_in < 2000.0 { limit_in } else { 2000.0 };
    let nb = bucket_count(limit, inv_q);
    if nb > head.len() || ent.len() < 2 * (seeds.node.len() + 4 * n) {
        return -1;
    }
    head[..nb].fill(-1);
    st.limit = limit;
    st.inv_q = inv_q;
    st.nb = nb as i32;
    st.b = 0;
    st.settled = 0;
    let mut q = Buckets { head, ent, nb, en: 0 };
    for s in 0..seeds.node.len() {
        let v = seeds.node[s];
        let l = seeds.label[s];
        if v < 0 || v as usize >= n || !(l <= limit) {
            continue;
        }
        let v = v as usize;
        if l < dist[v] {
            dist[v] = l;
            q.push_i(to_int32(l * inv_q), v);
        }
    }
    st.en = q.en as i32;
    0
}

/// ChunkedSearch.step: settle up to `max_settle` more nodes; returns 1 when the search is complete, 0 otherwise
pub fn chunk_step(st: &mut ChunkState, g: &RoadIn, max_settle: i32, dist: &mut [f64], done: &mut [u8], head: &mut [i32], ent: &mut [i32]) -> i32 {
    let n = st.n as usize;
    let nb = st.nb as usize;
    let limit = st.limit;
    let inv_q = st.inv_q;
    let mut q = Buckets { head, ent, nb, en: st.en as usize };
    let (adj, time, typ) = (g.adj, g.time, g.typ);
    let (hw, ramp_pen) = (g.hw, g.ramp_pen);
    let mut cnt = st.settled as i64;
    let stop_at = cnt + max_settle as i64;
    let mut b = st.b.max(0) as usize;
    'outer: while b < nb {
        let mut e = at!(q.head, b);
        while e >= 0 {
            if cnt >= stop_at {
                set!(q.head, b, e); // resume here (pushes never land in the current bucket)
                break 'outer;
            }
            let ei = e as usize;
            let u = at!(q.ent, 2 * ei) as usize;
            e = at!(q.ent, 2 * ei + 1);
            if u >= n || at!(done, u) == 1 {
                continue;
            }
            set!(done, u, 1);
            cnt += 1;
            let key = at!(dist, u);
            let tu = at!(time, u) as f64;
            let hu = at!(typ, u) == hw;
            let base = u * 4;
            for k in 0..4 {
                let v = at!(adj, base + k);
                if v < 0 {
                    continue;
                }
                let v = v as usize;
                if at!(done, v) == 1 {
                    continue;
                }
                let mut c = 0.5 * (tu + at!(time, v) as f64);
                if hu != (at!(typ, v) == hw) {
                    c += ramp_pen;
                }
                let nd = key + c;
                if nd < at!(dist, v) && nd <= limit {
                    set!(dist, v, nd);
                    let bi = to_int32(nd * inv_q);
                    if bi > b as i32 { q.push(bi as usize, v) } else { q.push(b + 1, v) }
                }
            }
        }
        set!(q.head, b, -1);
        b += 1;
    }
    st.b = b as i32;
    st.en = q.en as i32;
    st.settled = cnt as i32;
    (b >= nb) as i32
}

/// scalar state of a DispatchSearch run (JS mirrors capacities / stamps; the kernel only runs the loop)
#[repr(C)]
pub struct DispatchState {
    pub n: i32,
    pub ns: i32,
    /// bucket count of this run
    pub nb: i32,
    /// current bucket and the next entry of its list (resume point after a yield)
    pub b: i32,
    pub e: i32,
    pub en: i32,
    pub max_b: i32,
    pub cnt: i32,
    /// node whose edges are relaxed after the visitor returned false (-1 = none)
    pub u: i32,
    /// 1 = a visitor exists (yield at nodes with stHead[u] >= 0, or at every node without stHead)
    pub visit: i32,
    pub stamp: u32,
    pub head_len: i32,
    pub ecap: i32,
    pub _pad: i32,
    pub limit: f64,
    pub inv_q: f64,
    /// the JS `this.stop` (the visitor may lower it; the binding writes it before every resume)
    pub stop: f64,
    /// the label of the node yielded to JS
    pub key: f64,
}

/// DispatchSearch arrays (JS capacities: dist / next / mark / done >= n, head `head_len`, entries `ecap`)
pub struct DispatchMem<'a> {
    pub dist: &'a mut [f64],
    pub next: &'a mut [i32],
    pub mark: &'a mut [u32],
    pub done: &'a mut [u32],
    pub head: &'a mut [i32],
    pub enode: &'a mut [i32],
    pub enext: &'a mut [i32],
    pub st_head: &'a [i32],
}

impl DispatchMem<'_> {
    /// JS push: enode[en] = v; enext[en] = head[bb] (undefined -> 0 past the array); head[bb] = en (dropped past it)
    #[inline(always)]
    fn push(&mut self, st: &mut DispatchState, bb: usize, v: usize) {
        let en = st.en as usize;
        let hl = self.head.len();
        set!(self.enode, en, v as i32);
        set!(self.enext, en, if bb < hl { at!(self.head, bb) } else { 0 });
        if bb < hl {
            set!(self.head, bb, en as i32);
        }
        st.en += 1;
    }
}

/// DispatchSearch.run up to the first yield / the end. Seeds: node ids, label 0 (JS: `mark[v] === S && dist[v] === 0`
/// skips duplicates). Returns 1 = yielded (st.u / st.key = the node for the visitor), 0 = finished (st.cnt = settled).
pub fn dispatch_start(st: &mut DispatchState, seeds: &[i32], g: &RoadIn, m: &mut DispatchMem) -> i32 {
    let n = st.n as usize;
    let s = st.stamp;
    st.en = 0;
    st.max_b = 0;
    st.cnt = 0;
    st.b = 0;
    st.u = -1;
    for &v in seeds {
        if v < 0 || v as usize >= n {
            continue;
        }
        let v = v as usize;
        if at!(m.mark, v) == s && at!(m.dist, v) == 0.0 {
            continue;
        }
        set!(m.mark, v, s);
        set!(m.dist, v, 0.0);
        set!(m.next, v, -1);
        m.push(st, 0, v);
    }
    st.e = if st.nb > 0 { at!(m.head, 0) } else { -1 };
    dispatch_loop(st, g, m, false)
}

/// continue after a yield (the visitor returned false): relax the yielded node, then run to the next yield / the end
pub fn dispatch_resume(st: &mut DispatchState, g: &RoadIn, m: &mut DispatchMem) -> i32 {
    dispatch_loop(st, g, m, true)
}

/// the visitor returned true (break outer): clear the buckets that still hold entries; returns 0
pub fn dispatch_finish(st: &mut DispatchState, m: &mut DispatchMem) -> i32 {
    let nb = st.nb.max(0) as usize;
    let mut q = st.b.max(0) as usize;
    while q <= st.max_b as usize && q < nb {
        set!(m.head, q, -1);
        q += 1;
    }
    0
}

#[inline(always)]
fn dispatch_relax(st: &mut DispatchState, g: &RoadIn, m: &mut DispatchMem, u: usize, key: f64, b: usize) {
    let s = st.stamp;
    let limit = st.limit;
    let inv_q = st.inv_q;
    let tu = at!(g.time, u) as f64;
    let hu = at!(g.typ, u) == g.hw;
    let base = u * 4;
    for k in 0..4 {
        let v = at!(g.adj, base + k);
        if v < 0 {
            continue;
        }
        let v = v as usize;
        if at!(m.done, v) == s {
            continue;
        }
        let mut c = 0.5 * (tu + at!(g.time, v) as f64);
        if hu != (at!(g.typ, v) == g.hw) {
            c += g.ramp_pen;
        }
        let nd = key + c;
        if (at!(m.mark, v) != s || nd < at!(m.dist, v)) && nd <= limit {
            set!(m.mark, v, s);
            set!(m.dist, v, nd);
            set!(m.next, v, u as i32);
            let bi = to_int32(nd * inv_q);
            let bb = if bi > b as i32 { bi as usize } else { b + 1 };
            if bb as i32 > st.max_b {
                st.max_b = bb as i32;
            }
            m.push(st, bb, v);
        }
    }
}

fn dispatch_loop(st: &mut DispatchState, g: &RoadIn, m: &mut DispatchMem, resume: bool) -> i32 {
    let nb = st.nb.max(0) as usize;
    let s = st.stamp;
    let mut b = st.b.max(0) as usize;
    let mut e = st.e;
    if resume && st.u >= 0 {
        let u = st.u as usize;
        st.u = -1;
        dispatch_relax(st, g, m, u, st.key, b);
    }
    while b < nb {
        while e >= 0 {
            let ei = e as usize;
            let u = at!(m.enode, ei) as usize;
            e = at!(m.enext, ei);
            if at!(m.done, u) == s {
                continue;
            }
            let key = at!(m.dist, u);
            if key > st.stop {
                // break outer: clear [b, maxB] (JS: after the loop)
                st.b = b as i32;
                return dispatch_finish(st, m);
            }
            set!(m.done, u, s);
            st.cnt += 1;
            if st.visit != 0 && (m.st_head.is_empty() || at!(m.st_head, u) >= 0) {
                st.b = b as i32;
                st.e = e;
                st.u = u as i32;
                st.key = key;
                return 1;
            }
            dispatch_relax(st, g, m, u, key, b);
        }
        set!(m.head, b, -1);
        b += 1;
        e = if b < nb { at!(m.head, b) } else { -1 };
    }
    st.b = b as i32;
    dispatch_finish(st, m)
}

// exports (phase 1b) ------------------------------------------------------------------------------------------

/// roadTimeMulti; `cost` = netTimeQ as i32 [cost_len]. Returns the settled count or < 0 (binding runs JS).
///
/// # Safety
/// net / out: n_side^2 cells; cost: cost_len; head: head_len (>= limit_q + 1); ent: ecap (>= 10 n_side^2).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn search_road_time_multi(
    n_side: i32, net: *const u8, out: *mut i32, limit_q: i32, cost: *const i32, cost_len: i32, ramp_q: i32, hw: i32, street: i32,
    head: *mut i32, head_len: i32, ent: *mut i32, ecap: i32,
) -> i32 {
    if n_side <= 0 || cost_len <= 0 || head_len < 0 || ecap < 0 {
        return -4;
    }
    let c = (n_side as usize) * (n_side as usize);
    unsafe {
        road_time_multi(n_side as usize, sl(net, c), slm(out, c), limit_q, sl(cost, cost_len as usize), ramp_q, hw as u8, street as u8, slm(head, head_len as usize),
            slm(ent, ecap as usize))
    }
}

/// roadDistMulti; out has out_len >= n_side^2 elements (all filled with -1 first).
///
/// # Safety
/// net: n_side^2; seeds: ns cells in [0, n_side^2); cost: cost_len; out: out_len; head8: 8 i32; ent: ecap.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn search_road_dist_multi(
    n_side: i32, net: *const u8, seeds: *const i32, ns: i32, max_q: i32, cost: *const i32, cost_len: i32, drive: i32, ramp: i32, hw: i32, street: i32,
    out: *mut i32, out_len: i32, head8: *mut i32, ent: *mut i32, ecap: i32,
) -> i32 {
    if n_side <= 0 || ns < 0 || cost_len <= 0 || out_len < 0 || ecap < 0 {
        return -4;
    }
    let c = (n_side as usize) * (n_side as usize);
    unsafe {
        let head = &mut *(head8 as *mut [i32; 8]);
        road_dist_multi(n_side as usize, sl(net, c), opt(seeds, ns as usize), max_q, sl(cost, cost_len as usize), drive != 0, ramp, hw as u8, street as u8,
            slm(out, out_len as usize), head, slm(ent, ecap as usize))
    }
}

/// ChunkedSearch.start. `st`: its state block (n set by the caller). Returns 0, or < 0 when a capacity is too small.
///
/// # Safety
/// dist / done: st.n; head: st.head_len; ent: st.ecap; seeds: ns each.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn search_chunk_start(
    st: *mut ChunkState, s_node: *const i32, s_label: *const f64, ns: i32, limit: f64, inv_q: f64, dist: *mut f64, done: *mut u8, head: *mut i32, ent: *mut i32,
) -> i32 {
    unsafe {
        let st = &mut *st;
        let n = st.n.max(0) as usize;
        let nsu = ns.max(0) as usize;
        let seeds = SeedList { node: opt(s_node, nsu), label: opt(s_label, nsu), id: &[] };
        chunk_start(st, &seeds, limit, inv_q, slm(dist, n), slm(done, n), slm(head, st.head_len as usize), slm(ent, st.ecap as usize))
    }
}

/// ChunkedSearch.step: returns 1 when complete, 0 when more steps are needed.
///
/// # Safety
/// adj: 4 st.n (values < st.n: search_check_adj), time / typ: st.n; arrays as for search_chunk_start.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn search_chunk_step(
    st: *mut ChunkState, adj: *const i32, time: *const f32, typ: *const u8, hw: i32, ramp_pen: f64, max_settle: i32, dist: *mut f64, done: *mut u8,
    head: *mut i32, ent: *mut i32,
) -> i32 {
    unsafe {
        let st = &mut *st;
        let n = st.n.max(0) as usize;
        let g = RoadIn { adj: opt(adj, 4 * n), time: opt(time, n), typ: opt(typ, n), hw: hw as u8, ramp: &[], ramp_pen };
        chunk_step(st, &g, max_settle, slm(dist, n), slm(done, n), slm(head, st.head_len as usize), slm(ent, st.ecap as usize))
    }
}

/// DispatchSearch.run / resume / finish (op 0 / 1 / 2). Returns 1 = yielded to the visitor, 0 = finished.
///
/// # Safety
/// dist / next / mark / done: cap >= st.n; head: st.head_len; enode / enext: st.ecap; st_head: st.n or null;
/// adj 4 st.n (values < st.n), time / typ st.n; seeds: st.ns.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn search_dispatch(
    op: i32, st: *mut DispatchState, seeds: *const i32, adj: *const i32, time: *const f32, typ: *const u8, hw: i32, ramp_pen: f64, st_head: *const i32,
    dist: *mut f64, next: *mut i32, mark: *mut u32, done: *mut u32, cap: i32, head: *mut i32, enode: *mut i32, enext: *mut i32,
) -> i32 {
    unsafe {
        let st = &mut *st;
        let n = st.n.max(0) as usize;
        let c = cap.max(0) as usize;
        let mut m = DispatchMem {
            dist: slm(dist, c), next: slm(next, c), mark: slm(mark, c), done: slm(done, c), head: slm(head, st.head_len as usize),
            enode: slm(enode, st.ecap as usize), enext: slm(enext, st.ecap as usize), st_head: opt(st_head, n),
        };
        let g = RoadIn { adj: opt(adj, 4 * n), time: opt(time, n), typ: opt(typ, n), hw: hw as u8, ramp: &[], ramp_pen };
        if n > 0 && (g.adj.len() < 4 * n || g.time.len() < n || g.typ.len() < n) {
            return -4;
        }
        match op {
            0 => dispatch_start(st, opt(seeds, st.ns.max(0) as usize), &g, &mut m),
            1 => dispatch_resume(st, &g, &mut m),
            _ => dispatch_finish(st, &mut m),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// reference ToInt32 via i128 (exact for every finite double)
    fn ref_to_int32(x: f64) -> i32 {
        if !x.is_finite() {
            return 0;
        }
        let t = x.trunc();
        // |t| < 2^1024 fits i128 only below 2^127: reduce via the exact modulo of the mantissa representation
        if t.abs() < 1.7e38 {
            (t as i128).rem_euclid(1i128 << 32) as u32 as i32
        } else {
            // |x| >= 2^127: x is a multiple of 2^(127 - 52) >= 2^32 -> 0 modulo 2^32
            0
        }
    }

    #[test]
    fn to_int32_matches_js() {
        let specials = [
            0.0, -0.0, 0.5, -0.5, 1.0, -1.0, 2147483647.0, 2147483647.9, 2147483648.0, -2147483648.0, -2147483648.9, -2147483649.0,
            4294967295.0, 4294967296.0, 4294967297.5, -4294967297.5, 1e10, -1e10, 1e15 + 0.5, 9007199254740993.0, 1.8446744073709552e19,
            3.6893488147419103e19, 1e300, -1e300, f64::MAX, f64::MIN, f64::MIN_POSITIVE, 5e-324, f64::INFINITY, f64::NEG_INFINITY, f64::NAN,
        ];
        for &x in &specials {
            assert_eq!(to_int32(x), ref_to_int32(x), "x = {x:e}");
        }
        assert_eq!(to_int32(4294967297.5), 1);
        assert_eq!(to_int32(-4294967297.5), -1);
        assert_eq!(to_int32(2147483648.0), -2147483648);
        let mut s: u64 = 0x243f_6a88_85a3_08d3;
        for _ in 0..3_000_000 {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            let x = f64::from_bits(s);
            assert_eq!(to_int32(x), ref_to_int32(x), "x = {x:e}");
            let y = (s as i64 as f64) * 1e-3;
            assert_eq!(to_int32(y), ref_to_int32(y), "y = {y:e}");
        }
    }

    #[test]
    fn ceil_matches_std() {
        for &x in &[0.0, -0.0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 4655.02, -1e-300, 1e300, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(ceil(x).to_bits(), x.ceil().to_bits(), "x = {x:e}");
        }
        assert!(ceil(f64::NAN).is_nan());
    }

    /// tiny line graph 0 - 1 - 2 (both directions), times 0.1, one seed at 0
    #[test]
    fn line_graph() {
        let n = 3;
        let adj = [1, -1, -1, -1, 0, 2, -1, -1, 1, -1, -1, -1];
        let time = [0.1f32; 3];
        let typ = [2u8; 3];
        let g = RoadIn { adj: &adj, time: &time, typ: &typ, hw: 5, ramp: &[], ramp_pen: 0.35 };
        let seeds = SeedList { node: &[0], label: &[0.0], id: &[7] };
        let (mut dist, mut src, mut next, mut hops, mut order, mut done) = ([0.0; 3], [0; 3], [0; 3], [0u16; 3], [0; 3], [0u8; 3]);
        let mut o = Out { dist: &mut dist, src: &mut src, next: &mut next, hops: &mut hops, order: &mut order, done: &mut done };
        let inv_q = 1.0 / (0.04 * 0.999);
        let mut head = [0i32; 20000];
        let mut ent = [0i32; 2 * (1 + 12)];
        let k = road_search(n, &g, &seeds, 400.0, inv_q, &mut o, &mut head, &mut ent);
        assert_eq!(k, 3);
        assert_eq!(order, [0, 1, 2]);
        assert_eq!(src, [7, 7, 7]);
        assert_eq!(next, [-1, 0, 1]);
        assert_eq!(hops, [0, 1, 2]);
        let c = 0.5 * (0.1f32 as f64 + 0.1f32 as f64);
        assert_eq!(dist[2].to_bits(), (c + c).to_bits());
    }
}
