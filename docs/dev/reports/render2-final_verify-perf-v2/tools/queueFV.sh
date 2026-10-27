#!/bin/bash
# fresh-page calibration: V1 vs a284b80 on the fresh LOW town (v1 measured first zoom-out 1.059, zoom-in 1.057)
T=$(cd $(dirname "$0") && pwd); L=$T/../logs
P1=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
echo "[queueFV] $(date +%T) start FTLv"
node $T/chain.mjs FTLv 6 fresh v1:v1,base:base,v12:v1,base2:base -- town low {out} {tag} $P1 "" nodraw=1 > $L/chain_FTLv.log 2>&1
echo "[queueFV] $(date +%T) end FTLv"
