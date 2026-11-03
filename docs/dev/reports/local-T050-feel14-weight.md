# T050: bulldozing and placement with weight

## Round 2: use T040's shared work hook

Round 1 is committed at `3ffd5b3`; T040's `6bf60ee` hook was merged at `93cb93c`. The round-2 changes below are
uncommitted. No push, merge, commit or `.done` file was made in this round.

- `src/render/city/buildings/BuildingRenderer.ts`: register `collapseWork` beside the collapse fields using
  `addBudgetedWork`. `pending()` is a constant-time queue-index comparison. `step()` consumes one copy, returns true
  even if a camera cut makes that consumed copy invisible, and resets the queue/index after its last entry. Its
  `clear()` calls the existing, unchanged `clearCollapses()`. No new collapse animation or effect behavior changes.
  T040 now determines the initial build-first order and alternation across frames, replacing round 1's local
  copy-first ordering. The shared hook expresses all required collapse work without a priority or ordering extension.
- Restored `drainBuilds()`, `clear()` and `dispose()` exactly from `6bf60ee`. A source-text comparison verified all
  three methods byte-identical, along with `addBudgetedWork`, `stepBudgetedWork` and `drainBudgetedWork`. No other
  hook code was changed.
- `tests/render/weightBuildings.test.ts`: added a registered-work regression with controlled 0.75 ms unit costs.
  It spies on `collapseWork.step()`, verifies build/copy/build then copy/build/copy across consecutive frames,
  charges the combined work to one 2 ms deadline (2.25 ms including the final indivisible unit), and verifies queue
  reset on drain. All seven round-1 building tests remain unchanged and pass.
- This report records the new result. **No infra hunks, cloud-held edits, or other source/test edits outside the
  named files.** `Effects.ts`, `CityObjectsView.ts`, `buildingWork.test.ts` and `buildingBudget.test.ts` are untouched.
  The 0.35 s sink, 30-building merge threshold, 2,200 m cutoff and rolling four-per-second redevelopment limit remain
  unchanged.

### Round-2 gates

TypeScript passed through the quiet gate:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsc --noEmit
```

Each requested Vitest file ran separately and sequentially through the same quiet gate, using the established
native-config/thread-pool workaround for the sandbox's default-launch `spawn EPERM`:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --configLoader native --pool threads
```

| Test file | Round-2 result |
|---|---|
| `tests/render/weightBuildings.test.ts` | 8 passed |
| `tests/render/weightEffects.test.ts` | 9 passed |
| `tests/render/weightWiring.test.ts` | 10 passed |
| `tests/render/buildingWork.test.ts` | **9 passed, 2 failed** |
| `tests/render/buildingBudget.test.ts` | 22 passed |
| `tests/render/lod.test.ts` | 35 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 skipped |

Total: **110 passed, 2 failed, 1 skipped**. `git diff --check` passes. No browser, benchmark or full suite was run.
The round-2 bot was not rerun for this render-only hook migration. The previous completed gate remains
**2015 residents [61124, 93804, 37971] = 192,899**, expected unchanged. Exact prescribed and successful fallback
simbot commands and the output path are retained in the round-1 bot section below. No simulation, balance or RNG
code changed.

### T040 fixture mismatch requiring the lead

The unchanged `buildingWork.test.ts` fails only its two parameterized cases named
`preserves build order, frame counts and clock checks with no registered work` (0.65 ms and 3.25 ms entries).
At line 112 their empty-drain assertion expects no clock read. Mandatory field registration means an ordinary
BuildingRenderer now has a registered collapse work, so the byte-identical T040 `drainBuilds()` takes
`drainBudgetedWork()` even when the work is idle. That method reads `performance.now()` once before discovering no
pending work. Observed read counts were **30 versus 29** and **27 versus 26**. Nonempty drains also have the
registered path's additional deadline checks, so removing only the empty-drain assertion would not restore the
intended unregistered-path comparison.

**Exact request to T040's test owner:** in `tests/render/buildingWork.test.ts`, make the setup of these two
unregistered-path compatibility cases explicitly remove built-in work registrations before comparing to
`originalDrain` (for example, a `town` fixture option used only for the current/reference renderers in those cases).
Keep the other nine cases testing the normal registered renderer. This preserves the tests' stated no-registered-work
precondition as later lanes add required field registrations. I did not alter the hook or those tests to work
around the mismatch. Mandatory registration, byte-identical hook methods and the current unchanged fixture cannot
all satisfy those exact clock-read assertions.

**Requests for cloud-held files: none.** The outstanding request is to T040's test owner. Full Vitest and real-GPU
acceptance remain for the lead; a green full-suite claim is blocked by the fixture mismatch above.

Round-2 browser checklist (not run locally):

- [ ] A 2x2 house at 300 m still sinks over 0.35 s and shows dust for 1.5-2.5 s.
- [ ] A 200-building drag still uses one merged cloud, at most 600 feedback particles and <4 ms added real-GPU cost;
  verify the shared hook also drains pending geometry without starving collapse copies.
- [ ] Verify the 2,200 m cutoff, at most four redevelopment effects per rolling second, the 1.2 s plop ring and ash.
- [ ] Reset/dispose with both queued builds and copies pending; no stale copy after id reuse or quality changes.

## Round 1 record

Implemented on `local/T050-feel14-weight`, based on T040 `8ff4fd0`. Changes are uncommitted; no push or `.done` file,
as instructed in the lane handoff. Read T040's report first, the task, POLISH_PLAN FEEL-14, sections 6.4 and 7.2-7.4,
WORKER_DESIGN section 6/R2, and the three named source files in full. No repository or ancestor AGENTS.md/CLAUDE.md was found.

## Changes per file

- `src/render/city/buildings/BuildingRenderer.ts`: snapshot the drawn main/site geometry, matrices and colors before
  removal, independently of reusable building ids. A fading building snapshots its dominant real geometry rather
  than the empty stand-in. Detached allocation interleaves with live builds under the existing 2 ms deadline, using
  the same batch and immutable geometry; no extra geometry/proxy building or draw call. Active copies shrink to
  15% Y scale with a 0.045 rad tilt over 0.35 s. Their uncompressed culling centers stay fixed, avoiding a whole-batch
  culling invalidation while tall copies tilt. Copies cast no shadows and do not invalidate cached cascades. Only
  active transient copies are visited during animation; there is no new per-frame scan of live buildings.
  Camera cuts beyond 2,200 m, clear/reset and disposal cancel copies. The existing removal API and bulk paths retain
  their behavior unless CityObjectsView explicitly captures and queues a copy. `collapsing` exposes active copy count.
- `src/render/city/effects/Effects.ts`: add finite demolition dust, ash and a horizontal procedural landing ring in
  the existing smoke draw. Dust has 16-40 particles per ordinary lot and a 2.5 s lifetime; rings last 1.2 s, ash 1.5 s.
  More than 30 removals before one frame upload become one cloud spread across the union of their lot bounds.
  All live feedback together stays at most 600 particles, including adjacent-frame bursts, ash and rings; older
  feedback is evicted when needed to admit a new burst. A bounded share is reserved even when continuous smoke fills
  the 7,000-particle pool (2,500 on LOW). One-shot birth times use a render-local clock, with GPU age/fade and distance
  clipping; unrelated emitter uploads do not restart them. Without feedback the old continuous particle bytes remain
  exact, and feedback preserves the original flame seed sequence. No new simulation RNG draws.
- `src/render/city/CityObjectsView.ts`: capture removed drawn instances before freeing them, batch feedback until
  the frame, infer redevelopment from overlapping subsequent growable additions, and apply a rolling maximum of
  four redevelopment effects per second to both copy and dust. Rubble removals get ash only. A live plop's ring waits
  for its first queued visual; removal and duplicate-id adds cancel stale landing tokens. Camera position is current
  before feedback admission; full rebuilds/reset and disposal clear pending/active feedback.
- New `tests/render/weightBuildings.test.ts`: seven detached-copy, fade, pose/id reuse, expiry/tilt/shadow/culling,
  distance, cancellation and shared-budget tests.
- New `tests/render/weightEffects.test.ts`: nine lifetime, cloud merge, cap, landing/ash, distance/shader, saturated
  pool, continuous byte identity and cleanup tests.
- New `tests/render/weightWiring.test.ts`: ten actual CityObjectsView event tests covering dust/ash, rolling
  redevelopment throttle, overlap classification, deferred landing, id reuse, distance/camera and reset/disposal.
- This task-named report. **No infra hunks, cloud-held edits, or other source/test edits outside the named files.**
  Diagnostics and the native bot loader are only in the assigned T050 scratch directory.

## Verification

`npx tsc --noEmit` passes after all code and test changes. `git diff --check` passes.
Every Vitest and bot invocation used the quiet gate, one command at a time. No browser, full suite or benchmark ran.
The prescribed default Vitest launch failed while loading config with **spawn EPERM**. T040's native-config/thread
workaround succeeded, with no repository configuration changes:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --configLoader native --pool threads
```

Each file below ran separately:

| Test file | Result |
|---|---|
| `tests/render/weightBuildings.test.ts` | 7 passed |
| `tests/render/weightEffects.test.ts` | 9 passed |
| `tests/render/weightWiring.test.ts` | 10 passed |
| `tests/render/buildingBudget.test.ts` | 22 passed |
| `tests/render/lod.test.ts` | 35 passed |
| `tests/render/fireworks.test.ts` | 12 passed, 2 skipped (optional large fixtures unavailable) |
| `tests/render/freshLoad.test.ts` | 12 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 skipped |

Total: **124 passed, 3 skipped**. Budget tests use a controlled clock and charge both detached-copy installation and
ordinary geometry work; they verify the shared 2 ms limit plus one indivisible entry, interleaving and eventual drain.
They are scheduling tests, not a real-machine timing claim. The tall-copy test verifies no batch-version change
during 20 animation frames. Effects tests verify the 200-removal merge and 600-particle cap structurally, without a GPU.

## Bot gate

The requested command was attempted, with output in `scratch/simbot-128-y15-s7-tsx.log`:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

It could not start: `tsx` is not installed or available in the offline npm cache (`ENOTCACHED`). The unchanged bot
completed through Node's TypeScript transformer and a scratch-only extension resolver instead:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --experimental-loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T050/scratch/resolve-ts.mjs tools/simbot.ts --size 128 --years 15 --seed 7
```

Exit 0, Medium/plains, 25.5 s. **2015 residents [61124, 93804, 37971] = 192,899**, exactly the required baseline.
Full output: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T050/scratch/simbot-128-y15-s7-native.log`.
No balance, simulation, host, save-schema or RNG-state code changed. No additional 256-tile, Hard, or two-process
hash run was required or performed; those identities are expected unchanged, not independently demonstrated here.

## Plan/code differences and handoff

- CityEvents has no removal-reason field. Growth redevelopment and wealth swaps actually emit old removals followed
  by overlapping non-plopped additions, rather than mutating a renderer entry in place. The view uses that event
  sequence within one render frame. An unrelated growable added on a removed lot in the same frame is also treated
  as redevelopment. Existing real simulation events preserve a pending changed visual's footprint; synthetic lot
  relocation still has T040's documented picking/footprint caveat.
- A small constant-size drawn snapshot (at most main plus site) must be captured in the removal event before its
  original slots are freed. All detached batch allocation uses T040's deadline; the snapshot and overlap matching
  costs must be included in the 200-building timing gate. No additional building geometry is generated for feedback.
- The plan's looping construction-dust particles could not express finite clouds/rings. Separate birth attributes
  and a render-local clock provide exact one-shot lifetimes while preserving existing plume behavior.
- The 600-particle live cap takes precedence over retaining every cloud during sustained bursts. Individual clouds
  remain 16-40 particles; 30 large lots are reduced to 20 each, while 31+ removals use one merged cloud.
- **Requests for cloud-held files: none.** No worker or game API extension is needed.
- **Left for the lead:** full Vitest, the real-GPU <4 ms drag gate (including event snapshot, allocation, animation,
  particle upload and draws), visual dust-duration/tilt/ring/ash judgment, round feedback frame-cost guard, browser
  playability and old-save continuation. No claim is made that the real-GPU timing gate has passed.

Browser acceptance checklist:

- [ ] Bulldoze a 2x2 house at 300 m: copy sinks with slight tilt over 0.35 s; dust is visible for 1.5-2.5 s.
- [ ] Drag over 200 buildings: one merged cloud, at most 600 added particles and <4 ms added real-GPU frame cost;
  include event handlers and subsequent animation frames, a tall district, LOW/HIGH, and an already smoky city.
- [ ] Compare 30 versus 31 removals; repeat bursts within 2.5 s and verify the live feedback cap stays 600.
- [ ] Beyond 2,200 m, bulldoze/redevelop/plop/clear rubble produces no feedback; move beyond the cutoff during effects.
- [ ] Redevelopment waves play at most four copy/dust effects in any rolling second; ordinary bulldozing remains responsive.
- [ ] Plop a building: one 1.2 s ground ring starts when its queued model appears. Clear rubble: ash without a standing copy.
- [ ] Remove during LOD fade/pending change; immediately reuse the id/lot; verify the old detached copy never moves the new building.
- [ ] Reset/load/switch quality with feedback pending; no stale copies/rings/clouds, buildings still pick/select correctly,
  no new draw calls or console errors, and an old save continues normally.
