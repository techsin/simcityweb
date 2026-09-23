/**
 * Road "uber" material: one patched MeshStandardMaterial for all network geometry (asphalt, markings, sidewalks,
 * curbs, medians, ballast, sleepers, rails, bridges, barriers). Surface type + road coordinates come from the `rd`
 * vertex attribute (see geobuf.ts / mesher.ts). All markings, wear, patches and cracks are procedural (world-space
 * noise), so there are no textures and one draw call per chunk.
 */
import * as THREE from 'three';
import { sharedUniforms } from '../../../assets/materials';

export const roadUniforms = {
  /** 0..1: data-view overlay active (desaturate) */
  uRoadOverlay: { value: 0 },
  /** 0..1: underground view (dim the surface) */
  uRoadDim: { value: 0 },
};

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
uniform float uTime;
uniform float uRoadOverlay;
uniform float uRoadDim;

float rh21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float rnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh21(i), rh21(i + vec2(1.0, 0.0)), f.x), mix(rh21(i + vec2(0.0, 1.0)), rh21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float rfbm(vec2 p) { return rnoise(p) * 0.5 + rnoise(p * 2.03 + 7.1) * 0.3 + rnoise(p * 4.1 + 3.3) * 0.2; }
// anti-aliased band |x - c| < hw
float band(float x, float c, float hw) {
  float fw = fwidth(x) * 0.8 + 1e-4;
  return 1.0 - smoothstep(hw - fw, hw + fw, abs(x - c));
}
// 1 inside [a,b]
float range1(float x, float a, float b) {
  float fw = fwidth(x) * 0.8 + 1e-4;
  return smoothstep(a - fw, a + fw, x) * (1.0 - smoothstep(b - fw, b + fw, x));
}
float dashes(float v, float period, float duty) {
  float x = v / period;
  float f = fract(x);
  float fw = fwidth(x) * 0.8 + 1e-4;
  float m = smoothstep(0.0, fw, f) * (1.0 - smoothstep(duty - fw, duty + fw, f));
  // fade dashes to their average when too small on screen
  float fade = clamp(1.0 - fw * 6.0, 0.0, 1.0);
  return mix(duty, m, fade);
}
float arrowMask(float ul, float vl) {
  float fw = max(fwidth(ul), fwidth(vl)) * 0.8 + 1e-4;
  float shaft = (1.0 - smoothstep(0.12 - fw, 0.12 + fw, abs(ul))) * range1(vl, -2.6, 0.7);
  float hw = (2.3 - vl) * 0.45;
  float head = (1.0 - smoothstep(hw - fw, hw + fw, abs(ul))) * range1(vl, 0.6, 2.3);
  return clamp(shaft + head, 0.0, 1.0);
}

void roadSurface(inout vec3 albedo, inout float rough, inout float metal, inout vec3 emis, vec3 nrm) {
  float code = floor(vRd.z + 0.5);
  float mat = floor(code / 64.0);
  float kind = floor(mod(code, 64.0) / 8.0);
  float feat = mod(code, 8.0);
  float u = vRd.x;
  float v = vRd.y;
  float wf = floor(vRd.w + 0.5);
  vec2 wp = vWp.xz;
  float au = abs(u);
  float distFade = clamp(1.0 - length(fwidth(wp)) * 0.35, 0.0, 1.0);

  if (mat < 0.5) {
    // ---------------------------------------------------------------- asphalt
    float n1 = rfbm(wp * 0.035);
    float n2 = rnoise(wp * 0.55);
    float grain = rnoise(wp * 6.0) * 0.6 + rnoise(wp * 17.0) * 0.4;
    vec3 base = vec3(0.052, 0.054, 0.058);
    if (kind > 4.5 && kind < 5.5) base = vec3(0.06, 0.061, 0.064);
    vec3 c = base * (0.78 + 0.42 * n1) * (0.93 + 0.14 * n2);
    c *= mix(1.0, 0.82 + 0.36 * grain, distFade);
    rough = 0.9;
    // repair patches (rectangles) in road space for lanes, world space otherwise
    vec2 pq = feat > 0.5 ? vec2(u, v) : wp;
    vec2 cell = floor(vec2(pq.x / 2.9 + 17.0, pq.y / 6.5));
    float rp = rh21(cell + 3.7);
    if (rp > 0.86) {
      vec2 f = vec2(fract(pq.x / 2.9 + 17.0), fract(pq.y / 6.5));
      float inP = range1(f.x, 0.08 + 0.1 * rh21(cell), 0.92 - 0.1 * rh21(cell + 1.3)) * range1(f.y, 0.1, 0.9 - 0.4 * rh21(cell + 2.1));
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
        tr += exp(-pow((dd - 0.85) / 0.33, 2.0)) + exp(-pow((dd + 0.85) / 0.33, 2.0));
        oil += exp(-pow(dd / 0.28, 2.0));
      }
      c *= 1.0 - 0.1 * tr * (0.6 + 0.4 * n2);
      c *= 1.0 - 0.16 * oil * rnoise(vec2(u * 3.0, v * 0.9));
      rough -= 0.08 * tr;
    }
    // cracks
    float cr = abs(rnoise(wp * 0.7 + 11.0) - 0.5);
    float crw = fwidth(cr) + 0.004;
    c *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, crw, cr - 0.006)) * distFade * step(0.55, rnoise(wp * 0.21));

    // ---------------------------------------------------------------- markings
    float white = 0.0, yellow = 0.0;
    float vloc = v - 16.0 * floor(v / 16.0);
    float aw = kind < 1.5 ? 3.6 : (kind < 2.5 ? 5.0 : (kind < 3.5 ? 6.8 : (kind < 4.5 ? 5.0 : 8.0)));
    float nearEnd = 0.0;
    if (feat > 0.5 && feat < 1.5) {
      float zoneMin = mod(wf, 2.0) > 0.5 ? 1.0 - step(4.4, vloc) : 0.0;
      float zoneMax = mod(floor(wf / 2.0), 2.0) > 0.5 ? 1.0 - step(4.4, 16.0 - vloc) : 0.0;
      nearEnd = max(zoneMin, zoneMax);
      if (kind > 1.5 && kind < 2.5) {
        yellow += band(u, 0.0, 0.075) * dashes(v, 9.0, 0.45) * (1.0 - nearEnd);
        yellow += band(u, 0.0, 0.075) * nearEnd; // solid near intersections
        white += band(au, 3.55, 0.07);
      } else if (kind > 3.5 && kind < 4.5) {
        white += band(u, 0.0, 0.07) * dashes(v, 9.0, 0.4) * (1.0 - nearEnd);
        white += band(au, 4.62, 0.08);
        float vl = vloc - 8.0;
        white += arrowMask(u - 2.4, vl) + arrowMask(u + 2.4, vl);
      } else if (kind > 2.5 && kind < 3.5) {
        yellow += band(au, 1.2, 0.075);
        white += band(au, 3.95, 0.07) * dashes(v, 9.0, 0.4) * (1.0 - nearEnd);
        white += band(au, 6.45, 0.08);
      } else if (kind > 4.5) {
        yellow += band(au, 0.95, 0.085);
        white += band(au, 4.2, 0.08) * dashes(v, 12.0, 0.33);
        white += band(au, 7.32, 0.09);
      }
      // crosswalks + stop lines
      if (kind < 4.5 || (kind > 3.5 && kind < 4.5)) {
        float inW = 1.0 - smoothstep(aw - 0.5, aw - 0.3, au);
        float zebra = range1(fract(u / 1.1 + 0.25), 0.0, 0.5) ;
        float zfade = clamp(1.0 - fwidth(u / 1.1) * 4.0, 0.0, 1.0);
        zebra = mix(0.5, zebra, zfade);
        if (mod(wf, 2.0) > 0.5) {
          white += range1(vloc, 0.6, 3.5) * zebra * inW;
          if (kind > 3.5 && kind < 4.5) {} else white += range1(vloc, 3.9, 4.35) * range1(-u, 0.12, aw - 0.3);
        }
        if (mod(floor(wf / 2.0), 2.0) > 0.5) {
          white += range1(16.0 - vloc, 0.6, 3.5) * zebra * inW;
          if (kind > 3.5 && kind < 4.5) white += range1(16.0 - vloc, 3.9, 4.35) * inW;
          else white += range1(16.0 - vloc, 3.9, 4.35) * range1(u, 0.12, aw - 0.3);
        }
      }
    } else if (feat > 2.5 && feat < 3.5) {
      // rail level crossing: stop lines both approaches, edge lines
      white += range1(vloc, 3.0, 3.4) * range1(u, 0.1, aw - 0.3);
      white += range1(16.0 - vloc, 3.0, 3.4) * range1(-u, 0.1, aw - 0.3);
      yellow += band(u, 0.0, 0.075) * (1.0 - range1(vloc, 5.5, 10.5));
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
    float n = rfbm(wp * 0.35);
    c *= 0.86 + 0.24 * n;
    c *= mix(1.0, 0.9 + 0.2 * rnoise(wp * 9.0), distFade);
    vec2 jc = feat > 0.5 ? vec2(u, v) : wp;
    float jx = abs(fract(jc.x / 2.0) - 0.5), jy = abs(fract(jc.y / 2.0) - 0.5);
    float jw = fwidth(jc.x / 2.0) + fwidth(jc.y / 2.0) + 0.004;
    float joint = max(smoothstep(0.485 - jw, 0.495, jx), smoothstep(0.485 - jw, 0.495, jy));
    c *= 1.0 - 0.28 * joint * distFade;
    rough = 0.88;
    if (feat > 0.5) {
      float aw = kind < 1.5 ? 3.6 : (kind < 2.5 ? 5.0 : (kind < 3.5 ? 6.8 : 5.0));
      // curb top strip
      c = mix(c, vec3(0.36, 0.355, 0.34), 1.0 - smoothstep(aw + 0.2, aw + 0.25, au));
      if (kind < 1.5) {
        // street: grass verge between curb and sidewalk, and behind it
        float g = range1(au, aw + 0.25, 5.3) + range1(au, 7.55, 8.2);
        vec3 grass = vec3(0.075, 0.13, 0.035) * (0.75 + 0.5 * rfbm(wp * 0.6)) * (0.9 + 0.2 * rnoise(wp * 7.0));
        c = mix(c, grass, g);
        rough = mix(rough, 0.95, g);
      } else if (kind > 1.5 && kind < 2.5) {
        // road: square tree pits every 12 m
        float vp = fract((v + 3.0) / 12.0) * 12.0;
        float pit = range1(au, aw + 0.6, aw + 1.8) * range1(vp, 0.0, 1.2);
        c = mix(c, vec3(0.06, 0.045, 0.03) * (0.8 + 0.4 * rnoise(wp * 5.0)), pit);
      }
    }
    albedo = c;
    metal = 0.0;
  } else if (mat < 2.5) {
    // curb
    albedo = vec3(0.36, 0.355, 0.34) * (0.85 + 0.25 * rfbm(wp * 0.8 + vWp.y));
    rough = 0.85; metal = 0.0;
  } else if (mat < 3.5) {
    // grass (median)
    vec3 c = vec3(0.07, 0.125, 0.035) * (0.72 + 0.55 * rfbm(wp * 0.5)) * (0.88 + 0.24 * rnoise(wp * 8.0));
    // edge of median: small concrete lip
    albedo = c; rough = 0.95; metal = 0.0;
  } else if (mat < 4.5) {
    // ballast gravel
    float g = rnoise(wp * 14.0) * 0.55 + rnoise(wp * 37.0) * 0.45;
    vec3 c = vec3(0.17, 0.16, 0.15) * (0.55 + 0.75 * mix(0.5, g, distFade));
    c *= 0.85 + 0.3 * rfbm(wp * 0.3);
    if (feat > 0.5) c *= vec3(1.05, 0.98, 0.9);
    albedo = c; rough = 0.97; metal = 0.0;
  } else if (mat < 5.5) {
    // sleepers (concrete)
    albedo = vec3(0.22, 0.215, 0.2) * (0.8 + 0.35 * rnoise(wp * 3.0 + vWp.y * 2.0));
    rough = 0.85; metal = 0.0;
  } else if (mat < 6.5) {
    // steel rail: polished top, rusty sides
    if (wf > 0.5) { albedo = vec3(0.58, 0.58, 0.6); rough = 0.22; metal = 1.0; }
    else { albedo = vec3(0.16, 0.1, 0.07); rough = 0.7; metal = 0.3; }
  } else if (mat < 7.5) {
    // concrete (bridges, piers, portals)
    float n = rfbm(wp * 0.25 + vec2(vWp.y * 0.3, 0.0));
    vec3 c = vec3(0.3, 0.295, 0.28) * (0.8 + 0.3 * n);
    if (wf > 0.5) c *= 1.12;
    // vertical rain stains
    c *= 0.92 + 0.08 * rnoise(vec2(wp.x + wp.y, vWp.y * 0.15) * vec2(1.3, 1.0));
    albedo = c; rough = 0.9; metal = 0.0;
  } else if (mat < 8.5) {
    albedo = vec3(0.12, 0.09, 0.06) * (0.8 + 0.4 * rfbm(wp * 0.5)); rough = 1.0; metal = 0.0;
  } else if (mat < 9.5) {
    // painted metal (buffer stops): red / white stripes
    float s = step(0.5, fract((vWp.y + wp.x + wp.y) * 1.2));
    albedo = mix(vec3(0.5, 0.04, 0.03), vec3(0.6), s * feat);
    rough = 0.5; metal = 0.3;
  } else if (mat < 10.5) {
    // crossing panels
    vec3 c = vec3(0.26, 0.255, 0.245) * (0.82 + 0.3 * rfbm(wp * 0.6));
    float j = abs(fract((wp.x + wp.y) / 2.4) - 0.5);
    c *= 1.0 - 0.3 * smoothstep(0.47, 0.49, j) * distFade;
    albedo = c; rough = 0.9; metal = 0.0;
  } else if (mat < 11.5) {
    // verge (highway shoulders beyond the barrier)
    vec3 grass = vec3(0.08, 0.12, 0.04) * (0.7 + 0.6 * rfbm(wp * 0.4));
    albedo = grass; rough = 0.95; metal = 0.0;
  } else if (mat < 12.5) {
    // jersey barrier
    vec3 c = vec3(0.38, 0.375, 0.36) * (0.85 + 0.2 * rfbm(wp * 0.7));
    float j = abs(fract((wp.x + wp.y) / 6.0) - 0.5);
    c *= 1.0 - 0.35 * smoothstep(0.485, 0.495, j) * distFade;
    albedo = c; rough = 0.85; metal = 0.0;
  } else {
    albedo = vec3(0.004); rough = 1.0; metal = 0.0;
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
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uRoadOverlay = roadUniforms.uRoadOverlay;
    shader.uniforms.uRoadDim = roadUniforms.uRoadDim;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        {
          vec3 _a = diffuseColor.rgb; float _r = roughnessFactor; float _m = metalnessFactor; vec3 _e = vec3(0.0);
          roadSurface(_a, _r, _m, _e, vec3(0.0, 1.0, 0.0));
          diffuseColor.rgb = _a; roughnessFactor = _r; metalnessFactor = _m;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'city-road-v1';
  _mat = m;
  return m;
}
