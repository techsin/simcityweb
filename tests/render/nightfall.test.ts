/**
 * T084 (NOTE-073 item 2): the sun -> moon handover must not change what three.js keys its programs on.
 *
 * WorldView used to hide the sun light while the direct light is off (Sky.lightRig: under 0.002, for a minute or two
 * after dusk and about twelve before dawn). three.js r186 keys every program on the light and shadow counts
 * (numSunLights / numDirLights, their shadow counts, shadowMapEnabled), so every material in view needed a second
 * program at the first dusk after a city entry, and three waited for each link in turn: one frame of 3.4-5.3 s on the
 * real GPU. The light now stays in the light state at intensity 0, and only the shadow map's re-render stops.
 *
 * Here a real WorldView (its own constructor, sky, light rig, update() and render()) runs on a stand-in renderer with
 * no GL context. Each scene render is taken the way three.js takes it: the lights of the visible objects on the
 * camera's layers (WebGLRenderer.projectObject), three's own WebGLLights state and three's own program cache keys
 * (WebGLPrograms.getParameters / getProgramCacheKey, from three/src), and WebGLShadowMap.render's early-outs for the
 * shadow pass. The view's clock is stepped through two full days, so through both handovers twice, on every quality:
 *  - the light state's version, its counts and every program cache key stay what they were at the first frame: the
 *    sun stays visible and shadow-casting, renderer.shadowMap stays enabled, one directional light is in the state;
 *  - while the direct light is off the sun's intensity is exactly 0 and no shadow map render is asked for (with the
 *    shadow cache, without it, and by a capture); the first frame it is on again re-renders the map;
 *  - a view that starts with the light off (a city entered in those minutes) has the same state from its first frame.
 *
 * The browser check, tools/qa-nightfall.mjs, cannot run here. Its page-side probe and its verdicts
 * (tools/qa-nightfall-probe.mjs) run on the same view, with animation frames driven by hand: they pass the view as it
 * is, and fail it as it was (the sun light hidden again from outside, a frame held for every program three then links).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WebGLLights } from 'three/src/renderers/webgl/WebGLLights.js';
import { WebGLPrograms } from 'three/src/renderers/webgl/WebGLPrograms.js';
import { Emitter } from '../../src/core/events';
import type { CityEvents } from '../../src/sim/Simulation';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import type { QualityLevel } from '../../src/render/contracts';
import { QUALITY_PRESETS } from '../../src/render/world/quality';
import { WorldView, type WorldViewOptions } from '../../src/render/world/WorldView';
import { describeWindow, hhmm, installNightfallProbe, nightfallChecks, parseWindows, type NightfallReport, type NightfallState, type NightfallWindow } from '../../tools/qa-nightfall-probe.mjs';

/** the stand-in renderer hands each scene render to the test */
const gl = vi.hoisted(() => ({ onScene: null as null | ((renderer: object, scene: object, camera: object) => void) }));

vi.mock('three', async (importOriginal) => {
  const real = await importOriginal<typeof import('three')>();
  /** WebGLRenderer without a context: the state WorldView and three's program parameters read, at three's defaults */
  class StubRenderer {
    readonly domElement: HTMLCanvasElement;
    toneMapping: number = real.NoToneMapping;
    outputColorSpace: string = real.SRGBColorSpace;
    toneMappingExposure = 1;
    autoClear = true;
    readonly shadowMap = { enabled: false, type: real.PCFShadowMap as number, autoUpdate: true, needsUpdate: false };
    readonly info = { autoReset: true, programs: [] as unknown[], render: { calls: 0, triangles: 0, points: 0, lines: 0 }, reset: () => undefined };
    readonly properties = { get: () => ({}) };
    readonly state = { buffers: { depth: { getReversed: () => false } } };
    private target: unknown = null;
    constructor(o: { canvas: HTMLCanvasElement }) {
      this.domElement = o.canvas;
    }
    setClearColor(): void {}
    setPixelRatio(): void {}
    setSize(): void {}
    clear(): void {}
    compile(): void {}
    readRenderTargetPixels(): void {}
    dispose(): void {}
    forceContextLoss(): void {}
    getRenderTarget(): unknown {
      return this.target;
    }
    setRenderTarget(t: unknown): void {
      this.target = t;
    }
    /** (the full-screen passes render a Mesh: only the scene pass counts) */
    render(scene: { isScene?: boolean }, camera: object): void {
      if (scene.isScene === true) gl.onScene?.(this, scene, camera);
    }
  }
  /** PMREMGenerator without a renderer: one CubeUV target per source size, reused when passed back in (as three does) */
  class StubPMREM {
    fromEquirectangular(src: THREE.Texture, target?: THREE.WebGLRenderTarget | null): THREE.WebGLRenderTarget {
      if (target) return target;
      const cube = 2 ** Math.floor(Math.log2(Math.max(16, (src.image as { width: number }).width / 4)));
      const rt = new real.WebGLRenderTarget(3 * Math.max(cube, 112), 4 * cube);
      rt.texture.mapping = real.CubeUVReflectionMapping;
      return rt;
    }
    dispose(): void {}
  }
  return { ...real, WebGLRenderer: StubRenderer, PMREMGenerator: StubPMREM };
});

type ShadowMapState = { enabled: boolean; type: number; autoUpdate: boolean; needsUpdate: boolean };

/** one scene render, as three.js would have taken it */
interface Frame {
  /** the view's hour, and whether the light rig's direct light is on (WorldView's threshold) */
  tod: number;
  lit: boolean;
  sunVisible: boolean;
  sunIntensity: number;
  castShadow: boolean;
  shadowMapEnabled: boolean;
  /** directional lights (the sun, in either shadow mode) three puts in its light state */
  dirLights: number;
  /** WebGLLights state.version: three re-resolves every lit material's program when it moves */
  version: number;
  /** the light-state part of three's program parameters */
  counts: string;
  /** three's program cache keys of a lit and an unlit probe material */
  keys: string;
  /** three's program cache key of every material in the scene, by material uuid: in the frames with the light off, the
   *  first with it on again, and now and then */
  scene: Map<string, string> | null;
  /** renderer.info.programs.length: one program per distinct cache key of the two probes so far */
  programs: number;
  /** did three render the shadow map in this frame (WebGLShadowMap.render) */
  shadowPass: boolean;
}

class FakeCanvas extends EventTarget {
  width = 1280;
  height = 720;
  clientWidth = 1280;
  clientHeight = 720;
  style = {};
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720, x: 0, y: 0 };
  }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
}

/** a real WorldView on the stand-in renderer, and three's view of each of its scene renders */
function world(quality: QualityLevel, opts: WorldViewOptions = {}) {
  // (hills, water and trees: every renderer of the view has something to draw)
  const state = createCityState(defaultCityConfig({ size: 32, seed: 7, terrain: 'hills', climate: 'temperate', treeDensity: 0.5, waterAmount: 0.3, disasters: false }));
  const view = new WorldView(new FakeCanvas() as unknown as HTMLCanvasElement, state, new Emitter<CityEvents>(), { ...opts, quality });
  const renderer = view.renderer as unknown as { shadowMap: ShadowMapState };
  const lightState = new WebGLLights({ has: () => true } as never);
  const programs = new WebGLPrograms(
    view.renderer,
    { get: (t: THREE.Texture | null) => t ?? null } as never,
    { has: () => false } as never,
    { precision: 'highp', logarithmicDepthBuffer: false, getMaxPrecision: (p: string) => p } as never,
    {} as never,
    { numPlanes: 0, numIntersection: 0 } as never,
  );
  // (keys are taken on one probe mesh: the material's, the scene's and the light state's part of the key, whatever
  // the meshes that happen to be in the scene at that frame)
  const probe = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const probes = [new THREE.MeshStandardMaterial({ name: 'probe-lit' }), new THREE.MeshBasicMaterial({ name: 'probe-unlit' })];
  // (three's program list: a new program for every cache key it has not linked yet)
  const linked = (view.renderer.info as unknown as { programs: string[] }).programs;
  const frames: Frame[] = [];
  gl.onScene = (r, sc, cam) => {
    if (r !== view.renderer) return;
    const scene = sc as THREE.Scene, camera = cam as THREE.Camera;
    // WebGLRenderer.projectObject (r186): the lights of visible objects on the camera's layers, the shadow casters
    const lights: THREE.Light[] = [], shadows: THREE.Light[] = [];
    const project = (o: THREE.Object3D) => {
      if (o.visible === false) return;
      if (o.layers.test(camera.layers) && (o as THREE.Light).isLight) {
        lights.push(o as THREE.Light);
        if (o.castShadow) shadows.push(o as THREE.Light);
      }
      for (const c of o.children) project(c);
    };
    project(scene);
    // WebGLShadowMap.render: nothing while it is disabled, not asked for, or no visible light casts a shadow
    const sm = renderer.shadowMap;
    const shadowPass = sm.enabled && (sm.autoUpdate || sm.needsUpdate) && shadows.length > 0;
    if (shadowPass) sm.needsUpdate = false;
    lightState.setup(lights);
    const s = lightState.state;
    const keyOf = (m: THREE.Material) => programs.getProgramCacheKey(programs.getParameters(m, s, shadows, scene, probe, []));
    const lit = view.sky.lighting.lightIntensity > 0.002;
    const n = frames.length;
    let all: Map<string, string> | null = null;
    if (!lit || (n > 0 && !frames[n - 1].lit) || n % 480 === 0) {
      all = new Map();
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        for (const x of Array.isArray(m) ? m : [m]) if (!all!.has(x.uuid)) all!.set(x.uuid, `${x.type} "${x.name}": ${keyOf(x)}`);
      });
    }
    const keys = probes.map(keyOf);
    for (const k of keys) if (!linked.includes(k)) linked.push(k);
    frames.push({
      tod: view.timeOfDay,
      lit,
      sunVisible: view.sun.visible,
      sunIntensity: view.sun.intensity,
      castShadow: view.sun.castShadow,
      shadowMapEnabled: sm.enabled,
      dirLights: lights.filter((l) => (l as THREE.DirectionalLight).isDirectionalLight).length,
      version: s.version,
      counts: `sun ${s.sun.length} dir ${s.directional.length} point ${s.point.length} spot ${s.spot.length} hemi ${s.hemi.length} probes ${s.numLightProbes}`
        + ` | shadows: sun ${s.sunShadowMap.length} dir ${s.directionalShadowMap.length} point ${s.pointShadowMap.length} spot ${s.spotShadowMap.length}`
        + ` | shadowMapEnabled ${sm.enabled && shadows.length > 0} type ${sm.type} | fog ${!!scene.fog} env ${scene.environment?.uuid ?? null}`,
      keys: keys.join('\n'),
      scene: all,
      programs: linked.length,
      shadowPass,
    });
  };
  return {
    view, frames,
    /** one frame of the game loop (CityScene.loop); `between`: something done to the view between its update and render */
    step(dt = 0.25, between?: () => void): Frame {
      view.update(dt);
      between?.();
      view.render();
      return frames[frames.length - 1];
    },
  };
}

/** runs of frames with the direct light off: [first, last] frame index */
function unlitSpans(frames: Frame[]): [number, number][] {
  const out: [number, number][] = [];
  frames.forEach((f, i) => {
    if (f.lit) return;
    const last = out[out.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  });
  return out;
}

/** what three keys its programs on is, at every frame, what it was at the first one */
function expectOneLightState(frames: Frame[]): void {
  const first = frames[0];
  const distinct = <K extends keyof Frame>(k: K) => [...new Set(frames.map((f) => f[k]))];
  expect(distinct('sunVisible')).toEqual([true]);
  expect(distinct('castShadow')).toEqual([true]);
  expect(distinct('shadowMapEnabled')).toEqual([true]);
  expect(distinct('dirLights')).toEqual([1]);
  expect(distinct('counts')).toEqual([first.counts]);
  expect(distinct('version')).toEqual([first.version]);
  expect(distinct('keys')).toEqual([first.keys]);
  expect(distinct('programs')).toEqual([2]);
  // every material of the scene (the materials a later frame still has)
  const ref = first.scene!;
  expect(ref.size).toBeGreaterThan(4);
  for (const f of frames) {
    if (!f.scene) continue;
    const changed = [...ref].filter(([id, key]) => f.scene!.has(id) && f.scene!.get(id) !== key).map(([, key]) => key.slice(0, 60));
    expect(changed, `program keys of the scene's materials at ${hhmm(f.tod)}`).toEqual([]);
  }
}

/** off: the light adds nothing and its shadow map is left alone; on: it shines, and the first frame re-renders the map */
function expectOffMeansOff(frames: Frame[]): void {
  for (const f of frames) {
    if (f.lit) expect(f.sunIntensity, `sun intensity at ${hhmm(f.tod)}`).toBeGreaterThan(0);
    else {
      expect(f.sunIntensity, `sun intensity at ${hhmm(f.tod)}`).toBe(0);
      expect(f.shadowPass, `shadow map render at ${hhmm(f.tod)}`).toBe(false);
    }
  }
  for (const [, b] of unlitSpans(frames)) {
    if (b + 1 < frames.length) expect(frames[b + 1].shadowPass, `shadow map render at ${hhmm(frames[b + 1].tod)}`).toBe(true);
  }
}

describe('the sun -> moon handover (T084)', () => {
  beforeEach(() => {
    // (CameraController listens on window; WorldView reads its devicePixelRatio)
    vi.stubGlobal('window', new EventTarget());
  });
  afterEach(() => {
    gl.onScene = null;
    vi.unstubAllGlobals();
  });

  // low: the single shadow map (a DirectionalLight in three's light state); the others: two cascades (its SunLight path)
  for (const quality of Object.keys(QUALITY_PRESETS) as QualityLevel[]) {
    it(`${quality}: two days of the view's clock never change three's light state or a program cache key`, () => {
      const w = world(quality);
      const { view, frames } = w;
      const cascades = QUALITY_PRESETS[quality].shadowCascades === 2;
      expect(view.sun.cascaded).toBe(cascades);
      // the game's own pace: 2 game minutes a second, here in quarter-second frames (half a game minute each)
      expect(view.autoTime).toBe(true);
      expect(view.timeScale).toBe(2);
      for (let i = 0; i < 2 * 24 * 120; i++) w.step();
      // both handovers, twice: after dusk and before dawn (day 0 of the year: 19:12-19:13 and 06:05-06:17)
      const spans = unlitSpans(frames);
      expect(spans.map(([a]) => (frames[a].tod > 12 ? 'dusk' : 'dawn'))).toEqual(['dusk', 'dawn', 'dusk', 'dawn']);
      for (const [a, b] of spans) {
        expect(b - a + 1, `frames with the light off from ${hhmm(frames[a].tod)}`).toBeGreaterThanOrEqual(2);
        const [from, to] = frames[a].tod > 12 ? [18.8, 20.2] : [5, 6.5];
        expect(frames[a].tod).toBeGreaterThan(from);
        expect(frames[b].tod).toBeLessThan(to);
      }
      expect(frames.filter((f) => f.scene).length).toBeGreaterThan(spans.length * 3);

      expectOneLightState(frames);
      expect(frames[0].counts).toContain(cascades ? 'sun 1 dir 0' : 'sun 0 dir 1');
      expect(frames[0].counts).toContain(cascades ? 'shadows: sun 1 dir 0' : 'shadows: sun 0 dir 1');
      expect(frames[0].counts).toContain('shadowMapEnabled true');
      expectOffMeansOff(frames);
      // (while it is on, the moving light keeps re-rendering the map)
      expect(frames.filter((f) => f.shadowPass).length).toBeGreaterThan(1000);
      view.dispose();
    }, 240_000);
  }

  it('a view that starts in the handover has the same light state from its first frame', () => {
    for (const quality of ['low', 'high'] as const) {
      // (day 0 of the year: the light is off from 19:12 to 19:13)
      const w = world(quality, { timeOfDay: 19.21 });
      const { view, frames } = w;
      for (let i = 0; i < 40; i++) w.step(0.05);
      expect(frames[0].lit).toBe(false);
      expect(frames[0].sunIntensity).toBe(0);
      expect(frames[0].counts).toContain(quality === 'high' ? 'sun 1 dir 0 ' : 'sun 0 dir 1 ');
      expect(frames[0].counts).toContain('shadowMapEnabled true');
      expect(unlitSpans(frames).length).toBe(1);
      expect(frames[frames.length - 1].lit).toBe(true);
      expectOneLightState(frames);
      expectOffMeansOff(frames);
      view.dispose();
    }
  }, 120_000);

  it('without the shadow cache three renders the map itself, but not while the light is off', () => {
    const w = world('low');
    w.view.shadowCache = false;
    w.view.timeOfDay = 18.9;
    for (let i = 0; i < 120; i++) w.step();
    expect(unlitSpans(w.frames).length).toBe(1);
    expect(w.frames[w.frames.length - 1].tod).toBeGreaterThan(19.8);
    for (const f of w.frames) expect(f.shadowPass, `shadow map render at ${hhmm(f.tod)}`).toBe(f.lit);
    expectOneLightState(w.frames);
    w.view.dispose();
  }, 120_000);

  it('a capture while the light is off renders no shadow map; one while it is on does', () => {
    // (capture() copies its pixels through a 2D canvas)
    const canvas2d = { width: 0, height: 0, getContext: () => ({ createImageData: (cw: number, ch: number) => ({ data: new Uint8ClampedArray(cw * ch * 4) }), putImageData: () => undefined }), toDataURL: () => 'data:,' };
    vi.stubGlobal('document', { createElement: () => canvas2d });
    for (const quality of ['low', 'high'] as const) {
      const w = world(quality);
      const { view, frames } = w;
      const shot = (topDown: boolean): Frame => {
        const n = frames.length;
        expect(view.capture(64, 64, topDown)).toBe('data:,');
        expect(frames.length).toBe(n + 1);
        return frames[n];
      };
      w.step();
      expect(frames[0].lit).toBe(true);
      expect(shot(true).shadowPass).toBe(true);
      expect(shot(false).shadowPass).toBe(true);
      // into the dusk handover
      view.timeOfDay = 19.1;
      let f = w.step();
      for (let i = 0; i < 60 && f.lit; i++) f = w.step();
      expect(f.lit).toBe(false);
      for (const topDown of [true, false]) {
        const c = shot(topDown);
        expect(c.lit).toBe(false);
        expect(c.shadowPass).toBe(false);
        expect(c.counts).toBe(frames[0].counts);
        expect(c.version).toBe(frames[0].version);
        expect(c.keys).toBe(frames[0].keys);
      }
      // and the frame after them is an ordinary one with the light off
      expect(w.step().shadowPass).toBe(false);
      view.dispose();
    }
  }, 120_000);
});

/**
 * tools/qa-nightfall.mjs's page without a browser: the app's globals around the view, and animation frames run by hand
 * on a manual clock. A frame is the game's loop (CityScene.loop: update, render), then the page's other frame callbacks.
 * `hideSun`: the view as it was before T084, the sun light hidden while the direct light is off; a program three links
 * for the first time holds its frame for LINK_MS (it waited for each in turn).
 */
const LINK_MS = 400;
function page(w: ReturnType<typeof world>, hideSun = false) {
  let now = 5000;
  const queue: FrameRequestCallback[] = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => queue.push(f));
  (window as unknown as { __metropolis: unknown }).__metropolis = { city: { scene: { world: w.view } } };
  const asItWas = () => {
    w.view.sun.visible = w.view.sky.lighting.lightIntensity > 0.002;
  };
  return {
    pending: () => queue.length,
    frame(ms = 1000 / 60): void {
      now += ms;
      const linked = w.frames.length ? w.frames[w.frames.length - 1].programs : 0;
      // (CityScene.loop clamps a frame's step to 0.1 s)
      const f = w.step(Math.min(0.1, ms / 1000), hideSun ? asItWas : undefined);
      now += LINK_MS * (f.programs - linked);
      for (const cb of queue.splice(0)) cb(now);
    },
  };
}

const nightfall = () => (window as unknown as { __nightfall: { state(): NightfallState; run(win: NightfallWindow): Promise<NightfallReport> } }).__nightfall;

/** run(win) with the page's frames driven until the probe asks for no more */
async function runWindow(p: ReturnType<typeof page>, win: NightfallWindow): Promise<NightfallReport> {
  const done = nightfall().run(win);
  for (let i = 0; p.pending() > 0; i++) {
    if (i > 200_000) throw new Error('the window never ended');
    p.frame();
  }
  return done;
}

describe('tools/qa-nightfall.mjs: the page-side probe and its verdicts (T084)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
  });
  afterEach(() => {
    gl.onScene = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reads its windows and hours', () => {
    expect(parseWindows('18:50-20:10,05:00-06:30')).toEqual([
      { name: 'dusk 18:50-20:10', from: 18 + 50 / 60, to: 20 + 10 / 60 },
      { name: 'dawn 05:00-06:30', from: 5, to: 6.5 },
    ]);
    expect(parseWindows(' 23:30-0:30 ')[0]).toMatchObject({ from: 23.5, to: 0.5 });
    for (const bad of ['dusk', '18:50', '18:50-20:10-21:00', '25:00-26:00', '18:61-19:00', '']) expect(() => parseWindows(bad), bad).toThrow();
    expect([hhmm(19.2081), hhmm(6.5), hhmm(0), hhmm(23.9999), hhmm(24.5)]).toEqual(['19:12', '06:30', '00:00', '00:00', '00:30']);
  });

  it('passes the view as it is: both handovers, no long frame, the program count and the light state unchanged', async () => {
    const w = world('high');
    const p = page(w);
    p.frame();
    const before = installNightfallProbe();
    expect(before).toMatchObject({ lit: true, sunVisible: true, castShadow: true, shadowMapEnabled: true, programs: 2 });
    const reports: NightfallReport[] = [];
    for (const win of parseWindows('18:50-20:10,05:00-06:30')) reports.push(await runWindow(p, { ...win, timeScale: 2, maxFrameMs: 250 }));
    const after = nightfall().state();
    const checks = nightfallChecks({ windows: reports, before, after }, { maxFrameMs: 250 });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.filter((c) => c.skipped)).toEqual([]);
    expect(checks.length).toBe(11);
    const [dusk, dawn] = reports;
    // 80 and 90 game minutes at the game's 2 a second, 60 frames a second
    expect(dusk.frames).toBeGreaterThan(2300);
    expect(dusk.frames).toBeLessThan(2500);
    expect(dawn.frames).toBeGreaterThan(2600);
    expect(dusk.seconds).toBeCloseTo(40, 0);
    expect(dusk.ms.length).toBe(dusk.frames);
    expect(dusk.tod.length).toBe(dusk.frames);
    expect(dusk.maxMs).toBeCloseTo(1000 / 60, 0);
    expect(dusk.maxStep).toBeLessThan(0.05);
    expect(dusk).toMatchObject({ timedOut: false, long: [], programs: { start: 2, end: 2, changes: [] } });
    expect(dusk.after!.tod).toBeGreaterThanOrEqual(20 + 10 / 60);
    expect(dawn.after!.tod).toBeGreaterThanOrEqual(6.5);
    // the direct light is off 19:12-19:13 and 06:05-06:17 (day 0 of the year), the sun light never hidden
    expect(dusk.light).toMatchObject({ litAtStart: true, litAtEnd: true, onWhileOff: 0, hidden: { frames: 0 } });
    expect(dusk.light.unlit.frames).toBeGreaterThan(30);
    expect(dusk.light.unlit.first).toBeGreaterThan(19.19);
    expect(dusk.light.unlit.last).toBeLessThan(19.25);
    expect(dawn.light.unlit.frames).toBeGreaterThan(300);
    expect(dawn.light.unlit.first).toBeGreaterThan(6.05);
    expect(dawn.light.unlit.last).toBeLessThan(6.32);
    expect(dusk.light.changes.map((c) => [c.what, c.to])).toEqual([['lit', false], ['lit', true]]);
    expect(describeWindow(dusk)).toMatch(/^dusk 18:50-20:10: \d+ frames in 40(\.\d)? s \(2 game min\/s\), .* programs 2 -> 2; direct light off 19:1\d-19:1\d \(\d+ frames\)$/);
    // the view's own clock settings are put back
    expect(w.view.timeScale).toBe(2);
    expect(w.view.autoTime).toBe(true);
    w.view.dispose();
  }, 120_000);

  it('fails the view as it was: the sun light hidden at the handover, new programs, the frame that waits for them', async () => {
    const w = world('high');
    const p = page(w, true);
    p.frame();
    const before = installNightfallProbe();
    const dusk = await runWindow(p, { ...parseWindows('18:50-20:10')[0], timeScale: 2 });
    const after = nightfall().state();
    // three links a second program for each probe material in the first frame without the sun light
    expect(dusk.programs).toMatchObject({ start: 2, end: 4 });
    expect(dusk.programs.changes.length).toBe(1);
    expect(dusk.programs.changes[0]).toMatchObject({ from: 2, to: 4 });
    expect(dusk.programs.changes[0].tod).toBeGreaterThan(19.19);
    expect(dusk.programs.changes[0].tod).toBeLessThan(19.23);
    expect(dusk.maxMs).toBeCloseTo(2 * LINK_MS + 1000 / 60, 0);
    expect(dusk.maxAt).toBe(dusk.programs.changes[0].tod);
    expect(dusk.long.length).toBe(1);
    expect(dusk.long[0]).toMatchObject({ lit: false, sunVisible: false, programs: [2, 4] });
    expect(dusk.light.hidden.frames).toBe(dusk.light.unlit.frames);
    expect(dusk.light.hidden.frames).toBeGreaterThan(30);
    const failed = (opts?: { enforceFrames?: boolean }) => nightfallChecks({ windows: [dusk], before, after }, opts).filter((c) => !c.ok).map((c) => c.name);
    expect(failed()).toEqual([
      expect.stringContaining('no frame over 250 ms'),
      expect.stringContaining('renderer.info.programs.length does not change'),
      expect.stringContaining("the sun light stays in three's light state"),
      expect.stringContaining('the program count is the same before the first window and after the last'),
    ]);
    // (software GL: frame lengths are reported, not judged; the rest still fails)
    expect(failed({ enforceFrames: false }).length).toBe(3);
    expect(nightfallChecks({ windows: [dusk], before, after }, { enforceFrames: false }).filter((c) => c.skipped).map((c) => c.name)).toEqual([expect.stringContaining('no frame over 250 ms')]);
    expect(describeWindow(dusk)).toMatch(/programs 2 -> 4 \(2->4 at 19:1\d in a 81\d(\.\d)? ms frame\); .*SUN LIGHT HIDDEN 19:1\d-19:1\d/);
    w.view.dispose();
  }, 120_000);

  it('a window may cross midnight; a clock that does not run times it out', async () => {
    const w = world('low');
    const p = page(w);
    p.frame();
    const before = installNightfallProbe();
    const night = await runWindow(p, { ...parseWindows('23:50-00:10')[0], timeScale: 2 });
    expect(night.timedOut).toBe(false);
    expect(night.frames).toBeGreaterThan(550);
    expect(night.frames).toBeLessThan(650);
    expect(night.after!.tod).toBeGreaterThanOrEqual(10 / 60);
    expect(night.after!.tod).toBeLessThan(0.2);
    // (no handover in it: the window proves nothing, and says so)
    const checks = nightfallChecks({ windows: [night], before, after: nightfall().state() });
    expect(checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([expect.stringContaining('the handover is inside it')]);
    // held, as the New Year show holds it
    w.view.timeScale = 0;
    const held = await runWindow(p, { name: 'held', from: 18.9, to: 19.5, timeoutS: 2 });
    expect(held.timedOut).toBe(true);
    expect(held.seconds).toBeCloseTo(2, 0);
    expect(nightfallChecks({ windows: [held], before, after: nightfall().state() })[0]).toMatchObject({ name: "held: the view's clock ran through it", ok: false });
    w.view.dispose();
  }, 120_000);
});
