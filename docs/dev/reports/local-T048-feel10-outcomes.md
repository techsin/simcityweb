# T048 — emergency outcomes and LIVE feedback

Implemented on `local/T048-feel10-outcomes`, left uncommitted. No push, merge, or `.done` file, following the session instructions over the task file's publishing footer.

**Changes per file**

- `src/game/GameSounds.ts`: host event-time outcomes, bright `saved` for a player response without losses, `lost` for failure/building losses/deaths, one shared 10-second sting budget, and a host-keyed recent-sting marker for the restore toast. Retains host incident references through local finalization; seeds them at construction, host readiness, and reset. LIVE music renewal follows policy and host speed; timers/listeners/cache release on abort/dispose. Milestone code untouched.
- `src/audio/sfx.ts`: fixed-note 0.8-second `saved` and low `lost` voices, using existing pooled one-shot graphs. No random choices inside either voice.
- `src/ui/EmergencyBanner.ts`: isolated WORLD changes for the silent restore option, 600 ms green/red flash, LIVE class alignment with pause/resume, CSS import, and cleanup. No docking or dispatch-policy changes.
- New `src/ui/fx.css`: 3% red edge vignette, immediate entry, 500 ms opacity release, no pulse at any motion setting, pointer-transparent; outcome border/glow styles. The paused TopBar selector also suppresses the vignette while its pill is hidden.
- **Outside named source files:** `src/audio/AudioEngine.ts`: effective pre-master dry music bus getter `debugMusicBusGain` (`null` before initialization); optional fourth duck argument `{ renew: true }` skips renewal while a deeper duck is active. Existing three-argument callers retain their behavior, and a finite 14 dB duck can expire during a longer LIVE episode.
- **Outside named source files:** `src/game/CityScene.ts`: two small wiring hunks only: pass toast options through, and provide GameSounds with host/signal plus the optional audio duck callback.
- **Outside named source files:** `src/game/context.ts`: optional fifth toast argument `{ silent?: boolean }`, forwarding the already-existing Toasts option. `Notifications.ts` untouched.
- **Existing test helper exception:** `tests/audio/nodeCosts.ts`: two exhaustive cost entries required by the expanded `SoundName` union and existing one-shot tests.
- New `tests/audio/emergencyStings.test.ts`, `tests/game/emergencyOutcomes.test.ts`, and `tests/game/emergencyLive.test.ts`: acceptance and regression coverage below.
- **Infra hunks: none. Cloud-held files: none edited.** No simulation algorithms, save schemas, systemData keys, balance, or simulation RNG calls changed.

**Checked gates**

`npx tsc --noEmit` and `git diff --check` pass. Eight test files pass individually, **105 tests passed, one existing hygiene test skipped**:

| Test file | Result |
|---|---:|
| `tests/audio/emergencyStings.test.ts` | 6 passed |
| `tests/game/emergencyOutcomes.test.ts` | 16 passed |
| `tests/game/emergencyLive.test.ts` | 8 passed |
| `tests/game/gameSounds.test.ts` | 7 passed |
| `tests/game/emergencyBanner.test.ts` | 38 passed |
| `tests/audio/ducking.test.ts` | 6 passed |
| `tests/audio/oneShot.test.ts` | 7 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 skipped |

The existing skip is the W1.2 simWorker import-graph gate. Banner fixtures emit Node's AbortSignal listener-count warnings; no test fails.

The normal Vitest invocation failed before collecting tests: Vite's Windows `net use` realpath optimization throws sandbox `spawn EPERM`. Native loading of the repository's TypeScript config also failed with `ERR_UNKNOWN_FILE_EXTENSION`. Tests succeeded with a scratch-only native JavaScript config:

```js
export default { resolve: { preserveSymlinks: true }, test: { pool: 'threads' } };
```

Every test command used the quiet gate, one file/process at a time:

```powershell
$gate = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$scratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T048/scratch'
node $gate npx vitest run <one test file above> --maxWorkers=1 --config "$scratch/vitest.config.mjs" --configLoader native
```

Outcome tests include one saved sting without a restore/news chime, failed alerts, final replay-record losses/deaths, the exact 10-second boundary, automatic-response silence (including command-caused automatic dispatch), abort/reset cleanup, real LocalSimHost finalization, and saved incidents restored during lazy startup. LIVE tests use the real AudioEngine duck API and debug getter: 20 seconds at 6 ± 1 dB lower, baseline again at 500 ms, pause/resume, late audio initialization, abort cleanup, and a stronger duck expiring while LIVE continues. CSS checks pin the shared pill selector and steady vignette; actual pixels remain a browser gate.

**Bot gate**

The requested command was attempted through the quiet gate:

```powershell
node $gate npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

It could not start: `tsx` is absent and npm's offline cache returned `ENOTCACHED`. Diagnostic: `$scratch/bot-128x15-s7.txt`.

Used the documented no-tsx fallback: installed rolldown's Node API bundled the unchanged `tools/simbot.ts` to `$scratch/simbot.mjs` with platform `node`, ESM format, and dynamic imports inlined. The actual simulation command was:

```powershell
node $gate node "$scratch/simbot.mjs" --size 128 --years 15 --seed 7 --quiet
```

Pass, **2015 residents `[61124, 93804, 37971]` = 192,899**, matching the required baseline exactly. Output: `$scratch/bot-128x15-s7-bundled.txt`; simulation reported 14.1 seconds. No balance changes expected. No 256-tile/60-year runs are required by FEEL-10, and none were run. A separate before/after serialized-hash comparison and separate Hard bot were not run.

**Plan/code differences and cloud request**

- LocalSimHost's incident lookup is empty during terminal emission, although replicas expose the terminal record. Retained host-supplied objects plus the readiness seed cover both; no sim reach-in.
- LIVE policy remains active during pause, while existing CSS hides the LIVE pill. Visual/audio urgency therefore follows `policy.live && host.speed !== 0`; the policy episode is unchanged. The class changes immediately; the vignette then has the requested 500 ms fade.
- Duck's merged API includes a 60 ms attack. Renewable holds use zero hold plus a 440 ms release and renew every 50 ms; the final renewal totals 500 ms. A concurrent longer sound/stronger duck keeps its own envelope, so its audio can legitimately outlast the vignette.
- **Provenance limit / request for cloud:** `Incident.answered === 2` identifies a player primary response. An extra manual unit added after an automatic primary response can leave `answered === 1`; `host.cause` currently supplies only seq/tag, and a disaster command can itself cause automatic dispatches. To recognize that extra manual response precisely, expose the causing command op: `src/worker/SimHost.ts` (`Cause`, `LocalSimHost.act`), `src/worker/LoopbackSimHost.ts` (`PacketSimHost.post`/replica hooks), and `src/worker/replica.ts` (`ReplicaCause`, emergency replay cause setup). Carry the posted `dispatch`/`dispatchBest` op alongside the existing main-side tag; it need not change simulation/save data or consume RNG. GameSounds can then identify those dispatches without falsely celebrating automatic disaster responses. Current classification covers the Refinery/player-primary acceptance case and loaded manual responses.

**Left for the lead / browser checklist**

- [ ] Run the full Vitest suite with the repository's normal config on the unrestricted machine, including the eventual W1.2 gate.
- [ ] Worker host: replay the Refinery dispatch; hear exactly one bright saved sting, no restore/news chime; capture the green 600 ms outcome flash.
- [ ] Worker host: let an alert fail; hear lost, confirm red 600 ms flash and loss text. Also test resolved-with-losses.
- [ ] End several incidents inside 10 real seconds; confirm at most one outcome sting.
- [ ] Toggle LIVE, pause/resume, and end LIVE. Capture vignette screenshots with the pill visible/hidden; confirm the 500 ms release and click-through behavior.
- [ ] Repeat with reduced motion; vignette remains steady.
- [ ] With no other duck active, compare `20 * Math.log10(audio.debugMusicBusGain / baseline)` during LIVE: -6 ± 1 dB, baseline again 500 ms after LIVE ends. Check New Year overlap returns to -6 while LIVE continues.
- [ ] Listen on speakers/headphones for saved/lost contrast and mix level. New stings have no measured loudness trim yet; no audio-lab or real-GPU run was performed.

No browser, full suite, benchmarks, or other worktree/branch operations were run.
