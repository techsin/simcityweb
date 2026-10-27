#!/bin/bash
# restart the vite servers (they do not watch files: restart after changing bench files)
T=$(cd $(dirname "$0") && pwd)
R=$T/..
[ -f $R/servers.pid ] && kill $(cat $R/servers.pid) 2>/dev/null
sleep 2
rm -f $R/logs/servers.log
cd $T && setsid nohup node servers.mjs ${@:-new base c024 v1 n} > $R/logs/servers.log 2>&1 < /dev/null &
for i in $(seq 1 40); do grep -q "up {" $R/logs/servers.log 2>/dev/null && break; sleep 1; done
cat $R/logs/servers.log
