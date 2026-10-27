#!/bin/bash
# install the bench files into a side: install.sh <side dir>
set -e
T=$(dirname "$0")
D=$1
mkdir -p $D/bench
cp $T/benchsrc/bench.ts $D/bench/bench.ts
cp $T/benchsrc/bench.html $D/bench.html
[ -f $T/benchsrc/seed.ts ] && cp $T/benchsrc/seed.ts $D/bench/seed.ts
[ -f $T/benchsrc/seed.html ] && cp $T/benchsrc/seed.html $D/seed.html
cp $T/benchsrc/blank.html $D/blank.html
cp $T/../data/town_y8_jun.metropolis $D/bench/town.metropolis
echo installed $D
