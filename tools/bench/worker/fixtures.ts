/** Node fixtures: synchronous zlib + the pure decoder, never web body / stream helpers. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeBundle } from '../../../src/save/bundle';
import { deserializeCity, type SerializedCity } from '../../../src/save/serialize';
import type { CityState } from '../../../src/sim/CityState';

export function fixtureDirectory(): string {
  return process.env.SIM_FIXTURES ?? join(process.cwd(), 'tools', 'bench', '.fixtures', 'fixtures');
}
export function grownFixture(): string {
  return process.env.SIM_GROWN_FIXTURE ?? join(fixtureDirectory(), 'bot256_s7_y60.metropolis');
}
export function loadFixture(file: string): CityState {
  if (!existsSync(file)) throw new Error(`Missing city fixture: ${file}`);
  const raw = new Uint8Array(readFileSync(file));
  const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? new Uint8Array(gunzipSync(raw)) : raw;
  return deserializeCity(decodeBundle(bytes) as SerializedCity);
}
