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
 *  - a near pair is culled by the bounds of the prefix it draws (the corner sectors beside a low camera at an edge reach
 *    it, but none of their trees is in view: they drew ~1250 trees, 106k vertices, for nothing),
 *  - a far block is culled by the bounds of its trees per cell (the quarters beside an edge view whose boxes meet the
 *    view, but none of whose trees do: ~2.9k of the 3.7k far block trees of the HIGH edge_t25 view),
 *  - the per-frame pass keeps its last result while nothing it depends on changed (a still view) and re-derives it when
 *    the camera moves or turns, the low-camera switch distance changes or the ring's data does,
 *  - the low cameras' mini crown (ringLow), folded as the ring shader folds it at low-camera weight 0, is exactly the high
 *    cameras' upper half (`top`), and unfolded a round crown on a trunk,
 *  - far views draw the far ring as one mesh (every block's trees in one order by their random) instead of their ~18
 *    visible blocks, holding every tree those blocks would draw; views that see a few blocks keep the blocks; a runtime
 *    refill rebuilds that mesh in bounded units (the blocks stand in meanwhile), equal to a fresh build,
 *  - the per-frame prefix searches that start from the last frame's answer give a binary search's answer.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { MICRO_WAIST_R, MICRO_WAIST_Y, RING_LOW_APEX, RING_LOW_R, getMicroImpostorGeometries, ringLowNormal } from '../../src/render/world/fallbackTrees';
import { Surf } from '../../src/core/types';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { TerrainRenderer } from '../../src/render/world/TerrainRenderer';
import { TreeRenderer, prefixFrom, ringRand } from '../../src/render/world/TreeRenderer';
import { CELL_SIZE } from '../../src/core/constants';
import { RNG } from '../../src/core/rng';

registerAllModels();

type Ring = {
  ring: (THREE.InstancedMesh | null)[];
  ringFar: (THREE.InstancedMesh | null)[];
  ringAll: THREE.InstancedMesh | null;
  ringMicroR: (Float32Array | null)[];
  ringU: { uRingP: { value: THREE.Vector3 }; uRingQ: { value: THREE.Vector2 } };
  terrain: TerrainRenderer;
};

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const fract = (x: number) => x - Math.floor(x);
/** a ring mesh's own visibility / count: a mesh drawn once by the load's preload (TreeRenderer.warmDraw: one instance,
 *  for its instance data's upload) is back to these right after that draw */
type Warm = THREE.InstancedMesh & { warmOnce?: boolean; warmVis?: boolean; warmCount?: number };
const vis = (m: THREE.InstancedMesh) => ((m as Warm).warmOnce ? !!(m as Warm).warmVis : m.visible);
const cnt = (m: THREE.InstancedMesh) => ((m as Warm).warmOnce ? (m as Warm).warmCount ?? 0 : m.count);
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

  /** every ring tree the shaders draw at this frame and the view shows: [drawn by the near pairs, by the far blocks (or
   *  the all-in-one mesh standing for them), left out by the CPU (must be 0), drawn by both (must be 0)] */
  const audit = (tr: TreeRenderer, R: Ring, cam: THREE.PerspectiveCamera) => {
    const S = shaders(R, cam.position);
    const near = new Map<string, number>();
    let nNear = 0, nFar = 0, cut = 0, both = 0;
    // (the all-in-one mesh's submitted trees, by position)
    const allSub = new Set<string>();
    const A = R.ringAll;
    if (A && vis(A)) {
      const e = A.instanceMatrix.array as Float32Array;
      for (let i = 0; i < cnt(A); i++) allSub.add(`${e[i * 16 + 12]},${e[i * 16 + 14]}`);
    }
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
        if (!(vis(m) && i < cnt(m))) cut++;
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
        // (a low camera's mini crown stands on its trunk, from the tree's foot)
        if (!inView(e, o, 0, 1)) continue;
        nFar++;
        if (!(vis(m) && j < cnt(m)) && !allSub.has(`${x},${z}`)) cut++;
        // (the all-in-one mesh stands for the blocks: never both)
        if (vis(m) && allSub.size) both++;
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
  }, 600_000);

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
    const blocks = R.ringFar.filter((m) => m && vis(m) && cnt(m) > 0) as THREE.InstancedMesh[];
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((m) => m.geometry === getMicroImpostorGeometries().ringLow)).toBe(true);
    // ... from the middle of the map at the same height: no ring (the city and the edge band hide it)
    pose(R, cam, W / 2, 58, W / 2, Math.PI, Math.tan((14 * Math.PI) / 180));
    tr.update(cam);
    const b = audit(tr, R, cam);
    expect(b.nNear + b.nFar).toBe(0);
    expect(R.ringFar.some((m) => m && vis(m) && cnt(m) > 0)).toBe(false);
    // ... and from high above the edge: the far blocks' upper halves (the high cameras' shape) with the height fade on
    // (or the all-in-one mesh standing for them, in the same shape)
    pose(R, cam, 340, 900, W / 2, Math.PI, 0.9);
    tr.update(cam);
    expect(audit(tr, R, cam).cut).toBe(0);
    const high = [...R.ringFar, R.ringAll].filter((m) => m && vis(m) && cnt(m) > 0) as THREE.InstancedMesh[];
    expect(high.length).toBeGreaterThan(0);
    expect(high.every((m) => m.geometry === getMicroImpostorGeometries().top)).toBe(true);
    tr.dispose();
  }, 300_000);

  it('a near pair is culled by the bounds of the prefix it draws: the corner sectors beside a low camera at an edge draw nothing', () => {
    const { st, tr, R } = make();
    const W = st.size * CELL_SIZE;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
    // the art reviewer's edge_low again: at a low-camera switch distance of 1.6 x lodDistance the west edge's corner
    // sectors (0: x < 0, z < 0; 6: x < 0, z > W) are within reach (~1.1 km away), ~70 degrees off the view's axis
    tr.ringLowSwitch = 1.6;
    pose(R, cam, 340, 58, W / 2, Math.PI, Math.tan((14 * Math.PI) / 180));
    tr.update(cam);
    tr.update(cam);
    expect(audit(tr, R, cam).cut).toBe(0);
    for (const k of [0, 6]) for (const m of [R.ring[k * 2], R.ring[k * 2 + 1]]) {
      if (!m || !m.userData.ringCount) continue;
      expect(m.count).toBeGreaterThan(0);
      expect(m.visible).toBe(false);
    }
    // every near mesh drawn: its bounds (three's frustum test) hold every vertex of every tree of the prefix it draws
    let drawn = 0, out = 0;
    const p = new THREE.Vector3(), M = new THREE.Matrix4();
    for (const m of R.ring) {
      if (!m || !m.visible || !m.count) continue;
      drawn++;
      const e = m.instanceMatrix.array as Float32Array, b = m.boundingBox!.clone().expandByScalar(1e-3), pa = m.geometry.getAttribute('position');
      for (let i = 0; i < m.count; i++) {
        M.fromArray(e, i * 16);
        for (let j = 0; j < pa.count; j++) if (!b.containsPoint(p.fromBufferAttribute(pa, j).applyMatrix4(M))) out++;
      }
      const S = m.boundingSphere!, bb = m.boundingBox!;
      expect(Math.max(S.center.distanceTo(bb.min), S.center.distanceTo(bb.max))).toBeLessThanOrEqual(S.radius + 1e-6);
    }
    expect(out).toBe(0);
    expect(drawn).toBeGreaterThan(0);
    // ... and seen from beyond the corner, looking back at the map, the corner sector draws again
    pose(R, cam, -300, 60, -300, Math.PI / 4, 0.1);
    tr.update(cam);
    expect(audit(tr, R, cam).cut).toBe(0);
    expect([R.ring[0], R.ring[1]].some((m) => m && m.visible && m.count > 0)).toBe(true);
    tr.dispose();
  }, 300_000);

  it('a far block is culled by the bounds of its trees per cell: the quarters beside an edge view whose boxes meet it, but none of whose trees do, draw nothing', () => {
    const { st, tr, R } = make();
    const W = st.size * CELL_SIZE;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
    const RB = tr as unknown as { ringMicroBox: Float64Array };
    const { top } = getMicroImpostorGeometries();
    const box = new THREE.Box3(), hr = Math.max(0.5, RING_LOW_R);
    let culled = 0;
    // the bench's edge_t25 (400 m from a target ~100 m inside the west edge, 25 degrees down, looking west) and views
    // along the edge from beside it
    const t = (25 * Math.PI) / 180;
    for (const [x, h, z, yaw, pitch] of [[104 + 400 * Math.cos(t), 400 * Math.sin(t), W / 2, Math.PI, Math.tan(t)], [300, 120, W / 2, Math.PI * 0.75, 0.3], [300, 120, W / 2, Math.PI * 1.25, 0.3], [250, 60, 400, Math.PI * 1.1, 0.15]]) {
      // (counts cleared first: a block the pass leaves hidden before its view test - out of reach, faded out - keeps none)
      for (const m of R.ringFar) if (m) m.count = 0;
      pose(R, cam, x, h, z, yaw, pitch);
      tr.update(cam);
      tr.update(cam);
      expect(audit(tr, R, cam).cut).toBe(0);
      for (let id = 0; id < R.ringFar.length; id++) {
        const m = R.ringFar[id];
        // (a block left with a prefix to draw but hidden: by the view's test)
        if (!m || m.visible || !m.count) continue;
        const e = m.instanceMatrix.array as Float32Array, n = m.userData.ringCount as number, isTop = m.geometry === top;
        // (each tree's shape: its foot +- RING_BOX_R x its xz scale, from its foot - ringLow - or the micro waist - top - up)
        const treeBox = (j: number) => {
          const o = j * 16, hs = Math.hypot(e[o], e[o + 2]) * hr, y = e[o + 13], vs = e[o + 5];
          box.min.set(e[o + 12] - hs, y + (isTop ? vs * MICRO_WAIST_Y : 0), e[o + 14] - hs);
          box.max.set(e[o + 12] + hs, y + vs, e[o + 14] + hs);
          return box;
        };
        let y0 = Infinity;
        for (let j = 0; j < n; j++) y0 = Math.min(y0, treeBox(j).min.y);
        const B = RB.ringMicroBox, o = id * 6;
        box.min.set(B[o], y0, B[o + 2]);
        box.max.set(B[o + 3], B[o + 4], B[o + 5]);
        if (!fr.intersectsBox(box)) continue;
        // its box meets the view: none of its trees does
        culled++;
        for (let j = 0; j < n; j++) expect(fr.intersectsBox(treeBox(j))).toBe(false);
      }
    }
    expect(culled).toBeGreaterThan(0);
    tr.dispose();
  }, 300_000);

  it("the per-frame pass: a still view re-derives nothing; a moved or turned camera, a new switch distance and new ring data do", () => {
    const { st, tr, R } = make();
    const W = st.size * CELL_SIZE;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
    const T = tr as unknown as { ringViewDirs: (...a: unknown[]) => number };
    const dirs = T.ringViewDirs;
    let passes = 0;
    T.ringViewDirs = function (this: unknown, ...a: unknown[]) {
      passes++;
      return dirs.apply(this, a);
    };
    const ls0 = tr.ringLowSwitch, tilt = Math.tan((14 * Math.PI) / 180);
    const state = () => [...R.ring, ...R.ringFar].map((m) => (m ? `${m.visible ? 1 : 0}:${m.count}:${m.geometry.id}` : '-')).join(' ');
    const at = (x: number, yaw: number) => {
      pose(R, cam, x, 58, W / 2, yaw, tilt);
      tr.update(cam);
    };
    // (the load's flush: its preload pass, whose one-instance warm draws the next update puts back)
    at(340, Math.PI);
    at(340, Math.PI);
    const n0 = passes, s0 = state();
    for (let i = 0; i < 5; i++) tr.update(cam);
    expect(passes).toBe(n0);
    expect(state()).toBe(s0);
    tr.ringLowSwitch = ls0 + 0.3;
    tr.update(cam);
    expect(passes).toBe(n0 + 1);
    expect(audit(tr, R, cam).cut).toBe(0);
    tr.update(cam);
    expect(passes).toBe(n0 + 1);
    tr.ringLowSwitch = ls0;
    tr.update(cam);
    expect(passes).toBe(n0 + 2);
    at(340, Math.PI + 0.4);
    expect(passes).toBe(n0 + 3);
    expect(audit(tr, R, cam).cut).toBe(0);
    at(420, Math.PI + 0.4);
    expect(passes).toBe(n0 + 4);
    expect(audit(tr, R, cam).cut).toBe(0);
    // back where it was: the same result as there
    at(340, Math.PI);
    expect(state()).toBe(s0);
    // new ring data (January's refill): the next frame re-derives it from the new data
    tr.setMonth(0);
    tr.flush();
    const n1 = passes;
    tr.update(cam);
    expect(passes).toBe(n1 + 1);
    expect(audit(tr, R, cam).cut).toBe(0);
    tr.dispose();
  }, 300_000);

  it('ringLow: folded as the shader folds it at lw = 0 it is exactly `top` (+ a flat down-facing fan; `top` itself stays), unfolded a round crown on a trunk', () => {
    const { top, ringLow } = getMicroImpostorGeometries();
    const tp = top.getAttribute('position'), tn = top.getAttribute('normal'), ti = top.index!;
    const lp = ringLow.getAttribute('position'), ln = ringLow.getAttribute('normal'), ls = ringLow.getAttribute('surf'), li = ringLow.index!;
    expect(ti.count).toBe(9);
    expect(li.count).toBe(45);
    expect(lp.count).toBe(12);
    // the ring shader's fold (RING_LOW_VERT) at lw (normals: the geometry's blended into the round crown's)
    const fold = (p: THREE.Vector3, trunk: boolean) => {
      if (trunk) return new THREE.Vector3(0, MICRO_WAIST_Y, 0);
      if (p.y > 0.999) return p.clone();
      const r = Math.max(Math.hypot(p.x, p.z), 1e-4);
      return new THREE.Vector3((p.x * MICRO_WAIST_R) / r, MICRO_WAIST_Y, (p.z * MICRO_WAIST_R) / r);
    };
    // (`top` itself, which the far blocks draw for high cameras and for the sectors away from the edge with the same
    // program, is left as it is by the fold)
    for (let i = 0; i < tp.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(tp, i);
      expect(fold(p, false).distanceTo(p)).toBeLessThan(1e-6);
    }
    // (the unfolded rings are at RING_LOW_R)
    for (let i = 0; i < lp.count; i++) if (Math.abs(ls.getX(i) - Surf.Wood) >= 0.5 && lp.getY(i) > RING_LOW_APEX + 1e-3 && lp.getY(i) < 0.999) expect(Math.hypot(lp.getX(i), lp.getZ(i))).toBeCloseTo(RING_LOW_R, 6);
    const pos = (i: number, lw: number) => {
      const p = new THREE.Vector3().fromBufferAttribute(lp, i);
      const trunk = Math.abs(ls.getX(i) - Surf.Wood) < 0.5;
      return fold(p, trunk).lerp(p, lw);
    };
    const nrm = (i: number, lw: number) => {
      const n = new THREE.Vector3().fromBufferAttribute(ln, i);
      if (Math.abs(ls.getX(i) - Surf.Wood) < 0.5) return n;
      return n.lerp(new THREE.Vector3(...ringLowNormal(lp.getX(i), lp.getY(i), lp.getZ(i))), lw).normalize();
    };
    const key = (v: THREE.Vector3) => [v.x, v.y, v.z].map((c) => c.toFixed(4)).join(',');
    const topTris = new Set<string>(), topN = new Map<string, THREE.Vector3>();
    for (let t = 0; t < 3; t++) {
      const vs = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(tp, ti.getX(t * 3 + k)));
      topTris.add(vs.map(key).sort().join('|'));
      for (let k = 0; k < 3; k++) topN.set(key(vs[k]), new THREE.Vector3().fromBufferAttribute(tn, ti.getX(t * 3 + k)));
    }
    // lw = 0: the upper fan is `top` (corners and normals), the lower fan lies flat at the waist facing down, the band and
    // the trunk have no area
    let up = 0, flat = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let t = 0; t < 15; t++) {
      const ids = [0, 1, 2].map((k) => li.getX(t * 3 + k));
      a.copy(pos(ids[0], 0)); b.copy(pos(ids[1], 0)); c.copy(pos(ids[2], 0));
      n.copy(b).sub(a).cross(c.clone().sub(a));
      if (n.length() < 1e-6) continue;
      if (n.y > 0) {
        up++;
        expect(topTris.has([a, b, c].map(key).sort().join('|'))).toBe(true);
        for (const i of ids) expect(nrm(i, 0).distanceTo(topN.get(key(pos(i, 0)))!)).toBeLessThan(1e-5);
      } else {
        flat++;
        for (const v of [a, b, c]) expect(v.y).toBeCloseTo(MICRO_WAIST_Y, 6);
      }
    }
    expect(up).toBe(3);
    expect(flat).toBe(3);
    // lw = 1: a crown from RING_LOW_APEX to 1 on a trunk from the foot, its faces and normals pointing outwards
    let yMin = Infinity, cMin = Infinity, trunkV = 0;
    for (let i = 0; i < lp.count; i++) {
      const p = pos(i, 1);
      yMin = Math.min(yMin, p.y);
      if (Math.abs(ls.getX(i) - Surf.Wood) < 0.5) { trunkV++; continue; }
      cMin = Math.min(cMin, p.y);
      const r = nrm(i, 1), out = p.clone().sub(new THREE.Vector3(0, (1 + RING_LOW_APEX) / 2, 0));
      expect(r.dot(out)).toBeGreaterThan(0);
    }
    expect(yMin).toBeCloseTo(0, 6);
    expect(cMin).toBeCloseTo(RING_LOW_APEX, 6);
    expect(trunkV).toBe(4);
    for (let t = 0; t < 15; t++) {
      const ids = [0, 1, 2].map((k) => li.getX(t * 3 + k));
      a.copy(pos(ids[0], 1)); b.copy(pos(ids[1], 1)); c.copy(pos(ids[2], 1));
      n.copy(b).sub(a).cross(c.clone().sub(a));
      const m = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      const trunk = Math.abs(ls.getX(ids[0]) - Surf.Wood) < 0.5;
      const ctr = trunk ? new THREE.Vector3(0, m.y, 0) : new THREE.Vector3(0, (1 + RING_LOW_APEX) / 2, 0);
      expect(n.dot(m.sub(ctr))).toBeGreaterThan(0);
    }
  });
  it('prefix searches from a hint (the last frame\'s answer) give the binary search\'s answer', () => {
    const rnd = new RNG(5);
    for (let t = 0; t < 400; t++) {
      const n = Math.floor(rnd.range(0, 70));
      const a = new Float32Array(n);
      // (sorted, with runs of equal values)
      for (let i = 0; i < n; i++) a[i] = Math.floor(rnd.range(0, 30)) / 30;
      a.sort();
      for (let q = 0; q < 20; q++) {
        const v = Math.floor(rnd.range(-2, 33)) / 30, hint = Math.floor(rnd.range(-3, n + 4)), atMost = q % 2 === 0;
        let lo = 0, hi = n;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (atMost ? a[mid] <= v : a[mid] < v) lo = mid + 1; else hi = mid; }
        expect(prefixFrom(a, n, v, atMost, hint)).toBe(lo);
      }
    }
  });

  it('far views draw the far ring as one mesh, holding every tree its visible blocks would; a runtime refill rebuilds it in bounded units', () => {
    const { st, tr, R } = make();
    const W = st.size * CELL_SIZE;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
    const T = tr as unknown as { ringAllAt: number; ringAllN: number; ringPending(): boolean; ringStep(b: number): void };
    /** the bench's camera: target (x, z) on the ground, distance, tilt, yaw (CameraController) */
    const view = (x: number, z: number, d: number, tilt: number, yaw: number) => {
      const t = (tilt * Math.PI) / 180, yw = (yaw * Math.PI) / 180, gy = R.terrain.meshHeightAt(x, z);
      cam.position.set(x - Math.sin(yw) * Math.cos(t) * d, gy + Math.sin(t) * d, z + Math.cos(yw) * Math.cos(t) * d);
      cam.lookAt(x, gy, z);
      cam.updateMatrixWorld();
      fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      tr.update(cam);
      tr.update(cam);
    };
    const blocksDrawn = () => R.ringFar.filter((m) => m && vis(m) && cnt(m) > 0).length;
    const A = () => R.ringAll!;
    // the far orbit (4 km, 75 degrees down, a quarter turn): one draw for the far ring, nothing left out, nothing twice
    let far = 0;
    for (let i = 0; i < 12; i++) {
      view(W / 2, W / 2, 4000, 75, 45 + i * 7.5);
      const a = audit(tr, R, cam);
      expect(a.cut, `orbit ${i}`).toBe(0);
      expect(a.both, `orbit ${i}`).toBe(0);
      expect(a.nFar).toBeGreaterThan(500);
      expect(vis(A())).toBe(true);
      expect(blocksDrawn()).toBe(0);
      far += a.nFar;
    }
    expect(far).toBeGreaterThan(6000);
    // default zoom, a zoom's middle and edge views at 220-380 m: a few blocks each, drawn as blocks
    for (const [x, z, d, tilt, yaw] of [[W / 2, W / 2, 800, 50, 135], [W / 2, W / 2, 500, 37, 45], [W - 100, W / 2, 583, 31, 90], [W - 100, W / 2, 628, 37.2, 90], [W - 100, W / 2, 546, 23.7, 90]]) {
      view(x, z, d, tilt, yaw);
      expect(audit(tr, R, cam).cut).toBe(0);
      expect(vis(A())).toBe(false);
    }
    // a runtime refill (half a year on): the blocks stand in while the one mesh is rebuilt, in units of ringAllUnit trees
    // (here 600), each drawn once (one instance: its range uploads on that frame); then it holds the same instances as a
    // fresh build's
    const n0 = A().userData.ringCount as number;
    expect(n0).toBe(tr.ringInstances);
    expect(n0).toBeGreaterThan(1800);
    tr.ringBudgetMs = 0;
    tr.ringAllUnit = 600;
    const day = ((st.month + 6) % 12) * 30 + 12;
    st.day = day;
    tr.setMonth(st.month);
    const Tf = tr as unknown as { ringFarDirty: number; ringRefill: number; ringFillState: unknown };
    while (Tf.ringRefill || Tf.ringFillState || Tf.ringFarDirty) T.ringStep(0);
    expect(T.ringAllAt).toBe(0);
    // (one frame of a far orbit that keeps moving: its updates run no ring step of their own)
    let f = 0;
    const orbitFrame = () => {
      const t = (75 * Math.PI) / 180, yw = ((45 + 0.5 * f++) * Math.PI) / 180, gy = R.terrain.meshHeightAt(W / 2, W / 2);
      cam.position.set(W / 2 - Math.sin(yw) * Math.cos(t) * 4000, gy + Math.sin(t) * 4000, W / 2 + Math.cos(yw) * Math.cos(t) * 4000);
      cam.lookAt(W / 2, gy, W / 2);
      cam.updateMatrixWorld();
      fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      tr.update(cam);
    };
    orbitFrame();
    let units = 0;
    while (T.ringAllAt >= 0) {
      const at = T.ringAllAt;
      T.ringStep(0);
      units++;
      if (T.ringAllAt >= 0) expect(T.ringAllAt - at).toBe(600);
      orbitFrame();
      // (the unit's range: drawn by this frame once, one instance - back to its own state, hidden, right after; once
      // complete the far view draws it for real)
      const a = A() as Warm;
      if (T.ringAllAt >= 0) expect(a.warmOnce && a.visible && a.count === 1 && !a.warmVis).toBe(true);
      else expect(!a.warmOnce && a.visible && a.count > 1).toBe(true);
      // (until it is complete the far view draws the blocks)
      if (T.ringAllAt >= 0) {
        expect(blocksDrawn()).toBeGreaterThan(8);
        expect(audit(tr, R, cam).cut).toBe(0);
      }
      orbitFrame();
      expect(a.warmOnce).toBe(false);
    }
    expect(units).toBe(Math.ceil(n0 / 600));
    view(W / 2, W / 2, 4000, 75, 45);
    expect(vis(A())).toBe(true);
    expect(audit(tr, R, cam).cut).toBe(0);
    const data = (t: TreeRenderer) => {
      const m = (t as unknown as Ring).ringAll!, e = m.instanceMatrix.array as Float32Array, c = m.instanceColor!.array as Float32Array, out: string[] = [];
      for (let i = 0; i < (m.userData.ringCount as number); i++) out.push([...e.subarray(i * 16, i * 16 + 16), ...c.subarray(i * 3, i * 3 + 3)].join(','));
      return out;
    };
    const fresh = make();
    fresh.st.day = day;
    fresh.tr.setMonth(fresh.st.month);
    fresh.tr.flush();
    expect(data(tr)).toEqual(data(fresh.tr));
    fresh.tr.dispose();
    tr.dispose();
  }, 600_000);
});
