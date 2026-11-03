// Bundled with the installed rolldown into this run's directory, never executed as raw Node.
// Reuse the game's migration/serialization and tools/bench's city-to-region convention.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unpackFile, packFile } from '../../src/save/bundle.ts';
import { deserializeCity, serializeCity } from '../../src/save/serialize.ts';
import { regionFileFor } from '../citySaves.ts';
import { CATALOG } from '../../src/sim/catalog.ts';
import { CELL_SIZE } from '../../src/core/constants.ts';

export const catalog = Object.fromEntries(CATALOG.map(d => [d.id, { id: d.id, name: d.name, category: d.category, footprint: d.footprint }]));
export const cellSize = CELL_SIZE;

export async function prepareFixture(input, output) {
  const bytes = readFileSync(input);
  const raw = await unpackFile(new Uint8Array(bytes));
  let file;
  if (raw?.kind === 'metropolis-region-file') {
    if (raw.version !== 1 || Object.keys(raw.cities ?? {}).length !== 1) throw new Error('Expected a version-1, one-city region fixture');
    file = raw;
    for (const key of Object.keys(file.cities)) file.cities[key] = serializeCity(deserializeCity(file.cities[key]));
  } else {
    const state = deserializeCity(raw);
    file = regionFileFor(state, serializeCity(state), { name: 'T019 dense1m', id: 'soak-dense1m' });
  }
  const [tileKey, serialized] = Object.entries(file.cities)[0];
  const state = deserializeCity(serialized);
  const population = state.stats.population || [...state.buildings.values()].reduce((n, b) => n + b.pop, 0);
  if (population < 900_000) throw new Error(`Large fixture has only ${population} residents; expected dense1m or vet_s7_y43`);
  if (!file.region.tiles.some(t => t.key === tileKey && t.city)) throw new Error('Fixture has no matching founded region tile');
  writeFileSync(output, await packFile(file));
  return { input, output, sha256: createHash('sha256').update(bytes).digest('hex'), population, buildings: state.buildings.size, size: state.size, tileKey, regionId: file.region.id };
}
