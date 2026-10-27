#!/bin/bash
# ring attribution at warm town ULTRA: new and V1, each with and without the ring (ring=0)
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
S=zoomout,farorbit,default,cuts,edgepan,edgeturn
echo "[queueRO2] $(date +%T) start RO_town_ultra"
PAGE=bench4 node $T/warm.mjs town ultra $O/RO.jsonl RO_town_ultra 3 $S new:new,nor:new:ring=0,v1:v1,v1nor:v1:ring=0,new2:new nodraw=1 > $L/RO_town_ultra.log 2>&1
echo "[queueRO2] $(date +%T) end RO_town_ultra $(tail -1 $L/RO_town_ultra.log)"
