#!/bin/bash
# traces of the real load path's first zoom-out: new, base, new, base (LOW)
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
for s in new base; do node $T/tracezoom.mjs $s low $O/tz_${s}_1.json zoomout > $L/tz_${s}_1.log 2>&1; done
echo "[tracez] $(date +%T) done"
