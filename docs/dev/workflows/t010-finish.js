export const meta = {
  name: 't010-finish',
  description: 'T010 landmarks: pendingCatalog (NOTE-034), the builders and their registration, the art review fixes, gates, independent art and code checks, one fix round',
  phases: [{ title: 'Build' }, { title: 'Verify' }, { title: 'Fix' }],
}

const S = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad'
const W = S + '/t010f'
const WORK = S + '/t010finish'
const LOCK = S + '/timing.lock'
const __C = {}
const __R = []
const __NOTE = 'RESUMING: an earlier run of this exact task was interrupted (usage limit, restart or crash). Your scratch dir under ' + WORK + ' may hold partial work from it: read it first, keep what is sound, check git -C ' + W + ' log and status for commits or edits it already made, and continue rather than redo. Kill any browser, vite server or background process of yours from before the interruption first, and remove ' + LOCK + ' only if you can tell it is yours and stale.'
async function __A(prompt, opts) {
  const lab = opts && opts.label
  if (lab && Object.prototype.hasOwnProperty.call(__C, lab)) return __C[lab]
  return agent(lab && __R.includes(lab) ? __NOTE + '\n\n' + prompt : prompt, opts)
}

const TRAILERS = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01KT9tXthEhyzExdUuGEecAJ'

const CTX = `Project: **Metropolis**, a browser 3D city builder (Vite 8 + TypeScript 7 + three.js r186; procedural low-poly building models in src/assets/builders/**, listed in src/assets/manifest.ts; the sim's catalog defs in src/sim/catalog*.ts name the models the game can place). Tests are vitest (\`npx vitest run --configLoader runner\`); type check \`npx tsc --noEmit\`.

WHERE YOU WORK: a scratch git worktree W = ${W} (branch t010-finish, local only; node_modules is a symlink, never delete through it). Its base is the dev head f69166d. Never push, never touch the main checkout /home/user/simcityweb or any other worktree, and never delete files you did not create. Commit in W with clear messages ending with these two trailer lines exactly:
${TRAILERS}
Never put a model name or model id in a commit, a code comment or a report.

TASK BACKGROUND (T010, LG-02's seven late-game landmarks): the desktop wrote seven landmark builders and their registration on origin/local/LG-02-art: 564c851 (seven new builder files + three tests, green on its own) and a1cef4c (registers lm_central_library, lm_grand_central, lm_stock_exchange, lm_botanical_dome, lm_world_trade_center, lm_millennium_tower, lm_metropolis_crown in the manifest and the builder index). The cloud's gates and an independent art review ran on them:
- ${WORK}/inputs/gates_t010.json: the gates (tsc and vitest, triangles per model/variant/LOD with the method, gallery renders and contact sheets, the screenshot diff of existing art, the registration commit's structure). Gate 1 failed only because tests/sim/catalog.test.ts "has a def for every building model of the manifest" needs a CATALOG def for each new id, and LG-02's catalog defs are round-3 content.
- ${WORK}/inputs/art_t010.json: the independent art review: 1 MAJOR (every Stock Exchange setback roof z-fights: each tier's RoofFlat cap and the cornice box cap at the same y1, about 1,000 m2 of exactly coplanar overlap per variant) and 10 minors, each with evidence paths and a suggested fix.
- Harness tools that worked last time (read them before writing new ones): ${S}/t010work/bin (shoot.mjs gallery shooter, tris.mjs triangle counts, hashes.mjs geometry hashes of every model variant, sheets.sh contact sheets, diffs.sh screenshot diffs, withlock.sh) and its jobs/ JSON; ${S}/artreviewwork/bin (geom.mjs, the coplanar-overlap scan between different paints; shoot.mjs; lodswap.sh; checktransform.mjs).

THE MECHANISM (docs/dev/queue/NOTE-034 and NOTE-040, read both): a manifest entry may carry \`pendingCatalog?: string\` (an item id such as 'LG-02'): its art is final and in its real group, and its catalog def lands with that item. catalog.test's def check skips those entries; a guard test fails if a pending entry already has a catalog def (so the flag is removed when the def lands) and if a pending entry is outside the building groups that test checks. No game-side filter: the game only ever offers catalog defs, and demo.ts filters R/C/I. T035's STUB entries stay in the 'placeholder' group, unchanged.

SHARED MACHINE: other cloud jobs run timing measurements. Take ${LOCK} (mkdir mutex; withlock.sh does this) for every browser run and every full vitest run, hold it only while running, and release it at once. Use your own vite servers on free ports (not 5173). Clean up every browser, server and background process you start. ALWAYS look at the screenshots you take, and cite their paths.`

const BUILD = { type: 'object', properties: {
  commits: { type: 'array', items: { type: 'string' } },
  fixed: { type: 'array', items: { type: 'string' }, description: 'each art-review finding fixed: finding, what changed, the evidence that it is fixed' },
  accepted: { type: 'array', items: { type: 'string' }, description: 'each finding left as is, with the reason' },
  gates: { type: 'string', description: 'every gate with its numbers, as markdown tables' },
  report: { type: 'string', description: 'path of docs/dev/reports/cloud-T010-art.md in W' },
  summary: { type: 'string' },
}, required: ['commits', 'fixed', 'accepted', 'gates', 'report', 'summary'] }

const VERDICT = { type: 'object', properties: {
  pass: { type: 'boolean' },
  findings: { type: 'array', items: { type: 'object', properties: {
    severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, item: { type: 'string' }, issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
  }, required: ['severity', 'item', 'issue', 'evidence'] } },
  summary: { type: 'string' },
}, required: ['pass', 'findings', 'summary'] }

const BUILD_PROMPT = `ROLE: IMPLEMENTER for T010 in W. Steps, in order, each its own commit:
1. **pendingCatalog** exactly as THE MECHANISM says: the field with a doc comment on ManifestEntry, catalog.test's skip, the guard test (both conditions), nothing else.
2. **Bring in T010:** cherry-pick 564c851 and a1cef4c (git -C ${W} fetch is not needed: both are in the shared object store), then mark the seven new entries \`pendingCatalog: 'LG-02'\`. catalog.test must pass.
3. **Fix the art review** (${WORK}/inputs/art_t010.json; read every finding and its evidence first):
   - the MAJOR, the Stock Exchange's setback roofs in both variants: no two different paints may be coplanar or within 1 cm of each other where both are visible; separate them by construction (drop or inset the hidden cap, or lift the cornice cap), not by a z-offset hack;
   - the geometric minors: the WTC tower roofs and setbacks (the same construction), Grand Central's vault-foot strips (v1, and v0 where it applies; offset along the surface normal, not only in y), the Crown v1 top tier's ribs on the chamfer vertices;
   - the cheap visual minors: the Stock Exchange bull's paint (bronze, not verdigris) and its horns; the tower tops at night (WTC roof and mast, the Millennium needle, the Crown's crown: night-only emissive accents in the house style, so each top reads at night); the Botanical Dome's single-pane sun flash (shade panes so one flat pane cannot flash white at street zoom);
   - the rest (variant distinctness, the library reading as a second city hall, the WTC's height against com_megatower, the generic LOD proxy): change only where a contained change clearly fixes it inside the budgets, and check docs/POLISH_PLAN.md's LG-02 spec before changing any height or footprint; otherwise list each under 'accepted' with the reason.
   Budgets that must hold: LOD 0 <= 8,000 triangles, LOD 1 <= 200 and <= 50 % of LOD 0, heights inside each entry's manifest range, every model inside its lot, house conventions as the review lists them.
4. **Gates** (tables in the report):
   - tsc;
   - the full vitest;
   - the triangle table for all 14 variants at LOD 0 and LOD 1;
   - geom.mjs on all 14 variants: no coplanar or sub-centimetre overlap between different paints;
   - gallery renders of every changed model and variant by day, at night and in winter at default and street zoom, plus close-ups of each fixed spot. Make contact sheets and look at every one;
   - existing art unchanged: geometry hashes of every other model variant identical to the base, and 0 changed pixels on the old landmarks' gallery pages and the demo-city shots, using last time's jobs.
5. **Report** at docs/dev/reports/cloud-T010-art.md in W, committed: what changed per finding (fixed or accepted, with the reason), every gate table, and the sheet paths.
Return the schema.`

const ART_VERIFY = (b) => `ROLE: independent ART verifier for T010's fix round. You did not make these changes. The implementer reports:\n${JSON.stringify({ fixed: b.fixed, accepted: b.accepted, summary: b.summary })}\nCheck W's branch t010-finish against its base f69166d, and against the original review in ${WORK}/inputs/art_t010.json:
1. The MAJOR: rerun geom.mjs on both Stock Exchange variants, render close-ups of every setback roof, and view the demo city from about 520 m. The roofs must not split or shimmer. Make a frame-to-frame difference over a short camera move if a still cannot settle it.
2. Every other finding: is each one fixed, or accepted for a sound reason? Is any acceptance a dodge?
3. New defects from the changes: holes, floating parts, wrong materials, night or winter breakage, LOD swaps, budget breaches.
4. Existing art unchanged: spot-check the old landmarks and one demo-city view against the base.
Severity is blocker, major or minor. pass = no blocker and no major. Cite every image path you looked at. Return the schema.`

const CODE_VERIFY = (b) => `ROLE: independent CODE reviewer for T010's mechanism and registration in W (branch t010-finish, base f69166d). You did not write it. The implementer reports: ${b.summary}
Review the diff of src/assets/manifest.ts, tests/sim/catalog.test.ts, any new tests, and the builder index:
- Is \`pendingCatalog\` typed and documented as NOTE-034 and NOTE-040 say?
- Does the skip apply only to pending entries?
- Does the guard test really fail when a pending entry gains a def, and when one sits outside the building groups? Prove both: make each failure happen in a throwaway edit, then revert it.
- Is there a game path that could offer or place a manifest-only model? Search every MANIFEST and manifestByGroup consumer.
- Do the seven entries carry the flag?
- Are T035's placeholder entries untouched?
Run tsc and the asset, catalog and render tests. Taking ${LOCK} for the full vitest is optional. pass = no blocker and no major. Return the schema.`

phase('Build')
const build = await __A(CTX + '\n\n' + BUILD_PROMPT, { label: 'build', phase: 'Build', schema: BUILD })
if (!build) { log('build returned nothing; stopping so a resume reruns it'); return { stopped: 'build' } }

phase('Verify')
const [art, code] = await parallel([
  () => __A(CTX + '\n\n' + ART_VERIFY(build), { label: 'verify:art', phase: 'Verify', schema: VERDICT }),
  () => __A(CTX + '\n\n' + CODE_VERIFY(build), { label: 'verify:code', phase: 'Verify', schema: VERDICT }),
])
const blocking = [art, code].filter(Boolean).flatMap((v) => v.findings.filter((f) => f.severity !== 'minor'))
let fix = null, reverify = null
if (blocking.length || (art && !art.pass) || (code && !code.pass)) {
  phase('Fix')
  fix = await __A(CTX + '\n\n' + `ROLE: IMPLEMENTER, fix round for T010 in W. Fix every blocker and major below, plus minors where the fix is clear and contained; rerun the gates they touch (and always tsc plus the full vitest under the lock); update the report; commit. Findings:\n${JSON.stringify(blocking)}\nAll verifier minors, for reference:\n${JSON.stringify([art, code].filter(Boolean).flatMap((v) => v.findings.filter((f) => f.severity === 'minor')))}\nReturn the schema.`, { label: 'fix', phase: 'Fix', schema: BUILD })
  if (fix) reverify = await __A(CTX + '\n\n' + `ROLE: independent RE-VERIFIER for T010 after a fix round. You did not write the code. For each finding below, check that the fix in W holds, with your own renders and geom.mjs for art findings and your own tests for code findings; look for regressions the fix introduced. Findings:\n${JSON.stringify(blocking)}\nThe fix round reports: ${fix.summary}\nReturn the schema.`, { label: 'reverify', phase: 'Fix', schema: VERDICT })
}
return { build, art, code, fix, reverify }
