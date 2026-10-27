// @ts-nocheck — dev tool, bundled with rolldown (not type-checked by design; keeps `tsc --noEmit` independent of it)
/**
 * LG-01 gate: an old save (no systemData.cityRanks) loads, continues and gets the rank key filled silently.
 *   node tools/bench/sim-profile/bundle.mjs ../exact/rankLoad
 *   node node_modules/.cache/sim-profile/rankLoad.js <fixture.metropolis> [days=5]
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeBundle } from '../../../src/save/bundle';
import { deserializeCity, serializeCity } from '../../../src/save/serialize';
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { listMilestones } from '../../../src/sim/economy/rewards';

const [file, daysArg] = process.argv.slice(2);
const st = deserializeCity(decodeBundle(new Uint8Array(gunzipSync(readFileSync(file)))));
const before = st.systemData.cityRanks;
const news0 = st.news.length;
const sim = new Simulation(st, createSystems());
for (let d = 0; d < +(daysArg ?? 5); d++) sim.advanceDay();
const ranks = sim.state.systemData.cityRanks;
const rankNews = sim.state.news.slice(news0).filter((n) => /rank|settlement|village|town|metropolis|megacity/i.test(n.text ?? ''));
const round = deserializeCity(serializeCity(sim.state, { copy: true }));
console.log(JSON.stringify({
  file, population: sim.state.stats.population, hadKeyBefore: before !== undefined, ranksAfter: ranks,
  listMilestones: listMilestones(sim.state), rankNewsPosted: rankNews.map((n) => n.text), keyAfterSaveLoad: round.systemData.cityRanks,
}, null, 1));
