#!/usr/bin/env bash
# Phase 3: synced render-burst cost per scene x quality x resolution (cross-check for the timer queries).
D=/c/Users/techsin/AppData/Local/Temp/claude/C--Users-techsin-Desktop-projects-simcityweb/aa362639-df94-5668-b880-d90605d049a2/scratchpad/t003
OUT=$D/out3
LOG=$D/matrix3.log
mkdir -p "$OUT"
run() { echo "=== $(date -u +%H:%M:%S) $*" >> "$LOG"; timeout 900 node "$D/run.mjs" "$@" >> "$LOG" 2>&1 || echo "FAILED rc=$? $*" >> "$LOG"; }
for res in "1920 1080" "3840 2160"; do for s in city ui world gamefresh game300k; do for q in low high ultra; do run gpu $s $q $res "$OUT" burst; done; done; done
echo "=== MATRIX3 DONE $(date -u +%H:%M:%S)" >> "$LOG"
