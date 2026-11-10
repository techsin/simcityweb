# T063: infrastructure save/load continuity (T057's follow-up, after B2)

Cloud lane (chain infra1). Base: dev at or after a7b7215, which includes B2 (2dd0fe5) and T057 (b9ade7a). The bot
reference is residents [ 61828, 95515, 40772 ] = 198,115 (128x15 seed 7).

## Why

T057 made the economy systems continue bit for bit across a save and load. The infrastructure systems still do not:
utilities, traffic, pollution, services, crime and emergency. After a load, 37-53 all-systems digest keys differ on
dense1m and bot256, and every one of them is an infrastructure key. T057 left them until B2 had rewritten
src/sim/infra/*. B2 is now in dev.

## Do

1. Read docs/dev/reports/cloud-T057-save-load.md. Its table lists, per infrastructure system, the runtime state a load
   loses, and the save-hook mechanism (src/sim/persist.ts; CONTINUITY_RECORDS; recovery snapshots leave the records
   out when lean or over budget). Read docs/dev/reports/local-B2-step-split.md for B2's pieces, carry and credit
   state.
2. For each infrastructure system, save the minimal runtime state it needs to continue bit for bit through T057's
   hook mechanism, and restore it at load. Include B2's in-progress piece state, or prove that a save always lands
   between cycles. Cover these known points:
   - `stats.transitFleet` (traffic.ts) changes at a load in 12 of 16 runs (desktop QA of T057);
   - a save at traffic's last piece (after final2's publish, before the cycle's end) carries buildingChanged ids in
     T057's `lvRun` 'changed' list. It differs from an uninterrupted run only in that record, and converges within
     20 days (B2's review);
   - the scheduler's credit and carry, and an infrastructure pass in progress at a save (T057 decision 6).
3. Fix T057's three minors:
   - the continuity records carry no day stamp, so a save re-written by a build without the hooks loads stale records
     as current. Stamp them with the save's day and ignore stale ones;
   - Simulation.replaceState emits 'reset' after the inits, which wipes restored state (a test-only path). Fix the
     order or document it with a test;
   - two restore paths have no test. Add them.
4. Keep it cheap: report the save size and the save-hook time on dense1m before and after. T057 cost +13-15 % raw and
   3-6 ms per save. Leave out anything that can be rebuilt exactly and cheaply at load, and say why for each one.

## Gates

- tsc clean; the full vitest under the lock; the bot unchanged at 198,115 (the hooks run only at a save).
- tests/save/loadContinuity.test.ts extended: on dense1m and bot256 at design cadence, the **all-systems** digest
  right after a load, and at day +30, equals an uninterrupted run, at several save points including traffic's last
  piece.
- Exactness and determinism suites green. Old saves load (the save fixtures), and the replica and worker paths stay
  correct (hygiene, replicaSafe).
- No browser checks here (NOTE-061). End the report with a short Desktop QA list: save/reload/Continue on a 1M city on
  the real GPU, on the default host and `?simworker=1`, with the economy and infrastructure digests compared.

## Report

docs/dev/reports/cloud-T063-infra-continuity.md: the per-system table (what is saved, what is rebuilt and why), the
save-size and timing numbers, the gates, and the decisions.
