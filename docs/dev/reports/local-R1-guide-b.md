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

FIXES_AFTER_QA

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
