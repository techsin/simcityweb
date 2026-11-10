# T065: the approval card rebuilds after a month tick on the replica hosts (desktop finding B1)

Cloud lane `t065-approval` (chain fix1), branch `cloud/t065-approval`, base dev `080676d`, with dev `8450a9c` (T064 FH-08-LIVE and this task file) merged in before the full gates. Task file:
docs/dev/queue/T065-approval-replica.md (on `cloud/lead-notes` as T065.md; NOTE-092 gives it to the cloud). This lane
changes no simulation: the diff is src/ui/topbar/approvalSegment.ts and one new test file.

## Cloud carry-over (Nov 3)

### Gap list (written first, from the task file, NOTE-092, NOTE-044 and the diff against dev)

New lane: nothing was done when it started (no `local/*` branch, no earlier report, an empty diff against dev).

| # | required (T065 "Do" and "Gates") | state at start |
|---|---|---|
| 1 | a failing test first: a replica or loopback host, two month ticks whose terms change, the card's rows equal `approvalBreakdown(st)` after each; show it fails on dev | missing |
| 2 | the fix in src/ui/topbar/approvalSegment.ts: a change key that works on every host without per-frame cost; no change to `mergePlain` or src/worker/**; the card's content and layout and the band rule kept | missing |
| 3 | the audit of src/ui/** and src/game/** for identity caches on `systemData` and other `mergePlain`-filled state: file:line, wrong on a replica?, owner (T064 split), a proposed patch; fix only hits inside src/ui/topbar/** | missing |
| 4 | gates: tsc; the full vitest under the lock; the bot at 198,115; the new test fails on dev and with the fix reverted; tests/game/topBar*.test.ts pass unchanged | missing |
| 5 | the report, ending with a Desktop QA list (both hosts, two months, a picture of each) | missing |

### The cause (confirmed on dev 080676d)

- src/ui/topbar/approvalSegment.ts:74 (dev) rebuilt the card only when
  `eco?.approvalTerms !== this.apprTerms || hud.band !== this.apprBand`, an identity test. Its comment said the terms
  object is "a new object each month".
- That holds on the main-thread host: src/sim/economy/approval.ts:431 assigns `data.approvalTerms = T` (a new object) at
  every monthly update.
- On a replica host (the worker's `?simworker=1` and `?simworker=loopback`), src/worker/replica.ts:217 applies each
  packet's `sys.economy` with `mergePlain` (src/worker/protocol.ts:323), which keeps every surviving nested object
  identity. So the replica's `economy.approvalTerms` is the same object every month, the identity test never fires
  after the first build, and the card keeps the terms of the month it was first built in.

### The failing test, before and after

New file **tests/game/approvalCardReplica.test.ts** (a new file; tests/game/topBar*.test.ts are not edited). Both of its
cases run on two hosts: the main-thread host (`LocalSimHost`) as the control, and the loopback replica host
(`LoopbackSimHost`, design cadence, the same `Replica` class the worker host uses).

1. **"rebuilds after each month tick"**: a generated 32x32 city with residents (`stressCity(32, 7, false)`), run to the
   next month tick. The card's rows (label and signed value) must equal `approvalBreakdown(st)` without `clamp`, top 10,
   formatted as the card formats them. Then the residential taxes go to 15% (through `host.actions.setTax`), one month
   runs, and the rows must match again. Then the taxes go to 5% and the check repeats. Each month asserts that the tax
   term really changed, so the test cannot pass on a stale card by luck.
2. **"does no card work on frames of the same day, nor on a new day whose terms are unchanged"**: after a build, 10
   frames on the same day and one non-month day. `approvalBreakdown` must not be called, and the card's child nodes
   must be the same nodes. This guards the "no per-frame cost" rule against a naive fix that rebuilds every frame or
   every day.

| run | result |
|---|---|
| dev 080676d (`approvalSegment.ts` as on dev) | **case 1 on the loopback replica host FAILS** at the first month tick: the card still shows the init terms ("Power / water outages −25.0", "Unemployment −15.5", "Crime at homes −14.3", ...) while `approvalBreakdown` gives the month's ("Unemployment −32.1", "Power / water outages −19.0", "Crime at homes −15.1", ...). The main-thread case passes, as the desktop saw. 1 failed, 3 passed. |
| lane e85ffe0 | 4 passed (4) |
| lane with the fix reverted (dev's approvalSegment.ts restored over the lane) | case 1 on the loopback replica host fails again: 1 failed, 3 passed |
| mutation: the rebuild condition forced true on every frame | case 2 fails on both hosts (2 failed, 2 passed): "expected approvalBreakdown to not be called at all, but actually been called 12 times" (the spy intercepts the segment's import) |

### The fix

src/ui/topbar/approvalSegment.ts, inside `update()`'s terms block, plus two private fields:

- The segment keeps a **content key** of the terms (`id:value;` for each term) next to the terms object it built from.
- The key is rebuilt **only when the terms object or the sim day changes**. Every other frame adds only a day compare and a
  compare of the same string reference to the old test, with no allocation.
- The card rebuilds when the terms object changes (the main-thread rule, unchanged), when the content key changes (the
  replica's months), or when the band changes (the FH-06 band rule, unchanged).
- On the main-thread host, every rebuild that happened before still happens, for the same reason. A new day whose terms
  object is unchanged builds a ~20-term string once and compares it, and nothing else. On a replica the card now rebuilds
  in the packet that carries the month's terms, because that packet also carries the new day.
- The card's content and layout are untouched. `mergePlain` and src/worker/** are untouched.

Hunk size: 17 lines added, 4 removed, all in `update()`'s terms block and the field list. No other topbar file is
touched. No T064 branch touches approvalSegment.ts (checked against dev 8450a9c: cloud/t064-fh08live,
which is already merged and touches only cityDate.ts; cloud/t064-feel03; cloud/t064-feel19; cloud/t064-fh16). So no
conflict is expected.

### Audit: identity caches on `mergePlain`-filled state in src/ui/** and src/game/**

**What a replica fills with `mergePlain`** (src/worker/replica.ts):

- `CityState` PLAIN_KEYS: `funds`, `nextBuildingId`, `stats`, `budget`, `milestones`, `neighborConnections`;
- `systemData` SYSTEM_KEYS: `economy`, `infraVersion`, `infraLayers`, `advisors`, `regionJobs`, `regionWorkers`;
- the policy view (`host.policy`);
- the emergency stream: incidents (merged per id), vehicles and stations;
- the disasters list.

**How the search ran.** I went through every `=== this.x` / `!== this.x` in both trees, every object-typed cache field,
every `WeakMap` / `WeakSet`, and every read of the sections above. For each read I asked whether a value is held across
frames and compared by identity.

| file:line (dev 080676d) | what it caches | wrong on the replica hosts? | owner (T064 split) | action / proposed patch |
|---|---|---|---|---|
| src/ui/topbar/approvalSegment.ts:74 | `economy.approvalTerms` by identity, expecting a new object each month | **yes** (finding B1) | guide2b (src/ui/topbar/**) | **fixed in this lane** (above) |
| src/ui/topbar/rciSegment.ts:176-179 | `econData().regionTerms`, by a **content** signature of its numbers | no | guide2b | none |
| src/ui/topbar/rciSegment.ts:251 | the zone recount memo, keyed by `CityState` identity plus 1 s of real time | no: the state object is replaced on a load on every host | guide2b | none |
| src/ui/MiniMap.ts:131 | the paint, keyed by `CityState` identity and the overlay | no (same reason) | §7.3 owner of MiniMap.ts (not in the T064 split) | none |
| src/ui/panels/GraphsPanel.ts:157 | the history redraw, keyed by `history.t` length and its **last value** | no: a value test. History is appended in place on both hosts and is not `mergePlain`'d. | guide2a | none |
| src/ui/newsLog.ts:11-24 (Notifications.ts:150, :292 use it) | the newest news item, by identity | no: the replica pushes a fresh copied item per News log entry (replica.ts:284-288). News is not `mergePlain`'d. | not in the T064 split | none |
| src/ui/advisorModel.ts:86 | the outage count per `CityState`, with the building count and 1 s | no: values, not identities | not in the T064 split | none |
| src/ui/ruinState.ts:24-44 | the ruin index per `CityState`, keyed by a string of building count, next id, day and command count, plus the `buildings` Map's identity | no: the Map is mutated in place on both hosts, and the string key carries the changes | not in the T064 split | none |
| src/game/demolishRisk.ts:134 | producers per `CityState`, keyed by building count and next id | no: values | not in the T064 split | none |
| src/ui/EmergencyBanner.ts:547, :638, :772 | the policy object (pushed by `host.policy.subscribe`); :772 compares the **setting string** | no: changes arrive by subscription, not by an identity test | T047 / EmergencyBanner owner (not in the T064 split) | none |
| src/ui/EmergencyBanner.ts:641; src/game/GameSounds.ts:75 | incident objects kept by id | no: on both hosts these are the live incident objects, mutated in place (the main thread by the sim, the replica by `decodeIncident`). Nobody compares their identity to detect a change. | not in the T064 split | none |
| src/ui/MilestoneCard.ts:173 | compares `stats.population` **values** | no | not in the T064 split | none |
| src/ui/YearReview.ts:96, :128; src/game/tools/placement.ts:95 | read `systemData.economy` / `regionJobs` / `regionWorkers` when called, with no cache | no | guide2c (placement.ts); YearReview.ts not in the T064 split | none |

**Result: one hit, the B1 card itself, now fixed.** There are no requests to other owners.

Two observations from the audit. Neither is an identity cache, so neither is changed here:

- src/ui/topbar/rciSegment.ts:176 reads `econData(this.ctx.state)`. `econData` normalizes with `??=`, and replaces a
  missing or non-v1 economy with a fresh default, so on a replica this read can write into replica state. In practice
  every field already arrives from the primary, where `econData` ran first, so nothing is written today. A read-only
  accessor would make this airtight: `const t = (this.ctx.state.systemData.economy as EconData | undefined)?.regionTerms;`.
  Owner: guide2b. It is outside T065's scope, so I left it as a note.
- src/game/NewYear.ts:325-328 already says that the replica does not mirror `systemData.foundedDay` (it is not in
  SYSTEM_KEYS). That is known and deliberate there, and it is not this pattern.

### Gates

| gate | result |
|---|---|
| tsc (`npx tsc --noEmit`, under sem) | clean, exit 0: on the lane commit e85ffe0 (8.8 s), and again after merging dev 8450a9c (5.7 s) |
| new test fails on dev, passes on the lane, fails with the fix reverted | yes; see the table under "The failing test" |
| TopBar trace fixture tests, unchanged (tests/game/topBarSplit, topBarSegments, topBarFrame; plus approvalHud) | On base 080676d: 4 files, 26 tests passed. After merging dev 8450a9c (FH-08-LIVE added one case and re-recorded the fixture): 4 files, 27 tests passed. This lane changes neither the trace fixture (tests/game/fixtures/topBarTrace.json) nor those test files (`git diff` against dev: empty), so no re-record was needed. With the new file: 5 files, 31 tests passed. |
| full vitest (under the timing lock) | **green** on the merged tree dc7c00c: 310 files passed and 4 skipped (314); 3,121 tests passed and 32 skipped (3,153); 366.95 s (lock held 07:11:27-07:17:34). The skips are the suites' own `skipIf` / opt-in conditions; the new file has none. |
| the bot, 128x15 seed 7 (under the timing lock) | **identical**: `residents [ 61828, 95515, 40772 ]` = 198,115, the reference. Run on the merged tree dc7c00c, lock held 07:09:56-07:10:35. |
| hygiene (no `.speed =`, `emergencyOf(` or `getSystem(` in src/ui, no replica writes) | the change adds none; tests/worker/hygiene.test.ts is part of the full run above |

### Decisions

1. **The change key: a content key re-read once per sim day, not the month index.** The task offers "a monthly stamp the
   economy already publishes" or "a cheap content key built only when a stamp changes". The economy publishes no
   monthly stamp in `systemData.economy`. `st.monthIndex` would work for the normal month tick, because the replica gets
   the month's terms in the same packet as the new day. But it would miss terms that change within a month. For
   example, a replica whose first economy patch fills an `approvalTerms` object that already exists (`mergePlain` keeps
   the empty object) would keep an empty card for up to a month. The sim day is just as cheap a stamp and catches those
   cases within a day. The string is built at most once per sim day: 30 times a month, 20 times a second at speed 3.
2. **The identity rule stays as well as the key.** This keeps the main-thread host's rebuilds exactly as they were
   (the TopBar trace fixture depends on them), and the new key only adds the rebuilds that the replica was missing.
3. **Known edge, accepted:** a replica resync that changes the terms while the game is paused (so the day does not
   change) shows the new terms at the next day tick, not at once. Catching it at once would need a per-frame content
   compare (which the task rules out) or a stamp from src/worker/** (which belongs to guide2c and the task rules out).
4. **The bot runs on the lane only, not on a dev export as well.** The diff touches no src/sim, src/worker, src/game or
   src/save file. A static walk of tools/simbot.ts's imports (95 files) reaches no src/ui file. T065's own gate asks for
   198,115, so the lane's bot runs once under the lock and is compared with that reference. Dev's bot would run the
   same files.
5. **The test is placed in tests/game/** next to the other TopBar tests, as a new file. Its host fixture uses the public
   `host.actions.setTax`, so it does not depend on either host's internals. The one exception is the loopback
   harness's `runDays` / `drain`, as tests/worker/milestoneCard.test.ts already uses them.

### Browser evidence

None was taken on the cloud (NOTE-059 / NOTE-061: browser checks run on the desktop after the merge). The unit test
above stands in for the browser check on both host kinds. The Desktop QA list below is the real-GPU check.

## Desktop QA

Test dev after this lane merges (or `cloud/t065-approval` at the commit named in the merge NOTE). Use 1280x720, and the
dev server's page (for example `http://localhost:5173/`).

1. **Worker host, two months.** Open `http://localhost:5173/?simworker=1`. Start or load a city with residents (a few
   hundred or more). Set Normal speed. Hover the top bar's Approval segment and take **picture 1a** of the card's rows
   and its "heading for N%" line, noting the date. Open Budget and set the residential taxes to 15%. Let the date pass
   the 1st of the next month, hover again, and take **picture 1b**. Set the residential taxes to 5%. Let one more month
   pass, hover, and take **picture 1c**.
   **Expected:** the rows change with each month. The Taxes row appears or changes between 1a and 1b, and changes
   again in 1c, and the other values move too. Before this fix, 1b and 1c showed 1a's rows.
2. **Default host, the same steps.** Open `http://localhost:5173/` (no flag) and repeat item 1 for **pictures 2a, 2b
   and 2c**.
   **Expected:** the same behavior as item 1, which is also the behavior before the fix on this host (the control).
3. **Loopback host (optional, the same code path as item 1).** Open `http://localhost:5173/?simworker=loopback` and
   repeat item 1 once for **pictures 3a and 3b**.
   **Expected:** as in item 1.
4. **Card behavior unchanged, on either host.** With the card open, check that its rows open their fixes as before
   (Crime opens the Police view, Taxes opens Budget · Taxes, Parks opens the Parks tab), and that a city of 0 residents
   shows "Approval —" with no rows.
   **Expected:** the same behavior as on dev before this lane.
