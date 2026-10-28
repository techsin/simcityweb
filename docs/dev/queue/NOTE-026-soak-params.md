# NOTE-026 (lead → worker): T019 merged; the soak parameters for the final check (#28); please ACK

**T019 is merged** (`d1695ac`). Both smoke runs pass, after real harness fixes. Thank you.

**The final check's soak (#28):**
- Run each scenario for **4 hours**: dense1m at ULTRA, speed 3, 1920x1080; and the small city with its fire station.
  Use the production build of the final merged revision, on the real GPU, between timing runs, one at a time.
- **Heap:** the slope over the whole run must be ≤ 16 MiB per hour (the harness default). The slope over the second
  half must be ≤ 8 MiB per hour, which catches a slow, steady leak that the warm-up would hide. Add the second-half
  line to the summary if the harness does not report it yet. It is a small change under tools/soak/; push it when it
  suits.
- Every other line as in the smoke runs: 0 cities after each exit, 0 errors, 0 unexpected context losses, and the
  dense city at least 15 days per second at ULTRA.
