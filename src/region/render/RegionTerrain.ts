/**
 * Region terrain renderer (three.js): heightfield mesh with a climate-aware terrain shader (grass / forest / rock /
 * sand / snow, baked sun shadows + AO), water with fresnel / sun glint / depth tint / shore foam, optional diorama
 * sides, tile borders + hover / selection highlight, and a draped atlas of founded-city thumbnails.
 * Shared by the title-screen background (sunset) and the region view (day).
 */
import * as THREE from 'three';
import type { Climate } from '../../core/types';
import { REGION_H, REGION_W } from '../../core/constants';
import { UNIT_M, type RegionModel } from '../RegionModel';
import type { RegionTile } from '../types';
import { TERRAIN_FRAG, TERRAIN_VERT, TREE_FRAG, TREE_VERT, WATER_FRAG, WATER_VERT } from './shaders';
import { RNG } from '../../core/rng';

export interface Lighting {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyAmb: THREE.Color;
  groundAmb: THREE.Color;
  fogColor: THREE.Color;
  fogSunColor: THREE.Color;
  fogDensity: number;
  fogHeight: number;
  skyHorizon: THREE.Color;
  skyZenith: THREE.Color;
  glow: THREE.Color;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  windows: THREE.Color;
  night: number;
  exposure: number;
}

const col = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
function sunVec(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(azimuthDeg), e = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).normalize();
}

export function makeLighting(kind: 'day' | 'sunset'): Lighting {
  if (kind === 'sunset')
    return {
      sunDir: sunVec(200, 5.5),
      sunColor: col('#ffa25c', 2.9),
      skyAmb: col('#6273b4', 0.5),
      groundAmb: col('#4d3848', 0.3),
      fogColor: col('#a98aa6', 0.85),
      fogSunColor: col('#ffae6a', 1.1),
      fogDensity: 1 / 24000,
      fogHeight: 800,
      skyHorizon: col('#ff9a62', 1.1),
      skyZenith: col('#15234f', 0.95),
      glow: col('#ff7434', 1.25),
      cloudLit: col('#ffb48c', 1.2),
      cloudShade: col('#5b4a74', 0.75),
      windows: col('#ffb468', 2.2),
      night: 1.0,
      exposure: 1.0,
    };
  return {
    sunDir: sunVec(222, 33),
    sunColor: col('#fff0d8', 2.0),
    skyAmb: col('#9fbde6', 0.5),
    groundAmb: col('#6a5d4a', 0.3),
    fogColor: col('#b3c9df', 0.95),
    fogSunColor: col('#f1e2c6', 1.0),
    fogDensity: 1 / 150000,
    fogHeight: 3000,
    skyHorizon: col('#c5dbef', 0.95),
    skyZenith: col('#4f86c8', 0.9),
    glow: col('#fff0d0', 0.4),
    cloudLit: col('#ffffff', 1.0),
    cloudShade: col('#a0b0c8', 0.9),
    windows: col('#ffd9a0', 1.2),
    night: 0.0,
    exposure: 0.95,
  };
}

export interface Palette {
  grassA: THREE.Color;
  grassB: THREE.Color;
  forest: THREE.Color;
  rock: THREE.Color;
  rock2: THREE.Color;
  sand: THREE.Color;
  snow: THREE.Color;
  wet: THREE.Color;
  soil: THREE.Color;
  shallow: THREE.Color;
  deep: THREE.Color;
  snowLine: number;
}

export function paletteFor(climate: Climate): Palette {
  switch (climate) {
    case 'desert':
      return {
        grassA: col('#c69a62'), grassB: col('#d9b37c'), forest: col('#6d7a3c'), rock: col('#a0583c'), rock2: col('#c47d52'),
        sand: col('#e6cf9c'), snow: col('#f4f0e8'), wet: col('#6f7a6a'), soil: col('#8d5a3a'),
        shallow: col('#3fb2b0'), deep: col('#0c4a6a'), snowLine: 9999,
      };
    case 'tropical':
      return {
        grassA: col('#4f9a3a'), grassB: col('#7cb24a'), forest: col('#1d6a2e'), rock: col('#6b6558'), rock2: col('#8a8272'),
        sand: col('#f0e3b6'), snow: col('#f4f6fa'), wet: col('#6aa89a'), soil: col('#7a5a3a'),
        shallow: col('#35d0c8'), deep: col('#07568a'), snowLine: 9999,
      };
    case 'alpine':
      return {
        grassA: col('#5b8748'), grassB: col('#809c5c'), forest: col('#22442c'), rock: col('#6c6a68'), rock2: col('#8e8a84'),
        sand: col('#bdb399'), snow: col('#f6f8fc'), wet: col('#586e6c'), soil: col('#6a5642'),
        shallow: col('#3b8f98'), deep: col('#0b3148'), snowLine: 150,
      };
    default:
      return {
        grassA: col('#58823a'), grassB: col('#7d9a47'), forest: col('#264d26'), rock: col('#756c61'), rock2: col('#948a7b'),
        sand: col('#d8c696'), snow: col('#f4f6fa'), wet: col('#5e7f76'), soil: col('#735840'),
        shallow: col('#2aa3b0'), deep: col('#07345e'), snowLine: 215,
      };
  }
}

export interface RegionTerrainOptions {
  exaggeration?: number;
  lighting: Lighting;
  /** vertex stride over the region grid (1 = every sample) */
  stride?: number;
  /** diorama sides + water curtains */
  sides?: boolean;
  /** water plane size beyond the region (m) on each side (menu ocean) */
  oceanMargin?: number;
  /** show tile borders / hover */
  tiles?: boolean;
  /** number of instanced trees to scatter over forests (0 = none) */
  trees?: number;
}

const DEPTH_SCALE = 40;

export class RegionTerrain {
  readonly group = new THREE.Group();
  readonly exag: number;
  readonly terrainMat: THREE.ShaderMaterial;
  readonly waterMat: THREE.ShaderMaterial;
  readonly model: RegionModel;
  readonly cityCanvas: HTMLCanvasElement;
  private cityCtx: CanvasRenderingContext2D;
  private cityTex: THREE.CanvasTexture;
  private tileTex: THREE.DataTexture;
  private depthTex: THREE.DataTexture;
  /** exaggerated vertex heights (vertex grid) for picking */
  private vh: Float32Array;
  private vn: number;
  private vnz: number;
  private vspacing: number;
  private disposables: { dispose(): void }[] = [];
  private treeMesh: THREE.InstancedMesh | null = null;
  private treeData: Float32Array | null = null; // x, y, z, scale, rot per tree
  private treeColors: THREE.Color[] = [];
  private treeConifer: Uint8Array | null = null;

  constructor(model: RegionModel, opts: RegionTerrainOptions) {
    this.model = model;
    this.exag = opts.exaggeration ?? 2;
    const L = opts.lighting;
    const pal = paletteFor(model.data.climate);
    const t = model.terrain;
    const stride = opts.stride ?? 1;
    const nx = Math.floor((t.resX - 1) / stride) + 1;
    const nz = Math.floor((t.resZ - 1) / stride) + 1;
    const sp = t.spacing * stride;
    this.vn = nx;
    this.vnz = nz;
    this.vspacing = sp;
    const exag = this.exag;

    // ---- vertex data ---------------------------------------------------------------------------------------
    const trueH = new Float32Array(nx * nz);
    const yH = new Float32Array(nx * nz);
    const forest = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = i * sp, z = j * sp;
        const h = model.heightAt(x, z);
        trueH[k] = h;
        yH[k] = h * exag;
        forest[k] = t.forest[Math.min(t.resZ - 1, j * stride) * t.resX + Math.min(t.resX - 1, i * stride)];
      }
    this.vh = yH;
    const shadow = bakeShadow(yH, nx, nz, sp, L.sunDir);
    const ao = bakeAO(yH, nx, nz, sp, exag);

    const pos = new Float32Array(nx * nz * 3);
    const nor = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        pos[k * 3] = i * sp;
        pos[k * 3 + 1] = yH[k];
        pos[k * 3 + 2] = j * sp;
        const hl = yH[j * nx + Math.max(0, i - 1)], hr = yH[j * nx + Math.min(nx - 1, i + 1)];
        const hu = yH[Math.max(0, j - 1) * nx + i], hd = yH[Math.min(nz - 1, j + 1) * nx + i];
        const v = new THREE.Vector3(-(hr - hl) / (2 * sp), 1, -(hd - hu) / (2 * sp)).normalize();
        nor[k * 3] = v.x;
        nor[k * 3 + 1] = v.y;
        nor[k * 3 + 2] = v.z;
      }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let q = 0;
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('aForest', new THREE.BufferAttribute(forest, 1));
    geo.setAttribute('aShadow', new THREE.BufferAttribute(shadow, 1));
    geo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
    geo.setAttribute('aHeight', new THREE.BufferAttribute(trueH, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(nx * nz), 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    this.disposables.push(geo);

    // ---- textures -------------------------------------------------------------------------------------------
    this.tileTex = new THREE.DataTexture(new Uint8Array(REGION_W * REGION_H * 4), REGION_W, REGION_H, THREE.RGBAFormat);
    this.tileTex.magFilter = THREE.NearestFilter;
    this.tileTex.minFilter = THREE.NearestFilter;
    this.disposables.push(this.tileTex);
    this.updateTiles();

    const depth = new Uint8Array(t.resX * t.resZ * 4);
    for (let j = 0; j < t.resZ; j++)
      for (let i = 0; i < t.resX; i++) {
        const h = stride === 1 ? trueH[j * nx + i] : model.heightAt(i * t.spacing, j * t.spacing);
        const k = (j * t.resX + i) * 4;
        depth[k] = Math.round(THREE.MathUtils.clamp(-h / DEPTH_SCALE, 0, 1) * 255);
        depth[k + 1] = h > 0 ? 255 : 0;
        depth[k + 3] = 255;
      }
    this.depthTex = new THREE.DataTexture(depth, t.resX, t.resZ, THREE.RGBAFormat);
    this.depthTex.magFilter = THREE.LinearFilter;
    this.depthTex.minFilter = THREE.LinearFilter;
    this.depthTex.needsUpdate = true;
    this.disposables.push(this.depthTex);

    this.cityCanvas = document.createElement('canvas');
    this.cityCanvas.width = REGION_W * 128;
    this.cityCanvas.height = REGION_H * 128;
    this.cityCtx = this.cityCanvas.getContext('2d')!;
    this.cityTex = new THREE.CanvasTexture(this.cityCanvas);
    this.cityTex.colorSpace = THREE.SRGBColorSpace;
    this.cityTex.anisotropy = 4;
    this.disposables.push(this.cityTex);

    const regionSize = new THREE.Vector2(model.sizeX, model.sizeZ);
    const fogU = {
      uFogColor: { value: L.fogColor },
      uFogSunColor: { value: L.fogSunColor },
      uFogDensity: { value: L.fogDensity },
      uFogHeight: { value: L.fogHeight },
    };
    this.terrainMat = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      uniforms: {
        uSunDir: { value: L.sunDir },
        uSunColor: { value: L.sunColor },
        uSkyAmb: { value: L.skyAmb },
        uGroundAmb: { value: L.groundAmb },
        uGrassA: { value: pal.grassA },
        uGrassB: { value: pal.grassB },
        uForest: { value: pal.forest },
        uRock: { value: pal.rock },
        uRock2: { value: pal.rock2 },
        uSand: { value: pal.sand },
        uSnow: { value: pal.snow },
        uWet: { value: pal.wet },
        uSoil: { value: pal.soil },
        uSnowLine: { value: pal.snowLine },
        uTime: { value: 0 },
        uRegionSize: { value: regionSize },
        uUnits: { value: new THREE.Vector2(REGION_W, REGION_H) },
        uUnitM: { value: UNIT_M },
        uGridOpacity: { value: opts.tiles ? 0.2 : 0 },
        uCityOpacity: { value: 1 },
        uTileTex: { value: this.tileTex },
        uCityTex: { value: this.cityTex },
        uHover: { value: new THREE.Vector4(-1, -1, -1, -1) },
        uSelect: { value: new THREE.Vector4(-1, -1, -1, -1) },
        uAccent: { value: col('#3fa7ff', 1) },
        uPulse: { value: 0 },
        ...fogU,
      },
    });
    this.disposables.push(this.terrainMat);
    const terrain = new THREE.Mesh(geo, this.terrainMat);
    terrain.name = 'regionTerrain';
    terrain.frustumCulled = false;
    this.group.add(terrain);

    // ---- water ----------------------------------------------------------------------------------------------
    const margin = opts.oceanMargin ?? 0;
    const wgeo = new THREE.PlaneGeometry(model.sizeX + margin * 2, model.sizeZ + margin * 2, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    wgeo.translate(model.sizeX / 2, 0, model.sizeZ / 2);
    this.disposables.push(wgeo);
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uDepthTex: { value: this.depthTex },
        uRegionSize: { value: regionSize },
        uTime: { value: 0 },
        uSunDir: { value: L.sunDir },
        uSunColor: { value: L.sunColor },
        uShallow: { value: pal.shallow },
        uDeep: { value: pal.deep },
        uSkyHorizon: { value: L.skyHorizon },
        uSkyZenith: { value: L.skyZenith },
        uOutsideDepth: { value: 40 },
        uDepthScale: { value: DEPTH_SCALE },
        uSide: { value: 0 },
        ...fogU,
      },
    });
    this.disposables.push(this.waterMat);
    const water = new THREE.Mesh(wgeo, this.waterMat);
    water.name = 'regionWater';
    water.renderOrder = 2;
    water.frustumCulled = false;
    this.group.add(water);

    if (opts.sides) this.buildSides(trueH, nx, nz, sp, exag, fogU);
    if (opts.trees) this.buildTrees(opts.trees, L, fogU);
  }

  /** stylized low-poly trees scattered over forests (conifers in alpine / high ground, broadleaf elsewhere) */
  private buildTrees(count: number, L: Lighting, fogU: Record<string, THREE.IUniform>): void {
    const m = this.model;
    const climate = m.data.climate;
    const rng = new RNG(m.data.seed + 555);
    const data: number[] = [];
    const cols: THREE.Color[] = [];
    const con: number[] = [];
    const conifer = new THREE.Color('#2b4a2c'), broad = new THREE.Color('#3f6a2e'), broad2 = new THREE.Color('#58803a'), palm = new THREE.Color('#4f8a36'), dry = new THREE.Color('#7a7a3a');
    let tries = 0;
    while (data.length / 5 < count && tries < count * 12) {
      tries++;
      const x = rng.next() * m.sizeX, z = rng.next() * m.sizeZ;
      const f = m.forestAt(x, z);
      if (f < 0.12 || rng.next() > Math.pow(f, 1.3)) continue;
      const h = m.heightAt(x, z);
      if (h < 1.6) continue;
      const slope = Math.abs(m.gridHeight(x + 40, z) - m.gridHeight(x - 40, z)) + Math.abs(m.gridHeight(x, z + 40) - m.gridHeight(x, z - 40));
      if (slope > 60) continue;
      const s = rng.range(0.8, 1.3);
      data.push(x, this.surfaceY(x, z, false), z, s, rng.next() * Math.PI * 2);
      const isCon = climate === 'alpine' || h > 120 || (climate === 'temperate' && rng.chance(0.25));
      const c = (climate === 'desert' ? dry : climate === 'tropical' ? palm : isCon ? conifer : rng.chance(0.5) ? broad : broad2).clone();
      c.offsetHSL(rng.range(-0.02, 0.02), rng.range(-0.05, 0.05), rng.range(-0.05, 0.04));
      cols.push(c);
      con.push(isCon ? 1 : 0);
    }
    const n = data.length / 5;
    if (!n) return;
    // two shapes in one geometry is awkward with instancing: use a faceted cone-ish "crown" that reads as both
    const geo = new THREE.ConeGeometry(0.5, 1, 6, 1);
    geo.translate(0, 0.5, 0);
    const trunk = new THREE.CylinderGeometry(0.08, 0.1, 0.25, 5);
    trunk.translate(0, 0.05, 0);
    geo.translate(0, 0.15, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: TREE_VERT,
      fragmentShader: TREE_FRAG,
      uniforms: { uSunDir: { value: L.sunDir }, uSunColor: { value: L.sunColor }, uSkyAmb: { value: L.skyAmb }, uGroundAmb: { value: L.groundAmb }, ...fogU },
    });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    this.treeMesh = mesh;
    this.treeData = new Float32Array(data);
    this.treeColors = cols;
    this.treeConifer = new Uint8Array(con);
    this.disposables.push(geo, trunk, mat, mesh);
    this.layoutTrees();
    this.group.add(mesh);
  }

  /** (re)write tree instances, hiding trees on founded city tiles (their thumbnails show the real trees) */
  private layoutTrees(): void {
    const mesh = this.treeMesh, d = this.treeData;
    if (!mesh || !d) return;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const exag = this.exag;
    let k = 0;
    for (let i = 0; i < d.length / 5; i++) {
      const x = d[i * 5], y = d[i * 5 + 1], z = d[i * 5 + 2], s = d[i * 5 + 3], r = d[i * 5 + 4];
      const t = this.model.tileAtUnit(x / UNIT_M, z / UNIT_M);
      if (t?.city) continue;
      const con = this.treeConifer![i] === 1;
      const w = (con ? 13 : 19) * s, hh = (con ? 24 : 17) * s * Math.min(exag, 1.6);
      p.set(x, y - 1, z);
      q.setFromAxisAngle(up, r);
      sc.set(w, hh, w);
      mtx.compose(p, q, sc);
      mesh.setMatrixAt(k, mtx);
      mesh.setColorAt(k, this.treeColors[i]);
      k++;
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private buildSides(trueH: Float32Array, nx: number, nz: number, sp: number, exag: number, fogU: Record<string, THREE.IUniform>): void {
    const base = -140 * exag;
    const soilPos: number[] = [], soilNor: number[] = [], soilH: number[] = [];
    const watPos: number[] = [], watNor: number[] = [];
    const soilIdx: number[] = [], watIdx: number[] = [];
    const edges: { pts: [number, number][]; n: [number, number] }[] = [
      { pts: Array.from({ length: nx }, (_, i) => [i, 0] as [number, number]), n: [0, -1] },
      { pts: Array.from({ length: nx }, (_, i) => [nx - 1 - i, nz - 1] as [number, number]), n: [0, 1] },
      { pts: Array.from({ length: nz }, (_, j) => [0, nz - 1 - j] as [number, number]), n: [-1, 0] },
      { pts: Array.from({ length: nz }, (_, j) => [nx - 1, j] as [number, number]), n: [1, 0] },
    ];
    for (const e of edges) {
      const s0 = soilPos.length / 3, w0 = watPos.length / 3;
      for (const [i, j] of e.pts) {
        const h = trueH[j * nx + i];
        const x = i * sp, z = j * sp;
        const top = h * exag;
        soilPos.push(x, top, z, x, base, z);
        soilNor.push(e.n[0], 0, e.n[1], e.n[0], 0, e.n[1]);
        soilH.push(h, h);
        const wt = 0, wb = Math.min(top, 0);
        watPos.push(x, wt, z, x, wb, z);
        watNor.push(e.n[0], 0, e.n[1], e.n[0], 0, e.n[1]);
      }
      for (let k = 0; k < e.pts.length - 1; k++) {
        const a = s0 + k * 2, b = a + 1, c = a + 2, d = a + 3;
        soilIdx.push(a, b, c, c, b, d);
        const wa = w0 + k * 2, wb = wa + 1, wc = wa + 2, wd = wa + 3;
        watIdx.push(wa, wb, wc, wc, wb, wd);
      }
    }
    const sg = new THREE.BufferGeometry();
    const n = soilPos.length / 3;
    sg.setAttribute('position', new THREE.Float32BufferAttribute(soilPos, 3));
    sg.setAttribute('normal', new THREE.Float32BufferAttribute(soilNor, 3));
    sg.setAttribute('aHeight', new THREE.Float32BufferAttribute(soilH, 1));
    sg.setAttribute('aForest', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    sg.setAttribute('aShadow', new THREE.Float32BufferAttribute(new Float32Array(n).fill(0.6), 1));
    sg.setAttribute('aAO', new THREE.Float32BufferAttribute(new Float32Array(n).fill(0.7), 1));
    sg.setAttribute('aSide', new THREE.Float32BufferAttribute(new Float32Array(n).fill(1), 1));
    sg.setIndex(soilIdx);
    this.disposables.push(sg);
    const soil = new THREE.Mesh(sg, this.terrainMat);
    soil.frustumCulled = false;
    this.group.add(soil);

    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(watPos, 3));
    wg.setAttribute('normal', new THREE.Float32BufferAttribute(watNor, 3));
    wg.setIndex(watIdx);
    this.disposables.push(wg);
    const wmat = this.waterMat.clone();
    wmat.uniforms = { ...this.waterMat.uniforms, uSide: { value: 1 }, ...fogU };
    wmat.side = THREE.DoubleSide;
    this.disposables.push(wmat);
    const wside = new THREE.Mesh(wg, wmat);
    wside.renderOrder = 3;
    wside.frustumCulled = false;
    this.group.add(wside);
  }

  /** rebuild the tile index texture (after layout / founding changes) */
  updateTiles(): void {
    this.layoutTrees();
    const d = this.tileTex.image.data as Uint8Array;
    d.fill(0);
    this.model.data.tiles.forEach((t, k) => {
      for (let z = t.z; z < t.z + t.size; z++)
        for (let x = t.x; x < t.x + t.size; x++) {
          const o = (z * REGION_W + x) * 4;
          d[o] = k & 255;
          d[o + 1] = t.city ? 255 : 0;
          d[o + 3] = 255;
        }
    });
    this.tileTex.needsUpdate = true;
  }

  private rectOf(t: RegionTile | null): THREE.Vector4 {
    return t ? new THREE.Vector4(t.x, t.z, t.x + t.size, t.z + t.size) : new THREE.Vector4(-1, -1, -1, -1);
  }
  setHover(t: RegionTile | null): void {
    this.terrainMat.uniforms.uHover.value = this.rectOf(t);
  }
  setSelected(t: RegionTile | null): void {
    this.terrainMat.uniforms.uSelect.value = this.rectOf(t);
  }
  setGridOpacity(v: number): void {
    this.terrainMat.uniforms.uGridOpacity.value = v;
  }

  /** draw (or clear with img = null) a founded city's thumbnail into the draped atlas */
  setCityImage(tile: RegionTile, img: CanvasImageSource | null): void {
    const px = this.cityCanvas.width / REGION_W;
    const x = tile.x * px, y = tile.z * px, s = tile.size * px;
    this.cityCtx.clearRect(x, y, s, s);
    if (img) {
      this.cityCtx.save();
      this.cityCtx.beginPath();
      this.cityCtx.rect(x, y, s, s);
      this.cityCtx.clip();
      this.cityCtx.drawImage(img, x, y, s, s);
      this.cityCtx.restore();
    }
    this.cityTex.needsUpdate = true;
  }

  /** exaggerated terrain height (world y) at region meters, clamped at the water surface when above = false */
  surfaceY(x: number, z: number, includeWater = true): number {
    const fx = THREE.MathUtils.clamp(x / this.vspacing, 0, this.vn - 1.001);
    const fz = THREE.MathUtils.clamp(z / this.vspacing, 0, this.vnz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const k = j * this.vn + i;
    const H = this.vh;
    const y = (H[k] * (1 - tx) + H[k + 1] * tx) * (1 - tz) + (H[k + this.vn] * (1 - tx) + H[k + this.vn + 1] * tx) * tz;
    return includeWater ? Math.max(y, 0) : y;
  }

  /** ray vs heightfield (world units). Returns hit point or null. */
  raycast(ray: THREE.Ray): THREE.Vector3 | null {
    const o = ray.origin, d = ray.direction;
    const X = this.model.sizeX, Z = this.model.sizeZ;
    // clip to region box (y up to max)
    let tMin = 0, tMax = 1e7;
    const bounds: [number, number, number][] = [
      [o.x, d.x, X],
      [o.z, d.z, Z],
    ];
    for (const [p, dd, size] of bounds) {
      if (Math.abs(dd) < 1e-9) {
        if (p < 0 || p > size) return null;
      } else {
        let t0 = (0 - p) / dd, t1 = (size - p) / dd;
        if (t0 > t1) [t0, t1] = [t1, t0];
        tMin = Math.max(tMin, t0);
        tMax = Math.min(tMax, t1);
      }
    }
    if (tMin > tMax) return null;
    const step = this.vspacing * 0.75;
    let prevT = tMin;
    let prevAbove = o.y + d.y * tMin - this.surfaceY(o.x + d.x * tMin, o.z + d.z * tMin);
    if (prevAbove < 0) return new THREE.Vector3(o.x + d.x * tMin, this.surfaceY(o.x + d.x * tMin, o.z + d.z * tMin), o.z + d.z * tMin);
    for (let t = tMin + step; t <= tMax + step; t += step) {
      const tt = Math.min(t, tMax);
      const x = o.x + d.x * tt, z = o.z + d.z * tt;
      const above = o.y + d.y * tt - this.surfaceY(x, z);
      if (above <= 0) {
        // refine
        let a = prevT, b = tt;
        for (let k = 0; k < 8; k++) {
          const m = (a + b) / 2;
          const ab = o.y + d.y * m - this.surfaceY(o.x + d.x * m, o.z + d.z * m);
          if (ab > 0) a = m;
          else b = m;
        }
        const x2 = o.x + d.x * b, z2 = o.z + d.z * b;
        return new THREE.Vector3(x2, this.surfaceY(x2, z2), z2);
      }
      prevT = tt;
      prevAbove = above;
      if (tt >= tMax) break;
      // skip faster when far above
      if (above > 400) t += Math.min(above * 0.5, 2000);
    }
    void prevAbove;
    return null;
  }

  update(time: number, pulse = 0): void {
    this.terrainMat.uniforms.uTime.value = time;
    this.terrainMat.uniforms.uPulse.value = pulse;
    this.waterMat.uniforms.uTime.value = time;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

/** Soft sun shadows by marching the (exaggerated) heightfield towards the sun from every vertex. */
function bakeShadow(H: Float32Array, nx: number, nz: number, sp: number, sun: THREE.Vector3): Float32Array {
  const out = new Float32Array(nx * nz);
  const hor = Math.hypot(sun.x, sun.z) || 1e-6;
  const tanE = sun.y / hor;
  const dx = sun.x / hor, dz = sun.z / hor;
  let maxH = -1e9;
  for (let i = 0; i < H.length; i++) if (H[i] > maxH) maxH = H[i];
  const sample = (fx: number, fz: number) => {
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const k = j * nx + i;
    return (H[k] * (1 - tx) + H[k + 1] * tx) * (1 - tz) + (H[k + nx] * (1 - tx) + H[k + nx + 1] * tx) * tz;
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const y0 = Math.max(H[k], 0) + 0.5;
      let minR = 1;
      let d = 1; // in vertex units
      for (let s = 0; s < 90; s++) {
        const dm = d * sp;
        const ry = y0 + dm * tanE;
        if (ry > maxH) break;
        const fx = i + dx * d, fz = j + dz * d;
        if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) break;
        const r = (ry - sample(fx, fz)) / dm;
        if (r < minR) minR = r;
        if (minR < -0.05) break;
        d += Math.max(1, d * 0.07);
      }
      out[k] = smoothstep(-0.035, 0.035, minR);
    }
  }
  return out;
}

/** Cheap ambient occlusion: how far a vertex sits below its neighbourhood. */
function bakeAO(H: Float32Array, nx: number, nz: number, sp: number, exag: number): Float32Array {
  const out = new Float32Array(nx * nz);
  const r1 = Math.max(1, Math.round(160 / sp)), r2 = Math.max(2, Math.round(480 / sp));
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const h = H[k];
      let acc = 0;
      for (const [a, b] of dirs)
        for (const r of [r1, r2]) {
          const x = Math.min(nx - 1, Math.max(0, Math.round(i + a * r))), z = Math.min(nz - 1, Math.max(0, Math.round(j + b * r)));
          acc += Math.max(0, H[z * nx + x] - h) / (r * sp);
        }
      out[k] = 1 - Math.min(1, (acc / 16) * 2.2 / Math.max(1, exag * 0.5));
    }
  return out;
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
