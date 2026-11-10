# T085 — emergency banner station and first-lesson timing

Branch: `local/T085-banner-station`; task base: `d83f0d0`. Changes are uncommitted.

## Changes per file

- `src/ui/EmergencyBanner.ts`: the out-of-range note uses the existing city-bound `dispatchOptions` watch. It and the Send button choose the first missing responder in `INCIDENT_RESPONDERS` order, then the first free, finite-ETA option for that responder, matching `dispatchBest`. Until options arrive, or when no eligible option remains, the note shows the incident status without a stale station name. Busy and no-station explanations retain their existing text.
- `src/ui/EmergencyBanner.ts`: E1a stays unseen while its card is loading. It is recorded after a visible render of delivered options, including a no-free-unit result, or an explicit Send, Got it, Emergency view, service-tab or dismiss action. Automatic incident completion, card removal, Tips-off acknowledgement, reset and city exit do not consume a loading lesson. Send retains the existing pending-card and dispatch-acknowledgement timing. `markTeachingSeen` remains the single seen-flag write/persistence function and is idempotent, keeping the GuideProfile merge local.
- `tests/game/emergencyBannerStation.test.ts` (new): 10 cases. Local and loopback regressions compare the unchanged straight-line simulation note with road options, displayed note, button title and dispatched station; also cover fleet changes, a road shortcut, delayed/empty replies, busy/no-station explanations and primary-before-support responder order. The fixture's straight-line-nearest station needs 18.5 minutes by road; the station Send nearest selects needs 7 minutes. Both exceed the fresh fire's six-minute window, exercising the fallback.
- `tests/game/emergencyTeachingSeen.test.ts` (new): 14 cases covering loading and delivered/empty options, incident resolution/invalidation/removal, abort and late replies, profile remount, New Year visibility, explicit actions, Tips off, pending Send acknowledgement and E1b's independent prevention text/Fire tab.
- `docs/dev/reports/local-T085-banner-station.md`: this report.

No `src/sim/infra/*` hunks. No worker-protocol hunks. No source hunks outside the named file. No RNG, dispatch, balance, save-schema or mirrored-state changes.

## Validation

- `npx tsc --noEmit`: passed, including both new test files.
- `git diff --check`: passed. Final worktree scope is the banner, the two new tests and this report.
- All 12 focused Vitest files listed below were attempted separately through quietrun, one process at a time. Every invocation exited 1 before test collection: Vite's Windows path initialization (`externalize-deps` → `optimizeSafeRealPathSync` → `exec("net use")`) fails with `spawn EPERM` in this sandbox. No passing test result is claimed. The summary and representative startup output are in `vitest-gates.log` in the designated scratch directory. A native-config-loader attempt also stopped before collection because this Node cannot directly load `vite.config.ts` (`ERR_UNKNOWN_FILE_EXTENSION`); no tooling files were changed.
- A short `npx tsx -e` fixture probe could not start because `tsx` is absent from the available npm cache (`ENOTCACHED`, offline registry access). Fixture ETA assertions remain unverified at runtime.
- No browser, full Vitest suite, bot, bench, commit, push, merge or `.done` write was run.

The required focused test files are:

- `tests/game/emergencyBannerStation.test.ts`
- `tests/game/emergencyTeachingSeen.test.ts`
- `tests/game/emergencyBanner.test.ts`
- `tests/game/emergencyTeaching.test.ts`
- `tests/game/emergencyTeachingToasts.test.ts`
- `tests/game/emergencyPolicy.test.ts`
- `tests/game/emergencyOutcomePolicy.test.ts`
- `tests/game/emergencyOutcomes.test.ts`
- `tests/game/emergencyLive.test.ts`
- `tests/worker/emergencyTeachingHost.test.ts`
- `tests/worker/emergencyTeachingWorker.test.ts`
- `tests/worker/hygiene.test.ts`

Run each file separately, one process at a time, using:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run <file> --maxWorkers=1
```

## Gates left for the lead

The full suite, the focused runtime tests blocked above, bot and real-GPU checks remain with the lead. The bot command is:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

Capture its output in the task's designated scratch directory. Keep the default profile and all optional strategy flags off. Required 2015 residents: **[61,124, 93,804, 37,971], total 192,899**. These are the acceptance values, not a new measurement. The implementation changes no simulation or worker code; Medium/Hard bit identity and old-save continuation are expected from that scope, but no two-process hashes or save/load runtime checks were performed. No 256-tile or 60-year runs are needed for this item.

## Plan/code fit and cloud requests

The existing `dispatchOptions` query/watch already carries dispatchBest's ordered road ETAs and station names, so the optional EmergencyView/protocol addition is unnecessary. The sim's straight-line fallback stays intact. The existing button selected globally by ETA across missing responders; the small adjacent UI selection change is necessary to name what `dispatchBest` sends for multi-responder incidents too. No other plan/code mismatch was found.

Cloud-held file requests: **none**. T037a only needs to reconcile the existing `markTeachingSeen` persistence function with GuideProfile; the seen timing now calls that same function after rendering or explicit action.

## Browser checklist

Repeat on the default host, `?simworker=loopback`, and `?simworker=1`:

- [ ] In `vet_s7_y21`, inspect the too-far fire: the note, Send nearest tooltip/ETA and dispatched truck name the same road-selected station (#21 in NOTE-073), while Choose station still works.
- [ ] While options are delayed, no straight-line station name appears; after arrival or a fleet/road change, note and Send nearest update together. Busy/no-road explanations remain readable.
- [ ] With a fresh profile and a savable uncovered major fire, pause once and show E1a; loading alone leaves its profile flag unset. Deliver options and confirm the station/ETA, enabled Send and seen flag.
- [ ] End the incident or exit the city before options arrive; a later city still offers E1a. Hide the loading card during New Year; arriving options consume it only after the card becomes visible again.
- [ ] Before options arrive, Got it, Emergency view and banner dismiss record seen and close/acknowledge correctly. Send records the action and retains the current card until the dispatch acknowledgement. Repeat actions do not reopen it.
- [ ] A too-far fire still shows E1b; its Fire tab opens the right service. A second uncovered fire follows ordinary behavior, and the LIVE explainer appears once.
- [ ] At a folded stack/narrow layout, the card stays operable in its fallback; Tips off, city exit and reload leave no stuck pause or retained listener. Old saves without teaching flags load and continue.
