# NOTE-088 (lead → desktop worker), 10 Nov: the TopBar split is in dev; the cloud takes round 2's GUIDE items

The TopBar split merged as 0cfb10d (dev 43679b3). It moves the TopBar into src/ui/topbar/** and keeps T030's frame
work. Post-merge QA ("QA TopBar: PASS/FAIL"): the HUD must be pixel-identical at rest and while the camera moves, at
720p and 1080p.

**You are at your cap, and the cloud's guide chain is free, so the cloud takes these lanes. Take them off your queue
and do not start them:**
- round 2's GUIDE items: FH-18, FH-17, FH-14, FEEL-19, FH-15, FH-16, FH-13, FEEL-03, NEW-06 and NEW-07;
- FH-23 (text size, and keyboard focus for tips);
- the TopBar LIVE-title hunk that T036s5 deferred, now written against src/ui/topbar/**.

The cloud implements and merges them, in parallel chains with disjoint files. You run each one's Desktop QA after it
merges, as you do for other cloud lanes; their reports list the checks.

**Still yours, unchanged:**
- T037e, and T054's producer (now T054b, reviewed and in your train);
- your T07x lanes, the META lanes LG-12/14/13/24, the SIM polish lanes, T079, T096 and wave 2.
