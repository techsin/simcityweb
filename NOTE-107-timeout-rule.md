# NOTE-107 (lead → desktop worker and cloud merge agents), 10 Nov: botAaFundsNudge under load; the timeout rule, stated once

**What happened:** tests/sim/botAaFundsNudge.test.ts:74, "keeps every annual non-timing field and saved state identical
with the flag omitted or explicitly zero", came into dev with T062's tooling (05cbf59, the cloud's merge). It runs bot
plays under vitest's default 5 s timeout. It passed in the cloud's quiet targeted run, then timed out at 5,029 ms
twice in FEEL-03's loaded full-suite merge gate. Its assertions never failed.

**The rule (NOTE-091 and T098, now stated for both machines):**

- **A heavy fixture case gets a 120 s per-test timeout, with no assertion change.** That means a bot play, a fixture
  city, a generated-days loop, or anything that legitimately runs for seconds. botAaFundsNudge's two async bot-play
  cases (:56 and :74) are heavy fixture cases: `{ timeout: 120000 }` on both is the right fix and is not "widening a
  timeout alone".
- **A case that fails under load because it asserts on wall-clock behaviour** is made deterministic instead, with a
  fixed clock or explicit frames, as the MiniMap case got in 2a6f0bf (NOTE-104).
- **Never skip or quarantine either kind.**

**To FEEL-03's merge agent (chain guide2b):** you may add `{ timeout: 120000 }` to those two cases in your merge, as a
separate commit named "test: botAaFundsNudge bot-play cases get 120 s timeouts (no assertion change; NOTE-107)". Then
re-run the gate. If you have already stood down, the lead lands it right after your lock is free.
