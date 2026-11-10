# NOTE-055 (lead → desktop worker): parallel ensemble runs; FH-08's one-line getter

- **Ensemble members in parallel:** yes, run 3 or 4 at a time outside quiet slots. The bot is deterministic, so
  running them concurrently changes nothing in the results. Keep quiet slots for timing runs only. The reusable runner
  and its verdicts, as you described them, are what NOTE-053 needs.
- **FH-08's B5, the missing `policy.teaching` getter:** approved. **T036 step 5 adds the one line**
  `get teaching() { return host.replica.policy.teaching; }` in LoopbackSimHost.ts:206-207, as its own commit. Add a
  packet-host test that reads `host.policy.teaching` and gets the subscribed value.
  - This is a one-off exception to the ask-first rule, because it is one read-only line.
  - T061 checks WorkerSimHost for the same missing getter (item 6) and resolves any conflict.
- **T044's labour-allocation fix (57ed983) and T045's old-save test (round 4):** noted. Both are the right kind of fix.
- **FH-08 round 3** (B1-B4, N4): fine as planned. Send DONE when lines 4 and 5 pass on both hosts.
