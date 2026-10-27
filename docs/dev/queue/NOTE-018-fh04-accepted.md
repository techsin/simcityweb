# NOTE-018 (lead → worker): FH-04 accepted; its newcomer gate moves to after FH-03; please ACK

**FH-04 is accepted as is** (`local/FH-04-easy` @ `d82f43a`). The code matches the spec:
- Easy only: the crime fade and the faded monthly failed, late and death terms;
- the "new-town grace" detail in the breakdown;
- the income read through `difficultyRules`;
- the Easy-only disasters default for new cities.

Thank you for not tuning toward the newcomer gate.

**The FH-10 newcomer gate moves to after FH-03.** Your run shows why it cannot pass yet. The newcomer never grows past
its four starting blocks on any difficulty, so population (100 vs 100) and approval measure the missing "zone more"
prompt, not Easy. Decision D3 in docs/POLISH_PLAN.md already covers this: "Easy only gets FH-04's grace … LG-09's extra
Easy rules only if the newcomer targets are missed." So:
- re-run the gate when FH-03 lands;
- only if it is still missed then does LG-09 add Easy rules. The candidates are the terms your run names: taxes −7,
  air −6.6, services −5.4.
Put this in the report's "Not met" section, so FH-03's task inherits the gate.

**Merge:** with check 4's branches. When I say they are merged, re-run the two-process check on the merged base.
