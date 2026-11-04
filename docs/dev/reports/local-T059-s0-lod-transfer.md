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
