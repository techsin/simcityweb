/**
 * GLSL for the terrain material (patched MeshStandardMaterial). Everything is derived from world position:
 * climate palettes, macro/micro noise, forest floor from the tree density texture, rock on slopes (triplanar),
 * beaches / wet sand / seabed, snow, zone tint, data overlay heatmap, grid, tool highlights, brush, map border.
 */

export const TERRAIN_VERT_PARS = /* glsl */ `
varying vec3 vTW;
varying vec3 vTN;
`;

export const TERRAIN_VERT_MAIN = /* glsl */ `
vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTN = normalize(mat3(modelMatrix) * objectNormal);
`;

export const TERRAIN_FRAG_PARS = /* glsl */ `
varying vec3 vTW;
varying vec3 vTN;
uniform sampler2D uNoise;
uniform sampler2D uTreeTex;
uniform highp usampler2D uZoneTexU;
uniform sampler2D uOverlayTex;
uniform sampler2D uRamp;
uniform sampler2D uHlTex;
uniform vec3 uPal[12];
uniform vec3 uZoneCol[11];
uniform float uN;
uniform float uCell;
uniform float uSnowLine;
uniform float uZoneMode;
uniform float uOverlayOn;
uniform float uGrid;
uniform float uHlOn;
uniform vec4 uRect;
uniform vec3 uRectColor;
uniform float uRectOn;
uniform vec4 uBrush;
uniform float uNightF;
uniform float uDesert;

vec3 tEmis = vec3(0.0);
float tRough = 0.92;
vec3 tNormalW = vec3(0.0, 1.0, 0.0);

vec3 tPerturb(vec3 pos, vec3 n, float hgt) {
  vec3 sx = dFdx(pos);
  vec3 sy = dFdy(pos);
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1);
  float dbx = dFdx(hgt);
  float dby = dFdy(hgt);
  vec3 grad = sign(det) * (dbx * r1 + dby * r2);
  return normalize(abs(det) * n - grad);
}

float tLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

int tZoneAt(ivec2 c) {
  ivec2 cc = clamp(c, ivec2(0), ivec2(int(uN) - 1));
  return int(texelFetch(uZoneTexU, cc, 0).r);
}

vec3 terrainShade(vec3 P, vec3 N) {
  float h = P.y;
  float slope = 1.0 - clamp(N.y, 0.0, 1.0);
  vec2 xz = P.xz;
  vec4 nA = texture2D(uNoise, xz / 3100.0);
  vec4 nB = texture2D(uNoise, xz / 520.0);
  vec4 nC = texture2D(uNoise, xz / 57.0);
  float m1 = nA.r;
  float m2 = nB.g;
  float m3 = nC.b;
#if TERRAIN_DETAIL > 0
  vec4 nD = texture2D(uNoise, xz / 8.7);
  float m4 = nD.b;
#else
  float m4 = 0.5;
#endif
  float bump = 0.0;

  // --- grass / ground cover
  float dry = smoothstep(0.4, 0.75, m1 + (m2 - 0.5) * 0.5 + (nC.r - 0.5) * 0.25);
  vec3 col = mix(uPal[0], uPal[1], dry);
  // darker lush meadows / hollows
  col = mix(col, uPal[2], smoothstep(0.5, 0.75, nB.r + (nC.g - 0.5) * 0.3) * 0.6);
  // patchwork of slightly different meadows (cellular) - breaks the "golf course" look
  float patchN = texture2D(uNoise, xz / 1400.0 + 0.37).a;
  vec3 hueShift = mix(vec3(1.06, 1.0, 0.86), vec3(0.9, 1.02, 1.08), smoothstep(0.2, 0.8, nA.b));
  col *= mix(vec3(1.0), hueShift, smoothstep(0.25, 0.65, patchN));
  col *= 0.8 + 0.36 * m3;
  col *= 0.88 + 0.24 * m4;
  // meadow flecks (tiny lighter / darker grass tufts)
  col *= 0.93 + 0.14 * smoothstep(0.5, 0.8, nC.a);
  bump += (m4 - 0.5) * 0.3 + (m3 - 0.5) * 0.6;

  // forest floor under trees (keeps forests readable from far away)
  vec2 tuv = xz / (uCell * uN);
  float trees = texture2D(uTreeTex, tuv).r;
  // outside the map: fade the (clamped) texture out and continue with noise forests
  vec2 tout = max(-tuv, tuv - 1.0);
  float outside = smoothstep(0.0, 0.03, max(tout.x, tout.y));
  trees = mix(trees, smoothstep(0.55, 0.7, nA.g * 0.6 + nB.r * 0.5) * 0.8, outside);
  float forest = smoothstep(0.03, 0.55, trees);
  col = mix(col, uPal[3] * (0.85 + 0.3 * m3), forest * 0.82);

  // dirt patches, stronger on moderate slopes and in dry areas
  float dirtM = smoothstep(0.66, 0.86, nB.b * 0.45 + nC.g * 0.35 + slope * 1.8 + dry * 0.12 - forest * 0.3);
  col = mix(col, uPal[4] * (0.85 + 0.3 * m4), dirtM * 0.6);

  // desert: wind-rippled sand dunes across flat ground
  if (uDesert > 0.5) {
    float ripple = sin(dot(xz, vec2(0.71, 0.7)) * 0.9 + m3 * 9.0) * 0.5 + 0.5;
    col *= 0.95 + 0.07 * ripple * (1.0 - slope * 3.0);
    bump += ripple * 0.08;
  }

  float rough = 0.93;

  // --- rock on steep slopes (triplanar noise + strata)
  float rockT = 0.2 + (m2 - 0.5) * 0.14 + (m4 - 0.5) * 0.05;
  float rockM = smoothstep(rockT, rockT + 0.1, slope);
  if (rockM > 0.001) {
    vec3 an = abs(N);
    an /= (an.x + an.y + an.z);
#if TERRAIN_DETAIL > 1
    float rx = texture2D(uNoise, P.zy / 21.0).b;
    float rz = texture2D(uNoise, P.xy / 21.0).b;
    float ry = texture2D(uNoise, P.xz / 21.0).b;
    float rn = rx * an.x + rz * an.z + ry * an.y;
    float cr = texture2D(uNoise, P.zy / 7.0).a * an.x + texture2D(uNoise, P.xy / 7.0).a * an.z + nC.a * an.y;
#else
    float rn = m3;
    float cr = 0.5;
#endif
    float strata = sin(P.y * 0.85 + rn * 5.0 + m2 * 8.0) * 0.5 + 0.5;
    vec3 rock = mix(uPal[5], uPal[6], smoothstep(0.3, 0.7, rn)) * (0.84 + 0.24 * strata);
    rock *= 0.8 + 0.35 * smoothstep(0.05, 0.4, cr);
    rock = mix(rock, uPal[11], smoothstep(0.42, 0.8, slope) * 0.55);
    col = mix(col, rock, rockM);
    rough = mix(rough, 0.82, rockM);
    bump += (rn * 1.6 + cr * 0.8 + strata * 0.4) * rockM;
  }

  // --- beaches, wet sand, seabed
  float sandTop = 1.5 + m3 * 1.7 + (m2 - 0.5) * 1.2;
  float sandM = (1.0 - smoothstep(sandTop - 0.5, sandTop + 0.5, h)) * (1.0 - rockM * 0.75);
  vec3 sand = uPal[7] * (0.93 + 0.12 * m4);
  col = mix(col, sand, sandM);
  float wet = 1.0 - smoothstep(0.05, 0.95, h);
  col = mix(col, uPal[8], wet * sandM);
  rough = mix(rough, 0.5, wet * sandM);
  float sub = smoothstep(-0.2, -3.5, h);
  col = mix(col, uPal[9] * (0.88 + 0.24 * m3), sub);
  bump *= 1.0 - sandM * 0.7;

  // --- snow
  float snowL = uSnowLine + (m2 - 0.5) * 45.0 + (m3 - 0.5) * 14.0;
  float snowM = smoothstep(snowL - 5.0, snowL + 5.0, h) * (1.0 - smoothstep(0.3, 0.55, slope));
  col = mix(col, uPal[10] * (0.95 + 0.06 * m4), snowM);
  rough = mix(rough, 0.55, snowM);

  // --- city layer (zones, overlays, tools) -----------------------------------------------------
  vec2 gc = xz / uCell;
  vec2 fwc = fwidth(gc);
  float fpx = max(fwc.x, fwc.y);
  bool inside = gc.x >= 0.0 && gc.y >= 0.0 && gc.x < uN && gc.y < uN;
  if (!inside) {
    float l = tLuma(col);
    col = mix(col, vec3(l), 0.18) * 0.9;
    vec2 dd = max(-gc, gc - uN);
    float dEdge = max(dd.x, dd.y);
    float border = 1.0 - smoothstep(0.0, max(fpx * 2.0, 0.08), dEdge);
    col = mix(col, vec3(0.92, 0.9, 0.8), border * 0.35);
  } else {
    ivec2 cell = ivec2(gc);
    vec2 f = fract(gc);
    // zones
    uvec4 zt = texelFetch(uZoneTexU, cell, 0);
    int zid = int(zt.r);
    bool dev = zt.g > 0u;
    if (zid > 0 && (!dev || uZoneMode > 0.5)) {
      vec3 zc = uZoneCol[zid];
      float w = 0.05 + fpx * 1.5;
      float eL = tZoneAt(cell + ivec2(-1, 0)) != zid ? 1.0 - smoothstep(0.0, w, f.x) : 0.0;
      float eR = tZoneAt(cell + ivec2(1, 0)) != zid ? 1.0 - smoothstep(0.0, w, 1.0 - f.x) : 0.0;
      float eT = tZoneAt(cell + ivec2(0, -1)) != zid ? 1.0 - smoothstep(0.0, w, f.y) : 0.0;
      float eB = tZoneAt(cell + ivec2(0, 1)) != zid ? 1.0 - smoothstep(0.0, w, 1.0 - f.y) : 0.0;
      float outline = max(max(eL, eR), max(eT, eB));
      float dcell = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
      float inner = (1.0 - smoothstep(0.0, fpx * 1.5 + 0.01, dcell)) * (1.0 - smoothstep(0.08, 0.25, fpx));
      float a = uZoneMode > 0.5 ? 0.66 : 0.4;
      col = mix(col, zc * 0.85 + 0.04, a);
      col = mix(col, zc * 0.5, outline * 0.8);
      col = mix(col, zc * 1.1, inner * 0.35);
      tEmis += zc * (a * 0.015 + outline * 0.04) * (0.3 + uNightF * 2.0);
    }
    // data overlay heatmap
    if (uOverlayOn > 0.5) {
      float v = texture2D(uOverlayTex, gc / uN).r;
      vec4 rc = texture2D(uRamp, vec2(v, 0.5));
      float l = tLuma(col);
      col = mix(col, vec3(l) * vec3(0.94, 0.97, 1.0), 0.7) * 0.85;
      col = mix(col, rc.rgb, rc.a);
      tEmis += rc.rgb * rc.a * (0.03 + uNightF * 0.12);
    }
    // highlighted cells (tool preview)
    if (uHlOn > 0.5) {
      vec4 hl = texelFetch(uHlTex, cell, 0);
      if (hl.a > 0.0) {
        float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
        float rim = 1.0 - smoothstep(0.035, 0.035 + fpx * 1.5, d);
        col = mix(col, hl.rgb, hl.a * (0.42 + 0.5 * rim));
        tEmis += hl.rgb * hl.a * (0.06 + 0.25 * rim);
      }
    }
    // highlight rect (zoning drag)
    if (uRectOn > 0.5 && gc.x >= uRect.x && gc.y >= uRect.y && gc.x < uRect.z && gc.y < uRect.w) {
      vec2 dLo = gc - uRect.xy;
      vec2 dHi = uRect.zw - gc;
      float d = min(min(dLo.x, dHi.x), min(dLo.y, dHi.y));
      float border = 1.0 - smoothstep(0.06, 0.06 + fpx * 1.5, d);
      float dcell = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
      float cl = (1.0 - smoothstep(0.0, fpx * 1.2 + 0.005, dcell)) * (1.0 - smoothstep(0.1, 0.3, fpx));
      col = mix(col, uRectColor, 0.3 + 0.55 * border + 0.2 * cl);
      tEmis += uRectColor * (0.05 + 0.3 * border);
    }
  }
  // grid
  if (uGrid > 0.001) {
    vec2 gd = abs(fract(gc - 0.5) - 0.5) / max(fwc, vec2(1e-5));
    float line = 1.0 - min(min(gd.x, gd.y), 1.0);
    float fade = 1.0 - smoothstep(0.1, 0.32, fpx);
    vec2 gc8 = gc / 8.0;
    vec2 fw8 = fwidth(gc8);
    vec2 gd8 = abs(fract(gc8 - 0.5) - 0.5) / max(fw8, vec2(1e-5));
    float major = 1.0 - min(min(gd8.x, gd8.y), 1.0);
    float fade8 = 1.0 - smoothstep(0.08, 0.3, max(fw8.x, fw8.y));
    float g = max(line * fade * 0.5, major * fade8 * 0.4) * uGrid * (inside ? 1.0 : 0.0);
    col = mix(col, vec3(0.96, 0.97, 1.0), g * 0.55);
    tEmis += vec3(0.7, 0.8, 1.0) * g * (0.01 + uNightF * 0.05);
  }
  // circular brush
  if (uBrush.w > 0.5) {
    float d = length(xz - uBrush.xy);
    float r = uBrush.z;
    float px = fwidth(d);
    float ring = 1.0 - smoothstep(px * 0.75, px * 2.0 + r * 0.008, abs(d - r));
    float fill = 1.0 - smoothstep(r - px, r, d);
    float fall = fill * (1.0 - d / max(r, 1.0));
    vec3 bc = vec3(1.0, 0.93, 0.62);
    col = mix(col, bc, ring * 0.85 + fall * 0.18 + fill * 0.06);
    tEmis += bc * (ring * 0.35 + fill * 0.02);
  }

  tRough = rough;
#if TERRAIN_DETAIL > 1
  tNormalW = tPerturb(P, N, bump * (1.0 - smoothstep(0.25, 1.2, fpx)));
#else
  tNormalW = N;
#endif
  return col;
}
`;

/** replaces <color_fragment> */
export const TERRAIN_FRAG_COLOR = /* glsl */ `
diffuseColor.rgb = terrainShade(vTW, normalize(vTN));
`;
