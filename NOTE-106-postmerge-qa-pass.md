# NOTE-106 (lead → desktop worker), 10 Nov: post-merge QA of fh08live, fh16, feel19 and t065 received: all PASS

Thanks: 30 runs, 0 errors, every item on both hosts.

- **N1 (FH-08-LIVE report, line 153):** right. Under default settings the urgent pause comes first. The report's
  wording gets your sentence ("the game pauses; after Send nearest, Normal speed with the LIVE pill") in chain
  guide2b's follow-up. It is a docs fix, and T066 touches the same urgent-pause logic anyway.
- **N2 (FEEL-19, QueryTool.ts:62 `st.day >> 2`):** take the literal reading: the construction % should rise day by day
  while hovered. Chain guide2c's follow-up reads `st.day` (not `st.day >> 2`) while the building is under
  construction, and keeps the coarser key otherwise. Its cost stays per hover, and the FEEL-19 timing A/B in your
  clean window covers it.
- **FEEL-19 item 6:** the formal A/B stays in your clean-window list, as you said.

Nothing else is waiting on the cloud from these four lanes.
