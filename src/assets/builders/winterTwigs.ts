/**
 * Low-quality strip of the lot trees' winter twig crowns (seasons). The kit and park trees carry a bare winter crown
 * (park_lib twigCrown / bareCrown: Foliage pattern 5 twig sprays + limb blades of Wood pattern 5, BARE_WOOD, and the
 * inner trunks of tree clumps; their leaf lobes are painted with the swap marker, floor >= 1 on patterns 1-2) that the
 * vertex shader swaps in while the tree is bare (materials.ts, FOLIAGE_WINTER): all year these are submitted
 * triangles, hidden inside the leaf crowns. The low quality preset (weak machines) draws the lot models without the
 * twig sprays, and each bare crown on a plain trunk as a Y in the trunk's own triangles (stripWinterTwigs: the trunk
 * a spire up to the crown's leader tip + the crown's limbs), so its triangle counts are at most those of the models
 * without winter crowns (the limbs on top of the trunks would cost ~1% of the low preset's triangles). The crowns keep
 * their swap marker, so a bare crown still collapses as at the other qualities and leaves its forked trunk standing
 * (a bare tree in winter, no grey lump of a crown); a crown without a plain trunk under it keeps only its trunk.
 *
 * The forest renderer publishes the quality (setLotTwigStrip, TreeRenderer: low quality = no outer ring / edge band
 * either); the building renderer registers lot model geometry through lotTwigGeometry / lotTwigKey and rebuilds its
 * instances when `lotTwigs.version` changes (a quality switch at runtime). At every quality the registered geometry
 * also has its small raised plants (roof / terrace planters) marked LOW foliage (markLowPlants).
 */
import * as THREE from 'three';
import { Surf } from '../../core/types';

/** strip on (low quality) + a counter bumped on every change */
export const lotTwigs = { strip: false, version: 0 };

export function setLotTwigStrip(on: boolean): void {
  if (on === lotTwigs.strip) return;
  lotTwigs.strip = on;
  lotTwigs.version++;
}

/** pattern of the winter-only faces: Foliage twig sprays and Wood limbs / inner trunks (park_lib FOL_TWIG, BARE_WOOD) */
const WINTER = 5;

const _stripped = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry | null>();

type V = [number, number, number];
type Arr = ArrayLike<number>;

/** a limb blade of a bare crown (park_lib spike: two Wood pattern-5 faces on the same corners): its first face, its
 *  tip and the tip's horizontal reach from the crown's trunk axis */
interface Blade { t: number; tip: V; reach: number }
/** the blades on one base point: a bare crown, (x, y, z) = its trunk top */
interface Crown { x: number; y: number; z: number; blades: Blade[] }
/** a plain trunk found under a crown: n-sided frustum from y0 (corner radius d0) to y1, `faces` its side faces */
interface Trunk { faces: number[]; n: number; y0: number; a0: number; d0: number; bot: V; top: V }
/** the faces drawn instead of a trunk (emitted where its first face was): corner attribute values, `src` = a trunk
 *  face whose corner values any other attribute takes */
interface Spire { pos: number[]; nrm: number[]; col: number[]; srf: number[]; src: number }

/** faces a and b have the same three corners (in any order: mirrored models swap corners) */
function sameCorners(P: Arr, a: number, b: number): boolean {
  for (let i = 0; i < 3; i++) {
    const o = a * 9 + i * 3;
    let hit = false;
    for (let j = 0; j < 3 && !hit; j++) {
      const q = b * 9 + j * 3;
      hit = P[o] === P[q] && P[o + 1] === P[q + 1] && P[o + 2] === P[q + 2];
    }
    if (!hit) return false;
  }
  return true;
}

/** distinct corners on a ring (angles around the axis, merged within 1 mm of arc) */
function ringCorners(angles: number[], r: number): number {
  const a = angles.slice().sort((p, q) => p - q), tol = 1e-3 / r;
  let n = 1;
  for (let i = 1; i < a.length; i++) if (a[i] - a[i - 1] > tol) n++;
  if (n > 1 && a[0] + Math.PI * 2 - a[a.length - 1] <= tol) n--;
  return n;
}

/**
 * The plain trunk under crown `cr`: one connected set of Wood / Plain faces (birch bark is Plain) within 1 m of the
 * crown's axis whose corners all lie on two rings around that axis, the top ring at the crown's base (the trunk top,
 * up to 0.8 m above it): an n-sided frustum without caps (2n faces), as every kit / park tree trunk is
 * (ModelBuilder.cylinder top: false, com_kit's box trunk). Null when there is none or more than one (a crown left as
 * it is: the strip's bare pole).
 */
function findTrunk(P: Arr, C: Arr | null, grid: Map<number, number[]>, cr: Crown): Trunk | null {
  const near: number[] = [];
  const ix = Math.floor(cr.x / 2), iz = Math.floor(cr.z / 2);
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      for (const t of grid.get((ix + dx + 32768) * 65536 + iz + dz + 32768) ?? []) {
        let ok = true;
        for (let k = 0; k < 3 && ok; k++) {
          const o = t * 9 + k * 3;
          ok = Math.hypot(P[o] - cr.x, P[o + 2] - cr.z) <= 1 && P[o + 1] <= cr.y + 1;
        }
        if (ok) near.push(t);
      }
    }
  if (!near.length) return null;
  // connected sets (faces joined by corners, to 0.5 mm)
  const parent = near.map((_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const seen = new Map<string, number>();
  const q = (v: number) => Math.round(v * 2000);
  near.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3, key = `${q(P[o])},${q(P[o + 1])},${q(P[o + 2])}`;
      const j = seen.get(key);
      if (j === undefined) seen.set(key, i);
      else { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
    }
  });
  const sets = new Map<number, number[]>();
  near.forEach((t, i) => { const r = find(i); (sets.get(r) ?? sets.set(r, []).get(r)!).push(t); });
  let found: Trunk | null = null;
  for (const faces of sets.values()) {
    let y0 = Infinity, y1 = -Infinity;
    for (const t of faces) for (let k = 0; k < 3; k++) { const y = P[t * 9 + k * 3 + 1]; y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (y1 - y0 < 0.3 || y1 < cr.y - 0.05 || y1 > cr.y + 0.8) continue;
    const ab: number[] = [], at: number[] = [], db: number[] = [], dt: number[] = [];
    const bot: V = [0, 0, 0], top: V = [0, 0, 0];
    let ok = true;
    for (const t of faces)
      for (let k = 0; k < 3 && ok; k++) {
        const o = t * 9 + k * 3, x = P[o] - cr.x, z = P[o + 2] - cr.z, y = P[o + 1];
        const lo = Math.abs(y - y0) < 1e-3;
        if (!lo && Math.abs(y - y1) >= 1e-3) { ok = false; break; }
        (lo ? ab : at).push(Math.atan2(z, x));
        (lo ? db : dt).push(Math.hypot(x, z));
        const c = lo ? bot : top;
        if (C) { c[0] += C[o]; c[1] += C[o + 1]; c[2] += C[o + 2]; }
      }
    if (!ok || !ab.length || !at.length) continue;
    const d0 = db.reduce((s, d) => s + d, 0) / db.length, d1 = dt.reduce((s, d) => s + d, 0) / dt.length;
    if (d0 < 0.02 || d1 < 0.005 || db.some((d) => Math.abs(d - d0) > 2e-3) || dt.some((d) => Math.abs(d - d1) > 2e-3)) continue;
    const n = ringCorners(ab, d0);
    if (n < 3 || n > 16 || ringCorners(at, d1) !== n || faces.length !== 2 * n) continue;
    if (found) return null;
    for (let i = 0; i < 3; i++) { bot[i] /= ab.length; top[i] /= at.length; }
    found = { faces, n, y0, a0: ab[0], d0, bot: C ? bot : [1, 1, 1], top: C ? top : [1, 1, 1] };
  }
  return found;
}

/**
 * Bare crowns of the low-quality strip (see stripWinterTwigs): for each crown on a plain trunk, the trunk is drawn as a
 * 4-sided (3-sided) spire from its foot to the tip of the crown's leader (the blade reaching least far out, which
 * goes) and its limbs stay, as many as fit the trunk's own triangles (spire + 2 per limb <= the trunk's 2n; the
 * longest-reaching first): kit trees (2 limbs + a leader on a 5-sided trunk) 8 tris for 10, park trees (3 limbs) 10
 * for 10, com_kit's box trunk 8 for 8, ind_kit's 3-sided strut one limb, 6 for 6. The spire keeps the trunk's foot
 * width (the mean width of its n-gon), paint (surf) and colours (foot / top ring), with smooth normals. Updates `keep`
 * (trunk faces out, kept limb blades in) and returns the spires by the trunk's first face.
 */
function yCrowns(g: THREE.BufferGeometry, keep: Uint8Array, crowns: Crown[]): Map<number, Spire> {
  const P = (g.getAttribute('position') as THREE.BufferAttribute).array as Arr;
  const S = (g.getAttribute('surf') as THREE.BufferAttribute).array as Arr;
  const col = g.getAttribute('color') as THREE.BufferAttribute | undefined, C = col ? (col.array as Arr) : null;
  const spires = new Map<number, Spire>();
  // trunk candidates (kept Wood / Plain faces) by their first corner, 2 m cells
  const grid = new Map<number, number[]>();
  for (let t = 0; t < keep.length; t++) {
    const ty = Math.round(S[t * 9]);
    if (!keep[t] || (ty !== Surf.Wood && ty !== Surf.Plain)) continue;
    const k = (Math.floor(P[t * 9] / 2) + 32768) * 65536 + Math.floor(P[t * 9 + 2] / 2) + 32768;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(t);
  }
  for (const cr of crowns) {
    if (cr.blades.length < 2) continue;
    const tr = findTrunk(P, C, grid, cr);
    if (!tr || spires.has(tr.faces[0])) continue;
    const bl = cr.blades.slice().sort((a, b) => b.reach - a.reach);
    const lead = bl.pop()!, F = tr.faces.length;
    // as many limbs as fit beside the cheapest spire, the spire 4-sided when that still fits
    const k = Math.min(bl.length, Math.floor((F - 3) / 2)), np = 4 + 2 * k <= F ? 4 : 3;
    if (k < 1) continue;
    const apex = lead.tip;
    const R = (tr.d0 * tr.n * Math.sin(Math.PI / tr.n)) / (np * Math.sin(Math.PI / np));
    const slope = R / Math.max(apex[1] - tr.y0, 0.1);
    const s0 = tr.faces[0] * 9;
    const sp: Spire = { pos: [], nrm: [], col: [], srf: [], src: tr.faces[0] };
    const nrm = (a: number): V => { const l = Math.hypot(1, slope); return [Math.cos(a) / l, slope / l, Math.sin(a) / l]; };
    for (let i = 0; i < np; i++) {
      const a = tr.a0 + (i / np) * Math.PI * 2, b = tr.a0 + ((i + 1) / np) * Math.PI * 2, m = (a + b) / 2;
      const pa: V = [cr.x + Math.cos(a) * R, tr.y0, cr.z + Math.sin(a) * R], pb: V = [cr.x + Math.cos(b) * R, tr.y0, cr.z + Math.sin(b) * R];
      // corners in front-face order (counter-clockwise seen from outside, as the model's own faces)
      const ux = apex[0] - pa[0], uy = apex[1] - pa[1], uz = apex[2] - pa[2], vx = pb[0] - pa[0], vy = pb[1] - pa[1], vz = pb[2] - pa[2];
      const out = (uy * vz - uz * vy) * Math.cos(m) + (ux * vy - uy * vx) * Math.sin(m);
      const cs: [V, V, V][] = out >= 0 ? [[pa, nrm(a), tr.bot], [apex, nrm(m), tr.top], [pb, nrm(b), tr.bot]] : [[pa, nrm(a), tr.bot], [pb, nrm(b), tr.bot], [apex, nrm(m), tr.top]];
      for (const [p, n, c] of cs) {
        sp.pos.push(...p);
        sp.nrm.push(...n);
        sp.col.push(...c);
        sp.srf.push(S[s0], S[s0 + 1], S[s0 + 2]);
      }
    }
    for (const f of tr.faces) keep[f] = 0;
    for (let i = 0; i < k; i++) keep[bl[i].t] = keep[bl[i].t + 1] = 1;
    spires.set(tr.faces[0], sp);
  }
  return spires;
}

/**
 * `g` (a non-indexed lot model: position / normal / color / surf, see ModelBuilder.build) as drawn at low quality:
 * without its twig sprays (Foliage pattern 5) and its winter-only wood (Wood pattern 5: clump inner trunks, the blades
 * of crowns without a plain trunk), each bare crown on a plain trunk a Y (yCrowns: trunk spire + limbs in the trunk's
 * own triangles), so it has at most the triangles of the model without winter crowns; null when it has no pattern-5
 * faces (cached per geometry).
 */
export function stripWinterTwigs(g: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const hit = _stripped.get(g);
  if (hit !== undefined) return hit;
  const srf = g.getAttribute('surf') as THREE.BufferAttribute | undefined;
  const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  let out: THREE.BufferGeometry | null = null;
  if (srf && pos && !g.index) {
    const S = srf.array as Arr, P = pos.array as Arr, tris = srf.count / 3;
    const type = (t: number) => Math.round(S[t * 9]);
    const winter = (t: number) => Math.abs(S[t * 9 + 1] - WINTER) < 0.5 && (type(t) === Surf.Foliage || type(t) === Surf.Wood);
    const keep = new Uint8Array(tris).fill(1);
    const crowns: Crown[] = [];
    let cut = 0;
    for (let t = 0; t < tris; t++) {
      if (!winter(t)) continue;
      keep[t] = 0;
      cut++;
      // a limb blade (two Wood faces on the same corners): its base, the two closest corners, sits on the trunk top;
      // the blades on one base point are one crown
      if (type(t) !== Surf.Wood || t + 1 >= tris || type(t + 1) !== Surf.Wood || !winter(t + 1) || !sameCorners(P, t, t + 1)) continue;
      keep[t + 1] = 0;
      cut++;
      const o = t * 9, c: V[] = [[P[o], P[o + 1], P[o + 2]], [P[o + 3], P[o + 4], P[o + 5]], [P[o + 6], P[o + 7], P[o + 8]]];
      let ti = 0, best = Infinity;
      for (let i = 0; i < 3; i++) {
        const a = c[(i + 1) % 3], b = c[(i + 2) % 3], d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
        if (d < best) { best = d; ti = i; }
      }
      const a = c[(ti + 1) % 3], b = c[(ti + 2) % 3], tip = c[ti];
      const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2, z = (a[2] + b[2]) / 2;
      let cr = crowns.find((w) => Math.abs(w.x - x) < 2e-3 && Math.abs(w.y - y) < 2e-3 && Math.abs(w.z - z) < 2e-3);
      if (!cr) crowns.push((cr = { x, y, z, blades: [] }));
      cr.blades.push({ t, tip, reach: Math.hypot(tip[0] - x, tip[2] - z) });
      t++;
    }
    if (cut) {
      const spires = crowns.length ? yCrowns(g, keep, crowns) : new Map<number, Spire>();
      let n = 0;
      for (let t = 0; t < tris; t++) n += keep[t];
      for (const s of spires.values()) n += s.pos.length / 9;
      out = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
        const sz = a.itemSize, src = a.array as Arr, dst = new Float32Array(n * 3 * sz);
        let w = 0;
        for (let t = 0; t < tris; t++) {
          const s = spires.get(t);
          if (s) {
            const v = name === 'position' ? s.pos : name === 'normal' ? s.nrm : name === 'color' ? s.col : name === 'surf' ? s.srf : null;
            if (v && sz === 3) { dst.set(v, w); w += v.length; }
            else for (let c = 0; c < s.pos.length / 3; c++) for (let j = 0; j < sz; j++) dst[w++] = src[s.src * 3 * sz + j];
          }
          if (!keep[t]) continue;
          for (let i = t * 3 * sz, e = i + 3 * sz; i < e; i++) dst[w++] = src[i];
        }
        out.setAttribute(name, new THREE.BufferAttribute(dst, sz, a.normalized));
      }
      out.computeBoundingBox();
      out.computeBoundingSphere();
      out.name = g.name + '#lt';
    }
  }
  _stripped.set(g, out);
  return out;
}

/** model height (m) of the Foliage shader's LOW class (materials.ts: LOW foliage below ~2.5 m), and the height of a
 *  small plant */
const LOW_H = 2.5;
/** linear luminance below which the shader keeps a pattern-0 face evergreen (materials.ts, everK) */
const DARK = 0.108;

const _low = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * `g` with its small raised plants marked LOW foliage (paint floor -1, materials.ts Foliage): the shader's LOW class
 * goes by model height, so shrubs in roof / terrace planters took the crowns' seasons (a grey-brown lump in winter, the
 * colours of a tree in autumn); marked, they go dormant like the shrubs on the ground. A small plant: connected pattern-0
 * foliage (faces joined by shared corners) less than LOW_H tall reaching above LOW_H (lower ones are LOW already,
 * taller ones are crowns); dark-painted (evergreen) faces keep their paint. Only the surf attribute is copied; `g`
 * itself when there is none (cached per geometry).
 */
export function markLowPlants(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = _low.get(g);
  if (hit) return hit;
  let out = g;
  const srf = g.getAttribute('surf') as THREE.BufferAttribute | undefined, pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  const col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (srf && pos && !g.index) {
    const S = srf.array as ArrayLike<number>, P = pos.array as ArrayLike<number>, C = col ? (col.array as ArrayLike<number>) : null;
    const tris = pos.count / 3;
    const plant = (t: number) => Math.abs(S[t * 9] - Surf.Foliage) < 0.5 && S[t * 9 + 1] < 0.5 && S[t * 9 + 2] >= 0;
    let any = false;
    for (let t = 0; t < tris && !any; t++) if (plant(t) && Math.max(P[t * 9 + 1], P[t * 9 + 4], P[t * 9 + 7]) > LOW_H) any = true;
    if (any) {
      // union-find over the pattern-0 foliage faces, joined by their corners (positions to 1 cm)
      const parent = new Int32Array(tris).fill(-1);
      const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
      const corner = new Map<number, number>();
      for (let t = 0; t < tris; t++) {
        if (!plant(t)) continue;
        parent[t] = t;
        for (let k = 0; k < 3; k++) {
          const o = t * 9 + k * 3;
          const q = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 100))) + 32768;
          const key = (q(P[o]) * 65536 + q(P[o + 1])) * 65536 + q(P[o + 2]);
          const f = corner.get(key);
          if (f === undefined) corner.set(key, t);
          else { const a = find(f), b = find(t); if (a !== b) parent[a] = b; }
        }
      }
      const y0 = new Float32Array(tris).fill(Infinity), y1 = new Float32Array(tris).fill(-Infinity);
      for (let t = 0; t < tris; t++) {
        if (parent[t] < 0) continue;
        const r = find(t), o = t * 9;
        y0[r] = Math.min(y0[r], P[o + 1], P[o + 4], P[o + 7]);
        y1[r] = Math.max(y1[r], P[o + 1], P[o + 4], P[o + 7]);
      }
      let dst: Float32Array | null = null;
      for (let t = 0; t < tris; t++) {
        if (parent[t] < 0) continue;
        const r = find(t);
        if (!(y1[r] > LOW_H && y1[r] - y0[r] < LOW_H)) continue;
        if (C) {
          let lum = 0;
          for (let k = 0; k < 3; k++) { const o = t * 9 + k * 3; lum += 0.2126 * C[o] + 0.7152 * C[o + 1] + 0.0722 * C[o + 2]; }
          if (lum / 3 < DARK) continue;
        }
        dst ??= Float32Array.from(S);
        dst[t * 9 + 2] = dst[t * 9 + 5] = dst[t * 9 + 8] = -1;
      }
      if (dst) {
        out = new THREE.BufferGeometry();
        for (const [name, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) out.setAttribute(name, name === 'surf' ? new THREE.BufferAttribute(dst, 3) : a);
        out.boundingBox = g.boundingBox?.clone() ?? null;
        out.boundingSphere = g.boundingSphere?.clone() ?? null;
        if (!out.boundingBox) out.computeBoundingBox();
        if (!out.boundingSphere) out.computeBoundingSphere();
        out.name = g.name + '#lp';
      }
    }
  }
  _low.set(g, out);
  return out;
}

/** the geometry the building renderer registers for lot model `g`: small raised plants marked LOW (markLowPlants),
 *  and without the winter twig crowns while the strip is on */
export function lotTwigGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = markLowPlants(g);
  return (lotTwigs.strip && stripWinterTwigs(m)) || m;
}

/** its batch key: `key` + '#lt' for a stripped model (both versions can coexist in a batch) */
export function lotTwigKey(key: string, g: THREE.BufferGeometry): string {
  return lotTwigs.strip && stripWinterTwigs(markLowPlants(g)) ? key + '#lt' : key;
}
