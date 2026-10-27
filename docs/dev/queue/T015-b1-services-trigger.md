# T015-b1-services-trigger: the services dirty trigger (docs/WASM_PLAN.md B1 / PI-5a), the largest throughput gain
base: claude/beautiful-johnson-u2jqoz HEAD when you start (record the sha); branch local/B1-services-trigger
after: start once J10 and J11 are pushed (the whole-day A/Bs need the machine); side by side with T008-T012 otherwise
owns: src/sim/infra/services.ts; src/sim/actions.ts (the funding and ordinance actions mark services dirty and urgent:
  one small hunk each); src/sim/economy/ordinances.ts only if the ordinance path needs the same hook; new tests
  (tests/sim/servicesTrigger.test.ts); the baseline rows the balance procedure records
  (tests/sim/fixtures/balance-baseline.json, a new key, the old rows untouched). Not utilities.ts or population.ts
  (J10 and J11 own them): detect Watered and staffing changes from inside services.ts.
do:
  Read first:
  - docs/WASM_PLAN.md row B1 (around line 405);
  - the review findings around lines 700-760: finding 1 (B1 measured at 1.27-1.56x on the whole design-cadence day,
    M3/M4), finding 2 (the missed triggers) and finding 4 (the A/B method);
  - the revised order around line 898 (PI-5a: "B1 first, with the full trigger list");
  - the balance procedure in docs/SIM_DEPTH_SPEC.md (around line 862);
  - services.ts SCHEDULING (around line 50; SERVICES_PERIOD 15, SERVICES_DIRTY_DAYS 2).
  The change:
  - today any buildingChanged on a coverage-relevant building, including traffic's Congested flag flips, forces a
    pass within 2 days. Mark services dirty only when coverage-relevant state changes (def, power, functional,
    staffing);
  - mark dirty and urgent on the triggers the review lists: funding and ordinance actions, Watered flips of health
    facilities, staffing changes beyond a threshold, and the monthly justice update (justiceFactors().policeMul);
  - add a live-mode real-time cap like traffic's.
  Codex implements from this text and the files; you review (no missed trigger, deterministic, readable) and run the
  gates.
gates:
  - **balance procedure** on 256x60 seeds 7 and 11 and 128x15, against the recorded baseline: pop >= 150k at year 15
    and >= 950k at year 60 and >= 0.9x baseline; approval >= 50 from year 30; funds >= 0; EQ >= 100 by year 30; tourism
    jobs within ±30 %; totalMsPerDay <= baseline + 3 (it should fall). Report the yearly tables side by side. The bot
    output changes by design: record the new reference (the 128x15 s7 2015 population replaces 194,432) and say so.
  - **funding-latency test:** a funding or ordinance change shows in coverage within N days (choose N and justify it).
    Also Watered and staffing flips.
  - **determinism:** D1 for 120 days on dense1m and bot256 y60 (two runs identical within the new version).
  - **speed:** whole day >= 1.2x at design cadence on dense1m and bot256 live, replicated per finding 4: >= 2 fresh
    isolates per arm, an A/A pair in every run, bootstrap over isolates and chunks, means as well as medians, process
    and thread CPU. Also the ultra emulation (frames mode): passes per simulated day before and after.
  - old saves load and continue; npx tsc --noEmit clean; npx vitest run passes (CRLF exception until T012 lands).
report: docs/dev/reports/local-B1-services-trigger.md (the trigger list as built, the balance tables, latency test, A/B
  tables, what Codex vs you wrote); push local/B1-services-trigger with docs/dev/queue/T015-b1-services-trigger.done;
  DONE. The lead merges it after the sim close-out, and before the emergency-policy change (which also touches
  services coverage).
