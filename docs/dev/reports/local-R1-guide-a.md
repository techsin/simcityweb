# T037ar — onboarding review and local fixes

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
