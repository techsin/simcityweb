import json, sys
SP = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t029'
def episodes(tl):
    pol = tl['policy']; emg = tl['emg']
    starts, ends, last = [], [], 0
    for t, day, live, ids, toast in pol:
        if live and not last: starts.append(t)
        if last and not live: ends.append(t)
        last = live
    gaps = [round(s - [e for e in ends if e <= s][-1], 2) for s in starts if any(e <= s for e in ends)]
    reason = {}
    for t, day, typ, iid, kind, major, mp, r in emg:
        if typ == 'uncovered': reason.setdefault(iid, set()).add(r)
    busy = 0
    for s in starts:
        snap = [x for x in pol if x[0] == s and x[2] == 1]
        ids = [int(i) for i in (snap[0][3].split(',') if snap and snap[0][3] else [])]
        if any(reason.get(i) == {'busy'} for i in ids): busy += 1
    return {'episodes': len(starts), 'minGapEndToStartS': min(gaps) if gaps else None, 'gapsUnder30s': sum(1 for g in gaps if g < 30), 'episodeStartsWithABusyOnlyAlert': busy}
out = {}
for kind, d, pre in [('browser', 'browser', ''), ('virtualClock', 'vc', 'v-')]:
    for side in ['before', 'after']:
        for fx in ['bot256', 'dense1m']:
            j = json.load(open(f'{SP}/{d}/{pre}{side}-{fx}.json'))
            s = j['summary']
            keep = {k: s[k] for k in s if k not in ('drops', 'player', 'toasts', 'shots', 'errors', 'city', 'root', 'region', 'fixture', 'label')}
            keep['errors'] = len(s.get('errors', []))
            keep.update(episodes(j['timeline']))
            out.setdefault(kind, {})[f'{side}-{fx}'] = keep
json.dump(out, open(sys.argv[1], 'w'), indent=1)
for k, v in out.items():
    for n, r in v.items(): print(k, n, {x: r.get(x) for x in ['days', 'daysPerS', 'fps', 'slowdowns', 'toLive', 'toPause', 'episodes', 'minGapEndToStartS', 'gapsUnder30s', 'bannersRaised', 'ultraShare', 'uncoveredIncidents', 'byReason', 'busyOnlyBannered', 'episodeStartsWithABusyOnlyAlert', 'errors']})
