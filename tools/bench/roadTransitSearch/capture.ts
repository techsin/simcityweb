/**
 * Capture every search.ts call of `--cycles` traffic cycles (runCycleSync) on a fixture, for replay.
 * Bundled with plugins.mjs in 'capture' mode (the original search.ts, plus a recorder).
 *   args: --fixture dense1m|stress1m|stress256|FILE [--fixtures DIR] [--cycles 2] --out FILE
 */
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { encodeCapture, callLabel, type CapCall, type Capture } from './captureFormat';
import { fixtureDir, loadCity } from './fixtures';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const spec = opt('--fixture', 'dense1m')!;
const cycles = Number(opt('--cycles', '2'));
const out = opt('--out')!;
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

const { st, label } = await loadCity(spec, fixtureDir(args));
let t0 = cpu();
const sim = new Simulation(st, createSystems());
console.log(`# ${label}: pop ${st.stats.population}, buildings ${st.buildings.size}, sim init ${(cpu() - t0).toFixed(0)} ms cpu, load ${loadavg().map((v) => v.toFixed(1)).join(' ')}`);
const tr = sim.getSystem('traffic') as unknown as { runCycleSync(s: Simulation): void; road: { n: number } };
const cap = (globalThis as unknown as { __searchCapture: { on: boolean; calls: CapCall[]; graphs: Map<string, unknown> } }).__searchCapture;
if (!cap) throw new Error('capture plugin not active');
const bounds: number[] = [];
for (let c = 0; c < cycles; c++) {
  bounds.push(cap.calls.length);
  cap.on = true;
  t0 = cpu();
  tr.runCycleSync(sim);
  cap.on = false;
  const calls = cap.calls.slice(bounds[c]);
  const kinds = new Map<string, number>();
  for (const x of calls) kinds.set(callLabel(x), (kinds.get(callLabel(x)) ?? 0) + 1);
  console.log(`# cycle ${c}: ${(cpu() - t0).toFixed(0)} ms cpu (incl. recording), ${calls.length} calls: ${[...kinds].map(([k, v]) => `${k} x${v}`).join(', ')}`);
}
const capture: Capture = {
  meta: { fixture: label, pop: st.stats.population, roadNodes: tr.road.n, cycles, cycleStarts: bounds, captured: new Date().toISOString() },
  graphs: Object.fromEntries(cap.graphs) as Capture['graphs'],
  calls: cap.calls,
};
const bytes = encodeCapture(capture);
writeFileSync(out, bytes);
console.log(`# wrote ${out}: ${(bytes.length / 1e6).toFixed(1)} MB, ${capture.calls.length} calls, ${Object.keys(capture.graphs).length} graph version(s)`);
