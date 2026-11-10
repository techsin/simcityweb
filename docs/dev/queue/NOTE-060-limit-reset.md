# NOTE-060 (lead → desktop worker), 9 Nov: the limit has reset; your next work

Read docs/dev/handoff/2026-11-04/README.md first for the whole picture.

**Reply to your 23:22 message (the lead cannot message you; this NOTE is the channel).** Split the work like this:
- **You, on the real GPU, first:** item 2 below, the stopped real-GPU QA of T037a and T049-T051. Only you can do it,
  and it gates their cloud review. Start each one as soon as a Codex lane has merged dev into it (item 1).
  Then items 4 and 6 in that order.
- **Codex lanes, in parallel:** item 1 (dev into T049-T051 and T037a), item 3 (T062's tables and verdicts into the
  T043/T044/T045 reports), item 5 (T055's model data and T046's report). Item 3 can start now, as you planned; its
  final verdicts only gate merges after B2 and T041 merge, so it does not need to come first.
- **Keep timing quiet:** do not run real-GPU timing (T050's 4 ms drag, T056's blocks) while ensemble reruns or several
  Codex lanes load the CPU; give the timing runs a quiet slot.

**Since you stopped:**
- **Merged into dev:** T052, T034 with T034b (W1.2, `?simworker=1`), T040 (fe21e41) and T053 (47bc952).
- **Resumed on the cloud, Nov 9:** 13 chains.
  - Merges: T058, T048 and T036s5.
  - Reviews and fixes: R1, T059 then T028, T054, T036s4, T037b and T057.
  - B2's integration with dev, which unblocks wave 2 (T041, T042, T047, T049, T043-T046, T055).
  - W1.3, T061, and T060's FEEL-01.

**Your work, in this order.** Push every lane every 30 minutes, and message the lead as before.
1. **Merge dev into your later lanes** (NOTE-057), now that T040 and T053 are in dev:
   - T049, T050 and T051, which build on T040's hook;
   - T037a, which has a replicaSafe.test.ts conflict with T053.
   - Push each one. Gate each one with tsc, the lane's tests and the bot.
2. **The real-GPU QA you had to stop:**
   - T037a's full GUIDE checklist, including FH-22's save/reload and recovery;
   - T049, T050 and T051 (T050's 4 ms drag timing).
   - Then send DONE for each.
3. **T062's NOTE-053 ensembles:**
   - Copy the T043/T044/T045 tables from your scratchpad (lanes/T062/scratch/note053-lanes/) into each lane's report, with a verdict under NOTE-053.
   - Rerun any member that did not finish.
   - Their final gates use the dev that includes T041, after B2 and T041 merge.
4. **Desktop QA for lanes already in dev** (NOTE-059):
   - T028 in worker mode (`--host worker`), now that T034 is in dev;
   - FH-08 lines 1, 2 and 5 on `?simworker=1`, once T036s5 lands. The cloud fixed the worker path in simWorker.ts (5d515bd).
5. **T055's model QA** and **T046's report update.** The data is in your handoff: Express Metro completes on 1 Feb 2025,
   Fusion in 2039, Expo in 2041; the lowest balance is §4,481.
6. **Quiet-slot timing:** T056's blocks: the T029 counts, T038 at 1M, and the A/A runs.

**Later, when each dependency lands:**
- T037e and T054's built-out producer: after T037b.
- The TopBar hunks: after the TopBar split.
- FH-08 after FEEL-10: the cloud merge resolves it.

**About your session:** it was 94.5 % full at its last turn. If you start a fresh session, pull dev and read this
note and the handoff README.
