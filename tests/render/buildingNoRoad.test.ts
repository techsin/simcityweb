/** NEW-02: unreachable lots tint their models without spending an instance flag or rebuilding geometry. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { CELL_SIZE } from '../../src/core/constants';
import { Overlay } from '../../src/core/types';
import { BuildingRenderer, type BudgetedWork } from '../../src/render/city/buildings/BuildingRenderer';
import { TileCuller } from '../../src/render/city/common/batch';
import { getCityMaterial, getGhostMaterial } from '../../src/render/city/common/cityMaterial';
import { TerrainRenderer } from '../../src/render/world/TerrainRenderer';
import { buildingOverlayOf, overlayDef, setBuildingOverlay } from '../../src/render/world/overlays';
import { BF, RESP_NONE, type Building, type CityState } from '../../src/sim/CityState';
import { EMG_FIRE, EMG_MEDICAL, EMG_POLICE, emgNearSlack, markOverlaysDirty, overlayReadout, registerDerivedSource } from '../../src/sim/infra/overlays';
import { EMERG_RMAX } from '../../src/sim/infra/params';
import { newState, place, setRoad } from '../infra/cityGen';

registerAllModels();

type BI = { id: number; b: Building; main: number; geom: number; lodGeom: number; flags: number };
type Internals = {
  inst: Map<number, BI>;
  noRoadData: Uint8Array;
  noRoadTex: THREE.DataTexture;
  noRoadWork: Iterator<BI> | null;
  noRoadBudgetWork: BudgetedWork;
  budgetedWorks: BudgetedWork[];
  fadeLayer: { mesh: THREE.BatchedMesh; n: number };
  refreshNoRoad(bi: BI): void;
  build(bi: BI): void;
  proxyOf(geom: number, immediate: boolean): number;
  startFade(bi: BI, from: number, to: number): void;
};
const inside = (br: BuildingRenderer) => br as unknown as Internals;
const renderers: BuildingRenderer[] = [];
const terrains: TerrainRenderer[] = [];
const sources: (() => void)[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const off of sources.splice(0)) off();
  for (const terrain of terrains.splice(0)) terrain.dispose();
  for (const br of renderers.splice(0)) br.dispose();
});

function town(size = 32) {
  const st = newState(size);
  st.respFire.fill(-EMERG_RMAX);
  st.respPolice.fill(-EMERG_RMAX);
  st.respMedical.fill(-EMERG_RMAX);
  const br = new BuildingRenderer(st, new TileCuller(size, CELL_SIZE, 16));
  br.lodBudgetMs = 1e9;
  renderers.push(br);
  return { st, br };
}

function add(st: CityState, br: BuildingRenderer, x: number, z: number, opts: Partial<Building> = {}, queued = false) {
  const b = place(st, 'lm_obelisk', x, z, opts);
  br.add(b, queued);
  return b;
}

function footprint(st: CityState, b: Building, f: (i: number) => void) {
  for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) f(st.idx(x, z));
}

function response(st: CityState, variant: number) {
  return variant === EMG_FIRE ? st.respFire : variant === EMG_POLICE ? st.respPolice : st.respMedical;
}

function settle(br: BuildingRenderer) {
  let idle = 0;
  for (let frame = 0; frame < 100; frame++) {
    br.update(0);
    if (!br.pendingBuilds && !inside(br).noRoadWork) {
      if (++idle === 2) return;
    } else idle = 0;
  }
  expect(br.pendingBuilds).toBe(0);
  expect(inside(br).noRoadWork).toBeNull();
}

function expectMask(st: CityState, br: BuildingRenderer, b: Building, byte: number) {
  footprint(st, b, (i) => expect(inside(br).noRoadData[i], `building ${b.id}, cell ${i}`).toBe(byte));
}

function compile(material: THREE.Material) {
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

function noRoadOn(br: BuildingRenderer): number {
  br.update(0);
  const shader = compile(br.batch.mesh.material as THREE.Material);
  const on = Object.entries(shader.uniforms).find(([name]) => /noRoad.*on/i.test(name));
  expect(on, 'the model tint has an explicit on/off uniform').toBeDefined();
  return on![1].value as number;
}

describe('Emergency model tint', () => {
  for (const variant of [EMG_FIRE, EMG_POLICE, EMG_MEDICAL]) it(`marks only noRoad buildings for responder ${variant}`, () => {
    const { st, br } = town();
    const unreachable = add(st, br, 4, 4);
    const far = add(st, br, 8, 4);
    const none = add(st, br, 12, 4);
    const near = add(st, br, 16, 4);
    const auto = add(st, br, 20, 4);
    for (const b of [far, near, auto]) setRoad(st, b.x, b.z - 1);
    const layer = response(st, variant);
    footprint(st, none, (i) => { layer[i] = RESP_NONE; });
    footprint(st, near, (i) => { layer[i] = emgNearSlack(variant) / 2; });
    footprint(st, auto, (i) => { layer[i] = 2; });
    setBuildingOverlay(st, Overlay.Emergency, variant, true, true);
    settle(br);
    expect(overlayReadout(st, Overlay.Emergency, unreachable.x, unreachable.z, variant)?.reason).toBe('noRoad');
    expect(overlayReadout(st, Overlay.Emergency, far.x, far.z, variant)?.reason).not.toBe('noRoad');
    expect(overlayReadout(st, Overlay.Emergency, none.x, none.z, variant)?.text).toMatch(/^No /);
    expect(overlayReadout(st, Overlay.Emergency, near.x, near.z, variant)?.tone).toBe('warn');
    expect(overlayReadout(st, Overlay.Emergency, auto.x, auto.z, variant)?.tone).toBe('good');
    expectMask(st, br, unreachable, 255);
    for (const b of [far, none, near, auto]) expectMask(st, br, b, 0);
    expect(inside(br).noRoadData[st.idx(3, 4)]).toBe(0);
    expect(noRoadOn(br)).toBe(1);
  });

  it('uses the best response over a whole footprint, then marks the whole lot when it becomes unreachable', () => {
    const { st, br } = town();
    const b = place(st, 't_r3', 8, 8);
    br.add(b, false);
    st.respFire[st.idx(b.x, b.z)] = 2.5;
    setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, true, true);
    settle(br);
    expectMask(st, br, b, 0);
    st.respFire[st.idx(b.x, b.z)] = -EMERG_RMAX;
    markOverlaysDirty(st, 'emergency');
    setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, true, true);
    settle(br);
    expectMask(st, br, b, 255);
    const tex = inside(br).noRoadTex;
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.generateMipmaps).toBe(false);
    for (const variant of [EMG_FIRE, EMG_POLICE, EMG_MEDICAL]) expect(overlayDef(Overlay.Emergency, variant).crisp).toBe(true);
  });

  it('keeps the roadless Obelisk lookup at 300 m and 700 m without changing instance flags or colours', () => {
    const { st, br } = town();
    const b = add(st, br, 8, 8, { flags: BF.Abandoned });
    br.setSelected(b.id);
    const bi = inside(br).inst.get(b.id)!;
    const flags = bi.flags;
    const before = br.batch.mesh.getColorAt(bi.main, new THREE.Vector4()).toArray();
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 20000);
    const centre = new THREE.Vector3((b.x + b.w / 2) * CELL_SIZE, b.baseY + 40, (b.z + b.d / 2) * CELL_SIZE);
    setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, true, true);
    for (const distance of [300, 700]) {
      cam.position.copy(centre).add(new THREE.Vector3(0, 0.5, 1).normalize().multiplyScalar(distance));
      cam.lookAt(centre);
      cam.updateMatrixWorld();
      br.updateLod(cam, 720);
      settle(br);
      expectMask(st, br, b, 255);
      expect(bi.flags).toBe(flags);
      expect(br.batch.mesh.getColorAt(bi.main, new THREE.Vector4()).toArray()).toEqual(before);
    }
  });

  it('does no model work while off and disables immediately while data is missing or another view is selected', () => {
    const { st, br } = town();
    add(st, br, 8, 8);
    const refresh = vi.spyOn(inside(br), 'refreshNoRoad');
    br.update(0);
    expect(refresh).not.toHaveBeenCalled();
    expect(noRoadOn(br)).toBe(0);
    setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, false, true);
    br.update(0);
    expect(refresh).not.toHaveBeenCalled();
    expect(noRoadOn(br)).toBe(0);
    setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, true, true);
    settle(br);
    expect(noRoadOn(br)).toBe(1);
    setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, false);
    expect(noRoadOn(br)).toBe(0);
    setBuildingOverlay(st, Overlay.Fire, -1, true, true);
    expect(noRoadOn(br)).toBe(0);
    setBuildingOverlay(st, Overlay.None);
    expect(noRoadOn(br)).toBe(0);
  });

  it('follows terrain selection, late paused delivery, invalidation and replacement state', () => {
    const { st, br } = town();
    const b = add(st, br, 8, 8);
    let ready = false;
    sources.push(registerDerivedSource(st, () => null, () => ready));
    const terrain = new TerrainRenderer(st, 0, false);
    terrains.push(terrain);
    terrain.setOverlay(Overlay.Emergency, EMG_FIRE);
    terrain.update();
    settle(br);
    expect(buildingOverlayOf(st)).toMatchObject({ overlay: Overlay.Emergency, variant: EMG_FIRE, ready: false });
    expect(noRoadOn(br)).toBe(0);
    ready = true;
    terrain.update();
    settle(br);
    expectMask(st, br, b, 255);
    expect(noRoadOn(br)).toBe(1);
    const revision = buildingOverlayOf(st)!.revision;
    setRoad(st, b.x, b.z - 1);
    markOverlaysDirty(st, 'emergency');
    terrain.onLayerUpdated('emergency');
    terrain.update();
    settle(br);
    expect(buildingOverlayOf(st)!.revision).toBeGreaterThan(revision);
    expectMask(st, br, b, 0);
    const fresh = newState(st.size);
    sources.push(registerDerivedSource(fresh, () => null, () => false));
    terrain.reset(fresh);
    br.setState(fresh);
    br.rebuildAll();
    terrain.update();
    settle(br);
    expect(buildingOverlayOf(fresh)).toMatchObject({ overlay: Overlay.Emergency, variant: EMG_FIRE, ready: false });
    expect(noRoadOn(br)).toBe(0);
    expect(inside(br).noRoadData.every((v) => v === 0)).toBe(true);
  });

  it('clears removed footprints and handles id reuse, queued adds and queued visual changes', () => {
    const { st, br } = town();
    const old = add(st, br, 4, 4);
    setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, true, true);
    settle(br);
    expectMask(st, br, old, 255);
    footprint(st, old, (i) => { st.building[i] = -1; });
    st.buildings.delete(old.id);
    br.remove(old.id);
    expectMask(st, br, old, 0);
    st.nextBuildingId = old.id;
    const replacement = add(st, br, 12, 12, {}, true);
    expect(replacement.id).toBe(old.id);
    expect(br.getVisual(replacement.id)).toBeNull();
    settle(br);
    expect(br.getVisual(replacement.id)).not.toBeNull();
    expectMask(st, br, old, 0);
    expectMask(st, br, replacement, 255);
    replacement.flags |= BF.Abandoned;
    br.changed(replacement);
    expect(br.pendingBuilds).toBe(1);
    settle(br);
    expectMask(st, br, replacement, 255);
    setRoad(st, replacement.x, replacement.z - 1);
    setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, true, true);
    settle(br);
    expectMask(st, br, replacement, 0);
  });

  it('patches the full and proxy fade shaders with the same mask, leaving shared prop and ghost material alone', () => {
    const { st, br } = town();
    const b = place(st, 't_r3', 8, 8);
    br.add(b, false);
    setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, true, true);
    settle(br);
    const bi = inside(br).inst.get(b.id)!;
    const proxy = inside(br).proxyOf(bi.geom, true);
    expect(proxy).toBeGreaterThanOrEqual(0);
    expect(proxy).not.toBe(bi.geom);
    inside(br).startFade(bi, bi.geom, proxy);
    const layer = inside(br).fadeLayer;
    expect(layer.n).toBe(2);
    const full = compile(br.batch.mesh.material as THREE.Material);
    const fade = compile(layer.mesh.material as THREE.Material);
    const sampler = Object.entries(full.uniforms).find(([, uniform]) => uniform.value === inside(br).noRoadTex);
    expect(sampler, 'building shader samples its mask texture').toBeDefined();
    expect(fade.uniforms[sampler![0]]).toBe(sampler![1]);
    const varying = full.vertexShader.match(/flat\s+varying\s+float\s+(\w*[Nn]oRoad\w*)\s*;/)?.[1];
    expect(varying, 'one categorical lookup per instance').toBeDefined();
    for (const shader of [full, fade]) {
      expect(shader.vertexShader).toContain('batchingMatrix[3]');
      expect(shader.vertexShader).toContain(sampler![0]);
      expect(shader.fragmentShader).toContain(varying!);
      expect(shader.fragmentShader.lastIndexOf(varying!)).toBeGreaterThan(shader.fragmentShader.indexOf('float _lum'));
    }
    const matrices = (layer.mesh as unknown as { _matricesTexture: THREE.DataTexture })._matricesTexture.image.data as Float32Array;
    const positions = [0, 1].map((slot) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(matrices, slot * 16)));
    expect(positions[0].toArray()).toEqual(positions[1].toArray());
    for (const p of positions) expect(inside(br).noRoadData[st.idx(Math.floor(p.x / CELL_SIZE), Math.floor(p.z / CELL_SIZE))]).toBe(255);
    for (const material of [getCityMaterial(), getGhostMaterial()]) {
      const shared = compile(material);
      expect(shared.uniforms[sampler![0]]).toBeUndefined();
      expect(shared.fragmentShader).not.toContain(varying!);
    }
    expect(br.batch.mesh.material).not.toBe(getCityMaterial());
  });

  it('takes the latest city material scalars at each main and fade draw, after the frame update', () => {
    const { br } = town();
    br.update(0);
    const city = getCityMaterial();
    const main = br.batch.mesh.material as THREE.MeshStandardMaterial;
    const layer = inside(br).fadeLayer.mesh, fade = layer.material as THREE.MeshStandardMaterial;
    const prior = { envMapIntensity: city.envMapIntensity, roughness: city.roughness, metalness: city.metalness };
    const latest = { envMapIntensity: prior.envMapIntensity + 0.37, roughness: 0.27, metalness: 0.41 };
    // Isolate the main draw's GPU upload/culling work while retaining its actual outer onBeforeRender hook.
    const mainPass = vi.spyOn(br.batch as unknown as { beforePass(...args: unknown[]): void }, 'beforePass').mockImplementation(() => {});
    const renderer = {
      getRenderTarget: () => null,
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(1280, 720),
    } as unknown as THREE.WebGLRenderer;
    try {
      Object.assign(city, latest);
      br.batch.mesh.onBeforeRender(renderer, null!, null!, br.batch.mesh.geometry, main, null!);
      expect(mainPass).toHaveBeenCalledOnce();
      for (const [key, value] of Object.entries(latest)) expect(main[key as keyof typeof latest]).toBe(value);
      layer.onBeforeRender(renderer, null!, null!, layer.geometry, fade, null!);
      for (const [key, value] of Object.entries(latest)) expect(fade[key as keyof typeof latest]).toBe(value);
    } finally {
      for (const material of [city, main, fade]) Object.assign(material, prior);
    }
  });
});

describe('Emergency model mask budget', () => {
  it('registers model refreshes with the shared work hook and charges them to the queued-build deadline', () => {
    const { st, br } = town();
    const old = Array.from({ length: 8 }, (_, i) => add(st, br, 2 + (i % 4) * 5, 2 + Math.floor(i / 4) * 5));
    for (let i = 0; i < 5; i++) add(st, br, 2 + i * 5, 20, {}, true);
    const internal = inside(br), work = internal.noRoadBudgetWork;
    expect(internal.budgetedWorks).toContain(work);
    const pending = vi.spyOn(work, 'pending'), step = work.step.bind(work), build = internal.build.bind(br);
    const trace: string[] = [];
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const stepped = vi.spyOn(work, 'step').mockImplementation(() => {
      const progressed = step();
      if (progressed) { trace.push('mask'); now += 0.75; }
      return progressed;
    });
    vi.spyOn(internal, 'build').mockImplementation((bi) => {
      build(bi);
      trace.push('build');
      now += 0.75;
    });
    setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, true, true);
    for (let frame = 0; frame < 40; frame++) {
      const start = now;
      br.update(0);
      expect(now - start).toBeLessThanOrEqual(2 + 0.75);
      if (frame === 0) {
        expect(trace).toEqual(['build', 'mask', 'build']);
        expect(now).toBe(2.25);
        expect(br.pendingBuilds).toBe(3);
      }
      if (!br.pendingBuilds && !internal.noRoadWork) break;
    }
    expect(pending).toHaveBeenCalled();
    expect(stepped).toHaveBeenCalled();
    expect(br.pendingBuilds).toBe(0);
    expect(internal.noRoadWork).toBeNull();
    for (const b of old) expectMask(st, br, b, 255);
  });

  for (const maskCost of [0.65, 3.25]) it(`refreshes existing lots despite a sustained queue of expensive geometry (${maskCost} ms mask entries)`, () => {
    const { st, br } = town(64);
    const old = Array.from({ length: 15 }, (_, i) => add(st, br, 2 + (i % 5) * 5, 2 + Math.floor(i / 5) * 5));
    const oldIds = new Set(old.map((b) => b.id));
    const refreshed = new Set<number>(), built = new Set<number>();
    const internal = inside(br), refresh = internal.refreshNoRoad.bind(br), build = internal.build.bind(br);
    let now = 0, building = false;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(internal, 'refreshNoRoad').mockImplementation((bi) => {
      refresh(bi);
      if (!building) {
        if (oldIds.has(bi.id)) refreshed.add(bi.id);
        now += maskCost;
      }
    });
    vi.spyOn(internal, 'build').mockImplementation((bi) => {
      building = true;
      try { build(bi); } finally { building = false; }
      built.add(bi.id);
      // One geometry entry includes its own mask refresh and already exceeds the whole frame budget.
      now += 3.25;
    });
    setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, true, true);
    for (let frame = 0; frame < 40 && refreshed.size < old.length; frame++) {
      add(st, br, 32 + (frame % 6) * 4, 32 + Math.floor(frame / 6) * 4, {}, true);
      const start = now;
      br.update(0);
      expect(now - start).toBeGreaterThan(0);
      expect(now - start).toBeLessThanOrEqual(2 + Math.max(3.25, maskCost) + 1e-9);
    }
    expect(refreshed).toEqual(oldIds);
    expect(built.size).toBeGreaterThan(0);
    for (const b of old) expectMask(st, br, b, 255);
  });

  for (const cost of [0.65, 3.25]) it(`keeps refreshing through repeated revisions within the existing 2 ms budget (${cost} ms entries)`, () => {
    const { st, br } = town();
    const buildings = Array.from({ length: 15 }, (_, i) => add(st, br, 2 + (i % 5) * 5, 2 + Math.floor(i / 5) * 5));
    const internal = inside(br), original = internal.refreshNoRoad.bind(br);
    const refreshed = new Set<number>();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(internal, 'refreshNoRoad').mockImplementation((bi) => {
      original(bi);
      refreshed.add(bi.id);
      now += cost;
    });
    const geometry = vi.spyOn(internal, 'build');
    for (let frame = 0; frame < 30 && refreshed.size < buildings.length; frame++) {
      setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, true, true);
      const start = now;
      br.update(0);
      expect(now - start).toBeGreaterThanOrEqual(cost);
      expect(now - start).toBeLessThanOrEqual(2 + cost + 1e-9);
    }
    expect(refreshed).toEqual(new Set(buildings.map((b) => b.id)));
    expect(geometry).not.toHaveBeenCalled();
    settle(br);
    const calls = refreshed.size, atRest = now;
    br.update(0);
    expect(now).toBe(atRest);
    expect(refreshed.size).toBe(calls);
  });

  it('shares one deadline with queued geometry instead of adding a second mask budget', () => {
    const { st, br } = town();
    for (let i = 0; i < 20; i++) add(st, br, 2 + (i % 5) * 5, 2 + Math.floor(i / 5) * 5);
    const internal = inside(br), refresh = internal.refreshNoRoad.bind(br), build = internal.build.bind(br);
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(internal, 'refreshNoRoad').mockImplementation((bi) => { refresh(bi); now += 0.65; });
    vi.spyOn(internal, 'build').mockImplementation((bi) => { build(bi); now += 0.65; });
    add(st, br, 28, 28, {}, true);
    setBuildingOverlay(st, Overlay.Emergency, EMG_FIRE, true, true);
    for (let frame = 0; frame < 40; frame++) {
      const start = now;
      br.update(0);
      // A geometry entry includes its own mask refresh (1.3 ms); a mask-only entry costs 0.65 ms.
      expect(now - start).toBeLessThanOrEqual(2 + 1.3 + 1e-9);
      if (!br.pendingBuilds && !internal.noRoadWork) break;
    }
    expect(br.pendingBuilds).toBe(0);
    expect(internal.noRoadWork).toBeNull();
  });
});
