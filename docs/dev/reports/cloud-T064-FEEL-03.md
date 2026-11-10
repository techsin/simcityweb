# cloud T064 FEEL-03: money you can feel (chain guide2b, lane 2)

Task: docs/dev/queue/T064-guide-r2-cloud.md, section "t064-feel03". Plan item: docs/POLISH_PLAN.md "#### FEEL-03 · Money
you can feel: cost floats, animated funds, monthly and approval deltas". Branch `cloud/t064-feel03`, from dev 8450a9c
(FH-08-LIVE, the chain's lane 1, is in dev as 0b60f30).

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
