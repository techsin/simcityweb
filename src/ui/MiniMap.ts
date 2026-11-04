/**
 * Mini-map (bottom-right): terrain / water / zones / roads / buildings + camera frustum; click or drag to jump.
 * FEEL-05: the land follows the season. The tint is a layer over the cached base, never a base repaint: the renderer's
 * season uniforms (materials.ts uFoliageDry / uFoliageTint, which WorldView sets from the month) blend the map's open land
 * toward a dormant straw colour, as the lot lawns do. A month that changes them costs two drawImage calls.
 */
import * as THREE from 'three';
import { sharedUniforms } from '../assets/materials';
import { CELL_SIZE } from '../core/constants';
import { Network, Overlay } from '../core/types';
import type { GameContext } from '../game/context';
import { h } from './dom';
import { icon } from './icons';

const ZC: Record<number, [number, number, number]> = {
  1: [120, 205, 130], 2: [80, 185, 105], 3: [50, 160, 85], 4: [120, 165, 240], 5: [80, 140, 240], 6: [55, 110, 215],
  7: [200, 205, 110], 8: [230, 180, 60], 9: [215, 145, 40], 10: [150, 120, 90],
};
const BC: Record<number, [number, number, number]> = {
  1: [210, 245, 215], 2: [180, 235, 195], 3: [150, 225, 175], 4: [200, 220, 255], 5: [175, 205, 255], 6: [150, 185, 255],
  7: [235, 235, 170], 8: [255, 220, 140], 9: [250, 200, 120], 10: [180, 150, 120],
};
/** FEEL-05: the dormant colour open land blends toward (lum × this), as materials.ts's lawns do with uFoliageDry */
const DRY_RGB: readonly [number, number, number] = [1.18, 1.02, 0.68];
/** land above this (m) is snow on the map: it keeps its colour in every season */
const SNOW_LINE = 170;

/** the season the map shows (the renderer's uniforms) and the base paint it was composed over */
interface SeasonLook { dry: number; r: number; g: number; b: number; base: number }
/** the season composite and its layers, built from one completed base paint */
interface SeasonLayers {
  /** what draw() blits */
  out: HTMLCanvasElement;
  /** open land at its dormant colour, transparent elsewhere (null until a season dries the land) */
  dry: HTMLCanvasElement | null;
  /** the base with its open land times the climate tint (null for a white tint) */
  tinted: HTMLCanvasElement | null;
  /** the base paint and the tint they were built from */
  built: number;
  tint: string;
}

export class MiniMap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private bg: CanvasRenderingContext2D;
  private img: ImageData;
  private dirty = true;
  private painted = false;
  private paintRow = 0;
  private paintState: GameContext['state'] | null = null;
  private paintOverlay = Overlay.None;
  private acc = 0;
  private frAcc = 0;
  private viewDirty = true;
  private drawn = false;
  private camera: THREE.Camera | null = null;
  private cameraView = new THREE.Matrix4();
  private cameraProjection = new THREE.Matrix4();
  private moving = false;
  private dragging = false;
  private collapsed = false;
  private disposed = false;
  private offs: (() => void)[] = [];
  /** completed base paints (the season layers are built from the cached image of one) */
  private baseVersion = 0;
  /** FEEL-05: what draw() blits instead of the base while a season tints it (null: the base itself) */
  private seasonal: HTMLCanvasElement | null = null;
  /** built when a season first tints the map */
  private season: SeasonLayers | null = null;
  private look: SeasonLook = { dry: 0, r: 1, g: 1, b: 1, base: -1 };

  constructor(private ctx: GameContext, parent: HTMLElement) {
    const N = ctx.state.size;
    this.canvas = h('canvas', { width: 392, height: 392 });
    this.g = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = N;
    this.base.height = N;
    this.bg = this.base.getContext('2d')!;
    this.img = this.bg.createImageData(N, N);
    const collapse = h('button', { class: 'icon-btn', title: 'Collapse map', html: icon('chevDown', 14) });
    collapse.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.ctx.sound(this.collapsed ? 'flyoutClose' : 'flyout');
      this.el.classList.toggle('collapsed', this.collapsed);
      collapse.innerHTML = icon(this.collapsed ? 'chevUp' : 'chevDown', 14);
      this.viewDirty = true;
    }, { signal: this.ctx.signal });
    const rotL = h('button', { class: 'icon-btn', title: 'Rotate view (Q)', html: icon('rotate', 13), style: 'transform:scaleX(-1)' });
    rotL.addEventListener('click', () => ctx.world.controls.rotateStep(-1), { signal: this.ctx.signal });
    const rotR = h('button', { class: 'icon-btn', title: 'Rotate view (E)', html: icon('rotate', 13) });
    rotR.addEventListener('click', () => ctx.world.controls.rotateStep(1), { signal: this.ctx.signal });
    this.el = h('div', { class: 'minimap mp-glass i' },
      h('div', { class: 'mm-head' }, h('span', { class: 'hud-label', html: icon('map', 13) + '<span>Map</span>' }), h('div', { class: 'mm-btns' }, rotL, rotR, collapse)),
      this.canvas,
    );
    parent.appendChild(this.el);
    const go = (e: PointerEvent, fly = false) => {
      const r = this.canvas.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      const m = N * CELL_SIZE;
      try {
        ctx.world.controls.focusOn(Math.max(0, Math.min(1, u)) * m, Math.max(0, Math.min(1, v)) * m, undefined, fly ? { fly: true } : undefined);
      } catch {
        /* ignore */
      }
    };
    // FEEL-08: a click is a long jump and flies (over 500 m); a drag scrubs, which also stops a flight. A click's few
    // pixels of wobble do not count as a drag.
    let downAt: { x: number; y: number } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      downAt = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      this.ctx.sound('tap');
      go(e, true);
    }, { signal: this.ctx.signal });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4) return;
      downAt = null;
      go(e);
    }, { signal: this.ctx.signal });
    this.canvas.addEventListener('pointerup', () => (this.dragging = false), { signal: this.ctx.signal });
    const ev = ctx.sim.events;
    const mark = () => (this.dirty = true);
    this.offs.push(ev.on('zoneChanged', mark), ev.on('networkChanged', mark), ev.on('terrainChanged', mark), ev.on('buildingAdded', mark), ev.on('buildingRemoved', mark), ev.on('treesChanged', mark), ev.on('reset', mark));
    const offUtilities = ev.on('layerUpdated', (name) => { if (name === 'utilities') mark(); });
    this.offs.push(offUtilities);
    if (ctx.signal.aborted) offUtilities();
    else ctx.signal.addEventListener('abort', offUtilities, { once: true });
  }

  private paintBase(): boolean {
    const st = this.ctx.state;
    const N = st.size;
    if (this.paintState !== st || this.paintOverlay !== this.ctx.overlay) {
      this.paintRow = 0;
      this.paintState = st;
      this.paintOverlay = this.ctx.overlay;
      if (this.img.data.length !== N * N * 4) this.img = this.bg.createImageData(N, N);
    }
    const d = this.img.data;
    const ov = this.paintOverlay;
    const start = performance.now(), firstRow = this.paintRow;
    // Keep the previous complete map visible; stop between rows at 2 ms or 4096 cells per frame.
    for (let z = this.paintRow; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        const o = i * 4;
        const hgt = st.cellHeight(x, z);
        let r: number, g: number, b: number;
        if (st.water[i]) {
          const dd = Math.min(1, -hgt / 25);
          r = 38 - dd * 18; g = 92 - dd * 30; b = 128 - dd * 25;
        } else {
          const t = Math.min(1, hgt / 140);
          r = 92 + t * 60; g = 128 + t * 20; b = 72 + t * 40;
          if (hgt < 1.6) { r = 196; g = 186; b = 140; }
          if (hgt > 170) { const s = Math.min(1, (hgt - 170) / 40); r += (235 - r) * s; g += (238 - g) * s; b += (240 - b) * s; }
          const tr = st.trees[i];
          if (tr) { const k = 1 - tr * 0.07; r *= k * 0.92; g *= k; b *= k * 0.9; }
          // light shading from slope (east-west)
          const sh = x + 1 < N ? (st.cellHeight(x + 1, z) - hgt) * -0.9 : 0;
          r += sh; g += sh; b += sh;
        }
        const n = st.network[i];
        const zn = st.zone[i];
        const bid = st.building[i];
        if (n) {
          if (n === Network.Rail) { r = 130; g = 100; b = 80; }
          else if (n === Network.Highway) { r = 70; g = 72; b = 78; }
          else { r = 105; g = 108; b = 116; }
        } else if (bid >= 0) {
          const c = zn ? BC[zn] : [205, 195, 235];
          [r, g, b] = c;
        } else if (zn) {
          const c = ZC[zn];
          r = r * 0.35 + c[0] * 0.65; g = g * 0.35 + c[1] * 0.65; b = b * 0.35 + c[2] * 0.65;
        }
        if (ov === Overlay.Power && !st.water[i] && (bid >= 0 || zn)) {
          const p = st.powered[i];
          r = p ? 250 : 80; g = p ? 215 : 70; b = p ? 80 : 70;
        }
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
      this.paintRow = z + 1;
      if (this.paintRow < N && ((this.paintRow - firstRow) * N >= 4096 || performance.now() - start >= 2)) return false;
    }
    if (this.base.width !== N) this.base.width = this.base.height = N;
    this.bg.putImageData(this.img, 0, 0);
    this.paintState = null;
    this.paintRow = 0;
    return true;
  }

  /** ground intersection of the camera ray through NDC (x,y) */
  private groundPoint(cam: THREE.PerspectiveCamera, x: number, y: number, planeY: number): THREE.Vector3 {
    const p = new THREE.Vector3(x, y, 0.5).unproject(cam);
    const dir = p.sub(cam.position).normalize();
    const m = this.ctx.state.size * CELL_SIZE;
    if (dir.y < -1e-3) {
      const t = (planeY - cam.position.y) / dir.y;
      if (t > 0 && t < m * 4) return cam.position.clone().addScaledVector(dir, t);
    }
    // pointing to the horizon: clamp far along the horizontal direction
    const hd = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    return new THREE.Vector3(cam.position.x, planeY, cam.position.z).addScaledVector(hd, m * 1.5);
  }

  /**
   * FEEL-05: follow the renderer's season. When its uniforms or the base changed, compose the base (or its tinted copy) and
   * the dormant land at uFoliageDry: two drawImage calls. The layers are rebuilt only from a completed base paint (the
   * cached image is complete then): one pass over the cells, never a paintBase. Returns true when the map changed.
   */
  private updateSeason(): boolean {
    const dry = sharedUniforms.uFoliageDry.value, t = sharedUniforms.uFoliageTint.value, l = this.look;
    if (l.dry === dry && l.r === t.r && l.g === t.g && l.b === t.b && l.base === this.baseVersion) return false;
    const was = this.seasonal;
    Object.assign(l, { dry, r: t.r, g: t.g, b: t.b, base: this.baseVersion });
    const white = t.r === 1 && t.g === 1 && t.b === 1;
    if (dry <= 0 && white) {
      this.seasonal = null;
      return was !== null;
    }
    const s = this.seasonLayers(dry > 0, white);
    const g = s.out.getContext('2d')!;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'copy';
    g.drawImage(s.tinted ?? this.base, 0, 0);
    g.globalCompositeOperation = 'source-over';
    if (dry > 0 && s.dry) {
      g.globalAlpha = Math.min(1, dry);
      g.drawImage(s.dry, 0, 0);
      g.globalAlpha = 1;
    }
    this.seasonal = s.out;
    return true;
  }

  /** the season layers for the current base and climate tint (rebuilt only when either changed, or the land dries) */
  private seasonLayers(needDry: boolean, white: boolean): SeasonLayers {
    const st = this.ctx.state;
    const N = st.size, l = this.look;
    const tint = white ? '' : `${l.r},${l.g},${l.b}`;
    const old = this.season;
    if (old && old.built === this.baseVersion && old.tint === tint && old.out.width === N && (old.dry || !needDry)) return old;
    const sized = (c: HTMLCanvasElement | null | undefined): HTMLCanvasElement => {
      const cv = c ?? document.createElement('canvas');
      if (cv.width !== N || cv.height !== N) cv.width = cv.height = N;
      return cv;
    };
    const s: SeasonLayers = { out: sized(old?.out), dry: needDry ? sized(old?.dry) : null, tinted: white ? null : sized(old?.tinted), built: this.baseVersion, tint };
    const src = this.img.data;
    const dg = s.dry?.getContext('2d'), tg = s.tinted?.getContext('2d');
    const dryImg = dg?.createImageData(N, N), tintImg = tg?.createImageData(N, N);
    const d = dryImg?.data, td = tintImg?.data;
    if (td) td.set(src);
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const i = z * N + x, o = i * 4;
        // open land only: zones, buildings, networks, water and snow keep their colours
        if (st.water[i] || st.network[i] || st.zone[i] || st.building[i] >= 0 || st.cellHeight(x, z) > SNOW_LINE) continue;
        if (d) {
          const lum = src[o] * 0.3 + src[o + 1] * 0.59 + src[o + 2] * 0.11;
          d[o] = lum * DRY_RGB[0] * l.r; d[o + 1] = lum * DRY_RGB[1] * l.g; d[o + 2] = lum * DRY_RGB[2] * l.b; d[o + 3] = 255;
        }
        if (td) { td[o] = src[o] * l.r; td[o + 1] = src[o + 1] * l.g; td[o + 2] = src[o + 2] * l.b; }
      }
    if (dg && dryImg) dg.putImageData(dryImg, 0, 0);
    if (tg && tintImg) tg.putImageData(tintImg, 0, 0);
    return (this.season = s);
  }

  private draw(): void {
    const g = this.g;
    const W = this.canvas.width;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, W);
    g.drawImage(this.seasonal ?? this.base, 0, 0, W, W);
    let cam: THREE.PerspectiveCamera | null = null;
    try {
      cam = this.ctx.world.camera;
    } catch {
      cam = null;
    }
    if (!cam || !(cam as THREE.PerspectiveCamera).isPerspectiveCamera) return;
    cam.updateMatrixWorld();
    const ty = this.ctx.world.controls?.target?.y ?? 0;
    const pts = [this.groundPoint(cam, -1, -1, ty), this.groundPoint(cam, 1, -1, ty), this.groundPoint(cam, 1, 1, ty), this.groundPoint(cam, -1, 1, ty)];
    const s = W / (this.ctx.state.size * CELL_SIZE);
    g.save();
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x * s, p.z * s) : g.moveTo(p.x * s, p.z * s)));
    g.closePath();
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineJoin = 'round';
    g.stroke();
    const t = this.ctx.world.controls?.target;
    if (t) {
      g.beginPath();
      g.arc(t.x * s, t.z * s, 4, 0, Math.PI * 2);
      g.fillStyle = '#7cd4ff';
      g.fill();
    }
    g.restore();
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Returns the camera's moving -> resting transition for the HUD's immediate settled update. */
  frame(dt: number): boolean {
    if (this.disposed || this.ctx.signal.aborted) return false;
    let cam: THREE.Camera | null = null;
    try { cam = this.ctx.world.camera ?? null; } catch { /* stand-in view */ }
    const moving = cam !== this.camera || !!cam && (!this.cameraView.equals(cam.matrixWorld) || !this.cameraProjection.equals(cam.projectionMatrix));
    const stopped = this.moving && !moving;
    this.moving = moving;
    this.camera = cam;
    if (cam) {
      this.cameraView.copy(cam.matrixWorld);
      this.cameraProjection.copy(cam.projectionMatrix);
    }
    if (this.collapsed) return stopped;
    this.acc += dt;
    this.frAcc += dt;
    if (this.paintState || this.dirty && (this.acc > 0.8 || !this.painted)) {
      if (!this.paintState) {
        this.acc = 0;
        this.dirty = false;
      }
      if (this.paintBase()) {
        this.painted = true;
        this.baseVersion++;
        this.viewDirty = true;
      }
    }
    // (between sweeps only: mid-sweep the cached image is part old, part new)
    if (this.painted && !this.paintState && this.updateSeason()) this.viewDirty = true;
    const drawDue = this.frAcc >= 0.1 || stopped || !this.drawn || (!moving && this.viewDirty);
    if (this.painted && drawDue && (moving || stopped || this.viewDirty)) {
      this.frAcc = 0;
      this.drawn = true;
      this.viewDirty = false;
      this.draw();
    }
    return stopped;
  }

  dispose(): void {
    this.disposed = true;
    for (const f of this.offs) f();
    this.offs.length = 0;
    this.paintState = null;
    this.camera = null;
  }
}
