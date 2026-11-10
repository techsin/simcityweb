# T054b report: LG-21's built-out grade reads a real producer (desktop, NOTE-076 item 2)

**Status: done in the lane; the full vitest and the bot on the merged tree are recorded by the desktop worker at the
end.** `AdvisorData.full` is published from the LG-05 block, T054's history reader picks it up in the same month
tick, and the year review grades a land-full city on unemployment. The 128x15 s7 bot stays at 192,899 with every
digest unchanged, and the 256x60 grade check passes 51 of 51 years.

## Changes per file

- `src/sim/economy/advisors.ts` (+7 lines, its own commit): `full?: boolean` on `AdvisorData`; right after the LG-05
  block's `const full = …`: `if (mode === 'month') { if (full) advisorData(st).full = true; else delete
  advisorData(st).full; }`.
- `tests/game/yearReviewBuiltOut.test.ts` (new, 5 tests).
- No `src/sim/infra/*` hunk, nothing outside the named files. `history.ts` is untouched: the tests show the reader right.

Two properties of the publication:
- **Only the month tick writes it.** `gather()` also runs for the Advisors panel (`openAdvice`) and the day-29
  prediction, which are read-only by contract; the bot calls `openAdvice` too.
- **The field exists only while the map is full.** A city with land left has no `full` key, like a save from before.
  That keeps NOTE-048's "the exact and determinism digests do not change" literally true, because `exactDigest` walks
  `systemData.advisors`. (An explicit `false` would change every city's exact digest and saved bytes after its first
  month tick; three tests assert there is no such field.)

## T057 (save/load continuity)

`advisors` is not one of T057's continuity records (`econLists, lvRun, desRun, popRun, demandRun, approvalRun,
growthRun`). It is ordinary `systemData`: saved with every save, kept by lean recovery snapshots, mirrored to the
replica through `SYSTEM_KEYS`. So `full` needs no save hook: it is saved as plain data and rewritten at each month
tick, before the history system samples it (advisors runs right before history in `economySystems()`; a test asserts
it). A save from before the flag differs only in `sd.advisors` until its next month tick, then equals the
uninterrupted game again.

## Tests (`tests/game/yearReviewBuiltOut.test.ts`, all pass)

1. A town zones its last free land: the flag at the next month tick, the series from that month, the year graded on
   unemployment; freed land takes it back. (Year 2 shrinks 6 % with 6 % unemployed: growth stat 75 where growth
   scoring gives 0.)
2. Land exhaustion and the built-out card stay distinct: a full map with weak demand has the flag and no card.
3. A built-out card the Advisors panel already shows publishes nothing: only the month tick writes the flag.
4. A real economy: a bot city (48x48) zones its last free land; saved games continue bit for bit (T057), and an older
   save catches up at its month tick (six saves, each compared per key for 30 days; a lean recovery delta too). This
   test runs the economy without the rewards system: see finding 1.
5. On the packet host the replica mirrors the flag and the series, the card grades from them, and freed land takes the
   flag off the replica too (LoopbackSimHost, the real `YearReview` card).

Negative controls (advisors.ts mutated, run, restored): publication removed, 5 of 5 fail; published by every pass, 3;
always assigned including `false`, 4 (tests 1, 3, 4 and 5; REVIEW-T054b counted them); the demand-gated card flag published instead, 4.

## Gates run in the lane (through quietrun)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| The new file | 5 passed |
| `tests/game/yearReview*.test.ts`, `yearGrade`, `tests/worker/yearReviewMilestones` | 8 files, 79 passed |
| Advisors tests (10 files) | 98 passed |
| `tests/save/loadContinuity.test.ts` | 4 passed |
| Related UI, save and worker files (19 files) | 182 passed, 3 existing skips |
| `tests/sim/exact/*` | 36 passed |
| Bot 128x15 s7 | residents [ 61124, 93804, 37971 ] = 192,899; stdout identical to the base tree's apart from timing columns |

## Digest proof (two-process probe, base tree 03faf94 against the lane)

| Scenario | Result |
|---|---|
| Bot 128x15 s7, Medium, base vs lane | 180 of 180 monthly checkpoints equal: exact digest, whole-save SHA-256, population, funds, RNG |
| Same, lane vs lane (two processes) | 180 of 180 equal |
| Bot 128x15 s7, Hard, base vs lane | 180 of 180 equal; residents [55776, 75796, 30281] on both |
| Land-full 64x64 bot city, 8 years | the 36 months before the fill are raw-equal; afterwards, with `advisors.full` and `history.builtOut` projected away, 96 of 96 equal; population, funds and RNG equal at 96 of 96 |

The bot's own city never comes near the threshold: least free land 10.10 % (Medium) and 12.81 % (Hard); the flag needs
under 1 %. So the flag feeds nothing but the series.

## 256x60 grade check (C or better every year from 2010)

`npx tsx tools/yeargrades.ts --size 256 --years 60 --seed 7 --quiet --json <out.json>` through quietrun, 4 min 28 s.
**PASS: 51 of 51 years from 2010 score 55 or more; B 38, A 13; lowest 73.53 (B) in 2060; built-out years 0.** Residents
[412608, 738176, 363051] = 1,513,835. All 60 years equal T054's earlier desktop run exactly.

## Findings

1. **A pre-existing bug, not this lane's: a save taken mid-month loses a reward's announcement.** `rewardsSystem.init`
   runs `check(sim, true)`, so a load silently unlocks a reward whose conditions were first met since the last month
   tick; the uninterrupted game unlocks it at the tick, with its news. Reproduced on the base tree (48x48 bot town,
   economy systems): loads on days 383 and 388 come up with the Mayor's House already unlocked, and no reward news
   posts through the tick on day 390, where the uninterrupted game posts "The citizens have built you a Mayor's
   House! Place it from Rewards."; the same for the Cemetery on days 398-418. The loaded game's `unlocked` and
   `announced` sets differ right after the load, so T057's "economy systems continue bit for bit" does not hold in
   that window. `cityRanks` is set in the same check and is probably affected too (not tested). Test 4 leaves the
   rewards system out for this reason. Owner: `src/sim/economy/rewards.ts` (CONTENT) and T057's follow-up.
2. **The 256x60 bot is never land-full** (T037b measured 8.10 % free land at y55), so the shipped grades equal the
   earlier ones; T054's report expected late years to switch to unemployment scoring.
3. LG-21's table says "a built-out city, LG-05"; the grade keys on land exhaustion alone, as NOTE-048 decided.
4. Stale wording outside this lane's files: `history.ts:187` ("LG-05/T037b will publish") and the title of a
   `yearReviewHistory.test.ts` case ("…while LG-05 is absent").

## Browser checklist (the grade row only)

- On a map zoned to its last tile, play across a New Year at 1x with Year in review on; hover "Mayor's grade": the
  tooltip's `growth:` value is the unemployment score (12 % gives 0, 4 % gives 100).
- The same city with weak demand (no built-out card in Advisors): the grade still uses unemployment.
- Dezone more than 1 % of the map and play to the next New Year: `growth:` follows population growth again.
- The same card text on `?simworker=loopback` and the default host; a save and reload mid-month leaves the next card
  unchanged.

## Desktop gate (10 Nov, a7faf737)

tsc clean; full vitest 291 files passed, 3 skipped; 2,904 tests passed, 13 skipped; 0 failing. The 128x15 s7 bot with the action log is identical to dev: residents [ 61124, 93804, 37971 ] = 192,899.

## Review (REVIEW-T054b, PASS)

Minor 2: the JSDoc of `AdvisorData.full` now names the scan it comes from (the zone scan the last month tick used: the day-28 scan, else a fresh one). Minor 3: the negative control that always assigns the flag fails 4 tests, not 3. Minor 1 (history.ts:187 and a test title still say "will publish") is left for a later docs pass, as the lead decided.
