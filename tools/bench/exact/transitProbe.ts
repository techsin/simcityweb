// @ts-nocheck — dev tool, bundled with rolldown (not type-checked by design)
/**
 * T015: does a services pass in progress leave transitCov without its stop coverage between days?
 * Runs a fixture headless (advanceDay only, the bot's cadence) or at design cadence (advanceDay + flush) and records,
 * at the end of each day: sum(transitCov), the services stage, and the passes started; monthly: tourists and attractiveness.
 *
 *   node tools/bench/sim-profile/bundle.mjs ../exact/transitProbe
 *   node node_modules/.cache/sim-profile/transitProbe.js --fixture F.metropolis [--days 180] [--mode headless|design]
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeBundle } from '../../../src/save/bundle';
import { deserializeCity } from '../../../src/save/serialize';
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { schedulerOf } from '../../../src/sim/infra/scheduler';
import { econData } from '../../../src/sim/economy/runtime';

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const fixture = arg('fixture'), days = +arg('days', '180'), mode = arg('mode', 'headless');
const sim = new Simulation(deserializeCity(decodeBundle(new Uint8Array(gunzipSync(readFileSync(fixture))))), createSystems());
const st = sim.state;
const svc = sim.getSystem('services');
const sums = [], stages = [], monthly = [];
let passes = 0, lastRun = svc.lastRun;
sim.events.on('month', () => { const d = econData(st); monthly.push({ day: st.day, tourists: Math.round(d.tourists ?? 0), attr: +(st.stats.attractiveness ?? 0).toFixed?.(1) }); });
for (let d = 0; d < days; d++) {
  sim.advanceDay();
  if (mode === 'design') schedulerOf(sim).flush(sim);
  if (svc.lastRun !== lastRun) { passes++; lastRun = svc.lastRun; }
  let s = 0; const T = st.transitCov; for (let i = 0; i < T.length; i++) s += T[i];
  sums.push(s);
  stages.push(svc.stepIdx < 0 ? 'idle' : `${svc.stepIdx}${svc.stepIdx === 1 ? ':' + svc.tierSlot : ''}`);
}
const mx = Math.max(...sums);
const dips = sums.map((s, i) => [i, s]).filter(([, s]) => s < 0.9 * mx);
const dipStages = {};
for (const [i] of dips) dipStages[stages[i]] = (dipStages[stages[i]] ?? 0) + 1;
console.log(JSON.stringify({
  fixture: fixture.split(/[\\/]/).pop(), mode, days, passes, maxTransitSum: Math.round(mx),
  meanTransitSum: Math.round(sums.reduce((a, b) => a + b, 0) / days), dipDays: dips.length, dipStages,
  meanTourists: Math.round(monthly.reduce((a, m) => a + m.tourists, 0) / Math.max(1, monthly.length)), monthly,
}));
