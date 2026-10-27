#!/bin/bash
# warm master queue v2f (replaces W2e while WM_town_low runs): the GPU stand-in is not measurable at load 55-75 (GT_low:
# identical browsers differ 1.5-3x per drawn frame; SwiftShader workers spin for seconds) -> deterministic counts instead
# (stills.mjs nodraw still views; WC moving segments), warm matrix, calibration (WK3), allocations
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
SEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts,edgepan,edgefast,edgeturn
CSEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
USEGS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
while pgrep -f "warm.mjs town high .*WM_town_high" > /dev/null; do sleep 20; done
run() { echo "[queueW2g] $(date +%T) start $1"; node $T/warm.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueW2g] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
runs() { echo "[queueW2g] $(date +%T) start $1"; node $T/stills.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueW2g] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
runu() { echo "[queueW2g] $(date +%T) start $1"; node $T/uipage.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueW2g] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
run WR_town_high town high $O/WM.jsonl WR_town_high 3 $SEGS base:base,new:new,new2:new,v1:v1,v12:v1 nodraw=1
run WM_city_low city low $O/WM.jsonl WM_city_low 4 $CSEGS base:base,b48:b48,new:new,new2:new nodraw=1
run WC_town_low town low $O/WC.jsonl WC_town_low 1 $SEGS c024:c024,new:new nodraw=1
run WC_city_low city low $O/WC.jsonl WC_city_low 1 $CSEGS c024:c024,new:new nodraw=1
run WM_town_ultra town ultra $O/WM.jsonl WM_town_ultra 4 $SEGS base:base,b48:b48,new:new,new2:new,v1:v1 nodraw=1
run WM_city_high city high $O/WM.jsonl WM_city_high 3 $CSEGS base:base,b48:b48,new:new,new2:new nodraw=1
runu WM_ui_high warm high $O/WMU.jsonl WM_ui_high 4 $USEGS base:base,b48:b48,new:new,new2:new
run WC_town_high town high $O/WC.jsonl WC_town_high 1 $SEGS c024:c024,new:new nodraw=1
run WC_town_ultra town ultra $O/WC.jsonl WC_town_ultra 1 $SEGS c024:c024,new:new nodraw=1
run WA_town_low town low $O/WA.jsonl WA_town_low 2 $CSEGS base:base,b48:b48,c024:c024,new:new nodraw=1 alloc
run WM_city_ultra city ultra $O/WM.jsonl WM_city_ultra 3 $CSEGS base:base,b48:b48,new:new,new2:new nodraw=1
runu WM_ui_low warm low $O/WMU.jsonl WM_ui_low 4 $USEGS base:base,b48:b48,new:new,new2:new
runu WM_ui_ultra warm ultra $O/WMU.jsonl WM_ui_ultra 4 $USEGS base:base,b48:b48,new:new,new2:new
run WA_town_high town high $O/WA.jsonl WA_town_high 2 $CSEGS base:base,b48:b48,c024:c024,new:new nodraw=1 alloc
run WC_city_high city high $O/WC.jsonl WC_city_high 1 $CSEGS c024:c024,new:new nodraw=1
runs ST_city $O/ST.jsonl city low,high c024:c024,new:new street,default,far
echo "[queueW2g] $(date +%T) all done"
