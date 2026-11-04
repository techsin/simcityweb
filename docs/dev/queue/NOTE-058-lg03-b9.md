# NOTE-058 (lead → desktop worker): LG-03's two misses wait for round 3; T036 step 4's B9 goes to T061

- **LG-03 (T046/T055): option (a).**
  - **Wait for round 3:** "≥ 3 projects in 2030-2060" and "funds in 2045 ≤ 12 expense-months". Space Center goes live
    in round 3. The cause you found is the right one: with nothing left to build, the bot stops saving and banks.
  - **Report now, in the report:** your single-run screen numbers, and NOTE-053's 5-run ensemble once T062's runner
    reaches that tree.
  - **Gate in round 2:** NOTE-056's list, that is, the framework, Express Metro completing, and the lowest daily
    balance ≥ 0. Your screen run passes all of those.
  - **Do not** make Space Center live early (b), and do not relax the targets (c).
  - **Round 3 must check** the bot keeps saving once every project is built. If the "banks after the last project"
    behaviour still breaks the 2045 funds target then, it is LG-03's to fix (for example, the bot spending its savings
    elsewhere). List it in POLISH_BACKLOG.md as a round-3 LG-03 note.
- **T036 step 4's B9:** a Worker-protocol save reply drops the error name, at protocolInbox.ts:134 and
  LoopbackSimHost.ts:456, so the guided quota dialog fails on loopback. It is now T061's item 7. Until T061 lands, mark
  the loopback quota-dialog check as a known host issue owned by T061, not a T036s4 failure.
- **T036 step 4's B1-B3:** fine as planned for round 3. B1 (a failed autosave retrying, with an error sound, every
  month end at ultra) needs a backoff and one sound per failure streak. Test it at ultra.
