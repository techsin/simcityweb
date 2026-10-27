#!/bin/bash
# drawn-mode check of the calibration gap (all GL calls incl. draws, 1x1 scissor): warm town LOW, short segments
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
while pgrep -f "^/bin/bash ./queueK.sh" > /dev/null || pgrep -f "^/bin/bash ./queueK2.sh" > /dev/null; do sleep 20; done
echo "[queueK3] $(date +%T) start WS_town_low"
PAGE=bench2 node $T/warm.mjs town low $O/WS.jsonl WS_town_low 3 street,streetfast,fastpan,cuts base:base,base2:base,v1:v1,v12:v1,hyb:hyb draw=scissor > $L/WS_town_low.log 2>&1
echo "[queueK3] $(date +%T) end WS_town_low $(tail -1 $L/WS_town_low.log)"
