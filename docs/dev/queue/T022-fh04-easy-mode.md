# T022-fh04-easy-mode: polish FH-04, Easy becomes a real first-city mode (Medium and Hard bit-identical); a Codex lane
base: b60b2d3 (the dev branch HEAD; record it); branch local/FH-04-easy
after: none for the code. Polish D1 lets round 1's SIM items start once part B and the perf branches merge. The only
  reason to wait is that the gate rows are taken on the merged base, and FH-04 keeps Medium and Hard bit-identical. So
  write it now, and re-run its two-process check after I merge check 4's branches (I will say when).
owns: src/sim/economy/tuning.ts (a new DIFFICULTY_RULES table), src/sim/economy/approval.ts (update(): the two fades),
  src/sim/config.ts (the Easy disasters default), src/sim/economy/budget.ts (read the income through the table), and
  new tests. No UI file: the New City blurbs (FH-11) and the approval hover text (GUIDE's approvalDetail) come later and
  read the table.
do:
  Read docs/POLISH_PLAN.md FH-04 (around line 1211) in full; its file:line references are against e116226, so find
  each hunk by identifier. The change:
  - A DIFFICULTY_RULES table in tuning.ts, one row per difficulty. The Medium, Hard and Sandbox rows equal today's
    constants and are read through the same code path. The income multiplier (DIFFICULTY_INCOME today, budget.ts
    around line 131) moves into the table.
  - Easy adds three rules:
    - the crime approval term is multiplied by smoothstep(needsPop0, needsPop1) of the residents, so it fades in from
      2k to 8k like the outage terms (approval.ts around lines 272 and 372 show the existing fades);
    - the monthly emergency term (failed, late, deaths) gets the same fade as the remembered emergency term;
    - defaultDisasters: false, as the New City default for Easy only (config.ts around line 52). An existing city
      keeps its saved setting.
  - Each row carries blurb strings for the New City dialog (FH-11 will show them).
  - The approval breakdown's crime term carries a "new-town grace" note while the fade applies, so the later hover
    can say "Crime −3 (new-town grace)". Put it in the sim's factor-term data, not in src/ui.
  Old Easy saves get the fades at once; that is intended (FH-04's Risk). Old Medium and Hard saves must not change.
gates:
  - Medium and Hard: bit-identical yearly state hashes before and after, on 256x60 s7 and s11 and 128x15 s7, by the
    audit's two-process method (base and branch in separate processes, compare the per-year hashes). The 128x15 s7
    Medium run stays at 194,432.
  - Easy: the 128x15 s7 bot has approval ≥ 55 in every year 2001-2006 (53.5 in 2001 today).
  - The FH-10 newcomer (tools/simbot.ts --profile newcomer) on Easy: approval ≥ 50 from year 2, and at least twice
    the Medium newcomer's population in year 6.
  - Record Easy's funds by 2015 (the plan expects them to grow; that is accepted).
  - Tests: the table rows, both fades (on and off by difficulty), an old Easy save and an old Medium save loading and
    continuing; npx tsc --noEmit clean; npx vitest run passes.
report: docs/dev/reports/local-FH-04-easy.md (the tables, what Codex vs you wrote). Push local/FH-04-easy with
  docs/dev/queue/T022-fh04-easy-mode.done; DONE. Priority: below T020 and T021, above T008 and T010.
