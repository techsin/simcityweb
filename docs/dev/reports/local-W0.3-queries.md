# W0.3 — queries and watches

## Review and gates (the local worker)

**The hygiene scope is settled (NOTE-028).** W0.3's rule "src/ui and src/game no longer call emergencyOf or
getSystem" covers all of src/ui and src/game. Its consumers are clear, but 20 reads remain in files outside W0.3's row,
and after W0.3-W0.5 merge 14 of them are left in 5 files:
- EmergencyBanner (7) and EmergenciesPanel (4);
- three upkeep-context reads: ListPanels.ts:220, toolCatalog.ts:146 and placement.ts:115.
The rule stays skipped in all three branches, renamed "W0.3b: …". The W0.3b lane converts those reads after the
merge and switches the rule on.

**Fixed in review.** Codex could not run vitest in its sandbox. One of its new tests failed:
`tests/game/queryReads.test.ts` gave DispatchTool a fake incident without `place`, and DispatchTool escapes
`inc.place` exactly as on the base. The fixture now has a `place`.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full) | **152 files passed, 1 skipped; 1,536 tests passed, 11 skipped**. Earlier, `tests/save/recovery.test.ts` failed once under load; it passes alone and in the rerun |
| `tests/worker/querySideEffects.test.ts` | passes: 120 days with every query and watch handler run daily give the same hash as 120 days without them |
| 128 × 15 seed-7 bot | **196,101** in 2015, the reference since B1 |
| Old saves load and continue | 6 of 6, every number identical to `2ba03fa`: load, 45 days, reload and round trip |
| Browser QA (Appendix A), the inspector screenshot diff, the leak probe | **pending**: browser runs wait until T014's speed reviewer is done with the machine |

The original Codex report follows. Its "uncommitted / not DONE" status is superseded by the section above.

Branch `local/W0.3-queries`, base `2ba03fa`. NOTE-023 acknowledged: the bot reference is B1's **196,101**
population in 2015, residents **59,288 / 95,301 / 41,512**, for 128×15 seed 7.

Implementation is uncommitted. **Not DONE:** the all-UI hygiene gate conflicts with the lane's file ownership;
runtime tests and browser gates remain unverified. The scope question was raised during the implementation.

## Implementation by file

| File | Change |
|---|---|
| `src/worker/queries.ts` (new) | Typed registry for all 18 protocol query names; argument keys, daily/monthly/change and budget watch signatures, plain advice copies, garage counts without `rt.ensureLists()`, exact-state digest. |
| `src/worker/inspect.ts` (new) | Building/cell inspector gathering and signatures, optional sections, resident providers/cohorts, traffic, crime, garbage, coverage and utility reports. Returns data, with formatting kept on main. |
| `src/worker/SimCore.ts` | Separate W0.3 block exposing synchronous `runQuery` and watch signatures, including lazy-boot invalidation. No stepping/order/policy edits. |
| `src/worker/SimHost.ts` | Typed `query`/`watch`, synchronous local evaluation, pending-read deduplication, per-argument caches, a 200 ms real-time watch cap and 1 s inspector refresh per key. Clones acks/query/watch results in dev/tests. Signal-bound watch helper and disposal. Separate minimal dispatch view block for the W0.5 merge. |
| `src/ui/panels/InfoPanel.ts` | Target/section-keyed watches, immediate state header, report-driven detail sections. Query demolition risks before confirmation; ignore replies after close/target change/abort. Existing historic and demolition command paths retained. |
| `src/ui/inspectorModel.ts` | Formats one building report's facility, condition, desirability, needs/providers and pyramid. Keeps the cloned downtown-stage field out of generic rows. |
| `src/ui/panels/StatsPanel.ts` | Daily garage watch; disposes on close. |
| `src/ui/panels/AdvisorsPanel.ts` | Monthly issue watch and existing 3 s fresh-advice policy through queries; ignore obsolete responses and dispose on tab/close. No `seenNews` hunks. |
| `src/ui/panels/DemographicsPanel.ts` | Daily tourism/attractiveness watches on the Tourism tab; unserved-cluster query on click, guarded against leaving the tab/city. |
| `src/ui/TopBar.ts` | Cap-hint watch while the popover is open; cap-transition toast reads through a deduplicated one-shot query. |
| `src/ui/panels/BudgetPanel.ts` | Forecast watch, including paused budget changes; dispose on close. W0.6 fallbacks retained. |
| `src/game/tools/PlopTool.ts` | Garage-stop/ferry-partner queries cached per placement key; clears the displayed result when keys change and rejects obsolete callbacks. |
| `src/game/tools/DispatchTool.ts` | Options watch, station-route query cache, incident report on click; target/hover/lifetime guards. Synchronous incident/vehicle reads use the minimal host view. W0.2's dispatch tag and cause handling remain. |
| `src/game/tools/ZoneTool.ts` | Bulldoze/side-demolition queries before confirmation; cancellation guards and retention of the released stroke's gesture through the query/dialog/ack. Hover cut preview unchanged. |
| `src/game/tools/NetworkTool.ts` | Side-demolition query before confirmation, including added-path utility semantics; same gesture/cancellation handling. Hover cut preview unchanged. |
| `tests/worker/queries.test.ts` (new) | Local transport, clone/alias/error behavior, argument caches, real-time cadence, paused budget refresh, disposal and exact digest coverage. |
| `tests/worker/querySideEffects.test.ts` (new) | Two deterministic 120-day runs; query/watch run executes every handler daily, current buildings at sampled lots, sampled cells, every inspector section and service tier. Compares daily full-save SHA-256 hashes and RNG with the no-read run, and checks each read batch leaves state/RNG unchanged. Includes real medical incidents/routes. |
| `tests/game/queryReads.test.ts` (new) | Immediate headers, target-safe reports, late inspector/tool replies, pending placement deduplication, released-gesture settlement and cancellation. |
| `tests/game/queryHost.ts` (new) | Immediate cloned query fixture for existing presentation tests. Real cadence is tested separately against LocalSimHost. |
| `tests/game/cityTeardown.test.ts` | Inspector fixture gains the query seam; city signal remains the listener lifetime. |
| `tests/game/inspectorRetention.test.ts` | Inspector fixture gains queries and city signal. |
| `tests/game/thumbsPendingRetention.test.ts` | Inspector fixture gains queries and city signal; toolbar case unchanged. |
| `tests/game/uiFireHint.test.ts` | Inspector fixture gains queries and city signal. |
| `tests/game/uiRuins.test.ts` | Inspector fixture gains queries and city signal. |
| `tests/game/dispatchBusy.test.ts` | Hover fixture gains query/view seam and city signal. |
| `tests/game/panelCommands.test.ts` | Budget command fixture also supports forecast watches; delayed command tests retained. |
| `tests/game/toolsPreview.test.ts` | Preview fixture gains queries and city signal. |
| `tests/game/uiCutSettle.test.ts` | Query fixture; release checks await the query microtask with the tool selected. |
| `tests/game/uiNetworkCutSettle.test.ts` | Same adaptation for the network release check. |
| `tests/worker/hygiene.test.ts` | Enables the W0.3 system-read rule without scanner exemptions or skip. Known out-of-scope violations remain below. |
| `docs/dev/qa-W0.3-queries.md` (new) | Appendix A browser checklist, every converted panel/tab/tool, inspector screenshot comparisons and lifecycle/cadence checks. |
| This report | File inventory, original sites, verification and step boundaries. |

No files under `src/sim`, `src/save` or `src/render` were edited. CityScene, context, protocol, recorder,
replica, loopbackCore and W0.5's AdvisorsPanel news counter were not edited.

## Every moved read site

Line numbers below are from **2ba03fa**, before this change. `watchFor` calls `host.watch` and binds disposal
to `ctx.signal`. `IB` means `host.watch('inspectBuilding', {id, sections}, 'change')`; `IC` means
`host.watch('inspectCell', {x, z, sections}, 'change')`.

| Original site | Host call / resulting report read |
|---|---|
| `InfoPanel.ts:162`, `:203` | IC signature / IB and IC runtime lookup now inside `inspect.ts`. |
| `InfoPanel.ts:347` facilityReport | IB → `facility`, formatted by `buildingReportView`. |
| `InfoPanel.ts:362`, `:369` | IB → `waterRequired`, `needsExpectation`. |
| `InfoPanel.ts:399`, `:400`, `:402` | IB → `condition`, `desirability`, `growth`. |
| `InfoPanel.ts:409` traffic lookup | IB resolves the traffic system internally. |
| `InfoPanel.ts:411`, `:412`, `:413` | IB → `landValue`, `desirabilityValue`. |
| `InfoPanel.ts:422`, `:425`, `:429`, `:433` | IB → `workerAccess`, `jobFill`, `customers`, `freightAccess`. |
| `InfoPanel.ts:441`, `:453` | IB → full-record `building.health`, `building.age`. Header occupancy/flags remain on state. |
| `InfoPanel.ts:472` | IB → `needs`. |
| `InfoPanel.ts:485`, `:496` | IB → `route`, `commute`. |
| `InfoPanel.ts:510`, `:514`, `:515`, `:516` | IB → growth limits, land-value terms/value and crime terms. |
| `InfoPanel.ts:532`, `:543`, `:545` | IB residents section → provider data/load; direct building walk replaces runtime list mutation. |
| `InfoPanel.ts:573` | IB residents section → cohort shares and full-record population, formatted by inspectorModel. |
| `InfoPanel.ts:591`, `:595`, `:597`, `:601`, `:604`, `:611` | IB/IC environment → noise/air/water pollution, soil, garbage report/level, tap water and emergency responses. |
| `InfoPanel.ts:625`, `:626`, `:627`, `:629`, `:630`, `:631`, `:632`, `:633`, `:635`, `:636`, `:637` | IB/IC environment → police/fire/health/education/play/green/transit/shop coverage and parking. |
| `InfoPanel.ts:641`, `:643`, `:644` | IB/IC environment → utility lookup, gridInfo and waterInfo. |
| `InfoPanel.ts:703` | `host.query('demolishRisks', {rect, cost, sandbox})`. |
| `InfoPanel.ts:737`, `:742`, `:743` | IC → road report, noise and air. |
| `InfoPanel.ts:770`, `:779`, `:784`, `:786` | IC → empty-zone status, landfill report/fill, land value. |
| `InfoPanel.ts:789`, `:796`, `:799`, `:802`, `:803`, `:809` | IC → desirability values/best fit, desirability/growth/land-value breakdowns and front-cell coverage. |
| `StatsPanel.ts:44`, `:46`, `:52` | `host.watch('garageStates', {}, 'daily')`; no runtime `ensureLists`. |
| `AdvisorsPanel.ts:221` | `host.query('openAdvice', {})`, under the existing refresh throttle. |
| `AdvisorsPanel.ts:230`, `:235` | `host.watch('advisorIssues', {}, 'monthly')`; readiness fallback moves into its handler. |
| `DemographicsPanel.ts:231` | `host.query('unservedClusters', {tier, max: 1})`. |
| `DemographicsPanel.ts:252`, `:258` | `host.watch('tourismSummary', {}, 'daily')` and `host.watch('attractivenessBreakdown', {}, 'daily')`. |
| `TopBar.ts:236`, `:279`, `:471` | `host.watch('capHints', {}, 'daily')` supplies the popover. |
| `TopBar.ts:318` | `host.query('capHints', {})` supplies the newly capped family's toast while the popover is closed too. |
| `BudgetPanel.ts:386`, `:389`, `:408` | `host.watch('computeMonthlyBudget', {}, 'daily')` replaces forecast evaluation/cache; budget changes invalidate it. |
| `PlopTool.ts:113` | `host.query('stopsNear', {x, z, w, d})`. |
| `PlopTool.ts:119` | `host.query('ferryPartnersFor', {x, z, w, d, rot})`. |
| `DispatchTool.ts:185`, `:191` | `host.watch('dispatchOptions', {incidentId}, 'daily')`. |
| `DispatchTool.ts:246`, `:249` | `host.query('routePreview', {incidentId, stationId})`. |
| `DispatchTool.ts:306`, `:312` | `host.query('emergencyReport', {x, z})` on site click; ordinary read view is `host.emergency`. |
| `DispatchTool.ts:89`, `:146`, `:168`, `:181`, `:201`, `:288` | `host.emergency` incident/list/vehicle/station read methods (minimal W0.5 view seam). |
| `ZoneTool.ts:250` | `host.query('demolishRisks', {rect, cost, sandbox})`. |
| `ZoneTool.ts:257` | `host.query('sideDemolishRisks', {ids, fee, sandbox})`. |
| `NetworkTool.ts:194` | `host.query('sideDemolishRisks', {ids, fee, sandbox, add})`. |

`InfoPanel.ts` and panel names above are under `src/ui/panels`, except `TopBar.ts` under `src/ui`;
tool names are under `src/game/tools`. inspectorModel had no system lookup of its own; it now receives the
watch DTO through `buildingReportView` rather than data gathered by the panel.

## Hygiene scope conflict

Enabled exactly **“W0.3: src/ui and src/game no longer call emergencyOf or getSystem”**. The scanner still
covers both complete directories; it has no new exemptions. All explicit W0.3 consumers are clear of these calls.
The following **20 existing call sites in six unowned files** still violate the activated rule:

| File | Original/current lines | Step boundary |
|---|---|---|
| `src/game/CityScene.ts` | 452, 464 | W0.5 views/render seams. |
| `src/ui/EmergencyBanner.ts` | 761, 826, 867, 892, 960, 968, 1002, 1031, 1086, 1101, 1337 | W0.4 policy and W0.5 views. |
| `src/ui/panels/EmergenciesPanel.ts` | 32, 79, 97, 167 | Appendix A assigns EmergencyView; absent from W0.3's named consumers. |
| `src/game/toolCatalog.ts` | 146 | Upkeep context uses economy runtime / `ensureLists`; absent from the query table. |
| `src/game/tools/placement.ts` | 115 | Placement upkeep uses the services need raster; absent from the query table. |
| `src/ui/panels/ListPanels.ts` | 220 | Rewards upkeep uses economy runtime; absent from the query table. |

The instruction to make the whole rule pass cannot be met while also leaving these files untouched. The lead
needs to assign the uncovered reads and coordinate the two parallel lanes. No temporary system getter,
scanner exception, weakened assertion or unrelated file edit was used to hide this conflict.

## Design/code differences and merge boundaries

1. **DispatchTool needs part of W0.5's view now.** Appendix A requires EmergencyView for its synchronous
   incident/vehicle/station reads, in addition to W0.3's three query paths. SimHost contains an isolated
   `DispatchView`/`emergency` block exposing only those five read methods, with null/empty fallbacks. W0.5 should
   replace this subset with its complete EmergencyView; no EmergencySystem mutation methods escape.
2. **Advisor lazy places are already resolved by the public helpers.** `placed()` is private in advisors.ts;
   both public APIs resolve locations. The handler copies the resulting data fields, never a callback. The
   pre-first-month fallback remains a fresh scan, now inside the `advisorIssues` handler.
3. **The growth report has a non-enumerable field.** `growthLimits().downtownStage` would disappear during
   structuredClone. The inspector DTO makes it enumerable; inspectorModel excludes it from generic rows so
   it still appears only through the existing downtown-limiter wording.
4. **TopBar also uses cap hints for closed-popover toasts.** Those use a one-shot query; the daily watch runs
   only while the popover is open. Removing this extra consumer would lose existing toast content.
5. **Release queries make existing confirmations asynchronous before the dialog.** Zone/network tools capture
   and track the original gesture, not a later stroke. Replies after cancel, tool/target changes or city abort
   cannot commit. Failed risk queries surface an error instead of treating an unavailable report as permission
   to demolish. The ordinary warning/confirmation and command paths are unchanged.
6. **WatchHandle was not concretely defined in the base.** The added contract supplies `value`, `error`, `version`,
   `setArgs`, signal-bound `subscribe` and `dispose`. Caches hold at most 64 argument keys per handle. Local
   evaluation is synchronous; query Promises settle in the usual microtask. A command/day change prevents
   reuse of an older pending query result (R3).
7. **Lazy pre-boot helpers are a purity boundary to review.** Existing helpers such as `capHints` call
   `econData`, which initializes/normalizes missing `systemData.economy`. Their normal initialized-simulation
   path is exercised by the 120-day test; purity before `host.ready` is not established. No sim-file rewrite,
   save/restore wrapper or cloned simulation was introduced to conceal such helper behavior.
8. **Other lanes remain intact.** W0.4 LivePolicy is untouched. W0.5's `seenNews` counter is untouched. W0.6 owns
   BudgetPanel's remaining fallbacks and the facade/save boundary. SimCore and SimHost additions are grouped
   and marked W0.3; their imports and shared class declarations will still need ordinary merge integration.

## Tests and verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Passed after production and test edits. |
| `git diff --check` | Passed after cleanup. |
| Restricted-directory diff | Empty for `src/sim`, `src/save`, `src/render`. |
| `npx vitest run tests/game/inspectorModel.test.ts --maxWorkers=1` | Startup failed: Vite `externalize-deps` / `windowsSafeRealPathSync` / `optimizeSafeRealPathSync`, `spawn EPERM`. No test executed. |
| `npx vitest run tests/worker/queries.test.ts --maxWorkers=1` | Same startup `spawn EPERM`; no test executed. |
| W0.3 hygiene | Enabled without exceptions; the 20 out-of-scope sites above remain. AST test execution blocked with Vitest. |
| Runtime query side effects / cloning / existing test regressions | Tests written and typechecked; not executed. |
| Full suite, bot, old-save continuation, browser QA, inspector screenshot diff | Not run here; lead environment required. The population reference above is a required result, not a result measured on this diff. |

New suites by name:

- `tests/worker/querySideEffects.test.ts`: **query side effects** — “120 deterministic days with every
  query/watch handler, sampled buildings/cells and every section equal 120 days with no reads”. Daily hashes,
  RNG and read-batch hashes must match; every registry entry must execute at least 120 times, and real routes
  must be observed. Warnings/errors are failures.
- `tests/worker/queries.test.ts`: **LocalSimHost queries and watches** — immediate evaluation, pending dedup,
  read-after-command/tick; daily/monthly/change 5 Hz caps; target/section caches and inspector 1 Hz; paused
  budget invalidation; cloned acknowledgements/results without state aliases; DataCloneError reporting;
  abort/disposal. **verify exact state** — excludes lagged fields/derived rasters, includes exact state.
- `tests/game/queryReads.test.ts`: **query consumers** — immediate new header and no previous report;
  demolition replies after close/target/abort; gesture settlement through query/ack; cancel while pending;
  placement-key dedup and late placement replies; obsolete dispatch routes/site-click replies.

Run each via `npx vitest run <file> --maxWorkers=1`. Existing gates and regressions to run:

- `tests/game/inspectorModel.test.ts`, `tests/game/inspectorNotes.test.ts`.
- `tests/worker/hygiene.test.ts`, `tests/worker/localSimHost.test.ts`, `tests/worker/simCore.test.ts`,
  `tests/worker/commands.test.ts`.
- `tests/game/dispatchCommands.test.ts`, `tests/game/dispatchBusy.test.ts`, `tests/game/toolCommands.test.ts`,
  `tests/game/toolsPreview.test.ts`, `tests/game/quakeShakePlop.test.ts`, `tests/game/panelCommands.test.ts`.
- `tests/game/uiCutSettle.test.ts`, `tests/game/uiNetworkCutSettle.test.ts`, `tests/game/uiFireHint.test.ts`,
  `tests/game/uiRuins.test.ts`, `tests/game/cityTeardown.test.ts`, `tests/game/cityDisposeCanvas.test.ts`,
  `tests/game/inspectorRetention.test.ts`, `tests/game/thumbsPendingRetention.test.ts`.

Manual handoff: [W0.3 browser QA](../qa-W0.3-queries.md). Resolve the scope conflict and complete the runtime,
bit-identity, old-save and screenshot gates before marking W0.3 DONE.
