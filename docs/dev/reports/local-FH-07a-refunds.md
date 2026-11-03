# T026 / FH-07a refunds — review follow-up

## Review and gates (the local worker)

Branch `local/FH-07a-refunds`, rebased onto `local/W0.3-5-integration` (`93069fa`), as NOTE-030 asked. W0.3's
`demolishRisks` and `sideDemolishRisks` queries now carry the refund and its note as plain data.

An independent reviewer read the lane and found the refund logic correct: every other spend and refund path is
unchanged, and 200,000 random cell sequences gave the same totals. Its findings, now fixed:
- **The bulldoze hover tip** reads "Refund §X (built today)" or "(under 30 days old)". Tool.resultTip and ZoneTool,
  owns widened by NOTE-030.
- **demolishRisk.ts no longer imports `src/sim/actions.ts`.** The city screen's static import graph excludes it again,
  so SimHost's lazy load of the actions module holds.
- **ZoneTool's bulldoze preview cache** is keyed by the day.
- **The confirm dialog** compares value minus refund against `CONFIRM_COST`.
- **The ledger-key comment** lists `oneoff:loanRepay`.
- **The W1.1b note** is complete.

| Gate | Result |
|---|---|
| `tests/sim/actions.test.ts` | the same-day coal plant returns funds to the pre-plop value; days 1-29 refund half; days 30 and 31 follow today's rules; fresh roads, rail, crossings, power lines and bridges; paused planning, through host.act |
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full, 1 worker) | **158 files passed, 1 skipped; 1,607 tests passed, 10 skipped** |
| The default bot, by the two-process method (rerun after the fix round) | every yearly hash identical on 256 × 20 s7 (287,076) and 128 × 15 s7 (**196,101**) |
| The bot's young bulldozes | 359 committed bulldozes on 128 × 15, none of a plopped building under 30 days old, so no row moves and nothing is recorded under "polish" |

The original Codex report follows.

Branch: `local/FH-07a-refunds`. Original base: `a2578da29d8f67d1b218b1ce5e86e3ae7d3f9545`
(W0.2 and B1 merged). This review pass starts at `f1e8b38e445fc67f5a29f490f9f04bcb936abd02`,
the committed refund implementation rebased onto `local/W0.3-5-integration` with W0.3–W0.5 merged.
The follow-up changes are uncommitted; no push or queue completion marker was made.

The reviewed refund rules and every other spend/refund calculation are unchanged: same-day plops and fresh surface
networks refund 100%; plopped buildings at ages 1–29 refund 50%; older assets retain the previous rules. Nothing new
is saved. Existing command/gesture paths, city signals, teardown guards and null views remain intact.

Changes by file:

- `src/sim/actions.ts`: bulldoze results now carry the gross `refund` before fees and optional `refundNote`
  (`built today` or `under 30 days old`). Preview and commit return the same metadata; an affordability failure also
  carries the predicted credit. A note is present only when all refunded value follows that rule; mixed refunds
  show the amount without an age label. `buildingRefund` is now private to the module. The ledger-key comment now
  includes `oneoff:loanRepay`.
- `src/game/tools/Tool.ts`: `resultTip` renders, for example, `Refund §25,000 (built today)`.
- `src/game/tools/ZoneTool.ts`: its bulldoze preview cache includes `state.day`; the existing shared tip renders
  the note. Bulldoze and rezone risk requests forward the preview's refund data.
- `src/game/tools/NetworkTool.ts`: the side-demolition risk request forwards the preview's refund data.
- `src/ui/panels/InfoPanel.ts`: retains the whole demolition preview and forwards its refund data in the risk query.
- `src/worker/queries.ts`: both demolition query handlers accept and forward the plain refund fields.
- `src/game/demolishRisk.ts`: no import from `sim/actions.ts` and no refund-rule recomputation. Value confirmation
  compares `value - refund` against `CONFIRM_COST`. Last power/water source, utility cuts, landmarks/rewards,
  displacement and demolition-fee risks retain their checks. Refund text is appended only to an existing dialog.
- Tests listed below cover the result fields, tips, query handlers/callers, cache boundaries and static import graph.

Validation:

- `npx tsc --noEmit`: passed.
- `git diff --check`: passed.
- Ran the AST-based `staticImportGraph` audit from `tests/worker/hygieneScan.ts` directly with Node. Starting at
  `src/game/CityScene.ts`, it reaches 113 runtime modules, including `SimHost.ts` and `demolishRisk.ts`, and excludes
  `src/sim/actions.ts`. Type-only edges are excluded. `SimHost.ts` retains its non-eager
  `import.meta.glob(['../sim/systems/index.ts', '../sim/actions.ts'])`; no static path loads actions.
- `npx vitest run tests/game/toolsPreview.test.ts --maxWorkers=1`: could not start. Vite's `externalize-deps`
  plugin hit `spawn EPERM` in Windows real-path resolution while loading `vite.config.ts`; no tests executed.
  The remaining Vitest files and full suites are left for the lead, as are all GPU/browser checks. No sandbox
  workaround or browser run was attempted.

Tests added or updated (execution remains unverified here):

- `tests/sim/actions.test.ts`, `CityActions: fresh refunds (FH-07a)`: existing coal age cases now assert gross refund
  and note; paused host commands assert the same-day note; rubble asserts that gross credit is separate from its fee.
- `tests/game/demolishRisk.test.ts`, `demolition refund text (FH-07a)`: supplied refund at ages 0/20/30/31; mixed refund
  without an age label; fully refunded plop without a value confirmation; old plop still confirmed; sandbox silence.
  The old coal assertion that always required the build-value line now requires it only at age 30 or later.
- `tests/game/toolsPreview.test.ts`, `bulldoze refund tips (FH-07a)`: real previews through both `resultTip` and
  `RectTool` at ages 0/20/31; the same cursor position refreshes on days 1 and 30 and stays cached within a day.
- `tests/game/queryReads.test.ts`, `query consumers`: inspector/bulldoze forward gross refund and note; rezone/road
  forward the plain fields into the side-demolition query. Existing cancellation and gesture coverage is retained.
- `tests/worker/queries.test.ts`, `LocalSimHost queries and watches`: demolition query uses the supplied preview
  at ages 0/20/31 even if building age changes before the read; side-demolition query preserves supplied text and
  displacement risk.
- `tests/worker/hygiene.test.ts`: `FH-07a: CityScene reaches SimHost and demolition reads without statically loading
  actions`; `tests/worker/hygieneScan.ts` supplies the static runtime-import traversal used by that regression test
  and the direct audit above.

Bot gate evidence supplied by the lead, not rerun in this sandbox:

- Default bot rows are bit-identical by the two-process method on 256×20 seed 7, ending at **287,076**.
- Default bot rows are bit-identical on 128×15 seed 7, ending at **196,101 in 2015**.
- The 128×15 run made **359 committed bulldozes**. None hit a **plopped building under 30 days old**.
- No changed rows need the `polish` key. These measurements cover the reviewed refund implementation; this follow-up
  does not change the amounts charged or refunded. No new bot comparison was run after the presentation changes.

W1.1b handoff (still required):

- Main's preview has no fresh-cell sets. `Building.age` is also absent from `EXACT_FIELDS`; its presence in a full
  building record does not make it exact between records. Main must mirror age (snapshot age plus elapsed days,
  or the day from `buildingAdded`) as well as fresh network cells, or mark refund predictions provisional.
- This includes **failures**: an underestimated refund can produce an exact `Not enough money` and prevent a valid
  command from being posted. Provisional handling must cover failed bulldoze predictions, not just cost labels
  on successful ones.
- `WORKER_DESIGN.md` §2.8's statement that every `CityActions` preview is replica-safe, and the planned
  `replicaSafe.test.ts` suite, need a bulldoze exception until the missing age/freshness information is mirrored.
- The recovery journal row currently has `{seq, op, args}`. It must carry the **actual refund credited** in the
  bulldoze args, with a **replay-only override in `CityActions.bulldoze`**, for buildings and networks alike
  (`POLISH_PLAN.md` §7.6; `WORKER_DESIGN.md` §4.3). Replay runs at the base's day and must not re-evaluate freshness.
  The result's gross `refund` supplies the amount, separate from demolition/tree fees. The replay override and
  journal encoding are future Worker work; this pass does not expose a player-supplied refund override.

Preserved design choices:

- Rubble of a young plopped building refunds by the same age rule. Its existing rubble demolition fee still applies.
- Fresh networks refund by the cell's current type, never more than was paid today for that fresh component.
  Road/rail crossing components and overlapping power lines have separate freshness sets; touching or upgrading
  an older component does not make it fresh. Downgrade/reorientation charges are not separately refunded.
- Trees planted today still cost **§2 per cell** to bulldoze; their planting cost is not refunded.
- Tree clearing paid at build time is not refunded: **§2 per occupied tree cell, at most §32 for a 4×4 lot**.
- Dezoning refunds nothing. The separate, unwired `bulldozeSubway` path stays at **25%**.
- In a degraded host where actions load but systems fail, buildings never age: a plop stays age zero and refunds
  **100% forever**. This existing failure-mode limitation is documented, not changed in this pass.

Plan/code differences and comments:

- NOTE-030's widened scope closes the prior cursor-tip gap. After W0.3, confirmation reads use queries; their
  documented `{rect, cost}` / `{ids, fee}` argument shapes now also carry optional `refund` and `refundNote`.
- `src/sim/economy/buildings.ts:45` still says `plopped: 0 — no refund either`. Its fee is still zero, but the refund
  statement is stale. The file is outside this lane's owns and was not edited.
- The ledger-key list at `actions.ts:19–20` omitted `oneoff:loanRepay`, which `repayLoan` already writes (line 838 in
  the reviewed source). The comment is fixed; repayment behavior is unchanged.
- The replica-safety and journal gaps above remain future Worker work. All requested code changes in this review
  are implemented; runtime test and browser verification remain blocked or delegated as recorded above.
