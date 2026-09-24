/**
 * City building materials: derived from the shared uber material (getBuildingMaterial) by composing its
 * onBeforeCompile with a small extra patch, so any change render-world makes to the uber shader is inherited.
 *
 * Extra features:
 *  - per-instance flags encoded in the BatchedMesh instance color ALPHA: a = 1 - flags/16
 *      bit0 (1) windows off (abandoned)   bit1 (2) selected highlight   bit2 (4) on fire glow
 *    (alpha is otherwise unused for opaque materials; flags 0 => alpha 1 => default look)
 *  - uCityOverlay (0..1): data-view look (desaturated, whitened, no night emission)
 *  - ghost variant: transparent tinted preview material
 */
import * as THREE from 'three';
import { getBuildingMaterial, sharedUniforms } from '../../../assets/materials';

export const cityUniforms = {
  uCityOverlay: { value: 0 },
  uGhostTint: { value: new THREE.Color(0.2, 1.0, 0.4) },
  uCityDim: { value: 0 },
};

export const IF_WINDOWS_OFF = 1;
export const IF_SELECTED = 2;
export const IF_FIRE = 4;

export function flagsToAlpha(flags: number): number {
  return 1 - (flags & 15) / 16;
}

const FRAG_PARS = /* glsl */ `
uniform float uCityOverlay;
uniform float uCityDim;
uniform vec3 uGhostTint;
float _cityFlags = 0.0;
`;

function patch(shader: THREE.WebGLProgramParametersWithUniforms, ghost: boolean): void {
  shader.uniforms.uCityOverlay = cityUniforms.uCityOverlay;
  shader.uniforms.uCityDim = cityUniforms.uCityDim;
  shader.uniforms.uGhostTint = cityUniforms.uGhostTint;
  if (!shader.uniforms.uTime) shader.uniforms.uTime = sharedUniforms.uTime;
  let fs = shader.fragmentShader;
  fs = fs.replace('#include <common>', '#include <common>\n' + FRAG_PARS);
  fs = fs.replace(
    '#include <color_fragment>',
    `#include <color_fragment>
    _cityFlags = floor((1.0 - clamp(diffuseColor.a / max(opacity, 1e-3), 0.0, 1.0)) * 16.0 + 0.5);
    diffuseColor.a = opacity;`,
  );
  const hasSurf = fs.includes('_surfEmissive');
  const overlayCode = `
    {
      float _lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(_lum) * 0.45 + 0.42, uCityOverlay * 0.85);
      diffuseColor.rgb *= 1.0 - 0.75 * uCityDim;
      ${ghost ? 'diffuseColor.rgb = mix(diffuseColor.rgb, uGhostTint, 0.6) * 1.15;' : ''}
    }`;
  if (fs.includes('#include <normal_fragment_begin>')) {
    fs = fs.replace('#include <normal_fragment_begin>', overlayCode + '\n#include <normal_fragment_begin>');
  }
  const emisPre = `
    ${hasSurf ? `
    if (mod(_cityFlags, 2.0) > 0.5) _surfEmissive *= 0.0;
    _surfEmissive *= 1.0 - 0.9 * uCityOverlay;
    _surfEmissive *= 1.0 - uCityDim;` : ''}
  `;
  const emisPost = `
    {
      float _sel = mod(floor(_cityFlags / 2.0), 2.0);
      float _fire = mod(floor(_cityFlags / 4.0), 2.0);
      totalEmissiveRadiance += _sel * vec3(0.25, 0.6, 1.0) * (0.55 + 0.3 * sin(uTime * 5.0));
      if (_fire > 0.5) {
        // patchy flickering glow (strongest at night), like fire behind windows: soft patches on the building's walls
        // (roofs less), none on the lot's ground (lawns / pavement washed salmon-pink), moderate at night so the glow
        // stays orange under the night exposure + bloom instead of blowing out
        vec3 _fp = vObjPos;
        float _patch = smoothstep(0.32, 0.95, sin(_fp.x * 0.45 + uTime * 0.7) * sin(_fp.y * 0.35 - uTime * 0.9) * sin(_fp.z * 0.4 + 1.3) * 0.5 + 0.5);
        float _fl = 0.65 + 0.25 * sin(uTime * 11.0 + _fp.y * 0.7) + 0.15 * sin(uTime * 23.0 + _fp.x);
        float _wall = mix(0.35, 1.0, 1.0 - smoothstep(0.5, 0.9, abs(normalize(vObjNormal).y)));
        float _above = smoothstep(0.6, 2.4, _fp.y);
        totalEmissiveRadiance += vec3(1.0, 0.34, 0.05) * _patch * _fl * _wall * _above * mix(0.35, 0.65, uNight);
      }
      ${ghost ? `{
        // bright fresnel rim + gentle pulse so the ghost reads clearly on any background
        float _fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.0);
        float _pulse = 0.85 + 0.15 * sin(uTime * 4.0);
        totalEmissiveRadiance += uGhostTint * (0.45 + 1.6 * _fr) * _pulse;
      }` : ''}
    }`;
  fs = fs.replace('#include <emissivemap_fragment>', emisPre + '\n#include <emissivemap_fragment>');
  // emissive additions after the base patch's += line: insert before lights
  fs = fs.replace('#include <lights_physical_fragment>', emisPost + '\n#include <lights_physical_fragment>');
  shader.fragmentShader = fs;
}

function derive(key: string, ghost: boolean): THREE.MeshStandardMaterial {
  const base = getBuildingMaterial();
  const m = base.clone();
  const baseCompile = base.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    baseCompile.call(base, shader, renderer);
    patch(shader, ghost);
  };
  const baseKey = base.customProgramCacheKey();
  m.customProgramCacheKey = () => baseKey + '|' + key;
  if (ghost) {
    m.transparent = true;
    m.opacity = 0.72;
    m.depthWrite = false;
  }
  return m;
}

let _city: THREE.MeshStandardMaterial | null = null;
let _ghost: THREE.MeshStandardMaterial | null = null;

/** material for buildings / props / vehicles BatchedMeshes (supports per-instance flags) */
export function getCityMaterial(): THREE.MeshStandardMaterial {
  return (_city ??= derive('city-v1', false));
}

/** translucent tinted ghost material (tint via cityUniforms.uGhostTint) */
export function getGhostMaterial(): THREE.MeshStandardMaterial {
  return (_ghost ??= derive('ghost-v1', true));
}

/** keep simple scalar properties in sync with the shared uber material (render-world may tweak them) */
export function syncCityMaterials(): void {
  const base = getBuildingMaterial();
  for (const m of [_city, _ghost]) {
    if (!m) continue;
    m.envMapIntensity = base.envMapIntensity;
    m.roughness = base.roughness;
    m.metalness = base.metalness;
  }
}
