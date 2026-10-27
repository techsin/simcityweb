#!/usr/bin/env bash
# PI-1 baseline, everything in sequence (one heavy process at a time). Raw output goes to $OUT (default
# tools/bench/.fixtures/pi1, gitignored); the summary JSON is built from it by pi1Summary.mjs.
#   tools/bench/baselines/run_pi1.sh [outDir]
# Needs: npm run fixtures (tools/bench/.fixtures/fixtures/*), and the live re-grown fixtures in tools/bench/.fixtures/live/
#   node tools/bench/sim-profile/bundle.mjs fixtures/dense1m && node node_modules/.cache/sim-profile/dense1m.js tools/bench/.fixtures/live 1150000 120 7
#   node tools/bench/sim-profile/bundle.mjs fixtures/botgrow && node node_modules/.cache/sim-profile/botgrow.js 60 7 60 tools/bench/.fixtures/live
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
OUT=${1:-tools/bench/.fixtures/pi1}
mkdir -p "$OUT"
FX=tools/bench/.fixtures
SNAP_D=$FX/fixtures/dense1m_s7.metropolis
LIVE_D=$FX/live/dense1m_s7.metropolis
LIVE_B=$FX/live/bot256_s7_y60.metropolis
STRESS=$FX/fixtures/stress1m_testdefs_s7.metropolis
log() { echo "=== $(date -u +%H:%M:%S) $*" | tee -a "$OUT/run.log"; }

node tools/bench/sim-profile/bundle.mjs ../baselines/pi1Day > /dev/null
node tools/bench/sim-profile/bundle.mjs ../baselines/toRegion > /dev/null
node tools/bench/sim-profile/bundle.mjs profile > /dev/null

# 1. headline ms/day (CPU time, A/A in two isolates, 32 rounds; chunks sized for >= ~1.2 s of CPU on the Windows box)
day() { L=$1; F=$2; M=$3; K=$4; shift 4; log "day $L $M chunk $K"
  node --allow-natives-syntax node_modules/.cache/sim-profile/pi1Day.js --fixture "$F" --mode $M --chunk $K --reps 32 --warm 20 "$@" --out "$OUT/day_${L}_${M}.json" > "$OUT/day_${L}_${M}.log" 2>&1 || log "FAILED day $L $M"; }
day liveDense "$LIVE_D" design 60;  day liveDense "$LIVE_D" headless 320
day liveBot   "$LIVE_B" design 90;  day liveBot   "$LIVE_B" headless 320
day snapDense "$SNAP_D" design 60;  day snapDense "$SNAP_D" headless 320
day stress    "$STRESS" design 200 --testdefs

# 2. the profile matrix of tools/bench/sim-profile/run_matrix.sh (its node commands; threadCpuUsage shimmed to wall time)
SHIM="--import ./tools/bench/baselines/threadCpuShim.mjs"
P="node $SHIM node_modules/.cache/sim-profile/profile.js"
for spec in "liveDense:$LIVE_D" "liveBot:$LIVE_B"; do
  L=${spec%%:*}; F=${spec#*:}; O=$OUT/prof; mkdir -p $O; SD=-1
  log "matrix $L cycles";   $P --fixture $F --mode cycles --reps 5 --out $O/${L}_cycles.json > $O/${L}_cycles.log 2>&1 || log "FAILED cycles $L"
  log "matrix $L frames";   $P --fixture $F --mode frames --warm 20 --days 90 --out $O/${L}_frames.json > $O/${L}_frames.log 2>&1 || log "FAILED frames $L"
  log "matrix $L headless"; $P --fixture $F --mode headless --warm 20 --days 90 --out $O/${L}_headless.json > $O/${L}_headless.log 2>&1 || log "FAILED headless $L"
  log "matrix $L flush";    $P --fixture $F --mode headless --flush --warm 20 --days 60 --out $O/${L}_flush.json > $O/${L}_flush.log 2>&1 || log "FAILED flush $L"
  log "matrix $L cpuprof";  $P --fixture $F --mode frames --warm 20 --days 90 --cpuprof $O/${L}_frames.cpuprofile --interval 100 --out $O/${L}_framesP.json > $O/${L}_framesP.log 2>&1 || log "FAILED cpuprof $L"
  log "matrix $L heapprof"; $P --fixture $F --mode frames --warm 20 --days 60 --heapprof $O/${L}_frames.heapprofile --out $O/${L}_framesH.json > $O/${L}_framesH.log 2>&1 || log "FAILED heapprof $L"
  log "matrix $L gcnvp";    node --trace-gc-nvp $SHIM node_modules/.cache/sim-profile/profile.js --fixture $F --mode headless --warm 20 --days 60 --gcmarks --out $O/${L}_gcnvp.json > $O/${L}_gcnvp.log 2>&1 || log "FAILED gcnvp $L"
done

# 3. in-browser: the real game, headless Chromium, real GPU, ultra quality, speed 3, 90 days, 5 runs per fixture
for spec in "liveDense:$LIVE_D" "liveBot:$LIVE_B"; do
  L=${spec%%:*}; F=${spec#*:}
  node node_modules/.cache/sim-profile/toRegion.js "$F" "$FX/regions/$L" > /dev/null
  log "browser $L"
  node tools/bench/baselines/pi1Browser.mjs "$FX/regions/$L.region.metropolis" --days 90 --runs 5 --out "$OUT/browser_$L.json" > "$OUT/browser_$L.log" 2>&1 || log "FAILED browser $L"
done
log "PI1 DONE"
