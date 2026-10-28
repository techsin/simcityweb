# NOTE-038 (lead → worker): the owner says "continue as before", so we are back to full pace; this replaces NOTE-037's pacing

The owner answered me directly: the daily limit reset, so continue as before. NOTE-035's and NOTE-037's
one-at-a-time rule is lifted. Run parallel again, with Codex as its credits allow.

**Dev, once the cloud's gate run passes:**
- W0-complete, T014, T025, T026 (`352e63b`, conflicts resolved) and T008 (`4ce7b7a`, with my fixes).
- So **T036** (waited for T008) and **T037c** (waited for T026) can start.

**Your list, your order, in parallel where lanes don't overlap:**
- The W0.3-W0.5 browser QA on dev, as in NOTE-037. It is still the one merge-safety item W0 lacks.
- T027's camera QA (running).
- The gated lanes: T030's timing gate (plus the dense-city first-far-orbit trace), T038, T037d, T028.
- The W1 lanes, each with dev merged in: T032, T031, T033, T034, then T029.
- **Codex lanes:**
  - T035b (pendingCatalog);
  - T037b on dev plus `local/R1-interfaces`;
  - T036 and T037c, now unblocked;
  - the TopBar split after T030 merges.
- **T010's fix round (new, yours):**
  - the Stock Exchange setback-roof z-fight (major): lift the cornice cap or drop the RoofFlat cap off the shared y1, in
    both variants;
  - the three minors: the WTC roofs, which have the same construction; Grand Central v1's vault-foot strips (3.8 mm);
    the Crown v1's ribs (4 mm);
  - then the registration with `pendingCatalog: 'LG-02'` once T035b lands.
  The cloud's gate report and art review are in the journal summary in STATUS ("Lead decisions, Oct 28").

**On the cloud:** B3 resumed (its build continues from the four committed steps), and B2 resumed (its second design
review, then the build). I merge each when its gates and verification pass.

Commit and push often, so a limit stop loses little.

**Gate result for dev with T026 and T008 merged:**
- tsc is clean, and the bot is identical (196,101).
- The full suite is 1,769 passed and 1 failed. The failure is intermittent: `tests/sim/exact/traffic.test.ts` "pool/inbound
  scratch", with `pool 56.oMc: different array bytes`. The same file passes when run alone.
- Neither merge touches anything that test imports. I'm root-causing it on the cloud now: repeat runs, then a bisect if
  it reproduces.
- If you have seen it before in your five-suite runs, tell me which commit.
