/**
 * WaterRenderer — one sea-level water plane (extends to the horizon) with a patched MeshStandardMaterial:
 *  - depth from the terrain height texture (map) / a coarse outer height texture (beyond the map)
 *  - depth-based body color (turquoise shallows -> deep blue), soft transparent shoreline
 *  - animated multi-octave normal map waves, distance-based calming (anti-sparkle)
 *  - fresnel sky reflection via scene.environment + sun glints from the PBR specular (shadowed by buildings)
 *  - shoreline foam bands + whitecaps
 * Output uses premultiplied blending so reflections stay at full strength over transparent shallows.
 */
import * as THREE from 'three';
import { CELL_SIZE, SEA_LEVEL } from '../../core/constants';
import type { Climate } from '../../core/types';
import { getNoiseTexture, getWaveNormalTexture } from './textures';

const OUTER = 32000;
const OUTER_RES = 512;
/** extent (m) of the coarse outer height texture around the map (beyond: clamped) */
const OUTER_TEX = 12000;

const WATER_VERT_PARS = /* glsl */ `
varying vec3 vWW;
`;
const WATER_VERT_MAIN = /* glsl */ `
vWW = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const WATER_FRAG_PARS = /* glsl */ `
varying vec3 vWW;
uniform sampler2D uHeightTex;
uniform sampler2D uOuterTex;
uniform sampler2D uWave;
uniform sampler2D uNoise;
uniform float uN;
uniform float uCell;
uniform float uOuterExt;
uniform float uSea;
uniform float uWTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoamCol;
uniform float uWNight;
vec3 wNormalW = vec3(0.0, 1.0, 0.0);
float wAlpha = 1.0;
float wRough = 0.05;
float wFoam = 0.0;

float waterGround(vec3 P) {
  float W = uN * uCell;
  if (P.x >= 0.0 && P.z >= 0.0 && P.x <= W && P.z <= W) {
    vec2 uv = (P.xz / uCell + 0.5) / (uN + 1.0);
    return texture2D(uHeightTex, uv).r;
  }
  vec2 uv = (P.xz + uOuterExt) / (W + 2.0 * uOuterExt);
  return texture2D(uOuterTex, uv).r;
}

vec3 waterShade(vec3 P) {
  float ground = waterGround(P);
  float depth = max(uSea - ground, 0.0);
  float dist = length(P - cameraPosition);

  // waves (tangent space xy -> world xz)
  vec2 t = vec2(uWTime);
  vec3 n1 = texture2D(uWave, P.xz / 61.0 + t * vec2(0.011, 0.006)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uWave, P.xz / 23.0 + t * vec2(-0.017, 0.013)).xyz * 2.0 - 1.0;
  vec2 g = n1.xy * 0.9 + n2.xy * 0.7;
#if WATER_DETAIL > 0
  vec3 n3 = texture2D(uWave, P.xz / 7.3 + t * vec2(0.03, -0.026)).xyz * 2.0 - 1.0;
  g += n3.xy * 0.45;
#endif
#if WATER_DETAIL > 1
  vec3 n4 = texture2D(uWave, P.xz / 2.1 + t * vec2(-0.05, -0.043)).xyz * 2.0 - 1.0;
  g += n4.xy * 0.25 * (1.0 - smoothstep(30.0, 250.0, dist));
#endif
  float calm = 1.0 / (1.0 + dist / 900.0);
  // shallow water is calmer (except the surf)
  calm *= mix(0.45, 1.0, smoothstep(0.0, 3.0, depth));
  g *= 0.55 * calm;
  wNormalW = normalize(vec3(g.x, 1.0, g.y));

  // body color by depth
  float k = 1.0 - exp(-depth * 0.16);
  vec3 body = mix(uShallow, uDeep, k);
  body *= 1.0 - 0.5 * smoothstep(12.0, 40.0, depth);
  // opacity: very clear at the shore, opaque when deep
  wAlpha = clamp(1.0 - exp(-depth * 0.42), 0.0, 1.0) * 0.93 + 0.07 * smoothstep(0.0, 0.4, depth);

  // foam: shoreline bands moving toward the beach + whitecaps offshore
  vec4 nz = texture2D(uNoise, P.xz / 90.0 + t * 0.002);
  float band = 1.0 - smoothstep(0.3, 1.4, depth);
  float wave = sin(depth * 5.0 - uWTime * 1.3 + nz.g * 9.0) * 0.5 + 0.5;
  float foam = band * smoothstep(0.86, 0.99, wave) * smoothstep(0.4, 0.7, nz.b + 0.15) * 0.8;
  foam += (1.0 - smoothstep(0.0, 0.45, depth)) * 0.7 * smoothstep(0.35, 0.65, nz.r + 0.08);
#if WATER_DETAIL > 0
  float caps = smoothstep(0.78, 0.9, texture2D(uNoise, P.xz / 37.0 + t * vec2(0.004, 0.002)).b) * smoothstep(4.0, 20.0, depth);
  foam += caps * 0.35 * (1.0 - smoothstep(600.0, 2500.0, dist));
#endif
  foam = clamp(foam, 0.0, 1.0) * (1.0 - smoothstep(1500.0, 5000.0, dist));
  wFoam = foam;
  wAlpha = max(wAlpha, foam * 0.95);
  wRough = mix(0.035, 0.11, smoothstep(300.0, 4000.0, dist));
  wRough = mix(wRough, 0.6, foam);
  return mix(body, uFoamCol, foam);
}
`;

export interface WaterPalette {
  shallow: THREE.Color;
  deep: THREE.Color;
}

function palette(c: Climate): WaterPalette {
  switch (c) {
    case 'tropical': return { shallow: new THREE.Color(0x2fc0b4), deep: new THREE.Color(0x06385c) };
    case 'desert': return { shallow: new THREE.Color(0x3a9e96), deep: new THREE.Color(0x0a3450) };
    case 'alpine': return { shallow: new THREE.Color(0x2c7f7c), deep: new THREE.Color(0x07263a) };
    default: return { shallow: new THREE.Color(0x2a8a80), deep: new THREE.Color(0x062a42) };
  }
}

export class WaterRenderer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms;
  private outerData: Uint16Array;
  private outerTex: THREE.DataTexture;
  private detail: 0 | 1 | 2;
  private N: number;

  constructor(heightTexture: THREE.Texture, N: number, climate: Climate, worldHeight: (x: number, z: number) => number, detail: 0 | 1 | 2 = 2) {
    this.N = N;
    this.detail = detail;
    this.outerData = new Uint16Array(OUTER_RES * OUTER_RES);
    this.outerTex = new THREE.DataTexture(this.outerData, OUTER_RES, OUTER_RES, THREE.RedFormat, THREE.HalfFloatType);
    this.outerTex.magFilter = this.outerTex.minFilter = THREE.LinearFilter;
    this.outerTex.generateMipmaps = false;
    this.updateOuter(worldHeight);
    const pal = palette(climate);
    this.uniforms = {
      uHeightTex: { value: heightTexture },
      uOuterTex: { value: this.outerTex as THREE.Texture },
      uWave: { value: getWaveNormalTexture() as THREE.Texture },
      uNoise: { value: getNoiseTexture() as THREE.Texture },
      uN: { value: N },
      uCell: { value: CELL_SIZE },
      uOuterExt: { value: OUTER_TEX },
      uSea: { value: SEA_LEVEL },
      uWTime: { value: 0 },
      uShallow: { value: pal.shallow },
      uDeep: { value: pal.deep },
      uFoamCol: { value: new THREE.Color(0xf4f7f8) },
      uWNight: { value: 0 },
    };
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      depthWrite: true,
      envMapIntensity: 1.0,
    });
    this.material.name = 'water';
    // premultiplied: rgb = body * a + specular, dst * (1 - a)
    this.material.blending = THREE.CustomBlending;
    this.material.blendSrc = THREE.OneFactor;
    this.material.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.material.blendSrcAlpha = THREE.OneFactor;
    this.material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.patch();

    const W = N * CELL_SIZE;
    const size = W + OUTER * 2;
    const geo = new THREE.PlaneGeometry(size, size, 8, 8);
    geo.rotateX(-Math.PI / 2);
    geo.translate(W / 2, SEA_LEVEL, W / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'water';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10; // first among transparent objects
  }

  private patch() {
    const u = () => this.uniforms;
    const detail = this.detail;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u());
      shader.defines = { ...(shader.defines ?? {}), WATER_DETAIL: detail };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + WATER_VERT_PARS)
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + WATER_VERT_MAIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + WATER_FRAG_PARS)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = waterShade(vWW);\ndiffuseColor.a = wAlpha;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = wRough;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(wNormalW, 0.0)).xyz);')
        .replace('#include <opaque_fragment>', 'gl_FragColor = vec4(totalDiffuse * wAlpha + totalSpecular * (1.0 - wFoam * 0.5) + totalEmissiveRadiance, wAlpha);');
    };
    this.material.customProgramCacheKey = () => `water-${detail}`;
    this.material.needsUpdate = true;
  }

  setQuality(detail: 0 | 1 | 2) {
    if (detail === this.detail) return;
    this.detail = detail;
    this.patch();
  }

  /** (re)sample the synthetic outer landscape heights into the coarse texture */
  updateOuter(worldHeight: (x: number, z: number) => number) {
    const W = this.N * CELL_SIZE;
    const size = W + 2 * OUTER_TEX;
    for (let j = 0; j < OUTER_RES; j++)
      for (let i = 0; i < OUTER_RES; i++) {
        const x = -OUTER_TEX + ((i + 0.5) / OUTER_RES) * size;
        const z = -OUTER_TEX + ((j + 0.5) / OUTER_RES) * size;
        this.outerData[j * OUTER_RES + i] = THREE.DataUtils.toHalfFloat(worldHeight(x, z));
      }
    this.outerTex.needsUpdate = true;
  }

  update(time: number, night: number) {
    this.uniforms.uWTime.value = time;
    this.uniforms.uWNight.value = night;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.outerTex.dispose();
  }
}
