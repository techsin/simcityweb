/**
 * Building catalog: every growable + ploppable BuildingDef with balanced stats.
 * OWNED BY the sim-core agent. (Stub until filled.)
 */
import type { BuildingDef } from './catalogTypes';

export const CATALOG: BuildingDef[] = [];

const byId = new Map<string, BuildingDef>();
export function rebuildCatalogIndex(): void {
  byId.clear();
  for (const d of CATALOG) byId.set(d.id, d);
}
rebuildCatalogIndex();

export function getDef(id: string): BuildingDef | undefined {
  return byId.get(id);
}
