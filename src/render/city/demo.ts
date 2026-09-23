/**
 * render-city demo (demo-city.html): synthetic city + CityObjectsView on a minimal stand-in world.
 *
 * URL params:
 *   size=64|128|256   map size (default 128)          seed=<n>
 *   cx=, cz=          camera target in cells (default: downtown)
 *   dist=<m>          camera distance (default 520)    yaw=<deg> (45)  pitch=<deg> (42)
 *   t=<hour>          time of day 0..24 (default 14)   night=1 (= t=22)
 *   sim=<s>           seconds of simulation before the first frame (default 6)
 *   static=1          render once (for screenshots), no animation loop
 *   b=0               no buildings                     fill=0..1 lot fill (0.8)
 *   q=low|medium|high|ultra   quality                  hud=0 hide HUD
 *   underground=1     overlay=1    ghost=<modelId>@x,z,rot,ok    sel=<id|auto>
 *   preview=road|power|subway   (network drag preview demo)    shadows=0
 * Mouse: left-drag orbit, right-drag pan, wheel zoom, click = pick/select. Keys: N night, U underground, O overlay.
 * Sets window.__ready once the first frame rendered; logs CITY_STATS {...}.
 */
import * as THREE from 'three';
import { Emitter } from '../../core/events';
import { CELL_SIZE } from '../../core/constants';
import { Network, Overlay } from '../../core/types';
import type { CityEvents } from '../../sim/Simulation';
import { sharedUniforms } from '../../assets/materials';
import { registerAllModels } from '../../assets/builders';
import { buildDemoCity } from './demoCity';
import { DemoWorld } from './demoWorld';
import { WorldView } from '../world/WorldView';
import { CityObjectsView } from './CityObjectsView';
import type { QualityLevel } from '../contracts';

const P = new URLSearchParams(location.search);
const num = (k: string, d: number) => (P.has(k) ? parseFloat(P.get(k)!) : d);

registerAllModels();
const size = num('size', 128);
const t0 = performance.now();
const st = buildDemoCity({ size, seed: num('seed', 7), buildings: P.get('b') !== '0', fill: num('fill', 0.8) });
const tCity = performance.now() - t0;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
if (P.get('hud') === '0') hud.classList.add('hidden');
const events = new Emitter<CityEvents>();
const S = size / 128;
let hour = P.has('t') ? num('t', 14) : P.get('night') === '1' ? 22 : 14;
const quality = (P.get('q') as QualityLevel) ?? 'high';

/** thin adapter so the demo runs on the real WorldView (default) or the stand-in DemoWorld (?world=demo) */
interface DemoHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  distance: number;
  yaw: number;
  pitch: number;
  ownsInput: boolean;
  setHour(h: number): void;
  update(dt: number): void;
  render(): void;
  resize(w: number, h: number): void;
}

function makeHost(): DemoHost {
  if (P.get('world') !== 'demo') {
    try {
      const wv = new WorldView(canvas, st, events, { quality, timeOfDay: hour, autoTime: false });
      const host: DemoHost = {
        renderer: wv.renderer, scene: wv.scene, camera: wv.camera, target: new THREE.Vector3(), distance: 500, yaw: 45, pitch: 42, ownsInput: true,
        setHour: (h) => { wv.timeOfDay = h; },
        update: (dt) => wv.update(dt),
        render: () => wv.render(),
        resize: (w, h) => wv.resize(w, h),
      };
      (host as any).applyView = () => wv.cameraController.setView(host.target.x, host.target.z, host.distance, host.pitch, host.yaw);
      (window as any).__worldView = wv;
      return host;
    } catch (e) {
      console.warn('[demo] WorldView failed, falling back to DemoWorld', e);
    }
  }
  const dw = new DemoWorld(canvas, st);
  if (P.get('shadows') === '0') dw.renderer.shadowMap.enabled = false;
  const host: DemoHost = {
    renderer: dw.renderer, scene: dw.scene, camera: dw.camera, target: dw.target, distance: 500, yaw: 45, pitch: 42, ownsInput: false,
    setHour: (h) => dw.setTime(h),
    update: () => { dw.distance = host.distance; dw.yaw = host.yaw; dw.pitch = host.pitch; dw.updateCamera(); },
    render: () => dw.render(),
    resize: (w, h) => dw.resize(w, h),
  };
  return host;
}
const world = makeHost();
world.target.set(num('cx', 46 * S) * CELL_SIZE, 0, num('cz', 50 * S) * CELL_SIZE);
world.target.y = st.heightAt(world.target.x, world.target.z);
world.distance = num('dist', 520);
world.yaw = num('yaw', 45);
world.pitch = num('pitch', 42);
(world as any).applyView?.();
world.setHour(hour);
world.resize(window.innerWidth, window.innerHeight);
world.update(0);

const t1 = performance.now();
const view = new CityObjectsView(st, events, {
  scene: world.scene, camera: world.camera, renderer: world.renderer, canvas, quality,
});
const tView = performance.now() - t1;
(window as any).__city = { view, st, world, events };

if (P.get('underground') === '1') view.setUnderground(true);
if (P.get('overlay') === '1') { view.setOverlayMode(Overlay.Traffic); (window as any).__worldView?.setOverlay(Overlay.Traffic); }
if (P.get('ghost')) {
  const [id, rest] = P.get('ghost')!.split('@');
  const [gx, gz, gr, gok] = (rest ?? '40,40,0,1').split(',').map(Number);
  view.setGhost(id, gx, gz, (gr | 0) as 0 | 1 | 2 | 3, gok !== 0);
}
if (P.get('preview')) {
  const kind = P.get('preview');
  const path: { x: number; z: number }[] = [];
  const cx = Math.round(world.target.x / CELL_SIZE), cz = Math.round(world.target.z / CELL_SIZE);
  for (let k = -8; k <= 8; k++) path.push({ x: cx + k, z: cz + 3 });
  for (let k = 1; k <= 6; k++) path.push({ x: cx + 8, z: cz + 3 + k });
  view.setNetworkPreview(path, kind === 'power' ? 'power' : kind === 'subway' ? 'subway' : kind === 'bad' ? Network.Road : Network.Avenue, kind !== 'bad');
}
const selParam = P.get('sel');
if (selParam) {
  let id = parseInt(selParam, 10);
  if (selParam === 'auto') {
    // biggest building near the target
    let best = -1, bestScore = -1;
    for (const b of st.buildings.values()) {
      const dx = (b.x + b.w / 2) * CELL_SIZE - world.target.x, dz = (b.z + b.d / 2) * CELL_SIZE - world.target.z;
      const sc = b.w * b.d * 100 - Math.hypot(dx, dz);
      if (Math.hypot(dx, dz) < 200 && sc > bestScore) { bestScore = sc; best = b.id; }
    }
    id = best;
  }
  if (id >= 0) view.setSelected(id);
}

// disaster demo: ?disaster=tornado|quake|meteor
const disaster = P.get('disaster');
let tornadoT = 0;
const tcx = world.target.x / CELL_SIZE, tcz = world.target.z / CELL_SIZE;
if (disaster === 'quake') events.emit('disaster', { kind: 'earthquake', x: tcx | 0, z: tcz | 0, active: true });
if (disaster === 'meteor') events.emit('disaster', { kind: 'meteor', x: (tcx | 0) + 3, z: (tcz | 0) + 3, active: true });
function stepDisaster(dt: number) {
  if (disaster !== 'tornado') return;
  tornadoT += dt;
  if (Math.floor(tornadoT * 2) !== Math.floor((tornadoT - dt) * 2) || tornadoT === dt) {
    events.emit('disaster', { kind: 'tornado', x: tcx - 6 + tornadoT * 0.4 + 0.01, z: tcz + Math.sin(tornadoT * 0.3) * 3 + 0.01, active: true });
  }
}

// pre-simulate so vehicles spread out and pop-ins finish
const simT = num('sim', 6);
const dtS = 1 / 20;
for (let t = 0; t < simT; t += dtS) {
  sharedUniforms.uTime.value += dtS;
  stepDisaster(dtS);
  view.update(dtS);
}

// ?perf=1: CPU cost of update() and of incremental edits
if (P.get('perf') === '1') {
  const N = st.size;
  const t0p = performance.now();
  const frames = 120;
  for (let k = 0; k < frames; k++) { sharedUniforms.uTime.value += 1 / 60; view.update(1 / 60); }
  const upd = (performance.now() - t0p) / frames;
  // network edit: draw a new road across a block, measure until all dirty chunks are rebuilt
  const zEdit = Math.round(N * 0.55);
  const t1p = performance.now();
  for (let x = Math.round(N * 0.3); x < Math.round(N * 0.45); x++) {
    const i = zEdit * N + x;
    if (!st.network[i] && st.building[i] < 0) st.network[i] = Network.Road;
  }
  events.emit('networkChanged', { x0: Math.round(N * 0.3), z0: zEdit, x1: Math.round(N * 0.45), z1: zEdit + 1 });
  let guard = 0;
  while (view.roads.hasDirty && guard++ < 1000) view.update(1 / 60);
  const edit = performance.now() - t1p;
  // building churn: remove + re-add 200 buildings
  const t2p = performance.now();
  const some = [...st.buildings.values()].slice(0, 200);
  for (const b of some) events.emit('buildingRemoved', b);
  for (const b of some) events.emit('buildingAdded', b);
  view.update(1 / 60);
  const churn = performance.now() - t2p;
  console.log('CITY_PERF ' + JSON.stringify({ size: N, buildings: st.buildings.size, updateMs: +upd.toFixed(2), roadEditMs: Math.round(edit), churn200Ms: Math.round(churn), ...view.stats() }));
}

function statsLine(): string {
  const s = view.stats();
  const info = world.renderer.info.render;
  return JSON.stringify({ ...s, glCalls: info.calls, glTris: info.triangles, cityMs: Math.round(tCity), viewMs: Math.round(tView) });
}

let frames = 0;
let fpsT = performance.now(), fps = 0;
function frame(dt: number) {
  sharedUniforms.uTime.value += dt;
  world.update(dt);
  stepDisaster(dt);
  view.update(dt);
  world.render();
  frames++;
  const now = performance.now();
  if (now - fpsT > 1000) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
  if (!hud.classList.contains('hidden')) {
    const s = view.stats();
    const info = world.renderer.info.render;
    hud.textContent = `fps ${fps.toFixed(0)}  calls ${info.calls}  tris ${(info.triangles / 1e3).toFixed(0)}k\n` +
      `roads ${s.roadDrawCalls} chunks  ${(s.roadTriangles / 1e3).toFixed(0)}k tris\n` +
      `buildings ${s.buildings}  props ${s.props}  pools ${s.lightPools}\n` +
      `vehicles ${s.vehicles}  trains ${s.trains}  particles ${s.particles}\n` +
      `t=${hour.toFixed(1)}h  [N] night [U] underground [O] overlay`;
  }
}

if (P.get('static') === '1') {
  frame(1 / 60);
  frame(1 / 60);
  console.log('CITY_STATS ' + statsLine());
  (window as any).__ready = true;
} else {
  let last = performance.now();
  let first = true;
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frame(dt);
    if (first) { first = false; console.log('CITY_STATS ' + statsLine()); (window as any).__ready = true; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ interaction
window.addEventListener('resize', () => world.resize(window.innerWidth, window.innerHeight));
let drag: { x: number; y: number; b: number; moved: boolean } | null = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, b: e.button, moved: false }; });
window.addEventListener('pointerup', (e) => {
  if (drag && !drag.moved && drag.b === 0) {
    const id = view.pickBuilding(e.clientX, e.clientY);
    view.setSelected(id);
    if (id != null) console.log('[demo] picked', id, st.buildings.get(id));
  }
  drag = null;
});
window.addEventListener('pointermove', (e) => {
  if (!drag || world.ownsInput) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.b === 0) {
    world.yaw -= dx * 0.3;
    world.pitch = Math.min(88, Math.max(8, world.pitch + dy * 0.2));
  } else {
    const yaw = THREE.MathUtils.degToRad(world.yaw);
    const k = world.distance * 0.0018;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    world.target.x += (-dx * rx + dy * fx) * k * 1.0;
    world.target.z += (-dx * rz + dy * fz) * k * 1.0;
    world.target.y = st.heightAt(world.target.x, world.target.z);
  }
});
canvas.addEventListener('wheel', (e) => {
  world.distance = Math.min(9000, Math.max(25, world.distance * Math.exp(e.deltaY * 0.0012)));
  e.preventDefault();
}, { passive: false });
let ug = P.get('underground') === '1', ov = P.get('overlay') === '1';
window.addEventListener('keydown', (e) => {
  if (e.key === 'n' || e.key === 'N') { hour = hour > 6 && hour < 19 ? 22 : 13; world.setHour(hour); }
  if (e.key === 'u' || e.key === 'U') { ug = !ug; view.setUnderground(ug); }
  if (e.key === 'o' || e.key === 'O') { ov = !ov; view.setOverlayMode(ov ? Overlay.Traffic : Overlay.None); (window as any).__worldView?.setOverlay(ov ? Overlay.Traffic : Overlay.None); }
});
