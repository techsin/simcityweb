export const meta = {
  name: 't008-t010-gates',
  description: 'Cloud-side gates for two finished desktop lanes: T010 landmark art (triangles, gallery renders, contact sheets, screenshot diff, independent art review) and T008 audio (FEEL-11/FEEL-12 acceptance via the audio lab, bot, tests), with one fix round',
  phases: [
    { title: 'Gates', detail: 'T010 and T008 gates in parallel; the art review follows T010' },
    { title: 'Fix', detail: 'small fixes as commits, only if a gate or the review needs one' },
  ],
}

const S = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad'
const LOCK = S + '/timing.lock'
const TRAILERS = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01KT9tXthEhyzExdUuGEecAJ'

const __C = {}
const __R = ["gates:t008", "art:t010"]
const __NOTE = 'RESUMING: an earlier run of this exact task was interrupted. Your work dir may hold partial results: read it first and continue rather than redo. Every process of yours from before was stopped.'
async function __A(prompt, opts) {
  const lab = opts && opts.label
  if (lab && Object.prototype.hasOwnProperty.call(__C, lab)) return __C[lab]
  return agent(lab && __R.includes(lab) ? __NOTE + '\n\n' + prompt : prompt, opts)
}

const CTX = `Project: **Metropolis**, a browser 3D city builder (Vite 8 + TypeScript 7 + three.js r186, WebGL2). The owner's Windows desktop worker had Codex write two polish lanes. Its own gates are the bottleneck there, so the cloud runs the gates that need no real GPU and no quiet machine.

TREES (each is a git worktree with its own node_modules dir of links; the dev head is already merged in, and tsc is clean in both):
- T010 = ${S}/t010 (branch t010-gates = local/LG-02-art + the dev head). Seven late-game landmark builders, src/assets/builders/lm_{central_library,grand_central,stock_exchange,botanical_dome,world_trade_center,millennium_tower,metropolis_crown}.ts, their manifest entries in src/assets/manifest.ts, and tests. Task: docs/dev/queue/T010-landmark-art.md.
- T008 = ${S}/t008 (branch t008-gates = local/T008-audio + the dev head). Audio polish: FEEL-11 without sirens (duck, rests between songs, mute in the background), FEEL-12 (surf, seasons and climate in the ambience), and pooled one-shot nodes (src/audio/oneShot.ts). Task: docs/dev/queue/T008-audio-polish.md.
- BASE = ${S}/devbase (the dev head, detached, read-only) for before/after comparisons.

RULES:
- Commit only in your own tree, and only if your role says so, with messages ending in:
${TRAILERS}
- Never push. Never touch /home/user/simcityweb or any other worktree. Put scratch files under ${S}/<your role>work/.
- This machine has 4 cores and other workflows run timing measurements on it. Take the lock before every browser run,
  bot run or full vitest: \`until mkdir ${LOCK} 2>/dev/null; do sleep 15; done\`, and \`rmdir ${LOCK}\` right after,
  also on failure. Never hold it for more than about 15 minutes at a time: split long runs.
- The cloud's Chromium is Playwright's headless_shell with software GL (--use-angle=swiftshader
  --enable-unsafe-swiftshader). Rendering is slow but correct. Use your own vite servers on free ports (not 5173),
  and stop every browser and server you start.
- ALWAYS look at the images you produce, and cite their paths.`

const GATES = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
    tables: { type: 'string', description: 'every gate with its numbers' },
    artifacts: { type: 'string', description: 'paths of contact sheets, renders, logs' },
    summary: { type: 'string' },
  },
  required: ['pass', 'failures', 'tables', 'artifacts', 'summary'],
}
const VERDICT = {
  type: 'object',
  properties: {
    pass: { type: 'boolean', description: 'true when no blocker or major remains' },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, item: { type: 'string' }, issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'item', 'issue', 'evidence', 'fix'] } },
    summary: { type: 'string' },
  },
  required: ['pass', 'findings', 'summary'],
}
const FIX = { type: 'object', properties: { commits: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, left: { type: 'string' } }, required: ['commits', 'summary', 'left'] }

const T010_GATES = `ROLE: GATES for T010 (the landmark art) in ${S}/t010. Do not change src or tests. Read docs/dev/queue/T010-landmark-art.md (its gates), LG-02's table of seven rewards in docs/POLISH_PLAN.md, and the manifest header in src/assets/manifest.ts (triangle budgets: landmarks ≤ 8,000).
1. npx tsc --noEmit; the full npx vitest run (with the lock), with no failures and no unhandled errors.
2. Triangle counts for each model, variant and LOD level, against the budget. Build the geometry in node as the tests do, or in the gallery. Give one table.
3. Gallery renders: gallery.html shows every new model and variant by day, at night and in winter, at street and default zoom. Build one contact sheet per model (ImageMagick montage, JPEG quality 80, about 1600 px wide) under ${S}/t010work/sheets/. Look at every sheet.
4. Existing art unchanged: screenshot diffs of at least four existing landmarks in the gallery, plus the town and dense-city demo renders (tools/shoot-city.mjs or demo-city.html at fixed cameras), between BASE (${S}/devbase) and T010. 0 changed pixels outside the new models, or explain each difference.
5. Check that the manifest registration is its own commit, as the task asks. The lead merges it after graphics round 2 closes.
pass is true only when every gate passes.`

const T010_ART = (g) => `ROLE: independent ART REVIEWER for T010's seven late-game landmarks. You did not make them. Read LG-02 in docs/POLISH_PLAN.md (the seven rewards and what each should feel like), the existing landmark builders for the house style (src/assets/builders/landmark.ts, lm_halls.ts, lm_lib.ts, lm_towers.ts: materials, LOD, night windows), and the new builders in ${S}/t010. The gates agent made contact sheets and renders. Look at all of them, and render more in the gallery if you need other angles (take the lock).
For each model, judge:
- whether it reads as what it is meant to be at default zoom;
- whether it fits the style and scale of the existing landmarks and the city;
- the silhouette at night, and in winter;
- the variants;
- the LOD transitions (no popping silhouettes);
- anything broken: holes, z-fighting, inverted faces, floating parts, wrong materials.
Severity: blocker = broken or unrecognisable; major = clearly off-style or off-scale, or a visible defect at default zoom; minor = polish.
The gates reported (JSON): ${JSON.stringify(g).slice(0, 6000)}`

const T008_GATES = `ROLE: GATES for T008 (the audio polish) in ${S}/t008. Do not change src or tests. Read docs/dev/queue/T008-audio-polish.md, docs/POLISH_PLAN.md FEEL-11 and FEEL-12 (around lines 2747-2810, their Acceptance lists) and §7.5 (the settings).
1. npx tsc --noEmit; the full npx vitest run (with the lock), with no failures and no unhandled errors.
2. The bot: \`npx tsx tools/simbot.ts --size 128 --years 15 --seed 7\` must print 2015 residents [59288, 95301, 41512] (196,101), because audio must not touch the sim.
3. FEEL-11 (without sirens) and FEEL-12 acceptance, item by item, with tools/render-audio.mjs and the audio lab (audio-lab.html, src/audio/lab/). Render the relevant queries, read the stats JSON, look at the PNGs, and measure each acceptance number:
   - the duck levels and timing;
   - the rests between songs, and none in menus;
   - background mute within 1 s, with the engine suspended and resumed;
   - the surf from the water sample;
   - the season and climate rules.
   Where the lab cannot show an item, use the unit tests' instrumented mocks (tests/audio/*) and say so.
4. The pooled one-shot nodes: show from tests/audio/nodeCosts.ts, or a lab run, how many node-finish and handler-deletion tasks a burst of sounds creates before and after. The desktop measures the real-GPU load-path trace later; do not try it here.
pass is true only when every gate passes.`

phase('Gates')
const [t010, t008] = await parallel([
  async () => {
    const g = await __A(CTX + '\n\n' + T010_GATES, { label: 'gates:t010', phase: 'Gates', schema: GATES })
    const art = g ? await __A(CTX + '\n\n' + T010_ART(g), { label: 'art:t010', phase: 'Gates', schema: VERDICT }) : null
    return { g, art }
  },
  () => __A(CTX + '\n\n' + T008_GATES, { label: 'gates:t008', phase: 'Gates', schema: GATES }),
])

const needT010 = t010 && ((t010.g && !t010.g.pass) || (t010.art && t010.art.findings.some((f) => f.severity !== 'minor')))
const needT008 = t008 && !t008.pass
let fix010 = null, fix008 = null
if (needT010 || needT008) {
  phase('Fix')
  const fixes = await parallel([
    () => needT010 ? __A(CTX + '\n\n' + `ROLE: FIXER for T010 in ${S}/t010. Fix every failed gate and every blocker or major below with small commits in that tree (messages ending in the trailer lines). Then re-run the affected gates, including new renders, contact sheets you look at, tsc and the tests the change touches. If a fix needs the art itself redone at a scale you cannot do well, say so precisely instead. Report what you changed and what is left.\nGATES: ${JSON.stringify(t010.g).slice(0, 5000)}\nART REVIEW: ${JSON.stringify(t010.art).slice(0, 7000)}`, { label: 'fix:t010', phase: 'Fix', schema: FIX }) : null,
    () => needT008 ? __A(CTX + '\n\n' + `ROLE: FIXER for T008 in ${S}/t008. Fix every failed gate below with small commits in that tree (messages ending in the trailer lines). Then re-run the affected gates and the full vitest (with the lock). Report what you changed and what is left.\nGATES: ${JSON.stringify(t008).slice(0, 7000)}`, { label: 'fix:t008', phase: 'Fix', schema: FIX }) : null,
  ])
  fix010 = fixes[0]; fix008 = fixes[1]
}
return { t010, t008, fix010, fix008 }