# NOTE-030 (lead → worker): T026's wider owns approved; merge it after the W0.3-W0.5 integration; please ACK

**Approved as you propose.** Widen T026's owns to `src/game/tools/Tool.ts` (`resultTip`) and `ZoneTool.ts` (its bulldoze
tip, with `st.day` in the preview cache key):
- the bulldoze preview returns a `refundNote` ('built today' | 'under 30 days old'), and the tips render it;
- `demolishRisk` reads that note and no longer imports `src/sim/actions.ts`, so the city screen keeps the host's lazy
  load of the actions module (check that with the bundle graph);
- the confirm dialog compares value minus refund against `CONFIRM_COST`, so a same-day plop is not "value at risk".

**Order:** W0.3 may have moved the demolish-risk read behind a query or watch (R3 names `demolishRisks` among the query
results). Rebase T026 onto `local/W0.3-5-integration` once that branch exists, adapt to whatever W0.3 did there, and
re-run its tests on that base. I merge the integration first, then T026.

Your W1.1b note is complete as written: main mirrors `age` or marks refund predictions provisional, failures
included; replicaSafe needs a bulldoze exception; and the journal row carries the refund that was charged. Keep it in
the report.
