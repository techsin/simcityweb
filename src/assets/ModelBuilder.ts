/**
 * ModelBuilder — tiny procedural low-poly modeling toolkit used by every asset builder.
 *
 * Every vertex carries:
 *   position (vec3), normal (vec3), color (vec3, linear), surf (vec3: [Surf type, pattern, floorHeight])
 * The shared BuildingMaterial (src/assets/materials.ts) reads `surf` to render procedural windows,
 * glass, roofs, foliage etc. and night lighting. So: model the MASSING with boxes/prisms and let the shader
 * add windows. Add real geometry for things that read at distance: balconies, cornices, roof units, awnings,
 * chimneys, stacks, tanks, signs, fences, trees, cars in parking lots etc.
 *
 * Coordinates: meters, origin at lot center on the ground, +Y up, FRONT of lot faces +Z. See manifest.ts.
 */
import * as THREE from 'three';
import { Surf } from '../core/types';

export type ColorLike = number | string | [number, number, number] | THREE.Color;

export interface Paint {
  color: ColorLike;
  surf?: Surf;
  /** pattern / style id for the surface (window style, glass tint...) see materials.ts */
  pattern?: number;
  /** floor height in meters for window grids (default 3.3) */
  floor?: number;
}

export interface BoxFaces {
  /** paint for the +Y face (roof). Defaults to the side paint. */
  top?: Paint | null;
  /** paint for the -Y face. Default: omitted (null) since most boxes sit on something. */
  bottom?: Paint | null;
  /** optional per-side overrides; null = omit that face */
  px?: Paint | null;
  nx?: Paint | null;
  pz?: Paint | null;
  nz?: Paint | null;
}

const _c = new THREE.Color();
function toColor(c: ColorLike): THREE.Color {
  if (c instanceof THREE.Color) return _c.copy(c);
  if (Array.isArray(c)) return _c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  return _c.set(c as any);
}

type V3 = [number, number, number];

export class ModelBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private srf: number[] = [];
  private mat = new THREE.Matrix4();
  private nmat = new THREE.Matrix3();
  private stack: THREE.Matrix4[] = [];
  private cur: { r: number; g: number; b: number; s: number; p: number; f: number } = { r: 0.8, g: 0.8, b: 0.8, s: Surf.Plain, p: 0, f: 3.3 };
  private tmpV = new THREE.Vector3();
  private tmpN = new THREE.Vector3();

  // ------------------------------------------------------------------ state
  /** set current paint (color + surface). Returns this for chaining. */
  paint(p: Paint | ColorLike, surf?: Surf, pattern?: number, floor?: number): this {
    if (typeof p === 'object' && p !== null && !Array.isArray(p) && !(p instanceof THREE.Color) && 'color' in p) {
      const c = toColor(p.color);
      this.cur = { r: c.r, g: c.g, b: c.b, s: p.surf ?? Surf.Plain, p: p.pattern ?? 0, f: p.floor ?? 3.3 };
    } else {
      const c = toColor(p as ColorLike);
      this.cur = { r: c.r, g: c.g, b: c.b, s: surf ?? Surf.Plain, p: pattern ?? 0, f: floor ?? 3.3 };
    }
    return this;
  }
  getPaint(): Paint {
    const c = new THREE.Color(this.cur.r, this.cur.g, this.cur.b);
    return { color: c, surf: this.cur.s, pattern: this.cur.p, floor: this.cur.f };
  }

  // ------------------------------------------------------------------ transforms
  push(): this {
    this.stack.push(this.mat.clone());
    return this;
  }
  pop(): this {
    const m = this.stack.pop();
    if (m) this.mat.copy(m);
    this.updateNormalMatrix();
    return this;
  }
  translate(x: number, y: number, z: number): this {
    this.mat.multiply(new THREE.Matrix4().makeTranslation(x, y, z));
    return this;
  }
  /** rotate around Y axis (radians) */
  rotateY(a: number): this {
    this.mat.multiply(new THREE.Matrix4().makeRotationY(a));
    this.updateNormalMatrix();
    return this;
  }
  rotateX(a: number): this {
    this.mat.multiply(new THREE.Matrix4().makeRotationX(a));
    this.updateNormalMatrix();
    return this;
  }
  rotateZ(a: number): this {
    this.mat.multiply(new THREE.Matrix4().makeRotationZ(a));
    this.updateNormalMatrix();
    return this;
  }
  scale(x: number, y = x, z = x): this {
    this.mat.multiply(new THREE.Matrix4().makeScale(x, y, z));
    this.updateNormalMatrix();
    return this;
  }
  private updateNormalMatrix() {
    this.nmat.getNormalMatrix(this.mat);
  }

  // ------------------------------------------------------------------ raw emit
  private emitVertex(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
    const v = this.tmpV.set(x, y, z).applyMatrix4(this.mat);
    const n = this.tmpN.set(nx, ny, nz).applyMatrix3(this.nmat).normalize();
    this.pos.push(v.x, v.y, v.z);
    this.nrm.push(n.x, n.y, n.z);
    this.col.push(this.cur.r, this.cur.g, this.cur.b);
    this.srf.push(this.cur.s, this.cur.p, this.cur.f);
  }
  /** triangle with explicit per-vertex normals (a,b,c counter-clockwise when viewed from outside) */
  triN(a: V3, b: V3, c: V3, na: V3, nb: V3, nc: V3): this {
    this.emitVertex(a[0], a[1], a[2], na[0], na[1], na[2]);
    this.emitVertex(b[0], b[1], b[2], nb[0], nb[1], nb[2]);
    this.emitVertex(c[0], c[1], c[2], nc[0], nc[1], nc[2]);
    return this;
  }
  /** flat-shaded triangle, CCW from outside */
  tri(a: V3, b: V3, c: V3): this {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const n: V3 = [nx, ny, nz];
    return this.triN(a, b, c, n, n, n);
  }
  /** flat quad a-b-c-d CCW from outside */
  quad(a: V3, b: V3, c: V3, d: V3): this {
    this.tri(a, b, c);
    this.tri(a, c, d);
    return this;
  }
  /** double sided quad (for thin panels: signs, fences, blades) */
  quad2(a: V3, b: V3, c: V3, d: V3): this {
    this.quad(a, b, c, d);
    this.quad(d, c, b, a);
    return this;
  }

  // ------------------------------------------------------------------ primitives
  /**
   * Axis aligned box between (x0,y0,z0) and (x1,y1,z1) in current transform.
   * Uses current paint for sides; `faces` lets you override roof/bottom/sides (null = omit face).
   */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces?: BoxFaces): this {
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    if (z0 > z1) [z0, z1] = [z1, z0];
    const base = { ...this.cur };
    const withPaint = (p: Paint | null | undefined, fallbackDefault: boolean, fn: () => void) => {
      if (p === null) return;
      if (p === undefined) {
        if (!fallbackDefault) return;
        this.cur = { ...base };
      } else this.paint(p);
      fn();
    };
    // +Z (front)
    withPaint(faces?.pz, true, () => this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]));
    // -Z
    withPaint(faces?.nz, true, () => this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]));
    // +X
    withPaint(faces?.px, true, () => this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]));
    // -X
    withPaint(faces?.nx, true, () => this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]));
    // +Y
    withPaint(faces?.top, true, () => this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]));
    // -Y (off by default)
    withPaint(faces?.bottom, false, () => this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]));
    this.cur = base;
    return this;
  }

  /** Box by center (cx, cz), size (w along x, d along z), base y0 and height h. */
  boxC(cx: number, cz: number, w: number, d: number, y0: number, h: number, faces?: BoxFaces): this {
    return this.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, faces);
  }

  /** Thin ground slab (lawn, pavement, parking) covering rect, top at y = h (default 0.05). */
  slab(x0: number, z0: number, x1: number, z1: number, h = 0.05, y0 = 0): this {
    return this.box(x0, y0, z0, x1, y0 + h, z1);
  }

  /**
   * Cylinder / frustum along Y. r1 = top radius (default r0). seg = radial segments.
   * smooth: smooth side normals (default true). caps: draw top/bottom caps (default top only).
   */
  cylinder(cx: number, cz: number, y0: number, h: number, r0: number, r1 = r0, seg = 12, opts: { smooth?: boolean; top?: boolean; bottom?: boolean; topPaint?: Paint } = {}): this {
    const smooth = opts.smooth ?? true;
    const y1 = y0 + h;
    const slope = (r0 - r1) / (h || 1);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p00: V3 = [cx + c0 * r0, y0, cz + s0 * r0];
      const p10: V3 = [cx + c1 * r0, y0, cz + s1 * r0];
      const p01: V3 = [cx + c0 * r1, y1, cz + s0 * r1];
      const p11: V3 = [cx + c1 * r1, y1, cz + s1 * r1];
      if (smooth) {
        const n0 = norm3([c0, slope, s0]);
        const n1 = norm3([c1, slope, s1]);
        this.triN(p00, p11, p10, n0, n1, n1);
        this.triN(p00, p01, p11, n0, n0, n1);
      } else {
        this.quad(p00, p01, p11, p10);
      }
    }
    const base = { ...this.cur };
    if (opts.top ?? true) {
      if (opts.topPaint) this.paint(opts.topPaint);
      if (r1 > 0.0001)
        for (let i = 0; i < seg; i++) {
          const a0 = (i / seg) * Math.PI * 2;
          const a1 = ((i + 1) / seg) * Math.PI * 2;
          this.tri([cx, y1, cz], [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1], [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1]);
        }
      this.cur = base;
    }
    if (opts.bottom) {
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        this.tri([cx, y0, cz], [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0]);
      }
    }
    return this;
  }

  /** Cone along Y (apex at top). */
  cone(cx: number, cz: number, y0: number, h: number, r: number, seg = 10, smooth = true): this {
    return this.cylinder(cx, cz, y0, h, r, 0, seg, { smooth, top: false, bottom: false });
  }

  /** UV sphere or hemisphere (hemi=true: upper half only) */
  sphere(cx: number, cy: number, cz: number, r: number, seg = 12, rings = 8, opts: { hemi?: boolean; scaleY?: number } = {}): this {
    const sy = opts.scaleY ?? 1;
    const ringStart = 0;
    const ringEnd = opts.hemi ? Math.ceil(rings / 2) : rings;
    for (let j = ringStart; j < ringEnd; j++) {
      const t0 = (j / rings) * Math.PI;
      const t1 = ((j + 1) / rings) * Math.PI;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const P = (t: number, a: number): V3 => [cx + r * Math.sin(t) * Math.cos(a), cy + r * sy * Math.cos(t), cz + r * Math.sin(t) * Math.sin(a)];
        const N = (t: number, a: number): V3 => norm3([Math.sin(t) * Math.cos(a), Math.cos(t) / sy, Math.sin(t) * Math.sin(a)]);
        const a = P(t0, a0), b = P(t0, a1), c = P(t1, a1), d = P(t1, a0);
        const na = N(t0, a0), nb = N(t0, a1), nc = N(t1, a1), nd = N(t1, a0);
        if (j > 0) this.triN(a, b, c, na, nb, nc);
        if (j < rings - 1) this.triN(a, c, d, na, nc, nd);
        else if (j === rings - 1 && j === 0) this.triN(a, c, d, na, nc, nd);
      }
    }
    return this;
  }

  /** Low-poly icosphere-ish blob (for foliage). detail 0 = 20 tris, 1 = 80 tris. */
  blob(cx: number, cy: number, cz: number, rx: number, ry = rx, rz = rx, detail = 0, jitter = 0.12, seed = 1): this {
    const geo = new THREE.IcosahedronGeometry(1, detail);
    const p = geo.attributes.position as THREE.BufferAttribute;
    // jitter shared vertices consistently by hashing position
    const verts: V3[] = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 1.618) * 43758.5453;
      const j = 1 + (h - Math.floor(h) - 0.5) * 2 * jitter;
      verts.push([cx + x * rx * j, cy + y * ry * j, cz + z * rz * j]);
    }
    for (let i = 0; i < verts.length; i += 3) this.tri(verts[i], verts[i + 1], verts[i + 2]);
    geo.dispose();
    return this;
  }

  /**
   * Gable roof over wall rect centered (cx,cz) size w x d; y0 = wall top, ridge h above y0.
   * axis: direction of the ridge ('x' ridge runs along X, gables face ±X). overhang extends eaves.
   * gable: paint for the triangular gable ends (default = current paint of walls given as `gable`, or current).
   */
  gableRoof(cx: number, cz: number, w: number, d: number, y0: number, h: number, axis: 'x' | 'z' = 'x', overhang = 0.4, gable?: Paint): this {
    // y0 = top of the walls; the roof plane passes through the wall top and the ridge (y0 + h),
    // and continues down past the wall by `overhang` (eaves sit slightly lower than y0).
    const roof = { ...this.cur };
    const yr = y0 + h;
    if (axis === 'x') {
      const half = d / 2;
      const drop = (h / half) * overhang;
      const ye = y0 - drop;
      const x0 = cx - w / 2 - overhang, x1 = cx + w / 2 + overhang;
      const z0 = cz - half - overhang, z1 = cz + half + overhang;
      this.quad([x0, ye, z1], [x1, ye, z1], [x1, yr, cz], [x0, yr, cz]);
      this.quad([x1, ye, z0], [x0, ye, z0], [x0, yr, cz], [x1, yr, cz]);
      if (gable) this.paint(gable);
      const gx0 = cx - w / 2, gx1 = cx + w / 2, gz0 = cz - half, gz1 = cz + half;
      this.tri([gx1, y0, gz1], [gx1, y0, gz0], [gx1, yr, cz]);
      this.tri([gx0, y0, gz0], [gx0, y0, gz1], [gx0, yr, cz]);
    } else {
      const half = w / 2;
      const drop = (h / half) * overhang;
      const ye = y0 - drop;
      const x0 = cx - half - overhang, x1 = cx + half + overhang;
      const z0 = cz - d / 2 - overhang, z1 = cz + d / 2 + overhang;
      this.quad([x1, ye, z1], [x1, ye, z0], [cx, yr, z0], [cx, yr, z1]);
      this.quad([x0, ye, z0], [x0, ye, z1], [cx, yr, z1], [cx, yr, z0]);
      if (gable) this.paint(gable);
      const gx0 = cx - half, gx1 = cx + half, gz0 = cz - d / 2, gz1 = cz + d / 2;
      this.tri([gx0, y0, gz1], [gx1, y0, gz1], [cx, yr, gz1]);
      this.tri([gx1, y0, gz0], [gx0, y0, gz0], [cx, yr, gz0]);
    }
    this.cur = roof;
    return this;
  }

  /** Hip roof: ridge along the longer axis, all 4 sides sloped. */
  hipRoof(cx: number, cz: number, w: number, d: number, y0: number, h: number, overhang = 0.4): this {
    // y0 = wall top. Eaves drop below y0 by the overhang along the slope.
    const half = Math.min(w, d) / 2;
    const drop = (h / half) * overhang;
    const ye = y0 - drop;
    const x0 = cx - w / 2 - overhang, x1 = cx + w / 2 + overhang;
    const z0 = cz - d / 2 - overhang, z1 = cz + d / 2 + overhang;
    const yr = y0 + h;
    const inset = half + overhang;
    if (w >= d) {
      const rx0 = Math.min(cx, x0 + inset), rx1 = Math.max(cx, x1 - inset);
      this.quad([x0, ye, z1], [x1, ye, z1], [rx1, yr, cz], [rx0, yr, cz]);
      this.quad([x1, ye, z0], [x0, ye, z0], [rx0, yr, cz], [rx1, yr, cz]);
      this.tri([x1, ye, z1], [x1, ye, z0], [rx1, yr, cz]);
      this.tri([x0, ye, z0], [x0, ye, z1], [rx0, yr, cz]);
    } else {
      const rz0 = Math.min(cz, z0 + inset), rz1 = Math.max(cz, z1 - inset);
      this.quad([x1, ye, z1], [x1, ye, z0], [cx, yr, rz0], [cx, yr, rz1]);
      this.quad([x0, ye, z0], [x0, ye, z1], [cx, yr, rz1], [cx, yr, rz0]);
      this.tri([x0, ye, z1], [x1, ye, z1], [cx, yr, rz1]);
      this.tri([x1, ye, z0], [x0, ye, z0], [cx, yr, rz0]);
    }
    return this;
  }

  /** Pyramid (4-sided) roof / spire over rect. */
  pyramid(cx: number, cz: number, w: number, d: number, y0: number, h: number): this {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const apex: V3 = [cx, y0 + h, cz];
    this.tri([x0, y0, z1], [x1, y0, z1], apex);
    this.tri([x1, y0, z1], [x1, y0, z0], apex);
    this.tri([x1, y0, z0], [x0, y0, z0], apex);
    this.tri([x0, y0, z0], [x0, y0, z1], apex);
    return this;
  }

  /** Shed (mono-pitch) roof: high edge at -Z side by default. */
  shedRoof(cx: number, cz: number, w: number, d: number, y0: number, h: number, highSide: 'nz' | 'pz' | 'nx' | 'px' = 'nz'): this {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const Y = (x: number, z: number) => {
      switch (highSide) {
        case 'nz': return y0 + h * (z1 - z) / d;
        case 'pz': return y0 + h * (z - z0) / d;
        case 'nx': return y0 + h * (x1 - x) / w;
        case 'px': return y0 + h * (x - x0) / w;
      }
    };
    const a: V3 = [x0, Y(x0, z1), z1], b: V3 = [x1, Y(x1, z1), z1], c: V3 = [x1, Y(x1, z0), z0], d2: V3 = [x0, Y(x0, z0), z0];
    this.quad(a, b, c, d2);
    // side fills
    this.quad([x0, y0, z1], [x1, y0, z1], b, a);
    this.quad([x1, y0, z0], [x0, y0, z0], d2, c);
    this.quad([x1, y0, z1], [x1, y0, z0], c, b);
    this.quad([x0, y0, z0], [x0, y0, z1], a, d2);
    return this;
  }

  /** Saw-tooth factory roof: `teeth` ridges along X over the rect. */
  sawtoothRoof(cx: number, cz: number, w: number, d: number, y0: number, h: number, teeth: number, glass?: Paint): this {
    const roof = { ...this.cur };
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const tz = d / teeth;
    for (let t = 0; t < teeth; t++) {
      const za = cz - d / 2 + t * tz, zb = za + tz;
      this.cur = { ...roof };
      this.quad([x0, y0, zb], [x1, y0, zb], [x1, y0 + h, za], [x0, y0 + h, za]); // slope
      if (glass) this.paint(glass);
      this.quad([x1, y0, za], [x0, y0, za], [x0, y0 + h, za], [x1, y0 + h, za]); // vertical glazing facing -Z
      this.cur = { ...roof };
      this.tri([x1, y0, zb], [x1, y0, za], [x1, y0 + h, za]);
      this.tri([x0, y0, za], [x0, y0, zb], [x0, y0 + h, za]);
    }
    this.cur = roof;
    return this;
  }

  /**
   * Extrude a simple polygon (array of [x,z], CCW when viewed from above i.e. from +Y looking down with x right, z down... just pass
   * points in either order; winding is auto-corrected) from y0 up by h. caps: top (default true), bottom (default false).
   */
  extrude(poly: [number, number][], y0: number, h: number, opts: { top?: boolean; bottom?: boolean; topPaint?: Paint } = {}): this {
    let pts = poly.slice();
    // ensure CCW in x/z plane when looking from +Y (right-handed: x right, -z forward) -> signed area in (x, -z)
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      area += ax * -bz - bx * -az;
    }
    if (area < 0) pts = pts.reverse();
    const y1 = y0 + h;
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]);
    }
    const shape2 = pts.map(([x, z]) => new THREE.Vector2(x, -z));
    const tris = THREE.ShapeUtils.triangulateShape(shape2, []);
    const base = { ...this.cur };
    if (opts.top ?? true) {
      if (opts.topPaint) this.paint(opts.topPaint);
      for (const [a, b, c] of tris) {
        this.tri([pts[a][0], y1, pts[a][1]], [pts[b][0], y1, pts[b][1]], [pts[c][0], y1, pts[c][1]]);
      }
      this.cur = base;
    }
    if (opts.bottom) {
      for (const [a, b, c] of tris) this.tri([pts[c][0], y0, pts[c][1]], [pts[b][0], y0, pts[b][1]], [pts[a][0], y0, pts[a][1]]);
    }
    return this;
  }

  /** Regular n-gon prism centered at (cx, cz) with radius r (e.g. octagonal towers). */
  prism(cx: number, cz: number, r: number, sides: number, y0: number, h: number, rot = 0, opts: { top?: boolean; topPaint?: Paint } = {}): this {
    const pts: [number, number][] = [];
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    return this.extrude(pts, y0, h, opts);
  }

  /** Torus-like ring in XZ plane (e.g. ferris wheel, stadium ring) built from boxes; tube = square cross-section. */
  ring(cx: number, cy: number, cz: number, radius: number, tube: number, seg = 24, plane: 'xz' | 'xy' = 'xz'): this {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const pa: V3 = plane === 'xz' ? [cx + Math.cos(a0) * radius, cy, cz + Math.sin(a0) * radius] : [cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius, cz];
      const pb: V3 = plane === 'xz' ? [cx + Math.cos(a1) * radius, cy, cz + Math.sin(a1) * radius] : [cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, cz];
      this.beam(pa, pb, tube);
    }
    return this;
  }

  /** Square-section beam between two points (pipes, girders, cables, fences rails). */
  beam(a: V3, b: V3, thickness: number): this {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return this;
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(a[0], a[1], a[2]), q, new THREE.Vector3(1, 1, 1));
    this.push();
    this.mat.multiply(m);
    this.updateNormalMatrix();
    const t = thickness / 2;
    this.box(-t, 0, -t, t, len, t, { top: null });
    this.pop();
    return this;
  }

  /** Round pipe between two points. */
  pipe(a: V3, b: V3, radius: number, seg = 6): this {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return this;
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(a[0], a[1], a[2]), q, new THREE.Vector3(1, 1, 1));
    this.push();
    this.mat.multiply(m);
    this.updateNormalMatrix();
    this.cylinder(0, 0, 0, len, radius, radius, seg, { top: false });
    this.pop();
    return this;
  }

  /** Append another builder's triangles (already in model space) into this one, applying current transform. */
  append(other: ModelBuilder): this {
    const o = other.raw();
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < o.pos.length; i += 3) {
      v.set(o.pos[i], o.pos[i + 1], o.pos[i + 2]).applyMatrix4(this.mat);
      n.set(o.nrm[i], o.nrm[i + 1], o.nrm[i + 2]).applyMatrix3(this.nmat).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(n.x, n.y, n.z);
      this.col.push(o.col[i], o.col[i + 1], o.col[i + 2]);
      this.srf.push(o.srf[i], o.srf[i + 1], o.srf[i + 2]);
    }
    return this;
  }

  raw() {
    return { pos: this.pos, nrm: this.nrm, col: this.col, srf: this.srf };
  }

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  /** Build a non-indexed BufferGeometry with attributes position, normal, color, surf. */
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('surf', new THREE.Float32BufferAttribute(this.srf, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

function norm3(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---------------------------------------------------------------------------
// Handy palettes (sRGB hex). Builders may use their own colors too.
// ---------------------------------------------------------------------------
export const PALETTE = {
  grass: 0x6f9a45,
  grassDark: 0x4f7a32,
  grassDry: 0x9aa05a,
  hedge: 0x3f6b2e,
  dirt: 0x8a6e4b,
  sand: 0xd8c690,
  asphalt: 0x3a3b3e,
  concrete: 0xb8b5ad,
  concreteDark: 0x8e8b84,
  sidewalk: 0xc9c4b8,
  parkingLine: 0xeeeeee,
  brickRed: 0x9c4a36,
  brickBrown: 0x7d4a33,
  brickYellow: 0xc9a86a,
  stucco: 0xe9dfc8,
  stuccoPink: 0xe7c3b3,
  stuccoBlue: 0xbcd0d9,
  white: 0xf2f0ea,
  roofGrey: 0x5c5f63,
  roofRed: 0xa4442e,
  roofBrown: 0x6b4a36,
  roofSlate: 0x464c55,
  roofGreen: 0x4d6b53,
  glassBlue: 0x5d86a8,
  glassGreen: 0x6c9c94,
  glassDark: 0x2a3440,
  metal: 0x9aa0a6,
  metalDark: 0x555a60,
  rust: 0x8b5a3a,
  wood: 0x8b6a47,
  trunk: 0x5b4330,
  water: 0x3f7ea6,
  red: 0xc0392b,
  yellow: 0xf1c40f,
  blue: 0x2e6fb5,
  orange: 0xe67e22,
};
