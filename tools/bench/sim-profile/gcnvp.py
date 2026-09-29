import re,sys,collections
# parse node --trace-gc-nvp output with DAYMARK lines (measured window only)
lines=open(sys.argv[1]).read().splitlines()
inwin=False; days=0; alloc=0; pauses=collections.defaultdict(list); promoted=0
first=None
for l in lines:
    if l.startswith('DAYMARK'):
        d=int(l.split()[1])
        if first is None: first=d; inwin=True
        days=d-first+1
        continue
    if not inwin or 'gc=' not in l: continue
    m=dict(re.findall(r'(\w[\w.]*)=([^ ]+)', l))
    kind=m.get('gc')
    alloc+=int(m.get('allocated','0')); promoted+=int(m.get('promoted','0'))
    pauses[kind].append(float(m.get('pause','0')))
print(f'days {days}: allocated {alloc/1e6:.1f} MB = {alloc/1e6/max(1,days):.2f} MB/day; promoted {promoted/1e6:.1f} MB')
for k,v in pauses.items():
    v.sort(); print(f'  gc={k}: n={len(v)} total {sum(v):.1f} ms wall, max {v[-1]:.1f}, median {v[len(v)//2]:.1f}')
