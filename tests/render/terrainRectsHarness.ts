import { Buffer } from 'node:buffer';
import * as THREE from 'three';
import { WebGLProperties } from 'three/src/renderers/webgl/WebGLProperties.js';
import { WebGLTextures } from 'three/src/renderers/webgl/WebGLTextures.js';
import type { CellRect } from '../../src/core/events';
import type { Building } from '../../src/sim/CityState';
import type { Simulation } from '../../src/sim/Simulation';
import { TerrainRenderer } from '../../src/render/world/TerrainRenderer';

export function cellTextures(t: TerrainRenderer): THREE.DataTexture[] {
  return [t.uniforms.uZoneTexU.value, t.lightTexture, t.uniforms.uTreeTex.value] as THREE.DataTexture[];
}

export function allTextures(t: TerrainRenderer): THREE.DataTexture[] {
  return [...cellTextures(t), t.uniforms.uExitTex.value as THREE.DataTexture];
}

export function pixels(t: THREE.DataTexture): Uint8Array {
  return t.image.data as Uint8Array;
}

function consumed(t: THREE.DataTexture) {
  t.clearUpdateRanges();
  t.onUpdate?.(t);
}

/**
 * The cells active tornadoes have crossed (their funnel cells, padded beyond TORNADO_RADIUS), for check()'s `lag`.
 * clear() once no tornado is active: the end event's treesChanged covers the whole path.
 */
export function tornadoPath(sim: Simulation) {
  const N = sim.state.size, pad = 3;
  let rect: CellRect | null = null;
  const off = sim.events.on('disaster', (d) => {
    if (d.kind !== 'tornado' || !d.active) return;
    const x = Math.floor(d.x), z = Math.floor(d.z);
    const r = { x0: Math.max(0, x - pad), z0: Math.max(0, z - pad), x1: Math.min(N, x + pad + 1), z1: Math.min(N, z + pad + 1) };
    rect = rect ? { x0: Math.min(rect.x0, r.x0), z0: Math.min(rect.z0, r.z0), x1: Math.max(rect.x1, r.x1), z1: Math.max(rect.z1, r.z1) } : r;
  });
  return {
    get rect() { return rect; },
    clear() { rect = null; },
    dispose: off,
  };
}

/** Match WorldView.bindEvents; the reference takes the original whole-map refill path every frame. */
export function terrainPair(sim: Simulation) {
  const terrain = new TerrainRenderer(sim.state, 0, false);
  const full = new TerrainRenderer(sim.state, 0, false);
  const cells = (r: CellRect) => terrain.markCells(r);
  const building = (b: Building) => cells({ x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d });
  const off = [
    sim.events.on('terrainChanged', (r) => terrain.onTerrainChanged(r)),
    sim.events.on('zoneChanged', cells), sim.events.on('networkChanged', cells),
    sim.events.on('treesChanged', cells), sim.events.on('powerLinesChanged', cells),
    sim.events.on('buildingAdded', building), sim.events.on('buildingRemoved', building),
    sim.events.on('layerUpdated', (name) => terrain.onLayerUpdated(name)),
    sim.events.on('month', () => { terrain.setMonth(sim.state.month); full.setMonth(sim.state.month); }),
    sim.events.on('reset', () => { terrain.reset(sim.state); full.reset(sim.state); }),
  ];
  for (const t of [...allTextures(terrain), ...allTextures(full)]) consumed(t);
  return {
    terrain, full,
    /**
     * Throws on the first differing byte. `lag`: tree cells inside it may trail the full refill (an active tornado's
     * path, R1's one known lag); returns how many did.
     */
    check(context: string, lag: CellRect | null = null): { lagging: number } {
      terrain.update();
      full.markCells({ x0: 0, z0: 0, x1: sim.state.size, z1: sim.state.size });
      full.update();
      const actual = allTextures(terrain), expected = allTextures(full);
      const names = ['zone', 'light', 'tree', 'exit'];
      const N = sim.state.size;
      const lags = (k: number, i: number) => names[k] === 'tree' && lag !== null
        && i % N >= lag.x0 && i % N < lag.x1 && Math.floor(i / N) >= lag.z0 && Math.floor(i / N) < lag.z1;
      let lagging = 0;
      try {
        for (let k = 0; k < actual.length; k++) {
          const a = pixels(actual[k]), b = pixels(expected[k]);
          if (!Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))) {
            for (let i = 0; i < a.length; i++) {
              if (a[i] === b[i]) continue;
              if (!lags(k, i)) throw new Error(`${context}: ${names[k]} byte ${i}: dirty ${a[i]}, full ${b[i]}`);
              lagging++;
            }
          }
        }
      } finally {
        for (const t of [...actual, ...expected]) consumed(t);
      }
      return { lagging };
    },
    dispose() {
      for (const f of off) f();
      terrain.dispose(); full.dispose();
    },
  };
}

interface Image { width: number; height: number; data: Uint8Array }
interface Upload { x: number; y: number; width: number; height: number }

/** Run three's real r186 uploader against byte-addressed storage, including GL's format-dependent unpack stride. */
export function textureDriver() {
  let constant = 1;
  const gl = new Proxy<Record<string, any>>({
    createTexture: (): Image => ({ width: 0, height: 0, data: new Uint8Array() }),
    deleteTexture() {}, texParameteri() {},
  }, {
    get(target, key: string) { return target[key] ??= constant++; },
  });
  const properties = new WebGLProperties();
  const unpack = new Map<number, number>();
  const calls: Upload[] = [];
  let bound: Image;
  const state = {
    bindTexture(_target: number, image: Image) { bound = image; },
    activeTexture() {},
    getParameter(p: number) { return unpack.get(p) ?? 0; },
    pixelStorei(p: number, value: number) { unpack.set(p, value); },
    texStorage2D(_target: number, _levels: number, format: number, width: number, height: number) {
      bound.width = width; bound.height = height;
      bound.data = new Uint8Array(width * height * (format === gl.RGBA8UI ? 4 : 1));
    },
    texSubImage2D(_target: number, _level: number, x: number, y: number, width: number, height: number, format: number, _type: number, data: Uint8Array) {
      const channels = format === gl.RGBA_INTEGER ? 4 : 1;
      const rowLength = unpack.get(gl.UNPACK_ROW_LENGTH) || bound.width;
      const skipX = unpack.get(gl.UNPACK_SKIP_PIXELS) || 0, skipY = unpack.get(gl.UNPACK_SKIP_ROWS) || 0;
      calls.push({ x, y, width, height });
      for (let row = 0; row < height; row++) {
        const from = ((skipY + row) * rowLength + skipX) * channels;
        bound.data.set(data.subarray(from, from + width * channels), ((y + row) * bound.width + x) * channels);
      }
    },
  };
  const args = [
    gl, { has: () => false }, state, properties, { maxTextureSize: 8192 },
    { convert: (v: number) => v === THREE.RedFormat ? gl.RED : v === THREE.RGBAIntegerFormat ? gl.RGBA_INTEGER : gl.UNSIGNED_BYTE },
    { memory: { textures: 0 } },
  ] as unknown as ConstructorParameters<typeof WebGLTextures>;
  const textures = new WebGLTextures(...args);
  return {
    upload(t: THREE.DataTexture): Upload[] {
      calls.length = 0;
      textures.setTexture2D(t, 0);
      return calls.slice();
    },
    read(t: THREE.DataTexture): Uint8Array {
      return (properties.get(t) as { __webglTexture: Image }).__webglTexture.data;
    },
  };
}

export function watchCanvas(t: TerrainRenderer, canvas: EventTarget) {
  t.material.onBeforeRender({ domElement: canvas } as THREE.WebGLRenderer, new THREE.Scene(), new THREE.Camera(),
    new THREE.BufferGeometry(), t.group, new THREE.Group());
}
