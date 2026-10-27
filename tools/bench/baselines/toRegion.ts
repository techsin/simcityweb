// @ts-nocheck — dev tool, bundled with rolldown (not type-checked by design; keeps `tsc --noEmit` independent of it)
/**
 * Wrap a bench fixture (a .metropolis city bundle) as a one-city region file the game can import, so the in-browser
 * PI-1 numbers (pi1Browser.mjs) run the same city as the node ones.
 *
 *   node tools/bench/sim-profile/bundle.mjs ../baselines/toRegion
 *   node node_modules/.cache/sim-profile/toRegion.js <fixture.metropolis> <outStem> [--testdefs]
 *     -> <outStem>.region.metropolis (+ .city.metropolis, .READY), written by tools/citySaves.ts
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeBundle } from '../../../src/save/bundle';
import { deserializeCity } from '../../../src/save/serialize';
import { registerTestDefs } from '../../../tests/infra/cityGen';
import { writeCitySaves } from '../../citySaves';

const [fixture, stem] = process.argv.slice(2);
if (process.argv.includes('--testdefs')) registerTestDefs();
const st = deserializeCity(decodeBundle(new Uint8Array(gunzipSync(readFileSync(fixture)))));
const r = writeCitySaves(st, stem, { fixture });
console.log(JSON.stringify({ stem, population: st.stats.population, buildings: st.buildings.size, region: r.region.bytes }));
