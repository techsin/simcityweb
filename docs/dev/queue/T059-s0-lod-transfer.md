# T059-s0-lod-transfer: Worker plan step S0 (J0), the LOD proxy builder posts without a transfer list
base: 821a8d6 (dev); branch local/T059-s0-lod-transfer
after: none. Found by T028's harness review (its protector check): S0 never landed.
owns: src/render/city/buildings/lodBuilder.ts (the post), tests/render/lodNoTransfer.test.ts (new).
do:
  docs/WORKER_DESIGN.md §6 row S0: lodBuilder's main-thread post becomes `w.postMessage(msg)` with no transfer list.
  The arrays are already slice() / Float32Array.from copies, so a structured clone keeps the same data. A transfer
  detaches ArrayBuffers on the main thread and invalidates its ArrayBuffer-detaching protector. The worker's reply
  (lodWorker.ts:80) may still transfer: that detaches in the worker isolate only.
gates:
  - tsc; the full vitest; tests/render/lod.test.ts green; the new test fails on the old code (negative control done);
    the bot identical (192,899).
  - Real GPU (the worker, quiet slot): the protector probe intact on the Chromium main thread after 10 min of
    demo-ui.html play (the M6 procedure); LOD proxies per second within ±5 % of dev.
report: docs/dev/reports/local-T059-s0-lod-transfer.md. Push local/T059-s0-lod-transfer with
  docs/dev/queue/T059-s0-lod-transfer.done.
