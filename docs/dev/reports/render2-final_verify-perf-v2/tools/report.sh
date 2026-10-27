#!/bin/bash
# all tables (writes tables/*.txt): bash report.sh
T=$(cd $(dirname "$0") && pwd); O=$T/../out; TB=$T/../tables
mkdir -p $TB
cd $T
# calibration (warm town / city, pooled moving)
node anawarm.mjs $O/WT_cal.jsonl v1,v12 base,base2 cpu WTcal_low 1 > $TB/cal_WTcal_low_V1_vs_a284b80.txt 2>&1
node anawarm.mjs $O/WT.jsonl v1 base,base2 cpu WT_high 1 > $TB/cal_WT_high_V1_vs_a284b80.txt 2>&1
node anawarm.mjs $O/WT.jsonl new,new2 base,base2 cpu WT_high 1 > $TB/warm_WT_high_new_vs_a284b80.txt 2>&1
for t in WK_town_low WK_town_high; do
  node anawarm.mjs $O/WK.jsonl v1,v12 b48,b482 cpu $t 1 > $TB/cal_${t}_V1_vs_b48.txt 2>&1
  node anawarm.mjs $O/WK.jsonl v1,v12 base cpu $t 1 > $TB/cal_${t}_V1_vs_a284b80.txt 2>&1
  node anawarm.mjs $O/WK.jsonl base b48,b482 cpu $t 1 > $TB/cal_${t}_a284b80_vs_b48.txt 2>&1
done
node anawarm.mjs $O/WK.jsonl v1,v12 b48,b482 cpu WK_city_low 1 > $TB/cal_WK_city_low_V1_vs_b48.txt 2>&1
# real load path
for s in FGL FGH FGLb; do [ -f $O/$s.jsonl ] && node anagame.mjs $s new,new2 base,base2 c024 > $TB/game_${s}_vs_a284b80.txt 2>&1; done
for s in FGL FGH FGLb; do [ -f $O/$s.jsonl ] && node anagame.mjs $s new,new2 b48,b482 c024 > $TB/game_${s}_vs_b48.txt 2>&1; done
# fresh bench pages
for s in FTL FCL FCH; do [ -f $O/$s.jsonl ] && node anafresh.mjs $s new,new2 b48,b482 c024,v1,base > $TB/fresh_${s}_vs_b48.txt 2>&1; done
for s in FTL; do [ -f $O/$s.jsonl ] && node anafresh.mjs $s new,new2 base c024,v1 > $TB/fresh_${s}_vs_a284b80.txt 2>&1; done
# gpu
[ -f $O/GT.jsonl ] && node anagpu.mjs $O/GT.jsonl new,new2 c024,c0242 med > $TB/gpu_GT_new_vs_c024.txt 2>&1
ls -la $TB
