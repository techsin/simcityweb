#!/bin/bash
# real load path LOW without WebAudio (attribution of the frame-2 backlog): after the trace batch
T=$(cd $(dirname "$0") && pwd); L=$T/../logs
while pgrep -f "^/bin/bash ./tracebatch.sh" > /dev/null; do sleep 15; done
echo "[queueNA] $(date +%T) start FGLna"
NOAUDIO=1 node $T/chain.mjs FGLna 6 game c024:c024,new:new,b48:b48,c0242:c024,new2:new -- low {out} {tag} street,zoomout,zoomin 40 > $L/chain_FGLna.log 2>&1
echo "[queueNA] $(date +%T) end FGLna"
