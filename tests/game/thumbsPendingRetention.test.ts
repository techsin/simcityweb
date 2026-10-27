/**
 * Close-out c2 (major), found by the browser exit probe: after "Save & exit to region" the previous city was still alive
 * while thumbnail requests from its HUD were queued. The toolbar flyout cards and the inspector's hero hand
 * src/ui/thumbs.ts a callback, and the renderer works one request per frame (a flyout asks for one per card — slow on a
 * loaded machine). The callbacks closed over the card / icon box, so the card's tree, its listeners and through them the
 * scene stayed reachable until the queue drained. They now hold their element weakly, from a module-level function (a
 * closure made inside the method would keep the method's whole context — the toolbar — through its scope chain).
 *
 * Here frames never come (installFakeDom): every request stays queued, and the dropped toolbar, inspector and their
 * stand-in scene must still be collectable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import { Network, Zone } from '../../src/core/types';
import { BF, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import { listRewards } from '../../src/sim/economy/rewards';
import { normalizeReward } from '../../src/game/modules';
import type { GameContext } from '../../src/game/context';
import { queryHost } from './queryHost';
import { Toolbar } from '../../src/ui/Toolbar';
import { InfoPanel } from '../../src/ui/panels/InfoPanel';
import { thumbs } from '../../src/ui/thumbs';
import { newState, place, roadLine } from '../infra/cityGen';
import { FEl, installFakeDom } from './fakeDom';

installFakeDom();
v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;

// (the flyout is positioned next to its button: a zero rect is enough here)
const proto = FEl.prototype as unknown as { getBoundingClientRect?: () => DOMRect };
let hadRect: typeof proto.getBoundingClientRect;
beforeAll(() => {
  hadRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
});
afterAll(() => {
  proto.getBoundingClientRect = hadRect;
});

const pending = (thumbs as unknown as { pending: Map<string, Promise<unknown>> }).pending;

async function collected(refs: Record<string, WeakRef<object>>): Promise<Record<string, boolean>> {
  let out: Record<string, boolean> = {};
  for (let k = 0; k < 40; k++) {
    await new Promise((r) => setTimeout(r, k ? 25 : 0));
    gc();
    out = Object.fromEntries(Object.entries(refs).map(([n, r]) => [n, r.deref() === undefined]));
    if (Object.values(out).every(Boolean)) break;
  }
  return out;
}

function town(): { st: CityState; sim: Simulation; home: { id: number; x: number; z: number }; clinic: { id: number; x: number; z: number } } {
  const st = newState(64);
  roadLine(st, 2, 20, 61, 20, Network.Road);
  place(st, 't_coal', 2, 18, { flags: BF.Plopped });
  st.zone[st.idx(10, 21)] = Zone.ResMed;
  const home = place(st, 't_r2', 10, 21, { pop: 40, flags: BF.Powered | BF.Watered });
  const clinic = place(st, 't_clinic', 24, 21, { flags: BF.Plopped | BF.Powered | BF.Watered });
  st.funds = 1e6;
  const sim = new Simulation(st, createSystems());
  return { st, sim, home, clinic };
}

describe('a thumbnail request still queued keeps no exited city alive (close-out c2 major)', () => {
  it('toolbar: the Parks flyout\'s cards requested their thumbnails (all still queued); the toolbar and its scene are collected', { timeout: 120000 }, async () => {
    const before = pending.size;
    const make = (): Record<string, WeakRef<object>> => {
      const scene = { kind: 'CityScene stand-in', hud: new Float64Array(1 << 15) };
      const { sim } = town();
      const ctx = {
        get state() { return sim.state; },
        sim,
        scene,
        signal: new AbortController().signal,
        ui: { on: () => () => undefined },
        tools: { activeId: null, select: () => true },
        panels: { isOpen: () => false, toggle: () => undefined },
        overlay: 0,
        sandbox: () => false,
        sound: () => undefined,
      } as unknown as GameContext;
      const parent = document.createElement('div') as unknown as HTMLElement;
      const bar = new Toolbar(ctx, parent);
      bar.openFlyout('parks');
      return { scene: new WeakRef(scene), bar: new WeakRef(bar), parent: new WeakRef(parent), sim: new WeakRef(sim) };
    };
    const refs = make();
    // (the cards asked for their thumbnails; no frame ever runs them)
    expect(pending.size).toBeGreaterThan(before);
    expect(await collected(refs)).toEqual({ scene: true, bar: true, parent: true, sim: true });
    expect(pending.size).toBeGreaterThan(before);
  });

  it('inspector: a home and a clinic shown (their hero thumbnails still queued), then dropped: panel, sim and scene are collected', { timeout: 120000 }, async () => {
    const before = pending.size;
    const make = (): Record<string, WeakRef<object>> => {
      const scene = { kind: 'CityScene stand-in', hud: new Float64Array(1 << 15) };
      const { sim, home, clinic } = town();
      const ctx = {
        host: queryHost(sim), signal: new AbortController().signal,
        get state() { return sim.state; },
        sim,
        scene,
        mods: { listRewards: (s: CityState) => listRewards(s).map(normalizeReward) },
        actions: { bulldoze: () => ({ ok: true, cost: 0 }) },
        objects: { setSelected: () => undefined },
        panels: { close: () => undefined, open: () => undefined },
        tools: { select: () => true },
        focusCell: () => undefined,
        showQuery: () => undefined,
        sandbox: () => false,
        sound: () => undefined,
        toast: () => undefined,
      } as unknown as GameContext;
      const panel = new InfoPanel(ctx);
      panel.mount(() => undefined, () => undefined, () => undefined);
      for (const b of [home, clinic]) {
        panel.show({ buildingId: b.id, x: b.x, z: b.z });
        panel.update();
      }
      panel.onClose();
      return { scene: new WeakRef(scene), panel: new WeakRef(panel), sim: new WeakRef(sim) };
    };
    const refs = make();
    expect(pending.size).toBeGreaterThan(before);
    expect(await collected(refs)).toEqual({ scene: true, panel: true, sim: true });
    expect(pending.size).toBeGreaterThan(before);
  });
});
