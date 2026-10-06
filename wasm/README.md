# Simulation kernels in WebAssembly (Rust → wasm32)

CPU-heavy simulation kernels can run as Rust compiled to WebAssembly, with the JS original as an automatic fallback.
Results are **bit-identical** to the JS originals, so a game can switch between the two at any moment (A/B runs,
missing WebAssembly, a failed init) without changing the simulation.
First kernel ported: the blur module (`src/sim/infra/blur.ts` → `wasm/sim-kernels/src/blur.rs`).

## Layout

```
wasm/sim-kernels/            Rust crate (cdylib, #![no_std], no external crates, no wasm-bindgen)
  Cargo.toml                 release profile: opt-level 3, lto, codegen-units 1, panic abort, strip
  src/lib.rs                 panic handler (traps), module list, porting rules
  src/abi.rs                 ABI_VERSION, sk_abi_version / sk_features / sk_initial_memory, pointer -> slice helpers
  src/build.rs               cargo build script (Cargo.toml `build`): PRE-SIZES the linear memory (64 MiB, see below)
  src/math.rs                exact JS Math equivalents for no_std (floor), with host tests
  src/probe.rs               tiny exports for the memory-model benchmark
  src/blur.rs                port of src/sim/infra/blur.ts (+ host unit tests of the restructured loops)
tools/build-wasm.mjs         npm run build:wasm (cargo build -> src/wasm/sim_kernels.wasm + manifest)
src/wasm/                    runtime (headless-safe: no DOM, no static node imports)
  sim_kernels.wasm           COMMITTED binary (players / CI without Rust use it as is)
  sim_kernels.manifest.json  sha256, source hash, sizes, exports, rustc version of the committed binary
  simWasm.ts                 loader: init paths, A/B preferences, kernel slots, status, failure handling
  heap.ts                    WasmHeap: JS-side allocator over linear memory, views, growth policy, scratch slots
  bind.ts                    staging helpers for bindings (zero-copy vs copy-in / copy-out)
  layers.ts                  adoptLayers(): prototype of "CityState layers live in wasm memory"
  browser.ts                 initSimWasmBrowser(): Vite ?url asset + instantiateStreaming
  kernels/blurBind.ts        makeBlurKernels(js): wasm bindings around a JS implementation
  kernels/blur.ts            drop-in replacement for src/sim/infra/blur.ts (bound to the live JS)
  index.ts                   public entry
tests/wasm/                  blur.test.ts (bit-exactness, zero copy, growth, fallbacks), blurSim.test.ts (the real
                             sim with the wasm blur: per-call shadow check + bit-identical cities), heap.test.ts
                             (allocator), binary.test.ts (committed binary = manifest = current Rust sources)
tools/bench/                 ab.ts (A/B harness), node.ts, run.mjs (bundle + run), blur / memory / sim benchmarks,
                             browser-check.mjs + wasm-check.html (dev server, production build, worker, MIME, COI)
```

## Build

```
npm run build:wasm                       # rebuild + install src/wasm/sim_kernels.wasm and the manifest
node tools/build-wasm.mjs --all          # all variants + size table (simd, scalar, mvp, std, names)
node tools/build-wasm.mjs --check        # rebuild in a temp dir, must be byte-identical to the committed binary
node tools/build-wasm.mjs --if-available # exit 0 without cargo (CI)
cd wasm/sim-kernels && cargo test        # host unit tests (floor exactness, restructured loops)
```

Needs `rustup target add wasm32-unknown-unknown` (Rust 1.94.1 used). Commit `src/wasm/sim_kernels.wasm` and
`src/wasm/sim_kernels.manifest.json` with the Rust change: `tests/wasm/binary.test.ts` fails when the Rust sources no
longer match the manifest. Builds are reproducible (`--check`), and paths are remapped out of the binary.

**Shipped variant: one binary, SIMD.** It targets rustc's default wasm32 CPU (LLVM 21: bulk-memory,
nontrapping-fptoint, sign-ext, mutable-globals, multivalue and reference-types) plus `+simd128`. Chrome 91+,
Firefox 89+, Safari 16.4+ and Node 16.4+ all run it. On an engine without SIMD, compilation fails and every kernel
falls back to JS. No second binary is shipped because the gain over scalar is small (see below). `relaxed-simd` is
never enabled, because its results are implementation-defined.

Sizes (bytes, brotli in brackets): simd 23 832 (8 063), scalar 21 806 (7 365), mvp 23 000 (7 620), std instead of
no_std 34 238 (12 022). `#![no_std]` saves 30 %. About 5 KB is core's panic-message formatting, which bounds checks
pull in. The panic handler itself only traps. That cost is paid once, not per kernel.

## Runtime API (`src/wasm`)

- **node** (vitest, the balance bot, bundled or not): nothing to call. The first kernel call reads
  `src/wasm/sim_kernels.wasm` synchronously through `process.getBuiltinModule('node:fs')`, so there is no static node
  import and the core stays bundle-safe. Lookup order: `$SIM_WASM_PATH`, next to the module, then
  `<cwd>/src/wasm/sim_kernels.wasm` (for bundled bots run from the repo root). `initSimWasmSync(bytes | Module)` and
  `await initSimWasm(url | Response | bytes)` are also available.
- **browser** (main thread or Web Worker): `await initSimWasmBrowser()` from `src/wasm/browser.ts`. It resolves the
  Vite `?url` asset (hashed under `assets/` in production), streams it when the server sends `application/wasm`, and
  otherwise falls back to `arrayBuffer()`. Until it resolves, kernels run in JS. Synchronous compile on the main
  thread also works in Chrome 141 for this module size (0.3 ms).
- **A/B switch**: `'auto'` (wasm when ready), `'js'`, or `'wasm'` (forced: a kernel call throws if wasm is
  unavailable, so an A/B run can never silently measure JS). It can be set globally or per kernel. Sources, in order:
  env `SIM_WASM` (node), then localStorage `metropolis.simwasm`, then URL `?simwasm=`, then
  `setSimWasmPreference()`. Syntax: `js | wasm | auto | 0 | 1`, optionally followed by `,kernel:pref` (for example
  `?simwasm=auto,blur:js`).
- **Imports**: the binary imports the engine's own `Math.exp` / `Math.log` as `env.js_exp` / `env.js_log` (the traffic
  core's logit mode split, shopping decay and price updates call them), so kernels and JS compute identical values on
  every engine by construction — V8, SpiderMonkey and JavaScriptCore each use their own libm. Every instantiation must
  pass `simWasmImports()` (the loader, tests and benchmarks do): `new WebAssembly.Instance(mod, {})` fails with
  "Import #0 module="env"". V8 calls an imported Math builtin directly; measured cost-neutral against an inline fdlibm
  port (traffic cycle 0.99× [0.97, 1.02], tools/bench/trafficCore.bench.mjs insitu, arm `wasm-fdlibm`).
- **Failures**:
  - A missing WebAssembly, a broken or stale binary (ABI or export check), or a trap disables wasm for the session
    and logs once. Calls then use JS.
  - A trap can come after a kernel already wrote state. Running the JS kernel on that state would silently diverge, so
    a binding must recover exactly or discard the work. The traffic core (`src/wasm/kernels/trafficBind.ts`) reruns
    kernels whose outputs depend only on inputs they do not write, restores a snapshot of the few read-modify-write
    arrays of the others (volNew, sLoad, the traffic layer: tens of µs per cycle), and aborts the cycle for roundMatch
    / commute (`TrafficCycleAbortError`; the driver restarts it from prep, in JS). A trapped core never uses wasm again.
  - `WasmHeapFullError` only makes that one call use JS. It is counted in `simWasmStatus().kernels[k].heapFullCalls`.
  - Unusual arguments always go to JS: non-integer sizes, arrays that are too short, or overlapping arrays.
  - `simWasmStatus()` reports the state, source, size, init time, features, heap stats, and per-kernel activity.

## Memory model

- Rust has **no allocator**. Kernels are pure functions over caller-provided memory: pointers (byte offsets), sizes
  and scalars. They never allocate and never grow memory, so JS views stay valid across calls. Scratch space such as
  boxV's column sums or the upsample tables is passed in.
- `WasmHeap` (JS) manages linear memory above `__heap_base` (≈1.0 MiB: the 1 MiB Rust shadow stack plus data). It
  uses first-fit with coalescing and 16-byte alignment. The API:
  - `alloc` / `free`
  - `allocArray(Ctor, n)`: typed-array views that live in wasm memory
  - `scratch(slot, bytes)`: cached per-binding staging blocks
  - `F32` / `F64` / `I32` / `U8`: whole-memory views, refreshed after growth
  - `ptrOf(view)`
  - `refresh(view)`, `onGrow(cb)`
  - `reserve(bytes)`
- **Growth detaches every view** of the old buffer (length 0, reads `undefined`, writes dropped). The rule:
  - Memory grows only through `reserve()` at a safe point (city creation or load), followed by `refresh()` of views.
  - Or it grows implicitly for scratch, but only while no `allocArray` view exists.
  - Once views are pinned, an allocation that needs growth throws `WasmHeapFullError` instead of silently detaching
    them. Bindings then run JS for that call.
  - Local aliases such as `const L = st.crime` cannot be fixed after growth, so memory must not grow while systems
    run.
  - At init, 4 MiB of scratch is reserved, so the copy-mode staging for a 256² map never grows memory.
- **Pre-sized memory: never grow after startup.** Every `memory.grow` DETACHES the old ArrayBuffer, and the first
  detach in a V8 isolate permanently invalidates V8's ArrayBuffer-detaching protector: from then on every typed-array
  access in that isolate — the JS sim included — carries a detach check. Measured on the original JS sim, dense1m: the
  services pass 1.19–1.25× slower, the whole simulation 1.07–1.16× slower (independent A/B of the services port).
  So the binary is linked with `--initial-memory` = 64 MiB (`src/build.rs`, exported as `sk_initial_memory()`; the
  manifest shows `initialPages: 1024`), which holds the loader's 4 MiB reserve, the services engine at 1M population
  (31 MiB on dense1m, 21 MiB on bot256) and the adopted CityState layers (12.3 MiB) with room to spare — a 256² city
  (the largest region tile) never grows memory. Untouched pages cost no physical memory. If more kernels move their
  state into wasm memory, raise the constant instead of calling `reserve()` later. Other detach sources in the same
  isolate count too: a `postMessage` transfer list (the game's main thread: `lodBuilder.ts:82`), and in NODE the web
  streams of undici (`Blob.stream()`, `DecompressionStream`, `Response.arrayBuffer()` — e.g. `unpackFile`); Chromium's
  streams do not detach (verified). Benchmarks: one isolate per arm, fixtures gunzipped with zlib in node.
- **Kernel state has an owner and a lifetime.** A binding that allocates per-city state (the services engine: cell
  scratch, staging buffers, reach pools) frees it when the city goes away: `installServicesTierEngine(...).dispose()`
  (or `disposeServicesTierEngine(system)`) on scene dispose / city unload; a `FinalizationRegistry` frees an engine
  whose system was garbage-collected without it (a safety net: GC timing is unbounded). Freed blocks return to the
  heap's free list; linear memory never shrinks, but the next city reuses them.
- **Per argument, a binding either passes the array's own offset** (it lives in wasm memory: zero copy) or stages it:
  inputs are copied into a scratch block before the call and outputs copied back after. Mixed calls are fine.
- **CityState layers in wasm memory**: `adoptLayers(st, heap)` moves every typed-array field of an existing object
  into the heap. That covers 56 arrays and 12.3 MiB for a 256² CityState, done in about 18 ms with no edits to
  CityState. It keeps a growth listener that re-points the fields, and `release()` undoes it. The existing JS systems
  keep running on the adopted layers unchanged. A real integration needs these things:
  1. allocate the layers through the heap in the constructor, after one `reserve()` for the whole city;
  2. `release()` them on unload or `replaceState`;
  3. no memory growth while the sim runs (size the reserve to include systems' arrays);
  4. never `structuredClone` or `postMessage` a live view. `serializeCity(st)` without `copy` is such a case: it
     clones the whole wasm memory buffer (measured: 21 MiB for a 12 MiB city). `serializeCity({copy:true})` slices
     and is safe. `deserializeCity` `.set()`s into the fresh state's arrays, and the bundle and recovery code honour
     `byteOffset` / `byteLength`. The round trip was verified bit-identical on adopted layers.
- **Sizing (256²)**: CityState is 12.3 MiB (56 arrays). The systems' own typed arrays on the grown stress city add
  about 25 MiB (363 arrays). If everything lived in wasm memory, that is about 40 MiB plus scratch: the pre-sized
  64 MiB. Growing costs 0.05 ms of time but the protector (above). wasm32 allows up to 4 GiB.
- **SharedArrayBuffer and threads** need cross-origin isolation (headers `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`).
  - Vite supports them through `server.headers` and `preview.headers` (see `tools/bench/vite.check.config.ts`,
    `COI=1`). This was verified: page and worker are `crossOriginIsolated`.
  - GitHub Pages cannot set headers. Use a COI service worker (for example `coi-serviceworker`, which reloads once on
    the first visit) or a host with header config (Netlify or Cloudflare `_headers`).
  - `require-corp` also blocks cross-origin subresources without CORP/CORS. The UI imports Google Fonts, so check it,
    self-host the font, or use `COEP: credentialless` (Chromium and Firefox only).
  - A shared-memory build links on stable Rust with `+atomics,+bulk-memory` and the linker flags `--shared-memory
    --import-memory --max-memory=N --export=__stack_pointer --no-check-features`. The last flag is needed because
    the precompiled `core` lacks the atomics flag. It then ran boxH row bands on 4 node workers over a shared memory,
    bit-identical. The speedup could not be measured on the loaded 4-core machine. Each worker instance needs its own
    `__stack_pointer`. Kernels must stay re-entrant (no statics), which is already a porting rule.

## Porting a kernel

1. **Rust**: add `src/<module>.rs` with safe-slice functions plus `#[unsafe(no_mangle)] pub unsafe extern "C" fn
   <module>_<fn>(ptr…, n: i32, …)` exports. Add the module to `lib.rs`. Take scratch as parameters, and use no
   statics and no allocation. Bump `ABI_VERSION` if an existing export changes.
2. **Binding**: add `src/wasm/kernels/<module>Bind.ts` with `export function make<Module>Kernels(js: Api): Api`.
   - Register `kernelSlot('<module>', [required exports])`. Get the instance per call from `slot.instance()`; `null`
     means run JS.
   - Validate the domain (integer sizes, lengths, `overlaps()`), otherwise run JS.
   - `stageF32` the inputs, call the export, `unstageF32` the outputs. Wrap the call in try / catch →
     `simWasmCallFailed()` → JS.
   - Then add `src/wasm/kernels/<module>.ts` that binds the live JS module.
   - Keep the bind file free of imports of the JS module. That way `vi.mock` or a bundler plugin can swap it into the
     sim without an import cycle.
3. **Equivalence test**: create `tests/wasm/<module>.test.ts`.
   - Cover random fields (noise, sparse, ±0, subnormals, 1e±30, NaN / Infinity parameters), edge sizes (1, 2, odd,
     N not divisible by factors), real layers from `stressCity(256)` after some days, and zero-copy arrays.
   - Compare as **uint32 bit patterns** (NaN == NaN).
   - Add a `blurSim.test.ts`-style shadow test: mock the JS module, run the real systems, compare every call.
   - Add a JS-vs-wasm whole-city comparison after a JS-vs-JS baseline.
4. **Benchmark**: add `tools/bench/<module>.bench.ts` (`npm run bench:wasm -- <module>`).
   - Use `runAB()`. It warms up both sides, interleaves A and B with alternating order, uses ≥ 30 reps, measures CPU
     time, and reports median, min and a 95 % bootstrap CI of the paired ratio.
   - Check bit-exactness before timing.
   - Include the copy (staged) and zero-copy cases.
   - Include a restructured-JS control, so the gain is shown to come from wasm and not only from the new loop
     structure.
   - Add a system-level A/B with a `<module>.plugins.mjs` redirect (see `sim.plugins.mjs`).
   - Browser numbers: `node tools/bench/browser-check.mjs prod --ab [--coi]`.
5. `npm run build:wasm`, run `npx vitest run tests/wasm`, then commit the binary and manifest.

## Float / determinism rules (bit-exact with JS)

- JS numbers are f64. `Float32Array` stores round to nearest-even (`as f32`), and reads are exact promotions. So
  **compute in f64 in the JS evaluation order and round exactly where JS stores**, for example
  `(s * inv) as f32`, `acc[i] = (acc[i] as f64 + v) as f32`, and Float32 lookup tables stored as f32.
- A single `+ - * /` of two f32 values stored to f32 may be done in f32: the f64-then-f32 double rounding is
  innocuous, since 53 ≥ 2·24 + 2. Anything longer must be done in f64.
- No FMA (`mul_add`), no reassociation or reordering of accumulations, no `relaxed-simd`, and no fast-math. LLVM
  contracts nothing by default.
- Restructuring is allowed only when every value sees the same sequence of operations. Examples: splitting loops at
  branch boundaries, fusing per-element passes, interleaving independent rows, and vectorising across independent
  lanes. f64x2 lanes are IEEE per lane.
- Match JS integer semantics explicitly:
  - `| 0` / `>>` / ToInt32 wrap, while Rust `as` saturates. NaN → 0 is the same in both.
  - `Math.floor`: core has no `floor`, so use `math::floor` (musl, exact for ±0, NaN and ±inf).
  - Clamp huge or NaN offsets before converting to integers (`math::clamp_offset`).
- NaN payloads may differ between engines. Compare NaN as NaN, and never branch on NaN bit patterns.
- Keep sim randomness out of kernels (pass values in), so the RNG sequence stays in JS.

## Measured (blur; 256² unless noted)

Node 22.22 / V8 12.4, CPU time (`process.cpuUsage` from an otherwise idle worker thread), A/B interleaved with
alternating order, n = 41 pairs, 95 % bootstrap CI of the paired ratio, load average 29–55 on 4 cores
(`npm run bench:wasm -- blur`). "copy" = plain arrays staged through wasm memory (transfer cost included),
"zero-copy" = arrays allocated in wasm memory.

| case | JS | wasm | speedup [95 % CI] |
|---|---|---|---|
| crime `blur3 r=1`, copy | 3.78 ms | 0.80 ms | 4.66× [4.49, 4.87] |
| crime `blur3 r=1`, zero-copy | 3.96 ms | 0.73 ms | 5.34× [5.25, 5.51] |
| control: JS restructured like the Rust code | 3.96 ms | 2.14 ms (JS) | 1.81× [1.78, 1.86] |
| wasm zero-copy vs the restructured JS | 2.14 ms | 0.73 ms | 2.95× [2.85, 3.00] |
| `boxAverage r=2` (tree cover), copy / zero-copy | 1.26 ms | 0.32 / 0.27 ms | 3.93× / 4.98× |
| `blurDown` f=2 r=1 / f=4 r=2, copy | 1.11 / 0.38 ms | 0.34 / 0.18 ms | 3.20× / 2.20× |
| `upsampleAdd` f=2 with plume shift, copy / zero-copy | 0.78 ms | 0.33 / 0.30 ms | 2.36× / 2.67× |
| `blurDownAdd` f=4 r=2, copy | 1.06 ms | 0.47 ms | 2.30× |
| one pollution + crime pass (13 calls), copy | 15.9 ms | 5.78 ms | 2.77× [2.69, 2.86] |
| one pollution + crime pass, zero-copy | 16.0 ms | 5.28 ms | 3.04× [2.98, 3.09] |
| `blur3 r=2` 512² / 1024², copy | 15.0 / 63.7 ms | 3.36 / 14.7 ms | 4.42× / 4.50× |
| binary: scalar → SIMD | 0.79 ms | 0.69 ms | 1.14× [1.12, 1.17] |
| binary: MVP → generic features | | | 1.00× [0.99, 1.01] |
| boxH 1-row → 4-row interleave | 0.176 ms | 0.142 ms | 1.25× [1.24, 1.27] |
| hand-written simd128 boxV vs LLVM auto-vectorised | | | 0.80× (reverted — measure, never assume) |

- **Browser.** Measured in headless Chrome 141 on the production build, in both the main thread and a worker. The
  clock is the wall clock, so best-of samples are used under load. `blur3`: 2.37 → 0.57 ms (≈4.2×). Pollution chain:
  2.68 → 1.1–1.3 ms (≈2.1–2.4×).
- **Memory model** (`npm run bench:wasm -- memory`):
  - An empty JS → wasm call costs 0.5 ns, and a 5-argument call 20 ns. The binding checks and staging cost ≈ 0.37 µs
    per call.
  - Copying a 256² Float32 layer takes 13.8 µs in and 12.1 µs out.
  - A one-pass kernel (`dst = src·k`) is 5.4× faster than JS in place, but only 3.5× with copies: the copies are a
    third of the wasm time. For `blur3`, copy vs in place is 1.05× [1.00, 1.09].
  - The `memory.buffer` getter costs 35 ns, a new view 72 ns, and `memory.grow` (+16 MiB) 0.04 ms.
- **Whole simulation** (`npm run bench:wasm -- sim`; stress city, all systems, interleaved 12-day chunks):
  - Blur is 0.96 ms per day in JS, 4 % of the 23.7 ms day. The wasm kernels bring it to 0.30 ms.
  - The day total does not change measurably: 1.007× [0.85, 1.32].
  - The cities are bit-identical after 132 days.
  - Self-time profile over 72 days: traffic.ts 20 %, pollution.ts 16 % (stageB and step, not the blur),
    population.ts 12 %, justice.ts 11 %, roadSearch 8 %, GC 6 %, utilities 5 %, fire 3 %. blur.ts is 0.8 %.
- **Conclusion.** Blur only proves the pipeline. Million-population cities need the hot systems ported as whole
  kernels (traffic assignment, road search, pollution stages, population / justice loops), with their layers in wasm
  memory, and the sim moved off the main thread into a Web Worker.

## Measured (services tier engine, `catch.rs`; dense1m = 1.12M people, 256²)

`npm run bench:services -- all --fixture <dir>/dense1m_s7.metropolis` (tools/bench/servicesTierEngine.bench.mjs): one
isolate per arm (node child process / Chromium worker), CPU time in node, 31 interleaved rotated rounds, paired-ratio
median with a 95 % bootstrap CI, every arm's city hash identical after each case. "fair JS" = the restructured JS
engine (src/wasm/js/servicesTierEngine.ts) on the same data layout; the wasm arm stages layers (copies included);
"resident" adopts the CityState layers into wasm memory. Protector INTACT on both sides unless noted (load 8–18).

| in situ, design cadence (31 × 6 days) | sim ms/day | services ms/day | tier engine ms/day |
|---|---|---|---|
| node: orig JS → wasm | 61.9 → 57.1, 1.06× [1.04, 1.14] | 20.9 → 15.4, 1.35× [1.25, 1.42] | 16.8 → 11.5, 1.42× [1.36, 1.53] |
| node: fair JS → wasm | 62.9 → 57.1, 1.06× [1.00, 1.15] | 20.4 → 15.4, 1.21× [1.17, 1.28] | 14.5 → 11.5, 1.26× [1.20, 1.37] |
| node: fair JS → resident | 62.9 → 53.5, 1.11× [1.05, 1.17] | 20.4 → 14.0, 1.23× [1.18, 1.41] | 14.5 → 10.5, 1.40× [1.25, 1.47] |
| Chromium 141 worker: orig → wasm / fair → wasm | 1.04× [0.99, 1.16] / 1.12× [1.06, 1.20] | 1.35× / 1.29× | 1.43× [1.37, 1.57] / 1.37× [1.26, 1.41] |
| node, protector invalidated on both sides: orig → wasm | 1.16× [1.11, 1.19] | 1.42× | 1.55× [1.50, 1.61] |
| node, one run: today's main thread (invalidated) → same JS, protector intact | 1.13× [1.04, 1.21] | 1.18× | 1.23× |

Kernels (replay, protector intact): alloc 1.21×, union 1.32×, report 1.26×, finalize 1.81× vs the original JS loops;
SIMD vs scalar build 1.00–1.03× except finalize 1.27×. Lessons: (1) a JS arm with an invalidated protector inflates
wasm's lead by ~0.15–0.3×; (2) keeping the protector intact is worth as much for the whole sim (+13 %) as this port;
(3) the e-cache that helps wasm's alloc (1.08×) slows JS's (0.91×) — each side gets its faster exact variant.

## Measured (traffic core, `traffic.rs`: the numeric phases of traffic.ts @24f8609; 1M-population fixtures)

`node tools/bench/trafficCore.bench.mjs insitu|micro|math|e2e|browser --fixture dense1m|stress1m|bot256` (frozen
24f8609 tree; `$SIM_WASM_PATH` / `$TRAFFIC_CRATE` select another build). One V8 isolate per arm (node worker thread /
Chromium browser context), CPU time per arm, rotating interleaved order, 41–61 pairs after 3 warm-up cycles,
paired-ratio median with a 95 % bootstrap CI, load 12–30 on 4 cores. The protector is INTACT in every arm unless the
arm is `-inv` (checked per arm with a natives-syntax probe; fixtures gunzipped with zlib; the pre-sized memory never
grew: `memory.grow` 0 in every run). Every run ended bit-identical to the original; the wasm arms ran 0 JS fallbacks.
"orig" = traffic.ts as is, "fair" = the restructured JS core (src/wasm/js/trafficCore.ts: radix sort, precomputed stop
x / z, reused scratch), "wasm" = the shipped binary (imported Math.exp / Math.log), layers staged per call.

| traffic cycle (runCycleSync) | orig ms | orig → wasm | fair → wasm | orig → fair |
|---|---|---|---|---|
| node, dense1m (2 runs, 41 / 61 pairs) | 38.0 | 1.29× [1.18, 1.36] / 1.26× [1.24, 1.31] | 1.17× [1.09, 1.19] / 1.23× [1.19, 1.29] | 1.14× / 1.04× |
| node, dense1m, layers resident | 37.6 | 1.30× [1.25, 1.35] | 1.18× [1.15, 1.23] | 1.06× |
| node, dense1m, a road cell bulldozed / rebuilt before every cycle | 45.4 | 1.29× [1.20, 1.42] | 1.14× [1.11, 1.20] | 1.13× |
| node, stress1m (36k road nodes) / with edits | 45.8 / 48.0 | 1.29× [1.21, 1.36] / 1.26× [1.23, 1.30] | 1.23× [1.18, 1.35] / 1.17× [1.14, 1.21] | 1.03× / 1.08× |
| node, bot256 (650k people, no stops) | 16.5 | 1.16× [1.07, 1.26] | 1.15× [1.10, 1.23] | 1.05× |
| Chromium 141, main thread / Worker, dense1m | 45.7 / 46.6 | 1.28× [1.20, 1.55] / 1.35× [1.15, 1.58] | 1.32× [1.25, 1.44] / 1.27× [1.17, 1.39] | 0.99× / 1.08× |

- **Whole day at 1.1M people** (node e2e, dense1m, 248 days, 60 interleaved 4-day chunks; control orig → orig2 1.00×
  [0.97, 1.08]): design cadence (a traffic cycle every 2nd day) orig → wasm 1.13× [1.08, 1.17] (traffic 19.6 → 14.3
  ms/day, 1.34×), fair → wasm 1.07× [1.00, 1.13]. Headless scheduler budget: orig → wasm 1.10× [1.02, 1.16].
- **Protector** (node, dense1m): orig-inv → orig 1.13× [1.10, 1.14] — keeping it intact is free; wasm-inv → wasm 0.99×;
  orig-inv → wasm-inv 1.41× [1.35, 1.52]. Chromium: orig-inv → orig 1.04× (main) / 1.08× (Worker). The earlier node
  A/Bs of this port loaded fixtures through bundle.ts `unpackFile`, whose undici streams detach an ArrayBuffer: every
  arm ran with the protector invalidated, which put fair → wasm at 1.31–1.39×.
- **Imports vs inline fdlibm** (arm `wasm-fdlibm`): 0.97–0.99× in node, 0.94–0.95× in Chromium — the price of
  engine-independent exp / log. **SIMD vs scalar build**: 0.97–1.01× (no gain; the kernels are gather / search bound).
- **Micro** (dense1m round 0, 12,338 candidates): sort native 1.06 ms → JS radix 0.32 ms (3.35×) → wasm radix 0.25 ms
  (1.31×); logit 12,338 three-way splits JS 0.42 ms vs wasm 0.54 ms (0.78×; inline fdlibm 0.80×): exp-bound, no wasm
  gain; the roundMatch kernel fair → wasm 1.20× [1.13, 1.24].
- **exp / log bit test**: 20M random arguments + every argument of 3 cycles of each fixture, 0 mismatches (shipped
  imports by construction; the fdlibm build on V8).
