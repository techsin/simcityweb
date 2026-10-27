#!/bin/bash
# base calibration with the candidate be48061 (b48) next to a284b80 (base) and V1 (v1)
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
SEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts,edgepan,edgefast,edgeturn
CSEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
while kill -0 4527 2>/dev/null; do sleep 10; done
run() { echo "[queueK] $(date +%T) start $1"; node $T/warm.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueK] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
run WK_town_low town low $O/WK.jsonl WK_town_low 5 $SEGS b48:b48,b482:b48,base:base,v1:v1,v12:v1 nodraw=1
run WK_city_low city low $O/WK.jsonl WK_city_low 4 $CSEGS b48:b48,b482:b48,v1:v1,v12:v1 nodraw=1
run WK_town_high town high $O/WK.jsonl WK_town_high 4 $SEGS b48:b48,b482:b48,base:base,v1:v1,v12:v1 nodraw=1
echo "[queueK] $(date +%T) all done"
