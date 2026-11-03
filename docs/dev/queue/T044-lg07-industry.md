# T044-lg07-industry: polish round 2, SIM, LG-07 clean industry a real strategy, dirty industry a real cost
base: fb1531f (dev); branch local/T044-lg07-industry
after: none.
owns: src/sim/economy/demand.ts (retooling, the high-tech share); tuning.ts (RETOOL_*); ordinances.ts (texts);
  desirability.ts (the I-D EQ penalty, soil contamination); a new optional systemData key for the retool ramp and the
  contamination map if needed; new tests.
  Not owned: GUIDE's parts wait for the cloud's GUIDE chain. These are the RCI popover line (TopBar) and the Stats
  "Industrial strategy" line (StatsPanel). Expose the numbers (retooled jobs, the dirty share of jobs, air at homes)
  where the UI can read them through the host, and list the requests.
do:
  docs/POLISH_PLAN.md LG-07 (line 1397) in full, and veteran #3 (line 83).
  - Retooling: dirty demand the city cannot place moves to clean industry over a deterministic 12-month ramp: 50 % to
    I-M, and 25 % to I-HT once EQ is above 70. That covers no IndMed room, the Clean Air Act and Industrial Pollution
    Controls.
  - I-D desirability falls 0.03 per 10 EQ above 90.
  - Soil contamination under old I-D lots lowers R and CO$$$ desirability until it is cleaned, which gives Brownfield
    Cleanup a purpose.
  - High-tech pays. On 256x60 s7, I-HT is at least 25 % of industrial jobs wherever EQ ≥ 110, by 2040 at the latest.
    The bot zones IndHigh only above demand 0.35: say whether the bot or the share formula is the blocker.
gates:
  - tsc; the full vitest; balance.test's "no smokestack industry: air" (the run mean, LD15a) still passes.
  - 128x15 s7 --skip dirty: population at year 15 ≥ 0.8× base; mean air ≥ 15 % cleaner than base.
  - 256x60 s7 --skip dirty: within 3 % of base at year 60, keeping the +1 approval.
  - Base runs within ±1 % of dev's rows. The EQ gate holds, and |unemp − (1 − accW)| ≤ 0.02. The I-HT share line above
    holds.
report: docs/dev/reports/local-T044-lg07-industry.md. Push local/T044-lg07-industry with
  docs/dev/queue/T044-lg07-industry.done.
