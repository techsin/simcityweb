# local-T093-reward-load: a mid-month load must not lose a reward's announcement (T093; NOTE-081, the T054b finding)

Branch `local/T093-reward-load`, base `2100f1b` (dev `825ee22` plus the task file). Changes uncommitted, as asked.

**Status: done.** A load now restores the rewards state exactly as saved, and the month tick announces what the city
earned since its last tick, as in a game that was never saved. One line of `rewardsSystem.init` changed; no saved field
was added, so the saves of a continuous run are byte-identical to base. Every gate of the task passes here. Left for
the lead: the full vitest and the browser check (a save for it is ready, below). **Two points need the lead's
decision** ("For the lead to decide"): what happens to rewards added to the game after a city's save, and a second,
unrelated way a load changes a reward (the Seaport's coastline cache), which I found and did not fix.

## What was wrong

`rewardsSystem.init` ran `check(sim, true)` on every init, and in the game every init is a load (`SimCore.boot`
inits the systems on a deserialized city). The check unlocks whatever the city's state meets today, silently. The
month tick is the only place that announces.

- **A save between the day a reward is first earned and its tick** loaded with the reward unlocked and marked
  announced. No news, toast, card or sound ever came. Reproduced on base with the lead's probe, same output as
  `rewards-load-baseline.log`.
- **The same for ranks** (`systemData.cityRanks`, set in the same check): a rank crossed in mid-month was recorded at
  the load.
- **Where the conditions no longer hold at the tick, the difference never closed.** A reward or rank earned and lost
  again before the tick (the population falls back) was held by the loaded game only.
- **How often.** In the 128×15 seed-7 bot city all 38 rewards it unlocks are earned some days before their tick: 26
  windows of 1 to 30 days, **428 of 5,400 days (7.9 %)**. A save on any of those days lost at least one announcement.
  One window begins on a tick day: approval is computed after the rewards system in the same tick, so the Statue is
  earned on day 3000, after that day's check, and unlocked on day 3030.
- **T057's claim in that window.** The 48² seed-5 town of the finding, saved on each day from 360 to 449 (economy
  systems, the whole serialized city compared per key, T057's method): on base **30 of 90 saves** differ right after
  the load (`sets`: days 382–389 the Mayor's House, days 398–419 the Cemetery), and each still differs on day 450
  (`data.news`: the announcement never came). On the branch **90 of 90** are equal right after the load and on every
  day to day 450.

## Why init checked at all

The call is in the file's first version (`06be0d6`, 23 Sep). No comment, commit message or plan line gives a reason
for the rewards part; `silent` has no other caller. What the code makes of it:

1. **Sandbox.** In the check a sandbox city passes every reward whatever its state, and the monthly check announces.
   Without the silent pass at init a new sandbox city would hold nothing in `unlocked` for its first month and post 43
   reward items on day 30. This is the one purpose the file states ("Sandbox unlocks everything"). `config.sandbox` is
   set when the city is created and never changes.
2. **A city whose sets are behind its state when the system first sees it:** a save from before a reward existed or
   whose rule changed, and a city put together by a tool or a test with its population set by hand. Two tests rely on
   it: `ranks.test.ts` "loads an old save without rank flags silently, without re-granting rewards or changing sim
   data" (its 300,000-resident state gets its rewards at the first init), and T071's "silently fills missing late
   unlocks on an old save without new systemData".
3. **Since LG-01 (`425f072`): the rank record of an old save.** The only documented purpose: the comment in the check,
   and POLISH_PLAN LG-01, Risk ("On load, old saves record the ranks they have already passed silently, the way
   `rewardsSystem` does with `check(sim, true)`").

What it could not do is tell case 2 from a reward first earned since the last tick. That is the bug.

## The change

**`src/sim/economy/rewards.ts`, `init` only (+7 −1).** The check body, the table and the monthly call are untouched.

```ts
    init(sim) {
      rt.attach(sim);
      // T093: … (six comment lines)
      if (!sim.state.systemData.cityRanks) check(sim, true);
    },
```

The rank record is written by this check at every init and every tick since LG-01, and saved with the city. Its
presence says "this system has checked this city before", so it serves as the marker:

| city at init | before | now |
|---|---|---|
| new city (no record) | checked silently: the Settlement rank; sandbox unlocks everything | the same |
| save with the record (every save since LG-01), sandbox or not | checked silently: unlocked what its state met that day, recorded the ranks | **nothing: `unlocked`, `announced` and the ranks stay as saved; the next tick unlocks, announces and records** |
| save from before LG-01, or a city made by a tool (no record) | checked silently | the same; the load writes the record, so its later saves follow the row above |

- **Purposes kept.** Sandbox: a new sandbox city has everything unlocked at once, without news; a loaded one already
  holds everything. Old saves and tool-made cities without the record: checked silently, ranks included, as before.
- **Without the silent unlock.** For a city with the record, case 2 above is now the month tick's work, with news
  (decision 1 below).
- **Not fixable for saves from before LG-01:** nothing in them says what their last tick saw, so one saved inside a
  window still loses that announcement at its first load, as before.
- **No new saved field.** The task allowed one; it is not needed for the bug. Decision 1 says where one would be.
- No hunk in `src/sim/infra/*`, none outside the task's files, no cloud-held file touched.

## `cityRanks` and the other state touched at init

- **`cityRanks`:** the same defect and the same fix (table above). It matters beyond the record: LG-21's year review
  reads it (`history.ts` `recordReviewGoals`).
- **`'unlocked'` events:** the old init emitted one per silently unlocked reward during the load. None now; the tick
  emits it with the news.
- **`rt.attach`:** runtime only, unchanged.
- **`history.ts`** (T054) already leaves a goal reached since the last tick to the next tick. Its init comment names "a
  reward rewards.init unlocks on load"; that now happens only for a save without the rank record. Not edited (not this
  lane's file).
- **Not touched at init, found on the way:** the Seaport's coastline cache (decision 2).

## Tests (new files; 13 tests)

`tests/sim/rewardsLoad.test.ts`: the rewards system alone on a scripted population that passes six thresholds in
mid-month and falls back under two of them before the tick. Every loaded game must hold the uninterrupted game's
rewards record (both sets in order, the ranks, the reward news) right after the load and on every day to day 450.

1. the uninterrupted game unlocks and announces at the month ticks only, what the city holds on that day
2. a save between the day a reward is earned and its tick: nothing is unlocked at the load, the tick announces it
3. a rank crossed since the last tick is recorded at the next tick, and one lost again before it is not recorded
4. a load emits no unlocked event and posts no news; the tick emits both, once per reward
5. an old save without the rank record (from before LG-01) is checked silently at the load, as before
6. a reward added to the game after a save: the next tick brings it with its news; a save without the record gets it at the load
7. a sandbox city has everything unlocked from its start, without news, and a load changes nothing

`tests/save/rewardsLoadContinuity.test.ts`: the finding's town (48², seed 5, one bot year, every free cell zoned,
the economy systems), saved as a file on every day from 360 to 449. A new file rather than an edit of T057's
`loadContinuity.test.ts`; it uses T057's per-key digest.

1. the uninterrupted town earns the Mayor's House and the Cemetery in mid-month and gets each at its tick, with its news
2. loads on day 383 and on day 388 leave the Mayor's House locked, and its news arrives at the tick on day 390
3. the Cemetery window: loads from day 398 to day 418 leave it locked, and its news arrives at the tick on day 420
4. every day's save, from day 360 to day 449, equals the uninterrupted game right after its load: the rewards record and the whole city per key
5. the whole city, per key: a save inside a reward's window continues bit-exact through its tick (economy systems)
6. an old save without the newer fields (the rank record, T057's records) loads, and is checked silently as before

Tests 2 and 3 also compare the rewards record with the uninterrupted game's on every day to day 450. The town's
assertions name only the two rewards, so a reward another lane adds does not break them.

**Checked by revert and mutation** (`init` changed, both files run, then restored):

| `init` | failing |
|---|---|
| base: `check(sim, true)` | 11 of 13 (the two left only describe the uninterrupted games) |
| guard inverted | 12 of 13 |
| no check at init | 5 of 13 (the new city's first rank, old saves, sandbox) |
| check on day 0 only | 4 of 13 (old saves) |

## Gates

Every vitest and bot command went through `quietrun.mjs`, one process at a time, `--maxWorkers=1`.

| gate | result |
|---|---|
| `npx tsc --noEmit` | clean |
| the new tests | 2 files, **13 passed** |
| the rewards tests: `ranks`, `milestoneNews`, `newsRef`, `history`, `economy` | 5 files, 77 passed |
| the save tests: all 24 existing files of `tests/save` (`loadContinuity` and `grownCity` included) | 119 passed |
| `tests/sim/exact/*` | 6 files, **36 passed** |
| also run: the other 33 files of `tests/sim`; 13 `tests/game` and 6 worker / infra / render files that read the rewards state; 10 worker load, save and recovery files (`hosts`, `loopbackHost`, `recovery`, `workerRecovery`, `workerStorage`, `exactDigest`, `simCore`, `querySideEffects`, `protocol`, `hygiene`) | all pass (97 existing files in all, 1,026 tests, 6 skipped by their own flags) |
| bot 128×15 s7 | **residents [ 61124, 93804, 37971 ] = 192,899**, `unlocked 38`; the whole output with `SIMBOT_LOG=1` (1,188 lines, the action log included) identical to base apart from the two timing columns, the run time and the ms/day line |
| digests of a continuous run, two processes (base tree, branch tree) | 128×15 s7 on Medium, Hard and Sandbox: the exact digest (`exactDigest`) and the whole save's SHA-256 **equal at all 180 month ticks** and on day 0; the final save equal in 10 of 10 parts and 29 of 29 systemData keys. Medium ends at exact 1355575934, SHA `486837ca…`, the values of T054b's base run. The save file itself (`encodeBundle`, `savedAt` 0) has the same bytes in all 181 saves of the Medium run |
| the lead's probe | base: the loads on days 383, 388 and 398–418 unlock at once, as in `rewards-load-baseline.log`; branch: no load unlocks anything, the news comes on days 390 and 420 |

Left for the lead: the full vitest, and the browser check. The bot line to repeat:

```
SIMBOT_LOG=1 node <lanes>/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

It must print `residents [ 61124, 93804, 37971 ]` and the same action log as dev.

## For the lead to decide

**1. Rewards added to the game after a city's save.**
- **Before:** a loaded city that already met one got it at the load, without news.
- **Now:** a city with the rank record gets it at its first month tick, announced like any other reward (FEEL-06's
  toast, card and sound), several in one tick if it qualifies for several. A sandbox save gets every added reward at
  that tick, also announced, because the monthly check announces in sandbox too. Test 6 of the scripted file pins this.
- **Who it concerns:** T071's seven landmarks (200k to 1.5M) and T070's honours, on saves made before they land. A
  1.5M city gets seven landmark items and at least two honours (Megacity, Megalopolis) on its first tick after the
  update.
- **Why I left it so.** Telling "added since the save" from "earned since the last tick" needs the save to say what it
  was checked for: a list of reward ids in `systemData`, written at init (about 0.7 KB, about six more lines in
  `init`; a reward not in the list would be checked silently at the load). That adds a key to every city from day 0,
  so the whole-save digest of a continuous run changes by that key, which the task's gate rules out. An announcement
  also seemed the better default for new content. If the lead prefers silence for added rewards, that list is the
  change to ask for. A save without the list would then count as checked for today's 43 rewards, so it has to land
  before T070 and T071, or with them.

**2. The Seaport's coastline is cached per city object and never refreshed** (`hasWater`, `rewards.ts`). Not fixed:
it is outside `init`, and a fix changes what a running game does.
- The cache is filled at the first evaluation and kept for the life of the `CityState`. Terraforming and disasters
  recompute the water (`actions.ts` `terraform`, `disasters.ts:409`), so the running game can hold a stale answer,
  while a loaded game counts again.
- **Probe** (`coastline-cache.mts`): a dry 64² map, 313 water cells dug after the first evaluation. The running game
  says "Coastline: no" and never unlocks the Seaport with 7,000 industrial jobs; the same city saved and loaded says
  "Coastline: yes" and unlocks it at its next tick.
- The panel has the same staleness on its own: `listRewards` runs on the replica, which has its own cache.
- **A fix, if wanted:** drop the cached value on `terrainChanged` (the economy runtime already listens to it), or
  count on demand and stop at 41 cells.

## T070 and T071: what to mirror

Trial merges in scratch: `git merge-file` on `rewards.ts` (base, this branch, each lane), then each lane's tree with
the merged file and the scripted test file. Their base (`1c2019c`) predates T057, so the town file cannot run there.

**T071 (LG-02): nothing to mirror.** It only appends to `REWARDS`; the merge is clean; its `lg02Landmarks`, `ranks`
and `milestoneNews` tests pass with this change (82 tests with mine). One line of its report no longer holds as
written: "silent old-save initialization" is true only for a save without the rank record (its test wipes all of
`systemData`). Every save since LG-01 has the record, so decision 1 applies to its landmarks.

**T070 (LG-20, FH-26; its working copy of 10 Nov): one conflict, in `init`, and one line to change.**

```ts
    init(sim) {
      rt.attach(sim);
      if (!honoursData(sim.state)) updateHonours(sim.state, false, rt, parkReach);   // was unconditional
      updateApprovalReward(sim.state, false, true);
      // T093: …
      if (!sim.state.systemData.cityRanks) check(sim, true);                          // was check(sim, true)
    },
```

- **The conflict:** keep T070's two lines, then this branch's comment and guarded check.
- **`updateHonours` at init surveys on every load**, so a loaded city's `honours.homes`, `noisyShare` and `parkShare`
  are those of the load day until the next tick, where the uninterrupted game holds the last tick's survey. Probe
  (`t070-honours-load.mts`): 4 of 10 homes turn Noisy on day 40, save on day 45: `noisyShare` 0 as saved, 0.4 right
  after the load. Before this change that survey also fed the silent check at the load (Quiet City and Green Belt
  read it). With the guard above the record is as saved, and T070's own tests still pass (`honours`,
  `honoursSurvey`, `approvalReward`, `approvalRecovery`, `ranks`, `milestoneNews`: 207 tests with mine, with and
  without the guard).
- **`updateApprovalReward(…, true)` needs nothing:** it already returns on an existing record. The streak counters
  are moved by `monthly` and `daily` only.
- **Its check line** (`r.kind === 'honour' || !st.config.sandbox`) merges without conflict and needs nothing.
- **Consequence for it:** on a save from before T070, the honours a city already qualifies for are announced at its
  first month tick instead of being granted silently at the load (decision 1).
- **After both are in dev,** tests 4 and 5 of the town file cover T070's records too. I expect them to fail on
  `sd.economy` while the survey still runs at a load (the town's count of occupied homes changes between ticks); not
  run, see "Not verified".

## Plan against code

- **POLISH_PLAN LG-01, Risk** ("old saves record the ranks … the way `rewardsSystem` does with `check(sim, true)`")
  now describes a save without the record only.
- **FEEL-06, Acceptance** ("Loading a 300k save posts nothing") holds at the load. At its next tick a city posts what
  it earned since its last tick and, after an update, the rewards added since (decision 1).
- **The task's "saved record if it needs a field":** it does not; none was added.
- **T057's report** says the economy systems continue bit for bit from every save. Its 32 saves were equal, so none
  can have fallen in a window; in the windows it holds from this branch on.

No request for a cloud-held file.

## Not verified

- The full vitest and anything in a browser (the lead's).
- T070, T057 and this change together (see above).
- The two fixture files from before LG-01 (bot256 y60, dense1m) were not loaded. Their path, a city without the
  record, is the unchanged one, and the tests that strip the record cover it.

## Browser checklist

A save for it: `t093_cemetery_window.region.metropolis` in the scratch folder below (the default 128² seed-7 bot
city on 3 September 2000, 2,012 residents, the Cemetery earned and locked, 27 days before its tick). Load Region →
Import file → Open → the city → Play. Headless with all systems it behaves as listed (`check-browser-save-*.log`).

- [ ] At the load: no reward toast, card or sound. Rewards shows the Cemetery "Locked" at 100 % ("Population 2,012 /
      2,000") and the Mayor's House "Unlocked". On dev before this change the Cemetery shows "Unlocked" at once.
- [ ] Run to 1 October 2000 (27 days, about 14 s at 1×): the toast "Reward unlocked: Cemetery! A quiet resting
      place." with "Place it", FEEL-06's card, the reward sound and the Rewards badge appear once, and the row turns
      "Unlocked". On dev before this change nothing happens on 1 October.
- [ ] Save in the game around 10 September, leave to the region and open the city again: the Cemetery is still
      locked, and 1 October brings the toast once.
- [ ] The same on both hosts, if both are checked (the worker and the local fallback).
- [ ] A new sandbox city: Rewards shows everything unlocked from the first day, and the first month tick posts no
      reward toast (unchanged).
- [ ] A save taken on a month tick (any `--save-years` city) opens as before, with no reward toast at its next tick
      unless the city has earned something since.

## Scratch

`scratchpad/lanes/T093/scratch/` (the session's scratchpad):

- `rewards-load.mts`, `rewards-load-before.log`, `rewards-load-after.log`: the lead's probe on this tree.
- `town-allkeys.mts`, `town-allkeys-baseline.log`, `town-allkeys-T093.log`: the 90 saves, whole city per key.
- `list-windows.mts`, `list-windows-128x15-s7.log`: the bot city's 26 windows.
- `digests.mts`, `compare.mjs`, `digests-bot128*-{baseline,T093}.json`, `compare-bot128*.json`: the two-process
  digests. `savebytes.mts`, `savebytes-{baseline,T093}.json`: the save files' bytes. `bot128x15-s7-{baseline,T093}.log`
  and `.stripped`: the bot outputs.
- `sandbox-month.mts`: the 43 items a sandbox city would post without the check at init.
- `coastline-cache.mts`, `coastline-cache.log`: decision 2.
- `mergefile/` (`t070-merge.diff`, `merged-T071.ts`), `t070-honours-load.mts` and its two logs, `trial-T07*-vitest*.log`:
  the trial merges.
- `browser/t093_cemetery_window.*`, `make-browser-save.mts`, `check-browser-save.mts` and its logs: the browser save.
- `vitest-*.log`: every vitest run above; `vitest-mutation-*.log`: the revert and the mutations.
- `baseline/`: `git archive` of the base commit, the base arm of every comparison.

All code, tests and gates in this lane are by its implementing agent (Claude); no Codex part.
