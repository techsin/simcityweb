# T037-polish-r1-guide: polish round 1's GUIDE lane (Codex lanes, split by file)
base: local/W0-complete when it exists (GUIDE edits panels that W0.3 and W0.3b changed); branch per sub-lane:
  local/R1-guide-<part>
owns: the GUIDE files in docs/POLISH_PLAN.md §7.2 (src/ui/Onboarding.ts, src/ui/guide/**, the src/ui/topbar/** split,
  adviceActions.ts, glossary.ts, FloatText.ts, AdvisorsPanel, BudgetPanel, InfoPanel, StatsPanel, inspectorModel,
  zoneStatus, Toolbar, Panel, ZoneTool, NetworkTool, BrushTool, and their tests), plus GUIDE's hunks in §7.3.
do:
  Read docs/POLISH_PLAN.md §4 (onboarding), §7.2-§7.4, §8.1 and each item in full. These sub-lanes have no shared
  files, so run them in parallel:
  - **(a) The onboarding framework, FH-01, FH-02 and FH-22:** the founding steps; "your first year" goals; guide
    progress saved per city, with tips remembered per profile. Files: Onboarding.ts, guide/**. Use the §4 copy module
    that is already merged.
  - **(b) FH-03 and LG-05:** "zone more" impossible to miss; endgame advice that names real options. Files: the GUIDE
    hunks of advisors.ts (§7.3), AdvisorsPanel, adviceActions. Both key on `NewsItem.ref` (T035), so start after it.
    FH-03 also re-runs FH-04's deferred newcomer gate (the "Not met" section of docs/dev/reports/local-FH-04-easy.md).
  - **(c) FH-05:** what a building does to the monthly budget, shown before it is placed. Files: the placement tips;
    T026 edits ZoneTool.ts and Tool.ts, so start after T026 merges.
  - **(d) FH-06 and FH-09:** approval a newcomer can read; a tax panel that tells the truth. Files: approval.ts's
    `approvalDetail` and `APPROVAL_LABELS` (GUIDE's hunk), BudgetPanel.
  - **First, the TopBar split (§7.3, §7.4),** after T030 merges, because T030 edits TopBar.ts now. Do (a), (b) and (d)
    without the TopBar until then.
gates: each item's Acceptance list; tsc; the full vitest; the bot at 196,101 (GUIDE changes no sim outcome); the
  items' browser checks in your slots; at the end, round 1's verifier list in §8.1 (with META's items).
report: one report per sub-lane, docs/dev/reports/local-R1-guide-<part>.md; push each with a line in
  docs/dev/queue/T037-polish-r1-guide.done; DONE per sub-lane.
