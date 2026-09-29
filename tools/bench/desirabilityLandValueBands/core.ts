/**
 * Shared core of the desirability / land-value band benchmarks (node worker and browser Web Worker; no node imports):
 * band-input captures (format, capture from a running simulation), the arms (original JS as-is, fair JS, wasm resident /
 * staged per kernel instance), the three sweep cases and the bit-exactness check that precedes every timing.
 *
 * A capture holds everything one daily band reads, taken from a real simulation after its warm-up days: the CityState
 * layers (zone, network, water, building, heights, land value, pollution, crime, noise, traffic, commute, coverage,
 * desirability[0..11]), the EconRuntime arrays (coarse pop / freight / wealth, lvStatic / lvEffects / lvLandfill), the
 * infra flags, stats.avgCommute and prepShift's shift.
 */
import { CityState } from '../../../src/sim/CityState';
import type { EconRuntime } from '../../../src/sim/economy/runtime';
import { infraFlags } from '../../../src/sim/economy/runtime';
import { makeOriginalBands } from '../../../tests/wasm/econBandsOriginal';
import { makeEconBandsJs, type EconBandFns, type EconBandTables } from '../../../src/wasm/js/desirabilityLandValueBands';
import { makeEconBandKernels, type EconBindStats, type EconWasm } from '../../../src/wasm/kernels/desirabilityLandValueBandsBind';
import { ECON_TABLES, econBandsJs } from '../../../src/wasm/kernels/desirabilityLandValueBands';
import { WasmHeap, type HeapArrayCtor } from '../../../src/wasm/heap';

export type Layer = Uint8Array | Int32Array | Float32Array;

/** CityState layers the bands use (desirability[d] is stored as des<d>) */
export const ST_LAYERS = [
  'zone', 'network', 'water', 'building', 'heights', 'landValue', 'airPollution', 'waterPollution', 'garbage', 'crime', 'noise', 'traffic',
  'commute', 'policeCov', 'fireCov', 'healthCov', 'eduCov', 'parkCov', 'transitCov',
] as const;
export const RT_LAYERS = ['coarsePop', 'coarseFreight', 'coarseWealth', 'lvStatic', 'lvEffects', 'lvLandfill'] as const;
export const DEVS = 12;

export interface EconCapture {
  name: string;
  N: number;
  cw: number;
  day: number;
  population: number;
  avgCommute: number;
  systemData: { infraVersion?: unknown; infraLayers?: unknown };
  shift: Float32Array;
  layers: Record<string, Layer>;
}

// ------------------------------------------------------------------------------------------------ format
const MAGIC = 0x45434f4e; // 'ECON'

/** [u32 magic][u32 header bytes][header JSON][pad to 8][layer data, each 8-aligned] */
export function encodeCapture(c: EconCapture): Uint8Array {
  const entries: { name: string; type: string; offset: number; length: number }[] = [];
  let off = 0;
  const names = Object.keys(c.layers);
  for (const name of names) {
    const a = c.layers[name];
    entries.push({ name, type: a.constructor.name, offset: off, length: a.length });
    off += Math.ceil(a.byteLength / 8) * 8;
  }
  const header = JSON.stringify({
    name: c.name, N: c.N, cw: c.cw, day: c.day, population: c.population, avgCommute: c.avgCommute, systemData: c.systemData,
    shift: Array.from(c.shift), entries,
  });
  const hb = new TextEncoder().encode(header);
  const dataStart = Math.ceil((8 + hb.length) / 8) * 8;
  const out = new Uint8Array(dataStart + off);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, hb.length, true);
  out.set(hb, 8);
  for (let k = 0; k < names.length; k++) {
    const a = c.layers[names[k]];
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), dataStart + entries[k].offset);
  }
  return out;
}

export function decodeCapture(bytes: Uint8Array): EconCapture {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not an econ band capture');
  const hl = dv.getUint32(4, true);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))) as {
    name: string; N: number; cw: number; day: number; population: number; avgCommute: number; systemData: EconCapture['systemData'];
    shift: number[]; entries: { name: string; type: string; offset: number; length: number }[];
  };
  const dataStart = Math.ceil((8 + hl) / 8) * 8;
  const layers: Record<string, Layer> = {};
  for (const e of h.entries) {
    const Ctor = e.type === 'Uint8Array' ? Uint8Array : e.type === 'Int32Array' ? Int32Array : Float32Array;
    const bpe = Ctor.BYTES_PER_ELEMENT;
    const copy = bytes.slice(bytes.byteOffset + dataStart + e.offset, bytes.byteOffset + dataStart + e.offset + e.length * bpe);
    layers[e.name] = new Ctor(copy.buffer, 0, e.length);
  }
  return { name: h.name, N: h.N, cw: h.cw, day: h.day, population: h.population, avgCommute: h.avgCommute, systemData: h.systemData, shift: Float32Array.from(h.shift), layers };
}

/** capture the band inputs of a running simulation (shift from the 24f8609 prepShift on the current budget) */
export function captureFrom(name: string, st: CityState, rt: EconRuntime): EconCapture {
  const layers: Record<string, Layer> = {};
  const rec = st as unknown as Record<string, Layer>;
  for (const k of ST_LAYERS) layers[k] = rec[k].slice();
  for (let d = 0; d < DEVS; d++) layers['des' + d] = st.desirability[d].slice();
  const rrec = rt as unknown as Record<string, Layer>;
  for (const k of RT_LAYERS) layers[k] = rrec[k].slice();
  const ob = makeOriginalBands(rt);
  ob.prepShift(st);
  const sd = st.systemData as EconCapture['systemData'];
  return {
    name, N: st.size, cw: rt.cw, day: st.day, population: st.stats.population, avgCommute: st.stats.avgCommute,
    systemData: { infraVersion: sd.infraVersion, infraLayers: sd.infraLayers }, shift: ob.shift.slice(), layers,
  };
}

// ------------------------------------------------------------------------------------------------ arms
export interface ArmState {
  st: CityState;
  rt: EconRuntime;
  shift: Float32Array;
  acc: Float64Array;
}

export interface Arm {
  label: string;
  state: ArmState;
  desirability(z0: number, z1: number, allCells: boolean): void;
  landValue(z0: number, z1: number, first: boolean): void;
  /** land-value accumulators after the last sweep */
  acc(): number[];
  resetAcc(): void;
  stats?: EconBindStats;
  /** free wasm blocks (resident arms) */
  dispose(): void;
}

/** a CityState-shaped object (the real prototype, for cellSlope) over copies of the captured layers */
function makeState(c: EconCapture, alloc: (a: Layer) => Layer): ArmState {
  const st = Object.create(CityState.prototype) as CityState;
  const rec = st as unknown as Record<string, unknown>;
  rec.size = c.N;
  rec.cells = c.N * c.N;
  for (const k of ST_LAYERS) rec[k] = alloc(c.layers[k]);
  rec.desirability = Array.from({ length: DEVS }, (_, d) => alloc(c.layers['des' + d]));
  rec.stats = { avgCommute: c.avgCommute };
  rec.systemData = { ...c.systemData };
  rec.budget = { taxRates: new Array(DEVS).fill(9) };
  const rt = { cw: c.cw } as unknown as EconRuntime;
  const rrec = rt as unknown as Record<string, unknown>;
  for (const k of RT_LAYERS) rrec[k] = alloc(c.layers[k]);
  return { st, rt, shift: c.shift.slice(), acc: new Float64Array(4) };
}

const copyPlain = (a: Layer): Layer => a.slice();

export function origArm(c: EconCapture): Arm {
  const s = makeState(c, copyPlain);
  const ob = makeOriginalBands(s.rt);
  ob.shift.set(c.shift);
  return {
    label: 'JS as-is',
    state: s,
    desirability: (z0, z1, all) => ob.desirability(s.st, z0, z1, all),
    landValue: (z0, z1, first) => ob.landValue(s.st, z0, z1, first),
    acc: () => ob.acc(),
    resetAcc: () => ob.setAcc(0, 0, 0, 0),
    dispose() {},
  };
}

function bandArm(label: string, s: ArmState, bands: EconBandFns, stats?: EconBindStats, dispose = () => {}): Arm {
  return {
    label,
    state: s,
    desirability: (z0, z1, all) => bands.desirability(s.st, s.rt, infraFlags(s.st), s.shift, z0, z1, all),
    landValue: (z0, z1, first) => bands.landValue(s.st, s.rt, infraFlags(s.st), z0, z1, first, s.acc),
    acc: () => Array.from(s.acc),
    resetAcc: () => s.acc.fill(0),
    stats,
    dispose,
  };
}

/**
 * the fair JS; with the live tables it reuses the module's instance (econBandsJs), so the process has ONE closure of
 * each band function literal, as in the game (one system instance per simulation)
 */
export function fixedArm(c: EconCapture, tb: EconBandTables): Arm {
  return bandArm('fair JS', makeState(c, copyPlain), tb === ECON_TABLES ? econBandsJs : makeEconBandsJs(tb));
}

/** any EconBandFns on plain copies of the capture (variants of the JS bands) */
export function bandsArm(c: EconCapture, label: string, bands: EconBandFns): Arm {
  return bandArm(label, makeState(c, copyPlain), bands);
}

/** wasm kernels of `w`; resident = the layers live in w's memory (zero copy), else plain arrays staged per call */
export function wasmArm(c: EconCapture, tb: EconBandTables, w: EconWasm, label: string, resident: boolean): Arm {
  const blocks: Layer[] = [];
  // one reserve() up front (a safe point): resident layers + full-size staging blocks never grow memory later
  // (growth would detach the views of every resident arm in this memory)
  let bytes = 0;
  for (const k of Object.keys(c.layers)) bytes += Math.ceil(c.layers[k].byteLength / 16) * 16 + 16;
  // (a resident arm leaves room for one staged arm of the same capture after it)
  const staging = 44 * c.N * c.N * 4 + (2 << 20);
  w.heap.reserve(resident ? bytes + 2 * staging : staging);
  const alloc = resident
    ? (a: Layer): Layer => {
      const v = w.heap.allocArray(a.constructor as unknown as HeapArrayCtor<Float32Array>, a.length) as Layer;
      (v as Float32Array).set(a as Float32Array);
      blocks.push(v);
      return v;
    }
    : copyPlain;
  const s = makeState(c, alloc);
  const stats: EconBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
  // no JS fallback in a benchmark arm: a call outside the kernel's domain must fail loudly, never silently measure JS
  const never: EconBandFns = {
    desirability() { throw new Error(`${label}: desirability call fell back to JS`); },
    landValue() { throw new Error(`${label}: land value call fell back to JS`); },
  };
  const bands = makeEconBandKernels(tb, never, { wasm: w, stats });
  return bandArm(label, s, bands, stats, () => { for (const b of blocks) w.heap.free(b); blocks.length = 0; });
}

/** an explicit kernel instance of a binary (scalar / SIMD builds) with its own memory + heap */
export function instantiate(mod: WebAssembly.Module, reserveBytes = 96 << 20): EconWasm {
  const inst = new WebAssembly.Instance(mod, {});
  const ex = inst.exports as unknown as EconWasm['ex'] & { __heap_base: WebAssembly.Global };
  const heap = new WasmHeap(ex.memory, Number(ex.__heap_base.value));
  heap.reserve(reserveBytes);
  return { ex, heap };
}

// ------------------------------------------------------------------------------------------------ sweeps
export type SweepKind = 'desZoned' | 'desAll' | 'lv';
export const SWEEPS: SweepKind[] = ['desZoned', 'desAll', 'lv'];

/** the daily bands of one full sweep: ceil(N / 12) rows per band (DESIR_REFRESH_DAYS = LV_REFRESH_DAYS = 12) */
export function bandsOf(N: number, days = 12): [number, number][] {
  const rows = Math.ceil(N / days);
  const out: [number, number][] = [];
  for (let z = 0; z < N; z += rows) out.push([z, Math.min(N, z + rows)]);
  return out;
}

export function sweep(arm: Arm, kind: SweepKind, bands: [number, number][]): void {
  if (kind === 'lv') {
    arm.resetAcc();
    for (const [z0, z1] of bands) arm.landValue(z0, z1, false);
  } else {
    const all = kind === 'desAll';
    for (const [z0, z1] of bands) arm.desirability(z0, z1, all);
  }
}

/** one band (the per-day unit of work) */
export function oneBand(arm: Arm, kind: SweepKind, band: [number, number]): void {
  if (kind === 'lv') arm.landValue(band[0], band[1], false);
  else arm.desirability(band[0], band[1], kind === 'desAll');
}

/**
 * JS heap bytes allocated by one daily band (median over `n` bands, heapUsed delta after a forced GC; needs
 * --expose-gc, else null). Kernels that do not allocate report ~0.3 KiB (the measurement itself).
 */
export function heapPerBand(arm: Arm, kind: SweepKind, bands: [number, number][], n = 12): number | null {
  const gc = (globalThis as { gc?: () => void }).gc;
  const mem = (globalThis as { process?: { memoryUsage(): { heapUsed: number } } }).process?.memoryUsage;
  if (typeof gc !== 'function' || !mem) return null;
  const xs: number[] = [];
  for (let k = 0; k < n; k++) {
    gc();
    const h0 = mem().heapUsed;
    oneBand(arm, kind, bands[k % bands.length]);
    xs.push(mem().heapUsed - h0);
  }
  xs.sort((p, q) => p - q);
  return xs[n >> 1];
}

// ------------------------------------------------------------------------------------------------ equivalence
function sameBits(a: Layer, b: Layer): number {
  const ua = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2), ub = new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
  for (let i = 0; i < ua.length; i++) {
    if (ua[i] !== ub[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return i;
  }
  return -1;
}

/** compare the outputs of two arms (12 desirability layers, land value, the 4 accumulators as f64 bits); '' = identical */
export function diffArms(a: Arm, b: Arm): string {
  for (let d = 0; d < DEVS; d++) {
    const i = sameBits(a.state.st.desirability[d], b.state.st.desirability[d]);
    if (i >= 0) return `desirability[${d}] differs at ${i}: ${a.state.st.desirability[d][i]} vs ${b.state.st.desirability[d][i]}`;
  }
  const i = sameBits(a.state.st.landValue, b.state.st.landValue);
  if (i >= 0) return `landValue differs at ${i}: ${a.state.st.landValue[i]} vs ${b.state.st.landValue[i]}`;
  const x = new Float64Array(a.acc()), y = new Float64Array(b.acc());
  const bx = new BigUint64Array(x.buffer), by = new BigUint64Array(y.buffer);
  for (let k = 0; k < 4; k++) if (bx[k] !== by[k] && !(Number.isNaN(x[k]) && Number.isNaN(y[k]))) return `accumulator ${k}: ${x[k]} vs ${y[k]}`;
  return '';
}

/**
 * bit-exactness of every arm against the first: a zoned sweep, an allCells sweep and a land-value sweep (or `kinds`),
 * compared after EVERY band (desirability layers, land value, accumulators). Throws on the first difference.
 */
export function checkArms(arms: Arm[], N: number, bands: [number, number][] = bandsOf(N), kinds: SweepKind[] = SWEEPS): void {
  for (const kind of kinds) {
    for (const a of arms) a.resetAcc();
    for (const band of bands) {
      for (const a of arms) oneBand(a, kind, band);
      for (let k = 1; k < arms.length; k++) {
        const d = diffArms(arms[0], arms[k]);
        if (d) throw new Error(`${arms[k].label} vs ${arms[0].label}, ${kind} band ${band[0]}..${band[1]}: ${d}`);
      }
    }
  }
}
