# NOTE-061 (lead → desktop worker), 9 Nov: the desktop takes all browser testing, and runs Codex lanes on everything that is free

The owner wants the project finished faster, with the desktop used to the full: **every browser and real-GPU check
moves to you**, and **Codex lanes take every polish item that is free now**, in parallel. Run as many lanes at once as
your CPU allows, and keep a quiet slot for timing runs (no Codex gates or ensemble reruns during them).

## 1. Browser testing: you own all of it from now on

The cloud stops running browser checks on SwiftShader (they queue behind its one heavy-job lock for hours). Its chains
write a **Desktop QA list** into each lane's report instead, and you run it on the real GPU.
- **Now, as their gates turn green:** T037a (full GUIDE checklist, FH-22 save/reload and recovery), T049, T050 (the
  4 ms drag timing in a quiet slot) and T051. Send DONE for each.
- **NOTE-059's Desktop QA lists:** T028 in worker mode (`--host worker`); FH-08 lines 1, 2 and 5 on `?simworker=1`
  once T036s5 is in dev.
- **The cloud lanes' browser checklists, on their `cloud/*` branches**, as each reaches QA. The checklist is in the
  lane's task file (`docs/dev/queue/`) and its report on the branch (`docs/dev/reports/`):
  - `cloud/t037b`: T037 (b), FH-03 and LG-05, including "Connect a highway". Re-measure the newcomer check (residents by
    year 4, Easy approval) and LG-05 on y55, and report the numbers with options; do not retune balance.
  - The TopBar split (T037, next on the cloud guide chain): the HUD must be pixel-identical at rest and while the
    camera moves.
  - `cloud/w13` (W1.3, saving in the worker), `cloud/t061` (T061, worker host fixes), `cloud/t057` (T057, save/load
    continuity) and `cloud/t060feel01` (T060's FEEL-01 ticker; FH-12 follows).
  - B2 (the step split) once it is in dev: its Desktop QA list is in its report.
- **How to report:** push the QA result into the lane's report on a `local/qa-<lane>` branch (or on your own lane
  branch), and message the lead: "QA <lane>: PASS" or "QA <lane>: FAIL" plus the findings. The cloud merges once you
  pass, or fixes and asks again.

## 2. Codex lanes: start now, in parallel

None of these items is started or in flight. Each item's full spec is its section in `docs/POLISH_PLAN.md`. Its
file:line references are against e116226, so find each hunk by the identifier it names. For each lane:
- branch from dev;
- before you start, check that no in-flight branch touches the same files (`git diff --name-only <dev>...origin/<branch>`
  for the open `local/*` and `cloud/*` lanes);
- run one Codex lane per file area, with the items inside one area in order;
- gate it yourself: tsc, the full tests, the bot (expect 192,899 on 128x15 seed 7 unless the item changes the sim
  by design), and your own real-GPU browser QA;
- send DONE when it passes.

Name new lanes **T070-T099**: they are yours to number. The lead keeps T063-T069.

- **WORLD (best on your real GPU):**
  - round 2: FEEL-09, FEEL-10 (FH-08 rebases onto it);
  - round 3: FEEL-18;
  - round 4: FEEL-16, FEEL-28, FEEL-07, FEEL-27, FEEL-24, FEEL-25, FEEL-23, FEEL-29, FEEL-13, FH-25.
  - Keep clear of the files of T049-T051 and T036s4/s5 until they merge.
- **CONTENT:**
  - round 2: LG-21;
  - round 3: LG-20, LG-02, NEW-01;
  - round 4: FH-26, FEEL-20, FEEL-22.
  - Keep clear of the files of T046 and T055.
- **After B2 merges (the cloud tells you): SIM.**
  - round 2: LG-09;
  - round 3: LG-15, LG-16, LG-18, LG-19, LG-04;
  - round 4: LG-17, LG-22, LG-23, LG-25, LG-26, LG-11.
  - Each SIM lane's balance gate follows NOTE-053's ensembles on the dev that holds T041.
- **After T060 (FEEL-01, FH-12) merges: META.** Round 3: LG-12, LG-14; round 4: LG-13, LG-24.
- **After T037b and the TopBar split merge: round 2's GUIDE items, moving from the cloud to you.**
  FH-18, FH-17, FH-14, FEEL-19, FH-15, FH-16, FH-13, FEEL-03, NEW-06, NEW-07. Also T037e and T054's producer.

## 3. Still yours, as before

T055's model QA and T046's report update (2c), T056's timing blocks in a quiet slot, and merging dev into your later
lanes as wave 1 lands. The verdicts on your T043/T044/T045 ensemble tables follow in the next NOTE.
