# T037 (topbar): the round-1 TopBar split (POLISH_PLAN §7.3, §7.4)

## Cloud carry-over (Nov 3)

The desktop was unavailable (NOTE-044), so the cloud's guide chain runs this new lane on `cloud/topbar`, from dev
`7348e09` (T037b merged at `b1fc37b`). No `local/*` branch holds any of it: the desktop never started the split
(NOTE-035 and NOTE-037 held it for the reset, NOTE-038 started it "after T030 merges", NOTE-044 to NOTE-047 give it to
the cloud).

### Gap list (required against done, written before any new work)

**Read:** docs/dev/queue/T037-polish-r1-guide.md; every NOTE that names T037 (035, 037, 038, 040, 042, 043, 044, 045,
046, 047, 048, 050, 051, 053, 056, 057, 059, 060, 061, 063, 064) and NOTE-044; the lead-notes branch's NOTE-067, 069,
073 and 075 (the ones that name the split); docs/dev/handoff/2026-11-04/README.md; POLISH_PLAN §4 (headings), §7.1-§7.6
and §8.0-§8.1 in full; T030's task file and report (docs/dev/queue/T030-ui-frame-cost.md,
docs/dev/reports/local-T030-ui-frame.md); T037a's report on `local/R1-guide-a` for what it will wire into the split.
There is no lane report and no lane diff to read: the lane starts from dev.

| # | Required | Where it comes from | Done at start |
|---|---|---|---|
| 1 | Split `src/ui/TopBar.ts` into a shell plus one component per segment under `src/ui/topbar/**`, so META, CONTENT and GUIDE stop editing the same `buildCenter` and `update()` | T037 "First, the TopBar split"; §7.3's TopBar row; §7.4 "Interfaces land first" | no |
| 2 | The segments follow §7.3's owners: META the shell, `buildLeft` (city name, mayor, difficulty, date) and the LIVE pill title; CONTENT the population segment; GUIDE the funds, RCI and approval segments, their popovers and coach marks, and the focus handlers | §7.2 GUIDE bullet; §7.3 | no |
| 3 | Change no behaviour. Keep T030's throttling (CityScene's ~6 Hz HUD tick, the refresh when the camera stops) and its frame-cost work (transform-scaled demand fills, no style write for an unchanged value, cached innerHTML, no layout reads in the update, no `will-change`) exactly | the lead's brief for this lane; T030 | no |
| 4 | The HUD is pixel-identical at rest and while the camera moves | the lead's brief; NOTE-061 §1 (the TopBar split's browser line) | no |
| 5 | Every importer keeps working: CityScene (`TopBar`), BudgetPanel (`isOneOff`, `sumOneOff`, `sumRecurring`), AdvisorsPanel (`lastNet`), InfoPanel (`DEV_NAMES`) | the current imports | n/a |
| 6 | Move or adapt the tests: topBarFrame.test.ts, approvalHud.test.ts and rciGuide.test.ts (`bar['issuesWatch']` reads a private field that moves), toastBudget.test.ts (reads `src/ui/TopBar.ts` for the demand-cap toast) | the lead's brief | no |
| 7 | Leave the hooks later lanes need in the right component: T037a's `GuideHooks.mark` wiring (NOTE-048 item 3, after the split reaches dev), FH-08's LIVE-title hunk "written against src/ui/topbar/**" (NOTE-048, NOTE-069), FH-23's focus handlers (NOTE-067), CONTENT's rank line. Their code is theirs: this lane adds none of it | NOTE-048, NOTE-067, NOTE-069 | n/a |
| 8 | Gates: tsc, the full vitest (with the Worker hygiene test, §8.1 check 1), the lane's tests; the bot only if src/sim, src/worker, src/game or src/save change | T037 gates; the lead's brief | no |
| 9 | The browser check (the HUD pixel-identical at rest and while moving) | NOTE-059 §3 kept the split's planned browser checks; NOTE-061 §1 (later, 9 Nov) moved every browser check, this split's by name, to the desktop's real GPU, and `lock.sh` refuses browser runs on the cloud | no |
| 10 | Report with this section, the `.done` line, everything committed on `cloud/topbar` | the lead's brief | no |

**Not this lane's:** T037 (a)-(e) and their acceptance (other sub-lanes; b, c and d are in dev, a and e are the
desktop's); §8.1's checks 2-10 (sim hashes, newcomer targets, pacing, spring start, storage, performance on the y20
save, personas) concern items this refactor does not touch; it changes no sim outcome and no file the bot runs.

### What the cloud did

**Commits on `cloud/topbar`** (from dev `7348e09`; dev `8c08b6a`, with W1.3, merged in at `1971e31`):

| commit | what |
|---|---|
| `fda254c` | The HUD trace harness and its reference, recorded on dev `7348e09`'s **unsplit** TopBar (plus this gap list) |
| `730efea` | One more trace step (opening the popover refreshes the whole bar), recorded on the unsplit TopBar |
| `c5fd354` | **The split.** The trace passes unchanged; two tests adapted |
| `5a29d0f` | One more trace step (a pointerdown elsewhere in the bar closes the popover), recorded on the unsplit TopBar at `730efea` in a throwaway worktree, after a mutation survived without it |
| `9911acc` | The split's contract test |
| `1971e31` | Merge dev `8c08b6a` (W1.3): no conflicts, no top-bar file and no HUD wiring touched |

**The split.** `src/ui/TopBar.ts` is now the shell, 76 lines (META's, §7.3). It builds the six components and lays
them out in the old DOM order: left glass, centre glass, spacer, right glass. `update()` ticks them in the old order.
It forwards `setCoachPlay`, `setBadge` and `closePopover`. Each component under `src/ui/topbar/` owns its DOM, its
listeners (all on `ctx.signal`, as before) and its update:

| file | owner (§7.3) | what moved there from the old TopBar.ts |
|---|---|---|
| `cityDate.ts` (`CityDateGroup`) | META | `buildLeft` (city menu, date with the PAUSED and LIVE pills, the LIVE pill's title, speed buttons, time of day), `setCoachPlay`, update's city/date/speed/time block |
| `fundsSegment.ts` (`FundsSegment`) | GUIDE | the funds segment and its update block; `sumValues`, `isOneOff`, `sumRecurring`, `sumOneOff`, `lastNet` |
| `populationSegment.ts` (`PopulationSegment`) | CONTENT | the population segment and its trend block (the rank line goes here) |
| `rciSegment.ts` (`RciSegment`) | GUIDE | the RCI segment, `buildRciPop`, `cappedDevs`, `capHints`, `renderRegion`, `renderCapHints`, `builtOutHint`, `updateZoneBadge`, `announceCaps`, `setRci`, `closePopover`, the outside-pointerdown listener, update's RCI block; `RCI_DEFS`, `CAP_TARGET`, `DEV_NAMES`, `familyDemand`, `capRatio`, `paintBar` |
| `approvalSegment.ts` (`ApprovalSegment`) | GUIDE | the approval segment, `openApprovalFix`, update's approval block with the FH-06 card |
| `panelButtons.ts` (`PanelButtons`) | META (the shell's right glass) | `buildRight`, `setBadge`, the panel-open highlight, update's emergencies badge |

- **The logic moves verbatim.** A line-by-line check of the old file against the new ones finds every
  non-structural line unchanged, apart from `this.apprSeg`, `this.leftGlass` and `this.rciSeg` becoming each
  component's `this.el`. The lines not found verbatim are imports, field declarations, the old builder methods'
  locals and returns, and the update's section comments.
- **Two behaviours cross a component boundary, and both are kept:**
  - `setRci(true)` called the whole bar's `update()`. The RCI segment now gets the shell's `update` as a `refresh`
    callback, so opening the popover still refreshes the date, funds, population and approval at once.
  - The emergencies badge was set in the middle of `update()`, between RCI and approval. The shell calls
    `buttons.update()` at that same point.
- **`setBadge` now searches the right glass, not the whole bar.** Only the right glass has `[data-panel]` elements,
  so it finds the same buttons.
- **Importers are untouched.** `TopBar.ts` re-exports the ledger and demand helpers, so CityScene, BudgetPanel,
  AdvisorsPanel and InfoPanel keep their imports. No in-flight lane has to rebase a panel import line; T037e and T041
  edit those panels.
- **The segments are public read-only fields of the shell** (`city`, `funds`, `population`, `rci`, `approval`,
  `buttons`). They are where the later lanes attach their hunks: T037a's `GuideHooks.mark` coach marks (on
  `funds.el`, `rci.el`, `approval.el`), FH-08's LIVE-pill title (cityDate.ts), FH-23's focus handlers and CONTENT's
  rank line (populationSegment.ts). This lane adds none of that code.
- **T030's work is untouched:**
  - CityScene's HUD cadence (the 0.16 s UI tick, the immediate tick when the camera stops) is not edited, and
    neither is any file outside src/ui and tests;
  - `paintBar` (transform `scaleY`, the corner-radius compensation, no write for an unchanged value) is moved byte
    for byte;
  - the cached innerHTML of the time of day and the trend, the class-compare on the net line, and the zone badge's
    compare-before-write are unchanged;
  - no layout read is added, and no CSS changes (`git diff` dev: no `.css` file), so no `will-change` layer appears.
- **Comments:** rciGuide.ts and approvalGuide.ts now name the segment files that draw them (comment lines only).

**Tests.**
- **New: the HUD trace** (tests/game/topBarTrace.ts, tests/game/topBarSplit.test.ts, the reference
  tests/game/fixtures/topBarTrace.json, 128 KB).
  - It is a scripted session of 77 steps on two 64 × 64 cities: a town with 4 empty lots and strong residential
    demand (71 steps), and a built-out city (6 steps).
  - It drives the bar only through its public API, with real clicks, `pointerdown` and `pointerleave` on the fake
    DOM. It covers every update branch: speeds, five times of day and a throwing world, debt, a compact surplus, no
    report, sandbox, an empty name and mayor, five population trends, mixed and capped demand (the heuristic, sim-core's
    `demandInfo`, and `demandInfo` throwing), the cap toasts with their half-year gate, the neighbours' line, the
    popover's open, ticks, inside clicks, cap-hint button, outside clicks and `closePopover`, the "+ zone" badge with its
    1 s recount, the emergency badge at 3, 12 and 0, every badge and panel button, the coach mark, the panel-open
    highlight, every approval band, face and row fix, and clicks after dispose. The built-out city adds LG-05's
    popover line with Rezone and Connect a highway.
  - After each step it records the whole DOM tree (class, title, inline style, dataset, attributes, text, markup with
    icons hashed, listener count), every DOM write by element and property, and every call into the game.
  - The reference was recorded on dev `7348e09`'s **unsplit** TopBar. The split passes it unchanged.
  - A second case states T030's skipping on the live trace: an unchanged tick writes nothing.
  - A later lane that changes the HUD on purpose re-records the trace (`TOPBAR_TRACE=write`). The fixture's diff then
    shows its DOM and write changes for review.
- **Mutation check of the trace** (scratchpad `topbar-mut/mut.py`, log `topbar-mut/mut.log`). Nine behaviour
  changes were made to the split, one at a time, and each one fails the trace test:

  | # | mutation | first failing step |
  |---|---|---|
  | M1 | the popover's open refreshes only the RCI segment | "funds and date move, then the popover opens", DOM writes |
  | M2 | population before funds in the centre glass | "construct", DOM tree |
  | M3 | `paintBar` writes every tick (T030's skip removed) | "five unchanged ticks", DOM writes |
  | M4 | the shell stops ticking the emergencies badge | "emergencies: 3 waiting" |
  | M5 | the approval card is rebuilt every tick | "five unchanged ticks", 56 elements written |
  | M6 | the speed buttons' listeners lose `ctx.signal` | "dispose, then clicks", calls |
  | M7 | the trend markup is rewritten every tick | "five unchanged ticks" |
  | M8 | the outside-click test scoped to `.hud-top` instead of `.rci-seg` | "reopen, then pointerdown on the funds segment" (this step was added after M8 first survived) |
  | M9 | `setBadge` searches the wrong glass | "emergencies: 3 waiting" |

- **New: the split's contract** (tests/game/topBarSegments.test.ts, 3 tests).
  - Each segment builds, ticks and handles its clicks without the shell.
  - The shell lays them out in the HUD's order and exposes them.
  - The RCI segment calls the shell's refresh once per opening, not on closing. With `if (open) this.refresh()`
    reverted to the segment's own `update()`, this third test fails (`topbar-mut/segments-neg.log`).
- **Adapted:**
  - rciGuide.test.ts reads the popover's `issuesWatch` on `bar.rci` (it read the private field on the bar);
  - toastBudget.test.ts reads the demand-cap toast's `{ budget: true }` from rciSegment.ts (it read TopBar.ts).
- **Unchanged, and passing through the shell:** topBarFrame.test.ts (T030's fills and settled values),
  approvalHud.test.ts, graphicsRestore.test.ts and the Worker hygiene test. The hygiene test walks src/ui
  recursively, so it covers src/ui/topbar/.

### Gates (cloud)

| gate | result | evidence |
|---|---|---|
| `npx tsc --noEmit` (sem) | clean, at the split (`c5fd354`), after the contract test (`9911acc`), and after the dev merge (`1971e31`) | scratchpad `topbar-mut/tsc.log` |
| The full vitest (lock, `SIM_FIXTURES` and `SIM_SNAP` set) at `1971e31` | **293 files passed, 4 skipped; 2,929 tests passed, 11 skipped; 0 failed** (507.7 s). Dev's own gate at the W1.3 merge `666f504` was 291 files and 2,924 tests passed with 4 and 11 skipped (cloud-carryover-log.md). The difference is this lane's 2 new files with 5 tests | scratchpad `topbar-mut/vitest_full.log` |
| The Worker hygiene test (§8.1 check 1) | passes in the full run; it walks src/ui recursively, so src/ui/topbar/ is scanned | as above |
| The lane's tests (sem, `--maxWorkers=2`): topBarSplit, topBarSegments, topBarFrame, approvalHud, rciGuide, toastBudget, graphicsRestore, hygiene | 8 files, 73 tests passed, in one run at `1971e31` | scratchpad `topbar-mut/lane_tests.log` |
| The trace against the unsplit TopBar | the same tree, DOM writes and calls on all 77 steps; the reference was recorded on the pre-split code (`7348e09`, then `730efea`) | `tests/game/fixtures/topBarTrace.json` |
| Negative controls | 9 of 9 mutations fail the trace (M8 after its step was added); the contract test fails with the popover refresh reverted | `topbar-mut/mut.log`, `topbar-mut/segments-neg.log` |
| The bot | **not run, by the rule.** The lane changes no file under src/sim, src/worker, src/game, src/save, src/core or tools (`git diff --name-only` against dev: docs, src/ui/TopBar.ts, src/ui/topbar/*, tests/game/*). Dev's reference stays `residents [ 61124, 93804, 37971 ]` = 192,899 | |
| The browser check (the HUD pixel-identical at rest and while moving) | **deferred to Desktop QA (NOTE-061)**; the list is below | |
| Newer dev | `825ee22` (T060's FH-12, merge `d2a9e2d`) landed during the gates. It changes src/main.ts, src/region and tests/game/firstCity.test.ts only, none of this lane's files, and `git merge-tree` with `cloud/topbar` is clean. Not merged here, so the gates above stay on the lane's head; the merge step merges dev and reruns the gates | |

**No server, browser or background process was left running.** No vite server was started and no vite cache was
written. The throwaway worktree `co/topbar-pre`, used to record the reference on the unsplit TopBar, was removed.

### Desktop QA list (NOTE-059, NOTE-061: run on the real GPU; report PASS or FAIL per line with screenshots)

The cloud's `cloud/*` branches are not on origin (NOTE-067), so run this **on dev after the merge**. Compare build
**A**, the merge commit's first parent (dev just before the split), with build **B**, the merge commit. Put each in
its own worktree (`git worktree add qa-a <merge>^1`, `git worktree add qa-b <merge>`) and give each its own
`npx vite --port <p>`. Use Chromium at **1280 × 720** with device scale factor 1, the same GPU and the same browser
build for both, unless a line says otherwise. Screenshots are clips of the HUD element's bounding box
(`.hud-top`, or the union with the open popover or card). "Identical" means 0 differing pixels. Lines marked
**(both hosts)** run on the default host and again with `&simworker=loopback`.

- **Page F (fake data, a full HUD):**
  `demo-ui.html?size=128&seed=4242&fake=1&onboard=0&disasters=0&speed=0`
- **Page T (a real town, paused):**
  `demo-ui.html?size=128&seed=4242&town=1&days=400&speed=0&onboard=0&disasters=0`

Wait for `window.__ready`, then 60 frames, before the first screenshot.

| # | Steps | Expected |
|---|---|---|
| Q1 (both hosts) | Page F and page T, at rest: screenshot `.hud-top`; also save `document.querySelector('.hud-top').outerHTML` | A and B: identical pixels and an identical outerHTML string |
| Q2 (both hosts) | Page T: orbit with a real right-drag for 3 s, then pan with the keyboard for 3 s; screenshot `.hud-top` every 250 ms while moving (24 shots), and once 0.5 s after the camera stops | Every shot identical to Q1's rest shot of the same build, and A's shots identical to B's. The game is paused, so nothing on the HUD changes while the camera moves |
| Q3 | Page T: `__scene.sim.runDays(31)`, wait 60 frames, screenshot; then click Fast for 5 s, Pause, and run `__scene.sim.runDays(...)` so A and B stop on the same day | A and B identical at the same day (date, funds, population, RCI fills, approval face) |
| Q4 (both hosts) | Page T: click the RCI segment; screenshot the bar with the popover; click the map | Popover identical on A and B (bars, values, the neighbours' line, cap hints); the map click closes it on both |
| Q5 | Page F: hover the approval segment; screenshot the card; click its Crime row | Card identical on A and B; the Police view opens on both |
| Q6 | Page F: click Budget in the right-hand buttons, then Advisors | Each button lights while its panel is open, and the advisors' unread badge behaves the same on A and B |
| Q7 | Page T: click Fast, then Pause, then Normal | The same button states and the same PAUSED pill on A and B; one sound per click |
| Q8 | Page F at 1024 × 640 (the narrow layout hides the time of day): repeat Q1 | Identical on A and B |
| Q9 (optional, quiet slot) | T030's fresh-page gate, A against B: the ui page at HIGH (first zoom-in, zoom-out, far orbit) and the real path at LOW (first pan, zoom-out, zoom-in); 8 interleaved reps, A/A copies, 90 % CIs, whole-main-thread CPU | B/A passes the lead's rule (no lower CI bound above 1.02). The trace test already shows the same DOM writes on every tick |

### Decisions (conservative readings, for the lead)

1. **The browser check is deferred to the Desktop QA list above (NOTE-061).**
   - The lead's brief for this lane asks for the HUD pixel-identical at rest and while the camera moves, and the
     workflow asks for browser checks to run here. NOTE-061 §1 (9 Nov) moved every browser check to the desktop's
     real GPU and names this split's check. `bin/lock.sh` refuses browser commands on the cloud and says not to run
     them another way. So no browser ran here.
   - **The cloud's substitute is the HUD trace.** On 77 steps it shows the same DOM tree, the same DOM writes and the
     same calls as the unsplit TopBar. No CSS file and no CityScene line changes, so the HUD gets the same writes at
     the same moments (rest, camera moving, camera stopping) and renders the same.
   - The real-GPU screenshots (Q1-Q8) are still the acceptance.
2. **The shell stays at `src/ui/TopBar.ts`;** only the segments go to `src/ui/topbar/`. §7.2 gives GUIDE
   "src/ui/topbar/** except the shell and the population segment", which allows either place. Keeping the shell where
   it is keeps CityScene's import and the panels' imports, and META owns the file as before.
3. **The panels keep importing the helpers from `../TopBar`** (re-exports), rather than from the segment files. That
   avoids an import conflict with T037e (AdvisorsPanel) and T041 (BudgetPanel), which edit those panels now. A later
   GUIDE lane can point them at `topbar/fundsSegment.ts` and `topbar/rciSegment.ts` directly.
4. **Owners:** the panel buttons are part of META's shell, since §7.3 names the shell, `buildLeft` and the LIVE title
   for META and does not name `buildRight` separately. The population segment is CONTENT's.
5. **No bot run.** The lane changes only src/ui and tests. No file under src/sim, src/worker, src/game, src/save, src/core
   or tools changes (`git diff --name-only` against dev, above), so by the brief's rule the bot cannot move and is
   not run.
6. **Seen, not changed (this lane must not change behaviour):** while the RCI popover is open, every HUD tick sets the
   12 demand-by-type bars' `title` again (the same strings), which is 12 attribute writes per tick at ~6 Hz. It is the
   only per-tick write left in the HUD (the trace's second case pins it). A title write causes no layout. If the lead
   wants it gone, it is a one-line compare-before-write in `RciSegment.update` and a re-recorded trace: a candidate for
   POLISH_BACKLOG.md.
7. **The trace stays as a permanent test.** Its reference is 128 KB of readable JSON (the trees stored as line diffs
   between steps). A lane that changes the HUD on purpose (FH-23, the LIVE title, the rank line, T037a's coach marks)
   re-records it with `TOPBAR_TRACE=write`, and the fixture's diff shows its DOM and write changes for review. If the
   lead prefers it gone after round 1, deleting the three files removes it; nothing else depends on them.
8. **§8.1's verifier list** applies to this lane only through check 1 (tsc, every suite, the Worker hygiene test).
   Checks 2-10 test items this refactor does not touch.
