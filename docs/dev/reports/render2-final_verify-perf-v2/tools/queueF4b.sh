#!/bin/bash
# fresh queue v4b: dense city LOW (v1 for the seasons-final attribution), then the ui page HIGH
T=$(cd $(dirname "$0") && pwd); L=$T/../logs
P1=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
GS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
c() { echo "[queueF4b] $(date +%T) start $1"; node $T/chain.mjs "$@" > $L/chain_$1.log 2>&1; echo "[queueF4b] $(date +%T) end $1 $(tail -1 $L/chain_$1.log)"; }
c FCL 8 fresh base:base,new:new,v1:v1,b48:b48,base2:base,new2:new -- city low {out} {tag} $P1 "" nodraw=1
c FUH 8 uipage base:base,new:new,n:n,base2:base,new2:new -- fresh {side} high {out} {tag} $GS
echo "[queueF4b] $(date +%T) all done"
