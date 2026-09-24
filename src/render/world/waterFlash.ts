/**
 * Burst flashes that light the water (New Year fireworks): a tiny shared uniform block, written every frame by
 * render/city/effects/Fireworks.ts and read by the WaterRenderer shader, which turns each one into a coloured
 * shimmer on the ripples below the burst (a glitter path toward the viewer). It does not depend on where the mirror
 * image of the burst lands, so the water reacts to the show from any camera. Colour (0, 0, 0) = slot unused.
 */
import * as THREE from 'three';

export const WATER_FLASHES = 4;

export const waterFlashUniforms = {
  /** xyz burst position (world), w burst radius (m) */
  uFlashPos: { value: Array.from({ length: WATER_FLASHES }, () => new THREE.Vector4(0, -1e4, 0, 1)) },
  /** linear colour * strength (0 = off) */
  uFlashCol: { value: Array.from({ length: WATER_FLASHES }, () => new THREE.Vector3()) },
};

/** switch every slot off */
export function clearWaterFlashes(): void {
  for (const c of waterFlashUniforms.uFlashCol.value) c.set(0, 0, 0);
}
