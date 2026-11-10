/**
 * T095: the water program's functions return once, at their end. waterGround() returned from inside its in-map branch,
 * and D3D's shader compiler (ANGLE on Windows) logged "X4000: use of potentially uninitialized variable
 * (f_waterGround)" on every city load. Text checks of the patched program (pure JS, no WebGL context):
 *  - waterGround() and waterShade() have no return inside a block, at every water detail level
 *  - both branches of waterGround() still read the texel they read before (the terrain's height texture inside the
 *    map, the coarse outer texture beyond it), and the one value they assign is what the function returns
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WaterRenderer } from '../../src/render/world/WaterRenderer';

/** the water material's fragment shader as three compiles it (the standard material's, patched by onBeforeCompile) */
function program(detail: 0 | 1 | 2): THREE.WebGLProgramParametersWithUniforms {
  const water = new WaterRenderer(new THREE.Texture(), 64, 'temperate', () => 0, detail);
  const sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
  water.material.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
  water.dispose();
  return sh;
}

/** the body of a GLSL function (between its braces), without comments, whitespace collapsed */
function body(src: string, signature: string): string {
  const at = src.indexOf(signature);
  if (at < 0) throw new Error(`no ${signature}`);
  const open = src.indexOf('{', at);
  for (let i = open, depth = 0; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i).replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  }
  throw new Error(`unbalanced ${signature}`);
}

/** brace depth, inside a function body, of each of its return statements (0 = not inside any block) */
function returnDepths(fn: string): number[] {
  const out: number[] = [];
  let depth = 0;
  for (const m of fn.matchAll(/[{}]|\breturn\b/g)) {
    if (m[0] === '{') depth++;
    else if (m[0] === '}') depth--;
    else out.push(depth);
  }
  return out;
}

describe('T095: the water program returns once per function', () => {
  // (built here, not in a test: the first one generates the shared wave and noise textures)
  const programs = ([0, 1, 2] as const).map(program);

  it.each([0, 1, 2] as const)('detail %i: no return inside a block', (detail) => {
    const sh = programs[detail];
    expect(sh.defines).toMatchObject({ WATER_DETAIL: detail });
    expect(sh.fragmentShader).toContain('diffuseColor.rgb = waterShade(vWW);');
    for (const signature of ['float waterGround(vec3 P)', 'vec3 waterShade(vec3 P)']) {
      const fn = body(sh.fragmentShader, signature);
      expect(returnDepths(fn), signature).toEqual([0]);
      expect(fn, signature).toMatch(/\breturn [^;]+;$/);
    }
  });

  it('waterGround reads the same texel in both branches as before, and returns it', () => {
    const fn = body(programs[2].fragmentShader, 'float waterGround(vec3 P)');
    const m = /^float W = uN \* uCell; float (\w+); if \(P\.x >= 0\.0 && P\.z >= 0\.0 && P\.x <= W && P\.z <= W\) \{ (.+?) \} else \{ (.+?) \} return (\w+);$/.exec(fn);
    expect(m, fn).not.toBeNull();
    const [, declared, inside, outside, returned] = m!;
    expect(returned).toBe(declared);
    // inside the map: the terrain's height texture, (N+1)^2 texels at the cell corners
    expect(inside).toBe(`vec2 uv = (P.xz / uCell + 0.5) / (uN + 1.0); ${declared} = texture2D(uHeightTex, uv).r;`);
    // beyond it: the coarse outer texture over the map plus uOuterExt on every side
    expect(outside).toBe(`vec2 uv = (P.xz + uOuterExt) / (W + 2.0 * uOuterExt); ${declared} = texture2D(uOuterTex, uv).r;`);
  });
});
