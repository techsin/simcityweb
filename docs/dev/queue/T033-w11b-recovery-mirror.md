# T033-w11b-recovery-mirror: W1.1b part 3, the RecoveryMirror against the loopback core (a Codex lane)
base: local/W0-complete (W0.6's save paths are in it); branch local/W1.1b-recovery
owns: a new src/worker/recoveryMirror.ts, W0.6's host save and snapshot paths where the mirror attaches, and new tests
  (tests/worker/recovery.test.ts).
do:
  docs/WORKER_DESIGN.md §4.2-§4.5 and R7:
  - the journal is bound to its base, either the last save or the last snapshot, and is replayable onto the save
    itself;
  - the mirror drops its payload on every `saved` and accepts a `snapped` only against its current save;
  - an op whitelist of what is journaled (no speed, resume, camera, dispatches, dismissals, settings, debug);
  - FH-07a's rule: a bulldoze carries the refund it was charged.
  O6: main keeps no recovery base and does not deserialize itself.
gates: tests/worker/recovery.test.ts as §5.3 lists it (snapshot plus journal restored; save then unload restores from
  the journal alone; a snapshot older than a save dropped; a journal discarded when its record changed; toggles replay
  idempotently; excluded ops never journaled); tsc; the full vitest; the bot at 196,101.
report: docs/dev/reports/local-W1.1b-recovery.md; push local/W1.1b-recovery with
  docs/dev/queue/T033-w11b-recovery-mirror.done; DONE.
