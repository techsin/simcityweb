/**
 * Close-out c4 (T016): what an exited city leaves behind must not reach it.
 * - The T013 playtest kept one node of the exited city's DOM alive (a harness handle; an extension or DevTools can do
 *   the same) and with it every listener on that detached tree — each closing over its component, the component's ctx
 *   and so the whole city. The city's element listeners now go with ctx.signal: after the abort a detached inspector
 *   (the playtest's case: a growable with WHY? open) holds no listener at all.
 * - The dom.ts helpers take that signal (h's `signal` attribute, slider / toggle / segmented / stepButtons).
 * - The shared LOD proxy builder drops a disposed BuildingRenderer's waiting callbacks (cancel(owner); minor 1: the
 *   city stayed alive 1-3 s after exit when its proxies were still being built).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Network, Zone } from '../../src/core/types';
import { BF, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import { listRewards } from '../../src/sim/economy/rewards';
import { normalizeReward } from '../../src/game/modules';
import type { GameContext } from '../../src/game/context';
import { InfoPanel } from '../../src/ui/panels/InfoPanel';
import { h, segmented, slider, stepButtons, toggle } from '../../src/ui/dom';
import { Toasts } from '../../src/ui/Notifications';
import { LodProxyBuilder } from '../../src/render/city/buildings/lodBuilder';
import { newState, place, roadLine } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const gw = globalThis as unknown as Record<string, unknown>;
const hadG: Record<string, unknown> = {};
beforeAll(() => {
  for (const k of ['requestAnimationFrame', 'window']) hadG[k] = gw[k];
  gw.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 0);
  gw.window ??= globalThis;
});
afterAll(() => {
  for (const k of Object.keys(hadG)) gw[k] = hadG[k];
});

/** every listener on an element and its descendants */
const listenersIn = (el: FEl): number => el.listenerCount() + el.all().reduce((n, e) => n + e.listenerCount(), 0);

describe('dom.ts helpers bind their listeners to a signal (close-out c4)', () => {
  it('h, slider, toggle, segmented and stepButtons: nothing fires and nothing stays registered after the abort', () => {
    const ac = new AbortController();
    const hit = vi.fn();
    const btn = h('button', { onclick: hit, signal: ac.signal }) as unknown as FEl;
    const sl = slider({ min: 0, max: 10, value: 5, oninput: hit, onchange: hit, signal: ac.signal }) as unknown as FEl;
    const sw = toggle(false, hit, false, ac.signal) as unknown as FEl;
    const seg = segmented([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], 'a', hit, ac.signal) as unknown as FEl;
    const steps = stepButtons(sl as unknown as HTMLInputElement, 'x', undefined, ac.signal) as unknown as FEl[];
    expect(btn.getAttribute('signal')).toBe(null);
    btn.click();
    sw.click();
    expect(hit).toHaveBeenCalledTimes(2);
    const all = [btn, sl, sw, seg, ...steps];
    expect(all.reduce((n, e) => n + listenersIn(e), 0)).toBeGreaterThan(10);
    expect((sl as unknown as { __paint?: unknown }).__paint).toBeTypeOf('function');
    ac.abort('dispose');
    expect(all.reduce((n, e) => n + listenersIn(e), 0)).toBe(0);
    // (the slider's paint expando closes over the callbacks into the city too)
    expect((sl as unknown as { __paint?: unknown }).__paint).toBeUndefined();
    btn.click();
    sw.click();
    expect(hit).toHaveBeenCalledTimes(2);
  });
});

function ctxOf(sim: Simulation, signal: AbortSignal): GameContext {
  return {
    get state() { return sim.state; },
    sim,
    signal,
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

describe('a detached inspector holds no listener into the exited city (close-out c4, the T013 playtest major)', () => {
  it('a growable inspected with WHY? open: every element listener of the panel goes with the city signal', { timeout: 120000 }, () => {
    const st = newState(64);
    roadLine(st, 2, 20, 61, 20, Network.Road);
    place(st, 't_coal', 2, 18, { flags: BF.Plopped });
    st.zone[st.idx(10, 21)] = Zone.ResMed;
    const home = place(st, 't_r2', 10, 21, { pop: 40, flags: BF.Powered | BF.Watered });
    st.funds = 1e6;
    const systems = createSystems();
    const sim = new Simulation(st, systems);
    for (const s of systems) s.init?.(sim);
    sim.runDays(12);
    const ac = new AbortController();
    const panel = new InfoPanel(ctxOf(sim, ac.signal));
    panel.mount(() => undefined, () => undefined, () => undefined);
    panel.show({ buildingId: home.id, x: home.x, z: home.z });
    const el = (panel as unknown as { el: FEl }).el;
    const why = el.all().find((e) => e.tagName === 'button' && e.className.includes('ins-sec-h') && textOf(e).includes('Why?'));
    expect(why).toBeTruthy();
    why!.click();
    panel.update();
    expect(textOf(el)).toContain('Land value');
    expect(listenersIn(el)).toBeGreaterThan(3);
    ac.abort('dispose');
    expect(listenersIn(el)).toBe(0);
  });
});

describe('a toast up at exit keeps no timer into the exited city (close-out c4 minor 1)', () => {
  it('the city\'s abort clears every pending toast timer (a dispatch\'s toast held the city 1-3 s; a disaster\'s 12 s)', () => {
    vi.useFakeTimers();
    try {
      const ac = new AbortController();
      const root = new FEl('div');
      const ctx = {
        sim: { events: { on: () => () => undefined } }, settings: { toasts: true }, mods: {}, signal: ac.signal, root,
        sound: () => undefined, focusCell: () => undefined,
      } as unknown as GameContext;
      const toasts = new Toasts(ctx, root as unknown as HTMLElement);
      toasts.show('Fire truck dispatched', 'info');
      toasts.show('Earthquake!', 'disaster', { x: 1, z: 2 });
      expect(vi.getTimerCount()).toBe(2);
      ac.abort('dispose');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the shared LOD proxy builder forgets a disposed renderer (close-out c4 minor 1)', () => {
  it('cancel(owner) drops only that owner\'s callbacks and the jobs nobody waits for any more', async () => {
    const pb = new LodProxyBuilder(); // (no Worker in node: the main-thread fallback queue)
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const a = {}, b = {};
    const doneA = vi.fn(), doneB = vi.fn();
    pb.request('t016#cancel-a', geo, doneA, false, a);
    pb.request('t016#cancel-b', geo, doneA, false, a);
    pb.request('t016#cancel-b', geo, doneB, false, b);
    expect(pb.pending).toBe(2);
    pb.cancel(a);
    // (a's job alone is gone; the shared one still waits for b)
    expect(pb.pending).toBe(1);
    pb.cancel(b);
    expect(pb.pending).toBe(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(doneA).not.toHaveBeenCalled();
    expect(doneB).not.toHaveBeenCalled();
  });
});
