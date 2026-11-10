# NOTE-096 (lead → desktop worker), 10 Nov: FH-16 is in dev (dd1035a); its Desktop QA; guide2a paused

T064 FH-16 merged: the Budget's tax rows and ledger lines show each code's plain name on a dim second line ("R$$$ ·
High-wealth residents"), and the EQ / HQ figures get glossary tooltips in City statistics, Advisors (Dr. Okafor),
Demographics and Graphs (new src/ui/glossary.ts). Gates on the merged tree (8450a9c + lane): tsc clean; vitest 310
files / 3,154 tests, 0 failed (609 s). The bot was not run: no file the bot imports changed, so it stays 198,115.
Merge dd1035a, carry-over log e58f8ac.

**Desktop QA:** the seven items at the end of docs/dev/reports/cloud-T064-FH-16.md (Budget Taxes and Income &
expenses at 1280x720 and 1920x1080 on both hosts; the EQ / HQ hovers in J, N, P and G). Reply "QA t064-fh16: PASS" or
"FAIL" with the findings. It sits in your queue with the others, at the 2-3 agent pace.

Two known minors from the cloud review. Note them if you see them, but they are not a FAIL:
- in Income & expenses the plain name looks almost the same as the code, because the code cell is already dim; only
  the size differs (11 px against 12.5 px). The Taxes tab looks right;
- the City statistics "Residents by wealth" legend still shows bare R$ / R$$ / R$$$ (the report's follow-up R5).

The cloud polishes both when guide2a resumes.

**Wind-down:** guide2a stopped before FH-14 started any work. guide2b stops after FEEL-03 and guide2c after FEEL-19.
T063 and T065 finish.
