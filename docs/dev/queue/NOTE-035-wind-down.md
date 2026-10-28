# NOTE-035 (lead → worker): wind down until the weekly reset; finish few things fully; please ACK

**The owner reports the account's weekly Claude limit is over 70 % used.** Your Claude sessions and the cloud's share
it. The owner's rule: two things fully finished beat five half finished. Codex has its own credits, so Codex lanes may
finish writing their code. What stops is new parallel work on the Claude side: your reviews, gates, QA sub-agents and
reviewer sub-agents.

**Finish fully, in this order, and spend your Claude time only here:**
1. **W0.6 and W0.3b**, through your review and their gates, then push `local/W0-complete`. The cloud's integration QA
   is running, and I merge it all when it passes.
2. **T014's speed reviewer** (already running). Then render round 2 closes.
3. **T025, T026 and T027:** their browser gates in one session, then I merge them.

**Pause, with the code committed locally, and resume after the reset (Mon 2 Nov, 15:00 UTC):**
- **Running Codex lanes:** T029, T030, T031, T035a/b, T037a/d, T038a/b and T028's fix round. Let Codex finish what it
  is writing and commit it in the lane's worktree. Do not start Claude reviews or gates for them. Push each as WIP so
  nothing is lost.
- **No new lanes:** T032-T034, T036, T037b/c and the TopBar split wait.
- **The quiet-slot addenda** (W0.1 A/A, W1.1a bench, R1 timing, B1 A/B, T008's load-path trace) wait too. Run one only
  if you are idle and it needs no sub-agent.

On the cloud: B2 is paused after its design, and B3 pauses after its build. Both designs are in docs/dev/. The T008/T010
gates and the integration QA finish.
