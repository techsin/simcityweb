import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CellRect } from '../../src/core/events';
import { RNG } from '../../src/core/rng';
import { Network, Zone } from '../../src/core/types';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation } from '../../src/sim/Simulation';
import { CityActions, lPath, type ActionResult } from '../../src/sim/actions';
import { FallbackActions } from '../../src/game/fallback/FallbackActions';
import { DisastersSystem, triggerDisaster } from '../../src/sim/infra/disasters';
import { TerrainRenderer } from '../../src/render/world/TerrainRenderer';
import { allTextures, cellTextures, pixels, terrainPair, textureDriver, tornadoPath, watchCanvas } from './terrainRectsHarness';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const f of cleanup.splice(0)) f(); });

function city(size = 64) {
  const st = new CityState(defaultCityConfig({ size, seed: 21, terrain: 'flat', difficulty: 'sandbox', disasters: false }));
  st.heights.fill(5);
  st.trees.fill(2);
  return st;
}

function fixture(upload = true) {
  const st = city(), terrain = new TerrainRenderer(st, 0, false);
  cleanup.push(() => terrain.dispose());
  const driver = textureDriver();
  if (upload) for (const tex of allTextures(terrain)) driver.upload(tex);
  return { st, terrain, driver };
}

function ranges(N: number, r: CellRect) {
  return Array.from({ length: r.z1 - r.z0 }, (_, k) => ({ start: ((r.z0 + k) * N + r.x0) * 4, count: (r.x1 - r.x0) * 4 }));
}

function matchesStorage(driver: ReturnType<typeof textureDriver>, t: TerrainRenderer) {
  for (const tex of allTextures(t)) {
    driver.upload(tex);
    expect(driver.read(tex)).toEqual(pixels(tex));
  }
}

describe('TerrainRenderer dirty rectangles', () => {
  it('pads the event union and uploads its exact row spans with texel x 4 ranges for RGBA and Red textures', () => {
    const { st, terrain, driver } = fixture();
    const tex = cellTextures(terrain), exits = terrain.uniforms.uExitTex.value;
    const exitVersion = exits.version;
    const a = { x0: 12, z0: 10, x1: 15, z1: 12 }, b = { x0: 18, z0: 13, x1: 20, z1: 14 };
    st.zone[10 * st.size + 12] = Zone.ResHigh;
    st.network[13 * st.size + 19] = Network.Road;
    // The padded boundary is refilled; a cell outside the union is not read.
    st.zone[9 * st.size + 11] = Zone.IndMed;
    st.zone[50 * st.size + 50] = Zone.ComHigh;
    terrain.markCells(a); terrain.markCells(b); terrain.markCells(a);
    terrain.update();
    const r = { x0: 11, z0: 9, x1: 21, z1: 15 };
    expect(tex.map((t) => t.format)).toEqual([THREE.RGBAIntegerFormat, THREE.RedFormat, THREE.RedFormat]);
    for (const t of tex) {
      expect(t.updateRanges).toEqual(ranges(st.size, r));
      expect(driver.upload(t)).toEqual(Array.from({ length: 6 }, (_, k) => ({ x: 11, y: 9 + k, width: 10, height: 1 })));
      expect(driver.read(t)).toEqual(pixels(t));
      expect(t.updateRanges).toEqual([]);
    }
    expect(pixels(tex[0])[(9 * st.size + 11) * 4]).toBe(Zone.IndMed);
    expect(pixels(tex[0])[(50 * st.size + 50) * 4]).toBe(Zone.None);
    expect(exits.version).toBe(exitVersion);
    expect(a).toEqual({ x0: 12, z0: 10, x1: 15, z1: 12 });
    const versions = tex.map((t) => t.version);
    terrain.update();
    expect(tex.map((t) => t.version)).toEqual(versions);
  });

  it('clamps terrain and cell rectangles to the map and ignores empty or wholly outside rectangles', () => {
    const { st, terrain, driver } = fixture();
    terrain.markCells({ x0: -3, z0: -2, x1: 1, z1: 1 });
    terrain.update();
    for (const t of cellTextures(terrain)) expect(t.updateRanges).toEqual(ranges(st.size, { x0: 0, z0: 0, x1: 2, z1: 2 }));
    matchesStorage(driver, terrain);
    terrain.onTerrainChanged({ x0: 63, z0: 63, x1: 64, z1: 64 });
    terrain.update();
    for (const t of cellTextures(terrain)) expect(t.updateRanges).toEqual(ranges(st.size, { x0: 62, z0: 62, x1: 64, z1: 64 }));
    matchesStorage(driver, terrain);
    const versions = allTextures(terrain).map((t) => t.version);
    terrain.markCells({ x0: 5, z0: 5, x1: 5, z1: 5 });
    terrain.markCells({ x0: 70, z0: 70, x1: 75, z1: 75 });
    terrain.update();
    expect(allTextures(terrain).map((t) => t.version)).toEqual(versions);
  });

  it('retains unconsumed rectangles independently for textures sampled in different frames', () => {
    const { st, terrain, driver } = fixture();
    const [zone, light, trees] = cellTextures(terrain);
    st.network[10 * st.size + 10] = Network.Road;
    terrain.markCells({ x0: 10, z0: 10, x1: 11, z1: 11 });
    terrain.update();
    driver.upload(zone);
    st.building[14 * st.size + 15] = 123;
    terrain.markCells({ x0: 15, z0: 14, x1: 16, z1: 15 });
    terrain.update();
    expect(zone.updateRanges).toEqual(ranges(st.size, { x0: 14, z0: 13, x1: 17, z1: 16 }));
    for (const tex of [light, trees]) expect(tex.updateRanges).toEqual(ranges(st.size, { x0: 9, z0: 9, x1: 17, z1: 16 }));
    matchesStorage(driver, terrain);
  });

  it('uses one full upload above half the rows and never narrows an unconsumed full upload', () => {
    const { st, terrain, driver } = fixture();
    terrain.markCells({ x0: 10, z0: 10, x1: 11, z1: 40 });
    terrain.update();
    for (const t of cellTextures(terrain)) expect(t.updateRanges).toHaveLength(32);
    terrain.markCells({ x0: 10, z0: 42, x1: 11, z1: 43 });
    terrain.update();
    terrain.markCells({ x0: 12, z0: 12, x1: 13, z1: 13 });
    terrain.update();
    for (const t of cellTextures(terrain)) {
      expect(t.updateRanges).toEqual([]);
      expect(driver.upload(t)).toEqual([{ x: 0, y: 0, width: st.size, height: st.size }]);
    }
    terrain.markCells({ x0: 12, z0: 12, x1: 13, z1: 13 });
    terrain.update();
    for (const t of cellTextures(terrain)) expect(t.updateRanges).toHaveLength(3);
    matchesStorage(driver, terrain);
  });

  it('refreshes exits only when the padded union touches either outer ring, on all four edges', () => {
    const { st, terrain, driver } = fixture();
    const N = st.size, exit = terrain.uniforms.uExitTex.value as THREE.DataTexture;
    const edges = [
      [[0, 10], [1, 10]], [[N - 1, 10], [N - 2, 10]],
      [[10, 0], [10, 1]], [[10, N - 1], [10, N - 2]],
    ];
    for (let row = 0; row < edges.length; row++) {
      const [[x, z], [nx, nz]] = edges[row];
      st.network[z * N + x] = st.network[nz * N + nx] = Network.Rail;
      terrain.markCells({ x0: nx, z0: nz, x1: nx + 1, z1: nz + 1 });
      terrain.update();
      expect(pixels(exit)[row * N + 10]).toBe(Network.Rail);
      expect(exit.updateRanges).toEqual([]);
      expect(driver.upload(exit)).toEqual([{ x: 0, y: 0, width: N, height: 4 }]);
      st.netFlags[z * N + x] = 2; // tunnels do not continue across the landscape
      terrain.markCells({ x0: x, z0: z, x1: x + 1, z1: z + 1 });
      terrain.update();
      expect(pixels(exit)[row * N + 10]).toBe(0);
    }
    let version = exit.version;
    terrain.markCells({ x0: 3, z0: 3, x1: N - 3, z1: N - 3 });
    terrain.update();
    expect(exit.version).toBe(version);
    for (const [x, z] of [[2, 10], [N - 3, 10], [10, 2], [10, N - 3]]) {
      terrain.markCells({ x0: x, z0: z, x1: x + 1, z1: z + 1 });
      terrain.update();
      expect(exit.version).toBe(++version);
    }
    matchesStorage(driver, terrain);
  });

  it('recomputes only the exit rows whose outer rings the union touches, and the texture whole', () => {
    const { st, terrain, driver } = fixture();
    const N = st.size, exit = terrain.uniforms.uExitTex.value as THREE.DataTexture, E = pixels(exit);
    // a sentinel in each row: only a row the union touches may be rewritten (each is 0 when recomputed here)
    const sentinel = () => { for (let row = 0; row < 4; row++) E[row * N + 30] = 99; };
    const touched = (r: CellRect) => {
      sentinel();
      terrain.markCells(r);
      terrain.update();
      return [0, 1, 2, 3].filter((row) => E[row * N + 30] !== 99);
    };
    expect(touched({ x0: 1, z0: 20, x1: 2, z1: 21 })).toEqual([0]);
    expect(touched({ x0: N - 3, z0: 20, x1: N - 2, z1: 21 })).toEqual([1]);
    expect(touched({ x0: 20, z0: 0, x1: 21, z1: 1 })).toEqual([2]);
    expect(touched({ x0: 20, z0: N - 1, x1: 21, z1: N })).toEqual([3]);
    expect(touched({ x0: 0, z0: N - 1, x1: 1, z1: N })).toEqual([0, 3]);
    expect(touched({ x0: 0, z0: 0, x1: N, z1: N })).toEqual([0, 1, 2, 3]);
    expect(exit.updateRanges).toEqual([]);
    expect(driver.upload(exit)).toEqual([{ x: 0, y: 0, width: N, height: 4 }]);
    expect(driver.read(exit)).toEqual(E);
  });

  it('matches the original whole-edge exit scan for every network pairing, tunnel and edge', () => {
    const { st, terrain } = fixture();
    const N = st.size, E = pixels(terrain.uniforms.uExitTex.value as THREE.DataTexture);
    // the pre-R1 updateExits, verbatim apart from its inputs
    const reference = () => {
      const net = st.network, out = new Uint8Array(N * 4);
      const isRoad = (t: number) => t >= Network.Street && t <= Network.Highway;
      const connects = (a: number, b: number) => {
        if (a === Network.Rail || b === Network.Rail) return a === b;
        if (!isRoad(a) || !isRoad(b)) return false;
        if (a === Network.Highway || b === Network.Highway) return (a === Network.Highway ? b : a) !== Network.Street;
        return true;
      };
      for (let k = 1; k < N - 1; k++) {
        const cells: [number, number, number][] = [
          [0, k * N, k * N + 1], [1, k * N + N - 1, k * N + N - 2], [2, k, N + k], [3, (N - 1) * N + k, (N - 2) * N + k],
        ];
        for (const [row, i, j] of cells) {
          const t = net[i];
          if (!t || st.netFlags[i] & 2 || !connects(t, net[j])) continue;
          out[row * N + k] = t;
        }
      }
      return out;
    };
    const rng = new RNG(0x5e7);
    for (let round = 0; round < 400; round++) {
      // a short stretch of one edge's two outer rings (corners included), so most frames refresh one or two rows:
      // random network types (every pairing, including none) and tunnel flags
      const side = rng.int(0, 3), from = rng.int(0, N - 6);
      for (let n = rng.int(1, 6); n > 0; n--) {
        const along = from + rng.int(0, 5), depth = rng.int(0, 1);
        const x = side === 0 ? depth : side === 1 ? N - 1 - depth : along;
        const z = side === 2 ? depth : side === 3 ? N - 1 - depth : along;
        const i = z * N + x;
        st.network[i] = rng.int(0, Network.Rail);
        st.netFlags[i] = rng.chance(0.15) ? 2 : 0;
        terrain.markCells({ x0: x, z0: z, x1: x + 1, z1: z + 1 });
      }
      terrain.update();
      expect(E, `round ${round}`).toEqual(reference());
    }
  });

  it('keeps first uploads and full rebuild, reset, quality and climate refills complete', () => {
    const { st, terrain, driver } = fixture(false);
    const small = { x0: 10, z0: 10, x1: 11, z1: 11 };
    terrain.markCells(small); terrain.update();
    for (const t of cellTextures(terrain)) {
      expect(t.updateRanges).toEqual([]);
      expect(driver.upload(t)).toEqual([{ x: 0, y: 0, width: st.size, height: st.size }]);
      expect(driver.read(t)).toEqual(pixels(t));
    }
    const full = terrain as unknown as { rebuildAll(): void; applyClimate(): void };
    for (const rebuild of [() => full.rebuildAll(), () => terrain.reset(st), () => terrain.setQuality(2, true), () => {
      st.config.climate = 'alpine'; full.applyClimate();
    }]) {
      terrain.markCells(small); terrain.update();
      terrain.markCells({ x0: 40, z0: 40, x1: 41, z1: 41 });
      const i = 50 * st.size + 50;
      st.zone[i] = st.zone[i] ? Zone.None : Zone.ResLow;
      rebuild();
      const versions = cellTextures(terrain).map((t) => t.version);
      terrain.update();
      expect(cellTextures(terrain).map((t) => t.version)).toEqual(versions);
      terrain.markCells(small); terrain.update();
      for (const t of cellTextures(terrain)) {
        expect(t.updateRanges).toEqual([]);
        expect(driver.upload(t)).toEqual([{ x: 0, y: 0, width: st.size, height: st.size }]);
        expect(driver.read(t)).toEqual(pixels(t));
      }
      expect(pixels(cellTextures(terrain)[0])[i * 4]).toBe(st.zone[i]);
    }
  });

  it('fully initializes recreated texture storage after context restoration or disposal', () => {
    const { st, terrain, driver } = fixture(false);
    const canvas = new EventTarget();
    watchCanvas(terrain, canvas);
    matchesStorage(driver, terrain);
    const small = { x0: 10, z0: 10, x1: 11, z1: 11 };
    terrain.markCells(small); terrain.update();
    expect(cellTextures(terrain)[0].updateRanges).toHaveLength(3);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    st.zone[10 * st.size + 10] = Zone.ComMed;
    terrain.markCells(small); terrain.update();
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    const restored = textureDriver();
    for (const t of allTextures(terrain)) {
      expect(t.updateRanges).toEqual([]);
      expect(restored.upload(t)).toEqual([{ x: 0, y: 0, width: t.image.width, height: t.image.height }]);
      expect(restored.read(t)).toEqual(pixels(t));
    }
    terrain.markCells(small); terrain.update();
    for (const t of cellTextures(terrain)) {
      expect(t.updateRanges).toHaveLength(3);
      t.dispose();
      expect(t.updateRanges).toEqual([]);
    }
    terrain.markCells(small); terrain.update();
    matchesStorage(restored, terrain);
    // each event alone forces whole uploads into the new storage (a restore must not depend on seeing the loss first)
    terrain.markCells(small); terrain.update();
    for (const t of cellTextures(terrain)) expect(t.updateRanges).toHaveLength(3);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    const again = textureDriver();
    for (const t of allTextures(terrain)) {
      expect(t.updateRanges).toEqual([]);
      expect(again.upload(t)).toEqual([{ x: 0, y: 0, width: t.image.width, height: t.image.height }]);
      expect(again.read(t)).toEqual(pixels(t));
    }
    terrain.dispose();
    const versions = allTextures(terrain).map((t) => t.version);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(allTextures(terrain).map((t) => t.version)).toEqual(versions);
  });
});

describe('TerrainRenderer event exactness', () => {
  it('matches a full recompute after every tool action and randomized batches, including water and edge edits', { timeout: 120000 }, () => {
    const st = city(128), sim = new Simulation(st), A = new CityActions(sim);
    const pair = terrainPair(sim);
    cleanup.push(() => pair.dispose());
    const apply = (name: string, action: () => ActionResult) => {
      expect(action().ok, name).toBe(true);
      pair.check(name);
    };
    for (let zone = Zone.ResLow; zone <= Zone.Landfill; zone++) {
      const x = zone * 5;
      apply(`zone ${zone}`, () => A.zone({ x0: x, z0: 5, x1: x + 3, z1: 8 }, zone));
    }
    for (let net = Network.Street; net <= Network.Rail; net++) {
      const z = 15 + net * 4;
      apply(`network ${net}`, () => A.buildNetwork(lPath({ x: 0, z }, { x: 12, z }), net));
    }
    const trees = { x0: 70, z0: 70, x1: 75, z1: 75 };
    apply('trees', () => A.plantTrees(trees));
    apply('power lines', () => A.buildPowerLine(lPath({ x: 0, z: 50 }, { x: 12, z: 50 })));
    apply('subway', () => A.buildSubway(lPath({ x: 0, z: 54 }, { x: 12, z: 54 })));
    apply('plop', () => A.plop('civ_fire_station', 80, 80, 0));
    apply('bulldoze part of a building', () => A.bulldoze({ x0: 80, z0: 80, x1: 81, z1: 81 }));
    apply('bulldoze trees', () => A.bulldoze(trees));
    apply('dezone', () => A.dezone({ x0: 5, z0: 5, x1: 8, z1: 8 }));
    apply('water', () => A.terraform('lower', 110, 10, 5, 40));
    expect(st.water.some((v) => v === 1)).toBe(true);
    apply('raise', () => A.terraform('raise', 110, 10, 5, 45));
    apply('level', () => A.terraform('level', 110, 10, 5, 1));
    apply('smooth', () => A.terraform('smooth', 110, 10, 5, 1));
    apply('edge terrain', () => A.terraform('lower', 127, 127, 3, 20));

    const rng = new RNG(0x721);
    for (let frame = 0; frame < 240; frame++) {
      for (let k = 0, n = rng.int(1, 4); k < n; k++) {
        const x = rng.int(0, 120), z = rng.int(0, 120);
        const r = { x0: x, z0: z, x1: x + rng.int(1, 7), z1: z + rng.int(1, 7) };
        const path = lPath({ x, z }, { x: r.x1 - 1, z: r.z1 - 1 }, rng.chance(0.5));
        const ops = [
          () => A.zone(r, rng.int(Zone.ResLow, Zone.Landfill)), () => A.dezone(r),
          ...[Network.Street, Network.Road, Network.Avenue, Network.OneWay, Network.Highway, Network.Rail].map((net) => () => A.buildNetwork(path, net)),
          () => A.buildPowerLine(path), () => A.buildSubway(path), () => A.plantTrees(r), () => A.bulldoze(r),
          () => A.plop('civ_fire_station', x, z, rng.int(0, 3) as 0 | 1 | 2 | 3),
          ...(['raise', 'lower', 'level', 'smooth'] as const).map((kind) => () => A.terraform(kind, x, z, rng.int(2, 5), 12)),
        ];
        ops[rng.int(0, ops.length - 1)]();
      }
      pair.check(`random frame ${frame}`);
    }
  });

  it('matches fallback action events, including the extra water cell ring around terrain edits', () => {
    const st = city(), sim = new Simulation(st), A = new FallbackActions(sim), pair = terrainPair(sim);
    cleanup.push(() => pair.dispose());
    const rect = { x0: 20, z0: 20, x1: 24, z1: 24 };
    const actions = [
      () => A.zone(rect, Zone.ResHigh), () => A.dezone(rect), () => A.plantTrees(rect),
      () => A.buildNetwork(lPath({ x: 0, z: 20 }, { x: 12, z: 20 }), Network.Road),
      () => A.buildPowerLine(lPath({ x: 0, z: 30 }, { x: 12, z: 30 })),
      () => A.plop('civ_fire_station', 40, 40, 0),
      () => A.bulldoze({ x0: 40, z0: 40, x1: 41, z1: 41 }),
      () => A.terraform('lower', 20, 20, 4, 20),
    ];
    for (let k = 0; k < actions.length; k++) {
      expect(actions[k]().ok).toBe(true);
      pair.check(`fallback action ${k}`);
    }
  });

  it('matches meteor terrain, water, network, tree and building removals and earthquake damage', () => {
    const st = city(), sim = new Simulation(st, [new DisastersSystem()]), A = new CityActions(sim);
    expect(A.buildNetwork(lPath({ x: 0, z: 32 }, { x: 63, z: 32 }), Network.Road).ok).toBe(true);
    expect(A.buildPowerLine(lPath({ x: 0, z: 33 }, { x: 63, z: 33 })).ok).toBe(true);
    expect(A.plop('civ_fire_station', 30, 34, 0).ok).toBe(true);
    const pair = terrainPair(sim);
    cleanup.push(() => pair.dispose());
    expect(triggerDisaster(sim, 'meteor', 32, 32)).toBe(true);
    pair.check('meteor');
    expect(triggerDisaster(sim, 'earthquake', 32, 32)).toBe(true);
    pair.check('earthquake');
  });

  it('replaces all rasters on a reset with an old rectangle still pending', () => {
    const sim = new Simulation(city()), pair = terrainPair(sim);
    cleanup.push(() => pair.dispose());
    pair.terrain.markCells({ x0: 10, z0: 10, x1: 11, z1: 11 });
    pair.terrain.update();
    pair.terrain.markCells({ x0: 20, z0: 20, x1: 21, z1: 21 });
    const replacement = city();
    replacement.zone.fill(Zone.ResHigh);
    replacement.network.fill(Network.Rail);
    replacement.building[50 * replacement.size + 50] = 12;
    replacement.trees.fill(4);
    replacement.water.fill(1);
    replacement.powerLines.fill(1);
    replacement.netFlags[10 * replacement.size] = 2;
    sim.replaceState(replacement);
    for (const tex of allTextures(pair.terrain)) expect(tex.updateRanges).toEqual([]);
    pair.check('replacement state');
  });

  // R1's one known lag (NOTE-017): a moving tornado lowers trees without an event (disasters.ts:316), and its end event
  // (disasters.ts:328) covers the whole path. The 3D trees update at the same moment. The sim stays untouched: a
  // per-step treesChanged would also reach pollution's tree listener and change the bot.
  it("trails a moving tornado's tree damage only inside its path, and matches everywhere after its end event", () => {
    const st = city(128), disasters = new DisastersSystem(), sim = new Simulation(st, [disasters]), A = new CityActions(sim);
    const pair = terrainPair(sim), path = tornadoPath(sim);
    cleanup.push(() => { path.dispose(); pair.dispose(); });
    expect(triggerDisaster(sim, 'tornado', 64, 64)).toBe(true);
    sim.advanceDay();
    expect(st.trees.some((v) => v !== 2)).toBe(true);
    // A distant event makes the reference refill and reveal the damage; nothing outside the path may differ.
    expect(A.zone({ x0: 4, z0: 4, x1: 5, z1: 5 }, Zone.ResLow).ok).toBe(true);
    expect(pair.check('active tornado and distant zone', path.rect).lagging).toBeGreaterThan(0);
    for (let d = 0; d < 10 && disasters.active.length; d++) sim.advanceDay();
    expect(disasters.active).toEqual([]);
    expect(pair.check('after the tornado').lagging).toBe(0);
  });

  it('a refused fallback planting writes no trees; a paid one announces them (FallbackActions.plantTrees)', () => {
    const st = city(), sim = new Simulation(st), A = new FallbackActions(sim), pair = terrainPair(sim);
    cleanup.push(() => pair.dispose());
    const rect = { x0: 20, z0: 20, x1: 22, z1: 21 };
    const events: CellRect[] = [];
    sim.events.on('treesChanged', (r) => events.push(r));
    const before = st.trees.slice();
    st.config.sandbox = false; st.funds = 0;
    expect(A.plantTrees(rect)).toMatchObject({ ok: false, reason: 'Not enough money' });
    expect(st.trees).toEqual(before);
    expect(st.funds).toBe(0);
    expect(events).toEqual([]);
    expect(A.plantTrees(rect, true)).toMatchObject({ ok: false }); // a preview writes nothing either
    st.funds = 100;
    expect(A.plantTrees(rect, true)).toMatchObject({ ok: true, cost: 6, affected: 2 });
    expect(st.trees).toEqual(before);
    expect(A.plantTrees(rect)).toMatchObject({ ok: true, cost: 6, affected: 2 });
    expect(st.funds).toBe(94);
    expect(events).toEqual([rect]);
    expect(st.trees[st.idx(20, 20)]).toBe(Math.min(4, before[st.idx(20, 20)] + 2));
    pair.check('fallback planting');
  });

  it('a fallback terraform announces the water ring it recomputes', () => {
    const st = city(), sim = new Simulation(st), A = new FallbackActions(sim);
    const events: CellRect[] = [];
    sim.events.on('terrainChanged', (r) => events.push(r));
    expect(A.terraform('lower', 20, 20, 4, 20).ok).toBe(true);
    expect(events).toEqual([{ x0: 15, z0: 15, x1: 26, z1: 26 }]); // cells 16..24 edited, plus computeWater's one-cell ring
  });
});
