#!/usr/bin/env python3
"""Per-system / per-task tables from profile.ts results.
   python3 src/tables.py prof/dense_frames.json prof/dense_headless.json prof/dense_cycles.json
"""
import json, sys

fr = json.load(open(sys.argv[1]))
hl = json.load(open(sys.argv[2]))
cy = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None

def row(d, k):
    v = d.get(k)
    return v if v else {'perDay': 0, 'n': 0, 'mean': 0, 'p95': 0, 'max': 0}

print('== SimSystem hooks (exclusive CPU ms per simulated day; scheduler steps excluded) ==')
print(f"{'system.hook':40s} {'ultra/frames':>12s} {'headless':>9s} {'calls':>6s} {'mean ms/call':>12s} {'max ms':>8s}")
keys = sorted(set(fr['systems']) | set(hl['systems']), key=lambda k: -(row(fr['systems'], k)['perDay']))
for k in keys:
    a, b = row(fr['systems'], k), row(hl['systems'], k)
    if a['perDay'] < 0.005 and b['perDay'] < 0.005: continue
    print(f"{k:40s} {a['perDay']:12.3f} {b['perDay']:9.3f} {a['n']:6d} {a['mean']:12.2f} {a['max']:8.2f}")
print(f"{'SUM systems (exclusive)':40s} {fr['systemsExclCpuPerDay']:12.2f} {hl['systemsExclCpuPerDay']:9.2f}")
print(f"{'SUM scheduler steps':40s} {fr['schedulerCpuPerDay']:12.2f} {hl['schedulerCpuPerDay']:9.2f}")
print(f"{'TOTAL sim CPU per day':40s} {fr['cpuPerDay']:12.2f} {hl['cpuPerDay']:9.2f}")

print('\n== InfraScheduler tasks: CPU ms/day spent, step sizes, passes achieved ==')
passes = {'traffic': ('final2', 2), 'utilities': ('water', 6), 'pollution': ('flags', 12), 'services': ('finish', 15), 'crime': ('flags', 20), 'emergency.response': ('resp3', 90)}
full = {'traffic': 'traffic.cycle', 'utilities': 'utilities.fullPass', 'pollution': 'pollution.pass', 'services': 'services.pass', 'crime': 'crime.pass', 'emergency.response': 'emergency.respRefresh'}
print(f"{'task':20s} {'ms/day ultra':>12s} {'ms/day hdls':>11s} {'steps':>6s} {'mean step':>9s} {'max step':>9s} {'full pass ms':>12s} {'passes/90d ultra':>16s} {'nominal':>8s}")
for t in sorted(fr['tasks'], key=lambda k: -fr['tasks'][k]['perDay']):
    a, b = fr['tasks'][t], row(hl['tasks'], t)
    lastStep, period = passes.get(t, ('', 0))
    npass = fr['steps'].get(f'{t}:{lastStep}', {}).get('n', 0)
    if t == 'traffic': npass = fr.get('trafficCycles', npass)
    fp = cy['passes'].get(full.get(t, ''), {}).get('medianCpuMs', 0) if cy else 0
    nominal = f"{fr['days'] / period:.0f}" if period else '-'
    print(f"{t:20s} {a['perDay']:12.2f} {b['perDay']:11.2f} {a['n']:6d} {a['mean']:9.2f} {a['max']:9.2f} {fp:12.1f} {npass:16d} {nominal:>8s}")

print('\n== scheduler steps (ultra/frames) ==')
for k, v in fr['steps'].items():
    if v['cpuMs'] < 1: continue
    h = row(hl['steps'], k)
    print(f"  {k:32s} ms/day {v['perDay']:6.3f} (hdls {h['perDay']:6.3f})  n={v['n']:4d} mean {v['mean']:6.2f} max {v['max']:6.2f}")
f = fr['frames']
print('\n== frames (ultra, emulated idle machine, renderMs=%s) ==' % fr['renderMs'])
print({k: f[k] for k in ['n', 'simSeconds', 'daysPerSec', 'mean', 'p50', 'p95', 'p99', 'max', 'over16', 'over33', 'over100', 'dayPartMean', 'infraPartMean', 'infraPartP95', 'infraPartMax']})
print('noDay', f['noDay'], 'withDay', f['withDay'], 'withMonth', f['withMonth'], 'withYear', f['withYear'])
print('advanceDay (frames mode, excludes infra steps):', fr['day'])
print('headless advanceDay (incl. scheduler day budget):', hl['day'])
