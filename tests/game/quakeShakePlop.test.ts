/**
 * Close-out c2 item 6 (playtest c2 finding 3): during an earthquake with the game paused the camera kept shaking
 * forever — the sim keeps a paused quake active, and CityScene.feedShake started a new shake every 1.2 s of real time
 * without looking at the speed. A plop preview made under a resting pointer and the click that followed then picked
 * different cells: the preview was ok, the click re-ran the placement with the shaken camera one cell over and failed
 * ("Blocked by a road or rail").
 *  - feedShake starts no shake while paused or while the pause menu is open (the current one fades out);
 *  - PlopTool.down places what the preview shows when the pointer has not moved since it (the ground point under it
 *    drifting at most PREVIEW_JITTER cells: a shake, not a pan).
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { CityActions } from '../../src/sim/actions';
import { getDef } from '../../src/sim/catalog';
import type { Simulation } from '../../src/sim/Simulation';
import type { GameContext } from '../../src/game/context';
import type { ToolPointer } from '../../src/game/tools/Tool';
import { PREVIEW_JITTER, PlopTool } from '../../src/game/tools/PlopTool';
import { CityScene } from '../../src/game/CityScene';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newSim, newState, roadLine } from '../infra/cityGen';

// ------------------------------------------------------------------------------------------------ feedShake
type ShakeThis = { world: { shake: (i: number, s: number) => void }; objects: { disasters: { shake: number } }; sim: { speed: number }; pause: { isOpen: boolean }; shakeNext: number; quakeEventAt: number };
function shakeHost(speed: number, menuOpen = false) {
  const shakes: number[] = [];
  const self: ShakeThis = { world: { shake: (i) => shakes.push(i) }, objects: { disasters: { shake: 0.8 } }, sim: { speed }, pause: { isOpen: menuOpen }, shakeNext: 0, quakeEventAt: -1e9 };
  const feed = () => (CityScene.prototype as unknown as { feedShake(this: ShakeThis, dt: number): void }).feedShake.call(self, 1 / 60);
  return { self, shakes, feed };
}

describe('quake camera shake while paused (close-out c2 item 6)', () => {
  it('a running quake keeps the camera moving; paused or with the pause menu open no new shake starts', () => {
    const run = shakeHost(1);
    run.feed();
    expect(run.shakes.length).toBe(1);
    expect(run.shakes[0]).toBeCloseTo(0.45 + 0.55 * 0.8, 6);
    // (the next one waits 1.2 s)
    run.feed();
    expect(run.shakes.length).toBe(1);
    const paused = shakeHost(0);
    for (let k = 0; k < 5; k++) paused.feed();
    expect(paused.shakes.length).toBe(0);
    const menu = shakeHost(1, true);
    menu.feed();
    expect(menu.shakes.length).toBe(0);
    // resumed: the shake comes back
    paused.self.sim.speed = 1;
    paused.feed();
    expect(paused.shakes.length).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------ PlopTool.down
function fakeCtx(sim: Simulation) {
  const calls = { plops: [] as { x: number; z: number; rot: number; ok: boolean }[], toasts: [] as string[] };
  const actions = new CityActions(sim);
  const host = new LocalSimHost(sim.state);
  const plop = actions.plop.bind(actions);
  actions.plop = (id, x, z, rot, dry = false) => {
    const r = plop(id, x, z, rot, dry);
    if (!dry) calls.plops.push({ x, z, rot, ok: r.ok });
    return r;
  };
  host.actions.target = actions;
  const ctx = {
    state: sim.state,
    sim,
    host,
    signal: new AbortController().signal,
    actions: host.actions,
    world: { setHighlight: () => {}, setHighlightRect: () => {} },
    objects: { setGhost: () => {}, setNetworkPreview: () => {} },
    tip: { show: () => {}, hide: () => {}, move: () => {} },
    sandbox: () => false,
    sound: () => {},
    toast: (t: string) => calls.toasts.push(t),
    tools: { active: null, refresh: () => {}, select: () => true },
    preferOverlayVariant: () => {},
  } as unknown as GameContext;
  return { ctx, calls };
}

/** the same screen point (clientX / clientY) over ground point (px, pz) in cells */
function ptr(px: number, pz: number, clientX = 640, clientY = 360): ToolPointer {
  return { clientX, clientY, hit: { x: Math.floor(px), z: Math.floor(pz), point: { x: px * 16, y: 5, z: pz * 16 } } as unknown as ToolPointer['hit'], shift: false, ctrl: false, alt: false, down: true };
}

/** a road along x = 11 (z 2..28): a small park left of it, at x = 10 */
function park() {
  const st = newState(32);
  roadLine(st, 11, 2, 11, 28, Network.Road);
  st.funds = 1e6;
  const sim = newSim(st);
  const f = fakeCtx(sim);
  const tool = new PlopTool(f.ctx, getDef('park_small')!, 'park');
  tool.activate();
  return { st, f, tool };
}

describe('a plop click places the previewed spot when the pointer did not move (close-out c2 item 6)', () => {
  it('the ground point under a resting pointer drifts across a cell edge (shaken camera): the click still places the preview', () => {
    const { f, tool } = park();
    // the preview: the cursor 0.01 cells left of the cell edge x = 11 -> the park at x = 10, beside the road
    tool.move(ptr(10.99, 14.5));
    // the click at the same screen point, the camera shaken by 0.02 cells: the ground point is now over the road
    tool.down(ptr(11.01, 14.5));
    expect(f.calls.plops).toEqual([{ x: 10, z: 14, rot: expect.any(Number), ok: true }]);
    expect(f.calls.toasts).toEqual([]);
  });

  it('a pointer that moved, or a ground point that moved more than PREVIEW_JITTER cells (a pan), picks the spot afresh', () => {
    const a = park();
    a.tool.move(ptr(10.99, 14.5));
    // (moved on screen to the road: picked afresh there — and refused)
    a.tool.down(ptr(11.01, 14.5, 641, 360));
    expect(a.f.calls.plops).toEqual([{ x: 11, z: 14, rot: expect.any(Number), ok: false }]);
    expect(a.f.calls.toasts.length).toBe(1);
    const b = park();
    b.tool.move(ptr(10.5, 6.5));
    // (same screen point, the view panned PREVIEW_JITTER + 1 cells: the spot now under the pointer)
    b.tool.down(ptr(10.5, 6.5 + PREVIEW_JITTER + 1));
    expect(b.f.calls.plops).toEqual([{ x: 10, z: 6 + PREVIEW_JITTER + 1, rot: expect.any(Number), ok: true }]);
  });
});
