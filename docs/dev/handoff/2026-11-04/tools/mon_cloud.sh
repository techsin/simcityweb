#!/bin/bash
S=/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad
"$S/mon_alarm.sh" & "$S/mon_dev.sh" & "$S/mon_local.sh" & wait
