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
 *       warm lamp-lit pavement at night; intensity x floor/3.3 (paint `floor`, default 3.3 = 1x; use e.g. 1.5 for
 *       a dimmer outer ring).
 *   10 / 11 = NIGHT-ONLY glow x1 / x2 (no daytime emission: stained glass, lanterns, tent canopies).
 *   14 = greenhouse grow-light row: night glow like 11, but roof-coloured by day (`floor` < 2: white film, else roof
 *       glass) so the dark saturated lamp paint shows no stripes in daylight.
 *   12 = floodlit sports surface: like 9 (paint ~0.7x, plain by day) but cool white floodlight at night.
 *   13 = traffic-signal lamp: paint the lamp's lit colour, `floor` = lamp (0 red, 1 amber, 2 green) + 3 * head axis
 *       (0 model +Z, 1 model +X; informational). The shader derives the served axis from the lamp's WORLD normal and
 *       runs the same 30 s two-phase cycle per intersection cell as the vehicles (uSignalTime / uMapN, written by
 *       VehicleRenderer): x-axis green 0-13 s, amber 13-15; z-axis green 15-28, amber 28-30; red otherwise.
 *       Unlit lamps show albedo x0.15 without emission.
 * WallWindows pattern 8: arched civic windows (pattern 7 mask) with EVERY window lit warm amber at night
 *   (churches, keeps, clock towers).
 * Floodlit masonry: Surf.Plain and Surf.Stone pattern 1 (warm) / 2 (cool white) glow from the base up at night;
 *   the paint's `floor` value is the reach height H in meters (light fades 70% by H). Pattern 0 = unlit.
 * Plain glass (Surf.GlassPlain, surf.y): 0 storefront / house windows (per-window lit state follows the time-of-day
 *   lit fraction, ~2.5 x 2.8 m cells); 1 vehicle glass (dark, reflective, never glows);
 *   2 pavilion glass (reflective by day, uniform warm glow ~0.6 at night: lobbies, foyers, pyramids, concourses);
 *   3 grow-light glass (greenhouse walls / roofs: clear greenish glass by day with no tint or glow, saturated sodium
 *     amber at night with a little per-4 m-bay variation; stays orange under bloom).
 * Water (Surf.Water): dielectric with a view-dependent depth tint (pale floor from above, deeper at grazing angles),
 *   drifting caustics by day, sun glints; bright pool / fountain paints (linear blue > ~0.3) glow softly from
 *   underwater lights at night, dark pond paints stay dark.
 * Metal (Surf.Metal, surf.y): 0 bare metal (tanks, pipes, rails); 1 solid car paint (rough 0.40, metal 0.15);
 *   2 metallic car paint (rough 0.32, metal 0.50); 3 patina (rough 0.62, metal 0.30: copper domes, bronze statues).
 * Corrugated (Surf.Corrugated): vertical ribs, painted sheet metal (rough 0.6, metal 0.25).
 * Foliage (Surf.Foliage): wind sway above 1.5 m; per-plant hue/value + stand-scale tint from the instance position.
 *   Two classes: LOW foliage = lawns, roof gardens, green roofs / walls, hedges, planters, beds, shrubs (faces that are
 *   flat up-facing or axis-aligned box sides at any height, or anything below ~2.5 m model height) and CROWNS.
 *   Pattern 0 = automatic (lot models): low foliage goes dormant in winter; crowns are seasonal deciduous crowns (as
 *       pattern 1, turning per lot instance) unless painted dark (linear luminance < ~0.1: conifers, cypresses, yews),
 *       which are evergreen (pattern 4).
 *   Pattern 1 = seasonal deciduous crown: follows uSeason (month mix from nat_season.ts) - that fraction of trees turns
 *       orange / red / yellow in autumn and grey-brown (bare twigs) in winter; fresh yellow-green leaves in spring.
 *   Pattern 2 = spring-blossom tree (cherry, magnolia, flowering shrub): paint the BLOSSOM colour; shown only in
 *       Apr-May (all year in the tropics); otherwise the blossom-coloured faces (red >= green: pink / white / lilac)
 *       turn leaf green (~0.36x the blossom brightness), leaf-painted faces keep their paint; plus the pattern-1
 *       autumn / winter behaviour.
 *   For patterns 1-2 paint `floor` = a per-tree random in [0, 1) (all lobes of one crown share it) so each tree
 *   changes as a whole; the instance seed is mixed in.
 *   Pattern 3 = nature-model deciduous foliage (forest / street trees: the renderers swap seasonal model VARIANTS, see
 *       nat_season.ts): never recoloured by the season; low parts go dormant like pattern 0.
 *   Pattern 4 = evergreen (conifers, palms, evergreen shrubs): no seasonal recolour or winter dormancy (climate dryness
 *       only), a darker / cooler green in winter.
 *   All foliage follows the climate / season uniforms uFoliageDry / uFoliageSeason / uFoliageTint (setFoliageSeason):
 *   low foliage turns straw-dry in deserts / dormant in winter, crowns get a quarter of it; in winter evergreen crowns
 *   darken and deciduous leaves still on a tree (patterns 0-3, the non-bare remainder) turn dead brown.
 *
 * Facade coordinates: planar walls use the horizontal distance along the wall; smooth-shaded CURVED walls
 * (cylinders / drums / round towers built with smooth normals) automatically switch to the arc length around the
 * model's vertical axis (exact for shapes centred on the model origin), so they get windows / mullions too.
 * Distant windows fade to their average coverage and average lit color (no shimmer), per axis: window columns first,
 * floor rows (and curtain-wall floor lines) much later, so facades keep horizontal window bands at the default camera.
 * The render-world WorldView drives uNight, uTime and uLitFraction (time-of-day dependent: evening peak, late-night dip).
 */
import * as THREE from 'three';

let _lampsOn = 0;
export const sharedUniforms = {
  uTime: { value: 0 },
  /** 0 = full day, 1 = full night */
  uNight: { value: 0 },
  /** 0..1 street lamps / lot lights. Reads max(uNight, the switch-on factor WorldView writes from Sky.lightRig, which
   *  turns the lamps on shortly before sunset); pages that only drive uNight (gallery, demos) keep lamps = night */
  uLamps: {
    get value(): number { return Math.max(sharedUniforms.uNight.value, _lampsOn); },
    set value(v: number) { _lampsOn = v; },
  },
  /** strength of the warm night light spill on lot grounds (lawns / yards / paths below ~0.8 m); 0 = off */
  uLotSpill: { value: 0.035 },
  /** 0..1 global multiplier of how many windows are lit at night */
  uLitFraction: { value: 0.55 },
  /** wind strength for foliage */
  uWind: { value: 1 },
  /** world direction TO the active light (sun / moon), set by WorldView (used for foliage translucency) */
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
  /** active light color * intensity (linear), set by WorldView */
  uSunColor: { value: new THREE.Color(3, 3, 3) },
  /** traffic-signal clock (s, VehicleRenderer.time mod 30) and map size in cells, for Emissive pattern 13 */
  uSignalTime: { value: 0 },
  uMapN: { value: 128 },
  /** season for Foliage patterns 1-2: x autumn fraction, y bare fraction, z blossom (1 in Apr-May); set by setTreeSeason */
  uSeason: { value: new THREE.Vector4(0, 0, 0, 0) },
  /** 0..1 how dry / dormant low foliage (lot lawns, hedges, shrubs) looks: climate + season, see setFoliageSeason */
  uFoliageDry: { value: 0 },
  /** multiplier on all foliage (climate tint, e.g. lusher in the tropics) */
  uFoliageTint: { value: new THREE.Color(1, 1, 1) },
  /** foliage season (setFoliageSeason): x climate-only dryness (evergreens), y winter 0..1 (green crowns darken),
   *  z spring 0..1 (fresh deciduous leaves), w 1 = flowering all year (tropics; else pattern-2 blossom only Apr-May) */
  uFoliageSeason: { value: new THREE.Vector4(0, 0, 0, 0) },
};

/**
 * Climate / season look of lot foliage (render-world WorldView calls this every frame; cheap, idempotent).
 * Low foliage baked into lot models (lawns, roof gardens, hedges, shrubs) turns straw-dry in the desert and dormant in
 * winter so lots harmonise with the terrain palette; crowns follow the season through uSeason (patterns 0-2) or model
 * variants (nature trees), evergreens darken in winter (uFoliageSeason.y), deciduous leaves are fresher in spring (.z).
 */
export function setFoliageSeason(month: number, climate: string): void {
  const m = ((Math.floor(month) % 12) + 12) % 12;
  const winter = m === 11 || m <= 1;
  const seasonal = climate === 'temperate' || climate === 'alpine';
  let dry = 0;
  const tint = sharedUniforms.uFoliageTint.value;
  tint.setRGB(1, 1, 1);
  if (climate === 'desert') dry = 0.45;
  else if (climate === 'tropical') tint.setRGB(1.02, 1.06, 0.97);
  else if (climate === 'alpine') dry = winter ? 0.5 : m === 2 || m === 10 ? 0.22 : 0;
  else dry = winter ? 0.55 : m === 9 ? 0.15 : m === 10 || m === 2 ? 0.3 : 0;
  sharedUniforms.uFoliageDry.value = dry;
  const wk = !seasonal ? 0 : winter ? 1 : m === 10 || m === 2 ? 0.4 : 0;
  const sp = !seasonal ? 0 : m === 3 ? 1 : m === 4 ? 0.5 : 0;
  sharedUniforms.uFoliageSeason.value.set(climate === 'desert' ? 0.45 : 0, wk, sp, climate === 'tropical' ? 1 : 0);
}

// Per-instance values are FLAT varyings: interpolating a constant is not bit-exact (perspective correction), and the
// sin-hashes below amplify a 1-ulp difference into a different cell / lit state -> per-pixel stipple on facades.
const VERT_PARS = /* glsl */ `
attribute vec3 surf;
varying vec3 vSurf;
varying vec3 vObjPos;
varying vec3 vObjNormal;
flat varying float vSeed;
flat varying vec2 vInstXZ;
flat varying float vWorldNX;
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
vWorldNX = 0.0;
if (abs(surf.x - 6.0) < 0.5 && abs(surf.y - 13.0) < 0.5) {
  // world-space normal axis of traffic-signal lamps (Emissive pattern 13): 1 = faces along world X
  vec3 wn = objectNormal;
  #ifdef USE_BATCHING
    wn = mat3(batchingMatrix) * wn;
  #endif
  #ifdef USE_INSTANCING
    wn = mat3(instanceMatrix) * wn;
  #endif
  wn = mat3(modelMatrix) * wn;
  vWorldNX = abs(wn.x) > abs(wn.z) ? 1.0 : 0.0;
}
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
flat varying float vSeed;
flat varying vec2 vInstXZ;
flat varying float vWorldNX;
uniform float uSignalTime;
uniform float uMapN;
uniform vec4 uSeason;
uniform vec4 uFoliageSeason;
uniform float uFoliageDry;
uniform vec3 uFoliageTint;
uniform float uNight;
uniform float uLamps;
uniform float uLotSpill;
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

// Home light colour temperature per household: incandescent 2700 K, warm white, neutral, cool LED, TV blue, a rose lamp
vec3 homeLight(float h) {
  if (h < 0.3) return vec3(1.0, 0.64, 0.33);
  if (h < 0.58) return vec3(1.0, 0.79, 0.52);
  if (h < 0.78) return vec3(1.0, 0.9, 0.75);
  if (h < 0.92) return vec3(0.8, 0.88, 1.0);
  if (h < 0.97) return vec3(0.52, 0.68, 1.0);
  return vec3(1.0, 0.56, 0.45);
}
// Office light per tenant: cool 4000 K white, neutral, warm, a greenish fluorescent; warm glass tints (hotels) mostly
// warm / neutral room light
vec3 officeLight(float h, float warm) {
  if (warm > 0.5) return h < 0.55 ? vec3(1.0, 0.76, 0.5) : (h < 0.86 ? vec3(1.0, 0.88, 0.72) : vec3(0.82, 0.88, 1.0));
  if (h < 0.38) return vec3(0.74, 0.86, 1.0);
  if (h < 0.64) return vec3(0.96, 0.93, 0.84);
  if (h < 0.93) return vec3(1.0, 0.78, 0.52);
  return vec3(0.8, 1.0, 0.88);
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
  // (+1e-3: faces starting exactly on a cell boundary must not alternate between two cells per pixel)
  cell = floor(vec2(cu, cv) + 1e-3);
  float wu = fwidth(cu) * 1.2 + 1e-4;
  float wv = fwidth(cv) * 1.2 + 1e-4;
  // the fade is split by axis: window columns (~3 m) blur out first, while the floor rows (3 m tall, ~4 px at the
  // default 700 m camera) stay readable as horizontal window bands much longer -> no flat plastic slabs at game zoom
  float fadeU = clamp(1.0 - wu * 2.5, 0.0, 1.0);
  float fadeV = clamp(1.0 - wv * 1.4, 0.0, 1.0);
  fade = fadeU;
  float rowM = aaBox(cv, wy0, wy1, wv);
  float m = aaBox(cu, wx0, wx1, wu) * rowM;
  float colCov = wx1 - wx0;
  // shopfront ground floor for pattern 6
  if (pattern > 5.5 && pattern < 6.5 && v < floorH * 1.15) {
    rowM = smoothstep(0.1, 0.12, v / floorH) * (1.0 - smoothstep(0.82, 0.86, v / floorH));
    m = aaBox(u / 5.0, 0.06, 0.94, fwidth(u / 5.0) + 1e-4) * rowM;
    colCov = 0.88;
  }
  // average coverage for distance fade: first per floor row (band), then of the whole facade
  float avg = (wx1 - wx0) * (wy1 - wy0);
  float band = rowM * colCov;
  float mFar = mix(avg, band, fadeV);
  return mix(mFar, m, fadeU);
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
  // (band kept clear of both ends: a whole panel must not flip between planar and arc-length u per 2x2 pixel quad)
  float curvK = length(fwidth(nObj.xz)) / (length(fwidth(P.xz)) + 1e-4);
  if (curvK > 0.004 && curvK < 0.4) u = atan(nObj.z, nObj.x) * max(length(P.xz), 1.0);
  float v = P.y;
  float night = uNight;
  // lit windows come on with the street lamps around sunset (people switch lights on at dusk), ahead of the night factor
  float wNight = max(uNight, 0.6 * uLamps);
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
      // distant windows a bit darker so the (averaged) window rows still contrast with the wall
      glass *= mix(0.8, 1.0, fade);
      // slight wall weathering per floor
      albedo *= 0.95 + 0.05 * bh11(cell.y + vSeed * 10.0);
      albedo = mix(albedo, glass, m);
      rough = mix(rough, 0.12, m);
      metal = mix(metal, 0.55, m);
      float litProb = uLitFraction * (0.55 + 0.9 * vSeed);
      // office facades (ribbon / dense grid) empty out at night more than homes
      if ((pattern > 1.5 && pattern < 2.5) || (pattern > 4.5 && pattern < 5.5)) litProb *= 0.6;
      litProb = min(litProb, 0.9);
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
      // distant facades: keep per-floor brightness variation (while floors are still resolvable) so they read as
      // banded, not flat cream slabs
      float fadeFl = clamp(1.0 - fwidth(v / floorH) * 1.6, 0.0, 1.0);
      farE *= mix(1.0, 0.4 + 0.9 * bh11(cell.y * 1.73 + floor(vSeed * 23.0)), fadeFl);
      // the averaged far glow is capped so mid-distance towers don't read as glowing cream slabs
      farE *= 0.7;
      if (pattern > 7.5 && pattern < 8.5) {
        // churches / keeps / clock towers: every (arched) window glows warm amber, slight per-column tint
        float ct = bh11(cell.x * 5.3 + vSeed * 17.0);
        vec3 amber = vec3(1.0, 0.72, 0.42) * 0.9 * mix(vec3(1.0), vec3(1.06, 0.94, 0.86), ct);
        emis += amber * m * wNight * 0.9;
      } else {
        emis += mix(farE, nearE, fade) * m * wNight * 0.9;
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
    // less metallic + brighter base than a pure mirror so every tint survives the 45 deg view (which mostly reflects
    // the ground); plus an unlit sky-tint term by day (reads as clean glass from above)
    albedo = tint * 0.75;
    rough = 0.06;
    metal = 0.7;
    if (vertical) {
      float cu = u / 1.5; float cv = v / floorH;
      float wu = fwidth(cu) + 1e-4; float wv = fwidth(cv) + 1e-4;
      // mullions (1.5 m) fade first; the floor lines (spandrel per floor) stay readable until floors are ~2 px, then
      // everything blends to a flat average (~35% frame; residential glass 50% so lit units keep dark floor slabs)
      float fadeU = clamp(1.0 - wu * 2.0, 0.0, 1.0);
      float fadeV = clamp(1.0 - wv * 1.6, 0.0, 1.0);
      // unlit sky-tint term by day (reads as clean glass from above), weaker at distance where it turned whole
      // towers into smooth white plastic
      emis += mix(vec3(0.55, 0.65, 0.8), tint * 1.4, 0.35) * 0.08 * (1.0 - night) * mix(0.55, 1.0, fadeU);
      float boxV = aaBox(cv, 0.05, 0.93, wv);
      float mullNear = 1.0 - aaBox(cu, 0.06, 0.94, wu) * boxV;
      float farLvl = resGlass ? 0.5 : 0.35;
      // u-averaged mask (1 - 0.88 * boxV averages 0.226), re-centred on the far level so the tone stays constant
      float mullRow = clamp(1.0 - 0.88 * boxV + (farLvl - 0.226), 0.0, 1.0);
      float mull = mix(mix(farLvl, mullRow, fadeV), mullNear, fadeU);
      // distant curtain glass slightly darker (panels read as glass, not white plastic, at the default camera)
      albedo *= mix(0.82, 1.0, fadeU);
      albedo = mix(albedo, vec3(0.28, 0.3, 0.33), mull * 0.8);
      rough = mix(rough, 0.5, mull);
      // per-panel subtle tint variation (reflection breakup)
      vec2 cell = floor(vec2(cu / 2.0, cv) + 1e-3);
      float h = bh31(vec3(cell, floor(vSeed * 51.0)));
      // light tints (silver / sky / residential) show blotches easily -> gentler variation
      float calmV = pattern > 3.5 ? 1.0 : 0.0;
      albedo *= mix(0.9 + 0.2 * h, 0.95 + 0.1 * h, calmV);
      rough += mix(0.05, 0.03, calmV) * h;
      // night lights at window scale: panel (1.5 m) -> section / unit -> floor -> facade levels of detail, each blended
      // to its average once it gets smaller than ~2 px (sub-pixel cells would shimmer), so towers read as small lit
      // windows of varied colour and brightness (sparkle) instead of pale 4-9 m blocks at 300-700 m
      float pxP = 1.0 / max(wu, 1e-4);
      float pxF = 1.0 / max(wv, 1e-4);
      float fP = smoothstep(1.3, 2.6, pxP) * smoothstep(1.3, 2.6, pxF);
      float fF = smoothstep(1.3, 2.6, pxF);
      float hp = bh31(vec3(floor(cu + 1e-3), cell.y, floor(vSeed * 43.0) + 5.0));
      float hp2 = fract(hp * 7.31 + 0.17);
      if (resGlass) {
        // homes: every apartment (3 panels) is a household at home with the lights on (70% of its rooms lit) or not
        // (a stray lamp in ~9% of its rooms), each with its own light colour; every panel a room with its own lamp /
        // curtain brightness -> scattered small lit windows of varied warm / neutral / cool light
        float cuU = cu / 3.0;
        float fU = smoothstep(1.3, 2.6, 1.0 / max(fwidth(cuU), 1e-4)) * fF;
        float hu = bh31(vec3(floor(cuU + 1e-3), cell.y, floor(vSeed * 71.0)));
        float litR = clamp(uLitFraction * 0.8, 0.0, 1.0) * (0.75 + 0.5 * vSeed);
        float unitOn = step(hu, litR);
        float pRoom = mix(0.09, 0.7, unitOn);
        float roomB = 0.3 + 0.95 * hp2;
        // per-household brightness (curtains, lamp count), mean 1
        float unitB = 0.55 + 0.9 * fract(hu * 31.7 + 0.13);
        vec3 hc = homeLight(fract(hu * 57.3 + vSeed * 3.1));
        vec3 cAvg = vec3(1.0, 0.8, 0.56);
        vec3 eP = hc * (step(hp, pRoom) * roomB * unitB + 0.04);
        vec3 eU = hc * (pRoom * 0.775 * unitB + 0.04);
        vec3 eF = cAvg * ((0.09 + 0.61 * clamp(litR, 0.0, 1.0)) * 0.775 + 0.04);
        vec3 e = mix(eF, mix(eU, eP, fP), fU);
        emis += e * (1.0 - mull) * wNight * 0.62;
      } else {
      // offices / hotels: per floor dark (~30%, a few late workers), partly lit or fully lit (open plan); 3 m sections
      // lit (75% of their windows on, each section its own brightness) or not (a stray desk lamp in ~8%), per-panel
      // brightness (blinds, desks) and a ceiling-light gradient -> clusters of lit windows with gaps, not solid blocks;
      // colour temperature per tenant (9 m of a floor: cool 4000 K office white, neutral, warm; warm glass tints read
      // hotel-like)
      float warmTint = step(1.5, pattern) * step(pattern, 2.5);
      float fr1 = bh11(cell.y * 3.7 + vSeed * 57.0);
      float occ = fr1 < mix(0.3, 0.12, warmTint) ? 0.1 : (fr1 < 0.72 ? 0.75 : 1.55);
      float cuS = cu / 2.0;
      float fS = smoothstep(1.3, 2.6, 1.0 / max(fwidth(cuS), 1e-4)) * fF;
      float hs = bh31(vec3(floor(cuS + 1e-3), cell.y, vSeed * 7.0));
      float litP = uLitFraction * (0.45 + 0.8 * vSeed);
      float secP = clamp(litP * occ, 0.0, 0.97);
      float pWin = mix(0.08, 0.75, step(hs, secP));
      float secB = 0.5 + fract(hs * 23.7 + 0.31);
      float panB = 0.35 + 0.85 * hp2;
      float fh = bh11(cell.y * 7.3 + vSeed * 31.0);
      vec3 fc = officeLight(fract(fh + 0.618 * floor(cuS / 3.0 + 1e-3)), warmTint);
      vec3 cAvg = mix(vec3(0.87, 0.88, 0.88), vec3(1.0, 0.86, 0.66), warmTint);
      float ceilG = mix(0.775, 0.55 + 0.45 * smoothstep(0.15, 0.85, fract(cv)), fF);
      float floorP = 0.08 + 0.67 * secP;
      vec3 eP = fc * (step(hp, pWin) * panB * secB + 0.045) * ceilG;
      vec3 eS = fc * (pWin * 0.775 * secB + 0.045) * ceilG;
      vec3 eFl = officeLight(fh, warmTint) * (floorP * 0.775 + 0.045) * 0.775;
      vec3 eA = cAvg * ((0.08 + 0.67 * clamp(litP * 0.77, 0.0, 1.0)) * 0.775 + 0.045) * 0.775;
      vec3 e = mix(eA, mix(eFl, mix(eS, eP, fP), fS), fF);
      emis += e * (1.0 - mull) * wNight * 0.6;
      }
    }
  } else if (type < 3.5) {
    // flat roof: gravel + tar patches
    float n = bnoise(P.xz * 0.8) * 0.6 + bnoise(P.xz * 3.1) * 0.4;
    albedo *= 0.82 + 0.25 * n;
    rough = 0.95;
    // green-painted (garden / sedum) roofs follow the lawns' season: dormant in winter, straw in the desert (Foliage)
    float grK = smoothstep(0.02, 0.08, albedo.g - max(albedo.r, albedo.b));
    albedo = mix(albedo, mix(albedo, vec3(dot(albedo, vec3(0.3, 0.59, 0.11))) * vec3(1.18, 1.02, 0.68), uFoliageDry) * uFoliageTint, grK);
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
      // intensity scales with the paint's floor value (floor / 3.3; default 3.3 = 1x) for soft fall-off rings
      // light color: the lamp's warm white, only lightly tinted by the ground; green grounds (park lawns, gardens) keep
      // almost none of their hue so lamp pools on grass read warm, not mint / sage
      float gr = smoothstep(0.08, 0.35, (albedo.g - max(albedo.r, albedo.b)) / max(albedo.g, 1e-3));
      vec3 poolBase = mix(vec3(dot(albedo, vec3(0.3, 0.59, 0.11))), albedo, 0.35 * (1.0 - 0.8 * gr));
      emis += poolBase * mix(vec3(1.0, 0.8, 0.55), vec3(1.0, 0.74, 0.46), gr) * uLamps * 0.75 * ((vSurf.z > 0.005 ? vSurf.z : 3.3) / 3.3);
    } else if (pattern > 12.5 && pattern < 13.5) {
      // traffic-signal lamp: same per-intersection 30 s cycle as the vehicles (VehicleRenderer)
      ivec2 cell = ivec2(floor(vInstXZ / 16.0));
      uint ci = uint(max(cell.y * int(uMapN + 0.5) + cell.x, 0));
      float off = float((ci * 2654435761u) % 997u) * 0.03;
      float ph = mod(uSignalTime + off, 30.0);
      float state = 0.0; // 0 red, 1 amber, 2 green
      if (vWorldNX > 0.5) state = ph < 13.0 ? 2.0 : (ph < 15.0 ? 1.0 : 0.0);
      else state = ph >= 15.0 && ph < 28.0 ? 2.0 : (ph >= 28.0 ? 1.0 : 0.0);
      float lamp = mod(floor(vSurf.z + 0.5), 3.0);
      rough = 0.5;
      if (abs(lamp - state) < 0.5) emis += albedo * (0.3 + 1.35 * night) * 0.8;
      else albedo *= 0.15;
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
    } else if (pattern > 13.5 && pattern < 14.5) {
      // grow-light lamp rows on greenhouse roofs: like 11 at night (the dark saturated paint glows x2), but by day they
      // take the roof's colour (floor < 2: white film, else roof glass) instead of showing as rust / plum stripes
      vec3 dayC = vSurf.z < 2.0 ? vec3(0.8, 0.82, 0.8) : vec3(0.3, 0.37, 0.44);
      emis += albedo * 2.7 * night;
      albedo = mix(dayC, albedo, night);
      rough = mix(0.12, 0.5, night);
      metal = mix(0.45, 0.0, night) * step(2.0, vSurf.z);
    } else {
      // emissive sign / light. pattern 1..8 scales intensity by pattern / 4 (pattern 0 = default 1x).
      // The night multiplier is moderate so saturated neon keeps its hue; bloom carries the glow.
      float k = pattern > 0.5 ? pattern * 0.25 : 1.0;
      emis += albedo * (0.3 + 1.35 * wNight) * k;
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
      emis += vec3(1.0, 0.84, 0.62) * wNight * 0.6;
    } else if (pattern > 2.5 && pattern < 3.5) {
      // grow-light glass (greenhouse walls / roofs): clear, slightly greenish glass by day with NO tint or glow; at
      // night the HPS lamps inside shine through as a saturated sodium amber (kept below the bloom threshold so it
      // stays orange instead of bleaching to white), a little brightness variation per 4 m bay
      albedo = mix(albedo, vec3(0.16, 0.2, 0.19), 0.35);
      rough = 0.1;
      metal = 0.45;
      float bay = bh31(vec3(floor(u / 4.0 + 1e-3), floor(v / 6.0 + 1e-3), floor(vSeed * 61.0)));
      emis += vec3(0.95, 0.34, 0.05) * wNight * (0.26 + 0.14 * bay);
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
      // far: per-row (floor) brightness variation while rows are resolvable -> banded, not a uniform glowing slab
      float fwRow = clamp(1.0 - fwidth(v / 2.8) * 1.6, 0.0, 1.0);
      float litFar = clamp(litP, 0.0, 1.0) * mix(1.0, 0.4 + 0.9 * bh11(wc.y * 1.73 + floor(vSeed * 29.0)), fwRow);
      lit = mix(litFar, lit, fw);
      vec3 wl = mix(vec3(1.0, 0.8, 0.52), vec3(1.0, 0.88, 0.7), step(0.7, h));
      emis += wl * wNight * (0.6 + 0.5 * h) * lit;
    }
  } else if (type < 8.5) {
    // foliage
    // (patterns 0-4 and the LOW / CROWN classes: see the header)
    float lum0 = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    // LOW foliage: flat up-facing faces (lawns, roof gardens, hedge / planter tops) or axis-aligned box sides (hedges,
    // planters, green walls) at any height, or anything within ~2.5 m of the model base (shrubs, beds)
    float flatK = max(smoothstep(0.985, 0.998, nObj.y), smoothstep(0.994, 0.999, max(abs(nObj.x), abs(nObj.z))));
    float lowF = max(1.0 - smoothstep(0.4, 2.6, P.y), flatK);
    bool autoP = pattern < 0.5;
    // evergreen: pattern 4, or a dark-painted lot crown (conifers / cypresses ~0.06-0.09 linear luminance, broadleaf
    // crowns >= ~0.115)
    float everK = pattern > 3.5 ? 1.0 : (autoP ? (1.0 - smoothstep(0.097, 0.108, lum0)) * (1.0 - lowF) : 0.0);
    // crowns recoloured by the season: patterns 1-2, and lot crowns (pattern 0) that are neither low nor evergreen
    // (nature trees, pattern 3, swap seasonal model variants instead)
    float seasK = pattern > 0.5 && pattern < 2.5 ? 1.0 : (autoP ? (1.0 - lowF) * (1.0 - everK) : 0.0);
    // 1 = the leaves are still green (not recoloured to bare twigs / autumn colours)
    float greenK = 1.0;
    // fine twig texture coordinate for bare crowns + its distance fade (derivatives outside the branches below)
    vec2 tq = P.xz * 2.7 + P.y * 1.9;
    float twF = clamp(1.0 - length(fwidth(tq)) * 0.7, 0.0, 1.0);
    if (seasK > 0.001) {
      // per-tree random from the paint's floor channel + instance seed (lot crowns, floor 3.3: per lot instance); a
      // little spatial noise lets crowns near the month's autumn threshold turn patchily; recolour at the painted
      // brightness so the baked crown shading survives
      vec2 wq = vInstXZ + P.xz;
      float pr = fract(vSurf.z * 7.13 + vSeed * 3.71);
      float prN = pr + (bnoise(wq * 0.21) - 0.5) * 0.12;
      vec3 c = albedo;
      float lum = lum0;
      if (pattern > 1.5 && pattern < 2.5 && uSeason.z < 0.5 && uFoliageSeason.w < 0.5) {
        // blossom outside Apr-May (the tropics flower all year): the blossom-coloured faces (red >= green) become
        // ordinary leaf green
        c = mix(c, lum * vec3(0.21, 0.434, 0.077), smoothstep(-0.03, 0.02, albedo.r - albedo.g));
        lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      }
      if (pr < uSeason.y) {
        // bare twigs: a dark grey-brown interior crossed by lighter twig strands (a fine texture that fades to its
        // average with distance), darker undersides, so a solid lot crown reads as a see-through branch tangle rather
        // than a grey-brown puffball (about the far-impostor brightness of the bare nature trees)
        float strand = mix(0.42, smoothstep(0.4, 0.75, bnoise(tq + 11.3)), twF);
        c = lum * vec3(1.1, 0.93, 0.84) * (0.3 + 0.75 * strand) * (0.72 + 0.28 * smoothstep(-0.5, 0.6, nObj.y));
        greenK = 0.0;
      } else if (prN < uSeason.y + uSeason.x) {
        // autumn: orange -> red -> yellow per tree, blended with a little noise (no hard seam across a crown)
        float h = fract(pr * 13.7) + (bnoise(wq * 0.35 + 7.1) - 0.5) * 0.3;
        vec3 ac = mix(vec3(2.55, 0.62, 0.08), vec3(3.3, 0.34, 0.12), smoothstep(0.38, 0.52, h));
        c = lum * mix(ac, vec3(2.5, 1.7, 0.1), smoothstep(0.7, 0.82, h));
        greenK = 0.0;
      }
      albedo = mix(albedo, c, seasK);
      greenK = mix(1.0, greenK, seasK);
    }
    // green crown leaves: fresh yellow-green in spring (deciduous); in winter evergreens turn a darker, cooler green and
    // the deciduous leaves still on a tree (the non-bare remainder) are dead brown (marcescent oaks / beeches), so a
    // winter wood reads grey-brown + dark evergreens, not speckled with summer green; blossom / autumn / twig colours
    // (red >= green) are left alone
    {
      float leafK = greenK * smoothstep(-0.01, 0.03, albedo.g - albedo.r);
      float decidK = leafK * (1.0 - lowF) * (1.0 - everK);
      albedo *= mix(vec3(1.0), vec3(1.07, 1.1, 0.78), uFoliageSeason.z * decidK);
      float lumL = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
      // (evergreen hedges / shrubs darken too)
      albedo = mix(albedo, albedo * vec3(0.8, 0.86, 0.9), uFoliageSeason.y * leafK * everK);
      // dead leaves: russet, broken up by the twig texture so the crown reads thin, not as a solid brown ball
      float twM = mix(0.5, bnoise(tq + 11.3), twF);
      albedo = mix(albedo, lumL * vec3(1.15, 0.81, 0.58) * (0.55 + 0.75 * twM), uFoliageSeason.y * decidK);
    }
    // climate / season (uFoliageDry, uFoliageTint): low foliage turns straw-dry in deserts and dormant in winter so
    // lots match the terrain; crowns get a quarter of it; evergreens only the climate part (no winter dormancy)
    {
      float dryK = mix(uFoliageDry, uFoliageSeason.x, everK) * mix(0.25, 1.0, lowF);
      float fl = dot(albedo, vec3(0.3, 0.59, 0.11));
      albedo = mix(albedo, vec3(fl) * vec3(1.18, 1.02, 0.68), dryK) * uFoliageTint;
    }
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
    // water (pools, fountains, reflecting pools, ponds): a dielectric (no metallic env mirror -> no flat opaque cyan),
    // pale lit floor seen from above and deeper colour toward grazing angles, drifting caustics by day, sun glints from
    // the low roughness; bright (pool / fountain) water glows softly from underwater lights at night, dark ponds don't
    float t = uTime;
    vec3 paint = albedo;
    float r = sin(P.x * 1.7 + t * 1.9) * sin(P.z * 1.3 - t * 1.5);
    albedo = mix(albedo, albedo * 1.18, 0.5 + 0.5 * r);
    rough = 0.06;
    metal = 0.0;
    // (face normal from derivatives: vNormal is declared after this function in the standard shader)
    float ndv = abs(dot(normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))), normalize(vViewPosition)));
    // deeper, saturated body; the pool paint's lighter centre patch (poolGlow) then reads as the shallow lit floor
    albedo = mix(albedo * 0.5, albedo * 0.9 + 0.02, ndv);
    // caustic web: thin bright ridges drifting over the floor (fades to its average when too small on screen)
    vec2 cq = P.xz * 1.1;
    float cfw = clamp(1.0 - length(fwidth(cq)) * 0.6, 0.0, 1.0);
    float c1 = 1.0 - abs(2.0 * bnoise(cq + vec2(t * 0.4, t * 0.23)) - 1.0);
    float c2 = 1.0 - abs(2.0 * bnoise(cq * 1.7 - vec2(t * 0.31, t * 0.5) + 3.7) - 1.0);
    float caus = mix(0.12, pow(c1, 6.0) * 0.65 + pow(c2, 6.0) * 0.45, cfw);
    emis += (albedo * 0.5 + vec3(0.03, 0.05, 0.05)) * caus * (1.0 - night);
    float poolK = smoothstep(0.22, 0.5, paint.b) * smoothstep(0.12, 0.3, paint.g);
    emis += paint * vec3(0.8, 1.0, 1.05) * night * 0.3 * poolK * (0.85 + 0.3 * caus);
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
    // painted sheet metal (containers, sheds): mostly paint, a little metal
    rough = 0.6;
    metal = 0.25;
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
  // night: the ground of a lot (lawns, yards, paths, parking at the foot of the buildings) catches a faint warm spill of
  // its windows / porch lights and the street lamps, so gardens stay readable instead of sinking into the night floor
  // (terrain and roads have their own shaders: open land stays dark)
  if (!vertical && nObj.y > 0.85 && P.y < 0.8 && (type < 5.5 || (type > 9.5 && type < 14.5) || (type > 6.5 && type < 8.5))) {
    emis += albedo * vec3(1.0, 0.86, 0.66) * uLamps * uLotSpill * (0.6 + 0.6 * uLitFraction);
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
    shader.uniforms.uLamps = sharedUniforms.uLamps;
    shader.uniforms.uLotSpill = sharedUniforms.uLotSpill;
    shader.uniforms.uLitFraction = sharedUniforms.uLitFraction;
    shader.uniforms.uWind = sharedUniforms.uWind;
    shader.uniforms.uSunDir = sharedUniforms.uSunDir;
    shader.uniforms.uSunColor = sharedUniforms.uSunColor;
    shader.uniforms.uSignalTime = sharedUniforms.uSignalTime;
    shader.uniforms.uMapN = sharedUniforms.uMapN;
    shader.uniforms.uSeason = sharedUniforms.uSeason;
    shader.uniforms.uFoliageDry = sharedUniforms.uFoliageDry;
    shader.uniforms.uFoliageTint = sharedUniforms.uFoliageTint;
    shader.uniforms.uFoliageSeason = sharedUniforms.uFoliageSeason;
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
