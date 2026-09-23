/**
 * Building LOD proxies — auto-generated per model geometry (cached), used by BuildingRenderer when a building's
 * projected radius drops below a few pixels (far / mid zoom).
 *
 * A proxy is the model's MASSING: per connected footprint (up to 3) up to 3 stacked boxes fitted to the cross-sections
 * of a top-surface height field of the model's big building surfaces (walls / roofs / glass / tanks; small clutter,
 * foliage, cars, fences and lot walls are ignored), topped by a gable / hip / pyramid roof when the model has a
 * pitched roof, plus the model's largest ground-level faces (lawns, parking, plazas, pools) copied verbatim so lots
 * keep their colour layout from above. Walls keep the model's dominant
 * surface (window pattern / glass tint / floor height), so the shared uber material still draws windows by day and
 * lit windows at night; walls without a window surface get a lit-window band (house windows) when the model has
 * windows, so night skylines keep sparkling. Trees / hedges on the lot become up to 4 foliage clusters (8-tri
 * diamonds sized and tinted like the foliage they replace), so parks and gardens stay green-textured from afar.
 * Typically 12-50 triangles instead of 300-6000.
 */
import * as THREE from 'three';
import { ModelBuilder, type Paint } from '../../../assets/ModelBuilder';
import { Surf } from '../../../core/types';

const cache = new Map<string, THREE.BufferGeometry | null>();

/** building surfaces that define the massing */
const MASS = new Set<number>([Surf.Plain, Surf.WallWindows, Surf.GlassCurtain, Surf.RoofFlat, Surf.RoofTiles, Surf.Metal, Surf.GlassPlain, Surf.Corrugated, Surf.Brick, Surf.Wood, Surf.Stone]);
/** average window coverage of a surface type (0 = no windows) */
function windowCover(type: number): number {
  return type === Surf.WallWindows ? 0.3 : type === Surf.GlassCurtain ? 0.85 : type === Surf.GlassPlain ? 1 : 0;
}

interface Tri {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
  nx: number; ny: number; nz: number;
  area: number;
  type: number; pattern: number; floor: number;
  r: number; g: number; b: number;
  minY: number; maxY: number; midY: number;
}

interface Group { area: number; r: number; g: number; b: number; floor: number; type: number; pattern: number }

/** area-weighted dominant surface of a set of triangles (grouped by surface type + pattern) */
function dominant(tris: Tri[], filter: (t: Tri) => boolean): { paint: Paint; area: number; win: number } | null {
  const groups = new Map<string, Group>();
  let total = 0, win = 0;
  for (const t of tris) {
    if (!filter(t)) continue;
    const k = t.type + '|' + t.pattern;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { area: 0, r: 0, g: 0, b: 0, floor: 0, type: t.type, pattern: t.pattern }));
    g.area += t.area; g.r += t.r * t.area; g.g += t.g * t.area; g.b += t.b * t.area; g.floor += t.floor * t.area;
    total += t.area;
    win += t.area * windowCover(t.type);
  }
  let best: Group | null = null;
  for (const g of groups.values()) if (!best || g.area > best.area) best = g;
  if (!best || best.area <= 0) return null;
  const a = best.area;
  return {
    paint: { color: new THREE.Color(best.r / a, best.g / a, best.b / a), surf: best.type, pattern: best.pattern, floor: best.floor / a },
    area: total,
    win: total > 0 ? win / total : 0,
  };
}

/** window faces' average colour (for the lit-window band) */
function windowPaint(tris: Tri[], filter: (t: Tri) => boolean): Paint | null {
  let a = 0, r = 0, g = 0, b = 0;
  for (const t of tris) {
    if (!filter(t) || windowCover(t.type) === 0) continue;
    a += t.area; r += t.r * t.area; g += t.g * t.area; b += t.b * t.area;
  }
  if (a <= 0) return null;
  return { color: new THREE.Color(r / a, g / a, b / a), surf: Surf.GlassPlain, pattern: 0, floor: 3.3 };
}

interface Rect { x0: number; x1: number; z0: number; z1: number }
interface Tier extends Rect { y0: number; y1: number; k0: number; k1: number }

function similar(a: Rect, b: Rect): boolean {
  const tol = Math.max(1.0, 0.1 * Math.max(a.x1 - a.x0, a.z1 - a.z0));
  return Math.abs(a.x0 - b.x0) < tol && Math.abs(a.x1 - b.x1) < tol && Math.abs(a.z0 - b.z0) < tol && Math.abs(a.z1 - b.z1) < tol;
}

/** walls of a box between ya..yb (4 sides, CCW from outside) */
function walls(mb: ModelBuilder, r: Rect, ya: number, yb: number, p: Paint): void {
  if (yb - ya < 0.02) return;
  const { x0, x1, z0, z1 } = r;
  mb.paint(p);
  mb.quad([x0, ya, z1], [x1, ya, z1], [x1, yb, z1], [x0, yb, z1]);
  mb.quad([x1, ya, z0], [x0, ya, z0], [x0, yb, z0], [x1, yb, z0]);
  mb.quad([x1, ya, z1], [x1, ya, z0], [x1, yb, z0], [x1, yb, z1]);
  mb.quad([x0, ya, z0], [x0, ya, z1], [x0, yb, z1], [x0, yb, z0]);
}

function topFace(mb: ModelBuilder, r: Rect, y: number, p: Paint): void {
  mb.paint(p);
  mb.quad([r.x0, y, r.z1], [r.x1, y, r.z1], [r.x1, y, r.z0], [r.x0, y, r.z0]);
}

/**
 * Hip roof over rect r from eave height ye to ridge height yr. The ridge runs along X (alongX) or Z, spanning
 * [ra, rb] on that axis at `rc` on the other axis. ra == rb gives a pyramid, full span a gable.
 */
function hipRoof(mb: ModelBuilder, r: Rect, ye: number, yr: number, alongX: boolean, ra: number, rb: number, rc: number, roof: Paint, wall: Paint): void {
  const { x0, x1, z0, z1 } = r;
  if (alongX) {
    mb.paint(roof);
    mb.quad([x0, ye, z1], [x1, ye, z1], [rb, yr, rc], [ra, yr, rc]);
    mb.quad([x1, ye, z0], [x0, ye, z0], [ra, yr, rc], [rb, yr, rc]);
    mb.paint(x1 - rb < 0.4 ? wall : roof).tri([x1, ye, z1], [x1, ye, z0], [rb, yr, rc]);
    mb.paint(ra - x0 < 0.4 ? wall : roof).tri([x0, ye, z0], [x0, ye, z1], [ra, yr, rc]);
  } else {
    mb.paint(roof);
    mb.quad([x1, ye, z1], [x1, ye, z0], [rc, yr, ra], [rc, yr, rb]);
    mb.quad([x0, ye, z0], [x0, ye, z1], [rc, yr, rb], [rc, yr, ra]);
    mb.paint(z1 - rb < 0.4 ? wall : roof).tri([x0, ye, z1], [x1, ye, z1], [rc, yr, rb]);
    mb.paint(ra - z0 < 0.4 ? wall : roof).tri([x1, ye, z0], [x0, ye, z0], [rc, yr, ra]);
  }
}

/**
 * Massing from a top-surface height field: the mass triangles are rasterized top-down onto a grid (roofs by area,
 * walls along their footprint line; enclosed holes such as hollow stacks are filled), thin structures (fences, lot
 * walls, rails) are removed by a morphological opening, and each remaining connected footprint (up to 3: twin
 * towers, house + garage) becomes up to 3 stacked boxes fitted to its cross-sections, with a pitched roof on the
 * component that carries the model's sloped roof faces.
 */
function buildMassing(mb: ModelBuilder, mass: Tri[], H: number): void {
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity, yMin = 0;
  for (const t of mass) {
    bx0 = Math.min(bx0, t.ax, t.bx, t.cx); bx1 = Math.max(bx1, t.ax, t.bx, t.cx);
    bz0 = Math.min(bz0, t.az, t.bz, t.cz); bz1 = Math.max(bz1, t.az, t.bz, t.cz);
    yMin = Math.min(yMin, t.minY);
  }
  const ext = Math.max(bx1 - bx0, bz1 - bz0);
  const cs = THREE.MathUtils.clamp(ext / 44, 0.45, 3);
  const nx = Math.max(1, Math.ceil((bx1 - bx0) / cs) + 2), nz = Math.max(1, Math.ceil((bz1 - bz0) / cs) + 2);
  const ox = bx0 - cs, oz = bz0 - cs;
  const N = nx * nz;
  const hf = new Float32Array(N).fill(-Infinity);
  const top = new Int32Array(N).fill(-1);
  const put = (i: number, j: number, y: number, ti: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return;
    const k = j * nx + i;
    if (y > hf[k]) { hf[k] = y; top[k] = ti; }
  };
  for (let ti = 0; ti < mass.length; ti++) {
    const t = mass[ti];
    if (t.ny > 0.02) {
      // area rasterization at cell centres (barycentric, plane height)
      const i0 = Math.floor((Math.min(t.ax, t.bx, t.cx) - ox) / cs), i1 = Math.floor((Math.max(t.ax, t.bx, t.cx) - ox) / cs);
      const j0 = Math.floor((Math.min(t.az, t.bz, t.cz) - oz) / cs), j1 = Math.floor((Math.max(t.az, t.bz, t.cz) - oz) / cs);
      const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz);
      if (Math.abs(d) < 1e-9) continue;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = ox + (i + 0.5) * cs, pz = oz + (j + 0.5) * cs;
        const w0 = ((t.bz - t.cz) * (px - t.cx) + (t.cx - t.bx) * (pz - t.cz)) / d;
        const w1 = ((t.cz - t.az) * (px - t.cx) + (t.ax - t.cx) * (pz - t.cz)) / d;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        put(i, j, w0 * t.ay + w1 * t.by + w2 * t.cy, ti);
      }
    } else if (t.ny > -0.3) {
      // (near) vertical wall: its footprint is a line; mark it with the wall's top height
      const x0 = Math.min(t.ax, t.bx, t.cx), x1 = Math.max(t.ax, t.bx, t.cx), z0 = Math.min(t.az, t.bz, t.cz), z1 = Math.max(t.az, t.bz, t.cz);
      const len = Math.hypot(x1 - x0, z1 - z0);
      const steps = Math.max(1, Math.ceil(len / (cs * 0.5)));
      // the footprint segment runs between the two extreme vertices along the wall tangent
      const tx = -t.nz, tz = t.nx;
      const pr = [[t.ax, t.az], [t.bx, t.bz], [t.cx, t.cz]].map(([x, z]) => [x * tx + z * tz, x, z]).sort((a, b) => a[0] - b[0]);
      const [, sx, sz] = pr[0], [, ex, ez] = pr[2];
      for (let k = 0; k <= steps; k++) {
        const f = k / steps;
        put(Math.floor((sx + (ex - sx) * f - ox) / cs), Math.floor((sz + (ez - sz) * f - oz) / cs), t.maxY, ti);
      }
    }
  }
  // fill enclosed holes (hollow stacks / towers): empty cells not reachable from the border
  const reach = new Uint8Array(N);
  const stack: number[] = [];
  for (let i = 0; i < nx; i++) { stack.push(i, (nz - 1) * nx + i); }
  for (let j = 0; j < nz; j++) { stack.push(j * nx, j * nx + nx - 1); }
  while (stack.length) {
    const k = stack.pop()!;
    if (reach[k] || hf[k] > -Infinity) continue;
    reach[k] = 1;
    const i = k % nx, j = (k / nx) | 0;
    if (i > 0) stack.push(k - 1); if (i < nx - 1) stack.push(k + 1);
    if (j > 0) stack.push(k - nx); if (j < nz - 1) stack.push(k + nx);
  }
  for (let pass = 0; pass < 2; pass++) for (let k = 0; k < N; k++) {
    if (hf[k] > -Infinity || reach[k]) continue;
    const i = k % nx, j = (k / nx) | 0;
    let m = -Infinity, tt = -1;
    for (const q of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < nz - 1 ? k + nx : -1]) if (q >= 0 && hf[q] > m) { m = hf[q]; tt = top[q]; }
    if (m > -Infinity) { hf[k] = m; top[k] = tt; }
  }
  // pitched roof analysis (sloped, up-facing faces in the upper part)
  const sloped = mass.filter((t) => t.ny > 0.2 && t.ny < 0.97 && t.midY > H * 0.3);
  let slopedProj = 0;
  const sb: Rect = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  let ye = Infinity, yr = -Infinity;
  for (const t of sloped) {
    slopedProj += t.area * t.ny;
    for (const [x, y, z] of [[t.ax, t.ay, t.az], [t.bx, t.by, t.bz], [t.cx, t.cy, t.cz]]) {
      if (x < sb.x0) sb.x0 = x; if (x > sb.x1) sb.x1 = x;
      if (z < sb.z0) sb.z0 = z; if (z > sb.z1) sb.z1 = z;
      if (y > yr) yr = y;
    }
  }
  if (sloped.length) {
    // eave: area-weighted low quantile of the sloped faces' bottoms (ignores small dormers / lower porch roofs)
    const sl = sloped.map((t) => [t.minY, t.area] as [number, number]).sort((a, b) => a[0] - b[0]);
    let acc = 0;
    const tot = sl.reduce((q, x) => q + x[1], 0);
    for (const [y, a] of sl) { acc += a; if (acc >= tot * 0.15) { ye = y; break; } }
  }
  const sbArea = (sb.x1 - sb.x0) * (sb.z1 - sb.z0);
  // the pitched roof must be the top of the massing (chimneys / vents / antennas may stick out a little)
  const pitched = sloped.length > 0 && yr - ye > 0.5 && sbArea > 0 && slopedProj > sbArea * 0.45 && yr >= H - Math.max(1.5, 0.35 * (H - ye));
  const y0 = Math.min(1.5, (pitched ? ye : H) * 0.4);
  // built cells + opening (erode, then dilate) to drop 1-2 cell wide structures
  const built = new Uint8Array(N);
  for (let k = 0; k < N; k++) built[k] = hf[k] >= y0 ? 1 : 0;
  const morph = (src: Uint8Array, erode: boolean) => {
    const out = new Uint8Array(N);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let v = erode ? 1 : 0;
      for (let dj = -1; dj <= 1 && (erode ? v : !v); dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        const b = ii >= 0 && jj >= 0 && ii < nx && jj < nz ? src[jj * nx + ii] : 0;
        if (erode && !b) { v = 0; break; }
        if (!erode && b) { v = 1; break; }
      }
      out[j * nx + i] = v;
    }
    return out;
  };
  let open = morph(morph(built, true), false);
  // tall slender structures (stacks, towers, spires) survive the opening: only LOW thin things are clutter
  const tallH = Math.max(5, H * 0.3);
  for (let k = 0; k < N; k++) open[k] = built[k] && (open[k] || hf[k] >= tallH) ? 1 : 0;
  let openCount = 0;
  for (let k = 0; k < N; k++) openCount += open[k];
  if (openCount === 0) open = built; // tiny model: keep what is there
  // connected components (8-neighbourhood)
  const comp = new Int32Array(N).fill(-1);
  const comps: number[][] = [];
  for (let k = 0; k < N; k++) {
    if (!open[k] || comp[k] >= 0) continue;
    const cells: number[] = [];
    const st = [k];
    comp[k] = comps.length;
    while (st.length) {
      const q = st.pop()!;
      cells.push(q);
      const i = q % nx, j = (q / nx) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const r = jj * nx + ii;
        if (open[r] && comp[r] < 0) { comp[r] = comps.length; st.push(r); }
      }
    }
    comps.push(cells);
  }
  comps.sort((a, b) => b.length - a.length);
  const compTop = (c: number[]) => c.reduce((m, k) => Math.max(m, hf[k]), -Infinity);
  // up to 3 big footprints + up to 2 tall slender ones (smokestacks, bell towers, masts)
  const big = comps.filter((c, i) => i < 3 && c.length >= Math.max(2, comps[0].length * 0.08));
  const tall = comps.filter((c) => !big.includes(c) && compTop(c) >= Math.max(8, H * 0.45)).sort((a, b) => compTop(b) - compTop(a)).slice(0, 2);
  const keep = [...big, ...tall];
  const allWalls = dominant(mass, (t) => Math.abs(t.ny) < 0.3);
  const fallbackWall: Paint = allWalls?.paint ?? { color: new THREE.Color(0.6, 0.6, 0.6), surf: Surf.Plain };
  const fallbackRoof: Paint = dominant(mass, (t) => t.ny > 0.9)?.paint ?? fallbackWall;
  const cellRect = (cells: number[], minH: number): Rect | null => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const k of cells) {
      if (hf[k] < minH) continue;
      const i = k % nx, j = (k / nx) | 0;
      x0 = Math.min(x0, ox + i * cs); x1 = Math.max(x1, ox + (i + 1) * cs);
      z0 = Math.min(z0, oz + j * cs); z1 = Math.max(z1, oz + (j + 1) * cs);
    }
    if (!(x1 > x0)) return null;
    // clamp to the real mass bounds (cells overhang by up to one cell)
    return { x0: Math.max(x0, bx0), x1: Math.min(x1, bx1), z0: Math.max(z0, bz0), z1: Math.min(z1, bz1) };
  };
  // which component carries the pitched roof
  const scx = (sb.x0 + sb.x1) / 2, scz = (sb.z0 + sb.z1) / 2;
  const roofComp = pitched ? comp[THREE.MathUtils.clamp(Math.floor((scz - oz) / cs), 0, nz - 1) * nx + THREE.MathUtils.clamp(Math.floor((scx - ox) / cs), 0, nx - 1)] : -1;
  for (const cells of keep) {
    const ci = comp[cells[0]];
    const hasRoof = pitched && ci === roofComp;
    let cTop = -Infinity;
    for (const k of cells) cTop = Math.max(cTop, hf[k]);
    const yTop = hasRoof ? Math.min(ye, cTop) : cTop;
    const cy0 = Math.min(y0, yTop * 0.4);
    const K = 12;
    const secs: (Rect | null)[] = [];
    for (let k = 0; k < K; k++) secs.push(cellRect(cells, cy0 + (yTop - cy0) * ((k + 0.5) / K)));
    // tiers of similar cross-sections
    const tiers: Tier[] = [];
    let cur: Tier | null = null;
    let ref: Rect | null = null;
    for (let k = 0; k < K; k++) {
      const sct = secs[k];
      if (!sct) { if (cur) { tiers.push(cur); cur = null; } continue; }
      if (cur && ref && similar(sct, ref)) {
        cur.x0 = Math.min(cur.x0, sct.x0); cur.x1 = Math.max(cur.x1, sct.x1);
        cur.z0 = Math.min(cur.z0, sct.z0); cur.z1 = Math.max(cur.z1, sct.z1);
        cur.k1 = k;
      } else {
        if (cur) tiers.push(cur);
        cur = { ...sct, y0: 0, y1: 0, k0: k, k1: k };
        ref = sct;
      }
    }
    if (cur) tiers.push(cur);
    while (tiers.length > 3) {
      let bi = 0, bc = Infinity;
      for (let i = 0; i + 1 < tiers.length; i++) {
        const a = tiers[i], b = tiers[i + 1];
        const c = Math.abs((a.x1 - a.x0) * (a.z1 - a.z0) - (b.x1 - b.x0) * (b.z1 - b.z0));
        if (c < bc) { bc = c; bi = i; }
      }
      const a = tiers[bi], b = tiers[bi + 1];
      a.x0 = Math.min(a.x0, b.x0); a.x1 = Math.max(a.x1, b.x1); a.z0 = Math.min(a.z0, b.z0); a.z1 = Math.max(a.z1, b.z1);
      a.k1 = b.k1;
      tiers.splice(bi + 1, 1);
    }
    const step = (yTop - cy0) / K;
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      t.y0 = i === 0 ? Math.min(0, yMin) : tiers[i - 1].y1;
      t.y1 = i === tiers.length - 1 ? yTop : cy0 + step * (t.k1 + 1);
    }
    const inRect = (q: Tri, r: Rect) => {
      const mx = (q.ax + q.bx + q.cx) / 3, mz = (q.az + q.bz + q.cz) / 3;
      return mx >= r.x0 - 0.6 && mx <= r.x1 + 0.6 && mz >= r.z0 - 0.6 && mz <= r.z1 + 0.6;
    };
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      const inTier = (q: Tri) => Math.abs(q.ny) < 0.3 && q.midY >= t.y0 - 0.2 && q.midY <= t.y1 + 0.2 && inRect(q, t);
      const w = dominant(mass, inTier);
      const wp = w?.paint ?? fallbackWall;
      const h = t.y1 - t.y0;
      const isWin = wp.surf === Surf.WallWindows || wp.surf === Surf.GlassCurtain;
      const band = !isWin && w && w.win > 0.04 ? windowPaint(mass, inTier) : null;
      if (band && h > 1.2) {
        const bh = THREE.MathUtils.clamp(w!.win * h * 1.6, 0.5, h * 0.45);
        const bc = t.y0 + (h < 5 ? Math.min(h * 0.5, 1.7) : h * 0.5);
        const b0 = Math.max(t.y0 + 0.2, bc - bh / 2), b1 = Math.min(t.y1 - 0.2, bc + bh / 2);
        walls(mb, t, t.y0, b0, wp);
        walls(mb, t, b0, b1, band);
        walls(mb, t, b1, t.y1, wp);
      } else {
        walls(mb, t, t.y0, t.y1, wp);
      }
      if (hasRoof && i === tiers.length - 1) continue;
      // flat top: the paint seen from above on this tier's top (top-most triangles of its cells)
      const counts = new Map<number, number>();
      for (const k of cells) {
        if (top[k] < 0 || Math.abs(hf[k] - t.y1) > Math.max(1.5, h * 0.25)) continue;
        const ii = k % nx, jj = (k / nx) | 0;
        const cx = ox + (ii + 0.5) * cs, cz = oz + (jj + 0.5) * cs;
        if (cx < t.x0 || cx > t.x1 || cz < t.z0 || cz > t.z1) continue;
        counts.set(top[k], (counts.get(top[k]) ?? 0) + 1);
      }
      let rp: Paint | null = null;
      if (counts.size) {
        const byPaint = dominant([...counts.keys()].map((ti) => ({ ...mass[ti], area: counts.get(ti)! })), (q) => q.ny > 0.02);
        rp = byPaint?.paint ?? null;
      }
      topFace(mb, t, t.y1, rp ?? fallbackRoof);
    }
    if (hasRoof) {
      const last = tiers[tiers.length - 1];
      const base: Rect = last ? { x0: Math.min(sb.x0, last.x0), x1: Math.max(sb.x1, last.x1), z0: Math.min(sb.z0, last.z0), z1: Math.max(sb.z1, last.z1) } : { ...sb };
      // ridge: the highest sloped vertices
      const lim = yr - Math.max(0.15, (yr - ye) * 0.12);
      let rx0 = Infinity, rx1 = -Infinity, rz0 = Infinity, rz1 = -Infinity;
      for (const t of sloped) for (const [x, y, z] of [[t.ax, t.ay, t.az], [t.bx, t.by, t.bz], [t.cx, t.cy, t.cz]]) {
        if (y < lim) continue;
        if (x < rx0) rx0 = x; if (x > rx1) rx1 = x;
        if (z < rz0) rz0 = z; if (z > rz1) rz1 = z;
      }
      const alongX = rx1 - rx0 >= rz1 - rz0;
      const roofP = dominant(sloped, () => true)?.paint ?? fallbackRoof;
      const wallP = dominant(mass, (q) => Math.abs(q.ny) < 0.3 && q.midY > ye - 0.5 && inRect(q, base))?.paint ?? fallbackWall;
      if (!tiers.length) walls(mb, base, 0, ye, wallP);
      if (alongX) hipRoof(mb, base, ye, yr, true, Math.max(base.x0, rx0), Math.min(base.x1, rx1), THREE.MathUtils.clamp((rz0 + rz1) / 2, base.z0, base.z1), roofP, wallP);
      else hipRoof(mb, base, ye, yr, false, Math.max(base.z0, rz0), Math.min(base.z1, rz1), THREE.MathUtils.clamp((rx0 + rx1) / 2, base.x0, base.x1), roofP, wallP);
    }
  }
}

/** Build the proxy for a model geometry (non-indexed, attributes position / normal / color / surf). */
export function buildLodProxy(g: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  const srf = g.getAttribute('surf') as THREE.BufferAttribute | undefined;
  if (!pos || !col || !srf || g.index) return null;
  const nTri = pos.count / 3;
  const tris: Tri[] = [];
  const P = pos.array as ArrayLike<number>, C = col.array as ArrayLike<number>, S = srf.array as ArrayLike<number>;
  let massArea = 0;
  for (let i = 0; i < nTri; i++) {
    const o = i * 9;
    const ax = P[o], ay = P[o + 1], az = P[o + 2], bx = P[o + 3], by = P[o + 4], bz = P[o + 5], cx = P[o + 6], cy = P[o + 7], cz = P[o + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-8) continue;
    nx /= l; ny /= l; nz /= l;
    const type = Math.round(S[o]);
    const t: Tri = {
      ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz, area: l / 2,
      type, pattern: Math.round(S[o + 1]), floor: S[o + 2],
      r: (C[o] + C[o + 3] + C[o + 6]) / 3, g: (C[o + 1] + C[o + 4] + C[o + 7]) / 3, b: (C[o + 2] + C[o + 5] + C[o + 8]) / 3,
      minY: Math.min(ay, by, cy), maxY: Math.max(ay, by, cy), midY: (ay + by + cy) / 3,
    };
    tris.push(t);
    if (MASS.has(type)) massArea += t.area;
  }
  const mb = new ModelBuilder();
  // ---- ground layer: the biggest low, up-facing faces (lawns, parking, plazas) copied verbatim; pools always
  const ground = tris.filter((t) => t.ny > 0.9 && t.maxY < 0.45 && t.type !== Surf.Emissive);
  ground.sort((a, b) => (b.type === Surf.Water ? 1e6 : 0) + b.area - (a.type === Surf.Water ? 1e6 : 0) - a.area);
  let kept = 0;
  for (const t of ground) {
    if (kept >= 22 || t.area < (t.type === Surf.Water ? 0.4 : 0.8)) break;
    mb.paint({ color: new THREE.Color(t.r, t.g, t.b), surf: t.type, pattern: t.pattern, floor: t.floor });
    mb.tri([t.ax, t.ay, t.az], [t.bx, t.by, t.bz], [t.cx, t.cy, t.cz]);
    kept++;
  }
  // ---- massing: big building surfaces only
  // small clutter (poles, rails, trim) is excluded by area; the threshold stays small in absolute terms so finely
  // tessellated curved masses (domes, cooling towers, round towers) still count
  const minA = Math.min(1.5, 0.35 + massArea * 0.00005);
  const mass = tris.filter((t) => MASS.has(t.type) && t.area >= minA && !(t.ny > 0.9 && t.maxY < 0.45));
  let H = 0;
  for (const t of mass) if (t.maxY > H) H = t.maxY;
  if (H > 0.6 && mass.length) buildMassing(mb, mass, H);
  // ---- foliage clusters (trees, hedges): grid-cluster the foliage triangles, keep the biggest few as diamonds
  let fArea = 0, tArea = 0;
  for (const t of tris) { tArea += t.area; if (t.type === Surf.Foliage && t.maxY > 0.5) fArea += t.area; }
  if (fArea > tArea * 0.06) {
    let fx0 = Infinity, fx1 = -Infinity, fz0 = Infinity, fz1 = -Infinity;
    for (const t of tris) if (t.type === Surf.Foliage && t.maxY > 0.5) {
      fx0 = Math.min(fx0, t.ax, t.bx, t.cx); fx1 = Math.max(fx1, t.ax, t.bx, t.cx);
      fz0 = Math.min(fz0, t.az, t.bz, t.cz); fz1 = Math.max(fz1, t.az, t.bz, t.cz);
    }
    const cs = Math.max(6, Math.max(fx1 - fx0, fz1 - fz0) / 4);
    const cells = new Map<number, { a: number; r: number; g: number; b: number; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }>();
    for (const t of tris) {
      if (t.type !== Surf.Foliage || t.maxY <= 0.5) continue;
      const mx = (t.ax + t.bx + t.cx) / 3, mz = (t.az + t.bz + t.cz) / 3;
      const k = Math.floor((mx - fx0) / cs) * 64 + Math.floor((mz - fz0) / cs);
      let c = cells.get(k);
      if (!c) cells.set(k, (c = { a: 0, r: 0, g: 0, b: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity }));
      c.a += t.area; c.r += t.r * t.area; c.g += t.g * t.area; c.b += t.b * t.area;
      c.x0 = Math.min(c.x0, t.ax, t.bx, t.cx); c.x1 = Math.max(c.x1, t.ax, t.bx, t.cx);
      c.y0 = Math.min(c.y0, t.minY); c.y1 = Math.max(c.y1, t.maxY);
      c.z0 = Math.min(c.z0, t.az, t.bz, t.cz); c.z1 = Math.max(c.z1, t.az, t.bz, t.cz);
    }
    const list = [...cells.values()].sort((a, b) => b.a - a.a).slice(0, 4);
    for (const c of list) {
      if (c.a < fArea * 0.05) break;
      const cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2, rx = (c.x1 - c.x0) / 2, rz = (c.z1 - c.z0) / 2;
      const ym = c.y0 + (c.y1 - c.y0) * 0.45;
      mb.paint({ color: new THREE.Color(c.r / c.a, c.g / c.a, c.b / c.a), surf: Surf.Foliage });
      const e: [number, number, number][] = [[cx + rx, ym, cz], [cx, ym, cz + rz], [cx - rx, ym, cz], [cx, ym, cz - rz]];
      for (let i = 0; i < 4; i++) {
        const a = e[i], b = e[(i + 1) % 4];
        mb.tri(b, a, [cx, c.y1, cz]);
        mb.tri(a, b, [cx, c.y0, cz]);
      }
    }
  }
  if (mb.triangleCount === 0) return null;
  const out = mb.build();
  out.name = (g.name || 'model') + '#lod';
  return out;
}

/** cached proxy for a model geometry (null = no useful proxy: keep the full model) */
export function lodProxyFor(key: string, g: THREE.BufferGeometry): THREE.BufferGeometry | null {
  if (cache.has(key)) return cache.get(key)!;
  // construction sites are mostly thin lattice (crane, scaffolding): a massing proxy would read as a solid block
  if (key.startsWith('construction_site')) { cache.set(key, null); return null; }
  let p: THREE.BufferGeometry | null = null;
  try {
    p = buildLodProxy(g);
  } catch (e) {
    console.warn('[lod] proxy failed for', key, e);
    p = null;
  }
  const full = g.getAttribute('position').count / 3;
  if (p && p.getAttribute('position').count / 3 > full * 0.5) p = null;
  cache.set(key, p);
  return p;
}
