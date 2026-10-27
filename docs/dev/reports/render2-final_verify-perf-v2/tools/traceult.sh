#!/bin/bash
# V8 CPU profile of the WARM town ULTRA far orbit (3rd occurrence): new, v1
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
P=zoomout,farorbit,default,edgepan,edgeturn,zoomout,farorbit,default,edgepan,edgeturn,zoomout,farorbit
for s in new v1; do TARGET_N=3 node $T/tracebench.mjs $s town ultra $P farorbit $O/tb_${s}_ultra_far.json > $L/tb_${s}_ultra_far.log 2>&1; done
echo "[traceult] $(date +%T) done"
