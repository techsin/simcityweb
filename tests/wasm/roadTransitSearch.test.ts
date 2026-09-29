/**
 * Equivalence of the road / transit search kernels (wasm/sim-kernels/src/search.rs via src/wasm/kernels/searchBind.ts)
 * and of the fair optimised-JS baseline (src/wasm/js/roadTransitSearch.ts) with the live JS original
 * (src/sim/infra/search.ts). Compared exactly: dist as f64 bit patterns, src / next / done / order / settled /
 * graphVersion exact, hops exact wherever dist < Infinity (hops is not reset by a search), accumulate results as bit
 * patterns (NaN == NaN) and the full onSink sequence.
 *
 * Inputs: random grid road graphs and random adjacency, realistic and adversarial node times (0, -0, negative,
 * subnormal, huge, NaN, +-Infinity), seeds (out of range, duplicates, NaN / +-Infinity / negative / -0 labels),
 * limits (default, NaN, > 2000, 0, -0, negative, -Infinity), ramp minutes, random transit nets (rail, subway,
 * ferry nodes, transfers), edge cases (empty map, single node, disconnected graph, map edges), the stress city's real
 * graph, and the profiler's 1M-population fixtures when present (SIM_FIXTURES or the scratch profile dir).
 * Both output modes are covered: resident WasmSearch (arrays in wasm memory) and plain JS Search (copy mode).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as js from '../../src/sim/infra/search';
import { BUS_TIME_FACTOR, DEST_NOISE, MATCH_PRICE_MAX, MAX_COMMUTE, NET_TIME, RAMP_PENALTY, REGIONAL_TIME, SUBWAY_TIME } from '../../src/sim/infra/params';
import { MinHeap } from '../../src/sim/infra/heap';
import type { RoadGraph } from '../../src/sim/infra/graph';
import { Network } from '../../src/core/types';
import {
  SEARCH_KERNEL, clearSearchGraphCache, isResidentSearch, makeSearchKernels, resetSearchWasmStats, searchWasmStats,
} from '../../src/wasm/kernels/searchBind';
import { makeFairSearch } from '../../src/wasm/js/roadTransitSearch';
import { initSimWasmSync, setSimWasmPreference, simWasmInstance, simWasmStatus } from '../../src/wasm/simWasm';
import { newSim, stressCity } from '../infra/cityGen';

const PARAMS = { NET_TIME, RAMP_PENALTY, SUBWAY_TIME, BUS_TIME_FACTOR, HIGHWAY: Network.Highway };
const W = makeSearchKernels(js, PARAMS);
const F = makeFairSearch(PARAMS);
const heap = new MinHeap(16);
const HW = Network.Highway;

// ------------------------------------------------------------------------------------------------ helpers
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

type Graph = Pick<RoadGraph, 'n' | 'type' | 'fwd' | 'rev' | 'version'>;
let versionCounter = 1000;

/** grid road graph: W x H cells, `fill` of them road; 4-neighbour moves, some directed edges dropped (one-ways) */
function gridGraph(r: () => number, Wd: number, Hd: number, fill: number, hwShare: number): Graph {
  const id = new Int32Array(Wd * Hd).fill(-1);
  let n = 0;
  for (let i = 0; i < Wd * Hd; i++) if (r() < fill) id[i] = n++;
  const type = new Uint8Array(n + 3);
  const fwd = new Int32Array(4 * n + 8).fill(-1), rev = new Int32Array(4 * n + 8).fill(-1);
  const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
  for (let i = 0; i < Wd * Hd; i++) {
    const a = id[i];
    if (a < 0) continue;
    const x = i % Wd, z = (i - x) / Wd;
    type[a] = r() < hwShare ? HW : 1 + Math.floor(r() * 4);
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k], nz = z + DZ[k];
      if (nx < 0 || nz < 0 || nx >= Wd || nz >= Hd) continue;
      const b = id[nz * Wd + nx];
      if (b < 0 || r() < 0.08) continue; // one-way: a -> b missing
      fwd[a * 4 + k] = b;
      rev[b * 4 + ((k + 2) & 3)] = a;
    }
  }
  return { n, type, fwd, rev, version: versionCounter++ };
}

/** arbitrary directed graph: random neighbour ids (including self loops and repeats), random empty slots */
function randomGraph(r: () => number, n: number, hwShare: number): Graph {
  const type = new Uint8Array(n);
  const fwd = new Int32Array(4 * n).fill(-1), rev = new Int32Array(4 * n).fill(-1);
  for (let a = 0; a < n; a++) {
    type[a] = r() < hwShare ? HW : 1 + Math.floor(r() * 4);
    for (let k = 0; k < 4; k++) {
      if (r() < 0.25) continue;
      fwd[a * 4 + k] = Math.floor(r() * n);
      rev[a * 4 + k] = r() < 0.1 ? -1 - Math.floor(r() * 5) : Math.floor(r() * n); // other negative "no edge" values
    }
  }
  return { n, type, fwd, rev, version: versionCounter++ };
}

type TimeKind = 'real' | 'flat' | 'wide' | 'adversarial';
function times(r: () => number, g: Graph, kind: TimeKind): Float32Array {
  const t = new Float32Array(g.n + 5);
  for (let v = 0; v < t.length; v++) {
    const base = NET_TIME[g.type[v] ?? 2] || 0.1;
    const u = r();
    switch (kind) {
      case 'real': t[v] = base * (1 + 0.15 * (r() * 3) ** 4); break;
      case 'flat': t[v] = 0.1; break;
      case 'wide': t[v] = u < 0.05 ? 0 : u < 0.1 ? 1e-40 : Math.exp((r() * 2 - 1) * 20); break;
      case 'adversarial': {
        const specials = [0, -0, -0.5, -1e30, 1e-45, 3e38, NaN, Infinity, -Infinity, 1e-8];
        t[v] = u < 0.12 ? specials[Math.floor(r() * specials.length)] : base * (1 + r() * 4);
        break;
      }
    }
  }
  return t;
}

function makeSeeds(r: () => number, n: number, count: number, adversarial: boolean): js.Seeds {
  const s = new js.Seeds();
  const specials = [NaN, Infinity, -Infinity, -0, -1e-3, -5, 1e300, 0, 2001, 45];
  for (let i = 0; i < count; i++) {
    const node = r() < 0.05 ? (r() < 0.5 ? -1 - Math.floor(r() * 3) : n + Math.floor(r() * 3)) : Math.floor(r() * Math.max(1, n));
    let label = r() * 80;
    if (r() < 0.1) label = s.n > 0 ? s.label[Math.floor(r() * s.n)] : 0; // exact duplicates
    if (adversarial && r() < 0.15) label = specials[Math.floor(r() * specials.length)];
    s.push(node, label, Math.floor(r() * 1e6) - 5);
    if (r() < 0.05 && s.n > 1) s.push(s.node[s.n - 1], s.label[s.n - 1], i); // duplicate node with the same label
  }
  return s;
}

const LIMITS: (number | undefined)[] = [undefined, 400, 186.02, 2000, 5000, NaN, 0, -0, -1, -1e-3, -Infinity, Infinity, 1e-5, 45, 106, 150];

const f64bits = (a: Float64Array, n: number) => new BigUint64Array(a.buffer, a.byteOffset, n);

/** first difference between two searches over n nodes, or '' */
function diffSearch(a: js.Search, b: js.Search, n: number, label: string): string {
  if (a.settled !== b.settled) return `${label}: settled ${a.settled} vs ${b.settled}`;
  const da = f64bits(a.dist, n), db = f64bits(b.dist, n);
  for (let v = 0; v < n; v++) {
    if (da[v] !== db[v]) return `${label}: dist[${v}] ${a.dist[v]} vs ${b.dist[v]}`;
    if (a.src[v] !== b.src[v]) return `${label}: src[${v}] ${a.src[v]} vs ${b.src[v]}`;
    if (a.next[v] !== b.next[v]) return `${label}: next[${v}] ${a.next[v]} vs ${b.next[v]}`;
    if (a.done[v] !== b.done[v]) return `${label}: done[${v}] ${a.done[v]} vs ${b.done[v]}`;
    if (a.dist[v] < Infinity && a.hops[v] !== b.hops[v]) return `${label}: hops[${v}] ${a.hops[v]} vs ${b.hops[v]}`;
  }
  for (let k = 0; k < a.settled; k++) if (a.order[k] !== b.order[k]) return `${label}: order[${k}] ${a.order[k]} vs ${b.order[k]}`;
  return '';
}

/** acc arrays equal as bit patterns (any NaN equals any NaN) */
function diffAcc(a: Float32Array | Float64Array, b: Float32Array | Float64Array): string {
  if (a.length !== b.length) return 'length';
  for (let i = 0; i < a.length; i++) {
    if (Object.is(a[i], b[i]) || (Number.isNaN(a[i]) && Number.isNaN(b[i]))) continue;
    return `acc[${i}] ${a[i]} vs ${b[i]}`;
  }
  return '';
}

function randomFlows<T extends Float32Array | Float64Array>(r: () => number, n: number, Ctor: new (n: number) => T, adversarial: boolean): T {
  const a = new Ctor(n);
  for (let i = 0; i < n; i++) {
    const u = r();
    if (u < 0.85) continue;
    a[i] = adversarial && u > 0.98 ? [NaN, -0, 1e-42, 3e38, -2.5, Infinity][Math.floor(r() * 6)] : r() * 20;
  }
  return a;
}

type Sink = [number, number, number];
function runAcc(api: { accumulate: typeof js.accumulate }, S: js.Search, acc: Float32Array | Float64Array, sinks: boolean): Sink[] {
  const out: Sink[] = [];
  api.accumulate(S, acc, sinks ? (id, f, v) => out.push([id, f, v]) : undefined);
  return out;
}
function diffSinks(a: Sink[], b: Sink[]): string {
  if (a.length !== b.length) return `sinks ${a.length} vs ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    const [x, y] = [a[i], b[i]];
    if (x[0] !== y[0] || x[2] !== y[2] || !(Object.is(x[1], y[1]) || (Number.isNaN(x[1]) && Number.isNaN(y[1])))) return `sink ${i}: ${x} vs ${y}`;
  }
  return '';
}

/** one roadSearch case through all implementations; returns failures */
function roadCase(g: Graph, adj: Int32Array, time: Float32Array, seeds: js.Seeds, limit: number | undefined, ramp: Float32Array | null, label: string, S = {
  ref: new js.Search(), fair: new js.Search(), wasm: new W.Search(), copy: new js.Search(),
}): string[] {
  const fails: string[] = [];
  const G = g as RoadGraph;
  js.roadSearch(G, adj, time, S.ref, heap, seeds, limit, ramp);
  F.roadSearch(G, adj, time, S.fair, heap, seeds, limit, ramp);
  W.roadSearch(G, adj, time, S.wasm, heap, seeds, limit, ramp);
  W.roadSearch(G, adj, time, S.copy, heap, seeds, limit, ramp);
  for (const [name, x] of [['fair', S.fair], ['wasm', S.wasm], ['copy', S.copy]] as const) {
    const d = diffSearch(S.ref, x, g.n, `${label} ${name}`);
    if (d) fails.push(d);
    if (x.graphVersion !== S.ref.graphVersion) fails.push(`${label} ${name}: graphVersion`);
  }
  return fails;
}

beforeAll(() => {
  expect(initSimWasmSync(), String(simWasmStatus().error)).toBe(true);
  setSimWasmPreference('auto');
});

// ------------------------------------------------------------------------------------------------ binary / JS helpers
describe('search kernels: binary and JS number helpers', () => {
  it('the committed binary exports every function the binding calls', () => {
    const w = simWasmInstance()!;
    for (const name of SEARCH_KERNEL.required) expect(typeof w.exports[name], name).toBe('function');
    expect(SEARCH_KERNEL.instance()).not.toBeNull();
  });

  it('ToInt32 (x | 0) and Math.ceil are emulated exactly', { timeout: 60000 }, () => {
    const ex = simWasmInstance()!.exports as unknown as { search_to_int32(x: number): number; search_ceil(x: number): number };
    const r = rng(99);
    const vals = [0, -0, 0.5, -0.5, 2147483647.5, 2147483648, -2147483648.5, -2147483649, 4294967297.5, -4294967297.5, 1e10, -1e10, 2 ** 53 + 2, 2 ** 64,
      2 ** 70 + 2 ** 40, -(2 ** 80), 1e300, -1e300, Number.MAX_VALUE, Number.MIN_VALUE, NaN, Infinity, -Infinity, 186.02 * 25.025, -0.02];
    const buf = new Float64Array(1), bits = new BigUint64Array(buf.buffer);
    for (let i = 0; i < 20000; i++) {
      bits[0] = (BigInt(Math.floor(r() * 2 ** 32)) << 32n) | BigInt(Math.floor(r() * 2 ** 32));
      vals.push(buf[0], (r() - 0.5) * 2 ** (r() * 80));
    }
    const bad: string[] = [];
    for (const x of vals) {
      if (ex.search_to_int32(x) !== (x | 0)) bad.push(`ToInt32(${x}) = ${ex.search_to_int32(x)}, JS ${x | 0}`);
      const c = ex.search_ceil(x);
      if (!(Object.is(c, Math.ceil(x)) || (Number.isNaN(c) && Number.isNaN(x)))) bad.push(`ceil(${x}) = ${c}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
    expect(vals.length).toBeGreaterThan(40000);
  });
});

// ------------------------------------------------------------------------------------------------ roadSearch
describe('roadSearch: original JS = fair JS = wasm (resident and copy mode)', () => {
  it('random grid graphs, realistic and adversarial inputs, every limit', { timeout: 300000 }, () => {
    const r = rng(1);
    const fails: string[] = [];
    let cases = 0;
    for (let t = 0; t < 70; t++) {
      const g = gridGraph(r, 3 + Math.floor(r() * 60), 3 + Math.floor(r() * 60), 0.3 + r() * 0.7, r() < 0.3 ? 0.3 : 0.05);
      const kinds: TimeKind[] = ['real', 'flat', 'wide', 'adversarial'];
      const kind = kinds[t % 4];
      const time = times(r, g, kind);
      const seeds = makeSeeds(r, g.n, 1 + Math.floor(r() * 40), kind === 'adversarial' || t % 3 === 0);
      const limit = LIMITS[t % LIMITS.length];
      const ramp = t % 5 === 0 ? times(r, g, t % 2 ? 'real' : 'adversarial') : null;
      for (const adj of [g.rev, g.fwd]) {
        fails.push(...roadCase(g, adj, time, seeds, limit, ramp, `grid#${t} ${kind} limit=${limit} ramp=${!!ramp}`));
        cases++;
      }
    }
    expect(fails.slice(0, 10)).toEqual([]);
    expect(cases).toBe(140);
    expect(searchWasmStats.roadWasm).toBeGreaterThan(0);
  });

  it('random adjacency (self loops, repeated neighbours, other negative "no edge" values)', { timeout: 300000 }, () => {
    const r = rng(2);
    const fails: string[] = [];
    for (let t = 0; t < 60; t++) {
      const g = randomGraph(r, 1 + Math.floor(r() * 3000), 0.2);
      const time = times(r, g, t % 2 ? 'real' : 'adversarial');
      const seeds = makeSeeds(r, g.n, 1 + Math.floor(r() * 200), t % 2 === 0);
      fails.push(...roadCase(g, t % 2 ? g.fwd : g.rev, time, seeds, LIMITS[(t * 7) % LIMITS.length], t % 4 === 0 ? times(r, g, 'wide') : null, `rand#${t}`));
    }
    expect(fails.slice(0, 10)).toEqual([]);
  });

  it('edge cases: empty map, single node, disconnected graph, map edges, zero / huge values, no valid seeds', () => {
    const fails: string[] = [];
    const r = rng(3);
    // empty map
    const empty: Graph = { n: 0, type: new Uint8Array(0), fwd: new Int32Array(0), rev: new Int32Array(0), version: versionCounter++ };
    const s0 = new js.Seeds();
    s0.push(0, 0, 1);
    s0.push(-1, 0, 2);
    fails.push(...roadCase(empty, empty.rev, new Float32Array(0), s0, undefined, null, 'empty'));
    fails.push(...roadCase(empty, empty.rev, new Float32Array(0), new js.Seeds(), 2000, null, 'empty/no seeds'));
    // single node, self loop
    const one: Graph = { n: 1, type: new Uint8Array([HW]), fwd: new Int32Array([0, -1, 0, -1]), rev: new Int32Array([0, 0, 0, 0]), version: versionCounter++ };
    for (const l of [0, -0, 5, NaN, -Infinity]) {
      const s = new js.Seeds();
      s.push(0, l, 7);
      fails.push(...roadCase(one, one.rev, new Float32Array([0.04]), s, 100, null, `single ${l}`));
      fails.push(...roadCase(one, one.rev, new Float32Array([-1]), s, 100, new Float32Array([0.5]), `single neg ${l}`));
    }
    // disconnected: two grids side by side with no edges between them, seeds only in one
    const a = gridGraph(r, 20, 20, 1, 0.1), b = gridGraph(r, 15, 15, 1, 0.1);
    const n = a.n + b.n;
    const type = new Uint8Array(n); type.set(a.type.subarray(0, a.n)); type.set(b.type.subarray(0, b.n), a.n);
    const rev = new Int32Array(4 * n);
    rev.set(a.rev.subarray(0, 4 * a.n));
    for (let i = 0; i < 4 * b.n; i++) rev[4 * a.n + i] = b.rev[i] < 0 ? -1 : b.rev[i] + a.n;
    const dis: Graph = { n, type, fwd: rev, rev, version: versionCounter++ };
    const sd = new js.Seeds();
    for (let i = 0; i < 5; i++) sd.push(Math.floor(r() * a.n), r() * 3, i);
    fails.push(...roadCase(dis, dis.rev, times(r, dis, 'real'), sd, undefined, null, 'disconnected'));
    // map edges: a fully paved 1 x N strip and N x 1 column (every node on the border)
    for (const [w, h] of [[1, 300], [300, 1], [2, 2]]) {
      const g = gridGraph(r, w, h, 1, 0.5);
      const s = new js.Seeds();
      s.push(0, 0, 1);
      s.push(g.n - 1, 0.5, 2);
      fails.push(...roadCase(g, g.rev, times(r, g, 'real'), s, 2000, null, `strip ${w}x${h}`));
    }
    // zero / huge times, labels at the limit, all seeds invalid
    const g = gridGraph(r, 30, 30, 0.9, 0.2);
    const zero = new Float32Array(g.n), huge = new Float32Array(g.n).fill(3e38);
    const s = makeSeeds(r, g.n, 20, false);
    fails.push(...roadCase(g, g.rev, zero, s, 400, null, 'zero times'));
    fails.push(...roadCase(g, g.rev, huge, s, 400, null, 'huge times'));
    const atLimit = new js.Seeds();
    atLimit.push(3, 45, 1);
    atLimit.push(4, 45 + 1e-12, 2);
    fails.push(...roadCase(g, g.rev, times(r, g, 'real'), atLimit, 45, null, 'labels at the limit'));
    const invalid = new js.Seeds();
    invalid.push(-1, 0, 1);
    invalid.push(g.n, 0, 2);
    invalid.push(5, NaN, 3);
    invalid.push(6, 3000, 4);
    fails.push(...roadCase(g, g.rev, times(r, g, 'real'), invalid, 2000, null, 'no valid seed'));
    expect(fails).toEqual([]);
  });

  it('one Search reused across graphs of changing size (capacity growth, migration JS <-> wasm)', () => {
    const r = rng(4);
    const S = { ref: new js.Search(), fair: new js.Search(), wasm: new W.Search(), copy: new js.Search() };
    const fails: string[] = [];
    for (let t = 0; t < 24; t++) {
      const g = gridGraph(r, 5 + Math.floor(r() * 90), 5 + Math.floor(r() * 90), 0.8, 0.1);
      const time = times(r, g, 'real');
      const seeds = makeSeeds(r, g.n, 10, false);
      // alternate the preference: the same WasmSearch object is searched by JS (plain / resident arrays) and wasm
      setSimWasmPreference(t % 3 === 1 ? 'js' : 'auto');
      fails.push(...roadCase(g, g.rev, time, seeds, undefined, null, `reuse#${t}`, S));
    }
    setSimWasmPreference('auto');
    expect(fails).toEqual([]);
    expect(isResidentSearch(S.wasm)).toBe(true);
  });

  it('memory growth while searches are resident re-points their views (contents intact, results exact)', () => {
    const r = rng(5);
    const h = simWasmInstance()!.heap;
    const g = gridGraph(r, 120, 120, 0.9, 0.1);
    const time = times(r, g, 'real');
    const seeds = makeSeeds(r, g.n, 30, false);
    const keep = new W.Search();
    W.roadSearch(g as RoadGraph, g.rev, time, keep, heap, seeds, 400);
    const ref = new js.Search();
    js.roadSearch(g as RoadGraph, g.rev, time, ref, heap, seeds, 400);
    const cap0 = h.capacity;
    // pin a lot of searches: the heap must grow (explicit reserve inside the binding)
    const many: js.Search[] = [];
    const big = gridGraph(r, 256, 256, 0.95, 0.05);
    const bt = times(r, big, 'real');
    while (h.capacity < cap0 + (24 << 20)) {
      const S = new W.Search();
      W.roadSearch(big as RoadGraph, big.rev, bt, S, heap, makeSeeds(r, big.n, 5, false), 60);
      many.push(S);
    }
    expect(h.capacity).toBeGreaterThan(cap0);
    expect(keep.dist.buffer).toBe(h.memory.buffer); // re-pointed
    expect(diffSearch(ref, keep, g.n, 'after growth')).toBe('');
    // and it still searches correctly
    W.roadSearch(g as RoadGraph, g.rev, time, keep, heap, seeds, 400);
    expect(diffSearch(ref, keep, g.n, 'search after growth')).toBe('');
  });

  it('unusual arguments run the JS original (and give its results)', () => {
    const r = rng(6);
    const g = gridGraph(r, 20, 20, 1, 0.1);
    const time = times(r, g, 'real');
    const seeds = makeSeeds(r, g.n, 5, false);
    resetSearchWasmStats();
    const S = new W.Search(), ref = new js.Search();
    // Float64 times, short time array, short type array
    W.roadSearch(g as RoadGraph, g.rev, Float64Array.from(time) as unknown as Float32Array, S, heap, seeds, 400);
    js.roadSearch(g as RoadGraph, g.rev, Float64Array.from(time) as unknown as Float32Array, ref, heap, seeds, 400);
    expect(diffSearch(ref, S, g.n, 'f64 time')).toBe('');
    W.roadSearch(g as RoadGraph, g.rev, time.subarray(0, 5), S, heap, seeds, 400);
    js.roadSearch(g as RoadGraph, g.rev, time.subarray(0, 5), ref, heap, seeds, 400);
    expect(diffSearch(ref, S, g.n, 'short time')).toBe('');
    // adjacency value out of range: validated once per graph version, then JS
    const bad: Graph = { ...g, rev: g.rev.slice(), version: versionCounter++ };
    bad.rev[7] = g.n + 3;
    W.roadSearch(bad as RoadGraph, bad.rev, time, S, heap, seeds, 400);
    expect(searchWasmStats.roadJs).toBe(3);
    expect(searchWasmStats.roadWasm).toBe(0);
    // preference js: JS original
    setSimWasmPreference('js', 'search');
    W.roadSearch(g as RoadGraph, g.rev, time, S, heap, seeds, 400);
    expect(searchWasmStats.roadJs).toBe(4);
    setSimWasmPreference('auto', 'search');
    W.roadSearch(g as RoadGraph, g.rev, time, S, heap, seeds, 400);
    expect(searchWasmStats.roadWasm).toBe(1);
    js.roadSearch(g as RoadGraph, g.rev, time, ref, heap, seeds, 400);
    expect(diffSearch(ref, S, g.n, 'after fallbacks')).toBe('');
  });

  it('graph cache: a rebuilt graph (same arrays, new version) is re-copied', () => {
    const r = rng(7);
    const g = gridGraph(r, 40, 40, 1, 0.1);
    const time = times(r, g, 'real');
    const seeds = makeSeeds(r, g.n, 8, false);
    const S = new W.Search(), ref = new js.Search();
    W.roadSearch(g as RoadGraph, g.rev, time, S, heap, seeds, 400);
    // "rebuild" in place: new adjacency contents in the same array + version bump (what RoadGraph.build does)
    const other = gridGraph(r, 40, 40, 1, 0.3);
    const m = Math.min(g.n, other.n);
    g.rev.fill(-1);
    for (let i = 0; i < 4 * m; i++) g.rev[i] = other.rev[i] < m ? other.rev[i] : -1;
    g.version++;
    W.roadSearch(g as RoadGraph, g.rev, time, S, heap, seeds, 400);
    js.roadSearch(g as RoadGraph, g.rev, time, ref, heap, seeds, 400);
    expect(diffSearch(ref, S, g.n, 'rebuilt')).toBe('');
    clearSearchGraphCache(simWasmInstance()!.heap);
  });
});

// ------------------------------------------------------------------------------------------------ transitSearch
interface Net extends js.TransitNet { nFerry: number }

function randomNet(r: () => number, withFerry: boolean): Net {
  const g = gridGraph(r, 10 + Math.floor(r() * 50), 10 + Math.floor(r() * 50), 0.7, 0.05);
  const nR = g.n;
  const lineAdj = (m: number) => {
    const a = new Int32Array(4 * m).fill(-1);
    for (let v = 0; v < m; v++) {
      if (v + 1 < m && r() < 0.9) { a[v * 4] = v + 1; a[(v + 1) * 4 + 2] = v; }
      if (r() < 0.1) a[v * 4 + 1] = Math.floor(r() * m);
    }
    return a;
  };
  const nRail = Math.floor(r() * 60), nSub = Math.floor(r() * 80), nFerry = withFerry ? Math.floor(r() * 6) : 0;
  const total = nR + nRail + nSub + nFerry;
  const from: number[] = [], to: number[] = [], cost: number[] = [];
  const nTrPairs = Math.floor(r() * 40);
  for (let k = 0; k < nTrPairs; k++) {
    const a = Math.floor(r() * total), b = Math.floor(r() * total);
    const c = r() < 0.05 ? [0, -0, NaN, Infinity, 1e-40][Math.floor(r() * 5)] : 0.5 + r() * 8;
    from.push(a, b); to.push(b, a); cost.push(c, c);
  }
  // CSR by `from`
  const trStart = new Int32Array(total + 1);
  for (const f of from) trStart[f + 1]++;
  for (let i = 0; i < total; i++) trStart[i + 1] += trStart[i];
  const cur = trStart.slice(0, total);
  const trTo = new Int32Array(from.length), trCost = new Float32Array(from.length);
  for (let e = 0; e < from.length; e++) { const p = cur[from[e]]++; trTo[p] = to[e]; trCost[p] = cost[e]; }
  const time = times(r, g, r() < 0.8 ? 'real' : 'adversarial');
  const busTime = new Float32Array(nR);
  for (let v = 0; v < nR; v++) busTime[v] = time[v] * BUS_TIME_FACTOR;
  return {
    nR, nRail, nSub, nFerry, total, roadAdj: g.rev, busTime, railAdj: lineAdj(nRail), subAdj: lineAdj(nSub), railTime: NET_TIME[Network.Rail],
    subTime: SUBWAY_TIME, trStart, trTo, trCost,
  };
}

function transitCase(T: js.TransitNet, seeds: js.Seeds, limit: number | undefined, label: string): string[] {
  const ref = new js.Search(), fair = new js.Search(), wasm = new W.Search(), copy = new js.Search();
  js.transitSearch(T, ref, heap, seeds, limit);
  F.transitSearch(T, fair, heap, seeds, limit);
  W.transitSearch(T, wasm, heap, seeds, limit);
  W.transitSearch(T, copy, heap, seeds, limit);
  const out: string[] = [];
  for (const [name, x] of [['fair', fair], ['wasm', wasm], ['copy', copy]] as const) {
    const d = diffSearch(ref, x, T.total, `${label} ${name}`);
    if (d) out.push(d);
  }
  return out;
}

describe('transitSearch: original JS = fair JS = wasm', () => {
  it('random nets (road + rail + subway + ferry nodes + transfers), realistic and adversarial', { timeout: 300000 }, () => {
    const r = rng(11);
    const fails: string[] = [];
    resetSearchWasmStats();
    for (let t = 0; t < 60; t++) {
      const T = randomNet(r, t % 2 === 1);
      const seeds = makeSeeds(r, T.total, 1 + Math.floor(r() * 60), t % 3 === 0);
      fails.push(...transitCase(T, seeds, LIMITS[t % LIMITS.length], `net#${t}`));
    }
    expect(fails.slice(0, 10)).toEqual([]);
    expect(searchWasmStats.transitWasm).toBeGreaterThan(0);
    expect(searchWasmStats.transitJs).toBe(0);
  });

  it('edge cases: no stops (road only), empty net, invalid tables fall back to JS', () => {
    const r = rng(12);
    const fails: string[] = [];
    const T = randomNet(r, false);
    const roadOnly: js.TransitNet = { ...T, nRail: 0, nSub: 0, total: T.nR, railAdj: new Int32Array(0), subAdj: new Int32Array(0), trStart: new Int32Array(T.nR + 1), trTo: new Int32Array(0), trCost: new Float32Array(0) };
    fails.push(...transitCase(roadOnly, makeSeeds(r, T.nR, 10, false), undefined, 'road only'));
    const empty: js.TransitNet = { ...roadOnly, nR: 0, total: 0, roadAdj: new Int32Array(0), busTime: new Float32Array(0), trStart: new Int32Array(1) };
    fails.push(...transitCase(empty, makeSeeds(r, 1, 3, false), 400, 'empty'));
    // a transfer to a node out of range: wasm validation fails -> JS semantics
    const bad = randomNet(r, false);
    if (bad.trTo.length > 0) {
      bad.trTo[0] = bad.total + 2;
      resetSearchWasmStats();
      const ref = new js.Search(), wasm = new W.Search();
      const seeds = makeSeeds(r, bad.total, 5, false);
      js.transitSearch(bad, ref, heap, seeds, 400);
      W.transitSearch(bad, wasm, heap, seeds, 400);
      fails.push(diffSearch(ref, wasm, bad.total, 'bad transfer'));
      expect(searchWasmStats.transitJs).toBe(1);
    }
    expect(fails.filter(Boolean)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ accumulate
describe('accumulate: original JS = fair JS = wasm (acc bits + full onSink sequence)', () => {
  it('Float32 and Float64 flows, with and without onSink, resident and plain searches', { timeout: 300000 }, () => {
    const r = rng(21);
    const fails: string[] = [];
    resetSearchWasmStats();
    for (let t = 0; t < 60; t++) {
      const transit = t % 3 === 2;
      const n = transit ? 0 : 1;
      void n;
      let refS: js.Search, wasmS: js.Search, plainS: js.Search, N: number;
      if (transit) {
        const T = randomNet(r, t % 2 === 0);
        const seeds = makeSeeds(r, T.total, 30, false);
        refS = new js.Search(); wasmS = new W.Search(); plainS = new js.Search();
        js.transitSearch(T, refS, heap, seeds, 400); W.transitSearch(T, wasmS, heap, seeds, 400); js.transitSearch(T, plainS, heap, seeds, 400);
        N = T.total;
      } else {
        const g = gridGraph(r, 10 + Math.floor(r() * 80), 10 + Math.floor(r() * 80), 0.8, 0.1);
        const time = times(r, g, 'real');
        const seeds = makeSeeds(r, g.n, 1 + Math.floor(r() * 30), false);
        refS = new js.Search(); wasmS = new W.Search(); plainS = new js.Search();
        js.roadSearch(g as RoadGraph, g.rev, time, refS, heap, seeds, 400); W.roadSearch(g as RoadGraph, g.rev, time, wasmS, heap, seeds, 400);
        js.roadSearch(g as RoadGraph, g.rev, time, plainS, heap, seeds, 400);
        N = g.n;
      }
      for (const f64 of [false, true]) {
        const base = f64 ? randomFlows(r, N + 3, Float64Array, t % 4 === 0) : randomFlows(r, N + 3, Float32Array, t % 4 === 0);
        const sinks = t % 2 === 0;
        const a = base.slice(), b = base.slice(), c = base.slice(), d = base.slice();
        const sa = runAcc(js, refS, a, sinks), sb = runAcc(F, refS, b, sinks), sc = runAcc(W, wasmS, c, sinks), sd = runAcc(W, plainS, d, sinks);
        for (const [name, x, s] of [['fair', b, sb], ['wasm', c, sc], ['plain', d, sd]] as const) {
          const e = diffAcc(a, x) || diffSinks(sa, s);
          if (e) fails.push(`acc#${t} f64=${f64} ${name}: ${e}`);
        }
      }
    }
    expect(fails.slice(0, 10)).toEqual([]);
    expect(searchWasmStats.accWasm).toBeGreaterThan(100);
  });
});

// ------------------------------------------------------------------------------------------------ real graphs
describe('real graphs', () => {
  it('stress city (256², ~36k road nodes): round / inbound / shop / freight style searches, transit and accumulate', { timeout: 600000 }, () => {
    const city = stressCity(256);
    const sim = newSim(city.st);
    for (let d = 0; d < 3; d++) sim.advanceDay();
    const fails = realGraphChecks(sim.getSystem('traffic') as unknown as TrafficLike, 'stress');
    expect(fails).toEqual([]);
  });

  const FIX_DIR = process.env.SIM_FIXTURES ?? '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/profile/fixtures';
  for (const [file, testDefs] of [['dense1m_s7.metropolis', false], ['stress1m_testdefs_s7.metropolis', true]] as const) {
    const path = join(FIX_DIR, file);
    it.skipIf(!existsSync(path))(`profiler fixture ${file} (1M population)`, { timeout: 900000 }, async () => {
      const { deserializeCity } = await import('../../src/save/serialize');
      const { unpackFile } = await import('../../src/save/bundle');
      const { Simulation } = await import('../../src/sim/Simulation');
      const { createSystems } = await import('../../src/sim/systems');
      const { registerTestDefs } = await import('../infra/cityGen');
      if (testDefs) registerTestDefs();
      let st;
      try {
        st = deserializeCity((await unpackFile(new Uint8Array(readFileSync(path)))) as Parameters<typeof deserializeCity>[0]);
      } catch (e) {
        console.warn(`[roadTransitSearch] ${file} does not load with the live save code (${String(e)}); skipped`);
        return;
      }
      const sim = new Simulation(st, createSystems());
      const fails = realGraphChecks(sim.getSystem('traffic') as unknown as TrafficLike, file);
      expect(fails).toEqual([]);
    });
  }
});

interface TrafficLike {
  road: RoadGraph;
  nodeTime: Float32Array;
  tnet: js.TransitNet | null;
  qN: number;
  qNode: Int32Array;
  qBase: Float32Array;
  qNoise: Float32Array;
  qPrice: Float32Array;
}

/** the searches traffic runs on its graph (seeds built like traffic.ts roundSearch; others: real-sized random seeds) */
function realGraphChecks(tr: TrafficLike, label: string): string[] {
  const g = tr.road, n = g.n;
  const fails: string[] = [];
  const r = rng(n);
  const round = new js.Seeds();
  for (let q = 0; q < tr.qN; q++) round.push(tr.qNode[q], MATCH_PRICE_MAX + tr.qBase[q] + tr.qNoise[q] + tr.qPrice[q], q);
  const other = (count: number, label0: () => number) => {
    const s = new js.Seeds();
    for (let i = 0; i < count; i++) s.push(Math.floor(r() * n), label0(), i);
    return s;
  };
  const cases: [string, Int32Array, js.Seeds, number][] = [
    ['round', g.rev, round, MAX_COMMUTE + DEST_NOISE + REGIONAL_TIME + 2 * MATCH_PRICE_MAX],
    ['inbound', g.fwd, other(12, () => REGIONAL_TIME), REGIONAL_TIME + 90],
    ['shop', g.rev, other(Math.min(4000, n >> 3), () => 0), 45],
    ['freight', g.rev, other(Math.min(2000, n >> 4), () => r() * 30), 150],
  ];
  const S = { ref: new js.Search(), fair: new js.Search(), wasm: new W.Search(), copy: new js.Search() };
  for (const [name, adj, seeds, limit] of cases) {
    fails.push(...roadCase(g as unknown as Graph, adj, tr.nodeTime, seeds, limit, null, `${label} ${name}`, S));
    const flows = randomFlows(r, n, Float32Array, false);
    const a = flows.slice(), c = flows.slice();
    const sa = runAcc(js, S.ref, a, true), sc = runAcc(W, S.wasm, c, true);
    const e = diffAcc(a, c) || diffSinks(sa, sc);
    if (e) fails.push(`${label} ${name} accumulate: ${e}`);
  }
  if (tr.tnet) {
    const T = tr.tnet;
    fails.push(...transitCase(T, other(Math.min(3000, T.total >> 2), () => r() * 20), MAX_COMMUTE + DEST_NOISE + REGIONAL_TIME, `${label} transit`));
  }
  return fails;
}

// ================================================================================================ phase 1b
// catchments.ts roadTimeMulti / roadDistMulti, emergency.ts ChunkedSearch / DispatchSearch (secondary exports of the
// Rust search module). The live originals are the references; DispatchSearch is private to emergency.ts, so its source
// is extracted from the live file and compiled here (no file is edited).
describe('secondary kernels (catchments / emergency)', () => {
  it('roadTimeMulti and roadDistMulti: random networks, seeds, limits, cost tables; out labels + settled counts exact', { timeout: 300000 }, async () => {
    const catchJs = await import('../../src/sim/infra/catchments');
    const P = await import('../../src/sim/infra/params');
    const { makeCatchmentSearchKernels, catchSearchStats } = await import('../../src/wasm/kernels/catchSearchBind');
    const K = makeCatchmentSearchKernels(catchJs, { WALK_COST: P.WALK_COST, DRIVE_COST: P.DRIVE_COST, RAMP_COST: P.RAMP_COST, HIGHWAY: Network.Highway, STREET: Network.Street });
    const TIME_Q = catchJs.TIME_Q;
    const NET_TIME_Q = NET_TIME.map((t, k) => (k >= 1 && k <= 5 ? Math.max(1, Math.round(t / TIME_Q)) : 0));
    const RAMP_Q = Math.round(RAMP_PENALTY / TIME_Q);
    const r = rng(31);
    const fails: string[] = [];
    const mkState = (N: number, roadShare: number) => {
      const net = new Uint8Array(N * N);
      for (let i = 0; i < net.length; i++) net[i] = r() < roadShare ? 1 + Math.floor(r() * 6) : 0; // includes rail (6): impassable
      return { size: N, cells: N * N, network: net } as unknown as import('../../src/sim/CityState').CityState;
    };
    for (let t = 0; t < 40; t++) {
      const N = [1, 2, 7, 33, 64, 128][t % 6];
      const st = mkState(N, 0.3 + r() * 0.7);
      const C = N * N;
      // roadTimeMulti: seed labels (some beyond the limit, some on non-road cells, other negative "no seed" values kept)
      const limitQ = [0, 3, 500, 34000][t % 4];
      const table = t % 3 === 0 ? NET_TIME_Q : [0, 1 + Math.floor(r() * 30), 1 + Math.floor(r() * 30), 1 + Math.floor(r() * 30), 1 + Math.floor(r() * 30), 1 + Math.floor(r() * 5), 0];
      const rampQ = t % 2 ? RAMP_Q : Math.floor(r() * 10);
      const seedOut = new Int32Array(C).fill(-1);
      for (let i = 0; i < C; i++) if (r() < 0.02) seedOut[i] = r() < 0.1 ? limitQ + 5 : Math.floor(r() * (limitQ + 1));
      for (let i = 0; i < C; i++) if (r() < 0.01) seedOut[i] = -7;
      const a = seedOut.slice(), b = seedOut.slice();
      const ra = catchJs.roadTimeMulti(st, a, limitQ, table, rampQ), rb = K.roadTimeMulti(st, b, limitQ, table, rampQ);
      if (ra !== rb || a.some((v, i) => v !== b[i])) fails.push(`roadTimeMulti#${t} N=${N} limit=${limitQ}: settled ${ra}/${rb}`);
      // roadDistMulti: metrics 0 walk / 1 drive / 2 (drive costs, no ramps), maxQ incl. fractional / NaN / infinite
      const metric = t % 3;
      const maxQ = [16, 40, 7.5, NaN, Infinity, -1, 0][t % 7];
      const ns = Math.floor(r() * 40);
      const seeds = new Int32Array(ns + 3);
      for (let s = 0; s < ns; s++) seeds[s] = Math.floor(r() * C);
      const L = C + (t % 2 ? 5 : 0);
      const oa = new Int32Array(L).fill(3), ob = new Int32Array(L).fill(3);
      const da = catchJs.roadDistMulti(st, metric, seeds, ns, maxQ, oa), db = K.roadDistMulti(st, metric, seeds, ns, maxQ, ob);
      if (da !== db || oa.some((v, i) => v !== ob[i])) fails.push(`roadDistMulti#${t} N=${N} metric=${metric} maxQ=${maxQ}: settled ${da}/${db}`);
    }
    // the stress city's real network, services' real parameters
    const city = stressCity(256);
    const st = city.st, C = st.cells;
    const seedOut = new Int32Array(C).fill(-1);
    for (let i = 0; i < C; i += 97) if (st.network[i] >= 1 && st.network[i] <= 5) seedOut[i] = i % 500;
    const a = seedOut.slice(), b = seedOut.slice();
    const lim = Math.round((MAX_COMMUTE + 60) / TIME_Q);
    const ra = catchJs.roadTimeMulti(st, a, lim, NET_TIME_Q, RAMP_Q), rb = K.roadTimeMulti(st, b, lim, NET_TIME_Q, RAMP_Q);
    if (ra !== rb || a.some((v, i) => v !== b[i])) fails.push(`stress roadTimeMulti: ${ra}/${rb}`);
    const seeds = new Int32Array(3000);
    let ns = 0;
    for (let i = 0; i < C && ns < 3000; i += 23) if (st.network[i] >= 1 && st.network[i] <= 5) seeds[ns++] = i;
    for (const metric of [0, 1]) {
      const oa = new Int32Array(C), ob = new Int32Array(C);
      const da = catchJs.roadDistMulti(st, metric, seeds, ns, 16 * 4, oa), db = K.roadDistMulti(st, metric, seeds, ns, 16 * 4, ob);
      if (da !== db || oa.some((v, i) => v !== ob[i])) fails.push(`stress roadDistMulti metric ${metric}: ${da}/${db}`);
    }
    expect(fails.slice(0, 10)).toEqual([]);
    expect(catchSearchStats.timeWasm).toBeGreaterThan(30);
    expect(catchSearchStats.distWasm).toBeGreaterThan(30);
  });

  it('ChunkedSearch: start + steps of random sizes equal the original (dist bits, settled, completion) across restarts', { timeout: 300000 }, async () => {
    const em = await import('../../src/sim/infra/emergency');
    const { makeEmergencySearchKernels, emergencySearchStats } = await import('../../src/wasm/kernels/emergencySearchBind');
    const K = makeEmergencySearchKernels({ NET_TIME, RAMP_PENALTY, HIGHWAY: Network.Highway });
    const r = rng(41);
    const A = new em.ChunkedSearch(), B = new K.ChunkedSearch();
    const fails: string[] = [];
    for (let t = 0; t < 40 && fails.length === 0; t++) {
      const g = gridGraph(r, 5 + Math.floor(r() * 70), 5 + Math.floor(r() * 70), 0.8, 0.1);
      const time = times(r, g, t % 4 === 3 ? 'adversarial' : 'real');
      const seeds = makeSeeds(r, g.n, 1 + Math.floor(r() * 20), t % 3 === 0);
      const limit = [400, 60, NaN, 2500, -1, 30][t % 6];
      A.start(g.n, seeds, limit);
      B.start(g.n, seeds, limit);
      setSimWasmPreference(t % 5 === 4 ? 'js' : 'auto'); // mixing JS and wasm steps on one search
      for (let k = 0; k < 10000; k++) {
        const m = 1 + Math.floor(r() * 400);
        const da = A.step(g as RoadGraph, t % 2 ? g.fwd : g.rev, time, m), db = B.step(g as RoadGraph, t % 2 ? g.fwd : g.rev, time, m);
        if (da !== db || A.settled !== B.settled) { fails.push(`chunk#${t} step ${k}: done ${da}/${db} settled ${A.settled}/${B.settled}`); break; }
        const x = f64bits(A.dist, g.n), y = f64bits(B.dist, g.n);
        for (let v = 0; v < g.n; v++) if (x[v] !== y[v]) { fails.push(`chunk#${t} step ${k}: dist[${v}] ${A.dist[v]} vs ${B.dist[v]}`); break; }
        if (da) break;
      }
      setSimWasmPreference('auto');
    }
    expect(fails).toEqual([]);
    expect(emergencySearchStats.chunkWasm).toBeGreaterThan(100);
  });

  it('DispatchSearch: runs with station visitors (yield / resume / stop), lowered stops and cross-run state equal the original', { timeout: 300000 }, async () => {
    const { transformWithOxc } = await import('vite');
    const src = readFileSync(join(__dirname, '../../src/sim/infra/emergency.ts'), 'utf8');
    const start = src.indexOf('class DispatchSearch {');
    expect(start).toBeGreaterThan(0);
    let depth = 0, end = -1;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    const js0 = (await transformWithOxc(src.slice(start, end), 'dispatch.ts')).code;
    const MIN_T = Math.min(NET_TIME[1], NET_TIME[2], NET_TIME[3], NET_TIME[4], NET_TIME[5]);
    type DS = { dist: Float64Array; next: Int32Array; stop: number; settled: number; d(v: number): number; nx(v: number): number;
      run(g: RoadGraph, tm: Float32Array, seeds: Int32Array, ns: number, limit: number, stHead: Int32Array | null, visit: ((u: number, d: number) => boolean) | null): void };
    const Orig = new Function('Network', 'RAMP_PENALTY', 'QB', `${js0}\nreturn DispatchSearch;`)(Network, RAMP_PENALTY, MIN_T * 0.999) as new () => DS;
    const { makeEmergencySearchKernels, emergencySearchStats } = await import('../../src/wasm/kernels/emergencySearchBind');
    // dispatchMinSettled 0: every run through the kernel (the default sends small runs to the JS port)
    const K = makeEmergencySearchKernels({ NET_TIME, RAMP_PENALTY, HIGHWAY: Network.Highway }, { dispatchMinSettled: 0 });
    const r = rng(51);
    const A = new Orig(), B = new K.DispatchSearch() as unknown as DS;
    const fails: string[] = [];
    let yields = 0;
    for (let t = 0; t < 120 && fails.length === 0; t++) {
      const g = t % 30 === 0 || t < 2 ? gridGraph(r, 10 + Math.floor(r() * 90), 10 + Math.floor(r() * 90), 0.85, 0.1) : lastG!;
      lastG = g;
      const tm = times(r, g, t % 7 === 6 ? 'adversarial' : 'real');
      const stHead = t % 9 === 8 ? null : Int32Array.from({ length: g.n }, () => (r() < 0.01 ? Math.floor(r() * 5) : -1));
      const ns = 1 + Math.floor(r() * 4);
      const seeds = Int32Array.from({ length: ns + 2 }, () => (r() < 0.05 ? -1 : Math.floor(r() * g.n)));
      // limits >= 0 only: every emergency.ts call site passes >= EPS. A limit <= -0.08 makes the ORIGINAL loop forever
      // on its next run (nb <= 0 leaves the seeds linked in bucket 0, the next run's seed pushes close a cycle); the
      // port reproduces that behaviour too, so it cannot be compared here.
      const limit = [2000, 60, 5000, NaN, 30, 25][t % 6];
      const stop0 = t % 4 === 1 ? 20 + r() * 40 : Infinity;
      const quitAfter = Math.floor(r() * 6);
      const lower = r() < 0.5;
      const mkVisit = (ds: DS, log: number[]) => (t % 11 === 10 ? null : (u: number, d: number) => {
        log.push(u, d);
        if (lower && log.length === 4) ds.stop = d + 3; // the visitor lowers the stop label
        return log.length / 2 > quitAfter;
      });
      const la: number[] = [], lb: number[] = [];
      A.stop = B.stop = stop0;
      A.run(g as RoadGraph, tm, seeds, ns, limit, stHead, mkVisit(A, la));
      B.run(g as RoadGraph, tm, seeds, ns, limit, stHead, mkVisit(B, lb));
      yields += lb.length / 2;
      if (A.settled !== B.settled) fails.push(`dispatch#${t}: settled ${A.settled}/${B.settled}`);
      if (la.length !== lb.length || la.some((v, i) => !Object.is(v, lb[i]))) fails.push(`dispatch#${t}: visitor calls differ (${la.length / 2} vs ${lb.length / 2})`);
      for (let v = 0; v < g.n; v++) {
        if (!Object.is(A.d(v), B.d(v)) || A.nx(v) !== B.nx(v)) { fails.push(`dispatch#${t}: d/nx(${v}) ${A.d(v)}/${B.d(v)} ${A.nx(v)}/${B.nx(v)}`); break; }
      }
    }
    expect(fails).toEqual([]);
    expect(emergencySearchStats.dispatchWasm).toBeGreaterThan(100);
    expect(yields).toBeGreaterThan(50);
  });
});
let lastG: Graph | null = null;
