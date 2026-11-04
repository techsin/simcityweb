# local-S1-worker-tests: the protector and hygiene suites (WORKER_DESIGN S1 = WASM_PLAN J1; T018)

Branch `local/S1-worker-tests`, base **`2bd38fe`** (the dev-branch head when the task started). New test files only;
nothing under `src/**` changes.

## What is in it

### `tests/perf/protector.test.ts` + `protectorChild.ts`, `protectorResult.ts`

- **The child.** V8 flags are process-wide, so each case spawns a child
  `node --allow-natives-syntax --trace-protector-invalidation`. The test bundles `protectorChild.ts` with rolldown and
  pipes it in on stdin, which writes no build files and stays under Windows' command-line limit.
- **The run.** The child runs 60 days of the Simulation in a `worker_threads` worker on a 128² city. It posts each
  day's results to the main isolate as plain structured clones, two 128 × 128 Float32 layers a day.
- **The probes.** Each isolate makes its own protector probe first thing (`makeProbe`, as in
  `tools/bench/baselines/pi1Day.ts`) and reports it after boot and at the end.
- **What fails the gate:**
  - either protector invalidated;
  - any `Invalidating protector cell` trace line;
  - fewer than 60 days or bytes received;
  - a JS-mode run that touched wasm;
  - in wasm mode, a changed `memory.buffer.byteLength` or a blur kernel that never became active.
- **Two modes:**
  - `SIM_WASM=js`.
  - `SIM_WASM=wasm`, forced, so a missing wasm fails instead of falling back. Both isolates call `initSimWasmSync()`,
    and each worker day runs the wasm blur drop-in (`src/wasm/kernels/blur.ts` `blur3`) on a copy of the city's crime
    layer at the sim's own radius. The test asserts `simWasmStatus().kernels.blur.active` and checks that the wasm
    memory stays at 64 MiB from the first day to the last.
- **Negative controls, in the suite.** One `postMessage` with a transfer list in the worker, and one
  `memory.grow(1)`, each must fail the same gate. Both are tests that pass when the gate catches them.
- **SimCore and the recorder do not exist yet.** A short note marks where W0.1 swaps SimCore in and where W1.1 adds the
  recorder.

### `tests/worker/hygiene.test.ts` + `hygieneScan.ts`

- **Active now.** A static scan of `src/sim/**`, `src/save/{serialize,db,recovery}.ts`, `tests/perf/**` and
  `tests/worker/**`. It forbids:
  - transfer lists (also across comments, newlines and computed property names), `.transfer(`,
    `transferToFixedLength`;
  - `CompressionStream` / `DecompressionStream`, `.stream(`, `new Response(`, `Blob`, and `.arrayBuffer()` / `.text()`
    on bodies;
  - `memory.grow` outside the loader.
- **The two allowed exceptions** are the negative-control operations in `tests/worker/protectorFaults.ts`, listed by
  file and code, so another detach even in that helper fails.
- **Self-tests** show the scanner catches each forbidden form and lets clone-only messages, buffer reads and comments
  through.
- **Written now, skipped until their step**, each named in its title:
  - W0.2: the speed and `liveSlowdown` writers live only in `src/worker` / `src/sim`;
  - W0.3: no `emergencyOf(` / `getSystem(` in `src/ui` and `src/game`;
  - W0.6: no writes into the replica outside `src/worker`, and SimCore's import graph excludes `bundle.ts`,
    `save/index.ts` and `recoveryLs.ts`;
  - W1.2: the same graph rule for `simWorker.ts`.

## Gates

| Gate | Result |
|---|---|
| both suites green on the tree | `npx vitest run tests/perf tests/worker`: **8 passed, 6 skipped** (the six later-step rules) |
| `SIM_WASM=wasm` really runs wasm | `blurActive: true`; wasm memory 67,108,864 bytes before and after the 60 days |
| negative control: one transfer | `S1_PROTECTOR_FAULT=transfer … -t 'SIM_WASM=js'` **fails**: the worker's protector is invalidated (`intact: false`), the main isolate's is intact, and the trace line is detected |
| negative control: one `memory.grow` | `S1_PROTECTOR_FAULT=grow … -t 'SIM_WASM=wasm'` **fails**: the protector is invalidated and the memory goes 67,108,864 → 67,174,400 bytes (one page) |
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full) | **126 files passed, 1 skipped; 1,109 tests passed, 12 skipped, 0 failed; no unhandled errors** (SIM_FIXTURES / SIM_SNAP set; a fresh worktree with T012's .gitattributes, so tests/wasm/binary.test.ts passes on Windows too) |

## A mismatch between the design and the code, reported rather than worked around

- **What the task assumed.** It asks for the protector run "once with SIM_WASM=wasm (blur)".
- **What the code does today.** The Simulation's systems import the JS blur directly (`src/sim/infra/*.ts` import
  `./blur`), and nothing under `src/sim` imports the wasm drop-in. So `SIM_WASM=wasm` alone never puts wasm blur into
  a Simulation run.
- **What the design says.** `docs/WORKER_DESIGN.md` §1: "WASM blur stays opt-in behind `?simwasm=blur:wasm`; the page
  passes its flag in `init`". The opt-in reaches the sim only once W0.1's SimCore takes that flag.
- **What the test does meanwhile.** It drives the drop-in on the city's own fields in the same isolate as the 60 days,
  so the wasm memory, the kernel and the protector are exercised together.
- **For W0.1.** When SimCore lands, the comment in `protectorChild.ts` marks the swap: pass the simwasm flag at init
  and drop the explicit `blur3` calls.

## Who wrote what

- **Codex** (max effort): both suites and their helpers. A second pass reworked the wasm case after it found the
  mismatch above.
- **Me (Claude):** the briefs, the review (gate logic, the allow-list, the trace check), the POSIX form of the fault
  commands in the test header, and every run of the suites, the negative controls, tsc and the full vitest.
