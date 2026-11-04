// @ts-nocheck — dev tool, bundled with rolldown (not type-checked by design)
/**
 * T015: the balance bot run with a services probe. Per year: services passes started, days whose end-of-day transitCov
 * sum is under 90 % of that year's max (a pass between its transit tier and its stop step), mean tourists, attractiveness.
 * File name must not contain "simbot" (tools/balance-json.ts explains why).
 *
 *   node_modules/.bin/rolldown <this> --platform node --format esm --dir <dir> && node <dir>/botPasses.js <size> <years> <seed>
 */
import { SimBot, botSystems } from '../../simbot';
import { econData } from '../../../src/sim/economy/runtime';

const [size = 128, years = 15, seed = 7] = process.argv.slice(2, 5).map(Number);
const bot = new SimBot({ size, years, seed, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: true, noInfra: false }, await botSystems(false));
const sim = bot.sim, st = sim.state;
const svc = sim.getSystem('services');
let lastRun = svc.lastRun;
let y = { passes: 0, sums: [], tourists: [] };
const out = [];
sim.events.on('day', () => {
  if (svc.lastRun !== lastRun) { y.passes++; lastRun = svc.lastRun; }
  let s = 0; const T = st.transitCov; for (let i = 0; i < T.length; i++) s += T[i];
  y.sums.push(s);
});
sim.events.on('month', () => y.tourists.push(econData(st).tourists ?? 0));
bot.run(years, (r) => {
  const mx = Math.max(...y.sums);
  out.push({ year: r.year, pop: Math.round(r.pop), passes: y.passes, dipDays: y.sums.filter((s) => s < 0.9 * mx).length,
    meanTransit: Math.round(y.sums.reduce((a, b) => a + b, 0) / Math.max(1, y.sums.length)),
    tourists: Math.round(y.tourists.reduce((a, b) => a + b, 0) / Math.max(1, y.tourists.length)) });
  console.log(JSON.stringify(out[out.length - 1]));
  y = { passes: 0, sums: [], tourists: [] };
});
