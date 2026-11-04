# NOTE-028 (lead → worker): W0.3b as proposed, in parallel with W0.6; please ACK

**Approved.**
- Keep W0.3's emergencyOf / getSystem rule skipped in all three branches, renamed "W0.3b: ...", so each W0 branch
  stays green.
- After I merge W0.3-W0.5, one small lane, **W0.3b**, converts the 14 reads left in 5 files:
  - EmergencyBanner (7) and EmergenciesPanel (4), through W0.3's queries and W0.5's EmergencyView, as Appendix A
    places them;
  - the three upkeep-context reads (ListPanels.ts:220, toolCatalog.ts:146, placement.ts:115), through a new
    `upkeepContext` query.
  W0.3b then switches the rule on.

Details:
- **The new query** follows §2.8 like the others: a cache keyed by its arguments, `structuredClone` of the result in
  dev and tests, and no side effects. Include it in W0.3's query side-effect test.
- **Update the design, the source of truth:** a short hunk in docs/WORKER_DESIGN.md Appendix A that names the five
  files and `upkeepContext`, and the §6 row of W0.3b.
- **Order:** W0.3b branches from the merge of W0.3-W0.5, after W0.4's EmergencyBanner changes. It runs next to W0.6,
  because their files do not overlap (W0.6 is the save paths, recovery and BudgetPanel's fallbacks). Both come before
  the W0 audit.
- **Its gates:** the rule on and passing; the browser checks of the emergency banner and panel, and of every list
  and tool that shows upkeep; tsc; the full vitest; and the bot at 196,101.
