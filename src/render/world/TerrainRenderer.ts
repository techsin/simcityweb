/**
 * TerrainRenderer — chunked terrain meshes (CHUNK x CHUNK cells each, 1 vertex per height corner, smooth normals),
 * an "outer" terrain ring that continues the landscape to the horizon, and all terrain-draped data textures
 * (height, zones, trees, overlay heatmap, tool highlights).
 *
 * Height texture layout (exposed as WorldView.heightTexture): (N+1) x (N+1) texels, R = height in meters
 * (half float, linear filtered). Texel (x, z) = corner (x, z). World (wx, wz) -> uv = ((wx / 16 + 0.5) / (N+1), (wz / 16 + 0.5) / (N+1)).
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../core/constants';
import { Noise2D, clamp, smoothstep } from '../../core/rng';
import type { CellRect } from '../../core/events';
import { Overlay, type Climate, type TerrainPreset } from '../../core/types';
import type { CityState } from '../../sim/CityState';
import { getNoiseTexture, makeRampTexture } from './textures';
import { OVERLAYS, ZONE_COLORS, computeOverlayValues } from './overlays';
import { TERRAIN_FRAG_COLOR, TERRAIN_FRAG_PARS, TERRAIN_VERT_MAIN, TERRAIN_VERT_PARS } from './terrainShader';
import { receiverSweepBox, type ShadowReceiver } from './Shadows';

export const TERRAIN_CHUNK = 32;

interface Chunk {
  mesh: THREE.Mesh;
  cx: number;
  cz: number;
  pos: Float32Array;
  nrm: Float32Array;
}

/** climate palettes (sRGB hex): grassA, grassB(dry), grassC(dark), forestFloor, dirt, rockA, rockB, sand, wetSand, seabed, snow, cliff */
const PALETTES: Record<Climate, number[]> = {
  temperate: [0x4e6a2c, 0x7a7545, 0x3b5424, 0x2b3a1c, 0x6e5a40, 0x858075, 0x67625a, 0xcfc29a, 0x9a8c72, 0x7d735a, 0xdfe5ec, 0x524d46],
  desert: [0xa89262, 0xbfa477, 0x8f7a50, 0x746a45, 0xa67a4c, 0xae7350, 0x8a5a3e, 0xdcc08e, 0xae9672, 0x948666, 0xefede8, 0x734632],
  tropical: [0x456f28, 0x68823a, 0x305e22, 0x1f3c18, 0x735638, 0x6c6a5c, 0x545446, 0xeee2c0, 0xc0b08c, 0xcdc19c, 0xf2f2f2, 0x48463d],
  alpine: [0x52703a, 0x767e52, 0x3b572b, 0x26361c, 0x655645, 0x8a8a86, 0x676865, 0xb3a98e, 0x8c836c, 0x6b6656, 0xe2e8ef, 0x51514f],
};

export class TerrainRenderer {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  readonly heightTexture: THREE.DataTexture;
  readonly uniforms;
  private state: CityState;
  private N: number;
  private chunksPerSide: number;
  private chunks: Chunk[] = [];
  private index: THREE.BufferAttribute;
  private outer: THREE.Mesh | null = null;
  private dirtyChunks = new Set<number>();
  private heightDirty = false;
  private outerDirty = false;
  private zoneDirty = false;
  private treeDirty = false;
  private overlayDirty = false;
  private overlay: Overlay = Overlay.None;
  private heightData: Uint16Array;
  private zoneData: Uint8Array;
  private zoneTex: THREE.DataTexture;
  private treeData: Uint8Array;
  private treeTex: THREE.DataTexture;
  private overlayData: Uint8Array;
  private overlayTex: THREE.DataTexture;
  private rampTex: THREE.DataTexture;
  private hlData: Uint8Array;
  private hlTex: THREE.DataTexture;
  private lightData: Uint8Array;
  /** N x N city light density (R8, linear): buildings 1, roads ~0.35 — used for night reflections on water */
  readonly lightTexture: THREE.DataTexture;
  private hlCells: number[] = [];
  private noise: Noise2D;
  private noise2: Noise2D;
  private edgeMean = 0;
  private outerAmp = 20;
  private detail: 0 | 1 | 2 = 2;
  private castShadows = true;

  constructor(state: CityState, detail: 0 | 1 | 2 = 2, castShadows = true) {
    this.state = state;
    this.N = state.size;
    this.detail = detail;
    this.castShadows = castShadows;
    const N = this.N;
    this.chunksPerSide = Math.ceil(N / TERRAIN_CHUNK);
    this.noise = new Noise2D(state.config.seed + 555);
    this.noise2 = new Noise2D(state.config.seed + 777);
    this.group.name = 'terrain';

    // --- data textures
    this.heightData = new Uint16Array((N + 1) * (N + 1));
    this.heightTexture = new THREE.DataTexture(this.heightData, N + 1, N + 1, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTexture.magFilter = this.heightTexture.minFilter = THREE.LinearFilter;
    this.heightTexture.wrapS = this.heightTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTexture.generateMipmaps = false;
    this.heightTexture.name = 'terrain-height';

    this.zoneData = new Uint8Array(N * N * 4);
    this.zoneTex = new THREE.DataTexture(this.zoneData, N, N, THREE.RGBAIntegerFormat, THREE.UnsignedByteType);
    this.zoneTex.internalFormat = 'RGBA8UI';
    this.zoneTex.magFilter = this.zoneTex.minFilter = THREE.NearestFilter;
    this.zoneTex.generateMipmaps = false;

    this.treeData = new Uint8Array(N * N);
    this.treeTex = new THREE.DataTexture(this.treeData, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    this.treeTex.magFilter = this.treeTex.minFilter = THREE.LinearFilter;
    this.treeTex.generateMipmaps = false;

    this.overlayData = new Uint8Array(N * N);
    this.overlayTex = new THREE.DataTexture(this.overlayData, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    this.overlayTex.magFilter = this.overlayTex.minFilter = THREE.LinearFilter;
    this.overlayTex.generateMipmaps = false;
    this.rampTex = makeRampTexture(OVERLAYS[Overlay.None].ramp);

    this.lightData = new Uint8Array(N * N);
    this.lightTexture = new THREE.DataTexture(this.lightData, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    this.lightTexture.magFilter = this.lightTexture.minFilter = THREE.LinearFilter;
    this.lightTexture.generateMipmaps = false;

    this.hlData = new Uint8Array(N * N * 4);
    this.hlTex = new THREE.DataTexture(this.hlData, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.hlTex.magFilter = this.hlTex.minFilter = THREE.NearestFilter;
    this.hlTex.generateMipmaps = false;

    const zoneCols: THREE.Color[] = [];
    for (let z = 0; z < 11; z++) zoneCols.push(new THREE.Color(ZONE_COLORS[z] ?? 0));

    this.uniforms = {
      uNoise: { value: getNoiseTexture() as THREE.Texture },
      uTreeTex: { value: this.treeTex as THREE.Texture },
      uZoneTexU: { value: this.zoneTex as THREE.Texture },
      uOverlayTex: { value: this.overlayTex as THREE.Texture },
      uRamp: { value: this.rampTex as THREE.Texture },
      uHlTex: { value: this.hlTex as THREE.Texture },
      uPal: { value: [] as THREE.Color[] },
      uZoneCol: { value: zoneCols },
      uN: { value: N },
      uCell: { value: CELL_SIZE },
      uSnowLine: { value: 9999 },
      uZoneMode: { value: 0 },
      uOverlayOn: { value: 0 },
      uGrid: { value: 0 },
      uHlOn: { value: 0 },
      uRect: { value: new THREE.Vector4() },
      uRectColor: { value: new THREE.Color(0x66ccff) },
      uRectOn: { value: 0 },
      uBrush: { value: new THREE.Vector4() },
      uNightF: { value: 0 },
      uDesert: { value: 0 },
    };
    this.applyClimate();

    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    this.material.name = 'terrain';
    this.patchMaterial();

    // shared index for all chunks
    const CH = TERRAIN_CHUNK;
    const idx = new Uint16Array(CH * CH * 6);
    let k = 0;
    for (let j = 0; j < CH; j++)
      for (let i = 0; i < CH; i++) {
        const a = j * (CH + 1) + i, b = a + 1, c = a + CH + 1, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    this.index = new THREE.BufferAttribute(idx, 1);

    this.computeEdgeStats();
    for (let cz = 0; cz < this.chunksPerSide; cz++)
      for (let cx = 0; cx < this.chunksPerSide; cx++) this.chunks.push(this.createChunk(cx, cz));
    this.rebuildAll();
  }

  private patchMaterial() {
    const u = this.uniforms;
    const detail = this.detail;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.defines = { ...(shader.defines ?? {}), TERRAIN_DETAIL: detail };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + TERRAIN_VERT_PARS)
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + TERRAIN_VERT_MAIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + TERRAIN_FRAG_PARS)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + TERRAIN_FRAG_COLOR)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tRough;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(tNormalW, 0.0)).xyz);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tEmis;');
    };
    this.material.customProgramCacheKey = () => `terrain-${detail}`;
    this.material.needsUpdate = true;
  }

  setQuality(detail: 0 | 1 | 2, castShadows: boolean) {
    if (detail !== this.detail) {
      this.detail = detail;
      this.patchMaterial();
    }
    this.castShadows = castShadows;
    for (const c of this.chunks) c.mesh.castShadow = castShadows;
  }

  private applyClimate() {
    const cfg = this.state.config;
    const pal = PALETTES[cfg.climate] ?? PALETTES.temperate;
    this.uniforms.uPal.value = pal.map((h) => new THREE.Color(h));
    let maxH = 0;
    for (let i = 0; i < this.state.heights.length; i++) maxH = Math.max(maxH, this.state.heights[i]);
    let snow = 9999;
    if (cfg.climate === 'alpine') snow = Math.max(35, maxH * 0.5);
    else if (cfg.climate === 'temperate') snow = Math.max(165, maxH * 0.78);
    this.uniforms.uSnowLine.value = snow;
    this.uniforms.uDesert.value = cfg.climate === 'desert' ? 1 : 0;
  }

  // ------------------------------------------------------------------ heights
  private computeEdgeStats() {
    const st = this.state, N = this.N;
    let s = 0, n = 0, mn = Infinity, mx = -Infinity;
    for (let i = 0; i <= N; i++) {
      for (const h of [st.cornerHeight(i, 0), st.cornerHeight(i, N), st.cornerHeight(0, i), st.cornerHeight(N, i)]) {
        s += h; n++;
      }
    }
    for (let i = 0; i < st.heights.length; i++) {
      mn = Math.min(mn, st.heights[i]);
      mx = Math.max(mx, st.heights[i]);
    }
    this.edgeMean = s / n;
    const preset: TerrainPreset = st.config.terrain;
    const range = Math.max(4, mx - Math.max(mn, 0));
    this.outerAmp = preset === 'flat' ? 3 : preset === 'mountains' ? range * 0.55 : range * 0.45;
  }

  /** height of the continuous landscape at any world position (map heights inside, synthetic outside). */
  worldHeight(wx: number, wz: number): number {
    const W = this.N * CELL_SIZE;
    if (wx >= 0 && wz >= 0 && wx <= W && wz <= W) return this.meshHeightAt(wx, wz);
    const cx = clamp(wx, 0, W), cz = clamp(wz, 0, W);
    const dx = wx - cx, dz = wz - cz;
    const d = Math.sqrt(dx * dx + dz * dz);
    const e = this.state.heightAt(cx, cz, CELL_SIZE);
    const t = smoothstep(0, 3500, d);
    const n1 = this.noise.fbm(wx / 3200, wz / 3200, d < 8000 ? 4 : 3) * this.outerAmp;
    // fine detail only matters near the map (invisible in the haze further out)
    const n2 = d < 4000 ? this.noise2.fbm(wx / 700, wz / 700, 3) * this.outerAmp * 0.25 * (1 - smoothstep(2500, 4000, d)) : 0;
    const base = Math.max(this.edgeMean, 2);
    let land = e * (1 - t) + (base + n1 + this.outerAmp * 0.25) * t + n2 * smoothstep(0, 600, d);
    // far horizon slowly flattens
    land = land * (1 - smoothstep(14000, 30000, d) * 0.6);
    const seaDeep = e - d * 0.004 - smoothstep(0, 2500, d) * 12;
    const s = smoothstep(0.8, -2.5, e);
    // keep seas as seas and let some low land dip below the waterline far out (lakes / sea inlets)
    return land * (1 - s) + seaDeep * s;
  }

  /** height exactly matching the rendered triangulation (diagonal from (x+1,z) to (x,z+1)). */
  meshHeightAt(wx: number, wz: number): number {
    const N = this.N;
    const fx = clamp(wx / CELL_SIZE, 0, N - 1e-6), fz = clamp(wz / CELL_SIZE, 0, N - 1e-6);
    const x = Math.floor(fx), z = Math.floor(fz);
    const tx = fx - x, tz = fz - z;
    const N1 = N + 1, H = this.state.heights;
    const i = z * N1 + x;
    const a = H[i], b = H[i + 1], c = H[i + N1], d = H[i + N1 + 1];
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  private cornerH(x: number, z: number): number {
    const N = this.N;
    if (x >= 0 && z >= 0 && x <= N && z <= N) return this.state.heights[z * (N + 1) + x];
    return this.worldHeight(x * CELL_SIZE, z * CELL_SIZE);
  }

  private createChunk(cx: number, cz: number): Chunk {
    const CH = TERRAIN_CHUNK;
    const nv = (CH + 1) * (CH + 1);
    const pos = new Float32Array(nv * 3);
    const nrm = new Float32Array(nv * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(this.index);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = `terrain-${cx}-${cz}`;
    mesh.receiveShadow = true;
    mesh.castShadow = this.castShadows;
    mesh.matrixAutoUpdate = false;
    // shadow passes: a chunk only casts if its shadow (swept away from the sun down to the lowest ground) can reach
    // the part of the view the cascade shades (flat chunks outside the view slice never can)
    mesh.intersectsFrustum = (f: THREE.Frustum) => {
      const b = geo.boundingBox;
      if (!b) return f.intersectsObject(mesh);
      if (!f.intersectsBox(b)) return false;
      const recv = (f as unknown as { recv?: ShadowReceiver }).recv;
      return !recv || receiverSweepBox(recv, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
    };
    // chunks beyond the map (non multiple sizes) are clipped by the index count
    const N = this.N;
    const w = Math.min(CH, N - cx * CH), d = Math.min(CH, N - cz * CH);
    if (w < CH || d < CH) {
      // build a custom index for partial chunks
      const idx: number[] = [];
      for (let j = 0; j < d; j++)
        for (let i = 0; i < w; i++) {
          const a = j * (CH + 1) + i, b = a + 1, c = a + CH + 1, dd = c + 1;
          idx.push(a, c, b, b, c, dd);
        }
      geo.setIndex(idx);
    }
    this.group.add(mesh);
    return { mesh, cx, cz, pos, nrm };
  }

  private buildChunk(ch: Chunk) {
    const CH = TERRAIN_CHUNK, N = this.N;
    const { pos, nrm } = ch;
    let minY = Infinity, maxY = -Infinity;
    for (let j = 0; j <= CH; j++) {
      for (let i = 0; i <= CH; i++) {
        const x = Math.min(ch.cx * CH + i, N), z = Math.min(ch.cz * CH + j, N);
        const k = (j * (CH + 1) + i) * 3;
        const h = this.cornerH(x, z);
        pos[k] = x * CELL_SIZE;
        pos[k + 1] = h;
        pos[k + 2] = z * CELL_SIZE;
        const hl = this.cornerH(x - 1, z), hr = this.cornerH(x + 1, z);
        const hd = this.cornerH(x, z - 1), hu = this.cornerH(x, z + 1);
        let nx = hl - hr, ny = 2 * CELL_SIZE, nz = hd - hu;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= l; ny /= l; nz /= l;
        nrm[k] = nx; nrm[k + 1] = ny; nrm[k + 2] = nz;
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }
    const g = ch.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    const x0 = ch.cx * CH * CELL_SIZE, z0 = ch.cz * CH * CELL_SIZE;
    const x1 = Math.min((ch.cx + 1) * CH, N) * CELL_SIZE, z1 = Math.min((ch.cz + 1) * CH, N) * CELL_SIZE;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, minY, z0), new THREE.Vector3(x1, maxY, z1));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  }

  /**
   * Outer landscape: nested square LOD rings around the map (ring k: spacing 16 * 2^k m, ~16 cells wide).
   * The outermost vertex row of each ring interpolates odd vertices so it matches the next (coarser) ring exactly
   * -> no cracks. Ring 0's inner edge uses the exact map edge corners.
   */
  private buildOuter() {
    const N = this.N, W = N * CELL_SIZE;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const LEVELS = 7;
    const R = 16;
    let off = 0; // current inner offset from the map square
    const nv = new THREE.Vector3();
    for (let k = 0; k < LEVELS; k++) {
      const s = CELL_SIZE * (1 << k);
      if (W % s !== 0) break;
      let w = R * s;
      if ((off + w) % (2 * s) !== 0) w += s;
      const outer = off + w;
      const x0 = -outer, n = (W + 2 * outer) / s; // grid points 0..n
      const map = new Int32Array((n + 1) * (n + 1)).fill(-1);
      const hcache = new Float32Array((n + 3) * (n + 3)).fill(NaN);
      const hAt = (i: number, j: number): number => {
        const key = (j + 1) * (n + 3) + (i + 1);
        let h = hcache[key];
        if (h !== h) {
          h = this.worldHeight(x0 + i * s, x0 + j * s);
          hcache[key] = h;
        }
        return h;
      };
      const isInner = (i: number, j: number) => {
        // quad (i,j) lies inside the inner square?
        const qx0 = x0 + i * s, qz0 = x0 + j * s;
        return qx0 >= -off && qz0 >= -off && qx0 + s <= W + off && qz0 + s <= W + off;
      };
      const vert = (i: number, j: number): number => {
        const key = j * (n + 1) + i;
        let id = map[key];
        if (id >= 0) return id;
        const x = x0 + i * s, z = x0 + j * s;
        let h: number;
        const onOuterEdge = i === 0 || j === 0 || i === n || j === n;
        const odd = onOuterEdge && ((i === 0 || i === n) ? j % 2 === 1 : i % 2 === 1);
        if (odd) {
          // average of the two neighbours along the edge (matches the coarser ring's edge)
          h = i === 0 || i === n ? (hAt(i, j - 1) + hAt(i, j + 1)) * 0.5 : (hAt(i - 1, j) + hAt(i + 1, j)) * 0.5;
        } else {
          h = hAt(i, j);
        }
        nv.set(hAt(i - 1, j) - hAt(i + 1, j), 2 * s, hAt(i, j - 1) - hAt(i, j + 1)).normalize();
        id = positions.length / 3;
        positions.push(x, h, z);
        normals.push(nv.x, nv.y, nv.z);
        map[key] = id;
        return id;
      };
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          if (isInner(i, j)) continue;
          const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
          indices.push(a, c, b, b, c, d);
        }
      off = outer;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    if (this.outer) {
      this.outer.geometry.dispose();
      this.outer.geometry = geo;
    } else {
      this.outer = new THREE.Mesh(geo, this.material);
      this.outer.name = 'terrain-outer';
      this.outer.receiveShadow = true;
      this.outer.castShadow = false;
      this.outer.frustumCulled = false;
      this.outer.matrixAutoUpdate = false;
      this.group.add(this.outer);
    }
  }

  private uploadHeights() {
    const H = this.state.heights, D = this.heightData;
    for (let i = 0; i < H.length; i++) D[i] = THREE.DataUtils.toHalfFloat(H[i]);
    this.heightTexture.needsUpdate = true;
    this.heightVersion++;
  }

  private rebuildAll() {
    for (const c of this.chunks) this.buildChunk(c);
    this.buildOuter();
    this.uploadHeights();
    this.updateZones(0, 0, this.N, this.N);
    this.updateTrees(0, 0, this.N, this.N);
    this.zoneTex.needsUpdate = true;
    this.treeTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ events
  onTerrainChanged(r: CellRect) {
    const CH = TERRAIN_CHUNK;
    // normals depend on neighbours -> expand by one
    const x0 = Math.max(0, r.x0 - 1), z0 = Math.max(0, r.z0 - 1);
    const x1 = Math.min(this.N, r.x1 + 1), z1 = Math.min(this.N, r.z1 + 1);
    for (let cz = Math.floor(z0 / CH); cz <= Math.min(this.chunksPerSide - 1, Math.floor(z1 / CH)); cz++)
      for (let cx = Math.floor(x0 / CH); cx <= Math.min(this.chunksPerSide - 1, Math.floor(x1 / CH)); cx++) this.dirtyChunks.add(cz * this.chunksPerSide + cx);
    this.heightDirty = true;
    this.heightVersion++;
    if (r.x0 <= 1 || r.z0 <= 1 || r.x1 >= this.N - 1 || r.z1 >= this.N - 1) this.outerDirty = true;
    this.markCells(r);
  }

  /** zones / buildings / network / trees changed in rect -> refresh the tint & forest textures */
  markCells(_r: CellRect) {
    this.zoneDirty = true;
    this.treeDirty = true;
    if (this.overlay === Overlay.Power || this.overlay === Overlay.Water) this.overlayDirty = true;
  }

  onLayerUpdated(name: string) {
    if (this.overlay === Overlay.None || this.overlay === Overlay.Zones) return;
    const def = OVERLAYS[this.overlay];
    if (!def.layers.length || def.layers.includes(name)) this.overlayDirty = true;
  }

  private updateZones(x0: number, z0: number, x1: number, z1: number) {
    const st = this.state, N = this.N, D = this.zoneData;
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        const i = z * N + x;
        D[i * 4] = st.zone[i];
        D[i * 4 + 1] = st.building[i] >= 0 || st.network[i] !== 0 ? 1 : 0;
        this.lightData[i] = st.building[i] >= 0 ? 255 : st.network[i] !== 0 ? 90 : 0;
      }
    this.zoneTex.needsUpdate = true;
    this.lightTexture.needsUpdate = true;
  }

  /** effective tree density for rendering: 0 on developed / zoned / water cells */
  static cellBlocked(st: CityState, i: number): boolean {
    return st.water[i] === 1 || st.network[i] !== 0 || st.building[i] >= 0 || st.zone[i] !== 0 || st.powerLines[i] !== 0;
  }

  private updateTrees(x0: number, z0: number, x1: number, z1: number) {
    const st = this.state, N = this.N, D = this.treeData;
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        const i = z * N + x;
        D[i] = TerrainRenderer.cellBlocked(st, i) ? 0 : Math.round((st.trees[i] / 4) * 255);
      }
    this.treeTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ overlays & tools
  setOverlay(o: Overlay) {
    this.overlay = o;
    const u = this.uniforms;
    u.uZoneMode.value = o === Overlay.Zones ? 1 : 0;
    u.uOverlayOn.value = o !== Overlay.None && o !== Overlay.Zones ? 1 : 0;
    makeRampTexture(OVERLAYS[o]?.ramp ?? OVERLAYS[Overlay.None].ramp, 128, this.rampTex);
    this.overlayDirty = u.uOverlayOn.value > 0;
  }
  get currentOverlay(): Overlay {
    return this.overlay;
  }

  setGrid(v: boolean) {
    this.uniforms.uGrid.value = v ? 1 : 0;
  }

  setHighlight(cells: { x: number; z: number; ok: boolean }[] | null, okColor = 0x4fe08a, badColor = 0xff4a3a) {
    const D = this.hlData, N = this.N;
    for (const i of this.hlCells) {
      D[i * 4] = D[i * 4 + 1] = D[i * 4 + 2] = D[i * 4 + 3] = 0;
    }
    this.hlCells.length = 0;
    if (cells && cells.length) {
      const ok = new THREE.Color(okColor), bad = new THREE.Color(badColor);
      for (const c of cells) {
        if (c.x < 0 || c.z < 0 || c.x >= N || c.z >= N) continue;
        const i = c.z * N + c.x;
        const col = c.ok ? ok : bad;
        D[i * 4] = Math.round(col.r * 255);
        D[i * 4 + 1] = Math.round(col.g * 255);
        D[i * 4 + 2] = Math.round(col.b * 255);
        D[i * 4 + 3] = 255;
        this.hlCells.push(i);
      }
    }
    this.uniforms.uHlOn.value = this.hlCells.length ? 1 : 0;
    this.hlTex.needsUpdate = true;
  }

  setHighlightRect(rect: CellRect | null, color: number) {
    const u = this.uniforms;
    if (!rect) {
      u.uRectOn.value = 0;
      return;
    }
    u.uRectOn.value = 1;
    u.uRect.value.set(Math.min(rect.x0, rect.x1), Math.min(rect.z0, rect.z1), Math.max(rect.x0, rect.x1), Math.max(rect.z0, rect.z1));
    u.uRectColor.value.set(color);
  }

  setBrush(center: { x: number; z: number } | null, radiusCells: number) {
    const b = this.uniforms.uBrush.value;
    if (!center) b.w = 0;
    else b.set(center.x, center.z, Math.max(0.5, radiusCells) * CELL_SIZE, 1);
  }

  setNight(n: number) {
    this.uniforms.uNightF.value = n;
  }

  /** per-frame: apply pending rebuilds (bounded work per frame) */
  update(): void {
    if (this.dirtyChunks.size) {
      let budget = 6;
      for (const id of this.dirtyChunks) {
        this.buildChunk(this.chunks[id]);
        this.dirtyChunks.delete(id);
        if (--budget <= 0) break;
      }
    }
    if (this.heightDirty && this.dirtyChunks.size === 0) {
      this.heightDirty = false;
      this.uploadHeights();
      this.computeEdgeStats();
    }
    if (this.outerDirty && this.dirtyChunks.size === 0) {
      this.outerDirty = false;
      this.buildOuter();
    }
    if (this.zoneDirty) {
      this.zoneDirty = false;
      this.updateZones(0, 0, this.N, this.N);
    }
    if (this.treeDirty) {
      this.treeDirty = false;
      this.updateTrees(0, 0, this.N, this.N);
    }
    if (this.overlayDirty) {
      this.overlayDirty = false;
      computeOverlayValues(this.state, this.overlay, this.overlayData);
      this.overlayTex.needsUpdate = true;
    }
  }

  /** full rebuild (after load / reset) */
  reset(state: CityState) {
    if (state.size !== this.N) throw new Error('TerrainRenderer.reset: size mismatch; recreate WorldView');
    this.state = state;
    this.applyClimate();
    this.computeEdgeStats();
    this.rebuildAll();
    this.overlayDirty = true;
  }

  /** min / max terrain height (for camera clamping, raycasts) */
  heightRange(): [number, number] {
    if (this.rangeVersion !== this.heightVersion) {
      let mn = Infinity, mx = -Infinity;
      const H = this.state.heights;
      for (let i = 0; i < H.length; i++) {
        if (H[i] < mn) mn = H[i];
        if (H[i] > mx) mx = H[i];
      }
      this.range[0] = mn;
      this.range[1] = mx;
      this.rangeVersion = this.heightVersion;
    }
    return this.range;
  }
  private range: [number, number] = [0, 0];
  private rangeVersion = -1;
  private heightVersion = 0;

  dispose() {
    for (const c of this.chunks) c.mesh.geometry.dispose();
    this.outer?.geometry.dispose();
    this.material.dispose();
    this.heightTexture.dispose();
    this.zoneTex.dispose();
    this.treeTex.dispose();
    this.overlayTex.dispose();
    this.rampTex.dispose();
    this.hlTex.dispose();
    this.lightTexture.dispose();
  }
}
