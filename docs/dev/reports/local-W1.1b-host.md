# local-W1.1b-host: main-thread predictions (T031)

Branch `local/W1.1b-host`, base `93069fa`. Changes are **uncommitted**. No push or `.done` marker.

**Not DONE:** the owned implementation and tests typecheck, but stationary hover refresh needs a small scope
extension (below). Vitest cannot start in this sandbox. T032's command transport and the integration gates are
still outstanding.

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

## Plan/code differences and remaining scope issue

- **Stationary hover caches are outside the owns.** `tools.refresh()` only marks a move dirty. `ZoneTool.ts`
  (`RectTool`), `NetworkTool.ts`, `PlopTool.ts` and `BrushTool.ts` cache previews by pointer geometry/settings.
  Repeating `move()` after an ack does not recompute a stationary preview. Their cache keys need
  `host.pending.revision` (including the plop preview used for click validation). A narrow scope extension was
  requested; these four files are untouched. Until it lands, the last-ack refresh callback runs but a cached
  pending reason/cost/ghost colour can persist until the pointer or tool settings change. No forced tool
  deactivate/reactivate or private-field workaround was added.
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
| `tests/render/pendingPreviews.test.ts` | Written/typechecked without a GPU: independent hover/commit geometry; sequence ownership; clipping/path copying; resource disposal. Not executed. |
| `tests/game/toolCommands.test.ts` | Existing W0.2 cases retained; added issuing-tool routing, settled gesture mismatch and exact-refusal deduplication. Attempted single-file run: startup **spawn EPERM**, no tests ran. |
| `tests/game/queryReads.test.ts` | Updated the existing deferred-demolition assertion for its issuing tag and gesture. Not executed. |
| T032 lag properties touching HostActions | **Pending T032**, including real packet hooks and the scope fix above |
| Full vitest, existing teardown/preview/query suites | **Lead environment required** |
| 128 × 15 seed-7 bot | **Not run**; required reference remains **196,101 in 2015** (B1) |
| Browser/GPU ghost continuity, playability and teardown | **Not run**; lead's real-GPU checks required |

Both Vitest attempts fail while Vite loads `vite.config.ts`: `externalize-deps` reaches
`windowsSafeRealPathSync`/`optimizeSafeRealPathSync`, which cannot spawn a child process (`EPERM`). No sandbox
workaround, full-suite run, bot run or browser check was attempted.
