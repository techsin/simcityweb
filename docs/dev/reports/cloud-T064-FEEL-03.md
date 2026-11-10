# cloud T064 FEEL-03: money you can feel (chain guide2b, lane 2)

Task: docs/dev/queue/T064-guide-r2-cloud.md, section "t064-feel03". Plan item: docs/POLISH_PLAN.md "#### FEEL-03 · Money
you can feel: cost floats, animated funds, monthly and approval deltas". Branch `cloud/t064-feel03`, from dev 8450a9c
(FH-08-LIVE, the chain's lane 1, is in dev as 0b60f30), with dev merged in three times since: e58f8ac (FH-16) and
41ebcfb (FEEL-19), no shared file; a7a4ef4 (T065), which also edits src/ui/topbar/approvalSegment.ts, merged without
a conflict. Gated at 4687e29 (the last merge).

## Cloud carry-over (Nov 3)

### Gap list (written first)

New lane: no `local/*` branch, no earlier report, nothing of FEEL-03 in dev. NOTEs read: NOTE-044, NOTE-088 (the item
moves to the cloud), NOTE-061 (browser checks on the desktop), NOTE-092 (T065: approvalSegment.ts's identity cache on
replica hosts, in flight on chain fix1). No NOTE names T064's FEEL-03 beyond those.

| # | required (task file + plan Acceptance) | in dev at 8450a9c |
|---|---|---|
| a | cost float at the cursor on every successful paid commit: "−§25,018" red / "+§1,200 refund" green; rises 28 px, fades 900 ms; at most 6 pooled; transform and opacity only | missing: no src/ui/FloatText.ts; `commitAction` calls `feedback.ok` only |
| a2 | a plop adds "+§N/mo", its upkeep derived in Tool.ts from the command with `getDef()` and PlopTool's upkeep helper | missing |
| a3 | exactly once per commit (the exact prediction or the acknowledgement), never on failure | missing |
| b | funds count to the new value over 350 ms (at least 3 intermediate values), 400 ms red / green flash | missing: fundsSegment.ts swaps the text each HUD tick |
| c | month chip under funds for 2.5 s, value = Budget's "Monthly net (recurring)" (same function, tested); at ultra only on a sign flip or a change of 20% or more | missing |
| d | approval chip for 3 s when monthly approval moves by a point or more, "−2 · Taxes" (the term that changed most, terms and values only) | missing: approvalSegment.ts has no chip |
| e | sandbox: no floats or chips; funds "∞" and no net | partly: "∞" shown, but the red "−§X/mo" net is still printed |
| f | reduced motion (`resolveMotion`): no animation, values at once | missing (nothing animates yet) |
| g | no forced layout per frame | n/a until a-d exist |
| h | gates: tsc; floatText.test.ts fails with the change reverted; full vitest incl. hygiene; bot 198,115 (Tool.ts is src/game); trace diff = chip nodes and count-up writes | to do |

Desktop lanes the task names: T037e (`src/ui/guide/budgetDelta.ts`) and T078 (`A11Y_WIRED.motion`) are not in dev, so
nothing to merge in; FEEL-03 reads the existing `resolveMotion`.

### What changed (files, hunks and their §7.3 owners)

| file | hunk | owner |
|---|---|---|
| src/ui/FloatText.ts (new) | the pooled float layer: `FloatText.cost(cost, upkeep, key)`, `costText`, `upkeepText`, `attachFloatText` / `floatTextOf` (a WeakMap by context, so GameContext gets no new field) | GUIDE (FEEL-03's own file) |
| src/ui/floatText.css (new) | `.ft-layer`, `.ft`, `.ft-in`, `.ft-cost`, `.ft-sub` | GUIDE |
| src/game/tools/Tool.ts | the commit feedback hunk: `costFloat` beside both `feedback.ok` calls of `commitAction`, `plopUpkeep`; three imports | GUIDE ("the commit feedback hunk (FEEL-03)") |
| src/game/CityScene.ts | one line in the HUD wiring block after `new TopBar`: `attachFloatText(ctx, this.root, () => this.mouse)`, and its import | GUIDE (the HUD wiring block) |
| src/ui/topbar/fundsSegment.ts | (b) count-up and flash, (c) month chip, sandbox net | GUIDE (funds segment) |
| src/ui/topbar/approvalSegment.ts | (d) the chip element in the stack, `changeChip()` called at the end of `update()`, `biggestTermChange`, `approvalChipText` | GUIDE (approval segment) |
| src/ui/topbar/hudChip.ts (new) | `HudChip` and `reducedMotion(ctx)` shared by both segments | GUIDE |
| src/ui/hud.css | the `.hud-chip` selector family and `.hud-stack > .hud-sub:empty` | chain guide2b (T064 split); the funds and approval segments' selector family per §7.3 |
| tests/game/floatText.test.ts (new) | 29 cases | this lane |
| tests/game/fixtures/topBarTrace.json | re-recorded with `TOPBAR_TRACE=write` | chain guide2b |

How each part works:
- **(a)** `commitAction` calls `costFloat` right after `feedback.ok(predicted)` (exact tickets: the local host) and after
  `feedback.ok(r)` (acknowledged tickets: worker and loopback hosts). Those two calls are exclusive per commit, so the
  float shows exactly once, and never on a failure path. `costFloat` returns at once without CityScene's layer (every
  test context), for a failed or free result, and in a sandbox. A plop's upkeep: `plopUpkeep(st, args[0])` =
  `upkeepEstimate(st, getDef(id)).now` for a running-cost facility, else `def.upkeep` (the figures PlopTool's
  `spotNotes` quotes before its spot query answers; PlopTool.ts is not edited). The float sits at CityScene's tracked
  pointer (`this.mouse`, client px), in a layer fixed to the viewport outside the zoomed `.mp-ui`; it scales by
  `uiZoom()` in its transform. Web Animations keyframes hold only `transform`, `opacity`, `offset` and `easing`.
  `cost()` does its bookkeeping at once (pool, merge, generation) and queues every DOM write for one
  `requestAnimationFrame` callback, so the float is drawn in the frame after the commit (about 17 ms at 60 fps).
- **(b)** a changed treasury starts one `requestAnimationFrame` loop that eases the label from the figure shown to the
  new one over 350 ms from its first frame, writing only `textContent`. A change during a count-up continues from the
  figure shown. The flash is `el.animate([{ color, textShadow }, {}], 400 ms)` (implicit end keyframe; a browser
  without it gets no flash, in a try). One flash per direction at a time, so a held brush pulses instead of strobing.
- **(c)** the month index (`floor(day / 30)`) changing between HUD ticks is the month tick (the budget settles and
  approval updates in the same `advanceDay`, and a replica applies both in one packet). The chip shows
  `moneySigned(lastNet(ctx))`, where `lastNet` is `sumRecurring(lastIncome) − sumRecurring(lastExpense)`, the same sum
  and formatter BudgetPanel's "Monthly net (recurring)" row uses. Ultra (`sim.speed === 3`): `showMonthChip`.
- **(d)** at the month tick, the displayed approval (`round(approval)`, the figure the HUD shows) is compared with the
  one at the last month tick; a move of a point or more shows "±N · <label>" for 3 s. The label comes from
  `APPROVAL_LABELS` for the term that moved most in the same direction as approval (`biggestTermChange`). The term
  values are copied each month because a replica merges the monthly terms into one object (NOTE-092): the chip never
  compares identities.
- **Sandbox:** "∞", the net line empty (and hidden by `.hud-stack > .hud-sub:empty`), no chip, no count-up, no float.
- **Reduced motion** (`resolveMotion(settings.motion)`, 'system' follows the device): the figure is set at once with
  no flash; chips get `rm` (no transition); floats stand still for 900 ms (class `ft on`), then go.
- **No forced layout:** nothing in FEEL-03 reads layout (no rect, offset*, client*, scroll* or getComputedStyle), at a
  float's spawn or per frame; the test traps those reads on every element made and counts zero. FEEL-03's writes also
  never land between a read and the paint: the count-up and the floats write in their own animation-frame callbacks,
  which CityScene's frame loop precedes (it registers its next frame first), and the flash and the chips write in the
  HUD tick, after the loop's reads. That matters with edge scroll on (off by default): the camera then reads the
  canvas size every frame, after `tools.frame`, where a held brush commits.

### HUD trace (gate 6)

tests/game/fixtures/topBarTrace.json re-recorded with `TOPBAR_TRACE=write` (same 77 steps, same names). Step by step
against dev's fixture (calls, DOM writes and trees compared after unpacking):
- **both sessions' `construct`:** the two chip nodes, `div.hud-chip month` (the funds stack's third child) and
  `div.hud-chip appr` (the approval stack's third child), with their `class` writes; the two stacks write
  `children×3` instead of `children×2`. In every later step the two hidden chip lines are in the tree and nothing writes
  them.
- **`homes: sandbox`:** one more write, the net line's text, from "No report yet" to empty (acceptance 8: no net beside
  "∞"); **`homes: back from sandbox, no mayor, hard`:** the same text written back.
- **No other step changes:** calls, writes and trees match dev's, including T030's four "writes nothing" steps (the
  split test's second case passes).
- **No count-up writes:** the count-up runs only in a visible tab (decision 1). The trace's fake document has no
  visibility state and its `requestAnimationFrame` never calls back, so the trace sets the figure at once, as before;
  floatText.test.ts drives the count-up's frames instead. The diff therefore holds the chip nodes and, required by the
  sandbox item, the net line in sandbox.

### Decisions

1. **The count-up needs a visible tab and full motion**, else the figure is set at once. A hidden tab runs no
   animation frames (the label would wait for the tab to return), and reduced motion asks for none. Consequence: the
   HUD trace (a fake document without visibility) records no count-up writes; see above.
2. **Float DOM writes wait for one animation frame** (about 17 ms at 60 fps, inside the plan's 100 ms). With edge scroll
   on (off by default) the camera reads the canvas size each frame after `tools.frame`, where a held brush commits; a
   float written there would force that read to lay out. The writes now come after the city loop's reads. Bookkeeping
   stays synchronous: `cost()` returns at once, a newer float marks an older queued draw stale (a generation number),
   and a frame later than the float's life (a hidden tab) draws nothing.
3. **The month chip's value is the month's recurring net** (`lastNet`, what Budget shows as "Monthly net
   (recurring)"), not the treasury's change over the month (which also holds construction, loans and refunds). The task
   asks for that equality, and the test checks it against the BudgetPanel's rendered row for a surplus with one-offs, a
   deficit and a six-figure surplus.
4. **The ultra rule compares with last month's net**, whether or not a chip showed: a sign flip, or a change of at least
   20% of last month's net. Two equal nets never show at ultra (that also covers zero to zero). Below ultra, every month
   shows.
5. **The approval chip** compares the displayed score (`round(approval)`, the HUD's figure) at successive month ticks,
   so "−2" always matches the jump the player sees. The term is the one that moved most in approval's direction. The
   biggest move either way is the fallback, used only when no term moved that way. Reason: the biggest absolute move
   can have pushed the other way (parks +4 while taxes −3 and services −2 pull approval down 1), and naming it would
   give the wrong cause. `clamp` (the 0-100 limit) is never named. Labels are `APPROVAL_LABELS`, the card's names, so
   the plan's example "−2 · Taxes" reads "−2 · Residential taxes".
6. **One gesture's commits within 250 ms share one float**, with their costs added. A held brush commits every 70-120 ms
   (BrushTool), which would otherwise stream a float per commit and recycle the 6-element pool mid-rise. Every commit's
   cost is still shown; a coal plant (one commit) shows exactly its `ActionResult.cost`.
7. **The plop's upkeep** is `upkeepEstimate(st, def).now` for a running-cost facility, else `def.upkeep`: the figures
   PlopTool's tip quotes until its per-spot `upkeepContext` query answers. That answer is PlopTool's private state, and
   PlopTool.ts is chain guide2c's, so the float does not wait for it. For the coal plant (a flat upkeep) it is exactly
   the catalog's §700.
8. **"+§N/mo" exactly as the task writes it**, in amber under the red cost, so the plus sign reads as a monthly cost and
   not as income.
9. **A replaced state is no month tick.** A load (`replaceState`) or a replica's resync (`adopt`) hands the HUD a new
   state object; both chips then take a new baseline instead of showing a "change" the player never watched.
10. **No float before the pointer is known** (CityScene's mouse starts at −1, −1): a commit before any pointer move has
    no place to show its float. The funds count-up and flash still show the money moving.
11. **The float layer is found through a WeakMap keyed by the context** (`attachFloatText` / `floatTextOf`), so
    GameContext (src/game/context.ts, in no chain's column) gets no new field. CityScene attaches it in its HUD wiring
    block (GUIDE's hunk; CityScene.ts is in chain guide2b's column).
12. **Chips sit under the bar, absolutely placed** (`top: calc(100% + 6px)` of the segment), so showing one never moves
    the bar. The approval card (z-index 60) covers the approval chip while hovered.
13. **The bot runs although the change is UI behaviour**, because the diff touches src/game (Tool.ts, CityScene.ts),
    as gate 4 asks. No simulation change by design.

### Requests to other chains or the lead

- **T065 (chain fix1), approvalSegment.ts: done.** T065 merged first (66ad8a3); this lane merged it in (4687e29)
  without a conflict. T065 changed `update()`'s terms block (a content key built once per sim day); FEEL-03 adds the
  imports, the chip as a third child of the hud-stack in the constructor's `h(...)` line, its fields,
  `this.changeChip(...)` as the last line of `update()` and the `changeChip` method. Both T065's
  approvalCardReplica.test.ts and this lane's tests pass on the merged file. The chip copies the term values each month
  and never compares identities, so it needs nothing from T065 on replica hosts.
- **FH-23 (this chain's next lane):** text size should also scale `.hud-chip` (11.5 px, hud.css) and the floats
  (`.ft-in` 16 px, `.ft-sub` 12 px, src/ui/floatText.css).
- **T078 (FEEL-21, desktop):** nothing to change. FEEL-03 reads `resolveMotion(ctx.settings.motion)` as MilestoneCard
  does; once `A11Y_WIRED.motion` shows the in-game control, its value reaches FEEL-03 as is.
- **T037e (desktop):** it removes `budgetEffect` from Tool.ts. FEEL-03's Tool.ts hunk is in `commitAction` (two
  calls), two new functions between `commitAction` and `resultTip`, and three import lines after
  `import type { BuildingDef }`. If T037e drops that type import, the merge is a one-line conflict.

### What this lane did

Everything in the gap list: (a) cost floats, (b) the count-up and flash, (c) the month chip, (d) the approval chip, the
sandbox and reduced-motion rules, no forced layout, the trace re-record, 29 new tests, and the gates below. Nothing was
left for the desktop except the browser checks (Desktop QA, last).

### Acceptance (task file and plan)

| # | item | result | evidence |
|---|---|---|---|
| 1 | placing a coal plant shows exactly `ActionResult.cost` within 100 ms, plus "+§N/mo" equal to its upkeep | met: the float reads `moneySigned(-r.cost)` ("−§25,000" on the test's flat lot), equal to the funds drop, and "+§700/mo" = `getDef('util_coal_plant').upkeep`; drawn in the next animation frame (one frame) | floatText.test.ts "placing a coal plant floats exactly ActionResult.cost and its upkeep, drawn in the next frame" |
| 2 | a failed placement shows no float | met | "a failed placement shows no float"; "on an acknowledging host it floats once, at the acknowledgement, and never for a failure" |
| 3 | the funds label passes through at least 3 intermediate values | met: at least 3 asserted (a 350 ms count-up is about 21 frames at 60 fps), monotonic, 350 ms from the first frame; 400 ms flash, red down, green up | "counts to the new figure over 350 ms through at least 3 intermediate values, with a 400 ms red flash" |
| 4 | the month chip equals Budget's "Monthly net (recurring)" | met: compared with the BudgetPanel's rendered `.ledger-net` row for 3 budgets | "at the month tick it shows the month's net, equal to Budget's …" (3 cases) |
| 5 | the approval chip names the term that changed most | met (in approval's direction; see decision 5), also with the replica's in-place terms object | "when monthly approval moves by a point or more …", "reads the term values even when a replica fills the same terms object in place", "names a term that moved the way approval did …" |
| 6 | no forced layout is added per frame | met: no layout read at all; writes after the loop's reads | "adds no layout read per frame (nor at a float's spawn)"; Desktop QA 8 |
| 7 | reduced motion is honoured | met: floats still, figure at once without flash, chips without transition | "reduced motion: no animation; …", "%s: the figure is set at once, with no flash", "reduced motion: the chip shows and hides without a transition" |
| 8 | in sandbox the funds segment shows "∞" and no red net | met; no floats, chips or count-up either | "sandbox: "∞", no net, no chip, no count-up"; "no float in a sandbox, …"; trace step `homes: sandbox` |

### Gates (numbers)

1. **tsc** (`npx tsc --noEmit`, under sem.sh): clean at 0bc37a6, at 09a7ad2, at 672f529 and on the final merged tree
   4687e29.
2. **Revert check** on tests/game/floatText.test.ts (29 cases), each revert applied alone and undone after:
   - the whole src change reverted (dev's five files back, the three new src files removed): the file fails to load
     ("Cannot find module '../../src/ui/FloatText'"), 0 of 29 run;
   - Tool.ts without its two `costFloat` calls: 6 of 29 fail (the commit cases and the layout case);
   - fundsSegment.ts without the count-up, the month chip and the sandbox net rule: 11 of 29 fail;
   - approvalSegment.ts without the chip: 2 of 29 fail;
   - FloatText.ts without the pool cap, the Web Animation, the merge and the frame-batched writes: 9 of 29 fail.
3. **Full vitest** under the lock, on the final tree 4687e29 (08:09:18-08:15:32 UTC): 313 files passed, 4 skipped
   (317); 3,178 tests passed, 32 skipped (3,210); 0 failed; 373 s. It includes the Worker hygiene test
   (tests/worker/hygiene.test.ts: no `.speed =`, `emergencyOf(` or `getSystem(` added), replicaSafe, topBarSplit (the
   trace), topBarFrame and T065's approvalCardReplica. The run before the T065 merge (672f529, 07:40:55-07:47:19) was
   green too: 312 files passed, 4 skipped; 3,174 tests passed, 32 skipped; 0 failed; 384 s.
4. **The bot** (`npx tsx tools/simbot.ts --size 128 --years 15 --seed 7`, under the lock), because Tool.ts and
   CityScene.ts are src/game:
   - lane 4687e29: `residents [ 61828, 95515, 40772 ]` = 198,115 in 2015;
   - dev a7a4ef4, from a clean `git archive` export in co/t064-feel03-devbase: `residents [ 61828, 95515, 40772 ]` =
     198,115;
   - the two outputs match line for line except wall time ("done in 37.6s" against 38.9 s), the per-year timing
     columns (econms, totalms) and the ms/day line. No change by design. (The earlier pair, lane 672f529 against dev
     41ebcfb, matched the same way.)
5. **The lane's acceptance list:** all 8 met, table above.
6. **HUD trace:** re-recorded; the diff is the chip nodes and the sandbox net line, step by step above.
7. **Dev moved after these gates** (08:20 UTC): 1f4b99b holds desktop merge train 3, T041 (NEW-05: taxes slow growth
   gradually; BudgetPanel's tax colours and copy; tools/simbot.ts), and the dev bot reference became 192,236 by
   T041's design. A trial merge of 1f4b99b into this branch, in a scratch worktree removed afterwards, merged without a
   conflict; tsc was clean, and 7 test files (62 tests) passed: floatText, topBarSplit, T041's budgetTaxes,
   budgetTaxColor and budgetTaxCopy, approvalCardReplica, toolCommands. The month chip still equals Budget's row. This
   lane changes no simulation, so the merged tree's bot should read dev's 192,236. The merge step's full gate decides.

### Desktop QA (NOTE-059, NOTE-061, NOTE-088: on the real GPU, on dev after the merge)

Run on dev at this lane's merge commit, served by `npm run dev`. Sizes: 1280x720 for every item; 1920x1080 too for
items 1, 4 and 5 (the float's scale and the chips' place under the bar). Hosts: the default host and `?simworker=1` for
items 1-5 (the floats follow command results, the chips read sim data). "Pause" below means the Pause button (Space).
Reply "QA t064-feel03: PASS" or "QA t064-feel03: FAIL" with findings and screenshot paths.

1. **The coal plant's cost float, its refund float, and a failed placement.**
   - **Steps:**
     1. Open `/?quickstart=1` and pause. Note the funds figure in the top bar.
     2. Open the Power tab and choose the Coal Power Plant (its tip quotes the cost and "Upkeep §700/mo"). Click to
        place it on open, flat land. Take a screenshot within half a second of the click.
     3. Still paused, choose Bulldoze and drag over the plant (the demolition dialog says "Refund … (built today)";
        confirm it).
     4. Place a Coal Power Plant on water, or over a road, so the tip is red. Click.
     5. Repeat 1-4 on `/?quickstart=1&simworker=1`.
   - **Expected:**
     1. Step 2: at the cursor, a red "−§25,0xx" appears, with an amber "+§700/mo" under it. Together they rise about
        28 px (UI scale) and fade out in under a second. The figure equals the drop of the funds figure (and the
        one-off part of Budget → Income & expenses, "This month so far").
     2. Step 3: a green "+§… refund" at the cursor, equal to the funds' rise.
     3. Step 4: no float; the error sound and toast as before.
     4. Both hosts behave the same. On the worker host the float may come a frame or two later, never more than 100 ms
        after the click.
2. **Every paid tool floats once per commit.**
   - **Steps** (`/?quickstart=1`, paused):
     1. Drag a road of about 20 cells.
     2. Drag a residential zone.
     3. Hold the tree brush (Plant trees) for 2 s while moving slowly.
     4. Open a building's inspector and press its Demolish button.
     5. Click a spot where nothing can be placed (a building on a building).
   - **Expected:**
     1. One float per release (road, zone), with that action's cost.
     2. The held brush shows a short train of floats, each the sum of a quarter-second of planting, never more than 6
        on screen.
     3. Demolish floats at its button.
     4. Step 5: nothing floats.
     5. No float ever shows twice for one action.
3. **The funds count-up and flash.**
   - **Steps** (`/?quickstart=1`):
     1. Place a Coal Power Plant (or anything over §5,000) and watch the funds figure.
     2. Open Budget → Loans and take a loan.
   - **Expected:**
     1. The figure runs down to its new value in about a third of a second, through several visible intermediate
        values, with a brief red flash.
     2. On the loan it runs up with a brief green flash.
     3. At rest the figure reads exactly as before FEEL-03 ("§74,982"), red when below zero.
4. **The month chip at 1×, 2× and ultra.**
   - **Steps** (`/?quickstart=1`, a city with some residents and services so the net is not zero):
     1. Run at Normal (1) through a month end. Then open Budget → Income & expenses.
     2. Run at Fast (2) for three months.
     3. Run at Ultra (3) for a game year. Then change a tax by 3 points, so the net's sign flips or moves a lot.
     4. Repeat steps 1 and 3 on `?simworker=1`.
   - **Expected:**
     1. At each month end a small chip under the funds shows the month's net ("+§1,311", green; "−§968", red) for about
        2.5 s, then fades.
     2. Its value equals Budget's "Monthly net (recurring)" row for that month.
     3. At Fast every month shows one.
     4. At Ultra a steady city shows few chips: only when the net's sign flips or it moves by 20% or more (the tax
        change shows one).
     5. The chip never shifts the bar or the segments beside it.
5. **The approval chip after a tax change.**
   - **Steps** (a city of a few thousand residents, `/?quickstart=1`):
     1. Open Budget → Taxes and raise All residential to 13%.
     2. Run at Normal (1) to the next month end.
     3. Hover the approval segment while the chip shows.
     4. Repeat on `?simworker=1`.
   - **Expected:**
     1. When the approval figure drops by a point or more, a red chip under Approval reads "−N · Residential taxes" for
        about 3 s (N = the drop of the shown figure).
     2. Hovering shows the approval card above the chip.
     3. On `?simworker=1` the chip appears the same way (the replica fills one terms object in place, NOTE-092; the
        chip compares values).
     4. No chip in the first month after opening the city or loading a save.
6. **Reduced motion.**
   - **Steps:** set the OS to reduce motion (or DevTools → Rendering → Emulate CSS prefers-reduced-motion: reduce, then
     reload); repeat items 1 step 2, 3 step 1 and 4 step 1. The in-game Motion control stays hidden until T078 sets
     `A11Y_WIRED.motion`.
   - **Expected:**
     1. The float appears at the cursor without rising or fading, and disappears after about 0.9 s.
     2. The funds figure jumps to its new value at once, with no flash.
     3. The chips appear and disappear without a fade.
7. **Sandbox.**
   - **Steps:** open `/?quickstart=1&difficulty=sandbox`. Place buildings, roads and zones. Run through two month ends.
   - **Expected:** the funds show "∞" with no "/mo" line under it (the red "−§X/mo" is gone); no floats; no month or
     approval chips.
8. **A Performance trace while floats run.**
   - **Steps** (Chrome DevTools → Performance, `/?quickstart=1`, 1280x720):
     1. Record 5 s while placing three buildings and holding the tree brush.
     2. Turn on Settings → Edge scrolling, keep the pointer near (not at) the screen edge, and record the same again
        (the camera then reads the canvas size every frame).
   - **Expected:**
     1. No "Forced reflow" warning whose stack includes FloatText.ts or fundsSegment.ts, in either recording.
     2. The count-up frames show the label's text write in an animation-frame callback, and layout only in the
        rendering step.
     3. The floats animate on the compositor: transform and opacity only, no layout per frame.
