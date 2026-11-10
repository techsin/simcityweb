# NOTE-095 (lead → desktop worker), 10 Nov: the cloud winds down too; decisions for T093, T091 and T088

## The cloud winds down too (owner, 07:05: the global limit covers both machines)

- The cloud's lanes in flight finish: T063, T065, FH-16 (merging), FEEL-03 and FEEL-19. Then the guide chains stop.
  After that the cloud runs at most 1-2 tasks at a time. The remaining guide lanes (FH-14, FH-18, FH-13, FH-23, FH-17,
  NEW-07, FH-15, NEW-06) run one after another later.
- **Cloud reviews of your DONE lanes become a single pass.** One reviewer per lane, the same REVIEW-<lane>.md, and
  still one at a time. Send DONE messages as before.
- **CLOUD MERGE is still open, one at a time.**
- **The ensemble members cost the cloud no agents** (they are plain node runs), so the check member after T041 and
  the 36 long members go ahead as agreed in NOTE-089.

## T093 (reward load fix)

1. **Rewards added after a city was saved may be announced at its first month tick, several at once. Accepted.**
   Do not add a new systemData key. No player save from before T070/T071 exists, because the game is not released;
   only dev saves see the batch, once. The toast budget keeps it readable.
2. **The Seaport's hasWater cache after terraforming: fix it, but not in T093.** The cloud adds it after T093 is in
   dev: drop the cache on terrainChanged, plus a test (terraform water into reach, and the running game unlocks it).
   rewards.ts is a cloud chain's file. Leave T093 as it is.

## T091 (LG-12 sister cities): the nine choices

1. **Deferred booking through the ledger: accepted.** The region card already shows the parent's lower funds at once.
2. **`EDGE_NONE` stays 0.1 for sisters: accepted.** No balance change in this lane.
3. **Founding without an endowment earns the +1, which does not stack and restarts its 12 months on each founding:
   accepted.**
4. **A sandbox parent cannot endow: accepted.**
5. **Deleting the new city refunds nothing: accepted**, since the question already says the transfer can't be undone.
6. **`ENDOWMENT_MIN` = §1,000: accepted.**
7. **Start year: change it.** The new city starts in the parent's current year, not 2000. A sister city founded in
   2043 should not live in 2000, and the "endowed a sister city in <month year>" line should match its calendar. Add a
   test.
8. **Only from inside the city: accepted.**
9. **Continued roads (every edge road reached from inside; a border road once at its middle; no rail): accepted.**

**The cloud-held hunks** (advisors.ts `builtOutAdvice` with its advisors.test.ts sentence, and adviceActions.ts
`ACTIONS.sister`): the cloud lands both, exactly as the report gives them, right after T091 is in dev, as one small
commit with tsc, the two test files and the bot. Put "QA item 11 waits on the cloud's hunks" in the DONE.

## T088 (soak tool) and W1.4

The release soaks measure what players run. W1.4 makes the worker the default, so the final soaks are:
- **the 4-hour soaks on the main-thread host, forced by its flag, with the full harness** (sim and render growth,
  timings), as planned;
- **one 1-hour soak on the default worker host,** measuring what the page can read: frame times, the day rate,
  main-thread heap and DOM counts. Give the harness a worker mode that measures only those and prints which metrics it
  leaves out, instead of refusing. If that costs more than a short round, say so: the cloud can write it (tools and
  selftest only) after T088 is in dev.

## Noted

- T091: gate green (3,190 tests, bot 198,115). Its QA is queued.
- T049: merged with post-B2 dev at 48110ed5; both conflicts kept both sides. Gate queued.
- T095 and T074: gates green.
- T037a: the harness fix at 783ac05f. Its re-gate is queued.
- QA re-queued: the T074 recheck and t064-fh08live (NOTE-094 has its two corrections).
