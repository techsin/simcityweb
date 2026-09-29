/**
 * End-to-end: the real simulation (stress city, all infra systems) with src/sim/infra/blur.ts replaced by the wasm
 * bindings (vi.mock — no sim file is edited).
 *  1. shadow mode: every blur call the systems make (pollution, crime, ...) also runs the JS original on copies of
 *     the arguments; outputs must be bit-identical, call by call, on live data.
 *  2. determinism: a city simulated with preference 'js' and one simulated with the wasm kernels end up with
 *     bit-identical layers and identical stats (after a JS-vs-JS baseline confirms the sim itself is deterministic).
 */
import { describe, expect, it, vi } from 'vitest';
import type * as BlurModule from '../../src/sim/infra/blur';

interface Shadow {
  enabled: boolean;
  calls: Record<string, number>;
  wasmCalls: number;
  mismatches: string[];
}

vi.mock('../../src/sim/infra/blur', async (importOriginal) => {
  const orig = await importOriginal<typeof BlurModule>();
  const { makeBlurKernels, BLUR_KERNEL } = await import('../../src/wasm/kernels/blurBind');
  const wasm = makeBlurKernels(orig);
  const shadow: Shadow = { enabled: false, calls: {}, wasmCalls: 0, mismatches: [] };
  (globalThis as { __blurShadow?: Shadow }).__blurShadow = shadow;
  const isTA = (v: unknown): v is Float32Array => v instanceof Float32Array;
  const same = (a: Float32Array, b: Float32Array): boolean => {
    const ua = new Uint32Array(a.buffer, a.byteOffset, a.length), ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
    for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i] && !(a[i] !== a[i] && b[i] !== b[i])) return false;
    return true;
  };
  /** outputs (argument indices) of each function; scratch arguments are not compared */
  const OUT: Record<string, number[]> = {
    boxH: [1], boxV: [1], blur3: [0], boxAverage: [1], blurDown: [4], upsampleAdd: [1], blurDownAdd: [1, 6], shiftField: [1], shiftPlume: [1],
  };
  const api: Record<string, unknown> = { ...wasm };
  for (const name of Object.keys(OUT)) {
    const w = (wasm as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
    const j = (orig as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
    api[name] = (...args: unknown[]) => {
      shadow.calls[name] = (shadow.calls[name] ?? 0) + 1;
      if (BLUR_KERNEL.instance()) shadow.wasmCalls++;
      if (!shadow.enabled) return w(...args);
      const copies = args.map((a) => (isTA(a) ? a.slice() : a));
      const rj = j(...copies);
      const rw = w(...args);
      if (rj !== rw) shadow.mismatches.push(`${name}: return ${String(rw)} vs ${String(rj)}`);
      for (const k of OUT[name]) {
        if (!same(args[k] as Float32Array, copies[k] as Float32Array)) shadow.mismatches.push(`${name}: argument ${k} differs (N=${String(args[name === 'blurDown' ? 1 : 2])})`);
      }
      return rw;
    };
  }
  return api;
});

// imported after the mock is registered (vitest hoists vi.mock)
const { newSim, stressCity } = await import('../infra/cityGen');
const { setSimWasmPreference, simWasmStatus } = await import('../../src/wasm/simWasm');
const { DERIVED_LAYERS } = await import('../../src/save/serialize');
const shadow = (): Shadow => (globalThis as { __blurShadow?: Shadow }).__blurShadow!;

function layersOf(st: object): Map<string, Float32Array | Uint8Array | Int32Array> {
  const m = new Map<string, Float32Array | Uint8Array | Int32Array>();
  for (const [k, v] of Object.entries(st)) {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) m.set(k, v as Float32Array);
    else if (Array.isArray(v) && v.length && v.every((x) => ArrayBuffer.isView(x))) (v as Float32Array[]).forEach((a, i) => m.set(`${k}[${i}]`, a));
  }
  return m;
}

function diffStates(a: object, b: object): string[] {
  const la = layersOf(a), lb = layersOf(b);
  const out: string[] = [];
  for (const [k, va] of la) {
    const vb = lb.get(k);
    if (!vb || vb.length !== va.length) { out.push(`${k}: shape`); continue; }
    const ua = new Uint8Array(va.buffer, va.byteOffset, va.byteLength), ub = new Uint8Array(vb.buffer, vb.byteOffset, vb.byteLength);
    for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) { out.push(`${k}: byte ${i}`); break; }
  }
  const sa = JSON.stringify((a as { stats: unknown }).stats), sb = JSON.stringify((b as { stats: unknown }).stats);
  if (sa !== sb) out.push('stats');
  return out;
}

describe('real simulation with the wasm blur', () => {
  it('shadow mode: every blur call of the live systems is bit-identical to JS', { timeout: 600000 }, () => {
    setSimWasmPreference('auto');
    const city = stressCity(256);
    const sim = newSim(city.st);
    const s = shadow();
    s.enabled = true;
    for (let d = 0; d < 60; d++) sim.advanceDay();
    s.enabled = false;
    expect(simWasmStatus().state).toBe('ready');
    expect(s.mismatches).toEqual([]);
    // the live systems really exercised the kernels (pollution: blurDown / upsampleAdd / blurDownAdd / boxAverage; crime: blur3)
    for (const f of ['blur3', 'boxAverage', 'blurDown', 'upsampleAdd', 'blurDownAdd']) expect(s.calls[f] ?? 0, f).toBeGreaterThan(0);
    expect(s.wasmCalls).toBeGreaterThan(0);
    console.log('[blurSim] calls in 60 days:', JSON.stringify(s.calls), 'wasm:', s.wasmCalls, 'layers checked, 0 mismatches');
  });

  it('a city simulated on the wasm kernels is bit-identical to one simulated on JS', { timeout: 900000 }, () => {
    const DAYS = 75;
    const run = (pref: 'js' | 'auto') => {
      setSimWasmPreference(pref);
      const city = stressCity(256);
      const sim = newSim(city.st);
      for (let d = 0; d < DAYS; d++) sim.advanceDay();
      return city.st;
    };
    const jsA = run('js');
    const jsB = run('js');
    const baseline = diffStates(jsA, jsB);
    // if the sim itself were not deterministic run-to-run, the comparison below would be meaningless
    expect(baseline, 'JS vs JS baseline').toEqual([]);
    const before = shadow().wasmCalls;
    const wasm = run('auto');
    expect(shadow().wasmCalls - before, 'the wasm run used the wasm kernels').toBeGreaterThan(0);
    setSimWasmPreference('auto');
    expect(diffStates(jsA, wasm)).toEqual([]);
    // derived layers were compared too (they are real outputs of the blurs: treeCover etc.)
    expect([...layersOf(jsA).keys()].filter((k) => DERIVED_LAYERS.has(k)).length).toBeGreaterThan(5);
  });
});
