/** Local copies of the tiny path / rect helpers (keeps tools independent of sim-core's module graph). */
import type { CellRect } from '../core/events';

export interface Cell {
  x: number;
  z: number;
}

/** Straight or L-shaped 4-connected path from a to b (horizontal first when `xFirst`). Same as sim/actions lPath. */
export function lPath(a: Cell, b: Cell, xFirst = true): Cell[] {
  const out: Cell[] = [];
  let x = a.x, z = a.z;
  out.push({ x, z });
  const stepX = () => {
    while (x !== b.x) {
      x += Math.sign(b.x - x);
      out.push({ x, z });
    }
  };
  const stepZ = () => {
    while (z !== b.z) {
      z += Math.sign(b.z - z);
      out.push({ x, z });
    }
  };
  if (xFirst) {
    stepX();
    stepZ();
  } else {
    stepZ();
    stepX();
  }
  return out;
}

/** Normalize a rect from two corner cells (inclusive) into CellRect (exclusive max). */
export function rectFrom(a: Cell, b: Cell): CellRect {
  return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x) + 1, z1: Math.max(a.z, b.z) + 1 };
}
