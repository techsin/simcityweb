import { it } from 'vitest';
import { stressCity, newSim } from './cityGen';
import { getTraffic } from '../../src/sim/systems/infra';
function cpu(fn: () => void): number { const a = process.cpuUsage(); fn(); const b = process.cpuUsage(a); return (b.user + b.system) / 1000; }
it('dbg', () => {
  const city = stressCity(256);
  const sim = newSim(city.st);
  const tr = getTraffic(sim)!;
  const phases: number[][] = [];
  for (let k = 0; k < 6; k++) {
    tr.invalidate();
    // run phase by phase measuring cpu
    const row: number[] = [];
    (tr as any).phase = 0;
    while ((tr as any).phase >= 0) row.push(cpu(() => (tr as any).step(sim)));
    phases.push(row);
  }
  console.log('traffic phases cpu ms (last 3 cycles):');
  for (const r of phases.slice(3)) console.log('  ' + r.map((t) => t.toFixed(1)).join(' / ') + '  total ' + r.reduce((a, b) => a + b, 0).toFixed(1));
  for (const x of sim.systems as any[]) {
    if (!x.compute) continue;
    const ts: number[] = [];
    for (let k = 0; k < 5; k++) ts.push(cpu(() => x.compute(sim, false)));
    console.log(`${x.name}: min ${Math.min(...ts).toFixed(1)} ms  all ${ts.map((t) => t.toFixed(1)).join(',')}`);
  }
  const fire = sim.getSystem<any>('fire');
  const ts: number[] = [];
  for (let k = 0; k < 5; k++) ts.push(cpu(() => fire.daily(sim)));
  console.log('fire daily', ts.map((t) => t.toFixed(2)).join(','));
  const t = cpu(() => sim.runDays(30));
  console.log('30 days cpu', t.toFixed(0), 'ms');
});
