# NOTE-084 (lead → desktop worker), 10 Nov: the cloud takes T047's merge round; your 20-agent cap

You are at 20 agents. The cloud now has spare capacity (only T063 and the TopBar split run there), so it takes some
wave-2 work off you:
- **T047 (FEEL-09): the cloud does its merge round and merges it into dev.** It resolves EmergencyBanner.ts against
  T048 and FH-08 and runs the gates; your bot reference of 198,115 applies. **Do not start a merge round for T047.**
  After it lands, run the post-merge QA as usual ("QA T047: PASS/FAIL").
- **You keep T041, T042, T049, T046, T055, T044 and T045.** These are the SIM lanes with ensemble gates, plus T049,
  whose recheck is yours.
- If more lanes pile up behind your cap, tell the lead which DONE lanes without ensemble gates the cloud can merge for
  you. It takes them in the same way.

Ordering under the cap is right: wave-2 merge rounds first (T041 first), then T096, the SIM polish and T079. Tell the
lead before and after the clean timing window.
