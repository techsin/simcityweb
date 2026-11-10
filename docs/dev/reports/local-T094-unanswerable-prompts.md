# T094 unanswerable prompts: measurements on dev d83f0d0 (tree read-only, nothing edited)

## The answer in short

At Ultra with the default settings, about four of every five Dispatch prompts cannot be answered, and the sim counts nearly all of them as ignored. The 30 s cooldown causes 63-78% of all prompts to be unanswerable; the player's own speed click causes none.

- **1M city, per real hour at Ultra:** 421-444 prompts, 82-87 answerable, 319-337 lost to the cooldown, 16-25 "busy" calls that never get a banner, 0-3 whose window closed before the banner appeared.
- **304k city** (unattended it grows to about 440k within 4 game years): 436-492 prompts, 78-87 answerable, 310-360 cooldown, 33-42 window closed before the banner (75-99 in the real browser on this loaded machine), 0-6 busy.
- **A player who dispatches everything he can** is still charged 315-367 ignored prompts per real hour, which is 1.9-2.2 per game year.
- **Cost:** 2.6-2.9 approval points at steady state. Dev charges nothing else for them.
- **Bot:** not affected. Its ignored counter is 0 in all 15 years, and 192,899 is reproduced.

## How I measured

- **Harness** (`run.ts`): the tree's own `SimCore` (sim, `LivePolicy`, `speedPolicy`, `AlertQueue`) driven frame by frame on a virtual clock through SimCore's `clock` parameter, with microtasks run after each frame as `LocalSimHost.frame` does. Frames are 59.94 Hz. Each row is 40 virtual minutes; 78 runs.
- **Players**, reacting in real time:
  - *dispatches*: clicks Send nearest 1.0 s after a banner with a usable Send appears.
  - *never*: never sends; clicks Normal speed 2 s into a policy pause and his own speed again 2 s after the episode.
  - *Ultra once*: the dispatcher, but in the first episode he clicks his speed button 1 s after the slow-down instead of sending.
- **Classes.** "Prompted" means the sim set `inc.prompted` at a day's settle point (`emergency.ts:2164`).
  - (a) answerable: the policy paused while the Send was usable, or the Send was usable for at least 1 s of real time.
  - (b) cooldown: the trigger was dropped inside the 30 s after an episode (`SimCore.ts:474`).
  - (c) own click: an episode was open, but the player's speed click had taken the game off the policy's speed.
  - (d) other: four cases, listed in the table.
- **Validation:** six real-browser runs of 20 minutes each on the RTX 5070 Ti, with the same observer injected and real mouse input only. All 115 Send nearest clicks dispatched. The observer's ignored count equals the sim's own monthly counter in all 84 runs.

| 20 real minutes, Ultra | where | game days | prompted | answerable | cooldown | busy / window gone | episodes | counted ignored |
|---|---|---|---|---|---|---|---|---|
| 1M, live, dispatches | browser | 19,181 | 174 | 31 | 123 | 11 / 9 | 27 | 130 |
| | harness, two runs | 19,229; 19,199 | 147; 164 | 30; 31 | 111; 128 | 5 / 1; 4 / 1 | 27; 28 | 109; 124 |
| 1M, live, never | browser | 17,589 | 135 | 26 | 94 | 9 / 5 | 25 | 123 |
| | harness | 17,309 | 167 | 26 | 135 | 6 / 0 | 26 | 154 |
| 1M, live, Ultra once | browser | 19,349 | 171 | 30 | 136 | 3 / 2 | 27 | 135 |
| | harness | 19,589 | 164 | 28 | 127 | 9 / 0 | 28 | 124 |
| 304k, live, dispatches | browser | 18,993 | 175 | 29 | 108 | 3 / 33 | 28 | 145 |
| | harness, two runs | 19,770; 19,620 | 156; 173 | 26; 28 | 112; 131 | 3 / 15; 2 / 12 | 26; 27 | 126; 145 |
| 304k, live, never | browser | 20,201 | 170 | 28 | 111 | 1 / 28 | 28 | 169 |
| | harness | 20,730 | 195 | 29 | 151 | 2 / 12 | 29 | 192 |
| 304k, Pause, dispatches | browser | 23,117 | 190 | 32 | 132 | 0 / 25 | 31 | 158 |
| | harness | 23,340 | 219 | 36 | 169 | 0 / 14 | 34 | 183 |

- **Where the harness differs:** the "window gone" class depends on frame timing. The harness at a steady 59.94 Hz gives 33-42 per hour on the 304k city; with 28% missed refreshes 70; locked at exactly 60 Hz 75-86; the browser gave 75-99.
- **One browser-only artifact:** 4 prompts counted as answerable only because the page stalled for up to 4.6 s.
- **Noise:** harness runs are not bit-identical, because the infra scheduler uses a real-time budget. Replicas differ by about 5%. One incident in 40 minutes is 1.5 per hour.
- **Load:** CPU 96-100% and GPU 39-96% throughout. Machine-wide there were 45-77 node, 22-51 chrome and 0-19 headless_shell processes, including up to 8 harness processes and 2 browsers of mine.
- **QUIET:** every browser launch found the flag absent. It was absent in my 06:28 UTC sample and present at 06:39; my last browser run ended at 06:35, so an overlap of a few minutes is possible. Harness jobs sleep while it exists.

## 1. How often (per real hour; 40 virtual minutes per row)

Column (d) lists: busy, no banner / window gone before the banner / Keep going under 1 s / LIVE under 1 s. The last column is counted ignored per hour, with the unanswerable part in brackets.

**1M city (dense1m_s7, disasters off)**

| speed | policy | player | game yr/h | prompted | (a) | (b) | (c) | (d) | (d) parts | ignored (unanswerable) |
|---|---|---|---|---|---|---|---|---|---|---|
| Ultra | live | dispatches | 163 | 421 | 82 | 319 | 0 | 19 | 16 / 3 / 0 / 0 | 315 (315) |
| Ultra | live | never | 151 | 429 | 78 | 333 | 0 | 18 | 16 / 1.5 / 0 / 0 | 400 (327) |
| Ultra | live | Ultra once | 164 | 432 | 79 | 327 | 0 | 25 | 25 / 0 / 0 / 0 | 316 (315) |
| Ultra | Pause | dispatches | 195 | 493 | 94 | 372 | 0 | 27 | 27 / 0 / 0 / 0 | 361 (361) |
| Ultra | Pause | never | 160 | 445 | 87 | 334 | 0 | 24 | 21 / 3 / 0 / 0 | 409 (327) |
| Ultra | Pause | Ultra once | 195 | 507 | 90 | 393 | 0 | 24 | 21 / 3 / 0 / 0 | 390 (388) |
| Ultra | Keep going | dispatches | 200 | 483 | 1.5 | 0 | 0 | 481 | 13 / 0 / 468 / 0 | 457 (457) |
| Ultra | Keep going | never | 200 | 514 | 1.5 | 0 | 0 | 513 | 19 / 3 / 490 / 0 | 480 (478) |
| Ultra | Keep going | Ultra once | 200 | 549 | 3 | 0 | 0 | 546 | 31 / 4.5 / 510 / 0 | 496 (496) |
| Fast | live | dispatches | 44 | 154 | 99 | 46 | 0 | 9 | 9 / 0 / 0 / 0 | 46 (46) |
| Fast | live | never | 42 | 139 | 108 | 27 | 0 | 4.5 | 4.5 / 0 / 0 / 0 | 132 (27) |
| Fast | live | Ultra once | 45 | 141 | 102 | 31 | 0 | 7.5 | 7.5 / 0 / 0 / 0 | 31 (30) |
| Fast | Pause | dispatches | 49 | 168 | 127 | 31 | 0 | 9 | 9 / 0 / 0 / 0 | 31 (31) |
| Fast | Pause | never | 45 | 138 | 97 | 27 | 3 | 10 | 9 / 1.5 / 0 / 0 | 126 (31) |
| Fast | Pause | Ultra once | 49 | 117 | 96 | 13 | 0 | 7.5 | 7.5 / 0 / 0 / 0 | 15 (13) |
| Fast | Keep going | dispatches | 50 | 154 | 85 | 0 | 0 | 69 | 3 / 0 / 66 / 0 | 66 (66) |
| Fast | Keep going | never | 50 | 159 | 97 | 0 | 0 | 61 | 3 / 0 / 58 / 0 | 148 (58) |
| Fast | Keep going | Ultra once | 50 | 178 | 87 | 0 | 0 | 91 | 6 / 0 / 85 / 0 | 81 (81) |
| 1x | live | dispatches | 19 | 57 | 48 | 4.5 | 0 | 4.5 | 3 / 1.5 / 0 / 0 | 6 (6) |
| 1x | live | never | 17 | 69 | 60 | 4.5 | 0 | 4.5 | 4.5 / 0 / 0 / 0 | 61 (4.5) |
| 1x | live | Ultra once | 19 | 66 | 54 | 9 | 0 | 3 | 1.5 / 0 / 0 / 1.5 | 12 (10) |
| 1x | Pause | dispatches | 20 | 61 | 49 | 9 | 0 | 3 | 3 / 0 / 0 / 0 | 9 (9) |
| 1x | Pause | never | 20 | 58 | 51 | 4.5 | 1.5 | 1.5 | 1.5 / 0 / 0 / 0 | 57 (6) |
| 1x | Pause | Ultra once | 20 | 55 | 45 | 9 | 0 | 1.5 | 1.5 / 0 / 0 / 0 | 10 (9) |
| 1x | Keep going | dispatches | 20 | 81 | 48 | 0 | 0 | 33 | 6 / 0 / 27 / 0 | 27 (27) |
| 1x | Keep going | never | 20 | 58 | 28 | 0 | 0 | 30 | 3 / 0 / 27 / 0 | 52 (27) |
| 1x | Keep going | Ultra once | 20 | 69 | 37 | 0 | 0 | 31 | 3 / 0 / 28 / 0 | 28 (28) |

**304k city (vet_s7_y21, disasters off)**

| speed | policy | player | game yr/h | prompted | (a) | (b) | (c) | (d) | (d) parts | ignored (unanswerable) |
|---|---|---|---|---|---|---|---|---|---|---|
| Ultra | live | dispatches | 165 | 436 | 78 | 310 | 0 | 48 | 4.5 / 42 / 0 / 1.5 | 352 (352) |
| Ultra | live | never | 175 | 492 | 87 | 360 | 0 | 45 | 6 / 37 / 0 / 1.5 | 486 (399) |
| Ultra | live | Ultra once | 165 | 472 | 79 | 355 | 0 | 37 | 0 / 33 / 0 / 4.5 | 390 (388) |
| Ultra | Pause | dispatches | 195 | 570 | 100 | 427 | 0 | 42 | 0 / 42 / 0 / 0 | 469 (469) |
| Ultra | Pause | never | 179 | 484 | 90 | 357 | 0 | 37 | 6 / 30 / 0 / 1.5 | 480 (390) |
| Ultra | Pause | Ultra once | 195 | 535 | 94 | 399 | 0 | 42 | 1.5 / 40 / 0 / 0 | 442 (441) |
| Ultra | Keep going | dispatches | 200 | 499 | 0 | 0 | 0 | 499 | 4.5 / 33 / 462 / 0 | 496 (496) |
| Ultra | Keep going | never | 200 | 502 | 1.5 | 0 | 0 | 501 | 6 / 42 / 453 / 0 | 498 (496) |
| Ultra | Keep going | Ultra once | 200 | 498 | 0 | 0 | 0 | 498 | 4.5 / 28 / 465 / 0 | 493 (493) |
| Fast | live | dispatches | 44 | 162 | 82 | 75 | 0 | 4.5 | 1.5 / 1.5 / 0 / 1.5 | 79 (79) |
| Fast | live | never | 46 | 150 | 75 | 75 | 0 | 0 | 0 / 0 / 0 / 0 | 150 (75) |
| Fast | live | Ultra once | 44 | 135 | 70 | 57 | 0 | 7.5 | 1.5 / 4.5 / 0 / 1.5 | 66 (64) |
| Fast | Pause | dispatches | 49 | 172 | 84 | 85 | 0 | 3 | 1.5 / 1.5 / 0 / 0 | 87 (87) |
| Fast | Pause | never | 47 | 136 | 58 | 75 | 0 | 3 | 0 / 3 / 0 / 0 | 136 (78) |
| Fast | Pause | Ultra once | 49 | 177 | 79 | 96 | 0 | 1.5 | 0 / 1.5 / 0 / 0 | 99 (97) |
| Fast | Keep going | dispatches | 50 | 177 | 18 | 0 | 0 | 159 | 0 / 1.5 / 157 / 0 | 159 (159) |
| Fast | Keep going | never | 50 | 177 | 10 | 0 | 0 | 166 | 0 / 4.5 / 162 / 0 | 177 (166) |
| Fast | Keep going | Ultra once | 50 | 175 | 18 | 0 | 0 | 157 | 1.5 / 1.5 / 154 / 0 | 156 (156) |
| 1x | live | dispatches | 19 | 42 | 33 | 6 | 0 | 3 | 1.5 / 1.5 / 0 / 0 | 7.5 (7.5) |
| 1x | live | never | 19 | 48 | 33 | 12 | 0 | 3 | 0 / 0 / 0 / 3 | 48 (15) |
| 1x | live | Ultra once | 19 | 60 | 42 | 16 | 0 | 1.5 | 0 / 0 / 0 / 1.5 | 18 (18) |
| 1x | Pause | dispatches | 20 | 46 | 30 | 13 | 0 | 3 | 1.5 / 1.5 / 0 / 0 | 15 (15) |
| 1x | Pause | never | 20 | 42 | 36 | 4.5 | 0 | 1.5 | 1.5 / 0 / 0 / 0 | 40 (4.5) |
| 1x | Pause | Ultra once | 20 | 66 | 54 | 12 | 0 | 0 | 0 / 0 / 0 / 0 | 13 (12) |
| 1x | Keep going | dispatches | 20 | 55 | 24 | 0 | 0 | 31 | 0 / 0 / 31 / 0 | 31 (31) |
| 1x | Keep going | never | 20 | 51 | 10 | 0 | 0 | 40 | 0 / 0 / 40 / 0 | 51 (40) |
| 1x | Keep going | Ultra once | 20 | 64 | 12 | 0 | 0 | 52 | 0 / 0 / 52 / 0 | 51 (51) |

**Reading the tables**

- **Why only a fifth is answerable at Ultra:** an episode takes the dispatcher about 8.5 s, then the policy drops every trigger for 30 s. That is 600 game days at Ultra, 150 at Fast and 60 at 1x. A prompt arrives about every 8 s, so at most 78-100 episodes fit in an hour.
- **How long the Send is usable with no hold** (median real time):

| kind | Ultra | Fast | 1x |
|---|---|---|---|
| fire | 33 ms | 150 ms | 400 ms |
| crime spree | 784 ms | 3.1 s | 7.8 s |
| medical | 650 ms | 2.7 s | 6.6 s |

  A new banner ignores presses for its first 350 ms (`EmergencyBanner.ts:101`).
- **Sensitivity to the 1 s line:** on the 1M city, 180-198 of the 339-357 unanswerable prompts per hour are crime sprees at about 0.78 s. With a 0.75 s line they would count as answerable. On the 304k city nearly all are fires under 0.1 s.
- **Class (c) is empty for the default policy:** 0 of 288-315 prompts in the harness and 0 of 171 in the browser. After the click the open prompt's window runs out within 0.05-0.8 s, so the episode ends before another prompt can arrive. Even a player who clicks Ultra at every slow-down gets 0 and 1.5 per hour. It appears only under Pause when the player resumes by himself (1.5-3 per hour at Fast and 1x).
- **What one Ultra click costs:** the prompt he walked away from (answerable, so his own choice), then 2-4 cooldown prompts in the next 30 s.
- **T082 finding 7 reads differently in its own evidence.** `A_1920_main.json` has the toast "Emergency over — back to ultra speed" at 66.0 s, which only a policy-held episode posts. My reading: the fire was lost by the click, three alerts fell in the cooldown, then a LIVE episode ran from about 42.6 s to 66.0 s.
- **The 304k city by size:** 1.45 prompts per game year while it is 304-350k (29 in 20 pooled game years), 2.7 after 400k. It passes 400k after 4 game years, which is 72 s of Ultra. The 1M city stays at 2.4-2.8 per game year.
- **Disasters on** (flag flipped in memory, harness only): 5% to 37% more prompts per hour.

| city, player | prompted/h, off | prompted/h, on | counted ignored/h, off | on |
|---|---|---|---|---|
| 1M, dispatches | 421-444 | 577 | 315-325 | 438 |
| 1M, never | 429 | 484 | 400 | 421 |
| 304k, dispatches | 436-445 | 469 | 352-367 | 379 |
| 304k, never | 492 | 562 | 486 | 550 |

  On the 1M city the extra prompts are mostly busy calls with no banner (64-80 per hour against 16-25). One of the four runs lost more than half the city over 110 unattended game years (304k, ending at 189k).

## 2. What it costs

**Per unanswerable prompt that fails unanswered**

- **Counter:** `month.ignored` rises by 1 (`emergency.ts:2884`) and stays in the 12-month sum.
- **Approval term:** `emergencies` (`approval.ts:407-411`). It is −min(8, 1.2·failed last month + 0.4·late + 0.3·deaths + 0.1·riot days + 100·failed₁₂/(incidents₁₂+30) + 1.5·ignored₁₂).
  - Each counted prompt is 1.5 points for 12 months, until the −8 cap binds.
  - Shown approval follows at 30% a month.
- **The failure itself costs whether counted or not:** 1.2 points for one month, plus 0.1 (1M city) to 0.3 (304k city) points for 12 months.
- **Nothing else in dev:** no safety record, rebuild charge or scar. A burnt building is rubble until bulldozed at §5 per cell (`buildings.ts:47`). "Damage" is a statistic only (`emergency.ts:2703`). The Emergencies panel has no ignored row.

**Steady state** (months after the first game year)

| run | counted ignored per game yr | all unanswerable? | term, mean (months at −8) | term without the unanswerable ones | difference | mean approval |
|---|---|---|---|---|---|---|
| 1M, Ultra, live, dispatches | 1.93 | yes | −4.44 (11%) | −1.68 | 2.75 | 54.8 |
| same, replica | 2.02 | yes | −4.47 (12%) | −1.69 | 2.78 | 54.8 |
| same, ideal run (count taken back) | 0 | | −1.67 | | | 57.6 |
| 1M, Fast, live, dispatches | 1.06 | yes | −3.05 | −1.42 | 1.62 | 55.7 |
| 1M, 1x, live, dispatches | 0.32 | yes | −1.76 | −1.25 | 0.51 | 56.0 |
| 1M, Ultra, Keep going, dispatches | 2.29 | yes | −5.00 (14%) | −1.77 | 3.23 | 54.2 |
| 1M, Ultra, live, never | 2.65 | 2.16 of them | −5.37 (20%) | −2.54 | 2.83 | 53.6 |
| 304k, Ultra, live, dispatches | 2.14 | yes | −4.56 (18%) | −1.73 | 2.83 | 67.1 |
| same, replica | 2.23 | yes | −4.69 (21%) | −1.81 | 2.87 | 67.0 |
| same, ideal run | 0 | | −1.88 | | | 69.7 |
| 304k, Fast, live, dispatches | 1.82 | yes | −4.29 (13%) | −1.78 | 2.51 | 70.9 |
| 304k, 1x, live, dispatches | 0.39 | yes | −1.63 | −1.00 | 0.63 | 72.9 |

- The ideal run emulates the skipped counting line: the observer takes the sim's own increment back inside the `failed` event. No tree copy was needed.
- The paired runs give +2.8 mean approval (1M) and +2.6 (304k).
- Population after 110 game years is inside run-to-run noise: +0.3-0.5% on the 1M city against two dev runs 0.25% apart, −1.0% on the 304k city.

**Texts that blame the player**

- News at the prompt: "… Send help from its alert: Send nearest, or Choose station…" (`emergency.ts:2082`), 426-508 per hour at Ultra. It is also posted for busy calls that have no alert.
- Banner outcome: "No fire truck was sent in time" instead of "could reach it in time" (`EmergencyBanner.ts:288`).
- Approval breakdown: "K of them after a Dispatch prompt nobody answered" (`approval.ts:529`).
- Failure news: "The crime spree at X went unanswered…" (`emergency.ts:2947-2955`).
- Advisor: "fires there wait for you to dispatch a truck" (`advisors.ts:1336`).

## 3. The bot path

- **Prompted there?** Yes. The settle point is in the sim, so it runs with no host. The stock 128x15 s7 run has 3 prompts in 15 years (2 fires, 1 medical).
- **Counted as ignored?** No. `SimBot.daily()` sends a unit right after each `advanceDay()` (`simbot.ts:961-975`, `:2636`), so all 3 were answered the same day. Ignored is 0 in every year.
- **Is the term in its approval?** The formula runs, with 0 for this part. Balance numbers therefore assume a mayor who is never blocked. One of its 3 prompts had under half a day of slack, which no frame-driven host can answer at Ultra.

| bot run (128x15 s7) | residents | approval | prompted | ignored |
|---|---|---|---|---|
| stock, through quietrun | 192,899 [61124, 93804, 37971] | 81.4 | 3 | 0 |
| stock, ignored never counted (probe) | 192,899 | 81.4 | 3 | 0 |
| bot's dispatch replaced by the probe's at day end | 192,899 | 81.4 | 3 | 0 |
| `--neglect` | 191,351 | 80.9 | 4 | 4 |
| `--neglect`, ignored never counted (probe) | 191,227 | 80.8 | 3 | 0 |

**Under each option:** the stock bot stays at 192,899 under all four when they are done on the host side. `tools/simbot.ts` builds a bare `Simulation` (`simbot.ts:274`) and never a `SimCore` or `LivePolicy`. `--neglect` runs move only if the sim's default changes; see (i).

## 4. Options (not implemented; Ultra, live, dispatcher, 40 virtual minutes)

| variant | game yr/h | answerable/h | unanswerable/h | episodes per 10 min | share of real time held | counted ignored per game yr | failed majors per game yr | buildings lost per game yr | mean approval |
|---|---|---|---|---|---|---|---|---|---|
| **1M** dev (replica) | 163 (161) | 82 (87) | 339 (357) | 13 (13.5) | 19% (20%) | 1.93 (2.02) | 1.94 (2.08) | 1.05 (1.30) | 54.8 (54.8) |
| (i) not counted | 164 | 79 | 304 | 13 | 19% | 0 | 1.76 | 1.20 | 57.6 |
| (iii) cooldown only for the same incident | 83 | 262 | 7.5 | 41 | 61% | 0.04 | 0.04 | 0.05 | 57.7 |
| cooldown 10 s | 137 | 138 | 211 | 22 | 33% | 1.32 | 1.36 | 0.85 | 55.6 |
| cooldown 5 s | 118 | 186 | 130 | 28 | 43% | 0.97 | 0.98 | 0.66 | 56.2 |
| (iv) city dispatches (444/h) | 161 | 93 | 450 | 14 | 21% | 0.03 | 0.05 | 0.12 | 57.7 |
| **304k** dev (replica) | 165 (165) | 78 (78) | 358 (367) | 13 (13) | 19% (19%) | 2.14 (2.23) | 3.25 (3.45) | 4.26 (4.89) | 67.1 (67.0) |
| (i) | 163 | 79 | 426 | 13 | 19% | 0 | 3.66 | 4.88 | 69.7 |
| (iii) | 81 | 261 | 36 | 43 | 63% | 0.41 | 1.73 | 2.51 | 71.0 |
| cooldown 10 s | 133 | 151 | 279 | 24 | 35% | 2.10 | 3.00 | 4.29 | 67.5 |
| cooldown 5 s | 114 | 193 | 202 | 31 | 45% | 1.78 | 2.88 | 3.78 | 68.2 |
| (iv) city dispatches (414/h) | 163 | 84 | 462 | 13 | 19% | 0.29 | 1.47 | 2.28 | 70.0 |

The two cooldown rows are my own additions, to show the range between dev and (iii).

**(i) Do not count a prompt the host never offered**

- **Effect:** removes the charge (+2.6 to +2.9 approval); failures and everything else stay as in dev.
- **Touches:** `LivePolicy` in `src/worker/SimCore.ts` (it knows at `:474` whether a trigger was dropped); `src/sim/infra/emergency.ts` (a flag on the incident, the condition at `:2884`, saved with the incident); `src/ui/EmergencyBanner.ts:288` for the outcome text; tests.
- **Worker protocol:** no new message. The policy already runs beside the sim on every host (`SimHost.ts:356`, `simWorker.ts:106-112`), and the flag reaches the page inside the incident record (`protocol.ts:290` clones it whole).
- **Decision for you, the default:** "counted unless the host says it was not offered" keeps `--neglect` at 191,351. The reverse would zero its ignored count.
- **Decision for you, what "offered" means under Keep going:**
  - If it means "the policy held the game", Keep going is never charged. At 1x, 17 of 35 counted prompts (1M) and 7 of 34 (304k) had a usable Send for over 1 s.
  - A real-time rule (Send usable for N seconds, or paused) treats all policies alike. N from 1 to 3 s gives the same counts at Ultra and 1x.
- **Prior art:** `docs/POLISH_PLAN.md:64` (PB-COOLDOWN) already states this principle for the banner cooldown; T029's 30 s cooldown reopened it.

**(ii) No Send button and no "Send help" clause while the window cannot be used**

- **Effect:** removes 310-360 usable-looking buttons per hour at Ultra. The charge stays unless (i) is also done.
- **Touches:** `EmergencyBanner.ts` `refresh()` (`:1104-1118`) and `answerable` (`:951`). The page already has speed, seconds per day and `policy.live`.
- **Catch:** the clause is written by the sim at the settle point (`emergency.ts:2073-2086`), before the host has seen the incident. So it must leave the sim's text or be added by the UI.
- **Bot:** identical residents; only news text changes.

**(iii) Cooldown only for the same incident**

- **Effect:** 88-97% of prompts become answerable. The game is held 61-63% of real time, Ultra runs at half pace (81-83 game years an hour against 163-165), and there are 41-43 slow-downs per 10 minutes against 13.
- **Never-dispatching player:** held 32-64% of the time, 159-282 episodes an hour.
- **Conflict:** this is the load the cooldown was approved to remove (`docs/dev/STATUS.md:121-128`).
- **Touches:** `SimCore.ts:474` and `flush()`'s two trigger sites (`:420`, `:427`); the cooldown cases of `tests/worker/policy.test.ts`.
- **Bot:** identical.

**(iv) The city dispatches when the player cannot**

- **Effect:** the failures themselves go away. Failed majors per game year fall from 1.94 to 0.05 (1M) and from 3.25 to 1.47 (304k). The 304k remainder is calls no unit could reach at all.
- **Never-dispatching player:** keeps only his own ignores (0.55 and 0.70 per game year).
- **Side effect:** sending far units raises prompts per game year from 2.6 to about 3.4. The game's outcome now depends on speed.
- **Touches:** `LivePolicy`; `emergency.ts` (an automatic answer; no "thanks to your dispatch" at `:2958`; `m.auto` not `m.manual` at `:1668-1672`); banner and panel wording.
- **Bot:** identical when host-side. Equivalence at day end is verified (192,899).

## Other things the measurement showed

1. **The sim counts prompts no frame-driven host can answer.**
   - It decides with the day's integer time (`emergency.ts:1037`, `:1864`, `:2164`), but a player's dispatch starts at day plus fraction. The policy's first look (`SimCore.ts:417`) already says "too far".
   - It is worse when one frame runs up to 4 days (`Simulation.ts:130`), for example when LIVE hands Ultra back.
   - Suggested fix: count only when the unit makes it with a whole day to spare, or (i).
2. **Busy calls are prompted and told "Send help from its alert" but never get an alert** (`emergency.ts:1894`, `:2082`; `emergencyPolicy.ts:183`). Most get a unit when one returns; 2 were counted ignored in one 20-minute browser run. Suggested fix: no prompt flag and no clause for reason busy.
3. **The urgent pause can end after one frame.**
   - `dayFraction` is 0 while paused (`Simulation.ts:159`), so sim time steps back. Urgency then rises over 8 s and `emergencyPolicy.ts:136-140` resumes.
   - In the browser, 12 of 24 pauses in the 1M never run lasted under 200 ms.
   - Suggested fix: keep the fraction while paused, or resume only on dispatch or window end.
4. **After the player's own speed click in a LIVE episode, the urgent pause still fires once** (`emergencyPolicy.ts:141`). A browser run sat paused from its first minute until I stopped it at minute 12, because my first player model did not click again; I fixed the model and reran.

## Not measured

- A headed browser on a real display, or other refresh rates.
- The worker host (`?simworker=1`). It runs the same code and steps one day per task.
- A managed city: both saves ran unattended for 100-130 game years per run.
- Reaction times other than 1 s, except through the window figures.
- Disasters on in the browser.
- Option (iv) at Fast and 1x.
- First-emergency lessons (all runs had tips off).
- LG-06's charges (not in dev).

## Evidence and housekeeping

Everything is in `C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\qa\T094\`:

- **Scripts:** `run.ts`, `observer.mjs`, `browser.mjs`, `botprobe.ts`, `analyze.mjs`, `matrix.mjs`.
- **Data:** `runs\` (78 harness runs and 5 bot probes), `runs60\` (7 runs at exactly 60 Hz), `browser\` (6 run files and 5 screenshots), `tables\`, `logs\procs.csv`.
- **Screenshots I looked at:**
  - `browser\B_vet21_live_s3_dispatcher_banner_at_ultra_no_hold.jpg`: the toast says "Send help" while the banner says "too far?".
  - `browser\B_dense1m_live_s3_dispatcher_banner_at_ultra_no_hold.jpg`: a usable Send at Ultra with no hold.
  - `browser\B_dense1m_live_s3_dispatcher_banner_policy_holding.jpg`: the urgent pause.
  - `browser\B_vet21_pause_s3_dispatcher_banner_policy_holding.jpg`: the Pause policy.
  - `browser\Btest_dense_live_s3_disp_banner_policy_holding.jpg`: the LIVE pill.
- **Environment:** RTX 5070 Ti (ANGLE D3D11), driver 610.47, headless Chromium 141.0.7390.37, Node 22.12, Windows 10.
- **Stopped:** no process of mine is left and ports 5781 and 5782 are free. I stopped three of my own browser runs early (two hung on a `tasklist` child, one was the paused run above).
- **Tree:** `git status` is clean. Vite left an empty, untracked `node_modules\.vite` folder in the tree.
- **No report file was written;** this message is the report.