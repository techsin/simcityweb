# T056-real-gpu-runs: the real-GPU and quiet-slot runs of NOTE-045 item 1
base: dev (each run names the trees it measures); branch local/T056-gpu-runs (reports only)
after: none. In quiet slots, one at a time. Codex lanes may write code and run tsc or single test files at below-normal
  priority meanwhile (NOTE-002 rule 3). No suites, bots, benches or browsers run next to a timing run, and every block
  carries its A/A copy.
owns: docs/dev/reports/local-T056/** (small tables and a few images) and docs/dev/reports/local-T056-gpu-runs.md.
do, in this order:
  1. T029's browser count at real frame rates on dev (docs/dev/reports/local-T029/harness/emgcount.mjs, --dsf 1
     --zoom 0), against the cloud's virtual-clock numbers.
  2. W0.1's ultra A/A: frames mode at ultra, the W0.1 tree against its base, 6 rounds per fixture in ABBA order
     (dense1m, bot256_y60).
  3. The W1.1a node bench: protocol cost per sim day at ultra on dense1m and bot256-1.4M, A/A-normalised, no-op
     listeners.
  4. R1's timing and screenshots: these are T021's own gates, reported in T021's report.
  5. B1's repeat A/B with the frames cadence: services passes per 180 days in frames mode at ultra, plus the
     whole-day A/B in both orders.
  6. T008's load-path trace.
  7. T038's 1M timing on the GPU, once T038 is in dev.
gates: every report names the GPU, driver, browser, OS and the trees measured, with medians and 90 % bootstrap CIs
  and the A/A copies.
report: docs/dev/reports/local-T056-gpu-runs.md, one section per run, updated as each finishes. Push
  local/T056-gpu-runs after each run.
