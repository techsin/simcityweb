// Grow a town with the side's SimBot and write a region file (.metropolis) holding it.
// usage (from the side dir): npx tsx bench/maketown.ts <years> <out.metropolis> [size] [seed]
import { writeFileSync } from 'node:fs';
import { SimBot, botSystems } from '../tools/simbot';
import { createRegionData } from '../src/region/RegionModel';
import { summarizeCity } from '../src/region/citySummary';
import { serializeCity, packFile, REGION_FILE_KIND, REGION_FILE_VERSION } from '../src/save/index';

const years = +(process.argv[2] ?? 8);
const out = process.argv[3] ?? 'town.metropolis';
const size = +(process.argv[4] ?? 128);
const seed = +(process.argv[5] ?? 7);
const bot = new SimBot({ size, years, seed, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: true, noInfra: false } as any, await botSystems(false));
const t0 = performance.now();
bot.run(years);
const st = bot.st;
console.log(`grown ${years}y in ${((performance.now() - t0) / 1000).toFixed(1)} s: buildings ${st.buildings.size} pop ${st.stats.population} day ${st.day}`);
const setDay = process.env.TOWN_DAY ? +process.env.TOWN_DAY : -1;
if (setDay >= 0) { (st as any).day = setDay; console.log('day set to', setDay, 'month', Math.floor(setDay / 30) % 12); }
const { data } = createRegionData({ seed: 7, preset: 'greenvale', id: 'bench', name: 'Bench Plains' });
const tsz = size === 64 ? 1 : size === 128 ? 2 : 4;
const tile = data.tiles.find((t: any) => t.size === tsz) ?? data.tiles[0];
(st.config as any).regionId = data.id;
(st.config as any).name = 'Plainsville';
tile.city = summarizeCity(st) as any;
const file = { kind: REGION_FILE_KIND, version: REGION_FILE_VERSION, exportedAt: Date.now(), region: data, cities: { [tile.key]: serializeCity(st) } };
const bytes = await packFile(file, true);
writeFileSync(out, bytes);
console.log(`wrote ${out}: ${bytes.length} bytes, region ${data.id}, tile ${tile.key} (size ${tile.size})`);
