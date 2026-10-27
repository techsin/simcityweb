#!/bin/bash
# V1 moving counts in the dense city LOW (attribution of the cut sequence's shadow triangles vs c024)
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
CSEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
echo "[queueWV] $(date +%T) start WCv_city_low"
node $T/warm.mjs city low $O/WC.jsonl WCv_city_low 1 $CSEGS c024:c024,v1:v1,new:new nodraw=1 > $L/WCv_city_low.log 2>&1
echo "[queueWV] $(date +%T) end WCv_city_low $(tail -1 $L/WCv_city_low.log)"
