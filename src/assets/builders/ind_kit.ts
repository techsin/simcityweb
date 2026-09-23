/**
 * Local helper kit for the INDUSTRIAL + UTILITY builders (owned by the industrial/utility asset agent).
 * Cheap, tri-counted primitives for heavy industry: tanks, stacks, lathes (cooling towers / domes / silos),
 * lattice struts, pipe runs, conveyors, trucks, low-poly cars, fences, trees, plus smoke-emitter capture.
 * All coordinates are model space (meters, lot centered, front = +Z). Never uses Math.random.
 */
import { Color } from 'three';
import { ModelBuilder, PALETTE, type ColorLike } from '../ModelBuilder';
import { Surf } from '../../core/types';
import { RNG, hashString } from '../../core/rng';
import type { ModelBuildFn } from '../registry';
import { MANIFEST_BY_ID } from '../manifest';

export type V3 = [number, number, number];
export type Face = 'pz' | 'nz' | 'px' | 'nx';

/**
 * Stacked ground layers (keep >= 3 cm apart to avoid z-fighting at distance):
 * lot base slab 0.05 -> overlays (asphalt, lawn, tracks, paths) 0.08 -> light pools 0.11 -> markings / stains 0.14.
 */
export const Y_BASE = 0.05, Y_OVER = 0.08, Y_POOL = 0.11, Y_MARK = 0.14;

/** Neutral metal paint used to reset the current paint after emissive helpers. */
export const RESET_PAINT = 0x55595e;

/** Color scaled in linear space (for Emissive-9 light pools painted ~0.7x the ground under them). */
export function dim(c: ColorLike, k: number): Color {
  const out = new Color();
  if (c instanceof Color) out.copy(c);
  else if (Array.isArray(c)) out.setRGB(c[0], c[1], c[2], 'srgb');
  else out.set(c as number | string);
  return out.multiplyScalar(k);
}

/**
 * Emissive-9 ground light pool via ModelBuilder.lightPool (smooth radial falloff; plain ground colour by day).
 * `y` is the final pool height (lightPool lifts by 2 cm internally); `floor` / 3.3 = intensity.
 */
export function pool(b: ModelBuilder, x: number, z: number, r: number, groundColor: ColorLike, y = Y_POOL, seg = 10, floor = 3.3): void {
  // the pool's night light scales with its (ground) albedo -> boost it on dark asphalt / coal so it still reads
  const c = dim(groundColor, 1);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const boost = Math.min(7, Math.max(1, 0.28 / Math.max(lum, 0.01)));
  b.lightPool(x, y - 0.02, z, r, groundColor, (floor / 3.3) * boost, seg);
  b.paint(RESET_PAINT, Surf.Metal);
}

/** Light pool covering a rectangle (dock aprons, lit yards): a soft round pool inscribed in the rect. */
export function poolRect(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, groundColor: ColorLike, y = Y_POOL, floor = 3.3): void {
  const r = Math.min(Math.abs(x1 - x0), Math.abs(z1 - z0)) * 0.5 * 1.15 + Math.abs(Math.abs(x1 - x0) - Math.abs(z1 - z0)) * 0.25;
  pool(b, (x0 + x1) / 2, (z0 + z1) / 2, r, groundColor, y, 10, floor);
}

/** Emissive-9 ring (annulus) pool, e.g. lit apron around a cooling tower base: bright at the inner edge, fading out. */
export function poolRing(b: ModelBuilder, x: number, z: number, r0: number, r1: number, groundColor: ColorLike, y = Y_POOL, seg = 10, floor = 2.4): void {
  b.paint({ color: dim(groundColor, 0.7), surf: Surf.Emissive, pattern: 9, floor });
  const start = b.triangleCount * 3;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    b.quad([x + c0 * r1, y, z + s0 * r1], [x + c0 * r0, y, z + s0 * r0], [x + c1 * r0, y, z + s1 * r0], [x + c1 * r1, y, z + s1 * r1]);
  }
  // radial falloff: outer-rim vertices get ~zero light intensity (surf.z channel)
  const raw = b.raw();
  const rm = (r0 + r1) / 2;
  for (let v = start; v < raw.pos.length / 3; v++) {
    const dx = raw.pos[v * 3] - x, dz = raw.pos[v * 3 + 2] - z;
    if (Math.hypot(dx, dz) > rm) raw.srf[v * 3 + 2] = 0.01;
  }
  b.paint(RESET_PAINT, Surf.Metal);
}

// ---------------------------------------------------------------------------------------------------------------
// Smoke / steam emitter capture. Builders call emitSmoke()/emitSteam() with MODEL-SPACE positions (never inside a
// push/translate block). makeEmitterMaps() re-runs the builder with the registry's seed to collect them.
// ---------------------------------------------------------------------------------------------------------------
interface EmitSink { smoke: V3[]; steam: V3[] }
let sink: EmitSink | null = null;
export function emitSmoke(p: V3): void {
  if (sink) sink.smoke.push([+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2)]);
}
export function emitSteam(p: V3): void {
  if (sink) sink.steam.push([+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2)]);
}

export type EmitterMap = Record<string, (variant: number) => V3[]>;

/** Builds { smoke, steam } emitter maps for the given ids. smoke includes steam positions (steam is a subset). */
export function makeEmitterMaps(models: Record<string, ModelBuildFn>, ids: string[]): { smoke: EmitterMap; steam: EmitterMap } {
  const cache = new Map<string, EmitSink>();
  const get = (id: string, variant: number): EmitSink => {
    // mirror the registry exactly: variant -> (base variant, seed key), X-mirrored twins for v >= buildVariants
    const entry = MANIFEST_BY_ID[id];
    const nv = entry?.variants ?? 1;
    const v = ((variant % nv) + nv) % nv;
    const bv = entry?.buildVariants ?? nv;
    const baseV = v % bv;
    const mirrored = !!entry?.mirror && v >= bv;
    const key = `${id}#${v}`;
    let r = cache.get(key);
    if (r) return r;
    const prev = sink;
    sink = { smoke: [], steam: [] };
    try {
      const fn = models[id];
      if (fn && entry) fn(new ModelBuilder(), baseV, new RNG(hashString(key)), entry);
      r = sink;
      if (mirrored) r = { smoke: r.smoke.map(([x, y, z]) => [-x, y, z] as V3), steam: r.steam.map(([x, y, z]) => [-x, y, z] as V3) };
    } catch {
      r = { smoke: [], steam: [] };
    } finally {
      sink = prev;
    }
    cache.set(key, r!);
    return r!;
  };
  const smoke: EmitterMap = {};
  const steam: EmitterMap = {};
  for (const id of ids) {
    smoke[id] = (v) => { const r = get(id, v); return [...r.smoke, ...r.steam].map((p) => [...p] as V3); };
    steam[id] = (v) => get(id, v).steam.map((p) => [...p] as V3);
  }
  return { smoke, steam };
}

// ---------------------------------------------------------------------------------------------------------------
// Flat bits
// ---------------------------------------------------------------------------------------------------------------
/** Upward-facing quad at height y (2 tris). */
export function flat(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number): void {
  b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
}

/** Ground slab: top face only (2 tris) or with sides (10 tris). */
export function ground(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, color: ColorLike, surf = Surf.Pavement, h = 0.05, sides = false): void {
  b.paint(color, surf);
  if (sides) b.box(x0, 0, z0, x1, h, z1);
  else flat(b, x0, z0, x1, z1, h);
}

/** Quad on a vertical wall facing `face`, offset 3 cm from `plane`. a0..a1 runs along the wall (x for z-faces, z for x-faces). */
export function wallQuad(b: ModelBuilder, face: Face, plane: number, a0: number, a1: number, y0: number, y1: number, off = 0.03): void {
  if (a0 > a1) [a0, a1] = [a1, a0];
  switch (face) {
    case 'pz': { const z = plane + off; b.quad([a0, y0, z], [a1, y0, z], [a1, y1, z], [a0, y1, z]); break; }
    case 'nz': { const z = plane - off; b.quad([a1, y0, z], [a0, y0, z], [a0, y1, z], [a1, y1, z]); break; }
    case 'px': { const x = plane + off; b.quad([x, y0, a1], [x, y0, a0], [x, y1, a0], [x, y1, a1]); break; }
    case 'nx': { const x = plane - off; b.quad([x, y0, a0], [x, y0, a1], [x, y1, a1], [x, y1, a0]); break; }
  }
}

/** Row of n equally spaced quads (windows / doors) on a wall between a0..a1. */
export function wallRow(b: ModelBuilder, face: Face, plane: number, a0: number, a1: number, y0: number, y1: number, n: number, w: number): void {
  const step = (a1 - a0) / n;
  for (let i = 0; i < n; i++) {
    const c = a0 + step * (i + 0.5);
    wallQuad(b, face, plane, c - w / 2, c + w / 2, y0, y1);
  }
}

/** Flat disc on a wall (logo), seg tris. */
export function wallDisc(b: ModelBuilder, face: Face, plane: number, ca: number, cy: number, r: number, seg = 10, off = 0.04): void {
  for (let i = 0; i < seg; i++) {
    const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
    const a0 = ca + Math.cos(t0) * r, y0 = cy + Math.sin(t0) * r;
    const a1 = ca + Math.cos(t1) * r, y1 = cy + Math.sin(t1) * r;
    switch (face) {
      case 'pz': b.tri([ca, cy, plane + off], [a0, y0, plane + off], [a1, y1, plane + off]); break;
      case 'nz': b.tri([ca, cy, plane - off], [a1, y1, plane - off], [a0, y0, plane - off]); break;
      case 'px': b.tri([plane + off, cy, ca], [plane + off, y1, a1], [plane + off, y0, a0]); break;
      case 'nx': b.tri([plane - off, cy, ca], [plane - off, y0, a0], [plane - off, y1, a1]); break;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Round things
// ---------------------------------------------------------------------------------------------------------------
function n3(x: number, y: number, z: number): V3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * Surface of revolution around (cx, cz). profile = [radius, y] from bottom to top. Smooth normals.
 * inside: also/only emit the inner surface (reversed). phase: angular offset.
 * Tris: 2 * seg * (profile.length - 1) (fans where radius hits 0).
 */
export function lathe(b: ModelBuilder, cx: number, cz: number, profile: [number, number][], seg: number, opts: { inside?: boolean; outside?: boolean; phase?: number; flatShade?: boolean } = {}): void {
  const outside = opts.outside ?? true;
  const inside = opts.inside ?? false;
  const ph = opts.phase ?? 0;
  const np = profile.length;
  // per-edge normals in (radial, y)
  const en: [number, number][] = [];
  for (let k = 0; k < np - 1; k++) {
    const dr = profile[k + 1][0] - profile[k][0], dy = profile[k + 1][1] - profile[k][1];
    const l = Math.hypot(dr, dy) || 1;
    en.push([dy / l, -dr / l]);
  }
  const vn: [number, number][] = [];
  for (let k = 0; k < np; k++) {
    const a = en[Math.max(0, k - 1)], c = en[Math.min(np - 2, k)];
    const x = a[0] + c[0], y = a[1] + c[1];
    const l = Math.hypot(x, y) || 1;
    vn.push([x / l, y / l]);
  }
  for (let k = 0; k < np - 1; k++) {
    const [r0, y0] = profile[k];
    const [r1, y1] = profile[k + 1];
    const na = opts.flatShade ? en[k] : vn[k];
    const nb = opts.flatShade ? en[k] : vn[k + 1];
    for (let i = 0; i < seg; i++) {
      const a0 = ph + (i / seg) * Math.PI * 2, a1 = ph + ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p00: V3 = [cx + c0 * r0, y0, cz + s0 * r0];
      const p10: V3 = [cx + c1 * r0, y0, cz + s1 * r0];
      const p01: V3 = [cx + c0 * r1, y1, cz + s0 * r1];
      const p11: V3 = [cx + c1 * r1, y1, cz + s1 * r1];
      const n00 = n3(c0 * na[0], na[1], s0 * na[0]);
      const n10 = n3(c1 * na[0], na[1], s1 * na[0]);
      const n01 = n3(c0 * nb[0], nb[1], s0 * nb[0]);
      const n11 = n3(c1 * nb[0], nb[1], s1 * nb[0]);
      if (outside) {
        if (r0 > 1e-4) b.triN(p00, p11, p10, n00, n11, n10);
        if (r1 > 1e-4) b.triN(p00, p01, p11, n00, n01, n11);
      }
      if (inside) {
        const f = (n: V3): V3 => [-n[0], -n[1], -n[2]];
        if (r0 > 1e-4) b.triN(p00, p10, p11, f(n00), f(n10), f(n11));
        if (r1 > 1e-4) b.triN(p00, p11, p01, f(n00), f(n11), f(n01));
      }
    }
  }
}

/** Disc cap (upward) at height y, seg tris. */
export function disc(b: ModelBuilder, cx: number, cz: number, y: number, r: number, seg: number, down = false): void {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0: V3 = [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r];
    const p1: V3 = [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r];
    if (down) b.tri([cx, y, cz], p0, p1);
    else b.tri([cx, y, cz], p1, p0);
  }
}

/** Upright cylinder side only (2*seg tris), smooth. */
export function tube(b: ModelBuilder, cx: number, cz: number, y0: number, h: number, r0: number, r1 = r0, seg = 10): void {
  lathe(b, cx, cz, [[r0, y0], [r1, y0 + h]], seg);
}

/** Smooth cone without degenerate tris (seg tris). */
export function cone(b: ModelBuilder, cx: number, cz: number, y0: number, h: number, r: number, seg = 10): void {
  lathe(b, cx, cz, [[r, y0], [0, y0 + h]], seg);
}

/** Double cone "crown" (2*seg tris): widest at y, rising hUp and dropping hDn. */
export function bicone(b: ModelBuilder, cx: number, y: number, cz: number, r: number, hUp: number, hDn: number, seg = 6, phase = 0): void {
  lathe(b, cx, cz, [[0, y - hDn], [r, y], [0, y + hUp]], seg, { phase });
}

/** Hemispherical / elliptic dome: rings * seg * 2 tris (top fan = seg). */
export function dome(b: ModelBuilder, cx: number, cz: number, y0: number, r: number, hy = r, seg = 12, rings = 3): void {
  const prof: [number, number][] = [];
  for (let k = 0; k <= rings; k++) {
    const t = (k / rings) * (Math.PI / 2);
    prof.push([Math.cos(t) * r, y0 + Math.sin(t) * hy]);
  }
  prof[rings][0] = 0;
  lathe(b, cx, cz, prof, seg);
}

/** Sphere via lathe (rings along latitude). */
export function sphereL(b: ModelBuilder, cx: number, cy: number, cz: number, r: number, seg = 12, rings = 6): void {
  const prof: [number, number][] = [];
  for (let k = 0; k <= rings; k++) {
    const t = -Math.PI / 2 + (k / rings) * Math.PI;
    prof.push([Math.cos(t) * r, cy + Math.sin(t) * r]);
  }
  prof[0][0] = 0;
  prof[rings][0] = 0;
  lathe(b, cx, cz, prof, seg);
}

/** Horizontal cylinder along X or Z (side + 2 caps). */
export function hCyl(b: ModelBuilder, cx: number, cy: number, cz: number, len: number, r: number, axis: 'x' | 'z', seg = 8, caps = true): void {
  const half = len / 2;
  const a: V3 = axis === 'x' ? [cx - half, cy, cz] : [cx, cy, cz - half];
  const c: V3 = axis === 'x' ? [cx + half, cy, cz] : [cx, cy, cz + half];
  b.pipe(a, c, r, seg);
  if (caps) {
    // caps as fans
    for (const [p, s] of [[a, -1], [c, 1]] as [V3, number][]) {
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
        if (axis === 'x') {
          const q0: V3 = [p[0], p[1] + Math.cos(t0) * r, p[2] + Math.sin(t0) * r];
          const q1: V3 = [p[0], p[1] + Math.cos(t1) * r, p[2] + Math.sin(t1) * r];
          if (s > 0) b.tri(p, q0, q1); else b.tri(p, q1, q0);
        } else {
          const q0: V3 = [p[0] + Math.cos(t0) * r, p[1] + Math.sin(t0) * r, p[2]];
          const q1: V3 = [p[0] + Math.cos(t1) * r, p[1] + Math.sin(t1) * r, p[2]];
          if (s > 0) b.tri(p, q0, q1); else b.tri(p, q1, q0);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Struts / lattice / pipes
// ---------------------------------------------------------------------------------------------------------------
/** Thin triangular-section strut between two points (6 tris). */
export function strut(b: ModelBuilder, a: V3, c: V3, t: number): void {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) return;
  const d: V3 = [dx / len, dy / len, dz / len];
  // pick helper axis
  const hlp: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u: V3 = [d[1] * hlp[2] - d[2] * hlp[1], d[2] * hlp[0] - d[0] * hlp[2], d[0] * hlp[1] - d[1] * hlp[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v: V3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const r = t * 0.62;
  const off: V3[] = [0, 1, 2].map((k) => {
    const ang = (k / 3) * Math.PI * 2 + Math.PI / 2;
    const cs = Math.cos(ang) * r, sn = Math.sin(ang) * r;
    return [u[0] * cs + v[0] * sn, u[1] * cs + v[1] * sn, u[2] * cs + v[2] * sn] as V3;
  });
  for (let k = 0; k < 3; k++) {
    const o0 = off[k], o1 = off[(k + 1) % 3];
    const a0: V3 = [a[0] + o0[0], a[1] + o0[1], a[2] + o0[2]];
    const a1: V3 = [a[0] + o1[0], a[1] + o1[1], a[2] + o1[2]];
    const c0: V3 = [c[0] + o0[0], c[1] + o0[1], c[2] + o0[2]];
    const c1: V3 = [c[0] + o1[0], c[1] + o1[1], c[2] + o1[2]];
    b.quad(a0, a1, c1, c0);
  }
}

/** Pipe run through points (round pipes, seg sides). Optional support posts down to y=0 at every vertex. */
export function pipeRun(b: ModelBuilder, pts: V3[], r: number, seg = 6, supports = false): void {
  for (let i = 0; i < pts.length - 1; i++) b.pipe(pts[i], pts[i + 1], r, seg);
  if (supports) for (const p of pts) if (p[1] > r * 2) strut(b, [p[0], 0, p[2]], [p[0], p[1] - r, p[2]], Math.max(0.15, r * 0.8));
}

/**
 * Tapered 4-leg lattice section (legs + horizontal rings + zig-zag diagonals).
 * hw0/hw1 = half-widths at bottom/top along x, hd0/hd1 along z. Tris ~ 6 * (4 + 8*panels).
 */
export function lattice(b: ModelBuilder, cx: number, cz: number, y0: number, y1: number, hw0: number, hw1: number, hd0: number, hd1: number, panels: number, t: number, opts: { rings?: boolean; diag?: boolean; faces?: Face[] } = {}): void {
  const rings = opts.rings ?? true, diag = opts.diag ?? true;
  const faces = opts.faces ?? ['pz', 'nz', 'px', 'nx'];
  const P = (k: number, sx: number, sz: number): V3 => {
    const f = k / panels;
    const hw = hw0 + (hw1 - hw0) * f, hd = hd0 + (hd1 - hd0) * f;
    return [cx + sx * hw, y0 + (y1 - y0) * f, cz + sz * hd];
  };
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) strut(b, P(0, sx, sz), P(panels, sx, sz), t * 1.4);
  for (let k = 0; k < panels; k++) {
    for (const f of faces) {
      const [sa, sb]: [[number, number], [number, number]] =
        f === 'pz' ? [[-1, 1], [1, 1]] : f === 'nz' ? [[1, -1], [-1, -1]] : f === 'px' ? [[1, 1], [1, -1]] : [[-1, -1], [-1, 1]];
      if (rings && k > 0) strut(b, P(k, sa[0], sa[1]), P(k, sb[0], sb[1]), t);
      if (diag) {
        if (k % 2 === 0) strut(b, P(k, sa[0], sa[1]), P(k + 1, sb[0], sb[1]), t * 0.8);
        else strut(b, P(k, sb[0], sb[1]), P(k + 1, sa[0], sa[1]), t * 0.8);
      }
    }
  }
  if (rings) for (const f of faces) {
    const [sa, sb]: [[number, number], [number, number]] =
      f === 'pz' ? [[-1, 1], [1, 1]] : f === 'nz' ? [[1, -1], [-1, -1]] : f === 'px' ? [[1, 1], [1, -1]] : [[-1, -1], [-1, 1]];
    strut(b, P(panels, sa[0], sa[1]), P(panels, sb[0], sb[1]), t);
  }
}

/**
 * Box oriented from point a to point c (length axis), width w (horizontal, perpendicular), height h (above the axis line).
 * Used for conveyors, inclined galleries, booms. 10 tris (no bottom) unless bottom=true.
 */
export function orientedBox(b: ModelBuilder, a: V3, c: V3, w: number, h: number, bottom = true): void {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
  const hl = Math.hypot(dx, dz);
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) return;
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(dy, hl);
  b.push().translate(a[0], a[1], a[2]).rotateY(yaw).rotateX(-pitch);
  b.box(-w / 2, 0, 0, w / 2, h, len);
  if (bottom) b.quad([-w / 2, 0, 0], [w / 2, 0, 0], [w / 2, 0, len], [-w / 2, 0, len]);
  b.pop();
}

/** Covered conveyor gallery from a to c with support trestles. */
export function conveyor(b: ModelBuilder, a: V3, c: V3, w: number, color: ColorLike, supportColor: ColorLike = PALETTE.metalDark, supports = 3): void {
  b.paint(color, Surf.Corrugated);
  orientedBox(b, a, c, w, w * 0.8);
  b.paint(supportColor, Surf.Metal);
  for (let i = 1; i <= supports; i++) {
    const t = i / (supports + 1);
    const p: V3 = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
    if (p[1] < 1.5) continue;
    const dx = c[0] - a[0], dz = c[2] - a[2];
    const l = Math.hypot(dx, dz) || 1;
    const px = (-dz / l) * w * 0.45, pz = (dx / l) * w * 0.45;
    strut(b, [p[0] + px, 0, p[2] + pz], [p[0] + px, p[1], p[2] + pz], 0.35);
    strut(b, [p[0] - px, 0, p[2] - pz], [p[0] - px, p[1], p[2] - pz], 0.35);
    strut(b, [p[0] + px, p[1] * 0.5, p[2] + pz], [p[0] - px, p[1] * 0.5, p[2] - pz], 0.25);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tanks & stacks
// ---------------------------------------------------------------------------------------------------------------
export interface TankOpts {
  seg?: number;
  roof?: 'cone' | 'dome' | 'flat';
  roofColor?: ColorLike;
  y0?: number;
  surf?: Surf;
  /** darker band at bottom (grime / foundation) */
  base?: ColorLike | null;
  /** spiral stair (true) or ladder (false) */
  stair?: boolean;
  /** ring stiffener color (null = none) */
  rim?: ColorLike | null;
  /** Plain shells only: warm floodlit shell at night (lit from the yard below), light reach in m (0 = unlit) */
  flood?: number;
  /** with `stair`: dim sodium stair lights up the ladder (every ~6 m) / along the spiral stair (2), 4 tris each */
  stairLights?: boolean;
}
/** Vertical storage tank. Returns the top center point. */
export function tank(b: ModelBuilder, x: number, z: number, r: number, h: number, color: ColorLike, o: TankOpts = {}): V3 {
  const seg = o.seg ?? 12;
  const y0 = o.y0 ?? 0;
  const surf = o.surf ?? Surf.Plain;
  const baseH = o.base ? Math.min(1.2, h * 0.12) : 0;
  if (o.base) {
    b.paint(o.base, Surf.Plain);
    tube(b, x, z, y0, baseH, r + 0.15, r + 0.15, seg);
    b.paint(o.base, Surf.Plain);
    disc(b, x, z, y0 + baseH, r + 0.15, seg);
  }
  if (o.flood && surf === Surf.Plain) b.paint(color, surf, 1, o.flood);
  else b.paint(color, surf);
  tube(b, x, z, y0 + baseH, h - baseH, r, r, seg);
  const yt = y0 + h;
  const rc = o.roofColor ?? color;
  let top = yt;
  if ((o.roof ?? 'cone') === 'cone') {
    b.paint(rc, surf);
    const ch = r * 0.18;
    cone(b, x, z, yt, ch, r, seg);
    top = yt + ch;
  } else if (o.roof === 'dome') {
    b.paint(rc, surf);
    dome(b, x, z, yt, r, r * 0.35, seg, 2);
    top = yt + r * 0.35;
  } else {
    b.paint(rc, surf);
    disc(b, x, z, yt, r, seg);
  }
  if (o.rim) {
    b.paint(o.rim, Surf.Metal);
    tube(b, x, z, yt - 0.35, 0.35, r + 0.12, r + 0.12, seg);
  }
  if (o.stair !== undefined) {
    b.paint(0x4a4d50, Surf.Metal);
    if (o.stair) {
      // helical stair: 5 segments, a quarter turn in total per ~h
      const n = 5;
      const a0 = Math.PI * 0.15;
      let prev: V3 | null = null;
      for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * Math.PI * 0.9;
        const p: V3 = [x + Math.cos(a) * (r + 0.4), y0 + (h * i) / n, z + Math.sin(a) * (r + 0.4)];
        if (prev) strut(b, prev, p, 0.35);
        prev = p;
      }
      if (o.stairLights) {
        for (const i of [2, 4]) {
          const a = a0 + (i / n) * Math.PI * 0.9;
          lightDot(b, x + Math.cos(a) * (r + 0.75), y0 + (h * i) / n + 1.0, z + Math.sin(a) * (r + 0.75), 0.3, SODIUM, 2);
        }
      }
    } else {
      strut(b, [x + r + 0.25, y0, z], [x + r + 0.25, yt + 0.6, z], 0.3);
      if (o.stairLights) stairLights(b, x + r + 0.6, z, y0, yt);
    }
    if (o.stairLights) b.paint(0x4a4d50, Surf.Metal);
  }
  return [x, top, z];
}

/** Spherical pressure tank on legs. Returns top point. */
export function sphereTank(b: ModelBuilder, x: number, z: number, r: number, color: ColorLike, legColor: ColorLike = 0x6a6e72, seg = 12, rings = 7, flood = 0): V3 {
  const cy = r * 1.1 + 0.8;
  if (flood > 0) b.paint(color, Surf.Plain, 1, flood);
  else b.paint(color, Surf.Plain);
  sphereL(b, x, cy, z, r, seg, rings);
  b.paint(legColor, Surf.Metal);
  const legs = 6;
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * Math.PI * 2 + 0.3;
    const lx = x + Math.cos(a) * r * 0.92, lz = z + Math.sin(a) * r * 0.92;
    strut(b, [lx, 0, lz], [lx, cy, lz], 0.5);
  }
  // equator walkway ring + stair
  b.paint(0x55585c, Surf.Metal);
  tube(b, x, z, cy - 0.15, 0.3, r + 0.35, r + 0.35, seg);
  strut(b, [x + r + 1.2, 0, z - 1.5], [x + r + 0.4, cy, z + 1.5], 0.4);
  return [x, cy + r, z];
}

export type StackStyle = 'redwhite' | 'concrete' | 'brick' | 'steel' | 'white';
/**
 * Smokestack: tapered shaft with style-specific bands, sooty rim, dark flue and a red aviation light.
 * Registers a smoke emitter at the top unless noSmoke. Returns the top center.
 */
export function smokestack(b: ModelBuilder, x: number, z: number, h: number, r0: number, r1: number, style: StackStyle, seg = 10, o: { y0?: number; noSmoke?: boolean; light?: boolean } = {}): V3 {
  const y0 = o.y0 ?? 0;
  const R = (y: number) => r0 + (r1 - r0) * ((y - y0) / h);
  const seg3 = (ya: number, yb: number, color: ColorLike, surf: Surf) => {
    b.paint(color, surf);
    tube(b, x, z, ya, yb - ya, R(ya), R(yb), seg);
  };
  const top = y0 + h;
  switch (style) {
    case 'redwhite': {
      const bandStart = y0 + h * 0.55;
      seg3(y0, bandStart, 0xd9d6cf, Surf.Plain);
      const n = 5;
      const bh = (top - 0.8 - bandStart) / n;
      for (let i = 0; i < n; i++) seg3(bandStart + i * bh, bandStart + (i + 1) * bh, i % 2 === 0 ? 0xc0392b : 0xf0eeea, Surf.Plain);
      seg3(top - 0.8, top, 0x2a2624, Surf.Plain);
      break;
    }
    case 'concrete': {
      seg3(y0, top - h * 0.12, 0xbdb8ae, Surf.Plain);
      seg3(top - h * 0.12, top - 0.8, 0x8e8a84, Surf.Plain);
      seg3(top - 0.8, top, 0x2c2a28, Surf.Plain);
      break;
    }
    case 'brick': {
      seg3(y0, y0 + 1.2, 0x6e6a64, Surf.Stone);
      seg3(y0 + 1.2, top - 2.2, 0x8a4634, Surf.Brick);
      seg3(top - 2.2, top - 1.4, 0x5a3024, Surf.Brick);
      seg3(top - 1.4, top, 0x2b2320, Surf.Brick);
      break;
    }
    case 'steel': {
      seg3(y0, top - 1.0, 0x8d9296, Surf.Metal);
      seg3(top - 1.0, top, 0x2e2e2e, Surf.Metal);
      break;
    }
    case 'white': {
      seg3(y0, top - 3, 0xeeeeea, Surf.Plain);
      seg3(top - 3, top - 2.2, 0x9aa0a6, Surf.Metal);
      seg3(top - 2.2, top, 0xeeeeea, Surf.Plain);
      break;
    }
  }
  // dark flue opening
  b.paint(0x141210, Surf.Plain);
  disc(b, x, z, top - 0.02, R(top) * 0.98, seg);
  if (o.light ?? h > 25) {
    b.paint(0xff2a1a, Surf.Emissive).boxC(x + R(top) + 0.15, z, 0.35, 0.35, top - 0.6, 0.35);
    b.boxC(x - R(top) - 0.15, z, 0.35, 0.35, top - 0.6, 0.35);
  }
  if (!o.noSmoke) emitSmoke([x, top + 0.5, z]);
  b.paint(RESET_PAINT, Surf.Metal);
  return [x, top, z];
}

// ---------------------------------------------------------------------------------------------------------------
// Vehicles & props (cheap)
// ---------------------------------------------------------------------------------------------------------------
export const TRUCK_COLORS = [0xf2f2ee, 0xc0392b, 0x2e6fb5, 0x2b2d31, 0xe67e22, 0x3d7a3d, 0xd9a324, 0x6e7479];
export const CAR_COLORS2 = [0xb8bcc2, 0x2b2d31, 0xf1f1ef, 0x8a1c1c, 0x1f3f7a, 0x5d6b73, 0x3e5e3a, 0xc9a13b, 0x6b2f4a, 0xd96b2b, 0xe0e0dc, 0x4a4f55];

/** Very cheap parked car (20 tris). rot = 0 faces +Z. */
export function carLow(b: ModelBuilder, x: number, z: number, rot: number, color: ColorLike, y = Y_OVER): void {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(color, Surf.Metal, 2).box(-0.9, 0.12, -2.25, 0.9, 0.85, 2.25);
  b.paint(0x1d232a, Surf.GlassPlain, 1).box(-0.8, 0.85, -1.15, 0.8, 1.38, 0.95, { top: { color, surf: Surf.Metal, pattern: 2 } });
  b.pop();
}

/** Semi truck (tractor + optional 13.6 m trailer), ~40 tris. Local +Z = front of the cab. rot rotates around (x,z). Origin = trailer rear at z-8.2. */
export function semi(b: ModelBuilder, x: number, z: number, rot: number, cab: ColorLike, trailer: ColorLike | null, o: { tractor?: boolean; stripe?: ColorLike } = {}): void {
  b.push().translate(x, 0.05, z).rotateY(rot);
  if (trailer !== null) {
    b.paint(trailer, Surf.Plain).box(-1.27, 1.3, -8.2, 1.27, 4.0, 5.4);
    if (o.stripe !== undefined) {
      b.paint(o.stripe, Surf.Plain);
      wallQuad(b, 'px', 1.27, -7.6, 4.8, 2.1, 2.9);
      wallQuad(b, 'nx', -1.27, -7.6, 4.8, 2.1, 2.9);
    }
    b.paint(0x1e1e1e, Surf.Metal, 1).box(-1.15, 0.0, -8.0, 1.15, 1.3, -4.8, { top: null });
    if (!(o.tractor ?? true)) b.paint(0x333333, Surf.Metal, 1).box(-0.9, 0, 3.4, 0.9, 1.3, 3.7, { top: null, pz: null, nz: null });
  }
  if (o.tractor ?? true) {
    b.paint(0x202020, Surf.Metal, 1).box(-1.15, 0.0, 4.4, 1.15, 1.25, 8.4, { top: null });
    b.paint(cab, Surf.Metal, 1).box(-1.25, 1.25, 6.1, 1.25, 3.7, 8.5);
    b.paint(0x1a2027, Surf.GlassPlain, 1);
    wallQuad(b, 'pz', 8.5, -1.1, 1.1, 2.3, 3.4);
  }
  b.pop();
}

/** Box truck ~8 m (~30 tris). */
export function boxTruck(b: ModelBuilder, x: number, z: number, rot: number, cab: ColorLike, boxColor: ColorLike): void {
  b.push().translate(x, 0.05, z).rotateY(rot);
  b.paint(0x202020, Surf.Metal, 1).box(-1.1, 0, -4, 1.1, 0.9, 4, { top: null });
  b.paint(boxColor, Surf.Plain).box(-1.25, 0.9, -4, 1.25, 3.5, 1.8);
  b.paint(cab, Surf.Metal, 1).box(-1.2, 0.9, 2.0, 1.2, 2.9, 4.0);
  b.paint(0x1a2027, Surf.GlassPlain, 1);
  wallQuad(b, 'pz', 4.0, -1.05, 1.05, 1.9, 2.7);
  b.pop();
}

/** Farm tractor (~75 tris). */
export function tractor(b: ModelBuilder, x: number, z: number, rot: number, color: ColorLike): void {
  b.push().translate(x, 0.05, z).rotateY(rot);
  b.paint(0x1c1c1c, Surf.Plain);
  hCyl(b, 0, 0.8, -0.9, 2.3, 0.8, 'x', 7);
  hCyl(b, 0, 0.45, 1.35, 1.7, 0.45, 'x', 6);
  b.paint(color, Surf.Metal, 1).box(-0.5, 0.6, -0.4, 0.5, 1.35, 2.0);
  b.paint(color, Surf.Metal, 1).box(-1.2, 1.55, -1.5, 1.2, 1.7, -0.3, { bottom: null });
  b.paint(0x2a3138, Surf.GlassPlain, 1).box(-0.65, 1.35, -1.35, 0.65, 2.7, -0.35, { top: { color: 0xe8e8e8, surf: Surf.Metal, pattern: 1 } });
  b.paint(0x333333, Surf.Metal);
  strut(b, [0.3, 1.35, 1.6], [0.3, 2.5, 1.6], 0.12);
  b.pop();
}

/** Forklift (~30 tris). */
export function forklift(b: ModelBuilder, x: number, z: number, rot: number, color: ColorLike = 0xf1c40f): void {
  b.push().translate(x, 0.05, z).rotateY(rot);
  b.paint(color, Surf.Metal, 1).box(-0.55, 0.15, -1.0, 0.55, 1.1, 0.8);
  b.paint(0x222222, Surf.Metal, 1).box(-0.5, 1.1, -0.9, 0.5, 2.1, 0.3, { nz: null, px: null, nx: null, pz: null });
  strut(b, [-0.45, 1.1, 0.3], [-0.45, 2.1, 0.3], 0.1);
  strut(b, [0.45, 1.1, 0.3], [0.45, 2.1, 0.3], 0.1);
  b.box(-0.5, 0, 0.8, 0.5, 2.3, 0.9, { top: null, nx: null, px: null });
  b.box(-0.45, 0.05, 0.9, 0.45, 0.12, 2.0, { bottom: null, nz: null });
  b.pop();
}

/** Stack of pallets (10 tris). */
export function pallets(b: ModelBuilder, x: number, z: number, h: number, color: ColorLike = 0x9a7a4e): void {
  b.paint(color, Surf.Wood).boxC(x, z, 1.2, 1.0, 0, h);
}

/** Cluster of drums (oil barrels) in a small grid: n drums, 5-sided (15 tris each). */
export function drums(b: ModelBuilder, rng: RNG, x: number, z: number, nx: number, nz: number, colors: ColorLike[]): void {
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      if (rng.chance(0.15)) continue;
      b.paint(rng.pick(colors), Surf.Metal, 1);
      const px = x + i * 0.7, pz = z + j * 0.7;
      tube(b, px, pz, 0, 0.9, 0.3, 0.3, 5);
      disc(b, px, pz, 0.9, 0.3, 5);
    }
}

/** Shipping container 6 m or 12 m (10 tris) with optional door face color on -Z end. */
export function box10(b: ModelBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  b.box(x0, y0, z0, x1, y1, z1);
}

export const CONTAINER_COLORS = [0xb03a2e, 0x2e6fb5, 0xd9a324, 0x2f7f6f, 0x7a7a7a, 0xc8581f, 0x5b3f8a, 0x2f5f2f, 0xe9e7e0, 0x8a2f2f, 0x1f4f7f];

/** Shipping container along X (long=12.2 m) or rotated along Z. (10 tris) */
export function containerAt(b: ModelBuilder, x: number, y: number, z: number, long: boolean, color: ColorLike, alongZ = false): void {
  const L = long ? 12.2 : 6.1;
  b.paint(color, Surf.Corrugated);
  if (alongZ) b.box(x - 1.22, y, z - L / 2, x + 1.22, y + 2.6, z + L / 2);
  else b.box(x - L / 2, y, z - 1.22, x + L / 2, y + 2.6, z + 1.22);
  // door end, 8% darker
  b.paint(dim(color, 0.92), Surf.Plain);
  if (alongZ) wallQuad(b, 'nz', z - L / 2, x - 1.15, x + 1.15, y + 0.05, y + 2.55, 0.02);
  else wallQuad(b, 'nx', x - L / 2, z - 1.15, z + 1.15, y + 0.05, y + 2.55, 0.02);
}

// ---------------------------------------------------------------------------------------------------------------
// Greenery / fences / lights
// ---------------------------------------------------------------------------------------------------------------
export const TREE_GREENS = [0x4f7a32, 0x5a8a3a, 0x3f6b2e, 0x6b8f3a, 0x557f35];

/** Cheap round tree (trunk strut + jittered icosa blob crown, 26 tris). Crown radius r, total height ~h. */
export function tree(b: ModelBuilder, rng: RNG, x: number, z: number, h = 7, r = 2.4, color?: ColorLike): void {
  const s = rng.range(0.85, 1.12);
  const hh = h * s, rr = r * s;
  b.paint(PALETTE.trunk, Surf.Wood);
  strut(b, [x, 0, z], [x, hh * 0.5, z], 0.32 * s);
  b.paint(color ?? rng.pick(TREE_GREENS), Surf.Foliage);
  b.blob(x, hh - rr * 0.95, z, rr, rr * 0.95, rr, 0, 0.16, rng.next() * 10);
}

/** Tall columnar poplar / cypress (cheap). */
export function poplar(b: ModelBuilder, rng: RNG, x: number, z: number, h = 12): void {
  const s = rng.range(0.85, 1.15);
  b.paint(0x3f6b2e, Surf.Foliage);
  bicone(b, x, h * 0.35 * s, z, 1.5 * s, h * 0.65 * s, h * 0.3 * s, 5, rng.next() * 3);
}

/** Straight fence run: posts every `spacing` m + rails (triangular struts). */
export function fenceRun(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, h: number, color: ColorLike, spacing = 5, rails = 2, barbed = false): void {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / spacing));
  b.paint(color, Surf.Metal);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    strut(b, [x, 0, z], [x, h, z], 0.12);
  }
  for (let k = 0; k < rails; k++) {
    const y = rails === 1 ? h : h * (0.35 + (0.65 * k) / Math.max(1, rails - 1));
    strut(b, [ax, y, az], [bx, y, bz], 0.07);
  }
  if (barbed) strut(b, [ax, h + 0.35, az], [bx, h + 0.35, bz], 0.09);
}

/** Fence around a rect with an optional gap (gate) on the +Z side from gx0..gx1. */
export function fenceRect(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h: number, color: ColorLike, gate?: [number, number], spacing = 5, rails = 2, barbed = false): void {
  fenceRun(b, x0, z0, x1, z0, h, color, spacing, rails, barbed);
  fenceRun(b, x1, z0, x1, z1, h, color, spacing, rails, barbed);
  fenceRun(b, x0, z1, x0, z0, h, color, spacing, rails, barbed);
  if (gate) {
    if (gate[0] > x0 + 0.5) fenceRun(b, x0, z1, gate[0], z1, h, color, spacing, rails, barbed);
    if (gate[1] < x1 - 0.5) fenceRun(b, gate[1], z1, x1, z1, h, color, spacing, rails, barbed);
  } else fenceRun(b, x0, z1, x1, z1, h, color, spacing, rails, barbed);
}

/** Solid wall run (corrugated / concrete) as a thin box (10 tris). */
export function wallRun(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, h: number, color: ColorLike, surf = Surf.Corrugated, t = 0.15): void {
  b.paint(color, surf);
  if (Math.abs(az - bz) < 1e-3) b.box(Math.min(ax, bx), 0, az - t / 2, Math.max(ax, bx), h, az + t / 2);
  else b.box(ax - t / 2, 0, Math.min(az, bz), ax + t / 2, h, Math.max(az, bz));
}

/**
 * Yard flood light pole (emissive head), 16 tris. With `groundColor` it also lays an Emissive-9 light pool
 * (8-gon, r = 1.2 x pole height, 0.7 x ground color) that lights the pavement at night.
 */
export function floodLight(b: ModelBuilder, x: number, z: number, h = 9, groundColor: ColorLike | null = null, poolR = h * 1.2, clip?: [number, number, number, number], poolY = Y_POOL, head: ColorLike = 0xfff2d0): void {
  b.paint(0x3a3d40, Surf.Metal);
  strut(b, [x, 0, z], [x, h, z], 0.2);
  b.paint(head, Surf.Emissive, 6).boxC(x, z, 0.8, 0.4, h, 0.35, { bottom: { color: head, surf: Surf.Emissive, pattern: 6 } });
  if (groundColor !== null) {
    // keep the pool inside the lot (clip = [x0, z0, x1, z1]) by shifting its center inward
    let px = x, pz = z;
    if (clip) {
      px = Math.min(Math.max(px, clip[0] + poolR), clip[2] - poolR);
      pz = Math.min(Math.max(pz, clip[1] + poolR), clip[3] - poolR);
    }
    pool(b, px, pz, poolR, groundColor, poolY);
  }
  b.paint(RESET_PAINT, Surf.Metal);
}

/** Tiny omni-visible light point (tetrahedron, 4 tris): sodium / LED work lights that sparkle at night. */
export function lightDot(b: ModelBuilder, x: number, y: number, z: number, s = 0.3, color: ColorLike = 0xffd08a, pattern = 6): void {
  b.paint(color, Surf.Emissive, pattern);
  const t: V3 = [x, y + s, z];
  const p0: V3 = [x + s, y - s * 0.5, z], p1: V3 = [x - s * 0.5, y - s * 0.5, z + s * 0.87], p2: V3 = [x - s * 0.5, y - s * 0.5, z - s * 0.87];
  b.tri(t, p1, p0).tri(t, p2, p1).tri(t, p0, p2).tri(p0, p1, p2);
  b.paint(RESET_PAINT, Surf.Metal);
}

/** Light points spread over a set of positions. */
export function lights(b: ModelBuilder, pts: V3[], s = 0.3, color: ColorLike = 0xffd08a, pattern = 6): void {
  for (const p of pts) lightDot(b, p[0], p[1], p[2], s, color, pattern);
  b.paint(RESET_PAINT, Surf.Metal);
}

/** High-pressure sodium lamp colour for industrial yard / platform lights. */
export const SODIUM = 0xffb060;

/**
 * Stair / platform lights up a column or tank ladder: a small dim sodium point (4 tris, Emissive pattern 2) every
 * `step` m from y0 + step up to y1 (a lit stair tower at night). Returns the number of lights.
 */
export function stairLights(b: ModelBuilder, x: number, z: number, y0: number, y1: number, step = 6, s = 0.3, color: ColorLike = SODIUM): number {
  let n = 0;
  for (let y = y0 + step; y <= y1 + 0.01; y += step, n++) lightDot(b, x, y, z, s, color, 2);
  b.paint(RESET_PAINT, Surf.Metal);
  return n;
}

/** Security light posts along a straight run every `spacing` m: pole + cool LED dot + Emissive-9 pool. */
export function securityLights(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, spacing: number, groundColor: ColorLike, h = 6, inward: [number, number] = [0, 0]): void {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / spacing));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    b.paint(0x55595e, Surf.Metal);
    strut(b, [x, 0, z], [x, h, z], 0.14);
    lightDot(b, x + inward[0] * 0.4, h, z + inward[1] * 0.4, 0.28, 0xe8f0ff);
    pool(b, x + inward[0] * 3.2, z + inward[1] * 3.2, 3.6, groundColor);
  }
}

/** Rooftop AC / condenser box (12 tris). */
export function roofUnit(b: ModelBuilder, x: number, y: number, z: number, w: number, d: number, h: number, color: ColorLike = 0xb4b8bc): void {
  b.paint(color, Surf.Metal).box(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2);
  b.paint(0x2e3134, Surf.Metal);
  const r = Math.min(w, d) * 0.3;
  flat(b, x - r, z - r, x + r, z + r, y + h + 0.02);
}

/** Parapet ring around a flat roof rect (4 thin boxes without bottoms, 32 tris). */
export function parapet(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h = 0.8, t = 0.3, color: ColorLike = PALETTE.concreteDark): void {
  b.paint(color, Surf.Plain);
  b.box(x0, y, z0, x1, y + h, z0 + t, { bottom: null });
  b.box(x0, y, z1 - t, x1, y + h, z1, { bottom: null });
  b.box(x0, y, z0 + t, x0 + t, y + h, z1 - t, { bottom: null, pz: null, nz: null });
  b.box(x1 - t, y, z0 + t, x1, y + h, z1 - t, { bottom: null, pz: null, nz: null });
}

/** Parking lot with stall lines (2 tris per line) and cheap cars. Stalls along X; rows alternate facing. */
export function parking(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, fill = 0.6, maxCars = 40): void {
  b.paint(PALETTE.asphalt, Surf.Pavement);
  flat(b, x0, z0, x1, z1, Y_OVER);
  const stallW = 2.7, stallD = 5.2, aisle = 6.0;
  let cars = 0;
  const rowPitch = stallD * 2 + aisle;
  for (let rz = z0 + 0.5; rz + stallD <= z1 - 0.3; rz += rowPitch) {
    for (const [zA, facing] of [[rz, 0], [rz + stallD + aisle, Math.PI]] as [number, number][]) {
      if (zA + stallD > z1 - 0.3) continue;
      b.paint(0xe8e8e0, Surf.Plain);
      const nSt = Math.floor((x1 - x0 - 0.8) / stallW);
      for (let s = 0; s <= nSt; s++) {
        const sx = x0 + 0.4 + s * stallW;
        flat(b, sx - 0.07, zA, sx + 0.07, zA + stallD, Y_MARK);
      }
      for (let s = 0; s < nSt; s++) {
        if (cars < maxCars && rng.chance(fill)) {
          carLow(b, x0 + 0.4 + s * stallW + stallW / 2, zA + stallD / 2, facing, rng.pick(CAR_COLORS2), Y_OVER);
          cars++;
        }
      }
    }
  }
}

/** Irregular heap (pile) as a jittered low cone/lathe: seg * 2 * rings tris. */
export function heap(b: ModelBuilder, rng: RNG, x: number, z: number, r: number, h: number, color: ColorLike, surf = Surf.Plain, seg = 8, sx = 1, sz = 1): void {
  // two-ring jittered mound built from explicit tris (so it can be squashed)
  const ring = (rad: number, y: number, jit: number): V3[] => {
    const pts: V3[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const k = 1 + (rng.next() - 0.5) * jit;
      pts.push([x + Math.cos(a) * rad * k * sx, y, z + Math.sin(a) * rad * k * sz]);
    }
    return pts;
  };
  const r0 = ring(r, 0, 0.35);
  const r1 = ring(r * 0.55, h * 0.72, 0.5);
  const apex: V3 = [x + (rng.next() - 0.5) * r * 0.3, h, z + (rng.next() - 0.5) * r * 0.3];
  b.paint(color, surf);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    b.quad(r0[i], r1[i], r1[j], r0[j]);
    b.tri(r1[i], apex, r1[j]);
  }
}

/** Low gable/barrel metal roof helper: barrel vault along X over rect (seg segments), with end walls. */
export function barrelRoof(b: ModelBuilder, cx: number, cz: number, w: number, d: number, y0: number, rise: number, seg = 6, endColor?: ColorLike): void {
  const half = d / 2;
  const pts: [number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const zz = -half + d * t;
    const yy = y0 + rise * (1 - Math.pow((zz / half), 2));
    pts.push([cz + zz, yy]);
  }
  const x0 = cx - w / 2, x1 = cx + w / 2;
  for (let i = 0; i < seg; i++) {
    const [za, ya] = pts[i], [zb, yb] = pts[i + 1];
    b.quad([x0, yb, zb], [x1, yb, zb], [x1, ya, za], [x0, ya, za]);
  }
  if (endColor !== undefined) b.paint(endColor, Surf.Plain);
  for (let i = 0; i < seg; i++) {
    const [za, ya] = pts[i], [zb, yb] = pts[i + 1];
    b.quad([x1, y0, za], [x1, y0, zb], [x1, yb, zb], [x1, ya, za]);
    b.quad([x0, y0, zb], [x0, y0, za], [x0, ya, za], [x0, yb, zb]);
  }
}

/**
 * Gambrel (barn) roof with ridge along Z (gable ends face ±Z). y0 = wall top. Returns ridge height.
 */
export function gambrelRoof(b: ModelBuilder, cx: number, cz: number, w: number, d: number, y0: number, h1: number, h2: number, gable: ColorLike, gableSurf = Surf.Wood, oh = 0.5): number {
  const hw = w / 2 + oh;
  const xk = w * 0.3;
  const z0 = cz - d / 2 - oh * 0.6, z1 = cz + d / 2 + oh * 0.6;
  const yk = y0 + h1, yr = y0 + h1 + h2;
  const ye = y0 - 0.25;
  const prof: [number, number][] = [[-hw, ye], [-xk, yk], [0, yr], [xk, yk], [hw, ye]];
  for (let i = 0; i < prof.length - 1; i++) {
    const [xa, ya] = prof[i], [xb, yb] = prof[i + 1];
    b.quad([cx + xa, ya, z1], [cx + xb, yb, z1], [cx + xb, yb, z0], [cx + xa, ya, z0]);
  }
  // gable pentagons at wall planes
  b.paint(gable, gableSurf);
  const gz1 = cz + d / 2, gz0 = cz - d / 2, gw = w / 2;
  const gp: [number, number][] = [[-gw, y0], [gw, y0], [xk, yk], [0, yr], [-xk, yk]];
  // front (+Z)
  b.tri([cx + gp[0][0], gp[0][1], gz1], [cx + gp[1][0], gp[1][1], gz1], [cx + gp[2][0], gp[2][1], gz1]);
  b.tri([cx + gp[0][0], gp[0][1], gz1], [cx + gp[2][0], gp[2][1], gz1], [cx + gp[4][0], gp[4][1], gz1]);
  b.tri([cx + gp[4][0], gp[4][1], gz1], [cx + gp[2][0], gp[2][1], gz1], [cx + gp[3][0], gp[3][1], gz1]);
  // back (-Z) reversed
  b.tri([cx + gp[2][0], gp[2][1], gz0], [cx + gp[1][0], gp[1][1], gz0], [cx + gp[0][0], gp[0][1], gz0]);
  b.tri([cx + gp[4][0], gp[4][1], gz0], [cx + gp[2][0], gp[2][1], gz0], [cx + gp[0][0], gp[0][1], gz0]);
  b.tri([cx + gp[3][0], gp[3][1], gz0], [cx + gp[2][0], gp[2][1], gz0], [cx + gp[4][0], gp[4][1], gz0]);
  return yr;
}

/** Tilted solar panel row along X at center (cx,cz): width w along X, panel depth pd, tilt (rad), facing +Z (south). */
export function solarRow(b: ModelBuilder, cx: number, cz: number, w: number, pd: number, tilt: number, yLow: number, color: ColorLike = 0x1d2a44, surf = Surf.GlassCurtain, pattern = 3, legs = true): void {
  const dz = Math.cos(tilt) * pd / 2, dy = Math.sin(tilt) * pd / 2;
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const yc = yLow + dy;
  b.paint(color, surf, pattern);
  // top face (tilted toward +Z)
  b.quad([x0, yc - dy, cz + dz], [x1, yc - dy, cz + dz], [x1, yc + dy, cz - dz], [x0, yc + dy, cz - dz]);
  // back face (frame)
  b.paint(0x8a9096, Surf.Metal);
  b.quad([x1, yc - dy - 0.06, cz + dz], [x0, yc - dy - 0.06, cz + dz], [x0, yc + dy - 0.06, cz - dz], [x1, yc + dy - 0.06, cz - dz]);
  if (legs) {
    const n = Math.max(2, Math.round(w / 8) + 1);
    for (let i = 0; i < n; i++) {
      const x = x0 + 0.4 + ((w - 0.8) * i) / (n - 1);
      strut(b, [x, 0, cz], [x, yc, cz], 0.14);
    }
  }
}

/** Office / admin block with window bands and entrance (flat roof). ~40 tris. */
export function officeBlock(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h: number, wall: ColorLike, pattern = 2, floor = 3.6, entranceFace: Face = 'pz', glassEntrance = true): void {
  b.paint(wall, Surf.WallWindows, pattern, floor).box(x0, 0, z0, x1, h, z1, { top: { color: 0x8e8b84, surf: Surf.RoofFlat } });
  b.paint(PALETTE.concreteDark, Surf.Plain);
  b.box(x0 - 0.05, h, z0 - 0.05, x1 + 0.05, h + 0.6, z0 + 0.25, { bottom: null });
  b.box(x0 - 0.05, h, z1 - 0.25, x1 + 0.05, h + 0.6, z1 + 0.05, { bottom: null });
  b.box(x0 - 0.05, h, z0 + 0.25, x0 + 0.25, h + 0.6, z1 - 0.25, { bottom: null, pz: null, nz: null });
  b.box(x1 - 0.25, h, z0 + 0.25, x1 + 0.05, h + 0.6, z1 - 0.25, { bottom: null, pz: null, nz: null });
  if (glassEntrance) {
    b.paint(0x2a3440, Surf.GlassPlain);
    if (entranceFace === 'pz') {
      const cx = (x0 + x1) / 2;
      wallQuad(b, 'pz', z1, cx - 1.8, cx + 1.8, 0.1, 3.0);
      b.paint(0xd8d8d4, Surf.Plain).box(cx - 2.4, 3.0, z1, cx + 2.4, 3.3, z1 + 1.8);
    } else if (entranceFace === 'px') {
      const cz = (z0 + z1) / 2;
      wallQuad(b, 'px', x1, cz - 1.8, cz + 1.8, 0.1, 3.0);
    }
  }
}
