# cloud T064 FEEL-03: money you can feel (chain guide2b, lane 2)

Task: docs/dev/queue/T064-guide-r2-cloud.md, section "t064-feel03". Plan item: docs/POLISH_PLAN.md "#### FEEL-03 · Money
you can feel: cost floats, animated funds, monthly and approval deltas". Branch `cloud/t064-feel03`, from dev 8450a9c
(FH-08-LIVE, the chain's lane 1, is in dev as 0b60f30), with dev merged in four times since: e58f8ac (FH-16) and
41ebcfb (FEEL-19), no shared file; a7a4ef4 (T065), which also edits src/ui/topbar/approvalSegment.ts, merged without
a conflict; and, in the fix round, 05cbf59 (T041's NEW-05 taxes and advisor copy, T062's ensemble tooling) as 938185c,
without a conflict. First gated at 4687e29; the fix round (section "Fix round" below) is gated at a1f9899.

## Cloud carry-over (Nov 10)

### Fix round (Nov 10): the review's five findings

The review of 4e4f123 found one major and four minors. Dev 05cbf59 was merged in first (938185c, no conflict, tsc
clean; decision 14), then the fixes went in as a1f9899. NOTEs read for this round: NOTE-044, and every NOTE that names
T064 or guide2b (NOTE-061 on dev; NOTE-088, -092, -094, -095, -096, -098, -099 and -100 on cloud/lead-notes). None
changes FEEL-03's scope. NOTE-094 flagged the same "Nov 3" heading leftover in FH-08-LIVE's report, and NOTE-095 stops
chain guide2b after this lane.

| # | finding | fix | test that fails with the fix reverted |
|---|---|---|---|
| 1 | **major:** for 2-5 months after any approval change the chip named the wrong cause. Approval follows raw by a 0.3 EMA, so it keeps moving while the terms stand still; the chip named whatever term wiggled, and the fallback named a term that moved the other way | `ApprovalCauses` (src/ui/topbar/approvalSegment.ts): each term's smoothed share of the shown approval, by the sim's own rule. The chip names the biggest push in the shown direction (at least 0.25 point, and more than the unexplained part), else the number alone ("How each part works" (d), decision 5) | "the months approval takes to catch up with a tax raise name the tax …", "the number alone for a rounding step …", "ApprovalCauses: …", and three real-sim cases (stressCity(64) seed 7, economy systems, residential taxes +3 / +5 / −3, 8 months, approval.ts's own EMA) |
| 2 | minor: a running-cost facility's "+§N/mo" used the city-wide typical figure, often several times the tip's "Upkeep here" | exact figures only: the catalog's upkeep where it is exact; the tip's figure when the commit passes it (`CommitFeedback.upkeep`, new); else no "/mo" line (decision 7). Request to chain guide2c for the one-line PlopTool change | "a running-cost facility floats the upkeep its tip quoted, and no city-wide guess without one" |
| 3 | minor: under reduced motion a float could stay up when its element was retaken before its hide frame and the next frame came late | the late branch of the queued draw stops the element and sets class `ft` when the draw still owns it (src/ui/FloatText.ts) | "reduced motion: a float whose element is retaken before its hide, with the next frame late, does not stay up" (the review's scenario) |
| 4 | minor: Desktop QA missed five states | item 5 now covers months 2-4 after the change and the way back up; new items 9 (chips against banners and toasts), 10 (a school's float against its tip) and 11 (the 100 ms, measured on both hosts and with a held brush); a grown-city route before the list | (desktop) |
| 5 | minor: three report inaccuracies | heading "Nov 10"; "How each part works" (a) rewritten: tickets are exact on every host while no other edit is pending, so single clicks float from the prediction on `?simworker=1` too; dev 05cbf59 merged and named, bot reference 192,236 | — |

**The approval chip month by month, old and new.** A scratch probe, not committed: stressCity(64) seed 7 with the
economy systems on 938185c, the lane head's segment (4e4f123) and the new one updated side by side once a month, all
three residential rates moved at day 360 (from 9%). Unemployment improved through every run: in the +3 run its term went
−5.46 → −5.13 → −4.05 → −4.00 → −2.83 over months 0-4, pushing approval up while the old chip blamed it for the fall.

| month after the step | +3 (to 12%): old | new | +5 (to 14%): old | new | −3 (to 6%): old | new |
|---|---|---|---|---|---|---|
| 1 | −3 · Residential taxes | −3 · Residential taxes | −4 · Residential taxes | −4 · Residential taxes | +2 · Residential taxes | +2 · Residential taxes |
| 2 | −1 · Unemployment | −1 · Residential taxes | −3 · Unemployment | −3 · Residential taxes | +1 · Unemployment | +1 · Residential taxes |
| 3 | −1 · Unemployment | −1 · Residential taxes | −2 · Unemployment | −2 · Residential taxes | +1 · Health (HQ) | +1 · Residential taxes |
| 4 | −1 · Unemployment | −1 · Residential taxes | −1 · Unemployment | −1 · Residential taxes | +1 · Unemployment | +1 · Residential taxes |
| 5 | — | — | −1 · Unemployment | −1 · Residential taxes | — | — |
| 6 | — | — | −1 · Unemployment | −1 · Residential taxes | +1 · Health (HQ) | +1 |
| 7-8 | — | — | — | — | — | — |

Two months before the step (a 0.24-point rise across a rounding line), the old chip read "+1 · Unemployment" and the new
one "+1". The tax term's share pushed approval by −3.15, −2.21, −1.54 and −1.08 in months 1-4 of the +3 run (the
shares' residual stayed under 0.02 after the step), which is why the new chip names it. With every system on, this
generated city stays empty (population 0, as in the review's probe1), so the probe uses the economy systems, as the
review did.

**The same in a grown city with every system on.** A second scratch probe (a temporary test file, run once under the
lock and removed): the bot grows 128x128 seed 7 for 4 years with `createSystems()` (27,826 residents), then stops, and
the sim runs on alone; all three residential rates move from 11% at day 1,530. Here more terms move each month (crime,
needs, emergencies, pollution, HQ), and the old rule named five different wrong causes:

| month after the step | +3 (to 14%): old | new | +5 (to 16%): old | new | −3 (to 8%): old | new |
|---|---|---|---|---|---|---|
| 1 | −4 · Residential taxes | −4 · Residential taxes | −6 · Residential taxes | −6 · Residential taxes | +2 · Residential taxes | +2 · Residential taxes |
| 2 | −3 · Unmet needs (schools, clinics) | −3 · Residential taxes | −4 · Crime at homes | −4 · Residential taxes | +1 · Air pollution | +1 · Residential taxes |
| 3 | −1 · Crime at homes | −1 · Residential taxes | −3 · Crime at homes | −3 · Residential taxes | +1 · Emergencies last month | +1 · Residential taxes |
| 4 | −2 · Unmet needs (schools, clinics) | −2 · Residential taxes | −2 · Unmet needs (schools, clinics) | −2 · Residential taxes | +1 · Health (HQ) | +1 · Residential taxes |
| 5 | −1 · Emergencies last month | −1 · Residential taxes | −1 · Emergencies last month | −1 · Residential taxes | — | — |
| 6 | — | — | −2 · Emergencies last month | −2 · Residential taxes | — | — |
| 7 | −1 · Crime at homes | −1 · Residential taxes | — | — | +1 · Health (HQ) | +1 · Residential taxes |
| 8 | — | — | −1 · Emergencies last month | −1 · Residential taxes | — | — |

The tax-named months fit the rule: the step's push in month k is 0.3 × 0.7^(k−1) of the step (10.5, 17.5 and 8.5
points of tax term here), so it stays at or above 0.25 point through month 8, 9 and 7 respectively; a chip shows only
in the months the shown figure changes. Before the step,
both rules named "−2 · Emergencies last month" in the first month; in the next one the old rule said "−1 · City
services at homes" and the new one "−1 · Emergencies last month" (that term's share was still catching up).

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
| src/game/tools/Tool.ts | the commit feedback hunk: `costFloat` beside both `feedback.ok` calls of `commitAction`, `plopUpkeep`; three imports; (fix round) the optional `CommitFeedback.upkeep` | GUIDE ("the commit feedback hunk (FEEL-03)") |
| src/game/CityScene.ts | one line in the HUD wiring block after `new TopBar`: `attachFloatText(ctx, this.root, () => this.mouse)`, and its import | GUIDE (the HUD wiring block) |
| src/ui/topbar/fundsSegment.ts | (b) count-up and flash, (c) month chip, sandbox net | GUIDE (funds segment) |
| src/ui/topbar/approvalSegment.ts | (d) the chip element in the stack, `changeChip()` called at the end of `update()`, `ApprovalCauses` (fix round; it replaces `biggestTermChange`), `APPROVAL_CAUSE_MIN`, `approvalChipText`; imports `APPROVAL` from sim tuning (read only) | GUIDE (approval segment) |
| src/ui/topbar/hudChip.ts (new) | `HudChip` and `reducedMotion(ctx)` shared by both segments | GUIDE |
| src/ui/hud.css | the `.hud-chip` selector family and `.hud-stack > .hud-sub:empty` | chain guide2b (T064 split); the funds and approval segments' selector family per §7.3 |
| tests/game/floatText.test.ts (new) | 37 cases (29 before the fix round) | this lane |
| tests/game/fixtures/topBarTrace.json | re-recorded with `TOPBAR_TRACE=write` | chain guide2b |

How each part works:
- **(a)** `commitAction` calls `costFloat` right after `feedback.ok(predicted)` for an exact ticket and after
  `feedback.ok(r)` for an acknowledged one. Exact: always on the main-thread host (LocalSimHost applies the command at
  once), and on the worker and loopback hosts whenever no other edit is pending (HostActions.act: `exact =
  pending.count === 0`), so a single click floats from the prediction there too. Acknowledged: an edit queued behind a
  pending one on those hosts (a held brush's later commits, a fast second click), and the loopback transport without
  its HostActions, which only tests use. Those two calls are exclusive per commit, so the float shows exactly once, and
  never on a failure path. `costFloat` returns at once without CityScene's layer (every test context), for a failed or
  free result, and in a sandbox. A plop's upkeep (fix round): `plopUpkeep(st, args[0], feedback.upkeep)` is the figure
  the tool's tip quoted when the commit passes one (the new optional `CommitFeedback.upkeep`), else the catalog's
  `def.upkeep` where that is exact (a flat-upkeep building, or any building in a city without running costs), else 0:
  a running-cost facility gets no "/mo" line until PlopTool passes its tip's figure (decision 7; PlopTool.ts is chain
  guide2c's and is not edited). The float sits at CityScene's tracked
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
  one at the last month tick; a move of a point or more shows "±N · <label>" for 3 s. The label (fix round) names the
  term that moved the shown approval most this month, from `ApprovalCauses`:
  - The sim moves approval each month by `APPROVAL.ema` (0.3) of its gap to raw, and raw is the sum of the terms
    (approval.ts:433). That rule is linear, so each term has a smoothed share of the shown approval that follows the
    same rule (`share += 0.3 × (term − share)`), and a month's move of the shown approval is exactly the sum of the
    shares' moves.
  - The chip names the term whose share moved approval most in the shown direction, if that push is at least
    `APPROVAL_CAUSE_MIN` (0.25 point) and larger than what the shares do not explain. The unexplained part is approval
    from before the city was opened, loaded or resynced: the segment starts the shares at that month's terms, so the
    gap between approval and their sum is unknown history, which fades as the sim smooths it away.
  - Otherwise the chip shows the number alone ("−1"). `clamp` (the 0-100 limit) and the constant `base` are never
    named. A month the HUD missed (two ticks between HUD updates) moves the shares by `1 − 0.7^k`.
  - So after a tax raise the chip names the tax in every month approval takes to catch up (the tax term's share is
    still catching up with the term), and never a term that improved meanwhile.
  The term values are copied each month because a replica merges the monthly terms into one object (NOTE-092): the
  chip never compares identities.
- **Sandbox:** "∞", the net line empty (and hidden by `.hud-stack > .hud-sub:empty`), no chip, no count-up, no float.
- **Reduced motion** (`resolveMotion(settings.motion)`, 'system' follows the device): the figure is set at once with
  no flash; chips get `rm` (no transition); floats stand still for 900 ms (class `ft on`), then go. (Fix round: a
  queued draw that comes too late but still owns its element now stops it and sets class `ft`, so a still float whose
  element was retaken before its hide frame can no longer stay up.)
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
   and a frame later than the float's life (a hidden tab, a long task) draws nothing and hides the element (fix
   round).
3. **The month chip's value is the month's recurring net** (`lastNet`, what Budget shows as "Monthly net
   (recurring)"), not the treasury's change over the month (which also holds construction, loans and refunds). The task
   asks for that equality, and the test checks it against the BudgetPanel's rendered row for a surplus with one-offs, a
   deficit and a six-figure surplus.
4. **The ultra rule compares with last month's net**, whether or not a chip showed: a sign flip, or a change of at least
   20% of last month's net. Two equal nets never show at ultra (that also covers zero to zero). Below ultra, every month
   shows.
5. **The approval chip** compares the displayed score (`round(approval)`, the HUD's figure) at successive month ticks,
   so "−2" always matches the jump the player sees. Its term (rewritten in the fix round, after the review found the
   first rule naming the wrong cause for 2-5 months after every approval change) is the one whose smoothed share moved
   the shown approval most in that direction this month (`ApprovalCauses`, "How each part works" (d)):
   - **Why shares, not term changes.** Approval follows raw by an EMA of 0.3, so for months after a tax step the shown
     figure keeps falling while no term moves. Comparing this month's terms with last month's then named whatever
     wiggled. The old fallback ("the biggest move either way") named a term that had pushed the other way:
     "−1 · Unemployment" three months running while unemployment improved. The shares follow the sim's own linear rule,
     so the named term really did push approval that way this month, and the lag months name the tax.
   - **The number alone** when no term pushed by 0.25 point or more, or when the unexplained part (approval from before
     the city was opened or loaded) is larger: a rounding step gets "+1", not "+1 · Health (HQ)". 0.25 is a
     conservative floor, measured on the fix round's probe (stressCity(64) seed 7, economy systems, dev 05cbf59 merged
     in; rows in "Fix round" above): the tax push in every month the chip named it was at least 1.08 (taxes +3), 0.88
     (+5) and 0.46 (−3). Two months showed the number alone: a rounding step before the tax change (largest push
     Unemployment 0.16 of a 0.24 move) and the 6th month after the −3 cut (largest push the tax, 0.23 of a 0.25 move).
     That second one is the price of the floor: a small true cause goes unnamed rather than a noise one named. The
     residual (what the shares did not explain) was at most 0.074 in every month, and shrank as the starting gap faded.
   - `clamp` (the 0-100 limit) and `base` are never named. Labels are `APPROVAL_LABELS`, the card's names, so the plan's
     example "−2 · Taxes" reads "−2 · Residential taxes".
   - The segment reads `APPROVAL.ema` from the sim's tuning (read only), so the shares follow if the constant changes. If
     the smoothing rule itself changed, the shares would only approximate it; floatText.test.ts's real-sim cases (they
     run approval.ts itself) would show that.
6. **One gesture's commits within 250 ms share one float**, with their costs added. A held brush commits every 70-120 ms
   (BrushTool), which would otherwise stream a float per commit and recycle the 6-element pool mid-rise. Every commit's
   cost is still shown; a coal plant (one commit) shows exactly its `ActionResult.cost`.
7. **The plop's upkeep: exact or quoted, never a city-wide guess** (rewritten in the fix round; a lead decision, taken
   the conservative way). The first version floated `upkeepEstimate(st, def).now` for a running-cost facility, the
   figure PlopTool's tip shows only until its per-spot `upkeepContext` query answers, which it normally does before
   the click. The review measured the gap (stressCity(64), day 30): the float said §702/mo for an elementary school
   where the tip said "Upkeep here" §134-284, high school §644 against §321-555, museum §1,035 against §278-367, and
   library §799 against §81-124; about 2-4x at days 60 and 90. Now:
   - a flat-upkeep building (the coal plant: exactly the catalog's §700), or any building in a city without running
     costs, floats `def.upkeep`, which is exact;
   - a running-cost facility (school, clinic, hospital, library, museum, police or fire station, park) floats the
     figure the tool's tip quoted when the commit passes it in the new optional `CommitFeedback.upkeep`, and no "/mo"
     line otherwise.
   PlopTool.ts is chain guide2c's, so it does not pass the figure yet: until it does, those facilities float only their
   cost. The request is below, and it is a one-line change. Prefixing the typical figure with "≈" was the other
   conservative option. It was not taken: the tip itself says "≈" with a figure several times smaller, so the two
   would still disagree.
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
14. **The fix round merges dev 05cbf59 in** (938185c, no conflict), so its gates run on today's dev: T041 changed the
    simulation, and the dev bot reference became 192,236 (NOTE-097, NOTE-101). This lane still changes no simulation,
    so its bot must read 192,236, not the 198,115 the task file names.
15. **Chips against emergency banners and toasts: Desktop QA first, then the lead.** `.emg-banners` (z 55, top 70 px,
    440 px wide, centred) and `.hud-tl` toasts (z 50, top 70 px; 66 px in `.short`) stack above `.hud-top` (z 40) in
    the band where the chips draw (about 66-88 px). So a banner or a toast that is showing at a month tick may cover a
    chip. The fix is a design choice: either extend UI-6's lift (`.hud-top:hover, .hud-top:has(.rci-pop.open)
    { z-index: 56 }`) with `:has(.hud-chip.on)`, which puts a chip over a banner's top edge for 2.5-3 s, or move the
    chips. The cloud cannot see it (no browser here), so the lane changes nothing and adds Desktop QA item 9; the lead
    picks the fix if the item finds a covered chip.

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
  calls), two new functions between `commitAction` and `resultTip`, the optional `upkeep` field at the end of the
  `CommitFeedback` interface (fix round), and three import lines after `import type { BuildingDef }`. If T037e drops
  that type import, the merge is a one-line conflict.
- **Chain guide2c (PlopTool.ts), fix round:** pass the tip's figure with the plop, so that a running-cost facility's
  float shows "+§A/mo" equal to the tip's "Upkeep here ≈§A/mo now". In `PlopTool.down`, add
  `upkeep: this.upkeepMo` to the feedback object of `this.commit('plop', ...)`, beside `ok` and `fail`. `upkeepMo` is
  already the figure `spotNotes` quotes: the spot's answer once `upkeepContext` has answered, else the typical figure,
  else the catalog's. Tool.ts already reads it (`CommitFeedback.upkeep`), and floatText.test.ts's "a running-cost
  facility floats the upkeep its tip quoted" checks the Tool.ts side. Until then, those facilities float their cost
  with no "/mo" line (decision 7).
- **The lead, after Desktop QA item 9:** if a banner or a toast covers a chip at a month tick, choose between UI-6's
  z-index lift extended with `.hud-top:has(.hud-chip.on)` and moving the chips (decision 15). hud.css is this chain's
  file, so the fix is a one-line follow-up in FH-23 (this chain's next lane) or a small commit.
- **The lead (T062's test, not this lane's):** tests/sim/botAaFundsNudge.test.ts's "keeps every annual non-timing field
  and saved state identical with the flag omitted or explicitly zero" plays two one-year bot games with every system
  inside vitest's default 5 s timeout. It timed out at 5,117 ms in this lane's full run on the loaded container (gate
  F4) and passes alone in 9.9 s for the file. An explicit timeout on that case, as botFallback, botObservations,
  botRules and botVenues give their long cases, would keep it from failing other lanes' full runs.

### What this lane did

Everything in the gap list: (a) cost floats, (b) the count-up and flash, (c) the month chip, (d) the approval chip, the
sandbox and reduced-motion rules, no forced layout, the trace re-record, 29 new tests, and the gates below. The fix
round then rewrote the approval chip's attribution, limited the plop float's upkeep to exact or quoted figures, fixed the
reduced-motion float that could stay up, added 8 tests (37 in all) and four Desktop QA items, and corrected the report.
Nothing was left for the desktop except the browser checks (Desktop QA, last) and chain guide2c's one-line PlopTool
request.

### Acceptance (task file and plan)

| # | item | result | evidence |
|---|---|---|---|
| 1 | placing a coal plant shows exactly `ActionResult.cost` within 100 ms, plus "+§N/mo" equal to its upkeep | met: the float reads `moneySigned(-r.cost)` ("−§25,000" on the test's flat lot), equal to the funds drop, and "+§700/mo" = `getDef('util_coal_plant').upkeep`; drawn in the next animation frame (one frame). Fix round: a running-cost facility floats the tip's quoted figure or no "/mo" line, never the city-wide typical one (decision 7) | floatText.test.ts "placing a coal plant floats exactly ActionResult.cost and its upkeep, drawn in the next frame"; "a running-cost facility floats the upkeep its tip quoted, and no city-wide guess without one" |
| 2 | a failed placement shows no float | met | "a failed placement shows no float"; "on an acknowledging host it floats once, at the acknowledgement, and never for a failure" |
| 3 | the funds label passes through at least 3 intermediate values | met: at least 3 asserted (a 350 ms count-up is about 21 frames at 60 fps), monotonic, 350 ms from the first frame; 400 ms flash, red down, green up | "counts to the new figure over 350 ms through at least 3 intermediate values, with a 400 ms red flash" |
| 4 | the month chip equals Budget's "Monthly net (recurring)" | met: compared with the BudgetPanel's rendered `.ledger-net` row for 3 budgets | "at the month tick it shows the month's net, equal to Budget's …" (3 cases) |
| 5 | the approval chip names the term that changed most | met (fix round): the term whose smoothed share moved the shown approval most this month, in its direction (decision 5), so the months after a tax step name the tax; the number alone when no term pushed by 0.25 point; also with the replica's in-place terms object | "when monthly approval moves by a point or more …", "reads the term values even when a replica fills the same terms object in place", "names the term that pushed approval its way …", "the months approval takes to catch up with a tax raise name the tax …", "the number alone for a rounding step …", "ApprovalCauses: …", and the three real-sim cases "a real city, residential taxes +3 / +5 / −3 points: …" (approval.ts's own EMA, 8 months after the step) |
| 6 | no forced layout is added per frame | met: no layout read at all; writes after the loop's reads | "adds no layout read per frame (nor at a float's spawn)"; Desktop QA 8 |
| 7 | reduced motion is honoured | met: floats still, figure at once without flash, chips without transition; fix round: a still float can no longer stay up when its element is retaken before its hide frame | "reduced motion: no animation; …", "reduced motion: a float whose element is retaken before its hide, with the next frame late, does not stay up", "%s: the figure is set at once, with no flash", "reduced motion: the chip shows and hides without a transition" |
| 8 | in sandbox the funds segment shows "∞" and no red net | met; no floats, chips or count-up either | "sandbox: "∞", no net, no chip, no count-up"; "no float in a sandbox, …"; trace step `homes: sandbox` |

### Gates (numbers)

Gates 1-7 are the first round's (at 4687e29); the fix round's gates follow them.

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
   lane changes no simulation, so the merged tree's bot should read dev's 192,236. Dev then moved on to 05cbf59 (T062:
   tools, tests and simbot.ts only), which the fix round merged in (decision 14); its gates follow.

**Fix round gates** (a1f9899: the fixes on 938185c, which is dev 05cbf59 merged into 4e4f123):

- **F1.** **tsc:** clean on 938185c (the merge alone, 13 s) and on a1f9899 (15 s), under sem.sh.
- **F2.** **Revert check** on tests/game/floatText.test.ts (37 cases), each revert applied alone and undone after:
  - src/ui/FloatText.ts back to 938185c: 1 of 37 fails, "reduced motion: a float whose element is retaken before its
    hide, …" (the element keeps `ft on`);
  - src/game/tools/Tool.ts back to 938185c: 1 of 37 fails, "a running-cost facility floats the upkeep its tip
    quoted, …" ("expected 702 to be +0": the school's typical figure, §702/mo);
  - src/ui/topbar/approvalSegment.ts back to 938185c: 6 of 37 fail: the lag months ("−2 · Unemployment" where
    "−2 · Residential taxes" is expected), the number alone ("+1 · Parks near homes" for a 0.075-point step),
    ApprovalCauses (not in the old file), and the three real-sim cases: "−1 · Unemployment in month 2" (+3) and
    "−3 · Unemployment in month 2" (+5), both a term that moved against the chip, and "+1 · Unemployment in month 2"
    (−3), not the tax in a catching-up month;
  - the lane head's ApprovalSegment class (4e4f123) under the new tests, ApprovalCauses kept: 5 of 37 fail, the same
    cases without the ApprovalCauses one.
- **F3.** **The neighbours** (sem.sh, 2 workers): floatText, approvalCardReplica, topBarSplit (the HUD trace), topBarFrame,
  topBarSegments and approvalHud: 6 files, 68 tests pass. The trace needs no re-record: the fix writes the same DOM in
  every trace step.
- **F4.** **Full vitest** under the lock on a1f9899 (09:09:29-09:20:19 UTC, 650 s; load average 7-10, with two ensemble jobs
  running beside it): 322 files passed, 1 failed, 4 skipped (327); 3,310 tests passed, 1 failed, 32 skipped (3,343).
  The one failure is a timeout in a test this lane cannot reach: tests/sim/botAaFundsNudge.test.ts "keeps every annual
  non-timing field and saved state identical with the flag omitted or explicitly zero", "Test timed out in 5000ms" at
  5,117 ms. It is T062's (dev 05cbf59): it plays two one-year bot games with every system inside vitest's default 5 s,
  and this lane changes neither tools/simbot.ts nor the sim. Rerun alone right after (sem.sh, 2 workers): 11 of 11
  pass in 9.9 s. The run includes the Worker hygiene test, replicaSafe, topBarSplit (the trace), topBarFrame and
  approvalCardReplica, with no failure among them.
- **F5.** **The bot** under the lock, because Tool.ts is src/game (09:21:23-09:22:11, "done in 45.4s"):
  `residents [ 61580, 93090, 37566 ]` = 192,236, dev's reference since T041 (NOTE-097, NOTE-101). Every year's
  population and approval match dev 05cbf59's own 128x15 seed 7 control (the ensemble check member, cache key
  2454b65a): 3,628, 10,082, 18,187, ... 173,035, 192,236 residents; approval 51, 50, 52, ... 79, 82. No simulation
  change, as designed.

### Desktop QA (NOTE-059, NOTE-061, NOTE-088: on the real GPU, on dev after the merge)

Run on dev at this lane's merge commit, served by `npm run dev`. Sizes: 1280x720 for every item; 1920x1080 too for
items 1, 4, 5 and 9 (the float's scale and the chips' place under the bar). Hosts: the default host and `?simworker=1`
for items 1-5, 10 and 11 (the floats follow command results, the chips read sim data). "Pause" below means the Pause
button (Space). Reply "QA t064-feel03: PASS" or "QA t064-feel03: FAIL" with findings and screenshot paths.

**A grown city (items 4, 5, 9 and 10).** Use a saved city of 3,000 or more residents if the QA profile has one. Else
build one once:
- (a) Open `/?quickstart=1&size=small&seed=7&difficulty=easy` (§250,000) and pause.
- (b) Place a Coal Power Plant near the middle. Drag a grid of roads around it, about 8 by 8 blocks with roads 6-8 cells
  apart.
- (c) Zone most blocks Residential (low density), two blocks Commercial and two Industrial.
- (d) Give the zones power and water if they show "No power" or "No water" (power lines, a water pump).
- (e) Place one Elementary School and one Clinic among the homes.
- (f) Run at Ultra (3) until the top bar's population passes 3,000. Save it (Ctrl+S) as "QA FEEL-03", and load it for
  those items on both hosts.

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
     4. Both hosts behave the same: a single click floats in the frame after the press on both, because the worker
        host's ticket is exact when no other edit is pending. Only an edit queued behind an unacknowledged one (a fast
        second click) floats when the worker acknowledges it. Item 11 measures the delay.
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
   - **Steps** (the grown city above, so the net is not zero):
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
5. **The approval chip after a tax change, and in the months approval takes to catch up.**
   - **Steps** (the grown city above):
     1. Open Budget → Taxes and raise All residential by 3 points (for example 9% to 12%). Note the approval card's
        "Approval X% heading for Y%" (hover the approval segment).
     2. Run at Normal (1) to the next month end.
     3. Hover the approval segment while the chip shows.
     4. Keep running through the 2nd, 3rd and 4th month ends after the change, at Normal or Fast (2).
     5. Lower All residential by 3 points below where it started (for example 12% to 6%) and run four more month ends.
     6. Repeat steps 1-4 on `?simworker=1`.
   - **Expected:**
     1. Step 2: when the approval figure drops by a point or more, a red chip under Approval reads
        "−N · Residential taxes" for about 3 s (N = the drop of the shown figure).
     2. Hovering shows the approval card above the chip.
     3. Step 4: approval keeps falling toward "heading for Y%" for a few months. Every chip in those months reads
        "−N · Residential taxes" or just "−N". Never another term: not "Unemployment" or "Health (HQ)", which the
        review saw there before the fix.
     4. Step 5: the chips turn green, "+N · Residential taxes" or just "+N", in the months approval climbs.
     5. On `?simworker=1` the chips appear the same way (the replica fills one terms object in place, NOTE-092; the
        chip copies values).
     6. No chip in the first month after opening the city or loading a save. In a city loaded while approval is still
        moving, the next months' chips may show just the number ("−2"): the cause came before the load.
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
9. **Both chips against emergency banners and toasts (fix round, decision 15).**
   - **Steps** (the grown city, 1280x720 and 1920x1080; a profile that has already seen the first-emergency lesson E1a,
     NOTE-094 correction 1):
     1. Run at Normal (1) to a few days before a month end.
     2. Get an emergency banner showing under the bar (a fire, as in t064-fh08live's QA) and leave it unanswered across
        the month end. Have a toast showing at the top left at the same time if one comes (advisor and news toasts
        do).
     3. Take a screenshot within 2 s of the month tick.
   - **Expected:**
     1. The month chip under the funds and the approval chip under Approval are fully visible, above any banner or
        toast. (The unanswered emergency usually moves approval, so the approval chip often reads
        "−N · Emergencies last month".)
     2. If a banner or a toast covers either chip, report FAIL with the screenshot: the lead picks the fix (decision
        15).
10. **A running-cost facility's float against its tip (fix round, decision 7).**
    - **Steps** (the grown city, default host, then `?simworker=1`):
      1. Choose the Elementary School. Hover a free spot next to a road until the tip reads "Upkeep here ≈§A/mo now".
         Note A.
      2. Click to place it.
      3. Place a Coal Power Plant as well.
    - **Expected:**
      1. The school's float shows its cost (red) and no "/mo" line. This holds until chain guide2c passes the tip's
         figure with the commit; from then on the float shows "+§A/mo", equal to the tip's A. A "/mo" figure that
         differs from the tip's A is a FAIL.
      2. The coal plant's float still shows "+§700/mo" under its cost.
11. **The 100 ms of acceptance 1, measured (fix round).**
    - **Steps** (Chrome DevTools → Performance with Screenshots on, 1280x720):
      1. On `/?quickstart=1`, paused, record while placing a Coal Power Plant with one click.
      2. Do the same on `/?quickstart=1&simworker=1`.
      3. On `?simworker=1`, record 3 s of holding Plant trees while moving slowly.
    - **Expected:**
      1. Steps 1-2: the float's first frame comes within 100 ms of the press, on both hosts. The press is the
         `pointerdown` event: the plop tool places on press. The first frame is the float's animation start, or the
         first screenshot that shows the red figure.
      2. Step 3: the first float comes within 100 ms of the press. A later commit made while an earlier one is still
         unacknowledged floats at its own acknowledgement (a `message` event from the worker in the main thread's
         track), within 100 ms of it. A commit made after the previous acknowledgement floats from the prediction, in
         the next frame. Commits within 250 ms of a float's start add into that float (decision 6).
