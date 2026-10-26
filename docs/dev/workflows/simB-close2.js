export const meta = {
  name: 'simB-close2',
  description: 'Sim-depth B close-out round 2+: fix the c2 audit major (an inspector click keeps the previous city alive) and all c2 minors, restore test cities and WASM fixtures after the container reset, then independent real-input playtest + adversarial audit, loop until clean',
  phases: [{ title: 'Fix', detail: 'fix c2 (major + minors) and the test-city/fixture tooling lane' }, { title: 'Verify', detail: 'independent real-input playtest + adversarial audit' }],
}

const S = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad'
const SCRATCH = S + '/simB'
const CITIES = S + '/cities'

const __C = {}
const __R = []
const __NOTE = 'RESUMING: an earlier run of this exact task was interrupted (usage limit, restart or crash). Your scratch dir may hold partial work from it: read it first, keep what is sound, check the live tree (git -C /home/user/simcityweb diff) for edits it already made, and continue rather than redo.'
async function __A(prompt, opts) {
  const lab = opts && opts.label
  if (lab && Object.prototype.hasOwnProperty.call(__C, lab)) return __C[lab]
  return agent(lab && __R.includes(lab) ? __NOTE + '\n\n' + prompt : prompt, opts)
}

const CTX = `Project: **Metropolis**, a browser 3D city builder ("SimCity 4, but better") at /home/user/simcityweb (Vite 8 + TypeScript 7 + three.js r186, WebGL2). Simulation in src/sim, UI in src/ui, game glue and tools in src/game, saves in src/save, rendering in src/render. The goal is a POLISHED, feature-complete, fun game: quality over speed.

STATE: sim-depth part B is in its close-out. Fix rounds 1-4 are independently verified. Close-out round c1 (a real-input playtest + an adversarial code audit) found the exit-to-region scene leak and several minors; fix c1 fixed all seven items (report: docs/dev/reports/simB-close_fix-c1.md). Close-out verify c2: the playtest found no blocker/major and 4 minors (docs/dev/reports/simB-close_verify-playtest-c2.md); the audit confirmed every round-4 and c1 fix except one MAJOR (an inspector click keeps the previous city alive after exit-to-region) and found 2 more minors (docs/dev/reports/simB-close_verify-audit-c2.md). READ THESE THREE REPORTS IN FULL FIRST. Lead notes: docs/dev/STATUS.md.

CONTAINER RESET (Oct 26): the session container was reset after round c2. Every scratch file of earlier rounds is gone: drivers, probes, bundles, heap snapshots, browser profiles and the big test cities ('Vet y21' 304k on a 256 map, r3_y43 991k). Paths in the reports that point into the old scratch dir no longer exist. Rebuild what you need in your own scratch dir. Shared test cities are (re)generated into ${CITIES} by a tooling lane; each finished city has a <name>.READY marker file next to it (see that lane's report or the files themselves).

ENVIRONMENT: 4 cores, 16 GB (cgroup limit about 14.3 GB). Other agents (render art + perf reviewers, the other lane, bot runs) work concurrently, so the load can be high: never trust a single timing; prefer CPU time and counts over wall time. Browser: Playwright 1.56 headless chromium (build 153 through a compatibility symlink; a plain chromium.launch() works) with --use-angle=swiftshader --enable-unsafe-swiftshader; start your own vite dev server on a free port (not 5173). Give every long-running harness process you start (vite, chromium, drivers, bots) a high OOM score so the kernel kills it before the session: echo 800 > /proc/<pid>/oom_score_adj (children too). Clean up every process you start (check ps -ef) and remove your vite caches and browser profiles when done. Never delete files you did not create.

RULES: the render team works concurrently in src/render/** and tests/render/** (render round 2 verify/revise). You own src/sim/**, src/ui/**, src/game/**, src/save/**, src/main.ts, tools/simbot.ts and tests outside tests/render/** (tests/wasm/** only where your brief says so). In src/render the lead allows TEARDOWN-ONLY edits (dispose/release paths; nothing drawn and nothing per-frame changes). Live-tree edits: minimal Edit-tool changes only; re-read a file right before each edit; never copy a whole file from a snapshot over a live file; afterwards check that git diff shows only your intended lines and that you removed nothing another team wrote. No git state changes (the lead commits). No new npm deps. Keep the live tree working at every moment (others snapshot it for playtests). Gates: npx tsc --noEmit clean; npx vitest run passes (on a quiet machine the whole suite takes about 95 s; under load use --testTimeout=900000 and re-run any wall-clock failure alone); the 128x15 seed-7 bot (npx tsx tools/simbot.ts --size 128 --years 15 --seed 7) stays bit-identical at 194,432 residents in 2015 unless an item requires a behaviour change (then say so); old saves load and continue. Browser checks use REAL mouse and keyboard input (page.mouse / page.keyboard); use page.evaluate only to read state or for a declared test setup. ALWAYS look at the screenshots you take and cite their paths.`

const FIX2 = `ROLE: fix engineer, close-out round 2. Fix every item below at the root. The minors are in scope this round: this is the close-out, and each is small and well understood.

MAJOR
1. Exit to region still keeps the whole previous city alive after one inspector click. Cause (audit c2, heap-snapshot proven): module-level caches 'let bctx: TermCtx' in src/sim/economy/desirability.ts (about l.610, filled at l.682 by termCtx, l.244-274, which stores st, rt and the TrafficSystem) and the LvCtx cache in src/sim/economy/landValue.ts (about l.562/573). InfoPanel calls desirabilityBreakdown / landValueBreakdown for every inspected growable. Retainer path: module Context --bctx--> TermCtx --traffic--> TrafficSystem --init closure--> CityScene (CityScene.guardSystem wraps every system method in a closure over the scene) → HUD, banners, toolbar, observers, canvases. The auditor validated a fix in a private snapshot (WeakMap keyed by the runtime): 0 CityScene retained, region heap 40 MB. Fix it so results stay identical (bot bit-identical). Then SWEEP for the same pattern: any module-level variable (let/const caches, Maps, last-argument memos, singletons, listener registries) that can hold a CityState, an economy runtime, a system, a CityScene, a DOM node, a canvas or a renderer after exit-to-region, in src/sim, src/ui, src/game, src/save and src/render (render: teardown-only fixes; describe anything bigger). Fix every one you find. Add a node regression test in the style of tests/render/exitRetention.test.ts (WeakRef + gc; see how that test gets gc): call desirabilityBreakdown and landValueBreakdown (and any other cache you fixed) on a city, drop the city, require the CityState and the runtime to be collected. Prove it in the browser with a CDP probe (HeapProfiler.collectGarbage, then Runtime.queryObjects on the CityScene / WebGLRenderer / HTMLCanvasElement prototypes, or a heap snapshot with retainer paths) over 3 exit/re-enter cycles in which each visit clicks the Query tool on several buildings (growable R, C and I, a service, a utility), opens the inspector's WHY? section, opens every panel and data view once, uses each tool family once (zone, road, plop, bulldoze, dispatch), then saves and exits to the region: 0 previous CityScene, renderers/canvases/contexts back to the region baseline, heap flat across cycles. Develop on a small city; do one run on a big city (≥ 250k): use ${CITIES}/vet_s7_y21.region.metropolis (Load Region → import → Play) once ${CITIES}/vet_s7_y21.READY exists (the tooling lane is generating it concurrently; poll every few minutes while you work on the other items; if it is not there after 2 hours, use the biggest city you can build yourself).

MINORS (fix each; small, local, tested)
2. [ui] EmergencyBanner at 1366x650: after a centre panel (Budget, key M) is opened and closed the stack stays all-compact (no pill; the place line, busy reason and 'Choose station…' are lost) and never recovers. dock() caches b.fullH only while a banner is shown full and at the stack width of that moment, and fitRows compares heights measured at another width (playtest c2 finding 1). Store the width with each cached height and treat a mismatch as unknown (fresh measure or default), or clear the cached heights when the docked width changes.
3. [ui] A press held longer than PRESS_HOLD_MS (1.5 s) on a banner button while a flyout is open loses the click at 1366x650: the hold cap releases the deferred dock and the button moves away (playtest c2 finding 2). Keep the dock frozen until pointerup / pointercancel / lostpointercapture / window blur instead of a fixed cap, or setPointerCapture on the pressed button so the release still clicks it.
4. [ui] The c1 settle guard is global and silent (audit c2 finding 2): a press on a banner that did not move is dropped; rapid triage (Send nearest every 300 ms) loses every other click. Limit the guard to banners whose own slot moved (layout() already computes positions without a layout read, so it can record which ids moved), skip it when only rows below the pressed banner changed, and give feedback when a press is ignored (the denied UI sound and/or a brief 'settling' flash) so the player knows to click again. Keep the c1 protection: a press on a banner that just moved under the pointer must never dispatch a different banner.
5. [ui, pre-existing] With every banner dismissed, the 'N more emergencies need you' pill is never docked (dock() returns early when banners.size is 0) and covers a centred panel's title row (audit c2 finding 3). Dock the pill-only case like the stack (beside or below panel header rows); add a uiStacking/banner test for it.
6. [game] During an earthquake with the game paused, CityScene.feedShake keeps shaking the camera forever (it never checks sim.speed), so a plop preview and its click pick different cells ('Blocked by a road or rail') (playtest c2 finding 3). Do not start new shakes while paused or while the pause menu is open (let the current one fade out); also make PlopTool.down() commit the last previewed placement when the pointer has not moved since that preview.
7. [ui] The minimap 'Unsaved changes' / 'Saved' chip (inside .minimap, z-index 20) shows through the bottom of tall right-docked translucent panels (panel layer z 30) at 1280x720, over the clinic inspector's Patients row and the last Advisors card (playtest c2 finding 4). Pick the cleanest fix (hide or move the chip while a panel overlaps it, clamp right-docked panel heights above the minimap block, or an opaque panel bottom); screenshots before/after.
8. [ui, left open by c1] src/ui/thumbs.ts, the toolbar thumbnail renderer: each 15 s idle cleanup leaves its renderer and canvas reachable through three.js dispose listeners on the shared building material and the registry geometries it drew (after a UI session the city had 7 extra renderers). Release what it drew before renderer.dispose() (dispose the geometries it uploaded and its material bindings, or draw thumbnails with private clones); verify with the probe.
POLISH (do these if small and safe): the pill says 'open Emergencies' while that panel is already open; Emergencies-panel rows keep an enabled Dispatch button when every unit is busy (disable it and show the busy reason as its title); an imported region shows no thumbnail in Load Region.

VERIFY every item: a test that fails on the old code and passes now wherever practical; real-input browser checks at 1280x720, 1366x650 and 1920x1080 with screenshots you look at; tsc; the full vitest run; the 128x15 seed-7 bot bit-identical. FINAL ANSWER: per item — root cause, files and line ranges changed, evidence (test names, screenshot and log paths), and anything left open; then tsc/vitest/bot results. Scratch: ${SCRATCH}/close-fix-c2/.`

const TOOLS = `ROLE: test-tooling engineer. The container reset deleted the shared test cities and the WASM test fixtures. Restore them so that the next reset only needs one command. You own, for this task: tools/simbot.ts, new files under tools/, path defaults in tests/wasm/** and tools/bench/** (not test logic), package.json scripts, .gitignore and docs/dev/TEST_CITIES.md. Another agent (the fix engineer) edits src/sim, src/ui and src/game concurrently: do not touch those.

1. tools/simbot.ts: add --save-years <y1,y2,…> with --save-prefix <path> so one bot run writes .metropolis saves at the end of each listed year, using the game's own save code (src/save: check how the game saves a city and how a region file wraps its cities). Write both forms per year: <prefix>y<N>.city.metropolis (loads in node with unpackFile + deserializeCity, the way tools/bench/roadTransitSearch/fixtures.ts loads fixtures) and <prefix>y<N>.region.metropolis (importable in the game via Load Region → import → Play). Saving must not change the simulation: the 128x15 seed-7 run must stay bit-identical (194,432 in 2015) and its printed yearly table byte-identical with and without the save options (diff them). Add a --help entry. Check that a saved city loads in node and in the browser (import it with real clicks, look at a screenshot of the loaded city).
2. Generate the shared cities into ${CITIES} (create it) and write <name>.READY after each finished pair so other agents can wait for it:
   - small: 128 map, seed 7, 10 years → small_s7_y10.{city,region}.metropolis (do this first)
   - vet: 256 map, seed 7, ONE run saving years 21 and 43 → vet_s7_y21.* (about 300k) and vet_s7_y43.* (about 1M). Write vet_s7_y21.READY as soon as year 21 is saved, before the run goes on.
   Run the 256 job in the background with nice -n 5 and the OOM guard, and report actual populations, run times and file sizes.
3. WASM test fixtures: tests/wasm/{roadTransitSearch,trafficCore,servicesTierEngine}.test.ts and tools/bench/** default to the deleted path /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/profile/{fixtures,snap}, so their 1M tests now skip. Make the default a repo-relative, gitignored directory (for example tools/bench/.fixtures/{fixtures,snap}; SIM_FIXTURES / SIM_SNAP keep overriding it) and add 'npm run fixtures' (tools/makeFixtures.mjs or .ts) that rebuilds them: snap = git archive 24f8609 extracted plus a node_modules symlink (check exactly what trafficCore.test.ts imports from SNAP; the history is unshallowed, so 24f8609 exists); dense1m_s7.metropolis = a ~1.1M-resident city (the vet run's year 43 or a longer run; report population and road nodes); stress1m_testdefs_s7.metropolis if it can be rebuilt reproducibly from tests/infra/cityGen.ts (read how the benches and tests describe it; if it cannot, say so and leave that test skipping). Then run the WASM tests and the full npx vitest run: report which previously skipped tests now run and whether they pass (files/tests passed, skipped, failed). If a previously skipped test fails on the rebuilt fixtures, find out why (fixture difference or a real bug) and report it with evidence; do not change test logic.
4. Write docs/dev/TEST_CITIES.md: how to regenerate everything (commands, run times on this machine, populations, file sizes, where the files go).
FINAL ANSWER: files changed, commands, populations, run times, file paths of every city and fixture, test results. Scratch: ${SCRATCH}/tooling/.`

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          area: { type: 'string' },
          evidence: { type: 'string' },
          suggestedFix: { type: 'string' },
          files: { type: 'string' },
        },
        required: ['title', 'severity', 'area', 'evidence', 'suggestedFix', 'files'],
      },
    },
  },
  required: ['summary', 'findings'],
}

const PLAYTEST = (round, fixText) => `ROLE: independent real-input PLAYTESTER (close-out round c${round}). You did not make these changes. Snapshot the live tree into your scratch dir (rsync -a --exclude node_modules --exclude .git /home/user/simcityweb/ <dir>/ && ln -s /home/user/simcityweb/node_modules <dir>/node_modules) and play it in vite + headless chromium with REAL mouse and keyboard input. Re-check every item of the latest fix report (below) as a player would, plus the c1 and round-4 fixes that touch the same code, and hunt for BLOCKER/MAJOR regressions anywhere you go:
(1) Exit-to-region leak: in the big city (${CITIES}/vet_s7_y21.region.metropolis via Load Region → import → Play; see the tooling report for the exact files) and in a fresh small city: query several buildings (growable, service, utility), open the inspector's WHY? section, open every panel and data view once, use each tool family once, then Save & exit to region; repeat 3 times. Measure with CDP (HeapProfiler.collectGarbage, then Runtime.queryObjects for the CityScene / WebGLRenderer / HTMLCanvasElement prototypes, or a heap snapshot): the previous city must be gone and the heap flat across cycles.
(2) Emergency banners vs flyouts and panels at 1280x720, 1366x650, 1920x1080 and 1024x600, with a real quake burst and at least 9 dispatchable banners (set config.disasters=true as a declared test setup if needed): every flyout and every tab; centre panels (Budget, Rewards, Statistics) opened and closed — at 1366x650 the stack must return to its full layout with the pill; press-holds of 0.3, 1.2, 2.5 and 4 s while a flyout closes; rapid triage (Send nearest every 300 ms on banners that did not move) must not lose clicks; a press on a banner that just moved under the pointer must never dispatch a different banner and must give feedback; dismiss every banner, then open a centred panel: the pill must not cover its title.
(3) Paused quake: no camera shake while paused; plop previews and clicks agree (for example rebuild a ruined Missile Test Range after a meteor while paused).
(4) The minimap save chip vs right-docked panels at 1280x720.
(5) Toolbar thumbnails after 15 s idle: no extra renderers kept (CDP queryObjects).
(6) The polish items if the fix report says they were done (pill text, disabled Dispatch rows, Load Region thumbnails).
(7) Regression loop: main menu → new region → found a city → roads, zones, power, water → grow it past 1,000 residents; save → reload the page → Continue; crash recovery (bulldoze something, wait for the recovery snapshot, SIGKILL your chromium, restart, Recover); New Year.
FINAL ANSWER via the schema: a summary, then findings (title, severity blocker|major|minor, area, evidence with screenshot and log paths you looked at, suggested fix, files). Scratch: ${SCRATCH}/close-playtest-c${round}/.

The latest fix and tooling reports:
${fixText}`

const AUDIT = (round, fixText) => `ROLE: independent ADVERSARIAL AUDITOR (close-out round c${round}). You did not make these changes. Review the close-out diff line by line — git -C /home/user/simcityweb diff 822fa5a -- src/ui src/game src/sim src/save src/main.ts tools tests (in src/render read only teardown/dispose changes; the render team's lane changes in TreeRenderer, fallbackTrees, BuildingRenderer, batch, VehicleRenderer, PropRenderer, Shadows and WorldView are reviewed by others) — and try to break it: races, stale state, leaks, event-listener leaks, perf of the new code, forced layouts per UI tick (EM-3: EmergencyBanner must do 0 forced layouts in steady state with and without banners, flyout open or closed), save/load, determinism. Gates: tsc; the full vitest run (under load use --testTimeout=900000 and re-run any wall-clock failure alone); the 128x15 seed-7 bot bit-identical at 194,432; old saves load and continue (the ${CITIES} cities, and at least one save written by an older commit, e.g. built from a git archive of 9948964 with its own save code); the recovery codec suite. Leak probes: in node (WeakRef + gc) and in the browser (CDP) after inspector clicks, every panel, every tool family and exit/re-enter ×3, in a small and a big city; and a sweep for any remaining module-level reference that can pin a city (grep plus heap-snapshot retainer paths). Confirm or refute each item of the latest fix report (below) with evidence.
FINAL ANSWER via the schema: a summary (gates, each item confirmed or not), then findings (title, severity blocker|major|minor, area, evidence, suggested fix, files). Scratch: ${SCRATCH}/close-audit-c${round}/.

The latest fix and tooling reports:
${fixText}`

const FIXN = (round, serious, minors, fixText) => `ROLE: fix engineer, close-out round c${round}. Independent verifiers found these BLOCKER/MAJOR problems in the close-out fixes. Fix each at the root, with a failing-then-passing test where practical, real-input browser evidence and screenshots you look at, tsc, the full vitest run and the bot bit-identical:
${serious.map((f) => '- [' + f.severity + '] ' + f.title + '\n  evidence: ' + f.evidence + '\n  suggested fix: ' + f.suggestedFix + '\n  files: ' + f.files).join('\n')}
Minors (optional — fix only if trivial and safe; otherwise leave them, the lead routes them to the polish backlog):
${minors.map((f) => '- ' + f.title + ' — ' + f.suggestedFix).join('\n') || '(none)'}
FINAL ANSWER: per item — root cause, files and lines, evidence, what is left open. Scratch: ${SCRATCH}/close-fix-c${round}/.

Earlier reports this close-out (for context):
${fixText.slice(0, 15000)}`

phase('Fix')
const [fix2, tools] = await parallel([
  () => __A(CTX + '\n\n' + FIX2, { label: 'fix:close:c2', phase: 'Fix' }),
  () => __A(CTX + '\n\n' + TOOLS, { label: 'tooling:cities', phase: 'Fix' }),
])
let fixText = '== fix c2 report:\n' + (fix2 ?? '(the fix agent failed — review the live tree diff yourself)') + '\n\n== tooling report (test cities, WASM fixtures):\n' + (tools ?? '(the tooling agent failed — look in ' + CITIES + ' and build what you need)')
const rounds = []
for (let round = 3; round <= 4; round++) {
  phase('Verify')
  const vs = (await parallel([
    () => __A(CTX + '\n\n' + PLAYTEST(round, fixText), { label: 'verify:playtest:c' + round, phase: 'Verify', schema: FINDINGS }),
    () => __A(CTX + '\n\n' + AUDIT(round, fixText), { label: 'verify:audit:c' + round, phase: 'Verify', schema: FINDINGS }),
  ])).filter(Boolean)
  const all = vs.flatMap((v) => v.findings ?? [])
  const serious = all.filter((f) => f.severity !== 'minor')
  rounds.push({ round, verifiers: vs.length, summaries: vs.map((v) => v.summary), findings: all })
  log('close-out verify c' + round + ': ' + vs.length + '/2 verifiers, ' + all.length + ' findings (' + serious.length + ' blocker/major)')
  if (!serious.length || round === 4) break
  phase('Fix')
  const fx = await __A(CTX + '\n\n' + FIXN(round, serious, all.filter((f) => f.severity === 'minor'), fixText), { label: 'fix:close:c' + round, phase: 'Fix' })
  fixText = '== fix c' + round + ' report:\n' + (fx ?? '(failed)') + '\n\n' + fixText
}
return { fix2, tools, rounds }
