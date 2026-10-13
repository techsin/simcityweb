# Metropolis polish and fun pass: the plan

Task #32. This is the merged plan from three lens drafts (first hour, long game, feel). It was checked against the code at HEAD `e116226` (clean tree) and against about 55 screenshots on Oct 13 2026. Nothing in it is implemented yet. Implementation agents follow it lane by lane, round by round (§7, §8).

**Is the work blocked?** Writing this plan was not blocked. Implementation is gated on the work in flight, because almost every item touches files those phases are rewriting:
- sim-depth part B final fixes (triage and fix rounds; the new-player and veteran reviewers are still running);
- render round 2 (verify r3 and r4 still to come);
- million-pop performance: merge two branches, then move the sim to a Web Worker (`docs/WORKER_DESIGN.md`, about 7–9 weeks on its critical path).

The plan assumes all three land first. Decision D1 (§11) proposes which lanes can start earlier.

## How to read this plan

- **IDs.** IDs keep the draft prefixes so cross-references stay stable: FH = first hour, LG = long game, FEEL = feel. A merged id points at its survivor. NEW-xx are items this merge added.
- **Priority.**
  - P1: without it a player of this game would be confused or would quit.
  - P2: a player notices it missing or weak, and it costs enjoyment.
  - P3: delight.
- **Size.** S ≤ 2 days, M ≤ 1 week, L > 1 week.
- **Lane and round.** Each item names one owning lane (§7) and one round (§8).
- **File references.** `file:line` references are against `e116226`. The in-flight work will move most lines, so find each hunk by the function or identifier named next to it.
- **Evidence paths.** `S` = `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad`.
  - `shots2/NNN` = `S/simB/verify-playtest-r1/shots2/`: the real-input playtest, a Medium city "Queensbury" plus a sandbox "Fairland".
  - `newplayer/NNN` = `S/simB/verify-newplayer-r1/shots/`: the new-player reviewer's Medium city "Sunside". That reviewer is still running.
  - `cmp/` = `S/render2/artrev-r2/cmp/` (A|B art comparisons).
  - `veteran/` = `S/simB/verify-veteran-r1/runs/`.
  - `G_256x60_s7` = `S/simB/wp6b-r3/runs/G_256x60_s7.json`, the final seed-7 bot run.
  - "acceptance r3", "balance r3", "playtest", "factors", "audit" = the files in `S/polish/inputs/`.
- **Money.** The game shows §. Bot tables print $. They are the same unit.

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
| R2-NIGHT, R2-SEASONS, R2-LW | render round 2 | Night-window LOD patch. Bare and evergreen impostors, winter lot crowns. Festoons, crown wireframe, glass checkerboard, polytunnels, Seagram band, GPU cut. |
| W0.2 … W1.4 | Worker phase, `WORKER_DESIGN.md` §6 | W0.2 commands, `Tool.commit`, `host.setSpeed`. W0.3 queries and watches. W0.4 `LivePolicy` in `src/game/emergencyPolicy.ts`. W0.5 views and the news sequence number. W0.6 saves through the host. W1.x protocol, replica and worker. S4 spreads the month tick. |

### Where the drafts were wrong, and what this plan changed

1. **Autosave runs every 3 game months in the real game, not every 6.** The app setting defaults to 3 (`src/region/settings.ts:19`) and overrides the game default when `main.ts:542` builds the scene. That is a save every 45 s at 1× and every 4.5 s at ultra, each with a chime and a pill. `WORKER_DESIGN.md` §4.2 gives the same number. FEEL-02 is corrected.
2. **The two audio "defaults tables" have no player effect.** `CityScene.syncVolumesFromAudio` (`CityScene.ts:1094-1105`) makes the AudioEngine the single source of truth. FEEL-11 part 4 is dropped.
3. **Reaching 1M does not get "the same chime as 2,500".** 1M is in GameSounds' milestone list and plays pitched up; 2,500 gets the generic chime (`GameSounds.ts:41`, `:142-153`). The real gap is the missing card or visual (FEEL-06).
4. **The spring start is low-risk.** Every "day > 0 means resumed" heuristic also requires stored data, which a fresh city lacks: `approval.ts:232`, `demand.ts:370`, `desirability.ts:570`, `landValue.ts:523`, `tourism.ts:532`, and `population.ts:303` through `savedGrids`. The only exception is `growth.ts:897`, which computes a harmless early downtown core. `CityScene.newCity` is already keyed on the camera and buildings, not on day 0 (`CityScene.ts:181`), so the backlog's "key the new-city check on a flag" is already done.
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

1. **A first city works.** A first-time player who follows only the in-game guide reaches 2,500 residents by game year 3 on Easy and year 4 on Medium. They spend at most §15,000 before pressing Play, and no deficit lasts more than 3 months unexplained. Checked by the scripted real-input run and by the FH-10 newcomer bot.
2. **Numbers shown before a decision are true.** Upkeep, the budget after placing a building, the approval cost of a tax and the effect of a placement preview all match what happens within ±15% one month later. Checked by unit tests and one-month fixture checks.
3. **Every warning can be acted on.** No advice asks for something impossible: no "zone more" on a full map, and no "healthy surplus" when one service would put the town in deficit. Every red or amber advisor card has a button that opens the fix.
4. **Every first failure is explained once, when it happens.** That covers the first stall, the first deficit, the first emergency, the first approval drop below 45 and the first demand cap. Each explanation names the fix.
5. **There is always a next goal.** From founding to 1.5M a next goal is visible on the HUD. From 2010 to 2056 no gap between unlocks, ranks or honours is longer than 5 game years (256×60 s7 replay).
6. **Money and approval stay decisions after year 30.** With the long-game rules on, the bot holds at most 12 months of expenses in the bank in 2045 (today 19) and keeps taxes at 8% or more while saving (today the 7% floor from 2035). Approval thresholds gate big projects.
7. **Right and wrong choices show in population, not only in approval.** Each of these is a 256×60 or 128×15 bot variant measured against the base run:
   - neglecting emergencies costs at least 2% of the population at year 60 (today +0.4%);
   - skipping transit costs at least 4% at 2040 (today 0.7%);
   - a clean-industry city keeps at least 0.8× the population at 128×15 year 15 (today 0.61×).
8. **Every consequential event is felt within 100 ms**: a world beat, a sound and a UI change. At ultra the game plays at most 2 New Year fanfares, 0 autosave chimes and 8 sim toasts per real minute.
9. **Anyone can play it**: with a trackpad (no middle button), on an AZERTY keyboard, with red-green colour vision (every key colour pair at least 120 RGB apart under simulation), with reduced motion, with text at +30% at 1280×720, and on a 4-core laptop, whose first run picks Medium or lower.
10. **Nothing that already works breaks.** Every gate of acceptance r3 still passes on Medium. Medium and Hard bot runs are bit-identical for every UI-only or Easy-only item. New bot rules record their rows under a separate `polish` fixture key with the lead's sign-off.

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
- **Steps tick when nothing can grow.** Step 2 ticks with zones that touch no road (`shots2/131`). The new player's industry read "Not growing: no road access · No power · No water" (`newplayer/063`).
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

### Long game

- **Unlocks run out.** The last unlock is the Twin Spires at 500k (bot year 2029). Building stages stop at 220k and population news at 1M, so 27 game years pass with no new reward (`rewards.ts:102-104`, `tuning.ts:243-249`, `advisors.ts:107`).
- **Money stops mattering.** The bot banks $3.57M in 2030, $9.38M (19 months of expenses) in 2045 and $17.7M (26 months) in 2060, at the 7% tax floor from 2035 (`G_256x60_s7`). The dearest building costs §200k (`catalog.ts:441`).
- **Approval stops mattering.** It sits at 80–84 from 2030 and moves residential demand by at most 6% (`APPROVAL_R`, `tuning.ts:158`).
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
- **Ultra speed spams.** It plays a New Year fanfare plus an 8 s fireworks show every 18 real seconds, and an autosave chime and pill every 4.5 s. The news ticker shows fragments such as "g garden gnomes." (`shots2/i01`) and "— zone more commercial land." (`shots2/091`).
- **The camera works against the player.** Jumps smear across the map in about 0.4 s (`shots2/041`). Nothing follows the truck the player sent. A left drag never pans in the city (`CameraController.ts:4-8`), and AZERTY's WASD rotates instead of panning (`CameraController.ts:337-344`).
- **Accessibility is missing.**
  - No colour-vision mode: R vs I zones go from 192 to 77 RGB apart under deuteranopia, Emergency green vs amber from 183 to 66.
  - No reduced motion.
  - Text cannot grow at 1280 px wide (`zoom.ts:14-18`).
  - `detectQuality()` is never called, so the playtest machine ran at 2–7 s per frame until the tester found Low.

## 3. The plan

There are 81 items: 16 P1, 44 P2 and 21 P3. The drafts also had 81 items (26 first hour, 26 long game, 29 feel):
- FH-24 is merged into FEEL-21, and FEEL-26 into LG-21.
- The AZERTY movement fix moved from FH-25 to FH-19.
- Two items are new: NEW-01 and NEW-02.

Priorities were re-checked across the three lenses:
- P1 is kept for confusion or quitting: a stalled first city, misleading numbers, ultra-speed spam, controls a trackpad can't use, nothing to aim for after 500k, and advice that cannot be followed.
- Several draft P1s and P2s moved down:
  - LG-02, LG-04, LG-06, LG-07, LG-08 and LG-09 → P2;
  - FEEL-07 → P3;
  - LG-11, LG-13, LG-17 and LG-22 → P3.

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
| **C. Money and approval** | | | | | |
| FH-05 | Show what a building does to the monthly budget before it is placed | P1 | S | GUIDE | 1 |
| FH-06 | Approval a newcomer can read | P1 | S | GUIDE | 1 |
| FH-09 | The tax panel tells the truth: approval is lost from 9%, not 12% | P1 | S | GUIDE | 1 |
| FH-07 | Fresh mistakes are free to fix: same-day refunds and Ctrl+Z | P1 | M | SIM | 1 |
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
| FEEL-02 | Ultra speed on real-time budgets: New Year, autosave, toasts | P1 | M | META | 1 |
| FEEL-05 | Found new cities in spring, with a seasonal minimap (lead decision) | P1 | M | META | 1 |
| FEEL-01 | News ticker: newest headline first, one readable clause | P2 | S | META | 2 |
| **I. World and camera** | | | | | |
| FH-19 | Camera controls a laptop player can find (incl. AZERTY movement) | P1 | S | WORLD | 1 |
| FEEL-08 | Camera flights instead of smears for Jump and Focus | P2 | S | WORLD | 1 |
| FEEL-04 | Blackouts you can see | P2 | M | WORLD | 1 |
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
| FH-21 | The first run picks a graphics quality the machine can carry | P1 | S | META | 1 |
| FH-23 | Text that can actually get bigger | P2 | S | META | 2 |
| FEEL-21 | Motion and flashing settings (absorbs FH-24) | P2 | S | META | 2 |
| FH-20 | Colour-blind safe views | P2 | M | WORLD | 3 |
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
  - The bot opens with 3 turbines (`simbot.ts:861-873`): 18 MW of supply for 10 MW of demand at the end of 2001 (`G_256x60_s7`).
- **Step 2 ticks before anything can grow.** It ticks as soon as one R, one C and one I cell exist anywhere (`Onboarding.ts:94-106`).
  - A fresh profile ticked it with zones that touch no road (`shots2/131`).
  - The new player's industry read "Not growing: no road access … No power … No water" while the card showed 4/5 (`newplayer/063`).
- **Step 1 accepts too little.** It accepts any network cell on the map border (`Onboarding.ts:36-44`), while a real neighbour connection needs 6 cells reaching 3 tiles in (`connections.ts:15-18`).
- **No step says how much to zone.**

**Change**
- **Step texts.** Rewrite `STEPS` with the texts in §4 Phase B.
- **Step buttons pre-select the recommended tool** and pulse that flyout item, not only its category: `net:2`, `zone:1`, `plop:util_wind_turbine`, `plop:util_water_tower`. `Toolbar.openFlyout` gets an item argument.
- **Power cards show output.** The Utilities flyout's power cards show output next to the price ("3–7 MW", "400 MW"). The tab header states the town's need: "Your town uses about 1 MW per 300 residents".
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

**Files.** `src/ui/Onboarding.ts` (`edgeRoad`, `STEPS`, `frame`); `src/ui/Toolbar.ts` (`openFlyout` item highlight, power card output); new `src/ui/guide/edgeHint.ts`; `src/ui/zoneStatus.ts` (`lotAccess`, read only).

**Acceptance**
- New `tests/game/onboarding.test.ts`:
  - zones without road access leave step 2 false;
  - 40/8/12 front cells make it true;
  - a 2-cell edge stub leaves step 1 false;
  - a 6-cell road reaching 3 tiles in makes it true;
  - the Power step button leaves `tools.activeId === 'plop:util_wind_turbine'`.
- A scripted real-input first city that follows only the card spends at most §15,000 before Play on Medium. Today it is about §48,400 (`shots2/021`: §51,561 left).
- No step ticks while every zoned lot reads "Not growing".
- The islands preset on a 64 tile passes.

**Depends on.** W0.2 (`host.setSpeed`, `Tool.commit`).

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

**Change**
- **A second phase on the same card**, "Your first year", with goals G1–G9 (texts, triggers and done conditions in §4 Phase C).
- **At most two goals are visible.** Each has one action button and a coach mark.
- **Goals tick from the city state** (`stats.population`, `stats.needs`, approval terms, budget ledgers, garbage capacity) and chime when done. The pill reads "3/9 · Take out the trash".
- **G8 opens Why?** expanded with a pulse the first time a home is inspected.
- **Explainers share the goals' queue.** E1–E11 (§4 Phase D) follow the rules in §4.1.

**Files.** `src/ui/Onboarding.ts`; new `src/ui/guide/goals.ts`, `src/ui/guide/coach.ts`, `src/ui/onboarding.css`; `src/game/CityScene.ts` (GUIDE hunk: coach hooks for panels, data views and the RCI segment); `src/ui/TopBar.ts` (coach marks on RCI, budget and approval); `src/ui/panels/InfoPanel.ts` (open Why? once).

**Acceptance**
- On a fresh profile and new city, the card switches to "Your first year" after step 5 and shows G1.
- Never more than two goals are visible.
- Each goal ticks within 1 s of its condition, with one unit test per predicate in `tests/game/onboarding.test.ts`.
- A scripted real-input run that only presses goal buttons reaches G9 (2,500 residents) by the end of game year 3 on Easy and year 4 on Medium.
- The first inspector opened on a home shows Why? expanded.

**Depends on.** FH-01; FH-22 (per-city persistence); FH-05 (budget numbers in G5); PB-UPKEEP (estimates quoted in goal texts); W0.3 (inspector data comes from a watch).

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
- **Roads conduct power** (`Onboarding.ts:109`), yet the welcome tip says "connect it with power lines" (`Notifications.ts:62`).
- **Pipes are automatic**, and only medium and high density need water (`zoneStatus.ts:184-186`).
- **Any road leaving the map edge connects** to the region (`connections.ts`).
- **Uncovered emergencies drop the game to LIVE** and wait for the player (`EmergencyBanner.ts:1-30`).
- **Why? lives collapsed in the inspector** (`InfoPanel.ts:94`).
- **9% tax is neutral**, with −3.5 approval per point above (`tuning.ts:148`, `:656`).

**Change**
- Show the six-bullet briefing (§4 Phase E) instead of the founding steps:
  - when "I've played city builders before" is ticked (FH-11);
  - or when the guide is dismissed within 30 s.
- Buttons: "Got it" and "Show the guided start anyway".
- The welcome tip is fixed in FEEL-01.

**Files.** `src/ui/Onboarding.ts` (briefing variant).

**Acceptance**
- Ticking the veteran box shows the briefing, not the steps.
- The briefing is at most 90 words.
- The ticker tip matches step 3's wording.

**Depends on.** FH-11, FEEL-01.

**Risk.** None.

#### FH-17 · A Mayor's handbook behind F1, and a "?" on every panel
P2 · M · GUIDE · round 2

**Problem**
- **F1 explains very little.** It opens the shortcuts plus three tips (`Modals.ts:237-241`).
- **Most systems are never explained**: data views, Why?, emergencies, demand caps, rewards, loans, approval or garbage.
- **No help where it's needed.** Panels have no help button (`Panel.ts:23-35`), and a tip seen once is gone.
- **Help lists only one way to pan**: "Pan (mouse) Middle-drag" (`Modals.ts:200-208`).

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
- **"Tips you've seen"** lists the explainers E1–E11.

**Files.** `src/ui/Modals.ts` (`HelpPanel`, `SHORTCUTS`); `src/ui/Panel.ts` (header button).

**Acceptance**
- F1 → Emergencies → Show me opens the Emergency data view.
- Every registered panel has a working "?".
- A text test keeps each topic at most 120 words and checks that costs come from `getDef()`.

**Depends on.** FH-02, FH-08, FH-13, FH-19.

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
- **The toast carries a "Zone homes" action**, which selects `zone:1` and pulses Zones. The action comes from a new `src/ui/adviceActions.ts` map {advice id → action}, shared by Toasts and the Advisors panel. META adds the three-line lookup in the Toasts `'news'` handler.
- **The RCI segment shows a small "+ zone" badge** while a family's demand is above 0.5 and fewer than 12 empty front lots exist.
- **The Planning card adds the count**: "4 empty residential lots left — demand wants many more".

**Files.** `src/sim/economy/advisors.ts` (GUIDE hunk: zone rules); new `src/ui/adviceActions.ts`; `src/ui/Notifications.ts` (META: action lookup); `src/ui/TopBar.ts` (RCI badge); `src/ui/panels/AdvisorsPanel.ts`.

**Acceptance**
- In a fixture with R demand above 0.5 and fewer than 12 empty R front tiles, a toast with "Zone homes" appears within one month tick, and at most once per 180 days.
- Clicking it selects `zone:1`.
- The badge shows, and disappears once 12 empty front lots exist.
- The FH-10 newcomer profile, which zones only when this cue fires, passes 5,000 residents by year 4 on Medium.
- `tests/sim/advisors.test.ts` is updated.

**Depends on.** FH-10 (measurement).

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
- On the 256×60 s7 save from 2055, the built-out card appears within one month, and no `zoneC` or `zoneI` card fires while free land is under 1%.
- On a 2015 save it never fires.
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
- In a fixture like Queensbury in Nov 2000 (no landfill, no school, plant out of fire reach), Next step is the landfill, with a Landfill button.
- After one is zoned, the next month's Next step changes.
- A unit test covers the ranking.

**Depends on.** FH-05 (budget-effect helper); PB-BROWNOUT, PB-PARKS, PB-DEPOT (advice texts); W0.3 (`openAdvice` query and `advisorIssues` watch).

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
- After placing it and one month tick, the real net is within ±15% of the predicted "after".
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

**Depends on.** None. Re-check the 45–55% line after FH-04 and the final balance.

**Risk.** The "usual range" sentence must stay true, so derive it from the bot tables.

#### FH-09 · The tax panel tells the truth: approval is lost from 9%, not 12%
P1 · S · GUIDE · round 1

**Problem**
- **The panel points at the wrong threshold.**
  - Its hint says "Taxes above ~12% slow growth and hurt approval" (`BudgetPanel.ts:167`; `shots2/079`, `newplayer/128`).
  - Sliders turn amber only above 12% (`BudgetPanel.ts:401`).
  - The `taxHigh` advice waits for 12% (`advisors.ts:1036-1040`).
- **In fact approval falls 3.5 points for every point above 9%** (`TAX_NEUTRAL` `tuning.ts:148`, `taxPerPoint` `:656`), and demand falls with `TAX_SENS` (`:149`).
- **Players lose approval without warning.** The playtester set 11/11/10 (`shots2/079`) and lost about 7 points with no warning. The bot runs 10.5–11% in years 2–7.

**Change**
- **New hint**: "9% is neutral. Each point above costs approval (−3.5 a point) and some growth; each point below wins approval (+1.5) but less income."
- **Live effects on the rows.** Residential rows show the approval effect ("−7 approval"). Commercial and industrial rows show the demand factor from `taxFactor` ("demand ×0.9").
- **Slider colours.** Sliders turn amber above 9.5% and red above 12%.
- **The `taxHigh` advice** fires from 11%, with the approval cost in its text.

**Files.** `src/ui/panels/BudgetPanel.ts`; `src/sim/economy/advisors.ts` (GUIDE hunk: `taxHigh`); `demand.ts` `taxFactor` (read only).

**Acceptance**
- With All residential at 11%, the rows show "−7 approval" and the new hint.
- The slider has class `warn` at 10%.
- In `tests/sim/advisors.test.ts`, `taxHigh` fires at 11% and mentions approval.

**Depends on.** PB-SLIDER.

**Risk.** Adds advisor news in bot runs (hash note as FH-03).

#### FH-07 · Fresh mistakes are free to fix: same-day refunds and Ctrl+Z
P1 · M · SIM (WORLD adds the key) · round 1

**Problem**
- **Mistakes cost money.** Bulldozing a plopped building refunds nothing, and networks refund 25% (`actions.ts:16-17`; `NETWORK_REFUND` `tuning.ts:637`).
- **There is no undo.** `CityScene.ts:824-830` binds only Ctrl+S.
- **A misplaced coal plant is a quarter of the start money on Medium.** Both real-input players kept an oversized coal plant beside their homes for years instead of moving it (`shots2/i01`: 15% load, "severe stigma within 12 tiles"; `newplayer/146`: smoke over the houses).

**Change**
- **(a) Fresh refunds.**
  - Anything bulldozed on the same game day it was built refunds 100%. The day never advances while paused, so a whole paused planning session is refundable.
  - Plopped buildings under 30 days old refund 50%. After that, today's rules apply.
  - `Building.age` exists already. Roads use a per-day set of fresh cells kept in `CityActions`.
  - The bulldoze tip reads "Refund §25,000 (built today)".
- **(b) Ctrl+Z.**
  - It undoes up to the last 20 player actions of the current game day (road, zone, plop, bulldoze, power line), from inverse records kept by `CityActions`.
  - The chip shows "Undo: Ctrl+Z" for 3 s after an action.
  - The stack clears when the day advances or the city loads.
  - New Worker command `undo`: it counts in `pending`, and its ack is an `ActionResult`.
  - WORLD binds Ctrl+Z in `onKey`.

**Files.** `src/sim/actions.ts` (spend/refund, bulldoze, zone, networks, plop); `src/worker/protocol.ts` and `HostActions` (`undo`); `src/game/demolishRisk.ts` (refund text); `src/game/CityScene.ts` (WORLD hunk: `onKey`).

**Acceptance**
- In `tests/sim/actions.test.ts`:
  - plop a coal plant and bulldoze it the same day: funds equal the pre-plop value;
  - draw a 40-cell road and undo: `network`, `netFlags` and funds equal the before-state (equal hash);
  - after one day passes, undo does nothing and refunds follow the old rules.
- A bot run that never undoes stays bit-identical (256×20 s7, two processes).

**Depends on.** W0.2 and W1.1 (command rows, predictions); PB-NOROAD (the `lotTouchesRoad` change in `actions.ts` lands first).

**Risk.**
- The build-use-refund exploit is limited to the same game day.
- Undo must emit the same events as bulldoze and plop (`networkChanged`, `buildingRemoved`, `powerLinesChanged`) so the caches rebuild.
- Nothing new is saved.

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

**Files.** New `src/ui/FloatText.ts`; `src/game/tools/Tool.ts` (GUIDE hunk: commit feedback); `src/ui/TopBar.ts` (funds and approval blocks).

**Acceptance**
- Placing a coal plant shows exactly `ActionResult.cost` within 100 ms, plus "+§700/mo".
- A failed placement shows no float.
- The funds label passes through at least 3 intermediate values.
- The month chip equals Budget's "Monthly net (recurring)".
- The approval chip names the term that changed most.
- No forced layout is added per frame.

**Depends on.** PB-UPKEEP; W0.2.

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
  - A coach card under the banner reads: "Emergency! Fire at Refinery. No fire station covers this spot, so nobody comes on their own. Send nearest dispatches Fire Station #1 (3.9 min). Green areas in the Emergency view are answered automatically."
  - Buttons: Send nearest, Emergency view, Got it.
- **E1b: the first alerted major incident that is already too far** (`canSend` without `manualPossible`).
  - The card reads: "No station can reach this in time. Build a Fire Station within ~24 road tiles — the Emergency view shows where help is automatic."
  - Buttons: Fire tab, Emergency view.
- **E2: the first LIVE slowdown.** One toast: "LIVE: the game slowed down so you can follow the truck. Your speed comes back when help arrives (Settings → Gameplay)."
- **E3: the first failed incident.** The outcome adds why: "the nearest truck needed 5.6 min; this fire burned out in 5 — a station within ~24 road tiles answers in time."

**Files.** `src/ui/EmergencyBanner.ts`; `src/game/emergencyPolicy.ts`; `src/ui/TopBar.ts` (META hunk: LIVE pill title); `src/ui/emergency.css`.

**Acceptance**
- On a fresh profile, an uncovered fire started with the disaster tool pauses the game and shows the card.
- Send nearest leaves the incident dispatched and closes the card.
- A too-far fire shows E1b.
- A second uncovered fire behaves as today.
- The LIVE toast appears exactly once.
- `tests/game/emergencyPolicy.test.ts` covers the one-shot pause and both variants.

**Depends on.** PB-ACCIDENT, PB-AMBER, PB-COOLDOWN, PB-GRACE (the texts must describe the fixed behaviour); W0.4.

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

**Change.** In the Emergency view, buildings whose response reason is `noRoad` get a red outline or ring decal, or a red tint on the model itself through the city material's overlay path, as well as today's hover text.

**Files.** `src/render/city/buildings/BuildingRenderer.ts` or `src/render/world/overlays.ts`. It reads `overlayReadout`, which is replica-safe.

**Acceptance**
- A roadless Obelisk shows red on its model in the Emergency · Fire view at 300 m and 700 m.
- Buildings with road access are unchanged.
- No amber ring anywhere (A/B screenshots).

**Depends on.** Render round 2.

**Risk.** Render only.

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
- **Rolls are drawn at the end of the emergency system's monthly step**, so the existing RNG order is untouched.

**Files.** `src/sim/infra/emergency.ts`; `src/sim/infra/utilities.ts` (heat wave); `src/ui/EmergencyBanner.ts` (META in round 4: decision buttons); `src/ui/panels/EmergenciesPanel.ts` (META: crisis row).

**Acceptance**
- On a 300k save, a forced high-rise fire shows a banner with two choices, each with its stated outcome.
- Crises are counted in their own Statistics row.
- The auto-dispatch (≥ 85%) and failed (≤ 5%) gates, computed on the existing kinds, are unchanged.

**Depends on.** PB-ACCIDENT, PB-AMBER, PB-COOLDOWN; LG-10.

**Risk.** Keep crises out of the gate counters. Draws stay deterministic.

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
- Old saves keep their behaviour, because the rules key on `config.difficulty`, which is saved with the city.

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

It prints years 1–10: population, approval with its top three terms, funds and failed incidents. Document it in the file header and in `--help` (routed 46).

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
  - after 12 months bankrupt, "The council has removed you", with Continue in sandbox or Reload.
- **Expert** (new): Hard, plus no loans after year 5, disasters ×3 and manual-dispatch windows ×0.75. It earns an Expert badge on the region card.
- **The dialog** gives each card two rule lines (META).
- **Easy** keeps FH-04's rules. The LG draft's extra Easy rules (disasters ×0.5, windows ×1.25, loans −1%) are added only if the newcomer bot still misses its targets (D3).

**Files.** `src/core/types.ts` (`Difficulty` adds `expert`); `src/sim/economy/tuning.ts`, `budget.ts` (bankruptcy end), `opex.ts`, `approval.ts`, `loans.ts`; `src/sim/infra/disasters.ts`, `emergency.ts` (window multiplier); `src/region/NewCityDialog.ts`, `src/region/RegionScreen.ts`, `src/ui/TopBar.ts` difficulty label (META).

**Acceptance**
- Medium bit-identical hashes.
- Hard 128×15 s7: population at year 15 at most 0.85× Medium, or approval at least 5 below Medium in years 2–10. The lowest daily balance stays at or above 0 using loans, so Hard stays winnable.
- Expert: a unit test with a forced 12-month deficit shows the removal screen.

**Depends on.** FH-04; PB-ACCIDENT (window multiplier); LG-10.

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
- Base runs: population within ±0.5% of today's rows; tourism 0.7–1.3 from year 15; failed ≤ 5% from year 10.

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
- Base runs within ±1%. The EQ gate and |unemp − (1 − accW)| ≤ 0.02 hold.
- The `balance.test.ts` check "no smokestack industry: air" (run mean, LD15a) still passes.

**Depends on.** PB-REGION and PB-PARKING (so the industry baseline is final); LG-10.

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

**Files.** `src/sim/economy/growth.ts`, `desirability.ts`; `src/sim/infra/transit.ts` or `transportFacilities.ts` (station list per graph version); `src/ui/panels/StatsPanel.ts` (GUIDE).

**Acceptance.** 256×60 s7 with LG-10's `--subway`:
- `--skip transit` costs at least 4% of the people at 2040 and at least 10% at 2060;
- base population at year 60 stays at or above 1.547M;
- ms/day rises by at most 3 (LD2);
- the average stage within 6 tiles of a station is at least 1.5× the city average.

**Depends on.** PB-COMMUTE; LG-10.

**Risk.**
- More towers near stations means more same-model towers (NEW-01).
- The tower-lot rule is a pure function of the stations, cached per graph version.

#### LG-16 · Approval as political capital
P2 · M · SIM (GUIDE and META add UI) · round 3

**Problem**
- **Late approval buys nothing.** It moves the residential target by at most 6% (`APPROVAL_R` 0.06). Only the Statue asks for it (65%, `rewards.ts:77`).
- **The bot coasts at 80–84 from 2030**, carried by +7 civic, +4 tourism (capped) and +3 low taxes (`G_256x60_s7` `approvalTerms`).
- **The human city spent years at 40–53% with no consequence** (`shots2/058` 40%, `121` 50%).

**Change**
- **Council support.**
  - Mega-projects and loans over §500k need approval of at least 55%. The Arcology, Fusion and the World Expo need 65%.
  - The tool tooltip and the Loans tab show the requirement: "Council support: 62% (55% needed)".
- **Loan rates.** −1% at 70% or more, +2% at 40% or less.
- **Recall petition.**
  - After 12 straight months below 35%, a 3-month petition banner appears. Getting back to 45% ends it.
  - Otherwise, on Medium the council forces taxes down 2 points and freezes ordinance changes for 6 months. On Hard and Expert the term ends (LG-09).

**Files.** `src/sim/economy/projects.ts` (gate), `loans.ts`, `approval.ts` (petition state); `src/sim/economy/advisors.ts` (GUIDE hunk: petition warnings); `src/ui/panels/BudgetPanel.ts` (GUIDE: requirement line); `src/game/toolCatalog.ts` (CONTENT: lock reason); `src/ui/Notifications.ts` (META: petition banner).

**Acceptance**
- A test city held at approval 30% (taxes at 20%) gets the petition at month 12 and, on Medium, the forced cut at month 15.
- At 52% approval the Arcology button reads "Needs council support (approval 52 of 65)".
- Bot gates are unchanged: the formula is untouched, and the bot's approval is 79 or more from 2029.

**Depends on.** LG-03, LG-09.

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
- **Nothing unlocks after the Twin Spires at 500k** (`rewards.ts:102-104`), which the bot reaches in 2029. The next 27 game years to 1.5M (2056) bring no new reward: 32 minutes of pure 2× time, 81 minutes at 1× (`constants.ts:35`).
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

**Files.** `src/sim/economy/rewards.ts`; `src/ui/TopBar.ts` (CONTENT hunk: population segment); `src/ui/panels/ListPanels.ts`; `src/region/citySummary.ts` and `RegionScreen.ts` (META); `src/worker/replicaSafe.ts` (SIM adds the entry).

**Acceptance**
- In a 256×60 s7 replay sampled monthly to 1.5M, the HUD's "next" line is never empty.
- The Milestones tab lists 12 ranks with the current one highlighted.
- `listMilestones` passes `replicaSafe.test`.
- Once LG-02, LG-03 and LG-04 land, no gap between unlocks or rank-ups from 2010 to 2056 is longer than 5 years (today 27).

**Depends on.** None for the ranks. The content that fills the late gaps comes from LG-02, LG-03, LG-04 and LG-20.

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
- **"Place it".** Reward and landmark toasts get this action, which opens Rewards scrolled to the item. META wires it in the Toasts handler.

**Files.** `src/sim/economy/advisors.ts` (CONTENT hunk: milestones and stage news); `src/game/GameSounds.ts` (CONTENT hunk: milestone case, `POP_MILESTONES`); new `src/ui/MilestoneCard.ts`; `src/game/CityScene.ts` (CONTENT wiring block); `src/ui/Notifications.ts` (META: the action).

**Acceptance**
- Crossing 10,000 at 1× shows the card for 4 ± 0.5 s, plays `milestone` once and launches fireworks for at most 10 s.
- Crossing 35,000 posts exactly one tower-unlock item.
- A 256×60 s7 bot run posts all five unlock items once each, and none repeats after save/load.
- Loading a 300k save posts nothing.
- Clicking a reward toast opens Rewards with that row highlighted.
- At ultra, at most 1 card per 30 s.

**Depends on.** FEEL-02, LG-01.

**Risk.** Stage news reads only the population and makes no RNG draw.

#### LG-21 · Year in review and a mayor's grade (absorbs FEEL-26)
P2 · M · CONTENT · round 2

**Problem**
- **The yearly moment is one toast**: "Queensbury celebrates with 6,823 residents · ▲ 125% vs 2001." (`shots2/047`; `NewYear.ts:660-673`). It is the same in year 5 and year 50.
- **The game keeps monthly history** (`HISTORY_KEYS`, `CityState.ts:176-181`) but never says what changed, which records fell or how the city compares.
- **After 2050 there is no yearly feedback at all**, with approval flat at 80–82 and growth under 2%.

**Change**
- **When it appears.** After the New Year show (it waits for `NewYearCelebration.busy` to clear) or on 1 January when the show is off. At speed 2 or below every year; at ultra every 5th year (FEEL-02).
- **The card**, "Queensbury Gazette — 2006", is dismissible and shows:
  - population and growth;
  - the bank in months of expenses;
  - the approval change and its three biggest term changes (`approvalBreakdown`);
  - emergencies answered, failed and lost; tourists; EQ and HQ;
  - records broken this year;
  - goals completed this year and the next three (LG-01);
  - a mayor's grade from A to F (growth 25%, approval 20%, finances 15%, safety 15%, environment 15%, services 10%) with a sparkline of past grades;
  - a region line.
- **Closing.** It closes after 15 s or on any map input, never shows during LIVE, and can be switched off in Settings.

**Files.** New `src/ui/YearReview.ts` (computed UI-side from the history arrays); `src/game/CityScene.ts` (CONTENT wiring block). `NewYear.ts` is not edited.

**Acceptance**
- On a 20-year save the card appears once per New Year and never on load.
- Its population change is within 0.5% of the Graphs panel.
- It names the same approval term as the approval tooltip.
- It is skipped during LIVE.
- The grade is deterministic for a given save.
- The toggle hides it.

**Depends on.** LG-01, FEEL-02, PB-NEWYEAR.

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
- **Money levers do bite when something is at stake.** A flat 15% tax holds a 128 city at 24.7k people for 2009–14 (`veteran/tax15_128x15_s7.log`).

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
  - **SIM**: `projects.ts` (installments, progress counted in days, pause and cancel, `systemData.projects`); the `plop()` project branch in `actions.ts`; the budget line; the `params`/`traffic` multipliers; the expo multiplier in `tourism.ts`; the Worker rows; LG-10 `--megaprojects`.
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

**Depends on.** LG-10; the Worker command rows; render round 2 (construction look on large lots). LG-16 adds council gates later.

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
- The 256×60 s7 bot earns at least 4 by 2060: Megacity, Scholar City (EQ 130+ from 2039), Tourist Capital (66k/day from 2045) and Balanced Books.

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
- With LG-10 buying them on 256×60 s7, each unlock fires in its year: 2016, 2021, 2025, 2033, 2038, 2043, 2056.
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
- Art review A/B at 300 m and 700 m.

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
- **Five charters**: Tourism Capital, Industrial Powerhouse, Knowledge City, Financial Centre and Green City, with the LG draft's effects (for example, Knowledge City: education effectiveness ×1.1, I-HT share max 0.55 from 0.45, I-D demand −10%).
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
- **The downside depends only on distance.** In the veteran's deals run, the dump went in the map corner and that city ended with 102,145 people and 72.7 approval, against 101,331 and 70.9 without it (`veteran/deals_128x15_s7.log` vs `base2`).

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
- **The region could absorb both, but nothing points there.** A connected neighbour's spare jobs already count in the city's job supply (`regionInputs`, `demand.ts:174`; `regionEffects.ts:100-121`). Yet the region screen reads "2 of 106 tiles founded" (`shots2/114`; `RegionScreen.ts:143`).
- **A new neighbour starts from nothing**: §100k on Medium (`config.ts:32-37`), next to a city with millions in the bank.
- **Getting there takes four steps**: Save & exit → region → tile → Found New City (`RegionScreen.ts:206-246`).

**Change**
- **"Found a sister city"** on the built-out advice card (LG-05) and in the pause menu. It saves the city and opens the New City dialog on the best adjacent unfounded tile (the one sharing the longest edge with the parent's edge roads), with the mayor filled in.
- **An endowment slider**: up to 25% of the parent's funds, at most §5M, once per city per 10 game years.
  - It is a one-off expense in the parent, on a "Sister city endowment" line.
  - It is added to the new city's start money.
- **A road stub** continues the parent's edge road into the new tile, so the two connect from day one.
- **Recognition.** The parent gets +1 approval ("Founded a sister city") for 12 months. Sister links show on the region card.

**Files.** `src/region/NewCityDialog.ts`, `src/region/RegionScreen.ts`, `src/main.ts` (city start and exit, `:430-560`), `src/region/regionEffects.ts`, `src/region/types.ts` (`sisterOf`); `src/sim/economy/budget.ts` and `approval.ts` (SIM).

**Acceptance**
- From the veteran's year-43 save (`veteran/big_256x45_s7_y43.metropolis`) with a §2M endowment:
  - the parent shows −§2M once, on the endowment line;
  - the new city opens with §2.1M (§100k + §2M) and a road stub joined to the parent's edge road.
- Sister jobs count for the parent only once the edge is connected (PB-REGION).
- A confirm dialog says the transfer can't be undone. A second endowment within 10 years is refused, with the date it becomes possible.

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
  | Lights Out | a 71k city whose coal plant just burned | back to 70k and approval 60 within 12 / 9 / 6 months |
  | Gridlock | 400k on 256 with no transit | 25% transit trips and a 9-minute commute within 8 years |
  | Island Hopper | the archipelago preset | 3 islands connected, 60k residents in total |
  | Tourist Capital | a 128 tile where dirty industry (I-D) is not allowed | 40k tourists a day |

- **Medals.** Bronze, silver and gold, saved per profile.
- **On screen.** A pinned objectives card that updates monthly, and a win or lose screen.
- **"Mayor's challenges"** for any new city, as toggles in the New City dialog: No loans, No dirty industry, Frequent disasters, Hard money. Each earns a badge on the region card.
- **Ship three scenarios first** (D9): Boomtown, Lights Out and Smog City.

**Files.** `src/region/ui/TitleScreen.ts`; new `src/game/scenarios.ts` and `src/ui/ObjectivesCard.ts`; new `tools/scenarios.ts` (SIM); the bundled-file import through the host; `src/region/NewCityDialog.ts` (the toggles).

**Acceptance**
- Every scenario starts from the menu.
- Each has a bot strategy that reaches bronze and a do-nothing run that fails.
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

**Depends on.** PB-REGION, LG-01.

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
