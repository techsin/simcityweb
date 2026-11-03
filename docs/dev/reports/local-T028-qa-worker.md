# T028r: worker acceptance harness review and loopback enablement

Date: 2026-11-03. Worktree/branch: `simcityweb-T028`, `local/T028-qa-worker`. Reviewed HEAD: **28a4862**.
Read the full task and WORKER_DESIGN (including §5.4, Appendix A and R16), the previous report, the harness,
and current T031 HostActions/PendingEdits/tool commits, T032 packet host/replica/replies/resyncs, T033
RecoveryMirror, cause-tag/ack APIs and relevant UI callers. No AGENTS.md or CLAUDE.md was found in the
worktree or its ancestor directories checked.

**Loopback is now the default runnable browser path**, using `?simworker=loopback`, current shared digest,
protector, pending/provisional/ghost checks, UI playability and exit teardown. Worker uses the same host switch
and skips before browser startup with **worker host not in this build** until T034 exists. Runtime fallback
is a failure. **No browser acceptance result is claimed**: browsers were expressly prohibited for this turn.

## Review findings and fixes

Locations below point to the resulting implementation of each fix, so they remain useful for review.

| Severity | File:line | Finding and fix |
| --- | --- | --- |
| High | `tools/qa-worker/run.mjs:19`, `harness.mjs:61` | Old gate blocked loopback without a future --w1 flag and claimed only LocalSimHost existed. Current CityScene selects LoopbackSimHost. Loopback is enabled/default; --host worker detects the missing host file before Vite/Playwright import, with the required clear skip. |
| High | `tools/qa-worker/run.mjs:48`, `w1.mjs:82` | Shared digest/query were treated as absent. Automatically build the existing `src/worker/queries.ts` exactDigest export and call `host.query('verify', {})` against the paused replica. No invented hash or replica serialization. |
| High | `tools/qa-worker/harness.mjs:139` | Ack oracle rejected legitimate exact predicted failures at seq 0, making held Level saturation fail in loopback. Accept them only as explicitly allowed exact unposted refusals with false prediction/result; they never satisfy transported ack coverage. |
| High | `tools/qa-worker/harness.mjs:154`, `checks.mjs:422` | Strict sequence increase rejected legitimate coalesced sliders. Allow repeated sequence only for matching setter/key and actual shared done promise identity; all new transported tickets must increase. |
| Medium | `tools/qa-worker/page.mjs:45` | Probe omitted predictions/pending state, so it could not distinguish exact, provisional, transported and unposted results. Record each separately, plus actual promise identity and replica applied watermark. Probe-only drop control cannot consume a seq-0 refusal. |
| High | `tools/qa-worker/checks.mjs:92`, `page.mjs:81` | No pending ghost or hover acceptance despite T031. Two actual canvas strokes in one task force exact then provisional predictions. Observe actual mesh presence, pending claims/hover and clear after Ack replay; require zero reservations/meshes after settlement. |
| High | `tools/qa-worker/driver.mjs:18` | Installing the observer at scene construction could instrument the loading/null world, missing real ghosts. Pause arrival through real Space early, then install after real views and __ready. Setup pause is not counted as command acceptance. |
| Medium | `tools/qa-worker/page.mjs:143`, `checks.mjs:317` | Teardown lacked signal-bound plain evidence and could inspect a replacement null world. End observers on ctx.signal, archive plain data, then measure the captured original world's resources after all synchronous disposal completes. Require abort(dispose), zero pending/ghosts, then playable region return. |
| High | `tools/qa-worker/checks.mjs:452` | Incident lookup reached through ctx.sim.getSystem. Use host.emergency's mirrored incidents and poll for readiness. |
| Medium | `tools/qa-worker/page.mjs:63`, `checks.mjs:378` | Dispatch checked only the input tag; packet replies/resync outcomes were unobserved. Check actual emergency dispatched replay cause seq/tag, cleared cause, reply cmd <= replica.applied and zero unexpected resyncs in healthy acceptance. A resync-lost outcome remains a rejected ticket, never a fabricated ack. |
| Medium | `tools/qa-worker/checks.mjs:201`, `checks.mjs:342` | Stale skips hid existing setSettings/dismissAlert. Use Settings Emergency alerts All and a separate fire site's real close button before dispatching the available fleet; require void ticket settlement and resulting mirrored policy. Coverage now requires 23 UI ops. |
| High | `tools/qa-worker/page.mjs:100` | Save observer dropped the current second SaveReason argument, changing exit saves to manual saves. Forward all arguments unchanged; regression checks save(false, 'exit'). |
| Medium | `tools/qa-worker/page.mjs:93`, `checks.mjs:258` | Save checks described old App persistence and observed only camera/save pill. Also require real host.save(manual) reply and cmd >= its own camera seq, delivered after commands replay. |
| Medium | `tools/qa-worker/checks.mjs:236` | Recovery was wholly marked absent despite integrated T033 mirror. Drive a real UI edit, invoke the real App pagehide handler, inspect its ordered base-bound whitelisted journal, then balance the synthetic lifecycle with pageshow. Worker close-page replay remains a separate W1.3 gate. |
| High | `tools/qa-worker/build.mjs:12` | Broken-build transform only supported local mode. Add actual PacketSimHost.ack settlement withholding for loopback/worker, preserving mutations/replay/other acks; fail closed on source drift and retain strict negative-control verdict. |
| High | `tools/qa-worker/fixture.test.ts:26` | Fixture tested only local; sim.runDays throws on the loopback facade. Parameterize both modes, use loopback's deterministic harness + drain only in node tests, and use host.emergency/host.state. Add real commitAction provisional/ghost/cause/query/abort/correction tests. |
| High, caught during fix review | `tools/qa-worker/checks.mjs:344` | A proposed third fire site at x118 would cluster into first x122. Place at x135 (gap4 from x130 exceeds FIRE_CLUSTER_R3), before dispatch consumes the fleet, and assert distinct incidents. |
| Medium | `tools/qa-worker/README.md:1`, `harness.mjs:3` | Old base, future-host instructions and 196101 bot number were stale. Replace with current commands, explicit skips/limits and the supplied 192899 reference. |

The retained October fixes were also checked: true build transform rather than observer-only control, safe argument
cloning after act, issuing-tool gestures, held brush settlement/sound timing, banner settleUntil waits, readiness reset,
save correlation, lifecycle resume oracle, primary-error preservation, owned-build cleanup and signal handling.

## Files changed

| File | Change |
| --- | --- |
| `tools/qa-worker/harness.mjs` | Current base/default host, switches/check prerequisites, 23 ops, refusal and coalescing validation. |
| `tools/qa-worker/run.mjs` | Loopback enabled, absent-worker preflight, automatic shared digest/protector, host-specific fault transform. |
| `tools/qa-worker/build.mjs` | Real packet-host broken-ack transform with strict anchors/evidence; local transform retained. |
| `tools/qa-worker/w1.mjs` | Current exactDigest and explicit verify query arguments. |
| `tools/qa-worker/page.mjs` | Prediction/pending/promise/mesh/cause/packet/save/gesture evidence; preserve save args; signal disposal and captured-world teardown. |
| `tools/qa-worker/driver.mjs` | Real-view observer installation after early arrival pause; plain session archives; real banner close support. |
| `tools/qa-worker/checks.mjs` | Ghost/provisional/hover, current settings/dismissal, mirror journal, save watermark, cause/reply, teardown and current ack coverage. |
| `tools/qa-worker/selftest.mjs` | Current CLI plus refusal/coalescing, save reason, packet broken-build and teardown/real-view/control regressions. |
| `tools/qa-worker/fixture.test.ts` | Both real host fixture modes and three real commitAction lifecycle tests. |
| `tools/qa-worker/README.md` | Exact desktop/cloud commands, controls, numeric acceptance evidence, available gates and limits. |
| `docs/dev/reports/local-T028-qa-worker.md` | This explicitly requested report. |

No hunk outside the named files. **Infra hunks: none. Cloud-held file changes/requests: none.**
`tools/qa-worker.mjs`, `freeze.mjs` and `tools/bench/browser-check.mjs` remain unchanged.
Changes are uncommitted; no push, merge, branch switch or DONE file.

## Validation and loopback results

| Check | Result |
| --- | --- |
| `node tools/qa-worker/selftest.mjs` | **30 passed, 0 failed**, latest run after fixes. |
| `npx tsc --noEmit` | **PASS**, including the new fixture tests. |
| quiet-gated `npx vitest run tools/qa-worker/fixture.test.ts --maxWorkers=1` | **Could not start**: Vite loading vite.config.ts failed `[plugin externalize-deps] Error: spawn EPERM` in Windows real-path resolution. **0 tests executed**, not a fixture failure/pass. No alternate config or dependency workaround. |
| `node tools/qa-worker.mjs --host worker` | **55 SKIPPED, 0 failed**, each says worker host not in this build; Node exit **3** verified with PowerShell LASTEXITCODE. No build or browser. |
| `git diff --check` | **PASS**. |
| Changed-file encoding | **UTF-8, no BOM** verified. Scratch `validation.json` and `worker-preflight.json` record the non-browser results. |
| Loopback browser/live-frame, real GPU, production build, protector/CDP | **Not run by instruction**. Numeric targets below are requirements, not measured results. |
| Bot/full Vitest/perf | **Not run by instruction/scope**. No balance, RNG or sim behavior changes. |

Selftest names (all passed):

1. CLI: loopback runs by default; worker shares the host switch; local W1 is optional
2. ack oracle: missing, pending, rejected, refused and malformed tickets fail
3. ack oracle: deferred tickets must ALL settle, including void results
4. deadlines: an unresponsive browser read fails without waiting for its promise
5. ack oracle: issuing gestures and dispatch tags are mandatory
6. probe: observes real tickets without changing args, tags, gestures or results; restores on dispose
7. negative control: a real mutation and exact prediction cannot hide a withheld ack
8. probe: late acks after city abort cannot turn into PASS
9. freeze probe: pre-freeze and hidden progress cannot satisfy visible resume; timestamps and frames recorded
10. save markers: byte ranges, day, funds, nextBuildingId and saved camera are continuity markers
11. probe: non-cloneable arguments do not throw into the application command path
12. save correlation: periodic setCamera cannot impersonate a CityScene.save call
13. drop-ack: survives reload until consumed, and is not applied again in a third session
14. ready: stale title readiness and null views cannot pass the city gate
15. only: freeze is isolated; dispatch and save include their explicit prerequisites
16. broken build: production transform replaces the actual host done initializer, fails closed on drift
17. broken build verdict: only the targeted pending ack failure counts; unrelated failures never pass
18. broken build verdict: a failing probe read after a pending ack is not an ack timeout
19. freeze oracle: deadline starts at later resume/visible; hidden, delayed and frozen-frame evidence fails
20. freeze restore: headless minimizes/normalizes, headed brings to front, hidden timeout is specific
21. cleanup: secondary failure preserves primary error and reports cleanup evidence
22. exit status: an entirely skipped run is distinct from acceptance
23. control reporting: report-write failure never announces a successful negative control
24. loopback oracle: exact unposted refusals are classified without satisfying transported ack coverage
25. loopback oracle: only same-key sliders sharing the actual promise may coalesce sequences
26. probe: forwards save reason and observes the real host save watermark
27. broken loopback build: only target settlement is withheld; packet mutation and other acks still complete
28. probe: abort teardown measures the original world even after the scene replaces it
29. ready: instruments the arriving real view after loading views are replaced
30. probe control: an exact unposted refusal cannot consume the dropped transported ack

Fixture test names (typechecked; execution blocked before test discovery):

- QA local fixture grows an inspectable building and supports both manual dispatch commands
- QA loopback fixture grows an inspectable building and supports both manual dispatch commands
- QA loopback tool lifecycle > settles provisional edits after tagged replay, retaining ghosts through each Ack
- QA loopback tool lifecycle > clears pending ghosts and watches on city abort without late feedback
- QA loopback tool lifecycle > routes several authoritative refusals to the issuing tool once per gesture

## Commands and remaining real-GPU gates

The [README](../../../tools/qa-worker/README.md) contains the full absolute worktree/scratch setup and exact commands
for local, loopback, worker, isolated ghosts/freeze, controls and SwiftShader. Main acceptance invocations:

```powershell
Set-Location 'C:/Users/techsin/Desktop/projects/simcityweb-T028'
node C:/Users/techsin/Desktop/projects/simcityweb-T028/tools/qa-worker.mjs --host loopback --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T028r/scratch/loopback.json
node C:/Users/techsin/Desktop/projects/simcityweb-T028/tools/qa-worker.mjs --host loopback --break-ack zone --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T028r/scratch/broken-zone.json
node C:/Users/techsin/Desktop/projects/simcityweb-T028/tools/qa-worker.mjs --host worker --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T028r/scratch/worker.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tools/qa-worker/fixture.test.ts --maxWorkers=1
```

No bot is needed for a harness-only change. If the lead repeats the supplied invariant, run from this worktree:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

Capture its stdout to the supplied scratch folder using a UTF-8 writer. Expected 2015 residents remain
**[61124, 93804, 37971] = 192899**; Medium/Hard and old-save continuation are unchanged by design.
No 256×60 bot, simulation hash or timing number is claimed/required for this harness-only lane.

Browser acceptance checklist (all left for the lead):

- [ ] Full loopback production run exits 0 on real GPU with actual host.kind loopback and real 256-cell views.
- [ ] All **23** UI ops have transported acks; no pending/rejected tickets; exact seq-0 refusals and valid slider coalescing accepted separately. Observed gestures settle with **<=1** failure each.
- [ ] **2** rapid strokes give exact then provisional, **2** visible pending meshes and live hover/claims, then **0** pending edits/ghosts after Ack. Visually confirm neutral pending style and no blink.
- [ ] Raise **>=3** successful acks; held Level paid work then **>=2** flat refusals, **1** settled gesture, **1** post-settlement release sound, **0** early release sounds/toasts.
- [ ] Both distinct dispatch paths preserve target, sent>0/finite ETA, issuing cause seq/tag; third distinct alert dismisses. Settings policy command acknowledges.
- [ ] Packet qres/saved replies have cmd<=applied; **0** unexpected resyncs; authoritative/replica exact digests equal. Protector intact at boot/end/after freeze.
- [ ] Ctrl+S includes its camera in host save cmd; reload/Continue preserves day/funds/next id/layer/policy/building/camera markers and advances days afterwards.
- [ ] PauseMenu save/exit aborts old city, **0** pending/ghost resources in captured old world, then region return is playable. Exercise Ctrl+C/SIGTERM cleanup; no owned preview/build/browser remains.
- [ ] RecoveryMirror pagehide journal contains the UI zone in an ordered matching-base suffix; excludes nonjournal ops. Worker close-page restoration is a separate W1.3/T039 follow-up.
- [ ] Freeze **>=15000 ms**, **0** frozen frames, visible sim resume **<=1000 ms**, **0** crash/error overlays and **0** console errors/page exceptions/crashes. Repeat isolated headless/headed freeze if needed.
- [ ] Broken loopback build exits **1** with **PASS broken-build control**, one target pending-ack failure, **0** unrelated/cleanup failures. Separately exercise cross-session --drop-ack dispatch.
- [ ] Appendix A panels/tools, every overlay/variant, inspector/watch target changes, emergency LIVE, MiniMap/news, New Year, vehicle animation, save/region lifecycle all remain visually/playably correct. Panel/Power smoke checks are automated; full parity is manual.
- [ ] Error-overlay Pause in a separate intentional error fixture (healthy zero-error run explicitly skips it).
- [ ] Repeat worker mode when T034 lands; exactly **1** sim worker, protectors intact in both isolates, same current gates. From T039/W1.3, close-page journal restore must preserve the in-flight edit.

## Plan versus current code and verification limits

- Original task says new-files-only, local-only and push/DONE; this T028r request explicitly authorizes finishing
  the existing harness/report and requires uncommitted changes, no push/DONE. The newer request was followed.
- T031/T032/T033 are present: exact/provisional HostActions, seq-0 exact refusals, coalesced setters, tagged replay,
  replies inside packets, fresh-state resync and RecoveryMirror. No worker/main/cloud code workaround was made.
- §5.4 calls verify dev-only while requiring production QA; the current verify handler/export are present in production.
  The harness builds the actual shared export as an additional production entry.
- Ctrl+S already reaches host.save via App and camera ordering. Both paths are now observed; no fake save ticket.
- `holdCalendar` is newer than the Appendix A command table. Any observed ticket is validated, but this short fixture
  does not force midnight; New Year remains a manual Appendix A check.
- W1.3 worker close-page restore remains explicitly skipped; current loopback mirror write is exercised separately.
- Chromium's hidden-after-active behavior still requires visibility restoration and the later resume/visible timing origin.
- Error-overlay Pause and complete overlay/consumer screenshot parity remain separate manual checks, clearly unclaimed.
- browser-check.mjs already has production wasm kernel checks; its planned real-game worker/actions/save extension
  remains a W1.2 follow-up. This lane's current game actions/save gate is qa-worker.mjs; no existing bench was changed.
- No production build, real browser/GPU, CDP/protector, live loopback fixture, browser broken-build control or actual
  persistence/recovery UI timing was verified. Vitest was blocked by sandbox spawn EPERM; it must be rerun outside
  this restriction. Node oracle success does not establish those browser gates.
