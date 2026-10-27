/** City records and the recovery base; safe in the simulation isolate. */
import type { CityState } from '../sim/CityState';
import { deserializeCity, serializeCity, type SerializedCity } from './serialize';
import { openKV, type KV } from './db';
import { assertSavableCity, type SavableCityState } from './state';

export interface CityRecord {
  key: string;
  regionId: string;
  tileKey: string;
  savedAt: number;
  city: SerializedCity;
}

export function cityKey(regionId: string, tileKey: string): string {
  return `${regionId}:${tileKey}`;
}

// ------------------------------------------------------------------ cities
/** resolves to the record's savedAt. The serialized copy stays in memory as the base of recovery snapshots. */
export async function saveCity(regionId: string, tileKey: string, state: SavableCityState): Promise<number> {
  assertSavableCity(state);
  const kv = await openKV();
  // copy: the snapshot must not alias the live state (it is kept as the recovery base)
  const rec = createCityRecord(regionId, tileKey, state);
  await putCityRecord(kv, rec);
  return rec.savedAt;
}

export async function loadCity(regionId: string, tileKey: string): Promise<CityState | null> {
  const kv = await openKV();
  const rec = await getCityRecord(kv, regionId, tileKey);
  if (!rec) return null;
  const st = deserializeCity(rec.city);
  // deserializeCity copies every array, so the stored record can serve as the recovery base as-is
  setRecoveryBase(regionId, tileKey, rec.savedAt, rec.city);
  return st;
}

export async function loadSerializedCity(regionId: string, tileKey: string): Promise<SerializedCity | null> {
  const kv = await openKV();
  const rec = await getCityRecord(kv, regionId, tileKey);
  return rec ? rec.city : null;
}

export async function hasCity(regionId: string, tileKey: string): Promise<boolean> {
  const kv = await openKV();
  const k = cityKey(regionId, tileKey);
  return (await kv.keys('cities', k, k)).length > 0;
}

export async function deleteCity(regionId: string, tileKey: string): Promise<void> {
  const kv = await openKV();
  await kv.delete('cities', cityKey(regionId, tileKey));
}

let base: CityRecord | null = null;

/** the full save a city's snapshots are deltas of (called by saveCity / loadCity; `city` must not alias live state) */
export function setRecoveryBase(regionId: string, tileKey: string, savedAt: number, city: SerializedCity): void {
  base = { key: cityKey(regionId, tileKey), regionId, tileKey, savedAt, city };
}
export function clearRecoveryBase(): void {
  base = null;
}
export function recoveryBaseSavedAt(regionId: string, tileKey: string): number {
  return base && base.key === cityKey(regionId, tileKey) ? base.savedAt : 0;
}
export function getRecoveryBase(regionId: string, tileKey: string): CityRecord | null {
  return base?.key === cityKey(regionId, tileKey) ? base : null;
}

export function createCityRecord(regionId: string, tileKey: string, state: SavableCityState): CityRecord {
  return { key: cityKey(regionId, tileKey), regionId, tileKey, savedAt: Date.now(), city: serializeCity(state, { copy: true }) };
}

export function getCityRecord(kv: KV, regionId: string, tileKey: string): Promise<CityRecord | undefined> {
  return kv.get<CityRecord>('cities', cityKey(regionId, tileKey));
}

export async function putCityRecord(kv: KV, rec: CityRecord): Promise<void> {
  await kv.put('cities', rec, rec.key);
  setRecoveryBase(rec.regionId, rec.tileKey, rec.savedAt, rec.city);
}
