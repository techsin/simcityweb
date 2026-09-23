/**
 * GeoBuf — growable typed-array vertex accumulator for the network meshes.
 * Attributes: position (f32x3), normal (i8x3 normalized), rd (f32x4: u, v, code, w).
 *   u    = lateral offset from the road centerline (m, + = right of travel direction +v)
 *   v    = distance along the road (m, world-continuous on straights)
 *   code = mat * 64 + kind * 8 + feature (see M / F in mesher.ts)
 *   w    = feature flags (crosswalk ends etc.)
 */
import * as THREE from 'three';

export interface GeoSlice {
  n: number;
  pos: Float32Array;
  nrm: Int8Array;
  rd: Float32Array;
}

export class GeoBuf {
  pos: Float32Array;
  nrm: Int8Array;
  rd: Float32Array;
  count = 0;

  constructor(initial = 4096) {
    this.pos = new Float32Array(initial * 3);
    this.nrm = new Int8Array(initial * 3);
    this.rd = new Float32Array(initial * 4);
  }

  reset(): void {
    this.count = 0;
  }

  private grow(): void {
    const cap = (this.pos.length / 3) * 2;
    const p = new Float32Array(cap * 3); p.set(this.pos); this.pos = p;
    const n = new Int8Array(cap * 3); n.set(this.nrm); this.nrm = n;
    const r = new Float32Array(cap * 4); r.set(this.rd); this.rd = r;
  }

  push(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, code: number, w: number): void {
    if (this.count * 3 + 3 > this.pos.length) this.grow();
    const i = this.count++;
    const p = i * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.nrm[p] = Math.round(nx * 127); this.nrm[p + 1] = Math.round(ny * 127); this.nrm[p + 2] = Math.round(nz * 127);
    const q = i * 4;
    this.rd[q] = u; this.rd[q + 1] = v; this.rd[q + 2] = code; this.rd[q + 3] = w;
  }

  /** copy vertices [from, count) out (for per-cell caching) */
  sliceFrom(from: number): GeoSlice | null {
    const n = this.count - from;
    if (n <= 0) return null;
    return {
      n,
      pos: this.pos.slice(from * 3, this.count * 3),
      nrm: this.nrm.slice(from * 3, this.count * 3),
      rd: this.rd.slice(from * 4, this.count * 4),
    };
  }

  append(s: GeoSlice): void {
    while ((this.count + s.n) * 3 > this.pos.length) this.grow();
    this.pos.set(s.pos, this.count * 3);
    this.nrm.set(s.nrm, this.count * 3);
    this.rd.set(s.rd, this.count * 4);
    this.count += s.n;
  }

  /** Copy into a fresh BufferGeometry (null when empty). */
  build(): THREE.BufferGeometry | null {
    if (this.count === 0) return null;
    const n = this.count;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, n * 3), 3, true));
    g.setAttribute('rd', new THREE.BufferAttribute(this.rd.slice(0, n * 4), 4));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
