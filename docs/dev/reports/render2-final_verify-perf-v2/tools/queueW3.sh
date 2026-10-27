#!/bin/bash
# parallel warm stream (ui page warm matrix + allocations), beside queueW2h
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
SEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts,edgepan,edgefast,edgeturn
CSEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
USEGS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
run() { echo "[queueW3] $(date +%T) start $1"; node $T/warm.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueW3] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
runu() { echo "[queueW3] $(date +%T) start $1"; node $T/uipage.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueW3] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
runu WM_ui_high warm high $O/WMU.jsonl WM_ui_high 4 $USEGS base:base,b48:b48,new:new,new2:new
run WA_town_low town low $O/WA.jsonl WA_town_low 2 $CSEGS base:base,b48:b48,c024:c024,new:new nodraw=1 alloc
runu WM_ui_low warm low $O/WMU.jsonl WM_ui_low 4 $USEGS base:base,b48:b48,new:new,new2:new
run WA_town_high town high $O/WA.jsonl WA_town_high 2 $CSEGS base:base,b48:b48,c024:c024,new:new nodraw=1 alloc
runu WM_ui_ultra warm ultra $O/WMU.jsonl WM_ui_ultra 4 $USEGS base:base,b48:b48,new:new,new2:new
echo "[queueW3] $(date +%T) all done"
