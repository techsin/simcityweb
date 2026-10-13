# Metropolis polish and fun pass: the plan

Task #32. This is the merged plan from three lens drafts (first hour, long game, feel). It was checked against the code at `e116226` and against about 55 screenshots on Oct 13 2026, then revised after a 42-point critique, each point re-checked against the code at HEAD `dffea6f` (since `e116226` only render and asset files changed). The Critique log at the end records what was applied or rejected. Nothing in it is implemented yet. Implementation agents follow it lane by lane, round by round (§7, §8).

**Is the work blocked?** Planning is not blocked. In implementation, only the listed items can start now.

Three phases are in flight, and most items touch files they are rewriting:
- sim-depth part B final fixes (triage and fix rounds; the new-player reviewer is still running, and the veteran's 10 findings are in);
- render round 2 (verify r3 and r4 still to come);
- million-pop performance: merge two speed-up branches, then move the sim to a Web Worker (`docs/WORKER_DESIGN.md`, about 7–9 weeks on its critical path).

What can start, and when:
- **Now** (no file an in-flight phase edits):
  - FEEL-11's music ducking, song rests and background mute (`src/audio/**` only; its siren part waits for W0.2 and W0.5);
  - FEEL-12 (`src/audio/ambience.ts`, plus a small `CityScene.updateAmbience` hunk rebased on the Worker steps);
  - LG-01's `CITY_RANKS`, `listMilestones` and their tests in `rewards.ts` (the HUD line waits for the TopBar split, §7.4);
  - the §4 copy as a data module (new `src/ui/guide/copy.ts`) with text tests;
  - new-file art (`src/assets/builders/lm_*.ts`), written against render round 2's `materials.ts` and registered in `manifest.ts` after it merges.
- **Once PB-BOTFALLBACK merges:** FH-10 (`tools/simbot.ts`).
- **Once part B and the two perf branches merge:** the rest of round 1's SIM lane (FH-04, FH-07a, LG-10), whose gate runs need the merged rows.
- **Once render round 2 merges:** FH-19 and FEEL-08 (`CameraController.ts`).
- **After W0.6** (saves through the host), not W0.3: GUIDE and META. Their round-1 items need W0.2 (commands), W0.3 (watches), W0.4 (FH-08's `LivePolicy`), W0.5 (FH-03, FEEL-01 and FEEL-02a share `Notifications.ts` and `AdvisorsPanel.ts` with it) and W0.6 (FH-22, FH-12, FEEL-02b, NEW-04).
- **After W1.3** (persistence in the worker, `WORKER_DESIGN.md:970`, near the end of the 7–9 weeks): FEEL-02b's recovery check, FH-07b (undo) and NEW-03 (save history).
- **After the Worker's render steps R1 and R2 and W0.5** (`WORKER_DESIGN.md:966`, `:974-975`, which change `TerrainRenderer`, `BuildingRenderer.add`, `MiniMap.paintBase`, `Fireworks.collectLaunchSites`, `Notifications.ts`, `AdvisorsPanel.ts`, `MiniMap.ts` and the emergency feed): WORLD items in those files. That is FEEL-04, FEEL-14, FEEL-15, FEEL-18 and FEEL-28 (`BuildingRenderer`), FH-20's hatching (`TerrainRenderer`), FEEL-06's rank-up bursts (`Fireworks`), FEEL-09 (`EmergencyVehicles`) and NEW-02 if it takes the model path. FEEL-05 avoids `paintBase` with a composited tint. R1 and R2 sit at the end of the Worker's critical path, so decision D13 asks to pull them forward.

Decision D1 (§11) records this schedule.

## How to read this plan

- **IDs.** IDs keep the draft prefixes so cross-references stay stable: FH = first hour, LG = long game, FEEL = feel. A merged id points at its survivor. NEW-xx are items this merge added.
- **Priority.**
  - P1: without it a player of this game would be confused or would quit.
  - P2: a player notices it missing or weak, and it costs enjoyment.
  - P3: delight.
- **Size.** S ≤ 2 days, M ≤ 1 week, L > 1 week.
- **Lane and round.** Each item names one owning lane (§7) and one round (§8).
- **File references.** `file:line` references are against `e116226`; outside render and asset files they are unchanged at `dffea6f`. The in-flight work will move most lines (render round 2's work in progress has already changed `src/assets/materials.ts`, `TerrainRenderer.ts`, `TreeRenderer.ts`, `roadMaterial.ts` and several builders), so find each hunk by the function or identifier named next to it.
- **Evidence paths.** `S` = `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad`.
  - `shots2/NNN` = `S/simB/verify-playtest-r1/shots2/`: the real-input playtest, a Medium city "Queensbury" plus a sandbox "Fairland".
  - `newplayer/NNN` = `S/simB/verify-newplayer-r1/shots/`: the new-player reviewer's Medium city "Sunside". That reviewer is still running.
  - `cmp/` = `S/render2/artrev-r2/cmp/` (A|B art comparisons).
  - `veteran/` = `S/simB/verify-veteran-r1/runs/`.
  - `G_256x60_s7` = `S/simB/wp6b-r3/runs/G_256x60_s7.json`, the final seed-7 bot run.
  - "acceptance r3", "balance r3", "playtest", "factors", "audit" = the files in `S/polish/inputs/`.
- **Money.** The game shows §. Bot tables print $. They are the same unit.
- **Year N.** Year N of a city means the N×360 days after `systemData.foundedDay`. After FEEL-05 a player's city is founded on day 90 (1 April), so "by year 3" means before day `foundedDay + 1080`, not the calendar year 2002. The bot still founds on day 0, so for bot rows year N and calendar year 2000 + N agree. Goal 1, FH-02, FH-03, FH-04, FH-10 and §4.8 use this definition.
- **Targets and today's numbers.** In-flight fixes move the base bot rows (PB-PARKING turns `PARKING_TERMS` from 0 to 1; PB-SENIORS, PB-TREES and PB-OUTAGE change sim terms). So every bot target is measured against the §8.0 baseline, taken at the merge commit, and "today" figures in this plan are context only. Where a target was an absolute "today" number, it is now relative (for example LG-08's base population is "at least 0.99× the §8.0 base", not "1.547M").
- **Colour distances.** RGB distance (0–255 per channel) after the Machado 2009 simulation at full severity, applied in linear RGB, for deuteranopia and protanopia (and tritanopia for the blue-yellow mode). In gamma space the numbers differ (R vs I zones: 77 in linear RGB, 99 in gamma space), so every check names this method.

### In-flight fixes this plan depends on

These are owned by other phases. The plan only names them in `dependsOn`.

| ref | source | what lands |
|---|---|---|
| PB-ACCIDENT | playtest #1 | An industrial accident stays "uncovered" when only an ambulance left. The banner names the real vehicle, and the alert window equals the 3-day ignition time. |
| PB-AMBER | playtest #2 | The amber "just out of reach" band only covers places a manual unit can still reach in time. No "min left" after a loss. |
| PB-UPKEEP | playtest #3 | The placement tooltip, the Rewards panel and the inspector agree on upkeep and income (a city-aware estimate). Today they differ by up to 9×. |
| PB-DIALOG | playtest #4 | The HUD `.modal` CSS no longer leaks into region dialogs. |
| PB-STAFF, PB-LOADEMG, PB-GARBAGE, PB-NOROAD | playtest #5–#8 | Staffing hint names the real cause. A loaded emergency keeps its dispatch decision. Wording "your landfill has no road access". A service without a road serves nothing. |
| PB-BANNER, PB-SLIDER, PB-NEWYEAR, PB-DATAVIEWS | playtest #9–#12 | Banners leave right-hand panels clear. Sliders keep keyboard focus. The date holds during the New Year cinematic, its timer runs in real time, and its toast uses the top-bar population. The Data views panel fits 720p. |
| PB-ZEROUSE, PB-SHORE, PB-LEDGER, PB-ROUND | playtest #13–#16 | Zero-use facilities explain why. Shore buildings face the water. No duplicate ledger lines. "< 0.1 min" instead of "0.0 min". |
| PB-REGION | factors #1 | Regional jobs need a connected edge and a neighbour with surplus jobs. |
| PB-COOLDOWN | factors #2 | A call hidden by the banner cooldown still triggers LIVE, or is not scored as "ignored". |
| PB-PARKING, PB-TREES, PB-BROWNOUT, PB-COMMUTE, PB-OUTAGE, PB-PARKS, PB-SENIORS, PB-DEPOT | factors #3–#10 | Parking costs businesses. Trees act as a noise buffer. Brownout advice. Commute reported by mode. Slower outage exodus. A parks advisor rule. Seniors' quiet weight. Minibus wording. |
| PB-PANELS, PB-OVERLAY, PB-INSPECT | audit #1, #3, #4 | Panels throttle their rebuilds and the ticker caches its width. Overlay rasters are throttled. No duplicate inspector rows. |
| PB-ZOO | lead decision LD15b | The zoo's visitor draw is calibrated. |
| PB-GRACE | LD4 / LD8 | Grace period for early plant fires (`emergency.ts`). |
| PB-SAVELOAD | routed 12, 23, 32, 42, 45, 47 | Save/load drift. RNG state and active disasters are saved. |
| PB-BOTFALLBACK | acceptance advice 3, routed 4 | The bot's `nextBlock` "sector full" fallback (seed 11's wave of abandoned CS$$$ shops). |
| PB-TAXRESPONSE | veteran #1 (and #10) | Realized growth follows demand below the throughput cap (`growth.ts` `computeAllowance`), so taxes of 10–13% cost growth gradually instead of nothing, then a cliff at 14%. If part-B triage does not take it, NEW-05 (SIM, P1, round 2) does the same work. |
| R2-NIGHT, R2-SEASONS, R2-LW | render round 2 | Night-window LOD patch. Bare and evergreen impostors, winter lot crowns. Festoons, crown wireframe, glass checkerboard, polytunnels, Seagram band, GPU cut. |
| W0.2 … W1.4 | Worker phase, `WORKER_DESIGN.md` §6 | W0.2 commands, `Tool.commit`, `host.setSpeed`, cause tags. W0.3 queries and watches. W0.4 `LivePolicy` in `src/game/emergencyPolicy.ts`. W0.5 views (`EmergencyView`), the news sequence number, the MiniMap dirty mark. W0.6 saves through the host. W1.x protocol, replica and worker; W1.3 the journal and the min(30 s, 90 sim days) snapshot cadence. S4 spreads the month tick. R1 `TerrainRenderer` dirty rects; R2 budgets `BuildingRenderer.add`, throttles `MiniMap.paintBase` and makes `Fireworks.collectLaunchSites` incremental. |

### Veteran findings and routed items: owner and polish mapping

The veteran reviewer's 10 findings (`S/polish/inputs/veteran.json`) go to part-B triage first. Triage decides which are bugs it fixes now. This table names the polish item that carries the design side either way, or takes the whole finding if triage passes on it.

| finding | owner | polish items |
|---|---|---|
| #1 taxes up to 13% are almost free (12% from year 21: −0.3% population, $12.0M vs $3.57M in 2030; 14%: −70%) | triage as PB-TAXRESPONSE; otherwise NEW-05 | LG-03, LG-16, FH-09; Goal 6 |
| #2 approval has almost no consequences (8–12 points cost 0–3% of the population) | design, this pass | LG-16, LG-03, FH-09; E8's wording |
| #3 0 high-tech jobs at 1M with EQ 130 | triage for the share formula; design here | LG-07: high-tech at least 25% of industrial jobs at EQ 110 or more by 2040 |
| #4 the commute approval penalty starts at 30 min and never fires | design, this pass | LG-08 |
| #5 the month tick stalls 50–176 ms at 1M | million-pop performance (S4) | none |
| #6 dead-end highway stubs stack demand-cap relief without limit | triage (`demand.ts` relief loop); else LG-12 | LG-12's road stub must not add relief before it reaches the city; persona P-3 hunts it |
| #7 the Toxic Waste Dump is free money in a corner | design, this pass | LG-22 |
| #8 a 6-month blackout recovers fully within 4 months | design, this pass | LG-14 (Lights Out), LG-15 |
| #9 difficulty only scales money | design, this pass | LG-09 |
| #10 regional neighbours barely change growth | PB-TAXRESPONSE / NEW-05 (same throughput cap) | LG-13 |

Routed items that `ROUTED_ITEMS.md` sends to "the final-fix / polish phase" (6–16, 37–52) or to the final-fix lanes (53–57, lead decision 10), and that the drafts left without an owner:

| routed item | owner |
|---|---|
| 6 justice advice ignores the cause; 7 a prison at 0% funding reads "0 / 0 (0% full)", status ok; 8 the yearly sentence projection is noisy; 15 the WP5 routed texts still to check | NEW-07 wording sweep |
| 10 a facility under a month old gets the road hint while still hiring | PB-STAFF (same `staffHint`, `facilities.ts:330-337`); otherwise NEW-07 |
| 11 the Staff line shows hire-adjusted slots | PB-NOROAD (playtest #8 asks for posted jobs in the Staff line); otherwise NEW-07 |
| 43 a cut-off road still earns a short-commute bonus | part-B triage (a sim bug) |
| 49 "+0" / "−0" in Why? (`population.ts` `conditionBreakdown`, `growth.ts` detail lines) | NEW-07 (SIM edits the two sim strings) |
| 50 `statsModel` duplicates the garage def list; 51 a GRAPHS axis test | part-B final fix (code hygiene, no player effect) |
| 52 duplicate tick labels on percentage graphs | NEW-07 |
| 53 a garage reads "Not picked yet" after any road edit | part-B final-fix lanes (a regression) |
| 55 a price-rationed full garage names no neighbour; 57 "Full — 26,428 cars wanted" | part-B final-fix lanes (lead decision 10); otherwise NEW-07 |
| 39 the bot's `clearFailed` rotation key; 40 a stale `actions.ts` comment | whoever next edits the file (LG-10; FH-07a) |

### Where the drafts were wrong, and what this plan changed

1. **Autosave runs every 3 game months in the real game, not every 6.** The app setting defaults to 3 (`src/region/settings.ts:19`) and overrides the game default when `main.ts:542` builds the scene. That is a save every 45 s at 1× and every 4.5 s at ultra, each with a chime and a pill. `WORKER_DESIGN.md` §4.2 gives the same number. FEEL-02b is corrected.
2. **The two audio "defaults tables" have no player effect.** `CityScene.syncVolumesFromAudio` (`CityScene.ts:1094-1105`) makes the AudioEngine the single source of truth. FEEL-11 part 4 is dropped.
3. **Reaching 1M does not get "the same chime as 2,500".** 1M is in GameSounds' milestone list and plays pitched up; 2,500 gets the generic chime (`GameSounds.ts:41`, `:142-153`). The real gap is the missing card or visual (FEEL-06).
4. **The spring start is low-risk.** Every "day > 0 means resumed" heuristic in the six systems also requires stored data, which a fresh city lacks: `approval.ts:232`, `demand.ts:370`, `desirability.ts:570`, `landValue.ts:523`, `tourism.ts:532`, and `population.ts:303` through `savedGrids`. `growth.ts:897` calls `computeCore`, which returns null for a town with no shop or office jobs (`growth.ts:107`), so it computes nothing. One day-0 assumption does change behaviour: `advisorData` (`advisors.ts:144`) treats a day-90 city as an older save and schedules the first headline for day 120, 30 days after founding instead of 45. FEEL-05 keys it on `foundedDay`. `CityScene.newCity` is already keyed on the camera and buildings, not on day 0 (`CityScene.ts:181`), so the backlog's "key the new-city check on a flag" is already done.
5. **A newcomer's first emergency can already be too far to save.** Queensbury's first fire showed only "Help came too late" (`shots2/027`). Below 1,000 residents only fires raise an alert (`ALERT_MIN_POP`, `EmergencyBanner.ts:46`). FH-08 now teaches both cases.
6. **After the Worker, several data sources are worker queries or watches**: `computeMonthlyBudget`, `openAdvice` and the inspector data (`WORKER_DESIGN.md` §2.8). FH-05, FH-14 and FH-02 use replica-safe inputs or those watches, never a recompute per mouse move.
7. **After the Worker, the hygiene test forbids `.speed =`, `emergencyOf(` and `getSystem(` in `src/ui` and `src/game`** (`WORKER_DESIGN.md` §5.3). Onboarding, FH-08 and FEEL-09 therefore use `host.setSpeed`, `host.policy` and `EmergencyView`.
8. **The coal plant's inspector already scales smoke "by load"** (`shots2/i01`). Only the render plume ignores load (FEEL-15).
9. **The Zones legend names dirty industry "Industrial (low)"**, while the tool calls it "Industrial · Medium density" (`render/world/overlays.ts:238` vs `ZoneTool.ts:19`). This is folded into FH-20.
10. **Two problems had no owner:**
    - repetition and twins in grown districts (routed 27/38; render round 2 left "walk-up mix … repetition" out of its lanes) → NEW-01;
    - the roadless-landmark marker that routed item 48 sends to this pass → NEW-02.

## 1. Goal and bar

"A polished, feature complete, playable, enjoyable, competent game" means, for Metropolis, that each of these holds and is checked by the named harness:

1. **A first city works.** A first-time player who follows only the in-game guide reaches 2,500 residents by year 3 on Easy and year 4 on Medium (years counted from founding, see "How to read this plan"). They spend at most §15,000 before pressing Play, no deficit lasts more than 3 months unexplained, and the town has no brownout before year 4. Checked by the scripted real-input run and by the FH-10 newcomer bot.
2. **Numbers shown before a decision are true.** Upkeep, the budget after placing a building and the effect of a placement preview match what happens within ±15% one month later. The approval cost of a tax matches the change in `approvalRaw`, the "heading for" value (`TopBar.ts:501`), one month later within ±15%; the shown approval follows over about 6 months, because it moves 30% of the way each month (`APPROVAL.ema`, `tuning.ts:667`; `approval.ts:327`). Checked by unit tests and one-month fixture checks.
3. **Every warning can be acted on.** No advice asks for something impossible: no "zone more" on a full map, and no "healthy surplus" when one service would put the town in deficit. Every red or amber advisor card has a button that opens the fix.
4. **Every first failure is explained once, when it happens.** That covers the first stall, the first deficit, the first emergency, the first approval drop below 45 and the first demand cap. Each explanation names the fix.
5. **There is always a next goal.** From founding to 1.5M a next goal is visible on the HUD. From 2010 to 2056 no gap between unlocks, ranks or honours is longer than 5 game years (256×60 s7 replay).
6. **Money and approval stay decisions after year 30.** With the long-game rules on, the bot holds at most 12 months of expenses in the bank in 2045 (today 19) and keeps taxes at 8% or more while saving (today the 7% floor from 2035). Approval thresholds gate big projects. A tax rise costs growth: with taxes fixed at 10, 11, 12, 13 and 14%, population falls monotonically, by at least 3% per point above 10%, with no step over 15% between neighbouring rates. Today 12% from year 21 costs 0.3% of the people at 256, and 14% costs 70% at 128×15 (veteran #1). This needs PB-TAXRESPONSE or NEW-05.
7. **Right and wrong choices show in population, not only in approval.** Each of these is a 256×60 or 128×15 bot variant measured against the base run:
   - neglecting emergencies costs at least 2% of the population at year 60 (today +0.4%);
   - skipping transit costs at least 4% at 2040 (today 0.7%);
   - a clean-industry city keeps at least 0.8× the population at 128×15 year 15 (today 0.61×).
8. **Every consequential event is felt within 100 ms**: a world beat, a sound and a UI change. Pacing budgets are real time at every speed: at most 2 full New Year shows per 10 real minutes at 1× and 2× (rank-ups included), fireworks on screen at most 25% of real time, at most 2 New Year fanfares per 5 real minutes at ultra, no autosave chime, and at most 8 sim toasts a minute.
9. **Anyone can play it**: with a trackpad (no middle button); on AZERTY, Dvorak and Mac keyboards; with red-green colour vision (every key colour pair at least 120 apart under the Machado 2009 simulation in linear RGB, for both deuteranopia and protanopia); with reduced motion; with text at +30% at 1280×720, all set from the title screen before the first city; and on a 4-core laptop, whose first run picks Medium or lower and survives a lost graphics context.
10. **Nothing that already works breaks.** Every gate of acceptance r3 still passes on Medium. Medium and Hard bot runs are bit-identical for every UI-only or Easy-only item. New bot rules record their rows under a separate `polish` fixture key with the lead's sign-off.
11. **Progress is safe.** An autosaved mistake can be undone from save history, a player can leave without saving, a browser that may evict the saves says so and offers a backup, a full disk gets a guided message, and two tabs never overwrite each other. Checked by NEW-03 and NEW-04.

## 2. What a player feels today

### First hour

**Setup and first view**
- **Four screens and about ten choices before the first road**: title, New Region (7 landscapes, name, seed, climate), the region map with 106 tiles, a tile card, then the city dialog with difficulty, terrain, trees, climate, disasters and start year (`shots2/001`–`008`).
- **The city opens paused on January woods.** The first view is grey-brown winter forest with no visible map edge, next to a summer-green minimap. The HUD already reads "Approval 65%" with nobody living there (`shots2/010`, `newplayer/047`, `cmp/fv_temp_def_AB.png`).

**The getting-started card**
- **The card steers players into the classic mistake.** Step 3 opens the Power tab, whose cards show price but no output (`shots2/016`).
  - Both real-input players bought the §25,018 coal plant on day 0 (`shots2/017`→`018`: §77,583 → §52,565; `newplayer/047`, `056`).
  - Queensbury used 21 of 400 MW in Oct 2002 (`shots2/058`) and 58 of 400 MW at 15% load in 2007, with "severe stigma within 12 tiles" (`shots2/i01`).
  - The bot opens with three §800 wind turbines (`simbot.ts:861-873`).
- **Steps tick when nothing can grow.** Step 2 ticks with zones that touch no road (`shots2/131`). The new player's industry read "Not growing: no road access · No power · No water" (`newplayer/063`). The card's Play button works before steps 1, 3 and 4 are done (`shots2/132`).
- **The cheap start runs out of power just as the guide ends.** A wind turbine makes 3 MW on flat land and up to 7 MW on a hilltop (`catalog.ts:255-257`). Three turbines on the flat tile FH-11 recommends make 9 MW, about 2,700 residents at the guide's 1 MW per 300. The bot's 18 MW from three turbines came from its hilly map (`hilliness: 0.25`, `simbot.ts:224`). Nothing then points at the next plant; the bot switches to gas at 12 MW (`simbot.ts:862`).
- **After Play the card vanishes for good** 6 s later. Its last words are "Watch the RCI meter" (`shots2/113`; `Onboarding.ts:292-305`).

**The first years**
- **Without further guidance the new player's town never got going** (all Medium):
  - 124 residents in Oct 2000 (`newplayer/073`);
  - 422 in Jan 2004 (`newplayer/128`);
  - 863 in Feb 2006 (`newplayer/146`);
  - 2,379 in Apr 2010 at 41% approval (`newplayer/175`).

  The bot reached 46,762 by 2006 (acceptance r3). The one message that would have helped, "no room to grow — zone more residential land", only scrolled through the ticker (`newplayer/146`).
- **Approval looks like failure even when play is correct.**
  - Queensbury went 55% → 49% → 45% in year 1 (`shots2/023`, `024`, `027`).
  - The new player sat at 36–43% with Crime −12.4 at 124 residents, under a frown face (`newplayer/073`, `096`).
- **Money feedback misleads.**
  - A Fire Station read ≈§539/mo while the town made +§259/mo (`shots2/024`).
  - The finance advisor called +§150 "a healthy surplus… consider investing" (`shots2/027`).
  - The tax hint says ~12%, but approval is lost from 9% (`shots2/079`).
  - A losing town is told "the treasury runs dry in 1119 months" (`newplayer/073`).
- **The first fire simply failed**: "Help came too late — 1 building lost", with only Jump and Choose station (`shots2/027`).

### Mid game

- **Service costs surprise the player.** Queensbury placed services whose estimates were up to 9× off (PB-UPKEEP) and found the deficit only at §2,042 and −§968/mo (`shots2/078`).
- **Even the competent bot has a tight start.** It sits at approval 43–54 in years 1–6, with taxes at 10.5–11%, two loans in year 2 and 0.5–1.6 months of expenses in the bank (acceptance r3).
- **The trade-offs are lopsided** (acceptance r3 WRONG CHOICES):
  - skipping smokestack industry costs 39% of the people at 128×15 year 15, for 4% cleaner air;
  - skipping transit costs 0.7% at 2040, and the commute is even shorter without it;
  - neglecting emergencies gives +0.4% population and +24% money, with 195 vs 71 buildings lost.
- **Grown districts repeat themselves.** Rows of identical brick walk-ups line whole streets (`cmp/tp_jun13_suburb_AB.png`). Same-model twins make up 12–14% of buildings on 256 maps (routed 38).
- **Shore buildings can be impossible to place.** On the sandbox tile's diagonal coast the Container Seaport and the Desalination plant failed in every rotation (playtest summary; `shots2/sb_06`). The Seaport unlocks on any water (`hasWater`, `rewards.ts:90`), and the Lighthouse must stand on the shore (`catalog.ts:417`), yet G9 promises it on a tile chosen for flat land.
- **Mistakes are permanent.** Each city has one save record, overwritten by every save (`save/index.ts:49-55`), and autosave runs every 4.5 s at ultra. The pause menu has no "exit without saving" or "revert" (`Modals.ts:33-50`), and "Save & exit" always saves (`CityScene.exitToRegion`).
- **Saves can vanish without warning.** Nothing requests persistent storage (no `navigator.storage.persist` or `estimate` in `src`), backup is a manual region export (`RegionScreen.ts:106`), a failed save shows the raw exception (`CityScene.ts:910`), and two tabs on one region silently overwrite each other (no Web Lock or BroadcastChannel).

### Long game

- **Unlocks run out.** The last unlock is the Twin Spires at 500k (bot year 2029). Building stages stop at 220k and population news at 1M, so 27 game years pass with no new reward (`rewards.ts:102-104`, `tuning.ts:243-249`, `advisors.ts:107`).
- **Money stops mattering.** The bot banks $3.57M in 2030, $9.38M (19 months of expenses) in 2045 and $17.7M (26 months) in 2060, at the 7% tax floor from 2035 (`G_256x60_s7`). The dearest building costs §200k (`catalog.ts:441`). Taxes up to 13% are nearly free: 12% from year 21 costs 0.3% of the people and banks $12.0M instead of $3.57M by 2030, while 14% costs 70% (veteran #1).
- **Approval stops mattering.** It sits at 80–84 from 2030 and moves residential demand by at most 6% (`APPROVAL_R`, `tuning.ts:158`). Losing 8–12 points costs 0–3% of the population (veteran #2).
- **A full map gives advice that cannot be followed.** In 2055–60 residential demand is about 0, commercial 0.81 and unemployment 9%. The advisor still says "zone more commercial land" (`advisors.ts:1230`), while the bot logs "no site for a University (3748 people in need)".
- **Spare capacity has no use.** In 2060, 1.27 GW of power and 231k kL/day of water stand idle (`G_256x60_s7`).
- **The yearly feedback is one line**: one toast per New Year, the same in year 5 and year 50 (`shots2/047`).

### Minute to minute

- **Strong already.**
  - 39 UI sounds, building pops, cranes and dust, sirens and beacons.
  - Damped zoom-to-cursor.
  - A lavish New Year and night streets lit in sodium amber (`cmp/dm_B_dt_2200_AB.png`).
- **The world does not answer consequences.**
  - Spending is only a sound (`shots2/017`→`018`).
  - Bulldozed buildings vanish in one frame.
  - A city with half its homes dark keeps every window lit (no render code reads `BF.Powered`).
  - Garbage "at the homes of 98% of residents" is invisible on the street (`shots2/027`).
  - A coal plant at 15% load smokes like one at 100% (`shots2/i01`).
  - Abandonment is a flat grey tint.
- **New Year takes over the game at every speed.** For a 100k city (`NewYear.ts:247-283`, show length `Fireworks.ts:88-90`):
  - at ultra (18 s a year): a fanfare plus an 8 s show after a 2.8 s lead-in, every year;
  - at 2× (72 s a year): a 3.6 s countdown plus a 39.6 s show, about 60% of real time;
  - at 1× (180 s a year): a 73 s cinematic plus a 3–7 s lead-in with the camera taken over by default (`settings.ts:60-61`), about 44%.
- **Ultra speed spams.** Besides New Year, an autosave chime and pill every 4.5 s. The news ticker shows fragments such as "g garden gnomes." (`shots2/i01`) and "— zone more commercial land." (`shots2/091`).
- **The camera and keys work against the player.** Jumps smear across the map in about 0.4 s (`shots2/041`). Nothing follows the truck the player sent. A left drag never pans in the city (`CameraController.ts:4-8`), and AZERTY's WASD rotates instead of panning (`CameraController.ts:337-344`). On AZERTY the unshifted 1, 2 and 3 type '&', 'é' and '"', so the speed keys do nothing (`CityScene.ts:840`); the brush keys `[` and `]` need AltGr (`BrushTool.ts:108`).
- **Accessibility is missing.**
  - No colour-vision mode: R vs I zones go from 192 to 77 RGB apart under deuteranopia, Emergency green vs amber from 183 to 66 (56 under protanopia).
  - No reduced motion.
  - Text cannot grow at 1280 px wide (`zoom.ts:14-18`), and UI scale lives only in the in-city panel: the title-screen Settings has audio, quality, autosave, edge scrolling and FPS only (`region/ui/dialogs.ts:16-95`).
  - Approval row details and toolbar tips open on hover only (`TopBar.ts:504`; `Toolbar.ts:48-49`, `:278-279`).
  - `detectQuality()` is never called, so the playtest machine ran at 2–7 s per frame until the tester found Low. A lost WebGL context is not handled (no `webglcontextlost` listener in `src`).
  - Music keeps playing in a background tab although the simulation pauses (nothing calls `AudioEngine.suspend()`, `AudioEngine.ts:394`).

## 3. The plan

There are 88 items: 19 P1, 48 P2 and 21 P3. The drafts had 81 items (26 first hour, 26 long game, 29 feel):
- FH-24 is merged into FEEL-21, and FEEL-26 into LG-21.
- The AZERTY movement fix moved from FH-25 to FH-19.
- The merge added NEW-01 and NEW-02.
- The critique added seven:
  - two splits: FEEL-02 into FEEL-02a and FEEL-02b (the autosave half waits for W0.6 and W1.3), and FH-07 into FH-07a refunds and FH-07b undo;
  - NEW-03 save history and safe exits, and NEW-04 storage you can trust (both P1);
  - NEW-05 taxes that cost growth gradually (P1, only if part-B triage does not take veteran #1);
  - NEW-06 shore placement that finds a spot, and NEW-07 a wording sweep for routed items (both P2).
- FEEL-05 moved from P1 to P2: a winter first view confuses no one, and the art review rated it minor (render art r2 #4). It stays in round 1 but does not gate round-1 sign-off.

Priorities were re-checked across the three lenses (the drafts had 24 P1, 41 P2 and 16 P3):
- **P1 is kept for confusion or quitting**: a stalled first city, misleading numbers, pacing spam (New Year and autosave at every speed), controls a trackpad can't use, a first run that plays as a slideshow, nothing to aim for after 500k, advice that cannot be followed, progress a player can lose for good (NEW-03, NEW-04), and taxes that cost nothing (NEW-05).
- **Moved up**: FH-11, FH-19 and FH-21 → P1 (the newcomer's first choices, a trackpad, a slideshow first run); FH-23 → P2.
- **Moved down to P2**:
  - FEEL-01, FEEL-03 and FEEL-04: a player feels them, but nobody quits over them;
  - FEEL-05 (after the critique): a winter first view confuses no one;
  - FH-07b, the undo half of FH-07 (after the critique): a same-day undo mostly serves paused planning, and it needs the Worker's journal;
  - LG-02, LG-03, LG-04, LG-06, LG-07, LG-08, LG-09 and LG-10: they matter after hours of play, and LG-01 and LG-05 carry the P1 part of the long-game problem.
- **Moved down to P3**: FEEL-07, FEEL-13, FEEL-16 and FEEL-20; LG-11, LG-13, LG-17 and LG-22.

### Index

| id | title | P | size | lane | round |
|---|---|---|---|---|---|
| **A. Founding and the first year** | | | | | |
| FH-01 | Founding steps that recommend the cheap start and tick only when the town can grow | P1 | M | GUIDE | 1 |
| FH-02 | "Your first year": goals that keep teaching after Press play | P1 | L | GUIDE | 1 |
| FH-22 | Guide progress saved per city, tips remembered per profile | P2 | S | GUIDE | 1 |
| FH-11 | A New City dialog and region screen that point a newcomer at a good start | P1 | S | META | 1 |
| FH-12 | "Start your first city" on the title screen | P2 | M | META | 2 |
| FH-18 | A one-card briefing for SimCity 4 veterans | P2 | S | GUIDE | 2 |
| FH-17 | A Mayor's handbook behind F1, and a "?" on every panel | P2 | M | GUIDE | 2 |
| **B. Advice that leads to action** | | | | | |
| FH-03 | Make "zone more" impossible to miss when growth stalls | P1 | S | GUIDE | 1 |
| LG-05 | "Your city is built out": endgame advice that names real options | P1 | S | GUIDE | 1 |
| FH-14 | One recommended next step above the advisor cards | P2 | M | GUIDE | 2 |
| FEEL-19 | Hover says what is wrong with a building | P2 | S | GUIDE | 2 |
| FH-15 | Placement previews that show consequences before the click | P2 | M | GUIDE | 2 |
| FH-16 | Plain names next to R$, CS$$$, CO$$, I-D, EQ and HQ | P2 | S | GUIDE | 2 |
| NEW-06 | Shore placement that finds a spot | P2 | S | GUIDE (+SIM rule, CONTENT unlock) | 2 |
| NEW-07 | Wording sweep for routed facility and graph texts | P2 | S | GUIDE (+SIM strings) | 2 |
| **C. Money and approval** | | | | | |
| FH-05 | Show what a building does to the monthly budget before it is placed | P1 | S | GUIDE | 1 |
| FH-06 | Approval a newcomer can read | P1 | S | GUIDE | 1 |
| FH-09 | The tax panel tells the truth: approval is lost from 9%, not 12% | P1 | S | GUIDE | 1 |
| FH-07a | Fresh mistakes are free to fix: same-day and young-building refunds | P1 | S | SIM | 1 |
| FH-07b | Ctrl+Z for actions made while paused or within the current day | P2 | M | SIM (WORLD adds the key) | 2, after W1.3 |
| FH-13 | Money coach: the first deficit explained, a recovery plan when broke | P2 | S | GUIDE | 2 |
| FEEL-03 | Money you can feel: cost floats, animated funds, monthly and approval deltas | P2 | M | GUIDE | 2 |
| **D. Emergencies** | | | | | |
| FH-08 | The first emergency teaches dispatch instead of just failing | P1 | M | META | 1 |
| FEEL-09 | Follow the truck you sent | P2 | M | WORLD | 2 |
| FEEL-10 | Emergency outcomes and LIVE mode that feel urgent | P2 | S | WORLD | 2 |
| NEW-02 | Unreachable buildings show it on the model in the Emergency view | P2 | S | WORLD | 2 |
| LG-25 | Late-game crises that need the mayor even with full coverage | P3 | M | SIM | 4 |
| **E. Difficulty, balance and bots** | | | | | |
| FH-04 | Easy becomes a real first-city mode; Medium and Hard stay bit-identical | P1 | M | SIM | 1 |
| FH-10 | A "newcomer" bot profile to measure the first hour | P2 | M | SIM | 1 |
| LG-10 | Bot strategies for the long-game systems, so the gates can measure them | P2 | M | SIM | 1 |
| NEW-05 | Taxes that cost growth gradually (only if triage does not take PB-TAXRESPONSE) | P1 | M | SIM | 2 |
| LG-09 | Hard and Expert that change the rules, not just the money | P2 | M | SIM | 2 |
| LG-06 | Neglect that costs growth: a safety record, rebuild costs and scars | P2 | M | SIM | 2 |
| LG-07 | Clean industry a real strategy, dirty industry a real cost | P2 | M | SIM | 2 |
| LG-08 | Transit-oriented development: towers grow around stations | P2 | M | SIM | 2 |
| LG-16 | Approval as political capital | P2 | M | SIM | 3 |
| LG-15 | Disasters with stakes: frequency, rebuild cost, a recovery goal | P2 | M | SIM | 3 |
| **F. Goals and endgame content** | | | | | |
| LG-01 | City ranks and a visible next milestone from 0 to 1.5M | P1 | M | CONTENT | 1 |
| FEEL-06 | Milestone moments: a card, a sound for every milestone, stage news, "Place it" | P2 | M | CONTENT | 2 |
| LG-21 | Year in review and a mayor's grade (absorbs FEEL-26) | P2 | M | CONTENT | 2 |
| LG-03 | Mega-projects: multi-year builds that make money matter after 2030 | P2 | L | SIM (+CONTENT, GUIDE parts) | 2–3 |
| LG-20 | Honours: quality goals for a city that has finished growing | P2 | M | CONTENT | 3 |
| LG-02 | Late-game rewards and landmarks between 150k and 1.5M | P2 | L | CONTENT | 3 |
| LG-04 | Arcologies: dense paid mega-buildings for a full map | P2 | L | SIM (+CONTENT) | 3 |
| LG-19 | Expand facilities in place when there is no land left | P2 | M | SIM | 3 |
| LG-18 | Big-city ordinances with real trade-offs (100k to 1M) | P2 | M | SIM | 3 |
| NEW-01 | Visual variety: break up twins and repeated walk-ups | P2 | L | CONTENT (+SIM rule) | 3 |
| FH-26 | An approval reward a young town can actually earn | P3 | S | CONTENT | 4 |
| LG-17 | City charter: choose a specialisation at 100k | P3 | L | SIM (+CONTENT) | 4 |
| LG-22 | Business deals that scale with the city | P3 | M | SIM | 4 |
| LG-23 | City events the mayor schedules and pays for | P3 | M | SIM | 4 |
| LG-26 | Historic districts: freeze a quarter for tourism | P3 | S | SIM | 4 |
| **G. Region and challenges** | | | | | |
| LG-12 | Sister cities: found or fund a neighbour when the map is full | P2 | M | META | 3 |
| LG-14 | Scenarios and optional challenges | P2 | L | META (+SIM generator) | 3 |
| LG-13 | Region goals and a region dashboard | P3 | M | META | 4 |
| LG-11 | Neighbour deals: sell spare power, water and garbage capacity | P3 | L | SIM (+META, GUIDE) | 4 |
| LG-24 | Move between region cities from inside a city | P3 | S | META | 4 |
| **H. Pacing and notifications** | | | | | |
| FEEL-02a | Real-time budgets at every speed: New Year pacing and the toast budget | P1 | M | META | 1 |
| FEEL-02b | Quiet autosave with a real-time floor | P1 | S | META | 1 (after W0.6; recovery check after W1.3) |
| FEEL-05 | Found new cities in spring, with a seasonal minimap (lead decision) | P2 | M | META | 1 (not gating) |
| FEEL-01 | News ticker: newest headline first, one readable clause | P2 | S | META | 2 |
| **H2. Saves and storage** | | | | | |
| NEW-03 | Save history and safe exits | P1 | M | META (with the Worker save owner) | 2, after W1.3 |
| NEW-04 | Storage you can trust: persistence, quota errors, one tab per region | P1 | S | META | 1 (after W0.6) |
| **I. World and camera** | | | | | |
| FH-19 | Camera and keys a laptop player can use (AZERTY, Dvorak, Mac) | P1 | S | WORLD | 1 |
| FEEL-08 | Camera flights instead of smears for Jump and Focus | P2 | S | WORLD | 1 |
| FEEL-04 | Blackouts you can see | P2 | M | WORLD | 1 if D13 pulls Worker R2 forward, else 2 |
| FEEL-14 | Bulldozing and placement with weight | P2 | M | WORLD | 2 |
| FEEL-15 | Smoke that reads output | P2 | S | WORLD | 2 |
| FEEL-17 | Uncollected garbage shows on the street | P2 | M | WORLD | 2 |
| FEEL-18 | Abandonment reads at a glance | P2 | M | WORLD | 3 |
| FEEL-16 | Polluted districts look polluted: local smog haze | P3 | M | WORLD | 4 |
| FEEL-28 | Optional problem icons over troubled buildings | P3 | M | WORLD | 4 |
| FEEL-07 | Spotlight camera for the city's firsts | P3 | M | WORLD | 4 |
| FEEL-27 | A founding fly-in with a title card | P3 | S | WORLD | 4 |
| FEEL-24 | Photo mode | P3 | S | WORLD | 4 |
| FEEL-25 | Street life: pedestrians at close zoom | P3 | L | WORLD | 4 |
| FEEL-23 | Weather moments that match the headlines | P3 | L | WORLD | 4 |
| FEEL-29 | Rare sightings | P3 | M | WORLD | 4 |
| **J. Audio** | | | | | |
| FEEL-11 | Audio mix: ducking, siren fatigue, song rests | P2 | M | WORLD | 1 |
| FEEL-12 | City ambience: surf, seasons and climate | P2 | S | WORLD | 1 |
| FEEL-13 | Hear what the camera is over | P3 | M | WORLD | 4 |
| **K. Access and settings** | | | | | |
| FH-21 | The first run picks a graphics quality the machine can carry, and survives a lost context | P1 | S | META | 1 |
| FH-23 | Text that can actually get bigger, and tips keyboard focus can open | P2 | S | META | 2 |
| FEEL-21 | Motion and flashing settings (absorbs FH-24) | P2 | S | META | 2 |
| FH-20 | Colour-blind safe views | P2 | M | WORLD | 3 (its Emergency palette in 1) |
| FH-25 | Rebindable keys | P3 | M | WORLD | 4 |
| **L. Voices and stories** | | | | | |
| FEEL-20 | Headlines that react to what the player just did | P3 | M | CONTENT | 4 |
| FEEL-22 | Residents speak: named households and quotes | P3 | M | CONTENT | 4 |

### A. Founding and the first year

#### FH-01 · Founding steps that recommend the cheap start and tick only when the town can grow
P1 · M · GUIDE · round 1

**Problem**
- **Both real-input players spent §25,018 on the 400 MW coal plant on day 0.**
  - Queensbury: `shots2/017`→`018`, §77,583 → §52,565. Sunside: `newplayer/047` shows the Coal card selected.
  - Queensbury then used 21 of 400 MW in Oct 2002 (`shots2/058`) and 58 of 400 MW (15% load) in Feb 2007, with "severe stigma within 12 tiles" (`shots2/i01`).
  - Step 3 only says "Place a power plant" and opens the Power tab. Its cards show price and upkeep but no output (`shots2/016`). The wind turbine's "3–7 MW" is only in its hover card (`newplayer/047`).
  - The bot opens with 3 turbines (`simbot.ts:861-873`): 18 MW of supply for 10 MW of demand at the end of 2001 (`G_256x60_s7`). That is about 6 MW a turbine on the bot's hilly map (`hilliness: 0.25`, `simbot.ts:224`). On the flat land FH-11 recommends, a turbine makes 3 MW (`catalog.ts:255-257`: 3 MW flat, up to 7 MW on a hilltop), so three make 9 MW: about 2,700 residents at this item's own 1 MW per 300, not 3,000.
  - Turbines must stand 2 empty tiles apart (`WIND_SPACING`, `actions.ts:123`; "Too close to another wind turbine"), which no step text says.
- **Play works too early.** The card's Play button works before steps 1, 3 and 4 are done (`shots2/132`: 1/5 done, the city running).
- **Step 2 ticks before anything can grow.** It ticks as soon as one R, one C and one I cell exist anywhere (`Onboarding.ts:94-106`).
  - A fresh profile ticked it with zones that touch no road (`shots2/131`).
  - The new player's industry read "Not growing: no road access … No power … No water" while the card showed 4/5 (`newplayer/063`).
- **Step 1 accepts too little.** It accepts any network cell on the map border (`Onboarding.ts:36-44`), while a real neighbour connection needs 6 cells reaching 3 tiles in (`connections.ts:15-18`).
- **No step says how much to zone.**

**Change**
- **Step texts.** Rewrite `STEPS` with the texts in §4 Phase B.
- **Step buttons pre-select the recommended tool** and pulse that flyout item, not only its category: `net:2`, `zone:1`, `plop:util_wind_turbine`, `plop:util_water_tower`. `Toolbar.openFlyout` gets an item argument.
- **Power cards show output.** The Utilities flyout's power cards show output next to the price ("3 MW flat · up to 7 on hills", "250 MW", "400 MW"), computed from `powerOut` × `WIND_TURBINE_BASE` / `GAIN` (`params.ts:411-415`). The tab header states the town's need: "Your town uses about 1 MW per 300 residents".
- **The turbine ghost shows its spacing ring**: the 2-tile clearance `WIND_SPACING` enforces, so the second turbine is never a surprise error.
- **Play waits for the town.** The step-5 Play button appears once steps 1–4 are done. Before that, step 5 reads "Finish the steps above first — or press Space to play anyway". The top-bar speed buttons are never blocked.
- **New done() checks.**
  - Step 1 needs `neighborConnections.length ≥ 1`.
  - Step 2 needs at least 40 R, 8 C and 12 I zoned cells whose `lotAccess` is `front` or `yard` (half that on 64-cell tiles).
- **New hints while a step is current**:
  - "Some zones don't touch a road — nothing grows there."
  - "Zone a bit more housing: 40 tiles of R (you have 18)."
- **Step 1 marks where to build.** It marks the nearest buildable map-edge segment with a ghost road, from `bestBuildableCell` to the nearest edge (new helper `src/ui/guide/edgeHint.ts`, drawn via `ctx.world.setHighlight`).
- **Spend guard**, once per profile: when day-0 spending passes 40% of the start money, show "You've spent §48,000 of §100,000 before anyone moved in. Running costs come next — keep a reserve."
- **Completion toast.** It keeps its fire-station tip only if a fuel plant was built anyway (`Onboarding.ts:297-303`).
- **Speed.** The Play step calls `host.setSpeed(1, 'onboarding')` (`WORKER_DESIGN.md` Appendix A).

**Files.** `src/ui/Onboarding.ts` (`edgeRoad`, `STEPS`, `frame`); `src/ui/Toolbar.ts` (`openFlyout` item highlight, power card output); `src/game/tools/PlopTool.ts` (the turbine spacing ring); new `src/ui/guide/edgeHint.ts`; `src/ui/zoneStatus.ts` (`lotAccess`, read only).

**Acceptance**
- New `tests/game/onboarding.test.ts`:
  - zones without road access leave step 2 false;
  - 40/8/12 front cells make it true;
  - a 2-cell edge stub leaves step 1 false;
  - a 6-cell road reaching 3 tiles in makes it true;
  - the Power step button leaves `tools.activeId === 'plop:util_wind_turbine'`;
  - the step-3 text's MW and resident numbers equal the values computed from the catalog and `params.ts` (a text test, so tuning changes cannot leave the copy wrong);
  - the step-5 Play button is absent while steps 1–4 are open.
- A scripted real-input first city that follows only the card spends at most §15,000 before Play on Medium. Today it is about §48,400 (`shots2/021`: §51,561 left).
- No step ticks while every zoned lot reads "Not growing".
- The islands preset on a 64 tile passes.

**Depends on.** W0.2 (`host.setSpeed`, `Tool.commit`); its lane starts after W0.6 (§8.0).

**Risk.** UI only. Thresholds must scale on small and island tiles.

#### FH-02 · "Your first year": goals that keep teaching after Press play
P1 · L · GUIDE · round 1

**Problem**
- **The guide disappears for good after step 5.** The card hides itself 6 s later and saves `dismissed` for every later city (`Onboarding.ts:292-305`, `:185`). Its last words are "Watch the RCI meter" (`shots2/113`).
- **Then come seven advisor cards at once.** Queensbury's year 1 asked for a landfill, a fire station by the plant and a school, beside a "healthy surplus" card (`shots2/027`).
- **The new player had nothing else to guide them**, and their town stayed small (all Medium):

  | date | residents | approval | screenshot |
  |---|---|---|---|
  | Oct 2000 | 124 | | `newplayer/073` |
  | Mar 2002 | 233 | | `newplayer/096` |
  | Jan 2004 | 422 | | `newplayer/128` |
  | Feb 2006 | 863 | | `newplayer/146` |
  | Mar 2009 | 1,968 | | `newplayer/160` |
  | Apr 2010 | 2,379 | 41% | `newplayer/175` |

  The bot had 46,762 by 2006.
- **Nothing in the game introduces the core systems**: garbage, police, fire cover, schools, the budget, data views or the inspector's Why? section, which is collapsed by default (`InfoPanel.ts:94`).
- **Nothing prepares the first power upgrade.** Three flat-land turbines (FH-01) top out at 9 MW, about 2,500–3,000 residents, exactly when G9 would hand over. The bot moves to gas above 12 MW (`simbot.ts:862`).

**Change**
- **A second phase on the same card**, "Your first year", with goals G1–G10 (texts, triggers and done conditions in §4 Phase C). G10 "More power" appears before the town browns out.
- **At most two goals are visible.** Each has one action button and a coach mark.
- **Goals tick from the city state** (`stats.population`, `stats.needs`, power supply and demand, approval terms, budget ledgers, garbage capacity) and chime when done. The pill reads "3/10 · Take out the trash".
- **G8 opens Why?** expanded with a pulse the first time a home is inspected.
- **Explainers share the goals' queue.** E1–E12 (§4 Phase D) follow the rules in §4.1. E12 explains the first brownout.

**Files.** `src/ui/Onboarding.ts`; new `src/ui/guide/goals.ts`, `src/ui/guide/coach.ts`, `src/ui/onboarding.css`; `src/game/CityScene.ts` (GUIDE hunk: coach hooks for panels, data views and the RCI segment); `src/ui/TopBar.ts` (coach marks on RCI, budget and approval); `src/ui/panels/InfoPanel.ts` (open Why? once).

**Acceptance**
- On a fresh profile and new city, the card switches to "Your first year" after step 5 and shows G1.
- Never more than two goals are visible.
- Each goal ticks within 1 s of its condition, with one unit test per predicate in `tests/game/onboarding.test.ts`.
- A scripted real-input run that only presses goal buttons reaches G9 (2,500 residents) by the end of year 3 on Easy and year 4 on Medium (years from founding), with no brownout before year 4.
- G10 appears before the first brownout in that run, and both its options (more turbines, a gas plant) clear it.
- The first inspector opened on a home shows Why? expanded.

**Depends on.** FH-01; FH-22 (per-city persistence); FH-05 (budget numbers in G5); PB-UPKEEP (estimates quoted in goal texts); PB-INSPECT (it edits `InfoPanel.ts` too); PB-BROWNOUT and PB-OUTAGE (E12 must describe the fixed brownout advice and exodus speed); W0.3 (inspector data comes from a watch).

**Risk.** UI only.
- Checks run at 2 Hz, as today. The NoGarbage trigger reads a counter refreshed at most once a second.
- Veterans skip this phase via FH-18. "Don't show again" ends both phases.

#### FH-22 · Guide progress saved per city, tips remembered per profile
P2 (unblocks FH-02) · S · GUIDE · round 1

**Problem**
- **One global setting.** Dismissal and minimise are a single localStorage preference (`Onboarding.ts:18`, `:161-164`, `:185`).
- **The card is for young cities only.** It shows only for cities under 300 residents and 40 buildings (`:163`).
- **Finishing disables the guide everywhere.** Finishing calls `hide(true)`, which turns the guide off for every later city (`:304`).
- **Progress is lost.** A reload mid-tutorial loses the player's place. Help's "Show getting-started guide" restarts at step 1 (`Modals.ts:242-246`).

**Change**
- **Per city.** Store the phase and goal progress in `state.systemData.onboarding` (optional, saved, and added to the Worker's mirrored `systemData` keys).
- **Per profile.** Keep "veteran", "seen explainers" and "tips on/off" in `loadPref`.
- **Dismissal.** "Don't show again" asks "this city / all cities".
- **Help** reopens the current phase.

**Files.** `src/ui/Onboarding.ts`; `src/ui/Modals.ts` (Help link). The SIM lane adds the mirrored key in `src/worker/**`.

**Acceptance**
- Save at G4 and reload: the card resumes at G4.
- A second city on the same profile shows the founding steps unless "all cities" was chosen.
- An old save without the key behaves as today.

**Depends on.** W0.6 (saves go through the host).

**Risk.** One optional `systemData` key.

#### FH-11 · A New City dialog and region screen that point a newcomer at a good start
P1 · S · META · round 1

**Problem**
- **No guidance in the dialog.** It asks for name, mayor, difficulty, terrain, trees, climate, disasters and start year with no guidance (`shots2/008`).
  - The difficulty cards show only money (`NewCityDialog.ts:97-111`), and the default is Medium (`config.ts:41`).
  - Disasters is on by default (`config.ts:53`) with no word on what it does. Disasters start at 2,000 residents (`disasters.ts:64-70`).
  - Nothing tells a newcomer to pick Easy, which after FH-04 is the forgiving mode.
- **The region screen gives no starting point.** It offers 106 tiles with "Click any tile" as the only hint (`shots2/005`, `007`).

**Change**
- **Difficulty cards get one-line descriptions** from FH-04's `DIFFICULTY_RULES` (`blurb`):
  - "Easy — §250k, +20% taxes, forgiving first years · Recommended for your first city";
  - "Medium — §100k, the intended balance";
  - "Hard — §40k, −15% taxes, tight from day one";
  - "Sandbox — unlimited money, everything unlocked".
- **Defaults.** A profile's first city preselects Easy and "Guided start". Later dialogs remember the last choice.
- **Disasters.** Easy unticks Disasters. The toggle gets the note "Tornadoes, quakes and meteors from 2,000 residents. Off is fine for a first city."
- **Toggles.** Add "Guided start" and "I've played city builders before" (FH-18).
- **A recommended tile.** In a region with no cities, the region screen outlines one medium tile labelled "A good first city". It is scored with quickstart's `pickNiceTile` (`main.ts:837`, moved to `RegionModel`) plus the share of flat buildable land.

**Files.** `src/region/NewCityDialog.ts`; `src/region/RegionScreen.ts`; `src/region/RegionModel.ts`; `src/main.ts`.

**Acceptance**
- On a fresh profile, the region shows exactly one highlighted tile.
- Its dialog opens with Easy and Guided start selected, the four descriptions shown and Disasters off.
- At 1280×720 nothing is clipped after returning from a city (screenshot).

**Depends on.** FH-04 (strings); PB-DIALOG.

**Risk.** UI only.

#### FH-12 · "Start your first city" on the title screen
P2 · M · META · round 2

**Problem**
- **Without a save, the title screen leads with a dead end.** Its first item is a disabled "Continue — No saved region yet", and the primary button is "New Region" (`shots2/001`). That is four screens and about ten choices before the first road (`shots2/002`, `005`, `007`, `008`).
- **The one-click start is a hidden URL.** It exists only as `?quickstart=1`, which deletes and recreates a fixed `quickstart` region each time (`main.ts:796-830`, `:803`).
- **The loading screen's tips are not about a first city.** A newcomer sees "Each region tile is its own city — found several and watch the region grow." (`newplayer/012`).

**Change**
- **With no region, the primary becomes "Start your first city"**, sub-line "Guided · your first road in about 2 minutes". One click:
  1. creates a Greenvale Valley region with a unique id;
  2. founds FH-11's recommended tile on Easy, with Guided start and Disasters off, on day 90 (FEEL-05);
  3. opens the paused city.
- **"New Region" moves to second place.**
- **The first-city loading screen** rotates the three tips in §4 Phase A.

**Files.** `src/region/ui/TitleScreen.ts`; `src/main.ts` (a quickstart-like path with a persistent region); `src/region/ui/LoadingScreen.ts`.

**Acceptance**
- On a fresh profile, one click reaches a founded, paused city with the guide card, after one loading screen.
- Exiting shows the city on its tile, and Continue returns to it.
- An existing region is never overwritten (unit test on region ids).

**Depends on.** FH-11, FH-04, FEEL-05; W0.6.

**Risk.** Region storage is IndexedDB, so use unique ids only.

#### FH-18 · A one-card briefing for SimCity 4 veterans
P2 · S · GUIDE · round 2

**Problem.** Rules that differ from SC4 are never stated:
- **Roads conduct power** (`Onboarding.ts:109`), yet the welcome tip says "connect it with power lines" (`Notifications.ts:62`), and so does the utilities advisor's no-power card (`AdvisorsPanel.ts:52`).
- **Pipes are automatic**, and only medium and high density need water (`zoneStatus.ts:184-186`).
- **A road from the map edge connects** to the region once it runs 3 tiles in (`connections.ts:15-18`).
- **Uncovered emergencies drop the game to LIVE** and wait for the player (`EmergencyBanner.ts:1-30`).
- **Why? lives collapsed in the inspector** (`InfoPanel.ts:94`).
- **9% tax is neutral**, with −3.5 approval per point above (`tuning.ts:148`, `:656`).

**Change**
- Show the six-bullet briefing (§4 Phase E) instead of the founding steps:
  - when "I've played city builders before" is ticked (FH-11);
  - or when the guide is dismissed within 30 s.
- Buttons: "Got it" and "Show the guided start anyway".
- The welcome tip is fixed in FEEL-01; this item fixes the advisor card's "Place a power plant and connect it with power lines" (`AdvisorsPanel.ts:52`) to "Place a power plant beside a road — roads carry power to your zones".

**Files.** `src/ui/Onboarding.ts` (briefing variant); `src/ui/panels/AdvisorsPanel.ts` (the utilities card text).

**Acceptance**
- Ticking the veteran box shows the briefing, not the steps.
- The briefing is at most 90 words.
- The ticker tip matches step 3's wording.
- A text test fails if any string in `src/ui` tells the player to connect a plant "with power lines" (both `Notifications.ts:62` and `AdvisorsPanel.ts:52` today).

**Depends on.** FH-11, FEEL-01.

**Risk.** None.

#### FH-17 · A Mayor's handbook behind F1, and a "?" on every panel
P2 · M · GUIDE · round 2

**Problem**
- **F1 explains very little.** It opens the shortcuts plus three tips (`Modals.ts:237-241`).
- **Most systems are never explained**: data views, Why?, emergencies, demand caps, rewards, loans, approval or garbage.
- **No help where it's needed.** Panels have no help button (`Panel.ts:23-35`), and a tip seen once is gone.
- **Help lists only some camera controls.** It has "Pan W A S D", Q / E, PgUp / PgDn, Right-drag, Middle-drag and Wheel (`Modals.ts:200-208`), but not Shift+Right-drag (the only pan a trackpad has), the arrow keys, Home or + / − (all in `CameraController.ts:4-7`).

**Change**
- **Help gets topic tabs**:
  - Getting started (reopens the guide at its phase)
  - Zoning & demand
  - Power, water & garbage
  - Services & coverage
  - Money (taxes, funding, loans)
  - Approval
  - Emergencies & dispatch
  - Data views & Why?
  - Region & neighbours
  - Shortcuts (the live bindings from FH-19 and FH-25)
- **Each topic** has 5–8 short lines, costs read from `getDef()` and tuning, and a "Show me" button.
- **Each panel header gets a "?"** that opens its topic. The topic comes from a registry keyed by panel id in `Modals.ts`, so no other lane's panel file changes.
- **"Tips you've seen"** lists the explainers E1–E12.

**Files.** `src/ui/Modals.ts` (`HelpPanel`, `SHORTCUTS`); `src/ui/Panel.ts` (header button).

**Acceptance**
- F1 → Emergencies → Show me opens the Emergency data view.
- Every registered panel has a working "?".
- A text test keeps each topic at most 120 words and checks that costs come from `getDef()`.
- The Shortcuts topic lists Shift+Right-drag, the arrow keys, Home and + / − besides today's rows.

**Depends on.** FH-02, FH-08, FH-13, FH-19; PB-PANELS (it rewrites `Panel.ts:227-239`) and PB-DATAVIEWS (the Data views panel and panel re-anchoring in `Panel.ts`).

**Risk.** Text drift, so read every number from the catalog and tuning.

### B. Advice that leads to action

#### FH-03 · Make "zone more" impossible to miss when growth stalls
P1 · S · GUIDE (+ a 3-line hook by META) · round 1

**Problem**
- **The only "zone more" message is hidden.** The `zoneR`, `zoneC` and `zoneI` rules are kind `info` (`advisors.ts:1225-1236`). They are posted as `advisor` news with no "!" (`advisors.ts:1378`), so the toast filter drops them (`Notifications.ts:113-114`).
  - They only scroll through the ticker: "…no room to grow — zone more residential land along roads." (`newplayer/146`).
  - In the Advisors panel they show under Alex Stone with a green status dot, because `info` maps to `good` (`newplayer/073`).
- **Meanwhile the new player's town grew from 124 to only 2,379 residents in 10 years** with residential demand high (`newplayer/073`–`175`).
- **The tall green R bar offers no action.**

**Change**
- **Below 20,000 residents the three zone rules become kind `warning`**, at most once per 180 days.
- **The toast carries a "Zone homes" action**, which selects `zone:1` and pulses Zones. The action comes from a new `src/ui/adviceActions.ts` map {advice id → action}, shared by Toasts and the Advisors panel. News items carry no id today (`NewsItem`, `CityState.ts:428-435`; `notify`, `Simulation.ts:153-156`), so the advice rule posts with `ref: {advice: 'zoneR'}` (the round-1 interface, §7.4), and the Toasts `'news'` handler looks the action up by `ref`, never by text. META adds that three-line lookup.
- **FEEL-02a's toast budget queues this toast** instead of dropping it, because it carries an action.
- **The RCI segment shows a small "+ zone" badge** while a family's demand is above 0.5 and fewer than 12 empty front lots exist.
- **The Planning card adds the count**: "4 empty residential lots left — demand wants many more".

**Files.** `src/sim/economy/advisors.ts` (GUIDE hunk: zone rules); new `src/ui/adviceActions.ts`; `src/ui/Notifications.ts` (META: action lookup); `src/ui/TopBar.ts` (RCI badge); `src/ui/panels/AdvisorsPanel.ts`.

**Acceptance**
- In a fixture with R demand above 0.5 and fewer than 12 empty R front tiles, a toast with "Zone homes" appears within one month tick, and at most once per 180 days.
- Clicking it selects `zone:1`.
- The badge shows, and disappears once 12 empty front lots exist.
- The FH-10 newcomer profile, which zones only when this cue fires, passes 5,000 residents by year 4 on Medium.
- The toast's action is found through `ref.advice` (a test changes the advice text and the button still works).
- `tests/sim/advisors.test.ts` is updated.

**Depends on.** FH-10 (measurement); the `NewsItem.ref` interface (§7.4); W0.5 (it edits `Notifications.ts` and `AdvisorsPanel.ts`, which W0.5 changes); PB-PANELS (`AdvisorsPanel.ts:243`).

**Risk.** Advice kinds and cooldowns live in `systemData.advisors`, so the bot's yearly state hashes change, though only in advisor news. The determinism check for this item compares hashes without `news` and `systemData.advisors`. Gates are unaffected.

#### LG-05 · "Your city is built out": endgame advice that names real options
P1 · S · GUIDE · round 1, after FH-03

**Problem.** On a full map the advice asks for the impossible:
- **The advisor keeps saying "zone more".** "Businesses want to open shops and offices — zone more commercial land." (`advisors.ts:1230`). "Unemployment is at 9%. Zone more commercial and industrial land — factories want to come…" (`advisors.ts:1251`).
- **Meanwhile there is no land left.** The bot logs "no site for a University near 113,71 (3748 people in need)" through 2057–60 (`G_256x60_s7` log).
- **The 2060 numbers**: residential demand −0.04, commercial 0.81, industrial 0.36, unemployment 9.0%.

**Change**
- **The scan counts free land.** The day-28 zone scan also counts buildable free land.
- **A "built out" card replaces "zone more".** When free land is under 1% of the map and a family's demand is at least 0.5, a `builtOut` card (Planning, priority 7) replaces the zone-more and unemployment texts.
- **It names real options.**
  - It names the three lowest-value occupied blocks as rezoning candidates.
  - It lists only the options that exist: rezone; raise density near stations (LG-08); a Business Arcology (LG-04); connect to a neighbour with spare jobs; found a sister city (LG-12).
  - Each option is a button (`adviceActions`).
- **The RCI popover's cap hints** show the same line.

**Files.** `src/sim/economy/advisors.ts` (GUIDE hunk: `zoneScan` counter and the rules); `src/ui/panels/AdvisorsPanel.ts`; `src/ui/TopBar.ts` (`renderCapHints`); `src/ui/adviceActions.ts`.

**Acceptance**
- On the y55 checkpoint of the 256×60 s7 run (regenerated at the merge commit, §8.0; no current-balance y55 save exists today), the built-out card appears within one month, and no `zoneC` or `zoneI` card fires while free land is under 1%.
- On the y15 checkpoint it never fires.
- Each button opens the right tool or view (UI test).
- The scan's cost is unchanged: one more counter in the existing pass.

**Depends on.** FH-03 (same hunk); PB-REGION before the card advertises neighbour jobs. The options for LG-04, LG-08 and LG-12 appear as those items land.

**Risk.** Advice text only (same hash note as FH-03).

#### FH-14 · One recommended next step above the advisor cards
P2 · M · GUIDE · round 2

**Problem**
- **Too many asks, no order.** In year 1 the Advisors panel shows five to seven cards with red or amber dots and competing asks, with no order and no cost.
  - Queensbury: landfill, a fire station by the plant, a school, plus "healthy surplus" (`shots2/027`).
  - Sunside: fire station, pollution, zone more (`newplayer/073`).
- **The badge undercounts.** The top-bar badge counts only "bad" assessments (`AdvisorsPanel.ts` `alertCount`).
- **A town making §150 a month cannot do all of them.**

**Change**
- **A "Next step" card at the top of the panel.** It shows the highest-priority open issue the player can act on now: it has a tool or a place, and its cost fits the budget.
- **It shows cost and budget effect** ("Zone a landfill — 3×3 ≈ §135, upkeep about §9 a month"), with Show me and tool buttons.
- **Ranking.** Under 10,000 residents, cheap high-impact fixes rank first: zone more, landfill, police kiosk, fire station.
- **The badge** counts open bad and warning issues.
- **`Advice` gains optional `tool` and `cost` fields.**

**Files.** `src/ui/panels/AdvisorsPanel.ts`; `src/sim/economy/advisors.ts` (GUIDE hunk: `Advice` metadata); `src/ui/adviceActions.ts`.

**Acceptance**
- Three fixtures, each with its expected Next step:
  1. like Queensbury in Nov 2000 (2,430 residents; no landfill, no school, plant out of fire reach): the landfill, with a Landfill button;
  2. like Sunside in Mar 2002 (233 residents; R demand above 0.5, fewer than 12 empty R front lots, a landfill in place): "Zone homes", with the Zones button;
  3. a 6,000-resident town with a landfill and spare lots, a crime term of −4 or worse and no police: a Police Kiosk (§400), with the Police tab.
- After the step is done, the next month's Next step changes.
- A unit test covers the ranking.

**Depends on.** FH-05 (budget-effect helper); PB-BROWNOUT, PB-PARKS, PB-DEPOT (advice texts); PB-PANELS (`AdvisorsPanel.ts:243` rebuild throttle); W0.3 (`openAdvice` query and `advisorIssues` watch).

**Risk.** UI and advice metadata; no sim effect.

#### FEEL-19 · Hover says what is wrong with a building
P2 · S · GUIDE · round 2

**Problem**
- **The hover tip says only what the building is.** It shows the name and residents or jobs (`QueryTool.ts:63-71`): "Shack · 4 residents" (`shots2/121`), "Courtyard Apartments · 542 residents" (`091`), "Coal Power Plant · 0 / 180 jobs" (`018`).
- **The trouble is only visible after a click.** The flags that explain it (`BF` Abandoned, Powered, Watered, NoRoad, NoJobs, Noisy, Polluted, Crime, NoGarbage, NeedsUnmet, Understaffed; `CityState.ts:28-50`) show only in the inspector.

**Change**
- **One status line from the flags**, in priority order: On fire, Abandoned, No road, No power, No water, Understaffed, No garbage pickup, Too noisy, Polluted, Needs unmet, Crime.
- **Same tone and wording as the inspector chips** (`inspectorModel.ts`).
- **"Thriving"** when there is no problem and condition is at least 90%; **"Under construction · 60%"** while building.
- **Cached** per building per sim day.

**Files.** `src/game/tools/QueryTool.ts` (GUIDE hunk: `move()`); `src/ui/inspectorModel.ts` (shared wording); `src/ui/zoneStatus.ts`.

**Acceptance**
- An unpowered shack shows "No power" in the warn tone; an abandoned building shows "Abandoned".
- The text equals the inspector chip.
- The tip costs at most 0.2 ms.

**Depends on.** W0.3. Flags are exact replica fields.

**Risk.** Low.

#### FH-15 · Placement previews that show consequences before the click
P2 · M · GUIDE · round 2

**Problem**
- **Previews exist only for garages and ferries** (`PlopTool.ts:86-110`).
- **Players learn the consequences after it is too late.**
  - Smoke and stigma are learned after the coal plant is built: `shots2/017` only switches on the Air view; then smoke over the homes (`newplayer/146`) and "severe stigma within 12 tiles" (`shots2/i01`).
  - Polluted ground water is learned two years later: "Tap water quality is only 28% … Your Water Pump draws polluted water" (`shots2/059`).
  - A fire station's reach shows only in the overlay.

**Change**
- **Category previews at the ghost**:
  - power plants: "Supplies 400 MW — your town uses 9 MW";
  - smoke and noise emitters: "Smoke drifts SW onto 24 zoned homes" (wind as in the Air legend), "31 homes within 12 tiles become less desirable";
  - pumps: "Ground water here: 62% clean — industry 6 tiles away";
  - fire, police, clinic and school: "Would answer 312 buildings automatically, incl. your Coal Power Plant" or "248 children in walking reach".
- **Cost control.** Recompute only when the ghost changes cell. Read only layers the placement already subscribes to (PlopTool already switches the data view).
- **Honest numbers.** Label counts "about".

**Files.** `src/game/tools/PlopTool.ts`; new `src/ui/guide/previews.ts`, pure helpers over mirrored layers. No sim file edits.

**Acceptance**
- A coal ghost beside an R zone reports at least one home under smoke.
- A pump ghost next to dirty industry reports under 80% clean.
- A fire-station ghost's count is within ±10% of the green cells after placing.
- Ghost refresh is at most 1 ms p95 on a 256 map.

**Depends on.** PB-UPKEEP; PB-OVERLAY; W0.5 (derived-layer subscriptions).

**Risk.** Performance on big maps. Throttle to cell changes and use coarse rasters.

#### FH-16 · Plain names next to R$, CS$$$, CO$$, I-D, EQ and HQ
P2 · S · GUIDE · round 2

**Problem**
- **Codes without names.** Tax rows and the ledger show bare codes (`shots2/079`; `078`: "R$$ §2,849 · I-M §701 · CO$$ §458").
- **The row tooltip says little.** It is only "Last month: §X" (`BudgetPanel.ts:163`).
- **EQ and HQ are never explained** (`shots2/058` "EQ 45", "HQ 54"; `newplayer/073` "EQ 47 · HQ 46").
- **The plain names already exist** in `DEV_NAMES` (`TopBar.ts:55-60`).

**Change**
- **One shared glossary**, new `src/ui/glossary.ts`, used by the tax tab, the ledger, the RCI popover, Stats and the advisors. Examples: "R$ · low-wealth homes", "I-D · dirty industry", "CO$$ · offices".
- **Hovering a type says what it wants.**
- **EQ** gets "Education quotient — how educated your workers are (0–150); offices and high-tech want 80+". **HQ** gets the health equivalent.

**Files.** `src/ui/glossary.ts`; `src/ui/panels/BudgetPanel.ts`; `src/ui/TopBar.ts` (RCI popover); `src/ui/panels/StatsPanel.ts`; `src/ui/panels/AdvisorsPanel.ts`.

**Acceptance**
- Every tax row and ledger tax line shows a plain name, on a second dim line.
- Hovering EQ in Stats shows the glossary entry.
- 1280×720 screenshots show no truncation.

**Depends on.** PB-LEDGER, PB-SLIDER.

**Risk.** Row width at 720p.

#### NEW-06 · Shore placement that finds a spot
P2 · S · GUIDE (SIM changes the shore rule; CONTENT the unlock) · round 2

**Problem**
- **Some shore buildings cannot be placed at all.** On the sandbox tile's diagonal coast, the Container Seaport and the Desalination plant failed in every rotation (playtest summary; `shots2/sb_06`: "Must be placed on the shore with its front facing water").
  - The rule wants at least half of the row just outside the lot's front to be water (`countFront`, `actions.ts:576-578`), and no footprint cell may be water (`actions.ts:556-557`).
  - On a 45° coast, a lot 3 or more cells wide can then have at most one water cell in that row, so it can never pass.
- **Rewards promise what the map cannot hold.** The Seaport unlocks on any water (`hasWater`, `rewards.ts:90`). The Lighthouse must stand on the shore (`catalog.ts:417`), yet G9 promises it on a tile FH-11 picks for flat land.
- **Finding a spot is trial and error.** PB-SHORE fixes the auto-rotation (playtest #14), but nothing shows where a valid spot is.

**Change**
- **Valid spots are tinted** while a shore building is selected: every cell where some rotation passes, and hovering one picks that rotation. The scan covers only cells within a footprint's width of water, once per tool selection.
- **Diagonal coasts work** (SIM). A rotation also passes when the band in front of the lot, as deep as the lot is wide, is at least half water. A 45° coast gives about 58% for a 6-wide lot at the waterline. Today's first-row rule stays as an alternative, so every spot valid today stays valid.
- **Shore rewards need a site** (CONTENT). The Seaport's "Coastline" condition becomes "a valid shore site exists" (`hasShoreSite`, the same scan, cached until terrain, water or buildings change). A population landmark that needs the shore keeps its unlock, but its Rewards row says "No shore site on this map", and the HUD's next-goal line (LG-01) skips it.
- **G9 names the Lighthouse only on a tile with a valid shore site**, and otherwise the Clock Tower at 5,000 (§4.5).

**Files.** `src/game/tools/PlopTool.ts` and new `src/ui/guide/shoreSites.ts` (GUIDE); `src/sim/actions.ts` (SIM hunk: the shore test) and `src/sim/economy/buildings.ts` (`countFront` band variant); `src/sim/economy/rewards.ts` (CONTENT: the Seaport condition); `src/ui/panels/ListPanels.ts` (CONTENT: the row note).

**Acceptance**
- On the playtest's sandbox tile (Fairland), a scripted run places a Container Seaport and a Desalination plant.
- On a fixture map, every tinted cell accepts a click with its suggested rotation, and no untinted cell does.
- On a map with no valid site, the Seaport stays locked with the reason "needs a shore site", the Rewards panel shows "No shore site on this map" on the Lighthouse, and the HUD never names it as the next goal.
- The scan costs at most 5 ms once per selection on a 256 map.

**Depends on.** PB-SHORE (auto-facing lands first in the same files).

**Risk.** The bot places desalination plants and seaports through `plop` (`placeShore`, `simbot.ts:1985`), and it picks the valid site nearest the centre, so new valid sites can move its rows. Check G-DET on 256×60 s7; if rows move, record them under `polish`.

#### NEW-07 · Wording sweep for routed facility and graph texts
P2 · S · GUIDE (SIM edits the sim-side strings) · round 2

**Problem.** `ROUTED_ITEMS.md` sends these texts to the final-fix or polish phase, and no item owned them (§ "Veteran findings and routed items"):
- routed 6: justice advice says "build 2 more prisons" when police funding is cut or a prison has no power;
- routed 7: a prison at 0% police funding or on strike reads "Inmates 0 / 0 (0% full)" with an ok status;
- routed 8: the yearly sentence projection is last month × 12, and monthly arrests alternate about 2.3×;
- routed 15: the WP5 texts still to check (advisor "jail" text, Stats "JAIL", the riot advisor, the PlopTool highway warning, the Wind Turbine "Water" chip);
- routed 49: "+0" and "−0" in Why? (`population.ts` `conditionBreakdown`, `growth.ts` detail lines);
- routed 52: percentage graphs without a fixed range print duplicate ticks ("0% 1% 1% 2% 2%");
- routed 10, 11, 55 and 57, if PB-STAFF, PB-NOROAD and the part-B final-fix lanes leave them: "still hiring" instead of the road hint for facilities under a month old; posted jobs in the Staff line; a full garage names the neighbour garage with room; "Full — 26,428 cars wanted" becomes "about N commuters would use it".

**Change.** One fix per line above, each with a text or unit test. Numbers use the UI's `signedPts()` convention ("0" under half a point, U+2212 minus).

**Files.** `src/sim/infra/facilities.ts` (`justiceCityLines`, the prison facts, `staffHint`), `src/sim/economy/population.ts`, `src/sim/economy/growth.ts` (SIM: strings only); `src/ui/graphAxis.ts`, `src/ui/panels/GraphsPanel.ts` and the facility rows in `src/ui/panels/InfoPanel.ts` (GUIDE).

**Acceptance.** One line per routed item:
- 6: with police funding at 0%, the justice line names the funding first;
- 7: an unfunded prison reads "closed — no police budget" with status bad, refreshed the same day;
- 8: the projection is a 3-month average and moves less than 25% month to month on a steady city;
- 15: each listed text matches the current rules (a text test per string);
- 49: no Why? row prints "+0" or "−0";
- 52: no graph axis repeats a label;
- 10, 11, 55, 57 (if taken here): the new wording shows in the inspector of a 20-day-old school, an unstaffed school, a full garage beside an empty one, and a 900-space garage.

**Depends on.** PB-STAFF, PB-NOROAD (same functions); the part-B final-fix lanes' decision on 53–57.

**Risk.** Strings only, so no gate moves. A text that is posted as news lands in hashed state, so the determinism check uses FH-03's rule (hashes without `news` and `systemData.advisors`).

### C. Money and approval

#### FH-05 · Show what a building does to the monthly budget before it is placed
P1 · S · GUIDE · round 1

**Problem**
- **Placement never shows the city's net.** It shows an upkeep estimate only (`PlopTool.ts:180`, `Toolbar.ts:184`).
  - At 1,574 residents the Fire Station read ≈§539/mo while the town made +§259/mo (`shots2/024`).
  - The finance card then said "A healthy surplus of §150 last month. Consider investing in services." (`AdvisorsPanel.ts:42`, `shots2/027`).
- **Players overbuild without knowing it.** After placing several services, Queensbury stood at §2,042 and −§968/mo (`shots2/078`).
- **Losses are played down.** The new player lost §63–§192 a month for years and was told "At this rate the treasury runs dry in 1119 months" (`newplayer/073`; `AdvisorsPanel.ts:41`).

**Change**
- **Plop tooltip and flyout card get one line**: "Monthly budget: +§259 → −§280 after this".
  - It is computed from last month's recurring net (`budget.lastIncome` and `lastExpense`, mirrored) plus `expectedUpkeep(st, def)`, which reads `stats.needs` and is replica-safe.
  - It never calls `computeMonthlyBudget` on hover; that becomes a Worker watch (`WORKER_DESIGN.md` §2.8).
  - The line turns red when the net goes negative, and then adds "≈ N months of reserves".
- **The finance assessment tells the truth.**
  - It says "healthy surplus" only when net is at least 25% of income. Otherwise: "A small surplus of §150 — a Fire Station costs about §540 a month. Grow the town or raise taxes a little first."
  - The months-left line is capped: "more than 5 years at this rate".

**Files.** `src/game/tools/PlopTool.ts`; `src/ui/Toolbar.ts`; `src/ui/panels/AdvisorsPanel.ts` (finance `assess`); new `src/ui/guide/budgetDelta.ts`.

**Acceptance**
- In a 1,500-resident fixture, hovering a Fire Station shows "before → after".
- In that fixture with growth frozen (the growth system off, so the town cannot grow 23.7% in a month as Queensbury did, `shots2/024`), one month after placing it:
  - the Fire Station's own expense line is within ±15% of the predicted upkeep;
  - the change in net is within ±15% of the predicted change.
- Unit test: a net of §150 with a §540 cheapest unmet service gives the "small surplus" wording.
- The months-left text never exceeds 60 months.

**Depends on.** PB-UPKEEP.

**Risk.** UI only.

#### FH-06 · Approval a newcomer can read
P1 · S · GUIDE · round 1

**Problem**
- **Approval starts high and then falls for everyone.** The HUD reads "Approval 65%" before anyone lives in the city (`shots2/010`, `newplayer/047`).
  - Queensbury went 55% → 49% → 45% in year 1 (`shots2/023`, `024`, `027`).
  - The new player was at 40% heading for 34%, with Crime −12.4 at 124 residents (`newplayer/073`), then 36% with a frown face (`newplayer/096`).
  - Even the bot sits at 43–54 in years 1–6.
- **The hover explains the biggest rows least.** Crime, tax and the baseline have no detail (`approvalDetail` has no `crime`, `tax` or `base` case: `approval.ts:372-400`). No row links to a fix.
- **The face punishes correct play.** It shows "meh" below 60 and a frown below 40 (`TopBar.ts:481-485`), so the whole first hour looks like failure even when the play is correct.

**Change**
1. **Below 50 residents** show "—", with "Approval starts with your first residents".
2. **Row details:**
   - crime: "crime at homes 41% — low-wealth homes, uncollected garbage and low land value; police remove up to 85% where they patrol";
   - tax: "homes are taxed 11% — each point above 9% costs 3.5";
   - baseline: "every city starts at 61".
3. **Clicking a row opens its fix:** crime → Police view, tax → Budget · Taxes, air → Air view, services → Police, Fire or Health view, parks → Parks tab.
4. **Under 10,000 residents:**
   - the footer reads "New towns usually sit at 45–55% until police, parks and land value arrive.";
   - the face is a smile at 50 or more, meh at 35 or more, a frown below 35.

   From 10,000 residents today's thresholds apply.

**Files.** `src/ui/TopBar.ts` (approval block); `src/sim/economy/approval.ts` (GUIDE hunk: `approvalDetail`, `APPROVAL_LABELS`).

**Acceptance**
- At 0 residents the HUD shows "—".
- Unit tests: `approvalDetail` returns text for `crime`, `tax` and `base`.
- Clicking the crime row sets `ctx.overlay = Overlay.Police`.
- Under 10k the footer renders.
- At 3,000 residents: 52% shows a smile, 38% meh, 30% a frown.

**Depends on.** FH-04 (the Easy rule's "new-town grace" row text, and the 45–55% line, which must be re-checked after FH-04 and the final balance).

**Risk.** The "usual range" sentence must stay true, so derive it from the bot tables.

#### FH-09 · The tax panel tells the truth: approval is lost from 9%, not 12%
P1 · S · GUIDE · round 1

**Problem**
- **The panel points at the wrong threshold.**
  - Its hint says "Taxes above ~12% slow growth and hurt approval" (`BudgetPanel.ts:167`; `shots2/079`, `newplayer/128`).
  - Sliders turn amber only above 12% (`BudgetPanel.ts:401`).
  - The `taxHigh` advice waits for 12% (`advisors.ts:1036-1040`).
- **In fact approval falls 3.5 points for every point above 9%** (`TAX_NEUTRAL` `tuning.ts:148`, `taxPerPoint` `:656`), and demand falls with `TAX_SENS` (`:149`).
- **But growth barely moves until 13%, then collapses at 14%** (veteran #1): at 128×15, 12% costs 5.5% of the people, 13% 12.5%, 14% 70%. The sliders turn amber above 12% and red above 15% (`BudgetPanel.ts:401-402`), so red marks a rate the city is already gone at.
- **The shown approval lags the cost.** Approval moves 30% of the way to its target each month (`APPROVAL.ema` 0.3, `tuning.ts:667`; `approval.ts:327`), so a "−7 approval" shows as about −2.1 after one month.
- **Players lose approval without warning.** The playtester set 11/11/10 (`shots2/079`) and lost about 7 points with no warning. The bot runs 10.5–11% in years 2–7.

**Change**
- **New hint**, true to today's rules: "9% is neutral. Each point above costs approval (−3.5 a point); above 13% demand collapses. Each point below wins approval (+1.5) but less income." Once PB-TAXRESPONSE or NEW-05 lands, the second clause becomes "and slows growth (about N% a point)", with N read from the tax sweep.
- **Live effects on the rows.** Residential rows show the approval effect against `approvalRaw`, the "heading for" value (`TopBar.ts:501`): "approval heads 7 lower (reached over ~6 months)". Commercial and industrial rows show the demand factor from `taxFactor` ("demand ×0.9").
- **Slider colours.** Sliders turn amber above 9.5% and red from 13.5%. After PB-TAXRESPONSE or NEW-05 the red threshold moves to where the sweep loses 10% of the population.
- **The `taxHigh` advice** fires from 11%, with the approval cost in its text.

**Files.** `src/ui/panels/BudgetPanel.ts`; `src/sim/economy/advisors.ts` (GUIDE hunk: `taxHigh`); `demand.ts` `taxFactor` (read only).

**Acceptance**
- With All residential at 11%, the rows show "approval heads 7 lower" and the new hint.
- One month later `approvalRaw` is within ±15% of 7 points lower; the shown approval reaches 88% of it after 6 months (the EMA's 1 − 0.7⁶).
- The slider has class `warn` at 10% and `bad` at 14%, but not at 13%.
- In `tests/sim/advisors.test.ts`, `taxHigh` fires at 11% and mentions approval.

**Depends on.** PB-SLIDER; PB-TAXRESPONSE or NEW-05 for the growth clause and the red threshold.

**Risk.** Adds advisor news in bot runs (hash note as FH-03).

#### FH-07a · Fresh mistakes are free to fix: same-day and young-building refunds
P1 · S · SIM · round 1

**Problem**
- **Mistakes cost money.** Bulldozing a plopped building refunds nothing, and networks refund 25% (`actions.ts:16-17`; `NETWORK_REFUND` `tuning.ts:637`).
- **A misplaced coal plant is a quarter of the start money on Medium.** Both real-input players bought it on day 0 while paused, then kept the oversized plant beside their homes for years instead of moving it (`shots2/i01`: 15% load, "severe stigma within 12 tiles"; `newplayer/146`: smoke over the houses).

**Change**
- Anything bulldozed on the same game day it was built refunds 100%. The day never advances while paused, so a whole paused planning session, the day-0 one included, is refundable.
- Plopped buildings under 30 days old refund 50%. After that, today's rules apply.
- `Building.age` exists already. Roads use a per-day set of fresh cells kept in `CityActions`.
- The bulldoze tip reads "Refund §25,000 (built today)".

**Files.** `src/sim/actions.ts` (spend/refund, bulldoze, networks); `src/game/demolishRisk.ts` (refund text).

**Acceptance**
- In `tests/sim/actions.test.ts`:
  - plop a coal plant and bulldoze it the same day: funds equal the pre-plop value;
  - bulldoze it on day 20: half the price comes back; on day 31: today's rules.
- The default bot's rows stay bit-identical (256×20 s7, two processes). The run logs how often the bot bulldozes a building under 30 days old; if it ever does, its rows move by design and go under `polish`.

**Depends on.** W0.2 (command rows); PB-NOROAD (the `lotTouchesRoad` change in `actions.ts` lands first); the perf branch `b1`, which also edits `actions.ts`.

**Risk.**
- The build-use-refund exploit is limited to the same game day and to half the price within 30 days.
- With the Worker, main's preview has no fresh-cell set, so W1.1 either mirrors it or marks refund predictions provisional.
- Journal replay runs every command at the base's day (`WORKER_DESIGN.md` §4.3), which would turn a day-20 bulldoze into a same-day one. So the journal records the refund that was charged, not the rule (§7.6).
- Nothing new is saved.

#### FH-07b · Ctrl+Z for actions made while paused or within the current day
P2 · M · SIM (WORLD adds the key) · round 2, after W1.3

**Problem**
- **There is no undo.** `CityScene.ts:824-830` binds only Ctrl+S.
- **A same-day undo is short while the game runs.** A day lasts 0.5 s at 1× and 0.05 s at ultra (`SECONDS_PER_DAY`, `src/core/constants.ts:34`), so "the current game day" ends before a player reaches for Ctrl+Z. Undo is a planning tool for paused play.
- **Undo would break crash recovery.** The recovery journal replays a whitelist of commands (`JournalOp`, `WORKER_DESIGN.md:814`) that has no `undo`. After a crash it would replay the plop but not its undo, so the building comes back and is paid for again.

**Change**
- Ctrl+Z undoes up to the last 20 player actions made while paused or within the current game day (road, zone, plop, bulldoze, power line), from inverse records kept by `CityActions`.
- The "Undo: Ctrl+Z" chip shows only while undo is available, and hides the moment the day advances.
- The stack clears when the day advances or the city loads.
- New Worker command `undo`: it counts in `pending`, and its ack is an `ActionResult`. The journal records it as its concrete inverse commands (a bulldoze with the refund amount, a network rebuild, a re-zone), never as `undo` (§7.6).
- WORLD binds Ctrl+Z in `onKey`.

**Files.** `src/sim/actions.ts` (inverse records); `src/worker/protocol.ts`, `HostActions` and `src/worker/journal.ts` (`undo` and its inverse rows); `src/game/CityScene.ts` (WORLD hunk: `onKey`).

**Acceptance**
- In `tests/sim/actions.test.ts`:
  - draw a 40-cell road and undo: `network`, `netFlags` and funds equal the before-state (equal hash);
  - after one day passes, undo does nothing.
- Plop a coal plant, undo, kill the tab: the restored city has no plant and its pre-plop funds.
- The chip is never visible when Ctrl+Z would do nothing.
- A bot run that never undoes stays bit-identical (256×20 s7, two processes).

**Depends on.** FH-07a; W0.2 and W1.1 (command rows, predictions); W1.3 (the journal).

**Risk.** Undo must emit the same events as bulldoze and plop (`networkChanged`, `buildingRemoved`, `powerLinesChanged`) so the caches rebuild.

#### FH-13 · Money coach: the first deficit explained, a recovery plan when broke
P2 · S · GUIDE · round 2

**Problem**
- **Deficit advice comes too late.** It fires only when funds fall below 8× the deficit (`advisors.ts:1023-1025`). Low-funds and loan advice only fires below §5,000 (`:1027-1031`).
- **So the new player lost money for years without a word.** They lost §63–§192 a month with §55–70k in the bank (`newplayer/073`; `128`: income §189 vs expenses §372).
- **Nothing points at Loans**, although the bot borrows twice in year 2.
- **Bankruptcy has no plan.** After 12 negative months it is a news line with no plan (`budget.ts:240-258`).

**Change**
- **First deficit.** Once per profile, on the first month with net below 0 and more than 200 residents, show explainer E4 (§4) with Taxes, Loans and Got it. Its numbers come from the FH-05 helper and `loanOffer` (replica-safe).
- **Broke.** With funds below zero, the finance card becomes a three-step recovery plan with one-click actions:
  1. +1 point on every tax;
  2. the most over-funded service down to 90%;
  3. the largest loan the budget can carry.

  Each step shows its monthly effect.

**Files.** `src/ui/panels/AdvisorsPanel.ts`; `src/ui/panels/BudgetPanel.ts` (Loans tab focus); `src/sim/economy/advisors.ts` (GUIDE hunk: deficit threshold).

**Acceptance**
- In a fixture with net −§183 and §59k, the card appears once, with numbers within ±10% of the `computeMonthlyBudget` deltas.
- With funds below 0, each recovery button moves the projected net in the stated direction.

**Depends on.** FH-05; PB-UPKEEP.

**Risk.** UI only.

#### FEEL-03 · Money you can feel: cost floats, animated funds, monthly and approval deltas
P2 · M · GUIDE · round 2

**Problem**
- **Every paid action only plays a sound**: `plop` (`PlopTool.ts:201-219`), `zone` and `bulldoze` (`ZoneTool.ts:160-168`), `road` (`NetworkTool.ts:133`).
- **The money doesn't visibly move.**
  - The funds label swaps text at the next 6 Hz UI tick (`TopBar.ts:423`).
  - The monthly result is a quiet `coin` or `cashLow` at most every 90 s (`GameSounds.ts:261-279`).
  - The coal plant cost §25,018 with no on-screen beat (`shots2/017`→`018`).
- **The deficit was found by accident.** The playtester found −§968/mo only in the Budget panel, at §2,042 (`shots2/078`): "As a player I could not predict the budget".
- **Approval jumps without motion** (`TopBar.ts:479-486`).

**Change**
- **(a) Cost floats.** Every successful commit with a non-zero cost shows a float at the cursor: "−§25,018" in red or "+§1,200 refund" in green.
  - It rises 28 px and fades over 900 ms.
  - Plops with upkeep add "+§700/mo".
  - It hooks into `Tool.commit`'s ok feedback (W0.2), so every tool gets it.
- **(b) Funds count up.** The funds figure counts to its new value over 350 ms, with a 400 ms red or green flash.
- **(c) Monthly chip.** At the month tick a chip under the funds shows the change for 2.5 s ("+§1,311"). At ultra it shows only when the sign flips or the change is 20% or more.
- **(d) Approval chip.** When monthly approval moves by a point or more, a chip under Approval shows for 3 s, e.g. "−2 · Taxes" (the term that changed most, from `approvalBreakdown`).
- **Limits.** None of this in sandbox. Floats are pooled (at most 6) and animate transform and opacity only. FEEL-21's reduced motion is honoured.

**Files.** New `src/ui/FloatText.ts`; `src/game/tools/Tool.ts` (GUIDE hunk: commit feedback); the funds and approval segments of the TopBar (separate components after the round-1 split, §7.4). Sandbox: the funds segment shows "∞" with no monthly net. Today it shows a red "−§11,231/mo" (`shots2/hd_01`) or "−§10,861/mo" (`shots2/113`) beside "∞", which reads as a warning that cannot apply.

**Acceptance**
- Placing a coal plant shows exactly `ActionResult.cost` within 100 ms, plus "+§700/mo".
- A failed placement shows no float.
- The funds label passes through at least 3 intermediate values.
- The month chip equals Budget's "Monthly net (recurring)".
- The approval chip names the term that changed most.
- No forced layout is added per frame.
- In sandbox the funds segment shows "∞" and no red net.

**Depends on.** PB-UPKEEP; W0.2; the TopBar split (§7.4).

**Risk.** UI only. Noise at ultra is held by the sign/20% rule.

### D. Emergencies

#### FH-08 · The first emergency teaches dispatch instead of just failing
P1 · M · META · round 1

**Problem**
- **The first emergency arrives with no teaching moment.** Queensbury's first uncovered fire (Nov 2000, 2,430 residents) was already too far: no LIVE and no Send button. The banner said only "Help came too late — 1 building lost", with Jump and Choose station… (`shots2/027`; PB-AMBER).
- **Even the bot loses most of its first incidents**: 3 of 4 in year 1 (acceptance r3 s7, 2001).
- **LIVE is unexplained.** It is explained only in the pill's hover title (`TopBar.ts:147`).
- **Nothing says how to avoid the next one**, and each ignored prompt costs 1.5 approval for a year (`tuning.ts:716`).
- **Below 1,000 residents only fires raise an alert** (`ALERT_MIN_POP`, `EmergencyBanner.ts:46`).

**Change.** One-shot teaching per profile. It is a separate episode state in the speed policy (`src/game/emergencyPolicy.ts` after W0.4; the flag `teachFirst` reaches the worker via `setSettings`). Seen flags live in `loadPref`.
- **E1a: the first alerted major incident that can still be saved** (`manualPossible`).
  - The game pauses once, even under the "live" policy.
  - A coach card under the banner reads: "Emergency! Fire at Refinery. No fire station covers this spot, so nobody comes on their own. Send nearest dispatches Fire Station #1 (3.9 min). Areas marked Auto-dispatch in the Emergency view are answered automatically." The texts name legend labels, never colours: green vs amber is only 66 apart under deuteranopia and 56 under protanopia, and FH-20 changes the colours.
  - Buttons: Send nearest, Emergency view, Got it.
- **E1b: the first alerted major incident that is already too far** (`canSend` without `manualPossible`).
  - The card reads: "No station can reach this in time. Build a Fire Station within ~24 road tiles — the Emergency view shows where help is automatic."
  - Buttons: Fire tab, Emergency view.
- **E2: the first LIVE slowdown.** One toast: "LIVE: the game slowed down so you can follow the truck. Your speed comes back when help arrives (Settings → Gameplay)."
- **E3: the first failed incident.** The outcome adds why: "the nearest truck needed 5.6 min; this fire burned out in 5 — a station within ~24 road tiles answers in time."

**Files.** `src/ui/EmergencyBanner.ts`; `src/game/emergencyPolicy.ts`; `src/ui/TopBar.ts` (META hunk: LIVE pill title); `src/ui/emergency.css`.

**Acceptance**
- On a fresh profile, an uncovered fire pauses the game and shows the card. The disaster tool exists only with Disasters on or in sandbox (`toolCatalog.ts:301`), and FH-11 turns Disasters off for a first city, so the test uses a Medium city with Disasters on, or a debug spawn.
- Send nearest leaves the incident dispatched and closes the card.
- A too-far fire shows E1b.
- A second uncovered fire behaves as today.
- The LIVE toast appears exactly once.
- `tests/game/emergencyPolicy.test.ts` covers the one-shot pause and both variants.

**Depends on.** PB-ACCIDENT, PB-AMBER, PB-COOLDOWN, PB-GRACE (the texts must describe the fixed behaviour); W0.4; FH-20's Emergency palette, which moves to round 1 with this item.

**Risk.** It must not fight the urgent pause (`LIVE_PAUSE_SEC`), so it is a separate episode state.

#### FEEL-09 · Follow the truck you sent
P2 · M · WORLD · round 2

**Problem**
- **LIVE exists "so the player can follow the trucks"** (`EmergencyBanner.ts:14-18`), but nothing follows them.
- **After "Send nearest" the banner offers only Jump and Choose station.**
- **The playtester panned and zoomed by hand** to watch the Refinery truck (`shots2/042`→`043`).

**Change**
- **After a player dispatch, the banner shows "Follow"** with a camera icon.
- **Following** keeps the camera target on the lead vehicle, read from the `EmergencyView` feed and smoothed (λ = 6). The player's yaw and tilt are kept, and the distance eases to 260 m.
- **It ends** 2 s after the unit is on scene, or on any pan or zoom input.
- **A chip** reads "Following Fire truck from Fire Station #1 · 1.1 min".
- **Scope.** Player-dispatched units only. Camera only: no vehicle control.

**Files.** `src/ui/EmergencyBanner.ts` (WORLD owns the banner-button hunk in round 2); `src/render/world/CameraController.ts` (follow API); `src/render/city/vehicles/EmergencyVehicles.ts`; `src/game/CityScene.ts` (WORLD hunk).

**Acceptance**
- In the playtest's Refinery scenario, the truck stays in the central 30% of the screen for the whole drive at LIVE, with no frame-to-frame jump over 3 px at 60 fps.
- Control returns 2 s after the unit is on scene, and any drag ends Follow at once.
- Auto-dispatched units never show Follow.

**Depends on.** FEEL-08; PB-ACCIDENT; W0.5 (`EmergencyView`).

**Risk.** Scope creep toward the postponed drive mode, so it stays camera-only.

#### FEEL-10 · Emergency outcomes and LIVE mode that feel urgent
P2 · S · WORLD · round 2

**Problem**
- **A save the player made ends as a fading line.** After a manual dispatch the banner just shows "Fire under control" (`EmergencyBanner.ts:296-305`).
- **Success and failure sound almost the same.** The restore toast "Emergencies handled — back to ultra speed" plays the generic `good` chime (`EmergencyBanner.ts:368-383`), and a failure gets the same banner line.
- **GameSounds reacts only to `uncovered`** (`GameSounds.ts:245-254`).
- **LIVE barely changes the mood.** The only cue is the pill, and the music stays at full level (`shots2/042`).

**Change**
- **Outcome stings.**
  - A "saved" sting (0.8 s, bright) plays when an incident the player dispatched resolves with no losses. A low "lost" sting plays on failure or losses.
  - The banner flashes green or red for 600 ms.
  - The restore toast is silent when a sting just played.
  - At most 1 sting per 10 s.
- **LIVE mode.**
  - A 3% red edge vignette (CSS on `.mp-ui.emg-live` in a new WORLD file `src/ui/fx.css`).
  - The music drops 6 dB via FEEL-11's duck API.
  - Both release 0.5 s after LIVE ends.

**Files.** `src/game/GameSounds.ts` (`onEmergency`); `src/audio/sfx.ts`; `src/ui/fx.css`; `src/ui/EmergencyBanner.ts` (WORLD in round 2: the restore toast's silent flag, flash class).

**Acceptance**
- Replaying the Refinery dispatch plays exactly one "saved" sting and no second chime.
- A failed alert plays "lost".
- The vignette shows exactly while the LIVE pill does.
- The music bus is 6 ± 1 dB lower during LIVE (debug getter).

**Depends on.** FEEL-11; PB-ACCIDENT.

**Risk.** Sound fatigue in disaster chains, held by the rate limit. With reduced motion the vignette does not pulse.

#### NEW-02 · Unreachable buildings show it on the model in the Emergency view
P2 · S · WORLD · round 2

**Problem.**
- **Routed item 48** (the lead's decision on item 17) sends this explicitly to this pass.
- **Small roadless buildings hide their warning.** Drawing whole cells in the Emergency view is correct, but a small roadless landmark (a 1×1 Obelisk or Statue) hides its own red cell under its model. So "no road reaches it" is invisible exactly where it matters.
- **The misleading amber ring must not come back.**

**Change.** In the Emergency view, buildings whose response reason is `noRoad` get a red outline or ring decal, or a red tint on the model itself, as well as today's hover text. The tint must not take an instance flag: `flagsToAlpha` packs `flags & 15` (`cityMaterial.ts:21-27`), bits 0–2 are used and FEEL-18 takes bit 3. It uses the overlay uniform path (a per-building lookup texture the overlay shader samples) or a per-instance attribute.

**Files.** `src/render/city/buildings/BuildingRenderer.ts` or `src/render/world/overlays.ts`. It reads `overlayReadout`, which is replica-safe.

**Acceptance**
- A roadless Obelisk shows red on its model in the Emergency · Fire view at 300 m and 700 m.
- Buildings with road access are unchanged.
- No amber ring anywhere (A/B screenshots).

**Depends on.** Render round 2; Worker R2 if it takes the `BuildingRenderer` path (D13).

**Risk.** Render only. No free instance-flag bit is left after FEEL-18, hence the uniform or attribute path.

#### LG-25 · Late-game crises that need the mayor even with full coverage
P3 · M · SIM (META adds banners) · round 4

**Problem.** In a big, well-covered city the emergency system goes silent.
- **Nearly everything is answered automatically**: 97–100% from 2016 on both seeds (acceptance r3).
- **At 1.29M people a year brings** "723 auto-dispatched, 7 manual, 3 failed per year; they only show as statistics" (factors summary).

**Change.**
- **From 250k residents, 2–4 major crises a year.** Each needs a decision, not just a unit:

  | crisis | what it needs | the choice |
  |---|---|---|
  | high-rise fire | a Fire HQ ladder within 6 min, or the fire spreads | Evacuate the block, or Fight from outside |
  | refinery spill | hazmat | a 10-tile evacuation, or shelter in place |
  | stadium crowd emergency | 3× the ambulances | — |
  | heat wave | power +25% for a month | buy power from a neighbour (LG-11), or rolling blackouts by district |
- **Kind `crisis`**, outside the auto-dispatch and failed-incident gates.
- **Crises get their own saved RNG stream.** The emergency system draws everything from one saved stream (`emergency.ts:724`, seeded and restored at `:875-877`, saved at `:925`), so even rolls drawn at the end of the monthly step would shift every later draw.
- **Crises are off for the bot.** Gate runs turn disasters off (`simbot.ts:224`) but not emergencies, and crises would start at 250k (bot 2019). So crises are gated on `config.disasters`, or on a new `config.crises` flag that defaults on for players and off in `simbot.ts`.

**Files.** `src/sim/infra/emergency.ts` (the crisis stream and roll); `src/sim/config.ts` (`crises`); `tools/simbot.ts` (`crises: false`); `src/sim/infra/utilities.ts` (heat wave); `src/ui/EmergencyBanner.ts` (META in round 4: decision buttons); `src/ui/panels/EmergenciesPanel.ts` (META: crisis row).

**Acceptance**
- On a 300k save, a forced high-rise fire shows a banner with two choices, each with its stated outcome.
- Crises are counted in their own Statistics row.
- G-DET is bit-identical on 256×60 s7: the bot never rolls a crisis, and the emergency stream is untouched.
- The auto-dispatch (≥ 85%) and failed (≤ 5%) gates, computed on the existing kinds, are unchanged.

**Depends on.** PB-ACCIDENT, PB-AMBER, PB-COOLDOWN; LG-10.

**Risk.** Keep crises out of the gate counters. Draws stay deterministic: the crisis stream is seeded from the city seed and saved like the emergency stream.

### E. Difficulty, balance and bots

#### FH-04 · Easy becomes a real first-city mode; Medium and Hard stay bit-identical
P1 · M · SIM · round 1

**Problem**
- **Difficulty only changes money**: start funds §250k / §100k / §40k (`config.ts:32-37`) and tax income ×1.2 / 1.0 / 0.85 (`DIFFICULTY_INCOME` `tuning.ts:559`, read at `budget.ts:131`).
- **The veteran reviewer's bot runs show what that buys** (`veteran/{easy,base}_128x15_s7.json`). Approval by year:

  | year | 2001 | 2002 | 2003 | 2004 | 2005 | 2006 |
  |---|---|---|---|---|---|---|
  | Easy | 53.5 | 61.3 | 63.5 | 64.5 | 60.3 | 58.8 |
  | Medium | 53.1 | 51.3 | 52.4 | 47.7 | 47.4 | 51.6 |

- **Year 1 does not move**, because crime, the biggest early term, is not faded in by town size (`approval.ts:276`). Outages, HQ, garbage, needs and remembered emergencies are faded in (`approval.ts:288-307`).
- **A human newcomer had Crime −12.4 at 124 residents** (`newplayer/073`).
- **Disasters default on** (`config.ts:53`).

**Change.** Add a `DIFFICULTY_RULES` table in `tuning.ts`.
- **Medium and Hard rows equal today's constants**, read through the same code path.
- **Easy adds three rules:**
  - the crime approval term is multiplied by `smoothstep(needsPop0, needsPop1)`, so it fades in from 2k to 8k residents like outages;
  - the monthly emergency term (failed, late, deaths) gets the same fade as the remembered term;
  - `defaultDisasters: false`.
- **Each row carries `blurb` strings**, which the New City dialog shows (FH-11).
- **The approval hover reads "Crime −3 (new-town grace)" on Easy**, so nothing is hidden (GUIDE's `approvalDetail` reads the rule).

**Files.** `src/sim/economy/tuning.ts`; `src/sim/economy/approval.ts` (SIM hunk: `update()`); `src/sim/config.ts`; `src/sim/economy/budget.ts`.

**Acceptance**
- Medium and Hard bot runs (256×60 s7 and s11, 128×15 s7) give bit-identical yearly state hashes before and after (the audit's two-process method), and every gate is unchanged.
- The Easy 128×15 s7 bot has approval ≥ 55 in every year 2001–06 (today 53.5 in 2001).
- The FH-10 newcomer on Easy has approval ≥ 50 from year 2, and at least twice the Medium newcomer's population in year 6.

**Depends on.** FH-10; PB-GRACE (stacks with the early fire grace).

**Risk.**
- Easy grows rich later: §925k by 2015 vs §176k on Medium (`veteran/`). That is acceptable for this mode; record it.
- Old Medium and Hard saves keep their behaviour, because their rows equal today's constants. Old Easy saves change: the rules key on `config.difficulty`, which is saved with the city, so an Easy city loaded after this item gets the crime fade and the emergency fade at once. That is intended (Easy becomes kinder) and goes in the release notes. `defaultDisasters` applies to new cities only, because `config.disasters` is saved.

#### FH-10 · A "newcomer" bot profile to measure the first hour
P2 (unblocks FH-03, FH-04) · M · SIM · round 1

**Problem**
- **Every balance number comes from a perfect-knowledge bot.** It:
  - starts with 3 wind turbines (`simbot.ts:861-873`);
  - builds police at 2,000 people (LD7);
  - borrows when funds drop under §25k (`simbot.ts:828-831`);
  - sets taxes automatically (`simbot.ts:846-857`).
- **The human new player had 863 residents and 43% approval in Feb 2006** (`newplayer/146`), against the bot's 46,762 and 53.8.

**Change.** Add `tools/simbot.ts --profile newcomer`. It plays like the humans did:
- a coal plant on day 0 next to the first zones, and a pump beside industry;
- small zone blocks, expanding only when the zone-more cue (FH-03) fires;
- police only after a crime warning;
- no loans;
- taxes at 9% until a deficit, then 11%;
- no dispatch for the first incident.

It founds on day 90 like a player's city (FEEL-05), so its years count from founding ("How to read this plan"). It prints years 1–10: population, approval with its top three terms, funds and failed incidents. Document it in the file header and in `--help` (routed 46). The default bot keeps day 0.

**Files.** `tools/simbot.ts`.

**Acceptance**
- Without FH-03, Medium 128×10 s7 reproduces the human shape: fewer than 5,000 residents and approval under 48 in year 4.
- It runs headless in under 2 minutes.
- The default bot is unchanged (hash).

**Depends on.** PB-BOTFALLBACK (the triage's `simbot.ts` edit lands first).

**Risk.** Tools only.

#### LG-10 · Bot strategies for the long-game systems, so the gates can measure them
P2 (unblocks the long game) · M · SIM · round 1, then one rule per item

**Problem.** Content the bot never builds escapes balance testing.
- **No bot city built a zoo in 60 years**, which hid that a player's zoo pushes the tourism-jobs ratio to 1.41 (acceptance r3 advice 1; LD15b).
- **The bot never builds a train or subway station** (routed 4).
- **It enacts at most 8 of 22 ordinances.**
- **It keeps taxes no lower than 7%** (`simbot.ts:851`).

**Change.** Rule flags, each off by default so today's rows reproduce:
- `--megaprojects`, `--arcology`, `--subway` (from 150k, a line from the core to the 3 densest residential districts, with a station every 8 tiles), `--late-ordinances`, `--expand`, `--charter=X`.
- The `--skip` and `--neglect` variants keep working.
- `--help` is shared with FH-10.
- New rows go under a `polish` key in `tests/sim/fixtures/balance-baseline.json`. The `phase0`, `preSpec` and `partB` rows stay untouched.
- Each rule lands with the item it measures.

**Files.** `tools/simbot.ts`; `tests/sim/balance.test.ts`; `tests/sim/fixtures/balance-baseline.json`; new tests next to `tests/sim/botVenues.test.ts`.

**Acceptance**
- With every flag off, the bot reproduces today's 256×60 s7/s11 and 128×15 rows exactly.
- With the flags on, every gate in acceptance r3's GATE SUMMARY passes.
- The plan's targets are reported: bank months in 2045, unemployment in 2060, skip-transit at 2040, skip-dirty at year 15, neglect at year 60.

**Depends on.** Part-B final fixes and the Worker (rebase only; the headless bot path does not change).

**Risk.**
- New rules move gate runs by design. Record them under the separate fixture key and get the lead's sign-off, as for LD11 and LD14a.
- Gate runs are long (BALANCE=1 took 251 s, and 60-year runs take minutes each), so run them one at a time on the shared box (§7).

#### NEW-05 · Taxes that cost growth gradually (only if part-B triage does not take PB-TAXRESPONSE)
P1 · M · SIM · round 2 (conditional)

**Problem.** A hard growth throughput cap makes the tax response flat, then a cliff (veteran #1, major).
- **128×15 s7 at year 15, with taxes fixed**: the bot's 9–11% gives 194,627 people; 12% gives 183,871 (−5.5%) with §1.35M banked, 7.6× the base; 13% gives 170,325 (−12.5%); 14% gives 58,766 (−70%); 15% gives 26,645 (−86%).
- **256 from year 21 at 12%**: −0.3% population in 2030, and $12.0M in the bank instead of $3.57M.
- **The mechanism.** At 310k, residential growth wanted is 4,251 capacity a day against the cap's 72, 59× over (`growth.ts` `computeAllowance`). At 12% it is still 8.9× over, so realized growth does not change. At 14% residential demand turns negative at once.
- **Why it is P1 for the long game.** It defeats Goal 6, LG-03's sinks (a free 12% tax pays for any project), LG-16's council gates (approval stays about 70) and FH-09's honest copy. It also hides the region's effect (veteran #10).

**Change**
- **Realized growth follows demand below the cap.** Each family's throughput is scaled by its tax-adjusted demand, for example by `min(1, demand / 0.5)` or `smoothstep(0, k, wanted / cap)` (the veteran's two suggestions), instead of only clipping wanted growth above the cap. If the 13 → 14% cliff remains, steepen `taxFactor` in the 9–13% band.
- **LG-10 adds `--tax=N`** (fixed taxes), so the sweep is reproducible.
- **Base rows move by design**, because the bot runs 9–11% and pays a little growth too. They go under `polish` with the lead's sign-off (D2).

**Files.** `src/sim/economy/growth.ts` (`computeAllowance`); `src/sim/economy/tuning.ts` (`GROWTH_RESPONSE`, `GROWTH_MAX_*`, `TAX_SENS`, `TAX_FACTOR_MIN`); `src/sim/economy/demand.ts` (`taxFactor`); `tools/simbot.ts` (`--tax`).

**Acceptance**
- 128×15 s7 with taxes fixed at 10, 11, 12, 13 and 14%: population at year 15 falls monotonically with the rate. Each one-point step above 10% costs at least 3% and at most 15% of the population.
- 256×30 s7 with 12% from year 21: population in 2030 at least 3% below base (today −0.3%).
- Every gate passes on the base runs, recorded under `polish`.

**Depends on.** Part-B triage's call on veteran #1: if triage fixes it as PB-TAXRESPONSE, this item is dropped. LG-10.

**Risk.** It moves every base row, so it lands early in round 2, before the items that measure money (LG-03, LG-16) record their own rows.

#### LG-09 · Hard and Expert that change the rules, not just the money
P2 · M · SIM (META adds the dialog lines) · round 2

**Problem**
- **Hard is barely harder.** It ends year 15 with 180,531 vs 194,627 people (−7%) and approval 77.1 vs 78.7 (`veteran/hard_128x15_s7`).
- **The dialog describes each level only by its money** (`shots2/008`), so a veteran has no harder game to choose.

**Change.** New `DIFFICULTY_RULES` rows:
- **Hard**:
  - service running costs ×1.15 (`OPEX_PER_SERVED`);
  - tax approval penalty −4.5 per point (today −3.5);
  - disasters ×1.5;
  - after 12 months bankrupt, "The council has removed you", with Continue in sandbox or "Restore", which loads the newest save from before the bankrupt streak (NEW-03). A plain reload would load an autosave already inside the streak.
- **Expert** (new): Hard, plus no loans after year 5, disasters ×3 and manual-dispatch windows ×0.75. It earns an Expert badge on the region card.
- **The dialog** gives each card two rule lines (META).
- **Easy** keeps FH-04's rules. The LG draft's extra Easy rules (disasters ×0.5, windows ×1.25, loans −1%) are added only if the newcomer bot still misses its targets (D3).

**Files.** `src/core/types.ts` (`Difficulty` adds `expert`); `src/sim/economy/tuning.ts`, `budget.ts` (bankruptcy end), `opex.ts`, `approval.ts`, `loans.ts`; `src/sim/infra/disasters.ts`, `emergency.ts` (window multiplier); `src/region/NewCityDialog.ts`, `src/region/RegionScreen.ts`, `src/ui/TopBar.ts` difficulty label (META).

**Acceptance**
- Medium bit-identical hashes.
- Hard 128×15 s7 stays harder after year 10 (veteran #9: today all levels converge, Hard ending year 15 at 0.93× Medium's population and 0.70× its funds): in every year 2010–15, funds at most 0.5× Medium or population at most 0.9× Medium. An approval gap alone does not count, because approval barely moves growth (veteran #2). The lowest daily balance stays at or above 0 using loans, so Hard stays winnable.
- Expert: a unit test with a forced 12-month deficit shows the removal screen.

**Depends on.** FH-04; PB-ACCIDENT (window multiplier); LG-10; NEW-03 (Restore).

**Risk.**
- `expert` is a new enum value, so guard the UI labels.
- The disaster multiplier scales the thresholds of the same single monthly draw.

#### LG-06 · Neglect that costs growth: a safety record, rebuild costs and scars
P2 · M · SIM (META adds the panel row and banner text) · round 2

**Problem**
- **Neglect costs approval and nothing else.** The 256×60 s7 `--neglect` run ends at approval 76.7 vs 80.2, but population is +0.4% and funds are $21.9M vs $17.7M. That is with 195 vs 71 buildings burned and 1,569 vs 1,408 deaths (acceptance r3 WRONG CHOICES; LD14d routed this here).
- **Nothing outside approval notices the burnt blocks.**
  - The attractiveness "safety" score reads crime only (`tourism.ts:601`).
  - Emergency damage is just a statistic (`emergency.ts:2374`), shown as "Damage §0" (`shots2/050`) and never charged.
  - Approval barely moves growth (`APPROVAL_R` 0.06).

**Change**
- **A safety record.** Safety = clamp(1 − 1.6·crime − EM_REP·failed12/(incidents12 + 30) − 0.002·deaths12 per 1,000 residents, 0, 1). It uses the same 12-month window as the approval term and feeds migration (±12%) and tourism.
- **Rebuild costs.** 15% of each month's emergency damage is charged on a "Rebuilding after emergencies" line. The banner's "1 building lost" adds "−§8,400 rebuild" (META, round 3).
- **Scars.** A building that burns down after an unanswered call leaves stigma 0.15 within 3 tiles for 18 months, as a timed NIMBY splat shown in the Prestige view.
- **A cost row.** The Emergencies panel's Statistics gains "Cost of unanswered emergencies this year: §X rebuild, Y fewer newcomers".

**Files.** `src/sim/economy/tourism.ts` (SIM hunk); `tuning.ts` (`ATTRACT_SCALES`, `REBUILD_SHARE`); `src/sim/infra/emergency.ts`; `src/sim/infra/nimby.ts`; `budget.ts`; `src/ui/panels/EmergenciesPanel.ts` (META).

**Acceptance**
- 256×60 s7/s11 with `--neglect`:
  - population at year 60 at least 2% below base (today +0.4% and +1.6%);
  - funds at year 60 no higher than base (today +24%);
  - the approval cost unchanged or larger.
- Base runs: population within ±0.5% of the §8.0 baseline rows; tourism 0.7–1.3 from year 15; failed ≤ 5% from year 10.

**Depends on.** PB-ACCIDENT, PB-AMBER, PB-COOLDOWN, so players are never charged for prompts they never saw; LG-10.

**Risk.**
- The base city lost only 71 buildings in 60 years, so its scars are tiny.
- No new RNG draws.
- The scar list is a new optional `systemData` key.

#### LG-07 · Clean industry a real strategy, dirty industry a real cost
P2 · M · SIM (GUIDE adds two UI lines) · round 2

**Problem**
- **Skipping smokestack industry costs too much for too little.**
  - 128×15 year 15: 118,674 vs 194,627 people (−39%) for 4% cleaner air that year, 0.0832 vs 0.0866 (acceptance r3).
  - 256×60: −27% mid-run and −5% at year 60, for +1.2 approval (balance r3).
- **Refused dirty demand simply vanishes.**
  - The dirty share is 0.70 − (EQ−50)/180, and high-tech is capped at (EQ−70)/200 (`demand.ts:248-250`; `tuning.ts:124-130`).
  - The Clean Air Act deletes a quarter of dirty demand (`'demand.ID': 0.75`, `ordinances.ts:96`) instead of moving it.

**Change**
- **Retooling.** Dirty demand the city cannot place moves to clean industry over a 12-month ramp. That covers no IndMed room, the Clean Air Act and Industrial Pollution Controls.
  - 50% goes to I-M, and 25% to I-HT once EQ is above 70.
  - The RCI popover says so: "Retooled from refused factories: +4,200 I-M jobs" (GUIDE).
- **Long-run dirty costs.**
  - I-D desirability falls 0.03 per 10 EQ above 90 ("educated workers avoid smokestacks").
  - Soil contamination under old I-D lots lowers R and CO$$$ desirability until it is cleaned, which gives Brownfield Cleanup a purpose.
- **A Stats line.** The industry section gets "Industrial strategy": dirty share of jobs, air at homes, retooled jobs (GUIDE).

**Files.** `src/sim/economy/demand.ts`, `tuning.ts` (`RETOOL_*`), `ordinances.ts` (texts), `desirability.ts`; `src/ui/TopBar.ts` and `src/ui/panels/StatsPanel.ts` (GUIDE).

**Acceptance**
- 128×15 s7 `--skip dirty`: population at year 15 at least 0.8× base (today 0.61×), with mean air over the run at least 15% cleaner than base (today 20%).
- 256×60 s7 `--skip dirty`: within 3% of base at year 60, keeping the +1 approval.
- Base runs within ±1% of the §8.0 baseline. The EQ gate and |unemp − (1 − accW)| ≤ 0.02 hold.
- High-tech pays (veteran #3: 0 I-HT jobs at 1M with EQ 130; the bot only zones IndHigh above demand 0.35): on 256×60 s7, high-tech is at least 25% of industrial jobs wherever the city's EQ is 110 or more, by 2040 at the latest.
- The `balance.test.ts` check "no smokestack industry: air" (run mean, LD15a) still passes.

**Depends on.** PB-REGION and PB-PARKING (so the industry baseline is final); part-B triage's call on veteran #3 (the high-tech share formula, `demand.ts:249`); LG-10.

**Risk.** The population gate moves up (allowed by LD3). Watch unemployment consistency. The ramp is deterministic.

#### LG-08 · Transit-oriented development: towers grow around stations
P2 · M · SIM (GUIDE adds the Stats line) · round 2

**Problem**
- **Transit pays off only late.** Without it the bot loses 0.7% of its people by 2040 and 7.2% by 2060, and its commute is even shorter without transit (9.34 vs 9.58 min; acceptance r3).
- **The bot never builds a train or subway station** (routed 4).
- **Stations don't shape the skyline.** Towers (stage 6 and up) grow only on "tower lots" chosen by distance to the commercial core (`growth.ts:122-142`).

**Change**
- **Stations create tower lots.** Lots within 6 tiles of a connected train or subway station, or 8 tiles of Grand Central (LG-02), count as tower lots.
- **They are also more desirable**: +0.04 for R$$, CO$$ and CO$$$, shown as a "Near a station" term in Why?.
- **The inspector's downtown note** adds: "Stage 5 max: not a tower site — a subway or train station within 6 tiles allows towers here".
- **The Transit stats card** adds "Riders save N minutes compared with driving" (GUIDE, after PB-COMMUTE).
- **Long commutes cost approval.** The commute term starts at 15 minutes instead of 30 (`APPROVAL.commute`, `tuning.ts:662`). Today it never fires in any run, and a 1M city without transit keeps the same 10.4-minute commute (veteran #4).

**Files.** `src/sim/economy/growth.ts`, `desirability.ts`; `src/sim/infra/transit.ts` or `transportFacilities.ts` (station list per graph version); `src/ui/panels/StatsPanel.ts` (GUIDE).

**Acceptance.** 256×60 s7 with LG-10's `--subway`:
- `--skip transit` costs at least 4% of the people at 2040 and at least 10% at 2060;
- base population at year 60 stays at or above 0.99× the §8.0 base (today's row is 1.547M);
- ms/day rises by at most 3 (LD2);
- the average stage within 6 tiles of a station is at least 1.5× the city average;
- in the `--skip transit` run the commute approval term is non-zero from 2030.

**Depends on.** PB-COMMUTE; LG-10.

**Risk.**
- More towers near stations means more same-model towers (NEW-01).
- The tower-lot rule is a pure function of the stations, cached per graph version.

#### LG-16 · Approval as political capital
P2 · M · SIM (GUIDE and META add UI) · round 3

**Problem**
- **Late approval buys nothing.** It moves the residential target by at most 6% (`APPROVAL_R` 0.06). Only the Statue asks for it (65%, `rewards.ts:77`). Losing 8–12 points costs 0–3% of the population (veteran #2).
- **The gates below would not bite today.** A flat 12% tax leaves approval at about 70 (71.8 at 128×15, 70.2 at 256 in 2030; veteran #1), above both the 55% and 65% gates, while it banks 3.4× the money. Until taxes cost growth (PB-TAXRESPONSE or NEW-05), council support never stops a rich, taxing mayor.
- **The bot coasts at 80–84 from 2030**, carried by +7 civic, +4 tourism (capped) and +3 low taxes (`G_256x60_s7` `approvalTerms`).
- **The human city spent years at 40–53% with no consequence** (`shots2/058` 40%, `121` 50%).

**Change**
- **Council support.**
  - Mega-projects and loans over §500k need approval of at least 55%. The Arcology, Fusion and the World Expo need 65%.
  - The tool tooltip and the Loans tab show the requirement: "Council support: 62% (55% needed)".
- **Loan rates.** −1% at 70% or more, +2% at 40% or less.
- **Recall petition.**
  - After 12 straight months below 35%, a 3-month petition banner appears. Getting back to 45% ends it.
  - Otherwise, on Medium the council forces taxes down 2 points and freezes ordinance changes for 6 months. On Hard and Expert the term ends (LG-09), and "Restore" offers the newest save from before the 12 months below 35% (NEW-03).

**Files.** `src/sim/economy/projects.ts` (gate), `loans.ts`, `approval.ts` (petition state); `src/sim/economy/advisors.ts` (GUIDE hunk: petition warnings); `src/ui/panels/BudgetPanel.ts` (GUIDE: requirement line); `src/game/toolCatalog.ts` (CONTENT: lock reason); `src/ui/Notifications.ts` (META: petition banner).

**Acceptance**
- A test city held at approval 30% (taxes at 20%) gets the petition at month 12 and, on Medium, the forced cut at month 15.
- At 52% approval the Arcology button reads "Needs council support (approval 52 of 65)".
- Bot gates are unchanged: the formula is untouched, and the bot's approval stays within 1 point of the §8.0 base from 2029 (today 79 or more).

**Depends on.** LG-03, LG-09; PB-TAXRESPONSE or NEW-05; NEW-03 (Restore).

**Risk.**
- The forced tax cut is driven by a month counter, so it stays deterministic.
- Petition state is a new `systemData` key.

#### LG-15 · Disasters with stakes: frequency, rebuild cost, a recovery goal
P2 · M · SIM (META adds the dialog and settings rows; CONTENT builds the model) · round 3

**Problem**
- **Fixed odds above 2,000 people.** Tornado 0.8%, quake 0.4% and meteor 0.25% a month, about 16% a year (`disasters.ts:64-70`). The player only gets an on/off switch (`shots2/008`).
- **Consequences are brief.** The approval cost lasts one month (`AT.disaster` −5, `tuning.ts:723`), and the damage is never charged (`emergency.ts:2374`).
- **The city heals itself.** A six-month blackout took 71,236 people down to 25,164; four months after the power returned the city was back at 72,734, and approval never fell below 56.2 (`veteran/crisis_128x12_s7.log`).

**Change**
- **A frequency setting.** Off / Rare ×0.5 / Normal / Frequent ×2 / Chaotic ×4, in the New City dialog and Settings → Gameplay. It scales the thresholds of the same monthly draw.
- **Rebuild costs.** The same damage charge as LG-06.
- **A recovery card** after a tornado, quake or meteor: "rebuild 80% of the 34 lost buildings and restore power within 12 months". Success earns "Resilient city" (+2 approval for a year); failure gives "Slow recovery" (−2 for a year).
- **A preparedness building.** The Emergency Operations Center unlocks at 50k and costs §15k. It cuts disaster damage and aftermath incidents by 30% within 40 tiles.

**Files.** `src/sim/infra/disasters.ts`; `src/sim/config.ts` (`disasterRate`); `src/sim/economy/approval.ts`; `src/sim/catalog.ts` and the model (CONTENT); `src/region/NewCityDialog.ts` and `src/ui/panels/SettingsPanel.ts` (META).

**Acceptance**
- With Frequent, a 60-year 128 bot run has about 2× the disasters of Normal.
- After a scripted meteor on a 100k city, the Recovery card appears, tracks rebuilt buildings and resolves at month 12.
- The EOC cuts aftermath incidents by at least 25% (scripted A/B).
- Gate runs, which have disasters off (`simbot.ts:224`), are unchanged.

**Depends on.** PB-SAVELOAD (routed 45: the disaster RNG and active disasters are saved); LG-06.

**Risk.** No gate moves. Recovery state is a new `systemData` key.

### F. Goals and endgame content

#### LG-01 · City ranks and a visible next milestone from 0 to 1.5M
P1 · M · CONTENT (META adds the region card) · round 1

**Problem**
- **Nothing unlocks after the Twin Spires at 500k** (`rewards.ts:102-104`), which the bot reaches in 2029. The next 27 game years to 1.5M (2056) bring no new reward: 32 minutes of pure 2× time, 81 minutes at 1× (`SECONDS_PER_DAY`, `src/core/constants.ts:34`).
- **Building stages stop at 220k** (`tuning.ts:243-249`), and **population news at 1M** (`advisors.ts:107`).
- **No goal is ever on screen.**
  - The population segment only opens City statistics (`TopBar.ts:173`; `shots2/hd_01`).
  - Rewards is one flat list, sorted unlocked-first (`ListPanels.ts:188`; `shots2/111`).
  - The New Year toast states population and growth only (`shots2/047`).

**Change**
- **Ranks.** A `CITY_RANKS` table in `rewards.ts`: Settlement 0, Village 1k, Town 5k, Small City 10k, City 25k, Large City 50k, Metropolis 100k, Major Metropolis 250k, Global City 500k, World City 750k, Megacity 1M, Megalopolis 1.5M.
- **`listMilestones(st)`** returns the current rank, the next rank and the next three unlocks, ordered by progress. It reads only stats, `unlocked` and `milestones`, so it joins the Worker's replica-safe list.
- **HUD.** The population segment gets a second line, "Town · next: Small City at 10,000 (72%)". Its tooltip lists the next three unlocks with progress bars, and a click still opens Stats.
- **Rewards panel tabs**: Milestones (the ladder, current rank highlighted), Rewards (today's list) and Honours (LG-20).
- **The rank also shows on the region city card** and on the floating city label, e.g. "Global City · 512k" (META: `citySummary`, `RegionScreen`).
- **Rank-up moments** (card, sound, fireworks) are FEEL-06.

**Files.** `src/sim/economy/rewards.ts`; the population segment of the TopBar (its own component after the round-1 split, §7.4); `src/ui/panels/ListPanels.ts`; `src/region/citySummary.ts` and `RegionScreen.ts` (META); `src/worker/replicaSafe.ts` (SIM adds the entry).

**Acceptance**
- In a 256×60 s7 replay sampled monthly to 1.5M, the HUD's "next" line is never empty.
- The Milestones tab lists 12 ranks with the current one highlighted.
- `listMilestones` passes `replicaSafe.test`.
- Once LG-02, LG-03 and LG-04 land, no gap between unlocks or rank-ups from 2010 to 2056 is longer than 5 years (today 27).

**Depends on.** None for `CITY_RANKS`, `listMilestones` and their tests, which can start now (no in-flight phase edits `rewards.ts`). The HUD line waits for the TopBar split (§7.4), the replica-safe entry for the Worker's `replicaSafe.ts`. The content that fills the late gaps comes from LG-02, LG-03, LG-04 and LG-20.

**Risk.**
- No sim formula changes.
- Rank flags are a new optional `systemData` key. On load, old saves record the ranks they have already passed silently, the way `rewardsSystem` does with `check(sim, true)`.

#### FEEL-06 · Milestone moments: a card, a sound for every milestone, stage news, "Place it"
P2 · M · CONTENT · round 2

**Problem**
- **Reaching 10,000 residents is a standard "Good news" toast** (`advisors.ts:1337`).
- **Only 7 of 12 milestones get the `milestone` sound** (`GameSounds.ts:41` vs `advisors.ts:107`). 500, 2.5k, 5k, 25k and 750k get the rate-limited generic chime.
- **Stage unlocks post no news at all**: 3k, 12k, 35k (the first towers), 90k (skyscrapers) and 220k (supertalls) (`tuning.ts:243-250`).
- **Reward toasts can't be clicked.** They carry no map cell, so clicking does nothing (`rewards.ts:177`; `Notifications.ts:190-193`).

**Change**
- **A milestone card.** A lower-third card for 4 s ("QUEENSBURY · 10,000 RESIDENTS"), with one "next" line from `STAGE_POP` or `listMilestones`.
- **A sound for every milestone.** `milestone` plays for all milestones, with 1.25M and 1.5M added to both lists.
- **Fireworks for rank-ups.** A 6–10 s daytime burst (`Fireworks.start`, intensity by tier), skipped during New Year or LIVE.
- **Stage-unlock news**, once each. It is stored like `popMilestone` and initialised from the current population on load, so old saves post nothing.
- **"Place it".** Reward and landmark toasts get this action, which opens Rewards scrolled to the item. The reward news posts with `ref: {reward: id}` (§7.4), and META wires the action in the Toasts handler by `ref`, never by text.

**Files.** `src/sim/economy/advisors.ts` (CONTENT hunk: milestones and stage news); `src/sim/economy/rewards.ts` (the `ref` on reward news); `src/game/GameSounds.ts` (CONTENT hunk: milestone case, `POP_MILESTONES`); new `src/ui/MilestoneCard.ts`; `src/game/CityScene.ts` (CONTENT wiring block); `src/ui/Notifications.ts` (META: the action). The rank-up burst calls `Fireworks.start` with an intensity option; if that needs a change in `Fireworks.ts`, it waits for Worker R2, which rewrites `collectLaunchSites` in the same file (D13).

**Acceptance**
- Crossing 10,000 at 1× shows the card for 4 ± 0.5 s, plays `milestone` once and launches fireworks for at most 10 s.
- Crossing 35,000 posts exactly one tower-unlock item.
- A 256×60 s7 bot run posts all five unlock items once each, and none repeats after save/load.
- Loading a 300k save posts nothing.
- Clicking a reward toast opens Rewards with that row highlighted.
- At ultra, at most 1 card per 30 s.

**Depends on.** FEEL-02a, LG-01; the `NewsItem.ref` interface (§7.4); Worker R2 for any `Fireworks.ts` change.

**Risk.** Stage news reads only the population and makes no RNG draw. It lands in news and `systemData.advisors`, so the determinism check uses FH-03's rule.

#### LG-21 · Year in review and a mayor's grade (absorbs FEEL-26)
P2 · M · CONTENT · round 2

**Problem**
- **The yearly moment is one toast**: "Queensbury celebrates with 6,823 residents · ▲ 125% vs 2001." (`shots2/047`; `NewYear.ts:660-673`). It is the same in year 5 and year 50.
- **The game keeps monthly history** (`HISTORY_KEYS`, `CityState.ts:176-181`) but never says what changed, which records fell or how the city compares.
- **After 2050 there is no yearly feedback at all**, with approval flat at 80–82 and growth under 2%.

**Change**
- **When it appears.** After the New Year show or burst (it waits for `NewYearCelebration.busy` to clear) or on 1 January when the show is off. At 1× every year; at 2× every second year (a 15 s card every 72 s year would be another 21% of real time on top of New Year); at ultra every 5th year (FEEL-02a).
- **The card**, "Queensbury Gazette — 2006", is dismissible and shows:
  - population and growth;
  - the bank in months of expenses;
  - the approval change and its three biggest term changes (`approvalBreakdown`);
  - emergencies answered, failed and lost; tourists; EQ and HQ;
  - records broken this year;
  - goals completed this year and the next three (LG-01);
  - a mayor's grade from A to F with a sparkline of past grades (scoring below);
  - a region line.
- **The grade.** Each stat scores 0–100, linear between the anchors and clamped; the grade is the weighted sum:

  | stat (weight) | 0 points | 100 points |
  |---|---|---|
  | growth (25%) | population −5% over the year | +8% (a built-out city, LG-05, scores unemployment instead: 12% → 0, 4% → 100) |
  | approval (20%) | year mean 30 | year mean 80 |
  | finances (15%) | funds below 0 at year end (score 0) | 3 months of expenses banked; 30 points at 0 months; −15 if the year's recurring net was negative |
  | safety (15%) | 10% of the year's emergencies failed | none failed; times (1 − 0.5 × mean crime at homes) |
  | environment (15%) | air at homes 0.30, or 20% of homes Noisy (mean of the two) | air 0.05, no Noisy homes |
  | services (10%) | mean coverage at homes 0.3 (education, health, police, fire, parks) | 0.9 |

  Cutoffs: A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40, F below 40.
- **Closing.** It closes after 15 s or on any map input, never shows during LIVE, and can be switched off in Settings.

**Files.** New `src/ui/YearReview.ts` (computed UI-side from the history arrays); `src/game/CityScene.ts` (CONTENT wiring block). `NewYear.ts` is not edited.

**Acceptance**
- On a 20-year save the card appears once per New Year at 1× and every second New Year at 2×, and never on load.
- Its population change is within 0.5% of the Graphs panel.
- It names the same approval term as the approval tooltip.
- It is skipped during LIVE.
- Unit tests: each stat's score hits its anchors exactly (approval 55 → 50 points), and the cutoffs map 84.9 to B and 85 to A.
- A fixture with funds below 0, approval 30 and 20% of emergencies failed grades F. The 256×60 s7 base run grades C or better every year from 2010.
- The grade is deterministic for a given save.
- The toggle hides it.

**Depends on.** LG-01, FEEL-02a, PB-NEWYEAR.

**Risk.** Noise, held by the speed and frequency gates.

#### LG-03 · Mega-projects: multi-year builds that make money matter after 2030
P2 · L · SIM, with CONTENT and GUIDE parts · round 2 (framework and Express Metro), round 3 (Fusion, Expo, Space Center)

**Problem**
- **From about 2030 money is no longer a decision.** The bot banks:

  | year | funds | months of expenses |
  |---|---|---|
  | 2030 | $3.57M | 12.7 |
  | 2045 | $9.38M | 19.0 |
  | 2060 | $17.7M | 26.3 |

  It has kept taxes at its 7% floor since 2035 (`G_256x60_s7`; `simbot.ts:851`).
- **There is nothing big to buy.** The most expensive purchase is the Twin Spires at §200k (`catalog.ts:441`).
- **Money levers bite only at the cliff.** A flat 15% tax holds a 128 city at 24.7k people for 2009–14 (`veteran/tax15_128x15_s7.log`), but up to 13% taxes are nearly free (veteran #1). At 128×15, 12% gives 183,871 people (−5.5%) and §1.35M in the bank, 7.6× the base (`veteran/tax12_128x15_s7.log`). From year 21 at 256, 12% costs 0.3% of the people and banks $12.0M instead of $3.57M by 2030. A sink only matters once raising taxes to fill it costs something, so this item depends on PB-TAXRESPONSE or NEW-05.

**Change**
- **Framework.**
  - **Placing.** Mega-projects are a new toolbar category (a "Mega-projects" tab in the Rewards flyout). Placing one starts a construction site; the renderer already draws `built < 1` with a crane (`BuildingRenderer.ts:1503-1537`).
  - **Paying.** The price is paid in monthly installments on a "Mega-projects (installments)" line. If funds can't cover an installment the project pauses ("Paused: needs §X this month") instead of going negative. Cancel refunds 50% of what was paid.
  - **Showing progress.** The inspector shows "Month 7 of 24 · §1.17M of §4.0M paid · opens Mar 2038". Running costs start when it opens. Budget shows "Bank: N months of expenses" and the remaining installments.
  - **Worker.** New commands `startProject` and `cancelProject`.
- **Projects**:

  | project | unlocks at | cost | effect |
  |---|---|---|---|
  | Express Metro | 300k and 6 subway stations | §1.5M over 18 months | `SUBWAY_TIME` ×0.7; `WAIT_SUBWAY` 3.5 → 2.5 min; `STOP_CAP_SUBWAY` ×1.5 (`params.ts:38, 60, 64`) |
  | Fusion Power Plant | 750k and EQ 120 | §4.0M over 30 months | 4,000 MW, no smoke, 600 jobs, §40k/mo upkeep |
  | World Expo (once per city) | 800k and attractiveness 70 | §3.0M over 24 months | then a 12-month expo: draw ×1.5 citywide and +3 approval; leaves the Expo Tower |
  | Space Center | 1.15M and EQ 125 | §6.0M over 36 months | 8,000 jobs, I-HT cap +60k, campus 1.0 within 30 tiles |
- **Parts by lane.**
  - **SIM**: new `src/sim/economy/projects.ts` (installments, progress counted in days, pause and cancel, `systemData.projects`); the `plop()` project branch in `actions.ts`; the budget line; the `params`/`traffic` multipliers; the expo multiplier in `tourism.ts`; the Worker rows; LG-10 `--megaprojects`.
  - **CONTENT**: the defs (`buildMonths` goes into `catalogTypes.ts`, done by SIM); the toolbar category; the fusion, expo and space-center models.
  - **GUIDE**: the inspector progress line and the Budget "bank months" line.

**Acceptance.** 256×60 s7 with `--megaprojects` (save up once 12 months of expenses are banked):
- at least 3 projects complete between 2030 and 2060;
- funds in 2045 are at most 12 months of expenses (today 19);
- tax stays at 8% or more while saving (today 7% from 2035);
- the lowest daily balance stays at or above 0;
- population at year 60 is at least 950k, approval at least 50 from year 30, and the EQ gate holds.

Also:
- Fusion feeds the grid only once `built` reaches 1.
- Cancel refunds 50% of what was paid.
- Save/load in mid-construction restores the progress exactly.

**Depends on.** LG-10; PB-TAXRESPONSE or NEW-05 (taxes must cost growth, or the bot pays for projects with a free 12% tax); the Worker command rows; render round 2 (construction look on large lots). LG-16 adds council gates later.

**Risk.**
- The funds gate is protected because installments pause instead of overdrawing.
- The monthly loop is O(projects). Progress counts days and makes no RNG draws.
- Fusion's clean power nudges population and approval up (allowed by LD3).

#### LG-20 · Honours: quality goals for a city that has finished growing
P2 · M · CONTENT · round 3

**Problem**
- **Quality goals stop early.** The 7 rewards with quality conditions all unlock by 60k (`rewards.ts:57-105`).
- **From 2045 to 2060 the bot's environment and safety get worse** (`G_256x60_s7` `approvalTerms`): pollution −2.8 → −3.5, noise −3.7 → −4.2, emergencies −1.5 → −2.2.
- **No goal points at any of them.**

**Change.** Twelve Honours in the Rewards panel's Honours tab:

| honour | condition | reward |
|---|---|---|
| Clean Air Metropolis | 250k+, air at homes ≤ 0.10 for 12 months | Eco Plaza |
| Transit Capital | 200k+, transit ≥ 25% of trips | +5% ridership |
| Scholar City | EQ 130 | +5% education effectiveness |
| Healthy City | HQ 130 | |
| Safe City | 100k+, no failed emergency for 5 years | Firefighters' Memorial |
| Tourist Capital | 50k tourists/day | |
| Full Employment | 500k+, unemployment ≤ 3% for 2 years | |
| Green Belt | ≥ 30% of homes in reach of a large park | |
| Balanced Books | 10 years with no loan and taxes ≤ 9% | |
| Quiet City | 250k+, under 5% of homes Noisy | |
| Megacity | 1M | |
| Megalopolis | 1.5M | |

- **Each honour shows progress and the stat holding it back** ("Air at homes 0.14; needs 0.10").
- **Perks stay at 5% or less.**
- **Completion** plays a fanfare and gives a plaque.

**Files.** `src/sim/economy/rewards.ts` (kind `honour`, duration timers in `systemData`); `src/ui/panels/ListPanels.ts`; `src/sim/catalog.ts` (plaques); `src/assets/**`; `src/game/GameSounds.ts` (CONTENT hunk).

**Acceptance**
- Each honour has unit tests for meeting and missing its condition.
- The 256×60 s7 bot earns at least 4 by 2060. From its run today (`G_256x60_s7`): Balanced Books (no loan from 2012 and 9% tax or less, so 2022), Tourist Capital (50,617 a day in 2027), Scholar City (EQ 130.0 in 2040) and Megacity (2043). Healthy City (HQ 130) is not reached today (HQ peaks at 129.9 in 2035–37).

**Depends on.** LG-01; LG-10.

**Risk.** Perks can move gates slightly, so measure with the `polish` rows.

#### LG-02 · Late-game rewards and landmarks between 150k and 1.5M
P2 · L · CONTENT (SIM runs the gates) · round 3

**Problem**
- **Unlocks thin out after 150k**: Opera House at 150k (2014), Observation Spire 250k (2019), Twin Spires 500k (2029), then nothing (`rewards.ts:102-104`).
- **Tourism stalls.** From 2030 to 2060 tourists rise only from 62,498 to 68,898 a day while the population nearly triples (`G_256x60_s7`). The tourism approval term sits at its +4 cap from 2030 (`tuning.ts:691`).
- **The late game gets no landmarks**, though landmarks are the game's strongest visual payoff (`cmp/x_dm_landmarks_grid_AB.png`).

**Change.** Seven rewards with new models. Each landmark stays within 8,000 triangles and has at least 2 variants unless it is unique. Each does something beyond prestige:

| unlocks at | reward | what it does |
|---|---|---|
| 200k | Central Library | library tier for 20,000 students |
| 300k | Grand Central Station (4×3) | counts as a train station, a subway station and a bus hub; 18-tile transit coverage; 2,000 P&R spaces; R and C caps +30k |
| 400k | Stock Exchange | CO$$$ cap +40k; prestige 0.5 within 18 tiles; +5% office tax |
| 650k | Botanical Dome | green tier; draws 3,500 |
| 800k | World Trade Center | 8,000 CO jobs; C cap +60k |
| 1M | Millennium Tower | prestige 0.7 within 26 tiles; draws 7,000; visit income |
| 1.5M | Metropolis Crown | +3 approval; the title "Megalopolis" |

Each gets a `REWARDS` entry, an `ATTRACTIONS` draw and `CAP_RELIEF`.

**Files.** `src/sim/economy/rewards.ts`; `src/sim/catalog.ts`; `src/sim/economy/tourism.ts` (CONTENT hunk: `ATTRACTIONS`); `src/sim/economy/approval.ts` (SIM: civic term for the Crown); `src/assets/manifest.ts` and new `src/assets/builders/lm_*.ts`; `gallery.html`.

**Acceptance**
- With LG-10 buying them on 256×60 s7, each unlock fires in the year the §8.0 base run first reaches its population (today 2016, 2021, 2025, 2033, 2038, 2043, 2056).
- The tourism-jobs ratio stays within 0.7–1.3 from year 15 on 256×60 s7/s11 and 128×15. Extend the synthetic case at `tests/sim/tourism.test.ts:242`.
- Every model has at least 2 variants or is unique, and `gallery.html` renders all of them.

**Depends on.** LG-10; PB-ZOO (how to calibrate a venue's draw); R2-NIGHT (fix night windows before new towers).

**Risk.** The tourism-jobs gate. A venue's legacy points are 0.05 × its C cap relief (`demand.ts:98`), which is exactly how the zoo broke the band. Calibrate each draw against that and re-run the three gate runs.

#### LG-04 · Arcologies: dense paid mega-buildings for a full map
P2 · L · SIM, with CONTENT and GUIDE parts · round 3

**Problem**
- **Once the map fills, the city stops growing.** On 256×60 s7, growth is under 2% a year from 2056. In 2060: R demand −0.04, C 0.81, I 0.36, unemployment 9.0% (`G_256x60_s7`).
- **The bot's last years repeat the same failures** (`G_256x60_s7` log, 2057–60): "no site for a Large Park near 109,244 (7128 people in need)", "no site for a University near 113,71 (3748 people in need)", and "converted residential block (27,25) to industry (unemployment 9%)".
- **Density is capped.** The densest growables are stage 8: `res_supertall` with 6,000 residents and `com_megatower` with 12,000 jobs. There is no way to add jobs or homes without land.

**Change.** Arcologies are hidden, player-only growable defs, placed and paid for through LG-03:
- `zones: []`, so the growth system never picks one;
- flagged Historic, so they never redevelop;
- filled from demand by the population system like any growable.

| arcology | size, unlocks at | cost | contents |
|---|---|---|---|
| Business Arcology | 5×5, 650k | §2.5M over 24 months | 20,000 CO$$$ jobs; needs EQ 110 and a station within 6 tiles (LG-08); uses 40 MW |
| Residential Arcology | 6×6, 1M | §3.0M over 30 months | 30,000 R$$ residents plus 3,000 CS jobs; residents need schools and clinics like any home |
| Arcology II (mixed) | 1.35M | | 20,000 residents and 10,000 jobs |

The placement preview states the effect: "+20,000 jobs · 73,000 residents are unemployed today" (GUIDE).

**Parts by lane.**
- **SIM**: `growth.ts` (`collectDefs` skips player-only defs; Historic guard); slower health decay for arcologies; LG-10 `--arcology`.
- **CONTENT**: the defs, and 3 models with 2 variants each.
- **GUIDE**: the preview line in `PlopTool`.

**Acceptance.** 256×60 s7 with `--arcology`, placed once the map is built out (LG-05's test) and unemployment is above 5%:
- unemployment in 2060 at most 6% (today 9.0%);
- growth at least 2% a year in 2056–60 (today 0.3–1.2%);
- population at year 60 at least 950k, approval at least 50, lowest funds at least 0;
- a placed arcology reaches 80% occupancy within 3 years when demand exists;
- the growable count does not rise, and ms/day rises by at most 3.

**Depends on.** LG-03, LG-08, LG-10, NEW-01.

**Risk.**
- Unemployment consistency: test the labour model with a 20k-job building.
- Abandonment gate (≤ 3%): a 30k-resident building abandoning is a large swing, hence the slower decay.
- Traffic: 20k jobs on one lot must keep every step within 3 ms.

#### LG-19 · Expand facilities in place when there is no land left
P2 · M · SIM (GUIDE adds the button; WORLD adds the badge) · round 3

**Problem.**
- **In a full city, services cannot grow with the people.** In 2057–60 the bot's log repeats "no site for a Large Park…", "no site for a University…" and "no site for a Playground near 118,106 (456 people in need)" every two months, while $15–17M sits in the bank (`G_256x60_s7` log).
- **The only way to add capacity is a new lot.**

**Change**
- **An "Expand" button in the inspector** for schools, clinics, hospitals, libraries, police and fire stations, and parks.
- **Up to 2 levels.** Each level adds 50% capacity (stations also get one more vehicle), costs 1.5× the build price and adds 40% upkeep.
- **Visible on the model.** It gets a footprint-neutral annex or a level badge.
- **Parks upgrade in place**: Small Park → Plaza → Formal Garden.
- **The inspector shows "Level 2 of 3".**
- **New Worker command** `expandFacility`.

**Files.** `src/sim/infra/facilities.ts`, `services.ts`, `catchments.ts`; `src/sim/economy/opex.ts`; `src/sim/actions.ts`; `src/ui/panels/InfoPanel.ts` (GUIDE); the render badge (WORLD); `tools/simbot.ts` (`--expand`).

**Acceptance**
- Expanding a 1,500-seat school to level 2 shows 2,250 seats, and the unreached-pupil count nearby falls at the next services pass.
- 256×60 s7 with `--expand`: "no site" log lines in 2050–60 fall by at least 70%, and the gates pass.
- Expansion survives save/load.

**Depends on.** The Worker row; LG-10.

**Risk.**
- The services cost estimate (routed 13) is unchanged, because only capacity changes.
- Funds fall; approval and EQ rise.

#### LG-18 · Big-city ordinances with real trade-offs (100k to 1M)
P2 · M · SIM (CONTENT adds the panel sections) · round 3

**Problem**
- **Policy stops at 20,000 residents.** All 22 ordinances unlock by then (the last is the Clean Air Act, `ordinances.ts:96`), and the bot gets there by year 4. For the remaining 56 years policy has nothing new.
- **Policy can bite, but only early.** Enacting all of them costs a 128 city 4% of its people, 3.5 approval and 19% of its money (`veteran/ordall_128x15_s7.log`).

**Change.** Eight ordinances that unlock from 100k to 1M. Each shows its gain and cost as chips:

| ordinance | unlocks at | effects |
|---|---|---|
| Tech Incubator Grants | 100k, EQ 90 | I-HT demand +15%; §0.01 per resident |
| Rent Control | 150k | R$ desirability +0.03; R$$$ −0.03; residential construction 10% slower |
| Green Building Code | 200k | power and water demand −10%; growables build 20% slower; +1 approval |
| Congestion Charge | 250k | +§0.02 per resident in income; core car trips −12%; CS demand −4%; −1 approval |
| Skyline Height Limit | 250k | stage 6 maximum citywide; R$$$ +0.04 for the views |
| 24-Hour City | 300k | CS demand +8%; tourism +10%; noise +10%; crime +5% |
| Free Public Transit | 400k | ridership +25%; §0.015 per resident |
| Car-Free Downtown | 500k | core traffic noise −30%; CS$$ −5%; transit +10% |

The Ordinances panel groups ordinances by unlock tier (CONTENT).

**Files.** `src/sim/economy/ordinances.ts` (defs and effect keys); `src/sim/infra/traffic.ts`; `src/sim/economy/growth.ts` (height cap), `demand.ts`, `desirability.ts`; `src/ui/panels/ListPanels.ts` (CONTENT).

**Acceptance**
- Each ordinance shows its unlock population, chips and monthly cost.
- Each effect key has a unit test; for example, with the Height Limit on, no stage-7 building grows.
- 256×60 s7 with `--late-ordinances` passes the gates.
- An all-ordinances 256 variant stays solvent.

**Depends on.** LG-10; LG-08.

**Risk.**
- Ordinances the bot enacts move gates, so measure with the rule on.
- The default bot stays unchanged until the lead signs off.

#### NEW-01 · Visual variety: break up twins and repeated walk-ups
P2 · L · CONTENT (SIM adds the spread rule) · round 3

**Problem.**
- **Grown districts repeat the same buildings** (routed 27/38):
  - the same def and variant stand within 6 cells on 11.8% of growables at 256 s7 in 2020;
  - same-model twins are 12–14% on 256, mostly walk-ups (632–917 cases), shops & apartments and office blocks;
  - same-def twins are about 15% in 2020, mostly corner stores;
  - the contract target was 0.
- **Nobody owns this.** Render round 2 left "walk-up mix, skyline clustering and repetition" outside its lanes (render art r2 summary).
- **It shows.** Repeated brick walk-ups line whole streets (`cmp/tp_jun13_suburb_AB.png`).

**Change**
- **CONTENT** adds at least 3 variants, with distinct roofs and colours, for the four most-twinned stages: walk-ups, shops & apartments, office blocks and corner stores.
- **SIM** extends `spreadVariant` (`growth.ts`): when every variant of the chosen model already stands within 6 cells, it swaps to another def of the same stage and dev type.

**Files.** `src/assets/builders/**`, `manifest.ts`, `src/sim/catalog.ts` (CONTENT); `src/sim/economy/growth.ts` (SIM); `gallery.html`.

**Acceptance**
- 256×60 s7: same-model twins within 6 cells at most 5% of growables in 2020 and 2040 (today 12–14%), same-def at most 2%.
- Gates pass, with `polish` rows: def swaps change capacities slightly.
- Art review A/B at 300 m and 700 m, plus 10 suburb shots in which no street shows more than 2 identical facades in a row (today whole streets of brick walk-ups, `cmp/tp_jun13_suburb_AB.png`).

**Depends on.** Render round 2; LG-10; D8 (ownership).

**Risk.** Triangle budgets per stage.

#### FH-26 · An approval reward a young town can actually earn
P3 · S · CONTENT · round 4

**Problem**
- **The first approval reward is out of reach.** The Statue of the Mayor (+3 approval) needs 65% (`rewards.ts:77`). The Medium bot first gets there in about 2009 (65.1 / 65.8 / 67.0 for 256 s7 / 256 s11 / 128 s7).
- **Newcomers sit far below that**, at 36–45% (`newplayer/073`, `096`, `146`, `175`).
- **So the Rewards panel shows an unreachable goal for the whole first hour.**

**Change.**
- **New Statue condition**: 2,500 residents and approval of 55% or more for 6 months (or "up 10 points from its lowest"), shown as a goal with progress.
- **Scope** per D7.

**Files.** `src/sim/economy/rewards.ts`; `src/ui/panels/ListPanels.ts`.

**Acceptance**
- The Medium bot (128×15 s7) earns the Statue in years 4–6.
- The Rewards panel shows the new condition.
- The gates are re-run and pass.

**Depends on.** FH-04; final balance.

**Risk.** +3 approval earlier on Medium shifts the bot's approval, so record `polish` rows or keep 65% on Medium.

#### LG-17 · City charter: choose a specialisation at 100k
P3 (lowered from P2: L size, five demand and cap variants to balance) · L · SIM (CONTENT adds content) · round 4

**Problem**
- **Every city grows the same generic mix.** There is no district or specialisation system.
- **Late tourism is flat**: 62.5k → 68.9k a day from 2030 to 2060, with the tourism approval term capped at +4.
- **High-end identities never show** unless the mayor knows the hidden levers. A human 19k city collected §0–10 a month from R$$$, CS$$$, CO$$$ and I-HT taxes (`shots2/079`).

**Change**
- **A one-time City Charter dialog at 100k.** It can be changed after 20 years for §1M and −5 approval for a year.
- **Five charters**:

  | charter | effects | unlocks |
  |---|---|---|
  | Tourism Capital | venue draw ×1.2; hotel rooms per job ×1.25; noise +5% | Aquarium, Water Park, Theatre (not unique) |
  | Industrial Powerhouse | I demand cap +15%; better freight access; R$$$ desirability −0.03 | Logistics Hub, Steel Works |
  | Knowledge City | education effectiveness ×1.1; I-HT share max 0.55 (from 0.45); I-D demand −10% | Science Park, Innovation District |
  | Financial Centre | CO$$$ cap +20%; office tax +10%; CS$ desirability −0.02 | Bank Tower; the Stock Exchange at 300k instead of 400k |
  | Green City | air and noise emissions −10%; park capacity ×1.2; I-D demand −15% | Eco-Arcology, Solar Tower |

- **Each charter has a 3-tier track** with its own buildings, about 10 small buildings in total.
- **The charter shows** on the city badge and the region card.

**Files.** New `src/sim/economy/charter.ts` (effect keys through the ordinance effect cache); `demand.ts`, `tourism.ts`, `desirability.ts`; `catalog.ts`, `manifest.ts`, builders and new `src/ui/CharterDialog.ts` (CONTENT); the TopBar badge and `citySummary` (META).

**Acceptance**
- At 100k the dialog opens once, with the five options and their numbers.
- Knowledge City raises the I-HT share cap to 0.55 (unit test) and unlocks its buildings.
- Each charter's LG-10 variant passes the gates on 256×60 s7.

**Depends on.** LG-10, LG-02, PB-ZOO.

**Risk.** Each charter shifts demand and caps, so the gates re-run per charter. The base bot takes no charter.

#### LG-22 · Business deals that scale with the city
P3 · M · SIM (CONTENT adds defs and text) · round 4

**Problem**
- **Deals pay fixed sums**: Military Base §1,500, Missile Test Range §2,500 and Toxic Waste Dump §4,000 a month (`catalog.ts:445-453`). That is 0.7% of a 2045 bot city's $541k monthly income.
- **The downside depends only on distance.** In the veteran's deals run, the dump went in the map corner, and that city ended year 15 with 194,185 people, 81.4 approval and $122.1k a month of income, against 194,627, 78.7 and $118.2k without it (`veteran/deals_128x15_s7.log` vs `base2`; veteran #7).

**Change**
- **10-year contracts whose pay scales**: dump §0.004 per resident (at least §4k), missile range §0.0025, military base §0.0015.
- **At expiry** the offer renews at the new price, or the site must be cleared. The dump's soil must also be cleaned.
- **Hosting costs reputation**: −3 attractiveness for the dump, −1 for the missile range, with its own breakdown row.
- **New late deals**: Data Center Campus at 650k (pays per MW; a power hog) and Film Studio at 250k (tourism up, noise).

**Files.** `src/sim/catalog.ts` and `rewards.ts` (CONTENT); `budget.ts`, `tourism.ts` (SIM); contract state in `systemData`; `src/ui/panels/ListPanels.ts` (CONTENT); `tools/simbot.ts`.

**Acceptance**
- A 1M city's dump offer reads at least §4,000 + §0.004 per resident (about §8k).
- Hosting the dump lowers attractiveness by 3, with its own row.
- The corner-placement variant now costs at least 1% of the people or 1 approval vs base at 128×15 year 15.

**Depends on.** LG-10.

**Risk.**
- The base bot hosts the military base and missile range (`simbot.ts:2030-2040`), so re-run the population and tourism gates.
- Deals in old saves start a fresh 10-year term on load.

#### LG-23 · City events the mayor schedules and pays for
P3 · M · SIM (GUIDE adds the Budget tab) · round 4

**Problem**
- **The only recurring event is New Year**, and it has no gameplay effect (`NewYear.ts`).
- **Late tourism is flat** and money piles up, with nothing seasonal to plan.

**Change**
- **Budget → Events tab.** Schedule up to 2 events a year: Summer Festival, Marathon, Music Festival at the stadium, Christmas Market, Expo Week. Each costs §0.3–1 per resident.
- **In the event month**: draw ×1.3, CS demand +5%, and +2 approval for 3 months.
- **Side effects**: noise and crime near the venue; the marathon closes its route for a day.
- **Banner props and a news line.**

**Files.** New `src/sim/economy/events.ts`; `tourism.ts`; `approval.ts` (an `events` term); `src/ui/panels/BudgetPanel.ts` (GUIDE); props (WORLD).

**Acceptance**
- A Summer Festival in a 300k city charges §0.5 per resident once.
- Graphs show +2 approval for 3 months and tourists ×1.3 in July.
- The 12-month mean tourism ratio stays within 0.7–1.3.
- The bot schedules no events, so gate runs don't change.

**Depends on.** None.

**Risk.** The schedule lives in `systemData`.

#### LG-26 · Historic districts: freeze a quarter for tourism
P3 · S · SIM (CONTENT adds the tool spec) · round 4

**Problem**
- **Historic status is per building.** It is a toggle in the inspector (`InfoPanel.ts:599-606`) that earns historic tourism (`tourism.ts:373-390`).
- **At city scale that is unusable.** A 1.5M city has about 8,800 growables (`G_256x60_s7` `grow` 8,763), and nobody marks them one by one.
- **So the classic late-game trade-off never comes up**: keep the old town or build towers.

**Change**
- **A "Historic district" area tool in the Zones flyout.** Dragging a rectangle makes every growable inside historic in one command (`setHistoricRect`, a Worker row like `setHistoric`).
- **The district gets a name** and shows in the Tourism data view.
- **Districts of 40 or more buildings** get +25% historic tourism and +0.05 land value inside.
- **Undo** removes a district as a whole.

**Files.** New `src/game/tools/HistoricTool.ts`, `src/sim/actions.ts`, `tourism.ts` (SIM); `src/game/toolCatalog.ts` (CONTENT).

**Acceptance**
- Dragging over 60 growables makes all 60 historic in one command.
- Historic tourism rises (Demographics → Tourism).
- None of the 60 redevelops over 2 years.

**Depends on.** The Worker row.

**Risk.** None for the gates; the bot won't use it.

### G. Region and challenges

#### LG-12 · Sister cities: found or fund a neighbour when the map is full
P2 · M · META (SIM adds the endowment line and the approval term) · round 3

**Problem**
- **A full map has idle workers and idle money.** In 2055–60 the bot's city has residential demand of about 0 and 9% unemployment, and it banks $17.7M by 2060 (`G_256x60_s7`).
- **The region could absorb both, but nothing points there.** A connected neighbour's spare jobs already count in the city's job supply (`regionInputs`, `demand.ts:174`; `regionEffects.ts:100-121`). Yet the region screen reads "2 of 106 tiles founded" (`shots2/114`; `RegionScreen.ts:144`).
- **A new neighbour starts from nothing**: §100k on Medium (`config.ts:32-37`), next to a city with millions in the bank.
- **Getting there takes four steps**: Save & exit → region → tile → Found New City (`RegionScreen.ts:206-246`).

**Change**
- **"Found a sister city"** on the built-out advice card (LG-05) and in the pause menu. It saves the city and opens the New City dialog on the best adjacent unfounded tile (the one sharing the longest edge with the parent's edge roads), with the mayor filled in.
- **An endowment slider**: up to 25% of the parent's funds, at most §5M, once per city per 10 game years.
  - It is a one-off expense in the parent, on a "Sister city endowment" line.
  - It is added to the new city's start money.
  - It is charged only when the player presses "Found", inside the same save chain as the new city's first save, so the transfer and the new city exist together or not at all.
- **A road stub** continues the parent's edge road into the new tile, so the two connect from day one.
- **Recognition.** The parent gets +1 approval ("Founded a sister city") for 12 months. Sister links show on the region card.

**Files.** `src/region/NewCityDialog.ts`, `src/region/RegionScreen.ts`, `src/main.ts` (city start and exit, `:430-560`), `src/region/regionEffects.ts`, `src/region/types.ts` (`sisterOf`); `src/sim/economy/budget.ts` and `approval.ts` (SIM).

**Acceptance**
- From the y43 checkpoint (§8.0, regenerated at the merge commit like the veteran's `veteran/big_256x45_s7_y43.metropolis`) with a §2M endowment:
  - the parent shows −§2M once, on the endowment line;
  - the new city opens with §2.1M (§100k + §2M) and a road stub joined to the parent's edge road.
- Sister jobs count for the parent only once the edge is connected (PB-REGION).
- A confirm dialog says the transfer can't be undone. A second endowment within 10 years is refused, with the date it becomes possible.
- Cancelling the New City dialog leaves the parent's funds unchanged. Killing the tab between "Found" and the first save gives exactly one transfer or none, never two.
- The road stub adds no demand-cap relief to either city until it joins the other city's network (veteran #6: dead-end stubs stack relief without limit today).

**Depends on.** PB-REGION, PB-DIALOG, LG-05, `WORKER_DESIGN.md` §4.4 (region switching through the host).

**Risk.**
- Money shuttling between cities, held by the 10-year rule and the 25% cap.
- A new optional region field; old regions load unchanged.

#### LG-14 · Scenarios and optional challenges
P2 · L · META (SIM writes the scenario generator) · round 3

**Problem**
- **There is no scenario, challenge or achievement anywhere in `src`.** The title menu offers Continue, New Region, Load Region, Settings and Credits (`TitleScreen.ts:57-66`).
- **The only founding constraint is the Disasters toggle** (`shots2/008`).
- **Scripted starts would have drama.** The veteran's six-month blackout took a 128 city from 71,236 to 25,164 people, and it was back at 72,734 four months later (`veteran/crisis_128x12_s7.log`, days 2880–3180).
- **The tooling exists.** The veteran's `saveRegionFile` (`serializeCity` + `packFile`, `S/simB/verify-veteran-r1/snap/tools/vet.ts:152-164`) already writes playable region files from bot runs.

**Change**
- **A Challenges menu** on the title screen, with scenarios generated from fixed bot seeds:

  | scenario | start | goal |
  |---|---|---|
  | Smog City | a 2015 ~195k city on 128 built on dirty industry | air at homes −40% within 10 years while keeping 180k people |
  | Boomtown | an empty 128 tile with §100k | 50k / 100k / 150k residents by year 10 (bronze / silver / gold) |
  | Lights Out | a 71k city whose coal plant just burned, with less money than one replacement plant costs | back to 70k and approval 60 within 12 / 9 / 6 months; gold also needs no new loan |
  | Gridlock | 400k on 256 with no transit | 25% transit trips and a 9-minute commute within 8 years |
  | Island Hopper | the archipelago preset | 3 islands connected, 60k residents in total |
  | Postcard Town | a 128 tile where dirty industry (I-D) is not allowed | 40k tourists a day |

- **Medals.** Bronze, silver and gold, saved per profile.
- **On screen.** A pinned objectives card that updates monthly, and a win or lose screen.
- **"Mayor's challenges"** for any new city, as toggles in the New City dialog: No loans, No dirty industry, Frequent disasters, Hard money. Each earns a badge on the region card.
- **Ship three scenarios first** (D9): Boomtown, Lights Out and Smog City.

**Files.** `src/region/ui/TitleScreen.ts`; new `src/game/scenarios.ts` and `src/ui/ObjectivesCard.ts`; new `tools/scenarios.ts` (SIM); the bundled-file import through the host; `src/region/NewCityDialog.ts` (the toggles).

**Acceptance**
- Every scenario starts from the menu.
- Each has a bot strategy that reaches bronze and a do-nothing run that fails.
- Lights Out: a run that only buys one replacement plant earns at most bronze. Without the start-money limit it would earn gold, because the veteran's crisis city was back at 72,734 within 4 months of power returning (`veteran/crisis_128x12_s7.log`; veteran #8).
- The objectives card updates monthly. Medals persist across reloads.
- Every bundled file loads at HEAD (the audit's old-save method, as a test).

**Depends on.** The Worker (W1.x), PB-SAVELOAD, LG-09 (the Hard-money rules).

**Risk.**
- Bundles must be regenerated whenever the save version changes; the test above catches it.
- Size: a year-20 256 save is 4.3 MB gzipped, so ship 128-map scenarios at 1–2 MB each.

#### LG-13 · Region goals and a region dashboard
P3 · M · META · round 4

**Problem**
- **The region card shows only totals**: population, R/C/I and the tile count (`RegionScreen.ts:126-145`; `shots2/114`).
- **Each city keeps its own calendar.** The region list shows "Year 2009" next to "Year 2003" (`shots2/095`, `114`).
- **Neighbours are a snapshot.** They are read once when the city opens (`main.ts:530-531`) and the same numbers are re-applied every month (`regionEffects.ts:147-150`).
- **Neighbours barely change growth.** A synthetic 400k-job neighbour pins residential demand at 1.0 for 11 years but adds only 1.0% population, because the growth throughput cap absorbs the extra demand (veteran #10). PB-TAXRESPONSE or NEW-05 changes that cap; the region perks below are measured after it.
- **The region has no goals, no unlocks and no connection lines.**

**Change**
- **Region milestones**: 100k, 500k, 1M and 3M residents; 3, 6 and 10 cities; 2 connected pairs.
- **Region perks**:
  - Regional Transit Authority: +0.25 to the edge factor;
  - Regional Airport Network;
  - Regional Utility Grid (enables LG-11);
  - Metropolitan Region: +2 attractiveness in every city.
- **A dashboard row per city**: rank (LG-01), specialisation, jobs vs workers, the year it was last played.
- **Lines between connected cities** on the region map.

**Files.** `src/region/RegionModel.ts` (`REGION_FORMAT_VERSION`), `src/region/RegionScreen.ts`, `src/region/RegionView.ts`, `src/region/types.ts`, `src/region/regionEffects.ts`, `src/region/citySummary.ts`.

**Acceptance**
- With 3 cities, 2 of them connected, and 120k residents, the card shows "100k ✓ · 3 cities ✓ · Transit Authority active" and draws the lines.
- The RCI popover's neighbour block (`TopBar.ts:258-275`) reflects the +0.25.
- A region without the new data behaves as today.

**Depends on.** PB-REGION, LG-01; PB-TAXRESPONSE or NEW-05 (veteran #10).

**Risk.** A region format bump with a migration.

#### LG-11 · Neighbour deals: sell spare power, water and garbage capacity
P3 · L · SIM (META region data, GUIDE the Budget tab) · round 4

**Problem**
- **Late cities sit on idle utilities.** In 2060 the bot city supplies 4,668 MW against 3,403 MW of demand, and 737k kL/day of water against 506k (27% and 31% idle; `G_256x60_s7`, recorded as [supply, demand] by `r3drv2.ts:171`).
- **The region passes only people and jobs**: population, residents, commercial and industrial jobs, and funds (`types.ts:12-37`; `regionEffects.ts:61-121`).

**Change**
- **The city summary gains `powerSpare`, `waterSpare` and `garbageSpare`.**
- **A Budget → Neighbours tab** (GUIDE) offers deals such as "Sell 200 MW to Riverton at §3/MW a month".
  - The price follows the buyer's shortage.
  - Terms run 10 years and are re-priced when either city is opened.
- **How a deal works.** The seller gets a virtual load at the shared edge, and the buyer a virtual plant there. If the seller runs short, the buyer browns out first and both get a news item.
- **A Regional Landfill contract** works the same way for garbage.

**Files.** `src/region/types.ts`, `citySummary.ts`, `regionEffects.ts`, `RegionModel.ts`, `src/main.ts:520-560` (META); `src/sim/infra/utilities.ts`, the garbage system, `src/sim/economy/budget.ts` (SIM); `src/ui/panels/BudgetPanel.ts` (GUIDE).

**Acceptance**
- City A, with 500 MW spare, sells 200 MW to city B, which has no plant. B's homes are powered.
- A shows +§600/mo on a `deal:power:B` line and 200 MW more load.
- Removing the edge road suspends the deal, with a news item.
- The deal survives save/load of both cities. Bot runs without deals are unchanged.

**Depends on.** PB-REGION, the Worker; LG-13 optionally (the Utility Grid perk).

**Risk.** Selling to a neighbour nobody plays. Cap each deal at the buyer's demand at its last save.

#### LG-24 · Move between region cities from inside a city
P3 · S · META · round 4

**Problem**
- **Switching cities takes four steps**: Save & exit → region → tile → Play (`RegionScreen.ts:206-246`; `main.ts:486-520`).
- **The neighbour labels at the map edges can't be clicked.** They are "Purely decorative (pointer-events: none)" (`NeighborLabels.ts:1-4`).
- **Nothing says what changed next door** since the last visit.

**Change**
- **Clickable labels**: "Visit Riverton (61k) — saves Queensbury first".
- **A "While you were away" card** when a neighbour changed by more than 10%: "Riverton grew from 40k to 61k: +8k spare jobs (east edge connected)".

**Files.** `src/region/NeighborLabels.ts`, `src/main.ts:486-560`, `src/region/regionEffects.ts` (a last-seen record in `systemData.region`), `src/ui/Notifications.ts`.

**Acceptance**
- A click saves (the Saved indicator shows) and opens the neighbour.
- The card appears only after a change of more than 10%.
- A city with no region data behaves as today.

**Depends on.** `WORKER_DESIGN.md` §4.4, PB-DIALOG.

**Risk.** None for the gates; it is navigation only.

### H. Pacing and notifications

#### FEEL-02a · Real-time budgets at every speed: New Year pacing and the toast budget
P1 · M · META · round 1

**Problem.** Everything paced in game time turns into spam, and New Year does at every speed. For a 100k city (`NewYear.ts:247-283`; show length `fireworksShowLength`, `Fireworks.ts:88-90`):
- **Ultra** (18 s a year, `SECONDS_PER_DAY`, `src/core/constants.ts:34`; 60 bot years ≈ 18 minutes): every year plays the fanfare and a toast (`NewYear.ts:201-212`), then an 8 s show after a 2.8 s lead-in (`:283`: `max(6, 0.6 × 18 − 2.8)`). Fireworks fill about 11 of every 18 seconds.
- **2×** (72 s a year): the year is too short for the cinematic (its budget, 72 / 2 − 16.8 = 19.2 s, is under 20), so it plays a 3.6 s countdown and a 39.6 s show in fireworks mode: 43 of every 72 seconds, about 60%.
- **1×** (180 s a year): a 73 s cinematic after a 3.6–6.8 s lead-in, with the camera taken by default (`newYearCamera: true`, `settings.ts:60-61`): about 44% of real time, every 3 minutes. Any camera input hands the camera back, but the clock and the night switch keep running.
- **LG-21 would add** a 15 s card after each show.
- **Advice.** Up to 2 advisor messages a month (`ADVICE_PER_MONTH`, `advisors.ts:60`), with a 60-day minimum cooldown, which is 3 s at ultra (`:62`).

**Change**
1. **New Year paced by real time, at every speed.**
   - A full show plays on the city's first New Year, on a New Year in which it ranked up (LG-01), and otherwise at most once per 10 real minutes. Two full shows are never less than 3 real minutes apart, rank-ups included. A full show is today's cinematic at 1×, and the fireworks-mode show at 2× and ultra.
   - Every other New Year at 1× and 2× gets a burst of at most 12 s, with no countdown, no fanfare (only the fireworks' own sound) and no camera or clock takeover. At ultra it gets no burst, only a silent compact toast: "2034 · 812,400 residents, up 6%".
   - The yearly toast stays; the fanfare plays only with a full show.
   - A Settings row "New Year show: Milestones / Every year" (`newYearPacing`) keeps today's pacing for players who want it (D17).
2. **A toast budget** for advisor, warning and good news: at most 1 per 4 s and 8 per minute.
   - Bad news, disasters and errors always show.
   - A toast that carries an action is queued and shown when the budget allows, never dropped. That covers FH-03's "Zone homes" and FEEL-06's "Place it", found by `NewsItem.ref`. Other extras go to the badge, the ticker and the news feed.
   - The demand-cap toast (`TopBar.ts:308-321`) shares the budget, which `Toasts` enforces.

**Files.** `src/game/NewYear.ts` (META in rounds 1–3); `src/ui/Notifications.ts` (`Toasts`); `src/game/settings.ts`; `src/ui/panels/SettingsPanel.ts` (the New Year row).

**Acceptance**
- 5 minutes at ultra on a save of 100k or more: at most 2 fanfares and 2 full shows, and at most 8 toasts in any 60 s, with every disaster toast shown.
- 10 minutes at 2× on a 100k save: at most 2 full shows, and fireworks on screen at most 25% of the time (today about 60%).
- 10 minutes at 1× on a 100k save: at most 2 full shows (camera takeovers); every other New Year is a burst of at most 12 s.
- A city's first New Year, and a rank-up New Year, each get a full show unless one played in the last 3 real minutes.
- A toast with an action that arrives over budget appears within 60 s.

**Depends on.** PB-NEWYEAR (the date holds during the cinematic; real-time timer); LG-01 for rank-up years (until it lands, the first-New-Year and 10-minute rules apply). It starts with its lane after W0.6, because its toast budget shares `Notifications.ts` with W0.5.

**Risk.** Fewer full shows. The first New Year and rank-ups keep the big moment, and "Every year" keeps today's pacing for players who want it.

#### FEEL-02b · Quiet autosave with a real-time floor
P1 · S · META · round 1 (after W0.6); its recovery check after W1.3

**Problem**
- **Autosave runs every 3 game months** (`region/settings.ts:19`, passed in by `main.ts:542`): every 45 s at 1×, 18 s at 2× and 4.5 s at ultra (`WORKER_DESIGN.md` §4.2).
  - Each autosave plays a chime and shows the top-centre pill (`CityScene.ts:897-915`).
  - The pill sits at z-index 70 (`hud.css:690`), above the emergency banners, and repeats what the minimap's save chip already shows.
- **The labels promise game time only**: "Saves every N game months" (`SettingsPanel.ts:84`) and "Autosave · game time" (`region/ui/dialogs.ts:66-80`). With a real-time floor they would be untrue.
- **The trigger moves.** W0.6 routes every save through `host.save`, so this item lands after it.

**Change**
- Never sooner than 60 s of real time after the last save; when the Worker's own 30 s floor lands, the larger of the two applies.
- Autosave is silent: no chime and no pill, only the minimap chip updates. Ctrl+S keeps its pill and chime.
- Both labels read "Every N game months, at most once a minute".

**Files.** `src/game/CityScene.ts` (META hunks: `onMonth`, `save`, calling `host.save` after W0.6); `src/ui/Modals.ts` (`SavePill`); `src/ui/hud.css`; `src/ui/panels/SettingsPanel.ts` and `src/region/ui/dialogs.ts` (labels).

**Acceptance**
- 5 minutes at ultra on a save of 100k or more: at most 5 autosaves, with 0 chimes and 0 pills.
- At 1×: an autosave at the first month end at least 60 s after the last save (every 4 game months instead of 3).
- After W1.3: kill the tab 50 s after an autosave. The restore offers the last snapshot, at most 30 s and 90 game days old, plus every journaled edit (`WORKER_DESIGN.md:852-853`). Until W1.3 the net is today's recovery snapshot every 30 s while dirty (`SNAPSHOT_INTERVAL_MS`, `main.ts:152`).

**Depends on.** W0.6 (saves through the host); W1.3 for the recovery check (`WORKER_DESIGN.md` §4.3).

**Risk.** Autosaves become sparser at ultra, so a crash relies on the recovery snapshots and, after W1.3, the journal; the acceptance checks it. NEW-03 keeps older saves to go back to.

#### FEEL-05 · Found new cities in spring, with a seasonal minimap (lead decision)
P2 · M · META (SIM adds the test) · round 1, not gating round-1 sign-off

**Problem**
- **Day 0 is 1 January** (`CityState.ts:447`), so every first view is winter: grey-brown woods with no visible map edge (`shots2/010`; `newplayer/047`; `cmp/fv_temp_def_AB.png`, `x_fv_forest_crop_AB.png`).
- **The minimap stays summer-green in every season** (`MiniMap.ts:95-100`; `cmp/ui_U_def_1300_ui_AB.png`).
- The lead chose day 90 (1 April). It is P2: a winter first view confuses no one, and the art review rated it minor (render art r2 #4). P1 effort goes first to save safety (NEW-03, NEW-04) and to taxes that cost growth (PB-TAXRESPONSE or NEW-05).

**Change**
- **Start on day 90.** `main.ts` `startNewCity` sets `st.day = 90` and `systemData.foundedDay = 90` right after it creates the state (`:449`).
  - The `CityState` constructor stays as it is, so the bot, the tests and the baselines keep day 0.
  - The six systems' "day > 0 means a resumed city" heuristics also require stored data, which a fresh city lacks, so they are safe. `growth.ts:897` computes nothing for a fresh city, because `computeCore` returns null without shop or office jobs (`growth.ts:107`). See "Where the drafts were wrong", point 4. A test confirms all of it.
  - Three advisor checks count from day 0, and all three count from `foundedDay` instead (GUIDE, three lines):
    - the two rules at `advisors.ts:1272` and `:1284`;
    - `advisorData`'s first headline (`advisors.ts:144`), which would otherwise treat the day-90 city as an older save and post on day 120, 30 days after founding instead of 45.
  - `CityScene.newCity` already keys on the camera and the buildings (`CityScene.ts:181`).
- **A seasonal minimap, composited over the cached base.** `paintBase` loops over every cell (`MiniMap.ts:77-121`), and repainting it each month would mean every 1.5 s at ultra, while Worker R2 is throttling exactly this function. So the seasonal tint is a separate layer:
  - a land mask, built whenever the base repaints anyway;
  - multiplied over the base at draw time, blending land toward `lum × (1.18, 1.02, 0.68)` by the renderer's `uFoliageDry` and then by `uFoliageTint`;
  - updated on `'month'` as two `drawImage` calls.

**Files.** `src/main.ts:443-469`; `src/ui/MiniMap.ts` (the draw step and a land mask, not `paintBase`'s cell loop; reading `sharedUniforms` from `src/assets/materials.ts:108-133`, `setFoliageSeason`); new `tests/sim/foundingDay.test.ts`; `src/sim/economy/advisors.ts` (GUIDE).

**Acceptance**
- A new city opens on "Apr 1, 2000" with green foliage, and its first New Year is 1 January 2001.
- A day-90 city is treated as fresh by every day-0 check: the six systems, growth's core and the advisors' headline schedule (the test). Its first headline comes 45 days after founding.
- "Nothing growing" never fires earlier than 60 days after founding.
- The minimap differs visibly between January and July.
- A month tick adds no `paintBase` call (counted in a test).
- The bot 128×15 s7 table is unchanged.

**Depends on.** R2-SEASONS (spring foliage look); W0.5 (it marks the MiniMap dirty on `layerUpdated`). It avoids Worker R2's `paintBase` rewrite.

**Risk.** The first calendar year is 9 months long, so year-1 statistics cover 9 months; the Year in review (LG-21) labels it "since April".

#### FEEL-01 · News ticker: newest headline first, one readable clause
P2 · S · META · round 2

**Problem**
- **'info' news reaches only the ticker**: the toast filter drops it (`Notifications.ts:113-114`).
- **New items appear late.** `rebuild` (`Notifications.ts:54-76`) puts the newest item first but never resets the scroll offset, so a new item shows only after the 8-item loop wraps: 60–120 s at 38 px/s (`:86`).
- **The window is small, and the scroll causes the fragments.** `hud.css:345` sizes the bottom-left block as `clamp(240px, 50% − 340px, 460px)` inside the zoomed HUD root (`zoom: var(--ui-zoom)`, `hud.css:18`). At 1280×720 the zoom is 0.8 (`zoom.ts:13-19`), so the block is 460 css px, about 368 screen px; `shots2/010` shows about 365 px. The fragments come from the scroll offset never resetting (`frame`, `Notifications.ts:78-89`): players read "g garden gnomes." (`shots2/i01`), "— zone more commercial land." (`shots2/091`) and "…ury reaches 500 residents!" (`shots2/023`).
- **The welcome tip is wrong.** It says to "connect it with power lines" (`Notifications.ts:62-63`), while roads already carry power (`utilities.ts:5`). The utilities advisor card says the same (`AdvisorsPanel.ts:52`, fixed by FH-18).

**Change**
- **The newest item enters from the right.** It holds for 5 s if it fits; otherwise it scrolls through once at 60 px/s. Bursts queue: 5 s for the first, then 3 s each.
- **One clause.** The ticker shows the first clause only (at most 90 characters, split at " — " or ". "). The full text is in the tooltip and the news feed.
- **Flavour headlines get a "Gazette" label.** Hover pauses the ticker.
- **A correct welcome tip**: "Tip: roads and power lines carry electricity from your plant to your zones."
- **A new `ticker.push(item)` API**, used by FEEL-22.

**Files.** `src/ui/Notifications.ts` (`NewsTicker`, `:35-89`); `src/ui/hud.css:345-359`.

**Acceptance**
- Within 1 s of a `notify`, the first 20 characters of the item are inside `.tk-view`.
- A 200-character item shows at most 91 characters, plus a tooltip with the full text.
- Each of 10 consecutive headlines is fully visible within 15 s of arriving.
- FH-18's text test covers the welcome tip ("power lines" never appears as the way to connect a plant).

**Depends on.** PB-PANELS (the ticker caches its width), W0.5 (the news sequence number).

**Risk.** None for the gates; UI only.

### H2. Saves and storage

#### NEW-03 · Save history and safe exits
P1 · M · META (with the Worker save owner; SIM adds the worker rows) · round 2, after W0.6 and W1.3

**Problem**
- **One save slot per city.** Every save overwrites the city's single record (`saveCity`, `save/index.ts:49-55`), and autosave runs every 4.5 s at ultra (every 60 s after FEEL-02b). A bulldozed downtown is autosaved before the player notices.
- **FH-07b's undo only covers the current game day**, which ends within half a second at 1×.
- **No way out without saving.** The pause menu offers Resume, Save city, Save & exit, Settings and Help (`Modals.ts:33-50`). "Save & exit" always saves (`CityScene.exitToRegion`, `:918-930`), and the app re-saves a dirty city on exit and on tab hide (`main.ts` `exitCity`, `saveCurrentCity`).
- **The planned endings would trap the player.** LG-09's and LG-16's endings offer "Reload", which would reload an autosave already inside the failing streak.

**Change**
- **Save history per city**: the last 3 autosaves, at least 5 real minutes apart, plus the last manual save. Older autosaves rotate out.
  - A slot is compressed with the existing `packFile` (gzip through `CompressionStream`) when it is demoted, in the worker after W1.3.
  - The live record keeps today's uncompressed format (`WORKER_DESIGN.md` §4.2), so a normal save costs nothing more.
- **"Restore an earlier save"** in the pause menu and on the region city card. Each slot shows its date, population and funds. Restoring asks for confirmation and keeps the current state as a new slot, so a restore can itself be undone.
- **"Exit without saving"** in the pause menu, with a confirmation ("Changes since 14:32 will be lost"). It skips the exit save and the dirty re-save, and discards the recovery snapshot.
- **"Revert to last save"** reloads the newest slot.
- **Endings restore the right save.** LG-09's and LG-16's "Reload" restores the newest slot from before the failing streak began.

**Files.** `src/save/index.ts` and new `src/save/history.ts`, after W0.6 splits the record code into `src/save/cities.ts`; `src/worker/**` (SIM: the history write in `save:put`); `src/ui/Modals.ts` (META: `PauseMenu`); `src/region/RegionScreen.ts` (the city card); `src/main.ts` (`exitCity`, the restore path); `src/game/CityScene.ts` (META hunk: an exit without a save).

**Acceptance**
- Bulldoze downtown, let 2 autosaves pass, restore the slot from before: the city's fingerprint equals the pre-bulldoze save.
- Exit without saving, then Continue: the city equals the last save (fingerprint), and no recovery prompt appears.
- LG-09's removal screen offers "Restore" with the date of a save from before the 12 bankrupt months.
- The restore dialog shows each region's storage use.

**Depends on.** W0.6 (saves through the host, and the `save/index.ts` split); W1.3 (worker persistence and the journal); NEW-04 (quota handling).

**Risk.**
- Storage: a 1M city is 4.4 MB gzipped (veteran summary), so its history adds up to about 18 MB. NEW-04's quota message covers a full disk.
- Compressing a 1M slot costs 114–209 ms of CPU (`WORKER_DESIGN.md` §4.2). It runs in the worker, at most once per 5 minutes.

#### NEW-04 · Storage you can trust: persistence, quota errors, one tab per region
P1 · S · META · round 1 (after W0.6)

**Problem**
- **Saves live in best-effort storage.** Nothing in `src` calls `navigator.storage.persist()` or `navigator.storage.estimate()`, so the browser may evict IndexedDB (`save/db.ts`) under storage pressure. The only backup is a manual export (`RegionScreen.ts:106`). The game does warn when IndexedDB is missing altogether (`main.ts:239`).
- **A failed save shows the raw exception**: "Saving failed" plus `err.message` (`CityScene.ts:910`; `ErrorOverlay.report`, `Modals.ts:259-285`), and "Saving failed: {message}" on exit (`main.ts` `exitCity`). A full disk reads as a crash.
- **Two tabs overwrite each other.** There is no Web Lock or BroadcastChannel in `src`. Every city save also rewrites the whole region record (`doSaveCity` → `persistRegion`, `main.ts:691`), so two tabs in one region can drop each other's city summaries even when they play different cities. The lock is therefore per region, not per city.

**Change**
- **Persistent storage.** After the first city is founded (inside the player's "Found" click), call `navigator.storage.persist()`. If it is denied or unsupported, the region screen shows a dismissible "Back up your region" reminder with a one-click export, while the last export is more than 7 days old.
- **Quota errors.** A `QuotaExceededError`, or an `estimate()` within 5% of the quota before a save, shows a guided message: "Your browser's storage for Metropolis is full. Export this region, or delete old regions or save history to free space." Its buttons are Export, Manage storage (regions and NEW-03 slots with their sizes) and Retry. Other save errors get one plain sentence plus Details.
- **One tab per region.** A Web Lock (`navigator.locks`) is held while a region or one of its cities is open.
  - A second tab opens the region read-only: "This region is open in another tab", with saves and autosave off.
  - Its "Use it here instead" button takes the lock over; the first tab stops saving and says so.
  - Where Web Locks are missing, a BroadcastChannel heartbeat does the same.

**Files.** `src/main.ts` (founding, the lock, save errors); `src/save/db.ts` (`persist` and `estimate` helpers); `src/region/RegionScreen.ts` (the reminder, Manage storage); new `src/ui/StorageDialog.ts`; `src/game/CityScene.ts` (META hunk: `save` routes storage errors to the dialog).

**Acceptance**
- A second tab on the same region cannot save: its save buttons are disabled and autosave is off. "Use it here instead" moves saving to it, and the first tab shows "This region is now open in another tab".
- A `QuotaExceededError` from the store shows the guided message with Export, Manage storage and Retry, never the raw exception.
- Founding the first city calls `navigator.storage.persist()` once. When it resolves false, the region screen shows the backup reminder until an export is made.

**Depends on.** W0.6 (save errors now arrive from `host.save`); PB-DIALOG (region dialogs).

**Risk.**
- Safari deletes script-written storage after 7 days without a visit for sites not added to the home screen, and `persist()` may not help there. The reminder is the defence.
- Firefox may prompt on `persist()`, hence the call inside the player's own click.

### I. World and camera

#### FH-19 · Camera and keys a laptop player can use (AZERTY, Dvorak, Mac)
P1 · S · WORLD · round 1

**Problem**
- **A trackpad can't pan the city.** Left is reserved for tools; pan is middle-drag or Shift+right-drag (`CameraController.ts:4-5`, `:242-244`). A trackpad has no middle button, and nothing mentions Shift+right.
- **The region screen shows a controls hint bar** (`shots2/005`); **the city shows none** (`shots2/010`).
- **Help omits the pan a trackpad has.** It lists "Pan W A S D" and middle-drag (`Modals.ts:200-208`), but not Shift+Right-drag, the arrow keys, Home or + / −.
- **Keys are read by character, not position** (`e.key`, `CameraController.ts:337-353`). On AZERTY the physical W key types 'z', which does nothing, and the physical A key types 'q', which rotates the camera.
- **More keys fail outside QWERTY:**
  - the speed keys compare `e.key` with '1', '2' and '3' (`CityScene.ts:840`); on AZERTY the unshifted keys type '&', 'é' and '"', so they do nothing;
  - the brush keys `[` and `]` (`BrushTool.ts:108`) need AltGr on AZERTY;
  - Delete selects bulldoze (`CityScene.ts:846`), but a Mac laptop's delete key sends Backspace (B still works);
  - moving the camera on `e.code` alone collides on other layouts: on Dvorak the physical S key types 'o', which opens Data views (`toolCatalog.ts:245`), and on Colemak it types 'r', the residential zone cycle.

**Change**
- **A hint bar for the first 2 city sessions**: "WASD or Shift+Right-drag to pan · Right-drag to rotate · Wheel to zoom · Space to pause". It fades after the first pan and the first zoom.
- **Left-drag pans** when the Query tool or no tool is active. A click that moves less than 6 px still inspects (`QueryTool.up` already ignores moves over 6 px).
- **Movement and rotation use `e.code`** (KeyW/A/S/D, KeyQ/E).
- **Character hotkeys skip camera keys.** When `e.code` is a camera-movement key, `onKey` does not run the character hotkey, so Dvorak's 'o' at the S position pans instead of opening Data views. That costs Dvorak players the O hotkey until FH-25's rebinding.
- **Speeds on positions**: Digit1–3 and Numpad1–3 by `e.code`.
- **Brush size also on the Minus and Equal key positions**, next to `[` and `]` (a GUIDE hunk in `BrushTool.ts`).
- **Backspace is a bulldoze alias**, like Delete.
- **The New Year camera hands control back on the same keys.** `NewYear.ts`'s `CAMERA_KEYS` (`:102`, read by `e.key` at `:623`) moves to `e.code` (META hunk).
- **Help lists every pan method** (GUIDE edits the Help rows; FH-17's Shortcuts topic).
- **Settings rows for pan speed and inverted orbit** (META adds the rows).

**Files.** `src/render/world/CameraController.ts`; `src/game/CityScene.ts` (WORLD hunk: `onKey` speed keys, Backspace and the hotkey skip, and `consume`'s camera-key check at `:873`, which also reads `e.key`); `src/game/tools/QueryTool.ts` (WORLD hunk: `down`/`up`); `src/game/tools/ToolController.ts`; `src/game/tools/BrushTool.ts` (GUIDE hunk: the key check); `src/game/NewYear.ts` (META hunk: `CAMERA_KEYS`); new `src/ui/HintBar.ts`.

**Acceptance**
- A 40 px left drag with Query moves the camera and opens no inspector. A click still inspects.
- `code: 'KeyA'` with `key: 'q'` pans left and does not rotate; `code: 'KeyQ'` with `key: 'a'` rotates.
- `{code: 'Digit2', key: 'é'}` sets speed 2.
- `{code: 'KeyS', key: 'o'}` pans and does not open Data views.
- `{code: 'Equal', key: '='}` grows the brush; `{key: 'Backspace'}` selects bulldoze.
- During a New Year cinematic, `{code: 'KeyW', key: 'z'}` hands the camera back.
- The hint hides after one pan and one zoom, and does not show in a third session.
- Persona P-5 pans, rotates and zooms with a trackpad only, and changes speed on AZERTY.

**Depends on.** None. Rebase on render round 2 if its zoom-hitch work touched `CameraController.ts`.

**Risk.** A left drag with Query used to do nothing, so no habit breaks.

#### FEEL-08 · Camera flights instead of smears for Jump and Focus
P2 · S · WORLD · round 1

**Problem**
- **Every jump only moves the goal.** `CityScene.focusCell` (`:972-980`) calls `focusOn` (`CameraController.ts:142-147`), and the damping covers 4 km in about 0.4 s as a smear (`shots2/041`).
- **Four callers go through `focusCell`**: the emergency banner, toasts, the ticker and the advisors' "Show me". **The minimap calls `focusOn` directly**, on pointerdown and on every pointer move while dragging (`MiniMap.ts:58-75`).

**Change**
- **`focusOn(x, z, d, {fly: true})` for trips over 500 m**: 0.6 s + 0.25 s per km, at most 1.6 s, eased with smoothstep. Flying is opt-in: `focusOn` without the option stays instant.
- **`focusCell` flies.** The minimap flies only on a click (its pointerdown); its drags keep calling the instant `focusOn`, and the first drag move cancels any flight.
- **The camera rises mid-flight** to max(start, end, 0.5 × trip length), so the player sees where it is going.
- **Any input cancels the flight.** The existing whoosh (`CityScene.ts:974`) is stretched to the flight. With reduced motion (FEEL-21) a 150 ms fade replaces it.

**Files.** `src/render/world/CameraController.ts`; `src/render/contracts.ts` (the option); `src/game/CityScene.ts` (WORLD hunk: `focusCell`); `src/ui/MiniMap.ts` (META: the pointerdown call passes `{fly: true}`).

**Acceptance**
- A 4 km jump takes 1.2–1.6 s, its peak distance is at least 1.5× the end distance, and it ends within 1% of the target.
- A 300 m jump behaves as today.
- A drag during a flight stops it within one frame.
- A minimap drag tracks the pointer with no flight; a minimap click more than 500 m away flies.

**Depends on.** Render round 2 (`CameraController.ts`); W0.5 for the minimap hunk.

**Risk.** None for the gates.

#### FEEL-04 · Blackouts you can see
P2 · M · WORLD · round 1

**Problem**
- **No render code reads `BF.Powered`.** The building state key has no power bit (`BuildingRenderer.ts:1427-1431`), and only abandonment turns windows off (`:1564`).
- **A blackout is invisible.** In the factors probe, 837 of 1,669 homes and 272 of 596 shops went dark, and the city fell from 174.7k to 110.4k people in 30 days (approval 77.8 → 75.4; a 10-day blackout cost 49%). The skyline stayed lit throughout.
- **The sim already announces each flip**: `buildingChanged` fires for every building whose power flag changes (`utilities.ts:509-514`).

**Change**
- **Dark windows.** Unpowered buildings that need power get `IF_WINDOWS_OFF` and a 10% darker day tint, updated in place (the batch's colour and alpha, no rebuild).
- **A visible wave.** The change staggers outward from the plant over 0.6 s, with 1 sim day of hysteresis so a flickering grid doesn't strobe.
- **Street-lamp pools fade on unpowered roads.**
- **A new "power down" sound** when 20% or more of homes lose power at night.

**Files.** `src/render/city/buildings/BuildingRenderer.ts`, `src/render/city/common/cityMaterial.ts`, `src/render/city/props/PropRenderer.ts` (lamp pools), `src/audio/sfx.ts`.

**Acceptance**
- On a 20k save at 22:00, at least 90% of unpowered buildings go dark within 2 s, and the night luma of the district drops by 35% or more.
- Power restored: windows return within 2 s of rebuilding the plant. Parks are unchanged.
- A 1,000-building flip keeps every frame under 20 ms.

**Depends on.** R2-NIGHT (the night-window LOD patch); Worker R2, which budgets `BuildingRenderer.add` in the same file. It stays in round 1 only if D13 pulls R2 forward; otherwise it moves to round 2.

**Risk.** Frame spikes on big flips, held by the stagger and the acceptance.

#### FEEL-14 · Bulldozing and placement with weight
P2 · M · WORLD · round 2

**Problem**
- **Bulldozed buildings vanish in one frame**: `remove` frees the instances at once (`BuildingRenderer.ts:1460-1476`). Only the bulldoze sound marks it.
- **Redevelopment blinks**: a growable is swapped for a bigger one between two frames (`tryRedevelop`, `growth.ts:674`).
- **Plopped buildings pop in** with no ground contact.
- **The dust particle exists** but is used only for construction (kind 4, `Effects.ts:303-305`).

**Change**
- **A collapse.** A detached copy of the removed instance sinks to 15% of its height with a slight tilt over 0.35 s, with a dust cloud of 16–40 particles living 2.5 s.
- **Limits.** More than 30 buildings at once share one merged cloud. Nothing plays beyond 2,200 m. Redevelopment plays at most 4 per second.
- **A landing ring** for plopped buildings (lives 1.2 s), and an ash puff when rubble is cleared.

**Files.** `src/render/city/buildings/BuildingRenderer.ts`, `src/render/city/effects/Effects.ts`, `src/render/city/CityObjectsView.ts`.

**Acceptance**
- A 2×2 house bulldozed at 300 m shows 1.5–2.5 s of dust.
- A 200-building drag adds under 4 ms and at most 600 particles (the pool holds 7,000 smoke particles).

**Depends on.** Worker R2 (`BuildingRenderer.ts`; D13).

**Risk.** Building ids are reused, so the collapse copy must not be keyed by id.

#### FEEL-15 · Smoke that reads output
P2 · S · WORLD · round 2

**Problem**
- **Smoke ignores load.** `operating = !constructing && !abandoned && !burnt` (`Effects.ts:261`).
- The coal plant at 15% load smokes at full plume, while its inspector already says "Smoke by load" (`shots2/i01`).
- A refinery with 0 of 340 jobs filled still smokes (`shots2/041`).

**Change**
- **A `BuildingVisual.activity` value**:
  - industry: jobs filled / capacity, times powered;
  - plants: max(0.25, the plant's share of its grid's load);
  - 0 when unpowered or under 10% staffed.
- **Four steps** of plume strength; emitters rebuild only when the step changes.

**Files.** `src/render/city/effects/Effects.ts` (`onBuilding`), `src/render/city/buildings/BuildingRenderer.ts` (`BuildingVisual`).

**Acceptance**
- The 0/340 refinery shows no smoke.
- The 15% coal plant shows at most 40% of its full-load particles.
- Emitters rebuild at most once per building per month.

**Depends on.** Worker R2 (`BuildingVisual` lives in `BuildingRenderer.ts`; D13).

**Risk.** None for the gates; render only.

#### FEEL-17 · Uncollected garbage shows on the street
P2 · M · WORLD (CONTENT builds the bag props) · round 2

**Problem**
- **The sim tracks it**: `BF.NoGarbage` (`CityState.ts:42`).
- **The UI says it loudly**: "garbage at the homes of 98% of residents" (`shots2/027`), and the news repeats three times (PB-GARBAGE).
- **The world shows nothing.**

**Change**
- **Bags and bins at the kerb.** 1–4 instanced bags or bins at the road front of each NoGarbage lot, drawn below 900 m only. They build up over 1–2 months and clear the same way.
- **Two prop variants** (CONTENT).

**Files.** `src/render/city/props/PropRenderer.ts`, `src/render/city/CityObjectsView.ts`; `src/assets/builders/prop.ts` (CONTENT).

**Acceptance**
- At 300 m, bags show at 90% or more of NoGarbage lots.
- At least 90% are gone within 2 months of connecting a landfill.
- On the 287k save: +1 draw call and at most 5% more triangles.

**Depends on.** PB-GARBAGE.

**Risk.** Triangle cost on big saves, held by the distance cut and the acceptance.

#### FEEL-18 · Abandonment reads at a glance
P2 · M · WORLD (CONTENT draws the sign) · round 3

**Problem**
- **Abandonment is a flat 0.46 tint with the windows off** (`BuildingRenderer.ts:1564`, `:1593`).
- It matters: abandonment peaked at 2.76% of buildings on seed 11 (acceptance r3).

**Change**
- **A new instance flag `IF_ABANDONED`** (bit 3, value 8; `cityMaterial.ts:21-27` uses bits 0–2) drives:
  - boarded windows;
  - 20% desaturation with grime;
  - darker roofs and weedy lawns;
  - a "For lease" sign on stage 2 and up.
- **The flat tint is dropped.**

**Files.** `src/render/city/buildings/BuildingRenderer.ts`, `src/render/city/common/cityMaterial.ts`, `src/assets/materials.ts` (WORLD); `src/assets/builders/prop.ts` (CONTENT, the sign).

**Acceptance**
- A reviewer picks out the abandoned buildings in at least 9 of 10 A/B shots at 300 m and 700 m.
- The look survives the proxy LOD.
- Abandoned buildings stay dark at night.

**Depends on.** R2-NIGHT; Worker R2 (`BuildingRenderer.ts`).

**Risk.**
- Shader cost, measured in the R3 perf check.
- `IF_ABANDONED` takes the last free instance-flag bit: `flagsToAlpha` packs `flags & 15` (`cityMaterial.ts:21-27`). Later per-building looks (NEW-02's unreachable tint, FEEL-28) use the overlay uniform path or a per-instance attribute instead.

#### FEEL-16 · Polluted districts look polluted: local smog haze
P3 · M · WORLD · round 4

**Problem**
- **There is one global haze**: `uHaze` is a constant 0.00002 (`PostFX.ts:32`, `:67`, `:327`). The only local tint is the night city glow (`Sky.ts:595-598`).
- **Dirty air never looks bad**, though it costs approval every month (pollution −3.5 in 2060, `G_256x60_s7`).

**Change**
- **A smog value** sampled at 2 Hz: the share of Polluted buildings within 32 cells of the camera target, blended with the city's air history and eased over 3 s.
- **What it does.** Haze × (1 + 2.5 × smog). Above 0.25 a brown-grey tint (0.55, 0.50, 0.42) and a dimmer sun.
- **Limits.** Off in data views; on Low only the haze density changes. It reads building flags, not the pollution layer.

**Files.** `src/render/world/PostFX.ts`, `src/render/world/WorldView.ts`, `src/render/world/Sky.ts`.

**Acceptance**
- Over a dirty district (60% or more Polluted) the R−B of the frame rises by 6 levels or more.
- No change when nothing is polluted.
- One uniform added.

**Depends on.** None.

**Risk.** None for the gates; render only.

#### FEEL-28 · Optional problem icons over troubled buildings
P3 · M · WORLD · round 4

**Problem**
- **Problems are found only by clicking or in data views.** A lot with no road, power or water says so only in the inspector (`newplayer/063`).
- **No code in `src/render` or `src/game` draws a marker over a building** (no sprite, billboard or marker class).

**Change**
- **Icons** for no power, no water, no road, abandoned and no garbage.
- **Limits.** Below 700 m only, at most 300, hidden in data views and photo mode.
- **A setting**: off / with the Query tool (default) / always.

**Files.** New `src/render/city/StatusIcons.ts`; `src/render/city/CityObjectsView.ts`; `src/render/city/buildings/BuildingRenderer.ts`.

**Acceptance**
- At 400 m, 95% or more of the troubled buildings in view show their icon.
- At most 1 draw call and 0.3 ms a frame.

**Depends on.** FEEL-04; Worker R2 (`BuildingRenderer.ts`).

**Risk.** Clutter, held by the default (Query tool only).

#### FEEL-07 · Spotlight camera for the city's firsts
P3 · M · WORLD (CONTENT records the firsts) · round 4

**Problem**
- **The only cinematic is New Year** (`NewYear.ts` `camStart`/`camStop`, `:488-650`).
- **Firsts happen off camera**: the first unique building (`actions.ts:612-614`), the first tower, the first neighbour connection. The camera usually sits 600–1,200 m out (`shots2/082`, `091`).

**Change**
- **A shared show camera.** Extract `src/game/ShowCamera.ts` from `NewYear.ts`; WORLD owns `NewYear.ts` in round 4 for this.
- **The spotlight plays** on the first stage 6, 7 and 8 building, unique openings and the first neighbour connection. The firsts are recorded in `systemData.firsts` (CONTENT).
- **When it may play**: only after at least 4 s without input, with no drag, no LIVE emergency and no New Year show.
- **What it does**: 2 s in to a 30° view at 280–450 m, a 25° orbit over 4 s, then 2.5 s back, with a caption. Any input ends it.
- **A "Camera moments" setting.**

**Files.** New `src/game/ShowCamera.ts`; `src/game/NewYear.ts` (round 4); `src/game/CityScene.ts` (WORLD hunk).

**Acceptance**
- It arrives within 2.5 s and is back within 9 s, within 1 m and 1% of the start view.
- Input returns control within a frame.
- It plays once per kind per city, across save/load.

**Depends on.** FEEL-06, FEEL-08, PB-NEWYEAR.

**Risk.** Taking the camera unasked, held by the idle rule and the setting.

#### FEEL-27 · A founding fly-in with a title card
P3 · S · WORLD · round 4

**Problem**
- **A new city appears with an instant cut** to its start view (`CityScene.placeInitialCamera`, `:523-536`; `cameraStart.ts`).
- **The `cityReady` sound plays at load** (`main.ts:578`), not at a moment on screen.

**Change**
- **A fly-in.** A new city starts at 3× the start distance and descends in 2.5 s.
- **A title card**: "Queensbury · Founded April 2000 · Mayor Maya Vance".
- **`cityReady` is timed to the landing** (META moves the call).
- **Any input skips it.**

**Files.** `src/game/CityScene.ts` (WORLD hunk: `placeInitialCamera`); `src/game/cameraStart.ts`; `src/main.ts` (META).

**Acceptance**
- It starts at 3× or more of the start distance and reaches the start view in 2.5–3 s.
- Saved cities open exactly at their stored camera.

**Depends on.** FEEL-05, FEEL-08.

**Risk.** None.

#### FEEL-24 · Photo mode
P3 · S · WORLD · round 4

**Problem**
- **There is no way to hide the HUD.** 'h' is free, and the renderer can already capture the frame (`world.capture`, `CityScene.ts:925`).

**Change**
- **H toggles photo mode.** The HUD fades out in 200 ms.
- **A small bar** with a time-of-day scrubber (it overrides `fixedHour`), pause, Capture (a PNG up to 4096 px, named "{city}-{date}.png") and Exit.

**Files.** `src/game/CityScene.ts` (WORLD hunk: `onKey`); new `src/ui/PhotoBar.ts`; new `src/ui/fx.css`.

**Acceptance**
- Leaving photo mode restores the layout exactly.
- Capture delivers the PNG within 1 s.
- The clock returns to the game time.

**Depends on.** None.

**Risk.** None.

#### FEEL-25 · Street life: pedestrians at close zoom
P3 · L · WORLD · round 4

**Problem**
- **Streets are empty at close zoom.** The only people are static riders at bus stops (`assets/builders/transport.ts:73-76`; `cmp/tp_jun13_dt_street_AB.png`).

**Change**
- **Walkers** in a dynamic batch within 350 m of the camera. Density comes from customers, visitors and riders by time of day.
- **Umbrellas on rain days** (FEEL-23).
- **The existing 20-triangle pedestrian** (`transport.ts:79`) in 4 coat colours.
- **Limits**: at most 600 instances, none beyond 600 m.

**Files.** New `src/render/city/Pedestrians.ts`; `src/render/city/CityObjectsView.ts`.

**Acceptance**
- In a 50k city at 120 m, 20 or more walkers by day, and at most 20% of that at 3 am.
- At most 0.8 ms and 1 draw call.

**Depends on.** The Worker (W1.x: it reads streamed data, not sim state).

**Risk.** Frame cost, held by the limits.

#### FEEL-23 · Weather moments that match the headlines
P3 · L · WORLD (CONTENT gates the headlines) · round 4

**Problem**
- **There is no weather code.**
- **Towns never see snow.** The snow line sits at max(165 m, 78% of the highest point) on temperate maps (`TerrainRenderer.ts:258-262`), so only peaks turn white.
- **Yet the headlines talk weather**: "April showers", snowball fights and snow days (`advisors.ts:516-521`).

**Change**
- **A pure `weather(day, seed)` function**: rain spells in spring and autumn, snowfall days in December–February, haze in the desert. It makes no RNG draw from the sim.
- **What the player sees and hears**: particles, a darker sky, wet roads, a dusting on roofs and a rain bed in the ambience.
- **Headlines follow it**: weather headlines only on matching days.

**Files.** New `src/render/world/Weather.ts`; `src/render/world/WorldView.ts`, `Sky.ts`; the road material; `src/audio/ambience.ts`; `src/sim/economy/advisors.ts` (CONTENT hunk).

**Acceptance**
- Flakes and the snow headline fall on the same day.
- Rain shows the road sheen and plays the rain bed.
- At most 0.5 ms of GPU at 1080p on High.
- Bot hashes are unchanged outside advice: weather headlines change which bag headline fits, so the check compares hashes without `news` and `systemData.advisors` (FH-03's rule).

**Depends on.** R2-SEASONS.

**Risk.** GPU cost, held by the acceptance.

#### FEEL-29 · Rare sightings
P3 · M · WORLD and CONTENT · round 4

**Problem**
- **Nothing in the world surprises a long-time player.**
- **The headlines hint at things nobody sees**: the mountain goat (`advisors.ts:525`) and Gerald (`:496`).

**Change**
- **Five rare sightings**: hot-air balloons, a whale off the coast, a blimp, an observatory light, and Gerald's ribbon cutting.
- **Each comes with its headline.** The pick uses a hash of the day; clicking the headline flies there.

**Files.** New `src/render/city/Sightings.ts` (WORLD); `src/sim/economy/advisors.ts` (CONTENT hunk: the headlines).

**Acceptance**
- Each sighting appears at most twice in 30 game years, always with its headline.
- No sim change: bot hashes are unchanged when compared without `news` and `systemData.advisors` (FH-03's rule; the sighting headlines are news).

**Depends on.** FEEL-01, FEEL-08, FEEL-20.

**Risk.** None.

### J. Audio

#### FEEL-11 · Audio mix: ducking, siren fatigue, song rests
P2 · M · WORLD · round 1

**Problem**
- **Nothing ducks the music.** Bus gains are static (`applyVolumes`, `AudioEngine.ts:409-420`): at the defaults the music bus sits near −11 dB and the SFX bus near −4 dB (`DEFAULT_PREFS`, `:70`). Tracks are mixed to −18 LUFS (`music/types.ts:22`), while events and fanfares are trimmed to −23..−25 LUFS (`sfx.ts:11-13`), so a milestone fanfare plays under a loud chorus.
- **The New Year countdown plays over the music.**
- **Sirens never stop in a big city.** The nearest source of each kind within 1,400 m sounds (`sirens.ts:45-46`, `:64`). At 1.29M the bot city answers 742 incidents a year automatically, 727 of them medical (`G_256x60_s7`, 2050): about 4 new ones per real second at 1× and 41 at ultra.
- **Songs run back to back** with a 5 s crossfade and no rest (`XF_AUTO`, `music/director.ts:88`, `:440-445`).
- **Music plays on in a background tab.** `pauseWhenHidden` pauses the simulation (`CityScene.onVisibility`), but nothing calls `AudioEngine.suspend()` (`AudioEngine.ts:394`), and the music director keeps scheduling with a 4 s lookahead while hidden (`music/director.ts:4`, `:171`).

**Change**
- **`duck(db, hold, release)`.** Sounds of 0.6 s or longer duck the music by 6 dB (60 ms attack, 600 ms release, at most once per 2 s) and the ambience by 3 dB.
- **New Year ducks the music by 14 dB** from the countdown to 4 s after the last burst. META adds the call in `NewYear.ts` in round 2.
- **Sirens.**
  - Only sources in the view frustum plus 150 m, and at most 2 voices.
  - Automatic responses beyond 600 m are silent.
  - Units the player dispatched are always audible. Telling them apart needs W0.2's cause tags and W0.5's `EmergencyView`; today `feedSirens` reads `EmergencyVehicles.sirenSources`, which carries no dispatcher (`CityScene.ts:1051-1070`). So this sub-part waits for both.
- **Rests between songs** of 15–40 s, with a setting (default: with pauses).
- **"Mute when in background"** (default on): the master gain fades to 0 when the tab is hidden and the engine suspends; it resumes on return.

**Files.** `src/audio/AudioEngine.ts`, `src/audio/sirens.ts`, `src/audio/music/director.ts`, `src/game/GameSounds.ts` (WORLD part); `src/game/CityScene.ts` (WORLD hunk: `feedSirens`, after W0.5); the setting key in §7.5.

**Acceptance**
- `tools/render-audio.mjs` shows the music 6 ± 1 dB lower under a fanfare and back within 1 s.
- In a 2-minute ultra window at 1.3M, sirens are above −40 dB for at most 30% of the time.
- During the New Year countdown the music is at least 12 dB below its normal level.
- Gaps of 15–40 s between songs in the city, none in the menus.
- The master gain reaches 0 within 1 s of the tab being hidden.

**Depends on.** None for the ducking, the rests and the background mute (`src/audio/**` only, so they can start now). The siren sub-part depends on W0.2 and W0.5. META's New Year call lands in round 2.

**Risk.** None for the gates; audio only.

#### FEEL-12 · City ambience: surf, seasons and climate
P2 · S · WORLD · round 1

**Problem**
- **The surf layer is built but never fed.** `AmbienceParams.water` drives it (`ambience.ts:16-17`, `:139-153`, `:204`), but neither caller passes `water` (`CityScene.ts:1033`, `main.ts:536`).
- **The ambience has no seasons or climates**: the same birds by day and crickets by night all year, in every climate (`ambience.ts:1-20`, `:213-222`).

**Change**
- **Feed the surf.** Sample a 9×9 grid of water cells around the camera target every 0.5 s. Also pass the month and the climate.
- **Seasons and climates**:
  - birds at full strength April–August, half in March, September and October, 15% from November to February;
  - crickets on nights from May to September, all year in the desert;
  - wind +40% from December to February and on alpine maps;
  - gulls when water fills more than 30% of the sample.

**Files.** `src/audio/ambience.ts`; `src/game/CityScene.ts` (WORLD hunk: `updateAmbience`).

**Acceptance**
- At the beach at 300 m the surf gain is above 0.1.
- January birds play at most a quarter as often as July birds.
- No crickets on January nights; crickets on desert nights.

**Depends on.** None, so it can start now; its small `CityScene.updateAmbience` hunk rebases on the Worker steps that edit `CityScene.ts` (W0.1, W0.2, W0.5, W0.6).

**Risk.** None.

#### FEEL-13 · Hear what the camera is over
P3 · M · WORLD · round 4

**Problem.** The ambience depends only on population, zoom, night, construction and game speed (`ambience.ts:7-20`; surf is never fed, FEEL-12). An industrial park, a park full of children, the airport and the harbour all sound the same.

**Change**
- **A 7×7 land-use sample** below 700 m, crossfading over 1.5 s between up to 4 layers: industry, parks and children, the downtown crowd, airport jets every 30–60 s, train rumble and horns, harbour gulls and horns.
- **People layers are halved at night.**

**Files.** `src/audio/ambience.ts`; `src/game/CityScene.ts` (WORLD hunk: `updateAmbience`).

**Acceptance**
- The dominant layer switches within 2 s of moving over a new district.
- Above 1,500 m every location layer is at least 18 dB down.
- At most 6 extra audio nodes, and over 2 minutes of moving between districts no layer's gain steps by more than 1 dB within 100 ms (measured with `tools/render-audio.mjs`).

**Depends on.** FEEL-12.

**Risk.** None.

### K. Access and settings

#### FH-21 · The first run picks a graphics quality the machine can carry, and survives a lost context
P1 · S · META · round 1

**Problem**
- **Every first run starts on High, whatever the machine.** `detectQuality()` exists (`quality.ts:167-174`: mobile → Low, under 8 cores → Medium) but nothing calls it; it is only re-exported (`WorldView.ts:29`). The app default is `quality: 'high'` (`region/settings.ts:19`), passed to the scene by `main.ts:542`.
- **The game never notices a slideshow.** The playtest machine ran at 2–7 s a frame until the tester found Graphics → Low (`playtest`, test environment; `shots2/011`). That machine used software rendering under load, so it is an upper bound, but a weak laptop on High meets the same silence.
- **A lost graphics context is not handled.** There is no `webglcontextlost` listener anywhere in `src`; the only WebGL check runs at start-up (`CityScene.ts:471`). A driver reset or a GPU-starved laptop leaves a frozen or black city with the simulation still running.

**Change**
- **On the first run only**, the app default comes from `detectQuality()`.
- **A one-time prompt.** After 20 s at a median under 25 fps on High or Ultra, one toast: "The city is running slowly — switch graphics to Medium?" with Switch and Keep. The answer is remembered.
- **Context loss.** On `webglcontextlost` the game pauses the simulation, saves, and shows "Graphics reset — Restore". Restore rebuilds the WorldView (and the city views) on a fresh context, or on `webglcontextrestored`.
- **Load time is recorded.** The time from "Found City" to the first interactive frame goes into the fps counter's log, so persona P-5 can report it.

**Files.** `src/region/settings.ts`, `src/main.ts`; `src/game/CityScene.ts` (META hunk: the slow-tick fps check and the context-loss handler).

**Acceptance**
- A first run with 4 cores starts on Medium; with 8 cores on High.
- An existing profile keeps its setting.
- The prompt shows at most once per profile.
- `WEBGL_lose_context.loseContext()` pauses the game, saves, and shows the card. Restore brings back a working view at the same camera, and the city's state hash is unchanged.
- P-5's report includes the time to the first interactive frame on its 4-core profile.

**Depends on.** Re-tune the thresholds after W1.4 (the sim leaves the main thread).

**Risk.** None for the gates.

#### FH-23 · Text that can actually get bigger, and tips keyboard focus can open
P2 · S · META (GUIDE adds the focus handlers) · round 2

**Problem**
- **The UI can't grow at 1280 px wide.** `computeUiZoom` caps the zoom at width / 1280 (`zoom.ts:14-19`). At 1280×720 the automatic zoom is 0.8 and the cap is 1.0, so the UI scale slider (`SettingsPanel.ts:96`, 70–150%) can enlarge text by at most 25% there.
- **The labels are small to begin with.** `hud.css` has 63 font sizes between 9 and 11.9 css px, which render at 7–9.5 px at zoom 0.8. Even at +30% the 9–11.5 px rules would render at 9.4–12 px, and an 11 px css floor renders at 8.8 px.
- **Dialogs ignore the scale.** It is set only on the city HUD root (`CityScene.ts:760-772`), so the title, region and New City screens never scale.
- **The settings can't be reached before the first city.** The title-screen Settings has only audio, default quality, autosave, edge scrolling and FPS (`region/ui/dialogs.ts:16-95`). UI scale, and the new motion, colour-vision and text-size settings, would exist only in the in-city panel (`SettingsPanel.ts:76-105`).
- **Some information is hover-only.** Approval row details are `title` attributes (`TopBar.ts:504`), toolbar tips open only on `pointerenter` (`Toolbar.ts:48-49`, `:278-279`), and the top-bar segments are click-only `div`s that Tab never reaches.

**Change**
- **A Text size setting**: +10%, +20% or +30%, applied as a font-size multiplier on top of the zoom cap. Its floor is set in rendered pixels: at +30% no text renders under 12 px, so the css floor is 12 px ÷ zoom (15 px at zoom 0.8).
- **It applies everywhere**: the HUD, the title, the region screen and the New City dialog.
- **An "Accessibility & interface" section in the title-screen Settings** (`dialogs.ts`): UI scale, text size, motion (FEEL-21) and colour vision (FH-20), from the same §7.5 schema, plus "Reset to defaults".
- **Keyboard focus shows the same tips as hover** (GUIDE): the top-bar segments become focusable buttons, and `focus` opens what `pointerenter` opens on the top bar and the toolbar.

**Files.** `src/ui/zoom.ts`; `src/game/CityScene.ts` (META hunk: `resize`); `src/ui/hud.css` (META: the global rules); `src/region/ui/meta.css`; `src/region/settings.ts`; `src/region/ui/dialogs.ts` (the new section); the TopBar segments and `src/ui/Toolbar.ts` (GUIDE: focus handlers).

**Acceptance**
- At 1280×720 with +30%, no text renders under 12 px and the top bar still fits on one line. The "13 px" first proposed cannot be met by a css floor at zoom 0.8: it would need 16.25 css px.
- The New City dialog grows with the setting.
- On a fresh profile, text size, UI scale, motion and colour vision can be set from the title screen, and the first city opens with them.
- Tabbing through the top bar and the toolbar shows every tip that hover shows.

**Depends on.** PB-DIALOG, PB-DATAVIEWS (the 720p layout fixes); the TopBar split (§7.4).

**Risk.** Overflow in dense panels, checked by persona P-5.

#### FEEL-21 · Motion and flashing settings (absorbs FH-24)
P2 · S · META (WORLD makes its effects obey) · round 2

**Problem**
- **No code reads `prefers-reduced-motion`** (no `matchMedia` anywhere in `src`).
- **Moving and flashing things a player can't turn off**:
  - the earthquake shake, repeated every 1.2 s for as long as a quake lasts (`CityScene.ts:715-729`);
  - the New Year camera;
  - the emergency icon flashing at 1 Hz (`emergency.css:24-31`);
  - the scrolling ticker.

**Change**
- **`settings.motion`** follows the OS setting by default (`matchMedia('(prefers-reduced-motion: reduce)')`).
- **Reduced means**:
  - no camera shake;
  - camera flights and spotlights become 150 ms fades or are skipped;
  - no New Year camera, and fireworks flashes at half strength;
  - steady emergency colours instead of flashing;
  - toasts fade without moving;
  - a static ticker.
- **How**: a `.mp-ui.reduced-motion` class plus an `@media (prefers-reduced-motion: reduce)` block. WORLD's camera and effects read the setting.

**Files.** `src/game/settings.ts`, `src/region/settings.ts`, `src/ui/panels/SettingsPanel.ts`, `src/region/ui/dialogs.ts` (the title-screen "Accessibility & interface" section, FH-23), `src/ui/hud.css` (META); `src/ui/emergency.css` (WORLD owns it in round 2 and adds the steady-colour rules); the camera and effects code (WORLD).

**Acceptance**
- With the OS set to reduced motion, the setting reads "Reduced".
- A quake moves the camera 0 m.
- No animation lasts over 200 ms and nothing flashes more than 3 times a second.
- Switching back restores everything.

**Depends on.** FEEL-08 (flights to replace), FH-19 (hint bar), FEEL-01 (ticker).

**Risk.** None.

#### FH-20 · Colour-blind safe views
P2 · M · WORLD (META adds the settings rows) · round 3; the Emergency palette in round 1

**Problem**
- **Key colour pairs collapse under red-green colour blindness.** RGB distance on the theme and legend tokens, normal and after the Machado 2009 simulation at full severity, applied in linear RGB (in gamma space the numbers differ: R vs I gives 99, not 77):

  | pair | normal | deuteranopia | protanopia |
  |---|---|---|---|
  | residential vs industrial zones | 192 | 77 | 99 |
  | Emergency view: automatic vs just out of reach (`overlays.ts:190-191`) | 183 | 66 | 56 |
  | Emergency view: automatic vs must dispatch | 195 | 79 | 124 |
  | desirability, low end vs high end | 201 | 47 | 85 |
  | good vs bad (HUD) | 223 | 46 | 101 |
  | residential vs commercial (fine) | 161 | 213 | 202 |

  Under tritanopia, residential vs commercial falls to 30, the case the Blue-yellow safe mode is for.
- **There is no colour-vision setting** (`SettingsPanel.ts:95-98`), and the title screen has no place for one (`region/ui/dialogs.ts:16-95`).
- **The Zones legend misnames and omits zones.** It names dirty industry "Industrial (low)", while the tool says "Industrial · Medium density" (`render/world/overlays.ts:238` vs `ZoneTool.ts:19`). It also lists no Agriculture and no medium densities (`overlays.ts:233-240`), although the tool has all nine zones (`ZoneTool.ts:10-21`).

**Change**
- **A Colour vision setting**: Standard, Red-green safe, Blue-yellow safe. Each swaps the theme tokens and the overlay ramps. It sits in the in-city panel and in the title screen's "Accessibility & interface" section (FH-23), from the same §7.5 key.
- **Emergency colours that work for everyone, in round 1** with FH-08: blue = automatic, orange = out of reach, magenta = must dispatch, grey = no coverage. This is the ramp and legend in `render/world/overlays.ts` only, a file no in-flight phase edits.
  - A palette that meets the target: `#2a7de1`, `#f5a623`, `#9b1d6a`, `#c8ccd2`.
  - Its closest pair is 135 apart under deuteranopia and 138 under protanopia, against 66 and 56 for today's automatic vs out of reach.
- **Shape as well as colour, in round 3**: hatching on "must dispatch" in all modes, and zone patterns in the safe modes. These need the terrain overlay shader (Worker R1, W0.5, render round 2).
- **The legend lists every zone**: Residential (low, medium, high), Commercial (low, medium, high), Agriculture, Industrial (medium), Industrial (high), Landfill, with the tool's names.

**Files.** `src/ui/theme.css`, `src/render/world/overlays.ts`, `src/ui/overlays.ts`, `src/render/world/TerrainRenderer.ts` (WORLD); `src/ui/panels/SettingsPanel.ts`, `src/region/ui/dialogs.ts`, `src/game/settings.ts`, `src/region/settings.ts` (META).

**Acceptance**
- In the safe mode, all five problem pairs are 120 or more apart under both deuteranopia and protanopia (Machado 2009, linear RGB). The Emergency pairs pass in every mode from round 1.
- The legend names match the tool names, and all nine zones and the landfill are listed.
- Screenshots of the zone, Emergency and desirability views in both modes are attached to the round report.

**Depends on.** Render round 2 (overlay and terrain shaders); Worker R1 and W0.5 for the hatching (`TerrainRenderer.ts`). The round-1 palette depends on nothing in flight.

**Risk.** None for the gates.

#### FH-25 · Rebindable keys
P3 · M · WORLD (META adds the Settings button) · round 4

**Problem**
- **Keys are fixed** (`Modals.ts:150-210` lists them).
- **R does two things**: the residential zone cycle (`toolCatalog.ts:227`) and rotate in the Plop tool (`PlopTool.ts:221`).

**Change**
- **A key bindings panel** with conflict warnings and a reset, saved per profile (new `src/game/bindings.ts` and `src/ui/panels/KeyBindingsPanel.ts`).
- **Help shows the live bindings.**

**Files.** `src/game/toolCatalog.ts` (WORLD hunk: `HOTKEY_CYCLES`, `PANEL_HOTKEYS`); `src/game/CityScene.ts` (WORLD hunk: `onKey`); `src/render/world/CameraController.ts`; `src/ui/panels/SettingsPanel.ts` (META: the button).

**Acceptance**
- Binding Bulldoze to X flags the conflict with De-zone.
- Help shows the rebound key.

**Depends on.** FH-19 (`e.code` movement).

**Risk.** None.

### L. Voices and stories

#### FEEL-20 · Headlines that react to what the player just did
P3 · M · CONTENT · round 4

**Problem**
- **70 headlines come from a bag** every 40–100 days (`advisors.ts:488-566`, `:1341-1349`). They react to the city's state, never to an event.
- **Some contradict the world**: snowball fights and snow days in towns that never see snow (`advisors.ts:516-517`; FEEL-23).

**Change**
- **About 25 event headlines**, posted 1–10 days after the event and at most once per type per year: openings, saves, blackouts, firsts, strikes, an averted bankruptcy, the 100th park.
- **Serial stories**, such as Gerald's.
- **Snow headlines only where snow is visible**, or on FEEL-23 snow days.
- **No extra RNG draws.** The pick is a hash of (day, event). Today's headline draws (`rng.int` + `rng.next`, `advisors.ts:1343-1346`) stay exactly as they are.

**Files.** `src/sim/economy/advisors.ts` (CONTENT hunk: headlines); new `src/sim/economy/eventHeadlines.ts`.

**Acceptance**
- A landmark opening gets its headline within 10 days in 10 of 10 trials.
- A blackout gets exactly one headline.
- No headline repeats within 360 days.
- A 256×20 s7 run gives the same hashes when compared without `news` and `systemData.advisors` (FH-03's rule). Event headlines write news and the advisors' bag, which the audit hash includes, so full bit-identity is not expected.

**Depends on.** FEEL-01.

**Risk.** Determinism, held by the hash pick and the acceptance.

#### FEEL-22 · Residents speak: named households and quotes
P3 · M · CONTENT · round 4

**Problem**
- **Residents are anonymous.** The inspector's Residents section lists counts and needs only (`InfoPanel.ts:411-415`).
- **Advisors have names and faces** (`shots2/027`), and the name pools and the needs report already exist (`region/names.ts:25-58`; `needsOf`, `demographics.ts:534`).

**Change**
- **A Household card** in the inspector: a stable family name from a hash of the building, the household's make-up, the commute, and one quote from its worst unmet need ("If only the bus stopped closer.").
- **A resident quote in the ticker** about every 2 game months, at most once per 3 real minutes, through `ticker.push`. Clicking it focuses the home.
- **UI side only**: no sim state, no RNG draws.

**Files.** New `src/ui/residentVoice.ts` (`householdCard(b)`); `src/ui/panels/InfoPanel.ts` (GUIDE inserts one line).

**Acceptance**
- The same home shows the same name after save/load.
- 9 of 10 homes with an unmet school need quote about school.
- Clicking a ticker quote focuses the home.

**Depends on.** FEEL-01 (`ticker.push`).

**Risk.** None.

## 4. Onboarding and tutorial

This section is the full first-hour flow. FH-01, FH-02, FH-08, FH-11, FH-12, FH-13 and FH-18 implement it; their acceptance criteria point here for the texts.

### 4.1 Teaching rules

- **Teach in the order the city needs things**: road, zones, power, water, play, then garbage, safety, fire cover, money, schools, data views, Why?, rewards.
- **Little at once.** At most 2 goals and 1 explainer on screen, and at most 1 new explainer per 2 game months.
- **Name the cheap, safe choice with its price**: "3 wind turbines (§800 each)", never just "a power plant".
- **One action per tip.** Each goal or explainer has one button that opens the fix, and a coach mark on the control.
- **Never blame the player.** "Your town grew faster than its fire cover", not "You failed".
- **Use the city's own numbers** ("18 of 40 tiles", "§183 a month"), read from the state, the catalog and tuning, never typed into strings.
- **Once per profile.** Each explainer shows once per profile. Help → "Tips you've seen" lists them, and a Tips on/off setting turns them all off.
- **Veterans skip in one click** (Phase E).
- **Tone.** Second person, at most 2 sentences and 30 words. The plain word comes first and the code after it in brackets: "high-wealth homes (R$$$)". Money is written with §.
- **Pausing.** On Easy an explainer card pauses the game until it is closed. On Medium and Hard only E1a pauses. Nothing shows during the New Year show.

### 4.2 Game time and the target pace

| speed | day | month | year |
|---|---|---|---|
| 1× | 0.5 s | 15 s | 3 min |
| 2× | 0.2 s | 6 s | 72 s |
| ultra | 0.05 s | 1.5 s | 18 s |

(`SECONDS_PER_DAY`, `src/core/constants.ts:34`.)

**Today's newcomers against the bot** (all Medium):

| | Queensbury (playtest) | Sunside (new player) | bot s7 (acceptance r3) |
|---|---|---|---|
| spent before Play | ≈ §48,400 (`shots2/021`) | ≈ §29,000 (`newplayer/047`, `056`) | ≈ §2,900 |
| end of year 1 | 2,430 at 45%, "+§150" (`shots2/027`, Nov 2000) | 124 at 40%, −§63/mo (`newplayer/073`, Oct 2000) | 3,470 at 53.1 |
| year 3 | 7,261 at 40% (`shots2/058`, Oct 2002) | 233 at 36%, −§84/mo (`newplayer/096`, Mar 2002) | 17,645 |
| years 6–7 | 19,944 at 49% (`shots2/i01`, Feb 2007) | 863 at 43% (`newplayer/146`, Feb 2006) | 46,762 (2006) |
| later | 19,935 at 50% (`shots2/121`, Dec 2009): flat for almost 3 years | 2,379 at 41% (`newplayer/175`, Apr 2010) | 100k by 2011 |

**The three mistakes the UI invites today**, which Phases B–D are built to prevent:
1. **An oversized power plant on day 0**: both humans bought the §25,018 coal plant (400 MW) for a town that used 21 MW three years later (`shots2/058`).
2. **Too little zoning, or zoning with no road**: step 2 ticks with roadless zones (`shots2/131`), and nothing says how much to zone (`newplayer/063`, `146`).
3. **Services the budget can't carry**: a Fire Station read ≈ §539/mo against +§259/mo of profit (`shots2/024`), and the first deficit surfaced at −§968/mo (`shots2/078`).

### 4.3 Phase A: before the city

- **A0. First run.** Graphics quality from `detectQuality()` (FH-21). The city hint bar is armed for the first 2 sessions (FH-19).
- **A1. Title screen.** With no region saved, the primary button is "Start your first city", sub-line "Guided · your first road in about 2 minutes". "New Region" comes second (FH-12).
- **A2. One-click start.** It creates a Greenvale Valley region with a unique id and founds the recommended tile on Easy, with Guided start on, Disasters off and the date 1 April (day 90, FEEL-05). One loading screen rotates three first-city tips:
  - "Start small: 3 wind turbines power your first 2,500 or so residents."
  - "Zones only grow next to roads."
  - "The game waits for you until you press Play."
- **A3. The New Region path.** The region screen outlines one tile, "A good first city". Its New City dialog preselects Easy and Guided start, shows the four difficulty lines and unticks Disasters (FH-11). "I've played city builders before" switches to Phase E.

### 4.4 Phase B: found your town

The card header reads **"Found your town"**, and under it: **"The game is paused while you build."**

| # | step | text | button | done when | hints while current |
|---|---|---|---|---|---|
| 1 | Connect to the region | "Build a road from the map edge into your town. New residents and trade arrive along it." | Road tool: selects `net:2`; a ghost road marks the nearest buildable edge | `neighborConnections.length ≥ 1`: 6 network cells reaching 3 tiles in (`connections.ts:15-18`) | "Run your road at least 3 tiles in from the edge." |
| 2 | Zone homes, shops and jobs | "Paint zones along your roads: about 40 tiles of homes (R), 8 of shops (C) and 12 of industry (I). Zoning costs §5–10 a tile." | Zones: selects Residential low (`zone:1`) and pulses R, C and I | ≥ 40 R, 8 C and 12 I cells with `lotAccess` front or yard (half on 64-cell tiles) | "Some zones don't touch a road — nothing grows there." · "Zone a bit more housing: 40 tiles of R (you have 18)." |
| 3 | Power: start with wind | "Place 3 wind turbines (§800 each) next to a road, 2 tiles apart. Each makes 3 MW on flat land, up to 7 on hills: together about 2,500 residents. Roads carry the power to your zones." The numbers are computed from the catalog and `params.ts`; the ghost shows the 2-tile spacing ring. | Wind turbine: selects `plop:util_wind_turbine` | power reaches a zoned lot (today's `zoneServed`) | today's "Your plant isn't reaching any zone yet…" · when a coal or gas plant is picked: "A coal plant makes 400 MW, enough for about 120,000 residents, for §25,000. Wind is plenty for now." |
| 4 | Water | "Place a water tower (§300, 2,500 kL a day) touching a road that runs past your zones. Pipes follow the roads. Industry and denser homes need water." | Water tower: selects `plop:util_water_tower` | water reaches a zoned lot (today's check) | today's "No zone gets water yet…" |
| 5 | Press play | "Unpause and watch your town grow. Space pauses at any time." | Play: `host.setSpeed(1, 'onboarding')`. The button appears once steps 1–4 are done; before that the step reads "Finish the steps above first — or press Space to play anyway" (today it works at 1/5, `shots2/132`) | one game day has passed (today's check) | — |

- **The numbers behind steps 3 and 4.** The bot's town of 3,470 used 10 MW and 1,352 kL a day at the end of year 1 (`G_256x60_s7`, 2001: power [18, 10], water [4936, 1352]), about 1 MW per 350 residents. A turbine makes `powerOut` 5 × (0.6 + 0.8 × smoothstep(10, 60 m above the local mean)) (`params.ts:411-415`): 3 MW on flat land, up to 7 MW on a hilltop (`catalog.ts:255-257`). The bot's 18 MW from 3 turbines came from its hilly map (`hilliness: 0.25`, `simbot.ts:224`), about 6 MW each. On FH-11's flat tile, 3 turbines make 9 MW: about 2,700 residents at 1 MW per 300, so the text says "about 2,500" to leave a margin. One water tower supplies 2,500 kL (`catalog.ts:279`). The bot builds gas above 12 MW of demand and coal above 150 MW (`simbot.ts:862`); G10 takes the newcomer there.
- **Spend guard**, once per profile: when day-0 spending passes 40% of the start money, "You've spent §48,000 of §100,000 before anyone moved in. Running costs come next — keep a reserve."
- **Completion toast**: "Your town is on the map, Mayor! A few goals will guide your first year." The old fire-station tip stays only if a fuel plant was built anyway (`Onboarding.ts:297-303`).

### 4.5 Phase C: your first year

The card becomes **"Your first year"** with a pill such as "3/10 · Take out the trash". At most two goals are visible; the next one appears when its trigger fires.

| goal | appears | text | button | done when |
|---|---|---|---|---|
| G1 Grow to 500 | at once | "The coloured bars (RCI) show what your town wants. Zone more of the tallest bar. Click a lot with Query to see why it isn't growing." | coach mark on the RCI meter; selects Query | 500 residents |
| G2 Take out the trash | the first NoGarbage building, or 300 residents | "Garbage is piling up at homes. Zone a small landfill (3×3, §15 a tile) on a road, away from homes." | selects the Landfill zone | landfill capacity reachable by road > 0 |
| G3 Safe streets | crime term ≤ −4, or 400 residents | "Crime is costing you approval. A Police Kiosk (§400) covers a few blocks; a Police Station (§1,500) covers a district." | Civic → Police, with the Police view | police coverage at homes ≥ 50% |
| G4 Fire cover | a fuel plant is built, or 800 residents | "A fire no station can reach burns until you send help. A Fire Station (§1,400) answers automatically within ~24 road tiles." | Civic → Fire, with the Emergency view | ≥ 50% of buildings covered, including any fuel plant |
| G5 Balance the books | the first deficit, or 2 services built | "Each tax point brings about §{X} a month, and every point above 9% costs 3.5 approval. Check the budget before you build more." | Budget → Taxes | the panel was opened, or net ≥ 0 for 2 months |
| G6 Schools | ≥ 100 children with no elementary school | "{N} children have no school. An Elementary School (§2,000) seats 1,500 within walking distance." | Civic → Education, with the Education view | unreached children < 50% |
| G7 See your city | 1,500 residents | "Data views colour the map by power, water, crime, pollution and more." | opens Data views | a data view stays open for 3 s |
| G8 Ask why | after G7 | "Click any building with Query. Why? lists what helps it and what holds it back." | selects Query; Why? opens expanded | Why? expanded on a growable |
| G9 Your first reward | after G1 | "At 1,200 residents the town offers you a Mayor's House (§2,000; it raises land value nearby). At 3,000 comes the Lighthouse." The Lighthouse sentence appears only when the map has a valid shore site (NEW-06); otherwise "At 5,000 comes the Clock Tower." | opens Rewards | 2,500 residents |
| G10 More power | power demand above 80% of supply, or the first brownout | "Your town needs {D} MW and makes {S} MW. Add wind turbines (§800, about 3 MW each, 2 tiles apart), or build a Natural Gas plant (§22,000, 250 MW; smoke and stigma within 8–9 tiles, so keep it away from homes)." | Utilities → Power, with the Power view | supply at least 1.25× demand for a month |

When G9 completes: **"Your first year is done, Mayor. The advisors take it from here — your next goal is on the top bar."** The top-bar goal line (LG-01) takes over. G10 can still appear after that, because the 9 MW ceiling of three flat turbines arrives at about 2,500–3,000 residents, right when G9 hands over.

Sources for the numbers: `ZONE_COST` (`tuning.ts:644`), `catalog.ts` (kiosk, station, fire station, elementary school `:341-342`, Mayor's House `:361`, wind turbine `:255-257`, gas plant `:258-260`), `rewards.ts:74`, `:102`; the 3.5 per point and the 9% neutral rate from `APPROVAL.taxPerPoint` and `TAX_NEUTRAL` (`tuning.ts:148`). At a 3,000-resident town's load the gas plant's upkeep is about §120 a month, not its listed §650, because plant upkeep scales with use (`UTIL_FIXED` 0.15, `tuning.ts:575`).

### 4.6 Phase D: explainers when something first goes wrong

Each fires once per profile, when its event first happens, and follows §4.1.

| id | event | text (short form) | buttons | item |
|---|---|---|---|---|
| E1a | first alerted major incident that can still be saved | "Emergency! No station covers this spot, so nobody comes on their own. Send nearest dispatches Fire Station #1 (3.9 min)." Pauses once. | Send nearest · Emergency view · Got it | FH-08 |
| E1b | first alerted major incident already out of reach | "No station can reach this in time. Build a Fire Station within ~24 road tiles — the Emergency view shows where help is automatic." | Fire tab · Emergency view | FH-08 |
| E2 | first LIVE slowdown | "LIVE: the game slowed down so you can follow the truck. Your speed comes back when help arrives." | Got it · Settings | FH-08 |
| E3 | first failed incident | The outcome adds the reason: "the nearest truck needed 5.6 min; this fire burned out in 5." | Fire tab | FH-08 |
| E4 | first month with net < 0 and > 200 residents | "Your town spends §183 more than it earns each month. +1% tax brings about §{X}; a §10,000 loan costs §106 a month for 10 years." | Taxes · Loans · Got it | FH-13 |
| E5 | funds below 0 | The finance card becomes a 3-step recovery plan: +1 tax point, the most over-funded service to 90%, the largest affordable loan, each with its monthly effect. | one button per step | FH-13 |
| E6 | growth stalls with zones full | "Your town has no room to grow — zone more {R/C/I} land next to roads." Shown as an amber card with a pulse, not only in the ticker. | Zones | FH-03 |
| E7 | first demand cap | The existing cap toast already names the fix ("Build parks, plazas, a zoo or landmarks to raise the residential cap.", `capHints`, `demand.ts:396-418`; toast at `TopBar.ts:308-321`). E7 adds the buttons and a coach mark on the capped RCI bar. | Parks · Rewards | FH-02 |
| E8 | approval below 45 with ≥ 300 residents | "Approval is {N}%. The biggest drag is {term} ({value}). Below 35% with high crime it can spark riots." No claim that low approval slows people moving in: 8–12 points cost 0–3% of the population (veteran #2). Once LG-16 or a part-B fix gives approval real effects, the text names them. | the fix for that term (FH-06's row links) | FH-02, FH-06 |
| E9 | first reward unlocked | Today's announcement (`rewards.ts:75`): "The citizens have built you a Mayor's House! Place it from Rewards." | Place it | FEEL-06 |
| E10 | first disaster | "A {tornado} hit {district}: {N} buildings are rubble. Bulldoze it (§5 a tile) so the lots can rebuild, or adopt Municipal Demolition Crews to clear it automatically." | Jump · Bulldoze · Ordinances | FH-02, LG-15 |
| E11 | first New Year | The first New Year toast adds one line: "Each year-end shows how the city did." | — | FH-02, LG-21 |
| E12 | first brownout | "Some homes have no power: your town needs {D} MW and your plants make {S} MW. Homes without power empty fast — add turbines or a gas plant." The wording follows PB-BROWNOUT's advice and PB-OUTAGE's exodus speed. | Power tab · Power view | FH-02 (G10) |

Checked against the code:
- §106 is a first loan at 5% over 120 months (`LOAN_RATE_MIN`, `LOAN_TERM_MONTHS`, `tuning.ts:599-603`; `loanRate`, `loans.ts:29-33`).
- Approval moves residential demand by up to ±6% (`APPROVAL_R`, `demand.ts:280`), and the growth throughput cap masks even that (veteran #2). Riots need approval below 35% and average crime above 0.45 (`RIOT_APPROVAL`, `params.ts:533-537`). There is no "people leave below N%" rule, so no text may claim one, and E8 makes no growth claim.
- Rubble never clears by itself: it must be bulldozed or cleared by the ordinance (`growth.ts:680`; `RUBBLE_CLEAR_DAYS` 30, `tuning.ts:349`; `ordinances.ts:63-64`, unlocked at 1,000 residents, before the first disaster at 2,000).

### 4.7 Phase E: the veteran briefing

Shown instead of Phase B when "I've played city builders before" is ticked, or when the guide is dismissed within 30 s (FH-18). At most 90 words:

- **Roads carry power.** Power lines are only for gaps.
- **Pipes are automatic** under every road. Only medium and high density need water, and that includes the default industry zone.
- **A road from the map edge, at least 3 tiles long,** connects you to the region (`connections.ts:15-18`).
- **Uncovered emergencies drop the game to LIVE** and wait for you to dispatch.
- **Why?** in the inspector explains every building.
- **9% tax is neutral**; each point above costs 3.5 approval.

Buttons: "Got it" and "Show the guided start anyway".

### 4.8 Persistence and measurement

- **Where the state lives** (FH-22): the phase and goal progress per city in `systemData.onboarding`; "veteran", "seen explainers" and "tips on/off" per profile.
- **How it is measured**:
  - the FH-10 newcomer bot profile (cheap start, under-zoning, one late service) on Easy and Medium;
  - a scripted real-input run that presses only guide buttons (the FH-01 and FH-02 acceptance);
  - persona P-1 (§9).
- **Targets** (years counted from founding, "How to read this plan"):
  - at most §15,000 spent before Play;
  - 2,500 residents by year 3 on Easy and year 4 on Medium;
  - no brownout before year 4 (G10, E12);
  - no deficit longer than 3 months without E4;
  - approval at or above 45% for at least 9 of the first 12 months on Easy.

## 5. Goals and endgame

### 5.1 The milestone ladder, 0 → 1.5M

"Bot s7" is the first New Year at which the 256×60 s7 bot city has reached that population (`G_256x60_s7` rows; the row for year Y is the state on 1 January Y). Unlocks today come from `rewards.ts:57-105`.

| rank (LG-01) | population | bot s7 | unlocks today | added by this plan |
|---|---|---|---|---|
| Settlement | 0 | 2000 | the basic catalog | the 5 founding steps and goals G1–G10 (§4) |
| Village | 1,000 | 2001 | Mayor's House 1.2k, Cemetery 2k, Statue 2.5k (approval 65), Lighthouse 3k | the rank card (FEEL-06); the Statue reachable by a young town (FH-26) |
| Town | 5,000 | 2002 | Clock Tower 5k, Water Treatment 6k, Recycling Center and Courthouse 8k | |
| Small City | 10,000 | 2003 | Obelisk 10k; Museum and Municipal Airport 12k; Arch, Prison, Parking Garage and Military Base 15k | |
| City | 25,000 | 2004 | University, Desalination, Incinerator and City Hall 20k; Observatory 25k; Zoo and Solar Farm 30k | |
| Large City | 50,000 | 2007 | Cathedral, Fire HQ and Missile Range 35k; Police HQ and the research centres 40k; Castle and Stadium 50k; Nuclear, Convention Center and Toxic Dump 60k; Pyramid 70k; Amusement Park 80k; Ferris Wheel 90k | Emergency Operations Center (LG-15) |
| Metropolis | 100,000 | 2011 | International Airport 120k; Opera House 150k (2014) | City Charter (LG-17); Tech Incubator Grants 100k and Rent Control 150k (LG-18); Safe City honour from 100k (LG-20) |
| — | 200,000 | 2016 | — | Central Library (LG-02); Green Building Code (LG-18); Transit Capital honour from 200k |
| Major Metropolis | 250,000 | 2019 | Observation Spire | Congestion Charge and Skyline Height Limit (LG-18); Film Studio deal (LG-22); Clean Air and Quiet City honours from 250k |
| — | 300,000 | 2021 | — | Grand Central Station (LG-02); Express Metro (LG-03); 24-Hour City (LG-18) |
| — | 400,000 | 2025 | — | Stock Exchange (LG-02); Free Public Transit (LG-18) |
| Global City | 500,000 | 2029 | Twin Spires (the last unlock today) | Car-Free Downtown (LG-18); Full Employment honour from 500k |
| — | 650,000 | 2033 | — | Botanical Dome (LG-02); Business Arcology (LG-04); Data Center Campus deal (LG-22) |
| World City | 750,000 | 2036 | — | Fusion Power Plant (LG-03) |
| — | 800,000 | 2038 | — | World Trade Center (LG-02); World Expo (LG-03) |
| Megacity | 1,000,000 | 2043 | — | Millennium Tower (LG-02); Residential Arcology (LG-04); Megacity honour |
| — | 1,150,000 | 2047 | — | Space Center (LG-03) |
| — | 1,350,000 | 2052 | — | Arcology II (LG-04) |
| Megalopolis | 1,500,000 | 2056 | — | Metropolis Crown (LG-02); Megalopolis honour |

Three rewards unlock by other conditions today: the Country Club (4,000 high-wealth residents), the Casino Resort (15k plus the Legalized Gambling ordinance) and the Container Seaport (6,000 industrial jobs and a coastline) (`rewards.ts:81-90`).

Quality honours fill the years between: Balanced Books (bot 2022), Tourist Capital (2027), Scholar City (2040) (LG-20). With the plan, **the longest gap between unlocks, ranks and honours after 2010 is 5 game years** (2047 → 2052; Scholar City in 2040 splits 2038 → 2043). Today it is 27+ years (2029 → never).

### 5.2 The late-game loop

Today, once the map fills (about 2045 on 256), the player has nothing to decide. The plan gives a six-step loop that repeats every few years:

1. **Notice.** The built-out advice (LG-05) says the city is full and names the options with numbers: "73,000 residents are unemployed; a Business Arcology adds 20,000 jobs".
2. **Densify.** Towers grow around stations (LG-08), facilities expand in place (LG-19), and ordinances trade one value for another (LG-18).
3. **Build big.** Mega-projects and arcologies (LG-03, LG-04) cost millions over months or years, gated by council support (LG-16).
4. **Reach out.** Found or fund a sister city (LG-12) and sell spare capacity (LG-11).
5. **Polish.** Chase honours (LG-20), protect a historic quarter (LG-26), run events (LG-23).
6. **Close the year.** The Year in review grades the mayor and names the next goals (LG-21).

The two currencies trade against each other again: money buys projects, and the council's approval decides which projects are allowed.

### 5.3 Money targets

- **Targets** (measured on 256×60 s7 with LG-10's long-game flags):
  - bank at most 12 months of expenses in 2045 (today 19.0) and at most 15 in 2060 (today 26.3);
  - tax at 8% or more while saving (today 7% from 2035);
  - lowest daily balance at or above 0 (the funds gate).
- **What that means in money.** In 2045 the bot spends about $0.49M a month, so 12 months means about $3.5M less in the bank than today. In 2060 ($0.67M a month, 15 months) it means about $7.6M less.
- **The sinks the plan adds**:

  | sink | size | item |
  |---|---|---|
  | mega-projects | §14.5M in total: Express Metro 1.5, Fusion 4.0, Expo 3.0, Space Center 6.0 | LG-03 |
  | arcologies | §2.5M and §3.0M, plus Arcology II | LG-04 |
  | facility expansions | 1.5× the build price per level, plus 40% upkeep | LG-19 |
  | ordinances | about §0.025 per resident a month (Tech Grants and Free Transit): §25–40k a month at 1–1.5M | LG-18 |
  | events | §0.3–1 per resident each, up to 2 a year: §0.6–2M a year at 1M | LG-23 |
  | sister-city endowments | up to §5M per 10 years | LG-12 |
  | charter change | §1M | LG-17 |

- **What stays fixed.** The approval formula and the bot's base strategy. Only the LG-10 variants spend on the new sinks.
- **What changes once.** The tax response, through PB-TAXRESPONSE or NEW-05. Today taxes up to 13% are nearly free (veteran #1), so a bot or player can fill any sink with a 12% tax and these targets would measure nothing.

### 5.4 Balance gates each proposal touches

The gates are acceptance r3's GATE SUMMARY:

| gate | rule |
|---|---|
| G-POP | population ≥ 150k at year 15 and ≥ 950k at year 60; ≥ 0.9× phase 0 every year |
| G-APPR | approval ≥ 50 from year 30 |
| G-FUNDS | lowest daily funds ≥ 0 |
| G-EQ | EQ ≥ 100 by year 30 |
| G-UNEMP | \|unemployment − (1 − accW)\| ≤ 0.02 |
| G-EMG | auto-dispatched ≥ 85% and failed ≤ 5% from year 10 |
| G-JAIL | overflow ≤ 0.2 from year 20; police compared on the same layout (LD1) |
| G-STEP | every estimated step ≤ 3 ms |
| G-AB | abandoned ≤ 3% |
| G-TOUR | tourism ratio 0.7–1.3 from year 15 (12-month mean, LD14b) |
| G-MS | ms/day ≤ +3 on the same city (LD2) |
| G-DET | the audit's two-process yearly hash |

| item | gates it can move | how it is measured |
|---|---|---|
| FH-04 Easy rules | none on Medium or Hard | G-DET bit-identical on Medium and Hard; Easy rows recorded separately |
| FH-07a refunds, FH-07b undo | none (unless the bot bulldozes buildings under 30 days old) | the bot never undoes: G-DET on 256×20 s7, with the young-bulldoze count logged |
| news and advice writers: FH-03, FH-09, FH-13, FH-14, LG-05, FEEL-06 (stage news), FEEL-20, FEEL-23, FEEL-29, NEW-07 | G-DET (advisor news only) | hashes compared without `news` and `systemData.advisors`. These items write news and `systemData.advisors` (`advisors.ts:575-598`, `:1376-1381`), which the audit hash includes, so they cannot be bit-identical. Only `recentNews` reads news back (`advisors.ts:97-106`), and no headline pick draws from the sim RNG |
| FEEL-05 spring start | none | the constructor keeps day 0; 128×15 s7 table unchanged |
| FH-10, LG-10 bot profiles | none for the base run | flags off reproduce today's rows exactly; variants under `polish` |
| NEW-05 tax response (or PB-TAXRESPONSE) | every base row; G-POP, G-FUNDS, G-APPR | the tax sweep (10–14%) and all three gate runs, under `polish` |
| NEW-06 shore rule | G-DET (the bot places desalination and seaports, `placeShore`) | G-DET on 256×60 s7; `polish` rows if it moves |
| LG-09 Hard and Expert | Hard rows | Medium bit-identical; Hard rows under `polish` |
| LG-06 neglect costs | G-POP, G-FUNDS, G-APPR, G-EMG | base within ±0.5%; `--neglect` variant |
| LG-07 clean and dirty industry | G-POP, G-UNEMP, G-AB, the air check (LD15a) | base within ±1%; `--skip dirty` variants |
| LG-08 transit-oriented growth | G-POP, G-STEP, G-MS, G-AB | `--subway` and `--skip transit` variants |
| LG-03 mega-projects | G-FUNDS, G-POP, G-APPR, G-EQ, G-STEP | `--megaprojects` variant |
| LG-04 arcologies | G-UNEMP, G-AB, G-STEP, G-MS, G-POP | `--arcology` variant |
| LG-19 facility expansion | G-FUNDS, G-EQ, G-STEP | `--expand` variant |
| LG-02 late rewards | G-TOUR (main risk), G-POP | all three gate runs |
| LG-20 honours (perks ≤ 5%) | G-POP, G-TOUR (small) | `polish` rows |
| LG-18 ordinances | G-POP, G-APPR, G-TOUR (24-Hour City) | the base bot adopts none; variant rows |
| LG-16 political capital | none (formula untouched; bot approval within 1 point of the §8.0 base from 2029) | base rows unchanged |
| LG-15 disasters | none (gate runs have disasters off, `simbot.ts:224`) | base rows unchanged |
| LG-17 charter | every gate, per charter | five variants |
| LG-22 business deals | G-POP, G-TOUR | the base bot hosts the military base and missile range: re-run |
| LG-25 late crises | none for the bot (crises are off in `simbot.ts` and draw from their own stream) | G-DET bit-identical on 256×60 s7; crises are kept out of the gate counters |
| NEW-01 visual variety (SIM rule) | G-DET, G-STEP | `polish` rows; def swaps change capacities slightly |
| LG-11, LG-12, LG-13, LG-24 region items | none (the bot plays one city) | region unit tests |
| LG-14, LG-23, LG-26 player-only content | none (the bot doesn't use them) | base rows unchanged |

Rule: every run that changes base rows is recorded under the `polish` fixture key with the lead's sign-off (D2), and the SIM lane runs the gate runs one at a time (§7.4).

## 6. Feedback catalogue

### 6.1 Principles

- **Three beats within 100 ms.** Every consequential event answers in the world (something moves or changes), in sound, and in the UI.
- **The size of a moment follows its rarity.** A month tick is a soft coin; a rank-up is a card, a sound and fireworks. Something that happens 40 times a minute at ultra gets no sound at all.
- **Real-time budgets, not game-time ones, at every speed** (FEEL-02a, FEEL-02b, FEEL-11): at most 2 full New Year shows per 10 real minutes at 1× and 2× and per 5 at ultra, fireworks on screen at most 25% of real time, 0 autosave chimes, at most 8 sim toasts a minute (disasters always show; toasts with an action wait instead of vanishing), at most 1 milestone card per 30 s, at most 2 siren voices, no music from a background tab.
- **One cause, one message.** No news item repeats three times (PB-GARBAGE); the ticker shows one clause.

### 6.2 Event table

Status: **OK** = all three beats exist; **WEAK** = one or two beats, or a misleading one; **MISSING** = nothing a player would notice.

| # | event | see (world) | hear | UI | status | plan |
|---|---|---|---|---|---|---|
| 1 | select a tool | cursor ghost | `toolSelect` | button state | OK | — |
| 2 | drag a road | ghost and cost preview | `road` | funds change | WEAK: no cost float | FEEL-03 |
| 3 | zone | zone colours | `zone` | funds change | WEAK: nothing says how much to zone | FEEL-03, FH-01 |
| 4 | place a building | it pops in; cranes and dust while building | `plop`, `construct`, `built` | funds change; no budget preview | WEAK: no ground contact, no monthly cost | FH-05, FH-15, FEEL-03, FEEL-14 |
| 5 | invalid action | red ghost | `error` | tooltip reason | OK | — |
| 6 | bulldoze | gone in one frame (`BuildingRenderer.ts:1460-1476`) | `bulldoze` | funds change | WEAK | FEEL-14, FH-07a |
| 7 | undo | — | — | — (no undo, no save history, no exit without saving) | MISSING | FH-07b, NEW-03 |
| 8 | a lot grows | construction, then the building | `built` | population ticks up | OK | — |
| 9 | redevelopment | the building swaps between frames (`growth.ts:674`) | — | — | MISSING | FEEL-14 |
| 10 | a building stage unlocks (3k, 12k, 35k, 90k, 220k) | — | — | — (`tuning.ts:243-249`) | MISSING | FEEL-06, FEEL-07 |
| 11 | population milestone | — | `milestone` for 7 of 12 (`GameSounds.ts:41`) | good-news toast | WEAK | FEEL-06, LG-01 |
| 12 | rank-up | — | — | — (no ranks) | MISSING | LG-01, FEEL-06 |
| 13 | reward unlocked | — | `reward` | toast that can't be clicked (`rewards.ts:177`) | WEAK | FEEL-06 |
| 14 | blackout | windows stay lit (no render code reads `BF.Powered`) | `bad` news sound | news; power view | MISSING in the world | FEEL-04, FEEL-28, PB-BROWNOUT |
| 15 | uncollected garbage | nothing on the street | — | advisor text, repeated (PB-GARBAGE) | MISSING in the world | FEEL-17 |
| 16 | air pollution | full plume at any load (`Effects.ts:261`) | — | Air view; approval row | WEAK | FEEL-15, FEEL-16, FH-15 |
| 17 | abandonment | flat 0.46 tint, windows off | — | inspector | WEAK | FEEL-18, FEEL-19, FEEL-28 |
| 18 | covered fire | fire, smoke, trucks, beacons | siren, `fireBell` | statistic | OK | — |
| 19 | uncovered emergency | fire and smoke | `alarm` | banner, LIVE | OK, but nothing teaches it | FH-08, FEEL-09, FEEL-10 |
| 20 | emergency resolved or failed | the fire goes out or rubble stays | — | banner outcome line | WEAK: no reason, no weight | FEEL-10, FH-08 |
| 21 | building with no road access | — | — | red "no road" cell in the Emergency view, empty land only (`shots2/058`) | WEAK | NEW-02 |
| 22 | disaster | tornado, quake shake, meteor | `tornado`, `quake`, `meteor` | banner, news | OK | LG-15, FEEL-21 (shake off) |
| 23 | month tick | — | `coin` or `cashLow`, at most every 90 s (`GameSounds.ts:18`, `:277`) | funds and net update | WEAK: no delta shown | FEEL-03 |
| 24 | first deficit | — | `cashLow` | red net; advice only below 8× the deficit (`advisors.ts:1023-1025`) | WEAK | FH-05, FH-13 |
| 25 | approval changes | — | — | number and face | WEAK: no delta, no cause | FH-06, FEEL-03 |
| 26 | tax change | — | slider tick | approval cost hint says ~12% (`BudgetPanel.ts:167`) | WEAK: wrong number | FH-09 |
| 27 | speed change | — | `speed` | button state | OK | — |
| 28 | data view | map colours | `overlay` | legend | OK (fails red-green) | FH-20 |
| 29 | camera rotate | smooth snap | `camRotate` | — | OK | — |
| 30 | jump to a place | a 0.4 s smear (`shots2/041`) | `whoosh` | — | WEAK | FEEL-08 |
| 31 | save | — | `save` / `autosave` | pill at z 70; a failed save shows the raw exception (`CityScene.ts:910`) | OK when manual; spam at ultra (every 4.5 s) | FEEL-02b, NEW-04 |
| 32 | headline | — | — | ticker fragment (`shots2/i01`) | WEAK | FEEL-01, FEEL-20 |
| 33 | advisor tip | — | `advisor` | toast only if urgent | OK, but "zone more" never toasts (`Notifications.ts:113-114`) | FH-03 |
| 34 | New Year | fireworks show | countdown, fanfare | toast | WEAK: about 44% of real time at 1×, 60% at 2×, every year at ultra | FEEL-02a, FEEL-11, LG-21 |
| 35 | music track change | — | 5 s crossfade, no rest | now-playing toast | OK | FEEL-11 (rests) |
| 36 | neighbour connection | — | `good` | news "New neighbor connection!" (`actions.ts:399`) | WEAK | FEEL-07 |
| 37 | mega-project progress | — | — | — (no projects) | MISSING | LG-03 |
| 38 | year end | — | — | one toast, the same in year 5 and 50 (`shots2/047`) | WEAK | LG-21 |

Count: 12 OK (4 of them with a caveat: rows 19, 28, 31, 33), 19 WEAK, 7 MISSING. Row 34 moved from OK to WEAK once the 1× and 2× New Year shares were measured.

### 6.3 Audio map

- **Buses.** Master, music (≈ −11 dB at the defaults), SFX (≈ −4 dB) and ambience, all static today (`AudioEngine.ts:70`, `:409-420`).
- **One-shots** (`sfx.ts`): 70 named voices, trimmed by role: UI −34..−46 LUFS, game actions −28..−31, notifications −29..−35, rewards and fanfares −24, alarms −23..−25 (`sfx.ts:11-13`).
- **Music** (`music/director.ts`): 7 procedural tracks at −18 LUFS, 5 s crossfades, no rests, still playing in a background tab. After FEEL-11: ducking under long sounds and New Year, 15–40 s rests, and a mute when the tab is hidden.
- **Sirens** (`sirens.ts`): the nearest source per kind within 1,400 m. After FEEL-11: frustum + 150 m, at most 2 voices, distant automatic responses silent.
- **Ambience** (`ambience.ts`): bed, hum, horns, birds or crickets, wind, construction; surf built but never fed. After FEEL-12 and FEEL-13: surf, seasons, climates and location layers.
- **New sounds in this plan**: power down (FEEL-04), collapse dust (FEEL-14), rank-up (FEEL-06), rain bed (FEEL-23).

### 6.4 Performance guard for feedback work

- **Budget per round**: at most +1.0 ms a frame on the 287k save (the audit measured 7.1–8.1 ms of UI work) and at most +3 draw calls.
- **Particles** share the 7,000-particle smoke pool.
- **Distance cuts**: dust beyond 2,200 m, garbage beyond 900 m, icons beyond 700 m, pedestrians beyond 600 m.
- **Rebuild limits**: emitters at most once per building per month (FEEL-15); redevelopment effects at most 4 a second (FEEL-14).

### 6.5 Fitting the Worker

- **Read from the replica, never the sim.** Feedback code reads replica-safe helpers, building records and the event stream, never `sim.state` directly (`WORKER_DESIGN.md` §1.3, §2.8).
- **The hygiene test applies.** No `.speed =`, `emergencyOf(` or `getSystem(` in `src/ui` or `src/game` (`WORKER_DESIGN.md` §5.3).
- **Speed and policy go through the host**: `host.setSpeed` and `host.policy`.
- **New player actions are Worker commands**: `undo`, `startProject`, `cancelProject`, `expandFacility`, `setHistoricRect`, `chooseCharter`, `scheduleEvent`, and the region operations (§7.3). Each is also a recovery-journal entry, and `undo` is journaled as its concrete inverse commands (§7.6).
- **Predictions stay honest.** A command that plays a confirmation sound must use the preview prediction (`WORKER_DESIGN.md` §2.2), so a refused command never plays a success sound.

## 7. Lanes and file ownership

### 7.1 The five lanes

| lane | what it owns | R1 | R2 | R3 | R4 | total (P1/P2/P3) |
|---|---|---|---|---|---|---|
| **GUIDE** | onboarding, advice, money and approval UI, inspector, Help, placement previews | FH-01, FH-02, FH-22, FH-03, LG-05, FH-05, FH-06, FH-09 (+ the TopBar split, §7.4) | FH-18, FH-17, FH-14, FEEL-19, FH-15, FH-16, FH-13, FEEL-03, NEW-06, NEW-07 | UI parts of SIM items (LG-16, LG-19, LG-04) | UI parts of SIM items (LG-11 and LG-23 Budget tabs; the FEEL-22 inspector line) | 18 (7/11/0) |
| **SIM** | simulation, bot, sim tests, Worker rows | FH-04, FH-07a, FH-10, LG-10 (+ the `NewsItem.ref` interface) | LG-09, LG-06, LG-07, LG-08, LG-03 (framework, Express Metro), FH-07b, NEW-05 | LG-16, LG-15, LG-04, LG-19, LG-18 (+ LG-03 Fusion, Expo, Space Center) | LG-25, LG-17, LG-22, LG-23, LG-26, LG-11 | 22 (3/13/6) |
| **WORLD** | render, audio, camera, input, colour vision, key bindings | FH-19, FEEL-08, FEEL-04 (if D13), FEEL-11, FEEL-12 (+ FH-20's Emergency palette) | FEEL-09, FEEL-10, NEW-02, FEEL-14, FEEL-15, FEEL-17 | FEEL-18, FH-20 | FEEL-16, FEEL-28, FEEL-07, FEEL-27, FEEL-24, FEEL-25, FEEL-23, FEEL-29, FEEL-13, FH-25 | 23 (1/12/10) |
| **CONTENT** | rewards, ranks, honours, catalog content, models, milestone and year cards, headlines | LG-01 (+ start of the art pipeline) | FEEL-06, LG-21 (+ LG-03 defs and models) | LG-20, LG-02, NEW-01 | FH-26, FEEL-20, FEEL-22 | 9 (1/5/3) |
| **META** | app shell, region, settings, saves and storage, notifications and pacing, the emergency banner flow | FH-08, FH-11, FEEL-02a, FEEL-02b, FEEL-05, FH-21, NEW-04 (+ the settings schema) | FH-12, FEEL-01, FH-23, FEEL-21, NEW-03 | LG-12, LG-14 | LG-13, LG-24 | 16 (7/7/2) |

All 88 items: 19 P1, 48 P2, 21 P3. By round: R1 25, R2 30, R3 12, R4 21. NEW-05 is conditional: if part-B triage fixes veteran #1 as PB-TAXRESPONSE, drop it (87 items, 18 P1, R2 29).

### 7.2 Files with one owner

Paths are relative to the repository. A directory glob means every file below it unless §7.3 lists a hunk for another lane.

- **GUIDE**
  - `src/ui/Onboarding.ts`, `src/ui/guide/**` (new, including the §4 copy module `copy.ts` and `shoreSites.ts`), `src/ui/onboarding.css` (new)
  - the TopBar segment components after the round-1 split (`src/ui/topbar/**`, new), except the shell and the population segment (§7.3)
  - `src/ui/adviceActions.ts`, `src/ui/glossary.ts`, `src/ui/FloatText.ts` (new)
  - `src/ui/panels/AdvisorsPanel.ts`, `BudgetPanel.ts`, `InfoPanel.ts`, `StatsPanel.ts`
  - `src/ui/inspectorModel.ts`, `src/ui/zoneStatus.ts`, `src/ui/Toolbar.ts`, `src/ui/Panel.ts`
  - `src/game/tools/ZoneTool.ts`, `NetworkTool.ts`, `BrushTool.ts`
  - `tests/game/onboarding.test.ts` (new), `tests/sim/advisors.test.ts`
- **SIM**
  - `src/sim/**`, except the CONTENT files below and the hunks in §7.3
  - `src/core/types.ts`
  - `src/worker/**` (the Worker phase creates it; SIM adds every new row)
  - `src/game/demolishRisk.ts`, `src/game/tools/HistoricTool.ts` (new)
  - `tools/simbot.ts`, `tools/scenarios.ts` (new)
  - `tests/sim/**` except `advisors.test.ts`; the balance fixture `tests/sim/fixtures/balance-baseline.json`
- **WORLD**
  - `src/render/**`, `src/audio/**`
  - `src/game/cameraStart.ts`, `src/game/tools/ToolController.ts`
  - new `src/game/ShowCamera.ts`, `src/game/bindings.ts`
  - new `src/ui/HintBar.ts`, `src/ui/PhotoBar.ts`, `src/ui/fx.css`, `src/ui/panels/KeyBindingsPanel.ts`
  - `src/ui/theme.css`, `src/ui/overlays.ts`, `src/assets/materials.ts`
- **CONTENT**
  - `src/sim/economy/rewards.ts`, `src/sim/catalog.ts`
  - `src/assets/**` except `materials.ts`; `gallery.html`
  - `src/ui/panels/ListPanels.ts`
  - new `src/ui/MilestoneCard.ts`, `src/ui/YearReview.ts`, `src/ui/CharterDialog.ts`, `src/ui/residentVoice.ts`
  - new `src/sim/economy/eventHeadlines.ts`
- **META**
  - `src/main.ts`, `src/region/**`
  - `src/save/**` after W1.3, with the Worker save owner (NEW-03, NEW-04); SIM adds the worker-side rows
  - `src/game/settings.ts`, `src/ui/panels/SettingsPanel.ts`, `src/ui/zoom.ts`
  - `src/ui/Notifications.ts`, `src/ui/MiniMap.ts`, `src/ui/panels/EmergenciesPanel.ts`
  - new `src/game/scenarios.ts`, `src/ui/ObjectivesCard.ts`, `src/ui/StorageDialog.ts`

**Everything else.** A file the plan does not list belongs to its directory's lane: `src/ui/**` → GUIDE, `src/game/**` → WORLD, `src/region/**` → META, `src/sim/**` → SIM, `src/render/**` and `src/audio/**` → WORLD, `src/assets/**` → CONTENT. **A test file follows the source file it tests**, including that file's round split (for example `tests/game/emergencyPolicy.test.ts` follows `EmergencyBanner.ts`).

### 7.3 Shared files: who owns which hunk

| file | hunks and owners |
|---|---|
| `src/game/CityScene.ts` | **GUIDE**: the HUD wiring block in the constructor (about `:255-275`) and the coach hooks. **WORLD**: camera, audio and input methods: `onKey` (incl. Ctrl+Z for FH-07b, FH-19's speed keys, Backspace and hotkey skip, and photo mode), `consume`, `focusCell`, `placeInitialCamera`, `updateAmbience`, `feedShake`, `feedSirens`. **META**: `onMonth`, `save` (incl. NEW-04's storage errors), `exitToRegion` (NEW-03's exit without saving), `resize`, `applySettings`, `onVisibility`, the context-loss handler (FH-21), the NewYear construction and the fps tick. **CONTENT**: one wiring block right after the NewYear construction (milestone card, year review, charter dialog). The Worker phase edits this file in W0.1, W0.2, W0.5 and W0.6, so every hunk rebases on those steps. |
| `src/ui/TopBar.ts` | Today `buildCenter` (`:166-196`) and `update()` (`:395-518`) each handle funds, population, RCI and approval together, and W0.2 and W0.3 edit them too, so per-hunk ownership would collide. **Round 1 first splits TopBar** (GUIDE, after W0.3) into a shell plus one component per segment (`src/ui/topbar/**`). Then: **META** owns the shell, `buildLeft` (city name, mayor, difficulty, date) and the LIVE pill title; **CONTENT** owns the population segment (rank line); **GUIDE** owns the funds, RCI and approval segments, their popovers and coach marks, and the focus handlers (FH-23). |
| `src/sim/economy/advisors.ts` | **GUIDE**: the advice rules and their `ref`, the day gates (`:1272`, `:1284`) and `advisorData`'s first-headline day (`:144`), the finance thresholds, `Advice` metadata. **CONTENT**: `POP_MILESTONES`, the milestone notify, stage news, `HEADLINES` and the headline picker. **SIM**: none. |
| `src/sim/economy/approval.ts` | **SIM**: `update()` and every term. **GUIDE**: `approvalDetail` and `APPROVAL_LABELS`. |
| `src/sim/economy/tourism.ts` | **CONTENT**: the `ATTRACTIONS` table. **SIM**: everything else. |
| `src/game/toolCatalog.ts` | **WORLD**: `HOTKEY_CYCLES` and `PANEL_HOTKEYS`. **CONTENT**: everything else (categories, tool entries, lock reasons). |
| `src/game/tools/QueryTool.ts` | **GUIDE**: `move()` (hover text). **WORLD**: `down()` and `up()` (left-drag pan). |
| `src/game/tools/PlopTool.ts` | **GUIDE**: everything except the rotate-key check (`:221`), which is **WORLD**'s for FH-25 in round 4. NEW-06's shore tint is GUIDE's. |
| `src/game/tools/Tool.ts` | **GUIDE**: the commit feedback hunk (FEEL-03). The rest belongs to the Worker phase's `Tool.commit`; no lane edits it. |
| `src/game/GameSounds.ts` | **CONTENT**: the milestone and honour hunk (`POP_MILESTONES`, the milestone case). **WORLD**: everything else. |
| `src/game/NewYear.ts` | **META** in rounds 1–3 (FEEL-02a pacing; FH-19's `CAMERA_KEYS` on `e.code`; the FEEL-11 duck call in round 2). **WORLD** in round 4 (FEEL-07 extracts `ShowCamera`). |
| `src/ui/EmergencyBanner.ts`, `src/game/emergencyPolicy.ts`, `src/ui/emergency.css` | **META** in rounds 1, 3 and 4 (FH-08; LG-06's rebuild line; LG-25's decision buttons). **WORLD** in round 2 (FEEL-09 follow button, FEEL-10 outcome flash, FEEL-21 steady colours). |
| `src/ui/Modals.ts` | **GUIDE**: `HelpPanel`, `SHORTCUTS` and the Help link. **META**: `SavePill` and `PauseMenu` (NEW-03's restore, exit without saving and revert). |
| `src/ui/hud.css` | **META**: global rules (text size, reduced motion, the save pill, the ticker). Every other lane puts new styles in its own file (`onboarding.css`, `fx.css`) and edits only the selector families of components it owns. |
| `src/ui/panels/InfoPanel.ts` | **GUIDE**, including the one-line inserts for LG-19 (Expand button) and FEEL-22 (household card), written to the owning lane's spec. |
| `src/game/settings.ts`, `src/region/settings.ts`, `src/region/ui/dialogs.ts` | **META** adds the whole new schema in round 1 (§7.5), so no other lane edits them later. The title-screen Settings (`dialogs.ts`) gets the "Accessibility & interface" section from the same keys (FH-23, FEEL-21, FH-20). |
| `src/worker/**` | **SIM** adds every command, mirrored key and replica-safe entry (§7.6), on request from the item's lane. |

### 7.4 Cross-lane rules

- **Interfaces land first.** At the start of round 1, before items edit the files:
  - META lands the settings schema, in both settings files and the title-screen dialog (§7.5).
  - SIM lands the Worker rows the round needs, and `NewsItem.ref?: {advice?: string; reward?: string}`. It is set by `notify` (a new optional argument, `Simulation.ts:153-156`), saved with the news, and carried in the Worker's news stream. Toast actions (FH-03, FEEL-06, FEEL-02a's queue) key on `ref`, never on text: today a `NewsItem` carries only day, text, kind, position and advisor (`CityState.ts:428-435`).
  - GUIDE splits TopBar into a shell and one component per segment (§7.3), so META, CONTENT and GUIDE stop editing the same `buildCenter` and `update()`.
  - CONTENT lands the asset-pipeline stubs (new model ids with placeholder geometry).
  So other lanes never wait on them mid-round.
- **Asking for a change.** A lane that needs a change in a file it does not own writes the request in the round notes; the owner makes it in the same round.
- **Tests.** Each lane owns the tests for its items, and adds new test files rather than editing another lane's.
- **Gate runs.** The SIM lane runs all gate runs, one at a time, never while a CPU benchmark runs (BALANCE=1 took 251 s; 60-year runs take minutes each). Results go under the `polish` fixture key with the lead's sign-off (D2).
- **Hygiene.** Every lane keeps the Worker hygiene test green: no `.speed =`, `emergencyOf(` or `getSystem(` in `src/ui` or `src/game`, and no writes into the replica.

### 7.5 Settings schema (META, round 1)

New keys, each with its default, added in one change to `src/game/settings.ts` and `src/region/settings.ts`:

| key | default | used by |
|---|---|---|
| `motion` | follows `prefers-reduced-motion` | FEEL-21 |
| `textSize` | 0 (+0%) | FH-23 |
| `colourVision` | `standard` | FH-20 |
| `tips` | on | FH-02, §4 |
| `cameraMoments` | on | FEEL-07 |
| `musicPauses` | on | FEEL-11 |
| `muteInBackground` | on | FEEL-11 |
| `newYearPacing` | `milestones` (`everyYear` keeps today's pacing) | FEEL-02a, D17 |
| `uiScale` (moved into the shared schema so the title screen can set it) | 1 | FH-23 |
| `problemIcons` | `query` | FEEL-28 |
| `yearReview` | on | LG-21 |
| `panSpeed`, `invertOrbit` | 1, off | FH-19 |
| `keyBindings` | {} | FH-25 |
| first-run quality | from `detectQuality()` | FH-21 |
| `disasterRate` (per city, in the city config) | `normal` | LG-15 |
| `crises` (per city, in the city config; `false` in `simbot.ts`) | on | LG-25 |

The accessibility keys (`motion`, `textSize`, `colourVision`, `uiScale`) live in `AppSettings` (`region/settings.ts`), so the title, region and New City screens can apply them before any city exists; the city reads them from there. Autosave labels change with FEEL-02b's floor.

### 7.6 Worker additions (SIM)

- **Commands**: `undo`, `startProject`, `cancelProject`, `expandFacility`, `setHistoricRect`, `chooseCharter`, `scheduleEvent`, and the region operations (endowment, deals).
- **Journal entries** (`JournalOp`, `WORKER_DESIGN.md:814-815`), so crash recovery replays them:
  - `startProject`, `cancelProject`, `expandFacility`, `setHistoricRect`, `chooseCharter` and `scheduleEvent`;
  - `undo` is never journaled as itself. It is journaled as its concrete inverse commands, for example a bulldoze carrying the refund it gave, so a replay cannot rebuild and re-charge the undone building;
  - a bulldoze carries the refund it was charged, because replay runs every command at the base's day (§4.3) and would otherwise apply FH-07a's same-day rule to an older building.
- **News stream**: `NewsItem.ref` (§7.4).
- **Save history** (NEW-03): `save:put` also rotates the history slots and compresses the demoted one (W1.3 and later).
- **SimSettings**: `teachFirstEmergency`, `disasterRate`.
- **Mirrored `systemData` keys**: `onboarding`, ranks, honours, projects, charter, events, scars, recovery, petition, facility levels, firsts, the region last-seen record, `foundedDay`.
- **Replica-safe additions**: `listMilestones`, `listHonours`, `hasShoreSite` (NEW-06).

## 8. Rounds

### 8.0 Before round 1

- **Planning is not blocked. In implementation, only the listed items can start now** (the schedule under "Is the work blocked?" at the top, and D1):
  - **now**: FEEL-11's ducking, rests and background mute (`src/audio/**` only); FEEL-12; LG-01's `CITY_RANKS`, `listMilestones` and tests in `rewards.ts`; the §4 copy as a data module with text tests; new-file art (`lm_*.ts`);
  - **once PB-BOTFALLBACK merges**: FH-10;
  - **once part B and the two perf branches merge**: the rest of round 1's SIM lane;
  - **once render round 2 merges** (after its verify r4): FH-19, FEEL-08 and the other render items that avoid the Worker's render files;
  - **after W0.6**: GUIDE and META, not after W0.3, because their round-1 items need W0.4, W0.5 and W0.6 as well;
  - **after W1.3**: FEEL-02b's recovery check, FH-07b and NEW-03;
  - **after Worker R1, R2 and W0.5**: the WORLD items in `BuildingRenderer`, `TerrainRenderer`, `MiniMap`, `Fireworks` and `EmergencyVehicles` (D13 asks to pull R1 and R2 forward).
  - Round 1's performance sign-off waits for W1.4 (the Worker on by default).
- **Decisions.** The lead has answered D1–D17 (§11); unanswered ones take the recommended default.
- **Baselines** at the merge commit, kept in durable storage, not in `/tmp` scratch:
  - **Why durable.** Today every fixture lives in session scratch: the veteran's saves, the 287k year-20 save, and the 256×60 s7 checkpoints LG-05 needs. Scratch evidence has been lost before (render art r2: the earlier re-review's PNGs "are no longer on disk"). No current-balance y55 save exists either: only y50 saves from part B (`verify-audit-r1/saves`, `verify-factors-r1/saves`), plus a pre-part-B `bot256_s7_y55` from the Sep 28 WASM profile.
  - **What to keep**, under `tests/fixtures/polish/` with the merge commit in the name (or a release asset if size forbids), and referenced from here instead of `S/`:
    - bot rows and two-process hashes for 256×60 s7 and s11 and 128×15 s7: the §8.0 base that every relative target in this plan is measured against;
    - checkpoint saves of 256×60 s7 at y15, y20 (the 287k save), y43 and y55;
    - frame times on the y20 save;
    - first-view screenshots for a new city on each preset.

### 8.1 Round 1: P1 and what unblocks the others (25 items)

| lane | items |
|---|---|
| GUIDE | FH-01, FH-02, FH-22, FH-03, LG-05, FH-05, FH-06, FH-09 (+ first, the TopBar split) |
| SIM | FH-04, FH-07a, FH-10, LG-10 (+ first, `NewsItem.ref`) |
| WORLD | FH-19, FEEL-08, FEEL-04 (if D13), FEEL-11, FEEL-12 (+ FH-20's Emergency palette) |
| CONTENT | LG-01 (+ the art-pipeline stubs) |
| META | FH-08, FH-11, FEEL-02a, FEEL-02b, FEEL-05, FH-21, NEW-04 (+ first, the settings schema) |

**Verifiers check**
1. `tsc`, every vitest suite and the Worker hygiene test.
2. **Bit-identical Medium and Hard**: two-process hashes on 256×60 s7 and s11 and 128×15 s7 before and after FH-04, FH-07a and FEEL-05.
3. **The gate summary**: LG-10 with every flag off reproduces the §8.0 rows; each new row is under `polish`.
4. **Newcomer targets** (FH-10 profile, Easy and Medium; years from founding): at most §15,000 before Play; 2,500 residents by year 3 on Easy and year 4 on Medium; no brownout before year 4.
5. **A scripted real-input first city** that follows only the guide, at 1280×720.
6. **The pacing probes**: 5 minutes at ultra on a save of 100k or more, and 10 minutes each at 1× and 2×, within FEEL-02a's and FEEL-02b's limits.
7. **The spring start**: a new city opens on 1 April; an old save opens exactly as before.
8. **Storage**: NEW-04's second-tab and quota tests; FH-21's context-loss test.
9. **Performance**: at most +1 ms a frame on the y20 save; FEEL-04's 1,000-building flip under 20 ms a frame.
10. **Personas** P-1, P-4 and P-5 (P-5 sets its accessibility options from the title screen once FH-23 lands; until then from the in-city panel).

FEEL-05 is P2 and does not gate round-1 sign-off.

### 8.2 Round 2: the first-hour depth and the first long-game systems (30 items)

| lane | items |
|---|---|
| GUIDE | FH-18, FH-17, FH-14, FEEL-19, FH-15, FH-16, FH-13, FEEL-03, NEW-06, NEW-07 |
| SIM | NEW-05 (first, if triage did not take PB-TAXRESPONSE), LG-09, LG-06, LG-07, LG-08, LG-03 (framework and Express Metro), FH-07b (after W1.3) |
| WORLD | FEEL-09, FEEL-10, NEW-02, FEEL-14, FEEL-15, FEEL-17 |
| CONTENT | FEEL-06, LG-21 (+ LG-03's defs and models) |
| META | FH-12, FEEL-01, FH-23, FEEL-21, NEW-03 (after W1.3) |

**Verifiers check**
1. Everything automatic from round 1, plus FEEL-02b's recovery check once W1.3 has landed.
2. **The tax sweep** (PB-TAXRESPONSE or NEW-05): 10–14% monotone, each point above 10% costing 3–15% of the population.
3. **The variants**: `--neglect` (LG-06), `--skip dirty` (LG-07) and `--skip transit` (LG-08) reach their targets, and base rows stay within each item's tolerance of the §8.0 base.
4. **Hard** (LG-09): funds at most 0.5× or population at most 0.9× Medium in every year 2010–15 on 128×15 s7, with Medium still bit-identical.
5. **Mega-project framework** (LG-03): installments, pause, cancel and save/load in mid-construction; the Express Metro effect.
6. **Moments**: FEEL-06 cards (at most 1 per 30 s at ultra); LG-21's review every New Year at 1× and every second one at 2×, with its grade tests.
7. **Saves** (NEW-03): the bulldoze-and-restore fingerprint test; exit without saving.
8. **World feedback cost**: a 200-building bulldoze adds under 4 ms and at most 600 particles; garbage adds 1 draw call.
9. **Access**: FH-23 at +30% at 1280×720 (no text under 12 rendered px), set from the title screen; FEEL-21 with the OS set to reduced motion; FH-12's one-click start.
10. **Personas** P-1, P-2 (the briefing and the first hour), P-3 and P-4.

### 8.3 Round 3: the long game (12 items)

| lane | items |
|---|---|
| SIM | LG-16, LG-15, LG-04, LG-19, LG-18 (+ LG-03 Fusion, Expo and Space Center) |
| WORLD | FEEL-18, FH-20 |
| CONTENT | LG-20, LG-02, NEW-01 |
| META | LG-12, LG-14 |
| GUIDE | the UI parts of LG-16, LG-19 and LG-04 |

**Verifiers check**
1. **The long-game targets** on 256×60 s7 with every long-game flag on: bank at most 12 months of expenses in 2045; tax at 8% or more while saving; unemployment in 2060 at most 6%; growth at least 2% a year in 2056–60; the ladder replay shows no gap over 5 years.
2. **Tourism** within 0.7–1.3 from year 15 on all three gate runs (LG-02).
3. **Council and disasters**: the LG-16 petition test, LG-15's frequency setting and the EOC A/B.
4. **Variety**: same-model twins at most 5% of growables, and no more than 2 identical facades in a row in 10 suburb shots (NEW-01).
5. **Region and scenarios**: a sister city from the y43 checkpoint (LG-12), with exactly one endowment transfer after a killed tab; three scenarios where the bot reaches bronze and a do-nothing run fails, Lights Out's single-plant run at most bronze, and every bundle loads (LG-14).
6. **Colour**: all five pairs at least 120 apart in the safe mode under deuteranopia and protanopia, Machado 2009 in linear RGB (FH-20); FEEL-18's A/B.
7. **Personas** P-2 (the whole endgame), P-3 and P-6.

### 8.4 Round 4: delight (21 items)

| lane | items |
|---|---|
| SIM | LG-25, LG-17, LG-22, LG-23, LG-26, LG-11 |
| WORLD | FEEL-16, FEEL-28, FEEL-07, FEEL-27, FEEL-24, FEEL-25, FEEL-23, FEEL-29, FEEL-13, FH-25 |
| CONTENT | FH-26, FEEL-20, FEEL-22 |
| META | LG-13, LG-24 |
| GUIDE | the UI parts of LG-11 and LG-23 (Budget tabs) and FEEL-22 (inspector line) |

**Verifiers check**
1. Everything automatic so far, plus determinism with FEEL-20's hash picks and FEEL-23's weather function.
2. **Gate runs**: one per charter (LG-17), a re-run for LG-22's deals, and LG-25's crises kept out of the gate counters.
3. **Frame budgets**: pedestrians at most 0.8 ms (FEEL-25), icons at most 0.3 ms (FEEL-28), weather at most 0.5 ms of GPU (FEEL-23); at most +1 ms for the whole round.
4. **Camera**: FEEL-07 back within 9 s, FEEL-27's fly-in, FEEL-24's photo mode restoring the layout.
5. **Region**: LG-13's dashboard, LG-11's deals and LG-24's visits.
6. **All six personas**, as the final pass.

### 8.5 Verify until dry

- **Findings.** Verifiers file each finding with a severity (P1, P2 or P3, as defined in "How to read this plan") and its evidence: a screenshot, a log line, a bot-table number or a `file:line`.
- **Fixing.** P1 and P2 findings are fixed within the round and verified again.
- **Dry** means one full pass of the round's personas with no new P1 or P2 finding.
- **P3 findings** move to the next round (round 4's go to a final polish list).
- **Escalation.** A round that is not dry after 3 passes goes to the lead, who cuts the item, defers it, or extends the round.

## 9. Playtest personas

Each round's verifiers play the personas §8 names, record the listed numbers, and file findings with evidence. The "finding" column is what counts as P1 or P2 for that persona; anything else is P3.

| persona | setup | script and records | counts as a P1/P2 finding |
|---|---|---|---|
| **P-1 First-time builder** | fresh profile; 1280×720; mouse; one-click start (FH-12) | follows only the guide for 45 real minutes. Records: time to the first road, day-0 spending, population and approval at each New Year, every deficit month and the reason shown | stuck for more than 60 s; a step ticks while nothing can grow; a deficit over 3 months with no explanation; jargon without its plain name; a shown number more than 15% off what happens; approval under 40% for over a year with no explanation; G9 not reached by year 3 on Easy (years from founding); a brownout before year 4 with no G10 or E12 |
| **P-2 SimCity 4 veteran** | ticks "I've played city builders before"; Medium; the y20 and y43 checkpoints (§8.0; today the veteran's `veteran/big_256x45_s7_y21.metropolis` and `_y43.metropolis` in scratch) | builds a 30k city from scratch, then takes the year-43 save through every endgame option: projects, arcologies, expansion, ordinances, charter, sister city, deals | a rule that differs from SC4 and is never stated; a year with no visible next goal; money idle for more than 12 months of expenses with nothing worth buying; two pieces of advice that contradict; a decision with no visible effect within 2 game years |
| **P-3 Min-maxer** | Medium and Easy; sandbox for setup | hunts exploits: refund loops and undo (FH-07a, FH-07b), project cancel (LG-03), endowment shuttling (LG-12), dead-end highway stubs for cap relief (veteran #6), deals with an unplayed neighbour (LG-11), taxes at 0%, 12% and 20% (veteran #1's free 12%), funding at 0% and 120%, an arcology on fresh land, the zoo's label against its effect after PB-ZOO, money farming on Easy, restoring save history to undo a bad bet (NEW-03) | a gain with no cost; a shown effect more than 15% off the measured one; a behaviour that would move a gate and has no test |
| **P-4 Casual at ultra** | a save of 100k or more; sound on; 1080p | plays 30 real minutes at ultra, reacting only to what the game raises | more than 2 fanfares in 5 minutes; any autosave chime; more than 8 toasts in a minute; a headline that can't be read in full; audio fatigue (constant sirens, no music rests); music still playing in a background tab; a spotlight starting during a drag |
| **P-5 Low-end laptop** | 4 cores (`hardwareConcurrency` 4, CPU throttled 4×); 1366×768, then 1280×720; trackpad only, with no middle button; AZERTY; text +30% and reduced motion, set from the title screen before founding (FH-23) | a fresh profile through the first city, then a 100k save; one forced context loss (`WEBGL_lose_context`). Records the time from "Found City" to the first interactive frame | the first run not on Medium or lower; under 25 fps with no prompt; anything that needs a middle button; WASD (ZQSD) moving the wrong way; speed keys or brush keys that do nothing on AZERTY; clipped text or controls; any motion with reduced motion on; a context loss that leaves a dead view |
| **P-6 Colour-blind** | Red-green safe mode, set from the title screen before founding (FH-23); screenshots run through the Machado 2009 deuteranopia and protanopia simulations at full severity, in linear RGB | every data view, the Emergency view, zones, desirability and the HUD good/bad colours | any key pair under 120 RGB apart under either simulation; any state shown by colour alone; a text that names a colour instead of a legend label |

## 10. Out of scope

- **Drive-through city mode**: postponed by the lead, not planned here.
- **Work owned by other phases**: the part-B bugs and fixes (PB-*), render round 2's findings (R2-*), million-pop performance and the Worker (W*). This plan only depends on them.
- **Considered and dropped**:
  - the two audio "defaults tables" (no player effect; see "Where the drafts were wrong", point 2);
  - a crime-term fade on Medium by default (only if FH-10 shows the need; D3);
  - mutual aid between stations on Easy;
  - weather with simulation effects (FEEL-23 is visual and audio only);
  - pedestrian agents with their own trips (FEEL-25 draws density, not agents);
  - multi-day or unlimited undo (FH-07b keeps the current game day; NEW-03's save history covers bigger regrets);
  - a separate tutorial campaign (the guide teaches inside the player's own first city);
  - localisation, gamepad and touch-first controls;
  - the late-teens tourism spike;
  - adaptive music stems;
  - multiplayer and mods;
  - changes to transit pathing.
- **The zoo.** Its label is true: its demand-cap relief is R +40,000 and C +8,000 (`catalog.ts:521`), and it can be placed (`shots2/sbi_09_zoo`). Its visitor-draw calibration is PB-ZOO. Persona P-3 checks label against effect afterwards.

## 11. Open decisions for the lead

### Lead answers (Oct 13, 18:45 UTC)

- **D14: changed.** Veteran #1 (taxes up to 13% are nearly free under the growth throughput cap) belongs to **this polish pass**, not part-B triage. Lead decision 16b in the sim-depth routed list already sends it here.
  - A fix moves every growth trajectory, so it needs a fresh balance acceptance.
  - The SIM lane runs one anyway; part B's final-fix loop does not.
  - NEW-05 is therefore **P1 and the first SIM item**, as soon as part B and the two perf branches are merged. Goal 6, LG-03, LG-16, FH-09 and LG-13 depend on it as the table says.
- **D1: accepted, with one change.** The "can start now" subset (FEEL-11 audio parts, FEEL-12, LG-01 ranks, the §4 copy module, new-file art) waits until part B's final-fix lanes have been assigned their files. Triage may give `src/audio/**` or `src/sim/economy/rewards.ts` to a final-fix lane, and starting earlier would not bring the finish date forward: the weekly usage allowance is the bottleneck, not parallel capacity.
- **D13: accepted.** The million-pop performance phase lands Worker render steps R1 and R2 right after W0.5.
- **D2-D12, D15-D17: the recommended defaults are accepted as written.**

Each decision has a recommended default, which applies if the lead does not answer before round 1.

| # | decision | recommended default | affects |
|---|---|---|---|
| D1 | When implementation starts relative to the in-flight work | Planning is not blocked; implementation starts in stages. Now: FEEL-11's audio parts, FEEL-12, LG-01's ranks in `rewards.ts`, the §4 copy module and new-file art. FH-10 after PB-BOTFALLBACK. The SIM lane after part B and the two perf merges. FH-19 and FEEL-08 after render round 2. GUIDE and META after W0.6 (not W0.3). FEEL-02b's recovery check, FH-07b and NEW-03 after W1.3. WORLD items in the Worker's render files after R1, R2 and W0.5. Round 1's performance sign-off after W1.4. (Alternative: wait for W1.4 for everything, which costs about 7–9 weeks of the Worker's critical path.) | every lane |
| D2 | A `polish` fixture key for bot rows that change by design | Yes, with the lead's sign-off per run, as for LD11 and LD14a | LG-10 and every SIM item |
| D3 | How far Easy goes | Easy only gets FH-04's grace. A Medium crime fade only if FH-10 shows Medium under 40% for 3 years or more even with FH-03. LG-09's extra Easy rules only if the newcomer targets are missed. | FH-04, LG-09 |
| D4 | Hard and Expert endings | Hard: removal after 12 bankrupt months, with Continue in sandbox or "Restore" of a save from before the streak (NEW-03), never a reload of the latest autosave. Expert: also no loans after year 5. | LG-09, LG-16, NEW-03 |
| D5 | Refunds and undo | FH-07a (P1, round 1): 100% on the same game day, 50% under 30 days. FH-07b (P2, after W1.3): Ctrl+Z for up to 20 actions made while paused or within the current day, journaled as inverse commands. | FH-07a, FH-07b |
| D6 | Autosave floor | 60 s of real time, silent | FEEL-02b |
| D7 | Where the new Statue condition applies | All difficulties | FH-26 |
| D8 | Who owns twins and repetition | This polish pass (NEW-01), since render round 2 left them out | NEW-01 |
| D9 | Scenario scope | 3 scenarios first (Boomtown, Lights Out, Smog City); the other 3 after a playtest | LG-14 |
| D10 | Council thresholds | 55% for mega-projects and loans over §500k, 65% for the Arcology, Fusion and World Expo; petition consequences as in LG-16 | LG-16 |
| D11 | Which cities start on 1 April | Every new city, including sandbox and Boomtown; bundled scenarios keep their own date | FEEL-05, LG-14 |
| D12 | How deep the region goes | LG-12 in round 3; LG-11 and LG-13 as P3 in round 4, both gated on PB-REGION | LG-11, LG-12, LG-13 |
| D13 | Pull the Worker's render steps R1 and R2 forward | Yes: ask the render owner to land R1 (`TerrainRenderer` dirty rects, 1–2 days) and R2 (`BuildingRenderer.add` budget, `MiniMap.paintBase` throttle, incremental `collectLaunchSites`, 3–5 days) right after W0.5. They are render-only and need no W1.x step. If declined, FEEL-04 moves to round 2, and every other item in those files waits for R2 at the end of the Worker's critical path, whatever its round. | FEEL-04, FEEL-14, FEEL-15, FEEL-18, FEEL-28, FEEL-06, NEW-02 |
| D14 | Who owns veteran #1 (taxes up to 13% are nearly free) | Part-B triage, as PB-TAXRESPONSE: the throughput cap hides every demand lever (tax, approval, region), so it is a sim response bug more than a polish feature. If triage declines, NEW-05 runs first in round 2. | Goal 6, NEW-05, LG-03, LG-16, FH-09, LG-13 |
| D15 | Save history depth and cost | 3 autosaves at least 5 real minutes apart, plus the last manual save. Demoted slots are gzipped in the worker (about 4.4 MB each at 1M); the live record stays uncompressed, as `WORKER_DESIGN.md` §4.2 decided. | NEW-03 |
| D16 | A second tab on the same region | A Web Lock per region (every city save rewrites the region record). The second tab opens read-only with "Use it here instead". | NEW-04 |
| D17 | New Year pacing at 1× and 2× | A full show on the first New Year, on rank-up years and at most once per 10 real minutes; other years a burst of at most 12 s; "Every year" stays a setting. | FEEL-02a, LG-21 |

## Appendix: Critique log

Each of the 42 critique points was checked against the code at `dffea6f`, the inputs in `S/polish/inputs/` (veteran.json included) and the screenshots it cites. None was rejected outright: 8 were applied with a correction (points 1, 3, 4, 5, 13, 32, 34, 35) and 5 were extended (7, 18, 23, 31, 39).

1. **Applied, corrected.** W0.5's `overlays.ts` is the sim raster cache `src/sim/infra/overlays.ts`, not `src/render/world/overlays.ts`. NEW-02 and FH-20 still collide through `BuildingRenderer` (R2) and `TerrainRenderer` (W0.5, R1). FEEL-15 and FEEL-28 (also `BuildingRenderer`) were added, and D13 asks to pull R1 and R2 forward.
2. **Applied.** FEEL-02a (P1, round 1, on PB-NEWYEAR) and FEEL-02b (P1, after W0.6; recovery check after W1.3).
3. **Applied, acceptance corrected.** The numbers hold: `COUNTDOWN` 3.6 s; at 2× the cinematic budget is 19.2 s, under 20, so a 39.6 s fireworks-mode show; at 1× a 73.2 s cinematic plus 3.6–6.8 s. But "at most 60 s of fireworks in 10 minutes at 2×" contradicts the proposed rule itself (one 43 s show plus seven 12 s bursts is about 127 s). The acceptance is now "at most 2 full shows and fireworks at most 25% of real time". A 3-minute minimum between full shows keeps Goal 8 at ultra, and an "Every year" setting was added (D17).
4. **Applied, corrected** as NEW-03 (P1, META, round 2 after W0.6 and W1.3). Autosave slots are at least 5 real minutes apart, because 3 slots at the 60 s floor would cover only 3 minutes. Only demoted slots are compressed, in the worker, because `WORKER_DESIGN.md` §4.2 keeps the live record uncompressed (gzip costs 114–209 ms at 1M).
5. **Applied, corrected** as NEW-04 (P1, META, round 1 after W0.6). The Web Lock is per region, not per city, because every city save rewrites the whole region record (`main.ts:691`). The existing toast for a missing IndexedDB (`main.ts:239`) is noted.
6. **Applied.** The title-screen "Accessibility & interface" section lives in FH-23, and FEEL-21 and FH-20 list `dialogs.ts`. The accessibility keys live in `AppSettings`, and P-5 and P-6 set them from the title screen.
7. **Applied, extended.** `NewYear.ts`'s `CAMERA_KEYS` and `CityScene.consume` also read `e.key`, and on Colemak the S position types 'r'. "A Mac keyboard has no Delete key" is softened to "a Mac laptop's delete key sends Backspace".
8. **Applied.** Veteran #1's numbers were checked in `veteran.json` and `runs/tax12_128x15_s7.log`. Added the PB-TAXRESPONSE row, the dependency for Goal 6, LG-03, LG-16 and FH-09, the conditional NEW-05 (SIM, P1, round 2), and D14, which recommends that triage owns it.
9. **Applied.** The slider classes were checked (`BudgetPanel.ts:401-402`: amber above 12, red above 15). The hint, the colours and E8 changed. The red threshold is re-derived once the tax response is fixed.
10. **Applied.** `APPROVAL.ema` is 0.3 (`tuning.ts:667`, used at `approval.ts:327`). Goal 2 and FH-09 compare against `approvalRaw`.
11. **Applied.** Checked `catalog.ts:255-257` (3 MW flat, up to 7 on a hilltop) and `WIND_SPACING` (`actions.ts:123`). Three flat turbines make 9 MW, about 2,700 residents, so the text says "about 2,500". The loading-screen tip was fixed too.
12. **Applied.** G10 and E12 were added. The gas plant costs about §120 a month at a small town's load (`UTIL_FIXED` 0.15), so it is a real option; turbines are offered first.
13. **Applied, corrected** as NEW-06 (P2). The Seaport's coastline condition becomes "a valid shore site". A population landmark keeps its unlock and shows "No shore site on this map" instead, because blocking it would hide a promised reward and move bot rows. The cause was checked: footprints must be on land and only the first front row counts (`actions.ts:556-578`), so a 45° coast never passes for a lot 3 or more cells wide.
14. **Applied** to FH-21: there is no `webglcontextlost` listener in `src`, only the start-up check (`CityScene.ts:471`).
15. **Applied** to FEEL-11: `AudioEngine.suspend` is never called, and the music director keeps a 4 s lookahead while hidden.
16. **Applied** to FH-23, with GUIDE adding the handlers. The top-bar segments are click-only `div`s, so they must become focusable before Tab can reach them.
17. **Applied.** A veteran table with an owner and polish mapping for each finding; #5 (the month-tick stall) goes to million-pop performance (S4), which the critique left unmapped.
18. **Applied, extended.** A routed-items table and NEW-07. Items 8 and 15 are in the same "final-fix / polish" group and also had no owner, so they were added. Item 10 maps to PB-STAFF and 11 to PB-NOROAD, since those fixes rewrite the same functions. Items 53–57 belong to the final-fix lanes (lead decision 10), so they stay there, with NEW-07 as the fallback for 55 and 57.
19. **Applied.** `clamp(240px, 50% − 340px, 460px)` inside the zoom-0.8 root gives 460 css px, about 368 screen px; `shots2/010` shows about 365 px.
20. **Applied.** Help does list "Pan W A S D" (`Modals.ts:202`). `AdvisorsPanel.ts:52` repeats the "power lines" mistake, and FH-18's text test covers both strings.
21. **Applied.** All four claims hold: `computeCore` returns null for a fresh city (`growth.ts:107`); `advisors.ts:144` schedules a day-90 city's first headline for day 120, 30 days after founding instead of 45; the minimap calls `focusOn` directly (`MiniMap.ts:58-75`); and old Easy saves change.
22. **Applied.** FH-07a (P1, round 1) and FH-07b (P2, round 2 after W1.3). The chip shows only while undo is available.
23. **Applied, extended.** Besides undo, a bulldoze must journal the refund it was charged, because replay runs every command at the base's day and would otherwise give an older building the same-day 100% refund.
24. **Applied.** The single saved stream was checked (`emergency.ts:724`, `:875-877`, `:925`). Crises get their own stream and a `crises` flag that is off in `simbot.ts`.
25. **Applied.** The §5.4 row lists every news and advice writer under FH-03's rule, and FEEL-20, FEEL-23 and FEEL-29 changed their acceptance. The audit's hash covers layers, buildings, stats, `systemData`, budget and scalars, so `systemData.advisors` alone breaks bit-identity.
26. **Applied.** `NewsItem.ref` lands with round 1's interfaces (§7.4, §7.6). FH-03, FEEL-06 and FEEL-02a's queue key on it.
27. **Applied.** Round 1 starts with GUIDE splitting TopBar, and the §7.3 row was rewritten.
28. **Applied.** FEEL-05 composites the tint over the cached base, and its acceptance counts `paintBase` calls.
29. **Applied.** Risk lines were added to FEEL-18 and NEW-02, and NEW-02 uses the overlay uniform or an attribute.
30. **Applied.** FEEL-11's siren sub-part depends on W0.2 and W0.5; the rest of FEEL-11 can start now.
31. **Applied, extended.** All four notes. PB-PANELS was also added to FH-03, which edits `AdvisorsPanel.ts` too.
32. **Applied, corrected.** A `bot256_s7_y55.metropolis` does exist (the Sep 28 WASM profile fixtures), but it predates part B; current-balance saves stop at y50. §8.0 regenerates the y15, y20, y43 and y55 checkpoints into durable storage.
33. **Applied.** LG-06, LG-07, LG-08, LG-16 and LG-02 now use relative targets, and "How to read this plan" states the rule.
34. **Applied, corrected.** Recomputed: deuteranopia 77, 66, 79, 47, 46 and 213 in linear RGB; R vs I is 99 in gamma space. Under protanopia, Emergency automatic vs out of reach is 56: below its deuteranopia value (66), but not below the table's lowest (46 and 47), so "worse than any pair in the table" is wrong. Added a protanopia column, a tritanopia note (R vs C 30) and a candidate palette that clears 135 under both.
35. **Applied, corrected.** The floor is 12 rendered px (css 12 ÷ zoom), between the critique's two options. 13 px would need a 16.25 css floor, larger than most HUD values, and would likely break the one-line top bar; 11 px is barely above today's 9.2 px.
36. **Applied.** `shots2/024` shows "+302 (23.7%)". The check now uses the building's own expense line and the change in net, with growth frozen.
37. **Applied** (`WORKER_DESIGN.md:852-853`).
38. **Applied** in "How to read this plan" and the named items. FH-10's newcomer profile founds on day 90 like a player's city.
39. **Applied, extended.** All seven. LG-21 got a scoring table and cutoffs, and FH-14 three fixtures. Lights Out also starts with less money than one replacement plant costs; otherwise the new acceptance line could not pass, since one plant brings the city back within 4 months.
40. **Applied, both options.** FH-08 names legend labels, and FH-20's palette moves to round 1. Its hatching stays in round 3, because it needs the terrain shader.
41. **Applied.** FEEL-05 is P2, stays in round 1 and does not gate sign-off.
42. **Applied.** All four. The sandbox shots show "−§11,231/mo" (`hd_01`) and "−§10,861/mo" (`113`).

Found while verifying, outside the critique:
- LG-22 quoted the deals run's 2010 row as its result. It now uses year 15 (194,185 vs 194,627 people; 81.4 vs 78.7 approval).
- `SECONDS_PER_DAY` is at `src/core/constants.ts:34`, not `constants.ts:35`.
- FH-07a's refund rule can move the default bot's rows if the bot bulldozes buildings under 30 days old, so its acceptance logs that count.
- §6.2 row 34 (New Year) was re-rated WEAK once the 1× and 2× shares were measured.
