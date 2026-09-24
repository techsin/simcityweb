/**
 * Fireworks — GPU-driven New Year fireworks show over the city.
 *
 *   view.fireworks.start({ population, delay, duration?, seed? })   // first (opening) salvo bursts at `delay` s
 *   view.fireworks.stop()        // no new launches; sparks in flight fade out naturally (stop(true) clears at once)
 *   view.fireworks.active        // true while anything is scheduled, alive or still smoking
 *   view.fireworks.running       // the show is still launching;  .settled: the last shells have bloomed
 *   view.fireworks.centre        // centre of the launch sites (null until the show's sites are collected)
 *   view.fireworks.fastForward(s)  // deterministic jump (screenshots / tests); timeScale = 0 freezes the clock
 *   view.fireworks.onSound = (kind, x, y, z, size, extra) => ...   // launch / burst / crackle events (world pos)
 *
 * Every spark is one instanced quad in a fixed ring buffer (one interleaved Float32 buffer, 24 floats / spark).
 * Sparks are written ONCE when a shell is launched — rocket, rising glitter tail, burst stars, crossette splits and
 * crackle pops all carry future birth times — and the vertex shader evaluates their motion analytically
 * (gravity + linear drag + wind: p(t) = p0 + (v0 - vT)(1 - e^-kt)/k + vT t), so the CPU does no per-spark work per
 * frame; only freshly written ranges are uploaded and only the used part of the ring is drawn. Launches go through a
 * small queue that writes at most ~1400 sparks per frame (big salvos / the grand finale spread over a few frames).
 * Trails are screen-space capsules between p(t) and p(t - τ), split into up to 8 tapered segments; brightness falls
 * off steeply toward the tail, and willow / kamuro / brocade / palm trails use a "hanging" model (short crisp comets
 * while fast, long drooping curtains as they slow down). Stars fade in from zero (the short flash sprite is the
 * break, so a fresh shell is never a white blob), and only warm stars cool to ember orange.
 * The show: opening salvo at "midnight", themed segments (gold / colour pairs / patterns / glitter, mixed in
 * between), choreographed salvos (colours alternate, burst times sweep across the view), a hush, then the finale
 * barrage and the grand finale (a curtain of gold kamuro). The sky is kept layered at every show size; daytime shows
 * use saturated colours and coloured smoke.
 * Also: drifting burst / mortar smoke lit by the bursts, coloured light pools on the ground under fresh bursts, a
 * soft tint of the scene's fill light, a shimmer on the water (render/world/waterFlash.ts) and mirrored sparks.
 * Draw calls while visible: sparks 1 + water reflections 1 (quality >= medium, map with water) + smoke 1 + light 1.
 * The programs are compiled (and the buffers uploaded) by an empty warm-up draw right after construction.
 * Timing is real time (independent of the simulation speed; keeps running while the game is paused).
 */
import * as THREE from 'three';
import { SEA_LEVEL } from '../../../core/constants';
import { sharedUniforms } from '../../../assets/materials';
import type { QualityLevel } from '../../contracts';
import { WATER_FLASHES, clearWaterFlashes, waterFlashUniforms } from '../../world/waterFlash';

// ------------------------------------------------------------------------------------------------ public types
export type LaunchSiteKind = 'park' | 'plaza' | 'landmark' | 'stadium' | 'water' | 'roof' | 'centre';
export interface LaunchSite {
  x: number;
  /** launch height (ground, roof top or water surface) */
  y: number;
  z: number;
  kind: LaunchSiteKind;
  /** relative preference */
  weight: number;
}

export interface FireworksStartOptions {
  /** city population: drives show length (20 s .. 90 s), shell count, calibre and the finale */
  population?: number;
  /** explicit show size 0..1 (overrides the population mapping) */
  intensity?: number;
  /** show length in seconds from the opening salvo to the last finale burst */
  duration?: number;
  /** seconds until the opening salvo bursts ("midnight"); rockets for it launch ~2.6 s earlier. Default 2.8 */
  delay?: number;
  seed?: number;
}

export type FireworksSoundKind = 'launch' | 'whistle' | 'burst' | 'crackle' | 'glitter' | 'salute';
/** (kind, world x/y/z, size: burst radius m (launch: flight s), extra: 0..1 variant / crackle duration s) */
export type FireworksSoundFn = (kind: FireworksSoundKind, x: number, y: number, z: number, size: number, extra: number) => void;

export interface FireworksContext {
  camera: THREE.PerspectiveCamera;
  scene?: THREE.Scene;
  /** launch sites for a new show (parks, landmarks, roofs, waterfront, centre) */
  getSites: () => LaunchSite[];
  /** terrain height (m) at a world position */
  groundAt: (x: number, z: number) => number;
  /** map extent in metres */
  mapSize: number;
  /** water cells (1 = water) of the size x size map; reflections are drawn only over them (checked on start) */
  water?: () => { data: Uint8Array; size: number; cellSize: number } | null;
  quality?: QualityLevel;
  /** the scene's fill light (WorldView's night fill), softly tinted by the bursts; absent / null = no tint */
  fill?: () => THREE.HemisphereLight | null;
}

/** show size 0 (hamlet) .. 1 (metropolis) for a population */
export function fireworksShowSize(population: number): number {
  return clamp01((Math.log10(Math.max(population, 30)) - 1.7) / 4.0);
}

/** default show length (s, opening salvo -> last finale burst): hamlet ~20 s .. town of 5k ~46 s .. metropolis 90 s */
export function fireworksShowLength(population: number): number {
  return 20 + 70 * Math.pow(fireworksShowSize(population), 1.4);
}

// ------------------------------------------------------------------------------------------------ constants
const STRIDE = 24;
const G = 9.81;
// spark kinds (shader)
const K_STAR = 0, K_ROCKET = 1, K_EMBER = 2, K_STROBE = 3, K_CRACKLE = 4, K_FLASH = 5;
/** spark flags (packed into aK.x as 512 * flags): hanging trail model / no fade-in (splits born mid-air) */
const F_HANG = 1, F_SNAP = 2;
// shell types
const S_PEONY = 0, S_CHRYS = 1, S_RING = 2, S_WILLOW = 3, S_BROCADE = 4, S_CROSSETTE = 5, S_PALM = 6, S_STROBE = 7,
  S_CRACKLE = 8, S_MULTI = 9, S_PISTIL = 10, S_CHANGE = 11, S_KAMURO = 12, S_SALUTE = 13, S_HEART = 14;
const SHELL_TYPES = 15;
/** shells fired in synchronized salvos: the first 5 for small towns, palm (the weakest) only for big shows */
const SALVO_TYPES = [S_PEONY, S_RING, S_CHRYS, S_STROBE, S_CHANGE, S_CROSSETTE, S_PISTIL, S_WILLOW, S_PALM];
const SOUND_NAMES: FireworksSoundKind[] = ['launch', 'whistle', 'burst', 'crackle', 'glitter', 'salute'];

// palette
const RED = 0, ORANGE = 1, GOLD = 2, GREEN = 3, CYAN = 4, BLUE = 5, PURPLE = 6, MAGENTA = 7, SILVER = 8, LEMON = 9;
/** linear HDR star colours (before intensity) */
const PALETTE: readonly (readonly [number, number, number])[] = [
  [1.0, 0.09, 0.05], // 0 red
  [1.0, 0.36, 0.05], // 1 orange
  [1.0, 0.52, 0.12], // 2 gold
  [0.22, 1.0, 0.26], // 3 green
  [0.1, 0.8, 1.0], // 4 cyan
  [0.18, 0.32, 1.0], // 5 blue
  [0.66, 0.22, 1.0], // 6 purple
  [1.0, 0.14, 0.5], // 7 magenta
  [0.82, 0.88, 1.0], // 8 silver
  [1.0, 0.9, 0.35], // 9 lemon
];
/** nice two-colour pairings */
const PAIRS: readonly (readonly [number, number])[] = [
  [RED, GREEN], [BLUE, GOLD], [PURPLE, LEMON], [CYAN, MAGENTA], [RED, SILVER], [GREEN, PURPLE], [ORANGE, CYAN], [MAGENTA, GOLD], [BLUE, SILVER], [RED, BLUE],
];
/** curated triads for multi-colour shells (laid out in 2..3 latitude bands) */
const TRIADS: readonly (readonly number[])[] = [[GOLD, RED, SILVER], [BLUE, SILVER, PURPLE], [GREEN, GOLD, LEMON], [MAGENTA, PURPLE, SILVER], [CYAN, BLUE, SILVER]];
/** daytime: silver / lemon / gold wash out against a bright sky */
const DAY_TRIADS: readonly (readonly number[])[] = [[RED, ORANGE, MAGENTA], [BLUE, CYAN, PURPLE], [GREEN, CYAN, BLUE], [MAGENTA, PURPLE, BLUE], [RED, GREEN, ORANGE]];
const DAY_COLS = [RED, ORANGE, GREEN, CYAN, BLUE, PURPLE, MAGENTA];
const MORTAR: readonly [number, number, number] = [1.0, 0.62, 0.3];

// show segments
const TH_MIXED = 0, TH_GOLD = 1, TH_PAIR = 2, TH_PATTERN = 3, TH_GLITTER = 4;

const MAX_LIVE: Record<QualityLevel, number> = { low: 8000, medium: 16000, high: 30000, ultra: 36000 };
const DENSITY: Record<QualityLevel, number> = { low: 0.45, medium: 0.7, high: 1, ultra: 1.12 };
/** smoke puffs per burst by quality (+1 by day; mortar smoke from 2) */
const SMOKE_N: Record<QualityLevel, number> = { low: 1, medium: 1, high: 2, ultra: 2 };
const CAPACITY = 36864;
const MAX_SITES = 48;
/** queued shell launches (floats per entry) and the spark-writing budget per director step */
const QUEUE = 96, QF = 14, SPARKS_PER_FRAME = 1400;
/** the ring wraps at an adaptive point (>= LAP_MIN) that follows the live set, so few dead instances are drawn */
const LAP_MIN = 4096;
/** dirty ranges uploaded per frame (more -> one full upload) */
const MAX_SEGS = 8;
/** burst flash ring (city light, ground pools, water shimmer, pacing) and floats per entry */
const FL = 64, FLS = 8;
/** seconds of launches held back before the finale barrage (show size > 0.3): ~2.2 s of quiet sky */
const HUSH = 3.4;
const SMOKE_CAP = 512, SMOKE_STRIDE = 12;
/** ground light pools (PG x PG vertices each, conformed to the terrain) and their peak brightness */
const NPOOL = 6, PG = 9, POOL_PEAK = 0.17;

// ------------------------------------------------------------------------------------------------ shaders
const VERT = /* glsl */ `
attribute vec4 aP0;  // birth position, birth time
attribute vec4 aV0;  // initial velocity, life
attribute vec4 aC0;  // colour, colour-switch fraction (0 = none)
attribute vec4 aC1;  // second colour, twinkle amount
attribute vec4 aM;   // core radius (m), trail (s), drag (1/s), gravity scale
attribute vec4 aK;   // kind + 8*segment + 64*(segments-1) + 512*flags, seed, wobble (m), strobe (Hz)
uniform float uTime;
uniform vec3 uWind;
uniform vec2 uViewport;
uniform float uMinPx;
uniform float uGain;
uniform float uHalo;
uniform float uWaterY;
uniform float uSat;
uniform float uSizeK;
uniform sampler2D uWaterMask;
uniform float uMaskScale;
varying vec3 vCol;
varying vec2 vQ;
varying vec4 vS;
varying vec2 vH;
varying vec3 vG;

float fwHash(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

vec3 fwPos(float t, float kind) {
  float k = max(aM.z, 0.001);
  float windK = (kind > 0.5 && kind < 1.5) || kind > 4.5 ? 0.0 : 1.0;
  vec3 vT = vec3(uWind.x * windK, -9.81 * aM.w / k, uWind.z * windK);
  float e = (1.0 - exp(-k * t)) / k;
  vec3 p = aP0.xyz + (aV0.xyz - vT) * e + vT * t;
  if (kind > 0.5 && kind < 1.5) {
    float a = aK.z * min(t, 1.5);
    float s = aK.y;
    p.x += (sin(t * 5.3 + s * 40.0) + 0.5 * sin(t * 11.7 + s * 13.0)) * a;
    p.z += (cos(t * 4.1 + s * 23.0) + 0.5 * cos(t * 9.3 + s * 7.0)) * a;
  }
  return p;
}

void main() {
  vCol = vec3(0.0); vQ = vec2(0.0); vS = vec4(0.0, 1.0, 0.0, 0.0); vH = vec2(0.0, 1.0); vG = vec3(0.0);
  float flags = floor(aK.x / 512.0);
  float kp = aK.x - flags * 512.0;
  float kind = mod(kp, 8.0);
  float seg = mod(floor(kp / 8.0), 8.0);
  float segN = floor(kp / 64.0) + 1.0;
  bool hang = mod(flags, 2.0) > 0.5;
  bool snap = mod(floor(flags / 2.0), 2.0) > 0.5;
  float age = uTime - aP0.w;
  float life = aV0.w;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float f = age / life;
  float segLen = aM.y / segN;
  float aH = age - seg * segLen;
  if (aH <= 0.0 && seg > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  aH = max(aH, 0.0);
  float aT = max(aH - segLen, 0.0);
  bool trail = aM.y > 0.0;
  float u0 = seg / segN, u1 = (seg + 1.0) / segN;
  // brightness along the trail: hb at this segment's head, tb at its tail
  float hb = 1.0, tb = 1.0;
  if (trail) {
    if (hang) {
      // hanging (willow / kamuro / brocade / palm) trails: crisp comets while fast, long drooping curtains later
      float kk = mix(0.3, 1.2, smoothstep(0.6, 2.2, age));
      hb = exp(-u0 * aM.y / kk);
      tb = exp(-u1 * aM.y / kk);
    } else {
      // comet: bright head, steeply fading tail (a flat falloff tone-maps into uniform white rods)
      float fo = 1.8 + 2.0 * min(aM.y, 1.5);
      hb = pow(1.0 - u0, fo);
      tb = pow(1.0 - u1, fo);
    }
    if (kind < 0.5) {
      // no spokes back to the burst centre while the end of the trail is still pinned there
      tb *= smoothstep(0.04, 0.3, aT);
      if (seg > 0.5) hb *= smoothstep(0.04, 0.3, aH);
    }
    if (max(hb, tb) < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  }
  vec3 head = fwPos(aH, kind);
  vec3 tail = fwPos(aT, kind);
#ifdef REFLECT
  // mirror across the water plane and slide the mirrored points along the view ray onto the surface, so the
  // reflection is depth-tested against the water / shore / buildings exactly where it appears
  float wy = uWaterY + 0.25;
  float camH = cameraPosition.y - wy;
  if (head.y < uWaterY + 3.0 || camH < 2.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 mh = vec3(head.x, 2.0 * uWaterY - head.y, head.z);
  vec3 mt = vec3(tail.x, 2.0 * uWaterY - max(tail.y, uWaterY + 1.0), tail.z);
  float sH = camH / (cameraPosition.y - mh.y);
  float sT = camH / (cameraPosition.y - mt.y);
  head = cameraPosition + (mh - cameraPosition) * sH;
  tail = cameraPosition + (mt - cameraPosition) * sT;
  // only over water cells (low-lying land near sea level must not mirror)
  if (texture2D(uWaterMask, head.xz * uMaskScale).r < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
#endif
  vec4 vh = viewMatrix * vec4(head, 1.0);
  vec4 vt = viewMatrix * vec4(tail, 1.0);
  if (vh.z > -1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (vt.z > -1.0) vt = vh;
  vec4 ch = projectionMatrix * vh;
  vec4 ct = projectionMatrix * vt;
  vec2 hv = 0.5 * uViewport;
  vec2 sh = ch.xy / ch.w * hv;
  vec2 st = ct.xy / ct.w * hv;
  float pxm = hv.y * projectionMatrix[1][1];
  float rH = aM.x * uSizeK * pxm / ch.w;
  float rT = aM.x * uSizeK * pxm / ct.w;
#ifdef REFLECT
  // sized by the distance of the mirror image, not of the (much closer) point slid onto the water
  rH *= sH;
  rT *= sT;
#endif
  if (trail) {
    // rockets: thin comets;  long (willow / brocade / palm) trails taper to fine threads
    float taper = kind > 0.5 && kind < 1.5 ? 0.15 : (aM.y > 0.5 ? 0.24 : 0.38);
    rH *= mix(1.0, taper, u0);
    rT *= mix(1.0, taper, u1);
  }
  // sub-pixel sparks keep a minimum footprint; their energy falls off (softly) instead
  float energy = rH < uMinPx ? pow(rH / uMinPx, 0.45) : 1.0;
  rH = max(rH, uMinPx);
  rT = max(rT, uMinPx * 0.75);

  // ---- colour & intensity per kind
  vec3 c = aC0.rgb;
  float I = 1.0;
  float halo = uHalo;
  float sharp = 2.4;
  float rnd = fwHash(floor(uTime * 21.0) + aK.y * 4099.0);
  if (kind < 0.5) {
    // star: brief white-hot ignition -> colour (optionally switching) -> warm stars cool to embers
    if (aC0.w > 0.0) c = mix(aC0.rgb, aC1.rgb, smoothstep(aC0.w - 0.05, aC0.w + 0.05, f));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3(1.0, 0.94, 0.82) * max(l, 0.3) * 1.3, (1.0 - smoothstep(0.0, min(0.15, life * 0.08), age)) * 0.4);
    // only warm (charcoal / gold / orange / red) stars turn ember orange; blue / green / purple die in their own hue
    float warm = smoothstep(0.2, 0.6, (aC0.r - aC0.b) / max(aC0.r + aC0.g + aC0.b, 1e-3));
    c = mix(c, vec3(1.0, 0.3, 0.06) * max(l, 0.25) * 1.1, smoothstep(0.5, 1.0, f) * 0.72 * warm);
    I = 1.0 - smoothstep(0.7, 1.0, f);
    // the freshly burst shell is still one tight knot: its stars fade in from zero (the flash sprite is the break)
    if (!snap) { float ei = smoothstep(0.05, 0.25, age); I *= ei * ei; }
    // hanging stars glow up a little as they slow down and droop
    if (hang) I *= mix(0.85, 1.25, smoothstep(0.1, 0.45, f));
    I *= 1.0 - aC1.w * smoothstep(0.4, 0.85, f) * rnd;
  } else if (kind < 1.5) {
    // rocket head: warm glare with a slight flicker
    I = 0.8 + 0.35 * rnd;
    halo *= 1.4;
  } else if (kind < 2.5) {
    // glitter ember: bright pop that twinkles out
    I = (1.0 - f) * (1.0 - f) * (0.25 + 0.95 * rnd);
    c = mix(c * 1.3, c * vec3(1.0, 0.55, 0.3), f);
  } else if (kind < 3.5) {
    // strobe: dark flight, then hard fast blinking (small, no extra halo: not a field of street lamps)
    float on = step(fract(uTime * aK.w + aK.y * 7.0), 0.3);
    I = mix(0.05, on * 2.4, smoothstep(0.1, 0.22, f)) * (1.0 - smoothstep(0.86, 1.0, f));
  } else if (kind < 4.5) {
    // crackle pop
    I = (1.0 - f) * (1.0 - f) * 3.0;
    halo *= 2.0;
  } else {
    // flash (the break of a shell / mortar flash): large soft glow
    I = exp(-f * 4.5) * smoothstep(0.0, 0.05, f);
    halo = 0.0;
    sharp = 1.3;
  }
  float ext = halo > 0.0 ? 3.0 : 1.9;
  float extH = rH * ext, extT = rT * ext;
  float capH = seg < 0.5 ? 1.0 : 0.0;
  float capT = seg > segN - 1.5 ? 1.0 : 0.0;

  vec2 d = sh - st;
  float L = length(d);
  vec2 dir = L > 1e-3 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float a = position.x;
  float s = position.y;
  float e = mix(extT, extH, a);
  float cap = a > 0.5 ? capH : capT;
  vec2 base = mix(st, sh, a);
  vec2 off = dir * (a * 2.0 - 1.0) * e * cap + nrm * s * e;
#ifdef REFLECT
  off.y *= 1.6;
  off.x += sin(base.y * 0.13 + uTime * 2.1 + aK.y * 30.0) * e * 0.5;
  // Fresnel: grazing views mirror the show, looking down the water mostly shows its own colour
  float cosV = clamp(camH / max(length(head - cameraPosition), 1.0), 0.0, 1.0);
  I *= mix(0.35, 0.06, smoothstep(0.08, 0.6, cosV));
#endif
  vQ = vec2(a * L + (a * 2.0 - 1.0) * e * cap, s * e);
  vS = vec4(L, mix(rT, rH, a), hb, tb);
  vH = vec2(halo, sharp);
  // long star trails glitter (broken, twinkling threads) instead of reading as solid rods
  vG = vec3(kind < 0.5 ? smoothstep(0.2, 0.8, aM.y) : 0.0, mix(u1, u0, a), aK.y * 97.0);
  // pre-compensate the night grading's desaturation so shells keep their colour
  float lc = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(vec3(lc) + (c - vec3(lc)) * uSat, vec3(0.0));
  vCol = c * (I * energy * uGain);
  float zH = ch.z / ch.w, zT = ct.z / ct.w;
  gl_Position = vec4((base + off) / hv, mix(zT, zH, a), 1.0);
}`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying vec2 vQ;
varying vec4 vS;
varying vec2 vH;
varying vec3 vG;
uniform float uTime;
void main() {
  float L = vS.x;
  float ax = clamp(vQ.x, 0.0, L);
  float d = length(vec2(vQ.x - ax, vQ.y)) / max(vS.y, 1e-3);
  float g = L > 1e-3 ? ax / L : 1.0;
  float br = mix(vS.w, vS.z, g);
  if (vG.x > 0.0) {
    float cell = floor(vQ.x * 0.6 + vG.z);
    float h = fract(sin(cell * 12.9898 + floor(uTime * 14.0 + vG.z) * 78.233) * 43758.5453);
    // mostly dim embers with a few bright twinkles (not a regular dashed line)
    br *= mix(1.0, h * h * h * 3.6, vG.x * smoothstep(0.03, 0.25, vG.y));
  }
#ifdef REFLECT
  // wind ripples break the mirrored streaks into flickering bands (about half of each streak drops out)
  float band = fract(sin(floor(gl_FragCoord.y * 0.42 + uTime * 6.0) * 91.7 + vG.z) * 43758.5453);
  br *= step(0.5, band) * 1.6;
#endif
  float core = exp(-d * d * vH.y);
  float halo = vH.x * exp(-d * 1.2) * (1.0 - smoothstep(2.2, 3.0, d));
  gl_FragColor = vec4(vCol * ((core + halo) * br), 1.0);
}`;

/** drifting smoke puffs (premultiplied alpha): lit by the sky / city glow, their own burst and nearby flashes */
const SMOKE_VERT = /* glsl */ `
attribute vec4 aA;  // position, birth time
attribute vec4 aB;  // radius (m), life (s), seed, opacity
attribute vec4 aC;  // tint colour, persistent tint (coloured daytime smoke)
uniform float uTime;
uniform vec3 uWind;
uniform vec3 uAmb;
uniform float uGlow;
uniform float uFlashK;
uniform vec4 uFlashPos[${WATER_FLASHES}];
uniform vec3 uFlashCol[${WATER_FLASHES}];
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
void main() {
  vUv = position.xy;
  vCol = vec4(0.0);
  vSeed = aB.z;
  float age = uTime - aA.w;
  float life = aB.y;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float f = age / life;
  vec3 p = aA.xyz + uWind * (age * 0.85) + vec3(0.0, 1.1 * age, 0.0);
  p.x += sin(aB.z * 17.0 + age * 0.33) * age * 0.9;
  p.z += cos(aB.z * 11.0 + age * 0.29) * age * 0.9;
  float r = aB.x * (0.55 + 0.95 * sqrt(f));
  vec3 lit = mix(uAmb, uAmb * aC.rgb * 1.8, aC.w) + aC.rgb * uGlow * exp(-age * 2.2);
  for (int i = 0; i < ${WATER_FLASHES}; i++) {
    vec3 L = uFlashPos[i].xyz - p;
    float R0 = uFlashPos[i].w * 1.5;
    lit += uFlashCol[i] * (uFlashK * R0 * R0 / (R0 * R0 + dot(L, L)));
  }
  float al = aB.w * smoothstep(0.0, 0.06, f) * pow(1.0 - f, 1.4);
  vCol = vec4(lit * al, al);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float ang = aB.z * 6.2831 + age * 0.05;
  vec2 q = vec2(position.x * cos(ang) - position.y * sin(ang), position.x * sin(ang) + position.y * cos(ang));
  mv.xy += q * r;
  gl_Position = projectionMatrix * mv;
}`;

const SMOKE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
float smH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float smN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(smH(i), smH(i + vec2(1.0, 0.0)), f.x), mix(smH(i + vec2(0.0, 1.0)), smH(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float d = length(vUv);
  if (d > 1.0) discard;
  float n = smN(vUv * 2.1 + vSeed * 17.0) * 0.6 + smN(vUv * 4.6 - vSeed * 9.0) * 0.4;
  float m = smoothstep(1.0, 0.1, d + (n - 0.5) * 0.6);
  gl_FragColor = vCol * m;
}`;

/** coloured light on the ground under a fresh burst (additive; the disc is conformed to the terrain on the CPU) */
const POOL_VERT = /* glsl */ `
attribute vec3 aLocal;  // disc coordinates (-1..1), pool index
uniform vec3 uPoolC[${NPOOL}];
varying vec3 vCol;
varying vec2 vL;
void main() {
  vL = aLocal.xy;
  vCol = uPoolC[int(aLocal.z + 0.5)];
  if (vCol.r + vCol.g + vCol.b < 1e-5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const POOL_FRAG = /* glsl */ `
varying vec3 vCol;
varying vec2 vL;
void main() {
  float r2 = dot(vL, vL);
  if (r2 > 1.0) discard;
  // ground irradiance under a point light at height H (disc radius 2.5 H): (1 + (r/H)^2)^-1.5, faded out at the rim
  float e = pow(1.0 + 6.25 * r2, -1.5) * (1.0 - r2);
  gl_FragColor = vec4(vCol * e, 1.0);
}`;

// ------------------------------------------------------------------------------------------------ helpers
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

const _v = new THREE.Vector3();

interface Tpl {
  kind: number;
  px: number; py: number; pz: number; t0: number;
  vx: number; vy: number; vz: number; life: number;
  r: number; g: number; b: number; sw: number;
  r2: number; g2: number; b2: number; tw: number;
  size: number; trail: number; drag: number; grav: number;
  seed: number; wob: number; strobe: number; segN: number;
  flags: number;
}

// ================================================================================================ Fireworks
export class Fireworks {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly reflection: THREE.Mesh;
  /** drifting burst / mortar smoke (premultiplied alpha, drawn before the sparks) */
  readonly smoke: THREE.Mesh;
  /** coloured light pools on the ground under fresh bursts (additive, night only) */
  readonly pools: THREE.Mesh;
  /** called when a launch / burst / crackle happens (real show time, not delayed by distance) */
  onSound: FireworksSoundFn | null = null;
  /** show clock multiplier (0 freezes the show, e.g. for screenshots) */
  timeScale = 1;
  /** CPU ms of the last update() */
  lastUpdateMs = 0;
  /** sparks that could not be allocated (budget overflow; should stay 0) */
  dropped = 0;
  /** total sparks written this show */
  spawned = 0;
  /** shells launched this show */
  shells = 0;

  private ctx: FireworksContext;
  // ---- spark ring buffer
  private data: Float32Array;
  private buf: THREE.InstancedInterleavedBuffer;
  private geo: THREE.InstancedBufferGeometry;
  private death = new Float32Array(CAPACITY);
  private cap = CAPACITY;
  private maxLive = 30000;
  private density = 1;
  private cursor = 0;
  private advanced = 0;
  /** where the ring wraps (adaptive, LAP_MIN .. cap) */
  private lap = LAP_MIN;
  /** start of the dirty segment the cursor is writing, and the closed segments of this frame (start, end pairs) */
  private dirtyFrom = 0;
  private segs = new Int32Array(MAX_SEGS * 2);
  private segCount = 0;
  private fullUpload = false;
  /** highest ring slot in use (+1): the number of instances drawn */
  private high = 0;
  /** latest death time written (clock): nothing left to draw after it */
  private lastDeath = -1e9;
  private ranges = Array.from({ length: MAX_SEGS }, () => ({ start: 0, count: 0 }));
  private uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3() },
    uViewport: { value: new THREE.Vector2(1920, 1080) },
    uMinPx: { value: 0.8 },
    uGain: { value: 1 },
    uHalo: { value: 0.14 },
    uWaterY: { value: SEA_LEVEL },
    uSat: { value: 1.2 },
    uSizeK: { value: 1 },
    uWaterMask: { value: null as THREE.Texture | null },
    uMaskScale: { value: 1 },
  };
  private tpl: Tpl = {
    kind: 0, px: 0, py: 0, pz: 0, t0: 0, vx: 0, vy: 0, vz: 0, life: 1, r: 1, g: 1, b: 1, sw: 0, r2: 0, g2: 0, b2: 0, tw: 0,
    size: 1, trail: 0, drag: 1, grav: 1, seed: 0, wob: 0, strobe: 0, segN: 1, flags: 0,
  };
  private quality: QualityLevel;
  private reflectOn = true;
  private hasWater = false;
  /** frames left of the empty warm-up draw (compiles the programs and uploads the buffers ahead of the first show) */
  private warm = 2;

  // ---- smoke ring buffer
  private smokeData = new Float32Array(SMOKE_CAP * SMOKE_STRIDE);
  private smokeBuf: THREE.InstancedInterleavedBuffer;
  private smokeGeo: THREE.InstancedBufferGeometry;
  private smokeCursor = 0;
  private smokeHigh = 0;
  private smokeEnd = -1e9;
  private smokeDirty = false;
  private smokeN = 2;
  private smokeU = { uAmb: { value: new THREE.Vector3() }, uGlow: { value: 0.6 }, uFlashK: { value: 1.2 } };

  // ---- ground light pools
  private poolGeo: THREE.BufferGeometry;
  private poolPos: THREE.BufferAttribute;
  private poolC = Array.from({ length: NPOOL }, () => new THREE.Vector3());
  /** flash entry lit by each pool (-1 free) and each flash's pool (-1 none yet, -2 lost it) */
  private poolFl = new Int16Array(NPOOL).fill(-1);
  private flPool = new Int8Array(FL).fill(-1);
  private poolE = new Float32Array(NPOOL);
  /** 1/H^2 brightness factor of each pool (lower bursts light the ground more) */
  private poolK = new Float32Array(NPOOL);

  // ---- show state
  private clock = 0;
  /** clock at start(): a new show can take over while the last one's sparks still fade out */
  private t0 = 0;
  private running = false;
  private endAt = -1;
  private seed = 1;
  private k = 0.5;
  private duration = 60;
  private delay = 2.8;
  private opened = false;
  /** launch sites etc. are collected on the first update after start() (not on the frame the year ticks over) */
  private pendingInit = false;
  private nextShot = 0;
  private nextSalvo = 0;
  private finaleAt = 0;
  private grandDone = false;
  private lastType = -1;
  private lastShotU = -1e9;
  /** clock time of the latest burst written */
  private lastBurstAt = -1e9;
  private live = 0;
  private liveClock = -1;
  private sites: LaunchSite[] = [];
  private windX = 0;
  private windZ = 0;
  private suppressSound = false;
  private heightScale = 1;
  /** launch-site bounds + margin (x0, x1, z0, z1) */
  private bb = new Float64Array(4);
  /** centre of the launch sites (camera distance -> spark size; the show camera frames it) */
  private cx = 0;
  private cz = 0;
  private siteScore = new Float32Array(MAX_SITES);
  /** the sky is bright: saturated colours, no silver / strobes, coloured smoke */
  private dayShow = false;
  // themed segments
  private theme = TH_MIXED;
  private themeUntil = 0;
  private themePair = 0;
  private themeFlip = 0;
  private themeSeq = 0;
  private themeOrder = [TH_GOLD, TH_PAIR, TH_PATTERN, TH_GLITTER];

  // ---- sound events (unsorted pool)
  private sndT = new Float64Array(256);
  private sndK = new Int8Array(256).fill(-1);
  private sndP = new Float32Array(256 * 5);
  // ---- burst flashes (light on the city, ground pools, water, smoke; pacing)
  private flT = new Float64Array(FL).fill(-1e9);
  /** 1 = the burst belongs to a synchronized salvo / the opening / the finale */
  private flS = new Uint8Array(FL);
  private flP = new Float32Array(FL * FLS);
  private flI = 0;
  private topI = new Int16Array(WATER_FLASHES);
  private topE = new Float32Array(WATER_FLASHES);
  // ---- fill light tint (delta-tracked: works whether or not someone rewrites the light every frame)
  private fillLight: THREE.HemisphereLight | null = null;
  private fillTouched = false;
  private fillSetI = 0;
  private fillAdd = 0;
  private fillBase = new THREE.Color();
  private fillSet = new THREE.Color();

  constructor(ctx: FireworksContext) {
    this.ctx = ctx;
    this.quality = ctx.quality ?? 'high';
    // sparks
    this.data = new Float32Array(CAPACITY * STRIDE);
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.InstancedBufferGeometry();
    // quad: x = along (0 tail .. 1 head), y = side (-1 .. 1)
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const names = ['aP0', 'aV0', 'aC0', 'aC1', 'aM', 'aK'];
    names.forEach((n, i) => g.setAttribute(n, new THREE.InterleavedBufferAttribute(this.buf, 4, i * 4)));
    g.instanceCount = 0;
    this.geo = g;
    const mk = (reflect: boolean) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: this.uniforms,
        defines: reflect ? { REFLECT: 1 } : {},
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendEquation: THREE.AddEquation,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = reflect ? 7 : 8;
      mesh.visible = false;
      mesh.name = reflect ? 'fireworksReflection' : 'fireworks';
      mesh.onBeforeRender = (renderer) => {
        const rt = renderer.getRenderTarget();
        if (rt) this.uniforms.uViewport.value.set(rt.width, rt.height);
        else renderer.getDrawingBufferSize(this.uniforms.uViewport.value);
      };
      return mesh;
    };
    this.mesh = mk(false);
    this.reflection = mk(true);

    // smoke
    const sg = new THREE.InstancedBufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
    sg.setIndex([0, 1, 2, 2, 1, 3]);
    this.smokeBuf = new THREE.InstancedInterleavedBuffer(this.smokeData, SMOKE_STRIDE, 1);
    this.smokeBuf.setUsage(THREE.DynamicDrawUsage);
    ['aA', 'aB', 'aC'].forEach((n, i) => sg.setAttribute(n, new THREE.InterleavedBufferAttribute(this.smokeBuf, 4, i * 4)));
    sg.instanceCount = 0;
    this.smokeGeo = sg;
    const smokeMat = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      uniforms: {
        uTime: this.uniforms.uTime,
        uWind: this.uniforms.uWind,
        uAmb: this.smokeU.uAmb,
        uGlow: this.smokeU.uGlow,
        uFlashK: this.smokeU.uFlashK,
        uFlashPos: waterFlashUniforms.uFlashPos,
        uFlashCol: waterFlashUniforms.uFlashCol,
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    });
    this.smoke = new THREE.Mesh(sg, smokeMat);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 6;
    this.smoke.visible = false;
    this.smoke.name = 'fireworksSmoke';

    // ground light pools
    const nv = NPOOL * PG * PG;
    const pos = new Float32Array(nv * 3);
    const loc = new Float32Array(nv * 3);
    const idx: number[] = [];
    for (let j = 0; j < NPOOL; j++) {
      for (let gz = 0; gz < PG; gz++) {
        for (let gx = 0; gx < PG; gx++) {
          const v = j * PG * PG + gz * PG + gx;
          loc[v * 3] = (gx / (PG - 1)) * 2 - 1;
          loc[v * 3 + 1] = (gz / (PG - 1)) * 2 - 1;
          loc[v * 3 + 2] = j;
          pos[v * 3 + 1] = -1e4;
        }
      }
      for (let gz = 0; gz < PG - 1; gz++) {
        for (let gx = 0; gx < PG - 1; gx++) {
          const a = j * PG * PG + gz * PG + gx, b = a + 1, c = a + PG, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
    }
    const pg = new THREE.BufferGeometry();
    this.poolPos = new THREE.BufferAttribute(pos, 3);
    this.poolPos.setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('position', this.poolPos);
    pg.setAttribute('aLocal', new THREE.BufferAttribute(loc, 3));
    pg.setIndex(idx);
    this.poolGeo = pg;
    const poolMat = new THREE.ShaderMaterial({
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      uniforms: { uPoolC: { value: this.poolC } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    });
    this.pools = new THREE.Mesh(pg, poolMat);
    this.pools.frustumCulled = false;
    this.pools.renderOrder = 3;
    this.pools.visible = false;
    this.pools.name = 'fireworksLight';

    this.group.name = 'fireworks';
    this.group.add(this.pools, this.smoke, this.reflection, this.mesh);
    this.clearAll();
    this.setQuality(this.quality);
  }

  // ------------------------------------------------------------------------------------------------ public API
  /** true while a show is running or sparks / smoke are still alive */
  get active(): boolean {
    return this.running || this.clock < this.endAt;
  }
  /** true while the show is still launching shells */
  get isRunning(): boolean {
    return this.running;
  }
  /** the show has stopped launching and its last shells bloomed a while ago (only fading embers / smoke remain) */
  get settled(): boolean {
    return !this.active || (!this.running && this.qN === 0 && this.clock >= this.lastBurstAt + 2.2);
  }
  /** seconds since start() (show clock) */
  get time(): number {
    return this.clock - this.t0;
  }
  /** show clock time of the opening salvo ("midnight") */
  get midnight(): number {
    return this.delay;
  }
  /** show length (opening salvo -> last finale burst) */
  get showDuration(): number {
    return this.duration;
  }
  /** show size 0..1 */
  get showSize(): number {
    return this.k;
  }
  /** default show length (s) for a city of `population` */
  lengthFor(population: number): number {
    return fireworksShowLength(population);
  }
  /** centre of the launch sites (null until the show's sites are collected, one update after start) */
  get centre(): { x: number; z: number } | null {
    return this.running && !this.pendingInit ? { x: this.cx, z: this.cz } : null;
  }
  /** approximate number of sparks alive or scheduled (O(used ring); for stats overlays, not per-frame logic) */
  get liveCount(): number {
    return this.active ? this.countLive() : 0;
  }
  get drawCalls(): number {
    return (this.mesh.visible ? 1 : 0) + (this.reflection.visible ? 1 : 0) + (this.smoke.visible ? 1 : 0) + (this.pools.visible ? 1 : 0);
  }

  setQuality(q: QualityLevel): void {
    this.quality = q;
    this.maxLive = MAX_LIVE[q] ?? 30000;
    this.density = DENSITY[q] ?? 1;
    this.starK = Math.pow(DENSITY.low / this.density, 0.35);
    this.cap = Math.min(CAPACITY, Math.ceil(this.maxLive * 1.2));
    this.lap = Math.min(this.cap, Math.max(this.lap, LAP_MIN));
    if (this.cursor >= this.lap) this.cursor = 0;
    // the next flush must not build an update range from stale bounds beyond a smaller ring: upload it whole once
    this.dirtyFrom = this.cursor;
    this.segCount = 0;
    this.fullUpload = true;
    this.high = Math.min(this.high, this.cap);
    this.reflectOn = q !== 'low';
    if (this.reflectOn && !this.hasWater && this.running && !this.pendingInit) this.hasWater = this.updateWaterMask();
    this.smokeN = SMOKE_N[q] ?? 2;
    this.uniforms.uHalo.value = q === 'low' ? 0.08 : 0.14;
    this.uniforms.uMinPx.value = q === 'low' ? 0.8 : 0.9;
  }

  start(opts: FireworksStartOptions = {}): void {
    // a new show while the last one's sparks still fade out takes over smoothly (nothing is cleared)
    if (this.active && this.clock > 0) this.qN = this.qHead = 0;
    else this.clearAll();
    this.t0 = this.clock;
    const pop = Math.max(0, opts.population ?? 2000);
    this.k = opts.intensity !== undefined ? clamp01(opts.intensity) : fireworksShowSize(pop);
    const k = this.k;
    this.duration = Math.max(6, opts.duration ?? 20 + 70 * Math.pow(k, 1.4));
    this.delay = Math.max(0, opts.delay ?? 2.8);
    this.seed = ((opts.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0) || 1;
    this.running = true;
    this.opened = false;
    this.pendingInit = true;
    this.lastShotU = -1e9;
    this.grandDone = false;
    this.lastType = -1;
    this.nextShot = lerp(1.6, 0.9, k);
    this.nextSalvo = lerp(11, 6.5, k) + this.rnd() * 3;
    this.finaleAt = this.duration - lerp(3.5, 15, k);
    // (upper bound while running; the real end is known once the show stops launching)
    this.endAt = this.t0 + this.delay + this.duration + 14;
    this.theme = TH_MIXED;
    this.themeUntil = lerp(5, 8, k) + this.rnd() * 3;
    this.themeSeq = 0;
    const o = this.themeOrder;
    for (let i = o.length - 1; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1));
      const t = o[i];
      o[i] = o[j];
      o[j] = t;
    }
    this.shells = 0;
    this.spawned = 0;
    this.dropped = 0;
  }

  /** stop launching; with immediate=true everything disappears at once */
  stop(immediate = false): void {
    this.running = false;
    this.pendingInit = false;
    this.qN = this.qHead = 0;
    if (immediate) {
      this.endAt = -1;
      this.clearAll();
      this.hide();
    } else {
      this.endAt = Math.min(this.endAt, this.naturalEnd());
    }
  }

  /** advance the show deterministically by `seconds` (no sounds; for screenshots / tests) */
  fastForward(seconds: number): void {
    this.suppressSound = true;
    let left = Math.max(0, seconds);
    while (left > 1e-6) {
      const d = Math.min(1 / 30, left);
      this.clock += d;
      this.direct();
      left -= d;
    }
    this.suppressSound = false;
    this.sndK.fill(-1);
    this.uniforms.uTime.value = this.clock;
  }

  update(dt: number): void {
    const t0 = performance.now();
    if (!this.active) {
      if (this.warm > 0) this.warmUp();
      else if (this.mesh.visible || this.reflection.visible || this.smoke.visible || this.pools.visible) this.hide();
      this.lastUpdateMs = 0;
      return;
    }
    this.clock += Math.max(0, Math.min(dt, 0.1)) * this.timeScale;
    this.direct();
    this.dispatchSounds();
    this.updateLights();
    this.flush();
    const u = this.uniforms;
    u.uTime.value = this.clock;
    // brighter by day so a daytime show still reads (it looks pale, as real ones do)
    const night = sharedUniforms.uNight.value;
    u.uGain.value = lerp(2.2, 1.0, night);
    // WorldView grades night scenes with saturation 1.08 - 0.32 * night: undo that for the fireworks (+ a bit)
    u.uSat.value = Math.min(1.5, 1.1 / Math.max(0.6, 1.08 - 0.32 * night));
    // zoomed far out: fatter sparks so the bursts still read as crisp sparkles instead of fading to sub-pixel dust
    const cp = this.ctx.camera.position;
    const cd = Math.hypot(cp.x - this.cx, cp.y - 220, cp.z - this.cz);
    const far = clamp01((cd - 1300) / 4200);
    u.uSizeK.value = 1 + 1.7 * far * far * (3 - 2 * far);
    // smoke light: faint sky / city glow at night, daylight grey by day
    this.smokeU.uAmb.value.set(lerp(0.62, 0.03, night), lerp(0.62, 0.027, night), lerp(0.66, 0.031, night));
    this.smokeU.uGlow.value = lerp(0.12, 0.55, night);
    const vis = this.clock < this.lastDeath;
    this.mesh.visible = vis;
    this.reflection.visible = vis && this.reflectOn && this.hasWater;
    this.smoke.visible = this.smokeHigh > 0 && this.clock < this.smokeEnd;
    if (!this.active) this.hide();
    this.lastUpdateMs = performance.now() - t0;
  }

  dispose(): void {
    this.hide();
    this.maskTex?.dispose();
    this.geo.dispose();
    this.smokeGeo.dispose();
    this.poolGeo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    (this.reflection.material as THREE.Material).dispose();
    (this.smoke.material as THREE.Material).dispose();
    (this.pools.material as THREE.Material).dispose();
  }

  // ------------------------------------------------------------------------------------------------ buffer
  private clearAll(): void {
    // no GPU upload needed: nothing beyond `high` is drawn and every slot below it is rewritten before it is
    this.death.fill(-1e9);
    this.qN = this.qHead = 0;
    this.cursor = 0;
    this.advanced = 0;
    this.lap = Math.min(this.cap, LAP_MIN);
    this.dirtyFrom = 0;
    this.segCount = 0;
    this.high = 0;
    this.lastDeath = -1e9;
    this.lastBurstAt = -1e9;
    this.clock = 0;
    this.t0 = 0;
    this.live = 0;
    this.liveClock = -1;
    this.sndK.fill(-1);
    this.flT.fill(-1e9);
    this.flPool.fill(-1);
    this.poolFl.fill(-1);
    this.smokeCursor = 0;
    this.smokeHigh = 0;
    this.smokeEnd = -1e9;
    this.uniforms.uTime.value = 0;
    this.geo.instanceCount = 0;
    this.smokeGeo.instanceCount = 0;
  }

  /** draw every material once with nothing in it: compiles the programs for the real render target + state */
  private warmUp(): void {
    this.warm--;
    this.geo.instanceCount = 0;
    this.smokeGeo.instanceCount = 0;
    this.poolGeo.setDrawRange(0, 0);
    this.mesh.visible = this.reflection.visible = this.smoke.visible = this.pools.visible = true;
  }

  /** (re)build the water mask texture; false when the map has no water */
  private updateWaterMask(): boolean {
    const w = this.ctx.water?.();
    if (!w || !w.data.includes(1)) return false;
    const N = w.size;
    let tex = this.maskTex;
    if (!tex || tex.image.width !== N) {
      tex?.dispose();
      tex = new THREE.DataTexture(new Uint8Array(N * N), N, N, THREE.RedFormat, THREE.UnsignedByteType);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      this.maskTex = tex;
    }
    const d = tex.image.data as Uint8Array;
    for (let i = 0; i < N * N; i++) d[i] = w.data[i] ? 255 : 0;
    tex.needsUpdate = true;
    this.uniforms.uWaterMask.value = tex;
    this.uniforms.uMaskScale.value = 1 / (N * w.cellSize);
    return true;
  }
  private maskTex: THREE.DataTexture | null = null;

  private hide(): void {
    this.mesh.visible = false;
    this.reflection.visible = false;
    this.smoke.visible = false;
    this.pools.visible = false;
    this.poolGeo.setDrawRange(0, Infinity);
    for (const c of this.poolC) c.set(0, 0, 0);
    clearWaterFlashes();
    this.restoreFill();
  }

  private alloc(): number {
    const now = this.clock;
    for (let n = 0; n < 768; n++) {
      let i = this.cursor;
      if (i >= this.lap) {
        this.closeSeg();
        this.newLap();
        i = this.cursor = this.dirtyFrom = 0;
      }
      this.cursor = i + 1;
      this.advanced++;
      if (this.death[i] < now) {
        if (i >= this.high) this.high = i + 1;
        return i;
      }
      // a long run of live sparks: the window is packed, grow it (the slots past the lap are free)
      if ((n & 127) === 127 && this.lap < this.cap) {
        this.closeSeg();
        this.cursor = this.dirtyFrom = this.lap;
        this.lap = Math.min(this.cap, Math.ceil(this.lap * 1.4));
      }
    }
    this.dropped++;
    return -1;
  }

  /** at each wrap: shrink the lap toward what is alive now, when everything above the new lap is dead */
  private newLap(): void {
    const want = Math.max(LAP_MIN, Math.ceil(this.countLive() * 2));
    if (want >= this.lap * 0.7) return;
    const d = this.death, now = this.clock;
    for (let j = want; j < this.high; j++) if (d[j] >= now) return;
    this.lap = want;
    this.high = Math.min(this.high, want);
  }

  /** close the dirty segment [dirtyFrom, cursor) of this frame */
  private closeSeg(): void {
    const a = this.dirtyFrom, b = this.cursor;
    if (b <= a) return;
    if (this.segCount >= MAX_SEGS) {
      this.fullUpload = true;
      return;
    }
    this.segs[this.segCount * 2] = a;
    this.segs[this.segCount * 2 + 1] = b;
    this.segCount++;
  }

  /** write the template spark (tpl.segN slots, one per trail segment) */
  private put(): void {
    const s = this.tpl;
    const a = this.data;
    const segN = Math.max(1, Math.min(8, s.segN | 0));
    for (let seg = 0; seg < segN; seg++) {
      const i = this.alloc();
      if (i < 0) return;
      const o = i * STRIDE;
      a[o] = s.px; a[o + 1] = s.py; a[o + 2] = s.pz; a[o + 3] = s.t0;
      a[o + 4] = s.vx; a[o + 5] = s.vy; a[o + 6] = s.vz; a[o + 7] = s.life;
      a[o + 8] = s.r; a[o + 9] = s.g; a[o + 10] = s.b; a[o + 11] = s.sw;
      a[o + 12] = s.r2; a[o + 13] = s.g2; a[o + 14] = s.b2; a[o + 15] = s.tw;
      a[o + 16] = s.size; a[o + 17] = s.trail; a[o + 18] = s.drag; a[o + 19] = s.grav;
      a[o + 20] = s.kind + 8 * seg + 64 * (segN - 1) + 512 * s.flags; a[o + 21] = s.seed; a[o + 22] = s.wob; a[o + 23] = s.strobe;
      const dies = s.t0 + s.life + 0.05;
      this.death[i] = dies;
      if (dies > this.lastDeath) this.lastDeath = dies;
      if (i >= this.high) this.high = i + 1;
      this.live++;
      this.spawned++;
    }
  }

  private flush(): void {
    const b = this.buf;
    this.closeSeg();
    if (this.fullUpload || this.advanced >= this.cap) {
      this.fullUpload = false;
      b.clearUpdateRanges();
      b.needsUpdate = true;
    } else if (this.segCount > 0) {
      b.clearUpdateRanges();
      for (let k = 0; k < this.segCount; k++) {
        const r = this.ranges[k];
        r.start = this.segs[k * 2] * STRIDE;
        r.count = (this.segs[k * 2 + 1] - this.segs[k * 2]) * STRIDE;
        b.updateRanges.push(r);
      }
      b.needsUpdate = true;
    }
    this.segCount = 0;
    this.advanced = 0;
    this.dirtyFrom = this.cursor;
    this.geo.instanceCount = Math.min(this.cap, this.high);
    if (this.smokeDirty) {
      this.smokeDirty = false;
      this.smokeBuf.needsUpdate = true;
    }
    this.smokeGeo.instanceCount = this.smokeHigh;
  }

  private countLive(): number {
    if (this.liveClock === this.clock) return this.live;
    const d = this.death, now = this.clock;
    let n = 0;
    for (let i = 0, c = Math.min(this.cap, this.high); i < c; i++) if (d[i] >= now) n++;
    this.live = n;
    this.liveClock = this.clock;
    return n;
  }

  /** when the last spark / smoke puff written so far is gone */
  private naturalEnd(): number {
    return Math.max(Math.min(this.lastDeath, this.clock + 9), Math.min(this.smokeEnd, this.clock + 13), this.clock) + 0.1;
  }

  // ------------------------------------------------------------------------------------------------ smoke
  private puff(x: number, y: number, z: number, t0: number, r: number, life: number, alpha: number, col: readonly [number, number, number], tint: number): void {
    const i = this.smokeCursor;
    this.smokeCursor = i + 1 >= SMOKE_CAP ? 0 : i + 1;
    const o = i * SMOKE_STRIDE, d = this.smokeData;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = t0;
    d[o + 4] = r; d[o + 5] = life; d[o + 6] = this.rnd(); d[o + 7] = alpha;
    d[o + 8] = col[0]; d[o + 9] = col[1]; d[o + 10] = col[2]; d[o + 11] = tint;
    if (i >= this.smokeHigh) this.smokeHigh = i + 1;
    if (t0 + life > this.smokeEnd) this.smokeEnd = t0 + life;
    this.smokeDirty = true;
  }

  /** a burst leaves a small cloud of smoke (coloured by day); lit later by the bursts around it */
  private burstSmoke(x: number, y: number, z: number, tb: number, R: number, col: readonly [number, number, number]): void {
    const day = this.dayShow;
    const n = this.smokeN + (day ? 1 : 0);
    for (let i = 0; i < n; i++) {
      this.puff(x + this.rr(-0.3, 0.3) * R, y + this.rr(-0.3, 0.1) * R, z + this.rr(-0.3, 0.3) * R, tb + this.rr(0.05, 0.3),
        R * this.rr(0.3, 0.45), day ? this.rr(6, 8) : this.rr(7, 10), day ? 0.3 : 0.2, col, day ? 0.6 : 0);
    }
  }

  // ------------------------------------------------------------------------------------------------ random
  private rnd(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  private rr(a: number, b: number): number {
    return a + (b - a) * this.rnd();
  }

  // ------------------------------------------------------------------------------------------------ motion (CPU twin of fwPos)
  private px = 0; private py = 0; private pz = 0;
  private vx = 0; private vy = 0; private vz = 0;

  /** position (px/py/pz) and velocity (vx/vy/vz) of a spark `t` s after birth */
  private motion(x: number, y: number, z: number, vx: number, vy: number, vz: number, k: number, gs: number, wind: boolean, t: number): void {
    const kk = Math.max(k, 0.001);
    const tx = wind ? this.windX : 0, ty = (-G * gs) / kk, tz = wind ? this.windZ : 0;
    const ek = Math.exp(-kk * t);
    const e = (1 - ek) / kk;
    this.px = x + (vx - tx) * e + tx * t;
    this.py = y + (vy - ty) * e + ty * t;
    this.pz = z + (vz - tz) * e + tz * t;
    this.vx = tx + (vx - tx) * ek;
    this.vy = ty + (vy - ty) * ek;
    this.vz = tz + (vz - tz) * ek;
  }
  private wobX(t: number, s: number, amp: number): number {
    return (Math.sin(t * 5.3 + s * 40) + 0.5 * Math.sin(t * 11.7 + s * 13)) * amp * Math.min(t, 1.5);
  }
  private wobZ(t: number, s: number, amp: number): number {
    return (Math.cos(t * 4.1 + s * 23) + 0.5 * Math.cos(t * 9.3 + s * 7)) * amp * Math.min(t, 1.5);
  }

  // ------------------------------------------------------------------------------------------------ director
  private direct(): void {
    if (!this.running) return;
    if (this.pendingInit) this.initShow();
    this.directShow();
    this.drain();
  }

  /** the expensive part of start(): launch sites, wind, bounds, water mask, fill light */
  private initShow(): void {
    this.pendingInit = false;
    this.sites = this.cleanSites(this.ctx.getSites());
    const ang = this.rnd() * Math.PI * 2, ws = 0.6 + this.rnd() * 2.2;
    this.windX = Math.cos(ang) * ws;
    this.windZ = Math.sin(ang) * ws;
    this.uniforms.uWind.value.set(this.windX, 0, this.windZ);
    // heights scale gently with the developed extent of the city
    let ext = 0;
    if (this.sites.length > 1) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const s of this.sites) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
      ext = Math.hypot(x1 - x0, z1 - z0);
    }
    this.cx = this.cz = 0;
    for (const s of this.sites) { this.cx += s.x / this.sites.length; this.cz += s.z / this.sites.length; }
    if (!this.sites.length) this.cx = this.cz = this.ctx.mapSize / 2;
    // virtual launch points must stay within the city's footprint (+ margin)
    const bb = this.bb;
    bb[0] = bb[2] = Infinity; bb[1] = bb[3] = -Infinity;
    for (const s of this.sites) { bb[0] = Math.min(bb[0], s.x); bb[1] = Math.max(bb[1], s.x); bb[2] = Math.min(bb[2], s.z); bb[3] = Math.max(bb[3], s.z); }
    const mg = 350;
    if (!this.sites.length) { bb[0] = this.cx - mg; bb[1] = this.cx + mg; bb[2] = this.cz - mg; bb[3] = this.cz + mg; }
    bb[0] -= mg; bb[1] += mg; bb[2] -= mg; bb[3] += mg;
    this.heightScale = lerp(0.85, 1.1, clamp01(ext / 3000)) * lerp(0.95, 1.05, this.k);
    this.hasWater = this.reflectOn && this.updateWaterMask();
    this.restoreFill();
    try {
      this.fillLight = this.ctx.fill?.() ?? null;
    } catch {
      this.fillLight = null;
    }
  }

  private endShow(): void {
    this.running = false;
    this.endAt = Math.min(this.endAt, this.naturalEnd());
  }

  private directShow(): void {
    // zoomed far out: bigger, higher shells so the show still reads (an artistic cheat, like the spark size)
    const cp = this.ctx.camera.position;
    const fz = clamp01((Math.hypot(cp.x - this.cx, cp.y - 220, cp.z - this.cz) - 1600) / 3800);
    this.viewK = 1 + 1.0 * fz * fz * (3 - 2 * fz);
    this.dayShow = sharedUniforms.uNight.value < 0.3;
    const u = this.clock - this.t0 - this.delay; // show time, 0 = opening salvo bursts
    const k = this.k;
    if (!this.opened) {
      const flight = 2.6;
      if (u < -flight) return;
      this.opened = true;
      this.inSalvo = true;
      this.openingSalvo(flight);
      this.inSalvo = false;
      return;
    }
    if (u > this.duration + 0.5) {
      this.endShow();
      return;
    }
    // grand finale: everything bursts together right at the end
    const grandFlight = 2.9;
    if (!this.grandDone && u >= this.duration - grandFlight) {
      this.grandDone = true;
      this.inSalvo = true;
      this.grandFinale(grandFlight);
      this.inSalvo = false;
      return;
    }
    if (this.grandDone) return;
    const finale = u >= this.finaleAt;
    const hushLen = k > 0.3 ? HUSH : 0;
    // a short hush before the finale barrage (bigger shows): the sky clears, then everything goes up
    if (!finale && hushLen > 0 && u >= this.finaleAt - hushLen) {
      this.nextShot = Math.max(this.nextShot, this.finaleAt);
      return;
    }
    if (!finale) this.updateTheme(u);
    // synchronized salvos (not during the finale barrage)
    if (!finale && u >= this.nextSalvo && u < this.finaleAt - hushLen - 1) {
      this.inSalvo = true;
      this.salvo();
      this.inSalvo = false;
      this.nextSalvo = u + lerp(12, 6, k) * this.rr(0.75, 1.3);
    }
    // keep the sky layered at every show size: when too few shells are about to bloom, fire the next one early
    if (!finale && this.burstsAround() < lerp(0.8, 5, k)) this.nextShot = Math.min(this.nextShot, Math.max(u, this.lastShotU + 0.3));
    let guard = 0;
    while (u >= this.nextShot && guard++ < 4) {
      this.lastShotU = u;
      const avail = this.maxLive - this.countLive();
      if (avail < this.maxLive * 0.12) {
        this.nextShot = u + 0.12;
        break;
      }
      // volleys: 2..3 shells from different sites in quick succession keep the sky layered
      const r = this.rnd();
      const burst = finale ? (r < 0.08 + 0.47 * k ? 3 : r < 0.35 + 0.55 * k ? 2 : 1) : r < 0.08 + 0.12 * k ? 3 : r < 0.3 + 0.3 * k ? 2 : 1;
      for (let b = 0; b < burst; b++) this.randomShell(finale, -1, b * this.rr(0.12, 0.45));
      const base = finale ? lerp(0.9, 0.13, Math.sqrt(k)) : lerp(2.8, 0.36, Math.sqrt(k));
      this.nextShot = u + base * burst * this.rr(0.6, 1.4) * (burst > 1 ? 0.75 : 1);
    }
  }

  /** themed 8..12 s segments (gold / colour pair / patterns / glitter) with mixed stretches in between */
  private updateTheme(u: number): void {
    if (u < this.themeUntil) return;
    if (this.k < 0.15) {
      this.theme = TH_MIXED;
      this.themeUntil = 1e9;
      return;
    }
    if (this.theme !== TH_MIXED) {
      this.theme = TH_MIXED;
      this.themeUntil = u + this.rr(6, 10);
      return;
    }
    let th = this.themeOrder[this.themeSeq++ % this.themeOrder.length];
    // glitter does not read against a bright sky
    if (th === TH_GLITTER && this.dayShow) th = this.themeOrder[this.themeSeq++ % this.themeOrder.length];
    this.theme = th;
    this.themeUntil = u + this.rr(8, 12);
    if (th === TH_PAIR) {
      this.themePair = Math.floor(this.rnd() * PAIRS.length);
      if (this.dayShow) {
        const p = PAIRS[this.themePair];
        if (!this.isDayCol(p[0]) || !this.isDayCol(p[1])) this.themePair = 5; // green / purple
      }
    }
  }

  /** shells that will still be blooming when a shell launched now bursts (~3 s from now) */
  private burstsAround(): number {
    const T = this.flT, now = this.clock;
    let n = 0;
    for (let i = 0; i < FL; i++) {
      const d = T[i] - now;
      if (d > 0.7 && d < 3.6 && !this.flS[i]) n++;
    }
    return n;
  }

  /** calibre 0..1 for a new shell */
  private calibre(boost = 0): number {
    const k = this.k;
    return clamp01(Math.pow(this.rnd(), lerp(1.5, 0.75, k)) * lerp(0.5, 1.0, k) + boost);
  }

  private pickType(finale: boolean): number {
    const k = this.k;
    // weights by type (index = shell type)
    const w = this.typeW;
    w[S_PEONY] = 3; w[S_CHRYS] = 2.6; w[S_RING] = 1.1; w[S_WILLOW] = k > 0.15 ? 1.3 : 0.5; w[S_BROCADE] = 0.8;
    w[S_CROSSETTE] = k > 0.25 ? 1.1 : 0.3; w[S_PALM] = k > 0.2 ? 0.9 : 0.3; w[S_STROBE] = 0.9; w[S_CRACKLE] = 1.0;
    w[S_MULTI] = 1.3; w[S_PISTIL] = 1.3; w[S_CHANGE] = 1.0; w[S_KAMURO] = k > 0.4 ? 0.5 : 0; w[S_SALUTE] = 0; w[S_HEART] = k > 0.3 ? 0.35 : 0.12;
    if (finale) {
      w[S_CHRYS] += 1.5; w[S_STROBE] += 1; w[S_CRACKLE] += 0.8; w[S_MULTI] += 1; w[S_KAMURO] += 0.8; w[S_SALUTE] = 0.9 * k;
      w[S_RING] *= 0.5; w[S_HEART] = 0;
    } else if (this.theme !== TH_MIXED) {
      // themed segment: its shells dominate, everything else becomes rare
      for (let i = 0; i < SHELL_TYPES; i++) w[i] *= 0.2;
      switch (this.theme) {
        case TH_GOLD:
          w[S_WILLOW] = 5; w[S_BROCADE] = 4; w[S_KAMURO] = k > 0.3 ? 3.5 : 0; w[S_PALM] = k > 0.2 ? 2 : 0.6; w[S_CROSSETTE] = 1.2; w[S_CHRYS] = 1.2;
          break;
        case TH_PAIR:
          w[S_PISTIL] = 5; w[S_CHANGE] = 5; w[S_PEONY] = 1.5; w[S_RING] = 0.8;
          break;
        case TH_PATTERN:
          w[S_RING] = 5; w[S_CROSSETTE] = 4; w[S_HEART] = k > 0.25 ? 2 : 0.8; w[S_PEONY] = 1;
          break;
        case TH_GLITTER:
          w[S_STROBE] = 5; w[S_CRACKLE] = 5; w[S_BROCADE] = 1.5; w[S_CHRYS] = 1;
          break;
      }
    }
    if (this.dayShow) {
      // strobes / crackle / charcoal gold are invisible against a bright sky
      w[S_STROBE] = 0; w[S_CRACKLE] *= 0.2; w[S_KAMURO] *= 0.3; w[S_WILLOW] *= 0.4; w[S_BROCADE] *= 0.4;
    }
    if (this.lastType >= 0) w[this.lastType] *= 0.25;
    let sum = 0;
    for (let i = 0; i < SHELL_TYPES; i++) sum += w[i];
    let r = this.rnd() * sum;
    for (let i = 0; i < SHELL_TYPES; i++) {
      r -= w[i];
      if (r <= 0) return (this.lastType = i);
    }
    return (this.lastType = S_PEONY);
  }
  private typeW = new Float32Array(SHELL_TYPES);

  private randomShell(finale: boolean, forceType = -1, extraDelay = 0): void {
    const type = forceType >= 0 ? forceType : this.pickType(finale);
    const c = this.calibre(finale ? 0.1 : 0);
    const H = this.heightFor(c);
    const site = this.pickSite(H, this.radiusFor(c));
    if (!site) return;
    const col = this.shellColor(type, finale);
    let col2: number;
    if (!finale && this.theme === TH_PAIR) {
      const p = PAIRS[this.themePair];
      col2 = p[0] === col ? p[1] : p[0];
    } else col2 = this.contrast(col);
    this.launch(site, this.fx, this.fy, this.fz, type, c, col, col2, this.clock + extraDelay, this.flightFor(this.fy - site.y));
  }

  private isDayCol(c: number): boolean {
    return c !== SILVER && c !== LEMON && c !== GOLD;
  }
  private dayCol(): number {
    return DAY_COLS[Math.floor(this.rnd() * DAY_COLS.length)];
  }

  private shellColor(type: number, finale = false): number {
    if (this.dayShow) return type === S_CRACKLE ? ORANGE : this.dayCol();
    if (type === S_WILLOW || type === S_KAMURO || type === S_BROCADE) return this.rnd() < 0.8 ? GOLD : SILVER;
    if (type === S_PALM) return this.rnd() < 0.8 ? GOLD : Math.floor(this.rnd() * PALETTE.length);
    if (type === S_STROBE) return SILVER;
    if (type === S_CRACKLE) return GOLD;
    if (!finale && this.theme === TH_GOLD) return this.rnd() < 0.7 ? GOLD : this.rnd() < 0.5 ? SILVER : ORANGE;
    if (!finale && this.theme === TH_PAIR) return PAIRS[this.themePair][(this.themeFlip ^= 1)];
    return Math.floor(this.rnd() * PALETTE.length);
  }

  /** a partner colour for pistils / colour changes / alternating salvo shells */
  private contrast(col: number): number {
    const day = this.dayShow;
    const r = Math.floor(this.rnd() * PAIRS.length);
    for (let i = 0; i < PAIRS.length; i++) {
      const p = PAIRS[(r + i) % PAIRS.length];
      const c2 = p[0] === col ? p[1] : p[1] === col ? p[0] : -1;
      if (c2 >= 0 && (!day || this.isDayCol(c2))) return c2;
    }
    const p = PAIRS[r];
    const c2 = p[0] !== col ? p[0] : p[1];
    return day && !this.isDayCol(c2) ? this.dayCol() : c2;
  }

  private heightFor(c: number): number {
    return (120 + 230 * c) * this.heightScale * (1 + (this.viewK - 1) * 0.6);
  }
  private radiusFor(c: number): number {
    return (34 + 92 * c) * lerp(0.9, 1.15, this.k) * this.viewK;
  }
  private viewK = 1;
  private flightFor(H: number): number {
    return 1.5 + Math.max(60, H) / 165;
  }

  private openingSalvo(flight: number): void {
    // several sites fire the same big shell at once; they all burst exactly at "midnight"
    const n = Math.max(1, Math.round(lerp(2, 7, this.k)));
    const day = this.dayShow;
    const type = this.rnd() < 0.5 ? S_PEONY : S_CHRYS;
    const col = day ? this.dayCol() : Math.floor(this.rnd() * PALETTE.length);
    let col2 = (col + 3 + Math.floor(this.rnd() * 4)) % PALETTE.length;
    if (day && !this.isDayCol(col2)) col2 = this.contrast(col);
    const c = clamp01(lerp(0.35, 0.8, this.k));
    const H = this.heightFor(c);
    const m = this.pickSpread(n, H, this.radiusFor(c));
    const F = this.spreadFit;
    const mid = this.t0 + this.delay;
    for (let i = 0; i < m; i++) {
      const alt = i % 2 === 1;
      this.launch(this.spread[i], F[i * 3], F[i * 3 + 1] * (alt ? 0.95 : 1.03), F[i * 3 + 2], alt ? S_PISTIL : type, c * (alt ? 0.85 : 1), alt ? col2 : col, col, this.clock, flight, mid);
    }
    // a big gold brocade crown over the first one for towns and up
    if (this.k > 0.2 && m > 0 && !day) {
      this.launch(this.spread[0], F[0], F[1] + 25, F[2], S_BROCADE, clamp01(c + 0.15), GOLD, SILVER, this.clock + 0.35, flight, mid + 0.35);
    }
    this.nextShot = 1.8;
  }

  private salvo(): void {
    // choreographed: several sites (or one site fanning out) fire the same shell type; colours alternate, calibres
    // and heights vary a little, and the bursts sweep across the view
    const k = this.k;
    const nTypes = k > 0.5 ? SALVO_TYPES.length : k > 0.3 ? SALVO_TYPES.length - 1 : 5;
    let type = SALVO_TYPES[Math.floor(this.rnd() * nTypes)];
    if (this.dayShow && type === S_STROBE) type = S_PEONY;
    const colA = this.shellColor(type);
    const colB = this.contrast(colA);
    const c0 = clamp01(this.calibre() * 0.8 + 0.1);
    const H = this.heightFor(c0);
    const R = this.radiusFor(c0);
    const n = Math.round(lerp(3, 7, k) * this.rr(0.8, 1.2));
    const e = this.ctx.camera.matrixWorld.elements;
    let rx = e[0], rz = e[2];
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const sweep = this.rr(0.08, 0.1);
    const rev = this.rnd() < 0.5;
    if (this.sites.length >= 3 && this.rnd() < 0.6) {
      const m = this.pickSpread(n, H, R);
      const F = this.spreadFit;
      // order along the camera-right axis
      const ord = this.order, key = this.orderKey;
      for (let i = 0; i < m; i++) {
        ord[i] = i;
        key[i] = (F[i * 3] * rx + F[i * 3 + 2] * rz) * (rev ? -1 : 1);
      }
      for (let i = 1; i < m; i++) {
        const v = ord[i];
        let j = i - 1;
        while (j >= 0 && key[ord[j]] > key[v]) { ord[j + 1] = ord[j]; j--; }
        ord[j + 1] = v;
      }
      let fl = 0;
      for (let i = 0; i < m; i++) fl = Math.max(fl, this.flightFor(F[i * 3 + 1] - this.spread[i].y));
      for (let j = 0; j < m; j++) {
        const i = ord[j];
        const alt = j % 2 === 1;
        const tj = j * sweep;
        this.launch(this.spread[i], F[i * 3], F[i * 3 + 1] * (alt ? 0.93 : 1.05), F[i * 3 + 2], type, clamp01(c0 * this.rr(0.88, 1.12)), alt ? colB : colA, alt ? colA : colB, this.clock + tj, fl, this.clock + fl + tj);
      }
    } else {
      // fan from one site: rockets tilted left..right (camera-relative), bursting in a sweeping row
      const s = this.pickSite(H, R);
      if (!s) return;
      const bx = this.fx, by = this.fy, bz = this.fz;
      const m = Math.max(3, Math.min(n, 7));
      const spread = Math.min(R * 1.4, (by - s.y) * 0.35);
      const fl = this.flightFor(by - s.y);
      for (let j = 0; j < m; j++) {
        const i = rev ? m - 1 - j : j;
        const f = m > 1 ? (i / (m - 1)) * 2 - 1 : 0;
        const alt = j % 2 === 1;
        this.launch(s, bx + rx * f * spread * 1.6, (by - Math.abs(f) * spread * 0.35) * (alt ? 0.95 : 1.03), bz + rz * f * spread * 1.6, type, clamp01(c0 * 0.8 * this.rr(0.88, 1.12)), alt ? colB : colA, alt ? colA : colB, this.clock + j * 0.06, fl, this.clock + fl + j * sweep);
      }
    }
  }
  private order = new Int32Array(16);
  private orderKey = new Float32Array(16);

  private grandFinale(flight: number): void {
    const k = this.k;
    const day = this.dayShow;
    const n = Math.max(2, Math.round(lerp(3, 9, k)));
    const H = this.heightFor(0.85);
    const R = this.radiusFor(0.9);
    const m = this.pickSpread(n, H, R);
    const F = this.spreadFit;
    const end = this.t0 + this.delay + this.duration;
    // a curtain of gold kamuro with silver strobes (by day: big saturated chrysanthemums)
    for (let i = 0; i < m; i++) {
      const strobe = !day && i % 3 === 2;
      const type = day ? (i % 2 ? S_PEONY : S_CHRYS) : strobe ? S_STROBE : S_KAMURO;
      const col = day ? this.dayCol() : strobe ? SILVER : GOLD;
      this.launch(this.spread[i], F[i * 3], F[i * 3 + 1] * this.rr(0.95, 1.05), F[i * 3 + 2], type, 0.9, col, SILVER, this.clock, flight, end + (i % 2) * 0.05);
    }
    // a lower row of mixed colour shells and salutes to finish
    if (k > 0.35) {
      const m2 = this.pickSpread(Math.round(lerp(2, 6, k)), H * 0.68, R * 0.7);
      for (let i = 0; i < m2; i++) this.launch(this.spread[i], F[i * 3], F[i * 3 + 1], F[i * 3 + 2], S_MULTI, 0.6, day ? this.dayCol() : Math.floor(this.rnd() * PALETTE.length), 0, this.clock + 0.4, flight * 0.85, end + 0.3);
    }
    const salutes = Math.round(lerp(1, 5, k));
    for (let i = 0; i < salutes; i++) {
      const s = this.pickSite(H * 0.8, R * 0.4);
      if (s) this.launch(s, this.fx, this.fy, this.fz, S_SALUTE, 0.7, SILVER, GOLD, this.clock + 0.3 + i * 0.12, flight * 0.8, end + 0.55 + i * 0.3);
    }
  }

  // ------------------------------------------------------------------------------------------------ sites
  private cleanSites(list: LaunchSite[]): LaunchSite[] {
    const out: LaunchSite[] = [];
    const W = this.ctx.mapSize;
    for (const s of list) {
      if (!isFinite(s.x) || !isFinite(s.z) || s.x < 0 || s.z < 0 || s.x > W || s.z > W) continue;
      if (out.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 50)) continue;
      out.push({ ...s, y: isFinite(s.y) ? s.y : this.ctx.groundAt(s.x, s.z), weight: Math.max(0.05, s.weight) });
      if (out.length >= MAX_SITES) break;
    }
    return out;
  }

  /** terrain height, clamped to the map */
  private ground(x: number, z: number): number {
    const W = this.ctx.mapSize;
    return this.ctx.groundAt(Math.min(W, Math.max(0, x)), Math.min(W, Math.max(0, z)));
  }

  /** how well a burst at (x, y, z) with radius R reads from the current camera (0..1) */
  private viewScore(x: number, y: number, z: number, R: number): number {
    const cam = this.ctx.camera;
    _v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    const dist = -_v.z;
    if (dist < R + 20) return 0;
    _v.applyMatrix4(cam.projectionMatrix);
    const rY = (R * cam.projectionMatrix.elements[5]) / dist;
    const rX = (R * cam.projectionMatrix.elements[0]) / dist;
    const nx = _v.x, ny = _v.y;
    let s = 1;
    const side = Math.abs(nx) + rX * 0.5;
    if (side > 0.9) s *= Math.max(0, 1 - (side - 0.9) * 4);
    const top = ny + rY * 0.85;
    if (top > 0.9) s *= Math.max(0, 1 - (top - 0.9) * 5);
    const bot = ny - rY * 0.6;
    if (bot < -0.9) s *= Math.max(0, 1 - (-0.9 - bot) * 4);
    // prefer bursts that are neither specks nor filling the screen, and toward the middle
    if (rY < 0.03) s *= 0.6;
    if (rY > 0.8) s *= 0.5;
    return s * (1 - 0.2 * Math.abs(nx) - 0.12 * Math.abs(ny - 0.2));
  }

  /**
   * best burst point for a site: straight up at H, or (when that would leave the screen) leaning toward the camera
   * and / or a little lower. Writes fx/fy/fz, returns the view score (0..1).
   */
  private fit(s: LaunchSite, H: number, R: number): number {
    const cam = this.ctx.camera.position;
    let dx = cam.x - s.x, dz = cam.z - s.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const ground = s.kind === 'roof' ? s.y - 20 : s.y;
    let best = -1;
    for (let hi = 0; hi < 3; hi++) {
      const h = H * (hi === 0 ? 1 : hi === 1 ? 0.82 : 0.66);
      const by = Math.max(s.y + h * 0.55, ground + Math.max(95, h));
      for (let li = 0; li < 3; li++) {
        const lean = (by - s.y) * (li === 0 ? 0 : li === 1 ? 0.2 : 0.38);
        const x = s.x + dx * lean, z = s.z + dz * lean;
        const v = this.viewScore(x, by, z, R) * (1 - 0.1 * li - 0.12 * hi);
        if (v > best + 0.02) {
          best = v;
          this.fx = x; this.fy = by; this.fz = z;
        }
      }
      if (best > 0.8) break;
    }
    return Math.max(0, best);
  }
  private fx = 0;
  private fy = 0;
  private fz = 0;
  private siteFit = new Float32Array(MAX_SITES * 3);
  private spread: LaunchSite[] = [];
  private spreadFit = new Float32Array(16 * 3);

  private tmpSite: LaunchSite = { x: 0, y: 0, z: 0, kind: 'centre', weight: 1 };

  /** weighted random site, favouring sites whose bursts read on screen (writes fx/fy/fz). Falls back to the view. */
  private pickSite(H: number, R: number): LaunchSite | null {
    const sites = this.sites;
    const sc = this.siteScore, F = this.siteFit;
    const n = Math.min(sites.length, MAX_SITES);
    let sum = 0, tot = 0;
    for (let i = 0; i < n; i++) {
      const v = this.fit(sites[i], H, R);
      F[i * 3] = this.fx; F[i * 3 + 1] = this.fy; F[i * 3 + 2] = this.fz;
      sc[i] = (v * v * 0.97 + 0.03) * sites[i].weight;
      sum += v * sites[i].weight;
      tot += sc[i];
    }
    if (n > 0 && sum > 0.5) {
      let r = this.rnd() * tot;
      let i = 0;
      for (; i < n - 1; i++) {
        r -= sc[i];
        if (r <= 0) break;
      }
      this.fx = F[i * 3]; this.fy = F[i * 3 + 1]; this.fz = F[i * 3 + 2];
      return sites[i];
    }
    // none of the city's sites reads from here: fire from under a random point of the visible sky
    return this.virtualSite(H, R);
  }

  private virtualSite(H: number, R: number): LaunchSite | null {
    const cam = this.ctx.camera;
    const W = this.ctx.mapSize;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    for (let tries = 0; tries < 8; tries++) {
      _v.set(this.rr(-0.6, 0.6), this.rr(-0.35, 0.45), 0.5).unproject(cam);
      const dx = _v.x - ox, dy = _v.y - oy, dz = _v.z - oz;
      if (dy > -1e-3) continue;
      // march down the ray to the point that is ~H above the ground
      let lo = 0, hi = 30000 / Math.hypot(dx, dy, dz);
      for (let it = 0; it < 22; it++) {
        const m = (lo + hi) / 2;
        const x = ox + dx * m, z = oz + dz * m;
        const g = this.ctx.groundAt(Math.min(W, Math.max(0, x)), Math.min(W, Math.max(0, z)));
        if (oy + dy * m - g > H) lo = m;
        else hi = m;
      }
      const x = ox + dx * lo, y = oy + dy * lo, z = oz + dz * lo;
      if (x < 0 || z < 0 || x > W || z > W) continue;
      // stay over (or next to) the developed city, never out in the wilderness
      if (x < this.bb[0] || x > this.bb[1] || z < this.bb[2] || z > this.bb[3]) continue;
      if (this.viewScore(x, y, z, R) < 0.3) continue;
      const s = this.tmpSite;
      s.x = x; s.z = z; s.y = this.ctx.groundAt(x, z); s.kind = 'centre'; s.weight = 1;
      this.fx = x; this.fy = Math.max(y, s.y + 90); this.fz = z;
      return s;
    }
    if (!this.sites.length) return null;
    this.fit(this.sites[0], H, R);
    return this.sites[0];
  }

  /** up to n sites with well separated, visible bursts -> this.spread / this.spreadFit; returns the count */
  private pickSpread(n: number, H: number, R: number): number {
    n = Math.min(n, 16);
    const sites = this.sites;
    const out = this.spread;
    out.length = 0;
    const F = this.spreadFit;
    const minD = R * 1.25;
    const cnt = Math.min(sites.length, MAX_SITES);
    const sc = this.siteScore, SF = this.siteFit;
    for (let i = 0; i < cnt; i++) {
      sc[i] = this.fit(sites[i], H, R) * sites[i].weight + this.rnd() * 0.2;
      SF[i * 3] = this.fx; SF[i * 3 + 1] = this.fy; SF[i * 3 + 2] = this.fz;
    }
    const used = this.used;
    used.fill(0);
    while (out.length < n) {
      let bi = -1, bv = 0.12;
      for (let i = 0; i < cnt; i++) {
        if (used[i] || sc[i] <= bv) continue;
        if (this.tooClose(SF[i * 3], SF[i * 3 + 2], out.length, minD)) continue;
        bi = i; bv = sc[i];
      }
      if (bi < 0) break;
      used[bi] = 1;
      const m = out.length;
      F[m * 3] = SF[bi * 3]; F[m * 3 + 1] = SF[bi * 3 + 1]; F[m * 3 + 2] = SF[bi * 3 + 2];
      out.push(sites[bi]);
    }
    // not enough distinct visible sites: add points under the visible sky
    let guard = 0;
    while (out.length < Math.min(n, 4) && guard++ < 8) {
      const v = this.virtualSite(H, R);
      if (!v || this.tooClose(this.fx, this.fz, out.length, minD)) continue;
      const m = out.length;
      F[m * 3] = this.fx; F[m * 3 + 1] = this.fy; F[m * 3 + 2] = this.fz;
      const vs = this.virtualPool[m % this.virtualPool.length];
      vs.x = v.x; vs.y = v.y; vs.z = v.z; vs.kind = v.kind; vs.weight = v.weight;
      out.push(vs);
    }
    return out.length;
  }
  private used = new Uint8Array(MAX_SITES);
  private virtualPool: LaunchSite[] = Array.from({ length: 16 }, () => ({ x: 0, y: 0, z: 0, kind: 'centre' as LaunchSiteKind, weight: 1 }));
  private tooClose(x: number, z: number, m: number, minD: number): boolean {
    const F = this.spreadFit;
    for (let j = 0; j < m; j++) if (Math.hypot(F[j * 3] - x, F[j * 3 + 2] - z) < minD) return true;
    return false;
  }

  // ------------------------------------------------------------------------------------------------ shells
  /**
   * Launch one shell from `site` so that it bursts at (tbx, tby, tbz): calibre c (0..1), colours, launch time and
   * flight time; burstTime (optional, show clock) pins the burst time exactly (synchronized salvos, "midnight").
   */
  private launch(site: LaunchSite, tbx: number, tby: number, tbz: number, type: number, c: number, colA: number, colB: number, tLaunch: number, flight: number, burstTime?: number): void {
    // queued: big salvos / the finale are written over a few frames (bounded CPU per frame, no hitch)
    if (this.qN >= QUEUE) {
      this.compactQueue();
      if (this.qN >= QUEUE) return;
    }
    const o = this.qN++ * QF, Q = this.queue;
    Q[o] = site.x; Q[o + 1] = site.y; Q[o + 2] = site.z; Q[o + 3] = tbx; Q[o + 4] = tby; Q[o + 5] = tbz;
    Q[o + 6] = type; Q[o + 7] = c; Q[o + 8] = colA; Q[o + 9] = colB; Q[o + 10] = tLaunch; Q[o + 11] = flight;
    Q[o + 12] = burstTime === undefined ? NaN : burstTime;
    Q[o + 13] = this.inSalvo ? 1 : 0;
  }
  private queue = new Float64Array(QUEUE * QF);
  private qN = 0;
  private qHead = 0;

  /** drop the already written head of the queue so a long backlog never loses shells while slots are free */
  private compactQueue(): void {
    if (this.qHead <= 0) return;
    this.queue.copyWithin(0, this.qHead * QF, this.qN * QF);
    this.qN -= this.qHead;
    this.qHead = 0;
  }

  /** approximate sparks a shell writes (rocket + tail + burst), for the per-frame budget */
  private shellCost(type: number, c: number): number {
    const q = this.density;
    const seg = q < 0.6 ? 4 : q < 0.85 ? 6 : 8;
    let n: number;
    switch (type) {
      case S_PEONY: n = (90 + 120 * c) * q; break;
      case S_CHRYS: n = (60 + 80 * c) * q * (q < 0.6 ? 2 : 3); break;
      case S_RING: n = 56 + 40 * c + 24 * q; break;
      case S_WILLOW: n = (55 + 55 * c) * q * (seg + 2); break;
      case S_BROCADE: n = (70 + 60 * c) * q * (Math.min(6, seg) + 3); break;
      case S_KAMURO: n = (90 + 60 * c) * q * (Math.min(7, seg) + 2); break;
      case S_CROSSETTE: n = 13 * (q < 0.6 ? 9 : 11); break;
      case S_PALM: n = 11 * ((q < 0.6 ? 3 : 5) + 10 * q); break;
      case S_STROBE: case S_CHANGE: case S_MULTI: n = (90 + 100 * c) * q; break;
      case S_CRACKLE: n = (155 + 160 * c) * q; break;
      case S_PISTIL: n = (110 + 130 * c) * q; break;
      case S_HEART: n = 70; break;
      default: n = 45;
    }
    return n + 50 * q;
  }

  /** write queued shells, oldest first, while this step stays within ~SPARKS_PER_FRAME sparks (at least one shell) */
  private drain(): void {
    if (this.qHead >= this.qN) {
      this.qHead = this.qN = 0;
      return;
    }
    const s0 = this.spawned;
    const Q = this.queue;
    const budget = SPARKS_PER_FRAME * this.density;
    while (this.qHead < this.qN) {
      const written = this.spawned - s0;
      if (written > 0 && written + this.shellCost(Q[this.qHead * QF + 6], Q[this.qHead * QF + 7]) > budget) break;
      const o = this.qHead++ * QF;
      // a shell drained a few frames late leaves now (and flies a touch faster when its burst time is pinned)
      const tL = Math.max(Q[o + 10], this.clock);
      const bt = Q[o + 12];
      this.firingSalvo = Q[o + 13] > 0;
      this.fire(Q[o], Q[o + 1], Q[o + 2], Q[o + 3], Q[o + 4], Q[o + 5], Q[o + 6], Q[o + 7], Q[o + 8], Q[o + 9], tL, isNaN(bt) ? Q[o + 11] - (tL - Q[o + 10]) : Math.max(1.2, bt - tL));
    }
    this.firingSalvo = false;
    if (this.qHead >= this.qN) this.qHead = this.qN = 0;
    else this.compactQueue();
  }
  /** set while salvo / opening / finale shells are queued; those don't count toward keeping the sky filled */
  private inSalvo = false;
  private firingSalvo = false;

  private fire(siteX: number, siteY: number, siteZ: number, tbx: number, tby: number, tbz: number, type: number, c: number, colA: number, colB: number, tLaunch: number, flight: number): void {
    const avail = this.maxLive - this.countLive();
    if (avail < 200) return;
    this.shells++;
    const R = this.radiusFor(c) * (type === S_SALUTE ? 0.4 : 1);
    const sx = siteX + this.rr(-6, 6), sz = siteZ + this.rr(-6, 6), sy = siteY + 0.5;
    const by = tby;
    // rocket initial velocity so that the (drag + gravity) path reaches the burst point at `flight`
    const kr = 0.45;
    const T = flight;
    const eT = (1 - Math.exp(-kr * T)) / kr;
    const vTy = -G / kr;
    const v0x = (tbx - sx) / eT, v0z = (tbz - sz) / eT;
    const v0y = (by - sy - vTy * T) / eT + vTy;
    const seed = this.rnd();
    const palm = type === S_PALM;
    const wob = palm ? this.rr(0.1, 0.3) : this.rr(0.25, 0.9);
    this.motion(sx, sy, sz, v0x, v0y, v0z, kr, 1, false, T);
    const bx = this.px + this.wobX(T, seed, wob), byy = this.py, bz = this.pz + this.wobZ(T, seed, wob);
    const tb = tLaunch + T;
    // thin shells out when the spark budget runs low (finale barrages)
    const q = this.density * Math.min(1, Math.max(0.3, (avail - 200) / 3000));

    // ---- rocket: a thin warm comet (palm: a thick glittering trunk) + rising tail
    const t = this.tpl;
    const dim = type === S_SALUTE ? 0.6 : palm ? 1.5 : 1;
    this.setTpl(K_ROCKET, sx, sy, sz, tLaunch, v0x, v0y, v0z, T, 1.32 * dim, 0.9 * dim, 0.51 * dim, palm ? 0.95 : 0.45, kr, 1);
    t.trail = palm ? 0.36 : 0.22; t.segN = 3; t.seed = seed; t.wob = wob;
    this.put();
    const glitterTail = palm || this.rnd() < 0.6;
    const nEm = Math.round(T * (palm ? 26 : glitterTail ? 13 : 4) * q);
    for (let i = 0; i < nEm; i++) {
      const tt = T * ((i + this.rnd()) / Math.max(1, nEm)) * 0.97;
      this.motion(sx, sy, sz, v0x, v0y, v0z, kr, 1, false, tt);
      const ex = this.px + this.wobX(tt, seed, wob), ez = this.pz + this.wobZ(tt, seed, wob);
      this.setTpl(K_EMBER, ex, this.py, ez, tLaunch + tt, this.vx * 0.06 + this.rr(-2.5, 2.5), this.vy * 0.06 + this.rr(-2, 1), this.vz * 0.06 + this.rr(-2.5, 2.5), this.rr(0.45, 0.95), 1.6, 1.0, 0.45, palm ? 0.7 : 0.45, 1.6, 0.35);
      this.put();
    }
    // mortar flash (+ smoke) at the launch point
    this.setTpl(K_FLASH, sx, sy + 2, sz, tLaunch, 0, 0, 0, 0.16, 1.0, 0.6, 0.3, 5 + 3 * c, 0, 0);
    this.put();
    if (this.smokeN >= 2) this.puff(sx, sy + 4, sz, tLaunch + 0.05, this.rr(6, 10), this.rr(5, 8), this.dayShow ? 0.3 : 0.2, MORTAR, 0);
    this.queueSound(tLaunch, this.rnd() < 0.3 ? 1 : 0, sx, sy, sz, T, glitterTail ? 1 : 0);

    // ---- burst
    const pa = PALETTE[colA % PALETTE.length], pb = PALETTE[colB % PALETTE.length];
    const I = this.starGain(pa) * lerp(1.0, 1.2, c);
    const Ib = this.starGain(pb) * lerp(1.0, 1.2, c);
    const size = 0.45 + R * 0.0072;
    const hangSeg = q < 0.6 ? 4 : q < 0.85 ? 6 : 8;
    switch (type) {
      case S_PEONY:
        this.sphere(bx, byy, bz, tb, R, Math.round((90 + 120 * c) * q), 2.4, this.rr(2.2, 2.8), pa, I, size, 0.12, 1, 0.55, null, 0, 0);
        break;
      case S_CHRYS:
        this.sphere(bx, byy, bz, tb, R, Math.round((60 + 80 * c) * q), 2.0, this.rr(2.3, 2.9), pa, I, size * 0.95, 0.55, q < 0.6 ? 2 : 3, 0.4, null, 0, 0);
        break;
      case S_RING: {
        this.ring(bx, byy, bz, tb, R, Math.round((56 + 40 * c) * Math.max(0.7, q)), pa, I, size);
        if (this.rnd() < 0.6) this.sphere(bx, byy, bz, tb, R * 0.32, Math.round(24 * q), 2.4, 1.8, pb, Ib, size * 0.9, 0.08, 1, 0.5, null, 0, 0);
        break;
      }
      case S_WILLOW:
        // slow, heavy stars: gold comets first, then long drooping curtains (terminal fall ~16 m/s)
        this.sphere(bx, byy, bz, tb, R * 0.95, Math.round((55 + 55 * c) * q), 1.15, this.rr(4.4, 5.4), pa, I * 0.55, size * 0.75, 2.4, hangSeg, 0.85, null, 0, 0, 1.9, 2, K_STAR, false, F_HANG);
        break;
      case S_BROCADE:
        this.sphere(bx, byy, bz, tb, R, Math.round((70 + 60 * c) * q), 1.25, this.rr(3.4, 4.2), pa, I * 0.65, size * 0.85, 1.8, Math.min(6, hangSeg), 0.9, null, 0, 0, 1.7, 3, K_STAR, false, F_HANG);
        break;
      case S_KAMURO:
        this.sphere(bx, byy, bz, tb, R, Math.round((90 + 60 * c) * q), 1.2, this.rr(5.0, 6.0), pa, I * 0.7, size * 0.75, 2.2, Math.min(7, hangSeg), 0.9, null, 0, 0, 1.8, 2, K_STAR, false, F_HANG);
        break;
      case S_CROSSETTE:
        this.crossette(bx, byy, bz, tb, R, pa, I, size);
        break;
      case S_PALM:
        this.palm(bx, byy, bz, tb, R, pa, I, size);
        break;
      case S_STROBE:
        this.sphere(bx, byy, bz, tb, R * 0.9, Math.round((90 + 70 * c) * q), 2.3, this.rr(2.8, 3.4), pa, I * 0.9, size * 0.51, 0, 1, 0, null, 0, 0, 0.6, 0, K_STROBE);
        this.queueSound(tb + 0.5, 4, bx, byy, bz, R, 2.2);
        break;
      case S_CRACKLE:
        this.crackleShell(bx, byy, bz, tb, R, pa, I, size, c);
        break;
      case S_MULTI:
        this.sphere(bx, byy, bz, tb, R, Math.round((90 + 110 * c) * q), 2.3, this.rr(2.0, 2.6), pa, I, size, 0.16, 1, 0.5, null, 0, 0, 1, 0, K_STAR, true);
        break;
      case S_PISTIL:
        this.sphere(bx, byy, bz, tb, R, Math.round((80 + 90 * c) * q), 2.3, this.rr(2.0, 2.5), pa, I, size, 0.14, 1, 0.5, null, 0, 0);
        this.sphere(bx, byy, bz, tb, R * 0.45, Math.round((30 + 40 * c) * q), 2.3, this.rr(2.3, 2.7), pb, Ib, size * 0.9, 0.1, 1, 0.6, null, 0, 0);
        break;
      case S_CHANGE:
        this.sphere(bx, byy, bz, tb, R, Math.round((90 + 100 * c) * q), 2.2, this.rr(2.3, 2.8), pa, I, size, 0.2, 1, 0.45, pb, Ib, 0.48);
        break;
      case S_HEART:
        this.heart(bx, byy, bz, tb, R, pa, I, size);
        break;
      case S_SALUTE:
        this.salute(bx, byy, bz, tb, R);
        break;
    }
    // the break: one short bright flash sprite (+ city light + sound)
    if (type !== S_SALUTE) {
      const fl = 1.5 * lerp(0.85, 1.15, c);
      this.setTpl(K_FLASH, bx, byy, bz, tb, 0, 0, 0, 0.1, lerp(pa[0], 1, 0.35) * fl, lerp(pa[1], 1, 0.35) * fl, lerp(pa[2], 1, 0.35) * fl, R * 0.25, 0, 0);
      this.put();
      this.queueFlash(tb, bx, byy, bz, pa, 0.35 + 0.65 * c, R);
      this.queueSound(tb, 2, bx, byy, bz, R, type === S_CRACKLE || type === S_BROCADE || type === S_KAMURO ? 0.6 : type === S_WILLOW || type === S_PALM ? 0.3 : 0);
    }
    this.burstSmoke(bx, byy, bz, tb, R, type === S_SALUTE ? PALETTE[SILVER] : pa);
    if (tb > this.lastBurstAt) this.lastBurstAt = tb;
  }

  private starGain(p: readonly [number, number, number]): number {
    const l = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    return (1.7 / Math.sqrt(Math.max(0.3, l))) * this.starK;
  }
  /** per-star gain: denser (higher quality) shells use slightly dimmer stars so the total glow stays similar */
  private starK = 1;

  private setTpl(kind: number, x: number, y: number, z: number, t0: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number, size: number, drag: number, grav: number): void {
    const t = this.tpl;
    t.kind = kind; t.px = x; t.py = y; t.pz = z; t.t0 = t0; t.vx = vx; t.vy = vy; t.vz = vz; t.life = life;
    t.r = r; t.g = g; t.b = b; t.sw = 0; t.r2 = 0; t.g2 = 0; t.b2 = 0; t.tw = 0;
    t.size = size; t.trail = 0; t.drag = drag; t.grav = grav; t.seed = this.rnd(); t.wob = 0; t.strobe = 0; t.segN = 1; t.flags = 0;
  }

  // basis for random shell orientation
  private b0 = new Float64Array(9);
  private randBasis(): void {
    const b = this.b0;
    const u = this.rnd() * 2 - 1, th = this.rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const ax = s * Math.cos(th), ay = u, az = s * Math.sin(th);
    // helper not parallel to a
    let hx = 0, hy = 1, hz = 0;
    if (Math.abs(ay) > 0.9) { hx = 1; hy = 0; }
    // e1 = normalize(h x a), e2 = a x e1
    let cx = hy * az - hz * ay, cy = hz * ax - hx * az, cz = hx * ay - hy * ax;
    const cl = Math.hypot(cx, cy, cz) || 1;
    cx /= cl; cy /= cl; cz /= cl;
    const dx = ay * cz - az * cy, dy = az * cx - ax * cz, dz = ax * cy - ay * cx;
    b[0] = cx; b[1] = cy; b[2] = cz;
    b[3] = ax; b[4] = ay; b[5] = az;
    b[6] = dx; b[7] = dy; b[8] = dz;
  }

  /**
   * spherical burst of n stars (Fibonacci-distributed, randomly oriented). drag k, reach ~R.
   * colB/ib/switchAt: colour change; gravity scale; embers per star (glitter trails); star kind; multi-colour
   * (one curated triad in latitude bands); spark flags.
   */
  private sphere(bx: number, by: number, bz: number, tb: number, R: number, n: number, k: number, life: number,
    col: readonly [number, number, number], I: number, size: number, trail: number, segN: number, twinkle: number,
    colB: readonly [number, number, number] | null, Ib: number, switchAt: number, grav = 1, embers = 0, kind = K_STAR, multi = false, flags = 0): void {
    this.randBasis();
    const b = this.b0;
    const t = this.tpl;
    const rot = this.rnd() * Math.PI * 2;
    const tri = multi ? (this.dayShow ? DAY_TRIADS : TRIADS)[Math.floor(this.rnd() * TRIADS.length)] : null;
    const bands = this.rnd() < 0.55 ? 3 : 2;
    const gainK = I / this.starGain(col);
    n = Math.max(4, n);
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ph = i * 2.399963 + rot;
      let lx = Math.cos(ph) * r + this.rr(-0.03, 0.03), ly = y + this.rr(-0.03, 0.03), lz = Math.sin(ph) * r + this.rr(-0.03, 0.03);
      const ll = Math.hypot(lx, ly, lz) || 1;
      lx /= ll; ly /= ll; lz /= ll;
      const dx = b[0] * lx + b[3] * ly + b[6] * lz;
      const dy = b[1] * lx + b[4] * ly + b[7] * lz;
      const dz = b[2] * lx + b[5] * ly + b[8] * lz;
      const sp = R * k * this.rr(0.94, 1.06);
      let c = col, ii = I;
      if (tri) {
        c = PALETTE[tri[Math.min(bands - 1, Math.floor(((1 - y) / 2) * bands))]];
        ii = this.starGain(c) * gainK;
      }
      const lf = life * this.rr(0.88, 1.08);
      this.setTpl(kind, bx, by, bz, tb, dx * sp, dy * sp + 2, dz * sp, lf, c[0] * ii, c[1] * ii, c[2] * ii, size, k, grav);
      t.trail = trail;
      t.segN = segN;
      t.tw = twinkle;
      t.flags = flags;
      if (colB) {
        t.sw = switchAt;
        t.r2 = colB[0] * Ib; t.g2 = colB[1] * Ib; t.b2 = colB[2] * Ib;
      }
      if (kind === K_STROBE) t.strobe = this.rr(12, 18);
      this.put();
      // glitter left behind along the star's path (brocade / willow / kamuro)
      for (let e = 0; e < embers; e++) {
        const te = lf * (0.12 + 0.8 * this.rnd());
        this.motion(bx, by, bz, dx * sp, dy * sp + 2, dz * sp, k, grav, true, te);
        this.setTpl(K_EMBER, this.px, this.py, this.pz, tb + te, this.vx * 0.08 + this.rr(-1, 1), this.vy * 0.08 + this.rr(-1.5, 0.5), this.vz * 0.08 + this.rr(-1, 1),
          this.rr(0.4, 0.9), c[0] * ii * 0.9, c[1] * ii * 0.9, c[2] * ii * 0.9, 0.45, 1.5, 0.35);
        this.put();
      }
    }
  }

  private ring(bx: number, by: number, bz: number, tb: number, R: number, n: number, col: readonly [number, number, number], I: number, size: number): void {
    // ring plane faces the camera (with some random tilt) so rings read as rings
    const cam = this.ctx.camera.position;
    let nx = cam.x - bx, ny = cam.y - by, nz = cam.z - bz;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx = nx / nl * 0.8 + this.rr(-0.45, 0.45); ny = ny / nl * 0.8 + this.rr(-0.45, 0.45); nz = nz / nl * 0.8 + this.rr(-0.45, 0.45);
    const l2 = Math.hypot(nx, ny, nz) || 1;
    nx /= l2; ny /= l2; nz /= l2;
    let hx = 0, hy = 1, hz = 0;
    if (Math.abs(ny) > 0.9) { hx = 1; hy = 0; }
    let ux = hy * nz - hz * ny, uy = hz * nx - hx * nz, uz = hx * ny - hy * nx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;
    const k = 2.4;
    const rot = this.rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const sp = R * k * this.rr(0.97, 1.03);
      this.setTpl(K_STAR, bx, by, bz, tb, (ux * ca + wx * sa) * sp, (uy * ca + wy * sa) * sp + 2, (uz * ca + wz * sa) * sp, this.rr(2.0, 2.4), col[0] * I, col[1] * I, col[2] * I, size, k, 1);
      this.tpl.trail = 0.14;
      this.tpl.tw = 0.5;
      this.put();
    }
  }

  private heart(bx: number, by: number, bz: number, tb: number, R: number, col: readonly [number, number, number], I: number, size: number): void {
    // a heart outline in a camera-facing plane (a playful pattern shell)
    const e = this.ctx.camera.matrixWorld.elements;
    const rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6];
    const n = Math.round(70 * Math.max(0.7, this.density));
    const k = 2.4;
    const tilt = this.rr(-0.25, 0.25);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let hx = 16 * Math.pow(Math.sin(a), 3) / 17;
      let hy = (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 17;
      const x2 = hx * ct - hy * st, y2 = hx * st + hy * ct;
      hx = x2; hy = y2;
      const sp = R * k;
      this.setTpl(K_STAR, bx, by, bz, tb, (rx * hx + ux * hy) * sp, (ry * hx + uy * hy) * sp + 2, (rz * hx + uz * hy) * sp, this.rr(2.0, 2.3), col[0] * I, col[1] * I, col[2] * I, size, k, 0.7);
      this.tpl.trail = 0.12;
      this.tpl.tw = 0.4;
      this.put();
    }
  }

  private crossette(bx: number, by: number, bz: number, tb: number, R: number, col: readonly [number, number, number], I: number, size: number): void {
    const n = 10 + Math.floor(this.rnd() * 6);
    const k = 1.5;
    this.randBasis();
    const b = this.b0;
    const t = this.tpl;
    const q = this.density;
    let popSound = false;
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ph = i * 2.399963;
      const lx = Math.cos(ph) * r, ly = y, lz = Math.sin(ph) * r;
      const dx = b[0] * lx + b[3] * ly + b[6] * lz, dy = b[1] * lx + b[4] * ly + b[7] * lz, dz = b[2] * lx + b[5] * ly + b[8] * lz;
      const sp = R * k * 0.72;
      const ts = this.rr(0.55, 0.8);
      this.setTpl(K_STAR, bx, by, bz, tb, dx * sp, dy * sp + 2, dz * sp, ts, col[0] * I, col[1] * I, col[2] * I, size * 1.1, k, 1);
      t.trail = 0.3; t.segN = 2;
      this.put();
      // split into a cross
      this.motion(bx, by, bz, dx * sp, dy * sp + 2, dz * sp, k, 1, true, ts);
      const px = this.px, py = this.py, pz = this.pz, vx = this.vx, vy = this.vy, vz = this.vz;
      // perpendicular basis to the flight direction
      const vl = Math.hypot(vx, vy, vz) || 1;
      const fx = vx / vl, fy = vy / vl, fz = vz / vl;
      let ax = 0, ay = 1, az = 0;
      if (Math.abs(fy) > 0.9) { ax = 1; ay = 0; }
      let ux = ay * fz - az * fy, uy = az * fx - ax * fz, uz = ax * fy - ay * fx;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      const wx = fy * uz - fz * uy, wy = fz * ux - fx * uz, wz = fx * uy - fy * ux;
      const cs = R * 0.5 * 2.2;
      const kids = q < 0.6 ? 3 : 4;
      for (let j = 0; j < kids; j++) {
        const a = (j / kids) * Math.PI * 2 + 0.3;
        const ca = Math.cos(a), sa = Math.sin(a);
        this.setTpl(K_STAR, px, py, pz, tb + ts, vx * 0.35 + (ux * ca + wx * sa) * cs, vy * 0.35 + (uy * ca + wy * sa) * cs, vz * 0.35 + (uz * ca + wz * sa) * cs, this.rr(1.1, 1.5), col[0] * I, col[1] * I, col[2] * I, size, 2.2, 1);
        // the split is a crack: the pieces appear at full brightness
        t.trail = 0.22; t.segN = 2; t.tw = 0.5; t.flags = F_SNAP;
        this.put();
      }
      this.setTpl(K_CRACKLE, px, py, pz, tb + ts, vx * 0.3, vy * 0.3, vz * 0.3, 0.1, 1.0 * 3, 0.9 * 3, 0.7 * 3, 1.0, 2, 0);
      this.put();
      if (!popSound) {
        popSound = true;
        this.queueSound(tb + ts, 3, bx, by, bz, R, 0.5);
      }
    }
  }

  private palm(bx: number, by: number, bz: number, tb: number, R: number, col: readonly [number, number, number], I: number, size: number): void {
    // 10..12 thick, bright fronds that arc out and droop (hanging trails), glittering as they go
    const n = 10 + Math.floor(this.rnd() * 3);
    const k = 1.25;
    const gs = 1.4;
    const t = this.tpl;
    const q = this.density;
    const rot = this.rnd() * Math.PI * 2;
    const Ik = I * 1.6;
    for (let i = 0; i < n; i++) {
      const az = rot + (i / n) * Math.PI * 2 + this.rr(-0.15, 0.15);
      const el = this.rr(0.15, 0.75);
      const dx = Math.cos(az) * Math.cos(el), dy = Math.sin(el), dz = Math.sin(az) * Math.cos(el);
      const sp = R * k * this.rr(1.0, 1.15);
      const life = this.rr(2.6, 3.2);
      this.setTpl(K_STAR, bx, by, bz, tb, dx * sp, dy * sp + 4, dz * sp, life, col[0] * Ik, col[1] * Ik, col[2] * Ik, size * 2.4, k, gs);
      t.trail = 1.1; t.segN = q < 0.6 ? 3 : 5; t.tw = 0.3; t.flags = F_HANG;
      this.put();
      const ne = Math.round(10 * q);
      for (let e = 0; e < ne; e++) {
        const te = life * (0.05 + 0.85 * (e + this.rnd()) / ne);
        this.motion(bx, by, bz, dx * sp, dy * sp + 4, dz * sp, k, gs, true, te);
        this.setTpl(K_EMBER, this.px, this.py, this.pz, tb + te, this.rr(-1.5, 1.5), this.rr(-2, 0), this.rr(-1.5, 1.5), this.rr(0.5, 1.0), 1.0 * 2.2, 0.62 * 2.2, 0.28 * 2.2, 0.5, 1.5, 0.4);
        this.put();
      }
    }
  }

  private crackleShell(bx: number, by: number, bz: number, tb: number, R: number, col: readonly [number, number, number], I: number, size: number, c: number): void {
    const q = this.density;
    // "dragon eggs": a soft gold burst whose stars turn into a cloud of crackling pops
    this.sphere(bx, by, bz, tb, R * 0.85, Math.round((45 + 30 * c) * q), 2.2, 1.1, col, I * 0.75, size * 0.8, 0.18, 1, 0.3, null, 0, 0);
    const n = Math.round((110 + 130 * c) * q);
    const k = 2.2;
    for (let i = 0; i < n; i++) {
      const u = this.rnd() * 2 - 1, th = this.rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const sp = R * 0.85 * k * this.rr(0.55, 1.0);
      const tc = this.rr(0.95, 2.1);
      this.motion(bx, by, bz, s * Math.cos(th) * sp, u * sp + 2, s * Math.sin(th) * sp, k, 1, true, tc);
      this.setTpl(K_CRACKLE, this.px, this.py, this.pz, tb + tc, 0, -2, 0, this.rr(0.06, 0.13), 1.0 * 2.6, 0.92 * 2.6, 0.75 * 2.6, 0.8 + 0.4 * c, 1, 0);
      this.put();
    }
    this.queueSound(tb + 0.95, 3, bx, by, bz, R, 1.2);
  }

  private salute(bx: number, by: number, bz: number, tb: number, R: number): void {
    // bright white flash + tight crackle cluster and a hard bang
    this.setTpl(K_FLASH, bx, by, bz, tb, 0, 0, 0, 0.09, 2.2, 2.2, 2.35, R * 0.3, 0, 0);
    this.put();
    const n = Math.round(40 * this.density);
    for (let i = 0; i < n; i++) {
      const u = this.rnd() * 2 - 1, th = this.rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const d = R * this.rr(0.3, 1.0);
      this.setTpl(K_CRACKLE, bx + s * Math.cos(th) * d, by + u * d, bz + s * Math.sin(th) * d, tb + this.rr(0.0, 0.25), 0, -3, 0, this.rr(0.05, 0.1), 3, 3, 2.8, 0.9, 1, 0);
      this.put();
    }
    this.queueFlash(tb, bx, by, bz, PALETTE[SILVER], 1.8, R * 2);
    this.queueSound(tb, 5, bx, by, bz, R, 1);
  }

  // ------------------------------------------------------------------------------------------------ sounds
  private queueSound(time: number, kind: number, x: number, y: number, z: number, size: number, extra: number): void {
    if (this.suppressSound || !this.onSound) return;
    const K = this.sndK;
    for (let i = 0; i < K.length; i++) {
      if (K[i] >= 0) continue;
      K[i] = kind;
      this.sndT[i] = time;
      const o = i * 5, p = this.sndP;
      p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = size; p[o + 4] = extra;
      return;
    }
  }

  private dispatchSounds(): void {
    const K = this.sndK, T = this.sndT, P = this.sndP;
    const now = this.clock;
    const fn = this.onSound;
    for (let i = 0; i < K.length; i++) {
      const k = K[i];
      if (k < 0 || T[i] > now) continue;
      K[i] = -1;
      if (!fn || now - T[i] > 0.5) continue;
      const o = i * 5;
      try {
        fn(SOUND_NAMES[k], P[o], P[o + 1], P[o + 2], P[o + 3], P[o + 4]);
      } catch {
        /* audio problems must never break the show */
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ light on the city
  private queueFlash(time: number, x: number, y: number, z: number, col: readonly [number, number, number], strength: number, radius: number): void {
    const i = this.flI;
    this.flI = (i + 1) % FL;
    const pj = this.flPool[i];
    if (pj >= 0 && this.poolFl[pj] === i) this.poolFl[pj] = -1;
    this.flPool[i] = -1;
    this.flT[i] = time;
    this.flS[i] = this.firingSalvo ? 1 : 0;
    const o = i * FLS, p = this.flP;
    p[o] = x; p[o + 1] = y; p[o + 2] = z;
    p[o + 3] = lerp(col[0], 1, 0.35); p[o + 4] = lerp(col[1], 1, 0.35); p[o + 5] = lerp(col[2], 1, 0.35);
    p[o + 6] = strength;
    p[o + 7] = radius;
  }

  /** flash envelope of a burst dt s after it broke */
  private static env(dt: number, strength: number): number {
    return Math.min(1, dt * 30) * Math.exp(-dt * 4.2) * strength;
  }

  /** burst light: ground pools under fresh bursts, water shimmer + smoke light (strongest 4), fill-light tint */
  private updateLights(): void {
    const now = this.clock;
    const cam = this.ctx.camera.position;
    const night = sharedUniforms.uNight.value;
    const nk = smoothstep(0.15, 0.6, night);
    const p = this.flP;
    const topI = this.topI, topE = this.topE;
    topI.fill(-1);
    topE.fill(0);
    let sum = 0, r = 0, g = 0, b = 0;
    for (let i = 0; i < FL; i++) {
      const dt = now - this.flT[i];
      if (dt < 0 || dt > 1.6) continue;
      const o = i * FLS;
      const env = Fireworks.env(dt, p[o + 6]);
      const d = Math.hypot(p[o] - cam.x, p[o + 1] - cam.y, p[o + 2] - cam.z);
      const e2 = env / (1 + (d / 2500) ** 2);
      sum += e2;
      r += p[o + 3] * e2; g += p[o + 4] * e2; b += p[o + 5] * e2;
      // the strongest few light the water and the smoke
      if (env > topE[WATER_FLASHES - 1]) {
        let s = WATER_FLASHES - 1;
        while (s > 0 && env > topE[s - 1]) {
          topE[s] = topE[s - 1];
          topI[s] = topI[s - 1];
          s--;
        }
        topE[s] = env;
        topI[s] = i;
      }
      // a fresh burst gets a light pool on the ground
      if (nk > 0 && this.flPool[i] === -1 && dt < 0.4) this.assignPool(i);
    }
    // ground pools
    let anyPool = false;
    for (let j = 0; j < NPOOL; j++) {
      const i = this.poolFl[j];
      let e = 0;
      if (i >= 0) {
        const dt = now - this.flT[i];
        if (dt >= 0 && dt <= 1.6) e = Fireworks.env(dt, p[i * FLS + 6]);
        else {
          this.flPool[i] = -2;
          this.poolFl[j] = -1;
        }
      }
      this.poolE[j] = e;
      const kk = e * POOL_PEAK * nk * this.poolK[j];
      if (i >= 0 && kk > 1e-4) {
        const o = i * FLS;
        this.poolC[j].set(p[o + 3] * kk, p[o + 4] * kk, p[o + 5] * kk);
        anyPool = true;
      } else this.poolC[j].set(0, 0, 0);
    }
    this.pools.visible = anyPool;
    if (anyPool) this.poolGeo.setDrawRange(0, Infinity);
    // water shimmer / smoke light (night only: by day a burst does not visibly light anything)
    const WP = waterFlashUniforms.uFlashPos.value, WC = waterFlashUniforms.uFlashCol.value;
    for (let s = 0; s < WATER_FLASHES; s++) {
      const i = topI[s];
      if (i < 0 || nk <= 0) {
        WC[s].set(0, 0, 0);
        continue;
      }
      const o = i * FLS;
      WP[s].set(p[o], p[o + 1], p[o + 2], Math.max(20, p[o + 7]));
      const kk = topE[s] * 0.8 * nk;
      WC[s].set(p[o + 3] * kk, p[o + 4] * kk, p[o + 5] * kk);
    }
    // soft tint of the scene's fill light: the city flickers with the bursts but never lights up like day
    const h = this.fillLight;
    if (!h) return;
    const base = this.fillBaseIntensity(h);
    const amt = (1 - Math.exp(-sum * 1.1)) * 0.28 * night * Math.max(0.3, Math.min(1, base / 0.5));
    if (amt < 1e-3) {
      this.restoreFill();
      return;
    }
    const tot = base + amt;
    const inv = 1 / Math.max(sum, 1e-5);
    const w0 = base / tot, w1 = amt / tot;
    const B = this.fillBase;
    h.color.setRGB(B.r * w0 + r * inv * w1, B.g * w0 + g * inv * w1, B.b * w0 + b * inv * w1);
    h.intensity = tot;
    this.fillSetI = tot;
    this.fillAdd = amt;
    this.fillSet.copy(h.color);
    this.fillTouched = true;
  }

  /** untinted intensity of the fill light now (captures its untinted colour too) */
  private fillBaseIntensity(h: THREE.HemisphereLight): number {
    if (!this.fillTouched) {
      this.fillBase.copy(h.color);
      return h.intensity;
    }
    // someone else (WorldView) rewrites the light every frame: take what they set; else undo our own delta
    if (!h.color.equals(this.fillSet)) this.fillBase.copy(h.color);
    return h.intensity === this.fillSetI ? this.fillSetI - this.fillAdd : h.intensity;
  }

  private restoreFill(): void {
    const h = this.fillLight;
    if (h && this.fillTouched) {
      if (h.intensity === this.fillSetI) h.intensity = this.fillSetI - this.fillAdd;
      if (h.color.equals(this.fillSet)) h.color.copy(this.fillBase);
    }
    this.fillTouched = false;
  }

  /** give flash i the dimmest ground pool and conform that disc to the terrain under the burst */
  private assignPool(i: number): void {
    let best = 0, bv = Infinity;
    for (let j = 0; j < NPOOL; j++) {
      const v = this.poolFl[j] < 0 ? -1 : this.poolE[j];
      if (v < bv) {
        bv = v;
        best = j;
      }
    }
    const old = this.poolFl[best];
    if (old >= 0) this.flPool[old] = -2;
    this.poolFl[best] = i;
    this.flPool[i] = best;
    const o = i * FLS, p = this.flP;
    const x = p[o], y = p[o + 1], z = p[o + 2];
    const H = Math.max(40, y - this.ground(x, z));
    const rad = Math.min(900, 2.5 * H);
    // irradiance ~ 1 / H^2: low bursts light the streets more
    this.poolK[best] = Math.min(1.8, Math.max(0.35, (190 / H) ** 2));
    this.poolE[best] = 0;
    const P = this.poolPos.array as Float32Array;
    let v = best * PG * PG * 3;
    for (let gz = 0; gz < PG; gz++) {
      for (let gx = 0; gx < PG; gx++) {
        const wx = x + ((gx / (PG - 1)) * 2 - 1) * rad, wz = z + ((gz / (PG - 1)) * 2 - 1) * rad;
        P[v] = wx;
        P[v + 1] = this.ground(wx, wz) + 2.5;
        P[v + 2] = wz;
        v += 3;
      }
    }
    this.poolPos.needsUpdate = true;
  }
}

// ================================================================================================ launch sites
export interface SiteSource {
  buildings: Iterable<{ id: number; def: string; x: number; z: number; w: number; d: number; pop: number; jobs: number; capacity: number }>;
  /** building def lookup (category / id) */
  defOf: (defId: string) => { id: string; category: string } | undefined;
  /** rendered building: world centre, base and top */
  visualOf: (id: number) => { cx: number; cz: number; baseY: number; top: number } | null;
  /** cells: size, water flags, cell size */
  size: number;
  water: Uint8Array;
  cellSize: number;
  groundAt: (x: number, z: number) => number;
  /** road network per cell (1..4 = surface streets): the city-centre site snaps onto a road / park / plaza */
  network?: Uint8Array;
  /** building id per cell (-1 = none): waterfront sites stay next to the developed city */
  building?: Int32Array;
}

const MAX_PARK_SITES = 24, MAX_LANDMARK_SITES = 8, MAX_ROOF_SITES = 5, MAX_WATER_SITES = 4;

/** insert into a list kept sorted by descending `key`, at most `max` long (no allocation beyond the item) */
function topInsert(list: LaunchSite[], item: LaunchSite, key: (s: LaunchSite) => number, max: number): void {
  const v = key(item);
  if (list.length >= max && v <= key(list[list.length - 1])) return;
  let i = list.length;
  while (i > 0 && key(list[i - 1]) < v) i--;
  list.splice(i, 0, item);
  if (list.length > max) list.pop();
}
const byWeight = (s: LaunchSite) => s.weight;
const byHeight = (s: LaunchSite) => s.y;

/**
 * collect launch sites for a show: the city centre (snapped to a road / park / plaza), stadiums + the best parks /
 * plazas, landmarks, the tallest roofs and a few barges just off the city's waterfront. Keeps only the best few of
 * each kind, so it stays cheap on a 60k-building map.
 */
export function collectLaunchSites(src: SiteSource): LaunchSite[] {
  const parks: LaunchSite[] = [];
  const landmarks: LaunchSite[] = [];
  const roofs: LaunchSite[] = [];
  let cxs = 0, czs = 0, cw = 0;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const C = src.cellSize;
  for (const b of src.buildings) {
    const wgt = 1 + b.pop + b.jobs;
    cxs += (b.x + b.w / 2) * C * wgt; czs += (b.z + b.d / 2) * C * wgt; cw += wgt;
    if (b.x < x0) x0 = b.x;
    if (b.x + b.w > x1) x1 = b.x + b.w;
    if (b.z < z0) z0 = b.z;
    if (b.z + b.d > z1) z1 = b.z + b.d;
    const cat = src.defOf(b.def)?.category;
    if (cat === 'park') {
      const stadium = b.def.includes('stadium');
      const plaza = b.def.includes('plaza') || b.def.includes('square');
      const weight = stadium ? 3 : plaza ? 2 : 1.4 + Math.min(1, (b.w * b.d) / 16);
      if (parks.length >= MAX_PARK_SITES && weight <= parks[parks.length - 1].weight) continue;
      const v = src.visualOf(b.id);
      const cx = v ? v.cx : (b.x + b.w / 2) * C, cz = v ? v.cz : (b.z + b.d / 2) * C;
      topInsert(parks, { x: cx, y: v ? v.baseY : src.groundAt(cx, cz), z: cz, kind: stadium ? 'stadium' : plaza ? 'plaza' : 'park', weight }, byWeight, MAX_PARK_SITES);
    } else if (cat === 'landmark') {
      // fire from next to the landmark (not from its spire)
      const v = src.visualOf(b.id);
      const cx = v ? v.cx : (b.x + b.w / 2) * C, cz = v ? v.cz : (b.z + b.d / 2) * C;
      const off = (Math.max(b.w, b.d) / 2 + 1) * C * 0.7;
      topInsert(landmarks, { x: cx + off, y: src.groundAt(cx + off, cz + off), z: cz + off, kind: 'landmark', weight: 2.2 + Math.min(0.5, (b.w * b.d) / 64) }, byWeight, MAX_LANDMARK_SITES);
    } else {
      const v = src.visualOf(b.id);
      if (!v || v.top - v.baseY <= 45) continue;
      if (roofs.length >= MAX_ROOF_SITES && v.top <= roofs[roofs.length - 1].y) continue;
      topInsert(roofs, { x: v.cx, y: v.top, z: v.cz, kind: 'roof', weight: 1.1 + Math.min(1.5, (v.top - v.baseY) / 150) }, byHeight, MAX_ROOF_SITES);
    }
  }
  const N = src.size;
  const sites: LaunchSite[] = [];
  // the city centre (population / jobs centroid), moved onto the nearest road / park / plaza within 150 m
  if (cw > 0) {
    let cx = cxs / cw, cz = czs / cw;
    const snap = snapCentre(src, cx, cz, parks, 150);
    if (snap) { cx = snap[0]; cz = snap[1]; }
    sites.push({ x: cx, y: src.groundAt(cx, cz), z: cz, kind: 'centre', weight: 2.5 });
  } else {
    const c = (N / 2) * C;
    sites.push({ x: c, y: src.groundAt(c, c), z: c, kind: 'centre', weight: 2 });
    x0 = N * 0.35; x1 = N * 0.65; z0 = N * 0.35; z1 = N * 0.65;
  }
  sites.push(...parks, ...landmarks, ...roofs);
  // waterfront: barges 2..3 cells off the shore, within 5 cells of the city's buildings
  const pad = 5;
  const ax = Math.max(1, Math.floor(x0) - pad), bx = Math.min(N - 2, Math.ceil(x1) + pad);
  const az = Math.max(1, Math.floor(z0) - pad), bz = Math.min(N - 2, Math.ceil(z1) + pad);
  const shore: { x: number; z: number; s: number }[] = [];
  const W = src.water, B = src.building;
  if (ax < bx && az < bz) {
    for (let z = az; z <= bz; z += 2) {
      for (let x = ax; x <= bx; x += 2) {
        if (!W[z * N + x]) continue;
        // water here, land within 3 cells, open water around
        let land = 0, water = 0;
        for (let dz = -3; dz <= 3; dz += 3) for (let dx = -3; dx <= 3; dx += 3) {
          const xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
          if (W[zz * N + xx]) water++;
          else land++;
        }
        if (land < 1 || water < 5) continue;
        if (B && !nearBuilding(B, N, x, z, 5)) continue;
        shore.push({ x, z, s: (((x * 73856093) ^ (z * 19349663)) >>> 0) / 4294967296 });
      }
    }
  }
  shore.sort((a, b) => a.s - b.s);
  const picked: { x: number; z: number }[] = [];
  for (const s of shore) {
    if (picked.length >= MAX_WATER_SITES) break;
    if (picked.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 14)) continue;
    picked.push(s);
    sites.push({ x: (s.x + 0.5) * C, y: SEA_LEVEL + 0.5, z: (s.z + 0.5) * C, kind: 'water', weight: 2 });
  }
  return sites;
}

function nearBuilding(B: Int32Array, N: number, x: number, z: number, r: number): boolean {
  for (let dz = -r; dz <= r; dz++) {
    const zz = z + dz;
    if (zz < 0 || zz >= N) continue;
    for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx;
      if (xx >= 0 && xx < N && B[zz * N + xx] >= 0) return true;
    }
  }
  return false;
}

/** nearest park / plaza site or surface-street cell to (x, z) within maxD metres (the centroid can land on houses) */
function snapCentre(src: SiteSource, x: number, z: number, parks: LaunchSite[], maxD: number): [number, number] | null {
  let best: [number, number] | null = null, bd = maxD;
  for (const p of parks) {
    if (p.kind === 'stadium') continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = [p.x, p.z]; }
  }
  const net = src.network;
  if (net) {
    const C = src.cellSize, N = src.size;
    const cx = Math.floor(x / C), cz = Math.floor(z / C), r = Math.ceil(maxD / C);
    for (let dz = -r; dz <= r; dz++) {
      const zz = cz + dz;
      if (zz < 0 || zz >= N) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= N) continue;
        const n = net[zz * N + xx];
        if (n < 1 || n > 4) continue;
        const wx = (xx + 0.5) * C, wz = (zz + 0.5) * C;
        const d = Math.hypot(wx - x, wz - z);
        if (d < bd) { bd = d; best = [wx, wz]; }
      }
    }
  }
  return best;
}
