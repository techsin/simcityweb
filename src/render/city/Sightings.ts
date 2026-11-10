/** Rare visitors follow the authoritative news stream. The headline's map position is also the visitor's anchor. */
import * as THREE from 'three';
import { CELL_SIZE, SEA_LEVEL } from '../../core/constants';
import type { CityState } from '../../sim/CityState';
import { SIGHTING_HEADLINES, type SightingKind } from '../../sim/economy/eventHeadlines';

const KIND_BY_TEXT = new Map<string, SightingKind>(Object.entries(SIGHTING_HEADLINES).map(([kind, text]) => [text, kind as SightingKind]));

export class Sightings {
  readonly group = new THREE.Group();
  private current: { key: string; kind: SightingKind; age: number } | null = null;
  private last = '';
  private anchorY = 0;
  private newsTail: CityState['news'][number] | undefined;
  private newsDay = -1;
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.group.name = 'rare-sightings';
    scene.add(this.group);
  }

  update(st: CityState, dt: number): void {
    if (this.disposed) return;
    const news = st.news, tail = news[news.length - 1];
    if (tail !== this.newsTail || st.day !== this.newsDay) {
      this.newsTail = tail; this.newsDay = st.day;
      for (let i = news.length - 1; i >= 0; i--) {
        const n = news[i];
        if (st.day - n.day > 60) break;
        const kind = KIND_BY_TEXT.get(n.text);
        if (!kind || n.day > st.day || n.x === undefined || n.z === undefined
          || !Number.isInteger(n.x) || !Number.isInteger(n.z) || n.x < 0 || n.z < 0 || n.x >= st.size || n.z >= st.size) continue;
        const key = `${kind}:${n.day}`;
        if (key !== this.last) {
          this.clear();
          this.last = key;
          this.current = { key, kind, age: 0 };
          this.build(kind);
          const x = (n.x + 0.5) * CELL_SIZE, z = (n.z + 0.5) * CELL_SIZE;
          const i0 = n.z * (st.size + 1) + n.x;
          const height = (st.heights[i0 + 1] + st.heights[i0 + st.size + 1]) * 0.5;
          this.anchorY = kind === 'whale' ? SEA_LEVEL + 0.6 : height + (kind === 'balloons' ? 140 : kind === 'blimp' ? 180 : kind === 'observatory' ? 24 : 1);
          this.group.position.set(x, this.anchorY, z);
        }
        break;
      }
    }
    if (!this.current) return;
    this.current.age += Math.max(0, dt);
    if (this.current.age > 30) { this.clear(); return; }
    const t = this.current.age;
    const kind = this.current.kind;
    this.group.position.y = this.anchorY + Math.sin(t * 0.7) * (kind === 'whale' ? 0.4 : kind === 'gerald' ? 0 : 2);
    if (kind === 'balloons' || kind === 'blimp') this.group.rotation.y = Math.sin(t * 0.12) * 0.2;
    else if (kind === 'observatory') this.group.rotation.y = t * 0.2;
  }

  private build(kind: SightingKind): void {
    const mesh = (g: THREE.BufferGeometry, color: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
      m.position.set(x, y, z); this.group.add(m); return m;
    };
    const oval = (color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const m = mesh(new THREE.SphereGeometry(1, 12, 8), color, x, y, z); m.scale.set(sx, sy, sz); return m;
    };
    if (kind === 'balloons') {
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 35, y = i % 2 * 20;
        oval([0xe39a45, 0xd56670, 0x56a6b5][i], x, y, i * 12, 12, 17, 12);
        mesh(new THREE.BoxGeometry(5, 4, 5), 0x886341, x, y - 23, i * 12);
        mesh(new THREE.CylinderGeometry(0.2, 0.2, 8, 4), 0x8c7965, x - 2, y - 18, i * 12);
        mesh(new THREE.CylinderGeometry(0.2, 0.2, 8, 4), 0x8c7965, x + 2, y - 18, i * 12);
      }
    } else if (kind === 'blimp') {
      oval(0xdacfae, 0, 0, 0, 39, 12, 12);
      mesh(new THREE.BoxGeometry(15, 4, 5), 0x567b8f, 0, -13, 0);
      mesh(new THREE.BoxGeometry(12, 17, 1), 0xb8474d, -30, 0, 0);
      mesh(new THREE.BoxGeometry(12, 1, 23), 0xb8474d, -30, 0, 0);
    } else if (kind === 'whale') {
      oval(0x344c58, 0, 0, 0, 16, 3.6, 5);
      mesh(new THREE.ConeGeometry(2.8, 5, 3), 0x344c58, -2, 4, 0);
      const tail = mesh(new THREE.BoxGeometry(3, 1, 13), 0x344c58, -15, 1, 0); tail.rotation.x = 0.2;
      oval(0xd6e8e9, 7, 5, 0, 0.5, 5, 0.5);
    } else if (kind === 'observatory') {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(16, 120, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xd5e7ff, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      cone.rotation.z = Math.PI; cone.position.y = 60; this.group.add(cone);
      oval(0xf9e9ab, 0, 1, 0, 1.5, 1.5, 1.5);
    } else {
      for (const x of [-6, 6]) mesh(new THREE.CylinderGeometry(0.3, 0.4, 5, 6), 0xd4b46d, x, 2.5, 0);
      mesh(new THREE.BoxGeometry(12, 0.8, 0.15), 0xcd334e, 0, 3, 0);
      mesh(new THREE.BoxGeometry(3, 2, 0.3), 0xc5a75a, 0, 1, 1.5);
      for (const x of [-3, 3]) {
        oval(0xe7ba91, x, 4.4, 1, 0.6, 0.6, 0.6);
        mesh(new THREE.BoxGeometry(1.3, 2.8, 0.8), 0x354e69, x, 2.4, 1);
      }
      const scissors = mesh(new THREE.BoxGeometry(3, 0.15, 0.2), 0xd6dce0, 0, 3, 0); scissors.rotation.z = 0.4;
    }
  }

  private clear(): void {
    for (const child of this.group.children) {
      const m = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      m.geometry.dispose(); m.material.dispose();
    }
    this.group.clear(); this.group.rotation.set(0, 0, 0); this.current = null;
  }
  reset(): void { this.clear(); this.last = ''; this.newsTail = undefined; this.newsDay = -1; }
  dispose(): void { if (this.disposed) return; this.reset(); this.group.removeFromParent(); this.disposed = true; }
}
