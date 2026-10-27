#!/bin/bash
# ring attribution at warm town HIGH: new with the ring vs new with ring=0 (ring + edge band off) vs a284b80
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
S=street,zoomout,farorbit,default,zoomin,cuts,edgepan,edgefast,edgeturn
echo "[queueRO] $(date +%T) start RO_town_high"
PAGE=bench4 node $T/warm.mjs town high $O/RO.jsonl RO_town_high 3 $S new:new,nor:new:ring=0,base:base,new2:new,nor2:new:ring=0 nodraw=1 > $L/RO_town_high.log 2>&1
echo "[queueRO] $(date +%T) end RO_town_high $(tail -1 $L/RO_town_high.log)"
