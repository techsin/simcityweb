/** NEW-02: hover and inspector selection retain the roadless red on full models and LOD fades. */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CELL_SIZE } from '../../src/core/constants';
import { Overlay } from '../../src/core/types';
import { BuildingRenderer } from '../../src/render/city/buildings/BuildingRenderer';
import { TileCuller } from '../../src/render/city/common/batch';
import { getCityMaterial, getGhostMaterial } from '../../src/render/city/common/cityMaterial';
import { setBuildingOverlay } from '../../src/render/world/overlays';
import { EMG_FIRE } from '../../src/sim/infra/overlays';
import { newState } from '../infra/cityGen';

type Shader = THREE.WebGLProgramParametersWithUniforms;
const renderers: BuildingRenderer[] = [];

afterEach(() => {
  for (const br of renderers.splice(0)) br.dispose();
});

function compile(material: THREE.Material): Shader {
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as unknown as Shader;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

function selectionLine(shader: Shader): string {
  const line = shader.fragmentShader.match(/totalEmissiveRadiance \+= _sel[^;]+;/)?.[0];
  expect(line, 'selection glow survives the composed shader patches').toBeDefined();
  return line!;
}

/** Evaluate the compiled selection expression per channel, with GLSL's vec3/sin mapped to scalar JS. */
function selection(shader: Shader, noRoad: number, selected: number, time: number): number[] {
  const expr = selectionLine(shader).replace('totalEmissiveRadiance += ', '').replace(';', '');
  return [0, 1, 2].map((channel) => {
    const scalar = expr.replace(/vec3\(([^)]+)\)/g, (_, values: string) => values.split(',')[channel].trim())
      .replace(/\bsin\(/g, 'Math.sin(');
    return new Function('_sel', 'vBuildingNoRoad', 'uTime', `return ${scalar};`)(selected, noRoad, time) as number;
  });
}

function shaders() {
  const st = newState(32), br = new BuildingRenderer(st, new TileCuller(st.size, CELL_SIZE, 16));
  renderers.push(br);
  setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, true, true);
  br.update(0);
  const fade = (br as unknown as { fadeLayer: { mesh: THREE.BatchedMesh } }).fadeLayer.mesh;
  return { st, br, shaders: [compile(br.batch.mesh.material as THREE.Material), compile(fade.material as THREE.Material)] };
}

describe('roadless building selection glow', () => {
  it('keeps selected and hovered roadless models red in the full and proxy fade shaders', () => {
    const { shaders: composed } = shaders();
    for (const shader of composed) {
      expect(selectionLine(shader)).toContain('vBuildingNoRoad > 0.5');
      for (const time of [0, Math.PI / 10, Math.PI * 3 / 10]) {
        const glow = selection(shader, 1, 1, time), pulse = 0.55 + 0.3 * Math.sin(time * 5);
        expect(glow).toEqual([pulse, 0.3 * pulse, 0.3 * pulse]);
        expect(glow[0]).toBeGreaterThan(glow[1] * 3);
        expect(selection(shader, 1, 0, time)).toEqual([0, 0, 0]);
      }
    }
  });

  it('keeps road-access selection arithmetic and colours identical, including with the tint disabled', () => {
    const { st, br, shaders: composed } = shaders(), original = compile(getCityMaterial());
    for (const shader of composed) {
      expect(selectionLine(shader)).toContain('_sel * (vBuildingNoRoad > 0.5 ? vec3(1.0, 0.3, 0.3) : vec3(0.25, 0.6, 1.0))');
      for (const time of [0, 0.25, 1]) for (const selected of [0, 1]) {
        expect(selection(shader, 0, selected, time)).toEqual(selection(original, 0, selected, time));
      }
    }
    setBuildingOverlay(st, Overlay.None);
    br.update(0);
    for (const shader of composed) {
      expect(shader.uniforms.uBuildingNoRoadOn.value).toBe(0);
      expect(shader.vertexShader).toContain('vBuildingNoRoad = 0.0;');
      expect(shader.vertexShader).toContain('if (uBuildingNoRoadOn > 0.5)');
      expect(selection(shader, 0, 1, 0.25)).toEqual(selection(original, 0, 1, 0.25));
    }
  });

  it('leaves the shared prop and ghost shaders unchanged', () => {
    const city = getCityMaterial(), ghost = getGhostMaterial();
    const before = [compile(city), compile(ghost)];
    const { shaders: composed } = shaders();
    expect(composed[1].fragmentShader).toContain('vLodFade');
    for (const [index, material] of [city, ghost].entries()) {
      const after = compile(material);
      expect(after.vertexShader).toBe(before[index].vertexShader);
      expect(after.fragmentShader).toBe(before[index].fragmentShader);
      expect(after.fragmentShader).not.toContain('vBuildingNoRoad');
      expect(selectionLine(after)).toContain('_sel * vec3(0.25, 0.6, 1.0)');
    }
  });
});
