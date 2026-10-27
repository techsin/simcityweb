/**
 * Game saves of a headless city (node only; used by tools/simbot.ts --save-years). Written with the game's own save code
 * (src/save), in the two forms the game and the tools read:
 *
 *   <stem>.city.metropolis    the city alone: gzip(encodeBundle(serializeCity(st))) — what packFile(serializeCity(st))
 *                             makes. Load in node with deserializeCity(await unpackFile(bytes)), as the benchmark and
 *                             test fixtures are loaded (tools/bench/roadTransitSearch/fixtures.ts).
 *   <stem>.region.metropolis  a one-city region file: gzip(encodeBundle(RegionFile)) — what the game's Export region
 *                             writes (src/save/index.ts buildRegionFile / exportRegion): a seeded region (RegionModel
 *                             createRegionData) whose tile of the city's size holds the city (its summary on the tile, the
 *                             SerializedCity under the tile key). In the game: Load Region → Import → select the city →
 *                             Play (importRegion stores the region and its city in IndexedDB).
 *   <stem>.READY              written last, once both files are complete: a small JSON summary (year, population, file
 *                             sizes and sha256). Other processes wait for this marker, never for the .metropolis files.
 *
 * Every write is synchronous (node:zlib gzip, the stream format CompressionStream('gzip') writes and unpackFile reads) and
 * atomic (temp file + rename), so a caller inside a simulation loop knows the files are complete when the call returns.
 * Nothing here writes to the city: serializeCity / summarizeCity only read it, so a bot run that saves is the same run.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { CityState } from '../src/sim/CityState';
import { serializeCity, type SerializedCity } from '../src/save/serialize';
import { encodeBundle } from '../src/save/bundle';
import { REGION_FILE_KIND, REGION_FILE_VERSION, type RegionFile } from '../src/save/index';
import { createRegionData } from '../src/region/RegionModel';
import { summarizeCity } from '../src/region/citySummary';
import type { RegionPresetId, TileSize } from '../src/region/types';

/** gzip'd bundle of any save value (the bytes packFile(value) resolves to) */
export function packSync(value: unknown): Uint8Array {
  return gzipSync(encodeBundle(value));
}

export interface RegionWrapOptions {
  /** region name in Load Region (default: the stem, e.g. "vet_s7_y21") */
  name: string;
  /** region id (deterministic; importRegion gives a fresh one when it exists already) */
  id: string;
  /** region seed (default: the city's seed) and preset (default greenvale) */
  seed?: number;
  preset?: RegionPresetId;
}

/** a one-city region file holding `ser` (the serialized `st`) on a tile of the city's size */
export function regionFileFor(st: CityState, ser: SerializedCity, o: RegionWrapOptions): RegionFile {
  const size = ({ 64: 1, 128: 2, 256: 4 } as Record<number, TileSize>)[st.size];
  if (!size) throw new Error(`no region tile size for a ${st.size}-cell city (64, 128 or 256)`);
  // the first seed from the city's whose tile layout has a tile of that size (a region has 3-6 large tiles, usually)
  const seed0 = o.seed ?? st.config.seed;
  for (let k = 0; k < 16; k++) {
    const { data, model } = createRegionData({ seed: seed0 + k, preset: o.preset ?? 'greenvale', name: o.name, id: o.id, climate: st.config.climate });
    const tiles = data.tiles.filter((t) => t.size === size);
    if (!tiles.length) continue;
    // the driest one: the region view shows the city's skyline over land
    const tile = tiles.reduce((a, b) => (model.tileWaterFraction(b) < model.tileWaterFraction(a) ? b : a));
    tile.city = summarizeCity(st);
    model.recomputeTotals();
    const city: SerializedCity = { ...ser, config: { ...ser.config, regionId: data.id, tileX: tile.x, tileZ: tile.z } };
    return { kind: REGION_FILE_KIND, version: REGION_FILE_VERSION, exportedAt: Date.now(), region: data, cities: { [tile.key]: city } };
  }
  throw new Error(`no region seed in ${seed0}..${seed0 + 15} has a tile of size ${size}`);
}

export interface SavedFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface CitySaves {
  city: SavedFile;
  region: SavedFile;
  ready: string;
  population: number;
  buildings: number;
  /** CPU ms spent saving (serialize + bundle + gzip + write) */
  cpuMs: number;
}

/** write `<stem>.city.metropolis`, `<stem>.region.metropolis`, then `<stem>.READY` (see the file header) */
export function writeCitySaves(st: CityState, stem: string, info: Record<string, unknown> = {}): CitySaves {
  const u0 = process.cpuUsage();
  mkdirSync(dirname(stem), { recursive: true });
  const name = basename(stem);
  // one serialization for both files (no copy: it is bundled right away, before the city moves on)
  const ser = serializeCity(st);
  const put = (path: string, bytes: Uint8Array): SavedFile => {
    const tmp = `${path}.tmp${process.pid}`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const city = put(`${stem}.city.metropolis`, packSync(ser));
  const region = put(`${stem}.region.metropolis`, packSync(regionFileFor(st, ser, { name, id: `bot-${name}` })));
  let population = st.stats.population;
  if (!population) for (const b of st.buildings.values()) population += b.pop;
  const u = process.cpuUsage(u0);
  const out: CitySaves = { city, region, ready: `${stem}.READY`, population, buildings: st.buildings.size, cpuMs: (u.user + u.system) / 1000 };
  const ready = {
    name, year: st.year, day: st.day, size: st.size, seed: st.config.seed, population, buildings: out.buildings, funds: Math.round(st.funds),
    city, region, writtenAt: new Date().toISOString(), ...info,
  };
  const tmp = `${out.ready}.tmp${process.pid}`;
  writeFileSync(tmp, JSON.stringify(ready, null, 1) + '\n');
  renameSync(tmp, out.ready);
  return out;
}
