/**
 * Close-out c2 (major): one inspector click kept the whole exited city alive. desirabilityBreakdown and
 * landValueBreakdown (the inspector calls them for every growable it shows, the WHY? section open or not) kept their
 * term context in a module-level variable until the next breakdown: the context held the CityState, the EconRuntime
 * and the city's TrafficSystem, whose methods CityScene.guardSystem wraps in closures over the scene. The heap after
 * exit to region: module Context --bctx--> TermCtx --traffic--> TrafficSystem --init--> (closure) --> CityScene, and
 * through it the HUD, the banners, the toolbar, observers and canvases (audit c2, heap-snapshot proven).
 *
 * The contexts are now kept per runtime in a WeakMap. Here the systems are wrapped the way guardSystem wraps them,
 * around a stand-in scene; after the breakdowns of R, C and I lots and dropping the city, the scene, the state, the
 * runtime, the simulation and its traffic system must all be collectable. (The way tests/render/exitRetention.test.ts
 * gets a GC: --expose_gc set at run time, gc() from a new context.)
 */
import { describe, expect, it } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import { createSystems } from '../../src/sim/systems/index';
import type { SimSystem, Simulation } from '../../src/sim/Simulation';
import type { EconRuntime } from '../../src/sim/economy/runtime';
import { desirabilityBreakdown } from '../../src/sim/economy/desirability';
import { landValueBreakdown } from '../../src/sim/economy/landValue';
import { ZONE_DEVTYPES, getDef } from '../../src/sim/catalog';
import { DevType, Network, Zone } from '../../src/core/types';
import { makeCity, road } from './helpers';

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;

/** CityScene.guardSystem: every system method becomes a closure that also holds the scene */
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

interface Refs { scene: WeakRef<object>; st: WeakRef<object>; rt: WeakRef<object>; sim: WeakRef<object>; traffic: WeakRef<object>; lots: number; terms: number }

/** a small town (R, C and I lots, power and water), the inspector's breakdowns of an R, a C and an I lot, then dropped */
function inspectThenDrop(which: 'desirability' | 'landValue' | 'both' = 'both'): Refs {
  const scene = { kind: 'CityScene stand-in', hud: new Float64Array(1 << 15) };
  const systems = createSystems();
  guardLike(systems, scene);
  const { st, sim, A } = makeCity({ size: 64 }, systems);
  st.funds = 5e6;
  expect(road(A, 0, 32, 63, 32, Network.Avenue).ok).toBe(true);
  for (let x = 8; x <= 40; x += 8) road(A, x, 20, x, 44);
  road(A, 8, 20, 40, 20);
  road(A, 8, 44, 40, 44);
  A.zone({ x0: 9, z0: 21, x1: 16, z1: 31 }, Zone.ResLow);
  A.zone({ x0: 17, z0: 21, x1: 24, z1: 31 }, Zone.ResMed);
  A.zone({ x0: 25, z0: 21, x1: 32, z1: 31 }, Zone.ComMed);
  A.zone({ x0: 9, z0: 33, x1: 32, z1: 43 }, Zone.IndMed);
  for (const [def, x, z] of [['util_gas_plant', 42, 26], ['util_water_pump', 42, 36]] as const) {
    let ok = false;
    for (const rot of [0, 1, 2, 3] as const) if (!ok) ok = A.plop(def, x, z, rot).ok;
    expect(ok, def).toBe(true);
  }
  sim.runDays(40);
  const rt = (sim.getSystem('economy.population') as unknown as { rt: EconRuntime }).rt;
  const traffic = sim.getSystem('traffic');
  // (no object goes into expect() here: the assertion library may keep the last value it was given)
  expect(!!traffic).toBe(true);
  // what the inspector shows for a growable or an empty zoned lot: the desirability breakdown of its DevType at the lot
  // and the land value breakdown — one R, one C and one I lot (a building's when one stands there)
  let lots = 0, terms = 0;
  for (const zone of [Zone.ResLow, Zone.ComMed, Zone.IndMed]) {
    let i = -1;
    for (const b of st.buildings.values()) {
      const d = getDef(b.def);
      if (d?.category === 'growable' && st.zone[b.z * st.size + b.x] === zone) { i = b.z * st.size + b.x; break; }
    }
    if (i < 0) i = st.zone.findIndex((z, k) => z === zone && st.network[k] === Network.None);
    const b = st.buildingAt(i % st.size, (i / st.size) | 0);
    const dev = b ? getDef(b.def)?.devType ?? ZONE_DEVTYPES[zone][0] : ZONE_DEVTYPES[zone][0];
    if (which !== 'landValue') terms += desirabilityBreakdown(st, rt, dev, i).terms.length;
    if (which !== 'desirability') terms += landValueBreakdown(st, rt, i).length;
    lots++;
  }
  void DevType;
  return { scene: new WeakRef(scene), st: new WeakRef(st), rt: new WeakRef(rt), sim: new WeakRef(sim as Simulation), traffic: new WeakRef(traffic!), lots, terms };
}

/**
 * after the current task (WeakRef targets live until its end) and a full GC: which of them are gone? Retried for a
 * while: V8 may still hold a hot closure's context in a pending concurrent compile job's handles for a moment (a heap
 * snapshot shows it under "(Handle scope)"); a real retainer keeps it for good.
 */
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

describe('inspector breakdowns keep no exited city alive (close-out c2 major)', () => {
  for (const which of ['desirability', 'landValue'] as const) {
    it(`${which}Breakdown on R, C and I lots, then the city is dropped: scene, state, runtime, sim and traffic are collected`, { timeout: 300000 }, async () => {
      const { lots, terms, ...refs } = inspectThenDrop(which);
      // the breakdown really ran its term model (not the stub output) on a lot of each family
      expect(lots).toBe(3);
      expect(terms).toBeGreaterThan(which === 'desirability' ? 30 : 6);
      expect(await collected(refs)).toEqual({ scene: true, st: true, rt: true, sim: true, traffic: true });
    });
  }

  it('a second city inspected after the first keeps nothing of either once both are dropped', { timeout: 300000 }, async () => {
    const a = inspectThenDrop();
    const b = inspectThenDrop();
    const { lots: _la, terms: _ta, ...ra } = a;
    const { lots: _lb, terms: _tb, ...rb } = b;
    void _la; void _ta; void _lb; void _tb;
    const got = await collected({ ...Object.fromEntries(Object.entries(ra).map(([k, v]) => ['a.' + k, v])), ...Object.fromEntries(Object.entries(rb).map(([k, v]) => ['b.' + k, v])) });
    expect(Object.values(got).every(Boolean), JSON.stringify(got)).toBe(true);
  });
});
