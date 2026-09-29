/**
 * simWasm — loader and kernel switchboard for the Rust simulation kernels.
 *
 *   wasm/sim-kernels (Rust, no_std, raw C-ABI exports)  --npm run build:wasm-->  src/wasm/sim_kernels.wasm (committed)
 *
 * Headless-safe core: no DOM and no static node imports, so it runs in node (vitest, the balance bot, bundled or not),
 * browser main threads and Web Workers. Kernel bindings (src/wasm/kernels/*.ts) ask `kernel.instance()` per call and
 * run their JS original whenever it returns null, so the sim works identically without WebAssembly.
 *
 * Init paths
 *  - node: automatic and synchronous on the first kernel call (fs.readFileSync via process.getBuiltinModule +
 *    new WebAssembly.Module / Instance). File lookup: $SIM_WASM_PATH, ./sim_kernels.wasm next to this module,
 *    <cwd>/src/wasm/sim_kernels.wasm (bundled bots run from the repo root). Or call initSimWasmSync(bytes).
 *  - browser: `await initSimWasmBrowser()` from src/wasm/browser.ts (Vite ?url asset + instantiateStreaming, falling
 *    back to arrayBuffer() when the server sends a wrong MIME type). Until it resolves, kernels run in JS; results are
 *    bit-identical either way, so switching mid-game is safe.
 *
 * A/B switch: preference 'auto' (wasm when ready) | 'js' (force JS) | 'wasm' (force wasm: a kernel call throws if wasm
 * is unavailable — for A/B runs that must not silently measure JS). Global or per kernel. Sources: env SIM_WASM
 * (node), URL ?simwasm=… or localStorage 'metropolis.simwasm' (browser), setSimWasmPreference(). Syntax:
 * "js" | "wasm" | "auto" | "0" | "1", optionally followed by per-kernel entries: "auto,blur:js", "js,blur:wasm".
 */
import { WasmHeap, WasmHeapFullError } from './heap';

/** ABI version the bindings expect (wasm/sim-kernels/src/abi.rs ABI_VERSION) */
export const SIM_WASM_ABI = 1;
/** file name of the committed binary (src/wasm/) */
export const SIM_WASM_FILE = 'sim_kernels.wasm';
/** scratch bytes reserved at init: copy-mode staging for a 256² map never grows memory */
export const SIM_WASM_INITIAL_RESERVE = 4 << 20;

export type SimWasmPreference = 'auto' | 'js' | 'wasm';
export type SimWasmState = 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable';

/** exports every binary has (kernel exports are typed by their binding modules) */
export interface SimWasmCoreExports {
  memory: WebAssembly.Memory;
  __heap_base: WebAssembly.Global;
  sk_abi_version(): number;
  sk_features(): number;
}

export interface SimWasmFeatures {
  simd128: boolean;
  bulkMemory: boolean;
  nontrappingFptoint: boolean;
  signExt: boolean;
  atomics: boolean;
  /** linked with std (size experiment builds only) */
  std: boolean;
}

export interface SimWasmInstance {
  readonly exports: SimWasmCoreExports & Record<string, unknown>;
  readonly memory: WebAssembly.Memory;
  readonly heap: WasmHeap;
  readonly features: SimWasmFeatures;
  /** where the binary came from (path, URL or 'bytes' / 'module') */
  readonly source: string;
  /** binary size in bytes (0 when instantiated from a compiled Module) */
  readonly bytes: number;
  /** compile + instantiate time (ms) */
  readonly initMs: number;
}

export interface SimWasmStatus {
  state: SimWasmState;
  preference: SimWasmPreference;
  kernels: Record<string, { preference: SimWasmPreference; active: boolean; missing: string[]; heapFullCalls: number }>;
  error: string | null;
  source: string | null;
  bytes: number;
  initMs: number;
  features: SimWasmFeatures | null;
  heap: ReturnType<WasmHeap['stats']> | null;
}

// ---------------------------------------------------------------------------------------------- module state
let state: SimWasmState = 'idle';
let inst: SimWasmInstance | null = null;
let lastError: string | null = null;
let globalPref: SimWasmPreference = 'auto';
const kernelPrefs = new Map<string, SimWasmPreference>();
let prefsLoaded = false;
/** bumped whenever state / preferences change; KernelSlot caches its decision per version */
let version = 1;
const kernels = new Map<string, KernelSlot>();
let warned = false;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function bump(): void {
  version++;
}

// ---------------------------------------------------------------------------------------------- preferences
function asPref(v: string): SimWasmPreference | null {
  const s = v.trim().toLowerCase();
  if (s === 'js' || s === '0' || s === 'off' || s === 'false' || s === 'no') return 'js';
  if (s === 'wasm' || s === '1' || s === 'on' || s === 'true' || s === 'yes' || s === 'force') return 'wasm';
  if (s === 'auto' || s === '') return 'auto';
  return null;
}

/** parse "js" | "wasm" | "auto" | "0" | "1" [ "," kernel ":" pref ]* (unknown tokens are ignored) */
export function parseSimWasmFlag(value: string | null | undefined): { global: SimWasmPreference | null; kernels: Record<string, SimWasmPreference> } {
  const out: { global: SimWasmPreference | null; kernels: Record<string, SimWasmPreference> } = { global: null, kernels: {} };
  if (value == null) return out;
  for (const tok of String(value).split(/[,;\s]+/)) {
    if (!tok) continue;
    const c = tok.indexOf(':');
    if (c < 0) {
      const p = asPref(tok);
      if (p) out.global = p;
    } else {
      const p = asPref(tok.slice(c + 1));
      const name = tok.slice(0, c).trim();
      if (p && name) out.kernels[name] = p;
    }
  }
  return out;
}

/** apply a flag string (see parseSimWasmFlag) on top of the current preferences */
export function applySimWasmFlag(value: string | null | undefined): void {
  const f = parseSimWasmFlag(value);
  if (f.global) globalPref = f.global;
  for (const [k, p] of Object.entries(f.kernels)) kernelPrefs.set(k, p);
  prefsLoaded = true;
  bump();
}

/** initial preferences from the environment (env SIM_WASM, ?simwasm=, localStorage 'metropolis.simwasm') */
function loadPrefs(): void {
  if (prefsLoaded) return;
  prefsLoaded = true;
  const g = globalThis as { process?: { env?: Record<string, string | undefined> }; location?: { search?: string }; localStorage?: Storage };
  let flag: string | null = null;
  try {
    const env = g.process?.env?.SIM_WASM;
    if (env != null) flag = env;
  } catch { /* no env access */ }
  try {
    if (flag == null && g.localStorage) flag = g.localStorage.getItem('metropolis.simwasm');
  } catch { /* storage blocked */ }
  try {
    const search = g.location?.search;
    if (search && typeof URLSearchParams !== 'undefined') {
      const q = new URLSearchParams(search).get('simwasm');
      if (q != null) flag = q;
    }
  } catch { /* no location */ }
  if (flag != null) {
    const f = parseSimWasmFlag(flag);
    if (f.global) globalPref = f.global;
    for (const [k, p] of Object.entries(f.kernels)) kernelPrefs.set(k, p);
  }
}

/** set the preference globally (kernel omitted) or for one kernel ('auto' for a kernel = follow the global one) */
export function setSimWasmPreference(pref: SimWasmPreference, kernel?: string): void {
  loadPrefs();
  if (kernel) {
    if (pref === 'auto') kernelPrefs.delete(kernel);
    else kernelPrefs.set(kernel, pref);
  } else {
    globalPref = pref;
  }
  bump();
}

/** true when any kernel may use wasm (the global preference or some kernel override is not 'js') — worth initialising */
export function simWasmWanted(): boolean {
  loadPrefs();
  if (globalPref !== 'js') return true;
  for (const p of kernelPrefs.values()) if (p !== 'js') return true;
  return false;
}

/** effective preference of a kernel (or the global one) */
export function simWasmPreference(kernel?: string): SimWasmPreference {
  loadPrefs();
  if (kernel) {
    const p = kernelPrefs.get(kernel);
    if (p && p !== 'auto') return p;
  }
  return globalPref;
}

// ---------------------------------------------------------------------------------------------- instantiation
function featuresOf(bits: number): SimWasmFeatures {
  return {
    simd128: (bits & 1) !== 0,
    std: (bits & 2) !== 0,
    bulkMemory: (bits & 4) !== 0,
    nontrappingFptoint: (bits & 8) !== 0,
    signExt: (bits & 16) !== 0,
    atomics: (bits & 32) !== 0,
  };
}

function finish(instance: WebAssembly.Instance, source: string, bytes: number, t0: number): SimWasmInstance {
  const ex = instance.exports as unknown as SimWasmCoreExports & Record<string, unknown>;
  if (typeof ex.sk_abi_version !== 'function') throw new Error(`${source}: not a sim-kernels binary (no sk_abi_version export)`);
  const abi = ex.sk_abi_version();
  if (abi !== SIM_WASM_ABI) throw new Error(`${source}: ABI ${abi}, the bindings expect ${SIM_WASM_ABI} — rebuild with npm run build:wasm`);
  if (!(ex.memory instanceof WebAssembly.Memory)) throw new Error(`${source}: no exported memory`);
  const heapBase = Number((ex.__heap_base as WebAssembly.Global | undefined)?.value ?? 0);
  if (!(heapBase > 0)) throw new Error(`${source}: no __heap_base export`);
  const heap = new WasmHeap(ex.memory, heapBase);
  heap.reserve(SIM_WASM_INITIAL_RESERVE);
  return { exports: ex, memory: ex.memory, heap, features: featuresOf(ex.sk_features()), source, bytes, initMs: now() - t0 };
}

function adopt(i: SimWasmInstance): void {
  inst = i;
  state = 'ready';
  lastError = null;
  bump();
}

function fail(e: unknown, st: SimWasmState = 'failed'): void {
  inst = null;
  state = st;
  lastError = e instanceof Error ? e.message : String(e);
  bump();
}

type NodeProc = {
  versions?: { node?: string };
  env?: Record<string, string | undefined>;
  cwd?: () => string;
  getBuiltinModule?: (id: string) => unknown;
};
const WASM_REL = './' + SIM_WASM_FILE; // a variable, so Vite does not turn new URL(…, import.meta.url) into an asset

/** node only: read the binary from disk (null when not running in node; throws when no candidate file exists) */
function nodeReadWasm(): { bytes: Uint8Array; path: string; tried: string[] } | null {
  const proc = (globalThis as { process?: NodeProc }).process;
  if (!proc?.versions?.node || typeof proc.getBuiltinModule !== 'function') return null;
  const fs = proc.getBuiltinModule('node:fs') as typeof import('node:fs');
  const url = proc.getBuiltinModule('node:url') as typeof import('node:url');
  const path = proc.getBuiltinModule('node:path') as typeof import('node:path');
  const cands: string[] = [];
  const envPath = proc.env?.SIM_WASM_PATH;
  if (envPath) cands.push(envPath);
  try {
    const u = new URL(WASM_REL, import.meta.url);
    if (u.protocol === 'file:') cands.push(url.fileURLToPath(u));
  } catch { /* import.meta.url unavailable */ }
  if (proc.cwd) cands.push(path.resolve(proc.cwd(), 'src', 'wasm', SIM_WASM_FILE));
  for (const c of cands) {
    try {
      return { bytes: fs.readFileSync(c), path: c, tried: cands };
    } catch { /* try the next one */ }
  }
  throw new Error(`${SIM_WASM_FILE} not found (tried ${cands.join(', ')})`);
}

/**
 * Synchronous init: from bytes / a compiled Module, or (no argument, node only) from the file on disk.
 * Returns true when the kernels are ready. Never throws (the failure is kept in simWasmStatus().error).
 */
export function initSimWasmSync(source?: BufferSource | WebAssembly.Module): boolean {
  if (state === 'ready' && source === undefined) return true;
  if (typeof WebAssembly === 'undefined') {
    fail('WebAssembly is not available', 'unavailable');
    return false;
  }
  const t0 = now();
  try {
    if (source instanceof WebAssembly.Module) {
      adopt(finish(new WebAssembly.Instance(source, {}), 'module', 0, t0));
    } else if (source !== undefined) {
      const mod = new WebAssembly.Module(source);
      adopt(finish(new WebAssembly.Instance(mod, {}), 'bytes', source.byteLength, t0));
    } else {
      const f = nodeReadWasm();
      if (!f) {
        // not node: the browser needs the async path (initSimWasmBrowser)
        return false;
      }
      const mod = new WebAssembly.Module(f.bytes as Uint8Array<ArrayBuffer>);
      adopt(finish(new WebAssembly.Instance(mod, {}), f.path, f.bytes.byteLength, t0));
    }
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

async function instantiateUrl(url: string | URL, t0: number): Promise<SimWasmInstance> {
  const label = String(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${label}: HTTP ${res.status}`);
  return instantiateResponse(res, label, t0, url);
}

async function instantiateResponse(res: Response, label: string, t0: number, refetch?: string | URL): Promise<SimWasmInstance> {
  const type = res.headers.get('content-type') ?? '';
  const size = Number(res.headers.get('content-length') ?? 0);
  if (typeof WebAssembly.instantiateStreaming === 'function' && type.toLowerCase().startsWith('application/wasm')) {
    try {
      const r = await WebAssembly.instantiateStreaming(res, {});
      return finish(r.instance, label, size, t0);
    } catch (e) {
      // streaming compile failed after the body was consumed: fetch again and use the buffered path
      if (!refetch) throw e;
      const again = await fetch(refetch);
      const bytes = await again.arrayBuffer();
      const r = await WebAssembly.instantiate(bytes, {});
      return finish(r.instance, label, bytes.byteLength, t0);
    }
  }
  // wrong / missing MIME type (static hosts serving application/octet-stream): buffered compile
  const bytes = await res.arrayBuffer();
  const r = await WebAssembly.instantiate(bytes, {});
  return finish(r.instance, label, bytes.byteLength, t0);
}

let pending: Promise<boolean> | null = null;

/**
 * Async init from a URL, a Response (or a promise of one), bytes or a compiled Module; no argument = node file.
 * Resolves true when ready; never rejects (the failure is kept in simWasmStatus().error and kernels run in JS).
 */
export function initSimWasm(source?: string | URL | Response | PromiseLike<Response> | BufferSource | WebAssembly.Module): Promise<boolean> {
  if (state === 'ready' && source === undefined) return Promise.resolve(true);
  if (typeof WebAssembly === 'undefined') {
    fail('WebAssembly is not available', 'unavailable');
    return Promise.resolve(false);
  }
  if (source === undefined || source instanceof WebAssembly.Module || ArrayBuffer.isView(source) || source instanceof ArrayBuffer) {
    return Promise.resolve(initSimWasmSync(source as BufferSource | WebAssembly.Module | undefined));
  }
  if (pending) return pending;
  state = 'loading';
  bump();
  const t0 = now();
  const run = async (): Promise<boolean> => {
    try {
      let i: SimWasmInstance;
      if (typeof source === 'string' || source instanceof URL) i = await instantiateUrl(source, t0);
      else {
        const res = await (source as PromiseLike<Response> | Response);
        i = await instantiateResponse(res, res.url || 'response', t0, res.url || undefined);
      }
      adopt(i);
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      pending = null;
    }
  };
  pending = run();
  return pending;
}

/** true when the kernels are instantiated (independent of the preference) */
export function isSimWasmReady(): boolean {
  return state === 'ready';
}

/** the instance if ready (auto-initialises in node), regardless of preferences; null otherwise */
export function simWasmInstance(): SimWasmInstance | null {
  if (state === 'idle') initSimWasmSync();
  return inst;
}

/**
 * Called by a binding when a wasm call failed (trap, WasmHeapFullError, ...). WasmHeapFullError only makes that call
 * use JS; anything else disables wasm for the session (logged once). In forced 'wasm' mode the error is rethrown.
 * Returns normally when the caller should run the JS kernel instead.
 */
export function simWasmCallFailed(kernel: string, e: unknown): void {
  if (e instanceof WasmHeapFullError) {
    if (simWasmPreference(kernel) === 'wasm') throw e;
    const k = kernels.get(kernel);
    if (k && k.heapFullCalls++ === 0) {
      console.warn(`[simWasm] ${kernel}: wasm heap full while views are pinned, running JS for these calls — reserve() more memory at a safe point`, e.message);
    }
    return;
  }
  if (simWasmPreference(kernel) === 'wasm') throw e;
  fail(`kernel ${kernel} failed: ${e instanceof Error ? e.message : String(e)}`);
  if (!warned) {
    warned = true;
    console.error(`[simWasm] ${kernel} failed; WebAssembly kernels disabled for this session, using JS`, e);
  }
}

/** drop the instance (tests / A/B harness); the next kernel call in node re-initialises automatically */
export function resetSimWasm(): void {
  inst = null;
  state = 'idle';
  lastError = null;
  pending = null;
  bump();
}

// ---------------------------------------------------------------------------------------------- kernel slots
/**
 * A kernel family's view of the switchboard (one per binding module, e.g. 'blur'). instance() is the per-call fast
 * path: null = run JS. Throws only in forced 'wasm' mode when wasm is unavailable.
 */
export class KernelSlot {
  readonly name: string;
  readonly required: readonly string[];
  private v = 0;
  private cached: SimWasmInstance | null = null;
  missing: string[] = [];
  /** calls that ran JS because the heap could not grow (pinned views; see heap.ts) */
  heapFullCalls = 0;
  private warnedMissing = false;

  constructor(name: string, required: readonly string[]) {
    this.name = name;
    this.required = required;
  }

  instance(): SimWasmInstance | null {
    if (this.v === version) return this.cached;
    return this.recompute();
  }

  private recompute(): SimWasmInstance | null {
    const pref = simWasmPreference(this.name);
    let w: SimWasmInstance | null = null;
    if (pref !== 'js') {
      if (state === 'idle') initSimWasmSync();
      w = inst;
      if (w) {
        this.missing = this.required.filter((n) => typeof w!.exports[n] !== 'function');
        if (this.missing.length > 0) {
          if (!this.warnedMissing) {
            this.warnedMissing = true;
            console.warn(`[simWasm] kernel '${this.name}' uses JS: the binary lacks ${this.missing.join(', ')} (stale binary? npm run build:wasm)`);
          }
          w = null;
        }
      }
      if (!w && pref === 'wasm') {
        const why = this.missing.length > 0 ? `missing exports ${this.missing.join(', ')} (stale binary? npm run build:wasm)` : lastError ?? state;
        throw new Error(`[simWasm] kernel '${this.name}' forced to wasm but unavailable: ${why}`);
      }
    }
    // state may have changed inside initSimWasmSync (bumping the version): cache against the current one
    this.cached = w;
    this.v = version;
    return w;
  }
}

/** register (or get) the slot of a kernel family; `required` = the exports its bindings call */
export function kernelSlot(name: string, required: readonly string[]): KernelSlot {
  let k = kernels.get(name);
  if (!k) kernels.set(name, (k = new KernelSlot(name, required)));
  return k;
}

export function simWasmStatus(): SimWasmStatus {
  loadPrefs();
  const ks: SimWasmStatus['kernels'] = {};
  for (const [name, k] of kernels) {
    let active = false;
    try {
      active = k.instance() !== null;
    } catch { /* forced but unavailable */ }
    ks[name] = { preference: simWasmPreference(name), active, missing: k.missing.slice(), heapFullCalls: k.heapFullCalls };
  }
  return {
    state,
    preference: globalPref,
    kernels: ks,
    error: lastError,
    source: inst?.source ?? null,
    bytes: inst?.bytes ?? 0,
    initMs: inst?.initMs ?? 0,
    features: inst?.features ?? null,
    heap: inst ? inst.heap.stats() : null,
  };
}

export { WasmHeap, WasmHeapFullError };
