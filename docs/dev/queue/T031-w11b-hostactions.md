# T031-w11b-hostactions: W1.1b part 1, the main-thread prediction side (a Codex lane)
base: local/W0-complete (NOTE-032); branch local/W1.1b-host
after: none for the code; its loopback runs need T032's commands, so its gates follow T032.
owns: new src/worker/HostActions.ts (and helpers), src/game/tools/ToolController.ts, the Tool.commit / gesture parts of
  src/game/tools/Tool.ts (W0.2's code), WorldView's pending-ghost hunk (src/render/world/WorldView.ts), and tests.
do:
  docs/WORKER_DESIGN.md §6 row W1.1 (line 968), §1.3, §2.2, and the revision items R4 (gesture-routed corrections),
  R5 (host.pending counts only preview-affecting commands; predictions exact only with none of the player's own in
  flight, else provisional) and O1 (pending ghosts). W1.1a's report lists what it left for W1.1b.
  - `HostActions`: exact and provisional predictions over the replica's PreviewActions, `host.pending` and its overlay.
  - Gestures group commits; `Tool.commit` delivers feedback and corrections to the issuing tool once per gesture; the
    global `actionCorrected` handler goes; BrushTool takes spent and failed from acks.
  - Pending ghosts: the committed preview stays drawn in a pending style until its ack replays.
gates: unit tests for predictions (exact vs provisional), the pending overlay, and gesture corrections; then, with
  T032, the lag suite properties that touch HostActions; tsc; the full vitest; the bot at 196,101 (no sim change).
report: docs/dev/reports/local-W1.1b-host.md; push local/W1.1b-host with docs/dev/queue/T031-w11b-hostactions.done; DONE.
