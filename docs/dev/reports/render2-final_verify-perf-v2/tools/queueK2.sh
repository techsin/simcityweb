#!/bin/bash
# base calibration, hybrid candidate (a284b80 render + be48061 assets), after queueK
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
SEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts,edgepan,edgefast,edgeturn
CSEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
while pgrep -f "^/bin/bash ./queueK.sh" > /dev/null; do sleep 20; done
run() { echo "[queueK2] $(date +%T) start $1"; node $T/warm.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueK2] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
run WK2_town_low town low $O/WK.jsonl WK2_town_low 4 $SEGS hyb:hyb,hyb2:hyb,v1:v1,v12:v1,b48:b48 nodraw=1
run WK2_city_low city low $O/WK.jsonl WK2_city_low 3 $CSEGS hyb:hyb,hyb2:hyb,v1:v1,v12:v1 nodraw=1
echo "[queueK2] $(date +%T) all done"
