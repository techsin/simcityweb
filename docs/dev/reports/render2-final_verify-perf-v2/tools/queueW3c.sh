#!/bin/bash
# ui page warm ULTRA and LOW (rerun: WM_ui_low's poller file was read truncated), 2 rows each, poller race fixed
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
USEGS=street,zoomout,farorbit,default,zoomin,pan,fastpan,cuts
runu() { echo "[queueW3c] $(date +%T) start $1"; node $T/uipage.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueW3c] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
runu WM_ui_ultra2 warm ultra $O/WMU.jsonl WM_ui_ultra2 2 $USEGS base:base,b48:b48,new:new,new2:new
runu WM_ui_low2 warm low $O/WMU.jsonl WM_ui_low2 2 $USEGS base:base,b48:b48,new:new,new2:new
echo "[queueW3c] $(date +%T) all done"
