export const meta = {
  name: 'render2-final-v2',
  description: 'Render round 2 final: independent art + perf verification (v2) of revise v1 with tooling rebuilt after the container reset; revise both lanes if needed, then verify v3',
  phases: [{ title: 'Verify', detail: 'independent art + perf review' }, { title: 'Revise', detail: 'lanes fix blockers/majors' }],
}

const S = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad'
const SCRATCH = S + '/render2'

const __C = {}
const __R = []
const __NOTE = 'RESUMING: an earlier run of this exact task was interrupted (usage limit, restart or crash). Your scratch dir may hold partial work from it: read it first, keep what is sound (tooling, sides, tables), check the live tree (git -C /home/user/simcityweb diff) for edits it already made, and continue rather than redo.'
async function __A(prompt, opts) {
  const lab = opts && opts.label
  if (lab && Object.prototype.hasOwnProperty.call(__C, lab)) return __C[lab]
  return agent(lab && __R.includes(lab) ? __NOTE + '\n\n' + prompt : prompt, opts)
}

const CTX = `Project: **Metropolis**, a browser 3D city builder ("SimCity 4, but better") at /home/user/simcityweb (Vite 8 + TypeScript 7 + three.js r186, WebGL2). Rendering lives in src/render/world/** (WorldView, Sky, Shadows, TreeRenderer, fallbackTrees, TerrainRenderer, quality.ts) and src/render/city/** (buildings/BuildingRenderer + lodProxy/lodBuilder/lodWorker, common/batch.ts, props/PropRenderer + propLod, vehicles/VehicleRenderer). The goal is a POLISHED, beautiful, smooth game: quality over speed.

STATE: render round 2 is in its final fix loop. Verify v1 (Oct 21) reviewed tree V1 = c30fca4: art PASSED with one minor; perf FAILED with three fresh-load majors and five minors (docs/dev/reports/render2-final_verify-art-v1.md, docs/dev/reports/render2-final_verify-perf-v1.md). Revise v1 then changed both lanes (docs/dev/reports/render2-final_revise-fresh-load-v1.md; docs/dev/reports/render2-final_revise-seasons-final-v1.md — the latter is cut off at about 9,000 characters). The current tree (HEAD) contains revise v1 and has NOT been independently verified yet. READ THESE FOUR REPORTS IN FULL FIRST. Lead notes: docs/dev/STATUS.md.

CONTAINER RESET (Oct 26): every scratch file of earlier rounds is gone — the reviewer tooling (camera-plan shooters, the CPU/GPU A/B drivers, the bench pages for fresh and real-load-path runs), the reference snapshots and shots (F, N, base, c024) and every table. Paths in the reports that point into the old scratch dir no longer exist; the numbers in the reports are still valid history. Rebuild what you need in your own scratch dir. Build each side with: mkdir -p <dir> && git -C /home/user/simcityweb archive <commit> | tar -x -C <dir> && ln -s /home/user/simcityweb/node_modules <dir>/node_modules (the history is unshallowed; if an old side needs an older dependency set, say so). The repo has screenshot helpers you can build on (tools/shoot.mjs, tools/shoot-city.mjs, tools/shoot-ui.mjs, tools/shoot-world.mjs: each starts its own vite server and waits for window.__ready) and demo pages (demo-city.html, demo-ui.html, demo-world.html; the game itself is index.html). The browser is now Chromium 153 (earlier rounds measured on 141), so compare sides only within your own runs.

REFERENCE COMMITS: F = c87d8c8 (art reference, round 3); N = 4b3d074 (round 4); V1 = c30fca4 (what verify v1 reviewed; its render files equal b5eca11); c024 = 02464a3 (gate-2 reference for GPU and triangles); base = the pre-optimisation tree for gate 1. The old base snapshot is lost: rebuild it from a284b80 (parent of 535655d, the first commit with render-perf work) and CALIBRATE it before use — v1 measured V1/base = 0.740 (warm town, pooled moving CPU) and 0.675 (warm dense city); reproduce at least those two with V1 vs your base (±0.05). If a284b80 does not reproduce them, try be48061 and other commits between them, and report which you used and why.

GATES (lead): (1) moving-camera main-thread CPU must not exceed the pre-optimisation base in any scene, including FRESH pages (first zoom-out, first zoom-in, first street-settle after load) — judged with interleaved A/B, a fresh browser per side per rep, CPU time (schedstat), ≥ 8 reps, medians + 90% bootstrap CI + A/A copies. Lead decision (Oct 26): a fresh-page segment is a MAJOR only when the excess is shown — the lower 90% CI bound of new/base above 1.02 with A/A within ±5%; a point estimate above 1.00 whose CI reaches 1.02 or below is reported as a minor with the numbers ('inconclusive'). (2) LOW: no GPU or triangle regression vs c024; HIGH/ULTRA up to +5% where it pays for accepted art (lead decisions: the outer forest ring's draw cost ~0.15-0.3 ms is accepted; single HIGH/ULTRA ring segments up to ~1.12x base are minor if the per-page pooled moving sum is ≤ base and LOW pays nothing; fast edge-flight / cut-sequence main-pass triangles are accepted up to ~+7% HIGH / +12% ULTRA if still views and per-page moving sums stay within +5% and GPU-process sums within +5%). (3) No new frames over 16.7 ms beyond c024 on cuts, zooms and fresh-page first frames.

ENVIRONMENT: 4 cores, 16 GB (cgroup limit about 14.3 GB). Other agents run concurrently (the other reviewer, a sim fix engineer, a sim playtester/auditor with browsers, a long bot run), so the load can be high: never trust a single run; interleave sides; report A/A noise and the load average. Browser: Playwright 1.56 headless chromium (build 153 through a compatibility symlink; plain chromium.launch() works) with --use-angle=swiftshader --enable-unsafe-swiftshader. Use your own vite servers on free ports (not 5173). Give every long-running harness process you start a high OOM score so the kernel kills it before the session: echo 800 > /proc/<pid>/oom_score_adj (children too). Clean up every browser, vite server and background chain you start (check ps -ef) and remove your vite caches when done. Never delete files you did not create.

RULES: the sim team works concurrently in src/sim/**, src/ui/**, src/save/**, src/game/**, src/main.ts, tools/** and tests outside tests/render/**, and it may make TEARDOWN-ONLY edits in src/render (dispose/release paths) — never revert or overwrite those. Edit only the files your role or lane owns. No git state changes (the lead commits). No new npm deps. Develop and measure in your own snapshot (rsync -a --exclude node_modules --exclude .git /home/user/simcityweb/ <scratch>/snap/ && ln -s /home/user/simcityweb/node_modules <scratch>/snap/node_modules); move a change into the live tree only once it type-checks and its tests pass, and only as minimal Edit-tool changes to the live files (re-read each file right before editing; never copy a whole file from a snapshot over a live file); afterwards check git diff shows only your lines. npx tsc --noEmit must be clean and npx vitest run tests/render tests/game must pass. ALWAYS look at the screenshots you take, and make before/after pairs for every visual change. Scratch: ${SCRATCH}/final/<your role or lane>/.`

const VERDICT = {
  type: 'object',
  properties: {
    pass: { type: 'boolean', description: 'true when no blocker or major remains' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lane: { type: 'string', enum: ['seasons-final', 'fresh-load', 'other'] },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          issue: { type: 'string' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['lane', 'severity', 'issue', 'evidence', 'fix'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['pass', 'findings', 'summary'],
}

const LANEMAP = 'Lane mapping for findings: trees, the outer ring, seasons, fallbackTrees, propLod → seasons-final; building LOD/proxies/bulk wake, batch.ts, vehicles, props (PropRenderer), WorldView load/warm-up/shadow/cut code, Shadows.ts, rubble → fresh-load; anything else → other.'

const ART = (round, prev) => `ROLE: independent ART reviewer (render round 2 final, verify v${round}). You did not make these changes. Review the CURRENT tree (HEAD — snapshot it) in context, in the real CityScene (the game itself and the demo pages), at HIGH and LOW, plus MEDIUM and ULTRA where the ring is involved, against F (c87d8c8), N (4b3d074) and V1 (c30fca4, what art v1 passed). Rebuild a deterministic shooter (fixed camera poses, date/season, time of day, climate, quality; a fixed render scale; no dynamic resolution) and camera plans. Look at every image you cite; make side-by-side crops at 2-4x where details matter; back what you see with simple image statistics (luma of the darkest 15%, mean absolute difference, share of pixels changed) and frame-to-frame differences for flights.
MUST cover:
(1) The revise v1 seasons changes: the far-ring micro crown (ringLow) is now a 3-sided barrel crown on a thin trunk (fallbackTrees.ts RING_LOW_*), opening in RING_LOW_VERT by low-camera weight 0.4 (smoothstep), tint 0.80; ringLowSwitch went 1.6 → 1.3 x lodDistance; culling changed (near pairs by submitted-prefix bounds ringNearBox; far blocks: high cameras test from the micro waist ringMicroTopY, no 30 m slack; per-block 4x4 cell bounds ringCellBox for low edge cameras; default views submit no ring work); ringViewSame early-out. Check low cameras near every map edge and corner (N, E, S, W, a corner, along an edge; 300-900 m in; heights 25-240 m) in June, October, January and a tropical climate: copses must reach the horizon like F and read as round dark crowns on trunks (no pale 'spinning tops'); no holes or missing trees from the new culling (also at the far ends of the view, at sector and cell corners, and while the camera turns); no doubled trees; no pops in flights (an edge flight, a rise through the 110-240 m fade, inward, lateral, a corner orbit), especially at the crown-open transition and the 1.3 switch distance. Default views must look like V1 (no ring work there). Fast street pans (ui page, HIGH) with the ring view cache: no stale ring after moves.
(2) The revise v1 fresh-load changes: the load-time warm-up queue (Shadows.loadWarm; batch and vehicle warm-ups run behind the opaque veil), WorldView.warmView hidden far-view renders, the BuildingRenderer LOD warm-up with stand-in proxies on real loads, the installProxy culling-sphere fix (medium quality and up cross-fades), the PropRenderer warm-up sweep with restore. Check the first frames after load on the REAL game load path (main menu → Continue/Load a city) and on the demo pages, at LOW and HIGH: frames 0-6 after the veil (no flashes, no missing or wrong-LOD buildings, no props stuck in a wrong LOD, cars in sane places); the first zoom-out and zoom-in (no pops beyond V1); LOW ↔ HIGH quality switches; medium-quality cross-fades.
(3) A regression sweep of at least 60 cameras (street, default and far zoom; January, April, June, October, November; four climates; dusk, night and dawn; a town, the dense 256 city, the ui town), current vs V1: explain every difference (cars, the intended changes, harness noise) or report it.
(4) The open art minor from v1 (pale far copses): fixed or not.
${LANEMAP}
FINAL ANSWER via the schema: pass (true when no blocker/major remains), findings, summary (what you covered, the evidence paths, and what you could not check). Scratch: ${SCRATCH}/final/artrev-v${round}/.

What changed since the previous review:
${prev}`

const PERF = (round, prev) => `ROLE: independent PERF reviewer (render round 2 final, verify v${round}). You did not make these changes. Measure the CURRENT tree (HEAD — snapshot it) against base (rebuilt and calibrated, see REFERENCE COMMITS), c024 (02464a3) and, where it helps attribution, V1 (c30fca4). Rebuild the harness: bench pages that load deterministic scenes (a small town such as the t_plains town save or the demo-ui town; the dense 256 demo city; the ui page) and drive scripted camera segments (street-settle, first zoom-out street→far over 90 frames, first zoom-in default→street over 60 frames, far orbit, pans, fast pans, cuts), plus the REAL game load path (main menu → Continue/Load a city save → frame-by-frame main-thread CPU for frames 0-30 after viewsReady, through the veil fade). CPU per thread from /proc/<pid>/task/<tid>/schedstat (renderer main thread; GPU-process CPU of a drawn frame as the GPU stand-in); triangles and draw calls from renderer.info. Fresh-page segments: a fresh browser per side per rep, sides rotated, ≥ 8 reps; warm pages: rows interleaved, two browsers per version; medians + 90% bootstrap CIs + A/A copies; report the load average.
MUST cover:
(1) The three v1 majors on the current tree: (a) fresh LOW town first zoom-out vs base; (b) fresh LOW town first zoom-in vs base, and the ui page HIGH fresh first zoom-in (N already had ~1.16x; the seasons lane measured +46 ms from the first ring/band draw); (c) gate 3 on the real load path — frame 2 after viewsReady should be back near 11-15 ms (revise v1 measured 11.2 ms; v1 found 113 ms), with no extra frames over 16.7 / 33 ms vs c024.
(2) What revise v1 could have regressed: the dense-city LOW first zoom-in and far orbit (the fresh-load lane measured +16% / +28% vs V1, still below base) — is it real, and is it still ≤ base; the warm-page matrix (town, dense city, ui × LOW, HIGH, ULTRA; moving segments) ≤ base; ring CPU on edge views; the GPU stand-in and triangles on low edge views vs c024 (gate 2; the ringLowSwitch 1.3 change, the new trunk triangles and the cell culling); LOW triangles and draw calls (still and moving) vs c024; allocations per frame; long frames on cuts, zooms and fresh first frames vs c024 (gate 3); load time to ready and heap (not gated; report).
(3) The fresh dense-city HIGH street-settle (v1: 0.867x base) stays ≤ base.
Apply the lead decision on majors in the GATES exactly. ${LANEMAP}
FINAL ANSWER via the schema: pass (true when no blocker/major remains), findings, summary with tables (ratios, CIs, A/A, reps, load) and the base calibration result. Scratch: ${SCRATCH}/final/perfrev-v${round}/.

What changed since the previous review:
${prev}`

const LANES = [
  {
    key: 'seasons-final',
    files: 'src/render/world/TreeRenderer.ts, src/render/world/fallbackTrees.ts, src/render/city/props/propLod.ts, tests/render/** tree/season/ring tests',
    report: 'docs/dev/reports/render2-final_revise-seasons-final-v1.md',
    notes: 'Lead decisions in force: the ringLow crown shape fix is done (keep LOW and high cameras unchanged); add no triangles unless the per-view GPU stays within +5% of c024. The ui-page HIGH fresh first zoom-in tree share is YOURS (TreeRenderer cost 6-7 ms per first zoom-in at HIGH vs 2-3 ms in base; your revise v1 report has a two-step plan: warm the ring pass at load with synthetic poses, then restore ringViewKey/ringPreload; and have the load-time warm render draw the ring and band meshes once). For step 2 coordinate with the fresh-load lane, which owns WorldView.warmView: expose a small TreeRenderer hook and write what you need into ' + SCRATCH + '/final/COORD.md; read that file for their notes.',
  },
  {
    key: 'fresh-load',
    files: 'src/render/city/common/batch.ts, src/render/city/vehicles/VehicleRenderer.ts, src/render/city/buildings/BuildingRenderer.ts, src/render/city/buildings/lodProxy.ts / lodBuilder.ts / lodWorker.ts, src/render/city/props/PropRenderer.ts, src/render/world/WorldView.ts (load, warm-up, shadow and cut code), src/render/world/Shadows.ts, the rubble builders, tests/render/freshLoad.test.ts and related tests',
    report: 'docs/dev/reports/render2-final_revise-fresh-load-v1.md',
    notes: 'Lead decisions in force: a hidden far-view warm-up render in WorldView during the load (behind the opaque veil) is allowed; work may move into the load, but nothing may run as its own long frame during the veil fade or after it. If the seasons lane needs the warm render to draw the ring and band meshes once, wire its TreeRenderer hook into WorldView.warmView; coordinate through ' + SCRATCH + '/final/COORD.md.',
  },
]

const LANE_BRIEF = (l, round, items) => `ROLE: render lane ${l.key}, revision v${round}. You own: ${l.files}. Independent verifiers found the problems below. Fix every blocker/major at the root; fix minors only if they are safe and cheap; for an item outside your files, say so and describe the fix. Your lane's previous report is ${l.report} (read it first); its old scratch dir was lost in the container reset — start fresh from the live tree (snapshot it) and rebuild the tooling you need. ${l.notes}
ITEMS:
${items.map((f) => '- [' + f.severity + '] ' + f.issue + '\n  evidence: ' + f.evidence + '\n  suggested fix: ' + f.fix).join('\n')}
Measure your change yourself (the same methods and gates as the reviewers: interleaved A/B, a fresh browser per side per rep for fresh pages, ≥ 8 reps, CIs + A/A; before/after screenshots you look at).
FINAL ANSWER: per item — what changed (files and the gist of each change), before/after evidence (screenshot paths you looked at, A/B tables with A/A noise and reps), tsc/tests status, what is now in the live tree, and anything left open or needing the other lane. Scratch: ${SCRATCH}/final/${l.key}/.`

let prev = 'Revise v1 (both lanes) — read docs/dev/reports/render2-final_revise-fresh-load-v1.md and docs/dev/reports/render2-final_revise-seasons-final-v1.md. Since then the sim team added teardown-only dispose changes in src/render for the exit-to-region leak fix (commits up to fa13c85, and possibly more teardown lines while you work); those touch no per-frame or load path.'
const history = []
for (let round = 2; round <= 3; round++) {
  phase('Verify')
  const vs = (await parallel([
    () => __A(CTX + '\n\n' + ART(round, prev), { label: 'verify:art:v' + round, phase: 'Verify', schema: VERDICT }),
    () => __A(CTX + '\n\n' + PERF(round, prev), { label: 'verify:perf:v' + round, phase: 'Verify', schema: VERDICT }),
  ])).filter(Boolean)
  const findings = vs.flatMap((v) => v.findings ?? [])
  const serious = findings.filter((f) => f.severity !== 'minor')
  history.push({ round, verdicts: vs.map((v) => ({ pass: v.pass, summary: v.summary })), findings })
  log('render final verify v' + round + ': ' + vs.length + '/2 reviewers, ' + findings.length + ' findings (' + serious.length + ' blocker/major)')
  if (!serious.length || round === 3) break
  phase('Revise')
  const todo = round === 2 ? findings : serious
  const byLane = LANES.map((l) => ({ l, items: todo.filter((f) => f.lane === l.key || (f.lane === 'other' && l.key === 'fresh-load' && f.severity !== 'minor')) })).filter((x) => x.items.length)
  if (!byLane.length) break
  const fixes = await parallel(byLane.map(({ l, items }) => () => __A(CTX + '\n\n' + LANE_BRIEF(l, round, items), { label: 'revise:' + l.key + ':v' + round, phase: 'Revise' })))
  prev = byLane.map(({ l }, i) => '== lane ' + l.key + ' (revision v' + round + '):\n' + (fixes[i] ?? '(failed)')).join('\n\n')
}
return { history }
