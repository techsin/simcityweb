#!/bin/bash
# usage: sem.sh <name> <slots> <cmd...> — runs the command in one of <slots> mkdir slots $S/<name>.sem.<i>
S=/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad
N=$2; NAME=$1; shift 2
while true; do
  for i in $(seq 1 "$N"); do
    L="$S/$NAME.sem.$i"
    if mkdir "$L" 2>/dev/null; then
      echo $$ > "$L/pid"; trap 'rm -rf "$L"' EXIT; "$@"; exit $?
    elif [ -f "$L/pid" ] && ! kill -0 "$(cat "$L/pid" 2>/dev/null)" 2>/dev/null; then rm -rf "$L"
    fi
  done
  sleep 5
done
