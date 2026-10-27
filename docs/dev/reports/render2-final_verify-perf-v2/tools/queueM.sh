#!/bin/bash
# warm-page matrix vs the b48 base (town, dense city, ui x LOW, HIGH, ULTRA) + allocations; after queueG
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
SEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts,edgepan,edgefast,edgeturn
CSEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
USEGS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
while pgrep -f "^/bin/bash ./queueG.sh" > /dev/null; do sleep 20; done
run() { echo "[queueM] $(date +%T) start $1"; node $T/warm.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueM] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
runu() { echo "[queueM] $(date +%T) start $1"; node $T/uipage.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueM] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
run WM_town_low town low $O/WM.jsonl WM_town_low 5 $SEGS b48:b48,b482:b48,new:new,new2:new,v1:v1 nodraw=1
run WM_town_high town high $O/WM.jsonl WM_town_high 4 $SEGS b48:b48,b482:b48,new:new,new2:new,v1:v1 nodraw=1
run WM_town_ultra town ultra $O/WM.jsonl WM_town_ultra 4 $SEGS b48:b48,b482:b48,new:new,new2:new,v1:v1 nodraw=1
run WM_city_low city low $O/WM.jsonl WM_city_low 4 $CSEGS b48:b48,b482:b48,new:new,new2:new nodraw=1
run WM_city_high city high $O/WM.jsonl WM_city_high 3 $CSEGS b48:b48,b482:b48,new:new,new2:new nodraw=1
run WM_city_ultra city ultra $O/WM.jsonl WM_city_ultra 3 $CSEGS b48:b48,b482:b48,new:new,new2:new nodraw=1
runu WM_ui_high warm high $O/WMU.jsonl WM_ui_high 4 $USEGS b48:b48,b482:b48,new:new,new2:new
runu WM_ui_low warm low $O/WMU.jsonl WM_ui_low 4 $USEGS b48:b48,b482:b48,new:new,new2:new
runu WM_ui_ultra warm ultra $O/WMU.jsonl WM_ui_ultra 4 $USEGS b48:b48,b482:b48,new:new,new2:new
run WA_town_low town low $O/WA.jsonl WA_town_low 2 $CSEGS b48:b48,c024:c024,new:new nodraw=1 alloc
run WA_town_high town high $O/WA.jsonl WA_town_high 2 $CSEGS b48:b48,c024:c024,new:new nodraw=1 alloc
echo "[queueM] $(date +%T) all done"
