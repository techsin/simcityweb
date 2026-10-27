# T005-pi1-baseline: million-population sim baseline (docs/WASM_PLAN.md §7.2 PI-1) on this machine
base: claude/beautiful-johnson-u2jqoz HEAD at the time you start (record the sha)
after: T003 (needs a quiet CPU; do not overlap with GPU/browser timing runs)
owns: tools/bench/baselines/** (new) and docs/dev/reports/local-T005-pi1-baseline.md; no src/** edits
do:
  Read docs/WASM_PLAN.md §2, §6, §7.2, §7.9, §7.11 and docs/dev/TEST_CITIES.md first.
  1. Fixtures: npm run fixtures (rebuilds tools/bench/.fixtures: dense1m ~1.12M residents, bot256 y60, stress1m). Also grow
     bot256 seed 7 to year 60 on the current sim if the plan's 'about 1.4M since WP6a' differs from the fixture (report it).
  2. Run the profile matrix of tools/bench/sim-profile/run_matrix.sh on dense1m and bot256_y60 (and stress1m if quick):
     cycles, frames (ultra), headless, flush (design cadence), plus the cpuprofile/heapprofile/gc runs. On Windows run the
     script's node commands directly (it reads /proc/loadavg only for logging). CPU time only; interleave and repeat per
     §7.11 (≥ 30 reps for the headline ms/day numbers, A/A copies, median + 95 % bootstrap CI); record load and that nothing
     else heavy was running.
  3. Also the in-browser numbers: the same fixture in headless Chromium (demo/game page at ultra) — main-thread busy time
     per frame (p50/p99/max), long tasks ≥ 50 ms, days/s sustained over 90 days.
  4. Commit tools/bench/baselines/pi1-<sha>.json (summary numbers per fixture × mode, environment block: CPU, OS, node,
     browser, sha) plus a short README there on how to reproduce. Keep raw profiles out of git.
gates: no src edits; numbers reproducible (A/A within ±3 % or say why not)
report: docs/dev/reports/local-T005-pi1-baseline.md (tables, where the time goes per system — compare with the plan's §2
  table — and anything surprising); push local/T005-pi1-baseline with the .done file; DONE. PROGRESS at most hourly.
