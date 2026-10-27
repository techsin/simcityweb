# local-W0.1-simhost: SimCore, SimHost and LocalSimHost on the main thread (T020, Worker plan W0.1)

Branch `local/W0.1-simhost`, base **`d8256fc`**. The dev head `bd93687` is merged in (`2470bdf`), as NOTE-015 asked:
it adds only docs and the S1 suites, so W0.1's protector child can use SimCore.

## What changed

### The host seam (WORKER_DESIGN §6 row W0.1)

- **`src/worker/SimCore.ts`** (new): owns the empty `Simulation`, the system boot and the authoritative actions.
  - `boot(rctx, mods)` does three things, in order: it applies and subscribes the region effects
    (`trackRegionEffects`); it creates, guards, pushes and initializes the systems; it constructs `CityActions`.
  - `guardSystem` moved here unchanged, including T016's holder (`guard.errors`, cleared at dispose).
- **`src/worker/SimHost.ts`** (new): the W0.1 `SimHost` interface and `LocalSimHost`, its only implementation.
  - `start()` takes over `CityScene.loadSim`'s lazy imports and keeps the stand-in actions when an import fails.
  - The actions proxy stays stable. `ready` settles on boot or on dispose.
  - A late import cannot boot a disposed host.
- **`src/game/CityScene.ts`, `context.ts`:** `ctx.host` is added, and the scene's and context's `sim`, `state` and
  `actions` delegate to it. The scene starts, frames and disposes the host. The new-city pause rule and the view
  initialization order are unchanged.
- **`src/main.ts`:** the `RegionContext` goes to the scene. The App's own monthly region tracking is removed, because
  SimCore does it. The no-CityScene placeholder keeps its one-time `applyRegionEffects`.

### The simwasm path (NOTE-015 and NOTE-016; this is WASM_PLAN's PI-6, the opt-in import swap)

- **The swap.** The blur imports in `crime.ts:21`, `parking.ts:22` and `pollution.ts:46` point at
  `src/wasm/kernels/blur.ts`.
  - The drop-in's JS path is `src/sim/infra/blur.ts`: it imports `* as js` from it, and every fallback calls `js.*`.
    So J8's restructured blur still applies once both branches merge.
  - The rest of PI-6 (trimming the binary, archiving the other ports, sizing memory) is not part of this.
- **Opt-in by default: the blur kernel's own `'js'` default** (`src/wasm/simWasm.ts`).
  - Blur stays on JS unless a source names blur or sets a global preference. The sources are `SIM_WASM`,
    `?simwasm`, localStorage and `setSimWasmPreference`.
  - Other kernels keep `'auto'`, so the benches are unchanged.
  - Without this default, the swap would have turned wasm on in every node run. The bot, vitest and the benches build
    a `Simulation` without SimCore, and the old `'auto'` default instantiates wasm lazily on the first kernel call.
- **`SimCore`** takes `flags: { simwasm }` (WORKER_DESIGN §1) and applies the flag at boot, before any system runs.
- **`LocalSimHost.start`** awaits `initSimWasmBrowser({ flag })` only in a page, and only when the flag selects the
  wasm blur (`simWasmFlagSelects`). In node the kernel instantiates on its first call.
- **The page passes its flag.** `CityScene` builds the host with `pageSimWasmFlag()`: `?simwasm=` over localStorage
  `metropolis.simwasm`.
- **Tests.**
  - `tests/perf/protectorChild.ts` runs SimCore with `flags.simwasm = SIM_WASM`, so the explicit `blur3` calls are
    gone.
  - `tests/wasm/blurSim.test.ts` now mocks the drop-in itself. Its call counts prove the systems reach the mock.
- **Bundle (vite build, base → W0.1):**
  - the CityScene chunk grows by 2.2 KB;
  - `simWasm` (11.0 KB) becomes a shared chunk of the scene and the sim systems;
  - `browser.ts` (0.3 KB) and the 169 KB binary are lazy, and fetched only with a flag.

### A fix to the Codex tests

`localSimHost.test.ts` placed a building def that does not exist (`t_store`), which threw before the comparison ran.
It now places the test shop `t_cs`. Codex could not run vitest in its sandbox (`spawn EPERM`), so its tests had never
run.

## Design/code differences

1. **The error cutoff is "> 20".** A failing hook reports 20 failures; the 21st is reported with "— disabled", and
   later calls are skipped. This is the existing rule, moved unchanged. So "disables after 20 errors" holds,
   counting the 21st as the one that disables. The tests pin this boundary.
2. **The final restricted API comes later.** UI code still needs real systems and writable `Simulation` properties.
   W0.1 keeps `sim: Simulation` on the host and does not stub the later command, query, watch, view and save APIs.
   - The HUD subscribes before the lazy systems initialize, so the host is built with the state, and
     `SimCore.boot(rctx, modules)` completes it.
   - The design's `boot(state, rctx, opts)` with the scene built after `ready` has to account for this split.
3. **`trackRegionEffects` already applies the entry effects.** So the App's extra application was a duplicate.
   - It is idempotent: `applyRegionEffects` only assigns values computed from the state and the context, and
     `regionBonus` reads none of its own earlier output.
   - `localSimHost.test.ts` compares the old boot (both applications) with the host's (one) through actions, month and
     year boundaries and a save/load continuation. The state is identical.
4. **simwasm: the design's opt-in path did not exist in the code.** No sim file imported the drop-in, and nothing
   called `initSimWasmBrowser`. Resolved as above (NOTE-015, NOTE-016).

No S1 rule belongs to W0.1: the skipped hygiene rules start at W0.2.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full) | **131 files passed, 1 skipped; 1,154 tests passed, 12 skipped, 0 failed; no unhandled errors** |
| 128 × 15 seed-7 bot, bit-identical | identical to base `bd93687`: the printout (every non-timing column, 15 years) and the exact balance rows (16 fields × 15 years). Population in 2015: **194,432** in both |
| Old saves load and continue | 6 of 6: each loads, runs 45 days, reloads to the same 45 days, then a bundle round trip and 3 more days. Every number is identical to base |
| S1 protector, both modes | `SIM_WASM=js` and `SIM_WASM=wasm` pass. In wasm mode the simulation's own blur calls ran on wasm, and the memory stayed at its initial size. Both negative controls (one transfer, one `memory.grow`) fail the gate, as they must |
| Blur stays opt-in (new, `tests/worker/simwasmFlag.test.ts`, 18 tests) | a plain `Simulation` with no flag (the bot's way) blurs on JS and never instantiates wasm; SimCore with no flag stays on JS; `SIM_WASM=wasm` and SimCore's flag each run crime's blur on wasm (0 calls reach the JS original); defaults yield to any source; 12 flag cases; the page flag's order. **Negative check:** without the blur default, 6 of them fail |
| `tests/wasm` | 131 passed, 15 skipped, the same as base |
| The error overlay disables a throwing system | `simCore.test.ts`, for each guarded hook: 20 reports, then the 21st with "— disabled", and later calls skipped while the other hooks keep running. `cityDisposeCanvas.test.ts`: a real ErrorOverlay receives them, and its pause control still works |
| The page's simwasm path in Chromium | real city, 15 s at ultra, see the table below |
| T016's teardown (leak probe) | **PASS**, fresh and hostile modes, 3 cycles each on the `small_s7_y10` region: 0 CityScene and 0 CityState at +3 s after every exit; heap 41–42 MB |
| An ultra A/A of the emulation within noise | **pending:** it needs a quiet machine (after T014's speed review) |

The page, in Chromium 141 (Playwright): the `small_s7_y10` region file is imported, the city is entered, and it runs
15 s at ultra.

| flag | `.wasm` requests | switchboard | blur kernel | days run | systems | error cards / console errors |
|---|---|---|---|---|---|---|
| none | **0** | idle | `js`, inactive | 19 | 20 | 0 / 0 |
| `?simwasm=blur:wasm` | the URL module + one 169,419-byte binary, both after entering the city | ready | `wasm`, active | 19 | 20 | 0 / 0 |
| `?simwasm=auto` | the same | ready | `auto`, active | 21 | 20 | 0 / 0 |

## Who wrote what

- **Codex** (max effort): SimCore, SimHost and LocalSimHost; the CityScene, context and main changes;
  `simCore.test.ts`, `localSimHost.test.ts` and the `cityDisposeCanvas.test.ts` additions; design/code differences 1–3.
- **Me (Claude):**
  - the brief and the review;
  - the `t_store` fix;
  - the merge of the dev head;
  - the simwasm path: the kernel default and the two helpers in `simWasm.ts`, SimCore's flags, `LocalSimHost`'s wasm
    init, the page flag, the import swap, `protectorChild.ts`, `blurSim.test.ts` and `simwasmFlag.test.ts`;
  - every gate run, and the browser check script.
