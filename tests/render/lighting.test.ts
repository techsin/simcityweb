/**
 * Time-of-day light rig (Sky.lightRig): twilight must never be darker than the night that follows / precedes it, the
 * street lamps come on before the night factor, and the lamp-type rule shared by the mesher and the road shader.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LIGHT_RIG, SkySystem, lightRig, type SkyLighting } from '../../src/render/world/Sky';
import { atmTransmittanceJS } from '../../src/render/world/atmosphere';
import { lampTint } from '../../src/render/city/roads/roadMaterial';

const lum = (c: THREE.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

function rig(hour: number, day: number): SkyLighting {
  const L: SkyLighting = {
    sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), lightDir: new THREE.Vector3(), lightColor: new THREE.Color(),
    lightIntensity: 0, night: 0, golden: 0, envIntensity: 1, exposure: 1, fill: 0, fillColor: new THREE.Color(), lamps: 0, dusk: 0,
  };
  SkySystem.sunDirection(hour, day, L.sunDir);
  SkySystem.moonDirection(hour, day, L.moonDir);
  const sunT = new THREE.Color();
  atmTransmittanceJS(L.sunDir, 0.35, 1.3, sunT);
  lightRig(L.sunDir, L.moonDir, sunT, L);
  return L;
}

/** luminance of the irradiance on flat, unshadowed ground: direct light + hemisphere sky fill */
function ground(L: SkyLighting): number {
  return L.lightIntensity * Math.max(L.lightDir.y, 0) * lum(L.lightColor) + L.fill * lum(L.fillColor);
}

describe('light rig', () => {
  it('twilight (sunset -> moon handover, moonless dawn) is never darker than the night floor', () => {
    for (let day = 0; day < 360; day += 15) {
      for (let m = 0; m < 24 * 60; m += 5) {
        const L = rig(m / 60, day);
        if (L.night < 0.999) continue;
        // full night: the ground never drops below the configured floor (the dip at the handover used to fall to ~40%)
        expect(ground(L)).toBeGreaterThanOrEqual(LIGHT_RIG.nightGround * 0.99);
      }
    }
  });

  it('keeps the direct light continuous where it switches from the twilight sky light to the moon', () => {
    for (let day = 0; day < 360; day += 30) {
      let prev: SkyLighting | null = null;
      for (let m = 16 * 60; m < 23 * 60; m += 1) {
        const L = rig(m / 60, day);
        if (prev && (L.sunDir.y > LIGHT_RIG.switchY) !== (prev.sunDir.y > LIGHT_RIG.switchY)) {
          // the light jumps direction here: both sides must be (nearly) dark so the jump is invisible
          expect(L.lightIntensity).toBeLessThan(0.02);
          expect(prev.lightIntensity).toBeLessThan(0.02);
        }
        prev = L;
      }
    }
  });

  it('switches the street lamps on before the night factor rises, and fully on shortly after sunset', () => {
    for (let day = 0; day < 360; day += 30) {
      for (let m = 0; m < 24 * 60; m += 5) {
        const L = rig(m / 60, day);
        expect(L.lamps).toBeGreaterThanOrEqual(L.night - 1e-6);
        if (L.sunDir.y < -0.02) expect(L.lamps).toBeCloseTo(1, 5);
        if (L.sunDir.y > 0.08) expect(L.lamps).toBe(0);
      }
      // at sunset the lamps are mostly on while the night factor is still low
      let m = 12 * 60;
      while (rig(m / 60, day).sunDir.y > 0) m++;
      const S = rig(m / 60, day);
      expect(S.lamps).toBeGreaterThan(0.8);
      expect(S.night).toBeLessThan(0.4);
    }
  });

  it('leaves the plain 22:00 night alone when the moon is up', () => {
    const L = rig(22, 12);
    expect(L.fill).toBeCloseTo(LIGHT_RIG.fillBase, 5);
    expect(L.lightIntensity).toBeCloseTo(LIGHT_RIG.moonI, 5);
  });
});

describe('street lamp type', () => {
  it('is white on highways / avenues and mixes sodium / LED districts elsewhere', () => {
    let led = 0, n = 0;
    for (let z = 0; z < 256; z += 3) for (let x = 0; x < 256; x += 3) {
      expect(lampTint(x, z, 5)).toBe(1);
      expect(lampTint(x, z, 3)).toBe(1);
      const t = lampTint(x, z, 2);
      expect(t === 0 || t === 1).toBe(true);
      // same district -> same type for every local road class
      expect(lampTint(x, z, 1)).toBe(t);
      led += t; n++;
    }
    expect(led / n).toBeGreaterThan(0.2);
    expect(led / n).toBeLessThan(0.6);
  });
});
