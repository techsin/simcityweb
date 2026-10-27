# T007-jfixes-codex: the exact JS fixes of the million-population plan (WASM_PLAN PI-4), implemented by Codex
base: claude/beautiful-johnson-u2jqoz at the sha T005 measured (record it); one branch per fix, local/J<n>-<name>
after: T005 (the PI-1 baseline must exist first)
owns: per fix only the files its row in docs/WASM_PLAN.md §6 names, plus its tests (tests/sim/exact/**) and its bench
  (tools/bench/exact/**); nothing else
do:
  Why: this is the largest planned block of task #35, fully specified, and every fix has an objective gate (bit-identical
  results + the containing system not slower). Codex writes the code on its own quota; you (Claude) drive, review and
  gate it. Read docs/WASM_PLAN.md §2, §6 (Exact fixes), §7.2 (PI-4), §7.6 (D1, D8), §7.7 (S6), §7.8 (one exactness test
  per J-fix, frozen pre-fix copy), §7.11 (A/B rules) first.
  Fixes in this task (the others wait: J5 and J9 until the sim close-out has merged, J0 until render round 2 closes, J1
  with the worker host):
    J2 traffic.ts + search.ts — JS radix sort of the match keys, precomputed stop x/z, reused scratch (the 'fair core';
       reference JS in src/wasm/js/trafficCore.ts); fairx road-search tweaks only if they stay exact
    J3 services.ts + catchments.ts — the fair engine's algorithm (typed cache records, cached reaches read in place), fused
       finalizeTier clamp+sum, transit-disk lookup table, reuse of the per-pass Map and entry objects (reference
       src/wasm/js/servicesTierEngine.ts)
    J4 nimby.ts — skip landfill row pairs with Uint8Array.indexOf; scan the corridor class map 4 cells at a time via Uint32 views
    J6 population.ts — per-id def index (B0; B2 def+block cache only if it stays simple), reset with the runtime on load/new
       city (reference src/wasm/js/populationAggregateProbe.ts)
    J7 fire.ts + common.ts — maintain the building list on add/remove in order instead of rebuilding it daily
    J8 blur.ts — the restructured loops of tools/bench/blurJsOpt.ts become the JS implementation
    J10 population.ts, demographics.ts, utilities.ts — cache infoOf per building id; hoist waterQualityAt and per-building def
       lookups (do after J6: same file)
    J11 utilities.ts — one pass over a typed per-building record for prepareUses + power sums/results + water sums/results,
       keeping the summation order (do after J10: same file)
  Per fix:
   1. A fresh worktree from the base sha on local/J<n>-<name>. Run Codex non-interactively there (codex exec, sandbox
      limited to that worktree; see codex exec --help) with: the §6 row, the files, the reference code, the rules D1/D8,
      and the gates below. Up to 3 Codex lanes may run at once (separate worktrees); same-file fixes run in order.
   2. Review Codex's diff yourself: scope (only the named files + tests/bench), no behaviour change, readable, matches the
      surrounding code style. Iterate with Codex until it is right.
   3. Gates (you run them, on a quiet machine for the bench):
      - exactness: a frozen test-only copy of the pre-fix code (tests/sim/exact/<name>Original.ts) and a differential test
        (≥ 10k randomized + adversarial cases where the unit is a function); city level: sha256 of serializeCity({copy:true})
        and per-system digests identical after 120 days on dense1m and bot256_y60 (tools/bench/.fixtures), and the
        128x15 seed-7 bot's yearly table identical (194,432 in 2015);
      - speed: CPU-time A/B of the containing system and of the whole day vs the pre-fix code, ≥ 30 interleaved pairs, A/A,
        fixtures loaded with zlib + decodeBundle (not unpackFile), median + 95 % bootstrap CI; must not be slower (CI lower
        bound ≥ 0.99); report the gain against the plan's measured effect;
      - npx tsc --noEmit clean; npx vitest run passes.
   4. Push the branch with docs/dev/reports/local-J<n>-<name>.md (what changed, the gates' numbers, what Codex vs you
      wrote, Codex time) and send: claude -p "DONE T007 J<n> local/J<n>-<name>@<sha> report: …" --cloud session_01KT9tXthEhyzExdUuGEecAJ
      A fix that cannot be made exact or not-slower: stop it, report why (BLOCKED T007 J<n> …), go on with the next.
gates: every pushed fix passes its gates; no edits outside each fix's files
report: one report per fix as above, then a summary docs/dev/reports/local-T007-jfixes.md and docs/dev/queue/T007-jfixes-codex.done
  on the last branch; PROGRESS after each fix. The lead merges the branches after the sim close-out and verifies them
  independently.
