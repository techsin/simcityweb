/** Delegates every CityActionsApi call to `target`, which is swapped from the stand-in to sim-core's CityActions once loaded. */
import type { CellRect } from '../core/events';
import type { DevType, Network, Zone } from '../core/types';
import type { ActionResult, Cell, CityActionsApi, TerraformKind } from '../sim/actions';
import type { ServiceKind } from '../sim/catalogTypes';

export class ActionsProxy implements CityActionsApi {
  constructor(public target: CityActionsApi) {}
  zone(rect: CellRect, zone: Zone, preview?: boolean): ActionResult {
    return this.target.zone(rect, zone, preview);
  }
  dezone(rect: CellRect, preview?: boolean): ActionResult {
    return this.target.dezone(rect, preview);
  }
  buildNetwork(path: Cell[], type: Network, preview?: boolean): ActionResult {
    return this.target.buildNetwork(path, type, preview);
  }
  buildPowerLine(path: Cell[], preview?: boolean): ActionResult {
    return this.target.buildPowerLine(path, preview);
  }
  buildSubway(path: Cell[], preview?: boolean): ActionResult {
    return this.target.buildSubway(path, preview);
  }
  bulldoze(rect: CellRect, preview?: boolean): ActionResult {
    return this.target.bulldoze(rect, preview);
  }
  plop(defId: string, x: number, z: number, rot: 0 | 1 | 2 | 3, preview?: boolean): ActionResult {
    return this.target.plop(defId, x, z, rot, preview);
  }
  terraform(kind: TerraformKind, cx: number, cz: number, radius: number, strength: number, preview?: boolean): ActionResult {
    return this.target.terraform(kind, cx, cz, radius, strength, preview);
  }
  plantTrees(rect: CellRect, preview?: boolean): ActionResult {
    return this.target.plantTrees(rect, preview);
  }
  setTax(dev: DevType, ratePercent: number): void {
    this.target.setTax(dev, ratePercent);
  }
  setFunding(service: ServiceKind, percent: number): void {
    this.target.setFunding(service, percent);
  }
  setOrdinance(id: string, enabled: boolean): ActionResult {
    return this.target.setOrdinance(id, enabled);
  }
  takeLoan(amount: number): ActionResult {
    return this.target.takeLoan(amount);
  }
  repayLoan(index: number): ActionResult {
    return this.target.repayLoan(index);
  }
  toggleHistoric(buildingId: number): void {
    this.target.toggleHistoric(buildingId);
  }
}
