#!/usr/bin/env bash
# Local worker's wake-up: wait until docs/dev/queue/ changes on the dev branch, then print what is new and exit 0.
# It only fetches (one small request per interval) and costs nothing while it waits.
# Usage: docs/dev/queue-watch.sh [interval-seconds=30] [max-minutes=120]   (exit 1 = nothing changed in time)
set -u
BR=claude/beautiful-johnson-u2jqoz
INT=${1:-30}; MAX=${2:-120}
cd "$(git rev-parse --show-toplevel)" || exit 2
qtree() { git fetch -q origin "$BR" 2>/dev/null || { echo fetch-failed; return; }; git rev-parse -q --verify "FETCH_HEAD:docs/dev/queue" 2>/dev/null || echo none; }
qlist() { git ls-tree --name-only FETCH_HEAD docs/dev/queue/ 2>/dev/null | sort; }
base=$(qtree); before=$(qlist)
end=$(( $(date +%s) + MAX * 60 ))
while [ "$(date +%s)" -lt "$end" ]; do
  sleep "$INT"
  now=$(qtree)
  [ "$now" = fetch-failed ] && continue
  if [ "$now" != "$base" ]; then
    echo "QUEUE CHANGED on $BR at $(git rev-parse --short FETCH_HEAD)"
    comm -13 <(echo "$before") <(qlist) | sed 's/^/  new: /'
    echo "  (re-read every task file without a matching .done; changed files are not listed as new)"
    exit 0
  fi
done
echo "QUEUE UNCHANGED for ${MAX} min"; exit 1
