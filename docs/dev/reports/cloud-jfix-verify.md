# Independent verification of the five J-fix branches (cloud, Oct 27)

Workflow `wf_2d846103-df1` (script copy `docs/dev/workflows/jfix-verify.js`): two adversarial reviewers, read-mostly, on
the lead's test merge `a59f08f` (dev + J2, J4, J7, J8, J10 + LG-01 + the guide copy). **Verdict: all five are exact; no
blocker and no major.** The findings are minors: one code note (J2's radix cutoff), test coverage, and report wording
about where speed-ups come from. The lead takes the J2 cutoff at merge time (exact either way); the rest is recorded here
rather than rewritten in the branch reports.

## J4-nimby, J7-fire, J8-blur, J10-infoof — pass: True

All four branches in my scope (J4-nimby, J7-fire, J8-blur, J10-infoof) are exact. I found no blocker and no major issue. I read each changed function against 614609f and checked iteration order, floating-point operation order, int32 wrap, NaN/Inf/-0 handling and empty or short inputs. Each change keeps the original arithmetic sequence per element, or skips only work that the original does nothing for. Independent differential probes on the premerge tree a59f08f went beyond the branch tests: J4 828 cases (N=64/128/256/512, borders, unaligned views, both real fixtures), J8 73,995 comparisons (N up to 512, r up to 1000, aliasing at every offset), J7 199 checks at fixture scale on the legacy and emergency paths, and J10 59 checks on bot256 and dense1m with full systems. Probes included edits, removals and a save/load in the middle. Every comparison was byte-identical, and two Simulations interleaved in one process agreed, so no cache is shared between instances. The only findings are five minor report issues: wrong or unsupported explanations of speed gaps against the plan (J4, J8), J10's false claim that infoOf already caches per building, J10's utilities gain depending on where the first treatment plant sits in the building list (97 % prefix on dense1m, 4 % on bot256), and J7's 1.41x being the forced list-refresh gain. The probe sources and outputs are in /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/jfixv/j4-10/. Both git trees are unchanged.

### Per branch
- **J4-nimby:** PASS: exact (bit-identical stigma/prestige/campus and nimbyCost); no new cache
- **J7-fire:** PASS: exact (same list contents and order, same Map iteration semantics)
- **J8-blur:** PASS: exact (byte-identical, including -0, Inf and NaN payloads in the probe)
- **J10-infoof:** PASS: exact (same DefInfo / DefDemo objects used at the same points)

### Findings
- **J8-blur (minor).** The report's reason for 1.57x against the plan's 1.81x is wrong. blurDown and upsampleAdd are not part of the timed call.
  - Evidence: docs/dev/reports/local-J8-blur.md says: "The gain here is smaller because blurDown / upsampleAdd, which are unchanged, are part of the timed call." But the J8 harness tools/bench/exact/abDay.ts (lines 78-84, kernel 'blur') times only `a.set(base); blur3(a, tmp, 256, 2); a.set(base); blur3(a, tmp, 256, 1)`. blur3 is 3 x (boxH + boxV), and the new boxHRow, boxHRows4 and fused boxV are verbatim copies of tools/bench/blurJsOpt.ts, the source of the plan's 1.81x, with canRestructure added.
  - Fix: Correct the sentence. The gap comes from the harness (two 256^2 a.set copies inside the timed call, a different machine and method), not from unchanged functions. If the number matters, time blur3 against blurJsOpt.blur3Opt in the same harness.
- **J10-infoof (minor).** The report says infoOf "already caches per building in the live tree". It caches per def-id string, so the plan's main J10 item (a per-building-id infoOf cache) is not done, and the stated reason for skipping it is false.
  - Evidence: src/sim/infra/common.ts:265-273: infoOf does `infoCache.get(b.def)` on a `Map<string, DefInfo>`, which is one string-keyed lookup per call. docs/WASM_PLAN.md J10 row: "Cache infoOf per building id (12.8k string-keyed lookups/day)". docs/dev/reports/local-J10-infoof.md: "infoOf itself. It already caches per building in the live tree (common.ts ...) ... So J10 removes repeated lookups instead of adding a cache." (rt.defOf does cache per id, but that is a different function.)
  - Fix: Correct the report and the T007 summary. If the per-building-id cache is still wanted, it needs invalidation on b.def change and id reuse, and on clearInfoCache, plus the unknown-def guess that depends on zone and wealth. It would be a separate fix with its own exactness test.
- **J10-infoof (minor).** The utilities 1.055x gain depends on where the first functional treatment plant sits in the building Map order. It was measured only on dense1m, where that prefix covers almost the whole list, and a bot-built city gets almost nothing.
  - Evidence: Probe /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/jfixv/j4-10/treatPos.ts found the first functional treatment plant at these list indexes: dense1m_s7 16,701 of 17,154 (prefix 97.4 %), bot256_s7_y60 473 of 11,276 (prefix 4.2 %), stress1m_testdefs none (100 %). The reuse covers only the prefix, because the scan breaks there. This fits the report's own bot256 whole-day 0.992 [0.992, 1.002] against dense1m 1.004.
  - Fix: State in the report and summary that the utilities gain scales with the treatment-scan prefix and is close to zero for cities that build water treatment early. Measure the kernel on bot256 too.
- **J4-nimby (minor).** The report's explanation for 1.13x against the plan's figure does not hold. The plan also lists a whole-rebuild figure of 1.24-1.37x, and the plan's fair-JS NIMBY arm cached the corridor raster and used table-resolution splats, which J4 does not port.
  - Evidence: docs/dev/reports/local-J4-nimby.md: "The plan measured the kernel at 1.25-1.28x. Here the whole rebuildNimby gains 1.13x, because the building splats ... are part of what is timed." docs/WASM_PLAN.md J4 row: "kernel 1.25-1.28x in node ...; rebuild 1.24-1.37x vs today". The tools/bench/fieldPasses/core.ts header describes the nimby case as "fair JS / wasm = the source list rebuilt from the calls (table resolution) + one kernels.nimby call, corridor raster cached", and the 'as-is' nimby case already includes the building splatAdd calls.
  - Fix: Reword: J4 ports only the indexOf skip and the word scan. The plan's rebuild-level gain also relied on a cached corridor raster and table splats, which are out of J4's scope. Whole-day impact is about 1.00 either way.
- **J7-fire (minor).** The "fire daily step 1.41x" figure mostly measures the building-list refresh the harness forces on every call. In a real game the changed burning loop never runs, and the refresh is paid by whichever system calls buildingList first.
  - Evidence: tools/bench/exact/abDay.ts:85-86 (J7 branch): `kernelCall = () => { sim.state.day++; sim.getSystem('fire').daily(sim); }`, so every call rebuilds the 17k list (c.day !== st.day). EmergencySystem has `readonly active: boolean = true` (src/sim/infra/emergency.ts:750), so FireSystem.daily returns through adoptOrphans/persist before the legacy burning loop J7 rewrote. Utilities, traffic, pollution, services and crime run before fire and also call buildingList, so in a real day the refresh is not fire's cost.
  - Fix: Label the number as the building-list refresh gain, or time fire.daily on an unchanged day (cached list) to isolate the fire-specific part. The whole-day 1.013 / 1.000 remains the meaningful result.

<details><summary>Raw result (JSON)</summary>

```json
{
 "pass": true,
 "perBranch": [
  {
   "branch": "J4-nimby",
   "verdict": "PASS: exact (bit-identical stigma/prestige/campus and nimbyCost); no new cache",
   "evidence": "Line by line (src/sim/infra/nimby.ts): (1) Landfill pass. Row pairs that contain landfill still run the original per-block loop. lfNext is always the first Zone.Landfill (=10) index at or after the current row pair's start: it starts as indexOf(10), stays unchanged on a skip because lfNext >= rowEnd, and becomes indexOf(10, rowEnd) after a processed pair. So only landfill-free pairs are skipped, and those never splat. Splat order and `touches` are unchanged, and the loop exits early only when no landfill is left. A short or long zone array behaves as before, because indexOf past the end returns -1, the same as an undefined read. (2) Corridor pass. The test is the exact has-zero-byte test applied to word ^ (5*0x01010101) and word ^ (6*0x01010101). It is byte-order independent. |h| < 2^31, so h - 0x01010101 is exact in a double, and ToInt32 applies the 2^32 wrap. A word is skipped only when none of its 4 bytes is Highway or Rail, and the original ignores such cells. A word with a match, the tail, and unaligned or short views use the original per-cell code in index order. st.network is a Uint8Array, and deserializeCity copies into the state's own arrays, so loaded cities keep offset 0 and the fast path. Probe /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/jfixv/j4-10/nimbyProbe.ts (output nimbyProbe.out): 828 cases with 0 diffs. They cover synthetic cities at N=64/128/256/512 with landfill rectangles on the borders and at odd offsets, all four corners, and a full-landfill map. They have highway and rail lines on rows and columns 0, 1, N-2 and N-1 with random bridge and tunnel flags, 47 real catalog splat defs plus ID/IM/CS3/CO3 growables placed at map edges with burnt and abandoned flags, plant-load stubs that return NaN, -0 and Infinity, network views at byte offsets 1-4, and a second rebuild after an edit (cached cost path). Also covered: bot256_s7_y60 (11,276 buildings, 174 landfill cells) and dense1m_s7 (17,154 buildings), each as loaded and after 8 edits. The Uint32Array view is local to each call, so there is no cross-instance state."
  },
  {
   "branch": "J7-fire",
   "verdict": "PASS: exact (same list contents and order, same Map iteration semantics)",
   "evidence": "buildingList (common.ts) writes the same Map values in the same order into the same cached array object, and shortens it only when the list shrinks. The final contents equal arr.length = 0 + push for every caller, including a nested refresh during a caller's index loop, because no user code runs during the refresh. The cache key (size/nextId/day) is unchanged, so stale-snapshot behaviour is identical too. fire.ts: `for (id of fires.keys()) { f = fires.get(id) }` uses the same live Map iterator semantics as entries(). It visits in the same order when handlers delete, reinsert or append, and it reads the value at visit time just as the entries iterator does. Probe /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/jfixv/j4-10/fireProbe.ts compares FireSystem against the frozen FireSystemOriginal, which has its own list cache. Legacy path on bot256_s7_y60: 40 days, riskBoost 400 (up to 181 simultaneous fires), 25 bulldozes every 7 days, save/load at day 20, giving 124 checks (fires map, infraFires/Rng/Boost/News, event and route log, sha256 of serializeCity) with 0 mismatches. Emergency path (full createSystems with fire swapped): 24 days, up to 151 fires, removals, save/load, giving 75 checks with 0 mismatches. Two full Simulations ran interleaved in one process and agreed, so no cache leaks between instances on these paths."
  },
  {
   "branch": "J8-blur",
   "verdict": "PASS: exact (byte-identical, including -0, Inf and NaN payloads in the probe)",
   "evidence": "boxHRow and boxHRows4 ranges reproduce the original per-x add (x < N-r), write, subtract (x >= r) sequence in both branches: 2r <= N, and r > N-r including r >= N and r = 0. Each of the 4 rows keeps its own double accumulator with the original operation order, and rows are independent when src and dst do not overlap. boxV, fused per column: c = cs[x] + add, write c*inv, then cs[x] = c - sub. This is identical to the three sweeps because colSum is a Float64Array, so storing c is lossless. The initial accumulation is unchanged. canRestructure only admits integer N, integer r >= 0, long enough non-overlapping ArrayBuffer-backed views; everything else runs the untouched original loops. Probe /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/jfixv/j4-10/blurProbe.ts (blurProbe.out): 73,995 comparisons with 0 byte diffs and 0 NaN-payload diffs. N covers 1-9, 13, 31-33, 63-65, 96, 100, 127-129, 256, 257 and 512. r covers 0-6, 8, 16, N/2, N-1, N, N+1, 2N and 1000. Fields include 2^100/2^60 cancellation, subnormals, +-0, +-Inf, NaN payloads and city-like data. The probe ran boxH, boxV, blur3 (field and tmp), boxAverage, boxH into a prefilled dst, and blurDownAdd at f=2/4/8 with shifts. It also aliased src/dst/tmp views at every offset from -2N-1 to 2N+1. All sim radii are integers (TREE_COVER_RADIUS 2, TREE_BELT_REACH 3, PARKING_BOX_R 3, crime 1, pollution 1/2/rr). Note: SharedArrayBuffer-backed arrays (possible in a W3 shared-layer host) take the exact but slow fallback with no warning."
  },
  {
   "branch": "J10-infoof",
   "verdict": "PASS: exact (same DefInfo / DefDemo objects used at the same points)",
   "evidence": "demographics.ts: demoOf is cached in a Map keyed by the def object, and it is now evaluated where targetFrom's first statement used to call it. That is after accessRecord in targetShares and after the cache refresh in updateDemographics. Nothing between targetFrom and wfShare touches it, so it returns the same object, and an exception would surface at the same point. utilities.ts prepareUses: infos[bI] is the infoOf result for the same list[bI] from the treatment scan. Between and inside the two loops nothing mutates st.buildings, b.def, b.wealth, zone or the catalog. The work there is typed-array writes, the producers Map, and pure reads (incineratorShare, waterNear, intakePollution, seaMask, relativeHeight). buildingList cannot refresh mid-pass because size, nextId and day are unchanged. So known defs get the same infoCache object, and unknown defs get the same guessCache or unknownInfo object. useInfo is an instance field, cleared in init and overwritten on every call, so it is not shared between Simulations. Probe /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/jfixv/j4-10/j10Probe.ts runs full createSystems against the same list with utilities and population swapped for the frozen j10Original copies, at design cadence. It makes def, wealth and zone edits under buildings and bulldozes. It moves a 1x1 plop to the front of the Map as util_water_treatment, so the prefix becomes 1, and does a save/load mid-run. bot256_s7_y60 ran 30 days (35 checks) and dense1m_s7 ran 20 days at 1.14M pop (24 checks), with 0 mismatches in daily stats and full-state sha256s."
  }
 ],
 "findings": [
  {
   "branch": "J8-blur",
   "severity": "minor",
   "issue": "The report's reason for 1.57x against the plan's 1.81x is wrong. blurDown and upsampleAdd are not part of the timed call.",
   "evidence": "docs/dev/reports/local-J8-blur.md says: \"The gain here is smaller because blurDown / upsampleAdd, which are unchanged, are part of the timed call.\" But the J8 harness tools/bench/exact/abDay.ts (lines 78-84, kernel 'blur') times only `a.set(base); blur3(a, tmp, 256, 2); a.set(base); blur3(a, tmp, 256, 1)`. blur3 is 3 x (boxH + boxV), and the new boxHRow, boxHRows4 and fused boxV are verbatim copies of tools/bench/blurJsOpt.ts, the source of the plan's 1.81x, with canRestructure added.",
   "fix": "Correct the sentence. The gap comes from the harness (two 256^2 a.set copies inside the timed call, a different machine and method), not from unchanged functions. If the number matters, time blur3 against blurJsOpt.blur3Opt in the same harness."
  },
  {
   "branch": "J10-infoof",
   "severity": "minor",
   "issue": "The report says infoOf \"already caches per building in the live tree\". It caches per def-id string, so the plan's main J10 item (a per-building-id infoOf cache) is not done, and the stated reason for skipping it is false.",
   "evidence": "src/sim/infra/common.ts:265-273: infoOf does `infoCache.get(b.def)` on a `Map<string, DefInfo>`, which is one string-keyed lookup per call. docs/WASM_PLAN.md J10 row: \"Cache infoOf per building id (12.8k string-keyed lookups/day)\". docs/dev/reports/local-J10-infoof.md: \"infoOf itself. It already caches per building in the live tree (common.ts ...) ... So J10 removes repeated lookups instead of adding a cache.\" (rt.defOf does cache per id, but that is a different function.)",
   "fix": "Correct the report and the T007 summary. If the per-building-id cache is still wanted, it needs invalidation on b.def change and id reuse, and on clearInfoCache, plus the unknown-def guess that depends on zone and wealth. It would be a separate fix with its own exactness test."
  },
  {
   "branch": "J10-infoof",
   "severity": "minor",
   "issue": "The utilities 1.055x gain depends on where the first functional treatment plant sits in the building Map order. It was measured only on dense1m, where that prefix covers almost the whole list, and a bot-built city gets almost nothing.",
   "evidence": "Probe /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/jfixv/j4-10/treatPos.ts found the first functional treatment plant at these list indexes: dense1m_s7 16,701 of 17,154 (prefix 97.4 %), bot256_s7_y60 473 of 11,276 (prefix 4.2 %), stress1m_testdefs none (100 %). The reuse covers only the prefix, because the scan breaks there. This fits the report's own bot256 whole-day 0.992 [0.992, 1.002] against dense1m 1.004.",
   "fix": "State in the report and summary that the utilities gain scales with the treatment-scan prefix and is close to zero for cities that build water treatment early. Measure the kernel on bot256 too."
  },
  {
   "branch": "J4-nimby",
   "severity": "minor",
   "issue": "The report's explanation for 1.13x against the plan's figure does not hold. The plan also lists a whole-rebuild figure of 1.24-1.37x, and the plan's fair-JS NIMBY arm cached the corridor raster and used table-resolution splats, which J4 does not port.",
   "evidence": "docs/dev/reports/local-J4-nimby.md: \"The plan measured the kernel at 1.25-1.28x. Here the whole rebuildNimby gains 1.13x, because the building splats ... are part of what is timed.\" docs/WASM_PLAN.md J4 row: \"kernel 1.25-1.28x in node ...; rebuild 1.24-1.37x vs today\". The tools/bench/fieldPasses/core.ts header describes the nimby case as \"fair JS / wasm = the source list rebuilt from the calls (table resolution) + one kernels.nimby call, corridor raster cached\", and the 'as-is' nimby case already includes the building splatAdd calls.",
   "fix": "Reword: J4 ports only the indexOf skip and the word scan. The plan's rebuild-level gain also relied on a cached corridor raster and table splats, which are out of J4's scope. Whole-day impact is about 1.00 either way."
  },
  {
   "branch": "J7-fire",
   "severity": "minor",
   "issue": "The \"fire daily step 1.41x\" figure mostly measures the building-list refresh the harness forces on every call. In a real game the changed burning loop never runs, and the refresh is paid by whichever system calls buildingList first.",
   "evidence": "tools/bench/exact/abDay.ts:85-86 (J7 branch): `kernelCall = () => { sim.state.day++; sim.getSystem('fire').daily(sim); }`, so every call rebuilds the 17k list (c.day !== st.day). EmergencySystem has `readonly active: boolean = true` (src/sim/infra/emergency.ts:750), so FireSystem.daily returns through adoptOrphans/persist before the legacy burning loop J7 rewrote. Utilities, traffic, pollution, services and crime run before fire and also call buildingList, so in a real day the refresh is not fire's cost.",
   "fix": "Label the number as the building-list refresh gain, or time fire.daily on an unchanged day (cached list) to isolate the fire-specific part. The whole-day 1.013 / 1.000 remains the meaningful result."
  }
 ],
 "summary": "All four branches in my scope (J4-nimby, J7-fire, J8-blur, J10-infoof) are exact. I found no blocker and no major issue. I read each changed function against 614609f and checked iteration order, floating-point operation order, int32 wrap, NaN/Inf/-0 handling and empty or short inputs. Each change keeps the original arithmetic sequence per element, or skips only work that the original does nothing for. Independent differential probes on the premerge tree a59f08f went beyond the branch tests: J4 828 cases (N=64/128/256/512, borders, unaligned views, both real fixtures), J8 73,995 comparisons (N up to 512, r up to 1000, aliasing at every offset), J7 199 checks at fixture scale on the legacy and emergency paths, and J10 59 checks on bot256 and dense1m with full systems. Probes included edits, removals and a save/load in the middle. Every comparison was byte-identical, and two Simulations interleaved in one process agreed, so no cache is shared between instances. The only findings are five minor report issues: wrong or unsupported explanations of speed gaps against the plan (J4, J8), J10's false claim that infoOf already caches per building, J10's utilities gain depending on where the first treatment plant sits in the building list (97 % prefix on dense1m, 4 % on bot256), and J7's 1.41x being the forced list-refresh gain. The probe sources and outputs are in /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/jfixv/j4-10/. Both git trees are unchanged."
}
```
</details>

## J2-traffic — pass: True

J2 (traffic.ts: radix sort of the match keys, cached stop x/z, reused scratch) is exact: no blocker or major. Every changed function was argued bit-identical line by line, and differential probes found no difference anywhere.

- **Radix sort:** the digits match the histogram on every pass. It falls back to the native sort for NaN, ±Inf, -0, negative or ≥2^53 keys and below 64 keys. Equal keys have identical bits, so sort stability cannot matter.
- **Cached stop x/z:** filled in the same prepTransit that builds the bins, before any nearStops call. init() resets the cycle, and road.N equals st.size from PH_PREP onward.
- **Reused scratch:** each buffer is zero-filled, -1-filled or fully overwritten, and none escapes its call. poolTk/poolCarTk keep exact length nc. The routeCand guard is sound, and all new fields are per instance.
- **Frozen copy:** equals 614609f except for renames and import paths. premerge's traffic.ts is identical to the branch's.

**Probes:**
- 10,900 sort cases (9,869 through the radix path, 58.5M keys): 0 byte diffs.
- City probe: 784 steps compared field by field on 64/100/128 transit cities with stops on the map edges. It included a real mid-overflow interruption (save/load, a new city, a switch to 64) and size switches on one instance. All identical.
- The three fixtures (bot256, dense1m, stress1m): 3 cycles each with a mid-cycle save/load, every step identical.
- Harness power: injected mutations are caught at the first comparison.
- Gates: the J2 vitest file passes 7/7 on premerge, and tsc --noEmit is clean.

**Minor notes:**
- Raise the radix cutoff from 64 to about 1024. Between 64 and about 700 keys the radix path is 2–11x slower, although that is at most about 12 µs per round.
- The report's 'because this tree also removes the per-call allocations' is unsupported. The plan's fair core also reused scratch. The measured 1.071x whole day is consistent with the cycle gain alone.
- Clarity: nearStops keeps an unused `_N` and relies on an undocumented invariant. The report says every buffer is filled, but inScale is not (it is fully overwritten).
- Optional test coverage: a legal-size city with garages and a real interrupted overflow.

**Probe files:** all in /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/jfixv/j2/: sortProbe.ts, cityProbe.ts, fixtureProbe.ts, sortBench.ts, harness.ts, and gate.mjs (pauses my probes while another workflow's timing job runs).

**CPU etiquette:** two of my runs overlapped the other workflows' timing.
- sortProbe (about 10 s of one core) ran during b3work's h_bot256_s7_y60_tree_1. Its idlegate logged otherCpuSec 9.75 and otherCoresAvg 0.716.
- tsc (6 s, single-threaded, nice 19) ran during b2work's trafficmap-profile.js at about 16:52.

Those two samples may need redoing. All later runs went through gate.mjs.

### Per branch
- **J2-traffic:** Exact. No blocker or major found; 4 minor notes. Every changed function gives bit-identical results and state for every reachable input I could find.

### Findings
- **J2-traffic (minor).** The radix cutoff (nc < 64 uses the native sort) is far below the measured crossover. For 64 to about 700 keys the radix path is 2–11x slower than the native sort, because its cost is fixed: up to 5 x 2048 histogram clears and prefix sums.
  - Evidence: sortBench.ts on this box (node 22.22), native vs radix µs per sort. nc=64: 1.22 vs 13.42. 128: 3.26 vs 13.90. 256: 5.12 vs 16.53. 512: 12.96 vs 25.27. From 1024 the radix path wins: 52.8 vs 26.9 (1.96x). 4096: 2.85x. 12,338 (the dense1m origin count): 3.21x. 40,000: 3.46x. The loss is at most about 12 µs per round, so the effect is negligible and small cities pay it. Exactness is unaffected either way.
  - Fix: Raise the cutoff in sortCandidates (src/sim/infra/traffic.ts, `if (nc < 64)`) to about 1024. Both paths give the same bytes, so the fix stays exact.
- **J2-traffic (minor).** The report attributes part of its speed-up to allocation removal, which the evidence does not support. It says the fix 'beats the plan's measured effect (cycle 1.065x in node), because this tree also removes the per-call allocations'. The plan's 1.065x fair core also reused its scratch, and no ablation separates the allocation removal from the sort and the stop x/z.
  - Evidence: WASM_PLAN J2 row: 'radix sort…, precomputed stop x / z, reused scratch (the fair core)… cycle, original → fair: 1.065x'. The runs also differ in machine (cloud vs Ryzen/Windows), base commit (24f8609 vs 614609f) and harness. The measured numbers do hang together on their own. The cycle drops 17.6 to 15.1 ms (2.5 ms) with one cycle per TRAFFIC_CYCLE_DAYS=2 days, which is 1.25 ms of T005's 19.78 ms/day, about 1.067x. The report measured 1.071x [1.056, 1.096].
  - Fix: In docs/dev/reports/local-J2-traffic.md, drop the 'because …' clause, or back it with an ablation (sort only vs sort plus scratch reuse).
- **J2-traffic (minor).** Clarity. nearStops keeps an unused `_N` parameter, which all 5 callers still compute. It now silently depends on stX/stZ having been filled by the prepTransit that built stopBins. Separately, the report says every reused buffer is 'zero-filled (or -1-filled)', but inScale is not filled.
  - Evidence: The invariant holds today. this.stops changes only in prepTransit, before the bin build. Every cycle runs PH_PREP2 before PH_TRANSIT/TRANSIT2/PARKRIDE, and init() resets the phase. But nothing in the code records the invariant. inScale is exact anyway: every element in [0, conns.length) is written before it is read.
  - Fix: Add a one-line comment on stX/stZ (parallel to this.stops as of the last bin build; only nearStops and the transfer pass read them), or drop the N parameter. Reword the report's sentence about filling.
- **J2-traffic (minor).** Test coverage. The city part of tests/sim/exact/traffic.test.ts never uses a legal region size (64/128/256). The overflow-alias guard (routeCand === ovRouteCand) is exercised only by planting arrays, not by a real interrupted overflow. The gate fixtures have no park & ride garages.
  - Evidence: The test's city factories use sizes 8, 9, 32, 48 and 192 (lineTown). In fixtureProbe, gPrN=0 on dense1m, stress1m and bot256 snap, and bot256 snap has 0 transit stops, so PH_PROVER at city level is covered only by lineTown. My cityProbe covered the gaps: 64/100/128 transit cities with edge stops; a real mid-overflow interruption by save/load, by a same-size new city and by a switch to 64; size switches on one instance. All were identical, so nothing is broken. The note is only about regression protection.
  - Fix: Optional: add a 64- or 128-cell factory with garages to the city test, plus one replaceState in the middle of PH_PROVER, as in cityProbe.ts's prInterrupt scenario.

<details><summary>Raw result (JSON)</summary>

```json
{
 "pass": true,
 "perBranch": [
  {
   "branch": "J2-traffic",
   "verdict": "Exact. No blocker or major found; 4 minor notes. Every changed function gives bit-identical results and state for every reachable input I could find.",
   "evidence": "Line-by-line review of git diff 614609f origin/local/J2-traffic -- src/sim/infra/traffic.ts.\n\n(1) sortCandidates: the digit extraction checks out on every pass. The histogram uses l=v>>>0 and h=floor(v/2^32); pass 2 is ((l>>>22)|(h<<10))&2047, which equals floor(v/2^22)&2047, and the same holds for all passes against the scatter's ((v/2^(11p))>>>0)&2047. The pass count comes from max (bits up to 53, so at most 5 passes). A constant-digit pass is skipped correctly, because counts do not depend on order. Inputs below 64 keys, or with any NaN, ±Inf, -0, negative or ≥2^53 key, take the identical native call. On safe non-negative integers both sorts give the unique ascending sequence, and equal keys have identical bits, so V8's unstable native sort cannot differ. roundMatch keys are floor(max(0,g)*q)*M+o < ~2^51, with no -0 (Math.max(0,-0) is +0), so the radix path is the one used.\n\n(2) stX/stZ: collectStops/this.stops change only at prepTransit:2075, before the bins are rebuilt. No nearStops call comes between them, and init() resets the phase to -1. Every cycle runs PH_PREP2 before transit, originTransit and prGarages, and road.N equals st.size from PH_PREP onward, so the cached integer x/z equal cell%N and (cell-x)/N.\n\n(3) Reused scratch: every reused array has the same type and length as the fresh one it replaces. Each is zero-filled or -1-filled, or (inScale) fully overwritten before it is read. Subarray views keep the same out-of-range semantics. None escapes its call. poolTk/poolCarTk keep exact length nc, so the `c < tk.length` check in poolCars is unchanged. The routeCand/ovRouteCand guard is correct; stage 4 of overflow() always follows ovBegin, so the stale ovRouteCand is never read. All new fields are instance fields (candHist too), so nothing is shared between Simulations.\n\nFrozen copy: tests/sim/exact/trafficOriginal.ts equals 614609f except for renames and import paths (sed+diff: only the header line differs). premerge src/sim/infra/traffic.ts is identical to the branch's.\n\nProbes in /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/jfixv/j2/:\n- sortProbe.ts: 10,900 cases (9,869 through the radix path, 58.5M keys): realistic packed keys up to oN=400k, digit-boundary patterns, the full 2^53 range, specials. 0 byte diffs, tails included.\n- cityProbe.ts: original vs J2, every original field + the city + stepCost compared after every step, 784 steps / 796 comparisons, all identical. Cities: 64/100/128 transit cities with stops on all four edges and P&R garages, edge-stop toggles and a road cut. lineTown P&R overflow interrupted mid-PH_PROVER, while J2's overflow still holds the round's route arrays (reached 3 times), by (a) a save/load, (b) a same-size new city, (c) a switch to 64. A 128 city, then an empty 96 later built up, then 100, then 64.\n- fixtureProbe.ts on bot256_s7_y60, dense1m_s7 (3,086 stops, 12,338 origins) and stress1m_testdefs: 3 cycles each, with a mid-cycle save/load, every step identical.\n- Harness power: injected mutations (2 sorted keys swapped; one cached stX off by 1) are both caught at the first comparison.\n- Also: tests/sim/exact/traffic.test.ts 7/7 on premerge; tsc --noEmit clean on premerge."
  }
 ],
 "findings": [
  {
   "branch": "J2-traffic",
   "severity": "minor",
   "issue": "The radix cutoff (nc < 64 uses the native sort) is far below the measured crossover. For 64 to about 700 keys the radix path is 2–11x slower than the native sort, because its cost is fixed: up to 5 x 2048 histogram clears and prefix sums.",
   "evidence": "sortBench.ts on this box (node 22.22), native vs radix µs per sort. nc=64: 1.22 vs 13.42. 128: 3.26 vs 13.90. 256: 5.12 vs 16.53. 512: 12.96 vs 25.27. From 1024 the radix path wins: 52.8 vs 26.9 (1.96x). 4096: 2.85x. 12,338 (the dense1m origin count): 3.21x. 40,000: 3.46x. The loss is at most about 12 µs per round, so the effect is negligible and small cities pay it. Exactness is unaffected either way.",
   "fix": "Raise the cutoff in sortCandidates (src/sim/infra/traffic.ts, `if (nc < 64)`) to about 1024. Both paths give the same bytes, so the fix stays exact."
  },
  {
   "branch": "J2-traffic",
   "severity": "minor",
   "issue": "The report attributes part of its speed-up to allocation removal, which the evidence does not support. It says the fix 'beats the plan's measured effect (cycle 1.065x in node), because this tree also removes the per-call allocations'. The plan's 1.065x fair core also reused its scratch, and no ablation separates the allocation removal from the sort and the stop x/z.",
   "evidence": "WASM_PLAN J2 row: 'radix sort…, precomputed stop x / z, reused scratch (the fair core)… cycle, original → fair: 1.065x'. The runs also differ in machine (cloud vs Ryzen/Windows), base commit (24f8609 vs 614609f) and harness. The measured numbers do hang together on their own. The cycle drops 17.6 to 15.1 ms (2.5 ms) with one cycle per TRAFFIC_CYCLE_DAYS=2 days, which is 1.25 ms of T005's 19.78 ms/day, about 1.067x. The report measured 1.071x [1.056, 1.096].",
   "fix": "In docs/dev/reports/local-J2-traffic.md, drop the 'because …' clause, or back it with an ablation (sort only vs sort plus scratch reuse)."
  },
  {
   "branch": "J2-traffic",
   "severity": "minor",
   "issue": "Clarity. nearStops keeps an unused `_N` parameter, which all 5 callers still compute. It now silently depends on stX/stZ having been filled by the prepTransit that built stopBins. Separately, the report says every reused buffer is 'zero-filled (or -1-filled)', but inScale is not filled.",
   "evidence": "The invariant holds today. this.stops changes only in prepTransit, before the bin build. Every cycle runs PH_PREP2 before PH_TRANSIT/TRANSIT2/PARKRIDE, and init() resets the phase. But nothing in the code records the invariant. inScale is exact anyway: every element in [0, conns.length) is written before it is read.",
   "fix": "Add a one-line comment on stX/stZ (parallel to this.stops as of the last bin build; only nearStops and the transfer pass read them), or drop the N parameter. Reword the report's sentence about filling."
  },
  {
   "branch": "J2-traffic",
   "severity": "minor",
   "issue": "Test coverage. The city part of tests/sim/exact/traffic.test.ts never uses a legal region size (64/128/256). The overflow-alias guard (routeCand === ovRouteCand) is exercised only by planting arrays, not by a real interrupted overflow. The gate fixtures have no park & ride garages.",
   "evidence": "The test's city factories use sizes 8, 9, 32, 48 and 192 (lineTown). In fixtureProbe, gPrN=0 on dense1m, stress1m and bot256 snap, and bot256 snap has 0 transit stops, so PH_PROVER at city level is covered only by lineTown. My cityProbe covered the gaps: 64/100/128 transit cities with edge stops; a real mid-overflow interruption by save/load, by a same-size new city and by a switch to 64; size switches on one instance. All were identical, so nothing is broken. The note is only about regression protection.",
   "fix": "Optional: add a 64- or 128-cell factory with garages to the city test, plus one replaceState in the middle of PH_PROVER, as in cityProbe.ts's prInterrupt scenario."
  }
 ],
 "summary": "J2 (traffic.ts: radix sort of the match keys, cached stop x/z, reused scratch) is exact: no blocker or major. Every changed function was argued bit-identical line by line, and differential probes found no difference anywhere.\n\n- **Radix sort:** the digits match the histogram on every pass. It falls back to the native sort for NaN, ±Inf, -0, negative or ≥2^53 keys and below 64 keys. Equal keys have identical bits, so sort stability cannot matter.\n- **Cached stop x/z:** filled in the same prepTransit that builds the bins, before any nearStops call. init() resets the cycle, and road.N equals st.size from PH_PREP onward.\n- **Reused scratch:** each buffer is zero-filled, -1-filled or fully overwritten, and none escapes its call. poolTk/poolCarTk keep exact length nc. The routeCand guard is sound, and all new fields are per instance.\n- **Frozen copy:** equals 614609f except for renames and import paths. premerge's traffic.ts is identical to the branch's.\n\n**Probes:**\n- 10,900 sort cases (9,869 through the radix path, 58.5M keys): 0 byte diffs.\n- City probe: 784 steps compared field by field on 64/100/128 transit cities with stops on the map edges. It included a real mid-overflow interruption (save/load, a new city, a switch to 64) and size switches on one instance. All identical.\n- The three fixtures (bot256, dense1m, stress1m): 3 cycles each with a mid-cycle save/load, every step identical.\n- Harness power: injected mutations are caught at the first comparison.\n- Gates: the J2 vitest file passes 7/7 on premerge, and tsc --noEmit is clean.\n\n**Minor notes:**\n- Raise the radix cutoff from 64 to about 1024. Between 64 and about 700 keys the radix path is 2–11x slower, although that is at most about 12 µs per round.\n- The report's 'because this tree also removes the per-call allocations' is unsupported. The plan's fair core also reused scratch. The measured 1.071x whole day is consistent with the cycle gain alone.\n- Clarity: nearStops keeps an unused `_N` and relies on an undocumented invariant. The report says every buffer is filled, but inScale is not (it is fully overwritten).\n- Optional test coverage: a legal-size city with garages and a real interrupted overflow.\n\n**Probe files:** all in /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/jfixv/j2/: sortProbe.ts, cityProbe.ts, fixtureProbe.ts, sortBench.ts, harness.ts, and gate.mjs (pauses my probes while another workflow's timing job runs).\n\n**CPU etiquette:** two of my runs overlapped the other workflows' timing.\n- sortProbe (about 10 s of one core) ran during b3work's h_bot256_s7_y60_tree_1. Its idlegate logged otherCpuSec 9.75 and otherCoresAvg 0.716.\n- tsc (6 s, single-threaded, nice 19) ran during b2work's trafficmap-profile.js at about 16:52.\n\nThose two samples may need redoing. All later runs went through gate.mjs."
}
```
</details>
