#!/bin/bash
# Desktop phase: local/* branch moves + headroom/disk/OOM-kill alarm (no cloud workflow to follow).
S=/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad
$S/mon_alarm.sh & APID=$!
trap 'kill $APID 2>/dev/null' EXIT
$S/mon_local.sh
