# NOTE-015 (lead → worker): B1's live cap, the constant's name, and simwasm in W0.1; please ACK

Thank you for the B1 numbers. The single-year tourism misses are accepted as bot noise: six 128x15 seeds give a
year-15 geometric mean of 0.996. Your report should say that next to the table.

**(a) The live cap: fix it in B1, as the design writes it.** `due()` applies the cap to every pass start in live mode,
periodic passes included. At ultra a periodic pass is due every 0.75 s, so a 1 s cap holds them to 75 %.
WORKER_DESIGN §6, B1 in detail, says: "a dirty pass (not a periodic one) starts at most once per
SERVICES_MIN_CYCLE_MS", and that an immediate trigger skips the wait and the live cap. So:
- the cap applies only when `!this.dirtyUrgent && d < SERVICES_PERIOD`, so periodic and urgent passes are never
  capped;
- use the design's 2000 ms for the dirty-pass cap;
- show in the frames emulation at ultra, on dense1m and bot256, that passes per simulated day are ≥ 90 % of the
  design cadence (S5's AC4), before and after.
Headless runs never take the cap, so the balance tables stay valid. Say so in the report; no re-run is needed.

**(b) Rename the constant to `SERVICES_MIN_CYCLE_MS`**, as the design names it, so S5 and the docs line up.

**(c) simwasm in W0.1: approved as you propose, with these conditions.**
1. SimCore takes `flags.simwasm`. Boot sets the blur preference from it, and to `'js'` when it is absent.
2. With no flag, nothing wasm is fetched or instantiated in the browser, and node runs JS. The bot stays
   bit-identical (194,432 on W0.1's base).
3. The browser awaits `initSimWasmBrowser({flag})` in `LocalSimHost.start` only when the flag selects wasm.
4. The three imports (crime.ts, parking.ts, pollution.ts) switch to `src/wasm/kernels/blur`. Check that the drop-in's
   JS path is `src/sim/infra/blur.ts`'s `blur3`, so J8's faster blur still applies once both are merged. This is
   WASM_PLAN's PI-6 (the opt-in import swap); name it so in the W0.1 report.
5. Merge the dev head into `local/W0.1-simhost` (it holds only docs and the S1 suites since `d8256fc`), and drop the
   explicit `blur3` calls in `tests/perf/protectorChild.ts` in favour of the flag. Both S1 modes must still pass,
   with the negative controls.

W0.1's owns grow by those three one-line hunks and `tests/perf/protectorChild.ts`.
