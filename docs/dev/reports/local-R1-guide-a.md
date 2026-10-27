# T037 GUIDE (a): founding and first-year framework

Branch: `local/R1-guide-a`. Base: `93069fa` (`local/W0.3-5-integration`).

The owned-file implementation is ready for review, but this sub-lane is **not DONE**: the base lacks the onboarding host write/mirror row, the inspector hooks, and the New Year visibility hook. In particular, this change does **not** save guide progress into city saves yet. No unsupported command, replica write, per-city localStorage substitute, or edit to another lane's files was added.

Changes are uncommitted. No push or queue `.done` entry was made.

## Change per file

| File | Change |
|---|---|
| `src/ui/Onboarding.ts` | Consumes the merged copy module; founding tool selection and Play gating; transition into the first-year card; at most two goals; latched achievements and Help reopening; city/all-city dismissal choices; host watches/queries; signal-bound listeners; public progress snapshot, inspector callback and explainer entry point. |
| `src/ui/guide/founding.ts` | Real neighbour-connection predicate, road-accessible R/C/I counts, small/island target scaling, existing utility-reach behaviour and fuel-plant checks. |
| `src/ui/guide/goals.ts` | G1–G10 triggers/predicates/actions; resident-weighted police coverage; fire coverage from ready host emergency layers; recurring budget tracking; full-month power margin; power-warning priority; landfill query sites and watched-budget tax estimate. |
| `src/ui/guide/edgeHint.ts` | Finds a dry route from the best buildable area to a reachable edge. The card validates it through `host.preview` before highlighting it. |
| `src/ui/guide/coach.ts` | Typed coach targets and the explicit hooks for the deferred Toolbar, TopBar, inspector, approval actions and New Year wiring. |
| `src/ui/guide/explainers.ts` | Shared one-tip queue, two-game-month cooldown, priority, withdrawal of fixed problems, and once-per-profile memory. |
| `src/ui/guide/progress.ts` | Versioned, detached city progress schema/decoder; profile veteran/tips/seen state; legacy global dismissal and minimise preferences. |
| `src/ui/guide/onboarding.css` | Scoped card layout, two readable goal actions, scroll limit, explainer and dismissal choices. Kept inside this sub-lane's owned directory. |
| `tests/game/onboarding.test.ts` | 39 cases covering the founding checks/card, every goal predicate, timing, profile/snapshot boundaries, async replies, teardown and source hygiene. |

`src/ui/guide/copy.ts` is used unchanged. No TopBar, advisor, panel, tool, settings, simulation, worker, scene or save implementation file was edited.

## Checks

- **Passed:** `npx tsc --noEmit`, including the new tests.
- **Passed:** `git diff --check` for tracked changes; ownership reviewed with `git status --short`.
- **Blocked before test collection:** `npx vitest run tests/game/onboarding.test.ts --maxWorkers=1`. Vite failed loading `vite.config.ts`: `[plugin externalize-deps] Error: spawn EPERM` in `optimizeSafeRealPathSync`. **Zero tests executed.** No sandbox workaround or alternate runner was used.
- **Source review only:** game reads use `ctx.host.state`, queries/watches and the emergency view. Speed changes use `host.setSpeed(..., 'onboarding')`. Tool buttons still select the existing tools, leaving their command tags and gestures intact. New listeners are tied to `ctx.signal`, including emitter unsubscribe callbacks and watches. The guard holder, `abort('dispose')` and null-view implementation were untouched.
- **Not run here:** full Vitest, bot/reference hashes, browser/GPU runs, timing/performance gates. The bot's 196,101 result is an expected invariant, **not a measured result of this change**.

Test names / coverage in `tests/game/onboarding.test.ts`:

- `FH-01 founding predicates and card` (11 cases): roadless/front/yard zoning, disconnected strips, two-cell/six-cell edge roads, small/island scaling, utility reach, all recommended tool selections, catalog-derived wind text, absent/available Play, first-year transition, conditional fuel-plant tip, dry-edge hint cleanup.
- `FH-02 goal predicates` (17 cases): separate G1, G2, G3, G4, G5, G6, G7, G8, G9 and G10 predicates; host coverage facts; two-slot/power priority; trigger/completion latches; Help/chime stability; Budget/data-view/Why? events; queried landfill capacity and late-reply disposal; tax-projection/shore-copy boundaries.
- `FH-22 progress and profile boundaries` (4 cases): supplied G4 snapshot restoration without replica mutation, city/all-city choices, old-save/profile behaviour, malformed/future data. The snapshot test does **not** claim that the missing host writer exists or that an actual save at G4 works.
- `explainer framework and teardown` (7 cases): one slot/cooldown/profile memory/New Year gate; fixed problems/tips off; Easy pause and manual-speed override; founding-day spending ledger; completion-toast suppression during New Year; retained-DOM/emitter teardown; systems/speed/replica source scans.

Existing regression files left for the real runner include `tests/game/guideCopy.test.ts`, `tests/worker/hygiene.test.ts`, `tests/game/cityTeardown.test.ts` and `tests/game/cityDisposeCanvas.test.ts`, followed by the full suite. This base still skips W0.3b's global system-read gate and W0.6's global replica-write gate; the new test explicitly scans this lane's source files for both rules.

## Plan versus this base: owner requests and limits

1. **FH-22 — SIM / Worker prerequisite.** `SimHost.Commands` has no onboarding write command, and `protocol.SYSTEM_KEYS` has no `onboarding`. SIM must add a typed command and mirrored, saved key, then GUIDE must send changed `GuideProgress` snapshots through `host.act` with the appropriate tag. `Onboarding.progress` currently returns a detached snapshot; restoration reads an optional existing key. Progress, phase, city dismissal and timers currently survive Help reopening, **not a real save/reload**. Global dismissal, seen tips and minimise preferences use the existing profile store. A saved city-specific minimise value takes precedence when supplied.
2. **FH-01 — Toolbar / PlopTool prerequisites outside this sub-lane.** Recommended tools are selected now. Item pulses require `GuideHooks.mark` wiring and the Toolbar item argument; utility-card MW/header output and the turbine spacing ring still belong to their owners. `GameContext.openFlyout` currently accepts only category/tab. No Toolbar or PlopTool workaround was added.
3. **FH-02 — CityScene / TopBar prerequisites.** The existing category/play coach callback still works. Connect `GuideHooks.mark` for RCI, budget, approval, data views, reward and item coach targets after T030 / the split. Connect `GuideHooks.celebrating` to New Year's ownership/visibility state. **Explainer display is deliberately inactive without that hook**; there is no safe show-state source in the current context. This includes the spend guard and E7/E8/E12 delivery. With the hook supplied, queue pacing, New Year suppression, Easy pause and manual speed override are implemented/test-specified.
4. **G8 — InfoPanel prerequisite.** Wire `GuideHooks.openWhy` to arm/open/pulse Why? and call `onboarding.whyExpanded(buildingId)` after it is actually expanded on a growable. Selecting Query alone never completes G8. The card requests the hook on the first home query, but the current InfoPanel does not implement it.
5. **G5 / E8 — panel prerequisites.** G5 opens Budget through the existing panel API, which cannot select Taxes when another tab was last open. Its approximate tax-point number divides the watched, rounded tax lines by their current rates; a populated zero-tax group cannot supply that estimate, so it shows the budget instruction without a fabricated number. Share FH-05's eventual projection and add a Taxes-tab route when available. E8 takes a term-specific `GuideHooks.approvalFix` from FH-06; it is not offered without that action. The approval label/terms themselves are read from existing definitions/mirrored economy data.
6. **Phase D ownership.** `offerExplainer` is the shared entry point for FH-08's E1–E3, FH-13's E4–E5, FH-03's E6 and FEEL-06's E9. Their event owners are not edited here. E7 uses `capHints`; E8 uses the approval action hook; E12 uses actual unpowered homes and live power numbers. E10's district/rubble incident report is absent: the current disaster event supplies only kind/position/active. Its owner must supply structured damage data. E11 is an addition to the existing New Year toast, which this lane cannot edit. Neither E10 nor E11 is synthesized from news text or shown as a duplicate toast.
7. **G9 / NEW-06.** There is no valid-shore-site helper on this base. G9 uses the Mayor's House copy and omits `G9Next` until the actual placement predicate is available; it does not guess that water implies a valid Lighthouse site.
8. **Scaling / edge hint.** The plan specifies half targets for 64 tiles but no island formula. Current tuning is `min(size <= 64 ? 0.5 : 1, dryCells / 1024)` applied to 40/8/12, rounded up, with floors 4/2/2. This counts dry area, not validated whole building footprints. The hint uses a dry route and a real preview validation; it does not invent a bridge route on an island with no dry route to an edge. The actual 64-islands preset remains a browser gate.
9. **Acceptance wording.** “No step ticks while every zoned lot reads Not growing” cannot literally apply to the road step before zoning, or to zoning before utilities. This implementation follows the explicit listed predicates: neighbour connection, front/yard counts, existing utility reach, then one elapsed day. It also retains the old utility fallback when the utilities layer is absent. Please assess the broader wording against those explicit checks.
10. **Spring / older saves.** The spend guard uses the founding-day one-off ledger, excluding loan repayment and subtracting refunds, rather than inferring spending from current funds. It uses `systemData.foundedDay` when present and day zero otherwise. FEEL-05's later spring date therefore also needs its founded-day value available through the host mirror. Old saves without guide progress keep the under-300-population / under-40-buildings auto-show rule and legacy global dismissal.
11. **CSS path.** The plan names `src/ui/onboarding.css`; this assignment only grants `Onboarding.ts` and `guide/**`, so the new stylesheet is `src/ui/guide/onboarding.css`, imported by the card.

## Browser acceptance checklist for the lead

Run the scripted first-city checks at **1280×720**, after the missing owner hooks/host row above are integrated. Checks marked prerequisite cannot pass completely on this base.

FH-01:

- [ ] Roadless R/C/I zones leave step 2 open; road-front/yard counts meet 40/8/12 (20/4/6 on ordinary 64 tiles).
- [ ] A two-cell edge stub does not complete step 1; a six-cell road reaching at least three tiles in does.
- [ ] The road action displays a buildable edge hint without interfering with the next tool preview/stroke.
- [ ] Guide buttons select Road, residential low, Wind Turbine and Water Tower; flyout item pulses work after the Toolbar prerequisite.
- [ ] The power step's cost, spacing, MW and resident estimate match catalog/tuning; utility flyout output/header and ghost spacing ring work after their prerequisites.
- [ ] Guide Play is absent until steps 1–4 finish; the locked text is visible; Space/top-bar controls continue to work throughout.
- [ ] Utility steps stay open when the plant/tower reaches no zoned lot; inspect the lots' “Not growing” explanations against the explicit predicate limits above.
- [ ] Following only the founding guide spends at most §15,000 before Play on Medium.
- [ ] Repeat on the 64-tile islands preset, including terrain/edge-access limitations.
- [ ] Spend guard appears once per profile above 40% of starting funds on the founding day; fuel-plant completion tip appears only when appropriate. Explainer gate prerequisite applies.

FH-02:

- [ ] Fresh profile/city switches to “Your first year” and G1 after the first elapsed day; it stays available beyond six seconds.
- [ ] Never more than two goals and one explainer are visible; both goal buttons remain usable, including at 1280×720/minimised layout.
- [ ] Each G1–G10 condition ticks within one second of authoritative data becoming available, with one completion chime and no re-tick after regression/reopening.
- [ ] Guide-only Easy run reaches G9 / 2,500 residents by founding + 3 years; Medium by founding + 4 years; neither browns out before year 4.
- [ ] G10 is visible before the first brownout, ahead of population goals; separately verify more turbines and a gas plant each satisfy a full month's margin. It can still appear after G9 handover.
- [ ] First home inspection expands and pulses Why?; only actual expansion completes G8. Inspector prerequisite applies.
- [ ] Budget opens Taxes and quotes the correct estimate; police/fire/education/data/reward actions and all coach marks open/pulse their intended controls. Panel/TopBar prerequisites apply.
- [ ] Once wired, explainers respect Tips off, profile memory, the two-month interval, Easy/E1a pause rules, user speed changes and New Year suppression; check E7/E8/E12 and the other owners' E1–E11 integrations.

FH-22:

- [ ] Save at G4 and reload: phase, completed/started goals, dismissal and timing resume correctly. **Blocked by missing host writer/mirror.**
- [ ] A second city on the same profile shows founding unless All cities was chosen; This city affects only its own saved city. Saved dismissal requires the same prerequisite.
- [ ] Old save without the key retains its existing auto-show/dismiss/minimise behaviour; Help reopens its current phase without restarting progress.
- [ ] Exit/re-enter repeatedly with retained guide nodes and pending queries: no old-city callbacks, highlights, speed changes or listeners survive disposal.

Round 1 §8.1 gates left for the lead / owning lanes:

- [ ] Full Vitest and Worker hygiene; rerun `tsc` after integration.
- [ ] 128×15 seed-7 bot remains **196,101 in 2015**; required Medium/Hard two-process hashes for 256×60 s7/s11 and 128×15 s7.
- [ ] LG-10 flag-off/reference and signed-off polish gate summary.
- [ ] FH-10 newcomer targets plus the real-input 1280×720 run above.
- [ ] Ultra/1×/2× pacing and autosave probes with META's work.
- [ ] Spring new-city date and unchanged old-save date.
- [ ] Storage second-tab/quota and context-loss checks.
- [ ] y20 overhead at most +1 ms/frame and FEEL-04's building-flip timing.
- [ ] P-1, P-4 and P-5 persona passes with the applicable accessibility controls.

Unverified: all test execution, real save/reload, actual inspector/TopBar/Toolbar integration, tip delivery in the shipped scene, browser layout/GPU behaviour, newcomer outcomes, islands acceptance, bot hashes and performance. The pending interfaces above must land before this sub-lane can receive DONE.
