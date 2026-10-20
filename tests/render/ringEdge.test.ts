/**
 * Outer ring next to the map edge (pure JS, no WebGL context): the near pairs (regular impostors) and the far blocks
 * (micro impostors) split every ring tree between them per tree, in the vertex shaders, by one switch distance; the CPU
 * only decides which meshes and which prefix of their (ordered) trees are submitted. These tests emulate the shaders'
 * per-tree predicates (TreeRenderer FAR_VERT_MAIN) and check that
 *  - no tree the shaders draw and the view shows is left out by the CPU's prefixes / culls, at any camera (low next to
 *    the edge, high, in between, beyond the edge) and low-camera switch distance,
 *  - no tree is drawn by both meshes (the far blocks' conifer feet match the near pairs'),
 *  - a low camera next to the edge sees the ring past the switch distance (the r4 regression: the far blocks were
 *    faded out with the camera height, so the forest stopped ~0.85 km from a low camera),
 *  - the low-camera micro shape (ringLow) is the high cameras' upper half plus a lower half of its own.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { RING_LOW_APEX, getMicroImpostorGeometries } from '../../src/render/world/fallbackTrees';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { TerrainRenderer } from '../../src/render/world/TerrainRenderer';
import { TreeRenderer, ringRand } from '../../src/render/world/TreeRenderer';
import { CELL_SIZE } from '../../src/core/constants';
import { RNG } from '../../src/core/rng';

registerAllModels();

type Ring = {
  ring: (THREE.InstancedMesh | null)[];
  ringFar: (THREE.InstancedMesh | null)[];
  ringMicroR: (Float32Array | null)[];
  ringU: { uRingP: { value: THREE.Vector3 }; uRingQ: { value: THREE.Vector2 } };
  terrain: TerrainRenderer;
};

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const fract = (x: number) => x - Math.floor(x);
/** the conifer stretch of the far blocks (TreeRenderer RING_CON_*): their instance stands at foot + sy * B */
const CON_A = 0.9 / 0.37, CON_B = 1 - CON_A;

describe('outer ring next to the map edge', () => {
  const make = () => {
    const st = createCityState(defaultCityConfig({ size: 128, seed: 11, terrain: 'hills', climate: 'temperate', treeDensity: 0.6 }));
    const tr = new TreeRenderer(st, new TerrainRenderer(st, 1, false), { lodDistance: 850, density: 1, castShadows: false, maxVariants: 3 });
    return { st, tr, R: tr as unknown as Ring };
  };

  /** the shaders' view of the frame (uniforms) and their per-tree predicates */
  const shaders = (R: Ring, cam: THREE.Vector3) => {
    const P = R.ringU.uRingP.value, Q = R.ringU.uRingQ.value;
    const lod = P.x, fv = P.y, W = P.z, lowSw = Q.x;
    const edgeNear = (x: number, z: number) => {
      const ex = x < 0 ? cam.x : x > W ? W - cam.x : 1e9;
      const ez = z < 0 ? cam.z : z > W ? W - cam.z : 1e9;
      return 1 - sstep(lod * 0.6, lod * 0.94, Math.min(ex, ez));
    };
    /** switch distance of the tree at (x, z) (its random from its float32 position, as RING_RAND) */
    const sw = (x: number, z: number) => {
      const lw = (1 - fv) * edgeNear(x, z);
      return (lod + (lowSw - lod) * lw) * (0.94 + 0.12 * fract(ringRand(x, z) * 31.7));
    };
    /** far block keep fraction at distance d of the tree at (x, z) */
    const keep = (x: number, z: number, d: number) => Math.min(1, Math.max(0.3, 1.2 - (d - lod) / 5500)) * Math.max(fv, edgeNear(x, z));
    return { lod, fv, sw, keep, edgeNear };
  };

  const fr = new THREE.Frustum(), sp = new THREE.Sphere();
  /** the view's frustum test of a ring instance (o: its matrix offset; y0 / y1: its shape's bottom / top in units of its
   *  height) */
  const inView = (e: Float32Array, o: number, y0: number, y1: number) => {
    const h = e[o + 5], r = Math.hypot(e[o], e[o + 2]) * 0.5;
    sp.center.set(e[o + 12], e[o + 13] + h * (y0 + y1) / 2, e[o + 14]);
    sp.radius = Math.hypot(r, (h * (y1 - y0)) / 2) + 0.5;
    return fr.intersectsSphere(sp);
  };
  const pose = (R: Ring, cam: THREE.PerspectiveCamera, x: number, h: number, z: number, yaw: number, pitch: number) => {
    cam.position.set(x, R.terrain.meshHeightAt(x, z) + h, z);
    cam.lookAt(x + Math.cos(yaw) * 100, cam.position.y - Math.tan(pitch) * 100, z + Math.sin(yaw) * 100);
    cam.updateMatrixWorld();
    fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  };

  /** every ring tree the shaders draw at this frame and the view shows: [drawn by the near pairs, by the far blocks,
   *  left out by the CPU (must be 0), drawn by both (must be 0)] */
  const audit = (tr: TreeRenderer, R: Ring, cam: THREE.PerspectiveCamera) => {
    const S = shaders(R, cam.position);
    const near = new Map<string, number>();
    let nNear = 0, nFar = 0, cut = 0, both = 0;
    // (trees within half a metre of their switch distance: either program, float precision)
    const M = 0.5;
    for (const m of R.ring) {
      if (!m) continue;
      const n = (m.userData.ringCount as number) ?? 0, e = m.instanceMatrix.array as Float32Array;
      for (let i = 0; i < n; i++) {
        const o = i * 16, x = e[o + 12], y = e[o + 13], z = e[o + 14];
        const d = Math.hypot(x - cam.position.x, y - cam.position.y, z - cam.position.z);
        near.set(`${x},${z}`, d);
        if (d >= S.sw(x, z) - M || !inView(e, o, 0, 1.05)) continue;
        nNear++;
        if (!(m.visible && i < m.count)) cut++;
      }
    }
    for (let id = 0; id < R.ringFar.length; id++) {
      const m = R.ringFar[id], rnd = R.ringMicroR[id];
      if (!m || !rnd) continue;
      const n = (m.userData.ringCount as number) ?? 0, e = m.instanceMatrix.array as Float32Array, col = m.instanceColor!.array as Float32Array;
      for (let j = 0; j < n; j++) {
        const o = j * 16, x = e[o + 12], z = e[o + 14];
        // (a conifer's instance is shifted up by its stretch: its foot, as the shader's)
        const foot = e[o + 13] - (col[j * 3 + 2] < 0 ? (CON_B / CON_A) * e[o + 5] : 0);
        const d = Math.hypot(x - cam.position.x, foot - cam.position.y, z - cam.position.z);
        const dn = near.get(`${x},${z}`);
        // every far block tree is one of the near pairs' (same position, same foot)
        expect(dn).toBeDefined();
        expect(Math.abs(dn! - d)).toBeLessThan(0.05);
        const sw = S.sw(x, z);
        // (drawn by the far blocks: kept by their thinning, past the switch distance)
        if (ringRand(x, z) >= S.keep(x, z, d) - 1e-4 || d < sw + M) continue;
        if (dn! < sw - M) both++;
        // (a low camera's whole micro crown reaches down to RING_LOW_APEX)
        if (!inView(e, o, RING_LOW_APEX, 1)) continue;
        nFar++;
        if (!(m.visible && j < m.count)) cut++;
      }
    }
    return { nNear, nFar, cut, both };
  };

  it('no tree the shaders draw in view is left out, none is drawn twice, at any camera and low-camera switch distance', () => {
    const { st, tr, R } = make();
    const W = st.size * CELL_SIZE;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
    const rnd = new RNG(23);
    let near = 0, far = 0;
    for (const lowSwitch of [1, 2.5]) {
      tr.ringLowSwitch = lowSwitch;
      for (let q = 0; q < 36; q++) {
        // half of the poses next to an edge, low (the low-camera look), the rest anywhere, at any height
        const edge = q % 2 === 0;
        const x = edge ? rnd.range(-200, 900) : rnd.range(-1100, W + 1100);
        const z = edge ? rnd.range(0, W) : rnd.range(-1100, W + 1100);
        const h = edge ? [20, 60, 150, 230][q % 4] : [8, 60, 180, 400, 1200, 2500][q % 6];
        const yaw = edge ? Math.PI + rnd.range(-0.9, 0.9) : rnd.range(0, Math.PI * 2);
        const pitch = edge ? rnd.range(0.05, 0.5) : rnd.range(-0.2, 1.5);
        pose(R, cam, x, h, z, yaw, pitch);
        tr.update(cam);
        const a = audit(tr, R, cam);
        expect(a.cut, `switch ${lowSwitch} pose ${q}`).toBe(0);
        expect(a.both, `switch ${lowSwitch} pose ${q}`).toBe(0);
        near += a.nNear;
        far += a.nFar;
      }
    }
    expect(near).toBeGreaterThan(1000);
    expect(far).toBeGreaterThan(1000);
    tr.dispose();
  }, 180_000);

  it('a low camera next to the edge sees the ring past the switch distance (whole micro crowns); away from it, nothing new', () => {
    const { st, tr, R } = make();
    const W = st.size * CELL_SIZE;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
    // the art reviewer's tp/jun13_edge_low: ~58 m up, ~340 m inside the west edge, looking west, tilted 14 degrees down
    pose(R, cam, 340, 58, W / 2, Math.PI, Math.tan((14 * Math.PI) / 180));
    tr.update(cam);
    const a = audit(tr, R, cam);
    expect(a.cut).toBe(0);
    expect(a.nNear).toBeGreaterThan(10);
    // past the switch distance (r4: none - the forest stopped ~0.85 km from the camera)
    expect(a.nFar).toBeGreaterThan(300);
    const blocks = R.ringFar.filter((m) => m && m.visible && m.count > 0) as THREE.InstancedMesh[];
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((m) => m.geometry === getMicroImpostorGeometries().ringLow)).toBe(true);
    // ... from the middle of the map at the same height: no ring (the city and the edge band hide it)
    pose(R, cam, W / 2, 58, W / 2, Math.PI, Math.tan((14 * Math.PI) / 180));
    tr.update(cam);
    const b = audit(tr, R, cam);
    expect(b.nNear + b.nFar).toBe(0);
    expect(R.ringFar.some((m) => m && m.visible && m.count > 0)).toBe(false);
    // ... and from high above the edge: the far blocks' upper halves (the high cameras' shape) with the height fade on
    pose(R, cam, 340, 900, W / 2, Math.PI, 0.9);
    tr.update(cam);
    expect(audit(tr, R, cam).cut).toBe(0);
    const high = R.ringFar.filter((m) => m && m.visible && m.count > 0) as THREE.InstancedMesh[];
    expect(high.length).toBeGreaterThan(0);
    expect(high.every((m) => m.geometry === getMicroImpostorGeometries().top)).toBe(true);
    tr.dispose();
  }, 120_000);

  it('ringLow: the upper half (positions + normals) is exactly `top`, the lower half has its own down-facing normals', () => {
    const { top, ringLow } = getMicroImpostorGeometries();
    expect(top.index!.count).toBe(9);
    expect(ringLow.index!.count).toBe(18);
    const tp = top.getAttribute('position'), tn = top.getAttribute('normal');
    const lp = ringLow.getAttribute('position'), ln = ringLow.getAttribute('normal');
    expect(lp.count).toBe(tp.count + 4);
    for (let i = 0; i < tp.count; i++) {
      for (const k of [0, 1, 2]) {
        expect(lp.getComponent(i, k)).toBeCloseTo(tp.getComponent(i, k), 6);
        expect(ln.getComponent(i, k)).toBeCloseTo(tn.getComponent(i, k), 6);
      }
    }
    let apex = 0;
    for (let i = tp.count; i < lp.count; i++) {
      expect(ln.getY(i)).toBeLessThan(0);
      if (Math.abs(lp.getY(i) - RING_LOW_APEX) < 1e-6) apex++;
      else expect(lp.getY(i)).toBeCloseTo(0.63, 6);
    }
    expect(apex).toBe(1);
  });
});
