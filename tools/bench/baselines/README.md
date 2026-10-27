# PI-1 baselines (docs/WASM_PLAN.md §7.2)

`pi1-<sha>.json` holds the million-population baseline measured on commit `<sha>`: per fixture, the whole-sim CPU per
simulated day in node (design cadence and headless), the profile matrix (ultra frames emulation, cycles, GC), and the real
game in headless Chromium at ultra. The report that reads it is `docs/dev/reports/local-T005-pi1-baseline.md`. Raw
profiles stay out of git (`tools/bench/.fixtures/pi1/`, gitignored).

| File | What |
|---|---|
| `pi1Day.ts` | Headline ms/day: two isolates (A/A, or A/B with `--armB`), fixtures loaded with zlib + `decodeBundle`, protector probe per arm, every round rebuilds the city and times the same day window, process CPU time, median + 95 % bootstrap CI, end digests (D1). `--kernel nimby\|blur\|fire` times one containing function in place instead of whole days. |
| `pi1Browser.mjs` | The real game (`index.html`) in headless Chromium on the GPU: a fixture imported as a region, quality ultra, speed 3 for 90 days. Per-frame main-thread time inside rAF callbacks, long tasks ≥ 50 ms, days/s, and every sim speed change. |
| `toRegion.ts` | Wraps a fixture as a one-city region file the game imports (`tools/citySaves.ts`). |
| `threadCpuShim.mjs` | Preload for `profile.js` on node builds without `process.threadCpuUsage` (Windows node 22.12): maps it to the wall clock and prints process CPU / wall at exit. |
| `run_pi1.sh` | Runs everything in order, one heavy process at a time. |
| `pi1Summary.mjs` | Builds `pi1-<sha>.json` from the raw output. |

## Reproduce

```
npm ci
npm run fixtures                       # tools/bench/.fixtures/{snap,fixtures}: dense1m, stress1m, bot256 (24f8609)
# re-grow on THIS tree (PI-1 wants the final sim):
node tools/bench/sim-profile/bundle.mjs fixtures/dense1m && node node_modules/.cache/sim-profile/dense1m.js tools/bench/.fixtures/live 1150000 120 7
node tools/bench/sim-profile/bundle.mjs fixtures/botgrow && node node_modules/.cache/sim-profile/botgrow.js 60 7 60 tools/bench/.fixtures/live
tools/bench/baselines/run_pi1.sh       # raw output in tools/bench/.fixtures/pi1/
node tools/bench/baselines/pi1Summary.mjs --sha <sha>
```

`run_pi1.sh` uses the chunk sizes the committed numbers were measured with (design 60 / 90 days, headless 320, stress
200; 32 rounds). On another machine, size `--chunk` so one chunk takes ≥ 1 s of CPU: `process.cpuUsage` ticks at about
15.6 ms on Windows. The profile matrix also ran `frames` three more times per fixture (`--out <label>_framesX<n>.json`)
for the spread; `pi1Summary.mjs` picks those up when present.

### On Windows

- **`npm run fixtures` fails at the snap step** (GNU tar from Git Bash cannot take `C:\` paths, Windows bsdtar needs
  `-f -`, and `symlinkSync` needs developer mode). Until `tools/makeFixtures.mjs` handles Windows, build the snapshot by
  hand once; the script then keeps it and builds the rest:
  ```
  mkdir -p tools/bench/.fixtures/snap
  git archive --format=tar 24f860996746c97d1df771e4483bdce84cf93d34 | tar -x -C tools/bench/.fixtures/snap --exclude='*.test.*' --exclude='*.spec.*'
  echo 24f860996746c97d1df771e4483bdce84cf93d34 > tools/bench/.fixtures/snap/.commit
  # PowerShell, from the repo root (a junction needs no admin rights):
  New-Item -ItemType Junction -Path tools\bench\.fixtures\snap\node_modules -Target (Resolve-Path node_modules)
  npm run fixtures
  ```
  (run the first three lines in Git Bash, from the repo root, with relative paths). The `captures` target then fails in
  `populationAggregateProbe.bench.mjs` ("anchor for the system object not found"), most likely CRLF line endings in the
  extracted snapshot under `core.autocrlf=true`; the three fixtures are not affected (their digests match the cloud
  builds: dense1m `d8e217f3`, stress1m `3ba552f9`, bot256 `5cfc7236`).
- **`profile.js` needs `process.threadCpuUsage`** (node ≥ 23.9): run it as
  `node --import ./tools/bench/baselines/threadCpuShim.mjs node_modules/.cache/sim-profile/profile.js ...` and label its
  numbers wall-clock. A newer node would not help: on Windows it reads `GetThreadTimes`, with the same 15.6 ms tick.
- **`analyze.mjs` / `heapanalyze.mjs`** derive their default source-map path wrongly on Windows (`C:\C:\...`): pass
  `--map node_modules/.cache/sim-profile/profile.js.map`.
- `tables.py` and `gcnvp.py` run with `py` (the Python launcher); `python` is the Store stub on this machine.

### Browser runs and the emergency policy

With the default setting `emergencyUncovered: 'live'`, a 1.1–1.4M city at ultra drops to speed 1 (LIVE slow motion) or
pauses within seconds, whenever an incident needs a player dispatch (`src/ui/EmergencyBanner.ts` `applyPolicy`). The
browser harness therefore sets the player option `'ignore'` by default and records every speed change; pass
`--emergency live` to measure the default behaviour.
