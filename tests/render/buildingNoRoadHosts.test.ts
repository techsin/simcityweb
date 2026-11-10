/**
 * NEW-02 on the hosts' own event buses (LocalSimHost: the simulation's; LoopbackSimHost: the replica's, which the worker
 * host shares), with the views wired as the city screen wires them: WorldView's bindEvents on a real TerrainRenderer and
 * a real CityObjectsView. R1's terrain refills only an event's rect, so nothing here can ride on a whole-map terrain
 * refresh: after every edit that can change road access, the model mask still equals the hover readout's noRoad set.
 * What repaints or restarts the mask in each step:
 *  - a road built or removed: CityObjectsView's networkChanged handler (it bumps the view's revision);
 *  - a building added or removed: BuildingRenderer's build / freeInstances;
 *  - the response pass: TerrainRenderer.update's raster refresh (layerUpdated 'emergency');
 *  - a replaced state (a resync, a load): TerrainRenderer.reset, BuildingRenderer.setState and the rebuild.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import type { Emitter } from '../../src/core/events';
import { Network, Overlay } from '../../src/core/types';
import { CityObjectsView } from '../../src/render/city/CityObjectsView';
import { TerrainRenderer } from '../../src/render/world/TerrainRenderer';
import { WorldView } from '../../src/render/world/WorldView';
import { buildingOverlayOf } from '../../src/render/world/overlays';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import type { Building, CityState } from '../../src/sim/CityState';
import type { CityEvents } from '../../src/sim/Simulation';
import { lPath } from '../../src/sim/actions';
import { EMG_FIRE, attachOverlays, overlayReadout } from '../../src/sim/infra/overlays';
import { EMERG_RESP_PERIOD } from '../../src/sim/infra/params';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { LocalSimHost, type CommandArgs, type CommandOp } from '../../src/worker/SimHost';
import { newState, place, roadLine } from '../infra/cityGen';
import { cellTextures } from './terrainRectsHarness';

registerAllModels();

type Host = LocalSimHost | LoopbackSimHost;
type Internals = { noRoadData: Uint8Array; noRoadWork: unknown };
const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); });

/** a covered road along z = 10 (fire station at 20, 11): a house on it, a house on the cell the test cuts, the Obelisk
 *  ten cells from any road */
function city(): CityState {
  const st = newState(48);
  st.funds = 1e7;
  roadLine(st, 2, 10, 40, 10);
  place(st, 't_fire', 20, 11);
  place(st, 't_r1', 8, 11, { pop: 12 });
  place(st, 't_r1', 30, 11, { pop: 12 });
  place(st, 'lm_obelisk', 12, 20);
  return st;
}

/** WorldView's own event wiring and state swap around a real TerrainRenderer (no WebGL: stand-ins for the rest) */
function world(events: Emitter<CityEvents>, state: CityState, getState: () => CityState) {
  const terrain = new TerrainRenderer(state, 0, false);
  const view = Object.create(WorldView.prototype) as { terrain: TerrainRenderer; unsub: (() => void)[] };
  Object.assign(view, {
    state, getState, events, unsub: [], shForce: 0, timeForce: false, terrain, cameraController: { shake() {} },
    trees: { reset() {}, onCellsChanged() {}, setMonth() {} }, sky: { setClimate() {} }, water: { updateOuter() {} },
  });
  (WorldView.prototype as unknown as { bindEvents(this: object): void }).bindEvents.call(view);
  cleanup.push(() => { for (const off of view.unsub) off(); view.terrain.dispose(); });
  return view;
}

async function rig(kind: 'local' | 'loopback') {
  const host: Host = kind === 'local' ? new LocalSimHost(city(), { initialSpeed: 0 })
    : new LoopbackSimHost(city(), { initialSpeed: 0, loopback: { cadence: 'design' } });
  cleanup.push(() => host.dispose());
  await host.start();
  if (host instanceof LocalSimHost) cleanup.push(attachOverlays(host.sim)); // as CityScene does
  const days = async (n: number) => {
    if (host instanceof LoopbackSimHost) { host.harness.runDays(n); await host.drain(); } else host.sim.runDays(n);
  };
  await days(2);
  expect(host.emergency.layersReady, 'the first response pass ran').toBe(true);
  const w = world(host.events, host.state, () => host.state);
  const objects = new CityObjectsView(host.state, host.events, {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), renderer: {} as THREE.WebGLRenderer,
    canvas: {} as HTMLCanvasElement, getState: () => host.state,
  });
  cleanup.push(() => objects.dispose());
  const buildings = objects.buildings, inside = () => buildings as unknown as Internals;
  /** the frames of the city screen, in its order, until the budgeted sweep is idle */
  const frames = () => {
    for (let frame = 0, idle = 0; frame < 400; frame++) {
      w.terrain.update();
      buildings.update(0);
      if (buildings.pendingBuilds || inside().noRoadWork) idle = 0;
      else if (++idle === 2) return;
    }
    throw new Error('the mask sweep did not settle');
  };
  const act = async <K extends CommandOp>(op: K, args: CommandArgs<K>) => {
    const ticket = host.act(op, args);
    if (host instanceof LoopbackSimHost) await host.drain();
    return ticket.done;
  };
  const at = (x: number, z: number): Building => host.state.buildings.get(host.state.building[host.state.idx(x, z)])!;
  const readout = (b: Building) => overlayReadout(host.state, Overlay.Emergency, b.x, b.z, EMG_FIRE);
  const lit = (a: Uint8Array) => { const out: number[] = []; a.forEach((v, i) => { if (v) out.push(i); }); return out; };
  /** the whole mask against the readout: every noRoad footprint at 255, every other cell 0 */
  const check = (context: string): Building[] => {
    frames();
    const st = host.state, expected = new Uint8Array(st.cells), roadless: Building[] = [];
    for (const b of st.buildings.values()) {
      if (readout(b)?.reason !== 'noRoad') continue;
      roadless.push(b);
      for (let z = b.z; z < b.z + b.d; z++) expected.fill(255, st.idx(b.x, z), st.idx(b.x, z) + b.w);
    }
    const mask = inside().noRoadData;
    expect(mask.length, context).toBe(st.cells);
    expect(mask.every((v) => v === 0 || v === 255), context).toBe(true);
    expect(lit(mask), context).toEqual(lit(expected));
    return roadless;
  };
  host.setView({ overlay: Overlay.Emergency, variant: EMG_FIRE, panels: [], focus: [] });
  if (host instanceof LoopbackSimHost) await host.drain();
  w.terrain.setOverlay(Overlay.Emergency, EMG_FIRE);
  return { host, terrain: w.terrain, days, act, at, readout, check };
}

describe.each(['local', 'loopback'] as const)('Emergency model tint on the %s host', (kind) => {
  it('follows roads, buildings, the response pass and a replaced state through the real event wiring', { timeout: 120000 }, async () => {
    const r = await rig(kind), host = r.host;
    const obelisk = () => r.at(12, 20), cut = () => r.at(30, 11);
    // views built over an existing city (a load), the view selected afterwards
    expect(r.check('first selection')).toEqual([obelisk()]);

    // a road built and removed beside the Obelisk, the game paused: the terrain refills only the rect
    const day = host.state.day;
    for (const tex of cellTextures(r.terrain)) { tex.clearUpdateRanges(); tex.onUpdate?.(tex); }
    expect((await r.act('buildNetwork', [lPath({ x: 11, z: 19 }, { x: 12, z: 19 }), Network.Road])).ok).toBe(true);
    expect(r.readout(obelisk())).toMatchObject({ text: 'Out of reach by 6+ min', tone: 'bad' });
    expect(r.check('road built while paused')).toEqual([]);
    const rows = cellTextures(r.terrain)[0].updateRanges.length;
    expect(rows, 'R1: the event frame uploaded a few rows, not the map').toBeGreaterThan(0);
    expect(rows).toBeLessThan(8);
    expect((await r.act('bulldoze', [{ x0: 11, z0: 19, x1: 13, z1: 20 }])).ok).toBe(true);
    expect(r.check('road removed while paused')).toEqual([obelisk()]);

    // a building added and removed, still paused
    expect((await r.act('plop', ['t_park', 20, 30, 0])).ok).toBe(true);
    const park = r.at(20, 30);
    expect(r.check('roadless building added')).toEqual([obelisk(), park]);
    expect((await r.act('bulldoze', [{ x0: 20, z0: 30, x1: 21, z1: 31 }])).ok).toBe(true);
    expect(host.state.buildings.has(park.id)).toBe(false);
    expect(r.check('building removed')).toEqual([obelisk()]);
    expect(host.state.day).toBe(day);

    // the road cut beside a served house: its response value is stale until the next pass, hover and model agree
    expect((await r.act('bulldoze', [{ x0: 30, z0: 10, x1: 31, z1: 11 }])).ok).toBe(true);
    expect(r.readout(cut())!.tone).toBe('good');
    expect(r.check('road cut, response not recomputed yet')).toEqual([obelisk()]);
    const revision = buildingOverlayOf(host.state)!.revision;
    await r.days(EMERG_RESP_PERIOD + 30); // headless, a road change waits for the periodic pass
    expect(r.readout(cut())!.text).toBe('Unreachable — no road beside it');
    expect(r.check('after the response pass')).toEqual([cut(), obelisk()]);
    expect(buildingOverlayOf(host.state)!.revision, 'the raster refresh restarted the sweep').toBeGreaterThan(revision);

    // a replaced state: a resync's fresh replica, or a load into the running simulation
    const old = host.state, paused = old.day;
    if (host instanceof LoopbackSimHost) { host.harness.resync(); await host.drain(); }
    else host.sim.replaceState(deserializeCity(structuredClone(serializeCity(host.sim.state))));
    expect(host.state).not.toBe(old);
    expect(buildingOverlayOf(old)?.overlay ?? Overlay.None, 'the old state keeps no view').toBe(Overlay.None);
    expect(host.state.day).toBe(paused);
    expect(r.check('replaced state, still paused')).toEqual([cut(), obelisk()]);
  });
});
