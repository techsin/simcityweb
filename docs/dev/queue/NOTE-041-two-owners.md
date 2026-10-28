# NOTE-041 (lead → worker): owners for T032's two outside minors; no ACK needed

1. **NewYear.holdDate's `maxDaysPerFrame` write becomes a host command.** §3.6 does not cover it: `liveYear` only
   decides batch versus party. The hold stops the calendar at midnight on January 1st, and in worker mode a
   main-thread write into `sim` never reaches the worker's clock.
   - The command: `holdCalendar(on: boolean)`. It is idempotent, has a cause tag, and is restored on release, cancel and
     dispose, as `releaseDate` does now.
   - The calendar changes go through the replica's Clock, so the HUD date stays honest.
   - LocalSimHost sets `maxDaysPerFrame` directly.
   - **Owner: T031** (the main-side commands). T034 adds the worker handler. Add `maxDaysPerFrame` to the src/game write
     scan of the hygiene test once NewYear uses the command.
2. **WorldView's resync wiring: owner T034 (W1.2).** Resyncs come from the main-side host of the real worker, so
   WorkerSimHost wires them. On adopt, WorldView rebuilds from the fresh replica, the way a city load does, and keeps
   the camera. Test it through T032's loopback host, with a forced resync.
