/**
 * Headless balance run -> JSON (yearly rows) for tests/sim/fixtures/balance-baseline.json.
 *   npx tsx tools/balance-json.ts <size> <years> <seed> <out.json>
 * Without tsx:  node_modules/.bin/rolldown tools/balance-json.ts --platform node --format esm --dir <dir> && node <dir>/balance-json.js ...
 * (the file name must not contain "simbot": importing tools/simbot.ts from a process whose argv[1] contains "simbot"
 * would also start simbot's own CLI run)
 */
import { writeFileSync } from 'node:fs';
import { SimBot, botSystems, type YearRow } from './simbot';

const [size = 256, years = 60, seed = 7] = process.argv.slice(2, 5).map(Number);
const out = process.argv[5] ?? `balance_${size}x${years}_s${seed}.json`;
const bot = new SimBot({ size, years, seed, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: true, noInfra: false }, await botSystems(false));
const t0 = performance.now();
const rows: YearRow[] = bot.run(years, (r) => console.log(r.year, Math.round(r.pop), r.approval.toFixed(1), r.totalMsPerDay.toFixed(2)));
const q = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
writeFileSync(out, JSON.stringify({
  size, years, seed, seconds: Math.round((performance.now() - t0) / 1000),
  rows: rows.map((r) => ({
    year: r.year, pop: Math.round(r.pop), funds: r.funds, approval: q(r.approval, 2), eq: q(r.eq, 2), unemployment: q(r.unemployment, 4),
    commute: q(r.commute, 3), totalMsPerDay: q(r.totalMsPerDay, 2), econMsPerDay: q(r.econMsPerDay, 3), access: q(r.access, 3),
    jobs: Math.round(r.jobs), buildings: r.buildings, income: r.income, expense: r.expense, dR: q(r.dR, 3), dC: q(r.dC, 3), dI: q(r.dI, 3), maxStage: r.maxStage,
  })),
}));
console.log(`wrote ${out}`);
