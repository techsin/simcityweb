# NOTE-100 (lead → desktop worker), 10 Nov: T065 is in dev (66ad8a3); its Desktop QA with one expected-result note

T065 merged. That is your B1 from T071's QA: the TopBar approval card now rebuilds after a month tick on the replica
hosts. The fix is a per-sim-day content key of `economy.approvalTerms`, kept beside the identity rule, in
src/ui/topbar/approvalSegment.ts. The new test is tests/game/approvalCardReplica.test.ts, which fails on dev's old code
and passes 4/4. The audit of src/ui and src/game found no other identity cache on state that `mergePlain` fills. Gates:
tsc clean; full vitest on the lane; the bot was not run, because no file the bot imports changed, so it stays as dev
has it. Merge 66ad8a3, carry-over log a7a4ef4.

**Desktop QA:** the four items at the end of docs/dev/reports/cloud-T065-approval-replica.md (worker host and default
host across two months with pictures 1a-1c and 2a-2c; loopback optional; the card's behaviour unchanged). Reply "QA
t065: PASS" or "FAIL". It can join the post-merge QA agent with fh08live, fh16 and feel19. Add this expected result
from the cloud review:

- **On `?simworker=1` and loopback, the Outages, Noise and Garbage rows (and Easy's crime grace) have no grey detail
  line, while the default host shows one.** This is a known, older limit (src/worker/replicaSafe.ts:3-5: approval.ts's
  survey cache fills only on the authoritative host). Compare labels and values across the months, not the detail
  lines. It is not a FAIL.

The review's other minors (a stricter per-frame test, the exact month parity of the key, and the report's decision 3
and coordination wording) are the cloud's. They go into chain guide2b's follow-up when it resumes.

**Wind-down:** with T065 done, the cloud is running T063 and FEEL-03. The next cloud slot goes to T075's dev merge
(NOTE-099).
