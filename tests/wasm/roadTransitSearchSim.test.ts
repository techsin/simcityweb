/**
 * End-to-end: the real simulation (stress city, all systems) with src/sim/infra/search.ts replaced by the wasm
 * bindings (vi.mock — no sim file is edited; traffic's Search objects become resident WasmSearch objects).
 *  1. shadow mode: every roadSearch / transitSearch / accumulate call the live systems make also runs the JS original
 *     (on a separate Search, on a copy of the flows); outputs must be bit-identical, call by call, on live data.
 *  2. determinism: a city simulated with preference 'js' and one simulated with the wasm kernels end up with
 *     bit-identical layers and identical stats (after a JS-vs-JS baseline confirms the sim itself is deterministic).
 */
import { describe, expect, it, vi } from 'vitest';
import type * as SearchModule from '../../src/sim/infra/search';

interface Shadow {
  enabled: boolean;
  calls: Record<string, number>;
  wasmCalls: number;
  mismatches: string[];
}

vi.mock('../../src/sim/infra/search', async (importOriginal) => {
  const orig = await importOriginal<typeof SearchModule>();
  const P = await import('../../src/sim/infra/params');
  const { Network } = await import('../../src/core/types');
  const { makeSearchKernels, SEARCH_KERNEL } = await import('../../src/wasm/kernels/searchBind');
  const wasm = makeSearchKernels(orig, { NET_TIME: P.NET_TIME, RAMP_PENALTY: P.RAMP_PENALTY, SUBWAY_TIME: P.SUBWAY_TIME, BUS_TIME_FACTOR: P.BUS_TIME_FACTOR, HIGHWAY: Network.Highway });
  const shadow: Shadow = { enabled: false, calls: {}, wasmCalls: 0, mismatches: [] };
  (globalThis as { __searchShadow?: Shadow }).__searchShadow = shadow;
  type S = SearchModule.Search;
  const diff = (a: S, b: S, n: number): string => {
    if (a.settled !== b.settled) return `settled ${a.settled} vs ${b.settled}`;
    for (let v = 0; v < n; v++) {
      if (!Object.is(a.dist[v], b.dist[v]) || a.src[v] !== b.src[v] || a.next[v] !== b.next[v] || a.done[v] !== b.done[v]) return `node ${v}`;
      if (a.dist[v] < Infinity && a.hops[v] !== b.hops[v]) return `hops ${v}`;
    }
    for (let k = 0; k < a.settled; k++) if (a.order[k] !== b.order[k]) return `order ${k}`;
    return '';
  };
  const count = (k: string) => {
    shadow.calls[k] = (shadow.calls[k] ?? 0) + 1;
    if (SEARCH_KERNEL.instance()) shadow.wasmCalls++;
  };
  const refRoad = new orig.Search(), refTransit = new orig.Search();
  const roadSearch: typeof orig.roadSearch = (...a: Parameters<typeof orig.roadSearch>) => {
    count('roadSearch');
    if (!shadow.enabled) return wasm.roadSearch(...a);
    const [g, adj, time, S, heap, seeds, limit] = a;
    const rest = a.slice(7) as unknown[];
    (orig.roadSearch as (...x: unknown[]) => void)(g, adj, time, refRoad, heap, seeds, limit, ...rest);
    wasm.roadSearch(...a);
    const d = diff(refRoad, S, g.n);
    if (d || S.graphVersion !== refRoad.graphVersion) shadow.mismatches.push(`roadSearch (limit ${limit}): ${d || 'graphVersion'}`);
  };
  const transitSearch: typeof orig.transitSearch = (T, S, heap, seeds, limit) => {
    count('transitSearch');
    if (!shadow.enabled) return wasm.transitSearch(T, S, heap, seeds, limit);
    orig.transitSearch(T, refTransit, heap, seeds, limit);
    wasm.transitSearch(T, S, heap, seeds, limit);
    const d = diff(refTransit, S, T.total);
    if (d) shadow.mismatches.push(`transitSearch: ${d}`);
  };
  const accumulate: typeof orig.accumulate = (S, acc, onSink) => {
    count('accumulate');
    if (!shadow.enabled) return wasm.accumulate(S, acc, onSink);
    const ref = acc.slice();
    const sr: number[] = [], sw: number[] = [];
    orig.accumulate(S, ref, onSink ? (a, f, v) => { sr.push(a, f, v); } : undefined);
    wasm.accumulate(S, acc, onSink ? (a, f, v) => { sw.push(a, f, v); onSink(a, f, v); } : undefined);
    for (let i = 0; i < acc.length; i++) {
      if (!(Object.is(acc[i], ref[i]) || (acc[i] !== acc[i] && ref[i] !== ref[i]))) { shadow.mismatches.push(`accumulate: acc[${i}]`); break; }
    }
    if (sr.length !== sw.length || sr.some((v, i) => !Object.is(v, sw[i]))) shadow.mismatches.push(`accumulate: sink sequence (${sr.length / 3} vs ${sw.length / 3})`);
  };
  return { ...wasm, roadSearch, transitSearch, accumulate };
});

// imported after the mock is registered (vitest hoists vi.mock)
const { newSim, stressCity } = await import('../infra/cityGen');
const { setSimWasmPreference, simWasmStatus } = await import('../../src/wasm/simWasm');
const { isResidentSearch } = await import('../../src/wasm/kernels/searchBind');
const shadow = (): Shadow => (globalThis as { __searchShadow?: Shadow }).__searchShadow!;

function layersOf(st: object): Map<string, ArrayBufferView> {
  const m = new Map<string, ArrayBufferView>();
  for (const [k, v] of Object.entries(st)) {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) m.set(k, v);
    else if (Array.isArray(v) && v.length && v.every((x) => ArrayBuffer.isView(x))) (v as ArrayBufferView[]).forEach((a, i) => m.set(`${k}[${i}]`, a));
  }
  return m;
}

function diffStates(a: object, b: object): string[] {
  const la = layersOf(a), lb = layersOf(b);
  const out: string[] = [];
  for (const [k, va] of la) {
    const vb = lb.get(k);
    if (!vb || vb.byteLength !== va.byteLength) { out.push(`${k}: shape`); continue; }
    const ua = new Uint8Array(va.buffer, va.byteOffset, va.byteLength), ub = new Uint8Array(vb.buffer, vb.byteOffset, vb.byteLength);
    for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) { out.push(`${k}: byte ${i}`); break; }
  }
  const sa = JSON.stringify((a as { stats: unknown }).stats), sb = JSON.stringify((b as { stats: unknown }).stats);
  if (sa !== sb) out.push('stats');
  const pa = [...(a as { buildings: Map<number, { pop: number; jobs?: number }> }).buildings.values()].map((x) => `${x.pop}/${x.jobs ?? ''}`).join(',');
  const pb = [...(b as { buildings: Map<number, { pop: number; jobs?: number }> }).buildings.values()].map((x) => `${x.pop}/${x.jobs ?? ''}`).join(',');
  if (pa !== pb) out.push('buildings');
  return out;
}

describe('real simulation with the wasm road / transit searches', () => {
  it('shadow mode: every search / accumulate call of the live traffic system is bit-identical to JS', { timeout: 900000 }, () => {
    setSimWasmPreference('auto');
    const city = stressCity(256);
    const sim = newSim(city.st);
    const s = shadow();
    s.enabled = true;
    for (let d = 0; d < 40; d++) sim.advanceDay();
    // a few forced full traffic assignments on top of the scheduled ones
    const tr = sim.getSystem('traffic') as unknown as { runCycleSync(x: unknown): void; SA: object };
    for (let k = 0; k < 3; k++) tr.runCycleSync(sim);
    s.enabled = false;
    expect(simWasmStatus().state).toBe('ready');
    expect(s.mismatches.slice(0, 10)).toEqual([]);
    for (const f of ['roadSearch', 'transitSearch', 'accumulate']) expect(s.calls[f] ?? 0, f).toBeGreaterThan(0);
    expect(s.wasmCalls).toBeGreaterThan(0);
    expect(isResidentSearch(tr.SA)).toBe(true);
    console.log('[roadTransitSearchSim] calls:', JSON.stringify(s.calls), 'wasm:', s.wasmCalls, '0 mismatches');
  });

  it('a city simulated on the wasm searches is bit-identical to one simulated on JS', { timeout: 1200000 }, () => {
    const DAYS = 60;
    const run = (pref: 'js' | 'auto') => {
      setSimWasmPreference(pref);
      const city = stressCity(256);
      const sim = newSim(city.st);
      for (let d = 0; d < DAYS; d++) sim.advanceDay();
      (sim.getSystem('traffic') as unknown as { runCycleSync(x: unknown): void }).runCycleSync(sim);
      return city.st;
    };
    const jsA = run('js');
    const jsB = run('js');
    // if the sim itself were not deterministic run-to-run, the comparison below would be meaningless
    expect(diffStates(jsA, jsB), 'JS vs JS baseline').toEqual([]);
    const before = shadow().wasmCalls;
    const wasm = run('auto');
    expect(shadow().wasmCalls - before, 'the wasm run used the wasm kernels').toBeGreaterThan(0);
    setSimWasmPreference('auto');
    expect(diffStates(jsA, wasm)).toEqual([]);
  });
});
