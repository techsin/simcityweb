/** Mini-map (bottom-right): terrain / water / zones / roads / buildings + camera frustum; click or drag to jump. */
import * as THREE from 'three';
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

export class MiniMap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private bg: CanvasRenderingContext2D;
  private img: ImageData;
  private dirty = true;
  private painted = false;
  private acc = 0;
  private frAcc = 0;
  private dragging = false;
  private collapsed = false;
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
    const collapse = h('button', { class: 'icon-btn', title: 'Collapse map', html: icon('chevDown', 14) });
    collapse.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.el.classList.toggle('collapsed', this.collapsed);
      collapse.innerHTML = icon(this.collapsed ? 'chevUp' : 'chevDown', 14);
    });
    const rotL = h('button', { class: 'icon-btn', title: 'Rotate view (Q)', html: icon('rotate', 13), style: 'transform:scaleX(-1)' });
    rotL.addEventListener('click', () => ctx.world.controls.rotateStep(-1));
    const rotR = h('button', { class: 'icon-btn', title: 'Rotate view (E)', html: icon('rotate', 13) });
    rotR.addEventListener('click', () => ctx.world.controls.rotateStep(1));
    this.el = h('div', { class: 'minimap mp-glass i' },
      h('div', { class: 'mm-head' }, h('span', { class: 'hud-label', html: icon('map', 13) + '<span>Map</span>' }), h('div', { class: 'mm-btns' }, rotL, rotR, collapse)),
      this.canvas,
    );
    parent.appendChild(this.el);
    const go = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      const m = N * CELL_SIZE;
      try {
        ctx.world.controls.focusOn(Math.max(0, Math.min(1, u)) * m, Math.max(0, Math.min(1, v)) * m);
      } catch {
        /* ignore */
      }
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      go(e);
    });
    this.canvas.addEventListener('pointermove', (e) => this.dragging && go(e));
    this.canvas.addEventListener('pointerup', () => (this.dragging = false));
    const ev = ctx.sim.events;
    const mark = () => (this.dirty = true);
    this.offs.push(ev.on('zoneChanged', mark), ev.on('networkChanged', mark), ev.on('terrainChanged', mark), ev.on('buildingAdded', mark), ev.on('buildingRemoved', mark), ev.on('treesChanged', mark), ev.on('reset', mark));
  }

  private paintBase(): void {
    const st = this.ctx.state;
    const N = st.size;
    const d = this.img.data;
    const ov = this.ctx.overlay;
    for (let z = 0; z < N; z++)
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
    this.bg.putImageData(this.img, 0, 0);
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

  frame(dt: number): void {
    if (this.collapsed) return;
    this.acc += dt;
    this.frAcc += dt;
    if (this.dirty && (this.acc > 0.8 || !this.painted)) {
      this.painted = true;
      this.acc = 0;
      this.dirty = false;
      this.paintBase();
      this.draw();
    } else if (this.frAcc > 0.1) {
      this.frAcc = 0;
      this.draw();
    }
  }

  dispose(): void {
    for (const f of this.offs) f();
  }
}
