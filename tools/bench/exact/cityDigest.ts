// @ts-nocheck — dev tool, bundled with rolldown (not type-checked by design; keeps `tsc --noEmit` independent of it)
/**
 * J-fix city-level exactness gate (docs/WASM_PLAN.md §7.6 D1): run a fixture for --days at design cadence
 * (advanceDay + scheduler flush) and print the sha256 of serializeCity({copy: true}) plus one digest per top-level
 * serialized key (layers, buildings, stats, systemData, ...). Bundle and run it in the pre-fix tree and in the fix's tree
 * and compare the output: every digest must be equal.
 *
 *   node tools/bench/sim-profile/bundle.mjs ../exact/cityDigest
 *   node node_modules/.cache/sim-profile/cityDigest.js --fixture F.metropolis [--days 120] [--mode design|headless]
 * Fixtures load with zlib + decodeBundle (never unpackFile).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { decodeBundle } from '../../../src/save/bundle';
import { deserializeCity, serializeCity } from '../../../src/save/serialize';
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { schedulerOf } from '../../../src/sim/infra/scheduler';

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const fixture = arg('fixture'), days = +arg('days', '120'), mode = arg('mode', 'design');
const sim = new Simulation(deserializeCity(decodeBundle(new Uint8Array(gunzipSync(readFileSync(fixture))))), createSystems());
const sch = schedulerOf(sim);
for (let d = 0; d < days; d++) { sim.advanceDay(); if (mode === 'design') sch.flush(sim); }
const feed = (h, v) => {
  if (ArrayBuffer.isView(v)) h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  else if (Array.isArray(v)) { h.update('['); for (const x of v) feed(h, x); h.update(']'); }
  else if (v && typeof v === 'object') for (const k of Object.keys(v).sort()) { if (k === 'savedAt') continue; h.update(k); feed(h, v[k]); }
  else h.update(String(v));
};
const ser = serializeCity(sim.state, { copy: true });
const all = createHash('sha256'); feed(all, ser);
const parts = {};
for (const k of Object.keys(ser).sort()) { if (k === 'savedAt') continue; const h = createHash('sha256'); feed(h, ser[k]); parts[k] = h.digest('hex').slice(0, 16); }
console.log(JSON.stringify({ fixture, days, mode, day: sim.state.day, population: sim.state.stats.population, sha256: all.digest('hex'), parts }, null, 1));
