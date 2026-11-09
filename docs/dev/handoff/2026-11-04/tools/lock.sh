#!/bin/bash
# usage: lock.sh <name> <cmd...>
# Waits for the mkdir mutex $S/<name>.lock, runs the command, and releases the lock on any exit.
# A lock whose holder pid is gone counts as stale and is taken over.
S=/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad
L="$S/$1.lock"; shift
until mkdir "$L" 2>/dev/null; do
  if [ -f "$L/pid" ] && ! kill -0 "$(cat "$L/pid" 2>/dev/null)" 2>/dev/null; then rm -rf "$L"; continue; fi
  sleep 10
done
echo $$ > "$L/pid"; echo "$(date -u +%FT%T) $*" > "$L/what"
echo "[lock] $(basename "$L") acquired $(date -u +%T)" >&2
trap 'rm -rf "$L"; echo "[lock] $(basename "$L") released $(date -u +%T)" >&2' EXIT
"$@"
