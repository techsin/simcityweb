#!/bin/bash
# warm master queue v2b (replaces queueW2 after its first item): GPU stand-in + triangles vs c024 (LOW first), warm
# matrix vs both bases, moving triangles / draw calls vs c024 (WC), allocations
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
SEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts,edgepan,edgefast,edgeturn
CSEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
USEGS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
VIEWS=street,default,far,edgelow,edget18,edget25
while pgrep -f "warm.mjs city high .*WK_city_high" > /dev/null; do sleep 20; done
run() { echo "[queueW2c] $(date +%T) start $1"; node $T/warm.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueW2c] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
runu() { echo "[queueW2c] $(date +%T) start $1"; node $T/uipage.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueW2c] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
run GT_low town low $O/GT.jsonl GT_low 3 $VIEWS c024:c024,c0242:c024,new:new,new2:new nodraw=1 gpu
run WM_town_low town low $O/WM.jsonl WM_town_low 5 $SEGS base:base,b48:b48,new:new,new2:new,b482:b48,v1:v1 nodraw=1
run WK3_city_low city low $O/WK.jsonl WK3_city_low 3 $CSEGS base:base,v1:v1,b53:b53 nodraw=1
run GT_high town high $O/GT.jsonl GT_high 3 $VIEWS c024:c024,c0242:c024,new:new,new2:new nodraw=1 gpu
run GT_ultra town ultra $O/GT.jsonl GT_ultra 3 $VIEWS c024:c024,c0242:c024,new:new,new2:new nodraw=1 gpu
run WM_town_high town high $O/WM.jsonl WM_town_high 4 $SEGS base:base,b48:b48,new:new,new2:new,b482:b48 nodraw=1
run WM_city_low city low $O/WM.jsonl WM_city_low 4 $CSEGS base:base,b48:b48,new:new,new2:new nodraw=1
run WC_town_low town low $O/WC.jsonl WC_town_low 1 $SEGS c024:c024,new:new nodraw=1
run WC_city_low city low $O/WC.jsonl WC_city_low 1 $CSEGS c024:c024,new:new nodraw=1
run WK3_town_low town low $O/WK.jsonl WK3_town_low 3 $SEGS b53:b53,v1:v1 nodraw=1
run WM_town_ultra town ultra $O/WM.jsonl WM_town_ultra 4 $SEGS base:base,b48:b48,new:new,new2:new,b482:b48 nodraw=1
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
echo "[queueW2c] $(date +%T) all done"
