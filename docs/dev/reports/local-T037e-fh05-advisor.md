# T037e report: FH-05's other half, the finance advisor's wording, and the budget helper's move (desktop; NOTE-043, NOTE-047 item 3, NOTE-076)

**Status: implemented and unit-tested in the lane; the full vitest and the real-GPU checks are recorded by the desktop
worker at the end.** tsc is clean, the lane's tests and the related groups pass, and the bot is identical (192,899).

## Acceptance items (POLISH_PLAN FH-05, quoted)

- "Unit test: a net of §150 with a §540 cheapest unmet service gives the "small surplus" wording." Met.
- "The months-left text never exceeds 60 months." Met for the advisor line; T037c's tip text was already capped.

## Changes per file

- `src/ui/guide/budgetDelta.ts` (new): `BudgetEffect`, `budgetEffect` and `reservesText` moved from Tool.ts. The 52
  lines are byte-identical except that the literal `60` is now `RESERVE_MONTHS_MAX` (= 60), shared with the advisor
  line. New, for the advisor: `ASKED_SERVICE` (15 advice ids to 8 buildings), `askedServices`, `serviceLot`,
  `quotedUpkeep`, `recurringIncome`.
- `src/game/tools/Tool.ts`: the helper block and its three now-unused imports removed; one line re-exports the helper
  from the guide file. PlopTool.ts and Toolbar.ts are untouched and still import from Tool.ts.
- `src/ui/panels/AdvisorsPanel.ts`: the finance `assess` wording; `assess` takes an optional second argument (a
  function returning the cheapest asked service); one changed line in `cards()` passes it; a private block at the end
  of the class (`askedService`) and two constants at the end of the file. Nothing inside T037b's blocks changed.
- `tests/game/budgetPreview.test.ts`: the helper's 6 tests moved out; 4 remain.
- New tests: `tests/game/budgetDelta.test.ts`, `tests/game/financeAdvisor.test.ts`.
- No `src/sim/infra` hunk, no cloud-held file edited, nothing outside the named files.

## What the finance card says now

- **Doesn't fit** (the asked service costs more than last month's net): "A small surplus of §150 — a Fire Station
  costs about §540 a month. Grow the town or raise taxes a little first."
- **Healthy** (net at least 25 % of income, and the asked service fits or nothing is asked): unchanged, "A healthy
  surplus of §N last month. Consider investing in services."
- **Small, the service fits:** "A small surplus of §100 — a Fire Station costs about §85 a month and would leave §15."
- **Small, nothing asked:** "A small surplus of §249 last month. Grow the town or raise taxes a little before adding
  services."
- **Loss:** "We lost §183 last month. The treasury lasts more than 5 years at this rate." above 60 months; otherwise
  "runs dry in N months", "in 1 month" or "within a month".
- Sandbox, in-the-red and balanced lines are unchanged. Every surplus line keeps level `good`.

Where the cost comes from: the service is the cheapest building the other advisors' open issues ask for, found by
advice id (or `ref`), never by text. Its cost is the plop tip's own figure: the `upkeepContext` query on the nearest
road-side lot within 6 cells of the advice's place, asked once per issue list. Until the reply lands, or for advice
without a place, it falls back to the city-wide estimate, as the tip does. "Fits" uses the same test that turns the
tip's budget line red (NOTE-043 item 3: the line uses the tip's own upkeep, not expectedUpkeep).

## Tests

- `tests/game/budgetDelta.test.ts`, 12 pass: the 6 moved unchanged (the plan's town; a surplus that stays positive;
  one-offs never count; no line before the first report, in a sandbox or with no change; deal against venue income;
  the months of reserves, never more than 60), and 6 new (Tool.ts hands on the guide's own functions; every
  `ASKED_SERVICE` entry is a live rule asking for an unlocked building; `askedServices`; `serviceLot`; `quotedUpkeep`;
  `recurringIncome`).
- `tests/game/financeAdvisor.test.ts`, 11 pass: the §150 / §540 acceptance; "healthy" only from a quarter of the
  income and only when the surplus pays for the cheapest asked service; "fits" is the plop tip's own test; a balanced
  month, the red and a sandbox read as before and look no service up; the months-left text never exceeds 60; a
  1,550-resident town without a fire station quotes the same "Upkeep here" as a real PlopTool tip on that lot (§85
  against §171 city-wide); a surplus that pays for the station; a loss asks for no spot and a new month's issue list
  asks again; the cheapest of several asked services; a spot without a figure keeps the estimate; the Finance card on
  the replica (LoopbackSimHost).
- Revert checks: 11 mutations, each failing at least one test.

## Gates run in the lane (through quietrun)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| Lane files (budgetDelta, financeAdvisor, budgetPreview) | 27 of 27 |
| AdvisorsPanel, advice and sim-advisor group (10 files) | 98 pass |
| Tool / PlopTool / Toolbar group (19 files) | 210 pass |
| Whole-scene and panel group (11 files) | 89 pass, 1 skipped |
| `tests/worker/hygiene.test.ts` alone | 18 of 18 |
| Bot 128x15 s7 | residents [ 61124, 93804, 37971 ] = 192,899, identical |

Hygiene's "W0.2: speed writers…" case hit its 5 s timeout once (10.9 s) when run beside another file on the loaded
machine, and passed alone twice.

## Plan against code, and choices for the lead to confirm

1. **"Healthy" is stricter than the plan's sentence.** The plan says healthy "only when net is at least 25% of
   income"; this lane also requires the asked service to fit. With the 25 % rule alone, T037c's own +§259 on §900
   town would read "healthy" beside a tip that goes red, and the acceptance item names no income. To make 25 % always
   healthy, swap the two `if` lines in `assess`.
2. **Two wordings the plan does not give:** "the service fits" and "nothing asked". The plan's one sentence would
   contradict itself in those cases.
3. **"Cheapest unmet service" is undefined in the plan.** Read as the cheapest building the open advice asks for,
   which reproduces the plan's example (only the fire advice is open at about 1,500 residents). Left out:
   `schoolOvercrowded`, `plantFireReach`, `jailOvercrowded` (their fix depends on wording) and utilities.
4. **The spot.** Agreement with the tip holds on a lot beside the advice's "Show me" place; neighbouring lots are
   within 2 % in the fixture. For `plantNoFire` the place is the plant, where the station can cost only the bare §48;
   beside the homes it is about §85.
5. **The months line** also fixes "1 months" and adds "within a month" for under a month.
6. The plan's line references (`AdvisorsPanel.ts:41-42`) and its §540 example predate the upkeep recalibration.

Not changed, outside this lane's files: Toolbar's build card still quotes the city-wide "typical" figure (T037c's
accepted behaviour); PlopTool's header comment still says "Tool.ts budgetEffect"; the sim's own `surplus` advice
(30 %, §150k, 5,000 residents) still takes over the card when it holds; YearReview's "Bank N months" is a different
measure.

## Not verified in the lane

- Anything in a browser: wrapping of the longer text at 70 and 150 % UI scale, and the repaint when the reply lands.
- The real worker host (the packet path is covered by LoopbackSimHost only); cities larger than the 64-cell fixture.
- A spot read lost to a resync leaves the city-wide estimate until the next issue list (no retry, as the panel's
  existing fresh scan).

## Browser checklist

Default host, then `&simworker=loopback` and `?simworker=1`.

**Acceptance 1, the wording**
1. In T037c's 1,506-resident town (+§42 a month, no fire station), press N. Chief Reyes asks for a Fire Station;
   Morgan Price reads "A small surplus of §42 — a Fire Station costs about §NN a month. Grow the town or raise taxes
   a little first." with a green dot.
2. Click Chief Reyes' "Show me", pick the Fire Station, hover a road-side lot there: "Upkeep here ≈§NN/mo now" matches
   the card within a few percent, and the tip's budget line is red.
3. Force +§150 on §1,000 with an asked service cheaper than §150: the card reads "…and would leave §K", and K equals
   the tip's "after this".
4. Net at 25 % of income or more with the service fitting: "A healthy surplus…"; with it not fitting: the small-surplus
   line.
5. A wind-powered town with no service advice and a net under 25 %: "A small surplus of §N last month. Grow the town or
   raise taxes a little before adding services."
6. On the local host the figure should not visibly switch on opening; on the packet hosts one brief switch from the
   estimate is expected.

**Acceptance 2, months left**
7. Income §189, expense §372, funds §59,000: "We lost §183 last month. The treasury lasts more than 5 years at this
   rate."
8. Funds §10,980 gives "runs dry in 60 months"; §10,981 gives "more than 5 years". No count above 60 anywhere.
9. Below 8 times the loss (with residents) or below §5,000 (over 200 residents) the sim's own `deficit` / `lowFunds`
   advice takes the card, as before.
10. The tip's and the build card's "≈ N months of reserves" are unchanged.
11. UI scale 70 / 100 / 150 %: the finance text wraps inside its card; no console errors.

## The line for docs/dev/queue/T037-polish-r1-guide.done (appended at the merge)

`(e) FH-05, the finance advisor's half and the budget helper's move to src/ui/guide/budgetDelta.ts:
local/T037e-fh05-advisor, report docs/dev/reports/local-T037e-fh05-advisor.md; lane gates green (tsc; 27 tests in its
three files, 415 across the AdvisorsPanel / advice / Tool / scene groups; bot identical 192,899)`
