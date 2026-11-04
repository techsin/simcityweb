#!/bin/bash
# usage: fairlock3.sh [seconds]   (default 7000)
# Hands the timing lock to the most urgent waiter WITHOUT stopping anyone (no SIGSTOP; waiters' shells are untouched).
# When the lock frees, this script takes it at once as a placeholder (its own pid, so waiters do not treat it as
# stale), picks the next waiter by class, removes the placeholder and kills only that waiter's `sleep` child, so the
# chosen waiter retries mkdir within milliseconds while the others are still asleep in their 10 s loop.
# Class: 0 merge (main checkout, vitest or bot, no scratch work dir); 1 a bot or vitest on named files; 2 the full vitest;
# 3 everything else. Aging: one class up per 45 min waited. Ties: the oldest first.
# If this script dies, a placeholder it holds is stale (dead pid) and the waiters take it over as usual.
S=/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad
L="$S/timing.lock"
MAIN=/home/user/simcityweb
END=$(( $(date +%s) + ${1:-7000} ))
PAT="^/bin/bash $S/bin/lock.sh timing "
log() { echo "[fair3 $(date -u +%T)] $*"; }
ME=$$
release_placeholder() { [ "$(cat "$L/pid" 2>/dev/null)" = "$ME" ] && rm -rf "${L:?}"; }
trap 'release_placeholder; log "exit"' EXIT
trap 'exit 0' TERM INT HUP
prio() {
  local cwd cmd c age
  cwd=$(readlink "/proc/$1/cwd" 2>/dev/null); cmd=$(tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null)
  if [ "$cwd" = "$MAIN" ] && { [[ "$cmd" == *simbot.ts* ]] || [[ "$cmd" == *vitest\ run* ]]; } && ! [[ "$cmd" == *work/* ]]; then echo 0; return; fi
  if [[ "$cmd" == *simbot.ts* ]] || [[ "$cmd" =~ vitest\ run[^|]*tests/[^\ ]+\.test\.ts ]]; then c=1
  elif [[ "$cmd" == *vitest\ run* ]]; then c=2
  else c=3; fi
  age=$(ps -o etimes= -p "$1" 2>/dev/null | tr -d ' '); age=${age:-0}
  c=$(( c - age / 2700 )); [ "$c" -lt 1 ] && c=1
  echo "$c"
}
start() { awk '{print $22}' "/proc/$1/stat" 2>/dev/null; }
pick() {
  local rows="" p
  for p in $(pgrep -f "$PAT"); do
    [ "$p" = "$(cat "$L/pid" 2>/dev/null)" ] && continue
    # a waiter has only `sleep` children (or none)
    local c ok=1
    for c in $(pgrep -P "$p"); do [ "$(cat /proc/$c/comm 2>/dev/null)" = sleep ] || ok=0; done
    [ $ok = 1 ] || continue
    rows+="$(prio "$p") $(start "$p") $p"$'\n'
  done
  printf '%s' "$rows" | sort -n -k1,1 -k2,2 | awk 'NF{print $3; exit}'
}
log "start"
while [ "$(date +%s)" -lt "$END" ]; do
  if mkdir "$L" 2>/dev/null; then
    echo "$ME" > "$L/pid"; echo "$(date -u +%FT%T) fairlock3 placeholder" > "$L/what"
    next=$(pick)
    if [ -z "$next" ]; then rm -rf "${L:?}"; sleep 1; continue; fi
    log "next: $next ($(tr '\0' ' ' < /proc/$next/cmdline 2>/dev/null | sed "s#$S#\$S#g; s#/bin/bash \$S/bin/lock.sh timing ##" | cut -c1-110))"
    rm -rf "${L:?}"
    pkill -P "$next" -x sleep 2>/dev/null
    # give the chosen waiter a moment to take it; if someone else won, that is fine
    sleep 0.5
    continue
  fi
  sleep 0.02
done
