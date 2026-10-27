#!/bin/bash
# real load path LOW without WebAudio, base vs new (8 reps): the audio director's timers and WebAudio's node-finish
# tasks scale with wall time (seconds per frame at this load), which confounds FGL's whole-main-thread segment CPU
T=$(cd $(dirname "$0") && pwd); L=$T/../logs
GS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
echo "[queueNB] $(date +%T) start FGLnb"
NOAUDIO=1 node $T/chain.mjs FGLnb 8 game base:base,new:new,base2:base,new2:new -- low {out} {tag} $GS 40 > $L/chain_FGLnb.log 2>&1
echo "[queueNB] $(date +%T) end FGLnb"
