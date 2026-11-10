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
| tsc | clean since the fix that follows this report; **not clean at `ad0bb73`**: the new test called a `dispose()` that `LodProxyBuilder` does not have (its fake workers need no teardown; the line is gone). The gate's log recorded the failure and I missed it; vitest does not type-check |
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

**Resumed on Nov 9.** The cloud session stopped at the shared usage limit on Nov 4, with chain desk3 at `finish:t059`
(docs/dev/handoff/2026-11-04/README.md). Before the stop, the desktop's `4fb8bf2` (the test's tsc fix) and dev
`f1c9713` (T034 with T034b, T040, the handoff) were merged in (`0871d4f`, `c72293b`). The rerun of the full vitest
and a page-side probe control were still queued. On Nov 9, dev `87c7c9c` (T053, NOTE-059) merged in cleanly as
`fdd4702`. This branch includes `local/T059-s0-lod-transfer` up to its head, `4fb8bf2`, which is what the handoff
asks the merge to carry. Every gate below was run again on `fdd4702`.

Dev moved on while the gates waited for the lock, to `cb6ca4c`: T058, T057, T060 FEEL-01, T048, T036s5, and NOTE-060
to NOTE-064. That is not merged here; the merge step merges and gates it.
- `git merge-tree` merges it with this branch cleanly. None of it touches the lane's two files.
- On that merged tree, in a scratch export: tsc is clean, and `lodNoTransfer` + `lod.test.ts` pass, 37 of 37. So
  none of the new worker or game code adds a main-thread transfer (`t059-tmp/logs/tsc-mt-cb6ca4c.log` and
  `targeted-mt-cb6ca4c.log`).
- At the final commit, dev was at `34e3f81` (T036s4 and R1 merged too). `git merge-tree` is still clean with it. A
  `git grep` for a `postMessage` with a transfer list there, outside `src/sim`, still finds only lodBuilder's old post
  (which this lane removes) and lodWorker's reply.

The machine is a shared 4-core container with WebGL on SwiftShader. Its browser runs check function, not timings.

### Gap list (required against done)

Sources: the task file; NOTE-048's T059 section ("the fix and its negative-control test are right; run the browser
gates in your quiet slot; the merge needs no bot run"); NOTE-044; NOTE-057 (T059 is in wave 1's cloud review);
WORKER_DESIGN §1.4, §1.5 and §6 row S0 (Acceptance: `tests/render/lod.test.ts` green; the protector probe intact on
the Chromium main thread after 10 min of `demo-ui.html` play, the M6 procedure; LOD proxies per second within ±5 %);
WASM_PLAN M6 and J0; and this report. On Nov 9, two more: NOTE-059 (browser checks move to the desktop: for a
desktop lane verified on the real GPU, the cloud reviews the evidence and runs the full vitest and the bot once) and
the Nov 4 handoff (section 4: "after T059 merges, also merge `local/T059` @ 4fb8bf2 or later"). NOTE-060 lists T059
among the cloud's reviews. NOTE-061 (posted during this run) moves every browser check to the desktop, with a
Desktop QA list in each report. NOTE-064 (also posted during this run) has the desktop merge its own lanes, but keeps
"T059 + T028" with the cloud's merge.

| # | Required | At `2aaf32d` (the cloud's start) | Now |
|---|---|---|---|
| 1 | lodBuilder's main-thread post without a transfer list | done (`ad0bb73`) | verified line by line (below) |
| 2 | tsc clean | **not met**: `tests/render/lodNoTransfer.test.ts(41,10): TS2339 Property 'dispose' does not exist on type 'LodProxyBuilder'` (the test called `pb.dispose?.()`; the class has none) | fixed in `d21fe03`; clean on the final tree |
| 3 | The new test fails on the old code | claimed. Its "still attached" check was vacuous: the fake worker ignored the transfer list, so nothing could detach | `d21fe03`: the fake worker detaches on a transfer list; both cases fail on the old code, and the attached check fails on its own (below) |
| 4 | Full vitest; `lod.test.ts` green | the desktop's tree | **green on the merged tree `fdd4702`**: 2,391 passed, 0 failed (gates) |
| 5 | The bot identical (192,899) | the desktop's tree | **identical**: lane `fdd4702` against a clean export of dev `87c7c9c`, 192,899 both (gates) |
| 6 | Nothing else transfers from the main thread | not checked | grep and an AST scan of `src/` except `src/sim`, pinned by a test case (below); again on `fdd4702` and on its clean merge with dev `cb6ca4c` |
| 7 | Protector intact after 10 min of `demo-ui.html` play (M6) | not run (the desktop had run T028's qa-worker A/B, a different procedure) | **done on the real GPU by the desktop** (`de062e3`, A/B/B/A: intact in both T059 runs, invalidated in both dev runs). The cloud ran the same procedure on SwiftShader (below) |
| 8 | LOD proxies/s within ±5 % of dev | not run | **done on the real GPU by the desktop** (`de062e3`): −1.36 %. Not measurable here |
| 9 | `docs/dev/queue/T059-s0-lod-transfer.done` | missing | the desktop's line (`de062e3`), plus one cloud line |
| 10 | The desktop's later commits on `local/T059` (the handoff) | `de062e3` and `4fb8bf2` not yet in | both merged (`92a807f`, `0871d4f`); `4fb8bf2` is the branch's head |
| 11 | NOTE-059: review the desktop's real-GPU evidence | — | its numbers checked (below). The images are on the desktop's scratchpad, which the cloud cannot read |

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
- **Again on Nov 9 (`fdd4702`)**, now with T034's sim worker in dev:
  - `grep postMessage` under `src/` finds the main thread's posts in `WorkerSimHost.ts` (`worker.postMessage(m)`, and
    `WorkerLink.post`, which calls `assertOwnedBuffers(m)` and then `port.postMessage(m)`) and lodBuilder's three.
    None has a transfer list.
  - `src/worker/simWorker.ts`'s posts are worker-side, with no transfer list. lodWorker's reply is still the only
    transfer under `src/`. `src/render` and `src/game` have no other one; `src/game` has no `postMessage` at all.
  - There is no BYOB stream read, `MessagePort` transfer or `BroadcastChannel`. The only `memory.grow` is
    `src/wasm/heap.ts`'s, as above.
  - The scan case pins this and passes on `fdd4702`.

**The desktop's S0 numbers, checked (NOTE-059).** The arithmetic in the real-GPU table above holds:
- Proxies/s medians: dev (0.297 + 0.293) / 2 = 0.295, T059 (0.282 + 0.300) / 2 = 0.291, so −1.36 %.
- A/A spreads: dev 0.297 / 0.293 = 1.4 %, T059 0.300 / 0.282 = 6.4 %.
- Burst medians: T059 (3,018 + 2,864) / 2 = 2,941, dev (4,761 + 3,402) / 2 = 4,081, so 0.72×, 28 % lower. Dev's two
  runs differ by 1.40×.
- The catalog prefetch: 678 variants at those rates take 0.231 s against 0.166 s, so about 65 ms more.
- Every T059 row reads intact at boot, at start, at every minute, at the end and at the terminal check. Both dev rows
  flip on the first LOD `Worker.postMessage`, 0.79 s and 0.75 s into the page.
- So both S0 lines pass as the desktop reported them: on Chromium 141 the probe sees lodBuilder's transfer and J0
  removes it. The run logs and images are in the desktop's scratchpad (`qa/T059s0/`).

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

**On this Chromium the protector column cannot tell the arms apart, by V8's design, not because the probe is blind.**
- The only Chromium on the cloud is Chrome for Testing **153.0.8010.12** (V8 15.3): `/opt/pw-browsers`' `-1194`
  directories are symlinks to the `-1243` build. The desktop and M6 ran Chromium 141.
- T034b established, in `docs/dev/reports/local-W1.2-worker.md` decision 11 (experiment 9, in workers), that this V8
  has the ArrayBufferDetaching protector but tracks array buffer views:
  - a detach of a buffer with no view, or with exactly one TypedArray view, is free;
  - two or more views, a DataView or a detach key invalidate it.
  lodBuilder's old post transfers three lone `Float32Array` copies, one view per buffer, so on Chromium 153 it was free.
  That is why dev's page read "intact" here after 72 and 124 transfers.
- This lane's first probe controls (`t059-tmp/probe/chromeprobe.mjs`) agree. Each ran in a fresh context with T028's
  probe installed first, and stayed on TurboFan (status 41) after every detach tried: a no-view
  `structuredClone(buffer, { transfer })`, a no-view `ArrayBuffer.prototype.transfer()`, a single-view
  `Worker.postMessage` transfer, and a single-view positive control at the end of dev's run 2. Each control confirmed
  that its buffer was detached. Every one of them falls in the free class, so they say nothing against the probe.
- The same probe in node 22.22 (V8 12.4, which invalidates on any detach) flips on a no-view transfer and on a
  `MessagePort` transfer (`t059-tmp/probe/nodeprobe.mjs`: status 81 → 129), as T028's self-test does.
- No page-side positive control ran here: that would be a two-view or DataView detach, which this V8 does count.
  - The Nov 4 run queued one (`t059-tmp/probe/chromeprobe2.mjs`), and the session stopped before it got the lock.
  - On Nov 9 a controls-only copy (`chromeprobe3.mjs`, a `data:` page with no game) was queued. Its lock waiter was
    terminated from outside while it waited (exit 143, before the lock), with 23 jobs queued for the lock.
  - It was not queued again: see the decisions.
  - The evidence that the probe would flip on such a detach is T034b's experiment 9. It used the same Chromium 153
    and the same TurboFan probe loop: two views or a DataView invalidate the protector, and V8 traces
    `ArrayBufferDetaching`. It ran in module workers, not on the page; the protector is per isolate either way.
- **What this means for J0:**
  - On Chromium 141 (the desktop, M6) and on any V8 that invalidates on every detach, lodBuilder's transfer list kills
    the page's protector. J0 keeps it. That is the desktop's real-GPU A/B in the section above.
  - On Chromium 153, single-view transfers are free, so J0 buys nothing for the protector there. It costs the
    structured-clone copy (the desktop's burst finding). T034b left "what J0 buys on a current Chrome" open as a
    real-GPU timing question.
  - J0 is still right on every engine: WORKER_DESIGN §1.4 forbids transfer lists in both directions, and a main thread
    with no detaches keeps the protector on any V8.
- **The cloud's own evidence is the instrumentation.** In 10 minutes of play, T059 makes no main-thread detach of any
  instrumented kind (the Worker, MessagePort and window posts, `structuredClone`, `transfer()`, `memory.grow`): 0 of
  170 LOD jobs carried a transfer list. Dev transfers on every job: 72 of 72, and 124 of 124. Every proxy is still
  built (pending 0), and the city renders.

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
| tsc (`--noEmit`) | **clean** on `b09d9f4`, `dcf2ad1`, `1ddc5e9`, `c72293b` and, on Nov 9, on **`fdd4702`** (exit 0) |
| `tests/render/lodNoTransfer.test.ts` + `tests/render/lod.test.ts` | **37 passed** (2 + 35) on `b09d9f4`, `dcf2ad1`, `c72293b` and **`fdd4702`** (12.4 s); `lodNoTransfer` 2 passed on `1ddc5e9` |
| The new test on the old code (negative control) | **fails**, both cases, at `b09d9f4`, at `1ddc5e9` and on Nov 9 on a scratch export of **`fdd4702`** with dev's `lodBuilder.ts` (`t059-tmp/neg5`, removed afterwards): case 1 `TypeError: Cannot perform DataView constructor on a detached ArrayBuffer`, case 2 two transfers against one (`t059-tmp/logs/negctl-fdd4702.log`). The attached check also fails on its own (above) |
| Full vitest with the fixtures (`SIM_FIXTURES` / `SIM_SNAP` from the main checkout's `tools/bench/.fixtures`) | first run at `dcf2ad1`: 1 failed (this lane's scan case, a 5 s timeout), 2,236 passed, 8 skipped; 224 files passed, 2 skipped (851 s). The Nov 4 rerun never got the lock. **Nov 9, on `fdd4702` (`b1bc414`, docs only on top): 0 failed; 2,391 passed, 7 skipped; 238 files passed, 2 skipped (418 s)** (`t059-tmp/logs/vitest-full-5.log`) |
| The bot, `--size 128 --years 15 --seed 7`, lane against a clean export of dev | **identical**: lane `b09d9f4` against dev `50a6b29`, and on Nov 9 lane **`fdd4702`** against a clean export of dev **`87c7c9c`** (`co/t059-devbase`). Both read `residents [ 61124, 93804, 37971 ]` = 192,899, with the same jobs and caps lines. The whole log is the same except the timing columns (`t059-tmp/logs/bot-lane-6.log`, `bot-dev-6.log`) |
| S0 on the real GPU (protector intact after 10 min of demo-ui play; LOD proxies/s within ±5 %) | **PASS, by the desktop** (`de062e3`, the section above); not re-measurable here |
| S0's procedure on SwiftShader (function) | T059: 0 main-thread detaches in 600 s of play (170 LOD jobs), probe intact. Dev: 72 of 72 and 124 of 124 jobs transferred, probe also intact, because single-view detaches are free on Chromium 153's V8. The discriminating protector A/B is the desktop's Chromium 141 run |

The lane touches only `src/render` and a test, so the bot cannot differ (NOTE-048: "the merge needs no bot run"). It
was run anyway on Nov 9, on the merged tree, because dev had moved through T034, T040 and T053 (`src/worker`,
`src/sim`, `src/game`). The new dev commits since `87c7c9c` were not gated here; see the start of this section.

### Decisions

- **Status partial → ready.** The lead's brief expected the real-GPU items to stay open. The desktop then pushed them
  (`de062e3`), and they pass: the protector is intact in both T059 runs and invalidated in both dev runs, and LOD
  proxies/s is −1.36 %. Their evidence is the desktop's (harness `qa/T059s0/` on its scratchpad). The cloud cannot
  re-measure them on SwiftShader, so it relies on that evidence and on its own function checks.
  - On Nov 9 this was checked against NOTE-059 and the handoff. NOTE-059 makes a desktop lane's real-GPU
    verification the evidence; the cloud reviews it and runs the full vitest and the bot once, at merge. The handoff
    lists T059 under the desktop's "Done, with a .done".
  - The Nov 9 brief again said "partial" for the two real-GPU items. That brief was written from the desktop's
    earlier `2aaf32d` state: both items are in `de062e3`, which is merged here, and their numbers check out (above).
    So nothing listed is left and the status stays ready.
- **No more cloud browser runs for this lane (NOTE-059, NOTE-061).** The Nov 9 resume ran no SwiftShader game
  session. The one browser job queued was a short `data:`-page control of the probe, not a check of the game. Its lock
  waiter was terminated from outside while it waited.
  - NOTE-061, posted on dev (`1c2019c`) during this run, moves every browser check to the desktop, and the lock
    script now refuses them. So it was not queued again.
  - The result could not change T059 anyway: J0 is right on every V8, and the S0 gate stands on the desktop's
    Chromium 141 A/B.
  - The claim it would have backed (this V8 counts two-view and DataView detaches) rests on T034b's experiment 9, with
    that experiment's scope stated above. The control is item 2 of the Desktop QA list.
- **The saturated-burst finding stays recorded, not gated**, as the desktop left it: the catalog burst is 28 % slower
  with structured clone, about 65 ms on a full prefetch. S0's gate is the play-time proxy rate, which passes. Avoiding
  the transfer is the point of J0, and the alternatives (SharedArrayBuffer, batching posts) are design changes for
  the lead. No code change.
- **The cloud harness stays in the scratchpad.** T059 owns only `lodBuilder.ts` and its test. T028's `qa-worker`
  harness is the repo's protector tool.
- **T034b's open call T5 ("the page's own probe stays reported, not gated; gating it is J0's call"): keep it reported,
  not gated, in T059.** The conservative reading:
  - On Chromium 153 the page's probe cannot fail on lodBuilder's old transfers, so gating it would not test J0 there.
  - qa-worker belongs to T028/T034, not to this lane.
  - For the lead and T028 (next in this chain): if the page's probe is ever gated, it needs the same page-side positive
    control that qa-worker's worker gate has (a two-view detach that must flip it, as T034b's `CONTROL_WORKER` does in
    the worker). Then it would catch a new multi-view or DataView detach on the main thread on any V8. This lane's
    `t059-tmp/probe/chromeprobe3.mjs` holds such controls for a page (two views, a DataView, and lodBuilder's old
    three-buffer post) if T028 wants them.
  - The protector's measured value (WASM_PLAN's 1.04–1.06× in Chromium 141) may need re-measuring on a current Chrome.
    T034b leaves that open too.
- **The full vitest's one failure was T059's own test, fixed in `1ddc5e9`.** The source-scan case parses about 290
  files: about 4 s alone and 5.4 s inside the parallel suite, past vitest's 5 s default. It now has a 60 s timeout,
  and its negative control still fails, both cases, on a scratch export of `1ddc5e9` with dev's `lodBuilder.ts`.

### Remaining

- None for T059. (Optional, for the lead: whether the burst cost above matters.)
- For T028 or the desktop, not T059's gate:
  - a page-side positive control, if the page's own probe is ever gated (above);
  - what J0 buys on a current Chrome, where single-view transfers are free (T034b's open item; a real-GPU timing
    question).

### Desktop QA list (NOTE-059, NOTE-061)

S0's browser gate is **already PASS on the real GPU** (`de062e3`: A/B/B/A on `2aaf32d` against dev `683d02b`). The
cloud ran no browser check on Nov 9 (NOTE-061). Nothing below gates T059's merge. These are optional rechecks on dev
at T059's merge commit, after it lands.

1. **S0 on the merged dev, both hosts (optional).**
   - Use `de062e3`'s S0 harness (`qa/T059s0/run_full.sh` on the desktop's scratchpad: Chromium 141 with T028's V8
     flags). Run 10 minutes of `demo-ui.html?town=1&speed=1&quality=high`, once on the default host and once with
     `&simworker=loopback`. demo-ui mounts CityScene itself, so it has no `?simworker=1`.
   - For the real worker host (`index.html?…&simworker=1`), use T028's harness in worker mode (`--host worker`,
     `local/T028-qa-worker`; NOTE-060 item 4). It already reads the page's protector.
   - Expected: the main thread's protector is intact at boot, at every minute and at the end, in every run. Dev now
     posts to the sim worker too (`WorkerSimHost`, no transfer list), and that must not change the result.
   - Also expected: 0 page errors, and the LOD proxies all built (none pending at the end).
2. **A page-side positive control (optional; only if T028 gates the page's probe).**
   - On a `data:` page with the probe installed first, detach an `ArrayBuffer` that has a `Uint8Array` and a
     `Float32Array` view: `structuredClone(b, { transfer: [b] })`. Then detach one that has a `DataView`.
   - Expected: on Chromium 153, both flip the probe and lodBuilder's old three-buffer transfer does not; on Chromium
     141, all three flip it.
   - The cloud's script is `t059-tmp/probe/chromeprobe3.mjs` in the cloud scratchpad. It is not in the repo, and the
     steps above are all it does.
