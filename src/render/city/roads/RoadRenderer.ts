/**
 * RoadRenderer — chunked merged network meshes (CHUNK x CHUNK cells per draw call, one material).
 * Dirty chunks are rebuilt incrementally within a per-frame time budget.
 */
import * as THREE from 'three';
import type { CellRect } from '../../../core/events';
import type { NetInfo } from '../common/netinfo';
import type { RoadSurface } from '../common/surface';
import { GeoBuf } from './geobuf';
import { RoadMesher, type ChunkOutput, type PropItem, type PoolItem, type StreetlightInfo } from './mesher';
import { getRoadMaterial } from './roadMaterial';

export const CHUNK = 32;

interface Chunk {
  main: THREE.Mesh | null;
  struct: THREE.Mesh | null;
  dirty: boolean;
}

export type ChunkPropsListener = (chunkIndex: number, props: PropItem[], pools: PoolItem[]) => void;

export class RoadRenderer {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private nc: number;
  private mesher: RoadMesher;
  private out: ChunkOutput = { main: new GeoBuf(16384), struct: new GeoBuf(2048), props: [], pools: [] };
  private dirtyCount = 0;
  onChunkProps: ChunkPropsListener | null = null;
  /** stats */
  triangles = 0;
  /** 1 = signalized intersection (filled by the mesher) */
  readonly signalized: Uint8Array;

  constructor(private net: NetInfo, surf: RoadSurface) {
    this.group.name = 'roads';
    this.mesher = new RoadMesher(net, surf);
    this.signalized = new Uint8Array(net.N * net.N);
    this.mesher.signalized = this.signalized;
    this.nc = Math.ceil(net.N / CHUNK);
    for (let i = 0; i < this.nc * this.nc; i++) this.chunks.push({ main: null, struct: null, dirty: true });
    this.dirtyCount = this.chunks.length;
  }

  setStreetlightInfo(info: StreetlightInfo): void {
    this.mesher.light = info;
  }

  get chunkCount(): number {
    return this.nc * this.nc;
  }

  markDirty(r: CellRect): void {
    const c0x = Math.max(0, Math.floor(r.x0 / CHUNK)), c1x = Math.min(this.nc - 1, Math.floor((r.x1 - 1) / CHUNK));
    const c0z = Math.max(0, Math.floor(r.z0 / CHUNK)), c1z = Math.min(this.nc - 1, Math.floor((r.z1 - 1) / CHUNK));
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const c = this.chunks[cz * this.nc + cx];
        if (!c.dirty) { c.dirty = true; this.dirtyCount++; }
      }
    }
  }

  markAllDirty(): void {
    for (const c of this.chunks) c.dirty = true;
    this.dirtyCount = this.chunks.length;
  }

  get hasDirty(): boolean {
    return this.dirtyCount > 0;
  }

  /** rebuild dirty chunks; stops after `budgetMs` (at least one chunk per call). Returns chunks rebuilt. */
  update(budgetMs = 6): number {
    if (!this.dirtyCount) return 0;
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (!c.dirty) continue;
      this.rebuild(i);
      n++;
      if (performance.now() - t0 > budgetMs) break;
    }
    return n;
  }

  /** synchronous full rebuild (initial load) */
  rebuildAll(): void {
    for (let i = 0; i < this.chunks.length; i++) if (this.chunks[i].dirty) this.rebuild(i);
  }

  private rebuild(i: number): void {
    const c = this.chunks[i];
    c.dirty = false;
    this.dirtyCount--;
    const cx = i % this.nc, cz = (i / this.nc) | 0;
    const N = this.net.N;
    const x0 = cx * CHUNK, z0 = cz * CHUNK, x1 = Math.min(N, x0 + CHUNK), z1 = Math.min(N, z0 + CHUNK);
    for (let z = z0; z < z1; z++) this.signalized.fill(0, z * N + x0, z * N + x1);
    this.mesher.buildChunk(x0, z0, x1, z1, this.out);
    this.replace(c, 'main', this.out.main.build(), false);
    this.replace(c, 'struct', this.out.struct.build(), true);
    this.onChunkProps?.(i, this.out.props.slice(), this.out.pools.slice());
  }

  private replace(c: Chunk, key: 'main' | 'struct', geo: THREE.BufferGeometry | null, shadows: boolean): void {
    const old = c[key];
    if (old) {
      this.triangles -= (old.geometry.attributes.position.count / 3) | 0;
      old.geometry.dispose();
      if (!geo) {
        this.group.remove(old);
        c[key] = null;
        return;
      }
      old.geometry = geo;
      this.triangles += (geo.attributes.position.count / 3) | 0;
      return;
    }
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, getRoadMaterial());
    mesh.name = key === 'main' ? 'roadChunk' : 'roadStruct';
    mesh.receiveShadow = true;
    mesh.castShadow = shadows;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    c[key] = mesh;
    this.triangles += (geo.attributes.position.count / 3) | 0;
  }

  get drawCalls(): number {
    let n = 0;
    for (const c of this.chunks) n += (c.main ? 1 : 0) + (c.struct ? 1 : 0);
    return n;
  }

  dispose(): void {
    for (const c of this.chunks) {
      for (const m of [c.main, c.struct]) if (m) { m.geometry.dispose(); this.group.remove(m); }
      c.main = c.struct = null;
    }
  }
}
