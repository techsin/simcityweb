/**
 * Road "uber" material: one patched MeshStandardMaterial for all network geometry (asphalt, markings, sidewalks,
 * curbs, medians, ballast, sleepers, rails, bridges, barriers). Surface type + road coordinates come from the `rd`
 * vertex attribute (see geobuf.ts / mesher.ts). All markings, wear, patches and cracks are procedural (world-space
 * noise), so there are no textures and one draw call per chunk.
 * At night lit roads (every street / road / avenue / one-way, highways) carry a continuous lamp-lit ribbon in the
 * lamp colour of the cell (lampTint, baked into the road mesh: amber sodium for most of the city, white LED on highways
 * and in a few districts), brighter on arterials; PropRenderer's light pools and lamp-head glows use lampUniforms from
 * here (strength, distance fades) so the per-lamp spots fade out where the ribbons take over.
 * Median / verge grass follows the lot lawns' season (sharedUniforms.uFoliageDry: dormant in winter, straw in deserts).
 */
import * as THREE from 'three';
import { sharedUniforms } from '../../../assets/materials';
import { Network, Zone } from '../../../core/types';

export const roadUniforms = {
  /** 0..1: data-view overlay active (desaturate) */
  uRoadOverlay: { value: 0 },
  /** 0..1: underground view (dim the surface) */
  uRoadDim: { value: 0 },
  /** strength of the continuous lamp-lit ribbon on lit roads at night (street-lighting block of roadSurface; sodium,
   *  white LED ribbons x0.75) */
  uLampRibbon: { value: 0.04 },
};

/**
 * Street lighting look, shared with PropRenderer's light pools / lamp-head glows (small hook there): the pools add the
 * per-lamp spots up close and fade out with camera distance, where the continuous road ribbon (road shader) alone
 * carries the lit street network (a regular lattice of pool / head dots read as a bead grid from far away).
 */
export const lampUniforms = {
  /** light pool strength (additive): warm sodium pools along the ribbons at the default zoom */
  uPoolStrength: { value: 0.16 },
  /** camera distance (m): pools fade out between x and y */
  uPoolFade: { value: new THREE.Vector2(1300, 3000) },
  /** lamp-head glow sprites: fade between x and y (m) down to z */
  uGlowFade: { value: new THREE.Vector3(700, 2800, 0.12) },
};

/** district size (cells) of the street-lamp type (white LED vs sodium districts) */
const LAMP_DISTRICT = 12;
/** share (%) of the districts re-lamped with white LEDs; the rest of the city keeps warm sodium */
const LED_DISTRICTS = 15;
/** the road mesh carries the lamp type of its cell as this bit of the `rd` surface code (mesher.ts) */
export const LAMP_LED_BIT = 1024;
/**
 * Street lamp type at cell (cx, cz) for a road of network type t: 1 = white LED / metal halide (highways and ~15% of the
 * districts), 0 = amber sodium (the rest of the city; always next to industry, whose yards stay sodium-lit: any
 * industrial / landfill zone within 2 cells, when `zone` (N x N zone grid) is given). The mesher bakes it into the road
 * surface code (LAMP_LED_BIT) and the lamp pools, so the ribbon, pools and lamp heads always agree.
 */
export function lampTint(cx: number, cz: number, t: number, zone?: ArrayLike<number>, N = 0): number {
  if (t === Network.Highway) return 1;
  const bx = Math.floor(Math.max(cx, 0) / LAMP_DISTRICT), bz = Math.floor(Math.max(cz, 0) / LAMP_DISTRICT);
  let h = (Math.imul(bx, 73856093) ^ Math.imul(bz, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  if (h % 100 >= LED_DISTRICTS) return 0;
  if (zone && N > 0) {
    for (let z = Math.max(0, cz - 2); z <= Math.min(N - 1, cz + 2); z++) {
      for (let x = Math.max(0, cx - 2); x <= Math.min(N - 1, cx + 2); x++) {
        const zt = zone[z * N + x];
        if (zt >= Zone.IndAg && zt <= Zone.Landfill) return 0;
      }
    }
  }
  return 1;
}

const VERT_PARS = /* glsl */ `
attribute vec4 rd;
varying vec4 vRd;
varying vec3 vWp;
`;
const VERT_MAIN = /* glsl */ `
vRd = rd;
vWp = (modelMatrix * vec4(position, 1.0)).xyz;
`;

const FRAG_PARS = /* glsl */ `
varying vec4 vRd;
varying vec3 vWp;
uniform float uNight;
uniform float uLamps;
uniform float uTime;
uniform float uRoadOverlay;
uniform float uRoadDim;
uniform float uLampRibbon;
uniform vec2 uPoolFade;
uniform float uFoliageDry;


float rh21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float rnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh21(i), rh21(i + vec2(1.0, 0.0)), f.x), mix(rh21(i + vec2(0.0, 1.0)), rh21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float rfbm(vec2 p) { return rnoise(p) * 0.5 + rnoise(p * 2.03 + 7.1) * 0.3 + rnoise(p * 4.1 + 3.3) * 0.2; }
// Anti-aliased masks with an explicit filter width fw (~0.8 px in the coordinate's units: one fwidth per axis for the
// whole shader) and linear edge ramps: the edges are ~1 px wide, so the ramp shape does not show, and software
// renderers (which evaluate every branch of this shader for every fragment) pay a fraction of the smoothstep / fwidth
// cost. band: |x - c| < hw; range: x in [a, b]
float band(float x, float c, float hw, float fw) {
  return clamp((hw - abs(x - c)) / (2.0 * fw) + 0.5, 0.0, 1.0);
}
float rangeW(float x, float a, float b, float fw) {
  float k = 0.5 / fw;
  return clamp((x - a) * k + 0.5, 0.0, 1.0) * clamp((b - x) * k + 0.5, 0.0, 1.0);
}
// dashes along v (period / duty), faded to their average when too small on screen; fw = filter width of v
float dashes(float v, float period, float duty, float fw) {
  float f = fract(v / period);
  float w = fw / period;
  float m = clamp(f / w, 0.0, 1.0) * clamp((duty - f) / (2.0 * w) + 0.5, 0.0, 1.0);
  return mix(duty, m, clamp(1.0 - w * 6.0, 0.0, 1.0));
}
float arrowMask(float ul, float vl, float fwu, float fwv) {
  float fw = max(fwu, fwv);
  float shaft = band(ul, 0.0, 0.12, fw) * rangeW(vl, -2.6, 0.7, fw);
  float head = band(ul, 0.0, (2.3 - vl) * 0.45, fw) * rangeW(vl, 0.6, 2.3, fw);
  return clamp(shaft + head, 0.0, 1.0);
}

// grass of medians / verges: dormant straw in winter and in deserts, like the lot lawns (materials.ts uFoliageDry)
vec3 roadGrass(vec3 c) {
  return mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))) * vec3(1.18, 1.02, 0.68), uFoliageDry);
}

void roadSurface(inout vec3 albedo, inout float rough, inout float metal, inout vec3 emis, vec3 nrm) {
  float code = floor(vRd.z + 0.5);
  // (white LED lamp bit: LAMP_LED_BIT, baked by the mesher from lampTint; read again at the lamp ribbon below. Values kept
  // alive across this whole shader cost more in software rendering than recomputing them)
  code -= ${LAMP_LED_BIT}.0 * step(${LAMP_LED_BIT - 0.5}, code);
  float mat = floor(code / 64.0);
  float kind = floor(mod(code, 64.0) / 8.0);
  float feat = mod(code, 8.0);
  float u = vRd.x;
  float v = vRd.y;
  float wf = floor(vRd.w + 0.5);
  vec2 wp = vWp.xz;
  float au = abs(u);
  // filter widths (~0.8 px) of the road coordinates and the on-screen footprint of the surface (1 up close, 0 from
  // ~2.9 m per pixel)
  vec2 fwuv = fwidth(vec2(u, v)) * 0.8 + 1e-4;
  float fwU = fwuv.x, fwv = fwuv.y;
  vec2 fwWp = fwidth(wp);
  float distFade = clamp(1.0 - length(fwWp) * 0.35, 0.0, 1.0);
  // half width of the carriageway by road kind (street, road, avenue, one-way, highway)
  float aw = kind < 1.5 ? 3.6 : (kind < 2.5 ? 5.0 : (kind < 3.5 ? 6.8 : (kind < 4.5 ? 5.0 : 8.0)));
  // one mottling fbm (~2 m) + one fine grain noise for every material (software renderers run every material branch
  // for every fragment: per-material noise calls were most of this shader's cost)
  float sN = rfbm(wp * 0.5);
  float sF = rnoise(wp * 8.0);

  if (mat < 0.5) {
    // ---------------------------------------------------------------- asphalt
    float n1 = rfbm(wp * 0.035);
    float grain = sF * 0.6 + rnoise(wp * 17.0) * 0.4;
    vec3 base = vec3(0.052, 0.054, 0.058);
    // highways: slightly darker, smoother asphalt than city streets
    if (kind > 4.5 && kind < 5.5) base = vec3(0.044, 0.046, 0.05);
    vec3 c = base * (0.78 + 0.42 * n1) * (0.93 + 0.14 * sN);
    c *= mix(1.0, 0.82 + 0.36 * grain, distFade);
    rough = 0.9;
    // repair patches (rectangles) in road space for lanes, world space otherwise
    vec2 pq = feat > 0.5 ? vec2(u, v) : wp;
    vec2 cell = floor(vec2(pq.x / 2.9 + 17.0, pq.y / 6.5));
    float rp = rh21(cell + 3.7);
    if (rp > 0.86) {
      vec2 f = vec2(fract(pq.x / 2.9 + 17.0), fract(pq.y / 6.5));
      vec2 fwp = (feat > 0.5 ? fwuv : fwWp * 0.8 + 1e-4) / vec2(2.9, 6.5);
      float inP = rangeW(f.x, 0.08 + 0.1 * rh21(cell), 0.92 - 0.1 * rh21(cell + 1.3), fwp.x) * rangeW(f.y, 0.1, 0.9 - 0.4 * rh21(cell + 2.1), fwp.y);
      c *= mix(1.0, rp > 0.95 ? 0.72 : 1.28, inP);
    }
    // tire tracks & oil drip lines on lane roads
    if (feat > 0.5 && feat < 1.5) {
      float c1 = 1.8, c2 = -99.0;
      if (kind > 3.5 && kind < 4.5) c1 = 2.4;
      else if (kind > 2.5 && kind < 3.5) { c1 = 2.5; c2 = 5.4; }
      else if (kind > 4.5) { c1 = 2.55; c2 = 5.75; }
      float tr = 0.0, oil = 0.0;
      for (int k = 0; k < 2; k++) {
        float lc = k == 0 ? c1 : c2;
        float dd = au - lc;
        float ta = (dd - 0.85) / 0.33, tb = (dd + 0.85) / 0.33, to = dd / 0.28;
        tr += exp(-ta * ta) + exp(-tb * tb);
        oil += exp(-to * to);
      }
      c *= 1.0 - 0.1 * tr * (0.6 + 0.4 * sN);
      c *= 1.0 - 0.16 * oil * rnoise(vec2(u * 3.0, v * 0.9));
      rough -= 0.08 * tr;
    }
    // cracks
    float cr = abs(rnoise(wp * 0.7 + 11.0) - 0.5);
    float crw = fwidth(cr) + 0.004;
    c *= 1.0 - 0.2 * (1.0 - smoothstep(0.0, crw, cr - 0.004)) * distFade * step(0.68, rnoise(wp * 0.17 + 3.0));

    // ---------------------------------------------------------------- markings
    float white = 0.0, yellow = 0.0;
    float vloc = v - 16.0 * floor(v / 16.0);
    float nearEnd = 0.0;
    if (feat > 0.5 && feat < 1.5) {
      float zoneMin = mod(wf, 2.0) > 0.5 ? 1.0 - step(4.4, vloc) : 0.0;
      float zoneMax = mod(floor(wf / 2.0), 2.0) > 0.5 ? 1.0 - step(4.4, 16.0 - vloc) : 0.0;
      nearEnd = max(zoneMin, zoneMax);
      if (kind > 1.5 && kind < 2.5) {
        // (dashed centre line, solid near intersections)
        yellow += band(u, 0.0, 0.075, fwU) * mix(dashes(v, 9.0, 0.45, fwv), 1.0, nearEnd);
        white += band(au, 3.55, 0.07, fwU);
      } else if (kind > 3.5 && kind < 4.5) {
        white += band(u, 0.0, 0.07, fwU) * dashes(v, 9.0, 0.4, fwv) * (1.0 - nearEnd);
        white += band(au, 4.62, 0.08, fwU);
        float vl = vloc - 8.0;
        white += arrowMask(u - 2.4, vl, fwU, fwv) + arrowMask(u + 2.4, vl, fwU, fwv);
      } else if (kind > 2.5 && kind < 3.5) {
        yellow += band(au, 1.2, 0.075, fwU);
        white += band(au, 3.95, 0.07, fwU) * dashes(v, 9.0, 0.4, fwv) * (1.0 - nearEnd);
        white += band(au, 6.45, 0.08, fwU);
      } else if (kind > 4.5) {
        // highway: white solid inner and outer edge lines, long white lane dashes (3 m on / 9 m off), lighter
        // shoulder strips outside the edge lines with rumble grooves (no yellow: it read as an avenue)
        white += band(au, 0.95, 0.1, fwU);
        white += band(au, 4.15, 0.08, fwU) * dashes(v, 12.0, 0.25, fwv);
        float rampSide = u > 0.0 ? mod(floor(wf / 4.0), 2.0) : mod(floor(wf / 8.0), 2.0);
        white += rampSide > 0.5 ? band(au, 7.32, 0.16, fwU) * dashes(v, 4.0, 0.5, fwv) : band(au, 7.32, 0.1, fwU);
        float sh = rangeW(au, 0.3, 0.84, fwU) + rangeW(au, 7.44, 7.72, fwU);
        float rumble = 1.0 - 0.18 * rangeW(fract(v / 0.55), 0.0, 0.4, fwv / 0.55) * distFade;
        c = mix(c, c * 1.35 * rumble + 0.004, clamp(sh, 0.0, 1.0));
      }
      // crosswalks + stop lines
      if (kind < 4.5) {
        float inW = clamp((aw - 0.4 - au) * 5.0 + 0.5, 0.0, 1.0);
        float zfw = fwU / 1.1;
        float zq = fract(u / 1.1 + 0.25);
        float zebra = rangeW(zq, 0.0, 0.5, zfw) + rangeW(zq, 1.0, 1.5, zfw);
        zebra = mix(0.5, zebra, clamp(1.0 - zfw * 5.0, 0.0, 1.0));
        float avenue = kind > 3.5 ? 1.0 : 0.0;
        if (mod(wf, 2.0) > 0.5) {
          white += rangeW(vloc, 0.6, 3.5, fwv) * zebra * inW;
          white += rangeW(vloc, 3.9, 4.35, fwv) * rangeW(-u, 0.12, aw - 0.3, fwU) * (1.0 - avenue);
        }
        if (mod(floor(wf / 2.0), 2.0) > 0.5) {
          white += rangeW(16.0 - vloc, 0.6, 3.5, fwv) * zebra * inW;
          white += rangeW(16.0 - vloc, 3.9, 4.35, fwv) * mix(rangeW(u, 0.12, aw - 0.3, fwU), inW, avenue);
        }
      }
    } else if (feat > 2.5 && feat < 3.5) {
      // rail level crossing: stop lines both approaches, edge lines
      white += rangeW(vloc, 3.0, 3.4, fwv) * rangeW(u, 0.1, aw - 0.3, fwU);
      white += rangeW(16.0 - vloc, 3.0, 3.4, fwv) * rangeW(-u, 0.1, aw - 0.3, fwU);
      yellow += band(u, 0.0, 0.075, fwU) * (1.0 - rangeW(vloc, 5.5, 10.5, fwv));
    }
    float wear = 0.5 + 0.5 * smoothstep(0.2, 0.65, rnoise(wp * 1.7 + 5.0));
    white = clamp(white, 0.0, 1.0) * wear;
    yellow = clamp(yellow, 0.0, 1.0) * wear;
    c = mix(c, vec3(0.62, 0.62, 0.6), white);
    c = mix(c, vec3(0.62, 0.42, 0.05), yellow);
    rough = mix(rough, 0.62, max(white, yellow));
    albedo = c;
    metal = 0.0;
  } else if (mat < 1.5) {
    // ---------------------------------------------------------------- sidewalk
    vec3 c = vec3(0.30, 0.295, 0.28);
    c *= 0.86 + 0.24 * sN;
    c *= mix(1.0, 0.9 + 0.2 * sF, distFade);
    vec2 jc = feat > 0.5 ? vec2(u, v) : wp;
    float jx = abs(fract(jc.x / 2.0) - 0.5), jy = abs(fract(jc.y / 2.0) - 0.5);
    vec2 fwj = feat > 0.5 ? fwuv : fwWp * 0.8 + 1e-4;
    float jw = (fwj.x + fwj.y) * 0.625 + 0.004;
    float joint = clamp((max(jx, jy) - 0.485 + jw) / (jw + 0.01), 0.0, 1.0);
    c *= 1.0 - 0.28 * joint * distFade;
    rough = 0.88;
    if (feat > 0.5) {
      // curb top strip
      float sw = kind > 4.5 ? 5.0 : aw;
      c = mix(c, vec3(0.36, 0.355, 0.34), clamp((sw + 0.25 - au) * 20.0, 0.0, 1.0));
      if (kind < 1.5) {
        // street: grass verge between curb and sidewalk, and behind it
        float g = rangeW(au, sw + 0.25, 5.3, fwU) + rangeW(au, 7.55, 8.2, fwU);
        vec3 grass = roadGrass(vec3(0.075, 0.13, 0.035) * (0.75 + 0.5 * sN) * (0.9 + 0.2 * sF));
        c = mix(c, grass, g);
        rough = mix(rough, 0.95, g);
      } else if (kind > 1.5 && kind < 2.5) {
        // road: square tree pits every 12 m
        float vp = fract((v + 3.0) / 12.0) * 12.0;
        float pit = rangeW(au, sw + 0.6, sw + 1.8, fwU) * rangeW(vp, 0.02, 1.2, fwv);
        c = mix(c, vec3(0.06, 0.045, 0.03) * (0.8 + 0.4 * sF), pit);
      }
    }
    albedo = c;
    metal = 0.0;
  } else if (mat < 2.5) {
    // curb
    albedo = vec3(0.36, 0.355, 0.34) * (0.85 + 0.25 * sN);
    rough = 0.85; metal = 0.0;
  } else if (mat < 3.5) {
    // grass (median)
    vec3 c = vec3(0.07, 0.125, 0.035) * (0.72 + 0.55 * sN) * (0.88 + 0.24 * sF);
    albedo = roadGrass(c); rough = 0.95; metal = 0.0;
  } else if (mat < 4.5) {
    // ballast gravel
    float g = sF * 0.55 + rnoise(wp * 37.0) * 0.45;
    vec3 c = vec3(0.17, 0.16, 0.15) * (0.55 + 0.75 * mix(0.5, g, distFade));
    c *= 0.85 + 0.3 * sN;
    if (feat > 0.5) c *= vec3(1.05, 0.98, 0.9);
    albedo = c; rough = 0.97; metal = 0.0;
  } else if (mat < 5.5) {
    // sleepers (concrete)
    albedo = vec3(0.22, 0.215, 0.2) * (0.8 + 0.35 * sF);
    rough = 0.85; metal = 0.0;
  } else if (mat < 6.5) {
    // steel rail: polished top, rusty sides
    if (wf > 0.5) { albedo = vec3(0.58, 0.58, 0.6); rough = 0.22; metal = 1.0; }
    else { albedo = vec3(0.16, 0.1, 0.07); rough = 0.7; metal = 0.3; }
  } else if (mat < 7.5) {
    // concrete (bridges, piers, portals) with faint vertical rain stains
    vec3 c = vec3(0.3, 0.295, 0.28) * (0.8 + 0.3 * sN);
    if (wf > 0.5) c *= 1.12;
    c *= 0.92 + 0.08 * sF;
    albedo = c; rough = 0.9; metal = 0.0;
  } else if (mat < 8.5) {
    albedo = vec3(0.12, 0.09, 0.06) * (0.8 + 0.4 * sN); rough = 1.0; metal = 0.0;
  } else if (mat < 9.5) {
    if (feat > 1.5) {
      // painted structural steel (bridge arches)
      albedo = vec3(0.16, 0.28, 0.36) * (0.85 + 0.25 * sN);
      rough = 0.45; metal = 0.55;
    } else {
      // painted metal (buffer stops): red / white stripes
      float s = step(0.5, fract((vWp.y + wp.x + wp.y) * 1.2));
      albedo = mix(vec3(0.5, 0.04, 0.03), vec3(0.6), s * feat);
      rough = 0.5; metal = 0.3;
    }
  } else if (mat < 10.5) {
    // crossing panels
    vec3 c = vec3(0.26, 0.255, 0.245) * (0.82 + 0.3 * sN);
    float j = abs(fract((wp.x + wp.y) / 2.4) - 0.5);
    c *= 1.0 - 0.3 * clamp((j - 0.47) * 50.0, 0.0, 1.0) * distFade;
    albedo = c; rough = 0.9; metal = 0.0;
  } else if (mat < 11.5) {
    // verge (highway shoulders beyond the barrier)
    vec3 grass = vec3(0.08, 0.12, 0.04) * (0.7 + 0.6 * sN);
    albedo = roadGrass(grass); rough = 0.95; metal = 0.0;
  } else if (mat < 12.5) {
    // jersey barrier
    vec3 c = vec3(0.38, 0.375, 0.36) * (0.85 + 0.2 * sN);
    float j = abs(fract((wp.x + wp.y) / 6.0) - 0.5);
    c *= 1.0 - 0.35 * clamp((j - 0.485) * 100.0, 0.0, 1.0) * distFade;
    albedo = c; rough = 0.85; metal = 0.0;
  } else if (mat < 13.5) {
    // tunnel opening
    albedo = vec3(0.004); rough = 1.0; metal = 0.0;
  } else if (mat < 14.5) {
    // highway gantry sign: green retroreflective panel, white border, a route shield and two rows of "legend"
    // blocks (words with letter gaps at close range); feat 1 = galvanized back / edges
    if (feat > 0.5) {
      albedo = vec3(0.3, 0.31, 0.32) * (0.85 + 0.2 * sN);
      rough = 0.45; metal = 0.6;
    } else {
      float W = max(mod(wf, 1000.0) / 10.0, 1.0), H = 2.2;
      float px = u, py = v;
      float fw = max(fwU, fwv);
      float seed = rh21(floor(wp / 16.0) + floor(wf / 1000.0) * 7.3);
      vec3 green = vec3(0.012, 0.085, 0.032);
      float ring = rangeW(px, 0.07, W - 0.07, fw) * rangeW(py, 0.07, H - 0.07, fw) * (1.0 - rangeW(px, 0.13, W - 0.13, fw) * rangeW(py, 0.13, H - 0.13, fw));
      // route shield (white square with a dark numeral block)
      float shield = rangeW(px, 0.35, 1.05, fw) * rangeW(py, 0.75, 1.5, fw);
      float numeral = rangeW(px, 0.52, 0.88, fw) * rangeW(py, 0.92, 1.33, fw);
      // legend rows: words of random length, letter gaps every 0.13 m when resolvable
      float legend = 0.0;
      float wx = (px - 1.35) / 1.25;
      float wi = floor(wx);
      float inWord = step(0.0, wx) * step(px, W - 0.3);
      float lf = fwU / 0.13;
      float letters = mix(0.7, rangeW(fract(px / 0.13), 0.12, 0.88, lf), clamp(1.0 - lf * 4.0, 0.0, 1.0));
      for (int r = 0; r < 2; r++) {
        float y0 = r == 0 ? 1.28 : 0.62;
        float wh = rh21(vec2(wi, float(r) * 3.1 + seed * 17.0));
        float word = rangeW(fract(wx), 0.0, 0.45 + 0.45 * wh, fwU / 1.25) * step(0.15, wh);
        legend += rangeW(py, y0, y0 + 0.32, fw) * word;
      }
      legend *= inWord * letters;
      float white = clamp(ring + shield * (1.0 - numeral) + legend, 0.0, 1.0);
      albedo = mix(green, vec3(0.7, 0.72, 0.7), white);
      rough = 0.55; metal = 0.0;
      // sign lighting at night (retroreflective legend + gantry lamps)
      emis += (green * 0.6 + vec3(0.55, 0.58, 0.55) * white) * uNight * 0.35;
    }
  } else if (mat < 15.5) {
    // galvanized steel (gantry posts / beams)
    albedo = vec3(0.4, 0.41, 0.42) * (0.82 + 0.25 * sN);
    rough = 0.42; metal = 0.75;
  } else {
    albedo = vec3(0.004); rough = 1.0; metal = 0.0;
  }

  // street lighting: the chain of lamps along a lit road (every cell of streets / roads / avenues / one-ways,
  // median lamps on highways) reads as one continuous lit ribbon, brightest along the carriageway and fading over the
  // outer sidewalk; warm sodium amber for most of the city, white LED on highways and in the re-lamped districts (as
  // the lamp heads / pools); a road hierarchy: avenues / one-way arterials brighter, local streets dimmer. The light
  // pools (PropRenderer) add the per-lamp spots up close.
  if (uLamps > 0.002 && kind > 0.5 && kind < 5.5 && (mat < 3.5 || (mat > 9.5 && mat < 11.5))) {
    float isLed = max(step(${LAMP_LED_BIT - 0.5}, floor(vRd.z + 0.5)), step(4.5, kind));
    vec3 lampC = isLed > 0.5 ? vec3(0.7, 0.68, 0.6) * 0.75 : vec3(1.0, 0.55, 0.2);
    float lat = 1.0 - 0.5 * smoothstep(0.55, 1.0, au / (aw + 3.2));
    float k = kind < 1.5 ? 0.7 : (kind < 2.5 ? 1.0 : (kind < 3.5 ? 1.4 : (kind < 4.5 ? 1.15 : 1.3)));
    // lighter surfaces (sidewalks, curbs) return more of the light than asphalt
    float refl = 0.75 + 1.8 * dot(albedo, vec3(0.3, 0.59, 0.11));
    // far away a road is a 1-3 px line blended with the dark lots beside it: its ribbon gets brighter as the light pools /
    // lamp heads fade with the camera distance (PropRenderer, lampUniforms.uPoolFade), so the lit network still reads
    // and the street lighting keeps its brightness while zooming out; arterials up to 2x, local streets less (a uniform
    // boost turned the far city into an even amber waffle: the road hierarchy keeps the main roads as the lit frame)
    float farB = 1.0 + smoothstep(uPoolFade.x, uPoolFade.y, vViewPosition.z) * (kind < 1.5 ? 0.35 : (kind < 2.5 ? 0.7 : 1.0));
    emis += lampC * uLampRibbon * k * lat * refl * farB * uLamps * (1.0 - 0.8 * uRoadOverlay);
  }

  // data-view overlay: desaturate + lift
  float lum = dot(albedo, vec3(0.3, 0.59, 0.11));
  albedo = mix(albedo, vec3(lum) * 0.8 + 0.03, uRoadOverlay * 0.7);
  albedo *= 1.0 - 0.6 * uRoadDim;
}
`;

let _mat: THREE.MeshStandardMaterial | null = null;

export function getRoadMaterial(): THREE.MeshStandardMaterial {
  if (_mat) return _mat;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -2;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = sharedUniforms.uNight;
    shader.uniforms.uLamps = sharedUniforms.uLamps;
    shader.uniforms.uLampRibbon = roadUniforms.uLampRibbon;
    shader.uniforms.uPoolFade = lampUniforms.uPoolFade;
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uRoadOverlay = roadUniforms.uRoadOverlay;
    shader.uniforms.uRoadDim = roadUniforms.uRoadDim;
    shader.uniforms.uFoliageDry = sharedUniforms.uFoliageDry;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        vec3 _roadEmis = vec3(0.0);
        {
          vec3 _a = diffuseColor.rgb; float _r = roughnessFactor; float _m = metalnessFactor; vec3 _e = vec3(0.0);
          roadSurface(_a, _r, _m, _e, vec3(0.0, 1.0, 0.0));
          diffuseColor.rgb = _a; roughnessFactor = _r; metalnessFactor = _m;
          _roadEmis = _e * (1.0 - 0.6 * uRoadDim);
        }`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += _roadEmis;');
  };
  m.customProgramCacheKey = () => 'city-road-v4';
  _mat = m;
  return m;
}
