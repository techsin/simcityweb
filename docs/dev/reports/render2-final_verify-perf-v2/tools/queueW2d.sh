#!/bin/bash
# warm master queue v2d (replaces queueW2c while GT_low runs): GT2_* = still views + drawn samples along sequences
# (warm4, bench3), warm matrix vs both bases, calibration (WK3), moving triangles / calls vs c024 (WC), allocations (WA)
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
SEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts,edgepan,edgefast,edgeturn
CSEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
USEGS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
VIEWS=street,default,far,edgelow,edget18,edget25
SEQS=cuts,edgefast,edgeturn,fastpan
while pgrep -f "warm.mjs town low .*GT_low" > /dev/null; do sleep 20; done
run() { echo "[queueW2d] $(date +%T) start $1"; node $T/warm.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueW2d] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
run4() { echo "[queueW2d] $(date +%T) start $1"; node $T/warm4.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueW2d] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
runu() { echo "[queueW2d] $(date +%T) start $1"; node $T/uipage.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueW2d] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
run WM_town_low town low $O/WM.jsonl WM_town_low 5 $SEGS base:base,b48:b48,new:new,new2:new,b482:b48,v1:v1 nodraw=1
run WK3_city_low city low $O/WK.jsonl WK3_city_low 3 $CSEGS base:base,v1:v1,b53:b53 nodraw=1
run4 GT2_high town high $O/GT2.jsonl GT2_high 3 $VIEWS $SEQS c024:c024,c0242:c024,new:new,new2:new nodraw=1
run4 GT2_ultra town ultra $O/GT2.jsonl GT2_ultra 3 $VIEWS $SEQS c024:c024,c0242:c024,new:new,new2:new nodraw=1
run WM_town_high town high $O/WM.jsonl WM_town_high 4 $SEGS base:base,b48:b48,new:new,new2:new,b482:b48 nodraw=1
run WM_city_low city low $O/WM.jsonl WM_city_low 4 $CSEGS base:base,b48:b48,new:new,new2:new nodraw=1
run WC_town_low town low $O/WC.jsonl WC_town_low 1 $SEGS c024:c024,new:new nodraw=1
run WC_city_low city low $O/WC.jsonl WC_city_low 1 $CSEGS c024:c024,new:new nodraw=1
run4 GQ_low town low $O/GT2.jsonl GQ_low 3 street,default,far cuts,edgefast,fastpan c024:c024,c0242:c024,new:new,new2:new nodraw=1
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
echo "[queueW2d] $(date +%T) all done"
