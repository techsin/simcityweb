export const meta = {
  name: 'b2-step-split',
  description: 'Worker plan S3 / WASM_PLAN B2: split the infra scheduler steps to at most 3 ms at 17k buildings and recalibrate cost(), in a scratch worktree on top of B1; map, design, implement, gate (step p99/max, cost-model error, digests, balance) and verify',
  phases: [
    { title: 'Map', detail: 'per-task step costs and cost-model error' },
    { title: 'Design', detail: 'one design, two adversarial design reviews' },
    { title: 'Build', detail: 'implement task group by task group, then the gates' },
    { title: 'Verify', detail: 'two independent adversarial reviewers' },
    { title: 'Fix', detail: 'one fix round if a blocker or major remains' },
  ],
}

const S = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad'
const W = S + '/b2'
const B = S + '/b2base'
const WORK = S + '/b2work'
const LOCK = S + '/timing.lock'

const __C = {}
const __R = ["map:other", "design", "design-review:targets"]
const __NOTE = 'RESUMING: an earlier run of this exact task was interrupted (usage limit, restart or crash). Your scratch dir under ' + WORK + ' may hold partial work from it: read it first, keep what is sound, check git -C ' + W + ' log and status for commits or edits it already made, and continue rather than redo. Every process of yours from before the restart was stopped: restart what you need. If ' + LOCK + ' exists and no timing process runs (pgrep), remove it.'
async function __A(prompt, opts) {
  const lab = opts && opts.label
  if (lab && Object.prototype.hasOwnProperty.call(__C, lab)) return __C[lab]
  return agent(lab && __R.includes(lab) ? __NOTE + '\n\n' + prompt : prompt, opts)
}

const TRAILERS = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01KT9tXthEhyzExdUuGEecAJ'

const CTX = `Project: **Metropolis**, a browser 3D city builder ("SimCity 4, but better"). The simulation is src/sim/** (headless, deterministic TypeScript; vitest tests in tests/**; the bot is tools/simbot.ts).

WHERE YOU WORK: a scratch git worktree W = ${W} (branch b2-step-split, local only). Its base is the lead's test merge 41ae570: the dev branch, plus the exact J-fixes, LG-01 and the guide copy, plus B1 (the services dirty trigger, WIP 5bb5467 from the desktop worker; its 128x15 seed-7 2015 reference is 196,101). B = ${B} is the same commit as a detached, read-only worktree for side-by-side runs. Never push. Never touch the main checkout /home/user/simcityweb or any other worktree. Commit only in W, and only if your role says so. Scratch files go under ${WORK}/<your role>/.

TASK B2 (docs/WASM_PLAN.md row B2, line ~406, and its table of the largest steps, line ~411; docs/WORKER_DESIGN.md §6 row S3, line ~971): split the InfraScheduler's steps to at most 3 ms at 17k buildings (dense1m), and recalibrate cost().
- cost() was measured 3-5.5x too low at the median and up to 20x too low at the worst.
- The plan's starting list (ms): traffic transit 32-67, crime sources 18-46, services prep 39, services shopB 35, NIMBY 27, traffic final2 17-26, traffic commute 10-25, pollution sources 12-25, utilities water 6-21, emergency response 8-18.
- Acceptance:
  - maxStepMs p99 ≤ 3 ms and max ≤ 5 ms at dense1m;
  - the median cost-model error within ±30 %;
  - the balance procedure passes;
  - new bot hashes are recorded (the headless schedule follows the estimates, so the results change by design).
- Why: W1's latency criterion (WASM_PLAN finding 8: a single step blocks the worker for up to 67 ms; actions need p95 ≤ 50 ms and p99 ≤ 100 ms). Also the main-thread host's frame budget (INFRA_FRAME_BUDGET_MS).

LEAD'S QUICK PROFILE of the base without B1 (dense1m, headless, 60 days, wall-clock maxStepMs per task): services 29.1, traffic 24.2, pollution 16.3, crime 16.1, utilities 10.7, emergency.response 10.7. By step (thread CPU, 4 ms-quantized here, so rough):
- services:finish 19.7, services:prep 15.3, services:tiers up to 16, services:nimby 13.3, services:stops 7.1;
- traffic:prep 18-20, traffic:final2 12-16, traffic:roundMatch up to 11.6, traffic:prepTransit 8, traffic:11 7.2, traffic:14 8, traffic:shop 7.9;
- crime:sources 10-14;
- emergency.response:resp0 9.4, resp3 7.8;
- pollution:airFar / garbApply / flags up to 8;
- utilities:uses / power / water up to 8, utilities:label 7.8.

TOOLS:
- tools/bench/sim-profile/profile.ts: see its header. It reports per-task and per-step costs (steps.*, tasks.*, maxStepMsWall). Bundle it inside a tree with \`node tools/bench/sim-profile/bundle.mjs profile\`, which writes <tree>/node_modules/.cache/sim-profile/profile.js. W and B each have their own node_modules dir of links.
- tools/bench/exact/cityDigest.ts: the digest of a fixture after N days.
- tools/balance-json.ts: balance rows (\`npx tsx tools/balance-json.ts <size> <years> <seed> <out.json>\`).
- Fixtures: /home/user/simcityweb/tools/bench/.fixtures/fixtures/dense1m_s7.metropolis (1.12M, 17k buildings) and bot256_s7_y60.metropolis.
- The scheduler: src/sim/infra/scheduler.ts. Its tasks keep their pass state in memory (e.g. services.ts stepIdx, S_PREP..S_FINISH, WORK_PER_STEP). A save does not store a pass in progress; keep today's save/load behaviour exactly, whatever it is (find and keep the tests that pin it).

TIMING: this machine has 4 cores and other workflows run on it.
- Before ANY timing run, take the timing lock: \`until mkdir ${LOCK} 2>/dev/null; do sleep 15; done\`. Then check \`pgrep -af "profile|cityDigest|balance-json|simbot|vitest"\` and the load average, and wait while another heavy process runs. Release the lock with \`rmdir ${LOCK}\` right after the run, also on failure.
- Use wall clock (performance.now) for step costs; thread CPU is 4 ms-quantized here.
- Do at least 3 runs per side, interleaved B and W, and report medians and ranges.
- Do not hold the lock for longer than about 15 minutes at a time.

BALANCE: docs/SIM_DEPTH_SPEC.md, "Balance procedure" (line ~862).
- Runs: 256x60 seeds 7 and 11, and 128x15 seed 7.
- Acceptance on 256 seed 7:
  - pop ≥ 150k at year 15, ≥ 950k at year 60, and ≥ 0.9x baseline;
  - approval ≥ 50 from year 30;
  - funds ≥ 0;
  - EQ ≥ 100 by year 30;
  - tourism jobs within ±30 %;
  - totalMsPerDay ≤ baseline + 3.
- The baseline for this base is B1's rows. Run them in B yourself (gates role) side by side with W; the lead's pre-B1 runs are in ${S}/balance/base/ for reference only. The worker's report says single-year tourism values can swing past ±30 % as bot noise (six seeds gave a year-15 geometric mean of 0.996); judge tourism the same way, with more seeds if it matters.

RULES:
- Files in scope: src/sim/infra/scheduler.ts and the infra tasks' step and cost code (traffic.ts, services.ts, crime.ts, pollution.ts, utilities.ts, emergency.ts, nimby.ts and their helpers in src/sim/infra/), params.ts constants, and tests.
- No UI, render or save-format change.
- Results stay deterministic within the version.
- Keep a pass's results identical to today's when it runs uninterrupted from start to finish. Splitting must only change where the step boundaries fall, not what a whole pass computes: prove it with digests, comparing a pass run in one go against a pass run in many small steps.
- The bot's output changes by design (through the new estimates): say so, and record the new 128x15 seed-7 2015 population.`

const MAP = {
  type: 'object',
  properties: {
    tasks: { type: 'string' },
    measurements: { type: 'string', description: 'per step: n, median, p99, max wall ms at dense1m and bot256; estimated cost vs measured' },
    proposals: { type: 'array', items: { type: 'object', properties: { step: { type: 'string' }, how: { type: 'string' }, exactness: { type: 'string' }, risk: { type: 'string' } }, required: ['step', 'how', 'exactness', 'risk'] } },
    costModel: { type: 'string', description: 'how each estimate should be computed (inputs, coefficients), with the fit' },
    toolsWritten: { type: 'string' },
  },
  required: ['tasks', 'measurements', 'proposals', 'costModel', 'toolsWritten'],
}
const DESIGN = { type: 'object', properties: { designPath: { type: 'string' }, commit: { type: 'string' }, summary: { type: 'string' }, groups: { type: 'array', items: { type: 'string' } } }, required: ['designPath', 'commit', 'summary', 'groups'] }
const DREVIEW = { type: 'object', properties: { verdict: { type: 'string', enum: ['ok', 'changes'] }, required: { type: 'array', items: { type: 'string' } }, optional: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, required: ['verdict', 'required', 'optional', 'summary'] }
const BUILD = { type: 'object', properties: { commits: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, tests: { type: 'string' }, deviations: { type: 'string' } }, required: ['commits', 'summary', 'tests', 'deviations'] }
const GATES = { type: 'object', properties: { pass: { type: 'boolean' }, failures: { type: 'array', items: { type: 'string' } }, bot128: { type: 'string' }, tables: { type: 'string' }, summary: { type: 'string' } }, required: ['pass', 'failures', 'bot128', 'tables', 'summary'] }
const VERDICT = { type: 'object', properties: { pass: { type: 'boolean' }, findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'issue', 'evidence', 'fix'] } }, summary: { type: 'string' } }, required: ['pass', 'findings', 'summary'] }

const mapPrompt = (scope, dir) => `ROLE: MAP the step costs of ${scope}. You are read-only in W and B; instrumentation goes only in copies under ${WORK}/${dir}/.
1. For each task in your scope, list its steps (the step state machine, what each step does, its work budget) and its cost() estimate.
2. Measure at dense1m and bot256 (wall clock, the timing lock, ≥ 3 runs): for each step, n, median, p99 and max. Also the estimate against the measured cost per step (the cost-model error).
3. For every step over 3 ms at dense1m, propose how to split it into pieces of at most about 2.5 ms: chunked loops with a saved cursor, finer state-machine states, budgeted work units. Say why the whole pass stays exact, and the risk.
4. Propose the cost model per step: inputs such as cells, buildings, nodes and work units, with coefficients fitted to your measurements, and the fit.
5. Write any reusable driver into ${WORK}/tools/ and say how to run it. The gates and verifiers will reuse it.`

const designPrompt = (maps) => `ROLE: DESIGNER for B2. Read the maps below and the code, then decide the design.
Write it to ${W}/docs/dev/B2_DESIGN.md and commit it in W, ending the message with:
${TRAILERS}
The design covers:
- per step: the split, the saved cursor state, why the whole pass stays exact, and the target ms;
- the new cost() model per step, with coefficients;
- the order of the build, in groups. Use about four groups, each a coherent set of files one implementer can finish and test alone; for example traffic; services + nimby; crime + pollution; utilities + emergency + the scheduler's cost recalibration last;
- the tests: whole-pass exactness (one go against many small steps, by digest), determinism, and save/load as today;
- the risks.
Return the group names in build order.
MAPS (JSON):
${JSON.stringify(maps, null, 1)}`

const DR = (lens, d) => `ROLE: adversarial DESIGN REVIEWER (${lens}) for B2. You did not write the design. Read ${W}/docs/dev/B2_DESIGN.md (commit ${d.commit}) and the code it touches. Try to break it. Answer with verdict ok or changes, the required changes (each concrete), and the optional ones.`

const buildPrompt = (d, reviews, group, done) => `ROLE: IMPLEMENTER for B2 in W, group "${group}". Groups already done in W: ${JSON.stringify(done)}. Implement your group of ${W}/docs/dev/B2_DESIGN.md (commit ${d.commit}) plus the design reviewers' required changes that apply to it. Where a required change conflicts with the design, follow the reviewer and update the design doc.
- Commit in W in small commits, each message ending with:
${TRAILERS}
- Add your group's tests: whole-pass exactness by digest (one go against many small steps), and the unit tests the design names.
- Run npx tsc --noEmit and the vitest files your group touches. Run the full npx vitest run before your last commit; with no unhandled errors.
- Measure your group's steps once with the timing lock (dense1m, wall clock) and report the before/after p99 and max per step.
DESIGN REVIEWS (JSON):
${JSON.stringify(reviews, null, 1)}`

const gatesPrompt = (round) => `ROLE: GATES for B2 in W${round > 1 ? ' (round ' + round + ', after a fix round)' : ''}. Do not change src or tests; your tools go under ${WORK}/gates${round}/. Run these and report each with its numbers, side by side with B where that applies:
1. npx tsc --noEmit, and the full npx vitest run (no unhandled errors).
2. The 128x15 seed-7 bot: record the new 2015 population and residents (196,101 on B).
3. Whole-pass exactness: for each task, a pass run in one go against one run in small steps gives the same digest, at dense1m and bot256. Determinism: cityDigest at 120 days twice in W, identical. Save/load behaves as on B (the existing tests, plus a save mid-pass, a load and a continue, compared in both trees).
4. Steps at dense1m and bot256: maxStepMs p99 and max per task and per step, W against B, interleaved, ≥ 3 runs, with the timing lock. Targets: p99 ≤ 3 ms and max ≤ 5 ms at dense1m. Also the median cost-model error (estimate against measured, per step) within ±30 %.
5. The balance procedure in W and in B: 256x60 seeds 7 and 11, and 128x15 seed 7, side by side. Run all six in the background (two at a time if memory is tight: check free -m) and wait with an until-loop. They are not timing runs, so no lock, but totalMsPerDay is compared, so run W and B under the same load. Give the acceptance table and the yearly tables every 5 years.
Clean up every process you start. pass is true only when every gate passes.`

const VER = (lens, gates) => `ROLE: independent ADVERSARIAL REVIEWER of B2 (${lens}). You did not write it or run its gates. Review \`git -C ${W} diff 41ae570 -- src tests\` and docs/dev/B2_DESIGN.md. Try to break it with your own probes in ${WORK}/verify-${lens.split(' ')[0]}/ (never commit in W; timing only with the timing lock). The gates reported (JSON): ${JSON.stringify(gates).slice(0, 7000)}
Severity: blocker = breaks exactness of a whole pass, determinism, save/load or the game, or clearly fails an acceptance item; major = a claim the numbers do not support, a missed step over target, or an unusual but legal input that breaks; minor = everything else.`

phase('Map')
const maps = (await parallel([
  () => __A(CTX + '\n\n' + mapPrompt('the traffic task (traffic.ts)', 'map-traffic'), { label: 'map:traffic', phase: 'Map', schema: MAP }),
  () => __A(CTX + '\n\n' + mapPrompt('the services task (services.ts, nimby.ts) and emergency.response (emergency.ts)', 'map-services'), { label: 'map:services', phase: 'Map', schema: MAP }),
  () => __A(CTX + '\n\n' + mapPrompt('the crime, pollution and utilities tasks (crime.ts, pollution.ts, utilities.ts), plus the scheduler itself (scheduler.ts: how cost() estimates drive the headless day budget and the frame budget)', 'map-other'), { label: 'map:other', phase: 'Map', schema: MAP }),
])).filter(Boolean)

phase('Design')
if (maps.length < 3) throw new Error('a map agent returned nothing (' + maps.length + ' of 3); resume after checking its transcript')
const design = await __A(CTX + '\n\n' + designPrompt(maps), { label: 'design', phase: 'Design', schema: DESIGN })
if (!design) throw new Error('the design agent returned nothing; resume after checking its transcript')
const dreviews = (await parallel([
  () => __A(CTX + '\n\n' + DR('whole-pass exactness, determinism and save/load: cursors that survive a city reload, a load mid-pass, a pass that restarts when its inputs change mid-pass, and work-unit budgets that differ between headless and live', design), { label: 'design-review:exactness', phase: 'Design', schema: DREVIEW }),
  () => __A(CTX + '\n\n' + DR('the targets and the cost model: will every step really be at most 3 ms p99 and 5 ms max at dense1m, including rare big steps (the first pass after load, a network edit, disasters); is the cost model fitted to real data; what happens to the headless day budget and the frames budget; is it the simplest design', design), { label: 'design-review:targets', phase: 'Design', schema: DREVIEW }),
])).filter(Boolean)

phase('Build')
const done = []
const builds = []
for (const g of design.groups) {
  const r = await __A(CTX + '\n\n' + buildPrompt(design, dreviews, g, done), { label: 'build:' + g, phase: 'Build', schema: BUILD })
  if (r) { builds.push(r); done.push(g) }
}
const gates = await __A(CTX + '\n\n' + gatesPrompt(1), { label: 'gates', phase: 'Build', schema: GATES })

phase('Verify')
const verdicts = (await parallel([
  () => __A(CTX + '\n\n' + VER('code: exactness, determinism, save/load, edge cases', gates), { label: 'verify:code', phase: 'Verify', schema: VERDICT }),
  () => __A(CTX + '\n\n' + VER('numbers: steps, cost model, balance; re-run a subset independently', gates), { label: 'verify:numbers', phase: 'Verify', schema: VERDICT }),
])).filter(Boolean)
const serious = verdicts.flatMap((v) => v.findings.filter((f) => f.severity !== 'minor'))

let fix = null, gates2 = null, reverify = null
if (serious.length || !gates.pass) {
  phase('Fix')
  fix = await __A(CTX + '\n\n' + `ROLE: IMPLEMENTER, fix round for B2 in W. Fix every blocker and major below and the failed gates; fix minors only where cheap and safe. Commit in W, each message ending with:\n${TRAILERS}\nRun npx tsc --noEmit and the full npx vitest run until clean. Say for each finding what you changed, or why it is not a defect, with evidence.\nFAILED GATES: ${JSON.stringify(gates.failures)}\nFINDINGS (JSON): ${JSON.stringify(verdicts, null, 1)}`, { label: 'fix', phase: 'Fix', schema: BUILD })
  gates2 = await __A(CTX + '\n\n' + gatesPrompt(2), { label: 'gates:2', phase: 'Fix', schema: GATES })
  reverify = await __A(CTX + '\n\n' + `ROLE: independent ADVERSARIAL RE-VERIFIER for B2 after a fix round. You did not write the code. For each finding below, confirm or refute that it is fixed with your own evidence (the diff \`git -C ${W} diff 41ae570 -- src tests\`, probes in ${WORK}/reverify/, timing only with the lock), then hunt for anything the fixes broke. The fixer reported: ${JSON.stringify(fix).slice(0, 4000)}. The gates round 2: ${JSON.stringify(gates2).slice(0, 5000)}. THE FINDINGS: ${JSON.stringify(serious, null, 1)}`, { label: 'reverify', phase: 'Fix', schema: VERDICT })
}

return { maps, design, dreviews, builds, gates, verdicts, fix, gates2, reverify }
