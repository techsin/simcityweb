#!/bin/bash
# usage: acquire.sh <name> <owner-label>
# Holds $S/<name>.lock across several commands. Release it with release.sh <name> <owner-label>.
# A lock older than 4 hours counts as stale.
S=/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad
L="$S/$1.lock"
until mkdir "$L" 2>/dev/null; do
  if [ -f "$L/since" ] && [ $(( $(date +%s) - $(cat "$L/since") )) -gt 14400 ]; then rm -rf "$L"; continue; fi
  sleep 15
done
date +%s > "$L/since"; echo "$2" > "$L/owner"; echo "[lock] $1 acquired by $2 at $(date -u +%T)"
