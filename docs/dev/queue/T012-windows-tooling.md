# T012-windows-tooling: make the dev tools work on Windows (tooling backlog)
base: claude/beautiful-johnson-u2jqoz HEAD when you start (record the sha); branch local/T012-tooling
after: none; small, worth doing early because it removes your own workarounds
owns: tools/makeFixtures.mjs, tools/bench/sim-profile/** (profile.ts, analyze.mjs, heapanalyze.mjs, fixtures/botgrow.ts),
  tools/bench/**/*.bench.mjs anchor search only, a new .gitattributes. Nothing in src/**.
do: the [tooling] items in docs/dev/POLISH_BACKLOG.md that you found in T005:
  1. makeFixtures snap step: stream git archive into tar through stdin with forward-slash relative paths; link
     node_modules with a 'junction' symlink on win32 (no developer mode needed).
  2. profile.ts: a portable fallback when process.threadCpuUsage is missing (long-window process CPU chunks for totals,
     hrtime per frame labelled wall-clock), replacing your preloaded shim.
  3. analyze.mjs / heapanalyze.mjs: build the default source-map path with path.join / fileURLToPath (no C:\C:\).
  4. botgrow.ts: log each save's population when it is written.
  5. CRLF: add .gitattributes (`* text=auto eol=lf`, binaries marked -text) so Windows checkouts match the repo, which
     also fixes tests/wasm/binary.test.ts and the captures anchors; check that no tracked file changes content in the
     repo (git add --renormalize . must show no diff).
gates: npm run fixtures works on Windows from a fresh worktree with no manual steps; the same fixture digests as T005;
  profile.ts runs on node 22.12 without the shim; on Linux nothing changes (the lead re-runs the fixtures build in the
  cloud); npx tsc --noEmit clean; npx vitest run passes with binary.test green on Windows.
report: docs/dev/reports/local-T012-tooling.md; push local/T012-tooling with docs/dev/queue/T012-windows-tooling.done; DONE.
