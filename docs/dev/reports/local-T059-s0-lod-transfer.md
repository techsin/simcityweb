# T059 report: Worker plan step S0 (J0), the LOD proxy builder posts without a transfer list

Branch `local/T059-s0-lod-transfer`, `ad0bb73`, on dev `821a8d6`.

## The change

`src/render/city/buildings/lodBuilder.ts`, `LodProxyBuilder.post`: `this.workers[k].postMessage(msg)` with no transfer
list, as docs/WORKER_DESIGN.md §6 row S0 asks.
- The job's `position`, `color` and `surf` arrays are already `slice()` / `Float32Array.from` copies, so a structured
  clone carries the same data, and nothing on the main thread can alias them.
- The transfer used to detach those ArrayBuffers on the main thread. The first detach invalidated the main isolate's
  ArrayBuffer-detaching protector, which slows typed-array access everywhere on the main thread.
- The worker's reply (`lodWorker.ts:80`) still transfers. That detaches buffers in the worker's own isolate only.

Found by T028's harness review: its protector check failed on dev.

## Gates

| Gate | Result |
|---|---|
| tsc | clean |
| Full vitest, with the fixtures | **219 files passed, 1 skipped; 2,169 tests passed, 7 skipped; 0 failing** |
| The bot, 128x15 seed 7, with the action log | **identical to dev: residents [ 61124, 93804, 37971 ] = 192,899** |
| New `tests/render/lodNoTransfer.test.ts` | passes: no transfer list, the posted arrays stay attached, and they are copies. **It fails on the old code** (the negative control: the fix stashed) |
| `tests/render/lod.test.ts` | 35 passed |
| **Real GPU, main-thread protector** (T028's harness, `abb8ed1`, Chromium 141, RTX 5070 Ti; V8 flags `--allow-natives-syntax --no-maglev --no-optimize-on-next-call-optimizes-to-maglev`) | **dev: intact at boot, invalidated by the end** of a full run, on loopback and local `--w1`. **With T059: intact at boot, at the end and after a 15 s freeze**, on both hosts: loopback 53/0, local `--w1` 51/0 |

## S0 on the real GPU (quiet slot, 3-4 November, 00:23-01:04 UTC): PASS

S0's procedure (docs/WORKER_DESIGN.md §6): 10 minutes of `demo-ui.html?town=1&speed=1&quality=high` play per run, the
protector probe checked at boot, at play start, every 60 s and at the end, then a terminal check (a fresh probe that
flips only if the protector was still intact). A/B/B/A: dev `683d02b` (still transferring) against this branch
`2aaf32d`, each run with a fresh Vite and a fresh Chromium 141 (headless shell, V8 flags as above), RTX 5070 Ti,
ANGLE D3D11, the machine held quiet. Harness: scratchpad `qa/T059s0/` (`run_full.sh`, tables in `full1/tables.md`).

| Run | Tree | Protector, boot · start · every minute · end · terminal check | Verdict | LOD proxies/s in the window | Saturated burst, proxies/s (median of 23 rounds) |
|---|---|---|---|---|---|
| 1 | dev | I · X · X×9 · X · already invalidated | **INVALIDATED**: the first `Worker.postMessage` of an LOD job, 0.79 s into the page | 0.297 | 4,761 |
| 2 | T059 | I · I · I×9 · I · intact until the end | **INTACT** | 0.282 | 3,018 |
| 3 | T059 | I · I · I×9 · I · intact until the end | **INTACT** | 0.300 | 2,864 |
| 4 | dev | I · X · X×9 · X · already invalidated | **INVALIDATED**: the same post, 0.75 s | 0.293 | 3,402 |

**The S0 lines:**
- The protector is intact on the main thread at the end of every T059 run (continuous probe and terminal check, with
  the control probe intact). Dev invalidates it in every run, which shows the probe sees the transfer. **PASS.**
- LOD proxies per second, T059 against dev: medians 0.291 against 0.295, **−1.36 %**, inside ±5 %. **PASS.** The A/A
  spread inside each tree is 1.4 % (dev) and 6.4 % (T059).
- 0 page or console errors in all four runs.

**Recorded, not gated: the rate S0 names cannot see a slower pipeline.** In demo-ui's town the proxy rate is set by
growth: each model variant is built once, mostly early (dev's first run: 107, 5, 37, 7, 12, 9, 2, 1, 1, 1 proxies per
minute; about 0.29 a second over the window), so both trees match it whatever the pipeline's speed.
The harness therefore also measures a saturated burst after the play window: the sim paused, every catalog variant
requested at once under fresh cache keys, 23 rounds, median rate.
- T059's burst rate is **28 % lower** (2,941 against 4,081 proxies/s). Dev's own two runs differ by 1.40×, but both
  T059 runs sit below both dev runs, so the difference is probably real: structured clone costs more than transfer
  when the pool is saturated. The main thread's cost per post grows by 0.019 ms (0.050 against 0.031 ms).
- What it costs a player: prefetching the whole catalog once (678 variants) takes 0.23 s instead of 0.17 s at these
  rates, about 65 ms, spread over a city load. In play the pool is idle almost all the time (busy-pool throughput
  T059/dev 0.95).
- Avoiding the transfer is the point of S0; a transfer of a fresh copy would detach a main-thread buffer too. If the
  burst ever matters, SharedArrayBuffer (needs cross-origin isolation) or batching several jobs per post are the
  options.

`.done`: `docs/dev/queue/T059-s0-lod-transfer.done`.

## Cloud carry-over (Nov 3)

Branch `cloud/t059`, from `local/T059-s0-lod-transfer` @ `2aaf32d`. Merged into it, in order: dev `683d02b`,
`9fcc2ec` and `50a6b29`; then the desktop's own `de062e3` (this report's real-GPU S0 section and the `.done` line,
pushed at 01:16 UTC on Nov 4 while the cloud run was waiting for the lock); then dev `63c8f58` (T052, NOTE-053 to
NOTE-058). Every merge was clean except this report, where the desktop's S0 section and this section both replaced
"Still to run". Both are kept whole. Against dev, the lane is still `src/render/city/buildings/lodBuilder.ts` (+4 −1)
and `tests/render/lodNoTransfer.test.ts` (new).

The machine is a shared 4-core container with WebGL on SwiftShader. Its browser runs check function, not timings.

### Gap list (required against done)

Sources: the task file; NOTE-048's T059 section ("the fix and its negative-control test are right; run the browser
gates in your quiet slot; the merge needs no bot run"); NOTE-044; NOTE-057 (T059 is in wave 1's cloud review);
WORKER_DESIGN §1.4, §1.5 and §6 row S0 (Acceptance: `tests/render/lod.test.ts` green; the protector probe intact on
the Chromium main thread after 10 min of `demo-ui.html` play, the M6 procedure; LOD proxies per second within ±5 %);
WASM_PLAN M6 and J0; and this report.

| # | Required | At `2aaf32d` (the cloud's start) | Now |
|---|---|---|---|
| 1 | lodBuilder's main-thread post without a transfer list | done (`ad0bb73`) | verified line by line (below) |
| 2 | tsc clean | **not met**: `tests/render/lodNoTransfer.test.ts(41,10): TS2339 Property 'dispose' does not exist on type 'LodProxyBuilder'` (the test called `pb.dispose?.()`; the class has none) | fixed in `d21fe03`; clean on the final tree |
| 3 | The new test fails on the old code | claimed. Its "still attached" check was vacuous: the fake worker ignored the transfer list, so nothing could detach | `d21fe03`: the fake worker detaches on a transfer list; both cases fail on the old code, and the attached check fails on its own (below) |
| 4 | Full vitest; `lod.test.ts` green | the desktop's tree | re-run on the merged tree (gates) |
| 5 | The bot identical (192,899) | the desktop's tree | re-run here, lane and a clean dev export (gates) |
| 6 | Nothing else transfers from the main thread | not checked | grep and an AST scan of `src/` except `src/sim`; pinned by a test case (below) |
| 7 | Protector intact after 10 min of `demo-ui.html` play (M6) | not run (the desktop had run T028's qa-worker A/B, a different procedure) | **done on the real GPU by the desktop** (`de062e3`, A/B/B/A: intact in both T059 runs, invalidated in both dev runs). The cloud ran the same procedure on SwiftShader (below) |
| 8 | LOD proxies/s within ±5 % of dev | not run | **done on the real GPU by the desktop** (`de062e3`): −1.36 %. Not measurable here |
| 9 | `docs/dev/queue/T059-s0-lod-transfer.done` | missing | the desktop's line (`de062e3`), plus one cloud line |

### What the cloud did

**The post, line by line** (`LodProxyBuilder.post`). `copy(n)` returns `a.slice()` for a `Float32Array` attribute and
`Float32Array.from(a)` otherwise. Either way it is a fresh array that owns its whole buffer (`byteOffset` 0, sized to
the view), so the structured clone copies exactly the job's data (§1.4's owned-buffer rule holds), and nothing the
clone produces can alias the live geometry. `job.worker` and `posted[k]` are set before the post, as before. The other
two main-thread posts carry no buffers: `{ ping: i }` and `{ promote: key }`. The main-thread fallback (`drainSync`)
builds in place and posts nothing. The worker's reply (`lodWorker.ts:80`) still transfers four fresh `slice()`
copies. That detaches buffers in the worker's isolate only; receiving a transfer does not detach anything in the
receiver (WORKER_DESIGN O14). `onReply` wraps the received arrays without a copy, as before.

**The test** (`tests/render/lodNoTransfer.test.ts`, fixed in `d21fe03`):
- Case 1 stubs `Worker` with a fake whose `postMessage` behaves like a real port: given a transfer list, it detaches the
  sender's buffers (`structuredClone(msg, { transfer })`). The case posts one urgent job and three queued ones. It checks
  four things: no transfer list; every posted array still attached, with the geometry's full contents; every array a
  copy (neither the attribute's array nor its buffer); and the geometry untouched.
- Case 2 runs S1's AST scan (`tests/worker/hygieneScan.ts`) over every source file under `src/` except `src/sim`
  (S1's own suite covers the sim and the save path). It expects exactly one transfer: `lodWorker.ts`'s reply.
- **Negative controls**, with dev's `lodBuilder.ts` put back: in the worktree at `b09d9f4` (the file restored right
  after), and again on a scratch export of `1ddc5e9`:
  - Both cases fail. Case 1 fails on the transfer list: vitest's formatter throws `TypeError: Cannot perform DataView
    constructor on a detached ArrayBuffer` while printing it. Case 2 fails with two transfers against one, the extra one
    being `this.workers[k].postMessage(msg, [msg.position.buffer, msg.color.buffer, msg.surf.buffer])`.
  - With the transfer-list assertion switched off in a scratch copy of the test, the attached check fails on its own:
    `expected +0 to be 9`, because the posted view was detached. So it is a real second signal.
  - Logs: `t059-tmp/logs/negctl.log`, `negctl-attached.log` and `negctl-final.log`.

**Anything else that transfers from the main thread.**
- `grep postMessage` over every directory under `src/` except `src/sim` (`src/render`, `src/game`, `src/ui`,
  `src/worker`, `src/wasm`, `src/save` and the rest) finds lodBuilder's three posts (job, ping, promote; none with a transfer list) and
  lodWorker's posts (worker-side; one transfer, the reply).
- There is no `structuredClone(…, { transfer })`, no `ArrayBuffer.prototype.transfer*` and no `MessagePort` post with
  a transfer list on the main thread.
- The AST scan over the same 290 files finds no other transfer. It also reports, by S1's rules:
  - `src/save/bundle.ts`'s compression streams and `src/save/index.ts`'s `Blob` reads: these detach in node only, and
    Chromium's streams do not detach (M6);
  - `src/wasm`'s heap reserves and `src/wasm/simWasm.ts`'s `fetch` bodies.
  These are S1/J1 matters (R10, never grow), outside T059's scope. The browser instrumentation below saw no
  `memory.grow` and no other detach in 10 minutes of play.

**S0's browser procedure on SwiftShader** (function only). The harness is a scratchpad script,
`t059-tmp/m6.mjs`. For each tree it starts that tree's own Vite on a free port, with its own cache, removed
afterwards. It launches Playwright's Chromium with T028's V8 flags (`--allow-natives-syntax
--no-maglev --no-optimize-on-next-call-optimizes-to-maglev`) and installs T028's TurboFan probe (`w1.mjs`
`installProtector`) as an init script, first thing in the main isolate. It counts every main-thread detach path:
`Worker` and `MessagePort` posts with a transfer list, `window.postMessage` transfers, `structuredClone` transfers,
`ArrayBuffer.prototype.transfer*` and `WebAssembly.Memory.prototype.grow`. Then it plays `demo-ui.html?town=1&speed=3`:
the camera flies around the town at 180–2,400 m every 3 s, so buildings change LOD and request proxies. Samples come
every 30 s. Last comes M6's `packFile` / `unpackFile` round trip.

| Arm | Play | LOD jobs posted (main) | with a transfer list | other detaches (port, window, clone, `transfer()`, `grow`) | probe at the end | proxies built / pending | page errors |
|---|---|---|---|---|---|---|---|
| T059 (`b09d9f4`) | **600 s**, sim day 28 → 394, pop 6 → 3,722 | 170 | **0** | 0 · 0 · 0 · 0 · 0 | "intact" (TurboFan), every 30 s sample and after the pack round trip (this run predates the positive control) | 170 / 0 | 0 |
| dev (`50a6b29`), run 1 | boot only: `__ready` came after 183 s on a cold Vite cache, then a Playwright screenshot timed out ("waiting for fonts") and ended the run. Screenshots now fall back to CDP | 72 | **72**, the first 5.2 s into the page | 0 · 0 · 0 · 0 · 0 | "intact" (TurboFan) | 70 / 2 | 0 |
| dev (`50a6b29`), run 2 | **120 s**, sim day 33 → 157, pop 33 → 1,769, then the pack round trip and a positive control | 124 | **124**, the first 2.9 s into the page | 0 · 0 · 1 (the positive control) · 0 · 0 | "intact" (TurboFan), even after the positive control | 124 / 0 | 0 |

**The probe cannot see a detach in this Chromium, so the protector column above carries no information.**
- The only Chromium on the cloud is Chrome for Testing **153.0.8010.12**: `/opt/pw-browsers`' `-1194` directories
  are symlinks to the `-1243` build. The desktop and M6 ran Chromium 141.
- The probe controls (`t059-tmp/probe/chromeprobe.mjs`): each one runs in a fresh context, with T028's probe installed
  first. The probe stays on TurboFan, at the same status (41), after every detach on the main thread: a
  `structuredClone(buffer, { transfer })`, an `ArrayBuffer.prototype.transfer()`, and a `Worker.postMessage` with a
  transfer list. Each control confirms that its buffer was detached, and each is checked again after 64 more probe
  calls and 500 ms.
- In dev's run 2, the same probe stays intact after 124 transfers and after a deliberate transfer at the end.
- The same probe in node 22.22 (V8 12.4) flips on a transfer and on a `MessagePort` transfer, as T028's self-test
  does (`t059-tmp/probe/nodeprobe.mjs`: status 81 → 129).
- So with the V8 that Chromium 153 ships, this TurboFan typed-array loop no longer deoptimizes on the first
  detach. Either the loop no longer depends on the `ArrayBufferDetaching` protector, or the protector is gone.
- The cloud's evidence for J0 is therefore the instrumentation:
  - T059 makes **no** main-thread detach of any kind in 10 minutes of play: 0 of 170 LOD jobs with a transfer list,
    and no other detach path. Dev transfers on every job: 72 of 72, and 124 of 124.
  - Every proxy is still built (pending 0), and the city renders.
  - The protector reading itself stands on the desktop's Chromium 141 runs (`de062e3`).

Screenshots (looked at):
- `t059-tmp/shots/t059-ready.png`: the town at boot, with roads, zones under construction and the onboarding card.
- `t059-tmp/shots/t059-end.png`: Feb 11, 2001, 3,898 residents. A grown town, detailed and LOD buildings together, with
  no missing or garbled geometry.
- `t059-tmp/shots/dev2-ready.png`: dev at boot, the same town.
- `t059-tmp/shots/dev2-end.png`: dev's last camera stop is over the forest north-west of the town (the minimap shows
  the view). That is the flight path, not a render fault.

The scratchpad is
`/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/`.

### Gates

| Gate | Result |
|---|---|
| tsc (`--noEmit`) | **clean** on `b09d9f4`, `dcf2ad1` and `1ddc5e9` |
| `tests/render/lodNoTransfer.test.ts` + `tests/render/lod.test.ts` | **37 passed** (2 + 35) on `b09d9f4` and on `dcf2ad1`; `lodNoTransfer` 2 passed on `1ddc5e9` |
| The new test on the old code (negative control) | **fails**, both cases, at `b09d9f4` and at `1ddc5e9`; the attached check also fails on its own (above) |
| Full vitest with the fixtures (`SIM_FIXTURES` / `SIM_SNAP` from the main checkout's `tools/bench/.fixtures`) | first run at `dcf2ad1`: 1 failed (this lane's scan case, a 5 s timeout), 2,236 passed, 8 skipped; 224 files passed, 2 skipped (851 s). The rerun at `1ddc5e9` is pending |
| The bot, `--size 128 --years 15 --seed 7`, lane `b09d9f4` against a clean export of dev `50a6b29` | **identical**: both `residents [ 61124, 93804, 37971 ]` = 192,899, the same jobs and caps lines |
| S0 on the real GPU (protector intact after 10 min of demo-ui play; LOD proxies/s within ±5 %) | **PASS, by the desktop** (`de062e3`, the section above); not re-measurable here |
| S0's procedure on SwiftShader (function) | T059: 0 main-thread detaches in 600 s of play, 170 LOD jobs, probe intact. Dev: 72 of 72 and 124 of 124 jobs transferred. The probe is blind on Chromium 153 (controls above), so the protector itself is the desktop's evidence |

The bot did not run again after `dcf2ad1`. Dev's later commits there are T052 (`src/render`, `src/assets`) and docs.
The lane touches only `src/render` and a test, so the bot cannot differ (NOTE-048: "the merge needs no bot run").

### Decisions

- **Status partial → ready.** The lead's brief expected the real-GPU items to stay open. The desktop then pushed them
  (`de062e3`), and they pass: the protector is intact in both T059 runs and invalidated in both dev runs, and LOD
  proxies/s is −1.36 %. Their evidence is the desktop's (harness `qa/T059s0/` on its scratchpad). The cloud cannot
  re-measure them on SwiftShader, so it relies on that evidence and on its own function checks.
- **The saturated-burst finding stays recorded, not gated**, as the desktop left it: the catalog burst is 28 % slower
  with structured clone, about 65 ms on a full prefetch. S0's gate is the play-time proxy rate, which passes. Avoiding
  the transfer is the point of J0, and the alternatives (SharedArrayBuffer, batching posts) are design changes for
  the lead. No code change.
- **The cloud harness stays in the scratchpad.** T059 owns only `lodBuilder.ts` and its test. T028's `qa-worker`
  harness is the repo's protector tool.
- **A finding for the lead and for T028 (next in this chain): T028's probe gives a false "intact" on Chromium 153.**
  T028's harness fails closed only when TurboFan is never reached. Its detach control runs in node only
  (`protector-selftest.mjs`), so on a newer Chromium a "main intact" would pass without proof. The conservative
  reading: the browser protector gate needs a positive control in the same isolate. The cloud's harness does that: a
  deliberate detach at the end, which must flip the probe. The gate must also pin a Chromium that the control passes
  on. The protector's value on newer V8 (WASM_PLAN's 1.04–1.06× in Chromium 141) may also need re-measuring. Neither
  changes T059: dropping the main-thread transfer is right on every engine, and it keeps the protector wherever one
  exists.
- **The full vitest's one failure was T059's own test, fixed in `1ddc5e9`.** The source-scan case parses about 290
  files: about 4 s alone and 5.4 s inside the parallel suite, past vitest's 5 s default. It now has a 60 s timeout,
  and its negative control still fails, both cases, on a scratch export of `1ddc5e9` with dev's `lodBuilder.ts`.

### Remaining

- None for T059. (Optional, for the lead: whether the burst cost above matters.)
