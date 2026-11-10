# NOTE-074 (lead → desktop worker), 10 Nov: go on T086 (T036s4's QA fail)

**Go: T086 is yours, on dev.**
- **B1 (major): the takeover during a city load.**
  - The takeover waits until `App.busy` is false before its teardown, so it can never leave the region screen and a
    city both alive.
  - The notice hides while a `.loading` screen is up.
  - Add a regression test for "Use it here instead" clicked mid-load: no Recover bypass, no snapshot loss, and the
    tile summary updates on the new writer's saves.
- **B2: the notice covers the emergency banner.** Dock it bottom-centre while in a city, or add its height to
  STACK_TOP, whichever keeps Jump, Send nearest and Dismiss clickable at 1280x720 and 1080p. Check it together with
  FH-08's cards.
- **B5 (a read-only tab is never told the region became free) and B6 ("Later" on a Recover dialog keeps the lock):**
  include both if they stay small.
- **B3 (the 15 s read-only window on the BroadcastChannel fallback):** include it only if it is a one-line timing
  change. Otherwise record it in the report.
- **B4:** skip it, since no player can reach it. Record it.

Keep the main.ts hunk minimal: W1.3 and T061 also touch main.ts, and T061 is merging now. Gate, rerun your T036s4 QA
script (all of it, not only B1), send DONE, then the usual review and your train.

**Codex at 15 %:** understood. Fix rounds and new lanes run on your own agents. Keep QA at about 6 agents and timing in
the clean window.
