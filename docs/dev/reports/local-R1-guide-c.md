# T037c — FH-05: what a building does to the monthly budget, shown before it is placed

Branch `local/R1-guide-c` on dev `93b84a7`, with dev merged in before the push. The code was written by an agent lane
(Codex was out of credits) and reviewed, gated and browser-checked by the local worker.

## What it does

Before a building is placed, the plop tip and the build card say what it does to the monthly budget: "Monthly budget:
+§259 → −§280 after this".
- **The figures.** "Before" is last month's net, the figure the top bar shows, with one-offs (construction, loans,
  refunds) left out. "After" subtracts the upkeep the tip already quotes: the city-wide estimate until the spot's own
  `upkeepContext` reply lands, then the spot's cost. A business deal's income counts, since it pays as it is. A venue's or
  an airport's varies with its visitors, so the tip names it ("before its income (up to §N when busy)") instead of
  counting it.
- **Below zero** the line turns red and adds how long the money lasts ("≈ 7 months of reserves"), never more than 60
  months ("more than 5 years of reserves").
- **No line** before the city's first monthly report, in a sandbox, on a spot where the building cannot go, or when the
  building changes nothing. The card has no row when it cannot be selected (locked, already built, in ruins).
- **Files.** src/game/tools/Tool.ts (`budgetEffect`, `reservesText`, and `resultTip`'s optional extra line),
  src/game/tools/PlopTool.ts (the line under "Upkeep here"), src/ui/Toolbar.ts (the card's row between Upkeep and Size).
  No new query or watch. ZoneTool, NetworkTool and BrushTool are unchanged: FH-05 is about buildings.
- **Tests.** tests/game/budgetPreview.test.ts (10): the helper, including the plan's line exactly, one-offs, deals and
  venues, and the 60-month cap; the plop tip; the card; and the acceptance case, a 1,550-resident town with growth frozen,
  where the placed station's expense and the change in net land within ±15 % of the quote (measured against an identical
  town without the station, because the town drifts on its own).

## Review and gates (the local worker)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| Full vitest (with the fixtures) | **187 files passed, 1 skipped; 1,898 tests passed, 7 skipped** |
| The bot (128x15, seed 7) | identical to `93069fa`, action log included (196,101) |
| Browser check (below) | **9 of 9 pass** |

The review changed nothing in the logic. The browser check (Playwright's Chromium 141, RTX 5070 Ti) used a 1,506-resident
town built for it month by month with the tree's bot (the year-1 bot saves all land at 3,500-3,800 residents), plus
small_s7_y10, vet_s7_y21 and fresh Medium and Sandbox cities:
1. The town shows "+§42/mo" in the top bar.
2. Fire Station card: "+§42 → −§129 after this", red, "more than 5 years of reserves"; a deficit town reads "≈ 54
   months", a hard one "≈ 3 months".
3. Plop tip beside homes: "Upkeep here ≈§59/mo now", then the line in red, with the border still green; a rich city's
   line is dim.
4. No line on a blocked spot; on a no-road lot, the red no-road line and the building's own share (§48).
5. **Accuracy**, a station placed at a month's start and run one month, against a twin save without it:

   | City | Quote | Fire expense change | Net change vs the twin |
   |---|---|---|---|
   | 1,506 residents | §58.5 | +§58 (−0.9 %) | −§58 (−0.9 %) |
   | 985 residents (its only station) | §79.05 | Budget panel "Fire §80" (+1.2 %) | −§80 (+1.2 %) |
   | small_s7_y10 | §250 | +§248 (−0.8 %) | −§254 (+1.6 %) |

6. The cap: in a rich city made to run a deficit, nothing reads above 60 months.
7. No row or line: a first month, a sandbox (even with a report), a locked card, the built Mayor's House, a ruined unique.
8. Income: Casino "+§1,527 → +§4,127"; Zoo, Stadium, Amusement Park and Airport add their busy income; Water Pump
   "+§42 → +§17".
9. UI scale 70 %, 100 % and 150 %: the row and the tip line stay inside their boxes; no console or page errors.

**Fixed after the check (its two minors):**
- At 150 % UI scale on 1280x720 the extra row pushed more cards off the bottom of the screen (6 cards newly, by 8-30 px,
  and the first Power card by 116-119 px). The cause was older: `Toolbar.placeTip`'s wide-flyout branch keeps a tip
  below the flyout head even when it then leaves the screen (15-20 cards already did). A tip taller than the room left
  now covers the head instead.
- The card's row repeated a venue's busy-income note, which its Income row already gives, and wrapped to 4-5 lines. The
  card leaves the note out; the plop tip keeps it.
- Older, not this lane's: the Medical Research Center card's grid is 260 px wide in a 240 px box; Zoo, Stadium, Amusement
  Park and Airport cards list "Land value" twice.

## For the lead

- **FH-05's other half has no owner.** The finance advisor's wording (AdvisorsPanel) and its two acceptance items (the
  §150 / §540 unit test, and the months left capped at 60 in the advisor line) fall in no sub-lane: (c) may not edit
  AdvisorsPanel, and (b) covers FH-03 and LG-05. `reservesText` already has the 5-year cap to share.
- **Helper location:** the plan puts it in src/ui/guide/budgetDelta.ts, which the lane could not edit; it lives in Tool.ts,
  ready for FH-02's goal G5, FH-13 and FH-14 (or to move once sub-lane (a) merges). Sub-lane (a)'s report expects an
  "FH-05 projection query" for tax estimates: FH-05 defines none.
- **The upkeep figure** is the one the tip already shows (the spot's own cost since final fixes UI-1), not the plan's
  `expectedUpkeep`: the city-wide figure would contradict the tip and miss the ±15 % check (§171 quoted against §75 in the
  test town). The plan's example numbers predate the upkeep recalibration.
- **"Before" is last month's net**, as the plan says, so services placed earlier in the same month are not in it, and
  three placed in a row each start from the same figure. A forecast watch would fix that; the plan and an existing test
  rule one out for PlopTool.
- **Known biases, inherited from the quoted figures:** below 100 % funding, the building's own share is overstated (as
  "Upkeep here" already is); power and water plants quote their full-load upkeep.
