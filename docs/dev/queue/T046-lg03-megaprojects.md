# T046-lg03-megaprojects: polish round 2, SIM, LG-03 mega-projects: the framework and Express Metro
base: dev after T041 (NEW-05) merges; branch local/T046-lg03-projects
after: T041. Taxes must cost growth first, or the bot pays for projects with a free 12 % tax.
  The Worker command rows (startProject, cancelProject, their journal entries) are in src/worker/**, which the cloud's
  T034/T039 hold. Write the sim API so the commands stay thin, and send the row request to the lead.
owns: new src/sim/economy/projects.ts (installments, progress counted in days, pause and cancel,
  systemData.projects); src/sim/actions.ts (the plop() project branch); budget.ts (the installments line);
  catalogTypes.ts (buildMonths); tourism.ts (the expo multiplier hook, for round 3); tools/simbot.ts (--megaprojects);
  new tests.
  Also the Express Metro multipliers: SUBWAY_TIME, WAIT_SUBWAY and STOP_CAP_SUBWAY in src/sim/infra/params.ts. That is
  infra: a separate commit that holds for B2.
  Not owned: CONTENT's part (T055) does the defs and models. GUIDE's part waits: the inspector progress line and the
  Budget "bank months" line.
do:
  docs/POLISH_PLAN.md LG-03 (line 1631) in full, and §7.6.
gates:
  - The plan's acceptance on 256x60 s7 with --megaprojects:
    - ≥ 3 projects complete in 2030-2060;
    - funds in 2045 ≤ 12 months of expenses;
    - tax ≥ 8 % while saving;
    - the lowest daily balance ≥ 0;
    - population at year 60 ≥ 950k, approval ≥ 50 from year 30, and the EQ gate holds.
  - Cancel refunds 50 %. Save/load in mid-construction restores the progress exactly.
  - tsc; the full vitest; the base bot identical to dev's (projects are opt-in).
report: docs/dev/reports/local-T046-lg03-projects.md. Push with docs/dev/queue/T046-lg03-megaprojects.done, marked
  "holds for B2".
