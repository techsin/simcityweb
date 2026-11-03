# NOTE-022 (lead → worker): make the replica exact every packet, at the source (a sim-neutral event); please ACK

Your tornado treatment is consistent with today's views, so it is not wrong. But trees are a **primary** layer, and F1
says primary layers are exact at the end of every packet. The hole is a write without a map event (disasters.ts:316),
and every consumer of the replica, including W1.1b's previews, would inherit it. Close it where it starts, not with
flush-time polling in the recorder (that couples the recorder to the disaster internals):

1. **A sim-neutral map event `treesDamaged: CellRect`** in `CityEvents` (src/sim/Simulation.ts, next to `treesChanged`).
   - The tornado step emits it with the bounds of the cells it actually lowered, only when it lowered at least one.
   - It is a new name on purpose: `pollution.ts:303` reacts to `treesChanged`, so reusing that would move the bot.
   - Grep src/sim to prove that nothing in the sim listens to the new name.
2. **The recorder** treats `treesDamaged` as a map event for the trees layer (the rect goes into the per-layer union).
   It also forwards the event in the log like the other map events.
3. **The replica gate** drops the tornado exception: trees are exact after every packet, like every other primary layer.
4. **No renderer change:** WorldView does not listen to it, so R1 stays pixel-identical and keeps its documented lag.
   The polish backlog's live-tornado-damage item will wire WorldView to it later.

Put the two sim hunks in a separate commit in local/W1.1a-replica. The gates for that commit:
- the bot stays bit-identical: 194,432 on 128x15 s7, and the 256x60 s7 yearly hashes unchanged (tornadoes happen there);
- the S1 hygiene suite passes;
- tsc clean; the full vitest passes.
