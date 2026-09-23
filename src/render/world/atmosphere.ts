/**
 * Physically inspired atmosphere (single scattering Rayleigh + Mie + ozone with a cheap multiple scattering term),
 * evaluated into a small sky-view LUT (absolute azimuth x warped elevation). The sky dome, the environment map
 * and the aerial-perspective fog all sample that LUT so sky, reflections and haze always match.
 * Distances in km inside the model. JS mirror (transmittance only) computes the sun / moon light color.
 */
import * as THREE from 'three';

export const ATMOS_GLSL = /* glsl */ `
#define ATM_RG 6360.0
#define ATM_RT 6460.0
const vec3 ATM_BR = vec3(5.802, 13.558, 33.1) * 1e-3;
const float ATM_HR = 8.0;
const float ATM_BMS = 3.996e-3;
const float ATM_BMA = 4.40e-3;
const float ATM_HM = 1.2;
const vec3 ATM_BO = vec3(0.650, 1.881, 0.085) * 1e-3;

// returns (near, far) intersection distances; far < 0 means miss
vec2 atmRaySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0, -1.0);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

vec3 atmExtinction(float h, float mie) {
  float dR = exp(-h / ATM_HR);
  float dM = exp(-h / ATM_HM);
  float dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  return ATM_BR * dR + (ATM_BMS + ATM_BMA) * mie * dM + ATM_BO * dO;
}

vec3 atmTransmittance(vec3 p, vec3 dir, float mie) {
  vec2 g = atmRaySphere(p, dir, ATM_RG);
  if (g.x > 0.0) return vec3(0.0);
  float tMax = atmRaySphere(p, dir, ATM_RT).y;
  const int STEPS = 6;
  float dt = tMax / float(STEPS);
  vec3 od = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    vec3 q = p + dir * ((float(i) + 0.5) * dt);
    od += atmExtinction(length(q) - ATM_RG, mie) * dt;
  }
  return exp(-od);
}

float atmPhaseR(float mu) { return 0.0596831 * (1.0 + mu * mu); }
float atmPhaseM(float mu, float g) {
  float g2 = g * g;
  return 0.1193662 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

// in-scattered radiance along a view ray from altitude h0 (km), lit by two directional sources
vec3 atmScatter(vec3 rd, float h0, vec3 sunDir, vec3 sunE, vec3 moonDir, vec3 moonE, float mie, out vec3 transmittance) {
  vec3 ro = vec3(0.0, ATM_RG + h0, 0.0);
  float tTop = atmRaySphere(ro, rd, ATM_RT).y;
  vec2 g = atmRaySphere(ro, rd, ATM_RG);
  float tMax = g.x > 0.0 ? g.x : tTop;
  tMax = min(tMax, 400.0);
  const int STEPS = 16;
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  float muS = dot(rd, sunDir);
  float muM = dot(rd, moonDir);
  float pRs = atmPhaseR(muS), pMs = atmPhaseM(muS, 0.8);
  float pRm = atmPhaseR(muM), pMm = atmPhaseM(muM, 0.8);
  float tPrev = 0.0;
  for (int i = 0; i < STEPS; i++) {
    // quadratic sample distribution (denser near the camera)
    float f = (float(i) + 1.0) / float(STEPS);
    float t = tMax * f * f;
    float dt = t - tPrev;
    float tm = tPrev + dt * 0.5;
    tPrev = t;
    vec3 p = ro + rd * tm;
    float h = max(length(p) - ATM_RG, 0.0);
    float dR = exp(-h / ATM_HR);
    float dM = exp(-h / ATM_HM) * mie;
    vec3 ext = atmExtinction(h, mie);
    vec3 segT = exp(-ext * dt);
    vec3 sR = ATM_BR * dR;
    float sM = ATM_BMS * dM;
    vec3 Ts = atmTransmittance(p, sunDir, mie);
    vec3 Tm = atmTransmittance(p, moonDir, mie);
    // single scattering + crude isotropic multiple scattering term
    vec3 ms = (sR + sM) * 0.08;
    vec3 S = (sR * pRs + sM * pMs + ms) * Ts * sunE + (sR * pRm + sM * pMm + ms) * Tm * moonE;
    L += T * (S - S * segT) / max(ext, vec3(1e-7));
    T *= segT;
  }
  transmittance = T;
  return L;
}

// sky-view LUT parameterisation: u = azimuth / 2pi (atan(x, -z)), v = 0.5 + 0.5 * sign(el) * sqrt(|el| / (pi/2))
vec2 atmLutUv(vec3 dir) {
  float az = atan(dir.x, -dir.z);
  float u = az * 0.15915494 + 0.5;
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / 1.5707963);
  return vec2(u, v);
}
vec3 atmLutDir(vec2 uv) {
  float az = (uv.x - 0.5) * 6.2831853;
  float s = (uv.y - 0.5) * 2.0;
  float el = sign(s) * s * s * 1.5707963;
  return vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
}
`;

// ---------------------------------------------------------------------------------------------------------------
// JS mirror (transmittance only)
// ---------------------------------------------------------------------------------------------------------------
const RG = 6360, RT = 6460;
const BR = [5.802e-3, 13.558e-3, 33.1e-3];
const HR = 8, HM = 1.2, BMS = 3.996e-3, BMA = 4.4e-3;
const BO = [0.65e-3, 1.881e-3, 0.085e-3];

function raySphereFar(oy: number, dx: number, dy: number, dz: number, r: number): number {
  // origin (0, oy, 0)
  const b = oy * dy;
  const c = oy * oy - r * r;
  const d = b * b - c;
  if (d < 0) return -1;
  void dx; void dz;
  return -b + Math.sqrt(d);
}

/** transmittance from altitude h0 (km) toward direction dir (unit vector, y up). Writes RGB into out. */
export function atmTransmittanceJS(dir: THREE.Vector3, h0: number, mie: number, out: THREE.Color): THREE.Color {
  const oy = RG + h0;
  const tMax = raySphereFar(oy, dir.x, dir.y, dir.z, RT);
  const steps = 24;
  let odR = 0, odM = 0, odO = 0;
  let prev = 0;
  for (let i = 0; i < steps; i++) {
    const f = (i + 1) / steps;
    const t = tMax * f * f;
    const dt = t - prev;
    const tm = prev + dt * 0.5;
    prev = t;
    const px = dir.x * tm, py = oy + dir.y * tm, pz = dir.z * tm;
    const r = Math.sqrt(px * px + py * py + pz * pz);
    const h = r - RG;
    if (h < -0.05) return out.setRGB(0, 0, 0); // through the planet
    const hh = Math.max(h, 0);
    odR += Math.exp(-hh / HR) * dt;
    odM += Math.exp(-hh / HM) * dt;
    odO += Math.max(0, 1 - Math.abs(hh - 25) / 15) * dt;
  }
  const m = (BMS + BMA) * mie;
  return out.setRGB(
    Math.exp(-(BR[0] * odR + m * odM + BO[0] * odO)),
    Math.exp(-(BR[1] * odR + m * odM + BO[1] * odO)),
    Math.exp(-(BR[2] * odR + m * odM + BO[2] * odO)),
  );
}
