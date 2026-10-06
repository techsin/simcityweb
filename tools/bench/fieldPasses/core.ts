/**
 * Shared core of the field-pass benchmarks (node worker and browser Web Worker; no node imports): captures (format),
 * the arms (original JS as-is, fair JS, wasm resident / staged per kernel instance), the cases and the bit-exactness
 * check that precedes every timing.
 *
 * A capture holds the inputs of the field kernels of one NIMBY rebuild and one pollution pass, taken from a real
 * simulation after its warm-up days (tools/bench/fieldPasses/capture.ts): the list of splatAdd calls of the building walk
 * (x, z, w, d, amount, R, target — in walk order) with the landfill / corridor layers, the stageCells inputs (layers,
 * class-0 sources after stageA, freight cells, landfill regions, the per-pass constants), the air / noise saturate inputs
 * (fields after the blur / plume, the layers before), the water stage inputs (the blurred sources, layers, ground, the
 * water list) and the soil inputs; plus the real rebuildNimby's outputs and cost estimate.
 *
 * Cases: nimby (the raster work of one rebuild: as-is = nimby.ts's splatAdd / landfill / splatMax / exp loops over the
 * captured calls; fair JS / wasm = the source list rebuilt from the calls (table resolution) + one kernels.nimby call,
 * corridor raster cached), nimbyNoCache (the same with the corridor raster rebuilt every time: the wasm vs JS gain
 * without the fair-baseline change), cells, airSat, noiseSat, water, soil, and pass (the five pollution field stages of
 * one pass in a row). Kernels mutate their in/out arrays: timings run on evolving states (every arm evolves identically:
 * the work does not depend on the outputs); the check resets every arm to the capture first.
 */
import { falloff } from '../../../src/sim/infra/catchments';
import { WasmHeap, type HeapArrayCtor } from '../../../src/wasm/heap';
import { simWasmImports } from '../../../src/wasm/simWasm';
import {
  NimbySources, NimbyTables, PH_ALL, fieldKernelsJs, type CellsArgs, type FieldKernels, type NimbyArgs, type NimbyCtx, type WaterArgs,
} from '../../../src/wasm/js/fieldPasses';
import { makeFieldKernels, releaseNimbyCtx, type FieldsBindStats, type FieldsWasm } from '../../../src/wasm/kernels/fieldPassesBind';
import {
  makeOriginalNimby, origSaturate, origSoil, origStageBAfterBlur, origStageCells, type OrigCellsInput, type OrigNimbyInput, type OrigSplat,
} from '../../../tests/wasm/fieldPassesOriginal';

export type TA = Float32Array | Float64Array | Int32Array | Uint8Array;

export interface CaptureMeta {
  name: string;
  N: number;
  day: number;
  population: number;
  /** '' or the synthetic water variant (e.g. 'coast (9090 cells)') */
  variant: string;
  nimby: {
    lfA: number; lfR: number; idle: number; highway: { amount: number; radius: number }; bridge: number; rail: { amount: number; radius: number };
    /** the real rebuildNimby's touches (from its cost estimate) and cost estimate */
    touches: number; cost: number; buildings: number;
  };
  cells: {
    smell: number; waterK: number; soilGW: number; trafficAir: number; tunnelAir: number; congDamp: number; crossing: number; noisePerTrip: number;
    tunnelNoise: number; bridgeNoise: number; tn: number; freightS: number; perTrip: number[]; base: number[]; highway: number; rail: number;
    nReg: number; regStart: number[]; regCount: number[]; regCap: number[]; regUsed: number[]; lfAir: number; lfWater: number; lfNoise: number;
    LANDFILL_IDLE_EMIT: number; LANDFILL_SIZE_REF: number; SOIL_SRC_LANDFILL: number; hasFreight: boolean; used: number[];
  };
  air: { invK: number; alpha: number; k1: number };
  noise: { invK: number; alpha: number; k1: number; k2: number };
  water: { invK: number; alpha: number; bankCoupling: number; nW: number; WATER_K: number };
  soil: { dt: number; soilDecay: number; SOIL_RATE: number; SOIL_DECAY: number; grow: number; keep: number };
}

export interface FieldCapture {
  meta: CaptureMeta;
  arrays: Record<string, TA>;
}

// ------------------------------------------------------------------------------------------------ format
const MAGIC = 0x46504153; // 'FPAS'
const CTORS: Record<string, { new (buf: ArrayBuffer, off: number, len: number): TA; BYTES_PER_ELEMENT: number }> = {
  Float32Array, Float64Array, Int32Array, Uint8Array,
};

/** [u32 magic][u32 header bytes][header JSON][pad to 8][arrays, each 8-aligned] */
export function encodeCapture(c: FieldCapture): Uint8Array {
  const entries: { name: string; type: string; offset: number; length: number }[] = [];
  let off = 0;
  const names = Object.keys(c.arrays);
  for (const name of names) {
    const a = c.arrays[name];
    entries.push({ name, type: a.constructor.name, offset: off, length: a.length });
    off += Math.ceil(a.byteLength / 8) * 8;
  }
  const hb = new TextEncoder().encode(JSON.stringify({ meta: c.meta, entries }));
  const dataStart = Math.ceil((8 + hb.length) / 8) * 8;
  const out = new Uint8Array(dataStart + off);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, hb.length, true);
  out.set(hb, 8);
  for (let k = 0; k < names.length; k++) {
    const a = c.arrays[names[k]];
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), dataStart + entries[k].offset);
  }
  return out;
}

export function decodeCapture(bytes: Uint8Array): FieldCapture {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a field-pass capture');
  const hl = dv.getUint32(4, true);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))) as { meta: CaptureMeta; entries: { name: string; type: string; offset: number; length: number }[] };
  const dataStart = Math.ceil((8 + hl) / 8) * 8;
  const arrays: Record<string, TA> = {};
  for (const e of h.entries) {
    const Ctor = CTORS[e.type];
    const copy = bytes.slice(dataStart + e.offset, dataStart + e.offset + e.length * Ctor.BYTES_PER_ELEMENT);
    arrays[e.name] = new Ctor(copy.buffer, 0, e.length);
  }
  return { meta: h.meta, arrays };
}

/** the captured splatAdd calls (7 f64 per call: x, z, w, d, amount, R, target) */
export function splatsOf(cap: FieldCapture): OrigSplat[] {
  const a = cap.arrays['nimby.splats'] as Float64Array;
  const out: OrigSplat[] = [];
  for (let k = 0; k + 6 < a.length; k += 7) out.push({ x: a[k], z: a[k + 1], w: a[k + 2], d: a[k + 3], amount: a[k + 4], R: a[k + 5], target: a[k + 6] as 0 | 1 | 2 });
  return out;
}

// ------------------------------------------------------------------------------------------------ arms
export const CASES = ['nimby', 'nimbyNoCache', 'cells', 'airSat', 'noiseSat', 'water', 'soil', 'pass'] as const;
export type CaseName = (typeof CASES)[number];

export interface FieldArm {
  label: string;
  run(c: CaseName): void;
  /** the outputs of a case (compared bit for bit) */
  outputs(c: CaseName): Record<string, TA | number>;
  /** restore every array to the capture */
  reset(): void;
  stats?: FieldsBindStats;
  dispose(): void;
}

/** arrays of one arm: copies of the capture's arrays (plain, or allocated in wasm memory) */
type Alloc = <T extends TA>(a: T) => T;
const plainCopy: Alloc = (a) => a.slice() as typeof a;

interface ArmState {
  A: Record<string, TA>;
  reset(): void;
}

function armState(cap: FieldCapture, alloc: Alloc): ArmState {
  const A: Record<string, TA> = {};
  for (const [k, v] of Object.entries(cap.arrays)) A[k] = alloc(v);
  return {
    A,
    reset() {
      for (const [k, v] of Object.entries(cap.arrays)) (A[k] as Float32Array).set(v as Float32Array);
    },
  };
}

const f32 = (A: Record<string, TA>, k: string) => A[k] as Float32Array;
const u8 = (A: Record<string, TA>, k: string) => A[k] as Uint8Array;
const i32 = (A: Record<string, TA>, k: string) => A[k] as Int32Array;

function caseOutputs(A: Record<string, TA>, c: CaseName, extra: Record<string, number>): Record<string, TA | number> {
  switch (c) {
    case 'nimby': case 'nimbyNoCache': return { S: A['nimby.S'], P: A['nimby.P'], K: A['nimby.K'], touches: extra.touches };
    case 'cells': return { A0: A['cells.A0'], W0: A['cells.W0'], N0: A['cells.N0'], soilSrc: A['cells.soilSrc'], used: extra.used };
    case 'airSat': return { L: A['air.L'] };
    case 'noiseSat': return { L: A['noise.L'] };
    case 'water': return { L: A['water.L'], ground: A['water.ground'], tmp: A['water.tmp'], tmp2: A['water.tmp2'] };
    case 'soil': return { soil: A['soil.soil'] };
    case 'pass': return { ...caseOutputs(A, 'cells', extra), airL: A['air.L'], noiseL: A['noise.L'], ...caseOutputs(A, 'water', extra), soil: A['soil.soil'] };
  }
}

/** the original JS (nimby.ts / pollution.ts @24f8609, verbatim loops of tests/wasm/fieldPassesOriginal.ts) */
export function origArm(cap: FieldCapture): FieldArm {
  const s = armState(cap, plainCopy);
  const A = s.A, m = cap.meta;
  const nimby = makeOriginalNimby(falloff);
  const splats = splatsOf(cap);
  const extra = { touches: 0, used: 0 };
  const nIn: OrigNimbyInput = {
    N: m.N, splats, zone: u8(A, 'nimby.zone'), landfillFill: f32(A, 'nimby.fill'), network: u8(A, 'nimby.net'), netFlags: u8(A, 'nimby.flags'),
    lfA: m.nimby.lfA, lfR: m.nimby.lfR, NIMBY_LANDFILL_IDLE: m.nimby.idle, NIMBY_HIGHWAY: m.nimby.highway, NIMBY_HIGHWAY_BRIDGE: m.nimby.bridge,
    NIMBY_RAIL: m.nimby.rail, stigma: f32(A, 'nimby.S'), prestige: f32(A, 'nimby.P'), campus: f32(A, 'nimby.K'),
  };
  const cm = m.cells;
  const used = new Uint8Array(7);
  const cIn: OrigCellsInput = {
    C: m.N * m.N, traffic: f32(A, 'cells.traffic'), congestion: f32(A, 'cells.congestion'), network: u8(A, 'cells.network'), netFlags: u8(A, 'cells.netFlags'),
    building: i32(A, 'cells.building'), garbage: f32(A, 'cells.garbage'), soil: f32(A, 'cells.soil'), A0: f32(A, 'cells.A0'), W0: f32(A, 'cells.W0'),
    N0: f32(A, 'cells.N0'), soilSrc: f32(A, 'cells.soilSrc'), used, trafficAir: cm.trafficAir, tn: cm.tn, perTrip: cm.perTrip,
    base: Float32Array.from(cm.base), crossing: cm.crossing, smell: cm.smell, waterK: cm.waterK, SOIL_GROUNDWATER: cm.soilGW, TUNNEL_AIR: cm.tunnelAir,
    NOISE_CONG_DAMP: cm.congDamp, NOISE_PER_TRIP: cm.noisePerTrip, TUNNEL_NOISE: cm.tunnelNoise, BRIDGE_NOISE: cm.bridgeNoise,
    fr: cm.hasFreight ? i32(A, 'cells.freight') : null, freightS: cm.freightS, nReg: cm.nReg, regStart: cm.regStart, regCount: cm.regCount,
    regCap: cm.regCap, regUsed: cm.regUsed, lfOrder: i32(A, 'cells.lfOrder'), lfAir: cm.lfAir, lfWater: cm.lfWater, lfNoise: cm.lfNoise,
    LANDFILL_IDLE_EMIT: cm.LANDFILL_IDLE_EMIT, LANDFILL_SIZE_REF: cm.LANDFILL_SIZE_REF, SOIL_SRC_LANDFILL: cm.SOIL_SRC_LANDFILL,
  };
  const C = m.N * m.N;
  const run = (c: CaseName): void => {
    switch (c) {
      case 'nimby': case 'nimbyNoCache': extra.touches = nimby(nIn); break;
      case 'cells': {
        used.set(cm.used);
        origStageCells(cIn);
        extra.used = (used[0] ? 1 : 0) | (used[5] ? 2 : 0) | (used[3] ? 4 : 0);
        break;
      }
      case 'airSat': origSaturate(f32(A, 'air.field'), f32(A, 'air.L'), C, m.air.invK, m.air.alpha, null, f32(A, 'air.buf1'), m.air.k1); break;
      case 'noiseSat': origSaturate(f32(A, 'noise.field'), f32(A, 'noise.L'), C, m.noise.invK, m.noise.alpha, null, f32(A, 'noise.buf1'), m.noise.k1, f32(A, 'noise.buf2'), m.noise.k2); break;
      case 'water': origStageBAfterBlur({
        C, tmp: f32(A, 'water.tmp'), tmp2: f32(A, 'water.tmp2'), L: f32(A, 'water.L'), ground: f32(A, 'water.ground'), wm: u8(A, 'water.wm'),
        alpha: m.water.alpha, WATER_K: m.water.WATER_K, BANK_COUPLING: m.water.bankCoupling, nW: m.water.nW, waterCells: i32(A, 'water.cells'),
        waterNb: i32(A, 'water.nb'), bankCells: i32(A, 'water.bank'), bankSrc: i32(A, 'water.bankSrc'),
      }); break;
      case 'soil': origSoil(f32(A, 'soil.soil'), f32(A, 'soil.src'), C, m.soil.dt, m.soil.soilDecay, m.soil.SOIL_RATE, m.soil.SOIL_DECAY); break;
      case 'pass': for (const k of ['cells', 'airSat', 'noiseSat', 'water', 'soil'] as const) run(k); break;
    }
  };
  return { label: 'JS as-is', run, outputs: (c) => caseOutputs(A, c, extra), reset: () => s.reset(), dispose() {} };
}

/** an arm running FieldKernels (fair JS, or the wasm bindings) on arrays from `alloc` */
function kernelArm(cap: FieldCapture, label: string, k: FieldKernels, alloc: Alloc, stats?: FieldsBindStats, onDispose?: () => void): FieldArm {
  const s = armState(cap, alloc);
  const A = s.A, m = cap.meta, N = m.N, C = N * N;
  const tables = new NimbyTables(falloff);
  const src = new NimbySources(tables);
  const splats = splatsOf(cap);
  const ctx: NimbyCtx = {};
  const extra = { touches: 0, used: 0 };
  const lfTable = m.nimby.lfR > 0 ? tables.of(m.nimby.lfR, 2, 2) : null;
  const tabH = tables.of(m.nimby.highway.radius, 1, 1), tabR = tables.of(m.nimby.rail.radius, 1, 1);
  const nArgs = (force: boolean): NimbyArgs => ({
    N, src, zone: u8(A, 'nimby.zone'), fill: f32(A, 'nimby.fill'), lfCode: 10, lfTable, lfA: m.nimby.lfA, lfIdle: m.nimby.idle,
    net: u8(A, 'nimby.net'), flags: u8(A, 'nimby.flags'), highway: 5, rail: 6, tabH, tabR, aH: m.nimby.highway.amount, aHB: m.nimby.bridge,
    aR: m.nimby.rail.amount, force, S: f32(A, 'nimby.S'), P: f32(A, 'nimby.P'), K: f32(A, 'nimby.K'),
  });
  const argsCache = nArgs(false), argsForce = nArgs(true);
  const cm = m.cells;
  const regAdd = new Float64Array(Math.max(4, 4 * cm.nReg));
  for (let r = 0; r < cm.nReg; r++) {
    const n = cm.regCount[r];
    const use = cm.regCap[r] > 0 ? Math.min(1, cm.regUsed[r] / cm.regCap[r]) : 0;
    const act = cm.LANDFILL_IDLE_EMIT + (1 - cm.LANDFILL_IDLE_EMIT) * use;
    const mm = act / Math.sqrt(Math.max(1, n / cm.LANDFILL_SIZE_REF));
    regAdd[4 * r] = cm.lfAir * mm; regAdd[4 * r + 1] = cm.lfWater * mm; regAdd[4 * r + 2] = cm.lfNoise * mm; regAdd[4 * r + 3] = cm.SOIL_SRC_LANDFILL * act;
  }
  const cArgs: CellsArgs = {
    C, garbage: f32(A, 'cells.garbage'), building: i32(A, 'cells.building'), soil: f32(A, 'cells.soil'), network: u8(A, 'cells.network'),
    traffic: f32(A, 'cells.traffic'), congestion: f32(A, 'cells.congestion'), netFlags: u8(A, 'cells.netFlags'), A0: f32(A, 'cells.A0'),
    W0: f32(A, 'cells.W0'), N0: f32(A, 'cells.N0'), soilSrc: f32(A, 'cells.soilSrc'), freight: cm.hasFreight ? i32(A, 'cells.freight') : null,
    lfOrder: i32(A, 'cells.lfOrder'), nReg: cm.nReg, regStart: cm.regStart, regCount: cm.regCount, regAdd, smell: cm.smell, waterK: cm.waterK,
    soilGW: cm.soilGW, trafficAir: cm.trafficAir, tunnelAir: cm.tunnelAir, congDamp: cm.congDamp, crossing: cm.crossing, noisePerTrip: cm.noisePerTrip,
    tunnelNoise: cm.tunnelNoise, bridgeNoise: cm.bridgeNoise, tn: cm.tn, freightS: cm.freightS, perTrip: cm.perTrip, base: Float32Array.from(cm.base),
    highway: cm.highway, rail: cm.rail,
  };
  const wArgs: WaterArgs = {
    C, tmp: f32(A, 'water.tmp'), tmp2: f32(A, 'water.tmp2'), L: f32(A, 'water.L'), ground: f32(A, 'water.ground'), water: u8(A, 'water.wm'),
    waterCells: i32(A, 'water.cells'), nW: m.water.nW, waterNb: i32(A, 'water.nb'), bankCells: i32(A, 'water.bank'), bankSrc: i32(A, 'water.bankSrc'),
    invK: m.water.invK, alpha: m.water.alpha, bankCoupling: m.water.bankCoupling,
  };
  const used = new Uint8Array(7);
  const run = (c: CaseName): void => {
    switch (c) {
      case 'nimby': case 'nimbyNoCache': {
        // the walk's part that differs from the original: the source list (table resolution); then the kernels
        src.reset();
        let touches = 0;
        for (let q = 0; q < splats.length; q++) {
          const sp = splats[q];
          touches += src.add(sp.x, sp.z, sp.w, sp.d, sp.amount, sp.R, sp.target);
        }
        const r = k.nimby(ctx, c === 'nimby' ? argsCache : argsForce, PH_ALL);
        extra.touches = touches + r.lf * (lfTable ? lfTable.n : 0) + r.nh * tabH.n + r.nr * tabR.n;
        break;
      }
      case 'cells': {
        used.set(cm.used);
        const bits = k.cells(cArgs);
        if (bits & 1) used[0] = 1;
        if ((bits & 2) || cm.hasFreight) used[5] = 1;
        if (bits & 4) used[3] = 1;
        for (let r = 0; r < cm.nReg; r++) if (cm.regCount[r] > 0) { used[0] = 1; used[3] = 1; used[5] = 1; }
        extra.used = (used[0] ? 1 : 0) | (used[5] ? 2 : 0) | (used[3] ? 4 : 0);
        break;
      }
      case 'airSat': k.saturate(f32(A, 'air.field'), f32(A, 'air.L'), C, m.air.invK, m.air.alpha, null, f32(A, 'air.buf1'), m.air.k1); break;
      case 'noiseSat': k.saturate(f32(A, 'noise.field'), f32(A, 'noise.L'), C, m.noise.invK, m.noise.alpha, null, f32(A, 'noise.buf1'), m.noise.k1, f32(A, 'noise.buf2'), m.noise.k2); break;
      case 'water': k.water(wArgs); break;
      case 'soil': k.soil(f32(A, 'soil.soil'), f32(A, 'soil.src'), C, m.soil.grow, m.soil.keep); break;
      case 'pass': for (const kk of ['cells', 'airSat', 'noiseSat', 'water', 'soil'] as const) run(kk); break;
    }
  };
  return {
    label, run, stats, outputs: (c) => caseOutputs(A, c, extra),
    reset() {
      s.reset();
      // the corridor cache holds the raster of the (unchanged) captured network: keep it (a reset is not a new map)
    },
    dispose() {
      releaseNimbyCtx(ctx);
      onDispose?.();
    },
  };
}

export function fairArm(cap: FieldCapture): FieldArm {
  return kernelArm(cap, 'fair JS', fieldKernelsJs, plainCopy);
}

/** no JS fallback in a benchmark arm: a call outside the kernels' domain must fail loudly, never silently measure JS */
const NEVER: FieldKernels = {
  kind: 'never',
  nimby() { throw new Error('nimby fell back to JS'); },
  cells() { throw new Error('cells fell back to JS'); },
  saturate() { throw new Error('saturate fell back to JS'); },
  water() { throw new Error('water fell back to JS'); },
  soil() { throw new Error('soil fell back to JS'); },
};

/** wasm kernels of `w`; resident = the arrays live in w's memory (zero copy), else plain arrays staged per call */
export function wasmArm(cap: FieldCapture, w: FieldsWasm, label: string, resident: boolean): FieldArm {
  const blocks: TA[] = [];
  const alloc: Alloc = resident
    ? (a) => {
      const v = w.heap.allocArray(a.constructor as unknown as HeapArrayCtor<Float32Array>, a.length) as unknown as typeof a;
      (v as Float32Array).set(a as Float32Array);
      blocks.push(v);
      return v;
    }
    : plainCopy;
  const stats: FieldsBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
  const k = makeFieldKernels(NEVER, { wasm: w, stats, onError: (e) => { throw e; }, label });
  return kernelArm(cap, label, k, alloc, stats, () => { for (const b of blocks) w.heap.free(b); blocks.length = 0; });
}

/** an explicit kernel instance of a binary (scalar / SIMD builds) with its own memory + heap */
export function instantiate(mod: WebAssembly.Module, reserveBytes = 160 << 20): FieldsWasm {
  const inst = new WebAssembly.Instance(mod, simWasmImports());
  const ex = inst.exports as unknown as FieldsWasm['ex'] & { __heap_base: WebAssembly.Global };
  const heap = new WasmHeap(ex.memory, Number(ex.__heap_base.value));
  heap.reserve(reserveBytes);
  return { ex, heap };
}

// ------------------------------------------------------------------------------------------------ equivalence
function firstDiff(a: TA, b: TA): number {
  if (a.length !== b.length) return 0;
  const ua = a instanceof Float64Array ? new BigUint64Array(a.buffer, a.byteOffset, a.length) : a instanceof Uint8Array ? a : new Uint32Array(a.buffer, a.byteOffset, a.length);
  const ub = b instanceof Float64Array ? new BigUint64Array(b.buffer, b.byteOffset, b.length) : b instanceof Uint8Array ? b : new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return i;
  return -1;
}

/** '' when the outputs of case `c` are bit-identical */
export function diffOutputs(a: Record<string, TA | number>, b: Record<string, TA | number>): string {
  for (const k of Object.keys(a)) {
    const x = a[k], y = b[k];
    if (typeof x === 'number' || typeof y === 'number') {
      if (!Object.is(x, y)) return `${k}: ${String(x)} vs ${String(y)}`;
      continue;
    }
    const i = firstDiff(x, y);
    if (i >= 0) return `${k} differs at ${i}: ${x[i]} vs ${y[i]}`;
  }
  return '';
}

/**
 * bit-exactness of every arm against the first, per case: reset, run the case twice (the second nimby call hits the
 * corridor cache), compare after each run. Throws on the first difference.
 */
export function checkArms(arms: FieldArm[], cases: readonly CaseName[] = CASES): void {
  for (const c of cases) {
    for (const a of arms) a.reset();
    for (let rep = 0; rep < 2; rep++) {
      for (const a of arms) a.run(c);
      const ref = arms[0].outputs(c);
      for (let k = 1; k < arms.length; k++) {
        const d = diffOutputs(ref, arms[k].outputs(c));
        if (d) throw new Error(`${arms[k].label} vs ${arms[0].label}, case ${c} (run ${rep + 1}): ${d}`);
      }
    }
  }
  for (const a of arms) a.reset();
}
