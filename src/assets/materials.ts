/**
 * BuildingMaterial — one shared PBR "uber" material for every procedural model (buildings, trees, props, vehicles).
 * It reads the per-vertex `surf` attribute [type, pattern, floorHeight] (see Surf in core/types.ts) and procedurally
 * generates windows, glass curtain walls, roof tiles, bricks, crop rows, etc. At night (uniform uNight) windows light up.
 *
 * Works with Mesh, InstancedMesh and BatchedMesh (per-instance random seed is derived from the instance translation).
 *
 * Window patterns (Surf.WallWindows, surf.y):
 *   0 punched square windows (residential)       1 tall narrow windows (classic / brick)
 *   2 horizontal ribbon windows (modern office)   3 large windows w/ balcony rhythm (apartments)
 *   4 sparse small high windows (industrial)      5 dense grid (office)
 *   6 shopfront ground floor + punched above       7 arched civic windows (tall, rounded look)
 * Glass curtain tints (Surf.GlassCurtain, surf.y): 0 blue, 1 teal/green, 2 bronze/gold, 3 black/dark, 4 silver, 5 sky/light blue
 *   6 residential glass (neutral blue-grey; at night lit like homes: ~4 m apartment units, warm window colours,
 *   ~55-75% lit in the evening, no dark floors)
 *   (offices, tints 0-5, at night: floors lit in clusters, some floors dark, per-panel brightness; 2 bronze/gold warmer)
 * Emissive (Surf.Emissive, surf.y): 0 default intensity; 1..8 intensity x pattern/4 (4 = default, 2 = half, 8 = double);
 *   9 = ground light pool: paint it ~0.7x the surrounding ground color -> plain pavement by day (no tint),
 *       warm lamp-lit pavement at night.
 *   10 / 11 = NIGHT-ONLY glow x1 / x2 (no daytime emission: stained glass, lanterns, tent canopies).
 *   12 = floodlit sports surface: like 9 (paint ~0.7x, plain by day) but cool white floodlight at night.
 * WallWindows pattern 8: arched civic windows (pattern 7 mask) with EVERY window lit warm amber at night
 *   (churches, keeps, clock towers).
 * Floodlit masonry: Surf.Plain and Surf.Stone pattern 1 (warm) / 2 (cool white) glow from the base up at night;
 *   the paint's `floor` value is the reach height H in meters (light fades 70% by H). Pattern 0 = unlit.
 * Plain glass (Surf.GlassPlain, surf.y): 0 storefront / house windows (per-window lit state follows the time-of-day
 *   lit fraction, ~2.5 x 2.8 m cells); 1 vehicle glass (dark, reflective, never glows);
 *   2 pavilion glass (reflective by day, uniform warm glow ~0.6 at night: lobbies, foyers, pyramids, concourses).
 * Metal (Surf.Metal, surf.y): 0 bare metal (tanks, pipes, rails); 1 solid car paint (rough 0.40, metal 0.15);
 *   2 metallic car paint (rough 0.32, metal 0.50); 3 patina (rough 0.62, metal 0.30: copper domes, bronze statues).
 * Foliage (Surf.Foliage): wind sway above 1.5 m; per-plant hue/value + stand-scale tint from the instance position.
 *
 * Facade coordinates: planar walls use the horizontal distance along the wall; smooth-shaded CURVED walls
 * (cylinders / drums / round towers built with smooth normals) automatically switch to the arc length around the
 * model's vertical axis (exact for shapes centred on the model origin), so they get windows / mullions too.
 * Distant windows fade to their average coverage and average lit color (no shimmer). The render-world WorldView
 * drives uNight, uTime and uLitFraction (time-of-day dependent: evening peak, late-night dip).
 */
import * as THREE from 'three';

export const sharedUniforms = {
  uTime: { value: 0 },
  /** 0 = full day, 1 = full night */
  uNight: { value: 0 },
  /** 0..1 global multiplier of how many windows are lit at night */
  uLitFraction: { value: 0.55 },
  /** wind strength for foliage */
  uWind: { value: 1 },
  /** world direction TO the active light (sun / moon), set by WorldView (used for foliage translucency) */
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
  /** active light color * intensity (linear), set by WorldView */
  uSunColor: { value: new THREE.Color(3, 3, 3) },
};

const VERT_PARS = /* glsl */ `
attribute vec3 surf;
varying vec3 vSurf;
varying vec3 vObjPos;
varying vec3 vObjNormal;
varying float vSeed;
varying vec2 vInstXZ;
uniform float uTime;
uniform float uWind;
`;

const VERT_MAIN = /* glsl */ `
vSurf = surf;
vObjPos = position;
vObjNormal = normal;
vec3 instPos = modelMatrix[3].xyz;
#ifdef USE_BATCHING
  instPos += batchingMatrix[3].xyz;
#endif
#ifdef USE_INSTANCING
  instPos += instanceMatrix[3].xyz;
#endif
vSeed = fract(sin(dot(instPos.xz, vec2(12.9898, 78.233)) + instPos.y * 0.37) * 43758.5453);
vInstXZ = instPos.xz;
if (abs(surf.x - 8.0) < 0.5) {
  float hgt = max(position.y - 1.5, 0.0);
  float ph = uTime * 1.3 + instPos.x * 0.031 + instPos.z * 0.047;
  float sway = (sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.25) * 0.012 * hgt * uWind;
  transformed.x += sway;
  transformed.z += sway * 0.7;
}
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vSurf;
varying vec3 vObjPos;
varying vec3 vObjNormal;
varying float vSeed;
varying vec2 vInstXZ;
uniform float uNight;
uniform float uLitFraction;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;

float bh11(float n) { return fract(sin(n) * 43758.5453123); }
float bh21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float bh31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
float bnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bh21(i), bh21(i + vec2(1, 0)), f.x), mix(bh21(i + vec2(0, 1)), bh21(i + vec2(1, 1)), f.x), f.y);
}
// anti-aliased rectangular pulse: 1 inside [a,b] of fract(x)
float aaBox(float x, float a, float b, float w) {
  float f = fract(x);
  return smoothstep(a - w, a + w, f) * (1.0 - smoothstep(b - w, b + w, f));
}

// Window light color per window
vec3 windowLight(float h) {
  vec3 warm = vec3(1.0, 0.72, 0.38);
  vec3 neutral = vec3(1.0, 0.88, 0.66);
  vec3 cool = vec3(0.72, 0.85, 1.0);
  return h < 0.55 ? warm : (h < 0.85 ? neutral : cool);
}

// Floodlit masonry: warm (pattern 1) / cool white (pattern 2) uplight, fading over the reach height H (paint floor value)
vec3 floodlight(vec3 albedo, float pattern, float v, float H, bool vertical, float night) {
  vec3 c = pattern < 1.5 ? vec3(1.0, 0.84, 0.62) : vec3(0.86, 0.92, 1.0);
  return albedo * c * night * 0.4 * (1.0 - 0.7 * smoothstep(0.0, H, v)) * (vertical ? 1.0 : 0.35);
}

// Returns window mask (0..1) and writes cell id. u,v in meters on the facade.
float windowMask(float pattern, float u, float v, float floorH, out vec2 cell, out float fade) {
  float colW = 3.0; float wx0 = 0.2; float wx1 = 0.8; float wy0 = 0.3; float wy1 = 0.78;
  if (pattern < 0.5) { colW = 3.0; wx0 = 0.22; wx1 = 0.78; wy0 = 0.32; wy1 = 0.78; }
  else if (pattern < 1.5) { colW = 2.2; wx0 = 0.3; wx1 = 0.7; wy0 = 0.22; wy1 = 0.85; }
  else if (pattern < 2.5) { colW = 1.6; wx0 = 0.03; wx1 = 0.97; wy0 = 0.38; wy1 = 0.86; }
  else if (pattern < 3.5) { colW = 4.2; wx0 = 0.1; wx1 = 0.9; wy0 = 0.12; wy1 = 0.88; }
  else if (pattern < 4.5) { colW = 6.0; wx0 = 0.35; wx1 = 0.65; wy0 = 0.62; wy1 = 0.82; }
  else if (pattern < 5.5) { colW = 1.5; wx0 = 0.1; wx1 = 0.9; wy0 = 0.18; wy1 = 0.9; }
  else if (pattern < 6.5) { colW = 2.8; wx0 = 0.25; wx1 = 0.75; wy0 = 0.3; wy1 = 0.8; }
  else { colW = 3.2; wx0 = 0.28; wx1 = 0.72; wy0 = 0.15; wy1 = 0.9; }
  float cu = u / colW;
  float cv = v / floorH;
  cell = vec2(floor(cu), floor(cv));
  float wu = fwidth(cu) * 1.2 + 1e-4;
  float wv = fwidth(cv) * 1.2 + 1e-4;
  fade = clamp(1.0 - max(wu, wv) * 2.5, 0.0, 1.0);
  float m = aaBox(cu, wx0, wx1, wu) * aaBox(cv, wy0, wy1, wv);
  // shopfront ground floor for pattern 6
  if (pattern > 5.5 && pattern < 6.5 && v < floorH * 1.15) {
    m = aaBox(u / 5.0, 0.06, 0.94, fwidth(u / 5.0) + 1e-4) * smoothstep(0.1, 0.12, v / floorH) * (1.0 - smoothstep(0.82, 0.86, v / floorH));
  }
  // average coverage for distance fade
  float avg = (wx1 - wx0) * (wy1 - wy0);
  return mix(avg, m, fade);
}

void applySurface(inout vec3 albedo, inout float rough, inout float metal, inout vec3 emis, vec3 nObj) {
  float type = vSurf.x;
  float pattern = vSurf.y;
  float floorH = max(vSurf.z, 1.0);
  vec3 P = vObjPos;
  bool vertical = abs(nObj.y) < 0.6;
  vec2 tang = normalize(vec2(-nObj.z, nObj.x) + 1e-5);
  float u = dot(P.xz, tang);
  // curved facades (smooth-shaded drums, round towers, rotundas): the planar coordinate is ~constant around the
  // curve, so use the arc length around the model's vertical axis instead. Curvature (1/m) is estimated from
  // screen-space derivatives of the normal vs. the position; creases between flat faces fall outside the band.
  float curvK = length(fwidth(nObj.xz)) / (length(fwidth(P.xz)) + 1e-4);
  if (curvK > 0.0025 && curvK < 0.45) u = atan(nObj.z, nObj.x) * max(length(P.xz), 1.0);
  float v = P.y;
  float night = uNight;
  // contact darkening + faint vertical weathering streaks near the ground on walls (grounds the buildings)
  if (vertical && (type < 1.5 || type > 10.5)) {
    albedo *= 0.8 + 0.2 * smoothstep(0.0, 2.2, v);
    albedo *= 0.96 + 0.05 * bnoise(vec2(u * 0.9, v * 0.06 + vSeed * 13.0));
  }

  if (type < 0.5) {
    // Plain: subtle grime toward the bottom & noise
    float n = bnoise(P.xz * 0.35 + P.y * 0.2);
    albedo *= 0.93 + 0.07 * n;
    rough = 0.85;
    if (pattern > 0.5 && pattern < 2.5) emis += floodlight(albedo, pattern, v, floorH, vertical, night);
  } else if (type < 1.5) {
    // WallWindows
    rough = 0.82;
    if (vertical) {
      vec2 cell; float fade;
      float m = windowMask(pattern, u, v, floorH, cell, fade);
      float h = bh31(vec3(cell, floor(vSeed * 97.0)));
      float h2 = bh31(vec3(cell.yx + 3.1, vSeed * 13.0));
      vec3 glass = mix(vec3(0.08, 0.1, 0.13), vec3(0.2, 0.26, 0.32), h2 * 0.6);
      // slight wall weathering per floor
      albedo *= 0.95 + 0.05 * bh11(cell.y + vSeed * 10.0);
      albedo = mix(albedo, glass, m);
      rough = mix(rough, 0.12, m);
      metal = mix(metal, 0.55, m);
      float litProb = uLitFraction * (0.55 + 0.9 * vSeed);
      float lit = step(h, litProb);
      // curtains / variation
      float intensity = 0.6 + 0.8 * h2;
      vec3 wl = windowLight(bh11(h * 91.7 + vSeed));
      // a few lit windows show a flickering TV
      float tv = step(0.94, h2) * lit;
      wl = mix(wl, vec3(0.5, 0.68, 1.0) * (0.75 + 0.25 * sin(uTime * 6.3 + h * 40.0) * sin(uTime * 2.7 + h2 * 17.0)), tv);
      // far away: average lit color instead of per-window noise (no shimmering when the camera moves)
      vec3 nearE = wl * lit * intensity;
      vec3 farE = vec3(1.0, 0.8, 0.56) * clamp(litProb, 0.0, 1.0);
      if (pattern > 7.5 && pattern < 8.5) {
        // churches / keeps / clock towers: every (arched) window glows warm amber, slight per-column tint
        float ct = bh11(cell.x * 5.3 + vSeed * 17.0);
        vec3 amber = vec3(1.0, 0.72, 0.42) * 0.9 * mix(vec3(1.0), vec3(1.06, 0.94, 0.86), ct);
        emis += amber * m * night * 1.3;
      } else {
        emis += mix(farE, nearE, fade) * m * night * 1.3;
      }
    }
  } else if (type < 2.5) {
    // Glass curtain wall
    vec3 tint = vec3(0.24, 0.36, 0.5);
    if (pattern > 0.5 && pattern < 1.5) tint = vec3(0.22, 0.42, 0.42);
    else if (pattern > 1.5 && pattern < 2.5) tint = vec3(0.45, 0.35, 0.2);
    else if (pattern > 2.5 && pattern < 3.5) tint = vec3(0.07, 0.08, 0.1);
    else if (pattern > 3.5 && pattern < 4.5) tint = vec3(0.55, 0.58, 0.62);
    else if (pattern > 4.5 && pattern < 5.5) tint = vec3(0.45, 0.6, 0.78);
    else if (pattern > 5.5) tint = vec3(0.34, 0.42, 0.48); // 6: residential glass (neutral blue-grey)
    bool resGlass = pattern > 5.5 && pattern < 6.5;
    albedo = tint * 0.55;
    rough = 0.06;
    metal = 0.92;
    if (vertical) {
      float cu = u / 1.5; float cv = v / floorH;
      float wu = fwidth(cu) + 1e-4; float wv = fwidth(cv) + 1e-4;
      float fade = clamp(1.0 - max(wu, wv) * 2.0, 0.0, 1.0);
      float mull = 1.0 - aaBox(cu, 0.06, 0.94, wu) * aaBox(cv, 0.05, 0.93, wv);
      mull *= fade;
      albedo = mix(albedo, vec3(0.28, 0.3, 0.33), mull * 0.8);
      rough = mix(rough, 0.5, mull);
      // per-panel subtle tint variation (reflection breakup)
      vec2 cell = vec2(floor(cu / 2.0), floor(cv));
      float h = bh31(vec3(cell, floor(vSeed * 51.0)));
      // light tints (silver / sky / residential) show blotches easily -> gentler variation
      float calmV = pattern > 3.5 ? 1.0 : 0.0;
      albedo *= mix(0.9 + 0.2 * h, 0.95 + 0.1 * h, calmV);
      rough += mix(0.05, 0.03, calmV) * h;
      if (resGlass) {
        // residential towers: apartments (~4 m wide units per floor) lit like homes, warm window colours,
        // ~55-75% lit in the evening, no fully dark floors
        vec2 unit = vec2(floor(u / 4.0), cell.y);
        float hu = bh31(vec3(unit, floor(vSeed * 71.0)));
        float litR = clamp(uLitFraction * 0.95 + 0.05, 0.0, 1.0) * (0.8 + 0.4 * vSeed);
        float fadeR = clamp(1.0 - max(fwidth(u / 4.0), wv) * 1.6, 0.0, 1.0);
        float litU = mix(clamp(litR, 0.0, 1.0), step(hu, litR), fadeR);
        vec3 wl = mix(vec3(1.0, 0.8, 0.52), windowLight(bh11(hu * 57.3 + vSeed)), fadeR);
        float curtain = 0.6 + 0.4 * smoothstep(0.1, 0.9, fract(u / 4.0)) * (1.0 - smoothstep(0.1, 0.9, fract(u / 4.0)) * 0.5);
        emis += wl * litU * (1.0 - mull) * night * mix(0.8, (0.55 + 0.6 * bh11(hu * 13.1)) * curtain, fadeR) * 1.1;
      } else {
      // offices / hotels at night: lights clustered per floor section, some floors entirely dark, per-panel
      // brightness, color temperature per floor (warm tints -> hotel-like warm light, blue tints -> office white)
      float fl = bh31(vec3(floor(cu / 6.0), cell.y, vSeed * 7.0));
      float floorOn = step(0.18, bh11(cell.y * 3.7 + vSeed * 57.0));
      float litP = uLitFraction * (0.45 + 0.8 * vSeed);
      float lit = step(fl, litP) * floorOn;
      // per-floor fade: distant floors blend to the average so tall towers don't sparkle
      float fadeF = clamp(1.0 - wv * 1.6, 0.0, 1.0);
      lit = mix(clamp(litP, 0.0, 1.0) * 0.82, lit, fadeF);
      float warmTint = step(1.5, pattern) * step(pattern, 2.5);
      float fh = bh11(cell.y * 7.3 + vSeed * 31.0);
      vec3 officeC = mix(vec3(0.74, 0.84, 1.0), vec3(1.0, 0.84, 0.62), clamp(step(0.72, fh) + warmTint * 0.8, 0.0, 1.0));
      officeC = mix(officeC, vec3(0.86, 0.95, 0.9), step(0.93, fh) * (1.0 - warmTint)); // a few greenish fluorescent floors
      // brighter toward the ceiling of each floor (ceiling lights), dimmer panels here and there
      float ceilG = 0.55 + 0.45 * smoothstep(0.15, 0.85, fract(cv));
      float panelB = 0.45 + 0.75 * bh31(vec3(floor(cu), cell.y, vSeed * 19.0));
      emis += officeC * lit * (1.0 - mull) * night * mix(0.75, ceilG * panelB, fadeF) * 0.95;
      }
    }
  } else if (type < 3.5) {
    // flat roof: gravel + tar patches
    float n = bnoise(P.xz * 0.8) * 0.6 + bnoise(P.xz * 3.1) * 0.4;
    albedo *= 0.82 + 0.25 * n;
    rough = 0.95;
  } else if (type < 4.5) {
    // roof tiles: horizontal courses by height
    float c = v * 3.2;
    float w = fwidth(c) + 1e-4;
    float line = 1.0 - smoothstep(0.0, 0.25 + w, fract(c));
    float fade = clamp(1.0 - w * 3.0, 0.0, 1.0);
    albedo *= 1.0 - 0.22 * line * fade;
    albedo *= 0.92 + 0.12 * bnoise(P.xz * 2.0);
    rough = 0.75;
  } else if (type < 5.5) {
    // metal: pattern 0 bare metal (tanks, pipes, rails); 1 solid car paint; 2 metallic car paint
    if (pattern > 0.5 && pattern < 1.5) {
      rough = 0.4;
      metal = 0.15;
    } else if (pattern > 1.5 && pattern < 2.5) {
      rough = 0.32;
      metal = 0.5;
    } else if (pattern > 2.5 && pattern < 3.5) {
      // patina (copper domes, bronze statues)
      rough = 0.62;
      metal = 0.3;
    } else {
      rough = 0.32;
      metal = 0.75;
    }
  } else if (type < 6.5) {
    if (pattern > 8.5 && pattern < 9.5) {
      // ground light pool (lit pavement under lamps): painted ~0.7x the ground color -> reads as normal pavement
      // by day, warm lamp-lit pavement at night (no daytime glow / tint)
      albedo = min(albedo * 1.43, vec3(1.0));
      float n = bnoise(P.xz * 0.6) * 0.5 + bnoise(P.xz * 2.7) * 0.5;
      albedo *= 0.9 + 0.18 * n;
      rough = 0.9;
      emis += albedo * vec3(1.0, 0.8, 0.55) * night * 0.75;
    } else if (pattern > 11.5 && pattern < 12.5) {
      // floodlit sports surface: plain by day (paint ~0.7x like pattern 9), cool white floodlight at night
      albedo = min(albedo * 1.43, vec3(1.0));
      rough = 0.9;
      emis += albedo * vec3(0.85, 0.92, 1.0) * night * 0.6;
    } else if (pattern > 9.5 && pattern < 11.5) {
      // night-only glow (stained glass, lanterns, tent canopies): no daytime emission; 10 = x1, 11 = x2
      float k = pattern < 10.5 ? 1.0 : 2.0;
      emis += albedo * 1.35 * night * k;
      rough = 0.5;
    } else {
      // emissive sign / light. pattern 1..8 scales intensity by pattern / 4 (pattern 0 = default 1x).
      // The night multiplier is moderate so saturated neon keeps its hue; bloom carries the glow.
      float k = pattern > 0.5 ? pattern * 0.25 : 1.0;
      emis += albedo * (0.3 + 1.35 * night) * k;
      rough = 0.5;
    }
  } else if (type < 7.5) {
    // plain glass: pattern 0 storefront / small windows (warm lit at night), pattern 1 vehicle glass (never glows)
    float h = bh31(vec3(floor(u / 4.0), floor(v / 3.0), vSeed * 31.0));
    // same look as the WallWindows procedural glass so modelled and procedural windows match
    albedo = mix(vec3(0.08, 0.1, 0.13), vec3(0.2, 0.26, 0.32), 0.3) * (0.9 + 0.2 * h);
    rough = 0.12;
    metal = 0.55;
    if (pattern > 1.5 && pattern < 2.5) {
      // pavilion glass (lobbies, foyers, greenhouses, concourses): reflective by day, uniform warm glow at night
      emis += vec3(1.0, 0.84, 0.62) * night * 0.6;
    } else if (pattern > 0.5 && pattern < 1.5) {
      albedo = vec3(0.035, 0.045, 0.055) + albedo * 0.2;
      rough = 0.05;
      metal = 0.9;
    } else {
      // homes / shops: per-window (~2.5 x 2.8 m cells) lit state follows the time-of-day lit fraction
      // (homes a bit above offices: ~55-75% in the evening, dipping late at night)
      vec2 wc = vec2(floor(u / 2.5), floor(v / 2.8));
      float hw = bh31(vec3(wc, floor(vSeed * 113.0)));
      float litP = clamp(uLitFraction * 0.95 + 0.05, 0.0, 1.0) * (0.75 + 0.5 * vSeed);
      float lit = step(hw, litP);
      float fw = clamp(1.0 - length(fwidth(vec2(u / 2.5, v / 2.8))) * 2.0, 0.0, 1.0);
      lit = mix(clamp(litP, 0.0, 1.0), lit, fw);
      vec3 wl = mix(vec3(1.0, 0.8, 0.52), vec3(1.0, 0.88, 0.7), step(0.7, h));
      emis += wl * night * (0.7 + 0.6 * h) * lit;
    }
  } else if (type < 8.5) {
    // foliage
    // leaf clumps (fade the noise with its screen footprint so distant canopies don't shimmer)
    vec2 fq = P.xz * 0.9 + P.y * 0.7;
    float fw1 = clamp(1.0 - length(fwidth(fq)) * 0.8, 0.0, 1.0);
    float n = mix(0.5, bnoise(fq), fw1);
    float n2 = mix(0.5, bnoise(P.xz * 4.0 + P.y * 3.0), fw1 * fw1);
    albedo *= 0.78 + 0.35 * n + 0.1 * n2;
    // per-plant hue + value variation, plus stand-scale patches (neighbouring trees share a tint) so forests
    // don't read as a uniform carpet. Depends only on the instance position -> identical for the far impostors.
    albedo *= mix(vec3(0.9, 0.98, 1.05), vec3(1.07, 1.02, 0.84), vSeed) * (0.78 + 0.3 * fract(vSeed * 7.31));
    float stand = bnoise(vInstXZ * 0.006) * 0.7 + bnoise(vInstXZ * 0.021 + 3.1) * 0.3;
    albedo *= (0.9 + 0.2 * stand) * mix(vec3(1.03, 1.0, 0.94), vec3(0.96, 1.0, 1.04), stand);
    // canopy self-occlusion: undersides / lower leaves darker (up-facing lawns & hedge tops unaffected)
    albedo *= 0.6 + 0.4 * smoothstep(-0.7, 0.75, nObj.y);
    rough = 0.9;
    // leaf translucency when looking toward the light through the canopy
    vec3 Lv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    vec3 Vv = normalize(vViewPosition);
    float back = pow(max(dot(-Vv, Lv), 0.0), 4.0);
    emis += albedo * uSunColor * back * 0.14;
  } else if (type < 9.5) {
    // water
    float t = uTime;
    float r = sin(P.x * 1.7 + t * 1.9) * sin(P.z * 1.3 - t * 1.5);
    albedo = mix(albedo, albedo * 1.3, 0.5 + 0.5 * r);
    rough = 0.04;
    metal = 0.35;
  } else if (type < 10.5) {
    // pavement
    float n = bnoise(P.xz * 0.6) * 0.5 + bnoise(P.xz * 2.7) * 0.5;
    albedo *= 0.88 + 0.2 * n;
    rough = 0.92;
  } else if (type < 11.5) {
    // corrugated metal: vertical ribs
    float c = u / 0.25;
    float w = fwidth(c) + 1e-4;
    float fade = clamp(1.0 - w * 3.0, 0.0, 1.0);
    albedo *= 1.0 - 0.18 * (0.5 + 0.5 * sin(c * 6.2831)) * fade * (vertical ? 1.0 : 0.0);
    rough = 0.45;
    metal = 0.55;
  } else if (type < 12.5) {
    // brick courses
    float cy = v / 0.28;
    float cx = u / 0.6 + 0.5 * floor(cy);
    float wy = fwidth(cy) + 1e-4; float wx = fwidth(cx) + 1e-4;
    float fade = clamp(1.0 - max(wx, wy) * 3.0, 0.0, 1.0);
    float mortar = 1.0 - aaBox(cy, 0.1, 0.95, wy) * aaBox(cx, 0.04, 0.97, wx);
    float bh = bh21(vec2(floor(cx), floor(cy)));
    albedo *= mix(1.0, (0.85 + 0.25 * bh) * (1.0 - 0.3 * mortar), fade * (vertical ? 1.0 : 0.0));
    albedo = mix(albedo, albedo * 0.93, 1.0 - fade);
    rough = 0.9;
  } else if (type < 13.5) {
    // wood planks
    float c = (vertical ? v : P.x) / 0.22;
    float w = fwidth(c) + 1e-4;
    float fade = clamp(1.0 - w * 3.0, 0.0, 1.0);
    float line = 1.0 - aaBox(c, 0.06, 0.96, w);
    albedo *= 1.0 - 0.25 * line * fade;
    albedo *= 0.9 + 0.15 * bh11(floor(c) + vSeed * 7.0);
    rough = 0.8;
  } else if (type < 14.5) {
    // stone blocks
    float cy = v / 0.7;
    float cx = u / 1.4 + 0.5 * floor(cy);
    float wy = fwidth(cy) + 1e-4; float wx = fwidth(cx) + 1e-4;
    float fade = clamp(1.0 - max(wx, wy) * 3.0, 0.0, 1.0);
    float joint = 1.0 - aaBox(cy, 0.04, 0.97, wy) * aaBox(cx, 0.02, 0.98, wx);
    float bh = bh21(vec2(floor(cx), floor(cy)));
    albedo *= mix(1.0, (0.9 + 0.16 * bh) * (1.0 - 0.25 * joint), fade * (vertical ? 1.0 : 0.3));
    rough = 0.85;
    if (pattern > 0.5 && pattern < 2.5) emis += floodlight(albedo, pattern, v, floorH, vertical, night);
  } else {
    // crop field rows along object X
    float c = P.z / 1.6;
    float w = fwidth(c) + 1e-4;
    float fade = clamp(1.0 - w * 2.0, 0.0, 1.0);
    float row = aaBox(c, 0.15, 0.7, w);
    albedo = mix(albedo * 0.95, mix(albedo * 0.55 + vec3(0.12, 0.08, 0.03), albedo * 1.08, row), fade);
    albedo *= 0.9 + 0.15 * bnoise(P.xz * 0.15);
    rough = 0.95;
  }
}
`;

const FRAG_APPLY = /* glsl */ `
{
  vec3 _alb = diffuseColor.rgb;
  float _r = roughnessFactor;
  float _m = metalnessFactor;
  vec3 _e = vec3(0.0);
  applySurface(_alb, _r, _m, _e, normalize(vObjNormal));
  diffuseColor.rgb = _alb;
  roughnessFactor = clamp(_r, 0.03, 1.0);
  metalnessFactor = clamp(_m, 0.0, 1.0);
  _surfEmissive = _e;
}
`;

/** Patch any MeshStandardMaterial / MeshPhysicalMaterial to understand the `surf` attribute. */
export function patchSurfaceMaterial<T extends THREE.MeshStandardMaterial>(mat: T, key = 'surf-v1'): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uNight = sharedUniforms.uNight;
    shader.uniforms.uLitFraction = sharedUniforms.uLitFraction;
    shader.uniforms.uWind = sharedUniforms.uWind;
    shader.uniforms.uSunDir = sharedUniforms.uSunDir;
    shader.uniforms.uSunColor = sharedUniforms.uSunColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nvec3 _surfEmissive = vec3(0.0);\n' + FRAG_APPLY)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += _surfEmissive;');
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

let _shared: THREE.MeshStandardMaterial | null = null;
/** The one shared material for all procedural models. */
export function getBuildingMaterial(): THREE.MeshStandardMaterial {
  if (_shared) return _shared;
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.0,
    envMapIntensity: 1.0,
  });
  patchSurfaceMaterial(m, 'building-uber-v1');
  _shared = m;
  return m;
}

/** Depth material for shadow casting that ignores nothing special; foliage sway is not replicated in shadows (cheap). */
