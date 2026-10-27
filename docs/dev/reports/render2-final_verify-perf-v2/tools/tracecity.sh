#!/bin/bash
# V8 CPU profile of the fresh dense city HIGH first street pan: new, base
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
for s in new base; do node $T/tracebench.mjs $s city high street,zoomout,farorbit,default,zoomin,streetpan streetpan $O/tb_${s}_cityhigh.json > $L/tb_${s}_cityhigh.log 2>&1; done
echo "[tracecity] $(date +%T) done"
