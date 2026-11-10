/** Region storage ownership follows the player between the region and its cities. */
import type { CityConfigData } from '../sim/config';
import { cityKey, deleteRegion, deserializeCity, loadRegion, type CityRecord } from '../save';
import { clearRegionSummaryStale, openKV, regionSaveAccess, regionSummaryStale, requestPersistentStorage } from '../save/db';
import { RegionStorageSession, reopenStoredRegion, type StorageCity } from '../ui/StorageDialog';
import { openNewCityDialog } from './NewCityDialog';
import type { RegionModel } from './RegionModel';
import type { SisterPlan } from './regionEffects';
import { summarizeCity } from './citySummary';
import type { RegionData, RegionTile } from './types';

/** A city write can finish after takeover without its old tab updating the region summary. Only a region marked stale
 *  (a lost lock, a takeover, a write that outlived its lock) reads its city records: each can be many MB (O6). */
export async function loadCurrentRegion(id: string): Promise<RegionData | null> {
  const stale = regionSummaryStale(id);
  // the holder clears the mark before reading, so a write landing after this read marks the region again
  if (stale && regionSaveAccess(id)) clearRegionSummaryStale(id);
  const region = await loadRegion(id);
  if (!region || !stale) return region;
  const kv = await openKV();
  for (const tile of region.tiles) {
    const record = await kv.get<CityRecord>('cities', cityKey(id, tile.key));
    if (!record || tile.city && record.savedAt <= tile.city.lastPlayed) continue;
    try { tile.city = { ...summarizeCity(deserializeCity(record.city), tile.city), lastPlayed: record.savedAt }; }
    catch { /* An unreadable city must not prevent opening the other tiles. */ }
  }
  const totals = { population: 0, cities: 0, r: 0, c: 0, i: 0 };
  for (const { city } of region.tiles) if (city) {
    totals.cities++;
    totals.population += city.population;
    totals.r += city.r;
    totals.c += city.c;
    totals.i += city.i;
  }
  region.totals = totals;
  return region;
}

interface RegionStorageContext {
  root: HTMLElement;
  region: RegionModel | null;
  city: StorageCity | null;
  saved: Promise<void>;
  clearCity(): void;
  open(data: RegionData): Promise<void>;
}

export class RegionStorage {
  private session: RegionStorageSession | null = null;
  constructor(private context: () => RegionStorageContext) {}

  async hold(data: RegionData): Promise<boolean> {
    // Reopening after takeover re-enters here before acquire() has finished; never await that same request.
    if (this.session?.region.id === data.id) { this.session.region = data; return regionSaveAccess(data.id); }
    this.dispose();
    const current = new RegionStorageSession(data, this.context().root, async () => {
      const context = this.context();
      await reopenStoredRegion(current.region.id, context.city, context);
    }, () => this.context().city);
    this.session = current;
    await current.acquire();
    return regionSaveAccess(data.id);
  }

  async open(data: RegionData): Promise<RegionData> {
    await this.hold(data);
    return await loadCurrentRegion(data.id) ?? data;
  }

  /** Fixed-id testing entry points must not delete a region already open in another tab. */
  async reset(data: RegionData): Promise<boolean> {
    if (!(await this.hold(data))) {
      const stored = await loadRegion(data.id);
      if (stored) await this.context().open(stored);
      return false;
    }
    await deleteRegion(data.id).catch(() => undefined);
    return true;
  }

  /** `sister` (LG-12): the planned founding of a sister city; the dialog shows its endowment and sets its amount */
  async foundDialog(model: RegionModel, tile: RegionTile, sister?: SisterPlan): Promise<CityConfigData | null> {
    if (this.context().region !== model || !regionSaveAccess(model.data.id)) return null;
    const choice = await openNewCityDialog({ region: model, tile, ...(sister ? { sister } : {}), onFound: () => { void requestPersistentStorage(); } });
    return this.context().region === model && regionSaveAccess(model.data.id) ? choice : null;
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
  }
}
