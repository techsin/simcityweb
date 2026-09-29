import json,sys,collections
r=json.load(open(sys.argv[1])); steps=json.load(open(sys.argv[1].replace('.json','.steps.json')))
f=r['frames']; top=f['top']
byf=collections.defaultdict(list)
for s in steps: byf[s['f']].append(s)
print('frames', f['n'], 'mean', f['mean'], 'p50', f['p50'], 'p95', f['p95'], 'p99', f['p99'], 'max', f['max'], '| >16.7ms', f['over16'], '>33ms', f['over33'], '>100ms', f['over100'])
print('top frames (cpu ms): [days advanced, month?, year?] advanceDay cpu | infra steps in the frame')
for t in top[:20]:
    st=byf.get(t['i'],[])
    desc=', '.join(f"{s['t']}:{s['s']} {s['c']:.1f}" for s in sorted(st,key=lambda s:-s['c'])[:4])
    print(f"  {t['c']:7.1f}  [{t['days']}d{' M' if t['mon'] else ''}{' Y' if t['yr'] else ''}] day {t['dayCpu']:6.1f} | {desc}")
# distribution of frame cpu by composition
import statistics
