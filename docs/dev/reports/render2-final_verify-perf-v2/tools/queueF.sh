#!/bin/bash
# fresh-page queue (after the FGL chain): one chain at a time
T=$(cd $(dirname "$0") && pwd); L=$T/../logs
P1=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
GS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
while pgrep -f "chain.mjs FGL" > /dev/null; do sleep 20; done
c() { echo "[queueF] $(date +%T) start $1"; node $T/chain.mjs "$@" > $L/chain_$1.log 2>&1; echo "[queueF] $(date +%T) end $1 $(tail -1 $L/chain_$1.log)"; }
# bench town LOW (first motions, gate 1 majors a/b on the bench page); pass 2 = the same segments warm in the page
c FTL 8 fresh base:base,c024:c024,v1:v1,new:new,base2:base,new2:new -- town low {out} {tag} $P1 $P1 nodraw=1
# ui page HIGH (first zoom-in; N had ~1.16x base)
c FUH 8 uipage base:base,n:n,new:new,base2:base,new2:new -- fresh {side} high {out} {tag} $GS
# dense city LOW (first zoom-in / far orbit vs V1 and base)
c FCL 8 fresh base:base,v1:v1,new:new,base2:base,new2:new -- city low {out} {tag} $P1 "" nodraw=1
# dense city HIGH (first street-settle)
c FCH 8 fresh base:base,new:new,base2:base,new2:new,c024:c024 -- city high {out} {tag} $P1 "" nodraw=1
# real load path HIGH (gate 3 frames, first motions)
c FGH 8 game base:base,c024:c024,new:new,base2:base,new2:new -- high {out} {tag} $GS 40
echo "[queueF] $(date +%T) all done"
