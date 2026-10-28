# T031 — W1.1b part 1: the main-thread prediction side (HostActions, pending edits, pending ghosts)

## Review and gates (the local worker)

Branch `local/W1.1b-host`: the Codex lane's two passes (`d58ebd7`, `7390a2a`), the final `local/W0-complete`, then dev
(`4953806`, and `4e2bb2d` with T032 merged), plus T032 itself, since T031's gates follow T032's (the task's "after").

**What it is.** `HostActions` gives a replica host its predictions: exact while none of the player's own preview-affecting
commands are in flight, provisional otherwise (R5). An exact refusal is never posted. `PendingEdits` reserves each
in-flight command's funds, unique buildings and footprint, so the next preview sees them, and `rebase(cmd)` keeps a
packet's plain sections from being debited twice. `PreviewActions` runs the real CityActions read-only on the replica.
Gestures route corrections to the issuing tool once per gesture (R4), and the committed footprint stays drawn as a
pending ghost until its Ack replays (O1). It meets T032's `PacketActions` seam as written.

**Changed in the review:**
- **The city screen's static graph pulled in CityActions.** LoopbackSimHost found HostActions through an eager
  `import.meta.glob`. Vite bundles that as a static import, and HostActions -> PreviewActions -> src/sim/actions.ts then
  sat in CityScene's static graph, which FH-07a's rule forbids. The hygiene scanner followed only import declarations,
  so it passed. The scanner now follows eager globs (and failed on this branch), and HostActions loads with the core in
  `start()`, before its Ready, as CityActions already did.
- **NOTE-041's `holdCalendar(on)` command (T031's).** SimCore holds the day cap and gives the previous one back,
  idempotently, so a worker's clock holds too; LocalSimHost applies it at once through the same path. NewYear posts it
  through a CityScene dep with its cause tag, released on midnight, cancel and dispose (the dep skips once the scene is
  disposing, when the host is already gone). A new hygiene rule keeps `maxDaysPerFrame` writes in src/worker and
  src/sim. The op is on the wire list but not in JournalOp, so T033's journal leaves it out. T034's worker loop must
  honour the cap (in its brief).
- **`CommandOutcomeLost` (T032's resync).** `commitAction` treats it as applied: no failure feedback, and the prediction,
  or a no-cost success, stands in for a stroke's totals. Any other rejection is still a failure.
- PacketSimHost's pending fallback is T031's `NO_PENDING` (T032's nit).
- Merging dev: ZoneTool's preview key keeps both T031's pending revision and T026's bulldoze day.

The rest reads as designed. PendingEdits' overlay restores funds and milestones in a `finally`. The ghosts are bounded
meshes (large drags are sampled), disposed on Ack and on teardown. ToolController's subscription is signal-bound.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| T031's and T032's suites with the fixtures (tests/worker, pendingTools, pendingHover, toolCommands, pendingPreviews, queryReads, newyear) | 28 files; 234 passed, 1 skipped (W1.2's simWorker graph gate). The lag suite's HostActions oracle (property 1) now runs, and property 4 runs on the real controller. |
| Full vitest (with the fixtures) | **199 files passed, 1 skipped; 1,975 tests passed, 7 skipped** |
| The bot (128x15, seed 7) | identical to `93069fa`, action log included (196,101) |
| New tests against their fixes reverted | commitAction's lost outcome fails without its branch; the FH-07a rule fails on the eager glob |
| The game in loopback, in a browser (ghost continuity, playability, teardown) | T028's harness, once it lands: T031 + T032 together are the first build it can run in loopback mode |

## The lane's summary (Codex, at `7390a2a`)

Superseded where the review changed it (above). The Codex sandbox could not run vitest; every suite above ran here.

### Changes by file

| File | Change |
|---|---|
| `src/worker/HostActions.ts` | Compatibility actions delegate commits to `host.act`. The host's `act` can delegate to this helper for exact/provisional predictions and posting. Exact refusals return a resolved, unposted ticket (`seq: 0`); provisional refusals are posted. Hover calls remain available with pending reasons. Gestures retain their issuing owner. |
| `src/worker/PreviewActions.ts` | Read-only map previews using real `CityActions`, with a shell that refuses RNG, events, notifications and systems. Pure loan/guard checks and ordinance predictions follow the current rules. The state getter follows adoption. |
| `src/worker/PendingEdits.ts` | Preview-affecting reservations, temporary funds/unique-def overlay, footprint claims, copied command geometry and signal-bound subscriptions. A plain-packet watermark prevents double reservations before Ack replay. Also defines the optional pending-preview view capability and the empty local view. |
| `src/worker/SimHost.ts` | Isolated W1.1b blocks: `SimHost.pending`, an empty `LocalSimHost.pending`, and `Gesture.mismatch` after settlement (exact ok feedback with no successful ack). Local execution, queries, policy and teardown are unchanged. |
| `src/game/tools/Tool.ts` | Commit/gesture hunks only: issuing tags, gesture feedback accounting and settlement, one failure allowance per gesture, pending ghosts until acknowledgement/rejection, and abort cleanup. Captures the issuing world so a late ack cannot clear a replacement view. `resultTip` is untouched. |
| `src/game/tools/ToolController.ts` | Signal-bound pending subscription requests hover refresh when reservations change, including the last ack. |
| `src/render/world/WorldView.ts` | Separate neutral footprint/path/brush meshes keyed by command sequence. Hover clearing does not remove committed ghosts. Ack cleanup and city teardown dispose geometry/materials. Large rectangles have bounded geometry. |
| `src/game/tools/ZoneTool.ts` | Approved key-only hunk in `RectTool.refresh`: append the pending revision to the rectangle/drag key. |
| `src/game/tools/NetworkTool.ts` | Approved key-only hunk in `NetworkTool.refresh`: append the pending revision to the path/drag key. |
| `src/game/tools/PlopTool.ts` | Approved key-only hunk in `PlopTool.refresh`: append the pending revision to the placement/action-preview key. W0.3b's upkeep watch and placement-detail queries are unchanged. |
| `src/game/tools/BrushTool.ts` | Approved key-only hunk in `BrushTool.move`: append the pending revision to the cell/radius/strength key. Acknowledgement totals and release behavior are unchanged. |
| `tests/worker/actionReplica.ts`, `tests/worker/hostActions.test.ts` | After W0.6, snapshot the fixtures' retained authoritative `CityState`, rather than `host.state` (which may be a branded replica). The save guard is unchanged; there are no brand casts. |
| `tests/game/pendingHover.test.ts` | Four stationary-pointer cases exercise the real tools and HostActions with the held-command replica stub: cached repeats, pending overlap, last-ack refresh, clearing the pending reason, and commands that settle between frames with no net pending-count change. |

No simulation, save, protocol, recorder, replica, null-view, scene wiring or guard-holder implementation changed.
BrushTool's existing W0.2 acknowledgement totals and settled release sound are retained. There was already no
`actionCorrected` handler to remove.

### T032 connection points

1. Create `HostActions` with a source exposing the current replica `state`, the public `act` delegate, and
   `post(op, args, opts)`. `post` owns sequence allocation, command cloning/queuing, cause-tag storage and optimistic
   field writes. It returns `{seq, done}`. Tags and gestures remain on main.
2. Expose `actions`, `actions.preview`, `actions.pending`; delegate host `act` and `beginGesture` to the helper.
   `HostActions` tracks ticket promises in the selected gesture, so the transport need not track them again.
3. In `ReplicaHooks.plain`, call `actions.pending.rebase(cmd)` after the authoritative plain sections are written.
   Do the same on adopt with the ready watermark. The overlay must not debit funds or count milestones already
   contained in the packet, even while its Ack entries are still replaying.
4. In `ReplicaHooks.ack`, call `actions.pending.ack(seq)` before resolving the ticket. The ticket's continuation
   then clears its ghost before the next render. Promise settlement also cleans reservations on rejection.
5. On disposal/crash, reject outstanding transport tickets; dispose the helper. Read `gesture.mismatch` after
   `gesture.settled` when aggregating the later per-gesture telemetry gate.

`tests/worker/actionReplica.ts` is a held-command stub for this boundary, backed by a real `LocalSimHost` and
replaceable state copies. It does not implement or claim packet/lag coverage.

### Plan/code differences

- **Stationary hover caches needed four extra owned hunks.** `tools.refresh()` only marks a move dirty, while
  the tools cache action previews by geometry/settings. The lead approved the four one-line key additions named
  above. Every pending revision now invalidates those previews, including the final ack at the same pointer.
  T026's bulldoze day key, T027's brush changes and T037's placement tips remain for their respective branches.
- **W0.6 widened `host.state` to include replicas.** The first post-rebase TypeScript run caught four test
  snapshot calls that no longer satisfied the save brand. The fixtures now serialize their authoritative state
  references; no production save code or types changed.
- **The rendering contract has no pending method.** The optional `PendingPreviewView` capability lives in the
  owned helper. The shared commit helper uses it when available; null/loading views remain valid.
- **There was no `PreviewActions` implementation or ordinance preview flag.** Map previews use the existing
  preview flag. Ordinance prediction calls `setOrdinanceEnabled` on a private ordinance-list/budget copy, and loan
  prediction uses `loanOffer`; the live replica is not modified by those rules. Result formatting and the repayment
  guard follow `CityActions`/`SimCore`, with LocalSimHost parity tests.
- **Ordinance `cost` is monthly, not an immediate debit.** Ordinances count as pending, but reserve no cash.
  Sandbox construction likewise reserves no cash; a loan still credits it, matching existing actions.
- **Plain fields arrive before Ack entries.** `pending.rebase(cmd)` accounts for that existing replica order; the
  count/claims remain pending until Ack replay even when funds/milestones already reflect the command.
- Geometry is taken from the committed command at the shared commit helper, keeping individual tool call sites
  within their existing ownership. These are neutral ground footprints, not copies of the full building models.

### Tests and gates

| Test/check | Status |
|---|---|
| `npx tsc --noEmit` | **Pass**, source and tests |
| `git diff --check` | **Pass** |
| `tests/worker/hostActions.test.ts` | Written/typechecked: exact refusal; provisional dependent commands; blocked hover; non-preview exclusions; gesture/tag handling; rejection/adopt; LocalSimHost map, ordinance and loan parity. Attempted single-file run: startup **spawn EPERM**, no tests ran. |
| `tests/worker/pendingEdits.test.ts` | Written/typechecked: funds/loans, nested/throwing overlay restoration, unique defs, reflected-command watermark, sandbox/monthly costs, exact paths/rotations/terrain corners/demolished footprints, subscriptions and listener isolation. Not executed. |
| `tests/game/pendingTools.test.ts` | Written/typechecked: ghost lifetime/read-after-write against the stub; successful/mixed/failed brush acknowledgements; abort/replacement-view cleanup; no local/refusal ghost; controller subscription lifetime. Not executed. |
| `tests/game/pendingHover.test.ts` | Four cases, one each for zone, network, plop and brush. Written/typechecked. Post-rebase single-file run attempted: startup **spawn EPERM**, no tests ran. |
| `tests/render/pendingPreviews.test.ts` | Written/typechecked without a GPU: independent hover/commit geometry; sequence ownership; clipping/path copying; resource disposal. Not executed. |
| `tests/game/toolCommands.test.ts` | Existing W0.2 cases retained; added issuing-tool routing, settled gesture mismatch and exact-refusal deduplication. Attempted single-file run: startup **spawn EPERM**, no tests ran. |
| `tests/game/queryReads.test.ts` | Updated the existing deferred-demolition assertion for its issuing tag and gesture. Not executed. |
| T032 lag properties touching HostActions | **Pending T032**, including real packet hooks, exact/provisional predictions under lag, once-per-gesture corrections and ghost continuity |
| Full vitest, existing teardown/preview/query suites | **Lead environment required** |
| 128 × 15 seed-7 bot | **Not run**; required reference remains **196,101 in 2015** (B1) |
| Browser/GPU ghost continuity, playability and teardown | **Not run**; lead's real-GPU checks required |

The first-pass `hostActions` / `toolCommands` attempts and the post-rebase `pendingHover` attempt all fail while
Vite loads `vite.config.ts`: `externalize-deps` reaches
`windowsSafeRealPathSync`/`optimizeSafeRealPathSync`, which cannot spawn a child process (`EPERM`). No sandbox
workaround, full-suite run, bot run or browser check was attempted.
