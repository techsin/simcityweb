#!/bin/bash
# Memory/disk alarm + OOM guard: harness processes get oom_score_adj 800.
# Alarms (at most once per 20 min each): headroom = MemAvailable + SwapFree below 2500 MB, disk below 3000 MB,
# and every new kernel OOM kill (counted from /proc/vmstat).
PAT='vite|vitest|tsx|headless_shell|chrome-headless|chromium|simbot|drv\.mjs|shoot|rab|probe|bench|playwright|servers\.mjs|drive\.mjs'
mark() { local p=$1; { echo 800 > /proc/$p/oom_score_adj; } 2>/dev/null; for c in $(pgrep -P $p 2>/dev/null); do mark $c; done; }
last=0; oom0=$(awk '/^oom_kill /{print $2}' /proc/vmstat)
while true; do
  for r in $(pgrep -f "$PAT" 2>/dev/null); do
    case "$(cat /proc/$r/comm 2>/dev/null)" in claude|bash|python3|tail) continue;; esac
    mark $r
  done
  head=$(awk '/^MemAvailable:/{a=$2} /^SwapFree:/{s=$2} END{print int((a+s)/1024)}' /proc/meminfo)
  disk=$(df -m / | awk 'NR==2{print $4}')
  oom=$(awk '/^oom_kill /{print $2}' /proc/vmstat)
  now=$(date +%s)
  if [ "$oom" -gt "$oom0" ]; then echo "OOM kill #$oom (headroom ${head}MB)"; oom0=$oom; fi
  if { [ "$head" -lt 2500 ] || [ "$disk" -lt 3000 ]; } && [ $((now-last)) -gt 1200 ]; then echo "ALARM headroom=${head}MB disk=${disk}MB"; last=$now; fi
  sleep 30
done
