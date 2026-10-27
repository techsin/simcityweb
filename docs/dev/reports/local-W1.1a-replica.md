# local-W1.1a-replica: the protocol, recorder and replica core (T023, Worker plan W1.1 part a)

Branch `local/W1.1a-replica`, base **`3a0a2ab`** (the dev branch with W0.1 merged). Two commits:
- `a0de0b5` adds the sim-neutral `treesDamaged` event, as NOTE-022 asked: two sim hunks plus their test;
- `5cee5f1` is W1.1a itself, new files only.

**Status:** the code and every correctness gate are done. The node bench (protocol cost per sim day) needs a quiet
machine and is queued for the next quiet slot, so the bench table below is pending and there is no `.done` marker yet.

## What is built

All new files, inside the task's owns. There is no edit to `SimCore.ts`, `SimHost.ts`, `LocalSimHost` or any file
W0.2-W0.6 own. The recorder needs no SimCore hook, so there is no patch to fold into a W0 step.

- **`src/worker/protocol.ts`** (389 lines): the clone-only M2W, W2M and Reply types and their codecs
  (WORKER_DESIGN §2.1-§2.3, §2.5-§2.7).
  - It includes the 25-number building records, the incident records, the cell patches (terrain corner rectangles
    included), sparse and whole layers at the 25 % boundary, and the road-cell-only traffic with its off-road
    exception list (R15).
  - `assertOwnedBuffers` (R9) and `cloneBytes` count bytes with clone semantics.
- **`src/worker/recorder.ts`** (378 lines): the event log with the fidelity rules F1-F7 (§2.4).
  - Event-time building records, with the rolling shadow updated by every record that carries pop and jobs (R2).
  - Event-time incident records (R8).
  - Map events turned into per-layer cell unions, copied at flush. `treesDamaged` is a trees map event.
  - The layer groups with the 4-per-second throttle (§2.6), and the focus and stream subscriptions (§2.7).
  - A dev audit for silent writes to exact building fields.
- **`src/worker/replica.ts`** (289 lines): ordered replay of each packet.
  - Stable object identities for buildings and incidents.
  - Plain sections applied in place (O8), with readiness per layer (O9).
  - The isolating emitter: a throwing listener is reported once, and the packet always finishes. Gaps, malformed
    records and digest mismatches fail closed. `adopt()` builds a fresh state with empty per-state caches (R12).
  - The R1 re-application hooks, as an interface for W1.1b.
- **`src/worker/loopbackCore.ts`** (122 lines): W0.1's `SimCore` with the recorder and the replica in one thread, at
  design and live cadence, with no command or query host.
- **Tests:**
  - `tests/worker/protocol.test.ts` (8 tests);
  - `tests/worker/replica.test.ts` (25 tests: the two 120-day runs plus the focused regressions);
  - `tests/worker/replicaLive.test.ts` (4 tests).
- **`tools/bench/worker/`:**
  - `checkReplica.ts` is NOTE-020's gate, shared by the suites and the bench preflight;
  - `protocolBench.ts` with `run.mjs` is the node bench;
  - `debugReplica.ts` with `runChecks.mjs` is a node preflight that needs neither vite nor a child process;
  - `fixtures.ts` loads fixtures; a `.gitignore` keeps out the bundle temporaries.

### The treesDamaged event (NOTE-022; outside the owns by the lead's ruling)

Before this commit, the tornado lowered trees with no map event (`disasters.ts:316`), so the replica's trees trailed
the primary on the tornado's path until the end event's `treesChanged`. Trees are a primary layer, which F1 requires
to be exact after every packet. The fix is at the source:
- **`src/sim/Simulation.ts`:** `treesDamaged: CellRect` in `CityEvents`, next to `treesChanged`. It is a new name on
  purpose: `pollution.ts:303` reacts to `treesChanged`, and reusing it would move the bot.
- **`src/sim/infra/disasters.ts`:** `advanceTornado` tracks the bounds of the cells it actually lowers. It emits
  `treesDamaged` once per step, and only when it lowered at least one tree. The end still emits `treesChanged` over
  the whole path.
- **Nothing in the sim listens to the new event.** `tests/infra/treesDamaged.test.ts` proves it: it scans `src/sim`,
  where the only non-comment uses are the type and the emit.
- **No renderer change.** WorldView does not listen to the event, so R1 stays pixel-identical and keeps its
  documented lag.
- **The worker side:**
  - `EntryType.TreesDamaged` follows `TreesChanged`, so the replica's map-event range covers it;
  - the recorder maps the event to the trees layer and forwards it in the log;
  - the replica gate has no exception for trees.

The earlier treatment, a test-side exception following NOTE-017's R1 ruling, is gone.

## Design items covered, and what W1.1b and W1.2 inherit

| Item | Built in | Test |
|---|---|---|
| §2.1-§2.3, §2.5-§2.7 messages and codecs | protocol | protocol.test: every M2W, W2M and Reply variant survives `structuredClone` with owned buffers; codecs round-trip, including NaN optionals, def appends and the off-road exception list; byte counts use clone semantics |
| F1-F7 event fidelity | recorder, replica | replica.test: F1-F3/F6 (added, changed and removed in one packet), F4/R8, R1/F7, NOTE-020's order rules |
| R2 rolling shadow | recorder | "R2: rolling repairs a value restored after an event-time record"; full rolling rounds converge in both 120-day runs |
| R8 event-time incidents | recorder, replica | "R8: an actual unserved fire replays its final lost count"; "F4/R8: live incidents return to their end-of-packet values" |
| R9 owned buffers | protocol, recorder | protocol.test; `assertOwnedBuffers` on every packet of the live runs |
| R12 isolation and fail-closed replay | replica | the two R12 tests |
| R13 cause tags in the log and on re-fire | recorder, replica | NOTE-020/F6 cause corruption |
| R15 road-cell-only traffic | protocol, recorder | "round-trips road-only traffic with stale off-road exceptions"; R9/R15/O9 |
| R16's live-cadence suite, without commands | replicaLive.test | 128² and grown fixture, ultra and 1×, 8-33 ms dt, with a tornado and fires |
| O8 plain sections in place | replica | "O8: plain sections update in place, delete stale keys, preserve camera, and cap history/news" |
| O9 no data before the first subscription | replica | R9/R15/O9 |

**W1.1b inherits:**
- R1's pending re-application, beyond the hook interface;
- R3, query replies in packets, once W0.3's queries exist;
- R4 gestures, R5 `host.pending` and the predictions, O1 pending ghosts and O5 ordinance and loan predictions;
- the RecoveryMirror (R7) and the commands in the loopback host;
- lag.test, replicaSafe.test and querySideEffects.test, the browser QA in loopback, and AC1.

**W1.2 inherits** unit scheduling and the explicit live flag (O7). **S5 inherits** the worker's 300 ms traffic floor.

## Design/code differences, and how each was settled

1. **Mirrored layers move before their event, and throttled events cross later ones.** Utilities and traffic write
   their arrays before the pass-end `LayerUpdated`, and the 4-per-second throttle defers the event past later
   entries. So strict every-packet equality and global event order could not both hold. NOTE-020 settled it as
   option (a), and `checkReplica.ts` encodes its four rules:
   - end-of-packet values in a packet that delivers the group;
   - the last-sent bytes in every other packet;
   - only a deferred `LayerUpdated` entry may move;
   - everything else exact after every packet.
2. **The tornado's silent tree writes:** fixed at the source by NOTE-022 (above).
3. **W0.1 has no `beginTick`/`nextUnit` and no explicit live flag.** The live cadence here drives W0.1's frame path
   with synthetic dt. This is O7, for W1.2.
4. **Traffic still has today's 1,000 ms wall-clock floor, not S5's 300 ms.** The bench runs at today's floor and must
   be re-run after S5 for the final volume gate.
5. **Other lanes' contracts are not here yet:** overlay registration, the shared save guards (R6) and the final
   query and save contracts wait for W0.3-W0.6.
6. **The first harness ran out of memory.** It built a full-array diff for each packet, and passed only with a 12 GB
   heap. NOTE-020's fix round stops at the first mismatch with scalar diagnostics: packet, field, first index, both
   values, the differing-cell count and the log's entry types. The strict suites now pass under vitest's default
   heap.

## Gates

| Gate | Result |
|---|---|
| protocol.test.ts (§5.3) | **8/8 pass** |
| replica.test.ts: 128² and grown fixture, design cadence, 120 days, exact after every packet; full rolling rounds converge | **pass, both**, plus 23 focused regressions (NOTE-020's gate rules, F1-F7, R2, R8, R12, R15, O8, O9, the NOTE-022 trees case) |
| replicaLive.test.ts: live cadence, 8-33 ms dt, ultra and 1×, a tornado and fires | **4/4 pass**: 128² and grown fixture at speeds 3 and 1, trees exact after every packet with no exception |
| Node bench: protocol ≤ 0.5 ms per sim day at ultra on dense1m and bot256-1.4M, A/A-normalised, no-op listeners | **pending the quiet slot** |
| S1 hygiene and protector | **4/4 and 4/4 pass**; the 6 skips are the base's placeholders for W0.2-W1.2 |
| `npx tsc --noEmit` | **clean** |
| `npx vitest run` | **135 files passed, 1 skipped; 1,194 tests passed, 12 skipped** (53 s) |
| Nothing outside the owned paths changes | `5cee5f1` adds new owned files only; `a0de0b5` is NOTE-022's two sim hunks plus `tests/infra/treesDamaged.test.ts` |
| `a0de0b5` keeps the bot bit-identical (NOTE-022) | **identical**: the two-process method against `3a0a2ab` gives every yearly state hash identical on 256 × 60 s7 (1,368,806 in 2060) and on 128 × 15 s7 (**194,432** in 2015). See the note below: those runs have no tornado, so a forced-tornado variant was added, and it is identical too |
| `a0de0b5` on its own (without the worker files) | tsc clean; the full vitest passes (132 files, 1,157 tests) |

**The bot never sees a tornado, so the gate as asked does not exercise the new event.** `tools/simbot.ts:255` sets
`disasters: false`. A counting run of 256 × 60 s7 saw 0 tornadoes and 0 `treesDamaged` events. So I added a variant
that triggers a tornado every 6 months (`triggerDisaster`, a fixed pattern around the map centre), run the same way
in both processes:

| Variant | Tornadoes | `treesDamaged` emitted (base / branch) | Yearly state hashes |
|---|---|---|---|
| 256 × 60 s7 | 120 | 0 / 78 | **every one identical**; 1,211,888 in 2060 |
| 128 × 15 s7 | 30 | 0 / 23 | **every one identical**; 156,091 in 2015 |

Both processes register the same counting listener. It only counts, so the hashes compare the sim alone.

The grown fixture is `tools/bench/.fixtures` from the worker checkout (`SIM_FIXTURES`). The suites skip it when it is
absent, which is why Codex's sandbox could not run those cases.

### Bench

**Pending.** The bench is queued for the next quiet slot, after T014's speed reviewer and W0.1's A/A. It will run:

```
node tools/bench/worker/run.mjs --dense dense1m_s7.metropolis --bot bot256_s7_y60.metropolis
```

The bot city has 1,368,806 residents, inside the bench's 1.3M-1.5M check for bot256-1.4M. This table and the
`.done` marker follow then.

## Who wrote what

- **Codex** (max effort), in two lanes:
  - the first lane wrote the protocol, the recorder, the replica, the loopback core, the three suites and the bench;
  - the fix round implemented NOTE-020: the gate's four rules, stopping at the first mismatch, and the regressions.
  - Its sandbox cannot start vitest (spawn EPERM) and had no grown fixture, so it ran its checks as plain-node bundles
    on the generated 128² city.
- **Me (Claude):**
  - the briefs and the reviews;
  - running every suite with the grown fixture, and finding the OOM and the tornado's silent tree writes;
  - the NOTE-022 event, its test, the worker wiring and the replica test for it;
  - the two-process hash gate, the bench run and this report.
