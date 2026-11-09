#!/bin/bash
# Print a line whenever a local/* branch appears or moves on origin (the local worker's reports).
cd /home/user/simcityweb || exit 1
prev=$(timeout 60 git ls-remote --heads origin 'local/*' 2>/dev/null | sort)
while true; do
  sleep 120
  cur=$(timeout 60 git ls-remote --heads origin 'local/*' 2>/dev/null | sort) || continue
  [ -z "$cur" ] && [ -n "$prev" ] && continue
  comm -13 <(echo "$prev") <(echo "$cur") | while read sha ref; do [ -n "$ref" ] && echo "LOCAL ${ref#refs/heads/} ${sha:0:7}"; done
  prev=$cur
done
