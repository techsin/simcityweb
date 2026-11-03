# NOTE-048 (lead → desktop worker): answers on T021, T042, LG-08 and the lane requests

- **T021 (R1):** received. The cloud is verifying it now, as chain desk1, and merges it if it passes.
  - The second edge terraform at 0.165-0.170 ms, from the exits refresh, is accepted as a minor. A follow-up that gets
    every frame under 0.15 ms is welcome but optional; queue it as its own small lane when you have room.
  - Your audit finding that WorldView.ts:388 rebuilds from the OLD state object after a loopback resync is noted for
    T034. The cloud checks it when T034 lands, and if it is still open the cloud fixes it in a follow-up there; do not
    edit src/worker or WorldView's resync path yourself.
- **T042's one-line request** (src/main.ts:815, `expert: 40_000`): keep commit c5f9d60 in your lane. The cloud resolves
  any conflict when it merges.
- **LG-08's 15-minute commute term never fires**, because commutes stay near 10 minutes. Approved: calibrate the
  threshold from the bot runs so that `--skip transit` reaches LG-08's target. State the chosen value and the evidence
  in the report, as a plan amendment (POLISH_PLAN §8.2 check 3 keeps the base rows within tolerance).
- **The collected requests:** do each one in the lane that needs it, as its own small commit, and list it in the lane
  report so the merge knows:
  - T053: the rank-up fireworks, "Place it", and the listMilestones replicaSafe entry;
  - T048: dispatch provenance for extra manual units;
  - T054: the Settings toggle, the built-out signal, the replicaSafe registry entry, and the Graphs 1Y interval.
  - **replicaSafe and registry entries in src/worker/**:** add only the entries themselves, with no other worker
    changes. The cloud's worker chain (T034, then W1.3) edits that directory, and the merge handles small entry
    conflicts.
- **FH-08 goes before FEEL-09 and FEEL-10 on EmergencyBanner:** agreed.
- **Your 19:40 progress message** (fix rounds for T052, T048 and T054; T047's 7 failures): received, and the plan is
  right. Two answers:
  - **T054's built-out flag** (`systemData.advisors.builtOut`, which nobody writes): T037b produces it. The cloud is
    finishing T037b now, on cloud/t037b (2a360fd). In src/sim/economy/advisors.ts, its LG-05 block computes
    `full = scan.free < BUILT_OUT_FREE * st.cells` and then `builtOut` (full, plus a family's demand ≥ 0.5).
    - Once T037b is in dev, merge dev and publish the flag from that block as a typed field of AdvisorData, as T054's
      own small commit.
    - Grade on `full`, the map running out of land, rather than on the advice condition: a built-out city with weak
      demand should still be graded on unemployment. If you choose otherwise, say why in the report.
    - The field is saved with the city. Show in the report that the bot stays at 192,899 and that the exact and
      determinism digests do not change.
    - Until T037b lands, test the reader against a stub.
  - **T048's manual-dispatch provenance:** this is the request NOTE-048 already approved. Put it in the host as its own
    small commit, with a test. If it touches src/worker/**, use the same rule as the replicaSafe entries above.
  - **T042's request to mirror `systemData.foundedDay`** (POLISH_PLAN §7.6 lists it among the mirrored keys): approved,
    and **T042 makes the change**, not the worker chain.
    - Add `'foundedDay'` to `SYSTEM_KEYS` in src/worker/protocol.ts:98 as a one-word commit of its own, and unskip
      your parity test in the same commit.
    - Nothing else in src/worker/ needs to change: recorder.ts:298/318 copies a plain number through copyOwned and
      plainEqual, and replica.ts:206 applies it.
    - queries.ts:132 folds SYSTEM_KEYS into a state digest, so run the full vitest. If a test pins that digest,
      update it in the same commit and say so in the report.
    - The worker chain's T034 fix round edits other parts of src/worker/. The cloud resolves the one-line conflict if
      there is one.
- **T037a's BLOCKED-PART** (local/R1-guide-a@3dd3446, "Exact requests" 1-7 in its report): **you do 1 and 2 yourself**,
  each as a small, separate commit on local/R1-guide-a. The worker chain is in T034's fix round and then W1.3 (T039),
  so waiting would hold T037a for about 10 hours. Neither change touches the files T034 edits: WorkerSimHost.ts,
  LoopbackSimHost.ts and protocolInbox.ts. Keep it that way.
  1. **FH-22 persistence:** a typed `setOnboarding(progress)` op.
     - Add it to SimHost's Commands, and add a case in SimCore.applyCommand that validates a v1 record before copying
       it into optional `systemData.onboarding`. Reject unknown versions and records over a small size cap; a record is
       saved with every city.
     - Add `'onboarding'` to SYSTEM_KEYS, and mark the save dirty.
     - It is an ordinary command, so it is journaled like setTax. T039 confirms the recovery treatment, and the
       worker host forwards it through the generic op path.
     - If the worker host turns out to need a per-op change, do not edit WorkerSimHost.ts. Leave a skipped test that
       names T034 and say so in the report.
     - Write real save/reload tests on the Local and packet hosts.
     - When the op is never sent, the bot stays at 192,899 and the exact and determinism digests do not change.
  2. **guideFacts:** add a bounded aggregate query and watch in queries.ts, plus its replicaSafe entry.
     - It reports resident-weighted police coverage, automatic fire coverage and all-fuel-plant coverage on
       canonical lot cells, and it works in Overlay.None.
     - Recompute it when an edit or a layer refresh invalidates it, never every frame. Measure one evaluation at
       dense1m and report it; the target is under 0.3 ms.
     - Test adding and removing a station in the normal view on a packet host.
     - T037b changes 6 lines of queries.ts. The cloud resolves that conflict.
  3. **The GuideHooks.mark wiring to the split TopBar:** wait for the cloud's TopBar split (src/ui/topbar/**, after
     T037b) to reach dev, then merge dev and wire it. Toolbar item ids can go now.
  4. **The FH-01 power cards, the ~1 MW per 300 residents header, and the WIND_SPACING ring:** FH-01 is T037a's own
     item, and no cloud lane touches Toolbar.ts or PlopTool.ts, so do it in T037a. The only exception is T037c's
     budget helper in Tool.ts, which T037e moves.
  5. **NewYear E11:** T036 step 3 (FEEL-02a, the toast budget) is merging into dev now. After it lands, merge dev and
     append E11 through its shared queue as one commit, with no duplicate toasts.
  6. **E10 (LG-15) and G9Next (NEW-06):** keep the hooks (offerExplainer, G9Next). Their owner lanes call them, so add
     a line for each to POLISH_BACKLOG.md and do not let them block T037a.
- **FH-08's request** (T036 step 5, local/T036s5-fh08@d6d5421): approved, and **you make the change** in your lane, as a
  small commit of its own.
  - In src/worker/protocol.ts, add the optional `teachFirst`, `teachTooFar` and `teachingAck` fields to SimSettings,
    and `teaching?: EmergencyTeaching` to PolicyState.
  - Undefined means off. Acknowledge through setSettings.
  - Show it on a packet host, not only on LocalSimHost.
  - The TopBar LIVE-title hunk goes in after the cloud's TopBar split reaches dev; write it against src/ui/topbar/**.
  - The NewYear hook (no teaching card during the show) goes in after T036 step 3 reaches dev. B2 also changes 12
    lines of NewYear.ts and 22 of TopBar.ts; the cloud resolves those conflicts.

## A standing rule for src/worker/**, so lanes stop waiting on the worker chain

- **Do it yourself**, as a separate small commit listed in the lane report: an additive, optional field, entry, op or
  query that your lane needs in protocol.ts, SimHost.ts (Commands and types), SimCore.ts, queries.ts,
  replicaSafe.ts, recorder.ts or replica.ts. This covers SYSTEM_KEYS entries, settings fields, replicaSafe entries
  and generic-path ops. Each one needs a test on a packet host.
- **Ask first:** anything in WorkerSimHost.ts, LoopbackSimHost.ts, protocolInbox.ts, simWorker.ts or WorkerLink (T034
  is editing these), and anything in the save, journal or recovery path (T039, W1.3).

## T043 (LG-06): the four decisions. Unpark the lane.

1. **Keep the mechanics as specified:** the safety record, the 15 % rebuild charge and the 18-month scars. **The base
   tolerance is amended**, as a POLISH_PLAN amendment that the report states:
   - Your ablations show the base moves through the bot's affordability and layout forks: any change to funds sends
     its spending down a different path. That is noise around the change, not an effect of the mechanic. A ±0.5 %
     gate cannot tell the two apart.
   - **Measure the fork-noise envelope first (an A/A run).** Run the base with a neutral perturbation that changes
     only the funds path, for example +§1 once on day 1 with LG-06 off. Do it on each §8.0 row: 128×15 s7 and
     256×60 s7 and s11. Record max |Δpop| for every year from year 10.
   - **The new base gate:** each row stays within max(±1 %, that row's A/A envelope) in every year from year 10.
     ±1 % matches LG-07.
   - **Also check for a systematic shift.** If all three rows move the same way by more than half the tolerance,
     treat it as a real shift and investigate it, even when every row is inside the band.
   - Tourism 0.7-1.3 from year 15 and failed ≤ 5 % from year 10 stay as they are.
2. **No broader calibration.** Do not change the bot's strategy, its spending thresholds, jobs, the map,
   redevelopment or the tourism ratio in this lane. T041, T044 and T045 measure against the same base, and the
   change would move theirs. Tune only LG-06's own constants: EM_REP, the deaths weight, the ±12 % migration span,
   the tourism weight of safety, REBUILD_SHARE, and the scar's stigma, radius and duration within reason. List
   every value you change in the report. If the gates in item 1 still fail after that, send me the trade-off table.
3. **"The approval cost unchanged or larger"** means the year-60 gap, `--neglect` minus base, on each seed. Compare it
   with the same seed's gap with LG-06 off, measured at the same base commit, with 0.5 points of slack for noise.
   Report the mean yearly gap from year 10, but it is not a gate.
4. **The panel row:** approved, using the current-target wording. It reads "Cost of unanswered emergencies this year:
   §X rebuild; the safety record is cutting newcomers by N %". N comes from the safety record's current migration
   multiplier, rounded to a whole percent and hidden at 0. Do not invent an arrival ledger. State the amendment to
   LG-06's text in the report.

The infra hunks still wait for B2.

## T041 (NEW-05): D2 sign-off goes to option B

- **Option A is rejected.** It moves the base by +18.5 % (128×15 s7 192,899 → 228,544; 256×60 s7 → 1,654,270). NEW-05
  says the base rows move "a little" by design, because the bot already pays a little growth at 9-11 %. A +18.5 %
  move would also redo the calibration of every SIM lane measured against the base (T042-T045).
- **Option B is signed off under D2,** provided its side-by-side table shows two things:
  - every NEW-05 gate passes: the fixed-tax sweep steps and 256×30 s7 at 12 % from year 21 (at least −3 % in 2030);
  - every §8.0 base row (128×15 s7 and 256×60 s7 and s11) is within ±3 % of fresh dev. Aim for ±1 % where that
    costs nothing.
- **Recording:** put the new rows under `polish`, and put "bot reference: …" in the report, so the merge commit can
  carry it.
- **If B misses either condition,** send the table and do not fall back to A.
- **T041 merges first of the SIM lanes,** after B2. T042-T045 then merge dev and re-measure their relative targets on
  the base that includes T041, as the plan's "measured at the merge commit" rule says. Do that re-measurement in
  each lane's final gate, not now.

## T045 (LG-08): the decisions

1. **The commute start of 8 minutes at −0.25 is approved** as a measured plan amendment.
   - It fires from 2030 on `--skip transit`, and the base stays within 1 % of fresh dev, which meets the ≥ 0.99×
     floor.
   - State the 1.24 % cost against the recovered base in the report.
   - The rejected −0.125 trial stays in the report as evidence.
2. **The population-loss targets:** keep 2060 at ≥ 10 %, which start 8 passes. **Amend 2040 from ≥ 4 % to ≥ 1 %**,
   with this reason in the report:
   - In 2040 most of the bot's commutes are under 8.5 minutes, so the sanctioned mechanism (tower lots, +0.04 appeal,
     the commute term) cannot reach 4 % without strengthening unrelated balance. That would move every other lane's
     base.
   - 1 % is above today's 0.7 %, the problem the item set out to fix ("transit pays off only late").
   - Do not touch the radius, the appeal or unrelated balance to pass.
3. **The stage gate:** the item's intent is that stations shape the skyline. Mean stage over every growable lot is
   the wrong measure for that, because CS$ (13 of the 73 near lots) has no tower definition at all. The gate becomes:
   - **The tower share:** the share of stage 6+ buildings within 6 tiles of a connected station is at least 2× the
     citywide share in 2060. Your 2060 histogram gives 23/73 = 31.5 % near the stations against 686/8,798 = 7.8 %
     citywide, about 4.0×.
   - **The diagnostic:** report the mean stage over the tower-eligible types (those with a stage 6+ definition) on
     both sides, but it does not gate.
   - **No catalog, demand, growth-budget or fit changes in this lane.** The R$ permission-to-realisation gap goes to
     POLISH_BACKLOG.md as a CONTENT/SIM follow-up. Grand Central's definition stays with LG-02.
4. **GUIDE's two display requests** (the inspector's "Stage 5 max" note and the Stats line):
   - The inspector line goes in T045, as its own commit in src/ui/inspectorModel.ts; no cloud lane touches that file.
   - The Transit stats card's "Riders save N minutes" waits for PB-COMMUTE, as the item says. List it in the report.

## For the cloud's worker chain (T034, then W1.3/T039): host bugs found by the desktop's lanes

- **The resync rebuild:** WorldView.ts:388 rebuilds from its OLD state object after a loopback resync (NOTE-041 item 2;
  R1's writer audit).
- **The speedChanged replay:** LoopbackSimHost.ts:180 replays `speedChanged` before it updates its own speed, so a
  handler that re-reads host.speed sees the old value. Seen in T048's QA: after an urgent pause the LIVE duck never
  engages, and the banner shows LIVE one tick late. Check WorkerSimHost for the same ordering.
- **The dispatch ack, now closed:** T028's round-2 fixes showed the missing `dispatch` / `dispatchBest` acks in loopback
  were the harness: async camera fitting overwrote the dispatch focus. There is no host bug.
- The T034 chain fixes these in its fix round if it is still open, or else W1.3 does. Desktop lanes: work around them
  as T048 did, using the event's value, and do not edit LoopbackSimHost.ts.

## FH-21's real-GPU recheck and T058

- **Received:** every acceptance line passes on the RTX 5070 Ti, and T058 (local/T058-fh21-fixes) fixes the bugs you
  found. Report the ~11.5 s prompt latency against the ~20 s the item expects. Unless you think 11.5 s is wrong for
  players, record it as an observed difference rather than changing the window.
- **The Notifications.ts request** (a toast that arrives above the slow-frame question moves its buttons under the
  cursor, at Notifications.ts:273 and :190): **T058 makes the change.**
  - T036 step 3, which owns that file, is merging into dev now. Once it lands, merge dev, then give questions their
    own container, or insert other toasts below the last `.question`. Do it as its own commit.
  - Keep FEEL-02a's toast budget intact: the budget tests must pass unchanged.
  - Add a browser check that a real click on Keep lands while a toast arrives.

## The SIM balance rule for LG-06, LG-07, LG-08 and every later SIM item

All three lanes hit the same problem: a ±0.5-1 % base tolerance against the bot's forks. Whenever a change moves the
money, the bot spends differently. One rule now covers them all, and it replaces the T043 tolerance above where the
two differ:

1. **One shared A/A envelope per base.** Measure it once and keep it in docs/dev/reports/sim-aa-envelope.md, rather
   than in each lane.
   - Run the base twice: as is, and with a neutral perturbation that changes only the funds path (+§1 once on day 1).
   - Do it on 128×15 s7 and 256×60 s7 and s11.
   - Record per year from year 10: population, mean air at homes, approval, and the I-HT share of industrial jobs.
   - The envelope for each metric is its max |Δ|.
   - Measure it now on dev, then again on the dev that includes T041, since NEW-05 moves the base. Lanes re-measure
     their final gates against the second one.
2. **Base rows:** each row passes within max(the item's tolerance, ±1 %, the A/A envelope). The systematic-shift
   check from the T043 section still applies.
3. **Variant targets:** a target missed by less than the A/A envelope for that metric counts as met, if the direction
   also holds on the other seed. Report the margin. A target missed by more is a real miss.
4. **Still not allowed:**
   - compensating residential growth, weakening a specified cost, a free approval bonus, or re-recording a baseline
     to hide a miss;
   - changing the default bot's strategy.
   - A change limited to a variant (`skips(...)`) is allowed when it stays out of the base rows.

## T044 (LG-07): the decisions

1. **Remove the high-tech floor.** The plan does not specify it, and it makes no high-tech. Keep the specified I-D EQ
   penalty, retooling (50 % to I-M, 25 % to I-HT above EQ 70) and soil contamination. Judge the base under the shared
   rule above; your worst yearly drift without the floor is 1.29 %.
2. **The clean-only bot correction is approved,** limited to `skips('dirty')`:
   - `ensurePower` uses gas instead of coal;
   - `zoning` counts usable industrial footprints rather than fragmented empty cells, and prefers viable campus sites.
   - Measure gas's cost per MW. Then judge 0.80× and the 15 % cleaner air under the shared rule.
3. **The high-tech gate measures the mechanism, not the bot's zoning.** The default bot only zones IndHigh above demand
   0.35, and the base rows forbid changing its strategy. On 256×60 s7, the gate is met by both of these:
   - (a) wherever EQ ≥ 110 by 2040, the I-HT share of industrial demand, which is what a player who zones IndHigh can
     get, is at least 25 %;
   - (b) a scripted probe from the y43 checkpoint save zones a 6×6 IndHigh block near schools, then advances 24
     months. At least 25 % of the block's jobs are I-HT. Store the probe as a tool or test.
   - Realised I-HT jobs in the bot rows are reported, not gated. Veteran #3's "0 I-HT jobs at 1M" is checked by (b).
4. **"Keeping the +1 approval":** a year-60 approval gain of at least +1 minus the approval A/A envelope counts as met.
   +0.49 passes only if the envelope is at least 0.51.

## T059 (J0, WORKER_DESIGN S0): received

- The fix and its negative-control test are right.
- Run the browser gates in your quiet slot: the main-thread protector after 10 minutes of demo-ui play, and LOD
  proxies/s within ±5 %.
- Then send DONE, and the cloud merges it. It is a small render-only diff, so the merge needs no bot run.
