# local-W0.5-views: views and seams (T020)

## Review and gates (the local worker)

**The scope fix.** My brief wrongly excluded `src/sim/**`, but the row names `src/sim/infra/overlays.ts`. Codex asked,
and the lane resumed with that one exception.

**Behaviour on LocalSimHost is unchanged.** LocalSimHost registers no derived source, so each new path in `overlays.ts`
reduces to the old one:
- `overlayReady` is true;
- `derived` and `overlayStale` take their old branches;
- `overlayLayer` and `emergencyReachAt` keep their results.

**TerrainRenderer** has three hunks, all in the overlay path: the imports, `setOverlay`'s readiness, and the overlay
section of `update()`. A merge note for R1 (`local/R1-terrain-rects`): the `update()` hunk sits right after the tree
refill lines that R1 rewrites, so expect a small textual conflict there.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full) | **154 files passed, 1 skipped; 1,530 tests passed, 11 skipped** |
| `tests/infra/overlays.test.ts`, the news-past-200 and MiniMap tests | pass |
| Hygiene | the new "W0.5: CityScene reads system views through the host" check passes; the "W0.3b" rule stays skipped (NOTE-028) |
| 128 × 15 seed-7 bot | **196,101** in 2015 |
| Old saves load and continue | 6 of 6, every number identical to `2ba03fa` |
| Every data view and variant identical (screenshot diff), the ticker past 200 news items on bot256_y60, the leak probe | **pending**: browser runs wait until T014's speed reviewer is done with the machine |

The original Codex report follows. Its "uncommitted" status is superseded by the section above.

Branch `local/W0.5-views`, base `2ba03fa`. Changes are uncommitted.

**Implementation complete; acceptance gates pending.** The local views, renderer callbacks, news revision,
MiniMap invalidation, derived-source hook and O9 renderer/legend handling are implemented. TypeScript passes;
Vitest cannot start in this sandbox. This is not a claim that the lead-run gates have passed.

The lead explicitly authorized `src/sim/infra/overlays.ts` as the sole exception to the `src/sim/**` prohibition.
No other simulation file or save file is changed. The earlier scope blocker is resolved.

## TerrainRenderer / R1 handoff

Exactly three overlay-only hunks in `src/render/world/TerrainRenderer.ts` (before lines refer to `2ba03fa`):

- Line 19: import `overlayReady` and `markOverlayRendered` beside `overlayStale`.
- Line 619, `setOverlay`: include readiness in `uOverlayOn`, so selecting missing data leaves the tint off.
- Lines 712–719, the overlay tail of `update`: poll readiness, turn the tint off while missing, mark it dirty on
  first delivery, honor source-version staleness, upload only an available active overlay, and acknowledge the
  supplied version after the existing overlay texture update. Hover/legend reads cannot consume that refresh.

There is no change to `updateZones`, `updateTrees`, `updateExits`, `reset`, their callers, or their texture uploads.
The existing overlay texture upload remains in the overlay block. No shader, ramp or filter changes.

## Changes by file

| File | Change |
|---|---|
| `src/worker/SimHost.ts` | Separate W0.5 blocks define `EmergencyView`, `TrafficView`, `UtilitiesView`, stable local readers, `setView` and `newsSeq`. The readers follow lazy boot/state replacement and expose no command methods. Local subscriptions are a no-op. News/reset events advance a revision; listeners are removed by the city's signal and host disposal. |
| `src/game/CityScene.ts` | Pass the city signal to LocalSimHost; attach overlays to `host.sim`; renderer traffic, emergency and time callbacks read the host. Overlay/variant, open panels and inspected building feed `host.setView`. Existing command and teardown paths remain intact. |
| `src/ui/Notifications.ts` | Replace the retained news-length check with `host.newsSeq`; preserve `newsMark` for direct log replacement and preserve layout/scroll behavior. |
| `src/ui/panels/AdvisorsPanel.ts` | Only the news gate and its comment change: the gate uses `host.newsSeq` instead of `news.length`. No query reads change. |
| `src/ui/MiniMap.ts` | `layerUpdated('utilities')` marks the map dirty; the new listener uses `ctx.signal` and existing disposal. Repaint cadence is unchanged. |
| `src/sim/infra/overlays.ts` | Add `registerDerivedSource`, supplied `Entry` data/scale/version, readiness and rendered-version bookkeeping. `derived` asks the source first; `overlayStale` compares its version. Missing subscribed views return no layer/readout, including the Emergency helper. Worker raster scales are forwarded. Local builders/cadence/formulas are unchanged. |
| `src/render/world/TerrainRenderer.ts` | The three overlay-only hunks listed above implement O9 and supplied-version refresh. |
| `src/ui/overlays.ts` | The shared legend helper returns a status note, `Loading…`, while a view is unavailable; both the panel and legend chip already call this helper. Ready legends retain their existing HTML. |
| `tests/game/views.test.ts` | New news-cap, sequence/lifecycle and MiniMap utility-event regressions. |
| `tests/worker/views.test.ts` | New local view forwarding/lazy-boot checks and serialized-state/RNG non-mutation check. |
| `tests/infra/overlaySources.test.ts` | Source priority/versioning, missing variants, direct/main-built readiness, fresh-state resync and local raster/legend preservation. |
| `tests/render/overlayReadiness.test.ts` | Real TerrainRenderer uniforms/texture bytes/version checks for missing data, first delivery while paused, hover-before-frame, cached variants, resync and both legend paths. No WebGL context is needed. |
| `tests/worker/viewSources.test.ts` | Real W1.1a loopback deliveries bound to the new seams in a test adapter; compare every view/variant's bytes and a hover readout with the authoritative state, then check resync readiness. |
| `tests/game/panelsNews.test.ts` | Supply/dispose a real LocalSimHost in the existing ticker fixture; retain the existing N2 and layout assertions. |
| `tests/worker/hygiene.test.ts` | Add an active, CityScene-scoped system-read hygiene check. |
| `docs/dev/qa-W0.5-views.md` | Manual checklist for every view/variant, news past 200 on `bot256_y60`, Emergency/Traffic/Utilities, MiniMap, teardown and remaining lead gates. Checks are marked not run. |
| `docs/dev/reports/local-W0.5-views.md` | This report, with the resolved scope clarification, merge handoff and unverified gates recorded. |

`SimCore.ts` and `src/render/world/overlays.ts` are unchanged.

## Source and readiness contract

`registerDerivedSource(st, (o, resolvedVariant) => Entry | null, ready?)` is state-scoped and returns cleanup.
An entry supplies a `Float32Array`, its scale and a version that advances on delivery, even on the same sim day.
The optional readiness predicate checks subscribed input layers/streams for direct views and main-built
NIMBY/Emergency/Trucks. It is separate from raster availability because `ready` snapshots omit catchment and
response layers, while those views still build their rasters on main.

For Water v1, Desirability v12–14 and Demographics v0–5, a registered source returning null means unavailable;
there is no fallback to local computation from an incomplete replica. Other derived views still use their local
builder once their input readiness predicate passes. None and Zones never wait. No registered source means the
existing local behavior. LocalSimHost registers nothing.

`markOverlayRendered` records only the supplied version actually uploaded by TerrainRenderer. `overlayStale`
does not acknowledge reads, so opening a legend or hovering first cannot swallow a refresh. Registrations and
rendered versions are per state; fresh replica adoption starts with empty caches and must register again.

## Moved sites

Before line numbers refer to `2ba03fa`; the right side names the new host call.

| Before | After |
|---|---|
| `src/game/CityScene.ts:297`, `attachOverlays(this.sim)` | `attachOverlays(this.host.sim)` (current line 298) |
| `src/game/CityScene.ts:452` / `:455`, traffic `getSystem` and `getSampleRoutes(max)` | `this.host.traffic.sampleRoutes(max)` (current line 459); the existing catch still returns an empty list |
| `src/game/CityScene.ts:464` / `:465`, emergency `getSystem` and `vehicles()` | `this.host.emergency.vehicles()` (current line 468) |
| `src/game/CityScene.ts:464` / `:465`, emergency `getSystem` and `incidents()` | `this.host.emergency.incidents()` (current line 468) |
| `src/game/CityScene.ts:465`, `this.sim.simTime()` | `this.host.simTime()` (current line 468) |
| `src/ui/Notifications.ts:78`, stale check against `news.length` | `this.ctx.host.newsSeq` (current line 77) |
| `src/ui/Notifications.ts:84`, record `st.news.length` | `this.ctx.host.newsSeq` (current line 83) |
| `src/ui/panels/AdvisorsPanel.ts:321`, news gate's `st.news.length` | `this.ctx.host.newsSeq` (current line 320) |

Additive subscription sites: the existing CityScene panel callback (before line 329; current 336), `setOverlay`
(before line 892; current 902) and `showQuery` (before line 945; current 954) now call `host.setView(this.view)`.
MiniMap's utility listener is new at line 80; it does not replace a query.

## Tests and gates

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `git diff --check` | PASS |
| `git diff --name-only -- src/sim src/save` | Only the explicitly authorized `src/sim/infra/overlays.ts` |
| `npx vitest run tests/infra/overlays.test.ts --maxWorkers=1` | BLOCKED before collection: Vite config loading fails with `spawn EPERM` (`externalize-deps`, `windowsSafeRealPathSync` / `optimizeSafeRealPathSync`). No tests ran. |
| New/updated test files below | Typechecked; not executed because of the same Vitest startup restriction |
| Full suite, fixed-seed screenshot diffs, browser QA, bot and old-save continuation | NOT RUN; lead gates |

New tests, by name:

- `tests/game/views.test.ts` / `W0.5 news sequence`:
  - `the ticker and Advisors news gate keep counting and displaying new items past 200`
  - `starts at a saved log, observes news before HUD listeners, and unsubscribes on city abort and host dispose`
- `tests/game/views.test.ts` / `W0.5 MiniMap utilities invalidation`:
  - `layerUpdated(utilities) marks the map dirty, repaints Power, and stops listening on city abort`
- `tests/worker/views.test.ts` / `W0.5 LocalSimHost views`:
  - `stable empty readers follow lazy boot, incidents, fleets, routes, utilities and the host clock`
  - `view reads and subscriptions leave the authoritative save and RNG unchanged`
- `tests/infra/overlaySources.test.ts` / `W0.5 derived sources`:
  - `supplied data wins over a cached local raster; only an upload acknowledges its version`
  - `missing worker rasters stay absent per resolved variant and return after a fresh-state resync`
  - `direct and main-built views wait for their inputs; None and Zones never wait`
  - `with no source every local view and variant retains its raster and legend`
- `tests/render/overlayReadiness.test.ts` / `W0.5 overlay readiness`:
  - `keeps tint off and legend loading until delivery, refreshes paused versions, and hides again on resync`
  - `direct subscribed layers enable the terrain and the renderer/fallback legends together`
- `tests/worker/viewSources.test.ts` / `W0.5 replica overlay seam`:
  - `every delivered view/variant matches the authoritative raster, and first-subscription/resync gaps stay absent`
- `tests/worker/hygiene.test.ts`:
  - `W0.5: CityScene reads system views through the host`

The news test renders 225 real simulation news events through both widgets, checks the retained length stays at
200, then emits a news event with unchanged item identity to prove the sequence independently invalidates both
widgets. The MiniMap test checks the actual Power pixel before/after the utility event and listener removal on abort.
These assertions have not yet run.

Lead reruns, one file per command with `--maxWorkers=1`: `tests/infra/overlays.test.ts`,
`tests/infra/overlaySources.test.ts`, `tests/render/overlayReadiness.test.ts`, `tests/worker/viewSources.test.ts`, `tests/game/views.test.ts`,
`tests/worker/views.test.ts`, `tests/game/panelsNews.test.ts`, `tests/worker/hygiene.test.ts`,
`tests/worker/localSimHost.test.ts`, `tests/worker/commands.test.ts`, `tests/game/cityTeardown.test.ts` and
`tests/game/cityDisposeCanvas.test.ts`, followed by the full suite. The correct B1 bot reference is **196,101 in
2015** for 128 × 15 seed 7, residents **[59,288, 95,301, 41,512]**, per NOTE-023.

## Hygiene and preserved behavior

The new active `systems` scan covers CityScene only. The existing W0.2 speed rule remains active. The broad W0.3
UI/game system-read rule, W0.4 liveSlowdown rule and W0.6 import-graph/replica-write rules remain under their own
lanes; none was prematurely enabled. No pre-existing W0.5 skipped rule was present to switch on.

Only LocalSimHost is instantiated. The city signal, guard holder, `abort('dispose')`, null views, command tags and
gestures are preserved. New news/reset listeners and the MiniMap utility listener are bound to the city's signal;
standalone hosts also release their listeners on disposal. The overlay hook adds no listeners. Other than the
authorized overlay seam, simulation and save implementation files are untouched.
The serialized-state test is a narrow read-side-effect regression, not a replacement for the bot or old-save gates.

## Design versus this tree

- **Overlay ownership:** resolved by the lead's explicit exception for `src/sim/infra/overlays.ts`.
- **News freshness:** this base already contains N2's `newsMark` identity fix, and AdvisorsPanel has a `gate('news', …)`
  rather than a field called `seenNews`. This lane replaces the remaining length terms with the host sequence and
  keeps the identity check for existing direct log-clear/replacement behavior. It does not claim the base still
  freezes at 200 under ordinary local news events.
- **Facade:** §2.9 describes a narrowed `SimFacade`, but this base still types `GameContext.sim` and other consumers
  as the full `Simulation`. Migrating those consumers requires files outside this row and the other in-flight W0
  work. `host.sim` therefore retains its existing W0 compatibility type; the new typed host readers are separate.
  No narrowed facade or worker host is claimed here.
- **Traffic routes:** the local system appends up to eight service routes beyond `max`. The local view delegates
  directly, preserving today's behavior; applying the replica's strict cached-list slice here would change it.
- **Replica integration:** W1.1a has stream data and loaded-layer bits but no playable replica host. The later host
  must bind `Replica.layerReady`, Emergency readiness and truck-stream availability to the optional readiness
  predicate, and re-register on `ReplicaHooks.adopt`. `tests/worker/viewSources.test.ts` demonstrates this binding
  without adding a second playable host or editing W1.1a's files.
- **Version field:** W1.1a's `RasterPatch` has `day`, not a delivery version. Same-day deliveries can differ, so the
  test adapter assigns a monotonic version per received patch object. The later host must likewise supply a delivery
  version; using `day` would freeze same-day updates. This is an adapter contract, not a protocol format change.
- **Subscription refresh handoff:** inspection of W1.1a's `ChangeRecorder.flush` shows that a forced view-switch
  layer delivery need not carry a `LayerUpdated` log entry. The future host must invalidate main-built raster caches
  and refresh the shown direct layer when applying such deliveries, as well as replaying logged layer events.
  `markOverlaysDirty` already provides cache invalidation; this lane does not change the protocol/replica files.
  The new loopback test covers first subscriptions and resync, not the later host's return-to-view refresh path.

The manual checks are in [qa-W0.5-views.md](../qa-W0.5-views.md). Acceptance/DONE still requires the lead-run gates.
