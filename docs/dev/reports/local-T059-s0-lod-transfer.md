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

## Still to run (quiet slot)

S0's own procedure: the protector intact after 10 minutes of `demo-ui.html` play (M6), and LOD proxies per second
within ±5 % of dev. Results will be added here with the `.done` line.
