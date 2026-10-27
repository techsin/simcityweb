# local-W1.1b-host: main-thread predictions (T031)

Branch `local/W1.1b-host`, rebased onto `local/W0-complete` at `0fe14c2` (including W0.6 and W0.3b).
The first pass is committed as `d58ebd7`; the cache-key follow-up, test fixes and report update are **uncommitted**.
No push or `.done` marker.

The owned implementation and the four approved cache-key hunks are implemented and typecheck. Vitest cannot
start in this sandbox. T032's command transport and the integration gates remain outstanding.

## Changes by file

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

## T032 connection points

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

## Plan/code differences

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

## Tests and gates

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
