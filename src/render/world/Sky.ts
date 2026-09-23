/**
 * SkySystem — sun & moon ephemeris (simplified, seasonal), physically-inspired sky dome (sky-view LUT), stars,
 * moon, clouds, city glow, and the PMREM environment map (throttled refresh).
 *
 * World orientation: north = -Z, east = +X, up = +Y. The sun rises in the east, culminates in the south (+Z).
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ATMOS_GLSL, atmTransmittanceJS } from './atmosphere';
import { getNoiseTexture } from './textures';
import type { Climate } from '../../core/types';

const LATITUDE = THREE.MathUtils.degToRad(38);

export interface SkyLighting {
  /** direction TO the sun (unit) */
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** direction TO the active shadow casting light (sun by day, moon at night) */
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  lightIntensity: number;
  /** 0 day .. 1 night */
  night: number;
  /** 0..1 how much golden hour warmth (sun low) */
  golden: number;
  envIntensity: number;
  exposure: number;
}

export interface ClimateSky {
  /** Mie / aerosol multiplier (haze) */
  mie: number;
  cloudCover: number;
  /** ground albedo for the environment's lower hemisphere (linear) */
  ground: THREE.Color;
}

export function climateSky(c: Climate): ClimateSky {
  switch (c) {
    case 'desert': return { mie: 2.2, cloudCover: 0.12, ground: new THREE.Color(0.32, 0.25, 0.16) };
    case 'tropical': return { mie: 1.7, cloudCover: 0.5, ground: new THREE.Color(0.1, 0.16, 0.08) };
    case 'alpine': return { mie: 0.8, cloudCover: 0.38, ground: new THREE.Color(0.16, 0.18, 0.16) };
    default: return { mie: 1.3, cloudCover: 0.34, ground: new THREE.Color(0.13, 0.16, 0.09) };
  }
}

const LUT_FRAG = /* glsl */ `
precision highp float;
${ATMOS_GLSL}
uniform vec3 uSunDir;
uniform vec3 uSunE;
uniform vec3 uMoonDir;
uniform vec3 uMoonE;
uniform float uMie;
uniform float uH0;
varying vec2 vUv;
void main() {
  vec3 dir = atmLutDir(vUv);
  // keep the ray slightly above the true horizon so the lower half is a smooth haze continuation
  dir.y = max(dir.y, -0.02);
  dir = normalize(dir);
  vec3 T;
  vec3 L = atmScatter(dir, uH0, uSunDir, uSunE, uMoonDir, uMoonE, uMie, T);
  gl_FragColor = vec4(L, 1.0);
}`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** shared sky shading used by the dome and the environment */
const SKY_COMMON = /* glsl */ `
uniform sampler2D uSkyLut;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunDisk;
uniform vec3 uMoonDisk;
uniform float uSkyExposure;
uniform vec3 uSkyFloor;
uniform float uNightSky;
uniform float uCloudCover;
uniform float uCloudTime;
uniform vec3 uCloudLit;
uniform vec3 uCloudAmb;
uniform vec3 uCityGlow;
uniform sampler2D uNoise;
uniform mat3 uStarRot;
uniform float uTime;

vec2 skyLutUv(vec3 dir) {
  float az = atan(dir.x, -dir.z);
  float u = az * 0.15915494 + 0.5;
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / 1.5707963);
  return vec2(u, v);
}
vec3 skyBase(vec3 dir) {
  return texture2D(uSkyLut, skyLutUv(dir)).rgb * uSkyExposure + uSkyFloor * (1.0 - 0.65 * sqrt(max(dir.y, 0.0)));
}
float starHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

vec3 stars(vec3 dir, float pix) {
  vec3 d = uStarRot * dir;
  vec3 col = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float sc = layer == 0 ? 110.0 : 260.0;
    vec3 p = d * sc;
    vec3 c = floor(p);
    float h = starHash(c + float(layer) * 17.0);
    float thr = layer == 0 ? 0.985 : 0.992;
    if (h > thr) {
      vec3 jit = vec3(starHash(c + 1.3), starHash(c + 2.7), starHash(c + 4.1));
      vec3 sp = c + 0.2 + 0.6 * jit;
      float dist = length(p - sp) / sc;
      float size = max(pix * 1.1, 0.0004);
      float b = (h - thr) / (1.0 - thr);
      b = b * b * (layer == 0 ? 3.0 : 1.2);
      float tw = 0.75 + 0.25 * sin(uTime * (2.0 + 5.0 * jit.x) + jit.y * 40.0);
      vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.65), jit.z);
      col += tint * b * tw * smoothstep(size, 0.0, dist);
    }
  }
  // faint milky way band
  float band = exp(-pow(d.y * 3.2 + 0.25 * sin(d.x * 3.0), 2.0));
  float mw = texture2D(uNoise, d.xz * 0.35 + 0.5).g;
  col += vec3(0.5, 0.55, 0.7) * band * smoothstep(0.35, 0.8, mw) * 0.018;
  return col;
}

// thin 2D cloud deck at ~2 km; returns rgb premultiplied by alpha in .rgb, alpha in .a
vec4 clouds(vec3 dir, vec3 camPos) {
  if (dir.y < 0.01 || uCloudCover < 0.01) return vec4(0.0);
  float hgt = 2200.0 - camPos.y * 0.2;
  float t = hgt / dir.y;
  vec2 p = camPos.xz * 0.2 + dir.xz * t;
  vec2 wind = vec2(uCloudTime * 9.0, uCloudTime * 4.0);
  vec2 q = (p + wind) / 24000.0;
  float n = texture2D(uNoise, q).r * 0.55 + texture2D(uNoise, q * 2.7 + 0.31).g * 0.3 + texture2D(uNoise, q * 7.3 + 0.73).b * 0.15;
  float cov = mix(0.72, 0.38, uCloudCover);
  float dens = smoothstep(cov, cov + 0.2, n);
  float fade = smoothstep(0.015, 0.2, dir.y) * (1.0 - smoothstep(60000.0, 140000.0, t));
  dens *= fade;
  float mu = dot(dir, uSunDir);
  float silver = pow(max(mu, 0.0), 6.0) * 1.4 + 0.5;
  float thick = smoothstep(cov, cov + 0.45, n);
  vec3 col = uCloudAmb * (1.0 - 0.35 * thick) + uCloudLit * silver * (1.0 - 0.55 * thick);
  return vec4(col * dens, dens * 0.92);
}
`;

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 v = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  v /= v.w;
  vDir = (inverse(viewMatrix) * vec4(v.xyz, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const DOME_FRAG = /* glsl */ `
${SKY_COMMON}
varying vec3 vDir;
float moonNoise(vec2 p) { return texture2D(uNoise, p).r; }
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyBase(dir);
  float pix = length(fwidth(dir));
  // sun disk with limb darkening
  float cs = dot(dir, uSunDir);
  float sunR = 0.0055;
  float ds = acos(clamp(cs, -1.0, 1.0));
  if (ds < sunR * 2.0) {
    float x = clamp(ds / sunR, 0.0, 1.0);
    float limb = 1.0 - 0.55 * (1.0 - sqrt(max(1.0 - x * x, 0.0)));
    col += uSunDisk * limb * smoothstep(sunR + pix, sunR - pix, ds);
  }
  // moon disk
  float cm = dot(dir, uMoonDir);
  float moonR = 0.009;
  float dm = acos(clamp(cm, -1.0, 1.0));
  float moonMask = smoothstep(moonR + pix, moonR - pix, dm);
  vec3 skyNight = vec3(0.0);
  if (uNightSky > 0.001) {
    skyNight = stars(dir, pix) * uNightSky * (1.0 - moonMask);
    // horizon atmospheric extinction of stars
    skyNight *= smoothstep(-0.02, 0.25, dir.y);
  }
  if (dm < moonR * 2.0) {
    vec3 up = abs(uMoonDir.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 mx = normalize(cross(up, uMoonDir));
    vec3 my = cross(uMoonDir, mx);
    vec2 mp = vec2(dot(dir, mx), dot(dir, my)) / moonR;
    float maria = smoothstep(0.45, 0.65, moonNoise(mp * 0.18 + 0.37)) * 0.35 + moonNoise(mp * 0.6) * 0.15;
    col += uMoonDisk * (1.0 - maria) * moonMask;
  }
  col += skyNight;
  vec4 cl = clouds(dir, cameraPosition);
  col = col * (1.0 - cl.a) + cl.rgb;
  // city light glow near the horizon
  float el = max(dir.y, 0.0);
  col += uCityGlow * (exp(-el * 9.0) * 0.9 + exp(-el * 40.0) * 0.6) * (1.0 - cl.a * 0.3) + uCityGlow * cl.a * 1.2;
  gl_FragColor = vec4(col, 1.0);
}`;

const ENV_FRAG = /* glsl */ `
${SKY_COMMON}
uniform vec3 uGround;
uniform vec3 uCamPos;
varying vec2 vUv;
void main() {
  float phi = (vUv.x - 0.5) * 6.2831853;
  float theta = (vUv.y - 0.5) * 3.1415927;
  vec3 dir = vec3(cos(theta) * cos(phi), sin(theta), cos(theta) * sin(phi));
  vec3 sky = skyBase(vec3(dir.x, max(dir.y, 0.0), dir.z));
  vec4 cl = clouds(vec3(dir.x, max(dir.y, 0.02), dir.z), uCamPos);
  sky = sky * (1.0 - cl.a) + cl.rgb;
  float el = max(dir.y, 0.0);
  sky += uCityGlow * exp(-el * 9.0) * 0.9;
  // soft sun glow (the actual sun is the directional light; a sharp disk here would create fireflies)
  float cs = max(dot(dir, uSunDir), 0.0);
  sky += uSunDisk * 0.0012 * pow(cs, 400.0);
  vec3 col = mix(uGround + uCityGlow * 0.15, sky, smoothstep(-0.12, 0.02, dir.y));
  gl_FragColor = vec4(col, 1.0);
}`;

const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _m4a = new THREE.Matrix4();
const _m4b = new THREE.Matrix4();

export class SkySystem {
  readonly uniforms = {
    uSkyLut: { value: null as THREE.Texture | null },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uSunDisk: { value: new THREE.Vector3(0, 0, 0) },
    uMoonDisk: { value: new THREE.Vector3(0, 0, 0) },
    uSkyExposure: { value: 1 },
    uSkyFloor: { value: new THREE.Vector3() },
    uNightSky: { value: 0 },
    uCloudCover: { value: 0.3 },
    uCloudTime: { value: 0 },
    uCloudLit: { value: new THREE.Vector3(1, 1, 1) },
    uCloudAmb: { value: new THREE.Vector3(0.5, 0.55, 0.6) },
    uCityGlow: { value: new THREE.Vector3(0, 0, 0) },
    uNoise: { value: getNoiseTexture() as THREE.Texture },
    uStarRot: { value: new THREE.Matrix3() },
    uTime: { value: 0 },
  };
  readonly dome: THREE.Mesh;
  readonly lighting: SkyLighting = {
    sunDir: new THREE.Vector3(0, 1, 0),
    moonDir: new THREE.Vector3(0, -1, 0),
    lightDir: new THREE.Vector3(0, 1, 0),
    lightColor: new THREE.Color(1, 1, 1),
    lightIntensity: 3,
    night: 0,
    golden: 0,
    envIntensity: 1,
    exposure: 1,
  };
  /** 0..1 amount of city lights (population driven), set by WorldView */
  cityLights = 0;
  climate: ClimateSky;

  private renderer: THREE.WebGLRenderer;
  private lutRT: THREE.WebGLRenderTarget;
  private lutMat: THREE.ShaderMaterial;
  private lutQuad: FullScreenQuad;
  private envSrcRT: THREE.WebGLRenderTarget;
  private envMat: THREE.ShaderMaterial;
  private envQuad: FullScreenQuad;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvHour = -999;
  private lutDirty = true;
  private lastLutSun = new THREE.Vector3();
  private lastLutMoonY = 0;
  private envRefreshMinutes = 6;
  private lutUniforms = {
    uSunDir: { value: new THREE.Vector3() },
    uSunE: { value: new THREE.Vector3() },
    uMoonDir: { value: new THREE.Vector3() },
    uMoonE: { value: new THREE.Vector3() },
    uMie: { value: 1.3 },
    uH0: { value: 0.35 },
  };
  private envUniforms = { uGround: { value: new THREE.Vector3() }, uCamPos: { value: new THREE.Vector3() } };
  private sunT = new THREE.Color();
  private moonT = new THREE.Color();

  constructor(renderer: THREE.WebGLRenderer, climate: Climate, lutSize: [number, number], envSize: number) {
    this.renderer = renderer;
    this.climate = climateSky(climate);
    this.lutRT = this.makeLutRT(lutSize);
    this.uniforms.uSkyLut.value = this.lutRT.texture;
    this.lutMat = new THREE.ShaderMaterial({ uniforms: this.lutUniforms, vertexShader: QUAD_VERT, fragmentShader: LUT_FRAG, depthTest: false, depthWrite: false, toneMapped: false });
    this.lutQuad = new FullScreenQuad(this.lutMat);

    this.envSrcRT = this.makeEnvRT(envSize);
    this.envMat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, ...this.envUniforms },
      vertexShader: QUAD_VERT,
      fragmentShader: ENV_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.envQuad = new FullScreenQuad(this.envMat);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const domeMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      depthWrite: false,
      depthTest: true,
      depthFunc: THREE.LessEqualDepth,
      fog: false,
      toneMapped: false,
    });
    this.dome = new THREE.Mesh(geo, domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 1e6; // after opaque geometry -> only uncovered pixels get shaded
    this.dome.name = 'sky-dome';
    this.dome.matrixAutoUpdate = false;
  }

  private makeLutRT(size: [number, number]) {
    const rt = new THREE.WebGLRenderTarget(size[0], size[1], { type: THREE.HalfFloatType, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
    rt.texture.wrapS = THREE.RepeatWrapping;
    rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    rt.texture.generateMipmaps = false;
    return rt;
  }
  private makeEnvRT(w: number) {
    const rt = new THREE.WebGLRenderTarget(w, w / 2, { type: THREE.HalfFloatType, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
    rt.texture.mapping = THREE.EquirectangularReflectionMapping;
    rt.texture.generateMipmaps = false;
    return rt;
  }

  setQuality(lutSize: [number, number], envSize: number, envRefreshMinutes: number) {
    this.envRefreshMinutes = envRefreshMinutes;
    if (this.lutRT.width !== lutSize[0]) {
      this.lutRT.dispose();
      this.lutRT = this.makeLutRT(lutSize);
      this.uniforms.uSkyLut.value = this.lutRT.texture;
      this.lutDirty = true;
    }
    if (this.envSrcRT.width !== envSize) {
      this.envSrcRT.dispose();
      this.envSrcRT = this.makeEnvRT(envSize);
    }
    this.lastEnvHour = -999;
  }

  setClimate(c: Climate) {
    this.climate = climateSky(c);
    this.lutDirty = true;
    this.lastEnvHour = -999;
  }

  /** compute sun / moon directions for hour (0..24) and day of year (0..359) */
  /**
   * Gameplay-friendly solar model: solar noon at 12:45 (like daylight saving time), gentle seasons
   * (sunrise ~6:10 / sunset ~19:20 in summer, ~7:10 / 18:20 in winter).
   */
  static sunDirection(hour: number, dayOfYear: number, out: THREE.Vector3): THREE.Vector3 {
    const decl = THREE.MathUtils.degToRad(23.44 * 0.35) * Math.sin(((2 * Math.PI) / 360) * (dayOfYear - 80)) + THREE.MathUtils.degToRad(3);
    const H = ((hour - 12.75) / 24) * Math.PI * 2;
    return SkySystem.celestial(H, decl, out);
  }
  static moonDirection(hour: number, dayOfYear: number, out: THREE.Vector3): THREE.Vector3 {
    const decl = -THREE.MathUtils.degToRad(23.44 * 0.35) * Math.sin(((2 * Math.PI) / 360) * (dayOfYear - 80)) + 0.1;
    const H = ((hour - 12.75) / 24) * Math.PI * 2 + Math.PI + 0.35;
    return SkySystem.celestial(H, decl, out);
  }
  private static celestial(H: number, decl: number, out: THREE.Vector3): THREE.Vector3 {
    const sinEl = Math.sin(LATITUDE) * Math.sin(decl) + Math.cos(LATITUDE) * Math.cos(decl) * Math.cos(H);
    const el = Math.asin(THREE.MathUtils.clamp(sinEl, -1, 1));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LATITUDE) - Math.tan(decl) * Math.cos(LATITUDE)) + Math.PI;
    const ce = Math.cos(el);
    // az from north clockwise; north = -Z, east = +X
    return out.set(ce * Math.sin(az), Math.sin(el), -ce * Math.cos(az)).normalize();
  }

  /**
   * Update lighting for time of day. Re-renders the LUT when the sun moved noticeably and the environment map when
   * the clock advanced by envRefreshMinutes (or force=true).
   */
  update(hour: number, dayOfYear: number, time: number, cameraPos: THREE.Vector3, scene: THREE.Scene, force = false): void {
    const L = this.lighting;
    const u = this.uniforms;
    SkySystem.sunDirection(hour, dayOfYear, L.sunDir);
    SkySystem.moonDirection(hour, dayOfYear, L.moonDir);
    u.uSunDir.value.copy(L.sunDir);
    u.uMoonDir.value.copy(L.moonDir);
    u.uTime.value = time;
    u.uCloudTime.value = time + hour * 3600 * 0.02;
    u.uCloudCover.value = this.climate.cloudCover;

    const sy = L.sunDir.y;
    const mie = this.climate.mie;
    atmTransmittanceJS(L.sunDir, 0.35, mie, this.sunT);
    atmTransmittanceJS(L.moonDir, 0.35, mie, this.moonT);

    // night factor (drives windows, street lights, bloom)
    L.night = 1 - THREE.MathUtils.smoothstep(sy, -0.12, 0.07);
    L.golden = THREE.MathUtils.smoothstep(sy, 0.0, 0.08) * (1 - THREE.MathUtils.smoothstep(sy, 0.12, 0.42));

    // active light: sun by day, then a "twilight sky light" from the sunset azimuth (warm -> blue), then the
    // moon at night. The light only jumps direction at the switch point where its intensity is ~0.
    const sunF = THREE.MathUtils.smoothstep(sy, -0.035, 0.07);
    const SWITCH = -0.15;
    const twF = (1 - THREE.MathUtils.smoothstep(sy, -0.01, 0.1)) * THREE.MathUtils.smoothstep(sy, SWITCH, -0.06);
    const moonF = (1 - THREE.MathUtils.smoothstep(sy, -0.26, SWITCH)) * THREE.MathUtils.smoothstep(L.moonDir.y, 0.0, 0.2);
    const SUN_I = 3.2;
    if (sy > SWITCH) {
      L.lightDir.copy(L.sunDir);
      // keep the light a bit above the horizon so terrain doesn't go fully black, stays readable
      if (L.lightDir.y < 0.1) {
        L.lightDir.y = 0.1;
        L.lightDir.normalize();
      }
      _c.copy(this.sunT);
      // normalise so intensity carries brightness, color carries hue
      const m = Math.max(_c.r, _c.g, _c.b, 1e-4);
      _c.multiplyScalar(1 / m);
      const sunI = SUN_I * sunF * Math.min(1, 0.35 + m * 0.75);
      const twI = 0.75 * twF;
      const blue = THREE.MathUtils.smoothstep(-sy, -0.01, 0.1);
      _c2.setRGB(THREE.MathUtils.lerp(1.0, 0.5, blue), THREE.MathUtils.lerp(0.6, 0.6, blue), THREE.MathUtils.lerp(0.45, 1.0, blue));
      const tot = sunI + twI;
      const wa = sunI / Math.max(tot, 1e-4), wb = twI / Math.max(tot, 1e-4);
      L.lightColor.setRGB(_c.r * wa + _c2.r * wb, _c.g * wa + _c2.g * wb, _c.b * wa + _c2.b * wb);
      L.lightIntensity = tot;
    } else {
      L.lightDir.copy(L.moonDir);
      if (L.lightDir.y < 0.15) {
        L.lightDir.y = 0.15;
        L.lightDir.normalize();
      }
      L.lightColor.setRGB(0.6, 0.72, 1.0);
      L.lightIntensity = 0.5 * moonF;
    }
    // twilight amount (sun just below the horizon): brightens the sky for a readable blue hour
    const twilight = THREE.MathUtils.smoothstep(sy, -0.2, -0.07) * (1 - THREE.MathUtils.smoothstep(sy, -0.06, 0.0));

    // sky scattering sources (LUT units)
    const E = 10;
    this.lutUniforms.uSunDir.value.copy(L.sunDir);
    this.lutUniforms.uSunE.value.set(E, E * 0.985, E * 0.96);
    this.lutUniforms.uMoonDir.value.copy(L.moonDir);
    const me = E * 0.0035;
    this.lutUniforms.uMoonE.value.set(me * 0.8, me * 0.9, me * 1.15);
    this.lutUniforms.uMie.value = mie;

    // exposure & sky brightness for readability at night
    L.exposure = THREE.MathUtils.lerp(1.0, 1.9, L.night);
    u.uSkyExposure.value = 1.0 + 2.5 * twilight;
    u.uNightSky.value = THREE.MathUtils.smoothstep(L.night, 0.55, 1.0) * 0.9;
    L.envIntensity = THREE.MathUtils.lerp(1.0, 1.8, L.night) + 1.2 * twilight;
    // night sky floor (deep blue, brighter toward the horizon) so the night never goes pitch black
    const fl = THREE.MathUtils.smoothstep(L.night, 0.3, 1.0);
    u.uSkyFloor.value.set(0.0012 * fl, 0.0022 * fl, 0.0058 * fl);

    // sun / moon disk radiance
    u.uSunDisk.value.set(this.sunT.r, this.sunT.g, this.sunT.b).multiplyScalar(120 * THREE.MathUtils.smoothstep(sy, -0.03, 0.01));
    const mT = this.moonT;
    const moonVis = THREE.MathUtils.smoothstep(L.moonDir.y, -0.02, 0.05) * (0.25 + 0.75 * L.night);
    u.uMoonDisk.value.set(mT.r * 0.95, mT.g * 0.97, mT.b * 1.0).multiplyScalar(2.2 * moonVis);

    // cloud lighting
    const dayAmt = THREE.MathUtils.smoothstep(sy, -0.1, 0.2);
    _c.copy(this.sunT).multiplyScalar(2.2 * sunF);
    u.uCloudLit.value.set(_c.r, _c.g, _c.b);
    const amb = THREE.MathUtils.lerp(0.012, 0.5, dayAmt);
    u.uCloudAmb.value.set(amb * 0.9, amb * 0.95, amb * 1.05);
    if (sy < 0.1 && sy > -0.12) {
      // sunset underside glow
      const g = (1 - Math.abs(sy - 0.0) / 0.12) * 0.45;
      u.uCloudAmb.value.x += g * 0.9 * this.sunT.r;
      u.uCloudAmb.value.y += g * 0.45 * this.sunT.g;
      u.uCloudAmb.value.z += g * 0.3 * this.sunT.b;
    }

    // city glow (orange light pollution)
    const glow = this.cityLights * L.night * 0.05;
    u.uCityGlow.value.set(glow * 1.0, glow * 0.55, glow * 0.28);

    // star rotation (earth rotation around the celestial pole)
    const rot = (hour / 24) * Math.PI * 2;
    _m4a.makeRotationX(-(Math.PI / 2 - LATITUDE)).multiply(_m4b.makeRotationY(rot));
    u.uStarRot.value.setFromMatrix4(_m4a);

    // LUT refresh when the sun moved noticeably (cheap, but no need for every frame)
    if (force || this.lutDirty || L.sunDir.distanceToSquared(this.lastLutSun) > 1e-5 || Math.abs(L.moonDir.y - this.lastLutMoonY) > 0.002) {
      this.lutDirty = false;
      this.lastLutSun.copy(L.sunDir);
      this.lastLutMoonY = L.moonDir.y;
      this.renderLut();
    }
    // environment map refresh (throttled in game minutes)
    const dh = Math.abs(hour - this.lastEnvHour);
    const wrapped = Math.min(dh, 24 - dh);
    if (force || !this.envRT || wrapped * 60 >= this.envRefreshMinutes) {
      this.lastEnvHour = hour;
      this.renderEnv(cameraPos, dayAmt, sunF);
      scene.environment = this.envRT!.texture;
    }
    scene.environmentIntensity = L.envIntensity;
  }

  private renderLut() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.lutRT);
    this.lutQuad.render(r);
    r.setRenderTarget(prev);
  }

  private renderEnv(cameraPos: THREE.Vector3, dayAmt: number, sunF: number) {
    const r = this.renderer;
    const L = this.lighting;
    // ground bounce color: albedo * (sun irradiance + sky)
    const g = this.climate.ground;
    const sunIrr = Math.max(L.sunDir.y, 0) * 3.4 * sunF / Math.PI;
    const skyIrr = THREE.MathUtils.lerp(0.004, 0.22, dayAmt);
    _v.set(g.r * (sunIrr * this.sunT.r + skyIrr), g.g * (sunIrr * this.sunT.g + skyIrr), g.b * (sunIrr * this.sunT.b + skyIrr * 1.1));
    this.envUniforms.uGround.value.copy(_v);
    this.envUniforms.uCamPos.value.copy(cameraPos);
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.envSrcRT);
    this.envQuad.render(r);
    r.setRenderTarget(prev);
    if (!this.envRT) {
      this.envRT = this.pmrem.fromEquirectangular(this.envSrcRT.texture);
    } else {
      this.pmrem.fromEquirectangular(this.envSrcRT.texture, this.envRT);
    }
  }

  get lutTexture(): THREE.Texture {
    return this.lutRT.texture;
  }

  dispose() {
    this.lutRT.dispose();
    this.envSrcRT.dispose();
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.lutMat.dispose();
    this.envMat.dispose();
    (this.dome.material as THREE.Material).dispose();
    this.dome.geometry.dispose();
    this.lutQuad.dispose();
    this.envQuad.dispose();
  }
}
