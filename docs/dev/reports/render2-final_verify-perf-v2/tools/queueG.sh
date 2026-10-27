#!/bin/bash
# GPU stand-in (drawn frames, shadows forced) + triangle / draw-call counts, c024 vs new; then LOW allocations
T=$(cd $(dirname "$0") && pwd); O=$T/../out; L=$T/../logs
VIEWS=street,default,far,edgelow,edget18,edget25
while pgrep -f "^/bin/bash ./queueK.sh" > /dev/null || pgrep -f "^/bin/bash ./queueK2.sh" > /dev/null || pgrep -f "^/bin/bash ./queueK3.sh" > /dev/null; do sleep 20; done
run() { echo "[queueG] $(date +%T) start $1"; node $T/warm.mjs "${@:2}" > $L/$1.log 2>&1; echo "[queueG] $(date +%T) end $1 $(tail -1 $L/$1.log)"; }
run GT_high town high $O/GT.jsonl GT_high 3 $VIEWS c024:c024,c0242:c024,new:new,new2:new nodraw=1 gpu
run GT_ultra town ultra $O/GT.jsonl GT_ultra 3 $VIEWS c024:c024,c0242:c024,new:new,new2:new nodraw=1 gpu
run GT_low town low $O/GT.jsonl GT_low 3 $VIEWS c024:c024,c0242:c024,new:new,new2:new nodraw=1 gpu
echo "[queueG] $(date +%T) all done"
