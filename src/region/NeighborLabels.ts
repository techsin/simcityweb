/**
 * City-view overlay: names of neighbouring region cities at the map edges ("Riverton · 12k ↑"), projected with the
 * CityScene's camera. Purely decorative (pointer-events: none); hidden when an edge is off screen.
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../core/constants';
import type { CityState } from '../sim/CityState';
import type { RegionNeighbor } from './regionEffects';
import { formatPop, h } from './ui/dom';

const ARROW: Record<RegionNeighbor['edge'], string> = { n: '↑', s: '↓', e: '→', w: '←' };

export class NeighborLabels {
  private layer: HTMLElement;
  private items: { el: HTMLElement; p: THREE.Vector3 }[] = [];
  private raf = 0;
  private disposed = false;
  private v = new THREE.Vector3();

  constructor(private container: HTMLElement, private getCamera: () => THREE.Camera | null | undefined, st: CityState, neighbors: RegionNeighbor[]) {
    this.layer = h('div', { class: 'neighbor-labels' });
    container.appendChild(this.layer);
    const N = st.size;
    const seen = new Set<string>();
    for (const n of neighbors) {
      if (!n.founded || !n.name) continue;
      const k = `${n.tileKey}:${n.edge}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const mid = ((n.from + n.to) / 2) * CELL_SIZE;
      const edgeM = N * CELL_SIZE;
      const inset = 6 * CELL_SIZE;
      let x = 0, z = 0;
      if (n.edge === 'n') [x, z] = [mid, inset];
      else if (n.edge === 's') [x, z] = [mid, edgeM - inset];
      else if (n.edge === 'w') [x, z] = [inset, mid];
      else [x, z] = [edgeM - inset, mid];
      const y = Math.max(0, st.heightAt(x, z)) + 40;
      const el = h('div', { class: 'neighbor-label' }, h('span', { class: 'nl-arrow' }, ARROW[n.edge]), n.name, h('small', {}, formatPop(n.population)));
      this.layer.appendChild(el);
      this.items.push({ el, p: new THREE.Vector3(x, y, z) });
    }
    if (this.items.length) this.loop();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const cam = this.getCamera();
    const W = this.container.clientWidth, H = this.container.clientHeight;
    for (const it of this.items) {
      if (!cam) {
        it.el.style.opacity = '0';
        continue;
      }
      this.v.copy(it.p).project(cam);
      const on = this.v.z < 1 && Math.abs(this.v.x) < 0.92 && Math.abs(this.v.y) < 0.9;
      it.el.style.opacity = on ? '1' : '0';
      if (on) it.el.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * W}px, ${(-this.v.y * 0.5 + 0.5) * H}px) translate(-50%, -50%)`;
    }
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.layer.remove();
  }
}
