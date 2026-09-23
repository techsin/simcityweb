/**
 * 2D canvas map rendering: shaded relief colored by height / water depth / forests / snow (+ optional zones, roads,
 * buildings). Used by the New City live preview, region preset cards, region previews in the load dialog and as
 * the fallback city thumbnail when no 3D capture is available.
 */
import type { CityState } from '../sim/CityState';
import type { Climate } from '../core/types';
import { Network, Zone } from '../core/types';
import type { RegionModel } from './RegionModel';

type RGB = [number, number, number];

interface MapPalette {
  low: RGB;
  mid: RGB;
  high: RGB;
  rock: RGB;
  snow: RGB;
  sand: RGB;
  forest: RGB;
  shallow: RGB;
  deep: RGB;
  snowLine: number;
}

const PALETTES: Record<Climate, MapPalette> = {
  temperate: { low: [112, 150, 70], mid: [140, 160, 86], high: [150, 140, 104], rock: [140, 130, 118], snow: [240, 243, 248], sand: [222, 206, 158], forest: [46, 88, 44], shallow: [70, 170, 180], deep: [18, 66, 104], snowLine: 215 },
  desert: { low: [206, 164, 108], mid: [214, 178, 122], high: [190, 128, 88], rock: [168, 102, 72], snow: [240, 236, 228], sand: [232, 210, 160], forest: [104, 124, 62], shallow: [70, 182, 180], deep: [16, 76, 110], snowLine: 9999 },
  tropical: { low: [86, 160, 64], mid: [116, 176, 76], high: [120, 140, 96], rock: [120, 114, 100], snow: [240, 243, 248], sand: [242, 228, 184], forest: [30, 104, 48], shallow: [60, 210, 200], deep: [10, 86, 140], snowLine: 9999 },
  alpine: { low: [98, 138, 78], mid: [124, 150, 96], high: [128, 124, 116], rock: [120, 118, 116], snow: [246, 248, 252], sand: [190, 180, 154], forest: [36, 70, 46], shallow: [64, 146, 156], deep: [14, 52, 78], snowLine: 150 },
};

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function sstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function hash(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** color for a terrain sample */
function terrainColor(p: MapPalette, h: number, slope: number, forest: number, px: number, py: number): RGB {
  if (h < 0) return mix(p.shallow, p.deep, sstep(0, 22, -h));
  let c: RGB = h < 40 ? mix(p.low, p.mid, h / 40) : h < 120 ? mix(p.mid, p.high, (h - 40) / 80) : mix(p.high, p.rock, Math.min(1, (h - 120) / 80));
  c = mix(c, p.rock, sstep(0.35, 0.8, slope));
  if (forest > 0) {
    const n = hash(px, py);
    c = mix(c, p.forest, Math.min(1, forest * (0.75 + 0.35 * n)));
  }
  c = mix(c, p.sand, 1 - sstep(0.8, 2.6, h));
  c = mix(c, p.snow, sstep(p.snowLine, p.snowLine + 25, h) * (1 - sstep(0.6, 1.2, slope)));
  return c;
}

export interface CityMapOptions {
  /** draw zones / roads / buildings */
  city?: boolean;
  /** vertical exaggeration of the hillshade */
  relief?: number;
}

/** Render a city's terrain (and optionally its zones / networks / buildings) into a canvas (canvas size = output). */
export function drawCityMap(canvas: HTMLCanvasElement, st: CityState, opts: CityMapOptions = {}): void {
  const W = canvas.width, Hh = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, Hh);
  const d = img.data;
  const N = st.size, N1 = N + 1;
  const H = st.heights;
  const pal = PALETTES[st.config.climate] ?? PALETTES.temperate;
  const relief = opts.relief ?? 1;
  const cellM = 16 * (st.config.size / N >= 1 ? 1 : 1);
  const sampleH = (fx: number, fz: number) => {
    fx = Math.min(Math.max(fx, 0), N - 0.0001);
    fz = Math.min(Math.max(fz, 0), N - 0.0001);
    const x = Math.floor(fx), z = Math.floor(fz);
    const tx = fx - x, tz = fz - z;
    const i = z * N1 + x;
    return (H[i] * (1 - tx) + H[i + 1] * tx) * (1 - tz) + (H[i + N1] * (1 - tx) + H[i + N1 + 1] * tx) * tz;
  };
  const lx = -0.6, lz = -0.55, ly = 0.58;
  const zoneCol: Record<number, RGB> = {
    [Zone.ResLow]: [96, 200, 110], [Zone.ResMed]: [70, 180, 90], [Zone.ResHigh]: [50, 150, 70],
    [Zone.ComLow]: [96, 150, 230], [Zone.ComMed]: [70, 125, 220], [Zone.ComHigh]: [50, 100, 200],
    [Zone.IndAg]: [200, 190, 90], [Zone.IndMed]: [225, 180, 60], [Zone.IndHigh]: [230, 160, 40], [Zone.Landfill]: [140, 110, 80],
  };
  for (let py = 0; py < Hh; py++) {
    const fz = ((py + 0.5) / Hh) * N;
    for (let px = 0; px < W; px++) {
      const fx = ((px + 0.5) / W) * N;
      const h = sampleH(fx, fz);
      const e = 0.5;
      const dx = (sampleH(fx + e, fz) - sampleH(fx - e, fz)) / (2 * e * cellM);
      const dz = (sampleH(fx, fz + e) - sampleH(fx, fz - e)) / (2 * e * cellM);
      const slope = Math.sqrt(dx * dx + dz * dz);
      const cx = Math.min(N - 1, Math.floor(fx)), cz = Math.min(N - 1, Math.floor(fz));
      const ci = cz * N + cx;
      // bilinear tree density (cell centres) for a soft canopy
      const gx = Math.min(Math.max(fx - 0.5, 0), N - 1.001), gz = Math.min(Math.max(fz - 0.5, 0), N - 1.001);
      const tx0 = Math.floor(gx), tz0 = Math.floor(gz), ftx = gx - tx0, ftz = gz - tz0;
      const ti = tz0 * N + tx0;
      const tv = (st.trees[ti] * (1 - ftx) + st.trees[Math.min(ti + 1, st.cells - 1)] * ftx) * (1 - ftz) + (st.trees[Math.min(ti + N, st.cells - 1)] * (1 - ftx) + st.trees[Math.min(ti + N + 1, st.cells - 1)] * ftx) * ftz;
      const trees = opts.city ? st.trees[ci] / 4 : tv / 4;
      let c = terrainColor(pal, h, slope, h > 0 ? trees * 0.85 : 0, px, py);
      // hillshade
      const nx = -dx * relief * 2.2, nz = -dz * relief * 2.2;
      const nl = 1 / Math.sqrt(nx * nx + nz * nz + 1);
      let shade = (nx * lx + nz * lz + ly) * nl;
      shade = h < 0 ? 0.9 + shade * 0.1 : 0.5 + shade * 0.75;
      if (opts.city) {
        const z = st.zone[ci];
        const net = st.network[ci];
        const b = st.building[ci];
        if (z && zoneCol[z]) c = mix(c, zoneCol[z], b >= 0 ? 0.35 : 0.55);
        if (b >= 0) {
          const bb = st.buildings.get(b);
          const lvl = bb ? Math.min(1, bb.capacity / (bb.w * bb.d * 60)) : 0.3;
          c = mix(c, [236, 232, 222], 0.55 - lvl * 0.25);
          const ex = fx - Math.floor(fx), ez = fz - Math.floor(fz);
          if (bb && (ex < 0.12 || ez < 0.12)) c = mix(c, [60, 60, 70], 0.4);
        }
        if (net) {
          const col: RGB = net === Network.Rail ? [120, 96, 80] : net === Network.Highway ? [70, 72, 80] : [88, 90, 96];
          c = mix(c, col, 0.9);
          shade = Math.max(shade, 0.85);
        }
        if (st.powerLines[ci] && !net) c = mix(c, [180, 170, 120], 0.25);
      }
      const o = (py * W + px) * 4;
      d[o] = Math.min(255, c[0] * shade);
      d[o + 1] = Math.min(255, c[1] * shade);
      d[o + 2] = Math.min(255, c[2] * shade);
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Render a region overview (square) into a canvas; optionally outline tiles. */
export function drawRegionMap(canvas: HTMLCanvasElement, model: RegionModel, opts: { tiles?: boolean; founded?: boolean } = {}): void {
  const W = canvas.width, Hh = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, Hh);
  const d = img.data;
  const pal = PALETTES[model.data.climate] ?? PALETTES.temperate;
  const SX = model.sizeX, SZ = model.sizeZ;
  // cover-fit a square region into the canvas
  const s = Math.max(W, Hh);
  const ox = (W - s) / 2, oy = (Hh - s) / 2;
  const mpp = SX / s;
  const lx = -0.6, lz = -0.55, ly = 0.58;
  for (let py = 0; py < Hh; py++) {
    for (let px = 0; px < W; px++) {
      const x = ((px - ox + 0.5) / s) * SX, z = ((py - oy + 0.5) / s) * SZ;
      const h = model.heightAt(x, z);
      const e = mpp;
      const dx = (model.gridHeight(x + e, z) - model.gridHeight(x - e, z)) / (2 * e);
      const dz = (model.gridHeight(x, z + e) - model.gridHeight(x, z - e)) / (2 * e);
      const slope = Math.sqrt(dx * dx + dz * dz) * 6;
      const c = terrainColor(pal, h, slope, h > 0 ? model.forestAt(x, z) * 0.7 : 0, px, py);
      const nx = -dx * 14, nz = -dz * 14;
      const nl = 1 / Math.sqrt(nx * nx + nz * nz + 1);
      let shade = (nx * lx + nz * lz + ly) * nl;
      shade = h < 0 ? 0.92 + shade * 0.08 : 0.5 + shade * 0.75;
      const o = (py * W + px) * 4;
      d[o] = Math.min(255, c[0] * shade);
      d[o + 1] = Math.min(255, c[1] * shade);
      d[o + 2] = Math.min(255, c[2] * shade);
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (opts.tiles) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    const u = s / 16;
    for (const t of model.data.tiles) {
      if (opts.founded && t.city) {
        ctx.fillStyle = 'rgba(255, 196, 120, 0.35)';
        ctx.fillRect(ox + t.x * u, oy + t.z * u, t.size * u, t.size * u);
      }
      ctx.strokeRect(ox + t.x * u + 0.5, oy + t.z * u + 0.5, t.size * u - 1, t.size * u - 1);
    }
    ctx.restore();
  }
}

/** top-down 2D thumbnail of a city (fallback when no 3D capture is available) */
export function cityThumbnail(st: CityState, px = 256): string {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  drawCityMap(c, st, { city: true });
  return c.toDataURL('image/jpeg', 0.85);
}

export function regionPreviewDataUrl(model: RegionModel, w = 320, h = 200): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  drawRegionMap(c, model, { tiles: true, founded: true });
  return c.toDataURL('image/jpeg', 0.82);
}

/**
 * Resize / recompress a thumbnail data URL (e.g. a PNG from WorldViewApi.capture) to a square JPEG of `px`
 * pixels (center-cropped), to keep region saves small. Resolves to the input if decoding fails.
 */
export function normalizeThumbnail(dataUrl: string, px: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = px;
        const ctx = c.getContext('2d')!;
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, px, px);
        resolve(c.toDataURL('image/jpeg', 0.86));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
