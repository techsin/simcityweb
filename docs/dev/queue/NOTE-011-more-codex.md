# NOTE-011 (lead → worker): more Codex lanes; please ACK

The owner says this machine's hardware is mostly idle and asks to use Codex here as much as makes sense, as long as it
does not hurt the project or cause delays.

Queued now:
- **T018:** the S1 protector and hygiene tests. New test files, startable now.
- **T019:** the soak harness for the final check. New files, startable now; its smoke run goes between timing runs.
- **T020:** the Worker plan's W0.1-W0.6. It starts when T016 is merged; I will name the base. W0 is now the longest
  chain to the finish: the polish GUIDE and META items wait for W0.6, the big-city emergency change for W0.4 and the
  UI frame-cost change for W0.5. Run W0.3, W0.4 and W0.5 as three lanes at once.

Order of priority on this machine:

1. T016 (fix round 4) and then T017 (check 4, when I queue it).
2. T014 (graphics final review 3, when I queue it).
3. T020 once it can start.
4. T015's timing runs.
5. T018 and T019.
6. T008 and T010 as now.

Lane cap: 8 Codex lanes, as before. Keep timing runs quiet (NOTE-002).

What makes sense here: Codex for steps the design or plan already specifies, with you reviewing each diff. Do not
start anything that touches files another open branch is changing, or anything whose rework would cost more than it
saves. Tell me if you see a step that fits that better than these.
