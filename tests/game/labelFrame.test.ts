/** T030: label projections use cached sizes, throttle motion and flush stops / data changes. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NeighborLabels } from '../../src/region/NeighborLabels';
import { RegionScreen } from '../../src/region/RegionScreen';
import type { RegionNeighbor } from '../../src/region/regionEffects';
import { newState } from '../infra/cityGen';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';

installFakeDom();
let now = 0, nextRaf = 0;
const frames = new Map<number, FrameRequestCallback>();
const observers: Observer[] = [];
class Observer {
  disconnected = false;
  constructor(readonly callback: () => void) { observers.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
}
class LabelEl extends FEl {
  replaceChildren(...children: (FNode | string)[]): void { this.textContent = ''; this.append(...children); }
}
beforeEach(() => {
  now = nextRaf = 0; frames.clear(); observers.length = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => new LabelEl(tag)) as typeof document.createElement);
  vi.stubGlobal('Node', FNode);
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('window', new FEl('window'));
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++nextRaf, cb); return nextRaf; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function step(t: number): void {
  now = t;
  const callbacks = [...frames.values()]; frames.clear();
  for (const callback of callbacks) callback(t);
}
function track(el: FEl): number[] {
  const writes: number[] = [];
  let value = el.style.transform;
  Object.defineProperty(el.style, 'transform', { configurable: true, get: () => value, set: (v) => { value = v; writes.push(now); } });
  return writes;
}
function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(45, 4 / 3, 1, 10000);
  c.position.set(128, 800, 900); c.lookAt(128, 0, 128); c.updateMatrixWorld();
  return c;
}
function expectCadence(writes: number[]): void {
  expect(writes.length).toBeGreaterThan(0);
  expect(writes.length).toBeLessThanOrEqual(10);
  for (let i = 1; i < writes.length; i++) expect(writes[i] - writes[i - 1]).toBeGreaterThanOrEqual(100);
}

// Original neighbour projection, including behind-camera mirroring and the border clamp.
function neighborPose(p: THREE.Vector3, cam: THREE.Camera, W: number, H: number) {
  const v = p.clone().project(cam);
  let x = v.x, y = v.y;
  if (v.z > 1) { x = -x; y = -y; }
  const inside = v.z <= 1 && Math.abs(x) < 0.9 && Math.abs(y) < 0.82;
  if (!inside) {
    const k = Math.min(0.9 / Math.max(Math.abs(x), 1e-6), 0.82 / Math.max(Math.abs(y), 1e-6));
    x *= k; y *= k;
  }
  return { transform: `translate(${(x * 0.5 + 0.5) * W}px, ${(-y * 0.5 + 0.5) * H}px) translate(-50%, -50%)`, arrow: `rotate(${Math.atan2(-y, x)}rad)`, inside };
}

describe('neighbour labels', () => {
  it('disconnects its resize observer and animation loop on dispose (main.ts disposes it with the city)', () => {
    const root = new FEl('div'), cam = camera();
    const neighbor = { edge: 'n', tileKey: 'n', founded: true, name: 'North', from: 0, to: 16, population: 10 } as RegionNeighbor;
    const labels = new NeighborLabels(root as unknown as HTMLElement, () => cam, newState(16), [neighbor]);
    expect(frames.size).toBe(1);
    labels.dispose();
    expect(frames.size).toBe(0);
    expect(observers[0].disconnected).toBe(true);
    expect(root.children).toHaveLength(0);
    labels.dispose();
    expect(frames.size).toBe(0);
  });

  it('caps motion at 10 Hz, matches the original settled pose and only measures on resize', () => {
    const root = new FEl('div'), cam = camera();
    let W = 800, H = 600, measuring = true;
    Object.defineProperties(root, {
      clientWidth: { get: () => { if (!measuring) throw new Error('per-frame width read'); return W; } },
      clientHeight: { get: () => { if (!measuring) throw new Error('per-frame height read'); return H; } },
    });
    const n = { edge: 'n', tileKey: '0_0', founded: true, name: 'Riverton', population: 12000, from: 0, to: 16 } as RegionNeighbor;
    const labels = new NeighborLabels(root as unknown as HTMLElement, () => cam, newState(16), [n, n]);
    expect(root.querySelectorAll('.neighbor-label')).toHaveLength(1);
    const el = root.querySelector('.neighbor-label')!, writes = track(el);
    const arrow = el.querySelector('.nl-arrow')!;
    expect(textOf(el)).toContain('Riverton');
    measuring = false;
    step(16); writes.length = 0;
    for (let i = 1; i <= 50; i++) { cam.position.x += 4; cam.updateMatrixWorld(); step(16 + i * 20); }
    expectCadence(writes);
    const count = writes.length;
    step(1017);
    expect(writes).toHaveLength(count + 1);
    const assertPose = () => {
      const want = neighborPose(new THREE.Vector3(128, 45, 96), cam, W, H);
      expect(el.style.transform).toBe(want.transform);
      expect(arrow.style.transform).toBe(want.arrow);
      expect(el.classList.contains('offscreen')).toBe(!want.inside);
    };
    assertPose(); step(2000); expect(writes).toHaveLength(count + 1);
    W = 1200; H = 720; measuring = true; observers[0].callback(); measuring = false;
    assertPose();
    // The offscreen indicator keeps the original mirrored direction when looking away from the city.
    cam.lookAt(cam.position.clone().add(new THREE.Vector3(0, 0, 100))); cam.updateMatrixWorld();
    step(2020); step(2021); assertPose();
    labels.dispose();
    expect(observers[0].disconnected).toBe(true);
    expect(frames.size).toBe(0);
    expect(root.querySelector('.neighbor-label')).toBeNull();
    observers[0].callback(); // a late resize callback after disposal cannot measure or draw
  });

  it('handles projection changes and missing / replaced cameras without stale labels', () => {
    const root = new FEl('div'); root.clientWidth = 800; root.clientHeight = 600;
    let cam: THREE.PerspectiveCamera | null = camera();
    const labels = new NeighborLabels(root as unknown as HTMLElement, () => cam, newState(16), [{ edge: 'n', tileKey: 'n', founded: true, name: 'North', from: 0, to: 16, population: 10 } as RegionNeighbor]);
    const el = root.querySelector('.neighbor-label')!;
    step(16);
    const before = el.style.transform;
    cam.zoom = 2; cam.updateProjectionMatrix(); step(20); step(21);
    expect(el.style.transform).not.toBe(before);
    cam = null; step(30); step(31); expect(el.style.opacity).toBe('0');
    cam = camera(); step(40); step(41); expect(el.style.opacity).toBe('1');
    expect(el.style.transform).toBe(before);
    labels.dispose();
  });
});

function regionLabels() {
  const cam = camera(), layer = new LabelEl('div');
  let W = 800, H = 600, measuring = true;
  const rect = vi.fn(() => { if (!measuring) throw new Error('per-frame rect read'); return { width: W, height: H }; });
  const tiles = [{ key: '0_0', city: { name: 'Riverton', population: 12000 } }];
  const view = {
    camera: cam, renderer: { domElement: { getBoundingClientRect: rect } },
    tileCenter: () => new THREE.Vector3(128, 260, 128), selectedTile: null,
    refreshCities: vi.fn(async () => {}), dispose: vi.fn(),
  };
  // Exercise the real label / refresh methods without constructing the region's WebGL renderer and unrelated HUD.
  const screen = Object.assign(Object.create(RegionScreen.prototype), {
    view, model: { data: { tiles }, reindex() {} }, labels: new Map(), labelLayer: layer,
    labelView: new THREE.Matrix4(), labelProjection: new THREE.Matrix4(), labelsMoving: false,
    labelsDisposed: false, lastLabels: -Infinity, labelWidth: 0, labelHeight: 0,
    renderCard() {}, renderList() {}, player: { dispose() {} }, el: new FEl('div'), tip: new FEl('div'), host: new FEl('div'),
  }) as { resizeLabels(): void; updateLabels(force?: boolean): void; refresh(): Promise<void>; dispose(): void };
  screen.resizeLabels(); measuring = false;
  return {
    cam, layer, screen, tiles, view, rect,
    frame: (t: number) => { now = t; screen.updateLabels(); },
    resize: (w: number, h: number) => { W = w; H = h; measuring = true; screen.resizeLabels(); measuring = false; },
  };
}

describe('region city labels', () => {
  it('caps motion at 10 Hz, flushes a stop and uses the resized cached dimensions', () => {
    const f = regionLabels(), el = f.layer.querySelector('.city-label')!, writes = track(el);
    f.frame(16); writes.length = 0;
    for (let i = 1; i <= 50; i++) { f.cam.position.x += 4; f.cam.updateMatrixWorld(); f.frame(16 + i * 20); }
    expectCadence(writes);
    const count = writes.length;
    f.frame(1017); expect(writes).toHaveLength(count + 1);
    const p = f.view.tileCenter().project(f.cam);
    expect(el.style.transform).toBe(`translate(${(p.x * 0.5 + 0.5) * 800}px, ${(-p.y * 0.5 + 0.5) * 600}px) translate(-50%, -100%)`);
    f.frame(2000); expect(writes).toHaveLength(count + 1);
    expect(f.rect).toHaveBeenCalledTimes(1);
    f.resize(1000, 700);
    expect(el.style.transform).toBe(`translate(${(p.x * 0.5 + 0.5) * 1000}px, ${(-p.y * 0.5 + 0.5) * 700}px) translate(-50%, -100%)`);
    f.screen.dispose();
  });

  it('refreshes changed names / populations and removed cities immediately, even during motion', async () => {
    const f = regionLabels();
    f.frame(16); f.cam.position.x += 10; f.cam.updateMatrixWorld(); f.frame(20);
    f.tiles[0].city = { name: 'New Riverton', population: 18000 };
    let loaded!: () => void;
    f.view.refreshCities.mockImplementationOnce(() => new Promise<void>((resolve) => { loaded = resolve; }));
    const refreshing = f.screen.refresh();
    expect(textOf(f.layer)).toBe('New Riverton18.0k');
    loaded(); await refreshing;
    f.tiles.length = 0;
    await f.screen.refresh();
    expect(f.layer.children).toHaveLength(0);
    f.screen.dispose();
    f.screen.resizeLabels(); f.frame(2000);
    expect(f.rect).toHaveBeenCalledTimes(1);
  });
});
