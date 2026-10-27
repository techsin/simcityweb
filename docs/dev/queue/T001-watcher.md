# T001-watcher: switch the queue watcher to 30-second checks
base: claude/beautiful-johnson-u2jqoz at the commit that adds docs/dev/queue-watch.sh
owns: nothing in git (this changes only how you wait)
do: Stop the 10-minute watcher. From now on wait with `docs/dev/queue-watch.sh 30 120` in the background (it exits when
  docs/dev/queue/ changes, or after 120 min with exit 1 — then start it again). Re-read docs/dev/COORDINATION.md: the
  channel section changed (the lead cannot fire your scheduled task; it stays for the owner's manual nudges).
gates: the new watcher is running
report: no report file needed; send: claude -p "ACK T001 watcher 30s" --cloud session_01KT9tXthEhyzExdUuGEecAJ
  and create docs/dev/queue/T001-watcher.done on your own branch local/T000-specs (or any local/* branch) so the lead sees it.
