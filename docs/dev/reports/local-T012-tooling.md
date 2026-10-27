# local-T012-tooling: the dev tools work on Windows (tooling backlog)

Branch `local/T012-tooling`, base `fe584f2`. No `src/**` changes.

## What changed
1. **`tools/makeFixtures.mjs`, snapshot step.**
   - `git archive --worktree-attributes` is streamed into `tar -x -f -` through stdin, with tar run from the parent
     directory and a relative `-C`. That works with GNU tar (Git Bash), Windows bsdtar and Linux tar.
   - `node_modules` is linked with a `junction` on win32 (no developer mode needed) and a relative symlink elsewhere.
   - `git` spawn errors are reported instead of passing silently.
   - `--worktree-attributes` applies the new LF rules to the frozen 24f8609 tree, whose files would otherwise be
     archived with CRLF under `core.autocrlf=true` (which broke the captures' anchors).
2. **`tools/bench/sim-profile/profile.ts`.** When `process.threadCpuUsage` is missing (node < 23.9), totals come from
   long-window `process.cpuUsage` chunks and per-frame / per-step times from `hrtime`. The output says which clock was
   used (`"clock": "threadCpu" | "wall+processCpu"`). `tools/bench/baselines/threadCpuShim.mjs` says in its header
   that `profile.js` no longer needs it.
3. **`analyze.mjs` / `heapanalyze.mjs`.** The default source-map path is built with `fileURLToPath` + `path.join` (no
   more `C:\C:\…`).
4. **`fixtures/botgrow.ts`.** Each save logs its own population and building count when it is written.
5. **`.gitattributes`.** `* text=auto eol=lf`, binaries (wasm, images, audio, glb, `.metropolis`, archives, fonts,
   pdf) marked `-text`. `git add --renormalize .` shows no content change for any tracked file.
6. **Added by me (slightly beyond the task's file list, same kind of fix).**
   - 12 files under `tools/bench/**` took the fixture's basename with `split('/').pop()`. On Windows that kept the whole
     `C:\…` path, so the captures wrote to `<cache>\C:\…\dense1m_s7.w8.pagc` and failed.
   - They now use `split(/[\\/]/).pop()`, which behaves the same on Linux.
   - Files: the `*.bench.mjs` files of desirabilityLandValueBands and populationAggregateProbe; their `capture.ts`,
     `node.ts`, `insitu.ts` and `e2e.ts`; `fieldPasses/{capture,insitu}.ts`; and the `sim-profile` analyzers.

## Gates

| Gate | Result |
|---|---|
| `npm run fixtures` from a fresh worktree on Windows, no manual steps | **passes**: snapshot (LF, junction), dense1m, stress1m and bot256 built, and all three capture sets (populationAggregateProbe, econ, fieldPasses) |
| Same fixture digests as T005 | dense1m `d8e217f39983337b` (1,118,755 residents), stress1m `3ba552f9be0d19bc` (1,034,100), bot256 `5cfc7236df7eaa85` (652,568); identical |
| `profile.ts` on node 22.12 without the shim | runs; output labels `"clock": "wall+processCpu"` |
| `npx tsc --noEmit` | clean |
| `npx vitest run` (fresh worktree) | **122 files passed, 1 skipped; 1,095 tests passed, 3 skipped, 0 failed**. `tests/wasm/binary.test.ts` is green on Windows; the 3 skips are the `BALANCE`-gated ones |
| Linux | unchanged by design: the lead re-runs the fixture build in the cloud |

**Note for existing Windows checkouts.** Files already checked out with CRLF keep it until refreshed:
`git rm --cached -r . && git reset --hard` in a clean worktree, or simply a new worktree.

**Who wrote what.**
- **Codex** (max effort): items 1–5.
- **Me (Claude):** the review, item 6 (found by running the real fixture build from a fresh worktree) and all gates.
