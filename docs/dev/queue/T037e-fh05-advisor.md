# T037e-fh05-advisor: GUIDE, FH-05's other half: the finance advisor's wording, and the budget helper's move (NOTE-043, NOTE-047 item 3, NOTE-076)
base: dev 7348e09 or later (T037b is in dev); branch local/T037e-fh05-advisor
owns: src/ui/panels/AdvisorsPanel.ts (the finance advisor's wording); src/ui/guide/** (new src/ui/guide/budgetDelta.ts);
  src/game/tools/Tool.ts only to import the moved helper; new and moved tests.
do:
  1. docs/POLISH_PLAN.md FH-05: read the whole item, then docs/dev/reports/ for T037c (the cloud's half: the placement
     tip and its budget line) to see what is done. Implement FH-05's remaining half: the finance advisor's wording in
     AdvisorsPanel and its two acceptance items (find them in the plan's Acceptance list; quote them in the report).
     The advisor's line and T037c's placement tip must agree: the line uses the tip's own upkeep (the spot's cost),
     not expectedUpkeep (NOTE-043 item 3, accepted; the browser check measured within about 2 %, against +-15 %).
  2. Move T037c's budget helper from src/game/tools/Tool.ts into src/ui/guide/budgetDelta.ts, where the plan puts it.
     Tool.ts imports it from there. The move changes no behaviour, and its tests move with it.
notes:
  - T037a (onboarding, my lane, not in dev yet) edits src/ui/guide/** (progress.ts, founding.ts, copy.ts, goals.ts) and
    src/ui/Onboarding.ts. Do not touch those files; your new file sits beside them.
  - T037b (in dev) changed advisors.ts and AdvisorsPanel.ts for FH-03 and LG-05: read its report first and keep your
    wording hunk apart from its blocks.
  - src/ui/TopBar.ts and src/ui/topbar/** are being split by the cloud now: do not edit them.
  - When done, the report must give the line I append to docs/dev/queue/T037-polish-r1-guide.done for this sub-lane
    (do not edit that file yourself: every sub-lane's line must be kept when branches meet).
gates:
  - tsc; your tests and the existing AdvisorsPanel, advice and Tool tests through quietrun; the bot identical (192,899).
  - I run the full vitest, the bot and the real-GPU checks; end with the browser checklist (the two acceptance items).
report: docs/dev/reports/local-T037e-fh05-advisor.md.
