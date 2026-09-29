// @ts-nocheck — dev tool, bundled with rolldown (not type-checked by design; keeps `tsc --noEmit` independent of it)
/**
 * Grow a bot city (tools/simbot.ts SimBot, full infra + economy systems) and save fixtures at chosen years.
 *   node out/botgrow/botgrow.js <years=60> <seed=7> <saveYears=20,30,40,50,60> <outDir>
 * Fixture = gzip'd .metropolis city bundle: packFile(serializeCity(st)); load with deserializeCity(await unpackFile(bytes)).
 */
import { SimBot, HEADER, formatRow } from '../../../../tools/simbot';
import { createSystems } from '../../../../src/sim/systems/index';
import { serializeCity } from '../../../../src/save/serialize';
import { packFile } from '../../../../src/save/bundle';
import { writeFileSync } from 'node:fs';

const years = +(process.argv[2] ?? 60);
const seed = +(process.argv[3] ?? 7);
const saveYears = new Set((process.argv[4] ?? '20,30,40,50,60').split(',').map(Number));
const outDir = process.argv[5] ?? '.';
const bot = new SimBot({ size: 256, years, seed, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: true, noInfra: false }, createSystems());
console.log(HEADER);
const t0 = performance.now();
let y = 0;
const pending: Promise<void>[] = [];
const rows: unknown[] = [];
bot.run(years, (r) => {
  y++;
  rows.push(r);
  console.log(formatRow(r), `wall ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  if (saveYears.has(y)) {
    const ser = serializeCity(bot.st, { copy: true });
    const file = `${outDir}/bot256_s${seed}_y${y}.metropolis`;
    pending.push(packFile(ser, true).then((bytes) => { writeFileSync(file, bytes); console.log(`saved ${file} ${(bytes.length / 1e6).toFixed(2)} MB pop ${bot.st.stats.population} buildings ${bot.st.buildings.size}`); }));
  }
});
await Promise.all(pending);
writeFileSync(`${outDir}/bot256_s${seed}_rows.json`, JSON.stringify({ rows, bySystemMsPerDay: Object.fromEntries(Object.entries(bot.bySystem).map(([k, v]) => [k, v / bot.days])) }, null, 1));
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
