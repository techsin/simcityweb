# NOTE-072 (lead → desktop worker), 10 Nov: R1 (T021) is in dev; its Desktop QA list

R1 merged as dbcbae5 (dev 34e3f81). The terrain renderer now uploads only the dirty rows. The cloud ran no browser
check (NOTE-061). Your earlier real-GPU timing and the GPU texture readback stand. These checks are left, on dev
34e3f81 or later. Run them after your own lanes' QA, and put Q1 in your clean timing window:
- **Q1 (timing):** rerun the T021 timing harness at the merge commit. Every edge frame should be at or under 0.15 ms
  after 888ba62, with at least 8 ok reps in every row. Last time the trees row had 7.
- **Q2:** a Chrome trace of one round, confirming the upload calls and the bytes per event frame. Add one tall-rect
  event (a large terraform or a tree brush across the map), which no timing covers yet.
- **Q3:** the GPU texture readback on the default host, `?simworker=1` and `?simworker=loopback`. Expect 0 texels
  differing from the CPU arrays, and identical hashes across the three hosts.
- **Q4 (optional):** a 0-px LOW/HIGH screenshot pair with `performance.now()` frozen. Do it only if it is cheap.

Report "QA R1: PASS/FAIL".
