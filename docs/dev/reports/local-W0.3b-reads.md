# local-W0.3b-reads — remaining display reads (NOTE-028)

Branch `local/W0.3b-reads`, base `93069fa`. **Implementation and documentation complete; changes uncommitted.**
All 14 system reach-ins have moved and the W0.3b hygiene rule is enabled. TypeScript and whitespace checks pass.
Runtime acceptance remains pending: Vitest cannot load its configuration in this sandbox (`spawn EPERM`).
No full-suite, bot, old-save or browser result is claimed.

## Approved scope and design/code differences

- The base inventory called three sites upkeep-context reads, but `ListPanels.ts:220` and `toolCatalog.ts:146`
  actually gather standing/ruined buildings from `rt.plopped`, calling `rt.ensureLists()`. The lead explicitly
  approved reading both ruin checks from mirrored `ctx.state` building flags. `flags` is in `protocol.ts`
  `EXACT_FIELDS`; no query is needed. Their upkeep chips/cards already use mirrored city statistics.
- `placement.ts:115` is the real upkeep read, `services.needRaster(tier)`. Its caller is `PlopTool.ts:245`,
  and the typed handler registry is checked against `protocol.ts`'s wire `QueryName`. The lead explicitly
  approved minimal, self-contained edits to **both PlopTool and protocol**. PlopTool gains only its upkeep
  watch/lifetime handling; protocol gains only the `upkeepContext` query-name member. **T032 owns later
  protocol work.** These decisions are recorded in Appendix A and the W0.3b row.
- The old placement helper called `fundingFactor → serviceEffectiveness → econData`, which can initialize or
  normalize economy data during a read. A small read-only funding calculation preserves its curve, strike
  handling, old-version defaults and partial-v1/non-finite fallback without those writes. Regression cases
  compare it with the former funding helper on a separate state. No simulation implementation was changed.
- Dispatch options cannot be invalidated only by sim day: dispatches and returning units change availability
  while paused. The isolated signature block includes command sequence, incident state/units and fleet data;
  §2.8 now records this exception under the existing 5 Hz cap.

## Change per file

| File | Change |
|---|---|
| `src/ui/EmergencyBanner.ts` | Seven reach-ins become `EmergencyView` reads and incident-keyed dispatch-options watches. Preserve policy, commands, docking and press guards; refresh replaced incident records, including terminal text; prune/dispose watches. |
| `src/ui/panels/EmergenciesPanel.ts` | Four reach-ins become view/watch reads; clock uses host time. Active rows use current incident records; watches stop on tab change, close or city abort. Fleet/Statistics values and formatting stay unchanged. |
| `src/ui/panels/ListPanels.ts` | Ruin status reads exact mirrored buildings without `ensureLists`; upkeep chips remain on their existing model. |
| `src/game/toolCatalog.ts` | Unique-building disabled text reads mirrored `BF.Plopped`/`BF.Burnt` flags; remove the economy-runtime helper/imports. Catalog upkeep stays unchanged. |
| `src/game/tools/placement.ts` | Existing marginal-upkeep arithmetic takes state and a need raster explicitly. Replace the mutating funding helper with equivalent read-only arithmetic; reach, capacity, coverage, whole-lot and price formulas stay unchanged. |
| `src/game/tools/PlopTool.ts` | Small upkeep-only caller change: one argument-keyed, city-bound change watch; repaint the active tool's current footprint on delivery, dispose on leave/deactivate/abort. |
| `src/worker/queries.ts` | Isolated `upkeepContext` handler and registry entry; services raster stays on the sim side, result is `{here: number \| null}`. Separate same-day dispatch signature block. |
| `src/worker/SimHost.ts` | Isolated `DispatchOptionsWatches` helper binds per-incident watches through `watchFor` and prunes/disposes them. Existing query cache, watch cache and `cloneResult` are reused unchanged. |
| `src/worker/protocol.ts` | Only the `upkeepContext` union member. |
| `tests/worker/hygiene.test.ts` | Enable W0.3b's all-UI/game system-read gate; remove the NOTE-028 skip comment. |
| `tests/worker/querySideEffects.test.ts` | Run `upkeepContext` queries and watches for running-cost families, flat/missing definitions and roadless sites in every daily read batch. Full-save hashes/RNG still compare against the no-read run. |
| `tests/worker/upkeepContext.test.ts` (new) | Every argument participates in caching; query/watch clone boundaries; paused commands/day refresh; city disposal; pure missing/old/partial economy reads; null fallbacks. |
| `tests/worker/emergencyReads.test.ts` (new) | Direct-system/query option equality, per-incident watch reuse, paused dispatch/return updates, cap and disposal. |
| `tests/game/upkeepReads.test.ts` (new) | Literal base-price pins, all visible upkeep cards/reward chips, marginal-cost pins for 11 definitions, funding/coverage/fallback pins, and both ruin checks with replaced mirrored records. |
| `tests/game/queryReads.test.ts` | Current-footprint upkeep, cache reuse, paused funding repaint, leave/deactivate/abort and reactivation coverage. |
| `tests/game/toolsPlacement.test.ts` | Existing upkeep regression cases now enter through the query; direct served-person checks pass an explicit raster. Preserve real service-pass/budget comparisons and deep-lot assertions. |
| `tests/game/toolsPreview.test.ts` | The existing fire-price reference enters through `upkeepContext`; all cursor wording assertions remain. |
| `tests/game/emergencyBanner.test.ts` | Existing fixture gains the host query/view seam; private options fixture uses watch version. Existing behavior assertions remain. |
| `tests/game/emergenciesPanelBusy.test.ts` | Existing busy/free regression uses the seam; add replaced-view-record and watch-lifetime coverage. |
| `docs/WORKER_DESIGN.md` | §2.8 query/policy rows, §6 W0.3b row, and Appendix A's five files, exact mirrored ruin checks and approved caller/type scope. |
| `docs/dev/qa-W0.3b-reads.md` (new) | Browser checklist for the banner/pill, every emergency panel tab, every upkeep list/card/tip/tool, lifecycle and lead gates. |
| This report | Implementation, exact site inventory, test names and verification limits. |

LocalSimHost remains the only host. SimCore, simulation, save and render implementations are untouched. The
guard holder, `abort('dispose')`, null views and existing command tags/gestures are preserved. All new watches
and subscriptions use `ctx.signal`; there are no new simulation mutations or listeners without a city lifetime.

## Every site: base line → final line

| File | Before → after | Mechanism |
|---|---|---|
| `src/ui/EmergencyBanner.ts` | 625 → 628 | Policy incident through the view. |
| same | 702 → 706 | Jump target through the view. |
| same | 710 → 714 | Dispatch feedback through the view; command unchanged. |
| same | 763 → 765 | Incident/vehicle text through the view; Send through options watch. |
| same | 818 → 823 | Ordering through view/options watch. |
| same | 833 → 838 | Layout through the view. |
| same | 1098 → 1102 | Tick/pill through view/options watches. |
| `src/ui/panels/EmergenciesPanel.ts` | 32 → 30 / 123 | `dispatchBlocked` receives view/options; Active row supplies its watch. |
| same | 79 → 83 | Active/readiness through the view. |
| same | 97 → 101 | Active incidents through the view; host clock at 103. |
| same | 167 → 173 | Fleet through the view. |
| `src/ui/panels/ListPanels.ts` | 220 → 214 | Mirrored buildings supply ruin status. |
| `src/game/toolCatalog.ts` | 146 → 132 | Mirrored buildings supply unique-building status; old helper removed. |
| `src/game/tools/placement.ts` | 115 → `src/worker/queries.ts:33` | Services read moves into `upkeepContext`; pure helper input at `placement.ts:126`. |

Supporting caller: `PlopTool.ts:245 → 261`; the upkeep watch helper is at 202. The small wire union addition is
at `protocol.ts:23`. These are the two explicitly approved extra files, not additional system-read sites.

## Query/cache behavior

`upkeepContext` takes `{defId, x, z, w, d}` and returns only the existing marginal price. It uses LocalSimHost's
canonical argument-keyed pending-query cache and the watch's bounded 64-key cache. The placement watch uses
`change`: day/command changes invalidate its results, with the existing 200 ms cap. Dev/test deliveries use
the existing `structuredClone` boundary. Missing definitions, tiers, valid-sized rasters or running-cost
infrastructure yield `here: null`, keeping the existing city-wide/catalog fallback.

A newly selected footprint has no previous footprint's value: while throttled, its tip uses the city-wide
fallback, then repaints its spot price. A returned cached footprint uses its own value. The first local watch
evaluation is synchronous. Emergency buttons likewise distinguish pending options from a known empty list.

## Tests and verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Passed after source and test changes. |
| `git diff --check` | Passed. |
| `rg -n 'emergencyOf\|getSystem' src/ui src/game` | No matches. All 14 base sites re-found with `git grep` against `93069fa`. |
| `npx vitest run tests/worker/hygiene.test.ts --maxWorkers=1` | Startup failed before collection: Vite `externalize-deps` / `windowsSafeRealPathSync` / `optimizeSafeRealPathSync`, **spawn EPERM**. |
| `npx vitest run tests/worker/upkeepContext.test.ts --maxWorkers=1` | Same startup failure; no tests ran. |
| Earlier `npx vitest run tests/game/emergenciesPanelBusy.test.ts --maxWorkers=1` | Same startup failure on the partial edits. |
| Full suite, bot, old-save continuation, browser checks/screenshots | Not run; lead environment required. **196,101 in 2015** is the required reference, not a result measured on this diff. |

New/extended tests by name (written and typechecked; not executed):

- `tests/worker/upkeepContext.test.ts`: **keys pending queries by every argument and clones query and watch
  results in tests**; **caches each footprint, refreshes after paused commands and days, and disposes with
  the city**; **matches the former funding curve with %s economy data without initializing or normalizing
  it** (missing/old/partial/v1/strike, funding 0/50/100/150/NaN); **keeps null fallbacks for missing definitions,
  tiers, rasters and infrastructure**.
- `tests/worker/emergencyReads.test.ts`: **matches direct options per incident and refreshes paused dispatches
  and returns within the 5 Hz cap**.
- `tests/worker/querySideEffects.test.ts`: **120 deterministic days with every query/watch handler, sampled
  buildings/cells and every section equal 120 days with no reads**, now including upkeep.
- `tests/game/upkeepReads.test.ts`: **pins %s typical and full-use prices from 93069fa** (seven cases);
  **keeps every ploppable card and reward upkeep chip on the same city-wide or flat values**;
  **pins the old school cursor values with need, partial coverage, funding, no road and no raster**;
  **pins %s cursor upkeep from 93069fa for 100 nearby unserved people** (11 definitions);
  **keeps both ruin checks and their upkeep values current from exact mirrored flags while paused**.
- `tests/game/queryReads.test.ts`: **keeps upkeep per footprint and repaints the current spot after a paused
  funding command**; **disposes upkeep reads and stops repainting on %s** (leave/deactivate/abort).
- `tests/game/emergenciesPanelBusy.test.ts`: **uses current view records and releases option watches on tab
  change, close and city abort**, alongside the original busy/free/title regression.
- Existing regression files adapted without dropping assertions: `tests/game/emergencyBanner.test.ts`,
  `tests/game/toolsPlacement.test.ts`, `tests/game/toolsPreview.test.ts`. The unchanged
  `tests/game/uiRuins.test.ts` also covers the two migrated ruin consumers.

The base arithmetic pins include school cursor costs **132**, **102**, **90.46716620017375**, **72** for new
need, half coverage, 50% funding and no road; typical/full-use school **§230/§972**, library **§1,314/§1,854**,
museum **§3,555/§4,995**, clinic **§497/§684**, police **§915/§2,211**, fire **§539/§749**, park **§30/§41**.
These are fixed expectations from the base formulas; they are not a claim that a baseline/current runtime
comparison executed in this sandbox.

**Hygiene enabled:** `W0.3b: src/ui and src/game no longer call emergencyOf or getSystem` (`it.skip → it`),
without exemptions and with the NOTE-028 comment removed. Source search is clean; execution of the AST test
is blocked by the startup error. Existing W0.2/W0.4/W0.5 rules and the other lane's W0.6 skips are untouched.

Manual handoff: [qa-W0.3b-reads.md](../qa-W0.3b-reads.md). Remaining acceptance gates are the single-file tests
above, full Vitest, the 128×15 seed-7 bot, old-save continuation and the browser comparisons. Leave the diff
uncommitted for the lead's review and merge.
