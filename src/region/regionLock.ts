/** Region storage ownership follows the player between the region and its cities. */
import type { CityConfigData } from '../sim/config';
import { deleteRegion, loadRegion } from '../save';
import { regionSaveAccess, requestPersistentStorage } from '../save/db';
import { RegionStorageSession, reopenStoredRegion, type StorageCity } from '../ui/StorageDialog';
import { openNewCityDialog } from './NewCityDialog';
import type { RegionModel } from './RegionModel';
import type { RegionData, RegionTile } from './types';

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
    });
    this.session = current;
    await current.acquire();
    return regionSaveAccess(data.id);
  }

  async open(data: RegionData): Promise<RegionData> {
    await this.hold(data);
    return await loadRegion(data.id) ?? data;
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

  async foundDialog(model: RegionModel, tile: RegionTile): Promise<CityConfigData | null> {
    if (this.context().region !== model || !regionSaveAccess(model.data.id)) return null;
    const choice = await openNewCityDialog({ region: model, tile, onFound: () => { void requestPersistentStorage(); } });
    return this.context().region === model && regionSaveAccess(model.data.id) ? choice : null;
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
  }
}
