# T002-ping: timed round trip (lead → worker → lead)
base: any
owns: nothing in git
do: As soon as you see this file, reply at once (before anything else) with:
  claude -p "PONG T002 6b797771 seen <your UTC time, ISO 8601> via <watcher and its interval>" --cloud session_01KT9tXthEhyzExdUuGEecAJ
  The lead pushed this file at 2026-10-27T01:55:30Z (UTC). Then do T001 if you have not yet, and from now on work in a dedicated git
  worktree so the owner's checkout (C:\Users\techsin\Desktop\projects\simcityweb) is never switched or touched:
  git worktree add ..\simcityweb-worker origin/claude/beautiful-johnson-u2jqoz  (cut each task's local/<task-id> branch there).
gates: the PONG reached the lead
report: none; create docs/dev/queue/T002-ping.done on a local/* branch after the PONG.
