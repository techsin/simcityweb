/**
 * Close-out c2 (major), UI side: the real inspector (InfoPanel) on R, C and I homes / shops / factories, a service and a
 * utility, its WHY? section opened by a click (the desirability, land value, condition and growth breakdowns), then the
 * city is dropped: its state, runtime, simulation and a stand-in scene (closed over by every system method, as
 * CityScene.guardSystem does) must be collectable. Before the fix the module-level breakdown contexts kept the last
 * inspected city — and through its TrafficSystem the scene — alive after exit to region (tests/sim/breakdownRetention).
 */
import { describe, expect, it } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import { Network, Zone } from '../../src/core/types';
import { BF, type CityState } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import { listRewards } from '../../src/sim/economy/rewards';
import { normalizeReward } from '../../src/game/modules';
import type { GameContext } from '../../src/game/context';
import { InfoPanel } from '../../src/ui/panels/InfoPanel';
import { newState, place, roadLine } from '../infra/cityGen';
import { type FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;

function guardLike(systems: SimSystem[], scene: object): void {
  for (const s of systems) {
    for (const m of ['init', 'daily', 'monthly', 'yearly', 'frame'] as const) {
      const f = s[m] as ((...a: unknown[]) => void) | undefined;
      if (typeof f !== 'function') continue;
      (s as unknown as Record<string, unknown>)[m] = function (this: unknown, ...args: unknown[]) {
        void scene;
        return f.apply(this, args);
      };
    }
  }
}

function ctxOf(sim: Simulation): GameContext {
  return {
    get state() { return sim.state; },
    sim,
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
}

interface Refs { refs: Record<string, WeakRef<object>>; shown: string[] }

/** a street with homes, a shop, a factory, a clinic and a coal plant; every one inspected with WHY? open; dropped */
function inspectThenDrop(): Refs {
  const scene = { kind: 'CityScene stand-in', hud: new Float64Array(1 << 15) };
  const st = newState(64);
  roadLine(st, 2, 20, 61, 20, Network.Road);
  place(st, 't_coal', 2, 18, { flags: BF.Plopped });
  const zoned = (x: number, z: number, zone: Zone) => { st.zone[st.idx(x, z)] = zone; return { x, z }; };
  zoned(10, 21, Zone.ResMed);
  zoned(14, 21, Zone.ComLow);
  zoned(18, 21, Zone.IndMed);
  const home = place(st, 't_r2', 10, 21, { pop: 40, flags: BF.Powered | BF.Watered });
  const shop = place(st, 't_cs', 14, 21, { flags: BF.Powered | BF.Watered });
  const factory = place(st, 't_id', 18, 21, { flags: BF.Powered | BF.Watered });
  const clinic = place(st, 't_clinic', 24, 21, { flags: BF.Plopped | BF.Powered | BF.Watered });
  const plant = [...st.buildings.values()].find((b) => b.def === 't_coal')!;
  st.funds = 1e6;
  const systems = createSystems();
  guardLike(systems, scene);
  const sim = new Simulation(st, systems);
  for (const s of systems) s.init?.(sim);
  sim.runDays(12);
  const rt = (sim.getSystem('economy.population') as unknown as { rt: object }).rt;
  const panel = new InfoPanel(ctxOf(sim));
  panel.mount(() => undefined, () => undefined, () => undefined);
  const shown: string[] = [];
  let whyOpened = false;
  for (const b of [home, shop, factory, clinic, plant]) {
    panel.show({ buildingId: b.id, x: b.x, z: b.z });
    const body = panel.body as unknown as FEl;
    const why = body.all().find((e) => e.tagName === 'button' && e.className.includes('ins-sec-h') && textOf(e).includes('Why?'));
    // (opened once: the section's state is kept for the next building, like the player's choice)
    if (why && !whyOpened) {
      why.click();
      whyOpened = true;
    }
    panel.update();
    shown.push(textOf(panel.body as unknown as FEl).slice(0, 60));
  }
  // (a WHY? breakdown really was built for the last growable: its land value and desirability rows)
  panel.show({ buildingId: home.id, x: home.x, z: home.z });
  shown.push(textOf(panel.body as unknown as FEl).includes('Land value') ? 'why: land value shown' : 'why: missing');
  panel.onClose();
  return { refs: { scene: new WeakRef(scene), st: new WeakRef(st), rt: new WeakRef(rt), sim: new WeakRef(sim), panel: new WeakRef(panel) }, shown };
}

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

describe('the inspector keeps no exited city alive (close-out c2 major)', () => {
  it('R / C / I growables, a clinic and a plant inspected with WHY? open; the city dropped: everything is collected', { timeout: 300000 }, async () => {
    const { refs, shown } = inspectThenDrop();
    expect(shown.length).toBe(6);
    expect(shown[5]).toBe('why: land value shown');
    expect(await collected(refs)).toEqual({ scene: true, st: true, rt: true, sim: true, panel: true });
  });
});
