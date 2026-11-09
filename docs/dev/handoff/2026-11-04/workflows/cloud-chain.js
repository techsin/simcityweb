export const meta = {
  name: 'cloud-chain',
  description: 'Cloud lanes: per lane, build it, gate on tsc/vitest/bot, review independently, fix, and merge into dev; browser checks go to the desktop after merge (NOTE-059)',
  phases: [{ title: 'Finish' }, { title: 'Review' }, { title: 'Fix' }, { title: 'Merge' }],
}

const S = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad'
const R = '/home/user/simcityweb'
const DEV = 'claude/beautiful-johnson-u2jqoz'
const CHAIN = args.chain
const LANES = args.lanes
const __R = args.resume || []
const __NOTE = 'RESUMING: an earlier run of this exact step was interrupted (usage limit, restart or crash). Your worktree and scratch dir may hold partial work from it: read git log and git status there first, keep what is sound, and continue rather than redo. Kill any server, browser or background process of yours from before; a lock whose holder is gone is taken over by the helper scripts automatically.'
async function __A(prompt, opts) {
  const lab = opts && opts.label
  return agent(lab && __R.includes(lab) ? __NOTE + '\n\n' + prompt : prompt, opts)
}
const TRAILERS = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01KT9tXthEhyzExdUuGEecAJ'

const CTX = `Project: **Metropolis**, a browser 3D city builder ("SimCity 4, but better"): Vite 8 + TypeScript 7 + three.js r186.
- src/sim/**: the headless, deterministic simulation.
- src/worker/**: the sim host seam, which moves the sim into a Web Worker.
- src/game/**: the city scene and tools.
- src/ui/**: the DOM UI.
- src/render/**: three.js.
- Tests are vitest: \`npx vitest run --configLoader runner\`. Type check: \`npx tsc --noEmit\`. The bot: \`npx tsx tools/simbot.ts --size 128 --years 15 --seed 7\`; compare its \`residents [...]\` line.

SITUATION. The desktop worker that ran these lanes, on a real GPU, is unavailable since Oct 28. The cloud takes over every lane. Each lane's \`local/*\` branch (in the shared repo, already fetched) holds what the desktop pushed. Some of it is WIP saved mid-edit at a usage-limit stop, so re-run everything before trusting it.
- Task files docs/dev/queue/T0xx-*.md define each job (owns, do, gates, report).
- NOTE-0xx files hold the lead's later decisions. Read every NOTE that names your task: \`grep -l <task id> docs/dev/queue/NOTE-*\`. Also read NOTE-044.
- The plans are docs/POLISH_PLAN.md, docs/WORKER_DESIGN.md and docs/WASM_PLAN.md. Status is docs/dev/STATUS.md.
- Dev is \`origin/${DEV}\`. Run \`git -C ${R} fetch -q origin\` before using it.

THE MACHINE: a 4-core, 16 GB cloud container shared with other agents. Do not crash it.
- **Heavy commands** run only under the shared lock, held for that one command: \`${S}/bin/lock.sh timing <command...>\`. They are: the full vitest, the bot, every browser session, timing runs and fixture builds. Another job may hold this lock for a long time; wait for it and do light work meanwhile.
- **Medium commands** run under \`${S}/bin/sem.sh cpu 2 <command...>\`: tsc, and a few vitest files with \`--maxWorkers=2\`.
- The full vitest takes about 8 min here. The grown-fixture querySideEffects case alone takes about 340 s.
- Use at most one browser at a time. Use your own vite server on a free port, never 5173. Stop every server, browser and background process you start, and remove your vite caches.
- **Browser checks run on the DESKTOP, not here (NOTE-059).** Do not start a browser for this lane's acceptance on the cloud: the desktop runs every browser check on a real GPU after the lane merges. Instead, end the lane's report with a section 'Desktop QA': each browser check as a numbered item with its page URL, flags, steps and expected result. A unit or node test that stands in for a browser check is welcome. Only if a check is needed to decide a merge-blocking question may you run it here, under the lock, once.
- Browsers (only for that exception): Playwright's Chromium is pre-installed (\`require('playwright')\`; \`chromium.launch()\` needs no options). WebGL runs on SwiftShader, so check function and visuals, not GPU timings. Look at every screenshot you take, and cite its path.

GIT:
- Work in your own worktree under ${S}/co/<lane> (\`git -C ${R} worktree add\`). Symlink node_modules to ${R}/node_modules and never delete through the link.
- Your branch is \`cloud/<lane>\`.
- Never push: only the merge step pushes. Never touch the main checkout ${R} outside the merge step. Merge; do not rebase or rewrite anyone's branch. Never delete files you did not create.
- Commit with clear messages ending with exactly these two lines:
${TRAILERS}
- Never put a model name or model id in a commit, a code comment or a report.

DECISIONS: where a task or the plan leaves a choice that belongs to the lead or the owner (a gate that cannot be met as written, a design or balance trade-off, a real-GPU-only measurement), do not stall. Take the conservative reading, list it under decisions with the evidence, and continue.`

const FIN = { type: 'object', properties: {
  status: { type: 'string', enum: ['ready', 'partial', 'blocked'], description: "ready: every gate green and nothing required left; partial: gates green and merge-safe, but some listed acceptance item is left (e.g. real-GPU only); blocked: must not merge" },
  branch: { type: 'string' }, worktree: { type: 'string' },
  gaps: { type: 'array', items: { type: 'string' }, description: 'what the task required that was not done when you started' },
  done: { type: 'array', items: { type: 'string' } },
  remaining: { type: 'array', items: { type: 'string' } },
  simChange: { type: 'string', description: "'none' if the bot must stay identical to dev, else what changes by design and the new residents line" },
  gates: { type: 'string', description: 'every gate with its numbers' },
  decisions: { type: 'array', items: { type: 'string' } },
  summary: { type: 'string' },
}, required: ['status', 'branch', 'worktree', 'gaps', 'done', 'remaining', 'simChange', 'gates', 'decisions', 'summary'] }
const VERDICT = { type: 'object', properties: {
  pass: { type: 'boolean' },
  findings: { type: 'array', items: { type: 'object', properties: {
    severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, item: { type: 'string' }, issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
  }, required: ['severity', 'item', 'issue', 'evidence'] } },
  summary: { type: 'string' },
}, required: ['pass', 'findings', 'summary'] }
const FIX = { type: 'object', properties: {
  commits: { type: 'array', items: { type: 'string' } }, fixed: { type: 'array', items: { type: 'string' } },
  notFixed: { type: 'array', items: { type: 'string' } }, gates: { type: 'string' }, summary: { type: 'string' },
}, required: ['commits', 'fixed', 'notFixed', 'gates', 'summary'] }
const MERGE = { type: 'object', properties: {
  merged: { type: 'boolean' }, sha: { type: 'string' }, gates: { type: 'string' }, botRef: { type: 'string' }, notes: { type: 'string' },
}, required: ['merged', 'sha', 'gates', 'botRef', 'notes'] }

const finishPrompt = (l) => `ROLE: LANE FINISHER for lane **${l.key}** (chain ${CHAIN}).
TASK FILE: ${l.task}. REPORT: ${l.report}. DONE MARKER: ${l.done}.
START POINT: ${l.branch ? 'the desktop branch ' + l.branch : 'dev itself (new lane)'}.
KNOWN STATE (from the desktop's last messages and the lead): ${l.brief}

Steps:
1. **Worktree.** Create ${S}/co/${l.key} on a new branch cloud/${l.key}, starting from ${l.branch || 'origin/' + DEV}.${l.branch ? ' Merge origin/' + DEV + ' into it. Resolve any conflicts keeping both sides\' intent, never dropping dev\'s changes, and run tsc after.' : ''} If ${S}/co/${l.key} already exists, this is a resume: continue in it.
2. **Gap list.** Establish what was required against what is done. Read the task file, every NOTE naming the task, the plan items it cites (each one in full, with its Acceptance), the lane's report and the diff against dev. Write the gap list into the report first.
3. **Do the remaining work.**
   - Code and tests. Each new test must fail with its fix reverted.
   - The acceptance items.
   - The browser checks the task or plan items require, run here.
   - Desktop work that was saved mid-edit: verify it line by line.
4. **Gates.**
   - tsc (sem) and the full vitest (lock).
   - The bot (lock) whenever src/sim, src/worker, src/game or src/save changed. It must be identical to dev's: run dev's too, from a clean export of origin/${DEV} in ${S}/co/${l.key}-devbase, unless the lane changes behaviour by design (say what and why).
   - The task's own gates.
5. **Report.** Add a "Cloud carry-over (Nov 3)" section to the report (create the file if needed): the gap list, what you did, every gate with numbers, browser evidence paths, and decisions. Add the done-marker line (${l.done}: append one line for this lane if the file is shared), and commit everything on cloud/${l.key}.
Return the schema.`

const reviewPrompt = (l, f) => `ROLE: independent REVIEWER of lane **${l.key}** (chain ${CHAIN}). You did not write it.
The finisher reports: ${JSON.stringify({ status: f.status, gaps: f.gaps, done: f.done, remaining: f.remaining, simChange: f.simChange, decisions: f.decisions, gates: f.gates })}
Review branch cloud/${l.key} (worktree ${S}/co/${l.key}; do not edit it — use your own scratch copy under ${S}/co-review/${l.key}) against origin/${DEV}. Check the full diff (\`git diff origin/${DEV}...cloud/${l.key}\`) against the task file ${l.task}, its NOTEs and the plan items:
- correctness, and every acceptance item (met or not, with evidence);
- determinism and save/load for sim changes;
- the hygiene rules (tests/worker/hygiene*);
- test quality: revert one fix in your scratch copy and see its test fail;
- the UI states: check the report's 'Desktop QA' checklist covers every browser acceptance item with exact steps and expected results (the desktop runs it after merge on a real GPU, NOTE-059); do not start a browser yourself; list a doubtful UI state as a Desktop QA item;
- regressions in neighbouring code, and whether the remaining items and decisions are honest.
Severity is blocker, major or minor. pass = no blocker and no major. Return the schema.`

const fixPrompt = (l, v) => `ROLE: IMPLEMENTER, fix round for lane **${l.key}** in ${S}/co/${l.key} (branch cloud/${l.key}).
1. Fix every blocker and major below, and the minors whose fix is clear and contained.
2. Rerun the gates they touch, and always tsc and the full vitest (lock). Rerun the bot (lock) if sim, worker, game or save code changed.
3. Update the report's carry-over section and commit.
Findings:
${JSON.stringify(v.findings)}
Return the schema.`

const rereviewPrompt = (l, v, x) => `ROLE: independent RE-REVIEWER for lane **${l.key}** after a fix round. You did not write the code.
For each blocker and major below, check in ${S}/co/${l.key} (read only; scratch copies under ${S}/co-review/${l.key}) that the fix holds, with your own test or browser check. Look for regressions the fix introduced.
Findings: ${JSON.stringify(v.findings.filter((f) => f.severity !== 'minor'))}
The fix round reports: ${x.summary}; not fixed: ${JSON.stringify(x.notFixed)}
pass = every blocker and major is fixed (or honestly not applicable) and there is no new blocker or major. Return the schema.`

const mergePrompt = (l, f) => `ROLE: MERGER for lane **${l.key}** (chain ${CHAIN}). Merge branch cloud/${l.key} into dev and push, or leave dev exactly as it was.
1. Take the merge lock and hold it to the end: \`${S}/bin/acquire.sh merge ${CHAIN}:${l.key}\`. It waits if another merge is running. ALWAYS release it before you return, whatever happens: \`${S}/bin/release.sh merge ${CHAIN}:${l.key}\`.
   Lock order: take merge before timing, and never wait for merge while holding timing.
2. **Check the main checkout.** In ${R}, on branch ${DEV}, \`git status --porcelain\` must be empty apart from untracked scratch files of no concern. If tracked files are modified, do not touch them: release the lock and return merged=false with the listing. Then \`git fetch -q origin && git pull --ff-only origin ${DEV}\`.
3. **The bot reference:** the residents line on dev now. Take it from the newest merge commit body on dev that states one, or from docs/dev/STATUS.md, or run the bot on dev (lock).
4. **Merge.** \`git merge --no-ff cloud/${l.key}\`. The message: a title naming the lane and task, then a body with what landed, the gates and the decisions, then a blank line and the two trailer lines exactly:
${TRAILERS}
   Resolve conflicts keeping both sides; never drop dev's changes.
5. **Gates on the merged tree:**
   - tsc (sem);
   - the full vitest (lock);
   - the bot (lock), if sim, worker, game or save code is in the diff. It must match the reference unless the finisher declared a change by design: ${JSON.stringify(f.simChange)}. In that case put the new residents line in the merge commit body as "bot reference: ...", amending the merge commit, which is allowed because it is not pushed.
6. **Green:** append one line to docs/dev/reports/cloud-carryover-log.md: lane, short sha, date, gate numbers, bot line. Commit it, then push with \`git push -u origin ${DEV}\`, retrying up to 4 times with 2, 4, 8 and 16 s waits on network errors.
   **Red:**
   - If the failure comes from the combination and the fix is small and clear, fix it in a commit on top, then rerun the failing gate and the full vitest.
   - Otherwise run \`git reset --hard origin/${DEV}\` (only your own merge can be there while you hold the lock) and return merged=false with the evidence.
7. Release the merge lock, then return the schema.`

const results = []
for (const l of LANES) {
  phase('Finish')
  const fin = await __A(CTX + '\n\n' + finishPrompt(l), { label: `finish:${l.key}`, phase: 'Finish', schema: FIN })
  if (!fin) { results.push({ lane: l.key, stopped: 'finish' }); log(`${l.key}: finish returned nothing; chain stops for a resume`); break }
  if (fin.status === 'blocked') { results.push({ lane: l.key, fin }); log(`${l.key}: blocked, ${fin.summary.slice(0, 160)}`); continue }
  phase('Review')
  const rev = await __A(CTX + '\n\n' + reviewPrompt(l, fin), { label: `review:${l.key}`, phase: 'Review', schema: VERDICT })
  if (!rev) { results.push({ lane: l.key, fin, stopped: 'review' }); break }
  let fix = null, rerev = null, ok = rev.pass
  if (!rev.pass) {
    phase('Fix')
    fix = await __A(CTX + '\n\n' + fixPrompt(l, rev), { label: `fix:${l.key}`, phase: 'Fix', schema: FIX })
    if (!fix) { results.push({ lane: l.key, fin, rev, stopped: 'fix' }); break }
    rerev = await __A(CTX + '\n\n' + rereviewPrompt(l, rev, fix), { label: `rereview:${l.key}`, phase: 'Fix', schema: VERDICT })
    if (!rerev) { results.push({ lane: l.key, fin, rev, fix, stopped: 'rereview' }); break }
    ok = rerev.pass
  }
  if (!ok) { results.push({ lane: l.key, fin, rev, fix, rerev, merged: false }); log(`${l.key}: review did not pass after the fix round; not merged`); continue }
  phase('Merge')
  const mer = await __A(CTX + '\n\n' + mergePrompt(l, fin), { label: `merge:${l.key}`, phase: 'Merge', schema: MERGE })
  if (!mer) { results.push({ lane: l.key, fin, rev, fix, rerev, stopped: 'merge' }); break }
  results.push({ lane: l.key, status: fin.status, remaining: fin.remaining, decisions: fin.decisions, review: rev.summary, fixed: fix && fix.fixed, merged: mer.merged, sha: mer.sha, botRef: mer.botRef, notes: mer.notes })
  log(`${l.key}: ${mer.merged ? 'merged ' + mer.sha : 'NOT merged: ' + mer.notes.slice(0, 160)}`)
}
return results
