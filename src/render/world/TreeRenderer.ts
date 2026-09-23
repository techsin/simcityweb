/**
 * TreeRenderer — instanced trees scattered from state.trees (density 0..4 per cell).
 *
 * Layout: the map is split into 32 x 32-cell chunks. Each chunk owns
 *   - near LOD: one InstancedMesh per (species, variant) actually used in the chunk (full models, cast shadows)
 *   - far LOD:  two InstancedMeshes (broadleaf blob / conifer cone impostors, ~20 tris) tinted per instance with
 *               the species' average foliage color; instance order is shuffled so lowering `count` thins the
 *               forest uniformly with distance (density fade).
 * Chunks switch LOD by distance (with hysteresis). Placement is deterministic per cell (hash of cell + seed), so
 * rebuilding a chunk after an edit never moves unaffected trees. Cells with network / buildings / zones / power
 * lines / water get no trees.
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../core/constants';
import { Noise2D, hash2 } from '../../core/rng';
import type { CellRect } from '../../core/events';
import type { Climate } from '../../core/types';
import { MANIFEST_BY_ID } from '../../assets/manifest';
import { getBuildingMaterial, patchSurfaceMaterial } from '../../assets/materials';
import type { CityState } from '../../sim/CityState';
import { getImpostorGeometries, getNatureGeometry, natureStats } from './fallbackTrees';
import { TerrainRenderer } from './TerrainRenderer';

const CHUNK = 32;
/** instances per cell for density 0..4 */
const DENSITY_COUNT = [0, 1.1, 2.3, 3.8, 5.6];

interface SpeciesDef {
  id: string;
  w: number;
  conifer?: boolean;
  /** preferred elevation band (m): weight fades outside */
  minH?: number;
  maxH?: number;
  /** bonus close to sea level (palms) */
  coastal?: boolean;
  /** bonus on steep slopes (rocks) */
  slope?: boolean;
  scale?: [number, number];
}

const CLIMATE_SPECIES: Record<Climate, SpeciesDef[]> = {
  temperate: [
    { id: 'tree_oak', w: 0.3, maxH: 120 },
    { id: 'tree_maple', w: 0.22, maxH: 110 },
    { id: 'tree_birch', w: 0.14 },
    { id: 'tree_pine', w: 0.14, conifer: true, minH: 25 },
    { id: 'tree_spruce', w: 0.1, conifer: true, minH: 60 },
    { id: 'bush', w: 0.08, scale: [0.8, 1.4] },
    { id: 'rock', w: 0.02, slope: true, scale: [0.7, 1.6] },
  ],
  desert: [
    { id: 'tree_cactus', w: 0.45, scale: [0.8, 1.3] },
    { id: 'bush', w: 0.35, scale: [0.6, 1.1] },
    { id: 'rock', w: 0.15, slope: true, scale: [0.8, 2.0] },
    { id: 'tree_palm', w: 0.05, coastal: true },
  ],
  tropical: [
    { id: 'tree_palm', w: 0.42, coastal: true, maxH: 40 },
    { id: 'tree_oak', w: 0.26 },
    { id: 'bush', w: 0.18, scale: [0.9, 1.6] },
    { id: 'tree_cypress', w: 0.06, conifer: true },
    { id: 'tree_maple', w: 0.08 },
  ],
  alpine: [
    { id: 'tree_spruce', w: 0.45, conifer: true },
    { id: 'tree_pine', w: 0.3, conifer: true },
    { id: 'tree_birch', w: 0.12, maxH: 90 },
    { id: 'rock', w: 0.08, slope: true, scale: [0.8, 1.8] },
    { id: 'bush', w: 0.05 },
  ],
};

interface Kind {
  species: number;
  id: string;
  variant: number;
  geo: THREE.BufferGeometry;
  conifer: boolean;
  color: THREE.Color;
  height: number;
  radius: number;
}

interface TreeChunk {
  cx: number;
  cz: number;
  near: (THREE.InstancedMesh | null)[];
  far: (THREE.InstancedMesh | null)[];
  farTotal: [number, number];
  box: THREE.Box3;
  sphere: THREE.Sphere;
  isNear: boolean;
  total: number;
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

export class TreeRenderer {
  readonly group = new THREE.Group();
  private state: CityState;
  private terrain: TerrainRenderer;
  private kinds: Kind[] = [];
  private kindsBySpecies: number[][] = [];
  private autumnKinds: number[][] = [];
  private autumn = 0;
  private maxVariants = 3;
  private species: SpeciesDef[];
  private chunks: TreeChunk[] = [];
  private perSide: number;
  private dirty = new Set<number>();
  private noise: Noise2D;
  private seed: number;
  private material: THREE.MeshStandardMaterial;
  private lodDistance = 1300;
  private density = 1;
  private castShadows = true;
  // scratch buffers
  private scratch: Float32Array[] = [];
  private scratchCount: number[] = [];
  private farScratch: Float32Array[] = [new Float32Array(16 * 4096), new Float32Array(16 * 4096)];
  private farColor: Float32Array[] = [new Float32Array(3 * 4096), new Float32Array(3 * 4096)];
  private farCount = [0, 0];
  /** total instances currently placed (stats) */
  totalInstances = 0;

  constructor(state: CityState, terrain: TerrainRenderer, opts: { lodDistance: number; density: number; castShadows: boolean; maxVariants?: number }) {
    this.state = state;
    this.terrain = terrain;
    this.lodDistance = opts.lodDistance;
    this.density = opts.density;
    this.castShadows = opts.castShadows;
    this.seed = state.config.seed | 0;
    this.noise = new Noise2D(state.config.seed + 4242);
    this.maxVariants = opts.maxVariants ?? 3;
    // clone of the shared uber material that casts shadows from both faces (thin palm fronds / leaf quads)
    this.material = patchSurfaceMaterial(getBuildingMaterial().clone(), 'building-uber-v1');
    this.material.shadowSide = THREE.DoubleSide;
    this.group.name = 'trees';
    this.species = CLIMATE_SPECIES[state.config.climate] ?? CLIMATE_SPECIES.temperate;
    this.buildKinds();
    this.perSide = Math.ceil(state.size / CHUNK);
    for (let cz = 0; cz < this.perSide; cz++)
      for (let cx = 0; cx < this.perSide; cx++) {
        const x0 = cx * CHUNK * CELL_SIZE, z0 = cz * CHUNK * CELL_SIZE;
        const box = new THREE.Box3(new THREE.Vector3(x0, -10, z0), new THREE.Vector3(x0 + CHUNK * CELL_SIZE, 60, z0 + CHUNK * CELL_SIZE));
        this.chunks.push({ cx, cz, near: this.kinds.map(() => null), far: [null, null], farTotal: [0, 0], box, sphere: new THREE.Sphere(), isNear: false, total: 0 });
      }
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.setMonth(state.month);
  }

  private buildKinds() {
    this.kinds = [];
    this.kindsBySpecies = [];
    this.autumnKinds = [];
    this.species.forEach((sp, si) => {
      const nv = Math.min(4, MANIFEST_BY_ID[sp.id]?.variants ?? 1);
      const list: number[] = [];
      const autumn: number[] = [];
      for (let v = 0; v < nv; v++) {
        const geo = getNatureGeometry(sp.id, v);
        const st = natureStats(geo);
        // autumn-colored variants (foliage more red than green) are only used in autumn
        const isAutumn = st.color.r > st.color.g * 0.95 && sp.id !== 'rock' && sp.id !== 'tree_cactus';
        if (isAutumn ? autumn.length >= 1 : list.length >= this.maxVariants) continue;
        (isAutumn ? autumn : list).push(this.kinds.length);
        this.kinds.push({ species: si, id: sp.id, variant: v, geo, conifer: !!sp.conifer, color: st.color, height: st.height, radius: st.radius });
      }
      if (!list.length && autumn.length) list.push(autumn[0]);
      this.kindsBySpecies.push(list);
      this.autumnKinds.push(autumn);
    });
    this.scratch = this.kinds.map(() => new Float32Array(16 * 1024));
    this.scratchCount = this.kinds.map(() => 0);
  }

  setQuality(opts: { lodDistance: number; density: number; castShadows: boolean; maxVariants?: number }) {
    if (opts.maxVariants !== undefined && opts.maxVariants !== this.maxVariants) {
      this.maxVariants = opts.maxVariants;
      for (const c of this.chunks) this.disposeChunk(c);
      this.buildKinds();
      for (const c of this.chunks) {
        c.near = this.kinds.map(() => null);
        c.far = [null, null];
        c.total = 0;
      }
      this.totalInstances = 0;
      this.markAll();
    }
    const densityChanged = opts.density !== this.density;
    this.lodDistance = opts.lodDistance;
    this.density = opts.density;
    this.castShadows = opts.castShadows;
    for (const c of this.chunks) for (const m of c.near) if (m) m.castShadow = opts.castShadows;
    if (densityChanged) this.markAll();
  }

  markAll() {
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
  }

  /** cells changed (trees / network / zones / buildings) */
  onCellsChanged(r: CellRect) {
    const x0 = Math.max(0, r.x0), z0 = Math.max(0, r.z0);
    const x1 = Math.min(this.state.size - 1, r.x1), z1 = Math.min(this.state.size - 1, r.z1);
    for (let cz = Math.floor(z0 / CHUNK); cz <= Math.floor(z1 / CHUNK); cz++)
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++)
        if (cx >= 0 && cz >= 0 && cx < this.perSide && cz < this.perSide) this.dirty.add(cz * this.perSide + cx);
  }

  reset(state: CityState) {
    this.state = state;
    this.seed = state.config.seed | 0;
    this.noise = new Noise2D(state.config.seed + 4242);
    const sp = CLIMATE_SPECIES[state.config.climate] ?? CLIMATE_SPECIES.temperate;
    if (sp !== this.species) {
      this.species = sp;
      for (const c of this.chunks) this.disposeChunk(c);
      this.buildKinds();
      for (const c of this.chunks) {
        c.near = this.kinds.map(() => null);
        c.far = [null, null];
      }
    }
    this.markAll();
  }

  private pickKind(x: number, z: number, h: number, slope: number, r: number, weights: number[]): number {
    let total = 0;
    const sp = this.species;
    for (let s = 0; s < sp.length; s++) {
      const d = sp[s];
      // species patches (clustering)
      const n = this.noise.noise(x / 22 + s * 31.7, z / 22 - s * 17.3) * 0.5 + 0.5;
      let w = d.w * (0.25 + 1.6 * n * n);
      if (d.minH !== undefined) w *= h < d.minH ? Math.max(0.08, h / d.minH) : 1 + Math.min(1.5, (h - d.minH) / 60);
      if (d.maxH !== undefined && h > d.maxH) w *= Math.max(0.05, 1 - (h - d.maxH) / 50);
      if (d.coastal) w *= h < 8 ? 2.5 : h < 20 ? 1 : 0.3;
      if (d.slope) w *= slope > 4 ? 3 : 0.4;
      weights[s] = w;
      total += w;
    }
    let t = r * total;
    let s = 0;
    for (; s < sp.length - 1; s++) {
      t -= weights[s];
      if (t <= 0) break;
    }
    const au = this.autumnKinds[s];
    if (au.length && this.autumn > 0 && hash2(x * 3 - 7, z * 5 + 2, this.seed + 97) < this.autumn) return au[0];
    const list = this.kindsBySpecies[s];
    return list[Math.floor(hash2(x * 7 + 3, z * 13 + 1, this.seed + 91) * list.length) % list.length];
  }

  /** season: month 0..11 -> fraction of deciduous trees showing autumn colors */
  setMonth(month: number) {
    const a = month === 8 ? 0.25 : month === 9 ? 0.65 : month === 10 ? 0.45 : 0;
    if (a !== this.autumn) {
      this.autumn = a;
      this.markAll();
    }
  }

  private ensureScratch(k: number, n: number) {
    if (this.scratch[k].length < n * 16) {
      const a = new Float32Array(Math.ceil(n * 1.5) * 16);
      a.set(this.scratch[k]);
      this.scratch[k] = a;
    }
  }
  private ensureFar(c: number, n: number) {
    if (this.farScratch[c].length < n * 16) {
      const a = new Float32Array(Math.ceil(n * 1.5) * 16);
      a.set(this.farScratch[c]);
      this.farScratch[c] = a;
      const b = new Float32Array(Math.ceil(n * 1.5) * 3);
      b.set(this.farColor[c]);
      this.farColor[c] = b;
    }
  }

  private buildChunk(ci: number) {
    const ch = this.chunks[ci];
    const st = this.state, N = st.size;
    const nk = this.kinds.length;
    for (let k = 0; k < nk; k++) this.scratchCount[k] = 0;
    this.farCount[0] = this.farCount[1] = 0;
    const weights = new Array(this.species.length).fill(0);
    let minY = Infinity, maxY = -Infinity;
    const x0 = ch.cx * CHUNK, z0 = ch.cz * CHUNK;
    const seed = this.seed;
    for (let z = z0; z < Math.min(N, z0 + CHUNK); z++) {
      for (let x = x0; x < Math.min(N, x0 + CHUNK); x++) {
        const i = z * N + x;
        const dens = st.trees[i];
        if (!dens || TerrainRenderer.cellBlocked(st, i)) continue;
        const base = DENSITY_COUNT[dens] * this.density;
        let count = Math.floor(base + hash2(x, z, seed + 5));
        if (count <= 0) continue;
        if (count > 9) count = 9;
        const h = st.cellHeight(x, z);
        const slope = st.cellSlope(x, z);
        // stratified jitter on a 3x3 grid, slot order permuted per cell
        const rot = Math.floor(hash2(x, z, seed + 17) * 9);
        for (let t = 0; t < count; t++) {
          const slot = (t * 4 + rot) % 9;
          const sx = slot % 3, sz = Math.floor(slot / 3);
          const jx = hash2(x * 9 + t, z, seed + 23), jz = hash2(x, z * 9 + t, seed + 29);
          const px = (x + (sx + 0.15 + 0.7 * jx) / 3) * CELL_SIZE;
          const pz = (z + (sz + 0.15 + 0.7 * jz) / 3) * CELL_SIZE;
          const k = this.pickKind(x, z, h, slope, hash2(x * 5 + t, z * 3 - t, seed + 31), weights);
          const kind = this.kinds[k];
          const sp = this.species[kind.species];
          const [s0, s1] = sp.scale ?? [0.72, 1.18];
          const s = (s0 + (s1 - s0) * hash2(x + t * 3, z - t, seed + 37)) * (dens >= 4 ? 1.05 : 1);
          const a = hash2(x - t, z + t * 5, seed + 41) * Math.PI * 2;
          // sink into slopes so rocks / bushes / trunks never float on the downhill side
          const footR = sp.id === 'rock' || sp.id === 'bush' ? kind.radius * s * 0.8 : 0.5;
          const y = this.terrain.worldHeight(px, pz) - 0.12 - Math.min(1.2, (footR * slope) / CELL_SIZE);
          const c = Math.cos(a), sn = Math.sin(a);
          // near
          const cnt = this.scratchCount[k];
          this.ensureScratch(k, cnt + 1);
          const e = this.scratch[k];
          const o = cnt * 16;
          e[o] = c * s; e[o + 1] = 0; e[o + 2] = -sn * s; e[o + 3] = 0;
          e[o + 4] = 0; e[o + 5] = s; e[o + 6] = 0; e[o + 7] = 0;
          e[o + 8] = sn * s; e[o + 9] = 0; e[o + 10] = c * s; e[o + 11] = 0;
          e[o + 12] = px; e[o + 13] = y; e[o + 14] = pz; e[o + 15] = 1;
          this.scratchCount[k] = cnt + 1;
          // far impostor
          const fc = kind.conifer ? 1 : 0;
          const fn = this.farCount[fc];
          this.ensureFar(fc, fn + 1);
          const f = this.farScratch[fc];
          const fo = fn * 16;
          const sxz = (kind.radius / 0.42) * s * 0.92, sy = kind.height * s;
          f[fo] = c * sxz; f[fo + 1] = 0; f[fo + 2] = -sn * sxz; f[fo + 3] = 0;
          f[fo + 4] = 0; f[fo + 5] = sy; f[fo + 6] = 0; f[fo + 7] = 0;
          f[fo + 8] = sn * sxz; f[fo + 9] = 0; f[fo + 10] = c * sxz; f[fo + 11] = 0;
          f[fo + 12] = px; f[fo + 13] = y; f[fo + 14] = pz; f[fo + 15] = 1;
          const cv = 0.9 + 0.2 * hash2(x + t, z * 2 + t, seed + 43);
          const col = this.farColor[fc];
          col[fn * 3] = kind.color.r * cv;
          col[fn * 3 + 1] = kind.color.g * cv;
          col[fn * 3 + 2] = kind.color.b * cv;
          this.farCount[fc] = fn + 1;
          if (y < minY) minY = y;
          if (y + kind.height * s > maxY) maxY = y + kind.height * s;
        }
      }
    }
    // shuffle far instances so a prefix is a uniform random subset (density fade)
    for (let fc = 0; fc < 2; fc++) {
      const n = this.farCount[fc], f = this.farScratch[fc], col = this.farColor[fc];
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(hash2(i, ci, seed + 53 + fc) * (i + 1));
        if (j === i) continue;
        for (let q = 0; q < 16; q++) {
          const tmp = f[i * 16 + q];
          f[i * 16 + q] = f[j * 16 + q];
          f[j * 16 + q] = tmp;
        }
        for (let q = 0; q < 3; q++) {
          const tmp = col[i * 3 + q];
          col[i * 3 + q] = col[j * 3 + q];
          col[j * 3 + q] = tmp;
        }
      }
    }
    // bounds
    if (minY === Infinity) {
      minY = 0;
      maxY = 1;
    }
    ch.box.min.y = minY - 1;
    ch.box.max.y = maxY + 1;
    ch.box.getBoundingSphere(ch.sphere);
    let total = 0;
    for (let k = 0; k < nk; k++) {
      const n = this.scratchCount[k];
      total += n;
      ch.near[k] = this.fill(ch.near[k], this.kinds[k].geo, this.scratch[k], null, n, ch, true);
    }
    const imp = getImpostorGeometries();
    ch.far[0] = this.fill(ch.far[0], imp.broad, this.farScratch[0], this.farColor[0], this.farCount[0], ch, false);
    ch.far[1] = this.fill(ch.far[1], imp.conifer, this.farScratch[1], this.farColor[1], this.farCount[1], ch, false);
    ch.farTotal[0] = this.farCount[0];
    ch.farTotal[1] = this.farCount[1];
    this.totalInstances += total - ch.total;
    ch.total = total;
    this.applyLod(ch, ch.isNear, true);
  }

  private fill(mesh: THREE.InstancedMesh | null, geo: THREE.BufferGeometry, data: Float32Array, color: Float32Array | null, n: number, ch: TreeChunk, near: boolean): THREE.InstancedMesh | null {
    if (n === 0) {
      if (mesh) mesh.count = 0;
      if (mesh) mesh.visible = false;
      return mesh;
    }
    if (!mesh || mesh.instanceMatrix.count < n) {
      if (mesh) {
        this.group.remove(mesh);
        mesh.dispose();
      }
      const cap = Math.ceil(n * 1.25) + 8;
      mesh = new THREE.InstancedMesh(geo, this.material, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (color) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      mesh.castShadow = near ? this.castShadows : false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = near ? `trees-${geo.name}` : 'trees-far';
      this.group.add(mesh);
    }
    (mesh.instanceMatrix.array as Float32Array).set(data.subarray(0, n * 16));
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    if (color && mesh.instanceColor) {
      (mesh.instanceColor.array as Float32Array).set(color.subarray(0, n * 3));
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, n * 3);
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.count = n;
    mesh.boundingSphere = ch.sphere.clone();
    mesh.boundingBox = ch.box.clone();
    mesh.userData.total = n;
    return mesh;
  }

  private applyLod(ch: TreeChunk, near: boolean, force = false, keep = 1) {
    if (ch.isNear === near && !force && keep === ch.far[0]?.userData.keep) return;
    ch.isNear = near;
    for (const m of ch.near) if (m) m.visible = near && m.count > 0;
    for (let i = 0; i < 2; i++) {
      const m = ch.far[i];
      if (!m) continue;
      const tot = ch.farTotal[i];
      m.count = Math.max(0, Math.min(tot, Math.ceil(tot * keep)));
      m.userData.keep = keep;
      m.visible = !near && m.count > 0;
    }
  }

  /** per frame: incremental rebuilds + LOD selection */
  update(camera: THREE.Camera, budget = 3) {
    if (this.dirty.size) {
      let n = budget;
      for (const id of this.dirty) {
        this.dirty.delete(id);
        this.buildChunk(id);
        if (--n <= 0) break;
      }
    }
    const cp = camera.position;
    const lod = this.lodDistance;
    for (const ch of this.chunks) {
      ch.box.clampPoint(cp, _v);
      const d = _v.distanceTo(cp);
      const near = ch.isNear ? d < lod * 1.06 : d < lod * 0.94;
      // density fade for far chunks (keep a random subset)
      const keep = near ? 1 : Math.max(0.3, Math.min(1, 1.25 - (d - lod) / 7000));
      const q = Math.round(keep * 20) / 20;
      this.applyLod(ch, near, false, q);
    }
  }

  /** synchronous full rebuild (e.g. before a capture) */
  flush() {
    for (const id of this.dirty) this.buildChunk(id);
    this.dirty.clear();
  }

  private disposeChunk(c: TreeChunk) {
    for (const m of [...c.near, ...c.far]) {
      if (!m) continue;
      this.group.remove(m);
      m.dispose();
    }
  }

  dispose() {
    for (const c of this.chunks) this.disposeChunk(c);
    this.chunks = [];
    void _m;
  }
}
