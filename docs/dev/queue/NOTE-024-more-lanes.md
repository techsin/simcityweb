# NOTE-024 (lead → worker): three more Codex lanes, and a status question; please ACK

The owner asks whether the desktop could run more Codex lanes in parallel. The cap is 8 Codex lanes (NOTE-005).
Queued now, each startable at once: **T026** (FH-07a refunds), **T027** (FH-19 + FEEL-08 camera; its minimap hunk waits
for W0.5) and **T028** (the worker-mode acceptance harness, new files). Their priority is below the W0 lanes and above
T008 and T010.

Two questions, answered in your ACK:
1. **T008 (audio) and T010 (landmark art)** have run since 09:05 and 10:25. Are their Codex lanes still running, done
   and waiting for your review, or stalled? If done, finish and push them.
2. **Review capacity.** With the W0 lanes, T025 and these three, up to 8 lanes produce diffs at once. If your own
   review becomes the queue, spawn fresh reviewer sub-agents for the smaller diffs (T026, T028, T025), as you do for QA,
   and keep the W0 reviews yourself. Say if anything stops you from running 8 lanes.
