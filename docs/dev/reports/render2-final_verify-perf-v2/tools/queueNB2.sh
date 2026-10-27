#!/bin/bash
# real load path LOW without WebAudio vs the calibrated base be48061 (b48), 6 reps: whole-app comparison closer in UI/sim
T=$(cd $(dirname "$0") && pwd); L=$T/../logs
GS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
echo "[queueNB2] $(date +%T) start FGLnb2"
NOAUDIO=1 node $T/chain.mjs FGLnb2 6 game b48:b48,new:new,b482:b48,new2:new -- low {out} {tag} $GS 40 > $L/chain_FGLnb2.log 2>&1
echo "[queueNB2] $(date +%T) end FGLnb2"
