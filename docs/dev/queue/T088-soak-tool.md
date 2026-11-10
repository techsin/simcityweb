# T088-soak-tool: the soak tool runs on current dev again, and its days/s gate measures running seconds (NOTE-081)
base: dev (current head); branch local/T088-soak-tool
owns: tools/soak/** (driver.mjs, selftest.mjs, telemetry.mjs, report.mjs, run.mjs, its README); nothing under src/.
why: the early release check (T082; its findings and data are in the scratchpad folder qa\T082\: read
  soak_unpatched\summary.md, soak_dense1m\summary.md and tables.md, soakpatch\loader.mjs) found:
  1. tools/soak/driver.mjs:364 reads `window.__metropolis.city.state`, which W0.6 (8dafb4c) removed, so the soak stops
     68 s into its first cycle with "TypeError: Cannot read properties of undefined (reading 'day')". The selftest
     passes 10 of 10 because its mock page (selftest.mjs:171) never runs Driver.save().
  2. the 15 days/s floor (report.mjs:50-52) divides sim days by city seconds with the cycle's pauses and loads included
     (telemetry.mjs:118-119, :134): 15.02 on a quiet machine, 10-13.6 under load, while the sim ran at 19.7-20.0.
do:
  - Fix the driver line: `const c = window.__metropolis.city, st = c.scene.sim.state; return { lastSave: c.lastSave,
    day: st.day, buildings: st.buildings.size, tileKey: c.tile.key };` (the exact change T082 ran both 1-hour soaks
    with). Then check every other page read in the driver against current dev's App and scene (main.ts, CityScene)
    and fix any other stale field. On `?simworker=1` the page has no sim: say what the soak supports (default host
    only, or both) and make it fail with a clear message, or work, on the worker host.
  - Add a selftest case that runs Driver.save() against a mock page shaped like the real App record, so the next
    removed field is caught; make the mock derive its shape from one place.
  - The days/s gate: keep the floor at 15 days/s (NOTE-026), but measure it per RUNNING second: sim days divided by
    the seconds the sim was running, excluding the cycle's pauses and loads (`runningSeconds` is already collected).
    Report both numbers (per running second, gated; per city second, informative). This fixes the denominator; it
    does not loosen the bar. Update the README and the summary's wording.
  - A cycle longer than 300 s aborts the run (run.mjs:243) and the tool runs itself at below-normal priority: add a
    clear message naming that cause when it aborts, and a README line that the final 4-hour soaks need the machine to
    themselves. Do not change the limit.
  - The README's default fixture path does not exist in a fresh worktree: make the fixture argument's error say how
    to produce or point at one.
gates:
  - `node tools/soak/selftest.mjs` passes (run it; no browser is needed for the selftest); tsc is unaffected.
  - I run a real 1-hour soak on the real GPU with the machine quiet.
report: docs/dev/reports/local-T088-soak-tool.md.
