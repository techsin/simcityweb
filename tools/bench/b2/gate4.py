#!/usr/bin/env python3
"""B2 gate 4 under the lead's amendment (docs/dev/reports/local-B2-step-split.md, "Plan amendment"), from one hold's
gate4Probe.ts runs:  python3 tools/bench/b2/gate4.py <run dir>
File names in <run dir>: {side}_{kind}_{i}.json, side B (the base, e.g. the merge's first parent) and W1 (the tree under
test); kind c = dense1m from a load (--warm 0 --days 220; windows days 0-20 / 20-80 / 80-220), w = dense1m warm
(--warm 300 --days 120), q = bot256_s7_y60 warm (--warm 300 --days 120).
 - from a load: per run the all-task max step with GC-overlapping steps (a GC pause >= 1 ms inside the step) excluded;
   gate: the median over runs <= 5 ms in each window. Also the max with every step, the clean max (no GC, no run-queue
   wait >= 0.5 ms), the count p99 (gate: <= 3 in every run and window).
 - the first cold execution of each piece kind (task + stepName without #k) after the load: per run the largest first
   execution; gate: <= 8 ms in every run (every step counted; the value without GC overlap is shown too).
 - warm: the all-task max with every step (strict; gate: the median over runs <= 5, the worst run shown), the p99 (<= 3).
 - the cost error per task (median over runs of the per-run median of est / ms - 1): warm on both fixtures within
   +-0.30 (the design's gate); from a load per window (reported, not gated)."""
import json, sys, glob, bisect, statistics as st, collections
R = sys.argv[1]
TN = ['traffic', 'services', 'pollution', 'crime', 'utilities', 'emergency.response']
def pq(v, q):
    v = sorted(v); return v[min(len(v) - 1, int(q * len(v)))] if v else 0
def med(v): return st.median(v) if v else float('nan')
def rng(v, f='{:.2f}'): return (f.format(med(v)) + ' [' + f.format(min(v)) + '–' + f.format(max(v)) + ']') if v else '—'
def load(f):
    o = json.load(open(f)); gs = sorted((a, a + b) for a, b in o['gc'] if b >= 1.0); gst = [g[0] for g in gs]
    def gco(i):
        s, e = o['s'][i], o['s'][i] + o['m'][i]; k = bisect.bisect_right(gst, e) - 1; ov = 0
        while k >= 0 and gs[k][1] > s - 50:
            ov += max(0, min(e, gs[k][1]) - max(s, gs[k][0])); k -= 1
        return ov
    return o, gco
out = {}
SIDES = ['B', 'W1']
print(f'# gate 4 (amended) from {R}\n')
# ---- from a load
wins = [(0, 20), (20, 80), (80, 220)]
res = {s: collections.defaultdict(lambda: collections.defaultdict(list)) for s in SIDES}
first = {s: [] for s in SIDES}
terr = {s: collections.defaultdict(lambda: collections.defaultdict(list)) for s in SIDES}
for side in SIDES:
    for f in sorted(glob.glob(f'{R}/{side}_c_*.json')):
        o, gco = load(f); d0 = o['d'][0]; n = len(o['d'])
        g = [gco(i) for i in range(n)]
        for w in wins:
            ix = [i for i in range(n) if w[0] <= o['d'][i] - d0 < w[1]]
            ms = [o['m'][i] for i in ix]; r = res[side][w]
            r['max'].append(max(ms)); r['noGC'].append(max([o['m'][i] for i in ix if g[i] < 1] or [0]))
            r['clean'].append(max([o['m'][i] for i in ix if g[i] < 1 and o['q'][i] < 0.5] or [0]))
            r['p99'].append(pq(ms, .99)); r['gt5noGC'].append(sum(o['m'][i] > 5 and g[i] < 1 for i in ix))
            ib = max([i for i in ix if g[i] < 1], key=lambda i: o['m'][i])
            r['worstNoGC'].append(f"{o['tnames'][o['t'][ib]]}:{o['labs'][o['l'][ib]]} {o['m'][ib]:.2f} (day {o['d'][ib]-d0})")
            for ti, t in enumerate(o['tnames']):
                jx = [i for i in ix if o['t'][i] == ti and o['m'][i] > 0]
                if jx: terr[side][w][t].append(med([o['e'][i] / o['m'][i] - 1 for i in jx]))
        seen = {}
        for i in range(n):
            k = (o['tnames'][o['t'][i]], o['labs'][o['l'][i]])
            if k not in seen: seen[k] = i
        fx = sorted(seen.items(), key=lambda kv: -o['m'][kv[1]])
        top = [(f'{k[0]}:{k[1]}', o['m'][i], o['d'][i] - d0, g[i]) for k, i in fx[:5]]
        first[side].append({'max': o['m'][fx[0][1]], 'maxNoGC': max(o['m'][i] for k, i in fx if g[i] < 1), 'kinds': len(seen), 'top': top,
                            'over5': [(f'{k[0]}:{k[1]}', round(o['m'][i], 2)) for k, i in fx if o['m'][i] > 5]})
print('## dense1m from a load (--warm 0 --days 220)\n')
print('| window | side (runs) | max without GC: per run | median (gate <= 5) | max, every step | max clean | p99 per run (gate <= 3) | steps > 5 ms without GC | worst step without GC (per run) |')
print('|---|---|---|---|---|---|---|---|---|')
for w in wins:
    for side in SIDES:
        r = res[side][w]
        if not r['max']: continue
        ok = med(r['noGC']) <= 5
        print(f"| days {w[0]}–{w[1]} | {side} ({len(r['max'])}) | {' / '.join(f'{x:.2f}' for x in r['noGC'])} | **{med(r['noGC']):.2f}** {'pass' if ok else 'FAIL'} | {rng(r['max'])} | {rng(r['clean'])} | {' / '.join(f'{x:.2f}' for x in r['p99'])} {'pass' if max(r['p99']) <= 3 else 'FAIL'} | {sum(r['gt5noGC'])} | {'; '.join(r['worstNoGC'])} |")
        out[f'c_{w[0]}_{w[1]}_{side}'] = {k: v for k, v in r.items()}
print('\n**The first cold execution of each piece kind after the load** (per run: the largest first execution, gate <= 8 ms; the five largest)\n')
print('| side | run | piece kinds | largest first execution | without GC | first executions > 5 ms | the five largest (ms, day, GC overlap ms) |')
print('|---|---|---|---|---|---|---|')
for side in SIDES:
    for j, x in enumerate(first[side]):
        print(f"| {side} | {j+1} | {x['kinds']} | **{x['max']:.2f}** {'pass' if x['max'] <= 8 else 'FAIL'} | {x['maxNoGC']:.2f} | {len(x['over5'])} | {'; '.join(f'{a} {b:.2f} (d{c}, gc {e:.1f})' for a, b, c, e in x['top'])} |")
out['first'] = first
print('\nCost error from a load, per task (median of the per-run medians of est / ms - 1; reported, not gated)\n')
print('| window | side | ' + ' | '.join(TN) + ' |'); print('|---|---|' + '---|' * len(TN))
for w in wins:
    for side in SIDES:
        print(f'| days {w[0]}–{w[1]} | {side} | ' + ' | '.join(f"{med(terr[side][w][t]):+.2f}" if terr[side][w][t] else '—' for t in TN) + ' |')
# ---- warm
for K, name in (('w', 'dense1m warm (--warm 300 --days 120)'), ('q', 'bot256 warm (--warm 300 --days 120)')):
    print(f'\n## {name}\n')
    print('| side (runs) | max, every step: per run | median (gate <= 5) | max without GC | p99 per run (gate <= 3) | ' + ' | '.join(f'{t} err' for t in TN) + ' |')
    print('|---|---|---|---|---|' + '---|' * len(TN))
    for side in SIDES:
        mx, ng, p9 = [], [], []; te = collections.defaultdict(list)
        for f in sorted(glob.glob(f'{R}/{side}_{K}_*.json')):
            o, gco = load(f); n = len(o['d']); g = [gco(i) for i in range(n)]
            mx.append(max(o['m'])); ng.append(max([o['m'][i] for i in range(n) if g[i] < 1] or [0])); p9.append(pq(o['m'], .99))
            for ti, t in enumerate(o['tnames']):
                jx = [i for i in range(n) if o['t'][i] == ti and o['m'][i] > 0]
                if jx: te[t].append(med([o['e'][i] / o['m'][i] - 1 for i in jx]))
        if not mx: continue
        errs = {t: med(te[t]) for t in TN if te[t]}
        out[f'{K}_{side}'] = {'max': mx, 'noGC': ng, 'p99': p9, 'err': errs}
        print(f"| {side} ({len(mx)}) | {' / '.join(f'{x:.2f}' for x in mx)} | **{med(mx):.2f}** {'pass' if med(mx) <= 5 else 'FAIL'} (worst {max(mx):.2f}) | {rng(ng)} | {' / '.join(f'{x:.2f}' for x in p9)} {'pass' if max(p9) <= 3 else 'FAIL'} | "
              + ' | '.join((f"{errs[t]:+.2f}" + ('' if side == 'B' or abs(errs[t]) <= 0.30 else ' OUT')) if t in errs else '—' for t in TN) + ' |')
json.dump(out, open(f'{R}/gate4.json', 'w'), default=str)
