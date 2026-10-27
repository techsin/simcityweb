# local-W0.3b-reads — remaining display reads and fix round A–H

Branch `local/W0.3b-reads`. Original integration base: `93069fa`; this fix round starts from **7969951**.
**Implementation complete; fix-round changes are uncommitted.** TypeScript and whitespace checks pass.
Vitest cannot collect tests here: Vite's Windows path resolver fails with `spawn EPERM`. Runtime acceptance,
full suite, bot, old-save continuation, browser comparisons and performance measurements remain for the lead.
The lead reported that the provisional W0-complete suite failed on A and the separately fixed W0.6 hygiene rule;
that is the lead's baseline result, not a passing run of this diff.

## Findings addressed

- **A — null upkeep chip:** the paused ruin/upkeep regression uses `civ_mayor_house`, which actually has an
  upkeep chip, and pins **§50/mo** before/after ruin and removal. `rw_missile_range` has no upkeep chip.
- **B — cursor price:** PlopTool calls `host.query('upkeepContext', args)` with the placement request/key guards.
  Its single-entry memo is keyed by placement, command count and day. Revisiting a lot reads the latest raster;
  local replies repaint in a microtask before paint. Removed the upkeep watch and listener, the accepted
  200 ms city-wide fallback, and stale per-lot cache expectations. No camera-save-driven resting-tip repaint.
- **C — dispatch performance/policy:** signatures append O(1) vehicle count/last id, station version, graph
  epoch, incident state and unit count/last id to the requested policy and command count. No station array is
  built or serialized per frame. Monthly watches retain monthly policy. Moved `DispatchOptionsWatches` into
  `src/ui/dispatchOptions.ts`; banner and Active tab lease the same per-host, per-incident watch. Closing either
  releases only its lease; the last release or city abort disposes the watch.
- **D — ruin performance:** catalog definitions and Rewards use the same single-pass standing/ruin index,
  memoized by `(buildings.size, nextBuildingId, day, commandCount)` and map identity. An O(1), city-bound
  `buildingChanged` listener invalidates relevant Plopped/Burnt changes within a day; power-only/growable
  updates do not rescan. `disabledOf` receives this index instead of walking buildings per definition.
- **E — immediate dispatch:** command-count changes bypass the cap for dispatch-options watches. Reads after
  `await act('dispatchBest').done` see fresh options; the regression requires fresh availability immediately
  and at 199 ms. Simulation-driven fleet changes retain the normal 200 ms cap.
- **F — missing funding:** `upkeepFunding` uses `st.budget?.funding?.[service]`, preserving the former default
  of 1. Tests cover absent budget and funding without state repair. The design/code caveat is recorded below.
- **G — hygiene:** the enabled systems gate also rejects named imports (including aliases), default imports
  using the prohibited names, and `getSystem`/`systems` member accesses on a `sim` chain. Added negative and
  positive scanner self-tests. **The replica rule is unchanged**, leaving W0.6's independent fix untouched.
- **H — documentation/QA:** corrected the price/cadence descriptions, enumerated the player-visible changes,
  removed the paused-return claim, and added DispatchTool, shared-watch performance and ruin-scan checks.

Nits: price tests say **hand-derived**, the uiRuins header describes mirrored flags, the banner's answerable
comment describes delivered options, query imports are grouped, and PlopTool imports query types through
SimHost's re-export. Ruin tie-breaking is documented below.

## Approved scope and design/code differences

1. The original inventory called three sites upkeep reads. `ListPanels.ts:220` and `toolCatalog.ts:146`
   actually read `rt.plopped`/`ensureLists` for standing/ruin status. The lead approved both reading mirrored
   `ctx.state` building flags (`EXACT_FIELDS`), with no query. Their upkeep chips/cards already use replica data.
2. `placement.ts:115` was the real services need-raster read. The lead approved minimal changes to its
   **PlopTool caller** and the **protocol.ts query-name union** for `upkeepContext`. The protocol hunk is already
   in 7969951 and unchanged this round; T032 owns later protocol work. Appendix A names all five original files,
   `upkeepContext`, both mirrored ruin checks and the two approved extra files.
3. WORKER_DESIGN's replica-safe list (line 553 before this round) includes `econData(st).regionTerms`, but
   **econData writes** during initialization/normalization. This is harmless in the real upkeep path because
   its raster exists only after econData initialized. The query's funding arithmetic remains read-only and
   preserves the old curve/defaults; the design now records the initialization caveat.
4. The original W0.3b watch choice broke the base cursor behavior. The design now specifies one-shot placement
   queries and a single current-placement memo. It also records the user-approved EM-1 command exception to
   the blanket 5 Hz dispatch-watch cap. Returning units change availability **only while the sim advances**;
   commands can change availability while paused.
5. The new O(1) signature reads the existing private `stVer`/`gEpoch` counters through a narrow read-only type
   inside `queries.ts`. These counters never cross the host boundary; no simulation file or public system API
   was changed. This internal coupling must track future emergency-system refactors.
6. The first ruin is selected in mirrored Map insertion order. The old economy plopped list uses swap-remove,
   so after unrelated removals a multi-ruin definition may focus a different ruin. Keeping its private order
   would reintroduce a system dependency; both status and upkeep stay the same. A test pins mirrored order.

Player-visible changes from 93069fa: the **Send label, ordering and pill** follow returning-unit availability;
**DispatchTool repaints on same-day fleet changes**; pending options use **Loading… / Loading dispatch options…**;
Send nearest without an emergency system reports **Emergency services unavailable**. The fix round restores
spot upkeep on rapid lot changes and fresh dispatch availability after commands. City-wide, flat, marginal and
full-use formulas are unchanged; the accepted city-wide fallback applies only when the query returns null.

## Change per file

| File | Final change (fix round unless marked inherited) |
|---|---|
| `src/game/tools/PlopTool.ts` | Replace upkeep watch/listener with guarded queries and a single-entry memo; SimHost type re-export. |
| `src/game/tools/placement.ts` | Optional budget/funding access; inherited pure state/raster marginal-upkeep helper retained. |
| `src/game/toolCatalog.ts` | Pass the shared ruin index to `disabledOf`; no per-def building scan. |
| `src/ui/ruinState.ts` (new) | Single-pass index, epoch memo, relevant flag invalidation and signal-bound teardown. |
| `src/ui/panels/ListPanels.ts` | Rewards uses the shared memo; re-export the existing pure ruin helper/types. |
| `src/ui/dispatchOptions.ts` (new) | Shared per-host incident watches with owner leases and city lifetime. |
| `src/ui/EmergencyBanner.ts` | Import the shared UI helper; correct answerable comment; inherited seven view/query migrations retained. |
| `src/ui/panels/EmergenciesPanel.ts` | Import the shared helper; inherited four view/query migrations retained. |
| `src/worker/SimHost.ts` | Expose read-only command count; dispatch-only cap bypass; move UI helper out. Query deduplication and cloning unchanged. |
| `src/worker/queries.ts` | O(1) dispatch signature plus normal policy; grouped imports; inherited upkeep handler retained. |
| `src/worker/protocol.ts` | Inherited `upkeepContext` query-name member; no fix-round diff. |
| `tests/game/upkeepReads.test.ts` | A fixed, literal §50 chip pin, truthful formula-test names and mirrored flag delivery. |
| `tests/game/queryReads.test.ts` | Real-host rapid-lot prices, single-entry invalidation, no idle repaint, late reply guards, same-day DispatchTool repaint. |
| `tests/game/ruinState.test.ts` (new) | One scan shared across all unique defs/Rewards, epoch/flag invalidation and mirrored ruin ordering. |
| `tests/game/queryHost.ts` | Fixture exposes events and command count for the shared memo. |
| `tests/game/uiRuins.test.ts` | Mirrored-state header; flag mutations emit the corresponding delivery events. |
| `tests/game/toolsPreview.test.ts` | Existing price assertions await the local query microtask with the tested tool active. |
| `tests/game/emergencyBanner.test.ts` | Synthetic behind-the-system fleet changes also publish a revision. |
| `tests/game/emergenciesPanelBusy.test.ts` | Synthetic busy/free fixture publishes matching revisions. |
| `tests/worker/emergencyReads.test.ts` | Shared leases, immediate dispatch including 199 ms, O(1) revisions and monthly-policy coverage. |
| `tests/worker/upkeepContext.test.ts` | Remove stale/fallback watch pins; test fresh one-shot results and missing budget/funding; retain cache/clone/purity coverage. |
| `tests/worker/hygieneScan.ts` | Strengthen only the systems rule plus its sim-chain helper. |
| `tests/worker/hygiene.test.ts` | Alias/member/import self-tests; W0.3b gate stays enabled. |
| `tests/worker/querySideEffects.test.ts` | Inherited upkeep queries/watches remain in every deterministic daily read batch; no fix-round diff. |
| `tests/game/toolsPlacement.test.ts` | Inherited query-based real service-pass/budget parity coverage retained; no fix-round diff. |
| `docs/WORKER_DESIGN.md` | Query/cap policy, initialized-economy caveat, W0.3b row and Appendix A corrected. |
| `docs/dev/qa-W0.3b-reads.md` | Base comparisons, every upkeep list/tool, DispatchTool, immediate dispatch and performance checks. |
| This report | A–H disposition, site map, changed files, tests and limits. |

LocalSimHost stays the only host. SimCore, simulation implementations, saves, rendering, the guard holder,
`abort('dispose')`, null views and command tags/gestures are untouched. New subscriptions use the city's signal.

## Every original site: 93069fa line → current line

| File | Before → after | Mechanism |
|---|---|---|
| `src/ui/EmergencyBanner.ts` | 625 → 629 | Policy incident through EmergencyView. |
| same | 702 → 707 | Jump target through the view. |
| same | 710 → 715 | Dispatch feedback through view/fresh options. |
| same | 763 → 766 | Incident/vehicle text through view; Send uses shared options. |
| same | 818 → 824 | Ordering through view/options. |
| same | 833 → 839 | Layout through the view. |
| same | 1098 → 1103 | Tick/pill through view/options. |
| `src/ui/panels/EmergenciesPanel.ts` | 32 → 31 / 124 | View/options passed to dispatchBlocked by the Active row. |
| same | 79 → 84 | Active/readiness through the view. |
| same | 97 → 102 | Active incidents through the view; host clock at 104. |
| same | 167 → 174 | Fleet through the view. |
| `src/ui/panels/ListPanels.ts` | 220 → 198 | Shared mirrored ruin index at `src/ui/ruinState.ts:27`. |
| `src/game/toolCatalog.ts` | 146 → 147 | Shared mirrored ruin index passed to disabledOf. |
| `src/game/tools/placement.ts` | 115 → `src/worker/queries.ts:33` | Services read in upkeepContext; pure servedHere input at placement.ts:126. |

Supporting caller: `PlopTool.ts:245` at 93069fa → current **263**; fix-round upkeep helper **202 → 201**.
The UI helper moved from `SimHost.ts:47` at 7969951 to `src/ui/dispatchOptions.ts:7`. Protocol's approved union
addition remains at `protocol.ts:23`. No additional system-read sites were introduced.

## Tests and verification

- **Passed:** `npx tsc --noEmit`; `git diff --check`.
- **Source search:** no emergencyOf/getSystem imports/calls or sim-chain systems members in src/ui/src/game.
- **Attempted this round:** `npx vitest run tests/game/upkeepReads.test.ts --maxWorkers=1` and
  `npx vitest run tests/worker/hygiene.test.ts --maxWorkers=1`. Both fail before collection at Vite
  `externalize-deps` → `optimizeSafeRealPathSync` / `windowsSafeRealPathSync`: **spawn EPERM**.
- **Not verified here:** runtime assertions (including the expanded hygiene scan), full Vitest, performance
  timings, screenshot/browser checks, old saves, and the bot. No sandbox workaround or runner change was made.
  **196,101 in 2015** is the required 128×15 seed-7 reference, not a measured result of this diff.

Focused tests by name (written/typechecked; runtime pending):

- `upkeepReads.test.ts`: **keeps both ruin checks and their upkeep values current from exact mirrored flags
  while paused**; **keeps every ploppable card and reward upkeep chip on the same city-wide or flat values**;
  hand-derived typical/full-use and 11 cursor-family pins; school coverage/funding/road/raster pins.
- `queryReads.test.ts`: **shows spot upkeep on every lot reached within 200 ms using LocalSimHost**;
  **ignores a pending upkeep reply after %s** (leave/deactivate/abort);
  **ignores an upkeep reply for an earlier lot, including a later revisit to that key**;
  **repaints DispatchTool stations on same-day fleet changes**. Its fleet event is synthetic; the host/watch
  cap is real. Existing inspector, placement, route and command-gesture regressions remain.
- `ruinState.test.ts`: **shares one scan across unique defs, flyout checks and repeated Rewards reads until
  the epoch changes**; **refreshes burnt flags inside a day and keeps the first mirrored ruin when several
  share a def**. Scan counts are structural checks on 5,000 extra buildings, not a wall-time benchmark.
- `emergencyReads.test.ts`: **shares banner/panel watches and reflects a paused dispatch immediately, inside
  the 5 Hz cap**; **uses constant-time fleet revisions and preserves the requested monthly policy**.
- `upkeepContext.test.ts`: **keys pending queries by every argument and clones query and watch results in
  tests**; **queries the latest services and funding values without waiting for the watch cap or a new day**;
  **defaults to full funding when %s is missing without repairing the state**; old/missing/partial/v1/strike
  economy parity over 0/50/100/150/NaN funding; null definition/tier/raster/infrastructure fallbacks.
- `hygiene.test.ts`: **finds system imports with aliases and method/array references on sim chains**;
  **allows host views, sim events and unrelated systems properties**; the active W0.3b rule below.
- `querySideEffects.test.ts`: **120 deterministic days with every query/watch handler, sampled buildings/cells
  and every section equal 120 days with no reads**, including upkeep (inherited unchanged).
- Retained presentation/parity files to run individually: `toolsPreview.test.ts`, `toolsPlacement.test.ts`,
  `uiRuins.test.ts`, `emergencyBanner.test.ts`, `emergenciesPanelBusy.test.ts`; also `worker/queries.test.ts`
  for the unchanged cap behavior of other queries.

Formula pins include school cursor **132**, **102**, **90.46716620017375**, **72** for new need, half coverage,
50% funding and no road, and typical/full-use school **§230/§972**. They are hand-derived expectations from the
unchanged formulas, not observations from an executed 93069fa comparison.

**Hygiene enabled:** `W0.3b: src/ui and src/game no longer call emergencyOf or getSystem` was switched
`it.skip → it` with the NOTE-028 comment removed in 7969951. This round strengthens its scan with no exemptions.
No other hygiene gate is enabled/disabled here; W0.6's replica rule is untouched. Runtime passage remains pending.

Manual handoff: [qa-W0.3b-reads.md](../qa-W0.3b-reads.md). Run the listed single files, full suite, bot, old-save
continuation and browser/performance comparisons in the lead environment. Leave these fixes uncommitted.
