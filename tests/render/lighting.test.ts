/**
 * Time-of-day light rig (Sky.lightRig): twilight must never be darker than the night that follows / precedes it (also
 * back-lit, fill-only views around sunrise / sunset), the street lamps come on before the night factor, the
 * lamp-type rule shared by the mesher and the road shader, and the night-window levels of detail (materials.ts: each
 * coarse level is the expected value of the finer one).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
        if (Math.abs(sy) < 0.035) expect(ground(L) * L.exposure).toBeGreaterThan(nightOut * 1.35);
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

// ---- night window lights (materials.ts nightWindows): every level of detail is the EXPECTED value of the finer level it
// replaces, so zooming out neither brightens nor dims the night city (the constants are read from the shader source)
describe('night window levels of detail', () => {
  const src = readFileSync(resolve(__dirname, '../../src/assets/materials.ts'), 'utf8');
  const v3 = (s: string) => s.split(',').map(Number) as [number, number, number];
  const ramp = /vec3 roomLight\(float t\) \{\s*return mix\(mix\(vec3\(([^)]*)\), vec3\(([^)]*)\), [^;]*\), vec3\(([^)]*)\)/.exec(src);
  const nw = src.slice(src.indexOf('vec3 nightWindows('), src.indexOf('// Floodlit masonry'));
  const roomLight = (t: number): number[] => {
    const [a, w, c] = [v3(ramp![1]), v3(ramp![2]), v3(ramp![3])];
    const s1 = Math.min(Math.max(t * 2, 0), 1), s2 = Math.min(Math.max(t * 2 - 1, 0), 1);
    return a.map((x, i) => { const m = x + (w[i] - x) * s1; return m + (c[i] - m) * s2; });
  };
  const meanColour = (tOf: (h: number) => number) => {
    const acc = [0, 0, 0], n = 20000;
    for (let i = 0; i < n; i++) roomLight(tOf((i + 0.5) / n)).forEach((x, k) => (acc[k] += x / n));
    return acc;
  };

  it('uses the mean light colour of homes / shops / offices / hotels for the coarse levels', () => {
    expect(ramp).not.toBeNull();
    const cAvg = /vec3 cAvg = home > 0\.5 \? \(shop > 0\.5 \? vec3\(([^)]*)\) : vec3\(([^)]*)\)\) :\s*\(hotel > 0\.5 \? vec3\(([^)]*)\) : vec3\(([^)]*)\)\);/.exec(nw);
    expect(cAvg).not.toBeNull();
    const [shops, homes, hotels, offices] = [v3(cAvg![1]), v3(cAvg![2]), v3(cAvg![3]), v3(cAvg![4])];
    const want: [number[], (h: number) => number][] = [
      [homes, (h) => h * h], [shops, (h) => 0.1 + 0.4 * h], [offices, (h) => h], [hotels, (h) => h * 0.6],
    ];
    expect(nw).toContain('mix(hc * hc, 0.1 + 0.4 * hc, shop) : hc * mix(1.0, 0.6, hotel)');
    for (const [got, tOf] of want) meanColour(tOf).forEach((x, k) => expect(got[k]).toBeCloseTo(x, 2));
  });

  it('keeps the ceiling-light gradient mean and the mean window brightness in the coarse levels', () => {
    const g = /float ceilG = ([\d.]+) \+ ([\d.]+) \* clamp\(fy \* ([\d.]+) - ([\d.]+), 0\.0, 1\.0\);/.exec(nw);
    expect(g).not.toBeNull();
    const [b, k, s, o] = g!.slice(1).map(Number);
    let mean = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) mean += (b + k * Math.min(Math.max(((i + 0.5) / n) * s - o, 0), 1)) / n;
    expect(nw).toContain(`mix(${mean.toFixed(3)}, ceilG, fF) * 0.825`);
    // window brightness winB = 0.825 + spread * (u - 0.5): mean 0.825; the facade level 0.825 x the gradient mean
    expect(nw).toMatch(/float winB = 0\.825 \+/);
    expect(nw).toContain(`* ${(0.825 * mean).toFixed(3)};`);
  });

  it('weights the facade level by the mean floor occupancy', () => {
    // (the class value hO is a golden-ratio sequence over the floors: uniform shares, so the thresholds are the shares)
    expect(nw).toMatch(/float hO = fract\(ci\.y \* 0\.618034 \+ /);
    const occ = /hO < mix\(([\d.]+), ([\d.]+), hotel\) \? ([\d.]+) : \(hO < ([\d.]+) \? ([\d.]+) : mix\(([\d.]+), ([\d.]+), hotel\)\)/.exec(nw);
    const occM = /float occM = mix\(mix\(([\d.]+), ([\d.]+), hotel\), 1\.0, home\);/.exec(nw);
    expect(occ).not.toBeNull();
    expect(occM).not.toBeNull();
    const [dO, dH, lo, mid, midV, fullO, fullH] = occ!.slice(1).map(Number);
    const m = (dark: number, full: number) => dark * lo + (mid - dark) * midV + (1 - mid) * full;
    expect(Number(occM![1])).toBeCloseTo(m(dO, fullO), 2);
    expect(Number(occM![2])).toBeCloseTo(m(dH, fullH), 2);
  });
});
