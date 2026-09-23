/**
 * Procedural, tileable textures generated once at startup (no image assets needed):
 *  - noise texture (RGBA8): R low-freq fbm, G mid fbm, B high-freq fbm, A cellular/ridged — used by terrain + water
 *  - detail normal map (RGBA8, tangent space xy in RG, packed) for water waves & ground micro relief
 * All textures are mipmapped + repeat-wrapped so sampling at any scale is alias free.
 */
import * as THREE from 'three';

function hash3(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** periodic gradient (Perlin) noise, period p lattice cells, returns ~[-1,1] */
function pnoise(x: number, y: number, p: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const a = hash3(((ix % p) + p) % p, ((iy % p) + p) % p, seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const n00 = g(xi, yi, xf, yf);
  const n10 = g(xi + 1, yi, xf - 1, yf);
  const n01 = g(xi, yi + 1, xf, yf - 1);
  const n11 = g(xi + 1, yi + 1, xf - 1, yf - 1);
  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return (nx0 + (nx1 - nx0) * v) * 1.414;
}

function pfbm(u: number, v: number, period: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise(u * p, v * p, p, seed + o * 31);
    norm += amp;
    amp *= gain;
    p *= 2;
  }
  return sum / norm;
}

/** periodic cellular (worley F1) noise, returns [0,1] */
function pcell(u: number, v: number, p: number, seed: number): number {
  const x = u * p, y = v * p;
  const xi = Math.floor(x), yi = Math.floor(y);
  let d = 9;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const wx = ((cx % p) + p) % p, wy = ((cy % p) + p) % p;
      const px = cx + hash3(wx, wy, seed), py = cy + hash3(wx, wy, seed + 7);
      const dd = (px - x) * (px - x) + (py - y) * (py - y);
      if (dd < d) d = dd;
    }
  return Math.min(1, Math.sqrt(d));
}

function finish(tex: THREE.DataTexture, srgb = false): THREE.DataTexture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let _noise: THREE.DataTexture | null = null;
/** RGBA tileable noise: R fbm (4 cells), G fbm (8), B fbm (32), A cellular (16). Values centered at 0.5. */
export function getNoiseTexture(size = 256): THREE.DataTexture {
  if (_noise) return _noise;
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      const r = pfbm(u, v, 4, 5, 11) * 0.5 + 0.5;
      const g = pfbm(u, v, 8, 4, 23) * 0.5 + 0.5;
      const b = pfbm(u, v, 32, 3, 37) * 0.5 + 0.5;
      const a = pcell(u, v, 16, 41);
      const k = (j * size + i) * 4;
      data[k] = Math.max(0, Math.min(255, r * 255));
      data[k + 1] = Math.max(0, Math.min(255, g * 255));
      data[k + 2] = Math.max(0, Math.min(255, b * 255));
      data[k + 3] = Math.max(0, Math.min(255, a * 255));
    }
  }
  _noise = finish(new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType));
  _noise.name = 'world-noise';
  return _noise;
}

let _waveNormal: THREE.DataTexture | null = null;
/**
 * Tileable wave normal map (tangent space, packed 0..1, +Z up in B). Built from a height field of
 * periodic noise with anisotropic stretching to look like wind-driven ripples.
 */
export function getWaveNormalTexture(size = 256): THREE.DataTexture {
  if (_waveNormal) return _waveNormal;
  const h = new Float32Array(size * size);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      // sum of a few wave-ish octaves (stretched along x -> crests along y)
      let s = pfbm(u, v, 6, 4, 101, 0.55) * 0.6;
      s += Math.abs(pfbm(u, v, 12, 3, 131, 0.5)) * -0.35;
      s += pfbm(u, v, 24, 2, 151) * 0.15;
      h[j * size + i] = s;
    }
  const data = new Uint8Array(size * size * 4);
  const strength = 5.5;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const l = h[j * size + ((i - 1 + size) % size)], r = h[j * size + ((i + 1) % size)];
      const d = h[((j - 1 + size) % size) * size + i], t = h[((j + 1) % size) * size + i];
      let nx = (l - r) * strength, ny = (d - t) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const k = (j * size + i) * 4;
      data[k] = (nx * 0.5 + 0.5) * 255;
      data[k + 1] = (ny * 0.5 + 0.5) * 255;
      data[k + 2] = (nz * 0.5 + 0.5) * 255;
      data[k + 3] = (h[j * size + i] * 0.5 + 0.5) * 255;
    }
  _waveNormal = finish(new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType));
  _waveNormal.name = 'wave-normal';
  return _waveNormal;
}

/** Tiny 1D ramp texture (N x 1 RGBA8) from css color stops [{t, color, a}] */
export function makeRampTexture(stops: { t: number; color: string | number; a?: number }[], width = 128, target?: THREE.DataTexture): THREE.DataTexture {
  const data = target ? (target.image.data as Uint8Array) : new Uint8Array(width * 4);
  const w = target ? target.image.width : width;
  const c0 = new THREE.Color(), c1 = new THREE.Color();
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  for (let i = 0; i < w; i++) {
    const t = i / (w - 1);
    let k = 0;
    while (k < sorted.length - 2 && t > sorted[k + 1].t) k++;
    const a = sorted[k], b = sorted[Math.min(k + 1, sorted.length - 1)];
    const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    c0.set(a.color as THREE.ColorRepresentation);
    c1.set(b.color as THREE.ColorRepresentation);
    // interpolate in sRGB space for pleasant ramps; the texture is flagged sRGB
    const ca = c0.convertLinearToSRGB(), cb = c1.convertLinearToSRGB();
    const aa = a.a ?? 1, ab = b.a ?? 1;
    data[i * 4] = Math.round((ca.r + (cb.r - ca.r) * f) * 255);
    data[i * 4 + 1] = Math.round((ca.g + (cb.g - ca.g) * f) * 255);
    data[i * 4 + 2] = Math.round((ca.b + (cb.b - ca.b) * f) * 255);
    data[i * 4 + 3] = Math.round((aa + (ab - aa) * f) * 255);
  }
  if (target) {
    target.needsUpdate = true;
    return target;
  }
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
