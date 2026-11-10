# T028 report: the worker-mode acceptance harness (desktop, real GPU)

## Cloud carry-over (Nov 3)

Run on the cloud on Nov 10 by the desk3 chain's lane finisher (NOTE-044), after T059. Branch **`cloud/t028`**, from
`local/T028-qa-worker` @ `26fe7fb`. Dev `d8ac140` was merged in (`da85326`). Dev then moved during the work (T061,
T037b), and `7348e09` was merged too (`26d3b36`). This is a verification lane: no browser runs on the cloud any more
(NOTE-061; `lock.sh` refuses them), so every browser gate is in the Desktop QA list below.

**The launcher moved:** T028's 28-line launcher is now **`tools/qa-worker/cli.mjs`**. `tools/qa-worker.mjs` is
T034's W1.2 browser QA, merged into dev with T034 (`5c40d77`). The two files were an add/add conflict. The older
sections below keep `tools/qa-worker.mjs` where they record what was run on the desktop at the time.

### Gap list (required against done; written before the work, G13 and G14 added when the static check found them)

Sources: the task file, NOTE-024/035/037/038/044-048/057/059-061/064, WORKER_DESIGN §5.4, Appendix A, R16 and the
§6 W1.2 and W1.4 rows, the handoff of Nov 4 (`docs/dev/handoff/2026-11-04/README.md`, which lists T028 as desktop
DONE), the desk3 brief, this report and the diff against dev.

| # | Required | State at `26fe7fb` | Cloud action |
|---|---|---|---|
| G1 | Merge dev (NOTE-047 "then merge dev"; the brief) | base 821a8d6, about 280 commits behind; `tools/qa-worker.mjs` added on both sides | merged (`da85326`, dev `d8ac140`; then `26d3b36`, dev `7348e09` with T061 and T037b, no conflict); launcher moved to `tools/qa-worker/cli.mjs` (imports made relative to its folder); T034's file kept at its path |
| G2 | `tools/qa-worker/fixture.test.ts` runs in the full vitest | **never executed**: on the desktop vitest stopped before discovery (`spawn EPERM`, Windows) | run alone and in the full suite here (it is in vitest's default include; tsconfig covers `tools`) |
| G3 | Node selftests and the native protector selftests | 43/0 and both native commands passed on Node 22.12 (desktop) | rerun on the merged tree, Node 22.22 |
| G4 | tsc on the merged tree | passed on the desktop's old base | rerun |
| G5 | Bot identical to dev | not run (no src change) | run on both trees, though no src file differs |
| G6 | Gates: passes against LocalSimHost; broken build fails; nothing under `src/**` changes | local `--w1` 51/0/5 and loopback 53/0/3 with T059 on the real GPU (`abb8ed1`); both broken-zone controls PASS; no src hunk | verified that the merged tree's diff against dev has no `src/**` path; the browser reruns on the merged dev go to the Desktop QA list |
| G7 | Worker mode (`?simworker=1`, the protector in the `sim` isolate, `host.query('verify')`) once T034 is in dev (NOTE-047, 059, 060, 061) | skipped with exit 3: T034 was not in its tree | T034 is in dev (`5c40d77`), so `--host worker` now runs the real gate. Not run here (NOTE-061): **Desktop QA item 1** |
| G8 | The close-page journal restore (§5.4 "From W1.3") | SKIPPED until T039 | still SKIPPED. W1.3 merged into dev (`666f504`) only after this branch's last dev merge. Writing the close-page check needs a browser to develop it against, so it is remaining (a desktop follow-up) |
| G9 | Desktop work saved mid-edit | `local/T028-qa-worker-snap` (`4625a55`, 19:34 UTC Nov 3) holds uncommitted work; `8ef8f7c`, `f22933f`, `abb8ed1` are `wip` commits | checked below |
| G10 | Docs: README, help text, report name the launcher; README said worker "currently" skips; the report said the protector passes only after T059 merges | stale after the merge | updated (T059 is in dev, `b99636f`) |
| G11 | POLISH_BACKLOG line: consolidate the two harnesses after W1.4 (the brief) | none | added under the tooling lines |
| G12 | `.done` line for the cloud lane | the desktop's line only | appended |
| G13 | §5.4 "no crash overlay may appear" (the freeze and the final check), with the real worker host | both checks looked for `.err-card, vite-error-overlay, [data-sim-crash]`; `[data-sim-crash]` was a placeholder that never landed, and W1.2's crash path (in dev since T034) is the "The simulation stopped" modal plus `city.crashed` | found by the static check below; fixed in `7f2ec5d` with a selftest |
| G14 | Worker mode must not fail on a check its host does not have yet (§6 W1.2: "qa-worker green without the journal check") | `recovery mirror` ran for every packet host and requires the localStorage journal the App's pagehide writes. W1.2's WorkerSimHost runs with `journal: false` and a `SnapshotMirror` (`WorkerSimHost.ts:206`, `:343`), so pagehide writes no journal: a certain FAIL on `--host worker` | found by the static check; fixed in `65e1fc7` and refined in `29ed7b1`: the check SKIPS on a worker host whose page holds no journal mirror, with its reason, plus a selftest |

### What was done

- **The merge (`da85326`).** One conflict, `tools/qa-worker.mjs` (add/add). Dev's file (T034, 773 lines) is kept at
  its path. T028's launcher is now `tools/qa-worker/cli.mjs`; its only change is `./qa-worker/harness.mjs` →
  `./harness.mjs` and `./qa-worker/run.mjs` → `./run.mjs`. The README's commands and `--help` name the new path. No
  package script names either file. Every other dev change merged cleanly.
- **Both tools start.**
  - `node tools/qa-worker/cli.mjs --help`: exit 0, prints the help without importing Vite or Playwright.
  - `node tools/qa-worker/cli.mjs --bogus`: `FAIL arguments: unknown option --bogus`, exit 2.
  - `import('./tools/qa-worker/run.mjs')`: the whole module graph resolves (`GPU`, `SWIFTSHADER`, `run`).
  - `node --check` passes on both launchers.
  - T034's `tools/qa-worker.mjs` has no help or dry-run mode; after reading its arguments it starts Vite and Chromium.
    So only its syntax and dependency resolution were checked: `vite` and `playwright` resolve through its own
    `createRequire(package.json)`. Its root is `..` of its own folder, unchanged because the file did not move.
- **The mid-edit work (G9), checked against the commits:**
  - The snapshot `4625a55` is a stash taken 7 minutes before `8ef8f7c` (14:34 against 14:41 -0500), on the same
    parent `28a4862`.
  - The diff from the snapshot to `8ef8f7c` only carries that work further: dismissAlert moves before dispatch on its
    own fire; the recovery mirror's `pagehide` is paired with a `pageshow`; `page.mjs` keeps the world reference for
    the teardown counts; new selftests; the README is rewritten. Nothing from the snapshot is lost.
  - `abb8ed1` is the tree of the desktop's final real-GPU runs (53/0/3 loopback, 51/0/5 local `--w1`). `26fe7fb`
    changes only this report and the `.done`. So the code on this branch is the code those runs measured, plus the
    two import paths above.
- **Static check of the harness against the merged dev.** No browser could run, so the harness's seams in the app were
  checked against the merged source:
  - `--break-ack`'s three source anchors are each still unique: `SimHost.ts:440` and `LoopbackSimHost.ts:337` and
    `:343` (line numbers on `26d3b36`; T061 moved them, the text is unchanged). `WorkerSimHost` extends `PacketSimHost` from `LoopbackSimHost.ts`, so the packet transform also covers
    worker builds.
  - The sim worker is still created with `name: 'sim'` (`WorkerSimHost.ts:48`), the name `w1.mjs` requires.
  - `?simworker=0|loopback|1` still select local, loopback and worker (`CityScene.ts:211`, `main.ts:158`).
  - The command set is unchanged since the lane's base: the 23 UI ops plus `holdCalendar`.
  - The TopBar speed titles still exist, and so do the selectors the driver uses: `.tb-btn`, `.tb-l`, the flyout
    classes, `.mp-canvas`, `.onboard`, `.ob-step`, `data-panel`, `.info-actions` and `.emg-x`. EmergencyBanner still
    has `banners`, `settleUntil`, `send` and `choose`.
  - The checks' UI strings and classes still exist: "Make historic", "Save & exit to region", "Emergency alerts",
    "Loans", "Services", "Resume", `.dv-btn`, `.fund-row`, `.loan-row`, `.loan-actions`, `.pause-menu`, `.menu-item`,
    `.rc-item`, `.set-row`, `.sr-l`, `.tax-row`, `.tool-opts`, `.save-pill` and `.err-card`.
  - Two misses. `[data-sim-crash]` in the crash-overlay selector is rendered by nothing (G13). The recovery-mirror
    check expects a journal that W1.2's worker host does not write (G14).
- **The crash-overlay fix (G13, `7f2ec5d`).** `page.mjs` gains `crashOverlays()`, a page-side read of error cards,
  Vite's overlay, the crash dialog by its title (`src/region/ui/dialogs.ts` `openSimCrashDialog`) and the App's
  `city.crashed`, which `main.ts` `onWorkerCrash` sets. `freeze.mjs` gains `assertNoCrashOverlay(page, where)`, used by
  the freeze check and by `no crash overlay`. Check names and counts are unchanged.
  - Before the fix, a worker crash in a run still failed it, through `console errors` (onWorkerCrash logs an error) and
    usually through the freeze's day-advance check. But the two checks named for the crash overlay were blind to it.
  - New selftest "crash overlay: the W1.2 crash dialog and a crashed city fail the gate; a healthy page passes".
    With the old selector restored in the helper it fails: 43 passed, 1 failed (`not ok 20`). With the fix: 44/0.
- **The worker host's recovery-mirror check (G14, `65e1fc7`, then `29ed7b1`).** `harness.mjs` gains
  `recoveryMirrorSkip(host, journalMirror)`. For a worker host, `checks.mjs` first reads whether the page's host holds
  a journal mirror (`PacketSimHost.mirror`, `LoopbackSimHost.ts:170`).
  - The check skips on local (unchanged) and on a worker host without a journal mirror.
  - It still runs on loopback, on a worker host that journals, and when the read fails, so the check reports the
    page's error.
  - The first version keyed the skip on `--host worker` alone. W1.3 (`cloud/w13`, merging next) turns the worker's
    page-side journal mirror on where the page's store persists (`journal: opts.journal ?? kv.persistent`). Its
    `PacketSimHost.mirror` field is the same. So the skip now follows the mirror, and a journaling W1.3 worker runs
    the check.
  - New selftest "recovery mirror: local and a worker host without a journal mirror skip; loopback and a journaling
    worker run it". It covers each case and pins the `mirror` field the page reads. With the worker skip removed it
    fails: 44 passed, 1 failed (`not ok 20`). With it: 45/0.
- **Docs.** README: the launcher, a pointer to T034's tool, the worker-mode paragraph, the crash-overlay definition
  and the recovery-mirror row. This report: the invocation block and a note under the old "Remaining" list.
  POLISH_BACKLOG: the consolidation line. The `.done`: the cloud line.

### Gates

Logs are in the cloud scratchpad's `t028-logs/`. Heavy runs took the shared lock; tsc and the single-file vitest ran
under the semaphore.

**On the tree that will merge** (`26d3b36` = dev `7348e09` + the lane, with the harness fixes through `29ed7b1`; the
fixes touch only `tools/qa-worker/*.mjs`, which vitest and tsc do not load):

| Gate | Result |
|---|---|
| tsc (`npx tsc --noEmit`) | **exit 0** |
| Full vitest (`npx vitest run --configLoader runner`, with SIM_FIXTURES / SIM_SNAP) | **291 files passed, 3 skipped (294); 2,907 tests passed, 10 skipped, 0 failed**; 482 s; exit 0 |
| `tools/qa-worker/fixture.test.ts` (in the suite above, and alone) | **5 of 5 passed**. It runs in the suite by vitest's default include; no exclusion is needed. These are its first runs anywhere (the desktop's vitest never started) |
| Bot, 128×15 seed 7, this tree against a clean export of dev `7348e09` | both **`residents [ 61124, 93804, 37971 ]` = 192,899**. Output identical apart from the two ms/day timing columns and the run time. No `src/**` file differs from dev |
| Node selftests (`node tools/qa-worker/selftest.mjs`, Node 22.22) | **45 passed, 0 failed** (43 from the desktop, plus the two new ones) |
| Native protector selftests (with and without `--allow-natives-syntax`) | **both PASS** (clean/clone intact; an unrelated transfer: V8 status 81 → 129, persistent; fails closed without native syntax) |
| New tests fail with their fix reverted | crash overlay: 43/1 with the old selector; recovery mirror: 44/1 with the worker skip removed |
| Both tools start | `cli.mjs --help` exit 0, a bad option exit 2, `run.mjs`'s graph resolves; `node --check` on both; T034's tool resolves `vite`, `playwright` and `./qa-worker-control.mjs` (T061) |
| Task gate: nothing under `src/**` changes | **holds**: `git diff --name-only origin/claude/beautiful-johnson-u2jqoz HEAD` lists only `tools/qa-worker/**` and `docs/**` (17 files) |
| Task gates: passes against LocalSimHost; a broken build fails it | **desktop evidence** at `abb8ed1`: local `--w1` 51/0/5, loopback 53/0/3, both broken-zone controls PASS. The reruns on the merged dev are **deferred to Desktop QA (NOTE-061)**, items 2 and 3 |
| Browser evidence | none taken here: the cloud runs no browser (NOTE-061; `lock.sh` refuses them). No screenshot paths |

**First round, on `da85326`** (dev `d8ac140` + the lane): tsc exit 0; full vitest **284 files passed, 3 skipped (287);
2,846 tests passed, 10 skipped**, 510 s; the bot against a clean export of `d8ac140`: both 192,899, identical apart
from the timing columns.

**A trial merge with the newest dev** (`825ee22`, which adds W1.3 `666f504` and FH-12 after `7348e09`). It merges with
no conflict (merge-tree `0be1701`). On an export of that tree:
- tsc exit 0; selftests 45/0; `fixture.test.ts` 5/5; `cli.mjs --help` exit 0.
- The seams still hold: the anchors at `SimHost.ts:447` and `LoopbackSimHost.ts:337` / `:343`; the worker named
  `sim`; `PacketSimHost.mirror`; the crash dialog's title; `city.crashed`.
- W1.3's WorkerSimHost now journals where the store persists (`journal: opts.journal ?? kv.persistent`), which is
  the case G14's runtime read handles.
- This tree was not committed; the merge step gates its own merged tree.

### Desktop QA list (NOTE-059, NOTE-061)

Branch `cloud/t028` at its head (the commit that adds the cloud `.done` line), or dev once it is merged. Use Playwright's Chromium 141
(Playwright 1.56.1, as in this report's runs) on the real GPU, one browser at a time, from the worktree root.
`$s` is a scratch folder.

0. **Before the browser:** `node tools/qa-worker/selftest.mjs` must give 45 passed, 0 failed (the cloud's count on
   Node 22.22).
1. **Worker mode, the open acceptance item (G7):** `node tools/qa-worker/cli.mjs --host worker --out $s/worker.json`.
   - Expected: exit 0, and `host ready` reports kind `worker` (a fallback to local fails).
   - Protectors: `main intact; sim worker intact`, with exactly one dedicated worker named `sim`, at boot, at the end
     and after the freeze.
   - `replica verify`: the worker's exact digest equals the replica's.
   - Freeze: at least 15,000 ms frozen, resume within 1,000 ms, 0 frames while frozen, 0 crash overlays.
   - `no crash overlay` PASS. Since `7f2ec5d` this check also reads W1.2's crash dialog and `city.crashed`.
   - 0 console errors.
   - `recovery journal` SKIPPED (the close-page restore, G8). Before W1.3, `recovery mirror` is SKIPPED too ("this
     WorkerSimHost has no journal mirror", G14). On a dev with W1.3 (`666f504`) and a persistent store it runs and
     must PASS. Report which of the two happened. Every other applicable check PASS.
2. **Loopback and local on the merged dev:** `--host loopback --out $s/loopback.json` (expected 53/0/3, as at
   `abb8ed1` with T059) and `--host local --w1 --out $s/local-verify.json` (expected 51/0/5).
   - Since the desktop's run, dev gained FH-08 (`707a19f`). Tips are on in a fresh profile. So the first alerted fire
     that is major and can be saved by hand (the harness's first fire is uncovered with manual dispatch possible) can
     now open the E1a teaching card. The card takes a teaching pause, adds 210 px to its banner, and sends `setSettings`
     from the banner. In the harness, that first fire is `triggerDisaster`'s, and the `dispatch` / `dispatchBest` /
     `dismissAlert` checks follow it.
   - If one of those checks fails at the card, it is the fixture, not a host bug. Pre-seed the profile pref
     `emergencyTeaching` as seen (or press "Got it" first), rerun, and report which you did.
   - Dev also gained NEW-04's per-region lock (`308ade3`) and LG-21's year review (`6406a0f`). The harness reloads in
     one tab and never reaches a New Year, so neither should show up.
3. **The controls:**
   - `--host loopback --break-ack zone` and `--host local --break-ack zone`: exit 1 with **PASS broken-build
     control**, and only the zone ack pending.
   - New, never run: `--host worker --break-ack zone`, with the same expectation.
   - `--host loopback --drop-ack dispatch`: only the dispatch ack fails.
4. **T034's tool at its path:** `node tools/qa-worker.mjs --out $s/w12`. Expected: the PASS set T034's report records
   (`docs/dev/reports/local-W1.2-worker.md`). This checks that both tools still run side by side.
5. **Only if Playwright's Chromium moves past 141:** a V8 that tracks array buffer views (Chromium 153) does not
   invalidate the detach protector for a no-view or one-view transfer. Add T059's page-side positive control (a
   two-view and a DataView detach) before trusting "intact" (`docs/dev/reports/local-T059-s0-lod-transfer.md`, its
   Desktop QA item 2).

### Decisions (conservative readings, with the evidence)

- **The launcher's new path is `tools/qa-worker/cli.mjs`** (the desk3 brief). §5.4 names `tools/qa-worker.mjs`, which
  is now T034's tool. Choosing one CLI at that path is the backlog line, after W1.4. The task file still says T028
  owns `tools/qa-worker.mjs`; the task file is the lead's, so it was not edited.
- **"Check both still start" without a browser.** The lock refuses browser runs on the cloud (NOTE-061). So this
  check is limited to the launcher's argument handling and module graph, and to T034's syntax and dependency
  resolution. Their browser runs are Desktop QA items 1-4.
- **FH-08 is not worked around in advance.** Without a browser run, a pre-seeded pref would remove real app flow
  from the acceptance run on a guess. Desktop QA item 2 says how to tell a fixture failure from a host failure.
- **The protector's positive evidence stays the desktop's Chromium 141 A/B** (dev without J0 failed, T059 passed).
  The harness pins Chromium 141 through Playwright 1.56.1. A page-side positive control is needed only if that
  changes (Desktop QA item 5).
- **The bot ran although no `src/**` file differs from dev.** The brief asks for it, and it is cheap.
- **Dev was merged a second time (`26d3b36`).** T061 landed during the work and changed the worker host files the
  harness depends on (`LoopbackSimHost.ts`, `WorkerSimHost.ts`, `SimHost.ts`). So the seams were rechecked and every
  gate was rerun on the tree that will merge, rather than leaving that to the merge step.
- **No third dev merge.** W1.3 (`666f504`) and FH-12 landed while the second round of gates ran. A trial merge with
  `825ee22` passed tsc, the selftests and the fixture test, and the seams hold (Gates, last paragraph). The lane
  changes only `tools/qa-worker/**` and docs, and the merge step gates its own merged tree, so another full round
  here would only repeat the merge step's work on the shared lock. G14's skip follows the page's journal mirror, so it
  holds on both sides of W1.3.
- **The close-page journal check (G8) is not written here.** The task file does not ask for it (§5.4 dates it "from
  W1.3"), and a new browser check that cannot be run once would be untested code in the acceptance gate. It is
  listed as remaining for a lane with a browser.
- **Status partial:** the gates are green and the merge is safe. The worker-mode acceptance run (G7, real GPU) and the
  W1.3 journal check (G8) remain.

### Remaining

- `--host worker` on the real GPU, now that T034 is in dev (Desktop QA item 1), plus the loopback/local reruns and
  controls on the merged dev (items 2-4).
- The close-page journal restore check (§5.4 "From W1.3"). W1.3 is now in dev (`666f504`), so this check can be
  written and run on the desktop's browser. The `recovery journal` check is still a SKIPPED placeholder.
- Consolidating `tools/qa-worker.mjs` and `tools/qa-worker/cli.mjs` after W1.4 (POLISH_BACKLOG).


## Final results (NOTE-047 item 1)

**Verdict: done for loopback mode.**
- The harness runs every acceptance item of the task through the real tools on the real GPU, and all of them pass on
  `?simworker=loopback`.
- Worker mode skips with a clear line until T034 (W1.2) is in dev; the journal restore waits for T039 (W1.3).
- The harness also found a real bug outside its own code: Worker plan step S0 (J0) had never landed. It is fixed
  separately in T059.

Branch `local/T028-qa-worker`, history:
- `c703887`: the Oct 27 Codex lane, on `a2578da`;
- `28a4862`: dev `821a8d6` merged in, cleanly;
- the review rounds: `8ef8f7c`, `f22933f`, `abb8ed1`.

### Environment

RTX 5070 Ti (driver 610.47), ANGLE D3D11, Playwright's Chromium 141.0.7390.37 with the real GPU, Windows 10 19045. The
harness builds its own production bundle (vite build + vite preview).

The V8 flags for the protector probe are
`--js-flags=--allow-natives-syntax --no-maglev --no-optimize-on-next-call-optimizes-to-maglev`, recorded in every run's
JSON.

### Runs on the real GPU (round 3, `abb8ed1`)

| Run | Tree | Result |
|---|---|---|
| `--host loopback` | the harness + T059 (J0) | **53 passed, 0 failed, 3 skipped** (the skips: no error card in a healthy build; the W1.3 journal; the --break-ack-only check) |
| `--host local --w1` | the harness + T059 | **51 passed, 0 failed, 5 skipped** |
| `--host loopback` | the harness on dev (no J0) | 51 passed, **2 failed**: "protector at end" and "protector after freeze": the main protector is intact at boot, then invalidated after LOD activity |
| `--host local --w1` | the harness on dev | 49 passed, **2 failed**: the same two protector checks |
| `--host loopback --only freeze` (round 2) | dev | pass: frozen 15,012 ms, 0 frames while frozen, the sim advanced 48 ms after the page became visible |
| `--break-ack zone` (round 2), loopback and local | dev | **the control works:** the temporary build withholds `zone.done`, and only that acknowledgement fails (exit 1 is expected) |
| `--drop-ack dispatch` (round 2) | dev | fails only its dropped dispatch ack, as designed |
| `--host worker` | dev | exit 3, 55 skipped: "worker host not in this build; requires T034 / W1.2 WorkerSimHost" |

What the loopback run (+J0) covers:
- **All 23 UI commands, with transported acknowledgements, through the real tools and panels:**
  - speed: TopBar, keys 1/2/3, PauseMenu resume, Onboarding Play;
  - zone and dezone, network, power line, subway, plop, bulldoze, the InfoPanel Demolish;
  - trees, a held terraform brush that reaches flat (one release sound, no toast);
  - tax, funding, loan and repay, an ordinance, settings, setHistoric;
  - triggerDisaster, dismissAlert;
  - dispatch through the banner and DispatchTool, and Send nearest.
- **Ghosts:** two real strokes, exact then provisional, with both ghosts kept through the ack.
- **Packet replies and cause tags:** each dispatch event carries its original seq and tag.
- **The recovery mirror:** the App's pagehide wrote 7 whitelisted edits bound to the snapshot.
- **Saves:** Ctrl+S's camera ticket and the manual save reply are acknowledged in order. Save → reload → Continue
  preserves the day, funds, nextBuildingId, the camera, the layers and the player's edits.
- **The region:** exit to the region and back to a playable city.
- **The replica:** authoritative = replica = `3826532553`.
- **Panels and views:** every Appendix A panel and a data view open and render.
- **Health:** 0 console errors, 0 page exceptions, 0 crashes, and full cleanup.

### The protector finding (J0, now T059)

`src/render/city/buildings/lodBuilder.ts:138` posted the LOD job arrays with a transfer list from the main thread, so
the first LOD job detached ArrayBuffers there and invalidated the main isolate's ArrayBuffer-detaching protector.
- WORKER_DESIGN §6 row S0 asks for `w.postMessage(msg)` with no transfer list. It never landed.
- T059 (`local/T059-s0-lod-transfer`) makes that change.
- The A/B above shows the effect: on dev the main protector is intact at boot and invalidated by the end of the run;
  with T059 it stays intact at boot, at the end and after the freeze, on both hosts.

### Remaining for this task

- Worker-mode acceptance, once T034 is in dev: rerun with `--host worker`. The checks are written and skip cleanly
  today.
- The close-page journal restore, once T039 (W1.3) lands.
- The protector check passes on dev only after T059 merges. Until then, a dev run reports the J0 bug, correctly.
- *(Cloud, Nov 10: T034 is in dev at `5c40d77` and T059 at `b99636f`. The worker run is Desktop QA item 1 of the carry-over
  section above.)*

Logs and JSON outputs are in the worker's scratch (`t028/r3/`, plus `t028/` for round 2 and `t028/round1/`).

## Review round 3 — f22933f

The lead reran the round-2 harness on **Chromium 141 / RTX 5070 Ti**. Read the supplied logs in
`C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/t028/`
and its `x59/` subdirectory. `x59` is the lead's temporary merge with `local/T059-s0-lod-transfer`, which changes
the main LOD post to clone-only. These are results for **f22933f**, before the fix below; no browser was launched here.

| Supplied run | PASS / FAIL / SKIPPED | Remaining failure |
| --- | --- | --- |
| dev loopback | 50 / 3 / 3 | Main protector initialization at boot, end and after freeze. |
| dev local | 47 / 0 / 9 | None; optional protector/verify gates were disabled. |
| dev local --w1 | 48 / 3 / 5 | Same three main protector initialization failures. |
| T059 merge loopback | 50 / 3 / 3 | Same three failures despite clone-only LOD posts. |
| T059 merge local --w1 | 48 / 3 / 5 | Same three failures. |

The isolated freeze passed **8 / 0 / 48**: **15007 ms**, **0** frozen frames, **45.2 ms** visible resume. Both real
broken-ack controls passed their control verdict and exited **1**, **9 / 1 / 47**, with only pending zone seq **4**
(loopback) / **5** (local) failing. `--drop-ack dispatch` retained pending dispatch seq **13**; its dispatch check
and aggregate ack check failed for that same ticket, alongside the three known protector initialization failures
(**46 / 5 / 5**). Worker mode exits **3**, **55 skips**, because T034 is absent. The earlier Onboarding, Query/InfoPanel, dispatch input, lifecycle
and negative-control harness fixes now pass their relevant gates. No new host/packet/query/ack defect is demonstrated.

### Finding and fix

**High / harness, reviewed f22933f `tools/qa-worker/w1.mjs:17-28`:** the bit-16 initialization test rejected
Chromium's **41, 41, 41, 41** statuses even though native syntax was working. Optimization-status bit assignments
vary by V8 version; the numeric value alone does not establish the active tier. Accepting another bit or relaxing
status equality would not prove that the typed-array loop retained the detachment dependency the check needs.

The probe now establishes TurboFan synchronously before application imports using
`%PrepareFunctionForOptimization` and `%OptimizeFunctionOnNextCall`, and checks the actual active tier with
`%ActiveTierIsTurbofan`. `%GetOptimizationStatus` remains diagnostic only. The sampled typed array stays attached;
a transfer of a different buffer must invalidate its isolate-wide dependency and stop the probe remaining in
TurboFan. Failure is sticky, including across an attempted reinstall. Missing native syntax, unsupported intrinsics
and failure to establish the required tier fail closed with their actual diagnostic.

**High / harness, reviewed f22933f `checks.mjs:278-287`, fixed `w1.mjs:98`:** reload replaces the probe's global.
A retained renderer isolate could then compile a new loop with explicit detached-buffer checks after an earlier
invalidation, hiding it. The save/reload path now checkpoints main and sim before navigation and retains any failure
for the later protector gates, while allowing the save/Continue UI checks to finish. Browser check names/counts are unchanged.

The V8 primary sources expose the explicit tier predicate in
[runtime-test.cc](https://raw.githubusercontent.com/v8/v8/main/src/runtime/runtime-test.cc) and define the current
status bits in [runtime.h](https://raw.githubusercontent.com/v8/v8/main/src/runtime/runtime.h). These are current
upstream sources, not a pinned Chromium 141 bitfield claim; the probe therefore uses the predicate directly.

`PROTECTOR_V8_FLAGS` centralizes these process-wide flags in `w1.mjs`:

```text
--allow-natives-syntax --no-maglev --no-optimize-on-next-call-optimizes-to-maglev
```

`run.mjs` supplies them to Chromium as the single argument
`--js-flags=--allow-natives-syntax --no-maglev --no-optimize-on-next-call-optimizes-to-maglev` and records the flags
in JSON `details.v8Flags`. The flags and tier assertion apply to main and the dedicated simulation worker named
`sim`. Independent LOD workers remain outside the sim-isolate gate and are resumed normally. The exact
[V8 14.1 flag definitions](https://raw.githubusercontent.com/v8/v8/ad8af0fc661d278e87627fcaa3a7cf795ee80dd8/src/flags/flag-definitions.h)
expose these tier controls. No application or performance-harness code changed; these flags apply to the acceptance harness.

### Files, commands and validation

| File | Change this round |
| --- | --- |
| `tools/qa-worker/w1.mjs` | Central V8 flags; explicit TurboFan baseline and active-tier check; numeric status diagnostics; sticky failed baseline. |
| `tools/qa-worker/run.mjs` | Use the shared Chromium V8 flags and record them in report details. |
| `tools/qa-worker/checks.mjs` | Checkpoint the old isolate before reload without masking or aborting the save/Continue checks. |
| `tools/qa-worker/protector-selftest.mjs` | Repeated clean and clone success; unrelated-buffer transfer detaches and fails persistently; reinstall cannot reset failure; unsupported native syntax fails closed. |
| `tools/qa-worker/selftest.mjs` | Simulated native-tier regressions for status 41, status drift, missing TurboFan, sticky failure and reload retention. |
| `tools/qa-worker/README.md`, this report | Exact flags/commands, supplied GPU results, classification and remaining browser controls. |

Run from this worktree, one process at a time:

```powershell
$root = 'C:/Users/techsin/Desktop/projects/simcityweb-T028'
node "$root/tools/qa-worker/selftest.mjs"
node --allow-natives-syntax --no-maglev --no-optimize-on-next-call-optimizes-to-maglev "$root/tools/qa-worker/protector-selftest.mjs"
node --no-maglev --no-optimize-on-next-call-optimizes-to-maglev "$root/tools/qa-worker/protector-selftest.mjs"
```

**43 Node selftests passed, 0 failed.** New test names:

- protector probe: active TurboFan passes with status 41; status drift alone cannot fail it
- protector probe: numeric status cannot substitute for an active TurboFan dependency
- protector gate: reload cannot erase an earlier isolate invalidation

Both native commands above passed on **Node 22.12.0**. Repeated clean/clone checks retained TurboFan (**status 81**);
the unrelated buffer detached (**byteLength 0**) and the dependency deoptimized (**status 129**, TurboFan false),
with failure preserved through repeated checks and reinstallation. Omitting native syntax failed closed with
SyntaxError. These Node results do not establish the new Chromium tier path.
Syntax checks of `run.mjs` and `checks.mjs` passed. `git diff --check` and UTF-8-without-BOM checks passed.
No browser, production build, Vitest, bench, bot, commit, push, merge or DONE marker is part of this review.
**Infra/outside-owned source hunks: none. Cloud-held file changes or new requests: none.** The existing J0 request
is addressed by the lead's separate T059 branch; it is not implemented in this worktree. No balance/RNG/simulation
changes; the unchanged optional seed-7 bot expectation remains **[61124, 93804, 37971] = 192899**, unrerun.

### Browser controls left for the lead

Use the same [README commands](../../../tools/qa-worker/README.md) against each build prepared by the lead:

- [ ] Clean T059 merge: full loopback and local `--w1` keep main intact at boot, end and after freeze; all other applicable checks pass. Repeat the >=15000 ms freeze gate with <=1000 ms visible resume, 0 frozen frames and 0 overlays/errors.
- [ ] dev with main LOD transfers: after LOD activity, main protector fails. This is the expected render-side J0 failure, distinct from unavailable/unsupported-probe initialization.
- [ ] Deliberate transfer control: a transfer of an unrelated main-thread buffer detaches it and makes the probe fail persistently; clean polls and clones pass. The native selftest exercises this without a browser; Chromium behavior remains to be confirmed by the two builds.
- [ ] Both real broken-zone builds still exit 1 with **PASS broken-build control**, exactly their pending-zone acknowledgement failure, and no unrelated failure on the clone-only build.
- [ ] `--drop-ack dispatch` still fails only its transported dispatch acknowledgement on the clone-only build; worker preflight remains exit 3 until T034. When T034 lands, require the same intact baseline in exactly one dedicated `sim` worker.

Plan versus code: the acceptance check still measures loss of an optimized typed-array loop's detachment
dependency; it now requires an explicit TurboFan tier instead of decoding a version-dependent bitfield. The forced
tier is harness-only, and the browser's native intrinsic behavior and dev/T059 contrast remain unverified here.
The prior report below is preserved as historical evidence.

## Review round 1 — 8ef8f7c

Read all eight `.log`/`.json` pairs in
`C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/t028/`:
loopback, freeze, broken-zone, broken-local-zone, probe-control, local, local-verify and worker.
These are the lead's **Chromium 141 / RTX 5070 Ti** results from the pre-fix build; no browser was launched here.

| Supplied run | PASS / FAIL / SKIPPED | Evidence |
| --- | --- | --- |
| loopback | 42 / 8 / 6 | Ghosts, brush, replica verify, journal, save/Continue and exit passed; dispatch never issued a ticket. |
| local | 42 / 5 / 9 | Same Onboarding/Query failures; both dispatch commands passed; freeze failed. |
| local-verify | 43 / 7 / 6 | Same reference failures, plus unrelated LOD probe initialization failures. |
| freeze | 7 / 1 / 48 | Day **91** before arming, **1369** later frames; no freeze/resume/visible timestamps despite 15004 ms external sleep. |
| broken-zone | 8 / 2 / 47 | One transform; real pending zone **seq 4**; poll deadline misclassified it as missing-command. |
| broken-local-zone | 8 / 2 / 47 | One transform; real pending zone **seq 5**; same poll bug. |
| probe-control | 42 / 8 / 6 | Dispatch never posted, so its observer fault was not consumed; not yet a valid negative control result. |
| worker | 0 / 0 / 55 | Expected absent-host skip; exit 3. |

### Classification, fixes and exact source evidence

| Severity / classification | Location | Finding and fix |
| --- | --- | --- |
| High / harness | `tools/qa-worker/driver.mjs:104`; `src/ui/hud.css:407-415` | Play exists but its non-current step action intentionally has opacity 0 and pointer-events none until the row is hovered. Hover the actual Play row, wait with a trial click for actionability, then observe the real click. No forced click, style mutation or direct command. |
| High / harness | `tools/qa-worker/driver.mjs:4,76,101`; `src/game/tools/ToolController.ts:130,170` | Query is the default tool and intentionally has activeId null; the old assertion demanded string query even after a successful toolbar click. Validate actual tool.id query plus null activeId. This fixes the shared InfoPanel Demolish/setHistoric failures; missing historic ack coverage was consequential. |
| High / harness | `tools/qa-worker/w1.mjs:16,60-64,82`; `tools/qa-worker/run.mjs:87` | Chromium already receives --allow-natives-syntax; the old error means native syntax parsed but optimization was not established. LOD render workers were wrongly required to pass the simulation-isolate gate. Probe only main and the dedicated worker named sim, resume LOD workers, warm synchronously before application imports, retain status diagnostics and fail closed. The precise Chromium cold/debugger optimization cause remains unverified without a rerun. |
| High / harness, loopback-only race | `tools/qa-worker/checks.mjs:361`; `tools/qa-worker/driver.mjs:114,139` | Async dispatchOptions caused DispatchTool.refreshOptions (`src/game/tools/DispatchTool.ts:205-212`) to run its initial fitCamera (`:179`) after harness station focus. Wait for the intended incident, station in watch and rendered options, and fitPending false before station focus. Camera settling now uses the 8-second ack deadline with actual/expected coordinates, not the 180-second boot deadline. |
| High / harness | `tools/qa-worker/harness.mjs:119-133` | poll slept the final remaining interval, then launched another healthy page read with about 1 ms left. That read raced its deadline and changed an issued pending ticket into missing-command. End polling after the final sleep, recheck the deadline after any oversleep, and allow one polling interval of read grace at the boundary. Genuine stalled/failed reads remain distinct and cannot pass a control. Retain the pending seq in the acknowledgement-deadline diagnostic and the unchanged strict broken-build verdict. |
| High / harness | `tools/qa-worker/lifecycle.mjs:8`; `tools/qa-worker/freeze.mjs:14,56-101`; `tools/qa-worker/page.mjs:125` | Playwright 1.56.1 enables focus emulation on its owning CDP session (`node_modules/playwright-core/lib/server/chromium/crPage.js:438`), holding a stay-visible capture handle. A new CDP session cannot release that owner's handle. A version/shape-guarded adapter disables it on the actual owner; minimize and confirm hidden, require a trusted native DOM freeze via Runtime binding, hold >=15000 ms, require trusted resume, restore visible, then require progress <=1000 ms. Restore focus/visibility in cleanup. No synthetic lifecycle event/timestamp or relaxed threshold. |

Dispatch is **not a demonstrated host bug**. In both loopback runs there are **zero dispatch/dispatchBest tickets**
and **89 resolved setCamera tickets** while the active tool is dispatch, all at `{x:1544,z:2032,distance:1447}`.
The requested station focus was `{x:1128,z:2024,distance:520}`. Timeout happened before pointer input and before
`DispatchTool.ts:358` could call host.act. Local's initial watch is synchronous, so it fits before the harness focuses:
dispatch returned **sent 1 / ETA 5.1**, dispatchBest **sent 1 / ETA 5.3**. Reviewed queued transport, packet watch
production/reception, T029 policy and dispatch acknowledgements; no worker/query/ack source change is warranted.

Failed Onboarding Play does **not** explain the isolated/reference freeze failures: explicit TopBar setSpeed(3)
acknowledged, the pre-freeze progress check passed, and freeze.json already shows day 91 (spring start is day 90).
Local/local-verify also reached CDP freeze and recorded 1349/1381 frames without lifecycle events. Full loopback's
before-freeze failure followed its undelivered dispatch input and waiting fires; it is not evidence of a lost host
speed ack. New JSON records preFreezeDay/runningDay and the real native lifecycle separately.

Primary Chromium explanation: [EmulationHandler focus emulation](https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/protocol/emulation_handler.cc)
holds a non-hidden capturer. Installed Playwright source establishes ownership. The adapter uses
`page._connection.toImpl(page).delegate._mainFrameSession._client`; it fails explicitly if version 1.56.1 or that
shape changes. It does not patch Playwright or application files. This version-specific harness dependency and the
actual minimize/freeze behavior must be verified on the lead's GPU rerun.

### Separate source finding / request to the lead

**High, render-side J0 divergence, not an observed dispatch/LoopbackSimHost bug:**
`src/render/city/buildings/lodBuilder.ts:138`, **LodProxyBuilder.post(job)**, still calls
`postMessage(msg, [msg.position.buffer, msg.color.buffer, msg.surf.buffer])` from main. The arrays are already
slice copies, so change that call to **`this.workers[k].postMessage(msg)`**, retaining all surrounding behavior.
WORKER_DESIGN J0 requires clone-only main posts to keep main's detachment protector intact. The Node native control
confirms a transfer invalidates the probe. The old LOD initialization failure stopped check() before it read main;
the supplied output therefore does not establish main's status. The fixed harness keeps the main gate strict and
will report that status even alongside worker failures. Route this minimal hunk to the render owner; **no src file
was edited here**. `lodWorker.ts` transfers affect only that independent render isolate and need no sim-gate change.
No change request for src/worker/**, App wiring, or another cloud-held file.

### Round 1 files and validation

| File | Change this round |
| --- | --- |
| `tools/qa-worker/driver.mjs` | Hover/trial-click Play; default Query identity; await packet options/initial fit; bounded diagnostic camera polling. |
| `tools/qa-worker/checks.mjs` | Use the Play helper and await/record dispatch readiness before station input. |
| `tools/qa-worker/harness.mjs` | Current review base and final-interval polling fix; strict control classification retained. |
| `tools/qa-worker/w1.mjs` | Main/sim-only protector, synchronous warm-up, optimization-status diagnostics, main failure collection. |
| `tools/qa-worker/lifecycle.mjs` (new) | Guarded adapter for the installed Playwright owner's focus emulation. |
| `tools/qa-worker/freeze.mjs` | Real hidden/freeze/resume handshake through native CDP binding; progress evidence and restored visibility/focus. |
| `tools/qa-worker/page.mjs` | Capture lifecycle data, emit native binding evidence, reset progress baseline on real visibility return. |
| `tools/qa-worker/selftest.mjs` | Ten new browser-free regressions and updated visibility restoration test. |
| `tools/qa-worker/protector-selftest.mjs` (new) | Native clone/transfer and unavailable-native-syntax controls. |
| `tools/qa-worker/README.md`, this report | Current behavior, classifications, exact commands and rerun requirements. |

**40 Node selftests passed, 0 failed**. Added names:

- broken controls: healthy asynchronous pending reads end as ack timeout, with the actual ticket seq
- broken controls: an overslept polling interval never starts a fresh read after the deadline
- Query toolbar: null activeId is the selected default QueryTool, never a failed selection
- Onboarding Play: hover the row, wait for a real actionable button, then issue the click
- Dispatch input waits for packet watch data and the initial tool camera fit before station focus
- protector gate: LOD workers resume without a sim probe; missing sim and invalid main still fail
- protector gate: the sim worker is probed before startup and initialization failure stays a failure
- freeze adapter: disable focus emulation on Playwright owning session, failing closed on API or version drift
- freeze setup: requires a genuinely hidden page before attempting frozen lifecycle
- freeze control: a CDP frozen acknowledgement without a real DOM freeze fails and restores focus/visibility

Both commands also passed:

```powershell
node --allow-natives-syntax C:/Users/techsin/Desktop/projects/simcityweb-T028/tools/qa-worker/protector-selftest.mjs
node C:/Users/techsin/Desktop/projects/simcityweb-T028/tools/qa-worker/protector-selftest.mjs
```

The first proves initial warm-up and clones pass while a transfer negative control fails; the second proves
unsupported native syntax fails closed. No browser, production build, Vitest, perf run or bot was launched in this
round. No TypeScript/simulation/balance/RNG changes. The earlier typecheck/fixture limitations below remain historical;
this review's requested validation is Node-only. `node --check tools/qa-worker/checks.mjs` also passed;
the browser-free `--host worker` preflight still exits **3**. `git diff --check` passed and all 11 changed files
are valid UTF-8 without a BOM. All changes remain uncommitted.
**Infra/outside-owned source hunks: none.**

Round 1 rerun checklist (exact commands remain in README):

- [ ] Local and local --w1: Play emits `(1,onboarding)` after actual hover/actionability; Query reaches both inspector actions and setHistoric acknowledges.
- [ ] Loopback: dispatch readiness JSON precedes station focus; actual dispatch and dispatchBest tickets appear, sent>0/finite ETA; packet/cause gates run. No 180-second camera wait.
- [ ] Main protector remains strict; report a main invalidation separately from the removed LOD false gate. Worker named sim still requires pre-import initialization when T034 exists.
- [ ] Isolated headless/headed freeze and full-run freeze: actual hidden state, trusted native freeze/resume, >=15000 ms external and document intervals, 0 frozen frames, visible progress <=1000 ms, 0 overlays/errors, focus restored.
- [ ] Both real broken-zone controls: exit 1, one target `ack-timeout` with seq>0, **PASS broken-build control**, no unrelated errors. A true read timeout still invalidates a control.
- [ ] Probe-control: the first actual dispatch consumes the observer fault; its pending ticket fails the ack check after session replacement.
- [ ] Full loopback retains 23-op coverage, ghosts/brush/save/reload/region teardown and zero-console-error gates; worker remains 55 skips / exit 3 until T034.

No bot rerun is needed for these harness changes; the unchanged expected seed-7 128x15 residents remain
**[61124, 93804, 37971] = 192899**. The exact optional quiet-gated command remains in the initial report below.

## Initial implementation record (before the lead's GPU review)

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
node C:/Users/techsin/Desktop/projects/simcityweb-T028/tools/qa-worker/cli.mjs --host loopback --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T028r/scratch/loopback.json
node C:/Users/techsin/Desktop/projects/simcityweb-T028/tools/qa-worker/cli.mjs --host loopback --break-ack zone --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T028r/scratch/broken-zone.json
node C:/Users/techsin/Desktop/projects/simcityweb-T028/tools/qa-worker/cli.mjs --host worker --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T028r/scratch/worker.json
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
