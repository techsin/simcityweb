/**
 * Replay of captured search.ts calls (captureFormat.ts) through interchangeable implementations — original JS, fair
 * optimised JS, wasm (resident WasmSearch), wasm copy mode (plain Search objects, outputs copied out), wasm from another
 * binary (e.g. the scalar build) — with lockstep bit-exact verification. Environment-agnostic (node worker / browser).
 */
import type * as JsSearch from '../../../src/sim/infra/search';
import type { RoadGraph } from '../../../src/sim/infra/graph';
import { callLabel, type CapCall, type Capture } from './captureFormat';

type Search = JsSearch.Search;
type Seeds = JsSearch.Seeds;
type TransitNet = JsSearch.TransitNet;

export interface Impl {
  name: string;
  newSearch: () => Search;
  roadSearch: (g: RoadGraph, adj: Int32Array, time: Float32Array, S: Search, heap: unknown, seeds: Seeds, limit?: number, ramp?: Float32Array | null) => void;
  transitSearch: (T: TransitNet, S: Search, heap: unknown, seeds: Seeds, limit?: number) => void;
  accumulate: (S: Search, acc: Float32Array | Float64Array, onSink?: (id: number, f: number, v: number) => void) => void;
}

interface Prepared {
  graphs: Map<string, RoadGraph>;
  seeds: Seeds[];
  nets: TransitNet[];
}

/** graph / seeds / net objects shared by all replays of one capture (inputs are never written by the searches) */
export function prepare(cap: Capture, SeedsCls: new () => Seeds): Prepared {
  const graphs = new Map<string, RoadGraph>();
  for (const [k, g] of Object.entries(cap.graphs)) graphs.set(k, { n: g.n, version: g.version, fwd: g.fwd, rev: g.rev, type: g.type } as unknown as RoadGraph);
  const seeds: Seeds[] = [];
  const nets: TransitNet[] = [];
  for (const c of cap.calls) {
    if (c.kind === 'acc') { seeds.push(null as unknown as Seeds); nets.push(null as unknown as TransitNet); continue; }
    const s = new SeedsCls();
    for (let i = 0; i < c.seeds.n; i++) s.push(c.seeds.node[i], c.seeds.label[i], c.seeds.id[i]);
    seeds.push(s);
    nets.push(c.kind === 'transit' ? (c.T as unknown as TransitNet) : (null as unknown as TransitNet));
  }
  return { graphs, seeds, nets };
}

export interface Replay {
  impl: Impl;
  /** replay the selected calls (all by default) in capture order */
  run(): void;
  /** the Search objects by captured id */
  searches: Map<number, Search>;
  /** the flow buffers of the accumulate calls (working copies, restored at every run) */
  accBufs: (Float32Array | Float64Array | null)[];
  sinks: number[][];
}

/**
 * A replay of `cap` through `impl`. `only` selects call indices (default: all). Accumulate calls restore their input
 * flows at the start of the call (a .set of n floats on both sides of an A/B: identical harness cost).
 * `accStates`: for accumulate-only replays, the Search state each accumulate call saw (see snapshotAccStates).
 */
export function makeReplay(cap: Capture, P: Prepared, impl: Impl, only?: number[], accStates?: Map<number, Search>): Replay {
  const searches = new Map<number, Search>();
  const S = (id: number) => {
    let s = searches.get(id);
    if (!s) searches.set(id, (s = impl.newSearch()));
    return s;
  };
  const calls = cap.calls;
  const idx = only ?? calls.map((_, i) => i);
  const accBufs = calls.map((c) => (c.kind === 'acc' ? c.acc.slice() : null));
  const sinks: number[][] = calls.map(() => []);
  const heap = null;
  const steps: (() => void)[] = idx.map((i) => {
    const c = calls[i];
    if (c.kind === 'road') {
      const g = P.graphs.get(c.graph)!;
      const adj = c.dir === 'fwd' ? g.fwd : c.dir === 'rev' ? g.rev : c.adj!;
      const s = S(c.S), seeds = P.seeds[i];
      return () => impl.roadSearch(g, adj, c.time, s, heap, seeds, c.limit, c.ramp);
    }
    if (c.kind === 'transit') {
      const s = S(c.S), seeds = P.seeds[i], T = P.nets[i];
      return () => impl.transitSearch(T, s, heap, seeds, c.limit);
    }
    const buf = accBufs[i]!, input = c.acc, rec = sinks[i];
    const s = accStates?.get(i) ?? S(c.S);
    const onSink = c.sink ? (id: number, f: number, v: number) => { rec.push(id, f, v); } : undefined;
    return () => {
      (buf as Float32Array).set(input as Float32Array);
      rec.length = 0;
      impl.accumulate(s, buf, onSink);
    };
  });
  return {
    impl, searches, accBufs, sinks,
    run() {
      for (let k = 0; k < steps.length; k++) steps[k]();
    },
  };
}

const f64eq = (a: number, b: number) => Object.is(a, b) || (a !== a && b !== b);

/** compare two searches' observable state over n nodes */
export function diffSearch(a: Search, b: Search, n: number): string {
  if (a.settled !== b.settled) return `settled ${a.settled} vs ${b.settled}`;
  for (let v = 0; v < n; v++) {
    if (!Object.is(a.dist[v], b.dist[v])) return `dist[${v}] ${a.dist[v]} vs ${b.dist[v]}`;
    if (a.src[v] !== b.src[v] || a.next[v] !== b.next[v] || a.done[v] !== b.done[v]) return `src/next/done[${v}]`;
    if (a.dist[v] < Infinity && a.hops[v] !== b.hops[v]) return `hops[${v}]`;
  }
  for (let k = 0; k < a.settled; k++) if (a.order[k] !== b.order[k]) return `order[${k}]`;
  return '';
}

/**
 * Run `ref` and `cand` over the whole capture in lockstep, comparing every call's outputs (search state, flows, sink
 * sequence) and the settled counts recorded at capture time. Returns the failures (empty = bit-identical).
 */
export function verifyLockstep(cap: Capture, P: Prepared, ref: Impl, cand: Impl): string[] {
  const fails: string[] = [];
  for (let i = 0; i < cap.calls.length && fails.length < 10; i++) {
    // replays of the prefix [0, i] would be quadratic: instead keep two persistent replays and step them together
    void i;
    break;
  }
  const A = makeReplay(cap, P, ref), B = makeReplay(cap, P, cand);
  const stepA = stepper(cap, P, A), stepB = stepper(cap, P, B);
  for (let i = 0; i < cap.calls.length; i++) {
    const c = cap.calls[i];
    stepA(i);
    stepB(i);
    const sa = A.searches.get(c.S)!, sb = B.searches.get(c.S)!;
    const n = c.kind === 'transit' ? c.T.total : c.kind === 'road' ? P.graphs.get(c.graph)!.n : sa.n;
    const label = `#${i} ${callLabel(c)}`;
    if (c.kind !== 'acc') {
      const d = diffSearch(sa, sb, n);
      if (d) fails.push(`${label}: ${d}`);
      if (sa.settled !== c.settled) fails.push(`${label}: ${ref.name} settled ${sa.settled}, capture ${c.settled}`);
    } else {
      const x = A.accBufs[i]!, y = B.accBufs[i]!;
      for (let v = 0; v < x.length; v++) if (!f64eq(x[v], y[v])) { fails.push(`${label}: acc[${v}] ${x[v]} vs ${y[v]}`); break; }
      const p = A.sinks[i], q = B.sinks[i];
      if (p.length !== q.length || p.some((v, k) => !f64eq(v, q[k]))) fails.push(`${label}: sink sequence (${p.length / 3} vs ${q.length / 3})`);
    }
    if (fails.length >= 10) break;
  }
  return fails;
}

/** single-call stepping over a replay's steps (same objects as run()) */
function stepper(cap: Capture, P: Prepared, R: Replay): (i: number) => void {
  const per = cap.calls.map((_, i) => makeReplayStep(cap, P, R, i));
  return (i) => per[i]();
}

function makeReplayStep(cap: Capture, P: Prepared, R: Replay, i: number): () => void {
  const c = cap.calls[i];
  const impl = R.impl;
  const S = (id: number) => {
    let s = R.searches.get(id);
    if (!s) R.searches.set(id, (s = impl.newSearch()));
    return s;
  };
  if (c.kind === 'road') {
    const g = P.graphs.get(c.graph)!;
    const adj = c.dir === 'fwd' ? g.fwd : c.dir === 'rev' ? g.rev : c.adj!;
    return () => impl.roadSearch(g, adj, c.time, S(c.S), null, P.seeds[i], c.limit, c.ramp);
  }
  if (c.kind === 'transit') return () => impl.transitSearch(P.nets[i], S(c.S), null, P.seeds[i], c.limit);
  return () => {
    const buf = R.accBufs[i]!;
    (buf as Float32Array).set(c.acc as Float32Array);
    const rec = R.sinks[i];
    rec.length = 0;
    impl.accumulate(S(c.S), buf, c.sink ? (id, f, v) => { rec.push(id, f, v); } : undefined);
  };
}

/**
 * For accumulate-only timing: replay the capture once with `impl` and record, for every accumulate call, a Search of
 * `impl` holding the state that call saw (order / next / src / settled / n copied into a fresh search of that impl).
 */
export function snapshotAccStates(cap: Capture, P: Prepared, impl: Impl): Map<number, Search> {
  const R = makeReplay(cap, P, impl);
  const step = stepper(cap, P, R);
  const out = new Map<number, Search>();
  for (let i = 0; i < cap.calls.length; i++) {
    const c = cap.calls[i];
    if (c.kind === 'acc') {
      const src = R.searches.get(c.S)!;
      const s = impl.newSearch();
      s.ensure(src.n);
      s.order.set(src.order.subarray(0, src.settled));
      s.next.set(src.next.subarray(0, src.n));
      s.src.set(src.src.subarray(0, src.n));
      s.dist.set(src.dist.subarray(0, src.n));
      s.done.set(src.done.subarray(0, src.n));
      s.settled = src.settled;
      s.n = src.n;
      out.set(i, s);
    }
    step(i);
  }
  return out;
}

/** call indices grouped by label, plus 'all' */
export function groups(cap: Capture): Map<string, number[]> {
  const m = new Map<string, number[]>();
  cap.calls.forEach((c, i) => {
    const k = callLabel(c);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(i);
  });
  return m;
}
