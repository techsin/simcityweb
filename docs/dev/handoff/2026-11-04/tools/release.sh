#!/bin/bash
# usage: release.sh <name> <owner-label> (releases only a lock this owner holds)
S=/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad
L="$S/$1.lock"
if [ "$(cat "$L/owner" 2>/dev/null)" = "$2" ]; then rm -rf "$L"; echo "[lock] $1 released by $2"; else echo "[lock] $1 not held by $2 (owner: $(cat "$L/owner" 2>/dev/null))"; fi
