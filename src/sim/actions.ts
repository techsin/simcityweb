/**
 * CityActions — every player command that mutates the city goes through here (UI tools call these).
 * Every method supports `preview = true` which validates + computes cost WITHOUT mutating state
 * (used for live tool previews / tooltips). Methods emit the matching Simulation events when applied.
 *
 * Headless-safe: no DOM / three.js.
 *
 * NOTE: signatures are the contract with the UI; implementation is owned by the sim-core agent.
 */
import type { CellRect } from '../core/events';
import type { DevType, Network, Zone } from '../core/types';
import type { ServiceKind } from './catalogTypes';
import type { Simulation } from './Simulation';

export interface ActionResult {
  ok: boolean;
  /** total cost (negative = refund) */
  cost: number;
  /** human readable reason when !ok (or warnings when ok) */
  reason?: string;
  /** number of cells / items affected */
  affected?: number;
  /** cells that would be affected (for preview highlighting) */
  cells?: { x: number; z: number; ok: boolean }[];
}

export interface Cell {
  x: number;
  z: number;
}

export type TerraformKind = 'raise' | 'lower' | 'level' | 'smooth';

export interface CityActionsApi {
  zone(rect: CellRect, zone: Zone, preview?: boolean): ActionResult;
  dezone(rect: CellRect, preview?: boolean): ActionResult;
  /** path = ordered list of 4-connected cells */
  buildNetwork(path: Cell[], type: Network, preview?: boolean): ActionResult;
  buildPowerLine(path: Cell[], preview?: boolean): ActionResult;
  buildSubway(path: Cell[], preview?: boolean): ActionResult;
  /** removes buildings, networks, power lines, trees in rect (zones stay unless dezone) */
  bulldoze(rect: CellRect, preview?: boolean): ActionResult;
  /** place a ploppable BuildingDef with its min corner at (x,z) and rotation rot */
  plop(defId: string, x: number, z: number, rot: 0 | 1 | 2 | 3, preview?: boolean): ActionResult;
  terraform(kind: TerraformKind, cx: number, cz: number, radius: number, strength: number, preview?: boolean): ActionResult;
  plantTrees(rect: CellRect, preview?: boolean): ActionResult;
  setTax(dev: DevType, ratePercent: number): void;
  setFunding(service: ServiceKind, percent: number): void;
  setOrdinance(id: string, enabled: boolean): ActionResult;
  takeLoan(amount: number): ActionResult;
  repayLoan(index: number): ActionResult;
  toggleHistoric(buildingId: number): void;
}

/** Straight or L-shaped 4-connected path from a to b (horizontal first when `xFirst`). */
export function lPath(a: Cell, b: Cell, xFirst = true): Cell[] {
  const out: Cell[] = [];
  let x = a.x, z = a.z;
  out.push({ x, z });
  const stepX = () => { while (x !== b.x) { x += Math.sign(b.x - x); out.push({ x, z }); } };
  const stepZ = () => { while (z !== b.z) { z += Math.sign(b.z - z); out.push({ x, z }); } };
  if (xFirst) { stepX(); stepZ(); } else { stepZ(); stepX(); }
  return out;
}

/** Normalize a rect from two corner cells (inclusive) into CellRect (exclusive max). */
export function rectFrom(a: Cell, b: Cell): CellRect {
  return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x) + 1, z1: Math.max(a.z, b.z) + 1 };
}

export type { Simulation };
