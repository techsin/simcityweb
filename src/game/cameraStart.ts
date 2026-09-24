/**
 * Where the camera starts (QA UX-3): new cities open on the best buildable land (largest flat, dry area near the map
 * centre / a neighbour connection) instead of the map centre (often water); saved cities restore the last view,
 * stored in state.systemData.camera on save.
 */
import { CELL_SIZE } from '../core/constants';
import type { CameraControllerApi } from '../render/contracts';
import type { CityState } from '../sim/CityState';

/** persisted camera (state.systemData.camera): world focus x / z (m), distance (m), yaw / tilt (degrees) */
export interface SavedCamera {
  x: number;
  z: number;
  distance: number;
  yaw?: number;
  tilt?: number;
}

/** cells steeper than this (m between corners) are not "flat" */
const FLAT_SLOPE = 2.5;

/**
 * Cell (x, z) at the centre of the largest flat non-water area, preferring the map centre and the nearest
 * neighbour connection. Cheap: one pass over the cells + a blocks grid.
 */
export function bestBuildableCell(st: CityState): { x: number; z: number } {
  const N = st.size;
  const B = Math.max(4, Math.round(N / 16));
  const nb = Math.ceil(N / B);
  const good = new Float32Array(nb * nb);
  const tot = new Float32Array(nb * nb);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const k = Math.floor(z / B) * nb + Math.floor(x / B);
      tot[k]++;
      if (!st.water[z * N + x] && st.cellSlope(x, z) <= FLAT_SLOPE) good[k]++;
    }
  }
  const frac = (bx: number, bz: number) => {
    if (bx < 0 || bz < 0 || bx >= nb || bz >= nb) return 0;
    const k = bz * nb + bx;
    return tot[k] ? good[k] / tot[k] : 0;
  };
  const conns = st.neighborConnections ?? [];
  const half = N / 2;
  let best = { x: Math.floor(N / 2), z: Math.floor(N / 2) }, bestScore = -1e9;
  for (let bz = 0; bz < nb; bz++) {
    for (let bx = 0; bx < nb; bx++) {
      const self = frac(bx, bz);
      if (self < 0.6) continue;
      // flat share of the 5x5 block window (weighted toward the middle): "largest flat area"
      let s = 0, w = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const ww = Math.abs(dx) <= 1 && Math.abs(dz) <= 1 ? 1 : 0.5;
        s += frac(bx + dx, bz + dz) * ww;
        w += ww;
      }
      const cx = (bx + 0.5) * B, cz = (bz + 0.5) * B;
      const dCentre = Math.hypot(cx - half, cz - half) / half;
      let dConn = 0;
      if (conns.length) {
        dConn = 1e9;
        for (const c of conns) dConn = Math.min(dConn, Math.hypot(cx - c.x, cz - c.z));
        dConn /= half;
      }
      const score = s / w + 0.2 * self - 0.35 * dCentre - (conns.length ? 0.25 * dConn : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { x: Math.min(N - 1, Math.floor(cx)), z: Math.min(N - 1, Math.floor(cz)) };
      }
    }
  }
  return best;
}

type ViewControls = CameraControllerApi & {
  setView?: (x: number, z: number, distance: number, tiltDeg?: number, yawDeg?: number) => void;
  yawAngle?: number;
  tiltAngle?: number;
  tilt?: number;
  // the controller's smoothing goals (src/render/world/CameraController.ts; read when present)
  goalTarget?: { x: number; z: number };
  goalDistance?: number;
  goalYaw?: number;
  goalTilt?: number;
};

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Current view of the camera controller (null when it exposes nothing usable). Prefers the controller's goal (resting)
 * view, so a save taken mid-glide / mid-rotation restores where the camera was heading.
 */
export function readCamera(c: CameraControllerApi | undefined | null): SavedCamera | null {
  if (!c?.target) return null;
  const v = c as ViewControls;
  const g = v.goalTarget;
  const t = g && num(g.x) && num(g.z) ? g : c.target;
  const dist = num(v.goalDistance) ? v.goalDistance : c.distance;
  if (!num(t.x) || !num(t.z) || !num(dist)) return null;
  const out: SavedCamera = { x: Math.round(t.x * 10) / 10, z: Math.round(t.z * 10) / 10, distance: Math.round(dist) };
  const yaw = num(v.goalYaw) ? v.goalYaw : v.yawAngle;
  if (num(yaw)) out.yaw = Math.round((yaw * 180) / Math.PI * 100) / 100;
  // raw tilt (before the zoomed-out auto top-down blend) when available, else the effective one
  const tilt = num(v.goalTilt) ? v.goalTilt : num(v.tilt) ? v.tilt : v.tiltAngle;
  if (num(tilt)) out.tilt = Math.round((tilt * 180) / Math.PI * 100) / 100;
  return out;
}

/** a stored camera that makes sense for this map */
export function validCamera(v: unknown, st: CityState): SavedCamera | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Partial<SavedCamera>;
  const M = st.size * CELL_SIZE;
  if (typeof c.x !== 'number' || typeof c.z !== 'number' || typeof c.distance !== 'number') return null;
  if (!(c.x >= 0 && c.x <= M && c.z >= 0 && c.z <= M && c.distance > 0)) return null;
  return { x: c.x, z: c.z, distance: c.distance, yaw: typeof c.yaw === 'number' ? c.yaw : undefined, tilt: typeof c.tilt === 'number' ? c.tilt : undefined };
}

/** place the camera immediately (setView) when the controller supports it, else a smooth focusOn */
export function applyCamera(c: CameraControllerApi, cam: SavedCamera): void {
  const v = c as ViewControls;
  if (typeof v.setView === 'function') v.setView(cam.x, cam.z, cam.distance, cam.tilt, cam.yaw);
  else c.focusOn(cam.x, cam.z, cam.distance);
}
