export const meta = {
  name: 'b3-month-spread',
  description: 'Worker plan S4 / WASM_PLAN B3: measure the month-boundary work left after part B, design the spreading, implement, gate (tests, digests, month-day timing, balance) and verify, in a scratch worktree',
  phases: [
    { title: 'Map', detail: 'measure what is left on the month tick, per system' },
    { title: 'Design', detail: 'one design, two adversarial design reviews' },
    { title: 'Build', detail: 'implement in the worktree, then the gates' },
    { title: 'Verify', detail: 'two independent adversarial reviewers' },
    { title: 'Fix', detail: 'one fix round if a blocker or major remains' },
  ],
}

const S = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad'
const W = S + '/b3'
const B = S + '/b3base'
const WORK = S + '/b3work'

const __C = {}
const __R = ["map:month", "design", "build"]
const __NOTE = 'RESUMING: an earlier run of this exact task was interrupted (usage limit, restart or crash). Your scratch dir under ' + WORK + ' may hold partial work from it: read it first, keep what is sound, check git -C ' + W + ' log and status for commits or edits it already made, and continue rather than redo. Every process of yours from before the restart was stopped: restart what you need.'
async function __A(prompt, opts) {
  const lab = opts && opts.label
  if (lab && Object.prototype.hasOwnProperty.call(__C, lab)) return __C[lab]
  return agent(lab && __R.includes(lab) ? __NOTE + '\n\n' + prompt : prompt, opts)
}

const TRAILERS = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01KT9tXthEhyzExdUuGEecAJ'

const CTX = `Project: **Metropolis**, a browser 3D city builder ("SimCity 4, but better"). The simulation is src/sim/** (headless, deterministic TypeScript; vitest tests in tests/**; the bot is tools/simbot.ts).

WHERE YOU WORK: a scratch git worktree W = ${W} (branch b3-month-spread, local only). Its base is the lead's test merge a59f08f: the dev branch plus the exact J-fixes, the LG-01 ranks and the guide copy. All of these are exact: the 128x15 seed-7 bot ends 2015 at 194,432 residents [63702, 93494, 37236]. B = ${B} is the same commit as a detached, read-only worktree for side-by-side runs. Never push. Never touch the main checkout /home/user/simcityweb or any other worktree. Commit only in W, and only if your role says so. Scratch files go under ${WORK}/<your role>/.

TASK B3 (docs/WASM_PLAN.md row B3, line ~407; docs/WORKER_DESIGN.md §6 row S4, line ~972): spread the month-boundary work over the month's days, with deterministic offsets.
- The plan's numbers predate part B's final fixes: tourism 18-28 ms, EQ/HQ 12-18, advisors 14, emergency 2.7; the budget (7-10 ms) stays on the boundary.
- Those fixes already moved some of the work:
  - tourism's hotel-room and historic sums run in daily slices (TOURISM_SLICES, systemData.tourismAcc);
  - EQ/HQ runs on day EQHQ_DAY = 25 in daily slices (population.ts, eqHqDaily);
  - the advisors' map scans run on MONTH_SCAN_DAYS.
- Acceptance:
  - the month-day unit is at most the normal (median) day + 10 ms at 1M population, on dense1m and bot256, headless at design cadence and in the frames emulation at ultra;
  - deterministic;
  - save/load continuity;
  - the balance procedure passes.
- Why: W1's latency criterion. WASM_PLAN finding 8: a month boundary blocks the worker for 73-105 ms, and actions need p95 ≤ 50 ms and p99 ≤ 100 ms. Also the month frame of the main-thread host.

LEAD'S QUICK PROFILE (dense1m, headless, 60 days). This kernel's thread CPU has a 4 ms granularity, so treat these as rough:
- economy.tourism.monthly: mean 12.6 ms, max 21.2;
- economy.budget.monthly: mean 7.1, max 8;
- economy.advisors.monthly: mean 5.0, max 8;
- economy.advisors.daily: max 15.9;
- economy.population.daily: p95 19.4, max 27.4;
- emergency.monthly: 0.8;
- whole day: mean 24.1, p50 20.0, p95 51.6, max 59.1.

TOOLS:
- tools/bench/sim-profile/profile.ts: see its header for usage. Bundle it inside a tree with \`node tools/bench/sim-profile/bundle.mjs profile\`, which writes <tree>/node_modules/.cache/sim-profile/profile.js. W and B each have their own node_modules dir of links, so bundles do not collide. Copy a bundle to your scratch dir if you want to keep it.
- tools/bench/exact/cityDigest.ts: bundle it with \`node tools/bench/sim-profile/bundle.mjs ../exact/cityDigest\`. It prints sha256 digests of a fixture after N days; use it as the exactness and determinism check.
- tools/balance-json.ts: a headless balance run → JSON rows (\`npx tsx tools/balance-json.ts <size> <years> <seed> <out.json>\`).
- Fixtures (old saves): /home/user/simcityweb/tools/bench/.fixtures/fixtures/dense1m_s7.metropolis (1.12M, day 10921) and bot256_s7_y60.metropolis. For small cities, use tests/infra/cityGen.ts or the bot.

TIMING:
- This machine has 4 cores. Use wall clock (performance.now) for per-hook and per-day costs, because thread CPU is 4 ms-quantized here.
- Nothing else heavy may run during a timing run: check \`pgrep -af "balance-json|simbot|vitest|profile"\` and the load average. The lead's baseline balance runs may still be going; wait for them.
- Do at least 3 runs per side, interleaved B and W, and report medians and ranges.

BALANCE: docs/SIM_DEPTH_SPEC.md, "Balance procedure" (line ~862).
- Runs: 256x60 seeds 7 and 11, and 128x15 seed 7.
- Acceptance on 256 seed 7:
  - pop ≥ 150k at year 15, ≥ 950k at year 60, and ≥ 0.9x baseline;
  - approval ≥ 50 from year 30;
  - funds ≥ 0;
  - EQ ≥ 100 by year 30;
  - tourism jobs within ±30 %;
  - totalMsPerDay ≤ baseline + 3.
- The lead made baseline runs of this base on this machine: ${S}/balance/base/b_256x60_s7.json, b_256x60_s11.json and b_128x15_s7.json, with logs next to them.

RULES:
- Files in scope:
  - src/sim/economy/tourism.ts;
  - population.ts, and demographics.ts' eqHqDaily if the EQ/HQ part needs it;
  - advisors.ts;
  - budget.ts, only if the design moves something there;
  - the tuning/params constants for the offsets;
  - tests.
- Keep every other file unchanged: other branches are changing the services, traffic, emergency and UI code.
- Results must stay deterministic within the version.
- A save taken on any day of the month must load and continue exactly like the uninterrupted run. New per-month state goes in st.systemData, versioned, with a safe fallback for saves that lack it.
- The bot's output changes by design: say so, and record the new 128x15 seed-7 2015 population.`

const MAP = {
  type: 'object',
  properties: {
    system: { type: 'string' },
    measurements: { type: 'string', description: 'tables: per part / per day, W or B, dense1m and bot256, medians and ranges, the load average' },
    consumers: { type: 'string', description: 'who reads each output and when' },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' }, how: { type: 'string' }, determinism: { type: 'string' }, saveLoad: { type: 'string' },
          risk: { type: 'string' }, savingMs: { type: 'string' },
        },
        required: ['name', 'how', 'determinism', 'saveLoad', 'risk', 'savingMs'],
      },
    },
    recommendation: { type: 'string' },
    toolsWritten: { type: 'string', description: 'paths and how to run any reusable driver you wrote' },
  },
  required: ['system', 'measurements', 'consumers', 'proposals', 'recommendation', 'toolsWritten'],
}
const DESIGN = {
  type: 'object',
  properties: {
    designPath: { type: 'string' }, commit: { type: 'string' }, summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } }, expectedMonthDay: { type: 'string' },
  },
  required: ['designPath', 'commit', 'summary', 'files', 'expectedMonthDay'],
}
const DREVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ok', 'changes'] },
    required: { type: 'array', items: { type: 'string' } },
    optional: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['verdict', 'required', 'optional', 'summary'],
}
const BUILD = {
  type: 'object',
  properties: {
    commits: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
    testsAdded: { type: 'array', items: { type: 'string' } }, tsc: { type: 'string' }, vitest: { type: 'string' },
    deviations: { type: 'string', description: 'where the code differs from the design doc, and why' },
  },
  required: ['commits', 'summary', 'testsAdded', 'tsc', 'vitest', 'deviations'],
}
const GATES = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
    bot128: { type: 'string', description: 'the new 128x15 seed-7 2015 population and residents' },
    tables: { type: 'string', description: 'every gate with its numbers: tsc, vitest, digests, save/load, month-day timing W vs B, balance side by side' },
    summary: { type: 'string' },
  },
  required: ['pass', 'failures', 'bot128', 'tables', 'summary'],
}
const VERDICT = {
  type: 'object',
  properties: {
    pass: { type: 'boolean', description: 'true when no blocker or major remains' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
        },
        required: ['severity', 'issue', 'evidence', 'fix'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['pass', 'findings', 'summary'],
}

const MAP_TOURISM = `ROLE: MAP the tourism system's month-boundary work. You are read-only in W; put any instrumentation in a copy under ${WORK}/map-tourism/, never in W or B.
1. Read src/sim/economy/tourism.ts:
   - the monthly update(): venues, beaches, the visitor raster, attractiveness, migration, and the econData / stats outputs;
   - its daily part (the tourismAcc slices);
   - init()'s save/load handling (savedOutputs / restoreOutputs).
2. Measure the cost of each part of update() at dense1m and bot256 (wall clock, ≥ 3 runs, an idle machine). Give its total on a month-tick day.
3. List every consumer of its outputs (grep econData(st).tourism, attractTerms, migration, the venue records, stats.*) and when each reads them (daily, monthly, the UI). A design needs to know what must be fresh at the month tick and what may lag or move.
4. Propose 2-3 ways to spread the remaining work over the month's days. Options include more daily slices with saved accumulators like tourismAcc, a deterministic day offset for parts that read stable inputs, and incremental upkeep. For each, give: how; determinism; save/load continuity (what extra state is saved); the risk to gameplay or balance; the expected month-day saving in ms. Recommend one.`

const MAP_POPADV = `ROLE: MAP the population and advisors systems' month-boundary work. You are read-only in W; put instrumentation only in a copy under ${WORK}/map-pop-adv/.
1. population.ts (and demographics.ts' eqHqDaily): what runs on the month tick, and which days are expensive. The lead's profile shows economy.population.daily at p95 19.4 ms and max 27.4. Find the days and the parts: EQHQ_DAY, the slices, the growth bookkeeping, the outage records, anything else.
2. advisors.ts: the monthly() pass (rules, advice posts, issue lists) and the daily scans on MONTH_SCAN_DAYS. The lead's profile has advisors.monthly at max 8 and advisors.daily at max 15.9. Give the cost per part and per day.
3. Measure at dense1m and bot256 (wall clock, ≥ 3 runs, an idle machine): per part and per day of the month.
4. Consumers: who reads EQ/HQ, the advisor issue list and the posts, and when. The Advisors panel reads advisorIssues while the game runs.
5. Propose 2-3 ways to spread what is left (deterministic offsets, slices with saved state). For each, give how, determinism, save/load continuity, the gameplay risk and the expected saving. Recommend one.`

const MAP_MONTH = `ROLE: MAP the whole month-day unit. You are read-only in W; put instrumentation only in a copy under ${WORK}/map-month/.
1. Find every hook that runs on the month boundary:
   - how Simulation.ts runs the monthly() hooks and the 'month' event;
   - every system's monthly() and every listener of 'month';
   - every daily() part that does extra work on a month's first or last day.
2. Measure at dense1m and bot256 (wall clock, ≥ 3 runs, an idle machine) the month-boundary day's total and each hook's share, against the median normal day:
   - headless at design cadence (advanceDay + the scheduler's flush, as tools/bench/exact/cityDigest.ts does);
   - in the profiler's frames emulation at ultra (--mode frames --speed 3): the frame that carries the month tick.
3. The budget (budget.ts monthly; 7-10 ms in the plan): WORKER_DESIGN keeps it on the boundary. Confirm its cost, and whether anything in it can move without changing what the player sees in the month's budget.
4. Report the gap to the target (month-day unit ≤ normal day + 10 ms) and which hooks must move to close it.
5. Write a small reusable timing driver into ${WORK}/tools/: a .ts bundled with rolldown like the profiler, or a profiler run with per-day output. It must report per-day wall time with the month days marked, for any tree and fixture. Describe how to run it; the gates and the verifiers will reuse it.`

const designPrompt = (maps) => `ROLE: DESIGNER for B3. Read the three maps below and the code, then decide one design that meets the acceptance with the smallest, clearest change.
Write it to ${W}/docs/dev/B3_DESIGN.md and commit it in W, ending the message with these lines:
${TRAILERS}
The design covers, per system:
- what moves to which day(s) of the month (deterministic offsets or slices);
- what state is saved: systemData keys with a version, and the fallback for older saves and for a save taken mid-month;
- what the player and each consumer sees, and when (what stays exactly on the month tick);
- the expected month-day unit at dense1m and bot256;
- the files and functions touched;
- the tests to add;
- the risks.
Prefer the existing patterns (the tourismAcc slices, the GROWABLE_SLICES buckets, EQHQ_DAY). Keep the budget on the boundary unless the maps show it must move.
MAPS (JSON):
${JSON.stringify(maps, null, 1)}`

const DR_A = (d) => `ROLE: adversarial DESIGN REVIEWER (determinism and save/load) for B3. You did not write the design. Read ${W}/docs/dev/B3_DESIGN.md (commit ${d.commit}) and the code it touches. Try to break it:
- a save on every day of the month, including the slice days, the day before the month tick and the tick itself;
- loads of older saves that lack the new state;
- a new city and the first month;
- buildings added or removed after their slice ran (counted twice, or never);
- region switches and city resets;
- the bot and the headless scheduler;
- order dependencies between systems on the same day;
- RNG draws that move.
Answer with verdict ok or changes, the required changes (each concrete), and the optional ones.`
const DR_B = (d) => `ROLE: adversarial DESIGN REVIEWER (gameplay, balance, UI and the target) for B3. You did not write the design. Read ${W}/docs/dev/B3_DESIGN.md (commit ${d.commit}) and the code it touches. Check:
- whether the numbers in the maps support meeting the target (month-day unit ≤ the median day + 10 ms at 1M, headless and in the frames emulation at ultra);
- whether the work just moves into new spikes on other days;
- what the player sees: the budget panel, tourism and attractiveness, the advisors, EQ/HQ, the news; whether anything visible goes stale or half-updated mid-month;
- the balance risk: which sim feedbacks now read older values;
- whether it is the simplest design that works.
Answer with verdict ok or changes, the required changes (each concrete), and the optional ones.`

const implPrompt = (d, reviews) => `ROLE: IMPLEMENTER for B3 in W. Implement ${W}/docs/dev/B3_DESIGN.md (commit ${d.commit}) plus the design reviewers' required changes below. Where a required change conflicts with the design, follow the reviewer and update the design doc.
- Commit in W in small commits with clear messages, each ending with these lines:
${TRAILERS}
- Add the tests the design names, at least:
  (a) determinism: two runs are identical;
  (b) save/load continuity for saves taken on several days of the month, including the days the moved work runs, the day before the month tick and the tick itself (serializeCity / deserializeCity plus a digest comparison);
  (c) older saves without the new state load and continue;
  (d) unit tests of the slicing.
- Run npx tsc --noEmit and the full npx vitest run until both are clean, with no unhandled errors.
- Do not run the balance procedure or the timing runs; the gates agent does that.
DESIGN REVIEWS (JSON):
${JSON.stringify(reviews, null, 1)}`

const gatesPrompt = (build, maps, round) => `ROLE: GATES for B3 in W${round > 1 ? ` (round ${round}, after a fix round)` : ''}. Do not change src or tests; you may add tools under ${WORK}/gates${round}/. The implementer's commits: ${JSON.stringify(build.commits)}. The timing drivers from the map phase: ${maps.map((m) => m.toolsWritten).join(' | ')}.
Run these and report each with its numbers, side by side with the base B where that applies:
1. npx tsc --noEmit, and the full npx vitest run (no unhandled errors).
2. The 128x15 seed-7 bot: \`npx tsx tools/simbot.ts --size 128 --years 15 --seed 7\`. Record the new 2015 population and residents; they change by design.
3. Determinism: cityDigest on dense1m and bot256 for 120 days, twice in W; the digests must be identical. Save/load: the digest after 120 days uninterrupted must equal a save at day k + load + continue to day 120. Use several k across a month, including the moved-work days and the month tick.
4. The month-day unit at dense1m and bot256, headless at design cadence and in frames mode at ultra: W vs B, interleaved, ≥ 3 runs each, wall clock, an idle machine. Give the month-boundary day against the median day, and the max day. The target is month-day ≤ normal day + 10 ms.
5. The balance procedure in W: 256x60 seeds 7 and 11, and 128x15 seed 7, with tools/balance-json.ts. Run the three in parallel in the background and wait with an until-loop. Give the acceptance table against the base JSONs: pop at years 15 / 30 / 60 against the baseline, approval from year 30, funds, EQ by year 30, tourism jobs (find where the bot reports them, or compute them from a run), and totalMsPerDay. Also give the yearly tables side by side, every 5 years.
Clean up every process you start. pass is true only when every gate passes.`

const VER_A = (gates) => `ROLE: independent ADVERSARIAL REVIEWER of the B3 code (correctness, determinism, save/load). You did not write it. Review \`git -C ${W} diff a59f08f -- src tests\` line by line, and docs/dev/B3_DESIGN.md. Try to break it, with your own probes and tests in ${WORK}/verify-a/ (never commit in W):
- mid-month saves on every day of the month;
- loads of old saves (the fixtures, plus a city saved by the base tree B on several days of the month, then loaded in W);
- day 0 and the first month;
- buildings added or removed mid-slice;
- a new city, a city reset, region switching;
- consumers reading stale or half-updated values;
- the Advisors panel and tourism data mid-month.
The gates agent reported (JSON): ${JSON.stringify(gates).slice(0, 6000)}
Severity: blocker = breaks determinism, save/load or the game; major = a wrong or stale value the player or the sim depends on, or a missed acceptance item; minor = everything else.`
const VER_B = (gates) => `ROLE: independent ADVERSARIAL REVIEWER of the B3 numbers (timing, balance, no new spikes). You did not write the code or run the gates. Re-run independently, in ${WORK}/verify-b/:
- the month-day timing at dense1m and bot256 (W vs B interleaved, ≥ 3 runs, an idle machine, wall clock);
- the 128x15 bot;
- one 256x60 balance seed of your choice.
Check the gates' claims below. Check that the spread work does not create new > 10 ms spikes on other days of the month, that the max day and p99 day did not get worse, and that totalMsPerDay holds. Judge the acceptance exactly as written in the context.
The gates agent reported (JSON): ${JSON.stringify(gates).slice(0, 8000)}
Severity: blocker = an acceptance item fails clearly; major = a claim the numbers do not support, or a new spike over target; minor = everything else.`

phase('Map')
const maps = (await parallel([
  () => __A(CTX + '\n\n' + MAP_TOURISM, { label: 'map:tourism', phase: 'Map', schema: MAP }),
  () => __A(CTX + '\n\n' + MAP_POPADV, { label: 'map:pop-adv', phase: 'Map', schema: MAP }),
  () => __A(CTX + '\n\n' + MAP_MONTH, { label: 'map:month', phase: 'Map', schema: MAP }),
])).filter(Boolean)
log('maps: ' + maps.map((m) => m.system + ' → ' + m.recommendation.slice(0, 120)).join(' || '))

phase('Design')
if (maps.length < 3) throw new Error('a map agent returned nothing (' + maps.length + ' of 3); resume after checking its transcript')
const design = await __A(CTX + '\n\n' + designPrompt(maps), { label: 'design', phase: 'Design', schema: DESIGN })
if (!design) throw new Error('the design agent returned nothing; resume after checking its transcript')
const dreviews = (await parallel([
  () => __A(CTX + '\n\n' + DR_A(design), { label: 'design-review:determinism', phase: 'Design', schema: DREVIEW }),
  () => __A(CTX + '\n\n' + DR_B(design), { label: 'design-review:gameplay', phase: 'Design', schema: DREVIEW }),
])).filter(Boolean)
log('design reviews: ' + dreviews.map((r) => r.verdict + ' (' + r.required.length + ' required)').join(', '))

phase('Build')
const build = await __A(CTX + '\n\n' + implPrompt(design, dreviews), { label: 'build', phase: 'Build', schema: BUILD })
const gates = await __A(CTX + '\n\n' + gatesPrompt(build, maps, 1), { label: 'gates', phase: 'Build', schema: GATES })
log('gates: pass=' + gates.pass + '; ' + gates.failures.join('; ').slice(0, 300))

phase('Verify')
const verdicts = (await parallel([
  () => __A(CTX + '\n\n' + VER_A(gates), { label: 'verify:code', phase: 'Verify', schema: VERDICT }),
  () => __A(CTX + '\n\n' + VER_B(gates), { label: 'verify:numbers', phase: 'Verify', schema: VERDICT }),
])).filter(Boolean)
const serious = verdicts.flatMap((v) => v.findings.filter((f) => f.severity !== 'minor'))
log('verify: ' + verdicts.map((v) => 'pass=' + v.pass + ' (' + v.findings.length + ' findings)').join(', '))

let fix = null, gates2 = null, reverify = null
if (serious.length || !gates.pass) {
  phase('Fix')
  fix = await __A(CTX + '\n\n' + `ROLE: IMPLEMENTER, fix round for B3 in W. Fix every blocker and major below, and the failed gates. Fix minors only where they are cheap and safe. Commit in W, each message ending with:\n${TRAILERS}\nRun npx tsc --noEmit and the full npx vitest run until clean. Say for each finding what you changed, or why it is not a defect, with evidence.\nFAILED GATES: ${JSON.stringify(gates.failures)}\nFINDINGS (JSON): ${JSON.stringify(verdicts, null, 1)}`, { label: 'fix', phase: 'Fix', schema: BUILD })
  gates2 = await __A(CTX + '\n\n' + gatesPrompt(fix, maps, 2), { label: 'gates:2', phase: 'Fix', schema: GATES })
  reverify = await __A(CTX + '\n\n' + `ROLE: independent ADVERSARIAL RE-VERIFIER for B3 after a fix round. You did not write the code. For each finding below, confirm or refute that it is fixed, with your own evidence: the diff \`git -C ${W} diff a59f08f -- src tests\`, tests and probes in ${WORK}/reverify/. Then hunt for anything the fixes broke. The fixer reported: ${JSON.stringify(fix).slice(0, 4000)}. The gates round 2: ${JSON.stringify(gates2).slice(0, 5000)}. THE FINDINGS: ${JSON.stringify(serious, null, 1)}`, { label: 'reverify', phase: 'Fix', schema: VERDICT })
}

return { maps, design, dreviews, build, gates, verdicts, fix, gates2, reverify }