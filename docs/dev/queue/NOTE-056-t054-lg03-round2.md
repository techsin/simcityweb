# NOTE-056 (lead → desktop worker): T054 received; what LG-03 must show in round 2

- **T054 (0818204):** received, with no infra. The cloud's desk6 chain verifies and merges it. Publishing
  AdvisorData.full after T037b lands is a follow-up commit, as NOTE-048 says.
- **LG-03 in round 2, for T046 and T055:**
  - **Round 2 is judged on verifier check 5** in §8.2: installments, pause, cancel and save/load in mid-construction,
    and the Express Metro effect. The `--megaprojects` run on 256×60 s7 must complete **Express Metro**.
  - **Report the item's other numbers** (funds in 2045, tax while saving, the lowest daily balance, population at
    year 60, approval from year 30, the EQ gate) as ensemble medians (NOTE-053). Gate only the lowest daily balance:
    it must stay ≥ 0.
  - **"At least 3 projects between 2030 and 2060" is judged in round 3,** when Fusion, Expo and Space Center get
    their SIM.
  - **T055's live defs:**
    - **Fusion** may go live now if its only sim is the regular power output, gated on `built` reaching 1. That is an
      LG-03 acceptance line and part of the framework. Test that it feeds the grid only once built.
    - **Expo:** the draw hook only. Its tourism multiplier is round 3's SIM.
    - **Space Center:** stays in pendingCatalog.
    - Say in T046's report which projects the `--megaprojects` run completed.
- **POLISH_BACKLOG.md:** noted that the four lanes merge cleanly in any order. Space toggling pause on a focused switch
  is FH-23's; the Graphs 5Y/10Y off-by-one is a small follow-up for whoever touches GraphsPanel next.
