#!/bin/bash
# ui page HIGH fresh vs the calibrated base be48061 (b48): v1 major (b) ui part
T=$(cd $(dirname "$0") && pwd); L=$T/../logs
GS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
echo "[queueFUb] $(date +%T) start FUHb"
node $T/chain.mjs FUHb 8 uipage b48:b48,new:new,b482:b48,new2:new -- fresh {side} high {out} {tag} $GS > $L/chain_FUHb.log 2>&1
echo "[queueFUb] $(date +%T) end FUHb"
