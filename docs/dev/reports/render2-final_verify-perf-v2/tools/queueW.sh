#!/bin/bash
# warm-page queue (runs strictly one after another); each line: name scene q rows segs labels extra mode
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
SEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts,edgepan,edgefast,edgeturn
CSEGS=street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts
VIEWS=street,default,far,edgelow,edget18,edget25
run() { echo "[queueW] $(date +%T) start $1"; node $T/warm.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueW] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
run WT_high town high $O/WT.jsonl WT_high 5 $SEGS base:base,base2:base,v1:v1,new:new,new2:new nodraw=1
run WT_ultra town ultra $O/WT.jsonl WT_ultra 4 $SEGS base:base,base2:base,v1:v1,new:new,new2:new nodraw=1
run WT_low town low $O/WT.jsonl WT_low 5 $SEGS base:base,base2:base,v1:v1,new:new,new2:new nodraw=1
run WC_low city low $O/WC.jsonl WC_low 4 $CSEGS base:base,base2:base,v1:v1,new:new,new2:new nodraw=1
run WC_high city high $O/WC.jsonl WC_high 4 $CSEGS base:base,base2:base,v1:v1,new:new,new2:new nodraw=1
run WC_ultra city ultra $O/WC.jsonl WC_ultra 3 $CSEGS base:base,base2:base,v1:v1,new:new,new2:new nodraw=1
run GT_high town high $O/GT.jsonl GT_high 3 $VIEWS c024:c024,c0242:c024,new:new,new2:new nodraw=1 gpu
run GT_ultra town ultra $O/GT.jsonl GT_ultra 3 $VIEWS c024:c024,c0242:c024,new:new,new2:new nodraw=1 gpu
run GT_low town low $O/GT.jsonl GT_low 3 $VIEWS c024:c024,c0242:c024,new:new,new2:new nodraw=1 gpu
echo "[queueW] $(date +%T) all done"
