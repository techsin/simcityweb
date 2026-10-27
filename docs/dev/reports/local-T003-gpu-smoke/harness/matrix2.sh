#!/usr/bin/env bash
# Phase 2: per-frame GPU (timer query) and main-thread CPU (rAF callback time) at 60 Hz, all scenes x qualities x resolutions.
D=/c/Users/techsin/AppData/Local/Temp/claude/C--Users-techsin-Desktop-projects-simcityweb/aa362639-df94-5668-b880-d90605d049a2/scratchpad/t003
OUT=$D/out2
LOG=$D/matrix2.log
mkdir -p "$OUT"
run() { echo "=== $(date -u +%H:%M:%S) $*" >> "$LOG"; timeout 900 node "$D/run.mjs" "$@" >> "$LOG" 2>&1 || echo "FAILED rc=$? $*" >> "$LOG"; }
for res in "1920 1080" "3840 2160"; do for s in city ui world gamefresh game300k; do for q in low high ultra; do run gpu $s $q $res "$OUT" timing; done; done; done
echo "=== MATRIX2 DONE $(date -u +%H:%M:%S)" >> "$LOG"
