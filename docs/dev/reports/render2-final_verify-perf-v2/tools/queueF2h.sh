#!/bin/bash
# fresh-page queue v2 (base candidates: b48 = be48061 (calibrated base candidate), base = a284b80): one chain at a time
T=$(cd $(dirname "$0") && pwd); L=$T/../logs
P1=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
GS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
while pgrep -f "^node chain.mjs FGL" > /dev/null; do sleep 20; done
c() { echo "[queueF2h] $(date +%T) start $1"; node $T/chain.mjs "$@" > $L/chain_$1.log 2>&1; echo "[queueF2h] $(date +%T) end $1 $(tail -1 $L/chain_$1.log)"; }
# bench town LOW: first motions (gate 1 majors a/b on the bench page), fresh first frames, load; pass 2 = warm in-page
c FTL 8 fresh hyb:hyb,new:new,b48:b48,c024:c024,hyb2:hyb,new2:new,v1:v1,base:base -- town low {out} {tag} $P1 $P1 nodraw=1
# ui page HIGH: first zoom-in (N had ~1.16x its base)
c FUH 8 uipage hyb:hyb,new:new,n:n,hyb2:hyb,new2:new -- fresh {side} high {out} {tag} $GS
# dense city LOW: first zoom-in / far orbit vs V1 and base
c FCL 8 fresh hyb:hyb,new:new,v1:v1,hyb2:hyb,new2:new,b48:b48 -- city low {out} {tag} $P1 "" nodraw=1
# dense city HIGH: first street-settle
c FCH 8 fresh hyb:hyb,new:new,c024:c024,hyb2:hyb,new2:new -- city high {out} {tag} $P1 "" nodraw=1
# real load path HIGH: gate 3 frames vs c024, first motions vs base
c FGH 8 game hyb:hyb,c024:c024,new:new,new2:new -- high {out} {tag} $GS 40
# real load path LOW with the b48 base (first motions)
c FGLb 6 game hyb:hyb,new:new,hyb2:hyb,new2:new -- low {out} {tag} $GS 40
echo "[queueF2h] $(date +%T) all done"
