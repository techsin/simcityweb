#!/bin/bash
# fresh-page queue v3: both base reconstructions (base = a284b80, b48 = be48061) next to new, c024, v1 / N
T=$(cd $(dirname "$0") && pwd); L=$T/../logs
P1=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
GS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
while pgrep -f "^node chain.mjs FGL " > /dev/null; do sleep 20; done
c() { echo "[queueF3] $(date +%T) start $1"; node $T/chain.mjs "$@" > $L/chain_$1.log 2>&1; echo "[queueF3] $(date +%T) end $1 $(tail -1 $L/chain_$1.log)"; }
c FTL 8 fresh base:base,new:new,b48:b48,c024:c024,base2:base,new2:new,b482:b48,v1:v1 -- town low {out} {tag} $P1 $P1 nodraw=1
c FUH 8 uipage base:base,new:new,n:n,b48:b48,base2:base,new2:new -- fresh {side} high {out} {tag} $GS
c FCL 8 fresh base:base,new:new,v1:v1,b48:b48,base2:base,new2:new -- city low {out} {tag} $P1 "" nodraw=1
c FCH 8 fresh base:base,new:new,c024:c024,b48:b48,base2:base,new2:new -- city high {out} {tag} $P1 "" nodraw=1
c FGH 8 game base:base,c024:c024,new:new,new2:new -- high {out} {tag} $GS 40
c FGLb 6 game b48:b48,new:new,b482:b48,new2:new -- low {out} {tag} $GS 40
echo "[queueF3] $(date +%T) all done"
