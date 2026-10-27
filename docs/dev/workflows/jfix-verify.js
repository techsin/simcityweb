export const meta = {
  name: 'jfix-verify',
  description: 'Independent adversarial verification of the five exact J-fix branches (J2 traffic; J4 nimby, J7 fire, J8 blur, J10 info cache) before the lead merges them after the sim close-out',
  phases: [{ title: 'Verify', detail: 'two independent reviewers, read-mostly' }],
}

const S = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad'
const P = S + '/premerge'

const __C = {}
const __R = []
const __NOTE = 'RESUMING: an earlier run of this exact task was interrupted. Your scratch dir may hold partial work from it: read it first and continue rather than redo.'
async function __A(prompt, opts) {
  const lab = opts && opts.label
  if (lab && Object.prototype.hasOwnProperty.call(__C, lab)) return __C[lab]
  return agent(lab && __R.includes(lab) ? __NOTE + '\n\n' + prompt : prompt, opts)
}

const CTX = `Project: **Metropolis**, a browser 3D city builder. The simulation is src/sim/** (deterministic TypeScript; vitest tests in tests/**).

WHAT YOU VERIFY: five JS performance fixes from the million-population plan (docs/WASM_PLAN.md §7.6, PI-4 "J-fixes"). Each claims to be EXACT: bit-identical results, only faster. Codex wrote them on the owner's Windows desktop and the desktop's Claude reviewed them. Each branch adds a copy of the original code (tests/sim/exact/*Original.ts) and an exactness test against it. The lead's test merge of all five onto the dev branch is the detached worktree ${P} (HEAD a59f08f; its node_modules links to the main checkout's). On it, the full vitest passes and the 128x15 seed-7 bot is bit-identical (194,432).
Branches, all based on 614609f (see each diff with \`git -C /home/user/simcityweb diff 614609f origin/local/<branch>\`):
- J2-traffic: src/sim/infra/traffic.ts (a radix sort of match keys, cached stop x/z, reused scratch);
- J4-nimby: src/sim/infra/nimby.ts (an indexOf row-pair skip, a 4-cell word scan);
- J7-fire: src/sim/infra/fire.ts + common.ts (the fire daily step and the building list; partial);
- J8-blur: src/sim/infra/blur.ts (a 4-row horizontal pass, a fused vertical pass);
- J10-infoof: src/sim/economy/demographics.ts + src/sim/infra/utilities.ts (infoOf / demoOf reuse).
Each branch's report is docs/dev/reports/local-<branch>.md, and the summary is docs/dev/reports/local-T007-jfixes.md.

RULES:
- Read-only. Never commit, push or edit in /home/user/simcityweb or ${P}. Put probes in ${S}/jfixv/<your label>/: copies of files, small rolldown bundles, node scripts.
- Keep CPU light: another workflow on this 4-core machine runs timing measurements. Before anything heavier than a single vitest file or a few seconds of node, check \`pgrep -af "profile|cityDigest|balance-json|simbot"\` and the load average. Run then only when the machine is quiet, and keep each heavy run short (a 120-day cityDigest is fine).
- Severity: blocker = a result differs from the original for some reachable input (determinism or exactness broken), or a crash; major = a difference only for an unusual but legal input (another map size, an edge case of the data), or a save/load or cache-invalidation hole; minor = clarity, dead code, a speed claim the numbers do not support.

HOW TO VERIFY:
1. Read each diff line by line against the original. For each changed function, argue exactness: same iteration order, same floating-point operation order (a reordered sum is NOT exact), the same tie-breaking (sort stability), the same integer overflow and typed-array clamping, NaN and Infinity handling, and empty or single-element inputs.
2. Hunt for inputs the exactness tests do not cover: map sizes other than the tested ones (64, 128, 256, 512 if allowed), keys at the radix sort's range limits, zero or huge counts, buildings or stations at map edges, many equal keys, cache reuse across a city reload, region switch or new city, and a save/load in the middle.
3. Where it helps, write a differential probe: run the original copy and the new function on random and adversarial inputs, compare the bytes, and report counts.
4. Check that caches and reused scratch are invalidated wherever their inputs change, and never shared between two Simulation instances.`

const SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean', description: 'true when no blocker or major remains' },
    perBranch: { type: 'array', items: { type: 'object', properties: { branch: { type: 'string' }, verdict: { type: 'string' }, evidence: { type: 'string' } }, required: ['branch', 'verdict', 'evidence'] } },
    findings: { type: 'array', items: { type: 'object', properties: { branch: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['branch', 'severity', 'issue', 'evidence', 'fix'] } },
    summary: { type: 'string' },
  },
  required: ['pass', 'perBranch', 'findings', 'summary'],
}

phase('Verify')
const out = (await parallel([
  () => __A(CTX + '\n\nYOUR SCOPE: J2-traffic only (the largest diff). Your label: j2.', { label: 'verify:j2', phase: 'Verify', schema: SCHEMA }),
  () => __A(CTX + '\n\nYOUR SCOPE: J4-nimby, J7-fire, J8-blur and J10-infoof. Your label: j4-10.', { label: 'verify:j4-10', phase: 'Verify', schema: SCHEMA }),
])).filter(Boolean)
return out