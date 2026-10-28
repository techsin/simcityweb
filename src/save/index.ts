/**
 * Save system public API (IndexedDB, no deps). Used by main.ts (region flow) and CityScene (autosave via onSave).
 *
 *   saveCity(regionId, tileKey, state)   loadCity(regionId, tileKey) -> CityState | null
 *   hasCity / deleteCity
 *   saveRegion(region)  loadRegion(id)  listRegions()  deleteRegion(id)
 *   exportRegion(regionId) -> Blob (.metropolis: gzip'd binary bundle of the region + all its cities)
 *   importRegion(fileOrBytes) -> RegionData (stored; gets a fresh id if that id already exists)
 *   recovery.ts: emergency "unsaved progress" snapshots (delta vs the last full save; written on unload)
 */
import type { RegionData } from '../region/types';
import { migrateCity, type SerializedCity } from './serialize';
import { openKV } from './db';
import { packFile, unpackFile } from './bundle';
import { cityKey, type CityRecord } from './cities';
export * from './cities';
export * from './state';

export * from './serialize';
export * from './recovery';
export { openKV, setKV, MemoryKV } from './db';
export { encodeBundle, decodeBundle, packFile, unpackFile, gzip, gunzip } from './bundle';

export const REGION_FILE_KIND = 'metropolis-region-file';
export const REGION_FILE_VERSION = 1;
export const FILE_EXTENSION = '.metropolis';

export interface RegionFile {
  kind: typeof REGION_FILE_KIND;
  version: number;
  exportedAt: number;
  region: RegionData;
  cities: Record<string, SerializedCity>;
}

// ------------------------------------------------------------------ regions
export const REGION_SAVE_VERSION = 1;
export type RegionMigration = (r: RegionData) => RegionData;
const regionMigrations = new Map<number, RegionMigration>();
export function registerRegionMigration(fromVersion: number, fn: RegionMigration): void {
  regionMigrations.set(fromVersion, fn);
}
export function migrateRegion(r: RegionData): RegionData {
  if (!r || r.format !== 'metropolis-region') throw new Error('Not a Metropolis region');
  let cur = r;
  while ((cur.version ?? 1) < REGION_SAVE_VERSION) {
    const m = regionMigrations.get(cur.version);
    if (!m) throw new Error(`No migration from region version ${cur.version}`);
    const v = cur.version;
    cur = m(cur);
    if (cur.version <= v) cur.version = v + 1;
  }
  return cur;
}

export async function saveRegion(region: RegionData): Promise<void> {
  const kv = await openKV();
  await kv.put('regions', region);
}

export async function loadRegion(id: string): Promise<RegionData | null> {
  const kv = await openKV();
  const r = await kv.get<RegionData>('regions', id);
  return r ? migrateRegion(r) : null;
}

/** all saved regions, most recently played first */
export async function listRegions(): Promise<RegionData[]> {
  const kv = await openKV();
  const all = await kv.getAll<RegionData>('regions');
  return all.map(migrateRegion).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
}

export async function deleteRegion(id: string): Promise<void> {
  const kv = await openKV();
  for (const k of await kv.keys('cities', `${id}:`, `${id}:￿`)) await kv.delete('cities', k);
  await kv.delete('regions', id);
  if (getLastRegionId() === id) setLastRegionId(null);
}

// ------------------------------------------------------------------ export / import
export async function buildRegionFile(regionId: string): Promise<RegionFile> {
  const kv = await openKV();
  const region = await loadRegion(regionId);
  if (!region) throw new Error('Region not found');
  const cities: Record<string, SerializedCity> = {};
  for (const k of await kv.keys('cities', `${regionId}:`, `${regionId}:￿`)) {
    const rec = await kv.get<CityRecord>('cities', k);
    if (rec) cities[rec.tileKey] = rec.city;
  }
  return { kind: REGION_FILE_KIND, version: REGION_FILE_VERSION, exportedAt: Date.now(), region, cities };
}

export async function exportRegion(regionId: string, compress = true): Promise<Blob> {
  const file = await buildRegionFile(regionId);
  const bytes = await packFile(file, compress);
  return new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
}

export async function readRegionFile(src: Blob | ArrayBuffer | Uint8Array): Promise<RegionFile> {
  const bytes = src instanceof Uint8Array ? src : new Uint8Array(src instanceof Blob ? await src.arrayBuffer() : src);
  const f = (await unpackFile(bytes)) as RegionFile;
  if (!f || f.kind !== REGION_FILE_KIND) throw new Error('This is not a Metropolis region file');
  if (f.version > REGION_FILE_VERSION) throw new Error('This region file was made by a newer version of Metropolis');
  return f;
}

/** Import a .metropolis file. If the region id already exists a new id is assigned (nothing is overwritten). */
export async function importRegion(src: Blob | ArrayBuffer | Uint8Array, opts: { replace?: boolean } = {}): Promise<RegionData> {
  const f = await readRegionFile(src);
  const kv = await openKV();
  const region = migrateRegion(f.region);
  const exists = !!(await kv.get('regions', region.id));
  if (exists && !opts.replace) {
    region.id = 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    region.name = `${region.name} (imported)`;
  }
  region.lastPlayed = Date.now();
  for (const [tileKey, city] of Object.entries(f.cities ?? {})) {
    const c = migrateCity(city);
    c.config = { ...c.config, regionId: region.id };
    const rec: CityRecord = { key: cityKey(region.id, tileKey), regionId: region.id, tileKey, savedAt: Date.now(), city: c };
    await kv.put('cities', rec, rec.key);
  }
  // a file made outside the game (a tool's export) may carry no overview image: draw it now, so the Load Region list
  // shows it before the region is first opened (close-out c2 polish; headless: drawn when it is opened)
  if (!region.preview && typeof document !== 'undefined') {
    try {
      const [{ RegionModel }, { regionPreviewDataUrl, regionPreviewKey }] = await Promise.all([import('../region/RegionModel'), import('../region/mapPreview')]);
      const model = new RegionModel(region);
      region.preview = regionPreviewDataUrl(model);
      region.previewKey = regionPreviewKey(model);
    } catch (e) {
      console.warn('[save] region preview', e);
    }
  }
  await kv.put('regions', region);
  return region;
}

/** trigger a browser download */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function safeFileName(name: string): string {
  return (name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'region') + FILE_EXTENSION;
}

// ------------------------------------------------------------------ small prefs (localStorage)
const LAST_KEY = 'metropolis.lastRegion';
const SESSION_KEY = 'metropolis.lastSession';

/** where the player was last: a region, and a city tile when they were inside a city (tab closed in-game) */
export interface LastSession {
  regionId: string;
  tileKey?: string;
  at: number;
}
export function getLastSession(): LastSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw) as LastSession;
    const id = localStorage.getItem(LAST_KEY);
    return id ? { regionId: id, at: 0 } : null;
  } catch {
    return null;
  }
}
export function setLastSession(s: { regionId: string; tileKey?: string } | null): void {
  try {
    if (!s) localStorage.removeItem(SESSION_KEY);
    else {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, at: Date.now() }));
      localStorage.setItem(LAST_KEY, s.regionId);
    }
  } catch {
    /* ignore */
  }
}
export function getLastRegionId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
export function setLastRegionId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(LAST_KEY, id);
      const cur = getLastSession();
      if (!cur || cur.regionId !== id || cur.tileKey) localStorage.setItem(SESSION_KEY, JSON.stringify({ regionId: id, at: Date.now() }));
    } else {
      localStorage.removeItem(LAST_KEY);
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}

/** whether saves survive a reload (false when IndexedDB is unavailable) */
export async function isPersistent(): Promise<boolean> {
  return (await openKV()).persistent;
}
