/**
 * Mini-map (bottom-right): terrain / water / zones / roads / buildings + camera frustum; click or drag to jump.
 * FEEL-05: the land follows the season like the 3D foliage. paintBase also fills a land mask (natural ground, not water,
 * beach, snow, roads, zones or buildings); draw() blends the masked land toward straw by the renderer's uFoliageDry with a
 * 'color' composite (the hue of lum × (1.18, 1.02, 0.68), at the land's own luminance), so a month changes one draw and
 * never repaints the base.
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
/** the dry-foliage hue the renderer blends toward, lum × (1.18, 1.02, 0.68) (materials.ts), as an sRGB colour */
const STRAW: [number, number, number] = [255, 220, 147];

const BC: Record<number, [number, number, number]> = {
  1: [210, 245, 215], 2: [180, 235, 195], 3: [150, 225, 175], 4: [200, 220, 255], 5: [175, 205, 255], 6: [150, 185, 255],
  7: [235, 235, 170], 8: [255, 220, 140], 9: [250, 200, 120], 10: [180, 150, 120],
};

export class MiniMap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private bg: CanvasRenderingContext2D;
  private img: ImageData;
  /** FEEL-05: the season layer: STRAW where the base shows natural land, transparent elsewhere (uploaded only when used) */
  private mask: HTMLCanvasElement;
  private mg: CanvasRenderingContext2D;
  private maskImg: ImageData;
  private maskDirty = false;
  /** the uFoliageDry the map was last drawn with */
  private drawnDry = 0;
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

  constructor(private ctx: GameContext, parent: HTMLElement) {
    const N = ctx.state.size;
    this.canvas = h('canvas', { width: 392, height: 392 });
    this.g = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = N;
    this.base.height = N;
    this.bg = this.base.getContext('2d')!;
    this.img = this.bg.createImageData(N, N);
    this.mask = document.createElement('canvas');
    this.mask.width = N;
    this.mask.height = N;
    this.mg = this.mask.getContext('2d')!;
    this.maskImg = this.newMask(N);
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
      if (this.maskImg.data.length !== N * N * 4) this.maskImg = this.newMask(N);
    }
    const d = this.img.data, md = this.maskImg.data;
    const ov = this.paintOverlay;
    const start = performance.now(), firstRow = this.paintRow;
    // Keep the previous complete map visible; stop between rows at 2 ms or 4096 cells per frame.
    for (let z = this.paintRow; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        const o = i * 4;
        const hgt = st.cellHeight(x, z);
        let r: number, g: number, b: number;
        md[o + 3] = 0;
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
        } else if (!st.water[i] && hgt >= 1.6 && hgt <= 170) md[o + 3] = 255; // natural ground: follows the season
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
    if (this.mask.width !== N) this.mask.width = this.mask.height = N;
    this.maskDirty = true;
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

  private draw(): void {
    const g = this.g;
    const W = this.canvas.width;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, W);
    g.drawImage(this.base, 0, 0, W, W);
    this.drawSeason(g, W);
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

  /** FEEL-05: blend the natural land toward the renderer's dry-foliage hue (none from late spring to early autumn) */
  private drawSeason(g: CanvasRenderingContext2D, W: number): void {
    const dry = Math.max(0, Math.min(1, sharedUniforms.uFoliageDry.value));
    this.drawnDry = sharedUniforms.uFoliageDry.value;
    if (dry < 0.01) return;
    if (this.maskDirty) {
      this.mg.putImageData(this.maskImg, 0, 0);
      this.maskDirty = false;
    }
    g.save();
    g.globalCompositeOperation = 'color';
    g.globalAlpha = dry;
    g.drawImage(this.mask, 0, 0, W, W);
    g.restore();
  }

  /** a season mask buffer: STRAW everywhere, alpha set per cell by paintBase */
  private newMask(N: number): ImageData {
    const m = this.mg.createImageData(N, N);
    for (let o = 0; o < m.data.length; o += 4) {
      m.data[o] = STRAW[0];
      m.data[o + 1] = STRAW[1];
      m.data[o + 2] = STRAW[2];
    }
    return m;
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
    // FEEL-05: the season changed (the renderer sets uFoliageDry from the month): redraw, no repaint
    if (sharedUniforms.uFoliageDry.value !== this.drawnDry) this.viewDirty = true;
    this.acc += dt;
    this.frAcc += dt;
    if (this.paintState || this.dirty && (this.acc > 0.8 || !this.painted)) {
      if (!this.paintState) {
        this.acc = 0;
        this.dirty = false;
      }
      if (this.paintBase()) {
        this.painted = true;
        this.viewDirty = true;
      }
    }
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
