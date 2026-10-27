# local-T005-pi1-baseline: million-population sim baseline (WASM_PLAN §7.2 PI-1) on the Windows worker

Base `614609f` (`claude/beautiful-johnson-u2jqoz`). No `src/**` edits. The committed summary is
`tools/bench/baselines/pi1-614609f.json`; the harnesses and the reproduction steps are in `tools/bench/baselines/`
(README). Raw profiles are in `tools/bench/.fixtures/pi1/`, which is gitignored.

## Environment

| | |
|---|---|
| Machine | AMD Ryzen 7 9800X3D (8 cores / 16 threads), 62 GB, Windows 10 Education 19045, desktop on mains |
| GPU (browser runs) | NVIDIA GeForce RTX 5070 Ti, ANGLE D3D11, driver 32.0.16.1047 |
| node / browser | node 22.12.0 (kept for T007, per NOTE-002); Chromium 141.0.7390.37 (Playwright 1.56.1), headless |
| Load | Nothing else heavy ran during the node headline runs. Load average is not available on Windows (`os.loadavg()` returns 0). Three Codex lanes (T007, below-normal priority, code only) overlapped the browser runs and an earlier headline round. That round failed the A/A gate and was redone on the idle machine (below). |
| Clocks | **Headline ms/day:** `process.cpuUsage` (all threads; it ticks at 15.6 ms on Windows), over chunks of ≥ 1.17 s, so the worst-case tick error is 1.6–2.7 % per sample. **`profile.js` (frames, cycles, per-system splits):** `process.threadCpuUsage` does not exist in node 22.12, so the preload `threadCpuShim.mjs` maps it to `hrtime`. **These numbers are main-thread wall-clock**; see the cross-check below. **Browser:** `performance.now` in the page. |

**Wall-clock cross-check (NOTE-002).** In the headline harness each arm's wall time per day is **0.93–0.98** of its
process CPU in steady state. So on this idle 16-thread machine, main-thread wall time and CPU agree within about 5 %;
process CPU adds a few percent of background GC. Over a whole `profile.js` frames run, process CPU / wall is 2.2–2.6.
That ratio is dominated by V8's background compiler and GC threads during load and warm-up, so it says nothing about the
main thread.

## 1. Fixtures

`npm run fixtures` fails on Windows at the snapshot step:
- GNU tar from Git Bash cannot handle `C:\` paths in `-C`;
- Windows bsdtar reads from `\\.\tape0` without `-f -`;
- `symlinkSync` needs developer mode.

I built `snap/` by hand the way the script does: `git archive 24f8609 | tar -x`, a junction for `node_modules`, and
`.commit`. The script then built the rest. `tools/makeFixtures.mjs` is unchanged (exact commands in the README).

| Fixture | Residents | Buildings | Road cells | Digest | Note |
|---|---:|---:|---:|---|---|
| `fixtures/dense1m_s7` (snap) | 1,118,755 | 17,154 | 23,141 | `d8e217f3` | = the plan's §2 city; matches the cloud build exactly |
| `fixtures/stress1m_testdefs_s7` (snap) | 1,034,100 | 19,484 | 36,003 | `3ba552f9` | matches |
| `fixtures/bot256_s7_y60` (snap) | 652,568 | 11,276 | 13,828 | `5cfc7236` | matches; **not** the plan's "about 1.4M" |
| `live/dense1m_s7` (this tree) | 1,149,841 (stats 1,150,423) | 17,121 | 23,141 | `61966ecd` | = TEST_CITIES' live-tree numbers |
| `live/bot256_s7_y60` (this tree) | **1,368,806** | 10,798 | 13,824 | `8e311464` | ≈ the plan's 1.4M since WP6a |

The `captures` target failed: `populationAggregateProbe.bench.mjs` reported "anchor … not found", probably CRLF in the
extracted snapshot under `core.autocrlf=true`. PI-1 does not use the captures.

Tooling notes for the lead's backlog:
- `botgrow.ts` logs the population of every save after the run ends, so all three saves print 1,368,806. The files
  themselves are right: 281,718 / 884,197 / 1,368,806 at years 20 / 40 / 60.
- `analyze.mjs` and `heapanalyze.mjs` build their default source-map path wrongly on Windows (`C:\C:\…`); `--map` works
  around it.

PI-1 asks for fixtures re-grown on the final sim, so the **live** fixtures are the baseline. Snapshot dense1m runs
alongside it to link to the plan's §2 numbers.

## 2. Headline: whole-sim CPU per simulated day (node, protector intact)

Method (`pi1Day.ts`, §7.11):
- **Arms:** two isolates (worker threads), fixtures loaded with zlib + `decodeBundle`, with the protector probe intact
  in every arm at the start and the end.
- **Rounds:** 32, arms in alternating order. Every round rebuilds the city from the fixture bytes, runs 20 untimed warm
  days, then times the next chunk of days, so every sample measures the same simulated days.
- **Statistics:** median of the per-round means of the two arms, with a 95 % bootstrap CI.
- **A/A:** the paired B/A ratio.
- **Determinism:** both arms end with the same `serializeCity` digest (D1).

| Fixture | Mode | Chunk | **ms/day** (95 % CI) | A/A B/A (95 % CI) | Tick error | D1 | Protector |
|---|---|---:|---:|---|---:|---|---|
| live dense1m | design cadence | 60 d (1.19 s) | **19.78** [19.54, 20.06] | 0.980 [0.962, 0.993] | 2.6 % | ✓ | ✓ ✓ |
| live dense1m | headless | 320 d (1.25 s) | **3.91** [3.83, 4.06] | 0.975 [0.946, 1.011] | 2.5 % | ✓ | ✓ ✓ |
| live bot256 y60 | design cadence | 90 d (1.32 s) | **14.67** [14.24, 14.67] | 0.988 [0.966, 1.012] | 2.4 % | ✓ | ✓ ✓ |
| live bot256 y60 | headless | 320 d (1.17 s) | **3.66** [3.59, 3.76] | 1.014 [0.986, 1.028] | 2.7 % | ✓ | ✓ ✓ |
| snap dense1m | design cadence | 60 d (1.18 s) | **19.73** [19.66, 20.31] | 1.000 [0.987, 1.013] | 2.6 % | ✓ | ✓ ✓ |
| snap dense1m | headless | 320 d (1.24 s) | **3.88** [3.81, 3.97] | 1.012 [0.983, 1.040] | 2.5 % | ✓ | ✓ ✓ |
| stress1m (test defs) | design cadence | 200 d (1.91 s) | **9.57** [9.53, 9.67] | 0.996 [0.976, 1.001] | 1.6 % | ✓ | ✓ ✓ |

**Gate: A/A within ±3 %. All seven medians are inside (0.975–1.014).** Two CIs reach just past −3 %: live dense1m headless
at 0.946 and live dense1m design at 0.962.

Earlier attempts I discarded:
- **16-day chunks** (0.08–0.37 s): tick error up to 20 %, and one A/A of 0.952.
- **A round with Codex lanes active:** snap dense1m headless A/A 1.038 [1.009, 1.125], a gate failure. It was redone
  idle, as NOTE-002 requires.

The design-cadence day is AC5's reference ("the design-cadence whole day ≤ 0.75 × the PI-1 baseline, paired, protector
intact"):
- **live dense1m:** 19.8 ms/day;
- **live bot256:** 14.7 ms/day.

The plan's A/B harnesses measured 52–62 ms on the 4-core cloud box, about 3× slower hardware. The profiler's design
cadence (`--flush`) reads 25.9 / 19.8 ms/day here. It is higher because it loads through `unpackFile` (protector
invalidated) and instruments each hook, the same gap as the plan's 102–136 against 52–62.

## 3. Ultra emulation and where the time goes (node `profile.js`, wall-clock via the shim)

`frames` mode: 90 simulated days at speed 3, 60 fps, a 6 ms synthetic render, 1 run plus 3 repeats per fixture.

| | live dense1m | live bot256 | plan §2 (cloud, dense1m) |
|---|---|---|---|
| Sim per simulated day | **10.1–10.5 ms** (systems 3.9, scheduler 6.3) | **8.5–9.1 ms** | 31–35 ms (systems 15.9–17.8, scheduler 14.9–16.8) |
| Sim per frame p50 / p99 / max | 2.5 / 16.2–18.6 / 18.0–23.2 ms | 2.2 / 14.4–15.1 / 18.7–20.0 ms | 13.1 / 94.8 / 104 ms |
| Month-boundary frame | max 17.5 ms | — | 73–105 ms |
| Emulated days/s (of 20) | 16.33 | 16.33 | 16.0 |
| Traffic cycles in 90 days | 5 | — | 3–4 (of 45 designed) |
| Headless (`profile.js`, `unpackFile`) | 7.9 ms/day | 7.0 | — |
| Allocation (GC log / heap sampling) | 7.6 / 11.1 MB/day | 6.3 / 7.5 MB/day | 6.1–6.5 MB/day |
| Main-thread GC | 0.16 ms/day, worst pause 2.3 ms | 0.16 ms/day | 2.0–2.6 ms/day |

The emulated loop stays at 16.3 days/s even though no frame exceeds 23 ms, as on the cloud box (16.0). So the limit comes
from the emulation's frame and dt model, not from CPU; I did not trace it further. The real browser reaches 20.4–20.6
days/s (§4).

**Shares of ultra sim time** (`kernels.mjs` on the CPU profile; the plan's ultra column for comparison):

| Kernel | live dense1m | live bot256 | plan ultra |
|---|---:|---:|---:|
| K10 population + demographics | 15.3 % | 13.2 % | 23–24 % |
| K3 services catchments / seat filling | **15.3 %** | **17.6 %** | 4.6–6.4 % |
| K2 traffic assignment / matching | 12.2 % | 9.8 % | 7.9–8.8 % |
| K8 utilities | 9.7 % | 7.3 % | 6.5–7.2 % |
| K6 desirability + land value | 6.6 % | 8.0 % | 8.2–9.1 % |
| K13 monthly economy + demand | 6.6 % | 7.0 % | 5.0–6.3 % |
| K9 emergency | 5.0 % | 7.5 % | 5.5–7.1 % |
| K5 NIMBY / pollution splats | 4.4 % | 6.0 % | 3.8–4.0 % (pollution) |
| K1 road / transit search | 4.4 % | 2.5 % | 3.7–5.0 % |
| K3b services access rasters | 3.4 % | 2.5 % | — |
| K4 blur | 3.3 % | 4.1 % | 3.1–3.3 % |
| K12 fire scan | 2.8 % | 2.4 % | 5.9–7.5 % |
| K7 growth | 2.3 % | 2.4 % | 2.2–3.1 % |
| K11 crime | 2.2 % | 2.3 % | 2.7–3.2 % |
| GC | 1.5 % | 1.5 % | 5.7–7.0 % |

Infrastructure passes, back to back (`cycles`, median of 5, wall):

| Pass | live dense1m | live bot256 |
|---|---:|---:|
| traffic cycle | 21.4 ms | 16.5 ms |
| services pass | 14.3 ms | 12.1 ms |
| pollution pass | 5.9 ms | 6.5 ms |
| emergency response refresh | 4.0 ms | 2.6 ms |
| crime pass | 2.3 ms | 2.0 ms |
| utilities full pass | 2.2 ms | 2.8 ms |

**What is surprising:**
- **The infrastructure share is larger and the per-building share smaller than in §2.** The scheduler's budgets are in
  real milliseconds, so a 3× faster CPU fits more infrastructure work into them. That gives more traffic cycles (5
  against 3–4) and more services passes, so services catchments rise from about 5 % to 15–18 % of the ultra sim.
  Comparing shares across machines therefore mixes CPU speed and freshness; AC4 (freshness) and AC5 (CPU) should be
  judged per machine.
- **GC is small here** (1.5 %, 0.16 ms/day, no major GC in 60 days), against 5.7–7.0 % in §2. That is likely node 22's
  V8 plus spare cores for the parallel scavenger. Allocation is similar or higher (6–11 MB/day).
- **Largest allocation sites** (dense1m, heap sampling): population `aggregate` 1.09 MB/day; `fire.daily` 0.62;
  services `finish` 0.52, `shopLand` 0.43 and `prep` 0.40; `buildingList` 0.38. The fire and `buildingList` ones are
  T007's J7.
- **live bot256 has 1.37M residents but costs less than live dense1m (1.15M)** at every cadence (14.7 against 19.8
  ms/day at design cadence). It has 37 % fewer buildings (10.8k against 17.1k) and 40 % fewer road cells, and the sim's
  cost follows buildings and network size more than residents.

## 4. The real game in headless Chromium (ultra quality, speed 3, 90 days, 5 runs per fixture)

`pi1Browser.mjs`: the fixture is imported as a region and run in the game on the real GPU at 1920×1080. Per-frame busy
time is the main-thread time inside rAF callbacks: sim, objects and render submit.

| | live dense1m | live bot256 |
|---|---|---|
| Days/s sustained over 90 days | **20.37** (20.0–20.9) | **20.55** (20.3–20.9) |
| Busy per frame p50 / p99 / max (median of 5) | 5.4 / **27.3** / **41.8** ms | 5.7 / **37.0** / **80.8** ms |
| Long tasks ≥ 50 ms per run | 1 (max 57–73 ms) | 2–4 (max 75–103 ms) |
| Busy main-thread ms per sim day | 22.3 | 23.2 |
| Paused city, busy p99 | 2.6 ms | 2.8 ms |
| Load (import + enter city) | 4.6–4.9 s | 4.5–5.2 s |

Against the §7.9 targets, as an indication only (AC1 is defined on the CI box with a synthetic render; AC2 on R1):
- **AC3 throughput: met** on this machine (≥ 19.5 days/s).
- **Main-thread smoothness: not met.** p99 27–37 ms against ≤ 20 ms, max 42–101 ms against ≤ 33 ms, and long tasks ≥ 50
  ms every run. This is with the sim on the main thread, before W1.

### Finding: the default emergency policy prevents ultra on these cities

With the default setting `emergencyUncovered: 'live'`, the first five runs per fixture never held ultra. Live dense1m
reached 0.05 / 20.0 / 20.4 / 0.12 / 0.05 days/s; live bot256 1.96 / 1.95 / 0.13 / 0.12 / 1.97. A speed trace
(`speedChanged` with stacks) shows the cause: `EmergencyBanner.applyPolicy` (`src/ui/EmergencyBanner.ts:924`). Within
0.3 s of speed 3 it drops to speed 1 with LIVE slow motion (a 1.5 s day), switches back and forth, and pauses (speed 0)
after about 12 s whenever an incident at this city size needs a player dispatch. The stalled runs each also show one
2.7–3.1 s long task. By design the player has to react, but **at 1–1.4M residents ultra is effectively unreachable with
default settings.** The harness therefore sets the player option `'ignore'` (all numbers above) and records it. The
default-policy runs are kept in the raw output (`browser_*_defaultPolicy.json`). For the lead and design: decide whether
big cities should rate-limit these interruptions, and whether AC1–AC3 assume `ignore`.

## 5. Gates

- No `src/**` edits; only `tools/bench/baselines/**` and this report.
- **Reproducible:** A/A within ±3 % for every headline number (§2); every arm deterministic (D1) with the protector
  intact; the profile repeats agree (dense1m frames 10.1–10.5 ms/day over 4 runs, bot256 8.5–9.1).
- Not done: the browser runs have no A/A pair (5 runs per fixture give the spread instead), and the cycle passes use the
  first warm-up run, the plan's convention.
