#!/bin/bash
# Print a line whenever dev (claude/beautiful-johnson-u2jqoz) moves on origin: the merge agents' pushes.
cd /home/user/simcityweb || exit 1
prev=$(timeout 60 git ls-remote origin refs/heads/claude/beautiful-johnson-u2jqoz 2>/dev/null | cut -c1-7)
while true; do
  sleep 120
  cur=$(timeout 60 git ls-remote origin refs/heads/claude/beautiful-johnson-u2jqoz 2>/dev/null | cut -c1-7) || continue
  [ -n "$cur" ] && [ "$cur" != "$prev" ] && { git fetch -q origin 2>/dev/null; echo "DEV $prev..$cur: $(git log --format=%s -1 origin/claude/beautiful-johnson-u2jqoz | cut -c1-120)"; prev=$cur; }
done
