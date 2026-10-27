#!/bin/bash
cd $(dirname "$0")
for k in 1 2 3; do timeout 900 node gametrace.mjs new low ../out/trace_new_low_$k.json 8 > ../logs/trace_new_low_$k.log 2>&1; done
for k in 1 2; do timeout 900 node gametrace.mjs c024 low ../out/trace_c024_low_$k.json 8 > ../logs/trace_c024_low_$k.log 2>&1; done
echo done
