#!/bin/bash
# final tables (perfrev-v2): bash report2.sh  -> ../tables/*.txt
T=$(cd $(dirname "$0") && pwd); O=$T/../out; TB=$T/../tables
mkdir -p $TB
cd $T
# calibration
node anacal.mjs > $TB/cal_all_runs.txt 2>&1
node anawarm.mjs $O/WK.jsonl v1 base cpu WK3_city_low 1 > $TB/cal_city_low_V1_vs_a284b80.txt 2>&1
node anawarm.mjs $O/WK.jsonl v1 b53 cpu WK3_city_low 1 > $TB/cal_city_low_V1_vs_535655d.txt 2>&1
node anawarm.mjs $O/WK.jsonl v1,v12 b48,b482 cpu WK_city_low 1 > $TB/cal_city_low_V1_vs_be48061.txt 2>&1
node anawarm.mjs $O/WK.jsonl v1,v12 b48,b482 cpu WK_city_high 1 > $TB/cal_city_high_V1_vs_be48061.txt 2>&1
node anawarm.mjs $O/WM.jsonl v1 base cpu WM_town_low 1 > $TB/cal_town_low_V1_vs_a284b80_WM.txt 2>&1
node anawarm.mjs $O/WM.jsonl v1 b48,b482 cpu WM_town_low 1 > $TB/cal_town_low_V1_vs_be48061_WM.txt 2>&1
node anafresh.mjs FTLv v1,v12 base,base2 > $TB/cal_fresh_town_low_V1_vs_a284b80.txt 2>&1
# fresh bench pages
node anafresh.mjs FTL new,new2 base,base2 b48,c024 > $TB/fresh_town_low_vs_a284b80.txt 2>&1
node anafresh.mjs FTL new,new2 b48 > $TB/fresh_town_low_vs_be48061.txt 2>&1
node anafresh.mjs FCL new,new2 base,base2 v1,b48 > $TB/fresh_city_low_vs_a284b80.txt 2>&1
node anafresh.mjs FCH new,new2 base,base2 c024 > $TB/fresh_city_high_vs_a284b80.txt 2>&1
node anatris.mjs FTL new c024 base > $TB/tris_fresh_town_low_vs_c024.txt 2>&1
node anatris.mjs FCH new c024 > $TB/tris_fresh_city_high_vs_c024.txt 2>&1
node anatris.mjs FCL new v1 base > $TB/tris_fresh_city_low_vs_V1.txt 2>&1
# ui page
node anaui.mjs FUH new,new2 base,base2 n > $TB/fresh_ui_high_vs_a284b80.txt 2>&1
node anaph.mjs FUH > $TB/fresh_ui_high_phase_split.txt 2>&1
node anaui.mjs FUHb new,new2 b48,b482 > $TB/fresh_ui_high_vs_be48061_1rep.txt 2>&1
# real load path
node anagame.mjs FGL new,new2 base,base2 c024 > $TB/game_low_audio_vs_a284b80.txt 2>&1
node analp.mjs FGL > $TB/game_low_audio_scene_callback.txt 2>&1
node anagame.mjs FGLnb new,new2 base,base2 > $TB/game_low_noaudio_vs_a284b80.txt 2>&1
node anaph.mjs FGLnb > $TB/game_low_noaudio_phase_split.txt 2>&1
node anagame.mjs FGLna new,new2 c024,c0242 b48 > $TB/game_low_noaudio_vs_c024.txt 2>&1
node anagame.mjs FGLnb2 new,new2 b48,b482 > $TB/game_low_noaudio_vs_be48061.txt 2>&1
node anaph.mjs FGLnb2 new,new2 b48,b482 > $TB/game_low_noaudio_vs_be48061_phase.txt 2>&1
node anagame.mjs FGH new,new2 base c024 > $TB/game_high_audio_vs_a284b80.txt 2>&1
# warm matrix
for t in WM_town_low WM_town_high WR_town_high WM_town_ultra WM_city_low WM_city_high WM_city_ultra; do
  f=$O/WM.jsonl
  node anawarm.mjs $f new,new2 base cpu $t 1 > $TB/warm_${t}_vs_a284b80.txt 2>&1
  node anawarm.mjs $f new,new2 b48 cpu $t 1 > $TB/warm_${t}_vs_be48061.txt 2>&1
  node anawarm.mjs $f new,new2 v1,v12 cpu $t 1 > $TB/warm_${t}_vs_V1.txt 2>&1
  [ -f $O/WM.$t.perframe.jsonl ] && node analong.mjs $O/WM.$t.perframe.jsonl 1 > $TB/long_${t}.txt 2>&1
done
for t in WM_ui_high WM_ui_ultra2 WM_ui_low2 WM_ui_low; do
  node anawarm.mjs $O/WMU.jsonl new,new2 base cpu $t 0 > $TB/warm_${t}_vs_a284b80.txt 2>&1
  node anawarm.mjs $O/WMU.jsonl new,new2 b48 cpu $t 0 > $TB/warm_${t}_vs_be48061.txt 2>&1
done
# ring attribution
node anawarm.mjs $O/RO.jsonl new,new2 nor,nor2 cpu RO_town_high 1 > $TB/ring_high_new_vs_ringoff.txt 2>&1
node anawarm.mjs $O/RO.jsonl nor,nor2 base cpu RO_town_high 1 > $TB/ring_high_ringoff_vs_a284b80.txt 2>&1
node anawarm.mjs $O/RO.jsonl new,new2 nor cpu RO_town_ultra 1 > $TB/ring_ultra_new_vs_ringoff.txt 2>&1
node anawarm.mjs $O/RO.jsonl v1 v1nor cpu RO_town_ultra 1 > $TB/ring_ultra_V1_vs_ringoff.txt 2>&1
node anawarm.mjs $O/RO.jsonl new,new2 v1 cpu RO_town_ultra 1 > $TB/ring_ultra_new_vs_V1.txt 2>&1
# counts, allocations, GPU stand-in
for t in WC_town_low WC_city_low WC_town_high WC_town_ultra WC_city_high; do node anawc.mjs $t > $TB/counts_${t}_vs_c024.txt 2>&1; done
node anawc.mjs WCv_city_low v1 c024 > $TB/counts_WCv_city_low_V1_vs_c024.txt 2>&1
node anawc.mjs WCv_city_low new v1 > $TB/counts_WCv_city_low_new_vs_V1.txt 2>&1
node anagpu.mjs $O/GT.jsonl new,new2 c024,c0242 min > $TB/gpu_GT_low_min_not_measurable.txt 2>&1
node anagpu.mjs $O/GT.jsonl new,new2 c024,c0242 med > $TB/gpu_GT_low_med_not_measurable.txt 2>&1
ls -la $TB | wc -l
