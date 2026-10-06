/**
 * Time-of-day light rig (Sky.lightRig): twilight must never be darker than the night that follows / precedes it (also
 * back-lit, fill-only views around sunrise / sunset), the street lamps come on before the night factor, and the
 * lamp-type rule shared by the mesher and the road shader.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LIGHT_RIG, SkySystem, lightRig, type SkyLighting } from '../../src/render/world/Sky';
import { atmTransmittanceJS } from '../../src/render/world/atmosphere';
import { lampTint } from '../../src/render/city/roads/roadMaterial';
import { Network, Zone } from '../../src/core/types';

const lum = (c: THREE.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

function rig(hour: number, day: number, cityLights = 1): SkyLighting {
  const L: SkyLighting = {
    sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), lightDir: new THREE.Vector3(), lightColor: new THREE.Color(),
    lightIntensity: 0, night: 0, golden: 0, envIntensity: 1, exposure: 1, fill: 0, fillColor: new THREE.Color(), lamps: 0, dusk: 0,
  };
  SkySystem.sunDirection(hour, day, L.sunDir);
  SkySystem.moonDirection(hour, day, L.moonDir);
  const sunT = new THREE.Color();
  atmTransmittanceJS(L.sunDir, 0.35, 1.3, sunT);
  lightRig(L.sunDir, L.moonDir, sunT, L, cityLights);
  return L;
}

/** luminance of the irradiance on flat, unshadowed ground: direct light + hemisphere sky fill */
function ground(L: SkyLighting): number {
  return L.lightIntensity * Math.max(L.lightDir.y, 0) * lum(L.lightColor) + L.fill * lum(L.fillColor);
}

describe('light rig', () => {
  it('twilight (sunset -> moon handover, moonless dawn) is never darker than the night floor', () => {
    for (let day = 0; day < 360; day += 30) {
      for (let m = 0; m < 24 * 60; m += 10) {
        const L = rig(m / 60, day);
        if (L.night < 0.999) continue;
        // full night: the ground never drops below the configured floor (the dip at the handover used to fall to ~40%)
        expect(ground(L)).toBeGreaterThanOrEqual(LIGHT_RIG.nightGround * 0.99);
      }
    }
  }, 120000);

  it('keeps the direct light continuous where it switches from the twilight sky light to the moon', () => {
    for (let day = 0; day < 360; day += 60) {
      let prev: SkyLighting | null = null;
      for (let m = 16 * 60; m < 23 * 60; m += 2) {
        const L = rig(m / 60, day);
        if (prev && (L.sunDir.y > LIGHT_RIG.switchY) !== (prev.sunDir.y > LIGHT_RIG.switchY)) {
          // the light jumps direction here: both sides must be (nearly) dark so the jump is invisible
          expect(L.lightIntensity).toBeLessThan(0.02);
          expect(prev.lightIntensity).toBeLessThan(0.02);
        }
        prev = L;
      }
    }
  }, 120000);

  it('switches the street lamps on before the night factor rises, and fully on shortly after sunset', () => {
    for (let day = 0; day < 360; day += 60) {
      for (let m = 0; m < 24 * 60; m += 10) {
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
  }, 120000);

  it('leaves the plain 22:00 night alone when the moon is up', () => {
    const L = rig(22, 12);
    expect(L.fill).toBeCloseTo(LIGHT_RIG.fillBase, 5);
    expect(L.lightIntensity).toBeCloseTo(LIGHT_RIG.moonI, 5);
    expect(L.exposure).toBeCloseTo(1.9, 5);
  }, 60000);

  it('makes the minutes around sunset / sunrise clearly brighter than the night, also back-lit (fill only)', () => {
    for (let day = 0; day < 360; day += 30) {
      const night = rig(1, day);
      const nightOut = ground(night) * night.exposure;
      for (let m = 0; m < 24 * 60; m += 5) {
        const L = rig(m / 60, day);
        const sy = L.sunDir.y;
        if (sy < -0.17 || sy > 0.15) continue;
        // (exposure-scaled) ground of the whole rig: never below the night; within ~2 deg of the horizon well above it
        expect(ground(L) * L.exposure).toBeGreaterThanOrEqual(nightOut * 0.99);
        if (Math.abs(sy) < 0.035) expect(ground(L) * L.exposure).toBeGreaterThan(nightOut * 1.4);
        // back-lit surfaces see only the sky fill: not darker than the night's fill-lit ground either
        expect(L.fill * lum(L.fillColor) * L.exposure).toBeGreaterThanOrEqual(LIGHT_RIG.fillBase * lum(night.fillColor) * night.exposure * 0.99);
      }
    }
  }, 120000);

  it('adapts the exposure to a dark landscape (few city lights) at dusk / night only', () => {
    const dayL = rig(13, 12, 0.3), dayB = rig(13, 12, 1);
    expect(dayL.exposure).toBeCloseTo(dayB.exposure, 6);
    const nL = rig(22, 12, 0.3), nB = rig(22, 12, 1);
    expect(nL.exposure).toBeGreaterThan(nB.exposure * 1.15);
  }, 60000);
});

describe('street lamp type', () => {
  it('is white on highways, warm sodium in most districts and white LED in a few', () => {
    let led = 0, n = 0;
    for (let z = 0; z < 256; z += 5) for (let x = 0; x < 256; x += 5) {
      expect(lampTint(x, z, Network.Highway)).toBe(1);
      const t = lampTint(x, z, Network.Road);
      expect(t === 0 || t === 1).toBe(true);
      // same district -> same type for every city road class (arterials only differ in brightness)
      expect(lampTint(x, z, Network.Street)).toBe(t);
      expect(lampTint(x, z, Network.Avenue)).toBe(t);
      expect(lampTint(x, z, Network.OneWay)).toBe(t);
      led += t; n++;
    }
    // sodium stays the majority (the warm night city), LED in roughly one district in seven
    expect(led / n).toBeGreaterThan(0.05);
    expect(led / n).toBeLessThan(0.3);
  }, 60000);

  it('never puts white LED lamps next to industry (sodium-lit yards)', () => {
    const N = 96;
    const zone = new Uint8Array(N * N);
    // an LED district (found by search) with an industrial lot two cells from the road cell
    let cx = -1, cz = -1;
    for (let z = 2; z < N - 2 && cx < 0; z++) for (let x = 2; x < N - 2; x++) if (lampTint(x, z, Network.Road) === 1) { cx = x; cz = z; break; }
    expect(cx).toBeGreaterThanOrEqual(0);
    expect(lampTint(cx, cz, Network.Road, zone, N)).toBe(1);
    for (const zt of [Zone.IndAg, Zone.IndMed, Zone.IndHigh, Zone.Landfill]) {
      zone[(cz + 2) * N + cx] = zt;
      expect(lampTint(cx, cz, Network.Road, zone, N)).toBe(0);
    }
    // residential / commercial neighbours keep the district's LEDs; highways stay white
    zone[(cz + 2) * N + cx] = Zone.ComHigh;
    zone[cz * N + cx + 1] = Zone.ResMed;
    expect(lampTint(cx, cz, Network.Road, zone, N)).toBe(1);
    zone[(cz + 1) * N + cx] = Zone.IndMed;
    expect(lampTint(cx, cz, Network.Highway, zone, N)).toBe(1);
  }, 60000);
});
