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
   They wait for the TopBar split; `emptyFrontTiles` in adviceActions.ts is ready for the badge. (The cloud did both;
   see "Cloud carry-over" below.)
5. The rubble variants of the zone rules keep the rule id (so the newcomer still zones on them) and show "Zone homes",
   a valid fix but not the one their text gives (bulldoze). LG-08, LG-04 and LG-12's options appear as they land.
6. **T037e (NOTE-043)** starts after this branch merges, since this touches AdvisorsPanel.

## Cloud carry-over (Nov 3)

The desktop was unavailable (NOTE-044), so the cloud finishes this lane on `cloud/t037b`: `local/R1-guide-b`
(`ba37339`) with dev merged in six times:
- `67b567d` (dev `5b12abe`): advisors.ts and queries.ts merged without conflicts, T037d's `taxHigh` hunk and this
  lane's zone rules being separate;
- `00b96cb` (dev `48991d7`: B3 and T036 step 2): no conflicts; B3 moves the advisors' month-boundary work, and
  `585bde4` adds a test that its day-29 prediction agrees with the tick after the player zones more (F3's reset);
- `954306d` (dev `97f1a9c`, NOTE-045), `f077faf` (dev `fb1531f`, NOTE-046) and `5f634f6` (dev `90d1bad`, NOTE-047):
  docs only;
- `533178a` (dev `821a8d6`: T038, merged with no conflicts): src/render, tests/render and a bench tool only, none of
  this lane's files and nothing the bot runs (src/sim, src/worker, src/game, src/save, src/core and tools/simbot.ts are
  byte-identical between dev `97f1a9c` and `821a8d6`). The full vitest and the lane's bot ran again at this head.

tsc is clean at `67b567d`, `954306d`, `f077faf`, `5f634f6` and `533178a`. NOTE-045 to NOTE-047 keep T037b on the
cloud (the desktop is back, but must not touch it); NOTE-047 moves T037a and T037e to the desktop, T037e to start once
this lane is in dev.

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

### What the cloud did

**FH-03's badge and LG-05's popover line** (the two TopBar parts the desktop left for the TopBar split). T030 is merged
and the guide chain is serial (the split runs right after this lane, NOTE-044), so, as T037d did for the approval
segment, the hunks in TopBar.ts are small and the logic lives in a GUIDE file the split keeps:
- `src/ui/topbar/rciGuide.ts` (new, headless): `zoneBadge` — a family whose demand (the RCI bar's value) is above 0.5
  with fewer than 12 empty road-facing lots gets the badge, never on a built-out map (free land under 1 %, the advisors'
  own test: zoning more is not possible there); the click zones the strongest of them; the tooltip says how many lots
  are left ("Residential demand is strong, with 4 empty residential lots left. Click to zone homes."). `builtOutIssue`
  picks the built-out advice from the advisors' issues.
- `src/ui/adviceActions.ts`: `zoneRoom` counts the empty front lots per family and the free land in one pass over the
  mirrored layers (the free count is the zone scan's own definition; a test compares them); `emptyFrontTiles` reads it.
- `src/ui/TopBar.ts`, the RCI segment and popover only: the "+ zone" button under the bars, recounted at most once a
  real second (one pass over the map; it also notices zoning done while paused); a click runs the family's zoning
  action (`zone:1` / `zone:4` / `zone:8`, the Zones pulse) without opening the popover. While the popover is open the
  advisors' issues are watched monthly (as the Advisors panel does) and the built-out advice is shown first among the
  cap hints, with one button per option (Rezone, Connect a highway), each closing the popover.
- `src/ui/hud.css`: the `.rci-zone` rule next to the RCI segment's other rules, and the built-out hint's button column.
- `tests/game/rciGuide.test.ts` (new, 8 tests): the badge model (12 lots, demand 0.5, the strongest family, built out),
  `zoneRoom` against `emptyFrontTiles` and the zone scan's free count, the TopBar badge (shows, click selects `zone:1`,
  goes at 12 lots after the recount, returns at 11, goes when demand fades; industry zones `zone:8`), the popover's
  built-out line with Rezone (Land value view, Zones flyout, popover closed) and Connect a highway (`net:5`), no line
  with room left, and the badge on the replica (`LoopbackSimHost`: mirrored layers; a zoning command reaches it).
  Each fails with its behaviour reverted (the badge update removed: 3 fail; the built-out line removed: 1; the
  built-out guard removed: 1; water counted as free land: 1).

**The fix round's tests, reverted one fix at a time** (never done on the desktop): F1 (the pulse under the `coach`
class) fails the coach-update test; F3's no-zoned-land guard removed fails its test; F3's reset removed fails the
"advice followed" test; F5 (a block offered its own family) fails 4 LG-05 tests.

### Gates (cloud)

Heavy runs under the shared lock, tsc under the CPU semaphore. Logs in `scratchpad/t037b/gates/` (the `m3_*` files are
the runs at `954306d`; the head's code is byte-identical to it).

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean at `67b567d`, `954306d`, `f077faf` and the head `5f634f6` |
| Full vitest (`--configLoader runner`, fixtures present), at `954306d` | **218 files passed, 1 skipped; 2,182 tests passed, 4 skipped** (474.8 s; `m3_vitest.log`) |
| The bot, 128 × 15, seed 7: the lane at `954306d` against a clean export of dev `97f1a9c` (`co/t037b-devbase`) | **identical**: both `residents [ 61124, 93804, 37971 ]` = 192,899, NOTE-045's reference after B3; the whole log is identical but for its two timing columns (`m3_bot_lane.log`, `m3_bot_dev.log`). Before B3, at `67b567d` against dev `5b12abe`: both `[ 59288, 95301, 41512 ]` = 196,101 |
| FH-03 acceptance 1: R demand above 0.5 and fewer than 12 empty R front lots: the toast within one month tick, at most once per 180 days | met (unit tests; browser A1, A4; F3's reset is decision 4) |
| FH-03 acceptance 2: the click selects `zone:1` | met (unit tests; browser A2, B3, B6) |
| FH-03 acceptance 3: the badge shows, and goes at 12 empty front lots | met (`rciGuide.test.ts`; browser B2, B7) |
| FH-03 acceptance 4: the newcomer passes 5,000 residents by year 4 on Medium | **not met: 2,348** (dev 100; below, decision 1) |
| FH-03 acceptance 5: the action found through `ref.advice` (a test changes the text) | met (`adviceActions.test.ts`) |
| FH-03 acceptance 6: `tests/sim/advisors.test.ts` updated | met |
| FH-04's inherited gate (Easy approval ≥ 50 % from year 2; year-6 Easy ≥ 2× Medium) | **not met**: 39.0-39.7 %, 0.98× (decision 2) |
| LG-05 acceptance 1: on y55, regenerated, the card within a month, no zoneC / zoneI under 1 % | **not reached**: y55 has 8.10 % free land, so the card rightly does not fire (decision 3); the built-out behaviour itself is met on a built-out map (unit tests; browser C1-C7) |
| LG-05 acceptance 2: on y15 it never fires | met (51.12 % free; no built-out issue after a month) |
| LG-05 acceptance 3: each button opens the right tool or view (UI test) | met (`adviceActions.test.ts`, `rciGuide.test.ts`; browser C5, C7) |
| LG-05 acceptance 4: the scan's cost unchanged | **met in substance** (decision 9): no new pass, one more test in the scan's existing unzoned-tile branch (plus F3's per-block family counts). The day-28 scan alone (`scratchpad/t037b/scanbench.mts`: `advisorsSystem.daily` on day 28, the scan forced fresh), median ms, lane / dev: bot256_s7_y60 2.497 / 2.502 and 2.483 / 2.484 (no change); dense1m_s7, eight alternating pairs, median ratio **1.05** (1.18, 1.01, 0.73, 1.02, 1.04, 1.07, 1.07, 1.06), about 0.1 ms on a 1.7-2.0 ms scan that runs once a month (`m3_scanbench.log`, `m4_scanbench2.log`) |
| The badge's recount (UI thread, at most once a real second) | `zoneRoom` on the 256 fixtures (node, 300 rounds; `gates/m5_roombench.json`): bot256_s7_y60 median **1.55 ms** (p90 2.24, max 4.40); dense1m_s7 median **0.59 ms** (p90 0.62, max 1.21). Once a second, so under 0.2 % of the main thread; decision 10 |
| Browser checklist (below) | **19 of 19 checks pass** (C0 is the setup), "Connect a highway" included |
| §8.1's round-1 verifier list | not this sub-lane's: it runs once every GUIDE and META round-1 item is in |

### The newcomer gates, re-measured after F3

`npx tsx tools/simbot.ts --profile newcomer --difficulty medium|easy --seed 7` (128 cells, 10 years, founded day 90),
under the lock, on this branch at the final merge (`954306d`) and on a clean export of dev `97f1a9c` (no FH-03; B3 in
both):

| year | dev Medium | **lane Medium** pop / approval | dev Easy | **lane Easy** pop / approval |
|---:|---:|---|---:|---|
| 1 | 97 / 26.6 % | **687** / 29.2 % | 97 / 38.9 % | **687** / 40.0 % |
| 2 | 100 / 25.5 % | **1,553** / 26.7 % | 100 / 39.2 % | **1,553** / 39.7 % |
| 3 | 100 / 24.5 % | **2,326** / 26.5 % | 100 / 39.2 % | **2,302** / 39.6 % |
| 4 | 100 / 25.4 % | **2,348** / 21.4 % | 100 / 39.2 % | **2,351** / 39.0 % |
| 6 | 100 / 25.4 % | **2,324** / 20.4 % | 100 / 39.2 % | **2,284** / 39.3 % |
| 10 | 112 / 26.2 % | **2,220** / 14.0 % | 112 / 40.6 % | **2,157** / 29.3 % |

(The same runs before B3, at `67b567d` against dev `5b12abe`: Medium 2,192 at year 4, Easy 2,336; dev's rows were the
same as now. Logs: `scratchpad/t037b/gates/m3_nc.log`, `m3_ncdev.log`; before B3 `nc_medium.log`, `nc_easy.log`.)

- **FH-03's gate (5,000 by year 4 on Medium): not met, 2,348** (23× dev's 100). The desktop's pre-F3 run had 283; F3's
  reset lets the newcomer answer each cue as soon as its patch is full. Beyond its four founding blocks it zoned 47
  patches in ten years on Medium (36 residential, the last in April 2003; 9 commercial, the last in September 2003; 2
  industrial, in June 2000 and May 2001) and 44 on Easy (35, 7, 2); dev's newcomer zoned none beyond its founding
  blocks, and the desktop's pre-F3 run 10 (`scratchpad/t037b/ncpatches.mts`, log `gates/m5_ncpatches.log`; the bot
  itself prints only its last 25 log lines).
- **FH-04's inherited gate: not met.** Easy approval 39.0-39.7 % in years 2-6 (≥ 50 required); year 6 Easy / Medium =
  2,284 / 2,324 = 0.98× (≥ 2× required). The terms that hold Easy under 50 are FH-04's: residential taxes −7.0, city
  services at homes −5.4, air pollution −3.6 to −4.7, and from year 7 unemployment −12.0 to −12.8.
- **§8.1's newcomer target** (2,500 by year 3 on Easy, by year 4 on Medium) is lower than FH-03's 5,000; it is missed
  too, by little: 2,302 (Easy, year 3, −8 %) and 2,348 (Medium, year 4, −6 %).
- **Why the town stops at about 2,350** (a monthly trace of the Medium run's first five years at the final code,
  `scratchpad/t037b/ncdiag.mts`, log `gates/m4_ncdiag.log`): the cue is no longer what is missing.
  - Homes: the residential room is 0 every month and zoneR posts every month until year 3.1; the newcomer answers it.
  - Industry: zoneI posts in years 0.17-0.25 and 1.08-1.17, while fewer than 8 industrial lots are empty. After that the
    industrial room stays at 11-12 empty front lots for good, with industrial demand 0.5-0.8, so zoneI never fires
    again (its rule needs fewer than 8 lots), and those lots never fill. The game's own `lotsSmallI` advice posts in
    years 1.25-1.33 ("your empty industrial lots are odd tiles … too small for factories").
  - Jobs: unemployment is 0 % until year 2.2, 5-8 % in years 2.3-3.0, 23.5 % at year 3.3 and 14-15 % from year 3.5 to 5.
    At year 10 the town has 580 jobs (156 of them industrial) for 2,220 residents.
  - Residential demand falls under 0.5 at year 3.1 (0.46, then 0.27-0.39), which ends the zoneR cue; population is
    flat at about 2,350 from year 3.2.
  - The unemployment warning ("Zone more commercial and industrial land") posts from year 3.0; the newcomer profile
    ignores it.
  - Approval on Medium falls with crime (crime at homes −12.0 at year 1 to −17.3 at year 10, the top term every year).

### LG-05 on the 256×60 seed-7 checkpoints, regenerated here

`tools/simbot.ts --size 256 --years 55 --seed 7 --save-years 15,55`, regenerated at the final code (`954306d`, B3 in;
240 s with the lock wait; the run is the same as the 60-year one up to year 55). The probe
(`scratchpad/t037b/freeprobe.mts`) loads each save, counts free land exactly as the zone scan does, and runs the full
systems (`createSystems`) 31 days through the scan days and a month tick (logs `scratchpad/t037b/gates/m3_probe_y15.log`,
`m3_probe_y55.log`):

| checkpoint | residents | free land | road-facing free | within 3 of a road | within 2 of the map edge | demand R / C / I | unemployment | built-out card |
|---|---:|---:|---:|---:|---:|---|---:|---|
| y15 | 181,278 | 33,503 (51.12 %) | 2,351 (3.59 %) | 6,281 | 2,028 | 0.69 / 0.07 / 0.07 | 0 % | no (as required); zoneR open |
| y55 | 1,433,758 | **5,310 (8.10 %)** | 2,301 (3.51 %) | 4,917 | 1,518 | 0.00 / 0.99 / 0.52 → 0.01 / 0.99 / 0.51 | 9.0 → 8.7 % | **no**: zoneC and unemployment open |

The 1 % threshold is 655 tiles. Before B3 (`67b567d`) the same run gave y55 5,092 free tiles (7.77 %), 2,181
road-facing (3.33 %), which reproduced the desktop's numbers (5,092, 7.77 %, 1,528 near the edge; its road-facing count
was 2,145 and its "within three" 4,614, a slightly different neighbourhood rule); B3 moves the city a little and the
picture is the same. Even counting only road-facing free land (3.51 %) or road-facing flat land (2,271 tiles, 3.47 %),
y55 is above 1 %: by any free-land measure this city still has land a player could zone, and the bot's patterns leave
it.

### Browser checklist (cloud; one Chromium on SwiftShader, 1280 × 720, `demo-ui.html` on its own vite port)

Harness: `scratchpad/t037b/qa/` (`run.mjs`, `check.mjs`; `dryrun.mts` checked each setup headless first). Setup by host
calls (`scene.actions`, `sim.runDays` up to two days before each month tick, a region context for the neighbour);
everything under test by real input: the speed buttons across each month tick, clicks on toasts, cards, the badge, the
RCI segment and the popover's buttons, the N key, and zoning drags on the canvas. On the branch after the second dev
merge (`f9fd2a9`), local host. Logs: `qa/shots-run4/log.txt` (A, B, C), `qa/shots-BC/log.txt` (B, C again, cards
scrolled into view), `qa/shots-B2/log.txt` (B with the camera settled before each drag). No page or console errors in
any run.

| # | Check | Result | Evidence (`scratchpad/t037b/qa/…`) |
|---|---|---|---|
| A1 | FH-03: a young Medium town (8 residential tiles, R demand 0.87) gets the amber Planning toast "…no room to grow — zone more residential land along roads." with "Zone homes" at the first month tick (day 30) | pass | `shots-run4/A1-zone-homes-toast.png` |
| A2 | the toast's click selects `zone:1` | pass | `shots-run4/A2-zones-pulse.png` |
| A3 | F1: the Zones button pulses while the onboarding card coaches Transport: 6,245 ms in page time (4,500 ms of timer on a slow SwiftShader page; the desktop's bug ended it within a coach update) | pass | `shots-run4/log.txt` |
| A4 | the condition held from day 30 to 400: posts on days 30 and 390 only (180 days, doubled by the back-off) | pass | `shots-run4/log.txt` |
| A5 | F3: 4 more residential tiles zoned by a real drag on day 400; the still-full town hears it at the next tick (day 420), not on day 1110 | pass | `shots-run4/A5-after-reset.png` |
| B1 | F3: strong R demand and no residential land zoned: no zoneR warning at the first tick | pass | `shots-B2/log.txt` |
| B2 | the "+ zone" badge under the RCI segment (R, 0 empty lots), its tooltip naming the families | pass | `shots-B2/B2-zone-badge.png` |
| B3 | a real click on the badge selects `zone:1`; the popover stays closed | pass | `shots-B2/log.txt` |
| B4 | F3: 8 homes zoned by a real drag; the first real stall is announced at once (day 60) | pass | `shots-B2/log.txt` |
| B5 | Alex Stone's card: the advice, "No empty residential lots left — demand wants many more", Show me and Zone homes | pass | `shots-BC/B5-advisors-card.png` |
| B6 | the card's Zone homes (real click) selects `zone:1` | pass | `shots-B2/log.txt` |
| B7 | 16 residential lots zoned by a real drag while paused: within a second the badge drops residential and points at industry (amber), which still qualifies (demand 0.77, 2 empty lots) | pass on review: the script expected no badge at all, which this town's industry rightly keeps (the unit tests cover the badge going) | `shots-B2/B7-after-drag.png`, `shots-B2/B7-badge-gone.png` |
| C0 | a sandbox 64 × 64 map zoned to its last tile (8 free tiles, 0.2 %), 2,092 residents, a founded neighbour with 30,000 spare jobs and no road to its edge | setup | `shots-BC/log.txt` |
| C1 | LG-05: the built-out toast at the month tick, naming three blocks, offering Rezone | pass | `shots-run4/C1-built-out-toast.png` |
| C2 | no zoneR / zoneC / zoneI and no "zone more" unemployment post while built out | pass | `shots-BC/log.txt` |
| C3 | no "+ zone" badge on the built-out map | pass | `shots-BC/log.txt` |
| C4 | F5: the card words each block by its own zone ("to denser housing or industrial land" for the residential strips, "to housing or industrial land" for the commercial one) and offers Show me, Rezone and **Connect a highway** | pass | `shots-BC/C4-built-out-card.png` |
| C5 | **Connect a highway** (real click): the Highway tool (`net:5`), Transport pulsing, the camera to the east edge | pass | `shots-run4/C5-connect-highway.png` |
| C6 | the RCI popover's cap hints show "The city is built out" with the same text, Rezone and Connect a highway | pass | `shots-BC/C6-rci-popover-built-out.png` |
| C7 | the popover's Rezone: the Land value view, the Zones flyout, the popover closed | pass | `shots-BC/C7-rezone-landvalue.png` |

The browser check moved the badge: it first sat over the segment's R C I letters (`qa/shots-try3/B2-zone-badge.png`); it now
hangs just under the segment (`f9fd2a9`).

### Decisions (for the lead and the owner; conservative readings taken, nothing retuned)

1. **FH-03's newcomer gate (5,000 by year 4 on Medium) stays not met: 2,348** (dev 100; the desktop's pre-F3 run 283).
   The cue now works: the newcomer zones homes on it every month while it holds. What stops the town is jobs: after
   year 1.2 its industrial lots stay empty (11-12 empty front lots with industrial demand 0.5-0.8, and the game's
   `lotsSmallI` advice says they are too small for factories), so zoneI stays silent, unemployment reaches 14-24 % from
   year 3.3, and residential demand drops under 0.5, which ends the cue. This lane did not retune balance or the bot.
   Options:
   - (a) take §8.1's newcomer target (2,500 by year 4 on Medium) as FH-03's too: missed by 6 % (2,348);
   - (b) have the FH-10 profile also answer the unemployment warning (SIM lane, tools/simbot.ts): it already says
     "zone more commercial and industrial land", which is what the town needs;
   - (c) find why the newcomer's industrial lots stay empty with industrial demand 0.5-0.8 (a lot-fit question for SIM:
     `lotsSmallI` posts on them; `scratchpad/t037b/ncdiag2.mts` reads the game's own lot explainer);
   - (d) a bigger patch per cue in the newcomer profile.
2. **FH-04's inherited gate stays not met** (Easy approval 39.0-39.7 % in years 2-6, 29.3-30.3 % from year 7; year 6
   Easy / Medium = 2,284 / 2,324 = 0.98×). By D3 that brings in LG-09's extra Easy rules; the candidate terms are the
   same three as FH-04's report (residential taxes −7.0, city services at homes −5.4, air pollution −3.6 to −4.7), plus
   unemployment (−12.0 to −12.8) from year 7. Easy and Medium grow alike because the newcomer's growth is now set by
   its cues and its jobs, which difficulty does not change.
3. **LG-05 does not fire on y55: 8.10 % free land against the 1 % threshold** (road-facing free land 3.51 %; before B3
   7.77 % and 3.33 %). The card is right not to fire by its own definition, and zoneC / unemployment still post there.
   Options: keep 1 % (the advice is honest: there is land to zone); count only land a lot could use (still about
   3.5 %, so it would not fire either); raise the threshold above 8.1 % (it would fire on y55, but also on a city with
   5,000 tiles still to zone); or regenerate the checkpoint with a bot that fills its road-facing land (LG-10).
4. **F3's reset against "at most once per 180 days".** The acceptance's fixture keeps the condition without zoning,
   and there the warning comes on days 30 and 390 (unit test and browser). When the player zones more of the family,
   the cooldown starts over by design (the desktop's QA fix), so a player who zones a little each month while lots
   stay full hears it each month. Read conservatively as meeting the acceptance; the lead may prefer a floor (say 60
   days) between posts even after zoning.
5. **TopBar.ts edited before the split**, as T037d was: only the RCI segment and popover, with the logic in
   `src/ui/topbar/rciGuide.ts`, so the split (next in the guide chain) moves two small hunks.
6. **The toast's button lookup in Notifications.ts** (the plan gives META "that three-line lookup") was written by this
   lane, as the desktop did; it is three lines, and META's FEEL-02a queue keys on the same `ref`.
7. The desktop's open points stand: the rubble variants of the zone rules keep "Zone homes" (a valid fix, not the one
   their text names); LG-08, LG-04 and LG-12's options join the card as those items land. T037e (NOTE-043) now goes to
   the desktop (NOTE-047) and starts once this lane is in dev, since this lane touches AdvisorsPanel.
8. **What from this lane could go to the desktop** (the desktop is back, NOTE-045; T037b itself stays on the cloud,
   NOTE-046/047). Nothing here needs a real GPU to be finished: the browser items are function and layout checks, and
   SwiftShader ran them. Two follow-ups fit the desktop, if the lead wants them: a real-GPU look at the badge, the
   toasts and the popover's built-out line once this is in dev, alongside T037a / T037e's browser checks (same panels);
   and decision 1's options (b)-(d), which are SIM / bot work (tools/simbot.ts, lot fit) suited to a Codex lane in
   round 2's SIM queue. Both are the lead's call; this lane did neither.
9. **LG-05's "the scan's cost is unchanged"** is read as the plan words it, "one more counter in the existing pass":
   there is no new pass, and the counter costs about 0.1 ms (+5 %) on dense1m's monthly scan and nothing measurable on
   bot256's (the gates table). The lead may want the free count moved behind a cheaper test if a stricter reading is
   meant; this lane left it in the scan, where the plan puts it.
10. **The badge's recount runs once a real second whatever the demand** (0.6-1.5 ms on a 256 map, the gates table). It
    could skip the pass while no family's demand is above 0.5, when the badge cannot show; this lane left it as is
    (the cost is small and the recount also keeps the room fresh for the moment demand rises). The lead may want the
    skip; it is a two-line change in TopBar.ts's badge update.
