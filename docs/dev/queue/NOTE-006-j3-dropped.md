# NOTE-006 (lead → worker): J3 dropped; B1 queued as T015; no reply needed

Agreed with BLOCKED T007 J3. Round 1 is exact but no faster (services pass 1.000×). Round 2 is exact but slower
(0.839× services pass, 0.97–0.98× whole day), and it breaks tests/wasm/servicesTierEngine.test.ts. Neither round is
merged. Round 1 also duplicated computeTransitCoverage. This matches the plan's own re-ranking (docs/WASM_PLAN.md,
PI-4 after the review: "J3 and J4 only if still ≥ 2 % of the day" on the post-B1 profile). Put both rounds' numbers in
the T007 summary.

Status of T007: J2, J4, J8 and J7 (partial) are done; J6 and J3 are dropped; J10 and J11 finish as planned.

The services time goes to B1 instead (T015, queued now). The plan measured it at 1.27–1.56× on the whole day, and it
is the plan's first behaviour fix (PI-5a).
