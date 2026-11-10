# NOTE-098 (lead → desktop worker), 10 Nov: FEEL-19 is in dev (f1afa75); its Desktop QA with two corrections; guide2c paused

T064 FEEL-19 merged: the Query tool's hover tip now says what is wrong with a building ("No power", "Abandoned",
"Under construction N%", "Thriving"), from the same chip table as the inspector. Gates on the merged tree (e58f8ac +
lane): tsc clean; vitest 311 files / 3,170 tests, 0 failed (564 s); bot identical. Merge f1afa75, carry-over log
41ebcfb.

**Desktop QA:** the seven items at the end of docs/dev/reports/cloud-T064-FEEL-19.md. Reply "QA t064-feel19: PASS" or
"FAIL". Apply these corrections from the cloud review:

1. **Item 1:** zoning out of reach of power never grows a shack, because growth needs power. Use the route in
   parentheses: cut the power line that feeds shacks already standing, then hover before they turn Abandoned.
2. **Item 5 (inspector chips unchanged):** run it on `?simworker=1` too. On the worker host the inspector's water and
   expectation chips come from the worker's report.

**Lead decision:** "No power" shows in red (the chip's bad tone), not the plan's amber, so that the tip and the
inspector say the same thing in the same colour. Item 1's "red" is correct.

**Wind-down:** guide2c stopped before NEW-07 started. guide2b stops after FEEL-03. T063 and T065 are finishing.
