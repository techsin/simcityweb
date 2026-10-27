#!/bin/bash
# after chain FGL: the real load path at HIGH (4 reps), (FGL r8-r9 dropped: FGLnb runs without audio instead)
T=$(cd $(dirname "$0") && pwd); L=$T/../logs
GS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
while pgrep -f "^node chain.mjs FGL " > /dev/null; do sleep 20; done
c() { echo "[queueF4c] $(date +%T) start $1"; node $T/chain.mjs "$@" > $L/chain_$1_$2.log 2>&1; echo "[queueF4c] $(date +%T) end $1 $(tail -1 $L/chain_$1_$2.log)"; }
c FGH 4 game base:base,c024:c024,new:new,new2:new -- high {out} {tag} $GS 40
echo "[queueF4c] $(date +%T) all done"
