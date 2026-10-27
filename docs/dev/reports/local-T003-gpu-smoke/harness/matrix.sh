#!/usr/bin/env bash
# Runs the T003 matrix sequentially (one browser at a time so runs do not disturb each other).
D=/c/Users/techsin/AppData/Local/Temp/claude/C--Users-techsin-Desktop-projects-simcityweb/aa362639-df94-5668-b880-d90605d049a2/scratchpad/t003
OUT=$D/out
LOG=$D/matrix.log
SCENES="city ui world gamefresh game300k"
run() { echo "=== $(date -u +%H:%M:%S) $*" >> "$LOG"; timeout 1500 node "$D/run.mjs" "$@" >> "$LOG" 2>&1 || echo "FAILED rc=$? $*" >> "$LOG"; }
for res in "1920 1080" "3840 2160"; do for s in $SCENES; do for q in low high ultra; do run gpu $s $q $res "$OUT" shots,timing; done; done; done
for res in "1920 1080" "3840 2160"; do for s in $SCENES; do for q in low high ultra; do run gpuu $s $q $res "$OUT" timing; done; done; done
for s in $SCENES; do for q in low high ultra; do run ss $s $q 1920 1080 "$OUT" shots; done; done
echo "=== MATRIX DONE $(date -u +%H:%M:%S)" >> "$LOG"
