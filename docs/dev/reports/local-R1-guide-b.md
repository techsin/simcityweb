# T037b — FH-03 ("zone more" impossible to miss) and LG-05 ("your city is built out")

Branch `local/R1-guide-b` on dev `93b84a7` (with R1-interfaces' `NewsItem.ref`), with dev merged in before the push. The
code was written by an agent lane (Codex was out of credits) and reviewed, gated and browser-checked by the local worker.

## What it does

- **Refs.** Every advice post carries `ref: { advice }`, so toasts and cards find their button by ref, never by text.
  `Advice` gains an optional `ref` (a variant whose fix is another rule's) and `options` (a card's buttons).
- **FH-03.** Below 20,000 residents, zoneR / zoneC / zoneI are warnings with a 180-day cooldown, on top of the existing
  back-off (360, 720 days while the problem persists); from 20,000 they stay the quieter info every 90 days. Roadless
  zones give the noRoadAccess variant ("Build roads"); land only R$$$ wants gives zoneDev2. A toast and the Advisors
  card offer "Zone homes / shops / industry": the zone tool selected and the Zones button pulsing for 4.5 s, after a
  flight to the advice's place. The card adds "N empty residential lots left — demand wants many more".
- **LG-05.** The day-28 zone scan also counts free land: unzoned tiles with no building, network, water or power line.
  Under 1 % of the map, with a family's demand at 0.5 or more, a `builtOut` card (Planning, priority 7) replaces zoneR /
  C / I and the unemployment rule's "zone more". It names the three lowest-value occupied blocks ("Rezone": the Land
  value view and the Zones flyout, after a flight to the block), and a neighbour with spare jobs when jobs are what is
  missing ("Connect a highway"). Older saved scans lack the counter and are never built out.
- **Files.** src/sim/economy/advisors.ts (the GUIDE hunks), src/ui/adviceActions.ts (new: the advice id -> action map),
  src/ui/panels/AdvisorsPanel.ts; two small hunks outside the brief's list: src/ui/Notifications.ts (the toast's button
  by ref; no META lane is on that file) and src/worker/queries.ts (the advice read now copies `ref` and `options`, which
  its field copier dropped).
- **Tests.** tests/sim/advisors.test.ts (FH-03: the warning and its 180-day cooldown, room returning, the 20,000 line,
  C and I, roadless, R$$$-only; LG-05: built out with its three blocks and no zoneC or "zone more", the neighbour, room
  left (the y15 case), a pre-LG-05 scan) and tests/game/adviceActions.test.ts (10: each button's action, nothing keyed on
  text, a toast end to end).
- **Sim outcome:** unchanged. No system reads news or advice cooldowns, and the default bot never reads advice. What
  changes is news and advice state (kinds, refs, which advice posts, `systemData.advisors`, and the cooldowns and streak
  in `systemData.economy`, which a determinism check must exclude too).

## Review and gates (the local worker)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| Full vitest (with the fixtures) | **187 files passed, 1 skipped; 1,908 tests passed, 7 skipped** |
| The default bot (128x15, seed 7) | identical to `93069fa`, action log included (196,101) |
| FH-03's newcomer gate (`--profile newcomer --difficulty medium`): 5,000 residents by year 4 | **not met: 283** (table below) |
| FH-04's inherited gate (`--difficulty easy`): approval >= 50 % from year 2, year-6 population >= 2x Medium's | **not met:** approval 39-40 %, population equal to Medium's |
| LG-05 on the 256x60 seed-7 checkpoints | y15: not built out (50 % free), as required. **y55: not built out either** (below) |
| Browser check (below) | **8 of 8 pass**, except "Connect a highway", which no city could reach (the unit tests cover it) |

The review changed nothing; the two out-of-brief hunks are small and correct (the options are plain data).

**The browser check** (Playwright's Chromium 141, RTX 5070 Ti, 1280x720, real input for every action under test; setup
through host calls where noted). No console or page errors in 12 runs.
1. A new Medium town with its residential lots full by day 13 (R demand 0.85, setup by host calls): on day 30, the first
   month tick, an amber toast "…no room to grow — zone more residential land along roads." with "Zone homes".
2. The click selects zone:1 and pulses the Zones button for 4.41 s.
3. At ultra (19.6 days a second) from day 30 to 450, with the condition holding throughout, the toast came on day 30
   and day 390 only: the 180-day cooldown, doubled by the existing back-off.
4. Alex Stone's card: the advice, "No empty residential lots left — demand wants many more", "Show me" and "Zone homes"
   (same action, the panel stays open).
5. 12 residential tiles zoned with no road (a real drag): toast and card read "…but 12 residential tiles have no road
   access…" with "Build roads" (the Road tool, a flight to the block, Transport pulsing); no count line.
6. small_s7_y10 (121k residents): zoneR is info, posted to the ticker and the news feed; no toast in 420 days.
7. y55: 7.77 % free land, so no built-out card (zoneC and the unemployment line post, as above); y15: none either. A
   built-out test city (a sandbox map zoned to its last tile through host calls): on day 30 the built-out toast names
   three blocks and offers "Rezone" (a flight to the block, the Land value view, the Zones flyout); the card offers the
   same; no zone-more or unemployment issue while built out.
8. Toasts and cards readable at 1280x720.

**The QA fix round** (`ba37339`, on top of the WIP save `2195272`, which alone does not type-check: it lacks
`ZONE_RULE_IDS`):
- **F1:** the advice pulse has a class of its own (`advice-pulse`, sharing the coach mark's look), so the onboarding
  card's `Toolbar.setCoach`, which resets `coach` about twice a second, no longer ends it; a second pulse restarts its
  4.5 s.
- **F3:** below 20,000 residents a family with no zoned land gets no zone-more warning (a town still being laid out
  would spend the cooldown before its real stall), and zoning more of a family resets that rule's cooldown and
  back-off (`AdvisorData.zoned`, compared at each month tick), so the next stall is news at once.
- **F5:** each rezoning candidate is worded by its own main zone and never offered what it already is ("to housing or
  denser industry" for an industrial strip; a high-density residential block is passed over when only homes are wanted).

**The newcomer now acts on its cues.** With FH-03 it zoned 10 patches in 10 years where it zoned none before (FH-04's
report: it never grew past its four starting blocks), and its population went from about 100 to about 300. That is
still far from 5,000:

| year | Medium pop / approval | Easy pop / approval |
|---:|---|---|
| 1 | 160 / 28.6 % | 160 / 40.3 % |
| 2 | 221 / 26.4 % | 221 / 40.0 % |
| 4 | 283 / 25.0 % | 283 / 39.3 % |
| 6 | 283 / 25.0 % | 283 / 39.2 % |
| 10 | 324 / 24.3 % | 324 / 38.6 % |

The profile zones one 4x4 patch (seven road-facing tiles) per cue, and a cue comes at most every 180 days per family,
backing off while one patch does not lift the room back to 12 lots. That allows about eight residential patches by year
4, about 100 residents per two patches in the FH-10 runs. On Easy, the terms that hold approval under 50 are the ones
FH-04 named: residential taxes −7.0, air pollution −5.8 to −6.9, city services at homes −5.4.

**LG-05 on y55.** The plan expects the y55 checkpoint built out (under 1 % buildable free land). Regenerated at this
commit, it is not: 5,092 free tiles (7.77 % of the map), 2,145 of them road-facing (3.27 %) and 4,614 within three tiles
of a road; 1,528 lie within two tiles of the map edge. Demand there: R 0.02, C 1.00, I 0.45, unemployment 9.1 %. So the
card does not fire, and zoneC ("zone more commercial land") and the unemployment line still post. The city has
road-facing land a player could zone; the bot's patterns leave it.

## For the lead

1. **FH-03's newcomer gate.** It cannot pass with this profile. Options: a bigger patch per cue in the newcomer profile
   (tools/simbot.ts, LG-10's), no back-off for these warnings, or a lower target.
2. **FH-04's gate stays missed** after FH-03, so by D3 LG-09's extra Easy rules come in; the candidate terms are above.
3. **LG-05's threshold.** By the plan's own measure the y55 map is not built out. Options: keep 1 % (the advice is then
   right: there is road-facing land), count only land a lot could use (for example road-facing tiles in runs a growable
   lot fits), or raise the threshold. The checkpoint numbers are above; the probe is
   `scratchpad/t037b/freeprobe.ts` on the worker's machine.
4. **The TopBar parts are not done** (TopBar.ts was off limits): FH-03's RCI "+ zone" badge and LG-05's cap-hint line.
   They wait for the TopBar split; `emptyFrontTiles` in adviceActions.ts is ready for the badge.
5. The rubble variants of the zone rules keep the rule id (so the newcomer still zones on them) and show "Zone homes",
   a valid fix but not the one their text gives (bulldoze). LG-08, LG-04 and LG-12's options appear as they land.
6. **T037e (NOTE-043)** starts after this branch merges, since this touches AdvisorsPanel.

## Cloud carry-over (Nov 3)

The desktop is unavailable (NOTE-044), so the cloud finishes this lane on `cloud/t037b`: `local/R1-guide-b` (`ba37339`)
with dev `5b12abe` merged in (`67b567d`; advisors.ts and queries.ts merged without conflicts, T037d's `taxHigh` hunk and
this lane's zone rules being separate; tsc clean after the merge).

### Gap list (required against done, written before any new work)

Read: the task file, every NOTE naming T037 (NOTE-035, 037, 038, 040, 042, 043) and NOTE-044, POLISH_PLAN FH-03 and
LG-05 in full with their Acceptance lists, FH-10 (the newcomer profile), §7.2-§7.4 and §8.1, FH-04's report ("Not met",
the inherited newcomer gate), this report, and the lane's diff against dev.

| Item | Required | State at the desktop's stop |
|---|---|---|
| FH-03 change 1 | below 20,000 residents zoneR / zoneC / zoneI are warnings, at most once per 180 days | done (+ the F3 rules), tests |
| FH-03 change 2 | the toast's "Zone homes" selects `zone:1` and pulses Zones; found by `ref.advice`, never by text | done, tests, desktop browser check |
| FH-03 change 3 | FEEL-02a's toast budget queues the action toast | not this lane: FEEL-02a is META's (T036 step 3), not in dev yet |
| FH-03 change 4 | the RCI segment's "+ zone" badge (demand above 0.5, fewer than 12 empty front lots) | **not done** (TopBar; "waits for the TopBar split") |
| FH-03 change 5 | the Planning card's count, "4 empty residential lots left — demand wants many more" | done, tests |
| FH-03 acceptance | toast within one month tick and at most once per 180 days; click selects `zone:1`; the badge shows and goes at 12 lots; the newcomer passes 5,000 by year 4 on Medium; the ref test; advisors.test updated | 4 of 6: **the badge missing; the newcomer gate not met** (283 at year 4, before F3) |
| FH-04's inherited gate | re-run the Easy newcomer gate (approval ≥ 50 from year 2, ≥ 2× Medium's population in year 6) once FH-03 lands | **not met** before F3 (39 %, 1.0×); re-measure after F3 |
| LG-05 change 1-3 | the zone scan counts free land; under 1 % with a family's demand ≥ 0.5 a `builtOut` card (Planning, priority 7) replaces zone-more and unemployment; it names the three lowest-value blocks and only existing options, each a button | done, tests |
| LG-05 change 4 | the RCI popover's cap hints show the same line | **not done** (TopBar) |
| LG-05 acceptance | y55 (256×60 s7, regenerated): the card within a month, no zoneC / zoneI under 1 %; y15: never; each button opens its tool or view (UI test); the scan's cost unchanged | 2 of 4 met: **y55 is not built out** (7.77 % free), so the card never fires there; y15 fine; UI test and cost met |
| Fix round | F1, F3, F5 (`2195272` WIP + `ba37339`) | code and tests in; **never gated** (no full suite, no bot after it); WIP to verify line by line |
| Browser | the desktop's 8 items | 7 of 8 before the fix round; **"Connect a highway" never reached**; F1 / F3 / F5 not re-checked in a browser after their fix |
| Gates | tsc, full vitest, the bot at 196,101 | green before the fix round only; re-run here |
| Report | the fix-round paragraph, the numbers after F3, decisions with options | `FIXES_AFTER_QA` placeholder; numbers from before F3 |
| §8.1 verifier list | "at the end" of round 1, with META's items | not this sub-lane's: it runs once every GUIDE and META round-1 item is in |

The WIP save was verified line by line: `2195272` holds every code hunk of the fix round except `ZONE_RULE_IDS` (the
missing constant is why it does not type-check); `ba37339` adds the constant, the comments and the tests. Read against
the sim: the free count is one more test in the existing unzoned-tile branch of `scanZones` (each unzoned tile is seen
there exactly once, as the flood fill never visits it), `zonedFam` adds per-block family counts the pass already had,
`lowValueBlocks` runs only while built out, the F3 reset runs only in the month tick's `gather` (the Advisors panel's
`'open'` pass stays read-only, as the replica's query side-effects suite requires), and `queries.ts` copies `ref` and
`options` as plain data.
