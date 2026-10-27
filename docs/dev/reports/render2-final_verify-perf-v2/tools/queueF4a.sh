#!/bin/bash
# fresh queue v4a (load 60+ on 4 cores: pass 1 only, fewer labels): town LOW, then dense city HIGH
T=$(cd $(dirname "$0") && pwd); L=$T/../logs
P1=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
c() { echo "[queueF4a] $(date +%T) start $1"; node $T/chain.mjs "$@" > $L/chain_$1.log 2>&1; echo "[queueF4a] $(date +%T) end $1 $(tail -1 $L/chain_$1.log)"; }
c FTL 8 fresh base:base,new:new,b48:b48,c024:c024,base2:base,new2:new -- town low {out} {tag} $P1 "" nodraw=1
c FCH 8 fresh base:base,new:new,c024:c024,base2:base,new2:new -- city high {out} {tag} $P1 "" nodraw=1
echo "[queueF4a] $(date +%T) all done"
