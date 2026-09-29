#!/bin/bash
# Full profile matrix on one fixture (CPU-time based; safe on a loaded box):
#   tools/bench/sim-profile/run_matrix.sh <fixture.metropolis> <label> <startDay> [outDir=.]
# Produces <outDir>/<label>_{cycles,frames,headless,flush,framesP,headlessP,framesH,gcnvp}.json (+ .cpuprofile /
# .heapprofile / .regions.json / .steps.json). Analyse with:
#   node tools/bench/sim-profile/analyze.mjs <label>_frames.cpuprofile --regions <label>_framesP.regions.json --byregion 40 --json a.json
#   node tools/bench/sim-profile/kernels.mjs a.json --days 90
#   python3 tools/bench/sim-profile/tables.py <label>_frames.json <label>_headless.json <label>_cycles.json
#   node tools/bench/sim-profile/heapanalyze.mjs <label>_frames.heapprofile --days 60
#   python3 tools/bench/sim-profile/gcnvp.py <label>_gcnvp.log
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
F=$1; L=$2; SD=$3; O=${4:-.}
node "$ROOT/tools/bench/sim-profile/bundle.mjs" profile > /dev/null
P="node $ROOT/node_modules/.cache/sim-profile/profile.js --fixture $F"
echo "=== $L start $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)"
$P --mode cycles --reps 5 --out $O/${L}_cycles.json > $O/${L}_cycles.log 2>&1; echo "cycles done $(date +%T)"
$P --mode frames --warm 20 --days 90 --startDay $SD --out $O/${L}_frames.json > $O/${L}_frames.log 2>&1; echo "frames done $(date +%T)"
$P --mode headless --warm 20 --days 90 --startDay $SD --out $O/${L}_headless.json > $O/${L}_headless.log 2>&1; echo "headless done $(date +%T)"
$P --mode headless --flush --warm 20 --days 60 --startDay $SD --out $O/${L}_flush.json > $O/${L}_flush.log 2>&1; echo "flush (design cadence) done $(date +%T)"
$P --mode frames --warm 20 --days 90 --startDay $SD --cpuprof $O/${L}_frames.cpuprofile --interval 100 --out $O/${L}_framesP.json > $O/${L}_framesP.log 2>&1; echo "frames+cpuprof done $(date +%T)"
$P --mode frames --warm 20 --days 60 --startDay $SD --heapprof $O/${L}_frames.heapprofile --out $O/${L}_framesH.json > $O/${L}_framesH.log 2>&1; echo "heapprof done $(date +%T)"
node --trace-gc-nvp "$ROOT/node_modules/.cache/sim-profile/profile.js" --fixture $F --mode headless --warm 20 --days 60 --startDay $SD --gcmarks --out $O/${L}_gcnvp.json > $O/${L}_gcnvp.log 2>&1; echo "gc-nvp done $(date +%T)"
echo "=== $L end $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)"
