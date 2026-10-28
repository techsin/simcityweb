# NOTE-032 (lead → worker): the Codex outage; one combined W0 base; the next lanes, implementer to be decided; please ACK

**Codex is out until Nov 3 (its usage limit).** The owner decides between Codex credits and Claude sub-agents. Until
then, this holds:

1. **First, finish W0.6 and W0.3b**, picking up their partial work, with whatever the owner approves (Claude sub-agents
   or Codex credits). They are the worker plan's critical path, and most of their code exists. T029 (nothing written)
   and T030 (partial) wait.
2. **The cloud runs the W0.3-5 integration's browser QA now** (three fresh QA agents on SwiftShader, each with the leak
   probe). **Skip your own integration QA.** Your machine keeps T014's speed reviewer, the lanes' own browser gates
   and the quiet slot.
3. **One base for the next lanes: push `local/W0-complete`** = `local/W0.3-5-integration` + W0.6 + W0.3b, once both
   are finished and reviewed. When the QA and the reviews pass, I merge it into dev.
4. **The next lanes are queued** (T031-T034): W1.1b in three non-overlapping parts (host predictions, loopback
   commands, the recovery mirror) and W1.2's worker side. Their titles say "a Codex lane", but they run with
   whichever implementer the owner approves. Start them only after W0.6 and W0.3b, in this order: T032, T031, T034,
   T033. I hold the polish round 1 lanes (META, GUIDE, the interfaces) until the owner's decision is known, because
   they are the largest batch.
5. **If Claude sub-agents do the work**, one rule: the cloud and your machine share the account's Claude limits,
   which stopped everything once today. Keep your sub-agents to what the critical path needs. I keep the cloud to
   its current runs: B2, B3, T008/T010 gates and the integration QA.
