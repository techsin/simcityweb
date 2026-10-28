export const meta = {
  name: 'w0-integration-qa',
  description: 'Browser QA of the W0.3-W0.5 integration on the cloud (functional, not timing): W0.3 inspector/Appendix A, W0.4 live policy + pill, W0.5 data views + ticker + views, each with the leak probe; diffs against the base 4c90468',
  phases: [{ title: 'QA', detail: 'three fresh QA agents, one browser at a time under the lock' }],
}

const S = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad'
const LOCK = S + '/timing.lock'
const __C = {}
const __R = ["qa:w0.3", "qa:w0.4"]
const __NOTE = 'RESUMING: an earlier run of this exact task was interrupted. Your work dir may hold partial results: read it first and continue rather than redo. Every process of yours from before was stopped.'
async function __A(prompt, opts) {
  const lab = opts && opts.label
  if (lab && Object.prototype.hasOwnProperty.call(__C, lab)) return __C[lab]
  return agent(lab && __R.includes(lab) ? __NOTE + '\n\n' + prompt : prompt, opts)
}

const CTX = `Project: **Metropolis**, a browser 3D city builder (Vite 8 + TypeScript 7 + three.js r186). The simulation is moving behind a host seam (docs/WORKER_DESIGN.md §6, steps W0.1-W0.6). W0.3, W0.4 and W0.5 were written as three Codex lanes on the owner's desktop and merged into one integration branch. Its non-browser gates pass: tsc, 1,568 tests, the bot, old saves. You run its BROWSER QA here, because the desktop's machine is busy with timing runs. This is functional QA, not timing.

TREES (git worktrees with their own node_modules dir of links; read-only for you, so never edit or commit in them):
- NEW = ${S}/w0merge = local/W0.3-5-integration @ 93069fa;
- BASE = ${S}/integbase = 4c90468, the dev head the integration was built on, for before/after comparisons.
Reports: docs/dev/reports/local-W0.3-5-integration.md, local-W0.3-queries.md, local-W0.4-livepolicy.md, local-W0.5-views.md (in NEW). The QA checklist is docs/WORKER_DESIGN.md Appendix A.

TEST CITIES: ${S}/cities/ (small_s7_y10, vet_s7_y21, vet_s7_y43 as .city.metropolis / .region.metropolis; load them through the game's Load Region → import → Play, or as the earlier QA did), and the fixtures /home/user/simcityweb/tools/bench/.fixtures/fixtures/{bot256_s7_y60,dense1m_s7}.metropolis.

RULES:
- This machine has 4 cores and other workflows time things on it. Take the lock before every browser session or other heavy run: \`until mkdir ${LOCK} 2>/dev/null; do sleep 15; done\`. Release it with \`rmdir ${LOCK}\` right after, also on failure, and never hold it for more than about 15 minutes at a time: split your QA into sessions.
- Chromium: Playwright's headless_shell with --use-angle=swiftshader --enable-unsafe-swiftshader (software GL: slow but correct). Start your own vite servers on free ports (not 5173) and stop every server and browser you start.
- Use REAL input (page.mouse, page.keyboard). Use page.evaluate only to read state or for a declared setup step.
- **A probe pitfall from earlier QA:** a Playwright locator read on a city element can pin the exited city. Use coordinate input and raw CDP with an objectGroup on every call that returns objects.
- ALWAYS look at the screenshots you take, and cite their paths. Scratch: ${S}/integqa/<your label>/.
- Report what you checked, what passed, and every finding: severity blocker | major | minor, evidence, a suggested fix, and the files. Also say what you could not check, and why.`

const VERDICT = {
  type: 'object',
  properties: {
    pass: { type: 'boolean', description: 'true when no blocker or major remains' },
    checked: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, title: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' }, files: { type: 'string' } }, required: ['severity', 'title', 'evidence', 'fix', 'files'] } },
    notChecked: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['pass', 'checked', 'findings', 'notChecked', 'summary'],
}

const QA03 = `ROLE: QA for **W0.3 (queries and watches)** on NEW against BASE.
1. Appendix A: the rows for the consumers W0.3 moved to queries and watches (InfoPanel / inspectorModel, StatsPanel's garages, AdvisorsPanel, DispatchTool, the others its report lists). Exercise each in the game and check it behaves as on BASE.
2. The inspector screenshot diff. On fixed seeds and the same city state (load the same save in both trees, paused), inspect the same set of buildings and cells in both trees: growable, service, utility, park, transit, road, an empty cell, and a building on fire if you can make one. Compare the panels pixel for pixel, or by their text content if pixels differ only by antialiasing. Also switch targets quickly: the panel must never show the previous target's report (O3).
3. The 5 Hz watch cap: while the inspector is open at ultra, it updates, but no faster than about 5 Hz.
4. The leak probe in fresh and hostile modes (tools/leakprobe/README.md): 0 cities after each exit.`
const QA04 = `ROLE: QA for **W0.4 (LivePolicy in SimCore)** on NEW against BASE.
1. An uncovered major fire at ultra, out of range: it sets speed 1 with the live slow-motion before the next sim day runs (WORKER_DESIGN §3.3). The game stays live while help drives, and the previous speed comes back with the toast.
2. The urgent pause when time is very short, and a second episode.
3. Dismissals, and a setting change mid-episode (emergencyUncovered live / pause / ignore): the speed the policy set goes back, and the new setting takes over, as on BASE.
4. Banner re-raise after a save and load during an episode.
5. **Check 4's playtest minor:** at 1024x600 and 1280x720, the emergencies pill must not sit over the content of a centred panel (open Budget, Rewards and Statistics while a banner shows). Compare with BASE and say whether W0.4 fixed it.
6. The leak probe in fresh and hostile modes: 0 cities after each exit.`
const QA05 = `ROLE: QA for **W0.5 (views and seams)** on NEW against BASE.
1. Every data view and variant (the overlay list in src/render/world/overlays.ts and the views menu), by screenshot diff between BASE and NEW on the same city, paused, with a fixed camera: identical, or explain each difference. Use vet_s7_y21 or bot256_s7_y60.
2. A view with no data yet draws nothing: no zeros, and "Loading…" in the legend (O9). Check it on the first switch to a view after a load.
3. The three views W0.5 introduced (EmergencyView, TrafficView, UtilitiesView): their data, routes and readouts match BASE.
4. The news ticker past 200 news items on bot256_s7_y60 (let it run at ultra): no growth, no errors.
5. The leak probe in fresh and hostile modes: 0 cities after each exit.`

phase('QA')
const out = await parallel([
  () => __A(CTX + '\n\n' + QA03, { label: 'qa:w0.3', phase: 'QA', schema: VERDICT }),
  () => __A(CTX + '\n\n' + QA04, { label: 'qa:w0.4', phase: 'QA', schema: VERDICT }),
  () => __A(CTX + '\n\n' + QA05, { label: 'qa:w0.5', phase: 'QA', schema: VERDICT }),
])
return out