# T096 report: the FEEL-07 producer: the city records its firsts and announces each once (NOTE-081, NOTE-083)

**Status: done in the lane, uncommitted; the full vitest, the bot on the merged tree and the browser check (with
T075's recheck) are the lead's.** A city now keeps `systemData.firsts` and posts each first once, on a news item with
`ref.first`, at the first's place. The kinds are exactly the ones T075's listener accepts. The 128x15 s7 bot stays at
residents [ 61828, 95515, 40772 ] = 198,115 with every annual row and its whole output identical to the base's (this
base, 3fc526a9 on 080676d2, does not contain T041 95705b5f, so 198,115 is its reference). A two-process probe shows that
nothing but the record and the announcement changes in a run (Medium, Hard, and a 256-tile run that reaches its first
tower). Every gate below was run on the final tree.

## What the lane decided

| Question | Decision |
|---|---|
| Kinds | `stage:6`, `stage:7`, `stage:8`, `unique:<defId>`, `neighbor`: what T075's listener matches (`/^(?:stage:[678]\|unique:.+\|neighbor)$/`). |
| A stage first | The first **completed** growable of that stage **or higher** (`built >= 1`, at the population system's last construction step; not rubble, not a plopped building). A building that is the first of several stages records them all and announces the highest. This is what the 256-tile bot city does: its first tower, on day 9208, is a stage 7 Hotel Tower, so `stage:6` and `stage:7` are recorded with it and one item is posted (`stage:7`). A stage 6 building after it is no first. Every growable completes through that one step (redevelopment starts a new building under construction too). |
| A unique opening | The first opening of each unique building that posts the opening news today (`unique` and category reward, landmark or civic: 22 defs, the three business deals included). Detected at the plop, from the building placed, not from the rewards record. |
| The connection | The first time `afterNetworkChange` counts a new neighbour connection (the only place that posts the connection news). |
| Record | `systemData.firsts[kind] = { day, x, z, id? }`: the day, the place (the building's centre cell, as its news; the connection's edge cell) and the building id where there is one. Written before the news is posted, so a listener of the news finds it. |
| Announcement | A news item with `ref.first = kind` and the place in `x`, `z`. Not an event of its own: T075 reads the news, the news `ref` convention fits (`ref.advice`, `ref.reward`), and the recorder already carries a news item with its ref. The opening and the connection reuse the item `CityActions` posts today (same text, kind and desk; only the ref is new, the first time). A stage first has no news today, so it posts one: `<City>'s first stage N building is complete: <building name>.` (kind `good`, desk `news`, as the milestone and stage unlock news: not a Gazette item, and the ticker never drops it). |
| Once | A kind in the record is never announced again. A rebuilt landmark, a second connection and the next tower post what they posted before T096, without the ref. |
| An old or grown save | A city without the record gets one at load, and what its map shows is marked as had before the record (`{ day: -1 }`, no place), **silently**: every unique building standing (ruins too, and the four unique parks and health buildings that post no opening news, so a later opening news for them would not replay), the stages up to its highest completed tower (rubble counts), a connection. No news, no random draw. A tower still under construction at that load is announced when it completes. What such a save had and lost (a demolished landmark) cannot be told from its map; it is announced if it comes back. |
| T057 | `firsts` is **ordinary systemData, not a continuity record**. A continuity record is runtime state a save hook writes at the save and a load may rebuild (lean recovery snapshots leave it out, and it never reaches the page). `firsts` is game state: written when a first happens, impossible to rebuild at load (the day, and that a demolished first happened), needed on the page, and it must survive a lean snapshot. So: no save hook, not in `CONTINUITY_RECORDS`, in `SYSTEM_KEYS`. The system's init leaves a loaded record untouched and the listener keeps no state of its own, so a loaded game continues like the uninterrupted one (test 10, and `loadContinuity` passes unchanged). |
| A simulation without the system | Bare simulations of tests and tools (`new Simulation(st, [])` with `CityActions`) keep no record, and their news post exactly as before (`claimFirst` returns no ref). The W1.3 recovery tests, which compare whole cities built that way, are unchanged. |

Limits, by design:
- **The record travels with the city.** Loading an older save, or recovering to an older snapshot, rolls it back with
  the city: a first that happens again in that timeline is announced again. "Continue on the main thread" after a
  worker crash boots the last save without the journal, so this applies there too.
- **A journal's replay.** A replayed plop or road records its first at boot. The packet hosts replay before the Ready,
  so the page gets the item in the news log and no event (tested). `LocalSimHost` replays inside `start()`, before
  `ready` resolves, with no mute: a listener already on `host.events` gets the replayed command's news, as every
  replayed command's news reaches it today.

## Changes per file

| File | Change |
|---|---|
| `src/sim/economy/firsts.ts` (new, 123 lines) | `firstsSystem()` (init: the record of a city without one; listeners on `buildingAdded` and `buildingChanged` for the stage firsts, subscribed once per simulation; no tick), `claimFirst(st, kind, x, z, id)` (records a kind once and returns the news ref), `firstsOf(st)` (the read-only reader, replica-safe), `FirstsData`, `FirstRecord`, `FIRST_STAGES`, `FIRST_BEFORE`. |
| `src/sim/systems/economy.ts` | The registration: `firstsSystem()` after `rewardsSystem(rt)`, its import, and one header comment line. It has no `daily`, so the bot's per-system timing line is unchanged. `createSystems()` (the game, both hosts) and the bot get it through `economySystems()`. |
| `src/sim/CityState.ts` | `NewsItem.ref` gains `first?: string` (1 line and its comment). |
| `src/sim/actions.ts` **(outside the named files, T075's request)** | Three small hunks: the import; `plop`: the opening news passes `claimFirst(st, 'unique:<id>', …)` as its ref; `afterNetworkChange`: the connection news passes `claimFirst(this.st, 'neighbor', …)`. With no first to claim the ref is `undefined` and the item is the one posted before (`CityState.notify` adds no `ref` key for `undefined`). |
| `src/worker/protocol.ts` **(cloud-held, named by the task)** | One word: `'firsts'` appended to `SYSTEM_KEYS`. |
| `tests/sim/firsts.test.ts` (new) | 11 tests. |
| `tests/worker/firsts.test.ts` (new) | 6 tests. |

No hunk in `src/sim/infra/*`, `src/save/*`, `src/main.ts`, `rewards.ts`, the recorder or the replica. The recorder
needed nothing: a news item crosses with its whole `ref` (`capture` copies the item, `replay` pushes and emits it),
and the record rides the existing plain patch (`sys`), in the same packet as its news and applied before the log
(`Replica.apply`: `applyPlain`, then the log). `mergePlain` mirrors the record exactly (keys it lacks are deleted).

On the wire the key is optional: the Ready's snapshot carries `firsts` when the city has the record, and a packet's
`plain.sys` only when the record changed (in the loopback test: the three packets that announce a first, and no
other); a city without the record sends nothing. The protocol version is unchanged.

## What changes in a run, and what does not

- **`systemData.firsts`**: new (`{}` from a city's first day).
- **The news log**: `ref: { first }` on the opening or connection item that is a first; one new item per stage
  first; and, as the log keeps its newest 200 items, each new item pushes the oldest kept item out one item earlier.
- **`exactDigest`**: it walks `SYSTEM_KEYS`, an absent key too, so its value changes for every city. Nothing compares
  exact digests across builds or stores one: the worker's `verify`, the QA tools and the tests compare two states of
  one build.
- **Nothing else.** The simulation never reads the record. It reads the news log in three places, none of which a
  first's item can touch: the advisors' `quietIf` (`/^Landfills are/` and `/^Garbage is piling up/`, 90 days back; a
  stage item starts with the city's name, as the milestone news already does), their disaster check (kind
  `disaster`), and the bot's newcomer profile (kinds `warning` and `bad`). The only path left is the 200-item cap
  dropping a matching item one item early, which needs more than 200 news items inside 90 days.
- **Cost**: the listener runs on building events: 9.9 `buildingChanged` a day in the 128x15 bot and 20.1 in the
  256x27 one, plus one `buildingAdded` per new building; two tests end almost all of them, and there is no tick.

### Digest proof (two-process probe, base tree 3fc526a9 against the lane)

Each arm is its own process and imports every module from its own tree (`scratch/digests.mts`, the T054b pattern;
the base arm runs a copy of the base tree, checked blob for blob against `git ls-tree` of 3fc526a9: 907 of 907 equal).
At every month tick: `exactBase` is the **base tree's** `exactDigest` (its function and key list, in both arms) on the
state with the news changes above projected away; `shaProj` is the whole save's SHA-256 without `systemData.firsts`
and with the same projection. Both arms of all three runs were run again on the final tree (`scratch/resume/dg-*`,
`cmp-*`), with the same numbers.

| Run | Month ticks | exactBase equal | shaProj equal | population, funds, RNG equal | Residents (both arms) | Firsts in the lane's run |
|---|---|---|---|---|---|---|
| Bot 128x15 s7, Medium | 180 | 180 | 180 | 180 | [61828, 95515, 40772] | 16: the connection (day 0) and 15 openings; no stage first (the city's highest stage is 5) |
| Bot 128x15 s7, Hard | 180 | 180 | 180 | 180 | [58194, 72693, 27618] | 9: the connection and 8 openings |
| Bot 256x27 s7, Medium (the first 27 years of the 256x60 gate run) | 324 | 324 | 324 | 324 | [131649, 212562, 117653] | 21 recorded, 20 announced: the connection, 18 openings, and on day 9208 `stage:6` + `stage:7` (building 24839 at 130, 121) with one item, "Botville's first stage 7 building is complete: Hotel Tower." |

In all three the unprojected digests differ from the first tick on (the new key), the final saves differ in
`data.news` and `data.systemData` only, within `systemData` in `firsts` only, and with the projection in nothing. The
opening and connection news are the same items on the same days in both arms. The annual rows are equal.

## Tests

`tests/sim/firsts.test.ts` (11, all pass):
1. a new city starts an empty record; a simulation without the firsts system keeps none and posts its news as before
2. claimFirst records a kind once, with the day, the place and the building it is given
3. the first opening of each unique building carries ref.first at its place, once: a rebuilt one posts the plain news
4. the first neighbour connection carries ref.first at the connection, once
5. the first completed growable of stage 6, 7 and 8 is announced at the building, once per stage
6. a building that is the first of several stages records them all and announces the highest
7. rubble, a building placed by the player and one still under construction are no stage firsts
8. through the population system: a stage 6 tower it completes is announced on that day, and only then
9. a save from before the record: what its map shows is marked as had, silently, and the rest is still announced
   (through the constructor and through `replaceState`)
10. a first is announced once across saves: every saved game continues like the uninterrupted one and never repeats
    what its save had. One 95-day city with every kind happening twice (two stage 6 towers and a stage 7 one, the
    Mayor's House rebuilt, two roads to the edge), saved as a file after every day: each of the 95 saves, loaded, has
    the uninterrupted game's record and news log on every later day and announces exactly the firsts that came after
    it. The whole saved city is compared too (T057's digest), right after the load and at the end, for the saves
    around the player's firsts and the stage 7 tower's completion (outside the two T057 gaps under "Findings"). A
    recovery snapshot, lean or over budget, keeps the record.
11. a bot city plays the same with and without the firsts system: only the record and the refs on its news differ

`tests/worker/firsts.test.ts` (6, all pass):
1. SYSTEM_KEYS mirrors the record
2. the local host: each first once, with its record
3. the loopback host gives the page the same news and the same record as the local host, and a resync replays none
   (the record is on the replica when its news arrives; the patch rides the announcing packet; after a forced resync
   the fresh replica has the record, no news is replayed, and the same things again are no firsts)
4. nothing is on the wire for a city that keeps no record
5. a recovery journal replayed at boot fills the record before the Ready: the items are in the news log, and the page
   gets no event
6. the real Worker (node worker_threads, the production loop, every system): announces and mirrors the firsts like
   the local host, and a save loaded by another worker repeats none

### Negative controls

Each mutation was applied to the source, tsc run (clean in every case), the named test files run through the quiet
gate, and the source restored byte for byte (checked by SHA-256; `scratch/mutate.mjs`, logs in `scratch/mut/`). Every
mutation is caught. S1-S11 are the sim tests above, W1-W6 the worker tests. M1, M5, M6 and M19 were run again on the
final tree (`scratch/resume/mut/`) with the same failures.

| # | Mutation | File | Failing tests | Failed / run |
|---|---|---|---|---|
| M1 | `SYSTEM_KEYS` without `'firsts'` (the record is not mirrored) | `src/worker/protocol.ts` | W1, W3, W5, W6 | 4 / 6 |
| M2 | `plop` does not claim the opening (no ref on the opening news) | `src/sim/actions.ts` | S3, S9, S10, W2, W3, W5, W6 | 7 / 17 |
| M3 | `afterNetworkChange` does not claim the connection | `src/sim/actions.ts` | S4, S9, S10, S11, W2, W3, W5, W6 | 8 / 17 |
| M4 | a city without the record gets an empty one (nothing marked as had) | `src/sim/economy/firsts.ts` | S9 | 1 / 11 |
| M5 | init seeds the record at every load (a loaded record is replaced) | `src/sim/economy/firsts.ts` | S10, W5, W6 | 3 / 17 |
| M6 | `claimFirst` does not consult the record (every time is a first) | `src/sim/economy/firsts.ts` | S2, S3, S4, S5, S6, S8, S9, S10, W2, W3, W5, W6 | 12 / 17 |
| M7 | a building is the first of its own stage only (no "or higher") | `src/sim/economy/firsts.ts` | S6 | 1 / 11 |
| M8 | a building under construction counts | `src/sim/economy/firsts.ts` | S5, S7, S8, S10 | 4 / 11 |
| M9 | rubble counts | `src/sim/economy/firsts.ts` | S7 | 1 / 11 |
| M10 | `claimFirst` starts a record in a city that keeps none | `src/sim/economy/firsts.ts` | S1, S9, S11, W4 | 4 / 17 |
| M11 | a stage first draws a random number | `src/sim/economy/firsts.ts` | S5 | 1 / 11 |
| M12 | the firsts system is not registered | `src/sim/systems/economy.ts` | S8, S10, S11, W6 | 4 / 17 |
| M13 | a stage first posts one news per stage it is the first of | `src/sim/economy/firsts.ts` | S5, S6, S8, S9 | 4 / 11 |
| M14 | the seed marks only the highest stage on the map | `src/sim/economy/firsts.ts` | S9 | 1 / 11 |
| M15 | the seed does not mark the connection | `src/sim/economy/firsts.ts` | S9 | 1 / 11 |
| M16 | the seed does not mark the unique buildings | `src/sim/economy/firsts.ts` | S9 | 1 / 11 |
| M17 | the seed counts buildings under construction | `src/sim/economy/firsts.ts` | S9 | 1 / 11 |
| M18 | the record is written after the news is posted (stage firsts) | `src/sim/economy/firsts.ts` | W2, W6 | 2 / 6 |
| M19 | the replica drops a news item's ref (the event's transport) | `src/worker/replica.ts` | W3, W6 | 2 / 6 |

## Gates run in the lane (through quietrun, one process at a time, on the final tree)

| Gate | Command / files | Result |
|---|---|---|
| tsc | `npx tsc --noEmit` (TypeScript 7.0.2; the tsconfig covers src, tools and tests) | clean |
| The lane's tests | `npx vitest run tests/sim/firsts.test.ts --maxWorkers=1`; the same for `tests/worker/firsts.test.ts` | 11 / 11; 6 / 6 |
| T057 continuity | `tests/save/loadContinuity.test.ts` | 4 / 4 |
| Exact | `tests/sim/exact` (6 files) | 38 / 38 |
| Replica and recorder | `tests/worker/replica.test.ts`, `replicaLive.test.ts`, `replicaSafe.test.ts`, `viewSources.test.ts`, `emergencyTeachingWorker.test.ts`, `tests/render/terrainReplica.test.ts` | 31 passed, 4 skipped (the grown-fixture cases: no `bot256_s7_y60` fixture on this machine) |
| Hygiene | `tests/worker/hygiene.test.ts`, alone | 18 / 18 |
| Extra: the hosts | `tests/worker/exactDigest`, `recovery`, `workerRecovery`, `loopbackHost`, `localSimHost`, `hosts`, `worldResync`, `yearReviewMilestones`, `milestoneCard` | 71 passed, 1 skipped (the grown fixture) |
| Extra: news, saves, LG-21 | `tests/save/newsRef`, `tests/sim/newsRef`, `tests/save/recoveryCodec`, `tests/save/continuity`, `tests/game/yearReviewBuiltOut`, `tests/game/yearReviewHistory` | 41 / 41 |
| Bot 128x15 s7 | `npx tsx tools/simbot.ts --size 128 --years 15 --seed 7` on the lane and on the base copy | both `residents [ 61828, 95515, 40772 ]` = 198,115; the 15 annual rows and the whole output equal once the wall-clock fields are masked (`scratch/resume/bot128-*.masked`); the per-system timing line lists the same systems |
| Digest probe | `npx tsx scratch/digests.mts <baseline\|current> <bot128\|bot128hard\|bot256y27>` | the table above |

For the lead's bot run: `node <scratchpad>/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7`
must read `residents [ 61828, 95515, 40772 ]` = 198,115 on this base, every annual row equal to dev's (on a tree with
T041 the reference is dev's 192,236). Medium and Hard play bit-identically: the probe shows equal populations, funds
and random streams at every month tick, and the Hard run's residents [ 58194, 72693, 27618 ] are the base's.

## For T075 (after both lanes are in dev)

T075's listener (`src/game/ShowCamera.ts`, `FirstCameraMoments`, read at its committed HEAD ace2c94a "T075 QA round 2";
its worktree is being edited, so the numbers may move) already reads what this lane emits: the kind from `ref.first`,
the place from `x` and `z`, the caption from the text. Its kinds regex matches every kind emitted and every first's
item has a place, so its line 293 (`if (!key || !(/^(?:stage:[678]|unique:.+|neighbor)$/.test(key)) || n.x === undefined
…`) stays. The three lines to change:

1. `src/game/ShowCamera.ts:292`: `const key = (n.ref as { first?: string } | undefined)?.first;` becomes
   `const key = n.ref?.first;` (`NewsItem.ref` has the field now; the cast still compiles, so this is a clean-up).
2. `src/game/ShowCamera.ts:279`: the class comment names CONTENT as the emitter (`/** CONTENT emits ref.first once,
   when it records systemData.firsts; … */`); it is `src/sim/economy/firsts.ts` (`firstsSystem` and `claimFirst`).
3. `tests/game/showCamera.test.ts:92`: the scripted trigger (the `first` helper of lines 91-92,
   `events.emit('news', { day: 1, kind: 'good', x, z, text, ref: { first: key } })`). Keep it for the unit cases and,
   for the across-save acceptance, add one case on the real producer: a `LocalSimHost` (or `LoopbackSimHost`) booted
   with `{ createSystems: () => [firstsSystem()], CityActions }` on a sandbox city, `host.actions.plop('civ_mayor_house',
   …)`, and `host.events` as the listener's emitter; `tests/worker/firsts.test.ts` has that setup. The real-GPU QA step
   becomes "plop a landmark, save, reload, bulldoze and plop it again" instead of the scripted news item.

Also for T075:
- **The building id** is not on the news item. It is in the record, which is on the page (the replica too) when the
  news arrives: `firstsOf(ctx.state)?.[key]?.id` (`import { firstsOf } from '../sim/economy/firsts'`, or the type
  alone). The item's `x`, `z` is the building's centre cell, so `ctx.state.buildingAt(n.x, n.z)` finds it as well.
- **Its `seen` set** is now redundant for saves and resyncs, and still useful on the local host after a journal's
  replay (see the limits above). To play nothing for such a replay, start listening after `await ctx.host.ready`
  (`SimHost.ready`).
- **One building, several stages**: only the highest kind gets an item, so there is never a second spotlight on the
  same tower.

## Plan against code, and choices that need the lead

1. **Which unique openings are firsts.** I kept the set that has an opening news today, because the plan cites that
   news (FEEL-07: `actions.ts:612-614`) and T075's request says to keep ordinary news behaviour. So the stadium, the
   amusement park, the country club and the medical research center (unique, categories park and health) have no
   first: they post nothing when placed. Giving them one means posting an opening news for them (one condition in
   `plop`); the seed already marks them in old saves. The other way round, the three business deals (military base,
   missile range, toxic waste dump) do post "opens in" and so are firsts (all three probe runs announce the first two): the
   camera lane may prefer to skip `unique:rw_*`.
2. **The stage text** is plain ("first stage 6 building … : Shopping Mall.") because a stage 6 building is not always
   a tower (the mall, the tech campus, the housing projects). The stage unlock news and the milestone card call the
   stages towers, skyscrapers and supertalls; CONTENT may reword the text in `firsts.ts`. Consumers key on
   `ref.first`.
3. **A stage first means "that stage or higher"** (the table above). The plan says "the first stage 6, 7 and 8
   building"; read literally, the 256-tile city would show "first stage 6 building" some time after its first stage 7
   tower.
4. **FEEL-07 says CONTENT records the firsts** and T075 asked for the hook in `rewardsSystem.init`; the task put it in
   a module of its own (and out of `rewards.ts`, which T093, T070 and T071 change), which is what is built. §7.6 lists
   `firsts` among the mirrored keys: done.
5. **`src/sim/economy/index.ts`** (the public economy API) does not re-export the new module: one more shared file
   for one line. Consumers import `./economy/firsts` directly.
6. **Merge points with other lanes**, each a one-line hunk: the `SYSTEM_KEYS` line, the `NewsItem.ref` line, the
   `economySystems()` list (after the rewards), and the two `notify` lines in `actions.ts`.

## Findings that are not this lane's

1. **T057's continuity has two gaps in a brand-new city's first weeks, and one of them changes the game.** Both are
   identical on the base tree (`scratch/poprun-diag-*.log`, `scratch/demo-diag2-*.log`, `scratch/resume/gap-*.log`,
   probe `scratch/resume/gap-persist.mts`); test 10 found them by comparing the whole city:
   - the save of the day a city gets its first building differs right after a load in `systemData.popRun` (`cache`
     is null in the running game and filled after the load); the loaded game is equal again by day 95;
   - the saves between a city's first residents and its first education sample differ in
     `systemData.demographics.eduMean` (still -1 in the running game; the population system's init sets it at a
     load). About ten of those saves load into a game that **stays different**: on day 95 it differs in `buildings`,
     the layers, `demographics` and `popGrids` (the saves of days 31-40 of the test's city; days 36-45 of the same
     zoned strip grown by the growth system alone, 446 residents on day 95). The other saves of the window converge.
   T057's fixtures are two-year cities, so its tests do not meet either. Owner: `src/sim/economy/population.ts` and
   T057's follow-up.
2. **`tests/worker/hygiene.test.ts` timed out once** in "W0.2: speed writers…" (15.3 s against the default 5 s) when
   it ran in one vitest process after `loadContinuity` and the exact tests, with the machine busy. Alone it passes
   18 of 18 with that scan at 2.4-3.2 s. It may want a timeout like T098's.
3. **The connection news of a later connection** points at the last connection in scan order (n, s, w, e), not
   necessarily the new one (`afterNetworkChange`, before this lane). The first connection's place is right.

## Requests for cloud-held files

None. The one hunk in `src/worker/protocol.ts` is the word the task names.

## What I could not verify

- Anything in a browser or on a GPU: the toast and ticker of the new stage item, and the spotlight itself (T075 is
  not in dev).
- The full vitest suite (I ran the groups in the table), and the grown-fixture cases of the replica and host tests:
  there is no `bot256_s7_y60` fixture on this machine, so the seed on a real pre-T096 grown save through the replica
  is covered by the unit tests and the real-Worker test only.
- The 256x60 run to its end: the probe ran its first 27 years, which contain its first towers. In an earlier 256x60 s7
  run (T062's scratch, before B2) the highest stage is 7 through 2060, so the gate run probably never reaches
  `stage:8`: that kind is covered by the unit tests only.
- Timing on the 1M city: the listener was measured by event count only (20 a day at 460k residents).

## Browser checklist (with T075's recheck)

- [ ] New city: place the Mayor's House (or any landmark). The usual "… opens in …!" toast and ticker item; with
      T075, one spotlight. Bulldoze it and place it again: the same news, no spotlight.
- [ ] Build a road to the map edge: "New neighbor connection!…", one spotlight at the edge. A second road to
      another edge: the news, no spotlight.
- [ ] A city growing its first stage 6+ building (a late save, or the 256x60 s7 checkpoint before 2026): on the day
      it completes, a good-news toast and a ticker item "<City>'s first stage N building is complete: <name>."; a
      click on either focuses the building; with T075, one spotlight there.
- [ ] Save and reload after each of the three, then repeat it: no first again. `systemData.firsts` in the console
      (`ctx.state.systemData.firsts`) lists the kinds with their day, place and building id.
- [ ] The same three on `?simworker=1`, `?simworker=loopback` and `?simworker=0`: the same items and the same record.
- [ ] A save from before T096 (the y20 287k save): it loads with no first news and no spotlight; the record lists
      its landmarks, its stages and its connection with `day: -1`. Its next new landmark is a first.
- [ ] Crash recovery on the worker host (place a landmark, kill the tab, restore): the landmark is there, its opening
      is in the news feed, and no second toast or spotlight plays.
