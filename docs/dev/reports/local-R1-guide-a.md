# T037ar — onboarding round 4

Round-4 base: **fb60208**, with dev 50a6b29 merged after round 3's e8d03de. Read NOTE-051 in full before editing. Its two approved save-path entries and event form **one standalone change**, with the tests and report below. They resolve the dirty/journal requests recorded in the historical rounds. FH-22's real Local/packet save/reload and fresh-core recovery checks now pass; browser acceptance remains with the lead.

## Round-4 change 1 — NOTE-051 save-path completion

| File | Change |
|---|---|
| src/save/recoveryCodec.ts | Add setOnboarding: true to JOURNAL_OPS. |
| src/worker/protocol.ts | Add setOnboarding to JournalOp only. |
| src/save/fingerprint.ts | Add savedDataChanged to CHANGE_EVENTS; fingerprint bytes stay unchanged. |
| src/sim/Simulation.ts | Declare savedDataChanged: void in CityEvents. |
| src/worker/SimCore.ts | After validation, compare records with existing plainEqual. Identical valid records return true without replacement/event; changed records install the detached copy, then emit savedDataChanged. Invalid records still return false. |
| tests/worker/onboardingPersistence.test.ts | Add Local/packet dirty-boundary cases: initial install +1, save/reload, reordered identical record +0, invalid future record +0, changed field +1. Existing actual save/reload and absent-op invariants remain. |
| tests/worker/recovery.test.ts | Add actual mirror enrollment/written-journal progress-only replay on a fresh core. Extend the every-whitelisted-op fixture with setOnboarding; assert its boolean true and the declared void results, preserving the other actions' existing { ok: true } expectations. |
| docs/dev/reports/local-R1-guide-a.md | This round's evidence and W1.3/T039 handoff. |

The dirty tests compare the host's public changes count with its actual save acknowledgement and also require an unchanged cityFingerprint, exercising the same two-part clean/dirty boundary as App. Equivalent records with different object-key insertion order remain clean. Journal replay restores the record and the complete saved city, without advancing time or RNG.

Numbering retained for the lane: **1** is the single change above; **2, 3, 4, 5 and 6** have no new edits. **No src/sim/infra/* hunk or outside-scope hunk.** No edits to protocolInbox.ts, WorkerSimHost.ts, LoopbackSimHost.ts, simWorker, WorkerLink, TopBar/topbar, main.ts or other cloud-held files. The existing generic event subscribers, packet change counter, journal enrollment and replay paths suffice.

### What W1.3 / T039 must keep

Preserve **both** whitelist entries (JOURNAL_OPS and JournalOp), the typed savedDataChanged event, its CHANGE_EVENTS registration, and SimCore's validated changed-only emit. W1.3's worker-side journal must treat setOnboarding as an ordinary whitelisted command; boot replay must apply it through the generic SimCore path and accept its boolean result. A replayed changed record is unsaved; an identical record must not increment the change count. If W1.3 relocates the whitelist, move the entry with it. Do not drop either entry or the event in a merge conflict. No additional cloud implementation request is needed for this change.

### Round-4 tests and gates

**PASS:** npx tsc --noEmit; git diff --check; all eight changed files have no UTF-8 BOM. The following **10 single-file runs passed: 135 tests, 1 existing skipped**, sequentially through the quiet gate. The skip is the existing W1.2 simWorker import-graph test; no new skip was introduced.

| Test file | Passed | Existing skips |
|---|---:|---:|
| tests/worker/recovery.test.ts | 26 | 0 |
| tests/save/recoveryCodec.test.ts | 8 | 0 |
| tests/save/recovery.test.ts | 14 | 0 |
| tests/save/recoveryIdb.test.ts | 4 | 0 |
| tests/save/recoveryLs.test.ts | 4 | 0 |
| tests/save/fingerprint.test.ts | 2 | 0 |
| tests/worker/onboardingPersistence.test.ts | 10 | 0 |
| tests/game/onboarding.test.ts | 49 | 0 |
| tests/worker/hygiene.test.ts | 17 | 1 |
| tests/worker/exactDigest.test.ts | 1 | 0 |

Used the successful round-3 runner below, with no Vite/config/dependency edits. Onboarding emits the same AbortSignal listener-limit warnings seen in round 3; all its assertions pass.

~~~text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types node_modules/vitest/vitest.mjs run <single-file-from-table> --maxWorkers=1 --configLoader native --pool threads
~~~

**PASS, bot:** **2015 residents [61,124, 93,804, 37,971] = 192,899**, identical to the reference. The requested command was attempted, but tsx is absent and npm's cache has no package (ENOTCACHED):

~~~text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
~~~

The repository documents the installed Rolldown fallback in tools/balance-json.ts and simbot's help. Bundled tools/simbot.ts as Node ESM in the assigned scratch folder and ran its unchanged CLI with the same arguments through the quiet gate:

~~~text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T037ar/scratch/round4-simbot.mjs --size 128 --years 15 --seed 7 --quiet
~~~

**PASS, unchanged exact/determinism digests:** paired short 32² seed-7 SimCore probes compare the working sources with **fb60208's versions of all five changed production files**, supplied to the bundler without a checkout or worktree mutation. Real systems/actions run for 45 days, day 358 to 403, with ordinary tax/funding commands across month/year boundaries and no setOnboarding. All **46 initial/daily samples** match: exactDigest, canonical saved-city SHA-256 (same canonicalization as querySideEffects, savedAt excluded), RNG state and change count. Both runs have no onboarding key, zero savedDataChanged events and zero system errors.

| Sample | exactDigest, both | Saved-city SHA-256, both | RNG, both |
|---|---:|---|---:|
| Day 358 | 2099856967 | cdeed96fa61ea4b04447ed0cd3c516260d567ecda0b728ee231b2610b59f0c17 | 2654435774 |
| Day 403 | 1834814790 | fd708863a82fa5a6fca24366420e94f795b796772b9e8c48765195094b5c7ec3 | 2597156171 |

The digest comparison is a 45-day regression probe, not a claim of full-bot hash measurement. The separate 128×15 bot above establishes the requested population gate. Existing absent-onboarding exact-digest and direct-Simulation/Local save/RNG comparisons also passed in onboardingPersistence.

Scratch evidence: round4-test-results.json; round4-bot-128x15-s7.txt; round4-invariants-comparison.json; per-variant sample JSON, probe/builder and source-hash metadata. No other worktree or branch was touched. Changes remain uncommitted; no .done file was written.

**Plan versus code:** the entries/event fit the existing generic paths; no host workaround or plan amendment. NOTE-051 also confirms guideFacts' previously reported 7.3 ms one-time cold metadata hydration is not a gate; its 0.124 ms full reevaluation and 0.002 ms cached read remain the recorded measurements, not new runs.

**Left for the lead / unverified:** full Vitest after integration, actual W1.3 worker-side journal/boot migration, and real-GPU/browser acceptance. No new 256×60 or guide-follower bot run is needed for this additive save-path change. The prior guide-only first-city numeric/browser gates below still apply.

- [ ] Local and packet city: a progress-only dismissal/minimise/timer change shows Unsaved; saving clears it; repeating the identical record leaves it clean.
- [ ] Reach G4, save/reload and continue. Unload/crash after a progress-only edit, recover at boot, and retain the guide record without advancing the recovered date for replay.
- [ ] Old saves without onboarding still load and remain keyless until enrolled. After W1.3 integration, repeat progress-only recovery and no-op dirty checks on the actual Worker host.
- [ ] Complete the existing FH-01/FH-02/FH-22 and real-input 1280×720 guide-only first-city checklist below.

---

## Round-3 report (historical, committed as e8d03de)

Round-3 base: 865e956, after round 2 was committed as 3f18111 / 30cc30d / 865e956. The user verified tsc and the unchanged **192,899** bot total; their full suite found the one guideFacts packet-test failure reproduced here.

**Diagnosis: (a), services had not run yet.** Ordinary station edits wait for SERVICES_DIRTY_DAYS (2); scheduler.flush respects the task's due predicate and does not bypass that delay. This test uses design cadence, which calls advanceDay without system frames, so SERVICES_MIN_CYCLE_MS is inactive here. The live cap remains covered by the unchanged servicesTrigger tests. No defect was found in (b), services/emergency layer invalidation, or (c), canonical-lot resident weighting.

## Round-3 findings and changes

References below identify the reviewed test at 865e956.

| File:line | Severity | Finding and fix |
|---|---|---|
| tests/worker/guideFacts.test.ts:90 | P2 test | settle advanced only one day after adding/removing stations. Use the exported dirty-day delay, observe genuine services layer completions, and check the authoritative canonical home's coverage against the subscribed packet watch. The first-day check explicitly proves no services completion and zero police coverage. Each completed pass is followed by one inbox refresh after its watch cap; a new watch version and exactly one subscriber notification are required. There is no per-frame polling. |
| tests/worker/guideFacts.test.ts:111 | P2 test | The next assertion, exposed after fixing the delay, assumed an unsubscribed fire raster started negative. Overlay.None leaves that deferred replica raster at its initial zero value. Capture and compare its startup value instead. Police/fire aggregate assertions still require actual authoritative coverage and real removal updates. |

The existing cache tests also pass: services/emergency completion invalidates the aggregate; unrelated traffic refreshes and unchanged frames do not recompute it; canonical fronts, resident weighting and fuel-plant coverage remain correct. No production source change is needed.

| # | Round-3 change | File list |
|---|---|---|
| **1** | No new persistence change. Round-2 pending dirty/journal requests below remain open. | None. |
| **2** | Fix the packet test's services timing and deferred-raster assumption; assert real completion, canonical source coverage and subscribed watch delivery after addition/removal. | tests/worker/guideFacts.test.ts |
| **3** | No new coach change; TopBar split wiring remains deferred. | None. |
| **4** | No new power UI change. | None. |
| **5** | No new E11/toast change; existing toast-budget tests pass unchanged. | None. |
| **6** | No new handoff change. | None. |

Report-only update: docs/dev/reports/local-R1-guide-a.md. **No src/sim/infra/* hunk, production hunk, outside-ownership code hunk or cloud-held-file edit.** Changes remain uncommitted; no .done file was edited.

## Round-3 verification

**PASS:** npx tsc --noEmit; git diff --check; both changed files are UTF-8 without BOM. **PASS:** 20 targeted single-file runs, **339 passed / 3 existing skipped**, sequentially through the quiet gate:

| Test file | Passed | Existing skips |
|---|---:|---:|
| tests/worker/guideFacts.test.ts | 3 | 0 |
| tests/game/onboarding.test.ts | 49 | 0 |
| tests/game/guideCopy.test.ts | 137 | 0 |
| tests/game/guideTips.test.ts | 5 | 0 |
| tests/game/guideWhy.test.ts | 5 | 0 |
| tests/game/guideNewYear.test.ts | 3 | 0 |
| tests/game/guidePowerUi.test.ts | 4 | 0 |
| tests/game/guideToolbarCoach.test.ts | 1 | 0 |
| tests/worker/onboardingPersistence.test.ts | 8 | 0 |
| tests/worker/queries.test.ts | 14 | 0 |
| tests/worker/querySideEffects.test.ts | 2 | 1 |
| tests/worker/replicaSafe.test.ts | 2 | 1 |
| tests/worker/hygiene.test.ts | 17 | 1 |
| tests/game/toastBudget.test.ts | 10 | 0 |
| tests/game/newYearPacing.test.ts | 19 | 0 |
| tests/sim/servicesTrigger.test.ts | 24 | 0 |
| tests/game/budgetPreview.test.ts | 10 | 0 |
| tests/game/upkeepReads.test.ts | 21 | 0 |
| tests/game/uiCardTip.test.ts | 2 | 0 |
| tests/game/quakeShakePlop.test.ts | 3 | 0 |

The skips are the two absent grown-fixture cases and the existing W1.2 simWorker import-graph skip. No new test was skipped. Some UI tests emitted AbortSignal MaxListenersExceededWarning; all their assertions passed.

The default quietrun npx vitest command still failed before collection with Vite externalize-deps spawn EPERM. A native config loader avoids that startup path, but the default fork pool also cannot spawn here. All successful runs used Vitest's supported native loader/thread pool, with one worker and no config/dependency edits:

~~~text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types node_modules/vitest/vitest.mjs run <single-file-from-table> --maxWorkers=1 --configLoader native --pool threads
~~~

The original police assertion failed under this runner before the fix; the final guideFacts run passed all three tests. Diagnostics: round3-test-results.json in the assigned T037ar/scratch folder. The unchanged query-side-effects test checks 120 daily hashes/RNG states with and without reads on Local and generated packet cities.

**Plan versus code:** this was a test scheduling mismatch, plus an invalid assumption about an unsubscribed raster's sentinel. Query invalidation and lot weighting needed no amendment. **Cloud requests:** none added this round; the round-2 save-path requests and TopBar dependency below are unchanged.

**Left for the lead / unverified:** full Vitest after this fix, the normal default fork runner, real-GPU/browser acceptance and the guide-only first city. No bot or new timing probe was run for this test-only change. The user's round-2 bot result remains the reference: residents **[61,124, 93,804, 37,971] = 192,899** in 2015; this round changes no simulation code or RNG draws. If rerun, the exact regression command is:

~~~text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
~~~

Round-3 browser follow-up (the full FH-01/FH-02/FH-22 checklist and guide-follower numeric gates remain below):

- [ ] In Overlay.None, add police/fire stations and let the real coverage passes finish; G3/G4 update without opening a coverage overlay.
- [ ] Remove/rebuild the stations; coverage goals follow the completed layers, including after resync/reload.
- [ ] At 1280×720, repeat the guide-only first city and the original FH-01/FH-02/FH-22 acceptance checklist. Easy reaches 2,500 by day 1,170, Medium by day 1,530, pre-Play spend is at most §15,000, and no first brownout occurs before day 1,530.

---

## Round-2 report (historical, committed as 3f18111 / 30cc30d / 865e956)

Round-2 base: b5580ff (dev 683d02b merged), after the user verified round 1 at 3dd3446: tsc, 221 Vitest files / 2,224 tests, and bot 192,899. Those results apply to round 1, not these uncommitted changes.

**Current status:** changes 2, 4, 5 and 6 and the allowed Toolbar part of 3 are implemented. Change 1's typed op, snapshot sending and real-save tests are implemented, but **dirty tracking and journal enrollment remain pending the explicit save-path approval requested under NOTE-048**. No forbidden host files, save/journal/recovery source, infra files or .done files were edited.

## Round-2 changes, numbered for separate commits

Shared files deliberately contain separate hunks. Stage the named hunks, rather than whole shared files, for each number. The report itself can be committed last.

Minimal additions outside the newly named source files: src/core/onboarding.ts shares the record/schema without importing UI code into the worker, and src/game/CityScene.ts adds only the Toolbar and E11 callbacks. Existing tests/worker/querySideEffects.test.ts and replicaSafe.test.ts get only the new query/registry coverage required by their exhaustive lists. No src/sim/infra/* hunk was needed.

| # | Change | File list / hunk ownership |
|---|---|---|
| **1** | FH-22 typed, bounded setOnboarding op; detached copies; unchanged-snapshot suppression; tagged independent gestures for UI/hidden events; enrollment preserves old mature/suppressed cities. **Dirty/journal entries pending.** | New src/core/onboarding.ts; src/worker/SimHost.ts; src/worker/SimCore.ts; src/worker/protocol.ts **CommandOp + SYSTEM_KEYS only**; src/worker/queries.ts **absent-onboarding exactDigest hunk only**; src/ui/guide/progress.ts; src/ui/Onboarding.ts **enrolled/lastProgress/persistProgress and persistence calls only**; new tests/worker/onboardingPersistence.test.ts; tests/game/onboarding.test.ts **FH-22 persistence/enrollment/event cases only**. |
| **2** | Cached authoritative guideFacts query/watch, canonical lot cells, resident-weighted police and automatic fire/all-fuel coverage in Overlay.None; guide consumes query result instead of replica rasters. | src/worker/queries.ts **guideFacts cache/handler/signature only**; src/worker/protocol.ts **QueryName entry only**; src/worker/replicaSafe.ts; src/ui/guide/goals.ts; src/ui/Onboarding.ts **coverageWatch field/disposal/frame hunk only**; new tests/worker/guideFacts.test.ts; tests/worker/querySideEffects.test.ts; tests/worker/replicaSafe.test.ts; tests/game/onboarding.test.ts **queried-coverage case only**. |
| **3** | TopBar coach wiring waits. Toolbar exact item ids now pulse and survive flyout/tab rebuilds. | src/ui/Toolbar.ts **coachItems/setCoachItems/item class + data-tool-id only**; src/ui/guide/onboarding.css; src/game/CityScene.ts **mark callback only**; new tests/game/guideToolbarCoach.test.ts. No TopBar/topbar changes. |
| **4** | Power-card MW output, wind flat/hill output and approximately 1 MW per 300 residents header; wind ghost's two-empty-tile Chebyshev spacing perimeter/conflicts, clipped at map edge. Existing footprint/target highlights and budget hints remain. | src/ui/Toolbar.ts **power imports/output/header only**; src/game/tools/PlopTool.ts; new tests/game/guidePowerUi.test.ts. Tool.ts is untouched. |
| **5** | E11 appends to the existing year-end feedback through the existing Toasts route, once per profile. Full/silent/compact branches still emit exactly one toast; compact silence/lifetime and FEEL-02a budget behavior stay intact. Uses the active guide's profile object so subsequent minimise/explainer writes preserve E11 memory. | src/game/NewYear.ts; src/ui/Onboarding.ts **yearFeedback method only**; src/game/CityScene.ts **yearFeedback callback only**; new tests/game/guideNewYear.test.ts. Notifications.ts and tests/game/toastBudget.test.ts are unchanged. |
| **6** | Nonblocking owner handoffs for structured LG-15/E10 damage and NEW-06/G9Next valid shore site. Existing hooks retained. | docs/dev/POLISH_BACKLOG.md, two added lines. |

### Change 1: exact pending approval / code mismatch

NOTE-048 says to ask first for anything in the save, journal or recovery path. The current code is not generic for these two requirements: recoveryCodec has an explicit JOURNAL_OPS whitelist; fingerprint has an explicit CHANGE_EVENTS list. An async approval question was sent for these exact minimal entries and is still pending:

- src/save/recoveryCodec.ts, JOURNAL_OPS: add setOnboarding: true. Add setOnboarding to protocol.ts's JournalOp union in the same change.
- src/save/fingerprint.ts, CHANGE_EVENTS: add savedDataChanged. Add the typed event in src/sim/Simulation.ts and emit it from SimCore only after a valid, changed record is installed. This updates both Local changeSequence and protocolInbox's existing shared change counter without editing protocolInbox.

Until approved and applied, manual host save/reload uses the new record, but progress-only edits do **not** mark the save dirty and the recovery mirror does **not** journal them. Do not mark FH-22 complete. Add Local/packet dirty-counter assertions, unchanged/rejected-record assertions and recovery replay coverage with those entries. The existing tests/worker/recovery.test.ts every-whitelisted-op fixture must also include the new op; it currently assumes a truthy action result is an {ok:true} object, while setOnboarding returns boolean.

No per-op change to WorkerSimHost.ts, LoopbackSimHost.ts or protocolInbox.ts was necessary in the implemented path, so no T034 skip was added. No save-path workaround or unrelated synthetic city event was used.

The record is a strict complete v1 shape capped at 2 KiB. Unknown versions/fields, malformed numbers, unknown/duplicate IDs, sparse arrays and arrays with extra properties reject before cloning. Old tolerant save decoding remains in the UI. The exactDigest hunk skips **only absent onboarding** so adding the optional SYSTEM_KEYS entry does not hash a new undefined sentinel into every pre-op city. No sim balance or RNG behavior changes when the op is never sent.

### Change 2: evaluation measurement and invalidation

Authorized fixture read only: C:/Users/techsin/Desktop/projects/simcityweb-worker/tools/bench/.fixtures/fixtures/dense1m_s7.metropolis. No other worktree was edited. Fixture: **1,118,755 residents, 17,154 buildings**.

- Final measured **one invalidated full aggregate evaluation: 0.1244 ms median**, 31 individual samples after 100 JIT warmups; min 0.1109 / max 0.1528 ms. This is a full sum, not a cache hit, and is below the 0.3 ms reevaluation target.
- Cached access: **0.0023 ms**.
- First call including lazy canonical-lot metadata hydration: **7.3309 ms**. This startup cost is separate and exceeds 0.3 ms; do not report the cold call as a target pass. Earlier unoptimized measurement was 0.1365 ms warm / 8.1613 ms cold.
- Metadata updates are event-driven, with an allocation-free path for an unchanged building reference/definition/canonical cell. Query/watch signatures are constant-time. Full sums invalidate on building/network/zone/terrain edits, services/emergency refresh, reset, and day events. Daily invalidation is needed because population bands change b.pop without necessarily emitting buildingChanged; it keeps resident weighting current. Idle unchanged frames do not recompute.
- Cold metadata and subsequent full sums stay in worker-owned transient caches; they do not add saved state or RNG draws.

The requested npx tsx probe could not start because tsx is not cached and npm networking is restricted (ENOTCACHED). The same short probe was bundled with the installed rolldown and run through the quiet gate using node. Scripts and guide-facts-performance.json are in the assigned T037ar/scratch folder. Final command:

~~~text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T037ar/scratch/guide-facts-probe.mjs
~~~

## Round-2 checks

- **PASS:** npx tsc --noEmit after all source changes; git diff --check.
- **PASS, limited source probe:** the repository hygiene scanner reports no systems/speed/replica violations in the seven changed UI/game sources; CityScene's static graph excludes sim/actions. round2-hygiene-probe.json records it. This does not substitute for full hygiene test execution.
- **BLOCKED before collection:** all 19 targeted single-file Vitest attempts below used quietrun and --maxWorkers=1. Vite's config loader failed in externalize-deps/optimizeSafeRealPathSync with **spawn EPERM**. **Zero tests executed.** round2-test-startup.json records the per-file failures.

~~~text
tests/game/onboarding.test.ts
tests/game/guideCopy.test.ts
tests/game/guideTips.test.ts
tests/game/guideWhy.test.ts
tests/game/guideNewYear.test.ts
tests/game/guidePowerUi.test.ts
tests/game/guideToolbarCoach.test.ts
tests/worker/onboardingPersistence.test.ts
tests/worker/guideFacts.test.ts
tests/worker/queries.test.ts
tests/worker/querySideEffects.test.ts
tests/worker/replicaSafe.test.ts
tests/worker/hygiene.test.ts
tests/game/toastBudget.test.ts
tests/game/newYearPacing.test.ts
tests/game/budgetPreview.test.ts
tests/game/upkeepReads.test.ts
tests/game/uiCardTip.test.ts
tests/game/quakeShakePlop.test.ts
~~~

New tests cover real Local/packet G4 manual save/reload and continued updates; detached records; invalid/future/oversized inputs; optional old saves; no-op-never-sent save/exact/RNG equivalence; hidden tagged gestures; mature/suppressed-city enrollment; canonical coverage cells/weights/readiness; unchanged-frame caching; real normal-view packet station placement/removal; power-card output/header/spacing preview; exact toolbar coaching; and E11 single-toast/profile/disabled/compact behavior. Runtime assertions remain unverified here due EPERM.

No bot or full suite was run this round. Expected default 128×15 seed-7 result remains **192,899**, residents **[61,124, 93,804, 37,971]**, with unchanged exact/determinism digests when setOnboarding is not sent. New no-op tests encode the invariant; it is not a fresh measured bot result. The prior report below retains the exact bot command for the lead.

## Round-2 browser follow-up

- [ ] Real Local and packet city: reach G4, save, reload, continue; dismiss/minimise and hidden power/budget updates survive. After the pending dirty/journal entries land, confirm a progress-only change marks Unsaved and survives recovery.
- [ ] Mature old save and globally suppressed profile stay unguided and keep the key absent until Help opens it; subsequent enrolled city dismissal persists.
- [ ] Overlay.None: add/remove police and fire stations, wait for actual layer completion, see G3/G4 update without switching overlays. Repeat after a resync.
- [ ] At 1280×720, power cards show 3 MW flat / up to 7 on hills (catalog-derived), other plant output, and the 1 MW/300 estimate without clipping existing price/upkeep/budget text.
- [ ] Turbine square ring shows the two-empty-tile clearance including diagonal conflicts and clips at map edges. Moving/rotating/changing tools/aborting clears it and keeps footprint/garage/ferry highlights intact.
- [ ] Exact Road/Residential/Wind/Tower items pulse through tab rebuilds. TopBar coach controls remain deferred until its split reaches dev.
- [ ] First enabled year-end feedback contains E11 once on the existing toast; later cities do not repeat it. Tips/toasts off do not consume it; ultra remains one silent compact toast. FEEL-02a pacing/toast budgets unchanged.
- [ ] Repeat guide-only first city on Easy/Medium and 64 islands using the original acceptance checklist below. E10/G9Next handoffs are nonblocking owner work.

All changes remain uncommitted. No commit, push, merge, .done update, browser/GPU run or unrelated process termination was performed.

---

## Round-1 review (historical, committed as 3dd3446)

Reviewed on local/R1-guide-a at a7b130d with dev merged. Changes are uncommitted. **Not DONE:** actual FH-22 save/reload and current FH-02 police/fire facts need cloud-owned Worker changes. No .done file was edited, following the desktop rules.

Read the queue task and NOTE-042 in full, the whole POLISH_PLAN across the review team, and the owned sources/tests before editing. Independently checked §4, FH-01/FH-02/FH-22, §7.2–7.4 and §8.1. No AGENTS.md or CLAUDE.md was found in the worktree or its parent paths.

## Review findings

References identify the reviewed code at a7b130d; fixed lines have moved. P1 = broken acceptance/Worker boundary; P2 = incorrect teaching, action or lifecycle behavior.

| File:line | Severity | Finding and disposition |
|---|---|---|
| src/ui/Onboarding.ts:108; src/worker/SimHost.ts:165; src/worker/protocol.ts:98 | **P1 OPEN** | Progress is only a detached getter. No onboarding command/mirrored key exists and nobody saves progress. The supplied-snapshot G4 test is not a save/reload test. Cloud request 1 below. |
| src/ui/guide/goals.ts:36, :41; src/worker/recorder.ts:44, :58, :393 | **P1 OPEN** | G3/G4 use policeCov/respFire arrays refreshed on packet hosts only for the corresponding overlay. Initial snapshot arrays can become stale after normal-view station edits. The centre-cell sample also differs from the inspector's lotCell. Cloud request 2; no query flood/forced-overlay workaround. |
| src/ui/Onboarding.ts:366, :196 | P1 fixed | Founding ticks latched after prerequisites were removed. Recompute during founding and revalidate B1–B4 on the Play click between polls. First-year achievements still latch. |
| src/ui/guide/founding.ts:51–54 | P1 fixed | Utilities could tick for a roadless zone; fallback needed no zoned lot. Require a dry front/yard lot and utility reach, or the existing fallback facility when utilities are absent. |
| src/ui/guide/copy.ts:5 | P1 fixed | WIND_SPACING runtime import pulled sim/actions into CityScene, violating FH-07a static-import hygiene. Move unchanged constant to tuning and preserve actions' reexport. |
| src/game/CityScene.ts:287; src/ui/Onboarding.ts:308, :410 | P1 fixed | Missing celebrating hook disabled every explainer. Tiny scene wiring now uses NewYear.busy; NewYear.ts is untouched. |
| src/ui/Onboarding.ts:87; src/ui/panels/InfoPanel.ts:92, :455 | P1 fixed | Missing Why hook/callback. New inspector method arms/open/pulses the next/current visible growable's Why and acknowledges a matching rendered report. Hidden retained targets and pending reports cannot complete G8. |
| src/game/settings.ts:55, :112; src/ui/panels/SettingsPanel.ts:98; src/ui/Onboarding.ts:158 | P1 fixed | NOTE-042: unused duplicate GameSettings.tips and missing switch. Remove it; profile API and signal-bound subscriptions connect Settings and active guide. Preserve other profile fields. |
| src/ui/Onboarding.ts:75, :339, :433 | P1 fixed | Synchronous changingSpeed guard missed delayed authoritative speed events. Tagged guide pause/restore commands now combine the synchronous guard (optimistic events have no cause) with replay cause tags. Manual speed changes cancel restoration. |
| src/ui/Onboarding.ts:136 | P2 fixed | Minimise hid an Easy tip's close control and left the game paused. Close the tip and release only the guide-owned pause. |
| src/ui/Onboarding.ts:323–329 | P2 fixed | Industrial cap fix opened Rewards despite recommending transport. C/I fixes now open Transport. |
| src/ui/Onboarding.ts:334 | P2 fixed | E8 required an unwired approval action hook. Fall back to FH-06's existing approval-row mapping, without editing TopBar files. |
| src/ui/guide/goals.ts:152 | P2 fixed | G5 opened last Budget tab instead of Taxes. Reuse PanelManager.get/BudgetPanel.showTab. |
| src/ui/guide/goals.ts:73 | P2 fixed | G6 could first appear with an elementary school already present. Match §4.5's no-school trigger; keep an already-started goal latched until met. |
| src/ui/Onboarding.ts:403 | P2 fixed | Goal completions during New Year lost their chime. Defer a completion beat until the show ends. |
| src/ui/Onboarding.ts:76, :294 | P2 fixed | Pending landfill reply epoch survived road edits. Network changes now invalidate it and clear cached reach. |
| src/ui/Onboarding.ts:54, :81 | P2 fixed | An overlay open at construction had no G7 timer. Initialise from current UI overlay. |
| src/ui/guide/coach.ts:16; src/game/CityScene.ts:287 | **P2 OPEN** | Fine-grained mark hook/items remain unwired. Category/play coaching works. Toolbar/TopBar owner request below. |
| src/ui/guide/goals.ts:160; src/ui/Onboarding.ts:308 | **P2 OPEN/dependency** | G9Next needs NEW-06 valid-shore data; E10 needs damage/district outcome; E11 needs cloud NewYear toast hunk. Do not infer them from news text. |

## Predicate and boundary audit

| Step/goal | Condition against §4 | Result |
|---|---|---|
| B1 | Real neighbour connection | Matches; tests distinguish 2-cell stub from 6 cells reaching 3 in. |
| B2 | 40/8/12 front/yard cells; half on ordinary 64 maps | Matches explicit predicate; island formula below. |
| B3/B4 | Utilities reach zoned lot | Tightened to dry road-accessible lot; supported no-infra fallback retained. |
| B5 | One elapsed day; guide Play requires B1–B4 | Spring start 90 waits until 91. Space/top-bar controls remain available. |
| G1 | 500 residents | Matches. |
| G2 | NoGarbage or 300 residents; reachable landfill capacity >0 | Uses host inspectCell; road/zone invalidation corrected. |
| G3 | Crime ≤−4 or 400 residents; ≥50% police coverage at homes | Thresholds match; packet data source OPEN. |
| G4 | Fuel plant or 800 residents; ≥50% buildings covered including fuel plants | Thresholds match; packet data source OPEN. |
| G5 | Deficit or 2 services; Budget opened or 2 recurring solvent months | Matches, excludes one-offs, opens Taxes. |
| G6 | ≥100 unreached pupils with no elementary school; <50% unreached completes | Trigger corrected; completion matches. |
| G7 | 1,500 residents; data view open 3 real seconds | Matches. |
| G8 | After G7; actual Why expansion on growable | Matching rendered inspector report now acknowledges. |
| G9 | After G1; 2,500 residents | Matches explicit handover. |
| G10 | >80% supply or brownout; ≥1.25× margin for 30 days | Matches; day events reset margin; priority slot; allowed after G9. |

Changed guide game reads use host.state, queries/watches and the emergency view. Mutations use host commands: Play uses setSpeed(1, 'onboarding'); explainer pause/restore uses tagged act('setSpeed', ...). Tool selection keeps the existing tool command/gesture path. Emitter subscriptions unsubscribe on ctx.signal; DOM/profile subscriptions and watches are signal-bound. No replica writes, RNG draws, balance changes or mandatory save keys were added.

GuideProgress stays detached/optional and old saves retain young-city auto-show behavior. **It is not yet persisted.** GuideProfile uses loadPref for tips/seen/veteran/global dismissal. foundedDay already arrives in the initial full snapshot and is immutable, so present spring starts need no new foundedDay mirror hunk. No guide condition uses an absolute calendar-year deadline.

## Change per file

| File | Change |
|---|---|
| src/ui/Onboarding.ts | Founding revalidation, profile Tips subscription, pause ownership/minimise/abort guards, landfill invalidation, cap/approval routing, deferred chimes. |
| src/ui/guide/founding.ts | Utilities need an accessible dry lot. |
| src/ui/guide/goals.ts | Taxes route; elementary-school counter/trigger. |
| src/ui/guide/coach.ts | Budget route and FH-06 approval action adapter. |
| src/ui/guide/tips.ts (new) | Profile Tips API and signal-bound same-page subscriptions. |
| src/ui/guide/copy.ts | Reads WIND_SPACING through tuning; wording unchanged. |
| src/game/settings.ts | Removes GameSettings.tips/default. |
| src/ui/panels/SettingsPanel.ts | Profile-backed Tips switch, live checked/ARIA state, teardown. |
| tests/game/onboarding.test.ts | Current readiness/click race, roadless utilities, spring Play/spending, action routes, profile updates, optimistic/replayed pause events, minimise and deferred chimes; retained per-goal tests. |
| tests/game/guideTips.test.ts (new) | Preference fields, retired settings ignored, subscriptions, Settings interaction/teardown. |
| tests/game/guideWhy.test.ts (new) | Delayed/current/facility/closed inspector, actual acknowledgement, preference and abort checks. |
| **Outside named ownership: src/game/CityScene.ts** | One two-line constructor hunk for NewYear.busy and inspector callbacks. |
| **Outside named ownership: src/ui/panels/InfoPanel.ts** | Small standalone guideWhy method and local open/render/abort hooks. |
| **Outside named ownership: src/sim/economy/tuning.ts** | Unchanged WIND_SPACING=3 beside placement constants. |
| **Outside named ownership: src/sim/actions.ts** | Import/reexport that constant; remove old declaration only. |
| **Outside named ownership: tests/game/settingsSchema.test.ts** | Remove tips from typed changed-settings fixture/default assertion. |
| docs/dev/reports/local-R1-guide-a.md | This reviewed status/handoff. |

**No src/sim/infra/* hunks.** No Worker, main.ts, TopBar/topbar, advisors, adviceActions, NewYear or Notifications edits. Existing src/ui/guide/onboarding.css remains at its merged path, untouched; no stylesheet was moved.

## Checks and tests

- **PASS:** npx tsc --noEmit after fixes.
- **PASS:** git diff --check; ownership/status review.
- **PASS, limited source probe:** repository hygiene scanner on the ten changed UI/game files: systems/speed/replica violations []; CityScene static import graph excludes sim/actions. This does not replace complete hygiene execution.
- **BLOCKED before collection, zero tests executed:** tests/game/onboarding.test.ts, tests/game/guideTips.test.ts, tests/game/guideWhy.test.ts, tests/game/guideCopy.test.ts, tests/game/settingsSchema.test.ts and tests/worker/hygiene.test.ts. Each was attempted separately through quietrun with --maxWorkers=1. Vite config loading failed in externalize-deps/optimizeSafeRealPathSync: **spawn EPERM**.
- Scratch: hygiene-probe.json and test-startup.json in the assigned T037ar/scratch directory.
- No bot, browser, GPU timing, full suite or unrelated process was run/stopped.

Rerun the six single files above by name, then the lead's full Vitest/hygiene/scene teardown checks. The existing “restores a supplied G4 snapshot” test is not FH-22's actual persistence gate; add the host/save round trip after its command lands.

## Exact requests for other owners

1. **Cloud Worker — persistence:** SimHost.Commands needs a typed setOnboarding(progress) command for a detached validated v1 record. SimCore.applyCommand must copy into optional authoritative systemData.onboarding. Add onboarding to protocol.SYSTEM_KEYS, packet snapshots/acks and dirty/save tracking, with LocalSimHost/packet-host real save/reload tests. T039 must specify recovery/journal treatment so progress-only edits survive recovery. Then GUIDE can send changed snapshots through host.act with its tag/appropriate UI gesture, including dismissal/minimise and hidden timer/event changes. Current progress/readProgress provide the schema seam. Do not substitute per-city localStorage.
2. **Cloud Worker — facts:** queries.ts/query implementation needs a bounded aggregate guideFacts query/watch with current resident-weighted police coverage, automatic fire coverage and all-fuel-plant coverage, using canonical lot cells/readiness. Include other cheap GoalFacts counters if appropriate. It must work in Overlay.None and invalidate on edits/layer refresh. GUIDE can replace goals.ts's view-dependent inputs with it. Test normal-view station addition/removal on a packet host.
3. **TopBar split / Toolbar:** connect GuideHooks.mark to split RCI/budget/approval/data/reward controls and Toolbar exact item ids; preserve category/play coaching. Coordinate existing TopBar cap notification with the shared queue to avoid duplicate E7 text. No cloud-held file was changed.
4. **Toolbar/PlopTool FH-01 owner:** add catalog/params-derived output to power cards and approximately 1 MW/300 residents header; show WIND_SPACING clearance ring for wind ghosts. Tool preselection already works. These placement-lane files were left untouched.
5. **Cloud NewYear E11:** append guideCopy.phaseD.E11() to first year-end feedback with profile memory/shared queue coordination, without duplicate toasts. Existing busy getter sufficed for this lane's visibility gate.
6. **LG-15 / event/Worker E10:** supply structured disaster outcome district/rubble count/position, then offer E10. Present event lacks those outcome fields. FH-08 E1–E3, FH-13 E4–E5, FH-03 E6 and FEEL-06 E9 remain their event owners' integrations; offerExplainer exists, their callers are absent in this branch.
7. **NEW-06 G9:** supply actual valid-shore-site predicate through the host-safe contract, then add G9Next(true/false). Current copy only promises the Mayor's House.

## Plan versus code and remaining limits

- Queue's older 196,101 bot total is superseded by this task: **192,899**, residents **[61,124, 93,804, 37,971]** in 2015. Expected invariant, not measured here. Medium/Hard/RNG behavior should not change.
- Explicit B3 predicate permits completion after one served lot although text recommends three turbines. B2 can tick before utilities, B1 before zoning. “No step ticks while every lot reads Not growing” is broader than those explicit predicates. Kept explicit conditions, strengthened utility access and revoked stale ticks; no invented three-turbine/demand/density gates. Real-input verification must resolve that broader acceptance wording.
- G9 explicitly hands off at 2,500 even if other teaching goals remain; G10 may follow. Kept as specified.
- G6 now follows literal no-elementary-school trigger; already-started G6 stays until coverage improves.
- Island scaling remains min(size<=64 ? 0.5 : 1, dryCells/1024), rounded up, floors 4/2/2; plan supplies no formula. edgeHint validates a dry preview route and offers no invented bridge for an isolated island. Actual 64-islands playability remains unverified.
- G5 +1-point estimate uses watched tax lines/current rates; populated zero-rate group gets a budget instruction, not a fabricated number.
- Existing newcomer bot is deliberately under-zoning with **coal and a pump**, not the §4 wind/tower guide follower (tools/simbot.ts:26, :788). Its spending cannot establish guide ≤§15,000 acceptance. Run it separately as regression diagnostics; real-input guide following is required.
- Unverified: actual guide saves, current packet coverage, test assertions/execution, layout/input/GPU behavior, newcomer outcomes, island preset, bot hashes, +1 ms/frame overhead.

## Gates left for the lead

Exact bot commands (one process at a time; capture UTF-8 output in assigned scratch):

~~~text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 4 --seed 7 --difficulty easy --profile newcomer --quiet
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 4 --seed 7 --difficulty medium --profile newcomer --quiet
~~~

- Default: 2015 residents [61,124, 93,804, 37,971], total **192,899**.
- Guide follower: pre-Play **≤§15,000**; Easy **≥2,500 by foundedDay+1,080 (day 1,170)**; Medium **≥2,500 by foundedDay+1,440 (day 1,530)**; first brownout **not before foundedDay+1,440**. Existing newcomer commands cannot substitute for guide following.
- §4.8 broader checks: no deficit >**3 months** without E4; Easy approval **≥45% for 9/12 first months** (FH-13/FH-04 apply).
- Lead: tsc after integration, full Vitest/hygiene, actual G4 reload, Medium/Hard determinism comparison and y20 UI overhead **≤+1 ms/frame**. No new 256×60 run is needed solely for this UI review; broader §8.1 shared hash matrix stays with the lead.

## Browser checklist — FH-01, FH-02, FH-22 and §8.1 verifier 5

Use real input at **1280×720**, fresh Medium profile/city, then Easy and 64-islands. Mark Worker-dependent checks blocked until requests 1–2 land.

- [ ] Paused day90/1 April, Found your town; old saves keep date and young-city behavior.
- [ ] Two-cell stub stays open; six connected cells reaching three in ticks B1. Road action shows a valid hint, clears before next stroke.
- [ ] Roadless 40/8/12 stays open; front/yard 40/8/12 ticks (20/4/6 ordinary 64). Inspect lots against explicit “Not growing” limitations above.
- [ ] Road/residential/wind/tower buttons preselect correctly. Owner requests 3–4 supply exact item pulses, power output/header and spacing ring.
- [ ] Unserved/roadless utility zones do not tick. Removing/rebuilding road/zones/supply revokes/restores founding readiness and Play. Space/topbar always available.
- [ ] Copy price/MW/spacing/resident numbers match catalog/tuning. Guide founding spend ≤§15,000 Medium. Repeat complete start on 64 islands.
- [ ] Spend guard once/profile at >40% on day90, loans/refunds excluded. Completion fire tip only when appropriate fuel plant exists.
- [ ] First elapsed day switches to Your first year/G1, stays beyond six seconds. At most two goals and one tip; both actions usable at 720p/minimised size.
- [ ] G1–G10 tick/chime within one second of authoritative condition once. Normal-view police/fire station add/remove remains correct (Worker request 2).
- [ ] G5 opens Taxes after Loans. Police/Fire/Education/Data/Rewards and E7/E8 actions open named fixes. Verify fine coaches after owner wiring.
- [ ] First home opens/pulses Why; G8 Query works on other growables. Pending report/closed inspector cannot complete before visible rendered section.
- [ ] **Scripted guide-only run:** only guide/goal buttons plus real placement/query gestures. Record pre-Play spend, population/approval each founding-year, deficit months/reasons, first brownout. ≥2,500 by day1170 Easy/day1530 Medium; no brownout before1530. G10 appears first; independent wind and gas branches each clear after full month; G10 can appear after G9.
- [ ] Settings Tips changes active queue immediately, persists across city/reload, preserves other profile fields. Off/minimise releases guide-owned pause; manual speed survives, including packet replay.
- [ ] Explainers once/profile, two-month pacing, Easy pauses; Medium/Hard only E1a pauses; none cover New Year. Sounds/toasts defer. Check E1–E12 when owner integrations land.
- [ ] **Real save G4/reload:** phase/completed/started/timers/dismissal/minimise return (blocked by Worker request 1). No fabricated snapshot substitute.
- [ ] This city leaves next city guided; All cities suppresses it; Help resumes phase. Old save without onboarding loads/continues.
- [ ] Repeated exit/re-entry with retained nodes/pending landfill/inspector replies leaves no old callbacks, commands, highlights or listeners.

No commit, push, merge, browser session or .done update was made.
