/**
 * PostFX — the frame pipeline:
 *   1. scene -> HDR target (half float, optional MSAA, depth texture)
 *   2. GTAO (three's GTAOShader in depth-only mode, half or full res) + depth-aware separable blur
 *   3. bloom: soft-threshold prefilter (fog + exposure aware) + 13-tap downsample chain + tent upsample (additive)
 *   4. composite: height fog / aerial perspective (colors from the sky-view LUT, sun inscatter), AO, bloom,
 *      exposure, ACES filmic, color grading, vignette, dithering, sRGB encode
 *   5. FXAA (when MSAA is off)
 * Everything renders with FullScreenQuad; no per-frame allocations.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOShader, generateMagicSquareNoise } from 'three/examples/jsm/shaders/GTAOShader.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { QualitySettings } from './quality';

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** shared fog code (composite + bloom prefilter) */
const FOG_GLSL = /* glsl */ `
uniform highp sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform sampler2D uSkyLut;
uniform float uFogOn;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uFogStart;
uniform float uHaze;
uniform vec3 uSunDir;
uniform vec3 uSunGlow;
uniform float uSkyExposure;
uniform vec3 uSkyFloor;
uniform float uFogMax;

vec2 fogLutUv(vec3 dir) {
  float az = atan(dir.x, -dir.z);
  float u = az * 0.15915494 + 0.5;
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / 1.5707963);
  return vec2(u, v);
}

vec3 fogViewPos(vec2 uv, float depth) {
  vec4 clip = vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
  vec4 v = uInvProj * clip;
  return v.xyz / v.w;
}

// returns fogged color; also outputs world distance
vec3 applyFog(vec3 col, vec2 uv, float depth, out float dist) {
  dist = 1e9;
  if (depth >= 1.0) return col;
  vec3 vp = fogViewPos(uv, depth);
  dist = length(vp);
  if (uFogOn < 0.5) return col;
  vec3 wp = (uCamWorld * vec4(vp, 1.0)).xyz;
  vec3 rd = (wp - uCamPos) / max(dist, 1e-3);
  float d = max(dist - uFogStart, 0.0);
  float y0 = uCamPos.y + rd.y * (dist - d);
  float b = uFogFalloff;
  float k = b * rd.y * d;
  float fh = abs(k) > 1e-4 ? uFogDensity * exp(-b * max(y0, -50.0)) * (1.0 - exp(-k)) / (b * rd.y) : uFogDensity * exp(-b * max(y0, -50.0)) * d;
  float T = exp(-(fh + uHaze * d));
  // keep near/mid distances readable, but let the far horizon dissolve completely into the sky
  T = max(T, (1.0 - uFogMax) * (1.0 - smoothstep(9000.0, 26000.0, dist)));
  vec3 fd = normalize(vec3(rd.x, max(rd.y, 0.0), rd.z));
  vec3 fogCol = texture2D(uSkyLut, fogLutUv(fd)).rgb * uSkyExposure + uSkyFloor;
  fogCol += uSunGlow * pow(max(dot(rd, uSunDir), 0.0), 10.0);
  return mix(fogCol, col, T);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
#include <packing>
${FOG_GLSL}
uniform sampler2D tScene;
uniform sampler2D tAO;
uniform sampler2D tBloom;
uniform float uAoOn;
uniform float uAoIntensity;
uniform float uAoFade;
uniform float uBloomOn;
uniform float uBloomStrength;
uniform float uExposure;
uniform vec3 uTint;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uLift;
uniform float uVignette;
uniform vec2 uResolution;
varying vec2 vUv;

vec3 mtRRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 mtAcesFilmic(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = ACESInputMat * (color / 0.6);
  color = mtRRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  float depth = texture2D(tDepth, vUv).x;
  float dist;
  if (uAoOn > 0.5 && depth < 1.0) {
    float ao = texture2D(tAO, vUv).r;
    vec3 vp = fogViewPos(vUv, depth);
    float fade = 1.0 - smoothstep(uAoFade * 0.5, uAoFade, length(vp));
    col *= mix(1.0, ao, uAoIntensity * fade);
  }
  col = applyFog(col, vUv, depth, dist);
  col *= uExposure;
  if (uBloomOn > 0.5) col += texture2D(tBloom, vUv).rgb * uBloomStrength;
  // grading (pre tonemap, linear)
  col *= uTint;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, uSaturation), 0.0);
  col = pow(col / 0.18 + 1e-6, vec3(uContrast)) * 0.18;
  // ACES filmic, but saturated highlights (neon, tail lights, signals) keep their hue: blend toward a
  // hue-preserving curve (ACES applied to the max channel, ratios kept) by input saturation
  vec3 acesC = mtAcesFilmic(col);
  float mx = max(col.r, max(col.g, col.b));
  float mn = min(col.r, min(col.g, col.b));
  float satIn = (mx - mn) / max(mx, 1e-5);
  vec3 hueP = col * (mtAcesFilmic(vec3(mx)).g / max(mx, 1e-5));
  col = mix(acesC, clamp(hueP, 0.0, 1.0), smoothstep(0.45, 0.95, satIn) * smoothstep(0.5, 2.0, mx) * 0.75);
  col = col + uLift * (1.0 - col) * (1.0 - col);
  // vignette
  vec2 q = vUv - 0.5;
  q.x *= uResolution.x / uResolution.y;
  float vig = smoothstep(1.05, 0.25, length(q));
  col *= mix(1.0, vig, uVignette);
  col = toSRGB(clamp(col, 0.0, 1.0));
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

const PREFILTER_FRAG = /* glsl */ `
#include <packing>
${FOG_GLSL}
uniform sampler2D tScene;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
uniform float uExposure;
varying vec2 vUv;
vec3 fetchC(vec2 uv) {
  vec3 c = texture2D(tScene, uv).rgb;
  float d = texture2D(tDepth, uv).x;
  float dist;
  return applyFog(c, uv, d, dist) * uExposure;
}
float karis(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main() {
  // 4 bilinear taps (box 4x4 texels) with Karis average to suppress fireflies
  vec3 a = fetchC(vUv + uTexel * vec2(-1.0, -1.0));
  vec3 b = fetchC(vUv + uTexel * vec2(1.0, -1.0));
  vec3 c = fetchC(vUv + uTexel * vec2(-1.0, 1.0));
  vec3 d = fetchC(vUv + uTexel * vec2(1.0, 1.0));
  float wa = karis(a), wb = karis(b), wc = karis(c), wd = karis(d);
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  float br = max(col.r, max(col.g, col.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  rq = (rq * rq) / (4.0 * uKnee + 1e-4);
  float w = max(rq, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(min(col * w, vec3(60.0)), 1.0);
}
`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 t = uTexel;
  vec3 a = texture2D(tSrc, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(tSrc, vUv).rgb;
  vec3 f = texture2D(tSrc, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(tSrc, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(tSrc, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture2D(tSrc, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture2D(tSrc, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(tSrc, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(tSrc, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(col, 1.0);
}
`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 col = texture2D(tSrc, vUv).rgb * 4.0;
  col += (texture2D(tSrc, vUv + vec2(-t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, -t.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  col += texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb;
  gl_FragColor = vec4(col / 16.0, 1.0);
}
`;

const AO_BLUR_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tAO;
uniform highp sampler2D tDepth;
uniform vec2 uDir;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
float linZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
void main() {
  float z0 = linZ(vUv);
  float sum = 0.0, wsum = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + uDir * float(i);
    float z = linZ(uv);
    float w = exp(-float(i * i) / 8.0) * max(0.0, 1.0 - abs(z - z0) / (z0 * 0.03 + 0.5));
    sum += texture2D(tAO, uv).r * w;
    wsum += w;
  }
  float ao = wsum > 0.0 ? sum / wsum : texture2D(tAO, vUv).r;
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

export interface GradeParams {
  exposure: number;
  tint: THREE.Color;
  saturation: number;
  contrast: number;
  lift: THREE.Color;
  vignette: number;
  bloomStrength: number;
  bloomThreshold: number;
}

export class PostFX {
  readonly renderer: THREE.WebGLRenderer;
  /** fog / aerial perspective uniforms (updated by WorldView) */
  readonly fog = {
    uFogOn: { value: 1 },
    uFogDensity: { value: 0.00012 },
    uFogFalloff: { value: 1 / 90 },
    uFogStart: { value: 200 },
    uHaze: { value: 0.00002 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunGlow: { value: new THREE.Vector3(0, 0, 0) },
    uSkyLut: { value: null as THREE.Texture | null },
    uSkyExposure: { value: 1 },
    uSkyFloor: { value: new THREE.Vector3() },
    uFogMax: { value: 0.92 },
  };
  readonly grade: GradeParams = {
    exposure: 1,
    tint: new THREE.Color(1, 1, 1),
    saturation: 1.05,
    contrast: 1.03,
    lift: new THREE.Color(0, 0, 0),
    vignette: 0.22,
    bloomStrength: 0.05,
    bloomThreshold: 1.3,
  };
  private q: QualitySettings;
  private width = 1;
  private height = 1;
  private sceneRT!: THREE.WebGLRenderTarget;
  private ldrRT: THREE.WebGLRenderTarget | null = null;
  private aoRT: THREE.WebGLRenderTarget | null = null;
  private aoRT2: THREE.WebGLRenderTarget | null = null;
  private bloomRTs: THREE.WebGLRenderTarget[] = [];
  private quad = new FullScreenQuad();
  private camUniforms = {
    tDepth: { value: null as THREE.Texture | null },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
  };
  private compositeMat: THREE.ShaderMaterial;
  private prefilterMat: THREE.ShaderMaterial;
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  private aoMat: THREE.ShaderMaterial;
  private aoBlurMat: THREE.ShaderMaterial;
  private fxaaMat: THREE.ShaderMaterial;
  private aoNoise: THREE.DataTexture;
  /** set false to skip post and render straight to the canvas (debug) */
  enabled = true;

  constructor(renderer: THREE.WebGLRenderer, q: QualitySettings) {
    this.renderer = renderer;
    this.q = q;
    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.fog,
        ...this.camUniforms,
        tScene: { value: null },
        tAO: { value: null },
        tBloom: { value: null },
        uAoOn: { value: 0 },
        uAoIntensity: { value: 0.85 },
        uAoFade: { value: 3000 },
        uBloomOn: { value: 0 },
        uBloomStrength: { value: 0.05 },
        uExposure: { value: 1 },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uSaturation: { value: 1 },
        uContrast: { value: 1 },
        uLift: { value: new THREE.Color(0, 0, 0) },
        uVignette: { value: 0.2 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.prefilterMat = new THREE.ShaderMaterial({
      uniforms: { ...this.fog, ...this.camUniforms, tScene: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.5 }, uExposure: { value: 1 } },
      vertexShader: QUAD_VERT,
      fragmentShader: PREFILTER_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.downMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, vertexShader: QUAD_VERT, fragmentShader: DOWN_FRAG, depthTest: false, depthWrite: false, toneMapped: false });
    this.upMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } },
      vertexShader: QUAD_VERT,
      fragmentShader: UP_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
      toneMapped: false,
    });
    this.aoNoise = generateMagicSquareNoise();
    this.aoMat = new THREE.ShaderMaterial({
      defines: { ...GTAOShader.defines, NORMAL_VECTOR_TYPE: 0, SAMPLES: 12, PERSPECTIVE_CAMERA: 1 },
      uniforms: THREE.UniformsUtils.clone(GTAOShader.uniforms),
      vertexShader: GTAOShader.vertexShader,
      fragmentShader: GTAOShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.aoMat.uniforms.tNoise.value = this.aoNoise;
    this.aoBlurMat = new THREE.ShaderMaterial({
      uniforms: { tAO: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uNear: { value: 1 }, uFar: { value: 1000 } },
      vertexShader: QUAD_VERT,
      fragmentShader: AO_BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.fxaaMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
      vertexShader: FXAAShader.vertexShader,
      fragmentShader: FXAAShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.allocate();
  }

  setQuality(q: QualitySettings) {
    this.q = q;
    this.allocate();
  }

  setSize(width: number, height: number) {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.allocate();
  }

  get size(): [number, number] {
    return [this.width, this.height];
  }

  private disposeTargets() {
    this.sceneRT?.dispose();
    this.sceneRT?.depthTexture?.dispose();
    this.ldrRT?.dispose();
    this.aoRT?.dispose();
    this.aoRT2?.dispose();
    for (const rt of this.bloomRTs) rt.dispose();
    this.bloomRTs = [];
    this.ldrRT = this.aoRT = this.aoRT2 = null;
  }

  private allocate() {
    this.disposeTargets();
    const { width: w, height: h, q } = this;
    const depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depthTexture.format = THREE.DepthFormat;
    depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: q.msaa,
      depthTexture,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.sceneRT.texture.name = 'scene-hdr';
    if (q.fxaa) {
      this.ldrRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    }
    if (q.ao > 0) {
      const s = q.ao === 2 ? 1 : 0.5;
      const aw = Math.max(1, Math.floor(w * s)), ah = Math.max(1, Math.floor(h * s));
      this.aoRT = new THREE.WebGLRenderTarget(aw, ah, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      this.aoRT2 = this.aoRT.clone();
      this.aoMat.defines.SAMPLES = q.aoSamples;
      this.aoMat.needsUpdate = true;
      this.aoMat.uniforms.resolution.value.set(aw, ah);
    }
    if (q.bloom) {
      let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
      for (let i = 0; i < q.bloomLevels; i++) {
        this.bloomRTs.push(new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false }));
        bw = Math.max(1, bw >> 1);
        bh = Math.max(1, bh >> 1);
        if (bw < 4 || bh < 4) break;
      }
    }
    this.fxaaMat.uniforms.resolution.value.set(1 / w, 1 / h);
    this.compositeMat.uniforms.uResolution.value.set(w, h);
  }

  /** Render the full frame. target = null -> canvas. `camera` may be perspective or orthographic. */
  render(scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget | null = null) {
    const r = this.renderer;
    const q = this.q;
    const persp = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true;
    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.render(scene, camera);

    const cu = this.camUniforms;
    cu.tDepth.value = this.sceneRT.depthTexture;
    cu.uInvProj.value.copy(camera.projectionMatrixInverse);
    cu.uCamWorld.value.copy(camera.matrixWorld);
    cu.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    const fogOn = this.fog.uFogOn.value;
    if (!persp) this.fog.uFogOn.value = 0;

    const g = this.grade;
    const cm = this.compositeMat.uniforms;

    // --- AO
    const useAO = q.ao > 0 && this.aoRT && persp;
    if (useAO && this.aoRT && this.aoRT2) {
      const pc = camera as THREE.PerspectiveCamera;
      const u = this.aoMat.uniforms;
      u.tDepth.value = this.sceneRT.depthTexture;
      u.cameraNear.value = pc.near;
      u.cameraFar.value = pc.far;
      u.cameraProjectionMatrix.value.copy(pc.projectionMatrix);
      u.cameraProjectionMatrixInverse.value.copy(pc.projectionMatrixInverse);
      u.cameraWorldMatrix.value.copy(pc.matrixWorld);
      this.quad.material = this.aoMat;
      r.setRenderTarget(this.aoRT);
      this.quad.render(r);
      const b = this.aoBlurMat.uniforms;
      b.tDepth.value = this.sceneRT.depthTexture;
      b.uNear.value = pc.near;
      b.uFar.value = pc.far;
      this.quad.material = this.aoBlurMat;
      b.tAO.value = this.aoRT.texture;
      b.uDir.value.set(1 / this.aoRT.width, 0);
      r.setRenderTarget(this.aoRT2);
      this.quad.render(r);
      b.tAO.value = this.aoRT2.texture;
      b.uDir.value.set(0, 1 / this.aoRT.height);
      r.setRenderTarget(this.aoRT);
      this.quad.render(r);
      cm.tAO.value = this.aoRT.texture;
    }
    cm.uAoOn.value = useAO ? 1 : 0;

    // --- bloom
    const useBloom = q.bloom && this.bloomRTs.length > 0 && g.bloomStrength > 0.001;
    if (useBloom) {
      const p = this.prefilterMat.uniforms;
      p.tScene.value = this.sceneRT.texture;
      p.uTexel.value.set(1 / this.width, 1 / this.height);
      p.uThreshold.value = g.bloomThreshold;
      p.uKnee.value = g.bloomThreshold * 0.6;
      p.uExposure.value = g.exposure;
      this.quad.material = this.prefilterMat;
      r.setRenderTarget(this.bloomRTs[0]);
      this.quad.render(r);
      const d = this.downMat.uniforms;
      this.quad.material = this.downMat;
      for (let i = 1; i < this.bloomRTs.length; i++) {
        const src = this.bloomRTs[i - 1];
        d.tSrc.value = src.texture;
        d.uTexel.value.set(1 / src.width, 1 / src.height);
        r.setRenderTarget(this.bloomRTs[i]);
        this.quad.render(r);
      }
      const up = this.upMat.uniforms;
      this.quad.material = this.upMat;
      for (let i = this.bloomRTs.length - 1; i > 0; i--) {
        const src = this.bloomRTs[i];
        up.tSrc.value = src.texture;
        up.uTexel.value.set(1 / src.width, 1 / src.height);
        up.uRadius.value = 1.0;
        r.setRenderTarget(this.bloomRTs[i - 1]);
        const ac = r.autoClear;
        r.autoClear = false;
        this.quad.render(r);
        r.autoClear = ac;
      }
      cm.tBloom.value = this.bloomRTs[0].texture;
    }
    cm.uBloomOn.value = useBloom ? 1 : 0;
    cm.uBloomStrength.value = g.bloomStrength;

    // --- composite
    cm.tScene.value = this.sceneRT.texture;
    cm.uExposure.value = g.exposure;
    (cm.uTint.value as THREE.Color).copy(g.tint);
    cm.uSaturation.value = g.saturation;
    cm.uContrast.value = g.contrast;
    (cm.uLift.value as THREE.Color).copy(g.lift);
    cm.uVignette.value = g.vignette;
    this.quad.material = this.compositeMat;
    const useFxaa = q.fxaa && this.ldrRT;
    r.setRenderTarget(useFxaa ? this.ldrRT : target);
    this.quad.render(r);
    if (useFxaa && this.ldrRT) {
      this.fxaaMat.uniforms.tDiffuse.value = this.ldrRT.texture;
      this.quad.material = this.fxaaMat;
      r.setRenderTarget(target);
      this.quad.render(r);
    }
    this.fog.uFogOn.value = fogOn;
  }

  /** AO parameters (world units), scaled by the caller with camera distance */
  setAOParams(radius: number, intensity: number, fadeDistance: number) {
    const u = this.aoMat.uniforms;
    u.radius.value = radius;
    u.thickness.value = radius * 1.5;
    u.distanceExponent.value = 1.6;
    u.distanceFallOff.value = 1;
    u.scale.value = 1;
    this.compositeMat.uniforms.uAoIntensity.value = intensity;
    this.compositeMat.uniforms.uAoFade.value = fadeDistance;
  }

  dispose() {
    this.disposeTargets();
    this.quad.dispose();
    this.compositeMat.dispose();
    this.prefilterMat.dispose();
    this.downMat.dispose();
    this.upMat.dispose();
    this.aoMat.dispose();
    this.aoBlurMat.dispose();
    this.fxaaMat.dispose();
    this.aoNoise.dispose();
  }
}
