#!/bin/bash
# traces of the real load path's first zoom-out without WebAudio: new, base
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
for s in new base; do NOAUDIO=1 node $T/tracezoom.mjs $s low $O/tzna_${s}_1.json zoomout > $L/tzna_${s}_1.log 2>&1; done
echo "[tracez2] $(date +%T) done"
