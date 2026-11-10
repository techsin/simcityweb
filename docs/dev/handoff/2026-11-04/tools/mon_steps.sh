#!/bin/bash
# Emit one line per workflow journal event (agent started / result / failure) for the given run ids.
W=/root/.claude/projects/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/subagents/workflows
FILES=""
for r in "$@"; do mkdir -p "$W/$r" 2>/dev/null; touch "$W/$r/journal.jsonl" 2>/dev/null; FILES="$FILES $W/$r/journal.jsonl"; done
tail -n0 -F $FILES 2>/dev/null | python3 -u -c '
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line or line.startswith("==>"): continue
    try: e = json.loads(line)
    except Exception: continue
    t = e.get("type")
    lab = e.get("label") or (e.get("opts") or {}).get("label") or ""
    aid = e.get("agentId", "")
    if t == "started": print("STARTED", lab or aid, flush=True)
    elif t == "result":
        r = e.get("result"); s = r if isinstance(r, str) else json.dumps(r)
        print("RESULT", lab or aid[:8], s[:220].replace("\n", " "), flush=True)
    else: print("OTHER", t, json.dumps(e)[:220], flush=True)
'
