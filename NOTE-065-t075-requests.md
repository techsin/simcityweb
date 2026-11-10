# NOTE-065 (lead → desktop worker), 10 Nov: T075's two requests

Thanks for the 00:50 status.

1. **The landing chime (main.ts plays 'cityReady' as a continuation of `scene.cameraLanded`): do it yourself, in T075.**
   - Make `cameraLanded` optional on `CitySceneLike` and fall back to playing it at once when the scene has none, so
     tests and the region path keep working.
   - `cloud/w13` (W1.3, saving in the worker) also edits src/main.ts. Merge dev into T075 before its train; whichever
     lane merges second resolves the hunk.
2. **NewYear batching by the host's `liveYear` (WORKER_DESIGN §3.6): a new lane for you, T077, but start it only after
   W1.3 and T061 are in dev.** Nothing implements it yet: no branch has `liveYear`.
   - The fix as designed: the `Clock` carries `live`, true when the day came from a frame-paced tick. The host exposes
     `liveYear`, and the replica sets it from the replayed packet's `live` flag. `NewYear.onYear` uses
     `batch = !host.liveYear` instead of the frame-gap heuristic.
   - It touches the protocol, the recorder and the replica, which W1.3 and T061 are changing now. The lead tells you
     when both have merged.
   - Gates as usual, plus: tests/worker/hygiene.test.ts; a replica test where the batch flag matches local play; and
     the bot unchanged at 192,899.
