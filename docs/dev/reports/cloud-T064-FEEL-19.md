# T064 lane t064-feel19 · FEEL-19: hover says what is wrong with a building (cloud, chain guide2c, lane 1)

Task: docs/dev/queue/T064-guide-r2-cloud.md, section "t064-feel19". Spec: docs/POLISH_PLAN.md "#### FEEL-19 · Hover says
what is wrong with a building", with §6.5, §7.2-§7.4 and §8.2. Branch `cloud/t064-feel19`, from dev
`claude/beautiful-johnson-u2jqoz` (a new lane: no `local/*` branch, no desktop WIP). Started on 43679b3, fast-forwarded to
95f6e15 (T047 merged, this task file posted) before the first commit, and merged with dev 080676d (desktop train 2:
T054b, T098) before the gates; no conflicts.

## Cloud carry-over (Nov 3)

### Gap list (written before the work)

Read: the task file's Context, Gates, chain split and lane section; NOTE-044, NOTE-061 and NOTE-088 (the only NOTEs that
name T064 or its items: `grep -l T064 docs/dev/queue/NOTE-*` finds NOTE-061 on dev, NOTE-088 on `cloud/lead-notes`);
the plan's FEEL-19 section in full (Problem, Change, Files, Acceptance, Depends on, Risk) and §6.4-§6.5, §7.2-§7.4,
§8.2; WORKER_DESIGN §1.3's field table and its replica-safe rule. There is no lane report and no lane diff yet: dev holds
nothing of FEEL-19.

| # | required (task / plan) | in dev at 43679b3 | gap |
|---|---|---|---|
| G1 | one shared chip table in inspectorModel.ts: `FLAG_CHIPS` plus the power, water and construction chips | `FLAG_CHIPS` and the power / water / construction / needs chips are built inline in InfoPanel.ts (`:45-60`, `:337-354`) | all |
| G2 | `hoverStatus(flags, built, condition)` returning text and tone | none | all |
| G3 | InfoPanel reads the shared table; the inspector looks exactly as before; a test compares the chips before and after | n/a | all |
| G4 | `QueryTool.move()` adds one status line in the priority order On fire, Abandoned, No road, No power, No water, Understaffed, garbage, noise, polluted, needs, crime | `move()` shows name plus residents / jobs, and "In ruins" for a ruin only | all |
| G5 | "Thriving" (no problem, condition at least 90%); "Under construction · N%" while building; tone from the chip classes | none | all |
| G6 | the line cached per building per sim day | `move()` has only its own per-cell / per-second tip key | all |
| G7 | tip cost at most 0.2 ms (vitest micro-benchmark, median of 1,000 hovers) | none | all |
| G8 | tests: tests/game/hoverStatus.test.ts (new; fails with the change reverted); acceptance tests for each item | none | all |
| G9 | gates: tsc; the full vitest (hygiene and replica tests included); the bot identical to dev, 198,115 | n/a | all |
| G10 | report with Desktop QA (default host and `?simworker=1`): the four hovers, unchanged inspector chips, the tip cost in a Performance trace | n/a | all |

Found while reading, to settle in the work (see Decisions):
- **Condition is a lagged field on the replica.** WORKER_DESIGN §1.3 lists `health` under "focus records ... otherwise
  query"; "functions that read lagged fields run only in the worker, behind a query". A probe on a generated 128² city
  through LoopbackCore measured up to 3,371 of 4,776 growables with replica health off by more than 0.01 (max 0.744 on
  day 15, still 0.094 on day 105). "Thriving" read from the replica would be wrong in worker mode.
- **Three wording / tone conflicts between the plan's samples and today's chips:** "No garbage pickup" / "Too noisy"
  (chips: "Garbage piling up" / "Noisy"); "Under construction · 60%" (chip: "Under construction 60%"); "No power in the
  warn tone" (chip: `bad`).
- **In-flight hunks on these files:** desktop T070 (`local/T070-honours-snap`) edits InfoPanel's `usesPower` line, which
  this lane moves into inspectorModel.ts; desktop T075 (`local/T075-camera-snap`) adds `clearHover()` to QueryTool;
  desktop T037a (`local/R1-guide-a`) InfoPanel `:106-150`, `:452`; desktop T045 inspectorModel `:356`.

### In dev before this lane

Nothing of FEEL-19 (the task file's "In dev already" holds): `QueryTool.move` showed the name plus residents or jobs, and
"In ruins" for a ruin; empty zoned lots had their zoneStatus line; the chip table and the power / water / construction /
needs chips were built inline in InfoPanel.ts. None of the four in-flight desktop lanes the task file's table tracks is
in dev (no src/ui/guide/explainers.ts, budgetDelta.ts or src/game/bindings.ts; `A11Y_WIRED.motion` is false). FEEL-19 has
no "if in dev / if not" rule of its own.

### What this lane did

Commits on `cloud/t064-feel19`: `e2dcb97` (the feature and its tests), `917f972` (the one-table test), `1c95920` (the
query name and replica-safe entries on their own lines, so T037a's same-place appends merge cleanly), `7beaa73` (dev
080676d merged in), `a80e6c6` (an unused test import dropped), and this report with the done line.

**Files and hunks, with their §7.3 owner** (NOTE-088 gives FEEL-19 to the cloud whole, so the lane writes the SIM hunk it
needs and names it):

| file | hunk | owner (§7.2 / §7.3) |
|---|---|---|
| src/ui/inspectorModel.ts | `Chip` gains `key` and `icon`; new section "status chips (FEEL-19)": `FLAG_CHIPS` (moved from InfoPanel, now with a key per row), `CHIP_TEXT`, `CHIP_TITLE`, `constructionText`, `ChipContext`, `drawsPower` (the old `usesPower` rule), `buildingChips` (the inspector's chip list, in its order), `HoverStatus`, `HOVER_ORDER`, `THRIVING_TEXT` / `THRIVING_CONDITION` (0.9), `hoverStatus(flags, built, condition, ctx?)`, `TIP_LINE` / `TIP_KIND`, `HoverStatusCache` | GUIDE |
| src/ui/panels/InfoPanel.ts | the local `FLAG_CHIPS` and the chips block (`:337-354`) replaced by one `buildingChips` call; `chips()` draws `icon` before the text | GUIDE |
| src/game/tools/QueryTool.ts | `move()`'s building branch adds the status line (GUIDE's hover hunk); private helpers `statusOf` / `askCondition` and their fields next to `move()`; `leave()` and `deactivate()` drop the pending re-show (`lastPointer = null`, one line each). `down()` / `up()` (WORLD) untouched | GUIDE (hover text); the `leave` / `deactivate` one-liners are hover state, not WORLD's pan hunks |
| src/worker/queries.ts, protocol.ts | the `buildingCondition` query (`(sim, {id}) => health ?? null`) and its wire name | SIM (src/worker/**, "SIM adds every ... replica-safe entry on request from the item's lane"); in guide2c's column |
| src/worker/replicaSafe.ts | `waterRequired`, `needsExpectation` registered | SIM; guide2c's column |
| tests/game/hoverStatus.test.ts | new, 16 tests | GUIDE (new file, §7.4) |
| tests/worker/replicaSafe.test.ts | two compares for the new entries | SIM; guide2c's column |
| tests/worker/querySideEffects.test.ts | `buildingCondition` read per sampled building and for id -1 | SIM (follows queries.ts, §7.2); not in the chain column by name, required by its own guard (decision 10) |

No new style: the line uses the cursor tip's existing classes (`tip-reason`, `tip-warn`, `tip-sub` in hud.css, `tip-ok` in
insight.css, which PlopTool's tips already use), so src/ui/guide/inspect.css is not created.

**How the line is made.**
- `buildingChips(flags, built, ctx)` is the inspector's chip list, in order: Powered / No power, Water / No water,
  Under construction N%, the flag chips, Needs unmet. A ruin shows only `RUIN_CHIP_FLAGS`' chips. InfoPanel passes the
  power / water cell at the building's corner, `drawsPower(def, growable)`, and its report's `waterRequired` /
  `needsExpectation`, exactly the inputs its own code read before.
- `hoverStatus` takes the first chip in `HOVER_ORDER` among the problem chips (tone bad or warn) and the construction
  chip, in its own words and tone. With none, it gives "Thriving" (tone good) for a growable at condition 0.9 or more.
  Otherwise there is no line. Order: In ruins, On fire!, Emergency here, Under construction N%, Abandoned, No road
  access, No power, No water, Understaffed, Garbage piling up, Noisy, Polluted, Needs unmet, High crime, No jobs,
  Congested (decision 5).
- The tip: `<div class="tip-head"><b>Name</b></div>`, the occupancy line as before (none for a ruin), then the status
  line with `TIP_LINE[tone]` (bad `tip-reason`, warn `tip-warn`, good `tip-ok`, info `tip-sub`). The box kind is
  `TIP_KIND[tone]` (bad `bad`, good `ok`, else `info`), as the zone-lot hover does it. A ruin's markup is the same as
  before (`<div class="tip-reason">In ruins</div>`).
- **Cache.** `HoverStatusCache` keeps one line per building for the sim day it was read on, keyed on a signature of the
  flags, the two utility cells and whether the condition is known yet. A flag that flips within a day (power restored
  while paused, a fire) works the line out again at once. Past days are dropped when the day turns.
- **Condition through the host** (decision 1). Only a growable with no problem chip asks, with
  `host.query('buildingCondition', {id})`, once per building per sim day, one request at a time. The last answer
  stands meanwhile, so the line does not flicker at speed. When the answer arrives while the cursor still rests on the
  building, the tip is shown again: the local host answers within a microtask, the worker host within a packet.

### Acceptance

| # | item | result | evidence |
|---|---|---|---|
| A1 | an unpowered shack shows "No power" in the warn tone; an abandoned building shows "Abandoned" | "No power" shows in its chip's tone, which is `bad` (red); "Abandoned" bad. The tone question is decision 2 | hoverStatus.test.ts "an unpowered shack shows "No power" in its chip's tone, an abandoned building "Abandoned"…" (real Shack, tip `tip-reason` and box `bad`); "each line is the chip's own text and class" |
| A2 | the priority order, "Thriving" and "Under construction · N%" hold (tests) | yes, with the chip's words "Under construction 60%" (decision 3) | "the priority order: the plan's list in order…" (all 14 problem lines peeled in order, then Thriving; the plan's 11 in the plan's order); ""Thriving": a growable with no problem chip from condition 90 %…"; ""Under construction 60%" while it is built…" |
| A3 | the hover text equals the inspector chip (both come from the table; a test asserts it) | yes | "the hover text equals the inspector…" (12 buildings: each line is one of its rendered chips, or the ruin's main problem, with that chip's class); "both read the one table…" (a row's words changed in `FLAG_CHIPS` show in the inspector and the hover alike; fails with InfoPanel's own table back) |
| A4 | the line is cached per building per sim day (test) | yes | "HoverStatusCache: one line per building per day and inputs…"; "the hover: the same line all day although its condition moves; the next day reads it again; one condition request per building per day" |
| A5 | the tip costs at most 0.2 ms (vitest micro-benchmark, median of 1,000 hovers; the Desktop QA confirms it) | median **3.5-6.7 µs** for the first hover of 1,000 distinct buildings (the line worked out, the condition asked) and **2.4-4.2 µs** cached, on a generated 128² city on the shared 4-core container (7 runs of the lane's QueryTool: first 3.5, 4.7, 4.8, 4.9, 6.3, 6.7, and 15.2 µs in a run beside 12 other test files; cached 2.4-4.2 µs). Dev's hover, timed the same way with QueryTool put back: 2.1-3.6 µs. 30x or more under the budget | "median of 1,000 hovers over distinct buildings…"; Desktop QA item 6 |
| A6 | the inspector looks exactly as before; a test compares the chips before and after | yes | "buildingChips equals the old InfoPanel code for every flag combination…" (all 2^18 flag sets against a frozen copy of the old code, rotating the six inputs); "drawsPower is the old usesPower rule for every catalog def"; "the rendered inspector chips of twelve buildings equal what dev rendered before the move" (class, title and markup recorded by running the same scenario on a clean export of dev 95f6e15) |
| A7 | worker host (stand-in for the `?simworker=1` part of the QA) | the replica's lines equal the live state's | "a loopback worker host: exact flags give the same lines; the condition comes by query, so a stale replica health cannot say "Thriving"". On a LoopbackSimHost, two healths change silently on the authoritative side, the way the population pass changes them. The replica keeps 0.95 / 0.6, and reading those would say the opposite of the truth on both. The hover still shows no line on the tower (0.5) and "Thriving" on the shack (0.95) |

### Decisions

1. **The condition comes from a host query, not the replica's `health`.** WORKER_DESIGN §1.3 puts `health` among the
   focus-record / query fields and says that reads of lagged fields run only in the worker. A probe measured the lag on
   a generated 128² city through LoopbackCore over 120 days: up to 3,371 of 4,776 growables had replica health off by
   more than 0.01, the largest gap 0.744 on day 15, still 0.094 on day 105. 104 of them read the wrong side of 0.9 on
   day 15. So the lane adds the one-line `buildingCondition` query (src/worker/** is in guide2c's column; its §7.3
   owner is SIM). The hover asks once per building per sim day, and only for a growable with no problem chip.
   Flags, `built` and the power / water cells are exact or always mirrored (W0.3), so the problem lines read the replica
   directly. The alternative, adding the hovered id to the view's focus records, needs CityScene.ts, which is guide2b's
   file this round.
2. **"No power" shows in the chip's `bad` tone (red), not "warn".** The acceptance says "warn tone". The task file also
   says the tone comes from the chip classes, the hover equals the chip, and the inspector looks exactly as before; the
   inspector's No power chip is `bad`. Taking the task file's own rule for wording conflicts ("use the chip words and
   note it"), the chip wins, and "the warn tone" is read as "a warning tone". If the lead wants amber, it is one value in
   `buildingChips` (the power chip's `cls`). The inspector and the hover then change together, and the golden test
   records the change.
3. **"Under construction 60%" (the chip's words), not "Under construction · 60%".** Same rule: the acceptance requires
   equality with the chip, and the inspector must not change. `constructionText` is the one place to change both.
4. **"Garbage piling up" and "Noisy"**, not the plan's "No garbage pickup" / "Too noisy", as the task file directs.
5. **The order beyond the plan's list.** The plan lists 11 lines; the table has 4 more problem chips and the
   construction chip. The plan's 11 keep their order (tested). "In ruins" leads (a ruin shows nothing else, as the hover
   did before). "Emergency here" sits with "On fire!" (both bad, both emergencies). The construction line comes next:
   nothing lives in a building being built, and construction does not wait on road, power or water (population.ts
   `construction`). "No jobs" and "Congested" (warn) come last. Info chips (Historic, a small town's Needs unmet) and
   Powered / Water are never the line, so a building with any warn or bad chip never reads "Thriving".
6. **"Thriving" only for growables.** A plopped building keeps `health: 1` from the day it is placed (actions.ts plop),
   and the inspector shows a Condition row for growables only. A school or plant with nothing flagged shows no line.
7. **The cache signature holds the flags and utility cells** as well as the day. "Per building per sim day" alone would
   keep "No power" up all through a pause after the player fixed the power (the utilities pass flips `BF.Powered`
   while paused). The line is still worked out at most once per building per day while nothing changes.
8. **`waterRequired` and `needsExpectation` are registered in REPLICA_SAFE**, with compares in replicaSafe.test.ts.
   The hover runs both on main for every building it points at. Both are pure functions of mirrored state (def, zone,
   `stats.population`). advisorModel already called `waterRequired` on main without the entry.
9. **The tip box takes the line's kind** (`bad` for a bad line, `ok` for Thriving), as the zone-lot hover does. A
   ruin's tip box now has the red border; its markup is unchanged.
10. **tests/worker/querySideEffects.test.ts gains the new query's reads.** Its guard requires every `QUERY_HANDLERS`
    key to be exercised at least 120 times, so a new query cannot land without it. The file follows queries.ts (§7.2).
11. **The benchmark times `move()` with the GPU pick stubbed** (`objects.pickBuilding` returns the id): it measures the
    tip's own work, which is what the acceptance names. The real pick and the paint are the Desktop QA's Performance
    trace (item 6).
12. **No browser run on the cloud** (NOTE-061, NOTE-088: lock.sh refuses them). The node tests stand in where they can
    (A1-A7); the real-GPU checks are the Desktop QA below.

### Gates

All on `7beaa73` (the lane merged with dev 080676d). The two commits after it change no behaviour: `a80e6c6` drops an
unused test import, and this report. tsc and the lane's tests were re-run on `a80e6c6`.

| gate | result |
|---|---|
| 1. tsc (`npx tsc --noEmit`, sem) | clean on `7beaa73` and again on `a80e6c6` (tests included: tsconfig covers src, tools, tests) |
| 2. revert check | below: hoverStatus.test.ts 13 of 15 fail with all src reverted; each src file's own tests fail with it reverted |
| 3. full vitest (lock, 06:22-06:32 UTC) | **310 files passed, 4 skipped (314); 3,157 tests passed, 11 skipped (3,168); 584 s**; 0 failed. The bench fixtures are in the worktree, so the grown-fixture cases ran: querySideEffects (with the new query), replicaSafe (with the new compares), hygiene |
| 4. the bot (lock; 128x15 seed 7) | lane `7beaa73`: residents **[ 61828, 95515, 40772 ] = 198,115**; dev 080676d from a clean export (`co/t064-feel19-devbase`): **[ 61828, 95515, 40772 ]**. The whole output is identical apart from the timing columns (econms, totalms, "done in", ms/day). Run because the diff touches src/game and src/worker (tools/simbot.ts imports only src/sim and src/core, and no src/sim file imports a changed file) |
| 5. acceptance | A1-A7 above |
| 6. HUD trace | not applicable: the top bar is unchanged |
| lane: hoverStatus.test.ts fails when reverted | yes (gate 2) |
| lane: hygiene and replica tests | pass in the full run; `tests/worker/hygiene.test.ts` again with the lane file on `a80e6c6`: 2 files, 34 tests passed |
| trial merges (`git merge-tree`) | against `local/T070-honours-snap`, `local/T075-camera-snap`, `local/R1-guide-a`, `local/T045-lg08-tod`, `cloud/t064-fh08live` and `cloud/t064-fh16`. The lane adds one conflict, T070's InfoPanel `usesPower` line (request 1). Every other conflict those branches show is one they already have with dev |

### Revert check (gate 2), per test file

Each run used the lane's tests with the named src files put back to dev (95f6e15 for the src, 080676d for the worker
files; logs in `scratchpad/feel19/`):

| src reverted | tests/game/hoverStatus.test.ts | tests/worker/replicaSafe.test.ts ("generated 128²") | tests/worker/querySideEffects.test.ts (64² local, loopback 128²) |
|---|---|---|---|
| all six src files | **13 of 15 fail** (`revert-all.txt`); the 2 that pass are the dev golden of the rendered chips (it records dev's output) and the cost benchmark (dev's hover is fast too) | — | — |
| QueryTool.ts only | **5 fail**: the four hover tests and the worker-host test (`revert-querytool.txt`) | — | — |
| queries.ts + protocol.ts only | **5 fail**: the same five, no condition answer (`revert-query.txt`) | — | — |
| InfoPanel.ts only | **1 fails**: "both read the one table" (`revert-infopanel.txt`); the old InfoPanel draws the same chips, as it must | — | — |
| replicaSafe.ts + queries.ts | — | **fails**: `seen` has 2 more names than REPLICA_SAFE (`revert-worker.txt`) | **both fail**: `buildingCondition failed TypeError: handler is not a function` |

(The 16th hoverStatus test, "both read the one table", was added after the first three revert runs; the InfoPanel run is on 16.)

### Requests to other chains and the lead

1. **Desktop T070 (`local/T070-honours-snap`)** edits InfoPanel's `usesPower` line, which this lane moves into
   inspectorModel.ts `drawsPower`. That is a trial-merge conflict in InfoPanel.ts (the only one this lane adds for T070).
   Resolution: put T070's extra clause, `&& ((def.powerUse ?? 0) > 0 || (def.jobs ?? 0) > 0)`, into `drawsPower`, and
   update hoverStatus.test.ts "drawsPower is the old usesPower rule…" to the new rule. Both the inspector and the hover
   then follow it.
2. **Desktop T075 (`local/T075-camera-snap`)** adds `QueryTool.clearHover()`. The trial merge is clean. If photo mode
   should also drop a re-show pending from a condition answer, `clearHover` can set `this.lastPointer = null`. Today
   `hoverId === undefined` already stops it.
3. **Desktop T037a (`local/R1-guide-a`)** appends `guideFacts` to the same QueryName union and REPLICA_SAFE list. This
   lane's entries sit on separate lines, so the trial merge adds no conflict there.
4. **Lead:** decision 2 (No power red or amber) is yours. WORKER_DESIGN §2.8's query list and §1.3's health row can name
   `buildingCondition` as the hover's way to the condition (a doc line; not edited here).

### Desktop QA (after the merge, on dev; real GPU)

Serve with `npm run dev` (or `npx vite preview` on a build). Use 1280x720 for every item, and 1920x1080 for item 5. Run
items 1-4 and 6 on the default host (`/?quickstart=1`) and on the worker host (`/?quickstart=1&simworker=1`). On the
worker host the condition comes from the worker, so "Thriving" may appear a moment after the rest of the tip; the
problem lines appear at once.

1. **An unpowered shack.** Zone low-density residential beside a road, out of reach of power (or bulldoze the power
   line that feeds a block of shacks), and wait for a Shack to stand. Hover it with the Query tool. Expected:
   "Shack", "N residents", then a red **"No power"** line, and the tip box has the red border. Click it: the
   inspector's chip reads "No power" in red, the same words. (Red, not amber: decision 2.)
2. **An abandoned building.** Find one (Abandoned chip in the inspector), or let a block without power decline.
   Expected: a red **"Abandoned"** line.
3. **A building under construction.** Hover a growable while its scaffold rises. Expected: a dim
   **"Under construction N%"** line, with the same N as the inspector's chip. N rises day by day while you hover.
4. **A thriving tower.** Pick a high-density residential tower with power and water and no problem chip, whose
   inspector Condition row reads 90 % or more. Expected: a green **"Thriving"** line and a green-bordered tip box.
   Hover it again a few times and the line stays the same. On `?simworker=1` it appears within about a quarter second
   of the first hover.
5. **The inspector chips are unchanged.** On the same city, open the inspector on a shack, an abandoned building, a
   building under construction, a tower, a school without water, a power plant, a park and a ruin. Compare with dev
   before this merge (e.g. `git checkout 080676d`, or screenshots from the previous dev build). Expected: the same
   chips in the same order, colours, icons and tooltips (a node test already pins the markup, so this checks that it
   renders and looks the same). At 1920x1080, check that the one-line-taller tip still fits beside the cursor.
6. **The tip's cost.** Record a Performance trace while you sweep the cursor over a dense district for about 10 s, on
   both hosts. Expected: `QueryTool.move` (with `statusOf`) takes well under 0.2 ms per call, median (the node
   benchmark measures 3.5-15 µs on the cloud container, without the GPU pick), and no long task comes from the hover.
7. **Optional, paused.** Pause, then cut a thriving building's power (bulldoze its power line) and hover it. Expected:
   "No power" within about a second, once the utilities pass flips its flag. Restore the line and "No power" goes
   (decision 7).
