# T057-save-load-continuity: a saved and reloaded city continues exactly like the uninterrupted game (cloud lane)
base: dev
owns: src/save/** (serialize, bundle, recovery), each system's init()/restore path that the evidence points at, and their tests
do:
  - **The finding** (B3's second gates, NOTE-044):
    - On the full game (createSystems at design cadence), save after day k, load into a new Simulation, continue to day 120. The whole-city sha256 must equal the uninterrupted game's. It fails on 0 of 16 saves on dense1m and 0 of 16 on bot256, before B3 too.
    - Right after a load, 47-74 keys already differ: infra and coverage layers, building flags, approval survey terms, emergency, infraTransport, stats, news, and population after its post-load refill.
    - Evidence and tools: the B3 work dirs under the scratchpad (b3work/gates1/sl2/*.json and .txt, b3work/tools).
  - **What to do:**
    - Classify every differing key: saved but restored wrong; not saved but derived, and rebuilt differently; or nondeterministic rebuild order (e.g. rt.plopped iteration order, which B3's code check named).
    - Fix the cause at its root: save what must be saved, or make the rebuild exact and order-stable.
    - Add a regression test: a small city saved on several days of the month continues bit-exact for 30 days.
  - **Why now:** W1.3's journal replay re-applies commands on a loaded snapshot, so load must continue exactly.
gates:
  - the full-game save/load digest, equal on all saves for both fixtures, or each remaining key named with a reason;
  - tsc and the full vitest;
  - the bot identical to dev (residents [ 61124, 93804, 37971 ]);
  - old saves still load (the recovery codec suites).
note: if a fix needs src/sim/infra/*, which B2 is rewriting, put it in its own commit and mark the lane "holds for B2".
  Do not merge until B2 is in dev.
report: docs/dev/reports/cloud-T057-save-load.md; done marker docs/dev/queue/T057-save-load-continuity.done
