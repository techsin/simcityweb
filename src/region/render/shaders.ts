/** GLSL sources for the region / menu renderer (terrain, water, sky, buildings). Colors are linear. */

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm4(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
`;

export const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform float uFogHeight;
vec3 applyFog(vec3 col, vec3 world, vec3 sunDir) {
  vec3 d = world - cameraPosition;
  float dist = length(d);
  vec3 vdir = d / max(dist, 1e-3);
  float sunAmt = pow(max(dot(vdir, sunDir), 0.0), 6.0);
  vec3 fc = mix(uFogColor, uFogSunColor, sunAmt);
  // exponential distance fog, thinner high up (aerial perspective)
  float hf = exp(-max(world.y, 0.0) / uFogHeight);
  float f = 1.0 - exp(-pow(dist * uFogDensity, 1.3) * (0.55 + 0.45 * hf));
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
`;

export const TERRAIN_VERT = /* glsl */ `
attribute float aForest;
attribute float aShadow;
attribute float aAO;
attribute float aHeight;
attribute float aSide;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vForest;
varying float vShadow;
varying float vAO;
varying float vHeight;
varying float vSide;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vForest = aForest;
  vShadow = aShadow;
  vAO = aAO;
  vHeight = aHeight;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const TERRAIN_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec3 uGrassA;
uniform vec3 uGrassB;
uniform vec3 uForest;
uniform vec3 uRock;
uniform vec3 uRock2;
uniform vec3 uSand;
uniform vec3 uSnow;
uniform vec3 uWet;
uniform vec3 uSoil;
uniform float uSnowLine;
uniform float uTime;
uniform vec2 uRegionSize;
uniform vec2 uUnits;
uniform float uUnitM;
uniform float uGridOpacity;
uniform float uCityOpacity;
uniform sampler2D uTileTex;
uniform sampler2D uCityTex;
uniform vec4 uHover;
uniform vec4 uSelect;
uniform vec3 uAccent;
uniform float uPulse;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vForest;
varying float vShadow;
varying float vAO;
varying float vHeight;
varying float vSide;
${NOISE_GLSL}
${FOG_GLSL}

float tileId(vec2 cell) {
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uUnits.x || cell.y >= uUnits.y) return -1.0;
  return floor(texture2D(uTileTex, (cell + 0.5) / uUnits).r * 255.0 + 0.5);
}

float rectEdge(vec2 unit, vec4 r) {
  return min(min(unit.x - r.x, r.z - unit.x), min(unit.y - r.y, r.w - unit.y));
}

void main() {
  vec3 n = normalize(vNormal);
  float h = vHeight;
  vec2 p = vWorld.xz;
  float n1 = fbm4(p * 0.0021);
  float n2 = vnoise(p * 0.027);
  float n3 = vnoise(p * 0.11);
  float slope = 1.0 - n.y;
  // micro relief: bumpy canopy on forests, gentle undulation elsewhere (fades with distance)
  float camD = length(vWorld - cameraPosition);
  float detailFade = 1.0 - smoothstep(2500.0, 14000.0, camD);
  if (detailFade > 0.0 && vSide < 0.5 && h > 0.5) {
    float fk = smoothstep(0.2, 0.6, vForest);
    vec2 q = p * mix(0.02, 0.06, fk);
    float b0 = vnoise(q), bx = vnoise(q + vec2(0.07, 0.0)), bz = vnoise(q + vec2(0.0, 0.07));
    vec3 bump = vec3(-(bx - b0), 0.0, -(bz - b0)) / 0.07 * mix(0.12, 0.45, fk) * detailFade;
    n = normalize(n + bump);
  }

  vec3 grass = mix(uGrassA, uGrassB, smoothstep(0.3, 0.72, n1));
  grass *= 0.88 + 0.24 * n2;
  float forest = smoothstep(0.18, 0.62, vForest + (n3 - 0.5) * 0.4 + (n2 - 0.5) * 0.2);
  vec3 col = mix(grass, uForest * (0.7 + 0.55 * n3), forest);
  col = mix(col, uSoil, smoothstep(0.16, 0.3, slope + (n2 - 0.5) * 0.12) * 0.55);
  vec3 rock = mix(uRock, uRock2, smoothstep(0.3, 0.7, n2));
  rock *= 0.85 + 0.3 * vnoise(vec2(p.x * 0.004, vWorld.y * 0.08));
  col = mix(col, rock, smoothstep(0.3, 0.48, slope + (n1 - 0.5) * 0.18));
  float beach = 1.0 - smoothstep(1.0, 3.4, h + (n2 - 0.5) * 1.8);
  col = mix(col, uSand, beach);
  if (h < 0.0) col = mix(uSand * 0.85, uWet, smoothstep(0.0, 14.0, -h));
  float snow = smoothstep(uSnowLine, uSnowLine + 28.0, h + (n1 - 0.5) * 45.0) * (1.0 - smoothstep(0.42, 0.66, slope));
  col = mix(col, uSnow, snow);

  // diorama sides: soil strata
  if (vSide > 0.5) {
    float y = vWorld.y;
    float band = vnoise(vec2(p.x * 0.002 + p.y * 0.002, y * 0.06));
    col = mix(uSoil * 0.45, uSoil * 0.85, band);
    col = mix(col, uRock * 0.5, smoothstep(-80.0, -200.0, y));
  }

  // founded cities: draped top-down thumbnails
  vec2 ruv = p / uRegionSize;
  vec4 city = texture2D(uCityTex, vec2(ruv.x, 1.0 - ruv.y));
  float cityA = city.a * uCityOpacity * (1.0 - vSide);
  col = mix(col, city.rgb, cityA);

  // lighting
  float diff = max(dot(n, uSunDir), 0.0) * vShadow;
  vec3 amb = mix(uGroundAmb, uSkyAmb, n.y * 0.5 + 0.5) * (0.45 + 0.55 * vAO);
  vec3 lit = col * (amb + uSunColor * diff);
  // subtle warm rim on sun-facing slopes
  lit += col * uSunColor * pow(max(dot(n, uSunDir), 0.0), 8.0) * 0.08 * vShadow;

  // tile borders + hover / selection
  if (uGridOpacity > 0.0 && vSide < 0.5) {
    vec2 unit = p / uUnitM;
    vec2 cell = floor(unit);
    vec2 f = unit - cell;
    float id = tileId(cell);
    vec2 fw = max(fwidth(unit) * 1.1, vec2(1e-4));
    float border = 0.0;
    if (tileId(cell + vec2(-1.0, 0.0)) != id) border = max(border, 1.0 - smoothstep(0.0, fw.x, f.x));
    if (tileId(cell + vec2(1.0, 0.0)) != id) border = max(border, 1.0 - smoothstep(0.0, fw.x, 1.0 - f.x));
    if (tileId(cell + vec2(0.0, -1.0)) != id) border = max(border, 1.0 - smoothstep(0.0, fw.y, f.y));
    if (tileId(cell + vec2(0.0, 1.0)) != id) border = max(border, 1.0 - smoothstep(0.0, fw.y, 1.0 - f.y));
    lit = mix(lit, vec3(1.0), border * uGridOpacity);
    if (unit.x >= uHover.x && unit.x < uHover.z && unit.y >= uHover.y && unit.y < uHover.w) {
      float e = rectEdge(unit, uHover);
      lit = lit * 1.12 + uAccent * 0.05;
      lit = mix(lit, vec3(1.0), (1.0 - smoothstep(0.0, fw.x * 2.4, e)) * 0.95);
      lit += uAccent * (1.0 - smoothstep(0.0, fw.x * 14.0, e)) * 0.12;
    }
    if (unit.x >= uSelect.x && unit.x < uSelect.z && unit.y >= uSelect.y && unit.y < uSelect.w) {
      float e = rectEdge(unit, uSelect);
      lit = mix(lit, uAccent * 1.4, (1.0 - smoothstep(0.0, fw.x * 3.0, e)));
      lit += uAccent * (1.0 - smoothstep(0.0, fw.x * 22.0, e)) * (0.18 + 0.1 * uPulse);
    }
  }

  lit = applyFog(lit, vWorld, uSunDir);
  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const WATER_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const WATER_FRAG = /* glsl */ `
uniform sampler2D uDepthTex;
uniform vec2 uRegionSize;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;
uniform float uOutsideDepth;
uniform float uDepthScale;
uniform float uSide;
varying vec3 vWorld;
${NOISE_GLSL}
${FOG_GLSL}

float depthAt(vec2 p) {
  vec2 uv = p / uRegionSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return uOutsideDepth;
  return texture2D(uDepthTex, uv).r * uDepthScale;
}
float wave(vec2 p, float t) {
  return vnoise(p * 0.018 + vec2(t * 0.035, t * 0.021)) * 1.2
       + vnoise(p * 0.047 - vec2(t * 0.05, -t * 0.03)) * 0.5
       + vnoise(p * 0.13 + vec2(-t * 0.11, t * 0.08)) * 0.18;
}

void main() {
  vec2 p = vWorld.xz;
  float d = max(depthAt(p), 0.0);
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float e = 1.5;
  float t = uTime;
  float h0 = wave(p, t);
  float hx = wave(p + vec2(e, 0.0), t);
  float hz = wave(p + vec2(0.0, e), t);
  vec3 N = normalize(vec3(-(hx - h0) / e * 5.0, 1.0, -(hz - h0) / e * 5.0));
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(1500.0, 16000.0, dist) * 0.85));
  if (uSide > 0.5) N = normalize(vec3(V.x, 0.2, V.z));
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
  float sd = max(dot(R, uSunDir), 0.0);
  float spec = pow(sd, 420.0) * 7.0 + pow(sd, 48.0) * 0.35;
  vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 22.0, d));
  float sunLvl = clamp(uSunDir.y * 1.6 + 0.25, 0.25, 1.0);
  vec3 col = mix(body * sunLvl, sky, F * 0.85) + uSunColor * spec;
  float foamN = vnoise(p * 0.09 + t * 0.2);
  float foam = (1.0 - smoothstep(0.0, 1.4, d)) * (0.55 + 0.45 * sin(t * 1.4 + d * 4.0 + foamN * 6.0));
  col = mix(col, vec3(0.92, 0.95, 0.96) * sunLvl, foam * 0.55);
  float alpha = mix(0.35, 0.93, smoothstep(0.0, 7.0, d));
  alpha = max(alpha, F * 0.9);
  if (uSide > 0.5) { col = body * 0.7; alpha = 0.78; }
  col = applyFog(col, vWorld, uSunDir);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + vDir * 1000.0, 1.0);
  gl_Position = p.xyww;
}
`;

export const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uGlow;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uHorizonAway;
uniform float uTime;
varying vec3 vDir;
${NOISE_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float s = max(dot(d, uSunDir), 0.0);
  // horizon warm towards the sun, dusky away from it
  vec2 hd = normalize(d.xz + 1e-5), hs = normalize(uSunDir.xz + 1e-5);
  float az = dot(hd, hs) * 0.5 + 0.5;
  vec3 horizon = mix(uHorizonAway, uHorizon, pow(az, 1.6));
  vec3 col = mix(horizon, uZenith, pow(smoothstep(-0.02, 0.8, y), 0.5));
  col = mix(col, horizon * 1.15, (1.0 - smoothstep(0.0, 0.07, abs(y))) * 0.5);
  col += uGlow * (pow(s, 5.0) * 0.4 + pow(s, 48.0) * 0.35) * (1.0 - smoothstep(0.1, 0.6, y) * 0.5);
  // clouds
  if (y > 0.0) {
    vec2 uv = d.xz / (y + 0.12) * 1.4;
    float c = fbm4(uv * 0.9 + vec2(uTime * 0.004, uTime * 0.002));
    float c2 = fbm4(uv * 2.6 - vec2(uTime * 0.006, 0.0));
    float cov = smoothstep(0.52, 0.78, c * 0.75 + c2 * 0.35);
    vec3 cc = mix(uCloudShade, uCloudLit, clamp(pow(s, 3.0) * 1.2 + c2 * 0.35, 0.0, 1.0));
    col = mix(col, cc, cov * smoothstep(0.0, 0.18, y) * 0.8);
  }
  col += uSunColor * smoothstep(0.99955, 0.99985, s) * 6.0;
  col = mix(col, uHorizon * 0.7, smoothstep(0.0, -0.25, y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const BUILDING_VERT = /* glsl */ `
// instanceMatrix / instanceColor are declared by three's ShaderMaterial prefix (USE_INSTANCING[_COLOR])
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;
varying float vSeed;
varying float vBaseY;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vColor = instanceColor;
  vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  vBaseY = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const BUILDING_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec3 uWindow;
uniform float uNight;
uniform float uExag;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;
varying float vSeed;
varying float vBaseY;
${NOISE_GLSL}
${FOG_GLSL}
void main() {
  vec3 n = normalize(vNormal);
  vec3 col = vColor;
  float emis = 0.0;
  float yy = (vWorld.y - vBaseY) / uExag;
  if (abs(n.y) < 0.5) {
    float along = dot(vWorld.xz, vec2(-n.z, n.x));
    vec2 g = vec2(along / 5.0, yy / 3.6);
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.28, f.y) * step(f.y, 0.78) * step(1.0, yy);
    float on = step(0.35 + 0.3 * vSeed, hash12(cell + vSeed * 91.0));
    col = mix(col, col * 0.35 + vec3(0.03, 0.04, 0.07), win * 0.85);
    emis = win * on * uNight;
  } else {
    col *= 0.5;
  }
  col *= mix(1.0, 0.55, uNight);
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 amb = mix(uGroundAmb, uSkyAmb, n.y * 0.5 + 0.5);
  vec3 lit = col * (amb + uSunColor * diff) + uWindow * emis * (0.7 + 0.6 * hash12(floor(vWorld.xz * 0.2)));
  lit = applyFog(lit, vWorld, uSunDir);
  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const LIGHTS_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
varying float vFade;
uniform float uScale;
uniform float uTime;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = -mv.z;
  vColor = aColor * (0.85 + 0.15 * sin(uTime * 2.0 + position.x * 0.13));
  vFade = 1.0 - smoothstep(9000.0, 26000.0, d);
  gl_PointSize = clamp(aSize * uScale / d, 1.0, 9.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const LIGHTS_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float a = exp(-r * r * 4.0) * vFade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
