/**
 * perfrev-v2 bench page (bench4: bench3 + ring=0) (render round 2 final, verify v2). The same file is dropped into every measured side.
 *   bench.html?scene=town|city&q=low|high|ultra&day=<n>&t=<hour>
 * town = the region file /bench/town.metropolis (a base-SimBot grown 128 plains town, 2953 buildings), city = the dense
 * 256 demo city (buildDemoCity size 256 dense). Views: the side's real WorldView + CityObjectsView (as demo-city.html),
 * fixed dt 1/60, dynamic resolution off. window.__bench drives scripted camera segments; window.__ready is set after the
 * load frame plus `veil` frames at the load pose.
 */
import * as THREE from 'three';
import { Emitter } from '../src/core/events';
import { CELL_SIZE } from '../src/core/constants';
import { sharedUniforms } from '../src/assets/materials';
import { registerAllModels } from '../src/assets/builders';
import { buildDemoCity } from '../src/render/city/demoCity';
import { WorldView } from '../src/render/world/WorldView';
import { CityObjectsView } from '../src/render/city/CityObjectsView';

const P = new URLSearchParams(location.search);
const W = window as any;
const kind = P.get('scene') ?? 'town';
const quality = (P.get('q') ?? 'low') as any;
const DT = 1 / 60;
const now = () => performance.timeOrigin + performance.now();
const marks: Record<string, number> = {};
const mark = (k: string) => { marks[k] = now(); if (P.get('log') === '1') console.log('[bench] mark ' + k + ' ' + Math.round(marks[k] - (marks.start ?? marks[k]))); };
mark('start');

async function loadState(): Promise<any> {
  if (kind === 'city') return buildDemoCity({ size: +(P.get('size') ?? 256), seed: 7, buildings: true, fill: 0.8, dense: P.get('dense') !== '0' });
  const save: any = await import('../src/save/index');
  const bytes = new Uint8Array(await (await fetch('/bench/' + (P.get('file') ?? 'town.metropolis'))).arrayBuffer());
  const f = await save.readRegionFile(bytes);
  const city = Object.values(f.cities)[0];
  return save.deserializeCity(city);
}

registerAllModels();
const st = await loadState();
if (P.has('day')) st.day = +P.get('day')!;
mark('state');
const canvas = document.getElementById('c') as HTMLCanvasElement;
const events = new Emitter<any>();
const hour = P.has('t') ? +P.get('t')! : 13;
const wv: any = new WorldView(canvas, st, events as any, { quality, timeOfDay: hour, autoTime: false });
if ('dynamicResolution' in wv) wv.dynamicResolution = false;
if ('renderScale' in wv) wv.renderScale = 1;
const renderer: THREE.WebGLRenderer = wv.renderer;
// bench4: ring=0 turns the outer forest ring + edge band off (TreeRenderer.applyRingOn with ringWidth 0) before the load frame
if (P.get('ring') === '0' && wv.trees && 'ringWidth' in wv.trees) { wv.trees.ringWidth = 0; if (typeof wv.trees.applyRingOn === 'function') wv.trees.applyRingOn(); }
renderer.info.autoReset = false;
const gl = renderer.getContext() as WebGL2RenderingContext;
mark('world');

// ------------------------------------------------------------------ anchor + poses
const N = st.size;
let ax = 0, az = 0;
if (kind === 'city') {
  const S = N / 128;
  ax = 46 * S * CELL_SIZE; az = 50 * S * CELL_SIZE;
} else {
  let sx = 0, sz = 0, n = 0;
  for (const b of st.buildings.values()) { sx += b.x + b.w / 2; sz += b.z + b.d / 2; n++; }
  ax = (n ? sx / n : N / 2) * CELL_SIZE; az = (n ? sz / n : N / 2) * CELL_SIZE;
}
if (P.has('ax')) ax = +P.get('ax')!;
if (P.has('az')) az = +P.get('az')!;
const Y0 = +(P.get('yaw') ?? 45);
const MAPW = N * CELL_SIZE;
interface Pose { x: number; z: number; d: number; tilt: number; yaw: number }
const POSE: Record<string, Pose> = {
  street: { x: ax, z: az, d: 150, tilt: 16, yaw: Y0 },
  default: { x: ax, z: az, d: 800, tilt: 50, yaw: Y0 },
  far: { x: ax, z: az, d: 4000, tilt: 75, yaw: Y0 },
  // edge views: target just inside the east edge, the camera west of it looking east over the edge (yaw 90: the
  // camera sits at target + (-sin yaw, ., cos yaw) * d); camera 300-510 m in from the edge, 35-170 m up
  edgelow: { x: MAPW - 100, z: az, d: 200, tilt: 10, yaw: 90 },
  edget18: { x: MAPW - 150, z: az, d: 300, tilt: 18, yaw: 90 },
  edget25: { x: MAPW - 150, z: az, d: 400, tilt: 25, yaw: 90 },
};
const cc = wv.cameraController;
function apply(p: Pose): void {
  cc.setView(p.x, p.z, p.d, p.tilt, p.yaw);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpLog = (a: number, b: number, t: number) => a * Math.pow(b / a, t);
/** view-right of yaw (deg): CameraController puts the camera at target + (-sin yaw, ., cos yaw) * d */
function right(yaw: number): [number, number] {
  const y = (yaw * Math.PI) / 180;
  return [Math.cos(y), Math.sin(y)];
}
function pan(p: Pose, i: number, step: number): Pose {
  const [rx, rz] = right(p.yaw);
  return { ...p, x: p.x + rx * step * (i + 1), z: p.z + rz * step * (i + 1) };
}
type SegFn = (i: number) => Pose;
interface Seg { n: number; f: SegFn }
const S = POSE;
const at = (p: Pose, yaw?: number): Pose => ({ ...p, yaw: yaw ?? p.yaw });
const SEGS: Record<string, Seg> = {
  veil: { n: +(P.get('veil') ?? 30), f: () => S.default },
  street: { n: 20, f: () => S.street },
  zoomout: { n: 90, f: (i) => { const t = (i + 1) / 90; return { ...S.street, d: lerpLog(S.street.d, S.far.d, t), tilt: lerp(S.street.tilt, S.far.tilt, t) }; } },
  farorbit: { n: 60, f: (i) => at(S.far, Y0 + (90 * (i + 1)) / 60) },
  default: { n: 20, f: () => at(S.default, Y0 + 90) },
  zoomin: { n: 60, f: (i) => { const t = (i + 1) / 60; return { ...S.default, yaw: Y0 + 90, d: lerpLog(S.default.d, S.street.d, t), tilt: lerp(S.default.tilt, S.street.tilt, t) }; } },
  streetpan: { n: 60, f: (i) => pan(at(S.street, Y0 + 90), i, 2) },
  streetfast: { n: 30, f: (i) => pan(at(S.street, Y0 + 90), i, 15) },
  pan: { n: 60, f: (i) => pan(at(S.default, Y0 + 90), i, 5) },
  fastpan: { n: 30, f: (i) => pan(at(S.default, Y0 + 90), i, 40) },
  cuts: { n: 20, f: (i) => [S.far, S.street, S.default, at(S.far, Y0 + 180)][Math.floor(i / 5)] },
  // edge flights (outer forest ring): along the east edge, low; a fast edge flight; a turn from the edge inward
  edgepan: { n: 60, f: (i) => ({ ...S.edget18, z: S.edget18.z - 150 + 5 * (i + 1) }) },
  edgefast: { n: 30, f: (i) => ({ ...S.edgelow, z: S.edgelow.z - 450 + 30 * (i + 1) }) },
  edgeturn: { n: 60, f: (i) => at(S.edget25, 90 + (120 * (i + 1)) / 60) },
};
const STILL = ['street', 'default', 'far', 'edgelow', 'edget18', 'edget25'];

// ------------------------------------------------------------------ objects view
const t1 = now();
const view: any = new CityObjectsView(st, events as any, { scene: wv.scene, camera: wv.camera, renderer, canvas, quality } as any);
mark('objects');
W.__wv = wv;
W.__view = view;
W.__st = st;

// ------------------------------------------------------------------ instrumentation: draw calls / triangles per pass
const info = renderer.info.render;
let shCalls = 0, shTris = 0, mainCalls = 0, mainTris = 0, nRenders = 0;
let inShadow = 0;
const sm: any = renderer.shadowMap;
const smRender = sm.render.bind(sm);
sm.render = function (...a: any[]) {
  const c0 = info.calls, t0 = info.triangles;
  inShadow++;
  try { return smRender(...a); } finally {
    inShadow--;
    shCalls += info.calls - c0; shTris += info.triangles - t0;
  }
};
const rRender = renderer.render.bind(renderer);
(renderer as any).render = function (scene: THREE.Object3D, camera: THREE.Camera) {
  const c0 = info.calls, t0 = info.triangles, s0c = shCalls, s0t = shTris;
  nRenders++;
  try { return rRender(scene as any, camera); } finally {
    if (scene === wv.scene && camera === wv.camera && inShadow === 0) {
      mainCalls += info.calls - c0 - (shCalls - s0c);
      mainTris += info.triangles - t0 - (shTris - s0t);
    }
  }
};
// total draws issued to GL (all passes, incl. post), counted at the API. nodraw=1: the draw calls (and MSAA resolve
// blits) are not passed on to GL — everything else three.js and the city do per frame (culling, LOD, lists, state,
// uniforms, buffer / texture uploads, program compiles) still runs; the GPU process then has (almost) nothing to
// rasterize, which keeps the software GL off the CPU cores the main thread is measured on.
let glDraws = 0;
const drawState = { on: P.get('nodraw') !== '1' };
const wrapDraw = (obj: any, k: string, count: boolean) => {
  const f = obj[k];
  if (typeof f !== 'function') return;
  obj[k] = function (...a: any[]) { if (count) glDraws++; if (drawState.on) return f.apply(obj, a); };
};
for (const k of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) wrapDraw(gl, k, true);
wrapDraw(gl, 'blitFramebuffer', false);
const md = gl.getExtension('WEBGL_multi_draw');
if (md) for (const k of ['multiDrawArraysWEBGL', 'multiDrawElementsWEBGL', 'multiDrawArraysInstancedWEBGL', 'multiDrawElementsInstancedWEBGL']) wrapDraw(md, k, true);

const mem = (performance as any).memory;
const heap = () => (mem ? mem.usedJSHeapSize : 0);

// ------------------------------------------------------------------ frame loop
const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
interface FrameRec { t: number; js: number; up: number; ob: number; rn: number; calls: number; tris: number; mc: number; mt: number; sc: number; st: number; gd: number; h: number }
let frameNo = 0;
function frame(p: Pose | null): FrameRec {
  const t = now();
  if (p) apply(p);
  shCalls = shTris = mainCalls = mainTris = 0; glDraws = 0;
  renderer.info.reset();
  const a = performance.now();
  sharedUniforms.uTime.value += DT;
  wv.update(DT);
  const b = performance.now();
  view.update(DT);
  const c = performance.now();
  wv.render();
  const d = performance.now();
  frameNo++;
  // (every side's WorldView.render resets renderer.info first: these are the frame's totals, all passes)
  const calls = info.calls, tris = info.triangles;
  return { t, js: d - a, up: b - a, ob: c - b, rn: d - c, calls, tris, mc: mainCalls, mt: mainTris, sc: shCalls, st: shTris, gd: glDraws, h: heap() };
}

async function runFrames(n: number, f: (i: number) => Pose | null): Promise<FrameRec[]> {
  const out: FrameRec[] = [];
  for (let i = 0; i < n; i++) {
    await raf();
    out.push(frame(f(i)));
  }
  await raf(); // let the last frame commit before the segment ends
  return out;
}

function summarize(fr: FrameRec[]) {
  const sum = (k: keyof FrameRec) => fr.reduce((s, r) => s + (r[k] as number), 0);
  let alloc = 0;
  for (let i = 1; i < fr.length; i++) { const dh = fr[i].h - fr[i - 1].h; if (dh > 0) alloc += dh; }
  return {
    n: fr.length, js: sum('js'), up: sum('up'), ob: sum('ob'), rn: sum('rn'), calls: sum('calls'), tris: sum('tris'), mc: sum('mc'), mt: sum('mt'), sc: sum('sc'), st: sum('st'), gd: sum('gd'),
    jsMax: Math.max(...fr.map((r) => r.js)), allocKB: fr.length > 1 ? alloc / 1024 / (fr.length - 1) : 0,
  };
}

W.__bench = {
  kind, quality, anchor: [ax, az], segs: Object.keys(SEGS), still: STILL, marks,
  async seg(name: string, detail = false) {
    const s = SEGS[name];
    if (!s) throw new Error('no segment ' + name);
    const fr = await runFrames(s.n, s.f);
    return { name, ...summarize(fr), frames: detail ? fr : undefined, t0: fr[0].t, t1: now() };
  },
  /** hold a still view: settle `settle` frames there (not reported) */
  async still(name: string, settle = 30) {
    const p = POSE[name];
    const fr = await runFrames(settle, () => p);
    return summarize(fr.slice(-5));
  },
  /** one drawn frame at the current pose with the shadow map forced, then wait for the GPU to finish it */
  async drawOne(force = true) {
    await raf();
    if (force) { if (typeof wv.invalidateShadows === 'function') wv.invalidateShadows(1); renderer.shadowMap.needsUpdate = true; }
    const was = drawState.on;
    drawState.on = true;
    let r: FrameRec;
    try { r = frame(null); } finally { drawState.on = was; }
    await raf();
    gl.finish();
    return r;
  },
  setDraw(on: boolean) { drawState.on = on; return drawState.on; },
  /** frame i of segment `name` as the segment runs it (one rAF), drawn or not; a drawn frame waits for the GPU (gl.finish
   *  after the next rAF) so the driver can read the GPU process's CPU for it alone (bench3: GPU stand-in along a sequence) */
  async step(name: string, i: number, draw: boolean) {
    const s = SEGS[name];
    if (!s) throw new Error('no segment ' + name);
    await raf();
    const was = drawState.on;
    drawState.on = draw;
    let r: FrameRec;
    try { r = frame(s.f(i)); } finally { drawState.on = was; }
    if (draw) { await raf(); gl.finish(); }
    return r;
  },
  segLen(name: string) { return SEGS[name]?.n ?? 0; },
  stats() {
    let s: any = {};
    try { s = view.stats?.() ?? {}; } catch { /* */ }
    return { ...s, heap: heap(), programs: (renderer.info as any).programs?.length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, frameNo, warm: wv.warmStats };
  },
  gc() { (window as any).gc?.(); return heap(); },
};

// ------------------------------------------------------------------ load: first frame at the default pose, then the veil frames
apply(POSE.default);
wv.resize(window.innerWidth, window.innerHeight);
wv.update(0);
mark('preframe');
const first = await runFrames(1, () => POSE.default);
mark('frame1');
const veil = await runFrames(SEGS.veil.n, SEGS.veil.f);
mark('ready');
W.__load = { marks, first: first[0], veil: summarize(veil), veilFrames: veil, buildings: st.buildings.size, objectsMs: marks.objects - t1 };
W.__ready = true;
console.log('[bench] ready ' + JSON.stringify({ kind, quality, b: st.buildings.size, load: Math.round(marks.ready - marks.start), first: Math.round(first[0].js) }));
